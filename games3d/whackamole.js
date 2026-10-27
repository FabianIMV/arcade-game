import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Combo, Overlay, PlayArea, alpha, hx, pick, rand, useBest, useFX, useLoop, usePan, tglow } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Campo 3D en TERCERA PERSONA: 9 agujeros en el suelo, cámara detrás y encima del martillo.
// Topos (marrón), oro (amarillo, vale 5), casco (gris, 2 golpes), bomba (-4s) y reloj (+3s).
const DUR = 45, HIT_R = 1.15, HM_T = 0.2;
const HOLE_X = [-2.1, 0, 2.1], HOLE_Z = [-6.2, -3.4, -0.6];
const HOLES = HOLE_Z.flatMap(z => HOLE_X.map(x => [x, z]));
const CAM = { p: [0, 6.4, 8.2], l: [0, 0, -3.2], fov: 58 };
const IDLE = [0, 2.4, 4.4];
const BODY_C = { mole: '#b8794a', gold: '#ffc233', helmet: '#8e98bf', bomb: '#1e1b2e', clock: '#7dff6b' };

// Proyección 3D -> píxeles del PlayArea (misma cámara que la escena)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const toScreen = (cam, P) => {
  const f = nrm(sub(cam.l, cam.p)); const r = nrm(cross(f, [0, 1, 0])); const u = cross(r, f);
  const d = sub(P, cam.p); const z = dot(d, f);
  const t = Math.tan((cam.fov * Math.PI) / 360) * z;
  return { x: AREA_W / 2 + (dot(d, r) / (t * (AREA_W / AREA_H))) * (AREA_W / 2), y: AREA_H / 2 - (dot(d, u) / t) * (AREA_H / 2) };
};
// Pixel del PlayArea -> punto en el suelo (y = 0) con el mismo rayo de la cámara
const toGround = (cam, x, y) => {
  const f = nrm(sub(cam.l, cam.p)); const r = nrm(cross(f, [0, 1, 0])); const u = cross(r, f);
  const t = Math.tan((cam.fov * Math.PI) / 360); const a = AREA_W / AREA_H;
  const nx = (x / AREA_W) * 2 - 1, ny = 1 - (y / AREA_H) * 2;
  const d = [0, 1, 2].map(i => f[i] + r[i] * nx * t * a + u[i] * ny * t);
  if (d[1] > -1e-3) return null;
  const k = -cam.p[1] / d[1];
  return [cam.p[0] + d[0] * k, cam.p[2] + d[2] * k];
};

const initState = () => ({ holes: Array.from({ length: 9 }, () => null), time: DUR, t: 0, score: 0, combo: 0, maxCombo: 0, spawn: 0.5, hits: 0, hm: null, hx: IDLE[0], hz: IDLE[2] });

export function WhackAMole3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('whack');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const spawn = s => {
    const free = s.holes.map((h, i) => (h ? -1 : i)).filter(i => i >= 0);
    if (!free.length) return;
    const i = pick(free);
    const r = Math.random();
    const type = r < 0.62 ? 'mole' : r < 0.74 ? 'gold' : r < 0.84 ? 'helmet' : r < 0.94 ? 'bomb' : 'clock';
    const life = Math.max(0.55, 1.5 - s.t * 0.018) * (type === 'gold' ? 0.7 : 1);
    s.holes[i] = { type, age: 0, life, hp: type === 'helmet' ? 2 : 1, hit: 0 };
  };
  const whack = (x, y) => {
    const s = g.current;
    if (phase !== 'play') return;
    const gp = toGround(CAM, x, y);
    let target = -1, bd = 1e9;
    if (gp) HOLES.forEach(([hx_, hz], i) => { const h = s.holes[i]; if (!h || h.hit) return; const d = Math.hypot(hx_ - gp[0], hz - gp[1]); if (d < HIT_R && d < bd) { bd = d; target = i; } });
    // el martillo cae en el agujero si lo hay, o en el punto tocado
    const sx = target >= 0 ? HOLES[target][0] : gp ? gp[0] : IDLE[0];
    const sz = target >= 0 ? HOLES[target][1] : gp ? gp[1] : IDLE[2];
    s.hm = { t: HM_T }; s.hx = sx; s.hz = sz;
    if (target < 0) { if (s.combo > 0) s.combo = 0; hx.tick(); return; }
    const h = s.holes[target];
    const pp = toScreen(CAM, [sx, 1.0, sz]);
    h.hp -= 1;
    if (h.type === 'bomb') {
      h.hit = 0.3; s.combo = 0; s.time = Math.max(0, s.time - 4);
      fx.burst(pp.x, pp.y, C.red, 22, 260); fx.shake(9, 0.3); fx.flash(C.red, 0.3); fx.pop(pp.x, pp.y - 30, '-4s', C.red, 22); hx.bad();
    } else if (h.type === 'clock') {
      h.hit = 0.3; s.time += 3; fx.burst(pp.x, pp.y, C.lime, 12, 190); fx.pop(pp.x, pp.y - 30, '+3s', C.lime, 22); hx.good();
    } else if (h.hp > 0) {
      fx.burst(pp.x, pp.y - 10, '#fff', 6, 140, 0.3, 3); fx.shake(3, 0.15); hx.hit();
    } else {
      h.hit = 0.3; s.hits += 1; s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
      const base = h.type === 'gold' ? 5 : h.type === 'helmet' ? 3 : 1;
      const mult = 1 + Math.floor(s.combo / 5);
      const pts = base * mult; s.score += pts;
      fx.burst(pp.x, pp.y - 10, h.type === 'gold' ? C.amber : C.orange, 12, 200, 0.5, 4); fx.pop(pp.x, pp.y - 40, `+${pts}`, mult > 1 ? C.amber : C.text, 18); fx.ring(pp.x, pp.y, C.orange, 44); hx.heavy();
    }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt; s.time -= dt;
    if (s.hm) { s.hm.t -= dt; if (s.hm.t <= 0) s.hm = null; }
    s.spawn -= dt;
    if (s.spawn <= 0) { spawn(s); if (s.t > 18 && Math.random() < 0.4) spawn(s); s.spawn = Math.max(0.28, 0.85 - s.t * 0.014) * rand(0.7, 1.2); }
    s.holes.forEach((h, i) => {
      if (!h) return;
      h.age += dt;
      if (h.hit > 0) { h.hit -= dt; if (h.hit <= 0) s.holes[i] = null; return; }
      if (h.age >= h.life) { if (h.type === 'mole' || h.type === 'gold' || h.type === 'helmet') s.combo = 0; s.holes[i] = null; }
    });
    if (s.time <= 0) { s.time = 0; hx.win(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  });

  const pan = usePan(fx, { down: (x, y) => whack(x, y) });
  const s = g.current;
  const mult = 1 + Math.floor(s.combo / 5);
  const shakeK = fx.shakeT > 0 ? (fx.shakeT / fx.shakeDur) * fx.shakeMag * 0.04 : 0;
  const cam = { p: [CAM.p[0] + (Math.random() - 0.5) * shakeK, CAM.p[1], CAM.p[2]], l: CAM.l, fov: CAM.fov };

  // Agujeros, topos y extras (ids estables: 0..8). Los vacíos quedan bajo el suelo.
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, -3.2], s: [9.5, 14, 1], c: '#1b1030' },
    ...[0, 1, 2, 3, 4].map(j => ({ id: `gz${j}`, k: 'box', p: [0, 0.01, -7.6 + j * 1.6], s: [9.5, 0.02, 0.03], c: C.violet, e: 0.4, o: 0.35 })),
    ...[0, 1, 2, 3, 4, 5].map(i => ({ id: `gx${i}`, k: 'box', p: [-4.25 + i * 1.7, 0.01, -3.2], s: [0.03, 0.02, 14], c: C.violet, e: 0.4, o: 0.35 })),
  ];
  for (let i = 0; i < 9; i++) {
    const [x, z] = HOLES[i];
    const h = s.holes[i];
    const k = h ? (h.hit > 0 ? 0 : Math.min(1, h.age * 7) * (h.age > h.life - 0.15 ? Math.max(0, (h.life - h.age) / 0.15) : 1)) : 0;
    const by = h ? -0.55 + 1.05 * k : -3;
    objs.push({ id: `d${i}`, k: 'cyl', p: [x, 0.03, z], s: [1.5, 0.06, 1.5], c: '#05030c' });
    objs.push({ id: `b${i}`, k: 'sph', p: [x, by, z], n: h && h.type === 'helmet' ? 1.0 : 0.95, c: h ? (h.hit > 0 && h.type !== 'bomb' ? '#ffffff' : BODY_C[h.type]) : '#000', e: h && h.type === 'bomb' ? 0.25 : 0.1 });
    if (h && h.type === 'helmet') objs.push({ id: `x${i}`, k: 'box', p: [x, by + 0.42, z], s: [1.0, 0.4, 1.0], c: '#c8d2ff', e: 0.2 });
    else if (h && h.type === 'bomb') objs.push({ id: `x${i}`, k: 'box', p: [x, by + 0.55, z], s: [0.1, 0.5, 0.1], c: C.orange, e: 0.8 });
    else if (h && h.type === 'clock') objs.push({ id: `x${i}`, k: 'tor', p: [x, by + 0.52, z], r: [Math.PI / 2, 0, 0], n: 1.0, c: '#ffffff', e: 0.6 });
    else objs.push({ id: `x${i}`, k: 'box', p: [x, -3, z], s: [0.1, 0.1, 0.1], c: '#000' });
  }
  // Martillo: cabeza + mango. En reposo flota delante; al golpear cae sobre el agujero/punto tocado.
  const hd = s.hm ? [s.hx, 0.4 + 2.4 * (s.hm.t / HM_T), s.hz] : IDLE;
  objs.push({ id: 'mango', k: 'box', p: [hd[0], hd[1] + 0.8, hd[2]], s: [0.18, 1.6, 0.18], c: '#c9a46a' });
  objs.push({ id: 'cabeza', k: 'box', p: hd, s: [0.95, 0.5, 0.5], c: '#e6e6ff', e: 0.25 });
  const scene = { bg: '#0a0616', fog: { c: '#0a0616', near: 14, far: 32 }, objs, cam };

  return (
    <GameScreen title="WHACK-A-MOLE" emoji="🐹" accent={C.violet} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: s.time < 8 ? C.red : C.text, fontWeight: '900', fontSize: 15 }}>⏱ {Math.ceil(s.time)}s</Text><Text style={{ color: C.dim, fontSize: 12 }}>Racha <Text style={{ color: C.violet, fontWeight: '800' }}>{s.combo}</Text></Text><View style={{ minWidth: 64, alignItems: 'flex-end' }}>{mult > 1 ? <Combo n={mult} color={C.violet} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#0a0616" border={alpha(C.violet, 0.4)} {...pan}>
        <World3D scene={scene} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 10, alignItems: 'center' }}>
          <Text style={{ color: C.dim, fontSize: 10, fontWeight: '800', textAlign: 'center' }}>🟤 topo 1 · 🟡 oro 5 · ⚪ casco ×2 · ⏱ +3s · 💣 -4s</Text>
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🐹" title={phase === 'over' ? '¡TIEMPO!' : 'WHACK-A-MOLE 3D'}
          subtitle={phase === 'over' ? `${s.hits} topos · mejor racha ${s.maxCombo}` : '45 segundos de caos'}
          score={s.score} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca un agujero para golpear el topo que asoma', '🟡 oro vale 5 · ⚪ casco: 2 golpes · ⏱ +3s', '💣 resta 4s · fallar rompe la racha'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
