import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, SCREEN_H, SCREEN_W, hx, pick, rand, randInt, tglow, useBest, useFX, useLoop, usePan, useTimeouts } from '../utils/kit';
import { Btn3D, Game3D, HudPill } from '../utils/ui3d';
import { burst3d, clear3d } from '../utils/engine3d';
import { project, rayGround } from '../utils/openworld';

// BUSCAMINAS 3D: el campo es un mosaico de bloques de cristal. Tocar excava (la casilla se hunde y muestra su número,
// en 2D sobre el bloque); mantener pulsado pone bandera. La primera casilla siempre es segura.
const MS_LEVELS = { easy: { c: 8, r: 10, m: 10, base: 500, name: 'Fácil' }, med: { c: 9, r: 12, m: 20, base: 1100, name: 'Medio' }, hard: { c: 10, r: 14, m: 36, base: 2200, name: 'Difícil' } };
const MS_COLORS = ['', '#4d8bff', '#7dff6b', '#ff4d6d', '#9b6bff', '#ff8a3d', '#22e6ff', '#ffffff', '#8b92b8'];
const HI = 0.42, LO = 0.1;   // altura de una casilla cerrada / abierta
const FOV = 58;
const cellSize = L => Math.min(5.4 / L.c, 7.4 / L.r);
// Cámara de tres cuartos, baja, que enmarca todo el campo
const camOf = (c, r, cs) => {
  const hw = (c * cs) / 2 + 0.8, hd = (r * cs) / 2 + 0.8;
  const T = Math.tan((FOV / 2) * Math.PI / 180), asp = SCREEN_W / SCREEN_H;
  const dc = Math.max(hw / (T * asp), (hd / T) * 1.1);
  return { p: [0, dc * 0.62, dc * 0.78], l: [0, 0, 0], fov: FOV };
};
const cx = (L, cs, i) => (i % L.c - (L.c - 1) / 2) * cs;
const cz = (L, cs, i) => (Math.floor(i / L.c) - (L.r - 1) / 2) * cs;
const nbOf = (L, i) => {
  const x = i % L.c, y = Math.floor(i / L.c); const o = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < L.c && ny < L.r) o.push(ny * L.c + nx);
  }
  return o;
};
const initState = lv => {
  const L = MS_LEVELS[lv], cs = cellSize(L);
  return { L, cs, cam: camOf(L.c, L.r, cs), cells: Array.from({ length: L.c * L.r }, () => ({ mine: false, open: false, flag: false, n: 0, hh: HI })), placed: false, mode: 'dig', t: 0, flags: 0, opened: 0, over: false };
};

// Escena estática: marco de cristal y suelo (una sola vez)
const FRAME = { id: 'suelo-fx', k: 'box', p: [0, -0.06, 0], s: [30, 0.1, 30], c: '#070306', m: { r: 0.9, m: 0 }, recv: true };
const COMMON = {
  sky: { top: '#0a0408', bottom: '#241020', sun: false, clouds: 0 },
  fog: { c: '#241020', near: 14, far: 34 },
  light: { dir: [-0.5, 0.85, 0.5], i: 2.2, hi: 1.25, sky: '#ffd6e6', ground: '#2a1020', sun: '#fff0e6' },
  shadowR: 10,
};
// Demo de la pantalla de inicio: un campo a medio abrir (solo decorado)
const DEMO_L = MS_LEVELS.easy, DEMO_CS = cellSize(DEMO_L);
const DEMO_OBJS = Array.from({ length: DEMO_L.c * DEMO_L.r }, (_, i) => {
  const open = ((i * 7) % 5) < 2;
  return { k: 'box', inst: 'celda', p: [cx(DEMO_L, DEMO_CS, i), (open ? LO : HI) / 2, cz(DEMO_L, DEMO_CS, i)], s: [DEMO_CS * 0.9, open ? LO : HI, DEMO_CS * 0.9], c: open ? '#1b1024' : '#4a1a2c', e: open ? 0.05 : 0.12, sh: true, m: { r: 0.35, m: 0.3 } };
});
const MENU_SCENE = { ...COMMON, statics: null, objs: [FRAME, ...DEMO_OBJS], cam: camOf(DEMO_L.c, DEMO_L.r, DEMO_CS) };

export function Buscaminas3D({ onExit }) {
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('minesweeper');
  const [phase, setPhase] = useState('ready');
  const [level, setLevel] = useState('easy');
  const [res, setRes] = useState({ isNew: false, won: false, pts: 0, time: '0:00' });
  const g = useRef(null);
  const press = useRef(null);
  if (!g.current) g.current = initState('easy');

  const start = () => { fx.clear(); clear3d(); g.current = initState(level); setPhase('play'); };
  const place = (s, safe) => {
    const banned = new Set([safe, ...nbOf(s.L, safe)]);
    let n = 0;
    while (n < s.L.m) {
      const i = randInt(0, s.cells.length - 1);
      if (banned.has(i) || s.cells[i].mine) continue;
      s.cells[i].mine = true; n++;
    }
    s.cells.forEach((cl, i) => { cl.n = nbOf(s.L, i).filter(j => s.cells[j].mine).length; });
    s.placed = true;
  };
  const clock = s => `${Math.floor(s.t / 60)}:${String(Math.floor(s.t % 60)).padStart(2, '0')}`;
  const finish = (s, won) => {
    s.over = true;
    if (won) {
      const pts = Math.max(50, Math.round(s.L.base - s.t * (s.L.base / 400)));
      hx.win(); fx.flash('#ffffff', 0.3);
      for (let k = 0; k < 5; k++) fx.burst(rand(30, SCREEN_W - 30), rand(60, SCREEN_H * 0.4), pick([C.cyan, C.pink, C.amber, C.lime]), 16, 260, 0.9, 5);
      later(() => { setRes({ isNew: submitBest(pts), won: true, pts, time: clock(s) }); setPhase('over'); }, 700);
    } else {
      hx.die(); fx.shake(9, 0.4); fx.flash(C.red, 0.3);
      s.cells.forEach((cl, i) => { if (cl.mine) { cl.open = true; burst3d([cx(s.L, s.cs, i), 0.3, cz(s.L, s.cs, i)], ['#ff4d6d', '#ffb38a'], 10, { speed: 3.5, up: 2, size: 0.12, life: 0.8 }); } });
      later(() => { setRes({ isNew: false, won: false, pts: 0, time: clock(s) }); setPhase('over'); }, 1100);
    }
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
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    const cl = s.cells[i];
    if (s.mode === 'flag' && !cl.open) { cl.flag = !cl.flag; s.flags += cl.flag ? 1 : -1; hx.tick(); return; }
    if (cl.open) {   // acorde: el número con sus banderas abre alrededor
      if (cl.n > 0 && nbOf(s.L, i).filter(j => s.cells[j].flag).length === cl.n) {
        nbOf(s.L, i).forEach(j => {
          const c2 = s.cells[j];
          if (c2.flag || c2.open) return;
          if (c2.mine) { c2.open = true; finish(s, false); } else open(s, j);
        });
        hx.tap();
      }
    } else if (!cl.flag) {
      if (!s.placed) place(s, i);
      if (cl.mine) { cl.open = true; finish(s, false); return; }
      open(s, i); hx.tap();
    }
    if (!s.over && s.opened >= s.cells.length - s.L.m) finish(s, true);
  };
  const longPress = i => {
    const s = g.current;
    if (phase !== 'play' || s.over || s.cells[i].open) return;
    const cl = s.cells[i]; cl.flag = !cl.flag; s.flags += cl.flag ? 1 : -1; hx.hit();
  };
  const cellAt = (x, y) => {
    const s = g.current; const { L, cs, cam } = s;
    const hit = rayGround(cam, x, y, SCREEN_W, SCREEN_H, HI * 0.5);
    if (!hit) return -1;
    const col = Math.round(hit[0] / cs + (L.c - 1) / 2), row = Math.round(hit[2] / cs + (L.r - 1) / 2);
    if (col < 0 || row < 0 || col >= L.c || row >= L.r) return -1;
    return row * L.c + col;
  };
  const pan = usePan(fx, {
    down: (x, y) => { press.current = { i: cellAt(x, y), t: Date.now() }; },
    up: (x, y, gs) => {
      const p = press.current; press.current = null;
      if (!p || p.i < 0 || phase !== 'play') return;
      if (Math.hypot(gs.dx || 0, gs.dy || 0) > 12) return;   // fue un arrastre
      if (Date.now() - p.t > 260) longPress(p.i); else tap(p.i);
    },
  });
  useLoop(phase !== 'ready', dt => {
    const s = g.current;
    if (s.placed && !s.over) s.t += dt;
    for (const cl of s.cells) {
      const target = cl.open ? LO : HI;
      cl.hh += (target - cl.hh) * Math.min(1, dt * 14);
    }
  });

  const s = g.current; const { L, cs, cam } = s;
  const objs = [FRAME];
  s.cells.forEach((cl, i) => {
    const x = cx(L, cs, i), z = cz(L, cs, i);
    const hh = Math.max(LO, cl.hh);
    const col = cl.open ? (cl.mine ? '#5a1424' : '#1b1024') : '#4a1a2c';
    objs.push({ k: 'box', inst: 'celda', p: [x, hh / 2, z], s: [cs * 0.9, hh, cs * 0.9], c: col, e: cl.open ? 0.05 : 0.12, sh: true, m: { r: 0.35, m: 0.3 } });
    if (cl.open && cl.mine) objs.push({ k: 'ico', inst: 'mina', p: [x, LO + cs * 0.4, z], n: cs * 0.55, c: '#ff4d6d', e: 0.6 });
    if (!cl.open && cl.flag) objs.push({ k: 'cone', inst: 'bandera', p: [x, HI + cs * 0.35, z], s: [cs * 0.3, cs * 0.6, cs * 0.3], c: C.amber, e: 0.4 });
  });
  const scene = { ...COMMON, statics: null, objs, cam };
  const mins = Math.floor(s.t / 60), secs = Math.floor(s.t % 60);
  const pxPerU = (SCREEN_H / 2) / Math.tan((cam.fov * Math.PI) / 360);

  return (
    <Game3D title="BUSCAMINAS" emoji="💣" accent={C.red} onExit={onExit} score={res.pts || (phase === 'play' ? null : 0)} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={MENU_SCENE} pan={pan}
      orbit={{ r: 18, h: 6, speed: 0.14, ly: 0, drop: 0 }}
      hud={<><HudPill icon="🚩" value={s.L.m - s.flags} color={C.amber} /><HudPill label={s.L.name} value={`${L.c}×${L.r}`} color={C.red} /><HudPill icon="⏱" value={`${mins}:${String(secs).padStart(2, '0')}`} color={C.cyan} /></>}
      subtitle="Despeja el campo sin tocar ninguna mina"
      lines={['Toca para excavar · mantén pulsado para poner bandera', 'El número indica cuántas minas hay alrededor', 'Toca un número con sus banderas para abrir los vecinos', 'La primera casilla siempre es segura']}
      result={{ won: res.won, isNew: res.isNew, title: res.won ? '¡DESPEJADO!' : '¡BOOM!', emoji: res.won ? '🏆' : '💥', subtitle: res.won ? `${L.name} · ${res.time}` : 'Pisaste una mina', stats: [['TIEMPO', res.time], ['NIVEL', L.name]] }}
      startLabel="JUGAR" retryLabel="OTRA VEZ"
      controlsAlways>
      {phase === 'play' ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 14, flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
          <Btn3D testID="ms-dig" label="EXCAVAR" size="sm" ghost={s.mode !== 'dig'} color={C.cyan} onPress={() => { s.mode = 'dig'; hx.tick(); }} />
          <Btn3D testID="ms-flag" label="BANDERA" size="sm" ghost={s.mode !== 'flag'} color={C.amber} onPress={() => { s.mode = 'flag'; hx.tick(); }} />
        </View>
      ) : (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 126, flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
          {Object.entries(MS_LEVELS).map(([k, v]) => (
            <Btn3D key={k} testID={`lv-${k}`} label={v.name} size="sm" ghost={level !== k} color={C.red} onPress={() => setLevel(k)} />
          ))}
        </View>
      )}
      {phase === 'play' && Array.from({ length: s.cells.length }, (_, i) => i).map(i => {
        const cl = s.cells[i];
        if (!cl.open || cl.mine || cl.n === 0) return null;
        const x = cx(L, cs, i), z = cz(L, cs, i);
        const p = project(cam, [x, LO + 0.03, z], SCREEN_W, SCREEN_H);
        if (!p) return null;
        const fs = Math.max(10, Math.min(30, Math.round((pxPerU / p.z) * cs * 0.6)));
        return <Text key={i} pointerEvents="none" style={{ position: 'absolute', left: p.x - 20, top: p.y - fs * 0.6, width: 40, textAlign: 'center', color: MS_COLORS[cl.n], fontSize: fs, fontWeight: '900', ...tglow(MS_COLORS[cl.n], 6) }}>{cl.n}</Text>;
      })}
    </Game3D>
  );
}
