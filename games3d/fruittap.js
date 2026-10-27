import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Lives, Combo, Overlay, PlayArea, alpha, clamp, hx, pick, rand, randInt, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Frutas en 3D, TERCERA PERSONA: salen de una mesa, suben y caen. Desliza el dedo para cortarlas.
// El cursor 3D sigue el dedo en el espacio. Bomba = fin; hielo = cámara lenta; 3 frutas perdidas = fin.
const CAM = { p: [0, 2.6, 8.4], l: [0, 2.0, -3], fov: 60 };
const PIT_Y = -1.2, CUT_Z = -4, G = 17;
const FR = ['#ff4d6d', '#ff8a3d', '#ffe14d', '#7dff6b', '#9b6bff', '#ff3d7a', '#ffc233', '#a6ff4d'];
const BG = '#08120a';

// Vectores y proyección 3D -> píxeles del PlayArea (misma cámara que la escena)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const toScreen = (cam, P) => {
  const f = nrm(sub(cam.l, cam.p)); const r = nrm(cross(f, [0, 1, 0])); const u = cross(r, f);
  const d = sub(P, cam.p); const z = dot(d, f);
  const t = Math.tan((cam.fov * Math.PI) / 360) * z;
  return { x: AREA_W / 2 + (dot(d, r) / (t * (AREA_W / AREA_H))) * (AREA_W / 2), y: AREA_H / 2 - (dot(d, u) / t) * (AREA_H / 2), px: (AREA_H / 2) / t };
};
// Pixel del PlayArea -> punto del cursor en el plano z = z0 (el dedo "en el espacio")
const cursorAt = (cam, x, y, z0) => {
  const f = nrm(sub(cam.l, cam.p)); const r = nrm(cross(f, [0, 1, 0])); const u = cross(r, f);
  const t = Math.tan((cam.fov * Math.PI) / 360), a = AREA_W / AREA_H;
  const nx = (x / AREA_W) * 2 - 1, ny = 1 - (y / AREA_H) * 2;
  const d = [0, 1, 2].map(i => f[i] + r[i] * nx * t * a + u[i] * ny * t);
  const k = (z0 - cam.p[2]) / d[2];
  return [cam.p[0] + d[0] * k, cam.p[1] + d[1] * k];
};
const segHit = (ax, ay, bx, by, px, py, rad) => {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
  const t = clamp(l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0, 0, 1);
  return Math.hypot(ax + dx * t - px, ay + dy * t - py) < rad;
};

const initState = () => ({
  fruits: [], halves: [], trail: [], lives: 3, score: 0, t: 0, wave: 0.6, combo: 0, maxCombo: 0, sliced: 0,
  last: null, swipe: 0, freeze: 0, pt: null,
});

export function FruitTap3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('fruitslash');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const end = (s, why) => { hx.die(); setRes({ isNew: submitBest(s.score), why }); setPhase('over'); };

  const launch = s => {
    const bomb = Math.random() < Math.min(0.2, 0.08 + s.t * 0.002);
    const ice = !bomb && Math.random() > 0.95;
    const x = rand(-4.2, 4.2);
    s.fruits.push({
      id: uid(), x, y: PIT_Y, z: rand(-5.4, -2.8), vx: -x * rand(0.25, 0.5), vy: rand(12, 15),
      bomb, ice, c: bomb ? '#ff4d6d' : ice ? '#22e6ff' : pick(FR), r: 0.75, cut: false,
    });
  };
  const slice = (s, f) => {
    f.cut = true;
    const sc = toScreen(CAM, [f.x, f.y, f.z]);
    if (f.bomb) {
      fx.burst(sc.x, sc.y, C.red, 30, 320, 0.9, 6); fx.shake(14, 0.5); fx.flash(C.red, 0.5);
      s.lives = 0; end(s, 'bomba'); return;
    }
    if (f.ice) { s.freeze = 4; fx.flash(C.cyan, 0.3); fx.pop(sc.x, sc.y, 'CÁMARA LENTA', C.cyan, 16); hx.good(); }
    s.sliced += 1; s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo); s.swipe += 1;
    const pts = 1 + Math.floor(s.combo / 5);
    s.score += pts;
    fx.burst(sc.x, sc.y, f.c, 16, 230, 0.6, 5); fx.pop(sc.x, sc.y - 26, `+${pts}`, C.text, 15); hx.hit();
    s.halves.push({ id: uid(), x: f.x - 0.3, y: f.y, z: f.z, vx: -2.2, vy: f.vy * 0.3, c: f.c });
    s.halves.push({ id: uid(), x: f.x + 0.3, y: f.y, z: f.z, vx: 2.2, vy: f.vy * 0.3, c: f.c });
  };

  useLoop(phase === 'play', dt0 => {
    const s = g.current;
    if (s.freeze > 0) s.freeze -= dt0;
    const dt = dt0 * (s.freeze > 0 ? 0.5 : 1);
    s.t += dt0;
    s.wave -= dt;
    if (s.wave <= 0) {
      const n = Math.random() < 0.5 ? 1 : randInt(2, 3 + Math.floor(s.t / 40));
      for (let i = 0; i < n; i++) launch(s);
      s.wave = Math.max(0.55, 1.35 - s.t * 0.012);
    }
    s.fruits.forEach(f => { f.vy -= G * dt; f.x += f.vx * dt; f.y += f.vy * dt; });
    for (let i = s.fruits.length - 1; i >= 0; i--) {
      const f = s.fruits[i];
      if (f.cut) { s.fruits.splice(i, 1); continue; }
      if (f.vy < 0 && f.y < PIT_Y - 0.4) {
        s.fruits.splice(i, 1);
        if (!f.bomb && !f.ice) {
          s.lives -= 1; s.combo = 0;
          const sc = toScreen(CAM, [clamp(f.x, -3.5, 3.5), PIT_Y, f.z]);
          fx.pop(sc.x, AREA_H - 30, '✖', C.red, 26); fx.shake(5, 0.2); hx.bad();
          if (s.lives <= 0) { end(s, 'frutas'); return; }
        }
      }
    }
    s.halves.forEach(h => { h.vy -= G * dt; h.x += h.vx * dt; h.y += h.vy * dt; });
    s.halves = s.halves.filter(h => h.y > PIT_Y - 3);
    s.trail.forEach(p => { p.a -= dt0 * 3.2; }); s.trail = s.trail.filter(p => p.a > 0);
  });

  const pan = usePan(fx, {
    down: (x, y) => { const s = g.current; s.last = { x, y }; s.swipe = 0; s.pt = { x, y }; s.trail.push({ x, y, a: 1 }); },
    move: (x, y) => {
      const s = g.current;
      if (phase !== 'play' || !s.last) return;
      s.pt = { x, y };
      s.trail.push({ x, y, a: 1 }); if (s.trail.length > 16) s.trail.shift();
      for (const f of s.fruits) {
        if (f.cut) continue;
        const sc = toScreen(CAM, [f.x, f.y, f.z]);
        if (segHit(s.last.x, s.last.y, x, y, sc.x, sc.y, sc.px * f.r + 8)) { slice(s, f); if (phase !== 'play') return; }
      }
      s.last = { x, y };
    },
    up: () => {
      const s = g.current;
      if (s.swipe >= 3) { const b = s.swipe * 2; s.score += b; fx.pop(AREA_W / 2, AREA_H / 2, `¡${s.swipe} DE UN CORTE! +${b}`, C.amber, 20); hx.win(); }
      s.swipe = 0; s.last = null; s.pt = null;
    },
  });

  const s = g.current;
  const shakeK = fx.shakeT > 0 ? (fx.shakeT / fx.shakeDur) * fx.shakeMag * 0.04 : 0;
  const cam = { p: [CAM.p[0] + (Math.random() - 0.5) * shakeK, CAM.p[1], CAM.p[2]], l: CAM.l, fov: CAM.fov };
  const objs = [
    { id: 'mesa', k: 'pla', p: [0, PIT_Y, -3.5], s: [14, 9, 1], c: '#2a1c12' },
    { id: 'pared', k: 'box', p: [0, 3.5, -9], s: [14, 10, 0.4], c: '#0b0716', e: 0 },
    ...[0, 1, 2, 3, 4].map(i => ({ id: `ranura${i}`, k: 'box', p: [0, PIT_Y + 0.01, -7 + i * 1.6], s: [9, 0.02, 0.05], c: '#4a3424', e: 0.1 })),
    { id: 'poste-i', k: 'box', p: [-3.1, 2.5, -6], s: [0.15, 9, 0.15], c: C.lime, e: 0.5 },
    { id: 'poste-d', k: 'box', p: [3.1, 2.5, -6], s: [0.15, 9, 0.15], c: C.cyan, e: 0.5 },
  ];
  for (const f of s.fruits) {
    if (f.bomb) {
      objs.push({ id: f.id, k: 'sph', p: [f.x, f.y, f.z], n: 1.4, c: '#2a1030', e: 0.25 });
      objs.push({ id: `${f.id}f`, k: 'box', p: [f.x, f.y + 0.8, f.z], s: [0.14, 0.5, 0.14], c: C.red, e: 0.9 });
    } else if (f.ice) {
      objs.push({ id: f.id, k: 'box', p: [f.x, f.y, f.z], n: 1.2, c: '#22e6ff', e: 0.5 });
    } else {
      objs.push({ id: f.id, k: 'sph', p: [f.x, f.y, f.z], n: 1.5, c: f.c, e: 0.15 });
    }
  }
  for (const h of s.halves) objs.push({ id: `h${h.id}`, k: 'sph', p: [h.x, h.y, h.z], s: [0.9, 1.0, 1.0], c: h.c, e: 0.15 });
  const cur = s.pt ? cursorAt(cam, s.pt.x, s.pt.y, CUT_Z) : null;
  objs.push({ id: 'cursor', k: 'sph', p: cur ? [cur[0], cur[1], CUT_Z] : [0, -20, CUT_Z], n: 0.5, c: '#ffffff', e: 0.9 });
  const bg = s.freeze > 0 ? '#041419' : BG;
  const scene = { bg, fog: { c: bg, near: 14, far: 36 }, objs, cam };

  return (
    <GameScreen title="FRUIT SLASH" emoji="🍉" accent={C.lime} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} icon="🍎" off="✖️" /><Text style={{ color: C.cyan, fontSize: 12, fontWeight: '800' }}>{s.freeze > 0 ? `🧊 ${Math.ceil(s.freeze)}s` : ''}</Text><View style={{ minWidth: 70, alignItems: 'flex-end' }}>{s.combo > 2 ? <Combo n={s.combo} color={C.lime} /> : null}</View></>}>
      <PlayArea fx={fx} bg={bg} border={alpha(C.lime, 0.35)} {...pan}>
        <World3D scene={scene} />
        {s.trail.map((p, i) => <View key={i} pointerEvents="none" style={{ position: 'absolute', left: p.x - 5 * p.a, top: p.y - 5 * p.a, width: 10 * p.a, height: 10 * p.a, borderRadius: 6, backgroundColor: '#fff', opacity: p.a * 0.7 }} />)}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🍉" title={phase === 'over' ? (res.why === 'bomba' ? '¡BOOM!' : 'SE ESCAPARON') : 'FRUIT SLASH 3D'}
          subtitle={phase === 'over' ? `${s.sliced} frutas cortadas · mejor racha ${s.maxCombo}` : 'Corta frutas en el espacio, evita las bombas'}
          score={s.score} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Desliza el dedo sobre las frutas para cortarlas', 'Si se escapan 3 frutas, pierdes', '💣 termina la partida · 🧊 cámara lenta', 'Corta 3+ de un solo trazo para ganar bonus'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
