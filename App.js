import React, { useEffect, useReducer, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AREA_H, AREA_HF, AREA_W, SCREEN_W, Bar, Btn, C, Combo, GameScreen, GridBg, Lives, Overlay, Pill, PlayArea, Starfield,
  alpha, clamp, glow, tglow, hx, lerp, makeStars, overlap, pick, rand, randInt, shuffle,
  GameCtx, TouchBtn, TouchStick, uid, useBest, useFX, useForce, useLoop, usePan, useTimeouts,
} from './utils/kit';
import { OW_COL, OW_H, OW_N, owGen } from './utils/ow';
import { createGLWorld } from './utils/gl3d';
import { createMoto, createPlane } from './utils/gl3dx';
import { Breakout3D } from './games3d/breakout';
import { IslaTesoro3D } from './games3d/islatesoro';
import { NeonGalaxy3D } from './games3d/neon';
import { CyberRun3D } from './games3d/cyber';
import { GalacticHunt3D } from './games3d/galactic';
import { NeonTunnel3D } from './games3d/tunnel';
import { AsteroidDodge3D } from './games3d/asteroidodge';
import { FlappyNeon3D } from './games3d/flappyneon';
import { SnakePower3D } from './games3d/snake';
import { StarCatcher3D } from './games3d/starcatcher';
import { CoinCollector3D } from './games3d/coincollector';
import { TowerStack3D } from './games3d/towerstack';
import { DinoRun3D } from './games3d/dinorun';
import { BubbleShooter3D } from './games3d/bubbleshooter';
import { CrossyRoad3D } from './games3d/crossyroad';
import { PixelQuest3D } from './games3d/pixel';
import { VoidCrawler3D } from './games3d/void';
import { MonsterDuel3D } from './games3d/monster';
import { NeonWarrior3D } from './games3d/warrior';
import { PixelCraft3D } from './games3d/craft';
import { PixelRPG3D } from './games3d/pixelrpg';
import { WallJumper3D } from './games3d/walljumper';
import { PingPong3D } from './games3d/pingpong';
import { PongSolo3D } from './games3d/pongsolo';
import { Invaders3D } from './games3d/invaders';
import { SkyHop3D } from './games3d/skyhop';
import { GravityFlip3D } from './games3d/gravity';
import { NeonTetris3D } from './games3d/tetris';
import { Connect4_3D } from './games3d/connect4';
import { WordChain3D } from './games3d/wordchain';
import { WordScramble3D } from './games3d/wordscramble';
import { MathRush3D } from './games3d/mathrush';
import { NeonGame2048_3D } from './games3d/neon2048';
import { NumberPuzzle3D } from './games3d/numberpuzzle';
import { MemoryMatch3D } from './games3d/memorymatch';
import { Buscaminas3D } from './games3d/minesweeper';
import { ColorRush3D } from './games3d/colorrush';
import { ReactionTime3D } from './games3d/reactiontime';
import { WhackAMole3D } from './games3d/whackamole';
import { FruitTap3D } from './games3d/fruittap';
import { RhythmTap3D } from './games3d/rhythm';
import { ACHIEVEMENTS, Profile, ToastHost, levelInfo, toast, useProfile, useSettings } from './utils/meta';

const { width, height } = Dimensions.get('window');


// ─────────────────────────────────────────────────────────────────



// ==========================================
// 3. PIXEL QUEST (plataformas de 30 mundos)
// ==========================================
const PQ_GRAVITY = 1.2;
const PQ_JUMP = -18;
const PQ_SPEED = 7;
const PQ_PLAYER_SIZE = 30;


const PQ_THEMES = [
  { sky: '#6ec6ff', sky2: '#c9ecff', ground: '#6b4423', top: '#4cc04c', plat: '#a8693a', ptop: '#d9954f' },
  { sky: '#7be0a5', sky2: '#d7ffe6', ground: '#5a4a2c', top: '#3fae6b', plat: '#8f7a45', ptop: '#c2a660' },
  { sky: '#c79bff', sky2: '#eed9ff', ground: '#4a3560', top: '#9b6bff', plat: '#6f4f9a', ptop: '#a982dc' },
  { sky: '#ffd27a', sky2: '#fff1cf', ground: '#7a4a1c', top: '#e0a030', plat: '#a9702f', ptop: '#d89b55' },
  { sky: '#ff9fb8', sky2: '#ffdbe6', ground: '#6a3040', top: '#ff6b8f', plat: '#9a4a5c', ptop: '#d97a90' },
  { sky: '#6fd0ff', sky2: '#d9f3ff', ground: '#33506a', top: '#45b8e0', plat: '#4c7090', ptop: '#7fb0d0' },
  { sky: '#ff9a5a', sky2: '#ffd9bf', ground: '#5a2a1a', top: '#ff7a3d', plat: '#8a4528', ptop: '#d27a52' },
  { sky: '#2b3b5a', sky2: '#52688f', ground: '#20283a', top: '#6b84c4', plat: '#34415e', ptop: '#5b72a5' },
];


// ==========================================
// 4. PING PONG
// ==========================================

// ==========================================
// 5. BREAKOUT
// ==========================================

// ==========================================


// ─── VOID CRAWLER ─────────────────────────────────────────────────
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




// ─── MONSTER DUEL ─────────────────────────────────────────────────
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







// ─── NEON WARRIOR ─────────────────────────────────────────────────
const NW_THEMES = [
  { bg: '#05051a', a: C.pink, b: C.cyan, name: 'CIUDAD NEÓN' }, { bg: '#04140f', a: C.lime, b: C.cyan, name: 'BOSQUE DIGITAL' },
  { bg: '#180606', a: C.orange, b: C.amber, name: 'FÁBRICA ARDIENTE' }, { bg: '#100618', a: C.violet, b: C.pink, name: 'NÚCLEO CUÁNTICO' },
];

// ─── PIXEL CRAFT ──────────────────────────────────────────────────
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
const PcTiles = React.memo(function PcTiles({ rows, x0, y0, cols, rowsN, S, ver }) {
  const out = [];
  for (let j = 0; j < rowsN; j++) for (let i = 0; i < cols; i++) {
    const wx = x0 + i, wy = y0 + j;
    if (wx < 0 || wy < 0 || wx >= PC_W || wy >= PC_H) continue;
    const t = rows[wy][wx]; if (!t) continue;
    const d = PC_BLK[t];
    if (t === 14) { out.push(<Text key={`${wx},${wy}`} style={{ position: 'absolute', left: i * S, top: j * S, width: S, textAlign: 'center', fontSize: S * 0.8, lineHeight: S }}>🔦</Text>); continue; }
    out.push(
      <View key={`${wx},${wy}`} style={{ position: 'absolute', left: i * S, top: j * S, width: S, height: S, backgroundColor: d[0], borderWidth: 1, borderColor: d[1] }}>
        {PC_DOT[t] ? <View style={{ position: 'absolute', left: S * 0.22, top: S * 0.22, right: S * 0.22, bottom: S * 0.22, borderRadius: 4, borderWidth: 2, borderColor: PC_DOT[t] }} /> : null}
        {t === 15 ? <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,200,40,0.25)' }} /> : null}
        {t === 13 ? <View style={{ position: 'absolute', left: 0, right: 0, top: S * 0.48, height: 2, backgroundColor: d[1] }} /> : null}
      </View>
    );
  }
  return <>{out}</>;
});



         
         
      // px entre obstáculos






// ─────────────────────────────────────────────────────────────────
// TOWER STACK
// ─────────────────────────────────────────────────────────────────
// NUMBER PUZZLE (Slide 15-puzzle)
// ─────────────────────────────────────────────────────────────────
// COIN COLLECTOR
// ─────────────────────────────────────────────────────────────────
// REACTION TIME
// ─────────────────────────────────────────────────────────────────
// COLOR RUSH – tap the correct color name
// ─────────────────────────────────────────────────────────────────
// PONG SOLO – jugador vs pared rebotante
// ─────────────────────────────────────────────────────────────────
// WORD CHAIN – escribe palabras que empiezan con la última letra
// ─────────────────────────────────────────────────────────────────
// DINO RUN
// ─────────────────────────────────────────────────────────────────
// FRUIT TAP
// ─── PIXEL RPG ────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────

// ─── INVASORES ────────────────────────────────────────────────────

// ─── SKY HOP ──────────────────────────────────────────────────────

// ─── BUSCAMINAS ───────────────────────────────────────────────────
const MS_LEVELS = { easy: { c: 8, r: 10, m: 10, base: 500, name: 'Fácil' }, med: { c: 9, r: 12, m: 20, base: 1100, name: 'Medio' }, hard: { c: 10, r: 14, m: 36, base: 2200, name: 'Difícil' } };
const MS_COLORS = ['', '#4d8bff', '#7dff6b', '#ff4d6d', '#9b6bff', '#ff8a3d', '#22e6ff', '#ffffff', '#8b92b8'];

// ─── 4 EN LÍNEA ───────────────────────────────────────────────────

// ─── MUNDO ABIERTO 3D ─────────────────────────────────────────────
function owShade(c, light, fog, fogC) {
  const f = clamp(fog, 0, 1);
  const r = Math.round(lerp(c[0] * light, fogC[0], f)), g = Math.round(lerp(c[1] * light, fogC[1], f)), b = Math.round(lerp(c[2] * light, fogC[2], f));
  return `rgb(${r},${g},${b})`;
}
// En iOS el framebuffer de expo-gl es multisample (MSAA) y readPixels siempre devuelve negro,
// así que la prueba de "pantalla vacía" solo es fiable en web.
const GL_PROBE = Platform.OS === 'web';

function OpenWorld3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('openworld');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const sprint = useRef({ on: false }).current;
  // GPU (three.js sobre expo-gl) si está disponible; si falla, modo compatible (raycaster con Views)
  const GLViewC = useRef(undefined);
  if (GLViewC.current === undefined) { try { GLViewC.current = require('expo-gl').GLView; require('three'); } catch (e) { GLViewC.current = null; } }
  const [glFail, setGlFail] = useState(false);
  const useGL = !!GLViewC.current && !glFail;
  const glOnRef = useRef(useGL); glOnRef.current = useGL;
  const glRef = useRef(null); const stopRef = useRef(null);
  useEffect(() => () => { if (stopRef.current) stopRef.current.v = true; }, []);
  const NCOL = Math.max(40, Math.floor(AREA_W / 6));
  const CW = AREA_W / NCOL;
  const HOR = AREA_H * 0.5;
  const FOV = 1.05;
  const planeLen = Math.tan(FOV / 2);
  const TOTAL_GEMS = 20;

  const initState = () => {
    const w = owGen(Math.floor(Math.random() * 1e9));
    const C0 = OW_N / 2 + 0.5;
    const ents = []; const spots = w.free.filter(([x, y]) => Math.hypot(x - OW_N / 2, y - OW_N / 2) > 7);
    const take = () => { const i = Math.floor(Math.random() * spots.length); const [x, y] = spots.splice(i, 1)[0] || [OW_N / 2 + 3, OW_N / 2]; return { x: x + 0.5, y: y + 0.5 }; };
    for (let i = 0; i < TOTAL_GEMS; i++) ents.push({ id: uid(), kind: 'gem', e: '💎', ...take(), s: 0.38, ph: Math.random() * 6 });
    for (let i = 0; i < 46; i++) ents.push({ id: uid(), kind: 'coin', e: '🪙', ...take(), s: 0.3, ph: Math.random() * 6 });
    for (let i = 0; i < 16; i++) ents.push({ id: uid(), kind: 'animal', e: pick(['🐄', '🐑', '🦌', '🐇', '🐖']), ...take(), s: 0.45, a: rand(0, 6.28), tm: rand(1, 4), ph: 0 });
    return { w, px: C0, py: C0, a: rand(0, 6.28), ents, cols: [], sprites: [], z: new Float32Array(NCOL), t: 0, tod: 0.18, gems: 0, coins: 0, hp: 3, inv: 0, wolfT: 3, dist: 0, bob: 0, banner: { text: 'MUNDO ABIERTO', t: 2 }, toast: null };
  };
  const g = useRef(null);
  if (!g.current) { g.current = initState(); }
  const blocked = (s, x, y) => { const cx = Math.floor(x), cy = Math.floor(y); return cx < 0 || cy < 0 || cx >= OW_N || cy >= OW_N || s.w.m[cy][cx] > 0; };
  const tryMove = (s, nx, ny, r) => {
    let ok = true;
    for (const [ox, oy] of [[r, r], [-r, r], [r, -r], [-r, -r]]) if (blocked(s, nx + ox, s.py + oy)) ok = false;
    if (ok) s.px = nx;
    ok = true;
    for (const [ox, oy] of [[r, r], [-r, r], [r, -r], [-r, -r]]) if (blocked(s, s.px + ox, ny + oy)) ok = false;
    if (ok) s.py = ny;
  };
  const daylight = s => clamp(Math.sin(s.tod * Math.PI * 2) * 1.5 + 0.55, 0, 1);

  const cast = s => {
    const dl = daylight(s); const light = 0.32 + 0.68 * dl;
    const fogC = [Math.round(lerp(14, 205, dl)), Math.round(lerp(18, 232, dl)), Math.round(lerp(48, 255, dl))];
    const dirX = Math.cos(s.a), dirY = Math.sin(s.a), plX = -dirY * planeLen, plY = dirX * planeLen;
    const cols = [];
    for (let i = 0; i < NCOL; i++) {
      const camX = (2 * (i + 0.5)) / NCOL - 1;
      const rdx = dirX + plX * camX, rdy = dirY + plY * camX;
      let mx = Math.floor(s.px), my = Math.floor(s.py);
      const ddx = Math.abs(1 / (rdx || 1e-9)), ddy = Math.abs(1 / (rdy || 1e-9));
      let sx, sy, sdx, sdy;
      if (rdx < 0) { sx = -1; sdx = (s.px - mx) * ddx; } else { sx = 1; sdx = (mx + 1 - s.px) * ddx; }
      if (rdy < 0) { sy = -1; sdy = (s.py - my) * ddy; } else { sy = 1; sdy = (my + 1 - s.py) * ddy; }
      let side = 0, hit = 0, guard = 0;
      while (!hit && guard++ < 40) {
        if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
        if (mx < 0 || my < 0 || mx >= OW_N || my >= OW_N) { hit = 5; break; }
        hit = s.w.m[my][mx];
      }
      const dist = Math.max(0.05, side === 0 ? sdx - ddx : sdy - ddy);
      s.z[i] = dist;
      const unit = (AREA_H * 0.92) / dist;
      const bottom = HOR + 0.5 * unit;
      const top = HOR - (OW_H[hit] - 0.5) * unit;
      const fog = Math.pow(dist / 21, 2);
      const sideK = side ? 0.78 : 1;
      const vr = 0.92 + ((mx * 73 + my * 151) % 17) / 100;
      const L = light * sideK * vr;
      const parts = [];
      const push = (y0, y1, c) => { if (y1 - y0 > 0.5) parts.push({ y: y0, h: y1 - y0, c: owShade(c, L, fog, fogC) }); };
      if (hit === 1) { const tt = bottom - 0.55 * unit; push(tt, bottom, OW_COL.trunk); push(top, tt, OW_COL.leaf); }
      else if (hit === 2) push(top, bottom, OW_COL.rock);
      else if (hit === 3) { const rf = top + 0.32 * unit; push(rf, bottom, OW_COL.wall); push(top, rf, OW_COL.roof); const wy = bottom - 0.75 * unit; if (((i + mx) % 5) < 2) push(wy, wy + 0.3 * unit, [90, 140, 200]); }
      else if (hit === 4) { const bd = top + 0.4 * unit; push(bd, bottom, OW_COL.tower); push(top, bd, OW_COL.band); }
      else { const sn = top + 0.7 * unit; push(sn, bottom, OW_COL.mount); push(top, sn, OW_COL.snow); }
      cols.push(parts);
    }
    s.cols = cols; s.light = light; s.fogC = fogC; s.dl = dl;
    // sprites
    const det = plX * dirY - dirX * plY;
    const inv = 1 / det; const sp = [];
    for (const e of s.ents) {
      if (e.gone) continue;
      const rx = e.x - s.px, ry = e.y - s.py;
      if (rx * rx + ry * ry > 17 * 17) continue;
      const tx = inv * (dirY * rx - dirX * ry), ty = inv * (-plY * rx + plX * ry);
      if (ty < 0.25) continue;
      const sxp = (AREA_W / 2) * (1 + tx / ty);
      const col = clamp(Math.floor(sxp / CW), 0, NCOL - 1);
      if (s.z[col] < ty - 0.15) continue;
      const size = (AREA_H * 0.92 * e.s) / ty;
      const ground = HOR + (0.5 * AREA_H * 0.92) / ty;
      const bob = e.kind === 'gem' || e.kind === 'coin' ? Math.sin(s.t * 3 + e.ph) * 0.06 + 0.12 : 0;
      sp.push({ id: e.id, e: e.e, x: sxp, y: ground - size - bob * (AREA_H * 0.92) / ty, size, ty, fog: Math.pow(ty / 21, 2), kind: e.kind });
    }
    sp.sort((a, b) => b.ty - a.ty);
    s.sprites = sp;
  };
  if (!g.current.cols.length) cast(g.current);

  const start = () => { fx.clear(); const s = initState(); g.current = s; cast(s); if (glRef.current) glRef.current.setWorld(s.w); setPhase('play'); };
  const finish = (s, won, why) => {
    const sc = s.gems * 100 + s.coins * 10 + (won ? 500 : 0);
    s.final = sc; if (won) hx.win(); else hx.die();
    setRes({ isNew: submitBest(sc), won, why }); setPhase(won ? 'win' : 'over');
  };
  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt; s.tod = (s.tod + dt / 160) % 1; s.inv = Math.max(0, s.inv - dt);
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    // giro y movimiento
    s.a += look.x * 2.7 * dt;
    const spd = (sprint.on ? 4.4 : 2.7) * dt;
    const fwd = -move.y * spd, str = move.x * spd * 0.8;
    const dx = Math.cos(s.a) * fwd - Math.sin(s.a) * str, dy = Math.sin(s.a) * fwd + Math.cos(s.a) * str;
    const ox = s.px, oy = s.py; tryMove(s, s.px + dx, s.py + dy, 0.34);
    const moved = Math.hypot(s.px - ox, s.py - oy); s.dist += moved; s.bob += moved * 9;
    const night = daylight(s) < 0.3;
    // entidades
    s.wolfT -= dt;
    if (night && s.wolfT <= 0 && s.ents.filter(e => e.kind === 'wolf' && !e.gone).length < 3) {
      s.wolfT = 7;
      for (let k = 0; k < 20; k++) { const a = rand(0, 6.28), r = rand(9, 13); const x = s.px + Math.cos(a) * r, y = s.py + Math.sin(a) * r; if (!blocked(s, x, y)) { s.ents.push({ id: uid(), kind: 'wolf', e: '🐺', x, y, s: 0.5, ph: 0 }); break; } }
    }
    for (const e of s.ents) {
      if (e.gone) continue;
      const d = Math.hypot(e.x - s.px, e.y - s.py);
      if (e.kind === 'gem' || e.kind === 'coin') {
        if (d < 0.55) {
          e.gone = true; hx.good();
          if (e.kind === 'gem') { s.gems += 1; s.toast = { m: `💎 Cristal ${s.gems}/${TOTAL_GEMS}`, t: 1.6 }; fx.flash(C.cyan, 0.2); if (s.gems >= TOTAL_GEMS) { finish(s, true); return; } } else { s.coins += 1; hx.tick(); }
        }
      } else if (e.kind === 'animal') {
        e.tm -= dt; if (e.tm <= 0) { e.a = rand(0, 6.28); e.tm = rand(1.5, 4); }
        const nx = e.x + Math.cos(e.a) * 0.5 * dt, ny = e.y + Math.sin(e.a) * 0.5 * dt;
        if (blocked(s, nx, ny)) e.a += 2; else { e.x = nx; e.y = ny; }
      } else if (e.kind === 'wolf') {
        if (!night && Math.random() < dt * 0.5) { e.gone = true; continue; }
        if (d > 28) { e.gone = true; continue; }
        const sp = (d < 11 ? 2.1 : 0.8) * dt; const ux = (s.px - e.x) / (d || 1), uy = (s.py - e.y) / (d || 1);
        const nx = e.x + (d < 11 ? ux : Math.cos(s.t + e.id)) * sp, ny = e.y + (d < 11 ? uy : Math.sin(s.t + e.id)) * sp;
        if (!blocked(s, nx, ny)) { e.x = nx; e.y = ny; } else { if (!blocked(s, nx, e.y)) e.x = nx; else if (!blocked(s, e.x, ny)) e.y = ny; }
        if (d < 0.7 && s.inv <= 0) { s.hp -= 1; s.inv = 1.6; hx.bad(); fx.shake(8, 0.3); fx.flash(C.red, 0.35); s.toast = { m: '🐺 ¡Un lobo te mordió!', t: 1.4 }; e.x -= ux * 1.5; e.y -= uy * 1.5; if (s.hp <= 0) { finish(s, false, 'lobos'); return; } }
      }
    }
    s.ents = s.ents.filter(e => !e.gone);
    s.dl = daylight(s);
    if (!glOnRef.current) cast(s);
  });
  const onCtx = async gl => {
    const stop = { v: false }; stopRef.current = stop;
    try {
      const THREE = require('three');
      const world = createGLWorld({ gl, THREE, world: g.current.w, aspectRatio: AREA_W / AREA_H });
      glRef.current = world; let n = 0;
      const tick = () => {
        if (stop.v) { world.dispose(); return; }
        try { world.sync(g.current); world.render(); n += 1; if (n === 14 && GL_PROBE && !world.probe()) throw new Error('pantalla vacía'); } catch (e) { stop.v = true; glRef.current = null; setGlFail(String((e && e.message) || e)); return; }
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { glRef.current = null; setGlFail(String((e && e.message) || e)); }
  };
  const GLV = GLViewC.current;
  const s = g.current;
  // brújula hacia el cristal más cercano
  let near = null, nd = 1e9;
  s.ents.forEach(e => { if (e.kind === 'gem') { const d = Math.hypot(e.x - s.px, e.y - s.py); if (d < nd) { nd = d; near = e; } } });
  const ang = near ? Math.atan2(near.y - s.py, near.x - s.px) - s.a : 0;
  const dl = s.dl != null ? s.dl : 1; const fogC = s.fogC || [205, 232, 255];
  const skyTop = [Math.round(lerp(4, 82, dl)), Math.round(lerp(6, 160, dl)), Math.round(lerp(26, 235, dl))];
  const skyBands = 7; const floorBands = 8;
  const gl = [Math.round(lerp(10, 60, dl)), Math.round(lerp(26, 150, dl)), Math.round(lerp(16, 64, dl))];
  const sunA = s.tod * Math.PI * 2; const sunH = Math.sin(sunA);
  const azim = (Math.PI * 0.35) - s.a; const rel = Math.atan2(Math.sin(azim), Math.cos(azim));
  const celX = AREA_W / 2 + (Math.tan(rel) / planeLen) * (AREA_W / 2);
  const showCel = Math.abs(rel) < 0.85;
  const mm = (v, r) => ({ left: r + v.x * r - 17, top: r + v.y * r - 17 });
  const pad = (v, cx, label) => (
    <View style={{ position: 'absolute', left: cx - 62, bottom: 10, width: 124, height: 124, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
      <View style={{ width: 108, height: 108, borderRadius: 54, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' }} />
      <View style={{ position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: v.on ? 'rgba(34,230,255,0.55)' : 'rgba(255,255,255,0.22)', borderWidth: 2, borderColor: '#fff8', left: 62 - 20 + v.x * 46, top: 62 - 20 + v.y * 46 }} />
      <Text style={{ position: 'absolute', bottom: -2, color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{label}</Text>
    </View>
  );
  const sc = s.gems * 100 + s.coins * 10;
  return (
    <GameScreen title="MUNDO 3D" emoji="🌍" accent={C.lime} onExit={onExit} score={sc} best={best}
      hud={<><Lives n={s.hp} max={3} /><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>💎 {s.gems}/{TOTAL_GEMS}  🪙 {s.coins}</Text><Text style={{ color: dl < 0.3 ? C.violet : C.amber, fontWeight: '900', fontSize: 12 }}>{dl < 0.3 ? '🌙 NOCHE' : '☀️ DÍA'}</Text></>}>
      <PlayArea fx={fx} bg="#000">
        {useGL && GLV && <GLV style={StyleSheet.absoluteFill} onContextCreate={onCtx} />}
        {!useGL && <>
        {/* cielo */}
        {Array.from({ length: skyBands }, (_, i) => { const k = i / (skyBands - 1); const c = [lerp(skyTop[0], fogC[0], k), lerp(skyTop[1], fogC[1], k), lerp(skyTop[2], fogC[2], k)]; return <View key={`s${i}`} style={{ position: 'absolute', left: 0, top: (HOR / skyBands) * i, width: AREA_W, height: HOR / skyBands + 1, backgroundColor: `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})` }} />; })}
        {showCel && <Text style={{ position: 'absolute', left: celX - 26, top: HOR - 40 - Math.abs(sunH) * AREA_H * 0.32, width: 52, textAlign: 'center', fontSize: 40, lineHeight: 48, opacity: 0.95 }}>{sunH > 0 ? '☀️' : '🌙'}</Text>}
        {/* suelo */}
        {Array.from({ length: floorBands }, (_, i) => { const k = i / (floorBands - 1); const c = [lerp(fogC[0], gl[0], Math.pow(k, 0.6)), lerp(fogC[1], gl[1], Math.pow(k, 0.6)), lerp(fogC[2], gl[2], Math.pow(k, 0.6))]; const y0 = HOR + ((AREA_H - HOR) / floorBands) * i; return <View key={`f${i}`} style={{ position: 'absolute', left: 0, top: y0, width: AREA_W, height: (AREA_H - HOR) / floorBands + 1, backgroundColor: `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})` }} />; })}
        {/* paredes */}
        {s.cols.map((parts, i) => parts.map((p, k) => <View key={`${i}-${k}`} style={{ position: 'absolute', left: i * CW, top: p.y, width: CW + 0.8, height: p.h, backgroundColor: p.c }} />))}
        {/* sprites */}
        {s.sprites.map(sp => <Text key={sp.id} style={{ position: 'absolute', left: sp.x - sp.size, top: sp.y, width: sp.size * 2, textAlign: 'center', fontSize: Math.max(8, sp.size * 0.9), lineHeight: sp.size * 1.15, opacity: clamp(1 - sp.fog * 0.8, 0.25, 1), ...(sp.kind === 'gem' ? tglow(C.cyan, 8) : null) }}>{sp.e}</Text>)}
        </>}
        {s.inv > 0 && <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,60,80,0.18)' }} />}
        {dl < 0.3 && <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,30,0.12)' }} />}
        {/* brújula */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: C.cyan, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang + Math.PI / 2}rad` }] }}>▲</Text>
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 12, marginLeft: 8 }}>{near ? `Cristal a ${Math.round(nd)} m` : '¡Todos los cristales!'}</Text>
          </View>
        </View>
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: 48, width: AREA_W, textAlign: 'center', color: '#fff', fontWeight: '900', fontSize: 14, ...tglow('#000', 6) }}>{s.toast.m}</Text>}
        {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.28, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow('#000', 8) }}>{s.banner.text}</Text>}
        {/* mira */}
        <View pointerEvents="none" style={{ position: 'absolute', left: AREA_W / 2 - 3, top: HOR - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' }} />
        {/* controles */}
        {phase === 'play' && (
          <>
            <TouchStick testID="ow-move" v={move} R={46} style={{ position: 'absolute', left: 0, bottom: 0, width: AREA_W * 0.42, height: 170 }} />
            <TouchStick testID="ow-look" v={look} R={46} style={{ position: 'absolute', right: 0, bottom: 0, width: AREA_W * 0.42, height: 170 }} />
            {pad(move, 62 + 0, 'MOVER')}
            {pad(look, AREA_W - 62, 'GIRAR')}
            <TouchBtn testID="ow-sprint" onDown={() => { sprint.on = true; }} onUp={() => { sprint.on = false; }} style={{ position: 'absolute', left: AREA_W / 2 - 30, bottom: 16, width: 60, height: 60 }}>
              <View style={{ flex: 1, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: sprint.on ? 'rgba(255,194,51,0.5)' : 'rgba(255,194,51,0.2)', borderWidth: 2, borderColor: alpha(C.amber, 0.8) }}><Text style={{ fontSize: 26 }}>🏃</Text></View>
            </TouchBtn>
            <Pressable testID="ow-end" onPress={() => finish(s, false, 'fin')} style={{ position: 'absolute', right: 8, top: 8 }} hitSlop={8}>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: C.line }}><Text style={{ color: C.dim, fontSize: 11, fontWeight: '800' }}>🏁 TERMINAR</Text></View>
            </Pressable>
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'win' ? '🏆' : phase === 'over' ? (res.why === 'lobos' ? '🐺' : '🌍') : '🌍'}
          title={phase === 'win' ? '¡TODOS LOS CRISTALES!' : phase === 'over' ? (res.why === 'lobos' ? 'DEVORADO POR LOBOS' : 'EXPEDICIÓN TERMINADA') : 'MUNDO ABIERTO 3D'}
          subtitle={phase === 'ready' ? 'Explora un mundo en primera persona' : `💎 ${s.gems}/${TOTAL_GEMS} · 🪙 ${s.coins} · ${Math.round(s.dist)} m recorridos`}
          score={s.final != null && phase !== 'ready' ? s.final : sc} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          extra={GLViewC.current ? <View style={{ marginTop: 12 }}><Btn testID="ow-gfx" label={useGL ? '🎮 GRÁFICOS 3D (GPU)' : '🧱 MODO COMPATIBLE'} small ghost color={C.lime} onPress={() => setGlFail(f => !f)} />{typeof glFail === 'string' && <Text selectable style={{ color: C.red, fontSize: 10, marginTop: 6, textAlign: 'center' }}>{glFail.slice(0, 200)}</Text>}</View> : null}
          lines={phase === 'ready' ? ['Joystick izquierdo: moverte · derecho: girar la cámara', '🏃 mantén pulsado para correr', 'Encuentra 20 💎 (la brújula te guía) y junta 🪙', 'De noche salen 🐺: corre o escóndete tras las casas', 'Aldeas, bosques, torres y montañas por descubrir'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HOST 3D COMPARTIDO (three.js sobre expo-gl) para MOTO 3D y AVIÓN 3D
// ═══════════════════════════════════════════════════════════════════
let _GLV;
const getGLView = () => { if (_GLV === undefined) { try { _GLV = require('expo-gl').GLView; require('three'); } catch (e) { _GLV = null; } } return _GLV; };
function GL3D({ create, getState, onFail }) {
  const GLV = getGLView();
  const stop = useRef(null);
  useEffect(() => () => { if (stop.current) stop.current.v = true; }, []);
  const onCtx = gl => {
    const st = { v: false }; stop.current = st;
    try {
      const THREE = require('three');
      const scene = create({ gl, THREE, getState, aspect: AREA_W / AREA_H });
      let n = 0;
      const tick = () => {
        if (st.v) { scene.dispose(); return; }
        try { scene.frame(); if (gl.endFrameEXP) gl.endFrameEXP(); n += 1; if (n === 14 && GL_PROBE && !scene.probe()) throw new Error('pantalla vacía'); } catch (e) { st.v = true; onFail(String((e && e.message) || e)); return; }
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { onFail(String((e && e.message) || e)); }
  };
  if (!GLV) return null;
  return <GLV style={StyleSheet.absoluteFill} onContextCreate={onCtx} />;
}
function NoGL({ accent, err, onRetry }) {
  return (
    <View style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(10,10,20,0.9)' }}>
      <Text style={{ fontSize: 48 }}>🛠️</Text>
      <Text style={{ color: accent, fontWeight: '900', fontSize: 16, marginTop: 8, textAlign: 'center' }}>Este juego necesita gráficos 3D (OpenGL)</Text>
      <Text style={{ color: C.dim, fontSize: 12, marginTop: 6, textAlign: 'center' }}>No se pudo iniciar la GPU. Prueba reintentar o cerrar y abrir la app.</Text>
      {!!err && <Text selectable style={{ color: C.red, fontSize: 10, marginTop: 8, textAlign: 'center' }}>{err.slice(0, 220)}</Text>}
      {onRetry && <View style={{ marginTop: 12 }}><Btn testID="gl-retry" label="🔄 REINTENTAR" small ghost color={accent} onPress={onRetry} /></View>}
    </View>
  );
}
// botón de mantener pulsado (multi-touch)
function HoldBtn({ testID, hold, k, label, color, style }) {
  const on = hold[k];
  return (
    <TouchBtn testID={testID} onDown={() => { hold[k] = true; }} onUp={() => { hold[k] = false; }} style={style}>
      <View style={{ flex: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? alpha(color, 0.42) : 'rgba(0,0,0,0.28)', borderWidth: 2, borderColor: alpha(color, on ? 1 : 0.6) }}>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', ...tglow(color, 6) }}>{label}</Text>
      </View>
    </TouchBtn>
  );
}

// Motor 3D genérico: cada juego pasa su lista de objetos 2D y se dibujan en 3D

// ═══════════════════════════════════════════════════════════════════
// MOTO 3D – carretera infinita en primera persona
// ═══════════════════════════════════════════════════════════════════
const MT_LANES = [-5.4, -1.8, 1.8, 5.4];          // izq: sentido contrario · der: tu sentido
const MT_COLORS = [0xe63946, 0x2a9df4, 0xffc233, 0x8ac926, 0xf5f5f5, 0x6a4c93, 0xff7f11, 0x222831];
function Moto3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('moto3d');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const [glFail, setGlFail] = useState(false);
  const hold = useRef({ l: false, r: false, brake: false, nitro: false }).current;
  const init = () => ({ z: 0, x: 3.6, speed: 0, lean: 0, cars: [], turbo: 0, nitro: 40, offroad: false, t: 0, dist: 0, bonus: 0, near: 0, spawnT: 0, toast: null, final: null });
  const g = useRef(null);
  if (!g.current) g.current = init();
  const getState = useRef(() => g.current).current;
  const start = () => { fx.clear(); g.current = init(); g.current.speed = 14; setPhase('play'); hx.tap(); };
  const crash = s => { s.speed = 0; s.final = Math.floor(s.dist / 2) + s.bonus; hx.die(); fx.shake(14, 0.5); fx.flash(C.red, 0.5); setRes({ isNew: submitBest(s.final) }); setPhase('over'); };
  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    const maxSp = Math.min(62, 36 + s.t * 0.35);
    const useNitro = hold.nitro && s.nitro > 0;
    if (useNitro) { s.nitro = Math.max(0, s.nitro - 30 * dt); s.turbo = 0.3; } else s.turbo = Math.max(0, s.turbo - dt);
    const target = hold.brake ? 12 : s.offroad ? 16 : useNitro ? maxSp * 1.35 : maxSp;
    s.speed += clamp(target - s.speed, -32 * dt, (useNitro ? 22 : 8) * dt);
    const dir = (hold.r ? 1 : 0) - (hold.l ? 1 : 0);
    s.lean = lerp(s.lean, dir, Math.min(1, dt * 6));
    s.x = clamp(s.x + s.lean * (7 + s.speed * 0.16) * dt, -9.5, 9.5);
    s.offroad = Math.abs(s.x) > 7.2;
    const dz = s.speed * dt; s.z += dz; s.dist += dz;
    // tráfico
    s.spawnT -= dt;
    if (s.spawnT <= 0) {
      s.spawnT = Math.max(0.35, 1.1 - s.t * 0.012) * rand(0.6, 1.3);
      const lane = pick(MT_LANES); const onc = lane < 0;
      const far = s.z + (onc ? rand(240, 290) : rand(200, 250));
      if (!s.cars.some(c => c.x === lane && Math.abs(c.z - far) < 22)) s.cars.push({ id: uid(), x: lane, z: far, v: onc ? -rand(16, 26) : rand(9, 18), color: pick(MT_COLORS), passed: false });
    }
    for (const c of s.cars) {
      const prevRel = c.z - (s.z - dz); c.z += c.v * dt;
      // los autos de tu carril frenan si alcanzan a otro
      if (c.v > 0) for (const o of s.cars) if (o !== c && o.x === c.x && o.z > c.z && o.z - c.z < 9) c.v = Math.min(c.v, o.v);
      const rel = c.z - s.z, dx = Math.abs(c.x - s.x);
      if (dx < 1.3 && (Math.abs(rel) < 2.3 || (prevRel > 0) !== (rel > 0))) { crash(s); return; }
      if (!c.passed && rel < -2.3) {
        c.passed = true;
        if (dx < 2.7) { s.near += 1; const b = 50 * s.near; s.bonus += b; s.nitro = Math.min(100, s.nitro + 12); s.toast = { m: `¡ROCE! +${b}`, t: 1 }; hx.good(); fx.flash(C.amber, 0.12); }
      }
    }
    s.cars = s.cars.filter(c => { const rel = c.z - s.z; return rel > -30 && rel < 320; });
    if (s.offroad) { if (Math.random() < dt * 4) hx.tap(); s.near = 0; }
  });
  const s = g.current;
  const kmh = Math.round(s.speed * 3.6);
  const sc = s.final != null ? s.final : Math.floor(s.dist / 2) + s.bonus;
  const useGL = !!getGLView() && !glFail;
  const BW = AREA_W * 0.7;
  return (
    <GameScreen title="MOTO 3D" emoji="🏍️" accent={C.orange} onExit={onExit} score={sc} best={best}
      hud={<><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>🛣️ {(s.dist / 1000).toFixed(2)} km</Text><Text style={{ color: C.amber, fontWeight: '900', fontSize: 12 }}>🔥 x{s.near}</Text><Bar value={s.nitro} max={100} color={C.cyan} w={70} /></>}>
      <PlayArea fx={fx} bg="#f3a77a">
        {useGL ? <GL3D create={createMoto} getState={getState} onFail={m => setGlFail(m || 'error')} /> : <NoGL accent={C.orange} err={glFail || ''} onRetry={glFail ? () => setGlFail(false) : null} />}
        {s.turbo > 0 && <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, borderWidth: 10, borderColor: 'rgba(34,230,255,0.25)' }} />}
        {s.offroad && phase === 'play' && <Text pointerEvents="none" style={{ position: 'absolute', top: 54, width: AREA_W, textAlign: 'center', color: C.amber, fontWeight: '900', fontSize: 14, ...tglow('#000', 6) }}>⚠️ ¡FUERA DE LA PISTA!</Text>}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.3, width: AREA_W, textAlign: 'center', color: '#fff', fontWeight: '900', fontSize: 24, ...tglow(C.amber, 10) }}>{s.toast.m}</Text>}
        {/* manubrio y tablero */}
        <View pointerEvents="none" style={{ position: 'absolute', left: (AREA_W - BW) / 2, bottom: -26, width: BW, height: 120, alignItems: 'center', transform: [{ rotate: `${s.lean * 0.12}rad` }] }}>
          <View style={{ position: 'absolute', top: 30, left: 0, right: 0, height: 12, borderRadius: 6, backgroundColor: '#1d1d24', borderWidth: 2, borderColor: '#444' }} />
          <View style={{ position: 'absolute', top: 22, left: -4, width: 46, height: 28, borderRadius: 10, backgroundColor: '#111' }} />
          <View style={{ position: 'absolute', top: 22, right: -4, width: 46, height: 28, borderRadius: 10, backgroundColor: '#111' }} />
          <View style={{ position: 'absolute', top: 6, width: 120, height: 92, borderTopLeftRadius: 60, borderTopRightRadius: 60, backgroundColor: '#15151c', borderWidth: 2, borderColor: alpha(C.orange, 0.8), alignItems: 'center', paddingTop: 12 }}>
            <Text style={{ color: s.turbo > 0 ? C.cyan : '#fff', fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'], ...tglow(s.turbo > 0 ? C.cyan : C.orange, 8) }}>{kmh}</Text>
            <Text style={{ color: C.dim, fontSize: 9, fontWeight: '900', letterSpacing: 2 }}>KM/H</Text>
          </View>
        </View>
        {phase === 'play' && (
          <>
            <HoldBtn testID="mt-left" hold={hold} k="l" label="◀" color={C.orange} style={{ position: 'absolute', left: 8, bottom: 110, width: 74, height: 96 }} />
            <HoldBtn testID="mt-right" hold={hold} k="r" label="▶" color={C.orange} style={{ position: 'absolute', right: 8, bottom: 110, width: 74, height: 96 }} />
            <HoldBtn testID="mt-brake" hold={hold} k="brake" label="🛑" color={C.red} style={{ position: 'absolute', left: 8, bottom: 214, width: 74, height: 56 }} />
            <HoldBtn testID="mt-nitro" hold={hold} k="nitro" label="🔥" color={C.cyan} style={{ position: 'absolute', right: 8, bottom: 214, width: 74, height: 56 }} />
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? '💥' : '🏍️'} title={phase === 'over' ? '¡CHOQUE!' : 'MOTO 3D'}
          subtitle={phase === 'ready' ? 'Autopista en primera persona' : `${(s.dist / 1000).toFixed(2)} km · roces +${s.bonus}`}
          score={sc} best={best} isNew={res.isNew} accent={C.orange} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['◀ ▶ mantén pulsado para inclinarte', 'Carriles derechos: tu sentido · izquierdos: ¡contramano!', 'Pasa rozando autos: combo de puntos y nitro 🔥', '🛑 frena · 🔥 nitro (se recarga con roces)', 'Fuera del asfalto pierdes velocidad'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AVIÓN 3D – vuelo en primera persona por un cañón
// ═══════════════════════════════════════════════════════════════════
const AV_WALL = 27;
function Plane3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('plane3d');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, why: '' });
  const [glFail, setGlFail] = useState(false);
  const stick = useRef({ x: 0, y: 0, on: false }).current;
  const init = () => ({ dist: 0, speed: 0, x: 0, y: 14, vx: 0, vy: 0, roll: 0, pitch: 0, fuel: 100, objs: [], t: 0, rings: 0, combo: 0, bonus: 0, nextZ: 70, toast: null, final: null });
  const g = useRef(null);
  if (!g.current) g.current = init();
  const getState = useRef(() => g.current).current;
  const spawn = s => {
    while (s.nextZ < s.dist + 380) {
      const z = s.nextZ;
      const last = s.objs.filter(o => o.kind === 'ring').slice(-1)[0];
      const bx = last ? clamp(last.x + rand(-11, 11), -18, 18) : 0, by = last ? clamp(last.y + rand(-7, 7), 6, 32) : 14;
      s.objs.push({ id: uid(), kind: 'ring', x: bx, y: by, z, hit: false, done: false });
      if (s.t > 4 || z > 200) for (let k = 0; k < (Math.random() < 0.5 ? 1 : 2); k++) {
        const px = rand(-AV_WALL + 3, AV_WALL - 3);
        if (Math.abs(px - bx) > 7) s.objs.push({ id: uid(), kind: 'rock', x: px, z: z + rand(15, 35), r: rand(2.2, 4), h: rand(12, 40), done: false });
      }
      s.nextZ += Math.max(42, 70 - s.dist / 300);
    }
  };
  const start = () => { fx.clear(); const s = init(); s.speed = 32; spawn(s); g.current = s; setPhase('play'); hx.tap(); };
  const end = (s, why) => { s.final = s.rings * 100 + s.bonus + Math.floor(s.dist / 10); hx.die(); fx.shake(14, 0.5); fx.flash(why === 'fuel' ? C.amber : C.red, 0.5); setRes({ isNew: submitBest(s.final), why }); setPhase('over'); };
  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    s.speed = Math.min(64, 32 + s.t * 0.4);
    // stick: x = alabeo/giro · y = cabeceo (arrastrar arriba = subir)
    s.roll = lerp(s.roll, stick.x, Math.min(1, dt * 4));
    s.vx = lerp(s.vx, stick.x * 20, Math.min(1, dt * 2.5));
    s.vy = lerp(s.vy, -stick.y * 15, Math.min(1, dt * 2.5));
    s.pitch = Math.atan2(s.vy, s.speed);
    s.x += s.vx * dt; s.y = clamp(s.y + s.vy * dt, 0, 42);
    if (Math.abs(s.x) > AV_WALL) { s.x = Math.sign(s.x) * AV_WALL; s.vx *= -0.5; s.fuel -= 10; hx.bad(); fx.shake(8, 0.25); s.toast = { m: '⛰️ ¡Cuidado con el cañón!', t: 1 }; }
    if (s.y < 1.2) { end(s, 'suelo'); return; }
    const ddist = s.speed * dt; s.dist += ddist;
    s.fuel -= dt * (3.2 + s.t * 0.01);
    if (s.fuel <= 0) { s.fuel = 0; end(s, 'fuel'); return; }
    for (const o of s.objs) {
      if (o.done) continue;
      const rel = o.z - s.dist;
      if (o.kind === 'ring' && rel <= 0) {
        o.done = true; const d = Math.hypot(o.x - s.x, o.y - s.y);
        if (d < 3.4) { o.hit = true; s.rings += 1; s.combo += 1; const b = 20 * (s.combo - 1); s.bonus += b; s.fuel = Math.min(100, s.fuel + 11); hx.good(); fx.flash(C.lime, 0.12); s.toast = { m: s.combo > 1 ? `¡ANILLO! x${s.combo}` : '¡ANILLO!', t: 0.8 }; }
        else { s.combo = 0; }
      } else if (o.kind === 'rock' && Math.abs(rel) < o.r + 0.6) {
        if (Math.hypot(o.x - s.x, rel) < o.r + 0.7 && s.y < o.h) { end(s, 'roca'); return; }
      }
      if (rel < -10) o.done = true;
    }
    s.objs = s.objs.filter(o => o.z - s.dist > -15);
    spawn(s);
  });
  const s = g.current;
  const sc = s.final != null ? s.final : s.rings * 100 + s.bonus + Math.floor(s.dist / 10);
  const useGL = !!getGLView() && !glFail;
  const next = s.objs.find(o => o.kind === 'ring' && !o.done);
  const why = res.why === 'fuel' ? 'SIN COMBUSTIBLE' : res.why === 'roca' ? '¡CHOCASTE CON UNA ROCA!' : '¡TE ESTRELLASTE!';
  const hz = AREA_H * 0.42 + s.pitch * AREA_H * 0.9;
  return (
    <GameScreen title="AVIÓN 3D" emoji="✈️" accent={C.blue} onExit={onExit} score={sc} best={best}
      hud={<><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>⭕ {s.rings}  🔥 x{s.combo}</Text><Text style={{ color: s.fuel < 25 ? C.red : C.amber, fontWeight: '900', fontSize: 12 }}>⛽</Text><Bar value={s.fuel} max={100} color={s.fuel < 25 ? C.red : C.amber} w={80} /></>}>
      <PlayArea fx={fx} bg="#bfe3ff">
        {useGL ? <GL3D create={createPlane} getState={getState} onFail={m => setGlFail(m || 'error')} /> : <NoGL accent={C.blue} err={glFail || ''} onRetry={glFail ? () => setGlFail(false) : null} />}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.22, width: AREA_W, textAlign: 'center', color: '#fff', fontWeight: '900', fontSize: 22, ...tglow('#000', 8) }}>{s.toast.m}</Text>}
        {s.fuel < 25 && phase === 'play' && <Text pointerEvents="none" style={{ position: 'absolute', top: 12, width: AREA_W, textAlign: 'center', color: C.red, fontWeight: '900', fontSize: 13, opacity: Math.sin(s.t * 10) > 0 ? 1 : 0.3, ...tglow('#000', 6) }}>⛽ ¡COMBUSTIBLE BAJO! Pasa por los anillos</Text>}
        {/* mira y flecha al próximo anillo */}
        <View pointerEvents="none" style={{ position: 'absolute', left: AREA_W / 2 - 18, top: AREA_H * 0.42 - 18, width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'rgba(125,255,107,0.8)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: AREA_W / 2 - 2, top: AREA_H * 0.42 - 2, width: 4, height: 4, borderRadius: 2, backgroundColor: C.lime }} />
        {next && <Text pointerEvents="none" style={{ position: 'absolute', left: AREA_W / 2 - 60, top: AREA_H * 0.42 + 24, width: 120, textAlign: 'center', color: C.lime, fontWeight: '900', fontSize: 11, ...tglow('#000', 4) }}>{`${next.x - s.x > 3 ? '▶' : next.x - s.x < -3 ? '◀' : ''} ${next.y - s.y > 3 ? '▲' : next.y - s.y < -3 ? '▼' : ''} ${Math.round(next.z - s.dist)} m`}</Text>}
        {/* cabina */}
        <View pointerEvents="none" style={{ position: 'absolute', left: -20, right: -20, bottom: -10, height: 120, borderTopLeftRadius: 120, borderTopRightRadius: 120, backgroundColor: '#20242e', borderTopWidth: 3, borderColor: '#3a4150' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 10, backgroundColor: '#20242e' }} />
        <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 10, backgroundColor: '#20242e' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: AREA_W / 2 - 46, bottom: 14, width: 92, height: 72, borderRadius: 10, overflow: 'hidden', backgroundColor: '#6b4a2b', borderWidth: 2, borderColor: '#555' }}>
          {/* horizonte artificial */}
          <View style={{ position: 'absolute', left: -60, width: 212, top: -150 + 36 + s.pitch * 60, height: 150, backgroundColor: '#3b8fe0', transform: [{ rotate: `${-s.roll * 0.8}rad` }] }} />
          <View style={{ position: 'absolute', left: 30, top: 35, width: 32, height: 3, backgroundColor: C.amber }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: 18, bottom: 22, alignItems: 'center' }}>
          <Text style={{ color: C.dim, fontSize: 9, fontWeight: '900' }}>ALT</Text>
          <Text style={{ color: s.y < 5 ? C.red : '#fff', fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{Math.round(s.y * 10)}</Text>
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', right: 18, bottom: 22, alignItems: 'center' }}>
          <Text style={{ color: C.dim, fontSize: 9, fontWeight: '900' }}>NUDOS</Text>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{Math.round(s.speed * 4.5)}</Text>
        </View>
        {phase === 'play' && (
          <>
            <TouchStick testID="av-stick" v={stick} R={60} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
            <View pointerEvents="none" style={{ position: 'absolute', right: 16, bottom: 132, width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(0,0,0,0.12)' }}>
              <View style={{ position: 'absolute', left: 50 - 16 + stick.x * 34, top: 50 - 16 + stick.y * 34, width: 32, height: 32, borderRadius: 16, backgroundColor: stick.on ? 'rgba(42,157,244,0.7)' : 'rgba(255,255,255,0.25)', borderWidth: 2, borderColor: '#fff8' }} />
            </View>
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? (res.why === 'fuel' ? '⛽' : '💥') : '✈️'} title={phase === 'over' ? why : 'AVIÓN 3D'}
          subtitle={phase === 'ready' ? 'Vuela en primera persona por el cañón' : `⭕ ${s.rings} anillos · ${(s.dist / 1000).toFixed(2)} km`}
          score={sc} best={best} isNew={res.isNew} accent={C.blue} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra en cualquier parte de la pantalla para pilotar', 'Arriba: subir · abajo: bajar · lados: girar', 'Atraviesa los ⭕ anillos: puntos, combo y combustible', 'Esquiva las rocas y no toques el suelo', '⛽ el combustible se acaba: ¡no falles anillos!'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ═══════════════════════════════════════════════════════════════════
// REGISTRO DE JUEGOS + MENÚ
// Para añadir un juego: crea el componente y añade una entrada aquí.
// ═══════════════════════════════════════════════════════════════════
const CATEGORIES = [
  { id: 'all', label: 'TODOS' },
  { id: 'accion', label: 'ACCIÓN' },
  { id: 'arcade', label: 'ARCADE' },
  { id: 'reflejos', label: 'REFLEJOS' },
  { id: 'puzzle', label: 'PUZZLE' },
  { id: 'aventura', label: 'AVENTURA' },
];

const GAMES = [
  { id: 'neon', name: 'NEON GALAXY', emoji: '🚀', tag: 'Shooter espacial con jefes y power-ups', color: C.cyan, cat: 'accion', Comp: NeonGalaxy3D },
  { id: 'cyber', name: 'CYBER RUN', emoji: '🏃', tag: 'Corre, salta y desliza por la ciudad', color: C.pink, cat: 'accion', Comp: CyberRun3D },
  { id: 'pixel', name: 'PIXEL QUEST', emoji: '🍄', tag: 'Plataformas en 30 mundos', color: C.lime, cat: 'aventura', Comp: PixelQuest3D },
  { id: 'galactic', name: 'GALACTIC HUNT', emoji: '🛸', tag: 'Caza ovnis antes de que escapen', color: C.violet, cat: 'accion', Comp: GalacticHunt3D },
  { id: 'snake', name: 'SNAKE POWER', emoji: '🐍', tag: 'Snake con poderes y combos', color: C.lime, cat: 'arcade', Comp: SnakePower3D },
  { id: 'pingpong', name: 'PING PONG', emoji: '🏓', tag: 'Duelo contra la IA a 7 puntos', color: C.blue, cat: 'arcade', Comp: PingPong3D },
  { id: 'breakout', name: 'BREAKOUT', emoji: '🧱', tag: 'Rompe ladrillos y atrapa mejoras', color: C.orange, cat: 'arcade', Comp: Breakout3D },
  { id: 'void', name: 'VOID CRAWLER', emoji: '☠️', tag: 'Roguelike de 5 pisos', color: C.violet, cat: 'aventura', Comp: VoidCrawler3D },
  { id: 'tunnel', name: 'NEON TUNNEL', emoji: '🌀', tag: 'Vuela por el túnel y esquiva', color: C.cyan, cat: 'accion', Comp: NeonTunnel3D },
  { id: 'monster', name: 'MONSTER DUEL', emoji: '⚡', tag: 'Captura, evoluciona y combate', color: C.amber, cat: 'aventura', Comp: MonsterDuel3D },
  { id: 'gravity', name: 'GRAVITY FLIP', emoji: '🔀', tag: 'Invierte la gravedad', color: C.violet, cat: 'reflejos', Comp: GravityFlip3D },
  { id: 'tetris', name: 'NEON TETRIS', emoji: '🧊', tag: 'El clásico con pieza fantasma', color: C.cyan, cat: 'puzzle', Comp: NeonTetris3D },
  { id: 'warrior', name: 'NEON WARRIOR', emoji: '🥷', tag: 'Plataformas, doble salto, 3 niveles', color: C.pink, cat: 'accion', Comp: NeonWarrior3D },
  { id: 'craft', name: 'PIXEL CRAFT', emoji: '⛏️', tag: 'Mina, construye y sobrevive la noche', color: C.orange, cat: 'aventura', Comp: PixelCraft3D },
  { id: 'walljumper', name: 'WALL JUMPER', emoji: '🧗', tag: 'Rebota entre paredes y sube', color: C.orange, cat: 'reflejos', Comp: WallJumper3D },
  { id: 'mathrush', name: 'MATH RUSH', emoji: '🧮', tag: 'Calcula rápido y destruye', color: C.pink, cat: 'puzzle', Comp: MathRush3D },
  { id: 'neon2048', name: '2048 NEON', emoji: '🟦', tag: 'Fusiona fichas hasta el 2048', color: C.cyan, cat: 'puzzle', Comp: NeonGame2048_3D },
  { id: 'whackamole', name: 'WHACK-A-MOLE', emoji: '🐹', tag: 'Golpea topos, evita bombas', color: C.violet, cat: 'reflejos', Comp: WhackAMole3D },
  { id: 'rhythm', name: 'RITMO Y COLOR', emoji: '🎵', tag: 'Repite la secuencia', color: C.violet, cat: 'reflejos', Comp: RhythmTap3D },
  { id: 'starcatcher', name: 'STAR CATCHER', emoji: '⭐', tag: 'Atrapa estrellas, esquiva bombas', color: C.amber, cat: 'arcade', Comp: StarCatcher3D },
  { id: 'wordscramble', name: 'PALABRAS', emoji: '🔤', tag: 'Ordena las letras revueltas', color: C.violet, cat: 'puzzle', Comp: WordScramble3D },
  { id: 'crossyroad', name: 'CROSSY ROAD', emoji: '🐸', tag: 'Cruza calles, ríos y vías', color: C.lime, cat: 'arcade', Comp: CrossyRoad3D },
  { id: 'bubbleshooter', name: 'BUBBLE SHOOTER', emoji: '🫧', tag: 'Une 3 burbujas del mismo color', color: C.red, cat: 'puzzle', Comp: BubbleShooter3D },
  { id: 'flappyneon', name: 'FLAPPY NEON', emoji: '🐦', tag: 'Toca para volar entre tubos', color: C.amber, cat: 'reflejos', Comp: FlappyNeon3D },
  { id: 'memorymatch', name: 'MEMORY MATCH', emoji: '🃏', tag: 'Encuentra los pares', color: C.violet, cat: 'puzzle', Comp: MemoryMatch3D },
  { id: 'asteroidodge', name: 'ASTEROID DODGE', emoji: '☄️', tag: 'Esquiva la lluvia de rocas', color: C.cyan, cat: 'accion', Comp: AsteroidDodge3D },
  { id: 'towerstack', name: 'TOWER STACK', emoji: '🏗️', tag: 'Apila con precisión perfecta', color: C.amber, cat: 'reflejos', Comp: TowerStack3D },
  { id: 'numberpuzzle', name: '15 PUZZLE', emoji: '🧩', tag: 'Desliza y ordena los números', color: C.cyan, cat: 'puzzle', Comp: NumberPuzzle3D },
  { id: 'coincollector', name: 'COIN RUSH', emoji: '🪙', tag: 'Recoge monedas en 30 segundos', color: C.amber, cat: 'arcade', Comp: CoinCollector3D },
  { id: 'reactiontime', name: 'REFLEJOS', emoji: '⚡', tag: 'Mide tu tiempo de reacción', color: C.pink, cat: 'reflejos', Comp: ReactionTime3D },
  { id: 'colorrush', name: 'COLOR RUSH', emoji: '🎨', tag: 'Toca el color, no la palabra', color: C.pink, cat: 'reflejos', Comp: ColorRush3D },
  { id: 'pongsolo', name: 'PONG SOLO', emoji: '🎾', tag: 'Rebota la bola contra el muro', color: C.cyan, cat: 'arcade', Comp: PongSolo3D },
  { id: 'wordchain', name: 'WORD CHAIN', emoji: '🔗', tag: 'Encadena palabras por la última letra', color: C.lime, cat: 'puzzle', Comp: WordChain3D },
  { id: 'dinorun', name: 'DINO RUN', emoji: '🦖', tag: 'Salta cactus, agáchate de las aves', color: C.lime, cat: 'reflejos', Comp: DinoRun3D },
  { id: 'fruittap', name: 'FRUIT TAP', emoji: '🍉', tag: 'Corta frutas, evita bombas', color: C.lime, cat: 'reflejos', Comp: FruitTap3D },
  { id: 'pixelrpg', name: 'PIXEL RPG', emoji: '🧙', tag: 'Explora, combate y sube de nivel', color: C.amber, cat: 'aventura', Comp: PixelRPG3D },
  { id: 'openworld', name: 'MUNDO 3D', emoji: '🌍', tag: 'Mundo abierto en primera persona', color: C.lime, cat: 'aventura', Comp: OpenWorld3D },
  { id: 'moto3d', name: 'MOTO 3D', emoji: '🏍️', tag: 'Autopista 3D en primera persona', color: C.orange, cat: 'accion', Comp: Moto3D },
  { id: 'plane3d', name: 'AVIÓN 3D', emoji: '✈️', tag: 'Vuela por un cañón en primera persona', color: C.blue, cat: 'accion', Comp: Plane3D },
  { id: 'islatesoro', name: 'ISLA DEL TESORO', emoji: '🏝️', tag: 'Mundo abierto: cofres, palmeras y cangrejos', color: C.amber, cat: 'aventura', Comp: IslaTesoro3D },
  { id: 'invaders', name: 'INVASORES', emoji: '👽', tag: 'Defiende la Tierra con escudos', color: C.lime, cat: 'accion', Comp: Invaders3D },
  { id: 'skyhop', name: 'SKY HOP', emoji: '🦘', tag: 'Rebota hacia el cielo sin caer', color: C.cyan, cat: 'reflejos', Comp: SkyHop3D },
  { id: 'minesweeper', name: 'BUSCAMINAS', emoji: '💣', tag: 'Despeja el campo con lógica', color: C.red, cat: 'puzzle', Comp: Buscaminas3D },
  { id: 'connect4', name: '4 EN LÍNEA', emoji: '🔴', tag: 'Conecta cuatro contra la IA', color: C.red, cat: 'puzzle', Comp: Connect4_3D },
];

function GameCard({ g, index, best, fav, daily, onPress, onFav, cardW }) {
  const a = useRef(new Animated.Value(0)).current;
  const s = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 320, delay: Math.min(index, 14) * 35, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const to = v => Animated.spring(s, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 5 }).start();
  return (
    <Pressable testID={`menu-${g.id}`} onPress={onPress} onPressIn={() => to(0.95)} onPressOut={() => to(1)}>
      <Animated.View style={{
        width: cardW, height: 128, borderRadius: 20, padding: 12, marginBottom: 12, overflow: 'hidden',
        backgroundColor: alpha(g.color, 0.09), borderWidth: 1.5, borderColor: daily ? C.amber : alpha(g.color, 0.5),
        opacity: a, transform: [{ scale: s }, { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        ...glow(daily ? C.amber : g.color, 10, 0.35),
      }}>
        <View style={{ position: 'absolute', right: -16, top: -16, width: 84, height: 84, borderRadius: 42, backgroundColor: alpha(g.color, 0.12) }} />
        <Text style={{ fontSize: 34 }}>{g.emoji}</Text>
        <Text numberOfLines={1} style={{ color: g.color, fontSize: 14, fontWeight: '900', letterSpacing: 1, marginTop: 6 }}>{g.name}</Text>
        <Text numberOfLines={2} style={{ color: C.dim, fontSize: 11, lineHeight: 15, marginTop: 2, paddingRight: 18 }}>{g.tag}</Text>
        {best > 0 && (
          <View style={{ position: 'absolute', right: 8, top: 8, backgroundColor: alpha('#000000', 0.45), borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ color: C.amber, fontSize: 11, fontWeight: '800' }}>🏆 {best}</Text>
          </View>
        )}
        {daily && <View style={{ position: 'absolute', left: 8, top: 8, backgroundColor: C.amber, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ color: '#04040c', fontSize: 9, fontWeight: '900' }}>🎯 RETO</Text></View>}
        <Pressable testID={`fav-${g.id}`} onPress={onFav} hitSlop={10} style={{ position: 'absolute', right: 8, bottom: 6 }}>
          <Text style={{ fontSize: 18, opacity: fav ? 1 : 0.35 }}>{fav ? '⭐' : '☆'}</Text>
        </Pressable>
      </Animated.View>
    </Pressable>
  );
}

const dayHash = () => { const d = new Date(); let h = d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate(); h = (h * 2654435761) >>> 0; return h; };

function Panel({ title, onClose, children }) {
  return (
    <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: C.bg, zIndex: 50, alignItems: 'center' }}>
      <View style={{ width: Math.min(width, 520), flex: 1, paddingHorizontal: 18, paddingTop: 50 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
          <Text style={{ color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: 2, flex: 1 }}>{title}</Text>
          <Btn testID="panel-close" label="CERRAR" small ghost color={C.dim} onPress={onClose} />
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>{children}</ScrollView>
      </View>
    </View>
  );
}

function Toggle({ label, sub, on, onPress, testID }) {
  return (
    <Pressable testID={testID} onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, marginBottom: 10, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line }}>
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: '800', fontSize: 15 }}>{label}</Text><Text style={{ color: C.dim, fontSize: 12 }}>{sub}</Text></View>
        <View style={{ width: 52, height: 30, borderRadius: 15, backgroundColor: on ? C.lime : '#2a2e52', justifyContent: 'center', padding: 3 }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', alignSelf: on ? 'flex-end' : 'flex-start' }} />
        </View>
      </View>
    </Pressable>
  );
}

function Menu({ onPick }) {
  const [cat, setCat] = useState('all');
  const [bests, setBests] = useState({});
  const [panel, setPanel] = useState(null);       // null | settings | ach
  const [confirm, setConfirm] = useState(false);
  const prof = useProfile();
  const [settings, setSetting] = useSettings();
  const daily = GAMES[dayHash() % GAMES.length];
  useEffect(() => { Profile.setTotal(GAMES.length); Profile.setDaily(daily.id); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadBests = () => {
    AsyncStorage.multiGet(GAMES.map(g => `@best:${g.id}`)).then(rows => {
      const o = {};
      rows.forEach(([k, v]) => { if (v) o[k.slice(6)] = parseFloat(v) || 0; });
      setBests(o);
    }).catch(() => {});
  };
  useEffect(loadBests, []);
  const list = GAMES.filter(g => cat === 'all' || (cat === 'fav' ? prof.favs[g.id] : g.cat === cat));
  const cardW = (Math.min(width, 520) - 16 * 2 - 12) / 2;
  const played = Object.keys(bests).length;
  const lv = levelInfo(prof.xp);
  const achN = Object.keys(prof.ach).length;
  const dailyDone = prof.daily.done && prof.daily.date !== '';
  const surprise = () => { hx.tap(); onPick(GAMES[Math.floor(Math.random() * GAMES.length)].id); };
  const cats = [...CATEGORIES.slice(0, 1), { id: 'fav', label: '⭐ FAVORITOS' }, ...CATEGORIES.slice(1)];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ width: Math.min(width, 520), paddingHorizontal: 16, paddingTop: 22 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 30, fontWeight: '900', letterSpacing: 2, ...tglow(C.cyan, 16) }}>ARCADE<Text style={{ color: C.cyan }}> HUB</Text></Text>
              <Text style={{ color: C.dim, fontSize: 13, marginTop: 2 }}>{GAMES.length} juegos · {played} con récord</Text>
            </View>
            <Pressable testID="open-ach" onPress={() => { hx.tick(); setPanel('ach'); }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}><Text style={{ fontSize: 20 }}>🏆</Text></Pressable>
            <Pressable testID="open-settings" onPress={() => { hx.tick(); setPanel('settings'); }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 20 }}>⚙️</Text></Pressable>
          </View>

          <View style={{ marginTop: 14, padding: 12, borderRadius: 18, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: alpha(C.cyan, 0.15), borderWidth: 2, borderColor: C.cyan, alignItems: 'center', justifyContent: 'center', ...glow(C.cyan, 8, 0.5) }}><Text style={{ color: C.cyan, fontSize: 18, fontWeight: '900' }}>{lv.level}</Text></View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>Nivel {lv.level} <Text style={{ color: C.dim, fontWeight: '700', fontSize: 12 }}>· {lv.into}/{lv.need} XP</Text></Text>
                <Bar value={lv.into} max={lv.need} color={C.cyan} h={8} style={{ marginTop: 6 }} />
              </View>
              <View style={{ alignItems: 'flex-end', marginLeft: 10 }}>
                <Text style={{ color: C.amber, fontWeight: '900', fontSize: 13 }}>🔥 {prof.streak}</Text>
                <Text style={{ color: C.dim, fontSize: 11 }}>🏅 {achN}/{ACHIEVEMENTS.length}</Text>
              </View>
            </View>
          </View>

          <Pressable testID="daily" onPress={() => { hx.tap(); onPick(daily.id); }} style={{ borderRadius: 18, padding: 14, marginTop: 12, backgroundColor: alpha(C.amber, dailyDone ? 0.05 : 0.12), borderWidth: 1.5, borderColor: alpha(C.amber, dailyDone ? 0.35 : 0.8), flexDirection: 'row', alignItems: 'center', ...glow(C.amber, 12, dailyDone ? 0.15 : 0.45) }}>
            <Text style={{ fontSize: 30, marginRight: 12 }}>{daily.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.amber, fontSize: 12, fontWeight: '900', letterSpacing: 2 }}>🎯 RETO DEL DÍA {dailyDone ? '· ¡CUMPLIDO!' : '· +50 XP'}</Text>
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>{daily.name}</Text>
              <Text style={{ color: C.dim, fontSize: 11 }}>{dailyDone ? 'Vuelve mañana para mantener tu racha' : 'Termina una partida hoy para sumar racha'}</Text>
            </View>
            <Text style={{ color: C.amber, fontSize: 22 }}>{dailyDone ? '✓' : '›'}</Text>
          </Pressable>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 14 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }}>
              {cats.map(c => {
                const on = cat === c.id;
                return (
                  <Pressable key={c.id} testID={`cat-${c.id}`} onPress={() => { hx.tick(); setCat(c.id); }}
                    style={{ paddingHorizontal: 13, paddingVertical: 7, borderRadius: 16, backgroundColor: on ? C.cyan : C.panel2, borderWidth: 1, borderColor: on ? C.cyan : C.line }}>
                    <Text style={{ color: on ? '#04040c' : C.dim, fontSize: 12, fontWeight: '900', letterSpacing: 1 }}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <Pressable testID="surprise" onPress={surprise} style={{ borderRadius: 18, padding: 14, marginBottom: 14, backgroundColor: alpha(C.pink, 0.12), borderWidth: 1.5, borderColor: alpha(C.pink, 0.6), flexDirection: 'row', alignItems: 'center', ...glow(C.pink, 12, 0.4) }}>
            <Text style={{ fontSize: 26, marginRight: 12 }}>🎲</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.pink, fontSize: 15, fontWeight: '900', letterSpacing: 1 }}>SORPRÉNDEME</Text>
              <Text style={{ color: C.dim, fontSize: 12 }}>Un juego al azar</Text>
            </View>
            <Text style={{ color: C.pink, fontSize: 22 }}>›</Text>
          </Pressable>

          {cat === 'fav' && list.length === 0 && <Text style={{ color: C.dim, textAlign: 'center', marginVertical: 24 }}>Marca juegos con ☆ para verlos aquí.</Text>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {list.map((g, i) => (
              <GameCard key={g.id + cat} g={g} index={i} cardW={cardW} best={bests[g.id] || 0} fav={!!prof.favs[g.id]} daily={g.id === daily.id && !dailyDone}
                onPress={() => { hx.tap(); onPick(g.id); }} onFav={() => { hx.tick(); Profile.toggleFav(g.id); }} />
            ))}
          </View>
        </View>
      </ScrollView>

      {panel === 'settings' && (
        <Panel title="⚙️ AJUSTES" onClose={() => { setPanel(null); setConfirm(false); }}>
          <Toggle testID="tg-sound" label="🔊 Sonido" sub="Efectos de sonido en los juegos" on={settings.sound} onPress={() => setSetting('sound', !settings.sound)} />
          <Toggle testID="tg-haptics" label="📳 Vibración" sub="Respuesta háptica al jugar" on={settings.haptics} onPress={() => setSetting('haptics', !settings.haptics)} />
          <View style={{ marginTop: 16, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: alpha(C.red, 0.5), backgroundColor: alpha(C.red, 0.06) }}>
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 15 }}>Borrar progreso</Text>
            <Text style={{ color: C.dim, fontSize: 12, marginVertical: 6 }}>Elimina récords, nivel, logros y favoritos (no borra las partidas guardadas de los juegos de aventura).</Text>
            <Btn testID="reset" label={confirm ? 'TOCA DE NUEVO PARA CONFIRMAR' : 'BORRAR TODO'} small ghost color={C.red} onPress={() => { if (!confirm) { setConfirm(true); hx.warn(); } else { Profile.reset().then(() => { setBests({}); setConfirm(false); toast('Progreso borrado', '🗑️'); }); } }} />
          </View>
          <Text style={{ color: alpha(C.dim, 0.7), fontSize: 11, textAlign: 'center', marginTop: 24 }}>Arcade Hub · {GAMES.length} juegos</Text>
        </Panel>
      )}
      {panel === 'ach' && (
        <Panel title="🏆 LOGROS" onClose={() => setPanel(null)}>
          <Text style={{ color: C.dim, fontSize: 12, marginBottom: 12 }}>{achN} de {ACHIEVEMENTS.length} desbloqueados · cada logro da +30 XP</Text>
          {ACHIEVEMENTS.map(a => {
            const ok = !!prof.ach[a.id];
            return (
              <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, marginBottom: 8, backgroundColor: ok ? alpha(C.amber, 0.1) : C.panel2, borderWidth: 1, borderColor: ok ? alpha(C.amber, 0.7) : C.line, opacity: ok ? 1 : 0.6 }}>
                <Text style={{ fontSize: 28, marginRight: 12 }}>{ok ? a.emoji : '🔒'}</Text>
                <View style={{ flex: 1 }}><Text style={{ color: ok ? C.amber : C.text, fontWeight: '900' }}>{a.name}</Text><Text style={{ color: C.dim, fontSize: 12 }}>{a.desc}</Text></View>
                {ok && <Text style={{ color: C.lime, fontWeight: '900' }}>✓</Text>}
              </View>
            );
          })}
        </Panel>
      )}
    </SafeAreaView>
  );
}

export default function App() {
  const [screen, setScreen] = useState('menu');
  const g = GAMES.find(x => x.id === screen);
  const G = g ? g.Comp : null;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {g ? (
        <GameCtx.Provider value={g.id}><G key={g.id} onExit={() => setScreen('menu')} /></GameCtx.Provider>
      ) : <Menu onPick={setScreen} />}
      <ToastHost />
    </View>
  );
}
















