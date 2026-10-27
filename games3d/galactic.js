import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, Combo, GameScreen, Overlay, PlayArea, clamp, hx, rand, uid, useBest, useFX, useLoop, usePan, alpha } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Galería de tiro en PRIMERA PERSONA: la cámara son los ojos del jugador, en el centro de una cúpula.
// Los objetivos vuelan alrededor a 14-22 m. Arrastra para mirar; toca un objetivo para disparar
// (el disparo sale hacia el punto tocado). La puntuación, el cargador y el tiempo son los del 2D.
const MAG = 8;
const FOV = 70;
const TAN = Math.tan((FOV / 2) * Math.PI / 180);
const LOOK_X = 0.005, LOOK_Y = 0.0035;      // radianes por píxel al arrastrar
const TYPES = {
  ufo: { size: 46, pts: 20, spd: 1, c: C.violet },
  alien: { size: 44, pts: 10, spd: 0.7, c: C.lime },
  gem: { size: 34, pts: 50, spd: 1.8, c: C.cyan },
  bomb: { size: 40, pts: 0, spd: 0.9, c: C.red },
  clock: { size: 38, pts: 0, spd: 1.1, c: C.lime },
};

// Dirección de mirada (yaw alrededor de Y, pitch alrededor de X) — mismo convenio que la cámara del motor (YXZ)
const fwd = (yaw, pitch) => [-Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)];

// Rayo que sale de la cámara por el punto (x, y) de la pantalla
const rayDir = (yaw, pitch, x, y) => {
  const vx = (x / AREA_W * 2 - 1) * TAN * (AREA_W / AREA_H);
  const vy = (1 - y / AREA_H * 2) * TAN;
  const ay = vy * Math.cos(pitch) + Math.sin(pitch);
  const az = vy * Math.sin(pitch) - Math.cos(pitch);
  const wx = vx * Math.cos(yaw) + az * Math.sin(yaw);
  const wz = -vx * Math.sin(yaw) + az * Math.cos(yaw);
  const L = Math.hypot(wx, ay, wz);
  return [wx / L, ay / L, wz / L];
};

// Pseudoaleatorio determinista para decorado estable
const hsh = n => { const v = Math.sin(n * 91.3458) * 47453.5453; return v - Math.floor(v); };

// Estrellas fijas en una cúpula lejana (no cambian entre frames)
const GF_STARS = Array.from({ length: 70 }, (_, i) => {
  const d = fwd(hsh(i) * Math.PI * 2 - Math.PI, (hsh(i + 50) - 0.3) * 1.2);
  return { id: `gs${i}`, k: 'sph', p: [d[0] * 45, d[1] * 45, d[2] * 45], n: 0.22 + hsh(i + 90) * 0.2, c: '#e8f4ff', e: 1 };
});
// Torres de neón alrededor, para tener referencias al girar
const GF_TOWERS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  const d = fwd(a, 0);
  return { id: `tw${i}`, k: 'box', p: [d[0] * 28, 1.8, d[2] * 28], s: [0.7, 7, 0.7], c: i % 2 ? C.violet : C.pink, e: 0.5 };
});
const GF_GROUND = { id: 'ground', k: 'pla', p: [0, -2.5, 0], s: [260, 260, 1], c: '#0b0820' };
// Líneas radiales de neón en el suelo: se ven girar al mirar alrededor
const GF_RAYS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  const d = fwd(a, 0);
  return { id: `ray${i}`, k: 'box', p: [d[0] * 30, -2.45, d[2] * 30], s: [0.06, 0.02, 60], r: [0, a + Math.PI, 0], c: C.violet, e: 0.5 };
});

const initState = () => ({
  time: 45, t: 0, score: 0, combo: 0, best: 0, ammo: MAG, reload: 0, targets: [], spawn: 0.4,
  hits: 0, shots: 0, yaw: 0, pitch: 0, kick: 0, mode: 'idle', last: null,
});

// Objetos 3D de un objetivo (posición en la cúpula: dirección × distancia)
const targetObjs = (t, time) => {
  const d = fwd(t.az, t.el);
  const x = d[0] * t.R, y = d[1] * t.R, z = d[2] * t.R;
  const id = `t${t.id}`, sz = t.size, c = TYPES[t.type].c;
  if (t.type === 'ufo') return [{ id, k: 'sph', p: [x, y, z], s: [sz * 1.1, sz * 0.42, sz * 1.1], c, e: 0.6 }];
  if (t.type === 'alien') return [{ id, k: 'sph', p: [x, y, z], n: sz * 0.8, c, e: 0.5 }];
  if (t.type === 'gem') {
    const h = sz * 0.7;
    return [
      { id, k: 'cone', p: [x, y + h / 2, z], s: [sz * 0.8, h, sz * 0.8], r: [0, time, 0], c, e: 0.7 },
      { id: id + 'b', k: 'cone', p: [x, y - h / 2, z], s: [sz * 0.8, h, sz * 0.8], r: [Math.PI, time, 0], c, e: 0.7 },
    ];
  }
  if (t.type === 'bomb') return [
    { id, k: 'sph', p: [x, y, z], n: sz * 0.9, c, e: 0.6 },
    { id: id + 'f', k: 'box', p: [x, y + sz * 0.55, z], s: [0.12, 0.3, 0.12], c: C.amber, e: 1 },
  ];
  return [{ id, k: 'tor', p: [x, y, z], n: sz * 0.9, r: [0, time, 0], c, e: 0.7 }];   // reloj
};

export function GalacticHunt3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('galactic');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };

  const spawn = s => {
    const r = Math.random();
    const type = r < 0.38 ? 'ufo' : r < 0.66 ? 'alien' : r < 0.78 ? 'gem' : r < 0.9 ? 'bomb' : 'clock';
    const side = Math.random() < 0.5 ? 1 : -1;
    const m = TYPES[type].spd * (1 + Math.min(0.8, s.t / 70)) * rand(0.85, 1.2);
    s.targets.push({
      id: uid(), type, size: TYPES[type].size / 25, R: rand(14, 22),
      az: side * rand(0.5, 1.1), el: rand(-0.25, 0.55), el0: 0, vaz: -side * rand(0.18, 0.32) * m,
      ph: Math.random() * 6, life: 9,
    });
    const t = s.targets[s.targets.length - 1];
    t.el0 = t.el;
  };

  // Dispara al punto (x, y) de la pantalla: gana el objetivo más cercano al rayo dentro de su radio angular
  const shoot = (x, y) => {
    const s = g.current;
    if (phase !== 'play') return;
    if (s.reload > 0) { fx.pop(x, y - 20, 'RECARGANDO', C.dim, 12); return; }
    s.ammo -= 1; s.shots += 1; s.kick = 1;
    fx.ring(x, y, C.cyan, 26);
    const d = rayDir(s.yaw, s.pitch, x, y);
    let hit = -1, bestAng = Infinity;
    s.targets.forEach((t, i) => {
      const f = fwd(t.az, t.el);
      const ang = Math.acos(clamp(d[0] * f[0] + d[1] * f[1] + d[2] * f[2], -1, 1));
      const angR = (t.size * 0.5) / t.R + 0.04;
      if (ang < angR && ang < bestAng) { bestAng = ang; hit = i; }
    });
    if (hit < 0) {
      s.combo = 0; hx.tap();
    } else {
      const t = s.targets.splice(hit, 1)[0];
      s.hits += 1;
      if (t.type === 'bomb') {
        s.time = Math.max(0, s.time - 5); s.combo = 0;
        fx.burst(x, y, C.red, 22, 260); fx.shake(9); fx.flash(C.red, 0.3); fx.pop(x, y, '-5s', C.red, 22); hx.bad();
      } else if (t.type === 'clock') {
        s.time += 4;
        fx.burst(x, y, C.lime, 14, 200); fx.pop(x, y, '+4s', C.lime, 22); hx.good();
      } else {
        s.combo += 1; s.best = Math.max(s.best, s.combo);
        const mult = 1 + Math.floor(s.combo / 3);
        const pts = TYPES[t.type].pts * mult;
        s.score += pts;
        fx.burst(x, y, t.type === 'gem' ? C.cyan : C.pink, 14, 220); fx.pop(x, y, `+${pts}`, mult > 1 ? C.amber : C.text, 18);
        hx.hit();
      }
    }
    if (s.ammo <= 0) s.reload = 1.1;
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt; s.time -= dt;
    s.kick = Math.max(0, s.kick - dt * 8);
    if (s.reload > 0) { s.reload -= dt; if (s.reload <= 0) { s.ammo = MAG; hx.tick(); } }
    s.spawn -= dt;
    if (s.spawn <= 0) { spawn(s); s.spawn = Math.max(0.35, 1.0 - s.t * 0.012) * rand(0.6, 1.2); }
    s.targets.forEach(t => { t.az += t.vaz * dt; t.el = t.el0 + Math.sin(s.t * 2.5 + t.ph) * 0.05; t.life -= dt; });
    s.targets = s.targets.filter(t => t.life > 0 && Math.abs(t.az) < 3.4);
    if (s.time <= 0) {
      s.time = 0; hx.win();
      setRes({ isNew: submitBest(s.score) });
      setPhase('over');
    }
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
  const shakeYaw = fx.shakeT > 0 ? (Math.random() - 0.5) * fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.02 : 0;
  const scene = {
    bg: '#05030f', fog: { c: '#05030f', near: 30, far: 80 },
    objs: [GF_GROUND, ...GF_RAYS, ...GF_STARS, ...GF_TOWERS, ...s.targets.flatMap(t => targetObjs(t, s.t))],
    cam: { p: [0, 0, 0], yaw: s.yaw + shakeYaw, pitch: clamp(s.pitch + s.kick * 0.03, -1.3, 1.3), fov: FOV },
  };

  return (
    <GameScreen title="GALACTIC HUNT" emoji="🛸" accent={C.violet} onExit={onExit} score={s.score} best={best}
      hud={<>
        <Text style={{ color: s.time < 10 ? C.red : C.text, fontWeight: '900', fontSize: 15 }}>⏱ {Math.ceil(s.time)}s</Text>
        <View style={{ flexDirection: 'row' }}>{Array.from({ length: MAG }, (_, i) => <View key={i} style={{ width: 7, height: 14, marginHorizontal: 1.5, borderRadius: 2, backgroundColor: s.reload > 0 ? C.dim : i < s.ammo ? C.amber : alpha(C.amber, 0.15) }} />)}</View>
        <View style={{ minWidth: 70, alignItems: 'flex-end' }}>{mult > 1 ? <Combo n={mult} /> : <Text style={{ color: C.dim, fontSize: 12 }}>{s.reload > 0 ? 'Recargando…' : ' '}</Text>}</View>
      </>}>
      <PlayArea fx={fx} bg="#05030f" {...pan}>
        <World3D scene={scene} />
        {phase === 'play' && s.t < 5 && <Text pointerEvents="none" style={{ position: 'absolute', bottom: 10, width: AREA_W, textAlign: 'center', color: alpha('#ffffff', 0.45), fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>ARRASTRA PARA MIRAR · TOCA PARA DISPARAR</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🛸" title={phase === 'over' ? '¡TIEMPO!' : 'GALACTIC HUNT 3D'}
          subtitle={phase === 'over' ? `Precisión ${s.shots ? Math.round((s.hits / s.shots) * 100) : 0}% · Mejor racha ${s.best}` : '45 segundos de caza'}
          score={s.score} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para mirar alrededor · toca para disparar', '🛸 20 · 👽 10 · 💎 50 · ⏱️ +4s · 💣 -5s', 'Cargador de 8 balas · fallar rompe la racha'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
