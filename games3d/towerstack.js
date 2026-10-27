import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, Combo, GameScreen, Overlay, PlayArea, alpha, hx, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Tercera persona: bloques cuadrados que se apilan en una torre 3D. Cada capa se desplaza en X o en Z
// (alternando) y al tocar se queda la parte que cae encima; la cámara sube con la torre.
const TS_H = 0.5, TS_BASE = 3.4, TS_R = 4.8, TS_PERFECT = 0.12, TS_GRAV = 26;
const SZ = { x: 'sx', z: 'sz' };
const other = a => (a === 'x' ? 'z' : 'x');
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

export function TowerStack3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('towerstack');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); g.current.cur = newCur(g.current); setPhase('play'); };
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
      fx.ring(AREA_W / 2, AREA_H * 0.45, C.lime, 90); fx.pop(AREA_W / 2, AREA_H * 0.38, s.perfect > 1 ? `¡PERFECTO ×${s.perfect}!` : '¡PERFECTO!', C.lime, 18); hx.good();
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
    s.speed = Math.min(11, 4.6 + s.stack.length * 0.13);
    s.cur = newCur(s);
  };

  useLoop(phase !== 'ready', dt => {
    const s = g.current;
    s.t += dt;
    s.camY += (Math.max(0, s.stack.length * TS_H - 3.2) - s.camY) * Math.min(1, dt * 3);
    s.debris.forEach(d => { d.vy -= TS_GRAV * dt; d.y += d.vy * dt; d.x += d.vx * dt; d.z += d.vz * dt; });
    s.debris = s.debris.filter(d => d.y > s.camY - 14);
    if (phase !== 'play' || !s.cur) return;
    const cur = s.cur, prev = topOf(s), w = prev[SZ[cur.axis]];
    cur.p += cur.dir * s.speed * dt;
    const lo = -TS_R + w / 2, hi = TS_R - w / 2;
    if (cur.p > hi) { cur.p = hi; cur.dir = -1; }
    if (cur.p < lo) { cur.p = lo; cur.dir = 1; }
  });

  const pan = usePan(fx, { down: drop });
  const s = g.current;
  const n = s.stack.length;
  const objs = [{ id: 'suelo', k: 'pla', p: [0, 0, 0], s: [40, 40, 1], c: '#12122a' }];
  s.stack.forEach((b, i) => {
    const y = i * TS_H + TS_H / 2;
    if (Math.abs(y - s.camY) > 14) return;
    objs.push({ id: `b${i}`, k: 'box', p: [b.x, y, b.z], s: [b.sx, TS_H * 0.94, b.sz], c: `hsl(${b.hue},80%,52%)`, e: 0.05 });
  });
  if (phase === 'play' && s.cur) {
    const cur = s.cur, prev = topOf(s), A = cur.axis, B = other(A);
    const c = { x: 0, z: 0 };
    c[A] = cur.p; c[B] = prev[B];
    objs.push({ id: 'cur', k: 'box', p: [c.x, n * TS_H + TS_H / 2, c.z], s: [prev.sx, TS_H * 0.94, prev.sz], c: `hsl(${cur.hue},80%,58%)`, e: 0.12 });
  }
  s.debris.forEach(d => objs.push({ id: `d${d.id}`, k: 'box', p: [d.x, d.y, d.z], s: [d.sx, TS_H * 0.94, d.sz], c: `hsl(${d.hue},80%,52%)`, e: 0.05 }));

  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.05 : 0;
  const scene = {
    bg: '#07071a', fog: { c: '#07071a', near: 22, far: 52 }, objs,
    cam: { p: [6 + (Math.random() - 0.5) * shake, s.camY + 4.4, 9.2], l: [0, s.camY + 0.2, 0], fov: 56 },
  };

  return (
    <GameScreen title="TOWER STACK" emoji="🏗️" accent={C.amber} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Pisos <Text style={{ color: C.amber, fontWeight: '800' }}>{n - 1}</Text></Text>{s.perfect > 1 ? <Combo n={s.perfect} color={C.lime} /> : <Text style={{ color: C.dim, fontSize: 12 }}>3 perfectos recuperan ancho</Text>}</>}>
      <PlayArea fx={fx} bg="#07071a" border={alpha(C.amber, 0.35)} {...pan}>
        <World3D scene={scene} />
        <Overlay show={phase !== 'play'} kind={phase} emoji="🏗️" title={phase === 'over' ? 'SE DERRUMBÓ' : 'TOWER STACK'}
          subtitle={phase === 'over' ? `${n - 1} ${n - 1 === 1 ? 'piso' : 'pisos'} · mejor racha perfecta ${s.maxPerfect}` : 'Apila hasta el cielo'}
          score={s.score} best={best} isNew={res.isNew} accent={C.amber} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca para soltar el bloque', 'Lo que sobresale se corta y cae', 'Los encajes perfectos dan bonus y devuelven ancho'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
