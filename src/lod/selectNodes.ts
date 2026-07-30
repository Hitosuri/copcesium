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
 * Breadth-first traversal of the COPC octree starting at the root key
 * ("0-0-0-0"), returning the set of node keys to render for the current
 * camera view. A node is expanded into its 8 children when its projected
 * screen-space error exceeds `sseThreshold` and at least one child actually
 * has data; otherwise the node itself is selected. Nodes outside the view
 * frustum are dropped along with their whole subtree.
 */
export function selectNodes(options: SelectNodesOptions): string[] {
  const { nodes, getSphere, camera, viewportHeight, sseThreshold, maxVisibleNodes } = options;

  const cullingVolume = getCullingVolume(camera);
  const selected: string[] = [];
  const queue: string[] = ['0-0-0-0'];

  while (queue.length > 0 && selected.length < maxVisibleNodes) {
    const key = queue.shift()!;
    if (!nodes[key]) continue;

    const sphere = getSphere(key);
    if (!isInFrustum(sphere, cullingVolume)) continue;

    const childKeys = getChildKeys(key);
    const existingChildKeys = childKeys.filter((childKey) => nodes[childKey]);

    const sse = computeScreenSpaceError(
      sphere,
      camera.position,
      viewportHeight,
      getFovy(camera.frustum),
    );
    if (sse > sseThreshold && existingChildKeys.length > 0) {
      queue.push(...existingChildKeys);
    } else {
      selected.push(key);
    }
  }

  return selected;
}
