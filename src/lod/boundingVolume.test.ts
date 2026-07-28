import { describe, expect, it } from 'vitest';
import * as Cesium from 'cesium';
import { getNodeBoundingSphere, isInFrustum, type ProjectToCartesian } from './boundingVolume';

// Identity projection that passes coordinates straight through to Cartesian3 (verifies pure math, no CRS involved)
const identityProject: ProjectToCartesian = (x, y, z) => new Cesium.Cartesian3(x, y, z);

describe('getNodeBoundingSphere', () => {
  it('root node (0-0-0-0) has the same center as rootCenter and radius rootHalfSize*sqrt(3)', () => {
    const rootCenter = { x: 100, y: 200, z: 50 };
    const rootHalfSize = 10;

    const sphere = getNodeBoundingSphere('0-0-0-0', rootCenter, rootHalfSize, identityProject);

    expect(sphere.center.x).toBeCloseTo(100);
    expect(sphere.center.y).toBeCloseTo(200);
    expect(sphere.center.z).toBeCloseTo(50);
    expect(sphere.radius).toBeCloseTo(10 * Math.sqrt(3));
  });

  it('a child node has half the half-size and is offset to its octree octant position', () => {
    const rootCenter = { x: 0, y: 0, z: 0 };
    const rootHalfSize = 10;

    // level 1, x=1,y=0,z=0 → +x direction octant
    const sphere = getNodeBoundingSphere('1-1-0-0', rootCenter, rootHalfSize, identityProject);

    expect(sphere.center.x).toBeCloseTo(5);
    expect(sphere.center.y).toBeCloseTo(-5);
    expect(sphere.center.z).toBeCloseTo(-5);
    expect(sphere.radius).toBeCloseTo(5 * Math.sqrt(3));
  });

  it('xyFactor can convert the radius unit', () => {
    const sphere = getNodeBoundingSphere(
      '0-0-0-0',
      { x: 0, y: 0, z: 0 },
      10,
      identityProject,
      0.3048,
    );

    expect(sphere.radius).toBeCloseTo(10 * 0.3048 * Math.sqrt(3));
  });
});

describe('isInFrustum', () => {
  // 6-plane CullingVolume mimicking an axis-aligned box ([-10,10]^3), without a camera
  const boxCullingVolume = new Cesium.CullingVolume([
    new Cesium.Cartesian4(-1, 0, 0, 10), // x <= 10
    new Cesium.Cartesian4(1, 0, 0, 10), // x >= -10
    new Cesium.Cartesian4(0, -1, 0, 10), // y <= 10
    new Cesium.Cartesian4(0, 1, 0, 10), // y >= -10
    new Cesium.Cartesian4(0, 0, -1, 10), // z <= 10
    new Cesium.Cartesian4(0, 0, 1, 10), // z >= -10
  ]);

  it('a sphere inside the box returns true', () => {
    const sphere = new Cesium.BoundingSphere(new Cesium.Cartesian3(0, 0, 0), 1);

    expect(isInFrustum(sphere, boxCullingVolume)).toBe(true);
  });

  it('a sphere outside the box returns false', () => {
    const sphere = new Cesium.BoundingSphere(new Cesium.Cartesian3(20, 0, 0), 1);

    expect(isInFrustum(sphere, boxCullingVolume)).toBe(false);
  });
});
