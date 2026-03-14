import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');
const GAME_HEIGHT = Math.min(height - 230, 560);

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

// --- PING PONG CONSTANTS ---
const PP_PADDLE_W = 90;
const PP_PADDLE_H = 14;
const PP_BALL_SIZE = 14;
const PP_MAX_SCORE = 7;

// --- BREAKOUT CONSTANTS ---
const BK_COLS = 8;
const BK_MARGIN = 4;
const BK_BRICK_H = 22;
const BK_BRICKS_TOP = 60;
const BK_PADDLE_W = 85;
const BK_PADDLE_H = 14;
const BK_BALL_R = 8;

// --- VOID CRAWLER CONSTANTS ---
const VC_COLS = 19;
const VC_ROWS = 13;
const VC_CELL = Math.floor((width - 16) / VC_COLS);
const VC_WALL  = 0;
const VC_FLOOR = 1;

const NG_ENEMY_TYPES = ['👾', '🛸', '💀'];

// ─── Haptic Helpers (iPhone Taptic Engine patterns) ─────────────
const deathVibrate = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 100);
  setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 220);
  setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 380);
  setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error), 520);
};
const celebrateVibrate = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 150);
  setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 300);
  setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 480);
};
const popVibrate = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 65);
};
const scoreVibrate = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 80);
};
// ─────────────────────────────────────────────────────────────────

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

  useEffect(() => {

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
                celebrateVibrate();
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
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              popVibrate();
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
        deathVibrate();
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
        <Pressable onPress={onExit} style={styles.backBtn} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}><Text style={styles.backText}>← BACK</Text></Pressable>
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
            <Pressable style={styles.btn} onPress={startGame} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
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

  const jump = () => {
    if (!running) return;
    if (jumpsLeft.current > 0) {
      const isDoubleJump = jumpsLeft.current === 1;
      velocityY.current = isDoubleJump ? CR_JUMP_FORCE * 0.7 : CR_JUMP_FORCE;
      jumpsLeft.current -= 1;
      Haptics.impactAsync(isDoubleJump ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
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
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 60);
        }
        if (coin.x + coin.size < 0) { coins.current.splice(i, 1); }
      }

      if (hit) {
        if (scoreRef.current > highScore.current) { highScore.current = scoreRef.current; }
        setRunning(false);
        setGameOver(true);
        deathVibrate();
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
        <Pressable onPress={onExit} style={styles.backBtn} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}><Text style={styles.backText}>← BACK</Text></Pressable>
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
            <Pressable style={styles.btn} onPress={startGame} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
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
  const bottomInset = Platform.OS === 'ios' ? 34 : 0;
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState(1);
  const [lives, setLives] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [invincible, setInvincible] = useState(false);
  const [hasGun, setHasGun] = useState(false);
  const [hasDoubleJump, setHasDoubleJump] = useState(false);
  const [, setTick] = useState(0);
  const [maxLevel, setMaxLevel] = useState(1);
  const [showWorldSelect, setShowWorldSelect] = useState(false);

  const pRef = useRef({ x: 50, y: 100, vx: 0, vy: 0, w: PQ_PLAYER_SIZE, h: PQ_PLAYER_SIZE, facingRight: true });
  const keys = useRef({ left: false, right: false });
  const world = useRef({ platforms: [], enemies: [], powerups: [], blocks: [], goal: null, length: 2000 });
  const cameraX = useRef(0);
  const invincibilityTimer = useRef(0);
  const tickRef = useRef(0);
  const projectiles = useRef([]);
  const maxLevelRef = useRef(1);
  const wasRunningRef = useRef(false);
  const doubleJumpRef = useRef(0);

  useEffect(() => {
    AsyncStorage.getItem('pixelQuestMaxLevel').then(v => {
      if (v) { const n = parseInt(v); maxLevelRef.current = n; setMaxLevel(n); }
    }).catch(() => {});
  }, []);

  const generateLevel = (lvl) => {
    // GY = top of the ground floor. All "y" for objects = GY - objectHeight (so feet land on GY).
    const GY = GAME_HEIGHT - 60; // ground Y (top surface)
    const GH = 60;               // ground thickness
    const PH = 18;               // floating platform height
    const ld = { platforms: [], enemies: [], powerups: [], blocks: [], goal: null, length: 0 };

    // Helpers
    const gnd   = (x, w)              => ({ x, y: GY,     w, h: GH });      // ground slab
    const plat  = (x, yUp, w)         => ({ x, y: GY - yUp, w, h: PH });    // floating (yUp = px above GY)
    const enm   = (x, range, spd)     => ({ x, y: GY - 30, w: 30, h: 30, vx: spd, startX: x, range, active: true });
    const enmP  = (x, yUp, range, spd)=> ({ x, y: GY - yUp - 30, w: 30, h: 30, vx: spd, startX: x, range, active: true });
    const star  = (x, yUp)            => ({ x, y: GY - yUp, w: 25, h: 25, active: true, type: 'star' });
    const life  = (x, yUp)            => ({ x, y: GY - yUp, w: 25, h: 25, active: true, type: 'life' });
    const djump = (x, yUp)            => ({ x, y: GY - yUp, w: 25, h: 25, active: true, type: 'doublejump' });
    const goal  = (x, yUp = 140)      => ({ x, y: GY - yUp, w: 55, h: yUp });
    // Bloques ❓ golpeables desde abajo (tipo: 'star' | 'life' | 'doublejump')
    const qBlock = (x, yUp, type)     => ({ x, y: GY - yUp, w: 35, h: 35, active: true, hit: false, type });

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
        ld.powerups.push(star(290, 155), life(700, 35)); // ⭐ plataforma bonus, ❤️ mid-level
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
        ld.powerups.push(star(165, 160), star(1428, 160), life(1100, 35));
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
        ld.powerups.push(star(710, 212), life(1400, 35)); // ⭐ CIMA, ❤️ final ground
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
        ld.powerups.push(star(155, 165), star(1705, 160), life(950, 35));
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
        ld.powerups.push(star(710, 178), star(1860, 125), life(2300, 35)); // islas altas, ❤️ final
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
        ld.powerups.push(star(165, 165), star(1785, 170), life(1000, 35));
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
        ld.powerups.push(star(785, 182), star(1515, 192), life(2700, 35));
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
        ld.powerups.push(star(785, 178), star(1155, 222), star(2285, 196), life(2900, 35));
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
        ld.powerups.push(star(85, 165), star(1325, 170), star(2185, 165), life(1700, 35));
        ld.goal = goal(2980, 160);
        ld.length = 3150;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 10 ── EL FINAL  (todo al máximo)
      // Plataformas angostas (80-85px), gaps grandes (90-110px),
      // 10 enemigos a 4.5-5.0, estrellas en posiciones peligrosas.
      // ═══════════════════════════════════════════════════════════════
      case 10:
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
        ld.powerups.push(star(770, 197), star(1295, 137), star(1855, 215), life(2680, 115));
        ld.goal = goal(3000, 180);
        ld.length = 3200;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 11 ── CASCADA  (sube suave → baja → sube de nuevo)
      // Primera plataforma yUp=65 (fácilmente alcanzable), luego escala.
      // ═══════════════════════════════════════════════════════════════
      case 11:
        ld.platforms.push(
          gnd(0,   280),
          gnd(2800, 500),
          // subida suave al inicio (yUp 65→85→105→120)
          plat(320,  65, 110), plat(500,  85, 105), plat(680, 105, 100),
          plat(850, 120, 100),
          // suelo intermedio de descanso
          gnd(1000, 210),
          // bajada al otro lado (120→95→70)
          plat(1260, 120, 105), plat(1430,  95, 105), plat(1600,  70, 100),
          // suelo bajo y subida final (70→100→120→105→80)
          gnd(1760, 180),
          plat(2000, 70, 100), plat(2165, 100, 100), plat(2330, 120,  95),
          plat(2490,  80, 160),
        );
        ld.enemies.push(
          enm(160, 130, 3.5),
          enmP(345,  65, 80, 3.5), enmP(525,  85, 75, 4.0),
          enm(1050, 110, 3.8),
          enmP(1285, 120, 75, 4.0), enmP(1455,  95, 70, 4.2),
          enm(1810, 110, 4.0),
          enmP(2025,  70, 70, 4.2), enmP(2355, 120, 65, 4.5),
        );
        ld.powerups.push(star(860, 165), star(1615, 115));
        ld.goal = goal(3000, 180);
        ld.length = 3200;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 12 ── LABERINTO  (zigzag extremo, 15 plataformas 80px)
      // Alternancia bajo/alto/muy alto, gaps 95-100px, 9 enemigos 4.5-5.0.
      // ═══════════════════════════════════════════════════════════════
      case 12:
        ld.platforms.push(
          gnd(0,   180),
          gnd(3100, 500),
          plat(220,  65,  85), plat(400, 145,  80), plat(575,  70,  85),
          plat(755, 155,  80), plat(935,  75,  85), plat(1115, 165,  80),
          plat(1295, 80,  85), plat(1475,170,  80), plat(1655,  85,  85),
          plat(1835,165,  80), plat(2015, 90,  80), plat(2200,155,  80),
          plat(2380, 95,  80), plat(2560, 80, 150),
          plat(2750, 80, 200),
        );
        ld.enemies.push(
          enm(100, 80, 4.0),
          enmP(250, 65, 60, 4.0), enmP(430, 145, 55, 4.5),
          enmP(785, 155, 55, 4.5), enmP(1145, 165, 50, 4.8),
          enmP(1505, 170, 50, 4.8), enmP(1865, 165, 50, 5.0),
          enmP(2230, 155, 50, 5.0), enmP(2590, 80, 80, 4.5),
        );
        ld.powerups.push(star(765, 200), djump(1130, 215), star(1485, 215));
        ld.blocks.push(
          qBlock(420, 190, 'star'),
          qBlock(1120, 130, 'doublejump'),
          qBlock(2015, 135, 'life'),
        );
        ld.goal = goal(3280, 180);
        ld.length = 3450;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 13 ── TORMENTA  (gaps de 115px, 14 plataformas 90px)
      // Tres zonas de dificultad creciente, 10 enemigos 4.0-5.0.
      // ═══════════════════════════════════════════════════════════════
      case 13:
        ld.platforms.push(
          gnd(0,   160),
          gnd(3300, 500),
          // zona 1
          plat(200,  80, 100), plat(390, 155, 95), plat(580,  85, 100),
          // zona 2
          plat(790, 165, 90), plat(995,  90, 95), plat(1205, 170, 90),
          // zona 3
          plat(1420, 95, 90), plat(1630,175, 85), plat(1850, 100, 90),
          // zona final
          plat(2075, 170, 85), plat(2295, 95, 90), plat(2510, 165, 85),
          plat(2725, 100, 85), plat(2920, 80, 200),
        );
        ld.enemies.push(
          enm(100, 80, 4.2),
          enmP(220, 80, 75, 4.0), enmP(810, 165, 65, 4.5),
          enmP(1010, 90, 65, 4.5), enmP(1225, 170, 60, 4.8),
          enmP(1440, 95, 60, 5.0), enmP(1650, 175, 55, 5.0),
          enmP(2095, 170, 55, 5.0), enmP(2530, 165, 55, 5.0),
          enmP(2935, 80, 80, 4.8),
        );
        ld.powerups.push(star(800, 210), djump(1210, 215), star(1645, 220));
        ld.blocks.push(
          qBlock(590, 130, 'doublejump'),
          qBlock(1425, 140, 'star'),
          qBlock(2510, 210, 'life'),
        );
        ld.goal = goal(3450, 180);
        ld.length = 3620;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 14 ── ABISMO  (plataformas 75-80px, gaps manejables)
      // Enemies ultra rápidos 5.0-5.5. Doble salto disponible.
      // CORREGIDO: plataforma puente al final para alcanzar la meta.
      // ═══════════════════════════════════════════════════════════════
      case 14:
        ld.platforms.push(
          gnd(0,   160),
          gnd(3380, 500),
          plat(200,  75,  80), plat(390, 160,  75), plat(580,  80,  80),
          plat(775, 165,  75), plat(975,  80,  80), plat(1175, 170,  75),
          plat(1380, 80,  80), plat(1580, 165,  75), plat(1785, 85,  80),
          plat(1985, 170,  75), plat(2190, 90,  80), plat(2390, 160,  75),
          plat(2595, 95,  80), plat(2795, 75, 115),
          plat(2995, 80, 200),   // termina en x=3195
          plat(3270, 85,  85),   // PUENTE: gap=75px desde x=3195, termina en x=3355
        );
        ld.enemies.push(
          enm(100, 80, 4.5),
          enmP(220, 75, 55, 4.5), enmP(410, 160, 50, 5.0),
          enmP(795, 165, 50, 5.0), enmP(1195, 170, 45, 5.5),
          enmP(1600, 165, 45, 5.5), enmP(2005, 170, 45, 5.5),
          enmP(2410, 160, 45, 5.5), enmP(2615, 95, 60, 5.0),
          enmP(3010, 80, 80, 5.0),
        );
        ld.powerups.push(
          star(785, 208), djump(1195, 215), star(2002, 215),
          djump(2800, 120), life(3050, 115),
        );
        ld.blocks.push(
          qBlock(600,  130, 'doublejump'),
          qBlock(1395, 125, 'star'),
          qBlock(1790, 130, 'doublejump'),
          qBlock(2595, 140, 'star'),
          qBlock(3000, 125, 'life'),
        );
        ld.goal = goal(3490, 180);
        ld.length = 3700;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 15 ── EL OLIMPO  (nivel final absoluto)
      // Plataformas 70px, gaps 120-125px, 12 enemies 5.0-6.0.
      // ═══════════════════════════════════════════════════════════════
      default:
        ld.platforms.push(
          gnd(0,   140),
          gnd(3800, 500),
          // fase 1
          plat(190,  80,  75), plat(385, 165,  70), plat(580,  85,  75),
          plat(785, 170,  70), plat(985,  85,  75),
          // fase 2
          plat(1200, 170,  70), plat(1410, 90,  75), plat(1625, 175,  70),
          plat(1840, 90,  75), plat(2055, 170,  70),
          // fase 3
          plat(2280,  90,  75), plat(2505, 170,  70), plat(2725,  90,  75),
          plat(2950, 165,  70), plat(3175,  85,  80),
          plat(3395,  80, 200),
        );
        ld.enemies.push(
          enm(100, 80, 5.0),
          enmP(210, 80, 50, 5.0), enmP(405, 165, 45, 5.5),
          enmP(805, 170, 45, 5.5), enmP(1005, 85, 50, 5.0),
          enmP(1220, 170, 45, 5.5), enmP(1645, 175, 45, 6.0),
          enmP(1860, 90, 45, 6.0), enmP(2075, 170, 45, 6.0),
          enmP(2525, 170, 45, 6.0), enmP(2745, 90, 50, 5.5),
          enmP(3415, 80, 90, 5.5),
        );
        ld.powerups.push(star(795, 213), djump(1215, 220), star(1640, 220), djump(2530, 215), star(3205, 130), life(3435, 115));
        ld.blocks.push(
          qBlock(590, 130, 'doublejump'),
          qBlock(1210, 215, 'star'),
          qBlock(1845, 135, 'doublejump'),
          qBlock(2725, 135, 'life'),
          qBlock(3200, 130, 'doublejump'),
        );
        ld.goal = goal(3920, 185);
        ld.length = 4100;
        break;
    }

    world.current = ld;
  };

  const initLevel = (lvl) => {
    setLevel(lvl);
    if (lvl >= 11 && lvl <= 13) setLives(l => l + 1);
    if (lvl > maxLevelRef.current) {
      maxLevelRef.current = lvl;
      setMaxLevel(lvl);
      AsyncStorage.setItem('pixelQuestMaxLevel', String(lvl)).catch(() => {});
    }
    pRef.current = { x: 50, y: 100, vx: 0, vy: 0, w: PQ_PLAYER_SIZE, h: PQ_PLAYER_SIZE, facingRight: true };
    keys.current = { left: false, right: false };
    cameraX.current = 0;
    setInvincible(false);
    setHasGun(false);
    doubleJumpRef.current = 0;
    setHasDoubleJump(false);
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

  const saveGame = async () => {
    try {
      await AsyncStorage.setItem('pixelQuestSave', JSON.stringify({
        level, lives,
        playerX: pRef.current.x,
        cameraX: cameraX.current,
      }));
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
        if (data.playerX != null) {
          pRef.current.x = data.playerX;
          pRef.current.vx = 0;
          pRef.current.vy = 0;
        }
        if (data.cameraX != null) cameraX.current = data.cameraX;
        setRunning(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        alert('No hay partida guardada');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeath = () => {
    if (lives > 1) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 90);
      setLives(l => l - 1);
      // Respawn slightly back and high up
      pRef.current.y = 0;
      pRef.current.vy = 0;
      pRef.current.x = Math.max(0, pRef.current.x - 150);
      setInvincible(true);
      invincibilityTimer.current = 3000; // 3 seconds of invincibility
    } else {
      deathVibrate();
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
    // También contar bloques ❓ como suelo
    if (!onGround) {
      for (let blk of (world.current.blocks || [])) {
        if (!blk.active) continue;
        if (p.x < blk.x + blk.w && p.x + p.w > blk.x && p.y + p.h >= blk.y && p.y + p.h <= blk.y + 10) {
          onGround = true; break;
        }
      }
    }
    if (onGround) {
      p.vy = PQ_JUMP;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (doubleJumpRef.current > 0) {
      // ¡Doble salto!
      doubleJumpRef.current -= 1;
      p.vy = PQ_JUMP;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 80);
      if (doubleJumpRef.current === 0) setHasDoubleJump(false);
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
        if (tickRef.current % 8 === 0) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } else if (keys.current.right) {
        p.vx = PQ_SPEED;
        p.facingRight = true;
        if (tickRef.current % 8 === 0) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
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
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);  // Kill enemy via stomp
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
          if (pu.type === 'life') {
            setLives(l => Math.min(l + 1, 9));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 80);
            setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 160);
          } else if (pu.type === 'doublejump') {
            doubleJumpRef.current = Math.min(doubleJumpRef.current + 3, 6);
            setHasDoubleJump(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 80);
            setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 160);
            setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 240);
          } else {
            setInvincible(true);
            setHasGun(true);
            invincibilityTimer.current = 5000; // 5 seconds
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 120);
            setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 240);
          }
        }
      }

      // Mystery blocks ❓ collision
      for (let blk of (w.blocks || [])) {
        if (!blk.active) continue;
        if (p.x < blk.x + blk.w && p.x + p.w > blk.x && p.y < blk.y + blk.h && p.y + p.h > blk.y) {
          if (p.vy < 0 && !blk.hit) {
            // Golpe desde abajo — activar bloque
            blk.hit = true;
            p.y = blk.y + blk.h;
            p.vy = 0;
            w.powerups.push({
              x: blk.x + blk.w / 2 - 12,
              y: blk.y - 30,
              w: 25, h: 25,
              active: true,
              type: blk.type,
            });
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 80);
          } else if (p.vy > 0) {
            // Aterrizar encima del bloque
            p.y = blk.y - p.h;
            p.vy = 0;
          } else if (p.vy < 0 && blk.hit) {
            // Bloque ya golpeado — rebotar jugador
            p.y = blk.y + blk.h;
            p.vy = 0;
          }
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
            break;
          }
        }
      }

      // Goal collision
      if (w.goal && p.x < w.goal.x + w.goal.w && p.x + p.w > w.goal.x && p.y < w.goal.y + w.goal.h && p.y + p.h > w.goal.y) {
        celebrateVibrate();
        if (level >= 15) {
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
  const worldColors = ['#87CEEB', '#98FB98', '#DDA0DD', '#F0E68C', '#FFB6C1', '#87CEFA', '#E0FFFF', '#FFDAB9', '#B0E0E6', '#FFE4E1', '#D8F3DC', '#FDE8D8', '#D6EAF8', '#F9EBEA', '#2C3E50'];
  const bgColor = worldColors[(level - 1) % 15];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={styles.title}>WORLD {level}</Text>
        <View style={{ position: 'absolute', right: 10, top: 8, alignItems: 'flex-end', gap: 3, zIndex: 10 }}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>❤️ {lives}</Text>
          {hasDoubleJump && <Text style={{ color: '#0ff', fontSize: 11, fontWeight: 'bold' }}>🦅×{doubleJumpRef.current}</Text>}
          <Pressable onPress={() => { wasRunningRef.current = running; setRunning(false); setShowWorldSelect(true); }}
            style={{ backgroundColor: '#9b59b6', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4 }}>
            <Text style={{ color: '#fff', fontSize: 9, fontWeight: 'bold' }}>🗺 MUNDOS</Text>
          </Pressable>
          <Pressable onPress={loadGame}
            style={{ backgroundColor: '#ffd700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
            <Text style={{ color: '#000', fontSize: 11, fontWeight: 'bold' }}>LOAD</Text>
          </Pressable>
          <Pressable onPress={saveGame}
            style={{ backgroundColor: '#0ff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
            <Text style={{ color: '#000', fontSize: 11, fontWeight: 'bold' }}>SAVE</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.gameArea, { backgroundColor: bgColor, borderColor: '#fff', height: GAME_HEIGHT, flex: 0, marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
        {/* Render World */}
        <View style={{ transform: [{ translateX: -cameraX.current }] }}>
          {world.current.platforms.map((plat, i) => (
            <View key={`p${i}`} style={{ position: 'absolute', left: plat.x, top: plat.y, width: plat.w, height: plat.h, backgroundColor: '#654321', borderWidth: 2, borderColor: '#3e2723' }} />
          ))}
          {world.current.enemies.map((e, i) => e.active && (
            <Text key={`e${i}`} style={{ position: 'absolute', left: e.x, top: e.y - 5, fontSize: 30 }}>👾</Text>
          ))}
          {world.current.powerups.map((pu, i) => pu.active && (
            <Text key={`pu${i}`} style={{ position: 'absolute', left: pu.x, top: pu.y - 5, fontSize: 25 }}>
              {pu.type === 'life' ? '❤️' : pu.type === 'doublejump' ? '🦅' : '⭐'}
            </Text>
          ))}
          {(world.current.blocks || []).map((blk, i) => (
            <Text key={`blk${i}`} style={{ position: 'absolute', left: blk.x, top: blk.y - 5, fontSize: 28 }}>
              {blk.hit ? '📦' : '❓'}
            </Text>
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
            <Text style={styles.overlaySub}>{gameWon ? '¡Todos los 15 mundos conquistados! 🏆' : 'Reach the green pillar. Grab ⭐ for invincibility + gun.'}</Text>
            <View style={{flexDirection: 'row', gap: 20}}>
              <Pressable style={styles.btn} onPress={startGame}><Text style={styles.btnText}>{gameOver || gameWon ? 'RESTART' : 'START'}</Text></Pressable>
              {(!gameOver && !gameWon) && <Pressable style={[styles.btn, {backgroundColor: '#ffd700'}]} onPress={loadGame}><Text style={styles.btnText}>LOAD</Text></Pressable>}
            </View>
          </View>
        )}
      </View>

      {/* D-Pad — siempre renderizado para mantener altura consistente */}
      <View style={[styles.controlBar, { paddingBottom: bottomInset + 12, height: bottomInset + 125 }, !running && { opacity: 0, pointerEvents: 'none' }]}>
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

      {/* World Select Modal */}
      {showWorldSelect && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.92)', zIndex: 999, padding: 20, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 4 }}>🗺 SELECCIONAR MUNDO</Text>
          <Text style={{ color: '#aaa', fontSize: 12, marginBottom: 16 }}>Desbloqueados: 1 – {maxLevel}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', maxWidth: 320 }}>
            {Array.from({ length: maxLevel }, (_, i) => i + 1).map(w => (
              <Pressable key={w} onPress={() => {
                setShowWorldSelect(false);
                setGameOver(false);
                setGameWon(false);
                initLevel(w);
                setRunning(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }} style={{
                width: 58, height: 58,
                backgroundColor: w === level ? '#0ff' : '#1a1a3a',
                borderRadius: 10, justifyContent: 'center', alignItems: 'center',
                borderWidth: 2, borderColor: w === level ? '#0ff' : '#444',
              }}>
                <Text style={{ color: w === level ? '#000' : '#fff', fontSize: 18, fontWeight: 'bold' }}>{w}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => { setShowWorldSelect(false); if (wasRunningRef.current) setRunning(true); }}
            style={{ marginTop: 22, backgroundColor: '#e74c3c', paddingHorizontal: 30, paddingVertical: 10, borderRadius: 8 }}>
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>CANCELAR</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// ==========================================
// 4. PING PONG
// ==========================================
function PingPong({ onExit }) {
  const [gameState, setGameState] = useState('idle'); // idle | playing | gameover
  const [scoreP, setScoreP] = useState(0);
  const [scoreAI, setScoreAI] = useState(0);
  const [, setTick] = useState(0);

  const ball = useRef({ x: width / 2, y: GAME_HEIGHT / 2, vx: 4, vy: 6 });
  const playerX = useRef(width / 2 - PP_PADDLE_W / 2);
  const aiX = useRef(width / 2 - PP_PADDLE_W / 2);
  const pScore = useRef(0);
  const aScore = useRef(0);

  const normalizeSpeed = (b, maxSpd) => {
    const spd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (spd > maxSpd) { b.vx = (b.vx / spd) * maxSpd; b.vy = (b.vy / spd) * maxSpd; }
    if (Math.abs(b.vy) < 4) b.vy = b.vy > 0 ? 4 : -4;
  };

  const resetBall = (toPlayer = true) => {
    ball.current = {
      x: width / 2 - PP_BALL_SIZE / 2,
      y: GAME_HEIGHT / 2 - PP_BALL_SIZE / 2,
      vx: (Math.random() > 0.5 ? 1 : -1) * (4 + Math.random() * 2),
      vy: toPlayer ? Math.abs(5 + Math.random() * 2) : -(5 + Math.random() * 2),
    };
  };

  const startGame = () => {
    pScore.current = 0;
    aScore.current = 0;
    setScoreP(0);
    setScoreAI(0);
    playerX.current = width / 2 - PP_PADDLE_W / 2;
    aiX.current = width / 2 - PP_PADDLE_W / 2;
    resetBall(true);
    setGameState('playing');
  };

  useEffect(() => {
    if (gameState !== 'playing') return;
    const loop = setInterval(() => {
      const b = ball.current;
      b.x += b.vx;
      b.y += b.vy;

      // Left/right wall bounce
      if (b.x <= 0) { b.x = 0; b.vx = Math.abs(b.vx); }
      if (b.x >= width - PP_BALL_SIZE) { b.x = width - PP_BALL_SIZE; b.vx = -Math.abs(b.vx); }

      // AI paddle collision (top)
      const aiPadY = 40;
      if (b.vy < 0 && b.y <= aiPadY + PP_PADDLE_H && b.y + PP_BALL_SIZE >= aiPadY) {
        if (b.x + PP_BALL_SIZE > aiX.current && b.x < aiX.current + PP_PADDLE_W) {
          b.vy = Math.abs(b.vy);
          const rel = (b.x + PP_BALL_SIZE / 2 - aiX.current) / PP_PADDLE_W;
          b.vx = (rel - 0.5) * 12;
          normalizeSpeed(b, 13);
        }
      }

      // Player paddle collision (bottom)
      const pPadY = GAME_HEIGHT - PP_PADDLE_H - 40;
      if (b.vy > 0 && b.y + PP_BALL_SIZE >= pPadY && b.y <= pPadY + PP_PADDLE_H) {
        if (b.x + PP_BALL_SIZE > playerX.current && b.x < playerX.current + PP_PADDLE_W) {
          b.vy = -Math.abs(b.vy) * 1.04;
          const rel = (b.x + PP_BALL_SIZE / 2 - playerX.current) / PP_PADDLE_W;
          b.vx = (rel - 0.5) * 12;
          normalizeSpeed(b, 14);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 45);
        }
      }

      // AI movement with progressive difficulty
      const aiTarget = b.x + PP_BALL_SIZE / 2 - PP_PADDLE_W / 2;
      const aiDiff = aiTarget - aiX.current;
      const aiSpd = Math.min(Math.abs(aiDiff), 3 + aScore.current * 0.2);
      aiX.current = Math.max(0, Math.min(width - PP_PADDLE_W, aiX.current + Math.sign(aiDiff) * aiSpd));

      // Scoring
      if (b.y > GAME_HEIGHT + 20) {
        aScore.current += 1;
        setScoreAI(aScore.current);
        if (aScore.current >= PP_MAX_SCORE) { deathVibrate(); setGameState('gameover'); return; }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        resetBall(true);
      } else if (b.y < -20) {
        pScore.current += 1;
        setScoreP(pScore.current);
        if (pScore.current >= PP_MAX_SCORE) { celebrateVibrate(); setGameState('gameover'); return; }
        scoreVibrate();
        resetBall(false);
      }

      setTick(t => t + 1);
    }, 16);
    return () => clearInterval(loop);
  }, [gameState]);

  const ppPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gs) => {
        playerX.current = Math.max(0, Math.min(width - PP_PADDLE_W, gs.moveX - PP_PADDLE_W / 2));
      },
    })
  ).current;

  const won = pScore.current >= PP_MAX_SCORE;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={[styles.title, { color: '#fff' }]}>PING PONG 🏓</Text>
        <View style={[styles.stats, { justifyContent: 'center', gap: 8 }]}>
          <Text style={[styles.statText, { color: '#f55', fontSize: 20 }]}>{scoreAI}</Text>
          <Text style={[styles.statText, { color: '#aaa' }]}>vs</Text>
          <Text style={[styles.statText, { color: '#ff0', fontSize: 20 }]}>{scoreP}</Text>
        </View>
      </View>

      <View style={[styles.gameArea, { backgroundColor: '#05081a' }]} {...ppPanResponder.panHandlers}>
        {/* Center dashed line */}
        {Array.from({ length: 16 }).map((_, i) => (
          <View key={i} style={{
            position: 'absolute', left: width / 2 - 2,
            top: 50 + i * ((GAME_HEIGHT - 100) / 16),
            width: 4, height: (GAME_HEIGHT - 100) / 16 * 0.45,
            backgroundColor: 'rgba(255,255,255,0.18)',
          }} />
        ))}

        {/* AI label */}
        <Text style={{ position: 'absolute', top: 14, left: 16, color: '#f55', fontSize: 13, fontWeight: 'bold' }}>🤖 AI</Text>
        {/* Player label */}
        <Text style={{ position: 'absolute', bottom: 14, right: 16, color: '#ff0', fontSize: 13, fontWeight: 'bold' }}>YOU 🟡</Text>

        {/* AI paddle */}
        <View style={{
          position: 'absolute', left: aiX.current, top: 40,
          width: PP_PADDLE_W, height: PP_PADDLE_H,
          backgroundColor: '#f55', borderRadius: 7,
          shadowColor: '#f55', shadowOpacity: 0.8, shadowRadius: 8,
        }} />

        {/* Player paddle */}
        <View style={{
          position: 'absolute', left: playerX.current,
          top: GAME_HEIGHT - PP_PADDLE_H - 40,
          width: PP_PADDLE_W, height: PP_PADDLE_H,
          backgroundColor: '#ff0', borderRadius: 7,
          shadowColor: '#ff0', shadowOpacity: 0.8, shadowRadius: 8,
        }} />

        {/* Ball */}
        <View style={{
          position: 'absolute', left: ball.current.x, top: ball.current.y,
          width: PP_BALL_SIZE, height: PP_BALL_SIZE,
          backgroundColor: '#fff', borderRadius: PP_BALL_SIZE / 2,
          shadowColor: '#fff', shadowOpacity: 1, shadowRadius: 8,
        }} />

        {gameState !== 'playing' && (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>
              {gameState === 'gameover' ? (won ? '🏆 YOU WIN!' : '🤖 AI WINS') : '🏓 PING PONG'}
            </Text>
            {gameState === 'gameover' && (
              <Text style={[styles.overlaySub, { color: '#ffd700', fontSize: 22, marginBottom: 8 }]}>
                {scoreP} — {scoreAI}
              </Text>
            )}
            <Text style={styles.overlaySub}>
              {gameState === 'idle'
                ? `¡Primero en llegar a ${PP_MAX_SCORE} gana! Arrastra tu paleta 🟡.`
                : won ? '¡Increíble! Venciste a la IA.' : '¡Sigue intentándolo!'}
            </Text>
            <Pressable style={styles.btn} onPress={startGame}>
              <Text style={styles.btnText}>{gameState === 'gameover' ? 'REVANCHA' : 'JUGAR'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// ==========================================
// 5. BREAKOUT
// ==========================================
function Breakout({ onExit }) {
  const brickW = (width - BK_MARGIN * (BK_COLS + 1)) / BK_COLS;
  const [gameState, setGameState] = useState('idle');
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);
  const [, setTick] = useState(0);

  const paddleX = useRef(width / 2 - BK_PADDLE_W / 2);
  const ball = useRef({ x: width / 2 - BK_BALL_R, y: GAME_HEIGHT - 110, vx: 0, vy: 0 });
  const bricksRef = useRef([]);
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const levelRef = useRef(1);
  const highScore = useRef(0);
  const launched = useRef(false);
  const bkGameStateRef = useRef('idle');

  const BRICK_COLORS = ['#ff4444', '#ff6600', '#ffcc00', '#44cc44', '#0099ff', '#9933ff', '#ff66bb', '#00ffcc'];

  const buildLevel = (lvl) => {
    const baseRows = Math.min(4 + Math.floor((lvl - 1) / 2), 8);
    const bs = [];
    for (let r = 0; r < baseRows; r++) {
      for (let c = 0; c < BK_COLS; c++) {
        let include = true;
        if (lvl === 3 || lvl === 6 || lvl === 9) {
          // Diamond
          const midC = (BK_COLS - 1) / 2;
          const midR = (baseRows - 1) / 2;
          if (Math.abs(c - midC) + Math.abs(r - midR) > baseRows / 2 + 0.5) include = false;
        } else if (lvl === 4 || lvl === 7 || lvl === 10) {
          // Checkerboard
          include = (r + c) % 2 === 0;
        } else if (lvl === 5 || lvl === 8) {
          // Inverted V
          const halfCols = BK_COLS / 2;
          const targetRow = Math.floor(Math.abs(c - halfCols + 0.5));
          if (r < targetRow) include = false;
        }
        if (!include) continue;
        const hits = lvl >= 3 && r < 2 ? 2 : 1;
        bs.push({
          id: r * 100 + c,
          x: BK_MARGIN + c * (brickW + BK_MARGIN),
          y: BK_BRICKS_TOP + r * (BK_BRICK_H + BK_MARGIN),
          w: brickW,
          h: BK_BRICK_H,
          hits,
          maxHits: hits,
          color: BRICK_COLORS[r % BRICK_COLORS.length],
          active: true,
        });
      }
    }
    bricksRef.current = bs;
  };

  const resetBallToPaddle = () => {
    launched.current = false;
    ball.current.vx = 0;
    ball.current.vy = 0;
  };

  const launchBall = () => {
    if (launched.current || bkGameStateRef.current !== 'playing') return;
    launched.current = true;
    const spd = 7 + levelRef.current * 0.4;
    ball.current.vx = (Math.random() > 0.5 ? 1 : -1) * (4 + Math.random() * 2);
    ball.current.vy = -spd;
  };

  const startGame = () => {
    scoreRef.current = 0;
    livesRef.current = 3;
    levelRef.current = 1;
    setScore(0);
    setLives(3);
    setLevel(1);
    paddleX.current = width / 2 - BK_PADDLE_W / 2;
    buildLevel(1);
    resetBallToPaddle();
    setGameState('playing');
    bkGameStateRef.current = 'playing';
  };

  useEffect(() => {
    if (gameState !== 'playing') return;
    const loop = setInterval(() => {
      const b = ball.current;

      if (!launched.current) {
        b.x = paddleX.current + BK_PADDLE_W / 2 - BK_BALL_R;
        b.y = GAME_HEIGHT - BK_PADDLE_H - 42 - BK_BALL_R * 2;
        setTick(t => t + 1);
        return;
      }

      b.x += b.vx;
      b.y += b.vy;

      // Wall bounce
      if (b.x <= 0) { b.x = 0; b.vx = Math.abs(b.vx); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
      if (b.x + BK_BALL_R * 2 >= width) { b.x = width - BK_BALL_R * 2; b.vx = -Math.abs(b.vx); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
      if (b.y <= 0) { b.y = 0; b.vy = Math.abs(b.vy); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }

      // Paddle collision
      const pY = GAME_HEIGHT - BK_PADDLE_H - 42;
      if (b.vy > 0 && b.y + BK_BALL_R * 2 >= pY && b.y <= pY + BK_PADDLE_H) {
        if (b.x + BK_BALL_R * 2 > paddleX.current && b.x < paddleX.current + BK_PADDLE_W) {
          b.vy = -Math.abs(b.vy);
          const rel = (b.x + BK_BALL_R - paddleX.current) / BK_PADDLE_W;
          b.vx = (rel - 0.5) * 14;
          const spd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
          const maxSpd = 8 + levelRef.current * 0.4;
          if (spd > maxSpd + 3) { b.vx = (b.vx / spd) * (maxSpd + 3); b.vy = (b.vy / spd) * (maxSpd + 3); }
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 50);
        }
      }

      // Brick collisions
      for (let i = bricksRef.current.length - 1; i >= 0; i--) {
        const br = bricksRef.current[i];
        if (!br.active) continue;
        const cx = b.x + BK_BALL_R;
        const cy = b.y + BK_BALL_R;
        if (cx > br.x && cx < br.x + br.w && cy > br.y && cy < br.y + br.h) {
          br.hits -= 1;
          if (br.hits <= 0) br.active = false;
          const fromTop = cy - br.y;
          const fromBottom = br.y + br.h - cy;
          const fromLeft = cx - br.x;
          const fromRight = br.x + br.w - cx;
          const minPen = Math.min(fromTop, fromBottom, fromLeft, fromRight);
          if (minPen === fromTop || minPen === fromBottom) b.vy = -b.vy;
          else b.vx = -b.vx;
          scoreRef.current += br.maxHits * 10;
          setScore(scoreRef.current);
          if (br.hits <= 0) { popVibrate(); } else { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
          break;
        }
      }

      // Level clear
      if (bricksRef.current.every(br => !br.active)) {
        levelRef.current += 1;
        setLevel(levelRef.current);
        buildLevel(levelRef.current);
        resetBallToPaddle();
        celebrateVibrate();
      }

      // Ball lost
      if (b.y > GAME_HEIGHT + 30) {
        livesRef.current -= 1;
        setLives(livesRef.current);
        if (livesRef.current <= 0) {
          if (scoreRef.current > highScore.current) highScore.current = scoreRef.current;
          bkGameStateRef.current = 'gameover';
          deathVibrate();
          setGameState('gameover');
          return;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 90);
        resetBallToPaddle();
      }

      setTick(t => t + 1);
    }, 16);
    return () => clearInterval(loop);
  }, [gameState]);

  const bkPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => launchBall(),
      onPanResponderMove: (_, gs) => {
        paddleX.current = Math.max(0, Math.min(width - BK_PADDLE_W, gs.moveX - BK_PADDLE_W / 2));
      },
    })
  ).current;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={[styles.title, { color: '#ff6600' }]}>BREAKOUT 🧱</Text>
        <View style={styles.stats}>
          <Text style={styles.statText}>LVL {level}</Text>
          <Text style={styles.statText}>❤️ {lives}</Text>
          <Text style={styles.statText}>{score}</Text>
        </View>
      </View>

      <View style={[styles.gameArea, { backgroundColor: '#08080f' }]} {...bkPanResponder.panHandlers}>
        {/* Bricks */}
        {bricksRef.current.map(br => br.active && (
          <View key={br.id} style={{
            position: 'absolute', left: br.x, top: br.y, width: br.w, height: br.h,
            backgroundColor: br.hits < br.maxHits ? '#555' : br.color,
            borderRadius: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
            justifyContent: 'center', alignItems: 'center',
          }}>
            {br.maxHits > 1 && (
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>
                {'●'.repeat(br.hits)}
              </Text>
            )}
          </View>
        ))}

        {/* Ball */}
        <View style={{
          position: 'absolute',
          left: ball.current.x, top: ball.current.y,
          width: BK_BALL_R * 2, height: BK_BALL_R * 2,
          backgroundColor: '#fff', borderRadius: BK_BALL_R,
          shadowColor: '#fff', shadowOpacity: 1, shadowRadius: 6,
        }} />

        {/* Paddle */}
        <View style={{
          position: 'absolute',
          left: paddleX.current, top: GAME_HEIGHT - BK_PADDLE_H - 42,
          width: BK_PADDLE_W, height: BK_PADDLE_H,
          backgroundColor: '#ff6600', borderRadius: 7,
          shadowColor: '#ff6600', shadowOpacity: 0.9, shadowRadius: 8,
        }} />

        {/* Launch hint */}
        {!launched.current && gameState === 'playing' && (
          <Text style={{ position: 'absolute', bottom: 70, alignSelf: 'center', color: '#888', fontSize: 13 }}>
            Toca para lanzar 🎯
          </Text>
        )}

        {gameState !== 'playing' && (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>
              {gameState === 'gameover' ? '💥 GAME OVER' : '🧱 BREAKOUT'}
            </Text>
            {gameState === 'gameover' && (
              <Text style={[styles.overlaySub, { color: '#ffd700' }]}>
                Score: {score}   Récord: {highScore.current}
              </Text>
            )}
            <Text style={styles.overlaySub}>
              {gameState === 'idle' ? 'Arrastra para mover la paleta. ¡Rompe todos los ladrillos!' : '¡Gracias por jugar!'}
            </Text>
            <Pressable style={styles.btn} onPress={startGame}>
              <Text style={styles.btnText}>{gameState === 'gameover' ? 'RETRY' : 'START'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// ==========================================
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
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 80);
    if (ammoRef.current <= 0) endRound();
  };

  const handleMiss = (lx, ly) => {
    if (ammoRef.current <= 0 || gameStateRef.current !== 'playing') return;
    ammoRef.current -= 1;
    setAmmo(ammoRef.current);
    showCrosshair(lx, ly);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

function SnakePower({ onExit }) {
  const COLS = 20;
  const ROWS = 20;
  const CELL_SIZE = Math.floor(Math.min(width, GAME_HEIGHT) / COLS);
  const GRID_PX = CELL_SIZE * COLS;

  const DIR_RIGHT = { x: 1, y: 0 };
  const DIR_LEFT  = { x: -1, y: 0 };
  const DIR_UP    = { x: 0, y: -1 };
  const DIR_DOWN  = { x: 0, y: 1 };
  const POWER_TYPES = ['⚡', '🛡️', '💎', '🌀'];

  const initSnakeArr = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];

  const [gamePhase, setGamePhase] = useState('idle');
  const [snakeDisp, setSnakeDisp] = useState(initSnakeArr);
  const [foodDisp, setFoodDisp] = useState({ x: 15, y: 10 });
  const [puDisp, setPuDisp] = useState(null);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [activeEffect, setActiveEffect] = useState(null);

  const snakeRef    = useRef(initSnakeArr);
  const dirRef      = useRef(DIR_RIGHT);
  const nextDirRef  = useRef(null);
  const foodRef     = useRef({ x: 15, y: 10 });
  const puRef       = useRef(null);
  const scoreRef    = useRef(0);
  const effectRef   = useRef(null);
  const phaseRef    = useRef('idle');
  const intervalRef = useRef(null);
  const puTimeoutRef = useRef(null);
  const fxTimeoutRef = useRef(null);
  const tickFnRef   = useRef(null);

  useEffect(() => {
    AsyncStorage.getItem('snakeHighScore').then(v => {
      if (v) setHighScore(parseInt(v, 10));
    });
    return () => {
      clearInterval(intervalRef.current);
      clearTimeout(puTimeoutRef.current);
      clearTimeout(fxTimeoutRef.current);
    };
  }, []);

  const randomPos = (exclude) => {
    let pos;
    do {
      pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    } while (exclude.some(p => p.x === pos.x && p.y === pos.y));
    return pos;
  };

  const startLoop = (ms) => {
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => { tickFnRef.current && tickFnRef.current(); }, ms);
  };

  const schedulePu = () => {
    clearTimeout(puTimeoutRef.current);
    puTimeoutRef.current = setTimeout(() => {
      if (phaseRef.current !== 'playing') return;
      const type = POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)];
      const pos  = randomPos([...snakeRef.current, foodRef.current]);
      const pu   = { ...pos, type };
      puRef.current = pu;
      setPuDisp({ ...pu });
      puTimeoutRef.current = setTimeout(() => {
        puRef.current = null;
        setPuDisp(null);
        schedulePu();
      }, 10000);
    }, 30000);
  };

  const applyEffect = (type, currentSnake) => {
    clearTimeout(fxTimeoutRef.current);
    if (type === '⚡') {
      effectRef.current = 'speed';
      setActiveEffect('speed');
      startLoop(75);
      fxTimeoutRef.current = setTimeout(() => {
        effectRef.current = null;
        setActiveEffect(null);
        if (phaseRef.current === 'playing') startLoop(150);
      }, 5000);
    } else if (type === '🛡️') {
      effectRef.current = 'shield';
      setActiveEffect('shield');
      fxTimeoutRef.current = setTimeout(() => {
        effectRef.current = null;
        setActiveEffect(null);
      }, 5000);
    } else if (type === '💎') {
      scoreRef.current += 50;
      setScore(scoreRef.current);
    } else if (type === '🌀') {
      dirRef.current  = { x: -dirRef.current.x, y: -dirRef.current.y };
      nextDirRef.current = null;
      const rev = [...currentSnake].reverse();
      snakeRef.current = rev;
      setSnakeDisp([...rev]);
    }
  };

  const doGameOver = () => {
    clearInterval(intervalRef.current);
    clearTimeout(puTimeoutRef.current);
    clearTimeout(fxTimeoutRef.current);
    phaseRef.current  = 'gameover';
    effectRef.current = null;
    setGamePhase('gameover');
    setActiveEffect(null);
    const fs = scoreRef.current;
    AsyncStorage.getItem('snakeHighScore').then(v => {
      const prev = v ? parseInt(v, 10) : 0;
      if (fs > prev) {
        AsyncStorage.setItem('snakeHighScore', String(fs));
        setHighScore(fs);
      }
    });
    deathVibrate();
  };

  const tick = () => {
    if (phaseRef.current !== 'playing') return;
    const dir = nextDirRef.current || dirRef.current;
    dirRef.current    = dir;
    nextDirRef.current = null;

    const head = snakeRef.current[0];
    let nx = head.x + dir.x;
    let ny = head.y + dir.y;

    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
      if (effectRef.current === 'shield') {
        nx = (nx + COLS) % COLS;
        ny = (ny + ROWS) % ROWS;
      } else {
        doGameOver();
        return;
      }
    }

    const newHead = { x: nx, y: ny };

    if (effectRef.current !== 'shield') {
      for (let i = 1; i < snakeRef.current.length; i++) {
        if (snakeRef.current[i].x === newHead.x && snakeRef.current[i].y === newHead.y) {
          doGameOver();
          return;
        }
      }
    }

    const newSnake = [newHead, ...snakeRef.current];
    let grew = false;

    if (newHead.x === foodRef.current.x && newHead.y === foodRef.current.y) {
      grew = true;
      scoreRef.current += 10;
      setScore(scoreRef.current);
      const nf = randomPos(newSnake);
      foodRef.current = nf;
      setFoodDisp({ ...nf });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 60);
    }

    const pu = puRef.current;
    if (pu && pu.x === newHead.x && pu.y === newHead.y) {
      grew = true;
      clearTimeout(puTimeoutRef.current);
      puRef.current = null;
      setPuDisp(null);
      applyEffect(pu.type, newSnake);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      schedulePu();
    }

    if (!grew) newSnake.pop();
    snakeRef.current = newSnake;
    setSnakeDisp([...newSnake]);
  };

  tickFnRef.current = tick;

  const changeDir = (newDir) => {
    const cur = dirRef.current;
    if (newDir.x === -cur.x && newDir.y === -cur.y) return;
    nextDirRef.current = newDir;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };

  const startGame = () => {
    const iSnake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    const iFood  = randomPos(iSnake);
    snakeRef.current    = iSnake;
    foodRef.current     = iFood;
    dirRef.current      = DIR_RIGHT;
    nextDirRef.current  = null;
    scoreRef.current    = 0;
    effectRef.current   = null;
    puRef.current       = null;
    phaseRef.current    = 'playing';
    setSnakeDisp([...iSnake]);
    setFoodDisp({ ...iFood });
    setScore(0);
    setActiveEffect(null);
    setPuDisp(null);
    setGamePhase('playing');
    clearInterval(intervalRef.current);
    clearTimeout(puTimeoutRef.current);
    clearTimeout(fxTimeoutRef.current);
    startLoop(150);
    schedulePu();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderRelease: (_, gs) => {
        if (phaseRef.current !== 'playing') return;
        const { dx, dy } = gs;
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          tickFnRef.current && (dx > 0
            ? (nextDirRef.current = DIR_RIGHT)
            : (nextDirRef.current = DIR_LEFT));
          if (dx > 0 && dirRef.current.x !== -1) nextDirRef.current = DIR_RIGHT;
          else if (dx < 0 && dirRef.current.x !== 1) nextDirRef.current = DIR_LEFT;
        } else {
          if (dy > 0 && dirRef.current.y !== -1) nextDirRef.current = DIR_DOWN;
          else if (dy < 0 && dirRef.current.y !== 1) nextDirRef.current = DIR_UP;
        }
      },
    })
  ).current;

  const snkStyles = StyleSheet.create({
    cell: {
      position: 'absolute',
      textAlign: 'center',
      lineHeight: CELL_SIZE,
      fontSize: CELL_SIZE - 2,
      width: CELL_SIZE,
      height: CELL_SIZE,
    },
    grid: {
      width: GRID_PX,
      height: GRID_PX,
      backgroundColor: '#0d1117',
      position: 'relative',
      alignSelf: 'center',
      borderWidth: 2,
      borderColor: '#21262d',
      borderRadius: 4,
    },
    effectPill: {
      paddingHorizontal: 10,
      paddingVertical: 2,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    effectTxt: {
      fontSize: 12,
      fontWeight: 'bold',
      color: '#000',
    },
    controls: {
      alignItems: 'center',
      paddingBottom: 6,
      paddingTop: 4,
    },
    ctrlRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    ctrlBtn: {
      width: 72,
      height: 72,
      backgroundColor: '#161b22',
      borderRadius: 10,
      margin: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: '#30363d',
    },
    ctrlTxt: {
      color: '#c9d1d9',
      fontSize: 20,
      fontWeight: 'bold',
    },
    ctrlGap: {
      width: 54,
      height: 54,
      margin: 4,
    },
  });

  const renderBoard = () => {
    const nodes = [];
    snakeDisp.forEach((seg, i) => {
      nodes.push(
        <Text
          key={`s${i}`}
          style={[snkStyles.cell, { left: seg.x * CELL_SIZE, top: seg.y * CELL_SIZE }]}
        >
          {i === 0 ? '🐍' : '🟢'}
        </Text>
      );
    });
    nodes.push(
      <Text
        key="food"
        style={[snkStyles.cell, { left: foodDisp.x * CELL_SIZE, top: foodDisp.y * CELL_SIZE }]}
      >
        🍎
      </Text>
    );
    if (puDisp) {
      nodes.push(
        <Text
          key="pu"
          style={[snkStyles.cell, { left: puDisp.x * CELL_SIZE, top: puDisp.y * CELL_SIZE }]}
        >
          {puDisp.type}
        </Text>
      );
    }
    return nodes;
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.title}>🐍 SNAKE POWER</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.stats, { alignItems: 'center' }]}>
        <Text style={styles.statText}>Score: {score}</Text>
        <Text style={styles.statText}>Best: {highScore}</Text>
        {activeEffect === 'speed'  && (
          <View style={[snkStyles.effectPill, { backgroundColor: '#f6c90e' }]}>
            <Text style={snkStyles.effectTxt}>⚡ FAST</Text>
          </View>
        )}
        {activeEffect === 'shield' && (
          <View style={[snkStyles.effectPill, { backgroundColor: '#3fb950' }]}>
            <Text style={snkStyles.effectTxt}>🛡️ SHIELD</Text>
          </View>
        )}
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        <View style={snkStyles.grid}>
          {renderBoard()}
        </View>
        {gamePhase !== 'playing' && (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>
              {gamePhase === 'idle' ? '🐍 Snake Power' : '💀 Game Over'}
            </Text>
            <Text style={styles.overlaySub}>
              {gamePhase === 'idle'
                ? 'Desliza o usa los botones'
                : `Puntuación: ${score}`}
            </Text>
            {gamePhase === 'gameover' && (
              <Text style={[styles.overlaySub, { marginBottom: 10 }]}>
                Récord: {highScore}
              </Text>
            )}
            <Pressable style={styles.btn} onPress={startGame}>
              <Text style={styles.btnText}>
                {gamePhase === 'idle' ? 'START' : 'RETRY'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={snkStyles.controls}>
        <View style={snkStyles.ctrlRow}>
          <View style={snkStyles.ctrlGap} />
          <View style={snkStyles.ctrlBtn} onTouchStart={() => changeDir(DIR_UP)}>
            <Text style={snkStyles.ctrlTxt}>▲</Text>
          </View>
          <View style={snkStyles.ctrlGap} />
        </View>
        <View style={snkStyles.ctrlRow}>
          <View style={snkStyles.ctrlBtn} onTouchStart={() => changeDir(DIR_LEFT)}>
            <Text style={snkStyles.ctrlTxt}>◀</Text>
          </View>
          <View style={snkStyles.ctrlBtn} onTouchStart={() => changeDir(DIR_DOWN)}>
            <Text style={snkStyles.ctrlTxt}>▼</Text>
          </View>
          <View style={snkStyles.ctrlBtn} onTouchStart={() => changeDir(DIR_RIGHT)}>
            <Text style={snkStyles.ctrlTxt}>▶</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ============================================================
// 8. VOID CRAWLER  —  Neon Roguelike Dungeon Crawler
// ============================================================
const VC_FLOOR_THEMES = [
  { bg: '#08081a', wall: '#16163a', floor: '#0d0d28', accent: '#6677ff', name: 'DUNGEON DEPTHS'  },
  { bg: '#081408', wall: '#163a16', floor: '#0d280d', accent: '#44ff88', name: 'POISON SWAMP'    },
  { bg: '#1a0808', wall: '#3a1616', floor: '#280d0d', accent: '#ff5544', name: 'FIRE CAVERN'     },
  { bg: '#180818', wall: '#381638', floor: '#260d26', accent: '#ee44ff', name: 'SHADOW REALM'    },
  { bg: '#1a1808', wall: '#3a3816', floor: '#28260d', accent: '#ffdd00', name: 'DRAGON LAIR 🐉'  },
];
const VC_ENEMY_DEFS = {
  skeleton: { emoji: '💀', hp: 6,  atk: 2, def: 0, xp: 5   },
  goblin:   { emoji: '👺', hp: 4,  atk: 3, def: 0, xp: 8   },
  orc:      { emoji: '👹', hp: 10, atk: 4, def: 1, xp: 12  },
  demon:    { emoji: '😈', hp: 15, atk: 6, def: 2, xp: 20  },
  dragon:   { emoji: '🐉', hp: 50, atk: 12,def: 3, xp: 100, isBoss: true },
};
const VC_FLOOR_ENEMIES = [
  ['skeleton','skeleton','goblin'],
  ['goblin','goblin','orc','orc'],
  ['orc','orc','orc','demon'],
  ['demon','demon','demon','orc'],
  ['dragon','demon','demon'],
];
const VC_ITEM_DEFS = [
  { emoji: '⚔️',  type: 'atk',   value: 2,  label: '+2 ATK'   },
  { emoji: '🛡️', type: 'def',   value: 1,  label: '+1 DEF'   },
  { emoji: '❤️',  type: 'heal',  value: 8,  label: '+8 HP'    },
  { emoji: '💊',  type: 'maxhp', value: 5,  label: '+5 MaxHP' },
  { emoji: '💎',  type: 'xp',    value: 25, label: '+25 XP'   },
];

function VoidCrawler({ onExit }) {
  const [phase, setPhase] = useState('idle');
  const [msgLog, setMsgLog] = useState(['⚔️ Fight. 🏚️ Explore. 🚪 Reach the exit.']);
  const [, setTick] = useState(0);

  const mapRef     = useRef([]);
  const stairsRef  = useRef({ x: 0, y: 0 });
  const playerRef  = useRef({ x:1, y:1, hp:20, maxHp:20, atk:3, def:1, floor:1, xp:0, level:1 });
  const enemiesRef = useRef([]);
  const itemsRef   = useRef([]);
  const eidRef     = useRef(0);
  const iidRef     = useRef(0);
  const phaseRef   = useRef('idle');

  const addMsg = (msg) => setMsgLog(prev => [msg, ...prev].slice(0, 4));

  const xpNeeded = (lvl) => lvl * 20;

  const checkLevelUp = () => {
    const p = playerRef.current;
    while (p.xp >= xpNeeded(p.level)) {
      p.xp   -= xpNeeded(p.level);
      p.level += 1;
      p.atk   += 1;
      p.maxHp += 5;
      p.hp     = Math.min(p.hp + 5, p.maxHp);
      addMsg(`⬆️ LEVEL UP! Lv.${p.level} — ATK+1 MaxHP+5`);
      celebrateVibrate();
    }
  };

  // ── Dungeon generation ──────────────────────────────────
  const generateFloor = (floorNum) => {
    const m = Array.from({ length: VC_ROWS }, () =>
      Array(VC_COLS).fill(VC_WALL)
    );
    const rooms = [];

    const tryRoom = () => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const rw = 4 + Math.floor(Math.random() * 4);
        const rh = 3 + Math.floor(Math.random() * 3);
        const rx = 1 + Math.floor(Math.random() * (VC_COLS - rw - 2));
        const ry = 1 + Math.floor(Math.random() * (VC_ROWS - rh - 2));
        if (!rooms.some(r =>
          rx <= r.x + r.w && rx + rw >= r.x &&
          ry <= r.y + r.h && ry + rh >= r.y
        )) { rooms.push({ x: rx, y: ry, w: rw, h: rh }); return; }
      }
    };
    for (let i = 0; i < 6 + Math.floor(Math.random() * 3); i++) tryRoom();

    // Carve rooms
    for (const room of rooms)
      for (let r = room.y; r < room.y + room.h; r++)
        for (let c = room.x; c < room.x + room.w; c++)
          m[r][c] = VC_FLOOR;

    // Connect consecutive rooms with L corridors
    for (let i = 0; i < rooms.length - 1; i++) {
      const a = rooms[i], b = rooms[i + 1];
      const ax = Math.floor(a.x + a.w / 2), ay = Math.floor(a.y + a.h / 2);
      const bx = Math.floor(b.x + b.w / 2), by = Math.floor(b.y + b.h / 2);
      for (let c = Math.min(ax, bx); c <= Math.max(ax, bx); c++) m[ay][c] = VC_FLOOR;
      for (let r = Math.min(ay, by); r <= Math.max(ay, by); r++) m[r][bx] = VC_FLOOR;
    }
    mapRef.current = m;

    // Place stairs in center of last room
    const last = rooms[rooms.length - 1];
    stairsRef.current = {
      x: Math.floor(last.x + last.w / 2),
      y: Math.floor(last.y + last.h / 2),
    };

    // Respawn player at center of first room
    const p = playerRef.current;
    const first = rooms[0];
    p.x = Math.floor(first.x + first.w / 2);
    p.y = Math.floor(first.y + first.h / 2);

    // Place enemies (avoid first room)
    enemiesRef.current = [];
    const enemyTypes = VC_FLOOR_ENEMIES[Math.min(floorNum - 1, 4)];
    for (const type of enemyTypes) {
      const def = VC_ENEMY_DEFS[type];
      let ex = 0, ey = 0, tries = 60;
      do {
        const ri = 1 + Math.floor(Math.random() * (rooms.length - 1));
        const room = rooms[Math.min(ri, rooms.length - 1)];
        ex = room.x + 1 + Math.floor(Math.random() * Math.max(1, room.w - 2));
        ey = room.y + 1 + Math.floor(Math.random() * Math.max(1, room.h - 2));
        tries--;
      } while (tries > 0 && (
        m[ey]?.[ex] !== VC_FLOOR ||
        (ex === p.x && ey === p.y) ||
        enemiesRef.current.some(e => e.x === ex && e.y === ey)
      ));
      if (tries <= 0) continue;
      enemiesRef.current.push({
        id: eidRef.current++, type, emoji: def.emoji,
        x: ex, y: ey,
        hp:    def.hp    + (floorNum - 1) * 3,
        maxHp: def.hp    + (floorNum - 1) * 3,
        atk:   def.atk   + Math.floor((floorNum - 1) * 0.6),
        def:   def.def,
        xp:    def.xp,
        isBoss: def.isBoss || false,
      });
    }

    // Place items
    itemsRef.current = [];
    const numItems = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numItems; i++) {
      const itemDef = VC_ITEM_DEFS[Math.floor(Math.random() * VC_ITEM_DEFS.length)];
      let ix = 0, iy = 0, tries = 40;
      do {
        const room = rooms[Math.floor(Math.random() * rooms.length)];
        ix = room.x + Math.floor(Math.random() * room.w);
        iy = room.y + Math.floor(Math.random() * room.h);
        tries--;
      } while (tries > 0 && (
        m[iy]?.[ix] !== VC_FLOOR ||
        (ix === p.x && iy === p.y) ||
        (ix === stairsRef.current.x && iy === stairsRef.current.y) ||
        itemsRef.current.some(it => it.x === ix && it.y === iy) ||
        enemiesRef.current.some(e => e.x === ix && e.y === iy)
      ));
      if (tries <= 0) continue;
      itemsRef.current.push({ id: iidRef.current++, ...itemDef, x: ix, y: iy });
    }
  };

  // ── Enemy turn ──────────────────────────────────────────
  const moveEnemies = () => {
    if (phaseRef.current !== 'playing') return;
    const p = playerRef.current;
    const m = mapRef.current;
    for (const e of enemiesRef.current) {
      const dx = p.x - e.x, dy = p.y - e.y;
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        const dmg = Math.max(1, e.atk - p.def);
        p.hp -= dmg;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        if (p.hp <= 0) {
          p.hp = 0;
          phaseRef.current = 'dead';
          deathVibrate();
          setPhase('dead');
          addMsg(`💀 Slain by ${e.emoji} on floor ${p.floor}!`);
          setTick(t => t + 1);
          return;
        }
        continue;
      }
      // Pathfind: try best direction toward player first
      const steps = [
        { x: e.x + Math.sign(dx), y: e.y },
        { x: e.x,                 y: e.y + Math.sign(dy) },
        { x: e.x - Math.sign(dx), y: e.y },
        { x: e.x,                 y: e.y - Math.sign(dy) },
      ];
      for (const s of steps) {
        if (
          s.y >= 0 && s.y < VC_ROWS && s.x >= 0 && s.x < VC_COLS &&
          m[s.y][s.x] === VC_FLOOR &&
          !(s.x === p.x && s.y === p.y) &&
          !enemiesRef.current.some(o => o !== e && o.x === s.x && o.y === s.y)
        ) { e.x = s.x; e.y = s.y; break; }
      }
    }
    setTick(t => t + 1);
  };

  // ── Player action ────────────────────────────────────────
  const movePlayer = (dx, dy) => {
    if (phaseRef.current !== 'playing') return;
    const p = playerRef.current;
    const m = mapRef.current;
    const nx = p.x + dx, ny = p.y + dy;
    if (ny < 0 || ny >= VC_ROWS || nx < 0 || nx >= VC_COLS) return;
    if (m[ny][nx] === VC_WALL) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); return; }

    // Attack enemy
    const ei = enemiesRef.current.findIndex(e => e.x === nx && e.y === ny);
    if (ei !== -1) {
      const e = enemiesRef.current[ei];
      const dmg = Math.max(1, p.atk - e.def);
      e.hp -= dmg;
      popVibrate();
      if (e.hp <= 0) {
        p.xp += e.xp;
        addMsg(`⚔️ Slew ${e.emoji}! +${e.xp} XP${e.isBoss ? '  🏆 BOSS!' : ''}`);
        if (e.isBoss) celebrateVibrate();
        enemiesRef.current.splice(ei, 1);
        checkLevelUp();
      } else {
        addMsg(`🗡️ Hit ${e.emoji} for ${dmg} dmg (${e.hp}/${e.maxHp} HP left)`);
      }
      moveEnemies();
      setTick(t => t + 1);
      return;
    }

    // Move
    p.x = nx; p.y = ny;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Pick up item
    const ii = itemsRef.current.findIndex(it => it.x === nx && it.y === ny);
    if (ii !== -1) {
      const item = itemsRef.current[ii];
      if (item.type === 'atk')   p.atk    += item.value;
      if (item.type === 'def')   p.def    += item.value;
      if (item.type === 'heal')  p.hp      = Math.min(p.hp + item.value, p.maxHp);
      if (item.type === 'maxhp') { p.maxHp += item.value; p.hp = Math.min(p.hp + item.value, p.maxHp); }
      if (item.type === 'xp')    { p.xp    += item.value; checkLevelUp(); }
      addMsg(`${item.emoji} Picked up: ${item.label}`);
      scoreVibrate();
      itemsRef.current.splice(ii, 1);
    }

    // Stairs
    const s = stairsRef.current;
    if (nx === s.x && ny === s.y) {
      if (p.floor >= 5) {
        phaseRef.current = 'won';
        celebrateVibrate();
        addMsg('🏆 YOU ESCAPED THE VOID! All 5 floors cleared!');
        setPhase('won');
        setTick(t => t + 1);
        return;
      }
      p.floor += 1;
      addMsg(`🚪 Descending to Floor ${p.floor}... ${VC_FLOOR_THEMES[p.floor - 1].name}`);
      celebrateVibrate();
      generateFloor(p.floor);
      setTick(t => t + 1);
      return;
    }

    moveEnemies();
    setTick(t => t + 1);
  };

  const startGame = () => {
    playerRef.current = { x:1, y:1, hp:20, maxHp:20, atk:3, def:1, floor:1, xp:0, level:1 };
    eidRef.current = 0; iidRef.current = 0;
    phaseRef.current = 'playing';
    generateFloor(1);
    setMsgLog(['🏺 Floor 1: DUNGEON DEPTHS', '⚔️ Touch D-Pad to move. Step on enemies to attack!']);
    setPhase('playing');
    setTick(t => t + 1);
  };

  // ── Render ───────────────────────────────────────────────
  const p   = playerRef.current;
  const floorIdx = Math.min((p.floor ?? 1) - 1, 4);
  const theme = VC_FLOOR_THEMES[floorIdx];
  const hpPct = Math.max(0, p.hp / p.maxHp);
  const hpColor = hpPct > 0.5 ? '#44ff88' : hpPct > 0.25 ? '#ffaa00' : '#ff3344';

  const renderGrid = () => {
    if (!mapRef.current.length) return null;
    const m = mapRef.current;
    const cells = [];
    const stairs = stairsRef.current;
    for (let row = 0; row < VC_ROWS; row++) {
      for (let col = 0; col < VC_COLS; col++) {
        const isWall   = m[row][col] === VC_WALL;
        const isStairs = stairs.x === col && stairs.y === row;
        const enemy    = enemiesRef.current.find(e => e.x === col && e.y === row);
        const item     = itemsRef.current.find(it => it.x === col && it.y === row);
        const isPlayer = p.x === col && p.y === row;

        const bgCell = isWall
          ? theme.wall
          : (row + col) % 2 === 0 ? theme.floor : theme.floor + 'dd';

        const fs = VC_CELL - 5;
        let content = null;
        if      (isPlayer) content = <Text style={{ fontSize: fs, lineHeight: VC_CELL }}>😤</Text>;
        else if (enemy)    content = <Text style={{ fontSize: fs - 2, lineHeight: VC_CELL }}>{enemy.emoji}</Text>;
        else if (isStairs) content = <Text style={{ fontSize: fs - 2, lineHeight: VC_CELL }}>🚪</Text>;
        else if (item)     content = <Text style={{ fontSize: fs - 3, lineHeight: VC_CELL }}>{item.emoji}</Text>;

        cells.push(
          <View key={`${row}-${col}`} style={{
            position: 'absolute', left: col * VC_CELL, top: row * VC_CELL,
            width: VC_CELL, height: VC_CELL,
            backgroundColor: bgCell,
            borderWidth: isWall ? 0 : 0.5,
            borderColor: 'rgba(255,255,255,0.05)',
            justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
          }}>
            {content}
          </View>
        );
      }
    }
    return cells;
  };

  const dpadBtn = (label, onPress) => (
    <View onTouchStart={onPress} style={{
      width: 75, height: 75,
      backgroundColor: 'rgba(255,255,255,0.10)',
      borderRadius: 14,
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 1, borderColor: theme.accent + '60',
    }}>
      <Text style={{ color: '#fff', fontSize: 24, fontWeight: 'bold' }}>{label}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* HUD */}
      <View style={[styles.header, { backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 10 }]}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.title, { color: theme.accent, fontSize: 20 }]}>☠️ VOID CRAWLER</Text>
          <Text style={{ color: '#888', fontSize: 11 }}>{theme.name}  •  Floor {p.floor}/5</Text>
        </View>
        <Text style={{ color: '#ccc', fontSize: 13, fontWeight: 'bold' }}>Lv.{p.level} ⚔️{p.atk} 🛡️{p.def}</Text>
      </View>

      {/* HP + XP bars */}
      {phase === 'playing' && (
        <View style={{ paddingHorizontal: 14, paddingVertical: 5, backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <Text style={{ color: hpColor, fontSize: 12, fontWeight: 'bold', width: 80 }}>❤️ {p.hp}/{p.maxHp}</Text>
            <View style={{ flex: 1, height: 7, backgroundColor: '#111', borderRadius: 4, overflow: 'hidden' }}>
              <View style={{ width: `${hpPct * 100}%`, height: '100%', backgroundColor: hpColor, borderRadius: 4 }} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: '#ffcc44', fontSize: 11, width: 80 }}>✨ {p.xp}/{xpNeeded(p.level)} XP</Text>
            <View style={{ flex: 1, height: 5, backgroundColor: '#111', borderRadius: 4, overflow: 'hidden' }}>
              <View style={{ width: `${Math.min((p.xp / xpNeeded(p.level)) * 100, 100)}%`, height: '100%', backgroundColor: '#ffcc44', borderRadius: 4 }} />
            </View>
          </View>
        </View>
      )}

      {/* Grid */}
      <View style={{
        width: VC_COLS * VC_CELL, height: VC_ROWS * VC_CELL,
        alignSelf: 'center', position: 'relative', marginTop: 4,
        borderWidth: 2, borderColor: theme.accent + '44', borderRadius: 4,
        overflow: 'hidden',
      }}>
        {renderGrid()}
      </View>

      {/* Message log */}
      {phase === 'playing' && (
        <View style={{ paddingHorizontal: 14, paddingVertical: 4, minHeight: 38, backgroundColor: 'rgba(0,0,0,0.4)' }}>
          {msgLog.slice(0, 2).map((msg, i) => (
            <Text key={i} style={{ color: i === 0 ? '#ddd' : '#555', fontSize: 12 }}>{msg}</Text>
          ))}
        </View>
      )}

      {/* D-Pad */}
      {phase === 'playing' && (
        <View style={{ alignItems: 'center', paddingTop: 6, paddingBottom: 6 }}>
          <View style={{ marginBottom: 4 }}>
            {dpadBtn('▲', () => movePlayer(0, -1))}
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {dpadBtn('◄', () => movePlayer(-1, 0))}
            {dpadBtn('▼', () => movePlayer(0, 1))}
            {dpadBtn('►', () => movePlayer(1, 0))}
          </View>
        </View>
      )}

      {/* Overlay */}
      {phase !== 'playing' && (
        <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.9)' }]}>
          <Text style={[styles.overlayTitle, { color: theme.accent, textAlign: 'center' }]}>
            {phase === 'idle' ? '☠️ VOID CRAWLER' : phase === 'won' ? '🏆 VOID ESCAPED!' : '💀 YOU DIED'}
          </Text>
          <Text style={[styles.overlaySub, { textAlign: 'center', lineHeight: 22, marginBottom: 6 }]}>
            {phase === 'idle'
              ? '5 floors of procedural darkness.\nFight 💀👺👹😈🐉  Loot ⚔️🛡️❤️  Level up ⬆️  Escape 🚪'
              : phase === 'won'
              ? `Lv.${p.level} ⚔️${p.atk} 🛡️${p.def} — ${p.hp}/${p.maxHp} HP remaining\n${msgLog[0] ?? ''}`
              : `${msgLog[0] ?? ''}\nFloor ${p.floor} — Lv.${p.level} ⚔️${p.atk} 🛡️${p.def}`}
          </Text>
          <Text style={{ color: '#444', fontSize: 12, textAlign: 'center', marginBottom: 20 }}>
            {phase === 'idle' ? '😤 Hero  🚪 Stairs down  💀👺👹😈🐉 Enemies  ⚔️🛡️❤️💊💎 Items' : ''}
          </Text>
          <Pressable style={[styles.btn, { backgroundColor: theme.accent }]} onPress={startGame}>
            <Text style={[styles.btnText, { color: '#000' }]}>
              {phase === 'idle' ? 'ENTER THE VOID' : 'DESCEND AGAIN'}
            </Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// ==========================================
// 9. NEON TUNNEL — Tunnel Runner
// ==========================================
const NT_LANES = 8;

function NeonTunnel({ onExit }) {
  const [phase, setPhase] = useState('idle');
  const [, setTick] = useState(0);

  const phaseRef  = useRef('idle');
  const scoreRef  = useRef(0);
  const bestRef   = useRef(0);
  const laneRef   = useRef(0);
  const ringsRef  = useRef([]);
  const ringIdRef = useRef(0);
  const speedRef  = useRef(2);
  const frameRef  = useRef(0);

  const CX = width / 2;
  const CY = GAME_HEIGHT * 0.5;
  const MAX_R = Math.min(width, GAME_HEIGHT) * 0.42;
  const PLAYER_R = MAX_R * 0.88;
  const SPAWN_GAP = MAX_R * 0.3;

  useEffect(() => {
    AsyncStorage.getItem('ntBest').then(v => {
      if (v) { bestRef.current = +v; setTick(t => t + 1); }
    }).catch(() => {});
  }, []);

  const spawnRing = () => {
    const nFree = 3;
    const freeStart = Math.floor(Math.random() * NT_LANES);
    const free = new Set(Array.from({ length: nFree }, (_, i) => (freeStart + i) % NT_LANES));
    ringsRef.current.push({ id: ringIdRef.current++, r: 0, free, hue: (ringIdRef.current * 43) % 360, checked: false });
  };

  const startGame = () => {
    ringsRef.current = [];
    frameRef.current = 0;
    scoreRef.current = 0;
    speedRef.current = 2;
    laneRef.current = 0;
    ringIdRef.current = 0;
    phaseRef.current = 'running';
    setPhase('running');
    spawnRing();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };

  const shiftLane = (dir) => {
    if (phaseRef.current !== 'running') return;
    laneRef.current = (laneRef.current + dir + NT_LANES) % NT_LANES;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  useEffect(() => {
    if (phase !== 'running') return;
    const loop = setInterval(() => {
      if (phaseRef.current !== 'running') return;
      frameRef.current++;
      speedRef.current = Math.min(4.5, 2 + frameRef.current * 0.001);
      scoreRef.current = Math.floor(frameRef.current * 0.6);

      for (const ring of ringsRef.current) ring.r += speedRef.current;

      const last = ringsRef.current[ringsRef.current.length - 1];
      if (!last || last.r > SPAWN_GAP) spawnRing();

      for (let i = ringsRef.current.length - 1; i >= 0; i--) {
        const ring = ringsRef.current[i];
        if (!ring.checked && ring.r >= PLAYER_R - 5 && ring.r <= PLAYER_R + 5) {
          ring.checked = true;
          if (!ring.free.has(laneRef.current)) {
            phaseRef.current = 'dead';
            setPhase('dead');
            deathVibrate();
            if (scoreRef.current > bestRef.current) {
              bestRef.current = scoreRef.current;
              AsyncStorage.setItem('ntBest', String(scoreRef.current)).catch(() => {});
            }
            return;
          } else {
            popVibrate();
          }
        }
        if (ring.r > MAX_R + 30) ringsRef.current.splice(i, 1);
      }
      setTick(t => t + 1);
    }, 16);
    return () => clearInterval(loop);
  }, [phase]);

  const getLanePos = (lane, r) => {
    const angle = (lane / NT_LANES) * Math.PI * 2 - Math.PI / 2;
    return { x: CX + Math.cos(angle) * r, y: CY + Math.sin(angle) * r };
  };

  const playerPos = getLanePos(laneRef.current, PLAYER_R);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#000010' }]}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={[styles.title, { color: '#00ffcc', fontSize: 18 }]}>🌀 NEON TUNNEL</Text>
        <Text style={{ color: '#ffd700', fontSize: 14, fontWeight: 'bold' }}>⭐ {bestRef.current}</Text>
      </View>

      <View style={{ flex: 1, backgroundColor: '#000010', position: 'relative', overflow: 'hidden' }}>
        {phase === 'running' && (
          <Text style={{ position: 'absolute', top: 8, left: 0, right: 0, textAlign: 'center', color: '#00ffcc', fontSize: 24, fontWeight: 'bold', zIndex: 10 }}>
            {scoreRef.current}
          </Text>
        )}

        {/* Tunnel rings */}
        {ringsRef.current.map(ring => {
          const sz = ring.r * 2;
          const col = `hsl(${ring.hue}, 100%, 55%)`;
          const op = Math.max(0.08, 0.9 - (ring.r / MAX_R) * 0.75);
          return (
            <View key={ring.id} style={{
              position: 'absolute', left: CX - ring.r, top: CY - ring.r,
              width: sz, height: sz, borderRadius: ring.r,
              borderWidth: 1.5, borderColor: col, opacity: op,
            }} />
          );
        })}

        {/* Obstacle blocks */}
        {ringsRef.current.flatMap(ring => {
          const danger = ring.r > PLAYER_R * 0.7;
          return Array.from({ length: NT_LANES }, (_, lane) => {
            if (ring.free.has(lane)) return null;
            const pos = getLanePos(lane, ring.r);
            return (
              <View key={`${ring.id}-${lane}`} style={{
                position: 'absolute', left: pos.x - 10, top: pos.y - 10,
                width: 20, height: 20, borderRadius: 5,
                backgroundColor: danger ? '#ff0044' : `hsl(${ring.hue}, 100%, 60%)`,
                opacity: Math.max(0.2, 1 - ring.r / MAX_R * 0.5),
              }} />
            );
          }).filter(Boolean);
        })}

        {/* Lane guide dots */}
        {Array.from({ length: NT_LANES }, (_, lane) => {
          const pos = getLanePos(lane, PLAYER_R + 22);
          return (
            <View key={lane} style={{
              position: 'absolute', left: pos.x - 4, top: pos.y - 4,
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: lane === laneRef.current ? '#00ffcc' : 'transparent',
              borderWidth: 1, borderColor: '#00ffcc55',
            }} />
          );
        })}

        {/* Player */}
        <View style={{
          position: 'absolute', left: playerPos.x - 13, top: playerPos.y - 13,
          width: 26, height: 26, borderRadius: 13,
          backgroundColor: '#00ffcc', borderWidth: 2, borderColor: '#fff',
          elevation: 10,
        }} />

        {/* Overlay */}
        {phase !== 'running' && (
          <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,16,0.88)' }]}>
            <Text style={[styles.overlayTitle, { color: '#00ffcc' }]}>
              {phase === 'dead' ? '💥 CRASH!' : '🌀 NEON TUNNEL'}
            </Text>
            <Text style={[styles.overlaySub, { textAlign: 'center' }]}>
              {phase === 'dead'
                ? `Score: ${scoreRef.current}\n🏆 Mejor: ${bestRef.current}\n\n◀ ▶ para cambiar de carril`
                : 'Vuela por el túnel neon\nEsquiva los bloques rojos\n3 carriles libres por anillo\n◀ ▶ para moverte'}
            </Text>
            <Pressable style={[styles.btn, { backgroundColor: '#00ffcc', marginTop: 12 }]} onPress={startGame}>
              <Text style={[styles.btnText, { color: '#000' }]}>{phase === 'dead' ? 'REINTENTAR' : '🚀 VOLAR'}</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Controls */}
      <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,16,0.8)', paddingVertical: 14, paddingHorizontal: 20, gap: 16 }}>
        <Pressable onPress={() => shiftLane(-1)}
          style={{ flex: 1, height: 72, backgroundColor: '#00ffcc18', borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#00ffcc44' }}>
          <Text style={{ color: '#00ffcc', fontSize: 32, fontWeight: 'bold' }}>◀</Text>
        </Pressable>
        <View style={{ alignItems: 'center', justifyContent: 'center', width: 80 }}>
          <Text style={{ color: '#00ffcc66', fontSize: 11 }}>CARRIL</Text>
          <Text style={{ color: '#00ffcc', fontSize: 16, fontWeight: 'bold' }}>{laneRef.current + 1}/{NT_LANES}</Text>
        </View>
        <Pressable onPress={() => shiftLane(1)}
          style={{ flex: 1, height: 72, backgroundColor: '#00ffcc18', borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#00ffcc44' }}>
          <Text style={{ color: '#00ffcc', fontSize: 32, fontWeight: 'bold' }}>▶</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );

}

// ==========================================
// 10. MONSTER DUEL  (Pokémon-style battles!)
// ==========================================
// ==========================================
const MD_MONSTERS = [
  { id:0,  name:'FLAMECAT',   emoji:'🐱', type:'fire',     hp:45, atk:15, def:8,  moves:['Arañazo','Brasa','Rugido','Placaje'],        evo:1,  evoLvl:16 },
  { id:1,  name:'BLAZELION',  emoji:'🦁', type:'fire',     hp:70, atk:25, def:14, moves:['Tajo','Lanzallamas','Rugido','Erupción'],     evo:-1, evoLvl:0 },
  { id:2,  name:'AQUAPUP',    emoji:'🐶', type:'water',    hp:44, atk:13, def:10, moves:['Placaje','Pistola Agua','Gruñido','Mordisco'], evo:3,  evoLvl:16 },
  { id:3,  name:'TIDEWOLF',   emoji:'🐺', type:'water',    hp:68, atk:22, def:17, moves:['Mordisco','Surf','Aullido','Triturar'],        evo:-1, evoLvl:0 },
  { id:4,  name:'SPROUTLING', emoji:'🌱', type:'grass',    hp:45, atk:11, def:12, moves:['Placaje','Látigo Cepa','Gruñido','Polvo Somnífero'], evo:5, evoLvl:16 },
  { id:5,  name:'THORNWOOD',  emoji:'🌲', type:'grass',    hp:65, atk:18, def:20, moves:['Hoja Aguda','Rayo Solar','Espora','Síntesis'], evo:-1, evoLvl:0 },
  { id:6,  name:'ZAPPYMOLE',  emoji:'🐹', type:'electric', hp:38, atk:20, def:6, moves:['Placaje','Impactueno','Agilidad','Trueno'],    evo:7,  evoLvl:18 },
  { id:7,  name:'VOLTFANG',   emoji:'🦔', type:'electric', hp:58, atk:32, def:10, moves:['Onda Trueno','Giga Impacto','Rapidez','Voltio Cruel'], evo:-1, evoLvl:0 },
  { id:8,  name:'FROSTBEAR',  emoji:'🐻', type:'ice',      hp:60, atk:20, def:18, moves:['Placaje','Rayo Hielo','Gruñido','Ventisca'],  evo:-1, evoLvl:0 },
  { id:9,  name:'SHADOWFOX',  emoji:'🦊', type:'dark',     hp:42, atk:22, def:8,  moves:['Arañazo','Ja de Trampa','Arena','Pulso Umbrio'], evo:-1, evoLvl:0 },
  { id:10, name:'AEROBIRD',   emoji:'🐦', type:'flying',   hp:38, atk:17, def:8,  moves:['Picoteo','Ventisca','Remolino','Ala de Acero'], evo:11, evoLvl:20 },
  { id:11, name:'STORMROC',   emoji:'🦅', type:'flying',   hp:60, atk:28, def:13, moves:['As Aéreo','Huracán','Ave Audaz','Ataque Cielo'], evo:-1, evoLvl:0 },
  { id:12, name:'INKOCTUS',   emoji:'🐙', type:'water',    hp:40, atk:16, def:11, moves:['Placaje','Tinta','Constricción','Hidrobomba'], evo:-1, evoLvl:0 },
  { id:13, name:'BLAZESTEED', emoji:'🐴', type:'fire',     hp:60, atk:24, def:12, moves:['Pisotón','Llamarada','Agilidad','Carga Llamas'], evo:-1, evoLvl:0 },
  { id:14, name:'STONEGUARD', emoji:'🦏', type:'rock',     hp:70, atk:16, def:25, moves:['Placaje','Lanzarrocas','Endurecer','Avalancha'], evo:-1, evoLvl:0 },
];
const MD_MULT = {
  fire:{ grass:2, ice:2, water:0.5, rock:0.5, fire:0.5 },
  water:{ fire:2, rock:2, grass:0.5, water:0.5 },
  grass:{ water:2, rock:2, fire:0.5, grass:0.5, flying:0.5 },
  electric:{ water:2, flying:2, grass:0.5, electric:0.5 },
  rock:{ fire:2, flying:2, water:0.5, grass:0.5 },
  ice:{ grass:2, flying:2, water:0.5, ice:0.5 },
  dark:{}, flying:{ grass:2, electric:0.5, rock:0.5 },
};
const MD_TC = { fire:'#ff4500',water:'#1e90ff',grass:'#3cb371',electric:'#ffd700',rock:'#a0522d',ice:'#00ced1',dark:'#7b2d9b',flying:'#87ceeb' };

function MonsterDuel({ onExit }) {
  const [phase, setPhase]       = useState('starter');
  const [team, setTeam]         = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [wild, setWild]         = useState(null);
  const [wildHp, setWildHp]     = useState(0);
  const [turn, setTurn]         = useState('player');
  const [log, setLog]           = useState(['¡Bienvenido al mundo de los Monstruos!']);
  const [badges, setBadges]     = useState(0);
  const [caughtIds, setCaughtIds] = useState([]);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const teamRef   = useRef([]);
  const wildRef   = useRef(null);
  const wildHpRef = useRef(0);

  const addLog = (m) => setLog(l => [m, ...l.slice(0,4)]);
  const mkMon  = (id, lvl) => {
    const b = MD_MONSTERS[id], sc = 1 + (lvl - 5) * 0.1;
    return { ...b, level:lvl, maxHp:Math.floor(b.hp*sc), currentHp:Math.floor(b.hp*sc), xp:0, xpNeeded:lvl*20 };
  };
  const calcDmg = (a, d) => {
    const mult = MD_MULT[a.type]?.[d.type] ?? 1;
    return Math.max(1, Math.floor((a.atk * 1.4 - d.def * 0.5) * mult + Math.random() * 4));
  };
  const shake = () => Animated.sequence([
    Animated.timing(shakeAnim,{toValue:10,duration:60,useNativeDriver:true}),
    Animated.timing(shakeAnim,{toValue:-10,duration:60,useNativeDriver:true}),
    Animated.timing(shakeAnim,{toValue:5,duration:60,useNativeDriver:true}),
    Animated.timing(shakeAnim,{toValue:0,duration:60,useNativeDriver:true}),
  ]).start();

  const chooseStarter = (id) => {
    const m = mkMon(id, 5);
    setTeam([m]); teamRef.current = [m];
    setActiveIdx(0); setPhase('explore');
    addLog(`¡${m.name} quiere ser tu compañero!`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  const explore = () => {
    if (Math.random() < 0.45) {
      const wId  = Math.floor(Math.random() * MD_MONSTERS.length);
      const wLvl = Math.max(3, (teamRef.current[0]?.level ?? 5) + Math.floor(Math.random()*5) - 2);
      const wm   = mkMon(wId, wLvl);
      setWild(wm); wildRef.current = wm;
      setWildHp(wm.maxHp); wildHpRef.current = wm.maxHp;
      setTurn('player'); setPhase('battle');
      addLog(`¡Un ${wm.name} salvaje apareció!`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else { addLog('No hay encuentros… sigue explorando.'); }
  };
  const gainXp = (amount) => setTeam(prev => {
    return prev.map((m, i) => {
      if (i !== activeIdx) return m;
      let nm = { ...m, xp: m.xp + amount };
      while (nm.xp >= nm.xpNeeded) {
        nm.xp -= nm.xpNeeded; nm.level++;
        nm.xpNeeded = nm.level * 20;
        nm.maxHp = Math.floor(nm.hp * (1 + (nm.level-5)*0.1));
        nm.currentHp = Math.min(nm.currentHp + 8, nm.maxHp);
        nm.atk = (nm.atk||0) + 1; nm.def = (nm.def||0) + 1;
        addLog(`¡${nm.name} subió al nivel ${nm.level}! ⬆️`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (nm.evo !== -1 && nm.level >= nm.evoLvl) {
          const ed = MD_MONSTERS[nm.evo];
          nm = { ...nm, ...ed, level:nm.level, xp:nm.xp, xpNeeded:nm.xpNeeded,
            maxHp:Math.floor(ed.hp*(1+(nm.level-5)*0.1)), currentHp:Math.floor(ed.hp*(1+(nm.level-5)*0.1)) };
          addLog(`✨ ¡${m.name} evolucionó a ${nm.name}!`);
        }
      }
      teamRef.current[i] = nm; return nm;
    });
  });
  const playerAttack = (mi) => {
    if (turn !== 'player') return;
    const p = teamRef.current[activeIdx]; const w = wildRef.current; if (!p||!w) return;
    const dmg = calcDmg(p, w);
    const mult = MD_MULT[p.type]?.[w.type] ?? 1;
    const eff  = mult > 1 ? ' ¡Muy eficaz!' : mult < 1 ? ' No muy eficaz.' : '';
    const nhp  = Math.max(0, wildHpRef.current - dmg);
    wildHpRef.current = nhp; setWildHp(nhp);
    addLog(`${p.name} usa ${p.moves[mi]}! -${dmg}💥${eff}`);
    shake(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (nhp <= 0) { const xp = w.level*15; addLog(`¡${w.name} vencido! +${xp}XP`); setBadges(b=>b+1); gainXp(xp); setTimeout(()=>setPhase('explore'),1200); return; }
    setTurn('enemy'); setTimeout(enemyTurn, 900);
  };
  const enemyTurn = () => {
    const w = wildRef.current; const p = teamRef.current[activeIdx]; if (!w||!p) return;
    const dmg  = calcDmg(w, p);
    const nhp  = Math.max(0, p.currentHp - dmg);
    addLog(`${w.name} ataca! -${dmg} a ${p.name}`);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTeam(prev => { const n = prev.map((m,i)=>{if(i!==activeIdx)return m; const nm={...m,currentHp:nhp}; teamRef.current[i]=nm; return nm;}); return n; });
    if (nhp <= 0) {
      addLog(`¡${p.name} se desmayó!`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const alive = teamRef.current.filter((m,i)=>i!==activeIdx&&m.currentHp>0);
      setTimeout(()=>{ if(!alive.length)setPhase('gameover'); else setPhase('explore'); }, 800);
      return;
    }
    setTurn('player');
  };
  const tryCatch = () => {
    if (turn !== 'player') return;
    const w = wildRef.current;
    const rate = Math.max(0.05, (1 - wildHpRef.current/w.maxHp)*0.75 + 0.1);
    addLog('🔴 ¡Lanzando Monstruball!'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(()=>{
      if (Math.random() < rate) {
        addLog(`¡${w.name} capturado! 🎉`);
        setCaughtIds(c=>[...c,w.id]);
        if (teamRef.current.length < 3) { const nm={...w,currentHp:Math.floor(w.maxHp*0.5)}; setTeam(prev=>{const n=[...prev,nm];teamRef.current=n;return n;}); }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(()=>setPhase('explore'), 900);
      } else { addLog(`¡${w.name} escapó!`); setTurn('enemy'); setTimeout(enemyTurn,600); }
    },700);
  };
  const hpc = (hp,max) => hp>max*0.5?'#22c55e':hp>max*0.2?'#f59e0b':'#ef4444';
  const Bar = ({hp,max}) => (
    <View style={{height:7,backgroundColor:'#222',borderRadius:4,overflow:'hidden',marginTop:4}}>
      <View style={{width:`${Math.max(0,hp/max*100)}%`,height:'100%',backgroundColor:hpc(hp,max),borderRadius:4}}/>
    </View>
  );

  if (phase==='starter') return (
    <SafeAreaView style={[styles.container,{backgroundColor:'#0f1729'}]}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={[styles.title,{color:'#ffd700',fontSize:18}]}>⚡ MONSTER DUEL</Text>
      </View>
      <ScrollView contentContainerStyle={{padding:20,alignItems:'center'}}>
        <Text style={{color:'#fff',fontSize:22,fontWeight:'bold',marginBottom:6,textAlign:'center'}}>🌍 ¡Elige tu Starter!</Text>
        <Text style={{color:'#aaa',fontSize:14,marginBottom:24,textAlign:'center'}}>Tu primer monstruo compañero de aventura</Text>
        {[MD_MONSTERS[0],MD_MONSTERS[2],MD_MONSTERS[4]].map(m=>(
          <Pressable key={m.id} onPress={()=>chooseStarter(m.id)} style={{
            width:'92%',padding:18,borderRadius:16,marginBottom:16,
            backgroundColor:MD_TC[m.type]+'22',borderWidth:2,borderColor:MD_TC[m.type],
            flexDirection:'row',alignItems:'center',gap:14,
          }}>
            <Text style={{fontSize:54}}>{m.emoji}</Text>
            <View style={{flex:1}}>
              <Text style={{color:'#fff',fontSize:18,fontWeight:'bold'}}>{m.name}</Text>
              <Text style={{color:MD_TC[m.type],fontSize:12,fontWeight:'bold',marginBottom:4}}>{m.type.toUpperCase()}</Text>
              <Text style={{color:'#888',fontSize:11}}>HP:{m.hp}  ATK:{m.atk}  DEF:{m.def}</Text>
              <Text style={{color:'#555',fontSize:10,marginTop:2}}>{m.moves.join(' · ')}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );

  const p = team[activeIdx];
  return (
    <SafeAreaView style={[styles.container,{backgroundColor:phase==='battle'?'#0d1b2a':'#0d1f0d'}]}>
      <View style={[styles.header,{backgroundColor:'rgba(0,0,0,0.6)'}]}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={[styles.title,{color:'#ffd700',fontSize:18}]}>⚡ MONSTER DUEL</Text>
        <Text style={{color:'#ffd700',fontSize:12}}>🏅{badges}  👾{caughtIds.length}</Text>
      </View>
      {phase==='battle' && wild && (
        <View style={{padding:14,flex:1}}>
          <View style={{backgroundColor:'rgba(255,255,255,0.06)',borderRadius:14,padding:12,marginBottom:10}}>
            <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
              <View style={{flex:1}}>
                <Text style={{color:'#fff',fontSize:14,fontWeight:'bold'}}>{wild.name} <Text style={{color:MD_TC[wild.type],fontSize:12}}>[{wild.type}]</Text></Text>
                <Text style={{color:'#aaa',fontSize:11}}>Lv.{wild.level}  {wildHp}/{wild.maxHp} HP</Text>
                <Bar hp={wildHp} max={wild.maxHp}/>
              </View>
              <Animated.Text style={{fontSize:60,transform:[{translateX:shakeAnim}]}}>{wild.emoji}</Animated.Text>
            </View>
          </View>
          {p && (
            <View style={{backgroundColor:'rgba(255,255,255,0.06)',borderRadius:14,padding:12,marginBottom:14}}>
              <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
                <Text style={{fontSize:52}}>{p.emoji}</Text>
                <View style={{alignItems:'flex-end',flex:1,marginLeft:12}}>
                  <Text style={{color:'#fff',fontSize:14,fontWeight:'bold'}}>{p.name} <Text style={{color:'#aaa',fontSize:11}}>Lv.{p.level}</Text></Text>
                  <Text style={{color:'#aaa',fontSize:11}}>{p.currentHp}/{p.maxHp} HP</Text>
                  <Bar hp={p.currentHp} max={p.maxHp}/>
                  <Text style={{color:'#444',fontSize:10,marginTop:2}}>XP {p.xp}/{p.xpNeeded}</Text>
                </View>
              </View>
            </View>
          )}
          {turn==='player' && p && (
            <View>
              <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:10}}>
                {p.moves.map((mv,i)=>(
                  <Pressable key={i} onPress={()=>playerAttack(i)} style={{
                    width:'47%',padding:11,borderRadius:10,alignItems:'center',
                    backgroundColor:MD_TC[p.type]+'33',borderWidth:1,borderColor:MD_TC[p.type],
                  }}>
                    <Text style={{color:'#fff',fontSize:13,fontWeight:'bold'}}>{mv}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={{flexDirection:'row',gap:8}}>
                <Pressable onPress={tryCatch} style={{flex:1,padding:11,borderRadius:10,backgroundColor:'#991b1b',alignItems:'center'}}>
                  <Text style={{color:'#fff',fontWeight:'bold'}}>🔴 ATRAPAR</Text>
                </Pressable>
                <Pressable onPress={()=>{addLog('¡Escapaste!');setPhase('explore');}} style={{flex:1,padding:11,borderRadius:10,backgroundColor:'#374151',alignItems:'center'}}>
                  <Text style={{color:'#fff',fontWeight:'bold'}}>🏃 HUIR</Text>
                </Pressable>
              </View>
            </View>
          )}
          {turn==='enemy' && <Text style={{color:'#f59e0b',textAlign:'center',fontSize:15,marginTop:10}}>⚡ Turno enemigo...</Text>}
        </View>
      )}
      {phase==='explore' && (
        <View style={{flex:1,padding:16}}>
          <Text style={{color:'#ffd700',fontWeight:'bold',fontSize:14,marginBottom:12}}>👥 TU EQUIPO ({team.length}/3)</Text>
          {team.map((m,i)=>(
            <Pressable key={i} onPress={()=>setActiveIdx(i)} style={{
              flexDirection:'row',alignItems:'center',padding:12,borderRadius:12,marginBottom:8,
              backgroundColor:i===activeIdx?MD_TC[m.type]+'22':'rgba(255,255,255,0.04)',
              borderWidth:i===activeIdx?2:1,borderColor:i===activeIdx?MD_TC[m.type]:'#2a2a2a',
            }}>
              <Text style={{fontSize:36,marginRight:12}}>{m.emoji}</Text>
              <View style={{flex:1}}>
                <Text style={{color:'#fff',fontWeight:'bold'}}>{m.name} <Text style={{color:'#666',fontSize:11}}>Lv.{m.level}</Text></Text>
                <Bar hp={m.currentHp} max={m.maxHp}/>
              </View>
              <Text style={{color:'#666',fontSize:11}}>{m.currentHp}/{m.maxHp}</Text>
            </Pressable>
          ))}
          <Pressable onPress={explore} style={{marginTop:18,backgroundColor:'#15803d',padding:18,borderRadius:14,alignItems:'center'}}>
            <Text style={{color:'#fff',fontSize:18,fontWeight:'bold'}}>🌿 EXPLORAR HIERBA</Text>
          </Pressable>
          <Text style={{color:'#444',fontSize:11,textAlign:'center',marginTop:8}}>Capturados: {caughtIds.length}/{MD_MONSTERS.length}  •  Victorias: {badges}</Text>
        </View>
      )}
      <View style={{backgroundColor:'rgba(0,0,0,0.55)',padding:10,minHeight:55,paddingHorizontal:14}}>
        {log.slice(0,3).map((msg,i)=>(
          <Text key={i} style={{color:i===0?'#e2e8f0':'#444',fontSize:12}}>{msg}</Text>
        ))}
      </View>
      {phase==='gameover' && (
        <View style={styles.overlay}>
          <Text style={[styles.overlayTitle,{color:'#ef4444'}]}>💀 TODOS CAÍDOS</Text>
          <Text style={styles.overlaySub}>Tus monstruos se desmayaron</Text>
          <Text style={{color:'#ffd700',fontSize:15,marginBottom:20}}>🏅{badges} victorias  •  👾{caughtIds.length} capturados</Text>
          <Pressable style={[styles.btn,{backgroundColor:'#ffd700'}]} onPress={()=>{
            setPhase('starter');setTeam([]);teamRef.current=[];setBadges(0);setCaughtIds([]);setLog(['¡Nueva aventura!']);
          }}>
            <Text style={styles.btnText}>NUEVA AVENTURA</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// ==========================================
// 10. GRAVITY FLIP — Corredor de gravedad
// ==========================================
const GF_SPD    = 5;
const GF_GRAV   = 0.55;
const GF_WALL   = 38;
const GF_GAP    = 100;
const GF_PW     = 26;
const GF_PH     = 26;

function GravityFlip({ onExit }) {
  const [running, setRunning] = useState(false);
  const [score,   setScore]   = useState(0);
  const [best,    setBest]    = useState(0);
  const [dead,    setDead]    = useState(false);
  const [,        setTick]    = useState(0);

  const pRef      = useRef({ y: GAME_HEIGHT/2 - GF_PH/2, vy:0, grav:1 });
  const pillars   = useRef([]);
  const camRef    = useRef(0);
  const scoreRef  = useRef(0);
  const frameRef  = useRef(0);
  const bestRef   = useRef(0);
  const stars     = useRef(Array.from({length:30},()=>({x:Math.random()*width,y:Math.random()*GAME_HEIGHT,r:Math.random()*1.5+0.5})));

  useEffect(()=>{ AsyncStorage.getItem('gfBest').then(v=>{if(v){bestRef.current=+v;setBest(+v);}}).catch(()=>{}); },[]);

  const flip = () => {
    if (!running) return;
    pRef.current.grav *= -1;
    pRef.current.vy   = pRef.current.grav * -3;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const startGame = () => {
    pRef.current   = { y:GAME_HEIGHT/2-GF_PH/2, vy:0, grav:1 };
    pillars.current = [];
    camRef.current  = 0; scoreRef.current = 0; frameRef.current = 0;
    setScore(0); setDead(false); setRunning(true);
  };

  const die = () => {
    deathVibrate(); setRunning(false); setDead(true);
    if (scoreRef.current > bestRef.current) {
      bestRef.current = scoreRef.current; setBest(scoreRef.current);
      AsyncStorage.setItem('gfBest', String(scoreRef.current)).catch(()=>{});
    }
  };

  useEffect(() => {
    if (!running) return;
    const loop = setInterval(() => {
      const p = pRef.current;
      frameRef.current++;
      const spawnEvery = Math.max(55, 105 - Math.floor(scoreRef.current / 8));
      if (frameRef.current % spawnEvery === 0) {
        const gapY = GF_WALL + 10 + Math.floor(Math.random() * (GAME_HEIGHT - GF_WALL*2 - GF_GAP - 20));
        pillars.current.push({ x: camRef.current + width + 40, gapY, w:26 });
      }
      camRef.current += GF_SPD + Math.min(2.5, scoreRef.current / 40);
      scoreRef.current = Math.floor(camRef.current / 55);
      setScore(scoreRef.current);

      p.vy += GF_GRAV * p.grav;
      p.vy  = Math.max(-13, Math.min(13, p.vy));
      p.y  += p.vy;

      if (p.y < GF_WALL || p.y + GF_PH > GAME_HEIGHT - GF_WALL) { die(); return; }

      const px = width / 3;
      for (const pl of pillars.current) {
        const plx = pl.x - camRef.current;
        if (px + GF_PW > plx && px < plx + pl.w) {
          if (p.y < pl.gapY || p.y + GF_PH > pl.gapY + GF_GAP) { die(); return; }
        }
      }
      pillars.current = pillars.current.filter(pl => pl.x > camRef.current - 60);
      setTick(t => t+1);
    }, 16);
    return () => clearInterval(loop);
  }, [running]);

  return (
    <SafeAreaView style={[styles.container,{backgroundColor:'#06010f'}]}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={[styles.title,{fontSize:20,color:'#a855f7'}]}>🔀 GRAVITY FLIP</Text>
        <Text style={{color:'#ffd700',fontSize:14}}>⭐{best}</Text>
      </View>
      <Pressable onPress={running ? flip : startGame} activeOpacity={1}
        style={[styles.gameArea,{height:GAME_HEIGHT,flex:0,backgroundColor:'#06010f',borderColor:'#a855f7aa',overflow:'hidden',position:'relative'}]}>
        {/* Stars */}
        {stars.current.map((s,i)=>(
          <View key={i} style={{position:'absolute',left:((s.x+(camRef.current*0.2))%width+width)%width,top:s.y,width:s.r*2,height:s.r*2,borderRadius:s.r,backgroundColor:'#fff6'}}/>
        ))}
        {/* Walls */}
        <View style={{position:'absolute',top:0,left:0,right:0,height:GF_WALL,backgroundColor:'#7c3aed',borderBottomWidth:2,borderBottomColor:'#c084fc'}}/>
        <View style={{position:'absolute',bottom:0,left:0,right:0,height:GF_WALL,backgroundColor:'#7c3aed',borderTopWidth:2,borderTopColor:'#c084fc'}}/>
        {/* Pillars */}
        {pillars.current.map((pl,i) => {
          const plx = pl.x - camRef.current;
          return (
            <View key={i}>
              <View style={{position:'absolute',left:plx,top:GF_WALL,width:pl.w,height:pl.gapY-GF_WALL,backgroundColor:'#6d28d9',borderRightWidth:2,borderLeftWidth:2,borderColor:'#c084fc66'}}/>
              <View style={{position:'absolute',left:plx,top:pl.gapY+GF_GAP,width:pl.w,height:GAME_HEIGHT-GF_WALL-(pl.gapY+GF_GAP),backgroundColor:'#6d28d9',borderRightWidth:2,borderLeftWidth:2,borderColor:'#c084fc66'}}/>
            </View>
          );
        })}
        {/* Player */}
        <View style={{
          position:'absolute', left:width/3, top:pRef.current.y,
          width:GF_PW, height:GF_PH, borderRadius:6,
          backgroundColor: pRef.current.grav < 0 ? '#f0abfc' : '#d8b4fe',
          transform:[{rotate: pRef.current.grav < 0 ? '180deg' : '0deg'}],
          shadowColor:'#a855f7', shadowOpacity:1, shadowRadius:10,
        }}/>
        {/* Score */}
        <Text style={{position:'absolute',top:GF_WALL+8,right:12,color:'#fff',fontSize:22,fontWeight:'bold'}}>{score}</Text>
        {/* Overlay */}
        {!running && (
          <View style={styles.overlay}>
            <Text style={[styles.overlayTitle,{color:'#a855f7'}]}>🔀 GRAVITY FLIP</Text>
            <Text style={[styles.overlaySub,{textAlign:'center',lineHeight:22}]}>
              {dead ? `¡Chocaste! Score: ${score}\n🏆 Mejor: ${best}` : 'Toca la pantalla para\ninvertir la gravedad.\nEvita las columnas.'}
            </Text>
            <Pressable style={[styles.btn,{backgroundColor:'#7c3aed',marginTop:10}]} onPress={startGame}>
              <Text style={styles.btnText}>{dead?'OTRA VEZ':'START'}</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
      {running && <Text style={{color:'#a855f766',textAlign:'center',fontSize:12,marginTop:6}}>TAP = voltear gravedad 🔀</Text>}
    </SafeAreaView>
  );
}

// ==========================================
// 11. NEON TETRIS — El clásico con neon
// ==========================================
const NT_COLS = 10;
const NT_ROWS = 20;
const NT_CELL = Math.floor((width - 120) / NT_COLS);
const NT_PIECES = [
  { shape:[[1,1,1,1]],            color:'#00ffff' },
  { shape:[[1,1],[1,1]],          color:'#ffd700' },
  { shape:[[0,1,0],[1,1,1]],      color:'#cc00ff' },
  { shape:[[0,1,1],[1,1,0]],      color:'#00ff66' },
  { shape:[[1,1,0],[0,1,1]],      color:'#ff0044' },
  { shape:[[1,0],[1,0],[1,1]],    color:'#ff8800' },
  { shape:[[0,1],[0,1],[1,1]],    color:'#2266ff' },
];
const ntEmpty = () => Array.from({length:NT_ROWS},()=>Array(NT_COLS).fill(null));
const ntRotate = (shape) => {
  const r = shape.length, c = shape[0].length;
  return Array.from({length:c},(_,ci)=>Array.from({length:r},(_,ri)=>shape[r-1-ri][ci]));
};

function NeonTetris({ onExit }) {
  const [, setTick]         = useState(0);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const gridRef   = useRef(ntEmpty());
  const pieceRef  = useRef(null);
  const nextRef   = useRef(null);
  const pxRef     = useRef(3);
  const pyRef     = useRef(0);
  const scoreRef  = useRef(0);
  const linesRef  = useRef(0);
  const levelRef  = useRef(1);
  const runRef    = useRef(false);
  const dropCtr   = useRef(0);

  const tick = () => setTick(t=>t+1);
  const rndPiece = () => NT_PIECES[Math.floor(Math.random()*NT_PIECES.length)];
  const canPlace = (shape, x, y) => {
    for (let r=0;r<shape.length;r++) for(let c=0;c<shape[r].length;c++) {
      if (!shape[r][c]) continue;
      const nr=y+r, nc=x+c;
      if (nc<0||nc>=NT_COLS||nr>=NT_ROWS) return false;
      if (nr>=0 && gridRef.current[nr][nc]) return false;
    }
    return true;
  };
  const spawnPiece = () => {
    const p = nextRef.current || rndPiece();
    nextRef.current = rndPiece();
    const sx = Math.floor(NT_COLS/2) - Math.floor(p.shape[0].length/2);
    if (!canPlace(p.shape, sx, 0)) { runRef.current=false; setRunning(false); setGameOver(true); deathVibrate(); return; }
    pieceRef.current = p; pxRef.current = sx; pyRef.current = 0; tick();
  };
  const lockPiece = () => {
    const g = gridRef.current.map(r=>[...r]);
    const {shape, color} = pieceRef.current;
    shape.forEach((row,r)=>row.forEach((c,col)=>{ if(c&&pyRef.current+r>=0) g[pyRef.current+r][pxRef.current+col]=color; }));
    let cleared = 0;
    const kept = g.filter(row=>row.some(c=>!c));
    cleared = NT_ROWS - kept.length;
    while(kept.length < NT_ROWS) kept.unshift(Array(NT_COLS).fill(null));
    gridRef.current = kept;
    scoreRef.current += ([0,100,300,500,800][cleared]??800) * levelRef.current;
    linesRef.current += cleared;
    levelRef.current  = Math.floor(linesRef.current/10)+1;
    if (cleared > 0) { popVibrate(); }
    spawnPiece();
  };
  const startGame = () => {
    gridRef.current = ntEmpty(); scoreRef.current=0; linesRef.current=0; levelRef.current=1;
    dropCtr.current = 0; nextRef.current = rndPiece();
    runRef.current = true; setGameOver(false); setRunning(true); spawnPiece();
  };

  useEffect(() => {
    if (!running) return;
    const id = setInterval(()=>{
      if (!runRef.current || !pieceRef.current) return;
      dropCtr.current++;
      const every = Math.max(2, Math.floor((550-(levelRef.current-1)*45)/16));
      if (dropCtr.current < every) { tick(); return; }
      dropCtr.current = 0;
      const ny = pyRef.current + 1;
      if (canPlace(pieceRef.current.shape, pxRef.current, ny)) { pyRef.current=ny; tick(); }
      else lockPiece();
    }, 16);
    return ()=>clearInterval(id);
  }, [running]);

  const moveLeft  = () => { if(!runRef.current||!pieceRef.current)return; const nx=pxRef.current-1; if(canPlace(pieceRef.current.shape,nx,pyRef.current)){pxRef.current=nx;Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);tick();} };
  const moveRight = () => { if(!runRef.current||!pieceRef.current)return; const nx=pxRef.current+1; if(canPlace(pieceRef.current.shape,nx,pyRef.current)){pxRef.current=nx;Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);tick();} };
  const rotate    = () => {
    if(!runRef.current||!pieceRef.current)return;
    const rot = ntRotate(pieceRef.current.shape);
    if(canPlace(rot,pxRef.current,pyRef.current)){pieceRef.current={...pieceRef.current,shape:rot};Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);tick();}
  };
  const hardDrop  = () => {
    if(!runRef.current||!pieceRef.current)return;
    let ny=pyRef.current; while(canPlace(pieceRef.current.shape,pxRef.current,ny+1))ny++;
    pyRef.current=ny; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); lockPiece();
  };

  const display = gridRef.current.map(r=>[...r]);
  if (pieceRef.current && running) {
    pieceRef.current.shape.forEach((row,r)=>row.forEach((c,col)=>{
      const nr=pyRef.current+r, nc=pxRef.current+col;
      if(c&&nr>=0&&nr<NT_ROWS&&nc>=0&&nc<NT_COLS) display[nr][nc]=pieceRef.current.color;
    }));
  }
  // Ghost piece
  if (pieceRef.current && running) {
    let gy=pyRef.current; while(canPlace(pieceRef.current.shape,pxRef.current,gy+1))gy++;
    if(gy!==pyRef.current) pieceRef.current.shape.forEach((row,r)=>row.forEach((c,col)=>{
      const nr=gy+r, nc=pxRef.current+col;
      if(c&&nr>=0&&nr<NT_ROWS&&nc>=0&&nc<NT_COLS&&!display[nr][nc]) display[nr][nc]='ghost';
    }));
  }

  return (
    <SafeAreaView style={[styles.container,{backgroundColor:'#020212'}]}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={[styles.title,{fontSize:20,color:'#0ff'}]}>🧊 NEON TETRIS</Text>
        <View style={{alignItems:'flex-end'}}>
          <Text style={{color:'#0ff',fontSize:13,fontWeight:'bold'}}>{scoreRef.current}</Text>
          <Text style={{color:'#666',fontSize:11}}>Lv.{levelRef.current} • {linesRef.current}L</Text>
        </View>
      </View>
      <View style={{flexDirection:'row',justifyContent:'center',alignItems:'flex-start',flex:1,paddingTop:4}}>
        {/* Grid */}
        <View style={{width:NT_COLS*NT_CELL,height:NT_ROWS*NT_CELL,borderWidth:2,borderColor:'#0ff3',backgroundColor:'#020212',position:'relative',overflow:'hidden'}}>
          {display.map((row,r)=>row.map((cell,c)=>(
            <View key={`${r}-${c}`} style={{
              position:'absolute',left:c*NT_CELL+1,top:r*NT_CELL+1,
              width:NT_CELL-2,height:NT_CELL-2,borderRadius:2,
              backgroundColor:cell==='ghost'?'#ffffff18':cell?cell:'#08081a',
              shadowColor:cell&&cell!=='ghost'?cell:'transparent',
              shadowOpacity:cell&&cell!=='ghost'?0.9:0,shadowRadius:4,
            }}/>
          )))}
          {!running && (
            <View style={[styles.overlay,{borderRadius:0}]}>
              <Text style={[styles.overlayTitle,{color:'#0ff',fontSize:22}]}>{gameOver?'GAME OVER':'🧊 NEON TETRIS'}</Text>
              <Text style={[styles.overlaySub,{fontSize:13,textAlign:'center'}]}>
                {gameOver?`Score: ${scoreRef.current}\nLineas: ${linesRef.current}\nNivel: ${levelRef.current}`:'Clásico Tetris con efectos neon.\n¡Rompe tu record!'}
              </Text>
              <Pressable style={[styles.btn,{backgroundColor:'#0ff',paddingHorizontal:22,paddingVertical:12}]} onPress={startGame}>
                <Text style={[styles.btnText,{fontSize:16}]}>{gameOver?'REINTENTAR':'START'}</Text>
              </Pressable>
            </View>
          )}
        </View>
        {/* Side panel */}
        <View style={{width:80,paddingLeft:10,paddingTop:4}}>
          <Text style={{color:'#555',fontSize:10,marginBottom:4}}>NEXT</Text>
          {nextRef.current && (
            <View style={{backgroundColor:'#0a0a20',padding:6,borderRadius:8,marginBottom:14,borderWidth:1,borderColor:'#0ff3'}}>
              {nextRef.current.shape.map((row,r)=>(
                <View key={r} style={{flexDirection:'row',justifyContent:'center'}}>
                  {row.map((c,col)=>(
                    <View key={col} style={{width:11,height:11,margin:1,borderRadius:2,backgroundColor:c?nextRef.current.color:'transparent'}}/>
                  ))}
                </View>
              ))}
            </View>
          )}
          <Text style={{color:'#0ff8',fontSize:10,marginBottom:1}}>SCORE</Text>
          <Text style={{color:'#fff',fontSize:12,fontWeight:'bold',marginBottom:8}}>{scoreRef.current}</Text>
          <Text style={{color:'#0ff8',fontSize:10,marginBottom:1}}>LINEAS</Text>
          <Text style={{color:'#fff',fontSize:12,fontWeight:'bold',marginBottom:8}}>{linesRef.current}</Text>
          <Text style={{color:'#0ff8',fontSize:10,marginBottom:1}}>NIVEL</Text>
          <Text style={{color:'#fff',fontSize:14,fontWeight:'bold'}}>{levelRef.current}</Text>
        </View>
      </View>
      {/* Controls */}
      {running && (
        <View style={{flexDirection:'row',justifyContent:'space-around',alignItems:'center',paddingVertical:10,paddingHorizontal:10,backgroundColor:'rgba(0,0,0,0.45)'}}>
          <Pressable onPress={moveLeft}  style={{width:68,height:68,backgroundColor:'#0ff1',borderRadius:34,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:'#0ff4'}}>
            <Text style={{color:'#0ff',fontSize:28,fontWeight:'bold'}}>◀</Text>
          </Pressable>
          <Pressable onPress={rotate}    style={{width:68,height:68,backgroundColor:'#ffa0001a',borderRadius:34,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:'#ffa0004d'}}>
            <Text style={{color:'#ffa500',fontSize:26,fontWeight:'bold'}}>↻</Text>
          </Pressable>
          <Pressable onPress={hardDrop}  style={{width:68,height:68,backgroundColor:'#ff00441a',borderRadius:34,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:'#ff00444d'}}>
            <Text style={{color:'#ff0044',fontSize:22,fontWeight:'bold'}}>▼▼</Text>
          </Pressable>
          <Pressable onPress={moveRight} style={{width:68,height:68,backgroundColor:'#0ff1',borderRadius:34,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:'#0ff4'}}>
            <Text style={{color:'#0ff',fontSize:28,fontWeight:'bold'}}>▶</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── NEON WARRIOR - Action Side-Scrolling Platformer ─────────────
const NW_GH   = Math.min(height - 260, 500);
const NW_GW   = width;
const NW_WW   = Math.floor(width * 3.5);
const NW_GRAV = 0.55;
const NW_JUMP = -13;
const NW_SPD  = 3.5;
const NW_PW   = 36;
const NW_PH   = 40;
const NW_EW   = 36;
const NW_EH   = 36;
const NW_GND  = NW_GH - 48;

function nwGetLevel(n) {
  const g = NW_GND, w = NW_WW;
  const LVLS = [
    {
      plats:[
        {x:0,y:g,w,h:50},
        {x:140,y:g-130,w:100,h:16},{x:320,y:g-190,w:90,h:16},
        {x:520,y:g-140,w:110,h:16},{x:740,y:g-200,w:100,h:16},
        {x:960,y:g-150,w:120,h:16},{x:1180,y:g-210,w:90,h:16},
      ],
      enemies:[
        {id:0,x:370,y:g-NW_EH,vx:1.2,vy:0,hp:1,maxHp:1,type:'w',alive:true,bx:200,ex:600},
        {id:1,x:800,y:g-NW_EH,vx:-1.2,vy:0,hp:1,maxHp:1,type:'w',alive:true,bx:620,ex:1000},
        {id:2,x:600,y:g-150,vx:0,vy:1.5,hp:1,maxHp:1,type:'f',alive:true,by:g-250,ey:g-70},
      ],
      coins:[
        {id:0,x:170,y:g-165,col:false},{id:1,x:350,y:g-225,col:false},
        {id:2,x:560,y:g-175,col:false},{id:3,x:770,y:g-235,col:false},
        {id:4,x:1000,y:g-185,col:false},{id:5,x:1210,y:g-245,col:false},
      ],
      pups:[{id:0,x:540,y:g-178,t:'⭐',col:false},{id:1,x:980,y:g-90,t:'❤️',col:false}],
    },
    {
      plats:[
        {x:0,y:g,w:180,h:50},{x:260,y:g,w:180,h:50},{x:520,y:g,w:200,h:50},
        {x:800,y:g,w:180,h:50},{x:1060,y:g,w:w-1060,h:50},
        {x:120,y:g-150,w:90,h:16},{x:320,y:g-220,w:80,h:16},
        {x:500,y:g-160,w:90,h:16},{x:690,y:g-230,w:80,h:16},
        {x:880,y:g-170,w:90,h:16},{x:1080,y:g-240,w:85,h:16},
      ],
      enemies:[
        {id:0,x:290,y:g-NW_EH,vx:1.5,vy:0,hp:1,maxHp:1,type:'w',alive:true,bx:260,ex:440},
        {id:1,x:570,y:g-NW_EH,vx:-1.5,vy:0,hp:1,maxHp:1,type:'w',alive:true,bx:520,ex:720},
        {id:2,x:830,y:g-NW_EH,vx:1.5,vy:0,hp:1,maxHp:1,type:'w',alive:true,bx:800,ex:980},
        {id:3,x:400,y:g-120,vx:0,vy:2,hp:1,maxHp:1,type:'f',alive:true,by:g-270,ey:g-60},
        {id:4,x:790,y:g-110,vx:0,vy:2,hp:1,maxHp:1,type:'f',alive:true,by:g-260,ey:g-60},
        {id:5,x:1160,y:g-NW_EH,vx:2,vy:0,hp:3,maxHp:3,type:'h',alive:true,bx:1060,ex:1450},
      ],
      coins:[
        {id:0,x:140,y:g-190,col:false},{id:1,x:335,y:g-260,col:false},
        {id:2,x:520,y:g-200,col:false},{id:3,x:710,y:g-270,col:false},
        {id:4,x:900,y:g-210,col:false},{id:5,x:1100,y:g-280,col:false},
        {id:6,x:1200,y:g-100,col:false},
      ],
      pups:[
        {id:0,x:330,y:g-260,t:'⭐',col:false},
        {id:1,x:890,y:g-210,t:'🛡️',col:false},
        {id:2,x:1090,y:g-90,t:'❤️',col:false},
      ],
    },
    {
      plats:[
        {x:0,y:g,w:130,h:50},{x:210,y:g,w:110,h:50},{x:410,y:g,w:110,h:50},
        {x:610,y:g,w:110,h:50},{x:810,y:g,w:110,h:50},{x:1010,y:g,w:110,h:50},
        {x:1200,y:g,w:w-1200,h:50},
        {x:100,y:g-140,w:75,h:16},{x:285,y:g-210,w:75,h:16},
        {x:460,y:g-270,w:75,h:16},{x:645,y:g-180,w:75,h:16},
        {x:820,y:g-250,w:75,h:16},{x:1010,y:g-300,w:75,h:16},
        {x:1210,y:g-180,w:75,h:16},
      ],
      enemies:[
        {id:0,x:240,y:g-NW_EH,vx:1.8,vy:0,hp:1,maxHp:1,type:'w',alive:true,bx:210,ex:320},
        {id:1,x:440,y:g-NW_EH,vx:-1.8,vy:0,hp:1,maxHp:1,type:'w',alive:true,bx:410,ex:520},
        {id:2,x:640,y:g-NW_EH,vx:1.8,vy:0,hp:1,maxHp:1,type:'w',alive:true,bx:610,ex:720},
        {id:3,x:840,y:g-NW_EH,vx:-1.8,vy:0,hp:1,maxHp:1,type:'w',alive:true,bx:810,ex:920},
        {id:4,x:340,y:g-100,vx:0,vy:2.2,hp:1,maxHp:1,type:'f',alive:true,by:g-290,ey:g-60},
        {id:5,x:660,y:g-110,vx:0,vy:2.2,hp:1,maxHp:1,type:'f',alive:true,by:g-290,ey:g-60},
        {id:6,x:980,y:g-100,vx:0,vy:2.2,hp:1,maxHp:1,type:'f',alive:true,by:g-290,ey:g-60},
        {id:7,x:1260,y:g-NW_EH,vx:2.5,vy:0,hp:5,maxHp:5,type:'h',alive:true,bx:1200,ex:1550},
      ],
      coins:[
        {id:0,x:115,y:g-180,col:false},{id:1,x:300,y:g-250,col:false},
        {id:2,x:478,y:g-310,col:false},{id:3,x:660,y:g-220,col:false},
        {id:4,x:838,y:g-290,col:false},{id:5,x:1028,y:g-340,col:false},
        {id:6,x:1228,y:g-220,col:false},{id:7,x:1310,y:g-90,col:false},
      ],
      pups:[
        {id:0,x:300,y:g-250,t:'⭐',col:false},
        {id:1,x:660,y:g-220,t:'🛡️',col:false},
        {id:2,x:1028,y:g-90,t:'❤️',col:false},
        {id:3,x:1028,y:g-340,t:'⭐',col:false},
      ],
    },
  ];
  return JSON.parse(JSON.stringify(LVLS[Math.min(n - 1, LVLS.length - 1)]));
}

function NeonWarrior({ onExit }) {
  const [, setTick] = useState(0);
  const [phase, setPhase] = useState('menu');
  const pRef     = useRef(null);
  const camRef   = useRef(0);
  const enRef    = useRef([]);
  const blRef    = useRef([]);
  const coRef    = useRef([]);
  const puRef    = useRef([]);
  const ptRef    = useRef([]);
  const scoreRef = useRef(0);
  const levelRef = useRef(1);
  const loopRef  = useRef(null);
  const keysRef  = useRef({ left: false, right: false });
  const blCoolRef = useRef(0);
  const invRef   = useRef(0);
  const shieldRef = useRef(false);

  const initLevel = (lvl) => {
    const d = nwGetLevel(lvl);
    ptRef.current = d.plats;
    enRef.current = d.enemies;
    blRef.current = [];
    coRef.current = d.coins;
    puRef.current = d.pups;
    pRef.current = { x: 50, y: NW_GND - NW_PH, vx: 0, vy: 0, jumps: 0, hp: 3, facing: 1 };
    camRef.current = 0;
    invRef.current = 0;
    shieldRef.current = false;
    blCoolRef.current = 0;
  };

  const startGame = () => {
    levelRef.current = 1;
    scoreRef.current = 0;
    initLevel(1);
    setPhase('play');
  };

  const nextLevel = () => {
    const next = levelRef.current + 1;
    if (next > 3) { setPhase('win'); celebrateVibrate(); }
    else { levelRef.current = next; initLevel(next); setPhase('play'); }
  };

  useEffect(() => {
    if (phase !== 'play') { clearInterval(loopRef.current); return; }
    loopRef.current = setInterval(() => {
      const p = pRef.current;
      const plats = ptRef.current;
      if (!p) return;
      // Movement
      if (keysRef.current.left)       { p.vx = -NW_SPD; p.facing = -1; }
      else if (keysRef.current.right) { p.vx =  NW_SPD; p.facing =  1; }
      else p.vx = 0;
      // Gravity
      p.vy = Math.min(p.vy + NW_GRAV, 14);
      p.x  = Math.max(0, Math.min(NW_WW - NW_PW, p.x + p.vx));
      const prevBottom = p.y + NW_PH;
      p.y += p.vy;
      const currBottom = p.y + NW_PH;
      // Platform collision (top only)
      let onGround = false;
      for (const pt of plats) {
        if (p.x + NW_PW > pt.x + 2 && p.x + 2 < pt.x + pt.w) {
          if (prevBottom <= pt.y + 2 && currBottom >= pt.y && p.vy >= 0) {
            p.y = pt.y - NW_PH; p.vy = 0; onGround = true; break;
          }
        }
      }
      if (onGround) p.jumps = 0;
      if (p.y > NW_GH + 60) p.hp = 0;
      // Camera
      camRef.current = Math.max(0, Math.min(NW_WW - NW_GW, p.x - NW_GW * 0.35));
      if (invRef.current > 0)   invRef.current--;
      if (blCoolRef.current > 0) blCoolRef.current--;
      // Enemies
      enRef.current.forEach(e => {
        if (!e.alive) return;
        if (e.type === 'w' || e.type === 'h') {
          e.x += e.vx;
          if (e.x <= e.bx || e.x + NW_EW >= e.ex) e.vx *= -1;
        } else {
          e.y += e.vy;
          if (e.y <= e.by || e.y + NW_EH >= e.ey) e.vy *= -1;
        }
        if (invRef.current > 0) return;
        if (p.x + NW_PW > e.x + 4 && p.x + 4 < e.x + NW_EW &&
            p.y + NW_PH > e.y + 4 && p.y + 4 < e.y + NW_EH) {
          if (p.vy > 2 && p.y + NW_PH < e.y + NW_EH * 0.55) {
            e.hp--; if (e.hp <= 0) { e.alive = false; scoreRef.current += 50; }
            else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            p.vy = NW_JUMP * 0.65; scoreVibrate();
          } else {
            if (shieldRef.current) { shieldRef.current = false; Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }
            else { p.hp = Math.max(0, p.hp - 1); deathVibrate(); }
            invRef.current = 90;
          }
        }
      });
      // Bullets
      blRef.current = blRef.current.filter(b => {
        b.x += b.vx;
        if (b.x < 0 || b.x > NW_WW) return false;
        for (const e of enRef.current) {
          if (!e.alive) continue;
          if (b.x + 10 > e.x && b.x < e.x + NW_EW && b.y + 5 > e.y && b.y < e.y + NW_EH) {
            e.hp--; if (e.hp <= 0) { e.alive = false; scoreRef.current += 50; scoreVibrate(); }
            else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            return false;
          }
        }
        return true;
      });
      // Coins
      coRef.current.forEach(c => {
        if (c.col) return;
        if (p.x + NW_PW > c.x && p.x < c.x + 22 && p.y + NW_PH > c.y && p.y < c.y + 22) {
          c.col = true; scoreRef.current += 10; popVibrate();
        }
      });
      // Power-ups
      puRef.current.forEach(pu => {
        if (pu.col) return;
        if (p.x + NW_PW > pu.x && p.x < pu.x + 26 && p.y + NW_PH > pu.y && p.y < pu.y + 26) {
          pu.col = true;
          if (pu.t === '❤️') p.hp = Math.min(p.hp + 1, 5);
          else if (pu.t === '🛡️') shieldRef.current = true;
          else if (pu.t === '⭐') p.jumps = 0;
          scoreRef.current += 20; celebrateVibrate();
        }
      });
      if (p.hp <= 0) { clearInterval(loopRef.current); setPhase('dead'); return; }
      if (p.x >= NW_WW - NW_PW - 20) {
        clearInterval(loopRef.current); scoreRef.current += 200; setPhase('levelclear'); celebrateVibrate(); return;
      }
      setTick(t => t + 1);
    }, 16);
    return () => clearInterval(loopRef.current);
  }, [phase]);

  const jump = () => {
    const p = pRef.current;
    if (p && p.jumps < 2) { p.vy = NW_JUMP; p.jumps++; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }
  };
  const shoot = () => {
    const p = pRef.current;
    if (!p || blCoolRef.current > 0) return;
    blRef.current.push({ x: p.facing > 0 ? p.x + NW_PW : p.x - 10, y: p.y + NW_PH * 0.45, vx: 7 * p.facing });
    blCoolRef.current = 12; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  if (phase === 'menu') return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onExit}><Text style={styles.backText}>← Exit</Text></Pressable>
        <Text style={[styles.title, { color: '#f0f' }]}>NEON WARRIOR</Text>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 }}>
        <Text style={{ fontSize: 64, marginBottom: 16 }}>🥷</Text>
        <Text style={{ color: '#f0f', fontSize: 28, fontWeight: '900', marginBottom: 10, textShadowColor: '#f0f', textShadowRadius: 10 }}>NEON WARRIOR</Text>
        <Text style={{ color: '#aaa', fontSize: 14, textAlign: 'center', marginBottom: 8 }}>Plataformas · Salto Doble · Enemigos · Poderes</Text>
        <Text style={{ color: '#555', fontSize: 12, textAlign: 'center', marginBottom: 32 }}>{'◀▶ Mover  ⬆ Saltar x2  💥 Disparar\n👾 Pisa enemigos desde arriba o dispárales\n⭐ recarga saltos · 🛡️ escudo · ❤️ vida extra'}</Text>
        <Pressable style={[styles.btn, { backgroundColor: '#f0f', shadowColor: '#f0f' }]} onPress={startGame}>
          <Text style={styles.btnText}>JUGAR</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );

  if (phase === 'levelclear') return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 }}>
        <Text style={{ color: '#0ff', fontSize: 32, fontWeight: '900', textAlign: 'center', marginBottom: 10 }}>✨ NIVEL {levelRef.current} COMPLETO</Text>
        <Text style={{ color: '#ffd700', fontSize: 20, marginBottom: 30 }}>Score: {scoreRef.current}</Text>
        <Pressable style={[styles.btn, { backgroundColor: '#0ff', shadowColor: '#0ff' }]} onPress={nextLevel}>
          <Text style={styles.btnText}>{levelRef.current >= 3 ? 'VER FINAL' : `NIVEL ${levelRef.current + 1} →`}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );

  if (phase === 'dead') return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 }}>
        <Text style={{ color: '#f00', fontSize: 32, fontWeight: '900', textAlign: 'center', marginBottom: 10 }}>💀 GAME OVER</Text>
        <Text style={{ color: '#aaa', fontSize: 18, marginBottom: 30 }}>Score: {scoreRef.current}</Text>
        <Pressable style={[styles.btn, { backgroundColor: '#f0f', shadowColor: '#f0f', marginBottom: 16 }]} onPress={startGame}>
          <Text style={styles.btnText}>REINTENTAR</Text>
        </Pressable>
        <Pressable onPress={onExit}><Text style={{ color: '#555', fontSize: 14 }}>Salir al Menú</Text></Pressable>
      </View>
    </SafeAreaView>
  );

  if (phase === 'win') return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 }}>
        <Text style={{ color: '#ffd700', fontSize: 36, fontWeight: '900', textAlign: 'center', marginBottom: 10 }}>🏆 ¡GANASTE!</Text>
        <Text style={{ color: '#fff', fontSize: 20, marginBottom: 6 }}>Score final: {scoreRef.current}</Text>
        <Text style={{ color: '#aaa', fontSize: 13, textAlign: 'center', marginBottom: 30 }}>¡3 niveles completados!</Text>
        <Pressable style={[styles.btn, { backgroundColor: '#ffd700', shadowColor: '#ffd700', marginBottom: 16 }]} onPress={startGame}>
          <Text style={[styles.btnText, { color: '#000' }]}>JUGAR OTRA VEZ</Text>
        </Pressable>
        <Pressable onPress={onExit}><Text style={{ color: '#555', fontSize: 14 }}>Salir al Menú</Text></Pressable>
      </View>
    </SafeAreaView>
  );

  // ── play ──────────────────────────────────────────────────────
  const p   = pRef.current;
  const cam = camRef.current;
  const hearts = p ? '❤️'.repeat(Math.max(0, p.hp)) : '';
  return (
    <SafeAreaView style={styles.container}>
      {/* HUD */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6 }}>
        <Pressable onPress={() => { clearInterval(loopRef.current); onExit(); }}>
          <Text style={{ color: '#666', fontSize: 13 }}>← Salir</Text>
        </Pressable>
        <Text style={{ color: '#f0f', fontSize: 13, fontWeight: 'bold' }}>LVL {levelRef.current}/3</Text>
        <Text style={{ fontSize: 13 }}>{hearts}{shieldRef.current ? '🛡️' : ''}</Text>
        <Text style={{ color: '#ffd700', fontSize: 13, fontWeight: 'bold' }}>⭐{scoreRef.current}</Text>
      </View>
      {/* Game canvas */}
      {p && (
        <View style={{ width: NW_GW, height: NW_GH, backgroundColor: '#03031a', overflow: 'hidden' }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: ((i + 1) / 8) * NW_GH, height: 1, backgroundColor: '#0ff07' }} />
          ))}
          <Text style={{ position: 'absolute', left: NW_WW - 90 - cam, top: NW_GND - 52, fontSize: 38 }}>🌀</Text>
          {ptRef.current.map((pt, i) => (
            <View key={i} style={{
              position: 'absolute', left: pt.x - cam, top: pt.y, width: pt.w, height: pt.h,
              backgroundColor: i === 0 ? '#050f05' : '#071428',
              borderTopWidth: 3, borderTopColor: i === 0 ? '#0f0' : '#05f',
              borderLeftWidth: i > 0 ? 1 : 0, borderRightWidth: i > 0 ? 1 : 0,
              borderLeftColor: '#05f4', borderRightColor: '#05f4',
            }} />
          ))}
          {coRef.current.filter(c => !c.col).map(c => (
            <Text key={c.id} style={{ position: 'absolute', left: c.x - cam, top: c.y, fontSize: 18 }}>🪙</Text>
          ))}
          {puRef.current.filter(pu => !pu.col).map(pu => (
            <Text key={pu.id} style={{ position: 'absolute', left: pu.x - cam, top: pu.y, fontSize: 22 }}>{pu.t}</Text>
          ))}
          {enRef.current.filter(e => e.alive).map(e => (
            <View key={e.id} style={{ position: 'absolute', left: e.x - cam, top: e.y }}>
              <Text style={{ fontSize: 28 }}>{e.type === 'f' ? '🛸' : e.type === 'h' ? '👹' : '👾'}</Text>
              {e.maxHp > 1 && (
                <View style={{ width: NW_EW, height: 4, backgroundColor: '#300', borderRadius: 2 }}>
                  <View style={{ width: NW_EW * (e.hp / e.maxHp), height: 4, backgroundColor: '#f00', borderRadius: 2 }} />
                </View>
              )}
            </View>
          ))}
          {blRef.current.map((b, i) => (
            <View key={i} style={{ position: 'absolute', left: b.x - cam, top: b.y, width: 12, height: 6, backgroundColor: '#ff0', borderRadius: 3, shadowColor: '#ff0', shadowOpacity: 1, shadowRadius: 4 }} />
          ))}
          <Text style={{
            position: 'absolute', left: p.x - cam, top: p.y, fontSize: 30,
            opacity: invRef.current > 0 && Math.floor(invRef.current / 6) % 2 === 0 ? 0.2 : 1,
            transform: [{ scaleX: p.facing }],
          }}>🥷</Text>
        </View>
      )}
      {/* Controls */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPressIn={() => keysRef.current.left = true} onPressOut={() => keysRef.current.left = false}
            style={{ width: 68, height: 68, backgroundColor: '#f0f1', borderRadius: 34, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#f0f4' }}>
            <Text style={{ color: '#f0f', fontSize: 28, fontWeight: 'bold' }}>◀</Text>
          </Pressable>
          <Pressable onPressIn={() => keysRef.current.right = true} onPressOut={() => keysRef.current.right = false}
            style={{ width: 68, height: 68, backgroundColor: '#f0f1', borderRadius: 34, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#f0f4' }}>
            <Text style={{ color: '#f0f', fontSize: 28, fontWeight: 'bold' }}>▶</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={shoot}
            style={{ width: 68, height: 68, backgroundColor: '#ff01', borderRadius: 34, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#ff04' }}>
            <Text style={{ color: '#ff0', fontSize: 26 }}>💥</Text>
          </Pressable>
          <Pressable onPress={jump}
            style={{ width: 68, height: 68, backgroundColor: '#0ff1', borderRadius: 34, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#0ff4' }}>
            <Text style={{ color: '#0ff', fontSize: 26, fontWeight: 'bold' }}>⬆</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
// ─── PIXEL CRAFT - 2D Minecraft/Terraria ─────────────────────────
const PCB   = Math.floor(Math.min(width / 12, 34));   // block px
const PC_GH = Math.min(height - 230, 450);             // game area h
const PC_VW = Math.ceil(width / PCB) + 3;              // visible cols
const PC_VH = Math.ceil(PC_GH / PCB) + 3;             // visible rows
const PC_WW = 90;  // world width  (blocks)
const PC_WH = 52;  // world height (blocks)

// [bgColor, borderColor, tapsToBreak(0=indestructible), itemDrop, label]
const PCT = [
  null,
  ['#2e8c2e','#1a5c1a', 1,  2, 'Grass'],    // 1
  ['#7a4420','#5a3010', 2,  2, 'Dirt'],     // 2
  ['#787878','#545454', 5,  3, 'Stone'],    // 3
  ['#1a1a1a','#0a0a0a', 0,  0, 'Bedrock'],  // 4
  ['#505050','#383838', 6,  5, 'Coal'],     // 5
  ['#b09870','#887050', 8,  6, 'Iron'],     // 6
  ['#d4a820','#a07810',10,  7, 'Gold'],     // 7
  ['#20bcd4','#0090a8',14,  8, 'Diamond'],  // 8
  ['#6b4520','#4a2e10', 4,  9, 'Wood'],     // 9
  ['#2d7a2d','#1d5a1d', 1,  0, 'Leaves'],  // 10
  ['#5080d0','#3060b0', 1,  0, 'Water'],   // 11 (deco only)
];
const PC_ORE_COLOR = { 5:'#111111', 6:'#c8a840', 7:'#ffd020', 8:'#00e8ff' };
const PC_BLOCK_NAMES = PCT.map(b => b ? b[4] : '');

function pcGenWorld() {
  const W = PC_WW, H = PC_WH;
  const rows = Array.from({ length: H }, () => new Array(W).fill(0));
  // Height map with layered sines for natural terrain
  const hmap = Array.from({ length: W }, (_, x) => Math.floor(
    H * 0.33
    + Math.sin(x * 0.11) * 4
    + Math.sin(x * 0.065) * 7
    + Math.cos(x * 0.19) * 2
    + Math.sin(x * 0.31 + 1.2) * 1.5
  ));
  for (let x = 0; x < W; x++) {
    const sy = hmap[x];
    for (let y = 0; y < H; y++) {
      if (y < sy) continue;
      if (y === sy) { rows[y][x] = 1; continue; }
      const d = y - sy;
      if (d < 5) { rows[y][x] = 2; continue; }
      if (y >= H - 2) { rows[y][x] = 4; continue; }
      const r = Math.random();
      if (d > 22 && r < 0.022) { rows[y][x] = 8; continue; }
      if (d > 14 && r < 0.045) { rows[y][x] = 7; continue; }
      if (d > 7  && r < 0.085) { rows[y][x] = 6; continue; }
      if (d > 3  && r < 0.12)  { rows[y][x] = 5; continue; }
      rows[y][x] = 3;
    }
    // Trees on surface
    if (hmap[x] > 2 && hmap[x] < H - 10 && Math.random() < 0.1) {
      const sh = 3 + Math.floor(Math.random() * 2);
      for (let ty = hmap[x] - sh; ty < hmap[x]; ty++) if (ty >= 0) rows[ty][x] = 9;
      for (let ly = hmap[x] - sh - 2; ly <= hmap[x] - sh; ly++) {
        if (ly < 0) continue;
        for (let lx = Math.max(0, x - 2); lx <= Math.min(W - 1, x + 2); lx++)
          if (rows[ly][lx] === 0) rows[ly][lx] = 10;
      }
    }
  }
  return { rows, hmap };
}

function PixelCraft({ onExit }) {
  const [, setTick] = useState(0);
  const worldRef  = useRef(null);
  const pRef      = useRef({ x: 10, y: 5, vx: 0, vy: 0, onGround: false });
  const camRef    = useRef({ x: 0, y: 0 });
  const invRef    = useRef({});
  const modeRef   = useRef('mine');
  const selRef    = useRef(0);
  const mineRef   = useRef(null);
  const keysRef   = useRef({ left: false, right: false });
  const loopRef   = useRef(null);
  const minedRef  = useRef(0);

  useEffect(() => {
    const { rows, hmap } = pcGenWorld();
    worldRef.current = rows;
    const sx = 8, sy = hmap[8] - 2;
    pRef.current = { x: sx + 0.3, y: sy, vx: 0, vy: 0, onGround: false };
    camRef.current = { x: sx - PC_VW / 2, y: sy - PC_VH / 2 };
    setTick(t => t + 1);

    loopRef.current = setInterval(() => {
      const p = pRef.current;
      const world = worldRef.current;
      if (!p || !world) return;

      if (keysRef.current.left)        p.vx = -0.14;
      else if (keysRef.current.right)  p.vx =  0.14;
      else                             p.vx =  0;

      p.vy = Math.min(p.vy + 0.028, 0.45);

      const solid = (bx, by) => {
        if (bx < 0 || bx >= PC_WW) return true;
        if (by < 0) return false;
        if (by >= PC_WH) return true;
        return world[by][bx] > 0;
      };

      // Move X
      const nx = p.x + p.vx;
      const hitX = p.vx < 0
        ? solid(Math.floor(nx), Math.floor(p.y)) || solid(Math.floor(nx), Math.floor(p.y + 0.85))
        : solid(Math.floor(nx + 0.9), Math.floor(p.y)) || solid(Math.floor(nx + 0.9), Math.floor(p.y + 0.85));
      if (!hitX) p.x = Math.max(0.1, Math.min(PC_WW - 1.1, nx));

      // Move Y
      const ny = p.y + p.vy;
      p.onGround = false;
      if (p.vy >= 0) {
        const hitB = solid(Math.floor(p.x), Math.floor(ny + 0.95)) || solid(Math.floor(p.x + 0.85), Math.floor(ny + 0.95));
        if (hitB) { p.y = Math.floor(ny + 0.95) - 0.96; p.vy = 0; p.onGround = true; }
        else p.y = ny;
      } else {
        const hitT = solid(Math.floor(p.x), Math.floor(ny)) || solid(Math.floor(p.x + 0.85), Math.floor(ny));
        if (hitT) { p.y = Math.floor(ny) + 1.0; p.vy = 0; }
        else p.y = ny;
      }
      p.y = Math.max(0, Math.min(PC_WH - 2, p.y));

      // Camera (smooth follow)
      const tx = p.x - PC_VW / 2 + 0.5, ty = p.y - PC_VH / 2 + 0.5;
      camRef.current.x += (tx - camRef.current.x) * 0.15;
      camRef.current.y += (ty - camRef.current.y) * 0.15;
      camRef.current.x = Math.max(0, Math.min(PC_WW - PC_VW, camRef.current.x));
      camRef.current.y = Math.max(0, Math.min(PC_WH - PC_VH, camRef.current.y));

      setTick(t => t + 1);
    }, 33);
    return () => clearInterval(loopRef.current);
  }, []);

  const jump = () => {
    const p = pRef.current;
    if (p?.onGround) { p.vy = -0.40; p.onGround = false; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }
  };

  const handlePress = (evt) => {
    const world = worldRef.current;
    if (!world) return;
    const lx = evt.nativeEvent.locationX, ly = evt.nativeEvent.locationY;
    const wx = Math.floor(camRef.current.x + lx / PCB);
    const wy = Math.floor(camRef.current.y + ly / PCB);
    if (wy < 0 || wy >= PC_WH || wx < 0 || wx >= PC_WW) return;
    const bt = world[wy][wx];

    if (modeRef.current === 'mine') {
      if (bt === 0) return;
      const bdef = PCT[bt];
      if (!bdef || bdef[2] === 0) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); return; }
      const key = `${wx},${wy}`;
      const taps = (mineRef.current?.key === key ? mineRef.current.taps : 0) + 1;
      if (taps >= bdef[2]) {
        world[wy][wx] = 0;
        const drop = bdef[3];
        if (drop > 0) invRef.current[drop] = (invRef.current[drop] || 0) + 1;
        minedRef.current++;
        mineRef.current = null;
        scoreVibrate();
      } else {
        mineRef.current = { key, wx, wy, taps, needed: bdef[2] };
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }
    } else {
      if (bt !== 0) return;
      const sel = selRef.current;
      if (!sel || !invRef.current[sel]) return;
      world[wy][wx] = sel;
      invRef.current[sel]--;
      if (!invRef.current[sel]) delete invRef.current[sel];
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setTick(t => t + 1);
  };

  const p = pRef.current;
  const cam = camRef.current;
  const world = worldRef.current;

  // Sky: day/night cycle
  const tod = (Date.now() / 18000) % 1;
  const sun = Math.max(0, Math.sin(tod * Math.PI));
  const skyC = `rgb(${Math.floor(8 + sun * 100)},${Math.floor(16 + sun * 148)},${Math.floor(32 + sun * 178)})`;

  const renderBlocks = () => {
    if (!world || !p) return null;
    const views = [];
    const sx = Math.floor(cam.x), sy = Math.floor(cam.y);
    const ox = -(cam.x - sx) * PCB, oy = -(cam.y - sy) * PCB;
    for (let dy = 0; dy < PC_VH; dy++) {
      for (let dx = 0; dx < PC_VW; dx++) {
        const wx = sx + dx, wy = sy + dy;
        if (wy < 0 || wy >= PC_WH || wx < 0 || wx >= PC_WW) continue;
        const bt = world[wy][wx];
        if (bt === 0) continue;
        const bdef = PCT[bt];
        if (!bdef) continue;
        const plx = Math.round(ox + dx * PCB), ply = Math.round(oy + dy * PCB);
        const isMining = mineRef.current?.wx === wx && mineRef.current?.wy === wy;
        views.push(
          <View key={`${wx},${wy}`} style={{
            position: 'absolute', left: plx, top: ply, width: PCB, height: PCB,
            backgroundColor: bdef[0], borderWidth: 1, borderColor: bdef[1],
          }}>
            {PC_ORE_COLOR[bt] && (
              <View style={{ position: 'absolute', top: 4, left: 4, right: 4, bottom: 4, borderRadius: 3, borderWidth: 2, borderColor: PC_ORE_COLOR[bt] }} />
            )}
            {isMining && (
              <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 5, backgroundColor: '#0004' }}>
                <View style={{ height: 5, backgroundColor: '#fff9', width: `${(mineRef.current.taps / mineRef.current.needed) * 100}%` }} />
              </View>
            )}
          </View>
        );
      }
    }
    // Player
    const plx = Math.round((p.x - cam.x) * PCB);
    const ply = Math.round((p.y - cam.y) * PCB);
    views.push(<Text key="__player" style={{ position: 'absolute', left: plx - 2, top: ply - 2, fontSize: PCB + 2, lineHeight: PCB + 4, zIndex: 99 }}>🧑</Text>);
    return views;
  };

  const invItems = Object.entries(invRef.current).filter(([, v]) => v > 0);
  const isPlace = modeRef.current === 'place';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6 }}>
        <Pressable onPress={() => { clearInterval(loopRef.current); onExit(); }}>
          <Text style={{ color: '#666', fontSize: 13 }}>← Salir</Text>
        </Pressable>
        <Text style={{ color: '#c8a060', fontSize: 13, fontWeight: 'bold' }}>⛏️ {minedRef.current} bloques</Text>
        <Pressable
          onPress={() => { modeRef.current = isPlace ? 'mine' : 'place'; setTick(t => t + 1); }}
          style={{ backgroundColor: isPlace ? '#0a3a0a' : '#3a200a', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: isPlace ? '#2d8a2d' : '#8B5E3C' }}
        >
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>{isPlace ? '🧱 Colocar' : '⛏️ Minar'}</Text>
        </Pressable>
      </View>

      {/* Game canvas */}
      <View style={{ width, height: PC_GH, backgroundColor: skyC, overflow: 'hidden' }}>
        {renderBlocks()}
        <Pressable onPress={handlePress} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      </View>

      {/* Inventory bar */}
      <View style={{ height: 54, backgroundColor: '#111', borderTopWidth: 2, borderTopColor: '#2a2a2a' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 6, gap: 6 }}>
          {invItems.length === 0
            ? <Text style={{ color: '#444', fontSize: 12, alignSelf: 'center', paddingHorizontal: 12 }}>Toca bloques para minarlos</Text>
            : invItems.map(([k, v]) => {
              const bt = parseInt(k);
              const bdef = PCT[bt];
              if (!bdef) return null;
              const isSel = selRef.current === bt && isPlace;
              return (
                <Pressable key={k}
                  onPress={() => { selRef.current = bt; modeRef.current = 'place'; setTick(t => t + 1); }}
                  style={{ width: 42, height: 42, backgroundColor: bdef[0], borderRadius: 6, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2, borderWidth: 2, borderColor: isSel ? '#fff' : '#0006' }}
                >
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold', textShadowColor: '#000', textShadowRadius: 3 }}>{v}</Text>
                </Pressable>
              );
            })
          }
        </ScrollView>
      </View>

      {/* Controls */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.65)' }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPressIn={() => keysRef.current.left = true} onPressOut={() => keysRef.current.left = false}
            style={{ width: 64, height: 64, backgroundColor: '#2a1f0a', borderRadius: 32, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#6a4a1a' }}>
            <Text style={{ color: '#c8a060', fontSize: 26, fontWeight: 'bold' }}>◀</Text>
          </Pressable>
          <Pressable onPressIn={() => keysRef.current.right = true} onPressOut={() => keysRef.current.right = false}
            style={{ width: 64, height: 64, backgroundColor: '#2a1f0a', borderRadius: 32, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#6a4a1a' }}>
            <Text style={{ color: '#c8a060', fontSize: 26, fontWeight: 'bold' }}>▶</Text>
          </Pressable>
        </View>
        <Pressable onPress={jump}
          style={{ width: 70, height: 70, backgroundColor: '#0d2a04', borderRadius: 35, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#3a6a1a' }}>
          <Text style={{ color: '#7ec840', fontSize: 28, fontWeight: 'bold' }}>⬆</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
// ─────────────────────────────────────────────────────────────────

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

  if (currentScreen === 'snake') {
    return <SnakePower onExit={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'pingpong') {
    return <PingPong onExit={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'breakout') {
    return <Breakout onExit={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'void') {
    return <VoidCrawler onExit={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'tunnel') {
    return <NeonTunnel onExit={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'monster') {
    return <MonsterDuel onExit={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'gravity') {
    return <GravityFlip onExit={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'tetris') {
    return <NeonTetris onExit={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'warrior') {
    return <NeonWarrior onExit={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'craft') {
    return <PixelCraft onExit={() => setCurrentScreen('menu')} />;
  }

  return (
    <SafeAreaView style={styles.menuContainer}>
      <ScrollView contentContainerStyle={styles.menuScroll} showsVerticalScrollIndicator={false}>
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
        <Text style={styles.menuBtnSub}>15-World Platformer</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#7c3aed' }]} onPress={() => setCurrentScreen('galactic')}>
        <Text style={styles.menuBtnTitle}>GALACTIC HUNT</Text>
        <Text style={styles.menuBtnSub}>UFO / Duck Shooter</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#16a34a' }]} onPress={() => setCurrentScreen('snake')}>
        <Text style={styles.menuBtnTitle}>🐍 SNAKE POWER</Text>
        <Text style={styles.menuBtnSub}>Snake clásico con poderes</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#0ea5e9' }]} onPress={() => setCurrentScreen('pingpong')}>
        <Text style={styles.menuBtnTitle}>🏓 PING PONG</Text>
        <Text style={styles.menuBtnSub}>1 vs IA · primero a 7 gana</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#f97316' }]} onPress={() => setCurrentScreen('breakout')}>
        <Text style={styles.menuBtnTitle}>🧱 BREAKOUT</Text>
        <Text style={styles.menuBtnSub}>Rompe todos los ladrillos</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#6644dd' }]} onPress={() => setCurrentScreen('void')}>
        <Text style={[styles.menuBtnTitle, { color: '#fff' }]}>☠️ VOID CRAWLER</Text>
        <Text style={[styles.menuBtnSub, { color: '#ccc' }]}>Roguelike • 5 pisos • combate por turnos</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#001a1a', borderWidth:2, borderColor:'#00ffcc' }]} onPress={() => setCurrentScreen('tunnel')}>
        <Text style={[styles.menuBtnTitle, { color: '#00ffcc' }]}>🌀 NEON TUNNEL 3D</Text>
        <Text style={[styles.menuBtnSub, { color: '#00aa88' }]}>Vuela por el túnel neon · Esquiva los bloques</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#b45309' }]} onPress={() => setCurrentScreen('monster')}>
        <Text style={styles.menuBtnTitle}>⚡ MONSTER DUEL</Text>
        <Text style={styles.menuBtnSub}>Pokémon-style • Captura • Evoluciona • Batalla</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#7c3aed' }]} onPress={() => setCurrentScreen('gravity')}>
        <Text style={styles.menuBtnTitle}>🔀 GRAVITY FLIP</Text>
        <Text style={styles.menuBtnSub}>Invierte la gravedad • Evita los pilares</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#0e7490' }]} onPress={() => setCurrentScreen('tetris')}>
        <Text style={styles.menuBtnTitle}>🧊 NEON TETRIS</Text>
        <Text style={styles.menuBtnSub}>Tetris clásico con efectos neon + pieza fantasma</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#6d00cc', borderWidth: 2, borderColor: '#f0f' }]} onPress={() => setCurrentScreen('warrior')}>
        <Text style={[styles.menuBtnTitle, { color: '#fff' }]}>🥷 NEON WARRIOR</Text>
        <Text style={[styles.menuBtnSub, { color: '#ddd' }]}>Plataformas · Salto doble · Mata enemigos · 3 niveles</Text>
      </Pressable>

      <Pressable style={[styles.menuBtn, { backgroundColor: '#3d2008', borderWidth: 2, borderColor: '#7a4420' }]} onPress={() => setCurrentScreen('craft')}>
        <Text style={[styles.menuBtnTitle, { color: '#c8a060' }]}>⛏️ PIXEL CRAFT</Text>
        <Text style={[styles.menuBtnSub, { color: '#a07840' }]}>Mundo 2D · Mina bloques · Construye · Día y noche</Text>
      </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050510' },
  menuContainer: { flex: 1, backgroundColor: '#050510' },
  menuScroll: { alignItems: 'center', padding: 20, paddingTop: 40, paddingBottom: 40 },
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
  dpadBtn: { width: 90, height: 90, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 45, justifyContent: 'center', alignItems: 'center' },
  dpadBtnJump: { width: 112, height: 112, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 56, justifyContent: 'center', alignItems: 'center' },
  dpadText: { color: '#fff', fontSize: 30, fontWeight: 'bold' },
  controlBar: { backgroundColor: 'rgba(0,0,0,0.4)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 15, height: 100 }
});
