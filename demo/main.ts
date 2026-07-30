import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { CopcDataSource } from '../src/index';
import type { CopcDataSourceOptions } from '../src/index';

Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_TOKEN ?? '';

const viewer = new Cesium.Viewer('cesiumContainer');

// Public COPC sample from https://github.com/PDAL/data/tree/main/autzen — Oregon
// Lambert (feet), so proj/projDef/geoidOffset are supplied explicitly instead of
// relying on CRS auto-detection.
const SAMPLE_URL = 'https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz';
const SAMPLE_OPTIONS: CopcDataSourceOptions = {
  proj: 'EPSG:2992',
  projDef:
    '+proj=lcc +lat_1=43 +lat_2=45.5 +lat_0=41.75 +lon_0=-120.5' +
    ' +x_0=399999.9999999999 +y_0=0 +datum=NAD83 +units=ft +no_defs',
  geoidOffset: -20,
};
// Autzen Stadium, Eugene, Oregon — where the sample dataset above is.
const SAMPLE_VIEW = Cesium.Cartesian3.fromDegrees(-123.0868, 44.0582, 1200);

const urlInput = document.getElementById('urlInput') as HTMLInputElement;
const loadBtn = document.getElementById('loadBtn') as HTMLButtonElement;
const reloadBtn = document.getElementById('reloadBtn') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const errorEl = document.getElementById('error')!;
const pixelSizeSlider = document.getElementById('pixelSize') as HTMLInputElement;
const pixelSizeValue = document.getElementById('pixelSizeValue')!;
const sseThresholdSlider = document.getElementById('sseThreshold') as HTMLInputElement;
const sseThresholdValue = document.getElementById('sseThresholdValue')!;

let currentDs: CopcDataSource | null = null;

async function load(url: string, options: CopcDataSourceOptions = {}): Promise<void> {
  if (currentDs) {
    currentDs.destroy();
    currentDs = null;
  }

  errorEl.textContent = '';
  statusEl.textContent = 'Loading…';
  loadBtn.disabled = true;
  reloadBtn.disabled = true;

  try {
    currentDs = await CopcDataSource.load(url, viewer, {
      ...options,
      pixelSize: parseFloat(pixelSizeSlider.value),
      sseThreshold: parseFloat(sseThresholdSlider.value),
    });
    statusEl.textContent = 'Loaded';
  } catch (err) {
    statusEl.textContent = '';
    errorEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    loadBtn.disabled = false;
    reloadBtn.disabled = !currentDs;
  }
}

loadBtn.addEventListener('click', () => void load(urlInput.value.trim()));

// destroy() + load() the same URL again, to manually confirm no leaked
// Workers/primitives across repeated cycles.
reloadBtn.addEventListener('click', () => void load(urlInput.value.trim()));

pixelSizeValue.textContent = pixelSizeSlider.value;
pixelSizeSlider.addEventListener('input', () => {
  pixelSizeValue.textContent = pixelSizeSlider.value;
  if (currentDs) currentDs.pixelSize = parseFloat(pixelSizeSlider.value);
});

sseThresholdValue.textContent = sseThresholdSlider.value;
sseThresholdSlider.addEventListener('input', () => {
  sseThresholdValue.textContent = sseThresholdSlider.value;
  if (currentDs) currentDs.sseThreshold = parseFloat(sseThresholdSlider.value);
});

urlInput.value = SAMPLE_URL;
void load(SAMPLE_URL, SAMPLE_OPTIONS);
viewer.camera.flyTo({ destination: SAMPLE_VIEW });
