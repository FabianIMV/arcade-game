import React, { useRef, useState } from 'react';
import { C, Combo, SCREEN_H, SCREEN_W, hx, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { mix } from '../utils/prefabs';

// TOWER STACK 3D · apila bloques con precisión. El cielo se va encendiendo a medida que la torre sube.
// Toca para soltar el bloque: lo que sobresale se corta y cae. Los encajes perfectos dan bonus y devuelven ancho.
const TS_H = 0.5, TS_BASE = 3.4, TS_R = 4.8, TS_PERFECT = 0.12, TS_GRAV = 26;
const SKY_TOP = ['#070a22', '#1c1040', '#40145a', '#7a2a5a', '#d2604e', '#ffa05a'];
const SKY_LOW = ['#14183c', '#2e1a5a', '#6a2a6e', '#b03f6a', '#f08a5a', '#ffd08a'];
const SCREEN_CX = SCREEN_W / 2, SCREEN_CY = SCREEN_H / 2;
const other = a => (a === 'x' ? 'z' : 'x');
const SZ = { x: 'sx', z: 'sz' };
const topOf = s => s.stack[s.stack.length - 1];

const initState = () => ({
  stack: [{ x: 0, z: 0, sx: TS_BASE, sz: TS_BASE, hue: 200 }],
  cur: null, debris: [], camY: 0, speed: 4.6, score: 0, perfect: 0, maxPerfect: 0, t: 0,
});
const newCur = s => {
  const prev = s.stack[s.stack.length - 1];
  const axis = s.stack.length % 2 === 1 ? 'x' : 'z';
  return { axis, p: -TS_R + prev[SZ[axis]] / 2, dir: 1, hue: (prev.hue + 13) % 360 };
};

// torre de demostración para la pantalla de inicio (fija)
const DEMO = (() => {
  const st = [{ x: 0, z: 0, sx: TS_BASE, sz: TS_BASE, hue: 200 }];
  for (let i = 1; i <= 9; i++) {
    const prev = st[i - 1], A = i % 2 === 1 ? 'x' : 'z', B = other(A);
    const off = (i % 3 - 1) * 0.22;
    const nb = { x: 0, z: 0, sx: prev.sx, sz: prev.sz, hue: (200 + i * 13) % 360 };
    nb[A] = prev[A] + off; nb[B] = prev[B]; nb[SZ[A]] = prev[SZ[A]] - Math.abs(off) * 0.6;
    st.push(nb);
  }
  return st;
})();

// Escena (se reconstruye cada frame). st: { stack, camY, debris, cur, playing }
function buildScene(st) {
  const n = st.stack.length;
  const f = Math.min(5, st.camY / 3.5), i0 = Math.floor(f), fr = f - i0, i1 = Math.min(5, i0 + 1);
  const top = mix(SKY_TOP[i0], SKY_TOP[i1], fr), low = mix(SKY_LOW[i0], SKY_LOW[i1], fr);
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, 0], s: [60, 60, 1], c: '#12122a', recv: true, m: { r: 0.9, m: 0 } },
    { id: 'plato', k: 'cyl', p: [0, -0.12, 0], s: [9.5, 0.24, 9.5], c: '#23285a', e: 0.1, recv: true, m: { r: 0.5, m: 0.2 } },
    { id: 'plato-neon', k: 'cyl', p: [0, -0.01, 0], s: [9.8, 0.03, 9.8], c: '#ff8ad8', e: 1 },
  ];
  st.stack.forEach((b, i) => {
    const y = i * TS_H + TS_H / 2;
    if (Math.abs(y - st.camY) > 14) return;
    const perfectGlow = st.glow && i === n - 1 ? 0.35 : 0.05;
    objs.push({ id: `b${i}`, k: 'box', p: [b.x, y, b.z], s: [b.sx, TS_H * 0.94, b.sz], c: `hsl(${b.hue},78%,54%)`, e: perfectGlow, sh: true, m: { r: 0.32, m: 0.12 } });
  });
  if (st.cur) {
    const cur = st.cur, prev = st.stack[n - 1], A = cur.axis, B = other(A);
    const c = { x: 0, z: 0 };
    c[A] = cur.p; c[B] = prev[B];
    objs.push({ id: 'cur', k: 'box', p: [c.x, n * TS_H + TS_H / 2, c.z], s: [prev.sx, TS_H * 0.94, prev.sz], c: `hsl(${cur.hue},82%,60%)`, e: 0.2, sh: true, m: { r: 0.25, m: 0.2 } });
  }
  st.debris.forEach(d => objs.push({ id: `d${d.id}`, k: 'box', p: [d.x, d.y, d.z], s: [d.sx, TS_H * 0.94, d.sz], c: `hsl(${d.hue},78%,54%)`, e: 0.05, m: { r: 0.32, m: 0.12 } }));
  return {
    sky: { top, bottom: low, sun: true, sunC: '#fff2d0', clouds: 6, cloud: '#ffffff' },
    fog: { c: low, near: 26, far: 60 },
    light: { dir: [-0.45, 0.75, 0.4], sun: '#fff1d8', i: 2.5, sky: '#e4e2ff', ground: '#24203a', hi: 1.4 },
    shadowR: 14, statics: CITY, objs,
    lights: [{ p: [0, st.camY + 3, 0], c: '#ffd9a0', i: 5, d: 10 }],
    cam: { p: [7.5, st.camY + 5.0, 10.5], l: [0, st.camY + 0.6, 0], fov: 70 },
  };
}

// skyline lejano (fijo)
const CITY = (() => {
  const out = [];
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.2, d = 24 + rnd() * 10, h = 3 + rnd() * 11, w = 1.6 + rnd() * 1.6;
    out.push({ inst: 'edificio', k: 'box', p: [Math.cos(a) * d, h / 2 - 0.2, Math.sin(a) * d], s: [w, h, w], c: '#1d1f40', recv: true, m: { r: 0.8, m: 0 } });
  }
  return out;
})();

export function TowerStack3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('towerstack');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); g.current.cur = newCur(g.current); setPhase('play'); hx.tap(); };
  const dropPiece = (s, A, c, size, hue, centerY) => {
    const d = { id: uid(), x: 0, z: 0, sx: 0, sz: 0, y: centerY, vy: 0, vx: 0, vz: 0, hue };
    const B = other(A);
    d[A] = c; d[B] = topOf(s)[B]; d[SZ[A]] = size; d[SZ[B]] = topOf(s)[SZ[B]];
    d.vx = A === 'x' ? (c < 0 ? -1.5 : 1.5) : 0;
    d.vz = A === 'z' ? (c < 0 ? -1.5 : 1.5) : 0;
    d.vy = 0.5;
    s.debris.push(d);
  };
  const drop = () => {
    const s = g.current;
    if (phase !== 'play' || !s.cur) return;
    const prev = topOf(s), cur = s.cur, A = cur.axis, B = other(A);
    const w = prev[SZ[A]];
    const cLo = cur.p - w / 2, cHi = cur.p + w / 2;
    const pLo = prev[A] - w / 2, pHi = prev[A] + w / 2;
    const lo = Math.max(cLo, pLo), hi = Math.min(cHi, pHi), ov = hi - lo;
    const k = s.stack.length, yC = k * TS_H + TS_H / 2;
    if (ov <= 0) {
      // se cae el bloque entero
      s.debris.push({ id: uid(), x: A === 'x' ? cur.p : prev.x, z: A === 'z' ? cur.p : prev.z, sx: prev.sx, sz: prev.sz, y: yC, vy: 0, vx: 0, vz: 0, hue: cur.hue });
      burst3d([A === 'x' ? cur.p : prev.x, yC, A === 'z' ? cur.p : prev.z], ['#ff4d6d', '#ffd0d8'], 26, { speed: 5, up: 3, g: 10, size: 0.13, life: 0.8 });
      fx.shake(8, 0.3); fx.flash(C.red, 0.25); hx.die();
      setRes({ isNew: submitBest(s.score) });
      setPhase('over');
      return;
    }
    let nc, nw;
    if (Math.abs(cur.p - prev[A]) < TS_PERFECT) {
      nc = prev[A]; nw = Math.min(TS_BASE, w + (s.perfect + 1 >= 3 ? 0.15 : 0));
      s.perfect += 1; s.maxPerfect = Math.max(s.maxPerfect, s.perfect);
      s.score += 2 + s.perfect;
      fx.ring(SCREEN_CX, SCREEN_CY * 0.9, C.lime, 90); fx.pop(SCREEN_CX, SCREEN_CY * 0.76, s.perfect > 1 ? `¡PERFECTO ×${s.perfect}!` : '¡PERFECTO!', C.lime, 18); hx.good();
      ring3d([prev.x, yC + 0.1, prev.z], C.lime, 34, { speed: 5, life: 0.6, size: 0.14 });
      burst3d([prev.x, yC, prev.z], ['#7dff6b', '#ffffff', '#ffd54a'], 18, { speed: 4, up: 2.5, g: 9, size: 0.13, life: 0.7 });
    } else {
      s.perfect = 0; s.score += 1;
      nc = (lo + hi) / 2; nw = ov;
      if (lo - cLo > 0.01) dropPiece(s, A, (cLo + lo) / 2, lo - cLo, cur.hue, yC);
      if (cHi - hi > 0.01) dropPiece(s, A, (hi + cHi) / 2, cHi - hi, cur.hue, yC);
      hx.hit();
    }
    const nb = { x: 0, z: 0, sx: prev.sx, sz: prev.sz, hue: cur.hue };
    nb[A] = nc; nb[B] = prev[B]; nb[SZ[A]] = nw;
    s.stack.push(nb);
    s.glowT = 0.35;
    s.speed = Math.min(11, 4.6 + s.stack.length * 0.13);
    s.cur = newCur(s);
  };

  useLoop(phase !== 'ready', dt => {
    const s = g.current;
    s.t += dt;
    s.camY += (Math.max(0, s.stack.length * TS_H - 3.2) - s.camY) * Math.min(1, dt * 3);
    s.debris.forEach(d => { d.vy -= TS_GRAV * dt; d.y += d.vy * dt; d.x += d.vx * dt; d.z += d.vz * dt; });
    s.debris = s.debris.filter(d => d.y > s.camY - 14);
    if (s.glowT > 0) s.glowT -= dt;
    if (phase !== 'play' || !s.cur) return;
    const cur = s.cur, prev = topOf(s), w = prev[SZ[cur.axis]];
    cur.p += cur.dir * s.speed * dt;
    const lo = -TS_R + w / 2, hi = TS_R - w / 2;
    if (cur.p > hi) { cur.p = hi; cur.dir = -1; }
    if (cur.p < lo) { cur.p = lo; cur.dir = 1; }
  });

  const pan = usePan(fx, { down: drop });
  const s = g.current;
  const st = phase === 'ready' ? { stack: DEMO, camY: 1.6, debris: [], cur: null } : { stack: s.stack, camY: s.camY, debris: s.debris, cur: phase === 'play' ? s.cur : null, glow: s.glowT > 0 };
  const scene = buildScene(st);
  const n = s.stack.length;
  const menuSt = { stack: DEMO, camY: 1.6, debris: [], cur: null };
  return (
    <Game3D title="TOWER STACK" emoji="🏗️" accent={C.amber} onExit={onExit} score={s.score} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene} menuScene={() => buildScene(menuSt)}
      orbit={{ r: 11, h: 4, speed: 0.2, ly: 0.8, drop: 1.6 }}
      hud={<>
        <HudPill icon="🏗️" label="PISOS" value={n - 1} color={C.amber} />
        {s.perfect > 1 ? <Combo n={s.perfect} color={C.lime} /> : <HudPill icon="🎯" value="3 perfectos = ancho" color={C.dim} />}
      </>}
      subtitle="Apila hasta el cielo"
      lines={['Toca para soltar el bloque en movimiento', 'Lo que sobresale se corta y cae', 'Los encajes perfectos dan bonus y devuelven ancho']}
      result={{ title: 'SE DERRUMBÓ', emoji: '🏗️', subtitle: `${n - 1} ${n - 1 === 1 ? 'piso' : 'pisos'} · mejor racha perfecta ${s.maxPerfect}`, isNew: res.isNew, stats: [['PISOS', n - 1], ['RACHA', s.maxPerfect]] }} />
  );
}
