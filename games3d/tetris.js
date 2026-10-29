import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { C, SCREEN_H, SCREEN_W, hx, shuffle, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { ActionBtn, Game3D, HudPill } from '../utils/ui3d';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { project } from '../utils/openworld';
import { shade } from '../utils/prefabs';

// NEON TETRIS 3D: Tetris clásico 10×20 con bloques de neón brillantes en un vaso visto de frente, con perspectiva.
// Arrastra ↔ para mover · toca para girar · arrastra rápido hacia abajo para soltar · HOLD guarda una pieza.
// Las previsualizaciones (HOLD y SIGUIENTE) son bloques 3D a los lados del vaso.

const COLS = 10, ROWS = 20, BS = 0.9, MINI = 0.55;
const HOLD_X = -6.3, NEXT_X = 6.3, CAM_TY = 10;       // previsualizaciones y altura del punto de mira
const CAM_D = 32;                                     // distancia de la cámara al vaso
// campo de visión: que quepan el ancho de las previsualizaciones (±7.6) y el alto del vaso
const CAM_FOV = 2 * Math.atan(Math.max((7.6 / CAM_D) / (SCREEN_W / SCREEN_H), 11.6 / CAM_D)) * 180 / Math.PI;
const CAM = { p: [0, CAM_TY + 3, CAM_D], l: [0, CAM_TY, 0], fov: CAM_FOV };
const UPX = SCREEN_H / (2 * CAM_D * Math.tan(CAM_FOV * Math.PI / 360));   // píxeles por unidad (a la distancia del vaso)
const MAT = { r: 0.16, m: 0.6 };                       // bloques brillantes (rugosidad baja, algo metálicos)
const cellX = c => c - COLS / 2 + 0.5;
const cellY = r => ROWS - r - 0.5;
const at = (x, y, z = 0) => project(CAM, [x, y, z], SCREEN_W, SCREEN_H);

const SHAPES = {
  I: { n: 4, c: C.cyan, b: [[1, 0], [1, 1], [1, 2], [1, 3]] }, O: { n: 4, c: C.amber, b: [[0, 1], [0, 2], [1, 1], [1, 2]] },
  T: { n: 3, c: C.violet, b: [[0, 1], [1, 0], [1, 1], [1, 2]] }, S: { n: 3, c: C.lime, b: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  Z: { n: 3, c: C.red, b: [[0, 0], [0, 1], [1, 1], [1, 2]] }, J: { n: 3, c: C.blue, b: [[0, 0], [1, 0], [1, 1], [1, 2]] },
  L: { n: 3, c: C.orange, b: [[0, 2], [1, 0], [1, 1], [1, 2]] },
};
const cells = (t, rot) => {
  const { n, b } = SHAPES[t];
  let cs = b;
  for (let i = 0; i < rot; i++) cs = cs.map(([r, c]) => [c, n - 1 - r]);
  return cs;
};
const bag = () => shuffle(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);

// Previsualización de una pieza (bloques pequeños) centrada en (X, Y)
const shapeObjs = (t, X, Y, color) => {
  const cs = cells(t, 0);
  const minR = Math.min(...cs.map(q => q[0])), maxR = Math.max(...cs.map(q => q[0]));
  const minC = Math.min(...cs.map(q => q[1])), maxC = Math.max(...cs.map(q => q[1]));
  const cr = (minR + maxR) / 2, cc = (minC + maxC) / 2;
  return cs.map(([r, c]) => ({ k: 'box', inst: 'bloque', p: [X + (c - cc) * 0.6, Y - (r - cr) * 0.6, 0], s: [MINI, MINI, MINI], c: color, e: 0.3, m: MAT }));
};

// Entorno estático (una sola vez): vaso con cristal, rejilla, suelo, fondo y marcos de las previsualizaciones
const COMMON = {
  sky: { top: '#060818', bottom: '#15173f', sun: false, clouds: 0 },
  fog: { c: '#15173f', near: 34, far: 62 },
  light: { dir: [-0.4, 0.9, 0.6], i: 2.1, hi: 1.25, sky: '#a9c4ff', ground: '#1c1640', sun: '#fff1dc' },
  shadowR: 14,
};
const WELL = (() => {
  const out = [];
  out.push({ id: 'suelo', k: 'box', p: [0, -0.3, -1.2], s: [COLS + 2.4, 0.6, 3.6], c: '#0e1436', m: { r: 0.35, m: 0.3 }, recv: true });
  out.push({ id: 'fondo', k: 'box', p: [0, ROWS / 2, -2.2], s: [COLS + 6, ROWS + 4, 0.25], c: '#0b1233', e: 0.05, recv: true });
  for (let i = 0; i <= COLS; i++) out.push({ id: `vx${i}`, k: 'box', p: [i - COLS / 2, ROWS / 2, -1.5], s: [0.03, ROWS, 0.03], c: C.cyan, e: 0.9, o: 0.16 });
  for (let j = 0; j <= ROWS; j++) out.push({ id: `hz${j}`, k: 'box', p: [0, j, -1.5], s: [COLS, 0.03, 0.03], c: C.cyan, e: 0.9, o: 0.12 });
  out.push({ id: 'pared-i', k: 'box', p: [-COLS / 2 - 0.18, ROWS / 2, 0.2], s: [0.16, ROWS + 0.4, 0.5], c: C.blue, e: 0.9, m: MAT });
  out.push({ id: 'pared-d', k: 'box', p: [COLS / 2 + 0.18, ROWS / 2, 0.2], s: [0.16, ROWS + 0.4, 0.5], c: C.blue, e: 0.9, m: MAT });
  out.push({ id: 'base', k: 'box', p: [0, -0.02, 0.2], s: [COLS + 0.4, 0.06, 0.5], c: C.cyan, e: 1, m: MAT });
  // marcos de HOLD y SIGUIENTE
  out.push({ id: 'marco-hold', k: 'box', p: [HOLD_X, 16, -0.4], s: [2.5, 3.2, 0.2], c: '#131c46', e: 0.15, o: 0.92 });
  out.push({ id: 'marco-next', k: 'box', p: [NEXT_X, 12.2, -0.4], s: [2.5, 11, 0.2], c: '#131c46', e: 0.15, o: 0.92 });
  return out;
})();

// Demo para la pantalla de inicio: un vaso ya medio lleno (solo decorado)
const DEMO_OBJS = (() => {
  const keys = Object.keys(SHAPES);
  const out = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < COLS; c++) {
    if (((c * 3 + r * 5) % 7) < 2) continue;
    out.push({ k: 'box', inst: 'bloque', p: [cellX(c), cellY(ROWS - 1 - r), 0], s: [BS, BS, BS], c: SHAPES[keys[(c + r * 2) % 7]].c, e: 0.3, m: MAT });
  }
  return out;
})();
const MENU_SCENE = { ...COMMON, statics: WELL, objs: DEMO_OBJS };

export function NeonTetris3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('tetris');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, lines: 0, level: 1 });
  const g = useRef(null);

  const fits = (s, t, rot, x, y) => cells(t, rot).every(([r, c]) => {
    const gx = x + c, gy = y + r;
    return gx >= 0 && gx < COLS && gy < ROWS && (gy < 0 || !s.grid[gy][gx]);
  });
  const drop = (s, p) => { let y = p.y; while (fits(s, p.t, p.rot, p.x, y + 1)) y += 1; return y; };
  const gameOver = s => {
    if (s.over) return;
    s.over = true; hx.die(); fx.shake(9, 0.45); fx.flash(C.red, 0.3);
    setRes({ isNew: submitBest(s.score), lines: s.lines, level: s.level });
    setPhase('over');
  };
  const spawnPiece = (s, forceT) => {
    if (s.q.length < 7) s.q.push(...bag());
    const t = forceT || s.q.shift();
    s.piece = { t, rot: 0, x: Math.floor((COLS - SHAPES[t].n) / 2), y: t === 'I' ? -1 : 0 };
    s.lock = 0; s.resets = 0; s.acc = 0;
    if (!fits(s, t, 0, s.piece.x, s.piece.y)) gameOver(s);
  };
  const initState = () => {
    const s = {
      grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)), q: [...bag(), ...bag()], piece: null, hold: null, canHold: true,
      score: 0, lines: 0, level: 1, combo: -1, acc: 0, lock: 0, resets: 0, clearing: null, t: 0, over: false,
      dxAcc: 0, lastX: 0, down: 0, t0: 0, ign: false,
    };
    spawnPiece(s);
    return s;
  };
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };

  const moveX = (s, dx) => {
    const p = s.piece;
    if (!p || s.clearing || s.over) return;
    if (!fits(s, p.t, p.rot, p.x + dx, p.y)) return;
    p.x += dx; hx.tick();
    if (!fits(s, p.t, p.rot, p.x, p.y + 1) && s.resets < 14) { s.lock = 0; s.resets += 1; }   // al tocar suelo se reinicia el bloqueo
  };
  const rotate = s => {
    const p = s.piece;
    if (!p || s.clearing || s.over || p.t === 'O') return;
    const nr = (p.rot + 1) % 4;
    for (const [kx, ky] of [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]]) {
      if (fits(s, p.t, nr, p.x + kx, p.y + ky)) {
        p.rot = nr; p.x += kx; p.y += ky; hx.tap();
        if (!fits(s, p.t, p.rot, p.x, p.y + 1) && s.resets < 14) { s.lock = 0; s.resets += 1; }
        return;
      }
    }
  };
  const holdPiece = s => {
    if (!s.piece || s.clearing || s.over || !s.canHold) return;
    const cur = s.piece.t, h = s.hold;
    s.hold = cur; s.canHold = false; hx.hit();
    spawnPiece(s, h || undefined);
  };
  const lockPiece = s => {
    const p = s.piece, col = SHAPES[p.t].c;
    let out = false;
    cells(p.t, p.rot).forEach(([r, c]) => {
      const gy = p.y + r, gx = p.x + c;
      if (gy < 0) out = true; else s.grid[gy][gx] = col;
      burst3d([cellX(gx), cellY(gy), 0.3], col, 4, { speed: 3, g: 6, size: 0.12, life: 0.45 });
    });
    s.piece = null; hx.hit();
    if (out) { gameOver(s); return; }
    const full = [];
    for (let r = 0; r < ROWS; r++) if (s.grid[r].every(Boolean)) full.push(r);
    if (full.length) {
      s.clearing = { rows: full, t: 0.32 };
      s.combo += 1;
      const base = [0, 100, 300, 500, 800][full.length] * s.level + (s.combo > 0 ? 50 * s.combo * s.level : 0);
      s.score += base;
      const label = full.length === 4 ? '¡TETRIS!' : full.length === 3 ? 'TRIPLE' : full.length === 2 ? 'DOBLE' : 'LÍNEA';
      const q = at(0, cellY(full[0]));
      fx.pop(q.x, q.y - 40, `${label} +${base}`, full.length === 4 ? C.amber : C.text, full.length === 4 ? 26 : 19);
      full.forEach(r => {
        const col = s.grid[r][0] || C.cyan;
        for (let c = 0; c < COLS; c++) burst3d([cellX(c), cellY(r), 0.3], [col, '#ffffff'], 6, { speed: 5, up: 3, g: 10, size: 0.16, life: 0.8 });
        ring3d([0, cellY(r), 0.3], col, 16, { speed: 6, life: 0.6 });
      });
      if (full.length >= 3) { fx.shake(7, 0.3); fx.flash('#ffffff', 0.2); hx.win(); } else hx.good();
    } else {
      s.combo = -1; s.canHold = true; spawnPiece(s);
    }
  };
  const hardDrop = s => {
    const p = s.piece;
    if (!p || s.clearing || s.over) return;
    const ny = drop(s, p);
    s.score += 2 * (ny - p.y); p.y = ny;
    fx.shake(4, 0.14);
    lockPiece(s);
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    if (s.over) return;
    if (s.clearing) {
      s.clearing.t -= dt;
      if (s.clearing.t <= 0) {
        const rows = s.clearing.rows;
        s.grid = s.grid.filter((_, i) => !rows.includes(i));
        while (s.grid.length < ROWS) s.grid.unshift(Array(COLS).fill(null));
        s.lines += rows.length;
        s.clearing = null; s.canHold = true;
        const lv = Math.floor(s.lines / 10) + 1;
        if (lv > s.level) { s.level = lv; const q = at(0, cellY(6)); fx.pop(q.x, q.y, `NIVEL ${lv}`, C.lime, 24); hx.good(); }
        spawnPiece(s);
      }
      return;
    }
    const p = s.piece;
    if (!p) return;
    const grav = s.down ? 0.04 : Math.max(0.04, Math.pow(0.8 - (s.level - 1) * 0.007, s.level - 1));
    if (fits(s, p.t, p.rot, p.x, p.y + 1)) {
      s.acc += dt; s.lock = 0;
      while (s.acc >= grav && fits(s, p.t, p.rot, p.x, p.y + 1)) { s.acc -= grav; p.y += 1; if (s.down) s.score += 1; }
    } else {
      s.lock += dt;
      if (s.lock >= 0.45) lockPiece(s);
    }
  });

  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current;
      s.ign = y > SCREEN_H - 130;      // la franja de botones no mueve la pieza
      s.lastX = x; s.dxAcc = 0; s.t0 = Date.now(); s.down = 0;
    },
    move: (x, y, gs) => {
      const s = g.current;
      if (phase !== 'play' || s.ign || s.over || s.clearing) return;
      const dx = x - s.lastX; s.lastX = x; s.dxAcc += dx;
      const step = UPX * 0.8;
      while (s.dxAcc > step) { s.dxAcc -= step; moveX(s, 1); }
      while (s.dxAcc < -step) { s.dxAcc += step; moveX(s, -1); }
      s.down = gs.dy > 18 && gs.dy > Math.abs(gs.dx) * 1.2 ? 1 : 0;
    },
    up: (x, y, gs) => {
      const s = g.current;
      s.down = 0;
      if (phase !== 'play' || s.ign || s.over || s.clearing) return;
      if (gs.dy > 70 && gs.vy > 1.1 && Math.abs(gs.dx) < gs.dy * 0.6) hardDrop(s);
      else if (Math.hypot(gs.dx, gs.dy) < 14 && Date.now() - s.t0 < 320) rotate(s);
    },
  });

  // ─── escena ───────────────────────────────────────────────────
  const s = g.current;
  const p = s.piece;
  const objs = [];
  s.grid.forEach((row, r) => row.forEach((col, c) => {
    if (!col) return;
    const flash = s.clearing && s.clearing.rows.includes(r);
    objs.push({ k: 'box', inst: 'bloque', p: [cellX(c), cellY(r), 0], s: [BS, BS, BS], c: flash ? (Math.floor(s.t * 24) % 2 ? '#ffffff' : col) : col, e: 0.3, m: MAT });
  }));
  if (p && !s.clearing) {
    const gy = drop(s, p);
    cells(p.t, p.rot).forEach(([r, c], i) => {
      objs.push({ id: `gh${i}`, k: 'box', p: [cellX(p.x + c), cellY(gy + r), 0], s: [BS, BS, BS], c: SHAPES[p.t].c, o: 0.2, e: 0.05, m: MAT });
    });
    cells(p.t, p.rot).forEach(([r, c], i) => {
      if (p.y + r < 0) return;
      objs.push({ id: `pc${i}`, k: 'box', p: [cellX(p.x + c), cellY(p.y + r), 0.08], s: [BS, BS, BS], c: SHAPES[p.t].c, e: 0.45, m: MAT, sh: true });
    });
  }
  if (s.hold) objs.push(...shapeObjs(s.hold, HOLD_X, 16, s.canHold ? SHAPES[s.hold].c : shade(SHAPES[s.hold].c, 0.45)));
  s.q.slice(0, 3).forEach((t, i) => objs.push(...shapeObjs(t, NEXT_X, 15.4 - i * 3.2, SHAPES[t].c)));
  const scene = { ...COMMON, statics: WELL, objs, cam: CAM };

  const lh = at(HOLD_X, 18.7), ln = at(NEXT_X, 18.7);
  return (
    <Game3D title="NEON TETRIS" emoji="🧊" accent={C.cyan} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={MENU_SCENE} orbit={{ r: 36, h: 4, speed: 0.12, ly: 0, drop: 0 }}
      pan={pan}
      hud={<><HudPill label="NIVEL" value={s.level} color={C.lime} /><HudPill label="LÍNEAS" value={s.lines} color={C.cyan} /></>}
      subtitle="Bloques de neón que caen en un vaso 3D"
      lines={['Arrastra ↔ para mover · toca para girar', 'Arrastra rápido hacia abajo para soltar la pieza', 'HOLD guarda una pieza para más tarde', 'Limpia filas para subir de nivel']}
      result={{ isNew: res.isNew, title: 'GAME OVER', subtitle: `${res.lines} líneas · nivel ${res.level}`, stats: [['LÍNEAS', String(res.lines)], ['NIVEL', String(res.level)]] }}>
      <Text pointerEvents="none" style={{ position: 'absolute', left: lh.x - 40, top: lh.y - 8, width: 80, textAlign: 'center', color: C.dim, fontSize: 10, fontWeight: '900', letterSpacing: 2 }}>HOLD</Text>
      <Text pointerEvents="none" style={{ position: 'absolute', left: ln.x - 50, top: ln.y - 8, width: 100, textAlign: 'center', color: C.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>SIGUIENTE</Text>
      <ActionBtn testID="tt-hold" label="HOLD" color={C.violet} onDown={() => holdPiece(g.current)} style={{ left: 22, bottom: 34 }} />
      <ActionBtn testID="tt-rot" label="GIRAR" color={C.cyan} onDown={() => rotate(g.current)} style={{ right: 22, bottom: 34 }} />
    </Game3D>
  );
}
