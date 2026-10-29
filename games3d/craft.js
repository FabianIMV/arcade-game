/**
 * Pixel Craft 3D – minar y construir con bloques en primera persona (motor 3D v2).
 * Mundo de bloques 64×64×40 generado con ruido (colinas, desierto, nieve, árboles, cuevas, menas, lava y lecho de roca).
 * Los bloques expuestos se dibujan con instancing (una sola malla por tipo); se reconstruyen alrededor del jugador al mover o editar.
 * Reglas del original: minar con pico (dureza y nivel de pico), colocar bloques, fabricar picos/espadas/antorchas,
 * día y noche con zombis, caída y lava, puntuación por bloques, menas, zombis y profundidad.
 * Controles: joystick izquierdo mover · derecho mirar · SALTAR · ⛏ (mantener) minar / atacar · 🧱 colocar · 🔨 fabricar.
 */
import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, SCREEN_H, SCREEN_W, alpha, clamp, hx, rand, tglow, uid, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Btn3D, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { enemy, mix, shade } from '../utils/prefabs';
import { forward, project, right } from '../utils/openworld';

const PI = Math.PI, cs = Math.cos, sn = Math.sin;
const rotX = a => [1, 0, 0, 0, cs(a), -sn(a), 0, sn(a), cs(a)];
const rotY = a => [cs(a), 0, sn(a), 0, 1, 0, -sn(a), 0, cs(a)];
const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8]];
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const eul = m => { const y = Math.asin(Math.max(-1, Math.min(1, m[2]))); if (Math.abs(m[2]) < 0.9999999) return [Math.atan2(-m[5], m[8]), y, Math.atan2(-m[1], m[0])]; return [Math.atan2(m[7], m[4]), y, 0]; };
// objeto pegado a la cámara: lp en ejes de cámara (x derecha, y arriba, -z delante), rx = giro propio alrededor de X
const camObj = (cam, id, k, lp, s, c, rx, extra) => {
  const G = mul(rotY(cam.yaw), rotX(cam.pitch)), q = mv(G, lp);
  return { id, k, p: [cam.p[0] + q[0], cam.p[1] + q[1], cam.p[2] + q[2]], s, c, r: eul(mul(G, rotX(rx || 0))), ...extra };
};

// ─── bloques ───
const W = 64, D = 64, H = 40, REACH = 5.5;
// id: [color, color de la mena/borde, dureza (s), nivel de pico, suelta, nombre]
const BLK = {
  1: ['#8a5a30', '#5fb046', 0.7, 0, 2, 'Césped'], 2: ['#8a5a30', '#5e3516', 0.7, 0, 2, 'Tierra'], 3: ['#8a8d96', '#55555d', 2.6, 1, 3, 'Piedra'],
  4: ['#2a2a34', '#0a0a10', 0, 99, 0, 'Lecho'], 5: ['#8a8d96', '#15151a', 3.2, 1, 5, 'Carbón'], 6: ['#8a8d96', '#e8b890', 4.2, 2, 6, 'Hierro'],
  7: ['#8a8d96', '#ffd23a', 5, 3, 7, 'Oro'], 8: ['#8a8d96', '#4af0ff', 6, 3, 8, 'Diamante'], 9: ['#7a4e22', '#523216', 1.6, 0, 9, 'Madera'],
  10: ['#3f9a3a', '#1d5e22', 0.35, 0, 0, 'Hojas'], 11: ['#e6d28a', '#b49d4a', 0.5, 0, 11, 'Arena'], 12: ['#f2f6ff', '#bccae0', 0.5, 0, 12, 'Nieve'],
  13: ['#c89258', '#8c6030', 1.0, 0, 13, 'Tablones'], 14: ['#ffd24d', '#ff9a1a', 0.05, 0, 14, 'Antorcha'], 15: ['#ff5a1a', '#c02a00', 0, 99, 0, 'Lava'],
};
const VALUE = { 5: 3, 6: 6, 7: 12, 8: 30 };
const SPEED = [1, 2, 3.2, 4.8];
const SWORD = [['Puños', 1], ['Espada de madera', 2], ['Espada de piedra', 3], ['Espada de hierro', 5]];
const PICK = ['Manos', 'Pico de madera', 'Pico de piedra', 'Pico de hierro'];
const PICK_COL = ['#e0b890', '#c89258', '#8a8d96', '#e8e0d0'];
const RECIPES = [
  { id: 'planks', label: '🪵 → 4 Tablones', cost: { 9: 1 }, give: { 13: 4 } }, { id: 'torch', label: '🔦 4 Antorchas', cost: { 5: 1, 13: 1 }, give: { 14: 4 } },
  { id: 'pick1', label: '⛏️ Pico de madera', cost: { 13: 3 }, tier: 1 }, { id: 'pick2', label: '⛏️ Pico de piedra', cost: { 3: 3, 13: 2 }, tier: 2 }, { id: 'pick3', label: '⛏️ Pico de hierro', cost: { 6: 3, 13: 2 }, tier: 3 },
  { id: 'sword1', label: '🗡️ Espada de madera', cost: { 13: 2 }, sword: 1 }, { id: 'sword2', label: '🗡️ Espada de piedra', cost: { 3: 2, 13: 1 }, sword: 2 }, { id: 'sword3', label: '🗡️ Espada de hierro', cost: { 6: 2, 13: 1 }, sword: 3 },
];

// ─── generación del mundo ───
const ihash = (x, y, z, s) => { let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791) ^ Math.imul(s | 0, 2654435761)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const sm = t => t * t * (3 - 2 * t);
const noise2 = (x, z, s) => { const i = Math.floor(x), j = Math.floor(z), u = sm(x - i), v = sm(z - j); const a = ihash(i, 0, j, s), b = ihash(i + 1, 0, j, s), c = ihash(i, 0, j + 1, s), d = ihash(i + 1, 0, j + 1, s); return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v; };
const noise3 = (x, y, z, s) => { const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), u = sm(x - i), v = sm(y - j), w = sm(z - k); const L = (a, b, c) => ihash(i + a, j + b, k + c, s); const l = (a, b) => (L(0, a, b) * (1 - u) + L(1, a, b) * u); return (l(0, 0) * (1 - v) + l(1, 0) * v) * (1 - w) + (l(0, 1) * (1 - v) + l(1, 1) * v) * w; };
const idx = (x, y, z) => (y * D + z) * W + x;
function genWorld(seed) {
  const b = new Uint8Array(W * H * D), top = new Int16Array(W * D), biome = new Uint8Array(W * D);
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const h = Math.floor(19 + (noise2(x * 0.055, z * 0.055, seed) - 0.5) * 15 + (noise2(x * 0.16, z * 0.16, seed + 3) - 0.5) * 4);
    const bn = noise2(x * 0.035 + 40, z * 0.035, seed + 9), bi = bn < 0.3 ? 1 : bn > 0.72 ? 2 : 0;   // 0 hierba · 1 desierto · 2 nieve
    top[z * W + x] = h; biome[z * W + x] = bi;
    for (let y = 0; y <= h; y++) {
      const d = h - y; let t;
      if (y === 0) t = 4; else if (d === 0) t = bi === 1 ? 11 : bi === 2 ? 12 : 1; else if (d < 4) t = bi === 1 ? 11 : 2;
      else {
        const r = ihash(x, y, z, seed + 1); t = 3;
        if (d > 24 && r < 0.02) t = 8; else if (d > 16 && r < 0.045) t = 7; else if (d > 8 && r < 0.09) t = 6; else if (d > 3 && r < 0.14) t = 5;
        if (d > 5 && y > 1 && noise3(x * 0.1, y * 0.13, z * 0.1, seed + 5) > 0.7) t = y < 6 ? 15 : 0;
      }
      b[idx(x, y, z)] = t;
    }
  }
  let last = -9;
  for (let x = 4; x < W - 4; x++) for (let z = 4; z < D - 4; z++) {
    if (biome[z * W + x] !== 0 || ihash(x, 0, z, seed + 7) > 0.012) continue;
    const h = top[z * W + x]; const th = 4 + (ihash(x, 1, z, seed) > 0.5 ? 1 : 0);
    for (let y = h + 1; y <= h + th; y++) b[idx(x, y, z)] = 9;
    for (let ly = h + th - 1; ly <= h + th + 2; ly++) for (let lx = -2; lx <= 2; lx++) for (let lz = -2; lz <= 2; lz++) { if (Math.abs(lx) + Math.abs(lz) > (ly > h + th ? 2 : 3)) continue; const xx = x + lx, zz = z + lz; if (b[idx(xx, ly, zz)] === 0) b[idx(xx, ly, zz)] = 10; }
  }
  return { b, top };
}
const blockAt = (s, x, y, z) => { x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); if (x < 0 || x >= W || z < 0 || z >= D || y < 0) return y < 0 ? 4 : 4; if (y >= H) return 0; return s.b[idx(x, y, z)]; };
const solidAt = (s, x, y, z) => { const t = blockAt(s, x, y, z); return t > 0 && t !== 14 && t !== 15; };
const boxHit = (s, x, y, z, hw, hh) => { for (let j = Math.floor(y); j <= Math.floor(y + hh - 0.001); j++) for (let i = Math.floor(x - hw); i <= Math.floor(x + hw - 0.001); i++) for (let k = Math.floor(z - hw); k <= Math.floor(z + hw - 0.001); k++) if (solidAt(s, i, j, k)) return true; return false; };
// ¿está expuesto al aire? (hojas y antorchas no tapan)
const clearAt = (s, x, y, z) => { if (x < 0 || x >= W || z < 0 || z >= D) return false; if (y < 0) return false; if (y >= H) return true; const t = s.b[idx(x, y, z)]; return t === 0 || t === 14; };

// bloques visibles alrededor de (cx, cz): una lista nueva de objetos para scene.statics
function buildStatics(s, cx, cy, cz) {
  const st = [], R = 17, torches = [];
  const x0 = Math.max(0, cx - R), x1 = Math.min(W - 1, cx + R), z0 = Math.max(0, cz - R), z1 = Math.min(D - 1, cz + R), y0 = Math.max(0, cy - 15), y1 = Math.min(H - 1, cy + 14);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const t = s.b[idx(x, y, z)]; if (!t) continue;
    if (t === 14) { st.push({ id: 'p', k: 'box', p: [x + 0.5, y + 0.34, z + 0.5], s: [0.12, 0.68, 0.12], c: '#6a4a24', inst: 'palo' }, { id: 'f', k: 'box', p: [x + 0.5, y + 0.78, z + 0.5], s: [0.2, 0.22, 0.2], c: '#ffb83a', e: 1, inst: 'llama' }); torches.push([x + 0.5, y + 0.85, z + 0.5]); continue; }
    if (t === 15) { if (clearAt(s, x, y + 1, z) || clearAt(s, x + 1, y, z) || clearAt(s, x - 1, y, z) || clearAt(s, x, y, z + 1) || clearAt(s, x, y, z - 1)) st.push({ id: 'l', k: 'box', p: [x + 0.5, y + 0.45, z + 0.5], s: [1, 0.9, 1], c: ihash(x, y, z, 3) > 0.5 ? '#ff6a1a' : '#ff9a2a', e: 1, inst: 'lava' }); continue; }
    const up = clearAt(s, x, y + 1, z);
    if (!(up || clearAt(s, x, y - 1, z) || clearAt(s, x + 1, y, z) || clearAt(s, x - 1, y, z) || clearAt(s, x, y, z + 1) || clearAt(s, x, y, z - 1))) continue;
    const d = BLK[t], j = 0.92 + ihash(x, y, z, 11) * 0.16;
    const base = t === 11 || t === 12 ? d[0] : t === 1 ? d[0] : d[0];
    st.push({ id: 'b', k: 'box', p: [x + 0.5, y + 0.5, z + 0.5], s: [1, 1, 1], c: shade(base, j), inst: 'bloque', sh: true, recv: true });
    if (t === 1 && up) st.push({ id: 'g', k: 'box', p: [x + 0.5, y + 0.9, z + 0.5], s: [1.004, 0.2, 1.004], c: shade(d[1], 0.9 + ihash(x, 0, z, 5) * 0.2), inst: 'cesped', recv: true });
    if (VALUE[t]) {   // manchas de la mena en las caras expuestas
      const f = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
      for (const [dx, dy, dz] of f) if (clearAt(s, x + dx, y + dy, z + dz)) for (let q = 0; q < 3; q++) {
        const u = ihash(x + q, y, z, 20 + dx + dz * 2 + dy * 3) - 0.5, v = ihash(x, y + q, z, 40 + dx + dz * 2 + dy * 3) - 0.5, sz = 0.2 + ihash(x, y, z + q, 60) * 0.14;
        st.push({ id: 'o', k: 'box', p: [x + 0.5 + dx * 0.5 + (dx ? 0 : u * 0.6), y + 0.5 + dy * 0.5 + (dy ? 0 : v * 0.6), z + 0.5 + dz * 0.5 + (dz ? 0 : (dx ? u : v) * 0.6)], s: [dx ? 0.05 : sz, dy ? 0.05 : sz, dz ? 0.05 : sz], c: d[1], e: t === 8 || t === 7 ? 0.6 : 0.1, inst: 'mena' });
      }
    }
  }
  s.torches = torches;
  return st;
}
// ray DDA: primer bloque macizo alcanzado y la celda libre anterior
function raycast(s, o, d, maxD) {
  let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
  const sx = d[0] > 0 ? 1 : -1, sy = d[1] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
  const td = (a, dd, i, st) => (Math.abs(dd) < 1e-9 ? 1e9 : ((dd > 0 ? i + 1 : i) - a) / dd);
  let tx = td(o[0], d[0], x), ty = td(o[1], d[1], y), tz = td(o[2], d[2], z);
  const dx = Math.abs(d[0]) < 1e-9 ? 1e9 : Math.abs(1 / d[0]), dy = Math.abs(d[1]) < 1e-9 ? 1e9 : Math.abs(1 / d[1]), dz = Math.abs(d[2]) < 1e-9 ? 1e9 : Math.abs(1 / d[2]);
  let px = x, py = y, pz = z, t = 0;
  for (let n = 0; n < 40; n++) {
    const b = blockAt(s, x, y, z);
    if (b > 0 && b !== 15 && x >= 0 && x < W && z >= 0 && z < D && y >= 0 && y < H) return { x, y, z, px, py, pz, b, t };
    px = x; py = y; pz = z;
    if (tx < ty && tx < tz) { t = tx; if (t > maxD) break; x += sx; tx += dx; } else if (ty < tz) { t = ty; if (t > maxD) break; y += sy; ty += dy; } else { t = tz; if (t > maxD) break; z += sz; tz += dz; }
  }
  return null;
}

const initState = () => {
  const seed = Math.floor(Math.random() * 1e6), w = genWorld(seed), sx = 32, sz = 32, y = w.top[sz * W + sx] + 1;
  return { b: w.b, top: w.top, p: { x: sx + 0.5, y, z: sz + 0.5, vx: 0, vy: 0, vz: 0, ground: false, fall: 0, hp: 20, inv: 0, calm: 0 }, yaw: Math.PI, pitch: -0.15, inv: {}, sel: 0, tier: 0, sword: 0, zombies: [], clock: 0.04, score0: 0, mined: 0, kills: 0, oreScore: 0, maxDepth: 0, mining: false, mine: null, swing: 0, spawnT: 4, toast: null, statics: null, built: null, torches: [], target: null, craft: false, bob: 0, final: null, why: '', t: 0 };
};

export function PixelCraft3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('craft');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, why: '' });
  const [craftOpen, setCraftOpen] = useState(false);
  const [offY, setOffY] = useState(0);
  const move = useRef({ x: 0, y: 0, on: false }).current, look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null); if (!g.current) g.current = initState();
  if (globalThis.__TEST) globalThis.__game = g;
  const toast = (s, m) => { s.toast = { m, t: 1.6 }; };
  const rebuild = s => { const p = s.p; const key = [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)]; s.statics = buildStatics(s, key[0], key[1], key[2]); s.built = key; };
  if (!g.current.statics) rebuild(g.current);

  const start = () => { fx.clear(); clear3d(); g.current = initState(); rebuild(g.current); setCraftOpen(false); setPhase('play'); hx.tap(); };
  const die = (s, why) => { if (s.dead) return; s.dead = true; hx.die(); fx.shake(12, 0.5); fx.flash(C.red, 0.5); s.final = s.mined + s.oreScore + s.kills * 10 + s.maxDepth * 2; setRes({ isNew: submitBest(s.final), why }); setPhase('over'); };
  const hurt = (s, d, why) => { const p = s.p; if (p.inv > 0) return; p.hp -= d; p.inv = 0.9; p.calm = 0; fx.shake(7, 0.25); fx.flash(C.red, 0.3); hx.bad(); burst3d([p.x, p.y + 1.2, p.z], '#ff4d6d', 10, { speed: 3, size: 0.12 }); if (p.hp <= 0) die(s, why); };
  const addInv = (s, id, n) => { s.inv[id] = (s.inv[id] || 0) + n; };
  const canPay = (s, cost) => Object.entries(cost).every(([k, v]) => (s.inv[k] || 0) >= v);
  const craft = r => {
    const s = g.current; if (!canPay(s, r.cost)) { hx.bad(); toast(s, 'Te faltan materiales'); return; }
    if ((r.tier && s.tier >= r.tier) || (r.sword && s.sword >= r.sword)) { toast(s, 'Ya tienes algo mejor'); return; }
    Object.entries(r.cost).forEach(([k, v]) => { s.inv[k] -= v; if (!s.inv[k]) delete s.inv[k]; });
    if (r.give) Object.entries(r.give).forEach(([k, v]) => addInv(s, k, v));
    if (r.tier) s.tier = r.tier; if (r.sword) s.sword = r.sword;
    hx.win(); toast(s, '¡Fabricado!'); ring3d([s.p.x, s.p.y + 0.3, s.p.z], '#4af0ff', 20, { speed: 3, life: 0.6 });
  };
  const eyeOf = s => [s.p.x, s.p.y + 1.62, s.p.z];
  const dirOf = s => [-sn(s.yaw) * cs(s.pitch), sn(s.pitch), -cs(s.yaw) * cs(s.pitch)];
  const place = () => {
    const s = g.current; if (phase !== 'play' || s.craft) return;
    const sel = s.sel; s.swing = 0.25;
    if (!sel || !s.inv[sel]) { toast(s, 'Elige un bloque del inventario'); hx.tick(); return; }
    const hit = raycast(s, eyeOf(s), dirOf(s), REACH); if (!hit) return;
    const { px, py, pz } = hit; if (blockAt(s, px, py, pz) !== 0 || py >= H) return;
    const p = s.p;
    if (sel !== 14 && px + 1 > p.x - 0.3 && px < p.x + 0.3 && pz + 1 > p.z - 0.3 && pz < p.z + 0.3 && py + 1 > p.y && py < p.y + 1.8) { toast(s, 'Estás en medio'); return; }
    s.b[idx(px, py, pz)] = sel; s.inv[sel] -= 1; if (!s.inv[sel]) { delete s.inv[sel]; s.sel = 0; }
    rebuild(s); hx.tap(); burst3d([px + 0.5, py + 0.5, pz + 0.5], BLK[sel][0], 8, { speed: 2.5, size: 0.14, life: 0.4 });
  };

  useLoop(phase === 'play', dt => {
    const s = g.current, p = s.p; s.t += dt;
    s.clock += dt / 150; p.inv = Math.max(0, p.inv - dt); p.calm += dt; s.swing = Math.max(0, s.swing - dt);
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    s.yaw -= look.x * 2.5 * dt; s.pitch = clamp(s.pitch - look.y * 1.6 * dt, -1.35, 1.35);
    // movimiento relativo a la cámara
    const f = forward(s.yaw), rt = right(s.yaw), len = move.on ? Math.min(1, Math.hypot(move.x, move.y)) : 0;
    let wx = 0, wz = 0;
    if (len > 0.08) { const m = Math.hypot(move.x, move.y), ux = move.x / m, uy = -move.y / m; wx = (f[0] * uy + rt[0] * ux) * 4.6 * len; wz = (f[1] * uy + rt[1] * ux) * 4.6 * len; }
    p.vx += (wx - p.vx) * Math.min(1, dt * 14); p.vz += (wz - p.vz) * Math.min(1, dt * 14);
    p.vy = Math.max(p.vy - 26 * dt, -30);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vy), Math.abs(p.vx), Math.abs(p.vz)) * dt / 0.35)), sdt = dt / steps; p.ground = false;
    for (let i = 0; i < steps; i++) {
      const nx = p.x + p.vx * sdt; if (!boxHit(s, nx, p.y, p.z, 0.3, 1.8)) p.x = clamp(nx, 0.4, W - 0.4); else p.vx = 0;
      const nz = p.z + p.vz * sdt; if (!boxHit(s, p.x, p.y, nz, 0.3, 1.8)) p.z = clamp(nz, 0.4, D - 0.4); else p.vz = 0;
      const ny = p.y + p.vy * sdt;
      if (!boxHit(s, p.x, ny, p.z, 0.3, 1.8)) { if (p.vy < 0) p.fall += -p.vy * sdt; p.y = ny; }
      else if (p.vy < 0) { p.y = Math.floor(ny) + 1.0001; p.ground = true; if (p.fall > 4.2) { hurt(s, Math.round((p.fall - 3.5) * 1.6), 'caída'); burst3d([p.x, p.y + 0.1, p.z], '#bdb4a0', 12, { speed: 3, up: 1, g: 6, size: 0.14 }); } p.fall = 0; p.vy = 0; }
      else { p.y = Math.floor(ny + 1.8) - 1.8 - 0.0001; p.vy = 0; }
    }
    if (p.ground) p.fall = 0;
    if (p.y < -5) { die(s, 'vacío'); return; }
    if (s.dead) return;
    const sx = clamp(Math.floor(p.x), 0, W - 1), sz = clamp(Math.floor(p.z), 0, D - 1);
    s.maxDepth = Math.max(s.maxDepth, s.top[sz * W + sx] - Math.floor(p.y));
    s.moving = Math.hypot(p.vx, p.vz) > 1 && p.ground; if (s.moving) s.bob += dt * 10;
    // lava
    for (let j = Math.floor(p.y); j <= Math.floor(p.y + 1.7); j++) if (blockAt(s, p.x, j, p.z) === 15) { p.hp -= 14 * dt; p.inv = Math.max(p.inv, 0.05); if (Math.random() < dt * 20) burst3d([p.x, p.y + 0.5, p.z], '#ff8a2a', 1, { speed: 2, up: 2, size: 0.12 }); if (p.hp <= 0) { die(s, 'lava'); return; } break; }
    if (p.calm > 8 && p.hp < 20) p.hp = Math.min(20, p.hp + 2 * dt);
    // reconstruir bloques si te alejas del centro
    if (!s.built || Math.abs(p.x - s.built[0]) > 6 || Math.abs(p.z - s.built[2]) > 6 || Math.abs(p.y - s.built[1]) > 8) rebuild(s);
    // objetivo y minado
    const eye = eyeOf(s), dir = dirOf(s), hit = raycast(s, eye, dir, REACH);
    let zt = null, zd = hit ? hit.t : REACH;
    s.zombies.forEach(z => { const c = [z.x, z.y + 0.9, z.z], v = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]], tt = v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]; if (tt < 0 || tt > Math.min(zd, 3.6)) return; const px = eye[0] + dir[0] * tt - c[0], py = eye[1] + dir[1] * tt - c[1], pz = eye[2] + dir[2] * tt - c[2]; if (Math.hypot(px, py * 0.5, pz) < 0.62) { zt = z; zd = tt; } });
    s.target = zt ? { z: zt } : hit;
    if (s.mining) {
      s.swing = Math.max(s.swing, 0.12);
      if (zt) {
        s.attackT = (s.attackT || 0) - dt;
        if (s.attackT <= 0) {
          s.attackT = 0.45; s.swing = 0.28; const d = SWORD[s.sword][1]; zt.hp -= d; zt.flash = 0.2;
          const kx = zt.x - p.x, kz = zt.z - p.z, km = Math.hypot(kx, kz) || 1; zt.vx = kx / km * 6; zt.vz = kz / km * 6; zt.vy = 6; hx.hit(); fx.shake(3, 0.12);
          burst3d([zt.x, zt.y + 1.1, zt.z], ['#7fd66a', '#fff'], 12, { speed: 4, up: 2, size: 0.14 });
          const q = project({ p: eye, yaw: s.yaw, pitch: s.pitch, fov: 74 }, [zt.x, zt.y + 2.1, zt.z], SCREEN_W, SCREEN_H); if (q) fx.pop(q.x, q.y, `-${d}`, C.text, 20);
          if (zt.hp <= 0) { s.zombies = s.zombies.filter(o => o !== zt); s.kills += 1; burst3d([zt.x, zt.y + 1, zt.z], ['#7fd66a', '#ffd54a'], 30, { speed: 6, up: 3, size: 0.18 }); ring3d([zt.x, zt.y + 0.2, zt.z], '#7fd66a', 14, { speed: 4, life: 0.5 }); hx.win(); }
        }
      } else if (hit) {
        const d = BLK[hit.b], key = `${hit.x},${hit.y},${hit.z}`;
        if (d[3] > s.tier) { if (!s.mine || s.mine.key !== key) { toast(s, `Necesitas ${PICK[Math.min(3, d[3])]}`); hx.warn(); } s.mine = { key, prog: 0 }; }
        else {
          if (!s.mine || s.mine.key !== key) s.mine = { key, prog: 0 };
          s.mine.prog += dt / Math.max(0.05, d[2] / SPEED[s.tier]);
          if (Math.random() < dt * 16) burst3d([hit.x + 0.5 + (hit.px - hit.x) * 0.5, hit.y + 0.5 + (hit.py - hit.y) * 0.5, hit.z + 0.5 + (hit.pz - hit.z) * 0.5], d[1] === d[0] ? d[0] : d[1], 1, { speed: 1.6, up: 1.2, g: 8, size: 0.1, life: 0.5 });
          if (s.mine.prog >= 1) {
            const t = hit.b; s.b[idx(hit.x, hit.y, hit.z)] = 0; s.mined += 1; s.mine = null;
            if (VALUE[t]) { s.oreScore += VALUE[t]; const q = project({ p: eye, yaw: s.yaw, pitch: s.pitch, fov: 74 }, [hit.x + 0.5, hit.y + 1, hit.z + 0.5], SCREEN_W, SCREEN_H); if (q) fx.pop(q.x, q.y, `+${VALUE[t]}`, C.amber, 22); ring3d([hit.x + 0.5, hit.y + 0.5, hit.z + 0.5], d[1], 12, { speed: 3, life: 0.5, size: 0.1 }); }
            if (d[4]) addInv(s, d[4], 1);
            burst3d([hit.x + 0.5, hit.y + 0.5, hit.z + 0.5], [d[0], shade(d[0], 1.2), d[1]], 16, { speed: 4, up: 2, g: 14, size: 0.16, life: 0.6 }); hx.hit(); fx.shake(2, 0.08);
            // un bloque encima que depende de este (antorcha) cae
            if (blockAt(s, hit.x, hit.y + 1, hit.z) === 14) { s.b[idx(hit.x, hit.y + 1, hit.z)] = 0; addInv(s, 14, 1); }
            rebuild(s);
          }
        }
      } else s.mine = null;
    } else s.mine = null;
    // zombis
    const sunV = Math.sin(s.clock * PI * 2), night = sunV < -0.1, depth = s.top[sz * W + sx] - p.y;
    s.spawnT -= dt;
    if (s.spawnT <= 0 && s.zombies.length < 5 && ((night && depth < 8) || (depth > 9 && Math.random() < 0.5))) {
      s.spawnT = night ? 5 : 11;
      for (let k = 0; k < 14; k++) {
        const a = Math.random() * PI * 2, r = rand(9, 15), zx = Math.floor(p.x + Math.cos(a) * r), zz = Math.floor(p.z + Math.sin(a) * r);
        if (zx < 1 || zz < 1 || zx >= W - 1 || zz >= D - 1) continue;
        const zy0 = night && depth < 8 ? s.top[zz * W + zx] + 1 : Math.floor(p.y + rand(-4, 3)); let done = false;
        for (let y = zy0 + 3; y >= Math.max(1, zy0 - 6); y--) if (solidAt(s, zx, y - 1, zz) && !solidAt(s, zx, y, zz) && !solidAt(s, zx, y + 1, zz)) { s.zombies.push({ id: uid(), x: zx + 0.5, y, z: zz + 0.5, vx: 0, vy: 0, vz: 0, hp: 4, yaw: 0, t: Math.random() * 5, flash: 0, grounded: false }); done = true; break; }
        if (done) break;
      }
    }
    s.zombies.forEach(z => {
      z.t += dt; z.flash = Math.max(0, z.flash - dt); z.vy = Math.max(z.vy - 26 * dt, -25);
      const dx = p.x - z.x, dz = p.z - z.z, dm = Math.hypot(dx, dz) || 1; z.yaw = Math.atan2(-dx, -dz);
      const wv = dm > 0.8 ? 1.9 : 0, hvx = dx / dm * wv + (z.kx || 0), hvz = dz / dm * wv + (z.kz || 0); z.kx = (z.kx || 0) * 0.9; z.kz = (z.kz || 0) * 0.9;
      if (z.vx || z.vz) { z.kx = z.vx; z.kz = z.vz; z.vx = 0; z.vz = 0; }
      z.walk = wv ? 1 : 0;
      const nx = z.x + hvx * dt; if (!boxHit(s, nx, z.y, z.z, 0.3, 1.8)) z.x = nx; else if (z.grounded && !boxHit(s, z.x, z.y + 1.05, z.z, 0.3, 1.8)) z.vy = 7.6;
      const nz = z.z + hvz * dt; if (!boxHit(s, z.x, z.y, nz, 0.3, 1.8)) z.z = nz; else if (z.grounded && !boxHit(s, z.x, z.y + 1.05, z.z, 0.3, 1.8)) z.vy = 7.6;
      const ny = z.y + z.vy * dt; z.grounded = false;
      if (!boxHit(s, z.x, ny, z.z, 0.3, 1.8)) z.y = ny; else if (z.vy < 0) { z.y = Math.floor(ny) + 1.0001; z.vy = 0; z.grounded = true; } else { z.y = Math.floor(ny + 1.8) - 1.8 - 0.0001; z.vy = 0; }
      if (dm < 0.95 && Math.abs(z.y - p.y) < 1.5) { hurt(s, 3, 'zombi'); p.vy = 5; const m2 = Math.hypot(p.x - z.x, p.z - z.z) || 1; p.vx = (p.x - z.x) / m2 * 6; p.vz = (p.z - z.z) / m2 * 6; }
      // quema al amanecer si está al aire libre
      if (!night && Math.random() < dt * 0.5 && !solidAt(s, z.x, z.y + 2.2, z.z) && z.y > s.top[clamp(Math.floor(z.z), 0, D - 1) * W + clamp(Math.floor(z.x), 0, W - 1)] - 1) { burst3d([z.x, z.y + 1, z.z], ['#ff8a3d', '#ffd54a'], 16, { speed: 3, up: 3, size: 0.16 }); z.hp = 0; }
    });
    s.zombies = s.zombies.filter(z => z.hp > 0 && Math.hypot(z.x - p.x, z.z - p.z) < 36 && z.y > -3);
  });

  const s = g.current, p = s.p;
  const sunV = Math.sin(s.clock * PI * 2), a = s.clock * PI * 2, night = sunV < -0.1;
  const depth = s.top[clamp(Math.floor(p.z), 0, D - 1) * W + clamp(Math.floor(p.x), 0, W - 1)] - (p.y + 1.6), u = clamp((depth - 3) / 9, 0, 1);
  const dayK = clamp((sunV + 0.15) / 0.5, 0, 1), duskK = clamp(1 - Math.abs(sunV) / 0.3, 0, 1) * 0.9;
  let top = mix('#05091f', '#3a8fe8', dayK), bot = mix('#16224a', '#bfe6ff', dayK);
  top = mix(top, '#5a3a8a', duskK); bot = mix(bot, '#ff9a6a', duskK);
  const topU = mix(top, '#080810', u), botU = mix(bot, '#0a0a12', u);
  const sunDir = sunV >= 0 ? [cs(a) * 0.9, sunV + 0.05, 0.35] : [-cs(a) * 0.9, -sunV + 0.05, -0.35];
  const eye = [p.x, p.y + 1.62 + Math.sin(s.bob) * 0.04 * (s.moving ? 1 : 0), p.z];
  const cam = { p: eye, yaw: s.yaw, pitch: s.pitch, fov: 74 };
  const hold = s.sel && s.inv[s.sel] ? s.sel : 0;
  const buildScene = () => {
    const objs = [];
    s.zombies.forEach(z => { if (Math.hypot(z.x - p.x, z.z - p.z) < 30) objs.push(...enemy(`z${z.id}`, 'zombi', [z.x, z.y, z.z], { yaw: z.yaw, t: z.t, walk: z.walk || 0, flash: z.flash > 0 })); });
    const tg = s.target;
    if (tg && tg.b != null) {
      objs.push({ id: 'sel', k: 'box', p: [tg.x + 0.5, tg.y + 0.5, tg.z + 0.5], s: [1.03, 1.03, 1.03], c: '#ffffff', e: 0.7, o: 0.18 });
      if (s.mine && s.mine.prog > 0.02) objs.push({ id: 'crack', k: 'box', p: [tg.x + 0.5, tg.y + 0.5, tg.z + 0.5], s: [1.012, 1.012, 1.012], c: '#000000', o: Math.min(0.7, s.mine.prog * 0.75) });
    }
    // mano: brazo + pico / bloque / antorcha, con balanceo al minar
    const sw = s.swing > 0 ? Math.sin((1 - s.swing / 0.28) * PI) : 0, bobx = Math.sin(s.bob * 0.5) * 0.012 * (s.moving ? 1 : 0), boby = Math.abs(Math.sin(s.bob * 0.5)) * 0.015 * (s.moving ? 1 : 0);
    const hx0 = 0.15 + bobx - sw * 0.03, hy0 = -0.34 + boby + sw * 0.04, hz0 = -0.85 - sw * 0.08, rx = -0.4 - sw * 1.1;
    objs.push(camObj(cam, 'arm', 'box', [hx0 + 0.03, hy0 - 0.2, hz0 + 0.1], [0.06, 0.06, 0.32], '#e0b890', rx + 0.3));
    if (hold && hold !== 14) objs.push(camObj(cam, 'hb', 'box', [hx0, hy0 + 0.02, hz0 - 0.04], [0.1, 0.1, 0.1], shade(BLK[hold][0], 1), rx + 0.4, { e: 0.05 }));
    else if (hold === 14) { objs.push(camObj(cam, 'ht', 'box', [hx0, hy0 + 0.02, hz0 - 0.04], [0.025, 0.17, 0.025], '#6a4a24', rx), camObj(cam, 'htf', 'box', [hx0, hy0 + 0.12, hz0 - 0.05], [0.05, 0.06, 0.05], '#ffb83a', rx, { e: 1 })); }
    else {
      objs.push(camObj(cam, 'ph', 'box', [hx0, hy0 + 0.06, hz0 - 0.06], [0.022, 0.22, 0.022], '#7a4e22', rx));
      objs.push(camObj(cam, 'pk', 'box', [hx0, hy0 + 0.17, hz0 - 0.08], [0.14, 0.03, 0.03], PICK_COL[s.tier], rx, s.tier === 3 ? { m: { r: 0.3, m: 0.6 } } : undefined));
    }
    // luces: antorchas cercanas, antorcha en la mano y linterna bajo tierra
    const lights = [];
    s.torches.map(q => ({ q, d: Math.hypot(q[0] - p.x, q[1] - p.y, q[2] - p.z) })).sort((m, n) => m.d - n.d).slice(0, 3).forEach(o => { if (o.d < 14) lights.push({ p: o.q, c: '#ffb860', i: 7 + Math.sin(s.t * 13 + o.q[0]) * 0.8, d: 11 }); });
    if (hold === 14) lights.unshift({ p: [eye[0], eye[1] - 0.2, eye[2]], c: '#ffb860', i: 7, d: 11 });
    if (u > 0.05 && lights.length < 4) lights.push({ p: [eye[0], eye[1], eye[2]], c: '#ffe0b0', i: 4 * u, d: 8 });
    return {
      sky: { top: topU, bottom: botU, sun: u < 0.9, sunC: sunV >= 0 ? '#fff2c0' : '#e8f0ff', clouds: u > 0.5 ? 0 : 8, cloud: night ? '#6a74a8' : '#ffffff' },
      fog: { c: botU, near: 16 - u * 6, far: 38 - u * 14 },
      light: { dir: sunDir, sun: sunV >= 0 ? mix('#ff9a5a', '#fff4dc', clamp(sunV * 2, 0, 1)) : '#8a9cff', i: (sunV >= 0 ? 2.4 * clamp(sunV * 2.2, 0.25, 1) : 1.2) * (1 - u * 0.95), sky: mix('#4a5a9a', '#dfeaff', dayK), ground: '#5b5648', hi: Math.max(0.55, (0.8 + dayK * 1.1) * (1 - u * 0.8)) },
      shadowR: 20, lights: lights.slice(0, 4), statics: s.statics, objs, cam,
    };
  };
  const scene = phase === 'play' ? buildScene() : null;
  const menuScene = t => {
    const c = [32 + Math.sin(t * 0.2) * 3, s.top[32 * W + 32] + 2, 32];
    const sc = buildScene(); return { ...sc, objs: [], lights: [], cam: { p: [c[0] + 9, c[1] + 6, c[2] + 9], l: [32, c[1] - 1, 32], fov: 58 }, light: { dir: [-0.5, 0.75, 0.45] }, sky: { top: '#3a8fe8', bottom: '#bfe6ff', clouds: 8 }, fog: { c: '#bfe6ff', near: 24, far: 60 } };
  };
  const hearts = Array.from({ length: 10 }, (_, i) => (p.hp >= (i + 1) * 2 ? '❤️' : p.hp >= i * 2 + 1 ? '💔' : '🖤')).join('');
  const inv = Object.entries(s.inv).filter(([k, v]) => v > 0);
  const score = s.mined + s.oreScore + s.kills * 10 + s.maxDepth * 2;
  const sc2 = s.final != null ? s.final : score;
  return (
    <Game3D title="PIXEL CRAFT" emoji="⛏️" accent={C.orange} onExit={onExit} score={sc2} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene || menuScene(0)} menuScene={menuScene} orbit={{ r: 14, h: 7, speed: 0.15, ly: 1, drop: 1.2 }}
      hud={<><Text style={{ fontSize: 12 }}>{hearts}</Text><HudPill icon="⛏️" value={PICK[s.tier].replace('Pico de ', '').replace('Manos', 'manos')} color={C.amber} /><HudPill icon={night ? '🌙' : '☀️'} value={night ? 'NOCHE' : 'DÍA'} color={night ? C.violet : C.amber} /></>}
      subtitle="Mina, fabrica y sobrevive a la noche en un mundo de bloques"
      lines={['Mantén ⛏ para minar el bloque que apuntas (la mira del centro)', '🧱 coloca el bloque elegido · 🔨 fabrica picos, espadas y antorchas', 'Joystick izquierdo: moverte · derecho: mirar · SALTAR', 'De noche salen 🧟 zombis: golpéalos con ⛏ · cuidado con la lava']}
      result={{ won: false, isNew: res.isNew, emoji: '💀', title: res.why === 'zombi' ? 'DEVORADO' : res.why === 'lava' ? 'FUNDIDO EN LAVA' : res.why === 'caída' ? 'CAÍDA MORTAL' : 'FIN DEL JUEGO', subtitle: `${s.mined} bloques · ${s.kills} zombis · profundidad ${s.maxDepth}`, stats: [['BLOQUES', s.mined], ['ZOMBIS', s.kills], ['PROFUNDIDAD', s.maxDepth]] }}>
      {phase === 'play' && <>
        <View collapsable={false} ref={r => { if (r && r.measureInWindow && !offY) r.measureInWindow((x, y) => { if (y > 20) setOffY(y); }); }} pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1 }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: SCREEN_W / 2 - 12, top: SCREEN_H / 2 - (offY || 88) - 12, width: 24, height: 24 }}>
          <View style={{ position: 'absolute', left: 11, top: 4, width: 2, height: 16, backgroundColor: 'rgba(255,255,255,0.85)' }} /><View style={{ position: 'absolute', left: 4, top: 11, width: 16, height: 2, backgroundColor: 'rgba(255,255,255,0.85)' }} />
        </View>
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: 56, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: '900', ...tglow('#000', 5) }}>{s.toast.m}</Text>}
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 8, right: 66, top: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          {inv.slice(0, 8).map(([k, v]) => { const d = BLK[k], on = s.sel === Number(k); return (
            <Pressable key={k} testID={`inv-${k}`} onPressIn={() => { s.sel = Number(k); hx.tick(); }}>
              <View style={{ width: 38, height: 38, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 2, borderColor: on ? C.lime : 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                {Number(k) === 14 ? <Text style={{ fontSize: 18 }}>🔦</Text> : <View style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: Number(k) === 1 ? d[1] : d[0], borderWidth: 2, borderColor: VALUE[k] ? d[1] : shade(d[0], 0.6) }} />}
                <Text style={{ position: 'absolute', right: 2, bottom: 0, color: '#fff', fontSize: 11, fontWeight: '900', ...tglow('#000', 3) }}>{v}</Text>
              </View>
            </Pressable>); })}
        </View>
        <ActionBtn testID="pc-craft" icon="🔨" color={C.cyan} size={46} onDown={() => { s.craft = true; setCraftOpen(true); hx.tick(); }} style={{ right: 8, top: 4 }} />
        <Stick3D testID="pc-move" v={move} side="left" color={C.orange} />
        <Stick3D testID="pc-look" v={look} side="right" color={C.cyan} />
        <ActionBtn testID="pc-jump" icon="⬆" label="SALTAR" color={C.pink} size={66} onDown={() => { if (g.current.p.ground) { g.current.p.vy = 8.6; g.current.p.ground = false; hx.tap(); } }} style={{ left: '50%', marginLeft: -33, bottom: 34 }} />
        <ActionBtn testID="pc-mine" icon="⛏️" label="MINAR" color={C.amber} size={74} onDown={() => { g.current.mining = true; }} onUp={() => { g.current.mining = false; }} style={{ right: 12, bottom: 200 }} />
        <ActionBtn testID="pc-place" icon="🧱" label="PONER" color={C.lime} size={58} onDown={place} style={{ right: 98, bottom: 206 }} />
        {craftOpen && (
          <View style={{ position: 'absolute', left: 10, right: 10, top: 6, bottom: 8, borderRadius: 18, backgroundColor: 'rgba(8,8,18,0.95)', borderWidth: 2, borderColor: alpha(C.cyan, 0.6), padding: 12, zIndex: 30 }}>
            <Text style={{ color: C.cyan, fontWeight: '900', letterSpacing: 2, fontSize: 14, textAlign: 'center', marginBottom: 8 }}>🔨 FABRICACIÓN</Text>
            <ScrollView>{RECIPES.map(r => { const ok = canPay(s, r.cost), done = (r.tier && s.tier >= r.tier) || (r.sword && s.sword >= r.sword); return (
              <Pressable key={r.id} testID={`rc-${r.id}`} onPress={() => craft(r)} style={{ opacity: ok && !done ? 1 : 0.45, marginBottom: 6 }}>
                <View style={{ padding: 10, borderRadius: 12, backgroundColor: alpha(C.cyan, 0.1), borderWidth: 1.5, borderColor: alpha(C.cyan, 0.5) }}>
                  <Text style={{ color: C.text, fontWeight: '800', fontSize: 13 }}>{r.label}{done ? '  ✓' : ''}</Text>
                  <Text style={{ color: C.dim, fontSize: 11 }}>Cuesta: {Object.entries(r.cost).map(([k, v]) => `${v} ${BLK[k][5]} (${s.inv[k] || 0})`).join(' · ')}</Text>
                </View>
              </Pressable>); })}</ScrollView>
            <Btn3D size="sm" ghost color={C.dim} label="CERRAR" onPress={() => { s.craft = false; setCraftOpen(false); }} />
          </View>
        )}
      </>}
    </Game3D>
  );
}
