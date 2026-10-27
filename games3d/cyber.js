import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, clamp, hx, uid, useBest, useFX, useLoop, usePan, alpha } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Corredor en tercera persona: 3 carriles (x), obstáculos que vienen desde el fondo (z) hacia la cámara.
// El corredor está en z=0 y la cámara detrás (z≈+6.5). Escala: 1 unidad ≈ 1 metro.
const CR_LANE = 1.5;          // separación entre carriles
const CR_SPAWN = -70;         // profundidad de aparición
const CR_JUMP_H = 1.6, CR_JUMP_T = 0.62, CR_SLIDE_T = 0.6;
const CR_CAM = { z: 6.5, y: 3.0 };

const laneX = lane => (lane - 1) * CR_LANE;
const jumpY = s => (s.jump > 0 ? Math.sin((1 - s.jump / CR_JUMP_T) * Math.PI) * CR_JUMP_H : 0);

const initState = () => ({
  lane: 1, lx: 1, jump: 0, slide: 0, t: 0, v: 14, dist: 0, objs: [], next: 0,
  coins: 0, mag: 0, x2: 0, score: 0, used: false,
});

// Filas de obstáculos (mismas probabilidades que en 2D)
const spawnRow = s => {
  const r = Math.random();
  const z = CR_SPAWN;
  const free = Math.floor(Math.random() * 3);
  const add = (k, lane, zz = z) => s.objs.push({ id: uid(), k, lane, z: zz });
  if (r < 0.30) { // vagones: deja un carril libre con monedas
    for (let l = 0; l < 3; l++) if (l !== free) add('wall', l);
    add('coin', free); add('coin', free, z - 1.5); add('coin', free, z - 3);
  } else if (r < 0.48) { for (let l = 0; l < 3; l++) add('low', l); }       // saltar
  else if (r < 0.64) { for (let l = 0; l < 3; l++) add('high', l); }        // deslizar
  else if (r < 0.74) { add(Math.random() < 0.5 ? 'low' : 'high', free); add('wall', (free + 1 + Math.floor(Math.random() * 2)) % 3); }
  else if (r < 0.80) add(Math.random() < 0.5 ? 'mag' : 'x2', free);
  else { for (let i = 0; i < 6; i++) add('coin', free, z - i * 1.5); }
};

// Objetos 3D de cada obstáculo / pickup
const obstacleObj = (o, t) => {
  const x = laneX(o.lane), id = `o${o.id}`;
  if (o.k === 'wall') return [
    { id, k: 'box', p: [x, 1.2, o.z], s: [1.3, 2.4, 1.0], c: C.violet, e: 0.35 },
    { id: id + 'l', k: 'box', p: [x, 1.6, o.z], s: [1.4, 0.2, 1.05], c: C.cyan, e: 0.9 },
  ];
  if (o.k === 'low') return [{ id, k: 'box', p: [x, 0.3, o.z], s: [1.3, 0.6, 1.0], c: C.amber, e: 0.5 }];
  if (o.k === 'high') return [
    { id, k: 'box', p: [x, 1.7, o.z], s: [1.3, 0.5, 1.0], c: C.red, e: 0.45 },
    { id: id + 'a', k: 'box', p: [x - 0.6, 0.72, o.z], s: [0.12, 1.45, 0.12], c: C.red, e: 0.4 },
    { id: id + 'b', k: 'box', p: [x + 0.6, 0.72, o.z], s: [0.12, 1.45, 0.12], c: C.red, e: 0.4 },
  ];
  if (o.k === 'coin') return [{ id, k: 'sph', p: [x, 1.0, o.z], n: 0.5, c: C.amber, e: 0.9 }];
  if (o.k === 'mag') return [{ id, k: 'tor', p: [x, 1.0, o.z], n: 0.9, r: [0, t * 2, 0], c: C.cyan, e: 1 }];
  return [{ id, k: 'box', p: [x, 1.0, o.z], s: [0.6, 0.6, 0.6], r: [t, t * 1.3, 0], c: C.lime, e: 1 }]; // x2
};

// Suelo, carriles, travesaños y pilares que pasan junto a la cámara (sensación de velocidad)
const worldObjs = (s) => {
  const out = [
    { id: 'floor', k: 'pla', p: [0, 0, -35], s: [9, 140, 1], c: '#0c0618' },
  ];
  [-2.25, -0.75, 0.75, 2.25].forEach((x, i) => out.push({ id: `ln${i}`, k: 'box', p: [x, 0.01, -35], s: [0.05, 0.02, 140], c: C.pink, e: 0.8 }));
  const cyc = (base, step, n) => -70 + (((base + s.dist) % (step * n)) + step * n) % (step * n);
  for (let i = 0; i < 14; i++) out.push({ id: `rg${i}`, k: 'box', p: [0, 0.01, cyc(i * 5, 5, 14)], s: [9, 0.02, 0.12], c: C.cyan, e: 0.6 });
  for (let i = 0; i < 8; i++) {
    const z = cyc(i * 10, 10, 8);
    out.push({ id: `pl${i}`, k: 'box', p: [-4.4, 2.5, z], s: [0.4, 5, 0.4], c: C.violet, e: 0.5 });
    out.push({ id: `pr${i}`, k: 'box', p: [4.4, 2.5, z], s: [0.4, 5, 0.4], c: C.violet, e: 0.5 });
  }
  return out;
};

// Corredor visto desde atrás (cabeza, torso, piernas animadas; se agacha al deslizar)
const runnerObjs = (s, cx) => {
  const air = jumpY(s);
  const t = s.t;
  if (s.slide > 0) return [
    { id: 'rn-body', k: 'box', p: [cx, air + 0.42, 0], s: [0.9, 0.45, 0.9], c: C.pink, e: 0.6 },
    { id: 'rn-head', k: 'sph', p: [cx, air + 0.6, -0.45], n: 0.42, c: '#ffd9c2', e: 0.2 },
  ];
  const swing = Math.sin(t * 12) * 0.6;
  return [
    { id: 'rn-body', k: 'box', p: [cx, air + 1.0, 0], s: [0.7, 0.9, 0.45], c: C.pink, e: 0.6 },
    { id: 'rn-head', k: 'sph', p: [cx, air + 1.62, 0], n: 0.5, c: '#ffd9c2', e: 0.2 },
    { id: 'rn-visor', k: 'box', p: [cx, air + 1.64, 0.26], s: [0.5, 0.12, 0.05], c: C.cyan, e: 1 },
    { id: 'rn-legL', k: 'box', p: [cx - 0.18, air + 0.4, 0], s: [0.22, 0.8, 0.22], r: [swing, 0, 0], c: C.violet, e: 0.3 },
    { id: 'rn-legR', k: 'box', p: [cx + 0.18, air + 0.4, 0], s: [0.22, 0.8, 0.22], r: [-swing, 0, 0], c: C.violet, e: 0.3 },
  ];
};

export function CyberRun3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('cyber');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };

  const crash = s => {
    fx.burst(AREA_W / 2, AREA_H * 0.7, C.pink, 28, 300, 0.8, 6); fx.shake(12, 0.4); fx.flash(C.red, 0.35); hx.die();
    setRes({ isNew: submitBest(s.score) });
    setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.v = Math.min(30, 14 + s.t * 0.35);
    s.dist += s.v * dt * 2;
    s.lx += (s.lane - s.lx) * Math.min(1, dt * 16);
    if (s.jump > 0) s.jump = Math.max(0, s.jump - dt);
    if (s.slide > 0) s.slide = Math.max(0, s.slide - dt);
    if (s.mag > 0) s.mag -= dt;
    if (s.x2 > 0) s.x2 -= dt;
    s.next -= s.v * dt;
    if (s.next <= 0) { spawnRow(s); s.next += Math.max(8, 14 - s.t * 0.02); }
    s.objs.forEach(o => { o.z += s.v * dt; });
    s.objs = s.objs.filter(o => o.z < 3 && !o.gone);

    const airY = jumpY(s);
    const sliding = s.slide > 0.1;
    for (const o of s.objs) {
      if (o.gone) continue;
      const near = Math.abs(o.z) < 0.9;
      if (o.k === 'coin' || o.k === 'mag' || o.k === 'x2') {
        const inLane = o.lane === s.lane || (o.k === 'coin' && s.mag > 0 && Math.abs(o.z) < 2.4);
        if (inLane && near) {
          o.gone = true; hx.tick();
          const x = laneX(o.lane);
          const px = AREA_W / 2 + x * 60, py = AREA_H * 0.6;
          if (o.k === 'coin') { s.coins += 1; fx.burst(px, py, C.amber, 6, 120, 0.35, 3); }
          else {
            if (o.k === 'mag') { s.mag = 7; fx.pop(px, py - 30, 'IMÁN', C.cyan, 16); }
            else { s.x2 = 8; fx.pop(px, py - 30, 'PUNTOS ×2', C.lime, 16); }
            fx.ring(px, py, C.lime, 50); hx.good();
          }
        }
        continue;
      }
      if (!near || o.lane !== s.lane) continue;
      if (o.k === 'wall' || (o.k === 'low' && airY < 0.7) || (o.k === 'high' && !sliding)) { crash(s); return; }
    }
    s.score = Math.floor(s.dist / 4 + s.coins * 3) * (s.x2 > 0 ? 2 : 1);
  });

  const pan = usePan(fx, {
    down: () => { g.current.used = false; },
    move: (x, y, gs) => {
      const s = g.current;
      if (phase !== 'play' || s.used) return;
      const dx = gs.dx, dy = gs.dy;
      if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy)) { s.lane = clamp(s.lane + (dx > 0 ? 1 : -1), 0, 2); s.used = true; hx.tick(); }
      else if (dy < -26) { if (s.jump <= 0) { s.jump = CR_JUMP_T; s.slide = 0; hx.tap(); } s.used = true; }
      else if (dy > 26) { if (s.slide <= 0) { s.slide = CR_SLIDE_T; s.jump = 0; hx.tap(); } s.used = true; }
    },
    up: (x, y, gs) => {
      const s = g.current;
      if (phase !== 'play' || s.used) return;
      if (Math.abs(gs.dx) < 8 && Math.abs(gs.dy) < 8 && s.jump <= 0) { s.jump = CR_JUMP_T; s.slide = 0; hx.tap(); }   // un toque = saltar
    },
  });

  const s = g.current;
  const cx = laneX(s.lx);
  const shake = fx.shakeT > 0 ? (Math.random() - 0.5) * fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.08 : 0;
  const objs = [
    ...worldObjs(s),
    ...s.objs.filter(o => !o.gone).flatMap(o => obstacleObj(o, s.t)),
    ...runnerObjs(s, cx),
    { id: 'rn-shadow', k: 'pla', p: [cx, 0.02, 0], s: [1.2, 0.8, 1], c: '#000000', o: 0.5 },
  ];
  const scene = {
    bg: '#07030f', fog: { c: '#07030f', near: 10, far: 62 }, objs,
    cam: { p: [cx * 0.5 + shake, CR_CAM.y, CR_CAM.z], l: [cx * 0.6, 1.0, -12], fov: 60 },
  };

  return (
    <GameScreen title="CYBER RUN" emoji="🏃" accent={C.pink} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>🪙 <Text style={{ color: C.amber, fontWeight: '800' }}>{s.coins}</Text></Text><Text style={{ color: C.cyan, fontSize: 12, fontWeight: '800' }}>{s.mag > 0 ? `🧲 ${Math.ceil(s.mag)}s  ` : ''}{s.x2 > 0 ? `×2 ${Math.ceil(s.x2)}s` : ''}</Text><Text style={{ color: C.dim, fontSize: 12 }}>{Math.floor(s.dist)} m</Text></>}>
      <PlayArea fx={fx} bg="#07030f" {...pan}>
        <World3D scene={scene} />
        {phase === 'play' && s.t < 4 && <Text pointerEvents="none" style={{ position: 'absolute', bottom: 8, width: AREA_W, textAlign: 'center', color: alpha('#ffffff', 0.4), fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>◀ ▶ CARRIL · ▲ SALTAR · ▼ DESLIZAR</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🏃" title={phase === 'over' ? 'SISTEMA CAÍDO' : 'CYBER RUN 3D'}
          subtitle={phase === 'over' ? `${Math.floor(s.dist)} m · ${s.coins} monedas` : 'Corre por la ciudad neón'}
          score={s.score} best={best} isNew={res.isNew} accent={C.pink} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Desliza ◀ ▶ para cambiar de carril', '▲ saltar barreras bajas · ▼ deslizarte bajo las altas', '🧲 imán · ⚡ puntos ×2 · vista detrás del corredor'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
