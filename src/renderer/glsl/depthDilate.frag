uniform sampler2D u_splatFrontDepth;
// Dilation radius in pixels.
uniform float u_radius;
in vec2 v_textureCoordinates;

#define DILATE_NEIGHBOURS 8

// The depth pass clears u_splatFrontDepth to white, which unpacks to just over
// 1.0 - anything at or past 1.0 is a pixel no splat covered.
float frontDepth(vec2 uv) {
  return czm_unpackDepth(texture(u_splatFrontDepth, uv));
}

void main() {
  // The composite pass already wrote these pixels' depth.
  if (frontDepth(v_textureCoordinates) < 1.0) discard;

  float depth = 1.0;
  vec2 uvRadius = u_radius / czm_viewport.zw;
  for (int i = 0; i < DILATE_NEIGHBOURS; i++) {
    float angle = 2.0 * czm_pi * float(i) / float(DILATE_NEIGHBOURS);
    depth = min(depth, frontDepth(v_textureCoordinates + uvRadius * vec2(cos(angle), sin(angle))));
  }
  if (depth >= 1.0) discard;

  out_FragColor = vec4(0.0);
  gl_FragDepth = depth;
}
