export const vertexShaderSource = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec4 color;
uniform float u_pixelSize;
out vec4 v_color;
void main() {
  v_color = color;
  gl_PointSize = u_pixelSize;
  vec4 p = czm_translateRelativeToEye(position3DHigh, position3DLow);
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}`;

export const fragmentShaderSource = `
in vec4 v_color;
out vec4 fragColor;
void main() {
  fragColor = v_color;
}`;
