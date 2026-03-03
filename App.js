import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
      }

      // Spawn regular enemy
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

        // Hit by laser
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
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        if (coin.x + coin.size < 0) { coins.current.splice(i, 1); }
      }

      if (hit) {
        if (scoreRef.current > highScore.current) { highScore.current = scoreRef.current; }
        setRunning(false);
        setGameOver(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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
    const GROUND_Y = GAME_HEIGHT - 60;
    const PLATFORM_H = 20;

    const chunks = {
      flat: (startX, currentLvl) => {
        const width = 400;
        const platforms = [{ x: startX, y: GROUND_Y, w: width, h: PLATFORM_H }];
        const enemies = [];
        if (currentLvl >= 3) {
          enemies.push({ x: startX + 200, y: GROUND_Y - 40, w: 40, h: 40, vx: 2 + (currentLvl * 0.1), startX: startX + 200, range: 100, active: true });
        }
        return { platforms, enemies, powerups: [], width };
      },
      pit: (startX, currentLvl) => {
        const width = 500;
        const platforms = [
          { x: startX, y: GROUND_Y, w: 150, h: PLATFORM_H },
          { x: startX + 200, y: GROUND_Y - 80, w: 100, h: PLATFORM_H },
          { x: startX + 350, y: GROUND_Y, w: 150, h: PLATFORM_H }
        ];
        return { platforms, enemies: [], powerups: [], width };
      },
      staircase: (startX, currentLvl) => {
        const width = 600;
        const platforms = [
          { x: startX, y: GROUND_Y, w: 100, h: PLATFORM_H },
          { x: startX + 150, y: GROUND_Y - 50, w: 100, h: PLATFORM_H },
          { x: startX + 300, y: GROUND_Y - 100, w: 100, h: PLATFORM_H },
          { x: startX + 450, y: GROUND_Y - 50, w: 100, h: PLATFORM_H },
          { x: startX + 550, y: GROUND_Y, w: 50, h: PLATFORM_H }
        ];
        const powerups = currentLvl >= 4 ? [{ x: startX + 335, y: GROUND_Y - 140, w: 30, h: 30, active: true }] : [];
        return { platforms, enemies: [], powerups, width };
      },
      enemyPatrol: (startX, currentLvl) => {
        const width = 600;
        const platforms = [{ x: startX, y: GROUND_Y, w: width, h: PLATFORM_H }];
        const enemies = [{ x: startX + 300, y: GROUND_Y - 40, w: 40, h: 40, vx: 2 + (currentLvl * 0.2), startX: startX + 300, range: 150, active: true }];
        if (currentLvl >= 6) {
          enemies.push({ x: startX + 100, y: GROUND_Y - 40, w: 40, h: 40, vx: -3, startX: startX + 100, range: 80, active: true });
        }
        return { platforms, enemies, powerups: [], width };
      },
      highPlatform: (startX, currentLvl) => {
        const width = 500;
        const platforms = [
          { x: startX, y: GROUND_Y, w: width, h: PLATFORM_H },
          { x: startX + 150, y: GROUND_Y - 120, w: 200, h: PLATFORM_H }
        ];
        const powerups = [{ x: startX + 235, y: GROUND_Y - 160, w: 30, h: 30, active: true }];
        const enemies = currentLvl >= 5 ? [{ x: startX + 250, y: GROUND_Y - 40, w: 40, h: 40, vx: 3, startX: startX + 250, range: 100, active: true }] : [];
        return { platforms, enemies, powerups, width };
      },
      movingPlatforms: (startX, currentLvl) => {
        const width = 700;
        const platforms = [
          { x: startX, y: GROUND_Y, w: 100, h: PLATFORM_H },
          { x: startX + 200, y: GROUND_Y - 60, w: 80, h: PLATFORM_H },
          { x: startX + 400, y: GROUND_Y - 120, w: 80, h: PLATFORM_H },
          { x: startX + 600, y: GROUND_Y, w: 100, h: PLATFORM_H }
        ];
        const enemies = [{ x: startX + 200, y: GROUND_Y - 100, w: 30, h: 30, vx: 1.5, startX: startX + 200, range: 80, active: true }];
        return { platforms, enemies, powerups: [], width };
      },
      dangerZone: (startX, currentLvl) => {
        const width = 800;
        const platforms = [
          { x: startX, y: GROUND_Y, w: 150, h: PLATFORM_H },
          { x: startX + 250, y: GROUND_Y - 50, w: 50, h: PLATFORM_H },
          { x: startX + 400, y: GROUND_Y - 100, w: 50, h: PLATFORM_H },
          { x: startX + 550, y: GROUND_Y - 50, w: 50, h: PLATFORM_H },
          { x: startX + 700, y: GROUND_Y, w: 100, h: PLATFORM_H }
        ];
        const enemies = [
          { x: startX + 100, y: GROUND_Y - 40, w: 30, h: 30, vx: 2, startX: startX + 50, range: 100, active: true },
          { x: startX + 700, y: GROUND_Y - 40, w: 30, h: 30, vx: -2, startX: startX + 650, range: 50, active: true }
        ];
        const powerups = currentLvl >= 6 ? [{ x: startX + 410, y: GROUND_Y - 140, w: 30, h: 30, active: true }] : [];
        return { platforms, enemies, powerups, width };
      }
    };

    const levelData = { platforms: [], enemies: [], powerups: [], goal: null, length: 0 };
    let currentX = 0;

    const appendChunk = (chunk) => {
      levelData.platforms.push(...chunk.platforms);
      levelData.enemies.push(...chunk.enemies);
      levelData.powerups.push(...chunk.powerups);
      currentX += chunk.width;
    };

    if (lvl === 1) {
      // Nivel 1: Coherente y diseñado a mano (estilo Mario 1-1)
      levelData.length = 2500;
      levelData.platforms.push({ x: 0, y: GAME_HEIGHT - 60, w: 800, h: 60 });
      levelData.platforms.push({ x: 950, y: GAME_HEIGHT - 60, w: 400, h: 60 });
      levelData.platforms.push({ x: 1500, y: GAME_HEIGHT - 60, w: 1000, h: 60 });
      levelData.platforms.push({ x: 400, y: GAME_HEIGHT - 160, w: 120, h: 20 });
      levelData.platforms.push({ x: 600, y: GAME_HEIGHT - 240, w: 120, h: 20 });
      levelData.platforms.push({ x: 1100, y: GAME_HEIGHT - 180, w: 150, h: 20 });
      levelData.enemies.push({ x: 600, y: GAME_HEIGHT - 90, w: 30, h: 30, vx: 2, startX: 500, range: 200, active: true });
      levelData.enemies.push({ x: 1150, y: GAME_HEIGHT - 210, w: 30, h: 30, vx: 1.5, startX: 1100, range: 100, active: true });
      levelData.enemies.push({ x: 1700, y: GAME_HEIGHT - 90, w: 30, h: 30, vx: 2.5, startX: 1600, range: 200, active: true });
      levelData.powerups.push({ x: 650, y: GAME_HEIGHT - 280, w: 20, h: 20, active: true });
      levelData.goal = { x: 2400, y: GAME_HEIGHT - 200, w: 60, h: 140 };
      world.current = levelData;
      return;
    }

    // Niveles 2-10: Generación por chunks
    appendChunk(chunks.flat(currentX, lvl));
    const numChunks = 3 + Math.floor(lvl * 1.5);
    const availableChunks = ['flat', 'pit'];
    if (lvl >= 3) availableChunks.push('staircase', 'enemyPatrol');
    if (lvl >= 4) availableChunks.push('highPlatform');
    if (lvl >= 5) availableChunks.push('movingPlatforms');
    if (lvl >= 7) availableChunks.push('dangerZone');

    for (let i = 0; i < numChunks; i++) {
      const chunkIndex = (lvl + i * 7 + i * i) % availableChunks.length;
      appendChunk(chunks[availableChunks[chunkIndex]](currentX, lvl));
    }

    const endStartX = currentX;
    appendChunk(chunks.flat(currentX, lvl));
    levelData.goal = { x: endStartX + 200, y: GROUND_Y - 80, w: 60, h: 140 };
    levelData.length = currentX;
    
    world.current = levelData;
  };

  const initLevel = (lvl) => {
    setLevel(lvl);
    pRef.current = { x: 50, y: 100, vx: 0, vy: 0, w: PQ_PLAYER_SIZE, h: PQ_PLAYER_SIZE, facingRight: true };
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
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); // Different vibration
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
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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

      <View style={[styles.gameArea, { backgroundColor: bgColor, borderColor: '#fff', marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
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

      {/* D-Pad OUTSIDE game view so it never covers the player */}
      {running && (
        <View style={styles.controlBar}>
          <View style={styles.dpadLeftRight}>
            <View onTouchStart={() => keys.current.left = true} onTouchEnd={() => keys.current.left = false} style={styles.dpadBtn}>
              <Text style={styles.dpadText}>◀</Text>
            </View>
            <View onTouchStart={() => keys.current.right = true} onTouchEnd={() => keys.current.right = false} style={styles.dpadBtn}>
              <Text style={styles.dpadText}>▶</Text>
            </View>
          </View>
          <View style={{flexDirection: 'row', gap: 10}}>
            {hasGun && <View onTouchStart={shoot} style={[styles.dpadBtnJump, {backgroundColor: 'rgba(255,69,0,0.6)'}]}><Text style={styles.dpadText}>🔥</Text></View>}
            <View onTouchStart={jump} style={styles.dpadBtnJump}><Text style={styles.dpadText}>JUMP</Text></View>
          </View>
        </View>
      )}
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

  const handleTargetHit = (targetId, points) => {
    if (ammoRef.current <= 0 || gameStateRef.current !== 'playing') return;
    ammoRef.current -= 1;
    scoreRef.current += points;
    targetsRef.current = targetsRef.current.filter(t => t.id !== targetId);
    setAmmo(ammoRef.current);
    setScore(scoreRef.current);
    setTargets([...targetsRef.current]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
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

      <View style={[styles.gameArea, { backgroundColor: '#070720', borderColor: '#2e1065' }]}>
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

        {/* Targets */}
        {gameState === 'playing' && targets.map(target => (
          <Pressable
            key={target.id}
            onPress={() => handleTargetHit(target.id, target.points)}
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
      </View>
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
  controlBar: { height: 100, backgroundColor: 'rgba(0,0,0,0.4)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 10 }
});
