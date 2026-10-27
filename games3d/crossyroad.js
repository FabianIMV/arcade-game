import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, alpha, clamp, hx, lerp, pick, rand, randInt, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Tercera persona: la rana cruza calles, ríos y vías en un mundo 3D. Las calles van en profundidad
// (los coches avanzan hacia la cámara) y la rana avanza de un carril a otro hacia la derecha.
// Toca para avanzar · desliza a la derecha/izquierda para avanzar/retroceder · arriba/abajo para moverte en profundidad.
const CR_LW = 1.6, CR_COLS = 9, CR_LEN = 40, CR_VIS = 12, CR_HOP = 0.11;
const CR_CAM_BACK = 8.6, CR_CAM_UP = 6.4;
const CAR_COLORS = ['#ff4d6d', '#ffc233', '#22e6ff', '#7dff6b', '#9b6bff', '#ff8a3d'];
const cellZ = c => (c - (CR_COLS - 1) / 2) * CR_LW;          // columna → profundidad (z)
const colOf = z => clamp(Math.round(z / CR_LW + (CR_COLS - 1) / 2), 0, CR_COLS - 1);
const laneX = i => i * CR_LW;                                  // carril → lateral (x)

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
      items.push({ z0: -CR_LEN / 2 + i * (CR_LEN / n) + rand(0, CR_LEN / n * 0.35), w: CR_LW * (truck ? 1.9 : 1.0), truck, color: pick(CAR_COLORS) });
    }
    return { type, dir, sp, items };
  }
  if (type === 'river') {
    const sp = rand(1.4, 2.7) + diff * 1.6;
    const items = [];
    for (let i = 0; i < 3; i++) items.push({ z0: -CR_LEN / 2 + i * (CR_LEN / 3) + rand(0, 1), w: CR_LW * randInt(2, 3) });
    return { type, dir, sp, items };
  }
  return { type: 'rail', dir, timer: rand(1, 4), period: rand(4, 6.5), train: null, warn: false };
};

const initState = () => {
  const rows = []; let prev = null;
  for (let i = 0; i < CR_VIS + 6; i++) { const r = genRow(i, prev); rows.push(r); prev = r; }
  return {
    rows, pz: cellZ(4), row: 1, cam: 0, maxRow: 1, started: false, hop: 0, hopFrom: { z: 0, row: 1 }, t: 0, score: 0, coins: 0,
    dead: null, scroll: 0.14, vx: laneX(1), vz: 0, used: false, sx: 0, sy: 0,
  };
};

export function CrossyRoad3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('crossy');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, why: '' });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const die = (s, why) => {
    if (s.dead) return;
    s.dead = why;
    fx.burst(AREA_W / 2, AREA_H * 0.6, why === 'water' ? C.cyan : C.red, 24, 260, 0.8, 5); fx.shake(9, 0.35); fx.flash(why === 'water' ? C.blue : C.red, 0.3); hx.die();
    setRes({ isNew: submitBest(s.score), why });
    setPhase('over');
  };
  // mueve a la rana: dl = carriles (+1 = avanzar), dc = profundidad (±1 columna)
  const move = (dl, dc) => {
    const s = g.current;
    if (phase !== 'play' || s.dead) return;
    const nl = s.row + dl;
    if (nl < Math.floor(s.cam)) return;
    const cur = s.rows[s.row];
    let nz = s.pz;
    if (dc) nz = clamp(s.pz + dc * CR_LW, cellZ(0), cellZ(CR_COLS - 1));
    else if (cur.type !== 'river' || s.rows[nl].type !== 'river') nz = cellZ(colOf(s.pz));
    if (dc && cur.type !== 'river') nz = cellZ(colOf(nz));
    const dest = s.rows[nl];
    if (!dest) return;
    if (dest.type === 'grass' && dest.trees.includes(colOf(nz))) { hx.tick(); return; }
    s.hopFrom = { z: s.pz, row: s.row }; s.hop = 1;
    s.pz = nz; s.row = nl;
    hx.tap();
    if (nl > s.maxRow) { s.maxRow = nl; s.score = (s.maxRow - 1) + s.coins * 5; s.started = true; }
    while (s.rows.length < s.row + CR_VIS + 4) s.rows.push(genRow(s.rows.length, s.rows[s.rows.length - 1]));
    if (dest.type === 'grass' && dest.coin === colOf(nz)) { dest.coin = -1; s.coins += 1; s.score = (s.maxRow - 1) + s.coins * 5; fx.pop(AREA_W / 2, AREA_H * 0.5, '+5', C.amber, 16); hx.good(); }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.dead) return;
    s.t += dt;
    if (s.hop > 0) s.hop = Math.max(0, s.hop - dt / CR_HOP);
    // cámara: sigue a la rana y el avance automático la empuja hacia delante
    const target = s.row - 4;
    if (s.started) s.scroll = Math.min(0.7, 0.14 + s.t * 0.005);
    s.cam = Math.max(s.cam + (s.started ? s.scroll * dt : 0), s.cam + (target - s.cam) * Math.min(1, dt * 5) * (target > s.cam ? 1 : 0));
    if (s.row < Math.floor(s.cam)) { die(s, 'cámara'); return; }
    s.vx += (laneX(s.row) - s.vx) * Math.min(1, dt * 8);
    s.vz += (s.pz - s.vz) * Math.min(1, dt * 8);
    const cur = s.rows[s.row];
    // carriles visibles: coches, troncos y trenes avanzan
    const lo = Math.max(0, Math.floor(s.cam) - 1), hi = Math.min(s.rows.length - 1, Math.ceil(s.cam) + CR_VIS);
    for (let i = lo; i <= hi; i++) {
      const r = s.rows[i];
      if (r.type === 'road' || r.type === 'river') r.items.forEach(it => {
        it.z0 += r.dir * r.sp * dt;
        if (r.dir > 0 && it.z0 > CR_LEN / 2) it.z0 -= CR_LEN;
        if (r.dir < 0 && it.z0 + it.w < -CR_LEN / 2) it.z0 += CR_LEN;
      });
      else if (r.type === 'rail') {
        r.timer += dt;
        r.warn = !r.train && r.timer > r.period - 1.4;
        if (!r.train && r.timer >= r.period) { r.train = { z0: r.dir > 0 ? -36 : 36, w: 16 }; hx.warn(); }
        if (r.train) {
          r.train.z0 += r.dir * 18 * dt;
          if (r.train.z0 > 24 || r.train.z0 + r.train.w < -24) { r.train = null; r.timer = 0; }
        }
      }
    }
    const hw = CR_LW * 0.3;
    if (cur.type === 'road') {
      for (const c of cur.items) if (s.pz + hw > c.z0 && s.pz - hw < c.z0 + c.w) { die(s, 'coche'); return; }
    } else if (cur.type === 'rail') {
      if (cur.train && s.pz + hw > cur.train.z0 && s.pz - hw < cur.train.z0 + cur.train.w) { die(s, 'tren'); return; }
    } else if (cur.type === 'river' && s.hop < 0.3) {
      const log = cur.items.find(l => s.pz > l.z0 - 0.15 && s.pz < l.z0 + l.w + 0.15);
      if (!log) { die(s, 'water'); return; }
      s.pz += cur.dir * cur.sp * dt;
      if (s.pz < cellZ(0) - CR_LW / 2 || s.pz > cellZ(CR_COLS - 1) + CR_LW / 2) { die(s, 'water'); return; }
    }
  });

  const pan = usePan(fx, {
    down: () => { const s = g.current; s.used = false; },
    move: (x, y, gs) => {
      const s = g.current;
      if (s.used) return;
      if (Math.abs(gs.dx) > 22 || Math.abs(gs.dy) > 22) {
        s.used = true;
        if (Math.abs(gs.dx) > Math.abs(gs.dy)) move(gs.dx > 0 ? 1 : -1, 0);
        else move(0, gs.dy < 0 ? -1 : 1);
      }
    },
    up: (x, y, gs) => { const s = g.current; if (!s.used && Math.abs(gs.dx) < 12 && Math.abs(gs.dy) < 12) move(1, 0); },
  });

  const s = g.current;
  // ----- escena 3D -----
  const objs = [];
  const lo = Math.max(0, Math.floor(s.cam) - 1), hi = Math.min(s.rows.length - 1, Math.ceil(s.cam) + CR_VIS);
  const frogX = lerp(laneX(s.row), laneX(s.hopFrom.row), s.hop);
  const frogZ = lerp(s.pz, s.hopFrom.z, s.hop);
  const arc = s.hop > 0 ? Math.sin((1 - s.hop) * Math.PI) * 0.45 : 0;
  objs.push({ id: 'suelo', k: 'pla', p: [0, -0.12, 0], s: [60, 60, 1], c: '#2a7d3c' });
  for (let i = lo; i <= hi; i++) {
    const r = s.rows[i], X = laneX(i), id = `l${i}`;
    if (r.type === 'grass') {
      objs.push({ id, k: 'box', p: [X, -0.05, 0], s: [CR_LW, 0.1, CR_LEN], c: i % 2 ? '#37a152' : '#2f9248' });
      r.trees.forEach(c => {
        objs.push({ id: `${id}t${c}`, k: 'cyl', p: [X, 0.25, cellZ(c)], s: [0.22, 0.5, 0.22], c: '#6b4423' });
        objs.push({ id: `${id}T${c}`, k: 'cone', p: [X, 0.9, cellZ(c)], s: [0.95, 1.5, 0.95], c: '#2fbf5a', e: 0.05 });
      });
      if (r.coin >= 0) objs.push({ id: `${id}m`, k: 'cyl', p: [X, 0.5, cellZ(r.coin)], s: [0.6, 0.12, 0.6], r: [Math.PI / 2 + s.t * 3, 0, 0], c: '#ffc233', e: 0.12 });
    } else if (r.type === 'road') {
      objs.push({ id, k: 'box', p: [X, -0.05, 0], s: [CR_LW, 0.1, CR_LEN], c: '#4a4e66' });
      r.items.forEach((it, k) => objs.push({ id: `${id}c${k}`, k: 'box', p: [X, 0.5, it.z0 + it.w / 2], s: [CR_LW * 0.7, 0.7, it.w * 0.92], c: it.color, e: 0.08 }));
    } else if (r.type === 'river') {
      objs.push({ id, k: 'box', p: [X, -0.1, 0], s: [CR_LW, 0.1, CR_LEN], c: '#1f6fc4', e: 0.03 });
      r.items.forEach((it, k) => objs.push({ id: `${id}g${k}`, k: 'box', p: [X, 0.08, it.z0 + it.w / 2], s: [CR_LW * 0.8, 0.25, it.w], c: '#8a5a2b' }));
    } else {
      objs.push({ id, k: 'box', p: [X, -0.05, 0], s: [CR_LW, 0.1, CR_LEN], c: '#25222c' });
      objs.push({ id: `${id}r1`, k: 'box', p: [X - 0.4, 0.02, 0], s: [0.08, 0.05, CR_LEN], c: '#8a8a99' });
      objs.push({ id: `${id}r2`, k: 'box', p: [X + 0.4, 0.02, 0], s: [0.08, 0.05, CR_LEN], c: '#8a8a99' });
      if (r.train) objs.push({ id: `${id}tr`, k: 'box', p: [X, 0.8, r.train.z0 + r.train.w / 2], s: [CR_LW * 0.9, 1.4, r.train.w], c: '#c0392b', e: 0.08 });
      if (r.warn) objs.push({ id: `${id}w`, k: 'sph', p: [X, 1.8, r.dir > 0 ? -6 : 6], n: 0.5, c: '#ff3b3b', e: Math.floor(s.t * 8) % 2 ? 0.6 : 0.05 });
    }
  }
  if (!s.dead) {
    objs.push({ id: 'sombra', k: 'pla', p: [frogX, 0.02, frogZ], s: [0.9, 0.9, 1], c: '#000000', o: 0.35 });
    objs.push({ id: 'rana', k: 'sph', p: [frogX, 0.5 + arc, frogZ], n: 0.8, c: '#7dff6b', e: 0.1 });
    objs.push({ id: 'ojoI', k: 'sph', p: [frogX + 0.22, 0.95 + arc, frogZ - 0.22], n: 0.26, c: '#ffffff', e: 0.3 });
    objs.push({ id: 'ojoD', k: 'sph', p: [frogX + 0.22, 0.95 + arc, frogZ + 0.22], n: 0.26, c: '#ffffff', e: 0.3 });
  }
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.05 : 0;
  const scene = {
    bg: '#a8e6ff', fog: { c: '#a8e6ff', near: 18, far: 46 }, objs,
    cam: { p: [s.vx + (Math.random() - 0.5) * shake, CR_CAM_UP, s.vz + CR_CAM_BACK], l: [s.vx, 0, s.vz - 2.8], fov: 56 },
  };

  return (
    <GameScreen title="CROSSY ROAD" emoji="🐸" accent={C.lime} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Monedas <Text style={{ color: C.amber, fontWeight: '800' }}>{s.coins}</Text></Text><Text style={{ color: C.dim, fontSize: 12 }}>Toca: avanzar · Desliza: moverte</Text></>}>
      <PlayArea fx={fx} bg="#0f3318" border={alpha(C.lime, 0.35)} {...pan}>
        <World3D scene={scene} />
        {phase === 'play' && s.started && s.row - s.cam < 1.6 && <Text pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 6, textAlign: 'center', color: alpha(C.red, 0.9), fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>¡LA PANTALLA TE EMPUJA!</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🐸" title={phase === 'over' ? (res.why === 'water' ? '¡AL AGUA!' : res.why === 'tren' ? '¡ARROLLADO POR UN TREN!' : res.why === 'cámara' ? '¡TE ALCANZARON!' : '¡ATROPELLADO!') : 'CROSSY ROAD'}
          subtitle={phase === 'over' ? `Avanzaste ${s.maxRow - 1} filas` : 'Cruza calles, ríos y vías en 3D'}
          score={s.score} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca para avanzar · desliza a los lados para moverte', 'Sube a los troncos para cruzar el río', 'Cuidado con los trenes (🚨) · la pantalla te empuja', '🪙 da +5 puntos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
