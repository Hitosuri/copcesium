import * as Cesium from 'cesium';
import type { Hierarchy } from 'copc';
import { getChildKeys } from '../copc/node';
import { getCullingVolume, isInFrustum } from './boundingVolume';
import { computeScreenSpaceError } from './screenSpaceError';

// Camera.frustum is PerspectiveFrustum | PerspectiveOffCenterFrustum | OrthographicFrustum;
// only PerspectiveFrustum exposes fovy. The other two aren't used for this library's default
// scene setup, so we fall back to a typical 60° vertical FOV rather than threading an explicit
// fovy option through every call site.
const DEFAULT_FOVY = Cesium.Math.toRadians(60);

function getFovy(frustum: Cesium.Camera['frustum']): number {
  return (frustum instanceof Cesium.PerspectiveFrustum ? frustum.fovy : undefined) ?? DEFAULT_FOVY;
}

/**
 * Max-heap ordered by `score`. Expands the highest screen-space-error node
 * first, so once `maxVisibleNodes` is hit, the nodes that already made it
 * into `selected` are the most visually important ones found so far, rather
 * than whatever a FIFO traversal order happened to reach first — a plain
 * queue makes the budget cutoff arbitrary, and (worse) makes the exact same
 * on-screen region flicker in and out as camera noise reshuffles the
 * insertion order pass to pass.
 */
class MaxHeap<T> {
  private readonly data: T[] = [];

  constructor(private readonly score: (item: T) => number) {}

  get size(): number {
    return this.data.length;
  }

  push(item: T): void {
    const d = this.data;
    d.push(item);
    let i = d.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.score(d[parent]) >= this.score(d[i])) break;
      [d[parent], d[i]] = [d[i], d[parent]];
      i = parent;
    }
  }

  pop(): T | undefined {
    const d = this.data;
    if (d.length === 0) return undefined;
    const top = d[0];
    const last = d.pop()!;
    if (d.length > 0) {
      d[0] = last;
      let i = 0;
      const n = d.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let largest = i;
        if (l < n && this.score(d[l]) > this.score(d[largest])) largest = l;
        if (r < n && this.score(d[r]) > this.score(d[largest])) largest = r;
        if (largest === i) break;
        [d[i], d[largest]] = [d[largest], d[i]];
        i = largest;
      }
    }
    return top;
  }
}

export interface SelectNodesOptions {
  nodes: Hierarchy.Node.Map;
  /**
   * Returns (and, per the caller's discretion, caches) a node's bounding
   * sphere. Pulled out as a callback rather than raw ingredients
   * (rootCenter/rootHalfSize/project/xyFactor) so a caller can memoize per
   * key instead of recomputing a proj4 transform for every node on every
   * BFS pass.
   */
  getSphere: (key: string) => Cesium.BoundingSphere;
  camera: Cesium.Camera;
  viewportHeight: number;
  sseThreshold: number;
  maxVisibleNodes: number;
}

/**
 * Traverses the COPC octree starting at the root key ("0-0-0-0"), expanding
 * the highest screen-space-error node first, and returns the set of node
 * keys to render for the current camera view. A node is expanded into its
 * children when its projected screen-space error exceeds `sseThreshold` and
 * at least one child actually has data; otherwise the node itself is
 * selected. A node with zero points is never selected as a leaf — even below
 * the SSE threshold, it holds nothing to draw, so its children (if any) are
 * expanded instead. Nodes outside the view frustum are dropped along with
 * their whole subtree.
 */
export function selectNodes(options: SelectNodesOptions): string[] {
  const { nodes, getSphere, camera, viewportHeight, sseThreshold, maxVisibleNodes } = options;

  const cullingVolume = getCullingVolume(camera);
  const fovy = getFovy(camera.frustum);
  const selected: string[] = [];

  const sseOf = (key: string): number => computeScreenSpaceError(getSphere(key), camera.position, viewportHeight, fovy);

  const heap = new MaxHeap<{ key: string; sse: number }>((entry) => entry.sse);
  // The root's priority never matters — it's the only entry until popped.
  heap.push({ key: '0-0-0-0', sse: Infinity });

  while (heap.size > 0 && selected.length < maxVisibleNodes) {
    const { key } = heap.pop()!;
    const nodeInfo = nodes[key];
    if (!nodeInfo) continue;

    const sphere = getSphere(key);
    if (!isInFrustum(sphere, cullingVolume)) continue;

    const childKeys = getChildKeys(key).filter((childKey) => nodes[childKey]);

    if (nodeInfo.pointCount === 0) {
      // Nothing to draw here regardless of SSE — descend without selecting.
      for (const childKey of childKeys) {
        heap.push({ key: childKey, sse: sseOf(childKey) });
      }
      continue;
    }

    const sse = sseOf(key);
    if (sse > sseThreshold && childKeys.length > 0) {
      for (const childKey of childKeys) {
        heap.push({ key: childKey, sse: sseOf(childKey) });
      }
    } else {
      selected.push(key);
    }
  }

  return selected;
}
