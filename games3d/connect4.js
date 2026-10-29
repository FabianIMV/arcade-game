import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { C, SCREEN_H, SCREEN_W, hx, rand, useBest, useFX, useLoop, usePan, useTimeouts } from '../utils/kit';
import { Game3D, HudPill } from '../utils/ui3d';
import { burst3d, clear3d } from '../utils/engine3d';
import { project } from '../utils/openworld';

// 4 EN LÍNEA 3D: el clásico tablero de 7 columnas × 6 filas, con fichas que caen en un tablero de bloque.
// Arrastra sobre una columna (verás la ficha fantasma) y suelta para dejarla caer. Gana quien alinee 4 (horizontal,
// vertical o diagonal). Cada victoria sube la ronda: la IA piensa más y tiene más margen de error en las primeras.
const NC = 7, NR = 6;
const FALL_G = 60;                    // gravedad de la ficha al caer
const DZ = 0.14;                      // las fichas van delante del tablero
const colX = c => c - (NC - 1) / 2;   // columna → x del mundo
const idx = (r, c) => r * NC + c;     // r = 0 abajo
const fitFov = (hw, hh, d) => 2 * Math.atan(Math.max(hw / d / (SCREEN_W / SCREEN_H), hh / d)) * 180 / Math.PI;
const CAM_D = 17.5;
const CAM = { p: [0, 9.4, CAM_D], l: [0, 3.2, 0], fov: fitFov(4.7, 6.2, CAM_D) };
const COL_PX = Array.from({ length: NC }, (_, c) => project(CAM, [colX(c), 6.2, 0], SCREEN_W, SCREEN_H).x);
const CHIP_M = { r: 0.22, m: 0.5 };

// Las 69 combinaciones ganadoras de 4 en un tablero 7×6
const WINS = (() => {
  const w = [];
  for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
    if (c + 3 < NC) w.push([0, 1, 2, 3].map(k => idx(r, c + k)));
    if (r + 3 < NR) w.push([0, 1, 2, 3].map(k => idx(r + k, c)));
    if (r + 3 < NR && c + 3 < NC) w.push([0, 1, 2, 3].map(k => idx(r + k, c + k)));
    if (r - 3 >= 0 && c + 3 < NC) w.push([0, 1, 2, 3].map(k => idx(r - k, c + k)));
  }
  return w;
})();
const ORDER = [3, 2, 4, 1, 5, 0, 6];   // columnas centrales primero (mejor poda alfa-beta)
const lowRow = (b, c) => { for (let r = 0; r < NR; r++) if (!b[idx(r, c)]) return r; return -1; };
const PW = [0, 1, 4, 20];              // peso de 0, 1, 2 y 3 fichas en una combinación abierta
// evaluación: + para la IA (2), − para el jugador (1); ±1e6 si hay 4 en línea
const scoreB = b => {
  let t = 0;
  for (const w of WINS) {
    let a = 0, h = 0;
    for (const i of w) { if (b[i] === 2) a++; else if (b[i] === 1) h++; }
    if (a === 4) return 1e6;
    if (h === 4) return -1e6;
    if (h === 0) t += PW[a];
    if (a === 0) t -= PW[h];
  }
  for (let r = 0; r < NR; r++) { if (b[idx(r, 3)] === 2) t += 3; else if (b[idx(r, 3)] === 1) t -= 3; }
  return t;
};
const mm = (b, depth, al, be, maxing) => {
  const sc = scoreB(b);
  if (depth === 0 || sc >= 1e6 || sc <= -1e6) return sc;
  let v = maxing ? -Infinity : Infinity, moved = false;
  for (const c of ORDER) {
    const r = lowRow(b, c); if (r < 0) continue;
    moved = true;
    const i = idx(r, c);
    b[i] = maxing ? 2 : 1;
    const x = mm(b, depth - 1, al, be, !maxing);
    b[i] = 0;
    if (maxing) { v = Math.max(v, x); al = Math.max(al, v); } else { v = Math.min(v, x); be = Math.min(be, v); }
    if (al >= be) break;
  }
  return moved ? v : sc;
};
const aiMove = s => {
  const depth = Math.min(5, 1 + s.level);
  let bestC = -1, bestV = -Infinity;
  for (const c of ORDER) {
    const r = lowRow(s.b, c); if (r < 0) continue;
    const i = idx(r, c);
    s.b[i] = 2;
    let v = mm(s.b, depth - 1, -Infinity, Infinity, false);
    s.b[i] = 0;
    if (s.level < 3 && Math.random() < 0.25) v += rand(-8, 8);   // primeras rondas: a veces se equivoca
    if (v > bestV) { bestV = v; bestC = c; }
  }
  return bestC;
};

// Escena estática: tablero (base, placa azul, rieles de neón y 42 huecos). Una sola vez.
const BOARD = (() => {
  const out = [];
  out.push({ id: 'base', k: 'box', p: [0, -0.45, 0.25], s: [NC + 2.2, 0.9, 3.6], c: '#150d36', m: { r: 0.5, m: 0.2 }, recv: true });
  out.push({ id: 'placa', k: 'box', p: [0, NR / 2, -0.25], s: [NC + 0.5, NR + 0.5, 0.5], c: '#2446e0', e: 0.1, m: { r: 0.3, m: 0.4 }, recv: true });
  out.push({ id: 'riel-i', k: 'box', p: [-(NC + 0.5) / 2 - 0.12, NR / 2, 0.1], s: [0.18, NR + 0.8, 0.5], c: C.pink, e: 0.9, m: { r: 0.2, m: 0.5 } });
  out.push({ id: 'riel-d', k: 'box', p: [(NC + 0.5) / 2 + 0.12, NR / 2, 0.1], s: [0.18, NR + 0.8, 0.5], c: C.pink, e: 0.9, m: { r: 0.2, m: 0.5 } });
  out.push({ id: 'riel-s', k: 'box', p: [0, -0.1, 0.1], s: [NC + 0.9, 0.18, 0.5], c: C.pink, e: 0.9, m: { r: 0.2, m: 0.5 } });
  for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
    out.push({ k: 'cyl', inst: 'hueco', p: [colX(c), r + 0.5, 0.03], s: [0.84, 0.08, 0.84], r: [Math.PI / 2, 0, 0], c: '#050818', m: { r: 0.6, m: 0 } });
  }
  return out;
})();
const DEMO_ROWS = ['.......', '...A...', '..RRA..', '.ARRAA.', 'RRAARRA', 'ARRAARR'];   // de arriba abajo
const DEMO = [];
DEMO_ROWS.forEach((row, rr) => [...row].forEach((ch, c) => {
  if (ch === '.') return;
  DEMO.push({ k: 'cyl', inst: 'ficha', p: [colX(c), NR - rr - 0.5, DZ], s: [0.8, 0.14, 0.8], r: [Math.PI / 2, 0, 0], c: ch === 'R' ? C.red : C.amber, e: 0.22, m: CHIP_M });
}));
const COMMON = {
  sky: { top: '#080a22', bottom: '#1a1046', sun: false, clouds: 0 },
  fog: { c: '#1a1046', near: 30, far: 58 },
  light: { dir: [-0.45, 0.85, 0.6], i: 2.0, hi: 1.2, sky: '#c4d2ff', ground: '#241a50', sun: '#fff1dc' },
  shadowR: 12,
};
const MENU_SCENE = { ...COMMON, statics: BOARD, objs: DEMO };

export function Connect4_3D({ onExit }) {
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('connect4');
  const [phase, setPhase] = useState('ready');          // ready | play | over
  const [res, setRes] = useState({ isNew: false, won: false, draw: false, level: 1 });
  const initState = (level, score) => ({ b: Array(NC * NR).fill(0), level, score, anim: null, line: null, busy: false, turn: 1, hover: -1, msg: 'Tu turno', t: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState(1, 0);
  const start = () => { fx.clear(); clear3d(); g.current = initState(1, 0); setPhase('play'); };
  const nextRound = () => { const s = g.current; fx.clear(); clear3d(); g.current = initState(s.level + 1, s.score); setPhase('play'); };

  const place = (c, who) => {
    const s = g.current;
    const r = lowRow(s.b, c);
    if (r < 0) return false;
    s.anim = { c, r, who, y: NR + 2.2, vy: 0 };
    s.busy = true; s.hover = -1;
    return true;
  };
  const finishRound = (s, won, draw) => {
    later(() => { setRes({ isNew: submitBest(s.score), won, draw, level: s.level }); setPhase('over'); }, won || !draw ? 1100 : 600);
  };
  const land = () => {
    const s = g.current;
    const { c, r, who } = s.anim;
    s.anim = null;
    s.b[idx(r, c)] = who;
    const x = colX(c), y = r + 0.5;
    burst3d([x, y, 0.3], who === 1 ? C.red : C.amber, 10, { speed: 2.5, g: 8, size: 0.13, life: 0.5 });
    hx.tap();
    const line = WINS.find(w => w.every(i => s.b[i] === who)) || null;
    if (line) {
      s.line = line; s.busy = true;
      if (who === 1) {
        const empties = s.b.filter(v => !v).length;
        const pts = 100 * s.level + empties * 10;
        s.score += pts;
        hx.win(); fx.flash('#ffffff', 0.25); fx.shake(4, 0.2);
        for (const i of line) burst3d([colX(i % NC), Math.floor(i / NC) + 0.5, 0.4], ['#ffffff', C.amber, C.lime], 16, { speed: 5, up: 3, g: 10, size: 0.16, life: 0.9 });
        fx.pop(SCREEN_W / 2, SCREEN_H * 0.3, `+${pts}`, C.lime, 26);
        finishRound(s, true, false);
      } else {
        hx.die(); fx.shake(8, 0.35); fx.flash(C.red, 0.25);
        finishRound(s, false, false);
      }
      return;
    }
    if (s.b.every(Boolean)) { s.score += 30; finishRound(s, false, true); return; }
    if (who === 1) {
      s.turn = 2; s.msg = 'La IA piensa…';
      later(() => { const s2 = g.current; if (s2 !== s || s2.line) return; const c2 = aiMove(s2); if (c2 >= 0) place(c2, 2); }, 380);
    } else { s.turn = 1; s.msg = 'Tu turno'; s.busy = false; }
  };
  const colAt = x => {
    let bi = -1, bd = Infinity;
    for (let c = 0; c < NC; c++) { const d = Math.abs(COL_PX[c] - x); if (d < bd) { bd = d; bi = c; } }
    return bi;
  };
  const pan = usePan(fx, {
    down: x => { const s = g.current; if (!s.busy && s.turn === 1) s.hover = colAt(x); },
    move: x => { const s = g.current; if (!s.busy && s.turn === 1) s.hover = colAt(x); },
    up: x => {
      const s = g.current;
      if (phase !== 'play' || s.busy || s.turn !== 1) return;
      const c = colAt(x);
      if (c >= 0 && lowRow(s.b, c) >= 0) place(c, 1); else hx.bad();
    },
  });
  useLoop(phase !== 'ready', dt => {
    const s = g.current; s.t += dt;
    if (s.anim) {
      const a = s.anim;
      a.vy -= FALL_G * dt; a.y += a.vy * dt;
      const ty = a.r + 0.5;
      if (a.y <= ty) { a.y = ty; land(); }
    }
  });

  const s = g.current;
  const objs = [];
  for (let i = 0; i < s.b.length; i++) {
    const v = s.b[i]; if (!v) continue;
    const win = s.line && s.line.includes(i);
    objs.push({ k: 'cyl', inst: 'ficha', p: [colX(i % NC), Math.floor(i / NC) + 0.5, DZ], s: [0.8, 0.14, 0.8], r: [Math.PI / 2, 0, 0], c: win ? '#ffffff' : v === 1 ? C.red : C.amber, e: win ? 1 : 0.22, m: CHIP_M });
  }
  if (s.anim) objs.push({ id: 'caida', k: 'cyl', p: [colX(s.anim.c), s.anim.y, DZ], s: [0.8, 0.14, 0.8], r: [Math.PI / 2, 0, 0], c: s.anim.who === 1 ? C.red : C.amber, e: 0.25, m: CHIP_M, sh: true });
  if (phase === 'play' && !s.busy && s.hover >= 0) objs.push({ id: 'fantasma', k: 'cyl', p: [colX(s.hover), NR + 0.9, DZ], s: [0.8, 0.14, 0.8], r: [Math.PI / 2, 0, 0], c: C.red, e: 0.5, o: 0.5 });
  const scene = { ...COMMON, statics: BOARD, objs, cam: CAM };

  return (
    <Game3D title="4 EN LÍNEA" emoji="🔴" accent={C.red} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={res.won ? nextRound : start} scene={scene} menuScene={MENU_SCENE} pan={pan}
      orbit={{ r: 22, h: 3, speed: 0.16, ly: 0, drop: 0 }}
      startLabel="JUGAR" retryLabel={res.won ? 'SIGUIENTE RONDA' : 'OTRA VEZ'}
      hud={<><HudPill label="RONDA" value={s.level} color={C.red} /><HudPill label="IA" value={`nivel ${Math.min(5, 1 + s.level)}`} color={C.amber} /></>}
      subtitle="Conecta cuatro fichas contra la IA"
      lines={['Arrastra sobre una columna y suelta para dejar caer tu ficha', 'Alinea 4 en horizontal, vertical o diagonal', 'Cada victoria sube la ronda y la IA se vuelve más lista', 'Un empate suma 30 puntos']}
      result={{ won: res.won, isNew: res.isNew, title: res.won ? '¡RONDA GANADA!' : res.draw ? 'EMPATE' : 'PERDISTE', emoji: res.won ? '🏆' : res.draw ? '🤝' : '💀', subtitle: res.won ? `La IA sube al nivel ${Math.min(5, 2 + s.level)}` : res.draw ? 'Tablero lleno, nadie gana' : `Llegaste a la ronda ${res.level}`, stats: [['RONDA', String(res.level)]] }}>
      <Text pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 44, textAlign: 'center', color: phase === 'play' && s.turn === 2 ? C.amber : C.dim, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>{phase === 'play' ? s.msg : ''}</Text>
    </Game3D>
  );
}
