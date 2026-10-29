/**
 * engine3d.js – motor 3D v2 (three.js sobre expo-gl). Lee docs/ENGINE3D.md para la guía completa.
 *
 * El juego describe su mundo cada frame como una lista de objetos con id estable; el motor crea, mueve y
 * borra las mallas. Compatible con las escenas v1 ({ objs, cam, bg, fog, shake }).
 *
 * Escena: { objs, cam, bg, fog, shake, sky, light, shadows, shadowR, terrain, water, lights }
 *   objs: [{ id, k, p, s|n, r, c, e, o, m:{r,m}, sh, recv, inst }]
 *     k    : 'box' 'sph' 'cyl' 'cone' 'tor' 'pla' 'cap' 'ico' 'oct' 'ring' 'pyr'
 *     sh   : true → proyecta sombra · recv : true → recibe sombra (suelo, casas…)
 *     m    : { r: rugosidad 0..1, m: metal 0..1 }
 *     inst : 'nombre' → se dibuja con un InstancedMesh (miles de árboles/monedas/bloques). No necesita id estable.
 *   cam: { p, l | yaw, pitch, fov }
 *   sky: { top, bottom, sun:true, clouds:n }    light: { dir, sun, i, sky, ground, hi }
 *   terrain: { id, h(x,z), size, step, color(y,x,z), ver }   water: { y, c, o, amp }
 *   lights: [{ p, c, i, d }] (luces puntuales, máx. 4)
 *   statics: array precomputado (mismo array cada frame) con objetos que no cambian: sus instancias se escriben una sola vez
 * Partículas: burst3d / ring3d (exportadas) – las gestiona el motor.
 */
import { makeRenderer, probeGL } from './gl3dx';

// ─── Ajustes globales ─────────────────────────────────────────────
export const gfx = { shadows: true };   // interruptor global de calidad (ajustes) – scene.shadows=false lo apaga por escena

const SHAPES = { box: 1, sph: 1, cyl: 1, cone: 1, tor: 1, pla: 1, cap: 1, ico: 1, oct: 1, ring: 1, pyr: 1 };
const FLAT = { pla: 1, ring: 1 };        // formas planas: giradas -90° en X por defecto (quedan horizontales)

// ─── Partículas 3D (estado global del módulo; las dibuja el motor activo) ─
const PMAX = 700;
const parts = [];
const pick = a => a[Math.floor(Math.random() * a.length)];

/**
 * Chispas / explosión / polvo en el mundo 3D.
 * burst3d([x,y,z], color|[colores], n = 14, { speed = 5, life = 0.8, size = 0.18, g = 12, up = 0, drag = 1.5, spread = 1 })
 *   g: gravedad (negativo = sube, humo) · up: sesgo vertical de la velocidad · spread: 0 = en vertical, 1 = esfera completa
 */
export function burst3d(pos, color = '#ffffff', n = 14, o = {}) {
  const speed = o.speed != null ? o.speed : 5, life = o.life != null ? o.life : 0.8, size = o.size != null ? o.size : 0.18;
  const g = o.g != null ? o.g : 12, up = o.up || 0, drag = o.drag != null ? o.drag : 1.5, spread = o.spread != null ? o.spread : 1;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, u = (Math.random() * 2 - 1) * spread, rr = Math.sqrt(Math.max(0, 1 - u * u));
    const sp = speed * (0.35 + Math.random() * 0.65);
    parts.push({
      x: pos[0], y: pos[1], z: pos[2], vx: Math.cos(a) * rr * sp, vy: u * sp + up, vz: Math.sin(a) * rr * sp,
      l: life * (0.6 + Math.random() * 0.4), m: life, s: size * (0.6 + Math.random() * 0.8), g, d: drag,
      c: Array.isArray(color) ? pick(color) : color, C: null,
    });
  }
  if (parts.length > PMAX) parts.splice(0, parts.length - PMAX);
}
/** Anillo de chispas que se expande en horizontal (onda de choque, hechizo, aterrizaje). */
export function ring3d(pos, color = '#ffffff', n = 18, o = {}) {
  const speed = o.speed != null ? o.speed : 6, life = o.life != null ? o.life : 0.6, size = o.size != null ? o.size : 0.16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push({ x: pos[0], y: pos[1], z: pos[2], vx: Math.cos(a) * speed, vy: o.up || 0.5, vz: Math.sin(a) * speed, l: life, m: life, s: size, g: o.g || 0, d: 2, c: Array.isArray(color) ? pick(color) : color, C: null });
  }
  if (parts.length > PMAX) parts.splice(0, parts.length - PMAX);
}
export const clear3d = () => { parts.length = 0; };
export const fx3d = { burst: burst3d, ring: ring3d, clear: clear3d };

// ─── Utilidades ───────────────────────────────────────────────────
// sin mapa de entorno el metal puro se ve negro: se atenúa (m:1 → 0.4)
const METAL = 0.4;
const SUN_DEFAULT = [-0.45, 0.8, 0.4];   // dirección HACIA el sol

export function createWorld({ gl, THREE, getState, aspect: aspect0 }) {
  const renderer = makeRenderer(gl, THREE);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, aspect0 || 1, 0.1, 800);

  // luces
  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x5b5648, 1.4); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4dc, 2.6); scene.add(sun); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
  let shadowR = 0, shadowsOn = true;
  const sunDir = new THREE.Vector3(), sunRight = new THREE.Vector3(), sunUp = new THREE.Vector3(), tmpV = new THREE.Vector3();

  // color con caché (parsear 'hsl(..)' cada frame sería caro)
  const colCache = new Map();
  const colOf = spec => {
    let c = colCache.get(spec);
    if (!c) { c = new THREE.Color(); c.set(spec == null ? 0xffffff : spec); if (colCache.size > 600) colCache.clear(); colCache.set(spec, c); }
    return c;
  };

  // geometrías compartidas (todas caben en una caja de 1×1×1 centrada)
  const capG = new THREE.CapsuleGeometry(0.5, 0.5, 4, 10); capG.scale(1, 1 / 1.5, 1);
  const pyrG = new THREE.ConeGeometry(0.7071, 1, 4, 1); pyrG.rotateY(Math.PI / 4);
  const GEO = {
    box: new THREE.BoxGeometry(1, 1, 1),
    sph: new THREE.SphereGeometry(0.5, 16, 12),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    cone: new THREE.ConeGeometry(0.5, 1, 12),
    tor: new THREE.TorusGeometry(0.5, 0.12, 8, 24),
    pla: new THREE.PlaneGeometry(1, 1),
    cap: capG,
    ico: new THREE.IcosahedronGeometry(0.5, 1),
    oct: new THREE.OctahedronGeometry(0.5, 0),
    ring: new THREE.RingGeometry(0.34, 0.5, 28),
    pyr: pyrG,
  };

  const mats = new Set();            // todos los materiales con sombras (para recompilar al apagarlas)
  const newStd = (flat = true, extra = {}) => { const m = new THREE.MeshStandardMaterial({ flatShading: flat, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide, ...extra }); m.shadowSide = THREE.BackSide; mats.add(m); return m; };

  // ─── mallas individuales (id estable) ───────────────────────────
  const meshes = new Map();          // id -> { m, k }
  const pool = {};                   // k -> [rec] reutilizables
  const make = k => {
    const p = pool[k];
    if (p && p.length) { const rec = p.pop(); rec.m.visible = true; return rec; }
    const m = new THREE.Mesh(GEO[k], newStd());
    scene.add(m);
    return { m, k };
  };
  const release = rec => {
    rec.m.visible = false; rec.m.castShadow = false; rec.m.receiveShadow = false;
    (pool[rec.k] || (pool[rec.k] = [])).push(rec);
  };

  // ─── instancing automático ──────────────────────────────────────
  const groups = new Map();          // clave -> { mesh, cap, n, idle, k, mat }
  const dummyQ = new THREE.Quaternion(), dummyE = new THREE.Euler(), dummyP = new THREE.Vector3(), dummyS = new THREE.Vector3(), dummyM = new THREE.Matrix4();
  const mkInst = (geo, mat, cap) => {
    const im = new THREE.InstancedMesh(geo, mat, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false; im.count = 0;
    scene.add(im);
    return im;
  };
  const getGroup = (key, o, k, eb) => {
    let g = groups.get(key);
    if (g) return g;
    let mat;
    if (eb >= 0.75) mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    else {
      mat = newStd(true, { roughness: o.m && o.m.r != null ? o.m.r : 0.85, metalness: o.m && o.m.m != null ? o.m.m * METAL : 0.02 });
      if (eb > 0.05) mat.emissive.setScalar(eb * 0.5);
    }
    g = { mesh: mkInst(GEO[k], mat, 64), cap: 64, n: 0, idle: 0, mat, sh: !!o.sh, recv: !!o.recv };
    g.mesh.castShadow = g.sh; g.mesh.receiveShadow = g.recv;
    groups.set(key, g);
    return g;
  };
  const growGroup = g => {
    const old = g.mesh, cap = g.cap * 2;
    const im = mkInst(old.geometry, g.mat, cap);
    im.instanceMatrix.array.set(old.instanceMatrix.array); im.instanceColor.array.set(old.instanceColor.array);
    im.castShadow = g.sh; im.receiveShadow = g.recv;
    scene.remove(old); old.dispose();
    g.mesh = im; g.cap = cap;
  };

  // ─── cielo, sol, nubes ──────────────────────────────────────────
  let sky = null, skyKey = '';
  const buildSky = (top, bottom) => {
    if (!sky) {
      const geo = new THREE.SphereGeometry(1, 20, 14);
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false }));
      dome.scale.setScalar(450); dome.renderOrder = -1000; dome.frustumCulled = false;
      const disc = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false, depthWrite: false, depthTest: false }));
      disc.scale.setScalar(16); disc.renderOrder = -998; disc.frustumCulled = false;
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false, transparent: true, opacity: 0.22, depthWrite: false }));
      halo.scale.setScalar(34); halo.renderOrder = -999; halo.frustumCulled = false;
      const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false, flatShading: true, emissive: 0x9aa3b8 }), 90);
      clouds.frustumCulled = false; clouds.count = 0;
      scene.add(dome, disc, halo, clouds);
      sky = { dome, disc, halo, clouds, cn: -1 };
    }
    const key = top + '|' + bottom;
    if (key !== skyKey) {
      skyKey = key;
      const pos = sky.dome.geometry.attributes.position, col = sky.dome.geometry.attributes.color;
      const ct = new THREE.Color(top), cb = new THREE.Color(bottom), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const y = Math.max(0, Math.min(1, pos.getY(i)));
        c.copy(cb).lerp(ct, Math.pow(y, 0.65));
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    }
  };
  const setClouds = n => {
    if (sky.cn === n) return; sky.cn = n;
    let i = 0;
    for (let c = 0; c < n; c++) {
      const a = (c / n) * Math.PI * 2 + Math.sin(c * 12.9) * 0.4, r = 200 + ((c * 37) % 90), h = 55 + ((c * 53) % 50), sc = 14 + ((c * 29) % 14);
      for (let k = 0; k < 4 && i < 90; k++, i++) {
        const dx = (k - 1.5) * sc * 0.9, dz = (((c + k) * 7) % 5 - 2) * sc * 0.25;
        dummyP.set(Math.cos(a) * r + dx, h + (k === 1 || k === 2 ? sc * 0.25 : 0), Math.sin(a) * r + dz);
        dummyE.set(0, a, 0); dummyQ.setFromEuler(dummyE);
        const s = sc * (k === 1 || k === 2 ? 0.8 : 0.55);
        dummyS.set(s * 1.5, s * 0.55, s * 0.9);
        dummyM.compose(dummyP, dummyQ, dummyS);
        sky.clouds.setMatrixAt(i, dummyM);
      }
    }
    sky.clouds.count = i; sky.clouds.instanceMatrix.needsUpdate = true;
  };

  // ─── terreno low-poly de una vez (se reconstruye si cambia id/ver) ───
  let terrain = null, terrainKey = '';
  const buildTerrain = T => {
    if (terrain) { scene.remove(terrain); terrain.geometry.dispose(); terrain.material.dispose(); mats.delete(terrain.material); terrain = null; }
    const size = T.size || 64, step = T.step || 1, n = Math.min(200, Math.max(2, Math.round(size / step))), st = size / n, half = size / 2;
    const cx = T.cx || 0, cz = T.cz || 0;
    const H = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) H[i * (n + 1) + j] = T.h(cx - half + i * st, cz - half + j * st);
    const pos = new Float32Array(n * n * 18), col = new Float32Array(n * n * 18);
    const c = new THREE.Color(); let o = 0;
    const tri = (ax, ay, az, bx, by, bz, cx2, cy, cz2) => {
      pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az; pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz; pos[o + 6] = cx2; pos[o + 7] = cy; pos[o + 8] = cz2;
      const my = (ay + by + cy) / 3;
      c.set(T.color ? T.color(my, (ax + bx + cx2) / 3, (az + bz + cz2) / 3) : '#6aa84f');
      for (let q = 0; q < 3; q++) { col[o + q * 3] = c.r; col[o + q * 3 + 1] = c.g; col[o + q * 3 + 2] = c.b; }
      o += 9;
    };
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x0 = cx - half + i * st, x1 = x0 + st, z0 = cz - half + j * st, z1 = z0 + st;
      const h00 = H[i * (n + 1) + j], h10 = H[(i + 1) * (n + 1) + j], h01 = H[i * (n + 1) + j + 1], h11 = H[(i + 1) * (n + 1) + j + 1];
      if ((i + j) & 1) { tri(x0, h00, z0, x0, h01, z1, x1, h10, z0); tri(x1, h10, z0, x0, h01, z1, x1, h11, z1); }
      else { tri(x0, h00, z0, x0, h01, z1, x1, h11, z1); tri(x0, h00, z0, x1, h11, z1, x1, h10, z0); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, newStd(true, { vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.FrontSide }));
    m.receiveShadow = true; m.frustumCulled = false;
    scene.add(m); terrain = m;
  };

  // ─── agua con olas low-poly ─────────────────────────────────────
  let water = null; const WN = 44, WS = 220, WC = WS / WN;
  const buildWater = () => {
    const geo = new THREE.PlaneGeometry(WS, WS, WN, WN); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, newStd(true, { roughness: 0.18, metalness: 0.25, transparent: true, side: THREE.FrontSide }));
    m.receiveShadow = true; m.frustumCulled = false; m.renderOrder = 1;
    m.userData.base = Float32Array.from(geo.attributes.position.array);
    scene.add(m); water = m;
  };

  // ─── partículas ─────────────────────────────────────────────────
  const pMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), PMAX);
  pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PMAX * 3), 3); pMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  pMesh.frustumCulled = false; pMesh.count = 0; scene.add(pMesh);

  // ─── luces puntuales (se crean bajo demanda y no se quitan: evita recompilar shaders) ───
  const plights = [];

  // fondo/niebla
  const fogCol = new THREE.Color();
  let last = null, frames = 0, dtS = 0.016;
  const stats = { meshes: 0, inst: 0, calls: 0, tris: 0 };

  // escribe un objeto con inst:'nombre' en su grupo de InstancedMesh (isStatic: grupo que no se reescribe cada frame)
  let staticsRef = null, staticMesh = [], nInst = 0;
  const addInst = (o, isStatic) => {
    const k = SHAPES[o.k] ? o.k : 'box';
    const eb = o.e >= 0.75 ? 1 : o.e > 0.05 ? Math.round(o.e * 4) / 4 : 0;
    const key = (isStatic ? 's|' : 'd|') + o.inst + '|' + k + '|' + (o.m ? (o.m.r || 0) + ',' + (o.m.m || 0) : '') + '|' + eb + (o.sh ? 'S' : '') + (o.recv ? 'R' : '');
    const g = getGroup(key, o, k, eb);
    g.st = isStatic;
    if (g.n >= g.cap) growGroup(g);
    const i = g.n++, r = o.r;
    dummyP.set(o.p[0], o.p[1], o.p[2]);
    dummyE.set(r ? r[0] : (FLAT[k] ? -Math.PI / 2 : 0), r ? r[1] : 0, r ? r[2] : 0); dummyQ.setFromEuler(dummyE);
    if (typeof o.n === 'number') dummyS.set(o.n, o.n, o.n); else if (o.s) dummyS.set(o.s[0], o.s[1], o.s[2]); else dummyS.set(1, 1, 1);
    dummyM.compose(dummyP, dummyQ, dummyS);
    g.mesh.setMatrixAt(i, dummyM);
    g.mesh.setColorAt(i, colOf(o.c));
  };

  const world = {
    stats,
    frame() {
      const nowT = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      dtS = last == null ? 0.016 : Math.min(0.06, nowT - last); last = nowT;
      const st = getState(nowT); if (!st) return;
      frames++;
      const W = gl.drawingBufferWidth || 1, Hh = gl.drawingBufferHeight || 1;
      const aspect = W / Hh;

      // ── sombras ──
      const wantSh = st.shadows !== false && gfx.shadows;
      if (wantSh !== shadowsOn) { shadowsOn = wantSh; renderer.shadowMap.enabled = wantSh; sun.castShadow = wantSh; mats.forEach(m => { m.needsUpdate = true; }); }

      // ── cámara ──
      const cam = st.cam || { p: [0, 5, 10], l: [0, 0, 0] };
      const sh = (st.shake || 0) * (Math.random() - 0.5);   // temblor de cámara
      camera.fov = cam.fov || 60; camera.aspect = aspect; camera.updateProjectionMatrix();
      camera.position.set(cam.p[0] + sh, cam.p[1] + sh * 0.5, cam.p[2]);
      if (cam.l) camera.lookAt(cam.l[0], cam.l[1], cam.l[2]);
      else { camera.rotation.order = 'YXZ'; camera.rotation.set(cam.pitch || 0, cam.yaw || 0, 0); }
      camera.updateMatrixWorld();

      // ── luces ──
      const L = st.light || {};
      const d = L.dir || SUN_DEFAULT; sunDir.set(d[0], d[1], d[2]).normalize();
      sun.color.set(L.sun != null ? L.sun : 0xfff4dc); sun.intensity = L.i != null ? L.i : 2.4;
      hemi.color.set(L.sky != null ? L.sky : 0xdfeaff); hemi.groundColor.set(L.ground != null ? L.ground : 0x5b5648); hemi.intensity = L.hi != null ? L.hi : 1.8;
      // el volumen de sombra sigue al punto de interés (cam.l o delante de la cámara), ajustado al texel para que no tiemble
      const R = st.shadowR || 24;
      if (R !== shadowR) { shadowR = R; const c = sun.shadow.camera; c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.updateProjectionMatrix(); }
      if (cam.l) tmpV.set(cam.l[0], cam.l[1], cam.l[2]);
      else { const cp = Math.cos(cam.pitch || 0), y = cam.yaw || 0; tmpV.set(cam.p[0] - Math.sin(y) * cp * R * 0.7, cam.p[1] + Math.sin(cam.pitch || 0) * R * 0.7, cam.p[2] - Math.cos(y) * cp * R * 0.7); }
      sunRight.set(0, 1, 0).cross(sunDir).normalize(); sunUp.copy(sunDir).cross(sunRight).normalize();
      const tex = (2 * R) / 1024;
      const a = Math.round(tmpV.dot(sunRight) / tex) * tex, b = Math.round(tmpV.dot(sunUp) / tex) * tex, c2 = tmpV.dot(sunDir);
      tmpV.copy(sunRight).multiplyScalar(a).addScaledVector(sunUp, b).addScaledVector(sunDir, c2);
      sun.target.position.copy(tmpV); sun.target.updateMatrixWorld();
      sun.position.copy(tmpV).addScaledVector(sunDir, 70);

      // ── objetos ──
      const seen = new Set();
      groups.forEach(g => { if (!g.st) g.n = 0; });
      // scene.statics: lista precomputada (mismo array entre frames) → sus instancias se escriben UNA vez
      const S = st.statics || null;
      if (S !== staticsRef) {
        staticsRef = S; staticMesh = [];
        groups.forEach(g => { if (g.st) g.n = 0; });
        if (S) for (let oi = 0; oi < S.length; oi++) { if (S[oi].inst) addInst(S[oi], true); else staticMesh.push(S[oi]); }
        groups.forEach(g => { if (g.st && g.n) { g.mesh.instanceMatrix.needsUpdate = true; g.mesh.instanceColor.needsUpdate = true; } });
      }
      const objs = st.objs || [];
      nInst = 0;
      for (let pass = 0; pass < 2; pass++) {
        const list = pass ? objs : staticMesh;
        for (let oi = 0; oi < list.length; oi++) {
          const o = list[oi];
          if (o.inst) { addInst(o, false); continue; }
          const k = SHAPES[o.k] ? o.k : 'box';
          const key = String(o.id);
          seen.add(key);
          let rec = meshes.get(key);
          if (!rec || rec.k !== k) { if (rec) release(rec); rec = make(k); meshes.set(key, rec); }
          const m = rec.m, mat = m.material;
          m.position.set(o.p[0], o.p[1], o.p[2]);
          m.rotation.set(o.r ? o.r[0] : (FLAT[k] ? -Math.PI / 2 : 0), o.r ? o.r[1] : 0, o.r ? o.r[2] : 0);
          if (typeof o.n === 'number') m.scale.set(o.n, o.n, o.n);
          else if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
          else m.scale.set(1, 1, 1);
          // brillo propio del color del objeto (no luz blanca): neón sin lavar los colores
          mat.color.copy(colOf(o.c));
          const e = o.e || 0;
          if (e > 0 || mat.userData.e) mat.emissive.copy(mat.color).multiplyScalar(e);
          mat.userData.e = e;
          const op = o.o != null ? o.o : 1;
          mat.opacity = op; const tr = op < 1; if (mat.transparent !== tr) { mat.transparent = tr; mat.depthWrite = !tr; mat.needsUpdate = true; }
          mat.roughness = o.m && o.m.r != null ? o.m.r : 0.85; mat.metalness = o.m && o.m.m != null ? o.m.m * METAL : 0.02;
          m.castShadow = !!o.sh && shadowsOn && !tr; m.receiveShadow = !!o.recv && shadowsOn;
        }
      }
      meshes.forEach((rec, key) => { if (!seen.has(key)) { release(rec); meshes.delete(key); } });
      groups.forEach((g, key) => {
        g.mesh.count = g.n; g.mesh.visible = g.n > 0;
        if (g.n) {
          g.idle = 0; nInst += g.n;
          if (!g.st) { g.mesh.instanceMatrix.needsUpdate = true; g.mesh.instanceColor.needsUpdate = true; }
          g.mesh.castShadow = g.sh && shadowsOn; g.mesh.receiveShadow = g.recv && shadowsOn;
        } else if (++g.idle > 240) { scene.remove(g.mesh); g.mesh.dispose(); g.mat.dispose(); mats.delete(g.mat); groups.delete(key); }
      });

      // ── fondo, niebla, cielo ──
      if (st.fog) { if (!scene.fog) scene.fog = new THREE.Fog(st.fog.c, st.fog.near, st.fog.far); else { scene.fog.color.set(st.fog.c); scene.fog.near = st.fog.near; scene.fog.far = st.fog.far; } }
      else scene.fog = null;
      const sk = st.sky;
      if (sk) {
        buildSky(sk.top || '#3a8fe8', sk.bottom || '#bfe6ff');
        sky.dome.visible = true; sky.dome.position.copy(camera.position);
        const showSun = sk.sun !== false;
        sky.disc.visible = showSun; sky.halo.visible = showSun;
        if (showSun) { sky.disc.position.copy(camera.position).addScaledVector(sunDir, 380); sky.halo.position.copy(sky.disc.position); sky.disc.material.color.set(sk.sunC || '#fff2c0'); }
        const nc = sk.clouds | 0;
        setClouds(nc);
        sky.clouds.visible = nc > 0;
        if (nc > 0) { sky.clouds.position.set(camera.position.x, 0, camera.position.z); sky.clouds.rotation.y = nowT * 0.004; sky.clouds.material.color.set(sk.cloud || '#ffffff'); }
        renderer.setClearColor(sk.bottom || '#bfe6ff', 1);
      } else if (sky) { sky.dome.visible = false; sky.disc.visible = false; sky.halo.visible = false; sky.clouds.visible = false; }
      if (!sk) renderer.setClearColor(st.bg != null ? st.bg : 0x000000, 1);

      // ── terreno y agua ──
      const T = st.terrain;
      if (T) { const tk = (T.id != null ? T.id : 't') + '|' + (T.ver || 0); if (tk !== terrainKey) { terrainKey = tk; buildTerrain(T); } terrain.visible = true; }
      else if (terrain) terrain.visible = false;
      const Wt = st.water;
      if (Wt) {
        if (!water) buildWater();
        water.visible = true;
        const ox = Math.round(camera.position.x / WC) * WC, oz = Math.round(camera.position.z / WC) * WC;
        water.position.set(ox, Wt.y || 0, oz);
        const base = water.userData.base, pa = water.geometry.attributes.position, arr = pa.array, amp = Wt.amp != null ? Wt.amp : 0.12;
        for (let i = 0; i < arr.length; i += 3) {
          const wx = base[i] + ox, wz = base[i + 2] + oz;
          arr[i + 1] = (Math.sin(wx * 0.23 + nowT * 1.1) + Math.sin(wz * 0.29 + nowT * 0.9) + Math.sin((wx + wz) * 0.15 + nowT * 1.7)) * amp / 3;
        }
        pa.needsUpdate = true;
        water.material.color.copy(colOf(Wt.c || '#2a8ad8')); water.material.opacity = Wt.o != null ? Wt.o : 0.86;
      } else if (water) water.visible = false;

      // ── luces puntuales ──
      const pl = st.lights || [];
      for (let i = 0; i < Math.min(4, pl.length); i++) {
        if (!plights[i]) { plights[i] = new THREE.PointLight(0xffffff, 0, 12, 1.6); scene.add(plights[i]); }
        const q = pl[i]; plights[i].position.set(q.p[0], q.p[1], q.p[2]); plights[i].color.set(q.c || '#ffd9a0'); plights[i].intensity = q.i != null ? q.i : 8; plights[i].distance = q.d || 12;
      }
      for (let i = pl.length; i < plights.length; i++) plights[i].intensity = 0;

      // ── partículas ──
      let pn = 0;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.l -= dtS;
        if (p.l <= 0) { parts.splice(i, 1); continue; }
        const dr = Math.max(0, 1 - p.d * dtS);
        p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - p.g * dtS;
        p.x += p.vx * dtS; p.y += p.vy * dtS; p.z += p.vz * dtS;
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]; if (!p.C) p.C = colOf(p.c);
        const sc = p.s * Math.sqrt(Math.min(1, p.l / (p.m * 0.6)));
        dummyP.set(p.x, p.y, p.z); dummyQ.identity(); dummyS.set(sc, sc, sc); dummyM.compose(dummyP, dummyQ, dummyS);
        pMesh.setMatrixAt(pn, dummyM); pMesh.setColorAt(pn, p.C); pn++;
      }
      pMesh.count = pn; pMesh.visible = pn > 0;
      if (pn) { pMesh.instanceMatrix.needsUpdate = true; pMesh.instanceColor.needsUpdate = true; }

      renderer.render(scene, camera);
      if (frames % 30 === 0) { stats.meshes = meshes.size; stats.inst = nInst; stats.calls = renderer.info.render.calls; stats.tris = renderer.info.render.triangles; try { globalThis.__w3d = stats; } catch (_) {} }
    },
    probe: () => probeGL(gl),
    dispose() {
      meshes.forEach(rec => { rec.m.material.dispose(); });
      groups.forEach(g => { g.mesh.dispose(); g.mat.dispose(); });
      try { renderer.dispose(); } catch (_) {}
    },
  };
  return world;
}
