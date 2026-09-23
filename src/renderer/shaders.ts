import * as Cesium from 'cesium';
import { CLASSIFICATION_COLORS, DEFAULT_CLASS_COLOR } from '../style/classificationColors';
import pointVert from './glsl/point.vert?raw';
import pointFrag from './glsl/point.frag?raw';
import compositeFrag from './glsl/composite.frag?raw';
import depthDilateFrag from './glsl/depthDilate.frag?raw';
import { VISIBLE_NODES_MAX_WALK } from './visibleNodes';
import type { ClipPolygon, ColorFilter } from '../types';
import type { PointStyle } from './PointCloudPrimitive';

/** Colour mode as the shader sees it. Kept in sync with `ColorMode` in types.ts. */
export const COLOR_MODE = {
  rgb: 0,
  intensity: 1,
  classification: 2,
  elevation: 3,
  lod: 4,
} as const;

/** Point size mode as the shader sees it. Kept in sync with `PointSizeMode` in types.ts. */
export const POINT_SIZE_MODE = {
  fixed: 0,
  attenuated: 1,
  adaptive: 2,
} as const;

/** Colour filter mode as the shader sees it. Kept in sync with `ColorFilter['mode']` in types.ts. */
export const COLOR_FILTER_MODE = {
  off: 0,
  paint: 1,
  hide: 2,
} as const;

export function buildColorFilter(filter: ColorFilter | undefined): PointStyle['colorFilter'] {
  if (!filter) return undefined;
  return {
    color: Cesium.Cartesian3.fromArray(filter.color),
    tolerance: filter.tolerance,
    mode: COLOR_FILTER_MODE[filter.mode],
    paint: Cesium.Cartesian3.fromArray(filter.paint ?? [0, 0, 0]),
  };
}

/** Clip mode as the shader sees it. Kept in sync with `ClipPolygon['mode']` in types.ts. */
export const CLIP_MODE = {
  off: 0,
  highlight: 1,
  inside: 2,
  outside: 3,
} as const;

export const CLIP_MAX_POINTS = 64;

const DEFAULT_CLIP_COLOR: [number, number, number] = [1, 1, 0];

export function buildClip(clip: ClipPolygon | undefined): PointStyle['clip'] {
  if (!clip) return undefined;
  const { points } = clip;
  if (points.length < 3 || points.length > CLIP_MAX_POINTS) {
    throw new RangeError(`clip expects 3-${CLIP_MAX_POINTS} polygon points, got ${points.length}`);
  }
  return {
    viewProjection: Cesium.Matrix4.clone(clip.viewProjection),
    points: Array.from({ length: CLIP_MAX_POINTS }, (_, i) =>
      i < points.length
        ? new Cesium.Cartesian2(points[i][0], points[i][1])
        : new Cesium.Cartesian2(),
    ),
    count: points.length,
    mode: CLIP_MODE[clip.mode],
    color: Cesium.Cartesian3.fromArray(clip.color ?? DEFAULT_CLIP_COLOR),
  };
}

/**
 * Packs classification codes into the 8 signed 32-bit words `classAllowed()`
 * below reads. `undefined` means "no filter" and sets every bit.
 *
 * Lives next to the GLSL that decodes it so the two halves of the encoding
 * can't be changed independently.
 */
export function buildClassMask(filter: number[] | undefined): Cesium.Cartesian4[] {
  const words = new Int32Array(8);
  if (filter === undefined) {
    words.fill(-1); // every bit set - all 256 codes allowed
  } else {
    for (const code of filter) {
      if (!Number.isInteger(code) || code < 0 || code > 255) {
        throw new RangeError(
          `classificationFilter expects LAS classification codes (integers 0-255), got ${code}`,
        );
      }
      words[code >> 5] |= 1 << (code & 31);
    }
  }
  return [
    new Cesium.Cartesian4(words[0], words[1], words[2], words[3]),
    new Cesium.Cartesian4(words[4], words[5], words[6], words[7]),
  ];
}

function toVec3([r, g, b]: [number, number, number]): string {
  return `vec3(${(r / 255).toFixed(4)}, ${(g / 255).toFixed(4)}, ${(b / 255).toFixed(4)})`;
}

// Generated from the table the worker also uses, so the palette can't drift
// between the CPU fallback path and this GPU colour mode. Eight comparisons
// against a uniform-free constant chain costs less than a texture lookup.
const classificationBranches = Object.entries(CLASSIFICATION_COLORS)
  .map(([code, rgb]) => `  if (c == ${code}) return ${toVec3(rgb)};`)
  .join('\n');

const vertexPrelude = `
#define COLOR_MODE_INTENSITY ${COLOR_MODE.intensity}
#define COLOR_MODE_CLASSIFICATION ${COLOR_MODE.classification}
#define COLOR_MODE_ELEVATION ${COLOR_MODE.elevation}
#define COLOR_MODE_LOD ${COLOR_MODE.lod}
#define POINT_SIZE_MODE_ATTENUATED ${POINT_SIZE_MODE.attenuated}
#define POINT_SIZE_MODE_ADAPTIVE ${POINT_SIZE_MODE.adaptive}
#define COLOR_FILTER_MODE_OFF ${COLOR_FILTER_MODE.off}
#define COLOR_FILTER_MODE_HIDE ${COLOR_FILTER_MODE.hide}
#define VISIBLE_NODES_MAX_WALK ${VISIBLE_NODES_MAX_WALK}
#define CLIP_MODE_OFF ${CLIP_MODE.off}
#define CLIP_MODE_HIGHLIGHT ${CLIP_MODE.highlight}
#define CLIP_MODE_INSIDE ${CLIP_MODE.inside}
#define CLIP_MODE_OUTSIDE ${CLIP_MODE.outside}
#define CLIP_MAX_POINTS ${CLIP_MAX_POINTS}

vec3 classificationColor(int c) {
${classificationBranches}
  return ${toVec3(DEFAULT_CLASS_COLOR)};
}
`;

export const vertexShaderSource: string = vertexPrelude + pointVert;
export const fragmentShaderSource = pointFrag;
export const compositeFragmentShaderSource = compositeFrag;
export const depthDilateFragmentShaderSource = depthDilateFrag;
