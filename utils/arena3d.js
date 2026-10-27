/**
 * arena3d.js – motor 3D genérico (three.js sobre expo-gl) para TODOS los juegos.
 * Cada juego sigue usando sus coordenadas 2D (0..AREA_W × 0..AREA_H, origen arriba-izquierda)
 * y entrega una lista de objetos. Aquí se convierten en formas 3D con luz y sombra.
 *
 * Objeto: { x, y, w, h, c: color hex, s: forma, d: altura (px), e: brillo 0..1, a: opacidad }
 *   s: 'b' caja · 'o' esfera · 'c' cilindro · 'k' cono · 'p' pirámide · 'r' aro · 't' losa plana
 */
import { makeRenderer, probeGL } from './gl3dx';

const S = 1 / 40;                 // 40 px de juego = 1 unidad 3D
const MAX_PER_SHAPE = 400;

export function createArena({ gl, THREE, getState, aspect, W = 400, H = 600 }) {
  const renderer = makeRenderer(gl, THREE);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 500);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303048, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(-6, 14, 8); scene.add(sun);
  const rim = new THREE.PointLight(0x66ccff, 0.6, 60); rim.position.set(0, 6, -10); scene.add(rim);

  // suelo con rejilla
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W * S, H * S), new THREE.MeshLambertMaterial({ color: 0x14142a }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const grid = new THREE.GridHelper(Math.max(W, H) * S, 16, 0x2a3c66, 0x1c2644);
  grid.position.y = 0.01; scene.add(grid);

  const GEO = {
    b: new THREE.BoxGeometry(1, 1, 1),
    o: new THREE.SphereGeometry(0.5, 14, 10),
    c: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
    k: new THREE.ConeGeometry(0.5, 1, 12),
    p: new THREE.ConeGeometry(0.6, 1, 4),
    r: new THREE.TorusGeometry(0.5, 0.12, 8, 24),
    t: new THREE.BoxGeometry(1, 1, 1),
  };
  // pool de mallas por forma: se reutilizan entre frames
  const pool = {}; for (const k of Object.keys(GEO)) pool[k] = [];
  const used = {}; for (const k of Object.keys(GEO)) used[k] = 0;
  const meshFor = (s, i) => {
    const list = pool[s];
    if (!list[i]) { const m = new THREE.Mesh(GEO[s], new THREE.MeshLambertMaterial({ flatShading: true, transparent: true })); m.visible = false; scene.add(m); list[i] = m; }
    return list[i];
  };
  const alt = (o, w) => (o.d ? o.d * S : w);   // altura por defecto: igual al ancho

  return {
    frame() {
      const st = getState(); if (!st) return;
      const sprites = st.sprites || [];
      for (const k of Object.keys(used)) used[k] = 0;
      for (const o of sprites) {
        const s = GEO[o.s] ? o.s : 'b';
        const i = used[s]++; if (i >= MAX_PER_SHAPE) continue;
        const m = meshFor(s, i);
        const w = (o.w || 10) * S, dp = (o.h || o.w || 10) * S;
        const hgt = s === 't' ? 0.04 : alt(o, w);
        m.visible = true;
        m.position.set((o.x + (o.w || 0) / 2 - W / 2) * S, s === 't' ? 0.02 : hgt / 2, (o.y + (o.h || 0) / 2 - H / 2) * S);
        m.rotation.set(s === 'r' ? Math.PI / 2 : 0, 0, 0);
        if (s === 'o' || s === 'r') m.scale.set(w, w, w);
        else m.scale.set(w, hgt, dp);
        m.material.color.set(o.c || 0xffffff);
        m.material.emissive.setRGB(o.e || 0, o.e || 0, o.e || 0);
        m.material.opacity = o.a != null ? o.a : 1;
      }
      for (const k of Object.keys(pool)) for (let i = used[k]; i < pool[k].length; i++) pool[k][i].visible = false;
      // cámara: vista de tres cuartos desde arriba, encuadrando toda el área
      const wu = W * S, hu = H * S, D = Math.max(wu, hu) * 0.92;
      const sh = st.shake || 0;
      camera.position.set((Math.random() - 0.5) * sh * S, D * 1.05 + (Math.random() - 0.5) * sh * S, D * 0.62);
      camera.lookAt(0, 0, 0);
      if (st.bg != null) renderer.setClearColor(st.bg, 1);
      renderer.render(scene, camera);
    },
    probe: () => probeGL(gl),
    dispose() { try { renderer.dispose(); } catch (_) {} },
  };
}
