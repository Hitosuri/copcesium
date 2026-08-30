uniform sampler2D u_splatColor;
uniform sampler2D u_splatDepth;
uniform sampler2D u_splatFrontDepth;
// Eye-dome lighting, potree's normalize_and_edl.fs: radius in pixels,
// strength 0 disables.
uniform float u_edlStrength;
uniform float u_edlRadius;
in vec2 v_textureCoordinates;

#define EDL_NEIGHBOURS 8

// The depth texture holds Cesium's log depth, log2(dist - near + 1) normalized
// by log2(far - near + 1); rescaling gives log2 units, which potree's
// `300.0 * strength` calibration expects.
float log2Depth(vec2 uv) {
  return texture(u_splatDepth, uv).r * czm_log2FarDepthFromNearPlusOne;
}

float edlResponse(float depth) {
  vec2 uvRadius = u_edlRadius / czm_viewport.zw;
  float sum = 0.0;
  for (int i = 0; i < EDL_NEIGHBOURS; i++) {
    float angle = 2.0 * czm_pi * float(i) / float(EDL_NEIGHBOURS);
    vec2 uv = v_textureCoordinates + uvRadius * vec2(cos(angle), sin(angle));
    if (texture(u_splatDepth, uv).r >= 1.0) continue;
    sum += max(0.0, depth - log2Depth(uv));
  }
  return sum / float(EDL_NEIGHBOURS);
}

void main() {
  float depth = texture(u_splatDepth, v_textureCoordinates).r;
  vec4 sum = texture(u_splatColor, v_textureCoordinates);
  if (depth >= 1.0 || sum.a <= 0.0) discard;

  vec3 rgb = sum.rgb / sum.a;
  if (u_edlStrength > 0.0) {
    float res = edlResponse(depth * czm_log2FarDepthFromNearPlusOne);
    rgb *= exp(-res * 300.0 * u_edlStrength);
  }

  out_FragColor = vec4(rgb, 1.0);
  gl_FragDepth = czm_unpackDepth(texture(u_splatFrontDepth, v_textureCoordinates));
}
