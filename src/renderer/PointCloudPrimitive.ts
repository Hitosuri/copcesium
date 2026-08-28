/**
 * Rendering stage. Not a `Cesium.Primitive` subclass — a standalone class
 * built on Cesium's low-level DrawCommand API (custom vertex/fragment
 * shaders from `./shaders`) that uploads one loaded node's decoded points as
 * a single GPU buffer instead of the per-point JS objects `Cesium.Primitive`
 * would allocate. Exposes the live-tunable style uniforms (`pixelSize`,
 * `colorMode`, `opacity`, ...) that `CopcDataSource`'s setters mutate in
 * place.
 */
import * as Cesium from 'cesium';
import { vertexShaderSource, fragmentShaderSource } from './shaders';
import { SPLAT_ATTRIBUTE_LOCATIONS, type HqSplatRenderer } from './HqSplatRenderer';
import type { NodeRenderData } from '../types';
import type { VisibleNodesTexture } from './visibleNodes';

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
  /** Alpha multiplier applied to every point's colour, 0..1. */
  opacity: number;
  /**
   * Meters to shift every point along its node's local "up" (the ECEF
   * direction from Earth's center through the node origin), for correcting a
   * vertical-datum/geoid mismatch between the point cloud and the globe.
   * Applied to the model matrix, not the shader — points move, the geometry
   * doesn't need touching.
   */
  heightOffset: number;
  /** Meters along local east / north, same mechanism as `heightOffset`. */
  eastOffset: number;
  northOffset: number;
}

/** The ENU shift `style` puts on a point (or sphere) centred at `center`, as a world vector. */
export function offsetShift(
  center: Cesium.Cartesian3,
  style: Pick<PointStyle, 'eastOffset' | 'northOffset' | 'heightOffset'>,
  result = new Cesium.Cartesian3(),
): Cesium.Cartesian3 {
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  return Cesium.Matrix4.multiplyByPointAsVector(
    enu,
    new Cesium.Cartesian3(style.eastOffset, style.northOffset, style.heightOffset),
    result,
  );
}

function offsetKey(style: PointStyle): string {
  return `${style.eastOffset},${style.northOffset},${style.heightOffset}`;
}

// Cesium's low-level GPU API (Buffer/VertexArray/ShaderProgram/DrawCommand) has no
// public type declarations, so only the members this file uses are declared here.
interface CesiumInternal {
  Buffer: {
    createVertexBuffer(opts: {
      context: unknown;
      typedArray: ArrayBufferView;
      usage: unknown;
    }): unknown;
  };
  BufferUsage: { STATIC_DRAW: unknown };
  VertexArray: new (opts: { context: unknown; attributes: unknown[] }) => { destroy(): void };
  ShaderProgram: {
    fromCache(opts: {
      context: unknown;
      vertexShaderSource: string;
      fragmentShaderSource: unknown;
      attributeLocations: Record<string, number>;
    }): { destroy(): void };
  };
  ShaderSource: new (opts: { defines: string[]; sources: string[] }) => unknown;
  DrawCommand: new (opts: Record<string, unknown>) => unknown;
  RenderState: { fromCache(opts: Record<string, unknown>): unknown };
  Pass: { OPAQUE: unknown; TRANSLUCENT: unknown };
  BlendingState: { ALPHA_BLEND: unknown };
}
const CesiumAny = Cesium as unknown as CesiumInternal;

// The subset of a constructed DrawCommand's own fields (as opposed to its
// constructor options) this file mutates in place after construction.
interface DrawCommandLike {
  modelMatrix: Cesium.Matrix4;
  pass: unknown;
  renderState: unknown;
  framebuffer: unknown;
}

// Cesium.Primitive allocates a JS object per point; this DrawCommand-based
// wrapper instead uploads the node's TypedArrays as a single GPU buffer.
//
// GPU resources (VertexArray, ShaderProgram) are created lazily on the first
// update() call, since frameState.context is only available there.
export class PointCloudPrimitive {
  private _positions: Float32Array | null;
  private _origin: [number, number, number];
  private _appliedOffset: string;
  private _appliedOpaque: boolean;
  private _colors: Uint8Array | null;
  private _intensities: Uint16Array | null;
  private _classifications: Uint8Array | null;
  private _elevations: Uint16Array | null;
  private _localPositions: Uint16Array | null;
  private _hasLocalPositions = false;
  private _pointCount: number;
  private _boundingSphere: Cesium.BoundingSphere;
  private _style: PointStyle;
  public show: boolean;
  private _destroyed: boolean;
  private _cmd: DrawCommandLike | null;
  private _va: { destroy(): void } | null;
  private _sp: { destroy(): void } | null;
  /** Fired once, after the first successful `_initGpu()`, then dropped. */
  private _onGpuInit: ((startedAt: number, endedAt: number) => void) | null;
  /**
   * The spacing this node's points are drawn at, which is not its own spacing once its children
   * are on screen: a COPC node's points are interleaved through the same volume as its children's,
   * so as soon as a descendant is selected they sit at that finer spacing and drawing them any
   * fatter buries the detail underneath. Potree reads the same value per point from its
   * visible-nodes texture (`pointcloud.vs` `getLOD`); this is the per-node approximation.
   */
  nodeSpacing: number;
  /** This node's texel in `visibleNodes`; -1 sizes every point at `nodeSpacing`. */
  vnStart = -1;
  /** Takes precedence over the splat renderer's texture. */
  visibleNodes: VisibleNodesTexture | null = null;
  depth = 0;
  private readonly _splats: HqSplatRenderer | null;
  private _splatCommands: { depth: DrawCommandLike; attribute: DrawCommandLike } | null;

  constructor(
    renderData: NodeRenderData,
    boundingSphere: Cesium.BoundingSphere,
    style: PointStyle,
    onGpuInit?: (startedAt: number, endedAt: number) => void,
    nodeSpacing = 0,
    splats: HqSplatRenderer | null = null,
  ) {
    this._positions = renderData.positions;
    this._origin = renderData.origin;
    this._appliedOffset = '';
    this._appliedOpaque = true;
    this._colors = renderData.colors;
    this._intensities = renderData.intensities;
    this._classifications = renderData.classifications;
    this._elevations = renderData.elevations;
    this._localPositions = renderData.localPositions ?? null;
    this._pointCount = renderData.pointCount;
    this._boundingSphere = boundingSphere;
    this._style = style;
    this.show = true;
    this._destroyed = false;
    this._cmd = null;
    this._va = null;
    this._sp = null;
    this._onGpuInit = onGpuInit ?? null;
    this.nodeSpacing = nodeSpacing;
    this._splats = splats;
    this._splatCommands = null;
    splats?.add(this);
  }

  get boundingSphere(): Cesium.BoundingSphere {
    return this._boundingSphere;
  }

  get pointCount(): number {
    return this._pointCount;
  }

  // Called by PrimitiveCollection every frame.
  update(frameState: { context: unknown; commandList: unknown[] }): void {
    if (!this.show || this._destroyed || this._splats) return;
    if (!this._cmd) {
      // A GPU init failure (context loss, out of VRAM, ...) must not throw here:
      // that would abort Cesium's whole frame loop. Skip just this node instead.
      try {
        const startedAt = performance.now();
        this._initGpu(frameState.context);
        // Only on success: a node excluded below never reached the GPU, and
        // counting its failed attempt as an upload would skew the percentiles
        // with a number that measures an error path.
        this._onGpuInit?.(startedAt, performance.now());
        this._onGpuInit = null;
      } catch (err) {
        console.error(
          '[PointCloudPrimitive] GPU initialization failed; excluding this node from rendering:',
          err,
        );
        this._destroyed = true;
        return;
      }
    } else {
      // Cheap enough to compare every frame; the underlying rebuilds only
      // happen on the frames where the relevant style field actually changed.
      if (offsetKey(this._style) !== this._appliedOffset) {
        this._cmd.modelMatrix = this._modelMatrix();
        this._appliedOffset = offsetKey(this._style);
      }
      const opaque = this._style.opacity >= 1;
      if (opaque !== this._appliedOpaque) {
        this._cmd.pass = opaque ? CesiumAny.Pass.OPAQUE : CesiumAny.Pass.TRANSLUCENT;
        this._cmd.renderState = PointCloudPrimitive._renderState(opaque);
        this._appliedOpaque = opaque;
      }
    }
    frameState.commandList.push(this._cmd);
  }

  // RenderState.fromCache memoizes by contents, so this is cheap to call on
  // every opacity threshold crossing rather than caching the result here too.
  private static _renderState(opaque: boolean): unknown {
    return opaque
      ? CesiumAny.RenderState.fromCache({ depthTest: { enabled: true }, depthMask: true })
      : CesiumAny.RenderState.fromCache({
          depthTest: { enabled: true },
          depthMask: false,
          blending: CesiumAny.BlendingState.ALPHA_BLEND,
        });
  }

  /** Node origin shifted by the style's ENU offsets. */
  private _modelMatrix(): Cesium.Matrix4 {
    const origin = new Cesium.Cartesian3(this._origin[0], this._origin[1], this._origin[2]);
    const shift = offsetShift(origin, this._style);
    return Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.add(origin, shift, origin));
  }

  /**
   * The two draw commands `HqSplatRenderer` issues for this node. Null when the GPU upload
   * failed, in which case the node is excluded for good, as in `update()`.
   */
  splatCommands(
    context: unknown,
    renderer: HqSplatRenderer,
  ): { depth: unknown; attribute: unknown } | null {
    if (this._destroyed) return null;

    if (!this._splatCommands) {
      try {
        const startedAt = performance.now();
        this._va = this._createVertexArray(context);
        this._onGpuInit?.(startedAt, performance.now());
        this._onGpuInit = null;
      } catch (err) {
        console.error(
          '[PointCloudPrimitive] GPU initialization failed; excluding this node from rendering:',
          err,
        );
        this._destroyed = true;
        return null;
      }

      const style = this._style;
      const { depth, attribute } = renderer.shaderPrograms(context);
      const shared = {
        vertexArray: this._va,
        primitiveType: Cesium.PrimitiveType.POINTS,
        framebuffer: renderer.framebuffer,
        boundingVolume: this._boundingSphere,
        count: this._pointCount,
        pass: CesiumAny.Pass.OPAQUE,
        modelMatrix: this._modelMatrix(),
        owner: this,
        uniformMap: this._uniformMap(context),
      };

      this._splatCommands = {
        depth: new CesiumAny.DrawCommand({
          ...shared,
          shaderProgram: depth,
          renderState: renderer.depthRenderState,
        }) as DrawCommandLike,
        attribute: new CesiumAny.DrawCommand({
          ...shared,
          shaderProgram: attribute,
          renderState: renderer.attributeRenderState,
        }) as DrawCommandLike,
      };
      this._appliedOffset = offsetKey(style);
    }

    const commands = this._splatCommands;
    if (offsetKey(this._style) !== this._appliedOffset) {
      commands.depth.modelMatrix = this._modelMatrix();
      commands.attribute.modelMatrix = commands.depth.modelMatrix;
      this._appliedOffset = offsetKey(this._style);
    }
    // The renderer recreates its framebuffer on resize.
    commands.depth.framebuffer = renderer.framebuffer;
    commands.attribute.framebuffer = renderer.framebuffer;

    return commands;
  }

  private _initGpu(context: unknown): void {
    let va: { destroy(): void } | null = null;
    let sp: { destroy(): void } | null = null;
    try {
      va = this._createVertexArray(context);

      const style = this._style;

      sp = CesiumAny.ShaderProgram.fromCache({
        context,
        vertexShaderSource,
        fragmentShaderSource: new CesiumAny.ShaderSource({
          defines: ['LOG_DEPTH_READ_ONLY'],
          sources: [fragmentShaderSource],
        }),
        attributeLocations: SPLAT_ATTRIBUTE_LOCATIONS,
      });

      this._va = va;
      this._sp = sp;
      const opaque = style.opacity >= 1;
      this._cmd = new CesiumAny.DrawCommand({
        vertexArray: va,
        primitiveType: Cesium.PrimitiveType.POINTS,
        shaderProgram: sp,
        renderState: PointCloudPrimitive._renderState(opaque),
        boundingVolume: this._boundingSphere,
        count: this._pointCount,
        pass: opaque ? CesiumAny.Pass.OPAQUE : CesiumAny.Pass.TRANSLUCENT,
        // Carries the node origin (shifted by the live heightOffset) the
        // worker subtracted off; the vertex shader reconstructs absolute
        // ECEF from this plus the node-relative offsets.
        modelMatrix: this._modelMatrix(),
        uniformMap: this._uniformMap(context),
      }) as DrawCommandLike;
      this._appliedOffset = offsetKey(this._style);
      this._appliedOpaque = opaque;
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
  }

  private _uniformMap(context: unknown): Record<string, () => unknown> {
    const style = this._style;
    const { defaultTexture } = context as { defaultTexture: unknown };
    return {
      u_pixelSize: () => style.pixelSize,
      u_nodeSpacing: () => this.nodeSpacing,
      u_visibleNodes: () =>
        (this.visibleNodes ?? this._splats?.visibleNodes)?.get(context) ?? defaultTexture,
      u_vnStart: () => (this._hasLocalPositions ? this.vnStart : -1),
      u_colorMode: () => style.colorMode,
      u_intensityRange: () => style.intensityRange,
      u_classMask: () => style.classMask,
      u_opacity: () => style.opacity,
    };
  }

  /** Uploads the node's arrays and drops the CPU copies; every later change is a uniform. */
  private _createVertexArray(context: unknown): { destroy(): void } {
    const mkVBuf = (arr: ArrayBufferView) =>
      CesiumAny.Buffer.createVertexBuffer({
        context,
        typedArray: arr,
        usage: CesiumAny.BufferUsage.STATIC_DRAW,
      });

    const va = new CesiumAny.VertexArray({
      context,
      attributes: [
        {
          index: 0, // position (node-relative offset)
          vertexBuffer: mkVBuf(this._positions!),
          componentsPerAttribute: 3,
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
          offsetInBytes: 0,
          strideInBytes: 12,
        },
        {
          index: 1, // color
          vertexBuffer: mkVBuf(this._colors!),
          componentsPerAttribute: 4,
          componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
          normalize: true,
          offsetInBytes: 0,
          strideInBytes: 4,
        },
        {
          index: 2, // intensity
          vertexBuffer: mkVBuf(this._intensities!),
          componentsPerAttribute: 1,
          componentDatatype: Cesium.ComponentDatatype.UNSIGNED_SHORT,
          normalize: true,
          offsetInBytes: 0,
          strideInBytes: 2,
        },
        {
          index: 3, // classification
          vertexBuffer: mkVBuf(this._classifications!),
          componentsPerAttribute: 1,
          componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
          normalize: true,
          offsetInBytes: 0,
          strideInBytes: 1,
        },
        {
          index: 4, // elevation
          vertexBuffer: mkVBuf(this._elevations!),
          componentsPerAttribute: 1,
          componentDatatype: Cesium.ComponentDatatype.UNSIGNED_SHORT,
          normalize: true,
          offsetInBytes: 0,
          strideInBytes: 2,
        },
        {
          index: 5, // localPos
          vertexBuffer: mkVBuf(this._localPositions ?? new Uint16Array(this._pointCount * 3)),
          componentsPerAttribute: 3,
          componentDatatype: Cesium.ComponentDatatype.UNSIGNED_SHORT,
          normalize: true,
          offsetInBytes: 0,
          strideInBytes: 6,
        },
      ],
    });

    this._hasLocalPositions = this._localPositions !== null;
    this._positions = null;
    this._colors = null;
    this._intensities = null;
    this._classifications = null;
    this._elevations = null;
    this._localPositions = null;

    return va;
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
    this._splats?.remove(this);
    return Cesium.destroyObject(this);
  }
}
