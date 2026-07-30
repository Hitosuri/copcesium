import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

// Regression guard for issue #37: WorkerPool creates its Worker via
// `new URL('./worker/worker.ts', import.meta.url)`, which has no CJS
// equivalent — Rollup's CJS output silently rewrites `import.meta.url` to
// `undefined`, so `new URL(...)` throws for any CJS consumer the moment
// `CopcDataSource.load()` runs. Until the Worker is constructed some other
// way, this package must not ship a `require` entry point or a CJS build.
describe('package.json module format', () => {
  it('does not expose a CJS "require" export condition', () => {
    expect(pkg.exports['.']).not.toHaveProperty('require');
  });

  it('"main" resolves to an ESM (.mjs) file, not a CJS (.cjs) file', () => {
    expect(pkg.main).toMatch(/\.mjs$/);
  });
});
