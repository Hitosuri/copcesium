import * as Cesium from 'cesium';
import { compositeFragmentShaderSource, fragmentShaderSource, vertexShaderSource } from './shaders';
import type { PointCloudPrimitive } from './PointCloudPrimitive';
import { VisibleNodesTexture } from './visibleNodes';

// Cesium's renderer internals have no public type declarations; only the
// members this file uses are declared here.
interface CesiumInternal {
  ClearCommand: new (opts: Record<string, unknown>) => Command;
  Framebuffer: new (opts: Record<string, unknown>) => Destroyable;
  Pass: { OPAQUE: unknown };
  RenderState: { fromCache(opts: Record<string, unknown>): unknown };
  Sampler: new (opts: Record<string, unknown>) => unknown;
  ShaderProgram: {
    fromCache(opts: {
      context: unknown;
      vertexShaderSource: unknown;
      fragmentShaderSource: unknown;
      attributeLocations: Record<string, number>;
    }): Destroyable;
  };
  ShaderSource: new (opts: { defines: string[]; sources: string[] }) => unknown;
  Texture: new (opts: Record<string, unknown>) => Destroyable;
  TextureMagnificationFilter: { NEAREST: unknown };
  TextureMinificationFilter: { NEAREST: unknown };
  BlendEquation: { ADD: unknown };
  BlendFunction: { SOURCE_ALPHA: unknown; ONE: unknown };
}
const CesiumAny = Cesium as unknown as CesiumInternal;

interface Destroyable {
  destroy(): void;
}

interface Command {
  boundingVolume?: Cesium.BoundingSphere;
  pass: unknown;
}

interface Context {
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  depthTexture: boolean;
  colorBufferFloat: boolean;
  colorBufferHalfFloat: boolean;
  createViewportQuadCommand(
    fragmentShaderSource: unknown,
    overrides: Record<string, unknown>,
  ): Command;
}

export interface SplatFrameState {
  context: unknown;
  commandList: unknown[];
  passes: { render: boolean };
}

export const SPLAT_ATTRIBUTE_LOCATIONS = {
  position: 0,
  color: 1,
  intensity: 2,
  classification: 3,
  elevation: 4,
  localPos: 5,
};

/**
 * Potree's HQ splatting (`HQSplatRenderer.js`) on Cesium draw commands: every node is drawn twice
 * into a private framebuffer - a depth pass that writes each splat's depth pushed back by two
 * radii, then an additive pass that depth-tests against it and accumulates falloff-weighted
 * colour - and a viewport quad divides the sum back out into the scene, carrying the depth along.
 *
 * Meant for `scene.logarithmicDepthBuffer = true` (the default), which is a single depth frustum.
 * Without it Cesium splits the scene into depth slabs and the pushed-back splats straddle the
 * seams.
 */
export class HqSplatRenderer {
  readonly depthShaderProgram = new Map<unknown, Destroyable>();
  readonly attributeShaderProgram = new Map<unknown, Destroyable>();
  readonly depthRenderState = CesiumAny.RenderState.fromCache({
    depthTest: { enabled: true },
    depthMask: true,
    colorMask: { red: false, green: false, blue: false, alpha: false },
  });
  readonly attributeRenderState = CesiumAny.RenderState.fromCache({
    depthTest: { enabled: true },
    depthMask: false,
    blending: {
      enabled: true,
      equationRgb: CesiumAny.BlendEquation.ADD,
      equationAlpha: CesiumAny.BlendEquation.ADD,
      functionSourceRgb: CesiumAny.BlendFunction.SOURCE_ALPHA,
      functionSourceAlpha: CesiumAny.BlendFunction.SOURCE_ALPHA,
      functionDestinationRgb: CesiumAny.BlendFunction.ONE,
      functionDestinationAlpha: CesiumAny.BlendFunction.ONE,
    },
  });

  /** What the last frame drew. */
  readonly stats = { nodes: 0, points: 0, byDepth: [] as { nodes: number; points: number }[] };

  /** Eye-dome lighting (potree's defaults). `strength` 0 turns it off. */
  readonly edl = { strength: 0, radius: 1.4 };

  show = true;

  readonly visibleNodes = new VisibleNodesTexture();

  private readonly _nodes = new Set<PointCloudPrimitive>();
  private _framebuffer: Destroyable | null = null;
  private _color: Destroyable | null = null;
  private _depth: Destroyable | null = null;
  private _width = 0;
  private _height = 0;
  private _clear: Command | null = null;
  private _composite: Command | null = null;
  private _destroyed = false;

  get framebuffer(): unknown {
    return this._framebuffer;
  }

  add(node: PointCloudPrimitive): void {
    this._nodes.add(node);
  }

  remove(node: PointCloudPrimitive): void {
    this._nodes.delete(node);
  }

  shaderPrograms(context: unknown): { depth: Destroyable; attribute: Destroyable } {
    let depth = this.depthShaderProgram.get(context);
    let attribute = this.attributeShaderProgram.get(context);

    if (!depth) {
      depth = CesiumAny.ShaderProgram.fromCache({
        context,
        vertexShaderSource: new CesiumAny.ShaderSource({
          defines: ['HQ_DEPTH_PASS'],
          sources: [vertexShaderSource],
        }),
        fragmentShaderSource: new CesiumAny.ShaderSource({
          defines: ['LOG_DEPTH_READ_ONLY'],
          sources: [fragmentShaderSource],
        }),
        attributeLocations: SPLAT_ATTRIBUTE_LOCATIONS,
      });
      this.depthShaderProgram.set(context, depth);
    }

    if (!attribute) {
      attribute = CesiumAny.ShaderProgram.fromCache({
        context,
        vertexShaderSource,
        fragmentShaderSource: new CesiumAny.ShaderSource({
          defines: ['HQ_WEIGHTED', 'LOG_DEPTH_READ_ONLY'],
          sources: [fragmentShaderSource],
        }),
        attributeLocations: SPLAT_ATTRIBUTE_LOCATIONS,
      });
      this.attributeShaderProgram.set(context, attribute);
    }

    return { depth, attribute };
  }

  // Called by PrimitiveCollection every frame.
  update(frameState: SplatFrameState): void {
    if (this._destroyed || !this.show || !frameState.passes.render) return;

    const context = frameState.context as Context;
    const shown: PointCloudPrimitive[] = [];
    for (const node of this._nodes) {
      if (node.show && !node.isDestroyed()) shown.push(node);
    }
    if (shown.length === 0) return;

    this._ensureTargets(context);

    const spheres: Cesium.BoundingSphere[] = [];
    const depthCommands: unknown[] = [];
    const attributeCommands: unknown[] = [];
    let points = 0;
    const byDepth: { nodes: number; points: number }[] = [];

    for (const node of shown) {
      const commands = node.splatCommands(context, this);
      if (!commands) continue;

      depthCommands.push(commands.depth);
      attributeCommands.push(commands.attribute);
      spheres.push(node.boundingSphere);
      points += node.pointCount;
      const bucket = (byDepth[node.depth] ??= { nodes: 0, points: 0 });
      bucket.nodes++;
      bucket.points += node.pointCount;
    }

    this.stats.nodes = depthCommands.length;
    this.stats.points = points;
    this.stats.byDepth = byDepth;
    if (depthCommands.length === 0) return;

    const bounds = Cesium.BoundingSphere.fromBoundingSpheres(spheres);
    this._clear!.boundingVolume = bounds;
    this._composite!.boundingVolume = bounds;

    frameState.commandList.push(
      this._clear,
      ...depthCommands,
      ...attributeCommands,
      this._composite,
    );
  }

  private _ensureTargets(context: Context): void {
    const width = context.drawingBufferWidth;
    const height = context.drawingBufferHeight;
    if (this._framebuffer && width === this._width && height === this._height) return;

    this._destroyTargets();
    this._width = width;
    this._height = height;

    const sampler = new CesiumAny.Sampler({
      minificationFilter: CesiumAny.TextureMinificationFilter.NEAREST,
      magnificationFilter: CesiumAny.TextureMagnificationFilter.NEAREST,
    });
    // Weights sum well past 1, so the accumulation target has to be float
    // where the context can render into one; half float's 65504 ceiling is
    // well above any pixel's weight sum.
    const pixelDatatype = context.colorBufferHalfFloat
      ? Cesium.PixelDatatype.HALF_FLOAT
      : context.colorBufferFloat
        ? Cesium.PixelDatatype.FLOAT
        : Cesium.PixelDatatype.UNSIGNED_BYTE;

    this._color = new CesiumAny.Texture({
      context,
      width,
      height,
      pixelFormat: Cesium.PixelFormat.RGBA,
      pixelDatatype,
      sampler,
    });
    this._depth = new CesiumAny.Texture({
      context,
      width,
      height,
      pixelFormat: Cesium.PixelFormat.DEPTH_COMPONENT,
      pixelDatatype: Cesium.PixelDatatype.UNSIGNED_INT,
      sampler,
    });
    this._framebuffer = new CesiumAny.Framebuffer({
      context,
      colorTextures: [this._color],
      depthTexture: this._depth,
      destroyAttachments: false,
    });

    this._clear = new CesiumAny.ClearCommand({
      color: new Cesium.Color(0, 0, 0, 0),
      depth: 1,
      framebuffer: this._framebuffer,
      pass: CesiumAny.Pass.OPAQUE,
      owner: this,
    });

    // The point vertex shader already encodes log depth, so the depth texture
    // holds final values; LOG_DEPTH_READ_ONLY stops Cesium from injecting a
    // second write over the composite's pass-through.
    const compositeSource = new CesiumAny.ShaderSource({
      defines: ['LOG_DEPTH_READ_ONLY'],
      sources: [compositeFragmentShaderSource],
    });
    this._composite = context.createViewportQuadCommand(compositeSource, {
      renderState: CesiumAny.RenderState.fromCache({
        depthTest: { enabled: true },
        depthMask: true,
      }),
      uniformMap: {
        u_splatColor: () => this._color,
        u_splatDepth: () => this._depth,
        u_edlStrength: () => this.edl.strength,
        u_edlRadius: () => this.edl.radius,
      },
      owner: this,
    });
    this._composite.pass = CesiumAny.Pass.OPAQUE;
  }

  private _destroyTargets(): void {
    this._framebuffer?.destroy();
    this._color?.destroy();
    this._depth?.destroy();
    this._framebuffer = this._color = this._depth = null;
    this._clear = this._composite = null;
  }

  isDestroyed(): boolean {
    return this._destroyed;
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._destroyTargets();
    this.visibleNodes.destroy();
    for (const sp of this.depthShaderProgram.values()) sp.destroy();
    for (const sp of this.attributeShaderProgram.values()) sp.destroy();
    this._nodes.clear();
    Cesium.destroyObject(this);
  }
}
