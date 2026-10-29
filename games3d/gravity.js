import React, { useRef, useState } from 'react';
import { C, SCREEN_H, SCREEN_W, hx, rand, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { gem, person } from '../utils/prefabs';

// GRAVITY FLIP 3D: un pasillo de neón con suelo y techo. El personaje corre en el sitio y el mundo avanza hacia él.
// Tocar invierte la gravedad: cae al techo o al suelo. Esquiva púas y bloques, recoge las esferas doradas.
const HC = 10, PS = 0.7, PXW = -1.9;     // alto del pasillo, tamaño del personaje (1.75 · PN) y su x fija
const PN = PS / 1.75;                    // escala de la persona para medir PS de alto
const G = 82, FLIP_V = 2.3;              // gravedad y empuje al girar (unidades/s)
const PI = Math.PI;

const STATIC_CORR = [
  { id: 'suelo', k: 'pla', p: [0, 0, 0], s: [60, 30, 1], c: '#0c0620', recv: true },
  { id: 'techo', k: 'pla', p: [0, HC, 0], s: [60, 30, 1], c: '#0c0620', r: [PI / 2, 0, 0] },
  { id: 'fondo', k: 'box', p: [0, HC / 2, -5], s: [60, HC, 0.2], c: '#1f1446', e: 0.22 },
  { id: 'linea-s', k: 'box', p: [0, 0.05, 0], s: [60, 0.1, 0.12], c: C.violet, e: 0.9 },
  { id: 'linea-t', k: 'box', p: [0, HC - 0.05, 0], s: [60, 0.1, 0.12], c: C.violet, e: 0.9 },
];

const initState = () => ({
  y: 0, vy: 0, dir: 1, rot: 0, t: 0, dist: 0, speed: 5.5, obs: [], orbs: [], next: 1.0, scroll: 0, flips: 0, bonus: 0,
  camY: HC / 2, trailT: 0,
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

// Escena (juego y menús)
function buildScene(s, t) {
  const objs = [];
  // rejilla de neón del suelo y del techo, pilares del fondo: avanzan con el scroll (inst)
  for (let i = 0; i < 12; i++) {
    const x = ((i * 2.5 - s.scroll) % 30 + 30) % 30 - 15;
    objs.push({ k: 'box', inst: 'rejilla', p: [x, 0.01, -2], s: [0.05, 0.02, 24], c: C.violet, e: 0.7 });
    objs.push({ k: 'box', inst: 'rejilla', p: [x, HC - 0.01, -2], s: [0.05, 0.02, 24], c: C.violet, e: 0.7 });
  }
  for (let i = 0; i < 8; i++) {
    const x = ((i * 4 - s.scroll * 0.4) % 32 + 32) % 32 - 16;
    objs.push({ k: 'box', inst: 'pilar', p: [x, HC / 2, -4.5], s: [0.3, HC, 0.3], c: C.violet, e: 0.45, o: 0.6 });
  }
  // obstáculos (inst)
  for (const o of s.obs) {
    const up = o.side === 1;
    if (o.k === 'block') objs.push({ k: 'box', inst: 'bloque', p: [o.x + o.w / 2, up ? o.h / 2 : HC - o.h / 2, 0], s: [o.w, o.h, 1.2], c: C.pink, e: 0.6 });
    else {
      const n = Math.max(1, Math.round(o.w / 0.45)), tw = o.w / n;
      for (let k = 0; k < n; k++) objs.push({ k: 'cone', inst: 'pincho', p: [o.x + (k + 0.5) * tw, up ? o.h / 2 : HC - o.h / 2, 0], s: [tw * 0.9, o.h, tw * 0.9], r: up ? undefined : [PI, 0, 0], c: C.pink, e: 0.7 });
    }
  }
  for (const o of s.orbs) if (!o.got) objs.push(...gem(`or${o.id}`, [o.x, o.y - 0.4, 0], { c: C.amber, t }));
  // personaje: centro en (PXW, y + PS/2); gira a su alrededor (roll = s.rot)
  const d = PS / 2, cy = s.y + PS / 2, a = s.rot;
  const fx0 = PXW + Math.sin(a) * d, fy0 = cy - Math.cos(a) * d;
  objs.push(...person('yo', [fx0, fy0, 0], { yaw: 0, roll: a, n: PN, t, walk: s.vy === 0 ? 1 : 0.2, hat: 'helmet', band: '#22e6ff', shirt: '#22e6ff', pants: '#2a1458', skin: '#f0c09a', hair: '#1a1030', arms: s.vy !== 0 ? 2.9 : 1.4 }));
  return {
    bg: '#07041a', fog: { c: '#07041a', near: 16, far: 42 },
    light: { dir: [-0.2, 0.9, 0.4], sun: '#d8c8ff', i: 1.4, sky: '#6f5cff', ground: '#1a1040', hi: 1.2 },
    statics: STATIC_CORR,
    lights: [{ p: [PXW + 1.2, cy, 2.5], c: C.violet, i: 7, d: 8 }],
    objs,
    cam: { p: [0, s.camY, 12], l: [0, s.camY, 0], fov: 56 },
  };
}

export function GravityFlip3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('gravity');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const flip = () => {
    const s = g.current;
    if (phase !== 'play') return;
    s.dir *= -1; s.vy = -s.dir * FLIP_V; s.flips += 1;
    ring3d([PXW, s.y + PS / 2, 0.2], C.violet, 22, { speed: 4.5, life: 0.45 });
    burst3d([PXW, s.y + PS / 2, 0.2], C.violet, 10, { speed: 3, life: 0.4, size: 0.15 });
    hx.tap();
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
    // el personaje se da la vuelta suavemente al cambiar de gravedad
    s.rot += ((s.dir === 1 ? 0 : PI) - s.rot) * Math.min(1, dt * 14);
    s.trailT -= dt;
    if (s.trailT <= 0) { s.trailT = 0.035; burst3d([PXW - 0.2, s.y + PS / 2, 0.1], C.violet, 1, { speed: 0.5, life: 0.35, size: 0.1, g: 0, drag: 2 }); }
    s.camY += (HC / 2 + ((s.y + PS / 2) - HC / 2) * 0.35 - s.camY) * Math.min(1, dt * 4);
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
        burst3d([PXW, s.y + PS / 2, 0.2], [C.violet, C.pink, '#ffffff'], 30, { speed: 6, up: 1, size: 0.18, life: 0.9 });
        fx.shake(11, 0.4); fx.flash(C.red, 0.3); hx.die();
        setRes({ isNew: submitBest(Math.floor(s.dist) + s.bonus) });
        setPhase('over');
        return;
      }
    }
    for (const o of s.orbs) {
      if (!o.got && Math.hypot(o.x - PXW, o.y - (s.y + PS / 2)) < 0.6) {
        o.got = true; s.bonus += 10;
        burst3d([o.x, o.y, 0], ['#ffc233', '#fff3b0'], 16, { speed: 4, size: 0.16, life: 0.6 });
        fx.pop(SCREEN_W / 2, SCREEN_H * 0.45, '+10', C.amber, 15); hx.good();
      }
    }
  });

  const pan = usePan(fx, { down: flip });
  const s = g.current;
  const score = Math.floor(s.dist) + s.bonus;
  const scene = buildScene(s, s.t);
  const menu = t => buildScene(g.current, t);

  return (
    <Game3D title="GRAVITY FLIP" emoji="🔀" accent={C.violet} onExit={onExit} score={score} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene} menuScene={menu} orbit={{ c: [PXW, HC / 2, 0], r: 6, h: 1.6, speed: 0.25, ly: 0.8, drop: 2.6 }}
      hud={<><HudPill icon="🔀" value={s.flips} label="GIROS" color={C.violet} /><HudPill icon="⚡" value={`${Math.round(s.speed * 5)}`} color={C.cyan} /></>}
      subtitle="Invierte la gravedad para sobrevivir"
      lines={['Toca para cambiar entre suelo y techo', 'Esquiva púas y bloques', 'Las esferas doradas dan +10']}
      result={{ isNew: res.isNew, title: 'APLASTADO', emoji: '🔀', subtitle: `${Math.floor(s.dist)} m · ${s.flips} giros`, stats: [['METROS', Math.floor(s.dist)], ['GIROS', s.flips]] }}>
    </Game3D>
  );
}
