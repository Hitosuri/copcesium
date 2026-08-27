import * as Cesium from 'cesium';
import { CLASSIFICATION_COLORS, DEFAULT_CLASS_COLOR } from '../style/classificationColors';
import pointVert from './glsl/point.vert?raw';
import pointFrag from './glsl/point.frag?raw';
import compositeFrag from './glsl/composite.frag?raw';
import { VISIBLE_NODES_MAX_WALK } from './visibleNodes';

/** Colour mode as the shader sees it. Kept in sync with `ColorMode` in types.ts. */
export const COLOR_MODE = {
  rgb: 0,
  intensity: 1,
  classification: 2,
  elevation: 3,
} as const;

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
#define VISIBLE_NODES_MAX_WALK ${VISIBLE_NODES_MAX_WALK}

vec3 classificationColor(int c) {
${classificationBranches}
  return ${toVec3(DEFAULT_CLASS_COLOR)};
}
`;

export const vertexShaderSource: string = vertexPrelude + pointVert;
export const fragmentShaderSource = pointFrag;
export const compositeFragmentShaderSource = compositeFrag;
