/**
 * Monster Duel 3D – mundo abierto 3D para capturar y entrenar criaturas (motor 3D v2).
 * Explora una isla (terreno low-poly, hierba alta, lago, bosque), toca a las criaturas salvajes o camina por la hierba alta
 * para combatir, captura con Monstruobolas, evoluciona a tu equipo y vence a 5 líderes (faro dorado).
 * El combate por turnos se ve en una arena 3D con animaciones de ataque, proyectiles, golpes, captura y evolución.
 * Reglas, tipos, estadísticas y guardado son los del juego original.
 * Controles: joystick izquierdo mover · derecho girar la cámara.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Bar, C, SCREEN_H, SCREEN_W, alpha, clamp, hx, pick, rand, randInt, tglow, uid, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Btn3D, Game3D, HudPill, Panel3D, Stick3D } from '../utils/ui3d';
import { animal, bush, flower, hash01, house, person, rock, shade, tree } from '../utils/prefabs';
import { compassAngle, followCam, forward, project, right, seeded } from '../utils/openworld';

const PI = Math.PI, cs = Math.cos, sn = Math.sin;
// ─── geometría: constructor de modelos (mismo convenio que prefabs.js) ───
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
  const legs = (x, z, y, len, th, col, sw, hoof) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const a = sw * (sx * sz > 0 ? 1 : -1);
      add(`l${sx}${sz}`, 'cap', [sx * x, y - len / 2 * cs(a), sz * z - len / 2 * sn(a)], [th, len, th], col, { r: [a, 0, 0] });
      if (hoof) add(`h${sx}${sz}`, 'box', [sx * x, y - len * cs(a) + 0.02, sz * z - len * sn(a)], [th * 1.1, 0.07, th * 1.3], hoof, { sh: false });
    }
  };
  const eyes = (y, z, x, s, c) => { add('eL', 'sph', [-x, y, z], s, '#ffffff', { sh: false }); add('eR', 'sph', [x, y, z], s, '#ffffff', { sh: false }); add('pL', 'sph', [-x, y, z - s * 0.32], s * 0.55, c || '#15151c', { sh: false }); add('pR', 'sph', [x, y, z - s * 0.32], s * 0.55, c || '#15151c', { sh: false }); };
  return { add, legs, eyes, out };
}

// ─── mundo ───
const MD_W = 30, MD_H = 30, TS = 2, HALF = MD_W * TS / 2;
const MDT = { GRASS: 0, TALL: 1, TREE: 2, ROCK: 3, WATER: 4, HOUSE: 5 };
const tileOf = (map, x, z) => { const tx = Math.floor((x + HALF) / TS), tz = Math.floor((z + HALF) / TS); return tx < 0 || tz < 0 || tx >= MD_W || tz >= MD_H ? MDT.WATER : map[tz][tx]; };
const walkable = (map, x, z, r = 0.45) => [[-r, -r], [r, -r], [-r, r], [r, r]].every(([dx, dz]) => { const t = tileOf(map, x + dx, z + dz); return t === MDT.GRASS || t === MDT.TALL; });
const tw = tx => (tx + 0.5) * TS - HALF;     // centro de tile → mundo

function genWorld() {
  const map = Array.from({ length: MD_H }, () => Array(MD_W).fill(MDT.GRASS));
  const blob = (cx, cz, r, t) => { for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) if (x >= 0 && z >= 0 && x < MD_W && z < MD_H && Math.hypot(x - cx, z - cz) <= r + 0.3 && Math.random() < 0.9) map[z][x] = t; };
  for (let i = 0; i < 10; i++) blob(randInt(4, MD_W - 5), randInt(4, MD_H - 5), randInt(1, 3), MDT.TALL);
  for (let i = 0; i < 3; i++) blob(randInt(6, MD_W - 7), randInt(6, MD_H - 7), randInt(2, 3), MDT.WATER);
  for (let z = 0; z < MD_H; z++) for (let x = 0; x < MD_W; x++) {
    const edge = Math.min(x, z, MD_W - 1 - x, MD_H - 1 - z);
    if (edge < 2) { map[z][x] = MDT.WATER; continue; }
    const r = Math.random();
    if (map[z][x] === MDT.GRASS && r < 0.07) map[z][x] = MDT.TREE; else if (map[z][x] === MDT.GRASS && r < 0.1) map[z][x] = MDT.ROCK;
  }
  const sx = MD_W / 2, sz = MD_H / 2;
  for (let z = sz - 4; z <= sz + 3; z++) for (let x = sx - 4; x <= sx + 3; x++) map[z][x] = MDT.GRASS;   // zona de inicio despejada
  map[sz - 4][sx - 3] = MDT.HOUSE; map[sz - 4][sx + 2] = MDT.HOUSE;
  return map;
}
// máscara suave de agua (bilinear sobre el centro de los tiles) → costas redondeadas
function waterMask(map, x, z) {
  const fx = (x + HALF) / TS - 0.5, fz = (z + HALF) / TS - 0.5, x0 = Math.floor(fx), z0 = Math.floor(fz), u = fx - x0, v = fz - z0;
  const q = (a, b) => { if (a < 0 || b < 0 || a >= MD_W || b >= MD_H) return 1; return map[b][a] === MDT.WATER ? 1 : 0; };
  return (q(x0, z0) * (1 - u) + q(x0 + 1, z0) * u) * (1 - v) + (q(x0, z0 + 1) * (1 - u) + q(x0 + 1, z0 + 1) * u) * v;
}
const mkHeight = map => (x, z) => {
  const wm = waterMask(map, x, z), s = Math.max(0, Math.min(1, wm * 1.4));
  return 0.32 * Math.sin(x * 0.21) * Math.cos(z * 0.17) + 0.22 * Math.sin(x * 0.09 + z * 0.13) + 0.2 - s * 1.5;
};
function worldStatics(map, h) {
  const st = []; const r = seeded(7);
  for (let tz = 0; tz < MD_H; tz++) for (let tx = 0; tx < MD_W; tx++) {
    const t = map[tz][tx], x = tw(tx), z = tw(tz), y = h(x, z), id = `${tx}_${tz}`, j = () => (r() - 0.5) * 1.1;
    if (t === MDT.TREE) st.push(...tree(`t${id}`, [x + j() * 0.4, y, z + j() * 0.4], { kind: hash01(id) < 0.4 ? 'pine' : 'oak', h: 0.9 + r() * 0.5, inst: 'arbol' }));
    else if (t === MDT.ROCK) st.push(...rock(`r${id}`, [x, y, z], { kind: 'boulder', inst: 'roca', c: r() < 0.5 ? '#8c8f99' : '#9a9486', h: 0.7 }));
    else if (t === MDT.HOUSE) st.push(...house(`h${id}`, [x, y, z], { kind: hash01(id) < 0.5 ? 'cottage' : 'hut', yaw: 0.2, lit: true }));
    else if (t === MDT.TALL) {
      for (let i = 0; i < 9; i++) st.push({ id: `g${id}_${i}`, k: 'cone', p: [x + (r() - 0.5) * 1.8, y + 0.35, z + (r() - 0.5) * 1.8], s: [0.2, 0.9 + r() * 0.3, 0.2], r: [(r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5], c: shade('#3d9a3f', 0.8 + r() * 0.4), inst: 'hierbaAlta' });
    } else if (t === MDT.GRASS) {
      const q = r();
      if (q < 0.3) for (let i = 0; i < 3; i++) st.push({ id: `u${id}_${i}`, k: 'cone', p: [x + j(), y + 0.15, z + j()], s: [0.1, 0.34, 0.1], c: shade('#5fb44a', 0.85 + r() * 0.3), inst: 'hierba' });
      else if (q < 0.42) st.push(...flower(`f${id}`, [x + j(), y, z + j()], { inst: 'flor', c: pick(['#ff6fa8', '#ffd54a', '#ffffff', '#b57bff']) }));
      else if (q < 0.46) st.push(...bush(`b${id}`, [x + j(), y, z + j()], { inst: 'arbusto' }));
    }
  }
  return st;
}

// ─── criaturas ───
const MONS = [
  { id: 0, name: 'FLAMECAT', e: '🐱', type: 'fire', hp: 45, atk: 15, def: 9, evo: 1, evoLvl: 16 }, { id: 1, name: 'BLAZELION', e: '🦁', type: 'fire', hp: 70, atk: 25, def: 14, evo: -1 },
  { id: 2, name: 'AQUAPUP', e: '🐶', type: 'water', hp: 44, atk: 13, def: 11, evo: 3, evoLvl: 16 }, { id: 3, name: 'TIDEWOLF', e: '🐺', type: 'water', hp: 68, atk: 22, def: 17, evo: -1 },
  { id: 4, name: 'SPROUTLING', e: '🌱', type: 'grass', hp: 45, atk: 12, def: 12, evo: 5, evoLvl: 16 }, { id: 5, name: 'THORNWOOD', e: '🌲', type: 'grass', hp: 66, atk: 19, def: 20, evo: -1 },
  { id: 6, name: 'ZAPPYMOLE', e: '🐹', type: 'electric', hp: 38, atk: 20, def: 7, evo: 7, evoLvl: 18 }, { id: 7, name: 'VOLTFANG', e: '🦔', type: 'electric', hp: 58, atk: 31, def: 11, evo: -1 },
  { id: 8, name: 'FROSTBEAR', e: '🐻', type: 'ice', hp: 60, atk: 20, def: 18, evo: -1 }, { id: 9, name: 'SHADOWFOX', e: '🦊', type: 'dark', hp: 42, atk: 22, def: 9, evo: -1 },
  { id: 10, name: 'AEROBIRD', e: '🐦', type: 'flying', hp: 38, atk: 17, def: 9, evo: 11, evoLvl: 20 }, { id: 11, name: 'STORMROC', e: '🦅', type: 'flying', hp: 60, atk: 28, def: 13, evo: -1 },
  { id: 12, name: 'INKOCTUS', e: '🐙', type: 'water', hp: 40, atk: 16, def: 11, evo: -1 }, { id: 13, name: 'BLAZESTEED', e: '🐴', type: 'fire', hp: 60, atk: 24, def: 12, evo: -1 },
  { id: 14, name: 'STONEGUARD', e: '🦏', type: 'rock', hp: 70, atk: 16, def: 25, evo: -1 },
];
const MULT = {
  fire: { grass: 2, ice: 2, water: 0.5, rock: 0.5, fire: 0.5 }, water: { fire: 2, rock: 2, grass: 0.5, water: 0.5 },
  grass: { water: 2, rock: 2, fire: 0.5, grass: 0.5, flying: 0.5 }, electric: { water: 2, flying: 2, grass: 0.5, electric: 0.5 },
  rock: { fire: 2, flying: 2, ice: 2, water: 0.5, grass: 0.5 }, ice: { grass: 2, flying: 2, water: 0.5, ice: 0.5, fire: 0.5 },
  dark: { electric: 1, flying: 1, normal: 1 }, flying: { grass: 2, electric: 0.5, rock: 0.5 }, normal: {},
};
const TC = { fire: '#ff5a2a', water: '#2d8cff', grass: '#3ccf7a', electric: '#ffd400', rock: '#b07040', ice: '#37e0e0', dark: '#a05bd0', flying: '#8fcfff', normal: '#d8d8e4' };
const TYPE_NAME = { fire: 'FUEGO', water: 'AGUA', grass: 'PLANTA', electric: 'ELÉCTRICO', rock: 'ROCA', ice: 'HIELO', dark: 'SINIESTRO', flying: 'VOLADOR', normal: 'NORMAL' };
const TYPE_MOVES = {
  fire: [['Brasa', 48], ['Llamarada', 95]], water: [['Pistola Agua', 48], ['Hidrobomba', 95]], grass: [['Látigo Cepa', 48], ['Rayo Solar', 95]],
  electric: [['Impactrueno', 48], ['Trueno', 95]], rock: [['Lanzarrocas', 48], ['Avalancha', 95]], ice: [['Aliento Gélido', 48], ['Ventisca', 95]],
  dark: [['Mordisco', 48], ['Pulso Umbrío', 95]], flying: [['Picoteo', 48], ['Ataque Cielo', 95]],
};
const STATUS = [{ n: 'Rugido', eff: 'atkdown', pp: 10, d: 'baja el ataque rival' }, { n: 'Endurecer', eff: 'defup', pp: 10, d: 'sube tu defensa' }, { n: 'Recuperar', eff: 'heal', pp: 5, d: 'cura el 40% de PS' }];
const STATS = (b, lv) => ({ maxHp: Math.floor(b.hp * (1 + (lv - 5) * 0.12)), atk: Math.floor(b.atk * (1 + (lv - 5) * 0.08)), def: Math.floor(b.def * (1 + (lv - 5) * 0.08)) });
const TRAINERS = ['Líder Brasa', 'Líder Marea', 'Líder Raíz', 'Líder Chispa', 'Líder Cumbre'];
const SIZE = [0.95, 1.25, 0.95, 1.2, 0.9, 1.35, 0.85, 1.0, 1.3, 1.0, 0.8, 1.2, 1.0, 1.25, 1.35];

// Modelo 3D de cada especie. o: { yaw, t, walk, flash, n, o, roll, sink }
function creature(id, sp, p, o) {
  const t = o.t || 0, w = o.walk || 0, n = (o.n || 1) * (SIZE[sp] || 1) * 0.8;
  const B = Bld(id, [p[0], p[1] - (o.sink || 0), p[2]], { yaw: o.yaw, roll: o.roll, n, flash: o.flash, o: o.o });
  const { add, legs, eyes } = B;
  const bob = Math.sin(t * 3) * 0.03 + Math.abs(Math.sin(t * 9)) * 0.06 * w, sw = Math.sin(t * 9) * 0.55 * w;
  const wag = Math.sin(t * 6) * 0.35;
  switch (sp) {
    case 0: case 1: {   // gato / león de fuego
      const L = sp === 1, c = L ? '#f2a33a' : '#ff7a3a', c2 = L ? '#ff5a1a' : '#ffe2b0', S = L ? 1.15 : 1;
      legs(0.16 * S, 0.3 * S, 0.34 * S, 0.34 * S, 0.13 * S, c, sw, c2);
      add('body', 'cap', [0, 0.5 * S + bob, 0], [0.46 * S, 0.9 * S, 0.42 * S], c, { r: [PI / 2, 0, 0] });
      add('belly', 'sph', [0, 0.42 * S + bob, -0.05], [0.4 * S, 0.3 * S, 0.7 * S], c2, { sh: false });
      add('head', 'sph', [0, 0.78 * S + bob, -0.55 * S], [0.5 * S, 0.44 * S, 0.44 * S], c);
      if (L) for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; add('m' + i, 'ico', [Math.cos(a) * 0.3, 0.78 + bob + Math.sin(a) * 0.3, -0.45], 0.26, i % 2 ? '#ff5a1a' : '#d93a12', { e: 0.45, sh: false }); }
      for (const sx of [-1, 1]) add('ear' + sx, 'cone', [sx * 0.17 * S, 1.02 * S + bob, -0.5 * S], [0.14 * S, 0.24 * S, 0.1 * S], '#d93a12', { sh: false });
      eyes(0.82 * S + bob, -0.76 * S, 0.12 * S, 0.1 * S, '#3a2a0a'); add('nose', 'sph', [0, 0.72 * S + bob, -0.78 * S], 0.07, '#3a1a0a', { sh: false });
      for (let i = 0; i < 4; i++) add('tail' + i, 'sph', [Math.sin(t * 4 + i) * 0.05, 0.5 * S + 0.1 * i * S + bob, (0.5 + i * 0.12) * S], 0.14 * S - i * 0.01, c, { sh: false });
      add('flame', 'cone', [0, 0.95 * S + bob + Math.sin(t * 12) * 0.03, (0.95) * S], [0.2 * S, 0.4 * S, 0.2 * S], '#ffd54a', { e: 1, sh: false });
      add('flame2', 'cone', [0, 0.92 * S + bob, 0.95 * S], [0.3 * S, 0.3 * S, 0.3 * S], '#ff5a1a', { e: 1, o: 0.6, sh: false });
      break;
    }
    case 2: case 3: {   // perro / lobo de agua
      const W2 = sp === 3, c = W2 ? '#2a6fd6' : '#3d9cff', c2 = '#bfe6ff', S = W2 ? 1.15 : 1;
      legs(0.14 * S, 0.3 * S, 0.38 * S, 0.38 * S, 0.12 * S, c, sw, c2);
      add('body', 'cap', [0, 0.52 * S + bob, 0], [0.42 * S, 0.95 * S, 0.4 * S], c, { r: [PI / 2, 0, 0] });
      add('chest', 'sph', [0, 0.5 * S + bob, -0.3 * S], [0.4 * S, 0.4 * S, 0.4 * S], c2, { sh: false });
      add('head', 'sph', [0, 0.76 * S + bob, -0.55 * S], [0.36 * S, 0.34 * S, 0.38 * S], c);
      add('snout', 'box', [0, 0.68 * S + bob, -0.78 * S], [0.16 * S, 0.13 * S, 0.24 * S], c2, { sh: false }); add('nose', 'sph', [0, 0.71 * S + bob, -0.9 * S], 0.06, '#14141a', { sh: false });
      for (const sx of [-1, 1]) add('fin' + sx, 'box', [sx * 0.22 * S, 0.86 * S + bob, -0.5 * S], [0.04, 0.3 * S, 0.22 * S], '#37e0e0', { r: [0, 0, sx * 0.5], e: 0.3, sh: false });
      eyes(0.82 * S + bob, -0.7 * S, 0.1 * S, 0.075 * S);
      if (W2) for (let i = 0; i < 4; i++) add('dor' + i, 'cone', [0, 0.82 + bob, -0.3 + i * 0.22], [0.12, 0.26, 0.12], '#37e0e0', { e: 0.4, sh: false });
      add('tail', 'cap', [wag * 0.2, 0.7 * S + bob, 0.55 * S], [0.1 * S, 0.5 * S, 0.1 * S], '#37e0e0', { r: [-0.9, wag, 0], e: 0.3, sh: false });
      add('drop', 'sph', [0.1, 1.1 + bob, -0.4], [0.09, 0.14, 0.09], '#9fd8ff', { e: 0.6, sh: false });
      break;
    }
    case 4: {   // brote
      add('foot1', 'sph', [-0.2, 0.1, -0.05 + sw * 0.1], [0.2, 0.14, 0.26], '#4aa05a'); add('foot2', 'sph', [0.2, 0.1, -0.05 - sw * 0.1], [0.2, 0.14, 0.26], '#4aa05a');
      add('body', 'sph', [0, 0.52 + bob, 0], [0.8, 0.74, 0.74], '#5ccf6a');
      add('belly', 'sph', [0, 0.44 + bob, -0.2], [0.55, 0.5, 0.4], '#c8f5c0', { sh: false });
      eyes(0.62 + bob, -0.34, 0.15, 0.13, '#1a2a1a');
      add('chL', 'sph', [-0.26, 0.5 + bob, -0.33], 0.1, '#ff9fb0', { sh: false }); add('chR', 'sph', [0.26, 0.5 + bob, -0.33], 0.1, '#ff9fb0', { sh: false });
      add('stem', 'cyl', [0, 0.98 + bob, 0], [0.07, 0.3, 0.07], '#3a8a40', { r: [0, 0, wag * 0.3] });
      add('leaf1', 'ico', [-0.2, 1.16 + bob, 0], [0.42, 0.1, 0.22], '#7dff7a', { r: [0, 0, 0.4 + wag * 0.2] }); add('leaf2', 'ico', [0.2, 1.16 + bob, 0], [0.42, 0.1, 0.22], '#7dff7a', { r: [0, 0, -0.4 - wag * 0.2] });
      break;
    }
    case 5: {   // árbol viviente
      for (const sx of [-1, 1]) add('root' + sx, 'cone', [sx * 0.3, 0.2, 0.05 + sw * 0.1 * sx], [0.26, 0.4, 0.26], '#5a3a20', { r: [PI, 0, 0] });
      add('trunk', 'cyl', [0, 0.7 + bob, 0], [0.8, 1.2, 0.7], '#7a5230');
      add('bark', 'cyl', [0, 0.75 + bob, 0.02], [0.85, 0.2, 0.75], '#5a3a20', { sh: false });
      eyes(0.95 + bob, -0.32, 0.16, 0.12, '#ffe14d'); add('mouth', 'box', [0, 0.72 + bob, -0.36], [0.22, 0.06, 0.04], '#2a1608', { sh: false });
      for (const [x, y, z, s2, cc] of [[0, 1.55, 0, 1.0, '#3ccf7a'], [-0.5, 1.35, 0.1, 0.7, '#2fa85a'], [0.5, 1.4, -0.1, 0.75, '#4fe08a'], [0.1, 1.8, 0.1, 0.6, '#5fe898']]) add(`lf${x}`, 'ico', [x, y + bob, z], [s2, s2 * 0.85, s2], cc);
      for (const sx of [-1, 1]) { add('arm' + sx, 'cap', [sx * 0.55, 0.85 + bob, -0.05], [0.16, 0.7, 0.16], '#7a5230', { r: [0, 0, sx * -0.6] }); add('th' + sx, 'cone', [sx * 0.78, 0.95 + bob, -0.05], [0.1, 0.26, 0.1], '#e8d27a', { r: [0, 0, sx * -1.3], sh: false }); }
      break;
    }
    case 6: {   // topo eléctrico
      add('body', 'sph', [0, 0.45 + bob, 0], [0.7, 0.62, 0.8], '#b08a3a');
      add('belly', 'sph', [0, 0.38 + bob, -0.12], [0.5, 0.42, 0.5], '#f0d890', { sh: false });
      add('head', 'sph', [0, 0.62 + bob, -0.38], [0.52, 0.46, 0.42], '#b08a3a');
      add('nose', 'cone', [0, 0.58 + bob, -0.66], [0.16, 0.26, 0.16], '#ff9fb0', { r: [-PI / 2, 0, 0] });
      eyes(0.7 + bob, -0.58, 0.14, 0.08, '#14141a');
      for (const sx of [-1, 1]) { add('ear' + sx, 'sph', [sx * 0.24, 0.92 + bob, -0.34], [0.16, 0.2, 0.08], '#ffd400', { e: 0.4 }); add('cl' + sx, 'box', [sx * 0.34, 0.2, -0.45 + sw * sx * 0.1], [0.22, 0.1, 0.26], '#7a5a2a'); add('ft' + sx, 'sph', [sx * 0.2, 0.08, 0.1], [0.2, 0.14, 0.3], '#7a5a2a'); }
      for (let i = 0; i < 3; i++) add('bolt' + i, 'box', [(i % 2 ? 0.1 : -0.1), 0.5 + i * 0.22 + bob, 0.45 + i * 0.05], [0.1, 0.24, 0.05], '#ffd400', { r: [0, 0, i % 2 ? 0.6 : -0.6], e: 1, sh: false });
      break;
    }
    case 7: {   // erizo eléctrico
      legs(0.18, 0.22, 0.2, 0.2, 0.12, '#3a2a4a', sw);
      add('body', 'ico', [0, 0.45 + bob, 0.05], [0.9, 0.7, 1.05], '#4a3a5a');
      for (let i = 0; i < 14; i++) { const a = (i / 14) * PI * 1.5 - 0.2, rr = 0.42; add('sp' + i, 'cone', [Math.sin(a) * 0.4, 0.62 + Math.cos(a) * 0.35 + bob, 0.2 + (i % 3 - 1) * 0.2], [0.12, 0.45, 0.12], '#ffd400', { r: [(i % 3 - 1) * 0.3, 0, Math.sin(a) * -0.9], e: 0.7, sh: false }); }
      add('face', 'sph', [0, 0.42 + bob, -0.48], [0.5, 0.42, 0.42], '#f0d0a8');
      add('nose', 'sph', [0, 0.4 + bob, -0.72], 0.08, '#14141a', { sh: false }); eyes(0.5 + bob, -0.64, 0.12, 0.09);
      for (const sx of [-1, 1]) add('fg' + sx, 'cone', [sx * 0.08, 0.28 + bob, -0.68], [0.04, 0.12, 0.04], '#ffffff', { r: [PI, 0, 0], sh: false });
      break;
    }
    case 8: {   // oso de hielo
      legs(0.28, 0.34, 0.4, 0.4, 0.26, '#cfe8ff', sw);
      add('body', 'sph', [0, 0.72 + bob, 0], [1.0, 0.9, 1.1], '#e6f3ff');
      add('head', 'sph', [0, 1.05 + bob, -0.62], [0.6, 0.52, 0.5], '#eef7ff');
      add('snout', 'sph', [0, 0.97 + bob, -0.92], [0.28, 0.22, 0.2], '#b8d8f0', { sh: false }); add('nose', 'sph', [0, 1.0 + bob, -1.02], 0.07, '#14141a', { sh: false });
      for (const sx of [-1, 1]) add('ear' + sx, 'sph', [sx * 0.26, 1.35 + bob, -0.55], 0.17, '#cfe8ff');
      eyes(1.12 + bob, -0.86, 0.15, 0.08);
      for (let i = 0; i < 4; i++) add('ice' + i, 'oct', [(i - 1.5) * 0.2, 1.3 + bob + (i % 2) * 0.1, 0.05 + (i % 2) * 0.2], [0.2, 0.46, 0.2], '#5ae8ff', { e: 0.55, r: [0, i, 0.2 * (i - 1.5)], sh: false });
      break;
    }
    case 9: {   // zorro oscuro
      legs(0.13, 0.28, 0.4, 0.4, 0.1, '#241840', sw, '#f4f0ff');
      add('body', 'cap', [0, 0.52 + bob, 0], [0.34, 0.9, 0.32], '#3a2a5a', { r: [PI / 2, 0, 0] });
      add('chest', 'sph', [0, 0.48 + bob, -0.3], [0.3, 0.3, 0.3], '#f4f0ff', { sh: false });
      add('head', 'sph', [0, 0.78 + bob, -0.52], [0.34, 0.3, 0.4], '#3a2a5a'); add('snout', 'cone', [0, 0.72 + bob, -0.78], [0.14, 0.3, 0.14], '#f4f0ff', { r: [-PI / 2, 0, 0], sh: false });
      for (const sx of [-1, 1]) add('ear' + sx, 'cone', [sx * 0.12, 1.0 + bob, -0.5], [0.14, 0.34, 0.1], '#241840', { sh: false });
      eyes(0.82 + bob, -0.7, 0.1, 0.07, '#d684ff'); add('glow', 'sph', [0, 0.78 + bob, -0.7], [0.3, 0.1, 0.1], '#d684ff', { e: 0.8, o: 0.3, sh: false });
      add('tail', 'ico', [wag * 0.3, 0.7 + bob, 0.78], [0.42, 0.42, 0.9], '#3a2a5a', { r: [-0.4, wag, 0] }); add('tip', 'ico', [wag * 0.4, 0.9 + bob, 1.2], [0.3, 0.3, 0.4], '#f4f0ff', { r: [-0.4, wag, 0], sh: false });
      break;
    }
    case 10: case 11: {   // pájaro / águila
      const E = sp === 11, c = E ? '#8a94b0' : '#6fb8ff', S = E ? 1.4 : 1, fl = Math.sin(t * (E ? 7 : 11)) * 0.7, y0 = (E ? 1.0 : 0.7) + bob * 2 + Math.sin(t * 2) * 0.05;
      add('body', 'sph', [0, y0, 0], [0.5 * S, 0.5 * S, 0.7 * S], c);
      add('belly', 'sph', [0, y0 - 0.1 * S, -0.06], [0.36 * S, 0.3 * S, 0.5 * S], E ? '#e8eefc' : '#e0f2ff', { sh: false });
      add('head', 'sph', [0, y0 + 0.25 * S, -0.34 * S], [0.34 * S, 0.34 * S, 0.34 * S], E ? '#f4f6ff' : c);
      add('beak', 'cone', [0, y0 + 0.2 * S, -0.62 * S], [0.12 * S, 0.3 * S, 0.12 * S], E ? '#ffd400' : '#ff9a3a', { r: [-PI / 2, 0, 0], sh: false });
      eyes(y0 + 0.32 * S, -0.5 * S, 0.1 * S, 0.07 * S, E ? '#c0392b' : '#14141a');
      for (const sx of [-1, 1]) { add('wing' + sx, 'box', [sx * (0.3 + 0.4 * S * cs(fl)) * S * 0.9, y0 + 0.4 * S * sn(fl) * 0.7, 0.05], [0.7 * S, 0.05, 0.5 * S], E ? '#6a7490' : '#4a98e8', { r: [0, 0, sx * fl], sh: false }); add('tf' + sx, 'box', [sx * 0.1, y0 - 0.05, 0.5 * S], [0.1, 0.04, 0.5 * S], E ? '#ffd400' : '#4a98e8', { r: [0.2, sx * 0.3, 0], e: E ? 0.8 : 0, sh: false }); }
      if (E) for (let i = 0; i < 3; i++) add('bolt' + i, 'box', [(i % 2 ? 0.1 : -0.1), y0 - 0.1, 0.8 + i * 0.2], [0.07, 0.07, 0.3], '#ffd400', { r: [0, i % 2 ? 0.7 : -0.7, 0], e: 1, sh: false });
      break;
    }
    case 12: {   // pulpo
      add('head', 'sph', [0, 0.95 + bob, 0], [0.95, 1.0, 0.95], '#8a4acb');
      add('spot', 'sph', [0.2, 1.2 + bob, -0.2], [0.2, 0.12, 0.2], '#b57bff', { sh: false });
      eyes(0.95 + bob, -0.42, 0.2, 0.17, '#14141a');
      for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2; for (let j = 0; j < 4; j++) { const rr = 0.3 + j * 0.16, wv = Math.sin(t * 3 + i + j * 0.8) * 0.1; add(`t${i}_${j}`, 'sph', [Math.cos(a) * rr + wv, 0.4 - j * 0.1 + Math.abs(wv) * 0.5, Math.sin(a) * rr + wv], [0.2 - j * 0.03, 0.2 - j * 0.03, 0.2 - j * 0.03], '#7a3ab8'); } }
      add('ink', 'sph', [0.8, 0.9 + bob + Math.sin(t * 2) * 0.1, -0.5], [0.1, 0.14, 0.1], '#2a1a4a', { sh: false });
      break;
    }
    case 13: {   // corcel de fuego (prefab caballo + llamas)
      const arr = animal(id + 'h', 'horse', [p[0], p[1] - (o.sink || 0), p[2]], { yaw: o.yaw, roll: o.roll, n: n * 0.85, c: '#d94a1a', t, walk: w, flash: o.flash, o: o.o });
      const X = Bld(id + 'f', [p[0], p[1] - (o.sink || 0), p[2]], { yaw: o.yaw, roll: o.roll, n: n * 0.85, flash: o.flash, o: o.o });
      for (let i = 0; i < 5; i++) X.add('mf' + i, 'cone', [0, 1.7 - i * 0.08 + Math.sin(t * 10 + i) * 0.05, -0.55 + i * 0.2], [0.2, 0.5 + 0.1 * Math.sin(t * 9 + i), 0.2], i % 2 ? '#ffd54a' : '#ff7a2a', { e: 1, sh: false });
      for (const sx of [-1, 1]) X.add('hf' + sx, 'cone', [sx * 0.2, 0.12, -0.55], [0.16, 0.3, 0.16], '#ffb23d', { e: 1, o: 0.8, sh: false });
      return arr.concat(X.out);
    }
    default: {   // rinoceronte de roca
      legs(0.3, 0.45, 0.5, 0.5, 0.3, '#6a6e78', sw);
      add('body', 'ico', [0, 0.85 + bob, 0], [1.1, 0.95, 1.5], '#8a8f99', { m: { r: 0.95, m: 0 } });
      add('head', 'box', [0, 0.85 + bob, -0.95], [0.6, 0.55, 0.6], '#7a7f89'); add('horn', 'cone', [0, 1.15 + bob, -1.3], [0.18, 0.5, 0.18], '#e8e0c8', { r: [-0.6, 0, 0] });
      for (const sx of [-1, 1]) add('ear' + sx, 'cone', [sx * 0.25, 1.2 + bob, -0.8], [0.1, 0.2, 0.08], '#6a6e78', { sh: false });
      eyes(0.92 + bob, -1.22, 0.2, 0.07, '#ff9a3a');
      for (let i = 0; i < 5; i++) add('pl' + i, 'ico', [(i % 2 - 0.5) * 0.4, 1.35 + bob - (i % 2) * 0.05, -0.5 + i * 0.28], [0.4, 0.26, 0.4], '#a8794a', { sh: false });
    }
  }
  return B.out;
}

// ─── Piezas 2D ───
function MdBtn({ label, sub, color, onPress, disabled, testID }) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled} style={{ width: '48.5%', opacity: disabled ? 0.35 : 1 }}>
      <View style={{ paddingVertical: 9, borderRadius: 14, backgroundColor: alpha(color, 0.2), borderWidth: 2, borderColor: alpha(color, 0.9), alignItems: 'center' }}>
        <Text style={{ color: C.text, fontWeight: '900', fontSize: 13 }}>{label}</Text>{sub ? <Text style={{ color: C.dim, fontSize: 10 }}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}
const hpColor = (h, m) => (h > m * 0.5 ? C.lime : h > m * 0.2 ? C.amber : C.red);
function Card({ m, hp, extra, style, align }) {
  return (
    <View style={[{ backgroundColor: 'rgba(6,8,22,0.72)', borderRadius: 14, borderWidth: 1.5, borderColor: alpha(TC[m.type], 0.8), padding: 8, width: SCREEN_W * 0.5 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        <Text style={{ color: C.text, fontWeight: '900', fontSize: 13 }}>{m.e} {m.name}</Text><Text style={{ color: C.dim, fontSize: 11, marginLeft: 6 }}>Nv.{m.lv}</Text>
      </View>
      <Text style={{ color: TC[m.type], fontSize: 9, fontWeight: '900', letterSpacing: 1, textAlign: align === 'right' ? 'right' : 'left' }}>{TYPE_NAME[m.type]}{extra || ''}</Text>
      <Bar value={Math.max(0, hp)} max={m.maxHp} color={hpColor(hp, m.maxHp)} h={9} style={{ marginTop: 3 }} />
      <Text style={{ color: C.dim, fontSize: 10, marginTop: 2, textAlign: align === 'right' ? 'right' : 'left' }}>{Math.max(0, Math.round(hp))}/{m.maxHp}</Text>
    </View>
  );
}

// ─── Juego ───
const SAVE = '@md_save2';
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const BATTLE_P = [-1.8, 0, 1.6], BATTLE_F = [2.0, 0, -2.4];
const YAW_P = Math.atan2(-(BATTLE_F[0] - BATTLE_P[0]), -(BATTLE_F[2] - BATTLE_P[2])), YAW_F = YAW_P + PI;
// decorado de la arena (calculado una vez)
const ARENA = (() => {
  const st = [], r = seeded(11);
  st.push({ id: 'disc', k: 'cyl', p: [0, -0.3, 0], s: [26, 0.6, 26], c: '#5ab04e', recv: true });
  st.push({ id: 'disc2', k: 'cyl', p: [0, -0.24, 0], s: [14, 0.6, 14], c: '#6cc55c', recv: true });
  st.push({ id: 'ring', k: 'cyl', p: [0, -0.26, 0], s: [14.8, 0.56, 14.8], c: '#d9c98a', recv: true });
  for (const [x, z] of [BATTLE_P, BATTLE_F]) st.push({ id: 'pad' + x, k: 'cyl', p: [x, 0.04, z], s: [3.4, 0.2, 3.4], c: '#b4bac8', recv: true, sh: true });
  for (let i = 0; i < 22; i++) { const a = r() * PI * 2, d = 12 + r() * 14; st.push(...tree(`at${i}`, [Math.cos(a) * d, -0.2, Math.sin(a) * d], { kind: r() < 0.5 ? 'pine' : 'oak', inst: 'aArbol', h: 1.1 })); }
  for (let i = 0; i < 12; i++) { const a = r() * PI * 2, d = 8 + r() * 4; st.push(...rock(`ar${i}`, [Math.cos(a) * d, -0.1, Math.sin(a) * d], { inst: 'aRoca', kind: 'rock' })); }
  for (let i = 0; i < 40; i++) { const a = r() * PI * 2, d = 3 + r() * 9; st.push(...flower(`af${i}`, [Math.cos(a) * d, 0, Math.sin(a) * d], { inst: 'aFlor', c: pick(['#ff6fa8', '#ffd54a', '#ffffff', '#b57bff']) })); }
  return st;
})();
const LEADER_ARENA = ARENA;

const initState = () => ({ team: [], active: 0, balls: 6, potions: 3, wins: 0, badges: 0, caught: [], box: 0, battle: null, log: ['¡Bienvenido al mundo de los Monstruos!'], menu: 'main', busy: false, trainerIdx: 0, nextTrainerAt: 4, world: null, t: 0, toast: null, wasGrass: false });
const mkMon = (id, lv) => {
  const b = MONS[id]; const st = STATS(b, lv);
  const moves = [{ n: 'Placaje', t: 'normal', p: 40, acc: 100, pp: 25, max: 25 }, { n: TYPE_MOVES[b.type][0][0], t: b.type, p: TYPE_MOVES[b.type][0][1], acc: 100, pp: 18, max: 18 }];
  moves.push({ n: TYPE_MOVES[b.type][1][0], t: b.type, p: TYPE_MOVES[b.type][1][1], acc: 85, pp: 7, max: 7, minLv: 8 });
  const sm = STATUS[id % 3]; moves.push({ n: sm.n, t: 'normal', eff: sm.eff, pp: sm.pp, max: sm.pp, d: sm.d });
  return { id, name: b.name, e: b.e, type: b.type, lv, ...st, hp: st.maxHp, xp: 0, xpNext: lv * 22, moves, evo: b.evo, evoLvl: b.evoLvl, st: { atk: 0, def: 0 } };
};
const newWorld = () => {
  const map = genWorld(); const h = mkHeight(map);
  const w = { map, h, statics: null, terrain: null, x: 0, z: 0, face: 0, yaw: 0, walk: 0, grassD: 0, wild: [], leader: null, follow: { x: 0, z: 2, face: 0 }, hopT: 0 };
  w.statics = worldStatics(map, h);
  w.terrain = { id: 'md' + Math.floor(Math.random() * 1e9), h, size: 64, step: 1, color: (y, x, z) => {
    const tt = tileOf(map, x, z), wm = waterMask(map, x, z), v = 0.93 + hash01(x.toFixed(1) + ',' + z.toFixed(1)) * 0.14;
    const c = wm > 0.12 ? (wm > 0.7 ? '#b9ab7c' : '#ecdc9c') : tt === MDT.TALL ? '#3f9a45' : tt === MDT.TREE ? '#4f9e46' : tt === MDT.ROCK ? '#7ea96a' : '#6cc25a';
    return shade(c, v);
  } };
  w.x = tw(MD_W / 2); w.z = tw(MD_H / 2);
  for (let i = 0; i < 8; i++) { const c = spawnWild(w); if (c) w.wild.push(c); }
  return w;
};
function spawnWild(w) {
  for (let k = 0; k < 200; k++) {
    const x = (Math.random() - 0.5) * (MD_W - 6) * TS, z = (Math.random() - 0.5) * (MD_H - 6) * TS;
    if (walkable(w.map, x, z, 0.5) && Math.hypot(x - w.x, z - w.z) > 10) return { uid: uid(), sp: randInt(0, MONS.length - 1), x, z, t: rand(0.5, 2), vx: 0, vz: 0, yaw: Math.random() * 6 };
  }
  return null;
}

export function MonsterDuel3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('monster');
  const [teamOpen, setTeamOpen] = useState(false);
  const [scene, setScene] = useState('ready');          // ready | starter | explore | battle | over
  const [res, setRes] = useState({ won: false, isNew: false });
  const move = useRef({ x: 0, y: 0, on: false }).current, look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) { g.current = initState(); g.current.world = newWorld(); }
  if (globalThis.__TEST) globalThis.__game = g;
  const addLog = m => { g.current.log = [m, ...g.current.log].slice(0, 4); };
  const scoreOf = s => s.wins * 10 + s.badges * 100 + s.caught.length * 20;
  const stage = n => Math.max(0.4, 1 + 0.25 * n);
  const effOf = (mt, dt) => (MULT[mt] && MULT[mt][dt] != null ? MULT[mt][dt] : 1);
  const calc = (a, d, mv) => {
    const eff = effOf(mv.t, d.type), stab = mv.t === a.type ? 1.3 : 1, crit = Math.random() < 0.08;
    const raw = (a.atk * stage(a.st.atk)) / (d.def * stage(d.st.def)) * mv.p * 0.24 * eff * stab * (crit ? 1.6 : 1) * rand(0.88, 1);
    return { dmg: Math.max(1, Math.floor(raw) + 1), eff, crit };
  };
  const active = () => g.current.team[g.current.active];
  const foe = () => g.current.battle.foes[g.current.battle.fi];
  // temporizador de combate (tiempo de juego): sched(retraso, fn)
  const sched = (d, fn) => { const b = g.current.battle; if (b) b.q.push({ at: b.clock + d, fn }); else setTimeout(fn, d * 1000); };
  const bpos = (b, who, h = 1.2) => (who === 'p' ? [BATTLE_P[0], h, BATTLE_P[2]] : [BATTLE_F[0], h, BATTLE_F[2]]);
  const scr = (b, pt) => { const q = b.cam && project(b.cam, pt, SCREEN_W, SCREEN_H); return q ? [q.x, q.y] : [SCREEN_W / 2, SCREEN_H * 0.3]; };
  const dmgPop = (b, who, txt, color, size) => { const q = scr(b, bpos(b, who, 2.3)); fx.pop(q[0], q[1], txt, color, size || 26); };

  const start = () => { fx.clear(); clear3d(); g.current = initState(); g.current.world = newWorld(); setScene('starter'); hx.tap(); };
  const pickStarter = id => {
    const s = initState(); s.world = g.current.world; s.team = [mkMon(id, 5)]; s.caught = [id]; g.current = s; fx.clear(); clear3d(); setScene('explore'); hx.good();
    addLog(`¡${s.team[0].name} será tu compañero!`); AsyncStorage.removeItem(SAVE).catch(() => {});
  };
  const save = () => { const s = g.current; AsyncStorage.setItem(SAVE, JSON.stringify({ team: s.team, balls: s.balls, potions: s.potions, wins: s.wins, badges: s.badges, caught: s.caught, box: s.box, trainerIdx: s.trainerIdx, nextTrainerAt: s.nextTrainerAt })).catch(() => {}); };
  useEffect(() => { AsyncStorage.getItem(SAVE).then(v => { if (v) { try { g.current.save = JSON.parse(v); } catch (e) {} } }).catch(() => {}); }, []);
  const load = () => { const d = g.current.save; if (!d) return; const s = initState(); Object.assign(s, d); s.log = ['Partida cargada.']; s.world = newWorld(); g.current = s; setScene('explore'); hx.good(); };

  const beginBattle = (trainer, wildId) => {
    const s = g.current; const lead = Math.max(...s.team.map(m => m.lv));
    let foes;
    if (trainer) { const n = 2 + Math.min(1, s.badges); foes = Array.from({ length: n }, () => mkMon(randInt(0, MONS.length - 1), lead + randInt(0, 2) + s.badges)); }
    else foes = [mkMon(wildId != null ? wildId : randInt(0, MONS.length - 1), Math.max(3, lead + randInt(-2, 2)))];
    const p = s.team[s.active];
    s.battle = { foes, fi: 0, trainer, name: trainer ? TRAINERS[s.trainerIdx % TRAINERS.length] : null, t: 0, clock: 0, q: [], pa: null, fa: { k: 'in', t: 0 }, proj: null, cap: null, dispP: p.hp, dispF: foes[0].hp, evo: 0, cam: null, flashP: 0, flashF: 0, foeGone: false };
    s.team.forEach(m => { m.st = { atk: 0, def: 0 }; });
    s.menu = 'main'; s.busy = false;
    addLog(trainer ? `¡${s.battle.name} te desafía!` : `¡Un ${foes[0].name} salvaje apareció!`);
    fx.flash('#fff', 0.5); hx.warn(); setTeamOpen(false); if (trainer) s.world.leader = null; clear3d(); setScene('battle');
  };
  const checkEvo = m => {
    if (m.evo !== -1 && m.evo != null && m.lv >= m.evoLvl) {
      const old = m.name, nb = MONS[m.evo], st = STATS(nb, m.lv);
      Object.assign(m, { id: nb.id, name: nb.name, e: nb.e, type: nb.type, ...st, hp: st.maxHp, evo: nb.evo, evoLvl: nb.evoLvl });
      m.moves[1] = { ...m.moves[1], n: TYPE_MOVES[nb.type][0][0], t: nb.type }; m.moves[2] = { ...m.moves[2], n: TYPE_MOVES[nb.type][1][0], t: nb.type };
      addLog(`✨ ¡${old} evolucionó a ${nb.name}!`); fx.flash('#fff', 0.6); hx.win();
      const b = g.current.battle; if (b) { b.evo = 1.6; burst3d(bpos(b, 'p', 1.2), ['#fff', '#ffe9a0', TC[nb.type]], 60, { speed: 7, up: 3, size: 0.2, life: 1.2 }); ring3d(bpos(b, 'p', 0.4), '#fff', 30, { speed: 7, life: 0.8 }); }
    }
  };
  const gainXp = (m, amount) => {
    m.xp += amount; let up = false;
    while (m.xp >= m.xpNext) { m.xp -= m.xpNext; m.lv += 1; m.xpNext = m.lv * 22; const st = STATS(MONS[m.id], m.lv); const gain = st.maxHp - m.maxHp; Object.assign(m, st); m.hp = Math.min(m.maxHp, m.hp + Math.max(6, gain)); up = true; addLog(`¡${m.name} subió al nivel ${m.lv}! ⬆️`); checkEvo(m); }
    if (up) { hx.good(); fx.pop(SCREEN_W / 2, SCREEN_H * 0.28, `¡NIVEL ${m.lv}!`, C.amber, 30); const b = g.current.battle; if (b) ring3d(bpos(b, 'p', 0.3), '#ffd54a', 26, { speed: 5, life: 0.7 }); }
  };
  const endWin = () => {
    const s = g.current, b = s.battle, tr = b.trainer;
    s.wins += 1; s.team.forEach(m => { if (m.hp > 0) m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * 0.12)); });
    if (Math.random() < 0.5) { s.balls += 1; addLog('Encontraste una Monstruobola 🔴.'); }
    if (tr) { s.badges += 1; s.trainerIdx += 1; s.nextTrainerAt = s.wins + 4; s.balls += 3; s.potions += 2; s.team.forEach(m => { m.hp = m.maxHp; }); addLog(`🏅 ¡Medalla ${s.badges}! Equipo curado y +3 🔴 +2 🧪`); fx.flash(C.amber, 0.4); hx.win(); }
    const sc = scoreOf(s); const isNew = submitBest(sc); save(); s.battle = null;
    if (s.badges >= 5) { setRes({ won: true, isNew }); setScene('over'); return; }
    setScene('explore');
  };
  const faintCheck = () => {
    const s = g.current, m = active(), b = s.battle;
    if (m.hp > 0) return false;
    addLog(`¡${m.name} se debilitó!`); hx.bad(); b.pa = { k: 'faint', t: 0 };
    const alive = s.team.findIndex(x => x.hp > 0);
    if (alive < 0) { sched(1.3, () => { const isNew = submitBest(scoreOf(s)); hx.die(); s.battle = null; setRes({ won: false, isNew }); setScene('over'); }); return true; }
    s.menu = 'forced'; s.busy = false; return true;
  };
  // proyectil visual desde `from` hacia `to` ('p' | 'f'), de color col; llama a onHit al llegar
  const fire = (from, col, onHit, dur = 0.5) => {
    const b = g.current.battle; b.proj = { from, col, t: 0, dur, big: false };
    sched(dur, () => { b.proj = null; onHit(); });
  };
  const impact = (b, who, col, big) => {
    const c = bpos(b, who, 1.1);
    burst3d(c, [col, '#ffffff'], big ? 46 : 26, { speed: big ? 8 : 6, up: 2, size: big ? 0.24 : 0.18, life: 0.8 }); ring3d([c[0], 0.3, c[2]], col, big ? 26 : 16, { speed: big ? 8 : 5, life: 0.6 });
  };
  const foeAct = () => {
    const s = g.current, b = s.battle; if (!b) return; const f = foe(), p = active();
    const usable = f.moves.filter(m => m.pp > 0 && !(m.minLv && f.lv < m.minLv));
    let mv = usable.length ? pick(usable) : { n: 'Forcejeo', t: 'normal', p: 30, acc: 100, pp: 1 };
    const strong = usable.filter(m => m.p && effOf(m.t, p.type) > 1); if (strong.length && Math.random() < 0.6) mv = pick(strong);
    mv.pp -= 1; b.fa = { k: 'atk', t: 0 };
    const done = () => { if (!faintCheck()) { s.busy = false; s.menu = 'main'; } };
    if (mv.eff) {
      sched(0.4, () => {
        if (mv.eff === 'atkdown') { p.st.atk = Math.max(-3, p.st.atk - 1); addLog(`${f.name} usa ${mv.n}. ¡Tu ataque baja!`); ring3d(bpos(b, 'p', 0.3), '#ff4d6d', 20, { speed: 3, life: 0.6 }); }
        if (mv.eff === 'defup') { f.st.def = Math.min(3, f.st.def + 1); addLog(`${f.name} usa ${mv.n}. ¡Su defensa sube!`); ring3d(bpos(b, 'f', 0.3), '#4d8bff', 20, { speed: 3, life: 0.6 }); }
        if (mv.eff === 'heal') { const h = Math.ceil(f.maxHp * 0.4); f.hp = Math.min(f.maxHp, f.hp + h); addLog(`${f.name} usa ${mv.n} y se cura.`); ring3d(bpos(b, 'f', 0.3), '#7dff6b', 20, { speed: 3, life: 0.6 }); burst3d(bpos(b, 'f', 0.4), '#7dff6b', 14, { speed: 1.5, up: 3, g: -1, size: 0.14 }); }
        hx.tick();
      });
      sched(1.2, done); return;
    }
    if (Math.random() * 100 > mv.acc) { sched(0.5, () => { addLog(`${f.name} usa ${mv.n}… ¡pero falla!`); hx.tick(); }); sched(1.2, done); return; }
    const r = calc(f, p, mv);
    sched(0.35, () => fire('f', TC[mv.t], () => {
      p.hp = Math.max(0, p.hp - r.dmg); b.flashP = 0.3; impact(b, 'p', TC[mv.t], r.eff > 1);
      dmgPop(b, 'p', `-${r.dmg}`, C.red, 26); fx.shake(r.eff > 1 ? 10 : 6, 0.3); fx.flash(C.red, 0.12); hx.heavy();
      addLog(`${f.name} usa ${mv.n}: -${r.dmg}${r.eff > 1 ? ' ¡Muy eficaz!' : r.eff < 1 ? ' No muy eficaz.' : ''}${r.crit ? ' ¡Crítico!' : ''}`);
      sched(0.8, done);
    }));
  };
  const afterPlayer = () => {
    const s = g.current, b = s.battle, f = foe();
    if (f.hp <= 0) {
      const xp = Math.floor(f.lv * 18 * (b.trainer ? 1.5 : 1)); addLog(`¡${f.name} fue derrotado! +${xp} XP`);
      b.fa = { k: 'faint', t: 0 }; hx.win(); burst3d(bpos(b, 'f', 1), [TC[f.type], '#fff', '#ffd54a'], 50, { speed: 7, up: 4, size: 0.2, life: 1 });
      gainXp(active(), xp); s.team.forEach((m, i) => { if (i !== s.active && m.hp > 0) gainXp(m, Math.floor(xp * 0.3)); });
      if (b.fi + 1 < b.foes.length) { sched(1.2, () => { b.fi += 1; b.fa = { k: 'in', t: 0 }; b.dispF = foe().hp; addLog(`${b.name} saca a ${foe().name}.`); s.busy = false; s.menu = 'main'; }); return; }
      sched(1.6, endWin); return;
    }
    sched(0.5, foeAct);
  };
  const useMove = i => {
    const s = g.current, b = s.battle; if (!b || s.busy) return;
    const p = active(), f = foe(), mv = p.moves[i];
    if (mv.pp <= 0 || (mv.minLv && p.lv < mv.minLv)) { hx.tick(); return; }
    s.busy = true; mv.pp -= 1; s.menu = 'main'; b.pa = { k: 'atk', t: 0 };
    if (mv.eff) {
      sched(0.4, () => {
        if (mv.eff === 'atkdown') { f.st.atk = Math.max(-3, f.st.atk - 1); addLog(`${p.name} usa ${mv.n}. ¡El ataque rival baja!`); ring3d(bpos(b, 'f', 0.3), '#ff4d6d', 20, { speed: 3, life: 0.6 }); }
        if (mv.eff === 'defup') { p.st.def = Math.min(3, p.st.def + 1); addLog(`${p.name} usa ${mv.n}. ¡Tu defensa sube!`); ring3d(bpos(b, 'p', 0.3), '#4d8bff', 20, { speed: 3, life: 0.6 }); }
        if (mv.eff === 'heal') { const h = Math.ceil(p.maxHp * 0.4); p.hp = Math.min(p.maxHp, p.hp + h); dmgPop(b, 'p', `+${h}`, C.lime, 24); addLog(`${p.name} usa ${mv.n} y recupera ${h} PS.`); ring3d(bpos(b, 'p', 0.3), '#7dff6b', 24, { speed: 3, life: 0.7 }); burst3d(bpos(b, 'p', 0.4), '#7dff6b', 16, { speed: 1.5, up: 3, g: -1, size: 0.14 }); }
        hx.good();
      });
      sched(1.2, afterPlayer); return;
    }
    if (Math.random() * 100 > mv.acc) { sched(0.5, () => { addLog(`${p.name} usa ${mv.n}… ¡pero falla!`); hx.tick(); }); sched(1.1, afterPlayer); return; }
    const r = calc(p, f, mv);
    sched(0.35, () => fire('p', TC[mv.t], () => {
      f.hp = Math.max(0, f.hp - r.dmg); b.flashF = 0.3; impact(b, 'f', TC[mv.t], r.eff > 1);
      dmgPop(b, 'f', `-${r.dmg}`, r.eff > 1 ? C.amber : C.text, r.eff > 1 ? 32 : 26); fx.shake(r.eff > 1 ? 8 : 4, 0.25); hx.hit();
      addLog(`${p.name} usa ${mv.n}: -${r.dmg}${r.eff > 1 ? ' ¡Muy eficaz!' : r.eff < 1 ? ' No muy eficaz.' : ''}${r.crit ? ' ¡Crítico!' : ''}`);
      sched(0.9, afterPlayer);
    }));
  };
  const swapTo = (i, forced) => {
    const s = g.current, b = s.battle; if (s.team[i].hp <= 0 || (i === s.active && !forced)) return;
    s.active = i; s.team[i].st = { atk: 0, def: 0 }; addLog(`¡Adelante, ${s.team[i].name}!`); hx.tap();
    if (b) { b.dispP = s.team[i].hp; b.pa = { k: 'in', t: 0 }; ring3d(bpos(b, 'p', 0.3), '#ffffff', 20, { speed: 4, life: 0.5 }); burst3d(bpos(b, 'p', 1), '#ffffff', 20, { speed: 3, size: 0.16 }); s.menu = 'main'; if (forced) s.busy = false; else { s.busy = true; sched(0.9, foeAct); } }
  };
  const usePotion = () => {
    const s = g.current, p = active(), b = s.battle;
    if (s.potions <= 0 || p.hp >= p.maxHp || (b && s.busy)) { hx.tick(); return; }
    s.potions -= 1; const h = Math.ceil(p.maxHp * 0.45); p.hp = Math.min(p.maxHp, p.hp + h); hx.good(); addLog(`🧪 ${p.name} recupera ${h} PS.`);
    if (b) { dmgPop(b, 'p', `+${h}`, C.lime, 24); ring3d(bpos(b, 'p', 0.3), '#7dff6b', 22, { speed: 3, life: 0.7 }); burst3d(bpos(b, 'p', 0.4), '#7dff6b', 16, { speed: 1.5, up: 3, g: -1, size: 0.14 }); s.busy = true; s.menu = 'main'; sched(0.9, foeAct); }
    else { const w = s.world; ring3d([w.x, w.h(w.x, w.z) + 0.2, w.z], '#7dff6b', 18, { speed: 3, life: 0.7 }); }
  };
  const tryCatch = () => {
    const s = g.current, b = s.battle; if (!b || s.busy) return;
    if (b.trainer) { addLog('¡No puedes capturar monstruos de entrenadores!'); hx.bad(); return; }
    if (s.balls <= 0) { addLog('No te quedan Monstruobolas.'); hx.bad(); return; }
    s.balls -= 1; s.busy = true; const f = foe(); addLog('🔴 ¡Lanzas una Monstruobola!'); hx.heavy();
    const rate = clamp((1 - f.hp / f.maxHp) * 0.7 + 0.15 - (f.lv - active().lv) * 0.02, 0.08, 0.95), ok = Math.random() < rate;
    b.cap = { t0: b.clock, ok, col: TC[f.type] };
    sched(0.65, () => { hx.tick(); burst3d(bpos(b, 'f', 1), ['#ff4d4d', '#fff'], 24, { speed: 4, up: 2, size: 0.16 }); });
    for (const d of [1.1, 1.8, 2.5]) sched(d, () => { hx.tick(); addLog('…'); });
    sched(3.3, () => {
      if (ok) {
        addLog(`¡${f.name} capturado! 🎉`); const c = bpos(b, 'f', 0.5); burst3d(c, ['#ffd54a', '#fff', '#ff4d6d'], 60, { speed: 7, up: 4, size: 0.2, life: 1.2 }); ring3d([c[0], 0.3, c[2]], '#ffd54a', 26, { speed: 6, life: 0.8 }); hx.win();
        if (!s.caught.includes(f.id)) s.caught.push(f.id);
        if (s.team.length < 4) { f.hp = Math.max(1, Math.floor(f.maxHp * 0.5)); f.st = { atk: 0, def: 0 }; s.team.push(f); } else { s.box += 1; addLog('Tu equipo está lleno: va a la caja.'); }
        s.wins += 1; submitBest(scoreOf(s)); save(); sched(1.6, () => { s.battle = null; setScene('explore'); });
      } else { addLog(`¡${f.name} se liberó!`); hx.bad(); b.cap = null; b.fa = { k: 'in', t: 0 }; burst3d(bpos(b, 'f', 1), ['#fff', '#ff4d4d'], 24, { speed: 5, size: 0.16 }); sched(0.9, foeAct); }
    });
  };
  const run = () => {
    const s = g.current, b = s.battle; if (!b || s.busy) return;
    if (b.trainer) { addLog('¡No puedes huir de un combate de entrenador!'); hx.bad(); return; }
    addLog('¡Escapaste sin problemas!'); s.battle = null; hx.tick(); setScene('explore');
  };
  const rest = () => {
    const s = g.current; s.team.forEach(m => { m.hp = m.maxHp; m.moves.forEach(mv => { mv.pp = mv.max; }); }); addLog('🛏️ Tu equipo descansa y se recupera por completo.'); hx.good(); fx.flash(C.lime, 0.2);
    const w = s.world; ring3d([w.x, w.h(w.x, w.z) + 0.2, w.z], '#7dff6b', 24, { speed: 4, life: 0.8 }); burst3d([w.x, w.h(w.x, w.z) + 1, w.z], ['#7dff6b', '#fff'], 20, { speed: 2, up: 3, g: -1, size: 0.14 });
    if (Math.random() < 0.4) { addLog('¡Pero un monstruo salvaje te sorprendió!'); setTimeout(() => beginBattle(false), 700); }
    save();
  };

  // ─── bucle ───
  useLoop(scene === 'explore' || scene === 'starter' || scene === 'battle', dt => {
    const s = g.current; s.t += dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (scene === 'battle' && s.battle) {
      const b = s.battle; b.clock += dt; b.t += dt;
      for (let i = b.q.length - 1; i >= 0; i--) { if (b.clock >= b.q[i].at) { const f = b.q[i].fn; b.q.splice(i, 1); f(); } }
      if (!s.battle) return;
      if (b.pa) { b.pa.t += dt; if (b.pa.k !== 'faint' && b.pa.t > 1) b.pa = null; }
      if (b.fa) { b.fa.t += dt; if (b.fa.k !== 'faint' && b.fa.t > 1) b.fa = null; }
      b.flashP = Math.max(0, b.flashP - dt); b.flashF = Math.max(0, b.flashF - dt); b.evo = Math.max(0, b.evo - dt);
      const p = active(), f = foe(); b.dispP += (p.hp - b.dispP) * Math.min(1, dt * 5); b.dispF += (f.hp - b.dispF) * Math.min(1, dt * 5);
      if (b.proj) { b.proj.t += dt; const u = Math.min(1, b.proj.t / b.proj.dur), a = bpos(b, b.proj.from, 1.1), z = bpos(b, b.proj.from === 'p' ? 'f' : 'p', 1.1); const x = a[0] + (z[0] - a[0]) * u, y = a[1] + (z[1] - a[1]) * u + Math.sin(u * PI) * 0.6, zz = a[2] + (z[2] - a[2]) * u; burst3d([x, y, zz], b.proj.col, 2, { speed: 0.8, size: 0.3, life: 0.4, g: 0 }); }
      return;
    }
    const w = s.world; if (scene === 'starter') return;
    // exploración
    w.yaw -= look.x * 2.4 * dt;
    const len = move.on ? Math.min(1, Math.hypot(move.x, move.y)) : 0;
    const fw = forward(w.yaw), rt = right(w.yaw);
    let moved = 0;
    if (len > 0.08) {
      const ux = move.x / Math.hypot(move.x, move.y), uy = -move.y / Math.hypot(move.x, move.y), sp = 6.2 * len * dt;
      const dx = (fw[0] * uy + rt[0] * ux) * sp, dz = (fw[1] * uy + rt[1] * ux) * sp;
      if (walkable(w.map, w.x + dx, w.z)) { w.x += dx; moved += Math.abs(dx); } if (walkable(w.map, w.x, w.z + dz)) { w.z += dz; moved += Math.abs(dz); }
      let dh = Math.atan2(-dx, -dz) - w.face; dh = ((dh + PI * 3) % (PI * 2)) - PI; w.face += dh * Math.min(1, dt * 12);
    }
    w.walk += ((moved / Math.max(dt, 1e-3) > 1 ? 1 : 0) - w.walk) * Math.min(1, dt * 10);
    const inTall = tileOf(w.map, w.x, w.z) === MDT.TALL;
    if (moved > 0 && inTall) { w.grassD += moved; if (Math.random() < dt * 8) burst3d([w.x, w.h(w.x, w.z) + 0.3, w.z], ['#7fd66a', '#3d9a3f'], 1, { speed: 1.5, up: 1.5, g: 5, size: 0.14, life: 0.5 }); if (w.grassD > 3.6) { w.grassD = 0; if (Math.random() < 0.5) { beginBattle(false); return; } } }
    // acompañante: sigue al entrenador con retraso
    const fo = w.follow, tx = w.x + Math.sin(w.face) * 2.1, tz = w.z + Math.cos(w.face) * 2.1;
    fo.x += (tx - fo.x) * Math.min(1, dt * 3); fo.z += (tz - fo.z) * Math.min(1, dt * 3); const fm = Math.hypot(tx - fo.x, tz - fo.z); fo.face = Math.atan2(-(w.x - fo.x), -(w.z - fo.z)); fo.walk = fm > 0.4 ? 1 : 0;
    for (const c of w.wild) {
      c.t -= dt; if (c.t <= 0) { c.t = rand(0.8, 2.2); const a = Math.random() * PI * 2; c.vx = Math.cos(a) * 1.0; c.vz = Math.sin(a) * 1.0; if (Math.random() < 0.3) { c.vx = 0; c.vz = 0; } }
      const nx = c.x + c.vx * dt, nz = c.z + c.vz * dt;
      if (walkable(w.map, nx, nz, 0.6)) { c.x = nx; c.z = nz; if (c.vx || c.vz) c.yaw = Math.atan2(-c.vx, -c.vz); } else c.t = 0;
      if (Math.hypot(c.x - w.x, c.z - w.z) < 1.5) { w.wild = w.wild.filter(o => o !== c); const n = spawnWild(w); if (n) w.wild.push(n); burst3d([c.x, w.h(c.x, c.z) + 1, c.z], TC[MONS[c.sp].type], 20, { speed: 5, size: 0.18 }); beginBattle(false, c.sp); return; }
    }
    if (w.leader) { if (Math.hypot(w.leader.x - w.x, w.leader.z - w.z) < 2.6) { beginBattle(true); return; } }
    else if (s.wins >= s.nextTrainerAt) {
      for (let k = 0; k < 300; k++) { const x = (Math.random() - 0.5) * (MD_W - 6) * TS, z = (Math.random() - 0.5) * (MD_H - 6) * TS; if (walkable(w.map, x, z, 0.8) && Math.hypot(x - w.x, z - w.z) > 18) { w.leader = { x, z }; s.toast = { m: `🏅 ¡${TRAINERS[s.trainerIdx % TRAINERS.length]} te espera! Sigue el faro dorado.`, t: 4 }; hx.warn(); break; } }
    }
  });

  const s = g.current, b = s.battle, p = s.team[s.active], f = b ? foe() : null;
  const w = s.world;
  const T = scene === 'battle' ? s.t : s.t;
  // ─── escena: mundo ───
  const worldScene = (t, camIn) => {
    const objs = [], gy = (x, z) => w.h(x, z);
    const py = Math.max(gy(w.x, w.z), -0.2);
    const hop = Math.abs(Math.sin(t * 9)) * 0;
    objs.push(...person('yo', [w.x, py + hop, w.z], { yaw: w.face, t, walk: w.walk, hat: 'cap', band: '#e0453a', shirt: '#2f6fd8', pants: '#3b3f58' }));
    if (p) { const fo = w.follow; objs.push(...creature('fol', p.id, [fo.x, Math.max(gy(fo.x, fo.z), -0.2), fo.z], { yaw: fo.face, t, walk: fo.walk, n: 0.8 })); }
    w.wild.forEach(c => {
      if (Math.hypot(c.x - w.x, c.z - w.z) > 24) return; const y = Math.max(gy(c.x, c.z), -0.2), col = TC[MONS[c.sp].type];
      objs.push(...creature(`c${c.uid}`, c.sp, [c.x, y, c.z], { yaw: c.yaw, t: t + c.uid, walk: c.vx || c.vz ? 1 : 0, n: 0.85 }));
      objs.push({ id: `cr${c.uid}`, k: 'ring', p: [c.x, y + 0.06, c.z], s: [2.2, 2.2, 1], c: col, e: 1, o: 0.55 });
    });
    if (w.leader) {
      const L = w.leader, y = Math.max(gy(L.x, L.z), 0);
      objs.push(...person('lider', [L.x, y, L.z], { yaw: Math.atan2(-(w.x - L.x), -(w.z - L.z)), t, hat: 'crown', shirt: '#ffc233', pants: '#6a3a9a', arms: 1.0 }));
      objs.push({ id: 'faro', k: 'cyl', p: [L.x, y + 10, L.z], s: [0.9, 20, 0.9], c: '#ffd54a', e: 1, o: 0.25 + 0.06 * Math.sin(t * 3) }, { id: 'faroR', k: 'ring', p: [L.x, y + 0.08, L.z], s: [3.6, 3.6, 1], c: '#ffd54a', e: 1, o: 0.6 });
      if (Math.random() < 0.3) burst3d([L.x + (Math.random() - 0.5) * 2, y + 1, L.z + (Math.random() - 0.5) * 2], '#ffe9a0', 1, { speed: 0.5, up: 2, g: -0.5, size: 0.14, life: 1.5 });
    }
    return {
      sky: { top: '#2f86e6', bottom: '#bfe6ff', clouds: 10 }, fog: { c: '#bfe6ff', near: 36, far: 100 }, light: { dir: [-0.5, 0.75, 0.45] }, shadowR: 22,
      terrain: w.terrain, water: { y: -0.3, c: '#2aa0e0', o: 0.82, amp: 0.12 }, statics: w.statics, objs, cam: camIn,
    };
  };
  // ─── escena: combate ───
  const battleScene = (t) => {
    const objs = [];
    const mkAnim = (a, who) => {
      const dir = who === 'p' ? [BATTLE_F[0] - BATTLE_P[0], BATTLE_F[2] - BATTLE_P[2]] : [BATTLE_P[0] - BATTLE_F[0], BATTLE_P[2] - BATTLE_F[2]], L = Math.hypot(dir[0], dir[1]);
      const base = who === 'p' ? BATTLE_P : BATTLE_F; let px = base[0], pz = base[2], sink = 0, roll = 0, sc = 1, op = 1;
      if (a) {
        if (a.k === 'atk') { const u = Math.sin(clamp(a.t / 0.6, 0, 1) * PI); px += dir[0] / L * u * 1.6; pz += dir[1] / L * u * 1.6; }
        if (a.k === 'in') { sc = 0.2 + 0.8 * smooth(a.t / 0.5); }
        if (a.k === 'faint') { const u = smooth(a.t / 0.9); roll = u * 1.4; sink = u * 0.5; op = 1 - u * 0.75; }
      }
      return { x: px, z: pz, sink, roll, sc, op };
    };
    if (p) {
      const A = mkAnim(b.pa, 'p'), ev = b.evo > 0;
      objs.push(...creature('bp', p.id, [A.x, 0.18, A.z], { yaw: YAW_P, t, walk: b.pa && b.pa.k === 'atk' ? 0.6 : 0, n: 1.3 * A.sc * (ev ? 1 + 0.15 * Math.sin(t * 30) : 1), flash: b.flashP > 0 || ev && Math.sin(t * 20) > 0, sink: A.sink, roll: A.roll, o: A.op }));
    }
    const cap = b.cap; let foeVis = true, foeSc = 1;
    if (f) {
      const A = mkAnim(b.fa, 'f');
      if (cap) { const u = b.clock - cap.t0; foeVis = u < 0.6 || (u > 3.3 && !cap.ok && false); foeSc = u < 0.4 ? 1 : Math.max(0.02, 1 - (u - 0.4) / 0.2); }
      if (foeVis) objs.push(...creature('bf', f.id, [A.x, 0.18, A.z], { yaw: YAW_F, t: t + 3, walk: b.fa && b.fa.k === 'atk' ? 0.6 : 0, n: 1.3 * A.sc * foeSc, flash: b.flashF > 0 || foeSc < 1, sink: A.sink, roll: A.roll, o: A.op }));
    }
    if (b.trainer) objs.push(...person('trn', [BATTLE_F[0] + 3.6, 0, BATTLE_F[2] - 3.4], { yaw: YAW_F, t, hat: 'crown', shirt: '#ffc233', pants: '#6a3a9a', n: 1.3, arms: b.fa && b.fa.k === 'atk' ? 2.2 : 1.0 }));
    else objs.push({ id: 'fring', k: 'ring', p: [BATTLE_F[0], 0.16, BATTLE_F[2]], s: [3, 3, 1], c: f ? TC[f.type] : '#fff', e: 1, o: 0.5 });
    if (p) objs.push({ id: 'pring', k: 'ring', p: [BATTLE_P[0], 0.16, BATTLE_P[2]], s: [3, 3, 1], c: TC[p.type], e: 1, o: 0.5 });
    if (b.proj) { const u = Math.min(1, b.proj.t / b.proj.dur), a = bpos(b, b.proj.from, 1.1), z = bpos(b, b.proj.from === 'p' ? 'f' : 'p', 1.1); const pp = [a[0] + (z[0] - a[0]) * u, a[1] + (z[1] - a[1]) * u + Math.sin(u * PI) * 0.6, a[2] + (z[2] - a[2]) * u]; objs.push({ id: 'proj', k: 'sph', p: pp, n: 0.6, c: b.proj.col, e: 1 }, { id: 'proj2', k: 'sph', p: pp, n: 1.1, c: b.proj.col, e: 1, o: 0.3 }); }
    if (cap) {
      const u = b.clock - cap.t0, from = bpos(b, 'p', 1.4), to = bpos(b, 'f', 1.0), gnd = [to[0], 0.4, to[2]]; let bp, rz = 0, vis = true, gl = 0;
      if (u < 0.6) { const k = u / 0.6; bp = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k + Math.sin(k * PI) * 1.6, from[2] + (to[2] - from[2]) * k]; }
      else if (u < 1.0) { const k = (u - 0.6) / 0.4; bp = [to[0], to[1] + (0.4 - to[1]) * k * k + Math.abs(Math.sin(k * PI * 1.5)) * 0.25 * (1 - k), to[2]]; }
      else { bp = gnd; for (const d of [1.1, 1.8, 2.5]) if (u > d && u < d + 0.5) rz = Math.sin((u - d) / 0.5 * PI * 2) * 0.5; if (u > 3.3) { if (cap.ok) gl = 1; else vis = false; } }
      if (vis) {
        objs.push({ id: 'ballT', k: 'sph', p: [bp[0], bp[1] + 0.1, bp[2]], s: [0.62, 0.34, 0.62], c: '#e8473a', r: [0, 0, rz], e: gl * 0.5 }, { id: 'ballB', k: 'sph', p: [bp[0], bp[1] - 0.1, bp[2]], s: [0.62, 0.34, 0.62], c: '#f4f4f8', r: [0, 0, rz] }, { id: 'ballD', k: 'sph', p: [bp[0], bp[1], bp[2] - 0.31], n: 0.16, c: '#fff', e: 0.7 + gl * 0.3 });
        if (gl) objs.push({ id: 'ballG', k: 'sph', p: bp, n: 1.4, c: '#ffd54a', e: 1, o: 0.25 });
      }
    }
    const el = b.clock, k0 = smooth(el / 1.6);
    const camP = { p: [-7.9 + (1 - k0) * 10, 4.1 + (1 - k0) * 1.4, 6.6 - (1 - k0) * 8], l: [1.3, 0.6, -1.6], fov: 58 };
    const lgt = b.trainer ? { dir: [-0.4, 0.5, 0.6], sun: '#ffd9a0', i: 2.0, hi: 1.5 } : { dir: [-0.5, 0.75, 0.45] };
    return { sky: b.trainer ? { top: '#3a1f7a', bottom: '#e88a6a', clouds: 6 } : { top: '#2f86e6', bottom: '#bfe6ff', clouds: 8 }, fog: { c: b.trainer ? '#e88a6a' : '#bfe6ff', near: 30, far: 80 }, light: lgt, shadowR: 16, statics: ARENA, objs, cam: camP };
  };
  // ─── escena: elegir inicial ───
  const starterScene = t => {
    const objs = [{ id: 'sdisc', k: 'cyl', p: [0, -0.2, 0], s: [14, 0.4, 14], c: '#5ab04e', recv: true }];
    [0, 2, 4].forEach((id, i) => { const x = (i - 1) * 2.3; objs.push({ id: 'ped' + i, k: 'cyl', p: [x, 0.1, 0], s: [2.0, 0.3, 2.0], c: '#b4bac8', sh: true, recv: true }, { id: 'pedr' + i, k: 'ring', p: [x, 0.27, 0], s: [2.4, 2.4, 1], c: TC[MONS[id].type], e: 1, o: 0.8 }); objs.push(...creature('st' + i, id, [x, 0.26, 0], { yaw: Math.sin(t * 0.8 + i) * 0.5, t: t + i, n: 1.15 })); });
    return { sky: { top: '#2f86e6', bottom: '#bfe6ff', clouds: 8 }, fog: { c: '#bfe6ff', near: 30, far: 80 }, light: { dir: [-0.5, 0.75, 0.45] }, shadowR: 14, statics: ARENA, objs, cam: { p: [Math.sin(t * 0.3) * 1.2, 2.8, 10.5], l: [0, 0.6, 0], fov: 56 } };
  };
  let cdist = 8; { const f = forward(w.yaw); for (; cdist > 3; cdist -= 0.6) { const t = tileOf(w.map, w.x - f[0] * cdist, w.z - f[1] * cdist); if (t === MDT.GRASS || t === MDT.TALL || t === MDT.WATER) break; } }
  const exploreCam = followCam({ x: w.x, y: Math.max(w.h(w.x, w.z), 0), z: w.z }, w.yaw, { hm: w, dist: cdist, height: 2.4 + cdist * 0.22, look: 2, fov: 62 });
  let scene3, menuScene;
  if (scene === 'battle' && b) { scene3 = battleScene(s.t); b.cam = scene3.cam; }
  else if (scene === 'starter') scene3 = starterScene(s.t);
  else scene3 = worldScene(s.t, exploreCam);
  menuScene = t => worldScene(t, exploreCam);
  const ang = w.leader ? compassAngle({ x: w.x, z: w.z }, w.yaw, w.leader) : 0;
  const hasSave = !!s.save;
  const sc = scoreOf(s);
  const gamePhase = scene;
  return (
    <Game3D title="MONSTER DUEL" emoji="⚡" accent={C.amber} onExit={onExit} score={sc} best={best} fx={fx}
      phase={gamePhase} onStart={start} startLabel="JUGAR" retryLabel="NUEVA AVENTURA" scene={scene3} menuScene={menuScene} orbit={{ r: 9, h: 3.6, speed: 0.2, ly: 1.2, drop: 1.2 }}
      hud={scene === 'explore' || scene === 'battle' ? <><HudPill icon="🏅" value={`${s.badges}/5`} color={C.amber} /><HudPill icon="👾" value={`${s.caught.length}/${MONS.length}`} color={C.violet} /><HudPill icon="🔴" value={s.balls} color={C.red} /><HudPill icon="🧪" value={s.potions} color={C.lime} /></> : null}
      subtitle="Explora una isla, captura monstruos y conviértete en campeón"
      lines={['Joystick izquierdo: moverte · derecho: girar la cámara', 'Toca a un monstruo salvaje o camina por la hierba alta para combatir', 'Debilítalos y lanza una Monstruobola 🔴 para capturarlos', 'Vence a 5 líderes: aparece un faro dorado cuando estés listo', 'Los tipos importan: 🔥 vence 🌱, 💧 vence 🔥, ⚡ vence 💧']}
      result={{ won: res.won, isNew: res.isNew, emoji: res.won ? '🏆' : '💀', title: res.won ? '¡CAMPEÓN!' : 'TODOS CAÍDOS', subtitle: res.won ? `Derrotaste a los 5 líderes · ${s.caught.length} monstruos` : `🏅 ${s.badges} medallas · 👾 ${s.caught.length} capturados`, stats: [['MEDALLAS', s.badges], ['CAPTURAS', s.caught.length], ['VICTORIAS', s.wins]] }}>
      {scene === 'starter' && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <Text pointerEvents="none" style={{ position: 'absolute', top: 6, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 2, ...tglow(C.amber, 8) }}>ELIGE A TU COMPAÑERO</Text>
          <View style={{ position: 'absolute', left: 10, right: 10, bottom: 12, gap: 6 }}>
            {[0, 2, 4].map(i => { const m = MONS[i]; return (
              <Pressable key={i} testID={`starter-${i}`} onPress={() => pickStarter(i)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 16, backgroundColor: 'rgba(6,8,22,0.78)', borderWidth: 2, borderColor: TC[m.type] }}>
                  <Text style={{ fontSize: 34, marginRight: 10 }}>{m.e}</Text>
                  <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: '900', fontSize: 15 }}>{m.name}</Text><Text style={{ color: TC[m.type], fontSize: 10, fontWeight: '900' }}>{TYPE_NAME[m.type]}</Text><Text style={{ color: C.dim, fontSize: 11 }}>PS {m.hp} · ATQ {m.atk} · DEF {m.def}</Text></View>
                </View>
              </Pressable>); })}
            {hasSave && <Btn3D size="sm" label="CONTINUAR PARTIDA" color={C.amber} ghost onPress={load} />}
          </View>
        </View>
      )}
      {scene === 'explore' && p && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View pointerEvents="none" style={{ position: 'absolute', left: 10, top: 4, width: SCREEN_W * 0.66, padding: 6, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.42)' }}>
            {s.log.slice(0, 3).map((m, i) => <Text key={i} numberOfLines={2} style={{ color: i === 0 ? C.text : alpha(C.dim, 0.85), fontSize: 11, lineHeight: 15 }}>{m}</Text>)}
          </View>
          {w.leader && <View pointerEvents="none" style={{ position: 'absolute', top: 4, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 14, paddingHorizontal: 8, paddingVertical: 3, alignItems: 'center' }}><Text style={{ color: C.amber, fontSize: 20, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text><Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>{Math.round(Math.hypot(w.leader.x - w.x, w.leader.z - w.z))} m</Text></View>}
          {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '22%', left: 20, right: 20, textAlign: 'center', color: '#fff', fontSize: 18, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
          <View style={{ position: 'absolute', right: 10, top: 90, gap: 8 }}>
            <ActionBtn testID="md-team" icon="👥" label="EQUIPO" color={C.amber} size={52} onDown={() => setTeamOpen(true)} style={{ position: 'relative' }} />
            <ActionBtn testID="md-rest" icon="🛏️" label="DESCANSO" color={C.cyan} size={52} onDown={rest} style={{ position: 'relative' }} />
            <ActionBtn testID="md-potion" icon="🧪" label={`${s.potions}`} color={C.lime} size={52} onDown={usePotion} style={{ position: 'relative' }} />
            <ActionBtn testID="md-save" icon="💾" label="GUARDAR" color={C.violet} size={52} onDown={() => { save(); addLog('💾 Partida guardada.'); hx.good(); }} style={{ position: 'relative' }} />
          </View>
          <Stick3D testID="md-stick" v={move} side="left" color={C.amber} />
          <Stick3D testID="md-look" v={look} side="right" color={C.cyan} />
          {teamOpen && (
            <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,10,8,0.88)', zIndex: 40, padding: 14, paddingTop: 20 }}>
              <Text style={{ color: C.amber, fontWeight: '900', fontSize: 14, letterSpacing: 2, marginBottom: 10, textAlign: 'center' }}>TU EQUIPO ({s.team.length}/4)</Text>
              {s.team.map((m, i) => (
                <Pressable key={i} onPress={() => { s.active = i; hx.tick(); }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 14, marginBottom: 8, backgroundColor: i === s.active ? alpha(TC[m.type], 0.18) : 'rgba(255,255,255,0.05)', borderWidth: 2, borderColor: i === s.active ? TC[m.type] : '#222638' }}>
                    <Text style={{ fontSize: 30, marginRight: 10, opacity: m.hp <= 0 ? 0.35 : 1 }}>{m.e}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>{m.name} <Text style={{ color: C.dim, fontSize: 11 }}>Nv.{m.lv}</Text>  <Text style={{ color: TC[m.type], fontSize: 10 }}>{TYPE_NAME[m.type]}</Text></Text>
                      <Bar value={m.hp} max={m.maxHp} color={hpColor(m.hp, m.maxHp)} h={7} style={{ marginTop: 4 }} />
                      <Text style={{ color: C.dim, fontSize: 10, marginTop: 2 }}>{m.hp}/{m.maxHp} PS · XP {m.xp}/{m.xpNext}</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
              <View style={{ marginTop: 6, alignItems: 'center' }}><Btn3D size="sm" ghost color={C.dim} label="CERRAR" onPress={() => setTeamOpen(false)} /></View>
            </View>
          )}
        </View>
      )}
      {scene === 'battle' && b && p && f && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <Card m={f} hp={b.dispF} style={{ position: 'absolute', left: 10, top: 2 }} extra={`${b.trainer ? `  ·  ${b.name} (${b.fi + 1}/${b.foes.length})` : ''}${f.st.atk < 0 ? ' · ATQ↓' : ''}${f.st.def > 0 ? ' · DEF↑' : ''}`} />
          <Card m={p} hp={b.dispP} align="right" style={{ position: 'absolute', right: 10, bottom: 268 }} extra={`${p.st.atk < 0 ? ' · ATQ↓' : ''}${p.st.def > 0 ? ' · DEF↑' : ''}`} />
          <View pointerEvents="none" style={{ position: 'absolute', left: 10, right: 10, bottom: 206, padding: 8, borderRadius: 12, backgroundColor: 'rgba(4,6,18,0.6)', borderWidth: 1, borderColor: alpha(C.amber, 0.3), minHeight: 54 }}>
            {s.log.slice(0, 2).map((m, i) => <Text key={i} style={{ color: i === 0 ? C.text : alpha(C.dim, 0.8), fontSize: 12, lineHeight: 17 }}>{m}</Text>)}
          </View>
          <View style={{ position: 'absolute', left: 10, right: 10, bottom: 12 }}>
            {s.busy && s.menu !== 'forced' && <Text style={{ color: C.dim, textAlign: 'center', padding: 22 }}>…</Text>}
            {!s.busy && s.menu === 'main' && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                <MdBtn testID="md-fight" label="⚔️ LUCHAR" color={C.red} onPress={() => { s.menu = 'moves'; }} />
                <MdBtn label="🔁 EQUIPO" color={C.violet} onPress={() => { s.menu = 'team'; }} />
                <MdBtn testID="md-catch" label={`🔴 ATRAPAR (${s.balls})`} color={C.amber} onPress={tryCatch} />
                <MdBtn label={`🧪 POCIÓN (${s.potions})`} color={C.lime} onPress={usePotion} />
                <MdBtn label="🏃 HUIR" color="#9aa3c8" onPress={run} />
              </View>
            )}
            {!s.busy && s.menu === 'moves' && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                {p.moves.map((mv, i) => <MdBtn key={i} testID={`md-mv${i}`} label={mv.n} sub={mv.eff ? mv.d : `${TYPE_NAME[mv.t]} · pot ${mv.p}${effOf(mv.t, f.type) > 1 ? ' ✓✓' : effOf(mv.t, f.type) < 1 ? ' ✗' : ''} · PP ${mv.pp}/${mv.max}`} color={TC[mv.t]} onPress={() => useMove(i)} disabled={mv.pp <= 0 || (mv.minLv && p.lv < mv.minLv)} />)}
                <MdBtn label="← Volver" color="#9aa3c8" onPress={() => { s.menu = 'main'; }} />
              </View>
            )}
            {(s.menu === 'team' || s.menu === 'forced') && (
              <View style={{ gap: 6 }}>
                {s.menu === 'forced' && <Text style={{ color: C.amber, fontWeight: '900', textAlign: 'center' }}>Elige al siguiente monstruo</Text>}
                {s.team.map((m, i) => (
                  <Pressable key={i} onPress={() => swapTo(i, s.menu === 'forced')} disabled={m.hp <= 0 || (i === s.active && s.menu === 'team')} style={{ opacity: m.hp <= 0 || (i === s.active && s.menu === 'team') ? 0.4 : 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 12, backgroundColor: 'rgba(6,8,22,0.8)', borderWidth: 1.5, borderColor: alpha(TC[m.type], 0.8) }}>
                      <Text style={{ fontSize: 24, marginRight: 8 }}>{m.e}</Text><Text style={{ color: C.text, fontWeight: '800', flex: 1 }}>{m.name} Nv.{m.lv}</Text><Text style={{ color: C.dim, fontSize: 11 }}>{m.hp}/{m.maxHp}</Text>
                    </View>
                  </Pressable>
                ))}
                {s.menu === 'team' && <MdBtn label="← Volver" color="#9aa3c8" onPress={() => { s.menu = 'main'; }} />}
              </View>
            )}
          </View>
        </View>
      )}
    </Game3D>
  );
}
