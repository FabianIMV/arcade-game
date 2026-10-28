import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, TouchBtn, TouchStick, alpha, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { followCam, makeHeightmap, near, seeded, stepPlayer, terrainObjs } from '../utils/openworld';

// GRANJA LIBRE – granja abierta en tercera persona. Planta, riega y cosecha; vende en el mercado (dinero = puntos).
// Joystick izquierdo: caminar · derecho: girar la cámara · botón de acción contextual. Espanta a los cuervos.
const GF_DAY = 50, GF_DAYS = 3, GF_TOTAL = GF_DAY * GF_DAYS;   // 3 días de juego ≈ 150 s
const GF_GROW = 14;          // segundos regada hasta madurar (3 etapas visibles)
const GF_WATER = 6, GF_CARGO = 10, GF_YIELD = 2, GF_PRICE = 12, GF_CROWS = 3, GF_SCARE = 4.5;
const GF_SPACING = 5, GF_CIRCLE = 22, GF_CROW_H = 8;
const WELL = { x: 14, z: 4 }, MARKET = { x: 16, z: -10 }, HOUSE = { x: -17, z: -4 };
const GF_GRASS = '#6fb358';
const gfColor = y => (y < 0.1 ? '#5a9e46' : '#78bd5c');
const plotPos = i => ({ x: (i % 4 - 1.5) * GF_SPACING, z: (Math.floor(i / 4) - 1.5) * GF_SPACING });

// Cielo a lo largo del día (fase 0..1): amanecer → día → atardecer → noche → amanecer.
const SKY = [[0, '#f2a86a'], [0.12, '#9fd8f2'], [0.62, '#9fd8f2'], [0.74, '#f08a4a'], [0.86, '#1b2547'], [0.96, '#1b2547'], [1, '#f2a86a']];
const hexRGB = h => [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)].map(x => parseInt(x, 16));
const skyAt = ph => {
  for (let i = 1; i < SKY.length; i++) {
    if (ph <= SKY[i][0]) {
      const [t0, c0] = SKY[i - 1], [t1, c1] = SKY[i];
      const k = (ph - t0) / (t1 - t0 || 1), a = hexRGB(c0), b = hexRGB(c1);
      return '#' + a.map((v, j) => Math.round(v + (b[j] - v) * k).toString(16).padStart(2, '0')).join('');
    }
  }
  return SKY[SKY.length - 1][1];
};
const nightOf = ph => (ph >= 0.8 ? Math.min(1, (ph - 0.8) / 0.06) : Math.max(0, 1 - ph / 0.1));

const turn = (cur, want, k) => cur + Math.atan2(Math.sin(want - cur), Math.cos(want - cur)) * Math.min(1, k);

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const hm = makeHeightmap(seed, 90, { amp: 0.5 });
  const plots = Array.from({ length: 16 }, (_, i) => { const q = plotPos(i); return { ...q, y: hm.h(q.x, q.z), st: 0, gt: 0 }; });
  const trees = [];
  for (let i = 0; trees.length < 8 && i < 200; i++) {
    const a = r() * 6.283, d = 15 + r() * 14, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x - HOUSE.x, z - HOUSE.z) < 7 || Math.hypot(x - WELL.x, z - WELL.z) < 5 || Math.hypot(x - MARKET.x, z - MARKET.z) < 5) continue;
    trees.push({ id: `ap${trees.length}`, x, z, y: hm.h(x, z), rad: 0.8 });
  }
  const crows = Array.from({ length: GF_CROWS }, (_, i) => {
    const a = (i / GF_CROWS) * 6.283;
    return { id: `cw${i}`, a, x: Math.cos(a) * GF_CIRCLE, y: GF_CROW_H, z: Math.sin(a) * GF_CIRCLE, h: 0, wf: i, mode: 'circle', tm: 6 + i * 3, pl: -1 };
  });
  return {
    hm, plots, trees, crows,
    solids: [{ x: HOUSE.x, z: HOUSE.z, r: 4.2 }, { x: WELL.x, z: WELL.z, r: 1.2 }, { x: MARKET.x, z: MARKET.z, r: 2.4 }, ...trees],
    p: { x: 0, y: hm.h(0, 0), z: 0, vy: 0, face: 0 }, yaw: 0,
    el: 0, day: 1, water: GF_WATER, cargo: 0, money: 0, harvested: 0, eaten: 0,
    t: 0, toast: null, final: null, done: false,
  };
};

const plotAt = s => { for (const pl of s.plots) if (Math.abs(s.p.x - pl.x) < 2.6 && Math.abs(s.p.z - pl.z) < 2.6) return pl; return null; };
const dist2 = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);

// Acción contextual: lo que hace el botón según dónde estás.
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

// Cuervos: dan vueltas, bajan a un cultivo que crece y se lo comen si no los espantas acercándote.
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
    if (c.mode !== 'flee' && c.y < 5 && dp < GF_SCARE) { c.mode = 'flee'; c.tm = 2.5; c.pl = -1; hx.tick(); }
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

// Modelo de la planta según su estado: 0 vacía · 1 sembrada · 2 creciendo (3 etapas) · 3 madura
function plotObjs(pl, i, t) {
  const out = [{ id: `pl${i}s`, k: 'box', p: [pl.x, pl.y + 0.12, pl.z], s: [4, 0.3, 4], c: pl.st >= 2 ? '#4a3220' : '#6b4a2b' }];
  if (pl.st === 0) return out;
  const add = (sfx, k, lx, ly, lz, s, c, e, r) => out.push({ id: `pl${i}${sfx}`, k, p: [pl.x + lx, pl.y + ly, pl.z + lz], s, c, e: e || 0, r });
  if (pl.st === 1) { add('c', 'sph', 0, 0.3, 0, [0.9, 0.25, 0.9], '#8a6a48'); return out; }
  const f = pl.st === 2 ? pl.gt / GF_GROW : 1;
  if (f < 0.34) {
    // etapa 1: brotes
    [[-0.9, -0.6], [0.8, 0.2], [-0.2, 1.0]].forEach(([dx, dz], k) => add(`b${k}`, 'cone', dx, 0.35, dz, [0.35, 0.7, 0.35], '#5bbf3a'));
    return out;
  }
  // etapa 2: mata · etapa 3: mata con frutos (rojos si está madura)
  add('m', 'sph', 0, 0.6, 0, f < 0.67 ? [1.6, 1.1, 1.6] : [2.1, 1.6, 2.1], f < 0.67 ? '#3f8f34' : '#4fa33e');
  if (f >= 0.67) {
    const ripe = pl.st === 3, fc = ripe ? '#e0392b' : '#8fd05a';
    [[0.6, 0.6], [-0.6, 0.5], [0.5, -0.6], [-0.55, -0.6]].forEach(([dx, dz], k) => add(`f${k}`, 'sph', dx, 1.5, dz, [0.4, 0.4, 0.4], fc, ripe ? 0.25 : 0));
    if (ripe) out.push({ id: `pl${i}o`, k: 'tor', p: [pl.x, pl.y + 2.8 + Math.sin(t * 4) * 0.15, pl.z], n: 0.9, c: C.amber, e: 0.6, r: [Math.PI / 2, 0, t * 2] });
  }
  return out;
}

// Mismo marco que la malla (Ry(h)): L(lx, ly, lz) → mundo.
const frameOf = (x, y, z, h) => {
  const fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
  return (lx, ly, lz) => [x + rx * lx + fx * lz, y + ly, z + rz * lx + fz * lz];
};

function crowObjs(c) {
  const L = frameOf(c.x, c.y, c.z, c.h), R = [0, c.h, 0];
  const flap = c.mode === 'eat' ? 0.05 : Math.sin(c.wf) * 0.3;
  const add = (sfx, k, lx, ly, lz, s, col) => ({ id: c.id + sfx, k, p: L(lx, ly, lz), s, c: col, r: R });
  return [
    add('b', 'sph', 0, 0, 0, [0.55, 0.45, 0.85], '#1c1c26'),
    add('h', 'sph', 0, 0.12, 0.45, [0.36, 0.36, 0.36], '#1c1c26'),
    add('k', 'box', 0, 0.1, 0.66, [0.08, 0.1, 0.22], '#e0b040'),
    add('l', 'box', -0.45, 0.12 + flap, -0.05, [0.8, 0.05, 0.3], '#2a2a36'),
    add('r', 'box', 0.45, 0.12 + flap, -0.05, [0.8, 0.05, 0.3], '#2a2a36'),
    add('t', 'box', 0, 0.02, -0.5, [0.2, 0.06, 0.35], '#1c1c26'),
  ];
}

// Casa, pozo, mercado, manzanos y vallas (estáticos salvo las ventanas de noche).
function farmObjs(s, nf) {
  const { hm } = s; const out = [];
  const H = HOUSE, y0 = hm.h(H.x, H.z);
  out.push(
    { id: 'hcu', k: 'box', p: [H.x, y0 + 1.8, H.z], s: [6, 3.6, 5], c: '#e8c9a0' },
    { id: 'hte', k: 'cone', p: [H.x, y0 + 4.9, H.z], s: [6.8, 2.6, 6.8], c: '#b5483a' },
    { id: 'hpu', k: 'box', p: [H.x, y0 + 1.0, H.z + 2.55], s: [1.1, 2, 0.1], c: '#6b4a2b' },
    { id: 'hv1', k: 'box', p: [H.x - 1.8, y0 + 2.0, H.z + 2.55], s: [1.1, 1.1, 0.1], c: '#ffe9a0', e: 0.6 * nf },
    { id: 'hv2', k: 'box', p: [H.x + 1.8, y0 + 2.0, H.z + 2.55], s: [1.1, 1.1, 0.1], c: '#ffe9a0', e: 0.6 * nf },
  );
  const W = WELL, wy = hm.h(W.x, W.z);
  out.push(
    { id: 'wpi', k: 'cyl', p: [W.x, wy + 0.5, W.z], s: [1.6, 1.0, 1.6], c: '#9a9488' },
    { id: 'wag', k: 'cyl', p: [W.x, wy + 0.95, W.z], s: [1.3, 0.1, 1.3], c: '#3a8fd8' },
    { id: 'wp1', k: 'box', p: [W.x - 0.8, wy + 1.4, W.z], s: [0.2, 1.8, 0.2], c: '#8a4a2a' },
    { id: 'wp2', k: 'box', p: [W.x + 0.8, wy + 1.4, W.z], s: [0.2, 1.8, 0.2], c: '#8a4a2a' },
    { id: 'wte', k: 'box', p: [W.x, wy + 2.4, W.z], s: [2.2, 0.15, 1.8], c: '#b5483a' },
  );
  const M = MARKET, my = hm.h(M.x, M.z);
  out.push(
    { id: 'mmo', k: 'box', p: [M.x, my + 0.5, M.z], s: [4, 1, 1.8], c: '#c2864a' },
    { id: 'mte', k: 'box', p: [M.x, my + 2.7, M.z], s: [4.6, 0.2, 2.4], c: '#e04e4e' },
    { id: 'mp1', k: 'box', p: [M.x - 2.1, my + 1.6, M.z - 1.0], s: [0.15, 2.4, 0.15], c: '#8a4a2a' },
    { id: 'mp2', k: 'box', p: [M.x + 2.1, my + 1.6, M.z - 1.0], s: [0.15, 2.4, 0.15], c: '#8a4a2a' },
    { id: 'mt1', k: 'sph', p: [M.x - 0.8, my + 1.2, M.z], s: [0.4, 0.4, 0.4], c: '#e0392b' },
    { id: 'mt2', k: 'sph', p: [M.x, my + 1.2, M.z + 0.1], s: [0.4, 0.4, 0.4], c: '#e0392b' },
    { id: 'mt3', k: 'sph', p: [M.x + 0.8, my + 1.2, M.z], s: [0.4, 0.4, 0.4], c: '#e0392b' },
  );
  // vallas: cuatro lados del huerto
  const E = 11.5;
  out.push(
    { id: 'vn', k: 'box', p: [0, hm.h(0, -E) + 0.6, -E], s: [E * 2, 0.12, 0.12], c: '#9a6a3a' },
    { id: 'vs', k: 'box', p: [0, hm.h(0, E) + 0.6, E], s: [E * 2, 0.12, 0.12], c: '#9a6a3a' },
    { id: 've', k: 'box', p: [E, hm.h(E, 0) + 0.6, 0], s: [0.12, 0.12, E * 2], c: '#9a6a3a' },
    { id: 'vw', k: 'box', p: [-E, hm.h(-E, 0) + 0.6, 0], s: [0.12, 0.12, E * 2], c: '#9a6a3a' },
  );
  for (const t of near(s.trees, s.p, 30)) {
    out.push(
      { id: `${t.id}t`, k: 'cyl', p: [t.x, t.y + 1.1, t.z], s: [0.45, 2.2, 0.45], c: '#7a5532' },
      { id: `${t.id}c`, k: 'sph', p: [t.x, t.y + 3.2, t.z], s: [3.0, 2.6, 3.0], c: '#3f8f34' },
    );
  }
  return out;
}

// Estrellas fijas en el cielo; solo se ven de noche.
const STARS = Array.from({ length: 10 }, (_, i) => {
  const a = i * 0.63 + 0.3;
  return { id: `st${i}`, k: 'sph', p: [Math.cos(a) * 34, 9 + (i % 3) * 1.5, Math.sin(a) * 34], s: [0.6, 0.6, 0.6], c: '#fff6d0', e: 0.9 };
});

export function Granja3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('granja');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = s => {
    if (s.done) return;
    s.done = true; s.final = s.money;
    if (s.money >= 300) hx.win(); else hx.heavy();
    setRes({ isNew: submitBest(s.final) }); setPhase('over');
  };

  const act = () => {
    const s = g.current; const c = ctxOf(s);
    if (!c || !c.act || s.done) return;
    const cx = AREA_W / 2, cy = AREA_H * 0.55;
    const pl = plotAt(s);
    if (c.act === 'plant') {
      pl.st = 1; pl.gt = 0; hx.tap(); fx.burst(cx, cy, '#8a6a48', 8, 120, 0.4, 4);
      s.toast = { m: 'Semilla plantada · ¡riega!', t: 1.2 };
    } else if (c.act === 'water') {
      s.water -= 1; pl.st = 2; pl.gt = 0; hx.good(); fx.burst(cx, cy, C.cyan, 10, 140, 0.5, 4);
      s.toast = { m: `💧 Regada · crece en ${GF_GROW} s`, t: 1.4 };
    } else if (c.act === 'harvest') {
      const room = GF_CARGO - s.cargo;
      if (room < 1) { hx.warn(); s.toast = { m: 'Cesta llena: vende en el mercado', t: 1.6 }; return; }
      const got = Math.min(GF_YIELD, room);
      s.cargo += got; s.harvested += got; pl.st = 0; pl.gt = 0;
      hx.good(); fx.pop(cx, cy - 20, `+${got} 🍅`, C.lime, 20);
      fx.burst(cx, cy, C.red, 10, 150, 0.5, 5);
    } else if (c.act === 'fill') {
      s.water = GF_WATER; hx.tap(); s.toast = { m: '🪣 Cubo lleno', t: 1.0 };
    } else if (c.act === 'sell') {
      const earn = s.cargo * GF_PRICE; s.money += earn; s.cargo = 0;
      hx.win(); fx.pop(cx, cy - 40, `+${earn}`, C.amber, 28);
      s.toast = { m: `💰 Vendido: +${earn}`, t: 1.6 };
    }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt; s.el += dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.el >= GF_TOTAL) { s.el = GF_TOTAL; finish(s); return; }
    const day = Math.min(GF_DAYS, Math.floor(s.el / GF_DAY) + 1);
    if (day !== s.day) { s.day = day; s.toast = { m: `☀️ Día ${day} de ${GF_DAYS}`, t: 1.8 }; hx.tap(); }
    s.yaw -= look.x * 2.4 * dt;
    stepPlayer(s.p, move, dt, { yaw: s.yaw, hm: s.hm, speed: 6.5, bounds: 34 });
    for (const o of s.solids) {
      const dx = s.p.x - o.x, dz = s.p.z - o.z, d = Math.hypot(dx, dz), m = o.r + 0.5;
      if (d < m && d > 1e-3) { s.p.x = o.x + (dx / d) * m; s.p.z = o.z + (dz / d) * m; }
    }
    for (const pl of s.plots) if (pl.st === 2) { pl.gt += dt; if (pl.gt >= GF_GROW) { pl.gt = GF_GROW; pl.st = 3; hx.tick(); } }
    stepCrows(s, dt, fx);
  });

  const s = g.current; const p = s.p;
  const ph = ((s.el % GF_DAY) / GF_DAY + 0.1) % 1, nf = nightOf(ph), sky = skyAt(ph);   // el 0 = mañana clara
  const ctx = phase === 'play' ? ctxOf(s) : null;
  const objs = [
    { id: 'suelo', k: 'pla', p: [p.x, -0.35, p.z], s: [300, 300, 1], c: GF_GRASS },
    ...terrainObjs(s.hm, p, 24, 4, gfColor),
    ...s.plots.flatMap((pl, i) => plotObjs(pl, i, s.t)),
    ...farmObjs(s, nf),
    ...s.crows.filter(c => Math.hypot(c.x - p.x, c.z - p.z) < 45).flatMap(crowObjs),
    ...STARS.map(st => ({ ...st, o: nf })),
    // granjero
    { id: 'gcu', k: 'box', p: [p.x, p.y + 0.7, p.z], s: [0.7, 1.0, 0.45], r: [0, p.face, 0], c: '#d64545' },
    { id: 'gca', k: 'sph', p: [p.x, p.y + 1.45, p.z], n: 0.55, c: '#f2c29b' },
    { id: 'gso', k: 'cyl', p: [p.x, p.y + 1.8, p.z], s: [0.9, 0.12, 0.9], c: '#e8c15a' },
  ];
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const cam = followCam(p, s.yaw, { hm: s.hm, dist: 8, height: 4, look: 1.5 });
  const scene = { bg: sky, fog: { c: sky, near: 26, far: 60 }, shake, objs, cam };
  const sc = s.final != null ? s.final : s.money;
  const left = Math.max(0, Math.ceil(GF_TOTAL - s.el));

  return (
    <GameScreen title="GRANJA LIBRE" emoji="🚜" accent={C.orange} onExit={onExit} score={sc} best={best} scoreLabel="DINERO"
      hud={<><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>📅 {s.day}/{GF_DAYS}</Text><Text style={{ color: C.lime, fontWeight: '900', fontSize: 12 }}>🧺 {s.cargo}/{GF_CARGO} · 💧 {s.water}/{GF_WATER}</Text><Text style={{ color: left < 20 ? C.red : C.amber, fontWeight: '900', fontSize: 12 }}>⏱ {left}s</Text></>}>
      <PlayArea fx={fx} bg={sky}>
        <World3D scene={scene} />
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.16, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 18, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
        {phase === 'play' && (
          <>
            <TouchStick testID="gf-move" v={move} R={44} style={{ position: 'absolute', left: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            <TouchStick testID="gf-look" v={look} R={44} style={{ position: 'absolute', right: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            <TouchBtn testID="gf-act" onDown={act} style={{ position: 'absolute', left: AREA_W / 2 - 36, bottom: 22, width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: ctx && ctx.act ? C.orange : C.line, backgroundColor: alpha(C.orange, ctx && ctx.act ? 0.22 : 0.06), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 16 }}>{ctx ? ctx.e : ''}</Text>
              <Text style={{ color: ctx && ctx.act ? '#fff' : C.dim, fontWeight: '900', fontSize: 10 }}>{ctx ? ctx.t : ''}</Text>
            </TouchBtn>
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? '🚜' : '🌾'}
          title={phase === 'over' ? (s.money >= 300 ? '¡BUENA COSECHA!' : 'FIN DE LA TEMPORADA') : 'GRANJA LIBRE'}
          subtitle={phase === 'ready' ? 'Cultiva, vende y espanta a los cuervos' : `🍅 ${s.harvested} cosechados · 🐦 ${s.eaten} perdidos`}
          score={sc} best={best} isNew={res.isNew} accent={C.orange} scoreLabel="DINERO" onStart={start} onExit={onExit}
          lines={phase === 'ready' ? [
            'Joystick izquierdo: caminar · derecho: girar la cámara',
            'Sobre una parcela: PLANTAR → REGAR → COSECHAR',
            'Llena el cubo en el pozo y vende en el mercado',
            `Los cuervos bajan a comerse los cultivos: espántalos`,
            `${GF_DAYS} días de juego (~${GF_TOTAL} s)`,
          ] : null} />
      </PlayArea>
    </GameScreen>
  );
}
