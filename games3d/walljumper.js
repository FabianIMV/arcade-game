/**
 * Wall Jumper 3D – rebota entre dos paredes 3D y sube. Cámara en tercera persona detrás del personaje.
 * La lógica (salto entre paredes, púas, minas, monedas, escudos, velocidad) es la del juego 2D;
 * las dimensiones se miden en px del diseño (AW3 × AH3) y se dibujan con 1 unidad = 40 px.
 */
import React, { useReducer, useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, alpha, hx, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

const WJ_AW = 390, WJ_AH = 540;   // medidas del diseño (px) usadas por la lógica
const WJ_SC = 40;                 // px por unidad 3D
const WJ_FOV = 70;
const WJ_PY_REF = WJ_AH * 0.68;
const wjX = px => (px - WJ_AW / 2) / WJ_SC;       // x del nivel 2D -> x 3D (centrado)
const wjY = py => (WJ_PY_REF - py) / WJ_SC;       // y del nivel 2D -> y 3D (el jugador está en y = 0)

const wjProj = (cam, x, y, z) => {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const m = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / m, a[1] / m, a[2] / m]; };
  const d = [x - cam.p[0], y - cam.p[1], z - cam.p[2]];
  const f = norm([cam.l[0] - cam.p[0], cam.l[1] - cam.p[1], cam.l[2] - cam.p[2]]);
  const r = norm(cross(f, [0, 1, 0])); const u = cross(r, f);
  const zc = dot(d, f); if (zc < 0.2) return null;
  const k = (AREA_H / 2) / Math.tan(WJ_FOV * Math.PI / 360) / zc;
  return [AREA_W / 2 + dot(d, r) * k, AREA_H / 2 - dot(d, u) * k];
};
// posición en pantalla de un punto del nivel 2D (para partículas y textos)
const wjScr = (s, px, py) => { const q = s && s.camObj && wjProj(s.camObj, wjX(px), wjY(py), 0); return q || [AREA_W / 2, AREA_H / 2]; };

// Objetos 3D de la escena: paredes, púas, minas, monedas, escudos, jugador y fondo que se desplaza
function wjObjects(s) {
  const objs = []; const PS = 26, WALL = 26; const PY = WJ_PY_REF;
  const LXc = wjX(WALL + PS / 2), RXc = wjX(WJ_AW - WALL - PS / 2);      // centros de las posiciones de reposo
  const wallInner = wjX(WALL), wallInnerR = wjX(WJ_AW - WALL);             // caras interiores
  // paredes (estáticas) y fondo
  objs.push({ id: 'pared-i', k: 'box', p: [wallInner - 0.33, 12, 0], s: [0.65, 60, 1.6], c: '#5a2a14', e: 0.12 });
  objs.push({ id: 'pared-d', k: 'box', p: [wallInnerR + 0.33, 12, 0], s: [0.65, 60, 1.6], c: '#5a2a14', e: 0.12 });
  objs.push({ id: 'fondo', k: 'box', p: [0, 12, -6], s: [16, 60, 0.4], c: '#1a0a06', e: 0.02 });
  // líneas del fondo que suben con la altura (sensación de subida)
  const off = (s.scroll / WJ_SC) % 2;
  for (let i = 0; i < 16; i++) objs.push({ id: `lin${i}`, k: 'box', p: [0, i * 2 - off - 2, -5.7], s: [9, 0.06, 0.1], c: C.orange, e: 0.6, o: 0.5 });
  // filas que bajan: púas, minas, monedas y escudos (solo las que están en pantalla)
  s.rows.forEach(r => {
    const y = wjY(r.y + (r.h || 30) / 2);
    if (y < -3 || y > 14 || r.dead) return;
    if (r.k === 'spike' || r.k === 'spike2') {
      const sides = r.k === 'spike2' ? [0, 1] : [r.side];
      sides.forEach(sd => {
        for (let i = 0; i < 3; i++) {
          const yy = wjY(r.y + i * 11 + 6);
          if (sd === 0) objs.push({ id: `sp${r.id}_${sd}_${i}`, k: 'cone', p: [wallInner + 0.28, yy, 0], s: [0.3, 0.55, 0.3], r: [0, 0, -Math.PI / 2], c: C.red, e: 0.5 });
          else objs.push({ id: `sp${r.id}_${sd}_${i}`, k: 'cone', p: [wallInnerR - 0.28, yy, 0], s: [0.3, 0.55, 0.3], r: [0, 0, Math.PI / 2], c: C.red, e: 0.5 });
        }
      });
    } else if (r.k === 'mine') objs.push({ id: `mi${r.id}`, k: 'sph', p: [wjX(r.mx), y, 0], n: 0.7, c: '#ff3b3b', e: 0.6 });
    else if (!r.got) {
      const sx = r.side === 0 ? wallInner + 0.4 : wallInnerR - 0.4;
      if (r.k === 'coins') objs.push({ id: `co${r.id}`, k: 'cyl', p: [sx, y, 0.2], s: [0.5, 0.1, 0.5], r: [Math.PI / 2, 0, 0], c: C.amber, e: 0.5 });
      else objs.push({ id: `sh${r.id}`, k: 'sph', p: [sx, y, 0.2], n: 0.45, c: C.cyan, e: 0.6 });
    }
  });
  // jugador: cubo que gira al saltar entre paredes; anillo cuando tiene escudo
  const px = s.x + PS / 2; const x3 = wjX(px);
  const ang = s.air > 0 ? (s.side === 1 ? 1 : -1) * s.air * 6.28 : 0;
  objs.push({ id: 'jug', k: 'box', p: [x3, -0.33, 0], s: [0.65, 0.65, 0.65], r: [0, 0, ang], c: C.orange, e: 0.4 });
  if (s.shield > 0) objs.push({ id: 'escudo', k: 'tor', p: [x3, -0.33, 0], n: 1.0, c: C.cyan, e: 0.8, o: 0.8 });
  return objs;
}

export function WallJumper3D({ onExit }) {
  const WALL = 26, PS = 26, PY = WJ_AH * 0.68;
  const LX = WALL, RX = WJ_AW - WALL - PS;       // x de reposo (pegado a cada pared)
  const fx = useFX();
  const fxw = {
    burst: (x, y, ...r) => { const q = wjScr(g.current, x, y); fx.burst(q[0], q[1], ...r); },
    pop: (x, y, ...r) => { const q = wjScr(g.current, x, y); fx.pop(q[0], q[1], ...r); },
    ring: (x, y, ...r) => { const q = wjScr(g.current, x, y); fx.ring(q[0], q[1], ...r); },
    shake: (...r) => fx.shake(...r), flash: (...r) => fx.flash(...r), clear: () => fx.clear(),
  };
  const [best, submitBest] = useBest('walljumper');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({ side: 0, x: LX, air: 0, from: LX, to: RX, t: 0, speed: 210, rows: [], next: 0.9, scroll: 0, score: 0, coins: 0, near: 0, shield: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fxw.clear(); g.current = initState(); setPhase('play'); };
  const jump = () => {
    const s = g.current;
    if (phase !== 'play' || s.air > 0) return;
    s.air = 0.0001; s.from = s.x; s.to = s.side === 0 ? RX : LX; s.side = s.side === 0 ? 1 : 0;
    fxw.burst(s.from + PS / 2, PY + PS / 2, C.orange, 6, 110, 0.35, 4); hx.tap();
  };
  const addRow = s => {
    const r = Math.random();
    const y = -40;
    if (r < 0.34) s.rows.push({ id: uid(), y, k: 'spike', side: Math.random() < 0.5 ? 0 : 1, h: 34 });
    else if (r < 0.58) s.rows.push({ id: uid(), y, k: 'spike2', side: 2, h: 34 });         // ambas paredes: hay que estar en el aire
    else if (r < 0.74) s.rows.push({ id: uid(), y, k: 'mine', side: 2, h: 30, mx: WJ_AW / 2 });   // mina al centro: hay que estar pegado
    else if (r < 0.9) s.rows.push({ id: uid(), y, k: 'coins', side: Math.random() < 0.5 ? 0 : 1, h: 30, got: false });
    else s.rows.push({ id: uid(), y, k: 'shield', side: Math.random() < 0.5 ? 0 : 1, h: 30, got: false });
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.speed = Math.min(430, 210 + s.t * 5);
    s.scroll += s.speed * dt;
    s.score = Math.floor(s.scroll / 12) + s.coins * 5 + s.near * 3;
    if (s.air > 0) {
      s.air += dt / 0.36;
      if (s.air >= 1) { s.air = 0; s.x = s.to; fxw.burst(s.x + PS / 2, PY + PS / 2, C.orange, 5, 90, 0.3, 3); }
      else { const k = s.air; const e = k * k * (3 - 2 * k); s.x = s.from + (s.to - s.from) * e; }
    }
    s.next -= dt;
    if (s.next <= 0) { addRow(s); s.next = Math.max(0.5, 1.15 - s.t * 0.01) * (210 / s.speed) + 0.28; }
    s.rows.forEach(r => { r.y += s.speed * dt; });
    s.rows = s.rows.filter(r => r.y < WJ_AH + 50);
    const cx = s.x + PS / 2;
    for (const r of s.rows) {
      if (r.dead) continue;
      const overlapY = r.y + r.h > PY + 4 && r.y < PY + PS - 4;
      if (!overlapY) { if (r.near === undefined && r.y > PY + PS && r.k !== 'coins' && r.k !== 'shield') { r.near = true; } continue; }
      let hurt = false;
      const midAir = s.air > 0.22 && s.air < 0.78;
      if (r.k === 'spike' && !midAir && s.side === r.side) hurt = true;
      if (r.k === 'spike2' && !midAir) hurt = true;
      if (r.k === 'mine' && midAir) hurt = true;
      if (hurt) {
        if (s.shield > 0) { s.shield -= 1; r.dead = true; fxw.ring(cx, PY, C.cyan, 60); fxw.burst(cx, PY, C.cyan, 14, 200); fxw.shake(5); hx.hit(); continue; }
        fxw.burst(cx, PY + PS / 2, C.orange, 26, 280, 0.8, 6); fxw.shake(11, 0.4); fxw.flash(C.red, 0.3); hx.die();
        setRes({ isNew: submitBest(s.score) });
        setPhase('over');
        return;
      }
      if ((r.k === 'coins' || r.k === 'shield') && !r.got && (s.side === r.side || s.air > 0.3 && s.air < 0.7)) {
        r.got = true;
        if (r.k === 'coins') { s.coins += 1; fxw.pop(cx, PY - 20, '+5', C.amber, 16); fxw.burst(cx, PY, C.amber, 10, 170); hx.good(); }
        else { s.shield = Math.min(2, s.shield + 1); fxw.pop(cx, PY - 20, 'ESCUDO', C.cyan, 15); fxw.ring(cx, PY, C.cyan, 50); hx.good(); }
      }
    }
  });

  const pan = usePan(fx, { down: jump });
  const s = g.current;
  // cámara en tercera persona: detrás del personaje, sigue su posición horizontal
  const cx3 = wjX(s.x + 13);
  const cam = { p: [cx3 * 0.25, 3.0, 12], l: [cx3 * 0.2, 0.6, 0], fov: WJ_FOV };
  s.camObj = cam;
  const scene = { bg: '#0b0504', fog: { c: '#0b0504', near: 14, far: 30 }, objs: wjObjects(s), cam };
  return (
    <GameScreen title="WALL JUMPER" emoji="🧗" accent={C.orange} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Monedas: <Text style={{ color: C.amber, fontWeight: '800' }}>{s.coins}</Text></Text><Text style={{ color: C.cyan, fontSize: 12, fontWeight: '800' }}>{s.shield > 0 ? `🛡️×${s.shield}` : ''}</Text><Text style={{ color: C.dim, fontSize: 12 }}>Altura {Math.floor(s.scroll / 12)}</Text></>}>
      <PlayArea fx={fx} bg="#0b0504" {...pan}>
        <World3D scene={scene} />
        <Overlay show={phase !== 'play'} kind={phase} emoji="🧗" title={phase === 'over' ? 'TE PINCHASTE' : 'WALL JUMPER 3D'}
          subtitle={phase === 'over' ? `Altura ${Math.floor(s.scroll / 12)}` : 'Salta de pared en pared'}
          score={s.score} best={best} isNew={res.isNew} accent={C.orange} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca para saltar a la pared contraria', 'Púas en una pared: cambia de lado', 'Púas en ambas: salta justo cuando pasan', '💣 en el centro: quédate pegado a la pared'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
