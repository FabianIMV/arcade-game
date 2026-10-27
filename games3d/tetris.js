import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, Combo, GameScreen, Overlay, PlayArea, TouchBtn, alpha, hx, shuffle, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

// NEON TETRIS 3D: un vaso de profundidad. Las piezas caen en una de dos capas (frente / fondo).
// Una fila se limpia cuando cada columna tiene una celda llena en alguna capa. Cámara frente al vaso.
const COLS = 10, ROWS = 20, DEP = 2, CS = 0.5;  // columnas (x), filas (y), capas (z), tamaño de celda
const PANEL_X = AREA_W - 86;                    // zona 2D de la derecha (HOLD, siguiente, controles)
const CAM = { p: [0.9, 5.2, 16.5], l: [0.9, 5, 0], fov: 46 };

// Proyecta un punto 3D a píxeles del PlayArea con la misma cámara del motor (para efectos 2D).
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
  return [(xc / (zc * t * (AREA_W / AREA_H)) + 1) / 2 * AREA_W, (1 - yc / (zc * t)) / 2 * AREA_H];
};
// centro en el mundo de una celda (columna c, fila r, capa z)
const cellX = c => (c - COLS / 2 + 0.5) * CS;
const cellY = r => (ROWS - r - 0.5) * CS;
const cellZ = z => (z - (DEP - 1) / 2) * CS * 1.1;

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
const emptyRow = () => Array.from({ length: DEP }, () => Array(COLS).fill(null));

export function NeonTetris3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('tetris');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });

  const fits = (s, t, rot, x, y, z) => cells(t, rot).every(([r, c]) => {
    const gx = x + c, gy = y + r;
    return gx >= 0 && gx < COLS && gy < ROWS && (gy < 0 || !s.grid[gy][z][gx]);
  });
  const spawn = (s, forceT) => {
    if (s.q.length < 7) s.q.push(...bag());
    const t = forceT || s.q.shift();
    const p = { t, rot: 0, x: Math.floor((COLS - SHAPES[t].n) / 2), y: t === 'I' ? -1 : 0, z: 1 };
    s.piece = p; s.lock = 0; s.resets = 0; s.acc = 0; s.canHold = forceT ? s.canHold : true;
    if (!fits(s, t, 0, p.x, p.y, p.z)) {
      s.over = true; hx.die(); fx.shake(8, 0.4); fx.flash(C.red, 0.3);
      setRes({ isNew: submitBest(s.score) }); setPhase('over');
    }
  };
  const initState = () => {
    const s = {
      grid: Array.from({ length: ROWS }, emptyRow), q: [...bag(), ...bag()], piece: null, hold: null, canHold: true,
      score: 0, lines: 0, level: 1, combo: -1, acc: 0, lock: 0, resets: 0, clearing: null, t: 0, over: false,
      lastX: 0, lastY: 0, dxAcc: 0, moved: 0, down: 0, t0: 0, holdTap: false, panel: false,
    };
    spawn(s); return s;
  };
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const drop = (s, p) => { let y = p.y; while (fits(s, p.t, p.rot, p.x, y + 1, p.z)) y += 1; return y; };
  const touchGround = s => { if (s.resets < 14) { s.lock = 0; s.resets += 1; } };
  const shift = dx => {
    const s = g.current; const p = s.piece;
    if (phase !== 'play' || s.over || s.clearing || !p) return false;
    if (fits(s, p.t, p.rot, p.x + dx, p.y, p.z)) { p.x += dx; touchGround(s); hx.tick(); return true; }
    return false;
  };
  const shiftZ = dz => {
    const s = g.current; const p = s.piece;
    if (phase !== 'play' || s.over || s.clearing || !p) return;
    const nz = p.z + dz;
    if (nz >= 0 && nz < DEP && fits(s, p.t, p.rot, p.x, p.y, nz)) { p.z = nz; touchGround(s); hx.tick(); }
  };
  const rotate = () => {
    const s = g.current; const p = s.piece;
    if (phase !== 'play' || s.over || s.clearing || !p || p.t === 'O') return;
    const nr = (p.rot + 1) % 4;
    for (const [kx, ky] of [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1]]) {
      if (fits(s, p.t, nr, p.x + kx, p.y + ky, p.z)) { p.rot = nr; p.x += kx; p.y += ky; touchGround(s); hx.tap(); return; }
    }
  };
  const holdPiece = () => {
    const s = g.current;
    if (phase !== 'play' || s.over || s.clearing || !s.canHold) return;
    const cur = s.piece.t; const h = s.hold; s.hold = cur; s.canHold = false; hx.hit();
    if (h) spawn(s, h); else spawn(s);
    s.canHold = false;
  };
  const lockPiece = s => {
    const p = s.piece;
    cells(p.t, p.rot).forEach(([r, c]) => { const gy = p.y + r; if (gy >= 0) s.grid[gy][p.z][p.x + c] = SHAPES[p.t].c; });
    const full = [];
    for (let r = 0; r < ROWS; r++) if (Array.from({ length: COLS }, (_, c) => c).every(c => s.grid[r].some(layer => layer[c]))) full.push(r);
    hx.hit();
    if (full.length) {
      s.clearing = { rows: full, t: 0.28 }; s.piece = null;
      s.combo += 1;
      const base = [0, 100, 300, 500, 800][full.length] * s.level + (s.combo > 0 ? 50 * s.combo * s.level : 0);
      s.score += base;
      const label = full.length === 4 ? '¡TETRIS!' : full.length === 3 ? 'TRIPLE' : full.length === 2 ? 'DOBLE' : 'LÍNEA';
      const [px, py] = sproj(CAM, cellX(COLS / 2), cellY(full[0]), 0);
      fx.pop(px, py - 30, `${label} +${base}`, full.length === 4 ? C.amber : C.text, full.length === 4 ? 24 : 18);
      full.forEach(r => { const [bx, by] = sproj(CAM, 0, cellY(r), 0); fx.burst(bx, by, SHAPES[p.t].c, 6, 260, 0.6, 5); });
      if (full.length >= 3) { fx.shake(6, 0.25); fx.flash('#fff', 0.2); hx.win(); } else hx.good();
    } else { s.combo = -1; spawn(s); }
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
        while (s.grid.length < ROWS) s.grid.unshift(emptyRow());
        s.lines += rows.length;
        const lv = Math.floor(s.lines / 10) + 1;
        if (lv > s.level) { s.level = lv; fx.pop(AREA_W / 2, AREA_H * 0.3, `NIVEL ${lv}`, C.lime, 26); hx.good(); }
        s.clearing = null; spawn(s);
      }
      return;
    }
    const p = s.piece; if (!p) return;
    const grav = s.down > 0 ? 0.04 : Math.max(0.04, Math.pow(0.8 - (s.level - 1) * 0.007, s.level - 1));
    if (fits(s, p.t, p.rot, p.x, p.y + 1, p.z)) {
      s.acc += dt; s.lock = 0;
      while (s.acc >= grav && fits(s, p.t, p.rot, p.x, p.y + 1, p.z)) { s.acc -= grav; p.y += 1; if (s.down > 0) s.score += 1; }
    } else {
      s.lock += dt;
      if (s.lock >= 0.45) lockPiece(s);
    }
  });

  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current; s.lastX = x; s.lastY = y; s.dxAcc = 0; s.moved = 0; s.t0 = Date.now(); s.down = 0;
      s.panel = x > PANEL_X - 4; s.holdTap = s.panel && y < 110;
    },
    move: (x, y, gs) => {
      const s = g.current;
      if (phase !== 'play' || s.panel) return;
      const dx = x - s.lastX; s.lastX = x; s.lastY = y;
      s.moved += Math.abs(dx) + Math.abs(gs.dy);
      s.dxAcc += dx;
      const step = CS * 0.9 * 60;   // px por celda, aprox.
      while (s.dxAcc > step) { s.dxAcc -= step; shift(1); }
      while (s.dxAcc < -step) { s.dxAcc += step; shift(-1); }
      s.down = Math.abs(gs.dy) > Math.abs(gs.dx) * 1.2 && gs.dy > 18 ? 1 : 0;
    },
    up: (x, y, gs) => {
      const s = g.current;
      s.down = 0;
      if (phase !== 'play') return;
      if (s.panel) { if (s.holdTap && Math.abs(gs.dx) < 12 && Math.abs(gs.dy) < 12) holdPiece(); return; }
      if (gs.dy > 70 && gs.vy > 1.1 && Math.abs(gs.dx) < gs.dy * 0.6) { // flick: caída instantánea
        const p = s.piece;
        if (p && !s.clearing) {
          const ny = drop(s, p); s.score += 2 * (ny - p.y); p.y = ny;
          const [sx, sy] = sproj(CAM, cellX(p.x + 1), cellY(ny), cellZ(p.z)); fx.ring(sx, sy, SHAPES[p.t].c, 40);
          fx.shake(3, 0.12); lockPiece(s);
        }
      } else if (s.moved < 14 && Date.now() - s.t0 < 300) rotate();
    },
  });

  const s = g.current;
  const p = s.piece;
  const ghostY = p ? drop(s, p) : 0;
  const shade = (c, z) => (z === 0 ? 0.6 : 1);
  const objs = [
    { id: 'fondo-pared', k: 'box', p: [0, ROWS * CS / 2, -CS * 1.1 * 0.9], s: [COLS * CS + 0.4, ROWS * CS + 0.4, 0.1], c: '#0c1a48' },
    { id: 'base', k: 'box', p: [0, -0.1, 0], s: [COLS * CS + 0.4, 0.2, DEP * CS * 1.1 + 0.4], c: C.cyan, e: 0.6 },
    { id: 'pared-i', k: 'box', p: [-COLS * CS / 2 - 0.1, ROWS * CS / 2, 0], s: [0.1, ROWS * CS + 0.2, DEP * CS * 1.1 + 0.3], c: C.cyan, e: 0.6 },
    { id: 'pared-d', k: 'box', p: [COLS * CS / 2 + 0.1, ROWS * CS / 2, 0], s: [0.1, ROWS * CS + 0.2, DEP * CS * 1.1 + 0.3], c: C.cyan, e: 0.6 },
    ...Array.from({ length: COLS - 1 }, (_, i) => ({ id: `rej${i}`, k: 'box', p: [cellX(i + 1) - CS / 2, ROWS * CS / 2, -CS * 0.5], s: [0.02, ROWS * CS, 0.02], c: C.cyan, e: 0.3, o: 0.25 })),
  ];
  s.grid.forEach((row, r) => row.forEach((layer, z) => layer.forEach((v, c) => {
    if (!v) return;
    const flashing = s.clearing && s.clearing.rows.includes(r);
    const col = flashing ? (Math.floor(s.t * 24) % 2 ? '#ffffff' : v) : v;
    objs.push({ id: `g${r}-${z}-${c}`, k: 'box', p: [cellX(c), cellY(r), cellZ(z)], s: [CS * 0.9, CS * 0.9, CS * 0.9], c: col, e: 0.35, o: shade(v, z) });
  })));
  if (p && !s.clearing) {
    cells(p.t, p.rot).forEach(([r, c], i) => {
      objs.push({ id: `gh${i}`, k: 'box', p: [cellX(p.x + c), cellY(ghostY + r), cellZ(p.z)], s: [CS * 0.9, CS * 0.9, CS * 0.9], c: SHAPES[p.t].c, o: 0.22 });
    });
    cells(p.t, p.rot).forEach(([r, c], i) => {
      if (p.y + r < 0) return;
      objs.push({ id: `pc${i}`, k: 'box', p: [cellX(p.x + c), cellY(p.y + r), cellZ(p.z)], s: [CS * 0.9, CS * 0.9, CS * 0.9], c: SHAPES[p.t].c, e: 0.7 });
    });
  }
  const scene = { bg: '#04060f', fog: { c: '#04060f', near: 22, far: 40 }, objs, cam: CAM };

  const mini = (t, ox, oy, sz) => cells(t, 0).map(([r, c], i) => <View key={i} style={{ position: 'absolute', left: ox + c * sz, top: oy + r * sz, width: sz - 1, height: sz - 1, borderRadius: 3, backgroundColor: SHAPES[t].c }} />);
  return (
    <GameScreen title="NEON TETRIS" emoji="🧊" accent={C.cyan} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.cyan, fontWeight: '800' }}>{s.level}</Text> · Líneas <Text style={{ color: C.cyan, fontWeight: '800' }}>{s.lines}</Text></Text><View style={{ minWidth: 80, alignItems: 'flex-end' }}>{s.combo > 0 ? <Combo n={s.combo + 1} color={C.lime} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#04060f" border={alpha(C.cyan, 0.35)} {...pan}>
        <World3D scene={scene} />
        {/* panel lateral 2D: HOLD, siguiente, capa y controles */}
        <Text style={{ position: 'absolute', left: PANEL_X, top: 8, color: C.dim, fontSize: 10, fontWeight: '900', letterSpacing: 2 }}>HOLD</Text>
        <View pointerEvents="none" style={{ position: 'absolute', left: PANEL_X, top: 22, width: 76, height: 50, borderRadius: 10, borderWidth: 1.5, borderColor: s.canHold ? alpha(C.cyan, 0.5) : alpha(C.dim, 0.3), alignItems: 'center', justifyContent: 'center' }}>
          {s.hold && <View style={{ width: 56, height: 32, opacity: s.canHold ? 1 : 0.35 }}>{mini(s.hold, SHAPES[s.hold].n === 4 ? 0 : 7, SHAPES[s.hold].n === 4 ? -4 : 0, 14)}</View>}
        </View>
        <Text style={{ position: 'absolute', left: PANEL_X, top: 80, color: C.dim, fontSize: 10, fontWeight: '900', letterSpacing: 2 }}>SIGUIENTE</Text>
        {s.q.slice(0, 3).map((t, i) => <View key={i} pointerEvents="none" style={{ position: 'absolute', left: PANEL_X + 8, top: 96 + i * 38, width: 60, height: 34 }}>{mini(t, SHAPES[t].n === 4 ? 0 : 8, SHAPES[t].n === 4 ? -4 : 0, 13)}</View>)}
        <Text style={{ position: 'absolute', left: PANEL_X, top: 214, color: C.dim, fontSize: 10, fontWeight: '900', letterSpacing: 2 }}>CAPA</Text>
        <TouchBtn testID="capa-frente" onDown={() => shiftZ(1)} style={{ position: 'absolute', left: PANEL_X, top: 230, width: 78, height: 28, borderRadius: 8, borderWidth: 1, borderColor: alpha(C.cyan, p && p.z === 1 ? 1 : 0.4), alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(C.cyan, p && p.z === 1 ? 0.22 : 0.06) }}>
          <Text style={{ color: C.cyan, fontSize: 11, fontWeight: '900', opacity: p && p.z === 1 ? 1 : 0.5 }}>▲ FRENTE</Text>
        </TouchBtn>
        <TouchBtn testID="capa-fondo" onDown={() => shiftZ(-1)} style={{ position: 'absolute', left: PANEL_X, top: 264, width: 78, height: 28, borderRadius: 8, borderWidth: 1, borderColor: alpha(C.cyan, p && p.z === 0 ? 1 : 0.4), alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(C.cyan, p && p.z === 0 ? 0.22 : 0.06) }}>
          <Text style={{ color: C.cyan, fontSize: 11, fontWeight: '900', opacity: p && p.z === 0 ? 1 : 0.5 }}>▼ FONDO</Text>
        </TouchBtn>
        <Text pointerEvents="none" style={{ position: 'absolute', left: PANEL_X, bottom: 8, width: 84, color: alpha(C.dim, 0.9), fontSize: 9, lineHeight: 13 }}>{'↔ arrastra\n↻ toca = girar\n↓ baja = caer\n⤓ desliza rápido\n= soltar'}</Text>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🧊" title={phase === 'over' ? 'GAME OVER' : 'NEON TETRIS 3D'}
          subtitle={phase === 'over' ? `${s.lines} líneas · nivel ${s.level}` : 'Piezas en un vaso de profundidad'}
          score={s.score} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra ↔ para mover · toca para girar', 'Arrastra ↓ para bajar · desliza rápido para soltar', 'HOLD guarda una pieza · ▲▼ cambia de capa (frente/fondo)'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
