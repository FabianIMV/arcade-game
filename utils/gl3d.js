/**
 * gl3d.js – escena 3D (three.js sobre expo-gl) para el juego "Mundo 3D".
 * Lógica pura: recibe el contexto GL y el módulo THREE, no depende de React.
 * Mundo: terreno suave, bosques/rocas/casas/torres/montañas instanciados,
 * cristales, monedas, animales y lobos, ciclo día/noche con niebla.
 */
import { OW_N, owHeight } from './ow';

const ANIMAL_COL = { '🐄': 0xeeeeee, '🐑': 0xf4f4ee, '🦌': 0x996038, '🐇': 0xd2c8be, '🐖': 0xf0aaaa };
const lerp = (a, b, t) => a + (b - a) * t;

export function createGLWorld({ gl, THREE, world, aspectRatio }) {
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const canvas = { width: w, height: h, style: {}, clientWidth: w, clientHeight: h, addEventListener() {}, removeEventListener() {}, getContext: () => gl };
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, aspectRatio || w / h, 0.08, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a5a2a, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2cf, 1.1); scene.add(sun); scene.add(sun.target);
  const mat = (c, extra) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...extra });

  // sol, luna y estrellas
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff0b0, fog: false }));
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false }));
  scene.add(sunMesh); scene.add(moonMesh);
  const starPos = new Float32Array(240 * 3);
  for (let i = 0; i < 240; i++) { const a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 0.9 + 0.1); starPos[i * 3] = Math.cos(a) * Math.sin(b) * 55; starPos[i * 3 + 1] = Math.cos(b) * 55; starPos[i * 3 + 2] = Math.sin(a) * Math.sin(b) * 55; }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false });
  const stars = new THREE.Points(starGeo, starMat); scene.add(stars);

  // ── terreno ──
  const terrainGeo = new THREE.PlaneGeometry(OW_N, OW_N, OW_N, OW_N); terrainGeo.rotateX(-Math.PI / 2);
  const tp = terrainGeo.attributes.position; const tcol = new Float32Array(tp.count * 3);
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i) + OW_N / 2, z = tp.getZ(i) + OW_N / 2; const hh = owHeight(x, z); tp.setY(i, hh);
    const n = 0.9 + ((Math.sin(x * 1.7) * Math.cos(z * 1.3)) * 0.5 + 0.5) * 0.2; const hl = Math.max(0, Math.min(1, (hh + 0.8) / 1.6));
    tcol[i * 3] = (0.2 + hl * 0.12) * n; tcol[i * 3 + 1] = (0.5 + hl * 0.12) * n; tcol[i * 3 + 2] = (0.22 + hl * 0.05) * n;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(tcol, 3)); terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.position.set(OW_N / 2, 0, OW_N / 2); scene.add(terrain);

  // ── objetos estáticos (instanciados) ──
  let statics = null;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const buildStatics = m => {
    if (statics) { scene.remove(statics); statics.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    statics = new THREE.Group();
    const lists = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    for (let y = 0; y < OW_N; y++) for (let x = 0; x < OW_N; x++) { const t = m[y][x]; if (t) lists[t].push([x, y]); }
    const inst = (geo, material, items, place, colorFn) => {
      if (!items.length) return;
      const im = new THREE.InstancedMesh(geo, material, items.length);
      items.forEach((it, i) => { place(dummy, it, i); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); if (colorFn) { colorFn(col, it, i); im.setColorAt(i, col); } });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      statics.add(im);
    };
    const rn = (x, y, k) => { const v = Math.sin(x * 12.9898 + y * 78.233 + k * 37.7) * 43758.5453; return v - Math.floor(v); };
    const gy = (x, y) => owHeight(x + 0.5, y + 0.5);
    // árboles
    const T = lists[1];
    inst(new THREE.CylinderGeometry(0.1, 0.14, 0.7, 5), mat(0x6b4524), T, (d, [x, y]) => { d.position.set(x + 0.5, gy(x, y) + 0.35, y + 0.5); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); });
    inst(new THREE.ConeGeometry(0.62, 1.1, 6), mat(0xffffff), T, (d, [x, y]) => { const s = 0.85 + rn(x, y, 1) * 0.5; d.position.set(x + 0.5, gy(x, y) + 0.95 * s, y + 0.5); d.rotation.set(0, rn(x, y, 2) * 6, 0); d.scale.set(s, s, s); }, (c, [x, y]) => c.setHSL(0.33 + rn(x, y, 3) * 0.05, 0.55, 0.26 + rn(x, y, 4) * 0.08));
    inst(new THREE.ConeGeometry(0.48, 0.9, 6), mat(0xffffff), T, (d, [x, y]) => { const s = 0.85 + rn(x, y, 1) * 0.5; d.position.set(x + 0.5, gy(x, y) + 1.5 * s, y + 0.5); d.rotation.set(0, rn(x, y, 5) * 6, 0); d.scale.set(s, s, s); }, (c, [x, y]) => c.setHSL(0.34 + rn(x, y, 3) * 0.05, 0.6, 0.32 + rn(x, y, 4) * 0.08));
    // rocas
    inst(new THREE.IcosahedronGeometry(0.42, 0), mat(0xffffff), lists[2], (d, [x, y]) => { const s = 0.8 + rn(x, y, 1) * 0.6; d.position.set(x + 0.5, gy(x, y) + 0.2, y + 0.5); d.rotation.set(rn(x, y, 2) * 3, rn(x, y, 3) * 6, 0); d.scale.set(s * 1.1, s * 0.75, s); }, (c, [x, y]) => c.setHSL(0.62, 0.06, 0.4 + rn(x, y, 4) * 0.15));
    // casas
    inst(new THREE.BoxGeometry(0.92, 0.8, 0.92), mat(0xffffff), lists[3], (d, [x, y]) => { d.position.set(x + 0.5, gy(x, y) + 0.4, y + 0.5); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); }, (c, [x, y]) => c.setHSL(0.09 + rn(x, y, 1) * 0.04, 0.4, 0.62 + rn(x, y, 2) * 0.1));
    inst(new THREE.ConeGeometry(0.78, 0.55, 4), mat(0xb03a30), lists[3], (d, [x, y]) => { d.position.set(x + 0.5, gy(x, y) + 1.07, y + 0.5); d.rotation.set(0, Math.PI / 4, 0); d.scale.set(1, 1, 1); });
    // torres
    inst(new THREE.CylinderGeometry(0.3, 0.42, 2.6, 8), mat(0x9684cd), lists[4], (d, [x, y]) => { d.position.set(x + 0.5, gy(x, y) + 1.3, y + 0.5); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); });
    inst(new THREE.ConeGeometry(0.5, 0.8, 8), mat(0xffd65a, { emissive: 0x553300 }), lists[4], (d, [x, y]) => { d.position.set(x + 0.5, gy(x, y) + 3, y + 0.5); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); });
    // montañas
    inst(new THREE.ConeGeometry(0.95, 2.7, 6), mat(0xffffff), lists[5], (d, [x, y]) => { const s = 0.85 + rn(x, y, 1) * 0.9; d.position.set(x + 0.5, gy(x, y) + 1.3 * s, y + 0.5); d.rotation.set(0, rn(x, y, 2) * 6, 0); d.scale.set(1.15, s, 1.15); }, (c, [x, y]) => c.setHSL(0.6, 0.1, 0.34 + rn(x, y, 4) * 0.1));
    inst(new THREE.ConeGeometry(0.42, 0.9, 6), new THREE.MeshLambertMaterial({ color: 0xf2f6ff, flatShading: true }), lists[5], (d, [x, y]) => { const s = 0.85 + rn(x, y, 1) * 0.9; d.position.set(x + 0.5, gy(x, y) + 2.35 * s, y + 0.5); d.rotation.set(0, rn(x, y, 2) * 6, 0); d.scale.set(1.15, s, 1.15); });
    scene.add(statics);
  };
  buildStatics(world.m);

  // ── entidades dinámicas ──
  const meshes = new Map();
  const gemGeo = new THREE.OctahedronGeometry(0.22, 0), gemMat = new THREE.MeshBasicMaterial({ color: 0x22e6ff });
  const coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.04, 10), coinMat = new THREE.MeshLambertMaterial({ color: 0xffc233, emissive: 0x553a00 });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1), eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
  const makeEntity = e => {
    const g = new THREE.Group();
    if (e.kind === 'gem') { g.add(new THREE.Mesh(gemGeo, gemMat)); const halo = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), new THREE.MeshBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.25, fog: false })); g.add(halo); }
    else if (e.kind === 'coin') { const c = new THREE.Mesh(coinGeo, coinMat); c.rotation.x = Math.PI / 2; g.add(c); }
    else {
      const wolf = e.kind === 'wolf'; const body = new THREE.Mesh(boxGeo, mat(wolf ? 0x3c3c46 : (ANIMAL_COL[e.e] || 0xdddddd)));
      const sc = e.e === '🐇' ? 0.55 : wolf ? 0.85 : 1; body.scale.set(0.5 * sc, 0.3 * sc, 0.3 * sc); body.position.y = 0.3 * sc; g.add(body);
      const head = new THREE.Mesh(boxGeo, mat(wolf ? 0x2e2e36 : (ANIMAL_COL[e.e] || 0xdddddd))); head.scale.set(0.2 * sc, 0.2 * sc, 0.2 * sc); head.position.set(0.3 * sc, 0.42 * sc, 0); g.add(head);
      for (const lz of [-0.09, 0.09]) for (const lx of [-0.17, 0.17]) { const leg = new THREE.Mesh(boxGeo, mat(wolf ? 0x2a2a30 : 0x666666)); leg.scale.set(0.07 * sc, 0.18 * sc, 0.07 * sc); leg.position.set(lx * sc, 0.09 * sc, lz * sc); g.add(leg); }
      if (wolf) for (const ez of [-0.05, 0.05]) { const eye = new THREE.Mesh(boxGeo, eyeMat); eye.scale.set(0.03, 0.03, 0.03); eye.position.set(0.41 * sc, 0.46 * sc, ez); g.add(eye); }
    }
    scene.add(g); return g;
  };

  const fogDay = new THREE.Color(0xcfe9ff), fogNight = new THREE.Color(0x10153a), skyDay = new THREE.Color(0x66b8f5), skyNight = new THREE.Color(0x03041a);
  const tmp = new THREE.Color();
  scene.fog = new THREE.Fog(0xcfe9ff, 6, 34);
  renderer.setClearColor(0x66b8f5, 1);
  let frame = 0;

  return {
    setWorld(newWorld) { buildStatics(newWorld.m); meshes.forEach(m => scene.remove(m)); meshes.clear(); },
    sync(s) {
      const dl = Math.max(0, Math.min(1, Math.sin(s.tod * Math.PI * 2) * 1.5 + 0.55));
      tmp.copy(fogNight).lerp(fogDay, dl); scene.fog.color.copy(tmp); scene.fog.far = lerp(24, 36, dl);
      renderer.setClearColor(tmp.clone().lerp(skyNight.clone().lerp(skyDay, dl), 0.5), 1);
      hemi.intensity = 0.25 + 0.7 * dl; sun.intensity = 0.05 + 1.05 * dl;
      const ang = s.tod * Math.PI * 2; const sd = new THREE.Vector3(Math.cos(ang) * 0.6, Math.sin(ang), Math.sin(ang * 0.5 + 0.7) * 0.4).normalize();
      const gh = owHeight(s.px, s.py);
      camera.position.set(s.px, gh + 0.62 + Math.sin(s.bob || 0) * 0.025, s.py);
      camera.rotation.set(0, -s.a - Math.PI / 2, 0);
      sun.position.copy(camera.position).addScaledVector(sd, 30); sun.target.position.copy(camera.position);
      sunMesh.position.copy(camera.position).addScaledVector(sd, 52); sunMesh.visible = sd.y > -0.05;
      moonMesh.position.copy(camera.position).addScaledVector(sd, -52); moonMesh.visible = sd.y < 0.05;
      stars.position.copy(camera.position); starMat.opacity = Math.max(0, 1 - dl * 2.2);
      // entidades
      const seen = new Set();
      for (const e of s.ents) {
        if (e.gone) continue;
        const dx = e.x - s.px, dy = e.y - s.py; if (dx * dx + dy * dy > 38 * 38) continue;
        seen.add(e.id);
        let m = meshes.get(e.id); if (!m) { m = makeEntity(e); meshes.set(e.id, m); }
        const base = owHeight(e.x, e.y);
        if (e.kind === 'gem') { m.position.set(e.x, base + 0.55 + Math.sin(s.t * 2.2 + e.ph) * 0.08, e.y); m.rotation.y = s.t * 1.6 + e.ph; }
        else if (e.kind === 'coin') { m.position.set(e.x, base + 0.4 + Math.sin(s.t * 2.6 + e.ph) * 0.05, e.y); m.rotation.y = s.t * 3 + e.ph; }
        else { m.position.set(e.x, base, e.y); m.rotation.y = e.kind === 'wolf' ? -Math.atan2(s.py - e.y, s.px - e.x) : -(e.a || 0); }
      }
      meshes.forEach((m, id) => { if (!seen.has(id)) { scene.remove(m); meshes.delete(id); } });
    },
    render() {
      renderer.render(scene, camera);
      if (gl.endFrameEXP) gl.endFrameEXP();
      frame += 1;
    },
    // ¿se está dibujando algo? (detecta pantalla negra en dispositivos raros)
    probe() {
      try {
        const px = new Uint8Array(4); let nonBlack = 0;
        for (const [px_, py_] of [[0.5, 0.5], [0.25, 0.7], [0.75, 0.7], [0.5, 0.9], [0.5, 0.3]]) {
          gl.readPixels(Math.floor(w * px_), Math.floor(h * py_), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          if (px[0] + px[1] + px[2] > 12) nonBlack++;
        }
        return nonBlack > 0;
      } catch (_) { return true; }
    },
    frames: () => frame,
    dispose() { try { renderer.dispose(); } catch (_) {} },
    renderer, scene, camera,
  };
}
