import { describe, expect, it, vi } from 'vitest';
import type { Viewer } from 'cesium';

const create = vi.fn();
const loadHierarchyPage = vi.fn();

vi.mock('copc', () => ({
  Copc: {
    create: (...args: unknown[]) => create(...args),
    loadHierarchyPage: (...args: unknown[]) => loadHierarchyPage(...args),
  },
}));

const { CopcDataSource } = await import('./CopcDataSource');

const fakeViewer = {} as Viewer;

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
