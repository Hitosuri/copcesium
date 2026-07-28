import * as Cesium from 'cesium';

export type ProjectToCartesian = (x: number, y: number, z: number) => Cesium.Cartesian3;

export function getNodeBoundingSphere(
  key: string,
  rootCenter: { x: number; y: number; z: number },
  rootHalfSize: number,
  project: ProjectToCartesian,
  xyFactor = 1,
): Cesium.BoundingSphere {
  const [level, xi, yi, zi] = key.split('-').map(Number);
  const nodeHalfSize = rootHalfSize / Math.pow(2, level);

  const cx = rootCenter.x - rootHalfSize + (2 * xi + 1) * nodeHalfSize;
  const cy = rootCenter.y - rootHalfSize + (2 * yi + 1) * nodeHalfSize;
  const cz = rootCenter.z - rootHalfSize + (2 * zi + 1) * nodeHalfSize;

  const center = project(cx, cy, cz);
  const radius = nodeHalfSize * xyFactor * Math.sqrt(3);

  return new Cesium.BoundingSphere(center, radius);
}

export function getCullingVolume(camera: Cesium.Camera): Cesium.CullingVolume {
  return camera.frustum.computeCullingVolume(camera.position, camera.direction, camera.up);
}

export function isInFrustum(sphere: Cesium.BoundingSphere, cullingVolume: Cesium.CullingVolume): boolean {
  return cullingVolume.computeVisibility(sphere) !== Cesium.Intersect.OUTSIDE;
}
