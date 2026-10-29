import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { C, Lives, SCREEN_H, SCREEN_W, alpha, clamp, hx, lerp, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { animal, bush, coin, gem, hash01, house, mix, person, rock, shade, tree } from '../utils/prefabs';
import { compassAngle, forward, right, seeded } from '../utils/openworld';
import { OW_N, owGen } from '../utils/ow';

// MUNDO 3D – mundo abierto en primera persona con ciclo día/noche.
// Joystick izquierdo: caminar · derecho: mirar · 🏃 correr. Encuentra los 20 💎 (la brújula te guía), junta 🪙,
// y de noche escóndete o corre: salen 🐺 lobos.
//
// El mapa sale de owGen (utils/ow.js): árboles, rocas, aldeas, torres y montañas por celda. Aquí cada celda mide 2.5 m,
// la altura del terreno sale de un campo de montañas suavizado + colinas + lagos, y todo el decorado se instancia UNA vez
// (scene.statics). Lo dinámico (gemas, monedas, animales, lobos) solo se dibuja cerca del jugador.
const CS = 2.5, HALF = (OW_N * CS) / 2, TSIZE = 176, TOTAL_GEMS = 20, DAY = 160;
const WALK = 6.5, RUN = 11, EYE = 1.62;

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const tri = (n, d, y, dl) => (dl < 0.45 ? mix(n, d, dl / 0.45) : mix(d, y, (dl - 0.45) / 0.55));
const daylight = tod => clamp(Math.sin(tod * Math.PI * 2) * 1.5 + 0.55, 0, 1);

// ─── Mundo ────────────────────────────────────────────────────────
function genWorld(seed) {
  const w = owGen(seed), r = seeded(seed ^ 0x9e3779b9);
  const cx0 = (OW_N / 2) * CS;
  const cellPos = (cx, cy) => [(cx + 0.5) * CS - cx0, (cy + 0.5) * CS - cx0];
  // campo de montañas (1 = montaña) suavizado con un núcleo gaussiano 5×5; fuera del mapa cuenta como montaña
  const PAD = 4, N2 = OW_N + PAD * 2, F = new Float32Array(N2 * N2), G = new Float32Array(N2 * N2);
  const isM = (x, y) => (x < 0 || y < 0 || x >= OW_N || y >= OW_N ? 1 : w.m[y][x] === 5 ? 1 : 0);
  for (let y = 0; y < N2; y++) for (let x = 0; x < N2; x++) F[y * N2 + x] = isM(x - PAD, y - PAD);
  const K = [0.06, 0.24, 0.4, 0.24, 0.06];
  for (let y = 0; y < N2; y++) for (let x = 0; x < N2; x++) { let a = 0; for (let k = -2; k <= 2; k++) a += K[k + 2] * F[y * N2 + clamp(x + k, 0, N2 - 1)]; G[y * N2 + x] = a; }
  for (let y = 0; y < N2; y++) for (let x = 0; x < N2; x++) { let a = 0; for (let k = -2; k <= 2; k++) a += K[k + 2] * G[clamp(y + k, 0, N2 - 1) * N2 + x]; F[y * N2 + x] = a; }
  const field = (x, z) => {
    const u = x / CS + OW_N / 2 - 0.5 + PAD, v = z / CS + OW_N / 2 - 0.5 + PAD;
    const i = clamp(Math.floor(u), 0, N2 - 2), j = clamp(Math.floor(v), 0, N2 - 2), fu = clamp(u - i, 0, 1), fv = clamp(v - j, 0, 1);
    return (F[j * N2 + i] * (1 - fu) + F[j * N2 + i + 1] * fu) * (1 - fv) + (F[(j + 1) * N2 + i] * (1 - fu) + F[(j + 1) * N2 + i + 1] * fu) * fv;
  };
  const a = [r() * 6, r() * 6, r() * 6, r() * 6];
  const vil = w.villages.map(([cx, cy]) => cellPos(cx, cy));
  const flats = [[0, 0, 11], ...vil.map(([x, z]) => [x, z, 13])];
  const lakes = [];
  for (let k = 0; k < 60 && lakes.length < 3; k++) {
    const [x, z] = cellPos(8 + Math.floor(r() * (OW_N - 16)), 8 + Math.floor(r() * (OW_N - 16)));
    if (Math.hypot(x, z) < 26 || vil.some(([vx, vz]) => Math.hypot(vx - x, vz - z) < 24) || field(x, z) > 0.05 || lakes.some(l => Math.hypot(l.x - x, l.z - z) < 30)) continue;
    lakes.push({ x, z, r: 7 + r() * 5 });
  }
  const h = (x, z) => {
    let y = (Math.sin(x * 0.05 + a[0]) * 0.5 + Math.sin(z * 0.045 + a[1]) * 0.5 + Math.sin((x + z) * 0.03 + a[2]) * 0.7 + Math.sin((x - z) * 0.11 + a[3]) * 0.25) * 0.9 + 0.5;
    const f = field(x, z);
    if (f > 0.02) y += Math.pow(f, 1.35) * (12 + 11 * (0.5 + 0.5 * Math.sin(x * 0.13 + a[1]) * Math.sin(z * 0.11 + a[2])));
    for (const l of lakes) { const d = Math.hypot(x - l.x, z - l.z); y -= 2.9 * Math.exp(-(d * d) / (2 * l.r * l.r * 0.55)); }
    for (const [fx, fz, fr] of flats) { const d = Math.hypot(x - fx, z - fz); if (d < fr + 8) y = lerp(y, 0.6, 1 - smooth(fr - 2, fr + 8, d)); }
    return y;
  };
  return { w, r, h, cellPos, vil, lakes, field };
}

const terrainColor = (vil, lakes) => (y, x, z) => {
  const v = 0.94 + hash01(x.toFixed(1) + ',' + z.toFixed(1)) * 0.12;
  let c;
  if (y > 14) c = '#f1f5fb';
  else if (y > 9.5) c = '#aab0c0';
  else if (y > 5) c = '#8a8576';
  else if (y > 3) c = '#6e9a4a';
  else if (y < -0.9) c = '#b8a874';
  else if (y < -0.2) c = '#dccb92';
  else {
    c = y > 1.6 ? '#7dc656' : '#6bb84a';
    for (const [vx, vz] of vil) if (Math.hypot(x - vx, z - vz) < 7) { c = '#c8a870'; break; }
  }
  return shade(c, v);
};

const initState = () => {
  const seed = 1 + Math.floor(Math.random() * 1e9);
  const W = genWorld(seed), { w, r, h, cellPos, vil } = W;
  const colliders = new Map();
  const addCol = (x, z, rad) => { const k = Math.floor(x / 8) * 1000 + Math.floor(z / 8); (colliders.get(k) || colliders.set(k, []).get(k)).push({ x, z, r: rad }); };
  const st = [], houses = [];
  const tkinds = ['pine', 'pine', 'pine', 'pine', 'oak', 'pine', 'pine', 'birch'];
  for (let cy = 0; cy < OW_N; cy++) for (let cx = 0; cx < OW_N; cx++) {
    const t = w.m[cy][cx]; if (!t || t === 5) continue;
    const [px, pz] = cellPos(cx, cy), jx = (r() - 0.5) * 1.4, jz = (r() - 0.5) * 1.4, x = px + jx, z = pz + jz, y = h(x, z), id = `${cx}_${cy}`;
    if (t === 1) {
      if (y < -0.2 || y > 11 || r() < 0.4) continue;
      const kind = y > 5.5 ? 'pine' : tkinds[Math.floor(r() * 8)];
      st.push(...tree(`t${id}`, [x, y, z], { kind, h: 0.9 + r() * 0.6, inst: 'arbol', sh: false, snow: y > 7.5, leaf: kind === 'pine' ? (r() < 0.5 ? '#2d7a3e' : '#2a6e45') : undefined }));
      addCol(x, z, 0.55);
    } else if (t === 2) {
      st.push(...rock(`r${id}`, [x, y, z], { kind: r() < 0.3 ? 'boulder' : 'rock', c: r() < 0.5 ? '#8c8f99' : '#a09a8c', inst: 'roca' }));
      addCol(x, z, 1.1);
    } else if (t === 3) {
      if (houses.some(o => Math.hypot(o.x - px, o.z - pz) < 4.8)) continue;
      const vc = vil.reduce((b, q) => (Math.hypot(q[0] - px, q[1] - pz) < Math.hypot(b[0] - px, b[1] - pz) ? q : b), vil[0]);
      const kr = r(), kind = kr < 0.62 ? 'cottage' : kr < 0.82 ? 'hut' : 'barn', yaw = Math.atan2(-(vc[0] - px), -(vc[1] - pz)), yy = h(px, pz);
      const roofs = ['#c0463a', '#b8742e', '#6a4aa8', '#3f7a9a'], walls = ['#efe3c8', '#e8d2a8', '#d9c9b0', '#f2e6d6'];
      st.push(...house(`h${id}`, [px, yy, pz], { kind, yaw, roof: roofs[Math.floor(r() * 4)], c: walls[Math.floor(r() * 4)], inst: 'casa' }));
      houses.push({ x: px, z: pz, y: yy, yaw, kind });
      addCol(px, pz, kind === 'barn' ? 3.8 : 2.5);
    } else if (t === 4) {
      const yy = h(px, pz);
      st.push(...house(`w${id}`, [px, yy, pz], { kind: 'tower', yaw: r() * 6.28, inst: 'casa' }));
      houses.push({ x: px, z: pz, y: yy, yaw: 0, kind: 'tower' });
      addCol(px, pz, 1.9);
    }
  }
  // pinos en las laderas bajas de las montañas
  for (let k = 0, n = 0; k < 900 && n < 110; k++) {
    const x = (r() - 0.5) * HALF * 2.1, z = (r() - 0.5) * HALF * 2.1, y = h(x, z);
    if (y > 3.2 && y < 10 && W.field(x, z) > 0.1) { st.push(...tree(`m${k}`, [x, y, z], { kind: 'pine', h: 1 + r() * 0.8, inst: 'arbol', sh: false, snow: y > 7, leaf: '#2a6e45' })); n++; }
  }
  const spot = (minY, maxY, minD, rad = 0.8) => { for (let k = 0; k < 300; k++) { const [x, z] = cellPos(...w.free[Math.floor(r() * w.free.length)]); const jx = x + (r() - 0.5) * 1.2, jz = z + (r() - 0.5) * 1.2, y = h(jx, jz); if (y > minY && y < maxY && Math.hypot(jx, jz) > minD && !blockedAt(jx, jz, rad)) return { x: jx, z: jz, y }; } return { x: 6, z: 6, y: h(6, 6) }; };
  const blockedAt = (x, z, rad) => {
    const y = h(x, z); if (y > 4.6 || y < -1.6 || Math.abs(x) > HALF - 7 || Math.abs(z) > HALF - 7) return true;
    const kx = Math.floor(x / 8), kz = Math.floor(z / 8);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = colliders.get((kx + i) * 1000 + kz + j); if (l) for (const c of l) if ((c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + rad) ** 2) return true; }
    return false;
  };
  // flores y arbustos de adorno
  for (let i = 0; i < 90; i++) { const q = spot(0.2, 2.6, 4, 0.2); st.push({ k: 'oct', inst: 'flor', p: [q.x, q.y + 0.28, q.z], s: [0.24, 0.24, 0.24], c: ['#ff6fa8', '#ffd54a', '#ffffff', '#b57bff', '#ff8a3d'][i % 5] }, { k: 'box', inst: 'tallo', p: [q.x, q.y + 0.13, q.z], s: [0.04, 0.26, 0.04], c: '#3f8a3a' }); }
  for (let i = 0; i < 36; i++) { const q = spot(0.2, 3, 4, 0.2); st.push(...bush(`b${i}`, [q.x, q.y, q.z], { inst: 'mata', sh: false, c: r() < 0.5 ? '#3f9b45' : '#2f8a4a' })); }
  // plazas de aldea: suelo de tierra, farolas y pozo
  vil.forEach(([vx, vz], i) => {
    st.push({ id: `pl${i}`, k: 'cyl', inst: 'plaza', p: [vx, 0.63, vz], s: [14, 0.06, 14], c: '#c8a870' });
    for (let q = 0; q < 4; q++) { const aa = q * 1.571 + 0.78, lx = vx + Math.cos(aa) * 5, lz = vz + Math.sin(aa) * 5; st.push({ k: 'cyl', inst: 'poste', p: [lx, 1.6, lz], s: [0.12, 2.0, 0.12], c: '#3a3f4a' }, { k: 'sph', inst: 'farola', p: [lx, 2.75, lz], n: 0.42, c: '#ffe9a8', e: 1 }); addCol(lx, lz, 0.2); }
    st.push({ k: 'cyl', inst: 'pozo', p: [vx, 0.95, vz], s: [1.3, 0.7, 1.3], c: '#8c8f99' }, { k: 'cone', inst: 'pozo', p: [vx, 2.1, vz], s: [1.9, 0.9, 1.9], c: '#b8742e' });
    addCol(vx, vz, 0.8);
  });
  // campamento inicial
  const sy = h(0, 0);
  st.push({ k: 'cyl', inst: 'plaza', p: [0, sy + 0.03, 0], s: [8, 0.06, 8], c: '#c8a870' });
  for (let q = 0; q < 6; q++) { const aa = q * 1.047; st.push({ k: 'ico', inst: 'roca', p: [Math.cos(aa) * 1.3, sy + 0.2, Math.sin(aa) * 1.3 + 4], s: [0.55, 0.4, 0.5], c: '#7c7f89' }); }
  addCol(0, 4, 1.5);

  const gems = Array.from({ length: TOTAL_GEMS }, (_, i) => ({ id: `g${i}`, ...spot(-0.1, 3.8, 17), got: false, tGot: 0 }));
  const coins = Array.from({ length: 46 }, (_, i) => ({ id: `c${i}`, ...spot(-0.1, 3.8, 6), got: false }));
  const kinds = ['cow', 'sheep', 'deer', 'pig', 'sheep', 'cow'];
  const critters = Array.from({ length: 16 }, (_, i) => ({ id: `a${i}`, kind: kinds[i % kinds.length], ...spot(0.3, 3, 9, 1), a: r() * 6.28, tm: 1 + r() * 3 }));
  return {
    seed, W, h, blockedAt, houses, statics: st, gems, coins, critters, wolves: [],
    terrain: { id: `mundo${seed}`, h, size: TSIZE, step: 2, color: terrainColor(vil, W.lakes) },
    p0y: sy, p: { x: 0, y: sy, z: 0 }, yaw: 0, pitch: 0, tod: 0.18, t: 0, bob: 0, walk: 0, hp: 3, inv: 0, wolfT: 3, dist: 0, gotG: 0, gotC: 0, toast: null, banner: { m: 'MUNDO ABIERTO', t: 2.2 }, final: null, fxT: 0, ffT: 0, wid: 0,
  };
};

// ─── Ambiente según la hora ───────────────────────────────────────
function envOf(tod) {
  const dl = daylight(tod), a = tod * Math.PI * 2, sx = Math.cos(a) * 0.85, sy = 0.25 + 0.75 * Math.sin(a);
  const dir = sy > -0.12 ? [sx, Math.max(sy, 0.04), 0.4] : [-sx, -sy, 0.4];
  const bottom = tri('#0e1536', '#ff9a5e', '#bfe6ff', dl);
  return {
    dl, night: dl < 0.3,
    sky: { top: tri('#050818', '#4a3a8a', '#2f86e6', dl), bottom, clouds: 8, cloud: tri('#2a3050', '#ffc9b0', '#ffffff', dl), sunC: dl < 0.12 ? '#e8f0ff' : '#fff2c0' },
    fog: { c: bottom, near: lerp(10, 45, dl), far: lerp(52, 125, dl) },
    light: { dir, sun: tri('#8fa8ff', '#ff9a5a', '#fff4dc', dl), i: lerp(0.9, 2.4, dl), sky: tri('#2a3a7a', '#c8a0c0', '#dfeaff', dl), ground: tri('#14162a', '#4a3a40', '#5b5648', dl), hi: lerp(0.8, 1.8, dl) },
    water: tri('#0e2a50', '#3a6a9a', '#2aa0e0', dl),
  };
}

const rot = (yaw, x, z) => [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];

// Escena. mode 'fp' = primera persona · 'show' = el explorador visible (menús)
function buildScene(s, t, mode) {
  const p = s.p, env = envOf(s.tod), objs = [];
  const near = (o, R) => (o.x - p.x) ** 2 + (o.z - p.z) ** 2 < R * R;
  for (const gm of s.gems) {
    const age = s.t - gm.tGot;
    if (gm.got && age > 0.6) continue;
    if (!near(gm, 100)) continue;
    objs.push(...gem(gm.id, [gm.x, gm.y + 0.9, gm.z], { t, n: gm.got ? 1 + age * 3 : 1.3, o: gm.got ? Math.max(0, 1 - age / 0.6) : 1 }));
    if (!gm.got) objs.push({ id: `${gm.id}b`, k: 'cyl', p: [gm.x, gm.y + 14, gm.z], s: [0.5, 28, 0.5], c: '#4de1ff', e: 1, o: 0.2 + Math.sin(t * 3 + gm.x) * 0.05 });
  }
  for (const c of s.coins) if (!c.got && near(c, 55)) objs.push(...coin(c.id, [c.x, c.y + 0.9, c.z], { t, bob: 0.1, inst: 'moneda', sh: false }));
  for (const k of s.critters) if (near(k, 75)) objs.push(...animal(k.id, k.kind, [k.x, k.y, k.z], { yaw: Math.atan2(-Math.cos(k.a), -Math.sin(k.a)) + Math.PI, t, walk: 1, inst: 'animal' }));
  for (const wf of s.wolves) {
    const yaw = Math.atan2(-wf.dx, -wf.dz);
    objs.push(...animal(wf.id, 'dog', [wf.x, wf.y, wf.z], { yaw, t: t * 1.6, walk: 1, c: '#4a4f5e', n: 1.35 }));
    for (const sx of [-1, 1]) { const q = rot(yaw, sx * 0.08 * 1.35, -0.67 * 1.35); objs.push({ id: `${wf.id}e${sx}`, k: 'sph', p: [wf.x + q[0], wf.y + 0.78 * 1.35, wf.z + q[1]], n: 0.11, c: '#ff3030', e: 1 }); }
  }
  if (env.night) {   // ventanas encendidas de noche
    for (const hs of s.houses) {
      if (!near(hs, 70)) continue;
      if (hs.kind === 'cottage') for (const sx of [-1.25, 1.25]) { const q = rot(hs.yaw, sx, -1.88); objs.push({ k: 'box', inst: 'ventana', p: [hs.x + q[0], hs.y + 1.7, hs.z + q[1]], s: [0.75, 0.7, 0.1], r: [0, hs.yaw, 0], c: '#ffd27a', e: 1 }); }
      else if (hs.kind === 'tower') { const q = rot(hs.yaw, 0, -1.53); objs.push({ k: 'box', inst: 'ventana', p: [hs.x + q[0], hs.y + 4.2, hs.z + q[1]], s: [0.5, 0.9, 0.1], r: [0, hs.yaw, 0], c: '#ffd27a', e: 1 }); }
    }
  }
  // fuego del campamento
  objs.push({ id: 'fuego', k: 'cone', p: [0, s.p0y + 0.45, 4], s: [0.7 + Math.sin(t * 14) * 0.08, 0.9 + Math.sin(t * 11) * 0.12, 0.7], c: '#ff8a2e', e: 1, o: 0.9 });
  objs.push({ id: 'fuego2', k: 'cone', p: [0, s.p0y + 0.35, 4], s: [0.4, 0.6, 0.4], c: '#ffe27a', e: 1 });
  objs.push({ id: 'lenos', k: 'cyl', p: [0, s.p0y + 0.12, 4], s: [0.9, 0.16, 0.2], r: [0, 0.7, Math.PI / 2], c: '#5a3a22' });
  const lights = [{ p: [0, s.p0y + 1.2, 4], c: '#ff9a3a', i: env.night ? 10 : 2, d: 16 }];
  let cam;
  const sprint = s.sprint ? 1 : 0;
  if (mode === 'fp') {
    const bob = Math.sin(s.bob) * 0.045 * s.walk;
    cam = { p: [p.x, p.y + EYE + bob, p.z], yaw: s.yaw, pitch: s.pitch, fov: 70 + sprint * 7 * s.walk };
    if (env.night) lights.push({ p: [p.x, p.y + EYE + 0.3, p.z], c: '#ffe0a8', i: 7, d: 15 });
    // farol en la mano de noche
    if (env.night) {
      const f = forward(s.yaw), rt = right(s.yaw);
      const lx = p.x + f[0] * 0.55 + rt[0] * 0.32, lz = p.z + f[1] * 0.55 + rt[1] * 0.32, ly = p.y + EYE - 0.38 + bob * 1.4;
      objs.push({ id: 'lampB', k: 'cyl', p: [lx, ly, lz], s: [0.12, 0.2, 0.12], c: '#2a2a30' }, { id: 'lampG', k: 'sph', p: [lx, ly + 0.02, lz], n: 0.15, c: '#ffd27a', e: 1 }, { id: 'lampT', k: 'cyl', p: [lx, ly + 0.14, lz], s: [0.14, 0.04, 0.14], c: '#2a2a30' });
    }
  } else {
    objs.push(...person('yo', [p.x, p.y, p.z], { yaw: s.yaw, t, walk: s.walk, hat: 'cowboy', shirt: '#d6402f', pants: '#3b4a6a' }));
    cam = { p: [p.x + 6, p.y + 3.4, p.z + 9], l: [p.x, p.y + 1.2, p.z], fov: 58 };
  }
  return {
    sky: env.sky, fog: env.fog, light: env.light, shadowR: 30,
    terrain: s.terrain, water: { y: -0.9, c: env.water, o: 0.86, amp: 0.08 },
    statics: s.statics, objs, lights, cam, _env: env,
  };
}

// ─── Piezas 2D ────────────────────────────────────────────────────
function MiniMap({ s }) {
  const R = 46, WR = 48, f = forward(s.yaw), rt = right(s.yaw), p = s.p;
  const dot = (o, col, sz, key) => {
    const dx = o.x - p.x, dz = o.z - p.z;
    const sx = (dx * rt[0] + dz * rt[1]) * (R / WR), sy = -(dx * f[0] + dz * f[1]) * (R / WR);
    if (sx * sx + sy * sy > (R - 3) * (R - 3)) return null;
    return <View key={key} style={{ position: 'absolute', left: R + sx - sz / 2, top: R + sy - sz / 2, width: sz, height: sz, borderRadius: sz / 2, backgroundColor: col }} />;
  };
  return (
    <View pointerEvents="none" style={{ position: 'absolute', right: 10, top: 40, width: R * 2, height: R * 2, borderRadius: R, backgroundColor: 'rgba(6,10,24,0.55)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' }}>
      {s.W.vil.map((v, i) => dot({ x: v[0], z: v[1] }, '#ffc233', 9, `v${i}`))}
      {s.gems.filter(g => !g.got).map(g => dot(g, '#4de1ff', 6, g.id))}
      {s.wolves.map(wf => dot(wf, '#ff3d3d', 7, wf.id))}
      <View style={{ position: 'absolute', left: R - 5, top: R - 6, width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 11, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fff' }} />
    </View>
  );
}

export function OpenWorld3DGame({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('openworld');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false, why: '' });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const sprint = useRef({ on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); const s = initState(); g.current = s; sprint.on = false; setPhase('play'); hx.tap(); };
  const finish = (s, won, why) => {
    s.final = s.gotG * 100 + s.gotC * 10 + (won ? 500 : 0);
    if (won) hx.win(); else hx.die();
    setRes({ isNew: submitBest(s.final), won, why }); setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current, p = s.p; s.t += dt; s.tod = (s.tod + dt / DAY) % 1; s.inv = Math.max(0, s.inv - dt);
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    // mirar y caminar (joystick normalizado)
    s.yaw -= look.x * 2.7 * dt;
    s.pitch = clamp(-look.y * 0.55, -0.5, 0.65);
    let mx = move.x, my = move.y; const mm = Math.hypot(mx, my); if (mm > 1) { mx /= mm; my /= mm; }
    const spd = sprint.on ? RUN : WALK; s.sprint = sprint.on && mm > 0.2;
    const f = forward(s.yaw), rt = right(s.yaw);
    const sf = my > 0 ? 0.7 : 1, dx = (f[0] * -my + rt[0] * mx) * spd * sf * dt, dz = (f[1] * -my + rt[1] * mx) * spd * sf * dt;
    const ox = p.x, oz = p.z;
    if (!s.blockedAt(p.x + dx, p.z, 0.4)) p.x += dx;
    if (!s.blockedAt(p.x, p.z + dz, 0.4)) p.z += dz;
    p.y = s.h(p.x, p.z);
    const moved = Math.hypot(p.x - ox, p.z - oz); s.dist += moved; s.bob += moved * 2.4;
    s.walk += ((moved / Math.max(dt, 1e-3) > 1 ? 1 : 0) - s.walk) * Math.min(1, dt * 8);
    const env = envOf(s.tod), night = env.night;
    // luciérnagas de noche
    s.ffT -= dt; if (night && s.ffT <= 0) { s.ffT = 0.12; burst3d([p.x + (Math.random() - 0.5) * 24, p.y + 0.6 + Math.random() * 2.5, p.z + (Math.random() - 0.5) * 24], '#c8ff6a', 1, { speed: 0.5, life: 3, size: 0.07, g: -0.1, drag: 0.5 }); }
    s.fxT -= dt;
    if (s.fxT <= 0) { s.fxT = 0.15; const gm = s.gems[Math.floor(Math.random() * s.gems.length)]; if (!gm.got && Math.hypot(gm.x - p.x, gm.z - p.z) < 40) burst3d([gm.x + (Math.random() - 0.5), gm.y + 0.6, gm.z + (Math.random() - 0.5)], '#aef2ff', 1, { speed: 0.5, up: 1.2, g: -0.5, size: 0.1, life: 1.2 }); }
    // recogidas
    for (const gm of s.gems) {
      if (gm.got || Math.hypot(gm.x - p.x, gm.z - p.z) > 1.7) continue;
      gm.got = true; gm.tGot = s.t; s.gotG += 1; hx.good(); fx.flash(C.cyan, 0.22);
      burst3d([gm.x, gm.y + 1, gm.z], ['#4de1ff', '#ffffff', '#9be8ff'], 34, { speed: 6.5, up: 3.5, g: 10, size: 0.2, life: 1.0 });
      ring3d([gm.x, gm.y + 0.4, gm.z], '#4de1ff', 20, { speed: 5, life: 0.6, size: 0.14 });
      fx.pop(SCREEN_W / 2, SCREEN_H * 0.4, '+100', C.cyan, 28);
      s.toast = { m: `💎 Cristal ${s.gotG}/${TOTAL_GEMS}`, t: 1.6 };
      if (s.gotG >= TOTAL_GEMS) { finish(s, true, ''); return; }
    }
    for (const c of s.coins) {
      if (c.got || Math.hypot(c.x - p.x, c.z - p.z) > 1.5) continue;
      c.got = true; s.gotC += 1; hx.tick(); burst3d([c.x, c.y + 0.9, c.z], ['#ffd23f', '#fff3b0'], 8, { speed: 3, up: 2, g: 9, size: 0.12, life: 0.5 });
    }
    // animales
    for (const k of s.critters) {
      k.tm -= dt; if (k.tm <= 0) { k.a = Math.random() * 6.28; k.tm = 1.5 + Math.random() * 3; }
      const nx = k.x + Math.cos(k.a) * 1.25 * dt, nz = k.z + Math.sin(k.a) * 1.25 * dt;
      if (s.blockedAt(nx, nz, 0.8)) k.a += 2; else { k.x = nx; k.z = nz; }
      k.y = s.h(k.x, k.z);
    }
    // lobos de noche
    s.wolfT -= dt;
    if (night && s.wolfT <= 0 && s.wolves.length < 3) {
      s.wolfT = 7;
      for (let q = 0; q < 20; q++) { const a = Math.random() * 6.28, r = 22 + Math.random() * 11, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; if (!s.blockedAt(x, z, 0.8)) { s.wolves.push({ id: `w${s.wid++}`, x, z, y: s.h(x, z), dx: 0, dz: 1 }); hx.warn(); s.toast = { m: '🐺 Se oyen lobos…', t: 1.6 }; break; } }
    }
    for (const wf of s.wolves) {
      const d = Math.hypot(wf.x - p.x, wf.z - p.z) || 1;
      if ((!night && Math.random() < dt * 0.5) || d > 70) { wf.gone = true; continue; }
      const chase = d < 27, sp = (chase ? 5.3 : 2) * dt, ux = (p.x - wf.x) / d, uz = (p.z - wf.z) / d;
      const vx = chase ? ux : Math.cos(s.t + wf.x), vz = chase ? uz : Math.sin(s.t + wf.x);
      wf.dx = vx; wf.dz = vz;
      const nx = wf.x + vx * sp, nz = wf.z + vz * sp;
      if (!s.blockedAt(nx, nz, 0.6)) { wf.x = nx; wf.z = nz; } else if (!s.blockedAt(nx, wf.z, 0.6)) wf.x = nx; else if (!s.blockedAt(wf.x, nz, 0.6)) wf.z = nz;
      wf.y = s.h(wf.x, wf.z);
      if (d < 1.8 && s.inv <= 0) {
        s.hp -= 1; s.inv = 1.6; hx.bad(); fx.shake(9, 0.3); fx.flash(C.red, 0.4); s.toast = { m: '🐺 ¡Un lobo te mordió!', t: 1.4 };
        burst3d([p.x, p.y + 1.2, p.z], ['#ff4d4d', '#ffb0a0'], 18, { speed: 5, up: 2, size: 0.15, life: 0.6 });
        wf.x -= ux * 4; wf.z -= uz * 4;
        if (s.hp <= 0) { finish(s, false, 'lobos'); return; }
      }
    }
    s.wolves = s.wolves.filter(wf => !wf.gone);
  });

  const s = g.current, p = s.p;
  let target = null, td = 1e9; s.gems.forEach(gm => { if (!gm.got) { const d = Math.hypot(gm.x - p.x, gm.z - p.z); if (d < td) { td = d; target = gm; } } });
  const ang = target ? compassAngle(p, s.yaw, target) : 0;
  const tNow = phase === 'play' ? s.t : 0;
  const scene = buildScene(s, tNow, 'fp');
  const env = scene._env;
  const sc = s.final != null ? s.final : s.gotG * 100 + s.gotC * 10;
  const why = res.won ? '¡TODOS LOS CRISTALES!' : res.why === 'lobos' ? 'DEVORADO POR LOBOS' : 'EXPEDICIÓN TERMINADA';
  return (
    <Game3D title="MUNDO 3D" emoji="🌍" accent={C.lime} onExit={onExit} score={sc} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene({ ...s, walk: 0, tod: s.final != null ? s.tod : 0.2 }, t, 'show')} orbit={{ r: 13, h: 4.2, speed: 0.18, ly: 1.2, drop: 2.2 }}
      hud={<><Lives n={s.hp} max={3} /><HudPill icon="💎" value={`${s.gotG}/${TOTAL_GEMS}`} color={C.cyan} /><HudPill icon="🪙" value={String(s.gotC)} color={C.amber} /><HudPill icon={env.night ? '🌙' : '☀️'} value={env.night ? 'NOCHE' : 'DÍA'} color={env.night ? C.violet : C.amber} /></>}
      subtitle="Explora un mundo abierto en primera persona"
      lines={['Joystick izquierdo: moverte · derecho: mirar alrededor', '🏃 mantén pulsado para correr', 'Encuentra 20 💎 (la brújula te guía) y junta 🪙', 'De noche salen 🐺: corre o escóndete tras las casas', 'Aldeas, bosques, lagos, torres y montañas por descubrir']}
      result={{ won: res.won, isNew: res.isNew, title: why, emoji: res.won ? '🏆' : res.why === 'lobos' ? '🐺' : '🌍', subtitle: `💎 ${s.gotG}/${TOTAL_GEMS} · 🪙 ${s.gotC} · ${Math.round(s.dist)} m recorridos`, stats: [['CRISTALES', `${s.gotG}/${TOTAL_GEMS}`], ['MONEDAS', s.gotC], ['VIDAS', s.hp]] }}>
      {target && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 4, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: C.cyan, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Cristal a {Math.round(td)} m</Text>
          </View>
        </View>
      )}
      <MiniMap s={s} />
      {s.inv > 0 && <View pointerEvents="none" style={{ position: 'absolute', left: -4, right: -4, top: -80, bottom: -40, borderWidth: 14, borderColor: 'rgba(255,60,80,0.25)' }} />}
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '22%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: '28%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow('#000', 8) }}>{s.banner.m}</Text>}
      <View pointerEvents="none" style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -3, marginTop: -3, width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' }} />
      <Pressable testID="ow-end" onPress={() => finish(g.current, false, 'fin')} style={{ position: 'absolute', right: 8, top: 4 }} hitSlop={8}>
        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: C.line }}><Text style={{ color: C.dim, fontSize: 11, fontWeight: '800' }}>🏁 TERMINAR</Text></View>
      </Pressable>
      <Stick3D testID="ow-move" v={move} side="left" color={C.cyan} />
      <Stick3D testID="ow-look" v={look} side="right" color={C.lime} />
      <ActionBtn testID="ow-sprint" icon="🏃" label="CORRER" color={C.amber} onDown={() => { sprint.on = true; }} onUp={() => { sprint.on = false; }} style={{ left: '50%', marginLeft: -33, bottom: 34 }} />
    </Game3D>
  );
}
