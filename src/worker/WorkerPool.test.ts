import { describe, expect, it, vi } from 'vitest';
import { WorkerPool, type WorkerRequest, type WorkerResponse } from './WorkerPool';

/** Minimal stand-in for a real Worker; the test drives replies/errors manually. */
class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  received: WorkerRequest[] = [];
  terminated = false;

  postMessage(data: WorkerRequest): void {
    this.received.push(data);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(response: Omit<WorkerResponse, 'id'>): void {
    const id = this.received[this.received.length - 1].id;
    this.onmessage?.({ data: { id, ...response } } as MessageEvent<WorkerResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function makeFactory() {
  const fakeWorkers: FakeWorker[] = [];
  const factory = (): Worker => {
    const w = new FakeWorker();
    fakeWorkers.push(w);
    return w as unknown as Worker;
  };
  return { factory, fakeWorkers };
}

describe('WorkerPool', () => {
  it('dispatches a task to a worker and resolves with its result', async () => {
    const { factory, fakeWorkers } = makeFactory();
    const pool = new WorkerPool(factory, 1);

    const promise = pool.run<string>('hello');
    expect(fakeWorkers[0].received).toEqual([{ id: 0, payload: 'hello' }]);

    fakeWorkers[0].reply({ result: 'world' });
    await expect(promise).resolves.toBe('world');
  });

  it('runs at most `concurrency` tasks at once and queues the rest', () => {
    const { factory, fakeWorkers } = makeFactory();
    const pool = new WorkerPool(factory, 2);

    void pool.run('a');
    void pool.run('b');
    void pool.run('c');

    expect(fakeWorkers).toHaveLength(2);
    expect(fakeWorkers[0].received).toHaveLength(1);
    expect(fakeWorkers[1].received).toHaveLength(1);
  });

  it('reuses an idle worker for a queued task instead of spawning a new one', async () => {
    const { factory, fakeWorkers } = makeFactory();
    const pool = new WorkerPool(factory, 1);

    const first = pool.run<string>('a');
    void pool.run<string>('b');
    expect(fakeWorkers).toHaveLength(1);
    expect(fakeWorkers[0].received).toEqual([{ id: 0, payload: 'a' }]);

    fakeWorkers[0].reply({ result: 'a-done' });
    await expect(first).resolves.toBe('a-done');

    // the queued task should have been dispatched to the same (now idle) worker
    expect(fakeWorkers).toHaveLength(1);
    expect(fakeWorkers[0].received).toEqual([
      { id: 0, payload: 'a' },
      { id: 1, payload: 'b' },
    ]);
  });

  it('rejects the caller when the worker reports an error in its response', async () => {
    const { factory, fakeWorkers } = makeFactory();
    const pool = new WorkerPool(factory, 1);

    const promise = pool.run('a');
    fakeWorkers[0].reply({ error: { name: 'RangeError', message: 'boom' } });

    await expect(promise).rejects.toThrow('boom');
  });

  it('rejects the caller when the worker fires onerror', async () => {
    const { factory, fakeWorkers } = makeFactory();
    const pool = new WorkerPool(factory, 1);

    const promise = pool.run('a');
    fakeWorkers[0].fail('script crashed');

    await expect(promise).rejects.toThrow(/script crashed/);
  });

  it('frees the worker after an error so the next queued task can run', async () => {
    const { factory, fakeWorkers } = makeFactory();
    const pool = new WorkerPool(factory, 1);

    const first = pool.run('a').catch(() => 'caught');
    const second = pool.run<string>('b');

    fakeWorkers[0].fail('script crashed');
    await first;

    expect(fakeWorkers[0].received).toEqual([
      { id: 0, payload: 'a' },
      { id: 1, payload: 'b' },
    ]);
    fakeWorkers[0].reply({ result: 'b-done' });
    await expect(second).resolves.toBe('b-done');
  });

  it('ignores a stray message when no task is pending on that worker', () => {
    const { factory, fakeWorkers } = makeFactory();
    const pool = new WorkerPool(factory, 1);
    void pool;

    expect(() => {
      fakeWorkers[0].onmessage?.({ data: { id: 999, result: 'unexpected' } } as MessageEvent<WorkerResponse>);
    }).not.toThrow();
  });

  it('terminates all workers on destroy()', () => {
    const { factory, fakeWorkers } = makeFactory();
    const pool = new WorkerPool(factory, 3);

    pool.destroy();

    expect(fakeWorkers.every((w) => w.terminated)).toBe(true);
  });

  it('rejects in-flight and queued tasks on destroy()', async () => {
    const { factory } = makeFactory();
    const pool = new WorkerPool(factory, 1);

    const running = pool.run('a');
    const queued = pool.run('b');

    pool.destroy();

    await expect(running).rejects.toThrow(/destroyed/);
    await expect(queued).rejects.toThrow(/destroyed/);
  });

  it('rejects new run() calls after destroy() without touching any worker', async () => {
    const { factory, fakeWorkers } = makeFactory();
    const pool = new WorkerPool(factory, 1);
    pool.destroy();

    await expect(pool.run('a')).rejects.toThrow(/destroy/);
    expect(fakeWorkers[0].received).toHaveLength(0);
  });

  it('passes the transfer list through to postMessage', () => {
    const { factory, fakeWorkers } = makeFactory();
    const pool = new WorkerPool(factory, 1);
    const spy = vi.spyOn(fakeWorkers[0], 'postMessage');
    const buffer = new ArrayBuffer(8);

    void pool.run('a', [buffer]);

    expect(spy).toHaveBeenCalledWith({ id: 0, payload: 'a' }, [buffer]);
  });
});
