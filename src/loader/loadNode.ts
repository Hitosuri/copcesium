import type * as Cesium from 'cesium';
import { PointCloudPrimitive, type PointStyle } from '../renderer/PointCloudPrimitive';
import type { NodeRenderData } from '../types';

/**
 * Turns a node's render-ready buffers into a GPU `PointCloudPrimitive`.
 *
 * This is a thin wrapper today, but it's declared `async` so the signature
 * already matches Day 3, when it will fetch `renderData` from a `WorkerPool`
 * instead of receiving it directly — callers won't need to change.
 */
export async function createNodePrimitive(
  renderData: NodeRenderData,
  boundingSphere: Cesium.BoundingSphere,
  style: PointStyle,
): Promise<PointCloudPrimitive> {
  return new PointCloudPrimitive(renderData, boundingSphere, style);
}
