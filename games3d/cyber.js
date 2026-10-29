import React, { useRef, useState } from 'react';
import { C, SCREEN_H, SCREEN_W, clamp, hx, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill } from '../utils/ui3d';
import { coin, gem, hash01, person } from '../utils/prefabs';

// CYBER RUN 3D – corredor en tercera persona por una ciudad neón. 3 carriles: saltas las barreras bajas,
// te deslizas bajo las barras altas y esquivas los muros. Reglas, puntuación y récord como la versión 2D.
// Deslizar: ◀ ▶ cambian de carril · ▲ salta · ▼ desliza. También con botones (abajo) o un toque para saltar.
const CR_LANE = 1.5, CR_SPAWN = -70, CR_JUMP_H = 1.6, CR_JUMP_T = 0.62, CR_SLIDE_T = 0.6;
const CR_CAM_Y = 3.0, CR_CAM_Z = 6.5;
const PI = Math.PI;
const NEON = ['#ff3df2', '#22e6ff', '#7dff6b', '#ffc233'];
const CITY_PERIOD = 84;   // longitud del tramo de ciudad que se repite (m)

const laneX = lane => (lane - 1) * CR_LANE;
const jumpY = s => (s.jump > 0 ? Math.sin((1 - s.jump / CR_JUMP_T) * Math.PI) * CR_JUMP_H : 0);

const initState = () => ({
  lane: 1, lx: 1, camX: 0, jump: 0, slide: 0, t: 0, v: 14, dist: 0, scroll: 0, objs: [], next: 0,
  coins: 0, mag: 0, x2: 0, score: 0, used: false, dustT: 0, wasAir: false, btnAt: -9,
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

// Obstáculos y pickups en 3D
const obstacleObjs = (o, t) => {
  const x = laneX(o.lane), id = `o${o.id}`;
  if (o.k === 'wall') return [
    { id, k: 'box', p: [x, 1.2, o.z], s: [1.3, 2.4, 1.0], c: '#4b1fa8', e: 0.25, sh: true },
    { id: id + 'l', k: 'box', p: [x, 2.46, o.z], s: [1.36, 0.1, 1.06], c: '#22e6ff', e: 1 },
    { id: id + 'f', k: 'box', p: [x, 1.2, o.z + 0.52], s: [1.0, 0.16, 0.02], c: '#ff3df2', e: 1 },
  ];
  if (o.k === 'low') return [
    { id, k: 'box', p: [x, 0.3, o.z], s: [1.3, 0.6, 1.0], c: '#ffb020', e: 0.4 },
    { id: id + 't', k: 'box', p: [x, 0.62, o.z], s: [1.34, 0.05, 1.04], c: '#fff3b0', e: 1 },
  ];
  if (o.k === 'high') return [
    { id, k: 'box', p: [x, 1.7, o.z], s: [1.3, 0.5, 1.0], c: '#ff4d6d', e: 0.45 },
    { id: id + 'a', k: 'box', p: [x - 0.6, 0.72, o.z], s: [0.12, 1.45, 0.12], c: '#ff4d6d', e: 0.4 },
    { id: id + 'b', k: 'box', p: [x + 0.6, 0.72, o.z], s: [0.12, 1.45, 0.12], c: '#ff4d6d', e: 0.4 },
    { id: id + 'l', k: 'box', p: [x, 1.96, o.z], s: [1.36, 0.05, 1.06], c: '#ffffff', e: 1 },
  ];
  if (o.k === 'coin') return coin(id, [x, 1.0, o.z], { t, c: '#ffc233' });
  if (o.k === 'mag') return [{ id, k: 'tor', p: [x, 1.0, o.z], n: 0.9, r: [0, t * 2, 0], c: '#22e6ff', e: 1 }];
  return gem(id, [x, 0.6, o.z], { c: '#7dff6b', t });   // x2
};

// Ciudad: edificios a los lados (inst, se recalculan con el avance) + neón de fachada
const CITY = Array.from({ length: 16 }, (_, i) => {
  const side = i % 2 ? 1 : -1, k = i >> 1;
  return {
    i, side, base: k * (CITY_PERIOD / 8) + (side > 0 ? CITY_PERIOD / 16 : 0),
    w: 3 + hash01('w' + i) * 3, h: 10 + hash01('h' + i) * 26, d: 5 + hash01('d' + i) * 3,
    x: side * (8.5 + hash01('x' + i) * 4), c: ['#2a1a5c', '#33206b', '#1e1240', '#3c1d66'][i % 4], n: NEON[i % 4],
  };
});
// Suelo, carriles y acera: no cambian → statics
const STATIC_WORLD = [
  { id: 'calle', k: 'pla', p: [0, 0, -40], s: [16, 180, 1], c: '#0d0620', recv: true },
  ...[-2.25, -0.75, 0.75, 2.25].map((x, i) => ({ id: `ln${i}`, k: 'box', p: [x, 0.012, -40], s: [0.06, 0.02, 180], c: '#ff3df2', e: 0.9 })),
  { id: 'acera-i', k: 'box', p: [-3.85, 0.1, -40], s: [0.6, 0.2, 180], c: '#241a3d' },
  { id: 'acera-d', k: 'box', p: [3.85, 0.1, -40], s: [0.6, 0.2, 180], c: '#241a3d' },
];

// Escena completa en un instante (se usa para jugar y para el fondo animado de los menús)
function buildScene(s, t, scroll) {
  const cx = laneX(s.lx), air = jumpY(s);
  const objs = [];
  // edificios que avanzan (se repiten cada CITY_PERIOD)
  for (const b of CITY) {
    const z = -82 + ((((b.base + scroll) % CITY_PERIOD) + CITY_PERIOD) % CITY_PERIOD);
    objs.push({ k: 'box', inst: 'edif', p: [b.x, b.h / 2, z], s: [b.w, b.h, b.d], c: b.c });
    const xs = b.x - b.side * (b.w / 2 + 0.05);
    objs.push({ k: 'box', inst: 'neon', p: [xs, b.h * 0.3, z], s: [0.08, b.h * 0.22, 0.2], c: b.n, e: 1 });
    objs.push({ k: 'box', inst: 'neon', p: [xs, b.h * 0.72, z], s: [0.08, b.h * 0.12, 0.2], c: b.n, e: 1 });
    // ventanas iluminadas en la cara que mira a la calle
    for (let f = 0; f < 4; f++) {
      const wy = b.h * (0.15 + f * 0.22);
      const lit = hash01('v' + b.i + f) < 0.7;
      objs.push({ k: 'box', inst: 'ventana', p: [b.x - b.side * (b.w / 2 + 0.03), wy, z + (f % 2 ? 0.9 : -0.9)], s: [0.04, 0.9, 1.1], c: lit ? '#ffe28a' : b.n, e: 1 });
    }
  }
  // marcas transversales de la calle
  for (let i = 0; i < 14; i++) {
    const z = -70 + ((((i * 5 + scroll) % 70) + 70) % 70);
    objs.push({ k: 'box', inst: 'marca', p: [0, 0.015, z], s: [4.4, 0.02, 0.14], c: '#22e6ff', e: 0.9 });
  }
  for (const o of s.objs) if (!o.gone) objs.push(...obstacleObjs(o, t));
  // corredor visto desde atrás
  const lean = -(s.lane - s.lx) * 0.18;
  if (s.slide > 0.1) {
    // deslizando: el cuerpo tumbado hacia delante con los brazos arriba
    objs.push(...person('yo', [cx, 0.3, -0.8], { pitch: PI / 2, arms: 2.8, t, walk: 0, hat: 'helmet', band: C.cyan, shirt: C.pink, pants: '#2a1458', skin: '#f0c09a', hair: '#1a1030' }));
  } else {
    objs.push(...person('yo', [cx, air, 0], { yaw: 0, roll: lean, t, walk: air > 0 ? 0.25 : 1, hat: 'helmet', band: C.cyan, shirt: C.pink, pants: '#2a1458', skin: '#f0c09a', hair: '#1a1030', arms: air > 0 ? 2.6 : undefined }));
  }
  return {
    sky: { top: '#060218', bottom: '#2a0a4a', sun: false, clouds: 0 },
    fog: { c: '#2a0a4a', near: 14, far: 62 },
    light: { dir: [-0.35, 0.9, 0.3], sun: '#ffc4ef', i: 1.5, sky: '#8f7bff', ground: '#1c0a36', hi: 1.3 },
    shadowR: 14,
    statics: STATIC_WORLD,
    objs,
    cam: { p: [s.camX * 0.5, CR_CAM_Y, CR_CAM_Z], l: [s.camX * 0.6, 1.0, -12], fov: 60 },
  };
}

export function CyberRun3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('cyber');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };

  const crash = s => {
    fx.flash(C.red, 0.35); fx.shake(12, 0.4); hx.die();
    burst3d([laneX(s.lx), jumpY(s) + 0.9, 0.2], ['#ff3df2', '#22e6ff', '#ffffff'], 46, { speed: 7, up: 3, g: 10, size: 0.2, life: 1 });
    ring3d([laneX(s.lx), 0.1, 0.2], '#ff4d6d', 28, { speed: 8, life: 0.7 });
    setRes({ isNew: submitBest(s.score) });
    setPhase('over');
  };

  const jumpNow = () => { const s = g.current; if (s.jump <= 0) { s.jump = CR_JUMP_T; s.slide = 0; hx.tap(); } };
  const slideNow = () => { const s = g.current; if (s.slide <= 0) { s.slide = CR_SLIDE_T; s.jump = 0; hx.tap(); } };
  const shift = d => { const s = g.current; s.lane = clamp(s.lane + d, 0, 2); hx.tick(); };
  // los botones también disparan el gesto de tocar: se ignora ese toque durante un instante
  const press = fn => () => { g.current.btnAt = g.current.t; fn(); };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.v = Math.min(30, 14 + s.t * 0.35);
    s.dist += s.v * dt * 2;          // puntuación: metros·2 (como antes)
    s.scroll += s.v * dt;            // avance visual del decorado = velocidad real de los obstáculos
    s.lx += (s.lane - s.lx) * Math.min(1, dt * 16);
    s.camX += (laneX(s.lx) - s.camX) * Math.min(1, dt * 4);
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
    // aterrizaje: anillo de polvo; carrera: polvo bajo los pies
    if (airY <= 0.001 && s.wasAir) ring3d([laneX(s.lx), 0.05, 0.2], '#ff3df2', 12, { speed: 3, life: 0.4, size: 0.12 });
    s.wasAir = airY > 0.001;
    s.dustT -= dt;
    if (s.dustT <= 0 && airY <= 0.001) { s.dustT = 0.13; burst3d([laneX(s.lx), 0.05, 0.4], '#ff3df2', 3, { speed: 1.4, up: 1.2, g: 6, size: 0.12, life: 0.45 }); }

    s.score = Math.floor(s.dist / 4 + s.coins * 3) * (s.x2 > 0 ? 2 : 1);
    for (const o of s.objs) {
      if (o.gone) continue;
      const near = Math.abs(o.z) < 0.9;
      if (o.k === 'coin' || o.k === 'mag' || o.k === 'x2') {
        const inLane = o.lane === s.lane || (o.k === 'coin' && s.mag > 0 && Math.abs(o.z) < 2.4);
        if (inLane && near) {
          o.gone = true; hx.tick();
          const x = laneX(o.lane);
          const px = SCREEN_W / 2 + x * 60, py = SCREEN_H * 0.6;
          if (o.k === 'coin') { s.coins += 1; burst3d([x, 1.0, 0], '#ffc233', 10, { speed: 3, g: 4, size: 0.14, life: 0.5 }); fx.pop(px, py, '+3', C.amber, 16); }
          else {
            if (o.k === 'mag') { s.mag = 7; fx.pop(px, py - 30, 'IMÁN', C.cyan, 16); burst3d([x, 1, 0], '#22e6ff', 26, { speed: 5, size: 0.18, life: 0.7 }); }
            else { s.x2 = 8; fx.pop(px, py - 30, 'PUNTOS ×2', C.lime, 16); burst3d([x, 1, 0], '#7dff6b', 26, { speed: 5, size: 0.18, life: 0.7 }); }
            ring3d([x, 0.4, 0], C.lime, 22, { speed: 6, life: 0.5 }); hx.good();
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
      if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy)) { shift(dx > 0 ? 1 : -1); s.used = true; }
      else if (dy < -26) { jumpNow(); s.used = true; }
      else if (dy > 26) { slideNow(); s.used = true; }
    },
    up: (x, y, gs) => {
      const s = g.current;
      if (phase !== 'play' || s.used || s.t - s.btnAt < 0.3) return;
      if (Math.abs(gs.dx) < 8 && Math.abs(gs.dy) < 8) jumpNow();   // un toque = saltar
    },
  });

  const s = g.current;
  const scene = buildScene(s, s.t, s.scroll);
  const menu = t => buildScene(g.current, t, t * 14);

  return (
    <Game3D title="CYBER RUN" emoji="🏃" accent={C.pink} onExit={onExit} score={s.score} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene} menuScene={menu} orbit={{ c: [0, 1.2, 0], r: 6.6, h: 2.2, speed: 0.22, ly: 1.2, drop: 2.6 }}
      hud={<><HudPill icon="🪙" value={s.coins} color={C.amber} /><HudPill icon="🏃" value={`${Math.floor(s.dist)} m`} color={C.cyan} />{s.mag > 0 ? <HudPill icon="🧲" value={`${Math.ceil(s.mag)}s`} color={C.cyan} /> : null}{s.x2 > 0 ? <HudPill icon="×2" value={`${Math.ceil(s.x2)}s`} color={C.lime} /> : null}</>}
      subtitle="Corre por la ciudad neón"
      lines={['Desliza ◀ ▶ para cambiar de carril', '▲ salta barreras bajas · ▼ deslízate bajo las altas', '🧲 imán · ×2 puntos dobles · 🪙 monedas']}
      result={{ isNew: res.isNew, title: 'SISTEMA CAÍDO', emoji: '💥', subtitle: `${Math.floor(s.dist)} m recorridos`, stats: [['METROS', Math.floor(s.dist)], ['MONEDAS', s.coins]] }}>
      <ActionBtn testID="cy-left" label="◀" color={C.pink} size={58} onDown={press(() => shift(-1))} style={{ left: 18, bottom: 40 }} />
      <ActionBtn testID="cy-right" label="▶" color={C.pink} size={58} onDown={press(() => shift(1))} style={{ left: 88, bottom: 40 }} />
      <ActionBtn testID="cy-jump" label="▲" color={C.cyan} size={58} onDown={press(jumpNow)} style={{ right: 88, bottom: 40 }} />
      <ActionBtn testID="cy-slide" label="▼" color={C.cyan} size={58} onDown={press(slideNow)} style={{ right: 18, bottom: 40 }} />
    </Game3D>
  );
}
