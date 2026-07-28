import { Copc } from 'copc';
import type { Hierarchy } from 'copc';
import { getDepth } from './node';

export interface CopcHierarchy {
  copc: Copc;
  nodes: Hierarchy.Node.Map;
  maxDepth: number;
  rootCenter: { x: number; y: number; z: number };
  rootHalfSize: number;
}

/**
 * Reads a COPC file's header/VLR metadata and its root hierarchy page, and
 * returns the full node map, the max depth, and the root cube (center/half size).
 */
export async function loadCopcHierarchy(url: string): Promise<CopcHierarchy> {
  let copc: Copc;
  try {
    copc = await Copc.create(url);
  } catch (err) {
    const e = err as Error;
    if (/must be at least|Invalid header|COPC info VLR/i.test(e.message)) {
      throw new Error(
        `Failed to read the COPC header. Check that the URL is correct and that CORS access is allowed.\nCause: ${e.message}`,
        { cause: err },
      );
    }
    throw err;
  }

  const [minx, miny, minz, maxx, maxy, maxz] = copc.info.cube;
  const rootCenter = { x: (minx + maxx) / 2, y: (miny + maxy) / 2, z: (minz + maxz) / 2 };
  const rootHalfSize = (maxx - minx) / 2;

  const { nodes } = await Copc.loadHierarchyPage(url, copc.info.rootHierarchyPage);
  const maxDepth = Math.max(...Object.keys(nodes).map(getDepth));

  return { copc, nodes, maxDepth, rootCenter, rootHalfSize };
}
