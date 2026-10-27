import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, Btn, GameScreen, Overlay, PlayArea, alpha, hx, pick, tglow, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Tablero 3D: cada ficha es un bloque cuya altura crece con su valor. Cámara baja detrás del tablero
// (tercera persona). Deslizar mueve las fichas; los números son Text 2D sobre la cara superior de cada bloque.
const N = 4, CS = 1.4, FOV = 60;
const CAM = { p: [0, 4.6, 10.4], l: [0, 0, -0.8], fov: FOV };
const wx = c => (c - (N - 1) / 2) * CS;
const wz = r => (r - (N - 1) / 2) * CS;

// Proyección de la cámara fija: 3D → píxeles del área (para Text 2D).
const camRig = cam => {
  const th = Math.tan((cam.fov * Math.PI) / 360);
  const [ex, ey, ez] = cam.p;
  let fx = cam.l[0] - ex, fy = cam.l[1] - ey, fz = cam.l[2] - ez;
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const K = (AREA_H / 2) / th;
  return (x, y, z) => {
    const dx = x - ex, dy = y - ey, dz = z - ez;
    const zc = dx * fx + dy * fy + dz * fz;
    const xc = dx * rx + dz * rz, yc = dx * ux + dy * uy + dz * uz;
    const k = K / zc;
    return { x: AREA_W / 2 + xc * k, y: AREA_H / 2 - yc * k, s: k };
  };
};
const toScreen = camRig(CAM);

const hueOf = v => (Math.log2(v) * 37 + 170) % 360;
const colOf = v => { const h = hueOf(v); return `hsl(${h},85%,${v >= 128 ? 58 : 50}%)`; };
const hgtOf = v => 0.35 + (Math.log2(v) - 1) * 0.12;

const spawn = s => {
  const used = new Set(s.tiles.filter(t => !t.die).map(t => t.r * N + t.c));
  const free = []; for (let i = 0; i < N * N; i++) if (!used.has(i)) free.push(i);
  if (!free.length) return;
  const i = pick(free);
  const r = Math.floor(i / N), c = i % N;
  s.tiles.push({ id: uid(), v: Math.random() < 0.9 ? 2 : 4, r, c, x: wx(c), z: wz(r), born: s.t, pop: 0 });
};
const initState = () => { const s = { tiles: [], score: 0, undo: null, undos: 3, won: false, lock: 0, over: false, t: 0, used: false }; spawn(s); spawn(s); return s; };

export function NeonGame2048_3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('2048');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const canMove = s => {
    const live = s.tiles.filter(t => !t.die);
    if (live.length < N * N) return true;
    const at = {}; live.forEach(t => { at[t.r * N + t.c] = t.v; });
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const v = at[r * N + c]; if ((c + 1 < N && at[r * N + c + 1] === v) || (r + 1 < N && at[(r + 1) * N + c] === v)) return true; }
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
          last.v *= 2; last.merged = true; last.pop = 0.18; gained += last.v; moved = true;
          if (last.v === 2048 && !s.won) { s.won = true; fx.pop(AREA_W / 2, AREA_H * 0.4, '¡2048!', C.amber, 40); fx.flash('#fff', 0.4); hx.win(); }
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
    if (gained) { fx.pop(AREA_W / 2, AREA_H * 0.12, `+${gained}`, C.amber, 18); hx.hit(); } else hx.tap();
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
      if (t.die) { t.dieT -= dt; }
    });
    s.tiles = s.tiles.filter(t => !(t.die && t.dieT <= 0));
    if (s.pending) {
      s.lock -= dt;
      if (s.lock <= 0) {
        s.pending = false; spawn(s);
        if (!canMove(s) && !s.over) { s.over = true; hx.die(); fx.shake(6, 0.3); setRes({ isNew: submitBest(s.score), won: s.won }); setPhase('over'); }
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
    { id: 'suelo', k: 'pla', p: [0, -0.2, -2], s: [16, 30, 1], c: '#050a14' },
    { id: 'tablero', k: 'box', p: [0, -0.06, 0], s: [N * CS + 0.5, 0.2, N * CS + 0.5], c: '#0b1a33', e: 0.05 },
    ...Array.from({ length: N * N }, (_, i) => ({ id: `hueco${i}`, k: 'box', p: [wx(i % N), 0.07, wz(Math.floor(i / N))], s: [CS * 0.84, 0.06, CS * 0.84], c: '#12305a', e: 0.04 })),
    ...s.tiles.map(t => {
      const h = hgtOf(t.v) * (t.die ? 0.9 : 1);
      const pulse = t.pop > 0 ? 1 + Math.sin((1 - t.pop / 0.18) * Math.PI) * 0.12 : 1;
      return { id: t.id, k: 'box', p: [t.x, 0.1 + (h * pulse) / 2, t.z], s: [CS * 0.84 * pulse, h * pulse, CS * 0.84 * pulse], c: colOf(t.v), e: t.v >= 128 ? 0.25 : 0.1, o: t.die ? 0.6 : 1 };
    }),
  ];
  const scene = { bg: '#050a14', objs, cam: CAM };
  return (
    <GameScreen title="2048 NEON" emoji="🟦" accent={C.cyan} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Mayor ficha <Text style={{ color: C.cyan, fontWeight: '800' }}>{maxTile}</Text></Text>{s.won ? <Text style={{ color: C.amber, fontWeight: '900', fontSize: 12 }}>🏆 ¡2048!</Text> : <Text style={{ color: C.dim, fontSize: 12 }}>Meta: 2048</Text>}</>}>
      <PlayArea fx={fx} bg="#050a14" border={alpha(C.cyan, 0.4)} {...pan}>
        <World3D scene={scene} />
        {s.tiles.map(t => {
          const h = hgtOf(t.v);
          const p = toScreen(t.x, 0.1 + h + 0.03, t.z);
          const digits = String(t.v).length;
          const fs = Math.max(10, Math.min(40, Math.round(p.s * (digits <= 2 ? 0.5 : digits === 3 ? 0.4 : 0.32))));
          return (
            <Text key={t.id} pointerEvents="none" style={{ position: 'absolute', left: p.x - 50, top: p.y - fs * 0.6, width: 100, textAlign: 'center', color: '#fff', fontSize: fs, fontWeight: '900', opacity: t.die ? 0.6 : 1, ...tglow('#000', 3) }}>{t.v}</Text>
          );
        })}
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 58, flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
          <Btn label={`↩ DESHACER (${s.undos})`} small ghost color={C.cyan} disabled={!s.undo || s.undos <= 0} onPress={doUndo} />
          <Btn label="NUEVA" small ghost color={C.dim} onPress={start} />
        </View>
        <Text pointerEvents="none" style={{ position: 'absolute', bottom: 18, width: AREA_W, textAlign: 'center', color: alpha(C.dim, 0.7), fontSize: 11, fontWeight: '800', letterSpacing: 2 }}>DESLIZA PARA MOVER LAS FICHAS</Text>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🟦" title={phase === 'over' ? (res.won ? '¡LLEGASTE AL 2048!' : 'SIN MOVIMIENTOS') : '2048 NEON 3D'}
          subtitle={phase === 'over' ? `Ficha máxima: ${maxTile}` : 'Fusiona fichas iguales'}
          score={s.score} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Desliza en cualquier dirección', 'Las fichas iguales se fusionan y crecen en altura', 'Tienes 3 deshacer por partida'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
