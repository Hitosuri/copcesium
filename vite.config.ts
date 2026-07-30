import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';
import { resolve } from 'path';

export default defineConfig(({ command }) => {
  const isLibBuild = command === 'build';

  return {
    plugins: isLibBuild ? [] : [cesium()],
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
