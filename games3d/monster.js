/**
 * Monster Duel 3D – mundo abierto con criaturas, capturas y combates por turnos con vista 3D.
 * Explorar: recorre un mapa 3D (hierba alta, agua, árboles, rocas). Las criaturas vagan: tócalas para
 * combatir, o camina por la hierba alta para encuentros aleatorios. Cuando ganas suficientes combates
 * aparece un líder (faro dorado) que hay que alcanzar. El combate usa las reglas 2D y se ve en 3D.
 */
import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AREA_W, AREA_H, C, Bar, Btn, GameScreen, Overlay, PlayArea, TouchStick, alpha, clamp, hx, pick, rand, randInt, tglow, uid, useBest, useFX, useLoop, useTimeouts } from '../utils/kit';
import { World3D } from '../utils/World3D';

// ─── Mundo abierto ───
const MD_W = 28, MD_H = 28;
const MDT = { GRASS: 0, TALL: 1, TREE: 2, ROCK: 3, WATER: 4 };
const mdTile = (map, x, z) => (x < 0 || z < 0 || x >= MD_W || z >= MD_H ? MDT.ROCK : map[Math.floor(z)][Math.floor(x)]);
// ¿puede estar el jugador (radio r) en (x, z)?
const mdFree = (map, x, z, r = 0.28) => [[-r, -r], [r, -r], [-r, r], [r, r]].every(([dx, dz]) => {
  const t = mdTile(map, x + dx, z + dz); return t !== MDT.TREE && t !== MDT.ROCK && t !== MDT.WATER;
});
const mdSpawnWild = w => {
  for (let t = 0; t < 200; t++) {
    const x = Math.random() * MD_W, z = Math.random() * MD_H;
    if (mdFree(w.map, x, z, 0.3) && Math.hypot(x - w.ax, z - w.az) > 5) return { uid: uid(), sp: randInt(0, MD_MONSTERS.length - 1), x, z, t: rand(0.5, 2), vx: 0, vz: 0 };
  }
  return null;
};
const mdSpawnLeader = w => {
  for (let t = 0; t < 300; t++) {
    const x = Math.random() * MD_W, z = Math.random() * MD_H;
    if (mdFree(w.map, x, z, 0.35) && Math.hypot(x - w.ax, z - w.az) > 9) return { x, z };
  }
  return { x: MD_W - 3.5, z: MD_H - 3.5 };
};
function mdNewWorld() {
  const map = Array.from({ length: MD_H }, () => Array(MD_W).fill(MDT.GRASS));
  const blob = (cx, cz, r, t) => {
    for (let z = cz - r - 1; z <= cz + r + 1; z++) for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      if (x >= 0 && z >= 0 && x < MD_W && z < MD_H && (x - cx) ** 2 + (z - cz) ** 2 <= r * r + Math.random() * 2) map[z][x] = t;
    }
  };
  for (let i = 0; i < 9; i++) blob(randInt(3, MD_W - 4), randInt(3, MD_H - 4), randInt(1, 2), MDT.TALL);
  for (let i = 0; i < 3; i++) blob(randInt(4, MD_W - 5), randInt(4, MD_H - 5), randInt(1, 2), MDT.WATER);
  for (let z = 0; z < MD_H; z++) for (let x = 0; x < MD_W; x++) {
    const r = Math.random();
    if (map[z][x] === MDT.GRASS && r < 0.08) map[z][x] = MDT.TREE;
    else if (map[z][x] === MDT.GRASS && r < 0.11) map[z][x] = MDT.ROCK;
  }
  const sx = MD_W / 2, sz = MD_H / 2;
  for (let z = sz - 3; z <= sz + 2; z++) for (let x = sx - 3; x <= sx + 2; x++) map[z][x] = MDT.GRASS; // zona de inicio despejada
  const w = { map, ax: sx + 0.5, az: sz + 0.5, h: 0, walk: 0, t: 0, wild: [], leader: null };
  for (let i = 0; i < 7; i++) { const c = mdSpawnWild(w); if (c) w.wild.push(c); }
  return w;
}
// Avanza el mundo: movimiento con el joystick, hierba alta, criaturas que vagan y encuentros
function mdStep(w, stick, dt, wantLeader) {
  const ev = {};
  w.t += dt;
  const len = stick.on ? Math.hypot(stick.x, stick.y) : 0;
  if (len > 0.08) {
    const ux = stick.x / len, uz = stick.y / len; const sp = 3.2 * Math.min(1, len) * dt;
    const nx = w.ax + ux * sp, nz = w.az + uz * sp; let moved = 0;
    if (mdFree(w.map, nx, w.az)) { moved += Math.abs(nx - w.ax); w.ax = nx; }
    if (mdFree(w.map, w.ax, nz)) { moved += Math.abs(nz - w.az); w.az = nz; }
    let dh = Math.atan2(ux, uz) - w.h; dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI; w.h += dh * Math.min(1, dt * 10);
    if (mdTile(w.map, w.ax, w.az) === MDT.TALL) { w.walk += moved; if (w.walk > 1.8) { w.walk = 0; ev.grass = true; } }
  }
  for (const c of w.wild) {
    c.t -= dt;
    if (c.t <= 0) { c.t = rand(0.8, 2.2); const a = Math.random() * Math.PI * 2; c.vx = Math.cos(a) * 0.7; c.vz = Math.sin(a) * 0.7; }
    const nx = c.x + c.vx * dt, nz = c.z + c.vz * dt;
    if (mdFree(w.map, nx, nz, 0.3)) { c.x = nx; c.z = nz; } else c.t = 0;
    if (!ev.wild && Math.hypot(c.x - w.ax, c.z - w.az) < 1.0) ev.wild = c;
  }
  if (w.leader) { if (Math.hypot(w.leader.x - w.ax, w.leader.z - w.az) < 1.5) ev.leader = true; } else if (wantLeader) w.leader = mdSpawnLeader(w);
  return ev;
}
// Escena 3D del mapa: cámara detrás del entrenador, siguiendo su dirección
function mdWorldScene(w) {
  const objs = [];
  const tx = Math.floor(w.ax), tz = Math.floor(w.az); const R = 9;
  objs.push({ id: 'suelo', k: 'pla', p: [MD_W / 2, 0, MD_H / 2], s: [MD_W + 14, MD_H + 14, 1], c: '#3f8f4c' });
  for (let z = tz - R; z <= tz + R; z++) for (let x = tx - R; x <= tx + R; x++) {
    if (x < 0 || z < 0 || x >= MD_W || z >= MD_H) continue;
    const t = w.map[z][x];
    if (t === MDT.WATER) objs.push({ id: `a${x}_${z}`, k: 'pla', p: [x + 0.5, 0.02, z + 0.5], s: [1, 1, 1], c: '#2d7dd2', e: 0.12 });
    else if (t === MDT.TALL) objs.push({ id: `g${x}_${z}`, k: 'pla', p: [x + 0.5, 0.03, z + 0.5], s: [1, 1, 1], c: '#2b6e36' });
    else if (t === MDT.TREE) {
      objs.push({ id: `tt${x}_${z}`, k: 'cyl', p: [x + 0.5, 0.45, z + 0.5], s: [0.3, 0.9, 0.3], c: '#7a4a2a' });
      objs.push({ id: `tc${x}_${z}`, k: 'cone', p: [x + 0.5, 1.45, z + 0.5], s: [1.1, 1.4, 1.1], c: '#2e8b3e' });
    } else if (t === MDT.ROCK) objs.push({ id: `r${x}_${z}`, k: 'box', p: [x + 0.5, 0.35, z + 0.5], s: [0.9, 0.7, 0.9], r: [0, ((x * 7 + z * 3) % 5) * 0.5, 0], c: '#7c7f8a' });
  }
  w.wild.forEach(c => {
    if (Math.abs(c.x - w.ax) > R + 1 || Math.abs(c.z - w.az) > R + 1) return;
    const col = MD_TC[MD_MONSTERS[c.sp].type]; const bob = Math.abs(Math.sin(w.t * 6 + c.uid)) * 0.14;
    objs.push({ id: `c${c.uid}`, k: 'sph', p: [c.x, 0.45 + bob, c.z], n: 0.85, c: col, e: 0.15 });
    objs.push({ id: `ch${c.uid}`, k: 'cone', p: [c.x, 1.05 + bob, c.z], s: [0.28, 0.45, 0.28], c: col, e: 0.15 });
  });
  if (w.leader) {
    const L = w.leader;
    objs.push({ id: 'lider', k: 'box', p: [L.x, 0.5, L.z], s: [0.6, 1.0, 0.5], c: C.amber, e: 0.2 });
    objs.push({ id: 'lidercab', k: 'sph', p: [L.x, 1.25, L.z], n: 0.5, c: '#ffd9b0' });
    objs.push({ id: 'liderfaro', k: 'cyl', p: [L.x, 4, L.z], s: [0.14, 8, 0.14], c: C.amber, e: 0.9, o: 0.4 });
  }
  // entrenador
  objs.push({ id: 'pb', k: 'box', p: [w.ax, 0.35, w.az], s: [0.5, 0.7, 0.5], r: [0, w.h, 0], c: '#3a7bff' });
  objs.push({ id: 'ph', k: 'sph', p: [w.ax, 0.85, w.az], n: 0.42, c: '#ffd9b0' });
  objs.push({ id: 'pc', k: 'box', p: [w.ax, 1.12, w.az], s: [0.46, 0.1, 0.46], r: [0, w.h, 0], c: '#ff3b3b' });
  const fx = Math.sin(w.h), fz = Math.cos(w.h);
  const cam = { p: [w.ax - fx * 6.2, 3.7, w.az - fz * 6.2], l: [w.ax + fx * 1.2, 0.6, w.az + fz * 1.2], fov: 58 };
  return { bg: '#9fdcff', fog: { c: '#c5ebff', near: 14, far: 34 }, objs, cam };
}
// Criatura en 3D: cuerpo según familia (id % 4), color del tipo, ojos al frente
function mdMonster(pre, m, pos, o) {
  const col = o.hit ? '#ffffff' : MD_TC[m.type]; const em = o.hit ? 0.9 : 0.18;
  const x = pos[0] + (o.hit ? (Math.random() - 0.5) * 0.25 : 0), y = pos[1] + Math.sin(o.t * 3) * 0.06 + (o.faint ? -0.6 : 0), z = pos[2];
  const op = o.faint ? 0.25 : 1; const fam = m.id % 4; const out = [];
  const add = (id, k, p, extra) => out.push({ id: `${pre}${id}`, k, p, c: col, e: em, o: op, ...extra });
  if (fam === 0) { add('b', 'sph', [x, y + 0.95, z], { n: 1.4 }); add('h1', 'cone', [x - 0.5, y + 1.95, z], { s: [0.3, 0.7, 0.3] }); add('h2', 'cone', [x + 0.5, y + 1.95, z], { s: [0.3, 0.7, 0.3] }); }
  else if (fam === 1) { add('b', 'box', [x, y + 0.75, z], { s: [1.4, 1.2, 1.2] }); add('h1', 'box', [x - 0.5, y + 1.65, z], { s: [0.25, 0.5, 0.25] }); add('h2', 'box', [x + 0.5, y + 1.65, z], { s: [0.25, 0.5, 0.25] }); }
  else if (fam === 2) { add('b', 'sph', [x, y + 1.05, z], { n: 1.3 }); add('l1', 'cyl', [x - 0.4, y + 0.35, z], { s: [0.25, 0.7, 0.25] }); add('l2', 'cyl', [x + 0.4, y + 0.35, z], { s: [0.25, 0.7, 0.25] }); }
  else add('b', 'cone', [x, y + 0.95, z], { s: [1.3, 1.9, 1.3] });
  const ez = fam === 3 ? 0.5 : 0.62;
  out.push({ id: `${pre}e1`, k: 'sph', p: [x - 0.3, y + 1.1, z + ez], n: 0.26, c: '#ffffff', o: op });
  out.push({ id: `${pre}e2`, k: 'sph', p: [x + 0.3, y + 1.1, z + ez], n: 0.26, c: '#ffffff', o: op });
  out.push({ id: `${pre}p1`, k: 'sph', p: [x - 0.3, y + 1.1, z + ez + 0.1], n: 0.12, c: '#101018', o: op });
  out.push({ id: `${pre}p2`, k: 'sph', p: [x + 0.3, y + 1.1, z + ez + 0.1], n: 0.12, c: '#101018', o: op });
  return out;
}
// Escena 3D del combate: arena con los dos monstruos frente a frente
function mdBattleScene(b, p, f) {
  const objs = [{ id: 'arena', k: 'pla', p: [0, 0, -0.5], s: [14, 12, 1], c: '#2a4d33' }];
  mdMonster('p', p, [-0.9, 0, 0.6], { hit: b.ahit > 0, faint: p.hp <= 0, t: b.t }).forEach(o => objs.push(o));
  mdMonster('f', f, [1.0, 0, -2.0], { hit: b.hit > 0, faint: f.hp <= 0, t: b.t }).forEach(o => objs.push(o));
  return { bg: '#0a1220', objs, cam: { p: [0, 4.6, 6.6], l: [0, 0.6, -1.0], fov: 52 } };
}

const MD_MONSTERS = [
  { id: 0, name: 'FLAMECAT', e: '🐱', type: 'fire', hp: 45, atk: 15, def: 9, evo: 1, evoLvl: 16 },
  { id: 1, name: 'BLAZELION', e: '🦁', type: 'fire', hp: 70, atk: 25, def: 14, evo: -1 },
  { id: 2, name: 'AQUAPUP', e: '🐶', type: 'water', hp: 44, atk: 13, def: 11, evo: 3, evoLvl: 16 },
  { id: 3, name: 'TIDEWOLF', e: '🐺', type: 'water', hp: 68, atk: 22, def: 17, evo: -1 },
  { id: 4, name: 'SPROUTLING', e: '🌱', type: 'grass', hp: 45, atk: 12, def: 12, evo: 5, evoLvl: 16 },
  { id: 5, name: 'THORNWOOD', e: '🌲', type: 'grass', hp: 66, atk: 19, def: 20, evo: -1 },
  { id: 6, name: 'ZAPPYMOLE', e: '🐹', type: 'electric', hp: 38, atk: 20, def: 7, evo: 7, evoLvl: 18 },
  { id: 7, name: 'VOLTFANG', e: '🦔', type: 'electric', hp: 58, atk: 31, def: 11, evo: -1 },
  { id: 8, name: 'FROSTBEAR', e: '🐻', type: 'ice', hp: 60, atk: 20, def: 18, evo: -1 },
  { id: 9, name: 'SHADOWFOX', e: '🦊', type: 'dark', hp: 42, atk: 22, def: 9, evo: -1 },
  { id: 10, name: 'AEROBIRD', e: '🐦', type: 'flying', hp: 38, atk: 17, def: 9, evo: 11, evoLvl: 20 },
  { id: 11, name: 'STORMROC', e: '🦅', type: 'flying', hp: 60, atk: 28, def: 13, evo: -1 },
  { id: 12, name: 'INKOCTUS', e: '🐙', type: 'water', hp: 40, atk: 16, def: 11, evo: -1 },
  { id: 13, name: 'BLAZESTEED', e: '🐴', type: 'fire', hp: 60, atk: 24, def: 12, evo: -1 },
  { id: 14, name: 'STONEGUARD', e: '🦏', type: 'rock', hp: 70, atk: 16, def: 25, evo: -1 },
];
const MD_MULT = {
  fire: { grass: 2, ice: 2, water: 0.5, rock: 0.5, fire: 0.5 }, water: { fire: 2, rock: 2, grass: 0.5, water: 0.5 },
  grass: { water: 2, rock: 2, fire: 0.5, grass: 0.5, flying: 0.5 }, electric: { water: 2, flying: 2, grass: 0.5, electric: 0.5 },
  rock: { fire: 2, flying: 2, ice: 2, water: 0.5, grass: 0.5 }, ice: { grass: 2, flying: 2, water: 0.5, ice: 0.5, fire: 0.5 },
  dark: { electric: 1, flying: 1, normal: 1 }, flying: { grass: 2, electric: 0.5, rock: 0.5 }, normal: {},
};
const MD_TC = { fire: '#ff5a2a', water: '#2d8cff', grass: '#3ccf7a', electric: '#ffd400', rock: '#b07040', ice: '#37e0e0', dark: '#a05bd0', flying: '#8fcfff', normal: '#b8b8c8' };
const MD_TYPE_MOVES = {
  fire: [['Brasa', 48], ['Llamarada', 95]], water: [['Pistola Agua', 48], ['Hidrobomba', 95]], grass: [['Látigo Cepa', 48], ['Rayo Solar', 95]],
  electric: [['Impactrueno', 48], ['Trueno', 95]], rock: [['Lanzarrocas', 48], ['Avalancha', 95]], ice: [['Aliento Gélido', 48], ['Ventisca', 95]],
  dark: [['Mordisco', 48], ['Pulso Umbrío', 95]], flying: [['Picoteo', 48], ['Ataque Cielo', 95]],
};
const MD_STATUS = [{ n: 'Rugido', eff: 'atkdown', pp: 10, d: 'baja el ataque rival' }, { n: 'Endurecer', eff: 'defup', pp: 10, d: 'sube tu defensa' }, { n: 'Recuperar', eff: 'heal', pp: 5, d: 'cura el 40% de PS' }];
const MD_STATS = (b, lv) => ({ maxHp: Math.floor(b.hp * (1 + (lv - 5) * 0.12)) + (lv > 5 ? 0 : 0), atk: Math.floor(b.atk * (1 + (lv - 5) * 0.08)), def: Math.floor(b.def * (1 + (lv - 5) * 0.08)) });
const MD_TRAINERS = ['Líder Brasa', 'Líder Marea', 'Líder Raíz', 'Líder Chispa', 'Líder Cumbre'];

function MdBtn({ label, sub, color, onPress, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ width: '48.5%', opacity: disabled ? 0.35 : 1 }}>
      <View style={{ paddingVertical: 9, borderRadius: 14, backgroundColor: alpha(color, 0.16), borderWidth: 2, borderColor: alpha(color, 0.85), alignItems: 'center' }}>
        <Text style={{ color: C.text, fontWeight: '900', fontSize: 13 }}>{label}</Text>{sub ? <Text style={{ color: C.dim, fontSize: 10 }}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}


export function MonsterDuel3D({ onExit }) {
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('monster');
  const [teamOpen, setTeamOpen] = useState(false);
  const [scene, setScene] = useState('starter');           // starter | explore | battle | over | win
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);
  const mkMon = (id, lv) => {
    const b = MD_MONSTERS[id]; const st = MD_STATS(b, lv);
    const moves = [{ n: 'Placaje', t: 'normal', p: 40, acc: 100, pp: 25, max: 25 }, { n: MD_TYPE_MOVES[b.type][0][0], t: b.type, p: MD_TYPE_MOVES[b.type][0][1], acc: 100, pp: 18, max: 18 }];
    moves.push({ n: MD_TYPE_MOVES[b.type][1][0], t: b.type, p: MD_TYPE_MOVES[b.type][1][1], acc: 85, pp: 7, max: 7, minLv: 8 });
    const sm = MD_STATUS[id % 3]; moves.push({ n: sm.n, t: 'normal', eff: sm.eff, pp: sm.pp, max: sm.pp, d: sm.d });
    return { id, name: b.name, e: b.e, type: b.type, lv, ...st, hp: st.maxHp, xp: 0, xpNext: lv * 22, moves, evo: b.evo, evoLvl: b.evoLvl, st: { atk: 0, def: 0 } };
  };
  const initState = () => ({ team: [], active: 0, balls: 6, potions: 3, wins: 0, badges: 0, caught: [], box: 0, battle: null, log: ['¡Bienvenido al mundo de los Monstruos!'], menu: 'main', bt: 0, busy: false, trainerIdx: 0, steps: 0, nextTrainerAt: 4, world: mdNewWorld() });
  if (!g.current) g.current = initState();
  const addLog = m => { g.current.log = [m, ...g.current.log].slice(0, 4); };
  const scoreOf = s => s.wins * 10 + s.badges * 100 + s.caught.length * 20;
  const stage = n => Math.max(0.4, 1 + 0.25 * n);
  const effOf = (mt, dt) => (MD_MULT[mt] && MD_MULT[mt][dt] != null ? MD_MULT[mt][dt] : 1);
  const calc = (a, d, mv) => {
    const eff = effOf(mv.t, d.type); const stab = mv.t === a.type ? 1.3 : 1; const crit = Math.random() < 0.08;
    const raw = (a.atk * stage(a.st.atk)) / (d.def * stage(d.st.def)) * mv.p * 0.24 * eff * stab * (crit ? 1.6 : 1) * rand(0.88, 1);
    return { dmg: Math.max(1, Math.floor(raw) + 1), eff, crit };
  };
  const active = () => g.current.team[g.current.active];
  const start = id => {
    const s = initState(); s.team = [mkMon(id, 5)]; s.caught = [id];
    g.current = s; fx.clear(); setScene('explore'); hx.good();
    addLog(`¡${s.team[0].name} será tu compañero!`);
    AsyncStorage.removeItem('@md_save2').catch(() => {});
  };
  const save = () => { const s = g.current; AsyncStorage.setItem('@md_save2', JSON.stringify({ team: s.team, balls: s.balls, potions: s.potions, wins: s.wins, badges: s.badges, caught: s.caught, box: s.box, trainerIdx: s.trainerIdx, nextTrainerAt: s.nextTrainerAt })).catch(() => {}); };
  useEffect(() => { AsyncStorage.getItem('@md_save2').then(v => { if (v) { try { g.current.save = JSON.parse(v); force(); } catch (e) {} } }).catch(() => {}); }, []);
  const load = () => { const d = g.current.save; if (!d) return; const s = initState(); Object.assign(s, d); s.log = ['Partida cargada.']; s.world = mdNewWorld(); g.current = s; setScene('explore'); };

  const beginBattle = (trainer, wildId) => {
    const s = g.current; const lead = Math.max(...s.team.map(m => m.lv));
    let foes;
    if (trainer) { const n = 2 + Math.min(1, s.badges); foes = Array.from({ length: n }, () => mkMon(randInt(0, MD_MONSTERS.length - 1), lead + randInt(0, 2) + s.badges)); }
    else foes = [mkMon(wildId != null ? wildId : randInt(0, MD_MONSTERS.length - 1), Math.max(3, lead + randInt(-2, 2)))];
    s.battle = { foes, fi: 0, trainer, name: trainer ? MD_TRAINERS[s.trainerIdx % MD_TRAINERS.length] : null, t: 0, hit: 0, ahit: 0 };
    s.team.forEach(m => { m.st = { atk: 0, def: 0 }; });
    s.menu = 'main'; s.busy = false;
    addLog(trainer ? `¡${s.battle.name} te desafía!` : `¡Un ${foes[0].name} salvaje apareció!`);
    fx.flash('#fff', 0.5); hx.warn(); setTeamOpen(false); if (trainer) s.world.leader = null; setScene('battle');
  };
  const foe = () => g.current.battle.foes[g.current.battle.fi];
  const checkEvo = (m) => {
    if (m.evo !== -1 && m.evo != null && m.lv >= m.evoLvl) {
      const old = m.name; const nb = MD_MONSTERS[m.evo]; const st = MD_STATS(nb, m.lv);
      Object.assign(m, { id: nb.id, name: nb.name, e: nb.e, type: nb.type, ...st, hp: st.maxHp, evo: nb.evo, evoLvl: nb.evoLvl });
      m.moves[1] = { ...m.moves[1], n: MD_TYPE_MOVES[nb.type][0][0], t: nb.type }; m.moves[2] = { ...m.moves[2], n: MD_TYPE_MOVES[nb.type][1][0], t: nb.type };
      addLog(`✨ ¡${old} evolucionó a ${nb.name}!`); fx.flash('#fff', 0.6); hx.win();
    }
  };
  const gainXp = (m, amount) => {
    m.xp += amount; let up = false;
    while (m.xp >= m.xpNext) { m.xp -= m.xpNext; m.lv += 1; m.xpNext = m.lv * 22; const base = MD_MONSTERS[m.id]; const st = MD_STATS(base, m.lv); const gain = st.maxHp - m.maxHp; Object.assign(m, st); m.hp = Math.min(m.maxHp, m.hp + Math.max(6, gain)); up = true; addLog(`¡${m.name} subió al nivel ${m.lv}! ⬆️`); checkEvo(m); }
    if (up) { hx.good(); fx.pop(AREA_W / 2, AREA_H - 210, `¡NIVEL ${m.lv}!`, C.amber, 24); }
  };
  const endWin = () => {
    const s = g.current; const b = s.battle; const tr = b.trainer;
    s.wins += 1;
    s.team.forEach(m => { if (m.hp > 0) m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * 0.12)); });
    if (Math.random() < 0.5) { s.balls += 1; addLog('Encontraste una Monstruobola 🔴.'); }
    if (tr) {
      s.badges += 1; s.trainerIdx += 1; s.nextTrainerAt = s.wins + 4; s.balls += 3; s.potions += 2; s.team.forEach(m => { m.hp = m.maxHp; });
      addLog(`🏅 ¡Medalla ${s.badges}! Equipo curado y +3 🔴 +2 🧪`); fx.flash(C.amber, 0.4); hx.win();
    }
    submitBest(scoreOf(s)); save(); s.battle = null;
    if (s.badges >= 5) { setScene('win'); return; }
    setScene('explore');
  };
  const faintCheck = () => { // ¿cayó el aliado activo?
    const s = g.current; const m = active();
    if (m.hp > 0) return false;
    addLog(`¡${m.name} se debilitó!`); hx.bad();
    const alive = s.team.findIndex(x => x.hp > 0);
    if (alive < 0) { later(() => { submitBest(scoreOf(s)); hx.die(); s.battle = null; setScene('over'); }, 900); return true; }
    s.menu = 'forced'; s.busy = false; force(); return true;
  };
  const foeAct = () => {
    const s = g.current; const b = s.battle; if (!b) return; const f = foe(); const p = active();
    const usable = f.moves.filter(m => m.pp > 0 && !(m.minLv && f.lv < m.minLv));
    let mv = usable.length ? pick(usable) : { n: 'Forcejeo', t: 'normal', p: 30, acc: 100, pp: 1 };
    const strong = usable.filter(m => m.p && effOf(m.t, p.type) > 1); if (strong.length && Math.random() < 0.6) mv = pick(strong);
    mv.pp -= 1;
    if (mv.eff) {
      if (mv.eff === 'atkdown') { p.st.atk = Math.max(-3, p.st.atk - 1); addLog(`${f.name} usa ${mv.n}. ¡Tu ataque baja!`); }
      if (mv.eff === 'defup') { f.st.def = Math.min(3, f.st.def + 1); addLog(`${f.name} usa ${mv.n}. ¡Su defensa sube!`); }
      if (mv.eff === 'heal') { const h = Math.ceil(f.maxHp * 0.4); f.hp = Math.min(f.maxHp, f.hp + h); addLog(`${f.name} usa ${mv.n} y se cura.`); }
    } else if (Math.random() * 100 > mv.acc) addLog(`${f.name} usa ${mv.n}… ¡pero falla!`);
    else {
      const r = calc(f, p, mv); p.hp = Math.max(0, p.hp - r.dmg); b.ahit = 0.3;
      fx.pop(AREA_W * 0.3, AREA_H - 250, `-${r.dmg}`, C.red, 24); fx.burst(AREA_W * 0.3, AREA_H - 250, MD_TC[mv.t], 12, 220); fx.shake(r.eff > 1 ? 8 : 5, 0.25); hx.heavy();
      addLog(`${f.name} usa ${mv.n}: -${r.dmg}${r.eff > 1 ? ' ¡Muy eficaz!' : r.eff < 1 ? ' No muy eficaz.' : ''}${r.crit ? ' ¡Crítico!' : ''}`);
    }
    if (!faintCheck()) { s.busy = false; s.menu = 'main'; }
    force();
  };
  const afterPlayer = () => {
    const s = g.current; const b = s.battle; const f = foe();
    if (f.hp <= 0) {
      const xp = Math.floor(f.lv * 18 * (b.trainer ? 1.5 : 1)); addLog(`¡${f.name} fue derrotado! +${xp} XP`);
      fx.burst(AREA_W * 0.68, 150, MD_TC[f.type], 26, 300, 0.8, 6); hx.win();
      gainXp(active(), xp); s.team.forEach((m, i) => { if (i !== s.active && m.hp > 0) gainXp(m, Math.floor(xp * 0.3)); });
      if (b.fi + 1 < b.foes.length) { b.fi += 1; addLog(`${b.name} saca a ${foe().name}.`); s.busy = false; s.menu = 'main'; force(); return; }
      later(endWin, 900); force(); return;
    }
    later(foeAct, 800); force();
  };
  const useMove = i => {
    const s = g.current; const b = s.battle; if (!b || s.busy) return;
    const p = active(); const f = foe(); const mv = p.moves[i];
    if (mv.pp <= 0 || (mv.minLv && p.lv < mv.minLv)) { hx.tick(); return; }
    s.busy = true; mv.pp -= 1;
    if (mv.eff) {
      if (mv.eff === 'atkdown') { f.st.atk = Math.max(-3, f.st.atk - 1); addLog(`${p.name} usa ${mv.n}. ¡El ataque rival baja!`); }
      if (mv.eff === 'defup') { p.st.def = Math.min(3, p.st.def + 1); addLog(`${p.name} usa ${mv.n}. ¡Tu defensa sube!`); }
      if (mv.eff === 'heal') { const h = Math.ceil(p.maxHp * 0.4); p.hp = Math.min(p.maxHp, p.hp + h); fx.pop(AREA_W * 0.3, AREA_H - 250, `+${h}`, C.lime, 22); addLog(`${p.name} usa ${mv.n} y recupera ${h} PS.`); }
      hx.good();
    } else if (Math.random() * 100 > mv.acc) { addLog(`${p.name} usa ${mv.n}… ¡pero falla!`); hx.tick(); }
    else {
      const r = calc(p, f, mv); f.hp = Math.max(0, f.hp - r.dmg); b.hit = 0.3;
      fx.pop(AREA_W * 0.68, 130, `-${r.dmg}`, r.eff > 1 ? C.amber : C.text, r.eff > 1 ? 28 : 22); fx.burst(AREA_W * 0.68, 150, MD_TC[mv.t], 14, 240); fx.ring(AREA_W * 0.68, 150, MD_TC[mv.t], 60); hx.hit();
      addLog(`${p.name} usa ${mv.n}: -${r.dmg}${r.eff > 1 ? ' ¡Muy eficaz!' : r.eff < 1 ? ' No muy eficaz.' : ''}${r.crit ? ' ¡Crítico!' : ''}`);
    }
    s.menu = 'main'; force(); later(afterPlayer, 700);
  };
  const swapTo = (i, forced) => {
    const s = g.current; if (s.team[i].hp <= 0 || (i === s.active && !forced)) return;
    s.active = i; s.team[i].st = { atk: 0, def: 0 }; addLog(`¡Adelante, ${s.team[i].name}!`); hx.tap();
    if (s.battle) { s.menu = 'main'; if (forced) { s.busy = false; force(); } else { s.busy = true; force(); later(foeAct, 700); } } else force();
  };
  const usePotion = () => {
    const s = g.current; const p = active();
    if (s.potions <= 0 || p.hp >= p.maxHp || (s.battle && s.busy)) { hx.tick(); return; }
    s.potions -= 1; const h = Math.ceil(p.maxHp * 0.45); p.hp = Math.min(p.maxHp, p.hp + h); fx.pop(AREA_W * 0.3, AREA_H - 250, `+${h}`, C.lime, 22); hx.good(); addLog(`🧪 ${p.name} recupera ${h} PS.`);
    if (s.battle) { s.busy = true; s.menu = 'main'; force(); later(foeAct, 700); } else force();
  };
  const tryCatch = () => {
    const s = g.current; const b = s.battle; if (!b || s.busy) return;
    if (b.trainer) { addLog('¡No puedes capturar monstruos de entrenadores!'); hx.bad(); force(); return; }
    if (s.balls <= 0) { addLog('No te quedan Monstruobolas.'); hx.bad(); force(); return; }
    s.balls -= 1; s.busy = true; const f = foe(); addLog('🔴 ¡Lanzas una Monstruobola!'); hx.heavy(); force();
    const rate = clamp((1 - f.hp / f.maxHp) * 0.7 + 0.15 - (f.lv - active().lv) * 0.02, 0.08, 0.95);
    later(() => { addLog('…'); force(); }, 500); later(() => { addLog('…!'); hx.tick(); force(); }, 1000);
    later(() => {
      if (Math.random() < rate) {
        addLog(`¡${f.name} capturado! 🎉`); fx.burst(AREA_W * 0.68, 150, C.amber, 30, 280, 0.9, 6); hx.win();
        if (!s.caught.includes(f.id)) s.caught.push(f.id);
        if (s.team.length < 4) { f.hp = Math.max(1, Math.floor(f.maxHp * 0.5)); f.st = { atk: 0, def: 0 }; s.team.push(f); } else { s.box += 1; addLog('Tu equipo está lleno: va a la caja.'); }
        s.wins += 1; submitBest(scoreOf(s)); save(); s.battle = null; later(() => setScene('explore'), 900); force();
      } else { addLog(`¡${f.name} se liberó!`); hx.bad(); force(); later(foeAct, 600); }
    }, 1500);
  };
  const run = () => {
    const s = g.current; const b = s.battle; if (!b || s.busy) return;
    if (b.trainer) { addLog('¡No puedes huir de un combate de entrenador!'); hx.bad(); force(); return; }
    addLog('¡Escapaste sin problemas!'); s.battle = null; hx.tick(); setScene('explore');
  };
  const rest = () => {
    const s = g.current; s.team.forEach(m => { m.hp = m.maxHp; m.moves.forEach(mv => { mv.pp = mv.max; }); }); addLog('🛏️ Tu equipo descansa y se recupera por completo.'); hx.good(); fx.flash(C.lime, 0.2);
    if (Math.random() < 0.4) { addLog('¡Pero un monstruo salvaje te sorprendió!'); later(() => beginBattle(false), 700); }
    save(); force();
  };
  useLoop(scene === 'battle', dt => { const b = g.current.battle; if (b) { b.t += dt; if (b.hit > 0) b.hit -= dt; if (b.ahit > 0) b.ahit -= dt; } });


  // ─── Exploración: el joystick mueve al entrenador por el mapa ───
  const stick = useRef({ x: 0, y: 0, on: false }).current;
  useLoop(scene === 'explore', dt => {
    const s = g.current; if (!s.world) return;
    const ev = mdStep(s.world, stick, dt, s.wins >= s.nextTrainerAt);
    if (ev.leader) { beginBattle(true); return; }
    if (ev.wild) {
      const c = ev.wild; s.world.wild = s.world.wild.filter(o => o !== c);
      const n = mdSpawnWild(s.world); if (n) s.world.wild.push(n);
      beginBattle(false, c.sp); return;
    }
    if (ev.grass && Math.random() < 0.5) beginBattle(false);
  });

  const s = g.current; const b = s.battle; const p = s.team[s.active]; const f = b ? foe() : null;
  const tag = m => <Text style={{ color: MD_TC[m.type], fontSize: 10, fontWeight: '900' }}>{m.type.toUpperCase()}</Text>;
  const hpColor = (h, m) => (h > m * 0.5 ? C.lime : h > m * 0.2 ? C.amber : C.red);
  const sc3 = scene === 'battle' && b && p && f ? mdBattleScene(b, p, f) : mdWorldScene(s.world);
  return (
    <GameScreen title="MONSTER DUEL 3D" emoji="⚡" accent={C.amber} onExit={onExit} score={scoreOf(s)} best={best}
      hud={scene === 'explore' || scene === 'battle' ? <><Text style={{ color: C.dim, fontSize: 12 }}>🏅 {s.badges}/5 · 👾 {s.caught.length}/{MD_MONSTERS.length}</Text><Text style={{ color: C.dim, fontSize: 12 }}>🔴 {s.balls}  🧪 {s.potions}</Text></> : null}>
      <PlayArea fx={fx} bg={scene === 'battle' ? '#0a1220' : '#9fdcff'} border={alpha(C.amber, 0.4)}>
        <World3D scene={sc3} />
        {scene === 'explore' && p && (
          <View pointerEvents="box-none" style={{ flex: 1 }}>
            <View pointerEvents="none" style={{ position: 'absolute', left: 10, right: 10, top: 8, padding: 8, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.45)' }}>
              {s.log.slice(0, 3).map((m, i) => <Text key={i} numberOfLines={1} style={{ color: i === 0 ? C.text : alpha(C.dim, 0.8), fontSize: 12, lineHeight: 17 }}>{m}</Text>)}
            </View>
            {s.world.leader && <Text pointerEvents="none" style={{ position: 'absolute', top: 70, width: AREA_W, textAlign: 'center', color: C.amber, fontWeight: '900', fontSize: 12, letterSpacing: 1, ...tglow(C.amber, 6) }}>🏅 ¡{MD_TRAINERS[s.trainerIdx % MD_TRAINERS.length]} te espera! (sigue el faro)</Text>}
            <TouchStick testID="md-stick" v={stick} R={44} style={{ position: 'absolute', left: 14, bottom: 14, width: 112, height: 112, borderRadius: 56, backgroundColor: alpha(C.amber, 0.12), borderWidth: 2, borderColor: alpha(C.amber, 0.5), alignItems: 'center', justifyContent: 'center' }}>
              <View pointerEvents="none" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: alpha(C.amber, 0.45) }} />
            </TouchStick>
            <View style={{ position: 'absolute', right: 12, bottom: 12, width: 196, flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
              <Btn label="👥 EQUIPO" small ghost color={C.amber} onPress={() => setTeamOpen(true)} />
              <Btn testID="md-rest" label="🛏️ DESCANSAR" small ghost color={C.cyan} onPress={rest} />
              <Btn label={`🧪 ${s.potions}`} small ghost color={C.red} onPress={usePotion} />
              <Btn label="💾 GUARDAR" small ghost color={C.lime} onPress={() => { save(); addLog('💾 Partida guardada.'); hx.good(); force(); }} />
            </View>
            {teamOpen && (
              <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(7,20,10,0.94)', zIndex: 40, padding: 14 }}>
                <Text style={{ color: C.amber, fontWeight: '900', fontSize: 12, letterSpacing: 2, marginBottom: 8 }}>TU EQUIPO ({s.team.length}/4)</Text>
                {s.team.map((m, i) => (
                  <Pressable key={i} onPress={() => { s.active = i; hx.tick(); force(); }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 14, marginBottom: 8, backgroundColor: i === s.active ? alpha(MD_TC[m.type], 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 2, borderColor: i === s.active ? MD_TC[m.type] : '#222638' }}>
                      <Text style={{ fontSize: 30, marginRight: 10, opacity: m.hp <= 0 ? 0.35 : 1 }}>{m.e}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>{m.name} <Text style={{ color: C.dim, fontSize: 11 }}>Nv.{m.lv}</Text>  {tag(m)}</Text>
                        <Bar value={m.hp} max={m.maxHp} color={hpColor(m.hp, m.maxHp)} h={7} style={{ marginTop: 4 }} />
                        <Text style={{ color: C.dim, fontSize: 10, marginTop: 2 }}>{m.hp}/{m.maxHp} PS · XP {m.xp}/{m.xpNext}</Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
                <View style={{ marginTop: 6, alignItems: 'center' }}><Btn label="CERRAR" small ghost color={C.dim} onPress={() => setTeamOpen(false)} /></View>
              </View>
            )}
          </View>
        )}
        {scene === 'battle' && b && p && f && (
          <View style={{ flex: 1 }}>
            <View style={{ position: 'absolute', left: 14, top: 12, width: AREA_W * 0.5 }}>
              <Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>{f.name} <Text style={{ color: C.dim, fontSize: 11 }}>Nv.{f.lv}</Text> {tag(f)}</Text>
              <Bar value={f.hp} max={f.maxHp} color={hpColor(f.hp, f.maxHp)} h={9} style={{ marginTop: 4 }} />
              <Text style={{ color: C.dim, fontSize: 10, marginTop: 2 }}>{f.hp}/{f.maxHp}{b.trainer ? `  ·  ${b.name} (${b.fi + 1}/${b.foes.length})` : ''}{f.st.atk < 0 ? ' · ATK↓' : ''}{f.st.def > 0 ? ' · DEF↑' : ''}</Text>
            </View>
            <View style={{ position: 'absolute', right: 14, top: 214, width: AREA_W * 0.5 }}>
              <Text style={{ color: C.text, fontWeight: '900', fontSize: 14, textAlign: 'right' }}>{p.name} <Text style={{ color: C.dim, fontSize: 11 }}>Nv.{p.lv}</Text> {tag(p)}</Text>
              <Bar value={p.hp} max={p.maxHp} color={hpColor(p.hp, p.maxHp)} h={9} style={{ marginTop: 4 }} />
              <Text style={{ color: C.dim, fontSize: 10, marginTop: 2, textAlign: 'right' }}>{p.hp}/{p.maxHp}{p.st.atk < 0 ? ' · ATK↓' : ''}{p.st.def > 0 ? ' · DEF↑' : ''}</Text>
            </View>
            <View style={{ position: 'absolute', left: 12, right: 12, top: 266, padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: alpha(C.amber, 0.25), minHeight: 74 }}>
              {s.log.slice(0, 3).map((m, i) => <Text key={i} style={{ color: i === 0 ? C.text : alpha(C.dim, 0.8), fontSize: 12, lineHeight: 17 }}>{m}</Text>)}
            </View>
            <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}>
              {s.busy && s.menu !== 'forced' && <Text style={{ color: C.dim, textAlign: 'center', padding: 22 }}>…</Text>}
              {!s.busy && s.menu === 'main' && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                  <MdBtn label="⚔️ LUCHAR" color={C.red} onPress={() => { s.menu = 'moves'; force(); }} />
                  <MdBtn label="🔁 EQUIPO" color={C.violet} onPress={() => { s.menu = 'team'; force(); }} />
                  <MdBtn label={`🔴 ATRAPAR (${s.balls})`} color={C.amber} onPress={tryCatch} />
                  <MdBtn label={`🧪 POCIÓN (${s.potions})`} color={C.lime} onPress={usePotion} />
                  <MdBtn label="🏃 HUIR" color={C.dim} onPress={run} />
                </View>
              )}
              {!s.busy && s.menu === 'moves' && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                  {p.moves.map((mv, i) => <MdBtn key={i} label={mv.n} sub={mv.eff ? mv.d : `${mv.t} · pot ${mv.p}${effOf(mv.t, f.type) > 1 ? ' ✓✓' : effOf(mv.t, f.type) < 1 ? ' ✗' : ''} · PP ${mv.pp}/${mv.max}`} color={MD_TC[mv.t]} onPress={() => useMove(i)} disabled={mv.pp <= 0 || (mv.minLv && p.lv < mv.minLv)} />)}
                  <MdBtn label="← Volver" color={C.dim} onPress={() => { s.menu = 'main'; force(); }} />
                </View>
              )}
              {(s.menu === 'team' || s.menu === 'forced') && (
                <View style={{ gap: 6 }}>
                  {s.menu === 'forced' && <Text style={{ color: C.amber, fontWeight: '900', textAlign: 'center' }}>Elige al siguiente monstruo</Text>}
                  {s.team.map((m, i) => (
                    <Pressable key={i} onPress={() => swapTo(i, s.menu === 'forced')} disabled={m.hp <= 0 || (i === s.active && s.menu === 'team')} style={{ opacity: m.hp <= 0 || (i === s.active && s.menu === 'team') ? 0.4 : 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 12, backgroundColor: alpha(MD_TC[m.type], 0.12), borderWidth: 1.5, borderColor: alpha(MD_TC[m.type], 0.7) }}>
                        <Text style={{ fontSize: 26, marginRight: 8 }}>{m.e}</Text><Text style={{ color: C.text, fontWeight: '800', flex: 1 }}>{m.name} Nv.{m.lv}</Text><Text style={{ color: C.dim, fontSize: 11 }}>{m.hp}/{m.maxHp}</Text>
                      </View>
                    </Pressable>
                  ))}
                  {s.menu === 'team' && <MdBtn label="← Volver" color={C.dim} onPress={() => { s.menu = 'main'; force(); }} />}
                </View>
              )}
            </View>
          </View>
        )}
        <Overlay show={scene === 'starter'} kind="start" emoji="⚡" title="MONSTER DUEL 3D" subtitle="Elige a tu compañero inicial" accent={C.amber} noStart onStart={() => {}} extra={
          <View style={{ width: '100%', marginTop: 14, gap: 8 }}>
            {[0, 2, 4].map(i => { const m = MD_MONSTERS[i]; return (
              <Pressable key={i} testID={`starter-${i}`} onPress={() => start(i)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 16, backgroundColor: alpha(MD_TC[m.type], 0.14), borderWidth: 2, borderColor: MD_TC[m.type] }}>
                  <Text style={{ fontSize: 40, marginRight: 12 }}>{m.e}</Text>
                  <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: '900', fontSize: 15 }}>{m.name}</Text><Text style={{ color: MD_TC[m.type], fontSize: 11, fontWeight: '900' }}>{m.type.toUpperCase()}</Text><Text style={{ color: C.dim, fontSize: 11 }}>PS {m.hp} · ATQ {m.atk} · DEF {m.def}</Text></View>
                </View>
              </Pressable>); })}
            {s.save && <Btn label="CONTINUAR PARTIDA" ghost small color={C.amber} onPress={load} />}
          </View>
        } lines={['Recorre el mapa, captura monstruos y vence a 5 líderes']} />
        <Overlay show={scene === 'over'} kind="over" emoji="💀" title="TODOS CAÍDOS" subtitle={`🏅 ${s.badges} medallas · 👾 ${s.caught.length} capturados`} score={scoreOf(s)} best={best} accent={C.red} onStart={() => { g.current = initState(); setScene('starter'); }} startLabel="NUEVA AVENTURA" onExit={onExit} />
        <Overlay show={scene === 'win'} kind="win" emoji="🏆" title="¡CAMPEÓN!" subtitle={`Derrotaste a los 5 líderes · ${s.caught.length} monstruos capturados`} score={scoreOf(s)} best={best} isNew accent={C.amber} onStart={() => { g.current = initState(); setScene('starter'); }} startLabel="NUEVA AVENTURA" onExit={onExit} />
      </PlayArea>
    </GameScreen>
  );
}
