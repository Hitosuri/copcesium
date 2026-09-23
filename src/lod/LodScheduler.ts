import type * as Cesium from 'cesium';
import { selectAcross, type LodTree } from './selectNodes';

export interface LodClient<N = unknown> {
  readonly tree: LodTree<N>;
  applySelection(selected: N[]): void;
  isVisible?(): boolean;
}

export interface LodSchedulerOptions {
  sseThreshold: number;
  maxVisibleNodes: number;
  maxPoints: number;
  intervalMs?: number;
}

export class LodScheduler {
  private readonly clients = new Set<LodClient>();
  private lastUpdate = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly removeListeners: (() => void)[];

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly options: LodSchedulerOptions,
  ) {
    this.removeListeners = [
      viewer.scene.preRender.addEventListener(() => this.onPreRender()),
      viewer.scene.camera.moveEnd.addEventListener(() => this.update()),
    ];
  }

  add(client: LodClient): () => void {
    this.clients.add(client);
    this.viewer.scene.requestRender();
    return () => {
      this.clients.delete(client);
    };
  }

  update(): void {
    this.lastUpdate = performance.now();
    const clients = [...this.clients].filter((client) => client.isVisible?.() ?? true);
    if (clients.length === 0) return;

    const { scene } = this.viewer;
    const { sseThreshold, maxVisibleNodes, maxPoints } = this.options;
    const selections = selectAcross(
      clients.map((client) => client.tree),
      {
        camera: scene.camera,
        viewportHeight: scene.canvas.clientHeight,
        sseThreshold,
        maxVisibleNodes,
        maxPoints,
      },
    );
    clients.forEach((client, i) => client.applySelection(selections[i]));
  }

  destroy(): void {
    this.removeListeners.forEach((remove) => remove());
    clearTimeout(this.retryTimer);
    this.clients.clear();
  }

  private onPreRender(): void {
    const wait = (this.options.intervalMs ?? 100) - (performance.now() - this.lastUpdate);
    if (wait <= 0) {
      this.update();
      return;
    }
    // requestRenderMode: a frame skipped by the throttle may be the last one, so ask for
    // another once the window closes.
    this.retryTimer ??= setTimeout(() => {
      this.retryTimer = undefined;
      if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
    }, wait);
  }
}
