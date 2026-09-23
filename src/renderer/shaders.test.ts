import { describe, expect, it } from 'vitest';
import * as Cesium from 'cesium';
import {
  CLIP_MAX_POINTS,
  CLIP_MODE,
  COLOR_MODE,
  POINT_SIZE_MODE,
  buildClassMask,
  buildClip,
  vertexShaderSource,
} from './shaders';
import { CLASSIFICATION_COLORS, DEFAULT_CLASS_COLOR } from '../style/classificationColors';

/** Mirrors `classAllowed()` in the vertex shader, so the two encodings stay tied together. */
function allowedInMask(mask: ReturnType<typeof buildClassMask>, code: number): boolean {
  const word = code >> 5;
  const vec = mask[word >> 2];
  const bits = [vec.x, vec.y, vec.z, vec.w][word & 3];
  return ((bits >> (code & 31)) & 1) !== 0;
}

describe('buildClassMask', () => {
  it('allows every classification code when no filter is given', () => {
    const mask = buildClassMask(undefined);

    for (const code of [0, 1, 2, 31, 32, 127, 128, 200, 255]) {
      expect(allowedInMask(mask, code)).toBe(true);
    }
  });

  it('allows exactly the listed codes and nothing else', () => {
    const mask = buildClassMask([2, 6]);

    expect(allowedInMask(mask, 2)).toBe(true);
    expect(allowedInMask(mask, 6)).toBe(true);
    for (const code of [0, 1, 3, 5, 7, 9, 255]) {
      expect(allowedInMask(mask, code)).toBe(false);
    }
  });

  it('sets bits in the right word for codes above 31, where word packing kicks in', () => {
    // 32 and 64 land in words 1 and 2 — a mask that only ever set word 0 would
    // pass the low-code cases above and still be wrong here.
    const mask = buildClassMask([32, 64, 255]);

    expect(allowedInMask(mask, 32)).toBe(true);
    expect(allowedInMask(mask, 64)).toBe(true);
    expect(allowedInMask(mask, 255)).toBe(true);
    expect(allowedInMask(mask, 0)).toBe(false);
    expect(allowedInMask(mask, 63)).toBe(false);
  });

  it('allows nothing for an empty filter, rather than falling back to everything', () => {
    const mask = buildClassMask([]);

    for (const code of [0, 2, 6, 128, 255]) {
      expect(allowedInMask(mask, code)).toBe(false);
    }
  });

  it('rejects a value that is not a LAS classification code', () => {
    expect(() => buildClassMask([256])).toThrow(RangeError);
    expect(() => buildClassMask([-1])).toThrow(RangeError);
    expect(() => buildClassMask([2.5])).toThrow(RangeError);
  });
});

describe('buildClip', () => {
  const viewProjection = Cesium.Matrix4.IDENTITY;

  it('returns undefined when no clip is given', () => {
    expect(buildClip(undefined)).toBeUndefined();
  });

  it('pads the polygon to the shader array length and keeps the real count', () => {
    const clip = buildClip({
      viewProjection,
      points: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      mode: 'outside',
    })!;

    expect(clip.points).toHaveLength(CLIP_MAX_POINTS);
    expect(clip.count).toBe(3);
    expect(clip.points[1]).toEqual(new Cesium.Cartesian2(1, 0));
    expect(clip.mode).toBe(CLIP_MODE.outside);
  });

  it('rejects a polygon the shader array cannot hold, or one with no area', () => {
    const tooMany = Array.from({ length: CLIP_MAX_POINTS + 1 }, (_, i) => [i, i] as [number, number]);
    expect(() => buildClip({ viewProjection, points: tooMany, mode: 'inside' })).toThrow(RangeError);
    expect(() =>
      buildClip({
        viewProjection,
        points: [
          [0, 0],
          [1, 1],
        ],
        mode: 'inside',
      }),
    ).toThrow(RangeError);
  });
});

describe('vertexShaderSource', () => {
  it('generates one palette branch per classification entry, plus the default', () => {
    for (const [code, [r, g, b]] of Object.entries(CLASSIFICATION_COLORS)) {
      const expected = `if (c == ${code}) return vec3(${(r / 255).toFixed(4)}, ${(g / 255).toFixed(4)}, ${(b / 255).toFixed(4)});`;
      expect(vertexShaderSource).toContain(expected);
    }
    expect(vertexShaderSource).toContain(`return vec3(${(DEFAULT_CLASS_COLOR[0] / 255).toFixed(4)}`);
  });

  it('branches on the same colour mode numbers the TypeScript side sends', () => {
    expect(vertexShaderSource).toContain(`#define COLOR_MODE_INTENSITY ${COLOR_MODE.intensity}`);
    expect(vertexShaderSource).toContain(
      `#define COLOR_MODE_CLASSIFICATION ${COLOR_MODE.classification}`,
    );
    expect(vertexShaderSource).toContain(`#define COLOR_MODE_ELEVATION ${COLOR_MODE.elevation}`);
    expect(vertexShaderSource).toContain(`#define COLOR_MODE_LOD ${COLOR_MODE.lod}`);
    expect(vertexShaderSource).toContain('u_colorMode == COLOR_MODE_INTENSITY');
    expect(vertexShaderSource).toContain('u_colorMode == COLOR_MODE_CLASSIFICATION');
    expect(vertexShaderSource).toContain('u_colorMode == COLOR_MODE_ELEVATION');
    expect(vertexShaderSource).toContain('u_colorMode == COLOR_MODE_LOD');
    // 'rgb' is the else branch, so it must not have a comparison of its own.
    expect(vertexShaderSource).not.toContain('COLOR_MODE_RGB');
  });

  it('branches on the same point size mode numbers the TypeScript side sends', () => {
    expect(vertexShaderSource).toContain(
      `#define POINT_SIZE_MODE_ATTENUATED ${POINT_SIZE_MODE.attenuated}`,
    );
    expect(vertexShaderSource).toContain(`#define POINT_SIZE_MODE_ADAPTIVE ${POINT_SIZE_MODE.adaptive}`);
    expect(vertexShaderSource).toContain('u_pointSizeMode == POINT_SIZE_MODE_ATTENUATED');
    expect(vertexShaderSource).toContain('u_pointSizeMode == POINT_SIZE_MODE_ADAPTIVE');
  });

  it('declares the attributes and uniforms the primitive binds', () => {
    for (const decl of [
      'in float intensity;',
      'in float classification;',
      'in float elevation;',
      'uniform int u_pointSizeMode;',
      'uniform int u_colorMode;',
      'uniform float u_depth;',
      'uniform vec2 u_intensityRange;',
      'uniform ivec4 u_classMask[2];',
      'uniform float u_opacity;',
      'uniform int u_filterMode;',
      'uniform vec3 u_filterColor;',
      'uniform float u_filterTolerance;',
      'uniform vec3 u_filterPaint;',
    ]) {
      expect(vertexShaderSource).toContain(decl);
    }
  });
});
