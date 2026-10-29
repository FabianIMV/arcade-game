/**
 * gl3dx.js – utilidades GL compartidas (three.js sobre expo-gl): crear el renderer y comprobar la pantalla.
 */

export function makeRenderer(gl, THREE) {
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const canvas = { width: w, height: h, style: {}, clientWidth: w, clientHeight: h, addEventListener() {}, removeEventListener() {}, getContext: () => gl };
  // expo-gl (SDK 58) hace que su WebGL2RenderingContext herede de WebGLRenderingContext, y three.js
  // (r163+) rechaza todo `instanceof WebGLRenderingContext` creyendo que es WebGL 1. Si el contexto
  // es realmente WebGL 2, ocultamos ese global solo mientras se crea el renderer.
  const G = globalThis, W1 = G.WebGLRenderingContext;
  const isGL2 = gl.supportsWebGL2 === true || (typeof G.WebGL2RenderingContext === 'function' && gl instanceof G.WebGL2RenderingContext);
  const hide = isGL2 && typeof W1 !== 'undefined';
  let renderer;
  try {
    if (hide) G.WebGLRenderingContext = undefined;
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false });
  } finally {
    if (hide) G.WebGLRenderingContext = W1;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  return renderer;
}

// ¿se dibujó algo? (detecta pantallas negras)
export function probeGL(gl) {
  try {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight; const px = new Uint8Array(4); let ok = 0;
    for (const [a, b] of [[0.5, 0.5], [0.2, 0.8], [0.8, 0.2], [0.5, 0.15]]) { gl.readPixels(Math.floor(w * a), Math.floor(h * b), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (px[0] + px[1] + px[2] > 12) ok++; }
    return ok > 0;
  } catch (_) { return true; }
}
