import React, { useRef, useState } from 'react';
import { C, SCREEN_H, SCREEN_W, hx, pick, rand, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { Game3D, HudPill } from '../utils/ui3d';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { bush, flower, hash01, house, shade, tree } from '../utils/prefabs';
import { project, rayGround, seeded } from '../utils/openworld';

// WHACK-A-MOLE 3D: jardín con 9 agujeros. Topos que asoman, oro, casco, reloj y bomba.
// Un martillo 3D cae sobre el agujero tocado. Reglas: 45 s · topo 1 · oro 5 · casco 3 (2 golpes)
// · reloj +3 s · bomba −4 s · fallar rompe la racha (la racha sube el multiplicador).
const DUR = 45, HIT_R = 1.3, HM_T = 0.22;
const HOLE_X = [-2.4, 0, 2.4], HOLE_Z = [-6.2, -3.4, -0.6];
const HOLES = HOLE_Z.flatMap(z => HOLE_X.map(x => [x, z]));
const CAM = { p: [0, 7.4, 9.8], l: [0, 0, -2.8], fov: 56 };
const HAMMER_REST = [1.6, 1.9, 3.0];   // reposo: delante, a la derecha, dentro del encuadre del móvil
const TYPE_C = { mole: '#b8794a', gold: '#ffc233', helmet: '#9aa5c8', bomb: '#2a2540', clock: '#f4f8ff' };
const DIRT = ['#8a5a2b', '#6b4321', '#c9a46a'];
const SKY = { top: '#3d9bff', bottom: '#cdf1ff', sun: true, clouds: 7 };
const SHOW_TYPES = ['mole', 'gold', 'mole', 'helmet', 'mole', 'bomb', 'clock', 'mole', 'gold'];
const FLOWERS = ['#ff6fa8', '#ffd54a', '#ffffff', '#b57bff', '#ff8a3d'];

// Césped a cuadros con variación por triángulo
const TERRAIN = {
  id: 'jardin-v1', h: () => 0, size: 36, step: 1,
  color: (y, x, z) => shade((Math.floor(x) + Math.floor(z)) & 1 ? '#5cbf4e' : '#66c957', 0.93 + hash01(x.toFixed(1) + ',' + z.toFixed(1)) * 0.12),
};

// Decorado estático: se calcula UNA vez (valla, flores, setos, árboles, casa, agujeros)
const STATICS = (() => {
  const r = seeded(7), st = [];
  for (let i = 0; i < 17; i++) {
    const z = -7.6 + i * 0.6;
    st.push({ id: `vb${i}`, k: 'box', p: [-4.8 + i * 0.6, 0.45, -7.6], s: [0.16, 0.9, 0.08], c: '#f7f1e3', inst: 'valla' });
    st.push({ id: `vi${i}`, k: 'box', p: [-4.8, 0.45, z], s: [0.08, 0.9, 0.16], c: '#f7f1e3', inst: 'valla' });
    st.push({ id: `vd${i}`, k: 'box', p: [4.8, 0.45, z], s: [0.08, 0.9, 0.16], c: '#f7f1e3', inst: 'valla' });
  }
  for (const y of [0.3, 0.62]) {
    st.push({ id: `rb${y}`, k: 'box', p: [0, y, -7.6], s: [9.7, 0.07, 0.06], c: '#f7f1e3' });
    st.push({ id: `rl${y}`, k: 'box', p: [-4.8, y, -2.8], s: [0.06, 0.07, 9.6], c: '#f7f1e3' });
    st.push({ id: `rr${y}`, k: 'box', p: [4.8, y, -2.8], s: [0.06, 0.07, 9.6], c: '#f7f1e3' });
  }
  HOLES.forEach(([x, z], i) => {
    st.push({ id: `hl${i}`, k: 'cyl', p: [x, 0.02, z], s: [1.25, 0.06, 1.25], c: '#120a1e' });
    st.push({ id: `hr${i}`, k: 'tor', p: [x, 0.05, z], n: 1.3, r: [Math.PI / 2, 0, 0], c: '#7a5230' });
  });
  // flores repartidas entre los agujeros (sin pisar un agujero)
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 46; tries++) {
    const x = (r() - 0.5) * 9, z = -7.2 + r() * 9;
    if (HOLES.some(([hx_, hz]) => Math.hypot(hx_ - x, hz - z) < 1.1)) continue;
    st.push(...flower(`fl${placed}`, [x, 0, z], { inst: 'flor', c: FLOWERS[placed % FLOWERS.length] }));
    placed += 1;
  }
  [[-5.4, -8.1], [5.4, -8.1], [-5.6, -1.2], [5.6, -1.2], [-5.7, 2.3], [5.7, 2.3]].forEach(([x, z], i) => st.push(...bush(`bu${i}`, [x, 0, z], { inst: 'arbusto', c: i % 2 ? '#3f9b45' : '#2f8a4a' })));
  for (let i = 0; i < 10; i++) {
    const kind = i % 3 === 0 ? 'pine' : 'oak';
    st.push(...tree(`ar${i}`, [-16 + i * 3.6 + (r() - 0.5), 0, -15 - r() * 2.5], { kind, h: 2.2 + r() * 0.8, inst: 'arbol' + kind }));
  }
  st.push(...house('casa', [8.4, 0, -7.4], { kind: 'cottage', c: '#f6d58e', yaw: -0.5 }));
  return st;
})();

const initState = () => ({
  holes: Array.from({ length: 9 }, () => null), time: DUR, t: 0, score: 0, combo: 0, maxCombo: 0, hits: 0,
  spawn: 0.5, over: false, hm: null, hp: [...HAMMER_REST], cx: 0,
});

// Proyecta un punto 3D a píxeles de la pantalla (para textos 2D sobre el golpe)
const at = p => project(CAM, p, SCREEN_W, SCREEN_H) || { x: SCREEN_W / 2, y: SCREEN_H / 2 };
// Toque en píxeles → punto del suelo (x, z), con el mismo rayo de la cámara
const groundXZ = (x, y) => { const p = rayGround(CAM, x, y, SCREEN_W, SCREEN_H, 0); return p ? [p[0], p[2]] : null; };

// Un topo (o casco, oro, bomba, reloj) en su agujero. k 0..1 = cuánto ha salido; hit > 0 = golpeado
function holeObjs(i, x, z, v) {
  const { type, k, hit, t } = v;
  const id = `h${i}`, cy = -0.5 + 0.86 * k, body = hit > 0 && type !== 'bomb' ? '#ffffff' : TYPE_C[type];
  const out = [];
  if (type === 'clock') {
    out.push({ id: `${id}c`, k: 'cyl', p: [x, cy, z], s: [0.95, 0.12, 0.95], r: [Math.PI / 2, 0, 0], c: '#f4f8ff', e: 0.25, sh: true });
    out.push({ id: `${id}r`, k: 'tor', p: [x, cy, z + 0.06], n: 1.0, c: '#7dff6b', e: 0.8 });
    out.push({ id: `${id}m`, k: 'box', p: [x, cy + 0.1, z + 0.08], s: [0.06, 0.42, 0.04], r: [0, 0, t * 2], c: '#3b3b4a' });
    return out;
  }
  const sq = hit > 0 ? 0.7 : 1;
  out.push({ id: `${id}b`, k: 'sph', p: [x, cy, z], s: [0.95, 0.8 * sq, 0.95], c: body, e: type === 'gold' ? 0.3 : hit > 0 ? 0.6 : 0.05, sh: true });
  const dark = shade(body, 0.8), paw = shade(body, 0.85);
  out.push({ id: `${id}e1`, k: 'sph', p: [x - 0.2, cy + 0.16, z + 0.42], n: 0.13, c: '#14101a', e: 0.1 });
  out.push({ id: `${id}e2`, k: 'sph', p: [x + 0.2, cy + 0.16, z + 0.42], n: 0.13, c: '#14101a', e: 0.1 });
  out.push({ id: `${id}n`, k: 'sph', p: [x, cy - 0.04, z + 0.46], n: 0.13, c: '#ff8fb1', e: 0.2 });
  out.push({ id: `${id}o1`, k: 'sph', p: [x - 0.34, cy + 0.42, z - 0.02], n: 0.22, c: dark });
  out.push({ id: `${id}o2`, k: 'sph', p: [x + 0.34, cy + 0.42, z - 0.02], n: 0.22, c: dark });
  out.push({ id: `${id}p1`, k: 'sph', p: [x - 0.3, cy - 0.36, z + 0.36], n: 0.2, c: paw });
  out.push({ id: `${id}p2`, k: 'sph', p: [x + 0.3, cy - 0.36, z + 0.36], n: 0.2, c: paw });
  if (type === 'gold') out.push({ id: `${id}s`, k: 'ico', p: [x + 0.32, cy + 0.66 + Math.sin(t * 4) * 0.05, z], n: 0.16, c: '#fff3b0', e: 1 });
  if (type === 'helmet') out.push({ id: `${id}k`, k: 'sph', p: [x, cy + 0.36, z], s: [1.02, 0.5, 1.02], c: '#9aa5c8', m: { r: 0.3, m: 0.5 }, sh: true });
  if (type === 'bomb') {
    out.push({ id: `${id}f`, k: 'box', p: [x, cy + 0.55, z], s: [0.07, 0.32, 0.07], c: '#c9a46a' });
    out.push({ id: `${id}sp`, k: 'sph', p: [x, cy + 0.8 + Math.sin(t * 20) * 0.03, z], n: 0.17, c: '#ff8a3d', e: 1 });
  }
  return out;
}

// Modo menú: topos que van y vienen por el jardín, para el fondo de inicio y fin
const showcaseHoles = t => SHOW_TYPES.map((type, i) => {
  const k = Math.max(0, Math.min(1, (Math.sin(t * 1.1 + i * 2.3) - 0.1) * 2.2));
  return k > 0.01 ? { type, k, hit: 0, t } : null;
});

function buildScene(holes, hp, camX) {
  const objs = [];
  holes.forEach((v, i) => { if (v) objs.push(...holeObjs(i, HOLES[i][0], HOLES[i][1], v)); });
  objs.push({ id: 'mz', k: 'box', p: [hp[0], hp[1], hp[2]], s: [1.0, 0.5, 0.55], c: '#c7cbd6', e: 0.2, sh: true });
  objs.push({ id: 'mh', k: 'box', p: [hp[0], hp[1] + 1.05, hp[2]], s: [0.16, 1.6, 0.16], c: '#c9a46a', sh: true });
  return {
    sky: SKY, fog: { c: SKY.bottom, near: 20, far: 50 }, light: { dir: [-0.5, 0.8, 0.4] }, shadowR: 16,
    terrain: TERRAIN, statics: STATICS, objs, cam: { p: CAM.p, l: [camX, 0, CAM.l[2]], fov: CAM.fov },
  };
}

export function WhackAMole3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('whack');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = s => {
    if (s.over) return;
    s.over = true; s.time = 0; hx.win();
    setRes({ isNew: submitBest(s.score) }); setPhase('over');
  };
  const spawn = s => {
    const free = []; s.holes.forEach((h, i) => { if (!h) free.push(i); });
    if (!free.length) return;
    const i = pick(free), r = Math.random();
    const type = r < 0.6 ? 'mole' : r < 0.72 ? 'gold' : r < 0.82 ? 'helmet' : r < 0.92 ? 'bomb' : 'clock';
    const life = Math.max(0.6, 1.5 - s.t * 0.018) * (type === 'gold' ? 0.7 : 1);
    s.holes[i] = { type, age: 0, life, hp: type === 'helmet' ? 2 : 1, hit: 0 };
  };

  const whack = (x, y) => {
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    const gp = groundXZ(x, y);
    let target = -1, bd = 1e9;
    if (gp) HOLES.forEach(([hx_, hz], i) => {
      const h = s.holes[i]; if (!h || h.hit > 0) return;
      const d = Math.hypot(hx_ - gp[0], hz - gp[1]);
      if (d < HIT_R && d < bd) { bd = d; target = i; }
    });
    // el martillo cae sobre el agujero si lo hay, o sobre el punto tocado
    const tx = target >= 0 ? HOLES[target][0] : gp ? gp[0] : HAMMER_REST[0];
    const tz = target >= 0 ? HOLES[target][1] : gp ? gp[1] : HAMMER_REST[2];
    s.hm = { t: HM_T, x: tx, z: tz };
    if (target < 0) { s.combo = 0; hx.tick(); return; }
    const h = s.holes[target], hxp = HOLES[target][0], hzp = HOLES[target][1];
    const pt = at([hxp, 0.7, hzp]);
    h.hp -= 1;
    if (h.type === 'bomb') {
      h.hit = 0.3; s.combo = 0; s.time = Math.max(0, s.time - 4);
      burst3d([hxp, 0.4, hzp], ['#ff4d4d', '#ffb020', '#ffe066'], 60, { speed: 7, up: 3, size: 0.25, life: 1.0 });
      ring3d([hxp, 0.1, hzp], '#ff8a3d', 26, { speed: 6, life: 0.7 });
      fx.shake(12, 0.4); fx.flash(C.red, 0.3); fx.pop(pt.x, pt.y - 30, '-4s', C.red, 24); hx.bad();
    } else if (h.type === 'clock') {
      h.hit = 0.3; s.time += 3;
      burst3d([hxp, 0.6, hzp], ['#7dff6b', '#e8ffd6'], 30, { speed: 5, up: 3, life: 0.8 });
      ring3d([hxp, 0.1, hzp], '#7dff6b', 18, { speed: 5, life: 0.6 });
      fx.pop(pt.x, pt.y - 30, '+3s', C.lime, 24); hx.good();
    } else if (h.hp > 0) {
      burst3d([hxp, 0.5, hzp], ['#ffffff', '#c8d2ff'], 14, { speed: 4, life: 0.5, size: 0.14 });
      fx.shake(3, 0.15); hx.hit();
    } else {
      h.hit = 0.3; s.hits += 1; s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
      const base = h.type === 'gold' ? 5 : h.type === 'helmet' ? 3 : 1;
      const mult = 1 + Math.floor(s.combo / 5), pts = base * mult;
      s.score += pts;
      const gold = h.type === 'gold';
      burst3d([hxp, 0.6, hzp], gold ? ['#ffd54a', '#fff3b0', '#ffb300'] : DIRT, gold ? 36 : 24, { speed: 6, up: 4, g: 12, size: 0.2, life: 0.9 });
      ring3d([hxp, 0.05, hzp], gold ? '#ffd54a' : '#ffffff', 20, { speed: 5, life: 0.5 });
      fx.pop(pt.x, pt.y - 40, `+${pts}`, mult > 1 ? C.amber : C.text, 20);
      hx.heavy();
    }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.over) return;
    s.t += dt; s.time -= dt;
    if (s.hm) { s.hm.t -= dt; if (s.hm.t <= 0) s.hm = null; }
    s.spawn -= dt;
    if (s.spawn <= 0) { spawn(s); if (s.t > 18 && Math.random() < 0.4) spawn(s); s.spawn = Math.max(0.3, 0.85 - s.t * 0.014) * rand(0.7, 1.2); }
    s.holes.forEach((h, i) => {
      if (!h) return;
      h.age += dt;
      if (h.hit > 0) { h.hit -= dt; if (h.hit <= 0) s.holes[i] = null; return; }
      if (h.age >= h.life) { if (h.type === 'mole' || h.type === 'gold' || h.type === 'helmet') s.combo = 0; s.holes[i] = null; }
    });
    // martillo: baja rápido sobre el objetivo y vuelve a su sitio de reposo
    const down = !!(s.hm && s.hm.t > 0.1);
    const tgt = down ? [s.hm.x, 0.95, s.hm.z] : HAMMER_REST;
    const k = Math.min(1, dt * (down ? 30 : 6));
    for (let a = 0; a < 3; a++) s.hp[a] += (tgt[a] - s.hp[a]) * k;
    s.cx += (s.hp[0] * 0.22 - s.cx) * Math.min(1, dt * 3);
    if (s.time <= 0) finish(s);
  });

  const pan = usePan(fx, { down: (x, y) => whack(x, y) });
  const s = g.current;
  const mult = 1 + Math.floor(s.combo / 5);
  const playing = phase === 'play';
  const holes = s.holes.map(h => (h ? { type: h.type, k: Math.min(1, h.age * 7) * (h.age > h.life - 0.15 ? Math.max(0, (h.life - h.age) / 0.15) : 1), hit: h.hit, t: s.t } : null));
  const scene = buildScene(holes, s.hp, s.cx);
  const menuScene = t => buildScene(showcaseHoles(t), HAMMER_REST, 0);

  return (
    <Game3D title="WHACK-A-MOLE" emoji="🐹" accent={C.violet} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={menuScene} orbit={{ r: 15, h: 6.4, speed: 0.16, ly: 0.8 }}
      pan={pan}
      hud={<>
        <HudPill icon="⏱" value={`${Math.ceil(Math.max(0, s.time))}s`} color={s.time < 8 ? C.red : C.cyan} />
        <HudPill icon="🔥" label="RACHA" value={s.combo} color={C.violet} />
        <HudPill icon="✖" value={mult} color={mult > 1 ? C.amber : C.dim} />
      </>}
      subtitle="Golpea los topos antes de que se escondan"
      lines={['Toca el agujero donde asoma un topo', '🟡 oro vale 5 · ⚪ casco: 2 golpes (vale 3)', '⏱ reloj +3 s · 💣 bomba −4 s', 'Fallar rompe la racha · 45 segundos']}
      result={{ isNew: res.isNew, title: '¡TIEMPO!', emoji: '🐹', subtitle: `${s.hits} topos golpeados`, stats: [['GOLPES', s.hits], ['RACHA MÁX.', s.maxCombo]] }} />
  );
}
