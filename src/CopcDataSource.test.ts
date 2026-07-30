import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from 'cesium';
import type { NodeRenderData } from './types';

const create = vi.fn();
const loadHierarchyPage = vi.fn();

vi.mock('copc', () => ({
  Copc: {
    create: (...args: unknown[]) => create(...args),
    loadHierarchyPage: (...args: unknown[]) => loadHierarchyPage(...args),
  },
}));

// CopcDataSource wires up a real WorkerPool, which would otherwise construct
// an actual `new Worker(...)` immediately in its constructor — unavailable
// under jsdom. `run`/`destroy` are shared vi.fn()s so individual tests can
// configure per-call behavior (e.g. mockResolvedValueOnce) the same way they
// already do for the mocked `copc` module below.
const workerPoolRun = vi.fn();
const workerPoolDestroy = vi.fn();
vi.mock('./worker/WorkerPool', () => ({
  // `new`-able: mockImplementation's function must support construction, which
  // an arrow function cannot — returning an object from a regular function
  // constructor makes `new WorkerPool(...)` resolve to that object (per spec).
  WorkerPool: vi.fn().mockImplementation(function () {
    return {
      run: (...args: unknown[]) => workerPoolRun(...args),
      destroy: (...args: unknown[]) => workerPoolDestroy(...args),
    };
  }),
}));

// The update-loop tests below only care whether CopcDataSource correctly wires
// selectNodes()'s output through WorkerPool -> NodeCache -> scene.primitives —
// selectNodes()'s own frustum/SSE geometry is already covered by
// lod/selectNodes.test.ts, so it's stubbed here to a fixed key rather than
// requiring a geometrically valid camera/frustum in every test.
const selectNodesMock = vi.fn<(...args: unknown[]) => string[]>();
vi.mock('./lod/selectNodes', () => ({
  selectNodes: (...args: unknown[]) => selectNodesMock(...args),
}));

const { CopcDataSource } = await import('./CopcDataSource');

// workerPoolRun/workerPoolDestroy/selectNodesMock are shared across every test
// in this file, so their call counts must be reset per test — otherwise
// toHaveBeenCalledTimes() assertions accumulate across unrelated tests.
beforeEach(() => {
  vi.clearAllMocks();
});

function makeFakeViewer() {
  let updateCallback: (() => void) | undefined;
  const addPrimitive = vi.fn();
  const removePrimitive = vi.fn();
  const removeUpdateListener = vi.fn();
  const requestRender = vi.fn();
  const viewer = {
    scene: {
      preRender: {
        addEventListener: vi.fn((cb: () => void) => {
          updateCallback = cb;
          return removeUpdateListener;
        }),
      },
      primitives: { add: addPrimitive, remove: removePrimitive },
      camera: {},
      canvas: { clientHeight: 600 },
      requestRender,
    },
  } as unknown as Viewer;
  return {
    viewer,
    addPrimitive,
    removePrimitive,
    removeUpdateListener,
    requestRender,
    triggerUpdate: () => updateCallback!(),
  };
}

const fakeViewer = makeFakeViewer().viewer;

function mockCopc(wkt: string | undefined) {
  create.mockResolvedValueOnce({
    info: {
      cube: [0, 0, 0, 10, 10, 10],
      rootHierarchyPage: { pageOffset: 0, pageLength: 10 },
    },
    wkt,
  });
  loadHierarchyPage.mockResolvedValueOnce({
    nodes: { '0-0-0-0': { pointCount: 1, pointDataOffset: 0, pointDataLength: 1 } },
    pages: {},
  });
}

describe('CopcDataSource.load', () => {
  it('auto-detects CRS from WKT when the user does not provide one', async () => {
    const wkt =
      'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],' +
      'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]';
    mockCopc(wkt);

    const ds = await CopcDataSource.load('https://example.com/sample.copc.laz', fakeViewer);

    expect((ds as unknown as { _options: { proj: string; projDef: string | null } })._options).toMatchObject({
      proj: 'EPSG:4326',
      projDef: null,
    });
  });

  it('lets an explicit projDef option take priority over WKT auto-detection', async () => {
    mockCopc(undefined);

    const ds = await CopcDataSource.load('https://example.com/sample.copc.laz', fakeViewer, {
      proj: 'EPSG:5186',
      projDef: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    });

    expect((ds as unknown as { _options: { proj: string; projDef: string | null } })._options).toMatchObject({
      proj: 'EPSG:5186',
    });
  });

  it('does not throw on destroy()', async () => {
    mockCopc(undefined);
    const ds = await CopcDataSource.load('https://example.com/sample.copc.laz', fakeViewer);
    expect(() => ds.destroy()).not.toThrow();
  });

  it('applies zFactor/xyFactor auto-detected from a non-meter WKT', async () => {
    const wkt =
      'PROJCS["NAD83 / California zone 5", GARBAGE, ID["EPSG",2229]], ' +
      'LENGTHUNIT["US survey foot",0.304800609601219]';
    mockCopc(wkt);

    const ds = await CopcDataSource.load('https://example.com/sample.copc.laz', fakeViewer);

    const opts = (ds as unknown as { _options: { zFactor: number; xyFactor: number } })._options;
    expect(opts.zFactor).toBeCloseTo(0.3048006096, 8);
    expect(opts.xyFactor).toBeCloseTo(0.3048006096, 8);
  });

  it('still detects zFactor/xyFactor from the WKT when the user provides an explicit proj/projDef', async () => {
    // Regression test for #38: a compound CRS can declare foot-based vertical
    // units even when the caller supplies its own horizontal proj/projDef
    // (e.g. the real Autzen COPC dataset — NAD83 Oregon Lambert (ft) + NAVD88
    // (ftUS)). zFactor/xyFactor detection must not be skipped just because
    // the caller overrode proj/projDef.
    const wkt =
      'PROJCS["NAD83 / California zone 5", GARBAGE, ID["EPSG",2229]], ' +
      'LENGTHUNIT["US survey foot",0.304800609601219]';
    mockCopc(wkt);

    const ds = await CopcDataSource.load('https://example.com/sample.copc.laz', fakeViewer, {
      proj: 'EPSG:5186',
      projDef: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    });

    const opts = (ds as unknown as { _options: { proj: string; projDef: string; zFactor: number; xyFactor: number } })
      ._options;
    expect(opts.proj).toBe('EPSG:5186'); // explicit proj/projDef still wins
    expect(opts.zFactor).toBeCloseTo(0.3048006096, 8);
    expect(opts.xyFactor).toBeCloseTo(0.3048006096, 8);
  });

  it('lets explicit zFactor/xyFactor options take priority over auto-detection', async () => {
    const wkt =
      'PROJCS["NAD83 / California zone 5", GARBAGE, ID["EPSG",2229]], ' +
      'LENGTHUNIT["US survey foot",0.304800609601219]';
    mockCopc(wkt);

    const ds = await CopcDataSource.load('https://example.com/sample.copc.laz', fakeViewer, {
      zFactor: 1,
      xyFactor: 1,
    });

    const opts = (ds as unknown as { _options: { zFactor: number; xyFactor: number } })._options;
    expect(opts.zFactor).toBe(1);
    expect(opts.xyFactor).toBe(1);
  });

  it('defaults zFactor/xyFactor to 1 when there is no WKT to detect from', async () => {
    mockCopc(undefined);

    const ds = await CopcDataSource.load('https://example.com/sample.copc.laz', fakeViewer);

    const opts = (ds as unknown as { _options: { zFactor: number; xyFactor: number } })._options;
    expect(opts.zFactor).toBe(1);
    expect(opts.xyFactor).toBe(1);
  });
});

describe('CopcDataSource update loop', () => {
  const renderData: NodeRenderData = {
    positions: new Float64Array([6378137, 0, 0]),
    colors: new Uint8Array([255, 0, 0, 255]),
    pointCount: 1,
  };

  beforeEach(() => {
    selectNodesMock.mockReturnValue(['0-0-0-0']);
  });

  it('loads a selected node through the worker pool and adds its primitive to the scene', async () => {
    mockCopc(undefined);
    workerPoolRun.mockResolvedValueOnce(renderData);
    const { viewer, addPrimitive, requestRender, triggerUpdate } = makeFakeViewer();

    await CopcDataSource.load('https://example.com/sample.copc.laz', viewer, { debounceMs: 0 });
    triggerUpdate();
    await vi.waitFor(() => expect(addPrimitive).toHaveBeenCalledTimes(1));

    expect(workerPoolRun).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/sample.copc.laz', proj: 'EPSG:4326' }),
    );
    // Required under `requestRenderMode: true` for the new primitive to actually
    // appear; harmless (no-op) under continuous rendering otherwise.
    expect(requestRender).toHaveBeenCalled();
  });

  it('does not re-dispatch a node that is already cached on a later update', async () => {
    mockCopc(undefined);
    workerPoolRun.mockResolvedValueOnce(renderData);
    const { viewer, addPrimitive, triggerUpdate } = makeFakeViewer();

    await CopcDataSource.load('https://example.com/sample.copc.laz', viewer, { debounceMs: 0 });
    triggerUpdate();
    await vi.waitFor(() => expect(addPrimitive).toHaveBeenCalledTimes(1));

    triggerUpdate();

    expect(workerPoolRun).toHaveBeenCalledTimes(1);
    expect(addPrimitive).toHaveBeenCalledTimes(1);
  });

  it('destroy() tears down the worker pool and node cache, and removes the update listener', async () => {
    mockCopc(undefined);
    workerPoolRun.mockResolvedValueOnce(renderData);
    const { viewer, addPrimitive, removePrimitive, removeUpdateListener, triggerUpdate } = makeFakeViewer();

    const ds = await CopcDataSource.load('https://example.com/sample.copc.laz', viewer, { debounceMs: 0 });
    triggerUpdate();
    // Wait for the node to actually reach NodeCache (right after scene.primitives.add),
    // not just for the worker to resolve, so destroy() has something to tear down.
    await vi.waitFor(() => expect(addPrimitive).toHaveBeenCalledTimes(1));

    ds.destroy();

    expect(removeUpdateListener).toHaveBeenCalledTimes(1);
    expect(workerPoolDestroy).toHaveBeenCalledTimes(1);
    expect(removePrimitive).toHaveBeenCalledTimes(1);
  });
});
