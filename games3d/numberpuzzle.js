import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, SCREEN_H, SCREEN_W, alpha, hx, pick, rand, tglow, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { Btn3D, Game3D, HudPill, ScreenLayer } from '../utils/ui3d';
import { burst3d, clear3d } from '../utils/engine3d';
import { project, rayGround } from '../utils/openworld';

// 15 PUZZLE 3D: bloques de cristal con su número sobre la cara superior. Toca una ficha de la fila o columna
// del hueco y se desliza hacia él. Menos movimientos y menos tiempo = más puntos; tableros más grandes valen más.
const BOARD_W = 5.4, TOPY = 0.38;
const cellOf = n => BOARD_W / n;
const wx = (c, n) => (c - (n - 1) / 2) * cellOf(n);
const wz = (r, n) => (r - (n - 1) / 2) * cellOf(n);
const hueOf = (v, n) => (v * 360 / (n * n)) % 360;
const fitFov = (hw, hh, d) => 2 * Math.atan(Math.max(hw / d / (SCREEN_W / SCREEN_H), hh / d)) * 180 / Math.PI;
const CAM = { p: [0, 11, 8.6], l: [0, 0, -0.4], fov: fitFov(3.7, 3.7, 14.3) };
const MAT = { r: 0.2, m: 0.45 };

const BASE = [
  { id: 'base', k: 'box', p: [0, -0.07, 0], s: [BOARD_W + 0.5, 0.2, BOARD_W + 0.5], c: '#0b1a33', e: 0.05, m: { r: 0.4, m: 0.2 }, recv: true },
];
const COMMON = {
  sky: { top: '#050a1c', bottom: '#0f1d3f', sun: false, clouds: 0 },
  fog: { c: '#0f1d3f', near: 20, far: 40 },
  light: { dir: [-0.4, 0.9, 0.5], i: 2.2, hi: 1.25, sky: '#b9d4ff', ground: '#10203f', sun: '#fff4e0' },
  shadowR: 7,
};
// huecos del tablero (estáticos, instancing)
const holes = n => Array.from({ length: n * n }, (_, i) => ({ k: 'box', inst: 'hueco', p: [wx(i % n, n), 0.03, wz(Math.floor(i / n), n)], s: [cellOf(n) * 0.9, 0.06, cellOf(n) * 0.9], c: '#12305a', e: 0.03, m: { r: 0.5, m: 0.1 } }));
// estáticos precalculados por tamaño (mismo array siempre: el motor no los reescribe cada frame)
const STATICS = { 3: [...BASE, ...holes(3)], 4: [...BASE, ...holes(4)], 5: [...BASE, ...holes(5)] };
const STATIC4 = STATICS[4];
// demostración de la pantalla de inicio: el tablero ordenado
const solvedObjs = n => Array.from({ length: n * n - 1 }, (_, k) => {
  const v = k + 1, i = k;
  return { id: `p${v}`, k: 'box', p: [wx(i % n, n), 0.2, wz(Math.floor(i / n), n)], s: [cellOf(n) * 0.82, 0.36, cellOf(n) * 0.82], c: `hsl(${hueOf(v, n)},80%,58%)`, e: 0.12, m: MAT, sh: true };
});
const MENU_SCENE = { ...COMMON, statics: STATIC4, objs: solvedObjs(4), cam: CAM };

// Tablero mezclado con un camino aleatorio desde el hueco (siempre se puede resolver)
const mk = n => {
  const grid = []; for (let i = 0; i < n * n - 1; i++) grid.push(i + 1); grid.push(0);
  let e = n * n - 1, prev = -1;
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
  const anim = {};
  grid.forEach((v, i) => { if (v) anim[v] = { x: wx(i % n, n), z: wz(Math.floor(i / n), n) }; });
  return { n, grid, moves: 0, t: 0, solved: false, started: false, anim };
};

export function NumberPuzzle3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('puzzle');
  const [phase, setPhase] = useState('ready');
  const [size, setSize] = useState(4);
  const [res, setRes] = useState({ isNew: false, pts: 0, moves: 0, time: '0:00' });
  const g = useRef(null);
  if (!g.current) g.current = initState(4);
  const start = () => { fx.clear(); clear3d(); g.current = initState(size); setPhase('play'); };
  const clock = s => `${Math.floor(s.t / 60)}:${String(Math.floor(s.t % 60)).padStart(2, '0')}`;

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
    while (cr !== r || cc !== c) {
      const pr = cr - dr, pc = cc - dc;
      s.grid[cr * n + cc] = s.grid[pr * n + pc];
      cr = pr; cc = pc;
    }
    s.grid[r * n + c] = 0;
    s.moves += 1; s.started = true; hx.tap();
    if (s.grid.every((v, k) => v === (k === n * n - 1 ? 0 : k + 1))) {
      s.solved = true;
      const pts = Math.max(100, n * n * 100 - s.moves * 4 - Math.round(s.t) * 5);
      hx.win(); fx.flash('#ffffff', 0.3);
      for (let k = 0; k < 6; k++) fx.burst(rand(40, SCREEN_W - 40), rand(80, SCREEN_H * 0.5), pick([C.cyan, C.pink, C.amber, C.lime]), 16, 260, 0.9, 5);
      for (let k = 0; k < n * n - 1; k++) burst3d([wx(k % n, n), 0.4, wz(Math.floor(k / n), n)], `hsl(${hueOf(k + 1, n)},80%,60%)`, 6, { speed: 3, up: 3, g: 8, size: 0.14, life: 0.9 });
      setRes({ isNew: submitBest(pts), pts, moves: s.moves, time: clock(s) });
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
      const hit = rayGround(CAM, x, y, SCREEN_W, SCREEN_H, TOPY);
      if (!hit) return;
      const n = s.n, cs = cellOf(n);
      const c = Math.round(hit[0] / cs + (n - 1) / 2), r = Math.round(hit[2] / cs + (n - 1) / 2);
      if (c < 0 || r < 0 || c >= n || r >= n) return;
      if (Math.abs(hit[0] - wx(c, n)) > cs / 2 || Math.abs(hit[2] - wz(r, n)) > cs / 2) return;
      tapCell(r * n + c);
    },
  });

  const s = g.current; const n = s.n; const cs = cellOf(n);
  const mins = Math.floor(s.t / 60), secs = Math.floor(s.t % 60);
  const objs = [];
  s.grid.forEach((v, i) => {
    if (!v) return;
    const a = s.anim[v] || { x: wx(i % n, n), z: wz(Math.floor(i / n), n) };
    const inPlace = v === i + 1;
    objs.push({ id: `p${v}`, k: 'box', p: [a.x, 0.2 + (inPlace ? 0.02 : 0), a.z], s: [cs * 0.82, 0.36, cs * 0.82], c: `hsl(${hueOf(v, n)},80%,${inPlace ? 60 : 48}%)`, e: inPlace ? 0.2 : 0.06, m: MAT, sh: true });
  });
  const scene = { ...COMMON, statics: STATICS[n], objs, cam: CAM };
  const pxPerU = (SCREEN_H / 2) / Math.tan((CAM.fov * Math.PI) / 360);

  return (
    <Game3D title="15 PUZZLE" emoji="🧩" accent={C.cyan} onExit={onExit} score={phase === 'play' ? null : res.pts} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={MENU_SCENE} pan={pan}
      orbit={{ r: 14, h: 8, speed: 0.15, ly: 0, drop: 0 }}
      hud={<><HudPill label="MOVIMIENTOS" value={s.moves} color={C.cyan} /><HudPill icon="⏱" value={`${mins}:${String(secs).padStart(2, '0')}`} color={C.text} /></>}
      subtitle="Ordena los números del 1 al 15"
      lines={['Toca una ficha de la fila o columna del hueco para deslizarla', 'Menos movimientos y menos tiempo = más puntos', 'Elige el tamaño: 3×3, 4×4 o 5×5']}
      result={{ isNew: res.isNew, title: '¡RESUELTO!', emoji: '🧩', subtitle: `${res.moves} movimientos · ${res.time}`, stats: [['MOVIMIENTOS', String(res.moves)], ['TIEMPO', res.time]] }}
      startLabel="JUGAR" retryLabel="OTRA VEZ"
      controlsAlways>
      {phase === 'play' ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 14, alignItems: 'center' }}>
          <Btn3D testID="pz-restart" label="REINICIAR" size="sm" ghost color={C.cyan} onPress={start} />
        </View>
      ) : (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 118, flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
          {[3, 4, 5].map(k => (
            <Btn3D key={k} testID={`pz-${k}`} label={`${k}×${k}`} size="sm" ghost={size !== k} color={C.cyan} onPress={() => setSize(k)} />
          ))}
        </View>
      )}
      {phase === 'play' && <ScreenLayer>{s.grid.map((v, i) => {
        if (!v) return null;
        const a = s.anim[v] || { x: wx(i % n, n), z: wz(Math.floor(i / n), n) };
        const p = project(CAM, [a.x, TOPY + 0.03, a.z], SCREEN_W, SCREEN_H);
        if (!p) return null;
        const fs = Math.max(12, Math.min(40, Math.round((pxPerU / p.z) * cs * 0.42)));
        return <Text key={v} pointerEvents="none" style={{ position: 'absolute', left: p.x - 40, top: p.y - fs * 0.6, width: 80, textAlign: 'center', color: '#ffffff', fontSize: fs, fontWeight: '900', ...tglow('#000000', 3) }}>{v}</Text>;
      })}</ScreenLayer>}
      {phase === 'play' ? <Text pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 58, textAlign: 'center', color: alpha(C.dim, 0.85), fontSize: 12, fontWeight: '700' }}>Toca una ficha de la fila o columna del hueco</Text> : null}
    </Game3D>
  );
}
