import type { CopcDataSourceOptions } from 'copcesium';

export interface SampleDataset {
  label: string;
  url: string;
  options: CopcDataSourceOptions;
}

// Freely streamable public COPC files (HTTP range requests, no auth). Sizes
// are the full file size (measured via HTTP HEAD), not what gets downloaded —
// copcesium only fetches the octree nodes needed for the current view. Autzen
// stays first as the project's default demo; the rest are sorted by size,
// ascending. Mirrors examples/basic-viewer/main.ts's SAMPLE_DATASETS.
export const SAMPLE_DATASETS: SampleDataset[] = [
  {
    // https://github.com/PDAL/data/tree/main/autzen — Oregon Lambert (feet),
    // so proj/projDef/geoidOffset are supplied explicitly instead of relying
    // on CRS auto-detection.
    label: 'Autzen Stadium — Eugene, Oregon, USA (~81 MB)',
    url: 'https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz',
    options: {
      proj: 'EPSG:2992',
      projDef:
        '+proj=lcc +lat_1=43 +lat_2=45.5 +lat_0=41.75 +lon_0=-120.5' +
        ' +x_0=399999.9999999999 +y_0=0 +datum=NAD83 +units=ft +no_defs',
      geoidOffset: -20,
    },
  },
  {
    label: 'USGS Breakline Eval — Adams/Juneau County, Wisconsin, USA (~521 KB)',
    url: 'https://s3.amazonaws.com/hobu-lidar/usgs-breakline-eval.copc.laz',
    options: {},
  },
  {
    label: 'CN Tower (Height Above Ground) — Toronto, Canada (~7.3 MB)',
    url: 'https://s3.amazonaws.com/hobu-lidar/cn-tower-20-50m-HAG.copc.laz',
    options: {},
  },
  {
    label: 'Red Rocks (Large) — Colorado, USA (~13.2 MB)',
    url: 'https://s3.amazonaws.com/hobu-lidar/redrocks.large.copc.laz',
    options: {},
  },
  {
    label: 'Hobu Office (Random Forest Model) (~19.1 MB)',
    url: 'https://s3.amazonaws.com/hobu-lidar/hobu-office-random-forest-ma-model.copc.laz',
    options: {},
  },
];

// ASPRS codes the classification palette covers, plus 1 (Unclassified), which
// most of this sample's points carry.
export const CLASSES: [code: number, name: string][] = [
  [1, 'Unclassified'],
  [2, 'Ground'],
  [3, 'Low Veg'],
  [4, 'Med Veg'],
  [5, 'High Veg'],
  [6, 'Building'],
  [9, 'Water'],
  [10, 'Rail'],
  [11, 'Road'],
];
