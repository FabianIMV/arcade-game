/**
 * gl3dx.js – escenas 3D (three.js sobre expo-gl) para MOTO 3D y AVIÓN 3D.
 * Lógica pura: reciben el contexto GL, el módulo THREE y una función getState()
 * con el estado del juego (lo actualiza el componente React).
 */

export function makeRenderer(gl, THREE) {
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const canvas = { width: w, height: h, style: {}, clientWidth: w, clientHeight: h, addEventListener() {}, removeEventListener() {}, getContext: () => gl };
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false });
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

const hash = (i, k) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
const mod = (a, n) => ((a % n) + n) % n;

function skyDome(THREE, top, bottom) {
  const geo = new THREE.SphereGeometry(300, 16, 12);
  const cols = new Float32Array(geo.attributes.position.count * 3);
  const ct = new THREE.Color(top), cb = new THREE.Color(bottom), c = new THREE.Color();
  for (let i = 0; i < geo.attributes.position.count; i++) { const y = geo.attributes.position.getY(i) / 300; c.copy(cb).lerp(ct, Math.max(0, Math.min(1, y * 1.6))); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

// ─────────────────────────────────────────────────────────────────
// MOTO 3D: autopista infinita en primera persona
// ─────────────────────────────────────────────────────────────────
export function createMoto({ gl, THREE, getState, aspect }) {
  const renderer = makeRenderer(gl, THREE);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf3a77a, 40, 210);
  renderer.setClearColor(0xf3a77a, 1);
  const camera = new THREE.PerspectiveCamera(72, aspect, 0.1, 320);
  camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight(0xffe2c4, 0x40304a, 0.95));
  const sun = new THREE.DirectionalLight(0xffd0a0, 0.9); sun.position.set(-30, 25, -60); scene.add(sun);
  const sky = skyDome(THREE, 0x3a3f8f, 0xffa66b); scene.add(sky);
  const sunDisk = new THREE.Mesh(new THREE.CircleGeometry(16, 24), new THREE.MeshBasicMaterial({ color: 0xffe08a, fog: false })); sunDisk.position.set(-40, 22, -280); scene.add(sunDisk);
  const mat = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

  // suelo, carretera y líneas fijas
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat(0x5d8a3c)); grass.rotation.x = -Math.PI / 2; grass.position.set(0, -0.02, -250); scene.add(grass);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(15, 600), mat(0x3a3a42)); road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -250); scene.add(road);
  for (const x of [-7.2, 7.2]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 600), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 })); l.position.set(x, 0.01, -250); scene.add(l); }
  for (const x of [-0.12, 0.12]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 600), new THREE.MeshBasicMaterial({ color: 0xffc233 })); l.position.set(x, 0.012, -250); scene.add(l); }

  const dummy = new THREE.Object3D();
  const mkInst = (geo, material, n) => { const m = new THREE.InstancedMesh(geo, material, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); return m; };
  // guiones de carril (x = ±3.6)
  const DASH_N = 50, DASH_SP = 10;
  const dashes = mkInst(new THREE.BoxGeometry(0.14, 0.02, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }), DASH_N * 2);
  // árboles, farolas y edificios reciclados por distancia
  const TREE_N = 44, TREE_SPAN = 44 * 9;
  const trunks = mkInst(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 5), mat(0x6b4524), TREE_N);
  const crowns = mkInst(new THREE.ConeGeometry(1.4, 3.6, 6), mat(0x2f7a3a), TREE_N);
  const LAMP_N = 20, LAMP_SP = 24;
  const poles = mkInst(new THREE.CylinderGeometry(0.08, 0.1, 5, 5), mat(0x777788), LAMP_N);
  const bulbs = mkInst(new THREE.BoxGeometry(0.9, 0.15, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff1b0 }), LAMP_N);
  const BLD_N = 36, BLD_SP = 16;
  const blds = mkInst(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff), BLD_N);
  const col = new THREE.Color();
  for (let i = 0; i < BLD_N; i++) { col.setHSL(0.55 + hash(i, 1) * 0.5, 0.25, 0.35 + hash(i, 2) * 0.25); blds.setColorAt(i, col); }
  blds.instanceColor.needsUpdate = true;

  // tráfico
  const carMeshes = new Map();
  const bodyGeo = new THREE.BoxGeometry(1.8, 0.8, 4.2), cabGeo = new THREE.BoxGeometry(1.6, 0.6, 2.2), lightGeo = new THREE.BoxGeometry(0.35, 0.18, 0.05);
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff2030 }), whiteMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 }), glassMat = mat(0x223344);
  const makeCar = c => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, mat(c.color)); body.position.y = 0.6; g.add(body);
    const cab = new THREE.Mesh(cabGeo, glassMat); cab.position.set(0, 1.25, 0.2); g.add(cab);
    for (const sx of [-0.6, 0.6]) { const back = new THREE.Mesh(lightGeo, c.v < 0 ? whiteMat : redMat); back.position.set(sx, 0.7, 2.11); g.add(back); }
    scene.add(g); return g;
  };

  return {
    frame() {
      const s = getState(); if (!s) return;
      const dz = s.z;
      for (let i = 0; i < DASH_N; i++) { const D = mod(i * DASH_SP - dz, DASH_N * DASH_SP); for (let k = 0; k < 2; k++) { dummy.position.set(k ? 3.6 : -3.6, 0.012, -D); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); dashes.setMatrixAt(i * 2 + k, dummy.matrix); } }
      dashes.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < TREE_N; i++) {
        const D = mod(i * 9 + hash(i, 3) * 6 - dz, TREE_SPAN) - 10; const side = i % 2 ? 1 : -1; const x = side * (10 + hash(i, 4) * 12); const sc = 0.8 + hash(i, 5) * 0.7;
        dummy.position.set(x, 0.8 * sc, -D); dummy.rotation.set(0, 0, 0); dummy.scale.set(sc, sc, sc); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, (1.6 + 1.8) * sc, -D); dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
      }
      trunks.instanceMatrix.needsUpdate = true; crowns.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < LAMP_N; i++) {
        const D = mod(i * LAMP_SP - dz, LAMP_N * LAMP_SP) - 10; const side = i % 2 ? 1 : -1;
        dummy.position.set(side * 7.9, 2.5, -D); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix);
        dummy.position.set(side * 7.4, 5, -D); dummy.updateMatrix(); bulbs.setMatrixAt(i, dummy.matrix);
      }
      poles.instanceMatrix.needsUpdate = true; bulbs.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < BLD_N; i++) {
        const D = mod(i * BLD_SP - dz * 0.97, BLD_N * BLD_SP) - 20; const side = i % 2 ? 1 : -1; const hgt = 6 + hash(i, 6) * 26; const wd = 6 + hash(i, 7) * 8;
        dummy.position.set(side * (30 + hash(i, 8) * 30), hgt / 2, -D); dummy.rotation.set(0, 0, 0); dummy.scale.set(wd, hgt, wd); dummy.updateMatrix(); blds.setMatrixAt(i, dummy.matrix);
      }
      blds.instanceMatrix.needsUpdate = true;
      // tráfico
      const seen = new Set();
      for (const c of s.cars) {
        const rel = c.z - s.z; if (rel > 260 || rel < -15) continue;
        seen.add(c.id); let m = carMeshes.get(c.id); if (!m) { m = makeCar(c); carMeshes.set(c.id, m); }
        m.position.set(c.x, 0, -rel);
      }
      carMeshes.forEach((m, id) => { if (!seen.has(id)) { scene.remove(m); carMeshes.delete(id); } });
      // cámara: inclinación al girar y vibración por velocidad
      const shake = s.offroad ? (Math.random() - 0.5) * 0.06 : (Math.random() - 0.5) * 0.004 * (s.speed / 10);
      camera.position.set(s.x, 1.25 + shake, 0);
      camera.rotation.set(-0.04, -s.lean * 0.06, -s.lean * 0.32);
      const fov = 68 + s.speed * 0.35 + (s.turbo > 0 ? 8 : 0);
      if (Math.abs(camera.fov - fov) > 0.3) { camera.fov = fov; camera.updateProjectionMatrix(); }
      sky.position.copy(camera.position);
      renderer.render(scene, camera);
    },
    probe: () => probeGL(gl),
    dispose() { try { renderer.dispose(); } catch (_) {} },
  };
}

// ─────────────────────────────────────────────────────────────────
// AVIÓN 3D: vuelo en primera persona por un cañón
// ─────────────────────────────────────────────────────────────────
export function createPlane({ gl, THREE, getState, aspect }) {
  const renderer = makeRenderer(gl, THREE);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xbfe3ff, 60, 330);
  renderer.setClearColor(0xbfe3ff, 1);
  const camera = new THREE.PerspectiveCamera(70, aspect, 0.2, 420);
  camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight(0xe4f2ff, 0x5a6a3a, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(40, 80, -20); scene.add(sun);
  const sky = skyDome(THREE, 0x2f7fd8, 0xcfe9ff); scene.add(sky);
  const mat = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const dummy = new THREE.Object3D(); const col = new THREE.Color();
  const mkInst = (geo, material, n) => { const m = new THREE.InstancedMesh(geo, material, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); return m; };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat(0x6f9a46)); ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, -300); scene.add(ground);
  // parcelas de cultivo (dan sensación de velocidad)
  const FIELD_N = 90, FIELD_SP = 14, FIELD_SPAN = 30 * FIELD_SP;
  const fields = mkInst(new THREE.BoxGeometry(1, 0.05, 1), mat(0xffffff), FIELD_N);
  for (let i = 0; i < FIELD_N; i++) { col.setHSL(0.17 + hash(i, 1) * 0.16, 0.45, 0.35 + hash(i, 2) * 0.2); fields.setColorAt(i, col); }
  fields.instanceColor.needsUpdate = true;
  // montañas del cañón
  const MT_N = 70, MT_SP = 13, MT_SPAN = 35 * MT_SP;
  const mounts = mkInst(new THREE.ConeGeometry(1, 1, 6), mat(0xffffff), MT_N);
  const snows = mkInst(new THREE.ConeGeometry(1, 1, 6), mat(0xf4f8ff), MT_N);
  for (let i = 0; i < MT_N; i++) { col.setHSL(0.08, 0.18, 0.3 + hash(i, 3) * 0.15); mounts.setColorAt(i, col); }
  mounts.instanceColor.needsUpdate = true;
  // nubes
  const CL_N = 40, CL_SPAN = 420;
  const clouds = mkInst(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }), CL_N);

  const ringGeo = new THREE.TorusGeometry(3.4, 0.35, 6, 20), ringMat = new THREE.MeshBasicMaterial({ color: 0xffc233 }), ringHit = new THREE.MeshBasicMaterial({ color: 0x7dff6b });
  const pillarGeo = new THREE.CylinderGeometry(1, 1.3, 1, 7), pillarMat = mat(0x8a6a50);
  const objs = new Map();

  return {
    frame() {
      const s = getState(); if (!s) return;
      const dz = s.dist;
      for (let i = 0; i < FIELD_N; i++) {
        const row = Math.floor(i / 3), c = i % 3; const D = mod(row * FIELD_SP - dz, FIELD_SPAN) - 20;
        dummy.position.set((c - 1) * 18 + (hash(i, 4) - 0.5) * 6, 0.03, -D); dummy.rotation.set(0, 0, 0); dummy.scale.set(14 + hash(i, 5) * 6, 1, FIELD_SP - 1); dummy.updateMatrix(); fields.setMatrixAt(i, dummy.matrix);
      }
      fields.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < MT_N; i++) {
        const row = Math.floor(i / 2), side = i % 2 ? 1 : -1; const D = mod(row * MT_SP + hash(i, 6) * 6 - dz, MT_SPAN) - 30;
        const hgt = 30 + hash(i, 7) * 50, rad = 14 + hash(i, 8) * 10; const x = side * (36 + rad * 0.7 + hash(i, 9) * 12);
        dummy.position.set(x, hgt / 2, -D); dummy.rotation.set(0, hash(i, 10) * 6, 0); dummy.scale.set(rad, hgt, rad); dummy.updateMatrix(); mounts.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, hgt * 0.86, -D); dummy.scale.set(rad * 0.3, hgt * 0.28, rad * 0.3); dummy.updateMatrix(); snows.setMatrixAt(i, dummy.matrix);
      }
      mounts.instanceMatrix.needsUpdate = true; snows.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < CL_N; i++) {
        const D = mod(i * (CL_SPAN / CL_N) - dz * 0.9, CL_SPAN) - 20; const sc = 4 + hash(i, 11) * 6;
        dummy.position.set((hash(i, 12) - 0.5) * 140, 58 + hash(i, 13) * 30, -D); dummy.rotation.set(hash(i, 14), hash(i, 15) * 3, 0); dummy.scale.set(sc * 1.8, sc * 0.7, sc); dummy.updateMatrix(); clouds.setMatrixAt(i, dummy.matrix);
      }
      clouds.instanceMatrix.needsUpdate = true;
      const seen = new Set();
      for (const o of s.objs) {
        const rel = o.z - s.dist; if (rel > 380 || rel < -10) continue;
        seen.add(o.id); let m = objs.get(o.id);
        if (!m) { m = o.kind === 'ring' ? new THREE.Mesh(ringGeo, ringMat) : new THREE.Mesh(pillarGeo, pillarMat); objs.set(o.id, m); scene.add(m); }
        if (o.kind === 'ring') { m.position.set(o.x, o.y, -rel); m.material = o.hit ? ringHit : ringMat; m.rotation.z = s.t * 0.8; }
        else { m.position.set(o.x, o.h / 2, -rel); m.scale.set(o.r, o.h, o.r); }
      }
      objs.forEach((m, id) => { if (!seen.has(id)) { scene.remove(m); objs.delete(id); } });
      camera.position.set(s.x, s.y, 0);
      camera.rotation.set(s.pitch * 0.5, -s.roll * 0.25, -s.roll * 0.8);
      sky.position.copy(camera.position);
      renderer.render(scene, camera);
    },
    probe: () => probeGL(gl),
    dispose() { try { renderer.dispose(); } catch (_) {} },
  };
}
