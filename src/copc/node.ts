/** Extracts the depth (D) from a COPC hierarchy node key (VoxelKey, "D-X-Y-Z"). */
export function getDepth(key: string): number {
  return parseInt(key.split('-')[0]);
}

/**
 * Returns the parent key of a node key, or `null` for the root (depth 0).
 * D-X-Y-Z → (D-1)-(X>>1)-(Y>>1)-(Z>>1)
 */
export function getParentKey(key: string): string | null {
  const [d, x, y, z] = key.split('-').map(Number);
  if (d === 0) return null;
  return `${d - 1}-${x >> 1}-${y >> 1}-${z >> 1}`;
}

/**
 * Returns the 8 child keys of a node key.
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
