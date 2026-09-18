in vec3 position;
in vec4 color;
in float intensity;       // UNSIGNED_SHORT, normalized -> raw / 65535
in float classification;  // UNSIGNED_BYTE, normalized  -> code / 255
in float elevation;       // UNSIGNED_SHORT, normalized -> already 0..1 over the file's Z range
in vec3 localPos;         // UNSIGNED_SHORT x3, normalized -> 0..1 inside this node's cube

uniform float u_pixelSize;
uniform int u_pointSizeMode;
// World-space point spacing in meters: this node's (root spacing / 2^depth) in
// ADAPTIVE, the cloud's average drawn point spacing in ATTENUATED.
uniform float u_nodeSpacing;
// potree's visible-nodes texture (pointcloud.vs getLOD): one texel per drawn
// node in level order, R = child mask, G*256+B = offset to the first drawn
// child. u_vnStart is this node's texel, or -1 to size the whole node at
// u_nodeSpacing.
uniform sampler2D u_visibleNodes;
uniform float u_vnStart;
uniform int u_colorMode;
uniform float u_depth;          // this node's octree depth, for COLOR_MODE_LOD
uniform vec2 u_intensityRange;  // raw LAS units, mapped to the ramp's 0..1
uniform ivec4 u_classMask[2];   // 256-bit allow-list, one bit per classification code
uniform float u_opacity;
uniform int u_filterMode;
uniform vec3 u_filterColor;
uniform float u_filterTolerance;  // 0..1, fraction of FILTER_MAX_DISTANCE
uniform vec3 u_filterPaint;

// Lightness weight in the filter distance: below 1 a shaded and a lit point of
// the same hue read as close, so a picked colour catches the whole surface.
#define FILTER_LIGHTNESS_WEIGHT 0.25
// Widest sRGB-gamut Oklab distance at that weight, so tolerance 1 matches every colour.
#define FILTER_MAX_DISTANCE 0.6

// Björn Ottosson's Oklab from gamma-encoded sRGB.
vec3 oklab(vec3 c) {
  c = pow(c, vec3(2.2));
  vec3 lms = vec3(
    0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  lms = pow(lms, vec3(1.0 / 3.0));
  return vec3(
    0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
    0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
}

float filterDistance(vec3 a, vec3 b) {
  vec3 d = oklab(a) - oklab(b);
  d.x *= FILTER_LIGHTNESS_WEIGHT;
  return length(d);
}

out vec4 v_color;
out float v_frontDepth;

// classificationColor(int) and the COLOR_MODE_* defines are generated in shaders.ts.

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

// Levels below this node at which a drawn descendant still contains this
// point: walk the visible-nodes texture down through the point's own octants
// until the child there is not drawn.
int visibleLevelsBelow() {
  int texel = int(u_vnStart);
  int below = 0;
  for (int i = 0; i < VISIBLE_NODES_MAX_WALK; i++) {
    ivec3 cell = ivec3(localPos * exp2(float(i + 1))) & 1;
    int octant = cell.x * 4 + cell.y * 2 + cell.z;
    ivec4 value = ivec4(texelFetch(u_visibleNodes, ivec2(texel, 0), 0) * 255.0 + 0.5);
    int mask = value.r;
    if ((mask & (1 << octant)) == 0) break;
    int before = mask & ((1 << octant) - 1);
    // popcount of the lower bits: drawn siblings before this octant
    before = before - ((before >> 1) & 0x55);
    before = (before & 0x33) + ((before >> 2) & 0x33);
    before = (before + (before >> 4)) & 0x0F;
    texel += value.g * 256 + value.b + before;
    below++;
  }
  return below;
}

void main() {
  int c = int(classification * 255.0 + 0.5);

  bool filtered = u_filterMode != COLOR_FILTER_MODE_OFF &&
    filterDistance(color.rgb, u_filterColor) > u_filterTolerance * FILTER_MAX_DISTANCE;

  if (!classAllowed(c) || (filtered && u_filterMode == COLOR_FILTER_MODE_HIDE)) {
    // Outside clip space, so the point is culled before it ever rasterizes.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    v_color = vec4(0.0);
    return;
  }

  vec3 rgb;
  if (u_colorMode == COLOR_MODE_INTENSITY) {
    float raw = intensity * 65535.0;
    float span = max(u_intensityRange.y - u_intensityRange.x, 1.0);
    rgb = vec3(clamp((raw - u_intensityRange.x) / span, 0.0, 1.0));
  } else if (u_colorMode == COLOR_MODE_CLASSIFICATION) {
    rgb = classificationColor(c);
  } else if (u_colorMode == COLOR_MODE_ELEVATION) {
    rgb = elevationColor(elevation);
  } else if (u_colorMode == COLOR_MODE_LOD) {
    // potree's LEVEL_OF_DETAIL: getLOD() / 10 through the same ramp, where getLOD() is
    // the deepest drawn node containing the point, not the node the point was loaded with.
    float lod = u_depth;
    if (u_vnStart >= 0.0) lod += float(visibleLevelsBelow());
    rgb = elevationColor(lod / 10.0);
  } else {
    rgb = color.rgb;
  }

  if (filtered) rgb = u_filterPaint;
  v_color = vec4(rgb, color.a * u_opacity);
  // position is a node-relative offset (model coordinates); the node origin
  // rides in the model matrix. Reconstruct the eye-relative position the way
  // czm_translateRelativeToEye does, but from a single Float32 offset - the
  // precision comes from the double-precision origin baked into the matrix.
  vec3 eyeRel = position - czm_encodedCameraPositionMCHigh - czm_encodedCameraPositionMCLow;
  gl_Position = czm_modelViewProjectionRelativeToEye * vec4(eyeRel, 1.0);

  vec4 eyePosition = czm_modelViewRelativeToEye * vec4(eyeRel, 1.0);
  float eyeDistance = max(-eyePosition.z, 1.0);
  // czm_projection[1][1] is 1/tan(fovy/2), so this is the vertical pixels a
  // one-metre span one metre from the eye covers.
  float pixelsPerMetre = 0.5 * czm_viewport.w * czm_projection[1][1];

  // potree's pointcloud.vs getPointSize: r = uOctreeSpacing * 1.7 in ADAPTIVE,
  // minSize/maxSize [2, 50] for all three.
  float pointSize = u_pixelSize;
  if (u_pointSizeMode == POINT_SIZE_MODE_ADAPTIVE) {
    float spacing = u_nodeSpacing;
    if (u_vnStart >= 0.0) spacing /= exp2(float(visibleLevelsBelow()));
    pointSize = spacing * 1.7 * u_pixelSize * pixelsPerMetre / eyeDistance;
  } else if (u_pointSizeMode == POINT_SIZE_MODE_ATTENUATED) {
    // Not potree's formula: its ATTENUATED reads a per-point `spacing`
    // attribute no loader fills, which pins the mode at minSize there.
    pointSize = u_nodeSpacing * 1.7 * u_pixelSize * pixelsPerMetre / eyeDistance;
  }
  gl_PointSize = clamp(pointSize, 2.0, 50.0);

#ifdef HQ_DEPTH_PASS
  v_frontDepth = log2((gl_Position.w - czm_currentFrustum.x) + 1.0) * czm_oneOverLog2FarDepthFromNearPlusOne;
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
}
