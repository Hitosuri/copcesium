import * as Cesium from 'cesium';
import proj4 from 'proj4';
import type { Copc, Hierarchy } from 'copc';
import type { CopcDataSourceOptions, LoadedNode, NodeRenderData } from './types';
import { loadCopcHierarchy } from './copc/hierarchy';
import { detectCrs } from './crs/detectCrs';
import { createProjector } from './crs/project';
import { getCullingVolume, getNodeBoundingSphere, isInFrustum, type ProjectToCartesian } from './lod/boundingVolume';
import { selectNodes } from './lod/selectNodes';
import { createNodePrimitive } from './loader/loadNode';
import type { PointCloudPrimitive, Ref } from './renderer/PointCloudPrimitive';
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
  autoFrame: true,
};

export class CopcDataSource {
  private readonly _url: string;
  private readonly _viewer: Cesium.Viewer;
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
  private readonly _ownsPool: boolean;
  private readonly _pendingKeys = new Set<string>();
  private readonly _sphereCache = new Map<string, Cesium.BoundingSphere>();
  private _selectedKeys = new Set<string>();
  private _isUpdating = false;
  private _pendingUpdate = false;
  private _lastUpdateTime = 0;
  private _removeUpdateListener: () => void = () => {};
  private _removeMoveEndListener: () => void = () => {};
  private _destroyed = false;

  private constructor(
    url: string,
    viewer: Cesium.Viewer,
    hierarchy: Awaited<ReturnType<typeof loadCopcHierarchy>>,
    options: Required<CopcDataSourceOptions>,
    project: ProjectToCartesian,
    workerPool: WorkerPool,
    ownsPool: boolean,
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
    this._workerPool = workerPool;
    this._ownsPool = ownsPool;
  }

  /**
   * @param workerPool An externally-owned `WorkerPool` to reuse across data
   *   sources/reloads instead of spinning up (and wasm-recompiling) a fresh
   *   one. When provided, `options.concurrency` is ignored — the pool's own
   *   size wins. `destroy()` never tears down a pool it didn't create.
   */
  static async load(
    url: string,
    viewer: Cesium.Viewer,
    options: CopcDataSourceOptions = {},
    workerPool?: WorkerPool,
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

    const pool =
      workerPool ??
      new WorkerPool(() => new Worker(new URL('./worker/worker.ts', import.meta.url), { type: 'module' }), resolved.concurrency);

    const dataSource = new CopcDataSource(url, viewer, hierarchy, resolved, project, pool, !workerPool);

    // Deferred until after the initial camera framing (if any) so the fly-to
    // doesn't spend a debounce cycle computing LoD for wherever the camera
    // started, only to immediately redo it once framing completes.
    if (resolved.autoFrame) {
      await dataSource.zoomTo();
    }
    dataSource._startListening();

    return dataSource;
  }

  private _startListening(): void {
    this._removeUpdateListener = this._viewer.scene.preRender.addEventListener(() => this._onPreRender());
    this._removeMoveEndListener = this._viewer.scene.camera.moveEnd.addEventListener(() => this._onMoveEnd());
  }

  /** Flies the camera to the loaded dataset's root bounding sphere. */
  async zoomTo(): Promise<void> {
    const rootSphere = this._getSphere('0-0-0-0');
    const camera = this._viewer.scene.camera;
    const fovy =
      (camera.frustum instanceof Cesium.PerspectiveFrustum ? camera.frustum.fovy : undefined) ??
      Cesium.Math.toRadians(60);
    const sseScale = this._viewer.scene.canvas.clientHeight / (2 * Math.tan(fovy / 2));
    const initRange = (rootSphere.radius * sseScale) / (this._options.sseThreshold * 2);

    return new Promise<void>((resolve) => {
      camera.flyToBoundingSphere(rootSphere, {
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), initRange),
        complete: resolve,
      });
    });
  }

  private _getSphere(key: string): Cesium.BoundingSphere {
    let sphere = this._sphereCache.get(key);
    if (!sphere) {
      sphere = getNodeBoundingSphere(key, this._rootCenter, this._rootHalfSize, this._project, this._options.xyFactor);
      this._sphereCache.set(key, sphere);
    }
    return sphere;
  }

  /** Runs on every `Scene.preRender`: a cheap visibility pass every frame, an
   *  expensive LoD pass throttled to `debounceMs`. */
  private _onPreRender(): void {
    if (this._destroyed) return;
    this._updateVisibility();

    const now = performance.now();
    if (now - this._lastUpdateTime < this._options.debounceMs) return;
    this._lastUpdateTime = now;
    void this._updateLoD();
  }

  /** Camera has come to rest — run the LoD pass immediately rather than
   *  possibly losing the final refinement to debounce timing. */
  private _onMoveEnd(): void {
    if (this._destroyed) return;
    this._lastUpdateTime = performance.now();
    void this._updateLoD();
  }

  /** Cheap: re-tests the current selection's cached nodes against the live
   *  frustum and toggles `show` — no BFS, no allocation, no loading. Catches
   *  camera changes that happen between (throttled) `_updateLoD()` passes. */
  private _updateVisibility(): void {
    if (this._selectedKeys.size === 0) return;
    const cullingVolume = getCullingVolume(this._viewer.scene.camera);
    let changed = false;
    for (const key of this._selectedKeys) {
      const node = this._nodeCache.peek(key);
      if (!node) continue; // still loading
      const primitive = node.primitive as PointCloudPrimitive;
      const show = isInFrustum(this._getSphere(key), cullingVolume);
      if (primitive.show !== show) {
        primitive.show = show;
        changed = true;
      }
    }
    if (changed) this._viewer.scene.requestRender();
  }

  /** Expensive: BFS reselection, then reconciles the render set (`show`)
   *  against it and dispatches loads for anything newly selected but not yet
   *  cached. Cached-but-deselected nodes are hidden, not removed — eviction
   *  (and the actual scene removal that comes with it) stays NodeCache's job. */
  private async _updateLoD(): Promise<void> {
    if (this._destroyed) return;
    if (this._isUpdating) {
      this._pendingUpdate = true;
      return;
    }
    this._isUpdating = true;
    try {
      const newSelectedKeys = new Set(
        selectNodes({
          nodes: this._nodes,
          getSphere: (key) => this._getSphere(key),
          camera: this._viewer.scene.camera,
          viewportHeight: this._viewer.scene.canvas.clientHeight,
          sseThreshold: this._options.sseThreshold,
          maxVisibleNodes: this._options.maxVisibleNodes,
        }),
      );

      this._nodeCache.pin(newSelectedKeys);
      let sceneChanged = false;

      for (const key of this._selectedKeys) {
        if (newSelectedKeys.has(key)) continue;
        const node = this._nodeCache.peek(key);
        if (!node) continue;
        const primitive = node.primitive as PointCloudPrimitive;
        if (primitive.show) {
          primitive.show = false;
          sceneChanged = true;
        }
      }

      for (const key of newSelectedKeys) {
        const node = this._nodeCache.peek(key);
        if (node) {
          const primitive = node.primitive as PointCloudPrimitive;
          if (!primitive.show) {
            primitive.show = true;
            sceneChanged = true;
          }
          continue;
        }
        if (this._pendingKeys.has(key)) continue;
        void this._loadNode(key);
      }

      this._selectedKeys = newSelectedKeys;
      if (sceneChanged) this._viewer.scene.requestRender();
    } finally {
      this._isUpdating = false;
      if (this._pendingUpdate) {
        this._pendingUpdate = false;
        void this._updateLoD();
      }
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

      const boundingSphere = this._getSphere(key);
      const primitive = await createNodePrimitive(renderData, boundingSphere, this._pixelSizeRef);
      if (this._destroyed) {
        primitive.destroy();
        return;
      }
      // The selection may have moved on while this node was decoding; only
      // show it if it's still wanted, but keep it cached either way.
      primitive.show = this._selectedKeys.has(key);
      this._viewer.scene.primitives.add(primitive);
      this._nodeCache.set(key, { key, primitive, pointCount: renderData.pointCount });
      // Required under `requestRenderMode: true` for the new primitive to actually
      // appear; harmless (no-op) under continuous rendering otherwise.
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

  /** Point size in pixels, shared live by every loaded primitive (no reload needed). */
  get pixelSize(): number {
    return this._pixelSizeRef.value;
  }
  set pixelSize(value: number) {
    this._pixelSizeRef.value = value;
    this._viewer.scene.requestRender();
  }

  /** Screen-space error threshold (pixels) that triggers node subdivision. */
  get sseThreshold(): number {
    return this._options.sseThreshold;
  }
  set sseThreshold(value: number) {
    this._options.sseThreshold = value;
    void this._updateLoD();
  }

  /** Deepest octree level present in the loaded hierarchy. */
  get maxDepth(): number {
    return this._maxDepth;
  }

  /** Total number of nodes in the loaded hierarchy (loaded or not). */
  get nodeCount(): number {
    return Object.keys(this._nodes).length;
  }

  /** Number of nodes currently retained in the LRU cache. */
  get cacheSize(): number {
    return this._nodeCache.size;
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._removeUpdateListener();
    this._removeMoveEndListener();
    if (this._ownsPool) this._workerPool.destroy();
    this._nodeCache.destroy();
  }
}
