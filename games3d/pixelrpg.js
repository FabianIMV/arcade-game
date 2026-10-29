/**
 * Pixel RPG 3D – RPG de mundo abierto procedural en tercera persona (motor 3D v2).
 * Un mundo nuevo cada partida: praderas, bosque, pantano, montañas y tierras de ceniza con el volcán del Dragón Ancestral.
 * Aldeas con tienda y posada, cofres, ancianos con pistas, monstruos que patrullan y te persiguen fuera de los caminos,
 * combate por turnos en una arena 3D (ataque, defensa, pociones, éter, hechizos con partículas: 🔥 Fuego, 💚 Curar, ⚡ Rayo).
 * Reglas, estadísticas, mapa, guardado y puntuación son los del juego original.
 * Controles: joystick izquierdo caminar · derecho girar la cámara.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Bar, C, SCREEN_H, SCREEN_W, alpha, clamp, hx, pick, randInt, tglow, uid, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Btn3D, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { animal, bush, chest, coin, dragon, enemy, flower, hash01, house, person, rock, shade, tree } from '../utils/prefabs';
import { compassAngle, followCam, forward, project, right, seeded } from '../utils/openworld';

const PI = Math.PI, cs = Math.cos, sn = Math.sin;
const rotX = a => [1, 0, 0, 0, cs(a), -sn(a), 0, sn(a), cs(a)];
const rotY = a => [cs(a), 0, sn(a), 0, 1, 0, -sn(a), 0, cs(a)];
const rotZ = a => [cs(a), -sn(a), 0, sn(a), cs(a), 0, 0, 0, 1];
const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8]];
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const rotXYZ = r => mul(rotX(r[0]), mul(rotY(r[1]), rotZ(r[2])));
const eul = m => { const y = Math.asin(Math.max(-1, Math.min(1, m[2]))); if (Math.abs(m[2]) < 0.9999999) return [Math.atan2(-m[5], m[8]), y, Math.atan2(-m[1], m[0])]; return [Math.atan2(m[7], m[4]), y, 0]; };
function Bld(id, p, o = {}) {
  const n = o.n == null ? 1 : o.n;
  const G = (o.yaw || o.roll || o.pitch) ? mul(rotY(o.yaw || 0), mul(rotX(o.pitch || 0), rotZ(o.roll || 0))) : null;
  const out = [];
  const add = (name, k, lp, ls, c, x) => {
    x = x || {};
    const q = G ? mv(G, lp) : lp; const r = x.r || null;
    const ob = { id: id + '.' + name, k, p: [p[0] + q[0] * n, p[1] + q[1] * n, p[2] + q[2] * n], c: o.flash ? '#ffffff' : c };
    if (typeof ls === 'number') ob.n = ls * n; else ob.s = [ls[0] * n, ls[1] * n, ls[2] * n];
    if (G) ob.r = eul(mul(G, r ? rotXYZ(r) : [1, 0, 0, 0, 1, 0, 0, 0, 1])); else if (r) ob.r = r;
    if (o.flash) ob.e = 0.75; else if (x.e) ob.e = x.e;
    const op = (o.o != null ? o.o : 1) * (x.o != null ? x.o : 1); if (op < 1) ob.o = op;
    if (x.m) ob.m = x.m;
    if (x.sh !== false && o.sh !== false && !ob.o) ob.sh = true;
    out.push(ob); return ob;
  };
  return { add, out };
}

// ─── mapa (mismas reglas que el juego 2D) ───
const RPG_W = 28, RPG_H = 28, TS = 2, HALF = RPG_W * TS / 2, SAVE = '@rpg_save2';
const wx = tx => (tx + 0.5) * TS - HALF;
const RPG_ZONES = [
  { name: 'Praderas', enc: 0.1, pool: [0, 1, 2], c: '#62b64e', arena: '#5ab04e' }, { name: 'Bosque', enc: 0.2, pool: [1, 3, 4, 5], c: '#2e7d3c', arena: '#2f8a44' },
  { name: 'Pantano', enc: 0.22, pool: [6, 7, 8], c: '#4f6e3c', arena: '#4a6a44' }, { name: 'Montañas', enc: 0.26, pool: [9, 10, 11], c: '#8e8c84', arena: '#7a7a82' },
  { name: 'Tierras de ceniza', enc: 0.3, pool: [12, 13, 14], c: '#3a2e2c', arena: '#3a2a28' },
];
const RPG_ENEMIES = [
  { name: 'Slime', e: '🟢', hp: 14, atk: 5, xp: 8, gold: 4 }, { name: 'Goblin', e: '👺', hp: 20, atk: 7, xp: 13, gold: 7 }, { name: 'Murciélago', e: '🦇', hp: 14, atk: 8, xp: 11, gold: 5 },
  { name: 'Lobo', e: '🐺', hp: 28, atk: 10, xp: 20, gold: 9 }, { name: 'Bandido', e: '🥷', hp: 30, atk: 11, xp: 24, gold: 18 }, { name: 'Araña gigante', e: '🕷️', hp: 26, atk: 12, xp: 22, gold: 8 },
  { name: 'Cocodrilo', e: '🐊', hp: 44, atk: 14, xp: 34, gold: 14 }, { name: 'Zombi', e: '🧟', hp: 48, atk: 13, xp: 36, gold: 12 }, { name: 'Slime tóxico', e: '🟣', hp: 38, atk: 15, xp: 32, gold: 16 },
  { name: 'Golem', e: '🗿', hp: 68, atk: 17, xp: 52, gold: 22 }, { name: 'Arpía', e: '🦅', hp: 52, atk: 19, xp: 50, gold: 20 }, { name: 'Troll', e: '👹', hp: 80, atk: 20, xp: 62, gold: 28 },
  { name: 'Demonio', e: '😈', hp: 90, atk: 24, xp: 85, gold: 38 }, { name: 'Esqueleto', e: '💀', hp: 76, atk: 23, xp: 78, gold: 30 }, { name: 'Elemental', e: '🔥', hp: 84, atk: 26, xp: 90, gold: 40 },
];
const RPG_BOSS = { name: 'Dragón Ancestral', e: '🐉', hp: 220, atk: 30, xp: 400, gold: 300, boss: true };
const RPG_HINTS = ['«El Dragón duerme en el volcán, al noreste. Ve preparado… nivel 7 como mínimo.»', '«En las montañas hay golems. ¡Lleva pociones y éter!»', '«Defenderte reduce mucho el daño cuando el enemigo carga un golpe.»'];
function rpgRng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const progress = (x, y) => (x + (RPG_H - 1 - y)) / (RPG_W + RPG_H - 2);
const zoneIdx = (x, y) => { const p = progress(x, y); return p < 0.25 ? 0 : p < 0.5 ? 1 : p < 0.7 ? 2 : p < 0.88 ? 3 : 4; };
const RPG_START = { x: 3, y: RPG_H - 4 };
function genWorld(seed) {
  const rnd = rpgRng(seed);
  const t = Array.from({ length: RPG_H }, () => Array(RPG_W).fill('.'));
  for (let y = 0; y < RPG_H; y++) for (let x = 0; x < RPG_W; x++) {
    if (x < 2 || y < 2 || x >= RPG_W - 2 || y >= RPG_H - 2) { t[y][x] = 'T'; continue; }
    const p = progress(x, y), r = rnd();
    if (p < 0.25) t[y][x] = r < 0.08 ? 'T' : '.';
    else if (p < 0.5) t[y][x] = r < 0.3 ? 'T' : r < 0.55 ? 'f' : '.';
    else if (p < 0.7) t[y][x] = r < 0.12 ? '~' : r < 0.2 ? 'T' : r < 0.45 ? 'f' : '.';
    else if (p < 0.88) t[y][x] = r < 0.12 ? '^' : r < 0.2 ? 'T' : r < 0.75 ? 'm' : '.';
    else t[y][x] = r < 0.1 ? '#' : r < 0.2 ? '^' : 'v';
  }
  const target = { x: RPG_W - 6, y: 5 };
  let cx = RPG_START.x, cy = RPG_START.y; const road = [];
  while (cx !== target.x || cy !== target.y) {
    t[cy][cx] = '='; road.push([cx, cy]);
    const dx = target.x - cx, dy = target.y - cy;
    const horiz = Math.abs(dx) > 0 && (Math.abs(dy) === 0 || rnd() < Math.abs(dx) / (Math.abs(dx) + Math.abs(dy)));
    if (horiz) cx += Math.sign(dx); else cy += Math.sign(dy);
    if (rnd() < 0.18) { const wob = rnd() < 0.5 ? -1 : 1, nx = cx, ny = cy + wob; if (ny > 2 && ny < RPG_H - 3) { t[ny][nx] = '='; road.push([nx, ny]); } }
  }
  t[cy][cx] = '=';
  const clear = (x, y, r) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (t[y + j] && t[y + j][x + i] !== undefined && t[y + j][x + i] !== '=') t[y + j][x + i] = '.'; };
  clear(RPG_START.x, RPG_START.y, 2); t[RPG_START.y][RPG_START.x] = 'H';
  const vil = road[Math.floor(road.length * 0.52)];
  clear(vil[0], vil[1], 1); t[vil[1]][vil[0]] = 'V';
  clear(target.x, target.y, 1); t[target.y - 1][target.x] = 'L'; t[target.y][target.x] = '=';
  for (let j = -2; j <= 0; j++) for (let i = -2; i <= 2; i++) if (!(i === 0 && j === -1) && !(i === 0 && j === 0) && t[target.y + j - 1] && !(j === 0 && i === 0)) { if (t[target.y + j - 1][target.x + i] !== 'L' && j < 0) t[target.y + j - 1][target.x + i] = '#'; }
  t[target.y - 1][target.x] = 'L';
  let placed = 0;
  while (placed < 7) { const x = 3 + Math.floor(rnd() * (RPG_W - 6)), y = 3 + Math.floor(rnd() * (RPG_H - 6)); if (t[y][x] === '.' || t[y][x] === 'f' || t[y][x] === 'v' || t[y][x] === 'm') { if (Math.abs(x - RPG_START.x) + Math.abs(y - RPG_START.y) > 4) { t[y][x] = 'c'; placed++; } } }
  [0.18, 0.4, 0.7].forEach(f => { const p = road[Math.floor(road.length * f)], nx = p[0], ny = p[1] - 1; if (t[ny] && t[ny][nx] !== '=' && t[ny][nx] !== 'H' && t[ny][nx] !== 'V') t[ny][nx] = 'N'; else if (t[p[1] + 1] && t[p[1] + 1][p[0]] !== '=') t[p[1] + 1][p[0]] = 'N'; });
  return t.map(r => r.join(''));
}
const tileOf = (w, x, z) => { const tx = Math.floor((x + HALF) / TS), tz = Math.floor((z + HALF) / TS); return tx < 0 || tz < 0 || tx >= RPG_W || tz >= RPG_H ? 'T' : w.map[tz][tx]; };
const blockedAt = (w, x, z, r = 0.4) => {
  for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) { const c = tileOf(w, x + dx, z + dz); if (c === 'T' || c === '~' || c === '^' || c === '#') return true; }
  for (const k of w.cols) if (Math.hypot(k.x - x, k.z - z) < k.r + r) return true;
  return false;
};
function mask(w, x, z, set) {   // máscara suave de tiles de ciertos tipos (bilinear sobre centros de tile)
  const fx = (x + HALF) / TS - 0.5, fz = (z + HALF) / TS - 0.5, x0 = Math.floor(fx), z0 = Math.floor(fz), u = fx - x0, v = fz - z0;
  const q = (a, b) => (a < 0 || b < 0 || a >= RPG_W || b >= RPG_H ? 0 : set.includes(w.map[b][a]) ? 1 : 0);
  return (q(x0, z0) * (1 - u) + q(x0 + 1, z0) * u) * (1 - v) + (q(x0, z0 + 1) * (1 - u) + q(x0 + 1, z0 + 1) * u) * v;
}
const mkHeight = w => (x, z) => {
  const pz = progress((x + HALF) / TS, (z + HALF) / TS);
  const amp = pz < 0.25 ? 0.4 : pz < 0.5 ? 0.55 : pz < 0.7 ? 0.25 : pz < 0.88 ? 0.9 : 0.5;
  let y = amp * (0.5 * Math.sin(x * 0.2) * Math.cos(z * 0.17) + 0.4 * Math.sin(x * 0.09 + z * 0.12)) + 0.25;
  y += mask(w, x, z, ['m']) * 2.0 - mask(w, x, z, ['~']) * 1.7;
  const ex = Math.max(0, Math.abs(x) - HALF + 1), ez = Math.max(0, Math.abs(z) - HALF + 1), e = Math.hypot(ex, ez);
  y -= Math.min(1, e / 4) * Math.min(1, e / 4) * 3.2 + (e > 0 ? 0.4 : 0);
  return y;
};
const tcol = (w, x, z, y) => {
  const c = tileOf(w, x, z), zn = RPG_ZONES[zoneIdx((x + HALF) / TS, (z + HALF) / TS)], v = 0.92 + hash01(x.toFixed(1) + ',' + z.toFixed(1)) * 0.16;
  if (c === '=') return shade('#b99560', v); const wm = mask(w, x, z, ['~']); if (wm > 0.15) return shade(wm > 0.7 ? '#9a8e68' : '#d8c890', v);
  let b = zn.c; if (c === 'm' && y > 2.3) b = '#d8dcea'; else if (c === 'm') b = '#8e8c84';
  return shade(b, v);
};
// decorado fijo del mundo (instancing) + colliders de edificios
function buildStatics(w) {
  const st = [], r = seeded(w.seed), cols = [];
  const at = (tx, tz) => [wx(tx), wx(tz)];
  for (let tz = 0; tz < RPG_H; tz++) for (let tx = 0; tx < RPG_W; tx++) {
    const ch = w.map[tz][tx], [x, z] = at(tx, tz), y = w.h(x, z), id = `${tx}_${tz}`, zi = zoneIdx(tx, tz), j = () => (r() - 0.5) * 1.2;
    if (ch === 'T') {
      const kind = zi === 0 ? (r() < 0.5 ? 'oak' : 'birch') : zi === 1 ? (r() < 0.6 ? 'pine' : 'oak') : zi === 2 ? (r() < 0.5 ? 'dead' : 'oak') : zi === 3 ? 'pine' : 'dead';
      st.push(...tree(`t${id}`, [x + j() * 0.5, y, z + j() * 0.5], { kind, h: 0.9 + r() * 0.5, snow: zi === 3 && y > 1.6, inst: 'arbol', leaf: zi === 2 ? '#4a7a3a' : undefined }));
    } else if (ch === '^') st.push(...rock(`r${id}`, [x, y, z], { kind: 'boulder', inst: 'roca', h: 0.75, c: zi === 4 ? '#4a4040' : '#8c8f99' }));
    else if (ch === 'm') { if (r() < 0.5) st.push(...rock(`mr${id}`, [x + j(), y, z + j()], { kind: 'rock', inst: 'roca', c: '#8a8880' })); }
    else if (ch === 'f') { for (let i = 0; i < 3; i++) st.push(...flower(`f${id}_${i}`, [x + j(), y, z + j()], { inst: 'flor', c: pick(['#ff6fa8', '#ffd54a', '#ffffff', '#b57bff']) })); st.push(...bush(`b${id}`, [x + j(), y, z + j()], { inst: 'arbusto', c: zi === 2 ? '#5a7a3a' : '#3f9b45' })); }
    else if (ch === '#') { st.push({ id: `w${id}`, k: 'box', p: [x, y + 0.9, z], s: [2, 1.8 + r() * 0.4, 2], c: shade('#4a3a3e', 0.8 + r() * 0.4), inst: 'muro', sh: true, recv: true }); if (r() < 0.6) st.push({ id: `wc${id}`, k: 'box', p: [x + j() * 0.4, y + 2.1, z], s: [0.6, 0.5, 0.6], c: '#5a4a4e', inst: 'muro2', sh: true }); }
    else if (ch === 'v') { if (r() < 0.3) st.push({ id: `lv${id}`, k: 'box', p: [x + j(), y + 0.03, z + j()], s: [0.2, 0.04, 1.2 + r()], r: [0, r() * 3, 0], c: '#ff5a1a', e: 1, inst: 'lava' }); }
    else if (ch === '=' && r() < 0.18) st.push(...rock(`pr${id}`, [x + j() * 1.2, y, z + j() * 1.2], { kind: 'rock', inst: 'piedra', h: 0.3, c: '#9a8a6a' }));
    else if (ch === '.' && r() < 0.12) for (let i = 0; i < 3; i++) st.push({ id: `u${id}_${i}`, k: 'cone', p: [x + j(), y + 0.15, z + j()], s: [0.1, 0.34, 0.1], c: shade(RPG_ZONES[zi].c, 1.1 + r() * 0.2), inst: 'hierba' });
    if (ch === 'H') {
      [[3.6, -3.4, 0.3, 'cottage'], [4.6, 1.6, -0.4, 'hut'], [-0.6, -4.6, 0.1, 'cottage']].forEach(([dx, dz, yaw, kind], i) => { st.push(...house(`vh${i}`, [x + dx, w.h(x + dx, z + dz), z + dz], { kind, yaw, lit: true })); cols.push({ x: x + dx, z: z + dz, r: 2.7 }); });
      st.push({ id: 'wellB', k: 'cyl', p: [x - 2, y + 0.4, z - 1.5], s: [1.3, 0.8, 1.3], c: '#8a8d96', sh: true }, { id: 'wellW', k: 'cyl', p: [x - 2, y + 0.75, z - 1.5], s: [0.9, 0.1, 0.9], c: '#2a90e0', e: 0.3 }); cols.push({ x: x - 2, z: z - 1.5, r: 1 });
      for (const [dx, dz] of [[2, 2.4], [-2.4, 2.4]]) st.push({ id: `lp${dx}`, k: 'cyl', p: [x + dx, y + 1.1, z + dz], s: [0.12, 2.2, 0.12], c: '#3a2a20', sh: true }, { id: `lpl${dx}`, k: 'sph', p: [x + dx, y + 2.3, z + dz], n: 0.4, c: '#ffd27a', e: 1 });
    } else if (ch === 'V') {
      [[-3.2, -2.2, 'tower'], [3.4, -2.4, 'tower'], [0, 3.6, 'cottage']].forEach(([dx, dz, kind], i) => { st.push(...house(`vf${i}`, [x + dx, w.h(x + dx, z + dz), z + dz], { kind, yaw: i === 2 ? 0 : 0.1, lit: true })); cols.push({ x: x + dx, z: z + dz, r: 2.2 }); });
      st.push({ id: 'fwall', k: 'box', p: [x, y + 0.8, z - 3.6], s: [6.4, 1.6, 0.8], c: '#8a8a95', sh: true, recv: true }); cols.push({ x, z: z - 3.6, r: 2.4 });
    } else if (ch === 'L') {
      st.push({ id: 'vol', k: 'cone', p: [x, y + 5, z - 3], s: [16, 10, 16], c: '#3a2420', sh: true, recv: true, m: { r: 1, m: 0 } }, { id: 'vol2', k: 'cone', p: [x, y + 8.4, z - 3], s: [8.5, 4.5, 8.5], c: '#4a2a22', sh: true }, { id: 'volc', k: 'cyl', p: [x, y + 10.4, z - 3], s: [4.2, 0.6, 4.2], c: '#ff6a1a', e: 1, inst: 'lavaG' }, { id: 'volr', k: 'tor', p: [x, y + 10.3, z - 3], r: [PI / 2, 0, 0], n: 5.6, c: '#5a2a1e' });
      for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2 + 0.4; st.push({ id: `vs${i}`, k: 'box', p: [x + Math.cos(a) * 3.3, y + 6.2, z - 3 + Math.sin(a) * 3.3], s: [0.5, 5, 0.5], r: [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7], c: '#ff7a2a', e: 1, inst: 'lavaG' }); }
      st.push({ id: 'arcL', k: 'box', p: [x - 1.7, y + 1.4, z], s: [0.9, 2.8, 1], c: '#2a1a1a', sh: true }, { id: 'arcR', k: 'box', p: [x + 1.7, y + 1.4, z], s: [0.9, 2.8, 1], c: '#2a1a1a', sh: true }, { id: 'arcT', k: 'box', p: [x, y + 3.0, z], s: [4.3, 0.8, 1], c: '#2a1a1a', sh: true }, { id: 'arcG', k: 'pla', p: [x, y + 0.05, z], s: [2.6, 2.6, 1], c: '#ff4d1a', e: 1 });
      w.lair = [x, y, z];
    }
  }
  w.cols = cols; return st;
}
const mkWorld = (seed, opened) => {
  const w = { seed, map: genWorld(seed).map(r => r.split('')), cols: [] };
  (opened || []).forEach(([x, y]) => { w.map[y][x] = '.'; });
  w.map = w.map.map(r => r.join(''));
  w.h = mkHeight(w); w.statics = buildStatics(w);
  w.terrain = { id: 'rpg' + seed, h: w.h, size: 64, step: 1, color: (y, x, z) => tcol(w, x, z, y) };
  return w;
};
const arenaFor = (() => { const cache = {}; return (zi, boss) => {
  const key = boss ? 'b' : zi; if (cache[key]) return cache[key];
  const st = [], r = seeded(31 + zi), col = boss ? '#2a1612' : RPG_ZONES[zi].arena;
  st.push({ id: 'disc', k: 'cyl', p: [0, -0.3, 0], s: [28, 0.6, 28], c: col, recv: true }, { id: 'ring', k: 'cyl', p: [0, -0.24, 0], s: [14.6, 0.6, 14.6], c: boss ? '#5a2a1e' : shade(col, 1.25), recv: true });
  if (boss) {
    for (let i = 0; i < 10; i++) { const a = i / 10 * PI * 2; st.push({ id: `bp${i}`, k: 'cyl', p: [Math.cos(a) * 12, 1.4, Math.sin(a) * 12], s: [1.1, 2.8, 1.1], c: '#3a2420', sh: true }, { id: `bf${i}`, k: 'cone', p: [Math.cos(a) * 12, 3.3, Math.sin(a) * 12], s: [0.9, 1.4, 0.9], c: '#ff7a2a', e: 1, inst: 'fuego' }); }
    for (let i = 0; i < 14; i++) st.push({ id: `bl${i}`, k: 'box', p: [(r() - 0.5) * 30, -0.05, (r() - 0.5) * 30], s: [0.3, 0.06, 2 + r() * 3], r: [0, r() * 3, 0], c: '#ff5a1a', e: 1, inst: 'lava' });
  } else {
    for (let i = 0; i < 22; i++) { const a = r() * PI * 2, d = 12 + r() * 14; st.push(...tree(`at${i}`, [Math.cos(a) * d, -0.2, Math.sin(a) * d], { kind: zi === 3 ? 'pine' : zi === 4 ? 'dead' : zi === 2 ? 'dead' : r() < 0.5 ? 'pine' : 'oak', inst: 'aArbol', h: 1.1 })); }
    for (let i = 0; i < 12; i++) { const a = r() * PI * 2, d = 8 + r() * 4; st.push(...rock(`ar${i}`, [Math.cos(a) * d, -0.1, Math.sin(a) * d], { inst: 'aRoca', kind: 'rock' })); }
    if (zi < 2) for (let i = 0; i < 40; i++) { const a = r() * PI * 2, d = 3 + r() * 9; st.push(...flower(`af${i}`, [Math.cos(a) * d, 0, Math.sin(a) * d], { inst: 'aFlor', c: pick(['#ff6fa8', '#ffd54a', '#ffffff', '#b57bff']) })); }
  }
  return (cache[key] = st);
}; })();

// ─── modelos ───
const wizard = (id, pos, o) => {
  const out = person(id, pos, { yaw: o.yaw, t: o.t, walk: o.walk, arms: o.arms, shirt: '#7a4fd6', pants: '#4b2f8a', hair: '#e8e8f0', skin: '#f2c9a0', eyeC: '#7af0ff', flash: o.flash, n: o.n, o: o.o });
  const X = Bld(id + 'x', pos, { yaw: o.yaw, n: o.n, flash: o.flash, o: o.o });
  X.add('robe', 'cone', [0, 0.62, 0], [1.0, 1.15, 0.9], '#6a3fc6'); X.add('trim', 'cyl', [0, 0.08, 0], [1.02, 0.1, 0.9], '#ffc233', { e: 0.4, sh: false });
  X.add('hat', 'cone', [0, 2.08, 0], [0.55, 0.8, 0.55], '#4a2fa6', { r: [-0.18, 0, 0.1] }); X.add('brim', 'cyl', [0, 1.8, 0], [0.74, 0.05, 0.74], '#4a2fa6', { sh: false }); X.add('star', 'sph', [0.02, 2.4, 0.1], 0.1, '#ffd54a', { e: 1, sh: false });
  const sw = o.cast ? -0.9 : 0;
  X.add('staff', 'cyl', [0.42, 1.0, -0.38 + sw * 0.2], [0.07, 2.0, 0.07], '#6b4524', { r: [sw * 0.4, 0, 0] });
  X.add('orb', 'sph', [0.42, 2.08, -0.38 + sw * 0.5], 0.26 + (o.cast ? 0.1 : 0) + Math.sin((o.t || 0) * 4) * 0.02, '#8af0ff', { e: 1, sh: false });
  return out.concat(X.out);
};
function foeModel(id, i, pos, o) {
  const base = { yaw: o.yaw, t: o.t, flash: o.flash, o: o.o }, k = o.n == null ? 1 : o.n, t = o.t || 0;
  const person2 = (x) => person(id, pos, { ...base, walk: x.walk != null ? x.walk : 0.5, ...x, n: (x.n || 1) * k });
  let X;
  const bx = (n2) => Bld(id + 'x', pos, { yaw: o.yaw, n: (n2 || 1) * k, flash: o.flash, o: o.o });
  switch (i) {
    case 0: return enemy(id, 'slime', pos, { ...base, n: 1.1 * k, c: '#7dff6b' });
    case 8: return enemy(id, 'slime', pos, { ...base, n: 1.2 * k, c: '#b05bff' });
    case 7: return enemy(id, 'zombi', pos, { ...base, n: k });
    case 1: { const a = person2({ n: 0.8, skin: '#6cc24a', shirt: '#8a5a2a', pants: '#5a3a22', hat: 'cap', band: '#8a2a2a', eyeC: '#ffe14d', arms: 1.2 }); X = bx(0.8); X.add('eL', 'cone', [-0.27, 1.66, 0], [0.12, 0.34, 0.1], '#6cc24a', { r: [0, 0, 1.2], sh: false }); X.add('eR', 'cone', [0.27, 1.66, 0], [0.12, 0.34, 0.1], '#6cc24a', { r: [0, 0, -1.2], sh: false }); X.add('dg', 'box', [0.36, 1.35, -0.6], [0.06, 0.55, 0.03], '#c9ced8', { r: [1.3, 0, 0] }); return a.concat(X.out); }
    case 2: { const y = 1.3 + Math.sin(t * 3) * 0.15, fl = Math.sin(t * 15) * 0.8; X = Bld(id, [pos[0], pos[1] + y, pos[2]], { yaw: o.yaw, n: 0.9 * k, flash: o.flash, o: o.o }); X.add('b', 'sph', [0, 0, 0], [0.5, 0.48, 0.6], '#5b4a8a'); X.add('h', 'sph', [0, 0.12, -0.32], 0.34, '#6b5a9a'); X.add('eL', 'cone', [-0.12, 0.34, -0.3], [0.1, 0.24, 0.08], '#4a3a7a', { sh: false }); X.add('eR', 'cone', [0.12, 0.34, -0.3], [0.1, 0.24, 0.08], '#4a3a7a', { sh: false }); X.add('y1', 'sph', [-0.09, 0.15, -0.48], 0.08, '#ff3b3b', { e: 1, sh: false }); X.add('y2', 'sph', [0.09, 0.15, -0.48], 0.08, '#ff3b3b', { e: 1, sh: false }); for (const sx of [-1, 1]) X.add('w' + sx, 'box', [sx * (0.25 + 0.5 * cs(fl)), 0.05 + 0.5 * sn(fl), 0.05], [1.0, 0.04, 0.6], '#3a2a6a', { r: [0, 0, sx * fl], sh: false }); return X.out; }
    case 3: return animal(id, 'dog', pos, { ...base, n: 1.45 * k, c: '#6a6a78', t, walk: 0.6 });
    case 4: { const a = person2({ n: 1.0, skin: '#d9a87a', shirt: '#222230', pants: '#1c1c28', hat: 'cap', band: '#2a2a3a', arms: 1.2 }); X = bx(1); X.add('mask', 'box', [0, 1.65, -0.17], [0.34, 0.1, 0.04], '#b02838', { sh: false }); X.add('dg', 'box', [0.36, 1.3, -0.6], [0.06, 0.55, 0.03], '#c9ced8', { r: [1.3, 0, 0] }); return a.concat(X.out); }
    case 5: { X = bx(1); const w = Math.sin(t * 7) * 0.2; X.add('b', 'sph', [0, 0.55, 0.2], [0.9, 0.7, 1.1], '#2a2a32'); X.add('h', 'sph', [0, 0.6, -0.5], 0.55, '#3a3a44'); X.add('mk', 'sph', [0, 0.62, 0.3], [0.5, 0.3, 0.5], '#ff4d4d', { e: 0.6, sh: false }); for (let j = 0; j < 4; j++) { X.add('e' + j, 'sph', [(j % 2 ? 0.14 : -0.14), 0.7 + (j > 1 ? 0.12 : 0), -0.75], 0.09, '#ff3b3b', { e: 1, sh: false }); } for (const sx of [-1, 1]) for (let j = 0; j < 4; j++) { const z = -0.5 + j * 0.35, a = sx * (0.8 + (j % 2) * 0.2) + w * sx * (j % 2 ? 1 : -1); X.add(`l${sx}${j}`, 'cap', [sx * 0.7, 0.35, z], [0.1, 1.1, 0.1], '#2a2a32', { r: [0, 0, a + sx * 0.4] }); } return X.out; }
    case 6: { X = bx(1); const w = Math.sin(t * 4) * 0.25; X.add('b', 'box', [0, 0.45, 0.2], [0.9, 0.55, 2.2], '#3f8f4a'); X.add('bl', 'box', [0, 0.28, 0.2], [0.8, 0.2, 2.1], '#d8d29a', { sh: false }); X.add('h', 'box', [0, 0.5, -1.4], [0.7, 0.4, 1.0], '#4a9a54'); X.add('jaw', 'box', [0, 0.28, -1.5], [0.6, 0.12, 0.9], '#3a7a44', { r: [0.15, 0, 0] }); X.add('t1', 'box', [w * 0.5, 0.4, 1.7], [0.6, 0.35, 1.2], '#3f8f4a', { r: [0, w * 0.5, 0] }); X.add('t2', 'box', [w * 1.2, 0.35, 2.7], [0.35, 0.25, 1.2], '#3a8044', { r: [0, w, 0] }); X.add('e1', 'sph', [-0.25, 0.8, -1.4], 0.14, '#ffe14d', { e: 1, sh: false }); X.add('e2', 'sph', [0.25, 0.8, -1.4], 0.14, '#ffe14d', { e: 1, sh: false }); for (const sx of [-1, 1]) for (const z of [-0.5, 0.9]) X.add(`l${sx}${z}`, 'box', [sx * 0.55, 0.15, z], [0.25, 0.3, 0.4], '#3a7a44'); for (let j = 0; j < 5; j++) X.add('sp' + j, 'cone', [0, 0.78, -0.6 + j * 0.45], [0.14, 0.2, 0.14], '#2f6f3a', { sh: false }); return X.out; }
    case 9: { X = bx(1); const g = 0.7 + 0.3 * Math.sin(t * 4); X.add('l1', 'ico', [-0.4, 0.4, 0], [0.6, 0.8, 0.6], '#7a7f89'); X.add('l2', 'ico', [0.4, 0.4, 0], [0.6, 0.8, 0.6], '#7a7f89'); X.add('b', 'ico', [0, 1.3, 0], [1.5, 1.4, 1.0], '#8a8f99'); X.add('c', 'ico', [0, 1.4, -0.35], [0.9, 0.9, 0.4], '#6a6e78', { sh: false }); X.add('h', 'ico', [0, 2.2, -0.05], [0.8, 0.7, 0.7], '#9a9ea8'); X.add('e1', 'box', [-0.18, 2.25, -0.4], [0.2, 0.1, 0.05], '#ffb23d', { e: g, sh: false }); X.add('e2', 'box', [0.18, 2.25, -0.4], [0.2, 0.1, 0.05], '#ffb23d', { e: g, sh: false }); X.add('aL', 'ico', [-1.0, 1.3, 0], [0.55, 1.2, 0.55], '#7a7f89'); X.add('aR', 'ico', [1.0, 1.3, 0], [0.55, 1.2, 0.55], '#7a7f89'); X.add('rn', 'box', [0, 1.4, -0.56], [0.3, 0.3, 0.04], '#ffb23d', { e: g, sh: false }); return X.out; }
    case 10: { const a = person2({ n: 0.95, skin: '#d9b48a', shirt: '#8a5a9a', pants: '#5a3a6a', hair: '#c0392b', eyeC: '#ffe14d', arms: 2.4 + Math.sin(t * 8) * 0.3, walk: 0 }); X = bx(0.95); const fl = Math.sin(t * 9) * 0.5; for (const sx of [-1, 1]) { X.add('w' + sx, 'box', [sx * (0.7 + 0.2 * cs(fl)), 1.6 + 0.4 * sn(fl), 0.2], [1.2, 0.06, 0.7], '#7a4a8a', { r: [0, 0, sx * (0.5 + fl)], sh: false }); X.add('wb' + sx, 'cyl', [sx * 0.6, 1.6 + 0.3 * sn(fl), 0.2], [0.05, 1.2, 0.05], '#4a2a5a', { r: [0, 0, sx * (1.1 + fl)], sh: false }); } return a.concat(X.out); }
    case 11: { const a = person2({ n: 1.6, skin: '#7a8a6a', shirt: '#5a4a3a', pants: '#3a3028', hair: '#2a2a22', eyeC: '#ff5a3a', arms: 1.0, walk: 0.3 }); X = bx(1.6); X.add('tL', 'cone', [-0.1, 1.58, -0.22], [0.05, 0.14, 0.05], '#f2eed8', { sh: false }); X.add('tR', 'cone', [0.1, 1.58, -0.22], [0.05, 0.14, 0.05], '#f2eed8', { sh: false }); X.add('club', 'cyl', [0.38, 1.45, -0.55], [0.22, 1.1, 0.22], '#6b4524', { r: [0.25, 0, 0.1] }); X.add('sp', 'sph', [0.38, 2.0, -0.6], 0.3, '#7a5430'); return a.concat(X.out); }
    case 12: { const a = person2({ n: 1.45, skin: '#b02838', shirt: '#7a1424', pants: '#3a0a14', hair: '#2a0a0a', eyeC: '#ffe14d', arms: 1.0, walk: 0.3 }); X = bx(1.45); const fl = Math.sin(t * 4) * 0.12; X.add('hL', 'cone', [-0.15, 1.95, 0], [0.1, 0.4, 0.1], '#2a1a14', { r: [0, 0, 0.35] }); X.add('hR', 'cone', [0.15, 1.95, 0], [0.1, 0.4, 0.1], '#2a1a14', { r: [0, 0, -0.35] }); for (const sx of [-1, 1]) X.add('w' + sx, 'box', [sx * 0.8, 1.6, 0.3], [1.1, 1.0, 0.04], '#5a0c1c', { r: [0, sx * 0.5, sx * (0.5 + fl)], sh: false }); X.add('tail', 'cone', [0, 0.78, 0.45], [0.12, 0.7, 0.12], '#7a1424', { r: [-1.1, 0, 0], sh: false }); X.add('f', 'sph', [0.4, 1.2, -0.5], 0.24 + Math.sin(t * 9) * 0.03, '#ff7a2a', { e: 1, sh: false }); return a.concat(X.out); }
    case 13: { const a = person2({ n: 1.1, skin: '#ece8d6', shirt: '#d8d3bf', pants: '#bdb8a2', hair: '#ece8d6', eyeC: '#ff3b3b', arms: 1.25 }); X = bx(1.1); for (let j = 0; j < 3; j++) X.add('rib' + j, 'box', [0, 1.3 - j * 0.12, -0.17], [0.4 - j * 0.04, 0.045, 0.04], '#8c8878', { sh: false }); X.add('bl', 'box', [0.36, 1.65, -0.62], [0.07, 0.9, 0.035], '#9aa3ab', { m: { r: 0.4, m: 0.6 } }); X.add('gd', 'box', [0.36, 1.2, -0.62], [0.26, 0.06, 0.08], '#5a4a3a'); return a.concat(X.out); }
    default: { X = bx(1); const f = (j) => 0.8 + 0.2 * Math.sin(t * 9 + j); for (const [y, s2, c2] of [[0.6, 1.2, '#ff8a2a'], [1.4, 1.0, '#ffb23d'], [2.1, 0.7, '#ffd54a']]) X.add('b' + y, 'ico', [0, y, 0], [s2, s2, s2], c2, { e: 0.85 }); for (let j = 0; j < 6; j++) { const a = j / 6 * PI * 2 + t; X.add('f' + j, 'cone', [Math.cos(a) * 0.7, 1.2 + Math.sin(a * 2) * 0.3, Math.sin(a) * 0.7], [0.22, 0.6 * f(j), 0.22], '#ff5a1a', { e: 1, sh: false }); } X.add('e1', 'sph', [-0.2, 1.5, -0.45], 0.14, '#2a1008', { sh: false }); X.add('e2', 'sph', [0.2, 1.5, -0.45], 0.14, '#2a1008', { sh: false }); return X.out; }
  }
}

// ─── piezas 2D ───
function RpgBtn({ label, onPress, color = C.amber, disabled, wide, testID }) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled} style={{ width: wide ? '100%' : '48.5%', opacity: disabled ? 0.35 : 1 }}>
      <View style={{ paddingVertical: 11, borderRadius: 14, backgroundColor: alpha(color, 0.2), borderWidth: 2, borderColor: alpha(color, 0.9), alignItems: 'center' }}><Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>{label}</Text></View>
    </Pressable>
  );
}
const BarRow = (label, v, m, col, w = 80) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Text style={{ color: col, fontSize: 10, fontWeight: '900', width: 18 }}>{label}</Text><Bar value={Math.max(0, v)} max={m} color={col} h={8} w={w} /><Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{Math.max(0, Math.round(v))}</Text></View>;

const RPG_WEAPONS = [['Daga oxidada', 0, 0], ['Espada de hierro', 4, 60], ['Hoja rúnica', 5, 150], ['Filo del alba', 7, 320]];
const RPG_ARMORS = [['Túnica', 0, 0], ['Cota de cuero', 2, 50], ['Armadura de acero', 3, 140], ['Coraza de dragón', 5, 300]];
const RPG_SPELLS = [{ id: 'fire', name: '🔥 Fuego', mp: 4, lv: 1 }, { id: 'heal', name: '💚 Curar', mp: 5, lv: 1 }, { id: 'bolt', name: '⚡ Rayo', mp: 9, lv: 4 }];
const makePlayer = () => ({ hp: 36, maxHp: 36, mp: 10, maxMp: 10, atk: 9, def: 3, lv: 1, xp: 0, xpNext: 24, gold: 20, potions: 2, ethers: 1, weapon: 0, armor: 0 });
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const BP = [-1.7, 0, 1.7], BF = [2.0, 0, -2.5];
const YP = Math.atan2(-(BF[0] - BP[0]), -(BF[2] - BP[2])), YF = YP + PI;

const newState = () => { const seed = Math.floor(Math.random() * 1e9), w = mkWorld(seed, []); const x = wx(RPG_START.x) + 1.0, z = wx(RPG_START.y) + 0.8; return { seed, w, opened: [], p: makePlayer(), x, z, face: -0.78, yaw: -0.78, walk: 0, msg: '¡Bienvenido, aventurero! Derrota al dragón del volcán.', battle: null, t: 0, hasSave: false, won: false, shop: null, foes: [], chests: [], npcs: [], zone: 0, zoneT: 0, inTown: true, near: null, steps: 0, safe: true, cd: 0, toast: null }; };
function initEntities(s) {
  const w = s.w; s.chests = []; s.npcs = [];
  for (let tz = 0; tz < RPG_H; tz++) for (let tx = 0; tx < RPG_W; tx++) { const c = w.map[tz][tx]; if (c === 'c') s.chests.push({ id: uid(), x: wx(tx), z: wx(tz), tx, tz, open: 0, got: false, yaw: hash01(`${tx}${tz}`) * 6 }); if (c === 'N') s.npcs.push({ id: uid(), x: wx(tx), z: wx(tz), said: false, look: hash01(`${tx}${tz}`) }); }
  s.foes = [];
}

export function PixelRPG3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('rpg');
  const [scene, setScene] = useState('ready');     // ready | map | battle | town | over | win
  const [res, setRes] = useState({ won: false, isNew: false });
  const move = useRef({ x: 0, y: 0, on: false }).current, look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) { g.current = newState(); initEntities(g.current); }
  if (globalThis.__TEST) globalThis.__game = g;
  const scoreOf = s => s.p.lv * 100 + s.p.gold + (s.won ? 1000 : 0);
  const save = s => { AsyncStorage.setItem(SAVE, JSON.stringify({ seed: s.seed, opened: s.opened, p: s.p, x: s.x, z: s.z, won: s.won })).catch(() => {}); };
  useEffect(() => { AsyncStorage.getItem(SAVE).then(v => { if (v) { try { g.current.save = JSON.parse(v); g.current.hasSave = true; } catch (e) {} } }).catch(() => {}); }, []);
  const newGame = () => { fx.clear(); clear3d(); AsyncStorage.removeItem(SAVE).catch(() => {}); g.current = newState(); initEntities(g.current); setScene('map'); hx.tap(); };
  const continueGame = () => {
    const d = g.current.save; if (!d) return newGame();
    const s = newState(); const w = mkWorld(d.seed, d.opened); Object.assign(s, { seed: d.seed, w, opened: d.opened, p: { ...makePlayer(), ...d.p }, x: d.x, z: d.z, won: !!d.won, msg: 'Partida cargada.', hasSave: true });
    initEntities(s); s.chests = s.chests.filter(c => !d.opened.some(([x, y]) => x === c.tx && y === c.tz)); g.current = s; fx.clear(); clear3d(); setScene('map'); hx.tap();
  };
  const levelUp = s => {
    const p = s.p; let up = 0;
    while (p.xp >= p.xpNext) { p.xp -= p.xpNext; p.lv += 1; p.maxHp += 10; p.maxMp += 3; p.atk += 2; p.def += 1; p.xpNext = Math.floor(p.xpNext * 1.42) + 4; p.hp = p.maxHp; p.mp = p.maxMp; up += 1; }
    if (up) { fx.pop(SCREEN_W / 2, SCREEN_H * 0.3, `¡NIVEL ${p.lv}!`, C.amber, 30); fx.flash(C.amber, 0.3); hx.win(); const sp = RPG_SPELLS.find(q => q.lv === p.lv && q.lv > 1); if (sp && s.battle) s.battle.log = `✨ ¡Aprendiste ${sp.name}!`; submitBest(scoreOf(s)); const b = s.battle; if (b) { ring3d([BP[0], 0.3, BP[2]], '#ffd54a', 30, { speed: 6, life: 0.8 }); burst3d([BP[0], 1.2, BP[2]], ['#ffd54a', '#fff'], 40, { speed: 5, up: 4, size: 0.2, life: 1 }); } }
    return up;
  };
  const sched = (d, fn) => { const b = g.current.battle; if (b) b.q.push({ at: b.clock + d, fn }); else setTimeout(fn, d * 1000); };
  const scr = (b, pt) => { const q = b.cam && project(b.cam, pt, SCREEN_W, SCREEN_H); return q ? [q.x, q.y] : [SCREEN_W / 2, SCREEN_H * 0.3]; };
  const pop = (b, who, txt, color, size) => { const q = scr(b, [who === 'p' ? BP[0] : BF[0], b.boss && who === 'f' ? 5 : 2.4, who === 'p' ? BP[2] : BF[2]]); fx.pop(q[0], q[1], txt, color, size || 26); };
  const startBattle = (s, enemy, boss, idx) => {
    const sc = boss ? 1 : 1 + Math.max(0, s.p.lv - 6) * 0.04;
    s.battle = { enemy, idx, hp: Math.round(enemy.hp * sc), max: Math.round(enemy.hp * sc), atk: Math.round(enemy.atk * sc), turn: 'player', log: boss ? '¡El dragón ruge desde el volcán!' : `¡Un ${enemy.name} salvaje aparece!`, count: 0, charging: false, defending: false, spellMenu: false, t: 0, clock: 0, q: [], boss: !!boss, zone: zoneIdx((s.x + HALF) / TS, (s.z + HALF) / TS), pa: null, fa: { k: 'in', t: 0 }, proj: null, bolt: 0, shield: 0, dispHp: Math.round(enemy.hp * sc), flashF: 0, flashP: 0, cam: null, heal: 0, dispPHp: s.p.hp, dispPMp: s.p.mp, dead: false };
    fx.flash('#fff', 0.5); fx.shake(6, 0.3); hx.warn(); clear3d(); setScene('battle');
  };
  const endBattle = (s, won) => {
    const b = s.battle;
    if (won) {
      s.p.xp += b.boss ? RPG_BOSS.xp : b.enemy.xp; const gold = b.enemy.gold; s.p.gold += gold; hx.win();
      const up = levelUp(s);
      if (b.boss) { s.won = true; save(s); const isNew = submitBest(scoreOf(s)); setRes({ won: true, isNew }); s.battle = null; setScene('win'); return; }
      s.msg = `Derrotaste al ${b.enemy.name}: +${b.enemy.xp} XP +${gold} 💰${up ? ' · ¡subiste de nivel!' : ''}`;
      s.battle = null; save(s); s.cd = 2; setScene('map');
    } else {
      s.p.gold = Math.floor(s.p.gold / 2); s.p.hp = Math.ceil(s.p.maxHp / 2); s.p.mp = s.p.maxMp; s.x = wx(RPG_START.x) + 1.0; s.z = wx(RPG_START.y) + 0.8; s.foes = [];
      s.msg = 'Caíste en combate… despiertas en la aldea con la mitad del oro.'; s.battle = null; hx.die(); save(s); const isNew = submitBest(scoreOf(s)); setRes({ won: false, isNew }); setScene('over');
    }
  };
  const enemyTurn = () => {
    const s = g.current, b = s.battle; if (!b) return;
    b.count += 1; let dmg = 0, text, big = false;
    if (b.charging) { dmg = Math.round(b.atk * (b.boss ? 2.2 : 1.9)); text = `${b.enemy.e} ¡descarga un ataque brutal!`; b.charging = false; big = true; }
    else if (b.count % 3 === 0 || (b.boss && b.count % 2 === 0)) { b.charging = true; text = `${b.enemy.e} ${b.boss ? 'inhala fuego…' : 'prepara un golpe fuerte…'} ¡Defiéndete!`; hx.warn(); b.fa = { k: 'charge', t: 0 }; b.log = text; b.turn = 'player'; burst3d([BF[0], 1.5, BF[2]], '#ff4d4d', 20, { speed: 3, up: 2, size: 0.2 }); return; }
    else dmg = Math.max(1, Math.round(b.atk - s.p.def * 0.6 + randInt(-1, 3))), text = `${b.enemy.e} ${b.enemy.name} ataca.`;
    b.fa = { k: 'atk', t: 0 };
    sched(0.45, () => {
      if (b.boss && big) { burst3d([BP[0], 1.5, BP[2] - 1], ['#ff9d2e', '#ffe45e', '#ff4d1a'], 70, { speed: 8, up: 2, g: -2, size: 0.3, life: 1 }); }
      if (b.defending) { dmg = Math.max(1, Math.round(dmg * 0.35)); ring3d([BP[0], 0.8, BP[2]], '#4af0ff', 20, { speed: 4, life: 0.4 }); }
      dmg = Math.max(1, dmg - Math.floor(s.p.def * 0.3)); s.p.hp = Math.max(0, s.p.hp - dmg); b.flashP = 0.3;
      const c = [BP[0], 1.2, BP[2]]; burst3d(c, ['#ff4d6d', '#fff'], big ? 40 : 20, { speed: big ? 8 : 5, up: 2, size: big ? 0.24 : 0.16 }); ring3d([c[0], 0.3, c[2]], '#ff4d6d', 16, { speed: 5, life: 0.5 });
      pop(b, 'p', `-${dmg}`, C.red, 28); fx.shake(big ? 12 : 7, 0.3); fx.flash(C.red, 0.2); hx.bad(); b.log = text + ` Recibes ${dmg}.`; b.defending = false; b.shield = 0;
      if (s.p.hp <= 0) { b.pa = { k: 'faint', t: 0 }; sched(1.4, () => endBattle(s, false)); return; }
      sched(0.5, () => { b.turn = 'player'; });
    });
  };
  const finishPlayerAction = (s, log, delay = 0.9) => {
    const b = s.battle; b.log = log; b.turn = 'wait';
    sched(delay, () => {
      if (b.hp <= 0) { b.hp = 0; b.fa = { k: 'faint', t: 0 }; hx.win(); burst3d([BF[0], 1.2, BF[2]], [b.boss ? '#ff9d2e' : '#ffd54a', '#fff', '#ff5a1a'], b.boss ? 120 : 50, { speed: b.boss ? 11 : 7, up: 4, size: b.boss ? 0.35 : 0.2, life: 1.2 }); if (b.boss) { fx.flash('#fff', 0.6); fx.shake(14, 0.8); } sched(1.6, () => endBattle(s, true)); return; }
      b.turn = 'enemy'; sched(0.4, enemyTurn);
    });
  };
  const shootFire = (b, col, onHit, dur = 0.5) => { b.proj = { col, t: 0, dur }; sched(dur, () => { b.proj = null; onHit(); }); };
  const act = a => {
    const s = g.current, b = s.battle, p = s.p; if (!b || b.turn !== 'player') return;
    b.spellMenu = false;
    if (a === 'attack') {
      const crit = Math.random() < 0.15; let dmg = p.atk + randInt(0, 3); if (crit) dmg *= 2; b.turn = 'wait'; b.pa = { k: 'atk', t: 0 };
      sched(0.4, () => { b.hp -= dmg; b.flashF = 0.25; const c = [BF[0], 1.3, BF[2]]; burst3d(c, crit ? ['#ffd54a', '#fff'] : ['#fff', '#ffe9a0'], crit ? 36 : 18, { speed: 6, up: 2, size: crit ? 0.22 : 0.15 }); ring3d([c[0], 0.4, c[2]], '#fff', 12, { speed: 4, life: 0.4 }); pop(b, 'f', `${crit ? '💥' : ''}${dmg}`, crit ? C.amber : C.text, crit ? 32 : 26); fx.shake(crit ? 8 : 4, 0.2); hx.hit(); finishPlayerAction(s, `Atacas por ${dmg}${crit ? ' (¡CRÍTICO!)' : ''}.`); });
    } else if (a === 'defend') {
      b.defending = true; p.mp = Math.min(p.maxMp, p.mp + 2); b.shield = 5; ring3d([BP[0], 0.3, BP[2]], '#4af0ff', 24, { speed: 4, life: 0.6 }); hx.tap(); finishPlayerAction(s, '🛡️ Te proteges y recuperas 2 MP.', 0.6);
    } else if (a === 'potion') {
      if (p.potions <= 0) { b.log = 'No tienes pociones.'; return; }
      const heal = Math.round(p.maxHp * 0.45); p.hp = Math.min(p.maxHp, p.hp + heal); p.potions -= 1; b.heal = 1; pop(b, 'p', `+${heal}`, C.lime, 26); ring3d([BP[0], 0.3, BP[2]], '#7dff6b', 24, { speed: 3, life: 0.8 }); burst3d([BP[0], 0.4, BP[2]], '#7dff6b', 20, { speed: 1.5, up: 4, g: -1, size: 0.14, life: 1.1 }); hx.good(); finishPlayerAction(s, `🧪 Bebes una poción (+${heal} HP).`);
    } else if (a === 'ether') {
      if (p.ethers <= 0) { b.log = 'No tienes éter.'; return; }
      p.mp = Math.min(p.maxMp, p.mp + 10); p.ethers -= 1; b.heal = 1; pop(b, 'p', '+10 MP', C.cyan, 24); ring3d([BP[0], 0.3, BP[2]], '#4af0ff', 24, { speed: 3, life: 0.8 }); burst3d([BP[0], 0.4, BP[2]], '#4af0ff', 20, { speed: 1.5, up: 4, g: -1, size: 0.14, life: 1.1 }); hx.good(); finishPlayerAction(s, '💧 Recuperas 10 MP.');
    } else if (a === 'run') {
      if (b.boss) { b.log = '¡No puedes huir del dragón!'; hx.bad(); return; }
      if (Math.random() < 0.55) { s.battle = null; s.msg = 'Escapaste.'; s.cd = 3; s.foes = s.foes.filter(f => Math.hypot(f.x - s.x, f.z - s.z) > 12); setScene('map'); hx.tick(); return; }
      b.turn = 'wait'; finishPlayerAction(s, 'No lograste escapar…', 0.6);
    } else if (a === 'spell') { b.spellMenu = true; }
  };
  const cast = id => {
    const s = g.current, b = s.battle, p = s.p, sp = RPG_SPELLS.find(q => q.id === id);
    if (!b || b.turn !== 'player') return;
    if (p.mp < sp.mp) { b.log = 'No tienes suficiente MP.'; hx.bad(); return; }
    p.mp -= sp.mp; b.spellMenu = false; b.turn = 'wait'; b.pa = { k: 'cast', t: 0 };
    if (id === 'heal') { const heal = Math.round(p.maxHp * 0.4); p.hp = Math.min(p.maxHp, p.hp + heal); b.heal = 1.4; sched(0.3, () => { pop(b, 'p', `+${heal}`, C.lime, 28); for (let i = 0; i < 3; i++) sched(i * 0.25, () => ring3d([BP[0], 0.2 + i * 0.5, BP[2]], '#7dff6b', 22, { speed: 2.5, life: 0.7, up: 2 })); burst3d([BP[0], 0.5, BP[2]], ['#7dff6b', '#fff'], 36, { speed: 1.8, up: 5, g: -1, size: 0.16, life: 1.3 }); hx.good(); }); finishPlayerAction(s, `💚 Te curas ${heal} HP.`, 1.3); return; }
    const dmg = Math.round(p.atk * (id === 'fire' ? 1.9 : 2.8) + randInt(1, 5));
    if (id === 'fire') sched(0.35, () => shootFire(b, '#ff7a2a', () => { b.hp -= dmg; b.flashF = 0.3; const c = [BF[0], 1.3, BF[2]]; burst3d(c, ['#ff7a2a', '#ffd54a', '#ff4d1a'], 70, { speed: 8, up: 3, size: 0.26, life: 0.9 }); ring3d([c[0], 0.3, c[2]], '#ff7a2a', 26, { speed: 7, life: 0.7 }); pop(b, 'f', `${dmg}`, C.orange, 32); fx.shake(7, 0.25); hx.heavy(); finishPlayerAction(s, `${sp.name}: ${dmg} de daño.`, 0.9); }, 0.55));
    else sched(0.35, () => { b.bolt = 0.5; fx.flash('#cfeaff', 0.35); sched(0.1, () => { b.hp -= dmg; b.flashF = 0.4; const c = [BF[0], 1.3, BF[2]]; burst3d(c, ['#4af0ff', '#fff', '#ffe45e'], 80, { speed: 10, up: 3, size: 0.24, life: 0.9 }); ring3d([c[0], 0.3, c[2]], '#4af0ff', 30, { speed: 9, life: 0.7 }); pop(b, 'f', `${dmg}`, C.cyan, 34); fx.shake(10, 0.3); hx.heavy(); finishPlayerAction(s, `${sp.name}: ${dmg} de daño.`, 0.9); }); });
  };
  const buy = what => {
    const s = g.current, p = s.p;
    const spend = c => { if (p.gold < c) { s.shop = 'No tienes suficiente oro.'; hx.bad(); return false; } p.gold -= c; hx.good(); return true; };
    if (what === 'potion' && spend(15)) { p.potions += 1; s.shop = '🧪 Poción comprada.'; }
    if (what === 'ether' && spend(25)) { p.ethers += 1; s.shop = '💧 Éter comprado.'; }
    if (what === 'weapon') { const nx = RPG_WEAPONS[p.weapon + 1]; if (nx && spend(nx[2])) { p.weapon += 1; p.atk += nx[1]; s.shop = `⚔️ ¡Equipas ${nx[0]}!`; } }
    if (what === 'armor') { const nx = RPG_ARMORS[p.armor + 1]; if (nx && spend(nx[2])) { p.armor += 1; p.def += nx[1]; s.shop = `🛡️ ¡Equipas ${nx[0]}!`; } }
    save(s);
  };
  const rest = () => { const s = g.current; s.p.hp = s.p.maxHp; s.p.mp = s.p.maxMp; s.shop = '🛏️ Descansas y recuperas todo.'; fx.flash(C.lime, 0.2); hx.good(); save(s); };
  const quickPotion = () => { const s = g.current, p = s.p; if (scene !== 'map' || p.potions <= 0 || p.hp >= p.maxHp) { hx.tick(); return; } p.potions -= 1; p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.45)); hx.good(); s.msg = '🧪 Bebes una poción.'; ring3d([s.x, s.w.h(s.x, s.z) + 0.2, s.z], '#7dff6b', 20, { speed: 3, life: 0.7 }); };

  const zoneAt = (s) => zoneIdx((s.x + HALF) / TS, (s.z + HALF) / TS);
  useLoop(scene === 'map' || scene === 'battle', dt => {
    const s = g.current; s.t += dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (scene === 'battle' && s.battle) {
      const b = s.battle; b.clock += dt; b.t += dt;
      for (let i = b.q.length - 1; i >= 0; i--) { if (b.clock >= b.q[i].at) { const f = b.q[i].fn; b.q.splice(i, 1); f(); } }
      if (!s.battle) return;
      if (b.pa) { b.pa.t += dt; if (b.pa.k !== 'faint' && b.pa.t > 1) b.pa = null; } if (b.fa) { b.fa.t += dt; if (b.fa.k !== 'faint' && b.fa.k !== 'charge' && b.fa.t > 1) b.fa = null; if (b.fa && b.fa.k === 'charge' && !b.charging) b.fa = null; }
      b.flashF = Math.max(0, b.flashF - dt); b.flashP = Math.max(0, b.flashP - dt); b.bolt = Math.max(0, b.bolt - dt); b.shield = Math.max(0, b.shield - dt * 0); b.heal = Math.max(0, b.heal - dt);
      b.dispHp += (b.hp - b.dispHp) * Math.min(1, dt * 5); b.dispPHp += (s.p.hp - b.dispPHp) * Math.min(1, dt * 5); b.dispPMp += (s.p.mp - b.dispPMp) * Math.min(1, dt * 5);
      if (b.proj) { b.proj.t += dt; const u = Math.min(1, b.proj.t / b.proj.dur), x = BP[0] + 0.4 + (BF[0] - BP[0]) * u, y = 2 + (1.3 - 2) * u + Math.sin(u * PI) * 0.8, z = BP[2] + (BF[2] - BP[2]) * u; burst3d([x, y, z], [b.proj.col, '#ffd54a'], 3, { speed: 1.2, size: 0.34, life: 0.5, g: 0 }); }
      return;
    }
    if (scene !== 'map') return;
    const w = s.w; s.cd = Math.max(0, s.cd - dt);
    s.yaw -= look.x * 2.4 * dt;
    const len = move.on ? Math.min(1, Math.hypot(move.x, move.y)) : 0; let moved = 0;
    if (len > 0.08) {
      const fw = forward(s.yaw), rt = right(s.yaw), m = Math.hypot(move.x, move.y), ux = move.x / m, uy = -move.y / m, sp = 6 * len * dt;
      const dx = (fw[0] * uy + rt[0] * ux) * sp, dz = (fw[1] * uy + rt[1] * ux) * sp;
      if (!blockedAt(w, s.x + dx, s.z)) { s.x += dx; moved += Math.abs(dx); } if (!blockedAt(w, s.x, s.z + dz)) { s.z += dz; moved += Math.abs(dz); }
      let dh = Math.atan2(-dx, -dz) - s.face; dh = ((dh + PI * 3) % (PI * 2)) - PI; s.face += dh * Math.min(1, dt * 12);
    }
    s.walk += ((moved / Math.max(dt, 1e-3) > 1 ? 1 : 0) - s.walk) * Math.min(1, dt * 10);
    const here = tileOf(w, s.x, s.z), zi = zoneAt(s);
    s.safe = here === '=' || here === 'H' || here === 'V';
    if (zi !== s.zone) { s.zone = zi; s.toast = { m: RPG_ZONES[zi].name, t: 2.4 }; hx.tick(); }
    if (moved > 0.01 && Math.random() < dt * 9) { const gy = w.h(s.x, s.z); burst3d([s.x, gy + 0.1, s.z], here === '=' ? '#c9a875' : zi === 4 ? '#6a5a58' : '#8fc77a', 1, { speed: 1, up: 0.7, g: 4, size: 0.12, life: 0.45 }); }
    // aldeas
    const hv = (tx, tz, r) => Math.hypot(wx(tx) - s.x, wx(tz) - s.z) < r;
    let inTown = false, townKind = null;
    for (let tz = 0; tz < RPG_H && !inTown; tz++) for (let tx = 0; tx < RPG_W; tx++) { const c = w.map[tz][tx]; if ((c === 'H' || c === 'V') && hv(tx, tz, 2.4)) { inTown = true; townKind = c; break; } }
    if (inTown && !s.inTown) { s.msg = townKind === 'H' ? 'Llegaste a Aldea Luminar.' : 'Llegaste al Fuerte del Camino.'; s.shop = null; save(s); hx.good(); setScene('town'); s.inTown = true; return; }
    if (!inTown) s.inTown = false;
    // cofres
    for (const c of s.chests) {
      if (c.got) { c.open = Math.min(1, c.open + dt * 3); continue; }
      if (Math.hypot(c.x - s.x, c.z - s.z) < 1.8) {
        c.got = true; const gold = randInt(15, 40) + s.p.lv * 4, pot = Math.random() < 0.5; s.p.gold += gold; if (pot) s.p.potions += 1; s.opened.push([c.tx, c.tz]);
        s.msg = `📦 ¡Cofre! +${gold} 💰${pot ? ' y una poción 🧪' : ''}`; hx.good(); fx.flash(C.amber, 0.2); const y = w.h(c.x, c.z);
        burst3d([c.x, y + 0.8, c.z], ['#ffd54a', '#fff3b0', '#ffb300'], 40, { speed: 6, up: 5, g: 12, size: 0.2, life: 1.1 }); ring3d([c.x, y + 0.3, c.z], '#ffd54a', 22, { speed: 5, life: 0.6 }); fx.pop(SCREEN_W / 2, SCREEN_H * 0.4, `+${gold} 💰`, C.amber, 28); save(s);
      }
    }
    // ancianos
    for (const n of s.npcs) { const d = Math.hypot(n.x - s.x, n.z - s.z); if (d < 2.6 && !n.said) { n.said = true; s.msg = pick(RPG_HINTS); hx.tick(); } if (d > 6) n.said = false; }
    // volcán
    if (w.lair && Math.hypot(w.lair[0] - s.x, w.lair[2] - s.z) < 2.2) {
      if (s.p.lv < 5) { s.msg = '🔥 Una fuerza ardiente te repele. Necesitas ser al menos nivel 5.'; hx.warn(); fx.shake(6, 0.3); s.z += 3.5; ring3d([w.lair[0], w.lair[1] + 0.3, w.lair[2]], '#ff5a1a', 24, { speed: 6, life: 0.6 }); }
      else { startBattle(s, RPG_BOSS, true, -1); return; }
    }
    if (w.lair && Math.hypot(w.lair[0] - s.x, w.lair[2] - s.z) < 40 && Math.random() < dt * 3) burst3d([w.lair[0] + (Math.random() - 0.5) * 2, w.lair[1] + 10.5, w.lair[2] - 3], ['#5a4a48', '#3a2e2c', '#ff7a2a'], 2, { speed: 1.5, up: 4, g: -1, size: 0.9, life: 2.4 });
    // monstruos que patrullan y persiguen fuera de los caminos
    for (const f of s.foes) {
      const d = Math.hypot(f.x - s.x, f.z - s.z); f.t -= dt;
      if (!s.safe && s.cd <= 0 && d < 9) { f.chase = true; } else if (d > 13 || s.safe) f.chase = false;
      let vx = f.vx, vz = f.vz;
      if (f.chase) { vx = (s.x - f.x) / d * 3.2; vz = (s.z - f.z) / d * 3.2; f.yaw = Math.atan2(-vx, -vz); }
      else if (f.t <= 0) { f.t = 1 + Math.random() * 2; const a = Math.random() * PI * 2, sp = Math.random() < 0.35 ? 0 : 1.2; f.vx = Math.cos(a) * sp; f.vz = Math.sin(a) * sp; if (sp) f.yaw = Math.atan2(-f.vx, -f.vz); vx = f.vx; vz = f.vz; }
      const nx = f.x + vx * dt, nz = f.z + vz * dt, tt = tileOf(w, nx, nz);
      if (!blockedAt(w, nx, nz, 0.5) && tt !== '=' && tt !== 'H' && tt !== 'V') { f.x = nx; f.z = nz; f.mv = vx || vz ? 1 : 0; } else { f.t = 0; f.mv = 0; }
      if (d < 1.3 && s.cd <= 0) { burst3d([f.x, w.h(f.x, f.z) + 1, f.z], '#ff4d6d', 16, { speed: 4, size: 0.16 }); s.foes = s.foes.filter(o => o !== f); startBattle(s, RPG_ENEMIES[f.idx], false, f.idx); return; }
    }
    s.foes = s.foes.filter(f => Math.hypot(f.x - s.x, f.z - s.z) < 34);
    s.spawnT = (s.spawnT == null ? 1 : s.spawnT) - dt;
    if (s.spawnT <= 0 && s.foes.length < 7) {
      s.spawnT = 1.2;
      for (let k = 0; k < 20; k++) {
        const a = Math.random() * PI * 2, r = 9 + Math.random() * 12, x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r, tt = tileOf(w, x, z);
        if (tt === 'T' && false) continue; if (blockedAt(w, x, z, 0.6) || tt === '=' || tt === 'H' || tt === 'V' || tt === 'L') continue;
        const zz = zoneIdx((x + HALF) / TS, (z + HALF) / TS); if (Math.hypot(x - wx(RPG_START.x), z - wx(RPG_START.y)) < 12) continue;
        s.foes.push({ id: uid(), idx: pick(RPG_ZONES[zz].pool), x, z, vx: 0, vz: 0, t: 0, yaw: Math.random() * 6, chase: false, mv: 0 }); break;
      }
    }
  });

  const s = g.current, p = s.p, b = s.battle, w = s.w;
  const T = s.t;
  const gy = (x, z) => Math.max(w.h(x, z), -0.25);
  const mapScene = (t, camIn) => {
    const objs = [], y0 = gy(s.x, s.z);
    objs.push(...wizard('yo', [s.x, y0, s.z], { yaw: s.face, t, walk: s.walk }));
    objs.push({ id: 'yoR', k: 'ring', p: [s.x, y0 + 0.06, s.z], s: [1.6, 1.6, 1], c: '#8af0ff', e: 1, o: 0.35 });
    s.foes.forEach(f => { const y = gy(f.x, f.z); if (Math.hypot(f.x - s.x, f.z - s.z) > 26) return; objs.push(...foeModel(`f${f.id}`, f.idx, [f.x, y, f.z], { yaw: f.yaw, t: t + f.id, n: 0.9 })); objs.push({ id: `fr${f.id}`, k: 'ring', p: [f.x, y + 0.06, f.z], s: [2.2, 2.2, 1], c: f.chase ? '#ff4d4d' : '#ffd54a', e: 1, o: f.chase ? 0.7 : 0.4 }); });
    s.chests.forEach(c => { const y = gy(c.x, c.z); if (Math.hypot(c.x - s.x, c.z - s.z) > 30) return; objs.push(...chest(`c${c.id}`, [c.x, y, c.z], { yaw: c.yaw, n: 1.4, open: c.open, glow: !c.got })); if (!c.got) objs.push({ id: `cg${c.id}`, k: 'cyl', p: [c.x, y + 6, c.z], s: [0.3, 12, 0.3], c: '#ffd54a', e: 1, o: 0.2 + 0.05 * Math.sin(t * 3 + c.x) }); });
    s.npcs.forEach(n => { const y = gy(n.x, n.z); if (Math.hypot(n.x - s.x, n.z - s.z) > 30) return; objs.push(...person(`n${n.id}`, [n.x, y, n.z], { yaw: Math.atan2(-(s.x - n.x), -(s.z - n.z)), t, hat: 'cowboy', shirt: '#4d6fb0', pants: '#5a4a3a', hair: '#dddddd', skin: '#e0b890', arms: n.said ? 2.4 : 0 })); objs.push({ id: `nq${n.id}`, k: 'sph', p: [n.x, y + 2.6 + Math.sin(t * 3) * 0.08, n.z], n: 0.28, c: '#ffd54a', e: 1 }); });
    if (w.lair) objs.push({ id: 'lairb', k: 'cyl', p: [w.lair[0], w.lair[1] + 10, w.lair[2]], s: [1.2, 20, 1.2], c: '#ff7a2a', e: 1, o: 0.18 + 0.05 * Math.sin(t * 2) });
    const zi = s.zone, sky = zi === 4 ? { top: '#2a1010', bottom: '#8a4a30', clouds: 6 } : zi === 3 ? { top: '#4a78b8', bottom: '#d8e4f0', clouds: 12 } : zi === 2 ? { top: '#6a8a7a', bottom: '#b8cfc0', clouds: 8 } : { top: '#2f86e6', bottom: '#bfe6ff', clouds: 10 };
    return { sky, fog: { c: sky.bottom, near: 30, far: 85 }, light: { dir: [-0.5, 0.75, 0.45], i: zi === 4 ? 1.8 : 2.4 }, shadowR: 22, terrain: w.terrain, water: { y: -0.5, c: zi === 2 ? '#3a8a6a' : '#2a8ad8', o: 0.82, amp: 0.1 }, statics: w.statics, objs, cam: camIn };
  };
  const battleScene = t => {
    const objs = [], ev = b.enemy;
    const anim = (a, who) => {
      const dir = who === 'p' ? [BF[0] - BP[0], BF[2] - BP[2]] : [BP[0] - BF[0], BP[2] - BF[2]], L = Math.hypot(dir[0], dir[1]), base = who === 'p' ? BP : BF; let x = base[0], z = base[2], sink = 0, roll = 0, sc = 1, op = 1, arms, cast = false;
      if (a) {
        if (a.k === 'atk') { const u = Math.sin(clamp(a.t / 0.6, 0, 1) * PI); x += dir[0] / L * u * 2.0; z += dir[1] / L * u * 2.0; if (who === 'p') arms = 1.0 + u * 0.8; }
        if (a.k === 'cast') { cast = true; arms = 2.4; }
        if (a.k === 'in') sc = 0.2 + 0.8 * smooth(a.t / 0.5);
        if (a.k === 'faint') { const u = smooth(a.t / 0.9); roll = u * 1.3; sink = u * 0.6; op = 1 - u * 0.8; }
      }
      return { x, z, sink, roll, sc, op, arms, cast };
    };
    const A = anim(b.pa, 'p'), pen = (b.flashP > 0);
    objs.push(...wizard('bp', [A.x, 0.18 - A.sink, A.z], { yaw: YP, t, walk: b.pa && b.pa.k === 'atk' ? 0.6 : 0, arms: A.arms, cast: A.cast, n: 1.15 * A.sc, flash: pen, o: A.op }));
    if (b.shield > 0) objs.push({ id: 'shld', k: 'sph', p: [BP[0], 1.3, BP[2]], n: 3.0 + Math.sin(t * 6) * 0.1, c: '#4af0ff', e: 0.5, o: 0.25 });
    if (b.heal > 0) objs.push({ id: 'heal', k: 'cyl', p: [BP[0], 2, BP[2]], s: [1.8, 4, 1.8], c: '#7dff6b', e: 1, o: 0.15 * Math.min(1, b.heal) });
    const F = anim(b.fa, 'f'), charging = b.charging || (b.fa && b.fa.k === 'charge');
    const pulse = charging ? 1 + 0.06 * Math.sin(t * 22) : 1, flashF = b.flashF > 0 || (charging && Math.sin(t * 14) > 0.6);
    if (b.boss) objs.push(...dragon('bd', [F.x, 2.7 - F.sink, F.z - 1.8], { yaw: YF + 0, t, n: 0.78 * F.sc * pulse, flash: flashF, fire: charging ? 0.5 + 0.4 * Math.sin(t * 10) : (b.fa && b.fa.k === 'atk' ? 1 : 0), flap: 0.8, o: F.op }));
    else objs.push(...foeModel('bf', b.idx, [F.x, 0.18, F.z], { yaw: YF, t, n: 1.3 * F.sc * pulse, flash: flashF, o: F.op }));
    objs.push({ id: 'fring', k: 'ring', p: [BF[0], 0.16, BF[2]], s: [3.4, 3.4, 1], c: charging ? '#ff4d4d' : '#ffd54a', e: 1, o: 0.5 }, { id: 'pring', k: 'ring', p: [BP[0], 0.16, BP[2]], s: [3, 3, 1], c: '#8af0ff', e: 1, o: 0.5 });
    if (b.proj) { const u = Math.min(1, b.proj.t / b.proj.dur), pp = [BP[0] + 0.4 + (BF[0] - BP[0]) * u, 2 - 0.7 * u + Math.sin(u * PI) * 0.8, BP[2] + (BF[2] - BP[2]) * u]; objs.push({ id: 'fb1', k: 'sph', p: pp, n: 0.7, c: '#ff7a2a', e: 1 }, { id: 'fb2', k: 'sph', p: pp, n: 1.3, c: '#ffb23d', e: 1, o: 0.3 }, { id: 'fb3', k: 'sph', p: pp, n: 0.35, c: '#ffffff', e: 1 }); }
    if (b.bolt > 0) { const top = 12; let px = BF[0], pz = BF[2]; for (let i = 0; i < 6; i++) { const y1 = 1.2 + i * (top / 6), nx = BF[0] + Math.sin(i * 7.3 + Math.floor(t * 30)) * 0.9, nz = BF[2] + Math.cos(i * 5.1 + Math.floor(t * 30)) * 0.6; objs.push({ id: `bz${i}`, k: 'box', p: [nx, y1 + top / 12, nz], s: [0.22, top / 6 + 0.3, 0.22], c: '#cfeaff', e: 1, r: [0, 0, (nx - px) * 0.2] }); px = nx; pz = nz; } }
    objs.push({ id: 'bk', k: 'cyl', p: [0, -0.02, 0], s: [0.01, 0.01, 0.01], c: '#000' });
    const el = b.clock, k0 = smooth(el / 1.4);
    const camP = { p: [-8.6 + (1 - k0) * 10, 3.9 + (1 - k0) * 1.4 + (b.boss ? 0.8 : 0), 7.2 - (1 - k0) * 8], l: [1.3, b.boss ? 1.8 : 0.9, -1.8], fov: b.boss ? 62 : 58 };
    const bs = b.boss;
    return { sky: bs ? { top: '#1a0505', bottom: '#8a2a10', clouds: 0, sunC: '#ff7a2a' } : b.zone === 4 ? { top: '#2a1010', bottom: '#8a4a30', clouds: 4 } : { top: '#2f86e6', bottom: '#bfe6ff', clouds: 8 }, fog: { c: bs ? '#5a1a0a' : b.zone === 4 ? '#8a4a30' : '#bfe6ff', near: 30, far: 80 }, light: bs ? { dir: [-0.4, 0.5, 0.5], sun: '#ff9a5a', i: 1.8, sky: '#ff9a7a', ground: '#3a1a10', hi: 1.3 } : { dir: [-0.5, 0.75, 0.45] }, shadowR: 16, statics: arenaFor(b.zone, bs), objs, cam: camP };
  };
  let cdist = 8; { const f = forward(s.yaw); for (; cdist > 3; cdist -= 0.6) if (!blockedAt(w, s.x - f[0] * cdist, s.z - f[1] * cdist, 1.0)) break; }
  const exploreCam = followCam({ x: s.x, y: gy(s.x, s.z), z: s.z }, s.yaw, { hm: w, dist: cdist, height: 2.6 + cdist * 0.22, look: 2, fov: 62 });
  let scene3;
  if (scene === 'battle' && b) { scene3 = battleScene(s.t); b.cam = scene3.cam; } else scene3 = mapScene(s.t, exploreCam);
  const menuScene = t => mapScene(t, exploreCam);
  const gamePhase = scene === 'win' ? 'over' : scene;
  const lairAng = w.lair ? compassAngle({ x: s.x, z: s.z }, s.yaw, { x: w.lair[0], z: w.lair[2] }) : 0;
  const xpPct = p.xp / p.xpNext;
  const isOver = scene === 'over' || scene === 'win';
  const onStart = scene === 'ready' ? (s.hasSave ? continueGame : newGame) : scene === 'over' ? (res.won ? newGame : () => { s.foes = []; s.cd = 3; setScene('map'); hx.tap(); }) : newGame;
  return (
    <Game3D title="PIXEL RPG" emoji="🧙" accent={C.amber} onExit={onExit} score={scoreOf(s)} best={best} fx={fx} controlsAlways
      phase={gamePhase} onStart={scene === 'win' ? newGame : onStart} startLabel={s.hasSave ? 'CONTINUAR' : 'JUGAR'} retryLabel={res.won ? 'NUEVA AVENTURA' : 'SEGUIR'} scene={scene3} menuScene={menuScene} orbit={{ r: 9, h: 3.4, speed: 0.2, ly: 1.2, drop: 1.4 }}
      hud={scene === 'map' || scene === 'battle' || scene === 'town' ? <><HudPill icon="❤️" value={`${p.hp}/${p.maxHp}`} color={C.red} /><HudPill icon="💧" value={`${p.mp}/${p.maxMp}`} color={C.cyan} /><HudPill icon="⭐" value={`Nv.${p.lv}`} color={C.amber} /><HudPill icon="💰" value={p.gold} color={C.amber} /></> : null}
      subtitle="Explora un mundo nuevo cada partida y derrota al Dragón Ancestral"
      lines={['Joystick izquierdo: caminar · derecho: girar la cámara', 'Los monstruos te persiguen fuera de los caminos 🛤️ (camino seguro)', 'Combate por turnos: ⚔️ atacar · ✨ magia · 🛡️ defender', 'Compra equipo en las aldeas 🏘️ · Nivel 5 para entrar al volcán 🌋', 'Defiende cuando el enemigo "carga" un golpe']}
      result={{ won: res.won, isNew: res.isNew, emoji: res.won ? '🏆' : '💀', title: res.won ? '¡DRAGÓN DERROTADO!' : 'DERROTADO', subtitle: res.won ? `Nivel ${p.lv} · ${p.gold} 💰. La región vuelve a la paz.` : s.msg, stats: [['NIVEL', p.lv], ['ORO', p.gold], ['ARMA', RPG_WEAPONS[p.weapon][0]]] }}>
      {scene === 'ready' && s.hasSave && <View style={{ position: 'absolute', top: 6, right: 10 }}><Btn3D size="sm" ghost color={C.amber} label="NUEVA PARTIDA" onPress={newGame} /></View>}
      {scene === 'map' && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View pointerEvents="none" style={{ position: 'absolute', left: 10, top: 2, width: SCREEN_W - 92, padding: 7, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)' }}><Text numberOfLines={3} style={{ color: C.amber, fontSize: 12, lineHeight: 16 }}>{s.msg}</Text></View>
          <View pointerEvents="none" style={{ position: 'absolute', top: 2, right: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14, paddingHorizontal: 7, paddingVertical: 2, alignItems: 'center' }}><Text style={{ color: C.orange, fontSize: 17, fontWeight: '900', transform: [{ rotate: `${lairAng}rad` }] }}>▲</Text><Text style={{ color: '#fff', fontSize: 8, fontWeight: '800' }}>🌋 {Math.round(w.lair ? Math.hypot(w.lair[0] - s.x, w.lair[2] - s.z) : 0)} m</Text></View>
          <View pointerEvents="none" style={{ position: 'absolute', left: 10, top: 66, flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '900', ...tglow('#000', 3) }}>XP</Text><Bar value={p.xp} max={p.xpNext} color={C.amber} h={6} w={90} />{s.safe && <Text style={{ color: C.lime, fontSize: 10, fontWeight: '900', ...tglow('#000', 3) }}>🛤️ SEGURO</Text>}</View>
          {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '16%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: 2, ...tglow('#000', 8) }}>{s.toast.m}</Text>}
          <ActionBtn testID="rpg-potion" icon="🧪" label={`${p.potions}`} color={C.lime} size={50} onDown={quickPotion} style={{ right: 10, top: 96 }} />
          <ActionBtn testID="rpg-save" icon="💾" label="GUARDAR" color={C.violet} size={50} onDown={() => { save(s); s.msg = '💾 Partida guardada.'; hx.good(); }} style={{ right: 10, top: 156 }} />
          <Stick3D testID="rpg-move" v={move} side="left" color={C.amber} />
          <Stick3D testID="rpg-look" v={look} side="right" color={C.cyan} />
        </View>
      )}
      {scene === 'battle' && b && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View pointerEvents="none" style={{ position: 'absolute', top: 2, left: 0, right: 0, alignItems: 'center' }}>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '900', letterSpacing: 1, ...tglow('#000', 6) }}>{b.enemy.e} {b.enemy.name}</Text>
            <Bar value={b.dispHp} max={b.max} color={b.boss ? C.orange : C.red} h={12} w={SCREEN_W * 0.62} style={{ marginTop: 4 }} />
            <Text style={{ color: '#fff', fontSize: 11, marginTop: 2, fontWeight: '800', ...tglow('#000', 3) }}>{Math.max(0, Math.round(b.hp))} / {b.max}{b.charging ? '   ⚠️ ¡CARGANDO!' : ''}</Text>
          </View>
          <View pointerEvents="none" style={{ position: 'absolute', left: 10, right: 10, bottom: 218, padding: 10, borderRadius: 12, backgroundColor: 'rgba(4,6,18,0.62)', borderWidth: 1, borderColor: b.charging ? alpha(C.red, 0.8) : alpha(C.amber, 0.3), minHeight: 48, justifyContent: 'center' }}><Text style={{ color: b.charging ? C.red : C.text, fontSize: 13, lineHeight: 18 }}>{b.log}</Text></View>
          <View style={{ position: 'absolute', left: 10, right: 10, bottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>{BarRow('HP', b.dispPHp, p.maxHp, C.red, 100)}{BarRow('MP', b.dispPMp, p.maxMp, C.cyan, 70)}</View>
            {b.turn === 'player' && !b.spellMenu && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'space-between' }}>
                <RpgBtn testID="rpg-attack" label="⚔️ Atacar" onPress={() => act('attack')} color={C.red} /><RpgBtn testID="rpg-magic" label="✨ Magia" onPress={() => act('spell')} color={C.violet} />
                <RpgBtn label="🛡️ Defender" onPress={() => act('defend')} color={C.cyan} /><RpgBtn label={`🧪 Poción (${p.potions})`} onPress={() => act('potion')} color={C.lime} />
                <RpgBtn label={`💧 Éter (${p.ethers})`} onPress={() => act('ether')} color={C.blue} /><RpgBtn label="🏃 Huir" onPress={() => act('run')} color="#9aa3c8" />
              </View>
            )}
            {b.turn === 'player' && b.spellMenu && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'space-between' }}>
                {RPG_SPELLS.filter(q => p.lv >= q.lv).map(q => <RpgBtn key={q.id} testID={`rpg-sp-${q.id}`} label={`${q.name} · ${q.mp} MP`} onPress={() => cast(q.id)} color={C.violet} disabled={p.mp < q.mp} />)}
                <RpgBtn label="← Volver" onPress={() => { b.spellMenu = false; }} color="#9aa3c8" wide />
              </View>
            )}
            {b.turn !== 'player' && <Text style={{ color: C.dim, textAlign: 'center', paddingVertical: 24 }}>{b.turn === 'enemy' ? 'Turno del enemigo…' : '…'}</Text>}
          </View>
        </View>
      )}
      {scene === 'town' && (
        <View style={{ ...StyleSheet.absoluteFillObject, padding: 16, alignItems: 'center', backgroundColor: 'rgba(8,6,4,0.84)', zIndex: 30 }}>
          <Text style={{ fontSize: 50, marginTop: 4 }}>🏘️</Text>
          <Text style={{ color: C.amber, fontSize: 21, fontWeight: '900', letterSpacing: 1 }}>TIENDA Y POSADA</Text>
          <Text style={{ color: C.dim, fontSize: 12, marginVertical: 6, textAlign: 'center' }}>💰 {p.gold}  ·  🧪 {p.potions}  ·  💧 {p.ethers}  ·  ⚔️ {p.atk}  ·  🛡️ {p.def}</Text>
          <Text style={{ color: C.lime, fontSize: 12, minHeight: 18, marginBottom: 8 }}>{s.shop || ' '}</Text>
          <View style={{ width: '100%', gap: 8 }}>
            <RpgBtn wide testID="rpg-rest" label="🛏️ Descansar (gratis): HP y MP al máximo" onPress={rest} color={C.lime} />
            <RpgBtn wide label="🧪 Poción · 15 💰" onPress={() => buy('potion')} color={C.red} />
            <RpgBtn wide label="💧 Éter · 25 💰" onPress={() => buy('ether')} color={C.blue} />
            <RpgBtn wide label={RPG_WEAPONS[p.weapon + 1] ? `⚔️ ${RPG_WEAPONS[p.weapon + 1][0]} (+${RPG_WEAPONS[p.weapon + 1][1]} ATK) · ${RPG_WEAPONS[p.weapon + 1][2]} 💰` : '⚔️ Arma al máximo'} onPress={() => buy('weapon')} color={C.orange} disabled={!RPG_WEAPONS[p.weapon + 1]} />
            <RpgBtn wide label={RPG_ARMORS[p.armor + 1] ? `🛡️ ${RPG_ARMORS[p.armor + 1][0]} (+${RPG_ARMORS[p.armor + 1][1]} DEF) · ${RPG_ARMORS[p.armor + 1][2]} 💰` : '🛡️ Armadura al máximo'} onPress={() => buy('armor')} color={C.cyan} disabled={!RPG_ARMORS[p.armor + 1]} />
          </View>
          <View style={{ marginTop: 16 }}><Btn3D testID="rpg-leave" label="SALIR AL MAPA" color={C.amber} onPress={() => { s.shop = null; s.cd = 1; setScene('map'); }} /></View>
        </View>
      )}
    </Game3D>
  );
}
