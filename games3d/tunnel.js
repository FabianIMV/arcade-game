import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { C, Combo, SCREEN_W, alpha, hx, randInt, uid, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill } from '../utils/ui3d';
import { ship } from '../utils/prefabs';

// NEON TUNNEL 3D – túnel en PRIMERA PERSONA. Récord: 'tunnel'.
// La cámara está en el eje del túnel y mira al fondo. Los anillos de pared (con huecos) vienen hacia ti.
// La nave queda abajo, en su carril: el túnel gira alrededor de ti para cambiar de carril.
// Botones ◀ ▶ para girar de carril · 💎 da bonus · las rachas multiplican.
const NT_N = 8;            // carriles (huecos posibles) por anillo
const NT_R = 4.4;          // radio de la pared del túnel
const NT_PR = 3.4;         // distancia de la nave al centro del túnel (dentro de la pared)
const NT_CROSS = -7;       // profundidad donde la nave cruza los anillos
const NT_DEPTH = 50;       // distancia que recorre un anillo desde el fondo hasta la nave
const NT_STEP = (Math.PI * 2) / NT_N;

// Ángulo en pantalla de un carril: el carril `ang` queda justo abajo (-π/2)
const laneAng = (lane, ang) => -Math.PI / 2 + (lane - ang) * NT_STEP;
const ringZ = r => NT_CROSS - (1 - r.z) * NT_DEPTH;
const hsh = n => { const v = Math.sin(n * 91.3458) * 47453.5453; return v - Math.floor(v); };
const clamp8 = v => Math.max(-0.5, Math.min(0.5, v));   // inclinación máxima de la nave (rad)

// Chispas de velocidad dentro del túnel (instancing)
const speedDots = fly => Array.from({ length: 30 }, (_, i) => {
  const a = hsh(i) * Math.PI * 2;
  const rad = 1.5 + hsh(i + 9) * 2.6;
  const z = -50 + ((hsh(i + 3) * 52 + fly * NT_DEPTH * 0.5) % 52);
  return { k: 'sph', inst: 'nt-chispa', p: [rad * Math.cos(a), rad * Math.sin(a), z], n: 0.1, c: '#bfeeff', e: 1 };
});

const tunnelObjs = (s) => {
  const out = [];
  // guías longitudinales entre carriles (dan sensación de avance)
  for (let i = 0; i < NT_N; i++) {
    const a = laneAng(i - 0.5, s.ang);
    out.push({ id: `rl${i}`, k: 'box', p: [NT_R * Math.cos(a), NT_R * Math.sin(a), -30], s: [0.14, 0.14, 64], c: C.violet, e: 0.7 });
  }
  for (const r of s.rings) {
    const z = ringZ(r);
    if (z > 2) continue;
    const col = `hsl(${r.hue},100%,60%)`;
    const w = (2 * Math.PI * NT_R / NT_N) * 0.84;
    for (let lane = 0; lane < NT_N; lane++) {
      if (r.free.includes(lane)) continue;
      const a = laneAng(lane, s.ang);
      out.push({ k: 'box', inst: 'nt-muro', p: [NT_R * Math.cos(a), NT_R * Math.sin(a), z], s: [w, 0.7, 0.6], r: [0, 0, a + Math.PI / 2], c: col, e: 0.65 });
    }
    if (r.gem >= 0 && !r.done) {
      const a = laneAng(r.gem, s.ang);
      out.push({ k: 'oct', inst: 'nt-gema', p: [NT_PR * Math.cos(a), NT_PR * Math.sin(a), z], n: 0.8, r: [0, s.t * 2, s.t], c: C.amber, e: 1 });
    }
  }
  return out;
};

// Nave fija abajo, en su carril (el túnel gira, no la nave). Se inclina al cambiar de carril.
const shipObjs = s => (s.dead ? [] : ship('nt-nave', [0, -NT_PR, NT_CROSS], { c: '#e4eaff', c2: C.cyan, thrust: 0.9, t: s.t, n: 0.6, roll: s.bank }));

const buildScene = (s, fly) => ({
  sky: { top: '#0a0230', bottom: '#00000f', sun: false, clouds: 0 },
  fog: { c: '#05021a', near: 8, far: 50 },
  light: { dir: [-0.3, 0.8, 0.5], sun: '#dfe8ff', i: 1.8, sky: '#8fa0ff', ground: '#120a2a', hi: 1.2 },
  lights: [{ p: [0, -2.4, NT_CROSS + 1], c: '#22e6ff', i: 6, d: 9 }],
  objs: [...speedDots(fly), ...tunnelObjs(s), ...shipObjs(s)],
  cam: { p: [0, 0, 0], yaw: 0, pitch: 0, fov: 70 },
});

const initState = () => ({
  lane: 0, ang: 0, bank: 0, rings: [], t: 0, dist: 0, speed: 0.55, since: 0, passed: 0, streak: 0, maxStreak: 0, gems: 0, score: 0,
  dead: false, over: false,
});

// Anillos de demostración para el fondo animado de los menús
const demoState = t => ({
  ang: Math.sin(t * 0.4) * 1.2, t, bank: 0, dead: false,
  rings: Array.from({ length: 6 }, (_, i) => ({
    id: i, z: (i * 0.22 + t * 0.2) % 1.25, free: [(i * 3) % NT_N, (i * 3 + 1) % NT_N, (i * 3 + 2) % NT_N],
    hue: (i * 60 + t * 20) % 360, gem: i % 2 ? (i * 3) % NT_N : -1, done: false,
  })),
});

export function NeonTunnel3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('tunnel');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, passed: 0, maxStreak: 0, gems: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const spawnRing = (s, first) => {
    const nFree = s.passed > 40 ? 2 : 3;
    const f0 = first ? (s.lane - 1 + NT_N) % NT_N : randInt(0, NT_N - 1);   // el primer anillo deja libre tu carril
    const free = [];
    for (let i = 0; i < nFree; i++) free.push((f0 + i) % NT_N);
    // matiz: de cian a rosa, variando por anillo (así cada tramo del túnel tiene un color de neón distinto)
  s.rings.push({ id: uid(), z: 0.02, free, hue: 180 + ((s.passed * 29) % 180), gem: Math.random() < 0.45 ? free[randInt(0, nFree - 1)] : -1, done: false });
  };

  const start = () => { fx.clear(); clear3d(); g.current = initState(); spawnRing(g.current, true); setPhase('play'); hx.hit(); };

  const shift = d => {
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    s.lane = (s.lane + d + NT_N) % NT_N; hx.tick();
  };

  const finish = s => {
    if (s.over) return;
    s.over = true; s.dead = true;
    burst3d([0, -NT_PR, NT_CROSS], ['#ff4d6d', '#22e6ff', '#ffffff'], 60, { speed: 11, size: 0.28, life: 1.2, g: 3 });
    ring3d([0, -NT_PR, NT_CROSS], C.red, 30, { speed: 9, life: 0.8 });
    fx.shake(11, 0.4); fx.flash(C.red, 0.35); hx.die();
    setRes({ isNew: submitBest(s.score), passed: s.passed, maxStreak: s.maxStreak, gems: s.gems });
    setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    s.t += dt;
    s.speed = Math.min(1.5, 0.55 + s.t * 0.012);
    s.dist += s.speed * dt;
    s.since += s.speed * dt;
    if (s.since > 0.27) { s.since = 0; spawnRing(s); }
    // giro suave del túnel hacia el carril del jugador (camino más corto) y la nave se inclina
    let diff = ((s.lane - s.ang) % NT_N + NT_N) % NT_N;
    if (diff > NT_N / 2) diff -= NT_N;
    s.ang += diff * Math.min(1, dt * 22);
    s.bank += (clamp8(-diff * 0.35) - s.bank) * Math.min(1, dt * 8);
    for (let i = s.rings.length - 1; i >= 0; i--) {
      const r = s.rings[i];
      r.z += s.speed * dt;
      if (!r.done && r.z >= 1) {
        r.done = true;
        if (!r.free.includes(s.lane)) { finish(s); return; }
        s.passed += 1; s.streak += 1; s.maxStreak = Math.max(s.maxStreak, s.streak);
        const mult = 1 + Math.floor(s.streak / 8);
        s.score += 10 * mult;
        ring3d([0, -NT_PR, NT_CROSS], [C.cyan, C.lime], 14, { speed: 5, life: 0.5, size: 0.14 });
        if (r.gem === s.lane) {
          s.gems += 1; s.score += 25 * mult;
          burst3d([0, -NT_PR, NT_CROSS], [C.amber, '#ffffff'], 26, { speed: 7, size: 0.22, life: 0.8, g: 1 });
          hx.good();
        } else hx.tap();
        if (s.streak % 8 === 0) hx.warn();
      }
      if (r.z > 1.25) s.rings.splice(i, 1);
    }
  });

  const s = g.current;
  const mult = 1 + Math.floor(s.streak / 8);
  const scene = buildScene(s, s.dist);

  return (
    <Game3D title="NEON TUNNEL" emoji="🌀" accent={C.cyan} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene}
      menuScene={t => (g.current.over ? buildScene(g.current, g.current.dist) : buildScene(demoState(t), t * 10))}
      orbit={{ c: [0, -0.5, -9], r: 7, h: 1.2, speed: 0.25, ly: 0.8 }}
      hud={<>
        <HudPill label="ANILLOS" value={s.passed} color={C.cyan} />
        {mult > 1 ? <Combo n={mult} color={C.lime} /> : null}
        <HudPill icon="💎" value={s.gems} color={C.amber} />
      </>}
      subtitle="Atraviesa los huecos del túnel de neón"
      lines={['Botones ◀ ▶ para cambiar de carril', 'Cruza solo por los huecos libres de cada anillo', '💎 da bonus · las rachas multiplican']}
      result={{ won: false, isNew: res.isNew, title: 'CHOQUE', emoji: '💥', subtitle: `${res.passed} anillos cruzados`, stats: [['ANILLOS', res.passed], ['RACHA', res.maxStreak], ['GEMAS', res.gems]] }}>
      {phase === 'play' && <Text pointerEvents="none" style={{ position: 'absolute', top: 14, width: SCREEN_W, textAlign: 'center', color: alpha(C.cyan, 0.45), fontSize: 12, fontWeight: '900', letterSpacing: 2 }}>◀ · ▶</Text>}
      <ActionBtn testID="nt-izq" icon="◀" color={C.cyan} onDown={() => shift(-1)} size={70} style={{ left: 18, bottom: 40 }} />
      <ActionBtn testID="nt-der" icon="▶" color={C.cyan} onDown={() => shift(1)} size={70} style={{ right: 18, bottom: 40 }} />
    </Game3D>
  );
}
