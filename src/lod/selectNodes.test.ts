import { describe, expect, it } from 'vitest';
import * as Cesium from 'cesium';
import type { Hierarchy } from 'copc';
import { selectNodes } from './selectNodes';
import { getNodeBoundingSphere, type ProjectToCartesian } from './boundingVolume';

// Identity projection that passes coordinates straight through to Cartesian3 (verifies pure math, no CRS involved)
const identityProject: ProjectToCartesian = (x, y, z) => new Cesium.Cartesian3(x, y, z);

// selectNodes() takes a getSphere callback (real callers memoize it); tests just wrap
// getNodeBoundingSphere directly since there's no caching behavior to verify here.
function makeGetSphere(rootCenter: { x: number; y: number; z: number }, rootHalfSize: number) {
  return (key: string): Cesium.BoundingSphere =>
    getNodeBoundingSphere(key, rootCenter, rootHalfSize, identityProject);
}

// A minimal mock octree: root (level 0) and its 8 children (level 1). Every key present in
// `nodes` is treated as "has data"; keys absent from the map are treated as empty octree cells.
function makeOneLevelOctree(): Hierarchy.Node.Map {
  const nodes: Hierarchy.Node.Map = {
    '0-0-0-0': { pointCount: 100, pointDataOffset: 0, pointDataLength: 1 },
  };
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) {
      for (let z = 0; z <= 1; z++) {
        nodes[`1-${x}-${y}-${z}`] = { pointCount: 10, pointDataOffset: 0, pointDataLength: 1 };
      }
    }
  }
  return nodes;
}

// Only the fields selectNodes/boundingVolume actually read (position, frustum, direction, up)
// are provided; a real Cesium.Camera needs a Scene and isn't constructible in a unit test.
function makeCamera(
  position: Cesium.Cartesian3,
  direction: Cesium.Cartesian3,
  up: Cesium.Cartesian3,
  fovyDegrees = 60,
): Cesium.Camera {
  return {
    position,
    direction,
    up,
    frustum: new Cesium.PerspectiveFrustum({
      fov: Cesium.Math.toRadians(fovyDegrees),
      aspectRatio: 1,
      near: 1,
      far: 1e9,
    }),
  } as unknown as Cesium.Camera;
}

const rootCenter = { x: 0, y: 0, z: 0 };
const rootHalfSize = 10;
// Looking straight down the -z axis at the octree centered on the origin.
const lookingAtOrigin = {
  direction: new Cesium.Cartesian3(0, 0, -1),
  up: new Cesium.Cartesian3(0, 1, 0),
};

describe('selectNodes', () => {
  it('selects only the root when it is far enough away that its SSE is below the threshold', () => {
    const nodes = makeOneLevelOctree();
    const camera = makeCamera(
      new Cesium.Cartesian3(0, 0, 100_000),
      lookingAtOrigin.direction,
      lookingAtOrigin.up,
    );

    const selected = selectNodes({
      nodes,
      getSphere: makeGetSphere(rootCenter, rootHalfSize),
      camera,
      viewportHeight: 1000,
      sseThreshold: 16,
      maxVisibleNodes: 100,
    });

    expect(selected).toEqual(['0-0-0-0']);
  });

  it('expands into the 8 children when close enough that the root SSE exceeds the threshold', () => {
    const nodes = makeOneLevelOctree();
    const camera = makeCamera(
      new Cesium.Cartesian3(0, 0, 30),
      lookingAtOrigin.direction,
      lookingAtOrigin.up,
    );

    const selected = selectNodes({
      nodes,
      getSphere: makeGetSphere(rootCenter, rootHalfSize),
      camera,
      viewportHeight: 1000,
      sseThreshold: 16,
      maxVisibleNodes: 100,
    });

    expect(selected).toHaveLength(8);
    expect(selected).not.toContain('0-0-0-0');
    expect(new Set(selected)).toEqual(
      new Set([
        '1-0-0-0',
        '1-0-0-1',
        '1-0-1-0',
        '1-0-1-1',
        '1-1-0-0',
        '1-1-0-1',
        '1-1-1-0',
        '1-1-1-1',
      ]),
    );
  });

  it('selects the root instead of expanding when none of its children have data', () => {
    const nodes: Hierarchy.Node.Map = {
      '0-0-0-0': { pointCount: 100, pointDataOffset: 0, pointDataLength: 1 },
    };
    const camera = makeCamera(
      new Cesium.Cartesian3(0, 0, 30),
      lookingAtOrigin.direction,
      lookingAtOrigin.up,
    );

    const selected = selectNodes({
      nodes,
      getSphere: makeGetSphere(rootCenter, rootHalfSize),
      camera,
      viewportHeight: 1000,
      sseThreshold: 16,
      maxVisibleNodes: 100,
    });

    expect(selected).toEqual(['0-0-0-0']);
  });

  it('stops the traversal once maxVisibleNodes is reached', () => {
    const nodes = makeOneLevelOctree();
    const camera = makeCamera(
      new Cesium.Cartesian3(0, 0, 30),
      lookingAtOrigin.direction,
      lookingAtOrigin.up,
    );

    const selected = selectNodes({
      nodes,
      getSphere: makeGetSphere(rootCenter, rootHalfSize),
      camera,
      viewportHeight: 1000,
      sseThreshold: 16,
      maxVisibleNodes: 3,
    });

    expect(selected).toHaveLength(3);
  });

  it('drops a node (and its subtree) that falls outside the view frustum', () => {
    const nodes = makeOneLevelOctree();
    // Positioned far along +x, looking further away along +x: the octree at the origin is behind the camera.
    const camera = makeCamera(
      new Cesium.Cartesian3(1_000_000, 0, 0),
      new Cesium.Cartesian3(1, 0, 0),
      new Cesium.Cartesian3(0, 1, 0),
      30,
    );

    const selected = selectNodes({
      nodes,
      getSphere: makeGetSphere(rootCenter, rootHalfSize),
      camera,
      viewportHeight: 1000,
      sseThreshold: 16,
      maxVisibleNodes: 100,
    });

    expect(selected).toEqual([]);
  });
});
