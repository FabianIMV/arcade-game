import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, hx, rand, uid, useBest, useFX, useLoop, usePan, alpha, tglow } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Vuelo en TERCERA PERSONA: el pájaro está en x=0, z=0 y la cámara detrás. Los tubos (muros con hueco)
// vienen desde el fondo hacia la cámara y hay que atravesar el hueco de cada uno. Toca para aletear.
// Escala: 1 unidad ≈ 1 metro. La altura visible del mundo es de 12 metros.
const FN_FAR = -60;           // profundidad de aparición de los tubos
const FN_G = 28;              // gravedad (u/s²)
const FN_FLAP = 8.2;          // impulso al aletear hacia arriba (u/s; y crece hacia arriba)
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

const pipeObjs = (p, cy) => {
  const col = p.moving ? C.pink : C.lime;
  const bh = cy - p.gap / 2 - FN_GROUND;      // tubo inferior: del suelo al hueco
  const th = FN_TOP - (cy + p.gap / 2);       // tubo superior: del hueco al techo
  return [
    { id: `pb${p.id}`, k: 'box', p: [0, FN_GROUND + bh / 2, p.z], s: [FN_TW, bh, FN_TD], c: col, e: 0.2 },
    { id: `pt${p.id}`, k: 'box', p: [0, cy + p.gap / 2 + th / 2, p.z], s: [FN_TW, th, FN_TD], c: col, e: 0.2 },
  ];
};

const initState = () => ({ y: 5.5, vy: 0, t: 0, pipes: [], next: 10, score: 0, coins: 0, scroll: 0, zs: 7 });

export function FlappyNeon3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('flappy');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, medal: '' });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => {
    fx.clear();
    const s = initState();
    addPipe(s, -24);
    g.current = s;
    s.vy = FN_FLAP;
    setPhase('play');
  };
  const flap = () => {
    const s = g.current;
    if (phase !== 'play') return;
    s.vy = FN_FLAP;
    fx.burst(AREA_W / 2 - 10, AREA_H * 0.5, C.amber, 4, 70, 0.35, 3);
    hx.tap();
  };
  const crash = s => {
    fx.burst(AREA_W / 2, AREA_H * 0.5, C.amber, 24, 260, 0.8, 5); fx.shake(9, 0.35); fx.flash('#ffffff', 0.35); hx.die();
    const medal = s.score >= 40 ? '🥇' : s.score >= 20 ? '🥈' : s.score >= 10 ? '🥉' : '';
    setRes({ isNew: submitBest(s.score), medal });
    setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.zs = Math.min(12, 7 + s.score * 0.15);          // velocidad de acercamiento de los tubos
    s.scroll += s.zs * dt;
    s.vy -= FN_G * dt;
    s.y += s.vy * dt;
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
        hx.tick();
        if (s.score % 10 === 0) { fx.ring(AREA_W / 2, AREA_H * 0.5, C.lime, 90); fx.pop(AREA_W / 2, AREA_H * 0.3, `¡${s.score}!`, C.lime, 28); hx.good(); }
      }
      if (p.coin && !p.got && Math.abs(p.z) < 0.9 && Math.abs(s.y - cy) < 0.9) {
        p.got = true; s.score += 2; s.coins += 1;
        fx.burst(AREA_W / 2, AREA_H * 0.5, C.amber, 10, 160); fx.pop(AREA_W / 2 + 30, AREA_H * 0.45, '+2', C.amber, 16); hx.good();
      }
    }
  });

  const pan = usePan(fx, { down: flap });
  const s = g.current;
  const cyc = (base, step, n) => -70 + (((base + s.scroll) % (step * n)) + step * n) % (step * n);
  const flapA = Math.sin(s.t * 22) * 0.55;
  const objs = [
    { id: 'fl', k: 'pla', p: [0, FN_GROUND, -40], s: [40, 160, 1], c: '#12102a' },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `rg${i}`, k: 'box', p: [0, 0.02, cyc(i * 6, 6, 12)], s: [40, 0.03, 0.15], c: C.amber, e: 0.6 })),
    ...s.pipes.flatMap(p => pipeObjs(p, cyOf(p, s.t))),
    ...s.pipes.filter(p => p.coin && !p.got).map(p => ({ id: `co${p.id}`, k: 'sph', p: [0, cyOf(p, s.t), p.z], n: 0.5, c: C.amber, e: 0.3 })),
    { id: 'bird', k: 'sph', p: [0, s.y, 0], s: [0.95, 0.85, 1.1], c: C.amber, e: 0.15 },
    { id: 'bird-wl', k: 'box', p: [-0.45, s.y + 0.05, 0.1], s: [0.8, 0.08, 0.45], r: [0, 0, flapA], c: C.amber, e: 0.4 },
    { id: 'bird-wr', k: 'box', p: [0.45, s.y + 0.05, 0.1], s: [0.8, 0.08, 0.45], r: [0, 0, -flapA], c: C.amber, e: 0.4 },
    { id: 'bird-beak', k: 'cone', p: [0, s.y - 0.05, -0.7], s: [0.35, 0.6, 0.35], r: [-Math.PI / 2, 0, 0], c: C.orange, e: 0.6 },
  ];
  const scene = {
    bg: '#07061a', fog: { c: '#07061a', near: 12, far: 50 }, objs,
    cam: { p: [0, s.y * 0.45 + 2.0, 7.5], l: [0, s.y * 0.55 + 0.4, -12], fov: 60 },
  };

  return (
    <GameScreen title="FLAPPY NEON" emoji="🐦" accent={C.amber} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Monedas: <Text style={{ color: C.amber, fontWeight: '800' }}>{s.coins}</Text></Text><Text style={{ color: C.dim, fontSize: 12 }}>Toca para volar</Text></>}>
      <PlayArea fx={fx} bg="#07061a" {...pan}>
        <World3D scene={scene} />
        {phase === 'play' && s.t < 3 && <Text pointerEvents="none" style={{ position: 'absolute', bottom: 10, width: AREA_W, textAlign: 'center', color: alpha('#ffffff', 0.45), fontSize: 11, fontWeight: '800', letterSpacing: 1, ...tglow(C.amber, 6) }}>TOCA PARA AFLETEAR · ATRAVIESA LOS HUECOS</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? (res.medal || '🐤') : '🐤'} title={phase === 'over' ? 'ESTRELLADO' : 'FLAPPY NEON 3D'}
          subtitle={phase === 'over' ? 'Cada tubo cuenta' : 'Vuela entre los tubos'}
          score={s.score} best={best} isNew={res.isNew} accent={C.amber} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca para aletear', '⭐ da +2 · tubos rosas se mueven', '🥉 10 · 🥈 20 · 🥇 40 puntos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
