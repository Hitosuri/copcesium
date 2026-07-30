import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const LAZ_WASM = resolve(__dirname, 'node_modules/laz-perf/lib/web/laz-perf.wasm');

/**
 * `worker.ts` needs `laz-perf.wasm` as a real same-origin file, not the
 * base64 `data:` URI Vite would otherwise inline it as. A `data:` URI has an
 * opaque origin, and errors thrown while instantiating/using the WASM module
 * loaded from one get muted by the browser (message/filename/error all come
 * back `undefined`) — that made a real decode failure undiagnosable (#B10).
 *
 * - dev:   middleware answers any request containing `laz-perf.wasm` with the
 *          real file, so `worker.ts`'s `new URL('laz-perf.wasm', import.meta.url)`
 *          resolves under `npm run dev` too.
 * - build: `generateBundle` emits it into `assets/`, next to the worker
 *          chunk, since `new URL('laz-perf.wasm', import.meta.url)` resolves
 *          relative to that chunk's own emitted location.
 */
const lazPerfWasmPlugin = {
  name: 'laz-perf-wasm',

  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url.includes('laz-perf.wasm')) {
        res.setHeader('Content-Type', 'application/wasm');
        res.end(readFileSync(LAZ_WASM));
        return;
      }
      next();
    });
  },

  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'assets/laz-perf.wasm',
      source: readFileSync(LAZ_WASM),
    });
  },
};

export default defineConfig(({ command }) => {
  const isLibBuild = command === 'build';

  return {
    plugins: [lazPerfWasmPlugin, ...(isLibBuild ? [] : [cesium()])],
    // worker.ts references `import.meta.url` (for the laz-perf.wasm URL
    // above); that's only valid in ES module output, not Vite's default IIFE
    // worker format.
    worker: {
      format: 'es',
    },
    build: {
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'CopcCesium',
        // CJS output is intentionally not built: WorkerPool creates its Worker
        // via `new URL('./worker/worker.ts', import.meta.url)`, and
        // `import.meta.url` has no CJS equivalent — Rollup's CJS output
        // silently rewrites it to `undefined`, so `new URL(...)` throws the
        // moment a CJS consumer calls `CopcDataSource.load()`. See issue #37.
        formats: ['es'],
        fileName: () => 'copc-cesium.mjs',
      },
      rollupOptions: {
        external: ['cesium'],
      },
    },
  };
});
