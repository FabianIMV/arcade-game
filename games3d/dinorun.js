import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, TouchBtn, alpha, hx, rand, uid, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Tercera persona: el dinosaurio corre por una pista 3D hacia el fondo y la cámara va detrás.
// Los obstáculos vienen hacia la cámara. Toca la mitad izquierda para saltar y mantén la derecha para agacharte.
const DN_G = 21, DN_JUMP = 9.2, DN_G_DUCK = 40, DN_TOP = 1.7, DN_TOP_DUCK = 1.1, DN_HD = 0.5;
const DN_DAY = { bg: '#d9d8c2', fg: '#2b2b3a', ground: '#cfcdb1', cactus: '#2f6b3a' };
const DN_NIGHT = { bg: '#0b0b1c', fg: '#e9e9ff', ground: '#101028', cactus: '#2b5a6a' };

const initState = () => ({
  y: 0, vy: 0, duck: false, air: false, t: 0, dist: 0, speed: 9, obs: [], next: 1.1, night: false, scroll: 0,
  clouds: Array.from({ length: 4 }, (_, i) => ({ id: `cl${i}`, x: rand(-7, 7), y: rand(4.5, 7.5), z: -20 + i * 12 })),
  dashes: Array.from({ length: 16 }, (_, i) => ({ id: `ds${i}`, x: rand(-4, 4), z0: (i / 16) * 40 })), coins: 0,
});

// Obstáculos: cactus en el suelo, pájaro alto (hay que agacharse) o bajo (hay que saltar), y monedas en el aire.
const spawnObs = s => {
  const r = Math.random();
  if (s.dist > 120 && r < 0.3) {
    const high = Math.random() < 0.5;   // alto: agacharse · bajo: saltar
    s.obs.push({ id: uid(), kind: 'bird', z: -40, dz: 1.0, y: high ? 1.5 : 0.5, r: 0.35, ph: 0 });
  } else if (r < 0.4) {
    s.obs.push({ id: uid(), kind: 'coin', z: -40, dz: 0.7, y: rand(1.0, 2.2), r: 0.4 });
  } else {
    const n = 1 + Math.floor(Math.random() * Math.min(3, 1 + s.dist / 250));
    s.obs.push({ id: uid(), kind: 'cactus', z: -40, dz: 0.8, n, h: rand(1.1, 1.6), y: 0, r: 0 });
  }
};

export function DinoRun3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('dino');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const jump = () => {
    const s = g.current;
    if (phase !== 'play' || s.air) return;
    s.vy = DN_JUMP; s.air = true; s.duck = false; hx.tap();
  };
  const setDuck = on => { const s = g.current; if (phase === 'play') s.duck = on; };
  const die = s => {
    fx.shake(10, 0.35); fx.flash(C.red, 0.3); hx.die();
    setRes({ isNew: submitBest(Math.floor(s.dist)) });
    setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.speed = Math.min(20, 9 + s.t * 0.25);
    s.dist += s.speed * dt * 0.5;
    s.scroll += s.speed * dt;
    s.night = Math.floor(s.dist / 400) % 2 === 1;
    if (s.air) {
      s.vy -= (s.duck ? DN_G_DUCK : DN_G) * dt;
      s.y += s.vy * dt;
      if (s.y <= 0) { s.y = 0; s.vy = 0; s.air = false; fx.burst(AREA_W / 2, AREA_H * 0.8, '#c9c9a8', 5, 70, 0.3, 3); }
    }
    s.clouds.forEach(c => { c.z += s.speed * 0.12 * dt; if (c.z > 8) { c.z = -40; c.x = rand(-7, 7); c.y = rand(4.5, 7.5); } });
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
        fx.pop(AREA_W / 2, AREA_H * 0.4, '+12', C.amber, 15); hx.good();
      } else { die(s); return; }
    }
  });

  const s = g.current;
  const pal = s.night ? DN_NIGHT : DN_DAY;
  const fgc = pal.fg;
  const objs = [];
  objs.push({ id: 'suelo', k: 'pla', p: [0, -0.01, -20], s: [30, 90, 1], c: pal.ground });
  s.dashes.forEach(d => {
    const L = 40, z = ((d.z0 + s.scroll) % L) - L + 12;
    objs.push({ id: d.id, k: 'box', p: [d.x, 0.01, z], s: [0.14, 0.02, 2.2], c: fgc, o: 0.45 });
  });
  s.clouds.forEach(c => objs.push({ id: c.id, k: 'box', p: [c.x, c.y, c.z], s: [3, 0.5, 1.4], c: s.night ? '#3a3a66' : '#ffffff', o: s.night ? 0.5 : 0.85 }));
  // dinosaurio: se agacha reduciendo el cuerpo, las patas se alternan al correr
  const duck = s.duck && !s.air;
  const lift = s.air ? 0 : Math.max(0, Math.sin(s.t * 28)) * 0.12;
  objs.push({ id: 'pataI', k: 'box', p: [-0.22, s.y + 0.22 + (s.air ? 0.2 : lift), 0.1], s: [0.22, 0.45, 0.22], c: fgc });
  objs.push({ id: 'pataD', k: 'box', p: [0.22, s.y + 0.22 + (s.air ? 0.2 : Math.max(0, -Math.sin(s.t * 28)) * 0.12), 0.1], s: [0.22, 0.45, 0.22], c: fgc });
  objs.push({ id: 'cuerpo', k: 'box', p: [0, s.y + (duck ? 0.6 : 0.9), 0.1], s: [0.8, duck ? 0.45 : 0.7, 1.3], c: fgc });
  objs.push({ id: 'cola', k: 'box', p: [0, s.y + (duck ? 0.6 : 0.8), 1.0], s: [0.3, 0.3, 0.9], c: fgc });
  objs.push({ id: 'cabeza', k: 'box', p: [0, s.y + (duck ? 0.8 : 1.45), -0.45], s: [0.55, 0.55, 0.6], c: fgc });
  objs.push({ id: 'ojo', k: 'sph', p: [0.16, s.y + (duck ? 0.9 : 1.55), -0.78], n: 0.12, c: '#ffffff', e: 0.4 });
  // obstáculos
  s.obs.forEach(o => {
    if (o.kind === 'cactus') {
      for (let i = 0; i < o.n; i++) objs.push({ id: `${o.id}-${i}`, k: 'cyl', p: [(i - (o.n - 1) / 2) * 0.55, o.h / 2, o.z], s: [0.32, o.h, 0.32], c: pal.cactus });
    } else if (o.kind === 'bird') {
      const flap = Math.sin(o.ph * 14) * 0.5;
      objs.push({ id: `${o.id}-b`, k: 'sph', p: [0, o.y, o.z], n: 0.7, c: s.night ? '#c0c0ff' : '#8a5a2b' });
      objs.push({ id: `${o.id}-wi`, k: 'box', p: [-0.45, o.y + 0.1, o.z], s: [0.7, 0.08, 0.3], r: [0, 0, flap], c: s.night ? '#c0c0ff' : '#8a5a2b' });
      objs.push({ id: `${o.id}-wd`, k: 'box', p: [0.45, o.y + 0.1, o.z], s: [0.7, 0.08, 0.3], r: [0, 0, -flap], c: s.night ? '#c0c0ff' : '#8a5a2b' });
    } else {
      objs.push({ id: `${o.id}-m`, k: 'tor', p: [0, o.y, o.z], n: 0.7, r: [0, s.t * 3, 0], c: '#ffc233', e: 0.2 });
    }
  });

  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.05 : 0;
  const scene = {
    bg: pal.bg, fog: { c: pal.bg, near: 12, far: 40 }, objs,
    cam: { p: [(Math.random() - 0.5) * shake, 3.4, 6.6], l: [0, 0.9, -6], fov: 58 },
  };

  return (
    <GameScreen title="DINO RUN" emoji="🦖" accent={C.lime} onExit={onExit} score={Math.floor(s.dist)} best={best} scoreLabel="DISTANCIA"
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Monedas: <Text style={{ color: C.amber, fontWeight: '800' }}>{s.coins}</Text></Text><Text style={{ color: C.dim, fontSize: 12 }}>Vel. {Math.round(s.speed)}</Text></>}>
      <PlayArea fx={fx} bg={pal.bg} border={s.night ? C.line : '#9a9880'}>
        <World3D scene={scene} />
        {phase === 'play' && <>
          <TouchBtn testID="saltar" onDown={jump} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: AREA_W * 0.6 }}>
            <Text pointerEvents="none" style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', color: alpha(fgc, 0.45), fontSize: 11, fontWeight: '800', letterSpacing: 2 }}>TOCA · SALTAR</Text>
          </TouchBtn>
          <TouchBtn testID="agachar" onDown={() => setDuck(true)} onUp={() => setDuck(false)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: AREA_W * 0.4 }}>
            <Text pointerEvents="none" style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', color: alpha(fgc, 0.45), fontSize: 11, fontWeight: '800', letterSpacing: 2 }}>MANTÉN · AGACHAR</Text>
          </TouchBtn>
        </>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🦖" title={phase === 'over' ? 'EXTINTO' : 'DINO RUN'}
          subtitle={phase === 'over' ? `Corriste ${Math.floor(s.dist)} m` : 'La carrera infinita en 3D'}
          score={Math.floor(s.dist)} scoreLabel="METROS" best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca la izquierda para saltar', 'Mantén la derecha para agacharte', 'Aves altas: agáchate · aves bajas: salta', 'Cambia de día a noche cada 400 m'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
