import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Lives, Combo, Overlay, PlayArea, clamp, hx, rand, useBest, useFX, useLoop, usePan, alpha } from '../utils/kit';
import { World3D } from '../utils/World3D';

// PONG SOLO 3D: tu paleta abajo, una pared 3D al fondo y dos laterales. Cámara detrás de la paleta.
const TW = 7.2, HB = 6.6, PZ = 5.2;   // ancho de la pista (x), z del fondo (pared), z de tu paleta
const BR = 0.2, PD = 0.36, PW0 = 1.5, PW_MIN = 1.0;
const SPMAX = 11.5;
const CAM = { p: [0, 3.4, PZ + 8], l: [0, 0, -3], fov: 66 };

// Proyecta un punto 3D a píxeles del PlayArea con la misma cámara del motor (para efectos 2D).
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
const pxPerUnit = z => sproj(CAM, 1, 0.2, z)[0] - AREA_W / 2;

const initState = () => ({
  px: 0, pw: PW0, ball: { x: 0, z: PZ - 0.5, vx: 0, vz: 0 }, speed: 5.6, lives: 3, score: 0, hits: 0,
  bumpers: [], orb: null, orbT: 6, trail: [], t: 0, wait: 0.8, combo: 0,
});

export function PongSolo3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('pongsolo');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const launch = s => {
    const a = -Math.PI / 2 + rand(-0.4, 0.4);
    s.ball = { x: s.px, z: PZ - 0.5, vx: Math.cos(a) * s.speed, vz: Math.sin(a) * s.speed };
    s.wait = 0; s.combo = 0;
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.bumpers.forEach(bm => { if (bm.mv) { bm.x += bm.vx * dt; if (bm.x < -2.9 || bm.x > 2.9) bm.vx *= -1; } });
    s.orbT -= dt; if (s.orbT <= 0 && !s.orb) { s.orb = { x: rand(-3, 3), z: rand(-5.8, -1.5), life: 7 }; s.orbT = rand(6, 11); }
    if (s.orb) { s.orb.life -= dt; if (s.orb.life <= 0) s.orb = null; }
    const b = s.ball;
    if (s.wait > 0) { s.wait -= dt; b.x = s.px; b.z = PZ - 0.5; if (s.wait <= 0) launch(s); return; }
    const m = Math.hypot(b.vx, b.vz) || 1; b.vx *= s.speed / m; b.vz *= s.speed / m;
    b.x += b.vx * dt; b.z += b.vz * dt;
    s.trail.push({ x: b.x, z: b.z, a: 0.5 }); s.trail.forEach(p => { p.a -= dt * 2.5; }); s.trail = s.trail.filter(p => p.a > 0);
    // paredes laterales y pared del fondo
    if (b.x < -TW / 2 + BR) { b.x = -TW / 2 + BR; b.vx = Math.abs(b.vx); hx.tick(); }
    if (b.x > TW / 2 - BR) { b.x = TW / 2 - BR; b.vx = -Math.abs(b.vx); hx.tick(); }
    if (b.z < -HB + BR) { b.z = -HB + BR; b.vz = Math.abs(b.vz); hx.tick(); }
    // tu paleta (la bola viene hacia la cámara: vz > 0)
    if (b.vz > 0 && b.z + BR >= PZ - PD / 2 && b.z - BR <= PZ + 0.5 && Math.abs(b.x - s.px) < s.pw / 2 + BR) {
      const rel = clamp((b.x - s.px) / (s.pw / 2), -1, 1);
      s.hits += 1; s.combo = 0; s.score += 1;
      s.speed = Math.min(SPMAX, 5.6 + s.hits * 0.1);
      s.pw = Math.max(PW_MIN, PW0 - Math.floor(s.hits / 6) * 0.08);
      const a = -Math.PI / 2 + rel * 1.05;
      b.vx = Math.cos(a) * s.speed; b.vz = Math.sin(a) * s.speed; b.z = PZ - PD / 2 - BR;
      const [sx, sy] = sproj(CAM, b.x, BR, PZ); fx.burst(sx, sy, C.cyan, 6, 120, 0.3, 3); hx.hit();
      if (s.hits === 8) s.bumpers.push({ id: 'b1', x: 0, z: -2.6, r: 0.5, mv: false, vx: 0 });
      if (s.hits === 20) s.bumpers = [{ id: 'b2', x: -1.9, z: -1.6, r: 0.5, mv: true, vx: 1.2 }, { id: 'b3', x: 1.9, z: -3.0, r: 0.5, mv: true, vx: -1.2 }];
      if (s.hits === 36) s.bumpers.push({ id: 'b4', x: 0, z: -4.2, r: 0.55, mv: true, vx: 1.8 });
    }
    // bumpers (cilindros): rebote especular
    for (const bm of s.bumpers) {
      const dx = b.x - bm.x, dz = b.z - bm.z, d = Math.hypot(dx, dz);
      if (d < bm.r + BR) {
        const nx = dx / (d || 1), nz = dz / (d || 1);
        const dot = b.vx * nx + b.vz * nz;
        b.vx -= 2 * dot * nx; b.vz -= 2 * dot * nz;
        b.x = bm.x + nx * (bm.r + BR + 0.02); b.z = bm.z + nz * (bm.r + BR + 0.02);
        s.combo += 1; const pts = 3 * s.combo; s.score += pts;
        const [sx, sy] = sproj(CAM, bm.x + nx * bm.r, 0.5, bm.z + nz * bm.r);
        fx.burst(sx, sy, C.pink, 10, 170); fx.pop(sx, sy - 26, `+${pts}`, C.pink, 15); fx.ring(sx, sy, C.pink, 34); hx.heavy();
      }
    }
    if (s.orb && Math.hypot(b.x - s.orb.x, b.z - s.orb.z) < BR + 0.45) {
      s.score += 5; const [sx, sy] = sproj(CAM, s.orb.x, 0.6, s.orb.z);
      fx.burst(sx, sy, C.amber, 14, 190); fx.pop(sx, sy - 20, '+5', C.amber, 17); hx.good(); s.orb = null;
    }
    if (b.z > PZ + 1.2) {
      s.lives -= 1; fx.shake(8, 0.3); fx.flash(C.red, 0.25); hx.bad();
      if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); } else { s.wait = 0.9; s.combo = 0; s.trail = []; }
    }
  });

  const setPx = x => { const s = g.current; s.px = clamp((x - AREA_W / 2) / pxPerUnit(PZ), -TW / 2 + s.pw / 2, TW / 2 - s.pw / 2); };
  const pan = usePan(fx, { down: setPx, move: setPx });

  const s = g.current;
  const b = s.ball;
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, 0], s: [TW + 2.4, 2 * HB + 8, 1], c: '#0b2b38' },
    { id: 'pared-i', k: 'box', p: [-TW / 2 - 0.12, 0.6, 0], s: [0.24, 1.2, 2 * HB + 0.4], c: C.cyan, e: 0.6 },
    { id: 'pared-d', k: 'box', p: [TW / 2 + 0.12, 0.6, 0], s: [0.24, 1.2, 2 * HB + 0.4], c: C.cyan, e: 0.6 },
    { id: 'pared-f', k: 'box', p: [0, 0.6, -HB - 0.12], s: [TW + 0.6, 1.2, 0.24], c: C.cyan, e: 0.7 },
    { id: 'pared-fondo', k: 'box', p: [0, 0.6, -HB - 0.5], s: [TW, 1.2, 0.1], c: '#06202a' },
    ...s.bumpers.map(bm => ({ id: bm.id, k: 'cyl', p: [bm.x, 0.5, bm.z], s: [bm.r * 2, 1, bm.r * 2], c: C.pink, e: 0.5 })),
    ...(s.orb ? [{ id: 'orbe', k: 'sph', p: [s.orb.x, 0.6, s.orb.z], n: 0.5, c: C.violet, e: 0.8, o: s.orb.life < 2 && Math.floor(s.t * 8) % 2 ? 0.3 : 1 }] : []),
    ...s.trail.map((p, i) => ({ id: `tr${i}`, k: 'sph', p: [p.x, BR, p.z], n: BR * 1.5, c: C.cyan, e: 0.4, o: Math.max(0, p.a * 0.6) })),
    { id: 'sombra', k: 'pla', p: [b.x, 0.01, b.z], s: [0.5, 0.5, 1], c: '#000000', o: 0.35 },
    { id: 'yo', k: 'box', p: [s.px, 0.2, PZ], s: [s.pw, 0.4, PD], c: C.cyan, e: 0.6 },
    { id: 'bola', k: 'sph', p: [b.x, BR, b.z], n: BR * 2, c: '#ffffff', e: 0.9 },
  ];
  const scene = {
    bg: '#02080c', fog: { c: '#02080c', near: 14, far: 32 }, objs,
    cam: { p: [(Math.random() - 0.5) * shake, CAM.p[1], CAM.p[2]], l: CAM.l, fov: CAM.fov },
  };
  return (
    <GameScreen title="PONG SOLO" emoji="🎾" accent={C.cyan} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.dim, fontSize: 12 }}>Rebotes <Text style={{ color: C.cyan, fontWeight: '800' }}>{s.hits}</Text></Text>{s.combo > 1 ? <Combo n={s.combo} color={C.pink} /> : <View style={{ width: 60 }} />}</>}>
      <PlayArea fx={fx} bg="#02080c" border={alpha(C.cyan, 0.4)} {...pan}>
        <World3D scene={scene} />
        <Overlay show={phase !== 'play'} kind={phase} emoji="🎾" title={phase === 'over' ? 'GAME OVER' : 'PONG SOLO 3D'}
          subtitle={phase === 'over' ? `${s.hits} rebotes` : 'Mantén la bola en juego'}
          score={s.score} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para mover la paleta', 'La bola acelera y la paleta se encoge', 'Los bumpers rosados dan combos · 🔮 +5'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
