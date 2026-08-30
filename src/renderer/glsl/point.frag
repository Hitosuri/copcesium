// Cesium's shader pipeline recognizes the literal output name "out_FragColor"
// (its own convention, e.g. PerInstanceFlatColorAppearanceFS) and both
// auto-injects its "layout(location = 0) out vec4 out_FragColor;"
// declaration AND regex-rewrites it for the translucent/OIT multi-render-
// target pass. Declaring it ourselves causes a "redefinition" compile error;
// using a different name (e.g. "fragColor") leaves the OIT derivation
// unrecognized and produces an unlocated extra output instead. So: reference
// out_FragColor, but don't declare it.
in vec4 v_color;
in float v_frontDepth;
void main() {
  vec2 uv = 2.0 * gl_PointCoord - 1.0;
  float d2 = dot(uv, uv);
  if (d2 > 1.0) discard;

#if defined(HQ_DEPTH_PASS)
  out_FragColor = czm_packDepth(v_frontDepth);
#elif defined(HQ_WEIGHTED)
  // potree's weighted_splats: premultiplied by a radial falloff, summed by
  // additive blending, divided back out by the composite pass.
  float weight = pow(1.0 - sqrt(d2), 1.5);
  out_FragColor = vec4(v_color.rgb * weight, weight);
#else
  out_FragColor = v_color;
#endif
}
