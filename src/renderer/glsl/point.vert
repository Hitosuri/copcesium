in vec3 position;
in vec4 color;
in float intensity;       // UNSIGNED_SHORT, normalized -> raw / 65535
in float classification;  // UNSIGNED_BYTE, normalized  -> code / 255
in float elevation;       // UNSIGNED_SHORT, normalized -> already 0..1 over the file's Z range
in vec3 localPos;         // UNSIGNED_SHORT x3, normalized -> 0..1 inside this node's cube

uniform float u_pixelSize;
// This node's world-space point spacing in meters (root spacing / 2^depth).
uniform float u_nodeSpacing;
// potree's visible-nodes texture (pointcloud.vs getLOD): one texel per drawn
// node in level order, R = child mask, G*256+B = offset to the first drawn
// child. u_vnStart is this node's texel, or -1 to size the whole node at
// u_nodeSpacing.
uniform sampler2D u_visibleNodes;
uniform float u_vnStart;
uniform int u_colorMode;
uniform vec2 u_intensityRange;  // raw LAS units, mapped to the ramp's 0..1
uniform ivec4 u_classMask[2];   // 256-bit allow-list, one bit per classification code
uniform float u_opacity;

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

  if (!classAllowed(c)) {
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
  } else {
    rgb = color.rgb;
  }

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

  if (u_nodeSpacing > 0.0) {
    float spacing = u_nodeSpacing;
    if (u_vnStart >= 0.0) spacing /= exp2(float(visibleLevelsBelow()));
    // 1.7 and the [2, 50] clamp are potree's own ADAPTIVE constants
    // (pointcloud.vs getPointSize: r = uOctreeSpacing * 1.7, minSize/maxSize).
    gl_PointSize = clamp(
      spacing * 1.7 * u_pixelSize * pixelsPerMetre / eyeDistance,
      2.0,
      50.0
    );
  } else {
    gl_PointSize = u_pixelSize;
  }

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
