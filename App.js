import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Dimensions, Easing, StyleSheet, Text, View,
} from 'react-native';
import { C, GameCtx } from './utils/kit';
import { Breakout3D } from './games3d/breakout';
import { IslaTesoro3D } from './games3d/islatesoro';
import { Plane3DGame } from './games3d/plane3d';
import { Moto3DGame } from './games3d/moto3d';
import { OpenWorld3DGame } from './games3d/openworld';
import { Safari3D } from './games3d/safari';
import { Granja3D } from './games3d/granja';
import { Rally3D } from './games3d/kart';
import { Reparto3D } from './games3d/reparto';
import { Dragon3D } from './games3d/dragon';
import { Planeta3D } from './games3d/planeta';
import { Cazafantasmas3D } from './games3d/fantasmas';
import { Zombis3D } from './games3d/zombis';
import { Parkour3D } from './games3d/parkour';
import { Pesca3D } from './games3d/pesca';
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
import { ToastHost } from './utils/meta';
import { Menu3D } from './ui/Menu3D';
import { useApplyQuality } from './ui/Panels3D';

const { width, height } = Dimensions.get('window');


// ─────────────────────────────────────────────────────────────────



// ==========================================
// 3. PIXEL QUEST (plataformas de 30 mundos)
// ==========================================




// ==========================================
// 4. PING PONG
// ==========================================

// ==========================================
// 5. BREAKOUT
// ==========================================

// ==========================================


// ─── VOID CRAWLER ─────────────────────────────────────────────────




// ─── MONSTER DUEL ─────────────────────────────────────────────────







// ─── NEON WARRIOR ─────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────

// ─── INVASORES ────────────────────────────────────────────────────

// ─── SKY HOP ──────────────────────────────────────────────────────

// ─── BUSCAMINAS ───────────────────────────────────────────────────

// ─── 4 EN LÍNEA ───────────────────────────────────────────────────

// ─── MUNDO ABIERTO 3D ─────────────────────────────────────────────
// En iOS el framebuffer de expo-gl es multisample (MSAA) y readPixels siempre devuelve negro,
// así que la prueba de "pantalla vacía" solo es fiable en web.


// ═══════════════════════════════════════════════════════════════════
// HOST 3D COMPARTIDO (three.js sobre expo-gl) para MOTO 3D y AVIÓN 3D
// ═══════════════════════════════════════════════════════════════════
let _GLV;
const getGLView = () => { if (_GLV === undefined) { try { _GLV = require('expo-gl').GLView; require('three'); } catch (e) { _GLV = null; } } return _GLV; };
// botón de mantener pulsado (multi-touch)

// Motor 3D genérico: cada juego pasa su lista de objetos 2D y se dibujan en 3D

// ═══════════════════════════════════════════════════════════════════
// MOTO 3D – carretera infinita en primera persona
// ═══════════════════════════════════════════════════════════════════
          // izq: sentido contrario · der: tu sentido

// ═══════════════════════════════════════════════════════════════════
// AVIÓN 3D – vuelo en primera persona por un cañón
// ═══════════════════════════════════════════════════════════════════

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
  { id: 'openworld', name: 'MUNDO 3D', emoji: '🌍', tag: 'Mundo abierto en primera persona', color: C.lime, cat: 'aventura', Comp: OpenWorld3DGame },
  { id: 'moto3d', name: 'MOTO 3D', emoji: '🏍️', tag: 'Autopista 3D en primera persona', color: C.orange, cat: 'accion', Comp: Moto3DGame },
  { id: 'plane3d', name: 'AVIÓN 3D', emoji: '✈️', tag: 'Vuela por un cañón en primera persona', color: C.blue, cat: 'accion', Comp: Plane3DGame },
  { id: 'islatesoro', name: 'ISLA DEL TESORO', emoji: '🏝️', tag: 'Mundo abierto: cofres, palmeras y cangrejos', color: C.amber, cat: 'aventura', Comp: IslaTesoro3D },
  { id: 'safari', name: 'SAFARI FOTO', emoji: '🦒', tag: 'Recorre la sabana en jeep y fotografía animales', color: C.amber, cat: 'aventura', Comp: Safari3D },
  { id: 'granja', name: 'GRANJA LIBRE', emoji: '🌾', tag: 'Planta, riega, cosecha y vende en tu granja', color: C.lime, cat: 'aventura', Comp: Granja3D },
  { id: 'kart', name: 'RALLY ABIERTO', emoji: '🏎️', tag: 'Contrarreloj por colinas, aros y rampas', color: C.orange, cat: 'accion', Comp: Rally3D },
  { id: 'reparto', name: 'REPARTO EN MOTO', emoji: '🛵', tag: 'Entrega pedidos por la ciudad en primera persona', color: C.cyan, cat: 'accion', Comp: Reparto3D },
  { id: 'dragon', name: 'JINETE DE DRAGÓN', emoji: '🐉', tag: 'Vuela entre montañas y quema torres', color: C.red, cat: 'accion', Comp: Dragon3D },
  { id: 'planeta', name: 'PLANETA ALIEN', emoji: '👽', tag: 'Baja gravedad, cristales y oxígeno', color: C.violet, cat: 'aventura', Comp: Planeta3D },
  { id: 'fantasmas', name: 'CAZAFANTASMAS', emoji: '👻', tag: 'Pueblo de noche: atrapa fantasmas con la linterna', color: C.violet, cat: 'accion', Comp: Cazafantasmas3D },
  { id: 'zombis', name: 'SUPERVIVENCIA ZOMBI', emoji: '🧟', tag: 'Tala, levanta vallas y sobrevive 4 noches', color: C.lime, cat: 'accion', Comp: Zombis3D },
  { id: 'parkour', name: 'PARKOUR URBANO', emoji: '🏙️', tag: 'Salta de azotea en azotea', color: C.pink, cat: 'arcade', Comp: Parkour3D },
  { id: 'pesca', name: 'LAGO DE PESCA', emoji: '🎣', tag: 'Lanza, recoge y tensa el sedal', color: C.lime, cat: 'arcade', Comp: Pesca3D },
  { id: 'invaders', name: 'INVASORES', emoji: '👽', tag: 'Defiende la Tierra con escudos', color: C.lime, cat: 'accion', Comp: Invaders3D },
  { id: 'skyhop', name: 'SKY HOP', emoji: '🦘', tag: 'Rebota hacia el cielo sin caer', color: C.cyan, cat: 'reflejos', Comp: SkyHop3D },
  { id: 'minesweeper', name: 'BUSCAMINAS', emoji: '💣', tag: 'Despeja el campo con lógica', color: C.red, cat: 'puzzle', Comp: Buscaminas3D },
  { id: 'connect4', name: '4 EN LÍNEA', emoji: '🔴', tag: 'Conecta cuatro contra la IA', color: C.red, cat: 'puzzle', Comp: Connect4_3D },
];

// Transición entre pantallas: velo de color que se desvanece (entrar a un juego = color del juego · volver = oscuro)
function ScreenVeil({ screen, color }) {
  const a = useRef(new Animated.Value(0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    a.setValue(1);
    const anim = Animated.timing(a, { toValue: 0, duration: 520, delay: 60, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, backgroundColor: color, opacity: a, zIndex: 900 }} />;
}

export default function App() {
  const [screen, setScreen] = useState('menu');
  useApplyQuality();   // «Calidad gráfica» (ajustes) → gfx.shadows, al arrancar y al cambiarla
  const g = GAMES.find(x => x.id === screen);
  const G = g ? g.Comp : null;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {g ? (
        <GameCtx.Provider value={g.id}><G key={g.id} onExit={() => setScreen('menu')} /></GameCtx.Provider>
      ) : <Menu3D games={GAMES} categories={CATEGORIES} onPick={setScreen} />}
      <ScreenVeil screen={screen} color={g ? g.color : '#06060f'} />
      <ToastHost />
    </View>
  );
}
