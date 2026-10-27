import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, Combo, GameScreen, Overlay, PlayArea, alpha, hx, randInt, uid, useBest, useFX, useLoop, usePan, tglow } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Túnel en PRIMERA PERSONA: la cámara está en el eje del túnel y mira hacia el fondo.
// Los anillos de pared (con huecos) vienen hacia la cámara. Para cambiar de carril, el túnel gira
// alrededor de la cámara: el carril del jugador siempre queda abajo, donde está la nave.
const NT_N = 8;            // carriles (huecos posibles) por anillo
const NT_R = 4.4;          // radio de la pared del túnel
const NT_PR = 3.4;         // radio de la nave y de las gemas (dentro del túnel)
const NT_CROSS = -7;       // profundidad donde la nave cruza los anillos
const NT_DEPTH = 50;       // distancia que recorre un anillo desde el fondo hasta la nave
const NT_STEP = (Math.PI * 2) / NT_N;

// Ángulo en pantalla de un carril: el carril `ang` queda justo abajo (-π/2)
const laneAng = (lane, ang) => -Math.PI / 2 + (lane - ang) * NT_STEP;
const ringZ = r => NT_CROSS - (1 - r.z) * NT_DEPTH;
const hsh = n => { const v = Math.sin(n * 91.3458) * 47453.5453; return v - Math.floor(v); };

// Partículas de velocidad dentro del túnel
const speedDots = (s) => Array.from({ length: 30 }, (_, i) => {
  const a = hsh(i) * Math.PI * 2;
  const rad = 1.5 + hsh(i + 9) * 2.6;
  const z = -50 + ((hsh(i + 3) * 52 + s.dist * NT_DEPTH * 0.5) % 52);
  return { id: `sp${i}`, k: 'sph', p: [rad * Math.cos(a), rad * Math.sin(a), z], n: 0.1, c: '#bfeeff', e: 1 };
});

const tunnelObjs = s => {
  const out = [];
  // guías longitudinales entre carriles (dan sensación de avance)
  for (let i = 0; i < NT_N; i++) {
    const a = laneAng(i - 0.5, s.ang);
    out.push({ id: `rl${i}`, k: 'box', p: [NT_R * Math.cos(a), NT_R * Math.sin(a), -30], s: [0.14, 0.14, 64], c: C.violet, e: 0.7 });
  }
  for (const r of s.rings) {
    const z = ringZ(r);
    if (z > 2) continue;
    const col = z > NT_CROSS - 14 ? C.red : `hsl(${r.hue},100%,58%)`;
    const w = (2 * Math.PI * NT_R / NT_N) * 0.84;
    for (let lane = 0; lane < NT_N; lane++) {
      if (r.free.includes(lane)) continue;
      const a = laneAng(lane, s.ang);
      out.push({ id: `r${r.id}-${lane}`, k: 'box', p: [NT_R * Math.cos(a), NT_R * Math.sin(a), z], s: [w, 0.7, 0.6], r: [0, 0, a + Math.PI / 2], c: col, e: 0.6 });
    }
    if (r.gem >= 0 && !r.done) {
      const a = laneAng(r.gem, s.ang);
      out.push({ id: `g${r.id}`, k: 'sph', p: [NT_PR * Math.cos(a), NT_PR * Math.sin(a), z], n: 0.8, c: C.amber, e: 1 });
    }
  }
  return out;
};

// Nave fija abajo, en el carril del jugador (el túnel gira, no la nave)
const shipObjs = () => [
  { id: 'nt-ship', k: 'cone', p: [0, -NT_PR, NT_CROSS], s: [0.6, 1.5, 0.6], r: [-Math.PI / 2, 0, 0], c: C.cyan, e: 0.6 },
  { id: 'nt-wing', k: 'box', p: [0, -NT_PR - 0.1, NT_CROSS + 0.2], s: [1.8, 0.08, 0.7], c: C.violet, e: 0.5 },
  { id: 'nt-glow', k: 'sph', p: [0, -NT_PR, NT_CROSS + 0.8], n: 0.35, c: C.orange, e: 1 },
];

const initState = () => ({
  lane: 0, ang: 0, rings: [], t: 0, dist: 0, speed: 0.55, since: 0, passed: 0, streak: 0, gems: 0, score: 0,
});

export function NeonTunnel3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('tunnel');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const spawnRing = s => {
    const nFree = s.passed > 40 ? 2 : 3;
    const f0 = randInt(0, NT_N - 1);
    const free = [];
    for (let i = 0; i < nFree; i++) free.push((f0 + i) % NT_N);
    s.rings.push({ id: uid(), z: 0.02, free, hue: (s.passed * 23) % 360, gem: Math.random() < 0.45 ? free[randInt(0, nFree - 1)] : -1, done: false });
  };
  const start = () => { fx.clear(); g.current = initState(); spawnRing(g.current); setPhase('play'); hx.hit(); };
  const shift = d => {
    const s = g.current;
    if (phase !== 'play') return;
    s.lane = (s.lane + d + NT_N) % NT_N; hx.tick();
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.speed = Math.min(1.5, 0.55 + s.t * 0.012);
    s.dist += s.speed * dt;
    s.since += s.speed * dt;
    if (s.since > 0.27) { s.since = 0; spawnRing(s); }
    // giro suave del túnel hacia el carril del jugador (camino más corto)
    let diff = ((s.lane - s.ang) % NT_N + NT_N) % NT_N;
    if (diff > NT_N / 2) diff -= NT_N;
    s.ang += diff * Math.min(1, dt * 22);
    for (let i = s.rings.length - 1; i >= 0; i--) {
      const r = s.rings[i];
      r.z += s.speed * dt;
      if (!r.done && r.z >= 1) {
        r.done = true;
        if (!r.free.includes(s.lane)) {
          fx.burst(AREA_W / 2, AREA_H * 0.78, C.red, 26, 280, 0.8, 6); fx.shake(11, 0.4); fx.flash(C.red, 0.35); hx.die();
          setRes({ isNew: submitBest(s.score) });
          setPhase('over');
          return;
        }
        s.passed += 1; s.streak += 1;
        const mult = 1 + Math.floor(s.streak / 8);
        s.score += 10 * mult;
        if (r.gem === s.lane) {
          s.gems += 1; s.score += 25 * mult;
          fx.burst(AREA_W / 2, AREA_H * 0.78, C.amber, 12, 180); fx.pop(AREA_W / 2, AREA_H * 0.7, `+${25 * mult}`, C.amber, 16); hx.good();
        } else hx.tap();
        if (s.streak % 8 === 0) { fx.ring(AREA_W / 2, AREA_H / 2, C.lime, 120); fx.pop(AREA_W / 2, AREA_H / 2 - 50, `RACHA ×${1 + s.streak / 8}`, C.lime, 20); }
      }
      if (r.z > 1.25) s.rings.splice(i, 1);
    }
  });

  const pan = usePan(fx, { down: x => shift(x < AREA_W / 2 ? -1 : 1) });
  const s = g.current;
  const mult = 1 + Math.floor(s.streak / 8);
  const shake = fx.shakeT > 0 ? (Math.random() - 0.5) * fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.1 : 0;
  const scene = {
    bg: '#00000f', fog: { c: '#00000f', near: 8, far: 50 },
    objs: [...speedDots(s), ...tunnelObjs(s), ...shipObjs()],
    cam: { p: [shake, shake * 0.6, 0], yaw: 0, pitch: 0, fov: 70 },
  };

  return (
    <GameScreen title="NEON TUNNEL" emoji="🌀" accent={C.cyan} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Anillos: <Text style={{ color: C.cyan, fontWeight: '800' }}>{s.passed}</Text></Text><Combo n={mult} color={C.lime} /><Text style={{ color: C.dim, fontSize: 12 }}>💎 <Text style={{ color: C.amber, fontWeight: '800' }}>{s.gems}</Text></Text></>}>
      <PlayArea fx={fx} bg="#00000f" {...pan}>
        <World3D scene={scene} />
        {phase === 'play' && <Text pointerEvents="none" style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', color: alpha(C.cyan, 0.45), fontSize: 13, fontWeight: '900', letterSpacing: 2 }}>◀ TOCA IZQUIERDA · DERECHA ▶</Text>}
        {s.streak >= 8 && phase === 'play' && <Text pointerEvents="none" style={{ position: 'absolute', top: 12, width: AREA_W, textAlign: 'center', color: alpha(C.lime, 0.7), fontSize: 12, fontWeight: '900', ...tglow(C.lime, 8) }}>RACHA ACTIVA</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🌀" title={phase === 'over' ? 'CHOQUE' : 'NEON TUNNEL 3D'}
          subtitle={phase === 'over' ? `${s.passed} anillos cruzados` : 'Atraviesa los huecos del túnel'}
          score={s.score} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca izquierda o derecha para girar de carril', 'Vuelas dentro del túnel: cruza por los huecos libres', '💎 da bonus · las rachas multiplican'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
