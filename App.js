import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SoundManager from './utils/SoundManager';

const { width, height } = Dimensions.get('window');
const GAME_HEIGHT = Math.min(height * 0.75, 700);

// --- NEON GALAXY CONSTANTS ---
const PLAYER_SIZE = 50;
const ENEMY_SIZE = 40;
const LASER_WIDTH = 6;
const LASER_HEIGHT = 20;

// --- CYBER RUN CONSTANTS ---
const CR_PLAYER_SIZE = 40;
const CR_GROUND_HEIGHT = 60;
const CR_GRAVITY = 0.8;
const CR_JUMP_FORCE = -15;
const CR_OBSTACLE_WIDTH = 30;

const NG_ENEMY_TYPES = ['👾', '🛸', '💀'];

function NeonGalaxy({ onExit }) {
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [, setTick] = useState(0);

  // Refs for mutable game state (avoids stale closures in the loop)
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const highScore = useRef(0);

  // Game objects
  const playerX = useRef(width / 2 - PLAYER_SIZE / 2);
  const enemies = useRef([]);
  const lasers = useRef([]);
  const powerUps = useRef([]);
  const lastFire = useRef(0);
  const lastEnemy = useRef(0);

  // Wave system
  const killCount = useRef(0);

  // Combo / multiplier system
  const recentKillTimes = useRef([]);
  const multiplierActive = useRef(false);
  const multiplierEndTime = useRef(0);

  // Static starfield – generated once
  const stars = useRef(
    Array.from({ length: 40 }, (_, i) => ({
      id: i,
      x: Math.random() * (width - 4),
      y: Math.random() * GAME_HEIGHT,
      size: Math.random() * 2 + 1,
    }))
  ).current;

  const resetGame = () => {
    scoreRef.current = 0;
    livesRef.current = 3;
    setScore(0);
    setLives(3);
    setGameOver(false);
    playerX.current = width / 2 - PLAYER_SIZE / 2;
    enemies.current = [];
    lasers.current = [];
    powerUps.current = [];
    killCount.current = 0;
    recentKillTimes.current = [];
    multiplierActive.current = false;
    multiplierEndTime.current = 0;
  };

  const startGame = () => {
    resetGame();
    setRunning(true);
  };

  // ─── sonido ───────────────────────────────
  useEffect(() => {
    SoundManager.preload();
    return () => { SoundManager.unload(); };
  }, []);

  useEffect(() => {
    if (!running) return;

    const loop = setInterval(() => {
      const now = Date.now();

      // Expire multiplier
      if (multiplierActive.current && now > multiplierEndTime.current) {
        multiplierActive.current = false;
      }

      // Auto-fire
      if (now - lastFire.current > 250) {
        lasers.current.push({
          id: now + Math.random(),
          x: playerX.current + PLAYER_SIZE / 2 - LASER_WIDTH / 2,
          y: GAME_HEIGHT - PLAYER_SIZE - 20,
        });
        lastFire.current = now;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        SoundManager.play('laser');
      }

      const spawnRate = Math.max(300, 1200 - scoreRef.current * 15);
      if (now - lastEnemy.current > spawnRate) {
        const type = NG_ENEMY_TYPES[Math.floor(Math.random() * NG_ENEMY_TYPES.length)];
        enemies.current.push({
          id: now + Math.random(),
          x: Math.random() * (width - ENEMY_SIZE - 20) + 10,
          y: -ENEMY_SIZE,
          speed: 2 + Math.random() * 3 + (scoreRef.current / 100),
          type,
        });
        lastEnemy.current = now;
      }

      // Move objects
      lasers.current.forEach(l => { l.y -= 12; });
      lasers.current = lasers.current.filter(l => l.y > -LASER_HEIGHT);
      enemies.current.forEach(e => { e.y += e.speed; });
      powerUps.current.forEach(p => { p.y += 2; });
      powerUps.current = powerUps.current.filter(p => p.y < GAME_HEIGHT + 40);

      let newScore = scoreRef.current;
      let newLives = livesRef.current;

      // Power-up collection
      for (let i = powerUps.current.length - 1; i >= 0; i--) {
        const p = powerUps.current[i];
        if (
          p.y + 30 > GAME_HEIGHT - PLAYER_SIZE - 10 &&
          p.y < GAME_HEIGHT &&
          p.x + 30 > playerX.current &&
          p.x < playerX.current + PLAYER_SIZE
        ) {
          newLives = Math.min(newLives + 1, 9);
          powerUps.current.splice(i, 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          SoundManager.play('powerup');
        }
      }

      // Enemy collisions
      for (let i = enemies.current.length - 1; i >= 0; i--) {
        const e = enemies.current[i];
        let enemyDestroyed = false;

        // Hit player
        if (
          e.y + ENEMY_SIZE > GAME_HEIGHT - PLAYER_SIZE - 10 &&
          e.y < GAME_HEIGHT &&
          e.x + ENEMY_SIZE > playerX.current &&
          e.x < playerX.current + PLAYER_SIZE
        ) {
          newLives -= 1;
          enemyDestroyed = true;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          SoundManager.play('hit');
        }

        if (!enemyDestroyed) {
          for (let j = lasers.current.length - 1; j >= 0; j--) {
            const l = lasers.current[j];
            if (
              l.x < e.x + ENEMY_SIZE &&
              l.x + LASER_WIDTH > e.x &&
              l.y < e.y + ENEMY_SIZE &&
              l.y + LASER_HEIGHT > e.y
            ) {
              lasers.current.splice(j, 1);

              // Combo tracking
              recentKillTimes.current = recentKillTimes.current.filter(t => now - t < 2000);
              recentKillTimes.current.push(now);
              if (recentKillTimes.current.length >= 3 && !multiplierActive.current) {
                multiplierActive.current = true;
                multiplierEndTime.current = now + 5000;
              }

              const points = multiplierActive.current ? 20 : 10;
              newScore += points;

              // Wave system: every 5 kills spawn 3 enemies in a row
              killCount.current += 1;
              if (killCount.current % 5 === 0) {
                const waveSpeed = 2.5 + (scoreRef.current / 100);
                const slot = (width - 60) / 3;
                for (let w = 0; w < 3; w++) {
                  const wt = NG_ENEMY_TYPES[Math.floor(Math.random() * NG_ENEMY_TYPES.length)];
                  enemies.current.push({
                    id: now + Math.random() + w,
                    x: 10 + slot * w + Math.random() * (slot - ENEMY_SIZE),
                    y: -ENEMY_SIZE * (w + 1),
                    speed: waveSpeed + Math.random(),
                    type: wt,
                  });
                }
              }

              // Occasional power-up drop
              if (Math.random() < 0.1) {
                powerUps.current.push({ id: now + Math.random(), x: e.x, y: e.y, type: 'shield' });
              }
              SoundManager.play('kill');
              enemyDestroyed = true;
              break;
            }
          }
        }

        if (enemyDestroyed) {
          enemies.current.splice(i, 1);
        } else if (e.y > GAME_HEIGHT) {
          enemies.current.splice(i, 1);
          newLives -= 1;
        }
      }

      scoreRef.current = newScore;
      livesRef.current = newLives;
      setScore(newScore);
      setLives(newLives);

      if (newLives <= 0) {
        if (newScore > highScore.current) {
          highScore.current = newScore;
          AsyncStorage.setItem('ngHighScore', String(newScore)).catch(() => {});
        }
        setRunning(false);
        setGameOver(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        SoundManager.play('gameover');
      }

      setTick(t => t + 1);
    }, 16);

    return () => clearInterval(loop);
  }, [running]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gs) => {
        playerX.current = Math.max(0, Math.min(width - PLAYER_SIZE, gs.moveX - PLAYER_SIZE / 2));
      },
    })
  ).current;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={styles.title}>NEON GALAXY</Text>
        <View style={styles.stats}>
          <Text style={styles.statText}>SCORE: {score}</Text>
          <Text style={[styles.statText, { fontSize: 11, opacity: 0.7 }]}>LIVES: {lives} {multiplierActive.current ? '⚡2×' : ''}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {/* Stars */}
        {stars.map(star => (
          <View key={star.id} style={{
            position: 'absolute', left: star.x, top: star.y,
            width: star.size, height: star.size,
            backgroundColor: '#fff', borderRadius: star.size / 2, opacity: 0.6,
          }} />
        ))}

        {/* Lasers */}
        {lasers.current.map(l => (
          <View key={l.id} style={[styles.laser, { left: l.x, top: l.y }]} />
        ))}

        {/* Power-ups */}
        {powerUps.current.map(p => (
          <Text key={p.id} style={{ position: 'absolute', left: p.x, top: p.y, fontSize: 24 }}>🛡️</Text>
        ))}

        {/* Enemies */}
        {enemies.current.map(e => (
          <Text key={e.id} style={{
            position: 'absolute',
            left: e.x,
            top: e.y,
            fontSize: ENEMY_SIZE,
            lineHeight: ENEMY_SIZE,
          }}>
            {e.type}
          </Text>
        ))}

        {/* Player ship */}
        <Text style={{
          position: 'absolute',
          left: playerX.current,
          top: GAME_HEIGHT - PLAYER_SIZE - 10,
          fontSize: PLAYER_SIZE - 4,
          lineHeight: PLAYER_SIZE,
        }}>
          🚀
        </Text>

        {!running && (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>
              {gameOver ? 'GAME OVER' : 'DEFEND THE GALAXY'}
            </Text>
            {gameOver && (
              <Text style={styles.overlaySub}>BEST: {highScore.current}</Text>
            )}
            <Text style={styles.overlaySub}>
              {gameOver
                ? 'Collect 🛡️ for extra lives. Kill fast for 2× combo!'
                : 'Drag to move. Auto-fire enabled. Collect 🛡️ shields!'}
            </Text>
            <Pressable style={styles.btn} onPress={startGame}>
              <Text style={styles.btnText}>{gameOver ? 'RETRY' : 'START'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function CyberRun({ onExit }) {
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [, setTick] = useState(0);
  const [perfectBonus, setPerfectBonus] = useState(null);

  const playerY = useRef(GAME_HEIGHT - CR_GROUND_HEIGHT - CR_PLAYER_SIZE);
  const velocityY = useRef(0);
  const jumpsLeft = useRef(2);
  const obstacles = useRef([]);
  const coins = useRef([]);
  const lastObstacle = useRef(0);
  const lastCoin = useRef(0);
  const scoreRef = useRef(0);
  const highScore = useRef(0);
  const perfectBonusTimer = useRef(null);

  const getSpeed = () => 6 + (scoreRef.current / 100);

  const getBgColor = () => {
    const t = Math.min((getSpeed() - 6) / 5, 1);
    const r = Math.round(20 + t * 180);
    const g = Math.round(20 - t * 10);
    const b = Math.round(40 - t * 30);
    return `rgb(${r},${g},${b})`;
  };

  const resetGame = () => {
    setScore(0);
    scoreRef.current = 0;
    setGameOver(false);
    setPerfectBonus(null);
    playerY.current = GAME_HEIGHT - CR_GROUND_HEIGHT - CR_PLAYER_SIZE;
    velocityY.current = 0;
    jumpsLeft.current = 2;
    obstacles.current = [];
    coins.current = [];
    lastCoin.current = 0;
    if (perfectBonusTimer.current) clearTimeout(perfectBonusTimer.current);
  };

  const startGame = () => { resetGame(); setRunning(true); };

  // ─── sonido ───────────────────────────────
  useEffect(() => {
    SoundManager.preload();
    return () => { SoundManager.unload(); };
  }, []);

  const jump = () => {
    if (!running) return;
    if (jumpsLeft.current > 0) {
      const isDoubleJump = jumpsLeft.current === 1;
      velocityY.current = isDoubleJump ? CR_JUMP_FORCE * 0.7 : CR_JUMP_FORCE;
      jumpsLeft.current -= 1;
      Haptics.impactAsync(isDoubleJump ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
      SoundManager.play('jump');
    }
  };

  useEffect(() => {
    if (!running) return;

    const loop = setInterval(() => {
      const now = Date.now();
      const currentSpeed = getSpeed();

      velocityY.current += CR_GRAVITY;
      playerY.current += velocityY.current;

      const groundY = GAME_HEIGHT - CR_GROUND_HEIGHT - CR_PLAYER_SIZE;
      if (playerY.current >= groundY) {
        playerY.current = groundY;
        velocityY.current = 0;
        jumpsLeft.current = 2;
      }

      // Spawn obstacles
      const spawnRate = Math.max(800, 2000 - scoreRef.current * 20);
      if (now - lastObstacle.current > spawnRate) {
        const roll = Math.random();
        let obsHeight, obsWidth, emoji;
        if (roll < 0.4) {
          obsHeight = 60 + Math.random() * 20;
          obsWidth = CR_OBSTACLE_WIDTH;
          emoji = '🌵';
        } else if (roll < 0.7) {
          obsHeight = 30 + Math.random() * 10;
          obsWidth = CR_OBSTACLE_WIDTH + 10;
          emoji = '🚧';
        } else {
          obsHeight = 20 + Math.random() * 10;
          obsWidth = CR_OBSTACLE_WIDTH + 20;
          emoji = '⬛';
        }
        obstacles.current.push({
          id: now,
          x: width,
          y: GAME_HEIGHT - CR_GROUND_HEIGHT - obsHeight,
          width: obsWidth,
          height: obsHeight,
          passed: false,
          emoji,
        });
        lastObstacle.current = now;
      }

      // Spawn coins
      const coinSpawnRate = Math.max(1200, 3000 - scoreRef.current * 10);
      if (now - lastCoin.current > coinSpawnRate) {
        const floatHeights = [
          GAME_HEIGHT - CR_GROUND_HEIGHT - CR_PLAYER_SIZE - 20,
          GAME_HEIGHT - CR_GROUND_HEIGHT - CR_PLAYER_SIZE - 60,
          GAME_HEIGHT - CR_GROUND_HEIGHT - CR_PLAYER_SIZE - 110,
        ];
        const coinY = floatHeights[Math.floor(Math.random() * floatHeights.length)];
        coins.current.push({ id: now + 1, x: width + 50, y: coinY, size: 30, collected: false });
        lastCoin.current = now;
      }

      let hit = false;
      const playerRect = {
        left: 50,
        right: 50 + CR_PLAYER_SIZE,
        top: playerY.current,
        bottom: playerY.current + CR_PLAYER_SIZE,
      };

      // Update obstacles
      for (let i = obstacles.current.length - 1; i >= 0; i--) {
        const obs = obstacles.current[i];
        obs.x -= currentSpeed;
        const obsRect = { left: obs.x, right: obs.x + obs.width, top: obs.y, bottom: obs.y + obs.height };

        if (
          playerRect.left < obsRect.right &&
          playerRect.right > obsRect.left &&
          playerRect.top < obsRect.bottom &&
          playerRect.bottom > obsRect.top
        ) {
          hit = true;
        }

        if (!obs.passed && obs.x + obs.width < playerRect.left) {
          obs.passed = true;
          scoreRef.current += 10;
          setScore(scoreRef.current);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

          // Perfect dodge: obstacle edge passed within 5px of player edge
          const gap = playerRect.left - (obs.x + obs.width);
          if (gap <= 5) {
            scoreRef.current += 5;
            setScore(scoreRef.current);
            setPerfectBonus('+5 PERFECT!');
            if (perfectBonusTimer.current) clearTimeout(perfectBonusTimer.current);
            perfectBonusTimer.current = setTimeout(() => setPerfectBonus(null), 1000);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            SoundManager.play('coin');
          }
        }

        if (obs.x + obs.width < 0) { obstacles.current.splice(i, 1); }
      }

      // Update coins
      for (let i = coins.current.length - 1; i >= 0; i--) {
        const coin = coins.current[i];
        if (coin.collected) { coins.current.splice(i, 1); continue; }
        coin.x -= currentSpeed;
        const coinRect = { left: coin.x, right: coin.x + coin.size, top: coin.y, bottom: coin.y + coin.size };
        if (
          playerRect.left < coinRect.right &&
          playerRect.right > coinRect.left &&
          playerRect.top < coinRect.bottom &&
          playerRect.bottom > coinRect.top
        ) {
          coin.collected = true;
          scoreRef.current += 25;
          setScore(scoreRef.current);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          SoundManager.play('coin');
        }
        if (coin.x + coin.size < 0) { coins.current.splice(i, 1); }
      }

      if (hit) {
        if (scoreRef.current > highScore.current) { highScore.current = scoreRef.current; }
        setRunning(false);
        setGameOver(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        SoundManager.play('gameover');
      }

      setTick(t => t + 1);
    }, 16);

    return () => clearInterval(loop);
  }, [running]);

  const isOnGround = playerY.current >= GAME_HEIGHT - CR_GROUND_HEIGHT - CR_PLAYER_SIZE - 1;
  const bgColor = getBgColor();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={styles.title}>CYBER RUN</Text>
        <View style={styles.stats}>
          <Text style={styles.statText}>SCORE: {score}</Text>
          <Text style={[styles.statText, { fontSize: 11, opacity: 0.7 }]}>BEST: {highScore.current}</Text>
        </View>
      </View>

      <Pressable style={[styles.gameArea, { backgroundColor: bgColor }]} onPress={jump}>
        <View style={[styles.ground, { height: CR_GROUND_HEIGHT }]} />

        {/* Player emoji — 🏃 on ground, 🤖 in air */}
        <Text style={{
          position: 'absolute',
          left: 46,
          top: playerY.current - 4,
          fontSize: CR_PLAYER_SIZE,
          lineHeight: CR_PLAYER_SIZE + 8,
        }}>
          {isOnGround ? '🏃' : '🤖'}
        </Text>

        {/* Obstacles */}
        {obstacles.current.map(obs => (
          <Text key={obs.id} style={{
            position: 'absolute',
            left: obs.x,
            top: obs.y,
            fontSize: obs.height * 0.85,
            lineHeight: obs.height + 4,
            width: obs.width + 8,
            textAlign: 'center',
          }}>
            {obs.emoji}
          </Text>
        ))}

        {/* Coins */}
        {coins.current.map(coin => (
          <Text key={coin.id} style={{
            position: 'absolute',
            left: coin.x,
            top: coin.y,
            fontSize: coin.size,
            lineHeight: coin.size + 4,
          }}>
            🪙
          </Text>
        ))}

        {/* Perfect dodge flash */}
        {perfectBonus && (
          <Text style={{
            position: 'absolute',
            left: 100,
            top: playerY.current - 32,
            color: '#FFD700',
            fontWeight: 'bold',
            fontSize: 16,
          }}>
            {perfectBonus}
          </Text>
        )}

        {/* Double jump indicator */}
        {running && jumpsLeft.current === 1 && (
          <Text style={{
            position: 'absolute',
            left: 52,
            top: playerY.current - 20,
            fontSize: 12,
            color: '#00ffcc',
            opacity: 0.9,
          }}>▲</Text>
        )}

        {!running && (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>{gameOver ? '💥 CRASHED' : '🤖 CYBER RUN'}</Text>
            <Text style={styles.overlaySub}>Tap to jump • Tap again mid-air for double jump</Text>
            {gameOver && (
              <Text style={[styles.overlaySub, { color: '#FFD700', marginBottom: 4 }]}>
                BEST: {highScore.current}
              </Text>
            )}
            <Pressable style={styles.btn} onPress={startGame}>
              <Text style={styles.btnText}>{gameOver ? 'RETRY' : 'START'}</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    </SafeAreaView>
  );
}

// ==========================================
// 3. PIXEL QUEST (Platformer Mario-style)
// ==========================================
const PQ_GRAVITY = 1.2;
const PQ_JUMP = -18;
const PQ_SPEED = 7;
const PQ_PLAYER_SIZE = 30;

function PixelQuest({ onExit }) {
  const insets = useSafeAreaInsets();
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState(1);
  const [lives, setLives] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [invincible, setInvincible] = useState(false);
  const [hasGun, setHasGun] = useState(false);
  const [, setTick] = useState(0);

  const pRef = useRef({ x: 50, y: 100, vx: 0, vy: 0, w: PQ_PLAYER_SIZE, h: PQ_PLAYER_SIZE, facingRight: true });
  const keys = useRef({ left: false, right: false });
  const world = useRef({ platforms: [], enemies: [], powerups: [], goal: null, length: 2000 });
  const cameraX = useRef(0);
  const invincibilityTimer = useRef(0);
  const tickRef = useRef(0);
  const projectiles = useRef([]);

  const generateLevel = (lvl) => {
    // GY = top of the ground floor. All "y" for objects = GY - objectHeight (so feet land on GY).
    const GY = GAME_HEIGHT - 60; // ground Y (top surface)
    const GH = 60;               // ground thickness
    const PH = 18;               // floating platform height
    const ld = { platforms: [], enemies: [], powerups: [], goal: null, length: 0 };

    // Helpers
    const gnd  = (x, w)              => ({ x, y: GY,     w, h: GH });      // ground slab
    const plat = (x, yUp, w)         => ({ x, y: GY - yUp, w, h: PH });    // floating (yUp = px above GY)
    const enm  = (x, range, spd)     => ({ x, y: GY - 30, w: 30, h: 30, vx: spd, startX: x, range, active: true });
    const enmP = (x, yUp, range, spd)=> ({ x, y: GY - yUp - 30, w: 30, h: 30, vx: spd, startX: x, range, active: true });
    const star = (x, yUp)            => ({ x, y: GY - yUp, w: 25, h: 25, active: true });
    const goal = (x, yUp = 140)      => ({ x, y: GY - yUp, w: 55, h: yUp });

    switch (lvl) {

      // ═══════════════════════════════════════════════════════════════
      // WORLD 1 ── COLINAS VERDES  (tutorial)
      // Terreno continuo con 2 hoyos pequeños, 2 enemigos lentos.
      // El jugador aprende a saltar gaps y esquivar enemigos.
      // ═══════════════════════════════════════════════════════════════
      case 1:
        ld.platforms.push(
          gnd(0,   440),          // suelo largo de inicio
          gnd(530, 350),          // suelo central  (gap 90px → fácil)
          gnd(990, 850),          // suelo final largo (gap 110px → fácil)
          // puente sobre el primer gap
          plat(450, 65, 120),     // x=450-570, cubre gap 440-530
          // puente sobre el segundo gap
          plat(905, 70, 130),     // x=905-1035, cubre gap 880-990
          // plataforma bonus alta (recompensa exploración)
          plat(280, 110, 110),    // yUp=110 < límite 125 → alcanzable
        );
        ld.enemies.push(
          enm(330, 130, 1.5),     // patrulla lenta en suelo inicio
          enm(1250, 160, 1.8),    // patrulla lenta en suelo final
        );
        ld.powerups.push(star(290, 155)); // ⭐ sobre plataforma bonus
        ld.goal = goal(1680);
        ld.length = 1850;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 2 ── SENDERO ROCOSO  (3 gaps, introduce alturas)
      // Tres hoyos de dificultad creciente con puentes a distinta altura.
      // ═══════════════════════════════════════════════════════════════
      case 2:
        ld.platforms.push(
          gnd(0,   350),          // inicio
          gnd(470, 270),          // tras gap 1  (gap=120px)
          gnd(850, 250),          // tras gap 2  (gap=110px)
          gnd(1200,800),          // final largo (gap=100px)
          // puentes crecientes en altura
          plat(365, 70, 145),     // sobre gap 1
          plat(740, 80, 140),     // sobre gap 2
          plat(1090, 90, 140),    // sobre gap 3  (1100-1200)
          // bonus 1 y bonus 2
          plat(160, 115, 105),    // bonus izquierda
          plat(1420, 115, 105),   // bonus derecha
        );
        ld.enemies.push(
          enm(200,  130, 2.0),
          enm(520,  120, 2.2),
          enm(1300, 150, 2.0),
        );
        ld.powerups.push(star(165, 160), star(1428, 160));
        ld.goal = goal(1830);
        ld.length = 2000;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 3 ── LA GRAN ESCALERA  (subida y bajada simétricas)
      // 4 peldaños ascendentes (+35px cada uno) y 3 descendentes.
      // Camino VISUAL Y LÓGICAMENTE claro: sube → llega a la cima → baja.
      // Cada peldaño: ancho=115, gap=15px entre peldaños (muy légible).
      // ═══════════════════════════════════════════════════════════════
      case 3:
        ld.platforms.push(
          gnd(0,   290),               // suelo de inicio
          gnd(1240, 650),              // suelo tras bajar la escalera
          // ── SUBIDA (4 peldaños) ──
          plat(310, 60,  115),         // escalón 1  yUp= 60
          plat(440, 95,  115),         // escalón 2  yUp= 95  gap=15
          plat(570, 130, 115),         // escalón 3  yUp=130  gap=15
          plat(700, 165, 115),         // escalón 4  yUp=165  gap=15  ← CIMA
          // ── BAJADA (3 peldaños) ──
          plat(840, 130, 115),         // escalón 5  yUp=130  gap=25
          plat(970, 95,  115),         // escalón 6  yUp= 95  gap=15
          plat(1100, 60, 115),         // escalón 7  yUp= 60  gap=15
        );
        ld.enemies.push(
          enm(150,  110, 2.0),         // patrulla en inicio
          enmP(340,  60, 70, 2.3),     // guarda escalón 1
          enmP(855, 130, 70, 2.5),     // guarda escalón 5 (bajada)
          enm(1450, 140, 2.2),         // patrulla en final
        );
        ld.powerups.push(star(710, 212)); // ⭐ flotando sobre la CIMA (yUp=165+47)
        ld.goal = goal(1720);
        ld.length = 1900;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 4 ── PATRULLA ENEMIGA  (terreno con muchos enemies)
      // 4 suelos con gaps medios, 5 enemigos de velocidad creciente.
      // El reto es ESQUIVAR enemigos mientras saltas los hoyos.
      // ═══════════════════════════════════════════════════════════════
      case 4:
        ld.platforms.push(
          gnd(0,   320),
          gnd(440, 250),          // gap 120
          gnd(800, 230),          // gap 110
          gnd(1140,280),          // gap 110
          gnd(1520,800),          // gap 100 → final largo
          plat(340, 75, 140),     // puente 1
          plat(700, 80, 140),     // puente 2
          plat(1040, 85, 130),    // puente 3
          plat(1425, 80, 125),    // puente 4
          plat(150, 120, 100),    // bonus izq
          plat(1700, 115, 100),   // bonus der
        );
        ld.enemies.push(
          enm(180,  120, 2.2),
          enm(490,  110, 2.5),
          enm(845,  120, 2.8),
          enm(1190, 110, 2.5),
          enm(1650, 150, 2.2),
        );
        ld.powerups.push(star(155, 165), star(1705, 160));
        ld.goal = goal(2180);
        ld.length = 2350;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 5 ── ISLAS FLOTANTES  (casi sin suelo, ritmo up-down)
      // Cadena de 12 plataformas flotantes alternando bajo(75)↔alto(130).
      // El patrón rítmico enseña al jugador el timing de saltos continuos.
      // ═══════════════════════════════════════════════════════════════
      case 5:
        ld.platforms.push(
          gnd(0,   160),               // pequeño inicio
          gnd(2200, 500),              // aterrizaje final
          // ── CADENA RÍTMICA (bajo=75, alto=130, gap ~60px) ──
          plat(210,  75, 105),         // isla 1  baja
          plat(375, 130, 100),         // isla 2  alta   gap=60 rise=55
          plat(535,  75, 105),         // isla 3  baja   gap=60 drop=55
          plat(700, 130, 100),         // isla 4  alta   gap=60 rise=55
          plat(860,  75, 105),         // isla 5  baja   gap=60 drop=55
          plat(1025,130, 100),         // isla 6  alta   gap=60
          plat(1185, 75, 105),         // isla 7  baja
          plat(1350,135, 100),         // isla 8  alta
          plat(1510, 75, 105),         // isla 9  baja
          plat(1675,130, 100),         // isla 10 alta
          plat(1835, 80, 105),         // isla 11 baja
          plat(2000,120, 150),         // isla 12 amplia (aterrizaje seguro)
        );
        ld.enemies.push(
          enmP(220,  75,  80, 2.5),    // isla 1
          enmP(720,  130, 70, 2.8),    // isla 4
          enmP(1045, 130, 70, 3.0),    // isla 6
          enmP(1695, 130, 70, 3.0),    // isla 10
          enmP(2015, 120, 90, 2.8),    // isla 12
        );
        ld.powerups.push(star(710, 178), star(1860, 125)); // sobre islas altas
        ld.goal = goal(2550);
        ld.length = 2700;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 6 ── VELOCIDAD  (enemigos rápidos, gaps medios-grandes)
      // Mismo esquema de gaps+puentes pero los enemigos se mueven rápido.
      // 4 suelos + 4 puentes + 2 bonus. 6 enemigos a 3.0–3.5.
      // ═══════════════════════════════════════════════════════════════
      case 6:
        ld.platforms.push(
          gnd(0,   340),
          gnd(480, 260),          // gap 140
          gnd(860, 240),          // gap 120
          gnd(1220,250),          // gap 120
          gnd(1600,750),          // gap 130 → final
          plat(360, 80, 160),     // puente 1
          plat(740, 85, 155),     // puente 2
          plat(1100, 90, 155),    // puente 3
          plat(1475, 85, 155),    // puente 4
          plat(160, 120, 100),    // bonus izq
          plat(1780, 125, 100),   // bonus der
        );
        ld.enemies.push(
          enm(200,  130, 3.0),
          enm(530,  120, 3.5),
          enm(910,  130, 3.2),
          enm(1270, 110, 3.5),
          enm(1660, 150, 3.0),
          enm(1930, 140, 3.2),
        );
        ld.powerups.push(star(165, 165), star(1785, 170));
        ld.goal = goal(2170);
        ld.length = 2320;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 7 ── PLATAFORMAS ANGOSTAS  (90→80px, gaps crecen)
      // Sin suelo central. Plataformas alternas angostas sobre el vacío.
      // Cada salto exige precisión. Enemies en posiciones que obligan a moverse.
      // ═══════════════════════════════════════════════════════════════
      case 7:
        ld.platforms.push(
          gnd(0,   200),
          gnd(2620, 450),
          // ── CADENA ANGOSTA (gap ~85px, alternas baja/alta) ──
          plat(250,  70,  90),     // p1  end=340
          plat(425, 125,  85),     // p2  gap=85  rise=55
          plat(595,  70,  90),     // p3  gap=85  drop=55
          plat(775, 135,  85),     // p4  gap=85  rise=65
          plat(950,  75,  90),     // p5  gap=90  drop=60
          plat(1135,140,  85),     // p6  gap=90  rise=65
          plat(1315, 80,  90),     // p7  gap=95  drop=60
          plat(1505,145,  85),     // p8  gap=95  rise=65
          plat(1685, 85,  90),     // p9  gap=95  drop=60
          plat(1880,150,  85),     // p10 gap=100 rise=65
          plat(2065, 90,  90),     // p11 gap=100 drop=60
          plat(2260, 75, 100),     // p12 gap=105
          plat(2450, 80, 180),     // p13 amplia → entrada a suelo final
        );
        ld.enemies.push(
          enm(100,  80, 2.8),
          enmP(455, 125, 60, 3.0),
          enmP(800, 135, 60, 3.5),
          enmP(1160,140, 55, 3.2),
          enmP(1530,145, 55, 3.5),
          enmP(1905,150, 55, 3.8),
        );
        ld.powerups.push(star(785, 182), star(1515, 192));
        ld.goal = goal(2900);
        ld.length = 3050;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 8 ── BLOQUES EN ALTURA  (plataformas altas en parejas)
      // Clusters de 2 plataformas a la misma altura, con saltos entre clusters.
      // Lo difícil: subir de cluster bajo→alto→muy alto→alto→bajo.
      // ═══════════════════════════════════════════════════════════════
      case 8:
        ld.platforms.push(
          gnd(0,   200),
          gnd(2800, 500),
          // cluster A (bajo yUp=80)
          plat(250, 80, 100),  plat(420, 80, 100),   // end=520
          // cluster B (medio yUp=130)
          plat(600, 130, 95),  plat(775, 130, 95),   // end=870
          // cluster C (alto yUp=175)
          plat(970, 175, 90),  plat(1145,175, 90),   // end=1235  ← CIMA
          // cluster D (medio yUp=130)
          plat(1340,130, 95),  plat(1515,130, 95),   // end=1610
          // cluster E (bajo yUp=80)
          plat(1710, 80, 100), plat(1885, 80, 100),  // end=1985
          // finale (alto yUp=150, ancho)
          plat(2090,150, 90),  plat(2270,150, 90),   plat(2460, 90, 200),
        );
        ld.enemies.push(
          enm(110,  80, 3.5),
          enmP(280, 80, 70, 3.5),  enmP(450, 80, 70, 3.8),
          enmP(630,130, 70, 3.8),  enmP(805,130, 65, 4.0),
          enmP(1000,175, 60, 4.0),
          enmP(1370,130, 65, 4.2), enmP(1740, 80, 65, 4.0),
          enmP(2120,150, 60, 4.5), enmP(2490, 90, 80, 4.0),
        );
        ld.powerups.push(star(785, 178), star(1155, 222), star(2285, 196));
        ld.goal = goal(3020, 160);
        ld.length = 3200;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 9 ── CAOS TOTAL  (todo mezclado, enemigos muy rápidos)
      // Alterna: suelo corto → gap → plataforma → gap → …
      // 7 enemigos a 4.0–4.5. Requiere dominar saltos Y combate.
      // ═══════════════════════════════════════════════════════════════
      case 9:
        ld.platforms.push(
          gnd(0,   200), gnd(380, 210), gnd(700, 190), gnd(1010,200),
          gnd(1310,210), gnd(1650,190), gnd(1980,200), gnd(2550,600),
          // puentes sobre gaps + plataformas altas opcionales
          plat(230,  75, 190),   // puente gap1  (200-380)
          plat(560,  80, 170),   // puente gap2  (590-700)
          plat(870,  85, 170),   // puente gap3  (900-1010)
          plat(1180, 90, 160),   // puente gap4  (1200-1310)
          plat(1520, 85, 160),   // puente gap5  (1520-1650)
          plat(1840, 90, 170),   // puente gap6  (1840-1980)
          plat(2250, 95, 170),   // puente gap7 + inicio zona final
          // bonus
          plat(80,  120, 100), plat(1320,125, 100), plat(2180,120, 100),
        );
        ld.enemies.push(
          enm(120,  110, 4.0),
          enm(420,  110, 4.0),  enm(740, 120, 4.2),
          enm(1050, 110, 4.2),  enm(1350,120, 4.5),
          enm(1690, 110, 4.5),  enm(2030,120, 4.5),
        );
        ld.powerups.push(star(85, 165), star(1325, 170), star(2185, 165));
        ld.goal = goal(2980, 160);
        ld.length = 3150;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 10 ── EL FINAL  (todo al máximo)
      // Plataformas angostas (80-85px), gaps grandes (90-110px),
      // 10 enemigos a 4.5-5.0, estrellas en posiciones peligrosas.
      // ═══════════════════════════════════════════════════════════════
      default:
        ld.platforms.push(
          gnd(0,   180),
          gnd(2920, 500),
          // ── SECCIÓN 1: zigzag de 5 plataformas ──
          plat(230,  75,  85),   // end=315
          plat(405, 145,  80),   // gap=90   rise=70
          plat(575,  80,  85),   // gap=90   drop=65
          plat(760, 150,  80),   // gap=90   rise=70
          plat(930,  80,  85),   // gap=90   drop=70
          // ── SECCIÓN 2: serie alta ──
          plat(1110,160,  80),   // gap=95   rise=80
          plat(1285, 90,  85),   // gap=95   drop=70
          plat(1470,165,  80),   // gap=100  rise=75
          plat(1650, 90,  85),   // gap=100  drop=75
          plat(1840,170,  80),   // gap=105  rise=80
          // ── SECCIÓN 3: bajada y aterrizaje ──
          plat(2025,110,  85),   // gap=100  drop=60
          plat(2215, 80,  90),   // gap=105  drop=30
          plat(2410, 85, 120),   // gap=105  (ancho para seguridad)
          plat(2630, 80, 200),   // amplia → suelo final
        );
        ld.enemies.push(
          enmP(265,  75,  60, 4.5),  enmP(440, 145, 55, 5.0),
          enmP(610,  80,  55, 4.8),  enmP(795, 150, 55, 5.0),
          enmP(965,  80,  55, 4.5),  enmP(1145,160, 50, 5.0),
          enmP(1505,165,  50, 5.0),  enmP(1875,170, 50, 5.0),
          enmP(2055,110,  55, 4.8),  enmP(2445, 85, 70, 4.5),
        );
        ld.powerups.push(star(770, 197), star(1295, 137), star(1855, 215));
        ld.goal = goal(3000, 180);
        ld.length = 3200;
        break;
    }

    world.current = ld;
  };

  const initLevel = (lvl) => {
    setLevel(lvl);
    pRef.current = { x: 50, y: 100, vx: 0, vy: 0, w: PQ_PLAYER_SIZE, h: PQ_PLAYER_SIZE, facingRight: true };
    keys.current = { left: false, right: false };
    cameraX.current = 0;
    setInvincible(false);
    setHasGun(false);
    projectiles.current = [];
    invincibilityTimer.current = 0;
    generateLevel(lvl);
  };

  const startGame = () => {
    setGameOver(false);
    setGameWon(false);
    setLives(3);
    initLevel(1);
    setRunning(true);
  };

  // ─── sonido ───────────────────────────────
  useEffect(() => {
    SoundManager.preload();
    return () => { SoundManager.unload(); };
  }, []);

  const saveGame = async () => {
    try {
      await AsyncStorage.setItem('pixelQuestSave', JSON.stringify({ level, lives }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      alert('Game Saved!');
    } catch (e) {
      console.error(e);
    }
  };

  const loadGame = async () => {
    try {
      const save = await AsyncStorage.getItem('pixelQuestSave');
      if (save) {
        const data = JSON.parse(save);
        setGameOver(false);
        setGameWon(false);
        setLives(data.lives);
        initLevel(data.level);
        setRunning(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        alert('No save found');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeath = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    SoundManager.play('hit');
    if (lives > 1) {
      setLives(l => l - 1);
      // Respawn slightly back and high up
      pRef.current.y = 0;
      pRef.current.vy = 0;
      pRef.current.x = Math.max(0, pRef.current.x - 150);
      setInvincible(true);
      invincibilityTimer.current = 3000; // 3 seconds of invincibility
    } else {
      setLives(0);
      setRunning(false);
      setGameOver(true);
    }
  };

  const jump = () => {
    if (!running) return;
    // Simple ground check
    let onGround = false;
    const p = pRef.current;
    for (let plat of world.current.platforms) {
      if (p.x < plat.x + plat.w && p.x + p.w > plat.x && p.y + p.h >= plat.y && p.y + p.h <= plat.y + 10) {
        onGround = true; break;
      }
    }
    if (onGround) {
      p.vy = PQ_JUMP;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      SoundManager.play('jump');
    }
  };

  const shoot = () => {
    if (!running || !hasGun) return;
    const p = pRef.current;
    projectiles.current.push({
      x: p.facingRight ? p.x + p.w : p.x - 10,
      y: p.y + p.h / 2 - 5,
      vx: p.facingRight ? 10 : -10,
      w: 10,
      h: 10,
      active: true
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  useEffect(() => {
    if (!running) return;
    const loop = setInterval(() => {
      const p = pRef.current;
      const w = world.current;

      // Horizontal movement
      tickRef.current++;
      if (keys.current.left) {
        p.vx = -PQ_SPEED;
        p.facingRight = false;
        if (tickRef.current % 8 === 0) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else if (keys.current.right) {
        p.vx = PQ_SPEED;
        p.facingRight = true;
        if (tickRef.current % 8 === 0) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        p.vx = 0;
      }

      p.x += p.vx;
      if (p.x < 0) p.x = 0;

      // X Collisions
      for (let plat of w.platforms) {
        if (p.x < plat.x + plat.w && p.x + p.w > plat.x && p.y < plat.y + plat.h && p.y + p.h > plat.y) {
          if (p.vx > 0) p.x = plat.x - p.w;
          else if (p.vx < 0) p.x = plat.x + plat.w;
        }
      }

      // Vertical movement
      p.vy += PQ_GRAVITY;
      p.y += p.vy;

      // Y Collisions
      for (let plat of w.platforms) {
        if (p.x < plat.x + plat.w && p.x + p.w > plat.x && p.y < plat.y + plat.h && p.y + p.h > plat.y) {
          if (p.vy > 0) { p.y = plat.y - p.h; p.vy = 0; }
          else if (p.vy < 0) { p.y = plat.y + plat.h; p.vy = 0; }
        }
      }

      // Death by falling
      if (p.y > GAME_HEIGHT) {
        handleDeath();
      }

      // Camera follow
      cameraX.current = Math.max(0, p.x - width / 3);

      // Invincibility timer
      if (invincibilityTimer.current > 0) {
        invincibilityTimer.current -= 16;
        if (invincibilityTimer.current <= 0) setInvincible(false);
      }

      // Enemies update & collision
      for (let e of w.enemies) {
        if (!e.active) continue;
        e.x += e.vx;
        if (e.x > e.startX + e.range || e.x < e.startX) e.vx *= -1;

        if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
          if (invincibilityTimer.current > 0) {
            e.active = false; // Kill enemy
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            SoundManager.play('kill');
          } else {
            handleDeath();
          }
        }
      }

      // Powerups collision
      for (let pu of w.powerups) {
        if (!pu.active) continue;
        if (p.x < pu.x + pu.w && p.x + p.w > pu.x && p.y < pu.y + pu.h && p.y + p.h > pu.y) {
          pu.active = false;
          setInvincible(true);
          setHasGun(true);
          invincibilityTimer.current = 5000; // 5 seconds
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          SoundManager.play('powerup');
        }
      }

      // Projectiles update & collision
      for (let i = projectiles.current.length - 1; i >= 0; i--) {
        let proj = projectiles.current[i];
        if (!proj.active) continue;
        proj.x += proj.vx;
        
        // Remove if out of bounds
        if (proj.x > p.x + width || proj.x < p.x - width) {
          proj.active = false;
          continue;
        }

        // Check enemy collision
        for (let e of w.enemies) {
          if (!e.active) continue;
          if (proj.x < e.x + e.w && proj.x + proj.w > e.x && proj.y < e.y + e.h && proj.y + proj.h > e.y) {
            e.active = false;
            proj.active = false;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            SoundManager.play('kill');
            break;
          }
        }
      }

      // Goal collision
      if (w.goal && p.x < w.goal.x + w.goal.w && p.x + p.w > w.goal.x && p.y < w.goal.y + w.goal.h && p.y + p.h > w.goal.y) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        SoundManager.play('powerup');
        if (level >= 10) {
          setRunning(false); setGameWon(true);
        } else {
          initLevel(level + 1);
        }
      }

      setTick(t => t + 1);
    }, 16);
    return () => clearInterval(loop);
  }, [running, level]);

  // World colors based on level (Lighter colors for better visibility)
  const worldColors = ['#87CEEB', '#98FB98', '#DDA0DD', '#F0E68C', '#FFB6C1', '#87CEFA', '#E0FFFF', '#FFDAB9', '#B0E0E6', '#FFE4E1'];
  const bgColor = worldColors[(level - 1) % 10];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={styles.title}>WORLD {level}</Text>
        <View style={styles.stats}>
          <Text style={styles.statText}>LIVES: {lives}</Text>
          <Pressable onPress={saveGame} style={{marginLeft: 15, backgroundColor: '#0ff', paddingHorizontal: 10, borderRadius: 5}}>
            <Text style={{color: '#000', fontWeight: 'bold'}}>SAVE</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.gameArea, { backgroundColor: bgColor, borderColor: '#fff', flex: 1, marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
        {/* Render World */}
        <View style={{ transform: [{ translateX: -cameraX.current }] }}>
          {world.current.platforms.map((plat, i) => (
            <View key={`p${i}`} style={{ position: 'absolute', left: plat.x, top: plat.y, width: plat.w, height: plat.h, backgroundColor: '#654321', borderWidth: 2, borderColor: '#3e2723' }} />
          ))}
          {world.current.enemies.map((e, i) => e.active && (
            <Text key={`e${i}`} style={{ position: 'absolute', left: e.x, top: e.y - 5, fontSize: 30 }}>👾</Text>
          ))}
          {world.current.powerups.map((pu, i) => pu.active && (
            <Text key={`pu${i}`} style={{ position: 'absolute', left: pu.x, top: pu.y - 5, fontSize: 25 }}>⭐</Text>
          ))}
          {world.current.goal && (
            <View style={{ position: 'absolute', left: world.current.goal.x, top: world.current.goal.y, width: world.current.goal.w, height: world.current.goal.h, backgroundColor: '#32cd32', borderRadius: 10, borderWidth: 3, borderColor: '#fff' }} />
          )}
          {projectiles.current.map((proj, i) => proj.active && (
            <View key={`proj${i}`} style={{ position: 'absolute', left: proj.x, top: proj.y, width: proj.w, height: proj.h, backgroundColor: '#ff4500', borderRadius: 5 }} />
          ))}
          <Text style={{ position: 'absolute', left: pRef.current.x, top: pRef.current.y - 5, fontSize: 30, opacity: invincible ? 0.5 : 1, transform: [{scaleX: pRef.current.facingRight ? 1 : -1}] }}>
            {hasGun ? '🤠' : '😎'}
          </Text>
        </View>
        {!running && (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>{gameWon ? 'YOU WIN!' : gameOver ? 'GAME OVER' : 'PIXEL QUEST'}</Text>
            <Text style={styles.overlaySub}>{gameWon ? 'All 10 worlds cleared!' : 'Reach the green pillar. Grab ⭐ for invincibility + gun.'}</Text>
            <View style={{flexDirection: 'row', gap: 20}}>
              <Pressable style={styles.btn} onPress={startGame}><Text style={styles.btnText}>{gameOver || gameWon ? 'RESTART' : 'START'}</Text></Pressable>
              {(!gameOver && !gameWon) && <Pressable style={[styles.btn, {backgroundColor: '#ffd700'}]} onPress={loadGame}><Text style={styles.btnText}>LOAD</Text></Pressable>}
            </View>
          </View>
        )}
      </View>

      {/* D-Pad — siempre renderizado para mantener altura consistente */}
      <View style={[styles.controlBar, { paddingBottom: insets.bottom + 12, height: insets.bottom + 95 }, !running && { opacity: 0, pointerEvents: 'none' }]}>
        <View style={styles.dpadLeftRight}>
          <View
            onTouchStart={() => { if (running) keys.current.left = true; }}
            onTouchEnd={() => { keys.current.left = false; }}
            onTouchCancel={() => { keys.current.left = false; }}
            style={styles.dpadBtn}
          >
            <Text style={styles.dpadText}>◀</Text>
          </View>
          <View
            onTouchStart={() => { if (running) keys.current.right = true; }}
            onTouchEnd={() => { keys.current.right = false; }}
            onTouchCancel={() => { keys.current.right = false; }}
            style={styles.dpadBtn}
          >
            <Text style={styles.dpadText}>▶</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {hasGun && (
            <View onTouchStart={shoot} style={[styles.dpadBtnJump, { backgroundColor: 'rgba(255,69,0,0.8)' }]}>
              <Text style={styles.dpadText}>🔥</Text>
            </View>
          )}
          <View onTouchStart={jump} style={styles.dpadBtnJump}>
            <Text style={styles.dpadText}>🅰</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function GalacticHunt({ onExit }) {
  const [gameState, setGameState] = useState('idle'); // 'idle' | 'playing' | 'roundEnd' | 'gameOver'
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [ammo, setAmmo] = useState(10);
  const [timeLeft, setTimeLeft] = useState(30);
  const [targets, setTargets] = useState([]);
  const [crosshair, setCrosshair] = useState(null);   // { x, y }
  const [splatters, setSplatters] = useState([]);      // [{ id, x, y, anim, dots }]

  const targetsRef = useRef([]);
  const ammoRef = useRef(10);
  const scoreRef = useRef(0);
  const timeRef = useRef(30);
  const roundRef = useRef(1);
  const gameStateRef = useRef('idle');
  const nextIdRef = useRef(0);
  const gameLoopRef = useRef(null);
  const timerRef = useRef(null);
  const spawnTimeoutRef = useRef(null);
  const crosshairTimer = useRef(null);
  const splatterIdRef = useRef(0);

  const stars = useRef(
    Array.from({ length: 60 }, (_, i) => ({
      id: i,
      x: Math.random() * width,
      y: Math.random() * GAME_HEIGHT,
      size: Math.random() * 2.5 + 1,
      opacity: 0.4 + Math.random() * 0.6,
    }))
  ).current;

  const TARGET_TYPES = [
    { emoji: '🦆', points: 10, baseSpeed: 2.5, size: 44 },
    { emoji: '🛸', points: 20, baseSpeed: 3.5, size: 44 },
    { emoji: '💎', points: 50, baseSpeed: 5.0, size: 36 },
    { emoji: '🦆', points: 10, baseSpeed: 2.5, size: 44 },
    { emoji: '🛸', points: 20, baseSpeed: 3.5, size: 44 },
  ];

  const cleanup = () => {
    clearInterval(gameLoopRef.current);
    clearInterval(timerRef.current);
    clearTimeout(spawnTimeoutRef.current);
  };

  const spawnTarget = () => {
    const type = TARGET_TYPES[Math.floor(Math.random() * TARGET_TYPES.length)];
    const speed = type.baseSpeed * (0.8 + Math.random() * 0.5);
    const side = Math.floor(Math.random() * 3); // 0=left, 1=right, 2=top
    let x, y, vx, vy;
    if (side === 0) {
      x = -type.size;
      y = 60 + Math.random() * (GAME_HEIGHT - 120);
      vx = speed;
      vy = (Math.random() - 0.5) * speed * 0.7;
    } else if (side === 1) {
      x = width + type.size;
      y = 60 + Math.random() * (GAME_HEIGHT - 120);
      vx = -speed;
      vy = (Math.random() - 0.5) * speed * 0.7;
    } else {
      x = type.size + Math.random() * (width - type.size * 2);
      y = -type.size;
      vx = (Math.random() - 0.5) * speed * 0.7;
      vy = speed;
    }
    targetsRef.current = [...targetsRef.current, {
      id: nextIdRef.current++,
      x, y, vx, vy,
      emoji: type.emoji,
      points: type.points,
      size: type.size,
      active: true,
    }];
  };

  const scheduleSpawn = () => {
    if (gameStateRef.current !== 'playing') return;
    spawnTimeoutRef.current = setTimeout(() => {
      if (gameStateRef.current === 'playing') {
        spawnTarget();
        scheduleSpawn();
      }
    }, 800 + Math.random() * 1200);
  };

  const endRound = () => {
    if (gameStateRef.current !== 'playing') return;
    gameStateRef.current = 'roundEnd';
    cleanup();
    setGameState('roundEnd');
  };

  const startRound = () => {
    targetsRef.current = [];
    ammoRef.current = 10;
    timeRef.current = 30;
    gameStateRef.current = 'playing';
    setTargets([]);
    setAmmo(10);
    setTimeLeft(30);
    setGameState('playing');

    gameLoopRef.current = setInterval(() => {
      targetsRef.current = targetsRef.current.map(t => {
        if (!t.active) return t;
        let nx = t.x + t.vx;
        let ny = t.y + t.vy;
        let nvx = t.vx;
        let nvy = t.vy;
        if (nx <= 0 || nx >= width - t.size) { nvx = -nvx; nx = Math.max(0, Math.min(width - t.size, nx)); }
        if (ny <= 0 || ny >= GAME_HEIGHT - t.size) { nvy = -nvy; ny = Math.max(0, Math.min(GAME_HEIGHT - t.size, ny)); }
        return { ...t, x: nx, y: ny, vx: nvx, vy: nvy };
      }).filter(t => t.active);
      setTargets([...targetsRef.current]);
    }, 16);

    timerRef.current = setInterval(() => {
      timeRef.current -= 1;
      setTimeLeft(timeRef.current);
      if (timeRef.current <= 0) endRound();
    }, 1000);

    scheduleSpawn();
  };

  const showCrosshair = (x, y) => {
    setCrosshair({ x, y });
    if (crosshairTimer.current) clearTimeout(crosshairTimer.current);
    crosshairTimer.current = setTimeout(() => setCrosshair(null), 350);
  };

  const addSplatter = (x, y) => {
    const id = splatterIdRef.current++;
    const anim = new Animated.Value(1);
    const dots = Array.from({ length: 8 }, (_, i) => {
      const angle = (i / 8) * Math.PI * 2 + (i * 0.3);
      const r = 6 + (i % 3) * 9;
      const size = 5 + (i % 4) * 3;
      return { dx: Math.cos(angle) * r, dy: Math.sin(angle) * r, size };
    });
    setSplatters(prev => [...prev, { id, x, y, anim, dots }]);
    Animated.timing(anim, { toValue: 0, duration: 600, useNativeDriver: true }).start(() => {
      setSplatters(prev => prev.filter(s => s.id !== id));
    });
  };

  const handleTargetHit = (targetId, points, cx, cy) => {
    if (ammoRef.current <= 0 || gameStateRef.current !== 'playing') return;
    ammoRef.current -= 1;
    scoreRef.current += points;
    targetsRef.current = targetsRef.current.filter(t => t.id !== targetId);
    setAmmo(ammoRef.current);
    setScore(scoreRef.current);
    setTargets([...targetsRef.current]);
    showCrosshair(cx, cy);
    addSplatter(cx, cy);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    SoundManager.play('kill');
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 80);
    if (ammoRef.current <= 0) endRound();
  };

  const handleMiss = (lx, ly) => {
    if (ammoRef.current <= 0 || gameStateRef.current !== 'playing') return;
    ammoRef.current -= 1;
    setAmmo(ammoRef.current);
    showCrosshair(lx, ly);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    SoundManager.play('shoot');
    if (ammoRef.current <= 0) endRound();
  };

  const nextRound = () => {
    roundRef.current += 1;
    setRound(roundRef.current);
    startRound();
  };

  const resetGame = () => {
    cleanup();
    scoreRef.current = 0;
    roundRef.current = 1;
    targetsRef.current = [];
    gameStateRef.current = 'idle';
    setScore(0);
    setRound(1);
    setTargets([]);
    setGameState('idle');
  };

  useEffect(() => () => cleanup(), []);

  // ─── sonido ───────────────────────────────
  useEffect(() => {
    SoundManager.preload();
    return () => { SoundManager.unload(); };
  }, []);

  const ammoBar = Array.from({ length: 10 }, (_, i) => (i < ammo ? '🔫' : '▫️')).join('');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#070720' }]}>
      <View style={[styles.header, { backgroundColor: 'rgba(0,0,20,0.85)', paddingTop: 6, paddingBottom: 6 }]}>
        <Pressable onPress={() => { cleanup(); onExit(); }} style={styles.backBtn}>
          <Text style={styles.backText}>← BACK</Text>
        </Pressable>
        <Text style={[styles.title, { color: '#a78bfa' }]}>GALACTIC HUNT</Text>
        <View style={styles.stats}>
          <Text style={styles.statText}>⭐ {score}</Text>
          <Text style={[styles.statText, { marginLeft: 12 }]}>R{round}/3</Text>
        </View>
      </View>

      <Pressable style={[styles.gameArea, { backgroundColor: '#070720', borderColor: '#2e1065' }]}
        onPress={e => handleMiss(e.nativeEvent.locationX, e.nativeEvent.locationY)}>
        {/* Starfield */}
        {stars.map(star => (
          <View
            key={star.id}
            style={{
              position: 'absolute', left: star.x, top: star.y,
              width: star.size, height: star.size,
              borderRadius: star.size / 2,
              backgroundColor: '#ffffff',
              opacity: star.opacity,
            }}
          />
        ))}

        {/* HUD: ammo + timer */}
        {gameState === 'playing' && (
          <View style={{ position: 'absolute', top: 8, left: 12, right: 12, zIndex: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: '#c4b5fd', fontSize: 13, letterSpacing: 1 }}>{ammoBar}</Text>
              <Text style={{ color: timeLeft <= 10 ? '#f87171' : '#e2e8f0', fontSize: 16, fontWeight: 'bold' }}>
                ⏱ {timeLeft}s
              </Text>
            </View>
          </View>
        )}

        {/* Blood splatters */}
        {splatters.map(s => (
          <Animated.View key={s.id} pointerEvents="none" style={{ position: 'absolute', left: s.x, top: s.y, opacity: s.anim, zIndex: 16 }}>
            {s.dots.map((d, i) => (
              <View key={i} style={{
                position: 'absolute',
                left: d.dx - d.size / 2,
                top: d.dy - d.size / 2,
                width: d.size,
                height: d.size,
                borderRadius: d.size / 2,
                backgroundColor: i % 2 === 0 ? '#cc0000' : '#ff2222',
              }} />
            ))}
            <View style={{ position: 'absolute', left: -5, top: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff0000' }} />
          </Animated.View>
        ))}

        {/* Crosshair */}
        {crosshair && (
          <View pointerEvents="none" style={{ position: 'absolute', left: crosshair.x - 22, top: crosshair.y - 22, width: 44, height: 44, zIndex: 17 }}>
            <View style={{ position: 'absolute', top: 21, left: 0, width: 44, height: 2, backgroundColor: '#ffff00', opacity: 0.9 }} />
            <View style={{ position: 'absolute', left: 21, top: 0, width: 2, height: 44, backgroundColor: '#ffff00', opacity: 0.9 }} />
            <View style={{ position: 'absolute', top: 7, left: 7, width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#ffff00', backgroundColor: 'transparent', opacity: 0.8 }} />
          </View>
        )}

        {/* Targets */}
        {gameState === 'playing' && targets.map(target => (
          <Pressable
            key={target.id}
            onPress={e => {
              e.stopPropagation();
              handleTargetHit(target.id, target.points, target.x + target.size / 2, target.y + target.size / 2);
            }}
            style={{
              position: 'absolute',
              left: target.x,
              top: target.y,
              width: target.size,
              height: target.size,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: target.size * 0.76, lineHeight: target.size }}>{target.emoji}</Text>
          </Pressable>
        ))}

        {/* Idle overlay */}
        {gameState === 'idle' && (
          <View style={[styles.overlay, { backgroundColor: 'rgba(7,7,32,0.93)' }]}>
            <Text style={[styles.overlayTitle, { color: '#a78bfa', fontSize: 30, marginBottom: 6 }]}>🛸 GALACTIC HUNT 🛸</Text>
            <Text style={styles.overlaySub}>Tap targets before they escape!</Text>
            <Text style={[styles.overlaySub, { fontSize: 14, color: '#c4b5fd', marginBottom: 2 }]}>🦆 Duck = 10 pts  •  🛸 UFO = 20 pts</Text>
            <Text style={[styles.overlaySub, { fontSize: 14, color: '#c4b5fd', marginBottom: 2 }]}>💎 Gem = 50 pts</Text>
            <Text style={[styles.overlaySub, { fontSize: 13, color: '#94a3b8', marginBottom: 28 }]}>10 shots  •  30 seconds  •  3 rounds</Text>
            <Pressable style={[styles.btn, { backgroundColor: '#7c3aed' }]} onPress={startRound}>
              <Text style={[styles.btnText, { color: '#fff' }]}>START GAME</Text>
            </Pressable>
            <Pressable style={[styles.btn, { backgroundColor: '#374151', marginTop: 14 }]} onPress={() => { cleanup(); onExit(); }}>
              <Text style={[styles.btnText, { color: '#fff' }]}>BACK TO MENU</Text>
            </Pressable>
          </View>
        )}

        {/* Round-end overlay */}
        {gameState === 'roundEnd' && (
          <View style={[styles.overlay, { backgroundColor: 'rgba(7,7,32,0.93)' }]}>
            <Text style={[styles.overlayTitle, { color: '#fbbf24' }]}>ROUND {round} CLEAR!</Text>
            <Text style={[styles.overlaySub, { fontSize: 22, color: '#fff', marginBottom: 6 }]}>Score: {score}</Text>
            <Text style={[styles.overlaySub, { marginBottom: 28 }]}>
              {round < 3 ? `Round ${round + 1} of 3 up next!` : 'All rounds complete!'}
            </Text>
            {round < 3 ? (
              <Pressable style={[styles.btn, { backgroundColor: '#7c3aed' }]} onPress={nextRound}>
                <Text style={[styles.btnText, { color: '#fff' }]}>NEXT ROUND ▶</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.btn, { backgroundColor: '#7c3aed' }]} onPress={() => {
                gameStateRef.current = 'gameOver';
                setGameState('gameOver');
              }}>
                <Text style={[styles.btnText, { color: '#fff' }]}>SEE RESULTS</Text>
              </Pressable>
            )}
            <Pressable style={[styles.btn, { backgroundColor: '#374151', marginTop: 14 }]} onPress={() => { cleanup(); onExit(); }}>
              <Text style={[styles.btnText, { color: '#fff' }]}>QUIT</Text>
            </Pressable>
          </View>
        )}

        {/* Game-over overlay */}
        {gameState === 'gameOver' && (
          <View style={[styles.overlay, { backgroundColor: 'rgba(7,7,32,0.93)' }]}>
            <Text style={[styles.overlayTitle, { color: '#f472b6', fontSize: 34 }]}>GAME OVER</Text>
            <Text style={[styles.overlaySub, { fontSize: 24, color: '#fbbf24', marginBottom: 4 }]}>Final Score</Text>
            <Text style={{ fontSize: 56, fontWeight: '900', color: '#fff', marginBottom: 28 }}>{score}</Text>
            <Pressable style={[styles.btn, { backgroundColor: '#7c3aed' }]} onPress={resetGame}>
              <Text style={[styles.btnText, { color: '#fff' }]}>PLAY AGAIN</Text>
            </Pressable>
            <Pressable style={[styles.btn, { backgroundColor: '#374151', marginTop: 14 }]} onPress={() => { cleanup(); onExit(); }}>
              <Text style={[styles.btnText, { color: '#fff' }]}>BACK TO MENU</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    </SafeAreaView>
  );
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('menu');

  if (currentScreen === 'neon') {
    return <NeonGalaxy onExit={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'cyber') {
    return <CyberRun onExit={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'pixel') {
    return <PixelQuest onExit={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'galactic') {
    return <GalacticHunt onExit={() => setCurrentScreen('menu')} />;
  }

  return (
    <SafeAreaView style={styles.menuContainer}>
      <Text style={styles.menuTitle}>ARCADE HUB</Text>
      <Text style={styles.menuSub}>Select a game</Text>
      
      <Pressable style={styles.menuBtn} onPress={() => setCurrentScreen('neon')}>
        <Text style={styles.menuBtnTitle}>NEON GALAXY</Text>
        <Text style={styles.menuBtnSub}>Space Shooter</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#f0f' }]} onPress={() => setCurrentScreen('cyber')}>
        <Text style={styles.menuBtnTitle}>CYBER RUN</Text>
        <Text style={styles.menuBtnSub}>Platformer</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#32cd32' }]} onPress={() => setCurrentScreen('pixel')}>
        <Text style={styles.menuBtnTitle}>PIXEL QUEST</Text>
        <Text style={styles.menuBtnSub}>10-World Platformer</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#7c3aed' }]} onPress={() => setCurrentScreen('galactic')}>
        <Text style={styles.menuBtnTitle}>GALACTIC HUNT</Text>
        <Text style={styles.menuBtnSub}>UFO / Duck Shooter</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050510' },
  menuContainer: { flex: 1, backgroundColor: '#050510', justifyContent: 'center', alignItems: 'center', padding: 20 },
  menuTitle: { color: '#fff', fontSize: 40, fontWeight: '900', marginBottom: 10, textShadowColor: '#0ff', textShadowRadius: 10 },
  menuSub: { color: '#aaa', fontSize: 18, marginBottom: 40 },
  menuBtn: { backgroundColor: '#0ff', width: '100%', padding: 20, borderRadius: 15, marginBottom: 20, alignItems: 'center', shadowColor: '#0ff', shadowOpacity: 0.5, shadowRadius: 10 },
  menuBtnTitle: { color: '#000', fontSize: 24, fontWeight: '900' },
  menuBtnSub: { color: '#111', fontSize: 14, marginTop: 5 },
  header: { padding: 20, alignItems: 'center', position: 'relative' },
  backBtn: { position: 'absolute', left: 20, top: 25, padding: 5, zIndex: 10 },
  backText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  title: { color: '#0ff', fontSize: 28, fontWeight: '900', letterSpacing: 2, textShadowColor: '#0ff', textShadowRadius: 10 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 10, paddingHorizontal: 20 },
  statText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  gameArea: { flex: 1, backgroundColor: '#0a0a1a', margin: 10, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: '#113' },
  player: { position: 'absolute', width: PLAYER_SIZE, height: PLAYER_SIZE, backgroundColor: '#0f0', borderRadius: 5, shadowColor: '#0f0', shadowOpacity: 0.8, shadowRadius: 10 },
  enemy: { position: 'absolute', width: ENEMY_SIZE, height: ENEMY_SIZE, backgroundColor: '#f00', borderRadius: 20, shadowColor: '#f00', shadowOpacity: 0.8, shadowRadius: 10 },
  laser: { position: 'absolute', width: LASER_WIDTH, height: LASER_HEIGHT, backgroundColor: '#0ff', borderRadius: 3, shadowColor: '#0ff', shadowOpacity: 1, shadowRadius: 5 },
  ground: { position: 'absolute', bottom: 0, width: '100%', backgroundColor: '#222', borderTopWidth: 2, borderTopColor: '#f0f' },
  crPlayer: { position: 'absolute', width: CR_PLAYER_SIZE, height: CR_PLAYER_SIZE, backgroundColor: '#0ff', borderRadius: 8, shadowColor: '#0ff', shadowOpacity: 0.8, shadowRadius: 10 },
  crObstacle: { position: 'absolute', backgroundColor: '#f0f', borderRadius: 4, shadowColor: '#f0f', shadowOpacity: 0.8, shadowRadius: 10 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', zIndex: 20 },
  overlayTitle: { color: '#f0f', fontSize: 32, fontWeight: 'bold', marginBottom: 10, textShadowColor: '#f0f', textShadowRadius: 10 },
  overlaySub: { color: '#aaa', fontSize: 16, marginBottom: 30 },
  btn: { backgroundColor: '#0ff', paddingHorizontal: 30, paddingVertical: 15, borderRadius: 30, shadowColor: '#0ff', shadowOpacity: 0.5, shadowRadius: 10 },
  btnText: { color: '#000', fontSize: 20, fontWeight: '900' },
  dpadContainer: { position: 'absolute', bottom: 20, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  dpadLeftRight: { flexDirection: 'row', gap: 10 },
  dpadBtn: { width: 60, height: 60, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 30, justifyContent: 'center', alignItems: 'center' },
  dpadBtnJump: { width: 80, height: 80, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 40, justifyContent: 'center', alignItems: 'center' },
  dpadText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  controlBar: { backgroundColor: 'rgba(0,0,0,0.4)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 15, height: 80 }
});
