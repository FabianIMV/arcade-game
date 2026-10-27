import React, { useReducer, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, Btn, GameScreen, Overlay, PlayArea, alpha, hx, rand, randInt, pick, tglow, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Campo de minas 3D: las celdas sin abrir son bloques altos; al abrirlas se hunden y muestran su número (Text 2D).
// Tercera persona baja detrás del campo. Tocar excava; mantener pulsado pone bandera (cono rojo).
const MS_LEVELS = { easy: { c: 8, r: 10, m: 10, base: 500, name: 'Fácil' }, med: { c: 9, r: 12, m: 20, base: 1100, name: 'Medio' }, hard: { c: 10, r: 14, m: 36, base: 2200, name: 'Difícil' } };
const MS_COLORS = ['', '#4d8bff', '#7dff6b', '#ff4d6d', '#9b6bff', '#ff8a3d', '#22e6ff', '#ffffff', '#8b92b8'];
const ASP = AREA_W / AREA_H, TANH = Math.tan(Math.PI / 6);
const HI = 0.35, LO = 0.08;

// Cámara ajustada al tamaño del campo (tercera persona, baja y algo inclinada).
const camOf = (c, r, cs) => {
  const hw = (c * cs) / 2 + 0.6, hd = (r * cs) / 2 + 0.6;
  const dc = Math.max(hw / (TANH * ASP), (hd / TANH) * 1.15);
  return { p: [0, dc * 0.6, dc * 0.8], l: [0, 0, 0], fov: 60 };
};
const cellSize = L => Math.min(5.4 / L.c, 7.4 / L.r);

// Proyección de la cámara: 3D → píxeles del área (Text 2D) y picking sobre el plano del campo.
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
  const onY = (sx, sy, h) => {
    const a = ((sx - AREA_W / 2) / (AREA_H / 2)) * th, b = -((sy - AREA_H / 2) / (AREA_H / 2)) * th;
    const d = [fx + rx * a + ux * b, fy + uy * b, fz + rz * a + uz * b];
    const t = (h - ey) / d[1];
    return [ex + d[0] * t, ez + d[2] * t];
  };
  return { toScreen, onY };
};

const nbOf = (L, i) => {
  const { c, r } = L; const x = i % c, y = Math.floor(i / c); const o = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < c && ny < r) o.push(ny * c + nx);
  }
  return o;
};
const initState = lv => {
  const L = MS_LEVELS[lv];
  return { L, cs: cellSize(L), cells: Array.from({ length: L.c * L.r }, () => ({ mine: false, open: false, flag: false, n: 0 })), placed: false, mode: 'dig', t: 0, flags: 0, opened: 0, over: false };
};

export function Buscaminas3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('minesweeper');
  const [phase, setPhase] = useState('ready');
  const [level, setLevel] = useState('easy');
  const [res, setRes] = useState({ isNew: false, won: false, pts: 0 });
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);
  const press = useRef(null);
  if (!g.current) g.current = initState('easy');
  const start = () => { fx.clear(); g.current = initState(level); setPhase('play'); };
  const place = (s, safe) => {
    const banned = new Set([safe, ...nbOf(s.L, safe)]); let n = 0;
    while (n < s.L.m) { const i = randInt(0, s.cells.length - 1); if (banned.has(i) || s.cells[i].mine) continue; s.cells[i].mine = true; n++; }
    s.cells.forEach((cl, i) => { cl.n = nbOf(s.L, i).filter(j => s.cells[j].mine).length; }); s.placed = true;
  };
  const finish = (s, won) => {
    s.over = true;
    if (won) {
      const pts = Math.max(50, Math.round(s.L.base - s.t * (s.L.base / 400)));
      hx.win(); fx.flash('#fff', 0.3); for (let k = 0; k < 5; k++) fx.burst(rand(30, AREA_W - 30), rand(60, 300), pick([C.cyan, C.pink, C.amber, C.lime]), 16, 260, 0.9, 5);
      setRes({ isNew: submitBest(pts), won: true, pts });
    } else { hx.die(); fx.shake(9, 0.4); fx.flash(C.red, 0.3); s.cells.forEach(cl => { if (cl.mine) cl.open = true; }); setRes({ isNew: false, won: false, pts: 0 }); }
    setTimeout(() => setPhase(won ? 'win' : 'over'), won ? 700 : 1100);
    force();
  };
  const open = (s, i) => {
    const q = [i];
    while (q.length) {
      const j = q.pop(); const cl = s.cells[j];
      if (cl.open || cl.flag) continue;
      cl.open = true; s.opened += 1;
      if (cl.n === 0 && !cl.mine) nbOf(s.L, j).forEach(k => { if (!s.cells[k].open) q.push(k); });
    }
  };
  const tap = i => {
    const s = g.current; if (phase !== 'play' || s.over) return;
    const cl = s.cells[i];
    if (s.mode === 'flag' && !cl.open) { cl.flag = !cl.flag; s.flags += cl.flag ? 1 : -1; hx.tick(); force(); return; }
    if (cl.open) { // acorde
      if (cl.n > 0 && nbOf(s.L, i).filter(j => s.cells[j].flag).length === cl.n) { nbOf(s.L, i).forEach(j => { const c2 = s.cells[j]; if (!c2.flag && !c2.open) { if (c2.mine) { c2.open = true; finish(s, false); } else open(s, j); } }); hx.tap(); }
    } else if (!cl.flag) {
      if (!s.placed) place(s, i);
      if (cl.mine) { cl.open = true; finish(s, false); return; }
      open(s, i); hx.tap();
    }
    if (!s.over && s.opened >= s.cells.length - s.L.m) finish(s, true);
    force();
  };
  const longPress = i => { const s = g.current; if (phase !== 'play' || s.over || s.cells[i].open) return; const cl = s.cells[i]; cl.flag = !cl.flag; s.flags += cl.flag ? 1 : -1; hx.hit(); force(); };
  useLoop(phase === 'play', dt => { const s = g.current; if (s.placed && !s.over) s.t += dt; });

  const cellAt = (x, y) => {
    const s = g.current; const { c, r } = s.L; const cs = s.cs;
    const [wx, wz] = camRig(camOf(c, r, cs)).onY(x, y, 0.2);
    const col = Math.round(wx / cs + (c - 1) / 2), row = Math.round(wz / cs + (r - 1) / 2);
    if (col < 0 || row < 0 || col >= c || row >= r) return -1;
    if (Math.abs(wx - (col - (c - 1) / 2) * cs) > cs / 2 || Math.abs(wz - (row - (r - 1) / 2) * cs) > cs / 2) return -1;
    return row * c + col;
  };
  const pan = usePan(fx, {
    down: (x, y) => { press.current = { i: cellAt(x, y), t: Date.now() }; },
    up: (x, y, gs) => {
      const p = press.current; press.current = null;
      if (!p || p.i < 0 || phase !== 'play') return;
      if (Math.hypot(gs.dx || 0, gs.dy || 0) > 12) return; // fue un arrastre
      if (Date.now() - p.t > 260) longPress(p.i); else tap(p.i);
    },
  });

  const s = g.current; const { c, r } = s.L; const cs = s.cs;
  const mins = Math.floor(s.t / 60), secs = Math.floor(s.t % 60);
  const cam = camOf(c, r, cs); const rig = camRig(cam);
  const cx = i => (i % c - (c - 1) / 2) * cs, cz = i => (Math.floor(i / c) - (r - 1) / 2) * cs;
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, -0.02, 0], s: [c * cs + 1.6, r * cs + 1.6, 1], c: '#0c0508' },
    ...s.cells.flatMap((cl, i) => {
      const x = cx(i), z = cz(i);
      const h = cl.open ? LO : HI;
      const out = [{ id: `c${i}`, k: 'box', p: [x, h / 2, z], s: [cs * 0.9, h, cs * 0.9], c: cl.open ? (cl.mine ? '#5a1424' : '#1b1024') : '#4a1a2c', e: cl.open ? 0.03 : 0.08 }];
      if (cl.open && cl.mine) out.push({ id: `m${i}`, k: 'sph', p: [x, 0.3, z], n: cs * 0.55, c: '#ff4d6d', e: 0.35 });
      if (!cl.open && cl.flag) out.push({ id: `b${i}`, k: 'cone', p: [x, HI + cs * 0.3, z], s: [cs * 0.32, cs * 0.6, cs * 0.32], c: C.amber, e: 0.4 });
      return out;
    }),
  ];
  const scene = { bg: '#0c0508', fog: { c: '#0c0508', near: 14, far: 30 }, objs, cam };
  return (
    <GameScreen title="BUSCAMINAS" emoji="💣" accent={C.red} onExit={onExit} score={res.pts || 0} best={best}
      hud={<><Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>🚩 {s.L.m - s.flags}</Text><Text style={{ color: C.dim, fontSize: 12 }}>{s.L.name} · {c}×{r}</Text><Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>⏱ {mins}:{String(secs).padStart(2, '0')}</Text></>}>
      <PlayArea fx={fx} bg="#0c0508" border={alpha(C.red, 0.35)} {...pan}>
        <World3D scene={scene} />
        {s.cells.map((cl, i) => {
          if (!cl.open || cl.mine || cl.n === 0) return null;
          const p = rig.toScreen(cx(i), LO + 0.02, cz(i));
          const fs = Math.max(10, Math.min(30, Math.round(p.s * cs * 0.6)));
          return <Text key={i} pointerEvents="none" style={{ position: 'absolute', left: p.x - 20, top: p.y - fs * 0.6, width: 40, textAlign: 'center', color: MS_COLORS[cl.n], fontSize: fs, fontWeight: '900', ...tglow(MS_COLORS[cl.n], 6) }}>{cl.n}</Text>;
        })}
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 10, flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
          <Btn testID="ms-dig" label="⛏️ EXCAVAR" small ghost={s.mode !== 'dig'} color={C.cyan} onPress={() => { s.mode = 'dig'; hx.tick(); force(); }} />
          <Btn testID="ms-flag" label="🚩 BANDERA" small ghost={s.mode !== 'flag'} color={C.amber} onPress={() => { s.mode = 'flag'; hx.tick(); force(); }} />
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'win' ? '🏆' : phase === 'over' ? '💥' : '💣'} title={phase === 'win' ? '¡DESPEJADO!' : phase === 'over' ? '¡BOOM!' : 'BUSCAMINAS 3D'}
          subtitle={phase === 'win' ? `${mins}:${String(secs).padStart(2, '0')} · ${s.L.name}` : phase === 'over' ? 'Pisaste una mina' : 'Descubre todo sin tocar las minas'}
          score={res.pts} best={best} isNew={res.isNew} accent={C.red} onStart={start} onExit={onExit}
          extra={<View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>{Object.entries(MS_LEVELS).map(([k, v]) => <Btn key={k} testID={`lv-${k}`} label={v.name} small ghost={level !== k} color={C.red} onPress={() => setLevel(k)} />)}</View>}
          lines={phase === 'ready' ? ['Toca para excavar · mantén pulsado para poner bandera', 'El número indica minas vecinas', 'Toca un número con sus banderas para abrir alrededor', 'La primera casilla siempre es segura'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
