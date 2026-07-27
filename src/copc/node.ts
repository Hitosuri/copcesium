/** COPC 계층 노드 키(VoxelKey, "D-X-Y-Z")에서 깊이(D)를 추출합니다. */
export function getDepth(key: string): number {
  return parseInt(key.split('-')[0]);
}

/**
 * 노드 키의 8개 자식 키를 반환합니다.
 * D-X-Y-Z → (D+1)-(2X+dx)-(2Y+dy)-(2Z+dz), dx/dy/dz ∈ {0,1}
 */
export function getChildKeys(key: string): string[] {
  const [d, x, y, z] = key.split('-').map(Number);
  const nd = d + 1,
    nx = x * 2,
    ny = y * 2,
    nz = z * 2;
  return [
    `${nd}-${nx}-${ny}-${nz}`,
    `${nd}-${nx + 1}-${ny}-${nz}`,
    `${nd}-${nx}-${ny + 1}-${nz}`,
    `${nd}-${nx + 1}-${ny + 1}-${nz}`,
    `${nd}-${nx}-${ny}-${nz + 1}`,
    `${nd}-${nx + 1}-${ny}-${nz + 1}`,
    `${nd}-${nx}-${ny + 1}-${nz + 1}`,
    `${nd}-${nx + 1}-${ny + 1}-${nz + 1}`,
  ];
}
