/**
 * Pixel RPG 3D – mundo abierto: mapa procedural en 3D (bosques, agua, montañas, aldeas, fortaleza
 * y el volcán del dragón), cámara detrás del mago. Las reglas (mapa, cofres, combate por turnos,
 * hechizos, tiendas, guardado) son las del juego 2D. Los combates muestran una arena 3D con el enemigo.
 */
import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AREA_W, AREA_H, C, Bar, Btn, GameScreen, Overlay, PlayArea, TouchBtn, alpha, clamp, hx, pick, randInt, tglow, useBest, useFX, useLoop, useTimeouts, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

const RPG_GROUND = ['#1d3b14', '#17361a', '#2a3a20', '#3a3430', '#2b1712'];   // suelo por zona
const RPG_ENEMY_COLORS = ['#7dff6b', '#ff9a3c', '#c85cff', '#ffd400', '#2d8cff', '#ff4d6d'];

// Tiles de alrededor del mago (ventana de 15×15) convertidos en formas 3D
function rpgMapScene(s) {
  const objs = [];
  const px = Math.round(s.x), py = Math.round(s.y);
  const pr = rpgProgress(px, py);
  const zone = pr < 0.25 ? 0 : pr < 0.5 ? 1 : pr < 0.7 ? 2 : pr < 0.88 ? 3 : 4;
  objs.push({ id: 'suelo', k: 'pla', p: [RPG_W / 2, 0, RPG_H / 2], s: [RPG_W + 6, RPG_H + 6, 1], c: RPG_GROUND[zone] });
  const R = 7;
  for (let y = py - R; y <= py + R; y++) for (let x = px - R; x <= px + R; x++) {
    if (x < 0 || y < 0 || x >= RPG_W || y >= RPG_H) continue;
    const ch = s.world[y][x]; const id = `${x}_${y}`; const cx = x + 0.5, cz = y + 0.5;
    if (ch === 'T') { objs.push({ id: `tt${id}`, k: 'cyl', p: [cx, 0.5, cz], s: [0.25, 1, 0.25], c: '#5a3a22' }); objs.push({ id: `tc${id}`, k: 'cone', p: [cx, 1.5, cz], s: [1.0, 1.4, 1.0], c: '#1f5a22' }); }
    else if (ch === '~') objs.push({ id: `wa${id}`, k: 'pla', p: [cx, 0.02, cz], s: [1, 1, 1], c: '#1d5fb0', e: 0.15 });
    else if (ch === '^') objs.push({ id: `ro${id}`, k: 'box', p: [cx, 0.35, cz], s: [0.9, 0.7, 0.9], r: [0, ((x * 3 + y) % 4) * 0.4, 0], c: '#6f6a66' });
    else if (ch === '#') objs.push({ id: `wl${id}`, k: 'box', p: [cx, 0.7, cz], s: [1, 1.4, 1], c: '#3a2a2e' });
    else if (ch === 'm') objs.push({ id: `mt${id}`, k: 'cone', p: [cx, 0.8, cz], s: [1.5, 1.6, 1.5], c: '#5a5450' });
    else if (ch === 'f') objs.push({ id: `fl${id}`, k: 'pla', p: [cx, 0.02, cz], s: [1, 1, 1], c: '#2b6b2a' });
    else if (ch === 'v') objs.push({ id: `as${id}`, k: 'pla', p: [cx, 0.02, cz], s: [1, 1, 1], c: '#3a2018' });
    else if (ch === '=') objs.push({ id: `rd${id}`, k: 'pla', p: [cx, 0.02, cz], s: [1, 1, 1], c: '#7a5a34' });
    else if (ch === 'H') { objs.push({ id: `hs${id}`, k: 'box', p: [cx, 0.45, cz], s: [0.9, 0.9, 0.9], c: '#c08c52' }); objs.push({ id: `hr${id}`, k: 'cone', p: [cx, 1.2, cz], s: [1.2, 0.7, 1.2], c: '#8a2a1a' }); }
    else if (ch === 'V') { objs.push({ id: `cs${id}`, k: 'box', p: [cx, 1.1, cz], s: [1.2, 2.2, 1.2], c: '#8a8a95' }); objs.push({ id: `ct${id}`, k: 'cone', p: [cx, 2.6, cz], s: [1.3, 0.9, 1.3], c: '#3a3a8a' }); }
    else if (ch === 'L') { objs.push({ id: `vo${id}`, k: 'cone', p: [cx, 1.6, cz], s: [2.6, 3.2, 2.6], c: '#4a1a12' }); objs.push({ id: `vl${id}`, k: 'sph', p: [cx, 3.3, cz], n: 0.9, c: '#ff5a1a', e: 1 }); }
    else if (ch === 'c') { objs.push({ id: `ch${id}`, k: 'box', p: [cx, 0.2, cz], s: [0.55, 0.4, 0.42], c: '#9a5a2a' }); objs.push({ id: `cl${id}`, k: 'box', p: [cx, 0.44, cz], s: [0.58, 0.08, 0.46], c: '#ffc233', e: 0.5 }); }
    else if (ch === 'N') { objs.push({ id: `nb${id}`, k: 'cyl', p: [cx, 0.5, cz], s: [0.4, 1, 0.4], c: '#4d6fb0' }); objs.push({ id: `nh${id}`, k: 'sph', p: [cx, 1.2, cz], n: 0.4, c: '#e0b890' }); }
  }
  // el mago
  const ax = s.vx + 0.5, az = s.vy + 0.5;
  objs.push({ id: 'mb', k: 'cyl', p: [ax, 0.55, az], s: [0.6, 1.0, 0.6], c: '#7a4fd6' });
  objs.push({ id: 'mh', k: 'sph', p: [ax, 1.3, az], n: 0.42, c: '#f2c9a0' });
  objs.push({ id: 'mw', k: 'cone', p: [ax, 1.92, az], s: [0.7, 0.9, 0.7], c: '#ffc233', e: 0.1 });
  objs.push({ id: 'mt2', k: 'box', p: [ax + 0.38, 0.95, az], s: [0.07, 1.6, 0.07], c: '#8a5a2a' });
  objs.push({ id: 'mtg', k: 'sph', p: [ax + 0.38, 1.8, az], n: 0.2, c: '#22e6ff', e: 1 });
  // cámara detrás del mago, según su última dirección
  const fx_ = s.cfx, fz_ = s.cfz;
  const cam = { p: [ax - fx_ * 4.4, 3.4, az - fz_ * 4.4], l: [ax + fx_ * 1.2, 0.8, az + fz_ * 1.2], fov: 60 };
  return { bg: '#0a0803', fog: { c: '#0a0803', near: 9, far: 22 }, objs, cam };
}

// Arena del combate: el enemigo frente al jugador (el dragón ocupa toda la escena)
function rpgBattleScene(b) {
  const boss = !!b.boss; const hit = b.hit > 0;
  const col = hit ? '#ffffff' : boss ? '#c0392b' : RPG_ENEMY_COLORS[b.enemy.name.length % RPG_ENEMY_COLORS.length];
  const bob = Math.sin(b.t * 3) * 0.12; const em = b.charging ? 0.6 : 0.15;
  const objs = [{ id: 'arena', k: 'pla', p: [0, 0, -3], s: [16, 12, 1], c: boss ? '#2a0c0c' : '#1d1830' }];
  if (boss) {
    objs.push({ id: 'dr_c', k: 'box', p: [0, 1.6 + bob, -4], s: [2.6, 2.0, 2.2], c: col, e: em });
    objs.push({ id: 'dr_h', k: 'sph', p: [0, 3.3 + bob, -3.2], n: 1.4, c: col, e: em });
    objs.push({ id: 'dr_w1', k: 'box', p: [-2.3, 2.2 + bob, -4], s: [2.4, 0.18, 1.8], r: [0, 0, 0.3], c: '#8a1a1a', e: em });
    objs.push({ id: 'dr_w2', k: 'box', p: [2.3, 2.2 + bob, -4], s: [2.4, 0.18, 1.8], r: [0, 0, -0.3], c: '#8a1a1a', e: em });
    objs.push({ id: 'dr_k1', k: 'cone', p: [-0.5, 4.3 + bob, -3.2], s: [0.4, 0.9, 0.4], c: '#ffc233', e: 0.4 });
    objs.push({ id: 'dr_k2', k: 'cone', p: [0.5, 4.3 + bob, -3.2], s: [0.4, 0.9, 0.4], c: '#ffc233', e: 0.4 });
  } else {
    objs.push({ id: 'en_b', k: 'sph', p: [0, 1.4 + bob, -4], n: 2.1, c: col, e: em });
    objs.push({ id: 'en_e1', k: 'sph', p: [-0.4, 1.6 + bob, -2.0], n: 0.3, c: '#ffffff', e: 1 });
    objs.push({ id: 'en_e2', k: 'sph', p: [0.4, 1.6 + bob, -2.0], n: 0.3, c: '#ffffff', e: 1 });
  }
  return { bg: boss ? '#1a0505' : '#0d0a14', objs, cam: { p: [0, 2.8, 6.2], l: [0, 1.6, -4], fov: 55 } };
}

// Botón de la cruz (mantener = repetir paso)
function RpgPad({ testID, label, onDown, onUp, style }) {
  return (
    <TouchBtn testID={testID} onDown={onDown} onUp={onUp} style={[{ width: 56, height: 56, borderRadius: 18, backgroundColor: alpha(C.amber, 0.14), borderWidth: 2, borderColor: alpha(C.amber, 0.6), alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ color: C.amber, fontSize: 24, fontWeight: '900' }}>{label}</Text>
    </TouchBtn>
  );
}

const RPG_W = 28;
const RPG_H = 28;
const RPG_SAVE_KEY = '@rpg_save2';
const RPG_TILE = {
  '.': { bg: '#1d3b14', e: '' }, T: { bg: '#10260c', e: '🌲', block: true }, f: { bg: '#18340f', e: '🌿' },
  '~': { bg: '#0b2a55', e: '🌊', block: true }, m: { bg: '#3a3430', e: '⛰️' }, '^': { bg: '#2a2624', e: '🪨', block: true },
  v: { bg: '#2b1712', e: '' }, '#': { bg: '#1a1012', e: '🧱', block: true }, '=': { bg: '#5a4326', e: '' },
  H: { bg: '#5a4326', e: '🏘️' }, V: { bg: '#5a4326', e: '🏰' }, L: { bg: '#3a0c0c', e: '🌋' }, c: { bg: '#1d3b14', e: '📦' }, N: { bg: '#1d3b14', e: '🧓' },
};
const RPG_ZONES = [
  { name: 'Praderas', enc: 0.1, pool: [0, 1, 2] }, { name: 'Bosque', enc: 0.2, pool: [1, 3, 4, 5] },
  { name: 'Pantano', enc: 0.22, pool: [6, 7, 8] }, { name: 'Montañas', enc: 0.26, pool: [9, 10, 11] },
  { name: 'Tierras de ceniza', enc: 0.3, pool: [12, 13, 14] },
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
function rpgProgress(x, y) { return (x + (RPG_H - 1 - y)) / (RPG_W + RPG_H - 2); }
function rpgZone(x, y) { const p = rpgProgress(x, y); return RPG_ZONES[p < 0.25 ? 0 : p < 0.5 ? 1 : p < 0.7 ? 2 : p < 0.88 ? 3 : 4]; }
const RPG_START = { x: 3, y: RPG_H - 4 };
function rpgGenWorld(seed) {
  const rnd = rpgRng(seed);
  const t = Array.from({ length: RPG_H }, () => Array(RPG_W).fill('.'));
  for (let y = 0; y < RPG_H; y++) for (let x = 0; x < RPG_W; x++) {
    if (x < 2 || y < 2 || x >= RPG_W - 2 || y >= RPG_H - 2) { t[y][x] = 'T'; continue; }
    const p = rpgProgress(x, y); const r = rnd();
    if (p < 0.25) t[y][x] = r < 0.08 ? 'T' : '.';
    else if (p < 0.5) t[y][x] = r < 0.3 ? 'T' : r < 0.55 ? 'f' : '.';
    else if (p < 0.7) t[y][x] = r < 0.12 ? '~' : r < 0.2 ? 'T' : r < 0.45 ? 'f' : '.';
    else if (p < 0.88) t[y][x] = r < 0.12 ? '^' : r < 0.2 ? 'T' : r < 0.75 ? 'm' : '.';
    else t[y][x] = r < 0.1 ? '#' : r < 0.2 ? '^' : 'v';
  }
  // camino seguro de la aldea al volcán
  const target = { x: RPG_W - 6, y: 5 };
  let cx = RPG_START.x, cy = RPG_START.y; const road = [];
  while (cx !== target.x || cy !== target.y) {
    t[cy][cx] = '='; road.push([cx, cy]);
    const dx = target.x - cx, dy = target.y - cy;
    const horiz = Math.abs(dx) > 0 && (Math.abs(dy) === 0 || rnd() < Math.abs(dx) / (Math.abs(dx) + Math.abs(dy)));
    if (horiz) cx += Math.sign(dx); else cy += Math.sign(dy);
    if (rnd() < 0.18) { const wob = rnd() < 0.5 ? -1 : 1; const nx = cx, ny = cy + wob; if (ny > 2 && ny < RPG_H - 3) { t[ny][nx] = '='; road.push([nx, ny]); } }
  }
  t[cy][cx] = '=';
  // pueblos, lair, cofres, npcs
  const clear = (x, y, r) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (t[y + j] && t[y + j][x + i] !== undefined && t[y + j][x + i] !== '=') t[y + j][x + i] = '.'; };
  clear(RPG_START.x, RPG_START.y, 2); t[RPG_START.y][RPG_START.x] = 'H';
  const vil = road[Math.floor(road.length * 0.52)];
  clear(vil[0], vil[1], 1); t[vil[1]][vil[0]] = 'V';
  clear(target.x, target.y, 1); t[target.y - 1][target.x] = 'L'; t[target.y][target.x] = '=';
  for (let j = -2; j <= 0; j++) for (let i = -2; i <= 2; i++) if (!(i === 0 && j === -1) && !(i === 0 && j === 0) && t[target.y + j - 1] && !(j === 0 && i === 0)) { if (t[target.y + j - 1][target.x + i] !== 'L' && j < 0) t[target.y + j - 1][target.x + i] = '#'; }
  t[target.y - 1][target.x] = 'L';
  let placed = 0;
  while (placed < 7) { const x = 3 + Math.floor(rnd() * (RPG_W - 6)), y = 3 + Math.floor(rnd() * (RPG_H - 6)); if (t[y][x] === '.' || t[y][x] === 'f' || t[y][x] === 'v' || t[y][x] === 'm') { if (Math.abs(x - RPG_START.x) + Math.abs(y - RPG_START.y) > 4) { t[y][x] = 'c'; placed++; } } }
  [0.18, 0.4, 0.7].forEach((f, i) => { const p = road[Math.floor(road.length * f)]; const nx = p[0], ny = p[1] - 1; if (t[ny] && t[ny][nx] !== '=' && t[ny][nx] !== 'H' && t[ny][nx] !== 'V') t[ny][nx] = 'N'; else if (t[p[1] + 1] && t[p[1] + 1][p[0]] !== '=') t[p[1] + 1][p[0]] = 'N'; });
  return t.map(r => r.join(''));
}
const rpgMakePlayer = () => ({ hp: 36, maxHp: 36, mp: 10, maxMp: 10, atk: 9, def: 3, lv: 1, xp: 0, xpNext: 24, gold: 20, potions: 2, ethers: 1, weapon: 0, armor: 0 });
const RPG_WEAPONS = [['Daga oxidada', 0, 0], ['Espada de hierro', 4, 60], ['Hoja rúnica', 5, 150], ['Filo del alba', 7, 320]];
const RPG_ARMORS = [['Túnica', 0, 0], ['Cota de cuero', 2, 50], ['Armadura de acero', 3, 140], ['Coraza de dragón', 5, 300]];
const RPG_SPELLS = [{ id: 'fire', name: '🔥 Fuego', mp: 4, lv: 1 }, { id: 'heal', name: '💚 Curar', mp: 5, lv: 1 }, { id: 'bolt', name: '⚡ Rayo', mp: 9, lv: 4 }];

function RpgBtn({ label, onPress, color = C.amber, disabled, wide }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ width: wide ? '100%' : '48%', opacity: disabled ? 0.35 : 1 }}>
      <View style={{ paddingVertical: 12, borderRadius: 14, backgroundColor: alpha(color, 0.16), borderWidth: 2, borderColor: alpha(color, 0.8), alignItems: 'center' }}><Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>{label}</Text></View>
    </Pressable>
  );
}


export function PixelRPG3D({ onExit }) {
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('rpg');
  const [scene, setScene] = useState('menu');          // menu | map | battle | town | over | win
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);
  const holdRef = useRef(null);
  const newWorld = () => { const seed = Math.floor(Math.random() * 1e9); return { seed, world: rpgGenWorld(seed), opened: [] }; };
  const initState = () => { const w = newWorld(); return { ...w, p: rpgMakePlayer(), x: RPG_START.x, y: RPG_START.y, vx: RPG_START.x, vy: RPG_START.y, msg: '¡Bienvenido, aventurero! Derrota al dragón del volcán.', battle: null, menu: false, t: 0, hasSave: false, steps: 0, won: false, shop: null, fdx: 0, fdz: -1, cfx: 0, cfz: -1 }; };
  if (!g.current) g.current = initState();
  const scoreOf = s => s.p.lv * 100 + s.p.gold + (s.won ? 1000 : 0);
  const save = s => { AsyncStorage.setItem(RPG_SAVE_KEY, JSON.stringify({ seed: s.seed, opened: s.opened, p: s.p, x: s.x, y: s.y, won: s.won })).catch(() => {}); };
  useEffect(() => {
    AsyncStorage.getItem(RPG_SAVE_KEY).then(v => { if (v) { try { const d = JSON.parse(v); g.current.save = d; g.current.hasSave = true; force(); } catch (e) {} } }).catch(() => {});
  }, []);
  const newGame = () => { fx.clear(); AsyncStorage.removeItem(RPG_SAVE_KEY).catch(() => {}); g.current = initState(); setScene('map'); };
  const continueGame = () => {
    const d = g.current.save; if (!d) return newGame();
    const world = rpgGenWorld(d.seed).map(r => r.split(''));
    d.opened.forEach(([x, y]) => { world[y][x] = '.'; });
    const s = initState(); Object.assign(s, { seed: d.seed, world: world.map(r => r.join('')), opened: d.opened, p: { ...rpgMakePlayer(), ...d.p }, x: d.x, y: d.y, vx: d.x, vy: d.y, won: !!d.won, msg: 'Partida cargada.', hasSave: true });
    g.current = s; setScene('map');
  };
  const levelUp = (s, cx, cy) => {
    const p = s.p; let up = 0;
    while (p.xp >= p.xpNext) { p.xp -= p.xpNext; p.lv += 1; p.maxHp += 10; p.maxMp += 3; p.atk += 2; p.def += 1; p.xpNext = Math.floor(p.xpNext * 1.42) + 4; p.hp = p.maxHp; p.mp = p.maxMp; up += 1; }
    if (up) { fx.pop(cx, cy, `¡NIVEL ${p.lv}!`, C.amber, 26); fx.flash(C.amber, 0.3); hx.win(); const sp = RPG_SPELLS.find(q => q.lv === p.lv && q.lv > 1); if (sp) s.battle && (s.battle.log = `✨ ¡Aprendiste ${sp.name}!`); submitBest(scoreOf(s)); }
    return up;
  };
  const startBattle = (s, enemy, boss) => {
    const sc = boss ? 1 : 1 + Math.max(0, s.p.lv - 6) * 0.04;
    s.battle = { enemy, hp: Math.round(enemy.hp * sc), max: Math.round(enemy.hp * sc), atk: Math.round(enemy.atk * sc), turn: 'player', log: boss ? '¡El dragón ruge desde el volcán!' : `¡Un ${enemy.name} salvaje aparece!`, count: 0, charging: false, defending: false, spellMenu: false, t: 0, hit: 0, boss: !!boss };
    fx.flash('#fff', 0.5); fx.shake(6, 0.3); hx.warn();
    setScene('battle');
  };
  const tryMove = (dx, dy) => {
    const s = g.current;
    if (scene !== 'map') return;
    const nx = s.x + dx, ny = s.y + dy;
    if (nx < 0 || ny < 0 || nx >= RPG_W || ny >= RPG_H) return;
    const ch = s.world[ny][nx]; const d = RPG_TILE[ch];
    if (d.block) return;
    if (ch === 'L') { if (s.p.lv < 5) { s.msg = '🔥 Una fuerza ardiente te repele. Necesitas ser al menos nivel 5.'; hx.warn(); return; } s.x = nx; s.y = ny; startBattle(s, RPG_BOSS, true); return; }
    s.x = nx; s.y = ny; s.fdx = dx; s.fdz = dy; s.steps += 1; hx.tick();
    if (ch === 'H' || ch === 'V') { s.msg = ch === 'H' ? 'Llegaste a Aldea Luminar.' : 'Llegaste al Fuerte del Camino.'; later(() => { setScene('town'); }, 220); save(s); return; }
    if (ch === 'c') { const gold = randInt(15, 40) + s.p.lv * 4; s.p.gold += gold; const pot = Math.random() < 0.5; if (pot) s.p.potions += 1; s.opened.push([nx, ny]); const row = s.world[ny].split(''); row[nx] = '.'; s.world[ny] = row.join(''); s.msg = `📦 ¡Cofre! +${gold} 💰${pot ? ' y una poción 🧪' : ''}`; hx.good(); save(s); return; }
    if (ch === 'N') { s.msg = pick(RPG_HINTS); return; }
    const z = rpgZone(nx, ny);
    const enc = ch === '=' ? 0 : z.enc;
    s.msg = ch === '=' ? '🛤️ Camino seguro.' : `${z.name} · cuidado con los monstruos`;
    if (Math.random() < enc) { later(() => startBattle(s, RPG_ENEMIES[pick(z.pool)], false), 180); }
    else if (s.steps % 6 === 0) save(s);
  };
  // ── batalla
  const dmgNum = (txt, color, onEnemy) => fx.pop(onEnemy ? AREA_W / 2 : AREA_W / 2, onEnemy ? 150 : AREA_H - 210, txt, color, 26);
  const endBattle = (s, won) => {
    const b = s.battle;
    if (won) {
      s.p.xp += b.boss ? RPG_BOSS.xp : b.enemy.xp; const gold = b.enemy.gold; s.p.gold += gold;
      fx.burst(AREA_W / 2, 150, C.amber, 30, 300, 0.9, 6); hx.win();
      const up = levelUp(s, AREA_W / 2, 220);
      if (b.boss) { s.won = true; save(s); setRes2(s); setScene('win'); s.battle = null; return; }
      s.msg = `Derrotaste al ${b.enemy.name}: +${b.enemy.xp} XP +${gold} 💰${up ? ' · ¡subiste de nivel!' : ''}`;
      s.battle = null; save(s); setScene('map');
    } else {
      s.p.gold = Math.floor(s.p.gold / 2); s.p.hp = Math.ceil(s.p.maxHp / 2); s.p.mp = s.p.maxMp; s.x = RPG_START.x; s.y = RPG_START.y; s.vx = s.x; s.vy = s.y;
      s.msg = 'Caíste en combate… despiertas en la aldea con la mitad del oro.'; s.battle = null; hx.die(); save(s); setScene('over');
    }
  };
  const setRes2 = s => { submitBest(scoreOf(s)); };
  const enemyTurn = () => {
    const s = g.current; const b = s.battle; if (!b) return;
    b.count += 1;
    let dmg = 0; let text;
    if (b.charging) {
      dmg = Math.round(b.atk * (b.boss ? 2.2 : 1.9)); text = `${b.enemy.e} ¡descarga un ataque brutal!`; b.charging = false;
    } else if (b.count % 3 === 0 || (b.boss && b.count % 2 === 0)) {
      b.charging = true; text = `${b.enemy.e} ${b.boss ? 'inhala fuego…' : 'prepara un golpe fuerte…'} ¡Defiéndete!`;
    } else { dmg = Math.max(1, Math.round(b.atk - s.p.def * 0.6 + randInt(-1, 3))); text = `${b.enemy.e} ${b.enemy.name} ataca.`; }
    if (dmg > 0) {
      if (b.defending) dmg = Math.max(1, Math.round(dmg * 0.35));
      dmg = Math.max(1, dmg - Math.floor(s.p.def * 0.3));
      s.p.hp = Math.max(0, s.p.hp - dmg); dmgNum(`-${dmg}`, C.red, false); fx.shake(6, 0.2); fx.flash(C.red, 0.2); hx.bad();
      text += ` Recibes ${dmg}.`;
    }
    b.defending = false; b.log = text;
    if (s.p.hp <= 0) { later(() => endBattle(s, false), 700); force(); return; }
    b.turn = 'player'; force();
  };
  const finishPlayerAction = (s, log) => {
    const b = s.battle; b.log = log;
    if (b.hp <= 0) { b.hp = 0; force(); later(() => endBattle(s, true), 700); return; }
    b.turn = 'enemy'; force();
    later(enemyTurn, 800);
  };
  const act = a => {
    const s = g.current; const b = s.battle; const p = s.p;
    if (!b || b.turn !== 'player') return;
    b.spellMenu = false;
    if (a === 'attack') {
      const crit = Math.random() < 0.15; let dmg = p.atk + randInt(0, 3); if (crit) dmg *= 2;
      b.hp -= dmg; b.hit = 0.25; dmgNum(`${crit ? '💥' : ''}${dmg}`, crit ? C.amber : C.text, true); fx.burst(AREA_W / 2, 150, crit ? C.amber : '#fff', 10, 220); hx.hit();
      finishPlayerAction(s, `Atacas por ${dmg}${crit ? ' (¡CRÍTICO!)' : ''}.`);
    } else if (a === 'defend') {
      b.defending = true; p.mp = Math.min(p.maxMp, p.mp + 2); fx.ring(AREA_W / 2, AREA_H - 210, C.cyan, 60); hx.tap();
      finishPlayerAction(s, '🛡️ Te proteges y recuperas 2 MP.');
    } else if (a === 'potion') {
      if (p.potions <= 0) { b.log = 'No tienes pociones.'; force(); return; }
      const heal = Math.round(p.maxHp * 0.45); p.hp = Math.min(p.maxHp, p.hp + heal); p.potions -= 1; dmgNum(`+${heal}`, C.lime, false); hx.good();
      finishPlayerAction(s, `🧪 Bebes una poción (+${heal} HP).`);
    } else if (a === 'ether') {
      if (p.ethers <= 0) { b.log = 'No tienes éter.'; force(); return; }
      p.mp = Math.min(p.maxMp, p.mp + 10); p.ethers -= 1; dmgNum('+10 MP', C.cyan, false); hx.good();
      finishPlayerAction(s, '💧 Recuperas 10 MP.');
    } else if (a === 'run') {
      if (b.boss) { b.log = '¡No puedes huir del dragón!'; force(); return; }
      if (Math.random() < 0.55) { s.battle = null; s.msg = 'Escapaste.'; setScene('map'); hx.tick(); return; }
      finishPlayerAction(s, 'No lograste escapar…');
    } else if (a === 'spell') { b.spellMenu = true; force(); }
  };
  const cast = id => {
    const s = g.current; const b = s.battle; const p = s.p; const sp = RPG_SPELLS.find(q => q.id === id);
    if (!b || b.turn !== 'player') return;
    if (p.mp < sp.mp) { b.log = 'No tienes suficiente MP.'; force(); return; }
    p.mp -= sp.mp; b.spellMenu = false;
    if (id === 'heal') { const heal = Math.round(p.maxHp * 0.4); p.hp = Math.min(p.maxHp, p.hp + heal); dmgNum(`+${heal}`, C.lime, false); fx.ring(AREA_W / 2, AREA_H - 210, C.lime, 70); hx.good(); finishPlayerAction(s, `💚 Te curas ${heal} HP.`); return; }
    const dmg = Math.round(p.atk * (id === 'fire' ? 1.9 : 2.8) + randInt(1, 5));
    b.hp -= dmg; b.hit = 0.3; dmgNum(`${dmg}`, id === 'fire' ? C.orange : C.cyan, true); fx.burst(AREA_W / 2, 150, id === 'fire' ? C.orange : C.cyan, 26, 300, 0.8, 6); fx.ring(AREA_W / 2, 150, id === 'fire' ? C.orange : C.cyan, 80); fx.shake(5, 0.2); hx.heavy();
    finishPlayerAction(s, `${sp.name}: ${dmg} de daño.`);
  };
  // ── pueblo
  const buy = what => {
    const s = g.current; const p = s.p;
    const spend = c => { if (p.gold < c) { s.shop = 'No tienes suficiente oro.'; hx.bad(); return false; } p.gold -= c; hx.good(); return true; };
    if (what === 'potion' && spend(15)) { p.potions += 1; s.shop = '🧪 Poción comprada.'; }
    if (what === 'ether' && spend(25)) { p.ethers += 1; s.shop = '💧 Éter comprado.'; }
    if (what === 'weapon') { const nx = RPG_WEAPONS[p.weapon + 1]; if (nx && spend(nx[2])) { p.weapon += 1; p.atk += nx[1]; s.shop = `⚔️ ¡Equipas ${nx[0]}!`; } }
    if (what === 'armor') { const nx = RPG_ARMORS[p.armor + 1]; if (nx && spend(nx[2])) { p.armor += 1; p.def += nx[1]; s.shop = `🛡️ ¡Equipas ${nx[0]}!`; } }
    save(s); force();
  };
  const rest = () => { const s = g.current; s.p.hp = s.p.maxHp; s.p.mp = s.p.maxMp; s.shop = '🛏️ Descansas y recuperas todo.'; fx.flash(C.lime, 0.2); hx.good(); save(s); force(); };

  // ── animación del mapa
  useLoop(scene === 'map' || scene === 'battle', dt => {
    const s = g.current; s.t += dt;
    s.vx += (s.x - s.vx) * Math.min(1, dt * 14); s.vy += (s.y - s.vy) * Math.min(1, dt * 14);
    s.cfx += (s.fdx - s.cfx) * Math.min(1, dt * 7); s.cfz += (s.fdz - s.cfz) * Math.min(1, dt * 7);
    if (s.battle) { s.battle.t += dt; if (s.battle.hit > 0) s.battle.hit -= dt; }
  });
  const pan = usePan(fx, {
    down: () => { g.current.used = false; },
    move: (x, y, gs) => { const s = g.current; if (s.used || scene !== 'map') return; if (Math.abs(gs.dx) > 24 || Math.abs(gs.dy) > 24) { s.used = true; if (Math.abs(gs.dx) > Math.abs(gs.dy)) tryMove(gs.dx > 0 ? 1 : -1, 0); else tryMove(0, gs.dy > 0 ? 1 : -1); } },
  });
  const startHold = (dx, dy) => { tryMove(dx, dy); clearInterval(holdRef.current); holdRef.current = setInterval(() => tryMove(dx, dy), 170); };
  const stopHold = () => { clearInterval(holdRef.current); holdRef.current = null; };
  useEffect(() => () => clearInterval(holdRef.current), []);

  const s = g.current; const p = s.p; const b = s.battle;
  const BarRow = (label, v, m, col) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={{ color: col, fontSize: 10, fontWeight: '900', width: 18 }}>{label}</Text><Bar value={v} max={m} color={col} h={8} w={90} /><Text style={{ color: C.dim, fontSize: 10 }}>{v}/{m}</Text></View>;
  const scene3 = scene === 'battle' && b ? rpgBattleScene(b) : rpgMapScene(s);
  return (
    <GameScreen title="PIXEL RPG 3D" emoji="🧙" accent={C.amber} onExit={onExit} score={scoreOf(s)} best={best} scoreLabel="PUNTOS"
      hud={scene === 'menu' ? null : <>{BarRow('HP', p.hp, p.maxHp, C.red)}{BarRow('MP', p.mp, p.maxMp, C.cyan)}<Text style={{ color: C.amber, fontWeight: '900', fontSize: 12 }}>Nv.{p.lv}</Text></>}>
      <PlayArea fx={fx} bg="#0a0803" border={alpha(C.amber, 0.4)} {...(scene === 'map' ? pan : {})}>
        <World3D scene={scene3} />
        {scene === 'map' && (
          <>
            <View pointerEvents="none" style={{ position: 'absolute', left: 10, right: 10, top: 8, padding: 8, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)' }}>
              <Text numberOfLines={3} style={{ color: C.amber, fontSize: 12, lineHeight: 16 }}>{s.msg}</Text>
            </View>
            <View style={{ position: 'absolute', left: 14, bottom: 14, gap: 6 }}>
              <Text style={{ color: C.dim, fontSize: 11 }}>💰 {p.gold}  🧪 {p.potions}  💧 {p.ethers}</Text>
              <Text style={{ color: C.dim, fontSize: 11 }}>XP {p.xp}/{p.xpNext}  ⚔️ {p.atk}  🛡️ {p.def}</Text>
              <Text style={{ color: alpha(C.dim, 0.8), fontSize: 10 }}>Desliza o usa la cruz</Text>
            </View>
            <View pointerEvents="box-none" style={{ position: 'absolute', right: 14, bottom: 12, width: 56 * 3 + 12, height: 56 * 3 + 6 }}>
              <RpgPad testID="dp-▲" label="▲" onDown={() => startHold(0, -1)} onUp={stopHold} style={{ position: 'absolute', left: 56 + 6, top: 0 }} />
              <RpgPad testID="dp-◀" label="◀" onDown={() => startHold(-1, 0)} onUp={stopHold} style={{ position: 'absolute', left: 0, top: 56 + 3 }} />
              <RpgPad testID="dp-▶" label="▶" onDown={() => startHold(1, 0)} onUp={stopHold} style={{ position: 'absolute', left: (56 + 6) * 2, top: 56 + 3 }} />
              <RpgPad testID="dp-▼" label="▼" onDown={() => startHold(0, 1)} onUp={stopHold} style={{ position: 'absolute', left: 56 + 6, top: (56 + 3) * 2 }} />
            </View>
          </>
        )}
        {scene === 'battle' && b && (
          <View style={{ flex: 1 }}>
            <View pointerEvents="none" style={{ position: 'absolute', top: 12, left: 0, right: 0, alignItems: 'center' }}>
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '900', letterSpacing: 1, ...tglow('#000', 6) }}>{b.enemy.name}</Text>
              <Bar value={b.hp} max={b.max} color={C.red} h={12} w={AREA_W * 0.6} style={{ marginTop: 6 }} />
              <Text style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>{Math.max(0, b.hp)} / {b.max}</Text>
            </View>
            <View pointerEvents="none" style={{ position: 'absolute', left: 14, right: 14, top: 150, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: alpha(C.amber, 0.3), minHeight: 56, justifyContent: 'center' }}>
              <Text style={{ color: b.charging ? C.red : C.text, fontSize: 14, lineHeight: 19 }}>{b.log}</Text>
            </View>
            <View style={{ position: 'absolute', left: 14, right: 14, bottom: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>{BarRow('HP', p.hp, p.maxHp, C.red)}{BarRow('MP', p.mp, p.maxMp, C.cyan)}</View>
              {b.turn === 'player' && !b.spellMenu && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                  <RpgBtn label="⚔️ Atacar" onPress={() => act('attack')} color={C.red} />
                  <RpgBtn label="✨ Magia" onPress={() => act('spell')} color={C.violet} />
                  <RpgBtn label="🛡️ Defender" onPress={() => act('defend')} color={C.cyan} />
                  <RpgBtn label={`🧪 Poción (${p.potions})`} onPress={() => act('potion')} color={C.lime} />
                  <RpgBtn label={`💧 Éter (${p.ethers})`} onPress={() => act('ether')} color={C.blue} />
                  <RpgBtn label="🏃 Huir" onPress={() => act('run')} color={C.dim} />
                </View>
              )}
              {b.turn === 'player' && b.spellMenu && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                  {RPG_SPELLS.filter(q => p.lv >= q.lv).map(q => <RpgBtn key={q.id} label={`${q.name} · ${q.mp} MP`} onPress={() => cast(q.id)} color={C.violet} disabled={p.mp < q.mp} />)}
                  <RpgBtn label="← Volver" onPress={() => { b.spellMenu = false; force(); }} color={C.dim} wide />
                </View>
              )}
              {b.turn === 'enemy' && <Text style={{ color: C.dim, textAlign: 'center', paddingVertical: 14 }}>Turno del enemigo…</Text>}
            </View>
          </View>
        )}
        {scene === 'town' && (
          <View style={{ flex: 1, padding: 18, alignItems: 'center', backgroundColor: 'rgba(8,6,4,0.84)' }}>
            <Text style={{ fontSize: 54, marginTop: 6 }}>🏘️</Text>
            <Text style={{ color: C.amber, fontSize: 22, fontWeight: '900', letterSpacing: 1 }}>TIENDA Y POSADA</Text>
            <Text style={{ color: C.dim, fontSize: 12, marginVertical: 6, textAlign: 'center' }}>💰 {p.gold}  ·  🧪 {p.potions}  ·  💧 {p.ethers}  ·  ⚔️ {p.atk}  ·  🛡️ {p.def}</Text>
            <Text style={{ color: C.lime, fontSize: 12, minHeight: 18, marginBottom: 8 }}>{s.shop || ' '}</Text>
            <View style={{ width: '100%', gap: 8 }}>
              <RpgBtn wide label="🛏️ Descansar (gratis): HP y MP al máximo" onPress={rest} color={C.lime} />
              <RpgBtn wide label="🧪 Poción · 15 💰" onPress={() => buy('potion')} color={C.red} />
              <RpgBtn wide label="💧 Éter · 25 💰" onPress={() => buy('ether')} color={C.blue} />
              <RpgBtn wide label={RPG_WEAPONS[p.weapon + 1] ? `⚔️ ${RPG_WEAPONS[p.weapon + 1][0]} (+${RPG_WEAPONS[p.weapon + 1][1]} ATK) · ${RPG_WEAPONS[p.weapon + 1][2]} 💰` : '⚔️ Arma al máximo'} onPress={() => buy('weapon')} color={C.orange} disabled={!RPG_WEAPONS[p.weapon + 1]} />
              <RpgBtn wide label={RPG_ARMORS[p.armor + 1] ? `🛡️ ${RPG_ARMORS[p.armor + 1][0]} (+${RPG_ARMORS[p.armor + 1][1]} DEF) · ${RPG_ARMORS[p.armor + 1][2]} 💰` : '🛡️ Armadura al máximo'} onPress={() => buy('armor')} color={C.cyan} disabled={!RPG_ARMORS[p.armor + 1]} />
            </View>
            <View style={{ marginTop: 16 }}><Btn label="SALIR AL MAPA" color={C.amber} onPress={() => { s.shop = null; setScene('map'); }} /></View>
          </View>
        )}
        <Overlay show={scene === 'menu'} kind="start" emoji="🧙" title="PIXEL RPG 3D" subtitle="Explora un mundo nuevo cada partida y derrota al Dragón Ancestral"
          accent={C.amber} startLabel={s.hasSave ? 'NUEVA PARTIDA' : 'JUGAR'} onStart={newGame} onExit={onExit}
          extra={s.hasSave ? <View style={{ marginTop: 14 }}><Btn label="CONTINUAR" ghost color={C.amber} onPress={continueGame} /></View> : null}
          lines={['Explora un mapa 3D, recoge cofres y combate por turnos', 'Compra equipo en las aldeas · Nivel 5 para el volcán', 'Defiende cuando el enemigo "carga" un golpe']} />
        <Overlay show={scene === 'over'} kind="over" emoji="💀" title="DERROTADO" subtitle={s.msg} score={scoreOf(s)} best={best} accent={C.red} startLabel="SEGUIR" onStart={() => setScene('map')} onExit={onExit} />
        <Overlay show={scene === 'win'} kind="win" emoji="🏆" title="¡DRAGÓN DERROTADO!" subtitle={`Nivel ${p.lv} · ${p.gold} 💰. La región vuelve a la paz.`} score={scoreOf(s)} best={best} isNew accent={C.amber} startLabel="NUEVA AVENTURA" onStart={newGame} onExit={onExit} />
      </PlayArea>
    </GameScreen>
  );
}
