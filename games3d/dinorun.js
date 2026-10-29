import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, TouchBtn, alpha, hx, rand, uid, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { coin, hash01, mix, rock, shade, tree } from '../utils/prefabs';

// DINO RUN 3D – el dinosaurio corre sin fin por un desierto en 3D. Cámara detrás del dino.
// Toca la mitad izquierda para saltar y mantén la derecha para agacharte. Aves altas: agáchate · bajas: salta.
// El dino está hecho con piezas (cuerpo, cuello, cola, patas y púas) y se anima con t / walk.
const DN_G = 21, DN_JUMP = 9.2, DN_G_DUCK = 40, DN_TOP = 1.7, DN_TOP_DUCK = 1.1, DN_HD = 0.5;
const PI = Math.PI;
const DAY = { top: '#4fb8ff', bottom: '#ffe2b0', sand: '#ebc981', dash: '#8a6334', dino: '#3fbf86', spike: '#ffb347', cactus: '#2f8f5b' };
const NIGHT = { top: '#060a24', bottom: '#241f4f', sand: '#2b2944', dash: '#8aa0ff', dino: '#5ee0b0', spike: '#ff7ad9', cactus: '#2e6f7a' };
const MESAS = [   // mesetas lejanas (no se mueven: el fog las integra en el horizonte)
  { id: 'm1', k: 'cone', p: [-22, 3.5, -48], s: [14, 7, 14], c: '#c98a4b' },
  { id: 'm2', k: 'cone', p: [20, 2.5, -52], s: [11, 5, 11], c: '#b8703d' },
  { id: 'm3', k: 'cone', p: [4, 2, -58], s: [9, 4, 9], c: '#d69a5c' },
];

const initState = () => ({
  y: 0, vy: 0, duck: false, air: false, t: 0, dist: 0, speed: 9, obs: [], next: 1.1, night: false, nk: 0, scroll: 0, camY: 4.4,
  coins: 0, dustT: 0, wasAir: false,
  dashes: Array.from({ length: 16 }, (_, i) => ({ id: `ds${i}`, x: rand(-4, 4), z0: (i / 16) * 40 })),
});

// Obstáculos: cactus en el suelo, pájaro alto (agacharse) o bajo (saltar), y monedas en el aire
const spawnObs = s => {
  const r = Math.random();
  if (s.dist > 120 && r < 0.3) {
    const high = Math.random() < 0.5;
    s.obs.push({ id: uid(), kind: 'bird', z: -40, dz: 1.0, y: high ? 1.5 : 0.5, r: 0.35, ph: 0 });
  } else if (r < 0.4) {
    s.obs.push({ id: uid(), kind: 'coin', z: -40, dz: 0.7, y: rand(1.0, 2.2), r: 0.4 });
  } else {
    const n = 1 + Math.floor(Math.random() * Math.min(3, 1 + s.dist / 250));
    s.obs.push({ id: uid(), kind: 'cactus', z: -40, dz: 0.8, n, h: rand(1.1, 1.6), y: 0, r: 0 });
  }
};

// Dinosaurio con piezas. Frente = −Z (se ve la cola de cara a la cámara).
function dinoObjs(t, o) {
  const { y, walk, duck, air, col } = o;
  const dy = y - (duck ? 0.32 : 0);
  const bob = Math.abs(Math.sin(t * 28)) * 0.04 * walk;
  const sw = air ? -0.35 : Math.sin(t * 28) * 0.75 * walk;
  const out = [];
  const add = (id, k, p, s, c, x) => out.push({ id: 'dino.' + id, k, p, ...(typeof s === 'number' ? { n: s } : { s }), c, ...(x || {}) });
  const leg = (name, hx0, ang) => {
    const len = 0.7, hy = dy + 0.62, hz = 0.2;
    const cy = hy - (len / 2) * Math.cos(ang), cz = hz - (len / 2) * Math.sin(ang);
    add(name, 'cap', [hx0, cy, cz], [0.22, len, 0.22], col, { r: [ang, 0, 0] });
    const fy = hy - len * Math.cos(ang), fz = hz - len * Math.sin(ang);
    add(name + 'f', 'box', [hx0, fy + 0.04, fz - 0.1], [0.27, 0.1, 0.42], shade(col, 0.8));
  };
  // cola: 4 segmentos que se balancean
  // cápsulas tumbadas (eje largo en Z): cola que se afila y cuerpo alargado
  for (let i = 0; i < 4; i++) add('tail' + i, 'cap', [Math.sin(t * 5 + i * 0.7) * 0.1 * (i + 1), dy + 0.82 - i * 0.1, 1.0 + i * 0.36], [0.44 - i * 0.08, 0.5, 0.44 - i * 0.08], col, { r: [PI / 2, 0, 0] });
  add('body', 'cap', [0, dy + 0.95 + bob, 0.1], [0.95, 1.5, 0.8], col, { r: [PI / 2, 0, 0] });
  add('belly', 'cap', [0, dy + 0.7, 0.1], [0.8, 1.3, 0.4], '#e8f7c8', { r: [PI / 2, 0, 0], e: 0.15 });
  for (let i = 0; i < 4; i++) add('sp' + i, 'cone', [0, dy + 1.3 + bob - (i === 0 ? 0 : 0.02), 0.6 - i * 0.4], [0.2, 0.42, 0.2], DAY.spike, { e: 0.35 });
  add('neck', 'box', [0, dy + 1.22, -0.6], [0.44, 0.6, 0.46], col, { r: [-0.45, 0, 0] });
  add('head', 'ico', [0, dy + 1.5, -0.98], [0.74, 0.62, 0.88], col);
  add('snout', 'box', [0, dy + 1.38, -1.4], [0.44, 0.3, 0.5], shade(col, 0.92));
  add('jaw', 'box', [0, dy + 1.22, -1.32], [0.4, 0.1, 0.42], shade(col, 0.7));
  add('eyeL', 'sph', [-0.27, dy + 1.6, -1.12], 0.13, '#ffffff', { e: 1, sh: false });
  add('eyeR', 'sph', [0.27, dy + 1.6, -1.12], 0.13, '#ffffff', { e: 1, sh: false });
  add('pupL', 'sph', [-0.31, dy + 1.6, -1.2], 0.06, '#101018', { sh: false });
  add('pupR', 'sph', [0.31, dy + 1.6, -1.2], 0.06, '#101018', { sh: false });
  // brazos cortos
  const aw = air ? 0.4 : Math.sin(t * 28 + PI) * 0.5 * walk;
  add('armL', 'cap', [-0.36, dy + 0.94, -0.42], [0.14, 0.4, 0.14], shade(col, 0.9), { r: [aw, 0, 0] });
  add('armR', 'cap', [0.36, dy + 0.94, -0.42], [0.14, 0.4, 0.14], shade(col, 0.9), { r: [-aw, 0, 0] });
  leg('legL', -0.3, sw);
  leg('legR', 0.3, -sw);
  return out;
}

// Pájaro hecho con piezas (aleteo con ph)
const birdObjs = (o, col) => {
  const flap = Math.sin(o.ph * 14) * 0.5;
  const id = o.id;
  return [
    { id: id + 'b', k: 'ico', p: [0, o.y, o.z], s: [0.9, 0.62, 1.15], c: col },
    { id: id + 'h', k: 'sph', p: [0, o.y + 0.14, o.z - 0.6], n: 0.36, c: col },
    { id: id + 'p', k: 'cone', p: [0, o.y + 0.1, o.z - 0.92], s: [0.22, 0.4, 0.22], r: [-PI / 2, 0, 0], c: '#ffc233', e: 0.4 },
    { id: id + 'e', k: 'sph', p: [0.14, o.y + 0.2, o.z - 0.78], n: 0.08, c: '#ffffff', e: 1, sh: false },
    { id: id + 'wi', k: 'box', p: [-0.62, o.y + 0.12, o.z], s: [0.9, 0.08, 0.38], r: [0, 0, flap], c: col },
    { id: id + 'wd', k: 'box', p: [0.62, o.y + 0.12, o.z], s: [0.9, 0.08, 0.38], r: [0, 0, -flap], c: col },
  ];
};

// Escena completa (juego y menús). scroll = avance del desierto; t = reloj de animación.
function buildScene(s, t, scroll) {
  const P = {};
  for (const key of Object.keys(DAY)) P[key] = mix(DAY[key], NIGHT[key], s.nk);
  const day = s.nk < 0.5;
  const objs = [];
  objs.push({ id: 'suelo', k: 'pla', p: [0, -0.01, -20], s: [40, 120, 1], c: P.sand, recv: true });
  // rayas de la pista (inst)
  s.dashes.forEach(d => {
    const L = 40, z = ((d.z0 + scroll) % L) - L + 12;
    objs.push({ k: 'box', inst: 'raya', p: [d.x, 0.012, z], s: [0.14, 0.02, 2.2], c: P.dash, e: 0.2 });
  });
  // dunas y rocas a los lados que avanzan (inst)
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1, z = -50 + ((((i * 9 + scroll) % 60) + 60) % 60);
    const w = 6 + hash01('dw' + i) * 4;
    objs.push({ k: 'ico', inst: 'duna', p: [side * (10 + hash01('dx' + i) * 7), 0, z], s: [w, 1.5 + hash01('dh' + i) * 1.6, w * 0.7], c: P.sand, e: 0 });
  }
  for (let i = 0; i < 5; i++) {
    const side = i % 2 ? -1 : 1, z = -30 + ((((i * 13 + scroll * 0.9) % 50) + 50) % 50);
    objs.push(...rock('ro' + i, [side * (7 + hash01('rx' + i) * 3), 0, z], { kind: 'boulder', c: '#c09062', inst: 'roca' }));
  }
  // dino
  objs.push(...dinoObjs(t, { y: s.y, walk: s.air ? 0.2 : 1, duck: s.duck && !s.air, air: s.air, col: P.dino }));
  // obstáculos
  for (const o of s.obs) {
    if (o.kind === 'cactus') {
      for (let i = 0; i < o.n; i++) objs.push(...tree(`${o.id}-${i}`, [(i - (o.n - 1) / 2) * 0.9, 0, o.z], { kind: 'cactus', h: o.h / 2.75, leaf: P.cactus }));
    } else if (o.kind === 'bird') objs.push(...birdObjs(o, day ? '#8a5a2b' : '#c0c0ff'));
    else objs.push(...coin('co' + o.id, [0, o.y, o.z], { t }));
  }
  // mesetas lejanas
  return {
    sky: { top: P.top, bottom: P.bottom, sun: day, clouds: day ? 5 : 0 },
    fog: { c: P.bottom, near: 18, far: 60 },
    light: { dir: [-0.45, 0.8, 0.4], sun: day ? '#fff1d6' : '#8fa6ff', i: day ? 2.6 : 0.9, sky: day ? '#dfeaff' : '#3a4a86', ground: '#5b4a30', hi: day ? 1.8 : 0.8 },
    shadowR: 12,
    statics: MESAS,
    objs,
    cam: { p: [0, s.camY, 7.8], l: [0, 0.7, -5], fov: 58 },
  };
}

export function DinoRun3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('dino');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const jump = () => {
    const s = g.current;
    if (phase !== 'play' || s.air) return;
    s.vy = DN_JUMP; s.air = true; s.duck = false; hx.tap();
    burst3d([0, 0.05, 0.6], '#e9c580', 8, { speed: 2.2, up: 1.4, g: 6, size: 0.14, life: 0.5 });
  };
  const setDuck = on => { const s = g.current; if (phase === 'play') s.duck = on; };
  const die = s => {
    fx.shake(10, 0.35); fx.flash(C.red, 0.3); hx.die();
    burst3d([0, s.y + 1, 0], ['#ffb347', '#e9c580', '#ffffff'], 30, { speed: 5, up: 3, g: 9, size: 0.2, life: 0.9 });
    setRes({ isNew: submitBest(Math.floor(s.dist)) });
    setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.speed = Math.min(20, 9 + s.t * 0.25);
    s.dist += s.speed * dt * 0.5;
    s.scroll += s.speed * dt;
    const want = Math.floor(s.dist / 400) % 2 === 1 ? 1 : 0;
    s.night = !!want;
    s.nk += (want - s.nk) * Math.min(1, dt * 0.8);
    s.camY += (4.4 + s.y * 0.35 - s.camY) * Math.min(1, dt * 6);
    if (s.air) {
      s.vy -= (s.duck ? DN_G_DUCK : DN_G) * dt;
      s.y += s.vy * dt;
      if (s.y <= 0) { s.y = 0; s.vy = 0; s.air = false; burst3d([0, 0.05, 0.4], '#e9c580', 8, { speed: 2.4, up: 1, g: 6, size: 0.14, life: 0.5 }); }
    }
    s.dustT -= dt;
    if (s.dustT <= 0 && !s.air) { s.dustT = 0.16; burst3d([0, 0.05, 0.9], '#e9c580', 2, { speed: 1.2, up: 0.8, g: 5, size: 0.12, life: 0.45 }); }
    s.next -= dt;
    if (s.next <= 0) {
      spawnObs(s);
      s.next = Math.max(0.55, rand(0.9, 1.7) - s.t * 0.012) * (9 / s.speed) + 0.25;
    }
    const top = s.air || !s.duck ? DN_TOP : DN_TOP_DUCK;
    for (let i = s.obs.length - 1; i >= 0; i--) {
      const o = s.obs[i];
      o.z += s.speed * dt; o.ph += dt;
      if (o.z > 7) { s.obs.splice(i, 1); continue; }
      if (Math.abs(o.z) > o.dz / 2 + DN_HD) continue;
      const bottom = o.kind === 'cactus' ? 0 : o.y - o.r;
      const oTop = o.kind === 'cactus' ? o.h : o.y + o.r;
      if (!(s.y < oTop && top > bottom)) continue;
      if (o.kind === 'coin') {
        s.obs.splice(i, 1); s.coins += 1; s.dist += 12;
        burst3d([0, o.y, o.z], ['#ffc233', '#fff3b0'], 16, { speed: 3.5, size: 0.14, life: 0.6 });
        fx.pop(AREA_W / 2, AREA_H * 0.4, '+12', C.amber, 15); hx.good();
      } else { die(s); return; }
    }
  });

  const s = g.current;
  const scene = buildScene(s, s.t, s.scroll);
  const menu = t => buildScene(g.current, t, t * 9);

  return (
    <Game3D title="DINO RUN" emoji="🦖" accent={C.lime} onExit={onExit} score={Math.floor(s.dist)} best={best} scoreLabel="DISTANCIA" fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={menu} orbit={{ c: [0, 1.0, -0.6], r: 6.4, h: 2.4, speed: 0.2, ly: 1.2, drop: 2.6 }}
      hud={<><HudPill icon="🪙" value={s.coins} color={C.amber} /><HudPill icon="⚡" value={`${Math.round(s.speed)}`} color={C.lime} />{s.night ? <HudPill icon="🌙" value="NOCHE" color={C.violet} /> : null}</>}
      subtitle="La carrera infinita por el desierto 3D"
      lines={['Toca la izquierda para saltar', 'Mantén la derecha para agacharte', 'Aves altas: agáchate · aves bajas: salta', 'Cambia de día a noche cada 400 m']}
      result={{ isNew: res.isNew, title: 'EXTINTO', emoji: '🦖', subtitle: `Corriste ${Math.floor(s.dist)} m`, stats: [['METROS', Math.floor(s.dist)], ['MONEDAS', s.coins]] }}>
      {phase === 'play' && <>
        <TouchBtn testID="saltar" onDown={jump} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '60%' }}>
          <Text pointerEvents="none" style={{ position: 'absolute', bottom: 150, left: 0, right: 0, textAlign: 'center', color: alpha('#ffffff', 0.5), fontSize: 11, fontWeight: '800', letterSpacing: 2 }}>TOCA · SALTAR</Text>
        </TouchBtn>
        <TouchBtn testID="agachar" onDown={() => setDuck(true)} onUp={() => setDuck(false)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '40%' }}>
          <Text pointerEvents="none" style={{ position: 'absolute', bottom: 150, left: 0, right: 0, textAlign: 'center', color: alpha('#ffffff', 0.5), fontSize: 11, fontWeight: '800', letterSpacing: 2 }}>MANTÉN · AGACHAR</Text>
        </TouchBtn>
      </>}
    </Game3D>
  );
}
