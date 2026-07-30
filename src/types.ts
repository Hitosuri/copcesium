/** Public options for CopcDataSource */
export interface CopcDataSourceOptions {
  proj?: string;
  projDef?: string | null;
  geoidOffset?: number;
  concurrency?: number;
  debounceMs?: number;
  maxCacheNodes?: number;
  maxVisibleNodes?: number;
  pixelSize?: number;
  sseThreshold?: number;
  /** Factor that converts the Z axis unit to meters. Auto-detected from the WKT when omitted. */
  zFactor?: number;
  /** Factor that converts the XY axis unit to meters. Auto-detected from the WKT when omitted. */
  xyFactor?: number;
  /** Whether `load()` flies the camera to the loaded dataset before resolving. Default true. */
  autoFrame?: boolean;
}

/** Result of auto-detecting a CRS from a WKT VLR */
export interface CrsDetectionResult {
  /** CRS name registered with proj4 (EPSG:xxxx or CRS:<url-based identifier>) */
  proj: string;
  /** Original definition string registered via proj4.defs (null for a geographic CRS) */
  projDef: string | null;
  /** Factor that converts the Z axis unit to meters */
  zFactor: number;
  /** Factor that converts the XY axis unit to meters */
  xyFactor: number;
}

/** A node's local-space (offset not applied) bounds — computed and consumed by teammate B's lod/boundingVolume.ts */
export interface NodeBounds {
  center: [number, number, number];
  halfSize: number;
}

/** Rendering-ready TypedArray buffers the Worker hands back to the main thread */
export interface NodeRenderData {
  positions: Float64Array;
  colors: Uint8Array;
  pointCount: number;
}

/** A node built into a Cesium Primitive, ready to be added to the Scene */
export interface LoadedNode {
  key: string;
  primitive: unknown;
  pointCount: number;
}
