import React, { useRef, useState } from 'react';
import { C, SCREEN_H, SCREEN_W, clamp, hx, rand, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { gem } from '../utils/prefabs';
import { project } from '../utils/openworld';

// PONG SOLO 3D · pista de neón con paredes de cristal y un muro al fondo. Tu paleta está abajo; la cámara va detrás.
// Arrastra para mover la paleta. Los bumpers rosados dan combos y los orbes violetas suman +5.
const TW = 7.2, HB = 6.6, PZ = 5.2;   // ancho de la pista, z del fondo, z de tu paleta
const BR = 0.2, PD = 0.36, PW0 = 1.5, PW_MIN = 1.0;
const SPMAX = 11.5;
const FOLLOW = 0.2;                    // la cámara sigue un 20 % de la paleta (el mapeo del dedo lo compensa)
const CAM_D = 9;
const REF = { p: [0, 3.0, PZ + CAM_D], l: [0, 0, -3], fov: 70 };
const PPU = project(REF, [1, 0.2, PZ], SCREEN_W, SCREEN_H).x - project(REF, [0, 0.2, PZ], SCREEN_W, SCREEN_H).x;
const xFromTouch = sx => (sx - SCREEN_W / 2) / (PPU * (1 - FOLLOW));
const lerpV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Decorado fijo (una vez): suelo con rejilla neón, paredes de cristal y muro del fondo.
const COURT = [
  { id: 'suelo', k: 'pla', p: [0, 0, 0], s: [TW + 8, 44, 1], c: '#0b2b38', recv: true, m: { r: 0.8, m: 0.1 } },
  { id: 'pared-i', k: 'box', p: [-TW / 2 - 0.12, 0.8, 0], s: [0.24, 1.6, 2 * HB + 0.4], c: '#22e6ff', o: 0.5, e: 0.5 },
  { id: 'pared-d', k: 'box', p: [TW / 2 + 0.12, 0.8, 0], s: [0.24, 1.6, 2 * HB + 0.4], c: '#22e6ff', o: 0.5, e: 0.5 },
  { id: 'pared-f', k: 'box', p: [0, 1.2, -HB - 0.12], s: [TW + 0.6, 2.4, 0.24], c: '#06202a', m: { r: 0.4, m: 0.2 } },
  { id: 'pared-f-luz', k: 'box', p: [0, 2.42, -HB - 0.12], s: [TW + 0.6, 0.06, 0.26], c: '#22e6ff', e: 1 },
  { id: 'pared-f-luz2', k: 'box', p: [0, 0.05, -HB - 0.12], s: [TW + 0.6, 0.06, 0.26], c: '#ff3df2', e: 1 },
  ...[-3, -2, -1, 0, 1, 2, 3].map(x => ({ id: `lx${x}`, k: 'box', p: [x * 1.0 + 0.5, 0.01, 0], s: [0.03, 0.02, 2 * HB], c: '#16566b', e: 0.5 })),
  ...[-5, -3, -1, 1, 3, 5].map(z => ({ id: `lz${z}`, k: 'box', p: [0, 0.01, z - 0.5], s: [TW, 0.02, 0.03], c: '#16566b', e: 0.5 })),
];

const initState = () => ({
  px: 0, pw: PW0, ball: { x: 0, z: PZ - 0.5, vx: 0, vz: 0 }, speed: 5.6, lives: 3, score: 0, hits: 0,
  bumpers: [], orb: null, orbT: 6, trail: [], t: 0, wait: 0.8, combo: 0, cp: null, cl: null, dead: false,
});

// Escena: paleta con brillo, bola con su rastro, bumpers, orbe y luces de neón.
function buildScene(s) {
  const b = s.ball;
  const objs = [{ id: 'yo', k: 'cap', p: [s.px, 0.25, PZ], r: [0, 0, Math.PI / 2], s: [0.3, s.pw, 0.3], c: C.cyan, e: 0.7, sh: true, m: { r: 0.3, m: 0.3 } }];
  s.bumpers.forEach(bm => {
    objs.push({ id: bm.id, k: 'cyl', p: [bm.x, 0.4, bm.z], s: [bm.r * 2, 0.8, bm.r * 2], c: '#ff3df2', e: 0.45, sh: true, m: { r: 0.3, m: 0.2 } });
    objs.push({ id: `${bm.id}-aro`, k: 'tor', p: [bm.x, 0.82, bm.z], n: bm.r * 1.9, r: [Math.PI / 2, 0, 0], c: '#ffd0f7', e: 1 });
  });
  if (s.orb) {
    const blink = s.orb.life < 2 && Math.floor(s.t * 8) % 2 ? 0.3 : 1;
    objs.push(...gem('orbe', [s.orb.x, 0.35, s.orb.z], { c: '#9b6bff', t: s.t, spin: s.t * 1.5, o: blink }));
  }
  s.trail.forEach((p, i) => objs.push({ id: `tr${i}`, k: 'sph', p: [p.x, BR, p.z], n: BR * 1.4, c: '#22e6ff', e: 0.9, o: Math.max(0, p.a * 0.5) }));
  objs.push({ id: 'bola', k: 'sph', p: [b.x, BR, b.z], n: BR * 2, c: '#ffffff', e: 0.9, sh: true });
  const cam = s.cp ? { p: s.cp, l: s.cl, fov: REF.fov } : REF;
  return {
    sky: { top: '#02080f', bottom: '#0b2a38', sun: false, clouds: 0 },
    fog: { c: '#0b2a38', near: 14, far: 34 },
    light: { dir: [-0.3, 1, 0.4], sun: '#e6fbff', i: 1.8, sky: '#9fe6ff', ground: '#0b2030', hi: 1.1 },
    shadowR: 12, statics: COURT, objs,
    lights: [{ p: [b.x, 1.4, b.z], c: '#22e6ff', i: 5, d: 6 }, { p: [0, 2.8, -HB + 1], c: '#ff3df2', i: 5, d: 8 }],
    cam,
  };
}

export function PongSolo3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('pongsolo');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const launch = s => {
    const a = -Math.PI / 2 + rand(-0.4, 0.4);
    s.ball = { x: s.px, z: PZ - 0.5, vx: Math.cos(a) * s.speed, vz: Math.sin(a) * s.speed };
    s.wait = 0; s.combo = 0;
  };
  const die = s => { s.dead = true; hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.dead) return;
    s.t += dt;
    const tp = [FOLLOW * s.px, 3.0, PZ + CAM_D], tl = [FOLLOW * s.px, 0, -3], cf = Math.min(1, dt * 5);
    s.cp = s.cp ? lerpV(s.cp, tp, cf) : tp; s.cl = s.cl ? lerpV(s.cl, tl, cf) : tl;
    s.bumpers.forEach(bm => { if (bm.mv) { bm.x += bm.vx * dt; if (bm.x < -2.9 || bm.x > 2.9) bm.vx *= -1; } });
    s.orbT -= dt; if (s.orbT <= 0 && !s.orb) { s.orb = { x: rand(-3, 3), z: rand(-5.8, -1.5), life: 7 }; s.orbT = rand(6, 11); }
    if (s.orb) { s.orb.life -= dt; if (s.orb.life <= 0) s.orb = null; }
    const b = s.ball;
    if (s.wait > 0) { s.wait -= dt; b.x = s.px; b.z = PZ - 0.5; if (s.wait <= 0) launch(s); return; }
    const m = Math.hypot(b.vx, b.vz) || 1; b.vx *= s.speed / m; b.vz *= s.speed / m;
    b.x += b.vx * dt; b.z += b.vz * dt;
    s.trail.push({ x: b.x, z: b.z, a: 0.5 }); s.trail.forEach(p => { p.a -= dt * 2.5; }); s.trail = s.trail.filter(p => p.a > 0);
    // paredes laterales y pared del fondo
    if (b.x < -TW / 2 + BR) { b.x = -TW / 2 + BR; b.vx = Math.abs(b.vx); hx.tick(); burst3d([b.x, BR, b.z], '#22e6ff', 4, { speed: 2, life: 0.3, size: 0.07, g: 0 }); }
    if (b.x > TW / 2 - BR) { b.x = TW / 2 - BR; b.vx = -Math.abs(b.vx); hx.tick(); burst3d([b.x, BR, b.z], '#22e6ff', 4, { speed: 2, life: 0.3, size: 0.07, g: 0 }); }
    if (b.z < -HB + BR) { b.z = -HB + BR; b.vz = Math.abs(b.vz); hx.tick(); burst3d([b.x, BR, b.z], '#22e6ff', 6, { speed: 2.5, life: 0.35, size: 0.08, g: 0 }); }
    // tu paleta (la bola viene hacia la cámara: vz > 0)
    if (b.vz > 0 && b.z + BR >= PZ - PD / 2 && b.z - BR <= PZ + 0.5 && Math.abs(b.x - s.px) < s.pw / 2 + BR) {
      const rel = clamp((b.x - s.px) / (s.pw / 2), -1, 1);
      s.hits += 1; s.combo = 0; s.score += 1;
      s.speed = Math.min(SPMAX, 5.6 + s.hits * 0.1);
      s.pw = Math.max(PW_MIN, PW0 - Math.floor(s.hits / 6) * 0.08);
      const a = -Math.PI / 2 + rel * 1.05;
      b.vx = Math.cos(a) * s.speed; b.vz = Math.sin(a) * s.speed; b.z = PZ - PD / 2 - BR;
      burst3d([b.x, BR, PZ], ['#22e6ff', '#ffffff'], 14, { speed: 3.5, life: 0.45, size: 0.09, g: 6, up: 0.6 });
      ring3d([b.x, 0.05, PZ], '#22e6ff', 14, { speed: 3, life: 0.35, size: 0.08 });
      hx.hit();
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
        const ix = bm.x + nx * bm.r, iz = bm.z + nz * bm.r;
        burst3d([ix, 0.6, iz], ['#ff3df2', '#ffd0f7'], 22, { speed: 5, up: 2, g: 8, size: 0.12, life: 0.7 });
        ring3d([bm.x, 0.85, bm.z], '#ff3df2', 22, { speed: 5, life: 0.5, size: 0.1 });
        fx.pop(SCREEN_W / 2, SCREEN_H * 0.4, `+${pts}`, C.pink, 18); hx.heavy();
      }
    }
    if (s.orb && Math.hypot(b.x - s.orb.x, b.z - s.orb.z) < BR + 0.45) {
      s.score += 5;
      burst3d([s.orb.x, 0.6, s.orb.z], ['#9b6bff', '#ffc233', '#ffffff'], 30, { speed: 6, up: 3, g: 8, size: 0.14, life: 0.8 });
      fx.pop(SCREEN_W / 2, SCREEN_H * 0.46, '+5', C.amber, 18); hx.good(); s.orb = null;
    }
    if (b.z > PZ + 1.2) {
      s.lives -= 1; fx.shake(8, 0.3); fx.flash(C.red, 0.25); hx.bad();
      burst3d([b.x, 0.3, PZ], ['#ff4d6d', '#ffd0d8'], 26, { speed: 5, up: 2.5, g: 9, size: 0.12, life: 0.8 });
      if (s.lives <= 0) die(s); else { s.wait = 0.9; s.combo = 0; s.trail = []; }
    }
  });

  const setPx = x => { const s = g.current; s.px = clamp(xFromTouch(x), -TW / 2 + s.pw / 2, TW / 2 - s.pw / 2); };
  const pan = usePan(fx, { down: setPx, move: setPx });

  const s = g.current;
  const scene = buildScene(s);
  return (
    <Game3D title="PONG SOLO" emoji="🎾" accent={C.cyan} onExit={onExit} score={s.score} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene} orbit={{ r: 13, h: 4.5, speed: 0.18, ly: 0.4, drop: 1.8 }}
      hud={<>
        <HudPill icon="❤️" label="VIDAS" value={s.lives} color={C.red} />
        <HudPill icon="🎾" label="REBOTES" value={s.hits} color={C.cyan} />
        {s.combo > 1 && <HudPill icon="⚡" value={`×${s.combo}`} color={C.pink} />}
      </>}
      subtitle="Mantén la bola en juego"
      lines={['Arrastra para mover la paleta', 'La bola acelera y la paleta se encoge', 'Los bumpers rosados dan combos · 🔮 +5']}
      result={{ title: 'GAME OVER', emoji: '🎾', subtitle: `${s.hits} rebotes`, isNew: res.isNew, stats: [['REBOTES', s.hits], ['PUNTOS', s.score]] }}>
    </Game3D>
  );
}
