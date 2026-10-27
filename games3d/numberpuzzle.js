import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, alpha, hx, pick, rand, tglow, useBest, useFX, useLoop, usePan, Btn } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Puzzle 3D: fichas de bloque sobre un tablero visto desde detrás y arriba (tercera persona).
// Tocar una ficha de la fila o columna del hueco la desliza hacia el hueco. Los números son Text 2D.
const FOV = 60, TOPY = 0.36;
const CAM = { p: [0, 4.5, 9.4], l: [0, 0, -0.6], fov: FOV };

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

const cellOf = n => 5.4 / n;
const wx = (c, n) => (c - (n - 1) / 2) * cellOf(n);
const wz = (r, n) => (r - (n - 1) / 2) * cellOf(n);
const hueOf = (v, n) => (v * 360 / (n * n)) % 360;

const mk = n => {
  const grid = []; for (let i = 0; i < n * n - 1; i++) grid.push(i + 1); grid.push(0);
  let e = n * n - 1;
  let prev = -1;
  for (let k = 0; k < 120 * n; k++) {
    const r = Math.floor(e / n), c = e % n, opts = [];
    if (r > 0) opts.push(e - n); if (r < n - 1) opts.push(e + n); if (c > 0) opts.push(e - 1); if (c < n - 1) opts.push(e + 1);
    const o = pick(opts.filter(x => x !== prev));
    grid[e] = grid[o]; grid[o] = 0; prev = e; e = o;
  }
  return grid;
};
const initState = n => {
  const grid = mk(n);
  // posición animada por valor (la ficha se desliza en vez de saltar)
  const anim = {};
  grid.forEach((v, i) => { if (v) anim[v] = { x: wx(i % n, n), z: wz(Math.floor(i / n), n) }; });
  return { n, grid, moves: 0, t: 0, solved: false, started: false, anim };
};

export function NumberPuzzle3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('puzzle');
  const [phase, setPhase] = useState('ready');
  const [size, setSize] = useState(4);
  const [res, setRes] = useState({ isNew: false, pts: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState(4);
  const start = () => { fx.clear(); g.current = initState(size); setPhase('play'); };
  const tapCell = i => {
    const s = g.current;
    if (phase !== 'play' || s.solved) return;
    const n = s.n; const r = Math.floor(i / n), c = i % n;
    const e = s.grid.indexOf(0); const er = Math.floor(e / n), ec = e % n;
    if (r !== er && c !== ec) { hx.tick(); return; }
    if (r === er && c === ec) return;
    const dr = Math.sign(er - r), dc = Math.sign(ec - c);
    // mover en cadena desde el hueco hacia la ficha pulsada
    let cr = er, cc = ec;
    while (cr !== r || cc !== c) { const pr = cr - dr, pc = cc - dc; s.grid[cr * n + cc] = s.grid[pr * n + pc]; cr = pr; cc = pc; }
    s.grid[r * n + c] = 0;
    s.moves += 1; s.started = true; hx.tap();
    if (s.grid.every((v, k) => v === (k === n * n - 1 ? 0 : k + 1))) {
      s.solved = true;
      const pts = Math.max(100, n * n * 100 - s.moves * 4 - Math.round(s.t) * 5);
      hx.win(); fx.flash('#fff', 0.3);
      for (let k = 0; k < 6; k++) fx.burst(rand(40, AREA_W - 40), rand(80, AREA_H * 0.5), pick([C.cyan, C.pink, C.amber, C.lime]), 16, 260, 0.9, 5);
      setRes({ isNew: submitBest(pts), pts });
      setTimeout(() => setPhase('over'), 900);
    }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.started && !s.solved) s.t += dt;
    // cada ficha se desliza hacia su celda
    const n = s.n;
    s.grid.forEach((v, i) => {
      if (!v) return;
      const a = s.anim[v] || (s.anim[v] = { x: wx(i % n, n), z: wz(Math.floor(i / n), n) });
      const k = Math.min(1, dt * 14);
      a.x += (wx(i % n, n) - a.x) * k; a.z += (wz(Math.floor(i / n), n) - a.z) * k;
    });
  });
  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current; if (phase !== 'play' || s.solved) return;
      const n = s.n;
      const [px, , pz] = RIG.onY(x, y, TOPY - 0.1);
      const c = Math.round(px / cellOf(n) + (n - 1) / 2), r = Math.round(pz / cellOf(n) + (n - 1) / 2);
      if (c < 0 || r < 0 || c >= n || r >= n) return;
      if (Math.abs(px - wx(c, n)) > cellOf(n) / 2 + 0.1 || Math.abs(pz - wz(r, n)) > cellOf(n) / 2 + 0.1) return;
      tapCell(r * n + c);
    },
  });

  const s = g.current; const n = s.n; const cs = cellOf(n);
  const mins = Math.floor(s.t / 60), secs = Math.floor(s.t % 60);
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, -0.2, -1], s: [16, 30, 1], c: '#050a14' },
    { id: 'base', k: 'box', p: [0, -0.06, 0], s: [n * cs + 0.4, 0.2, n * cs + 0.4], c: '#0b1a33', e: 0.05 },
    ...Array.from({ length: n * n }, (_, i) => ({ id: `hueco${i}`, k: 'box', p: [wx(i % n, n), 0.04, wz(Math.floor(i / n), n)], s: [cs * 0.9, 0.06, cs * 0.9], c: '#12305a', e: 0.03 })),
    ...s.grid.map((v, i) => {
      if (!v) return null;
      const a = s.anim[v] || { x: wx(i % n, n), z: wz(Math.floor(i / n), n) };
      const inPlace = v === i + 1;
      return { id: `p${v}`, k: 'box', p: [a.x, 0.2 + (inPlace ? 0.02 : 0), a.z], s: [cs * 0.82, 0.36, cs * 0.82], c: `hsl(${hueOf(v, n)},80%,${inPlace ? 58 : 46}%)`, e: inPlace ? 0.12 : 0.05 };
    }).filter(Boolean),
  ];
  const scene = { bg: '#050a14', objs, cam: CAM };
  return (
    <GameScreen title="15 PUZZLE" emoji="🧩" accent={C.cyan} onExit={onExit} score={res.pts || 0} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Movimientos <Text style={{ color: C.cyan, fontWeight: '800' }}>{s.moves}</Text></Text><Text style={{ color: C.text, fontWeight: '900', fontSize: 15 }}>⏱ {mins}:{String(secs).padStart(2, '0')}</Text><Text style={{ color: C.dim, fontSize: 12 }}>{n}×{n}</Text></>}>
      <PlayArea fx={fx} bg="#050a14" border={alpha(C.cyan, 0.4)} {...pan}>
        <World3D scene={scene} />
        {s.grid.map((v, i) => {
          if (!v) return null;
          const a = s.anim[v] || { x: wx(i % n, n), z: wz(Math.floor(i / n), n) };
          const p = RIG.toScreen(a.x, TOPY + 0.03, a.z);
          const fs = Math.max(12, Math.min(40, Math.round(p.s * cs * 0.42)));
          return <Text key={v} pointerEvents="none" style={{ position: 'absolute', left: p.x - 40, top: p.y - fs * 0.6, width: 80, textAlign: 'center', color: '#fff', fontSize: fs, fontWeight: '900', ...tglow('#000', 3) }}>{v}</Text>;
        })}
        <Text pointerEvents="none" style={{ position: 'absolute', bottom: 56, width: AREA_W, textAlign: 'center', color: alpha(C.dim, 0.8), fontSize: 12, fontWeight: '700' }}>Toca una ficha de la fila o columna del hueco para deslizarla</Text>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 16, alignItems: 'center' }}><Btn label="🔀 REINICIAR" small ghost color={C.cyan} onPress={start} /></View>
        <Overlay show={phase !== 'play'} kind={phase === 'over' ? 'win' : phase} emoji="🧩" title={phase === 'over' ? '¡RESUELTO!' : '15 PUZZLE 3D'}
          subtitle={phase === 'over' ? `${s.moves} movimientos · ${mins}:${String(secs).padStart(2, '0')}` : 'Ordena los números del 1 al ' + (size * size - 1)}
          score={res.pts} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          extra={<View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>{[3, 4, 5].map(k => <Btn key={k} label={`${k}×${k}`} small ghost={size !== k} color={C.cyan} onPress={() => setSize(k)} />)}</View>}
          lines={phase === 'ready' ? ['Menos movimientos y menos tiempo = más puntos', 'Tableros más grandes valen más'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
