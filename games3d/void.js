/**
 * Void Crawler 3D – roguelike de mazmorra en primera persona (motor 3D v2).
 * Reglas del juego original: mazmorra procedural por turnos (cada paso es un turno), 5 pisos, niebla de visión,
 * enemigos con IA (cuerpo a cuerpo, arqueros, magos, murciélagos rápidos, slimes que se dividen), trampas, cofres,
 * santuarios, pociones, bombas, niveles y un dragón como jefe final.
 * Vista: ojos del jugador, paredes de piedra con antorchas (luces puntuales), niebla oscura y prefabs animados.
 * Controles: ▲ ▼ avanzan / retroceden (mantener repite) · ◀ ▶ giran 90° (gratis) · deslizar a los lados también gira.
 */
import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Bar, C, SCREEN_H, SCREEN_W, alpha, clamp, hx, pick, randInt, tglow, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d as burst3dRaw, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill } from '../utils/ui3d';
import { chest, coin, dragon, enemy, gem, hash01, person, shade } from '../utils/prefabs';
import { project } from '../utils/openworld';

// ─── Constantes ───────────────────────────────────────────────────
const VC_W = 30, VC_H = 26;
const CELL = 2, WALL_H = 2.64, EYE = 1.32, FOV = 80;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];          // N, E, S, O
const YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2];      // yaw de cámara para mirar hacia cada dirección
const PI = Math.PI, cs = Math.cos, sn = Math.sin;

const THEMES = [
  { name: 'CATACUMBAS', wall: '#6d7392', floor: '#454a66', accent: C.blue, torch: '#ffb347', fog: '#06070e', sky: '#5a6aa0', ground: '#1c1a2c' },
  { name: 'PANTANO TÓXICO', wall: '#587a52', floor: '#34503a', accent: C.lime, torch: '#a6ff5a', fog: '#040b06', sky: '#5aa060', ground: '#14241a' },
  { name: 'CAVERNA DE FUEGO', wall: '#8a5444', floor: '#563228', accent: C.orange, torch: '#ff7a2a', fog: '#0e0503', sky: '#a05a3a', ground: '#2a120c' },
  { name: 'REINO SOMBRÍO', wall: '#7a5a8e', floor: '#46345a', accent: C.pink, torch: '#d684ff', fog: '#09050e', sky: '#8a5ab0', ground: '#201430' },
  { name: 'GUARIDA DEL DRAGÓN', wall: '#92784a', floor: '#54462a', accent: C.amber, torch: '#ffc233', fog: '#0e0902', sky: '#b08a40', ground: '#2a2010' },
];
const ENEMIES = {
  skeleton: { e: '💀', hp: 7, atk: 3, def: 0, xp: 6, ai: 'melee' }, goblin: { e: '👺', hp: 5, atk: 4, def: 0, xp: 7, ai: 'melee' },
  bat: { e: '🦇', hp: 3, atk: 2, def: 0, xp: 5, ai: 'fast' }, slime: { e: '🟢', hp: 8, atk: 2, def: 0, xp: 6, ai: 'melee', split: true },
  archer: { e: '🏹', hp: 6, atk: 4, def: 0, xp: 10, ai: 'archer' }, orc: { e: '👹', hp: 16, atk: 6, def: 1, xp: 14, ai: 'melee' },
  mage: { e: '🔮', hp: 9, atk: 7, def: 0, xp: 16, ai: 'mage' }, demon: { e: '😈', hp: 24, atk: 9, def: 2, xp: 26, ai: 'melee' },
  dragon: { e: '🐉', hp: 90, atk: 13, def: 3, xp: 200, ai: 'boss', boss: true },
};
const FLOORS = [['skeleton', 'goblin', 'bat', 'slime'], ['skeleton', 'goblin', 'bat', 'archer', 'orc'], ['orc', 'archer', 'mage', 'bat', 'slime'], ['demon', 'mage', 'orc', 'archer'], ['dragon', 'demon', 'demon', 'mage']];
const WEAPONS = [['Daga', 1], ['Espada', 3], ['Hacha', 5], ['Lanza rúnica', 7], ['Filo del vacío', 10]];
const ARMORS = [['Harapos', 0], ['Cuero', 1], ['Malla', 2], ['Placas', 4], ['Egida', 6]];
const WEAPON_COL = ['#b9bcc6', '#d4e2f2', '#9fb4c8', '#9b7bff', '#5ff0ff'];
const need = lv => lv * 22;
// partículas algo más pequeñas: en pasillos de 2 m las chispas quedan muy cerca de la cámara
const burst3d = (pos, col, n, o = {}) => burst3dRaw(pos, col, n, { ...o, size: (o.size != null ? o.size : 0.18) * 0.55 });

// ─── Geometría: pequeño constructor de modelos (mismo convenio que prefabs.js) ───
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
  const G = (o.yaw || o.pitch || o.roll) ? mul(rotY(o.yaw || 0), mul(rotX(o.pitch || 0), rotZ(o.roll || 0))) : null;
  const out = [];
  const add = (name, k, lp, ls, c, x) => {
    x = x || {};
    const q = G ? mv(G, lp) : lp; const r = x.r || ((k === 'pla' || k === 'ring') ? [-PI / 2, 0, 0] : null);
    const ob = { id: id + '.' + name, k, p: [p[0] + q[0] * n, p[1] + q[1] * n, p[2] + q[2] * n], c: o.flash ? '#ffffff' : c };
    if (typeof ls === 'number') ob.n = ls * n; else ob.s = [ls[0] * n, ls[1] * n, ls[2] * n];
    if (G) ob.r = eul(mul(G, r ? rotXYZ(r) : [1, 0, 0, 0, 1, 0, 0, 0, 1])); else if (r) ob.r = r;
    if (o.flash) ob.e = 0.7; else if (x.e) ob.e = x.e;
    if (o.o != null && o.o < 1) ob.o = o.o; else if (x.o != null) ob.o = x.o;
    if (x.m) ob.m = x.m;
    if (x.sh !== false && o.sh !== false && !ob.o) ob.sh = true;
    out.push(ob); return ob;
  };
  return { add, out };
}

// ─── Modelos de enemigos (sobre prefabs) ──────────────────────────
// pos = pies · o: { yaw, t, flash, n (escala extra), small, warn }
function foeModel(id, type, pos, o) {
  const base = { yaw: o.yaw, t: o.t, flash: o.flash }, k = o.n == null ? 1 : o.n;
  const wob = Math.sin(o.t * 5 + (o.seed || 0));
  let out = [], X;
  if (type === 'skeleton') {
    out = person(id, pos, { ...base, n: 1.05 * k, skin: '#ece8d6', shirt: '#d8d3bf', pants: '#bdb8a2', hair: '#ece8d6', eyeC: '#ff3b3b', walk: 0.6, arms: 1.25 });
    X = Bld(id + 'x', pos, { yaw: o.yaw, n: 1.05 * k, flash: o.flash });
    for (let i = 0; i < 3; i++) X.add('rib' + i, 'box', [0, 1.3 - i * 0.12, -0.17], [0.4 - i * 0.04, 0.045, 0.04], '#8c8878', { sh: false });
    X.add('blade', 'box', [0.36, 1.62, -0.62], [0.07, 0.86, 0.035], '#9aa3ab', { m: { r: 0.4, m: 0.6 } });
    X.add('guard', 'box', [0.36, 1.2, -0.62], [0.26, 0.06, 0.08], '#5a4a3a');
  } else if (type === 'goblin') {
    out = person(id, pos, { ...base, n: 0.72 * k, skin: '#6cc24a', shirt: '#8a5a2a', pants: '#5a3a22', hat: 'cap', band: '#8a2a2a', hair: '#2a3a1a', eyeC: '#ffe14d', walk: 0.8, arms: 1.1 });
    X = Bld(id + 'x', pos, { yaw: o.yaw, n: 0.72 * k, flash: o.flash });
    X.add('earL', 'cone', [-0.27, 1.66, 0], [0.12, 0.34, 0.1], '#6cc24a', { r: [0, 0, 1.2], sh: false });
    X.add('earR', 'cone', [0.27, 1.66, 0], [0.12, 0.34, 0.1], '#6cc24a', { r: [0, 0, -1.2], sh: false });
    X.add('dag', 'box', [0.36, 1.3, -0.55], [0.06, 0.5, 0.03], '#c9ced8', { r: [1.2, 0, 0] });
  } else if (type === 'orc') {
    out = person(id, pos, { ...base, n: 1.3 * k, skin: '#5a9a3a', shirt: '#6b4a2a', pants: '#3a2a1a', hair: '#1a1a1a', eyeC: '#ff5a3a', walk: 0.5, arms: 1.15 });
    X = Bld(id + 'x', pos, { yaw: o.yaw, n: 1.3 * k, flash: o.flash });
    X.add('tuskL', 'cone', [-0.1, 1.55, -0.2], [0.05, 0.16, 0.05], '#f2eed8', { sh: false });
    X.add('tuskR', 'cone', [0.1, 1.55, -0.2], [0.05, 0.16, 0.05], '#f2eed8', { sh: false });
    X.add('club', 'cyl', [0.36, 1.52, -0.55], [0.2, 0.9, 0.2], '#6b4524', { r: [0.2, 0, 0.1] });
    X.add('spk', 'sph', [0.36, 1.95, -0.58], 0.28, '#7a5430');
    X.add('belt', 'box', [0, 0.95, 0], [0.56, 0.12, 0.34], '#2a1a0a', { sh: false });
  } else if (type === 'archer') {
    out = person(id, pos, { ...base, n: k, skin: '#d9a87a', shirt: '#3d6b3a', pants: '#4a3a2a', hat: 'cap', band: '#2f5a2f', hair: '#3a2a1a', walk: 0.7, arms: 1.4 });
    X = Bld(id + 'x', pos, { yaw: o.yaw, n: k, flash: o.flash });
    X.add('bow', 'tor', [-0.36, 1.25, -0.65], [1.0, 1.0, 1.0], '#7a4a22', { r: [0, PI / 2, 0] });
    X.add('str', 'cyl', [-0.36, 1.25, -0.65], [0.015, 0.95, 0.015], '#e8e0c8', { sh: false });
    X.add('quiv', 'cyl', [0.1, 1.3, 0.22], [0.14, 0.5, 0.14], '#5a3a1a', { r: [0.2, 0, 0.3] });
  } else if (type === 'mage') {
    out = person(id, pos, { ...base, n: k, skin: '#e0c3a0', shirt: '#7a3dd6', pants: '#4a2a8a', hair: '#e8e8f0', eyeC: '#9bf6ff', walk: 0.3, arms: 1.3 });
    X = Bld(id + 'x', pos, { yaw: o.yaw, n: k, flash: o.flash });
    X.add('robe', 'cone', [0, 0.62, 0], [1.15, 1.3, 1.15], '#5b2bb0');
    X.add('hat', 'cone', [0, 2.12, 0], [0.5, 0.75, 0.5], '#4a1f9a', { r: [-0.15, 0, 0.12] });
    X.add('brim', 'cyl', [0, 1.84, 0], [0.7, 0.05, 0.7], '#4a1f9a', { sh: false });
    X.add('staff', 'cyl', [0.36, 1.05, -0.5], [0.07, 2.0, 0.07], '#6b4524');
    X.add('orb', 'sph', [0.36, 2.1, -0.5], 0.26 + wob * 0.03, '#d6a8ff', { e: 0.95, sh: false });
  } else if (type === 'demon') {
    out = person(id, pos, { ...base, n: 1.38 * k, skin: '#b02838', shirt: '#7a1424', pants: '#3a0a14', hair: '#2a0a0a', eyeC: '#ffe14d', walk: 0.6, arms: 1.0 });
    X = Bld(id + 'x', pos, { yaw: o.yaw, n: 1.38 * k, flash: o.flash });
    X.add('hornL', 'cone', [-0.15, 1.95, 0], [0.1, 0.4, 0.1], '#2a1a14', { r: [0, 0, 0.35] });
    X.add('hornR', 'cone', [0.15, 1.95, 0], [0.1, 0.4, 0.1], '#2a1a14', { r: [0, 0, -0.35] });
    const fl = Math.sin(o.t * 4) * 0.12;
    for (const sx of [-1, 1]) {
      X.add('wing' + sx, 'box', [sx * 0.75, 1.55, 0.3], [0.95, 0.9, 0.04], '#5a0c1c', { r: [0, sx * 0.5, sx * (0.5 + fl)], sh: false });
      X.add('wbone' + sx, 'cyl', [sx * 0.6, 1.75, 0.28], [0.05, 0.95, 0.05], '#2a0a10', { r: [0, 0, sx * (1.1 + fl)], sh: false });
    }
    X.add('tail', 'cone', [0, 0.78, 0.45], [0.12, 0.6, 0.12], '#7a1424', { r: [-1.1, 0, 0], sh: false });
    X.add('fire', 'sph', [0.36, 1.2, -0.5], 0.22 + wob * 0.03, '#ff7a2a', { e: 1, sh: false });
  } else if (type === 'bat') {
    const y = 1.5 + Math.sin(o.t * 3 + (o.seed || 0)) * 0.12, fl = Math.sin(o.t * 15) * 0.8;
    X = Bld(id, [pos[0], pos[1] + y, pos[2]], { yaw: o.yaw, n: 0.62 * k, flash: o.flash });
    X.add('body', 'sph', [0, 0, 0], [0.42, 0.4, 0.5], '#5b4a8a', { m: { r: 0.8, m: 0 } });
    X.add('head', 'sph', [0, 0.1, -0.28], 0.3, '#6b5a9a');
    X.add('earL', 'cone', [-0.1, 0.3, -0.28], [0.1, 0.22, 0.08], '#4a3a7a', { sh: false });
    X.add('earR', 'cone', [0.1, 0.3, -0.28], [0.1, 0.22, 0.08], '#4a3a7a', { sh: false });
    X.add('eyeL', 'sph', [-0.08, 0.13, -0.42], 0.07, '#ff3b3b', { e: 1, sh: false });
    X.add('eyeR', 'sph', [0.08, 0.13, -0.42], 0.07, '#ff3b3b', { e: 1, sh: false });
    X.add('fangL', 'cone', [-0.04, -0.02, -0.44], [0.03, 0.08, 0.03], '#fff', { r: [PI, 0, 0], sh: false });
    for (const sx of [-1, 1]) {
      X.add('wing' + sx, 'box', [sx * (0.2 + 0.45 * cs(fl)), 0.04 + 0.45 * sn(fl), 0.05], [0.9, 0.04, 0.55], '#3a2a6a', { r: [0, 0, sx * fl], sh: false });
    }
    return X.out;
  } else if (type === 'slime') {
    const c = o.small ? '#58e08a' : '#3ccf7a';
    return enemy(id, 'slime', pos, { ...base, n: (o.small ? 0.5 : 0.85) * k, c });
  } else if (type === 'dragon') {
    const fire = o.warn ? 0.5 + 0.5 * Math.sin(o.t * 12) : 0;
    return dragon(id, [pos[0], pos[1] + 0.82, pos[2]], { yaw: o.yaw, n: 0.42 * k, t: o.t, flash: o.flash, fire: o.fireAmt || 0, flap: 0.7 });
  }
  return out.concat(X ? X.out : []);
}

// ─── Mazmorra procedural (mismas reglas que el juego 2D) ──────────
const mkEnemy = (type, pos, floor) => {
  const d = ENEMIES[type]; const hp = d.hp + (floor - 1) * 3;
  return { id: uid(), type, e: d.e, ai: d.ai, x: pos.x, y: pos.y, vx: pos.x, vy: pos.y, face: 0, fyaw: 0, hp, maxHp: hp, atk: d.atk + Math.floor((floor - 1) * 0.8), def: d.def, xp: d.xp, boss: d.boss, split: d.split, awake: false, turn: 0, warn: null, flash: 0, lunge: 0, lungeDir: [0, 0], seed: Math.random() * 6 };
};
function genFloor(floor, p) {
  const map = Array.from({ length: VC_H }, () => Array(VC_W).fill(0));
  const rooms = [];
  for (let k = 0; k < 60 && rooms.length < 10; k++) {
    const w = randInt(4, 8), h = randInt(4, 7), x = randInt(1, VC_W - w - 2), y = randInt(1, VC_H - h - 2);
    if (rooms.some(r => x <= r.x + r.w + 1 && x + w + 1 >= r.x && y <= r.y + r.h + 1 && y + h + 1 >= r.y)) continue;
    rooms.push({ x, y, w, h });
  }
  rooms.forEach(r => { for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) map[j][i] = 1; });
  for (let i = 0; i < rooms.length - 1; i++) {
    const a = rooms[i], b = rooms[i + 1];
    const ax = Math.floor(a.x + a.w / 2), ay = Math.floor(a.y + a.h / 2), bx = Math.floor(b.x + b.w / 2), by = Math.floor(b.y + b.h / 2);
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) map[ay][x] = 1;
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) map[y][bx] = 1;
  }
  const first = rooms[0], last = rooms[rooms.length - 1];
  p.x = Math.floor(first.x + first.w / 2); p.y = Math.floor(first.y + first.h / 2); p.vx = p.x; p.vy = p.y;
  const stairs = { x: Math.floor(last.x + last.w / 2), y: Math.floor(last.y + last.h / 2) };
  const taken = new Set([`${p.x},${p.y}`, `${stairs.x},${stairs.y}`]);
  const freeIn = room => { for (let t = 0; t < 40; t++) { const x = randInt(room.x, room.x + room.w - 1), y = randInt(room.y, room.y + room.h - 1); if (!taken.has(`${x},${y}`)) { taken.add(`${x},${y}`); return { x, y }; } } return null; };
  const enemies = [];
  const pool = FLOORS[floor - 1];
  const count = floor === 5 ? 5 : 5 + floor * 2;
  if (floor === 5) { const pos = freeIn(last); if (pos) enemies.push(mkEnemy('dragon', pos, floor)); }
  for (let i = enemies.length; i < count; i++) { const room = rooms[randInt(1, rooms.length - 1)]; const pos = freeIn(room); if (pos) enemies.push(mkEnemy(pool[randInt(0, pool.length - 1)], pos, floor)); }
  const items = [];
  const addItem = (kind, n) => { for (let i = 0; i < n; i++) { const room = pick(rooms); const pos = freeIn(room); if (pos) items.push({ id: uid(), kind, ...pos, yaw: Math.random() * 6.28 }); } };
  addItem('potion', 2); addItem('chest', 2 + (floor > 2 ? 1 : 0)); addItem('gold', 3); addItem('bomb', 1); if (Math.random() < 0.6) addItem('shrine', 1); addItem('trap', 3 + floor);
  const lvl = { map, seen: Array.from({ length: VC_H }, () => Array(VC_W).fill(false)), rooms, stairs, enemies, items, torches: [], statics: null };
  lvl.statics = buildStatics(lvl, THEMES[floor - 1]);
  return lvl;
}
const wallAt = (s, x, y) => x < 0 || y < 0 || x >= VC_W || y >= VC_H || s.map[y][x] === 0;
const los = (s, x0, y0, x1, y1) => {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy, x = x0, y = y0;
  while (x !== x1 || y !== y1) { if ((x !== x0 || y !== y0) && wallAt(s, x, y)) return false; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x += sx; } if (e2 < dx) { err += dx; y += sy; } }
  return true;
};
const computeVis = s => {
  const vis = new Set(); const p = s.p; const R = 7;
  for (let j = p.y - R; j <= p.y + R; j++) for (let i = p.x - R; i <= p.x + R; i++) {
    if (i < 0 || j < 0 || i >= VC_W || j >= VC_H) continue;
    if ((i - p.x) ** 2 + (j - p.y) ** 2 > R * R + 1) continue;
    if (los(s, p.x, p.y, i, j)) { vis.add(`${i},${j}`); s.seen[j][i] = true; }
  }
  s.vis = vis;
};
const wpos = (x, y, h = 0) => [(x + 0.5) * CELL, h, (y + 0.5) * CELL];

// Geometría fija del piso (se calcula una vez por piso y va en scene.statics: paredes con hiladas de piedra, losas, adornos)
function buildStatics(lv, th) {
  const st = [], m = lv.map; const torches = lv.torches;
  const isW = (x, y) => x < 0 || y < 0 || x >= VC_W || y >= VC_H || m[y][x] === 0;
  const cx = VC_W * CELL / 2, cz = VC_H * CELL / 2;
  st.push({ id: 'base', k: 'pla', p: [cx, -0.14, cz], s: [VC_W * CELL + 30, VC_H * CELL + 30, 1], c: th.ground, recv: true });
  st.push({ id: 'techo', k: 'pla', p: [cx, WALL_H, cz], s: [VC_W * CELL + 30, VC_H * CELL + 30, 1], c: shade(th.wall, 0.42) });
  for (let y = 0; y < VC_H; y++) for (let x = 0; x < VC_W; x++) {
    const h1 = hash01(`${x},${y}`, 1), h2 = hash01(`${x},${y}`, 2), c0 = [(x + 0.5) * CELL, 0, (y + 0.5) * CELL];
    if (!isW(x, y)) {
      st.push({ id: 'l', k: 'box', p: [c0[0], -0.05, c0[2]], s: [CELL - 0.07, 0.12, CELL - 0.07], c: shade((x + y) % 2 ? th.floor : shade(th.floor, 1.14), 0.9 + h1 * 0.2), inst: 'losa', recv: true });
      if (h2 < 0.07) st.push({ id: 'r', k: 'ico', p: [c0[0] + (h1 - 0.5) * 1.1, 0.06, c0[2] + (h2 * 9 % 1 - 0.5) * 1.1], s: [0.32 + h1 * 0.2, 0.18, 0.28 + h2 * 2], c: shade(th.floor, 0.7), inst: 'escombro' });
      else if (h2 > 0.965) {   // huesos
        st.push({ id: 'k', k: 'sph', p: [c0[0] + (h1 - 0.5) * 1.2, 0.12, c0[2] + (h2 * 31 % 1 - 0.5) * 1.2], n: 0.26, c: '#e6e1cf', inst: 'hueso' });
        st.push({ id: 'k2', k: 'cyl', p: [c0[0] + (h1 - 0.5) * 1.2 + 0.3, 0.05, c0[2] + (h2 * 31 % 1 - 0.5) * 1.2 + 0.1], s: [0.07, 0.5, 0.07], r: [0, 0, 1.45], c: '#d8d2bd', inst: 'hueso2' });
      }
      continue;
    }
    // muro (solo los que tocan suelo)
    let near = false;
    for (let j = -1; j <= 1 && !near; j++) for (let i = -1; i <= 1; i++) if (!isW(x + i, y + j)) { near = true; break; }
    if (!near) continue;
    const bandH = WALL_H / 4;
    for (let b = 0; b < 4; b++) {
      const hb = hash01(`${x},${y},${b}`);
      const grow = b % 2 ? 0.05 : 0;
      st.push({ id: 'w', k: 'box', p: [c0[0], bandH * (b + 0.5), c0[2]], s: [CELL + grow, bandH - 0.012, CELL + grow], c: shade(th.wall, 0.86 + hb * 0.26 - b * 0.02), inst: 'muro' });
    }
    st.push({ id: 'wb', k: 'box', p: [c0[0], 0.12, c0[2]], s: [CELL + 0.12, 0.26, CELL + 0.12], c: shade(th.wall, 0.55), inst: 'muroBase' });
    st.push({ id: 'wc', k: 'box', p: [c0[0], WALL_H - 0.09, c0[2]], s: [CELL + 0.14, 0.2, CELL + 0.14], c: shade(th.wall, 0.62), inst: 'muroCornisa' });
    // adornos en las caras que miran a un suelo
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d]; if (isW(x + dx, y + dy) || (x + dx) < 0 || (y + dy) < 0 || (x + dx) >= VC_W || (y + dy) >= VC_H) continue;
      const hd = hash01(`${x},${y},d${d}`);
      const fx = c0[0] + dx * (CELL / 2 + 0.03), fz = c0[2] + dy * (CELL / 2 + 0.03);
      const along = dx !== 0 ? [0.07, 1, 1] : [1, 1, 0.07];   // espesor hacia la sala
      if (hd < 0.1) {   // antorcha
        const tx = c0[0] + dx * (CELL / 2 + 0.12), tz = c0[2] + dy * (CELL / 2 + 0.12);
        st.push({ id: 't', k: 'cyl', p: [tx, 1.5, tz], s: [0.12, 0.5, 0.12], c: '#3a2a20', inst: 'sost' });
        st.push({ id: 't2', k: 'cyl', p: [tx, 1.8, tz], s: [0.22, 0.14, 0.22], c: '#5a4636', inst: 'sost2' });
        torches.push({ x: tx, y: 1.95, z: tz, seed: hd * 100 });
      } else if (hd < 0.16) {   // estandarte
        st.push({ id: 'b', k: 'box', p: [fx, 1.55, fz], s: [along[0] === 0.07 ? 0.05 : 0.8, 1.35, along[2] === 0.07 ? 0.05 : 0.8], c: shade(th.accent, 0.7), e: 0.04, inst: 'estandarte' });
        st.push({ id: 'b2', k: 'box', p: [fx + dx * 0.02, 1.58, fz + dy * 0.02], s: [along[0] === 0.07 ? 0.05 : 0.3, 0.7, along[2] === 0.07 ? 0.05 : 0.3], c: '#e8d27a', inst: 'estandarteEmblema' });
        st.push({ id: 'b3', k: 'cyl', p: [fx, 2.28, fz], s: dx !== 0 ? [0.06, 0.95, 0.06] : [0.06, 0.95, 0.06], r: dx !== 0 ? [PI / 2, 0, 0] : [0, 0, PI / 2], c: '#4a3a2a', inst: 'estandarteBarra' });
      } else if (hd < 0.22) {   // cráneo en la pared
        st.push({ id: 's', k: 'sph', p: [fx + dx * 0.05, 1.3, fz + dy * 0.05], s: [0.34, 0.38, 0.34], c: '#e6e1cf', inst: 'craneo' });
        st.push({ id: 's2', k: 'box', p: [fx + dx * 0.15, 1.28, fz + dy * 0.15], s: dx !== 0 ? [0.06, 0.07, 0.2] : [0.2, 0.07, 0.06], c: '#14120e', inst: 'craneoOjos' });
      } else if (hd < 0.3 && th.name === 'PANTANO TÓXICO') {   // musgo
        st.push({ id: 'm', k: 'ico', p: [fx, 0.5 + hd * 3, fz], s: dx !== 0 ? [0.12, 0.8, 1.1] : [1.1, 0.8, 0.12], c: '#4f9a3e', inst: 'musgo' });
      } else if (hd > 0.9) {   // cadena
        st.push({ id: 'ch', k: 'cyl', p: [fx + dx * 0.05, 1.9, fz + dy * 0.05], s: [0.05, 1.5, 0.05], c: '#6c7078', inst: 'cadena' });
      }
    }
  }
  return st;
}

// ─── Piezas 2D ────────────────────────────────────────────────────
const MiniMap = React.memo(function MiniMap({ s, ver, accent }) {
  const R = 8, S = 5, p = s.p, dots = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = p.x + dx, y = p.y + dy; if (x < 0 || y < 0 || x >= VC_W || y >= VC_H || !s.seen[y][x] || s.map[y][x] === 0) continue;
    dots.push(<View key={`${x}_${y}`} style={{ position: 'absolute', left: (dx + R) * S, top: (dy + R) * S, width: S, height: S, backgroundColor: s.stairs.x === x && s.stairs.y === y ? accent : 'rgba(190,200,240,0.32)' }} />);
  }
  s.enemies.forEach(e => { if (s.vis.has(`${e.x},${e.y}`) && Math.abs(e.x - p.x) <= R && Math.abs(e.y - p.y) <= R) dots.push(<View key={`e${e.id}`} style={{ position: 'absolute', left: (e.x - p.x + R) * S - 1, top: (e.y - p.y + R) * S - 1, width: S + 2, height: S + 2, borderRadius: 4, backgroundColor: C.red }} />); });
  const ar = ['▲', '▶', '▼', '◀'][s.face];
  return (
    <View pointerEvents="none" style={{ position: 'absolute', right: 10, top: 6, width: (2 * R + 1) * S, height: (2 * R + 1) * S, backgroundColor: 'rgba(4,5,14,0.62)', borderRadius: 10, borderWidth: 1, borderColor: alpha(accent, 0.55), overflow: 'hidden' }}>
      {dots}
      <Text style={{ position: 'absolute', left: R * S - 4, top: R * S - 7, width: 14, color: C.amber, fontSize: 11, fontWeight: '900' }}>{ar}</Text>
    </View>
  );
});

// ─── Juego ────────────────────────────────────────────────────────
const initPlayer = () => ({ x: 1, y: 1, vx: 1, vy: 1, hp: 26, maxHp: 26, atk: 3, def: 0, lv: 1, xp: 0, gold: 0, potions: 2, bombs: 1, weapon: 0, armor: 0 });
function newRun() {
  const p = initPlayer(); const lvl = genFloor(1, p);
  return { p, floor: 1, ...lvl, face: 0, yawCur: 0, kills: 0, turn: 0, log: ['Los pasillos del vacío te esperan…'], t: 0, vis: new Set(), alive: true, over: false, endT: 0, swing: 0, hurtT: 0, hold: null, holdT: 0, ghosts: [], proj: [], bob: 0, moving: 0, final: null, toast: null };
}

export function VoidCrawler3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('void');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false, by: '' });
  const g = useRef(null);
  if (!g.current) { g.current = newRun(); computeVis(g.current); }
  if (globalThis.__TEST) globalThis.__game = g;   // gancho para las pruebas automáticas
  const addLog = m => { g.current.log = [m, ...g.current.log].slice(0, 3); };
  const scr = (s, x, y, h) => { const q = s.cam && project(s.cam, wpos(x, y, h), SCREEN_W, SCREEN_H); return q ? [q.x, q.y] : [SCREEN_W / 2, SCREEN_H * 0.4]; };
  const pop = (s, txt, color, x, y, h, size) => { const q = scr(s, x, y, h); fx.pop(q[0], q[1], txt, color, size || 20); };

  const start = () => { fx.clear(); clear3d(); g.current = newRun(); computeVis(g.current); setPhase('play'); hx.tap(); };
  const finish = (s, won, by) => {
    s.over = true; s.endT = won ? 1.7 : 1.0;
    s.final = s.floor * 100 + s.kills * 10 + s.p.gold + (won ? 500 : 0);
    s.endFn = () => { setRes({ isNew: submitBest(s.final), won, by }); setPhase('over'); };
  };
  const die = (s, by) => { s.alive = false; hx.die(); fx.shake(12, 0.5); fx.flash(C.red, 0.5); finish(s, false, by); };
  const levelCheck = s => {
    const p = s.p;
    while (p.xp >= need(p.lv)) {
      p.xp -= need(p.lv); p.lv += 1; p.maxHp += 6; p.hp = Math.min(p.maxHp, p.hp + 8); p.atk += 1; if (p.lv % 3 === 0) p.def += 1;
      addLog(`⬆️ ¡Nivel ${p.lv}!`); ring3d(wpos(p.x, p.y, 0.2), '#ffd54a', 26, { speed: 6, life: 0.7 }); burst3d(wpos(p.x, p.y, 1), ['#ffd54a', '#fff3b0'], 24, { speed: 5, up: 3, g: 6 });
      fx.pop(SCREEN_W / 2, SCREEN_H * 0.36, `NIVEL ${p.lv}`, C.amber, 30); fx.flash(C.amber, 0.25); hx.good();
    }
  };
  const hurt = (s, dmg, by, ignoreDef) => {
    const p = s.p; const d = Math.max(1, dmg - (ignoreDef ? 0 : p.def));
    p.hp -= d; s.hurtT = 0.45; fx.pop(SCREEN_W / 2, SCREEN_H * 0.42, `-${d}`, C.red, 30); fx.flash(C.red, 0.28); fx.shake(7, 0.25); hx.bad();
    if (p.hp <= 0) { p.hp = 0; die(s, by); }
  };
  const killEnemy = (s, e) => {
    s.kills += 1; s.p.xp += e.xp; hx.hit();
    const w = wpos(e.vx, e.vy, 1);
    burst3d(w, e.boss ? ['#ffb020', '#ff5a1a', '#fff3b0'] : ['#ffd54a', '#fff3b0', '#ffffff'], e.boss ? 70 : 22, { speed: e.boss ? 9 : 5.5, up: 3, g: 10, size: e.boss ? 0.3 : 0.17, life: 0.9 });
    ring3d([w[0], 0.2, w[2]], '#ffd54a', 18, { speed: 5, life: 0.5 });
    pop(s, `+${e.xp} XP`, C.amber, e.vx, e.vy, 2.2, 16);
    s.ghosts.push({ kind: 'dead', type: e.type, x: e.vx, y: e.vy, face: e.fyaw, t: 0, small: e.small, seed: e.seed });
    addLog(`⚔️ Derrotaste a ${e.e}${e.boss ? ' — ¡JEFE!' : ''} (+${e.xp} XP)`);
    s.enemies = s.enemies.filter(o => o !== e);
    if (e.split && !e.small) {
      for (const [dx, dy] of DIRS) {
        const nx = e.x + dx, ny = e.y + dy;
        if (!wallAt(s, nx, ny) && !s.enemies.some(o => o.x === nx && o.y === ny) && !(s.p.x === nx && s.p.y === ny)) {
          const m = mkEnemy('slime', { x: nx, y: ny }, s.floor); m.vx = e.x; m.vy = e.y; m.hp = m.maxHp = Math.max(2, Math.floor(e.maxHp / 3)); m.xp = 2; m.small = true; m.awake = true; s.enemies.push(m); break;
        }
      }
    }
    if (e.boss) { s.p.gold += 100; hx.win(); fx.flash('#fff', 0.5); fx.shake(14, 0.6); levelCheck(s); finish(s, true); return; }
    levelCheck(s);
  };
  const bfsStep = (s, e, tx, ty) => {
    const prev = new Map([[`${e.x},${e.y}`, null]]); const q = [[e.x, e.y, 0]];
    while (q.length) {
      const [x, y, d] = q.shift();
      if (d > 14) break;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
        if (prev.has(k)) continue;
        if (nx === tx && ny === ty) { let cur = `${x},${y}`; let step = [x, y]; while (prev.get(cur) !== null) { step = cur.split(',').map(Number); cur = prev.get(cur); } return step; }
        if (wallAt(s, nx, ny) || s.enemies.some(o => o !== e && o.x === nx && o.y === ny)) continue;
        prev.set(k, `${x},${y}`); q.push([nx, ny, d + 1]);
      }
    }
    return null;
  };
  const face = (e, tx, ty) => { const dx = tx - e.x, dy = ty - e.y; if (dx || dy) e.face = Math.atan2(-dx, -dy); };
  const lunge = (e, tx, ty) => { e.lunge = 0.3; e.lungeDir = [Math.sign(tx - e.x), Math.sign(ty - e.y)]; };
  const shoot = (s, e, color, kind) => { s.proj.push({ x0: e.vx, y0: e.vy, x1: s.p.x, y1: s.p.y, t: 0, dur: 0.28, color, kind }); };
  const stepEnemy = (s, e) => {
    const p = s.p; const dx = p.x - e.x, dy = p.y - e.y; const man = Math.abs(dx) + Math.abs(dy);
    const lineClear = los(s, e.x, e.y, p.x, p.y);
    if (!e.awake) { if (man <= 7 && lineClear) { e.awake = true; if (s.vis.has(`${e.x},${e.y}`)) { hx.warn(); ring3d(wpos(e.x, e.y, 2.3), '#ff4d6d', 10, { speed: 2.5, life: 0.5, size: 0.14 }); } } else return; }
    face(e, p.x, p.y);
    const approach = () => { const st = bfsStep(s, e, p.x, p.y); if (st && !(st[0] === p.x && st[1] === p.y)) { face(e, st[0], st[1]); e.x = st[0]; e.y = st[1]; } };
    if (e.ai === 'archer') {
      if ((dx === 0 || dy === 0) && man <= 6 && lineClear) { shoot(s, e, '#ffd27a', 'arrow'); lunge(e, p.x, p.y); hurt(s, e.atk, e.e); addLog(`${e.e} te dispara una flecha.`); return; }
      if (man <= 2) { const st = [[-Math.sign(dx), 0], [0, -Math.sign(dy)]].find(([ax, ay]) => (ax || ay) && !wallAt(s, e.x + ax, e.y + ay) && !s.enemies.some(o => o.x === e.x + ax && o.y === e.y + ay)); if (st) { e.x += st[0]; e.y += st[1]; } return; }
      approach(); return;
    }
    if (e.ai === 'mage') {
      if (man <= 4 && lineClear && e.turn % 2 === 0) { e.turn += 1; shoot(s, e, '#c9a0ff', 'orb'); lunge(e, p.x, p.y); ring3d(wpos(p.x, p.y, 0.3), '#c9a0ff', 16, { speed: 4, life: 0.5 }); hurt(s, e.atk, e.e, true); addLog(`${e.e} lanza un hechizo.`); return; }
      e.turn += 1; if (man > 2) approach(); return;
    }
    if (e.ai === 'boss') {
      e.turn += 1;
      if (e.warn) {
        const hit = e.warn.some(([x, y]) => x === p.x && y === p.y); const q = wpos(e.x, e.y, 1.2);
        ring3d([q[0], 0.4, q[2]], '#ff9d2e', 40, { speed: 9, life: 0.8, size: 0.28 }); burst3d(q, ['#ff9d2e', '#ffe45e', '#ff4d1a'], 60, { speed: 8, up: 1, g: -2, size: 0.3, life: 0.9 });
        e.fire = 0.9; fx.shake(10, 0.4); fx.flash(C.orange, 0.3); hx.heavy();
        e.warn.forEach(([x, y]) => { if (!wallAt(s, x, y)) burst3d(wpos(x, y, 0.3), ['#ff9d2e', '#ffe45e'], 6, { speed: 2, up: 3, g: -4, size: 0.3, life: 0.8 }); });
        e.warn = null;
        if (hit) { hurt(s, 14, e.e, true); addLog('🔥 ¡El aliento del dragón te quema!'); } else addLog('🔥 Esquivaste el aliento del dragón.');
        return;
      }
      if (e.turn % 4 === 0) { e.warn = []; for (let k = -4; k <= 4; k++) { e.warn.push([e.x + k, e.y], [e.x, e.y + k]); } addLog('⚠️ ¡El dragón inhala fuego! Sal de su fila y columna.'); hx.warn(); fx.pop(SCREEN_W / 2, SCREEN_H * 0.3, '¡FUEGO!', C.orange, 28); return; }
    }
    if (man === 1) { lunge(e, p.x, p.y); hurt(s, e.atk, e.e); addLog(`${e.e} te golpea.`); burst3d(wpos(p.x, p.y, 1.2), '#ff4d6d', 8, { speed: 3, up: 1.5, size: 0.12 }); return; }
    approach();
    if (e.ai === 'fast' && s.alive) { const d2 = Math.abs(p.x - e.x) + Math.abs(p.y - e.y); if (d2 === 1) { lunge(e, p.x, p.y); hurt(s, e.atk, e.e); } else approach(); }
  };
  const afterPlayer = s => {
    s.turn += 1; computeVis(s);
    if (s.alive) s.enemies.slice().forEach(e => { if (s.alive && s.enemies.includes(e)) stepEnemy(s, e); });
    if (s.alive) computeVis(s);
  };

  const act = (dx, dy) => {
    const s = g.current; if (phase !== 'play' || !s.alive || s.over) return;
    const p = s.p; const nx = p.x + dx, ny = p.y + dy;
    if (wallAt(s, nx, ny)) { hx.tick(); return; }
    const e = s.enemies.find(o => o.x === nx && o.y === ny);
    if (e) {
      const crit = Math.random() < 0.12; let d = Math.max(1, p.atk + WEAPONS[p.weapon][1] - e.def + randInt(0, 2)); if (crit) d *= 2;
      e.hp -= d; e.awake = true; e.flash = 0.18; s.swing = 0.28; face(e, p.x, p.y);
      const w = wpos(e.vx, e.vy, 1.2);
      burst3d(w, crit ? ['#ffd54a', '#fff'] : ['#ffffff', '#ffe9a0'], crit ? 20 : 10, { speed: 5, up: 1.5, size: 0.15 }); ring3d([w[0], 1, w[2]], crit ? '#ffd54a' : '#fff', 10, { speed: 3, life: 0.35, size: 0.1 });
      pop(s, `${crit ? '💥' : ''}${d}`, crit ? C.amber : C.text, e.vx, e.vy, 2.3, crit ? 26 : 20); fx.shake(crit ? 6 : 3, 0.15); hx.hit();
      if (e.hp <= 0) killEnemy(s, e); else addLog(`🗡️ Golpeas a ${e.e}: ${d} (${e.hp}/${e.maxHp})`);
      if (!s.over) afterPlayer(s);
      return;
    }
    p.x = nx; p.y = ny; hx.tick();
    const it = s.items.find(o => o.x === nx && o.y === ny);
    if (it) {
      const w = wpos(nx, ny, 0.5);
      if (it.kind === 'trap') { const d = randInt(3, 5) + s.floor; s.items = s.items.filter(o => o !== it); burst3d(w, ['#ff4d6d', '#c9ced8'], 16, { speed: 4, up: 4, size: 0.14 }); hurt(s, d, '⚠️', true); addLog(`⚠️ ¡Trampa de púas! -${d}`); }
      else if (it.kind === 'potion') { p.potions += 1; addLog('🧪 Recoges una poción.'); pop(s, '+🧪', C.lime, nx, ny, 1.2, 18); burst3d(w, '#7dff6b', 10, { speed: 2.5, up: 2.5, g: 2, size: 0.12 }); hx.good(); s.items = s.items.filter(o => o !== it); }
      else if (it.kind === 'bomb') { p.bombs += 1; addLog('💣 Recoges una bomba.'); pop(s, '+💣', C.orange, nx, ny, 1.2, 18); hx.good(); s.items = s.items.filter(o => o !== it); }
      else if (it.kind === 'gold') { const gold = randInt(8, 20) + s.floor * 4; p.gold += gold; pop(s, `+${gold}💰`, C.amber, nx, ny, 1.2, 18); burst3d(w, ['#ffd54a', '#fff3b0'], 12, { speed: 3, up: 3, size: 0.12 }); hx.good(); s.items = s.items.filter(o => o !== it); }
      else if (it.kind === 'shrine') { p.hp = p.maxHp; ring3d(wpos(nx, ny, 0.2), '#22e6ff', 30, { speed: 6, life: 0.8 }); burst3d(wpos(nx, ny, 0.5), '#9ff6ff', 30, { speed: 3, up: 5, g: -2, size: 0.14, life: 1.2 }); fx.flash(C.cyan, 0.3); addLog('⛲ El santuario restaura tu salud.'); hx.good(); s.items = s.items.filter(o => o !== it); }
      else if (it.kind === 'chest') {
        s.items = s.items.filter(o => o !== it); s.ghosts.push({ kind: 'chest', x: nx, y: ny, yaw: it.yaw, t: 0 });
        const r = Math.random(); burst3d(wpos(nx, ny, 0.8), ['#ffd54a', '#fff3b0', '#ffb300'], 36, { speed: 6, up: 5, g: 11, size: 0.18, life: 1.1 }); ring3d(wpos(nx, ny, 0.3), '#ffd54a', 20, { speed: 5 }); hx.win();
        if (r < 0.34 && p.weapon < WEAPONS.length - 1) { p.weapon = Math.min(WEAPONS.length - 1, p.weapon + 1); addLog(`📦 ¡Arma nueva: ${WEAPONS[p.weapon][0]}!`); pop(s, WEAPONS[p.weapon][0], C.cyan, nx, ny, 1.6, 20); }
        else if (r < 0.68 && p.armor < ARMORS.length - 1) { p.armor += 1; p.def += ARMORS[p.armor][1] - ARMORS[p.armor - 1][1]; addLog(`📦 ¡Armadura nueva: ${ARMORS[p.armor][0]}!`); pop(s, ARMORS[p.armor][0], C.cyan, nx, ny, 1.6, 20); }
        else { p.maxHp += 6; p.hp = Math.min(p.maxHp, p.hp + 10); addLog('📦 ¡Elixir! +6 PS máx.'); pop(s, '+6 PS máx', C.lime, nx, ny, 1.6, 20); }
      }
    }
    if (!s.over && nx === s.stairs.x && ny === s.stairs.y && s.floor < 5) {
      s.floor += 1; const lvl = genFloor(s.floor, p); Object.assign(s, lvl, { vis: new Set(), ghosts: [], proj: [] }); p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * 0.25));
      addLog(`🚪 Piso ${s.floor}: ${THEMES[s.floor - 1].name}`); hx.win(); fx.flash('#fff', 0.45); s.toast = { m: `PISO ${s.floor}`, sub: THEMES[s.floor - 1].name, t: 2.2 }; computeVis(s); return;
    }
    if (!s.over) afterPlayer(s);
  };
  const usePotion = () => { const s = g.current; const p = s.p; if (phase !== 'play' || s.over || p.potions <= 0 || p.hp >= p.maxHp) { hx.tick(); return; } p.potions -= 1; const h = Math.ceil(p.maxHp * 0.5); p.hp = Math.min(p.maxHp, p.hp + h); pop(s, `+${h}`, C.lime, p.x, p.y, 1.6, 24); ring3d(wpos(p.x, p.y, 0.2), '#7dff6b', 16, { speed: 3, life: 0.6 }); burst3d(wpos(p.x, p.y, 0.3), '#7dff6b', 14, { speed: 1.5, up: 4, g: -1, size: 0.12, life: 1 }); fx.flash(C.lime, 0.18); hx.good(); addLog('🧪 Bebes una poción.'); afterPlayer(s); };
  const useBomb = () => {
    const s = g.current; const p = s.p; if (phase !== 'play' || s.over || p.bombs <= 0) { hx.tick(); return; }
    p.bombs -= 1; const w = wpos(p.x, p.y, 0.6);
    ring3d([w[0], 0.3, w[2]], '#ff8a3d', 40, { speed: 11, life: 0.7, size: 0.26 }); burst3d(w, ['#ff8a3d', '#ffd54a', '#ff4d1a'], 60, { speed: 9, up: 2, g: 6, size: 0.3, life: 0.8 }); fx.flash(C.orange, 0.35); fx.shake(11, 0.4); hx.heavy();
    s.enemies.slice().forEach(e => { if (Math.abs(e.x - p.x) <= 2 && Math.abs(e.y - p.y) <= 2) { e.hp -= 12; e.awake = true; e.flash = 0.2; pop(s, '-12', C.orange, e.vx, e.vy, 2.3, 22); if (e.hp <= 0) killEnemy(s, e); } });
    addLog('💣 ¡BOOM!'); if (!s.over) afterPlayer(s);
  };
  const turnBy = d => { const s = g.current; if (phase !== 'play' || !s.alive || s.over) return; s.face = (s.face + d + 4) % 4; hx.tick(); };
  const stepDir = back => { const s = g.current; const [dx, dy] = DIRS[back ? (s.face + 2) % 4 : s.face]; act(dx, dy); };
  const hold = useRef({ k: null, t: 0 }).current;
  const pan = usePan(fx, {
    down: () => { g.current.used = false; },
    move: (x, y, gs) => { const s = g.current; if (s.used) return; if (Math.abs(gs.dx) > 40 && Math.abs(gs.dx) > Math.abs(gs.dy)) { s.used = true; turnBy(gs.dx > 0 ? 1 : -1); } },
  });

  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt; const p = s.p;
    // repetición de paso al mantener ▲ / ▼
    if (hold.k) { hold.t -= dt; if (hold.t <= 0) { hold.t = 0.2; stepDir(hold.k === 'b'); } }
    const k = Math.min(1, dt * 14);
    const dx = p.x - p.vx, dy = p.y - p.vy; s.moving = Math.hypot(dx, dy) > 0.05 ? 1 : 0;
    p.vx += dx * k; p.vy += dy * k;
    if (s.moving) s.bob += dt * 11;
    let d = YAW[s.face] - s.yawCur; d = ((d + PI * 3) % (PI * 2)) - PI; s.yawCur += d * Math.min(1, dt * 10);
    s.swing = Math.max(0, s.swing - dt); s.hurtT = Math.max(0, s.hurtT - dt);
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    s.enemies.forEach(e => {
      const kk = Math.min(1, dt * 9); e.vx += (e.x - e.vx) * kk; e.vy += (e.y - e.vy) * kk;
      let dd = e.face - e.fyaw; dd = ((dd + PI * 3) % (PI * 2)) - PI; e.fyaw += dd * Math.min(1, dt * 10);
      e.lunge = Math.max(0, e.lunge - dt); e.flash = Math.max(0, e.flash - dt); if (e.fire) e.fire = Math.max(0, e.fire - dt * 2.2);
    });
    s.ghosts.forEach(gh => { gh.t += dt; }); s.ghosts = s.ghosts.filter(gh => gh.t < (gh.kind === 'chest' ? 1.6 : 0.45));
    s.proj.forEach(q => { q.t += dt; if (Math.random() < 0.6) { const u = Math.min(1, q.t / q.dur); burst3d(wpos(q.x0 + (q.x1 - q.x0) * u, q.y0 + (q.y1 - q.y0) * u, 1.3), q.color, 1, { speed: 0.5, size: 0.1, life: 0.35, g: 0 }); } }); s.proj = s.proj.filter(q => q.t < q.dur);
    if (s.over) { s.endT -= dt; if (s.endT <= 0 && s.endFn) { const f = s.endFn; s.endFn = null; f(); } }
  });

  const s = g.current; const p = s.p; const th = THEMES[s.floor - 1];

  // Escena completa. t = reloj de animación; focus = [x, z] para elegir las luces; cam = cámara
  const buildScene = (t, cam, focus, menu) => {
    const objs = [];
    const ft = Math.floor(s.t * 12);
    // antorchas cercanas: llama animada + luces puntuales
    const near = s.torches.map(q => ({ q, d: Math.hypot(q.x - focus[0], q.z - focus[1]) })).sort((a, b) => a.d - b.d);
    const lights = [];
    near.forEach((o, i) => {
      if (o.d > 15) return;
      const q = o.q, fl = 0.8 + 0.2 * Math.sin(t * 13 + q.seed) + 0.1 * Math.sin(t * 29 + q.seed * 2);
      objs.push({ id: `fl${i}`, k: 'cone', p: [q.x, q.y + 0.12 * fl, q.z], s: [0.2 * fl, 0.46 * fl, 0.2 * fl], c: th.torch, e: 1 });
      objs.push({ id: `fh${i}`, k: 'sph', p: [q.x, q.y + 0.1, q.z], n: 0.5 * fl, c: th.torch, e: 1, o: 0.18 });
      if (lights.length < 3) lights.push({ p: [q.x, q.y + 0.15, q.z], c: th.torch, i: 6.5 * fl, d: 13 });
    });
    // escalera
    const seeSt = menu || s.seen[s.stairs.y][s.stairs.x];
    if (seeSt && s.floor < 5) {
      const w = wpos(s.stairs.x, s.stairs.y);
      for (let i = 0; i < 4; i++) objs.push({ id: `st${i}`, k: 'box', p: [w[0], 0.02 - i * 0.07, w[2]], s: [1.7 - i * 0.32, 0.09, 1.7 - i * 0.32], c: shade(th.accent, 0.35 + i * 0.1), e: 0.6 });
      objs.push({ id: 'stR', k: 'tor', p: [w[0], 0.12, w[2]], r: [PI / 2, t * 0.8, 0], n: 2.1, c: th.accent, e: 1 });
      objs.push({ id: 'stB', k: 'cyl', p: [w[0], 1.4, w[2]], s: [0.9, 2.6, 0.9], c: th.accent, e: 1, o: 0.18 + 0.05 * Math.sin(t * 3) });
      if (!menu && lights.length < 4) lights.push({ p: [w[0], 1.2, w[2]], c: th.accent, i: 4, d: 8 });
    }
    // objetos del suelo
    const vis = menu ? null : s.vis;
    s.items.forEach(it => {
      if (vis && !vis.has(`${it.x},${it.y}`) && !(it.kind === 'trap')) return;
      const w = wpos(it.x, it.y), id = `i${it.id}`, bob = Math.sin(t * 2.5 + it.id) * 0.06;
      if (it.kind === 'potion') {
        objs.push({ id, k: 'sph', p: [w[0], 0.5 + bob, w[2]], s: [0.46, 0.46, 0.46], c: '#4cd964', e: 0.55, o: 0.9 });
        objs.push({ id: id + 'n', k: 'cyl', p: [w[0], 0.8 + bob, w[2]], s: [0.15, 0.22, 0.15], c: '#cfe8d0', o: 0.9 });
        objs.push({ id: id + 'c', k: 'cyl', p: [w[0], 0.94 + bob, w[2]], s: [0.17, 0.08, 0.17], c: '#8a5a2a' });
        objs.push({ id: id + 'g', k: 'ring', p: [w[0], 0.03, w[2]], s: [1.1, 1.1, 1], c: '#7dff6b', e: 0.9, o: 0.4 + 0.2 * Math.sin(t * 3) });
      } else if (it.kind === 'chest') {
        objs.push(...chest(id, [w[0], 0, w[2]], { yaw: it.yaw, n: 1.2, open: 0, glow: true }));
        objs.push({ id: id + 'g', k: 'ring', p: [w[0], 0.03, w[2]], s: [1.9, 1.9, 1], c: '#ffd54a', e: 0.9, o: 0.35 + 0.15 * Math.sin(t * 3) });
      } else if (it.kind === 'gold') {
        for (let i = 0; i < 3; i++) objs.push(...coin(`${id}k${i}`, [w[0] + (i - 1) * 0.42, 0.45, w[2] + (i % 2) * 0.3 - 0.15], { t: t + i, bob: 0.08, n: 1.3, inst: 'oro' }));
      } else if (it.kind === 'bomb') {
        objs.push({ id, k: 'sph', p: [w[0], 0.34 + bob, w[2]], n: 0.55, c: '#2a2a33', m: { r: 0.3, m: 0.6 } });
        objs.push({ id: id + 'f', k: 'cyl', p: [w[0] + 0.1, 0.66 + bob, w[2]], s: [0.05, 0.26, 0.05], r: [0, 0, -0.5], c: '#8a6a3a' });
        objs.push({ id: id + 's', k: 'sph', p: [w[0] + 0.22, 0.78 + bob, w[2]], n: 0.14 + 0.05 * Math.sin(t * 25), c: '#ffd54a', e: 1 });
      } else if (it.kind === 'shrine') {
        objs.push({ id, k: 'cyl', p: [w[0], 0.3, w[2]], s: [1.0, 0.6, 1.0], c: '#8a8fa0' });
        objs.push({ id: id + 'p', k: 'cyl', p: [w[0], 0.7, w[2]], s: [0.7, 0.2, 0.7], c: '#a8adbd' });
        objs.push(...gem(id + 'g', [w[0], 1.05, w[2]], { c: '#22e6ff', n: 1.5, t }));
        objs.push({ id: id + 'r', k: 'tor', p: [w[0], 1.35, w[2]], r: [PI / 2, 0, t * 1.4], n: 1.1, c: '#22e6ff', e: 1 });
        if (!menu && lights.length < 4) lights.push({ p: [w[0], 1.3, w[2]], c: '#22e6ff', i: 5, d: 8 });
      } else if (it.kind === 'trap' && (menu ? false : Math.abs(it.x - p.x) + Math.abs(it.y - p.y) <= 2)) {
        objs.push({ id: id + 'b', k: 'box', p: [w[0], 0.03, w[2]], s: [1.4, 0.06, 1.4], c: '#3a3a44' });
        for (let i = 0; i < 5; i++) { const a = [[0, 0], [-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]][i]; objs.push({ id: `${id}s${i}`, k: 'cone', p: [w[0] + a[0], 0.2, w[2] + a[1]], s: [0.2, 0.42, 0.2], c: '#c9ced8', e: 0.15, m: { r: 0.3, m: 0.6 } }); }
      }
    });
    // advertencia del dragón
    s.enemies.forEach(e => { if (e.warn) e.warn.forEach(([x, y], i) => { if (wallAt(s, x, y)) return; const w = wpos(x, y); objs.push({ id: `wn${i}`, k: 'pla', p: [w[0], 0.06, w[2]], s: [CELL - 0.15, CELL - 0.15, 1], c: '#ff3b1a', e: 0.8 + 0.2 * Math.sin(t * 12), o: 0.85 }); }); });
    // enemigos
    s.enemies.forEach(e => {
      if (vis && !vis.has(`${e.x},${e.y}`)) return;
      const w = wpos(e.vx, e.vy); const l = e.lunge > 0 ? Math.sin((1 - e.lunge / 0.3) * PI) * 0.8 : 0;
      const lx = w[0] + e.lungeDir[0] * l, lz = w[2] + e.lungeDir[1] * l;
      const pp = menu ? 0 : 1;
      objs.push(...foeModel(`e${e.id}`, e.type, [lx, 0, lz], { yaw: e.fyaw, t, flash: e.flash > 0, small: e.small, warn: !!e.warn, fireAmt: e.fire || 0, seed: e.seed, n: e.boss ? 1 : 1 }));
      if (pp && e.awake) objs.push({ id: `ea${e.id}`, k: 'ring', p: [w[0], 0.04, w[2]], s: [1.3, 1.3, 1], c: '#ff4d6d', e: 0.9, o: 0.35 });
    });
    // fantasmas: cofres abiertos y enemigos que mueren
    s.ghosts.forEach((gh, i) => {
      const w = wpos(gh.x, gh.y);
      if (gh.kind === 'chest') objs.push(...chest(`gc${i}`, [w[0], 0, w[2]], { yaw: gh.yaw, n: 1.2, open: Math.min(1, gh.t / 0.35) }));
      else { const k = Math.max(0.05, 1 - gh.t / 0.45); objs.push(...foeModel(`gd${i}`, gh.type, [w[0], 0, w[2]], { yaw: gh.face, t, flash: true, small: gh.small, n: k, seed: gh.seed })); }
    });
    // proyectiles
    s.proj.forEach((q, i) => { const u = Math.min(1, q.t / q.dur); const w = wpos(q.x0 + (q.x1 - q.x0) * u, q.y0 + (q.y1 - q.y0) * u, 1.3); objs.push(q.kind === 'arrow' ? { id: `pj${i}`, k: 'cyl', p: w, s: [0.06, 0.7, 0.06], r: [PI / 2, Math.atan2(q.x1 - q.x0, q.y1 - q.y0), 0], c: q.color, e: 0.9 } : { id: `pj${i}`, k: 'sph', p: w, n: 0.4, c: q.color, e: 1 }); });
    if (!menu) {
      // mano con la espada y antorcha: pegadas a la cámara
      const hand = Bld('hand', cam.p, { yaw: cam.yaw, pitch: cam.pitch + 0.02, sh: false });
      const sw = s.swing > 0 ? Math.sin((1 - s.swing / 0.28) * PI) : 0, a = -0.25 + sw * 2.0, tx = -0.55 + sw * 0.6;
      const pv = [0.27 - sw * 0.3, -0.5 + sw * 0.05, -1.0 - sw * 0.2];
      const R = rotXYZ([tx, 0, a]), up = mv(R, [0, 0.3, 0]), gu = mv(R, [0, 0.01, 0]), hl = mv(R, [0, -0.09, 0]);
      hand.add('bl', 'box', [pv[0] + up[0], pv[1] + up[1], pv[2] + up[2]], [0.05, 0.6, 0.016], WEAPON_COL[p.weapon], { r: [tx, 0, a], e: p.weapon > 2 ? 0.6 : 0.08, m: { r: 0.3, m: 0.7 } });
      hand.add('gd', 'box', [pv[0] + gu[0], pv[1] + gu[1], pv[2] + gu[2]], [0.16, 0.035, 0.05], '#6a4a2a', { r: [tx, 0, a] });
      hand.add('hl', 'cyl', [pv[0] + hl[0], pv[1] + hl[1], pv[2] + hl[2]], [0.045, 0.17, 0.045], '#4a3a2a', { r: [tx, 0, a] });
      hand.add('fist', 'sph', [pv[0] + hl[0], pv[1] + hl[1], pv[2] + hl[2]], 0.085, '#e0b890');
      // antorcha de la mano izquierda
      const fl = 0.85 + 0.15 * Math.sin(t * 17);
      hand.add('tk', 'cyl', [-0.27, -0.5, -1.0], [0.04, 0.3, 0.04], '#5a3a1a', { r: [-0.15, 0, 0.1] });
      hand.add('tf', 'cone', [-0.26, -0.3, -1.0], [0.08 * fl, 0.2 * fl, 0.08 * fl], th.torch, { e: 1, sh: false });
      hand.add('tg', 'sph', [-0.26, -0.3, -1.0], 0.15 * fl, th.torch, { e: 1, o: 0.2 });
      objs.push(...hand.out);
      const cp = cam.p, f = [-sn(cam.yaw), 0, -cs(cam.yaw)];
      lights.unshift({ p: [cp[0] + f[0] * 0.5 - f[2] * -0.4, cp[1] - 0.1, cp[2] + f[2] * 0.5], c: th.torch, i: 7.5 + 0.6 * Math.sin(t * 17), d: 10 });
    }
    return {
      bg: th.fog, fog: { c: th.fog, near: 3, far: 19 }, shadows: false,
      light: { dir: [0, 1, 0], sun: '#000000', i: 0, sky: th.sky, ground: th.ground, hi: 1.5 },
      lights: lights.slice(0, 4), statics: s.statics, objs, cam,
    };
  };

  // cámara en primera persona (ojos del jugador) con balanceo al caminar
  const bobY = Math.sin(s.bob) * 0.045 * (s.moving ? 1 : 0), sway = Math.cos(s.bob * 0.5) * 0.012 * (s.moving ? 1 : 0);
  const cx = (p.vx + 0.5) * CELL, cz = (p.vy + 0.5) * CELL;
  const shakeP = s.hurtT > 0 ? Math.sin(s.t * 60) * 0.03 : 0;
  const cam = { p: [cx, EYE + bobY, cz], yaw: s.yawCur + sway + shakeP, pitch: -0.04, fov: FOV };
  s.cam = cam;
  const scene = phase === 'play' ? buildScene(s.t, cam, [cx, cz], false) : null;
  const menuScene = t => {
    const r = s.rooms[0], mx = (r.x + r.w / 2) * CELL, mz = (r.y + r.h / 2) * CELL;
    const sc = buildScene(t, { p: [mx, 2, mz], l: [mx, 1.0, mz], fov: 62 }, [mx, mz], true);
    const sk = foeModel('mn', s.floor === 5 ? 'dragon' : 'skeleton', [mx - 0.6, 0, mz - 0.4], { yaw: 0.6, t, seed: 1 });
    const ch = chest('mnc', [mx + 1.4, 0, mz + 0.6], { yaw: -0.5, n: 1.2, open: 0.5 + 0.5 * Math.sin(t * 1.2), glow: true });
    return { ...sc, objs: sc.objs.concat(sk, ch, { id: 'mnl', k: 'cone', p: [mx, 1.2, mz], s: [0.3, 0.6, 0.3], c: th.torch, e: 1 }), lights: [{ p: [mx, 1.6, mz], c: th.torch, i: 10, d: 14 }, ...sc.lights.slice(0, 3)] };
  };

  const pct = p.hp / p.maxHp;
  const sc = s.final != null ? s.final : s.floor * 100 + s.kills * 10 + p.gold;
  // barras de vida sobre los enemigos visibles
  const bars = [];
  if (phase === 'play') s.enemies.forEach(e => {
    if (!s.vis.has(`${e.x},${e.y}`) || Math.hypot(e.x - p.x, e.y - p.y) > 7) return;
    const q = project(cam, wpos(e.vx, e.vy, e.boss ? 3.0 : e.type === 'orc' || e.type === 'demon' ? 2.7 : 2.25), SCREEN_W, SCREEN_H); if (!q) return;
    const w = e.boss ? 90 : 46;
    bars.push(<View key={e.id} pointerEvents="none" style={{ position: 'absolute', left: q.x - w / 2, top: q.y - 6, width: w, alignItems: 'center' }}>
      <Text style={{ fontSize: e.boss ? 16 : 12 }}>{e.e}</Text>
      <Bar value={e.hp} max={e.maxHp} color={e.boss ? C.orange : C.red} h={e.boss ? 8 : 5} w={w} />
    </View>);
  });
  return (
    <Game3D title="VOID CRAWLER" emoji="☠️" accent={th.accent} onExit={onExit} score={sc} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene || menuScene(0)} menuScene={menuScene} orbit={{ r: 3.4, h: 1.5, speed: 0.28, ly: 1.1, drop: 0.5, fov: 64 }}
      hud={<>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(6,8,20,0.58)', borderRadius: 14, borderWidth: 1, borderColor: alpha(pct > 0.4 ? C.lime : C.red, 0.6), paddingHorizontal: 9, paddingVertical: 4 }}>
          <Text style={{ fontSize: 12, marginRight: 6 }}>❤️</Text><Bar value={p.hp} max={p.maxHp} color={pct > 0.4 ? C.lime : C.red} h={8} w={78} /><Text style={{ color: '#fff', fontSize: 11, fontWeight: '900', marginLeft: 6 }}>{p.hp}/{p.maxHp}</Text>
        </View>
        <HudPill icon="🏰" value={`${s.floor}/5`} color={th.accent} />
        <HudPill icon="⭐" value={`Nv.${p.lv}`} color={C.amber} />
      </>}
      subtitle="5 pisos de oscuridad procedural. Un dragón te espera al fondo."
      lines={['▲ ▼ avanzan y retroceden (un paso = un turno) · ◀ ▶ giran', 'Moverte hacia un enemigo lo ataca; los enemigos actúan después', '🏹 arqueros disparan en línea · 🔮 magos · ⚠️ trampas ocultas', '🧪 cura · 💣 daña alrededor · 📦 cofres dan equipo · ⛲ santuarios curan', 'Baja las escaleras brillantes y derrota al 🐉 del piso 5']}
      result={{ won: res.won, isNew: res.isNew, emoji: res.won ? '🏆' : '💀', title: res.won ? '¡VACÍO CONQUISTADO!' : 'HAS MUERTO', subtitle: res.won ? `Derrotaste al dragón · Nv.${p.lv}` : `Caíste en el piso ${s.floor} ante ${res.by || '…'}`, stats: [['PISO', `${s.floor}/5`], ['BAJAS', s.kills], ['ORO', p.gold], ['NIVEL', p.lv]] }}>
      {phase === 'play' && <>
        <View pointerEvents="none" style={{ ...absFill }}>{bars}</View>
        <MiniMap s={s} ver={s.turn * 8 + s.face + s.floor * 1000} accent={th.accent} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 10, top: 6, width: SCREEN_W - 156, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 10, backgroundColor: 'rgba(4,5,14,0.55)' }}>
          {s.log.map((m, i) => <Text key={i} numberOfLines={1} style={{ color: i === 0 ? C.text : alpha(C.dim, 0.85), fontSize: 11, lineHeight: 15 }}>{m}</Text>)}
        </View>
        {s.toast && <View pointerEvents="none" style={{ position: 'absolute', top: '24%', left: 0, right: 0, alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: 3, ...tglow(th.accent, 12) }}>{s.toast.m}</Text><Text style={{ color: th.accent, fontSize: 14, fontWeight: '900', letterSpacing: 3, ...tglow('#000', 5) }}>{s.toast.sub}</Text></View>}
        <View pointerEvents="none" style={{ position: 'absolute', left: SCREEN_W / 2 - 1, top: '38%', width: 2, height: 2 }} />
        <Text pointerEvents="none" style={{ position: 'absolute', left: 14, bottom: 216, color: alpha(C.dim, 0.95), fontSize: 11, fontWeight: '800', ...tglow('#000', 4) }}>⚔️ {p.atk + WEAPONS[p.weapon][1]} {WEAPONS[p.weapon][0]}  ·  🛡️ {p.def}  ·  💰 {p.gold}  ·  XP {p.xp}/{need(p.lv)}</Text>
        <ActionBtn testID="vd-potion" label={`${p.potions}`} icon="🧪" color={C.lime} size={56} onDown={usePotion} style={{ left: 14, bottom: 150 }} />
        <ActionBtn testID="vd-bomb" label={`${p.bombs}`} icon="💣" color={C.orange} size={56} onDown={useBomb} style={{ left: 14, bottom: 84 }} />
        <ActionBtn testID="vd-wait" label="ESPERAR" icon="⏳" color={C.dim} size={56} onDown={() => { if (phase === 'play' && !g.current.over) { afterPlayer(g.current); hx.tick(); } }} style={{ left: 14, bottom: 18 }} />
        <ActionBtn testID="vd-fwd" icon="▲" color={th.accent} size={60} onDown={() => { hold.k = 'f'; hold.t = 0.3; stepDir(false); }} onUp={() => { hold.k = null; }} style={{ right: 70, bottom: 138 }} />
        <ActionBtn testID="vd-left" icon="◀" color={th.accent} size={60} onDown={() => turnBy(-1)} style={{ right: 136, bottom: 78 }} />
        <ActionBtn testID="vd-right" icon="▶" color={th.accent} size={60} onDown={() => turnBy(1)} style={{ right: 4, bottom: 78 }} />
        <ActionBtn testID="vd-back" icon="▼" color={th.accent} size={60} onDown={() => { hold.k = 'b'; hold.t = 0.3; stepDir(true); }} onUp={() => { hold.k = null; }} style={{ right: 70, bottom: 18 }} />
      </>}
    </Game3D>
  );
}
const absFill = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 };
