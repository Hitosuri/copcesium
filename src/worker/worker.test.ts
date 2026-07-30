import { describe, expect, it, vi } from 'vitest';
import type { View } from 'copc';

const loadPointDataView = vi.fn();
vi.mock('copc', () => ({
  Copc: {
    loadPointDataView: (...args: unknown[]) => loadPointDataView(...args),
  },
}));

const lazPerfCreate = vi.fn().mockResolvedValue({});
vi.mock('laz-perf/lib/worker', () => ({
  LazPerf: { create: (...args: unknown[]) => lazPerfCreate(...args) },
}));

const proj4Defs = vi.fn();
const proj4Forward = vi.fn((coord: [number, number]) => coord);
function proj4Mock(..._args: unknown[]) {
  return { forward: proj4Forward };
}
proj4Mock.defs = (...args: unknown[]) => proj4Defs(...args);
vi.mock('proj4', () => ({ default: proj4Mock }));

const { convertNode, lonLatAltToEcef } = await import('./worker');

/** Builds a fake `copc` View backed by plain arrays, matching the real
 * getter contract: throws for a dimension that wasn't supplied. */
function makeView(fields: Record<string, number[]>, pointCountOverride?: number): View {
  const pointCount = pointCountOverride ?? Object.values(fields)[0]?.length ?? 0;
  return {
    pointCount,
    dimensions: {},
    getter: (name: string) => {
      const arr = fields[name];
      if (!arr) throw new Error(`No extractor for dimension: ${name}`);
      return (i: number) => arr[i];
    },
  };
}

const BASE_PAYLOAD = {
  url: 'https://example.com/sample.copc.laz',
  copc: {} as never,
  node: {} as never,
  proj: 'EPSG:4326',
  projDef: null,
  geoidOffset: 0,
  zFactor: 1,
};

describe('lonLatAltToEcef', () => {
  it('places (0, 0, 0) on the equator at the WGS84 equatorial radius', () => {
    const [x, y, z] = lonLatAltToEcef(0, 0, 0);
    expect(x).toBeCloseTo(6378137.0, 3);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('adds altitude straight onto the radius at the equator', () => {
    const [x] = lonLatAltToEcef(0, 0, 1000);
    expect(x).toBeCloseTo(6378137.0 + 1000, 3);
  });
});

describe('convertNode', () => {
  it('passes X/Y through unchanged as lon/lat when proj is EPSG:4326', async () => {
    loadPointDataView.mockResolvedValueOnce(
      makeView({ X: [10], Y: [20], Z: [0], Red: [255], Green: [0], Blue: [0] }),
    );

    const result = await convertNode(BASE_PAYLOAD);

    expect(proj4Forward).not.toHaveBeenCalled();
    const [x, y, z] = lonLatAltToEcef(10, 20, 0);
    expect(result.positions[0]).toBeCloseTo(x, 6);
    expect(result.positions[1]).toBeCloseTo(y, 6);
    expect(result.positions[2]).toBeCloseTo(z, 6);
  });

  it('registers projDef once and transforms X/Y through proj4 for a non-4326 CRS', async () => {
    loadPointDataView.mockResolvedValue(makeView({ X: [200000], Y: [600000], Z: [0] }));
    proj4Forward.mockReturnValue([127, 38]);

    await convertNode({ ...BASE_PAYLOAD, proj: 'EPSG:5186', projDef: '+proj=tmerc ...' });
    await convertNode({ ...BASE_PAYLOAD, proj: 'EPSG:5186', projDef: '+proj=tmerc ...' });

    expect(proj4Defs).toHaveBeenCalledTimes(1);
    expect(proj4Defs).toHaveBeenCalledWith('EPSG:5186', '+proj=tmerc ...');
    expect(proj4Forward).toHaveBeenCalledWith([200000, 600000]);
  });

  it('throws when proj4 produces a non-finite coordinate', async () => {
    loadPointDataView.mockResolvedValueOnce(makeView({ X: [1], Y: [1], Z: [0] }));
    proj4Forward.mockReturnValueOnce([NaN, 38]);

    await expect(convertNode({ ...BASE_PAYLOAD, proj: 'EPSG:5186', projDef: '+x' })).rejects.toThrow(
      /non-finite/,
    );
  });

  it('applies zFactor and geoidOffset to Z before computing altitude', async () => {
    loadPointDataView.mockResolvedValueOnce(makeView({ X: [0], Y: [0], Z: [100] }));

    const result = await convertNode({ ...BASE_PAYLOAD, zFactor: 0.3048, geoidOffset: 10 });

    const expectedAlt = 100 * 0.3048 + 10;
    const [, , expectedZ] = lonLatAltToEcef(0, 0, expectedAlt);
    expect(result.positions[2]).toBeCloseTo(expectedZ, 3);
  });

  it('scales 16-bit RGB down to 0-255', async () => {
    loadPointDataView.mockResolvedValueOnce(
      makeView({ X: [0], Y: [0], Z: [0], Red: [65535], Green: [0], Blue: [32768] }),
    );

    const result = await convertNode(BASE_PAYLOAD);

    expect(result.colors[0]).toBe(255);
    expect(result.colors[1]).toBe(0);
    expect(result.colors[2]).toBeCloseTo(128, -1);
    expect(result.colors[3]).toBe(255);
  });

  it('falls back to a classification color when RGB is absent', async () => {
    loadPointDataView.mockResolvedValueOnce(makeView({ X: [0], Y: [0], Z: [0], Classification: [2] }));

    const result = await convertNode(BASE_PAYLOAD);

    expect([result.colors[0], result.colors[1], result.colors[2]]).toEqual([153, 111, 66]);
  });

  it('falls back to a flat color when RGB and Classification are both absent', async () => {
    loadPointDataView.mockResolvedValueOnce(makeView({ X: [0], Y: [0], Z: [0] }));

    const result = await convertNode(BASE_PAYLOAD);

    expect([result.colors[0], result.colors[1], result.colors[2]]).toEqual([200, 200, 200]);
  });

  it('rejects an out-of-range pointCount instead of allocating huge buffers', async () => {
    loadPointDataView.mockResolvedValueOnce(makeView({ X: [], Y: [], Z: [] }, 20_000_000));

    await expect(convertNode(BASE_PAYLOAD)).rejects.toThrow(/pointCount/);
  });

  it('creates the LazPerf/WASM instance lazily and reuses it across conversions', async () => {
    // lazPerfPromise is module-level and shared by every test in this file, so
    // by this point some earlier test has already warmed it — assert against
    // that invariant instead of an exact call count, which would depend on
    // test execution order.
    loadPointDataView.mockResolvedValue(makeView({ X: [0], Y: [0], Z: [0] }));

    await convertNode(BASE_PAYLOAD);
    expect(lazPerfCreate).toHaveBeenCalled();

    const callsSoFar = lazPerfCreate.mock.calls.length;
    await convertNode(BASE_PAYLOAD);
    expect(lazPerfCreate.mock.calls.length).toBe(callsSoFar);
  });
});
