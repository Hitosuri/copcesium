import type { Viewer } from 'cesium';
import proj4 from 'proj4';
import type { Copc, Hierarchy } from 'copc';
import type { CopcDataSourceOptions, LoadedNode, NodeRenderData } from './types';
import { loadCopcHierarchy } from './copc/hierarchy';
import { detectCrs } from './crs/detectCrs';
import { createProjector } from './crs/project';
import type { ProjectToCartesian } from './lod/boundingVolume';
import { getNodeBoundingSphere } from './lod/boundingVolume';
import { selectNodes } from './lod/selectNodes';
import { createNodePrimitive } from './loader/loadNode';
import type { Ref } from './renderer/PointCloudPrimitive';
import { WorkerPool } from './worker/WorkerPool';
import type { NodeConversionPayload } from './worker/messages';
import { NodeCache } from './cache/NodeCache';

export type { CopcDataSourceOptions };

const DEFAULT_OPTIONS: Required<CopcDataSourceOptions> = {
  proj: 'EPSG:4326',
  projDef: null,
  geoidOffset: 0,
  concurrency: 5,
  debounceMs: 100,
  maxCacheNodes: 150,
  maxVisibleNodes: 100,
  pixelSize: 2,
  sseThreshold: 250,
  zFactor: 1,
  xyFactor: 1,
};

export class CopcDataSource {
  private readonly _url: string;
  private readonly _viewer: Viewer;
  private readonly _copc: Copc;
  private readonly _nodes: Hierarchy.Node.Map;
  private readonly _maxDepth: number;
  private readonly _rootCenter: { x: number; y: number; z: number };
  private readonly _rootHalfSize: number;
  private readonly _options: Required<CopcDataSourceOptions>;
  private readonly _project: ProjectToCartesian;
  private readonly _pixelSizeRef: Ref<number>;
  private readonly _nodeCache: NodeCache;
  private readonly _workerPool: WorkerPool;
  private readonly _pendingKeys = new Set<string>();
  private readonly _removeUpdateListener: () => void;
  private _lastUpdateTime = 0;
  private _destroyed = false;

  private constructor(
    url: string,
    viewer: Viewer,
    hierarchy: Awaited<ReturnType<typeof loadCopcHierarchy>>,
    options: Required<CopcDataSourceOptions>,
    project: ProjectToCartesian,
  ) {
    this._url = url;
    this._viewer = viewer;
    this._copc = hierarchy.copc;
    this._nodes = hierarchy.nodes;
    this._maxDepth = hierarchy.maxDepth;
    this._rootCenter = hierarchy.rootCenter;
    this._rootHalfSize = hierarchy.rootHalfSize;
    this._options = options;
    this._project = project;
    this._pixelSizeRef = { value: options.pixelSize };
    this._nodeCache = new NodeCache(options.maxCacheNodes, (_key, node) => this._destroyLoadedNode(node));
    this._workerPool = new WorkerPool(
      () => new Worker(new URL('./worker/worker.ts', import.meta.url), { type: 'module' }),
      options.concurrency,
    );
    this._removeUpdateListener = viewer.scene.preRender.addEventListener(() => this._update());
  }

  static async load(
    url: string,
    viewer: Viewer,
    options: CopcDataSourceOptions = {},
  ): Promise<CopcDataSource> {
    const resolved: Required<CopcDataSourceOptions> = { ...DEFAULT_OPTIONS, ...options };

    const hierarchy = await loadCopcHierarchy(url);

    // Run WKT detection unconditionally — even when the caller overrides
    // proj/projDef, the file's WKT may still be the only source of the true
    // zFactor/xyFactor (e.g. a compound CRS with foot-based vertical units).
    // proj/projDef and zFactor/xyFactor are therefore applied independently,
    // each only when the user did not explicitly set that particular field.
    const detected = detectCrs(hierarchy.copc.wkt, url);
    if (detected) {
      if (!resolved.projDef) {
        resolved.proj = detected.proj;
        resolved.projDef = detected.projDef;
      }
      // Check the raw `options` argument, not `resolved`, since `resolved`
      // already carries the (indistinguishable) default of 1.
      if (options.zFactor === undefined) resolved.zFactor = detected.zFactor;
      if (options.xyFactor === undefined) resolved.xyFactor = detected.xyFactor;
    }
    if (resolved.projDef && resolved.proj !== 'EPSG:4326') {
      proj4.defs(resolved.proj, resolved.projDef);
    }

    const converter = resolved.proj !== 'EPSG:4326' ? proj4(resolved.proj, 'EPSG:4326') : null;
    const project = createProjector(converter, resolved.geoidOffset, resolved.zFactor);

    return new CopcDataSource(url, viewer, hierarchy, resolved, project);
  }

  get pixelSize(): number {
    return this._pixelSizeRef.value;
  }

  /** Updates the point size of already-loaded nodes in place — no reload needed. */
  set pixelSize(value: number) {
    this._pixelSizeRef.value = value;
    this._viewer.scene.requestRender();
  }

  get sseThreshold(): number {
    return this._options.sseThreshold;
  }

  /** Takes effect on the next LoD update — no reload needed. */
  set sseThreshold(value: number) {
    this._options.sseThreshold = value;
    this._viewer.scene.requestRender();
  }

  /** Runs on every `Scene.preRender`, throttled to `debounceMs`. */
  private _update(): void {
    if (this._destroyed) return;
    const now = performance.now();
    if (now - this._lastUpdateTime < this._options.debounceMs) return;
    this._lastUpdateTime = now;

    const selectedKeys = selectNodes({
      nodes: this._nodes,
      rootCenter: this._rootCenter,
      rootHalfSize: this._rootHalfSize,
      project: this._project,
      xyFactor: this._options.xyFactor,
      camera: this._viewer.scene.camera,
      viewportHeight: this._viewer.scene.canvas.clientHeight,
      sseThreshold: this._options.sseThreshold,
      maxVisibleNodes: this._options.maxVisibleNodes,
    });

    this._nodeCache.pin(new Set(selectedKeys));

    for (const key of selectedKeys) {
      if (this._nodeCache.get(key)) continue; // already loaded; the pin above protects it, get() bumps recency
      if (this._pendingKeys.has(key)) continue; // already in flight
      void this._loadNode(key);
    }
  }

  private async _loadNode(key: string): Promise<void> {
    this._pendingKeys.add(key);
    try {
      const payload: NodeConversionPayload = {
        url: this._url,
        copc: this._copc,
        // selectNodes() only ever returns keys it found present in this._nodes.
        node: this._nodes[key]!,
        proj: this._options.proj,
        projDef: this._options.projDef,
        geoidOffset: this._options.geoidOffset,
        zFactor: this._options.zFactor,
      };
      const renderData = await this._workerPool.run<NodeRenderData>(payload);
      if (this._destroyed) return;

      const boundingSphere = getNodeBoundingSphere(
        key,
        this._rootCenter,
        this._rootHalfSize,
        this._project,
        this._options.xyFactor,
      );
      const primitive = await createNodePrimitive(renderData, boundingSphere, this._pixelSizeRef);
      if (this._destroyed) {
        primitive.destroy();
        return;
      }
      this._viewer.scene.primitives.add(primitive);
      this._nodeCache.set(key, { key, primitive, pointCount: renderData.pointCount });
      // Newly-added primitives must be visible under `requestRenderMode: true`
      // (a no-op otherwise, since continuous rendering already re-draws every frame).
      this._viewer.scene.requestRender();
    } catch (err) {
      if (this._destroyed) return;
      console.error(`[CopcDataSource] Failed to load node "${key}":`, err);
    } finally {
      this._pendingKeys.delete(key);
    }
  }

  private _destroyLoadedNode(node: LoadedNode): void {
    this._viewer.scene.primitives.remove(node.primitive);
    this._viewer.scene.requestRender();
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._removeUpdateListener();
    this._workerPool.destroy();
    this._nodeCache.destroy();
  }
}
