# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.0.2] - 2026-07-31

### Fixed

- **`WorkerPool` could wedge or permanently fail after a bad worker.**
  `run()` now rejects (and frees its worker/queue slot) if no response
  arrives within `timeoutMs` (default 30s), so a hung Range Request or a
  wasm decode that never returns no longer leaves that node stuck forever. A
  worker that throws (`onerror`) is now terminated and replaced instead of
  being returned to the pool, so a single crashed worker doesn't fail every
  task subsequently routed to it; replacement is capped at 10 to avoid
  spinning forever against a structurally broken worker. (#44)
- **`selectNodes()` could drop visible nodes and hide populated subtrees.**
  Traversal now expands the highest screen-space-error node first (a
  max-heap keyed on SSE) instead of a FIFO queue, so when `maxVisibleNodes`
  is hit, the nodes that survive are the most visually important ones found
  so far rather than whatever order a pass happened to reach them in —
  previously, minor camera movement during zoom could reshuffle traversal
  order enough to drop a clearly-visible node from one pass to the next.
  Nodes with zero points are no longer selected as leaves regardless of
  SSE — they now always descend into their children if any exist, instead of
  a mask potentially hiding a populated child subtree behind an empty
  parent. (#45, #48)
- **LoD transitions could leave a visible gap.** `_updateLoD()` no longer
  hides a deselected node immediately; it now waits until the node's actual
  replacement (children on subdivision, parent on merge) is cached and
  shown before hiding it, keeping it visible and cache-pinned in the
  meantime. A deselected node with no such replacement in the new selection
  (e.g. it left the frustum) is still hidden immediately, as before. This
  fixed a visible flash-to-empty during zoom, most noticeable looking
  straight down at the data. (#58)

## [1.0.1] - 2026-07-31

### Fixed

- **Worker/wasm 404s in consumer builds.** `CopcDataSource.load()` previously
  constructed its Worker via `new Worker(new URL('./worker/worker.ts',
  import.meta.url))`. Our own build resolved this into a separately emitted
  chunk plus a hardcoded, root-absolute URL string
  (`new URL("/assets/worker-<hash>.js", import.meta.url)`) baked into
  `dist/copc-cesium.mjs`. That broke any real consumer in two independent
  ways:
  - A consumer's own bundler has no static import to trace through an
    already-built dependency, so it never copied the worker chunk or
    `laz-perf.wasm` into its own output — the files simply didn't exist at
    the referenced path after `vite build` (or equivalent) in a fresh app.
  - Even when the files were present (e.g. serving this repo's own `dist/`
    directly at the site root, which is how the original `npm pack`
    consumer-install check was performed), the leading `/` made the URL
    resolve from the origin root, breaking the moment the app was deployed
    under any sub-path.
  - Fix: the worker is now compiled into a Blob at our own build time
    (`?worker&inline`), and `laz-perf.wasm` is embedded inside that worker as
    a base64 string decoded to raw bytes and handed to
    `LazPerf.create({ wasmBinary })`, bypassing emscripten's `locateFile`/
    `fetch` path entirely. The published package now ships a single
    self-contained `dist/copc-cesium.mjs` with no separate worker chunk, no
    `dist/assets/`, and no runtime-fetched asset of any kind — nothing for a
    consumer's bundler or deploy path to break.
  - Added a regression test (`src/build.test.ts`) asserting the built output
    contains no `dist/assets` directory and no root-absolute `/assets/`
    reference.

### Changed

- Restructured `demo/` into `examples/basic-viewer/`, a standalone npm
  project that installs `copcesium` from the registry (not from this repo's
  `src/`), so it exercises the package the same way a real consumer does.
- Removed the now-unnecessary demo-specific dev/build wiring from the root
  `vite.config.ts` and `package.json` (`dev`/`preview` scripts,
  `vite-plugin-cesium` devDependency) — the root project now only builds the
  library.

## [1.0.0] - 2026-07-31

Initial release.

- `CopcDataSource`: COPC metadata/hierarchy loading, CRS auto-detection with
  manual `proj`/`projDef`/`geoidOffset` override, camera-driven screen-space-error
  LoD selection, a reusable `WorkerPool` for off-main-thread LAZ decoding, and
  node caching.
- ESM-only distribution (`dist/copc-cesium.mjs` + `.d.ts`); no CJS build,
  since `import.meta.url`-based Worker construction has no CJS equivalent.
- Published to npm and verified end-to-end via `npm pack` into a separate
  consumer project (ESM import, type resolution, asset presence).
