/**
 * Wire protocol between WorkerPool and any worker script used with it. A worker
 * must echo back the same `id` it received so WorkerPool can match the reply to
 * the task that produced it.
 */
export interface WorkerRequest {
  id: number;
  payload: unknown;
}

/**
 * Errors cross the postMessage boundary as plain data (not Error instances,
 * which do not structured-clone reliably across all targets), so a worker
 * catches its own exceptions and reports `name`/`message` instead of throwing.
 */
export interface WorkerResponse {
  id: number;
  result?: unknown;
  error?: { name: string; message: string };
}

interface Task {
  id: number;
  message: unknown;
  transfer: Transferable[];
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Runs work across a fixed number of reused Workers instead of spawning one
 * per task — spawning a new Worker per COPC node would force laz-perf to
 * recompile its WASM every time.
 */
export class WorkerPool {
  private readonly workers: Worker[];
  private readonly idleWorkers: Worker[] = [];
  private readonly queue: Task[] = [];
  private readonly pending = new Map<Worker, Task>();
  private nextId = 0;
  private destroyed = false;

  constructor(workerFactory: () => Worker, concurrency: number) {
    this.workers = [];
    for (let i = 0; i < concurrency; i++) {
      const worker = workerFactory();
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => this._handleMessage(worker, e);
      worker.onerror = (e: ErrorEvent) => this._handleError(worker, e);
      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  run<T>(message: unknown, transfer: Transferable[] = []): Promise<T> {
    if (this.destroyed) {
      return Promise.reject(new Error('WorkerPool: run() called after destroy()'));
    }
    return new Promise<T>((resolve, reject) => {
      const task: Task = {
        id: this.nextId++,
        message,
        transfer,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      this._dispatch(task);
    });
  }

  destroy(): void {
    this.destroyed = true;
    for (const worker of this.workers) worker.terminate();
    for (const task of this.pending.values()) {
      task.reject(new Error('WorkerPool: destroyed while task was running'));
    }
    for (const task of this.queue) {
      task.reject(new Error('WorkerPool: destroyed before task could run'));
    }
    this.pending.clear();
    this.queue.length = 0;
    this.idleWorkers.length = 0;
  }

  private _dispatch(task: Task): void {
    const worker = this.idleWorkers.pop();
    if (!worker) {
      this.queue.push(task);
      return;
    }
    this.pending.set(worker, task);
    worker.postMessage({ id: task.id, payload: task.message } satisfies WorkerRequest, task.transfer);
  }

  private _handleMessage(worker: Worker, e: MessageEvent<WorkerResponse>): void {
    const task = this.pending.get(worker);
    // Ignore replies that don't match the task we think is running on this
    // worker (e.g. a stray message) rather than resolving the wrong promise.
    if (!task || e.data.id !== task.id) return;
    this.pending.delete(worker);

    if (e.data.error) {
      const err = new Error(e.data.error.message);
      err.name = e.data.error.name;
      task.reject(err);
    } else {
      task.resolve(e.data.result);
    }
    this._release(worker);
  }

  private _handleError(worker: Worker, e: ErrorEvent): void {
    const task = this.pending.get(worker);
    this.pending.delete(worker);
    task?.reject(new Error(`WorkerPool: worker error: ${e.message}`));
    this._release(worker);
  }

  private _release(worker: Worker): void {
    const next = this.queue.shift();
    if (!next) {
      this.idleWorkers.push(worker);
      return;
    }
    this.pending.set(worker, next);
    worker.postMessage({ id: next.id, payload: next.message } satisfies WorkerRequest, next.transfer);
  }
}
