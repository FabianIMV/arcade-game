import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, clamp, hx, rand, useBest, useFX, useLoop, usePan, alpha, tglow } from '../utils/kit';
import { World3D } from '../utils/World3D';

// PING PONG 3D: mesa de verdad. Tu paleta está abajo (cerca de la cámara), la IA arriba (al fondo).
// Cámara en tercera persona detrás de tu paleta, mirando hacia la mesa.
const TW = 7.2, PZ = 5.2, AZ = -5.2;      // ancho de la mesa (x); z de tu paleta y de la de la IA
const PW0 = 1.5, PD = 0.36, BR = 0.2;     // ancho y grosor de paleta, radio de la bola
const WIN = 7, SP0 = 5.6, SPMAX = 12.5;   // partido a 7; velocidades en unidades/s
const CAM = { p: [0, 3.4, PZ + 8], l: [0, 0, -3], fov: 66 };

// Proyecta un punto 3D a píxeles del PlayArea con la misma cámara del motor (para situar efectos 2D).
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
// px de pantalla por unidad de x a una profundidad dada (para pasar del dedo a la paleta)
const pxPerUnit = z => sproj(CAM, 1, 0.2, z)[0] - AREA_W / 2;

const initState = () => ({
  px: 0, ax: 0, pvel: 0, lastPx: 0, ball: { x: 0, z: 0, vx: 0, vz: 0 }, speed: SP0,
  me: 0, ai: 0, level: 1, total: 0, serve: 1, wait: 1.0, rally: 0, trail: [], t: 0, aiErr: 0,
  banner: { text: 'PARTIDO 1', t: 1.3 },
});

export function PingPong3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('pingpong');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const serveBall = s => {
    s.speed = SP0 + (s.level - 1) * 0.27; s.rally = 0;
    const a = rand(-0.5, 0.5);
    s.ball = { x: 0, z: 0, vx: Math.sin(a) * s.speed, vz: Math.cos(a) * s.speed * s.serve };
    s.wait = 0; s.trail = [];
  };
  const score = (s, who) => {
    s.wait = 0.9; s.ball.vx = 0; s.ball.vz = 0;
    const [ex, ey] = sproj(CAM, s.ball.x, BR, who === 'me' ? AZ : PZ);
    if (who === 'me') {
      s.me += 1; s.total += 1; s.serve = -1;
      fx.burst(ex, ey, C.cyan, 16, 220); fx.pop(AREA_W / 2, AREA_H / 2 - 40, '¡PUNTO!', C.lime, 22); hx.good();
    } else {
      s.ai += 1; s.serve = 1;
      fx.burst(ex, ey, C.red, 16, 220); fx.shake(7, 0.3); fx.flash(C.red, 0.2); hx.bad();
    }
    s.ball.x = 0; s.ball.z = 0;
    if (s.me >= WIN) {
      s.level += 1; s.me = 0; s.ai = 0; s.wait = 1.4; s.total += 3;
      s.banner = { text: `PARTIDO GANADO · NIVEL ${s.level}`, t: 1.6 }; fx.flash('#fff', 0.25); hx.win();
      fx.pop(AREA_W / 2, AREA_H / 2, '+3', C.amber, 24);
    } else if (s.ai >= WIN) {
      hx.die(); setRes({ isNew: submitBest(s.total) }); setPhase('over');
    }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.pvel = (s.px - s.lastPx) / dt; s.lastPx = s.px;
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    const b = s.ball;
    // IA: sigue la bola con un pequeño error que cambia en cada golpe
    const aiSpeed = 2.5 + s.level * 0.74;
    const target = b.vz < 0 ? b.x + s.aiErr : 0;
    s.ax += clamp(target - s.ax, -aiSpeed * dt, aiSpeed * dt);
    s.ax = clamp(s.ax, -TW / 2 + 0.8, TW / 2 - 0.8);
    if (s.wait > 0) { s.wait -= dt; if (s.wait <= 0) serveBall(s); return; }

    b.x += b.vx * dt; b.z += b.vz * dt;
    s.trail.push({ x: b.x, z: b.z, a: 0.5 }); s.trail.forEach(p => { p.a -= dt * 2.5; }); s.trail = s.trail.filter(p => p.a > 0);
    const HW = TW / 2 - BR;
    if (b.x < -HW) { b.x = -HW; b.vx = Math.abs(b.vx); hx.tick(); }
    if (b.x > HW) { b.x = HW; b.vx = -Math.abs(b.vx); hx.tick(); }
    // tu paleta (la bola viene hacia la cámara: vz > 0)
    if (b.vz > 0 && b.z + BR >= PZ - PD / 2 && b.z - BR <= PZ + PD / 2 + 0.6 && Math.abs(b.x - s.px) < PW0 / 2 + BR) {
      const rel = clamp((b.x - s.px) / (PW0 / 2 + BR), -1, 1);
      s.rally += 1;
      let sp = Math.min(SPMAX, s.speed + 0.3);
      const [sx, sy] = sproj(CAM, b.x, BR, PZ);
      if (Math.abs(s.pvel) > 10) { sp = Math.min(SPMAX + 0.8, sp * 1.22); fx.pop(sx, sy - 30, 'SMASH', C.amber, 18); fx.ring(sx, sy, C.amber, 50); fx.shake(4); hx.heavy(); } else hx.hit();
      s.speed = sp;
      const a = rel * 1.0 + clamp(s.pvel / 60, -0.3, 0.3);
      b.vx = Math.sin(a) * sp; b.vz = -Math.cos(a) * sp; b.z = PZ - PD / 2 - BR;
      s.aiErr = rand(-1, 1) * Math.max(0.16, 1.37 - s.level * 0.16);
      fx.burst(sx, sy, C.cyan, 6, 120, 0.3, 3);
    }
    // paleta de la IA (la bola va hacia el fondo: vz < 0)
    if (b.vz < 0 && b.z - BR <= AZ + PD / 2 && b.z + BR >= AZ - PD / 2 - 0.6 && Math.abs(b.x - s.ax) < PW0 / 2 + BR) {
      const rel = clamp((b.x - s.ax) / (PW0 / 2 + BR), -1, 1);
      const sp = Math.min(SPMAX, s.speed + 0.2); s.speed = sp;
      const a = rel * 0.95;
      b.vx = Math.sin(a) * sp; b.vz = Math.cos(a) * sp; b.z = AZ + PD / 2 + BR;
      const [sx, sy] = sproj(CAM, b.x, BR, AZ);
      fx.burst(sx, sy, C.pink, 6, 120, 0.3, 3); hx.tick();
    }
    if (b.z > PZ + 1.2) score(s, 'ai');
    else if (b.z < AZ - 1.2) score(s, 'me');
  });

  const setPx = x => { const s = g.current; s.px = clamp((x - AREA_W / 2) / pxPerUnit(PZ), -TW / 2 + PW0 / 2, TW / 2 - PW0 / 2); };
  const pan = usePan(fx, { down: setPx, move: setPx });

  const s = g.current;
  const b = s.ball;
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, 0], s: [TW + 2.4, 30, 1], c: '#14307a' },
    { id: 'raya-i', k: 'box', p: [-TW / 2 - 0.12, 0.12, 0], s: [0.24, 0.24, 16], c: C.blue, e: 0.7 },
    { id: 'raya-d', k: 'box', p: [TW / 2 + 0.12, 0.12, 0], s: [0.24, 0.24, 16], c: C.blue, e: 0.7 },
    { id: 'fondo', k: 'box', p: [0, 0.8, AZ - 1.8], s: [TW + 1, 1.6, 0.3], c: C.blue, e: 0.4 },
    { id: 'red', k: 'box', p: [0, 0.22, 0], s: [TW, 0.44, 0.06], c: C.text, o: 0.35 },
    { id: 'ia', k: 'box', p: [s.ax, 0.2, AZ], s: [PW0, 0.4, PD], c: C.pink, e: 0.5 },
    { id: 'yo', k: 'box', p: [s.px, 0.2, PZ], s: [PW0, 0.4, PD], c: C.cyan, e: 0.5 },
    { id: 'sombra', k: 'pla', p: [b.x, 0.01, b.z], s: [0.5, 0.5, 1], c: '#000000', o: 0.35 },
    ...s.trail.map((p, i) => ({ id: `tr${i}`, k: 'sph', p: [p.x, BR, p.z], n: BR * 1.5, c: C.blue, e: 0.4, o: Math.max(0, p.a * 0.6) })),
    { id: 'bola', k: 'sph', p: [b.x, BR, b.z], n: BR * 2, c: '#ffffff', e: 0.8 },
  ];
  const scene = {
    bg: '#03060f', fog: { c: '#03060f', near: 16, far: 34 }, objs,
    cam: { p: [(Math.random() - 0.5) * shake, CAM.p[1], CAM.p[2]], l: CAM.l, fov: CAM.fov },
  };
  return (
    <GameScreen title="PING PONG" emoji="🏓" accent={C.blue} onExit={onExit} score={s.total} best={best} scoreLabel="PUNTOS"
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Nivel IA <Text style={{ color: C.blue, fontWeight: '800' }}>{s.level}</Text></Text><Text style={{ color: C.text, fontSize: 16, fontWeight: '900' }}><Text style={{ color: C.cyan }}>{s.me}</Text> - <Text style={{ color: C.pink }}>{s.ai}</Text></Text><Text style={{ color: C.dim, fontSize: 12 }}>Racha <Text style={{ color: C.amber, fontWeight: '800' }}>{s.rally}</Text></Text></>}>
      <PlayArea fx={fx} bg="#03060f" border={alpha(C.blue, 0.4)} {...pan}>
        <World3D scene={scene} />
        <Text pointerEvents="none" style={{ position: 'absolute', top: 8, left: 12, color: C.pink, fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>IA</Text>
        <Text pointerEvents="none" style={{ position: 'absolute', bottom: 8, left: 12, color: C.cyan, fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>TÚ</Text>
        {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.3, width: AREA_W, textAlign: 'center', color: C.text, fontSize: 20, fontWeight: '900', letterSpacing: 2, opacity: Math.min(1, s.banner.t), ...tglow(C.blue, 12) }}>{s.banner.text}</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🏓" title={phase === 'over' ? 'PARTIDO PERDIDO' : 'PING PONG 3D'}
          subtitle={phase === 'over' ? `Llegaste al nivel ${s.level} de IA` : 'Gana partidos a 7 contra una IA cada vez mejor'}
          score={s.total} best={best} isNew={res.isNew} accent={C.blue} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para mover tu paleta', 'Pega con el borde para desviar la bola', 'Mueve la paleta rápido al golpear: ¡SMASH!', 'Ganar un partido da +3 y sube la dificultad'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
