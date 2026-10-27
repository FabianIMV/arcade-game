import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, alpha, hx, rand, useBest, useFX, useLoop, usePan, useTimeouts } from '../utils/kit';
import { World3D } from '../utils/World3D';

// 4 EN LÍNEA 3D: tablero de 4 × 4 × 4. Sueltas una ficha en una de las 16 columnas (tocando la columna)
// y cae en profundidad hasta el hueco libre más bajo. Gana quien alinee 4 en cualquier dirección del cubo.
const N = 4;                          // lado del cubo
const CAM = { p: [0, 5.6, 10.6], l: [0, 1.7, 0], fov: 44 };
const CAM_ASP = AREA_W / AREA_H;
const G = 40;                         // gravedad de la ficha al caer (u/s²)
const IDX = (x, y, z) => y * N * N + x * N + z;
const colXZ = k => [Math.floor(k / N) - (N - 1) / 2, k % N - (N - 1) / 2];  // columna k (0..15) → x, z en el mundo
const ORDER = [5, 6, 9, 10, 0, 3, 12, 15, 1, 2, 4, 7, 8, 11, 13, 14];       // columnas centrales primero (poda alfa-beta)

// Las 76 líneas ganadoras de 4 en un cubo 4×4×4 (cada una son 4 índices)
const LINES = (() => {
  const dirs = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dy && !dz) continue;
    if ((dx || dy || dz) < 0) continue;   // una sola dirección de cada par (d, -d)
    dirs.push([dx, dy, dz]);
  }
  const out = [];
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) for (let z = 0; z < N; z++) for (const [dx, dy, dz] of dirs) {
    const cs = [];
    for (let k = 0; k < N; k++) {
      const xx = x + dx * k, yy = y + dy * k, zz = z + dz * k;
      if (xx < 0 || xx >= N || yy < 0 || yy >= N || zz < 0 || zz >= N) break;
      cs.push(IDX(xx, yy, zz));
    }
    if (cs.length === N) out.push(cs);
  }
  return out;
})();

// Proyecta un punto 3D a píxeles del PlayArea con la misma cámara del motor (para elegir columna con el dedo).
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
  return [(xc / (zc * t * CAM_ASP) + 1) / 2 * AREA_W, (1 - yc / (zc * t)) / 2 * AREA_H];
};
const colPt = k => { const [x, z] = colXZ(k); return sproj(CAM, x, 2.0, z); };

const lowIdx = (b, k) => { for (let y = 0; y < N; y++) if (!b[y * N * N + k]) return y * N * N + k; return -1; };
const winLine = (b, p) => { for (const L of LINES) if (L.every(i => b[i] === p)) return L; return null; };
const evalB = b => {
  let sc = 0;
  for (const L of LINES) {
    let a = 0, h = 0;
    for (const i of L) { if (b[i] === 2) a++; else if (b[i] === 1) h++; }
    if (a && !h) sc += a === 3 ? 5 : a === 2 ? 2 : 0;
    if (h && !a) sc -= h === 3 ? 6 : h === 2 ? 2 : 0;
  }
  return sc;
};
const minimax = (b, depth, al, be, maxing) => {
  if (winLine(b, 2)) return 100000 + depth;
  if (winLine(b, 1)) return -100000 - depth;
  if (depth === 0 || b.every(Boolean)) return evalB(b);
  if (maxing) {
    let v = -Infinity;
    for (const k of ORDER) { const i = lowIdx(b, k); if (i < 0) continue; b[i] = 2; v = Math.max(v, minimax(b, depth - 1, al, be, false)); b[i] = 0; al = Math.max(al, v); if (al >= be) break; }
    return v;
  }
  let v = Infinity;
  for (const k of ORDER) { const i = lowIdx(b, k); if (i < 0) continue; b[i] = 1; v = Math.min(v, minimax(b, depth - 1, al, be, true)); b[i] = 0; be = Math.min(be, v); if (al >= be) break; }
  return v;
};

export function Connect4_3D({ onExit }) {
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('connect4');
  const [phase, setPhase] = useState('ready');          // ready | play | win | over
  const [res, setRes] = useState({ isNew: false, draw: false });
  const initState = (lvl, score) => ({ b: Array(N * N * N).fill(0), turn: 1, level: lvl, score, anim: null, line: null, busy: false, t: 0, msg: 'Tu turno' });
  const g = useRef(null);
  if (!g.current) g.current = initState(1, 0);
  const start = () => { fx.clear(); g.current = initState(1, 0); setPhase('play'); };
  const nextRound = () => { const s = g.current; g.current = initState(s.level + 1, s.score); setPhase('play'); };

  const aiMove = s => {
    const depth = Math.min(4, 1 + s.level);
    let bestK = -1, bestV = -Infinity;
    const order = [...ORDER].sort(() => Math.random() - 0.5);
    for (const k of order) {
      const i = lowIdx(s.b, k); if (i < 0) continue;
      s.b[i] = 2;
      const v = minimax(s.b, depth - 1, -Infinity, Infinity, false) + (Math.random() < 0.15 && s.level < 3 ? rand(-30, 30) : 0);
      s.b[i] = 0;
      if (v > bestV) { bestV = v; bestK = k; }
    }
    return bestK;
  };
  const place = (k, who) => {
    const s = g.current; const i = lowIdx(s.b, k);
    if (i < 0) return false;
    const lvl = Math.floor(i / (N * N));
    s.anim = { k, lvl, who, y: N + 1.2, vy: 0, ty: 0.5 + lvl }; s.busy = true;
    return true;
  };
  const land = () => {
    const s = g.current; const { k, lvl, who } = s.anim; s.b[lvl * N * N + k] = who; s.anim = null; hx.tap();
    const [xw, zw] = colXZ(k);
    const [px, py] = sproj(CAM, xw, 0.5 + lvl, zw);
    fx.burst(px, py, who === 1 ? C.red : C.amber, 5, 110, 0.3, 3);
    const line = winLine(s.b, who);
    if (line) {
      s.line = line; s.busy = true;
      if (who === 1) {
        const empties = s.b.filter(v => !v).length; const pts = 100 * s.level + empties * 10; s.score += pts;
        hx.win(); fx.flash('#fff', 0.25); fx.pop(AREA_W / 2, 36, `+${pts}`, C.lime, 24);
        submitBest(s.score); later(() => setPhase('win'), 1000);
      } else { hx.die(); later(() => { setRes({ isNew: submitBest(s.score), draw: false }); setPhase('over'); }, 1100); }
      return;
    }
    if (s.b.every(Boolean)) { s.score += 30; later(() => { setRes({ isNew: submitBest(s.score), draw: true }); setPhase('over'); }, 600); return; }
    if (who === 1) { s.turn = 2; s.msg = 'Pensando…'; later(() => { const k2 = aiMove(s); place(k2, 2); }, 350); } else { s.turn = 1; s.msg = 'Tu turno'; s.busy = false; }
  };
  const pickCol = (x, y) => {
    let best_ = -1, bd = Infinity;
    for (let k = 0; k < N * N; k++) { const [px, py] = colPt(k); const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best_ = k; } }
    return bd < 90 ? best_ : -1;
  };
  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current;
      if (phase !== 'play' || s.busy || s.turn !== 1) return;
      const k = pickCol(x, y);
      if (k < 0) return;
      if (!place(k, 1)) hx.bad();
    },
  });
  useLoop(phase !== 'ready', dt => {
    const s = g.current; s.t += dt;
    if (s.anim) {
      const a = s.anim; a.vy -= G * dt; a.y += a.vy * dt;
      if (a.y <= a.ty) { a.y = a.ty; land(); }
    }
  });

  const s = g.current;
  const objs = [
    { id: 'base', k: 'box', p: [0, -0.12, 0], s: [N + 0.8, 0.24, N + 0.8], c: '#3a2a78' },
    ...Array.from({ length: N * N }, (_, k) => { const [x, z] = colXZ(k); return { id: `pg${k}`, k: 'cyl', p: [x, N / 2, z], s: [0.1, N, 0.1], c: C.blue, e: 0.35, o: 0.75 }; }),
  ];
  for (let i = 0; i < s.b.length; i++) {
    const y = Math.floor(i / (N * N)), k = i % (N * N); const [x, z] = colXZ(k); const v = s.b[i];
    if (!v) { objs.push({ id: `h${i}`, k: 'sph', p: [x, 0.5 + y, z], n: 0.2, c: '#2b3a7a', o: 0.7 }); continue; }
    const win = s.line && s.line.includes(i);
    objs.push({ id: `p${i}`, k: 'sph', p: [x, 0.5 + y, z], n: 0.8, c: win ? '#ffffff' : v === 1 ? C.red : C.amber, e: win ? 1 : 0.35 });
  }
  if (s.anim) { const [x, z] = colXZ(s.anim.k); objs.push({ id: 'anim', k: 'sph', p: [x, s.anim.y, z], n: 0.8, c: s.anim.who === 1 ? C.red : C.amber, e: 0.4 }); }
  const scene = { bg: '#0a0510', fog: { c: '#0a0510', near: 18, far: 36 }, objs, cam: CAM };

  return (
    <GameScreen title="4 EN LÍNEA" emoji="🔴" accent={C.red} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Ronda <Text style={{ color: C.red, fontWeight: '900' }}>{s.level}</Text></Text><Text style={{ color: s.turn === 1 ? C.red : C.amber, fontWeight: '900', fontSize: 13 }}>{phase === 'play' ? s.msg : ''}</Text><Text style={{ color: C.dim, fontSize: 12 }}>IA nivel {Math.min(4, 1 + s.level)}</Text></>}>
      <PlayArea fx={fx} bg="#0a0510" border={alpha(C.red, 0.35)} {...pan}>
        <World3D scene={scene} />
        {phase === 'play' && !s.busy && <Text pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 8, textAlign: 'center', color: alpha(C.dim, 0.8), fontSize: 12, fontWeight: '700' }}>Toca una columna para soltar tu ficha</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'win' ? '🏆' : phase === 'over' ? (res.draw ? '🤝' : '💀') : '🔴'} title={phase === 'win' ? `¡RONDA ${s.level} GANADA!` : phase === 'over' ? (res.draw ? 'EMPATE' : 'PERDISTE') : '4 EN LÍNEA 3D'}
          subtitle={phase === 'win' ? `La IA sube a nivel ${Math.min(4, 2 + s.level)}` : phase === 'over' ? `Llegaste a la ronda ${s.level}` : 'Conecta cuatro fichas en el cubo contra la IA'}
          score={s.score} best={best} isNew={res.isNew} accent={C.red} startLabel={phase === 'win' ? 'SIGUIENTE RONDA' : undefined} onStart={phase === 'win' ? nextRound : start} onExit={onExit}
          lines={phase === 'ready' ? ['Alinea 4 fichas en cualquier dirección del cubo 4×4×4', 'Toca una columna: la ficha cae en profundidad', 'Cada victoria sube el nivel de la IA', 'Ganar con el tablero más vacío da más puntos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
