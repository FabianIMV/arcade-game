import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Combo, C, SCREEN_H, SCREEN_W, alpha, clamp, hx, rand, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { enemy, gem } from '../utils/prefabs';

// GALACTIC HUNT 3D – galería de tiro en PRIMERA PERSONA. Récord: 'galactic'.
// La cámara son los ojos del jugador, en el centro de una cúpula. Las dianas vuelan alrededor a 14-22 m.
// Arrastra para mirar; toca una diana para disparar (el disparo sale hacia el punto tocado).
// 45 segundos · cargador de 8 balas · 🛸 20 · 👽 10 · 💎 50 · ⏱ +4 s · 💣 -5 s · fallar rompe la racha.
const MAG = 8;
const FOV = 70;
const TAN = Math.tan((FOV / 2) * Math.PI / 180);
const LOOK_X = 0.005, LOOK_Y = 0.0035;      // radianes por píxel al arrastrar
const TYPES = {
  ufo: { d: 1.8, pts: 20, spd: 1, c: C.violet },
  alien: { d: 1.6, pts: 10, spd: 0.7, c: C.lime },
  gem: { d: 1.5, pts: 50, spd: 1.8, c: C.cyan },
  bomb: { d: 1.6, pts: 0, spd: 0.9, c: C.red },
  clock: { d: 1.6, pts: 0, spd: 1.1, c: C.lime },
};

// Dirección de mirada (yaw alrededor de Y, pitch alrededor de X) — mismo convenio que la cámara del motor
const fwd = (yaw, pitch) => [-Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)];

// Rayo que sale de la cámara por el punto (x, y) de la pantalla completa
const rayDir = (yaw, pitch, x, y) => {
  const vx = (x / SCREEN_W * 2 - 1) * TAN * (SCREEN_W / SCREEN_H);
  const vy = (1 - y / SCREEN_H * 2) * TAN;
  const ay = vy * Math.cos(pitch) + Math.sin(pitch);
  const az = vy * Math.sin(pitch) - Math.cos(pitch);
  const wx = vx * Math.cos(yaw) + az * Math.sin(yaw);
  const wz = -vx * Math.sin(yaw) + az * Math.cos(yaw);
  const L = Math.hypot(wx, ay, wz);
  return [wx / L, ay / L, wz / L];
};

// Rotación (XYZ) de una caja alargada en Z para que apunte en la dirección d (unitaria)
const aimRot = d => [Math.atan2(-d[1], d[2]), Math.asin(clamp(d[0], -1, 1)), 0];

// Pseudoaleatorio determinista para decorado estable
const hsh = n => { const v = Math.sin(n * 91.3458) * 47453.5453; return v - Math.floor(v); };

// Decorado FIJO (se calcula una vez): suelo, rayos de neón, torres y estrellas en la cúpula
const GF_STATIC = (() => {
  const out = [{ id: 'gal-suelo', k: 'pla', p: [0, -2.5, 0], s: [220, 220, 1], c: '#0c0822', recv: true, m: { r: 0.9, m: 0 } }];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    out.push({ k: 'box', inst: 'gal-rayo', p: [0, -2.46, 0], r: [0, a, 0], s: [0.06, 0.02, 60], c: C.violet, e: 0.9 });
  }
  // torres en la cúpula, desfasadas π/8 para que ninguna quede justo delante del jugador al empezar
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, x = Math.sin(a) * 46, z = Math.cos(a) * 46;
    out.push({ id: `gal-torre${i}`, k: 'box', p: [x, 9, z], s: [0.7, 22, 0.7], c: '#2a1654', e: 0.25, sh: true });
    out.push({ id: `gal-luz${i}`, k: 'oct', p: [x, 21.5, z], n: 1.4, c: i % 2 ? C.pink : C.cyan, e: 1 });
  }
  for (let i = 0; i < 90; i++) {
    const az = hsh(i) * Math.PI * 2, el = (hsh(i + 50) - 0.3) * 1.2;
    const d = fwd(az - Math.PI, el);
    out.push({ k: 'sph', inst: 'gal-estrella', p: [d[0] * 46, d[1] * 46, d[2] * 46], n: 0.2 + hsh(i + 90) * 0.22, c: '#e8f4ff', e: 1 });
  }
  return out;
})();

const initState = () => ({
  time: 45, t: 0, score: 0, combo: 0, best: 0, ammo: MAG, reload: 0, targets: [], tracers: [], spawn: 0.4,
  hits: 0, shots: 0, yaw: 0, pitch: 0, kick: 0, mode: 'idle', last: null, over: false,
});

// Objetos 3D de una diana: prefab del motor (ovni, slime, gema) o figura simple (bomba, reloj).
// Las caras de las dianas miran hacia el jugador (yaw = atan2(x, z)).
const targetObjs = (t, time) => {
  const f = fwd(t.az, t.el);
  const x = f[0] * t.R, y = f[1] * t.R, z = f[2] * t.R;
  const id = `t${t.id}`, face = Math.atan2(x, z), ph = t.ph, inst = `gal-${t.type}`;
  if (t.type === 'ufo') return enemy(id, 'ovni', [x, y, z], { c: '#b78bff', n: 0.72, t: time + ph, inst });
  if (t.type === 'alien') return enemy(id, 'slime', [x, y - 0.55, z], { c: '#7dff6b', n: 1.1, yaw: face, t: time + ph, inst });
  if (t.type === 'gem') return gem(id, [x, y - 0.4, z], { c: '#4de1ff', n: 1.25, t: time + ph, inst });
  if (t.type === 'bomb') return [
    { id: id + 'b', k: 'sph', p: [x, y, z], n: 1.05, c: '#23232f', m: { r: 0.4, m: 0.4 } },
    { id: id + 'f', k: 'cyl', p: [x + 0.12, y + 0.62, z], s: [0.1, 0.4, 0.1], c: '#d6d6e6' },
    { id: id + 's', k: 'sph', p: [x + 0.2, y + 0.95, z], n: 0.16 + 0.05 * Math.sin(time * 30), c: '#ff8a3d', e: 1, sh: false },
    { id: id + 'r', k: 'tor', p: [x, y, z], n: 1.25, r: [0, face + Math.PI, 0], c: C.red, e: 0.9, sh: false },
  ];
  // reloj: aro lima con manecillas que giran
  return [
    { id: id + 'a', k: 'tor', p: [x, y, z], n: 1.35, r: [0, face + Math.PI, 0], c: C.lime, e: 1, sh: false },
    { id: id + 'h', k: 'box', p: [x, y, z], s: [0.07, 0.6, 0.06], r: [0, face + Math.PI, time * 1.5], c: '#f4f6ff', e: 0.9, sh: false },
    { id: id + 'm', k: 'box', p: [x, y, z], s: [0.05, 0.42, 0.05], r: [0, face + Math.PI, time * 9], c: C.lime, e: 1, sh: false },
  ];
};

const targetWorld = t => { const f = fwd(t.az, t.el); return [f[0] * t.R, f[1] * t.R, f[2] * t.R]; };

export function GalacticHunt3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('galactic');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, acc: 0, streak: 0, hits: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };

  const finish = s => {
    if (s.over) return;
    s.over = true; s.time = 0; s.targets = []; s.tracers = [];
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    hx.win();
    setRes({ isNew: submitBest(s.score), acc, streak: s.best, hits: s.hits });
    setPhase('over');
  };

  const spawn = s => {
    const r = Math.random();
    const type = r < 0.38 ? 'ufo' : r < 0.66 ? 'alien' : r < 0.78 ? 'gem' : r < 0.9 ? 'bomb' : 'clock';
    const side = Math.random() < 0.5 ? 1 : -1;
    const m = TYPES[type].spd * (1 + Math.min(0.8, s.t / 70)) * rand(0.85, 1.2);
    const t = {
      id: uid(), type, R: rand(14, 22),
      az: side * rand(0.3, 0.7), el: rand(-0.25, 0.55), el0: 0, vaz: -side * rand(0.18, 0.32) * m,
      ph: Math.random() * 6, life: 9,
    };
    t.el0 = t.el;
    s.targets.push(t);
  };

  // Dispara al punto (x, y) de la pantalla: gana la diana más cercana al rayo dentro de su radio angular
  const shoot = (x, y) => {
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    if (s.reload > 0) { fx.pop(x, y - 20, 'RECARGANDO', C.dim, 12); return; }
    s.ammo -= 1; s.shots += 1; s.kick = 1;
    fx.ring(x, y, C.cyan, 26);
    const d = rayDir(s.yaw, s.pitch, x, y);
    s.tracers.push({ id: uid(), d, age: 0 });
    let hit = -1, bestAng = Infinity;
    s.targets.forEach((t, i) => {
      const f = fwd(t.az, t.el);
      const ang = Math.acos(clamp(d[0] * f[0] + d[1] * f[1] + d[2] * f[2], -1, 1));
      const angR = (TYPES[t.type].d * 0.5) / t.R + 0.04;
      if (ang < angR && ang < bestAng) { bestAng = ang; hit = i; }
    });
    if (hit < 0) {
      s.combo = 0; hx.tap();
      burst3d([d[0] * 16, d[1] * 16, d[2] * 16], C.cyan, 6, { speed: 3, size: 0.14, life: 0.4, g: 2 });
    } else {
      const t = s.targets.splice(hit, 1)[0];
      const w = targetWorld(t);
      s.hits += 1;
      if (t.type === 'bomb') {
        s.time = Math.max(0, s.time - 5); s.combo = 0;
        burst3d(w, [C.red, C.amber, '#ffffff'], 40, { speed: 9, size: 0.26, life: 0.9, g: 4 });
        ring3d(w, C.red, 26, { speed: 8, life: 0.7 });
        fx.shake(9); fx.flash(C.red, 0.3); fx.pop(x, y, '-5s', C.red, 22); hx.bad();
      } else if (t.type === 'clock') {
        s.time += 4;
        burst3d(w, [C.lime, '#ffffff'], 26, { speed: 7, size: 0.2, life: 0.8, g: 2 });
        ring3d(w, C.lime, 22, { speed: 6, life: 0.6 });
        fx.pop(x, y, '+4s', C.lime, 22); hx.good();
      } else {
        s.combo += 1; s.best = Math.max(s.best, s.combo);
        const mult = 1 + Math.floor(s.combo / 3);
        const pts = TYPES[t.type].pts * mult;
        s.score += pts;
        burst3d(w, t.type === 'gem' ? [C.cyan, '#ffffff'] : [TYPES[t.type].c, C.amber], 30, { speed: 9, size: 0.22, life: 0.9, g: 3 });
        ring3d(w, TYPES[t.type].c, 20, { speed: 6, life: 0.6 });
        fx.pop(x, y, `+${pts}`, mult > 1 ? C.amber : C.text, 18);
        hx.hit();
      }
    }
    if (s.ammo <= 0) s.reload = 1.1;
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    s.t += dt; s.time -= dt;
    s.kick = Math.max(0, s.kick - dt * 8);
    if (s.reload > 0) { s.reload -= dt; if (s.reload <= 0) { s.ammo = MAG; hx.tick(); } }
    s.spawn -= dt;
    if (s.spawn <= 0) { spawn(s); s.spawn = Math.max(0.35, 1.0 - s.t * 0.012) * rand(0.6, 1.2); }
    s.targets.forEach(t => { t.az += t.vaz * dt; t.el = t.el0 + Math.sin(s.t * 2.5 + t.ph) * 0.05; t.life -= dt; });
    s.targets = s.targets.filter(t => t.life > 0 && Math.abs(t.az) < 3.4);
    s.tracers.forEach(tr => { tr.age += dt; });
    s.tracers = s.tracers.filter(tr => tr.age < 0.14);
    if (s.time <= 0) finish(s);
  });

  // Arrastrar = mirar (yaw/pitch). Un toque sin arrastre = disparar al punto tocado.
  const pan = usePan(fx, {
    down: (x, y) => { const s = g.current; s.mode = 'pending'; s.last = { x, y }; },
    move: (x, y, gs) => {
      const s = g.current;
      if (s.mode === 'pending' && Math.hypot(gs.dx, gs.dy) > 10) s.mode = 'look';
      if (s.mode !== 'look' || !s.last) return;
      s.yaw -= (x - s.last.x) * LOOK_X;
      s.pitch = clamp(s.pitch - (y - s.last.y) * LOOK_Y, -1.2, 1.2);
      s.last = { x, y };
    },
    up: () => {
      // un toque: dispara al punto donde se apoyó el dedo (en el release x/y no son fiables para toques sin movimiento)
      const s = g.current;
      if (s.mode !== 'look' && s.last) shoot(s.last.x, s.last.y);
      s.mode = 'idle'; s.last = null;
    },
  });

  const s = g.current;
  const mult = 1 + Math.floor(s.combo / 3);
  const sway = Math.sin(s.t * 0.7) * 0.012;                   // balanceo leve de la cabeza
  const scene = {
    sky: { top: '#040211', bottom: '#1d0c3f', sun: false, clouds: 0 },
    fog: { c: '#1d0c3f', near: 30, far: 110 },
    light: { dir: [-0.3, 0.9, 0.2], sun: '#ffe9d6', i: 2.2, sky: '#8fa6ff', ground: '#1a1030', hi: 1.3 },
    lights: [{ p: [0, 1.5, -1], c: '#b57bff', i: 5, d: 22 }],
    statics: GF_STATIC,
    objs: [
      ...s.targets.flatMap(t => targetObjs(t, s.t)),
      ...s.tracers.map(tr => ({ id: `tr${tr.id}`, k: 'box', p: [tr.d[0] * 14, tr.d[1] * 14, tr.d[2] * 14], s: [0.035, 0.035, 25], r: aimRot(tr.d), c: C.cyan, e: 1, o: Math.max(0, 1 - tr.age / 0.14) })),
    ],
    cam: { p: [0, 0, 0], yaw: s.yaw + sway, pitch: clamp(s.pitch + s.kick * 0.03, -1.3, 1.3), fov: FOV },
  };

  return (
    <Game3D title="GALACTIC HUNT" emoji="🛸" accent={C.violet} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => ({ ...scene, cam: { p: [0, 0, 0], yaw: t * 0.12, pitch: 0.05, fov: FOV } })}
      pan={pan}
      hud={<>
        <HudPill icon="⏱" value={`${Math.ceil(s.time)}s`} color={s.time < 10 ? C.red : C.cyan} />
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>{Array.from({ length: MAG }, (_, i) => <View key={i} style={{ width: 7, height: 14, marginHorizontal: 1.5, borderRadius: 2, backgroundColor: s.reload > 0 ? C.dim : i < s.ammo ? C.amber : alpha(C.amber, 0.15) }} />)}</View>
        <View style={{ minWidth: 70, alignItems: 'flex-end' }}>{mult > 1 ? <Combo n={mult} /> : <Text style={{ color: C.dim, fontSize: 12 }}>{s.reload > 0 ? 'Recargando…' : ' '}</Text>}</View>
      </>}
      subtitle="45 segundos de caza en una cúpula de neón"
      lines={['Arrastra para mirar alrededor · toca una diana para disparar', '🛸 20 · 👽 10 · 💎 50 · ⏱️ +4s · 💣 -5s', 'Cargador de 8 balas · fallar rompe la racha']}
      result={{ won: false, isNew: res.isNew, title: '¡TIEMPO!', emoji: '🛸', subtitle: `Precisión ${res.acc}% · Mejor racha ${res.streak}`, stats: [['ACIERTOS', res.hits], ['PRECISIÓN', `${res.acc}%`], ['RACHA', res.streak]] }}>
      {phase === 'play' && s.t < 5 && <Text pointerEvents="none" style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', color: alpha('#ffffff', 0.5), fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>ARRASTRA PARA MIRAR · TOCA PARA DISPARAR</Text>}
    </Game3D>
  );
}
