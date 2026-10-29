import React, { useRef, useState } from 'react';
import { C, Lives, SCREEN_H, SCREEN_W, clamp, hx, pick, rand, randInt, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { Game3D, HudPill } from '../utils/ui3d';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { project } from '../utils/openworld';

// FRUIT TAP 3D: frutas que saltan desde una mesa de madera. Desliza el dedo para cortarlas;
// al cortar, la fruta se parte en dos mitades y estalla en partículas de su color.
// Bomba = fin · hielo = cámara lenta · 3 frutas perdidas = fin · cortar 3+ de un trazo da bonus.
const CAM = { p: [0, 3.0, 11.5], l: [0, 2.2, -3.2], fov: 58 };
const PIT_Y = -1.3, CUT_Z = -3.6, G = 17, R = 0.8;
const FRUITS = [
  { k: 'apple', c: '#ff4d6d', fl: '#fff1d6' }, { k: 'orange', c: '#ff8a3d', fl: '#ffd08a' }, { k: 'lemon', c: '#ffe14d', fl: '#fff8c4' },
  { k: 'melon', c: '#2fb35a', fl: '#ff5d7a' }, { k: 'plum', c: '#9b6bff', fl: '#ffd0ff' }, { k: 'kiwi', c: '#8fbf4a', fl: '#c8ff7a' },
];
const SKY = { top: '#0a0618', bottom: '#4b2a86' };
const BOMB_COLS = ['#ff4d4d', '#ffb020', '#ffe066'];

// Mesa, fondo y neones (estático, se calcula una vez)
const STATICS = (() => {
  const st = [
    { id: 'suelo', k: 'pla', p: [0, PIT_Y - 6, -4], s: [90, 90, 1], c: '#150c2e', recv: true },
    { id: 'mesa', k: 'pla', p: [0, PIT_Y, -3.4], s: [14, 10, 1], c: '#3b2316', recv: true },
    { id: 'borde', k: 'box', p: [0, PIT_Y + 0.12, 1.7], s: [14.4, 0.24, 0.3], c: '#7a4a2a', e: 0.1 },
    { id: 'neon-i', k: 'box', p: [-4.6, PIT_Y + 4.5, -6.6], s: [0.14, 9, 0.14], c: C.lime, e: 0.9 },
    { id: 'neon-d', k: 'box', p: [4.6, PIT_Y + 4.5, -6.6], s: [0.14, 9, 0.14], c: C.cyan, e: 0.9 },
    { id: 'neon-t', k: 'box', p: [0, PIT_Y + 8.9, -6.6], s: [9.4, 0.14, 0.14], c: C.violet, e: 0.9 },
  ];
  for (let i = 0; i < 5; i++) st.push({ id: `ranura${i}`, k: 'box', p: [0, PIT_Y + 0.01, -7 + i * 1.6], s: [11, 0.02, 0.05], c: '#5a3a26' });
  return st;
})();

// Vectores y cámara (mismo convenio que project() de openworld.js)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// Dedo (píxeles) → punto del plano de corte z = CUT_Z, en x/y del mundo
const cursorAt = (x, y) => {
  const f = nrm(sub(CAM.l, CAM.p)); const r = nrm(cross(f, [0, 1, 0])); const u = cross(r, f);
  const t = Math.tan((CAM.fov * Math.PI) / 360), a = SCREEN_W / SCREEN_H;
  const nx = (x / SCREEN_W) * 2 - 1, ny = 1 - (y / SCREEN_H) * 2;
  const d = [0, 1, 2].map(i => f[i] + r[i] * nx * t * a + u[i] * ny * t);
  const k = (CUT_Z - CAM.p[2]) / d[2];
  return [CAM.p[0] + d[0] * k, CAM.p[1] + d[1] * k];
};
const scr = p => project(CAM, p, SCREEN_W, SCREEN_H) || { x: SCREEN_W / 2, y: SCREEN_H / 2, z: 1 };
// radio en píxeles de una fruta (medido proyectando su borde)
const pxR = f => Math.max(18, Math.abs(scr([f.x + R, f.y, f.z]).x - scr([f.x, f.y, f.z]).x) + 8);
const segHit = (ax, ay, bx, by, px, py, rad) => {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
  const t = clamp(l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0, 0, 1);
  return Math.hypot(ax + dx * t - px, ay + dy * t - py) < rad;
};
const rz = (dx, dy, a) => [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];

const initState = () => ({
  fruits: [], halves: [], trail: [], lives: 3, score: 0, t: 0, wave: 0.6, combo: 0, maxCombo: 0, sliced: 0,
  last: null, swipe: 0, freeze: 0, pt: null, over: false,
});

// Fruta, bomba o hielo, con tallo/hoja que giran con ella
function fruitObjs(f) {
  if (f.ice) return [{ id: f.id, k: 'oct', p: [f.x, f.y, f.z], n: 1.25, r: [f.a * 0.7, f.a, 0], c: '#22e6ff', e: 0.55, sh: true }];
  const a = f.a, P = (dx, dy) => { const q = rz(dx, dy, a); return [f.x + q[0], f.y + q[1], f.z]; };
  if (f.bomb) {
    return [
      { id: f.id, k: 'sph', p: [f.x, f.y, f.z], n: 1.4, c: '#2a1030', e: 0.12, sh: true },
      { id: `${f.id}f`, k: 'box', p: P(0, 0.95), s: [0.1, 0.34, 0.1], r: [0, 0, a], c: C.red, e: 0.9 },
      { id: `${f.id}s`, k: 'sph', p: P(0, 1.3), n: 0.12 + Math.abs(Math.sin(f.a * 5)) * 0.08, c: '#ffb020', e: 1 },
    ];
  }
  const out = [];
  const body = { id: f.id, k: 'sph', p: [f.x, f.y, f.z], c: f.c, e: 0.12, sh: true };
  if (f.k === 'lemon') { body.s = [1.75, 1.2, 1.2]; body.r = [0, 0, a]; } else body.n = 1.5;
  out.push(body);
  if (f.k === 'lemon') {
    out.push({ id: `${f.id}t1`, k: 'sph', p: P(0.92, 0), n: 0.2, c: '#fff3a0', e: 0.3 });
    out.push({ id: `${f.id}t2`, k: 'sph', p: P(-0.92, 0), n: 0.2, c: '#fff3a0', e: 0.3 });
  } else {
    if (f.k === 'melon') out.push({ id: `${f.id}s`, k: 'tor', p: [f.x, f.y, f.z], n: 1.58, r: [Math.PI / 2, 0, a], c: '#14401f', e: 0.1 });
    out.push({ id: `${f.id}k`, k: 'cyl', p: P(0, 0.92), s: [0.09, 0.26, 0.09], r: [0, 0, a], c: '#6b4a2b' });
    if (f.k === 'apple') out.push({ id: `${f.id}l`, k: 'sph', p: P(0.24, 1.0), s: [0.44, 0.13, 0.24], r: [0, 0, a + 0.5], c: '#3fbf5a', e: 0.1 });
  }
  return out;
}

// Mitad de fruta: cuerpo aplastado + cara de corte (color de la pulpa) que mira arriba
function halfObjs(h) {
  const a = h.a, q = rz(0, 0.4, a);
  return [
    { id: `${h.id}b`, k: 'sph', p: [h.x, h.y, h.z], s: [1.5, 0.8, 1.5], r: [0, 0, a], c: h.c, e: 0.1, sh: true },
    { id: `${h.id}f`, k: 'cyl', p: [h.x + q[0], h.y + q[1], h.z], s: [1.34, 0.04, 1.34], r: [0, 0, a], c: h.fl, e: 0.35 },
  ];
}

// Modo menú: una fuente de frutas que sube y baja, para el fondo de inicio y fin
const showFruits = t => FRUITS.map((fr, i) => {
  const ph = (t * 0.55 + i * 0.17) % 1;
  return { id: `sf${i}`, k: fr.k, c: fr.c, x: (i - 2.5) * 1.15, y: PIT_Y + 4.2 * 4 * ph * (1 - ph) + 0.6, z: -3.6 - (i % 2) * 0.9, a: t * 2 + i, w: 0 };
});

const ICE_SKY = { top: '#031820', bottom: '#0c4a58' };
const sceneOf = (objs, freezing) => ({
  sky: freezing ? ICE_SKY : SKY, fog: { c: (freezing ? ICE_SKY : SKY).bottom, near: 22, far: 52 }, light: { dir: [-0.3, 0.9, 0.5], sun: '#ffd9a8', i: 2.4 },
  shadowR: 14, statics: STATICS, objs, cam: CAM,
});

export function FruitTap3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('fruitslash');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, why: '' });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const end = (s, why) => {
    if (s.over) return;
    s.over = true; hx.die();
    setRes({ isNew: submitBest(s.score), why }); setPhase('over');
  };

  const launch = s => {
    const bomb = Math.random() < Math.min(0.2, 0.08 + s.t * 0.002);
    const ice = !bomb && Math.random() > 0.95;
    const x = rand(-3.1, 3.1), fr = pick(FRUITS);
    s.fruits.push({
      id: uid(), k: fr.k, c: fr.c, fl: fr.fl, x, y: PIT_Y, z: rand(-5.2, -2.8), vx: -x * rand(0.25, 0.5), vy: rand(12, 15),
      bomb, ice, a: rand(0, 6), w: rand(-4, 4), cut: false,
    });
  };

  const slice = (s, f) => {
    f.cut = true;
    const sc = scr([f.x, f.y, f.z]);
    if (f.bomb) {
      burst3d([f.x, f.y, f.z], BOMB_COLS, 60, { speed: 8, up: 3, size: 0.3, life: 1.1 });
      ring3d([f.x, f.y, f.z], C.red, 28, { speed: 7, life: 0.8 });
      fx.shake(14, 0.5); fx.flash(C.red, 0.5);
      s.lives = 0; end(s, 'bomba'); return;
    }
    if (f.ice) { s.freeze = 4; fx.flash(C.cyan, 0.3); fx.pop(sc.x, sc.y, 'CÁMARA LENTA', C.cyan, 16); hx.good(); }
    s.sliced += 1; s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo); s.swipe += 1;
    const pts = 1 + Math.floor(s.combo / 5);
    s.score += pts;
    burst3d([f.x, f.y, f.z], f.ice ? ['#22e6ff', '#e8ffff'] : [f.c, '#ffffff', f.fl], f.ice ? 40 : 34, { speed: 7, life: 0.9, size: 0.22, g: 14 });
    ring3d([f.x, f.y, f.z], f.ice ? '#22e6ff' : f.c, 16, { speed: 5, life: 0.5 });
    fx.pop(sc.x, sc.y - 26, `+${pts}`, C.text, 18);
    hx.hit();
    if (!f.ice) {
      s.halves.push({ id: uid(), x: f.x, y: f.y, z: f.z, vx: -2.4, vy: f.vy * 0.3 + 1.5, a: f.a, w: -4, c: f.c, fl: f.fl });
      s.halves.push({ id: uid(), x: f.x, y: f.y, z: f.z, vx: 2.4, vy: f.vy * 0.3 + 1.5, a: f.a, w: 4, c: f.c, fl: f.fl });
    }
  };

  const addTrail = (s, x, y) => {
    const w = cursorAt(x, y);
    s.trail.push({ x: w[0], y: w[1], a: 1 });
    if (s.trail.length > 14) s.trail.shift();
  };

  useLoop(phase === 'play', dt0 => {
    const s = g.current;
    if (s.over) return;
    if (s.freeze > 0) s.freeze -= dt0;
    const dt = dt0 * (s.freeze > 0 ? 0.5 : 1);
    s.t += dt0;
    s.wave -= dt;
    if (s.wave <= 0) {
      const n = Math.random() < 0.5 ? 1 : randInt(2, 3 + Math.floor(s.t / 40));
      for (let i = 0; i < n; i++) launch(s);
      s.wave = Math.max(0.55, 1.35 - s.t * 0.012) * rand(0.8, 1.1);
    }
    s.fruits.forEach(f => { f.vy -= G * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.a += f.w * dt; });
    for (let i = s.fruits.length - 1; i >= 0; i--) {
      const f = s.fruits[i];
      if (f.cut) { s.fruits.splice(i, 1); continue; }
      if (f.vy < 0 && f.y < PIT_Y - 0.4) {
        s.fruits.splice(i, 1);
        if (!f.bomb && !f.ice) {
          s.lives -= 1; s.combo = 0;
          const sc = scr([clamp(f.x, -3.5, 3.5), PIT_Y, f.z]);
          fx.pop(sc.x, sc.y - 20, '✖', C.red, 26); fx.shake(5, 0.2); hx.bad();
          if (s.lives <= 0) { end(s, 'frutas'); return; }
        }
      }
    }
    s.halves.forEach(h => { h.vy -= G * dt; h.x += h.vx * dt; h.y += h.vy * dt; h.a += h.w * dt; });
    s.halves = s.halves.filter(h => h.y > PIT_Y - 3);
    s.trail.forEach(p => { p.a -= dt0 * 3.5; });
    s.trail = s.trail.filter(p => p.a > 0);
  });

  const pan = usePan(fx, {
    down: (x, y) => { const s = g.current; if (phase !== 'play' || s.over) return; s.last = { x, y }; s.swipe = 0; s.pt = { x, y }; addTrail(s, x, y); },
    move: (x, y) => {
      const s = g.current;
      if (phase !== 'play' || s.over || !s.last) return;
      s.pt = { x, y }; addTrail(s, x, y);
      for (const f of s.fruits) {
        if (f.cut) continue;
        const c = scr([f.x, f.y, f.z]);
        if (segHit(s.last.x, s.last.y, x, y, c.x, c.y, pxR(f))) { slice(s, f); if (s.over) return; }
      }
      s.last = { x, y };
    },
    up: () => {
      const s = g.current;
      if (!s.over && s.swipe >= 3) { const b = s.swipe * 2; s.score += b; fx.pop(SCREEN_W / 2, SCREEN_H / 2, `¡${s.swipe} DE UN CORTE! +${b}`, C.amber, 20); hx.win(); }
      s.swipe = 0; s.last = null; s.pt = null;
    },
  });

  const s = g.current;
  const objs = [];
  for (const f of s.fruits) objs.push(...fruitObjs(f));
  for (const h of s.halves) objs.push(...halfObjs(h));
  s.trail.forEach((p, i) => objs.push({ id: `tr${i}`, k: 'sph', p: [p.x, p.y, CUT_Z], n: 0.16 + 0.12 * p.a, c: '#ffffff', e: 1, o: p.a * 0.75 }));
  const cur = s.pt ? cursorAt(s.pt.x, s.pt.y) : null;
  objs.push({ id: 'cursor', k: 'sph', p: cur ? [cur[0], cur[1], CUT_Z] : [0, -30, CUT_Z], n: 0.42, c: '#ffffff', e: 1 });
  const scene = sceneOf(objs, s.freeze > 0);
  const menuScene = t => sceneOf(showFruits(t).flatMap(fruitObjs), false);
  const won = res.why === 'bomba';

  return (
    <Game3D title="FRUIT SLASH" emoji="🍉" accent={C.lime} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={menuScene} orbit={{ r: 12, h: 3.4, speed: 0.2, ly: 1.4 }}
      pan={pan}
      hud={<>
        <Lives n={s.lives} max={3} icon="🍎" off="✖️" />
        {s.freeze > 0 && <HudPill icon="🧊" value={`${Math.ceil(s.freeze)}s`} color={C.cyan} />}
        <HudPill icon="🔥" label="RACHA" value={s.combo} color={C.lime} />
      </>}
      subtitle="Corta frutas en el espacio y evita las bombas"
      lines={['Desliza el dedo sobre las frutas para cortarlas', 'Si se escapan 3 frutas, pierdes', '💣 la bomba termina la partida · 🧊 cámara lenta', 'Corta 3 o más de un trazo para ganar bonus']}
      result={{ isNew: res.isNew, title: won ? '¡BOOM!' : 'SE ESCAPARON', emoji: won ? '💣' : '🍉', subtitle: `${s.sliced} frutas cortadas · mejor racha ${s.maxCombo}`, stats: [['CORTES', s.sliced], ['RACHA MÁX.', s.maxCombo]] }} />
  );
}
