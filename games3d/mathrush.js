import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, Lives, SCREEN_H, SCREEN_W, clamp, hx, rand, randInt, shuffle, tglow, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { Game3D, HudPill } from '../utils/ui3d';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { project, rayGround } from '../utils/openworld';
import { enemy, ship } from '../utils/prefabs';

// MATH RUSH 3D – defensa espacial en tercera persona. Las naves enemigas (cada una con su operación)
// bajan desde el fondo hacia la base; la línea roja es el límite. Los tres cañones son cristales en el suelo
// con las respuestas encima: toca el que tiene la correcta. Bombas (💣) destruyen todo · hielo (❄) frena el tiempo.
const FAR = -40, DZ = 1.4, BASE_Z = 2.8, PAD_Z = 4.2, PAD_X = 1.85, PAD_Y = 0.9, LANE = 3.4;
const CAM = { p: [0, 4.8, 13.6], l: [0, 0.4, -7], fov: 58 };
const SKY = { top: '#070221', bottom: '#2b0c4f' };
const KIND_C = { normal: C.pink, bomb: C.orange, freeze: C.cyan };
const PAD_C = [C.cyan, C.lime, C.amber];
const padPos = i => [(i - 1) * PAD_X, PAD_Z];

// Suelo con rejilla y pilares de neón: se calculan UNA vez (statics + instancing), no cuestan nada por frame
const STATIC = (() => {
  const out = [{ id: 'suelo', k: 'pla', p: [0, 0, -14], s: [70, 80, 1], c: '#0a0420', recv: true }];
  for (let z = -40; z <= 8; z += 2) out.push({ id: `rz${z}`, k: 'box', p: [0, 0.01, z], s: [70, 0.02, 0.05], c: C.violet, e: 0.6, inst: 'rejilla_z' });
  for (let x = -22; x <= 22; x += 2) out.push({ id: `rx${x}`, k: 'box', p: [x, 0.01, -14], s: [0.05, 0.02, 80], c: C.violet, e: 0.6, inst: 'rejilla_x' });
  for (let z = -36; z <= 0; z += 6) for (const sx of [-9, 9]) out.push({ id: `pi${z}_${sx}`, k: 'box', p: [sx, 2.2, z], s: [0.35, 4.4, 0.35], c: C.pink, e: 0.9, inst: 'pilar' });
  return out;
})();

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

const initState = () => ({
  blocks: [], spawn: 0.5, t: 0, score: 0, lives: 3, combo: 0, maxCombo: 0, solved: 0, level: 1, freeze: 0, bad: 0, shots: [],
  banner: { text: 'NIVEL 1 · SUMAS Y RESTAS', t: 1.5 },
});
const targetOf = s => (s.blocks.length ? s.blocks.reduce((a, b) => (b.z > a.z ? b : a)) : null);

// Nave enemiga según su tipo: platillo volador (normal), meteorito con púas (bomba), cristal girando (hielo)
const foeObjs = (b, t) => {
  const y = 1.8 + Math.sin(b.wob) * 0.14;
  if (b.kind === 'bomb') return [
    { id: `e${b.id}`, k: 'ico', p: [b.x, y, b.z], n: 1.3, r: [t * 1.4, t * 0.9, 0], c: C.orange, e: 0.85, sh: true },
    { id: `e${b.id}h`, k: 'sph', p: [b.x, y, b.z], n: 2.2, c: C.orange, e: 0.7, o: 0.14 },
  ];
  if (b.kind === 'freeze') return [{ id: `e${b.id}`, k: 'oct', p: [b.x, y, b.z], s: [1.0, 1.8, 1.0], r: [0, t * 1.3, 0], c: C.cyan, e: 0.9, sh: true }];
  return enemy(`e${b.id}`, 'ovni', [b.x, y, b.z], { t, c: C.pink, beam: true });
};
// rayo horizontal entre el cañón y el objetivo (dura lo que tarde en encogerse k)
const beamObj = (id, a, b, c, k) => {
  const dx = b[0] - a[0], dz = b[2] - a[2];
  return { id, k: 'box', p: [(a[0] + b[0]) / 2, 1.2, (a[2] + b[2]) / 2], s: [0.16 * k, 0.16 * k, Math.hypot(dx, dz)], r: [0, Math.atan2(dx, dz), 0], c, e: 1 };
};

// Textos 2D encima de objetos 3D: cada etiqueta se proyecta con la cámara del juego.
// Se mide el contenedor en pantalla (measureInWindow) para compensar la cabecera de Game3D.
function Labels3D({ cam, items }) {
  const box = useRef(null);
  const org = useRef({ x: 0, y: 0 }).current;
  const measure = () => { if (box.current && box.current.measureInWindow) box.current.measureInWindow((x, y) => { org.x = x; org.y = y; }); };
  const K = (SCREEN_H / 2) / Math.tan((cam.fov * Math.PI) / 360);
  return (
    <View ref={box} onLayout={measure} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      {items.map(it => {
        const q = project(cam, it.p, SCREEN_W, SCREEN_H);
        if (!q) return null;
        const fs = Math.round(clamp((K / q.z) * it.u, it.min, it.max));
        const w = it.w || 200;
        return (
          <Text key={it.key} pointerEvents="none" numberOfLines={1} style={{ position: 'absolute', left: q.x - w / 2 - org.x, top: q.y - fs * 0.6 - org.y, width: w, textAlign: 'center', color: it.color, fontSize: fs, fontWeight: '900', ...tglow(it.color, 8) }}>{it.text}</Text>
        );
      })}
    </View>
  );
}

export function MathRush3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('mathrush');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };

  const spawn = s => {
    const p = makeProblem(s.level);
    const r = Math.random();
    const kind = r < 0.07 ? 'bomb' : r < 0.13 ? 'freeze' : 'normal';
    let x = rand(-LANE, LANE);
    for (let k = 0; k < 8; k++) { if (!s.blocks.some(b => b.z < FAR + 8 && Math.abs(b.x - x) < 1.6)) break; x = rand(-LANE, LANE); }
    s.blocks.push({ id: uid(), ...p, kind, x, z: FAR, vz: 1.6 + s.level * 0.5 + Math.min(3, s.t * 0.02), wob: Math.random() * 6 });
  };

  const answer = (v, i) => {
    const s = g.current;
    if (phase !== 'play' || !s.blocks.length) return;
    const target = targetOf(s);
    if (v !== target.ans) {
      s.combo = 0; s.bad = 0.25; fx.shake(5, 0.2); fx.flash(C.red, 0.15); hx.bad(); target.z -= 1.4; return;
    }
    const [px, pz] = padPos(i);
    s.shots.push({ id: uid(), a: [px, 1.2, pz], b: [target.x, 1.2, target.z], c: PAD_C[i], t: 0.18 });
    s.blocks = s.blocks.filter(b => b !== target);
    s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo); s.solved += 1;
    const pts = 10 * s.level + s.combo * 2; s.score += pts;
    const at = [target.x, 1.8, target.z];
    burst3d(at, [KIND_C[target.kind], '#ffffff'], 30, { speed: 7, up: 2.5, size: 0.2, life: 0.8 });
    ring3d(at, KIND_C[target.kind], 22, { speed: 6, life: 0.6 });
    const q = project(CAM, [target.x, 2.7, target.z], SCREEN_W, SCREEN_H);
    if (q) fx.pop(q.x, q.y, `+${pts}`, C.text, 22);
    hx.hit();
    if (target.kind === 'bomb') {
      s.blocks.forEach(b => { burst3d([b.x, 1.8, b.z], C.orange, 22, { speed: 8, up: 3, size: 0.22, life: 0.9 }); s.score += 5; });
      s.blocks = []; ring3d([target.x, 0.2, target.z], C.orange, 36, { speed: 9, life: 0.9 });
      fx.flash(C.orange, 0.35); fx.shake(8, 0.3); hx.heavy();
    }
    if (target.kind === 'freeze') { s.freeze = 4; fx.flash(C.cyan, 0.25); fx.pop(SCREEN_W / 2, SCREEN_H * 0.4, '❄ CONGELADO', C.cyan, 20); hx.good(); }
    if (s.solved % 8 === 0) {
      s.level = Math.min(3, s.level + 1);
      if (s.solved === 8 || s.solved === 16) { s.banner = { text: s.level === 2 ? 'NIVEL 2 · ¡MULTIPLICACIONES!' : 'NIVEL 3 · ¡NÚMEROS GRANDES!', t: 1.6 }; hx.good(); }
    }
  };

  useLoop(phase === 'play', dt0 => {
    const s = g.current;
    s.t += dt0;
    if (s.freeze > 0) s.freeze -= dt0;
    if (s.bad > 0) s.bad -= dt0;
    s.shots.forEach(sh => { sh.t -= dt0; });
    s.shots = s.shots.filter(sh => sh.t > 0);
    if (s.banner) { s.banner.t -= dt0; if (s.banner.t <= 0) s.banner = null; }
    const dt = dt0 * (s.freeze > 0 ? 0.15 : 1);
    s.spawn -= dt;
    if (s.spawn <= 0) { spawn(s); s.spawn = Math.max(1.1, 2.6 - s.t * 0.018 - s.level * 0.15); }
    s.blocks.forEach(b => { b.z += b.vz * dt; b.wob += dt * 3; });
    for (let i = s.blocks.length - 1; i >= 0; i--) {
      const b = s.blocks[i];
      if (b.z >= DZ) {
        s.blocks.splice(i, 1); s.lives -= 1; s.combo = 0;
        burst3d([b.x, 1.0, DZ], C.red, 26, { speed: 7, up: 2, size: 0.22, life: 0.9 });
        ring3d([b.x, 0.1, DZ], C.red, 18, { speed: 6, life: 0.7 });
        fx.shake(8, 0.3); fx.flash(C.red, 0.3); hx.bad();
        if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
      }
    }
  });

  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current; if (phase !== 'play' || !s.blocks.length) return;
      const hit = rayGround(CAM, x, y, SCREEN_W, SCREEN_H, PAD_Y);
      if (!hit) return;
      const i = [0, 1, 2].find(k => { const [px, pz] = padPos(k); return Math.abs(hit[0] - px) < 1.3 && Math.abs(hit[2] - pz) < 1.2; });
      if (i !== undefined) answer(targetOf(s).opts[i], i);
    },
  });

  const s = g.current;
  const target = targetOf(s);
  const tc = target ? KIND_C[target.kind] : C.pink;
  const objs = [
    ...ship('nave', [0, 0.85, BASE_Z], { c: C.cyan, c2: C.pink, thrust: 0.9, t: s.t, n: 0.7 }),
    { id: 'linea', k: 'box', p: [0, 0.05, DZ], s: [9.5, 0.08, 0.16], c: C.red, e: 1 },
    ...[0, 1, 2].flatMap(i => {
      const [px, pz] = padPos(i);
      return [
        { id: `pad${i}`, k: 'cyl', p: [px, 0.22, pz], s: [1.25, 0.44, 1.25], c: '#1a1438', e: 0.1, sh: true },
        { id: `gem${i}`, k: 'oct', p: [px, 0.85, pz], s: [0.66, 0.8, 0.66], r: [0, s.t * 1.4 + i, 0], c: PAD_C[i], e: 0.9, sh: true },
      ];
    }),
    ...s.blocks.flatMap(b => foeObjs(b, s.t)),
    ...(target ? [{ id: 'objetivo', k: 'ring', p: [target.x, 0.06, target.z], s: [2.4, 2.4, 1], c: '#ffffff', e: 1, o: 0.75 }] : []),
    ...s.shots.map(sh => beamObj(`shot${sh.id}`, sh.a, sh.b, sh.c, Math.max(0.2, sh.t / 0.18))),
  ];
  const lights = [
    { p: [0, 2.6, BASE_Z - 1.5], c: '#22e6ff', i: 6, d: 12 },
    { p: target ? [target.x, 3.2, target.z] : [0, 4, -12], c: tc, i: 9, d: 14 },
  ];
  const scene = { sky: SKY, fog: { c: SKY.bottom, near: 24, far: 78 }, light: { dir: [-0.35, 0.9, 0.5] }, shadowR: 24, statics: STATIC, objs, lights, cam: CAM };

  const labels = [
    ...s.blocks.map(b => ({ key: `L${b.id}`, p: [b.x, 3.0, b.z], text: (b.kind === 'bomb' ? '💣 ' : b.kind === 'freeze' ? '❄ ' : '') + b.text, color: KIND_C[b.kind], u: 1.0, min: 19, max: 34, w: 200 })),
    ...(target ? target.opts.map((o, i) => { const [px, pz] = padPos(i); return { key: `P${i}`, p: [px, 1.85, pz], text: String(o), color: C.text, u: 1.15, min: 22, max: 40, w: 100 }; }) : []),
  ];

  return (
    <Game3D title="MATH RUSH" emoji="🧮" accent={C.pink} onExit={onExit} score={s.score} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene}
      hud={<><Lives n={s.lives} max={3} /><HudPill label="NIVEL" value={s.level} color={C.pink} /><HudPill label="OK" value={s.solved} color={C.cyan} />{s.combo > 1 ? <HudPill icon="🔥" value={`x${s.combo}`} color={C.amber} /> : null}</>}
      subtitle="Resuelve antes de que lleguen a la base"
      lines={['Toca el cañón con la respuesta de la operación marcada', '💣 destruye todo · ❄ congela el tiempo', 'Cada 8 aciertos sube la dificultad']}
      result={{ isNew: res.isNew, title: 'SIN VIDAS', emoji: '🧮', subtitle: `${s.solved} operaciones · mejor racha ${s.maxCombo}`, stats: [['NIVEL', s.level], ['RESUELTAS', s.solved], ['RACHA', s.maxCombo]] }}>
      <Labels3D cam={CAM} items={labels} />
      {target && <View pointerEvents="none" style={{ position: 'absolute', top: 4, left: 0, right: 0, alignItems: 'center' }}><Text style={{ color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: 1, ...tglow(C.pink, 10) }}>RESUELVE: {target.text} = ?</Text></View>}
      {s.banner && <View pointerEvents="none" style={{ position: 'absolute', top: '30%', left: 0, right: 0, alignItems: 'center' }}><Text style={{ color: C.text, fontSize: 20, fontWeight: '900', letterSpacing: 2, ...tglow(C.pink, 12) }}>{s.banner.text}</Text></View>}
    </Game3D>
  );
}
