/**
 * Pixel Craft 3D – minar y construir con bloques voxel, en primera persona.
 * El mundo es una sección de 128×64 bloques (la misma generación) extruida en profundidad:
 * la cámara está en los ojos del jugador y mira hacia la pared de bloques del fondo, que es la
 * superficie donde se mina y se coloca. Tocar un bloque lo mina; mantener pulsado lo mina poco a poco.
 */
import React, { useReducer, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AREA_H, AREA_W, C, Btn, GameScreen, Overlay, PlayArea, TouchBtn, alpha, clamp, hx, rand, uid, tglow, useBest, useFX, useLoop, useTimeouts, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

const PC_FOV = 74;
const PC_WALL = 0;            // z de la cara frontal de la sección: la superficie de minado (mira la cámara)
const PC_DEPTH = 10;         // profundidad de la sección hacia atrás (z negativa)
const PC_CAM_Z = 6;          // la cámara está delante de la superficie

const pcCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const pcNorm = a => { const m = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / m, a[1] / m, a[2] / m]; };
const pcDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// cámara en los ojos del jugador (mira hacia la pared, un poco hacia abajo)
const pcCam = s => {
  const p = s.p; const ex = p.x + 0.39, ey = PC_H - p.y - 0.35;
  return { p: [ex, ey, PC_CAM_Z], l: [ex + 0.02, ey - 1.1, PC_WALL - 2], fov: PC_FOV };
};
// ¿qué celda de la pared hay bajo el punto de la pantalla (px, py)?
const pcPick = (s, px, py) => {
  const cam = s.camObj || pcCam(s);
  const f = pcNorm([cam.l[0] - cam.p[0], cam.l[1] - cam.p[1], cam.l[2] - cam.p[2]]);
  const r = pcNorm(pcCross(f, [0, 1, 0])); const u = pcCross(r, f);
  const focal = (AREA_H / 2) / Math.tan(PC_FOV * Math.PI / 360);
  const dx = (px - AREA_W / 2) / focal, dy = (AREA_H / 2 - py) / focal;
  const d = [f[0] + r[0] * dx + u[0] * dy, f[1] + r[1] * dx + u[1] * dy, f[2] + r[2] * dx + u[2] * dy];
  const t = (PC_WALL - cam.p[2]) / d[2];
  const X = cam.p[0] + d[0] * t, Y = cam.p[1] + d[1] * t;
  return [Math.floor(X), Math.floor(PC_H - Y)];
};
// proyecta una celda (x, fila) de la pared a píxeles de pantalla
const pcAt = (s, x, y) => {
  const cam = s.camObj || pcCam(s);
  const wx = x + 0.5, wy = PC_H - y - 0.5, wz = PC_WALL;
  const d = [wx - cam.p[0], wy - cam.p[1], wz - cam.p[2]];
  const f = pcNorm([cam.l[0] - cam.p[0], cam.l[1] - cam.p[1], cam.l[2] - cam.p[2]]);
  const r = pcNorm(pcCross(f, [0, 1, 0])); const u = pcCross(r, f);
  const zc = pcDot(d, f); if (zc < 0.2) return [AREA_W / 2, AREA_H / 2];
  const k = (AREA_H / 2) / Math.tan(PC_FOV * Math.PI / 360) / zc;
  return [AREA_W / 2 + pcDot(d, r) * k, AREA_H / 2 - pcDot(d, u) * k];
};
const pcHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// Objetos 3D: bloques visibles (ventana alrededor del jugador), antorchas, lava, zombis y marca de minado
function pcObjects(s, cam) {
  const objs = []; const p = s.p; const ex = p.x + 0.39; const ey = PC_H - p.y - 0.35;
  const x0 = Math.max(0, Math.floor(ex) - 10), x1 = Math.min(PC_W - 1, Math.floor(ex) + 10);
  const y0 = Math.max(0, Math.floor(PC_H - (ey + 8))), y1 = Math.min(PC_H - 1, Math.ceil(PC_H - (ey - 8)));
  const depth = PC_DEPTH;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = s.rows[y][x]; if (!t) continue;
    const wy = PC_H - y - 0.5;
    if (t === 14) { objs.push({ id: `t${x}_${y}`, k: 'box', p: [x + 0.5, wy, PC_WALL + 0.25], s: [0.22, 0.6, 0.22], c: '#ffd24d', e: 1 }); continue; }
    if (t === 15) { objs.push({ id: `b${x}_${y}`, k: 'box', p: [x + 0.5, wy, PC_WALL - depth / 2], s: [1, 1, depth], c: '#ff5a1a', e: 0.9 }); continue; }
    const d = PC_BLK[t];
    objs.push({ id: `b${x}_${y}`, k: 'box', p: [x + 0.5, wy, PC_WALL - depth / 2], s: [1, 1, depth], c: d[0], e: 0.05 });
  }
  // marca del bloque que se está minando (o que se apunta)
  if (s.hold) objs.push({ id: 'marca', k: 'box', p: [s.hold.wx + 0.5, PC_H - s.hold.wy - 0.5, PC_WALL + 0.06], s: [1.02, 1.02, 0.1], c: '#ffffff', e: 0.6, o: 0.35 });
  // zombis (en la sección, un poco delante de la pared)
  s.zombies.forEach(z => {
    const bx = z.x + 0.4, by = PC_H - z.y - 0.9; const blink = s.p.inv > 0 && Math.floor(s.p.inv * 12) % 2 ? 0.35 : 1;
    objs.push({ id: `z${z.id}b`, k: 'box', p: [bx, by, 1.6], s: [0.6, 0.9, 0.5], c: '#6fbf5a', e: 0.1, o: blink });
    objs.push({ id: `z${z.id}h`, k: 'sph', p: [bx, by + 0.7, 1.6], n: 0.5, c: '#7fd66a', e: 0.1, o: blink });
  });
  // herramienta en la mano
  objs.push({ id: 'mano', k: 'box', p: [ex + 0.5, ey - 0.85, PC_CAM_Z - 1.6], s: [0.2, 0.2, 0.55], c: '#c9a46a', e: 0.05 });
  return objs;
}

function PcPad({ testID, label, color, big, onDown, onUp }) {
  const d = big ? 74 : 62;
  return (
    <TouchBtn testID={testID} onDown={onDown} onUp={onUp} style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: alpha(color, 0.18), borderWidth: 2, borderColor: alpha(color, 0.8), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontSize: big ? 30 : 24, fontWeight: '900' }}>{label}</Text>
    </TouchBtn>
  );
}

// Generador de números pseudoaleatorios (semilla) para el mundo
function rpgRng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const PC_W = 128;
const PC_H = 64;
// id: [color, borde, dureza(s), nivel de pico, drop, nombre]
const PC_BLK = {
  1: ['#3aa23a', '#1f6b1f', 0.7, 0, 2, 'Césped'], 2: ['#8a5226', '#5e3516', 0.7, 0, 2, 'Tierra'], 3: ['#7d7d86', '#55555d', 2.6, 1, 3, 'Piedra'],
  4: ['#1b1b22', '#0a0a10', 0, 99, 0, 'Lecho'], 5: ['#4a4a52', '#2c2c32', 3.2, 1, 5, 'Carbón'], 6: ['#b8a080', '#8c7456', 4.2, 2, 6, 'Hierro'],
  7: ['#e6b422', '#a8800e', 5, 3, 7, 'Oro'], 8: ['#2ad4e6', '#0f9eb0', 6, 3, 8, 'Diamante'], 9: ['#7a4e22', '#523216', 1.6, 0, 9, 'Madera'],
  10: ['#2f8a34', '#1d5e22', 0.35, 0, 0, 'Hojas'], 11: ['#e0cb7a', '#b49d4a', 0.5, 0, 11, 'Arena'], 12: ['#eef4ff', '#bccae0', 0.5, 0, 12, 'Nieve'],
  13: ['#c08c52', '#8c6030', 1.0, 0, 13, 'Tablones'], 14: ['#ffd24d', '#ff9a1a', 0.05, 0, 14, 'Antorcha'], 15: ['#ff5a1a', '#c02a00', 0, 99, 0, 'Lava'],
};
const PC_DOT = { 5: '#111', 6: '#e8c8a0', 7: '#ffe066', 8: '#9ffcff' };
const PC_VALUE = { 5: 3, 6: 6, 7: 12, 8: 30 };
const PC_SPEED = [1, 2, 3.2, 4.8];
const PC_SWORD = [['Puños', 1], ['Espada de madera', 2], ['Espada de piedra', 3], ['Espada de hierro', 5]];
const PC_PICK = ['Manos', 'Pico de madera', 'Pico de piedra', 'Pico de hierro'];
const PC_RECIPES = [
  { id: 'planks', label: '🪵 → 4 Tablones', cost: { 9: 1 }, give: { 13: 4 } },
  { id: 'torch', label: '🔦 4 Antorchas', cost: { 5: 1, 13: 1 }, give: { 14: 4 } },
  { id: 'pick1', label: '⛏️ Pico de madera', cost: { 13: 3 }, tier: 1 },
  { id: 'pick2', label: '⛏️ Pico de piedra', cost: { 3: 3, 13: 2 }, tier: 2 },
  { id: 'pick3', label: '⛏️ Pico de hierro', cost: { 6: 3, 13: 2 }, tier: 3 },
  { id: 'sword1', label: '🗡️ Espada de madera', cost: { 13: 2 }, sword: 1 },
  { id: 'sword2', label: '🗡️ Espada de piedra', cost: { 3: 2, 13: 1 }, sword: 2 },
  { id: 'sword3', label: '🗡️ Espada de hierro', cost: { 6: 2, 13: 1 }, sword: 3 },
];
function pcGen(seed) {
  const rnd = rpgRng(seed);
  const lat = Array.from({ length: 260 }, () => rnd());
  const n1 = x => { const i = Math.floor(x), f = x - i; const a = lat[((i % 260) + 260) % 260], b = lat[(((i + 1) % 260) + 260) % 260]; const t = f * f * (3 - 2 * f); return a + (b - a) * t; };
  const lat2 = Array.from({ length: 40 * 24 }, () => rnd());
  const vn = (x, y) => { const gx = x / 6, gy = y / 5; const i = Math.floor(gx), j = Math.floor(gy), fx_ = gx - i, fy = gy - j; const g = (a, b) => lat2[((b % 24 + 24) % 24) * 40 + ((a % 40 + 40) % 40)]; const sx = fx_ * fx_ * (3 - 2 * fx_), sy = fy * fy * (3 - 2 * fy); return (g(i, j) * (1 - sx) + g(i + 1, j) * sx) * (1 - sy) + (g(i, j + 1) * (1 - sx) + g(i + 1, j + 1) * sx) * sy; };
  const rows = Array.from({ length: PC_H }, () => new Uint8Array(PC_W));
  const h = Array.from({ length: PC_W }, (_, x) => Math.floor(PC_H * 0.36 + (n1(x * 0.05) - 0.5) * 16 + (n1(x * 0.15 + 100) - 0.5) * 5));
  const biome = Array.from({ length: PC_W }, (_, x) => { const b = n1(x * 0.025 + 500); return b < 0.3 ? 'desert' : b > 0.72 ? 'snow' : 'grass'; });
  for (let x = 0; x < PC_W; x++) {
    for (let y = h[x]; y < PC_H; y++) {
      const d = y - h[x];
      let t;
      if (y >= PC_H - 2) t = 4;
      else if (d === 0) t = biome[x] === 'desert' ? 11 : biome[x] === 'snow' ? 12 : 1;
      else if (d < 4) t = biome[x] === 'desert' ? 11 : 2;
      else {
        const r = rnd(); t = 3;
        if (d > 30 && r < 0.02) t = 8; else if (d > 20 && r < 0.045) t = 7; else if (d > 9 && r < 0.09) t = 6; else if (d > 3 && r < 0.13) t = 5;
        if (d > 6 && y < PC_H - 3 && vn(x, y) > 0.66) t = y > PC_H - 10 ? 15 : 0;
      }
      rows[y][x] = t;
    }
  }
  let last = -9;
  for (let x = 3; x < PC_W - 3; x++) {
    if (biome[x] === 'grass' && x - last > 4 && rnd() < 0.16 && Math.abs(h[x] - h[x - 1]) < 2) {
      last = x; const th = 4 + Math.floor(rnd() * 2);
      for (let y = h[x] - th; y < h[x]; y++) rows[y][x] = 9;
      for (let ly = h[x] - th - 2; ly <= h[x] - th + 1; ly++) for (let lx = x - 2; lx <= x + 2; lx++) if (ly >= 0 && rows[ly][lx] === 0) rows[ly][lx] = 10;
    }
  }
  return { rows, h };
}

export function PixelCraft3D({ onExit }) {
  const S = 1;
  const VC = 16, VR = 14;
  const PWD = 0.78, PHT = 1.8;
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('craft');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const [, force] = useReducer(x => x + 1, 0);
  const input = useRef({ left: false, right: false }).current;
  const g = useRef(null);
  const initState = () => {
    const seed = Math.floor(Math.random() * 1e9); const w = pcGen(seed); const sx = 10;
    return { rows: w.rows, h: w.h, p: { x: sx + 0.1, y: w.h[sx] - 3, vx: 0, vy: 0, ground: false, fall: 0, hp: 20, inv: 0, face: 1, calm: 0 }, cam: { x: 0, y: 0 }, inv: {}, mode: 'mine', sel: 0, mine: null, tier: 0, sword: 0, zombies: [], t: 0.05, score: 0, mined: 0, kills: 0, ver: 0, hold: null, craft: false, spawnT: 3, toast: null, maxDepth: 0, oreScore: 0 };
  };
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const solid = (s, x, y) => { if (x < 0 || x >= PC_W) return true; if (y < 0) return false; if (y >= PC_H) return true; const t = s.rows[y][x]; return t > 0 && t !== 14 && t !== 15; };
  const box = (s, x, y, w, h) => { for (let j = Math.floor(y); j <= Math.floor(y + h - 0.001); j++) for (let i = Math.floor(x); i <= Math.floor(x + w - 0.001); i++) if (solid(s, i, j)) return true; return false; };
  const toast = (s, m) => { s.toast = { m, t: 1.6 }; };
  const die = (s, why) => { hx.die(); fx.shake(10, 0.4); fx.flash(C.red, 0.4); const sc = s.mined + s.oreScore + s.kills * 10 + s.maxDepth * 2; s.final = sc; setRes({ isNew: submitBest(sc), why }); setPhase('over'); };
  const hurt = (s, d, why) => { const p = s.p; if (p.inv > 0) return; p.hp -= d; p.inv = 0.9; p.calm = 0; fx.burst(...pcAt(s, p.x + PWD / 2, p.y + 0.9), C.red, 8, 160); fx.shake(5, 0.2); hx.bad(); if (p.hp <= 0) die(s, why); };
  const addInv = (s, id, n) => { s.inv[id] = (s.inv[id] || 0) + n; };
  const canPay = (s, cost) => Object.entries(cost).every(([k, v]) => (s.inv[k] || 0) >= v);
  const craft = r => {
    const s = g.current; if (!canPay(s, r.cost)) { hx.bad(); toast(s, 'Te faltan materiales'); force(); return; }
    if (r.tier && s.tier >= r.tier) { toast(s, 'Ya tienes algo mejor'); force(); return; }
    if (r.sword && s.sword >= r.sword) { toast(s, 'Ya tienes algo mejor'); force(); return; }
    Object.entries(r.cost).forEach(([k, v]) => { s.inv[k] -= v; if (!s.inv[k]) delete s.inv[k]; });
    if (r.give) Object.entries(r.give).forEach(([k, v]) => addInv(s, k, v));
    if (r.tier) s.tier = r.tier; if (r.sword) s.sword = r.sword;
    hx.win(); toast(s, '¡Fabricado!'); force();
  };
  const tileAt = (px, py) => pcPick(g.current, px, py);
  const reach = (s, wx, wy) => Math.hypot(wx + 0.5 - (s.p.x + PWD / 2), wy + 0.5 - (s.p.y + 0.9)) <= 4.6;
  const tapWorld = (px, py) => {
    const s = g.current; if (phase !== 'play' || s.craft) return;
    if (py > AREA_H - 110 || (py < 100 && px > AREA_W - 110)) return; // zona de controles
    const [wx, wy] = tileAt(px, py);
    // atacar zombi
    const z = s.zombies.find(o => { const q = pcAt(s, o.x + 0.4, o.y + 0.9); return Math.hypot(px - q[0], py - q[1]) < 48; });
    if (z) {
      if (Math.hypot(z.x - s.p.x, z.y - s.p.y) > 3.2) { toast(s, 'Muy lejos'); return; }
      const d = PC_SWORD[s.sword][1]; z.hp -= d; z.vx = Math.sign(z.x - s.p.x) * 6; z.vy = -6; hx.hit();
      fx.burst(...pcAt(s, z.x + 0.4, z.y + 0.9), C.lime, 8, 160, 0.4, 4); fx.pop(...pcAt(s, z.x + 0.4, z.y), `-${d}`, C.text, 15);
      if (z.hp <= 0) { s.zombies = s.zombies.filter(o => o !== z); s.kills += 1; fx.burst(...pcAt(s, z.x + 0.4, z.y + 0.9), C.lime, 16, 240); hx.win(); }
      return;
    }
    if (wy < 0 || wy >= PC_H || wx < 0 || wx >= PC_W) return;
    if (!reach(s, wx, wy)) { toast(s, 'Muy lejos'); return; }
    if (s.mode === 'place') {
      const sel = s.sel;
      if (!sel || !s.inv[sel] || s.rows[wy][wx] !== 0) return;
      if (sel !== 14 && (wx + 1 > s.p.x && wx < s.p.x + PWD && wy + 1 > s.p.y && wy < s.p.y + PHT)) return;
      s.rows[wy][wx] = sel; s.inv[sel] -= 1; if (!s.inv[sel]) { delete s.inv[sel]; s.sel = 0; } s.ver += 1; hx.tap(); return;
    }
    s.hold = { wx, wy };
  };
  const toRelease = () => { const s = g.current; s.hold = null; s.mine = null; };
  const pan = usePan(fx, { down: tapWorld, move: (x, y) => { const s = g.current; if (s.hold) { const [wx, wy] = tileAt(x, y); if (wx !== s.hold.wx || wy !== s.hold.wy) s.hold = { wx, wy }; } }, up: toRelease });

  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p;
    s.t += dt / 150; p.inv = Math.max(0, p.inv - dt); p.calm += dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    p.vx = ax * 5.2; if (ax) p.face = ax;
    p.vy = Math.min(p.vy + 40 * dt, 26);
    const dx = p.vx * dt;
    if (!box(s, p.x + dx, p.y, PWD, PHT)) p.x = clamp(p.x + dx, 0, PC_W - PWD);
    else if (ax && p.ground && !box(s, p.x + dx, p.y - 1, PWD, PHT) && !box(s, p.x, p.y - 1, PWD, PHT)) { p.y -= 1; p.x = clamp(p.x + dx, 0, PC_W - PWD); }
    const dy = p.vy * dt; const wasGround = p.ground; p.ground = false;
    if (!box(s, p.x, p.y + dy, PWD, PHT)) { p.y += dy; if (dy > 0) p.fall += dy; }
    else if (dy > 0) { p.y = Math.floor(p.y + dy + PHT) - PHT - 0.001; p.ground = true; if (p.fall > 6.5) hurt(s, Math.round((p.fall - 6) * 2), 'caída'); p.fall = 0; p.vy = 0; }
    else { p.y = Math.floor(p.y + dy) + 1.001; p.vy = 0; }
    if (p.ground) p.fall = 0;
    if (p.hp <= 0) return;
    p.y = clamp(p.y, -2, PC_H - 2);
    s.maxDepth = Math.max(s.maxDepth, Math.floor(p.y - s.h[clamp(Math.floor(p.x), 0, PC_W - 1)]));
    // lava
    for (let j = Math.floor(p.y); j <= Math.floor(p.y + PHT - 0.01); j++) for (let i = Math.floor(p.x); i <= Math.floor(p.x + PWD); i++) if (j >= 0 && j < PC_H && i >= 0 && i < PC_W && s.rows[j][i] === 15) { p.hp -= 14 * dt; p.inv = Math.max(p.inv, 0.05); if (p.hp <= 0) { die(s, 'lava'); return; } }
    if (p.calm > 8 && p.hp < 20) { p.hp = Math.min(20, p.hp + 2 * dt); }
    // cámara
    s.cam.x += (clamp(p.x - VC / 2 + 1 + 0.4, 0, PC_W - VC) - s.cam.x) * Math.min(1, dt * 8);
    s.cam.y += (clamp(p.y - VR / 2 + 1 + 0.9, 0, PC_H - VR) - s.cam.y) * Math.min(1, dt * 8);
    // minado
    if (s.hold) {
      const { wx, wy } = s.hold; const t = (s.rows[wy] || [])[wx];
      if (!t || !reach(s, wx, wy)) { s.mine = null; }
      else {
        const d = PC_BLK[t];
        if (d[3] > s.tier) { if (!s.mine || s.mine.warn !== t) { toast(s, `Necesitas ${PC_PICK[Math.min(3, d[3])]}`); hx.warn(); } s.mine = { wx, wy, prog: 0, warn: t }; }
        else {
          if (!s.mine || s.mine.wx !== wx || s.mine.wy !== wy) s.mine = { wx, wy, prog: 0 };
          s.mine.prog += dt / Math.max(0.05, d[2] / PC_SPEED[s.tier]);
          if (Math.random() < dt * 14) fx.burst(...pcAt(s, wx + 0.5, wy + 0.5), d[1], 2, 90, 0.3, 3);
          if (s.mine.prog >= 1) {
            s.rows[wy][wx] = 0; s.ver += 1; s.mined += 1; if (PC_VALUE[t]) { s.oreScore += PC_VALUE[t]; fx.pop(...pcAt(s, wx + 0.5, wy), `+${PC_VALUE[t]}`, C.amber, 16); }
            if (d[4]) addInv(s, d[4], 1);
            fx.burst(...pcAt(s, wx + 0.5, wy + 0.5), d[0], 8, 160, 0.5, 4); hx.hit(); s.mine = null;
            // los árboles sueltan hojas? (no)
          }
        }
      }
    }
    // zombis (noche)
    const night = Math.sin(s.t * Math.PI * 2) < -0.1;
    s.spawnT -= dt;
    if (night && s.spawnT <= 0 && s.zombies.length < 4 && p.y < s.h[clamp(Math.floor(p.x), 0, PC_W - 1)] + 6) {
      s.spawnT = 5; const zx = clamp(Math.floor(p.x + (Math.random() < 0.5 ? -1 : 1) * rand(9, 14)), 1, PC_W - 2);
      s.zombies.push({ id: uid(), x: zx, y: s.h[zx] - 2, vx: 0, vy: 0, hp: 4, face: 1, t: 0 });
    }
    s.zombies.forEach(z => {
      z.t += dt; z.vy = Math.min(z.vy + 40 * dt, 24);
      const dir = Math.sign(p.x - z.x); z.face = dir || 1;
      const wv = dir * 1.7; const zx2 = z.x + (z.vx + wv) * dt; z.vx *= 0.88;
      if (!box(s, zx2, z.y, 0.8, 1.8)) z.x = zx2; else if (z.grounded && !box(s, zx2, z.y - 1, 0.8, 1.8)) { z.vy = -11; }
      const zy2 = z.y + z.vy * dt; z.grounded = false;
      if (!box(s, z.x, zy2, 0.8, 1.8)) z.y = zy2; else if (z.vy > 0) { z.y = Math.floor(zy2 + 1.8) - 1.8 - 0.001; z.vy = 0; z.grounded = true; } else { z.y = Math.floor(zy2) + 1.001; z.vy = 0; }
      if (Math.abs(z.x - p.x) < 0.8 && Math.abs(z.y - p.y) < 1.6) { hurt(s, 3, 'zombi'); p.vx = 0; p.vy = -7; p.x += Math.sign(p.x - z.x) * 0.3; }
    });
    if (!night) s.zombies = s.zombies.filter(z => { if (Math.random() < dt * 0.4) { fx.burst(...pcAt(s, z.x + 0.4, z.y + 0.9), C.orange, 10, 160); return false; } return true; });
    s.zombies = s.zombies.filter(z => Math.abs(z.x - p.x) < 40 && z.y < PC_H);
  });
  const jump = () => { const s = g.current; if (phase !== 'play') return; if (s.p.ground) { s.p.vy = -13.2; s.p.ground = false; hx.tap(); } };

  const s = g.current; const p = s.p;
  const cam = pcCam(s); s.camObj = cam;
  const sunV = Math.sin(s.t * Math.PI * 2);
  const day = clamp((sunV + 0.2) / 1.0, 0, 1);
  const skyHex = pcHex(10 + day * 110, 16 + day * 150, 38 + day * 175);
  const depth = p.y - s.h[clamp(Math.floor(p.x), 0, PC_W - 1)];
  const under = clamp((depth - 4) / 18, 0, 1) * 0.6;
  const nightD = clamp(-sunV * 1.4, 0, 1) * 0.5;
  const torchNear = (() => { for (let j = Math.floor(p.y) - 5; j <= Math.floor(p.y) + 5; j++) for (let i = Math.floor(p.x) - 5; i <= Math.floor(p.x) + 5; i++) if (j >= 0 && j < PC_H && i >= 0 && i < PC_W && s.rows[j][i] === 14) return true; return false; })();
  const dark = Math.max(under, nightD) * (torchNear ? 0.45 : 1);
  const inv = Object.entries(s.inv).filter(([k, v]) => v > 0 && Number(k) !== 0);
  const hearts = Array.from({ length: 10 }, (_, i) => (p.hp >= (i + 1) * 2 ? '❤️' : p.hp >= i * 2 + 1 ? '💔' : '🖤'));
  const score = s.mined + s.oreScore + s.kills * 10 + s.maxDepth * 2;
  const scene = { bg: skyHex, fog: { c: skyHex, near: 12, far: 26 }, objs: pcObjects(s, cam), cam: { p: cam.p, l: cam.l, fov: PC_FOV } };
  return (
    <GameScreen title="PIXEL CRAFT 3D" emoji="⛏️" accent={C.orange} onExit={onExit} score={score} best={best}
      hud={<><Text style={{ fontSize: 11 }}>{hearts.join('')}</Text><Text style={{ color: C.dim, fontSize: 11 }}>{PC_PICK[s.tier]} · {PC_SWORD[s.sword][0]}</Text><Text style={{ color: sunV < -0.1 ? C.violet : C.amber, fontSize: 12, fontWeight: '900' }}>{sunV < -0.1 ? '🌙 NOCHE' : '☀️ DÍA'}</Text></>}>
      <PlayArea fx={fx} bg={skyHex} border={alpha(C.orange, 0.4)} {...pan}>
        <World3D scene={scene} />
        {dark > 0.02 && <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, backgroundColor: `rgba(0,0,12,${dark})` }} />}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: 14, left: 0, width: AREA_W - 110, textAlign: 'center', color: '#fff', fontSize: 13, fontWeight: '900', ...tglow('#000', 5) }}>{s.toast.m}</Text>}
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 8, top: 8, gap: 6 }}>
          <Btn label={s.mode === 'mine' ? '⛏️ MINAR' : '🧱 COLOCAR'} small ghost color={s.mode === 'mine' ? C.amber : C.lime} onPress={() => { s.mode = s.mode === 'mine' ? 'place' : 'mine'; hx.tick(); force(); }} />
          <Btn label="🔨 FABRICAR" small ghost color={C.cyan} onPress={() => { s.craft = !s.craft; hx.tick(); force(); }} />
        </View>
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 6, right: 6, bottom: 92, flexDirection: 'row', flexWrap: 'wrap', gap: 5, justifyContent: 'center' }}>
          {inv.slice(0, 8).map(([k, v]) => { const d = PC_BLK[k]; const on = s.sel === Number(k) && s.mode === 'place'; return (
            <Pressable key={k} onPressIn={() => { s.sel = Number(k); s.mode = 'place'; hx.tick(); force(); }}>
              <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 2, borderColor: on ? C.lime : 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                {Number(k) === 14 ? <Text style={{ fontSize: 20 }}>🔦</Text> : <View style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: d[0], borderWidth: 2, borderColor: d[1] }} />}
                <Text style={{ position: 'absolute', right: 2, bottom: 0, color: '#fff', fontSize: 11, fontWeight: '900', ...tglow('#000', 3) }}>{v}</Text>
              </View>
            </Pressable>); })}
        </View>
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <PcPad testID="pc-left" label="◀" color={C.orange} onDown={() => { input.left = true; }} onUp={() => { input.left = false; }} />
            <PcPad testID="pc-right" label="▶" color={C.orange} onDown={() => { input.right = true; }} onUp={() => { input.right = false; }} />
          </View>
          <PcPad testID="pc-jump" label="⬆" color={C.pink} big onDown={jump} onUp={() => {}} />
        </View>
        {s.craft && phase === 'play' && (
          <View style={{ position: 'absolute', left: 12, right: 12, top: 12, bottom: 12, borderRadius: 18, backgroundColor: 'rgba(8,8,18,0.94)', borderWidth: 2, borderColor: alpha(C.cyan, 0.6), padding: 12, zIndex: 30 }}>
            <Text style={{ color: C.cyan, fontWeight: '900', letterSpacing: 2, fontSize: 14, textAlign: 'center', marginBottom: 8 }}>🔨 FABRICACIÓN</Text>
            <ScrollView>{PC_RECIPES.map(r => { const ok = canPay(s, r.cost); const done = (r.tier && s.tier >= r.tier) || (r.sword && s.sword >= r.sword); return (
              <Pressable key={r.id} testID={`rc-${r.id}`} onPress={() => craft(r)} style={{ opacity: ok && !done ? 1 : 0.45, marginBottom: 6 }}>
                <View style={{ padding: 10, borderRadius: 12, backgroundColor: alpha(C.cyan, 0.1), borderWidth: 1.5, borderColor: alpha(C.cyan, 0.5) }}>
                  <Text style={{ color: C.text, fontWeight: '800', fontSize: 13 }}>{r.label}{done ? '  ✓' : ''}</Text>
                  <Text style={{ color: C.dim, fontSize: 11 }}>Cuesta: {Object.entries(r.cost).map(([k, v]) => `${v} ${PC_BLK[k][5]} (${s.inv[k] || 0})`).join(' · ')}</Text>
                </View>
              </Pressable>); })}</ScrollView>
            <Btn label="CERRAR" small ghost color={C.dim} onPress={() => { s.craft = false; force(); }} />
          </View>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? '💀' : '⛏️'} title={phase === 'over' ? (res.why === 'zombi' ? 'DEVORADO' : res.why === 'lava' ? 'FUNDIDO EN LAVA' : 'FIN DEL JUEGO') : 'PIXEL CRAFT 3D'}
          subtitle={phase === 'over' ? `${s.mined} bloques · ${s.kills} zombis · profundidad ${s.maxDepth}` : 'Mina, fabrica y sobrevive a la noche'}
          score={s.final || score} best={best} isNew={res.isNew} accent={C.orange} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca un bloque para minarlo (mantén pulsado)', '🔨 fabrica picos, espadas y antorchas con lo que recojas', '🧱 elige un bloque del inventario para colocarlo', 'De noche salen zombis: tócalos para atacarlos', 'Cuidado con la lava en lo profundo'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
