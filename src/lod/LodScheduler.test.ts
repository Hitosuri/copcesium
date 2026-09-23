import { describe, expect, it, vi } from 'vitest';
import * as Cesium from 'cesium';
import { LodScheduler, type LodClient } from './LodScheduler';
import type { LodTree } from './selectNodes';

function fakeViewer() {
  const camera = {
    positionWC: new Cesium.Cartesian3(0, 0, 30),
    directionWC: new Cesium.Cartesian3(0, 0, -1),
    upWC: new Cesium.Cartesian3(0, 1, 0),
    frustum: new Cesium.PerspectiveFrustum({
      fov: Cesium.Math.toRadians(60),
      aspectRatio: 1,
      near: 1,
      far: 1e9,
    }),
    moveEnd: new Cesium.Event(),
  };
  const scene = {
    camera,
    preRender: new Cesium.Event(),
    canvas: { clientHeight: 1000 },
    requestRender: vi.fn(),
  };
  return { scene, camera, isDestroyed: () => false } as unknown as Cesium.Viewer;
}

const leaf: LodTree<string> = {
  root: 'r',
  points: () => 10,
  sphere: () => new Cesium.BoundingSphere(new Cesium.Cartesian3(0, 0, 0), 5),
  children: () => [],
};

function client(visible = true): LodClient<string> & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    tree: leaf,
    calls,
    applySelection: (selected) => calls.push(selected),
    isVisible: () => visible,
  };
}

const options = { sseThreshold: 16, maxVisibleNodes: 100, maxPoints: 1000 };

describe('LodScheduler', () => {
  it('hands every registered client its selection in one pass', () => {
    const scheduler = new LodScheduler(fakeViewer(), options);
    const a = client();
    const b = client();
    scheduler.add(a);
    scheduler.add(b);

    scheduler.update();

    expect(a.calls).toEqual([['r']]);
    expect(b.calls).toEqual([['r']]);
  });

  it('skips a hidden client, leaving its last selection alone', () => {
    const scheduler = new LodScheduler(fakeViewer(), options);
    const hidden = client(false);
    scheduler.add(hidden);

    scheduler.update();

    expect(hidden.calls).toEqual([]);
  });

  it('stops driving a client once it is removed', () => {
    const scheduler = new LodScheduler(fakeViewer(), options);
    const a = client();
    const remove = scheduler.add(a);
    remove();

    scheduler.update();

    expect(a.calls).toEqual([]);
  });

  it('runs a pass on moveEnd and stops listening after destroy', () => {
    const viewer = fakeViewer();
    const scheduler = new LodScheduler(viewer, options);
    const a = client();
    scheduler.add(a);

    viewer.camera.moveEnd.raiseEvent();
    scheduler.destroy();
    viewer.camera.moveEnd.raiseEvent();
    viewer.scene.preRender.raiseEvent();

    expect(a.calls).toHaveLength(1);
  });
});
