import * as Cesium from 'cesium';
import { vertexShaderSource, fragmentShaderSource } from './shaders';
import type { NodeRenderData } from '../types';

/**
 * Style state shared live by every loaded primitive. Mutated in place by
 * `CopcDataSource`'s setters and read through each primitive's `uniformMap`,
 * so a style change is a uniform update on the next frame — no cache
 * invalidation, no refetch, no re-decode.
 */
export interface PointStyle {
  pixelSize: number;
  /** One of `COLOR_MODE`'s values. */
  colorMode: number;
  /** Raw LAS intensity units at the two ends of the intensity ramp. */
  intensityRange: Cesium.Cartesian2;
  /** The 256-bit classification allow-list, as the 2 ivec4s `buildClassMask` packs. */
  classMask: Cesium.Cartesian4[];
}

// Cesium's low-level GPU API (Buffer/VertexArray/ShaderProgram/DrawCommand) has no
// public type declarations, so only the members this file uses are declared here.
interface CesiumInternal {
  Buffer: {
    createVertexBuffer(opts: { context: unknown; typedArray: ArrayBufferView; usage: unknown }): unknown;
  };
  BufferUsage: { STATIC_DRAW: unknown };
  VertexArray: new (opts: { context: unknown; attributes: unknown[] }) => { destroy(): void };
  ShaderProgram: {
    fromCache(opts: {
      context: unknown;
      vertexShaderSource: string;
      fragmentShaderSource: string;
      attributeLocations: Record<string, number>;
    }): { destroy(): void };
  };
  DrawCommand: new (opts: Record<string, unknown>) => unknown;
  RenderState: { fromCache(opts: Record<string, unknown>): unknown };
  Pass: { OPAQUE: unknown };
  EncodedCartesian3: {
    encode(value: number, result: { high: number; low: number }): { high: number; low: number };
  };
}
const CesiumAny = Cesium as unknown as CesiumInternal;

/**
 * Splits ECEF positions into high/low Float32 pairs so the vertex shader can
 * reconstruct eye-relative coordinates without losing GPU float32 precision.
 */
export function splitPositions(positions: Float64Array): { posHigh: Float32Array; posLow: Float32Array } {
  const n = positions.length;
  const posHigh = new Float32Array(n);
  const posLow = new Float32Array(n);
  const encoded = { high: 0, low: 0 };
  for (let i = 0; i < n; i++) {
    CesiumAny.EncodedCartesian3.encode(positions[i], encoded);
    posHigh[i] = encoded.high;
    posLow[i] = encoded.low;
  }
  return { posHigh, posLow };
}

// Cesium.Primitive allocates a JS object per point; this DrawCommand-based
// wrapper instead uploads the node's TypedArrays as a single GPU buffer.
//
// GPU resources (VertexArray, ShaderProgram) are created lazily on the first
// update() call, since frameState.context is only available there.
export class PointCloudPrimitive {
  private _posHigh: Float32Array | null;
  private _posLow: Float32Array | null;
  private _colors: Uint8Array | null;
  private _intensities: Uint16Array | null;
  private _classifications: Uint8Array | null;
  private _elevations: Uint16Array | null;
  private _pointCount: number;
  private _boundingSphere: Cesium.BoundingSphere;
  private _style: PointStyle;
  public show: boolean;
  private _destroyed: boolean;
  private _cmd: unknown;
  private _va: { destroy(): void } | null;
  private _sp: { destroy(): void } | null;

  constructor(renderData: NodeRenderData, boundingSphere: Cesium.BoundingSphere, style: PointStyle) {
    const { posHigh, posLow } = splitPositions(renderData.positions);
    this._posHigh = posHigh;
    this._posLow = posLow;
    this._colors = renderData.colors;
    this._intensities = renderData.intensities;
    this._classifications = renderData.classifications;
    this._elevations = renderData.elevations;
    this._pointCount = renderData.pointCount;
    this._boundingSphere = boundingSphere;
    this._style = style;
    this.show = true;
    this._destroyed = false;
    this._cmd = null;
    this._va = null;
    this._sp = null;
  }

  // Called by PrimitiveCollection every frame.
  update(frameState: { context: unknown; commandList: unknown[] }): void {
    if (!this.show || this._destroyed) return;
    if (!this._cmd) {
      // A GPU init failure (context loss, out of VRAM, ...) must not throw here:
      // that would abort Cesium's whole frame loop. Skip just this node instead.
      try {
        this._initGpu(frameState.context);
      } catch (err) {
        console.error('[PointCloudPrimitive] GPU initialization failed; excluding this node from rendering:', err);
        this._destroyed = true;
        return;
      }
    }
    frameState.commandList.push(this._cmd);
  }

  private _initGpu(context: unknown): void {
    const mkVBuf = (arr: ArrayBufferView) =>
      CesiumAny.Buffer.createVertexBuffer({
        context,
        typedArray: arr,
        usage: CesiumAny.BufferUsage.STATIC_DRAW,
      });

    let va: { destroy(): void } | null = null;
    let sp: { destroy(): void } | null = null;
    try {
      va = new CesiumAny.VertexArray({
        context,
        attributes: [
          {
            index: 0, // position3DHigh
            vertexBuffer: mkVBuf(this._posHigh!),
            componentsPerAttribute: 3,
            componentDatatype: Cesium.ComponentDatatype.FLOAT,
            offsetInBytes: 0,
            strideInBytes: 12,
          },
          {
            index: 1, // position3DLow
            vertexBuffer: mkVBuf(this._posLow!),
            componentsPerAttribute: 3,
            componentDatatype: Cesium.ComponentDatatype.FLOAT,
            offsetInBytes: 0,
            strideInBytes: 12,
          },
          {
            index: 2, // color
            vertexBuffer: mkVBuf(this._colors!),
            componentsPerAttribute: 4,
            componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
            normalize: true,
            offsetInBytes: 0,
            strideInBytes: 4,
          },
          {
            index: 3, // intensity
            vertexBuffer: mkVBuf(this._intensities!),
            componentsPerAttribute: 1,
            componentDatatype: Cesium.ComponentDatatype.UNSIGNED_SHORT,
            normalize: true,
            offsetInBytes: 0,
            strideInBytes: 2,
          },
          {
            index: 4, // classification
            vertexBuffer: mkVBuf(this._classifications!),
            componentsPerAttribute: 1,
            componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
            normalize: true,
            offsetInBytes: 0,
            strideInBytes: 1,
          },
          {
            index: 5, // elevation
            vertexBuffer: mkVBuf(this._elevations!),
            componentsPerAttribute: 1,
            componentDatatype: Cesium.ComponentDatatype.UNSIGNED_SHORT,
            normalize: true,
            offsetInBytes: 0,
            strideInBytes: 2,
          },
        ],
      });

      const style = this._style;

      sp = CesiumAny.ShaderProgram.fromCache({
        context,
        vertexShaderSource,
        fragmentShaderSource,
        attributeLocations: {
          position3DHigh: 0,
          position3DLow: 1,
          color: 2,
          intensity: 3,
          classification: 4,
          elevation: 5,
        },
      });

      this._va = va;
      this._sp = sp;
      this._cmd = new CesiumAny.DrawCommand({
        vertexArray: va,
        primitiveType: Cesium.PrimitiveType.POINTS,
        shaderProgram: sp,
        renderState: CesiumAny.RenderState.fromCache({
          depthTest: { enabled: true },
          depthMask: true,
        }),
        boundingVolume: this._boundingSphere,
        count: this._pointCount,
        pass: CesiumAny.Pass.OPAQUE,
        modelMatrix: Cesium.Matrix4.IDENTITY,
        uniformMap: {
          u_pixelSize: () => style.pixelSize,
          u_colorMode: () => style.colorMode,
          u_intensityRange: () => style.intensityRange,
          u_classMask: () => style.classMask,
        },
      });
    } catch (err) {
      try {
        if (va) va.destroy();
      } catch {
        /* ignore */
      }
      try {
        if (sp) sp.destroy();
      } catch {
        /* ignore */
      }
      this._destroyed = true;
      throw err;
    }

    // CPU-side arrays are no longer needed once uploaded to the GPU. Every
    // style change is a uniform update, so nothing here has to be re-read.
    this._posHigh = null;
    this._posLow = null;
    this._colors = null;
    this._intensities = null;
    this._classifications = null;
    this._elevations = null;
  }

  /** The shared style object this primitive's uniforms read through. */
  get style(): PointStyle {
    return this._style;
  }

  isDestroyed(): boolean {
    return this._destroyed;
  }

  destroy(): void {
    if (!this._destroyed) {
      if (this._va) this._va.destroy();
      if (this._sp) this._sp.destroy();
      this._destroyed = true;
    }
    return Cesium.destroyObject(this);
  }
}
