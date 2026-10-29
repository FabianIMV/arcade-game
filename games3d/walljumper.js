/**
 * WALL JUMPER 3D – rebota entre dos paredes de un pozo y sube. Cámara en tercera persona detrás del personaje.
 * La lógica (salto entre paredes, púas, mina central, monedas y escudos) es la del juego 2D; las medidas se
 * dan en px del diseño (WJ_AW × WJ_AH) y se dibujan con 1 unidad = WJ_SC px.
 */
import React, { useRef, useState } from 'react';
import { C, SCREEN_H, SCREEN_W, hx, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { person } from '../utils/prefabs';

const WJ_AW = 390, WJ_AH = 540;   // medidas del diseño (px) usadas por la lógica
const WJ_SC = 40;                 // px por unidad 3D
const WJ_PY_REF = WJ_AH * 0.68;   // altura de la línea del jugador (px del diseño)
const WALL = 26, PS = 26;         // grosor de pared y tamaño del jugador (px)
const LX = WALL, RX = WJ_AW - WALL - PS;   // x de reposo (pegado a cada pared)
const PI = Math.PI;
const wjX = px => (px - WJ_AW / 2) / WJ_SC;       // x del nivel 2D -> x 3D (centrado)
const wjY = py => (WJ_PY_REF - py) / WJ_SC;       // y del nivel 2D -> y 3D (el jugador está en y ≈ −0.33)
const P3 = (px, py) => [wjX(px), wjY(py), 0];

// Centro del personaje → punto de los pies, para una persona con yaw = π girada `a` alrededor de Z (volteretas
// alrededor de su centro). Con yaw π el desplazamiento de los pies en X se invierte.
const feetFor = (cx, cy, d, a) => [cx - Math.sin(a) * d, cy - Math.cos(a) * d];

const initState = () => ({ side: 0, x: LX, air: 0, from: LX, to: RX, t: 0, speed: 210, rows: [], next: 0.9, scroll: 0, score: 0, coins: 0, shield: 0 });

// Filas que bajan: púas, minas, monedas y escudos
const addRow = s => {
  const r = Math.random();
  const y = -40;
  if (r < 0.34) s.rows.push({ id: uid(), y, k: 'spike', side: Math.random() < 0.5 ? 0 : 1, h: 34 });
  else if (r < 0.58) s.rows.push({ id: uid(), y, k: 'spike2', side: 2, h: 34 });         // ambas paredes: hay que estar en el aire
  else if (r < 0.74) s.rows.push({ id: uid(), y, k: 'mine', side: 2, h: 30, mx: WJ_AW / 2 });   // mina al centro: hay que estar pegado
  else if (r < 0.9) s.rows.push({ id: uid(), y, k: 'coins', side: Math.random() < 0.5 ? 0 : 1, h: 30, got: false });
  else s.rows.push({ id: uid(), y, k: 'shield', side: Math.random() < 0.5 ? 0 : 1, h: 30, got: false });
};

// Escena 3D: pozo de paredes con ladrillos que bajan, púas, minas, monedas, escudos y el personaje
function wjObjects(s, t) {
  const objs = []; const PS3 = 26; const PY = WJ_PY_REF;
  const wallInner = wjX(WALL), wallInnerR = wjX(WJ_AW - WALL);   // caras interiores
  const zNear = 2, zFar = -20, depth = zNear - zFar, zMid = (zNear + zFar) / 2;
  const scrollU = (s.scroll / WJ_SC) % 1;
  // paredes (cuerpo) y fondo
  objs.push({ id: 'pared-i', k: 'box', p: [wallInner - 0.33, 12, zMid], s: [0.65, 60, depth], c: '#4a2212', e: 0.04 });
  objs.push({ id: 'pared-d', k: 'box', p: [wallInnerR + 0.33, 12, zMid], s: [0.65, 60, depth], c: '#4a2212', e: 0.04 });
  objs.push({ id: 'fondo', k: 'box', p: [0, 12, -20], s: [16, 60, 0.4], c: '#2a120a', e: 0.12 });
  // ladrillos en las caras interiores (inst): filas que bajan con la subida
  for (let r = -6; r < 14; r++) {
    const y = r - scrollU + 0.5;
    for (let k = 0; k < 10; k++) {
      const z = zNear - 1.1 - k * 2 - (r & 1 ? 1 : 0);
      if (z < zFar) continue;
      const c = (r + k) % 3 ? '#6b2e16' : '#82391a';
      objs.push({ k: 'box', inst: 'ladrillo', p: [wallInner + 0.012, y, z], s: [0.03, 0.9, 1.9], c, e: 0.05 });
      objs.push({ k: 'box', inst: 'ladrillo', p: [wallInnerR - 0.012, y, z], s: [0.03, 0.9, 1.9], c, e: 0.05 });
    }
  }
  // líneas de neón del fondo que suben con la altura
  const off = (s.scroll / WJ_SC) % 2;
  for (let i = 0; i < 16; i++) objs.push({ k: 'box', inst: 'linea', p: [0, i * 2 - off - 2, -19.7], s: [9, 0.06, 0.1], c: C.orange, e: 0.8 });
  // filas: púas, minas, monedas y escudos (solo las que están en pantalla)
  s.rows.forEach(r => {
    const y = wjY(r.y + (r.h || 30) / 2);
    if (y < -3 || y > 14 || r.dead) return;
    if (r.k === 'spike' || r.k === 'spike2') {
      const sides = r.k === 'spike2' ? [0, 1] : [r.side];
      sides.forEach(sd => {
        for (let i = 0; i < 3; i++) {
          const yy = wjY(r.y + i * 11 + 6);
          if (sd === 0) objs.push({ k: 'cone', inst: 'pincho', p: [wallInner + 0.28, yy, 0], s: [0.3, 0.55, 0.3], r: [0, 0, -PI / 2], c: C.red, e: 0.6 });
          else objs.push({ k: 'cone', inst: 'pincho', p: [wallInnerR - 0.28, yy, 0], s: [0.3, 0.55, 0.3], r: [0, 0, PI / 2], c: C.red, e: 0.6 });
        }
      });
    } else if (r.k === 'mine') objs.push({ id: `mi${r.id}`, k: 'ico', p: [wjX(r.mx), y, 0], n: 0.7, c: '#ff3b3b', e: 0.7 });
    else if (!r.got) {
      const sx = r.side === 0 ? wallInner + 0.4 : wallInnerR - 0.4;
      if (r.k === 'coins') objs.push({ k: 'cyl', inst: 'moneda', p: [sx, y, 0.2], s: [0.5, 0.1, 0.5], r: [PI / 2, 0, 0], c: C.amber, e: 0.6 });
      else objs.push({ k: 'sph', inst: 'escudo', p: [sx, y, 0.2], n: 0.45, c: C.cyan, e: 0.8 });
    }
  });
  // personaje: persona que da volteretas al saltar entre paredes (gira alrededor de su centro)
  const x3 = wjX(s.x + PS3 / 2);
  const ang = s.air > 0 ? (s.side === 1 ? 1 : -1) * s.air * 2 * PI : 0;
  const n = 0.42, d = 0.875 * n;
  const [fx3, fy3] = feetFor(x3, -0.33, d, ang);
  objs.push(...person('yo', [fx3, fy3, 0], { yaw: PI, roll: ang, n, t, walk: s.air > 0 ? 0.6 : 0, hat: 'helmet', band: '#ff8a3d', shirt: '#ff8a3d', pants: '#2a1410', skin: '#f0c09a', hair: '#2a1a10', arms: s.air > 0 ? 2.8 : 1.4 }));
  if (s.shield > 0) objs.push({ id: 'escudo', k: 'tor', p: [x3, -0.33, 0], n: 0.95, c: C.cyan, e: 0.8, o: 0.8 });
  return objs;
}

export function WallJumper3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('walljumper');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const jump = () => {
    const s = g.current;
    if (phase !== 'play' || s.air > 0) return;
    s.air = 0.0001; s.from = s.x; s.to = s.side === 0 ? RX : LX; s.side = s.side === 0 ? 1 : 0;
    burst3d(P3(s.from + PS / 2, WJ_PY_REF + PS / 2), C.orange, 6, { speed: 3, life: 0.35, size: 0.12, g: 4 });
    hx.tap();
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.speed = Math.min(430, 210 + s.t * 5);
    s.scroll += s.speed * dt;
    s.score = Math.floor(s.scroll / 12) + s.coins * 5;
    if (s.air > 0) {
      s.air += dt / 0.36;
      if (s.air >= 1) { s.air = 0; s.x = s.to; burst3d(P3(s.x + PS / 2, WJ_PY_REF + PS / 2), C.orange, 5, { speed: 2.5, life: 0.3, size: 0.12, g: 4 }); }
      else { const k = s.air; const e = k * k * (3 - 2 * k); s.x = s.from + (s.to - s.from) * e; }
    }
    s.next -= dt;
    if (s.next <= 0) { addRow(s); s.next = Math.max(0.5, 1.15 - s.t * 0.01) * (210 / s.speed) + 0.28; }
    s.rows.forEach(r => { r.y += s.speed * dt; });
    s.rows = s.rows.filter(r => r.y < WJ_AH + 50);
    const PY = WJ_PY_REF;
    const cx = s.x + PS / 2;
    for (const r of s.rows) {
      if (r.dead) continue;
      const overlapY = r.y + r.h > PY + 4 && r.y < PY + PS - 4;
      if (!overlapY) continue;
      let hurt = false;
      const midAir = s.air > 0.22 && s.air < 0.78;
      if (r.k === 'spike' && !midAir && s.side === r.side) hurt = true;
      if (r.k === 'spike2' && !midAir) hurt = true;
      if (r.k === 'mine' && midAir) hurt = true;
      if (hurt) {
        if (s.shield > 0) { s.shield -= 1; r.dead = true; ring3d(P3(cx, PY), C.cyan, 22, { speed: 6, life: 0.5 }); burst3d(P3(cx, PY), C.cyan, 14, { speed: 5, life: 0.6, size: 0.16 }); fx.shake(5); hx.hit(); continue; }
        burst3d(P3(cx, PY + PS / 2), [C.orange, '#ff3b3b', '#ffffff'], 30, { speed: 6, up: 2, g: 9, size: 0.18, life: 0.9 });
        fx.shake(11, 0.4); fx.flash(C.red, 0.3); hx.die();
        setRes({ isNew: submitBest(s.score) });
        setPhase('over');
        return;
      }
      if ((r.k === 'coins' || r.k === 'shield') && !r.got && (s.side === r.side || s.air > 0.3 && s.air < 0.7)) {
        r.got = true;
        if (r.k === 'coins') { s.coins += 1; burst3d(P3(cx, PY), C.amber, 12, { speed: 4, life: 0.6, size: 0.16 }); hx.good(); }
        else { s.shield = Math.min(2, s.shield + 1); ring3d(P3(cx, PY), C.cyan, 20, { speed: 5, life: 0.6 }); hx.good(); fx.pop(SCREEN_W / 2, SCREEN_H * 0.4, 'ESCUDO', C.cyan, 15); }
      }
    }
    s.score = Math.floor(s.scroll / 12) + s.coins * 5;
  });

  const pan = usePan(fx, { down: jump });
  const s = g.current;
  // cámara en tercera persona: detrás del personaje, sigue su posición horizontal
  const cx3 = wjX(s.x + 13);
  const cam = { p: [cx3 * 0.25, 3.0, 13], l: [cx3 * 0.2, 0.6, 0], fov: 70 };
  const scene = {
    bg: '#0b0504', fog: { c: '#1a0c08', near: 16, far: 52 }, objs: wjObjects(s, s.t), cam,
    lights: [{ p: [cx3 * 0.8, -0.2, 2.6], c: '#ff8a3d', i: 6, d: 9 }],
  };
  const altura = Math.floor(s.scroll / 12);
  return (
    <Game3D title="WALL JUMPER" emoji="🧗" accent={C.orange} onExit={onExit} score={s.score} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene} menuScene={t => ({ ...scene, objs: wjObjects({ ...g.current, scroll: t * 60, rows: [] }, t) })}
      orbit={{ c: [0, 0.4, 0], r: 6.5, h: 2.2, speed: 0.2, ly: 1.2, drop: 2.6 }}
      hud={<><HudPill icon="🪙" value={s.coins} color={C.amber} />{s.shield > 0 ? <HudPill icon="🛡️" value={`×${s.shield}`} color={C.cyan} /> : null}<HudPill icon="⬆" value={`${altura} m`} color={C.orange} /></>}
      subtitle="Salta de pared en pared"
      lines={['Toca para saltar a la pared contraria', 'Púas en una pared: cambia de lado', 'Púas en ambas: salta justo cuando pasan', '💣 en el centro: quédate pegado a la pared']}
      result={{ isNew: res.isNew, title: 'TE PINCHASTE', emoji: '🧗', subtitle: `Altura ${altura}`, stats: [['ALTURA', altura], ['MONEDAS', s.coins]] }}>
    </Game3D>
  );
}
