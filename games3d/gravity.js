import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, hx, rand, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

// GRAVITY FLIP 3D: un pasillo 3D con suelo y techo. El personaje corre hacia la izquierda de la pantalla
// (el mundo avanza hacia él) y tocar invierte la gravedad. Cámara lateral: se ve el pasillo en profundidad.
const HC = 10, PS = 0.6, PXW = -1.9;     // alto del pasillo, tamaño del personaje y su x fija
const G = 82, FLIP_V = 2.3;              // gravedad y empuje al girar (unidades/s)
const CAM = { p: [0, HC / 2, 12], l: [0, HC / 2, 0], fov: 56 };

// Proyecta un punto 3D a píxeles del PlayArea con la misma cámara del motor (para efectos 2D).
const sproj = (c, x, y, z) => {
  const [cx, cy, cz] = c.p;
  let fx0 = c.l[0] - cx, fy0 = c.l[1] - cy, fz0 = c.l[2] - cz;
  const fl = Math.hypot(fx0, fy0, fz0); fx0 /= fl; fy0 /= fl; fz0 /= fl;
  let rx = -fz0, rz = fx0; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = -rz * fy0, uy = rz * fx0 - rx * fz0, uz = rx * fy0;
  const dx = x - cx, dy = y - cy, dz = z - cz;
  const zc = dx * fx0 + dy * fy0 + dz * fz0;
  const xc = dx * rx + dz * rz, yc = dx * ux + dy * uy + dz * uz;
  const t = Math.tan(c.fov * Math.PI / 360);
  return [(xc / (zc * t * (AREA_W / AREA_H)) + 1) / 2 * AREA_W, (1 - yc / (zc * t)) / 2 * AREA_H];
};

const initState = () => ({
  y: 0, vy: 0, dir: 1, t: 0, dist: 0, speed: 5.5, obs: [], orbs: [], next: 1.0, scroll: 0, flips: 0, bonus: 0, trail: [],
});

// Patrones de obstáculos (púas en suelo/techo y bloques), igual que en la versión 2D
const addPattern = s => {
  const x = 5.2;
  const r = Math.random();
  const pw = rand(0.5, 0.82);
  if (r < 0.28) s.obs.push({ id: uid(), k: 'spike', side: 1, x, w: pw * (1 + Math.floor(Math.random() * 2)), h: 0.6 });
  else if (r < 0.52) s.obs.push({ id: uid(), k: 'spike', side: -1, x, w: pw * (1 + Math.floor(Math.random() * 2)), h: 0.6 });
  else if (r < 0.74) { const side = Math.random() < 0.5 ? 1 : -1; s.obs.push({ id: uid(), k: 'block', side, x, w: rand(0.55, 0.8), h: rand(1.8, 3.6) }); }
  else if (r < 0.9) { s.obs.push({ id: uid(), k: 'spike', side: 1, x, w: 1.2, h: 0.6 }); s.obs.push({ id: uid(), k: 'spike', side: -1, x: x + 2.9, w: 1.2, h: 0.6 }); }
  else { const side = Math.random() < 0.5 ? 1 : -1; s.obs.push({ id: uid(), k: 'block', side, x, w: 0.6, h: 2.9 }); s.obs.push({ id: uid(), k: 'block', side: -side, x: x + 3.3, w: 0.6, h: 2.9 }); }
  if (Math.random() < 0.55) s.orbs.push({ id: uid(), x: x + rand(0.8, 2.3), y: rand(1.2, HC - 1.2), got: false });
};

export function GravityFlip3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('gravity');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const flip = () => {
    const s = g.current;
    if (phase !== 'play') return;
    s.dir *= -1; s.vy = -s.dir * FLIP_V; s.flips += 1;
    const [sx, sy] = sproj(CAM, PXW, s.y + PS / 2, 0); fx.ring(sx, sy, C.violet, 36); hx.tap();
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.speed = Math.min(10.9, 5.5 + s.t * 0.12);
    s.dist += s.speed * dt * 2.5;
    s.scroll += s.speed * dt;
    // gravedad: dir = 1 cae al suelo, dir = -1 cae al techo
    s.vy += -s.dir * G * dt;
    s.y += s.vy * dt;
    if (s.y <= 0) { s.y = 0; s.vy = 0; }
    if (s.y >= HC - PS) { s.y = HC - PS; s.vy = 0; }
    s.trail.push({ x: PXW, y: s.y, a: 0.5 });
    s.trail.forEach(p => { p.x -= s.speed * dt; p.a -= dt * 2.2; });
    s.trail = s.trail.filter(p => p.a > 0);
    s.next -= dt;
    if (s.next <= 0) { addPattern(s); s.next = Math.max(0.55, 1.35 - s.t * 0.012) * (5.5 / s.speed) + 0.35; }
    s.obs.forEach(o => { o.x -= s.speed * dt; });
    s.orbs.forEach(o => { o.x -= s.speed * dt; });
    s.obs = s.obs.filter(o => o.x > -6);
    s.orbs = s.orbs.filter(o => o.x > -6);
    // choque con púas y bloques (caja del personaje contra caja del obstáculo)
    const me = { x0: PXW - PS / 2, x1: PXW + PS / 2, y0: s.y, y1: s.y + PS };
    for (const o of s.obs) {
      const up = o.side === 1;
      const box = o.k === 'spike'
        ? { x0: o.x + 0.12, x1: o.x + o.w - 0.12, y0: up ? 0 : HC - o.h * 0.8, y1: up ? o.h * 0.8 : HC }
        : { x0: o.x, x1: o.x + o.w, y0: up ? 0 : HC - o.h, y1: up ? o.h : HC };
      if (me.x0 < box.x1 && me.x1 > box.x0 && me.y0 < box.y1 && me.y1 > box.y0) {
        const [sx, sy] = sproj(CAM, PXW, s.y + PS / 2, 0);
        fx.burst(sx, sy, C.violet, 26, 280, 0.8, 6); fx.shake(11, 0.4); fx.flash(C.red, 0.3); hx.die();
        setRes({ isNew: submitBest(Math.floor(s.dist) + s.bonus) });
        setPhase('over');
        return;
      }
    }
    for (const o of s.orbs) {
      if (!o.got && Math.hypot(o.x - PXW, o.y - (s.y + PS / 2)) < 0.6) {
        o.got = true; s.bonus += 10;
        const [sx, sy] = sproj(CAM, o.x, o.y, 0); fx.burst(sx, sy, C.amber, 10, 170); fx.pop(sx, sy - 14, '+10', C.amber, 15); hx.good();
      }
    }
  });

  const pan = usePan(fx, { down: flip });
  const s = g.current;
  const score = Math.floor(s.dist) + s.bonus;
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, 0], s: [60, 30, 1], c: '#0c0620' },
    { id: 'techo', k: 'pla', p: [0, HC, 0], s: [60, 30, 1], c: '#0c0620', r: [Math.PI / 2, 0, 0] },
    { id: 'fondo', k: 'box', p: [0, HC / 2, -5], s: [60, HC, 0.2], c: '#120a2c' },
    { id: 'linea-s', k: 'box', p: [0, 0.05, 0], s: [60, 0.1, 0.12], c: C.violet, e: 0.9 },
    { id: 'linea-t', k: 'box', p: [0, HC - 0.05, 0], s: [60, 0.1, 0.12], c: C.violet, e: 0.9 },
    ...Array.from({ length: 12 }, (_, i) => {
      const x = ((i * 2.5 - s.scroll) % 30 + 30) % 30 - 15;
      return { id: `gl${i}`, k: 'box', p: [x, 0.01, -2], s: [0.05, 0.02, 24], c: C.violet, e: 0.6, o: 0.5 };
    }),
    ...Array.from({ length: 8 }, (_, i) => {
      const x = ((i * 4 - s.scroll * 0.4) % 32 + 32) % 32 - 16;
      return { id: `rb${i}`, k: 'box', p: [x, HC / 2, -4.5], s: [0.3, HC, 0.3], c: C.violet, e: 0.4, o: 0.6 };
    }),
    ...s.orbs.filter(o => !o.got).map(o => ({ id: `or${o.id}`, k: 'sph', p: [o.x, o.y, 0], n: 0.45, c: C.amber, e: 0.9 })),
    ...s.obs.flatMap(o => {
      const up = o.side === 1;
      if (o.k === 'block') return [{ id: `ob${o.id}`, k: 'box', p: [o.x + o.w / 2, up ? o.h / 2 : HC - o.h / 2, 0], s: [o.w, o.h, 1.2], c: C.pink, e: 0.7 }];
      const n = Math.max(1, Math.round(o.w / 0.45)); const tw = o.w / n;
      return Array.from({ length: n }, (_, k) => ({
        id: `ob${o.id}-${k}`, k: 'cone', p: [o.x + (k + 0.5) * tw, up ? o.h / 2 : HC - o.h / 2, 0], s: [tw * 0.9, o.h, tw * 0.9],
        r: up ? undefined : [Math.PI, 0, 0], c: C.pink, e: 0.7,
      }));
    }),
    ...s.trail.map((p, i) => ({ id: `tr${i}`, k: 'box', p: [p.x, p.y + PS / 2, 0], s: [PS, PS, PS * 0.8], c: C.violet, e: 0.5, o: Math.max(0, p.a * 0.5) })),
    { id: 'personaje', k: 'box', p: [PXW, s.y + PS / 2, 0], s: [PS, PS, PS * 0.8], c: C.cyan, e: 0.7 },
    { id: 'visor', k: 'box', p: [PXW + 0.1, s.y + PS / 2 + (s.dir === 1 ? 0.12 : -0.12), 0.42], s: [PS * 0.6, 0.1, 0.05], c: '#04040c', e: 0 },
  ];
  const scene = {
    bg: '#07041a', fog: { c: '#07041a', near: 16, far: 40 }, objs,
    cam: { p: CAM.p, l: CAM.l, fov: CAM.fov },
  };
  return (
    <GameScreen title="GRAVITY FLIP" emoji="🔀" accent={C.violet} onExit={onExit} score={score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Giros: <Text style={{ color: C.violet, fontWeight: '800' }}>{s.flips}</Text></Text><Text style={{ color: C.dim, fontSize: 12 }}>Vel. {Math.round(s.speed * 5)}</Text></>}>
      <PlayArea fx={fx} bg="#07041a" {...pan}>
        <World3D scene={scene} />
        <Overlay show={phase !== 'play'} kind={phase} emoji="🔀" title={phase === 'over' ? 'APLASTADO' : 'GRAVITY FLIP 3D'}
          subtitle={phase === 'over' ? `${Math.floor(s.dist)} m · ${s.flips} giros` : 'Invierte la gravedad para sobrevivir'}
          score={score} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca para cambiar entre suelo y techo', 'Esquiva púas y bloques', 'Las esferas doradas dan +10'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
