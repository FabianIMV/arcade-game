import React, { useRef, useState } from 'react';
import { C, SCREEN_H, SCREEN_W, hx, pick, rand, uid, clamp, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { coin, hash01, person, shade, tree } from '../utils/prefabs';
import { followCam, forward, project, right, seeded } from '../utils/openworld';

// COIN RUSH 3D: mundo abierto nocturno con plataformas. Recoge monedas caminando hacia ellas.
// Joystick izquierdo: moverte (relativo a la cámara) · SALTAR para subir. 30 segundos.
// Moneda dorada 5 · moneda 1 · ⏱ reloj +2 s · 💣 bomba −3 s · las rachas suben el multiplicador y activan el frenesí.
const CC_DUR = 30, CC_G = 22, CC_JUMP = 8.6, CC_SPEED = 6.2, CC_EDGE = 20, CC_STEP = 0.7;
const CC_PLATS = [                        // plataformas: centro x/z, tamaño w (x) × d (z), altura h
  { x: 0, z: -2, w: 5, d: 5, h: 1.0 },
  { x: 8, z: -5, w: 4, d: 4, h: 1.4 },
  { x: -8, z: -6, w: 3, d: 3, h: 1.0 },
  { x: -3, z: 6, w: 4, d: 3, h: 0.5 },
  { x: 6, z: 6, w: 3, d: 3, h: 1.0 },
  { x: -11, z: 3, w: 3, d: 6, h: 0.5 },
  { x: 13, z: 2, w: 2, d: 8, h: 1.0 },
  { x: 0, z: -13, w: 9, d: 3, h: 1.4 },
  { x: -14, z: -12, w: 2, d: 2, h: 1.4 },
  { x: 3, z: 13, w: 3, d: 2, h: 0.5 },
];
const CC_PCOL = ['#3b3f73', '#4a4f8c', '#34396b'];
const NIGHT = { top: '#050a1f', bottom: '#1d2f5c' }, FRENZY = { top: '#2a0a1e', bottom: '#5a1f3a' };

const surfaceAt = (x, z) => {
  let y = 0;
  for (const p of CC_PLATS) if (Math.abs(x - p.x) < p.w / 2 && Math.abs(z - p.z) < p.d / 2) y = Math.max(y, p.h);
  return y;
};
const lerpAng = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
// rumbo del personaje (convención de prefabs/openworld: yaw 0 mira a −Z) a partir de un vector de movimiento
const headingOf = (mx, mz) => Math.atan2(-mx, -mz);
const camOf = s => followCam(s.p, s.camYaw, { dist: 7.2, height: 3.8, look: 1.1 });

// Decorado estático: plataformas, farolas y palmeras alrededor del mundo (se calcula una vez)
const STATICS = (() => {
  const r = seeded(21), st = [];
  st.push(...CC_PLATS.map((q, i) => ({ id: `pl${i}`, k: 'box', p: [q.x, q.h / 2, q.z], s: [q.w, q.h, q.d], c: CC_PCOL[i % 3], e: 0.06, recv: true, sh: true })));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3, x = Math.cos(a) * 19, z = Math.sin(a) * 19;
    st.push({ id: `fp${i}`, k: 'cyl', p: [x, 1.6, z], s: [0.22, 3.2, 0.22], c: '#2a2f55' });
    st.push({ id: `fb${i}`, k: 'sph', p: [x, 3.3, z], n: 0.55, c: '#fff2c4', e: 1 });
  }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + r() * 0.2, d = 23 + r() * 4;
    st.push(...tree(`pm${i}`, [Math.cos(a) * d, 0, Math.sin(a) * d], { kind: 'palm', h: 1.0 + r() * 0.5, inst: 'palma' }));
  }
  return st;
})();
const TERRAIN = {
  id: 'plaza-v1', h: () => 0, size: 56, step: 1.5,
  color: (y, x, z) => shade((Math.floor(x / 2) + Math.floor(z / 2)) & 1 ? '#1f3f5c' : '#23496b', 0.93 + hash01(x.toFixed(1) + ',' + z.toFixed(1)) * 0.1),
};

const initState = () => ({
  p: { x: 0, z: 4, y: 0, vy: 0, grounded: true, heading: 0 },
  camYaw: 0, coins: [], spawn: 0.3, time: CC_DUR, t: 0, score: 0, combo: 0, maxCombo: 0, frenzy: 0, hits: 0, walk: 0, over: false,
});

export function CoinCollector3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('coinrush');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const stick = useRef({ x: 0, y: 0, on: false }).current;

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = s => {
    if (s.over) return;
    s.over = true; s.time = 0; hx.win();
    setRes({ isNew: submitBest(s.score) }); setPhase('over');
  };
  const multOf = s => (1 + (s.combo >= 5 ? 1 : 0) + (s.combo >= 15 ? 1 : 0) + (s.combo >= 30 ? 1 : 0)) * (s.frenzy > 0 ? 2 : 1);
  const spawn = s => {
    const a = rand(0, Math.PI * 2), d = rand(3, 10);
    const x = clamp(s.p.x + Math.cos(a) * d, -CC_EDGE, CC_EDGE), z = clamp(s.p.z + Math.sin(a) * d, -CC_EDGE, CC_EDGE);
    const r = Math.random();
    const type = r < 0.62 ? 'coin' : r < 0.74 ? 'gold' : r < 0.9 ? 'bomb' : 'clock';
    const life = (type === 'gold' ? 3.2 : type === 'bomb' ? 4.4 : 4.8) * Math.max(0.6, 1 - s.t * 0.01);
    s.coins.push({ id: uid(), type, x, z, y: surfaceAt(x, z) + 0.9, age: 0, life, spin: rand(0, 6) });
  };
  const jump = () => {
    const s = g.current;
    if (phase !== 'play' || s.over || !s.p.grounded) return;
    s.p.vy = CC_JUMP; s.p.grounded = false; hx.tap();
  };
  const collect = (s, c) => {
    const p = s.p, q = project(camOf(s), [p.x, p.y + 1.6, p.z], SCREEN_W, SCREEN_H) || { x: SCREEN_W / 2, y: SCREEN_H / 2 };
    if (c.type === 'bomb') {
      s.time = Math.max(0, s.time - 3); s.combo = 0;
      burst3d([p.x, p.y + 1, p.z], ['#ff4d4d', '#ff8a3d', '#ffe066'], 40, { speed: 5, up: 2, size: 0.2, life: 0.8 });
      fx.shake(9, 0.3); fx.flash(C.red, 0.3); fx.pop(q.x, q.y - 30, '-3s', C.red, 24); hx.bad();
    } else if (c.type === 'clock') {
      s.time += 2;
      burst3d([p.x, p.y + 1, p.z], ['#7dff6b', '#e8ffd6'], 26, { speed: 4, up: 2, life: 0.7 });
      ring3d([p.x, p.y + 0.2, p.z], '#7dff6b', 18, { speed: 4, life: 0.6 });
      fx.pop(q.x, q.y - 30, '+2s', C.lime, 24); hx.good();
    } else {
      s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
      const pts = (c.type === 'gold' ? 5 : 1) * multOf(s);
      s.score += pts;
      burst3d([c.x, c.y, c.z], c.type === 'gold' ? ['#ffe066', '#fff3b0', '#ffb300'] : ['#ffc233', '#fff3b0'], c.type === 'gold' ? 34 : 20, { speed: 5, up: 3, size: 0.16, life: 0.8, g: 10 });
      ring3d([c.x, c.y - 0.6, c.z], '#ffc233', 14, { speed: 4, life: 0.5 });
      fx.pop(q.x, q.y - 30, `+${pts}`, multOf(s) > 1 ? C.amber : C.text, 18);
      hx.hit();
      if (s.combo % 12 === 0) { s.frenzy = 5; fx.flash(C.amber, 0.25); fx.pop(SCREEN_W / 2, SCREEN_H * 0.35, '¡FRENESÍ!', C.amber, 28); hx.win(); }
    }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.over) return;
    const p = s.p;
    s.t += dt; s.time -= dt;
    if (s.frenzy > 0) s.frenzy = Math.max(0, s.frenzy - dt);

    // movimiento relativo a la cámara (arriba del joystick = hacia donde mira la cámara)
    const f = forward(s.camYaw), rt = right(s.camYaw);
    const fw = -(stick.y || 0), st = stick.x || 0;
    const mx = rt[0] * st + f[0] * fw, mz = rt[1] * st + f[1] * fw;
    const mag = Math.hypot(mx, mz);
    let moved = 0;
    if (mag > 0.05) {
      const sp = Math.min(1, mag) * CC_SPEED * dt;
      const dx = (mx / mag) * sp, dz = (mz / mag) * sp;
      const free = (nx, nz) => !(p.grounded && surfaceAt(nx, nz) - p.y > CC_STEP) && Math.abs(nx) < CC_EDGE && Math.abs(nz) < CC_EDGE;
      if (free(p.x + dx, p.z)) { p.x += dx; moved += Math.abs(dx); }
      if (free(p.x, p.z + dz)) { p.z += dz; moved += Math.abs(dz); }
      p.heading = lerpAng(p.heading, headingOf(mx, mz), Math.min(1, dt * 12));
    }
    s.walk += ((moved > 0 ? 1 : 0) - s.walk) * Math.min(1, dt * 10);
    // física vertical: caminar sobre plataformas (escalones bajos), saltar y caer
    const ground = surfaceAt(p.x, p.z);
    if (p.grounded) { if (Math.abs(ground - p.y) <= CC_STEP) { p.y = ground; p.vy = 0; } else p.grounded = false; }
    if (!p.grounded) {
      p.vy -= CC_G * dt; p.y += p.vy * dt;
      if (p.y <= ground && p.vy <= 0) { p.y = ground; p.vy = 0; p.grounded = true; }
    }
    s.camYaw = lerpAng(s.camYaw, p.heading, Math.min(1, dt * 2.5));

    s.spawn -= dt;
    if (s.spawn <= 0) { spawn(s); s.spawn = Math.max(0.2, 0.55 - s.t * 0.008) * (s.frenzy > 0 ? 0.5 : 1) * rand(0.7, 1.2); }
    for (let i = s.coins.length - 1; i >= 0; i--) {
      const c = s.coins[i];
      c.age += dt; c.spin += dt * 4;
      if (Math.hypot(c.x - p.x, c.z - p.z) < 1.0 && Math.abs(c.y - (p.y + 0.6)) < 1.5) {
        s.coins.splice(i, 1); s.hits += 1; collect(s, c); continue;
      }
      if (c.age >= c.life) {
        s.coins.splice(i, 1);
        if (c.type === 'coin' || c.type === 'gold') s.combo = 0;
      }
    }
    if (s.time <= 0) finish(s);
  });

  const s = g.current, p = s.p;
  const objs = [];
  s.coins.forEach(c => {
    const id = `m${c.id}`;
    if (c.type === 'coin') objs.push(...coin(id, [c.x, c.y, c.z], { t: s.t + c.spin, bob: 0.1, sh: false }));
    else if (c.type === 'gold') objs.push(...coin(id, [c.x, c.y, c.z], { t: s.t + c.spin, bob: 0.1, n: 1.35, c: '#ffe066', sh: false }));
    else if (c.type === 'bomb') {
      objs.push({ id, k: 'sph', p: [c.x, c.y, c.z], n: 0.8, c: '#2a2540', e: 0.12 });
      objs.push({ id: `${id}f`, k: 'box', p: [c.x, c.y + 0.5, c.z], s: [0.12, 0.26, 0.12], c: '#ff8a3d', e: 0.9 });
    } else objs.push({ id, k: 'tor', p: [c.x, c.y, c.z], n: 0.85, r: [0, c.spin, 0], c: '#7dff6b', e: 0.8 });
  });
  objs.push(...person('yo', [p.x, p.y, p.z], { yaw: p.heading, t: s.t, walk: s.walk, hat: 'cap', shirt: C.cyan, skin: '#f2c29b', pants: '#2a2f55', sh: true }));
  const cam = camOf(s);
  const frenzy = s.frenzy > 0;
  const scene = { sky: frenzy ? FRENZY : NIGHT, fog: { c: (frenzy ? FRENZY : NIGHT).bottom, near: 18, far: 46 }, light: { dir: [0.4, 0.8, 0.3], sun: frenzy ? '#ffb36b' : '#cfe0ff', i: 2.1 }, shadowR: 14, terrain: TERRAIN, statics: STATICS, objs, cam };

  // Modo menú: plaza con un personaje en reposo y monedas girando alrededor
  const menuScene = t => {
    const mo = [];
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + t * 0.4; mo.push(...coin(`mm${i}`, [Math.cos(a) * 4, 1.3 + Math.sin(t * 2 + i) * 0.2, Math.sin(a) * 4], { t, bob: 0.1, sh: false })); }
    mo.push(...person('yo', [0, 0, 0], { yaw: t * 0.5, t, walk: 0, hat: 'cap', shirt: C.cyan, skin: '#f2c29b', pants: '#2a2f55', sh: true }));
    return { sky: NIGHT, fog: { c: NIGHT.bottom, near: 18, far: 46 }, light: { dir: [0.4, 0.8, 0.3], sun: '#cfe0ff', i: 2.1 }, shadowR: 14, terrain: TERRAIN, statics: STATICS, objs: mo, cam: { p: [0, 3, 8], l: [0, 1, 0], fov: 62 } };
  };
  const m = multOf(s);

  return (
    <Game3D title="COIN RUSH" emoji="🪙" accent={C.amber} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={menuScene} orbit={{ r: 9, h: 3.6, speed: 0.22, ly: 1.1, drop: 1.4 }}
      hud={<>
        <HudPill icon="⏱" value={`${Math.ceil(Math.max(0, s.time))}s`} color={s.time < 8 ? C.red : C.cyan} />
        {s.frenzy > 0 ? <HudPill icon="🔥" label="FRENESÍ" value={Math.ceil(s.frenzy)} color={C.amber} /> : <HudPill icon="🔥" label="RACHA" value={s.combo} color={C.amber} />}
        {m > 1 && <HudPill icon="✖" value={m} color={C.amber} />}
      </>}
      subtitle="30 segundos en un mundo abierto"
      lines={['Joystick izquierdo para moverte · SALTAR para subir', 'Recoge las monedas caminando hacia ellas', '🥇 vale 5 · ⏱ +2 s · 💣 −3 s', 'Las rachas suben el multiplicador y activan el frenesí']}
      result={{ isNew: res.isNew, title: '¡TIEMPO!', emoji: '🪙', subtitle: `Monedas ${s.hits} · mejor racha ${s.maxCombo}`, stats: [['MONEDAS', s.hits], ['RACHA MÁX.', s.maxCombo]] }}>
      <Stick3D testID="cc-move" v={stick} side="left" color={C.cyan} />
      <ActionBtn testID="cc-jump" label="SALTAR" color={C.amber} onDown={jump} style={{ right: 22, bottom: 42 }} />
    </Game3D>
  );
}
