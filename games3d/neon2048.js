import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, SCREEN_H, SCREEN_W, alpha, hx, pick, tglow, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { Btn3D, Game3D, HudPill, ScreenLayer } from '../utils/ui3d';
import { burst3d, clear3d } from '../utils/engine3d';
import { project } from '../utils/openworld';

// 2048 NEON 3D: cada ficha es un bloque de cristal cuya altura crece con su valor. Desliza para mover;
// las fichas iguales se fusionan. Tienes 3 deshacer por partida. Cámara cenital de tres cuartos.
const N = 4, CS = 1.4;
const wx = c => (c - (N - 1) / 2) * CS;
const wz = r => (r - (N - 1) / 2) * CS;
const fitFov = (hw, hh, d) => 2 * Math.atan(Math.max(hw / d / (SCREEN_W / SCREEN_H), hh / d)) * 180 / Math.PI;
const CAM = { p: [0, 12.2, 8.4], l: [0, 0, -0.2], fov: fitFov(3.6, 3.6, 14.8) };
const PPU = (SCREEN_H / 2) / Math.tan((CAM.fov * Math.PI) / 360);   // píxeles por unidad a la distancia del tablero
const ppuAt = z => PPU / z;   // píxeles por unidad a la profundidad z
const hueOf = v => (Math.log2(v) * 37 + 170) % 360;
const colOf = v => `hsl(${hueOf(v)},85%,${v >= 128 ? 58 : 50}%)`;
const hgtOf = v => 0.35 + (Math.log2(v) - 1) * 0.12;
const MAT = { r: 0.2, m: 0.5 };

const COMMON = {
  sky: { top: '#050a1c', bottom: '#0f1d3f', sun: false, clouds: 0 },
  fog: { c: '#0f1d3f', near: 20, far: 40 },
  light: { dir: [-0.4, 0.9, 0.5], i: 2.2, hi: 1.25, sky: '#b9d4ff', ground: '#10203f', sun: '#fff4e0' },
  shadowR: 7,
};
const BOARD = [
  { id: 'bandeja', k: 'box', p: [0, -0.16, 0], s: [N * CS + 0.8, 0.32, N * CS + 0.8], c: '#0b1a33', e: 0.05, m: { r: 0.4, m: 0.2 }, recv: true },
  ...Array.from({ length: N * N }, (_, i) => ({ k: 'box', inst: 'hueco', p: [wx(i % N), 0.04, wz(Math.floor(i / N))], s: [CS * 0.84, 0.08, CS * 0.84], c: '#12305a', e: 0.04, m: { r: 0.5, m: 0.1 } })),
];

const spawn = s => {
  const used = new Set(s.tiles.filter(t => !t.die).map(t => t.r * N + t.c));
  const free = []; for (let i = 0; i < N * N; i++) if (!used.has(i)) free.push(i);
  if (!free.length) return;
  const i = pick(free);
  const r = Math.floor(i / N), c = i % N;
  s.tiles.push({ id: uid(), v: Math.random() < 0.9 ? 2 : 4, r, c, x: wx(c), z: wz(r), born: s.t, pop: 0.18 });
};
const initState = () => { const s = { tiles: [], score: 0, undo: null, undos: 3, won: false, lock: 0, over: false, t: 0, used: false, pending: false }; spawn(s); spawn(s); return s; };

// Escena de inicio: un tablero con fichas de demostración (solo decorado)
const DEMO_VALS = [2, 4, 8, 0, 16, 32, 0, 2, 0, 64, 128, 4, 2, 0, 8, 0];
const MENU_SCENE = {
  ...COMMON, statics: BOARD, cam: CAM,
  objs: DEMO_VALS.map((v, i) => v ? { id: `demo${i}`, k: 'box', p: [wx(i % N), 0.1 + hgtOf(v) / 2, wz(Math.floor(i / N))], s: [CS * 0.84, hgtOf(v), CS * 0.84], c: colOf(v), e: v >= 128 ? 0.25 : 0.1, sh: true, m: MAT } : null).filter(Boolean),
};

export function NeonGame2048_3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('2048');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false, max: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); };
  const canMove = s => {
    const live = s.tiles.filter(t => !t.die);
    if (live.length < N * N) return true;
    const at = {}; live.forEach(t => { at[t.r * N + t.c] = t.v; });
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = at[r * N + c];
      if ((c + 1 < N && at[r * N + c + 1] === v) || (r + 1 < N && at[(r + 1) * N + c] === v)) return true;
    }
    return false;
  };
  const move = (dr, dc) => {
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    s.tiles = s.tiles.filter(t => !t.die);
    const snap = { tiles: s.tiles.map(t => ({ v: t.v, r: t.r, c: t.c })), score: s.score };
    let moved = false, gained = 0;
    for (let line = 0; line < N; line++) {
      const ts = s.tiles.filter(t => (dr === 0 ? t.r === line : t.c === line));
      ts.sort((a, b) => (dr === 0 ? (dc > 0 ? b.c - a.c : a.c - b.c) : (dr > 0 ? b.r - a.r : a.r - b.r)));
      let k = 0, last = null;
      for (const t of ts) {
        if (last && !last.merged && last.v === t.v) {
          t.r = last.r; t.c = last.c; t.die = true; t.dieT = 0.12;
          last.v *= 2; last.merged = true; last.pop = 0.22; gained += last.v; moved = true;
          burst3d([wx(last.c), 0.8, wz(last.r)], [colOf(last.v), '#ffffff'], 14, { speed: 3.5, up: 2, g: 6, size: 0.14, life: 0.7 });
          if (last.v === 2048 && !s.won) { s.won = true; fx.pop(SCREEN_W / 2, SCREEN_H * 0.4, '¡2048!', C.amber, 40); fx.flash('#ffffff', 0.4); hx.win(); }
        } else {
          const nr = dr === 0 ? t.r : (dr > 0 ? N - 1 - k : k);
          const nc = dc === 0 ? t.c : (dc > 0 ? N - 1 - k : k);
          if (nr !== t.r || nc !== t.c) moved = true;
          t.r = nr; t.c = nc; last = t; k += 1;
        }
      }
    }
    s.tiles.forEach(t => { t.merged = false; });
    if (!moved) { hx.tick(); return; }
    s.undo = snap; s.score += gained;
    if (gained) { fx.pop(SCREEN_W / 2, SCREEN_H * 0.14, `+${gained}`, C.amber, 18); hx.hit(); fx.shake(3, 0.12); } else hx.tap();
    s.pending = true; s.lock = 0.1;
  };
  const doUndo = () => {
    const s = g.current;
    if (phase !== 'play' || !s.undo || s.undos <= 0) return;
    s.tiles = s.undo.tiles.map(t => ({ id: uid(), v: t.v, r: t.r, c: t.c, x: wx(t.c), z: wz(t.r), born: s.t, pop: 0 }));
    s.score = s.undo.score; s.undo = null; s.undos -= 1; s.pending = false; s.over = false; hx.tick();
  };
  useLoop(phase !== 'ready', dt => {
    const s = g.current;
    s.t += dt;
    s.tiles.forEach(t => {
      const k = Math.min(1, dt * 22);
      t.x += (wx(t.c) - t.x) * k; t.z += (wz(t.r) - t.z) * k;
      if (t.pop > 0) t.pop -= dt;
      if (t.die) t.dieT -= dt;
    });
    s.tiles = s.tiles.filter(t => !(t.die && t.dieT <= 0));
    if (s.pending) {
      s.lock -= dt;
      if (s.lock <= 0) {
        s.pending = false; spawn(s);
        if (!canMove(s) && !s.over) {
          s.over = true; hx.die(); fx.shake(7, 0.35); fx.flash(C.red, 0.25);
          setRes({ isNew: submitBest(s.score), won: s.won, max: s.tiles.reduce((m, t) => Math.max(m, t.v), 0) });
          setPhase('over');
        }
      }
    }
  });
  const pan = usePan(fx, {
    down: () => { g.current.used = false; },
    move: (x, y, gs) => {
      const s = g.current; if (s.used) return;
      if (Math.abs(gs.dx) > 22 || Math.abs(gs.dy) > 22) {
        s.used = true;
        if (Math.abs(gs.dx) > Math.abs(gs.dy)) move(0, gs.dx > 0 ? 1 : -1); else move(gs.dy > 0 ? 1 : -1, 0);
      }
    },
  });

  const s = g.current;
  const maxTile = s.tiles.reduce((m, t) => Math.max(m, t.v), 0);
  const objs = [
    ...s.tiles.map(t => {
      const h = hgtOf(t.v) * (t.die ? 0.9 : 1);
      const pulse = t.pop > 0 ? 1 + Math.sin((1 - t.pop / 0.22) * Math.PI) * 0.12 : 1;
      return { id: String(t.id), k: 'box', p: [t.x, 0.1 + (h * pulse) / 2, t.z], s: [CS * 0.84 * pulse, h * pulse, CS * 0.84 * pulse], c: colOf(t.v), e: t.v >= 128 ? 0.25 : 0.1, o: t.die ? 0.6 : 1, sh: true, m: MAT };
    }),
  ];
  const scene = { ...COMMON, statics: BOARD, objs, cam: CAM };

  return (
    <Game3D title="2048 NEON" emoji="🟦" accent={C.cyan} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={MENU_SCENE} pan={pan}
      orbit={{ r: 15, h: 9, speed: 0.16, ly: 0, drop: 0 }}
      hud={<><HudPill label="MAYOR" value={maxTile || 2} color={C.cyan} />{s.won ? <HudPill icon="🏆" label="META" value="2048" color={C.amber} /> : <HudPill label="META" value="2048" color={C.dim} />}</>}
      subtitle="Fusiona fichas iguales hasta llegar al 2048"
      lines={['Desliza en cualquier dirección para mover las fichas', 'Las fichas iguales se fusionan y crecen en altura', 'Tienes 3 deshacer por partida']}
      result={{ won: res.won, isNew: res.isNew, title: res.won ? '¡LLEGASTE AL 2048!' : 'SIN MOVIMIENTOS', emoji: res.won ? '🏆' : '🟦', subtitle: `Ficha máxima: ${res.max}`, stats: [['FICHA MAX', String(res.max)]] }}>
      {phase === 'play' && <ScreenLayer>{s.tiles.map(t => {
        const h = hgtOf(t.v);
        const p = project(CAM, [t.x, 0.1 + h + 0.03, t.z], SCREEN_W, SCREEN_H);
        if (!p) return null;
        const digits = String(t.v).length;
        const fs = Math.max(10, Math.min(40, Math.round(ppuAt(p.z) * CS * (digits <= 2 ? 0.45 : digits === 3 ? 0.36 : 0.28))));
        return <Text key={t.id} pointerEvents="none" style={{ position: 'absolute', left: p.x - 50, top: p.y - fs * 0.6, width: 100, textAlign: 'center', color: '#ffffff', fontSize: fs, fontWeight: '900', opacity: t.die ? 0.6 : 1, ...tglow('#000000', 3) }}>{t.v}</Text>;
      })}</ScreenLayer>}
      {phase === 'play' ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 64, flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
          <Btn3D label={`↩ DESHACER (${s.undos})`} size="sm" ghost color={C.cyan} disabled={!s.undo || s.undos <= 0} onPress={doUndo} />
          <Btn3D label="NUEVA" size="sm" ghost color={C.dim} onPress={start} />
        </View>
      ) : null}
      {phase === 'play' ? <Text pointerEvents="none" style={{ position: 'absolute', bottom: 22, width: SCREEN_W, textAlign: 'center', color: alpha(C.dim, 0.8), fontSize: 11, fontWeight: '800', letterSpacing: 2 }}>DESLIZA PARA MOVER LAS FICHAS</Text> : null}
    </Game3D>
  );
}
