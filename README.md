<p align="center">
  <img src="./assets/icon.png" width="120" alt="copcesium icon" />
</p>

# [copcesium](https://github.com/Jangmyun/copcesium) &middot; [![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Jangmyun/copcesium/blob/main/LICENSE) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Jangmyun/copcesium/issues)

[한국어 README](./README_KO.md)

CesiumJS provider for real-time [COPC](https://copc.io/) (Cloud Optimized Point Cloud) streaming and rendering.

- **Streaming, not loading:** only the octree nodes visible to the current camera are fetched, over HTTP Range Requests — never the whole file.
- **Off the main thread:** LAZ decompression and coordinate transforms run in a pool of reused Web Workers, so decoding never blocks the UI.
- **Level of detail:** a screen-space-error-driven octree walk decides what to subdivide, so point density matches what the camera can actually resolve, and a node is only ever swapped out once its replacement is ready to show — no flash of empty space mid-transition.
- **CRS-aware:** auto-detects the source coordinate system (including compound CRSes with a non-meter vertical unit) from the file's own WKT metadata, with a proj4-backed EPSG fallback table.
- **Live-tunable:** `pixelSize` and `sseThreshold` can be adjusted on a running data source with no reload.
- **Genuinely drop-in:** the published package is a single self-contained `.mjs` file — the Worker and its `laz-perf` WASM module are compiled inline at build time, so there's no separate asset for your bundler to lose track of.

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Options](#options)
- [API reference](#api-reference)
- [Worker / WASM bundling](#worker--wasm-bundling)
- [Requirements: HTTP Range Requests and CORS](#requirements-http-range-requests-and-cors)
- [Supported coordinate systems](#supported-coordinate-systems)
- [Example](#example)
- [Credits](#credits)
- [License](#license)

## Installation

```bash
npm install copcesium cesium
```

`cesium` is a peer dependency (`>=1.100.0`) — install whichever version your app already uses. copcesium ships as an ESM-only package (see [Worker / WASM bundling](#worker--wasm-bundling) for why).

## Quick start

```ts
import * as Cesium from 'cesium';
import { CopcDataSource } from 'copcesium';

const viewer = new Cesium.Viewer('cesiumContainer');

const dataSource = await CopcDataSource.load(
  'https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz',
  viewer,
);
```

That's it — `load()` fetches the COPC hierarchy, auto-detects the source coordinate system from the file's WKT (when present), flies the camera to the dataset, and starts streaming nodes as the camera moves. See [`examples/basic-viewer/main.ts`](./examples/basic-viewer/main.ts) for a slightly larger example with a URL input, live `pixelSize`/`sseThreshold` sliders, and error handling.

If the file's WKT doesn't fully describe the CRS (or is missing), pass it explicitly:

```ts
const dataSource = await CopcDataSource.load(url, viewer, {
  proj: 'EPSG:2992',
  projDef:
    '+proj=lcc +lat_1=43 +lat_2=45.5 +lat_0=41.75 +lon_0=-120.5' +
    ' +x_0=399999.9999999999 +y_0=0 +datum=NAD83 +units=ft +no_defs',
  geoidOffset: -20, // meters, local geoid separation from the WGS84 ellipsoid
});
```

When you're done with a data source:

```ts
dataSource.destroy();
```

## Options

All fields on the third argument to `CopcDataSource.load()` are optional.

```ts
interface CopcDataSourceOptions {
  proj?: string;
  projDef?: string | null;
  geoidOffset?: number;
  concurrency?: number;
  debounceMs?: number;
  maxCacheNodes?: number;
  maxVisibleNodes?: number;
  pixelSize?: number;
  sseThreshold?: number;
  zFactor?: number;
  xyFactor?: number;
  autoFrame?: boolean;
}
```

| Option | Default | Description |
| --- | --- | --- |
| `proj` | `'EPSG:4326'` | Source CRS identifier. Auto-detected from the file's WKT when omitted. |
| `projDef` | `null` | proj4 definition string for `proj`, when proj4 doesn't already know it. |
| `geoidOffset` | `0` | Meters to add to every point's height — local geoid separation from the WGS84 ellipsoid, if the file's vertical datum isn't already ellipsoidal. |
| `zFactor` | auto-detected | Factor converting the file's Z unit to meters. Detected from the WKT's vertical unit when present, even if `proj`/`projDef` is overridden. |
| `xyFactor` | auto-detected | Factor converting the file's XY unit to meters (used for bounding-sphere sizing). |
| `concurrency` | `5` | Number of Worker threads decoding nodes in parallel. Ignored if a `workerPool` is passed to `load()`. |
| `debounceMs` | `100` | Minimum interval between full LoD re-selection passes. A lighter frustum-only visibility check still runs every frame. |
| `maxCacheNodes` | `150` | Maximum nodes kept in memory (LRU) before the least-recently-used, currently-unselected ones are torn down. |
| `maxVisibleNodes` | `100` | Maximum nodes selected for rendering in a single LoD pass. |
| `pixelSize` | `2` | Point size in pixels. Live-adjustable after load via `dataSource.pixelSize`. |
| `sseThreshold` | `250` | Screen-space error (pixels) above which a node is subdivided into children. Lower = more detail, more nodes loaded. Live-adjustable via `dataSource.sseThreshold`. |
| `autoFrame` | `true` | Whether `load()` flies the camera to the dataset before resolving. Set `false` if you're managing the camera yourself. |

## API reference

### `CopcDataSource.load(url, viewer, options?, workerPool?): Promise<CopcDataSource>`

Static factory — `CopcDataSource` has no public constructor. Resolves once the hierarchy is loaded (and, if `autoFrame` is enabled, once the camera has finished flying to the dataset).

- `url: string` — URL of the `.copc.laz` file. Must support HTTP Range Requests (see below).
- `viewer: Cesium.Viewer`
- `options?: CopcDataSourceOptions` — see [Options](#options).
- `workerPool?: WorkerPool` — an externally-owned pool, reused instead of an internally-created one. See [Sharing a WorkerPool](#sharing-a-workerpool) for its current limitation.

### Instance members

```ts
class CopcDataSource {
  pixelSize: number;
  sseThreshold: number;
  readonly maxDepth: number;
  readonly nodeCount: number;
  readonly cacheSize: number;
  zoomTo(): Promise<void>;
  destroy(): void;
}
```

| Member | Description |
| --- | --- |
| `pixelSize` | Get/set. Updates every currently-rendered node's point size immediately, no reload. |
| `sseThreshold` | Get/set. Triggers an immediate LoD re-selection pass when set. |
| `maxDepth` | Read-only. Deepest octree level present in the loaded hierarchy. |
| `nodeCount` | Read-only. Total nodes in the hierarchy (loaded or not). |
| `cacheSize` | Read-only. Nodes currently retained in the LRU cache. |
| `zoomTo()` | Flies the camera to the dataset's root bounding sphere. Called internally by `load()` when `autoFrame` is enabled; call it again yourself to re-frame later. |
| `destroy()` | Tears down the Worker pool (unless it was externally provided), the node cache, and every loaded primitive. Idempotent. |

### Sharing a `WorkerPool`

`load()`'s fourth argument accepts an externally-constructed `WorkerPool`, so the same pool of Workers can in principle be reused across multiple `CopcDataSource` instances or reloads instead of spinning up (and WASM-recompiling) a fresh one each time:

```ts
import { CopcDataSource, WorkerPool } from 'copcesium';

const pool = new WorkerPool(workerFactory, 5); // see note below
const a = await CopcDataSource.load(urlA, viewer, {}, pool);
const b = await CopcDataSource.load(urlB, viewer, {}, pool);

// destroy() on a data source given an external pool never tears the pool
// down — dispose of the pool yourself once nothing needs it anymore:
pool.destroy();
```

> **Known limitation:** `workerFactory` must construct a Worker that speaks copcesium's internal node-decoding protocol, but that Worker is compiled directly into `CopcDataSource`'s own module at build time (`?worker&inline`) and is not exported — there is currently no supported way to build a compatible `workerFactory` from outside the package. Track [issue #51](https://github.com/Jangmyun/copcesium/issues/51). Until it lands, don't pass a `workerPool` — every `load()` call without one gets its own pool sized by `concurrency`, which is the only supported path today.

## Worker / WASM bundling

Point decoding (LAZ decompression via [`laz-perf`](https://github.com/hobuinc/laz-perf), coordinate transforms) runs in a Worker. Both the Worker's own code and the `laz-perf` WASM binary are compiled and embedded directly into the published `dist/copc-cesium.mjs` at build time — there is no separate worker chunk and no `dist/assets/` directory for a consumer's bundler to lose track of. `laz-perf.wasm` is embedded as raw bytes and handed to `LazPerf.create({ wasmBinary })`, bypassing the WASM loader's own fetch path entirely, so nothing here depends on where the app that imports copcesium happens to be deployed.

copcesium ships ESM-only — there is no CommonJS build — because constructing the inlined Worker requires `import.meta.url` semantics that have no equivalent under `require()`.

## Requirements: HTTP Range Requests and CORS

copcesium fetches only the bytes it needs (COPC header, hierarchy pages, individual node point data) via HTTP Range Requests, not the whole file. Wherever you host `.copc.laz` files, the server must:

- Support `Range` request headers and respond with `206 Partial Content` (Amazon S3, most static hosts, and CDNs do this by default).
- Send CORS headers (`Access-Control-Allow-Origin`) permitting your app's origin, since these are cross-origin `fetch()` calls unless the file is served from the same origin as your app.

## Supported coordinate systems

`CopcDataSource` auto-detects the source CRS and unit conversion factors from the COPC file's WKT VLR when present, including compound CRSes (separate horizontal + vertical definitions, e.g. a state-plane CRS in feet with a NAVD88 vertical datum). A small built-in EPSG lookup table (see [`src/crs/projections.ts`](./src/crs/projections.ts)) covers common CRSes as a fallback when [proj4](https://github.com/proj4js/proj4js)'s own WKT parsing doesn't recognize a file's specific dialect. If detection fails or you need to override it, pass `proj`/`projDef` explicitly (see [Options](#options)) — auto-detected `zFactor`/`xyFactor` still apply on top of an explicit `proj`/`projDef`, since a compound CRS's vertical unit can differ from the CRS you're overriding with.

## Example

[`examples/basic-viewer`](./examples/basic-viewer) is a minimal, standalone project that installs `copcesium` from the npm registry (not from this repo's `src/`) — a URL input, `pixelSize`/`sseThreshold` sliders, a "Remove & reload" button, and an on-screen error area. It loads a public sample dataset ([Autzen Stadium](https://github.com/PDAL/data/tree/main/autzen)) automatically.

```bash
git clone https://github.com/Jangmyun/copcesium.git
cd copcesium/examples/basic-viewer
npm install
cp .env.example .env   # optionally set VITE_CESIUM_TOKEN for Cesium Ion imagery
npm run dev
```

Then open the printed local URL in a browser.

## Credits

- [`copc`](https://github.com/connormanning/copc.js) — COPC parsing (header/hierarchy/point data, over HTTP Range Requests)
- [`laz-perf`](https://github.com/hobuinc/laz-perf) — WASM LAZ decompression
- [`proj4`](https://github.com/proj4js/proj4js) — coordinate system transforms
- [CesiumJS](https://cesium.com/platform/cesiumjs/) — 3D globe rendering

## License

copcesium is [MIT licensed](./LICENSE). See [CHANGELOG.md](./CHANGELOG.md) for release history.
