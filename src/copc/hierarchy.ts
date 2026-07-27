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
 * COPC 파일의 헤더/VLR 메타데이터와 루트 계층 페이지를 읽어 전체 노드 Map,
 * 최대 깊이, 루트 큐브(중심/반경)를 반환합니다.
 */
export async function loadCopcHierarchy(url: string): Promise<CopcHierarchy> {
  let copc: Copc;
  try {
    copc = await Copc.create(url);
  } catch (err) {
    const e = err as Error;
    if (/must be at least|Invalid header|COPC info VLR/i.test(e.message)) {
      throw new Error(
        `COPC 헤더를 읽을 수 없습니다. URL이 올바른지 또는 CORS 접근이 허용된지 확인하세요.\n원인: ${e.message}`,
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
