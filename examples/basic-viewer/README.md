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
