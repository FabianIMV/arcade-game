import React, { useReducer, useRef, useState } from 'react';
import { Text } from 'react-native';
import { C, SCREEN_H, SCREEN_W, alpha, hx, shuffle, tglow, useBest, useFX, useLoop, usePan, useTimeouts } from '../utils/kit';
import { Game3D, HudPill, ScreenLayer } from '../utils/ui3d';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { project } from '../utils/openworld';

// MEMORY MATCH 3D: cartas de cristal que giran sobre su eje para mostrar el símbolo. Encuentra los pares antes de que
// se acabe el tiempo. Cada nivel añade pares y quita tiempo. Los aciertos seguidos multiplican los puntos.
const CW = 1.0, CH = 1.35, SX = 1.25, SY = 1.6;
const BACK = '#4a34a8';
const EMO = ['🔥', '💎', '🌙', '⚡', '🎯', '🌊', '🍎', '👾', '🚀', '💀', '🌈', '🦄', '🍕', '🎸', '🐙', '🌵', '🍩', '👑'];
const COLORS = [C.red, C.cyan, C.violet, C.amber, C.pink, C.blue, C.lime, C.orange];
const levelCfg = lv => { const pairs = Math.min(15, 5 + lv); const cols = pairs <= 6 ? 3 : pairs <= 10 ? 4 : 5; return { pairs, cols, time: 22 + pairs * 6 }; };
const cardPos = (i, cols, rows) => {
  const c = i % cols, r = Math.floor(i / cols);
  return [(c - (cols - 1) / 2) * SX, (rows - 1 - r) * SY + 0.8];
};
// Cámara que encuadra el muro de cartas (de frente, algo elevada)
const camOf = (cols, rows) => {
  const ly = rows * 0.8, ASP = SCREEN_W / SCREEN_H, T = Math.tan(30 * Math.PI / 180);
  const dh = (ly + 0.9) / T;
  const dw = (cols * SX / 2 + 0.9) / (T * ASP);
  return { p: [0, ly + 1.6, Math.max(7, dh, dw)], l: [0, ly, 0], fov: 60 };
};
const WALLS = [
  { id: 'suelo', k: 'box', p: [0, -0.06, -1], s: [40, 0.12, 24], c: '#0a0616', m: { r: 0.6, m: 0.2 }, recv: true },
  { id: 'muro', k: 'box', p: [0, 9, -2.4], s: [40, 22, 0.25], c: '#120a2a', e: 0.05, recv: true },
];
const COMMON = {
  sky: { top: '#0a0520', bottom: '#1d1140', sun: false, clouds: 0 },
  fog: { c: '#1d1140', near: 18, far: 42 },
  light: { dir: [-0.35, 0.9, 0.6], i: 2.1, hi: 1.2, sky: '#d6c8ff', ground: '#1a1030', sun: '#ffe9d6' },
  shadowR: 12,
};
const build = (lv, score, combo) => {
  const cfg = levelCfg(lv);
  const faces = shuffle(EMO).slice(0, cfg.pairs);
  const cards = shuffle([...faces, ...faces]).map((e, i) => ({ id: i, e, c: COLORS[EMO.indexOf(e) % COLORS.length], up: true, matched: false, f: 1, sh: 0 }));
  const rows = Math.ceil(cards.length / cfg.cols);
  return { lv, cfg, rows, cards, first: null, lock: true, time: cfg.time, score, combo, maxCombo: 0, moves: 0, matches: 0, peek: true, over: false };
};
// Demo de la pantalla de inicio: un muro de cartas boca abajo (solo decorado)
const MENU_COLS = 4, MENU_ROWS = 3;
const MENU_SCENE = {
  ...COMMON, statics: WALLS, cam: camOf(MENU_COLS, MENU_ROWS),
  objs: Array.from({ length: MENU_COLS * MENU_ROWS }, (_, i) => {
    const [cx, cy] = cardPos(i, MENU_COLS, MENU_ROWS);
    return { id: `m${i}`, k: 'box', p: [cx, cy, 0], s: [CW, CH, 0.14], r: [0, i % 3 === 0 ? Math.PI : 0, 0], c: BACK, e: 0.06, sh: true };
  }),
};

export function MemoryMatch3D({ onExit }) {
  const later = useTimeouts();
  const fx = useFX();
  const [best, submitBest] = useBest('memory');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, lv: 1, maxCombo: 0, matches: 0 });
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);
  if (!g.current) g.current = build(1, 0, 0);
  const startLevel = (lv, score) => {
    const s = build(lv, score, 0); g.current = s; force();
    later(() => { s.cards.forEach(c => { c.up = false; }); s.lock = false; s.peek = false; force(); }, 1300 + s.cfg.pairs * 60);
  };
  const start = () => { fx.clear(); clear3d(); setPhase('play'); startLevel(1, 0); };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    // las cartas giran hacia su posición objetivo (boca arriba / boca abajo)
    s.cards.forEach(c => {
      const tg = c.up || c.matched ? 1 : 0;
      c.f += (tg - c.f) * Math.min(1, dt * 10);
      if (c.sh > 0) c.sh = Math.max(0, c.sh - dt);
    });
    if (s.peek || s.over) return;
    s.time -= dt;
    if (s.time <= 0) {
      s.time = 0; s.over = true; hx.die(); fx.shake(7, 0.35); fx.flash(C.red, 0.25);
      setRes({ isNew: submitBest(s.score), lv: s.lv, maxCombo: s.maxCombo, matches: s.matches });
      setPhase('over');
    }
  });

  const flip = i => {
    const s = g.current;
    if (phase !== 'play' || s.lock || s.over) return;
    const c = s.cards[i];
    if (c.up || c.matched) return;
    c.up = true; hx.tick();
    if (s.first == null) { s.first = i; force(); return; }
    const a = s.cards[s.first]; s.moves += 1;
    if (a.e === c.e) {
      a.matched = c.matched = true; s.first = null; s.matches += 1; s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
      const pts = 100 * s.combo; s.score += pts; hx.good();
      const [px, py] = cardPos(i, s.cfg.cols, s.rows);
      const cam = camOf(s.cfg.cols, s.rows);
      const sp = project(cam, [px, py, 0.1], SCREEN_W, SCREEN_H);
      fx.pop(sp.x, sp.y - 30, `+${pts}${s.combo > 1 ? ` · RACHA ×${s.combo}` : ''}`, C.amber, 18);
      burst3d([px, py, 0.4], [c.c, '#ffffff'], 18, { speed: 3.5, up: 2, g: 6, size: 0.14, life: 0.7 });
      ring3d([px, py, 0.2], c.c, 12, { speed: 4, life: 0.5 });
      if (s.matches >= s.cfg.pairs) {
        s.lock = true; const bonus = Math.round(s.time * 10); s.score += bonus; hx.win(); fx.flash('#ffffff', 0.3);
        fx.pop(SCREEN_W / 2, SCREEN_H / 2, `NIVEL ${s.lv} · BONUS +${bonus}`, C.lime, 22);
        later(() => startLevel(s.lv + 1, s.score), 1400);
      }
    } else {
      s.lock = true; s.combo = 0; a.sh = 0.4; c.sh = 0.4; hx.warn();
      later(() => { a.up = false; c.up = false; s.lock = false; force(); }, 650);
    }
    force();
  };
  // carta bajo el dedo: se compara con el rectángulo proyectado de cada carta
  const pickCard = (x, y) => {
    const s = g.current; const cam = camOf(s.cfg.cols, s.rows);
    for (let i = s.cards.length - 1; i >= 0; i--) {
      const [cx, cy] = cardPos(i, s.cfg.cols, s.rows);
      const pts = [[-CW / 2, -CH / 2], [CW / 2, -CH / 2], [CW / 2, CH / 2], [-CW / 2, CH / 2]].map(([dx, dy]) => project(cam, [cx + dx, cy + dy, 0.08], SCREEN_W, SCREEN_H)).filter(Boolean);
      if (pts.length < 4) continue;
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      if (x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys)) return i;
    }
    return -1;
  };
  const pan = usePan(fx, {
    down: (x, y) => { if (phase !== 'play') return; const i = pickCard(x, y); if (i >= 0) flip(i); },
  });

  const s = g.current;
  const cam = camOf(s.cfg.cols, s.rows);
  const pxPerU = (SCREEN_H / 2) / Math.tan((cam.fov * Math.PI) / 360);
  const objs = s.cards.map((c, i) => {
    const [cx, cy] = cardPos(i, s.cfg.cols, s.rows);
    const face = c.f > 0.5;
    const off = c.sh > 0 ? Math.sin(c.sh * 60) * 0.1 * (c.sh / 0.4) : 0;
    return { id: `carta${c.id}`, k: 'box', p: [cx + off, cy, 0], s: [CW, CH, 0.14], r: [0, c.f * Math.PI, 0], c: face ? c.c : BACK, e: c.matched ? 0.3 : face ? 0.12 : 0.06, sh: true, m: { r: 0.25, m: 0.4 } };
  });
  const scene = { ...COMMON, statics: WALLS, objs, cam };

  return (
    <Game3D title="MEMORY MATCH" emoji="🃏" accent={C.violet} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={MENU_SCENE} pan={pan}
      orbit={{ r: 17, h: 3, speed: 0.12, ly: 0, drop: 0 }}
      hud={<><HudPill label="TIEMPO" value={`${Math.ceil(s.time)}s`} color={s.time < 8 ? C.red : C.cyan} /><HudPill label="NIVEL" value={`${s.lv} · ${s.matches}/${s.cfg.pairs}`} color={C.violet} />{s.combo > 1 ? <HudPill label="RACHA" value={`×${s.combo}`} color={C.amber} /> : null}</>}
      subtitle="Encuentra todos los pares antes de que se acabe el tiempo"
      lines={['Al empezar verás las cartas un instante', 'Cada nivel tiene más pares y menos tiempo', 'Los pares seguidos multiplican los puntos']}
      result={{ isNew: res.isNew, title: '¡SE ACABÓ EL TIEMPO!', emoji: '⏰', subtitle: `Llegaste al nivel ${res.lv} · mejor racha ${res.maxCombo}`, stats: [['NIVEL', String(res.lv)], ['PARES', String(res.matches)], ['RACHA', String(res.maxCombo)]] }}>
      {phase === 'play' && <ScreenLayer>{s.cards.map((c, i) => {
        const [cx, cy] = cardPos(i, s.cfg.cols, s.rows);
        const p = project(cam, [cx, cy, 0.12], SCREEN_W, SCREEN_H);
        if (!p) return null;
        const fs = Math.max(12, Math.min(44, Math.round((pxPerU / p.z) * CH * 0.5)));
        const face = c.f > 0.5;
        return (
          <Text key={c.id} pointerEvents="none" style={{ position: 'absolute', left: p.x - 40, top: p.y - fs * 0.6, width: 80, textAlign: 'center', fontSize: face ? fs : Math.round(fs * 0.7), fontWeight: '900', color: face ? C.text : alpha(C.violet, 0.6), opacity: face ? Math.min(1, 0.4 + Math.abs(c.f - 0.5) * 2) : 0.7 }}>{face ? c.e : '?'}</Text>
        );
      })}</ScreenLayer>}
      {phase === 'play' && s.peek ? <Text pointerEvents="none" style={{ position: 'absolute', bottom: 22, width: SCREEN_W, textAlign: 'center', color: C.amber, fontWeight: '900', letterSpacing: 2, ...tglow(C.amber, 8) }}>¡MEMORIZA!</Text> : null}
    </Game3D>
  );
}
