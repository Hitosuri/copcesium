# copcesium example: basic-viewer

Minimal, unstyled example that loads a COPC point cloud into a CesiumJS
viewer using the published `copcesium` npm package. This is a standalone
project — it installs `copcesium` from the npm registry, not from this
repo's `src/`.

## Run

```bash
npm install
cp .env.example .env   # optionally set VITE_CESIUM_TOKEN for Cesium Ion imagery
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Developing against this repo's `src/` instead

`npm run dev:src` runs the same example but aliases the `copcesium` import to
`../../src`, so a change to this repo's source is visible in the browser
immediately via Vite HMR — no build, `npm pack`, or publish step. `main.ts`
and `index.html` are unchanged; only where `copcesium` resolves to differs.

`npm run dev` (no `:src`) remains the way to verify the *published* package,
since it installs `copcesium` from the npm registry like a real consumer.
Neither mode covers "does the build I'm about to publish work" — for that,
pack the build and install it here **with `--no-save`**:

```bash
cd ../..
npm run build && npm pack
cd examples/basic-viewer
npm install ../../copcesium-<version>.tgz --no-save   # --no-save is required
npm run dev
```

`--no-save` keeps `package.json` and `package-lock.json` untouched. Without
it, npm rewrites both to point at `file:../../copcesium-<version>.tgz`, a path
that doesn't exist for anyone else — committing that broke clean installs in
#69. Afterwards, restore with `npm ci` and delete the `.tgz`.
