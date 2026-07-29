import type { Viewer } from 'cesium';
import proj4 from 'proj4';
import type { Copc, Hierarchy } from 'copc';
import type { CopcDataSourceOptions } from './types';
import { loadCopcHierarchy } from './copc/hierarchy';
import { detectCrs } from './crs/detectCrs';

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
  private readonly _copc: Copc;
  private readonly _nodes: Hierarchy.Node.Map;
  private readonly _maxDepth: number;
  private readonly _rootCenter: { x: number; y: number; z: number };
  private readonly _rootHalfSize: number;
  private readonly _options: Required<CopcDataSourceOptions>;

  private constructor(
    hierarchy: Awaited<ReturnType<typeof loadCopcHierarchy>>,
    options: Required<CopcDataSourceOptions>,
  ) {
    this._copc = hierarchy.copc;
    this._nodes = hierarchy.nodes;
    this._maxDepth = hierarchy.maxDepth;
    this._rootCenter = hierarchy.rootCenter;
    this._rootHalfSize = hierarchy.rootHalfSize;
    this._options = options;
  }

  static async load(
    url: string,
    _viewer: Viewer,
    options: CopcDataSourceOptions = {},
  ): Promise<CopcDataSource> {
    const resolved: Required<CopcDataSourceOptions> = { ...DEFAULT_OPTIONS, ...options };

    const hierarchy = await loadCopcHierarchy(url);

    if (!resolved.projDef) {
      const detected = detectCrs(hierarchy.copc.wkt, url);
      if (detected) {
        resolved.proj = detected.proj;
        resolved.projDef = detected.projDef;
        // Detection only fills in a factor the user did not explicitly set —
        // check the raw `options` argument, not `resolved`, since `resolved`
        // already carries the (indistinguishable) default of 1.
        if (options.zFactor === undefined) resolved.zFactor = detected.zFactor;
        if (options.xyFactor === undefined) resolved.xyFactor = detected.xyFactor;
      }
    }
    if (resolved.projDef && resolved.proj !== 'EPSG:4326') {
      proj4.defs(resolved.proj, resolved.projDef);
    }

    return new CopcDataSource(hierarchy, resolved);
  }

  destroy(): void {
    // Clean up Worker/cache/scene resources here once they're added in Day 3.
  }
}
