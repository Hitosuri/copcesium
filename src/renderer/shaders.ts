import * as Cesium from 'cesium';
import { CLASSIFICATION_COLORS, DEFAULT_CLASS_COLOR } from '../style/classificationColors';

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
    words.fill(-1); // every bit set — all 256 codes allowed
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

export const vertexShaderSource = `
in vec3 position;
in vec4 color;
in float intensity;       // UNSIGNED_SHORT, normalized -> raw / 65535
in float classification;  // UNSIGNED_BYTE, normalized  -> code / 255
in float elevation;       // UNSIGNED_SHORT, normalized -> already 0..1 over the file's Z range

uniform float u_pixelSize;
// This node's world-space point spacing in meters (root spacing / 2^depth).
uniform float u_nodeSpacing;
uniform int u_colorMode;
uniform vec2 u_intensityRange;  // raw LAS units, mapped to the ramp's 0..1
uniform ivec4 u_classMask[2];   // 256-bit allow-list, one bit per classification code
uniform float u_opacity;

out vec4 v_color;

vec3 classificationColor(int c) {
${classificationBranches}
  return ${toVec3(DEFAULT_CLASS_COLOR)};
}

vec3 elevationColor(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.25) return mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 1.0), t * 4.0);
  if (t < 0.50) return mix(vec3(0.0, 1.0, 1.0), vec3(0.0, 1.0, 0.0), (t - 0.25) * 4.0);
  if (t < 0.75) return mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.50) * 4.0);
  return mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), (t - 0.75) * 4.0);
}

// 256 codes packed into 8 int32 words: word = c / 32, bit = c % 32. Cesium's
// uniform layer has no unsigned-int setter (createUniform throws on uvec*),
// so the words are signed and "all allowed" is -1 rather than 0xFFFFFFFF.
bool classAllowed(int c) {
  int word = c >> 5;
  int bits = u_classMask[word >> 2][word & 3];
  return ((bits >> (c & 31)) & 1) != 0;
}

void main() {
  int c = int(classification * 255.0 + 0.5);

  if (!classAllowed(c)) {
    // Outside clip space, so the point is culled before it ever rasterizes.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    v_color = vec4(0.0);
    return;
  }

  vec3 rgb;
  if (u_colorMode == ${COLOR_MODE.intensity}) {
    float raw = intensity * 65535.0;
    float span = max(u_intensityRange.y - u_intensityRange.x, 1.0);
    rgb = vec3(clamp((raw - u_intensityRange.x) / span, 0.0, 1.0));
  } else if (u_colorMode == ${COLOR_MODE.classification}) {
    rgb = classificationColor(c);
  } else if (u_colorMode == ${COLOR_MODE.elevation}) {
    rgb = elevationColor(elevation);
  } else {
    rgb = color.rgb;
  }

  v_color = vec4(rgb, color.a * u_opacity);
  // position is a node-relative offset (model coordinates); the node origin
  // rides in the model matrix. Reconstruct the eye-relative position the way
  // czm_translateRelativeToEye does, but from a single Float32 offset — the
  // precision comes from the double-precision origin baked into the matrix.
  vec3 eyeRel = position - czm_encodedCameraPositionMCHigh - czm_encodedCameraPositionMCLow;
  gl_Position = czm_modelViewProjectionRelativeToEye * vec4(eyeRel, 1.0);

  vec4 eyePosition = czm_modelViewRelativeToEye * vec4(eyeRel, 1.0);
  float eyeDistance = max(-eyePosition.z, 1.0);
  // czm_projection[1][1] is 1/tan(fovy/2), so this is the vertical pixels a
  // one-metre span one metre from the eye covers.
  float pixelsPerMetre = 0.5 * czm_viewport.w * czm_projection[1][1];

  if (u_nodeSpacing > 0.0) {
    // 1.7 and the [2, 50] clamp are potree's own ADAPTIVE constants
    // (pointcloud.vs getPointSize: r = uOctreeSpacing * 1.7, minSize/maxSize).
    gl_PointSize = clamp(
      u_nodeSpacing * 1.7 * u_pixelSize * pixelsPerMetre / eyeDistance,
      2.0,
      50.0
    );
  } else {
    gl_PointSize = u_pixelSize;
  }

#ifdef HQ_DEPTH_PASS
  // potree's hq_depth_pass: push the depth back by two splat radii so the
  // attribute pass, depth-testing against it, blends every splat within that
  // band instead of only the frontmost one.
  float radius = gl_PointSize * eyeDistance / pixelsPerMetre;
  float adjust = (eyeDistance + 2.0 * radius) / eyeDistance;
  gl_Position = czm_projection * vec4(eyePosition.xyz * adjust, 1.0);
#endif

  // Cesium's log-depth derivation writes gl_FragDepth, which disables early
  // depth testing. A point is one vertex, so czm_writeLogDepth's encoding is
  // exact here; the fragment programs define LOG_DEPTH_READ_ONLY to skip it.
  float logDepth = log2((gl_Position.w - czm_currentFrustum.x) + 1.0) * czm_oneOverLog2FarDepthFromNearPlusOne;
  gl_Position.z = (logDepth * 2.0 - 1.0) * gl_Position.w;
}`;

// Cesium's shader pipeline recognizes the literal output name "out_FragColor"
// (its own convention, e.g. PerInstanceFlatColorAppearanceFS) and both
// auto-injects its "layout(location = 0) out vec4 out_FragColor;"
// declaration AND regex-rewrites it for the translucent/OIT multi-render-
// target pass. Declaring it ourselves causes a "redefinition" compile error;
// using a different name (e.g. "fragColor") leaves the OIT derivation
// unrecognized and produces an unlocated extra output instead. So: reference
// out_FragColor, but don't declare it.
export const fragmentShaderSource = `
in vec4 v_color;
void main() {
  vec2 uv = 2.0 * gl_PointCoord - 1.0;
  float d2 = dot(uv, uv);
  if (d2 > 1.0) discard;

#ifdef HQ_WEIGHTED
  // potree's weighted_splats: premultiplied by a radial falloff, summed by
  // additive blending, divided back out by the composite pass.
  float weight = pow(1.0 - sqrt(d2), 1.5);
  out_FragColor = vec4(v_color.rgb * weight, weight);
#else
  out_FragColor = v_color;
#endif
}`;

export const compositeFragmentShaderSource = `
uniform sampler2D u_splatColor;
uniform sampler2D u_splatDepth;
in vec2 v_textureCoordinates;
void main() {
  float depth = texture(u_splatDepth, v_textureCoordinates).r;
  vec4 sum = texture(u_splatColor, v_textureCoordinates);
  if (depth >= 1.0 || sum.a <= 0.0) discard;

  out_FragColor = vec4(sum.rgb / sum.a, 1.0);
  gl_FragDepth = depth;
}`;
