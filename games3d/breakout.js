import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { C, Lives, SCREEN_H, SCREEN_W, clamp, hx, pick, rand, tglow, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { project } from '../utils/openworld';
import { shade } from '../utils/prefabs';

// BREAKOUT 3D · pista de neón vista desde detrás de la pala. Arrastra para mover la pala, toca para lanzar.
// Cada ladrillo tiene su color; de algunos caen mejoras (↔ pala grande · ✱ multibola · 🔥 fuego · ❄ lento · ❤ vida).
const CW = 8, CX = 4, FAR = -10, NEAR = 9, PAD_Z = 3.4, BR = 0.24;   // NEAR: la pista llega hasta la cámara
const COLS = 7, BW = (CW - 0.5) / COLS - 0.1, BD = 0.55;
const PAL = ['#ff3d6e', '#ff8a3d', '#ffd54a', '#5cff8a', '#22e6ff', '#9b6bff'];
const IC = { W: C.cyan, M: C.pink, F: C.orange, L: C.red, S: C.violet };
const CAM_D = 8, FOLLOW = 0.3;                                   // cámara a 8 m de la pala; sigue un 30 % de su posición
const REF = { p: [0, 6.2, PAD_Z + CAM_D], l: [0, 0.2, -3.5], fov: 70 };
const PPU = project(REF, [1, 0.3, PAD_Z], SCREEN_W, SCREEN_H).x - project(REF, [0, 0.3, PAD_Z], SCREEN_W, SCREEN_H).x;
const xFromTouch = sx => (sx - SCREEN_W / 2) / (PPU * (1 - FOLLOW));
const lerpV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Decorado fijo: suelo con rejilla, muros de neón y fondo (se calcula una vez).
const MID = (FAR + NEAR) / 2, DEPTH = NEAR - FAR;
const ARENA = [
  { id: 'suelo', k: 'pla', p: [0, 0, MID], s: [CW + 2, DEPTH, 1], c: '#140a22', recv: true, m: { r: 0.85, m: 0 } },
  { id: 'pared-i', k: 'box', p: [-CX - 0.2, 0.6, MID], s: [0.4, 1.2, DEPTH], c: '#ff8a3d', e: 0.4 },
  { id: 'pared-d', k: 'box', p: [CX + 0.2, 0.6, MID], s: [0.4, 1.2, DEPTH], c: '#ff8a3d', e: 0.4 },
  { id: 'pared-f', k: 'box', p: [0, 0.6, FAR - 0.2], s: [CW + 0.8, 1.2, 0.4], c: '#ff3d6e', e: 0.45 },
  ...[-2, 0, 2].map(x => ({ id: `rx${x}`, k: 'box', p: [x, 0.01, MID], s: [0.03, 0.02, DEPTH], c: '#3b1f5c', e: 0.4 })),
  ...[-8, -6, -4, -2, 0, 2, 4, 6, 8].map(z => ({ id: `rz${z}`, k: 'box', p: [0, 0.01, z], s: [CW, 0.02, 0.03], c: '#3b1f5c', e: 0.4 })),
];

const makeBricks = level => {
  const rows = Math.min(6, 3 + Math.floor(level / 2));
  const pat = level % 4;
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) {
    let hp = 1;
    if (pat === 1 && (r + c) % 2) continue;
    if (pat === 3 && c % 3 === 1) continue;
    if (level >= 2 && r === 0) hp = 2;
    if (level >= 4 && r < 2) hp = 3;
    out.push({ id: uid(), x: -CX + 0.25 + BW / 2 + c * (BW + 0.1), z: -8.6 + r * (BD + 0.22), hp, max: hp, base: PAL[r % PAL.length] });
  }
  return out;
};

const initState = () => ({
  px: 0, pw: 2.2, balls: [{ x: 0, z: PAD_Z - 0.5, vx: 0, vz: 0, stuck: true }], bricks: makeBricks(1), items: [],
  lives: 3, level: 1, score: 0, combo: 0, bestCombo: 0, wide: 0, fire: 0, slow: 0, t: 0, banner: { text: 'NIVEL 1', t: 1.4 },
  cp: null, cl: null, dead: false,
});

// Escena: pala en forma de cápsula, ladrillos con brillo y bisel, bolas y mejoras que caen.
function buildScene(s, t) {
  const objs = [{ id: 'pala', k: 'cap', p: [s.px, 0.3, PAD_Z], r: [0, 0, Math.PI / 2], s: [0.46, s.pw, 0.46], c: s.wide > 0 ? C.cyan : '#f4f6ff', e: 0.55, sh: true, m: { r: 0.3, m: 0.4 } }];
  for (const k of s.bricks) {
    const f = 0.85 + 0.25 * (k.hp / k.max);
    objs.push({ id: `b${k.id}`, k: 'box', p: [k.x, 0.4, k.z], s: [BW, 0.8, BD], c: shade(k.base, f), e: 0.3, m: { r: 0.35, m: 0.1 } });
    objs.push({ id: `bt${k.id}`, k: 'box', p: [k.x, 0.83, k.z], s: [BW * 0.86, 0.05, BD * 0.6], c: k.base, e: 0.9 });
  }
  s.items.forEach(it => objs.push({ id: `i${it.id}`, k: 'oct', p: [it.x, 0.5, it.z], n: 0.6, r: [t * 1.5, t * 2, 0], c: IC[it.k], e: 0.9 }));
  s.balls.forEach((b, i) => objs.push({ id: `ball${i}`, k: 'sph', p: [b.x, 0.5, b.z], n: BR * 2, c: s.fire > 0 ? '#ffb13d' : '#ffffff', e: 0.9, sh: true }));
  const b0 = s.balls[0] || { x: s.px, z: PAD_Z };
  return {
    sky: { top: '#0a0418', bottom: '#2a0d3a', sun: false, clouds: 0 },
    fog: { c: '#1a0a2a', near: 14, far: 32 },
    light: { dir: [-0.35, 1, 0.45], sun: '#ffe9d2', i: 2.0, sky: '#e6d0ff', ground: '#2a1538', hi: 1.2 },
    shadowR: 12, statics: ARENA, objs,
    lights: [{ p: [b0.x, 1.5, b0.z], c: s.fire > 0 ? '#ff8a3d' : '#9fe9ff', i: 5, d: 6 }, { p: [0, 2.5, FAR + 1], c: '#ff3d6e', i: 6, d: 9 }],
    cam: s.cp ? { p: s.cp, l: s.cl, fov: REF.fov } : REF,
  };
}

export function Breakout3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('breakout');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const speedOf = s => (7 + s.level * 0.5) * (s.slow > 0 ? 0.7 : 1);
  const launch = s => {
    s.balls.forEach(b => { if (b.stuck) { b.stuck = false; const a = rand(-0.3, 0.3); const sp = speedOf(s); b.vx = Math.sin(a) * sp; b.vz = -Math.cos(a) * sp; } });
    hx.tap();
  };
  const loseLife = s => {
    s.lives -= 1; s.combo = 0; s.wide = 0; s.fire = 0;
    burst3d([s.px, 0.5, PAD_Z - 0.5], ['#ff4d6d', '#ffb0a0'], 26, { speed: 6, up: 2.5, g: 9, size: 0.16, life: 0.8 });
    fx.shake(8, 0.3); fx.flash(C.red, 0.3); hx.bad();
    if (s.lives <= 0) { s.dead = true; hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
    s.balls = [{ x: s.px, z: PAD_Z - 0.5, vx: 0, vz: 0, stuck: true }];
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.dead) return;
    s.t += dt;
    ['wide', 'fire', 'slow'].forEach(k => { if (s[k] > 0) s[k] = Math.max(0, s[k] - dt); });
    s.pw += ((s.wide > 0 ? 3.4 : 2.2) - s.pw) * Math.min(1, dt * 10);
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    const tp = [FOLLOW * s.px, 6.2, PAD_Z + CAM_D], tl = [FOLLOW * s.px, 0.2, -3.5], cf = Math.min(1, dt * 5);
    s.cp = s.cp ? lerpV(s.cp, tp, cf) : tp; s.cl = s.cl ? lerpV(s.cl, tl, cf) : tl;
    const sp = speedOf(s);
    for (let bi = s.balls.length - 1; bi >= 0; bi--) {
      const b = s.balls[bi];
      if (b.stuck) { b.x = s.px; b.z = PAD_Z - 0.5; continue; }
      const m = Math.hypot(b.vx, b.vz) || 1;
      b.vx *= sp / m; b.vz *= sp / m;
      b.x += b.vx * dt; b.z += b.vz * dt;
      if (Math.abs(b.x) > CX - BR) { b.x = Math.sign(b.x) * (CX - BR); b.vx = -b.vx; burst3d([b.x, 0.5, b.z], '#ffffff', 3, { speed: 2, life: 0.3, size: 0.08, g: 0 }); hx.tick(); }
      if (b.z < FAR + BR) { b.z = FAR + BR; b.vz = Math.abs(b.vz); hx.tick(); }
      // pala: la bola viene hacia la cámara (vz > 0)
      if (b.vz > 0 && b.z + BR >= PAD_Z && b.z - BR <= PAD_Z + 0.5 && Math.abs(b.x - s.px) < s.pw / 2 + BR) {
        const rel = clamp((b.x - s.px) / (s.pw / 2), -1, 1);
        const a = rel * 1.0;
        b.vx = Math.sin(a) * sp; b.vz = -Math.cos(a) * sp; b.z = PAD_Z - BR;
        s.combo = 0; hx.tap();
        burst3d([b.x, 0.4, PAD_Z], ['#22e6ff', '#ffffff'], 12, { speed: 3.5, life: 0.4, size: 0.1, g: 6, up: 0.8 });
        ring3d([b.x, 0.1, PAD_Z], '#22e6ff', 14, { speed: 3, life: 0.35, size: 0.08 });
      }
      // ladrillos (caja en el plano x-z)
      for (let i = s.bricks.length - 1; i >= 0; i--) {
        const k = s.bricks[i];
        if (b.x + BR < k.x - BW / 2 || b.x - BR > k.x + BW / 2 || b.z + BR < k.z - BD / 2 || b.z - BR > k.z + BD / 2) continue;
        if (s.fire <= 0) {
          const ox = Math.min(b.x + BR - (k.x - BW / 2), k.x + BW / 2 - (b.x - BR));
          const oz = Math.min(b.z + BR - (k.z - BD / 2), k.z + BD / 2 - (b.z - BR));
          if (ox < oz) b.vx = (b.x < k.x ? -1 : 1) * Math.abs(b.vx); else b.vz = (b.z < k.z ? -1 : 1) * Math.abs(b.vz);
        }
        k.hp -= s.fire > 0 ? 3 : 1;
        if (k.hp <= 0) {
          s.bricks.splice(i, 1); s.combo += 1; s.bestCombo = Math.max(s.bestCombo, s.combo);
          const pts = 10 * s.level + s.combo * 2;
          s.score += pts;
          burst3d([k.x, 0.6, k.z], [k.base, '#ffffff'], 16, { speed: 5, up: 3, g: 10, size: 0.13, life: 0.8 });
          ring3d([k.x, 0.1, k.z], k.base, 12, { speed: 4, life: 0.4, size: 0.1 });
          hx.hit();
          if (Math.random() < 0.2) s.items.push({ id: uid(), x: k.x, z: k.z, k: pick(['W', 'M', 'F', 'L', 'S']) });
        } else { burst3d([b.x, 0.5, k.z], k.base, 5, { speed: 2.5, life: 0.35, size: 0.09, g: 5 }); hx.tick(); }
        if (s.fire <= 0) break;
      }
      if (b.z > PAD_Z + 1.5) s.balls.splice(bi, 1);
    }
    if (!s.balls.length) { loseLife(s); return; }
    s.items.forEach(it => { it.z += 2.4 * dt; });
    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i];
      if (it.z > PAD_Z - 0.4 && it.z < PAD_Z + 0.6 && Math.abs(it.x - s.px) < s.pw / 2 + 0.3) {
        s.items.splice(i, 1); hx.good();
        ring3d([it.x, 0.5, it.z], IC[it.k], 20, { speed: 4, life: 0.5, size: 0.11 });
        if (it.k === 'W') s.wide = 10;
        if (it.k === 'F') s.fire = 8;
        if (it.k === 'L') s.lives = Math.min(5, s.lives + 1);
        if (it.k === 'S') s.slow = 9;
        if (it.k === 'M') {
          const b0 = s.balls[0];
          [-0.5, 0.5].forEach(d => { const a = Math.atan2(b0.vx, -b0.vz) + d; s.balls.push({ x: b0.x, z: b0.z, vx: Math.sin(a) * sp, vz: -Math.cos(a) * sp, stuck: b0.stuck }); });
        }
      } else if (it.z > PAD_Z + 2) s.items.splice(i, 1);
    }
    if (!s.bricks.length) {
      s.score += 100 * s.level; hx.win(); fx.flash('#ffffff', 0.3);
      COLS_SAMPLE.forEach((x, i) => burst3d([x, 0.6, -6 + (i % 2) * 2], PAL, 14, { speed: 6, up: 5, g: 10, size: 0.16, life: 1.1 }));
      s.level += 1; s.bricks = makeBricks(s.level); s.items = []; s.balls = [{ x: s.px, z: PAD_Z - 0.5, vx: 0, vz: 0, stuck: true }];
      s.banner = { text: `NIVEL ${s.level}`, t: 1.4 };
    }
  });

  const setPx = x => { const s = g.current; s.px = clamp(xFromTouch(x), -CX + s.pw / 2, CX - s.pw / 2); };
  const pan = usePan(fx, {
    down: x => { const s = g.current; setPx(x); if (s.balls.some(b => b.stuck) && phase === 'play') launch(s); },
    move: setPx,
  });

  const s = g.current;
  const scene = buildScene(s, s.t);
  const cam = s.cp ? { p: s.cp, l: s.cl, fov: REF.fov } : REF;
  const stuck = s.balls.some(b => b.stuck);
  return (
    <Game3D title="BREAKOUT" emoji="🧱" accent={C.orange} onExit={onExit} score={s.score} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene} orbit={{ r: 12, h: 5, speed: 0.18, ly: 0.3, drop: 1.8 }}
      hud={<>
        <Lives n={s.lives} max={Math.max(3, s.lives)} />
        <HudPill icon="🧱" label="NIVEL" value={s.level} color={C.orange} />
        {s.combo > 1 && <HudPill icon="🔥" value={`×${s.combo}`} color={C.amber} />}
      </>}
      subtitle="Rompe todos los ladrillos con la bola"
      lines={['Arrastra para mover la pala · toca para lanzar', '↔ pala grande · ✱ multibola · 🔥 fuego · ❄ lento · ❤ vida', 'Vista en tercera persona detrás de la pala']}
      result={{ title: 'GAME OVER', emoji: '🧱', subtitle: `Llegaste al nivel ${s.level}`, isNew: res.isNew, stats: [['NIVEL', s.level], ['COMBO', s.bestCombo]] }}>
      {stuck && phase === 'play' && <Text pointerEvents="none" style={{ position: 'absolute', top: SCREEN_H * 0.8, left: 0, right: 0, textAlign: 'center', color: C.text, fontSize: 13, fontWeight: '900', letterSpacing: 2.5, ...tglow(C.orange, 8) }}>TOCA PARA LANZAR</Text>}
      {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: SCREEN_H * 0.36, left: 0, right: 0, textAlign: 'center', color: C.text, fontSize: 26, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow(C.orange, 12) }}>{s.banner.text}</Text>}
    </Game3D>
  );
}

// columnas donde estallan los fuegos artificiales al limpiar un nivel
const COLS_SAMPLE = [-3, -1, 1, 3];
