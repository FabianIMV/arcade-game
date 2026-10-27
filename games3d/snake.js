import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, alpha, clamp, hx, pick, randInt, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Tablero de 12 × 18 celdas de 1 m (x lateral, z = profundidad). La cámara va detrás de la cabeza.
// Gira con un toque a cada lado de la pantalla o deslizando en horizontal (giro relativo a la serpiente).
const SN_W = 12, SN_D = 18, SN_HW = SN_W / 2, SN_HD = SN_D / 2;
const SN_START = { x: 6, y: 13 };
const SN_BACK = 5.4, SN_UP = 3.6;      // cámara: distancia detrás y altura
const SN_STEP = 0.13, TURN_PX = 26;

const wx = gx => gx - SN_HW + 0.5;      // celda → coordenada de mundo
const wz = gy => gy - SN_HD + 0.5;
const hAt = (h, gx, gy) => (gx >= 0 && gx < SN_W && gy >= 0 && gy < SN_D ? h[gx][gy] : 0);
const turnDir = (d, side) => (side < 0 ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x });   // izquierda/derecha respecto a d

// Terrazas: mesetas de 2-3 celdas de lado, nunca junto a la salida de la serpiente.
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

const initState = () => {
  const s = {
    body: [{ x: SN_START.x, y: SN_START.y }, { x: SN_START.x, y: SN_START.y + 1 }, { x: SN_START.x, y: SN_START.y + 2 }],
    dir: { x: 0, y: -1 }, queue: [], acc: 0, frac: 0, stepT: SN_STEP, food: null, item: null, rocks: [], terrain: makeTerrain(),
    score: 0, eaten: 0, level: 1, ghost: 0, slow: 0, dbl: 0, t: 0, grow: 0, cd: { x: 0, z: -1 }, lx: 0, ly: 0, used: false,
  };
  s.food = freeCell(s);
  return s;
};

export function SnakePower3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('snake');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const die = s => {
    fx.shake(10, 0.4); fx.flash(C.red, 0.3); hx.die();
    setRes({ isNew: submitBest(s.score) });
    setPhase('over');
  };
  const turn = (s, side) => {
    if (s.queue.length >= 2) return;
    const ref = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
    s.queue.push(turnDir(ref, side)); hx.tick();
  };
  const step = s => {
    if (s.queue.length) { const d = s.queue.shift(); if (!(d.x === -s.dir.x && d.y === -s.dir.y)) s.dir = d; }
    const h = s.body[0];
    let nx = h.x + s.dir.x, ny = h.y + s.dir.y;
    if (nx < 0 || ny < 0 || nx >= SN_W || ny >= SN_D) {
      if (s.ghost > 0) { nx = (nx + SN_W) % SN_W; ny = (ny + SN_D) % SN_D; } else { die(s); return false; }
    }
    const bodyCheck = s.grow > 0 ? s.body : s.body.slice(0, -1);
    if (s.ghost <= 0 && (bodyCheck.some(b => b.x === nx && b.y === ny) || s.rocks.some(r => r.x === nx && r.y === ny))) { die(s); return false; }
    s.body.unshift({ x: nx, y: ny });
    if (s.grow > 0) s.grow -= 1; else s.body.pop();
    if (s.food && s.food.x === nx && s.food.y === ny) {
      s.eaten += 1; s.grow += 1;
      const pts = 10 * (s.dbl > 0 ? 2 : 1) * s.level;
      s.score += pts;
      fx.pop(AREA_W / 2, AREA_H * 0.45, `+${pts}`, s.dbl > 0 ? C.amber : C.text, 16); hx.hit();
      s.food = freeCell(s);
      if (s.eaten % 5 === 0) {
        s.level += 1; s.stepT = Math.max(0.065, SN_STEP - s.level * 0.0065);
        s.rocks.push({ ...freeCell(s), id: uid() }, { ...freeCell(s), id: uid() });
        fx.pop(AREA_W / 2, AREA_H / 2, `NIVEL ${s.level}`, C.lime, 26); hx.good();
      }
      if (!s.item && Math.random() < 0.3) s.item = { ...freeCell(s), k: pick(['ghost', 'slow', 'dbl', 'gem']), life: 9 };
    }
    if (s.item && s.item.x === nx && s.item.y === ny) {
      const k = s.item.k; s.item = null; hx.good(); fx.ring(AREA_W / 2, AREA_H / 2, C.cyan, 44);
      if (k === 'ghost') { s.ghost = 7; fx.pop(AREA_W / 2, AREA_H * 0.4, 'FANTASMA', C.violet, 15); }
      if (k === 'slow') { s.slow = 7; fx.pop(AREA_W / 2, AREA_H * 0.4, 'LENTO', C.cyan, 15); }
      if (k === 'dbl') { s.dbl = 9; fx.pop(AREA_W / 2, AREA_H * 0.4, 'PUNTOS ×2', C.amber, 15); }
      if (k === 'gem') { s.score += 50; s.grow += 3; fx.pop(AREA_W / 2, AREA_H * 0.4, '+50', C.amber, 18); }
    }
    return true;
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    ['ghost', 'slow', 'dbl'].forEach(k => { if (s[k] > 0) s[k] = Math.max(0, s[k] - dt); });
    if (s.item) { s.item.life -= dt; if (s.item.life <= 0) s.item = null; }
    s.acc += dt;
    const T = s.stepT * (s.slow > 0 ? 1.7 : 1);
    while (s.acc >= T) { s.acc -= T; if (!step(s)) return; }
    s.frac = s.acc / T;
    // la cámara gira suavemente hacia donde mira la serpiente
    const k = Math.min(1, dt * 7);
    s.cd.x += (s.dir.x - s.cd.x) * k; s.cd.z += (s.dir.y - s.cd.z) * k;
    const m = Math.hypot(s.cd.x, s.cd.z) || 1; s.cd.x /= m; s.cd.z /= m;
  });

  const pan = usePan(fx, {
    down: (x, y) => { const s = g.current; s.lx = x; s.ly = y; s.used = false; },
    move: x => {
      const s = g.current;
      if (phase !== 'play') return;
      if (Math.abs(x - s.lx) > TURN_PX) { turn(s, x > s.lx ? 1 : -1); s.lx = x; s.used = true; }
    },
    up: (x, y, gs) => {
      const s = g.current;
      if (phase === 'play' && !s.used && Math.abs(gs.dx) < 14 && Math.abs(gs.dy) < 14) turn(s, s.lx < AREA_W / 2 ? -1 : 1);
    },
  });

  const s = g.current;
  const fr = clamp(s.frac, 0, 1);
  // posición visual: cada segmento se desliza desde donde estaba el siguiente (así se ve el movimiento entre celdas)
  const segPos = i => {
    const a = s.body[i], b = s.body[i + 1] || a;
    const jump = Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1;
    const gx = jump ? a.x : b.x + (a.x - b.x) * fr;
    const gy = jump ? a.y : b.y + (a.y - b.y) * fr;
    const yb = jump ? hAt(s.terrain, a.x, a.y) : hAt(s.terrain, b.x, b.y) * (1 - fr) + hAt(s.terrain, a.x, a.y) * fr;
    return [wx(gx), yb + 0.4, wz(gy)];
  };

  const objs = [];
  objs.push({ id: 'suelo', k: 'pla', p: [0, -0.02, 0], s: [SN_W, SN_D, 1], c: '#0a2216' });
  for (let i = 0; i <= SN_W; i++) objs.push({ id: `gx${i}`, k: 'box', p: [i - SN_HW, 0.01, 0], s: [0.035, 0.02, SN_D], c: '#1f5a3a' });
  for (let j = 0; j <= SN_D; j++) objs.push({ id: `gz${j}`, k: 'box', p: [0, 0.01, j - SN_HD], s: [SN_W, 0.02, 0.035], c: '#1f5a3a' });
  for (let x = 0; x < SN_W; x++) for (let y = 0; y < SN_D; y++) {
    const h = s.terrain[x][y];
    if (h > 0) objs.push({ id: `t${x}_${y}`, k: 'box', p: [wx(x), (h - 0.4) / 2, wz(y)], s: [0.96, h + 0.4, 0.96], c: h > 0.5 ? '#2f9457' : '#1d6e44', e: 0.06 });
  }
  objs.push(
    { id: 'pared-n', k: 'box', p: [0, 0.35, -SN_HD - 0.3], s: [SN_W + 1, 0.7, 0.5], c: C.lime, e: 0.3 },
    { id: 'pared-s', k: 'box', p: [0, 0.35, SN_HD + 0.3], s: [SN_W + 1, 0.7, 0.5], c: C.lime, e: 0.3 },
    { id: 'pared-o', k: 'box', p: [-SN_HW - 0.3, 0.35, 0], s: [0.5, 0.7, SN_D + 1], c: C.lime, e: 0.3 },
    { id: 'pared-e', k: 'box', p: [SN_HW + 0.3, 0.35, 0], s: [0.5, 0.7, SN_D + 1], c: C.lime, e: 0.3 },
  );
  s.rocks.forEach(r => objs.push({ id: `r${r.id}`, k: 'box', p: [wx(r.x), hAt(s.terrain, r.x, r.y) + 0.45, wz(r.y)], s: [0.8, 0.9, 0.8], c: '#8b92b8', e: 0.05 }));
  if (s.food) {
    const pulse = 1 + Math.sin(s.t * 6) * 0.06;
    const fy = hAt(s.terrain, s.food.x, s.food.y);
    objs.push({ id: 'comida', k: 'sph', p: [wx(s.food.x), fy + 0.42, wz(s.food.y)], n: 0.75 * pulse, c: '#ff3b4f', e: 0.35 });
    objs.push({ id: 'comida-tallo', k: 'box', p: [wx(s.food.x), fy + 0.82, wz(s.food.y)], s: [0.08, 0.22, 0.08], c: C.lime, e: 0.4 });
  }
  if (s.item) {
    const it = s.item, iy = hAt(s.terrain, it.x, it.y) + 0.5, ix = wx(it.x), iz = wz(it.y);
    const blink = s.item.life < 3 && Math.floor(s.t * 8) % 2 ? 0.3 : 1;
    if (it.k === 'ghost') objs.push({ id: 'item', k: 'sph', p: [ix, iy, iz], n: 0.72, c: '#9b6bff', e: 0.45, o: 0.7 * blink });
    if (it.k === 'slow') objs.push({ id: 'item', k: 'cyl', p: [ix, iy, iz], s: [0.7, 0.3, 0.7], c: '#22e6ff', e: 0.45, o: blink });
    if (it.k === 'dbl') objs.push({ id: 'item', k: 'tor', p: [ix, iy, iz], n: 0.9, r: [Math.PI / 2, s.t * 3, 0], c: '#ffc233', e: 0.6, o: blink });
    if (it.k === 'gem') objs.push({ id: 'item', k: 'box', p: [ix, iy, iz], s: [0.5, 0.5, 0.5], r: [0.4, s.t * 2.5, 0.4], c: '#22e6ff', e: 0.5, o: blink });
  }
  s.body.forEach((_, i) => {
    const col = s.ghost > 0 ? `hsl(270,90%,${70 - Math.min(30, i)}%)` : i === 0 ? 'hsl(92,95%,64%)' : `hsl(${135 - Math.min(60, i * 2)},90%,${52 - Math.min(18, i * 0.8)}%)`;
    objs.push({ id: `s${i}`, k: 'sph', p: segPos(i), n: i === 0 ? 0.9 : 0.78, c: col, e: i === 0 ? 0.14 : 0.07, o: s.ghost > 0 ? 0.75 : 1 });
  });
  // ojos de la cabeza, mirando en la dirección de avance
  const hp = segPos(0), dx = s.dir.x, dz = s.dir.y;
  [-1, 1].forEach(side => objs.push({ id: `ojo${side}`, k: 'sph', n: 0.2, c: '#04100a', p: [hp[0] + dx * 0.36 - dz * side * 0.22, hp[1] + 0.14, hp[2] + dz * 0.36 + dx * side * 0.22] }));

  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.05 : 0;
  const cx = hp[0] - s.cd.x * SN_BACK + (Math.random() - 0.5) * shake;
  const cz = hp[2] - s.cd.z * SN_BACK + (Math.random() - 0.5) * shake;
  const scene = {
    bg: '#04100a', fog: { c: '#04100a', near: 16, far: 36 }, objs,
    cam: { p: [cx, hp[1] + SN_UP, cz], l: [hp[0] + s.cd.x * 2.6, hp[1] + 0.3, hp[2] + s.cd.z * 2.6], fov: 60 },
  };

  return (
    <GameScreen title="SNAKE POWER" emoji="🐍" accent={C.lime} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.lime, fontWeight: '800' }}>{s.level}</Text> · Largo <Text style={{ color: C.lime, fontWeight: '800' }}>{s.body.length}</Text></Text>
        <Text style={{ color: C.violet, fontSize: 12, fontWeight: '800' }}>{s.ghost > 0 ? `👻${Math.ceil(s.ghost)} ` : ''}{s.slow > 0 ? `🐢${Math.ceil(s.slow)} ` : ''}{s.dbl > 0 ? `✨${Math.ceil(s.dbl)}` : ''}</Text></>}>
      <PlayArea fx={fx} bg="#04100a" border={alpha(C.lime, 0.4)} {...pan}>
        <World3D scene={scene} />
        {phase === 'play' && <Text pointerEvents="none" style={{ position: 'absolute', bottom: 8, left: 0, width: AREA_W, textAlign: 'center', color: 'rgba(244,246,255,0.45)', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 }}>TOCA IZQ. / DER. O DESLIZA PARA GIRAR</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🐍" title={phase === 'over' ? 'GAME OVER' : 'SNAKE POWER'}
          subtitle={phase === 'over' ? `Nivel ${s.level} · Largo ${s.body.length}` : 'El clásico con poderes en 3D'}
          score={s.score} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca la izquierda o la derecha para girar', 'Desliza en horizontal para girar', '👻 atraviesa muros · 🐢 lento · ✨ ×2 · 💎 +50', 'Cada 5 manzanas sube el nivel y aparecen rocas'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
