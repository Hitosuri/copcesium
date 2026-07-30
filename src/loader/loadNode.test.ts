import { describe, expect, it } from 'vitest';
import * as Cesium from 'cesium';
import { createNodePrimitive } from './loadNode';
import { PointCloudPrimitive } from '../renderer/PointCloudPrimitive';
import type { NodeRenderData } from '../types';

// Mock render data, standing in for what a Worker will eventually produce.
const renderData: NodeRenderData = {
  positions: new Float64Array([6378137, 0, 0, 0, 6378137, 0]),
  colors: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
  pointCount: 2,
};

describe('createNodePrimitive', () => {
  it('resolves to a PointCloudPrimitive built from the given render data and bounding sphere', async () => {
    const boundingSphere = new Cesium.BoundingSphere(new Cesium.Cartesian3(0, 0, 0), 10);
    const pixelSizeRef = { value: 2 };

    const primitive = await createNodePrimitive(renderData, boundingSphere, pixelSizeRef);

    expect(primitive).toBeInstanceOf(PointCloudPrimitive);
    expect(primitive.isDestroyed()).toBe(false);
  });

  it('shares a single pixelSizeRef across primitives so size updates apply to all of them', async () => {
    const boundingSphere = new Cesium.BoundingSphere(new Cesium.Cartesian3(0, 0, 0), 10);
    const pixelSizeRef = { value: 1 };

    const a = await createNodePrimitive(renderData, boundingSphere, pixelSizeRef);
    const b = await createNodePrimitive(renderData, boundingSphere, pixelSizeRef);

    // Both primitives were constructed with the same ref object, not a copy of its value.
    pixelSizeRef.value = 5;
    expect(pixelSizeRef.value).toBe(5);
    expect(a.isDestroyed()).toBe(false);
    expect(b.isDestroyed()).toBe(false);
  });
});
