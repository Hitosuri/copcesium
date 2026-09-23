/**
 * LoD stage. Walks the loaded octree on each (debounced) LoD pass, deciding
 * which nodes are visible and worth their screen-space error given the
 * current camera, and returns the set `CopcDataSource` should have loaded
 * and rendered next.
 */
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
   * Sub-page entry points not yet merged into `nodes`. A child key found
   * here instead of in `nodes` is a node whose subtree lives in a hierarchy
   * page that hasn't been loaded yet, not a childless node.
   */
  pages?: Hierarchy.Page.Map;
  /**
   * Called (possibly more than once per pass) with the key of a sub-page
   * whose subtree is needed but not yet loaded. The traversal doesn't wait
   * for it — the caller is expected to load it asynchronously and re-run
   * selection once it's merged into `nodes`.
   */
  onPageNeeded?: (key: string) => void;
  /**
   * Returns (and, per the caller's discretion, caches) a node's bounding
   * sphere. Pulled out as a callback rather than raw ingredients
   * (rootCenter/rootHalfSize/project/xyFactor) so a caller can memoize per
   * key instead of recomputing a proj4 transform for every node on every
   * selection pass.
   */
  getSphere: (key: string) => Cesium.BoundingSphere;
  camera: Cesium.Camera;
  viewportHeight: number;
  sseThreshold: number;
  maxVisibleNodes: number;
  /**
   * Bounds the render set by total point count across selected nodes, on top
   * of `maxVisibleNodes`. Node point counts vary widely across a hierarchy,
   * so `maxVisibleNodes` alone can't predict actual rendering cost (draw
   * calls, GPU memory, points on screen) across datasets with different
   * point densities per node; this bounds that directly. Defaults to
   * unlimited (`maxVisibleNodes` alone governs) when omitted.
   */
  maxPoints?: number;
}

/**
 * Traverses the COPC octree starting at the root key ("0-0-0-0"), expanding
 * the highest screen-space-error node first, and returns the set of node
 * keys to render for the current camera view.
 *
 * Every node the traversal visits is selected, not just the ones it stops at.
 * A COPC octree stores each point in exactly one node, so a node's points are
 * not a coarse copy of its children's — they are distinct points interleaved
 * through the same volume, and the cloud the user sees is the union of the
 * root down through the current cut. Selecting only the frontier would
 * silently drop everything held above it (19% of `autzen-classified`, 55% of
 * `redrocks.small`). A child is refined when its own projected screen-space
 * error reaches `sseThreshold` (Potree's rule, see `selectAcross`); children add detail on top of it
 * rather than replacing it.
 *
 * A node with zero points is never selected - it holds nothing to draw - but
 * is still expanded regardless of SSE so its populated children are reached.
 * Nodes outside the view frustum are dropped along with their whole subtree.
 *
 * `maxVisibleNodes` and `maxPoints` both bound the whole render set, ancestors
 * included, terminating on whichever limit is hit first. Since a parent is
 * always popped before its children are pushed, the budget can only ever cut
 * depth off the bottom, never leave a descendant selected without the
 * ancestors it sits on top of.
 */
export function selectNodes(options: SelectNodesOptions): string[] {
  const { nodes, pages = {}, onPageNeeded, getSphere, ...rest } = options;
  const tree: LodTree<string> = {
    root: '0-0-0-0',
    points: (key) => nodes[key]?.pointCount ?? 0,
    sphere: getSphere,
    children: (key) => getChildKeys(key).filter((child) => nodes[child]),
    subpages: (key) => getChildKeys(key).filter((child) => !nodes[child] && pages[child]),
    loadSubpage: (key) => onPageNeeded?.(key),
  };
  return selectAcross([tree], rest)[0] as string[];
}

export interface LodTree<N = unknown> {
  readonly root: N;
  points(node: N): number;
  sphere(node: N): Cesium.BoundingSphere;
  children(node: N): N[];
  /** Children whose subtree lives in a hierarchy page not loaded yet (COPC). */
  subpages?(node: N): N[];
  loadSubpage?(node: N): void;
}

export interface SelectAcrossOptions {
  camera: Cesium.Camera;
  viewportHeight: number;
  sseThreshold: number;
  maxVisibleNodes: number;
  maxPoints?: number;
}

/**
 * One priority queue over every tree's nodes, so several clouds share one budget the way
 * Potree's `updatePointClouds` does. Potree's rule: a child is refined only when its own
 * projected size reaches the threshold; a child holding the camera always is.
 */
export function selectAcross(trees: readonly LodTree[], options: SelectAcrossOptions): unknown[][] {
  const { camera, viewportHeight, sseThreshold, maxVisibleNodes, maxPoints = Infinity } = options;
  const cullingVolume = getCullingVolume(camera);
  const fovy = getFovy(camera.frustum);
  const selected = trees.map((): unknown[] => []);
  let count = 0;
  let pointsUsed = 0;

  // `positionWC`, not `position` - the latter is relative to `camera.transform`
  // and goes local the moment anything calls `camera.lookAt()`, which would
  // measure every node's screen-space error against the wrong viewpoint.
  const sseOf = (sphere: Cesium.BoundingSphere): number =>
    Cesium.Cartesian3.distance(sphere.center, camera.positionWC) < sphere.radius
      ? Infinity
      : computeScreenSpaceError(sphere, camera.positionWC, viewportHeight, fovy);

  const heap = new MaxHeap<{ tree: number; node: unknown; sse: number }>((entry) => entry.sse);
  trees.forEach((tree, i) => heap.push({ tree: i, node: tree.root, sse: Infinity }));

  while (heap.size > 0 && count < maxVisibleNodes && pointsUsed < maxPoints) {
    const { tree: i, node } = heap.pop()!;
    const tree = trees[i];
    if (!isInFrustum(tree.sphere(node), cullingVolume)) continue;

    const points = tree.points(node);
    if (points > 0) {
      selected[i].push(node);
      count++;
      pointsUsed += points;
    }

    // An empty node is descended through regardless of SSE - it contributes
    // nothing itself, so its populated children are the only way to fill the
    // volume it covers.
    const wanted = (sse: number) => points === 0 || sse >= sseThreshold;
    for (const child of tree.children(node)) {
      const sse = sseOf(tree.sphere(child));
      if (wanted(sse)) heap.push({ tree: i, node: child, sse });
    }
    for (const page of tree.subpages?.(node) ?? []) {
      if (wanted(sseOf(tree.sphere(page)))) tree.loadSubpage?.(page);
    }
  }

  return selected;
}
