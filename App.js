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

function NeonGalaxy({ onExit }) {
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [, setTick] = useState(0);

  const playerX = useRef(width / 2 - PLAYER_SIZE / 2);
  const enemies = useRef([]);
  const lasers = useRef([]);
  const lastFire = useRef(0);
  const lastEnemy = useRef(0);

  const resetGame = () => {
    setScore(0);
    setLives(3);
    setGameOver(false);
    playerX.current = width / 2 - PLAYER_SIZE / 2;
    enemies.current = [];
    lasers.current = [];
  };

  const startGame = () => {
    resetGame();
    setRunning(true);
  };

  useEffect(() => {
    if (!running) return;

    const loop = setInterval(() => {
      const now = Date.now();

      if (now - lastFire.current > 250) {
        lasers.current.push({
          id: now,
          x: playerX.current + PLAYER_SIZE / 2 - LASER_WIDTH / 2,
          y: GAME_HEIGHT - PLAYER_SIZE - 20
        });
        lastFire.current = now;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      const spawnRate = Math.max(300, 1200 - score * 15);
      if (now - lastEnemy.current > spawnRate) {
        enemies.current.push({
          id: now,
          x: Math.random() * (width - ENEMY_SIZE - 20) + 10,
          y: -ENEMY_SIZE,
          speed: 2 + Math.random() * 3 + (score / 100)
        });
        lastEnemy.current = now;
      }

      lasers.current.forEach(l => l.y -= 12);
      lasers.current = lasers.current.filter(l => l.y > -LASER_HEIGHT);

      enemies.current.forEach(e => e.y += e.speed);

      let newScore = score;
      let newLives = lives;

      for (let i = enemies.current.length - 1; i >= 0; i--) {
        const e = enemies.current[i];
        let enemyDestroyed = false;

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
              newScore += 10;
              enemyDestroyed = true;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              break;
            }
          }
        }

        if (enemyDestroyed || e.y > GAME_HEIGHT) {
          enemies.current.splice(i, 1);
        }
      }

      if (newLives <= 0) {
        setRunning(false);
        setGameOver(true);
        setLives(0);
      } else {
        if (newScore !== score) setScore(newScore);
        if (newLives !== lives) setLives(newLives);
      }

      setTick(t => t + 1);
    }, 16);

    return () => clearInterval(loop);
  }, [running, score, lives]);

  const dragStartX = useRef(0);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStartX.current = playerX.current;
      },
      onPanResponderMove: (_, gesture) => {
        let newX = dragStartX.current + gesture.dx;
        newX = Math.max(0, Math.min(newX, width - PLAYER_SIZE - 20));
        playerX.current = newX;
      }
    })
  ).current;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={styles.title}>NEON GALAXY</Text>
        <View style={styles.stats}>
          <Text style={styles.statText}>SCORE: {score}</Text>
          <Text style={styles.statText}>LIVES: {lives}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        <View style={[styles.player, { left: playerX.current, top: GAME_HEIGHT - PLAYER_SIZE - 10 }]} />
        {enemies.current.map(e => (
          <View key={e.id} style={[styles.enemy, { left: e.x, top: e.y }]} />
        ))}
        {lasers.current.map(l => (
          <View key={l.id} style={[styles.laser, { left: l.x, top: l.y }]} />
        ))}
        {!running && (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>{gameOver ? 'GAME OVER' : 'DEFEND THE GALAXY'}</Text>
            <Text style={styles.overlaySub}>Drag to move. Auto-fire enabled.</Text>
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

  const playerY = useRef(GAME_HEIGHT - CR_GROUND_HEIGHT - CR_PLAYER_SIZE);
  const velocityY = useRef(0);
  const obstacles = useRef([]);
  const lastObstacle = useRef(0);
  const scoreRef = useRef(0);

  const resetGame = () => {
    setScore(0);
    scoreRef.current = 0;
    setGameOver(false);
    playerY.current = GAME_HEIGHT - CR_GROUND_HEIGHT - CR_PLAYER_SIZE;
    velocityY.current = 0;
    obstacles.current = [];
  };

  const startGame = () => {
    resetGame();
    setRunning(true);
  };

  const jump = () => {
    if (!running) return;
    if (playerY.current >= GAME_HEIGHT - CR_GROUND_HEIGHT - CR_PLAYER_SIZE) {
      velocityY.current = CR_JUMP_FORCE;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  useEffect(() => {
    if (!running) return;

    const loop = setInterval(() => {
      const now = Date.now();

      velocityY.current += CR_GRAVITY;
      playerY.current += velocityY.current;

      const groundY = GAME_HEIGHT - CR_GROUND_HEIGHT - CR_PLAYER_SIZE;
      if (playerY.current >= groundY) {
        playerY.current = groundY;
        velocityY.current = 0;
      }

      const spawnRate = Math.max(800, 2000 - scoreRef.current * 20);
      if (now - lastObstacle.current > spawnRate) {
        const obsHeight = 30 + Math.random() * 50;
        obstacles.current.push({
          id: now,
          x: width,
          y: GAME_HEIGHT - CR_GROUND_HEIGHT - obsHeight,
          width: CR_OBSTACLE_WIDTH,
          height: obsHeight,
          passed: false
        });
        lastObstacle.current = now;
      }

      let hit = false;
      const playerRect = {
        left: 50,
        right: 50 + CR_PLAYER_SIZE,
        top: playerY.current,
        bottom: playerY.current + CR_PLAYER_SIZE
      };

      for (let i = obstacles.current.length - 1; i >= 0; i--) {
        const obs = obstacles.current[i];
        obs.x -= 6 + (scoreRef.current / 100);

        const obsRect = {
          left: obs.x,
          right: obs.x + obs.width,
          top: obs.y,
          bottom: obs.y + obs.height
        };

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
        }

        if (obs.x + obs.width < 0) {
          obstacles.current.splice(i, 1);
        }
      }

      if (hit) {
        setRunning(false);
        setGameOver(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }

      setTick(t => t + 1);
    }, 16);

    return () => clearInterval(loop);
  }, [running]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.backBtn}><Text style={styles.backText}>← BACK</Text></Pressable>
        <Text style={styles.title}>CYBER RUN</Text>
        <View style={styles.stats}>
          <Text style={styles.statText}>SCORE: {score}</Text>
        </View>
      </View>

      <Pressable style={styles.gameArea} onPress={jump}>
        <View style={[styles.ground, { height: CR_GROUND_HEIGHT }]} />
        <View style={[styles.crPlayer, { left: 50, top: playerY.current }]} />
        {obstacles.current.map(obs => (
          <View key={obs.id} style={[styles.crObstacle, { left: obs.x, top: obs.y, width: obs.width, height: obs.height }]} />
        ))}
        {!running && (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>{gameOver ? 'CRASHED' : 'CYBER RUN'}</Text>
            <Text style={styles.overlaySub}>Tap screen to jump.</Text>
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

      <View style={[styles.gameArea, { backgroundColor: bgColor, borderColor: '#fff' }]}>
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
          {/* Projectiles */}
          {projectiles.current.map((proj, i) => proj.active && (
            <View key={`proj${i}`} style={{ position: 'absolute', left: proj.x, top: proj.y, width: proj.w, height: proj.h, backgroundColor: '#ff4500', borderRadius: 5 }} />
          ))}
          {/* Player */}
          <Text style={{ position: 'absolute', left: pRef.current.x, top: pRef.current.y - 5, fontSize: 30, opacity: invincible ? 0.5 : 1, transform: [{scaleX: pRef.current.facingRight ? 1 : -1}] }}>
            {hasGun ? '🤠' : '😎'}
          </Text>
        </View>

        {/* On-Screen Controls */}
        {running && (
          <View style={styles.dpadContainer} pointerEvents="box-none">
            <View style={styles.dpadLeftRight} pointerEvents="box-none">
              <View 
                onTouchStart={() => keys.current.left = true} 
                onTouchEnd={() => keys.current.left = false}
                style={styles.dpadBtn}><Text style={styles.dpadText}>◀</Text></View>
              <View 
                onTouchStart={() => keys.current.right = true} 
                onTouchEnd={() => keys.current.right = false}
                style={styles.dpadBtn}><Text style={styles.dpadText}>▶</Text></View>
            </View>
            <View style={{flexDirection: 'row', gap: 10}} pointerEvents="box-none">
              {hasGun && <View onTouchStart={shoot} style={[styles.dpadBtnJump, {backgroundColor: 'rgba(255,69,0,0.5)'}]}><Text style={styles.dpadText}>🔥</Text></View>}
              <View onTouchStart={jump} style={styles.dpadBtnJump}><Text style={styles.dpadText}>JUMP</Text></View>
            </View>
          </View>
        )}

        {!running && (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>{gameWon ? 'YOU WIN!' : gameOver ? 'GAME OVER' : 'PIXEL QUEST'}</Text>
            <Text style={styles.overlaySub}>{gameWon ? 'All 10 worlds cleared!' : 'Reach the green pillar. Grab stars for power.'}</Text>
            <View style={{flexDirection: 'row', gap: 20}}>
              <Pressable style={styles.btn} onPress={startGame}><Text style={styles.btnText}>{gameOver || gameWon ? 'RESTART' : 'START'}</Text></Pressable>
              {(!gameOver && !gameWon) && <Pressable style={[styles.btn, {backgroundColor: '#ffd700'}]} onPress={loadGame}><Text style={styles.btnText}>LOAD</Text></Pressable>}
            </View>
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
  dpadText: { color: '#fff', fontSize: 24, fontWeight: 'bold' }
});
