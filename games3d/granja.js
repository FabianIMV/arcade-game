import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { C, SCREEN_H, SCREEN_W, clamp, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { animal, bush, flower, hash01, house, mix, person, shade, tree } from '../utils/prefabs';
import { followCam, forward, makeHeightmap, seeded, stepPlayer } from '../utils/openworld';

// GRANJA LIBRE – granja abierta en 3D con día y noche. Planta, riega, cosecha y vende en el mercado (dinero = puntos).
// Joystick izquierdo: caminar · derecho: girar la cámara · botón de acción según lo que tengas delante.
// Los cuervos bajan a comerse los cultivos que crecen: acércate para espantarlos. 3 días de 50 s.
const GF_DAY = 50, GF_DAYS = 3, GF_TOTAL = GF_DAY * GF_DAYS;
const GF_GROW = 14, GF_WATER = 6, GF_CARGO = 10, GF_YIELD = 2, GF_PRICE = 12, GF_TARGET = 300;
const GF_CROWS = 3, GF_SCARE = 4.5, GF_CIRCLE = 22, GF_CROW_H = 8;
const GF_SPACING = 5, GF_FENCE = 11.5, GF_SIZE = 120, GF_FLAT = 12;
const WELL = { x: 14, z: 4 }, MARKET = { x: 16, z: -10 }, HOUSE = { x: -17, z: -4 }, BARN = { x: -25, z: 15 };
const HOMES = [{ x: 25, z: 20, kind: 'cow' }, { x: 29, z: 23, kind: 'cow' }, { x: -28, z: -14, kind: 'sheep' }, { x: -25, z: -17, kind: 'sheep' }];
const PETALS = ['#ff6fa8', '#ffd54a', '#ffffff', '#b57bff', '#ff8a3d'];

// Cielo a lo largo del día (fase 0..1): amanecer → día → atardecer → noche → amanecer.
const SKY_KEYS = [
  [0, '#5a6fc0', '#ffb08a'], [0.12, '#3a8fe8', '#bfe6ff'], [0.62, '#3a8fe8', '#bfe6ff'],
  [0.74, '#4a3f8a', '#ff9a5a'], [0.86, '#0b1030', '#1d2a5a'], [0.96, '#0b1030', '#1d2a5a'], [1, '#5a6fc0', '#ffb08a'],
];
const skyAt = ph => {
  for (let i = 1; i < SKY_KEYS.length; i++) {
    if (ph <= SKY_KEYS[i][0]) {
      const [t0, a0, b0] = SKY_KEYS[i - 1], [t1, a1, b1] = SKY_KEYS[i], k = (ph - t0) / (t1 - t0 || 1);
      return { top: mix(a0, a1, k), bot: mix(b0, b1, k) };
    }
  }
  const last = SKY_KEYS[SKY_KEYS.length - 1];
  return { top: last[1], bot: last[2] };
};
const dayPhase = el => ((el % GF_DAY) / GF_DAY + 0.1) % 1;   // el 0 = mañana clara
const nightOf = ph => (ph >= 0.8 ? Math.min(1, (ph - 0.8) / 0.06) : Math.max(0, 1 - ph / 0.1));
const turn = (cur, want, k) => cur + Math.atan2(Math.sin(want - cur), Math.cos(want - cur)) * Math.min(1, k);
const plotPos = i => ({ x: (i % 4 - 1.5) * GF_SPACING, z: (Math.floor(i / 4) - 1.5) * GF_SPACING });
const dist2 = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);

// Terreno: colinas suaves que se aplanan en el centro, donde están la granja y el huerto.
const makeFarmHeight = seed => {
  const base = makeHeightmap(seed, GF_SIZE, { amp: 3.5 });
  return { size: GF_SIZE, half: GF_SIZE / 2, h: (x, z) => (base.h(x, z) - 2.1) * clamp((Math.hypot(x, z) - GF_FLAT) / 12, 0, 1) };
};
const farmColor = (y, x, z) => shade(y < 0.05 ? '#5a9e46' : '#7cc05e', 0.9 + hash01(`${x.toFixed(0)},${z.toFixed(0)}`) * 0.2);

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const hm = makeFarmHeight(seed);
  const plots = Array.from({ length: 16 }, (_, i) => { const q = plotPos(i); return { ...q, y: hm.h(q.x, q.z), st: 0, gt: 0 }; });
  const solids = [{ x: HOUSE.x, z: HOUSE.z, r: 4.2 }, { x: WELL.x, z: WELL.z, r: 1.2 }, { x: MARKET.x, z: MARKET.z, r: 2.4 }, { x: BARN.x, z: BARN.z, r: 4 }];

  // decorado ESTÁTICO: se calcula una vez (scene.statics) y se dibuja con instancing
  const statics = [];
  const spots = [];
  const free = (x, z, m) => Math.hypot(x, z) > GF_FLAT + 4
    && [HOUSE, WELL, MARKET, BARN, ...HOMES].every(o => Math.hypot(x - o.x, z - o.z) > m)
    && spots.every(o => Math.hypot(x - o.x, z - o.z) > 4);
  const scatter = (n, m, make) => {
    let made = 0;
    for (let tries = 0; made < n && tries < 800; tries++) {
      const a = r() * 6.283, d = 13 + r() * 36, x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!free(x, z, m)) continue;
      spots.push({ x, z }); make(made, x, z, hm.h(x, z)); made++;
    }
  };
  scatter(15, 3, (i, x, z, y) => {
    statics.push(...tree(`ar${i}`, [x, y, z], { kind: r() < 0.55 ? 'oak' : 'pine', h: 1.1 + r() * 0.6, inst: 'arbol' }));
    solids.push({ x, z, r: 0.9 });
  });
  scatter(18, 2, (i, x, z, y) => statics.push(...bush(`bu${i}`, [x, y, z], { inst: 'arbusto', c: r() < 0.5 ? '#3f9b45' : '#2f8a4a' })));
  scatter(70, 1, (i, x, z, y) => statics.push(...flower(`fl${i}`, [x, y, z], { inst: 'flor', c: PETALS[i % PETALS.length] })));
  // vallas del huerto (postes + dos travesaños por lado)
  const E = GF_FENCE;
  for (let k = -E; k <= E + 0.01; k += 2.3) for (const [x, z] of [[k, -E], [k, E], [-E, k], [E, k]]) statics.push({ inst: 'poste', k: 'box', p: [x, hm.h(x, z) + 0.6, z], s: [0.16, 1.2, 0.16], c: '#9a6a3a' });
  for (const yy of [0.45, 0.9]) statics.push(
    { inst: 'riel', k: 'box', p: [0, yy, -E], s: [2 * E, 0.12, 0.12], c: '#b98352' }, { inst: 'riel', k: 'box', p: [0, yy, E], s: [2 * E, 0.12, 0.12], c: '#b98352' },
    { inst: 'riel', k: 'box', p: [-E, yy, 0], s: [0.12, 0.12, 2 * E], c: '#b98352' }, { inst: 'riel', k: 'box', p: [E, yy, 0], s: [0.12, 0.12, 2 * E], c: '#b98352' });
  statics.push(...house('granero', [BARN.x, hm.h(BARN.x, BARN.z), BARN.z], { kind: 'barn', c: '#b8372c' }));

  const crows = Array.from({ length: GF_CROWS }, (_, i) => {
    const a = (i / GF_CROWS) * 6.283;
    return { id: `cw${i}`, a, x: Math.cos(a) * GF_CIRCLE, y: GF_CROW_H, z: Math.sin(a) * GF_CIRCLE, h: 0, wf: i, mode: 'circle', tm: 6 + i * 3, pl: -1 };
  });
  const animals = HOMES.map((o, i) => ({ id: `an${i}`, kind: o.kind, hx: o.x, hz: o.z, x: o.x, z: o.z, yaw: r() * 6.28, tm: 1 + r() * 3, walk: 0, moving: false }));
  const p = { x: 0, y: hm.h(0, 0), z: 0, vy: 0, face: 0, ground: true };
  const cam0 = followCam(p, 0, { hm, dist: 8, height: 4, look: 1.5 });
  return {
    hm, plots, crows, animals, solids, statics,
    terrain: { id: `granja${seed}`, h: hm.h, size: GF_SIZE, step: 2.4, color: farmColor },
    p, yaw: 0, cp: cam0.p.slice(), cl: cam0.l.slice(),
    el: 0, day: 1, water: GF_WATER, cargo: 0, money: 0, harvested: 0, eaten: 0, walk: 0,
    t: 0, toast: null, final: null, done: false,
  };
};

// Planta junto al jugador (si la hay) y qué hace el botón de acción.
const plotAt = s => { for (const pl of s.plots) if (Math.abs(s.p.x - pl.x) < 2.6 && Math.abs(s.p.z - pl.z) < 2.6) return pl; return null; };
const ctxOf = s => {
  const pl = plotAt(s);
  if (pl) {
    if (pl.st === 0) return { t: 'PLANTAR', e: '🌱', act: 'plant' };
    if (pl.st === 1) return s.water > 0 ? { t: 'REGAR', e: '💧', act: 'water' } : { t: 'SIN AGUA', e: '🚫', act: null };
    if (pl.st === 2) return { t: 'CRECE', e: '⏳', act: null };
    return { t: 'COSECHAR', e: '🍅', act: 'harvest' };
  }
  if (dist2(s.p, WELL) < 3.5) return s.water < GF_WATER ? { t: 'LLENAR', e: '🪣', act: 'fill' } : { t: 'LLENO', e: '💧', act: null };
  if (dist2(s.p, MARKET) < 4 && s.cargo > 0) return { t: 'VENDER', e: '💰', act: 'sell' };
  return { t: 'ACCIÓN', e: '✋', act: null };
};

// Cuervos: dan vueltas, bajan a un cultivo que crece y se lo comen si no los espantas.
const flyTo = (c, tx, ty, tz, sp, dt) => {
  const dx = tx - c.x, dy = ty - c.y, dz = tz - c.z, d = Math.hypot(dx, dy, dz);
  if (d > 1e-4) {
    const k = Math.min(1, (sp * dt) / d);
    c.x += dx * k; c.y += dy * k; c.z += dz * k;
    c.h = turn(c.h, Math.atan2(dx, dz), dt * 3);
  }
  return d;
};

function stepCrows(s, dt, fx) {
  const p = s.p;
  for (const c of s.crows) {
    c.wf += dt * 16;
    const dp = Math.hypot(c.x - p.x, c.z - p.z);
    if (c.mode !== 'flee' && c.y < 5 && dp < GF_SCARE) {
      c.mode = 'flee'; c.tm = 2.5; c.pl = -1; hx.tick();
      ring3d([c.x, c.y, c.z], '#ffffff', 12, { speed: 5, life: 0.5 });
    }
    if (c.mode === 'circle') {
      c.a += dt * 0.3;
      flyTo(c, Math.cos(c.a) * GF_CIRCLE, GF_CROW_H, Math.sin(c.a) * GF_CIRCLE, 10, dt);
      c.tm -= dt;
      if (c.tm <= 0) {
        c.tm = 1;
        const free = s.plots.map((_, i) => i).filter(i => (s.plots[i].st === 2 || s.plots[i].st === 3) && !s.crows.some(o => o.pl === i));
        if (free.length) { c.pl = free[Math.floor(Math.random() * free.length)]; c.mode = 'dive'; }
      }
    } else if (c.mode === 'dive') {
      const pl = s.plots[c.pl];
      if (!pl || (pl.st !== 2 && pl.st !== 3)) { c.mode = 'circle'; c.pl = -1; continue; }
      if (flyTo(c, pl.x, pl.y + 1.0, pl.z, 9, dt) < 1.0) { c.mode = 'eat'; c.tm = 2.2; }
    } else if (c.mode === 'eat') {
      const pl = s.plots[c.pl];
      c.tm -= dt;
      if (c.tm <= 0) {
        if (pl && (pl.st === 2 || pl.st === 3)) {
          pl.st = 0; pl.gt = 0; s.eaten += 1;
          burst3d([pl.x, pl.y + 1, pl.z], ['#1c1c26', '#3a3a48'], 16, { speed: 3, up: 2, g: 3, size: 0.14, life: 0.9 });
          s.toast = { m: '🐦 ¡Un cuervo se comió la cosecha!', t: 1.8 };
          hx.bad(); fx.shake(5, 0.3); fx.flash(C.red, 0.2);
        }
        c.mode = 'flee'; c.tm = 2.5; c.pl = -1;
      }
    } else {   // huye: se aleja del jugador y sube
      const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz) || 1;
      flyTo(c, c.x + (dx / d) * 14, GF_CROW_H + 4, c.z + (dz / d) * 14, 14, dt);
      c.tm -= dt;
      if (c.tm <= 0) { c.mode = 'circle'; c.tm = 1; }
    }
  }
}

// Animales de la granja: pasean cerca de su corral.
function stepAnimals(s, dt) {
  for (const a of s.animals) {
    a.tm -= dt;
    if (a.tm <= 0) { a.tm = 1.5 + Math.random() * 2.5; a.moving = Math.random() < 0.6; a.yaw += (Math.random() - 0.5) * 2.5; }
    if (Math.hypot(a.x - a.hx, a.z - a.hz) > 4) a.yaw = Math.atan2(-(a.hx - a.x), -(a.hz - a.z));   // vuelve al corral
    const sp = a.moving ? 0.9 : 0, [fx0, fz0] = forward(a.yaw);
    a.x += fx0 * sp * dt; a.z += fz0 * sp * dt;
    a.walk += ((a.moving ? 1 : 0) - a.walk) * Math.min(1, dt * 4);
  }
}

// Plantas según su estado: 0 vacía · 1 sembrada · 2 creciendo (3 etapas) · 3 madura. Todo por instancing.
function plotObjs(pl, t, out) {
  out.push({ inst: 'tierra', k: 'box', p: [pl.x, pl.y + 0.12, pl.z], s: [4, 0.3, 4], c: pl.st >= 2 ? '#4a3220' : '#6b4a2b', recv: true });
  const add = (name, k, lx, ly, lz, s, c, extra) => out.push({ inst: name, k, p: [pl.x + lx, pl.y + ly, pl.z + lz], s, c, ...extra });
  if (pl.st === 0) return;
  if (pl.st === 1) { add('semilla', 'sph', 0, 0.3, 0, [0.9, 0.25, 0.9], '#8a6a48'); return; }
  const f = pl.st === 2 ? pl.gt / GF_GROW : 1;
  if (f < 0.34) { [[-0.9, -0.6], [0.8, 0.2], [-0.2, 1.0]].forEach(([dx, dz]) => add('brote', 'cone', dx, 0.35, dz, [0.35, 0.7, 0.35], '#5bbf3a')); return; }
  add('mata', 'sph', 0, 0.6, 0, f < 0.67 ? [1.6, 1.1, 1.6] : [2.1, 1.6, 2.1], f < 0.67 ? '#3f8f34' : '#4fa33e');
  if (f >= 0.67) {
    const ripe = pl.st === 3;
    [[0.6, 0.6], [-0.6, 0.5], [0.5, -0.6], [-0.55, -0.6]].forEach(([dx, dz]) => add('fruto', 'sph', dx, 1.5, dz, [0.4, 0.4, 0.4], ripe ? '#e0392b' : '#8fd05a', ripe ? { e: 0.25 } : null));
    if (ripe) out.push({ inst: 'aro', k: 'tor', p: [pl.x, pl.y + 2.8 + Math.sin(t * 4) * 0.15, pl.z], n: 0.9, r: [Math.PI / 2, 0, t * 2], c: C.amber, e: 0.6 });
  }
}

// Mismo marco que la malla (Ry(h)): L(lx, ly, lz) → mundo.
const frameOf = (x, y, z, h) => {
  const fx0 = Math.sin(h), fz0 = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
  return (lx, ly, lz) => [x + rx * lx + fx0 * lz, y + ly, z + rz * lx + fz0 * lz];
};
function crowObjs(c) {
  const L = frameOf(c.x, c.y, c.z, c.h), R = [0, c.h, 0];
  const flap = c.mode === 'eat' ? 0.05 : Math.sin(c.wf) * 0.3;
  const add = (sfx, k, lx, ly, lz, s, col) => ({ id: c.id + sfx, k, p: L(lx, ly, lz), s, c: col, r: R });
  return [
    add('b', 'sph', 0, 0, 0, [0.55, 0.45, 0.85], '#1c1c26'),
    add('h', 'sph', 0, 0.12, 0.45, [0.36, 0.36, 0.36], '#1c1c26'),
    add('k', 'cone', 0, 0.1, 0.7, [0.1, 0.22, 0.1], '#e0b040'),
    add('l', 'box', -0.45, 0.12 + flap, -0.05, [0.8, 0.05, 0.3], '#2a2a36'),
    add('r', 'box', 0.45, 0.12 + flap, -0.05, [0.8, 0.05, 0.3], '#2a2a36'),
    add('t', 'box', 0, 0.02, -0.5, [0.2, 0.06, 0.35], '#1c1c26'),
  ];
}

// Casa, granero, mercado, pozo y el cielo/luz según la hora. Solo se construye el lote dinámico.
const STARS = Array.from({ length: 12 }, (_, i) => ({ id: `st${i}`, k: 'sph', n: 0.5, c: '#fff6d0', e: 0.9, ang: i * 0.55 + 0.4, hgt: 28 + (i % 3) * 5 }));
function buildScene(s, t) {
  const p = s.p, ph = dayPhase(s.el), nf = nightOf(ph), sk = skyAt(ph);
  const hy = s.hm.h(HOUSE.x, HOUSE.z), wy = s.hm.h(WELL.x, WELL.z), my = s.hm.h(MARKET.x, MARKET.z);
  const objs = [];
  s.plots.forEach(pl => plotObjs(pl, t, objs));
  for (const c of s.crows) if (Math.hypot(c.x - p.x, c.z - p.z) < 60) objs.push(...crowObjs(c));
  for (const a of s.animals) objs.push(...animal(a.id, a.kind, [a.x, s.hm.h(a.x, a.z), a.z], { yaw: a.yaw, t, walk: a.walk }));
  objs.push(...house('casa', [HOUSE.x, hy, HOUSE.z], { kind: 'cottage', c: '#efd9b4', roof: '#b5483a', lit: nf > 0.4 }));
  // pozo y mercado
  objs.push(
    { id: 'pozo', k: 'cyl', p: [WELL.x, wy + 0.5, WELL.z], s: [1.6, 1.0, 1.6], c: '#9a9488' },
    { id: 'agua', k: 'cyl', p: [WELL.x, wy + 0.95, WELL.z], s: [1.3, 0.1, 1.3], c: '#3a8fd8', e: 0.3 },
    { id: 'pozoT', k: 'box', p: [WELL.x, wy + 2.4, WELL.z], s: [2.2, 0.15, 1.8], c: '#b5483a' },
    { id: 'merc', k: 'box', p: [MARKET.x, my + 0.5, MARKET.z], s: [4, 1, 1.8], c: '#c2864a' },
    { id: 'mtec', k: 'box', p: [MARKET.x, my + 2.7, MARKET.z], s: [4.6, 0.2, 2.4], c: '#e04e4e' },
    { id: 'mtom', k: 'sph', p: [MARKET.x, my + 1.2, MARKET.z], n: 0.4, c: '#e0392b' },
  );
  // granjero (persona 1.75 m, sombrero de paja)
  objs.push(...person('yo', [p.x, p.y, p.z], { yaw: p.face, t, walk: s.walk, hat: 'straw', shirt: '#d64545', pants: '#33415c' }));
  if (nf > 0.4) for (const st of STARS) objs.push({ id: st.id, k: st.k, p: [p.x + Math.cos(st.ang) * 70, st.hgt, p.z + Math.sin(st.ang) * 70], n: st.n, c: st.c, e: st.e });
  return {
    sky: { top: sk.top, bottom: sk.bot, sun: nf < 0.4, clouds: nf > 0.5 ? 0 : 7 },
    fog: { c: sk.bot, near: 34, far: 92 },
    light: { dir: [-0.5, 0.75, 0.45], sun: mix('#fff4dc', '#8fa6ff', nf), i: 2.4 - 1.6 * nf, sky: mix('#dfeaff', '#44507e', nf), ground: '#5b5648', hi: 1.8 - 0.9 * nf },
    lights: nf > 0.2 ? [{ p: [HOUSE.x, hy + 2.6, HOUSE.z + 3.4], c: '#ffd27a', i: 9 * nf, d: 10 }, { p: [MARKET.x, my + 3, MARKET.z], c: '#ff9d5c', i: 6 * nf, d: 9 }] : [],
    shadowR: 26,
    terrain: s.terrain,
    statics: s.statics,
    objs,
    cam: { p: s.cp, l: s.cl, fov: 62 },
  };
}

export function Granja3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('granja');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); move.x = move.y = look.x = look.y = 0; setPhase('play'); hx.tap(); };
  const finish = s => {
    if (s.done) return;
    s.done = true; s.final = s.money; move.x = move.y = 0;
    const won = s.money >= GF_TARGET;
    if (won) hx.win(); else hx.heavy();
    setRes({ isNew: submitBest(s.final), won }); setPhase('over');
  };

  const act = () => {
    const s = g.current; if (s.done) return;
    const c = ctxOf(s); if (!c || !c.act) return;
    const pl = plotAt(s), at = pl ? [pl.x, pl.y + 0.8, pl.z] : [s.p.x, s.p.y + 1, s.p.z];
    if (c.act === 'plant') {
      pl.st = 1; pl.gt = 0; hx.tap();
      burst3d(at, ['#8a6a48', '#5a4030'], 12, { speed: 2.2, up: 2, g: 9, size: 0.12, life: 0.6 });
      s.toast = { m: 'Semilla plantada · ¡riega!', t: 1.2 };
    } else if (c.act === 'water') {
      s.water -= 1; pl.st = 2; pl.gt = 0; hx.good();
      burst3d(at, ['#3ab0ff', '#bfefff'], 26, { speed: 3.5, up: 2.5, g: 10, size: 0.12, life: 0.7 });
      s.toast = { m: `💧 Regada · crece en ${GF_GROW} s`, t: 1.4 };
    } else if (c.act === 'harvest') {
      const room = GF_CARGO - s.cargo;
      if (room < 1) { hx.warn(); s.toast = { m: 'Cesta llena: vende en el mercado', t: 1.6 }; return; }
      const got = Math.min(GF_YIELD, room);
      s.cargo += got; s.harvested += got; pl.st = 0; pl.gt = 0; hx.good();
      burst3d(at, ['#e0392b', '#ff6b4a', '#8fd05a'], 26, { speed: 4, up: 3, g: 10, size: 0.16, life: 0.8 });
      fx.pop(SCREEN_W / 2, SCREEN_H * 0.42, `+${got} 🍅`, C.lime, 22);
    } else if (c.act === 'fill') {
      s.water = GF_WATER; hx.tap(); s.toast = { m: '🪣 Cubo lleno', t: 1.0 };
    } else if (c.act === 'sell') {
      const earn = s.cargo * GF_PRICE, mp = [MARKET.x, s.hm.h(MARKET.x, MARKET.z) + 1.5, MARKET.z];
      s.money += earn; s.cargo = 0; hx.win();
      ring3d(mp, C.amber, 22, { speed: 6, life: 0.7 });
      burst3d(mp, [C.amber, '#fff3b0'], 36, { speed: 6.5, up: 5, g: 12, size: 0.2, life: 1.0 });
      fx.pop(SCREEN_W / 2, SCREEN_H * 0.42, `+${earn}`, C.amber, 28);
      s.toast = { m: `💰 Vendido: +${earn}`, t: 1.6 };
    }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt; s.el += dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.el >= GF_TOTAL) { s.el = GF_TOTAL; finish(s); return; }
    const day = Math.min(GF_DAYS, Math.floor(s.el / GF_DAY) + 1);
    if (day !== s.day) { s.day = day; s.toast = { m: `☀️ Día ${day} de ${GF_DAYS}`, t: 1.8 }; hx.tap(); }

    // movimiento: el joystick va relativo a la cámara; la cámara gira con el stick derecho
    s.yaw -= look.x * 2.4 * dt;
    const moved = stepPlayer(s.p, move, dt, { yaw: s.yaw, hm: s.hm, speed: 6.5, bounds: 34 });
    for (const o of s.solids) {
      const dx = s.p.x - o.x, dz = s.p.z - o.z, d = Math.hypot(dx, dz), m = o.r + 0.5;
      if (d < m && d > 1e-3) { s.p.x = o.x + (dx / d) * m; s.p.z = o.z + (dz / d) * m; }
    }
    s.walk += ((moved / Math.max(dt, 1e-3) > 0.5 ? 1 : 0) - s.walk) * Math.min(1, dt * 10);

    for (const pl of s.plots) if (pl.st === 2) {
      pl.gt += dt;
      if (pl.gt >= GF_GROW) { pl.gt = GF_GROW; pl.st = 3; hx.tick(); ring3d([pl.x, pl.y + 2.8, pl.z], C.amber, 14, { speed: 3, life: 0.6 }); }
    }
    stepCrows(s, dt, fx);
    stepAnimals(s, dt);

    // cámara suave: se acerca a su objetivo con un retardo corto (no salta al girar)
    const cam = followCam(s.p, s.yaw, { hm: s.hm, dist: 8, height: 4, look: 1.5 }), k = 1 - Math.exp(-dt * 9);
    for (let i = 0; i < 3; i++) { s.cp[i] += (cam.p[i] - s.cp[i]) * k; s.cl[i] += (cam.l[i] - s.cl[i]) * k; }
  });

  const s = g.current;
  const ctx = ctxOf(s);
  const left = Math.max(0, Math.ceil(GF_TOTAL - s.el));
  const sc = s.final != null ? s.final : s.money;
  const scene = buildScene(s, s.t);
  return (
    <Game3D title="GRANJA LIBRE" emoji="🚜" accent={C.lime} onExit={onExit} score={sc} best={best} scoreLabel="DINERO" fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(s, t)} orbit={{ r: 13, h: 4.6, speed: 0.16, ly: 1.2 }}
      hud={<><HudPill icon="📅" value={`${s.day}/${GF_DAYS}`} color={C.lime} /><HudPill icon="🧺" value={`${s.cargo}/${GF_CARGO}`} color={C.amber} /><HudPill icon="💧" value={`${s.water}/${GF_WATER}`} color={C.cyan} /><HudPill icon="⏱" value={`${left}s`} color={left < 20 ? C.red : C.lime} /></>}
      subtitle="Cultiva, vende y espanta a los cuervos"
      lines={['Joystick izquierdo: caminar · derecho: girar la cámara', 'En una parcela: PLANTAR → REGAR → COSECHAR', 'Llena el cubo en el pozo y vende en el mercado', 'Los cuervos comen los cultivos: espántalos acercándote', `${GF_DAYS} días de juego (~${GF_TOTAL} s)`]}
      result={{ won: res.won, isNew: res.isNew, title: res.won ? '¡BUENA COSECHA!' : 'FIN DE LA TEMPORADA', emoji: res.won ? '🏆' : '🚜', subtitle: `🍅 ${s.harvested} cosechados · 🐦 ${s.eaten} perdidos`, stats: [['COSECHA', s.harvested], ['PERDIDOS', s.eaten], ['DÍAS', GF_DAYS]] }}>
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '22%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 20, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      <Stick3D testID="gf-move" v={move} side="left" color={C.lime} />
      <Stick3D testID="gf-look" v={look} side="right" color={C.amber} />
      <ActionBtn testID="gf-act" label={ctx.t} icon={ctx.e} color={ctx.act ? C.orange : '#5b6080'} onDown={act} style={{ left: '50%', marginLeft: -33, bottom: 34 }} />
    </Game3D>
  );
}
