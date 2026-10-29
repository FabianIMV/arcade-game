import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { C, SCREEN_H, SCREEN_W, alpha, clamp, hx, lerp, pick, rand, randInt, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { animal, car, coin, tree } from '../utils/prefabs';

// CROSSY ROAD 3D – estilo clásico: la rana avanza hacia el fondo cruzando calles, ríos (troncos) y vías (trenes).
// Cada fila es una banda horizontal; los coches y troncos cruzan de lado a lado.
// Toca para avanzar · desliza a los lados para moverte · arriba/abajo para avanzar/retroceder.
// La pantalla te empuja: si te quedas atrás, la línea roja te alcanza.
const CR_LW = 1.6, CR_COLS = 9, CR_LEN = 40, CR_VIS = 12, CR_HOP = 0.11;
const PI = Math.PI;
const CAR_COLORS = ['#ff4d6d', '#ffc233', '#22e6ff', '#7dff6b', '#9b6bff', '#ff8a3d'];
const cellX = c => (c - (CR_COLS - 1) / 2) * CR_LW;           // columna → lateral (x)
const colOf = x => clamp(Math.round(x / CR_LW + (CR_COLS - 1) / 2), 0, CR_COLS - 1);
const laneZ = i => -i * CR_LW;                                   // fila → profundidad (z): avanzar = ir hacia −Z
const wrap = (v, m) => ((v % m) + m) % m;

const genRow = (idx, prev) => {
  if (idx < 3) return { type: 'grass', trees: [], coin: -1 };
  const r = Math.random();
  let type = 'grass';
  if (prev && prev.type === 'grass') type = r < 0.5 ? 'road' : r < 0.74 ? 'river' : r < 0.84 ? 'rail' : 'grass';
  else if (prev && prev.type === 'river') type = r < 0.3 ? 'river' : 'grass';
  else if (prev && prev.type === 'road') type = r < 0.55 ? 'road' : 'grass';
  const diff = Math.min(1, idx / 120);
  if (type === 'grass') {
    const trees = [];
    const n = randInt(1, 3);
    for (let i = 0; i < n; i++) { const c = randInt(0, CR_COLS - 1); if (!trees.includes(c)) trees.push(c); }
    return { type, trees, coin: Math.random() < 0.22 ? randInt(0, CR_COLS - 1) : -1 };
  }
  const dir = prev && prev.type === type ? -prev.dir : (Math.random() < 0.5 ? 1 : -1);
  if (type === 'road') {
    const n = randInt(2, 3), sp = rand(2.2, 3.8) + diff * 3.4;
    const items = [];
    for (let i = 0; i < n; i++) {
      const truck = Math.random() < 0.3;
      items.push({ x0: -CR_LEN / 2 + i * (CR_LEN / n) + rand(0, CR_LEN / n * 0.35), w: truck ? 3.0 : 2.2, truck, kind: truck ? 'truck' : pick(['sedan', 'sport', 'suv']), color: pick(CAR_COLORS) });
    }
    return { type, dir, sp, items };
  }
  if (type === 'river') {
    const sp = rand(1.4, 2.7) + diff * 1.6;
    const items = [];
    for (let i = 0; i < 3; i++) items.push({ x0: -CR_LEN / 2 + i * (CR_LEN / 3) + rand(0, 1), w: CR_LW * randInt(2, 3) });
    return { type, dir, sp, items };
  }
  return { type: 'rail', dir, timer: rand(1, 4), period: rand(4, 6.5), train: null, warn: false };
};

// base de hierba bajo todo el tablero (sin huecos detrás de la rana ni en el arranque)
const STATIC_BASE = [{ id: 'base', k: 'pla', p: [0, -0.14, -20], s: [60, 90, 1], c: '#5cc453', recv: true }];

const initState = () => {
  const rows = []; let prev = null;
  for (let i = 0; i < CR_VIS + 6; i++) { const r = genRow(i, prev); rows.push(r); prev = r; }
  return {
    rows, px: cellX(4), row: 1, cam: 0, maxRow: 1, started: false, hop: 0, hopFrom: { x: 0, row: 1 }, t: 0, coins: 0,
    dead: null, scroll: 0.14, vx: cellX(4), vz: laneZ(1), face: 0, used: false,
  };
};

export function CrossyRoad3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('crossy');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, why: '' });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const score = s => (s.maxRow - 1) + s.coins * 5;

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const die = (s, why) => {
    if (s.dead) return;
    s.dead = why;
    const water = why === 'water';
    const fz = laneZ(s.row), fxp = s.px;
    burst3d([fxp, 0.4, fz], water ? ['#bfeaff', '#4fb8ff', '#ffffff'] : ['#ff4d6d', '#ffc233', '#ffffff'], 36, { speed: 5, up: 3.5, g: 10, size: 0.2, life: 0.9 });
    ring3d([fxp, 0.1, fz], water ? '#4fb8ff' : '#ff4d6d', 22, { speed: 6, life: 0.6 });
    fx.shake(9, 0.35); fx.flash(water ? C.blue : C.red, 0.3); hx.die();
    setRes({ isNew: submitBest(score(s)), why });
    setPhase('over');
  };
  // mueve a la rana: dl = filas (+1 = avanzar), dc = columnas (±1 lateral)
  const move = (dl, dc) => {
    const s = g.current;
    if (phase !== 'play' || s.dead) return;
    const nl = s.row + dl;
    if (nl < Math.floor(s.cam)) return;
    const cur = s.rows[s.row];
    const dest = s.rows[nl];
    if (!dest) return;
    let nx = s.px;
    if (dc) nx = clamp(s.px + dc * CR_LW, cellX(0), cellX(CR_COLS - 1));
    else if (cur.type !== 'river' || dest.type !== 'river') nx = cellX(colOf(s.px));
    if (dc && cur.type !== 'river') nx = cellX(colOf(nx));
    if (dest.type === 'grass' && dest.trees.includes(colOf(nx))) { hx.tick(); return; }
    s.hopFrom = { x: s.px, row: s.row }; s.hop = 1;
    s.face = dc ? (dc > 0 ? -PI / 2 : PI / 2) : 0;
    s.px = nx; s.row = nl;
    hx.tap();
    if (dest.type === 'grass' && dest.coin === colOf(nx)) { dest.coin = -1; s.coins += 1; fx.pop(SCREEN_W / 2, SCREEN_H * 0.5, '+5', C.amber, 16); hx.good(); burst3d([nx, 0.8, laneZ(nl)], '#ffc233', 14, { speed: 4, up: 2, g: 8, size: 0.15, life: 0.6 }); }
    if (nl > s.maxRow) { s.maxRow = nl; s.started = true; }
    while (s.rows.length < s.row + CR_VIS + 4) s.rows.push(genRow(s.rows.length, s.rows[s.rows.length - 1]));
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.dead) return;
    s.t += dt;
    if (s.hop > 0) s.hop = Math.max(0, s.hop - dt / CR_HOP);
    // cámara: la pantalla avanza sola (empuja) y sigue a la rana si se adelanta
    const target = s.row - 4;
    if (s.started) s.scroll = Math.min(0.7, 0.14 + s.t * 0.005);
    s.cam = Math.max(s.cam + (s.started ? s.scroll * dt : 0), s.cam + (target - s.cam) * Math.min(1, dt * 5) * (target > s.cam ? 1 : 0));
    if (s.row < Math.floor(s.cam)) { die(s, 'cámara'); return; }
    s.vx += (s.px - s.vx) * Math.min(1, dt * 8);
    s.vz += (laneZ(s.row) - s.vz) * Math.min(1, dt * 8);
    const cur = s.rows[s.row];
    // coches, troncos y trenes avanzan
    const lo = Math.max(0, Math.floor(s.cam) - 1), hi = Math.min(s.rows.length - 1, Math.ceil(s.cam) + CR_VIS);
    for (let i = lo; i <= hi; i++) {
      const r = s.rows[i];
      if (r.type === 'road' || r.type === 'river') r.items.forEach(it => {
        it.x0 += r.dir * r.sp * dt;
        if (r.dir > 0 && it.x0 > CR_LEN / 2) it.x0 -= CR_LEN;
        if (r.dir < 0 && it.x0 + it.w < -CR_LEN / 2) it.x0 += CR_LEN;
      });
      else if (r.type === 'rail') {
        r.timer += dt;
        r.warn = !r.train && r.timer > r.period - 1.4;
        if (!r.train && r.timer >= r.period) { r.train = { x0: r.dir > 0 ? -36 : 36, w: 16 }; hx.warn(); }
        if (r.train) {
          r.train.x0 += r.dir * 18 * dt;
          if (r.train.x0 > 24 || r.train.x0 + r.train.w < -24) { r.train = null; r.timer = 0; }
        }
      }
    }
    const hw = CR_LW * 0.3;
    if (cur.type === 'road') {
      for (const c of cur.items) if (s.px + hw > c.x0 && s.px - hw < c.x0 + c.w) { die(s, 'coche'); return; }
    } else if (cur.type === 'rail') {
      if (cur.train && s.px + hw > cur.train.x0 && s.px - hw < cur.train.x0 + cur.train.w) { die(s, 'tren'); return; }
    } else if (cur.type === 'river' && s.hop < 0.3) {
      const log = cur.items.find(l => s.px > l.x0 - 0.15 && s.px < l.x0 + l.w + 0.15);
      if (!log) { die(s, 'water'); return; }
      s.px += cur.dir * cur.sp * dt;
      if (s.px < cellX(0) - CR_LW / 2 || s.px > cellX(CR_COLS - 1) + CR_LW / 2) { die(s, 'water'); return; }
    }
  });

  const pan = usePan(fx, {
    down: () => { g.current.used = false; },
    move: (x, y, gs) => {
      const s = g.current;
      if (s.used) return;
      if (Math.abs(gs.dx) > 22 || Math.abs(gs.dy) > 22) {
        s.used = true;
        if (Math.abs(gs.dx) > Math.abs(gs.dy)) move(0, gs.dx > 0 ? 1 : -1);
        else move(gs.dy < 0 ? 1 : -1, 0);
      }
    },
    up: (x, y, gs) => { const s = g.current; if (!s.used && Math.abs(gs.dx) < 12 && Math.abs(gs.dy) < 12) move(1, 0); },
  });

  // ----- escena 3D -----
  const s = g.current;
  const lo = Math.max(0, Math.floor(s.cam) - 1), hi = Math.min(s.rows.length - 1, Math.ceil(s.cam) + CR_VIS);
  const onLog = s.rows[s.row] && s.rows[s.row].type === 'river';
  const frogX = lerp(s.px, s.hopFrom.x, s.hop);
  const frogZ = lerp(laneZ(s.row), laneZ(s.hopFrom.row), s.hop);
  const arc = s.hop > 0 ? Math.sin((1 - s.hop) * PI) * 0.5 : 0;
  const base = onLog ? 0.3 : 0.08;
  const objs = [];
  for (let i = lo; i <= hi; i++) {
    const r = s.rows[i], Z = laneZ(i), id = `l${i}`;
    if (r.type === 'grass') {
      objs.push({ id, k: 'box', p: [0, -0.05, Z], s: [CR_LEN, 0.1, CR_LW], c: i % 2 ? '#6cd45f' : '#62c955' });
      r.trees.forEach(c => objs.push(...tree(`${id}t${c}`, [cellX(c), 0, Z], { kind: (i + c) % 3 ? 'pine' : 'oak', h: 0.8, inst: 'arbol', sh: false })));
      if (r.coin >= 0) objs.push(...coin(`${id}m`, [cellX(r.coin), 0.55, Z], { t: s.t, c: '#ffc233' }));
    } else if (r.type === 'road') {
      objs.push({ id, k: 'box', p: [0, -0.05, Z], s: [CR_LEN, 0.1, CR_LW], c: '#3b3f57' });
      for (let k = 0; k < 8; k++) objs.push({ k: 'box', inst: 'marca', p: [-19 + k * 5.4, 0.01, Z], s: [2.6, 0.02, 0.12], c: '#e8eaf6', e: 0.3 });
      r.items.forEach((it, k) => objs.push(...car(`${id}c${k}`, [it.x0 + it.w / 2, 0, Z], {
        kind: it.kind, c: it.color, n: it.truck ? 0.6 : 0.5, yaw: r.dir > 0 ? -PI / 2 : PI / 2, spin: s.t * r.sp * 2 * r.dir, sh: false, inst: 'coche',
      })));
    } else if (r.type === 'river') {
      objs.push({ id, k: 'box', p: [0, -0.12, Z], s: [CR_LEN, 0.1, CR_LW], c: '#1e8fe0', e: 0.08 });
      for (let k = 0; k < 3; k++) objs.push({ k: 'box', inst: 'ola', p: [-19 + wrap(k * 13 + s.t * r.dir * r.sp * 0.6, 38), 0.02, Z], s: [1.4, 0.02, 0.12], c: '#bfeaff', e: 0.7 });
      r.items.forEach((it, k) => objs.push({ id: `${id}g${k}`, k: 'box', p: [it.x0 + it.w / 2, 0.12, Z], s: [it.w, 0.3, CR_LW * 0.8], c: '#9a6434', e: 0.05 }));
    } else {
      objs.push({ id, k: 'box', p: [0, -0.05, Z], s: [CR_LEN, 0.1, CR_LW], c: '#2a2633' });
      for (let k = 0; k < 14; k++) objs.push({ k: 'box', inst: 'traviesa', p: [-19 + k * 3, 0.02, Z], s: [0.3, 0.04, 1.2], c: '#6b4a2b' });
      objs.push({ id: `${id}r1`, k: 'box', p: [0, 0.03, Z - 0.4], s: [CR_LEN, 0.05, 0.08], c: '#9aa3b8', e: 0.3 });
      objs.push({ id: `${id}r2`, k: 'box', p: [0, 0.03, Z + 0.4], s: [CR_LEN, 0.05, 0.08], c: '#9aa3b8', e: 0.3 });
      if (r.train) objs.push({ id: `${id}tr`, k: 'box', p: [r.train.x0 + r.train.w / 2, 0.95, Z], s: [r.train.w, 1.7, CR_LW * 0.85], c: '#e0453a', e: 0.08 });
      if (r.warn) objs.push({ id: `${id}w`, k: 'sph', p: [r.dir > 0 ? -7 : 7, 1.9, Z], n: 0.5, c: '#ff3b3b', e: Math.floor(s.t * 8) % 2 ? 1 : 0.1 });
    }
  }
  // línea de la pantalla que empuja (zona de muerte)
  objs.push({ id: 'limite', k: 'box', p: [0, 0.09, laneZ(Math.floor(s.cam)) + CR_LW / 2], s: [CR_LEN, 0.12, 0.16], c: '#ff3b3b', e: 0.9 });
  if (!s.dead) {
    objs.push(...animal('rana', 'crab', [frogX, base + arc, frogZ], { yaw: s.face, t: s.t, walk: s.hop > 0 ? 1 : 0.15, c: '#7dff6b', n: 1.5 }));
  }
  const scene = {
    sky: { top: '#7ad7ff', bottom: '#d9f7ff', sun: true, clouds: 6 },
    fog: { c: '#d9f7ff', near: 22, far: 60 },
    light: { dir: [-0.4, 0.9, 0.5], sun: '#fff5d6', i: 2.4, sky: '#e0f4ff', ground: '#5a7a3a', hi: 1.8 },
    shadowR: 16,
    statics: STATIC_BASE,
    objs,
    cam: { p: [s.vx * 0.6, 14, s.vz + 12], l: [s.vx * 0.6, 0, s.vz - 2], fov: 70 },
  };
  const why = res.why;
  const overTitle = why === 'water' ? '¡AL AGUA!' : why === 'tren' ? '¡ARROLLADO POR UN TREN!' : why === 'cámara' ? '¡TE ALCANZARON!' : '¡ATROPELLADO!';

  return (
    <Game3D title="CROSSY ROAD" emoji="🐸" accent={C.lime} onExit={onExit} score={score(s)} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene} orbit={{ c: [0, 0.4, -3], r: 15, h: 9, speed: 0.12, ly: 0.8, drop: 2.6 }}
      hud={<><HudPill icon="🪙" value={s.coins} color={C.amber} /><HudPill icon="🐸" value={`${s.maxRow - 1} filas`} color={C.lime} /></>}
      subtitle="Cruza calles, ríos y vías en 3D"
      lines={['Toca para avanzar · desliza a los lados para moverte', 'Sube a los troncos para cruzar el río', 'Cuidado con los trenes (🚨) · la línea roja te empuja', '🪙 da +5 puntos']}
      result={{ isNew: res.isNew, title: overTitle, emoji: '🐸', subtitle: `Avanzaste ${s.maxRow - 1} filas`, stats: [['FILAS', s.maxRow - 1], ['MONEDAS', s.coins]] }}>
      {phase === 'play' && s.started && s.row - s.cam < 1.6 && <Text pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 36, textAlign: 'center', color: alpha(C.red, 0.95), fontSize: 12, fontWeight: '900', letterSpacing: 2 }}>¡LA PANTALLA TE EMPUJA!</Text>}
    </Game3D>
  );
}
