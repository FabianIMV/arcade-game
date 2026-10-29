import React, { useRef, useState } from 'react';
import { C, SCREEN_H, SCREEN_W, hx, pick, randInt, uid, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill } from '../utils/ui3d';
import { mix } from '../utils/prefabs';

// SNAKE POWER 3D · tablero de 12 × 18 celdas con mesetas. La cámara va detrás de la cabeza y se desliza suave.
// Gira con los botones ◀ y ▶ (multitáctiles). Poderes: 👻 atraviesa muros · 🐢 lento · ✨ puntos ×2 · 💎 +50.
// Cada 5 manzanas sube el nivel y aparecen rocas.
const SCREEN_CX = SCREEN_W / 2, SCREEN_CY = SCREEN_H / 2;
const SN_W = 12, SN_D = 18, SN_HW = SN_W / 2, SN_HD = SN_D / 2;
const SN_START = { x: 6, y: 13 };
const SN_BACK = 6.2, SN_UP = 4.0;      // cámara: distancia detrás de la cabeza y altura
const SN_STEP = 0.13;

const wx = gx => gx - SN_HW + 0.5;     // celda → coordenada de mundo
const wz = gy => gy - SN_HD + 0.5;
const hAt = (h, gx, gy) => (gx >= 0 && gx < SN_W && gy >= 0 && gy < SN_D ? h[gx][gy] : 0);
const turnDir = (d, side) => (side < 0 ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x });   // izquierda/derecha respecto a d
const lerpV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const follow = (cur, to, f) => (Math.hypot(to[0] - cur[0], to[1] - cur[1], to[2] - cur[2]) > 4 ? to : lerpV(cur, to, f));   // corte si salta (teletransporte)

// Mesetas de 2-3 celdas de lado.
const makeTerrain = () => {
  const h = Array.from({ length: SN_W }, () => Array(SN_D).fill(0));
  for (let k = 0; k < 4; k++) {
    const w = randInt(2, 3), d = randInt(2, 3);
    const x0 = randInt(0, SN_W - w);
    const y0 = Math.random() < 0.5 ? randInt(0, 3) : randInt(12, SN_D - d);
    const top = Math.random() < 0.5 ? 0.35 : 0.7;
    for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + d; y++) h[x][y] = top;
  }
  return h;
};

const freeCell = s => {
  for (let k = 0; k < 200; k++) {
    const c = { x: randInt(0, SN_W - 1), y: randInt(0, SN_D - 1) };
    if (s.body.some(b => b.x === c.x && b.y === c.y)) continue;
    if (s.rocks.some(b => b.x === c.x && b.y === c.y)) continue;
    if (s.food && s.food.x === c.x && s.food.y === c.y) continue;
    if (s.item && s.item.x === c.x && s.item.y === c.y) continue;
    if (Math.abs(c.x - s.body[0].x) + Math.abs(c.y - s.body[0].y) < 4) continue;
    return c;
  }
  return { x: 1, y: 1 };
};

// Decorado fijo (se calcula una vez): tablero a cuadros, mesetas, suelo y muros de neón.
const buildStatics = terrain => {
  const st = [
    { id: 'suelo', k: 'pla', p: [0, -0.1, 0], s: [SN_W + 9, SN_D + 9, 1], c: '#04100b', recv: true, m: { r: 0.95, m: 0 } },
    { id: 'pared-n', k: 'box', p: [0, 0.35, -SN_HD - 0.28], s: [SN_W + 0.9, 0.7, 0.22], c: '#7dff6b', e: 0.55 },
    { id: 'pared-s', k: 'box', p: [0, 0.35, SN_HD + 0.28], s: [SN_W + 0.9, 0.7, 0.22], c: '#7dff6b', e: 0.55 },
    { id: 'pared-o', k: 'box', p: [-SN_HW - 0.28, 0.35, 0], s: [0.22, 0.7, SN_D + 0.9], c: '#7dff6b', e: 0.55 },
    { id: 'pared-e', k: 'box', p: [SN_HW + 0.28, 0.35, 0], s: [0.22, 0.7, SN_D + 0.9], c: '#7dff6b', e: 0.55 },
  ];
  for (let x = 0; x < SN_W; x++) for (let y = 0; y < SN_D; y++) {
    st.push({ inst: 'casilla', k: 'box', p: [wx(x), -0.04, wz(y)], s: [0.98, 0.08, 0.98], c: (x + y) % 2 ? '#0d3324' : '#11432f', recv: true, m: { r: 0.6, m: 0.1 } });
    const h = terrain[x][y];
    if (h > 0) st.push({ inst: 'meseta', k: 'box', p: [wx(x), h / 2, wz(y)], s: [0.97, h, 0.97], c: h > 0.5 ? '#38c27a' : '#27a165', sh: true, recv: true, m: { r: 0.45, m: 0.1 } });
  }
  // fondo: luciérnagas y pilares alrededor del tablero (sin coste por frame: están en statics)
  const fr = seedRand(7);
  for (let i = 0; i < 70; i++) {
    const x = (fr() - 0.5) * 44, z = (fr() - 0.5) * 50;
    if (Math.abs(x) < 8.5 && Math.abs(z) < 12) continue;
    st.push({ inst: 'luciernaga', k: 'sph', p: [x, 0.8 + fr() * 6, z], n: 0.1 + fr() * 0.08, c: fr() < 0.5 ? '#c8ff7a' : '#7dffd0', e: 1 });
  }
  for (let i = 0; i < 18; i++) {
    const a = fr() * Math.PI * 2, d = 13 + fr() * 12, h = 1.5 + fr() * 6;
    st.push({ inst: 'pilar', k: 'box', p: [Math.cos(a) * d, h / 2 - 0.1, Math.sin(a) * d], s: [0.9, h, 0.9], c: '#0b2a20', e: 0.12, recv: true });
  }
  return st;
};
const seedRand = seed => { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

const initState = () => {
  const s = {
    body: [{ x: SN_START.x, y: SN_START.y }, { x: SN_START.x, y: SN_START.y + 1 }, { x: SN_START.x, y: SN_START.y + 2 }],
    dir: { x: 0, y: -1 }, queue: [], acc: 0, frac: 0, stepT: SN_STEP, food: null, item: null, rocks: [], terrain: makeTerrain(),
    score: 0, eaten: 0, level: 1, ghost: 0, slow: 0, dbl: 0, t: 0, grow: 0, cd: { x: 0, z: -1 }, cp: null, cl: null, dead: false,
  };
  s.food = freeCell(s);
  s.statics = buildStatics(s.terrain);
  return s;
};

// posición visual de un segmento: se desliza desde donde estaba el siguiente (movimiento continuo entre celdas)
const segPos = (s, i, fr) => {
  const a = s.body[i], b = s.body[i + 1] || a;
  const jump = Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1;
  const gx = jump ? a.x : b.x + (a.x - b.x) * fr;
  const gy = jump ? a.y : b.y + (a.y - b.y) * fr;
  const yb = jump ? hAt(s.terrain, a.x, a.y) : hAt(s.terrain, b.x, b.y) * (1 - fr) + hAt(s.terrain, a.x, a.y) * fr;
  return [wx(gx), yb + 0.4, wz(gy)];
};

// cámara ideal: detrás de la cabeza, mirando hacia donde va
const camFor = (s, fr) => {
  const hp = segPos(s, 0, fr);
  return { p: [hp[0] - s.cd.x * SN_BACK, hp[1] + SN_UP, hp[2] - s.cd.z * SN_BACK], l: [hp[0] + s.cd.x * 3.6, hp[1] + 0.2, hp[2] + s.cd.z * 3.6] };
};

// Escena completa en un instante (se usa para jugar y para el fondo animado de los menús)
function buildScene(s, t, live) {
  const fr = live ? s.frac : 0;
  const objs = [];
  const hp = segPos(s, 0, fr);
  for (const r of s.rocks) objs.push({ id: `r${r.id}`, k: 'ico', p: [wx(r.x), hAt(s.terrain, r.x, r.y) + 0.42, wz(r.y)], n: 0.84, c: '#9aa1c8', e: 0.04, sh: true, m: { r: 0.7, m: 0 } });
  // manzana con brillo, tallo y hoja
  let food = null;
  if (s.food) {
    const pulse = 1 + Math.sin(t * 6) * 0.06;
    const fy = hAt(s.terrain, s.food.x, s.food.y), x0 = wx(s.food.x), z0 = wz(s.food.y);
    food = [x0, fy + 0.45, z0];
    objs.push({ id: 'comida', k: 'sph', p: [x0, fy + 0.45, z0], n: 0.76 * pulse, c: '#ff3b4f', e: 0.22, sh: true, m: { r: 0.2, m: 0 } });
    objs.push({ id: 'comida-tallo', k: 'box', p: [x0 + 0.05, fy + 0.88, z0], s: [0.07, 0.22, 0.07], c: '#7a4a2a', sh: true });
    objs.push({ id: 'comida-hoja', k: 'oct', p: [x0 + 0.15, fy + 0.92, z0], s: [0.34, 0.1, 0.2], r: [0, 0, 0.4], c: '#3fd16a', e: 0.3 });
  }
  if (s.item) {
    const it = s.item, iy = hAt(s.terrain, it.x, it.y) + 0.55, ix = wx(it.x), iz = wz(it.y);
    const blink = it.life < 3 && Math.floor(t * 8) % 2 ? 0.3 : 1;
    if (it.k === 'ghost') objs.push({ id: 'item', k: 'ico', p: [ix, iy, iz], n: 0.7, c: '#b388ff', e: 0.55, o: 0.75 * blink, m: { r: 0.3, m: 0 } });
    if (it.k === 'slow') objs.push({ id: 'item', k: 'cyl', p: [ix, iy, iz], s: [0.72, 0.28, 0.72], c: '#22e6ff', e: 0.55, o: blink });
    if (it.k === 'dbl') objs.push({ id: 'item', k: 'tor', p: [ix, iy, iz], n: 0.8, r: [Math.PI / 2, t * 3, 0], c: '#ffc233', e: 0.7, o: blink });
    if (it.k === 'gem') objs.push({ id: 'item', k: 'oct', p: [ix, iy, iz], n: 0.56, r: [t * 1.8, t * 2.4, 0], c: '#22e6ff', e: 0.7, o: blink });
  }
  // cuerpo: instancias (sin id) con degradado de color
  const L = Math.max(8, s.body.length);
  for (let i = 1; i < s.body.length; i++) {
    const k = Math.min(1, i / L);
    const col = s.ghost > 0 ? mix('#c9a5ff', '#5b2fb5', k) : mix('#c8ff8a', '#0f9d6b', k);
    objs.push({ inst: 'cuerpo', k: 'sph', p: segPos(s, i, fr), n: 0.66, c: col, e: 0.08, sh: true, m: { r: 0.35, m: 0.05 } });
  }
  // cabeza, ojos (a los lados, visibles desde la cámara) y lengua que aparece y desaparece
  const dx = s.dir.x, dz = s.dir.y;
  objs.push({ id: 'cabeza', k: 'sph', p: hp, n: 0.8, c: s.ghost > 0 ? '#c9a5ff' : '#b6ff7a', e: 0.2, sh: true, o: s.ghost > 0 ? 0.8 : 1, m: { r: 0.3, m: 0.05 } });
  [-1, 1].forEach(side => {
    const ex = hp[0] + dz * side * 0.36 + dx * 0.02, ez = hp[2] - dx * side * 0.36 + dz * 0.02, ey = hp[1] + 0.12;
    objs.push({ id: `ojo${side}`, k: 'sph', n: 0.17, c: '#ffffff', e: 0.6, p: [ex, ey, ez] });
    objs.push({ id: `pupila${side}`, k: 'sph', n: 0.09, c: '#04100a', p: [ex + dz * side * 0.06, ey, ez - dx * side * 0.06] });
  });
  if (Math.floor(t * 4) % 3 !== 0) objs.push({ id: 'lengua', k: 'box', p: [hp[0] + dx * 0.62, hp[1] - 0.04, hp[2] + dz * 0.62], s: [0.05, 0.05, 0.32], r: [0, Math.atan2(dx, dz), 0], c: '#ff4d6d', e: 0.6 });
  const lights = [{ p: [food ? food[0] : hp[0], (food ? food[1] : 0) + 1.2, food ? food[2] : hp[2]], c: '#ff6a7a', i: 6, d: 5 }, { p: [hp[0], hp[1] + 1.4, hp[2]], c: '#a8ff7a', i: 5, d: 4.5 }];
  const c = live && s.cp ? { p: s.cp, l: s.cl } : camFor(s, fr);
  return {
    sky: { top: '#061a12', bottom: '#0f4030', sun: false, clouds: 0 },
    fog: { c: '#0f4030', near: 16, far: 40 },
    light: { dir: [-0.45, 0.9, 0.3], sun: '#fff3dc', i: 2.3, sky: '#d6f5e4', ground: '#16382b', hi: 1.3 },
    shadowR: 14, statics: s.statics, objs, lights,
    cam: { p: c.p, l: c.l, fov: 58 },
  };
}

export function SnakePower3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('snake');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const die = s => {
    s.dead = true;
    const hp = segPos(s, 0, s.frac);
    burst3d(hp, ['#ff4d6d', '#ffffff', '#7dff6b'], 60, { speed: 7, up: 3, g: 9, size: 0.2, life: 1 });
    ring3d(hp, '#ff4d6d', 26, { speed: 7, life: 0.7 });
    fx.shake(10, 0.4); fx.flash(C.red, 0.3); hx.die();
    setRes({ isNew: submitBest(s.score) });
    setPhase('over');
  };
  const turn = (s, side) => {
    if (s.dead || s.queue.length >= 2) return;
    const ref = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
    s.queue.push(turnDir(ref, side)); hx.tick();
  };
  const step = s => {
    if (s.queue.length) { const d = s.queue.shift(); if (!(d.x === -s.dir.x && d.y === -s.dir.y)) s.dir = d; }
    const h = s.body[0];
    let nx = h.x + s.dir.x, ny = h.y + s.dir.y;
    if (nx < 0 || ny < 0 || nx >= SN_W || ny >= SN_D) {
      if (s.ghost > 0) {
        nx = (nx + SN_W) % SN_W; ny = (ny + SN_D) % SN_D;
        burst3d([wx(nx), hAt(s.terrain, nx, ny) + 0.5, wz(ny)], '#b388ff', 12, { speed: 3, life: 0.5, size: 0.12, g: 0 });
      } else { die(s); return false; }
    }
    const bodyCheck = s.grow > 0 ? s.body : s.body.slice(0, -1);
    if (s.ghost <= 0 && (bodyCheck.some(b => b.x === nx && b.y === ny) || s.rocks.some(r => r.x === nx && r.y === ny))) { die(s); return false; }
    s.body.unshift({ x: nx, y: ny });
    if (s.grow > 0) s.grow -= 1; else s.body.pop();
    if (s.food && s.food.x === nx && s.food.y === ny) {
      const fp = [wx(nx), hAt(s.terrain, nx, ny) + 0.45, wz(ny)];
      s.eaten += 1; s.grow += 1;
      const pts = 10 * (s.dbl > 0 ? 2 : 1) * s.level;
      s.score += pts;
      burst3d(fp, ['#ff3b4f', '#ffb3b8', '#ffd54a'], 22, { speed: 4.5, up: 2.5, g: 9, size: 0.13, life: 0.7 });
      fx.pop(SCREEN_CX, SCREEN_CY * 0.85, `+${pts}`, s.dbl > 0 ? C.amber : C.text, 16); hx.hit();
      s.food = freeCell(s);
      if (s.eaten % 5 === 0) {
        s.level += 1; s.stepT = Math.max(0.065, SN_STEP - s.level * 0.0065);
        s.rocks.push({ ...freeCell(s), id: uid() }, { ...freeCell(s), id: uid() });
        ring3d(segPos(s, 0, 0), C.lime, 30, { speed: 6, life: 0.7, size: 0.14 });
        fx.pop(SCREEN_CX, SCREEN_CY, `NIVEL ${s.level}`, C.lime, 26); hx.good();
      }
      if (!s.item && Math.random() < 0.3) s.item = { ...freeCell(s), k: pick(['ghost', 'slow', 'dbl', 'gem']), life: 9 };
    }
    if (s.item && s.item.x === nx && s.item.y === ny) {
      const k = s.item.k, ip = [wx(nx), hAt(s.terrain, nx, ny) + 0.6, wz(ny)];
      s.item = null; hx.good(); ring3d(ip, C.cyan, 22, { speed: 4, life: 0.6, size: 0.12 });
      if (k === 'ghost') { s.ghost = 7; fx.pop(SCREEN_CX, SCREEN_CY * 0.8, 'FANTASMA', C.violet, 15); }
      if (k === 'slow') { s.slow = 7; fx.pop(SCREEN_CX, SCREEN_CY * 0.8, 'LENTO', C.cyan, 15); }
      if (k === 'dbl') { s.dbl = 9; fx.pop(SCREEN_CX, SCREEN_CY * 0.8, 'PUNTOS ×2', C.amber, 15); }
      if (k === 'gem') { s.score += 50; s.grow += 3; fx.pop(SCREEN_CX, SCREEN_CY * 0.8, '+50', C.amber, 18); }
    }
    return true;
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.dead) return;
    s.t += dt;
    ['ghost', 'slow', 'dbl'].forEach(k => { if (s[k] > 0) s[k] = Math.max(0, s[k] - dt); });
    if (s.item) { s.item.life -= dt; if (s.item.life <= 0) s.item = null; }
    s.acc += dt;
    const T = s.stepT * (s.slow > 0 ? 1.7 : 1);
    while (s.acc >= T) { s.acc -= T; if (!step(s)) return; }
    s.frac = s.acc / T;
    // la dirección de la cámara gira suave hacia donde mira la serpiente
    const k = Math.min(1, dt * 7);
    s.cd.x += (s.dir.x - s.cd.x) * k; s.cd.z += (s.dir.y - s.cd.z) * k;
    const m = Math.hypot(s.cd.x, s.cd.z) || 1; s.cd.x /= m; s.cd.z /= m;
    const tgt = camFor(s, s.frac), f = Math.min(1, dt * 6);
    s.cp = s.cp ? follow(s.cp, tgt.p, f) : tgt.p;
    s.cl = s.cl ? follow(s.cl, tgt.l, f) : tgt.l;
  });

  const s = g.current;
  const scene = buildScene(s, s.t, phase === 'play');
  return (
    <Game3D title="SNAKE POWER" emoji="🐍" accent={C.lime} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(s, t, false)} orbit={{ r: 12, h: 6, speed: 0.2, ly: 0.6 }}
      hud={<>
        <HudPill icon="⭐" label="NIVEL" value={s.level} color={C.lime} />
        <HudPill icon="🐍" label="LARGO" value={s.body.length} color={C.cyan} />
        {s.ghost > 0 && <HudPill icon="👻" value={`${Math.ceil(s.ghost)}s`} color={C.violet} />}
        {s.slow > 0 && <HudPill icon="🐢" value={`${Math.ceil(s.slow)}s`} color={C.cyan} />}
        {s.dbl > 0 && <HudPill icon="✨" value={`×2 ${Math.ceil(s.dbl)}s`} color={C.amber} />}
      </>}
      subtitle="El clásico con poderes, en 3D"
      lines={['Toca ◀ o ▶ para girar la serpiente', '👻 atraviesa muros · 🐢 lento · ✨ puntos ×2 · 💎 +50', 'Cada 5 manzanas sube el nivel y aparecen rocas']}
      result={{ title: 'GAME OVER', emoji: '🐍', subtitle: `Nivel ${s.level} · Largo ${s.body.length}`, isNew: res.isNew, stats: [['NIVEL', s.level], ['LARGO', s.body.length], ['MANZANAS', s.eaten]] }}>
      <ActionBtn testID="sn-left" icon="◀" color={C.lime} onDown={() => turn(g.current, -1)} style={{ left: 26, bottom: 44 }} />
      <ActionBtn testID="sn-right" icon="▶" color={C.lime} onDown={() => turn(g.current, 1)} style={{ right: 26, bottom: 44 }} />
    </Game3D>
  );
}
