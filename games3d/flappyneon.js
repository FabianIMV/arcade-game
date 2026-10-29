import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { C, SCREEN_H, SCREEN_W, alpha, hx, rand, tglow, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D } from '../utils/ui3d';
import { gem, shade } from '../utils/prefabs';

// FLAPPY NEON 3D – vuelo en TERCERA PERSONA. Récord: 'flappy'.
// El pájaro está en x=0, z=0 y la cámara detrás. Los tubos (muros con hueco) vienen desde el fondo:
// hay que atravesar el hueco de cada uno. Toca para aletear. ⭐ monedas dan +2.
const FN_FAR = -60;           // profundidad de aparición de los tubos
const FN_G = 28;              // gravedad (u/s²)
const FN_FLAP = 8.2;          // impulso al aletear hacia arriba (u/s)
const FN_GROUND = 0.7;        // altura del suelo
const FN_TOP = 12;            // techo del mundo
const FN_BR = 0.45;           // radio del pájaro
const FN_TW = 9;              // ancho de cada tubo (x)
const FN_TD = 1.2;            // grosor de cada tubo (z)

const cyOf = (p, t) => (p.moving ? p.gapY + Math.sin(t * 1.8 + p.ph) * 0.6 : p.gapY);

const addPipe = (s, z) => {
  const gap = Math.max(2.4, 3.1 - s.score * 0.03);
  const moving = s.score >= 8 && Math.random() < 0.5;
  s.pipes.push({
    id: uid(), z, gap, gapY: rand(gap / 2 + FN_GROUND + 0.9, FN_TOP - gap / 2 - 0.9), moving,
    ph: Math.random() * 6, passed: false, coin: Math.random() < 0.55, got: false,
  });
};

// Tubo: dos muros con cuerpo de neón y bordes blancos brillantes alrededor del hueco
const pipeObjs = (p, cy) => {
  const col = p.moving ? C.pink : C.cyan, lit = shade(col, 1.35);
  const bh = cy - p.gap / 2 - FN_GROUND;      // tubo inferior: del suelo al hueco
  const th = FN_TOP - (cy + p.gap / 2);       // tubo superior: del hueco al techo
  return [
    { id: `pb${p.id}`, k: 'box', p: [0, FN_GROUND + bh / 2, p.z], s: [FN_TW, bh, FN_TD], c: col, e: 0.8, m: { r: 0.4, m: 0.2 }, sh: true },
    { id: `pt${p.id}`, k: 'box', p: [0, cy + p.gap / 2 + th / 2, p.z], s: [FN_TW, th, FN_TD], c: col, e: 0.8, m: { r: 0.4, m: 0.2 }, sh: true },
    { id: `pl${p.id}`, k: 'box', p: [0, cy - p.gap / 2, p.z], s: [FN_TW + 0.3, 0.3, FN_TD + 0.3], c: lit, e: 1 },
    { id: `ph${p.id}`, k: 'box', p: [0, cy + p.gap / 2, p.z], s: [FN_TW + 0.3, 0.3, FN_TD + 0.3], c: lit, e: 1 },
  ];
};

// Pájaro de neón: cuerpo, alas que aletean, cola, pico y ojos. Frente = -Z.
const birdObjs = (y, t, flapping) => {
  const flapA = Math.sin(t * 22) * 0.6 * (flapping ? 1 : 0.4);
  return [
    { id: 'fn-cuerpo', k: 'sph', p: [0, y, 0], s: [0.95, 0.85, 1.1], c: C.amber, e: 0.22, sh: true },
    { id: 'fn-ala-i', k: 'box', p: [-0.45, y + 0.05, 0.1], s: [0.85, 0.08, 0.45], r: [0, 0, flapA], c: C.orange, e: 0.45 },
    { id: 'fn-ala-d', k: 'box', p: [0.45, y + 0.05, 0.1], s: [0.85, 0.08, 0.45], r: [0, 0, -flapA], c: C.orange, e: 0.45 },
    { id: 'fn-cola', k: 'box', p: [0, y + 0.02, 0.85], s: [0.62, 0.1, 0.42], r: [0, 0, 0], c: C.pink, e: 0.7 },
    { id: 'fn-pico', k: 'cone', p: [0, y - 0.05, -0.72], s: [0.34, 0.55, 0.34], r: [-Math.PI / 2, 0, 0], c: C.orange, e: 0.6 },
    { id: 'fn-ojo-i', k: 'sph', p: [-0.22, y + 0.2, -0.42], n: 0.16, c: '#ffffff', e: 1, sh: false },
    { id: 'fn-ojo-d', k: 'sph', p: [0.22, y + 0.2, -0.42], n: 0.16, c: '#ffffff', e: 1, sh: false },
    { id: 'fn-pupila-i', k: 'sph', p: [-0.22, y + 0.2, -0.56], n: 0.08, c: '#14141f', sh: false },
    { id: 'fn-pupila-d', k: 'sph', p: [0.22, y + 0.2, -0.56], n: 0.08, c: '#14141f', sh: false },
  ];
};

const initState = () => ({ y: 5.5, vy: 0, t: 0, pipes: [], next: 10, score: 0, coins: 0, scroll: 0, zs: 7, camY: 5.5, flapT: 0, over: false });

export function FlappyNeon3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('flappy');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, medal: '', coins: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => {
    fx.clear();
    clear3d();
    const s = initState();
    addPipe(s, -24);
    g.current = s;
    s.vy = FN_FLAP;
    setPhase('play');
  };

  const flap = () => {
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    s.vy = FN_FLAP; s.flapT = 0.25;
    burst3d([0, s.y - 0.2, 0.5], [C.amber, C.orange], 6, { speed: 2.4, size: 0.12, life: 0.4, g: 3, up: -1 });
    hx.tap();
  };

  const crash = s => {
    if (s.over) return;
    s.over = true;
    burst3d([0, s.y, 0], [C.amber, '#ffffff', C.orange], 46, { speed: 10, size: 0.26, life: 1.1, g: 8 });
    ring3d([0, s.y, 0], C.amber, 26, { speed: 7, life: 0.6 });
    fx.shake(10, 0.35); fx.flash('#ffffff', 0.35); hx.die();
    const medal = s.score >= 40 ? '🥇' : s.score >= 20 ? '🥈' : s.score >= 10 ? '🥉' : '';
    setRes({ isNew: submitBest(s.score), medal, coins: s.coins });
    setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    s.t += dt;
    s.flapT = Math.max(0, s.flapT - dt);
    s.zs = Math.min(12, 7 + s.score * 0.15);          // velocidad de acercamiento de los tubos
    s.scroll += s.zs * dt;
    s.vy -= FN_G * dt;
    s.y += s.vy * dt;
    s.camY += (s.y * 0.45 + 2.0 - s.camY) * Math.min(1, dt * 5);   // cámara suave que sigue al pájaro
    s.next -= s.zs * dt;
    if (s.next <= 0) { addPipe(s, FN_FAR); s.next = rand(9.5, 11); }
    s.pipes.forEach(p => { p.z += s.zs * dt; });
    s.pipes = s.pipes.filter(p => p.z < 4);
    if (s.y > FN_TOP - FN_BR) { s.y = FN_TOP - FN_BR; if (s.vy > 0) s.vy = 0; }
    if (s.y - FN_BR < FN_GROUND) { crash(s); return; }
    for (const p of s.pipes) {
      const cy = cyOf(p, s.t);
      if (Math.abs(p.z) < FN_TD / 2 + FN_BR && (s.y - FN_BR < cy - p.gap / 2 || s.y + FN_BR > cy + p.gap / 2)) { crash(s); return; }
      if (!p.passed && p.z > FN_TD / 2 + FN_BR) {
        p.passed = true; s.score += 1;
        ring3d([0, s.y, 0], C.lime, 12, { speed: 4, life: 0.4, size: 0.12 });
        hx.tick();
        if (s.score % 10 === 0) { fx.ring(SCREEN_W / 2, SCREEN_H * 0.5, C.lime, 90); fx.pop(SCREEN_W / 2, SCREEN_H * 0.3, `¡${s.score}!`, C.lime, 28); hx.good(); }
      }
      if (p.coin && !p.got && Math.abs(p.z) < 0.9 && Math.abs(s.y - cy) < 0.9) {
        p.got = true; s.score += 2; s.coins += 1;
        burst3d([0, cy, p.z], [C.amber, '#ffffff'], 22, { speed: 6, size: 0.2, life: 0.8, g: 2 });
        fx.pop(SCREEN_W / 2 + 30, SCREEN_H * 0.45, '+2', C.amber, 16); hx.good();
      }
    }
  });

  const pan = usePan(fx, { down: flap });
  const s = g.current;
  const cyc = (base, step, n) => -70 + (((base + s.scroll) % (step * n)) + step * n) % (step * n);
  const scene = {
    sky: { top: '#06041a', bottom: '#2a0d4a', sun: true, sunC: '#ff8fd1', clouds: 0 },
    fog: { c: '#2a0d4a', near: 14, far: 58 },
    light: { dir: [0.2, 0.22, -0.95], sun: '#ffe2f0', i: 2.1, sky: '#c9a8ff', ground: '#1a0d2e', hi: 1.2 },
    shadowR: 14,
    objs: [
      { id: 'fn-suelo', k: 'pla', p: [0, FN_GROUND, -40], s: [60, 160, 1], c: '#15102e', recv: true, m: { r: 0.9, m: 0 } },
      ...Array.from({ length: 12 }, (_, i) => ({ k: 'box', inst: 'fn-rodillo', p: [0, FN_GROUND + 0.02, cyc(i * 6, 6, 12)], s: [60, 0.03, 0.15], c: C.amber, e: 0.7 })),
      ...s.pipes.flatMap(p => pipeObjs(p, cyOf(p, s.t))),
      ...s.pipes.filter(p => p.coin && !p.got).flatMap(p => gem(`co${p.id}`, [0, cyOf(p, s.t) - 0.4, p.z], { c: C.amber, n: 0.6, t: s.t })),
      ...birdObjs(s.y, s.t, s.flapT > 0),
    ],
    cam: { p: [0, s.camY, 7.5], l: [0, s.y * 0.55 + 0.4, -12], fov: 60 },
  };

  return (
    <Game3D title="FLAPPY NEON" emoji="🐦" accent={C.amber} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => ({ ...scene, objs: [...scene.objs.filter(o => o.id === 'fn-suelo' || o.inst === 'fn-rodillo'), ...birdObjs(5.5 + Math.sin(t * 2) * 0.4, t, true)], cam: { p: [0, 6, 7.5], l: [0, 5.2, -12], fov: 60 } })}
      pan={pan}
      hud={<>
        <Text style={{ color: C.amber, fontSize: 12, fontWeight: '800' }}>💰 {s.coins}</Text>
        <Text style={{ color: C.dim, fontSize: 12 }}>Toca para volar</Text>
      </>}
      subtitle="Vuela entre los tubos de neón"
      lines={['Toca para aletear', '⭐ da +2 · tubos rosas se mueven', '🥉 10 · 🥈 20 · 🥇 40 puntos']}
      result={{ won: false, isNew: res.isNew, title: 'ESTRELLADO', emoji: res.medal || '🐤', subtitle: 'Cada tubo cuenta', stats: [['MONEDAS', res.coins], ['MEDALLA', res.medal || '—']] }}>
      {phase === 'play' && s.t < 3 && <Text pointerEvents="none" style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', color: alpha('#ffffff', 0.5), fontSize: 11, fontWeight: '800', letterSpacing: 1, ...tglow(C.amber, 6) }}>TOCA PARA AFLETEAR · ATRAVIESA LOS HUECOS</Text>}
    </Game3D>
  );
}
