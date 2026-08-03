/**
 * How a point's colour is chosen.
 *
 * `'rgb'` uses the file's own colour, falling back per point to the
 * classification palette and then to flat grey when the file carries no
 * Red/Green/Blue — this is the historical (and default) behaviour.
 * `'classification'` applies the palette unconditionally, so it works on a
 * file that *does* have RGB too.
 */
export type ColorMode = 'rgb' | 'intensity' | 'classification' | 'elevation';

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
  /** How points are coloured. Default `'rgb'`. Switching costs no refetch. */
  colorMode?: ColorMode;
  /**
   * Classification codes (0-255) to draw; every other point is dropped in the
   * vertex shader. Omit to draw everything.
   */
  classificationFilter?: number[];
  /**
   * Raw LAS intensity values mapped to the two ends of the `'intensity'` ramp.
   * Omitted, the range grows to `[0, highest intensity seen so far]` as nodes
   * stream in — LAS producers rarely use the full 16-bit span, so a fixed
   * 0-65535 mapping would render most files nearly black.
   */
  intensityRange?: [number, number];
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

/**
 * Rendering-ready TypedArray buffers the Worker hands back to the main thread.
 *
 * `colors` stays baked (RGB, else the classification palette, else grey) so
 * `colorMode: 'rgb'` costs nothing on the GPU; the other three modes are
 * computed in the vertex shader from the raw attributes below, which is what
 * lets a mode change be a uniform update rather than a re-decode.
 */
export interface NodeRenderData {
  positions: Float64Array;
  colors: Uint8Array;
  /** Raw LAS `Intensity`, or all zeroes when the file has no such dimension. */
  intensities: Uint16Array;
  /** Raw LAS `Classification`, or all zeroes when the file has no such dimension. */
  classifications: Uint8Array;
  /**
   * Point Z normalized over the file header's full Z range, so the elevation
   * ramp needs no uniform and costs 2 bytes per point instead of a full
   * float. Zero throughout when the header reports a flat dataset.
   */
  elevations: Uint16Array;
  pointCount: number;
  /** Highest raw `Intensity` in this node; feeds the auto `intensityRange`. */
  maxIntensity: number;
}

/** A node built into a Cesium Primitive, ready to be added to the Scene */
export interface LoadedNode {
  key: string;
  primitive: unknown;
  pointCount: number;
}
