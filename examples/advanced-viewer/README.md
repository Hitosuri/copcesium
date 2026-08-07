# copcesium example: advanced-viewer

A fuller reference viewer built on the published `copcesium` npm package: a
collapsible sidebar with tabbed sections (Data / Global / Appearance /
Filter / Points / Info / Help), preset datasets, per-color-mode legends, a
classification filter panel, terrain/imagery pickers, a camera/FPS HUD, and
light/dark theming.

See `examples/basic-viewer` for the minimal, unstyled reference this example
builds on top of — same public API (`CopcDataSource.load()`, live setters,
`destroy()`), just wired into a real app-shaped UI.

This is a standalone project — it installs `copcesium` from the npm
registry, not from this repo's `src/`.

## Run

```bash
npm install
cp .env.example .env   # optionally set VITE_CESIUM_TOKEN for Cesium Ion terrain/imagery
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
