/**
 * Void Crawler 3D – mazmorra en primera persona.
 * La lógica es la del roguelike 2D por turnos (generación, enemigos, IA, trampas, jefe, niebla de LOS);
 * la vista es la del jugador: cámara en su celda, mirando hacia donde gira.
 * Controles: ▲ ▼ avanzan / retroceden (un paso = un turno, mantener repite), ⟲ ⟳ giran 90° (gratis),
 * arrastre horizontal también gira.
 */
import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, Bar, Btn, GameScreen, Overlay, PlayArea, TouchBtn, alpha, clamp, hx, pick, randInt, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Direcciones del grid (N, E, S, W) y ángulo de cámara para mirar hacia cada una
const VC3_DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const VC3_YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
const VC3_FOV = 66;

// Proyecta un punto del mundo a píxeles del PlayArea (para partículas y textos 2D)
const vcProj = (cam, x, y, z) => {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const m = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / m, a[1] / m, a[2] / m]; };
  const d = [x - cam.p[0], y - cam.p[1], z - cam.p[2]];
  const f = norm([cam.l[0] - cam.p[0], cam.l[1] - cam.p[1], cam.l[2] - cam.p[2]]);
  const r = norm(cross(f, [0, 1, 0])); const u = cross(r, f);
  const zc = dot(d, f); if (zc < 0.2) return null;
  const k = (AREA_H / 2) / Math.tan((cam.fov || 60) * Math.PI / 360) / zc;
  return [AREA_W / 2 + dot(d, r) * k, AREA_H / 2 - dot(d, u) * k];
};

// Forma 3D de cada tipo de enemigo (sin texto: el mundo se lee por color y silueta)
const VC3_SHAPE = {
  skeleton: { k: 'box', s: [0.5, 0.75, 0.4], y: 0.4, c: '#e6e6f2' },
  goblin: { k: 'box', s: [0.42, 0.55, 0.4], y: 0.3, c: '#5cd65c' },
  bat: { k: 'sph', n: 0.34, y: 0.7, c: '#8a7fbf' },
  slime: { k: 'sph', n: 0.6, y: 0.25, c: '#3ccf7a' },
  archer: { k: 'cone', s: [0.5, 0.9, 0.5], y: 0.45, c: '#c9a46a' },
  orc: { k: 'box', s: [0.7, 0.95, 0.6], y: 0.45, c: '#5a9a3a' },
  mage: { k: 'cone', s: [0.5, 1.0, 0.5], y: 0.5, c: '#9b6bff' },
  demon: { k: 'box', s: [0.6, 0.85, 0.5], y: 0.42, c: '#a02040' },
  dragon: { k: 'box', s: [1.2, 1.0, 1.2], y: 0.5, c: '#ffb020' },
};
const lit = (hex, d, extra = 0) => lighten(hex, Math.round(extra + 44 * Math.max(0, 1 - d / 7)));
const lighten = (hex, a) => {
  const n = parseInt(hex.slice(1), 16); const f = v => Math.min(255, v + a);
  return '#' + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('');
};

// Objetos 3D del nivel visible desde la posición del jugador (solo celdas vistas, ventana de 13×13)
function vcObjects(s, th) {
  const objs = [];
  const p = s.p; const px = Math.round(p.x), py = Math.round(p.y); const R = 6;
  const seen = s.seen; const vis = s.fl.vis;
  const warn = new Set();
  s.enemies.forEach(e => { if (e.warn) e.warn.forEach(([x, y]) => warn.add(`${x},${y}`)); });
  const floorAt = (x, y) => x >= 0 && y >= 0 && x < VC2_W && y < VC2_H && s.map[y][x] === 1;
  const floorAlt = lighten(th.floor, 10);
  objs.push({ id: 'techo', k: 'pla', p: [VC2_W / 2, 1.2, VC2_H / 2], r: [Math.PI / 2, 0, 0], s: [VC2_W + 2, VC2_H + 2, 1], c: th.wall, e: 0.02 });
  for (let y = py - R; y <= py + R; y++) for (let x = px - R; x <= px + R; x++) {
    if (x < 0 || y < 0 || x >= VC2_W || y >= VC2_H || !seen[y][x]) continue;
    if (s.map[y][x] === 0) {
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => floorAt(x + dx, y + dy) && seen[y + dy][x + dx])) {
        objs.push({ id: `w${x}_${y}`, k: 'box', p: [x + 0.5, 0.6, y + 0.5], s: [1, 1.2, 1], c: lit(th.wall, Math.hypot(x - p.x, y - p.y), 18 + ((x * 7 + y * 13) % 3) * 9), e: 0.03 });
      }
      continue;
    }
    const W = warn.has(`${x},${y}`);
    const dist = Math.hypot(x - p.x, y - p.y);
    objs.push({ id: `f${x}_${y}`, k: 'pla', p: [x + 0.5, 0, y + 0.5], s: [1, 1, 1], c: W ? '#ff3b3b' : lit((x + y) % 2 ? th.floor : floorAlt, dist), e: W ? 0.6 : 0 });
  }
  if (seen[s.stairs.y][s.stairs.x]) {
    const sx = s.stairs.x + 0.5, sz = s.stairs.y + 0.5;
    objs.push({ id: 'escalera', k: 'tor', p: [sx, 0.04, sz], r: [Math.PI / 2, 0, 0], n: 0.9, c: th.accent, e: 0.9 });
    objs.push({ id: 'escalera2', k: 'box', p: [sx, 0.25, sz], s: [0.25, 0.5, 0.25], c: th.accent, e: 0.8 });
  }
  s.items.forEach(it => {
    if (!vis.has(`${it.x},${it.y}`)) return;
    const x = it.x + 0.5, z = it.y + 0.5, id = `i${it.id}`;
    if (it.kind === 'potion') objs.push({ id, k: 'sph', p: [x, 0.25, z], n: 0.3, c: '#7dff6b', e: 0.8 });
    else if (it.kind === 'chest') {
      objs.push({ id, k: 'box', p: [x, 0.2, z], s: [0.5, 0.36, 0.4], c: '#9a5a2a', e: 0.15 });
      objs.push({ id: `${id}t`, k: 'box', p: [x, 0.4, z], s: [0.54, 0.07, 0.44], c: '#ffc233', e: 0.6 });
    } else if (it.kind === 'gold') objs.push({ id, k: 'cyl', p: [x, 0.07, z], s: [0.36, 0.06, 0.36], c: '#ffc233', e: 0.6 });
    else if (it.kind === 'bomb') objs.push({ id, k: 'sph', p: [x, 0.2, z], n: 0.38, c: '#2a2a33', e: 0.1 });
    else if (it.kind === 'shrine') {
      objs.push({ id, k: 'tor', p: [x, 0.08, z], r: [Math.PI / 2, 0, 0], n: 0.8, c: '#22e6ff', e: 0.9 });
      objs.push({ id: `${id}c`, k: 'cyl', p: [x, 0.45, z], s: [0.2, 0.7, 0.2], c: '#22e6ff', e: 0.5 });
    } else if (it.kind === 'trap' && Math.abs(it.x - p.x) + Math.abs(it.y - p.y) <= 2) objs.push({ id, k: 'cone', p: [x, 0.12, z], s: [0.5, 0.25, 0.5], c: '#ff4d6d', e: 0.7 });
  });
  s.enemies.forEach(e => {
    if (!vis.has(`${e.x},${e.y}`)) return;
    const sh = VC3_SHAPE[e.type] || VC3_SHAPE.skeleton;
    const bob = Math.sin(s.t * 5 + e.id) * 0.04;
    const base = { id: `e${e.id}`, p: [e.x + 0.5, sh.y + bob, e.y + 0.5], c: e.warn ? '#ff4d6d' : sh.c, e: e.warn ? 0.7 : 0.12 };
    if (sh.k === 'sph') objs.push({ ...base, k: 'sph', n: e.small ? sh.n * 0.6 : sh.n });
    else objs.push({ ...base, k: sh.k, s: sh.s });
    if (e.boss) {
      objs.push({ id: `e${e.id}wl`, k: 'box', p: [e.x + 0.5 - 0.85, 1.0 + bob, e.y + 0.5], s: [0.9, 0.08, 0.7], c: '#ffb020', e: 0.3 });
      objs.push({ id: `e${e.id}wr`, k: 'box', p: [e.x + 0.5 + 0.85, 1.0 + bob, e.y + 0.5], s: [0.9, 0.08, 0.7], c: '#ffb020', e: 0.3 });
    }
  });
  return objs;
}

const VcPad = ({ testID, label, color, onDown, onUp, style }) => (
  <TouchBtn testID={testID} onDown={onDown} onUp={onUp} style={[{ width: 52, height: 52, borderRadius: 16, backgroundColor: alpha(color, 0.18), borderWidth: 2, borderColor: alpha(color, 0.75), alignItems: 'center', justifyContent: 'center' }, style]}>
    <Text style={{ color, fontSize: 22, fontWeight: '900' }}>{label}</Text>
  </TouchBtn>
);

const VC2_W = 30;
const VC2_H = 26;
const VC2_THEMES = [
  { floor: '#101030', wall: '#1d1d4a', accent: C.blue, name: 'CATACUMBAS' }, { floor: '#0c2410', wall: '#17401f', accent: C.lime, name: 'PANTANO TÓXICO' },
  { floor: '#2a0e0c', wall: '#4a1a16', accent: C.orange, name: 'CAVERNA DE FUEGO' }, { floor: '#240c2a', wall: '#431a4a', accent: C.pink, name: 'REINO SOMBRÍO' },
  { floor: '#2a240c', wall: '#4a3f16', accent: C.amber, name: 'GUARIDA DEL DRAGÓN' },
];
const VC2_ENEMIES = {
  skeleton: { e: '💀', hp: 7, atk: 3, def: 0, xp: 6, ai: 'melee' }, goblin: { e: '👺', hp: 5, atk: 4, def: 0, xp: 7, ai: 'melee' },
  bat: { e: '🦇', hp: 3, atk: 2, def: 0, xp: 5, ai: 'fast' }, slime: { e: '🟢', hp: 8, atk: 2, def: 0, xp: 6, ai: 'melee', split: true },
  archer: { e: '🏹', hp: 6, atk: 4, def: 0, xp: 10, ai: 'archer' }, orc: { e: '👹', hp: 16, atk: 6, def: 1, xp: 14, ai: 'melee' },
  mage: { e: '🔮', hp: 9, atk: 7, def: 0, xp: 16, ai: 'mage' }, demon: { e: '😈', hp: 24, atk: 9, def: 2, xp: 26, ai: 'melee' },
  dragon: { e: '🐉', hp: 90, atk: 13, def: 3, xp: 200, ai: 'boss', boss: true },
};
const VC2_FLOORS = [['skeleton', 'goblin', 'bat', 'slime'], ['skeleton', 'goblin', 'bat', 'archer', 'orc'], ['orc', 'archer', 'mage', 'bat', 'slime'], ['demon', 'mage', 'orc', 'archer'], ['dragon', 'demon', 'demon', 'mage']];
const VC2_WEAPONS = [['Daga', 1], ['Espada', 3], ['Hacha', 5], ['Lanza rúnica', 7], ['Filo del vacío', 10]];
const VC2_ARMORS = [['Harapos', 0], ['Cuero', 1], ['Malla', 2], ['Placas', 4], ['Egida', 6]];

export function VoidCrawler3D({ onExit }) {
  const CELL = 46; // referencia para los efectos (FX)
  const fx = useFX();
  const [best, submitBest] = useBest('void');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const [, force] = useReducer(x => x + 1, 0);
  const holdRef = useRef(null);
  const g = useRef(null);

  const initPlayer = () => ({ x: 1, y: 1, hp: 26, maxHp: 26, atk: 3, def: 0, lv: 1, xp: 0, gold: 0, potions: 2, bombs: 1, weapon: 0, armor: 0, vx: 1, vy: 1 });
  const gen = (floor, p) => {
    const map = Array.from({ length: VC2_H }, () => Array(VC2_W).fill(0));
    const rooms = [];
    for (let k = 0; k < 60 && rooms.length < 10; k++) {
      const w = randInt(4, 8), h = randInt(4, 7), x = randInt(1, VC2_W - w - 2), y = randInt(1, VC2_H - h - 2);
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
    const freeIn = (room) => { for (let t = 0; t < 40; t++) { const x = randInt(room.x, room.x + room.w - 1), y = randInt(room.y, room.y + room.h - 1); if (!taken.has(`${x},${y}`)) { taken.add(`${x},${y}`); return { x, y }; } } return null; };
    const enemies = [];
    const pool = VC2_FLOORS[floor - 1];
    const count = floor === 5 ? 5 : 5 + floor * 2;
    if (floor === 5) { const pos = freeIn(last); if (pos) enemies.push(mkEnemy('dragon', pos, floor)); }
    for (let i = enemies.length; i < count; i++) { const room = rooms[randInt(1, rooms.length - 1)]; const pos = freeIn(room); if (pos) enemies.push(mkEnemy(pool[randInt(0, pool.length - 1)], pos, floor)); }
    const items = [];
    const addItem = (kind, n) => { for (let i = 0; i < n; i++) { const room = pick(rooms); const pos = freeIn(room); if (pos) items.push({ id: uid(), kind, ...pos }); } };
    addItem('potion', 2); addItem('chest', 2 + (floor > 2 ? 1 : 0)); addItem('gold', 3); addItem('bomb', 1); if (Math.random() < 0.6) addItem('shrine', 1); addItem('trap', 3 + floor);
    return { map, seen: Array.from({ length: VC2_H }, () => Array(VC2_W).fill(false)), rooms, stairs, enemies, items };
  };
  const mkEnemy = (type, pos, floor) => { const d = VC2_ENEMIES[type]; const hp = d.hp + (floor - 1) * 3; return { id: uid(), type, e: d.e, ai: d.ai, x: pos.x, y: pos.y, hp, maxHp: hp, atk: d.atk + Math.floor((floor - 1) * 0.8), def: d.def, xp: d.xp, boss: d.boss, split: d.split, awake: false, turn: 0, warn: null, flash: 0 }; };
  const newRun = () => {
    const p = initPlayer(); const lvl = gen(1, p);
    return { p, floor: 1, ...lvl, face: 0, yawCur: 0, kills: 0, turn: 0, log: ['Los pasillos del vacío te esperan…'], t: 0, fl: { vis: new Set() }, alive: true };
  };
  if (!g.current) { g.current = newRun(); }
  const start = () => { fx.clear(); g.current = newRun(); computeVis(g.current); setPhase('play'); };
  const addLog = m => { g.current.log = [m, ...g.current.log].slice(0, 3); };
  const wall = (s, x, y) => x < 0 || y < 0 || x >= VC2_W || y >= VC2_H || s.map[y][x] === 0;
  const los = (s, x0, y0, x1, y1) => { // Bresenham
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy, x = x0, y = y0;
    while (x !== x1 || y !== y1) { if ((x !== x0 || y !== y0) && wall(s, x, y)) return false; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x += sx; } if (e2 < dx) { err += dx; y += sy; } }
    return true;
  };
  const computeVis = s => {
    const vis = new Set(); const p = s.p; const R = 6;
    for (let j = p.y - R; j <= p.y + R; j++) for (let i = p.x - R; i <= p.x + R; i++) {
      if (i < 0 || j < 0 || i >= VC2_W || j >= VC2_H) continue;
      if ((i - p.x) ** 2 + (j - p.y) ** 2 > R * R + 1) continue;
      if (los(s, p.x, p.y, i, j)) { vis.add(`${i},${j}`); s.seen[j][i] = true; }
    }
    s.fl.vis = vis;
  };
  const px = (s, x, y) => { const q = s.cam && vcProj(s.cam, x + 0.5, 0.5, y + 0.5); return q ? { x: q[0], y: q[1] } : { x: AREA_W / 2, y: AREA_H / 2 }; };
  const need = lv => lv * 22;
  const levelCheck = s => { const p = s.p; while (p.xp >= need(p.lv)) { p.xp -= need(p.lv); p.lv += 1; p.maxHp += 6; p.hp = Math.min(p.maxHp, p.hp + 8); p.atk += 1; if (p.lv % 3 === 0) p.def += 1; addLog(`⬆️ ¡Nivel ${p.lv}!`); const q = px(s, p.x, p.y); fx.pop(q.x, q.y - 20, `NIVEL ${p.lv}`, C.amber, 20); fx.ring(q.x, q.y, C.amber, 60); hx.good(); } };
  const die = (s, by) => { s.alive = false; hx.die(); fx.shake(10, 0.4); fx.flash(C.red, 0.4); const sc = s.floor * 100 + s.kills * 10 + s.p.gold; setRes({ isNew: submitBest(sc), won: false, by }); setPhase('over'); };
  const hurt = (s, dmg, by, ignoreDef) => {
    const p = s.p; const d = Math.max(1, dmg - (ignoreDef ? 0 : p.def));
    p.hp -= d; const q = px(s, p.x, p.y); fx.pop(q.x, q.y - 22, `-${d}`, C.red, 20); fx.burst(q.x, q.y, C.red, 8, 180); fx.shake(4, 0.15); hx.bad();
    if (p.hp <= 0) { p.hp = 0; die(s, by); }
  };
  const killEnemy = (s, e) => {
    const q = px(s, e.x, e.y); s.kills += 1; s.p.xp += e.xp; fx.burst(q.x, q.y, C.amber, 14, 220); fx.pop(q.x, q.y - 14, `+${e.xp} XP`, C.amber, 14); hx.hit();
    addLog(`⚔️ Derrotaste a ${e.e}${e.boss ? ' — ¡JEFE!' : ''} (+${e.xp} XP)`);
    s.enemies = s.enemies.filter(o => o !== e);
    if (e.split && !e.small) { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = e.x + dx, ny = e.y + dy; if (!wall(s, nx, ny) && !s.enemies.some(o => o.x === nx && o.y === ny) && !(s.p.x === nx && s.p.y === ny)) { const m = mkEnemy('slime', { x: nx, y: ny }, s.floor); m.hp = m.maxHp = Math.max(2, Math.floor(e.maxHp / 3)); m.xp = 2; m.small = true; m.awake = true; s.enemies.push(m); break; } } }
    if (e.boss) { s.p.gold += 100; hx.win(); fx.flash('#fff', 0.4); }
    levelCheck(s);
  };
  const bfsStep = (s, e, tx, ty) => {
    const start = `${e.x},${e.y}`;
    const prev = new Map([[start, null]]); const q = [[e.x, e.y, 0]];
    while (q.length) {
      const [x, y, d] = q.shift();
      if (d > 14) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
        if (prev.has(k)) continue;
        if (nx === tx && ny === ty) {
          let cur = `${x},${y}`; let step = [x, y];
          while (prev.get(cur) !== null) { step = cur.split(',').map(Number); cur = prev.get(cur); }
          return step;
        }
        if (wall(s, nx, ny) || s.enemies.some(o => o !== e && o.x === nx && o.y === ny)) continue;
        prev.set(k, `${x},${y}`); q.push([nx, ny, d + 1]);
      }
    }
    return null;
  };
  const stepEnemy = (s, e) => {
    const p = s.p; const dx = p.x - e.x, dy = p.y - e.y; const man = Math.abs(dx) + Math.abs(dy);
    const lineClear = los(s, e.x, e.y, p.x, p.y);
    if (!e.awake) { if (man <= 7 && lineClear) e.awake = true; else return; }
    e.flash = 0;
    const approach = () => { const st = bfsStep(s, e, p.x, p.y); if (st && !(st[0] === p.x && st[1] === p.y)) { e.x = st[0]; e.y = st[1]; } };
    if (e.ai === 'archer') {
      if ((dx === 0 || dy === 0) && man <= 6 && lineClear) { const q0 = px(s, e.x, e.y), q1 = px(s, p.x, p.y); fx.burst((q0.x + q1.x) / 2, (q0.y + q1.y) / 2, C.amber, 6, 80, 0.3, 3); hurt(s, e.atk, e.e); addLog(`${e.e} te dispara una flecha.`); return; }
      if (man <= 2) { const st = [[-Math.sign(dx), 0], [0, -Math.sign(dy)]].find(([ax, ay]) => !wall(s, e.x + ax, e.y + ay) && !s.enemies.some(o => o.x === e.x + ax && o.y === e.y + ay)); if (st) { e.x += st[0]; e.y += st[1]; } return; }
      approach(); return;
    }
    if (e.ai === 'mage') {
      if (man <= 4 && lineClear && e.turn % 2 === 0) { e.turn += 1; const q1 = px(s, p.x, p.y); fx.ring(q1.x, q1.y, C.violet, 50); hurt(s, e.atk, e.e, true); addLog(`${e.e} lanza un hechizo.`); return; }
      e.turn += 1; if (man > 2) approach(); return;
    }
    if (e.ai === 'boss') {
      e.turn += 1;
      if (e.warn) { const hit = e.warn.some(([x, y]) => x === p.x && y === p.y); const q = px(s, e.x, e.y); fx.ring(q.x, q.y, C.orange, 120); fx.shake(8, 0.3); fx.flash(C.orange, 0.3); e.warn = null; if (hit) { hurt(s, 14, e.e, true); addLog('🔥 ¡El aliento del dragón te quema!'); } else addLog('🔥 Esquivaste el aliento del dragón.'); return; }
      if (e.turn % 4 === 0) { e.warn = []; for (let k = -4; k <= 4; k++) { e.warn.push([e.x + k, e.y], [e.x, e.y + k]); } addLog('⚠️ ¡El dragón inhala fuego! Sal de su fila y columna.'); hx.warn(); return; }
    }
    if (man === 1) { const dmg = e.atk; hurt(s, dmg, e.e); addLog(`${e.e} te golpea.`); return; }
    approach();
    if (e.ai === 'fast' && s.alive) { const d2 = Math.abs(p.x - e.x) + Math.abs(p.y - e.y); if (d2 === 1) { hurt(s, e.atk, e.e); } else approach(); }
  };
  const enemyPhase = s => { s.enemies.slice().forEach(e => { if (s.alive && s.enemies.includes(e)) stepEnemy(s, e); }); };
  const afterPlayer = s => { s.turn += 1; computeVis(s); if (s.alive) enemyPhase(s); if (s.alive) computeVis(s); force(); };

  const act = (dx, dy) => {
    const s = g.current; if (phase !== 'play' || !s.alive) return;
    const p = s.p; const nx = p.x + dx, ny = p.y + dy;
    if (wall(s, nx, ny)) { hx.tick(); return; }
    const e = s.enemies.find(o => o.x === nx && o.y === ny);
    if (e) {
      const crit = Math.random() < 0.12; let d = Math.max(1, p.atk + VC2_WEAPONS[p.weapon][1] - e.def + randInt(0, 2)); if (crit) d *= 2;
      e.hp -= d; e.awake = true; const q = px(s, e.x, e.y); fx.pop(q.x, q.y - 18, `${crit ? '💥' : ''}${d}`, crit ? C.amber : C.text, crit ? 22 : 17); fx.burst(q.x, q.y, '#fff', 6, 150, 0.3, 3); hx.hit();
      if (e.hp <= 0) killEnemy(s, e); else addLog(`🗡️ Golpeas a ${e.e}: ${d} (${e.hp}/${e.maxHp})`);
      afterPlayer(s);
      if (e.hp <= 0 && e.boss && s.alive) { const sc = s.floor * 100 + s.kills * 10 + s.p.gold + 500; setRes({ isNew: submitBest(sc), won: true }); setPhase('win'); }
      return;
    }
    p.x = nx; p.y = ny; hx.tick();
    const it = s.items.find(o => o.x === nx && o.y === ny);
    if (it) {
      const q = px(s, nx, ny);
      if (it.kind === 'trap') { const d = randInt(3, 5) + s.floor; s.items = s.items.filter(o => o !== it); fx.burst(q.x, q.y, C.red, 12, 200); hurt(s, d, '⚠️', true); addLog(`⚠️ ¡Trampa de púas! -${d}`); }
      else if (it.kind === 'potion') { p.potions += 1; addLog('🧪 Recoges una poción.'); fx.pop(q.x, q.y - 14, '+🧪', C.lime, 16); hx.good(); s.items = s.items.filter(o => o !== it); }
      else if (it.kind === 'bomb') { p.bombs += 1; addLog('💣 Recoges una bomba.'); hx.good(); s.items = s.items.filter(o => o !== it); }
      else if (it.kind === 'gold') { const gold = randInt(8, 20) + s.floor * 4; p.gold += gold; fx.pop(q.x, q.y - 14, `+${gold}💰`, C.amber, 16); hx.good(); s.items = s.items.filter(o => o !== it); }
      else if (it.kind === 'shrine') { p.hp = p.maxHp; fx.ring(q.x, q.y, C.cyan, 90); fx.flash(C.cyan, 0.25); addLog('⛲ El santuario restaura tu salud.'); hx.good(); s.items = s.items.filter(o => o !== it); }
      else if (it.kind === 'chest') {
        s.items = s.items.filter(o => o !== it); const r = Math.random(); fx.burst(q.x, q.y, C.amber, 14, 200); hx.win();
        if (r < 0.34 && p.weapon < VC2_WEAPONS.length - 1) { p.weapon = Math.min(VC2_WEAPONS.length - 1, p.weapon + 1); addLog(`📦 ¡Arma nueva: ${VC2_WEAPONS[p.weapon][0]}!`); }
        else if (r < 0.68 && p.armor < VC2_ARMORS.length - 1) { p.armor += 1; p.def += VC2_ARMORS[p.armor][1] - VC2_ARMORS[p.armor - 1][1]; addLog(`📦 ¡Armadura nueva: ${VC2_ARMORS[p.armor][0]}!`); }
        else { p.maxHp += 6; p.hp = Math.min(p.maxHp, p.hp + 10); addLog('📦 ¡Elixir! +6 PS máx.'); }
      }
    }
    if (nx === s.stairs.x && ny === s.stairs.y) {
      if (s.floor >= 5) { return; }
      if (s.enemies.some(o => o.boss)) { addLog('🚪 La puerta está sellada…'); }
      s.floor += 1; const lvl = gen(s.floor, p); Object.assign(s, lvl); s.fl = { vis: new Set() }; p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * 0.25));
      addLog(`🚪 Piso ${s.floor}: ${VC2_THEMES[s.floor - 1].name}`); hx.win(); fx.flash('#fff', 0.35); computeVis(s); force(); return;
    }
    afterPlayer(s);
  };
  const usePotion = () => { const s = g.current; const p = s.p; if (phase !== 'play' || p.potions <= 0 || p.hp >= p.maxHp) { hx.tick(); return; } p.potions -= 1; const h = Math.ceil(p.maxHp * 0.5); p.hp = Math.min(p.maxHp, p.hp + h); const q = px(s, p.x, p.y); fx.pop(q.x, q.y - 20, `+${h}`, C.lime, 20); fx.ring(q.x, q.y, C.lime, 50); hx.good(); addLog('🧪 Bebes una poción.'); afterPlayer(s); };
  const useBomb = () => {
    const s = g.current; const p = s.p; if (phase !== 'play' || p.bombs <= 0) { hx.tick(); return; }
    p.bombs -= 1; const q = px(s, p.x, p.y); fx.ring(q.x, q.y, C.orange, CELL * 3); fx.flash(C.orange, 0.3); fx.shake(8, 0.3); hx.heavy();
    s.enemies.slice().forEach(e => { if (Math.abs(e.x - p.x) <= 2 && Math.abs(e.y - p.y) <= 2) { e.hp -= 12; e.awake = true; const qq = px(s, e.x, e.y); fx.pop(qq.x, qq.y - 14, '-12', C.orange, 18); if (e.hp <= 0) killEnemy(s, e); } });
    addLog('💣 ¡BOOM!'); afterPlayer(s);
  };

  // ─── Controles en primera persona: girar (gratis), avanzar/retroceder (un turno por paso) ───
  const turn = d => { const s = g.current; if (phase !== 'play' || !s.alive) return; s.face = (s.face + d + 4) % 4; hx.tick(); };
  const stepDir = back => { const s = g.current; const [dx, dy] = VC3_DIRS[back ? (s.face + 2) % 4 : s.face]; act(dx, dy); };
  const startHold = back => { stepDir(back); clearInterval(holdRef.current); holdRef.current = setInterval(() => stepDir(back), 190); };
  const stopHold = () => { clearInterval(holdRef.current); holdRef.current = null; };
  useEffect(() => () => clearInterval(holdRef.current), []);
  const pan = usePan(fx, {
    down: () => { g.current.used = false; },
    move: (x, y, gs) => { const s = g.current; if (s.used) return; if (Math.abs(gs.dx) > 40 && Math.abs(gs.dx) > Math.abs(gs.dy)) { s.used = true; turn(gs.dx > 0 ? 1 : -1); } },
  });
  // la cámara gira suavemente hacia la nueva dirección
  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt;
    s.p.vx += (s.p.x - s.p.vx) * Math.min(1, dt * 16); s.p.vy += (s.p.y - s.p.vy) * Math.min(1, dt * 16);
    let d = VC3_YAW[s.face] - s.yawCur; d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI; s.yawCur += d * Math.min(1, dt * 9);
  });

  const s = g.current; const p = s.p; const th = VC2_THEMES[s.floor - 1];
  const camPos = [p.vx + 0.5, 0.5, p.vy + 0.5];
  const cam = { p: camPos, l: [camPos[0] - Math.sin(s.yawCur), 0.5, camPos[2] - Math.cos(s.yawCur)], fov: VC3_FOV };
  s.cam = cam;
  const scene = { bg: '#000000', fog: { c: '#05050a', near: 1.2, far: 7.5 }, objs: vcObjects(s, th), cam };
  const sc = s.floor * 100 + s.kills * 10 + p.gold;
  return (
    <GameScreen title="VOID CRAWLER 3D" emoji="☠️" accent={th.accent} onExit={onExit} score={sc} best={best}
      hud={<><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={{ color: C.red, fontSize: 10, fontWeight: '900' }}>HP</Text><Bar value={p.hp} max={p.maxHp} color={p.hp / p.maxHp > 0.4 ? C.lime : C.red} h={8} w={96} /><Text style={{ color: C.dim, fontSize: 10 }}>{p.hp}/{p.maxHp}</Text></View><Text style={{ color: C.dim, fontSize: 11 }}>Piso <Text style={{ color: th.accent, fontWeight: '900' }}>{s.floor}/5</Text> · Nv.{p.lv}</Text></>}>
      <PlayArea fx={fx} bg="#000" border={alpha(th.accent, 0.4)} {...pan}>
        <World3D scene={scene} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 10, right: 10, top: 8, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.45)' }}>
          {s.log.map((m, i) => <Text key={i} numberOfLines={1} style={{ color: i === 0 ? C.text : alpha(C.dim, 0.8), fontSize: 11, lineHeight: 15 }}>{m}</Text>)}
        </View>
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 12, top: 84 }}>
          <Btn label="⏳ ESPERAR" small ghost color={C.dim} onPress={() => { if (phase === 'play') afterPlayer(g.current); }} />
        </View>
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, bottom: 12, gap: 6 }}>
          <Text style={{ color: C.dim, fontSize: 11 }}>⚔️ {p.atk + VC2_WEAPONS[p.weapon][1]} ({VC2_WEAPONS[p.weapon][0]})  🛡️ {p.def}</Text>
          <Text style={{ color: C.dim, fontSize: 11 }}>XP {p.xp}/{need(p.lv)}  💰 {p.gold}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn label={`🧪 ${p.potions}`} small ghost color={C.lime} onPress={usePotion} />
            <Btn label={`💣 ${p.bombs}`} small ghost color={C.orange} onPress={useBomb} />
          </View>
        </View>
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 12, bottom: 10, width: 164, height: 164 }}>
          <VcPad testID="vd-fwd" label="▲" color={th.accent} onDown={() => startHold(false)} onUp={stopHold} style={{ position: 'absolute', left: 56, top: 0 }} />
          <VcPad testID="vd-left" label="⟲" color={th.accent} onDown={() => turn(-1)} onUp={() => {}} style={{ position: 'absolute', left: 0, top: 56 }} />
          <VcPad testID="vd-right" label="⟳" color={th.accent} onDown={() => turn(1)} onUp={() => {}} style={{ position: 'absolute', left: 112, top: 56 }} />
          <VcPad testID="vd-back" label="▼" color={th.accent} onDown={() => startHold(true)} onUp={stopHold} style={{ position: 'absolute', left: 56, top: 112 }} />
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'win' ? '🏆' : phase === 'over' ? '💀' : '☠️'} title={phase === 'win' ? '¡VACÍO CONQUISTADO!' : phase === 'over' ? 'HAS MUERTO' : 'VOID CRAWLER 3D'}
          subtitle={phase === 'win' ? `Derrotaste al dragón · Nv.${p.lv}` : phase === 'over' ? `Caíste en el piso ${s.floor} ante ${res.by || '…'} · ${s.kills} enemigos` : '5 pisos de oscuridad procedural'}
          score={sc + (phase === 'win' ? 500 : 0)} best={best} isNew={res.isNew} accent={th.accent} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Usa ⟲ ⟳ para girar y ▲ ▼ para avanzar o retroceder', 'Cada paso es un turno: los enemigos actúan después', 'Solo ves lo que alcanza tu luz: la niebla oculta el resto', '🏹 dispara en línea · 🔮 hechizos · ⚠️ trampas · 🐉 jefe final', '🧪 curas · 💣 daña alrededor · 📦 equipo'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
