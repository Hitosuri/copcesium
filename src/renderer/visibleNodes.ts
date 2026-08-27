/**
 * potree's visible-nodes texture (`PointCloudOctree.computeVisibilityTextureData`): one RGBA8
 * texel per drawn node in level order, R = mask of drawn children, G*256+B = offset from the
 * node's texel to its first drawn child. The vertex shader walks it from a point's own node
 * through the point's octants to find the deepest drawn node that still contains the point.
 */
import * as Cesium from 'cesium';

interface CesiumInternal {
  Sampler: new (opts: Record<string, unknown>) => unknown;
  Texture: new (opts: Record<string, unknown>) => Texture;
  TextureMagnificationFilter: { NEAREST: unknown };
  TextureMinificationFilter: { NEAREST: unknown };
}
const CesiumAny = Cesium as unknown as CesiumInternal;

interface Texture {
  copyFrom(opts: { source: TextureSource }): void;
  destroy(): void;
}

interface TextureSource {
  width: number;
  height: number;
  arrayBufferView: ArrayBufferView;
}

export const VISIBLE_NODES_WIDTH = 2048;
export const VISIBLE_NODES_MAX_WALK = 16;

export interface VisibleNode {
  /** Octree path from the root, one octant digit (0-7) per level; `''` is the root. */
  path: string;
  level: number;
}

export interface VisibleNodesData {
  texels: Uint8Array;
  /** Texel index per node path, the primitive's `vnStart`. */
  offsets: Map<string, number>;
}

/** GPU side of `encodeVisibleNodes`: the 2048x1 RGBA8 texture the vertex shader walks. */
export class VisibleNodesTexture {
  private _texels: Uint8Array | null = null;
  private _dirty = false;
  private _texture: Texture | null = null;

  set texels(texels: Uint8Array) {
    this._texels = texels;
    this._dirty = true;
  }

  get(context: unknown): unknown {
    if (this._dirty && this._texels) {
      this._dirty = false;
      const source: TextureSource = { width: VISIBLE_NODES_WIDTH, height: 1, arrayBufferView: this._texels };
      if (this._texture) {
        this._texture.copyFrom({ source });
      } else {
        this._texture = new CesiumAny.Texture({
          context,
          pixelFormat: Cesium.PixelFormat.RGBA,
          pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
          source,
          sampler: new CesiumAny.Sampler({
            minificationFilter: CesiumAny.TextureMinificationFilter.NEAREST,
            magnificationFilter: CesiumAny.TextureMagnificationFilter.NEAREST,
          }),
        });
      }
    }
    return this._texture;
  }

  destroy(): void {
    this._texture?.destroy();
    this._texture = null;
  }
}

export function encodeVisibleNodes(nodes: Iterable<VisibleNode>): VisibleNodesData {
  const sorted = [...nodes].sort(
    (a, b) => a.level - b.level || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  if (sorted.length > VISIBLE_NODES_WIDTH) {
    console.warn(
      `[visibleNodes] ${sorted.length} drawn nodes exceed the ${VISIBLE_NODES_WIDTH}-texel texture; the rest size per node`,
    );
    sorted.length = VISIBLE_NODES_WIDTH;
  }

  const texels = new Uint8Array(VISIBLE_NODES_WIDTH * 4);
  const offsets = new Map<string, number>();
  sorted.forEach((node, i) => offsets.set(node.path, i));

  sorted.forEach((node, i) => {
    if (node.path === '') return;
    const parent = offsets.get(node.path.slice(0, -1));
    if (parent === undefined) return;

    const octant = Number(node.path[node.path.length - 1]);
    const base = parent * 4;
    const first = texels[base + 1] * 256 + texels[base + 2];
    const offset = texels[base] === 0 ? i - parent : Math.min(first, i - parent);
    texels[base] |= 1 << octant;
    texels[base + 1] = offset >> 8;
    texels[base + 2] = offset & 255;
  });

  return { texels, offsets };
}
