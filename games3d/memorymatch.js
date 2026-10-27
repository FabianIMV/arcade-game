import React, { useReducer, useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, Combo, GameScreen, Lives, Overlay, PlayArea, alpha, hx, shuffle, useBest, useFX, useLoop, usePan, useTimeouts } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { View } from 'react-native';

// Cartas 3D que se levantan y giran alrededor del eje vertical. Símbolos = Text 2D sobre cada carta.
// La cámara se ajusta al tamaño del tablero (tercera persona, de frente al muro de cartas).
const CW = 1.0, CH = 1.35, SX = 1.25, SY = 1.6, ASP = AREA_W / AREA_H, TANH = Math.tan(Math.PI / 6);
const BACK = '#2a1a5e';
const EMO = ['🔥', '💎', '🌙', '⚡', '🎯', '🌊', '🍎', '👾', '🚀', '💀', '🌈', '🦄', '🍕', '🎸', '🐙', '🌵', '🍩', '👑'];
const COLORS = [C.red, C.cyan, C.violet, C.amber, C.pink, C.blue, C.lime, C.orange];
const levelCfg = lv => { const pairs = Math.min(15, 5 + lv); const cols = pairs <= 6 ? 3 : pairs <= 10 ? 4 : 5; return { pairs, cols, time: 22 + pairs * 6 }; };

// Cámara ajustada al tablero: centro a media altura del muro, distancia para que quepan filas y columnas.
const camOf = (cols, rows) => {
  const ly = rows * 0.8;
  const dh = (ly + 0.5) / TANH;
  const dw = (cols * SX / 2 + 0.6) / (TANH * ASP);
  return { p: [0, ly + 1.2, Math.max(7, dh, dw)], l: [0, ly, 0], fov: 60 };
};

// Proyección de la cámara: 3D → píxeles del área (Text 2D) y picking sobre el plano de las cartas (z = 0).
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
  const onZ = (sx, sy, h) => {
    const a = ((sx - AREA_W / 2) / (AREA_H / 2)) * th, b = -((sy - AREA_H / 2) / (AREA_H / 2)) * th;
    const d = [fx + rx * a + ux * b, fy + uy * b, fz + rz * a + uz * b];
    const t = (h - ez) / d[2];
    return [ex + d[0] * t, ey + d[1] * t, h];
  };
  return { toScreen, onZ };
};

const cardPos = (i, cols, rows) => {
  const c = i % cols, r = Math.floor(i / cols);
  return [(c - (cols - 1) / 2) * SX, (rows - 1 - r) * SY + 0.8];
};

const build = (lv, score, combo) => {
  const cfg = levelCfg(lv);
  const faces = shuffle(EMO).slice(0, cfg.pairs);
  const cards = shuffle([...faces, ...faces]).map((e, i) => ({ id: i, e, c: COLORS[EMO.indexOf(e) % COLORS.length], up: true, matched: false, f: 1, sh: 0 }));
  const rows = Math.ceil(cards.length / cfg.cols);
  return { lv, cfg, rows, cards, first: null, lock: true, time: cfg.time, score, combo, maxCombo: 0, moves: 0, matches: 0, peek: true, over: false };
};

export function MemoryMatch3D({ onExit }) {
  const later = useTimeouts();
  const fx = useFX();
  const [best, submitBest] = useBest('memory');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);
  if (!g.current) g.current = build(1, 0, 0);
  const startLevel = (lv, score) => {
    const s = build(lv, score, 0); g.current = s; force();
    later(() => { s.cards.forEach(c => { c.up = false; }); s.lock = false; s.peek = false; force(); }, 1300 + s.cfg.pairs * 60);
  };
  const start = () => { fx.clear(); setPhase('play'); startLevel(1, 0); };
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
    if (s.time <= 0) { s.time = 0; s.over = true; hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
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
      const q = cardPos(i, s.cfg.cols, s.rows);
      const sp = camRig(camOf(s.cfg.cols, s.rows)).toScreen(q[0], q[1], 0);
      fx.pop(sp.x, sp.y - 30, `+${pts}${s.combo > 1 ? ` · RACHA ×${s.combo}` : ''}`, C.amber, 18);
      if (s.matches >= s.cfg.pairs) {
        s.lock = true; const bonus = Math.round(s.time * 10); s.score += bonus; hx.win(); fx.flash('#fff', 0.3);
        fx.pop(AREA_W / 2, AREA_H / 2, `NIVEL ${s.lv} · BONUS +${bonus}`, C.lime, 22);
        later(() => startLevel(s.lv + 1, s.score), 1400);
      }
    } else {
      s.lock = true; s.combo = 0; a.sh = 0.4; c.sh = 0.4; hx.warn();
      later(() => { a.up = false; c.up = false; s.lock = false; force(); }, 650);
    }
    force();
  };
  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current; if (phase !== 'play') return;
      const rig = camRig(camOf(s.cfg.cols, s.rows));
      const [wx, wy] = rig.onZ(x, y, 0);
      const i = s.cards.findIndex((c, k) => { const [cx, cy] = cardPos(k, s.cfg.cols, s.rows); return Math.abs(wx - cx) < CW / 2 && Math.abs(wy - cy) < CH / 2; });
      if (i >= 0) flip(i);
    },
  });

  const s = g.current;
  const cam = camOf(s.cfg.cols, s.rows);
  const rig = camRig(cam);
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, -1], s: [30, 20, 1], c: '#0a0616' },
    { id: 'muro', k: 'box', p: [0, 6, -2.4], s: [40, 16, 0.2], c: '#120a2a', e: 0.04 },
    ...s.cards.map((c, i) => {
      const [cx, cy] = cardPos(i, s.cfg.cols, s.rows);
      const face = c.f > 0.5;
      const off = c.sh > 0 ? Math.sin(c.sh * 60) * 0.1 * (c.sh / 0.4) : 0;
      return { id: `carta${c.id}`, k: 'box', p: [cx + off, cy, 0], s: [CW, CH, 0.14], r: [0, c.f * Math.PI, 0], c: face ? c.c : BACK, e: c.matched ? 0.22 : face ? 0.1 : 0.04 };
    }),
  ];
  const scene = { bg: '#090516', fog: { c: '#090516', near: 14, far: 30 }, objs, cam };
  return (
    <GameScreen title="MEMORY MATCH" emoji="🃏" accent={C.violet} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: s.time < 8 ? C.red : C.text, fontWeight: '900', fontSize: 15 }}>⏱ {Math.ceil(s.time)}s</Text><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.violet, fontWeight: '800' }}>{s.lv}</Text> · Pares {s.matches}/{s.cfg.pairs}</Text><View style={{ minWidth: 70, alignItems: 'flex-end' }}>{s.combo > 1 ? <Combo n={s.combo} color={C.violet} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#090516" border={alpha(C.violet, 0.4)} {...pan}>
        <World3D scene={scene} />
        {s.cards.map((c, i) => {
          const [cx, cy] = cardPos(i, s.cfg.cols, s.rows);
          const p = rig.toScreen(cx, cy, 0.1);
          const fs = Math.max(12, Math.min(44, Math.round(p.s * CH * 0.5)));
          const face = c.f > 0.5;
          const txt = face ? c.e : '?';
          return (
            <Text key={c.id} pointerEvents="none" style={{ position: 'absolute', left: p.x - 40, top: p.y - fs * 0.6, width: 80, textAlign: 'center', fontSize: face ? fs : Math.round(fs * 0.7), fontWeight: '900', color: face ? C.text : alpha(C.violet, 0.6), opacity: Math.min(1, Math.abs(c.f - 0.5) * 4 + (face ? 0.5 : 0.5)) }}>{txt}</Text>
          );
        })}
        {s.peek && phase === 'play' && <Text pointerEvents="none" style={{ position: 'absolute', bottom: 16, width: AREA_W, textAlign: 'center', color: C.amber, fontWeight: '900', letterSpacing: 2 }}>¡MEMORIZA!</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🃏" title={phase === 'over' ? '¡SE ACABÓ EL TIEMPO!' : 'MEMORY MATCH 3D'}
          subtitle={phase === 'over' ? `Llegaste al nivel ${s.lv} · mejor racha ${s.maxCombo}` : 'Encuentra todos los pares'}
          score={s.score} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Al empezar verás las cartas un instante', 'Cada nivel tiene más pares y menos tiempo', 'Los pares seguidos multiplican los puntos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
