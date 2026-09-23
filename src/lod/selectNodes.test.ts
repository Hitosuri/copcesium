import { describe, expect, it } from 'vitest';
import * as Cesium from 'cesium';
import type { Hierarchy } from 'copc';
import { selectAcross, selectNodes, type LodTree } from './selectNodes';
import { getChildKeys } from '../copc/node';
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

// Only the fields selectNodes/boundingVolume actually read are provided; a real
// Cesium.Camera needs a Scene and isn't constructible in a unit test.
//
// Both the plain and `WC` vectors are set, and to the same values: on a real
// camera they diverge only once `camera.transform` stops being the identity
// (after `lookAt()`), and the library reads the `WC` ones precisely so that
// case keeps working. Setting both keeps this fake honest about which names
// exist rather than encoding the library's current choice.
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
    positionWC: position,
    directionWC: direction,
    upWC: up,
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

  it('keeps the root alongside its 8 children when the root SSE exceeds the threshold', () => {
    // Regression test for #76: a COPC octree stores each point in exactly one
    // node, so the root's points are not a coarse copy of the children's —
    // dropping the root once it expands throws those points away for good.
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

    expect(selected).toHaveLength(9);
    expect(selected).toContain('0-0-0-0');
    expect(new Set(selected)).toEqual(
      new Set([
        '0-0-0-0',
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

  it('selects an ancestor before any of its descendants, so the budget only ever cuts depth', () => {
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

    // A parent is popped (and selected) before its children are ever pushed,
    // so no descendant can appear without the ancestors it draws on top of.
    for (const key of selected) {
      if (key !== '0-0-0-0') expect(selected.indexOf('0-0-0-0')).toBeLessThan(selected.indexOf(key));
    }
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

  it('descends into children instead of selecting a node with zero points, even below the SSE threshold', () => {
    const nodes = makeOneLevelOctree();
    nodes['0-0-0-0'] = { pointCount: 0, pointDataOffset: 0, pointDataLength: 0 };
    const camera = makeCamera(
      new Cesium.Cartesian3(0, 0, 100_000), // far enough that SSE is well below threshold
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

    // The root itself holds no points, so it must never appear in the
    // selection regardless of SSE; its 8 populated children stand in for it.
    expect(selected).not.toContain('0-0-0-0');
    expect(selected).toHaveLength(8);
  });

  it('drops a zero-point node with no populated children entirely, rather than selecting an empty leaf', () => {
    const nodes: Hierarchy.Node.Map = {
      '0-0-0-0': { pointCount: 0, pointDataOffset: 0, pointDataLength: 0 },
    };
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

    expect(selected).toEqual([]);
  });

  it('keeps the higher-screen-space-error nodes when maxVisibleNodes truncates the selection', () => {
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
      maxVisibleNodes: 4,
    });

    // The root is popped first and always makes the cut, so it takes one slot.
    // Of the children, those at z=+5 (zi=1) sit closer to the camera at z=30
    // than those at z=-5 (zi=0), so they have a higher screen-space error and
    // win the remaining three slots over the farther half — a priority-ordered
    // traversal keeps them regardless of which order they were enqueued in.
    expect(selected[0]).toBe('0-0-0-0');
    expect(selected.slice(1).every((key) => key.endsWith('-1'))).toBe(true);
    expect(selected).toHaveLength(4);
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

  it('reports a sub-page instead of treating its entry point as a childless node', () => {
    // Root has no children in `nodes`, but one of its 8 child slots is a
    // sub-page entry point (its subtree lives in a hierarchy page not yet loaded).
    const nodes: Hierarchy.Node.Map = {
      '0-0-0-0': { pointCount: 100, pointDataOffset: 0, pointDataLength: 1 },
    };
    const pages: Hierarchy.Page.Map = {
      '1-1-1-1': { pageOffset: 0, pageLength: 100 },
    };
    const camera = makeCamera(
      new Cesium.Cartesian3(0, 0, 30),
      lookingAtOrigin.direction,
      lookingAtOrigin.up,
    );

    const neededPages: string[] = [];
    const selected = selectNodes({
      nodes,
      pages,
      onPageNeeded: (key) => neededPages.push(key),
      getSphere: makeGetSphere(rootCenter, rootHalfSize),
      camera,
      viewportHeight: 1000,
      sseThreshold: 16,
      maxVisibleNodes: 100,
    });

    // The root's SSE exceeds the threshold, so it's still expanded; the only
    // child slot with a hierarchy entry is the sub-page, not a selectable node.
    expect(selected).toEqual(['0-0-0-0']);
    expect(neededPages).toEqual(['1-1-1-1']);
  });

  it('stops the traversal once maxPoints is reached, independent of maxVisibleNodes', () => {
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
      // Root (100 points) is under budget, so one more pop is attempted;
      // after it lands (110 points) the budget is used up and the loop stops.
      maxPoints: 105,
    });

    expect(selected[0]).toBe('0-0-0-0');
    expect(selected).toHaveLength(2);
  });

  it('is unbounded by point count when maxPoints is omitted', () => {
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

    expect(selected).toHaveLength(9);
  });
});

function copcTree(
  nodes: Hierarchy.Node.Map,
  center: { x: number; y: number; z: number },
): LodTree<string> {
  return {
    root: '0-0-0-0',
    points: (key) => nodes[key]?.pointCount ?? 0,
    sphere: makeGetSphere(center, rootHalfSize),
    children: (key) => getChildKeys(key).filter((child) => nodes[child]),
  };
}

describe('selectAcross', () => {
  const camera = makeCamera(
    new Cesium.Cartesian3(0, 0, 30),
    lookingAtOrigin.direction,
    lookingAtOrigin.up,
  );

  it('prunes a child whose own SSE is below the threshold even when its parent expands', () => {
    // root SSE ~500; near children (z=+5) ~289, far children (z=-5) ~210.
    const [selected] = selectAcross([copcTree(makeOneLevelOctree(), rootCenter)], {
      camera,
      viewportHeight: 1000,
      sseThreshold: 250,
      maxVisibleNodes: 100,
    });

    expect(selected[0]).toBe('0-0-0-0');
    expect(selected).toHaveLength(5);
    expect((selected as string[]).slice(1).every((key) => key.endsWith('-1'))).toBe(true);
  });

  it('spends a shared budget on the nearer tree first', () => {
    const near = copcTree(makeOneLevelOctree(), rootCenter);
    const far = copcTree(makeOneLevelOctree(), { x: 0, y: 0, z: -200 });

    const [a, b] = selectAcross([near, far], {
      camera,
      viewportHeight: 1000,
      sseThreshold: 16,
      maxVisibleNodes: 10,
    });

    expect(a).toHaveLength(9);
    expect(b).toEqual(['0-0-0-0']);
  });

  it('returns an empty selection for a tree outside the frustum without touching the others', () => {
    const inView = copcTree(makeOneLevelOctree(), rootCenter);
    const behind = copcTree(makeOneLevelOctree(), { x: 0, y: 0, z: 1000 });

    const [a, b] = selectAcross([inView, behind], {
      camera,
      viewportHeight: 1000,
      sseThreshold: 16,
      maxVisibleNodes: 100,
    });

    expect(a).toHaveLength(9);
    expect(b).toEqual([]);
  });

  it('refines the child around the camera when the camera is inside the tree', () => {
    const inside = makeCamera(
      new Cesium.Cartesian3(1, 1, 1),
      lookingAtOrigin.direction,
      lookingAtOrigin.up,
    );

    const [selected] = selectAcross([copcTree(makeOneLevelOctree(), rootCenter)], {
      camera: inside,
      viewportHeight: 1000,
      sseThreshold: 1e9,
      maxVisibleNodes: 100,
    });

    expect(selected).toContain('0-0-0-0');
    expect(selected).toContain('1-1-1-1');
    expect(selected).not.toContain('1-0-0-0');
  });

  it('loads a sub-page only when its entry point would be refined', () => {
    const loaded: string[] = [];
    const tree: LodTree<string> = {
      ...copcTree(
        { '0-0-0-0': { pointCount: 100, pointDataOffset: 0, pointDataLength: 1 } },
        rootCenter,
      ),
      subpages: () => ['1-1-1-1', '1-0-0-0'],
      loadSubpage: (key) => loaded.push(key),
    };

    // 1-1-1-1 (z=+5) ~289 >= 250, 1-0-0-0 (z=-5) ~210 < 250.
    selectAcross([tree], { camera, viewportHeight: 1000, sseThreshold: 250, maxVisibleNodes: 100 });

    expect(loaded).toEqual(['1-1-1-1']);
  });
});
