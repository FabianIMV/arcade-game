import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, TouchBtn, TouchStick, alpha, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { followCam, makeHeightmap, near, project, seeded, terrainObjs } from '../utils/openworld';

// SAFARI FOTO – mundo abierto en tercera persona, en un jeep por la sabana.
// Joystick izquierdo: conducir · derecho: girar la cámara · FOTO: animal centrado y a menos de 18 m.
const SF_SIZE = 170, SF_TIME = 120, SF_FILM = 12, SF_RANGE = 18, SF_MAX = 16, SF_REV = 6, SF_DRAW = 40;
const SF_BASE = [0, 100, 200, 350];   // puntos por rareza (1 común · 2 poco común · 3 rara)
const SF_NEW = [0, 150, 300, 450];    // bonus por la primera foto de cada especie en la partida
const SF_SKY = '#9fd8f2';
const sfColor = y => (y < 0.5 ? '#9fb55a' : y < 1.6 ? '#d7bd6a' : '#c9a85c');
const cl = (v, m) => Math.max(-m, Math.min(m, v));

// Especies. Cuerpo bw×bh×bl · patas leg · cuello neck (grosor nw) · cabeza hd · col cuerpo · dk detalles · lc patas.
const SF_SPECIES = [
  { id: 'cebra', name: 'Cebra', rar: 1, bw: 1.0, bh: 1.0, bl: 1.9, leg: 0.8, neck: 0.5, nw: 0.34, hd: [0.42, 0.46, 0.75], col: '#f4f1ea', dk: '#1e1e1e', lc: '#1e1e1e', stripes: 5, tail: true, sp: 2.4, fl: 6.5 },
  { id: 'jirafa', name: 'Jirafa', rar: 2, bw: 0.9, bh: 0.9, bl: 1.6, leg: 1.8, neck: 2.3, nw: 0.3, hd: [0.4, 0.42, 0.62], col: '#e8b24c', dk: '#8a5222', spots: 10, horns: true, sp: 2.0, fl: 6 },
  { id: 'elefante', name: 'Elefante', rar: 3, bw: 1.7, bh: 1.7, bl: 2.7, leg: 1.1, neck: 0, hd: [1.1, 1.1, 0.9], col: '#8c8f99', dk: '#c9a6a6', trunk: true, ears: true, tail: true, sp: 1.6, fl: 4.5 },
  { id: 'leon', name: 'León', rar: 3, bw: 0.9, bh: 0.85, bl: 1.9, leg: 0.7, neck: 0, hd: [0.62, 0.62, 0.62], col: '#d19a4b', dk: '#5e3f1c', mane: true, tail: true, sp: 2.1, fl: 7 },
  { id: 'leopardo', name: 'Leopardo', rar: 3, bw: 0.7, bh: 0.62, bl: 1.5, leg: 0.6, neck: 0, hd: [0.46, 0.44, 0.52], col: '#e6b452', dk: '#2a1f12', spots: 14, tail: true, sp: 2.4, fl: 8 },
  { id: 'nu', name: 'Ñu', rar: 1, bw: 1.1, bh: 1.0, bl: 1.8, leg: 0.9, neck: 0, hd: [0.5, 0.62, 0.62], col: '#6d6a62', dk: '#3a3733', horns: true, sp: 2.2, fl: 6.5 },
  { id: 'gacela', name: 'Gacela', rar: 1, bw: 0.6, bh: 0.6, bl: 1.2, leg: 0.9, neck: 0.5, nw: 0.2, hd: [0.3, 0.32, 0.45], col: '#d9a86a', dk: '#f6f0e4', horns: true, tail: true, sp: 3.0, fl: 9 },
  { id: 'avestruz', name: 'Avestruz', rar: 2, bw: 1.0, bh: 1.0, bl: 1.4, leg: 1.4, neck: 1.2, nw: 0.22, hd: [0.3, 0.32, 0.46], col: '#2e2d2a', dk: '#e7e1d0', lc: '#b9a48a', sp: 3.0, fl: 8 },
  { id: 'bufalo', name: 'Búfalo', rar: 2, bw: 1.4, bh: 1.2, bl: 2.2, leg: 0.8, neck: 0, hd: [0.8, 0.7, 0.8], col: '#4a3a2c', dk: '#2b2119', horns: true, sp: 1.8, fl: 5 },
  { id: 'rinoceronte', name: 'Rinoceronte', rar: 3, bw: 1.4, bh: 1.3, bl: 2.4, leg: 0.8, neck: 0, hd: [0.9, 0.8, 0.9], col: '#7e8189', dk: '#d8d4c8', nose: true, sp: 1.5, fl: 4 },
  { id: 'hiena', name: 'Hiena', rar: 2, bw: 0.7, bh: 0.62, bl: 1.4, leg: 0.5, neck: 0, hd: [0.46, 0.46, 0.6], col: '#9f8a68', dk: '#4a3b28', spots: 6, tail: true, sp: 2.2, fl: 6.5 },
  { id: 'jabali', name: 'Jabalí', rar: 1, bw: 0.8, bh: 0.7, bl: 1.4, leg: 0.45, neck: 0, hd: [0.5, 0.46, 0.6], col: '#6b5136', dk: '#e9e0cc', tusks: true, sp: 2.2, fl: 7 },
];
// individuos: 3 de cada especie común, 2 del resto (ver initState)

const sfHome = (r, half, minD) => {
  for (let k = 0; k < 300; k++) { const x = (r() - 0.5) * 2 * half, z = (r() - 0.5) * 2 * half; if (Math.hypot(x, z) > minD) return { x, z }; }
  return { x: minD, z: minD };
};

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const hm = makeHeightmap(seed, SF_SIZE, { amp: 2.2 });
  const half = SF_SIZE / 2 - 8;
  const at = minD => { const q = sfHome(r, half, minD); return { ...q, y: hm.h(q.x, q.z) }; };
  const animals = [];
  SF_SPECIES.forEach((sp, si) => {
    for (let j = 0; j < (sp.rar === 1 ? 3 : 2); j++) {
      const q = at(16);
      animals.push({ id: `an${animals.length}`, k: si, x: q.x, z: q.z, y: q.y, hx0: q.x, hz0: q.z, h: r() * 6.28, mv: 0, g: 0, tx: q.x, tz: q.z, tm: 1 + r() * 3, walk: false, fl: 0 });
    }
  });
  const trees = Array.from({ length: 60 }, (_, i) => { const q = at(8); return { id: `ac${i}`, x: q.x, z: q.z, y: q.y, h: 3.2 + r() * 1.4, w: 0.85 + r() * 0.35, rad: 0.45 }; });
  const rocks = Array.from({ length: 22 }, (_, i) => { const q = at(8); return { id: `rk${i}`, x: q.x, z: q.z, y: q.y, rad: 0.9 }; });
  return {
    hm, half, animals, trees, rocks, solids: [...trees, ...rocks],
    p: { x: 0, y: hm.h(0, 0), z: 0, face: 0 }, jh: 0, v: 0, yaw: Math.PI,
    time: SF_TIME, film: SF_FILM, shots: 0, pts: 0, seen: {}, species: 0,
    t: 0, toast: null, final: null, done: false,
  };
};

// Marco local de un objeto orientado (mismo giro que la malla: Ry(h)). L(lx, ly, lz) → mundo.
const frameOf = (x, y, z, h) => {
  const fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
  return (lx, ly, lz) => [x + rx * lx + fx * lz, y + ly, z + rz * lx + fz * lz];
};

function animalObjs(a, sp) {
  const L = frameOf(a.x, a.y, a.z, a.h), R = [0, a.h, 0];
  const bob = a.mv > 0.3 ? Math.abs(Math.sin(a.g)) * 0.08 : 0;
  const out = [];
  const add = (sfx, k, lx, ly, lz, s, c) => out.push({ id: a.id + sfx, k, p: L(lx, ly, lz), s, c, r: R });
  const bc = sp.leg + sp.bh / 2 + bob, top = sp.leg + sp.bh + bob;
  const lw = Math.max(0.14, Math.min(0.26, sp.bw * 0.22)), lc = sp.lc || sp.col;
  add('l0', 'box', -sp.bw * 0.36, sp.leg / 2, -sp.bl * 0.34, [lw, sp.leg, lw], lc);
  add('l1', 'box', sp.bw * 0.36, sp.leg / 2, -sp.bl * 0.34, [lw, sp.leg, lw], lc);
  add('l2', 'box', -sp.bw * 0.36, sp.leg / 2, sp.bl * 0.34, [lw, sp.leg, lw], lc);
  add('l3', 'box', sp.bw * 0.36, sp.leg / 2, sp.bl * 0.34, [lw, sp.leg, lw], lc);
  add('b', 'box', 0, bc, 0, [sp.bw, sp.bh, sp.bl], sp.col);
  // cuello y cabeza
  const hcz = sp.neck ? sp.bl * 0.4 + sp.hd[2] * 0.3 : sp.bl / 2 + sp.hd[2] * 0.4 - 0.1;
  const hcy = sp.neck ? top + sp.neck + sp.hd[1] / 2 - 0.25 : sp.leg + sp.bh * 0.62 + bob;
  if (sp.neck) add('n', 'box', 0, top + sp.neck / 2 - 0.1, sp.bl * 0.4, [sp.nw, sp.neck, sp.nw], sp.col);
  if (sp.mane) add('m', 'sph', 0, hcy, hcz - 0.25, [sp.hd[0] * 2.1, sp.hd[1] * 2.1, sp.hd[2] * 1.3], sp.dk);
  add('h', 'box', 0, hcy, hcz, sp.hd, sp.col);
  if (sp.horns) for (const sx of [-1, 1]) add(`k${sx > 0 ? 'r' : 'l'}`, 'cone', sx * sp.hd[0] * 0.28, hcy + sp.hd[1] / 2 + 0.14, hcz - sp.hd[2] * 0.1, [0.08, 0.3, 0.08], '#efe6cc');
  if (sp.nose) add('nz', 'cone', 0, hcy + sp.hd[1] / 2 + 0.1, hcz + sp.hd[2] / 2 - 0.05, [0.22, 0.4, 0.22], '#efe6cc');
  if (sp.tusks) for (const sx of [-1, 1]) add(`u${sx > 0 ? 'r' : 'l'}`, 'cone', sx * 0.16, hcy - sp.hd[1] * 0.25, hcz + sp.hd[2] / 2 - 0.02, [0.09, 0.32, 0.09], '#f4ecd6');
  if (sp.ears) for (const sx of [-1, 1]) add(`e${sx > 0 ? 'r' : 'l'}`, 'box', sx * (sp.hd[0] / 2 + 0.12), hcy + 0.05, hcz - 0.2, [0.12, sp.hd[1] * 0.9, sp.hd[2] * 0.55], sp.dk);
  if (sp.trunk) {
    add('t1', 'box', 0, hcy - sp.hd[1] * 0.5, hcz + sp.hd[2] / 2 + 0.14, [0.3, 0.9, 0.3], sp.dk);
    add('t2', 'box', 0, hcy - sp.hd[1] * 0.5 - 0.6, hcz + sp.hd[2] / 2 + 0.3, [0.24, 0.6, 0.24], sp.dk);
  }
  if (sp.tail) add('tl', 'box', 0, sp.leg + sp.bh * 0.7 + bob, -sp.bl / 2 - 0.2, [0.1, 0.55, 0.1], sp.dk || sp.col);
  if (sp.stripes) for (let i = 0; i < sp.stripes; i++) for (const sx of [-1, 1]) add(`s${i}${sx > 0 ? 'r' : 'l'}`, 'box', sx * (sp.bw / 2 + 0.01), bc, -sp.bl / 2 + (i + 0.5) * sp.bl / sp.stripes, [0.05, sp.bh * 0.9, 0.12], sp.dk);
  if (sp.spots) for (let i = 0; i < sp.spots; i++) add(`o${i}`, 'sph', (i % 2 ? 1 : -1) * (sp.bw / 2 + 0.02), sp.leg + sp.bh * (0.3 + ((i * 0.37) % 1) * 0.5) + bob, ((i * 0.618) % 1 - 0.5) * sp.bl * 0.8, [0.26, 0.26, 0.26], sp.dk);
  return out;
}

function jeepObjs(p, h) {
  const L = frameOf(p.x, p.y, p.z, h);
  const at = (id, k, lx, ly, lz, s, c, r) => ({ id, k, p: L(lx, ly, lz), s, c, r: r || [0, h, 0] });
  return [
    at('jpc', 'box', 0, 0.62, 0, [1.8, 0.42, 3.1], '#c0a25a'),
    at('jpk', 'box', 0, 1.1, -0.35, [1.7, 0.62, 1.7], '#e8dfc4'),
    at('jpw', 'box', 0, 1.2, 0.5, [1.5, 0.45, 0.08], '#9fdcf5'),
    at('jpb', 'box', 0, 0.5, -1.7, [1.9, 0.3, 0.25], '#4a4a4a'),
    at('jw0', 'cyl', -0.98, 0.42, -1.1, [0.85, 0.3, 0.85], '#222', [0, h, Math.PI / 2]),
    at('jw1', 'cyl', 0.98, 0.42, -1.1, [0.85, 0.3, 0.85], '#222', [0, h, Math.PI / 2]),
    at('jw2', 'cyl', -0.98, 0.42, 1.1, [0.85, 0.3, 0.85], '#222', [0, h, Math.PI / 2]),
    at('jw3', 'cyl', 0.98, 0.42, 1.1, [0.85, 0.3, 0.85], '#222', [0, h, Math.PI / 2]),
    at('jdh', 'sph', 0, 1.62, -0.45, [0.5, 0.5, 0.5], '#f2c29b'),
    at('jdb', 'box', 0, 1.2, -0.45, [0.5, 0.5, 0.4], '#2f8f4e'),
  ];
}

const turn = (cur, want, k) => {
  const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
  return cur + d * Math.min(1, k);
};

// Jeep: acelerador/freno con el joystick izquierdo (arriba = avanzar), giro con X.
function driveJeep(s, move, dt) {
  const p = s.p, thr = -(move.y || 0);
  const target = thr >= 0 ? thr * SF_MAX : thr * SF_REV;
  s.v += (target - s.v) * Math.min(1, dt * (Math.abs(target) > Math.abs(s.v) ? 2.2 : 3.5));
  if (Math.abs(s.v) > 0.5) s.jh -= (move.x || 0) * 1.8 * Math.sign(s.v) * Math.min(1, Math.abs(s.v) / 6) * dt;
  p.x += Math.sin(s.jh) * s.v * dt; p.z += Math.cos(s.jh) * s.v * dt;
  const lim = SF_SIZE / 2 - 4;
  p.x = cl(p.x, lim); p.z = cl(p.z, lim);
  for (const o of s.solids) {
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), m = o.rad + 1.0;
    if (d < m && d > 1e-3) { p.x = o.x + (dx / d) * m; p.z = o.z + (dz / d) * m; s.v *= 0.5; }
  }
  p.y = s.hm.h(p.x, p.z); p.face = s.jh;
}

// Animales: pastan y deambulan; huyen si el jeep se acerca rápido (o muy cerca).
function stepAnimals(s, dt) {
  const p = s.p, fast = Math.abs(s.v) > 3;
  for (const a of s.animals) {
    const sp = SF_SPECIES[a.k];
    const dj = Math.hypot(a.x - p.x, a.z - p.z);
    if (dj < 4 || (dj < 12 && fast)) a.fl = 2.5;
    let want = a.h, v = 0;
    if (a.fl > 0) {
      a.fl -= dt; want = Math.atan2(a.x - p.x, a.z - p.z); v = sp.fl;
    } else {
      a.tm -= dt;
      if (a.tm <= 0) {
        const ang = Math.random() * 6.283, d = 2 + Math.random() * 7;
        a.tx = cl(a.hx0 + Math.cos(ang) * d, s.half); a.tz = cl(a.hz0 + Math.sin(ang) * d, s.half);
        a.tm = 2.5 + Math.random() * 3; a.walk = Math.random() < 0.6;
      }
      if (a.walk && Math.hypot(a.tx - a.x, a.tz - a.z) > 0.6) { want = Math.atan2(a.tx - a.x, a.tz - a.z); v = sp.sp * 0.45; }
    }
    a.h = turn(a.h, want, dt * (a.fl > 0 ? 6 : 2.5));
    a.mv += (v - a.mv) * Math.min(1, dt * 4);
    a.x = cl(a.x + Math.sin(a.h) * a.mv * dt, s.half); a.z = cl(a.z + Math.cos(a.h) * a.mv * dt, s.half);
    a.y = s.hm.h(a.x, a.z); a.g += dt * a.mv * 4;
  }
}

const camOf = s => followCam(s.p, s.yaw, { hm: s.hm, dist: 9, height: 4.2, look: 2.5 });

// Animal centrado en el visor, a menos de SF_RANGE m. Devuelve el más centrado con su valor.
function aimOf(s, cam) {
  let best = null, bo = 1e9;
  for (const a of s.animals) {
    const sp = SF_SPECIES[a.k];
    const d = Math.hypot(a.x - s.p.x, a.z - s.p.z);
    if (d > SF_RANGE) continue;
    const q = project(cam, [a.x, a.y + sp.leg + sp.bh * 0.6, a.z], AREA_W, AREA_H);
    if (!q) continue;
    const ox = Math.abs(q.x - AREA_W / 2) / (AREA_W / 2), oy = Math.abs(q.y - AREA_H / 2) / (AREA_H / 2);
    if (ox > 0.5 || oy > 0.5) continue;
    const off = Math.hypot(ox, oy);
    if (off < bo) { bo = off; best = { a, sp, d, pts: Math.round(SF_BASE[sp.rar] * (d <= 7 ? 1.6 : d <= 12 ? 1.3 : 1)) }; }
  }
  return best;
}

export function Safari3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('safari');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = s => {
    if (s.done) return;
    s.done = true; s.final = s.pts;
    if (s.species >= 6) hx.win(); else hx.heavy();
    setRes({ isNew: submitBest(s.final) }); setPhase('over');
  };

  const shoot = () => {
    const s = g.current;
    if (s.film <= 0 || s.done) return;
    s.film -= 1;
    const hit = aimOf(s, camOf(s));
    if (!hit) {
      s.toast = { m: '📷 Ningún animal centrado', t: 1.1 };
      hx.warn(); fx.pop(AREA_W / 2, AREA_H / 2 - 40, 'VACÍA', C.dim, 16);
    } else {
      const first = !s.seen[hit.a.k];
      const bonus = first ? SF_NEW[hit.sp.rar] : 0;
      if (first) { s.seen[hit.a.k] = true; s.species += 1; }
      const got = hit.pts + bonus;
      s.pts += got; s.shots += 1;
      fx.flash('#ffffff', 0.35); fx.ring(AREA_W / 2, AREA_H / 2, C.lime, 60);
      if (first) hx.win(); else hx.good();
      fx.pop(AREA_W / 2, AREA_H / 2 - 40, `+${got}`, C.amber, 26);
      s.toast = { m: `📸 ${hit.sp.name}${first ? ' · NUEVA ESPECIE' : ''}`, t: 1.6 };
    }
    if (s.film <= 0) finish(s);
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt; s.time -= dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.time <= 0) { s.time = 0; finish(s); return; }
    driveJeep(s, move, dt);
    s.yaw -= look.x * 2.4 * dt;
    // sin girar la cámara, vuelve detrás del jeep mientras avanza
    if (Math.abs(look.x) < 0.08 && s.v > 2) s.yaw = turn(s.yaw, s.jh + Math.PI, dt * 1.2);
    stepAnimals(s, dt);
  });

  const s = g.current; const p = s.p;
  const cam = camOf(s);
  const aim = phase === 'play' ? aimOf(s, cam) : null;
  const objs = [
    ...terrainObjs(s.hm, p, 28, 4, sfColor),
    ...near(s.trees, p, 30).flatMap(t => [
      { id: `${t.id}t`, k: 'cyl', p: [t.x, t.y + t.h / 2, t.z], s: [0.42, t.h, 0.42], c: '#7a5532' },
      { id: `${t.id}c`, k: 'cyl', p: [t.x, t.y + t.h + 0.2, t.z], s: [t.w * 2, 0.5, t.w * 2], c: '#4d7d2c' },
      { id: `${t.id}d`, k: 'cyl', p: [t.x, t.y + t.h + 0.6, t.z], s: [t.w * 1.2, 0.4, t.w * 1.2], c: '#5d9a36' },
    ]),
    ...near(s.rocks, p, 30).map(o => ({ id: o.id, k: 'sph', p: [o.x, o.y + 0.3, o.z], s: [1.8, 1.0, 1.4], c: '#8c8074' })),
    ...near(s.animals, p, SF_DRAW).flatMap(a => animalObjs(a, SF_SPECIES[a.k])),
    ...jeepObjs(p, s.jh),
  ];
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const scene = { bg: SF_SKY, fog: { c: SF_SKY, near: 24, far: 46 }, shake, objs, cam };
  const sc = s.final != null ? s.final : s.pts;

  return (
    <GameScreen title="SAFARI FOTO" emoji="📷" accent={C.lime} onExit={onExit} score={sc} best={best}
      hud={<><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>📷 {s.film}/{SF_FILM}</Text><Text style={{ color: C.lime, fontWeight: '900', fontSize: 12 }}>🦁 {s.species}/{SF_SPECIES.length}</Text><Text style={{ color: s.time < 20 ? C.red : C.amber, fontWeight: '900', fontSize: 12 }}>⏱ {Math.ceil(s.time)}s</Text></>}>
      <PlayArea fx={fx} bg={SF_SKY}>
        <World3D scene={scene} />
        {phase === 'play' && (
          <View pointerEvents="none" style={{ position: 'absolute', left: AREA_W / 2 - 34, top: AREA_H / 2 - 34, width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: aim ? C.lime : 'rgba(255,255,255,0.55)' }} />
        )}
        {phase === 'play' && aim && (
          <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H / 2 + 44, width: AREA_W, textAlign: 'center', color: C.lime, fontSize: 13, fontWeight: '900', ...tglow('#000', 6) }}>
            {aim.sp.name} · {Math.round(aim.d)} m · +{aim.pts}{s.seen[aim.a.k] ? '' : ' (nueva)'}
          </Text>
        )}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.16, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 20, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
        {phase === 'play' && (
          <>
            <TouchStick testID="sf-move" v={move} R={44} style={{ position: 'absolute', left: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            <TouchStick testID="sf-look" v={look} R={44} style={{ position: 'absolute', right: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            <TouchBtn testID="sf-photo" onDown={shoot} style={{ position: 'absolute', left: AREA_W / 2 - 36, bottom: 22, width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: C.lime, backgroundColor: alpha(C.lime, 0.2), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>📷 FOTO</Text>
            </TouchBtn>
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? '📸' : '🦁'}
          title={phase === 'over' ? (s.species >= 6 ? '¡BUEN REPORTAJE!' : 'FIN DEL SAFARI') : 'SAFARI FOTO'}
          subtitle={phase === 'ready' ? 'Recorre la sabana en jeep y fotografía la fauna' : `📸 ${s.shots} fotos · ${s.species}/${SF_SPECIES.length} especies`}
          score={sc} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? [
            'Joystick izquierdo: conducir · derecho: girar la cámara',
            `Centra un animal en el visor y pulsa FOTO (máx. ${SF_RANGE} m)`,
            'Más cerca = más puntos · cada especie nueva da bonus',
            `${SF_FILM} fotos y ${SF_TIME} s. Si te acercas deprisa, huyen`,
          ] : null} />
      </PlayArea>
    </GameScreen>
  );
}
