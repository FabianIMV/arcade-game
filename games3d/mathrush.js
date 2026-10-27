import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Lives, Combo, Overlay, PlayArea, alpha, hx, rand, randInt, shuffle, tglow, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Campo 3D: los enemigos (cada uno con su operación) avanzan desde el fondo hacia la base.
// Tercera persona detrás de la base; los tres cañones son losetas en el suelo con las respuestas.
const FOV = 60, FAR = -38, DZ = 1.4, BASE_Z = 2.8, PAD_Z = 4.6, PAD_X = 2.2;
const CAM = { p: [0, 4.4, 13.2], l: [0, 0.5, -6], fov: FOV };
const LANE = 3.4;

// Proyección de la cámara fija: 3D → píxeles del área (para Text 2D) y picking sobre un plano.
const camRig = cam => {
  const th = Math.tan((cam.fov * Math.PI) / 360);
  const [ex, ey, ez] = cam.p;
  let fx = cam.l[0] - ex, fy = cam.l[1] - ey, fz = cam.l[2] - ez;
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const K = (AREA_H / 2) / th;
  const toScreen = (x, y, z) => {
    const dx = x - ex, dy = y - ey, dz = z - ez;
    const zc = dx * fx + dy * fy + dz * fz;
    const xc = dx * rx + dz * rz, yc = dx * ux + dy * uy + dz * uz;
    const k = K / zc;
    return { x: AREA_W / 2 + xc * k, y: AREA_H / 2 - yc * k, s: k };
  };
  const ray = (sx, sy) => {
    const a = ((sx - AREA_W / 2) / (AREA_H / 2)) * th, b = -((sy - AREA_H / 2) / (AREA_H / 2)) * th;
    return [fx + rx * a + ux * b, fy + uy * b, fz + rz * a + uz * b];
  };
  const onY = (sx, sy, h) => { const d = ray(sx, sy); const t = (h - ey) / d[1]; return [ex + d[0] * t, h, ez + d[2] * t]; };
  return { toScreen, onY };
};
const RIG = camRig(CAM);

const BLOCK_KIND = { normal: C.pink, bomb: C.orange, freeze: C.cyan };
const padPos = i => [(i - 1) * PAD_X, PAD_Z];

const initState = () => ({
  blocks: [], spawn: 0.5, t: 0, score: 0, lives: 3, combo: 0, maxCombo: 0, solved: 0, level: 1, freeze: 0, bad: 0, shakeAt: 0,
  banner: { text: 'NIVEL 1 · SUMAS Y RESTAS', t: 1.5 },
});

const makeProblem = lv => {
  let a, b, op;
  const r = Math.random();
  if (lv === 1) { op = r < 0.5 ? '+' : '−'; a = randInt(2, 20); b = randInt(1, 15); }
  else if (lv === 2) { op = r < 0.4 ? '×' : r < 0.7 ? '+' : '−'; a = op === '×' ? randInt(2, 9) : randInt(10, 60); b = op === '×' ? randInt(2, 9) : randInt(5, 40); }
  else { op = r < 0.45 ? '×' : r < 0.75 ? '+' : '−'; a = op === '×' ? randInt(3, 12) : randInt(20, 99); b = op === '×' ? randInt(3, 12) : randInt(10, 80); }
  if (op === '−' && b > a) [a, b] = [b, a];
  const ans = op === '+' ? a + b : op === '−' ? a - b : a * b;
  const opts = new Set([ans]);
  while (opts.size < 3) { const d = randInt(1, lv === 1 ? 5 : 9) * (Math.random() < 0.5 ? -1 : 1); const v = ans + d; if (v >= 0) opts.add(v); }
  return { text: `${a} ${op} ${b}`, ans, opts: shuffle([...opts]) };
};

export function MathRush3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('mathrush');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };

  const spawn = s => {
    const p = makeProblem(s.level);
    const r = Math.random();
    const kind = r < 0.07 ? 'bomb' : r < 0.13 ? 'freeze' : 'normal';
    let x = rand(-LANE, LANE);
    for (let k = 0; k < 8; k++) { if (!s.blocks.some(b => b.z < FAR + 8 && Math.abs(b.x - x) < 1.6)) break; x = rand(-LANE, LANE); }
    s.blocks.push({ id: uid(), ...p, kind, x, z: FAR, vz: 1.6 + s.level * 0.5 + Math.min(3, s.t * 0.02), wob: Math.random() * 6 });
  };
  const targetOf = s => (s.blocks.length ? s.blocks.reduce((a, b) => (b.z > a.z ? b : a)) : null);
  const answer = v => {
    const s = g.current;
    if (phase !== 'play' || !s.blocks.length) return;
    const target = targetOf(s);
    if (v !== target.ans) {
      s.combo = 0; s.bad = 0.25; fx.shake(5, 0.2); fx.flash(C.red, 0.15); hx.bad(); target.z -= 1.4; return;
    }
    const sp = RIG.toScreen(target.x, 0.8, target.z);
    s.blocks = s.blocks.filter(b => b !== target);
    s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo); s.solved += 1;
    const pts = 10 * s.level + s.combo * 2; s.score += pts;
    fx.burst(sp.x, sp.y, C.pink, 14, 220); fx.pop(sp.x, sp.y - 12, `+${pts}`, C.text, 17); hx.hit();
    if (target.kind === 'bomb') {
      s.blocks.forEach(b => { const q = RIG.toScreen(b.x, 0.8, b.z); fx.burst(q.x, q.y, C.orange, 10, 200); s.score += 5; }); s.blocks = [];
      fx.ring(sp.x, sp.y, C.orange, 200); fx.flash(C.orange, 0.35); fx.shake(8, 0.3); hx.heavy();
    }
    if (target.kind === 'freeze') { s.freeze = 4; fx.flash(C.cyan, 0.25); fx.pop(sp.x, sp.y - 36, '❄ CONGELADO', C.cyan, 16); hx.good(); }
    if (s.solved % 8 === 0) { s.level = Math.min(3, s.level + 1); if (s.solved === 8 || s.solved === 16) { s.banner = { text: s.level === 2 ? 'NIVEL 2 · ¡MULTIPLICACIONES!' : 'NIVEL 3 · ¡NÚMEROS GRANDES!', t: 1.6 }; hx.good(); } }
  };
  useLoop(phase === 'play', dt0 => {
    const s = g.current;
    s.t += dt0;
    if (s.freeze > 0) s.freeze -= dt0;
    if (s.bad > 0) s.bad -= dt0;
    if (s.banner) { s.banner.t -= dt0; if (s.banner.t <= 0) s.banner = null; }
    const dt = dt0 * (s.freeze > 0 ? 0.15 : 1);
    s.spawn -= dt;
    if (s.spawn <= 0) { spawn(s); s.spawn = Math.max(1.1, 2.6 - s.t * 0.018 - s.level * 0.15); }
    s.blocks.forEach(b => { b.z += b.vz * dt; b.wob += dt * 3; });
    for (let i = s.blocks.length - 1; i >= 0; i--) {
      const b = s.blocks[i];
      if (b.z >= DZ) {
        s.blocks.splice(i, 1); s.lives -= 1; s.combo = 0;
        const q = RIG.toScreen(b.x, 0.5, DZ);
        fx.burst(q.x, q.y, C.red, 18, 240); fx.shake(8, 0.3); fx.flash(C.red, 0.3); hx.bad();
        if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
      }
    }
  });
  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current; if (phase !== 'play' || !s.blocks.length) return;
      const [wx, , wz] = RIG.onY(x, y, 0.4);
      const i = [0, 1, 2].find(k => { const [px, pz] = padPos(k); return Math.abs(wx - px) < 1.0 && Math.abs(wz - pz) < 0.9; });
      if (i !== undefined) answer(targetOf(s).opts[i]);
    },
  });

  const s = g.current;
  const target = targetOf(s);
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, -14], s: [16, 60, 1], c: '#0d0820' },
    { id: 'linea', k: 'box', p: [0, 0.06, DZ], s: [9, 0.12, 0.25], c: C.red, e: 0.5 },
    { id: 'nave', k: 'cone', p: [0, 0.9, BASE_Z], s: [0.9, 1.4, 0.9], c: C.cyan, e: 0.25 },
    ...Array.from({ length: 14 }, (_, i) => ({ id: `carril${i}`, k: 'box', p: [0, 0.01, 4 - i * 3], s: [9, 0.02, 0.06], c: C.pink, e: 0.3 })),
    ...s.blocks.map(b => {
      const col = BLOCK_KIND[b.kind];
      const isT = b === target;
      const base = { id: `e${b.id}`, c: col, e: isT ? 0.3 : 0.12 };
      if (b.kind === 'bomb') return { ...base, k: 'sph', p: [b.x, 0.9, b.z], n: 1.5 };
      if (b.kind === 'freeze') return { ...base, k: 'cyl', p: [b.x, 0.9, b.z], s: [1.2, 1.2, 1.2] };
      return { ...base, k: 'box', p: [b.x, 0.9 + Math.sin(b.wob) * 0.08, b.z], s: [2.0, 1.2, 1.2] };
    }),
    ...(target ? [{ id: 'objetivo', k: 'tor', p: [target.x, 0.06, target.z], n: 2.1, r: [-Math.PI / 2, 0, 0], c: '#ffffff', e: 0.5 }] : []),
    ...(target ? target.opts.map((o, i) => { const [px, pz] = padPos(i); return { id: `cañon${i}`, k: 'box', p: [px, 0.3, pz], s: [1.5, 0.6, 1.3], c: C.cyan, e: 0.2 }; }) : []),
  ];
  const scene = { bg: '#0a0612', fog: { c: '#0a0612', near: 30, far: 80 }, objs, cam: CAM };
  return (
    <GameScreen title="MATH RUSH" emoji="🧮" accent={C.pink} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.pink, fontWeight: '800' }}>{s.level}</Text> · Resueltas {s.solved}</Text><View style={{ minWidth: 70, alignItems: 'flex-end' }}>{s.combo > 1 ? <Combo n={s.combo} color={C.pink} /> : <Text style={{ color: C.cyan, fontWeight: '800', fontSize: 12 }}>{s.freeze > 0 ? '❄' : ''}</Text>}</View></>}>
      <PlayArea fx={fx} bg={s.bad > 0 ? '#1a0610' : '#0a0612'} border={alpha(C.pink, 0.4)} {...pan}>
        <World3D scene={scene} />
        {s.blocks.map(b => {
          const p = RIG.toScreen(b.x, 1.9, b.z);
          if (p.s < 8) return null;
          const fs = Math.max(13, Math.min(24, Math.round(p.s * 0.22)));
          const col = BLOCK_KIND[b.kind];
          return (
            <Text key={b.id} pointerEvents="none" style={{ position: 'absolute', left: p.x - 70, top: p.y - fs, width: 140, textAlign: 'center', color: C.text, fontSize: fs, fontWeight: '900', ...tglow(col, 6) }}>
              {b.kind === 'bomb' ? '💣 ' : b.kind === 'freeze' ? '❄ ' : ''}{b.text}
            </Text>
          );
        })}
        {target && [0, 1, 2].map(i => {
          const [px, pz] = padPos(i);
          const p = RIG.toScreen(px, 0.9, pz);
          return <Text key={i} pointerEvents="none" style={{ position: 'absolute', left: p.x - 50, top: p.y - 18, width: 100, textAlign: 'center', color: '#fff', fontSize: 26, fontWeight: '900', ...tglow(C.cyan, 8) }}>{target.opts[i]}</Text>;
        })}
        {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.3, width: AREA_W, textAlign: 'center', color: C.text, fontSize: 18, fontWeight: '900', letterSpacing: 2, opacity: Math.min(1, s.banner.t), ...tglow(C.pink, 12) }}>{s.banner.text}</Text>}
        <Text pointerEvents="none" style={{ position: 'absolute', top: 10, width: AREA_W, textAlign: 'center', color: alpha(C.dim, 0.8), fontSize: 11, fontWeight: '800', letterSpacing: 1.5 }}>
          {target ? `RESUELVE: ${target.text} = ?` : 'ESPERANDO ENEMIGOS…'}
        </Text>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🧮" title={phase === 'over' ? 'SIN VIDAS' : 'MATH RUSH 3D'}
          subtitle={phase === 'over' ? `${s.solved} operaciones · mejor racha ${s.maxCombo}` : 'Resuelve antes de que lleguen a la base'}
          score={s.score} best={best} isNew={res.isNew} accent={C.pink} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca el cañón con la respuesta de la operación marcada', '💣 destruye todo · ❄ congela el tiempo', 'Cada 8 aciertos sube la dificultad'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
