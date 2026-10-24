import React, { useEffect, useReducer, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AREA_H, AREA_W, Bar, Btn, C, Combo, GameScreen, GridBg, Lives, Overlay, Pill, PlayArea, Starfield,
  alpha, clamp, glow, tglow, hx, lerp, makeStars, overlap, pick, rand, randInt, shuffle,
  uid, useBest, useFX, useForce, useLoop, usePan, useTimeouts,
} from './utils/kit';

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
  const SW = 34, SH = 40, SY = AREA_H - 76;
  const fx = useFX();
  const [best, submitBest] = useBest('neon');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const stars = useRef(makeStars(44)).current;
  const initState = () => ({
    x: AREA_W / 2, tx: AREA_W / 2, score: 0, lives: 3, shield: 0, weapon: 1, fireT: 0,
    enemies: [], bullets: [], eb: [], items: [], wave: 0, queue: [], spawnT: 0, gap: 0,
    banner: null, combo: 0, comboT: 0, boss: null, t: 0, inv: 0, kills: 0,
  });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const ENEMY = {
    drone: { hp: 1, w: 34, h: 34, vy: 95, pts: 10, e: '👾', c: C.pink },
    zig: { hp: 2, w: 34, h: 34, vy: 80, pts: 20, e: '🛸', c: C.cyan },
    tank: { hp: 6, w: 44, h: 44, vy: 42, pts: 50, e: '🤖', c: C.orange },
    kami: { hp: 1, w: 30, h: 30, vy: 210, pts: 30, e: '💀', c: C.red },
  };

  const nextWave = s => {
    s.wave += 1;
    s.gap = 0;
    if (s.wave % 5 === 0) {
      s.banner = { text: `⚠ JEFE · OLEADA ${s.wave}`, t: 2 };
      const hp = 28 + s.wave * 5;
      s.boss = { x: AREA_W / 2 - 40, y: -90, w: 80, h: 76, hp, max: hp, t: 0, fire: 1.5, e: '👽' };
      s.queue = [];
    } else {
      s.banner = { text: `OLEADA ${s.wave}`, t: 1.6 };
      const n = 6 + s.wave * 2;
      const q = [];
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        let type = 'drone';
        if (s.wave >= 2 && r < 0.3) type = 'zig';
        if (s.wave >= 3 && r > 0.82) type = 'kami';
        if (s.wave >= 4 && r > 0.92) type = 'tank';
        q.push(type);
      }
      s.queue = q;
      s.spawnT = 1.2;
    }
  };

  const start = () => {
    fx.clear();
    g.current = initState();
    nextWave(g.current);
    setPhase('play');
  };

  const dropItem = (s, x, y, force) => {
    if (!force && Math.random() > 0.13) return;
    const r = Math.random();
    const type = r < 0.38 ? 'W' : r < 0.62 ? 'S' : r < 0.82 ? 'H' : 'B';
    s.items.push({ id: uid(), x, y, type });
  };

  const hurtPlayer = s => {
    if (s.inv > 0) return;
    if (s.shield > 0) {
      s.shield -= 1; s.inv = 0.8;
      fx.ring(s.x, SY, C.cyan, 60); fx.shake(4); hx.hit();
      return;
    }
    s.lives -= 1; s.inv = 1.6; s.weapon = Math.max(1, s.weapon - 1);
    s.combo = 0;
    fx.burst(s.x, SY, C.red, 18, 220); fx.shake(9); fx.flash(C.red, 0.3); hx.bad();
    if (s.lives <= 0) {
      hx.die();
      const isNew = submitBest(s.score);
      setRes({ isNew });
      setPhase('over');
    }
  };

  const killEnemy = (s, e, def) => {
    s.combo += 1; s.comboT = 2; s.kills += 1;
    const mult = Math.min(8, 1 + Math.floor(s.combo / 4));
    const pts = (def ? def.pts : 10) * mult;
    s.score += pts;
    fx.burst(e.x + e.w / 2, e.y + e.h / 2, def ? def.c : C.pink, 14, 200);
    fx.pop(e.x + e.w / 2, e.y, `+${pts}`, mult > 1 ? C.amber : C.text, 15);
    hx.tap();
    dropItem(s, e.x + e.w / 2, e.y + e.h / 2, def && def.hp >= 6);
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (phase !== 'play') return;
    s.t += dt;
    s.inv = Math.max(0, s.inv - dt);
    s.x += (s.tx - s.x) * Math.min(1, dt * 16);
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    if (s.comboT > 0) { s.comboT -= dt; if (s.comboT <= 0) s.combo = 0; }

    // disparo automático
    s.fireT -= dt;
    if (s.fireT <= 0) {
      s.fireT = s.weapon >= 3 ? 0.19 : 0.23;
      const b = (dx, vx) => s.bullets.push({ id: uid(), x: s.x + dx, y: SY - 8, vx, vy: -560 });
      if (s.weapon === 1) b(0, 0);
      else if (s.weapon === 2) { b(-9, 0); b(9, 0); }
      else { b(0, 0); b(-12, -90); b(12, 90); }
    }

    // spawns
    if (s.queue.length) {
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        const type = s.queue.shift();
        const d = ENEMY[type];
        s.enemies.push({ id: uid(), type, x: rand(10, AREA_W - d.w - 10), y: -d.h, w: d.w, h: d.h, hp: d.hp, vy: d.vy + s.wave * 3, ph: Math.random() * 6, fire: rand(0.8, 2), bx: 0 });
        s.spawnT = Math.max(0.28, 0.75 - s.wave * 0.03);
      }
    }
    if (s.boss) {
      const bs = s.boss;
      bs.t += dt;
      bs.y = Math.min(54, bs.y + 60 * dt);
      bs.x = AREA_W / 2 - bs.w / 2 + Math.sin(bs.t * 1.1) * (AREA_W / 2 - bs.w / 2 - 12);
      bs.fire -= dt;
      if (bs.fire <= 0 && bs.y >= 50) {
        bs.fire = Math.max(0.7, 1.3 - s.wave * 0.03);
        const n = 3 + Math.min(4, Math.floor(s.wave / 5));
        for (let i = 0; i < n; i++) {
          const a = Math.PI / 2 + (i - (n - 1) / 2) * 0.28;
          s.eb.push({ id: uid(), x: bs.x + bs.w / 2, y: bs.y + bs.h, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170, r: 5 });
        }
      }
    }
    // mover enemigos
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i];
      e.y += e.vy * dt;
      if (e.type === 'zig') e.x += Math.sin(s.t * 3 + e.ph) * 90 * dt;
      if (e.type === 'kami' && e.y > 20) e.x += clamp(s.x - (e.x + e.w / 2), -1, 1) * 120 * dt;
      if (e.type === 'tank') {
        e.fire -= dt;
        if (e.fire <= 0) { e.fire = 1.7; s.eb.push({ id: uid(), x: e.x + e.w / 2, y: e.y + e.h, vx: 0, vy: 210, r: 5 }); }
      }
      e.x = clamp(e.x, 0, AREA_W - e.w);
      if (e.y > AREA_H + 10) { s.enemies.splice(i, 1); s.combo = 0; }
    }
    // balas
    s.bullets.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; });
    s.bullets = s.bullets.filter(b => b.y > -20 && b.x > -10 && b.x < AREA_W + 10);
    s.eb.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; });
    s.eb = s.eb.filter(b => b.y < AREA_H + 10 && b.x > -10 && b.x < AREA_W + 10);
    s.items.forEach(it => { it.y += 90 * dt; });
    s.items = s.items.filter(it => it.y < AREA_H + 20);

    // balas jugador vs enemigos / jefe
    for (let j = s.bullets.length - 1; j >= 0; j--) {
      const b = s.bullets[j];
      let used = false;
      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        if (b.x > e.x && b.x < e.x + e.w && b.y > e.y && b.y < e.y + e.h) {
          e.hp -= 1; used = true;
          fx.burst(b.x, b.y, C.cyan, 3, 90, 0.25, 3);
          if (e.hp <= 0) { killEnemy(s, e, ENEMY[e.type]); s.enemies.splice(i, 1); }
          break;
        }
      }
      if (!used && s.boss) {
        const bs = s.boss;
        if (b.x > bs.x && b.x < bs.x + bs.w && b.y > bs.y && b.y < bs.y + bs.h) {
          bs.hp -= 1; used = true;
          fx.burst(b.x, b.y, C.amber, 3, 100, 0.25, 3);
          if (bs.hp <= 0) {
            s.combo += 5; s.comboT = 2;
            s.score += 500 + s.wave * 50;
            fx.burst(bs.x + bs.w / 2, bs.y + bs.h / 2, C.amber, 40, 320, 0.9, 7);
            fx.ring(bs.x + bs.w / 2, bs.y + bs.h / 2, C.amber, 120);
            fx.pop(bs.x + bs.w / 2, bs.y, `JEFE +${500 + s.wave * 50}`, C.amber, 20);
            fx.shake(12, 0.5); fx.flash('#ffffff', 0.4); hx.win();
            dropItem(s, bs.x + bs.w / 2, bs.y + bs.h / 2, true);
            dropItem(s, bs.x + 10, bs.y + bs.h / 2, true);
            s.eb = [];
            s.boss = null;
          }
        }
      }
      if (used) s.bullets.splice(j, 1);
    }
    // jugador vs enemigos / balas / items
    const me = { x: s.x - SW * 0.3, y: SY - SH * 0.3, w: SW * 0.6, h: SH * 0.7 };
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i];
      if (overlap(me, e)) { fx.burst(e.x + e.w / 2, e.y + e.h / 2, C.red, 10, 160); s.enemies.splice(i, 1); hurtPlayer(s); }
    }
    if (s.boss && overlap(me, s.boss)) hurtPlayer(s);
    for (let i = s.eb.length - 1; i >= 0; i--) {
      const b = s.eb[i];
      if (overlap(me, { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 })) { s.eb.splice(i, 1); hurtPlayer(s); }
    }
    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i];
      if (overlap(me, { x: it.x - 14, y: it.y - 14, w: 28, h: 28 })) {
        s.items.splice(i, 1);
        hx.good();
        if (it.type === 'W') { s.weapon = Math.min(3, s.weapon + 1); fx.pop(it.x, it.y, 'ARMA +', C.amber, 16); }
        if (it.type === 'S') { s.shield = Math.min(3, s.shield + 1); fx.pop(it.x, it.y, 'ESCUDO', C.cyan, 16); }
        if (it.type === 'H') { s.lives = Math.min(5, s.lives + 1); fx.pop(it.x, it.y, '+1 VIDA', C.red, 16); }
        if (it.type === 'B') {
          fx.ring(s.x, SY, C.orange, 260); fx.flash(C.orange, 0.35); fx.shake(8);
          s.eb = [];
          s.enemies.forEach(e => { e.hp -= 4; });
          for (let k = s.enemies.length - 1; k >= 0; k--) if (s.enemies[k].hp <= 0) { killEnemy(s, s.enemies[k], ENEMY[s.enemies[k].type]); s.enemies.splice(k, 1); }
          if (s.boss) s.boss.hp -= 12;
        }
      }
    }
    // siguiente oleada
    if (!s.queue.length && !s.enemies.length && !s.boss) {
      s.gap += dt;
      if (s.gap > 1.2) { s.score += 100 * s.wave; fx.pop(AREA_W / 2, AREA_H / 2 - 40, `OLEADA SUPERADA +${100 * s.wave}`, C.lime, 16); nextWave(s); }
    }
  });

  const pan = usePan(fx, {
    down: x => { g.current.tx = clamp(x, SW / 2, AREA_W - SW / 2); },
    move: x => { g.current.tx = clamp(x, SW / 2, AREA_W - SW / 2); },
  });

  const s = g.current;
  const mult = Math.min(8, 1 + Math.floor(s.combo / 4));
  return (
    <GameScreen title="NEON GALAXY" emoji="🚀" accent={C.cyan} onExit={onExit} score={s.score} best={best}
      hud={<>
        <Lives n={s.lives} max={Math.max(3, s.lives)} />
        <Text style={{ color: C.cyan, fontWeight: '800', fontSize: 12 }}>{s.shield > 0 ? `🛡️×${s.shield}  ` : ''}⚡ Nv.{s.weapon}</Text>
        <View style={{ minWidth: 70, alignItems: 'flex-end' }}>{mult > 1 ? <Combo n={mult} /> : <Text style={{ color: C.dim, fontSize: 12 }}>Oleada {s.wave}</Text>}</View>
      </>}>
      <PlayArea fx={fx} bg="#04040e" {...pan}>
        <Starfield stars={stars} offset={s.t * 70} />
        {s.items.map(it => (
          <View key={it.id} style={{ position: 'absolute', left: it.x - 15, top: it.y - 15, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(C.amber, 0.15), borderWidth: 1, borderColor: C.amber, ...glow(C.amber, 8, 0.7) }}>
            <Text style={{ fontSize: 15 }}>{it.type === 'W' ? '⚡' : it.type === 'S' ? '🛡️' : it.type === 'H' ? '❤️' : '💣'}</Text>
          </View>
        ))}
        {s.enemies.map(e => (
          <Text key={e.id} style={{ position: 'absolute', left: e.x - 4, top: e.y - 2, width: e.w + 8, height: e.h + 4, fontSize: e.w - 4, lineHeight: e.h + 4, textAlign: 'center' }}>{ENEMY[e.type].e}</Text>
        ))}
        {s.boss && (
          <View style={{ position: 'absolute', left: s.boss.x, top: s.boss.y, width: s.boss.w, height: s.boss.h, alignItems: 'center' }}>
            <Text style={{ fontSize: 66, lineHeight: 72, ...tglow(C.amber, 16, 0.9) }}>{s.boss.e}</Text>
            <Bar value={s.boss.hp} max={s.boss.max} color={C.red} h={6} w={s.boss.w} />
          </View>
        )}
        {s.bullets.map(b => <View key={b.id} style={{ position: 'absolute', left: b.x - 2.5, top: b.y - 9, width: 5, height: 18, borderRadius: 3, backgroundColor: C.cyan, ...glow(C.cyan, 6, 1) }} />)}
        {s.eb.map(b => <View key={b.id} style={{ position: 'absolute', left: b.x - b.r, top: b.y - b.r, width: b.r * 2, height: b.r * 2, borderRadius: b.r, backgroundColor: C.pink, ...glow(C.pink, 8, 1) }} />)}
        {/* nave */}
        {(s.lives > 0 || phase === 'ready') && (
          <View style={{ position: 'absolute', left: s.x - SW / 2, top: SY - SH / 2, width: SW, height: SH, alignItems: 'center', opacity: s.inv > 0 && Math.floor(s.t * 14) % 2 ? 0.35 : 1 }}>
            <View style={{ width: 0, height: 0, borderLeftWidth: SW / 2, borderRightWidth: SW / 2, borderBottomWidth: SH - 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: C.cyan }} />
            <View style={{ position: 'absolute', top: 14, width: 8, height: 14, borderRadius: 4, backgroundColor: '#06101c' }} />
            <View style={{ width: 8, height: 8 + (Math.floor(s.t * 30) % 3) * 3, marginTop: -2, borderRadius: 4, backgroundColor: C.orange, ...glow(C.orange, 8, 1) }} />
            {s.shield > 0 && <View style={{ position: 'absolute', left: -9, top: -6, width: SW + 18, height: SW + 18, borderRadius: (SW + 18) / 2, borderWidth: 2, borderColor: alpha(C.cyan, 0.8), backgroundColor: alpha(C.cyan, 0.1) }} />}
          </View>
        )}
        {s.banner && <Text style={{ position: 'absolute', top: AREA_H * 0.3, width: AREA_W, textAlign: 'center', color: C.text, fontSize: 24, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow(C.cyan, 12, 1) }}>{s.banner.text}</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🚀" title={phase === 'over' ? 'FIN DEL VIAJE' : 'NEON GALAXY'}
          subtitle={phase === 'over' ? `Llegaste a la oleada ${s.wave}` : 'Defiende la galaxia'}
          score={s.score} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para mover · disparo automático', '⚡ mejora el arma · 🛡️ escudo · ❤️ vida · 💣 bomba', 'Encadena bajas para subir el multiplicador'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

function CyberRun({ onExit }) {
  const HOR = 74, SY = AREA_H - 104;
  const LW = AREA_W * 0.32;
  const fx = useFX();
  const [best, submitBest] = useBest('cyber');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({ lane: 1, lx: 1, jump: 0, slide: 0, t: 0, speed: 0.5, dist: 0, objs: [], next: 0, coins: 0, mag: 0, x2: 0, scroll: 0, score: 0, gx: 0, gy: 0, used: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const px = (lane, z) => AREA_W / 2 + (lane - 1) * LW * (0.16 + 0.84 * z);
  const py = z => HOR + (SY - HOR) * z;
  const sc = z => 0.22 + 0.78 * z;

  const spawnRow = s => {
    const r = Math.random();
    const z = 0.02;
    const free = randInt(0, 2);
    if (r < 0.30) { // vagones: deja un carril libre
      for (let l = 0; l < 3; l++) if (l !== free) s.objs.push({ id: uid(), k: 'wall', lane: l, z });
      s.objs.push({ id: uid(), k: 'coin', lane: free, z }); s.objs.push({ id: uid(), k: 'coin', lane: free, z: z - 0.08 }); s.objs.push({ id: uid(), k: 'coin', lane: free, z: z - 0.16 });
    } else if (r < 0.48) { for (let l = 0; l < 3; l++) s.objs.push({ id: uid(), k: 'low', lane: l, z }); } // saltar
    else if (r < 0.64) { for (let l = 0; l < 3; l++) s.objs.push({ id: uid(), k: 'high', lane: l, z }); } // deslizar
    else if (r < 0.74) { s.objs.push({ id: uid(), k: Math.random() < 0.5 ? 'low' : 'high', lane: free, z }); const o = (free + 1 + randInt(0, 1)) % 3; s.objs.push({ id: uid(), k: 'wall', lane: o, z }); }
    else if (r < 0.80) s.objs.push({ id: uid(), k: Math.random() < 0.5 ? 'mag' : 'x2', lane: free, z });
    else { for (let i = 0; i < 6; i++) s.objs.push({ id: uid(), k: 'coin', lane: free, z: z - i * 0.07 }); }
  };

  const crash = s => {
    fx.burst(px(s.lane, 1), SY, C.pink, 28, 300, 0.8, 6); fx.shake(12, 0.4); fx.flash(C.red, 0.35); hx.die();
    setRes({ isNew: submitBest(s.score) });
    setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.speed = Math.min(1.05, 0.5 + s.t * 0.009);
    s.dist += s.speed * dt * 60;
    s.scroll += s.speed * dt;
    s.lx += (s.lane - s.lx) * Math.min(1, dt * 16);
    if (s.jump > 0) s.jump = Math.max(0, s.jump - dt);
    if (s.slide > 0) s.slide = Math.max(0, s.slide - dt);
    if (s.mag > 0) s.mag -= dt;
    if (s.x2 > 0) s.x2 -= dt;
    s.next -= s.speed * dt;
    if (s.next <= 0) { spawnRow(s); s.next = Math.max(0.3, 0.55 - s.t * 0.002); }
    s.objs.forEach(o => { o.z += s.speed * dt; });
    s.objs = s.objs.filter(o => o.z < 1.2 && !o.gone);
    const jumping = s.jump > 0.12;       // en el aire (no al despegar/aterrizar justo)
    const sliding = s.slide > 0.1;
    for (const o of s.objs) {
      if (o.gone) continue;
      const near = o.z > 0.92 && o.z < 1.06;
      if ((o.k === 'coin' || o.k === 'mag' || o.k === 'x2')) {
        const inLane = o.lane === s.lane || (o.k === 'coin' && s.mag > 0 && o.z > 0.8 && o.z < 1.08);
        if (inLane && o.z > 0.9 && o.z < 1.08) {
          o.gone = true; hx.tick();
          const x = px(o.lane, 1);
          if (o.k === 'coin') { s.coins += 1; fx.burst(x, SY - 20, C.amber, 6, 120, 0.35, 3); }
          else { if (o.k === 'mag') { s.mag = 7; fx.pop(x, SY - 50, 'IMÁN', C.cyan, 16); } else { s.x2 = 8; fx.pop(x, SY - 50, 'PUNTOS ×2', C.lime, 16); } fx.ring(x, SY, C.lime, 50); hx.good(); }
        }
        continue;
      }
      if (!near || o.lane !== s.lane) continue;
      if (o.k === 'wall' || (o.k === 'low' && !jumping) || (o.k === 'high' && !sliding)) { crash(s); return; }
    }
    s.score = Math.floor(s.dist / 4 + s.coins * 3) * (s.x2 > 0 ? 2 : 1);
  });

  const pan = usePan(fx, {
    down: () => { const s = g.current; s.used = false; },
    move: (x, y, gs) => {
      const s = g.current;
      if (phase !== 'play' || s.used) return;
      const dx = gs.dx, dy = gs.dy;
      if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy)) { s.lane = clamp(s.lane + (dx > 0 ? 1 : -1), 0, 2); s.used = true; hx.tick(); }
      else if (dy < -26) { if (s.jump <= 0) { s.jump = 0.62; s.slide = 0; hx.tap(); fx.burst(px(s.lane, 1), SY + 10, C.pink, 6, 100, 0.3, 3); } s.used = true; }
      else if (dy > 26) { if (s.slide <= 0) { s.slide = 0.6; s.jump = 0; hx.tap(); } s.used = true; }
    },
    up: (x, y, gs) => {
      const s = g.current;
      if (phase !== 'play' || s.used) return;
      if (Math.abs(gs.dx) < 8 && Math.abs(gs.dy) < 8) { if (s.jump <= 0) { s.jump = 0.62; s.slide = 0; hx.tap(); } }   // un toque = saltar
    },
  });

  const s = g.current;
  const jumpH = s.jump > 0 ? Math.sin((1 - s.jump / 0.62) * Math.PI) * 78 : 0;
  const sliding = s.slide > 0;
  const cx = AREA_W / 2 + (s.lx - 1) * LW;
  const lines = [-1.5, -0.5, 0.5, 1.5];
  return (
    <GameScreen title="CYBER RUN" emoji="🏃" accent={C.pink} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>🪙 <Text style={{ color: C.amber, fontWeight: '800' }}>{s.coins}</Text></Text><Text style={{ color: C.cyan, fontSize: 12, fontWeight: '800' }}>{s.mag > 0 ? `🧲 ${Math.ceil(s.mag)}s  ` : ''}{s.x2 > 0 ? `×2 ${Math.ceil(s.x2)}s` : ''}</Text><Text style={{ color: C.dim, fontSize: 12 }}>{Math.floor(s.dist)} m</Text></>}>
      <PlayArea fx={fx} bg="#07030f" {...pan}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: HOR, backgroundColor: alpha(C.pink, 0.08) }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: HOR - 1, height: 2, backgroundColor: alpha(C.pink, 0.8), ...glow(C.pink, 8, 0.9) }} />
        {/* líneas de carril en perspectiva */}
        {lines.map(b => {
          const x0 = AREA_W / 2 + b * LW * 0.16, x1 = AREA_W / 2 + b * LW;
          const dx = x1 - x0, dy = AREA_H - HOR, len = Math.hypot(dx, dy);
          return <View key={b} style={{ position: 'absolute', left: (x0 + x1) / 2 - 1, top: HOR + dy / 2 - len / 2, width: 2, height: len, backgroundColor: alpha(C.pink, 0.45), transform: [{ rotate: `${Math.atan2(-dx, dy)}rad` }] }} />;
        })}
        {Array.from({ length: 9 }, (_, i) => {
          const z = ((i / 9 + s.scroll * 0.5) % 1);
          const y = py(z * z + 0.001);
          return <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: y, height: 1, backgroundColor: alpha(C.pink, 0.14 + z * 0.1) }} />;
        })}
        {[...s.objs].sort((a, b) => a.z - b.z).map(o => {
          const z = Math.min(1.15, Math.max(0, o.z));
          if (z <= 0.01 || o.gone) return null;
          const x = px(o.lane, z), y = py(z), k = sc(z);
          if (o.k === 'wall') return <View key={o.id} style={{ position: 'absolute', left: x - 34 * k, top: y - 80 * k, width: 68 * k, height: 80 * k, borderRadius: 6 * k, backgroundColor: '#1a1030', borderWidth: 2, borderColor: C.violet, ...glow(C.violet, 10, 0.6) }}><View style={{ margin: 5 * k, height: 8 * k, backgroundColor: alpha(C.cyan, 0.6) }} /></View>;
          if (o.k === 'low') return <View key={o.id} style={{ position: 'absolute', left: x - 30 * k, top: y - 22 * k, width: 60 * k, height: 22 * k, borderRadius: 4, backgroundColor: alpha(C.amber, 0.25), borderWidth: 2, borderColor: C.amber, ...glow(C.amber, 8, 0.6) }} />;
          if (o.k === 'high') return <View key={o.id} style={{ position: 'absolute', left: x - 34 * k, top: y - 70 * k, width: 68 * k, height: 22 * k, borderRadius: 4, backgroundColor: alpha(C.red, 0.28), borderWidth: 2, borderColor: C.red, ...glow(C.red, 8, 0.6) }} />;
          const emo = o.k === 'coin' ? '🪙' : o.k === 'mag' ? '🧲' : '⚡';
          return <Text key={o.id} style={{ position: 'absolute', left: x - 14 * k, top: y - 40 * k, fontSize: 26 * k, lineHeight: 30 * k }}>{emo}</Text>;
        })}
        {/* sombra + corredor */}
        <View style={{ position: 'absolute', left: cx - 18, top: SY + 4, width: 36, height: 9, borderRadius: 5, backgroundColor: '#000', opacity: 0.5 - jumpH / 260 }} />
        <View style={{ position: 'absolute', left: cx - 14, top: SY - (sliding ? 30 : 56) - jumpH, width: 28, height: sliding ? 30 : 56, alignItems: 'center' }}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#ffd9c2' }}><View style={{ marginTop: 5, marginHorizontal: 2, height: 5, borderRadius: 3, backgroundColor: C.pink, ...glow(C.pink, 6, 1) }} /></View>
          <View style={{ width: 26, flex: 1, marginTop: 1, borderRadius: 9, backgroundColor: C.pink, borderWidth: 2, borderColor: '#fff', ...glow(C.pink, 14, 0.9) }} />
          {s.mag > 0 && <View style={{ position: 'absolute', left: -20, top: -10, width: 68, height: 68, borderRadius: 34, borderWidth: 1, borderColor: alpha(C.cyan, 0.5) }} />}
        </View>
        {phase === 'play' && s.t < 4 && <Text pointerEvents="none" style={{ position: 'absolute', bottom: 8, width: AREA_W, textAlign: 'center', color: alpha('#ffffff', 0.4), fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>◀ ▶ CARRIL · ▲ SALTAR · ▼ DESLIZAR</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🏃" title={phase === 'over' ? 'SISTEMA CAÍDO' : 'CYBER RUN'}
          subtitle={phase === 'over' ? `${Math.floor(s.dist)} m · ${s.coins} monedas` : 'Corre por la ciudad neón'}
          score={s.score} best={best} isNew={res.isNew} accent={C.pink} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Desliza ◀ ▶ para cambiar de carril', '▲ saltar barreras bajas · ▼ deslizarte bajo las altas', '🧲 imán · ⚡ puntos ×2'] : null} />
      </PlayArea>
    </GameScreen>
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
      case 15:
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

      // ═══════════════════════════════════════════════════════════════
      // WORLD 16 ── PUENTE ROTO  (plataformas alternas cortas 65px)
      // ═══════════════════════════════════════════════════════════════
      case 16:
        ld.platforms.push(
          gnd(0, 180),
          gnd(3900, 500),
          plat(210, 90, 65),  plat(400, 170, 65),  plat(600, 90, 65),
          plat(800, 175, 65), plat(1005, 95, 65),  plat(1210, 180, 65),
          plat(1415, 95, 65), plat(1625, 180, 65), plat(1835, 95, 65),
          plat(2050, 175, 65),plat(2265, 95, 65),  plat(2480, 175, 65),
          plat(2695, 90, 65), plat(2905, 175, 65), plat(3115, 90, 70),
          plat(3340, 80, 200),
        );
        ld.enemies.push(
          enm(100, 80, 5.5),
          enmP(230, 90, 40, 5.5), enmP(620, 90, 40, 6.0),
          enmP(1025, 95, 40, 6.0), enmP(1435, 95, 40, 6.5),
          enmP(1855, 95, 40, 6.5), enmP(2285, 95, 40, 6.5),
          enmP(2715, 90, 40, 6.5), enmP(3360, 80, 90, 6.0),
        );
        ld.powerups.push(star(810, 220), djump(1420, 225), star(2060, 220), djump(2910, 220), life(3365, 115));
        ld.blocks.push(
          qBlock(610, 135, 'doublejump'), qBlock(1215, 225, 'star'),
          qBlock(1840, 140, 'life'), qBlock(2700, 135, 'doublejump'),
        );
        ld.goal = goal(4010, 185);
        ld.length = 4200;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 17 ── TÚNEL OSCURO  (techo bajo + piso, ritmo constante)
      // ═══════════════════════════════════════════════════════════════
      case 17:
        ld.platforms.push(
          gnd(0, 190),
          gnd(4000, 500),
          plat(220, 95, 70),  plat(430, 175, 65),  plat(640, 90, 70),
          plat(850, 180, 65), plat(1065, 90, 70),  plat(1280, 180, 65),
          plat(1495, 90, 70), plat(1710, 175, 65), plat(1930, 90, 70),
          plat(2150, 175, 65),plat(2370, 90, 70),  plat(2595, 175, 65),
          plat(2815, 90, 70), plat(3040, 175, 65), plat(3265, 90, 75),
          plat(3490, 80, 220),
        );
        ld.enemies.push(
          enm(100, 80, 6.0),
          enmP(240, 95, 45, 6.0),  enmP(660, 90, 45, 6.5),
          enmP(1085, 90, 40, 6.5), enmP(1515, 90, 40, 7.0),
          enmP(1950, 90, 40, 7.0), enmP(2390, 90, 40, 7.0),
          enmP(2835, 90, 40, 7.0), enmP(3510, 80, 90, 6.5),
        );
        ld.powerups.push(star(860, 225), djump(1500, 135), star(2155, 220), djump(3045, 220), life(3515, 115));
        ld.blocks.push(
          qBlock(650, 135, 'star'), qBlock(1290, 225, 'doublejump'),
          qBlock(1940, 135, 'life'), qBlock(2820, 135, 'star'),
        );
        ld.goal = goal(4120, 185);
        ld.length = 4300;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 18 ── AVALANCHA  (gaps 130px, plataformas 65-70px)
      // ═══════════════════════════════════════════════════════════════
      case 18:
        ld.platforms.push(
          gnd(0, 170),
          gnd(4100, 500),
          plat(210, 85, 70),  plat(415, 165, 65),  plat(615, 85, 70),
          plat(820, 170, 65), plat(1025, 85, 70),  plat(1235, 170, 65),
          plat(1445, 85, 70), plat(1655, 165, 65), plat(1870, 85, 70),
          plat(2085, 165, 65),plat(2300, 85, 70),  plat(2515, 165, 65),
          plat(2730, 85, 70), plat(2945, 165, 70), plat(3165, 85, 80),
          plat(3390, 80, 230),
        );
        ld.enemies.push(
          enm(100, 75, 6.5),
          enmP(230, 85, 40, 6.5), enmP(635, 85, 40, 7.0),
          enmP(1045, 85, 40, 7.0), enmP(1465, 85, 40, 7.5),
          enmP(1890, 85, 40, 7.5), enmP(2320, 85, 40, 7.5),
          enmP(2750, 85, 40, 7.5), enmP(3410, 80, 95, 7.0),
        );
        ld.powerups.push(star(830, 215), djump(1450, 130), star(2095, 210), djump(2950, 210), life(3415, 115));
        ld.blocks.push(
          qBlock(625, 130, 'doublejump'), qBlock(1240, 215, 'star'),
          qBlock(1875, 130, 'life'), qBlock(2735, 130, 'doublejump'),
        );
        ld.goal = goal(4230, 180);
        ld.length = 4400;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 19 ── ESCALADA EXTREMA  (subida pura, gaps 110px)
      // ═══════════════════════════════════════════════════════════════
      case 19:
        ld.platforms.push(
          gnd(0, 160),
          gnd(4200, 500),
          plat(200, 80, 70),  plat(395, 155, 65),  plat(590, 240, 65),
          plat(780, 155, 65), plat(975, 80, 70),   plat(1175, 200, 65),
          plat(1375, 120, 65),plat(1575, 220, 65), plat(1775, 130, 70),
          plat(1985, 200, 65),plat(2195, 110, 70), plat(2415, 195, 65),
          plat(2630, 105, 70),plat(2850, 185, 65), plat(3075, 95, 75),
          plat(3300, 80, 230),
        );
        ld.enemies.push(
          enm(100, 70, 6.5),
          enmP(215, 80, 40, 7.0),  enmP(605, 240, 40, 7.0),
          enmP(995, 80, 40, 7.5),  enmP(1390, 120, 40, 7.5),
          enmP(1790, 130, 40, 8.0),enmP(2210, 110, 40, 8.0),
          enmP(2645, 105, 40, 8.0),enmP(3315, 80, 95, 7.5),
        );
        ld.powerups.push(star(790, 200), djump(1380, 165), star(1985, 245), djump(2855, 230), life(3320, 115));
        ld.blocks.push(
          qBlock(600, 285, 'doublejump'), qBlock(1185, 245, 'star'),
          qBlock(1785, 175, 'life'), qBlock(2635, 150, 'doublejump'),
        );
        ld.goal = goal(4320, 180);
        ld.length = 4500;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 20 ── INFIERNO DE FUEGO  (enemies 8.0, plataformas 60px)
      // ═══════════════════════════════════════════════════════════════
      case 20:
        ld.platforms.push(
          gnd(0, 160),
          gnd(4300, 500),
          plat(210, 90, 62),  plat(415, 170, 60),  plat(620, 90, 62),
          plat(825, 175, 60), plat(1035, 90, 62),  plat(1250, 175, 60),
          plat(1465, 90, 62), plat(1680, 170, 60), plat(1895, 90, 62),
          plat(2115, 170, 60),plat(2335, 90, 62),  plat(2555, 170, 60),
          plat(2775, 90, 62), plat(2995, 170, 62), plat(3220, 90, 68),
          plat(3445, 80, 240),
        );
        ld.enemies.push(
          enm(100, 70, 7.0),
          enmP(228, 90, 37, 7.5),  enmP(638, 90, 37, 8.0),
          enmP(1053, 90, 37, 8.0), enmP(1483, 90, 37, 8.5),
          enmP(1913, 90, 37, 8.5), enmP(2353, 90, 37, 8.5),
          enmP(2793, 90, 37, 8.5), enmP(3465, 80, 95, 8.0),
        );
        ld.powerups.push(star(835, 220), djump(1470, 135), star(2125, 215), djump(3005, 215), life(3470, 115));
        ld.blocks.push(
          qBlock(630, 135, 'doublejump'), qBlock(1260, 220, 'star'),
          qBlock(1905, 135, 'life'), qBlock(2785, 135, 'doublejump'),
        );
        ld.goal = goal(4420, 180);
        ld.length = 4600;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 21 ── ESPIRAL  (plataformas en zigzag amplio, gaps 115px)
      // ═══════════════════════════════════════════════════════════════
      case 21:
        ld.platforms.push(
          gnd(0, 155),
          gnd(4400, 500),
          plat(200, 80, 60),  plat(380, 200, 60),  plat(560, 85, 60),
          plat(745, 210, 60), plat(935, 90, 60),   plat(1130, 215, 60),
          plat(1330, 95, 60), plat(1535, 215, 60), plat(1740, 95, 60),
          plat(1950, 210, 60),plat(2165, 90, 60),  plat(2375, 205, 60),
          plat(2590, 85, 60), plat(2800, 200, 60), plat(3025, 85, 65),
          plat(3260, 80, 250),
        );
        ld.enemies.push(
          enm(100, 65, 7.5),
          enmP(218, 80, 35, 7.5),  enmP(578, 85, 35, 8.0),
          enmP(953, 90, 35, 8.0),  enmP(1348, 95, 35, 8.5),
          enmP(1758, 95, 35, 8.5), enmP(2183, 90, 35, 9.0),
          enmP(2608, 85, 35, 9.0), enmP(3280, 80, 90, 8.5),
        );
        ld.powerups.push(star(755, 255), djump(1335, 140), star(1955, 255), djump(2805, 245), life(3285, 115));
        ld.blocks.push(
          qBlock(570, 130, 'doublejump'), qBlock(1140, 260, 'star'),
          qBlock(1750, 140, 'life'), qBlock(2595, 130, 'doublejump'),
        );
        ld.goal = goal(4510, 178);
        ld.length = 4700;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 22 ── MURO INFINITO  (pendiente continua de subida)
      // ═══════════════════════════════════════════════════════════════
      case 22:
        ld.platforms.push(
          gnd(0, 150),
          gnd(4500, 500),
          plat(205, 85, 60),  plat(400, 160, 58),  plat(600, 235, 58),
          plat(795, 160, 58), plat(995, 90, 60),   plat(1200, 185, 58),
          plat(1405, 260, 58),plat(1610, 185, 58), plat(1820, 100, 60),
          plat(2035, 195, 58),plat(2250, 270, 58), plat(2465, 195, 58),
          plat(2680, 100, 60),plat(2895, 190, 58), plat(3120, 90, 65),
          plat(3355, 80, 255),
        );
        ld.enemies.push(
          enm(100, 60, 8.0),
          enmP(222, 85, 35, 8.0),  enmP(617, 235, 35, 8.5),
          enmP(1013, 90, 35, 8.5), enmP(1422, 260, 35, 9.0),
          enmP(1838, 100, 35, 9.0),enmP(2268, 270, 35, 9.0),
          enmP(2698, 100, 35, 9.0),enmP(3375, 80, 90, 8.5),
        );
        ld.powerups.push(star(805, 205), djump(1410, 305), star(2045, 240), djump(2905, 235), life(3380, 115));
        ld.blocks.push(
          qBlock(610, 280, 'doublejump'), qBlock(1210, 230, 'star'),
          qBlock(1830, 145, 'life'), qBlock(2690, 145, 'doublejump'),
        );
        ld.goal = goal(4610, 175);
        ld.length = 4800;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 23 ── RAIN OF DEATH  (muchos enemigos, plataformas 58px)
      // ═══════════════════════════════════════════════════════════════
      case 23:
        ld.platforms.push(
          gnd(0, 145),
          gnd(4600, 500),
          plat(210, 90, 58),  plat(415, 170, 56),  plat(625, 90, 58),
          plat(840, 175, 56), plat(1055, 90, 58),  plat(1275, 175, 56),
          plat(1495, 90, 58), plat(1715, 170, 56), plat(1935, 90, 58),
          plat(2160, 170, 56),plat(2385, 90, 58),  plat(2610, 170, 56),
          plat(2835, 90, 58), plat(3060, 170, 60), plat(3290, 90, 65),
          plat(3520, 80, 255),
        );
        ld.enemies.push(
          enm(100, 55, 8.5),
          enmP(227, 90, 33, 8.5),  enmP(642, 90, 33, 9.0),
          enmP(1072, 90, 33, 9.0), enmP(1512, 90, 33, 9.5),
          enmP(1952, 90, 33, 9.5), enmP(2402, 90, 33, 9.5),
          enmP(2852, 90, 33, 9.5), enmP(3308, 90, 33, 9.0),
          enmP(3540, 80, 90, 9.0),
        );
        ld.powerups.push(star(850, 220), djump(1500, 135), star(2170, 215), djump(3070, 215), life(3545, 115));
        ld.blocks.push(
          qBlock(635, 135, 'doublejump'), qBlock(1285, 220, 'star'),
          qBlock(1945, 135, 'life'), qBlock(2845, 135, 'doublejump'),
        );
        ld.goal = goal(4710, 175);
        ld.length = 4900;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 24 ── CAÍDA LIBRE  (plataformas super angostas 55px)
      // ═══════════════════════════════════════════════════════════════
      case 24:
        ld.platforms.push(
          gnd(0, 140),
          gnd(4700, 500),
          plat(215, 90, 56),  plat(430, 170, 55),  plat(645, 90, 56),
          plat(860, 175, 55), plat(1075, 90, 56),  plat(1295, 175, 55),
          plat(1515, 90, 56), plat(1735, 170, 55), plat(1955, 90, 56),
          plat(2180, 170, 55),plat(2405, 90, 56),  plat(2630, 170, 55),
          plat(2855, 90, 56), plat(3080, 170, 58), plat(3310, 90, 63),
          plat(3545, 80, 260),
        );
        ld.enemies.push(
          enm(100, 50, 9.0),
          enmP(232, 90, 31, 9.0),  enmP(662, 90, 31, 9.5),
          enmP(1092, 90, 31, 9.5), enmP(1532, 90, 31, 10.0),
          enmP(1972, 90, 31, 10.0),enmP(2422, 90, 31, 10.0),
          enmP(2872, 90, 31, 10.0),enmP(3565, 80, 90, 9.5),
        );
        ld.powerups.push(star(870, 220), djump(1520, 135), star(2190, 215), djump(3090, 215), life(3570, 115));
        ld.blocks.push(
          qBlock(655, 135, 'doublejump'), qBlock(1305, 220, 'star'),
          qBlock(1965, 135, 'life'), qBlock(2865, 135, 'doublejump'),
        );
        ld.goal = goal(4810, 172);
        ld.length = 5000;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 25 ── EL UMBRAL  (punto medio de la expansión, 10+ enemies)
      // ═══════════════════════════════════════════════════════════════
      case 25:
        ld.platforms.push(
          gnd(0, 135),
          gnd(4800, 500),
          plat(220, 90, 55),  plat(445, 175, 55),  plat(665, 90, 55),
          plat(890, 175, 55), plat(1115, 90, 55),  plat(1345, 175, 55),
          plat(1575, 90, 55), plat(1805, 175, 55), plat(2035, 90, 55),
          plat(2270, 175, 55),plat(2505, 90, 55),  plat(2740, 175, 55),
          plat(2975, 90, 55), plat(3210, 170, 60), plat(3450, 90, 65),
          plat(3685, 80, 265),
        );
        ld.enemies.push(
          enm(100, 50, 9.5),
          enmP(238, 90, 30, 9.5),  enmP(682, 90, 30, 10.0),
          enmP(1132, 90, 30, 10.0),enmP(1592, 90, 30, 10.5),
          enmP(2052, 90, 30, 10.5),enmP(2522, 90, 30, 10.5),
          enmP(2992, 90, 30, 10.5),enmP(3470, 90, 30, 10.0),
          enmP(3705, 80, 90, 10.0),
        );
        ld.powerups.push(
          star(900, 220), djump(1350, 220), star(2045, 135),
          djump(2745, 220), star(3220, 215), life(3710, 115),
        );
        ld.blocks.push(
          qBlock(675, 135, 'doublejump'), qBlock(1355, 220, 'star'),
          qBlock(2045, 135, 'life'), qBlock(2985, 135, 'doublejump'),
          qBlock(3460, 135, 'star'),
        );
        ld.goal = goal(4920, 170);
        ld.length = 5100;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 26 ── TORMENTA ELÉCTRICA  (plataformas 53px, gaps 130px)
      // ═══════════════════════════════════════════════════════════════
      case 26:
        ld.platforms.push(
          gnd(0, 130),
          gnd(4900, 500),
          plat(220, 90, 54),  plat(455, 175, 52),  plat(685, 90, 54),
          plat(920, 175, 52), plat(1155, 90, 54),  plat(1395, 175, 52),
          plat(1635, 90, 54), plat(1875, 175, 52), plat(2115, 90, 54),
          plat(2360, 175, 52),plat(2605, 90, 54),  plat(2850, 175, 52),
          plat(3095, 90, 54), plat(3345, 170, 58), plat(3590, 90, 63),
          plat(3835, 80, 265),
        );
        ld.enemies.push(
          enm(100, 45, 10.0),
          enmP(237, 90, 29, 10.0), enmP(702, 90, 29, 10.5),
          enmP(1172, 90, 29, 10.5),enmP(1652, 90, 29, 11.0),
          enmP(2132, 90, 29, 11.0),enmP(2622, 90, 29, 11.0),
          enmP(3112, 90, 29, 11.0),enmP(3855, 80, 90, 10.5),
        );
        ld.powerups.push(star(930, 220), djump(1640, 135), star(2370, 220), djump(3105, 135), life(3860, 115));
        ld.blocks.push(
          qBlock(695, 135, 'star'), qBlock(1405, 220, 'doublejump'),
          qBlock(2125, 135, 'life'), qBlock(2860, 220, 'doublejump'),
        );
        ld.goal = goal(5020, 168);
        ld.length = 5200;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 27 ── CAVERNA DEL DRAGÓN  (10 enemies, plataformas 52px)
      // ═══════════════════════════════════════════════════════════════
      case 27:
        ld.platforms.push(
          gnd(0, 125),
          gnd(5000, 500),
          plat(225, 90, 52),  plat(465, 175, 52),  plat(705, 90, 52),
          plat(950, 175, 52), plat(1195, 90, 52),  plat(1445, 175, 52),
          plat(1695, 90, 52), plat(1945, 175, 52), plat(2195, 90, 52),
          plat(2450, 175, 52),plat(2705, 90, 52),  plat(2960, 175, 52),
          plat(3215, 90, 52), plat(3475, 170, 57), plat(3730, 90, 62),
          plat(3985, 80, 265),
        );
        ld.enemies.push(
          enm(100, 42, 10.5),
          enmP(242, 90, 27, 10.5),enmP(722, 90, 27, 11.0),
          enmP(1212, 90, 27, 11.0),enmP(1712, 90, 27, 11.5),
          enmP(2212, 90, 27, 11.5),enmP(2722, 90, 27, 11.5),
          enmP(3232, 90, 27, 11.5),enmP(3750, 90, 27, 11.0),
          enmP(4005, 80, 90, 11.0),
        );
        ld.powerups.push(star(960, 220), djump(1700, 135), star(2460, 220), djump(2970, 220), life(4010, 115));
        ld.blocks.push(
          qBlock(715, 135, 'doublejump'), qBlock(1455, 220, 'star'),
          qBlock(2205, 135, 'life'), qBlock(3225, 135, 'doublejump'),
        );
        ld.goal = goal(5120, 165);
        ld.length = 5300;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 28 ── EL VACÍO  (plataformas 50px, gaps extremos 140px)
      // ═══════════════════════════════════════════════════════════════
      case 28:
        ld.platforms.push(
          gnd(0, 120),
          gnd(5100, 500),
          plat(230, 90, 50),  plat(480, 175, 50),  plat(730, 90, 50),
          plat(985, 175, 50), plat(1240, 90, 50),  plat(1500, 175, 50),
          plat(1760, 90, 50), plat(2020, 175, 50), plat(2280, 90, 50),
          plat(2545, 175, 50),plat(2810, 90, 50),  plat(3075, 175, 50),
          plat(3340, 90, 50), plat(3610, 170, 55), plat(3875, 90, 60),
          plat(4140, 80, 270),
        );
        ld.enemies.push(
          enm(100, 38, 11.0),
          enmP(248, 90, 25, 11.0),enmP(748, 90, 25, 11.5),
          enmP(1258, 90, 25, 11.5),enmP(1778, 90, 25, 12.0),
          enmP(2298, 90, 25, 12.0),enmP(2828, 90, 25, 12.0),
          enmP(3358, 90, 25, 12.0),enmP(3895, 90, 25, 11.5),
          enmP(4160, 80, 90, 11.5),
        );
        ld.powerups.push(star(995, 220), djump(1765, 135), star(2555, 220), djump(3085, 220), life(4165, 115));
        ld.blocks.push(
          qBlock(740, 135, 'doublejump'), qBlock(1510, 220, 'star'),
          qBlock(2290, 135, 'life'), qBlock(3350, 135, 'doublejump'),
        );
        ld.goal = goal(5220, 162);
        ld.length = 5400;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 29 ── PESADILLA  (11 enemies, plataformas 48px, gaps 140px)
      // ═══════════════════════════════════════════════════════════════
      case 29:
        ld.platforms.push(
          gnd(0, 115),
          gnd(5200, 500),
          plat(235, 90, 49),  plat(495, 175, 48),  plat(755, 90, 49),
          plat(1015, 175, 48),plat(1275, 90, 49),  plat(1540, 175, 48),
          plat(1805, 90, 49), plat(2070, 175, 48), plat(2335, 90, 49),
          plat(2605, 175, 48),plat(2875, 90, 49),  plat(3145, 175, 48),
          plat(3415, 90, 49), plat(3690, 170, 54), plat(3960, 90, 59),
          plat(4235, 80, 270),
        );
        ld.enemies.push(
          enm(100, 35, 11.5),
          enmP(252, 90, 24, 11.5),enmP(772, 90, 24, 12.0),
          enmP(1292, 90, 24, 12.0),enmP(1822, 90, 24, 12.5),
          enmP(2352, 90, 24, 12.5),enmP(2892, 90, 24, 12.5),
          enmP(3432, 90, 24, 12.5),enmP(3978, 90, 24, 12.0),
          enmP(3705, 170, 29, 12.0),enmP(4255, 80, 90, 12.0),
        );
        ld.powerups.push(
          star(1025, 220), djump(1545, 220), star(2345, 135),
          djump(3155, 220), star(3700, 215), life(4260, 115),
        );
        ld.blocks.push(
          qBlock(765, 135, 'doublejump'), qBlock(1550, 220, 'star'),
          qBlock(2345, 135, 'life'), qBlock(3425, 135, 'doublejump'),
          qBlock(3970, 135, 'star'),
        );
        ld.goal = goal(5320, 158);
        ld.length = 5500;
        break;

      // ═══════════════════════════════════════════════════════════════
      // WORLD 30 ── DIOS DE LOS MUNDOS  (nivel final definitivo)
      // Plataformas 45px, gaps 140-145px, 12 enemies 12.0-14.0.
      // ═══════════════════════════════════════════════════════════════
      default:
        ld.platforms.push(
          gnd(0, 110),
          gnd(5300, 500),
          // fase 1
          plat(240, 90, 47),  plat(510, 175, 45),  plat(780, 90, 47),
          plat(1055, 175, 45),plat(1330, 90, 47),
          // fase 2
          plat(1610, 175, 45),plat(1890, 90, 47),  plat(2170, 175, 45),
          plat(2450, 90, 47), plat(2735, 175, 45),
          // fase 3
          plat(3020, 90, 47), plat(3310, 175, 45), plat(3600, 90, 47),
          plat(3895, 170, 52),plat(4195, 90, 57),
          plat(4470, 80, 280),
        );
        ld.enemies.push(
          enm(100, 30, 12.0),
          enmP(257, 90, 22, 12.0),enmP(797, 90, 22, 12.5),
          enmP(1347, 90, 22, 12.5),enmP(1907, 90, 22, 13.0),
          enmP(2467, 90, 22, 13.0),enmP(3037, 90, 22, 13.5),
          enmP(3617, 90, 22, 13.5),enmP(4215, 90, 22, 13.0),
          enmP(1625, 175, 27, 13.0),enmP(2750, 175, 27, 13.5),
          enmP(4490, 80, 90, 14.0),
        );
        ld.powerups.push(
          star(1065, 220), djump(1615, 220), star(2460, 135),
          djump(2745, 220), star(3910, 215), life(3320, 220), life(4495, 115),
        );
        ld.blocks.push(
          qBlock(790, 135, 'doublejump'), qBlock(1620, 220, 'star'),
          qBlock(2460, 135, 'life'), qBlock(3030, 135, 'doublejump'),
          qBlock(3610, 135, 'star'), qBlock(4210, 135, 'doublejump'),
        );
        ld.goal = goal(5420, 155);
        ld.length = 5600;
        break;
    }

    world.current = ld;
  };

  const initLevel = (lvl) => {
    setLevel(lvl);
    if ((lvl >= 11 && lvl <= 13) || (lvl >= 21 && lvl <= 23) || lvl === 26) setLives(l => l + 1);
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
        if (level >= 30) {
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
            <Text style={styles.overlaySub}>{gameWon ? '¡Todos los 30 mundos conquistados! 🏆' : 'Reach the green pillar. Grab ⭐ for invincibility + gun.'}</Text>
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
  const PW0 = 82, PH = 12, BR = 8, PY = AREA_H - 38, AY = 38, WIN = 7;
  const fx = useFX();
  const [best, submitBest] = useBest('pingpong');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({
    px: AREA_W / 2, ax: AREA_W / 2, pvel: 0, lastPx: AREA_W / 2, ball: { x: AREA_W / 2, y: AREA_H / 2, vx: 0, vy: 0 }, speed: 300,
    me: 0, ai: 0, level: 1, total: 0, wait: 1.0, serve: 1, rally: 0, trail: [], t: 0, aiErr: 0, banner: { text: 'PARTIDO 1', t: 1.3 },
  });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const serveBall = s => {
    s.speed = 290 + s.level * 14; s.rally = 0;
    const a = rand(-0.5, 0.5);
    s.ball = { x: AREA_W / 2, y: AREA_H / 2, vx: Math.sin(a) * s.speed, vy: Math.cos(a) * s.speed * s.serve };
    s.wait = 0; s.trail = [];
  };
  const score = (s, who) => {
    s.wait = 0.9; s.ball.vx = 0; s.ball.vy = 0;
    if (who === 'me') {
      s.me += 1; s.total += 1; s.serve = -1;
      fx.burst(s.ball.x, AY, C.cyan, 16, 220); fx.pop(AREA_W / 2, AREA_H / 2 - 40, '¡PUNTO!', C.lime, 22); hx.good();
    } else {
      s.ai += 1; s.serve = 1;
      fx.burst(s.ball.x, PY, C.red, 16, 220); fx.shake(7, 0.3); fx.flash(C.red, 0.2); hx.bad();
    }
    s.ball.x = AREA_W / 2; s.ball.y = AREA_H / 2;
    if (s.me >= WIN) {
      s.level += 1; s.me = 0; s.ai = 0; s.wait = 1.4; s.total += 3;
      s.banner = { text: `PARTIDO GANADO · NIVEL ${s.level}`, t: 1.6 }; fx.flash('#fff', 0.25); hx.win();
      fx.pop(AREA_W / 2, AREA_H / 2, '+3', C.amber, 24);
    } else if (s.ai >= WIN) {
      hx.die(); setRes({ isNew: submitBest(s.total) }); setPhase('over');
    }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.pvel = (s.px - s.lastPx) / dt; s.lastPx = s.px;
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    const b = s.ball;
    // IA
    const aiSpeed = 130 + s.level * 38;
    let target = AREA_W / 2;
    if (b.vy < 0) { target = b.x + s.aiErr; }
    const d = target - s.ax;
    s.ax += clamp(d, -aiSpeed * dt, aiSpeed * dt);
    s.ax = clamp(s.ax, 40, AREA_W - 40);
    if (s.wait > 0) { s.wait -= dt; if (s.wait <= 0) serveBall(s); return; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    s.trail.push({ x: b.x, y: b.y, a: 0.5 }); s.trail.forEach(p => { p.a -= dt * 2.5; }); s.trail = s.trail.filter(p => p.a > 0);
    if (b.x < BR) { b.x = BR; b.vx = Math.abs(b.vx); hx.tick(); }
    if (b.x > AREA_W - BR) { b.x = AREA_W - BR; b.vx = -Math.abs(b.vx); hx.tick(); }
    // pala jugador
    if (b.vy > 0 && b.y + BR >= PY && b.y + BR <= PY + PH + 8 && Math.abs(b.x - s.px) < PW0 / 2 + BR) {
      const rel = clamp((b.x - s.px) / (PW0 / 2 + BR), -1, 1);
      s.rally += 1;
      let sp = Math.min(640, s.speed + 16);
      const smash = Math.abs(s.pvel) > 650;
      if (smash) { sp = Math.min(700, sp * 1.22); fx.pop(b.x, PY - 24, 'SMASH', C.amber, 18); fx.ring(b.x, PY, C.amber, 50); fx.shake(4); hx.heavy(); } else hx.hit();
      s.speed = sp;
      const a = rel * 1.0 + clamp(s.pvel / 3000, -0.3, 0.3);
      b.vx = Math.sin(a) * sp; b.vy = -Math.cos(a) * sp; b.y = PY - BR;
      s.aiErr = rand(-1, 1) * Math.max(8, 70 - s.level * 8);
      fx.burst(b.x, PY, C.cyan, 6, 120, 0.3, 3);
    }
    // pala IA
    if (b.vy < 0 && b.y - BR <= AY + PH && b.y - BR >= AY - 8 && Math.abs(b.x - s.ax) < PW0 / 2 + BR) {
      const rel = clamp((b.x - s.ax) / (PW0 / 2 + BR), -1, 1);
      const sp = Math.min(640, s.speed + 10); s.speed = sp;
      const a = rel * 0.95;
      b.vx = Math.sin(a) * sp; b.vy = Math.cos(a) * sp; b.y = AY + PH + BR;
      fx.burst(b.x, AY, C.pink, 6, 120, 0.3, 3); hx.tick();
    }
    if (b.y > AREA_H + 12) score(s, 'ai');
    else if (b.y < -12) score(s, 'me');
  });
  const pan = usePan(fx, { down: x => { g.current.px = clamp(x, PW0 / 2, AREA_W - PW0 / 2); }, move: x => { g.current.px = clamp(x, PW0 / 2, AREA_W - PW0 / 2); } });
  const s = g.current;
  return (
    <GameScreen title="PING PONG" emoji="🏓" accent={C.blue} onExit={onExit} score={s.total} best={best} scoreLabel="PUNTOS"
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Nivel IA <Text style={{ color: C.blue, fontWeight: '800' }}>{s.level}</Text></Text><Text style={{ color: C.text, fontSize: 16, fontWeight: '900' }}><Text style={{ color: C.cyan }}>{s.me}</Text> - <Text style={{ color: C.pink }}>{s.ai}</Text></Text><Text style={{ color: C.dim, fontSize: 12 }}>Racha <Text style={{ color: C.amber, fontWeight: '800' }}>{s.rally}</Text></Text></>}>
      <PlayArea fx={fx} bg="#050a1c" border={alpha(C.blue, 0.4)} {...pan}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: AREA_H / 2 - 1, height: 2, backgroundColor: alpha(C.blue, 0.35) }} />
        <View style={{ position: 'absolute', left: AREA_W / 2 - 40, top: AREA_H / 2 - 40, width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: alpha(C.blue, 0.25) }} />
        {s.trail.map((p, i) => <View key={i} style={{ position: 'absolute', left: p.x - BR * 0.7, top: p.y - BR * 0.7, width: BR * 1.4, height: BR * 1.4, borderRadius: BR, backgroundColor: C.blue, opacity: Math.max(0, p.a * 0.6) }} />)}
        <View style={{ position: 'absolute', left: s.ax - PW0 / 2, top: AY, width: PW0, height: PH, borderRadius: 6, backgroundColor: C.pink, ...glow(C.pink, 12, 0.9) }} />
        <View style={{ position: 'absolute', left: s.px - PW0 / 2, top: PY, width: PW0, height: PH, borderRadius: 6, backgroundColor: C.cyan, ...glow(C.cyan, 12, 0.9) }} />
        <View style={{ position: 'absolute', left: s.ball.x - BR, top: s.ball.y - BR, width: BR * 2, height: BR * 2, borderRadius: BR, backgroundColor: '#fff', ...glow('#fff', 12, 1) }} />
        {s.banner && <Text style={{ position: 'absolute', top: AREA_H * 0.3, width: AREA_W, textAlign: 'center', color: C.text, fontSize: 20, fontWeight: '900', letterSpacing: 2, opacity: Math.min(1, s.banner.t), ...tglow(C.blue, 12) }}>{s.banner.text}</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🏓" title={phase === 'over' ? 'PARTIDO PERDIDO' : 'PING PONG'}
          subtitle={phase === 'over' ? `Llegaste al nivel ${s.level} de IA` : 'Gana partidos a 7 contra una IA cada vez mejor'}
          score={s.total} best={best} isNew={res.isNew} accent={C.blue} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para mover tu pala', 'Pega con el borde para desviar la bola', 'Mueve la pala rápido al golpear: ¡SMASH!', 'Ganar un partido da +3 y sube la dificultad'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ==========================================
// 5. BREAKOUT
// ==========================================
function Breakout({ onExit }) {
  const COLS = 8, PAD = 8, BH = 20, TOP = 52, BG = 3;
  const BW = (AREA_W - PAD * 2 - BG * (COLS - 1)) / COLS;
  const PY = AREA_H - 44, BR = 7;
  const fx = useFX();
  const [best, submitBest] = useBest('breakout');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const HUES = [350, 25, 48, 130, 190, 260, 300, 330];
  const makeBricks = level => {
    const rows = Math.min(8, 4 + Math.floor(level / 2));
    const pat = level % 4;
    const out = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) {
      let hp = 1;
      if (pat === 1 && (r + c) % 2) continue;                       // ajedrez
      if (pat === 2 && (c < r - 1 || c > COLS - 2 - r + 1) && r > 1) continue;   // pirámide invertida
      if (pat === 3 && c % 3 === 1) continue;                      // columnas
      if (level >= 2 && r === 0) hp = 2;
      if (level >= 4 && r < 2) hp = 3;
      out.push({ id: uid(), r, c, hp, max: hp, x: PAD + c * (BW + BG), y: TOP + r * (BH + BG), hue: HUES[r % 8] });
    }
    return out;
  };
  const initState = () => ({ px: AREA_W / 2, pw: 84, balls: [{ x: AREA_W / 2, y: PY - BR - 2, vx: 0, vy: 0, stuck: true }], bricks: makeBricks(1), items: [], lives: 3, level: 1, score: 0, combo: 0, wide: 0, fire: 0, slow: 0, t: 0, banner: { text: 'NIVEL 1', t: 1.4 } });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const speedOf = s => (330 + s.level * 20) * (s.slow > 0 ? 0.7 : 1);
  const launch = s => {
    s.balls.forEach(b => { if (b.stuck) { b.stuck = false; const a = -Math.PI / 2 + rand(-0.35, 0.35); b.vx = Math.cos(a) * speedOf(s); b.vy = Math.sin(a) * speedOf(s); } });
    hx.tap();
  };
  const loseLife = s => {
    s.lives -= 1; s.combo = 0; s.wide = 0; s.fire = 0;
    fx.shake(8, 0.3); fx.flash(C.red, 0.3); hx.bad();
    if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
    s.balls = [{ x: s.px, y: PY - BR - 2, vx: 0, vy: 0, stuck: true }];
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    ['wide', 'fire', 'slow'].forEach(k => { if (s[k] > 0) s[k] = Math.max(0, s[k] - dt); });
    s.pw += ((s.wide > 0 ? 136 : 84) - s.pw) * Math.min(1, dt * 10);
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    const sp = speedOf(s);
    for (let bi = s.balls.length - 1; bi >= 0; bi--) {
      const b = s.balls[bi];
      if (b.stuck) { b.x = s.px; b.y = PY - BR - 2; continue; }
      const m = Math.hypot(b.vx, b.vy) || 1;
      b.vx *= sp / m; b.vy *= sp / m;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < BR) { b.x = BR; b.vx = Math.abs(b.vx); }
      if (b.x > AREA_W - BR) { b.x = AREA_W - BR; b.vx = -Math.abs(b.vx); }
      if (b.y < BR) { b.y = BR; b.vy = Math.abs(b.vy); }
      // pala
      if (b.vy > 0 && b.y + BR >= PY && b.y + BR <= PY + 14 && b.x > s.px - s.pw / 2 - 4 && b.x < s.px + s.pw / 2 + 4) {
        const rel = clamp((b.x - s.px) / (s.pw / 2), -1, 1);
        const a = -Math.PI / 2 + rel * 1.05;
        b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.y = PY - BR;
        s.combo = 0; hx.tap();
      }
      // ladrillos
      for (let i = s.bricks.length - 1; i >= 0; i--) {
        const k = s.bricks[i];
        if (b.x + BR < k.x || b.x - BR > k.x + BW || b.y + BR < k.y || b.y - BR > k.y + BH) continue;
        if (s.fire <= 0) {
          const ox = Math.min(b.x + BR - k.x, k.x + BW - (b.x - BR));
          const oy = Math.min(b.y + BR - k.y, k.y + BH - (b.y - BR));
          if (ox < oy) b.vx = (b.x < k.x + BW / 2 ? -1 : 1) * Math.abs(b.vx); else b.vy = (b.y < k.y + BH / 2 ? -1 : 1) * Math.abs(b.vy);
        }
        k.hp -= s.fire > 0 ? 3 : 1;
        const cx = k.x + BW / 2, cy = k.y + BH / 2;
        if (k.hp <= 0) {
          s.bricks.splice(i, 1); s.combo += 1;
          const pts = 10 * s.level + s.combo * 2;
          s.score += pts;
          fx.burst(cx, cy, `hsl(${k.hue},90%,60%)`, 10, 170, 0.5, 4); fx.pop(cx, cy, `+${pts}`, C.text, 12); hx.hit();
          if (Math.random() < 0.2) s.items.push({ id: uid(), x: cx, y: cy, k: pick(['W', 'M', 'F', 'L', 'S']) });
        } else { fx.burst(cx, cy, '#fff', 3, 80, 0.2, 3); hx.tick(); }
        if (s.fire <= 0) break;
      }
      if (b.y > AREA_H + 10) s.balls.splice(bi, 1);
    }
    if (!s.balls.length) { loseLife(s); return; }
    s.items.forEach(it => { it.y += 130 * dt; });
    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i];
      if (it.y > PY - 8 && it.y < PY + 16 && Math.abs(it.x - s.px) < s.pw / 2 + 10) {
        s.items.splice(i, 1); hx.good(); fx.ring(it.x, PY, C.lime, 46);
        if (it.k === 'W') { s.wide = 10; fx.pop(it.x, PY - 24, 'PALA GRANDE', C.cyan, 14); }
        if (it.k === 'F') { s.fire = 8; fx.pop(it.x, PY - 24, '🔥 BOLA DE FUEGO', C.orange, 14); }
        if (it.k === 'L') { s.lives = Math.min(5, s.lives + 1); fx.pop(it.x, PY - 24, '+1 VIDA', C.red, 14); }
        if (it.k === 'S') { s.slow = 9; fx.pop(it.x, PY - 24, 'LENTO', C.violet, 14); }
        if (it.k === 'M') {
          const b0 = s.balls[0];
          [-0.5, 0.5].forEach(d => { const a = Math.atan2(b0.vy, b0.vx) + d; s.balls.push({ x: b0.x, y: b0.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, stuck: b0.stuck }); });
          fx.pop(it.x, PY - 24, 'MULTIBOLA', C.pink, 14);
        }
      } else if (it.y > AREA_H + 20) s.items.splice(i, 1);
    }
    if (!s.bricks.length) {
      s.score += 100 * s.level; fx.pop(AREA_W / 2, AREA_H / 2, `NIVEL SUPERADO +${100 * s.level}`, C.lime, 20); hx.win(); fx.flash('#fff', 0.3);
      s.level += 1; s.bricks = makeBricks(s.level); s.items = []; s.balls = [{ x: s.px, y: PY - BR - 2, vx: 0, vy: 0, stuck: true }];
      s.banner = { text: `NIVEL ${s.level}`, t: 1.4 };
    }
  });
  const pan = usePan(fx, {
    down: x => { const s = g.current; s.px = clamp(x, s.pw / 2, AREA_W - s.pw / 2); if (s.balls.some(b => b.stuck) && phase === 'play') launch(s); },
    move: x => { const s = g.current; s.px = clamp(x, s.pw / 2, AREA_W - s.pw / 2); },
  });
  const s = g.current;
  const ITEMC = { W: [C.cyan, '↔'], M: [C.pink, '✱'], F: [C.orange, '🔥'], L: [C.red, '❤'], S: [C.violet, '❄'] };
  return (
    <GameScreen title="BREAKOUT" emoji="🧱" accent={C.orange} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={Math.max(3, s.lives)} /><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.orange, fontWeight: '800' }}>{s.level}</Text></Text><View style={{ minWidth: 60, alignItems: 'flex-end' }}>{s.combo > 1 ? <Combo n={s.combo} color={C.orange} /> : <Text style={{ color: C.cyan, fontSize: 12, fontWeight: '800' }}>{s.fire > 0 ? '🔥' : ''}{s.wide > 0 ? '↔' : ''}</Text>}</View></>}>
      <PlayArea fx={fx} bg="#0b0604" {...pan}>
        <GridBg color={C.orange} step={46} />
        {s.bricks.map(k => <View key={k.id} style={{ position: 'absolute', left: k.x, top: k.y, width: BW, height: BH, borderRadius: 5, backgroundColor: `hsla(${k.hue},90%,${40 + (k.hp / k.max) * 18}%,${0.5 + 0.5 * (k.hp / k.max)})`, borderWidth: 1.5, borderColor: `hsl(${k.hue},95%,62%)`, ...glow(`hsl(${k.hue},95%,55%)`, 6, 0.5) }}>{k.max > 1 && <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900', textAlign: 'center', lineHeight: BH - 3 }}>{k.hp}</Text>}</View>)}
        {s.items.map(it => <View key={it.id} style={{ position: 'absolute', left: it.x - 13, top: it.y - 13, width: 26, height: 26, borderRadius: 13, backgroundColor: alpha(ITEMC[it.k][0], 0.25), borderWidth: 2, borderColor: ITEMC[it.k][0], alignItems: 'center', justifyContent: 'center', ...glow(ITEMC[it.k][0], 8, 0.8) }}><Text style={{ fontSize: 12, color: '#fff', fontWeight: '900' }}>{ITEMC[it.k][1]}</Text></View>)}
        <View style={{ position: 'absolute', left: s.px - s.pw / 2, top: PY, width: s.pw, height: 12, borderRadius: 6, backgroundColor: s.wide > 0 ? C.cyan : '#fff', ...glow(s.wide > 0 ? C.cyan : C.orange, 12, 0.9) }} />
        {s.balls.map((b, i) => <View key={i} style={{ position: 'absolute', left: b.x - BR, top: b.y - BR, width: BR * 2, height: BR * 2, borderRadius: BR, backgroundColor: s.fire > 0 ? C.orange : '#fff', ...glow(s.fire > 0 ? C.orange : '#fff', 12, 1) }} />)}
        {s.balls.some(b => b.stuck) && phase === 'play' && <Text pointerEvents="none" style={{ position: 'absolute', top: PY - 60, width: AREA_W, textAlign: 'center', color: C.dim, fontSize: 12, fontWeight: '800', letterSpacing: 2 }}>TOCA PARA LANZAR</Text>}
        {s.banner && <Text style={{ position: 'absolute', top: AREA_H * 0.55, width: AREA_W, textAlign: 'center', color: C.text, fontSize: 24, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow(C.orange, 12) }}>{s.banner.text}</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🧱" title={phase === 'over' ? 'GAME OVER' : 'BREAKOUT'}
          subtitle={phase === 'over' ? `Llegaste al nivel ${s.level}` : 'Rompe todos los ladrillos'}
          score={s.score} best={best} isNew={res.isNew} accent={C.orange} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para mover la pala · toca para lanzar', '↔ pala grande · ✱ multibola · 🔥 fuego · ❄ lento · ❤ vida', 'Romper ladrillos seguidos sin tocar la pala da combo'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ==========================================
function GalacticHunt({ onExit }) {
  const MAG = 8;
  const fx = useFX();
  const [best, submitBest] = useBest('galactic');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const stars = useRef(makeStars(50)).current;
  const initState = () => ({ time: 45, t: 0, score: 0, combo: 0, best: 0, ammo: MAG, reload: 0, targets: [], spawn: 0.4, hits: 0, shots: 0, marks: [], pending: null });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const TYPES = {
    ufo: { e: '🛸', size: 46, pts: 20, spd: 150 },
    alien: { e: '👽', size: 44, pts: 10, spd: 105 },
    gem: { e: '💎', size: 34, pts: 50, spd: 270 },
    bomb: { e: '💣', size: 40, pts: 0, spd: 120 },
    clock: { e: '⏱️', size: 38, pts: 0, spd: 140 },
  };
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };

  const spawn = s => {
    const r = Math.random();
    const type = r < 0.38 ? 'ufo' : r < 0.66 ? 'alien' : r < 0.78 ? 'gem' : r < 0.9 ? 'bomb' : 'clock';
    const d = TYPES[type];
    const side = Math.random() < 0.5 ? 1 : -1;
    const spd = d.spd * (1 + Math.min(0.8, s.t / 70)) * rand(0.85, 1.2);
    s.targets.push({
      id: uid(), type, size: d.size, x: side > 0 ? -d.size : AREA_W + d.size, y: rand(60, AREA_H - 170),
      vx: spd * side, vy: rand(-30, 30), ph: Math.random() * 6, wob: type === 'alien' ? 70 : type === 'gem' ? 20 : 35,
    });
  };

  const shoot = (x, y) => {
    const s = g.current;
    if (phase !== 'play') return;
    if (s.reload > 0) { fx.pop(x, y - 20, 'RECARGANDO', C.dim, 12); return; }
    s.ammo -= 1; s.shots += 1;
    fx.ring(x, y, C.cyan, 26);
    let hit = null;
    for (let i = s.targets.length - 1; i >= 0; i--) {
      const t = s.targets[i];
      if (Math.hypot(t.x + t.size / 2 - x, t.y + t.size / 2 - y) < t.size / 2 + 14) { hit = i; break; }
    }
    if (hit == null) {
      s.combo = 0; hx.tap();
    } else {
      const t = s.targets.splice(hit, 1)[0];
      const cx = t.x + t.size / 2; const cy = t.y + t.size / 2;
      s.hits += 1;
      if (t.type === 'bomb') {
        s.time = Math.max(0, s.time - 5); s.combo = 0;
        fx.burst(cx, cy, C.red, 22, 260); fx.shake(9); fx.flash(C.red, 0.3); fx.pop(cx, cy, '-5s', C.red, 22); hx.bad();
      } else if (t.type === 'clock') {
        s.time += 4;
        fx.burst(cx, cy, C.lime, 14, 200); fx.pop(cx, cy, '+4s', C.lime, 22); hx.good();
      } else {
        s.combo += 1; s.best = Math.max(s.best, s.combo);
        const mult = 1 + Math.floor(s.combo / 3);
        const pts = TYPES[t.type].pts * mult;
        s.score += pts;
        fx.burst(cx, cy, t.type === 'gem' ? C.cyan : C.pink, 14, 220); fx.pop(cx, cy, `+${pts}`, mult > 1 ? C.amber : C.text, 18);
        hx.hit();
      }
    }
    if (s.ammo <= 0) s.reload = 1.1;
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt; s.time -= dt;
    if (s.reload > 0) { s.reload -= dt; if (s.reload <= 0) { s.ammo = MAG; hx.tick(); } }
    s.spawn -= dt;
    if (s.spawn <= 0) { spawn(s); s.spawn = Math.max(0.35, 1.0 - s.t * 0.012) * rand(0.6, 1.2); }
    s.targets.forEach(t => { t.x += t.vx * dt; t.y += t.vy * dt + Math.sin(s.t * 3 + t.ph) * t.wob * dt; });
    s.targets = s.targets.filter(t => t.x > -80 && t.x < AREA_W + 80 && t.y > -40 && t.y < AREA_H);
    if (s.time <= 0) {
      s.time = 0; hx.win();
      setRes({ isNew: submitBest(s.score) });
      setPhase('over');
    }
  });
  const pan = usePan(fx, { down: shoot });
  const s = g.current;
  const mult = 1 + Math.floor(s.combo / 3);
  return (
    <GameScreen title="GALACTIC HUNT" emoji="🛸" accent={C.violet} onExit={onExit} score={s.score} best={best}
      hud={<>
        <Text style={{ color: s.time < 10 ? C.red : C.text, fontWeight: '900', fontSize: 15 }}>⏱ {Math.ceil(s.time)}s</Text>
        <View style={{ flexDirection: 'row' }}>{Array.from({ length: MAG }, (_, i) => <View key={i} style={{ width: 7, height: 14, marginHorizontal: 1.5, borderRadius: 2, backgroundColor: s.reload > 0 ? C.dim : i < s.ammo ? C.amber : alpha(C.amber, 0.15) }} />)}</View>
        <View style={{ minWidth: 70, alignItems: 'flex-end' }}>{mult > 1 ? <Combo n={mult} /> : <Text style={{ color: C.dim, fontSize: 12 }}>{s.reload > 0 ? 'Recargando…' : ' '}</Text>}</View>
      </>}>
      <PlayArea fx={fx} bg="#05030f" {...pan}>
        <Starfield stars={stars} offset={s.t * 20} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 70, backgroundColor: alpha(C.violet, 0.1), borderTopWidth: 1, borderTopColor: alpha(C.violet, 0.5) }} />
        {s.targets.map(t => (
          <Text key={t.id} style={{ position: 'absolute', left: t.x, top: t.y, width: t.size, textAlign: 'center', fontSize: t.size - 6, lineHeight: t.size }}>{TYPES[t.type].e}</Text>
        ))}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🛸" title={phase === 'over' ? '¡TIEMPO!' : 'GALACTIC HUNT'}
          subtitle={phase === 'over' ? `Precisión ${s.shots ? Math.round((s.hits / s.shots) * 100) : 0}% · Mejor racha ${s.best}` : '45 segundos de caza'}
          score={s.score} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca los objetivos para dispararles', '🛸 20 · 👽 10 · 💎 50 · ⏱️ +4s · 💣 -5s', 'Cargador de 8 balas · fallar rompe la racha'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

function SnakePower({ onExit }) {
  const CELL = 18;
  const COLS = Math.floor(AREA_W / CELL), ROWS = Math.floor(AREA_H / CELL);
  const OX = (AREA_W - COLS * CELL) / 2, OY = (AREA_H - ROWS * CELL) / 2;
  const fx = useFX();
  const [best, submitBest] = useBest('snake');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({
    body: [{ x: 8, y: Math.floor(ROWS / 2) }, { x: 7, y: Math.floor(ROWS / 2) }, { x: 6, y: Math.floor(ROWS / 2) }],
    dir: { x: 1, y: 0 }, queue: [], acc: 0, stepT: 0.13, food: null, item: null, rocks: [], score: 0, eaten: 0, level: 1,
    ghost: 0, slow: 0, dbl: 0, t: 0, lx: 0, ly: 0, grow: 0,
  });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const cellPx = c => ({ x: OX + c.x * CELL + CELL / 2, y: OY + c.y * CELL + CELL / 2 });
  const freeCell = s => {
    for (let k = 0; k < 200; k++) {
      const c = { x: randInt(0, COLS - 1), y: randInt(0, ROWS - 1) };
      if (s.body.some(b => b.x === c.x && b.y === c.y)) continue;
      if (s.rocks.some(b => b.x === c.x && b.y === c.y)) continue;
      if (s.food && s.food.x === c.x && s.food.y === c.y) continue;
      if (s.item && s.item.x === c.x && s.item.y === c.y) continue;
      if (Math.abs(c.x - s.body[0].x) + Math.abs(c.y - s.body[0].y) < 4) continue;
      return c;
    }
    return { x: 1, y: 1 };
  };
  const start = () => { fx.clear(); const s = initState(); s.food = freeCell(s); g.current = s; setPhase('play'); };
  const die = s => {
    const p = cellPx(s.body[0]);
    fx.burst(p.x, p.y, C.lime, 30, 260, 0.9, 6); fx.shake(10, 0.4); fx.flash(C.red, 0.3); hx.die();
    setRes({ isNew: submitBest(s.score) });
    setPhase('over');
  };
  const step = s => {
    if (s.queue.length) { const d = s.queue.shift(); if (!(d.x === -s.dir.x && d.y === -s.dir.y)) s.dir = d; }
    const h = s.body[0];
    let nx = h.x + s.dir.x, ny = h.y + s.dir.y;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
      if (s.ghost > 0) { nx = (nx + COLS) % COLS; ny = (ny + ROWS) % ROWS; } else { die(s); return false; }
    }
    const tailGrows = s.grow > 0;
    const bodyCheck = tailGrows ? s.body : s.body.slice(0, -1);
    if (s.ghost <= 0 && (bodyCheck.some(b => b.x === nx && b.y === ny) || s.rocks.some(r => r.x === nx && r.y === ny))) { die(s); return false; }
    s.body.unshift({ x: nx, y: ny });
    if (tailGrows) s.grow -= 1; else s.body.pop();
    const p = cellPx({ x: nx, y: ny });
    if (s.food && s.food.x === nx && s.food.y === ny) {
      s.eaten += 1; s.grow += 1;
      const pts = 10 * (s.dbl > 0 ? 2 : 1) * s.level;
      s.score += pts;
      fx.burst(p.x, p.y, C.red, 12, 170); fx.pop(p.x, p.y - 10, `+${pts}`, s.dbl > 0 ? C.amber : C.text, 15); hx.hit();
      s.food = freeCell(s);
      if (s.eaten % 5 === 0) {
        s.level += 1; s.stepT = Math.max(0.065, 0.13 - s.level * 0.0065);
        s.rocks.push(freeCell(s), freeCell(s));
        fx.pop(AREA_W / 2, AREA_H / 2, `NIVEL ${s.level}`, C.lime, 26); hx.good();
      }
      if (!s.item && Math.random() < 0.3) s.item = { ...freeCell(s), k: pick(['ghost', 'slow', 'dbl', 'gem']), life: 9 };
    }
    if (s.item && s.item.x === nx && s.item.y === ny) {
      const k = s.item.k; s.item = null; hx.good(); fx.ring(p.x, p.y, C.cyan, 44);
      if (k === 'ghost') { s.ghost = 7; fx.pop(p.x, p.y, 'FANTASMA', C.violet, 15); }
      if (k === 'slow') { s.slow = 7; fx.pop(p.x, p.y, 'LENTO', C.cyan, 15); }
      if (k === 'dbl') { s.dbl = 9; fx.pop(p.x, p.y, 'PUNTOS ×2', C.amber, 15); }
      if (k === 'gem') { s.score += 50; s.grow += 3; fx.pop(p.x, p.y, '+50', C.amber, 18); }
    }
    return true;
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    ['ghost', 'slow', 'dbl'].forEach(k => { if (s[k] > 0) s[k] = Math.max(0, s[k] - dt); });
    if (s.item) { s.item.life -= dt; if (s.item.life <= 0) s.item = null; }
    s.acc += dt;
    const T = s.stepT * (s.slow > 0 ? 1.7 : 1);
    while (s.acc >= T) { s.acc -= T; if (!step(s)) return; }
  });
  const pan = usePan(fx, {
    down: (x, y) => { const s = g.current; s.lx = x; s.ly = y; },
    move: (x, y) => {
      const s = g.current;
      if (phase !== 'play') return;
      const dx = x - s.lx, dy = y - s.ly;
      if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
      const d = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
      const ref = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
      if (!(d.x === ref.x && d.y === ref.y) && !(d.x === -ref.x && d.y === -ref.y) && s.queue.length < 2) s.queue.push(d);
      s.lx = x; s.ly = y;
    },
  });
  const s = g.current;
  const ITEM = { ghost: '👻', slow: '🐢', dbl: '✨', gem: '💎' };
  return (
    <GameScreen title="SNAKE POWER" emoji="🐍" accent={C.lime} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.lime, fontWeight: '800' }}>{s.level}</Text> · Largo <Text style={{ color: C.lime, fontWeight: '800' }}>{s.body.length}</Text></Text>
        <Text style={{ color: C.violet, fontSize: 12, fontWeight: '800' }}>{s.ghost > 0 ? `👻${Math.ceil(s.ghost)} ` : ''}{s.slow > 0 ? `🐢${Math.ceil(s.slow)} ` : ''}{s.dbl > 0 ? `✨${Math.ceil(s.dbl)}` : ''}</Text></>}>
      <PlayArea fx={fx} bg="#04100a" border={alpha(C.lime, 0.4)} {...pan}>
        <GridBg color={C.lime} step={CELL * 2} />
        {s.rocks.map((r, i) => <Text key={i} style={{ position: 'absolute', left: OX + r.x * CELL - 2, top: OY + r.y * CELL - 3, fontSize: CELL, lineHeight: CELL + 4 }}>🪨</Text>)}
        {s.food && <Text style={{ position: 'absolute', left: OX + s.food.x * CELL - 2, top: OY + s.food.y * CELL - 3, fontSize: CELL, lineHeight: CELL + 4, transform: [{ scale: 1 + Math.sin(s.t * 6) * 0.1 }] }}>🍎</Text>}
        {s.item && <Text style={{ position: 'absolute', left: OX + s.item.x * CELL - 3, top: OY + s.item.y * CELL - 4, fontSize: CELL + 3, lineHeight: CELL + 6, opacity: s.item.life < 3 && Math.floor(s.t * 8) % 2 ? 0.3 : 1, ...glow(C.cyan, 8, 0.9) }}>{ITEM[s.item.k]}</Text>}
        {s.body.map((b, i) => {
          const head = i === 0;
          const col = s.ghost > 0 ? `hsla(270,90%,${70 - Math.min(30, i)}%,0.75)` : `hsl(${135 - Math.min(60, i * 2)},90%,${head ? 62 : 52 - Math.min(18, i * 0.8)}%)`;
          return (
            <View key={i} style={{ position: 'absolute', left: OX + b.x * CELL + 1, top: OY + b.y * CELL + 1, width: CELL - 2, height: CELL - 2, borderRadius: head ? 7 : 5, backgroundColor: col, ...(head ? glow(C.lime, 10, 0.9) : null) }}>
              {head && <>
                <View style={{ position: 'absolute', left: 3 + (s.dir.x > 0 ? 3 : 0), top: 3 + (s.dir.y > 0 ? 3 : 0), width: 4, height: 4, borderRadius: 2, backgroundColor: '#04100a' }} />
                <View style={{ position: 'absolute', left: (s.dir.x !== 0 ? 3 : 9) + (s.dir.x > 0 ? 3 : 0), top: (s.dir.y !== 0 ? 3 : 9) + (s.dir.y > 0 ? 3 : 0), width: 4, height: 4, borderRadius: 2, backgroundColor: '#04100a' }} />
              </>}
            </View>
          );
        })}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🐍" title={phase === 'over' ? 'GAME OVER' : 'SNAKE POWER'}
          subtitle={phase === 'over' ? `Nivel ${s.level} · Largo ${s.body.length}` : 'El clásico con poderes'}
          score={s.score} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Desliza el dedo para girar', '👻 atraviesa muros · 🐢 lento · ✨ ×2 · 💎 +50', 'Cada 5 manzanas sube el nivel y aparecen rocas'] : null} />
      </PlayArea>
    </GameScreen>
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
        <Pressable onPress={onExit} style={styles.backBtn} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}><Text style={styles.backText}>← BACK</Text></Pressable>
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
          <Pressable style={[styles.btn, { backgroundColor: theme.accent }]} onPress={startGame} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
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
  const N = 8;
  const CX = AREA_W / 2, CY = AREA_H * 0.46;
  const MAXR = Math.min(AREA_W, AREA_H) * 0.5;
  const PR = MAXR * 0.86;
  const fx = useFX();
  const [best, submitBest] = useBest('tunnel');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({ lane: 0, ang: 0, rings: [], t: 0, dist: 0, speed: 0.55, since: 0, passed: 0, streak: 0, gems: 0, score: 0, spin: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const spawnRing = s => {
    const nFree = s.passed > 40 ? 2 : 3;
    const f0 = randInt(0, N - 1);
    const free = []; for (let i = 0; i < nFree; i++) free.push((f0 + i) % N);
    s.rings.push({ id: uid(), z: 0.02, free, hue: (s.passed * 23) % 360, gem: Math.random() < 0.45 ? free[randInt(0, nFree - 1)] : -1, done: false });
  };
  const start = () => { fx.clear(); g.current = initState(); spawnRing(g.current); setPhase('play'); hx.hit(); };
  const shift = d => {
    const s = g.current;
    if (phase !== 'play') return;
    s.lane = (s.lane + d + N) % N; hx.tick();
  };
  const pos = (lane, r, spin) => { const a = (lane / N) * Math.PI * 2 - Math.PI / 2 + spin; return { x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r, a }; };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.speed = Math.min(1.5, 0.55 + s.t * 0.012);
    s.dist += s.speed * dt;
    s.since += s.speed * dt;
    if (s.since > 0.27) { s.since = 0; spawnRing(s); }
    // ángulo suave hacia el carril
    const target = s.lane;
    let cur = s.ang; let diff = ((target - cur) % N + N) % N; if (diff > N / 2) diff -= N;
    s.ang = cur + diff * Math.min(1, dt * 22);
    for (let i = s.rings.length - 1; i >= 0; i--) {
      const r = s.rings[i];
      r.z += s.speed * dt;
      if (!r.done && r.z >= 1) {
        r.done = true;
        if (!r.free.includes(s.lane)) {
          const p = pos(s.lane, PR, 0);
          fx.burst(p.x, p.y, C.red, 26, 280, 0.8, 6); fx.shake(11, 0.4); fx.flash(C.red, 0.35); hx.die();
          setRes({ isNew: submitBest(s.score) });
          setPhase('over');
          return;
        }
        s.passed += 1; s.streak += 1;
        const mult = 1 + Math.floor(s.streak / 8);
        s.score += 10 * mult;
        if (r.gem === s.lane) { s.gems += 1; s.score += 25 * mult; const p = pos(s.lane, PR, 0); fx.burst(p.x, p.y, C.amber, 12, 180); fx.pop(p.x, p.y - 20, `+${25 * mult}`, C.amber, 16); hx.good(); }
        else hx.tap();
        if (s.streak % 8 === 0) { fx.ring(CX, CY, C.lime, 120); fx.pop(CX, CY - 50, `RACHA ×${1 + s.streak / 8}`, C.lime, 20); }
      }
      if (r.z > 1.25) s.rings.splice(i, 1);
    }
  });
  const pan = usePan(fx, { down: x => shift(x < AREA_W / 2 ? -1 : 1) });
  const s = g.current;
  const mult = 1 + Math.floor(s.streak / 8);
  const dang = z => z > 0.72;
  return (
    <GameScreen title="NEON TUNNEL" emoji="🌀" accent={C.cyan} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Anillos: <Text style={{ color: C.cyan, fontWeight: '800' }}>{s.passed}</Text></Text><Combo n={mult} color={C.lime} /><Text style={{ color: C.dim, fontSize: 12 }}>💎 <Text style={{ color: C.amber, fontWeight: '800' }}>{s.gems}</Text></Text></>}>
      <PlayArea fx={fx} bg="#00000f" {...pan}>
        {s.rings.map(r => {
          const rad = MAXR * Math.pow(r.z, 1.7);
          if (rad < 3) return null;
          const col = `hsl(${r.hue}, 100%, 58%)`;
          const op = Math.min(1, 0.15 + r.z * 0.9) * (r.z > 1.05 ? Math.max(0, (1.25 - r.z) / 0.2) : 1);
          const bw = (2 * Math.PI * rad / N) * 0.84, bh = Math.max(3, rad * 0.13);
          return (
            <React.Fragment key={r.id}>
              <View style={{ position: 'absolute', left: CX - rad, top: CY - rad, width: rad * 2, height: rad * 2, borderRadius: rad, borderWidth: 1, borderColor: col, opacity: op * 0.5 }} />
              {Array.from({ length: N }, (_, lane) => {
                if (r.free.includes(lane)) {
                  if (r.gem === lane && !r.done) { const p = pos(lane, rad, 0); return <Text key={lane} style={{ position: 'absolute', left: p.x - 10, top: p.y - 11, fontSize: Math.max(8, 8 + rad * 0.06), opacity: op }}>💎</Text>; }
                  return null;
                }
                const p = pos(lane, rad, 0);
                return <View key={lane} style={{ position: 'absolute', left: p.x - bw / 2, top: p.y - bh / 2, width: bw, height: bh, borderRadius: 3, backgroundColor: dang(r.z) ? C.red : col, opacity: op, transform: [{ rotate: `${p.a + Math.PI / 2}rad` }], ...glow(dang(r.z) ? C.red : col, 6, 0.7) }} />;
              })}
            </React.Fragment>
          );
        })}
        {Array.from({ length: N }, (_, lane) => {
          const p = pos(lane, PR + 26, 0);
          const on = lane === s.lane;
          return <View key={lane} style={{ position: 'absolute', left: p.x - 3, top: p.y - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: on ? C.cyan : alpha(C.cyan, 0.25) }} />;
        })}
        {(() => {
          const a = (s.ang / N) * Math.PI * 2 - Math.PI / 2;
          const px = CX + Math.cos(a) * PR; const py = CY + Math.sin(a) * PR;
          return <View style={{ position: 'absolute', left: px - 14, top: py - 14, width: 28, height: 28, borderRadius: 8, backgroundColor: C.cyan, borderWidth: 2, borderColor: '#fff', transform: [{ rotate: `${a + Math.PI / 2}rad` }], ...glow(C.cyan, 14, 1) }} />;
        })()}
        {phase === 'play' && <View pointerEvents="none" style={{ position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row' }}>
          <Text style={{ flex: 1, textAlign: 'center', color: alpha(C.cyan, 0.4), fontSize: 26, fontWeight: '900' }}>◀</Text>
          <Text style={{ flex: 1, textAlign: 'center', color: alpha(C.cyan, 0.4), fontSize: 26, fontWeight: '900' }}>▶</Text>
        </View>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🌀" title={phase === 'over' ? 'CHOQUE' : 'NEON TUNNEL'}
          subtitle={phase === 'over' ? `${s.passed} anillos cruzados` : 'Atraviesa los huecos del túnel'}
          score={s.score} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca izquierda o derecha para girar de carril', 'Cruza por los huecos libres', '💎 da bonus · las rachas multiplican'] : null} />
      </PlayArea>
    </GameScreen>
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
  const CEIL = 48, FLOOR = AREA_H - 48, PS = 28, PX = 84;
  const fx = useFX();
  const [best, submitBest] = useBest('gravity');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({ y: FLOOR - PS, vy: 0, dir: 1, t: 0, dist: 0, speed: 280, obs: [], orbs: [], next: 1.0, scroll: 0, flips: 0, score: 0, trail: [], bonus: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const flip = () => {
    const s = g.current;
    if (phase !== 'play') return;
    s.dir *= -1; s.vy = s.dir * 120; s.flips += 1;
    fx.ring(PX + PS / 2, s.y + PS / 2, C.violet, 36); hx.tap();
  };
  const addPattern = s => {
    const x = AREA_W + 40;
    const r = Math.random();
    const pw = rand(26, 42);
    if (r < 0.28) s.obs.push({ id: uid(), k: 'spike', side: 1, x, w: pw * (1 + Math.floor(Math.random() * 2)), h: 30 });
    else if (r < 0.52) s.obs.push({ id: uid(), k: 'spike', side: -1, x, w: pw * (1 + Math.floor(Math.random() * 2)), h: 30 });
    else if (r < 0.74) { const h = rand(90, 190); const side = Math.random() < 0.5 ? 1 : -1; s.obs.push({ id: uid(), k: 'block', side, x, w: rand(28, 40), h }); }
    else if (r < 0.9) { s.obs.push({ id: uid(), k: 'spike', side: 1, x, w: 60, h: 30 }); s.obs.push({ id: uid(), k: 'spike', side: -1, x: x + 150, w: 60, h: 30 }); }
    else { const side = Math.random() < 0.5 ? 1 : -1; s.obs.push({ id: uid(), k: 'block', side, x, w: 30, h: 150 }); s.obs.push({ id: uid(), k: 'block', side: -side, x: x + 170, w: 30, h: 150 }); }
    if (Math.random() < 0.55) s.orbs.push({ id: uid(), x: x + rand(40, 120), y: rand(CEIL + 50, FLOOR - 50), got: false });
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.speed = Math.min(560, 280 + s.t * 6);
    s.dist += s.speed * dt * 0.05;
    s.scroll += s.speed * dt;
    s.vy += s.dir * 4200 * dt;
    s.y += s.vy * dt;
    if (s.y >= FLOOR - PS) { s.y = FLOOR - PS; s.vy = 0; }
    if (s.y <= CEIL) { s.y = CEIL; s.vy = 0; }
    s.trail.push({ x: PX, y: s.y, a: 0.5 });
    s.trail.forEach(p => { p.x -= s.speed * dt; p.a -= dt * 2.2; });
    s.trail = s.trail.filter(p => p.a > 0);
    s.next -= dt;
    if (s.next <= 0) { addPattern(s); s.next = Math.max(0.55, 1.35 - s.t * 0.012) * (280 / s.speed) + 0.35; }
    s.obs.forEach(o => { o.x -= s.speed * dt; });
    s.orbs.forEach(o => { o.x -= s.speed * dt; });
    s.obs = s.obs.filter(o => o.x > -100);
    s.orbs = s.orbs.filter(o => o.x > -30);
    const me = { x: PX + 4, y: s.y + 4, w: PS - 8, h: PS - 8 };
    for (const o of s.obs) {
      const box = o.side === 1
        ? { x: o.x + (o.k === 'spike' ? 6 : 0), y: FLOOR - o.h + (o.k === 'spike' ? 8 : 0), w: o.w - (o.k === 'spike' ? 12 : 0), h: o.h }
        : { x: o.x + (o.k === 'spike' ? 6 : 0), y: CEIL, w: o.w - (o.k === 'spike' ? 12 : 0), h: o.h - (o.k === 'spike' ? 8 : 0) };
      if (overlap(me, box)) {
        fx.burst(PX + PS / 2, s.y + PS / 2, C.violet, 26, 280, 0.8, 6); fx.shake(11, 0.4); fx.flash(C.red, 0.3); hx.die();
        setRes({ isNew: submitBest(Math.floor(s.dist) + s.bonus) });
        setPhase('over');
        return;
      }
    }
    for (const o of s.orbs) {
      if (!o.got && Math.hypot(o.x - (PX + PS / 2), o.y - (s.y + PS / 2)) < 26) {
        o.got = true; s.bonus += 10;
        fx.burst(o.x, o.y, C.amber, 10, 170); fx.pop(o.x, o.y - 14, '+10', C.amber, 15); hx.good();
      }
    }
  });
  const pan = usePan(fx, { down: flip });
  const s = g.current;
  const score = Math.floor(s.dist) + s.bonus;
  const tri = (o, i) => {
    // fila de triángulos
    const n = Math.max(1, Math.round(o.w / 22)); const tw = o.w / n;
    return Array.from({ length: n }, (_, k) => (
      <View key={`${o.id}-${k}`} style={{ position: 'absolute', left: o.x + k * tw, top: o.side === 1 ? FLOOR - o.h : CEIL, width: 0, height: 0, borderLeftWidth: tw / 2, borderRightWidth: tw / 2, borderLeftColor: 'transparent', borderRightColor: 'transparent', [o.side === 1 ? 'borderBottomWidth' : 'borderTopWidth']: o.h, [o.side === 1 ? 'borderBottomColor' : 'borderTopColor']: C.pink }} />
    ));
  };
  return (
    <GameScreen title="GRAVITY FLIP" emoji="🔀" accent={C.violet} onExit={onExit} score={score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Giros: <Text style={{ color: C.violet, fontWeight: '800' }}>{s.flips}</Text></Text><Text style={{ color: C.dim, fontSize: 12 }}>Vel. {Math.round(s.speed / 28)}</Text></>}>
      <PlayArea fx={fx} bg="#07041a" {...pan}>
        <GridBg color={C.violet} offset={-s.scroll} step={44} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: CEIL - 3, height: 3, backgroundColor: C.violet, ...glow(C.violet, 10, 0.9) }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: FLOOR, height: 3, backgroundColor: C.violet, ...glow(C.violet, 10, 0.9) }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: CEIL - 3, backgroundColor: alpha(C.violet, 0.08) }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: FLOOR + 3, bottom: 0, backgroundColor: alpha(C.violet, 0.08) }} />
        {s.orbs.map(o => !o.got && <View key={o.id} style={{ position: 'absolute', left: o.x - 9, top: o.y - 9, width: 18, height: 18, borderRadius: 9, backgroundColor: C.amber, ...glow(C.amber, 10, 1) }} />)}
        {s.obs.map(o => o.k === 'block'
          ? <View key={o.id} style={{ position: 'absolute', left: o.x, width: o.w, top: o.side === 1 ? FLOOR - o.h : CEIL, height: o.h, backgroundColor: alpha(C.pink, 0.16), borderWidth: 2, borderColor: C.pink, borderRadius: 4, ...glow(C.pink, 10, 0.7) }} />
          : tri(o))}
        {s.trail.map((p, i) => <View key={i} style={{ position: 'absolute', left: p.x, top: p.y, width: PS, height: PS, borderRadius: 6, backgroundColor: C.violet, opacity: Math.max(0, p.a * 0.5) }} />)}
        <View style={{ position: 'absolute', left: PX, top: s.y, width: PS, height: PS, borderRadius: 7, backgroundColor: C.cyan, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: s.dir === 1 ? 'flex-start' : 'flex-end', paddingVertical: 5, ...glow(C.cyan, 14, 1) }}>
          <View style={{ flexDirection: 'row', gap: 5 }}><View style={{ width: 4, height: 6, borderRadius: 2, backgroundColor: '#04040c' }} /><View style={{ width: 4, height: 6, borderRadius: 2, backgroundColor: '#04040c' }} /></View>
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🔀" title={phase === 'over' ? 'APLASTADO' : 'GRAVITY FLIP'}
          subtitle={phase === 'over' ? `${Math.floor(s.dist)} m · ${s.flips} giros` : 'Invierte la gravedad para sobrevivir'}
          score={score} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca para cambiar entre suelo y techo', 'Esquiva púas y bloques', 'Las esferas doradas dan +10'] : null} />
      </PlayArea>
    </GameScreen>
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
  const COLS = 10, ROWS = 20;
  const CS = Math.min(Math.floor((AREA_W - 98) / COLS), Math.floor((AREA_H - 8) / ROWS));
  const BW = CS * COLS, BH = CS * ROWS;
  const BX = 6, BY = Math.floor((AREA_H - BH) / 2);
  const PX = BX + BW + 10;
  const fx = useFX();
  const [best, submitBest] = useBest('tetris');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const SHAPES = {
    I: { n: 4, c: C.cyan, b: [[1, 0], [1, 1], [1, 2], [1, 3]] }, O: { n: 4, c: C.amber, b: [[0, 1], [0, 2], [1, 1], [1, 2]] },
    T: { n: 3, c: C.violet, b: [[0, 1], [1, 0], [1, 1], [1, 2]] }, S: { n: 3, c: C.lime, b: [[0, 1], [0, 2], [1, 0], [1, 1]] },
    Z: { n: 3, c: C.red, b: [[0, 0], [0, 1], [1, 1], [1, 2]] }, J: { n: 3, c: C.blue, b: [[0, 0], [1, 0], [1, 1], [1, 2]] },
    L: { n: 3, c: C.orange, b: [[0, 2], [1, 0], [1, 1], [1, 2]] },
  };
  const cells = (t, rot) => {
    const { n, b } = SHAPES[t];
    let cs = b;
    for (let i = 0; i < rot; i++) cs = cs.map(([r, c]) => [c, n - 1 - r]);
    return cs;
  };
  const bag = () => shuffle(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);
  const initState = () => {
    const s = { grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)), q: [...bag(), ...bag()], piece: null, hold: null, canHold: true, score: 0, lines: 0, level: 1, combo: -1, acc: 0, lock: 0, resets: 0, clearing: null, t: 0, over: false, lastX: 0, dxAcc: 0, dyAcc: 0, mv: 0, down: 0 };
    spawn(s); return s;
  };
  const fits = (s, t, rot, x, y) => cells(t, rot).every(([r, c]) => { const gx = x + c, gy = y + r; return gx >= 0 && gx < COLS && gy < ROWS && (gy < 0 || !s.grid[gy][gx]); });
  const spawn = (s, forceT) => {
    if (s.q.length < 7) s.q.push(...bag());
    const t = forceT || s.q.shift();
    const p = { t, rot: 0, x: Math.floor((COLS - SHAPES[t].n) / 2), y: t === 'I' ? -1 : 0 };
    s.piece = p; s.lock = 0; s.resets = 0; s.acc = 0; s.canHold = forceT ? s.canHold : true;
    if (!fits(s, t, 0, p.x, p.y)) {
      s.over = true; hx.die(); fx.shake(8, 0.4); fx.flash(C.red, 0.3);
      setRes({ isNew: submitBest(s.score) }); setPhase('over');
    }
  };
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const drop = (s, p) => { let y = p.y; while (fits(s, p.t, p.rot, p.x, y + 1)) y += 1; return y; };
  const touchGround = s => { if (s.resets < 14) { s.lock = 0; s.resets += 1; } };
  const shift = dx => {
    const s = g.current; const p = s.piece;
    if (phase !== 'play' || s.over || s.clearing || !p) return false;
    if (fits(s, p.t, p.rot, p.x + dx, p.y)) { p.x += dx; touchGround(s); hx.tick(); return true; }
    return false;
  };
  const rotate = () => {
    const s = g.current; const p = s.piece;
    if (phase !== 'play' || s.over || s.clearing || !p || p.t === 'O') return;
    const nr = (p.rot + 1) % 4;
    for (const [kx, ky] of [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1]]) {
      if (fits(s, p.t, nr, p.x + kx, p.y + ky)) { p.rot = nr; p.x += kx; p.y += ky; touchGround(s); hx.tap(); return; }
    }
  };
  const holdPiece = () => {
    const s = g.current;
    if (phase !== 'play' || s.over || s.clearing || !s.canHold) return;
    const cur = s.piece.t; const h = s.hold; s.hold = cur; s.canHold = false; hx.hit();
    if (h) spawn(s, h); else spawn(s);
    s.canHold = false;
  };
  const lockPiece = s => {
    const p = s.piece;
    cells(p.t, p.rot).forEach(([r, c]) => { const gy = p.y + r; if (gy >= 0) s.grid[gy][p.x + c] = SHAPES[p.t].c; });
    const full = []; s.grid.forEach((row, i) => { if (row.every(Boolean)) full.push(i); });
    hx.hit();
    if (full.length) {
      s.clearing = { rows: full, t: 0.28 }; s.piece = null;
      s.combo += 1;
      const base = [0, 100, 300, 500, 800][full.length] * s.level + (s.combo > 0 ? 50 * s.combo * s.level : 0);
      s.score += base;
      const label = full.length === 4 ? '¡TETRIS!' : full.length === 3 ? 'TRIPLE' : full.length === 2 ? 'DOBLE' : 'LÍNEA';
      fx.pop(BX + BW / 2, BY + BH * 0.4, `${label} +${base}`, full.length === 4 ? C.amber : C.text, full.length === 4 ? 24 : 18);
      full.forEach(i => fx.burst(BX + BW / 2, BY + i * CS + CS / 2, SHAPES[p.t].c, 6, 260, 0.6, 5));
      if (full.length >= 3) { fx.shake(6, 0.25); fx.flash('#fff', 0.2); hx.win(); } else hx.good();
    } else { s.combo = -1; spawn(s); }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    if (s.over) return;
    if (s.clearing) {
      s.clearing.t -= dt;
      if (s.clearing.t <= 0) {
        const rows = s.clearing.rows;
        s.grid = s.grid.filter((_, i) => !rows.includes(i));
        while (s.grid.length < ROWS) s.grid.unshift(Array(COLS).fill(null));
        s.lines += rows.length;
        const lv = Math.floor(s.lines / 10) + 1;
        if (lv > s.level) { s.level = lv; fx.pop(AREA_W / 2, AREA_H * 0.3, `NIVEL ${lv}`, C.lime, 26); hx.good(); }
        s.clearing = null; spawn(s);
      }
      return;
    }
    const p = s.piece; if (!p) return;
    const grav = s.down > 0 ? 0.04 : Math.max(0.04, Math.pow(0.8 - (s.level - 1) * 0.007, s.level - 1));
    if (fits(s, p.t, p.rot, p.x, p.y + 1)) {
      s.acc += dt; s.lock = 0;
      while (s.acc >= grav && fits(s, p.t, p.rot, p.x, p.y + 1)) { s.acc -= grav; p.y += 1; if (s.down > 0) s.score += 1; }
    } else {
      s.lock += dt;
      if (s.lock >= 0.45) lockPiece(s);
    }
  });
  const pan = usePan(fx, {
    down: (x, y) => { const s = g.current; s.lastX = x; s.lastY = y; s.dxAcc = 0; s.dyAcc = 0; s.moved = 0; s.t0 = Date.now(); s.down = 0; s.holdTap = x > PX - 4 && y < BY + 130; },
    move: (x, y, gs) => {
      const s = g.current;
      if (phase !== 'play' || s.holdTap) return;
      const dx = x - s.lastX, dy = y - s.lastY; s.lastX = x; s.lastY = y;
      s.moved += Math.abs(dx) + Math.abs(dy);
      s.dxAcc += dx;
      const step = CS * 0.85;
      while (s.dxAcc > step) { s.dxAcc -= step; shift(1); }
      while (s.dxAcc < -step) { s.dxAcc += step; shift(-1); }
      if (Math.abs(gs.dy) > Math.abs(gs.dx) * 1.2 && gs.dy > 18) s.down = 1; else s.down = 0;
    },
    up: (x, y, gs) => {
      const s = g.current;
      s.down = 0;
      if (phase !== 'play') return;
      if (s.holdTap) { if (Math.abs(gs.dx) < 12 && Math.abs(gs.dy) < 12) holdPiece(); return; }
      if (gs.dy > 70 && gs.vy > 1.1 && Math.abs(gs.dx) < gs.dy * 0.6) { // flick: caída instantánea
        const p = s.piece; if (p && !s.clearing) { const ny = drop(s, p); s.score += 2 * (ny - p.y); fx.ring(BX + (p.x + 1.5) * CS, BY + ny * CS, SHAPES[p.t].c, 40); p.y = ny; fx.shake(3, 0.12); lockPiece(s); }
      } else if (s.moved < 14 && Date.now() - s.t0 < 300) rotate();
    },
  });
  const s = g.current;
  const p = s.piece;
  const ghostY = p ? drop(s, p) : 0;
  const cell = (r, c, color, extra) => ({ position: 'absolute', left: BX + c * CS + 1, top: BY + r * CS + 1, width: CS - 2, height: CS - 2, borderRadius: 5, backgroundColor: color, borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)', ...extra });
  const mini = (t, ox, oy, sz) => cells(t, 0).map(([r, c], i) => <View key={i} style={{ position: 'absolute', left: ox + c * sz, top: oy + r * sz, width: sz - 1, height: sz - 1, borderRadius: 3, backgroundColor: SHAPES[t].c }} />);
  return (
    <GameScreen title="NEON TETRIS" emoji="🧊" accent={C.cyan} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.cyan, fontWeight: '800' }}>{s.level}</Text> · Líneas <Text style={{ color: C.cyan, fontWeight: '800' }}>{s.lines}</Text></Text><View style={{ minWidth: 80, alignItems: 'flex-end' }}>{s.combo > 0 ? <Combo n={s.combo + 1} color={C.lime} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#04060f" border={alpha(C.cyan, 0.35)} {...pan}>
        <View style={{ position: 'absolute', left: BX - 2, top: BY - 2, width: BW + 4, height: BH + 4, borderRadius: 8, borderWidth: 2, borderColor: alpha(C.cyan, 0.5), backgroundColor: 'rgba(8,12,28,0.9)', ...glow(C.cyan, 12, 0.4) }} />
        {Array.from({ length: COLS - 1 }, (_, i) => <View key={`v${i}`} style={{ position: 'absolute', left: BX + (i + 1) * CS, top: BY, width: 1, height: BH, backgroundColor: alpha(C.cyan, 0.07) }} />)}
        {Array.from({ length: ROWS - 1 }, (_, i) => <View key={`h${i}`} style={{ position: 'absolute', top: BY + (i + 1) * CS, left: BX, height: 1, width: BW, backgroundColor: alpha(C.cyan, 0.07) }} />)}
        {s.grid.map((row, r) => row.map((c, ci) => {
          if (!c) return null;
          const flashing = s.clearing && s.clearing.rows.includes(r);
          return <View key={`${r}-${ci}`} style={cell(r, ci, flashing ? (Math.floor(s.t * 24) % 2 ? '#fff' : c) : c)} />;
        }))}
        {p && !s.clearing && cells(p.t, p.rot).map(([r, c], i) => <View key={`gh${i}`} style={{ position: 'absolute', left: BX + (p.x + c) * CS + 1, top: BY + (ghostY + r) * CS + 1, width: CS - 2, height: CS - 2, borderRadius: 5, borderWidth: 2, borderColor: alpha(SHAPES[p.t].c, 0.5), backgroundColor: alpha(SHAPES[p.t].c, 0.08) }} />)}
        {p && !s.clearing && cells(p.t, p.rot).map(([r, c], i) => (p.y + r >= 0) && <View key={`p${i}`} style={cell(p.y + r, p.x + c, SHAPES[p.t].c, glow(SHAPES[p.t].c, 10, 0.9))} />)}
        {/* panel lateral */}
        <Text style={{ position: 'absolute', left: PX, top: BY, color: C.dim, fontSize: 10, fontWeight: '900', letterSpacing: 2 }}>HOLD</Text>
        <View style={{ position: 'absolute', left: PX, top: BY + 16, width: 76, height: 56, borderRadius: 10, borderWidth: 1.5, borderColor: s.canHold ? alpha(C.cyan, 0.5) : alpha(C.dim, 0.3), alignItems: 'center', justifyContent: 'center' }}>
          {s.hold && <View style={{ width: 56, height: 34, opacity: s.canHold ? 1 : 0.35 }}>{mini(s.hold, SHAPES[s.hold].n === 4 ? 0 : 7, SHAPES[s.hold].n === 4 ? -4 : 0, 14)}</View>}
        </View>
        <Text style={{ position: 'absolute', left: PX, top: BY + 96, color: C.dim, fontSize: 10, fontWeight: '900', letterSpacing: 2 }}>SIGUIENTE</Text>
        {s.q.slice(0, 3).map((t, i) => <View key={i} style={{ position: 'absolute', left: PX + 8, top: BY + 114 + i * 46, width: 60, height: 36 }}>{mini(t, SHAPES[t].n === 4 ? 0 : 8, SHAPES[t].n === 4 ? -4 : 0, 14)}</View>)}
        <Text style={{ position: 'absolute', left: PX, top: BY + 270, color: C.dim, fontSize: 10, fontWeight: '900', letterSpacing: 2 }}>CONTROLES</Text>
        <Text style={{ position: 'absolute', left: PX, top: BY + 286, width: 80, color: alpha(C.dim, 0.9), fontSize: 10, lineHeight: 15 }}>{'↔ arrastra\n↻ toca = girar\n↓ baja = caer\n⤓ desliza rápido\n= soltar'}</Text>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🧊" title={phase === 'over' ? 'GAME OVER' : 'NEON TETRIS'}
          subtitle={phase === 'over' ? `${s.lines} líneas · nivel ${s.level}` : 'El clásico con pieza fantasma'}
          score={s.score} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra ↔ para mover · toca para girar', 'Arrastra ↓ para bajar · desliza rápido para soltar', 'Toca HOLD (arriba a la derecha) para guardar una pieza'] : null} />
      </PlayArea>
    </GameScreen>
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
          <View onTouchStart={() => keysRef.current.left = true} onTouchEnd={() => keysRef.current.left = false} onTouchCancel={() => keysRef.current.left = false}
            style={{ width: 68, height: 68, backgroundColor: '#f0f1', borderRadius: 34, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#f0f4' }}>
            <Text style={{ color: '#f0f', fontSize: 28, fontWeight: 'bold' }}>◀</Text>
          </View>
          <View onTouchStart={() => keysRef.current.right = true} onTouchEnd={() => keysRef.current.right = false} onTouchCancel={() => keysRef.current.right = false}
            style={{ width: 68, height: 68, backgroundColor: '#f0f1', borderRadius: 34, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#f0f4' }}>
            <Text style={{ color: '#f0f', fontSize: 28, fontWeight: 'bold' }}>▶</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={shoot}
            style={{ width: 68, height: 68, backgroundColor: '#ff01', borderRadius: 34, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#ff04' }}>
            <Text style={{ color: '#ff0', fontSize: 26 }}>💥</Text>
          </Pressable>
          <Pressable onPress={jump} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
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
          <View onTouchStart={() => keysRef.current.left = true} onTouchEnd={() => keysRef.current.left = false} onTouchCancel={() => keysRef.current.left = false}
            style={{ width: 64, height: 64, backgroundColor: '#2a1f0a', borderRadius: 32, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#6a4a1a' }}>
            <Text style={{ color: '#c8a060', fontSize: 26, fontWeight: 'bold' }}>◀</Text>
          </View>
          <View onTouchStart={() => keysRef.current.right = true} onTouchEnd={() => keysRef.current.right = false} onTouchCancel={() => keysRef.current.right = false}
            style={{ width: 64, height: 64, backgroundColor: '#2a1f0a', borderRadius: 32, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#6a4a1a' }}>
            <Text style={{ color: '#c8a060', fontSize: 26, fontWeight: 'bold' }}>▶</Text>
          </View>
        </View>
        <Pressable onPress={jump} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
          style={{ width: 70, height: 70, backgroundColor: '#0d2a04', borderRadius: 35, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#3a6a1a' }}>
          <Text style={{ color: '#7ec840', fontSize: 28, fontWeight: 'bold' }}>⬆</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
// ─────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════
// WALL JUMPER — sube saltando entre paredes, esquiva las púas
// ══════════════════════════════════════════════════════════════════
const WJ_W = width;
const WJ_H = Math.min(height - 220, 580);
const WJ_PLAYER_R = 18;
const WJ_WALL_W = 44;
const WJ_GAP_H = 120;         // alto del hueco en la pared
const WJ_SCROLL_SPEED_INIT = 2.2;
const WJ_JUMP_VX = 9;         // velocidad horizontal al saltar
const WJ_GRAVITY = 0.55;
const WJ_BOUNCE_VY = -11;     // rebote al tocar pared
const WJ_OBSTACLE_INTERVAL = 260; // px entre obstáculos

function WallJumper({ onExit }) {
  const WALL = 26, PS = 26, PY = AREA_H * 0.68;
  const LX = WALL, RX = AREA_W - WALL - PS;       // x de reposo (pegado a cada pared)
  const fx = useFX();
  const [best, submitBest] = useBest('walljumper');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({ side: 0, x: LX, air: 0, from: LX, to: RX, t: 0, speed: 210, rows: [], next: 0.9, scroll: 0, score: 0, coins: 0, near: 0, shield: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const jump = () => {
    const s = g.current;
    if (phase !== 'play' || s.air > 0) return;
    s.air = 0.0001; s.from = s.x; s.to = s.side === 0 ? RX : LX; s.side = s.side === 0 ? 1 : 0;
    fx.burst(s.from + PS / 2, PY + PS / 2, C.orange, 6, 110, 0.35, 4); hx.tap();
  };
  const addRow = s => {
    const r = Math.random();
    const y = -40;
    if (r < 0.34) s.rows.push({ id: uid(), y, k: 'spike', side: Math.random() < 0.5 ? 0 : 1, h: 34 });
    else if (r < 0.58) s.rows.push({ id: uid(), y, k: 'spike2', side: 2, h: 34 });         // ambas paredes: hay que estar en el aire
    else if (r < 0.74) s.rows.push({ id: uid(), y, k: 'mine', side: 2, h: 30, mx: AREA_W / 2 });   // mina al centro: hay que estar pegado
    else if (r < 0.9) s.rows.push({ id: uid(), y, k: 'coins', side: Math.random() < 0.5 ? 0 : 1, h: 30, got: false });
    else s.rows.push({ id: uid(), y, k: 'shield', side: Math.random() < 0.5 ? 0 : 1, h: 30, got: false });
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.speed = Math.min(430, 210 + s.t * 5);
    s.scroll += s.speed * dt;
    s.score = Math.floor(s.scroll / 12) + s.coins * 5 + s.near * 3;
    if (s.air > 0) {
      s.air += dt / 0.36;
      if (s.air >= 1) { s.air = 0; s.x = s.to; fx.burst(s.x + PS / 2, PY + PS / 2, C.orange, 5, 90, 0.3, 3); }
      else { const k = s.air; const e = k * k * (3 - 2 * k); s.x = s.from + (s.to - s.from) * e; }
    }
    s.next -= dt;
    if (s.next <= 0) { addRow(s); s.next = Math.max(0.5, 1.15 - s.t * 0.01) * (210 / s.speed) + 0.28; }
    s.rows.forEach(r => { r.y += s.speed * dt; });
    s.rows = s.rows.filter(r => r.y < AREA_H + 50);
    const cx = s.x + PS / 2;
    for (const r of s.rows) {
      if (r.dead) continue;
      const overlapY = r.y + r.h > PY + 4 && r.y < PY + PS - 4;
      if (!overlapY) { if (r.near === undefined && r.y > PY + PS && r.k !== 'coins' && r.k !== 'shield') { r.near = true; } continue; }
      let hurt = false;
      const midAir = s.air > 0.22 && s.air < 0.78;
      if (r.k === 'spike' && !midAir && s.side === r.side) hurt = true;
      if (r.k === 'spike2' && !midAir) hurt = true;
      if (r.k === 'mine' && midAir) hurt = true;
      if (hurt) {
        if (s.shield > 0) { s.shield -= 1; r.dead = true; fx.ring(cx, PY, C.cyan, 60); fx.burst(cx, PY, C.cyan, 14, 200); fx.shake(5); hx.hit(); continue; }
        fx.burst(cx, PY + PS / 2, C.orange, 26, 280, 0.8, 6); fx.shake(11, 0.4); fx.flash(C.red, 0.3); hx.die();
        setRes({ isNew: submitBest(s.score) });
        setPhase('over');
        return;
      }
      if ((r.k === 'coins' || r.k === 'shield') && !r.got && (s.side === r.side || s.air > 0.3 && s.air < 0.7)) {
        r.got = true;
        if (r.k === 'coins') { s.coins += 1; fx.pop(cx, PY - 20, '+5', C.amber, 16); fx.burst(cx, PY, C.amber, 10, 170); hx.good(); }
        else { s.shield = Math.min(2, s.shield + 1); fx.pop(cx, PY - 20, 'ESCUDO', C.cyan, 15); fx.ring(cx, PY, C.cyan, 50); hx.good(); }
      }
    }
  });
  const pan = usePan(fx, { down: jump });
  const s = g.current;
  const spikeRow = (r, side) => {
    const n = 3;
    return Array.from({ length: n }, (_, i) => (
      <View key={`${r.id}-${side}-${i}`} style={{ position: 'absolute', top: r.y + i * 11, left: side === 0 ? WALL : AREA_W - WALL - 22, width: 0, height: 0, borderTopWidth: 6, borderBottomWidth: 6, borderTopColor: 'transparent', borderBottomColor: 'transparent', [side === 0 ? 'borderLeftWidth' : 'borderRightWidth']: 22, [side === 0 ? 'borderLeftColor' : 'borderRightColor']: C.red }} />
    ));
  };
  return (
    <GameScreen title="WALL JUMPER" emoji="🧗" accent={C.orange} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Monedas: <Text style={{ color: C.amber, fontWeight: '800' }}>{s.coins}</Text></Text><Text style={{ color: C.cyan, fontSize: 12, fontWeight: '800' }}>{s.shield > 0 ? `🛡️×${s.shield}` : ''}</Text><Text style={{ color: C.dim, fontSize: 12 }}>Altura {Math.floor(s.scroll / 12)}</Text></>}>
      <PlayArea fx={fx} bg="#0b0504" {...pan}>
        <GridBg color={C.orange} offset={s.scroll} step={48} />
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: WALL, backgroundColor: alpha(C.orange, 0.2), borderRightWidth: 3, borderRightColor: C.orange, ...glow(C.orange, 10, 0.6) }} />
        <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: WALL, backgroundColor: alpha(C.orange, 0.2), borderLeftWidth: 3, borderLeftColor: C.orange, ...glow(C.orange, 10, 0.6) }} />
        {s.rows.map(r => {
          if (r.k === 'spike') return <React.Fragment key={r.id}>{spikeRow(r, r.side)}</React.Fragment>;
          if (r.k === 'spike2') return <React.Fragment key={r.id}>{spikeRow(r, 0)}{spikeRow(r, 1)}</React.Fragment>;
          if (r.k === 'mine') return <Text key={r.id} style={{ position: 'absolute', left: r.mx - 17, top: r.y - 4, fontSize: 32, ...glow(C.red, 10, 0.8) }}>💣</Text>;
          if (r.got) return null;
          const x = r.side === 0 ? WALL + 6 : AREA_W - WALL - 6 - 28;
          return <Text key={r.id} style={{ position: 'absolute', left: x, top: r.y, fontSize: 26 }}>{r.k === 'coins' ? '🪙' : '🛡️'}</Text>;
        })}
        <View style={{ position: 'absolute', left: s.x, top: PY, width: PS, height: PS, borderRadius: 8, backgroundColor: C.orange, borderWidth: 2, borderColor: '#fff', transform: [{ rotate: `${s.air > 0 ? (s.side === 1 ? 1 : -1) * s.air * 6.28 : 0}rad` }], ...glow(C.orange, 14, 1) }}>
          {s.shield > 0 && <View style={{ position: 'absolute', left: -9, top: -9, width: PS + 14, height: PS + 14, borderRadius: (PS + 14) / 2, borderWidth: 2, borderColor: alpha(C.cyan, 0.9) }} />}
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🧗" title={phase === 'over' ? 'TE PINCHASTE' : 'WALL JUMPER'}
          subtitle={phase === 'over' ? `Altura ${Math.floor(s.scroll / 12)}` : 'Salta de pared en pared'}
          score={s.score} best={best} isNew={res.isNew} accent={C.orange} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca para saltar a la pared contraria', 'Púas en una pared: cambia de lado', 'Púas en ambas: salta justo cuando pasan', '💣 en el centro: quédate pegado a la pared'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────
// FLAPPY NEON
const FB_GRAVITY = 0.5;
const FB_JUMP = -9;
const FB_PIPE_W = 60;
const FB_GAP = 160;
const FB_SPEED = 3;
function FlappyNeon({ onExit }) {
  const BX = 96, PW = 60, GROUND = 36;
  const fx = useFX();
  const [best, submitBest] = useBest('flappy');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, medal: '' });
  const initState = () => ({ y: AREA_H * 0.42, vy: 0, t: 0, pipes: [], next: 260, score: 0, coins: 0, scroll: 0, started: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const addPipe = (s, x) => {
    const gap = Math.max(122, 158 - s.score * 1.6);
    const moving = s.score >= 8 && Math.random() < 0.5;
    s.pipes.push({ id: uid(), x, gapY: rand(gap / 2 + 50, AREA_H - GROUND - gap / 2 - 50), gap, moving, ph: Math.random() * 6, passed: false, coin: Math.random() < 0.55, got: false });
  };
  const start = () => {
    fx.clear();
    const s = initState();
    addPipe(s, AREA_W + 40);
    g.current = s;
    s.started = true; s.vy = -400;
    setPhase('play');
  };
  const flap = () => {
    const s = g.current;
    if (phase !== 'play') return;
    s.vy = -415;
    fx.burst(BX - 10, s.y + 8, C.amber, 4, 70, 0.35, 3);
    hx.tap();
  };
  const crash = s => {
    fx.burst(BX, s.y, C.amber, 24, 260, 0.8, 5); fx.shake(9, 0.35); fx.flash('#ffffff', 0.35); hx.die();
    const medal = s.score >= 40 ? '🥇' : s.score >= 20 ? '🥈' : s.score >= 10 ? '🥉' : '';
    setRes({ isNew: submitBest(s.score), medal });
    setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    const speed = Math.min(215, 150 + s.score * 2.2);
    s.vy += 1450 * dt;
    s.y += s.vy * dt;
    s.scroll += speed * dt;
    s.next -= speed * dt;
    if (s.next <= 0) { addPipe(s, AREA_W + 20); s.next = rand(205, 235); }
    s.pipes.forEach(p => {
      p.x -= speed * dt;
      if (p.moving) p.cy = p.gapY + Math.sin(s.t * 1.8 + p.ph) * 44; else p.cy = p.gapY;
    });
    s.pipes = s.pipes.filter(p => p.x > -PW - 10);
    if (s.y < 10) { s.y = 10; if (s.vy < 0) s.vy = 0; }
    if (s.y > AREA_H - GROUND - 12) { s.y = AREA_H - GROUND - 12; crash(s); return; }
    for (const p of s.pipes) {
      const cy = p.cy != null ? p.cy : p.gapY;
      if (BX + 11 > p.x && BX - 11 < p.x + PW) {
        if (s.y - 11 < cy - p.gap / 2 || s.y + 11 > cy + p.gap / 2) { crash(s); return; }
      }
      if (!p.passed && p.x + PW < BX - 11) {
        p.passed = true; s.score += 1;
        hx.tick();
        if (s.score % 10 === 0) { fx.ring(BX, s.y, C.lime, 90); fx.pop(AREA_W / 2, AREA_H * 0.3, `¡${s.score}!`, C.lime, 28); hx.good(); }
      }
      if (p.coin && !p.got && Math.abs(p.x + PW / 2 - BX) < 22 && Math.abs(s.y - cy) < 26) {
        p.got = true; s.score += 2; s.coins += 1;
        fx.burst(BX, s.y, C.amber, 10, 160); fx.pop(BX + 30, s.y - 20, '+2', C.amber, 16); hx.good();
      }
    }
  });
  const pan = usePan(fx, { down: flap });
  const s = g.current;
  const rot = clamp(s.vy / 600, -0.5, 1.1);
  return (
    <GameScreen title="FLAPPY NEON" emoji="🐦" accent={C.amber} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Monedas: <Text style={{ color: C.amber, fontWeight: '800' }}>{s.coins}</Text></Text><Text style={{ color: C.dim, fontSize: 12 }}>Toca para volar</Text></>}>
      <PlayArea fx={fx} bg="#07061a" {...pan}>
        <GridBg color={C.amber} offset={-s.scroll} step={44} />
        {s.pipes.map(p => {
          const cy = p.cy != null ? p.cy : p.gapY;
          const topH = cy - p.gap / 2;
          const botY = cy + p.gap / 2;
          const col = p.moving ? C.pink : C.lime;
          const body = { position: 'absolute', left: p.x, width: PW, backgroundColor: alpha(col, 0.14), borderColor: col, borderWidth: 2, ...glow(col, 10, 0.6) };
          return (
            <React.Fragment key={p.id}>
              <View style={[body, { top: -4, height: topH + 4, borderBottomLeftRadius: 6, borderBottomRightRadius: 6 }]} />
              <View style={[body, { top: botY, height: AREA_H - botY, borderTopLeftRadius: 6, borderTopRightRadius: 6 }]} />
              {p.coin && !p.got && <Text style={{ position: 'absolute', left: p.x + PW / 2 - 13, top: cy - 15, fontSize: 24 }}>⭐</Text>}
            </React.Fragment>
          );
        })}
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: GROUND, backgroundColor: '#12102a', borderTopWidth: 2, borderTopColor: C.amber, ...glow(C.amber, 8, 0.5) }}>
          {Array.from({ length: 12 }, (_, i) => <View key={i} style={{ position: 'absolute', top: 6, left: ((i * 44 - s.scroll) % (AREA_W + 44) + AREA_W + 44) % (AREA_W + 44) - 20, width: 22, height: 4, borderRadius: 2, backgroundColor: alpha(C.amber, 0.3) }} />)}
        </View>
        <Text style={{ position: 'absolute', left: BX - 17, top: s.y - 17 + (phase === 'ready' ? Math.sin(Date.now() / 250) * 6 : 0), fontSize: 30, lineHeight: 34, transform: [{ rotate: `${rot}rad` }], ...tglow(C.amber, 10, 0.8) }}>🐤</Text>
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? (res.medal || '🐤') : '🐤'} title={phase === 'over' ? 'ESTRELLADO' : 'FLAPPY NEON'}
          subtitle={phase === 'over' ? 'Cada tubo cuenta' : 'Vuela entre los tubos'}
          score={s.score} best={best} isNew={res.isNew} accent={C.amber} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca para aletear', '⭐ da +2 · tubos rosas se mueven', '🥉 10 · 🥈 20 · 🥇 40 puntos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────
// MEMORY MATCH
const MM_EMOJIS = ['🔥','💎','🌙','⚡','🎯','🌊','🍎','👾','🚀','💀','🌈','🦄'];
function MemoryCard({ up, matched, emoji, color, size, onPress, wrong }) {
  const a = useRef(new Animated.Value(up || matched ? 1 : 0)).current;
  const sh = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(a, { toValue: up || matched ? 1 : 0, duration: 170, useNativeDriver: true }).start(); }, [up, matched]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (wrong) Animated.sequence([Animated.timing(sh, { toValue: 1, duration: 60, useNativeDriver: true }), Animated.timing(sh, { toValue: -1, duration: 90, useNativeDriver: true }), Animated.timing(sh, { toValue: 0, duration: 60, useNativeDriver: true })]).start(); }, [wrong]); // eslint-disable-line react-hooks/exhaustive-deps
  const showFace = up || matched;
  return (
    <Pressable onPress={onPress} style={{ width: size, height: size, padding: 4 }}>
      <Animated.View style={{ flex: 1, transform: [{ translateX: sh.interpolate({ inputRange: [-1, 1], outputRange: [-5, 5] }) }, { scaleX: a.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.05, 1] }) }] }}>
        <View style={{ flex: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: showFace ? alpha(color, matched ? 0.28 : 0.16) : C.panel2, borderWidth: 2, borderColor: showFace ? color : C.line, ...(matched ? glow(color, 12, 0.8) : null) }}>
          {showFace ? <Text style={{ fontSize: size * 0.46 }}>{emoji}</Text> : <Text style={{ fontSize: size * 0.3, color: alpha(C.violet, 0.5), fontWeight: '900' }}>?</Text>}
        </View>
      </Animated.View>
    </Pressable>
  );
}
function MemoryMatch({ onExit }) {
  const EMO = ['🔥', '💎', '🌙', '⚡', '🎯', '🌊', '🍎', '👾', '🚀', '💀', '🌈', '🦄', '🍕', '🎸', '🐙', '🌵', '🍩', '👑'];
  const COLORS = [C.red, C.cyan, C.violet, C.amber, C.pink, C.blue, C.lime, C.orange];
  const later = useTimeouts();
  const fx = useFX();
  const [best, submitBest] = useBest('memory');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);
  const levelCfg = lv => { const pairs = Math.min(15, 5 + lv); const cols = pairs <= 6 ? 3 : pairs <= 10 ? 4 : 5; return { pairs, cols, time: 22 + pairs * 6 }; };
  const build = (lv, score, combo) => {
    const cfg = levelCfg(lv);
    const faces = shuffle(EMO).slice(0, cfg.pairs);
    const cards = shuffle([...faces, ...faces]).map((e, i) => ({ id: i, e, c: COLORS[EMO.indexOf(e) % COLORS.length], up: true, matched: false, wrong: 0 }));
    return { lv, cfg, cards, first: null, lock: true, time: cfg.time, score, combo, maxCombo: 0, moves: 0, matches: 0, peek: true, over: false };
  };
  if (!g.current) g.current = build(1, 0, 0);
  const startLevel = (lv, score) => {
    const s = build(lv, score, 0); g.current = s; force();
    later(() => { s.cards.forEach(c => { c.up = false; }); s.lock = false; s.peek = false; force(); }, 1300 + s.cfg.pairs * 60);
  };
  const start = () => { fx.clear(); setPhase('play'); startLevel(1, 0); };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.peek || s.over) return;
    s.time -= dt;
    if (s.time <= 0) { s.time = 0; s.over = true; hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  });
  const flip = i => {
    const s = g.current;
    if (phase !== 'play' || s.lock || s.over) return;
    const c = s.cards[i];
    if (c.up || c.matched) return;
    c.up = true; hx.tick();
    if (s.first == null) { s.first = i; force(); return; }
    const a = s.cards[s.first]; s.moves += 1;
    if (a.e === c.e) {
      a.matched = c.matched = true; s.first = null; s.matches += 1; s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
      const pts = 100 * s.combo; s.score += pts; hx.good();
      fx.pop(AREA_W / 2, AREA_H * 0.12, `+${pts}${s.combo > 1 ? ` · RACHA ×${s.combo}` : ''}`, C.amber, 18);
      if (s.matches >= s.cfg.pairs) {
        s.lock = true; const bonus = Math.round(s.time * 10); s.score += bonus; hx.win(); fx.flash('#fff', 0.3);
        fx.pop(AREA_W / 2, AREA_H / 2, `NIVEL ${s.lv} · BONUS +${bonus}`, C.lime, 22);
        later(() => startLevel(s.lv + 1, s.score), 1400);
      }
    } else {
      s.lock = true; s.combo = 0; const f = s.first; s.first = null; a.wrong += 1; c.wrong += 1; hx.warn();
      later(() => { a.up = false; c.up = false; s.lock = false; force(); }, 650);
    }
    force();
  };
  const s = g.current;
  const rows = Math.ceil(s.cards.length / s.cfg.cols);
  const cell = Math.min(Math.floor((AREA_W - 24) / s.cfg.cols), Math.floor((AREA_H - 90) / rows), 104);
  return (
    <GameScreen title="MEMORY MATCH" emoji="🃏" accent={C.violet} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: s.time < 8 ? C.red : C.text, fontWeight: '900', fontSize: 15 }}>⏱ {Math.ceil(s.time)}s</Text><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.violet, fontWeight: '800' }}>{s.lv}</Text> · Pares {s.matches}/{s.cfg.pairs}</Text><View style={{ minWidth: 70, alignItems: 'flex-end' }}>{s.combo > 1 ? <Combo n={s.combo} color={C.violet} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#090516" border={alpha(C.violet, 0.4)}>
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: cell * s.cfg.cols }}>
            {s.cards.map((c, i) => <MemoryCard key={`${s.lv}-${c.id}`} up={c.up} matched={c.matched} emoji={c.e} color={c.c} size={cell} wrong={c.wrong} onPress={() => flip(i)} />)}
          </View>
          {s.peek && phase === 'play' && <Text style={{ color: C.amber, fontWeight: '900', letterSpacing: 2, marginTop: 12 }}>¡MEMORIZA!</Text>}
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🃏" title={phase === 'over' ? '¡SE ACABÓ EL TIEMPO!' : 'MEMORY MATCH'}
          subtitle={phase === 'over' ? `Llegaste al nivel ${s.lv} · mejor racha ${s.maxCombo}` : 'Encuentra todos los pares'}
          score={s.score} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Al empezar verás las cartas un instante', 'Cada nivel tiene más pares y menos tiempo', 'Los pares seguidos multiplican los puntos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────
// ASTEROID DODGE
const AD_SHIP_W = 36;
const AD_ASTER_SIZE = 30;
function AsteroidDodge({ onExit }) {
  const SY = AREA_H - 84;
  const fx = useFX();
  const [best, submitBest] = useBest('asteroid');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const stars = useRef(makeStars(50)).current;
  const initState = () => ({ x: AREA_W / 2, tx: AREA_W / 2, t: 0, bonus: 0, rocks: [], items: [], spawn: 1, slow: 0, shield: 0, near: 0, shower: 18, showerLeft: 0, banner: null });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };

  const die = s => {
    fx.burst(s.x, SY, C.orange, 30, 280, 0.8, 6); fx.shake(12, 0.4); fx.flash(C.red, 0.4); hx.die();
    const score = Math.floor(s.t * 10) + s.bonus;
    setRes({ isNew: submitBest(score) });
    setPhase('over');
  };

  useLoop(phase === 'play', rawDt => {
    const s = g.current;
    const k = s.slow > 0 ? 0.45 : 1;
    const dt = rawDt * k;
    s.t += rawDt;
    if (s.slow > 0) s.slow -= rawDt;
    if (s.banner) { s.banner.t -= rawDt; if (s.banner.t <= 0) s.banner = null; }
    s.x += (s.tx - s.x) * Math.min(1, rawDt * 18);
    const diff = Math.min(1, s.t / 90);
    // spawns
    s.spawn -= dt;
    if (s.spawn <= 0) {
      const r = rand(12, 20 + diff * 16);
      s.rocks.push({ id: uid(), x: rand(r, AREA_W - r), y: -r - 10, r, vy: rand(150, 230) + diff * 220, vx: rand(-40, 40), rot: 0, vr: rand(-3, 3), g: false });
      s.spawn = Math.max(0.16, 0.62 - diff * 0.42) * (s.showerLeft > 0 ? 0.35 : 1);
      if (Math.random() < 0.07) s.items.push({ id: uid(), x: rand(20, AREA_W - 20), y: -20, type: pick(['slow', 'shield', 'star', 'star']) });
    }
    s.shower -= rawDt;
    if (s.shower <= 0) { s.shower = 22; s.showerLeft = 4; s.banner = { text: '☄️ ¡LLUVIA DE METEORITOS!', t: 1.8 }; hx.warn(); }
    if (s.showerLeft > 0) s.showerLeft -= rawDt;
    s.rocks.forEach(r => { r.y += r.vy * dt; r.x += r.vx * dt; r.rot += r.vr * dt; });
    s.items.forEach(it => { it.y += 110 * dt; });
    s.rocks = s.rocks.filter(r => r.y < AREA_H + 50);
    s.items = s.items.filter(it => it.y < AREA_H + 30);
    // colisiones
    for (let i = s.rocks.length - 1; i >= 0; i--) {
      const r = s.rocks[i];
      const d = Math.hypot(r.x - s.x, r.y - (SY + 4));
      if (d < r.r + 10) {
        if (s.shield > 0) {
          s.shield -= 1; s.rocks.splice(i, 1);
          fx.burst(r.x, r.y, C.cyan, 12, 180); fx.ring(s.x, SY, C.cyan, 60); fx.shake(5); hx.hit();
          continue;
        }
        die(s);
        return;
      }
      if (!r.g && d < r.r + 30 && r.y > SY - 4) {
        r.g = true; s.near += 1; s.bonus += 15;
        fx.pop(s.x, SY - 28, 'CERCA +15', C.amber, 13); hx.tick();
      }
    }
    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i];
      if (Math.hypot(it.x - s.x, it.y - SY) < 26) {
        s.items.splice(i, 1); hx.good();
        fx.ring(it.x, it.y, C.lime, 44);
        if (it.type === 'slow') { s.slow = 5; fx.pop(it.x, it.y, 'CÁMARA LENTA', C.violet, 14); }
        else if (it.type === 'shield') { s.shield = Math.min(2, s.shield + 1); fx.pop(it.x, it.y, 'ESCUDO', C.cyan, 14); }
        else { s.bonus += 50; fx.pop(it.x, it.y, '+50', C.amber, 16); }
      }
    }
  });

  const pan = usePan(fx, {
    down: x => { g.current.tx = clamp(x, 16, AREA_W - 16); },
    move: x => { g.current.tx = clamp(x, 16, AREA_W - 16); },
  });
  const s = g.current;
  const score = Math.floor(s.t * 10) + s.bonus;
  return (
    <GameScreen title="ASTEROID DODGE" emoji="☄️" accent={C.cyan} onExit={onExit} score={score} best={best}
      hud={<>
        <Text style={{ color: C.dim, fontSize: 12 }}>Cerca: <Text style={{ color: C.amber, fontWeight: '800' }}>{s.near}</Text></Text>
        <Text style={{ color: C.violet, fontSize: 12, fontWeight: '800' }}>{s.slow > 0 ? `⏳ ${s.slow.toFixed(1)}s` : ''}{s.shield > 0 ? `  🛡️×${s.shield}` : ''}</Text>
        <Text style={{ color: C.dim, fontSize: 12 }}>{Math.floor(s.t)}s</Text>
      </>}>
      <PlayArea fx={fx} bg="#03030c" {...pan}>
        <Starfield stars={stars} offset={s.t * (s.slow > 0 ? 40 : 140)} />
        {s.slow > 0 && <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, backgroundColor: alpha(C.violet, 0.08) }} />}
        {s.items.map(it => (
          <View key={it.id} style={{ position: 'absolute', left: it.x - 15, top: it.y - 15, width: 30, height: 30, borderRadius: 15, backgroundColor: alpha(C.lime, 0.15), borderWidth: 1, borderColor: C.lime, alignItems: 'center', justifyContent: 'center', ...glow(C.lime, 8, 0.7) }}>
            <Text style={{ fontSize: 15 }}>{it.type === 'slow' ? '⏳' : it.type === 'shield' ? '🛡️' : '⭐'}</Text>
          </View>
        ))}
        {s.rocks.map(r => (
          <View key={r.id} style={{ position: 'absolute', left: r.x - r.r, top: r.y - r.r, width: r.r * 2, height: r.r * 2, borderRadius: r.r * 0.9, backgroundColor: '#3a2f2a', borderWidth: 2, borderColor: '#8a6a55', transform: [{ rotate: `${r.rot}rad` }], ...glow('#ff7a3d', 8, 0.35) }}>
            <View style={{ position: 'absolute', left: r.r * 0.35, top: r.r * 0.3, width: r.r * 0.5, height: r.r * 0.4, borderRadius: r.r * 0.25, backgroundColor: '#26201c' }} />
            <View style={{ position: 'absolute', left: r.r * 1.1, top: r.r * 1.1, width: r.r * 0.4, height: r.r * 0.3, borderRadius: r.r * 0.2, backgroundColor: '#26201c' }} />
          </View>
        ))}
        {phase !== 'over' && (
          <View style={{ position: 'absolute', left: s.x - 17, top: SY - 20, width: 34, height: 40, alignItems: 'center' }}>
            <View style={{ width: 0, height: 0, borderLeftWidth: 17, borderRightWidth: 17, borderBottomWidth: 34, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: C.cyan }} />
            <View style={{ position: 'absolute', top: 12, width: 8, height: 12, borderRadius: 4, backgroundColor: '#06101c' }} />
            <View style={{ width: 8, height: 8 + (Math.floor(s.t * 30) % 3) * 3, borderRadius: 4, backgroundColor: C.orange, ...glow(C.orange, 8, 1) }} />
            {s.shield > 0 && <View style={{ position: 'absolute', left: -8, top: -8, width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: alpha(C.cyan, 0.8), backgroundColor: alpha(C.cyan, 0.1) }} />}
          </View>
        )}
        {s.banner && <Text style={{ position: 'absolute', top: AREA_H * 0.25, width: AREA_W, textAlign: 'center', color: C.orange, fontSize: 20, fontWeight: '900', letterSpacing: 2, ...tglow(C.orange, 12, 1) }}>{s.banner.text}</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="☄️" title={phase === 'over' ? 'IMPACTO' : 'ASTEROID DODGE'}
          subtitle={phase === 'over' ? `Sobreviviste ${Math.floor(s.t)} segundos` : 'Sobrevive el mayor tiempo posible'}
          score={score} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Desliza el dedo para mover la nave', 'Roza las rocas para ganar bonus "CERCA"', '⏳ cámara lenta · 🛡️ escudo · ⭐ puntos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────
// TOWER STACK
function TowerStack({ onExit }) {
  const BH = 28, BASE = Math.min(170, AREA_W * 0.46), FLOORY = AREA_H - 60;
  const fx = useFX();
  const [best, submitBest] = useBest('towerstack');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const stars = useRef(makeStars(40)).current;
  const initState = () => ({ stack: [{ x: (AREA_W - BASE) / 2, w: BASE, hue: 200 }], cur: { x: 0, w: BASE, dir: 1, hue: 214 }, speed: 170, cam: 0, debris: [], score: 0, perfect: 0, maxPerfect: 0, t: 0, over: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const topY = (s, i) => FLOORY - (i + 1) * BH + s.cam;
  const drop = () => {
    const s = g.current;
    if (phase !== 'play') return;
    const prev = s.stack[s.stack.length - 1];
    const c = s.cur;
    const left = Math.max(prev.x, c.x), right = Math.min(prev.x + prev.w, c.x + c.w);
    const ov = right - left;
    const n = s.stack.length;
    const y = topY(s, n);
    if (ov <= 0) {
      s.debris.push({ x: c.x, y, w: c.w, vy: 0, vx: c.dir * 40, hue: c.hue, rot: 0 });
      fx.shake(8, 0.3); fx.flash(C.red, 0.25); hx.die();
      setRes({ isNew: submitBest(s.score) });
      setPhase('over');
      return;
    }
    let nx = left, nw = ov;
    if (Math.abs(c.x - prev.x) < 6) {
      nx = prev.x; nw = prev.w; s.perfect += 1; s.maxPerfect = Math.max(s.maxPerfect, s.perfect);
      if (s.perfect >= 3) nw = Math.min(BASE, nw + 6);
      s.score += 2 + s.perfect;
      fx.ring(AREA_W / 2, y + BH / 2, C.lime, 90); fx.pop(AREA_W / 2, y - 14, s.perfect > 1 ? `¡PERFECTO ×${s.perfect}!` : '¡PERFECTO!', C.lime, 18); hx.good();
    } else {
      s.perfect = 0; s.score += 1;
      const cutL = left - c.x, cutR = (c.x + c.w) - right;
      if (cutL > 0) s.debris.push({ x: c.x, y, w: cutL, vy: 0, vx: -40, hue: c.hue, rot: 0 });
      if (cutR > 0) s.debris.push({ x: right, y, w: cutR, vy: 0, vx: 40, hue: c.hue, rot: 0 });
      hx.hit();
    }
    s.stack.push({ x: nx, w: nw, hue: c.hue });
    s.speed = Math.min(430, 170 + s.stack.length * 5);
    const hue = (c.hue + 13) % 360;
    s.cur = { x: s.cur.dir > 0 ? -nw : AREA_W, w: nw, dir: -s.cur.dir, hue };
    s.cur.x = s.cur.dir > 0 ? -nw + 10 : AREA_W - 10;
  };
  useLoop(phase !== 'ready', dt => {
    const s = g.current;
    s.t += dt;
    const targetCam = Math.max(0, (s.stack.length - 7) * BH);
    s.cam += (targetCam - s.cam) * Math.min(1, dt * 5);
    s.debris.forEach(d => { d.vy += 1500 * dt; d.y += d.vy * dt; d.x += d.vx * dt; d.rot += d.vx * dt * 0.004; });
    s.debris = s.debris.filter(d => d.y < AREA_H + 100);
    if (phase !== 'play') return;
    const c = s.cur;
    c.x += c.dir * s.speed * dt;
    if (c.x + c.w > AREA_W - 4) { c.x = AREA_W - 4 - c.w; c.dir = -1; }
    if (c.x < 4) { c.x = 4; c.dir = 1; }
  });
  const pan = usePan(fx, { down: drop });
  const s = g.current;
  const n = s.stack.length;
  const blk = (x, y, w, hue, extra) => ({ position: 'absolute', left: x, top: y, width: w, height: BH - 2, borderRadius: 5, backgroundColor: `hsl(${hue},80%,52%)`, borderWidth: 1.5, borderColor: `hsl(${hue},95%,72%)`, ...glow(`hsl(${hue},90%,55%)`, 8, 0.5), ...extra });
  return (
    <GameScreen title="TOWER STACK" emoji="🏗️" accent={C.amber} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Pisos <Text style={{ color: C.amber, fontWeight: '800' }}>{n - 1}</Text></Text>{s.perfect > 1 ? <Combo n={s.perfect} color={C.lime} /> : <Text style={{ color: C.dim, fontSize: 12 }}>3 perfectos recuperan ancho</Text>}</>}>
      <PlayArea fx={fx} bg="#07071a" border={alpha(C.amber, 0.35)} {...pan}>
        <Starfield stars={stars} offset={s.cam * 0.3} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: FLOORY + s.cam, height: 400, backgroundColor: '#12122a', borderTopWidth: 2, borderTopColor: alpha(C.amber, 0.6) }} />
        {s.stack.map((b, i) => { const y = topY(s, i); if (y > AREA_H || y < -BH) return null; return <View key={i} style={blk(b.x, y, b.w, b.hue)} />; })}
        {phase === 'play' && <View style={blk(s.cur.x, topY(s, n), s.cur.w, s.cur.hue)} />}
        {s.debris.map((d, i) => <View key={i} style={blk(d.x, d.y, d.w, d.hue, { transform: [{ rotate: `${d.rot}rad` }], opacity: 0.85 })} />)}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🏗️" title={phase === 'over' ? 'SE DERRUMBÓ' : 'TOWER STACK'}
          subtitle={phase === 'over' ? `${n - 1} ${n - 1 === 1 ? 'piso' : 'pisos'} · mejor racha perfecta ${s.maxPerfect}` : 'Apila hasta el cielo'}
          score={s.score} best={best} isNew={res.isNew} accent={C.amber} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca para soltar el bloque', 'Lo que sobresale se corta', 'Los encajes perfectos dan bonus y devuelven ancho'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────
// NUMBER PUZZLE (Slide 15-puzzle)
function NumberPuzzle({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('puzzle');
  const [phase, setPhase] = useState('ready');
  const [size, setSize] = useState(4);
  const [res, setRes] = useState({ isNew: false, pts: 0 });
  const BS = Math.min(AREA_W - 24, AREA_H - 150, 420);
  const mk = n => {
    const grid = []; for (let i = 0; i < n * n - 1; i++) grid.push(i + 1); grid.push(0);
    let e = n * n - 1;
    let prev = -1;
    for (let k = 0; k < 120 * n; k++) {
      const r = Math.floor(e / n), c = e % n, opts = [];
      if (r > 0) opts.push(e - n); if (r < n - 1) opts.push(e + n); if (c > 0) opts.push(e - 1); if (c < n - 1) opts.push(e + 1);
      const o = pick(opts.filter(x => x !== prev));
      grid[e] = grid[o]; grid[o] = 0; prev = e; e = o;
    }
    return grid;
  };
  const initState = n => { const grid = mk(n); return { n, grid, moves: 0, t: 0, solved: false, pos: grid.map((v, i) => ({ x: (i % n), y: Math.floor(i / n) })), started: false }; };
  const g = useRef(null);
  if (!g.current) g.current = initState(4);
  const start = () => { fx.clear(); g.current = initState(size); setPhase('play'); };
  const gap = 6;
  const cellOf = n => (BS - gap * (n + 1)) / n;
  const tapCell = i => {
    const s = g.current;
    if (phase !== 'play' || s.solved) return;
    const n = s.n; const r = Math.floor(i / n), c = i % n;
    const e = s.grid.indexOf(0); const er = Math.floor(e / n), ec = e % n;
    if (r !== er && c !== ec) { hx.tick(); return; }
    if (r === er && c === ec) return;
    const dr = Math.sign(er - r), dc = Math.sign(ec - c);
    // mover en cadena desde el hueco hacia la ficha pulsada
    let cr = er, cc = ec;
    while (cr !== r || cc !== c) { const pr = cr - dr, pc = cc - dc; s.grid[cr * n + cc] = s.grid[pr * n + pc]; cr = pr; cc = pc; }
    s.grid[r * n + c] = 0;
    s.moves += 1; s.started = true; hx.tap();
    if (s.grid.every((v, k) => v === (k === n * n - 1 ? 0 : k + 1))) {
      s.solved = true;
      const pts = Math.max(100, n * n * 100 - s.moves * 4 - Math.round(s.t) * 5);
      hx.win(); fx.flash('#fff', 0.3);
      for (let k = 0; k < 6; k++) fx.burst(rand(40, AREA_W - 40), rand(80, AREA_H * 0.5), pick([C.cyan, C.pink, C.amber, C.lime]), 16, 260, 0.9, 5);
      setRes({ isNew: submitBest(pts), pts });
      setTimeout(() => setPhase('over'), 900);
    }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.started && !s.solved) s.t += dt;
    s.pos.forEach((p, id) => { /* posiciones por ficha (id = valor) se calculan abajo */ });
  });
  const s = g.current; const n = s.n; const cell = cellOf(n);
  // posición animada por valor
  const anim = useRef({}).current;
  s.grid.forEach((v, i) => {
    if (!v) return;
    const tx = gap + (i % n) * (cell + gap), ty = gap + Math.floor(i / n) * (cell + gap);
    const a = anim[v] || (anim[v] = { x: tx, y: ty });
    a.x += (tx - a.x) * 0.35; a.y += (ty - a.y) * 0.35;
    if (Math.abs(a.x - tx) < 0.5) a.x = tx; if (Math.abs(a.y - ty) < 0.5) a.y = ty;
  });
  const mins = Math.floor(s.t / 60), secs = Math.floor(s.t % 60);
  const hue = v => (v * 360 / (n * n)) % 360;
  return (
    <GameScreen title="15 PUZZLE" emoji="🧩" accent={C.cyan} onExit={onExit} score={res.pts || 0} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Movimientos <Text style={{ color: C.cyan, fontWeight: '800' }}>{s.moves}</Text></Text><Text style={{ color: C.text, fontWeight: '900', fontSize: 15 }}>⏱ {mins}:{String(secs).padStart(2, '0')}</Text><Text style={{ color: C.dim, fontSize: 12 }}>{n}×{n}</Text></>}>
      <PlayArea fx={fx} bg="#050a14" border={alpha(C.cyan, 0.4)}>
        <View style={{ position: 'absolute', left: (AREA_W - BS) / 2, top: 28, width: BS, height: BS, borderRadius: 18, backgroundColor: alpha(C.cyan, 0.06), borderWidth: 2, borderColor: alpha(C.cyan, 0.35) }}>
          {s.grid.map((v, i) => {
            if (!v) return null;
            const a = anim[v] || { x: 0, y: 0 };
            const inPlace = v === i + 1;
            const h = hue(v);
            return (
              <Pressable key={v} testID={`pz-${v}`} onPress={() => tapCell(i)} style={{ position: 'absolute', left: a.x, top: a.y, width: cell, height: cell }}>
                <View style={{ flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: `hsla(${h},80%,50%,${inPlace ? 0.35 : 0.18})`, borderWidth: 2, borderColor: `hsl(${h},90%,${inPlace ? 68 : 58}%)`, ...glow(`hsl(${h},90%,60%)`, inPlace ? 10 : 4, 0.5) }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: cell * 0.42 }}>{v}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text pointerEvents="none" style={{ position: 'absolute', top: 28 + BS + 14, width: AREA_W, textAlign: 'center', color: alpha(C.dim, 0.8), fontSize: 12, fontWeight: '700' }}>Toca una ficha de la fila o columna del hueco para deslizarla</Text>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 16, alignItems: 'center' }}><Btn label="🔀 REINICIAR" small ghost color={C.cyan} onPress={start} /></View>
        <Overlay show={phase !== 'play'} kind={phase === 'over' ? 'win' : phase} emoji="🧩" title={phase === 'over' ? '¡RESUELTO!' : '15 PUZZLE'}
          subtitle={phase === 'over' ? `${s.moves} movimientos · ${mins}:${String(secs).padStart(2, '0')}` : 'Ordena los números del 1 al ' + (size * size - 1)}
          score={res.pts} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          extra={<View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>{[3, 4, 5].map(k => <Btn key={k} label={`${k}×${k}`} small ghost={size !== k} color={C.cyan} onPress={() => setSize(k)} />)}</View>}
          lines={phase === 'ready' ? ['Menos movimientos y menos tiempo = más puntos', 'Tableros más grandes valen más'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────
// COIN COLLECTOR
function CoinCollector({ onExit }) {
  const DUR = 30;
  const fx = useFX();
  const [best, submitBest] = useBest('coinrush');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({ time: DUR, t: 0, score: 0, combo: 0, maxCombo: 0, coins: [], spawn: 0.3, frenzy: 0, taps: 0, hits: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const multOf = s => (1 + (s.combo >= 5 ? 1 : 0) + (s.combo >= 15 ? 1 : 0) + (s.combo >= 30 ? 1 : 0)) * (s.frenzy > 0 ? 2 : 1);
  const spawn = s => {
    const r = Math.random();
    const type = r < 0.62 ? 'coin' : r < 0.74 ? 'gold' : r < 0.9 ? 'bomb' : 'clock';
    const size = type === 'gold' ? 38 : 46;
    const life = (type === 'gold' ? 0.9 : 1.5) * Math.max(0.55, 1 - s.t * 0.012);
    s.coins.push({ id: uid(), type, size, x: rand(size / 2 + 6, AREA_W - size / 2 - 6), y: rand(size / 2 + 6, AREA_H - size / 2 - 6), age: 0, life });
  };
  const tap = (x, y) => {
    const s = g.current;
    if (phase !== 'play') return;
    s.taps += 1;
    let idx = -1, bd = 1e9;
    s.coins.forEach((c, i) => { const d = Math.hypot(c.x - x, c.y - y); if (d < c.size / 2 + 12 && d < bd) { bd = d; idx = i; } });
    if (idx < 0) { s.combo = 0; hx.tick(); return; }
    const c = s.coins.splice(idx, 1)[0];
    s.hits += 1;
    if (c.type === 'bomb') {
      s.time = Math.max(0, s.time - 3); s.combo = 0;
      fx.burst(c.x, c.y, C.red, 22, 260); fx.shake(9, 0.3); fx.flash(C.red, 0.3); fx.pop(c.x, c.y, '-3s', C.red, 22); hx.bad();
    } else if (c.type === 'clock') {
      s.time += 2; fx.burst(c.x, c.y, C.lime, 12, 190); fx.pop(c.x, c.y, '+2s', C.lime, 22); hx.good();
    } else {
      s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
      const base = c.type === 'gold' ? 5 : 1;
      const pts = base * multOf(s);
      s.score += pts;
      fx.burst(c.x, c.y, C.amber, 10, 200, 0.5, 4); fx.pop(c.x, c.y - 10, `+${pts}`, multOf(s) > 1 ? C.amber : C.text, 16); hx.hit();
      if (s.combo > 0 && s.combo % 12 === 0) { s.frenzy = 5; fx.flash(C.amber, 0.25); fx.pop(AREA_W / 2, AREA_H / 2, '¡FRENESÍ!', C.amber, 28); hx.win(); }
    }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt; s.time -= dt;
    if (s.frenzy > 0) s.frenzy = Math.max(0, s.frenzy - dt);
    s.spawn -= dt;
    if (s.spawn <= 0) { spawn(s); s.spawn = Math.max(0.16, 0.5 - s.t * 0.01) * (s.frenzy > 0 ? 0.4 : 1) * rand(0.7, 1.2); }
    for (let i = s.coins.length - 1; i >= 0; i--) {
      const c = s.coins[i];
      c.age += dt;
      if (c.age >= c.life) {
        s.coins.splice(i, 1);
        if (c.type === 'coin' || c.type === 'gold') s.combo = 0;
      }
    }
    if (s.time <= 0) { s.time = 0; hx.win(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  });
  const pan = usePan(fx, { down: tap });
  const s = g.current;
  const E = { coin: '🪙', gold: '🥇', bomb: '💣', clock: '⏱️' };
  const m = multOf(s);
  return (
    <GameScreen title="COIN RUSH" emoji="🪙" accent={C.amber} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: s.time < 8 ? C.red : C.text, fontWeight: '900', fontSize: 15 }}>⏱ {Math.ceil(s.time)}s</Text>{s.frenzy > 0 ? <Text style={{ color: C.amber, fontWeight: '900', fontSize: 13 }}>🔥 FRENESÍ {Math.ceil(s.frenzy)}</Text> : <Text style={{ color: C.dim, fontSize: 12 }}>Racha {s.combo}</Text>}<View style={{ minWidth: 64, alignItems: 'flex-end' }}>{m > 1 ? <Combo n={m} /> : null}</View></>}>
      <PlayArea fx={fx} bg={s.frenzy > 0 ? '#1a0f02' : '#0a0803'} border={alpha(C.amber, 0.4)} {...pan}>
        <GridBg color={C.amber} step={46} />
        {s.coins.map(c => {
          const pop = Math.min(1, c.age * 7);
          const left = 1 - c.age / c.life;
          return (
            <View key={c.id} style={{ position: 'absolute', left: c.x - c.size / 2, top: c.y - c.size / 2, width: c.size, height: c.size, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pop * (left < 0.25 ? 0.85 + Math.sin(c.age * 40) * 0.1 : 1) }], opacity: left < 0.25 ? 0.7 : 1 }}>
              <View style={{ position: 'absolute', width: c.size + 8, height: c.size + 8, borderRadius: (c.size + 8) / 2, borderWidth: 2, borderColor: c.type === 'bomb' ? alpha(C.red, 0.5) : alpha(C.amber, 0.5 * left + 0.1) }} />
              <Text style={{ fontSize: c.size - 10 }}>{E[c.type]}</Text>
            </View>
          );
        })}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🪙" title={phase === 'over' ? '¡TIEMPO!' : 'COIN RUSH'}
          subtitle={phase === 'over' ? `Precisión ${s.taps ? Math.round((s.hits / s.taps) * 100) : 0}% · Mejor racha ${s.maxCombo}` : '30 segundos para recoger monedas'}
          score={s.score} best={best} isNew={res.isNew} accent={C.amber} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca las monedas antes de que desaparezcan', '🥇 vale 5 · ⏱️ +2s · 💣 -3s', 'Las rachas suben el multiplicador y activan el frenesí'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────
// REACTION TIME
function ReactionTime({ onExit }) {
  const ROUNDS = 5;
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('reaction', true);
  const [phase, setPhase] = useState('ready');         // ready | play | over
  const [st, setSt] = useState('wait');                // wait | go | early | result
  const [round, setRound] = useState(0);
  const [times, setTimes] = useState([]);
  const [last, setLast] = useState(0);
  const [target, setTarget] = useState({ x: 100, y: 200 });
  const [res, setRes] = useState({ isNew: false });
  const goAt = useRef(0); const gen = useRef(0);
  const GRADE = ms => (ms < 220 ? ['⚡ SOBREHUMANO', C.cyan] : ms < 280 ? ['🐆 RAPIDÍSIMO', C.lime] : ms < 340 ? ['🐇 BUEN REFLEJO', C.amber] : ms < 450 ? ['🚶 NORMAL', C.orange] : ['🐢 DESPIERTA', C.red]);
  const arm = r => {
    const id = ++gen.current;
    setRound(r); setSt('wait');
    later(() => {
      if (gen.current !== id) return;
      if (r % 2 === 1) setTarget({ x: rand(50, AREA_W - 50), y: rand(120, AREA_H - 110) });
      goAt.current = Date.now(); setSt('go');
    }, rand(1200, 3600));
  };
  const start = () => { fx.clear(); gen.current += 1; setTimes([]); setPhase('play'); arm(0); };
  const hitGo = () => {
    const ms = Date.now() - goAt.current;
    setLast(ms); hx.hit();
    const list = [...times, ms]; setTimes(list);
    fx.burst(round % 2 ? target.x : AREA_W / 2, round % 2 ? target.y : AREA_H / 2, GRADE(ms)[1], 18, 240);
    if (list.length >= ROUNDS) {
      const avg = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
      later(() => { hx.win(); setRes({ isNew: submitBest(avg), avg }); setPhase('over'); }, 700);
      setSt('result');
    } else { setSt('result'); later(() => arm(round + 1), 1100); }
  };
  const press = (onTarget) => {
    if (phase !== 'play') return;
    if (st === 'wait') { gen.current += 1; setSt('early'); hx.bad(); fx.shake(6, 0.25); later(() => arm(round), 1300); return; }
    if (st === 'go') { if (round % 2 === 1 && !onTarget) return; hitGo(); }
  };
  const avgNow = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const bg = st === 'go' && round % 2 === 0 ? '#06371b' : st === 'early' ? '#3a0a14' : '#0d0a18';
  const targetMode = round % 2 === 1;
  const finalAvg = res.avg || avgNow;
  return (
    <GameScreen title="REFLEJOS" emoji="⚡" accent={C.pink} onExit={onExit} score={phase === 'over' ? finalAvg : avgNow} scoreLabel="MEDIA ms" best={best} bestLabel="MEJOR ms"
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Ronda <Text style={{ color: C.pink, fontWeight: '800' }}>{Math.min(ROUNDS, times.length + (st === 'result' ? 0 : 1))}/{ROUNDS}</Text></Text><View style={{ flexDirection: 'row', gap: 4 }}>{Array.from({ length: ROUNDS }, (_, i) => <View key={i} style={{ width: 22, height: 6, borderRadius: 3, backgroundColor: i < times.length ? C.pink : alpha(C.pink, 0.2) }} />)}</View><Text style={{ color: C.dim, fontSize: 12 }}>{targetMode ? 'Toca el objetivo' : 'Toca la pantalla'}</Text></>}>
      <PlayArea fx={fx} bg={bg} border={alpha(C.pink, 0.4)}>
        <Pressable testID="rt-area" onPressIn={() => press(false)} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: AREA_H * 0.28, alignItems: 'center' }}>
          {st === 'wait' && <><Text style={{ fontSize: 56 }}>✋</Text><Text style={{ color: C.text, fontSize: 24, fontWeight: '900', letterSpacing: 2, marginTop: 8 }}>ESPERA…</Text><Text style={{ color: C.dim, marginTop: 6 }}>{targetMode ? 'Aparecerá un objetivo' : 'Toca cuando se ponga verde'}</Text></>}
          {st === 'go' && !targetMode && <><Text style={{ fontSize: 56 }}>👆</Text><Text style={{ color: C.lime, fontSize: 40, fontWeight: '900', letterSpacing: 3, ...tglow(C.lime, 16) }}>¡YA!</Text></>}
          {st === 'early' && <><Text style={{ fontSize: 56 }}>🙈</Text><Text style={{ color: C.red, fontSize: 24, fontWeight: '900', marginTop: 8 }}>¡DEMASIADO PRONTO!</Text></>}
          {st === 'result' && <><Text style={{ color: GRADE(last)[1], fontSize: 60, fontWeight: '900', ...tglow(GRADE(last)[1], 16) }}>{last} ms</Text><Text style={{ color: GRADE(last)[1], fontSize: 16, fontWeight: '900', marginTop: 6 }}>{GRADE(last)[0]}</Text></>}
        </View>
        {st === 'go' && targetMode && (
          <Pressable testID="rt-target" onPressIn={() => press(true)} style={{ position: 'absolute', left: target.x - 40, top: target.y - 40, width: 80, height: 80 }}>
            <View style={{ flex: 1, borderRadius: 40, backgroundColor: C.lime, borderWidth: 4, borderColor: '#fff', ...glow(C.lime, 24, 1) }} />
          </Pressable>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji="⚡" title={phase === 'over' ? GRADE(finalAvg)[0] : 'REFLEJOS'}
          subtitle={phase === 'over' ? `Tus tiempos: ${times.join(' · ')} ms` : '5 rondas · mide tu tiempo de reacción'}
          score={finalAvg} scoreLabel="MEDIA (ms)" best={best} isNew={res.isNew} accent={C.pink} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Pantalla verde: toca lo más rápido posible', 'Rondas alternas: toca el objetivo que aparece', 'Si tocas antes de tiempo, repites la ronda'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────
// COLOR RUSH – tap the correct color name
function ColorRush({ onExit }) {
  const COLS6 = [
    { n: 'ROJO', c: C.red }, { n: 'AZUL', c: C.blue }, { n: 'VERDE', c: C.lime },
    { n: 'AMARILLO', c: C.amber }, { n: 'MORADO', c: C.violet }, { n: 'NARANJA', c: C.orange },
  ];
  const fx = useFX();
  const [best, submitBest] = useBest('colorrush');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const newQ = s => {
    const n = s.ok >= 14 ? 6 : 4;
    const w = randInt(0, n - 1);
    const ink = Math.random() < 0.35 ? w : randInt(0, n - 1);
    s.q = { w, ink, n, t: 0, limit: Math.max(1.0, 2.8 - s.ok * 0.05) };
  };
  const initState = () => { const s = { ok: 0, score: 0, lives: 3, combo: 0, maxCombo: 0, rule: 'ink', ruleLeft: 6, q: null, t: 0, flash: null, banner: null }; newQ(s); return s; };
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const wrong = (s, why) => {
    s.lives -= 1; s.combo = 0; s.flash = { c: C.red, t: 0.25 }; fx.shake(7, 0.25); fx.flash(C.red, 0.2); hx.bad();
    if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score), why }); setPhase('over'); return true; }
    newQ(s); return false;
  };
  const answer = i => {
    const s = g.current;
    if (phase !== 'play') return;
    const target = s.rule === 'ink' ? s.q.ink : s.q.w;
    if (i !== target) { wrong(s, 'fallo'); return; }
    s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo); s.ok += 1;
    const speedBonus = Math.round((1 - s.q.t / s.q.limit) * 5);
    const pts = (10 + speedBonus) * (1 + Math.floor(s.combo / 8));
    s.score += pts; s.flash = { c: C.lime, t: 0.2 };
    fx.pop(AREA_W / 2, AREA_H * 0.34, `+${pts}`, C.lime, 22); hx.hit();
    s.ruleLeft -= 1;
    if (s.ruleLeft <= 0) { s.rule = s.rule === 'ink' ? 'word' : 'ink'; s.ruleLeft = randInt(5, 8); s.banner = { t: 1.4 }; fx.flash(C.violet, 0.25); hx.warn(); }
    newQ(s);
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt; s.q.t += dt;
    if (s.flash) { s.flash.t -= dt; if (s.flash.t <= 0) s.flash = null; }
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    if (s.q.t >= s.q.limit) wrong(s, 'tiempo');
  });
  const s = g.current;
  const cols = COLS6.slice(0, s.q.n);
  const BW = (AREA_W - 48) / 2;
  const rule = s.rule === 'ink' ? 'TOCA EL COLOR DE LA TINTA' : 'TOCA LO QUE DICE LA PALABRA';
  return (
    <GameScreen title="COLOR RUSH" emoji="🎨" accent={C.pink} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.dim, fontSize: 12 }}>Aciertos <Text style={{ color: C.pink, fontWeight: '800' }}>{s.ok}</Text></Text><View style={{ minWidth: 70, alignItems: 'flex-end' }}>{s.combo > 2 ? <Combo n={s.combo} color={C.pink} /> : null}</View></>}>
      <PlayArea fx={fx} bg={s.flash ? alpha(s.flash.c, 0.1) : '#0a0612'} border={alpha(C.pink, 0.4)}>
        <View style={{ position: 'absolute', top: 18, left: 18, right: 18 }}>
          <Bar value={s.q.limit - s.q.t} max={s.q.limit} color={s.q.t / s.q.limit > 0.7 ? C.red : C.pink} h={10} />
          <Text style={{ textAlign: 'center', marginTop: 14, color: s.rule === 'ink' ? C.cyan : C.amber, fontSize: 13, fontWeight: '900', letterSpacing: 2 }}>{rule}</Text>
        </View>
        <View style={{ position: 'absolute', top: AREA_H * 0.2, left: 0, right: 0, alignItems: 'center' }}>
          <Text style={{ fontSize: 58, fontWeight: '900', letterSpacing: 2, color: cols[s.q.ink].c, ...tglow(cols[s.q.ink].c, 18) }}>{cols[s.q.w].n}</Text>
        </View>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: BW * 2 + 12, gap: 12 }}>
            {cols.map((c, i) => (
              <Pressable key={i} testID={`cr-${i}`} onPressIn={() => answer(i)} style={{ width: BW, height: s.q.n > 4 ? 72 : 96 }}>
                <View style={{ flex: 1, borderRadius: 22, backgroundColor: alpha(c.c, 0.85), borderWidth: 2, borderColor: '#fff6', ...glow(c.c, 14, 0.6) }} />
              </Pressable>
            ))}
          </View>
        </View>
        {s.banner && <View pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.45, left: 0, right: 0, alignItems: 'center' }}><Text style={{ color: C.violet, fontSize: 18, fontWeight: '900', letterSpacing: 2, ...tglow(C.violet, 12) }}>¡CAMBIÓ LA REGLA!</Text></View>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🎨" title={phase === 'over' ? 'TE CONFUNDISTE' : 'COLOR RUSH'}
          subtitle={phase === 'over' ? `${s.ok} aciertos · mejor racha ${s.maxCombo}` : 'Tu cerebro contra tus ojos'}
          score={s.score} best={best} isNew={res.isNew} accent={C.pink} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Lee la regla de arriba y toca el color correcto', 'La regla cambia cada pocos aciertos', 'Responde rápido: el tiempo se acorta'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────
// PONG SOLO – jugador vs pared rebotante
function PongSolo({ onExit }) {
  const BR = 8, PY = AREA_H - 38;
  const fx = useFX();
  const [best, submitBest] = useBest('pongsolo');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({ px: AREA_W / 2, pw: 84, ball: { x: AREA_W / 2, y: PY - 40, vx: 120, vy: -260 }, speed: 300, lives: 3, score: 0, hits: 0, bumpers: [], orb: null, orbT: 6, trail: [], t: 0, wait: 0.8, combo: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const launch = s => { const a = -Math.PI / 2 + rand(-0.4, 0.4); s.ball = { x: s.px, y: PY - 20, vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed }; s.wait = 0; s.combo = 0; };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.bumpers.forEach(b => { if (b.mv) { b.x += b.vx * dt; if (b.x < 40 || b.x > AREA_W - 40) b.vx *= -1; } });
    s.orbT -= dt; if (s.orbT <= 0 && !s.orb) { s.orb = { x: rand(50, AREA_W - 50), y: rand(120, AREA_H * 0.55), life: 7 }; s.orbT = rand(6, 11); }
    if (s.orb) { s.orb.life -= dt; if (s.orb.life <= 0) s.orb = null; }
    const b = s.ball;
    if (s.wait > 0) { s.wait -= dt; b.x = s.px; b.y = PY - 20; if (s.wait <= 0) launch(s); return; }
    const m = Math.hypot(b.vx, b.vy) || 1; b.vx *= s.speed / m; b.vy *= s.speed / m;
    b.x += b.vx * dt; b.y += b.vy * dt;
    s.trail.push({ x: b.x, y: b.y, a: 0.5 }); s.trail.forEach(p => { p.a -= dt * 2.5; }); s.trail = s.trail.filter(p => p.a > 0);
    if (b.x < BR) { b.x = BR; b.vx = Math.abs(b.vx); hx.tick(); }
    if (b.x > AREA_W - BR) { b.x = AREA_W - BR; b.vx = -Math.abs(b.vx); hx.tick(); }
    if (b.y < BR) { b.y = BR; b.vy = Math.abs(b.vy); hx.tick(); }
    if (b.vy > 0 && b.y + BR >= PY && b.y + BR <= PY + 18 && Math.abs(b.x - s.px) < s.pw / 2 + BR) {
      const rel = clamp((b.x - s.px) / (s.pw / 2 + BR), -1, 1);
      s.hits += 1; s.combo = 0; s.score += 1;
      s.speed = Math.min(620, 300 + s.hits * 5);
      s.pw = Math.max(54, 84 - Math.floor(s.hits / 6) * 4);
      const a = -Math.PI / 2 + rel * 1.05;
      b.vx = Math.cos(a) * s.speed; b.vy = Math.sin(a) * s.speed; b.y = PY - BR;
      fx.burst(b.x, PY, C.cyan, 6, 120, 0.3, 3); hx.hit();
      if (s.hits === 8) s.bumpers.push({ x: AREA_W * 0.5, y: AREA_H * 0.32, r: 20, mv: false, vx: 0 });
      if (s.hits === 20) { s.bumpers = [{ x: AREA_W * 0.3, y: AREA_H * 0.3, r: 20, mv: true, vx: 60 }, { x: AREA_W * 0.7, y: AREA_H * 0.42, r: 20, mv: true, vx: -60 }]; }
      if (s.hits === 36) s.bumpers.push({ x: AREA_W * 0.5, y: AREA_H * 0.2, r: 22, mv: true, vx: 90 });
    }
    for (const bm of s.bumpers) {
      const dx = b.x - bm.x, dy = b.y - bm.y, d = Math.hypot(dx, dy);
      if (d < bm.r + BR) {
        const nx = dx / (d || 1), ny = dy / (d || 1);
        const dot = b.vx * nx + b.vy * ny;
        b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny;
        b.x = bm.x + nx * (bm.r + BR + 1); b.y = bm.y + ny * (bm.r + BR + 1);
        s.combo += 1; const pts = 3 * s.combo; s.score += pts;
        fx.burst(bm.x + nx * bm.r, bm.y + ny * bm.r, C.pink, 10, 170); fx.pop(bm.x, bm.y - 26, `+${pts}`, C.pink, 15); fx.ring(bm.x, bm.y, C.pink, 34); hx.heavy();
      }
    }
    if (s.orb && Math.hypot(b.x - s.orb.x, b.y - s.orb.y) < BR + 16) {
      s.score += 5; fx.burst(s.orb.x, s.orb.y, C.amber, 14, 190); fx.pop(s.orb.x, s.orb.y - 20, '+5', C.amber, 17); hx.good(); s.orb = null;
    }
    if (b.y > AREA_H + 12) {
      s.lives -= 1; fx.shake(8, 0.3); fx.flash(C.red, 0.25); hx.bad();
      if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); } else { s.wait = 0.9; s.combo = 0; s.trail = []; }
    }
  });
  const pan = usePan(fx, { down: x => { const s = g.current; s.px = clamp(x, s.pw / 2, AREA_W - s.pw / 2); }, move: x => { const s = g.current; s.px = clamp(x, s.pw / 2, AREA_W - s.pw / 2); } });
  const s = g.current;
  return (
    <GameScreen title="PONG SOLO" emoji="🎾" accent={C.cyan} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.dim, fontSize: 12 }}>Rebotes <Text style={{ color: C.cyan, fontWeight: '800' }}>{s.hits}</Text></Text>{s.combo > 1 ? <Combo n={s.combo} color={C.pink} /> : <View style={{ width: 60 }} />}</>}>
      <PlayArea fx={fx} bg="#030a10" border={alpha(C.cyan, 0.4)} {...pan}>
        <GridBg color={C.cyan} step={46} />
        {s.trail.map((p, i) => <View key={i} style={{ position: 'absolute', left: p.x - BR * 0.7, top: p.y - BR * 0.7, width: BR * 1.4, height: BR * 1.4, borderRadius: BR, backgroundColor: C.cyan, opacity: Math.max(0, p.a * 0.6) }} />)}
        {s.bumpers.map((bm, i) => <View key={i} style={{ position: 'absolute', left: bm.x - bm.r, top: bm.y - bm.r, width: bm.r * 2, height: bm.r * 2, borderRadius: bm.r, backgroundColor: alpha(C.pink, 0.2), borderWidth: 3, borderColor: C.pink, ...glow(C.pink, 14, 0.9) }} />)}
        {s.orb && <Text style={{ position: 'absolute', left: s.orb.x - 16, top: s.orb.y - 18, fontSize: 30, opacity: s.orb.life < 2 && Math.floor(s.t * 8) % 2 ? 0.3 : 1 }}>🔮</Text>}
        <View style={{ position: 'absolute', left: s.px - s.pw / 2, top: PY, width: s.pw, height: 12, borderRadius: 6, backgroundColor: C.cyan, ...glow(C.cyan, 12, 0.9) }} />
        <View style={{ position: 'absolute', left: s.ball.x - BR, top: s.ball.y - BR, width: BR * 2, height: BR * 2, borderRadius: BR, backgroundColor: '#fff', ...glow('#fff', 12, 1) }} />
        <Overlay show={phase !== 'play'} kind={phase} emoji="🎾" title={phase === 'over' ? 'GAME OVER' : 'PONG SOLO'}
          subtitle={phase === 'over' ? `${s.hits} rebotes` : 'Mantén la bola en juego'}
          score={s.score} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para mover la pala', 'La bola acelera y la pala se encoge', 'Los bumpers rosados dan combos · 🔮 +5'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────
// WORD CHAIN – escribe palabras que empiezan con la última letra
function WordChain({ onExit }) {
  const WORDS = ['árbol', 'avión', 'abeja', 'agua', 'anillo', 'araña', 'ardilla', 'arroz', 'azúcar', 'almohada', 'amigo', 'abuelo', 'aceite', 'águila', 'alfombra', 'barco', 'bosque', 'botella', 'burro', 'banana', 'balón', 'bruja', 'bufanda', 'bicicleta', 'botón', 'brazo', 'casa', 'camino', 'caballo', 'cielo', 'campana', 'coche', 'cuchara', 'corazón', 'cohete', 'castillo', 'cebolla', 'camisa', 'cocina', 'conejo', 'dado', 'dragón', 'dedo', 'diamante', 'delfín', 'dinero', 'doctor', 'dulce', 'duende', 'escuela', 'estrella', 'elefante', 'espejo', 'escalera', 'edificio', 'entrada', 'esfera', 'espada', 'error', 'flor', 'fuego', 'foca', 'fruta', 'farol', 'fantasma', 'feria', 'familia', 'fiesta', 'gato', 'globo', 'guitarra', 'gusano', 'gigante', 'galleta', 'gorila', 'guante', 'hormiga', 'huevo', 'hoja', 'helado', 'hongo', 'hamaca', 'hielo', 'hermano', 'hotel', 'isla', 'iglesia', 'imán', 'invierno', 'iguana', 'idea', 'insecto', 'jirafa', 'jardín', 'jugo', 'jabón', 'jaula', 'joya', 'juego', 'koala', 'kiwi', 'luna', 'libro', 'león', 'lápiz', 'lago', 'lluvia', 'lobo', 'limón', 'luz', 'lámpara', 'mesa', 'mano', 'mar', 'mariposa', 'montaña', 'manzana', 'martillo', 'mundo', 'mono', 'moneda', 'museo', 'nube', 'naranja', 'nariz', 'noche', 'nido', 'nieve', 'nave', 'nuez', 'oso', 'oro', 'ola', 'ojo', 'oveja', 'orquesta', 'océano', 'olla', 'otoño', 'perro', 'pan', 'pelota', 'playa', 'planeta', 'puerta', 'pájaro', 'pato', 'piedra', 'payaso', 'pizza', 'pulpo', 'peine', 'queso', 'rana', 'reloj', 'rayo', 'río', 'rosa', 'ratón', 'robot', 'rueda', 'ropa', 'regalo', 'sol', 'silla', 'sapo', 'semilla', 'serpiente', 'sombrero', 'sandía', 'selva', 'sopa', 'tren', 'tigre', 'torre', 'tortuga', 'taza', 'tambor', 'tomate', 'techo', 'tijeras', 'tesoro', 'uva', 'unicornio', 'universo', 'vaca', 'volcán', 'viento', 'ventana', 'vaso', 'verano', 'violín', 'valle', 'vela', 'xilófono', 'yate', 'yoga', 'yema', 'yogur', 'zapato', 'zorro', 'zanahoria', 'zebra', 'zona'];
  const norm = w => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const first = w => norm(w)[0];
  const lastL = w => { const n = norm(w); return n[n.length - 1]; };
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('wordchain');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);
  const nextRound = s => {
    const need = lastL(s.chain[s.chain.length - 1]);
    const unused = WORDS.filter(w => !s.used.has(w));
    const follow = w => unused.filter(x => x !== w && first(x) === lastL(w)).length > 0;
    const good = shuffle(unused.filter(w => first(w) === need && follow(w))).slice(0, randInt(1, 2));
    if (!good.length) { // callejón sin salida: el jugador gana la cadena
      hx.win(); setRes({ isNew: submitBest(s.score), won: true }); setPhase('over'); return;
    }
    // señuelos: empiezan con una letra parecida
    const decoys = shuffle(unused.filter(w => first(w) !== need)).slice(0, 4 - good.length);
    s.opts = shuffle([...good, ...decoys].map(w => ({ w, ok: first(w) === need })));
    s.need = need; s.limit = Math.max(2.6, 7 - s.chain.length * 0.12); s.t = 0; s.lock = false; s.pick = null;
  };
  const init = () => { const s = { chain: [], used: new Set(), score: 0, lives: 3, streak: 0, opts: [], need: '', t: 0, limit: 7, lock: false, pick: null }; const w = pick(WORDS); s.chain.push(w); s.used.add(w); nextRound(s); return s; };
  if (!g.current) g.current = init();
  const start = () => { fx.clear(); g.current = init(); setPhase('play'); };
  const choose = o => {
    const s = g.current;
    if (phase !== 'play' || s.lock) return;
    s.lock = true; s.pick = o.w;
    if (o.ok) {
      s.chain.push(o.w); s.used.add(o.w); s.streak += 1;
      const pts = 10 + Math.round((1 - s.t / s.limit) * 10) + Math.min(20, s.streak * 2); s.score += pts;
      fx.burst(AREA_W / 2, AREA_H * 0.3, C.lime, 14, 200); fx.pop(AREA_W / 2, AREA_H * 0.22, `+${pts}`, C.lime, 22); hx.good(); force();
      later(() => { if (g.current === s) { nextRound(s); force(); } }, 450);
    } else {
      s.lives -= 1; s.streak = 0; fx.shake(7, 0.25); fx.flash(C.red, 0.25); hx.bad(); force();
      if (s.lives <= 0) { later(() => { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }, 800); }
      else later(() => { if (g.current === s) { s.chain.push(s.opts.find(x => x.ok).w); s.used.add(s.chain[s.chain.length - 1]); nextRound(s); force(); } }, 900);
    }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.lock) return;
    s.t += dt;
    if (s.t >= s.limit) {
      s.lock = true; s.lives -= 1; s.streak = 0; fx.shake(7, 0.25); fx.flash(C.red, 0.25); fx.pop(AREA_W / 2, AREA_H * 0.3, '¡TIEMPO!', C.red, 22); hx.bad();
      if (s.lives <= 0) { later(() => { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }, 800); }
      else later(() => { if (g.current === s) { s.chain.push(s.opts.find(x => x.ok).w); s.used.add(s.chain[s.chain.length - 1]); nextRound(s); force(); } }, 900);
    }
  });
  const s = g.current;
  const last = s.chain[s.chain.length - 1];
  const recent = s.chain.slice(-4, -1);
  return (
    <GameScreen title="WORD CHAIN" emoji="🔗" accent={C.lime} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.dim, fontSize: 12 }}>Cadena <Text style={{ color: C.lime, fontWeight: '800' }}>{s.chain.length}</Text></Text><View style={{ minWidth: 70, alignItems: 'flex-end' }}>{s.streak > 2 ? <Combo n={s.streak} color={C.lime} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#04100a" border={alpha(C.lime, 0.4)}>
        <View style={{ position: 'absolute', top: 18, left: 18, right: 18 }}>
          <Bar value={s.limit - s.t} max={s.limit} color={s.t / s.limit > 0.7 ? C.red : C.lime} h={10} />
        </View>
        <View style={{ position: 'absolute', top: 44, left: 0, right: 0, alignItems: 'center' }}>
          {recent.map((w, i) => <Text key={i} style={{ color: alpha(C.dim, 0.5 + i * 0.15), fontSize: 14 + i * 2, marginBottom: 2 }}>{w}</Text>)}
          <Text style={{ color: C.lime, fontSize: 38, fontWeight: '900', letterSpacing: 1, marginTop: 6, ...tglow(C.lime, 14) }}>{last}</Text>
          <Text style={{ color: C.dim, fontSize: 14, marginTop: 8 }}>Elige una palabra que empiece con</Text>
          <Text style={{ color: C.amber, fontSize: 54, fontWeight: '900', ...tglow(C.amber, 14) }}>{s.need.toUpperCase()}</Text>
        </View>
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 20, gap: 10 }}>
          {s.opts.map((o, i) => {
            const picked = s.pick === o.w;
            const reveal = s.lock && o.ok;
            const col = picked ? (o.ok ? C.lime : C.red) : reveal ? C.lime : C.cyan;
            return (
              <Pressable key={o.w} testID={`wc-${i}`} onPress={() => choose(o)}>
                <View style={{ height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(col, picked || reveal ? 0.28 : 0.1), borderWidth: 2, borderColor: alpha(col, picked || reveal ? 1 : 0.6) }}>
                  <Text style={{ color: C.text, fontSize: 20, fontWeight: '800', letterSpacing: 1 }}>{o.w}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🔗" title={phase === 'over' ? (res.won ? '¡CADENA PERFECTA!' : 'SE ROMPIÓ LA CADENA') : 'WORD CHAIN'}
          subtitle={phase === 'over' ? `Cadena de ${s.chain.length} palabras` : 'Cada palabra empieza con la última letra de la anterior'}
          score={s.score} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Elige la palabra que empiece con la letra indicada', 'Los señuelos no empiezan con esa letra', 'El tiempo por palabra se va acortando'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────
// DINO RUN
function DinoRun({ onExit }) {
  const GY = AREA_H - 90;      // línea de suelo
  const DX = 70;
  const fx = useFX();
  const [best, submitBest] = useBest('dino');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({ y: 0, vy: 0, duck: false, air: false, t: 0, dist: 0, speed: 330, obs: [], next: 1.1, night: false, scroll: 0, clouds: Array.from({ length: 4 }, (_, i) => ({ x: i * 110, y: rand(30, 140) })), coins: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const jump = () => {
    const s = g.current;
    if (phase !== 'play' || s.air) return;
    s.vy = 640; s.air = true; s.duck = false;
    fx.burst(DX + 14, GY, '#c9c9a8', 6, 90, 0.4, 4); hx.tap();
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.speed = Math.min(780, 330 + s.t * 7);
    s.dist += s.speed * dt * 0.06;
    s.scroll += s.speed * dt;
    s.night = Math.floor(s.dist / 400) % 2 === 1;
    // física
    if (s.air) {
      s.vy -= (s.duck ? 3000 : 1750) * dt;
      s.y += s.vy * dt;
      if (s.y <= 0) { s.y = 0; s.vy = 0; s.air = false; fx.burst(DX + 14, GY, '#c9c9a8', 5, 70, 0.3, 3); }
    }
    s.clouds.forEach(c => { c.x -= s.speed * 0.12 * dt; if (c.x < -50) { c.x = AREA_W + 20; c.y = rand(30, 140); } });
    // obstáculos
    s.next -= dt;
    if (s.next <= 0) {
      const r = Math.random();
      if (s.dist > 120 && r < 0.3) {
        const high = Math.random() < 0.5;   // alto: agacharse · bajo: saltar
        s.obs.push({ id: uid(), kind: 'bird', x: AREA_W + 30, w: 40, h: 28, lift: high ? 44 : 4, ph: 0 });
      } else if (r < 0.4) {
        s.obs.push({ id: uid(), kind: 'coin', x: AREA_W + 30, w: 26, h: 26, lift: rand(30, 110) });
      } else {
        const n = 1 + Math.floor(Math.random() * Math.min(3, 1 + s.dist / 250));
        s.obs.push({ id: uid(), kind: 'cactus', x: AREA_W + 30, w: 22 * n + 6, h: rand(38, 56), n, lift: 0 });
      }
      s.next = Math.max(0.55, rand(0.9, 1.7) - s.t * 0.012) * (330 / s.speed) * 1.0 + 0.25;
    }
    const me = { x: DX + 6, y: s.y, w: 28, h: s.duck && !s.air ? 22 : 40 };
    for (let i = s.obs.length - 1; i >= 0; i--) {
      const o = s.obs[i];
      o.x -= (s.speed + (o.kind === 'bird' ? 70 : 0)) * dt;
      o.ph += dt;
      if (o.x < -80) { s.obs.splice(i, 1); continue; }
      const hit = { x: o.x + 4, y: o.lift, w: o.w - 8, h: o.h - 6 };
      const meBox = { x: me.x, y: me.y, w: me.w, h: me.h };
      const col = meBox.x < hit.x + hit.w && meBox.x + meBox.w > hit.x && meBox.y < hit.y + hit.h && meBox.y + meBox.h > hit.y;
      if (!col) continue;
      if (o.kind === 'coin') {
        s.obs.splice(i, 1); s.coins += 1; s.dist += 12;
        fx.burst(o.x + 13, GY - o.lift - 13, C.amber, 10, 150); fx.pop(o.x, GY - o.lift - 30, '+12', C.amber, 15); hx.good();
      } else {
        fx.burst(DX + 20, GY - s.y - 20, C.red, 22, 240, 0.7, 5); fx.shake(10, 0.35); fx.flash(C.red, 0.3); hx.die();
        setRes({ isNew: submitBest(Math.floor(s.dist)) });
        setPhase('over');
        return;
      }
    }
  });
  const pan = usePan(fx, {
    down: x => { if (x > AREA_W * 0.6) { g.current.duck = true; if (g.current.air) g.current.vy = Math.min(g.current.vy, -200); } else jump(); },
    up: () => { g.current.duck = false; },
  });
  const s = g.current;
  const fg = s.night ? '#e9e9ff' : '#2b2b3a';
  const bg = s.night ? '#0b0b1c' : '#d9d8c2';
  const ducking = s.duck && !s.air;
  return (
    <GameScreen title="DINO RUN" emoji="🦖" accent={C.lime} onExit={onExit} score={Math.floor(s.dist)} best={best} scoreLabel="DISTANCIA"
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Monedas: <Text style={{ color: C.amber, fontWeight: '800' }}>{s.coins}</Text></Text><Text style={{ color: C.dim, fontSize: 12 }}>Vel. {Math.round(s.speed / 33)}</Text></>}>
      <PlayArea fx={fx} bg={bg} border={s.night ? C.line : '#9a9880'} {...pan}>
        {s.clouds.map((c, i) => <Text key={i} style={{ position: 'absolute', left: c.x, top: c.y, fontSize: 30, opacity: s.night ? 0.25 : 0.55 }}>{s.night ? '✨' : '☁️'}</Text>)}
        <View style={{ position: 'absolute', left: 0, right: 0, top: GY, height: 3, backgroundColor: fg }} />
        {Array.from({ length: 14 }, (_, i) => <View key={i} style={{ position: 'absolute', top: GY + 10 + (i % 3) * 8, left: ((i * 47 - s.scroll) % (AREA_W + 60) + AREA_W + 60) % (AREA_W + 60) - 20, width: 6 + (i % 4) * 4, height: 2, backgroundColor: fg, opacity: 0.45 }} />)}
        {s.obs.map(o => {
          const top = GY - o.lift - o.h;
          if (o.kind === 'cactus') return <Text key={o.id} style={{ position: 'absolute', left: o.x, top: top - 6, fontSize: o.h, lineHeight: o.h + 8, width: o.w + 20, color: fg }}>{'🌵'.repeat(o.n)}</Text>;
          if (o.kind === 'bird') return <Text key={o.id} style={{ position: 'absolute', left: o.x, top: top - 6, fontSize: 34, transform: [{ scaleX: -1 }, { translateY: Math.sin(o.ph * 14) * 3 }] }}>🦅</Text>;
          return <Text key={o.id} style={{ position: 'absolute', left: o.x, top, fontSize: 26, ...tglow(C.amber, 8, 0.8) }}>🪙</Text>;
        })}
        <Text style={{ position: 'absolute', left: DX - 4, top: GY - s.y - (ducking ? 32 : 48), fontSize: ducking ? 30 : 44, lineHeight: ducking ? 34 : 50, transform: [{ scaleX: -1 }, { translateY: !s.air && phase === 'play' ? Math.sin(s.t * 28) * 1.5 : 0 }] }}>🦖</Text>
        {phase === 'play' && <View pointerEvents="none" style={{ position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row' }}>
          <Text style={{ flex: 0.6, textAlign: 'center', color: fg, opacity: 0.35, fontSize: 11, fontWeight: '800', letterSpacing: 2 }}>TOCA · SALTAR</Text>
          <Text style={{ flex: 0.4, textAlign: 'center', color: fg, opacity: 0.35, fontSize: 11, fontWeight: '800', letterSpacing: 2 }}>MANTÉN · AGACHAR</Text>
        </View>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🦖" title={phase === 'over' ? 'EXTINTO' : 'DINO RUN'}
          subtitle={phase === 'over' ? `Corriste ${Math.floor(s.dist)} m` : 'La carrera infinita'}
          score={Math.floor(s.dist)} scoreLabel="METROS" best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca la izquierda para saltar', 'Mantén la derecha para agacharte', 'Aves altas: agáchate · aves bajas: salta', 'Cambia de día a noche cada 400 m'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────
// FRUIT TAP
function FruitTap({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('fruitslash');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({ fruits: [], halves: [], trail: [], lives: 3, score: 0, t: 0, wave: 0.6, combo: 0, maxCombo: 0, sliced: 0, last: null, swipe: 0, swipeX: 0, swipeY: 0, freeze: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const FR = [['🍎', '#ff4d6d'], ['🍊', '#ff8a3d'], ['🍋', '#ffe14d'], ['🍉', '#7dff6b'], ['🍇', '#9b6bff'], ['🍓', '#ff3d7a'], ['🍍', '#ffc233'], ['🥝', '#a6ff4d']];
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const launch = s => {
    const r = Math.random();
    const bomb = r < Math.min(0.2, 0.08 + s.t * 0.002);
    const ice = !bomb && r > 0.95;
    const f = pick(FR);
    const x = rand(50, AREA_W - 50);
    s.fruits.push({ id: uid(), x, y: AREA_H + 30, vx: (AREA_W / 2 - x) * rand(0.2, 0.55), vy: -rand(AREA_H * 0.95, AREA_H * 1.2), rot: 0, vr: rand(-4, 4), e: bomb ? '💣' : ice ? '🧊' : f[0], c: bomb ? '#ff4d6d' : ice ? '#22e6ff' : f[1], bomb, ice, r: 26, cut: false });
  };
  const end = (s, why) => {
    hx.die(); setRes({ isNew: submitBest(s.score), why }); setPhase('over');
  };
  const slice = (s, f) => {
    f.cut = true;
    if (f.bomb) {
      fx.burst(f.x, f.y, C.red, 30, 320, 0.9, 6); fx.shake(14, 0.5); fx.flash(C.red, 0.5);
      s.lives = 0; end(s, 'bomba'); return;
    }
    if (f.ice) { s.freeze = 4; fx.flash(C.cyan, 0.3); fx.pop(f.x, f.y, 'CÁMARA LENTA', C.cyan, 16); hx.good(); }
    s.sliced += 1; s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo); s.swipe += 1;
    const pts = 1 + Math.floor(s.combo / 5);
    s.score += pts;
    fx.burst(f.x, f.y, f.c, 16, 230, 0.6, 5); fx.pop(f.x, f.y - 26, `+${pts}`, C.text, 15); hx.hit();
    s.halves.push({ id: uid(), e: f.e, x: f.x - 8, y: f.y, vx: f.vx - 120, vy: f.vy * 0.3, rot: 0, vr: -5, side: -1 });
    s.halves.push({ id: uid(), e: f.e, x: f.x + 8, y: f.y, vx: f.vx + 120, vy: f.vy * 0.3, rot: 0, vr: 5, side: 1 });
  };
  const segHit = (ax, ay, bx, by, f) => {
    const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
    let t = l2 ? ((f.x - ax) * dx + (f.y - ay) * dy) / l2 : 0; t = clamp(t, 0, 1);
    return Math.hypot(ax + dx * t - f.x, ay + dy * t - f.y) < f.r + 8;
  };
  useLoop(phase === 'play', dt0 => {
    const s = g.current;
    if (s.freeze > 0) s.freeze -= dt0;
    const dt = dt0 * (s.freeze > 0 ? 0.5 : 1);
    s.t += dt0;
    s.wave -= dt;
    if (s.wave <= 0) {
      const n = Math.random() < 0.5 ? 1 : randInt(2, 3 + Math.floor(s.t / 40));
      for (let i = 0; i < n; i++) launch(s);
      s.wave = Math.max(0.55, 1.35 - s.t * 0.012);
    }
    s.fruits.forEach(f => { f.vy += 950 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt; });
    for (let i = s.fruits.length - 1; i >= 0; i--) {
      const f = s.fruits[i];
      if (f.cut) { s.fruits.splice(i, 1); continue; }
      if (f.vy > 0 && f.y > AREA_H + 40) {
        s.fruits.splice(i, 1);
        if (!f.bomb && !f.ice) {
          s.lives -= 1; s.combo = 0; fx.pop(clamp(f.x, 30, AREA_W - 30), AREA_H - 30, '✖', C.red, 26); fx.shake(5, 0.2); hx.bad();
          if (s.lives <= 0) { end(s, 'frutas'); return; }
        }
      }
    }
    s.halves.forEach(h => { h.vy += 950 * dt; h.x += h.vx * dt; h.y += h.vy * dt; h.rot += h.vr * dt; });
    s.halves = s.halves.filter(h => h.y < AREA_H + 60);
    s.trail.forEach(p => { p.a -= dt0 * 3.2; }); s.trail = s.trail.filter(p => p.a > 0);
  });
  const pan = usePan(fx, {
    down: (x, y) => { const s = g.current; s.last = { x, y }; s.swipe = 0; s.trail.push({ x, y, a: 1 }); },
    move: (x, y) => {
      const s = g.current;
      if (phase !== 'play' || !s.last) return;
      s.trail.push({ x, y, a: 1 }); if (s.trail.length > 16) s.trail.shift();
      for (const f of s.fruits) if (!f.cut && segHit(s.last.x, s.last.y, x, y, f)) { slice(s, f); if (phase !== 'play') return; }
      s.last = { x, y };
    },
    up: () => {
      const s = g.current;
      if (s.swipe >= 3) { const b = s.swipe * 2; s.score += b; fx.pop(AREA_W / 2, AREA_H / 2, `¡${s.swipe} DE UN CORTE! +${b}`, C.amber, 20); hx.win(); }
      s.swipe = 0; s.last = null;
    },
  });
  const s = g.current;
  return (
    <GameScreen title="FRUIT SLASH" emoji="🍉" accent={C.lime} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} icon="🍎" off="✖️" /><Text style={{ color: C.cyan, fontSize: 12, fontWeight: '800' }}>{s.freeze > 0 ? `🧊 ${Math.ceil(s.freeze)}s` : ''}</Text><View style={{ minWidth: 70, alignItems: 'flex-end' }}>{s.combo > 2 ? <Combo n={s.combo} color={C.lime} /> : null}</View></>}>
      <PlayArea fx={fx} bg={s.freeze > 0 ? '#041419' : '#08120a'} border={alpha(C.lime, 0.35)} {...pan}>
        <GridBg color={C.lime} step={46} />
        {s.halves.map(h => <Text key={h.id} style={{ position: 'absolute', left: h.x - 18, top: h.y - 22, width: 36, height: 44, overflow: 'hidden', fontSize: 34, lineHeight: 44, textAlign: h.side < 0 ? 'right' : 'left', transform: [{ rotate: `${h.rot}rad` }], opacity: 0.9 }}>{h.e}</Text>)}
        {s.fruits.map(f => <Text key={f.id} style={{ position: 'absolute', left: f.x - 24, top: f.y - 28, width: 48, textAlign: 'center', fontSize: 42, lineHeight: 56, transform: [{ rotate: `${f.rot}rad` }], ...tglow(f.bomb ? C.red : f.c, 10) }}>{f.e}</Text>)}
        {s.trail.map((p, i) => <View key={i} pointerEvents="none" style={{ position: 'absolute', left: p.x - 5 * p.a, top: p.y - 5 * p.a, width: 10 * p.a, height: 10 * p.a, borderRadius: 6, backgroundColor: '#fff', opacity: p.a * 0.9, ...glow('#fff', 8, 1) }} />)}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🍉" title={phase === 'over' ? (res.why === 'bomba' ? '¡BOOM!' : 'SE ESCAPARON') : 'FRUIT SLASH'}
          subtitle={phase === 'over' ? `${s.sliced} frutas cortadas · mejor racha ${s.maxCombo}` : 'Corta frutas, evita las bombas'}
          score={s.score} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Desliza el dedo sobre las frutas para cortarlas', 'Si se escapan 3 frutas, pierdes', '💣 termina la partida · 🧊 cámara lenta', 'Corta 3+ de un solo trazo para ganar bonus'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
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

const RpgTiles = React.memo(function RpgTiles({ world, x0, y0, cols, rows, T }) {
  const out = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const wx = x0 + i, wy = y0 + j;
    const ch = world[wy] && world[wy][wx] !== undefined ? world[wy][wx] : 'T';
    const d = RPG_TILE[ch];
    out.push(
      <View key={`${i}-${j}`} style={{ position: 'absolute', left: i * T, top: j * T, width: T, height: T, backgroundColor: d.bg, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' }}>
        {d.e ? <Text style={{ fontSize: T * 0.6 }}>{d.e}</Text> : null}
      </View>
    );
  }
  return <>{out}</>;
});

function PixelRPG({ onExit }) {
  const T = Math.floor(AREA_W / 8);
  const VC = 9, VR = Math.floor((AREA_H - 214) / T);
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('rpg');
  const [scene, setScene] = useState('menu');          // menu | map | battle | town | over | win
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);
  const holdRef = useRef(null);
  const newWorld = () => { const seed = Math.floor(Math.random() * 1e9); return { seed, world: rpgGenWorld(seed), opened: [] }; };
  const initState = () => { const w = newWorld(); return { ...w, p: rpgMakePlayer(), x: RPG_START.x, y: RPG_START.y, vx: RPG_START.x, vy: RPG_START.y, msg: '¡Bienvenido, aventurero! Derrota al dragón del volcán.', battle: null, menu: false, t: 0, hasSave: false, steps: 0, won: false, shop: null }; };
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
    s.x = nx; s.y = ny; s.steps += 1; hx.tick();
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
  const camX = clamp(s.vx - (VC - 1) / 2, 0, RPG_W - VC), camY = clamp(s.vy - (VR - 1) / 2, 0, RPG_H - VR);
  const ix = Math.floor(camX), iy = Math.floor(camY);
  const dpad = (label, dx, dy, st) => (
    <Pressable testID={`dp-${label}`} onPressIn={() => startHold(dx, dy)} onPressOut={stopHold} style={[{ width: 56, height: 56, borderRadius: 18, backgroundColor: alpha(C.amber, 0.14), borderWidth: 2, borderColor: alpha(C.amber, 0.6), alignItems: 'center', justifyContent: 'center' }, st]}>
      <Text style={{ color: C.amber, fontSize: 24, fontWeight: '900' }}>{label}</Text>
    </Pressable>
  );
  const Btn2 = ({ label, onPress, color = C.amber, disabled, wide }) => (
    <Pressable onPress={onPress} disabled={disabled} style={{ width: wide ? '100%' : '48%', opacity: disabled ? 0.35 : 1 }}>
      <View style={{ paddingVertical: 12, borderRadius: 14, backgroundColor: alpha(color, 0.16), borderWidth: 2, borderColor: alpha(color, 0.8), alignItems: 'center' }}><Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>{label}</Text></View>
    </Pressable>
  );
  const BarRow = (label, v, m, col) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={{ color: col, fontSize: 10, fontWeight: '900', width: 18 }}>{label}</Text><Bar value={v} max={m} color={col} h={8} w={90} /><Text style={{ color: C.dim, fontSize: 10 }}>{v}/{m}</Text></View>;
  return (
    <GameScreen title="PIXEL RPG" emoji="🧙" accent={C.amber} onExit={onExit} score={scoreOf(s)} best={best} scoreLabel="PUNTOS"
      hud={scene === 'menu' ? null : <>{BarRow('HP', p.hp, p.maxHp, C.red)}{BarRow('MP', p.mp, p.maxMp, C.cyan)}<Text style={{ color: C.amber, fontWeight: '900', fontSize: 12 }}>Nv.{p.lv}</Text></>}>
      <PlayArea fx={fx} bg="#0a0803" border={alpha(C.amber, 0.4)} {...(scene === 'map' ? pan : {})}>
        {scene === 'map' && (
          <>
            <View style={{ position: 'absolute', left: 0, top: 0, width: AREA_W, height: VR * T, overflow: 'hidden' }}>
              <View style={{ position: 'absolute', left: (AREA_W - VC * T) / 2 - (camX - ix) * T, top: -(camY - iy) * T, width: (VC + 1) * T, height: (VR + 1) * T }}>
                <RpgTiles world={s.world} x0={ix} y0={iy} cols={VC + 1} rows={VR + 1} T={T} />
                <Text style={{ position: 'absolute', left: (s.vx - ix) * T, top: (s.vy - iy) * T - 2, width: T, textAlign: 'center', fontSize: T * 0.66, lineHeight: T, ...tglow('#000', 4) }}>🧙</Text>
              </View>
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 30, backgroundColor: 'rgba(0,0,0,0.35)' }} />
            </View>
            <View style={{ position: 'absolute', left: 10, right: 190, top: VR * T + 6 }}>
              <Text numberOfLines={4} style={{ color: C.amber, fontSize: 12, lineHeight: 16, minHeight: 32 }}>{s.msg}</Text>
            </View>
            <View style={{ position: 'absolute', left: 14, bottom: 14, gap: 8 }}>
              <Text style={{ color: C.dim, fontSize: 11 }}>💰 {p.gold}  🧪 {p.potions}  💧 {p.ethers}</Text>
              <Text style={{ color: C.dim, fontSize: 11 }}>XP {p.xp}/{p.xpNext}</Text>
              <Text style={{ color: C.dim, fontSize: 11 }}>⚔️ {p.atk}  🛡️ {p.def}</Text>
              <Text style={{ color: alpha(C.dim, 0.8), fontSize: 10 }}>Desliza o usa la cruz</Text>
            </View>
            <View style={{ position: 'absolute', right: 14, bottom: 12, width: 56 * 3 + 12, height: 56 * 3 + 6 }}>
              {dpad('▲', 0, -1, { position: 'absolute', left: 56 + 6, top: 0 })}
              {dpad('◀', -1, 0, { position: 'absolute', left: 0, top: 56 + 3 })}
              {dpad('▶', 1, 0, { position: 'absolute', left: (56 + 6) * 2, top: 56 + 3 })}
              {dpad('▼', 0, 1, { position: 'absolute', left: 56 + 6, top: (56 + 3) * 2 })}
            </View>
          </>
        )}
        {scene === 'battle' && b && (
          <View style={{ flex: 1, backgroundColor: b.boss ? '#1a0505' : '#0d0a14' }}>
            <View style={{ alignItems: 'center', marginTop: 16 }}>
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '900', letterSpacing: 1 }}>{b.enemy.name}</Text>
              <Bar value={b.hp} max={b.max} color={C.red} h={12} w={AREA_W * 0.6} style={{ marginTop: 6 }} />
              <Text style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>{Math.max(0, b.hp)} / {b.max}</Text>
            </View>
            <View style={{ height: 150, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: b.boss ? 110 : 84, transform: [{ translateY: Math.sin(b.t * 3) * 6 }, { translateX: b.hit > 0 ? (Math.random() - 0.5) * 16 : 0 }, { scale: b.charging ? 1.12 + Math.sin(b.t * 14) * 0.04 : 1 }], opacity: b.hit > 0 ? 0.55 : 1, ...tglow(b.charging ? C.red : '#000', b.charging ? 20 : 4) }}>{b.enemy.e}</Text>
            </View>
            <View style={{ marginHorizontal: 14, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: alpha(C.amber, 0.3), minHeight: 56, justifyContent: 'center' }}>
              <Text style={{ color: b.charging ? C.red : C.text, fontSize: 14, lineHeight: 19 }}>{b.log}</Text>
            </View>
            <View style={{ position: 'absolute', left: 14, right: 14, bottom: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>{BarRow('HP', p.hp, p.maxHp, C.red)}{BarRow('MP', p.mp, p.maxMp, C.cyan)}</View>
              {b.turn === 'player' && !b.spellMenu && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                  <Btn2 label="⚔️ Atacar" onPress={() => act('attack')} color={C.red} />
                  <Btn2 label="✨ Magia" onPress={() => act('spell')} color={C.violet} />
                  <Btn2 label="🛡️ Defender" onPress={() => act('defend')} color={C.cyan} />
                  <Btn2 label={`🧪 Poción (${p.potions})`} onPress={() => act('potion')} color={C.lime} />
                  <Btn2 label={`💧 Éter (${p.ethers})`} onPress={() => act('ether')} color={C.blue} />
                  <Btn2 label="🏃 Huir" onPress={() => act('run')} color={C.dim} />
                </View>
              )}
              {b.turn === 'player' && b.spellMenu && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                  {RPG_SPELLS.filter(q => p.lv >= q.lv).map(q => <Btn2 key={q.id} label={`${q.name} · ${q.mp} MP`} onPress={() => cast(q.id)} color={C.violet} disabled={p.mp < q.mp} />)}
                  <Btn2 label="← Volver" onPress={() => { b.spellMenu = false; force(); }} color={C.dim} wide />
                </View>
              )}
              {b.turn === 'enemy' && <Text style={{ color: C.dim, textAlign: 'center', paddingVertical: 14 }}>Turno del enemigo…</Text>}
            </View>
          </View>
        )}
        {scene === 'town' && (
          <View style={{ flex: 1, padding: 18, alignItems: 'center' }}>
            <Text style={{ fontSize: 54, marginTop: 6 }}>🏘️</Text>
            <Text style={{ color: C.amber, fontSize: 22, fontWeight: '900', letterSpacing: 1 }}>TIENDA Y POSADA</Text>
            <Text style={{ color: C.dim, fontSize: 12, marginVertical: 6, textAlign: 'center' }}>💰 {p.gold}  ·  🧪 {p.potions}  ·  💧 {p.ethers}  ·  ⚔️ {p.atk}  ·  🛡️ {p.def}</Text>
            <Text style={{ color: C.lime, fontSize: 12, minHeight: 18, marginBottom: 8 }}>{s.shop || ' '}</Text>
            <View style={{ width: '100%', gap: 8 }}>
              <Btn2 wide label="🛏️ Descansar (gratis): HP y MP al máximo" onPress={rest} color={C.lime} />
              <Btn2 wide label="🧪 Poción · 15 💰" onPress={() => buy('potion')} color={C.red} />
              <Btn2 wide label="💧 Éter · 25 💰" onPress={() => buy('ether')} color={C.blue} />
              <Btn2 wide label={RPG_WEAPONS[p.weapon + 1] ? `⚔️ ${RPG_WEAPONS[p.weapon + 1][0]} (+${RPG_WEAPONS[p.weapon + 1][1]} ATK) · ${RPG_WEAPONS[p.weapon + 1][2]} 💰` : '⚔️ Arma al máximo'} onPress={() => buy('weapon')} color={C.orange} disabled={!RPG_WEAPONS[p.weapon + 1]} />
              <Btn2 wide label={RPG_ARMORS[p.armor + 1] ? `🛡️ ${RPG_ARMORS[p.armor + 1][0]} (+${RPG_ARMORS[p.armor + 1][1]} DEF) · ${RPG_ARMORS[p.armor + 1][2]} 💰` : '🛡️ Armadura al máximo'} onPress={() => buy('armor')} color={C.cyan} disabled={!RPG_ARMORS[p.armor + 1]} />
            </View>
            <View style={{ marginTop: 16 }}><Btn label="SALIR AL MAPA" color={C.amber} onPress={() => { s.shop = null; setScene('map'); }} /></View>
          </View>
        )}
        <Overlay show={scene === 'menu'} kind="start" emoji="🧙" title="PIXEL RPG" subtitle="Explora un mundo nuevo cada partida y derrota al Dragón Ancestral"
          accent={C.amber} startLabel={s.hasSave ? 'NUEVA PARTIDA' : 'JUGAR'} onStart={newGame} onExit={onExit}
          extra={s.hasSave ? <View style={{ marginTop: 14 }}><Btn label="CONTINUAR" ghost color={C.amber} onPress={continueGame} /></View> : null}
          lines={['Explora, recoge cofres y combate por turnos', 'Compra equipo en las aldeas · Nivel 5 para el volcán', 'Defiende cuando el enemigo "carga" un golpe']} />
        <Overlay show={scene === 'over'} kind="over" emoji="💀" title="DERROTADO" subtitle={s.msg} score={scoreOf(s)} best={best} accent={C.red} startLabel="SEGUIR" onStart={() => setScene('map')} onExit={onExit} />
        <Overlay show={scene === 'win'} kind="win" emoji="🏆" title="¡DRAGÓN DERROTADO!" subtitle={`Nivel ${p.lv} · ${p.gold} 💰. La región vuelve a la paz.`} score={scoreOf(s)} best={best} isNew accent={C.amber} startLabel="NUEVA AVENTURA" onStart={newGame} onExit={onExit} />
      </PlayArea>
    </GameScreen>
  );
}
// ─────────────────────────────────────────────────────────────────

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
  { id: 'neon', name: 'NEON GALAXY', emoji: '🚀', tag: 'Shooter espacial con jefes y power-ups', color: C.cyan, cat: 'accion', Comp: NeonGalaxy },
  { id: 'cyber', name: 'CYBER RUN', emoji: '🏃', tag: 'Corre, salta y desliza por la ciudad', color: C.pink, cat: 'accion', Comp: CyberRun },
  { id: 'pixel', name: 'PIXEL QUEST', emoji: '🍄', tag: 'Plataformas en 30 mundos', color: C.lime, cat: 'aventura', Comp: PixelQuest },
  { id: 'galactic', name: 'GALACTIC HUNT', emoji: '🛸', tag: 'Caza ovnis antes de que escapen', color: C.violet, cat: 'accion', Comp: GalacticHunt },
  { id: 'snake', name: 'SNAKE POWER', emoji: '🐍', tag: 'Snake con poderes y combos', color: C.lime, cat: 'arcade', Comp: SnakePower },
  { id: 'pingpong', name: 'PING PONG', emoji: '🏓', tag: 'Duelo contra la IA a 7 puntos', color: C.blue, cat: 'arcade', Comp: PingPong },
  { id: 'breakout', name: 'BREAKOUT', emoji: '🧱', tag: 'Rompe ladrillos y atrapa mejoras', color: C.orange, cat: 'arcade', Comp: Breakout },
  { id: 'void', name: 'VOID CRAWLER', emoji: '☠️', tag: 'Roguelike de 5 pisos', color: C.violet, cat: 'aventura', Comp: VoidCrawler },
  { id: 'tunnel', name: 'NEON TUNNEL', emoji: '🌀', tag: 'Vuela por el túnel y esquiva', color: C.cyan, cat: 'accion', Comp: NeonTunnel },
  { id: 'monster', name: 'MONSTER DUEL', emoji: '⚡', tag: 'Captura, evoluciona y combate', color: C.amber, cat: 'aventura', Comp: MonsterDuel },
  { id: 'gravity', name: 'GRAVITY FLIP', emoji: '🔀', tag: 'Invierte la gravedad', color: C.violet, cat: 'reflejos', Comp: GravityFlip },
  { id: 'tetris', name: 'NEON TETRIS', emoji: '🧊', tag: 'El clásico con pieza fantasma', color: C.cyan, cat: 'puzzle', Comp: NeonTetris },
  { id: 'warrior', name: 'NEON WARRIOR', emoji: '🥷', tag: 'Plataformas, doble salto, 3 niveles', color: C.pink, cat: 'accion', Comp: NeonWarrior },
  { id: 'craft', name: 'PIXEL CRAFT', emoji: '⛏️', tag: 'Mina, construye y sobrevive la noche', color: C.orange, cat: 'aventura', Comp: PixelCraft },
  { id: 'walljumper', name: 'WALL JUMPER', emoji: '🧗', tag: 'Rebota entre paredes y sube', color: C.orange, cat: 'reflejos', Comp: WallJumper },
  { id: 'mathrush', name: 'MATH RUSH', emoji: '🧮', tag: 'Calcula rápido y destruye', color: C.pink, cat: 'puzzle', Comp: MathRush },
  { id: 'neon2048', name: '2048 NEON', emoji: '🟦', tag: 'Fusiona fichas hasta el 2048', color: C.cyan, cat: 'puzzle', Comp: NeonGame2048 },
  { id: 'whackamole', name: 'WHACK-A-MOLE', emoji: '🐹', tag: 'Golpea topos, evita bombas', color: C.violet, cat: 'reflejos', Comp: WhackAMole },
  { id: 'rhythm', name: 'RITMO Y COLOR', emoji: '🎵', tag: 'Repite la secuencia', color: C.violet, cat: 'reflejos', Comp: RhythmTap },
  { id: 'starcatcher', name: 'STAR CATCHER', emoji: '⭐', tag: 'Atrapa estrellas, esquiva bombas', color: C.amber, cat: 'arcade', Comp: StarCatcher },
  { id: 'wordscramble', name: 'PALABRAS', emoji: '🔤', tag: 'Ordena las letras revueltas', color: C.violet, cat: 'puzzle', Comp: WordScramble },
  { id: 'crossyroad', name: 'CROSSY ROAD', emoji: '🐸', tag: 'Cruza calles, ríos y vías', color: C.lime, cat: 'arcade', Comp: CR2_CrossyRoad },
  { id: 'bubbleshooter', name: 'BUBBLE SHOOTER', emoji: '🫧', tag: 'Une 3 burbujas del mismo color', color: C.red, cat: 'puzzle', Comp: BubbleShooter },
  { id: 'flappyneon', name: 'FLAPPY NEON', emoji: '🐦', tag: 'Toca para volar entre tubos', color: C.amber, cat: 'reflejos', Comp: FlappyNeon },
  { id: 'memorymatch', name: 'MEMORY MATCH', emoji: '🃏', tag: 'Encuentra los pares', color: C.violet, cat: 'puzzle', Comp: MemoryMatch },
  { id: 'asteroidodge', name: 'ASTEROID DODGE', emoji: '☄️', tag: 'Esquiva la lluvia de rocas', color: C.cyan, cat: 'accion', Comp: AsteroidDodge },
  { id: 'towerstack', name: 'TOWER STACK', emoji: '🏗️', tag: 'Apila con precisión perfecta', color: C.amber, cat: 'reflejos', Comp: TowerStack },
  { id: 'numberpuzzle', name: '15 PUZZLE', emoji: '🧩', tag: 'Desliza y ordena los números', color: C.cyan, cat: 'puzzle', Comp: NumberPuzzle },
  { id: 'coincollector', name: 'COIN RUSH', emoji: '🪙', tag: 'Recoge monedas en 30 segundos', color: C.amber, cat: 'arcade', Comp: CoinCollector },
  { id: 'reactiontime', name: 'REFLEJOS', emoji: '⚡', tag: 'Mide tu tiempo de reacción', color: C.pink, cat: 'reflejos', Comp: ReactionTime },
  { id: 'colorrush', name: 'COLOR RUSH', emoji: '🎨', tag: 'Toca el color, no la palabra', color: C.pink, cat: 'reflejos', Comp: ColorRush },
  { id: 'pongsolo', name: 'PONG SOLO', emoji: '🎾', tag: 'Rebota la bola contra el muro', color: C.cyan, cat: 'arcade', Comp: PongSolo },
  { id: 'wordchain', name: 'WORD CHAIN', emoji: '🔗', tag: 'Encadena palabras por la última letra', color: C.lime, cat: 'puzzle', Comp: WordChain },
  { id: 'dinorun', name: 'DINO RUN', emoji: '🦖', tag: 'Salta cactus, agáchate de las aves', color: C.lime, cat: 'reflejos', Comp: DinoRun },
  { id: 'fruittap', name: 'FRUIT TAP', emoji: '🍉', tag: 'Corta frutas, evita bombas', color: C.lime, cat: 'reflejos', Comp: FruitTap },
  { id: 'pixelrpg', name: 'PIXEL RPG', emoji: '🧙', tag: 'Explora, combate y sube de nivel', color: C.amber, cat: 'aventura', Comp: PixelRPG },
];

function GameCard({ g, index, best, onPress, cardW }) {
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
        backgroundColor: alpha(g.color, 0.09), borderWidth: 1.5, borderColor: alpha(g.color, 0.5),
        opacity: a, transform: [{ scale: s }, { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        ...glow(g.color, 10, 0.35),
      }}>
        <View style={{ position: 'absolute', right: -16, top: -16, width: 84, height: 84, borderRadius: 42, backgroundColor: alpha(g.color, 0.12) }} />
        <Text style={{ fontSize: 34 }}>{g.emoji}</Text>
        <Text numberOfLines={1} style={{ color: g.color, fontSize: 14, fontWeight: '900', letterSpacing: 1, marginTop: 6 }}>{g.name}</Text>
        <Text numberOfLines={2} style={{ color: C.dim, fontSize: 11, lineHeight: 15, marginTop: 2 }}>{g.tag}</Text>
        {best > 0 && (
          <View style={{ position: 'absolute', right: 8, top: 8, backgroundColor: alpha('#000000', 0.45), borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ color: C.amber, fontSize: 11, fontWeight: '800' }}>🏆 {best}</Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

function Menu({ onPick }) {
  const [cat, setCat] = useState('all');
  const [bests, setBests] = useState({});
  useEffect(() => {
    AsyncStorage.multiGet(GAMES.map(g => `@best:${g.id}`)).then(rows => {
      const o = {};
      rows.forEach(([k, v]) => { if (v) o[k.slice(6)] = parseFloat(v) || 0; });
      setBests(o);
    }).catch(() => {});
  }, []);
  const list = GAMES.filter(g => cat === 'all' || g.cat === cat);
  const cardW = (Math.min(width, 520) - 16 * 2 - 12) / 2;
  const played = Object.keys(bests).length;
  const surprise = () => { hx.tap(); onPick(GAMES[Math.floor(Math.random() * GAMES.length)].id); };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ width: Math.min(width, 520), paddingHorizontal: 16, paddingTop: 22 }}>
          <Text style={{ color: C.text, fontSize: 38, fontWeight: '900', letterSpacing: 3, ...tglow(C.cyan, 16, 0.9) }}>ARCADE<Text style={{ color: C.cyan }}> HUB</Text></Text>
          <Text style={{ color: C.dim, fontSize: 13, marginTop: 4, marginBottom: 14 }}>{GAMES.length} juegos · {played} con récord</Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }}>
              {CATEGORIES.map(c => {
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

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {list.map((g, i) => (
              <GameCard key={g.id + cat} g={g} index={i} cardW={cardW} best={bests[g.id] || 0} onPress={() => { hx.tap(); onPick(g.id); }} />
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  const [screen, setScreen] = useState('menu');
  const g = GAMES.find(x => x.id === screen);
  if (g) {
    const G = g.Comp;
    return <G onExit={() => setScreen('menu')} />;
  }
  return <Menu onPick={setScreen} />;
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

// ══════════════════════════════════════════════════════════════════
// MATH RUSH
// ══════════════════════════════════════════════════════════════════

const MR_ENEMY_W = 56;
const MR_ENEMY_H = 44;
const MR_SPAWN_INTERVAL = 1600;
const MR_INITIAL_SPEED = 1.2;
const MR_SPEED_INCREMENT = 0.0004;
const MR_MAX_LIVES = 3;
const MR_CANNON_H = 48;
const MR_CANNON_W = 36;
const MR_COLORS = ['#ff2d78', '#00f0ff', '#ffe600', '#a259ff', '#00ff99', '#ff6a00'];

function MathRush({ onExit }) {
  const BW = 98, BH = 42, DANGER = AREA_H - 118;
  const fx = useFX();
  const [best, submitBest] = useBest('mathrush');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({ blocks: [], spawn: 0.5, t: 0, score: 0, lives: 3, combo: 0, maxCombo: 0, solved: 0, level: 1, freeze: 0, bad: 0, banner: { text: 'NIVEL 1 · SUMAS Y RESTAS', t: 1.5 } });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const makeProblem = lv => {
    let a, b, op;
    const r = Math.random();
    if (lv === 1) { op = r < 0.5 ? '+' : '−'; a = randInt(2, 20); b = randInt(1, 15); }
    else if (lv === 2) { op = r < 0.4 ? '×' : r < 0.7 ? '+' : '−'; a = op === '×' ? randInt(2, 9) : randInt(10, 60); b = op === '×' ? randInt(2, 9) : randInt(5, 40); }
    else { op = r < 0.45 ? '×' : r < 0.75 ? '+' : '−'; a = op === '×' ? randInt(3, 12) : randInt(20, 99); b = op === '×' ? randInt(3, 12) : randInt(10, 80); }
    if (op === '−' && b > a) [a, b] = [b, a];
    const ans = op === '+' ? a + b : op === '−' ? a - b : a * b;
    const opts = new Set([ans]);
    while (opts.size < 3) { const d = randInt(1, lv === 1 ? 5 : 9) * (Math.random() < 0.5 ? -1 : 1); const v = ans + d; if (v >= 0) opts.add(v); }
    return { text: `${a} ${op} ${b}`, ans, opts: shuffle([...opts]) };
  };
  const spawn = s => {
    const p = makeProblem(s.level);
    const r = Math.random();
    const kind = r < 0.07 ? 'bomb' : r < 0.13 ? 'freeze' : 'normal';
    let x = rand(8, AREA_W - BW - 8);
    for (let k = 0; k < 8; k++) { if (!s.blocks.some(b => b.y < BH + 10 && Math.abs(b.x - x) < BW)) break; x = rand(8, AREA_W - BW - 8); }
    s.blocks.push({ id: uid(), ...p, kind, x, y: -BH, vy: 34 + s.level * 8 + Math.min(60, s.t * 0.7), wob: Math.random() * 6 });
  };
  const answer = v => {
    const s = g.current;
    if (phase !== 'play' || !s.blocks.length) return;
    const target = s.blocks.reduce((a, b) => (b.y > a.y ? b : a));
    if (v !== target.ans) {
      s.combo = 0; s.bad = 0.25; fx.shake(5, 0.2); fx.flash(C.red, 0.15); hx.bad(); target.y -= 24; return;
    }
    const cx = target.x + BW / 2, cy = target.y + BH / 2;
    s.blocks = s.blocks.filter(b => b !== target);
    s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo); s.solved += 1;
    const pts = 10 * s.level + s.combo * 2; s.score += pts;
    fx.burst(cx, cy, C.pink, 14, 220); fx.pop(cx, cy - 12, `+${pts}`, C.text, 17); hx.hit();
    if (target.kind === 'bomb') {
      s.blocks.forEach(b => { fx.burst(b.x + BW / 2, b.y + BH / 2, C.orange, 10, 200); s.score += 5; }); s.blocks = [];
      fx.ring(cx, cy, C.orange, 200); fx.flash(C.orange, 0.35); fx.shake(8, 0.3); hx.heavy();
    }
    if (target.kind === 'freeze') { s.freeze = 4; fx.flash(C.cyan, 0.25); fx.pop(cx, cy - 36, '❄ CONGELADO', C.cyan, 16); hx.good(); }
    if (s.solved % 8 === 0) { s.level = Math.min(3, s.level + 1); if (s.solved === 8 || s.solved === 16) { s.banner = { text: s.level === 2 ? 'NIVEL 2 · ¡MULTIPLICACIONES!' : 'NIVEL 3 · ¡NÚMEROS GRANDES!', t: 1.6 }; hx.good(); } }
  };
  useLoop(phase === 'play', dt0 => {
    const s = g.current;
    s.t += dt0;
    if (s.freeze > 0) s.freeze -= dt0;
    if (s.bad > 0) s.bad -= dt0;
    if (s.banner) { s.banner.t -= dt0; if (s.banner.t <= 0) s.banner = null; }
    const dt = dt0 * (s.freeze > 0 ? 0.15 : 1);
    s.spawn -= dt;
    if (s.spawn <= 0) { spawn(s); s.spawn = Math.max(1.1, 2.6 - s.t * 0.018 - s.level * 0.15); }
    s.blocks.forEach(b => { b.y += b.vy * dt; });
    for (let i = s.blocks.length - 1; i >= 0; i--) {
      const b = s.blocks[i];
      if (b.y + BH >= DANGER) {
        s.blocks.splice(i, 1); s.lives -= 1; s.combo = 0;
        fx.burst(b.x + BW / 2, DANGER, C.red, 18, 240); fx.shake(8, 0.3); fx.flash(C.red, 0.3); hx.bad();
        if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
      }
    }
  });
  const s = g.current;
  const target = s.blocks.length ? s.blocks.reduce((a, b) => (b.y > a.y ? b : a)) : null;
  const BTW = (AREA_W - 24 - 20) / 3;
  return (
    <GameScreen title="MATH RUSH" emoji="🧮" accent={C.pink} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.pink, fontWeight: '800' }}>{s.level}</Text> · Resueltas {s.solved}</Text><View style={{ minWidth: 70, alignItems: 'flex-end' }}>{s.combo > 1 ? <Combo n={s.combo} color={C.pink} /> : <Text style={{ color: C.cyan, fontWeight: '800', fontSize: 12 }}>{s.freeze > 0 ? '❄' : ''}</Text>}</View></>}>
      <PlayArea fx={fx} bg={s.bad > 0 ? '#1a0610' : '#0a0612'} border={alpha(C.pink, 0.4)}>
        <GridBg color={C.pink} step={46} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: DANGER, height: 2, backgroundColor: C.red, opacity: 0.7, ...glow(C.red, 8, 0.8) }} />
        {s.blocks.map(b => {
          const t = b === target;
          const col = b.kind === 'bomb' ? C.orange : b.kind === 'freeze' ? C.cyan : C.pink;
          return (
            <View key={b.id} style={{ position: 'absolute', left: b.x, top: b.y, width: BW, height: BH, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(col, t ? 0.3 : 0.14), borderWidth: t ? 3 : 1.5, borderColor: t ? '#fff' : alpha(col, 0.7), ...glow(col, t ? 14 : 6, t ? 0.9 : 0.4) }}>
              <Text style={{ color: C.text, fontSize: 19, fontWeight: '900' }}>{b.kind === 'bomb' ? '💣 ' : b.kind === 'freeze' ? '❄ ' : ''}{b.text}</Text>
            </View>
          );
        })}
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 16, flexDirection: 'row', gap: 10 }}>
          {(target ? target.opts : ['', '', '']).map((o, i) => (
            <Pressable key={i} testID={`ans-${i}`} onPressIn={() => o !== '' && answer(o)} style={{ width: BTW, height: 76 }}>
              <View style={{ flex: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(C.cyan, 0.15), borderWidth: 2, borderColor: C.cyan, ...glow(C.cyan, 10, 0.5) }}>
                <Text style={{ color: C.cyan, fontSize: 30, fontWeight: '900' }}>{o}</Text>
              </View>
            </Pressable>
          ))}
        </View>
        {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.4, width: AREA_W, textAlign: 'center', color: C.text, fontSize: 18, fontWeight: '900', letterSpacing: 2, opacity: Math.min(1, s.banner.t), ...tglow(C.pink, 12) }}>{s.banner.text}</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🧮" title={phase === 'over' ? 'SIN VIDAS' : 'MATH RUSH'}
          subtitle={phase === 'over' ? `${s.solved} operaciones · mejor racha ${s.maxCombo}` : 'Resuelve antes de que caigan'}
          score={s.score} best={best} isNew={res.isNew} accent={C.pink} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Responde la operación resaltada (la más baja)', '💣 destruye todo · ❄ congela el tiempo', 'Cada 8 aciertos sube la dificultad'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ══════════════════════════════════════════════════════════════════
// 2048 NEON
// ══════════════════════════════════════════════════════════════════

const NN_SIZE = 4;
const NN_GAP = 8;
const NN_BOARD_PAD = 10;
const NN_CELL = Math.floor((Math.min(width, 420) - NN_BOARD_PAD * 2 - NN_GAP * (NN_SIZE + 1)) / NN_SIZE);
const NN_TILE_COLORS = { 0:{bg:'#1a0a2e',fg:'#1a0a2e'},2:{bg:'#0d1b4b',fg:'#7eb8ff'},4:{bg:'#0a2060',fg:'#9dcfff'},8:{bg:'#006e7f',fg:'#00f0ff'},16:{bg:'#005c1a',fg:'#00ff70'},32:{bg:'#6b6b00',fg:'#ffe600'},64:{bg:'#7a3300',fg:'#ff8c00'},128:{bg:'#6b0000',fg:'#ff4444'},256:{bg:'#6b0050',fg:'#ff66cc'},512:{bg:'#3a006b',fg:'#c77dff'},1024:{bg:'#5a4400',fg:'#ffd700'},2048:{bg:'#fff',fg:'#0a0010'} };
const NN_getTileStyle = (val) => NN_TILE_COLORS[val] || { bg: '#fff', fg: '#0a0010' };
const NN_emptyGrid = () => Array(NN_SIZE).fill(null).map(() => Array(NN_SIZE).fill(0));
const NN_addRandom = (grid) => { const empty = []; for (let r=0;r<NN_SIZE;r++) for (let c=0;c<NN_SIZE;c++) if(grid[r][c]===0) empty.push([r,c]); if(!empty.length) return grid; const [r,c]=empty[Math.floor(Math.random()*empty.length)]; const ng=grid.map(row=>[...row]); ng[r][c]=Math.random()<0.85?2:4; return ng; };
const NN_initGrid = () => { let g=NN_emptyGrid(); g=NN_addRandom(g); g=NN_addRandom(g); return g; };
const NN_slideRow = (row) => { const nums=row.filter(v=>v!==0); let score=0; const merged=[]; let i=0; while(i<nums.length){if(i+1<nums.length&&nums[i]===nums[i+1]){const val=nums[i]*2;merged.push(val);score+=val;i+=2;}else{merged.push(nums[i]);i++;}} while(merged.length<NN_SIZE) merged.push(0); return {row:merged,score}; };
const NN_moveLeft = (grid) => { let totalScore=0,changed=false; const ng=grid.map(row=>{const{row:nr,score}=NN_slideRow(row);totalScore+=score;if(nr.join()!==row.join())changed=true;return nr;}); return{grid:ng,score:totalScore,changed}; };
const NN_rotateGrid = (grid) => { const n=NN_SIZE; return Array(n).fill(null).map((_,r)=>Array(n).fill(null).map((__,c)=>grid[n-1-c][r])); };
const NN_move = (grid,dir) => { let rot=0; if(dir==='right')rot=2; else if(dir==='up')rot=3; else if(dir==='down')rot=1; let g=grid; for(let i=0;i<rot;i++)g=NN_rotateGrid(g); const{grid:moved,score,changed}=NN_moveLeft(g); let result=moved; for(let i=0;i<(4-rot)%4;i++)result=NN_rotateGrid(result); return{grid:result,score,changed}; };
const NN_hasWon=(grid)=>grid.some(row=>row.some(v=>v===2048));
const NN_hasMovesLeft=(grid)=>{for(let r=0;r<NN_SIZE;r++)for(let c=0;c<NN_SIZE;c++){if(grid[r][c]===0)return true;if(c+1<NN_SIZE&&grid[r][c]===grid[r][c+1])return true;if(r+1<NN_SIZE&&grid[r][c]===grid[r+1][c])return true;}return false;};

function NeonGame2048({ onExit }) {
  const N = 4, GAP = 8;
  const BS = Math.min(AREA_W - 24, AREA_H - 140, 400);
  const CELLW = (BS - GAP * (N + 1)) / N;
  const BX = (AREA_W - BS) / 2, BY = 24;
  const px = c => BX + GAP + c * (CELLW + GAP);
  const py = r => BY + GAP + r * (CELLW + GAP);
  const fx = useFX();
  const [best, submitBest] = useBest('2048');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const initState = () => { const s = { tiles: [], score: 0, undo: null, undos: 3, won: false, lock: 0, over: false, t: 0, used: false }; spawn(s); spawn(s); return s; };
  const spawn = s => {
    const used = new Set(s.tiles.filter(t => !t.die).map(t => t.r * N + t.c));
    const free = []; for (let i = 0; i < N * N; i++) if (!used.has(i)) free.push(i);
    if (!free.length) return;
    const i = pick(free);
    const r = Math.floor(i / N), c = i % N;
    s.tiles.push({ id: uid(), v: Math.random() < 0.9 ? 2 : 4, r, c, x: px(c), y: py(r), born: s.t, pop: 0 });
  };
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const canMove = s => {
    const live = s.tiles.filter(t => !t.die);
    if (live.length < N * N) return true;
    const at = {}; live.forEach(t => { at[t.r * N + t.c] = t.v; });
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const v = at[r * N + c]; if ((c + 1 < N && at[r * N + c + 1] === v) || (r + 1 < N && at[(r + 1) * N + c] === v)) return true; }
    return false;
  };
  const move = (dr, dc) => {
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    s.tiles = s.tiles.filter(t => !t.die);
    const snap = { tiles: s.tiles.map(t => ({ v: t.v, r: t.r, c: t.c })), score: s.score };
    let moved = false, gained = 0;
    for (let line = 0; line < N; line++) {
      let ts = s.tiles.filter(t => (dr === 0 ? t.r === line : t.c === line));
      ts.sort((a, b) => (dr === 0 ? (dc > 0 ? b.c - a.c : a.c - b.c) : (dr > 0 ? b.r - a.r : a.r - b.r)));
      let k = 0, last = null;
      for (const t of ts) {
        if (last && !last.merged && last.v === t.v) {
          t.r = last.r; t.c = last.c; t.die = true; t.dieT = 0.12;
          last.v *= 2; last.merged = true; last.pop = 0.18; gained += last.v; moved = true;
          if (last.v === 2048 && !s.won) { s.won = true; fx.pop(AREA_W / 2, AREA_H * 0.4, '¡2048!', C.amber, 40); fx.flash('#fff', 0.4); hx.win(); }
        } else {
          const nr = dr === 0 ? t.r : (dr > 0 ? N - 1 - k : k);
          const nc = dc === 0 ? t.c : (dc > 0 ? N - 1 - k : k);
          if (nr !== t.r || nc !== t.c) moved = true;
          t.r = nr; t.c = nc; last = t; k += 1;
        }
      }
    }
    s.tiles.forEach(t => { t.merged = false; });
    if (!moved) { hx.tick(); return; }
    s.undo = snap; s.score += gained;
    if (gained) { fx.pop(AREA_W / 2, BY - 6, `+${gained}`, C.amber, 18); hx.hit(); } else hx.tap();
    s.pending = true; s.lock = 0.1;
  };
  const doUndo = () => {
    const s = g.current;
    if (phase !== 'play' || !s.undo || s.undos <= 0) return;
    s.tiles = s.undo.tiles.map(t => ({ id: uid(), v: t.v, r: t.r, c: t.c, x: px(t.c), y: py(t.r), born: s.t, pop: 0 }));
    s.score = s.undo.score; s.undo = null; s.undos -= 1; s.pending = false; s.over = false; hx.tick();
  };
  useLoop(phase !== 'ready', dt => {
    const s = g.current;
    s.t += dt;
    s.tiles.forEach(t => {
      const k = Math.min(1, dt * 22);
      t.x += (px(t.c) - t.x) * k; t.y += (py(t.r) - t.y) * k;
      if (t.pop > 0) t.pop -= dt;
      if (t.die) { t.dieT -= dt; }
    });
    s.tiles = s.tiles.filter(t => !(t.die && t.dieT <= 0));
    if (s.pending) {
      s.lock -= dt;
      if (s.lock <= 0) {
        s.pending = false; spawn(s);
        if (!canMove(s) && !s.over) { s.over = true; hx.die(); fx.shake(6, 0.3); setRes({ isNew: submitBest(s.score), won: s.won }); setPhase('over'); }
      }
    }
  });
  const pan = usePan(fx, {
    down: () => { g.current.used = false; },
    move: (x, y, gs) => {
      const s = g.current; if (s.used) return;
      if (Math.abs(gs.dx) > 22 || Math.abs(gs.dy) > 22) {
        s.used = true;
        if (Math.abs(gs.dx) > Math.abs(gs.dy)) move(0, gs.dx > 0 ? 1 : -1); else move(gs.dy > 0 ? 1 : -1, 0);
      }
    },
  });
  const s = g.current;
  const maxTile = s.tiles.reduce((m, t) => Math.max(m, t.v), 0);
  const col = v => { const k = Math.log2(v); const h = (k * 37 + 170) % 360; return [`hsl(${h},85%,${v >= 128 ? 55 : 48}%)`, `hsl(${h},95%,${v >= 128 ? 72 : 66}%)`]; };
  return (
    <GameScreen title="2048 NEON" emoji="🟦" accent={C.cyan} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Mayor ficha <Text style={{ color: C.cyan, fontWeight: '800' }}>{maxTile}</Text></Text>{s.won ? <Text style={{ color: C.amber, fontWeight: '900', fontSize: 12 }}>🏆 ¡2048!</Text> : <Text style={{ color: C.dim, fontSize: 12 }}>Meta: 2048</Text>}</>}>
      <PlayArea fx={fx} bg="#050a14" border={alpha(C.cyan, 0.4)} {...pan}>
        <View style={{ position: 'absolute', left: BX, top: BY, width: BS, height: BS, borderRadius: 18, backgroundColor: alpha(C.cyan, 0.06), borderWidth: 2, borderColor: alpha(C.cyan, 0.35) }} />
        {Array.from({ length: N * N }, (_, i) => <View key={i} style={{ position: 'absolute', left: px(i % N), top: py(Math.floor(i / N)), width: CELLW, height: CELLW, borderRadius: 12, backgroundColor: alpha(C.cyan, 0.07) }} />)}
        {s.tiles.map(t => {
          const age = Math.min(1, (s.t - t.born) / 0.16);
          const sc = (t.pop > 0 ? 1 + Math.sin((1 - t.pop / 0.18) * Math.PI) * 0.18 : 1) * (0.55 + 0.45 * (1 - Math.pow(1 - age, 3)));
          const [bg, bd] = col(t.v);
          const digits = String(t.v).length;
          return (
            <View key={t.id} style={{ position: 'absolute', left: t.x, top: t.y, width: CELLW, height: CELLW, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderWidth: 2, borderColor: bd, transform: [{ scale: sc }], opacity: t.die ? 0.6 : 1, zIndex: t.die ? 0 : 1, ...glow(bd, t.v >= 128 ? 16 : 6, 0.6) }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: CELLW * (digits <= 2 ? 0.42 : digits === 3 ? 0.34 : 0.27), ...tglow('#000', 3) }}>{t.v}</Text>
            </View>
          );
        })}
        <View style={{ position: 'absolute', left: 0, right: 0, top: BY + BS + 18, flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
          <Btn label={`↩ DESHACER (${s.undos})`} small ghost color={C.cyan} disabled={!s.undo || s.undos <= 0} onPress={doUndo} />
          <Btn label="NUEVA" small ghost color={C.dim} onPress={start} />
        </View>
        <Text pointerEvents="none" style={{ position: 'absolute', bottom: 16, width: AREA_W, textAlign: 'center', color: alpha(C.dim, 0.7), fontSize: 11, fontWeight: '800', letterSpacing: 2 }}>DESLIZA PARA MOVER LAS FICHAS</Text>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🟦" title={phase === 'over' ? (res.won ? '¡LLEGASTE AL 2048!' : 'SIN MOVIMIENTOS') : '2048 NEON'}
          subtitle={phase === 'over' ? `Ficha máxima: ${maxTile}` : 'Fusiona fichas iguales'}
          score={s.score} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Desliza en cualquier dirección', 'Las fichas iguales se fusionan', 'Tienes 3 deshacer por partida'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ══════════════════════════════════════════════════════════════════
// WHACK-A-MOLE
// ══════════════════════════════════════════════════════════════════

const WM_GRID_SIZE = 9;
const WM_BOMB_CHANCE = 0.2;
const WM_GAME_DURATION = 60;
const WM_HOLE_SIZE = Math.min((width - 60) / 3, 90);

function WhackAMole({ onExit }) {
  const DUR = 45;
  const GW = AREA_W - 36, HOLE = Math.floor(GW / 3) - 10, GAPX = (GW - HOLE * 3) / 2, GX0 = 18;
  const GY0 = Math.max(70, (AREA_H - (HOLE + 24) * 3) / 2 + 6), RH = HOLE + 24;
  const fx = useFX();
  const [best, submitBest] = useBest('whack');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const initState = () => ({ holes: Array.from({ length: 9 }, () => null), time: DUR, t: 0, score: 0, combo: 0, maxCombo: 0, spawn: 0.5, hits: 0, misses: 0, hammer: null, freeze: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const holeCenter = i => ({ x: GX0 + (i % 3) * (HOLE + GAPX) + HOLE / 2, y: GY0 + Math.floor(i / 3) * RH + HOLE * 0.6 });
  const spawn = s => {
    const free = s.holes.map((h, i) => (h ? -1 : i)).filter(i => i >= 0);
    if (!free.length) return;
    const i = pick(free);
    const r = Math.random();
    const type = r < 0.62 ? 'mole' : r < 0.74 ? 'gold' : r < 0.84 ? 'helmet' : r < 0.94 ? 'bomb' : 'clock';
    const life = Math.max(0.55, 1.5 - s.t * 0.018) * (type === 'gold' ? 0.7 : 1);
    s.holes[i] = { type, age: 0, life, hp: type === 'helmet' ? 2 : 1, hit: 0 };
  };
  const whack = (x, y) => {
    const s = g.current;
    if (phase !== 'play') return;
    let target = -1, bd = 1e9;
    s.holes.forEach((h, i) => { if (!h || h.hit) return; const c = holeCenter(i); const d = Math.hypot(c.x - x, c.y - y); if (d < HOLE * 0.62 && d < bd) { bd = d; target = i; } });
    s.hammer = { x, y, t: 0.18 };
    if (target < 0) { if (s.combo > 0) s.combo = 0; hx.tick(); return; }
    const h = s.holes[target]; const c = holeCenter(target);
    h.hp -= 1;
    if (h.type === 'bomb') {
      h.hit = 0.3; s.combo = 0; s.time = Math.max(0, s.time - 4);
      fx.burst(c.x, c.y, C.red, 22, 260); fx.shake(9, 0.3); fx.flash(C.red, 0.3); fx.pop(c.x, c.y - 30, '-4s', C.red, 22); hx.bad();
    } else if (h.type === 'clock') {
      h.hit = 0.3; s.time += 3; fx.burst(c.x, c.y, C.lime, 12, 190); fx.pop(c.x, c.y - 30, '+3s', C.lime, 22); hx.good();
    } else if (h.hp > 0) {
      fx.burst(c.x, c.y - 10, '#fff', 6, 140, 0.3, 3); fx.shake(3, 0.15); hx.hit();
    } else {
      h.hit = 0.3; s.hits += 1; s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
      const base = h.type === 'gold' ? 5 : h.type === 'helmet' ? 3 : 1;
      const mult = 1 + Math.floor(s.combo / 5);
      const pts = base * mult; s.score += pts;
      fx.burst(c.x, c.y - 10, h.type === 'gold' ? C.amber : C.orange, 12, 200, 0.5, 4); fx.pop(c.x, c.y - 40, `+${pts}`, mult > 1 ? C.amber : C.text, 18); fx.ring(c.x, c.y, C.orange, 44); hx.heavy();
    }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt; s.time -= dt;
    if (s.hammer) { s.hammer.t -= dt; if (s.hammer.t <= 0) s.hammer = null; }
    s.spawn -= dt;
    if (s.spawn <= 0) { spawn(s); if (s.t > 18 && Math.random() < 0.4) spawn(s); s.spawn = Math.max(0.28, 0.85 - s.t * 0.014) * rand(0.7, 1.2); }
    s.holes.forEach((h, i) => {
      if (!h) return;
      h.age += dt;
      if (h.hit > 0) { h.hit -= dt; if (h.hit <= 0) s.holes[i] = null; return; }
      if (h.age >= h.life) { if (h.type === 'mole' || h.type === 'gold' || h.type === 'helmet') s.combo = 0; s.holes[i] = null; }
    });
    if (s.time <= 0) { s.time = 0; hx.win(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  });
  const pan = usePan(fx, { down: whack });
  const s = g.current;
  const E = { mole: '🐹', gold: '🦔', helmet: '🐻', bomb: '💣', clock: '⏱️' };
  const mult = 1 + Math.floor(s.combo / 5);
  return (
    <GameScreen title="WHACK-A-MOLE" emoji="🐹" accent={C.violet} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: s.time < 8 ? C.red : C.text, fontWeight: '900', fontSize: 15 }}>⏱ {Math.ceil(s.time)}s</Text><Text style={{ color: C.dim, fontSize: 12 }}>Racha <Text style={{ color: C.violet, fontWeight: '800' }}>{s.combo}</Text></Text><View style={{ minWidth: 64, alignItems: 'flex-end' }}>{mult > 1 ? <Combo n={mult} color={C.violet} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#0a0616" border={alpha(C.violet, 0.4)} {...pan}>
        <GridBg color={C.violet} step={46} />
        {s.holes.map((h, i) => {
          const c = holeCenter(i);
          const k = h ? (h.hit > 0 ? 0 : Math.min(1, h.age * 7) * (h.age > h.life - 0.15 ? Math.max(0, (h.life - h.age) / 0.15) : 1)) : 0;
          return (
            <View key={i} style={{ position: 'absolute', left: c.x - HOLE / 2, top: c.y - HOLE * 0.6, width: HOLE, height: HOLE * 0.95, alignItems: 'center' }} pointerEvents="none">
              <View style={{ position: 'absolute', bottom: 0, width: HOLE * 0.92, height: HOLE * 0.4, borderRadius: HOLE * 0.2, backgroundColor: '#05030c', borderWidth: 2, borderColor: alpha(C.violet, 0.5) }} />
              <View style={{ position: 'absolute', bottom: HOLE * 0.2, left: 0, right: 0, height: HOLE * 0.75, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' }}>
                {h && <Text style={{ fontSize: HOLE * 0.62, lineHeight: HOLE * 0.72, transform: [{ translateY: (1 - k) * HOLE * 0.7 }, { scale: h.hit > 0 ? 0.85 : 1 }], opacity: h.hit > 0 ? 0.6 : 1 }}>{E[h.type]}</Text>}
              </View>
              <View style={{ position: 'absolute', bottom: HOLE * 0.2 - 4, width: HOLE * 0.95, height: HOLE * 0.2, borderRadius: HOLE * 0.1, backgroundColor: '#1d1236', borderTopWidth: 2, borderTopColor: alpha(C.violet, 0.6) }} />
            </View>
          );
        })}
        {s.hammer && <Text pointerEvents="none" style={{ position: 'absolute', left: s.hammer.x - 22, top: s.hammer.y - 40, fontSize: 40, transform: [{ rotate: `${-0.9 + (0.18 - s.hammer.t) * 6}rad` }] }}>🔨</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🐹" title={phase === 'over' ? '¡TIEMPO!' : 'WHACK-A-MOLE'}
          subtitle={phase === 'over' ? `${s.hits} topos · mejor racha ${s.maxCombo}` : '45 segundos de caos'}
          score={s.score} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Golpea los topos que asoman', '🦔 vale 5 · 🐻 casco: 2 golpes · ⏱️ +3s', '💣 resta 4s · fallar rompe la racha'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ══════════════════════════════════════════════════════════════════
// RHYTHM TAP
// ══════════════════════════════════════════════════════════════════

const RT_COLORS = [
  { key: 'red', label: '🔴', bg: '#c0392b', lit: '#ff6b6b', text: 'Rojo' },
  { key: 'blue', label: '🔵', bg: '#2980b9', lit: '#74b9ff', text: 'Azul' },
  { key: 'yellow', label: '🟡', bg: '#d4a017', lit: '#ffeaa7', text: 'Amarillo' },
  { key: 'green', label: '🟢', bg: '#27ae60', lit: '#55efc4', text: 'Verde' },
];
const RT_PAD_SIZE = Math.min((width - 48) / 2, 155);

function RhythmTap({ onExit }) {
  const PADS = [
    { c: C.red, n: 'ROJO', h: 'tap' }, { c: C.blue, n: 'AZUL', h: 'hit' },
    { c: C.lime, n: 'VERDE', h: 'heavy' }, { c: C.amber, n: 'AMARILLO', h: 'tick' },
  ];
  const later = useTimeouts();
  const fx = useFX();
  const [best, submitBest] = useBest('simon');
  const [phase, setPhase] = useState('ready');       // ready | play | over
  const [mode, setMode] = useState('show');          // show | input | wait
  const [seq, setSeq] = useState([]);
  const [pos, setPos] = useState(0);
  const [lit, setLit] = useState(-1);
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(0);
  const [reverse, setReverse] = useState(false);
  const [timeLeft, setTimeLeft] = useState(1);
  const [res, setRes] = useState({ isNew: false });
  const seqRef = useRef([]); const gen = useRef(0); const inputT = useRef(0);

  const play = (list, rev, rnd, sc) => {
    const id = ++gen.current;
    setMode('show'); setPos(0); setReverse(rev);
    const step = Math.max(230, 520 - rnd * 22);
    list.forEach((p, i) => {
      later(() => { if (gen.current !== id) return; setLit(p); hx[PADS[p].h](); }, 700 + i * step);
      later(() => { if (gen.current !== id) return; setLit(-1); }, 700 + i * step + step * 0.62);
    });
    later(() => { if (gen.current !== id) return; setMode('input'); inputT.current = Date.now(); setTimeLeft(1); }, 700 + list.length * step + 150);
  };
  const nextRound = (sc, rnd) => {
    const list = [...seqRef.current, randInt(0, 3)];
    seqRef.current = list; setSeq(list); setRound(rnd);
    const rev = rnd > 0 && rnd % 5 === 0;
    play(list, rev, rnd, sc);
  };
  const start = () => { fx.clear(); gen.current += 1; seqRef.current = []; setScore(0); setPhase('play'); nextRound(0, 1); };
  useEffect(() => { // temporizador de entrada
    if (phase !== 'play' || mode !== 'input') return undefined;
    const id = setInterval(() => {
      const left = 1 - (Date.now() - inputT.current) / (2500 + seqRef.current.length * 900);
      setTimeLeft(Math.max(0, left));
      if (left <= 0) { clearInterval(id); fail('tiempo'); }
    }, 60);
    return () => clearInterval(id);
  }, [phase, mode, pos]); // eslint-disable-line react-hooks/exhaustive-deps
  const fail = why => {
    gen.current += 1; hx.die(); fx.shake(8, 0.3); fx.flash(C.red, 0.3);
    setRes({ isNew: submitBest(score), why }); setPhase('over');
  };
  const press = i => {
    if (phase !== 'play' || mode !== 'input') return;
    setLit(i); later(() => setLit(-1), 140); hx[PADS[i].h]();
    const expect = reverse ? seq[seq.length - 1 - pos] : seq[pos];
    if (i !== expect) { fail('error'); return; }
    inputT.current = Date.now();
    if (pos + 1 >= seq.length) {
      const bonus = seq.length * 10 + (reverse ? 25 : 0);
      const sc = score + bonus; setScore(sc); hx.good(); fx.pop(AREA_W / 2, AREA_H * 0.2, `+${bonus}`, C.amber, 22);
      setMode('wait'); setPos(0);
      later(() => nextRound(sc, round + 1), 800);
    } else setPos(pos + 1);
  };
  const SZ = Math.min((AREA_W - 48) / 2, 150);
  return (
    <GameScreen title="RITMO Y COLOR" emoji="🎵" accent={C.violet} onExit={onExit} score={score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Ronda <Text style={{ color: C.violet, fontWeight: '800' }}>{round}</Text></Text><Text style={{ color: mode === 'show' ? C.cyan : mode === 'input' ? C.lime : C.dim, fontWeight: '900', fontSize: 13 }}>{phase !== 'play' ? '' : mode === 'show' ? 'MIRA…' : mode === 'input' ? (reverse ? '↩ AL REVÉS' : 'REPITE') : '¡BIEN!'}</Text><Text style={{ color: C.dim, fontSize: 12 }}>{seq.length} pasos</Text></>}>
      <PlayArea fx={fx} bg="#07051a" border={alpha(C.violet, 0.4)}>
        <View style={{ position: 'absolute', top: 24, left: 24, right: 24, height: 8, borderRadius: 4, backgroundColor: alpha(C.violet, 0.15), overflow: 'hidden' }}>
          <View style={{ width: `${(mode === 'input' ? timeLeft : 0) * 100}%`, height: '100%', backgroundColor: timeLeft < 0.3 ? C.red : C.violet }} />
        </View>
        {reverse && mode !== 'wait' && phase === 'play' && <Text style={{ position: 'absolute', top: 44, width: AREA_W, textAlign: 'center', color: C.pink, fontWeight: '900', letterSpacing: 2, fontSize: 13 }}>RONDA ESPECIAL: REPITE AL REVÉS</Text>}
        <View style={{ position: 'absolute', left: 0, right: 0, top: AREA_H / 2 - SZ - 12, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: SZ * 2 + 16, gap: 16 }}>
            {PADS.map((p, i) => {
              const on = lit === i;
              return (
                <Pressable key={i} testID={`pad-${i}`} onPressIn={() => press(i)} style={{ width: SZ, height: SZ }}>
                  <View style={{ flex: 1, borderRadius: 28, backgroundColor: on ? p.c : alpha(p.c, 0.16), borderWidth: 3, borderColor: on ? '#fff' : alpha(p.c, 0.7), transform: [{ scale: on ? 1.04 : 1 }], alignItems: 'center', justifyContent: 'center', ...glow(p.c, on ? 28 : 8, on ? 1 : 0.4) }}>
                    <Text style={{ color: on ? '#04040c' : alpha(p.c, 0.9), fontWeight: '900', letterSpacing: 2, fontSize: 14 }}>{p.n}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🎵" title={phase === 'over' ? (res.why === 'tiempo' ? '¡SE ACABÓ EL TIEMPO!' : 'SECUENCIA INCORRECTA') : 'RITMO Y COLOR'}
          subtitle={phase === 'over' ? `Llegaste a la ronda ${round}` : 'Memoriza y repite la secuencia'}
          score={score} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Mira la secuencia y repítela', 'Cada ronda añade un paso y va más rápido', 'Cada 5 rondas: ¡hay que repetirla al revés!'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ══════════════════════════════════════════════════════════════════
// STAR CATCHER
// ══════════════════════════════════════════════════════════════════

const SC_CATCHER_W = 70;
const SC_CATCHER_H = 18;
const SC_OBJ_SIZE = 28;
const SC_MAX_LIVES = 5;
const SC_INIT_LIVES = 3;
const SC_GAME_DURATION = 60;
const SC_MAX_OBJECTS = 6;
const SC_OBJECT_TYPES = [{ emoji:'⭐',points:1,type:'star'},{emoji:'💎',points:3,type:'diamond'},{emoji:'💣',points:0,type:'bomb'},{emoji:'❤️',points:0,type:'heart'}];
const SC_TYPE_WEIGHTS = [50,25,15,10];
function scPickType() { const r=Math.random()*100; let acc=0; for(let i=0;i<SC_TYPE_WEIGHTS.length;i++){acc+=SC_TYPE_WEIGHTS[i];if(r<acc)return SC_OBJECT_TYPES[i];}return SC_OBJECT_TYPES[0]; }

function StarCatcher({ onExit }) {
  const CW = 78, CY = AREA_H - 54, DUR = 60;
  const fx = useFX();
  const [best, submitBest] = useBest('starcatcher');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const stars = useRef(makeStars(30)).current;
  const initState = () => ({ x: AREA_W / 2, tx: AREA_W / 2, objs: [], spawn: 0.4, time: DUR, t: 0, score: 0, lives: 3, combo: 0, maxCombo: 0, magnet: 0, dbl: 0, freeze: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const TY = {
    star: { e: '⭐', w: 50 }, gem: { e: '💎', w: 18 }, bomb: { e: '💣', w: 16 }, heart: { e: '❤️', w: 5 }, magnet: { e: '🧲', w: 4 }, dbl: { e: '🌈', w: 4 }, ice: { e: '❄️', w: 3 },
  };
  const pickType = () => { const tot = Object.values(TY).reduce((a, b) => a + b.w, 0); let r = Math.random() * tot; for (const k of Object.keys(TY)) { r -= TY[k].w; if (r <= 0) return k; } return 'star'; };
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const finish = (s, why) => {
    hx.win(); setRes({ isNew: submitBest(s.score), why }); setPhase('over');
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt; s.time -= dt;
    ['magnet', 'dbl', 'freeze'].forEach(k => { if (s[k] > 0) s[k] = Math.max(0, s[k] - dt); });
    s.x += (s.tx - s.x) * Math.min(1, dt * 20);
    const fall = (150 + s.t * 3.2) * (s.freeze > 0 ? 0.4 : 1);
    s.spawn -= dt;
    if (s.spawn <= 0) { s.objs.push({ id: uid(), type: pickType(), x: rand(22, AREA_W - 22), y: -20, vy: fall * rand(0.9, 1.25), rot: 0 }); s.spawn = Math.max(0.22, 0.6 - s.t * 0.005); }
    for (let i = s.objs.length - 1; i >= 0; i--) {
      const o = s.objs[i];
      if (s.magnet > 0 && (o.type === 'star' || o.type === 'gem') && o.y > AREA_H * 0.3) o.x += clamp(s.x - o.x, -1, 1) * 160 * dt;
      o.y += (s.freeze > 0 ? fall : o.vy) * dt;
      const caught = o.y > CY - 8 && o.y < CY + 22 && Math.abs(o.x - s.x) < CW / 2 + 8;
      if (caught) {
        s.objs.splice(i, 1);
        const m = s.dbl > 0 ? 2 : 1;
        if (o.type === 'star' || o.type === 'gem') {
          s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
          const pts = (o.type === 'gem' ? 5 : 1) * m * (1 + Math.floor(s.combo / 8));
          s.score += pts; fx.burst(o.x, CY, o.type === 'gem' ? C.cyan : C.amber, 8, 150, 0.4, 4); fx.pop(o.x, CY - 20, `+${pts}`, C.text, 14); hx.tap();
        } else if (o.type === 'bomb') {
          s.lives -= 1; s.combo = 0; fx.burst(o.x, CY, C.red, 22, 260); fx.shake(9, 0.3); fx.flash(C.red, 0.3); hx.bad();
          if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score), why: 'bombas' }); setPhase('over'); return; }
        } else if (o.type === 'heart') { s.lives = Math.min(5, s.lives + 1); fx.pop(o.x, CY - 20, '+1 VIDA', C.red, 15); fx.ring(o.x, CY, C.red, 44); hx.good(); }
        else if (o.type === 'magnet') { s.magnet = 8; fx.pop(o.x, CY - 20, 'IMÁN', C.cyan, 15); hx.good(); }
        else if (o.type === 'dbl') { s.dbl = 8; fx.pop(o.x, CY - 20, 'PUNTOS ×2', C.pink, 15); hx.good(); }
        else if (o.type === 'ice') { s.freeze = 5; fx.pop(o.x, CY - 20, 'CONGELADO', C.cyan, 15); fx.flash(C.cyan, 0.2); hx.good(); }
      } else if (o.y > AREA_H + 20) {
        s.objs.splice(i, 1);
        if (o.type === 'star' || o.type === 'gem') s.combo = 0;
      }
    }
    if (s.time <= 0) { s.time = 0; finish(s, 'tiempo'); }
  });
  const pan = usePan(fx, { down: x => { g.current.tx = clamp(x, CW / 2, AREA_W - CW / 2); }, move: x => { g.current.tx = clamp(x, CW / 2, AREA_W - CW / 2); } });
  const s = g.current;
  return (
    <GameScreen title="STAR CATCHER" emoji="⭐" accent={C.amber} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: s.time < 10 ? C.red : C.text, fontWeight: '900', fontSize: 15 }}>⏱ {Math.ceil(s.time)}s</Text><Lives n={s.lives} max={Math.max(3, s.lives)} /><View style={{ minWidth: 80, alignItems: 'flex-end' }}>{s.combo > 2 ? <Combo n={s.combo} /> : <Text style={{ color: C.cyan, fontSize: 12, fontWeight: '800' }}>{s.magnet > 0 ? '🧲' : ''}{s.dbl > 0 ? '🌈' : ''}{s.freeze > 0 ? '❄️' : ''}</Text>}</View></>}>
      <PlayArea fx={fx} bg="#06061a" border={alpha(C.amber, 0.35)} {...pan}>
        <Starfield stars={stars} offset={s.t * 40} />
        {s.objs.map(o => <Text key={o.id} style={{ position: 'absolute', left: o.x - 18, top: o.y - 20, width: 36, textAlign: 'center', fontSize: 28, lineHeight: 36 }}>{TY[o.type].e}</Text>)}
        <View style={{ position: 'absolute', left: s.x - CW / 2, top: CY, width: CW, height: 26, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: alpha(C.amber, 0.25), borderWidth: 2, borderColor: C.amber, ...glow(C.amber, 14, 0.8) }} />
        {s.magnet > 0 && <View style={{ position: 'absolute', left: s.x - 56, top: CY - 30, width: 112, height: 112, borderRadius: 56, borderWidth: 1, borderColor: alpha(C.cyan, 0.4) }} />}
        <Overlay show={phase !== 'play'} kind={phase} emoji="⭐" title={phase === 'over' ? (res.why === 'bombas' ? 'DEMASIADAS BOMBAS' : '¡TIEMPO!') : 'STAR CATCHER'}
          subtitle={phase === 'over' ? `Mejor racha: ${s.maxCombo}` : '60 segundos para atrapar estrellas'}
          score={s.score} best={best} isNew={res.isNew} accent={C.amber} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra la cesta para atrapar', '⭐ 1 · 💎 5 · 💣 quita vida', '🧲 imán · 🌈 ×2 · ❄️ congela · ❤️ vida', 'No dejar caer estrellas mantiene la racha'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ══════════════════════════════════════════════════════════════════
// WORD SCRAMBLE
// ══════════════════════════════════════════════════════════════════

const WS_WORDS = ['GATO','CASA','MUNDO','PLAYA','JUEGO','CIELO','FUEGO','AGUA','LIBRO','VERDE','ROJO','NOCHE','LUNA','SOL','FLOR','ARBOL','PATO','MESA','SILLA','PUERTA'];
const WS_TOTAL = WS_WORDS.length;
const WS_TILE_COLORS = ['#ff6b6b','#ffd166','#06d6a0','#118ab2','#a855f7','#f97316','#14b8a6','#e879f9'];
function wsScramble(word){const arr=word.split('');for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}if(arr.join('')===word&&word.length>1)[arr[0],arr[1]]=[arr[1],arr[0]];return arr;}
function wsShuffleWords(){const arr=[...WS_WORDS];for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}

function WordScramble({ onExit }) {
  const BANK = {
    4: [['GATO', 'Maúlla y le gusta el pescado'], ['CASA', 'Donde vives'], ['LUNA', 'Brilla de noche'], ['AGUA', 'Líquido transparente que bebes'], ['MESA', 'Comes sobre ella'], ['FLOR', 'Nace en el jardín y huele bien'], ['PATO', 'Ave que nada y hace cuac'], ['SOPA', 'Plato caliente con caldo']],
    5: [['LIBRO', 'Se lee y tiene páginas'], ['PLAYA', 'Arena y mar'], ['CIELO', 'Azul sobre tu cabeza'], ['FUEGO', 'Quema y da calor'], ['NOCHE', 'Cuando sale la luna'], ['SILLA', 'Te sientas en ella'], ['TIGRE', 'Felino con rayas'], ['RELOJ', 'Marca la hora'], ['PIZZA', 'Redonda, con queso'], ['CARRO', 'Vehículo de cuatro ruedas']],
    6: [['PUERTA', 'Se abre para entrar'], ['BOSQUE', 'Muchos árboles juntos'], ['CAMINO', 'Por donde caminas'], ['COCINA', 'Donde se prepara la comida'], ['DELFÍN', 'Mamífero marino muy listo'], ['CAMISA', 'Prenda con botones'], ['ÁRBOLES', 'Tienen tronco y hojas']],
    7: [['PLANETA', 'Tierra, Marte o Venus'], ['VENTANA', 'Entra luz por ella'], ['ESCUELA', 'Donde estudias'], ['JUGUETE', 'Con él juegan los niños'], ['TORTUGA', 'Lenta, con caparazón'], ['MONTAÑA', 'Más alta que una colina'], ['CUCHARA', 'Sirve para tomar sopa']],
    8: [['ELEFANTE', 'Gran animal con trompa'], ['MARIPOSA', 'Insecto con alas de colores'], ['GUITARRA', 'Instrumento de seis cuerdas'], ['ESTRELLA', 'Brilla en el cielo nocturno'], ['TELÉFONO', 'Sirve para llamar'], ['AVENTURA', 'Viaje lleno de emoción']],
  };
  const TOTAL = 10;
  const COLS = [C.red, C.cyan, C.lime, C.amber, C.violet, C.pink, C.orange, C.blue];
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('wordscramble');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);
  const mkWord = (idx) => {
    const len = idx < 2 ? 4 : idx < 5 ? 5 : idx < 7 ? 6 : idx < 9 ? 7 : 8;
    const [w, hint] = pick(BANK[len]);
    let letters = shuffle(w.split(''));
    if (letters.join('') === w) letters = letters.reverse();
    return { word: w, hint, tiles: letters.map((l, i) => ({ id: i, l, used: false })), slots: [], limit: 22 + w.length * 3, t: 0, revealed: 0, lock: false, bad: 0 };
  };
  const init = () => ({ idx: 0, score: 0, lives: 3, streak: 0, cur: mkWord(0), solved: 0 });
  if (!g.current) g.current = init();
  const start = () => { fx.clear(); g.current = init(); setPhase('play'); };
  const nextWord = (s) => {
    s.idx += 1;
    if (s.idx >= TOTAL) { hx.win(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
    s.cur = mkWord(s.idx); force();
  };
  const lose = (s, why) => {
    s.lives -= 1; s.streak = 0; hx.bad(); fx.shake(6, 0.25); fx.flash(C.red, 0.2);
    fx.pop(AREA_W / 2, AREA_H * 0.3, why === 'tiempo' ? `Era: ${s.cur.word}` : `Era: ${s.cur.word}`, C.red, 18);
    s.cur.lock = true; force();
    if (s.lives <= 0) { later(() => { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }, 900); return; }
    later(() => nextWord(s), 1000);
  };
  const check = s => {
    const c = s.cur;
    const guess = c.slots.map(i => c.tiles[i].l).join('');
    if (guess === c.word) {
      const pts = 50 + Math.max(0, Math.round(c.limit - c.t)) * 3 + s.streak * 10 - c.revealed * 20;
      s.score += Math.max(10, pts); s.streak += 1; s.solved += 1; c.lock = true;
      fx.burst(AREA_W / 2, AREA_H * 0.28, C.lime, 24, 260); fx.pop(AREA_W / 2, AREA_H * 0.2, `+${Math.max(10, pts)}`, C.lime, 24); hx.good(); force();
      later(() => nextWord(s), 800);
    } else {
      c.bad = 0.4; s.streak = 0; hx.bad(); fx.shake(5, 0.2);
      later(() => { c.tiles.forEach(t => { t.used = false; }); c.slots = []; force(); }, 350);
    }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current; const c = s.cur;
    if (c.lock) return;
    c.t += dt; if (c.bad > 0) c.bad -= dt;
    if (c.t >= c.limit) lose(s, 'tiempo');
  });
  const tapTile = id => {
    const s = g.current; const c = s.cur;
    if (phase !== 'play' || c.lock || c.bad > 0 || c.tiles[id].used) return;
    c.tiles[id].used = true; c.slots.push(id); hx.tick();
    if (c.slots.length === c.word.length) check(s);
    force();
  };
  const tapSlot = k => {
    const s = g.current; const c = s.cur;
    if (phase !== 'play' || c.lock || c.bad > 0) return;
    const id = c.slots[k]; if (id == null) return;
    c.tiles[id].used = false; c.slots.splice(k, 1); hx.tick(); force();
  };
  const reveal = () => {
    const s = g.current; const c = s.cur;
    if (phase !== 'play' || c.lock) return;
    // devolver todo y poner la siguiente letra correcta
    c.tiles.forEach(t => { t.used = false; }); c.slots = [];
    c.revealed += 1;
    for (let k = 0; k < c.revealed && k < c.word.length; k++) {
      const t = c.tiles.find(tt => !tt.used && tt.l === c.word[k]); if (t) { t.used = true; c.slots.push(t.id); }
    }
    hx.hit(); force();
  };
  const shuffleTiles = () => { const c = g.current.cur; if (c.lock) return; c.tiles = shuffle(c.tiles); hx.tick(); force(); };
  const s = g.current; const c = s.cur;
  const len = c.word.length;
  const TS = Math.min(48, Math.floor((AREA_W - 40 - (len - 1) * 8) / len));
  return (
    <GameScreen title="PALABRAS" emoji="🔤" accent={C.violet} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.dim, fontSize: 12 }}>Palabra <Text style={{ color: C.violet, fontWeight: '800' }}>{Math.min(TOTAL, s.idx + 1)}/{TOTAL}</Text></Text><View style={{ minWidth: 70, alignItems: 'flex-end' }}>{s.streak > 1 ? <Combo n={s.streak} color={C.violet} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#0a0616" border={alpha(C.violet, 0.4)}>
        <View style={{ position: 'absolute', top: 18, left: 18, right: 18 }}>
          <Bar value={c.limit - c.t} max={c.limit} color={c.t / c.limit > 0.75 ? C.red : C.violet} h={10} />
          <Text style={{ color: C.dim, textAlign: 'center', marginTop: 14, fontSize: 14, lineHeight: 20 }}>💡 {c.hint}</Text>
        </View>
        <View style={{ position: 'absolute', left: 0, right: 0, top: AREA_H * 0.27, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {Array.from({ length: len }, (_, k) => {
              const id = c.slots[k]; const t = id != null ? c.tiles[id] : null;
              const ok = c.lock && s.cur.slots.length === len && c.slots.map(i => c.tiles[i].l).join('') === c.word;
              return (
                <Pressable key={k} onPress={() => tapSlot(k)} style={{ width: TS, height: TS + 6 }}>
                  <View style={{ flex: 1, borderRadius: 12, borderWidth: 2, borderColor: t ? (c.bad > 0 ? C.red : ok ? C.lime : C.violet) : alpha(C.violet, 0.35), backgroundColor: t ? alpha(c.bad > 0 ? C.red : ok ? C.lime : C.violet, 0.2) : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {t && <Text style={{ color: C.text, fontSize: TS * 0.56, fontWeight: '900' }}>{t.l}</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={{ position: 'absolute', left: 0, right: 0, top: AREA_H * 0.47, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, width: AREA_W - 30 }}>
            {c.tiles.map((t, i) => (
              <Pressable key={t.id} testID={`tile-${i}`} onPress={() => tapTile(t.id)} style={{ width: TS + 6, height: TS + 10 }}>
                <View style={{ flex: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.used ? 'transparent' : alpha(COLS[(t.id) % COLS.length], 0.85), borderWidth: 2, borderColor: t.used ? alpha(C.dim, 0.2) : '#fff5', ...(t.used ? null : glow(COLS[t.id % COLS.length], 10, 0.5)) }}>
                  {!t.used && <Text style={{ color: '#07040f', fontSize: TS * 0.6, fontWeight: '900' }}>{t.l}</Text>}
                </View>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 22, flexDirection: 'row', justifyContent: 'center', gap: 14 }}>
          <Btn label="🔀 MEZCLAR" small ghost color={C.violet} onPress={shuffleTiles} />
          <Btn label="💡 LETRA (-20)" small ghost color={C.amber} onPress={reveal} />
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🔤" title={phase === 'over' ? (s.idx >= TOTAL ? '¡COMPLETADO!' : 'FIN DEL JUEGO') : 'PALABRAS'}
          subtitle={phase === 'over' ? `${s.solved} de ${TOTAL} palabras resueltas` : 'Ordena las letras de 10 palabras'}
          score={s.score} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca las letras en orden · toca un hueco para quitarla', 'Cada palabra tiene un tiempo límite', 'Resolver rápido y en racha da más puntos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
// ── CROSSY ROAD ──────────────────────────────────────────────────

const CR2_COLS = 9;
const CR2_ROWS = 11;
const CR2_CELL = Math.floor((width - 16) / CR2_COLS);
const CR2_FROG_ROW_START = CR2_ROWS - 1;
const CR2_TRAFFIC_ROWS = 8;
const CR2_VEHICLES_CAR = ['🚗', '🚕', '🚙'];
const CR2_VEHICLES_TRUCK = ['🚛', '🚚', '🚌', '🚎'];
const CR2_BASE_SPEEDS = [1.2, 1.5, 1.0, 1.8, 1.3, 1.6, 1.1, 1.4];
const CR2_DIRECTIONS = [1, -1, 1, -1, 1, -1, 1, -1];

function cr2_makeRows(speedMult) {
  return Array.from({ length: CR2_TRAFFIC_ROWS }, (_, i) => {
    const dir = CR2_DIRECTIONS[i];
    const speed = CR2_BASE_SPEEDS[i] * speedMult;
    const count = 2 + Math.floor(Math.random() * 3);
    const isTruck = i % 3 === 2;
    const emoji = isTruck
      ? CR2_VEHICLES_TRUCK[Math.floor(Math.random() * CR2_VEHICLES_TRUCK.length)]
      : CR2_VEHICLES_CAR[Math.floor(Math.random() * CR2_VEHICLES_CAR.length)];
    const cellW = isTruck ? 2 : 1;
    const vehicles = Array.from({ length: count }, (__, j) => ({
      id: j,
      col: (j * Math.floor(CR2_COLS / count) + Math.floor(Math.random() * 2)) % CR2_COLS,
      emoji,
      cellW,
    }));
    return { dir, speed, vehicles, isTruck };
  });
}

function CR2_CrossyRoad({ onExit }) {
  const COLS = 9, CELL = Math.floor(AREA_W / COLS), OX = (AREA_W - COLS * CELL) / 2;
  const VIS = Math.ceil(AREA_H / CELL) + 2;
  const fx = useFX();
  const [best, submitBest] = useBest('crossy');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, why: '' });
  const CAR_COLORS = ['#ff4d6d', '#ffc233', '#22e6ff', '#7dff6b', '#9b6bff', '#ff8a3d'];

  const genRow = (idx, prev) => {
    if (idx < 3) return { type: 'grass', trees: [], coin: -1 };
    const r = Math.random();
    let type = 'grass';
    if (prev && prev.type === 'grass') type = r < 0.5 ? 'road' : r < 0.74 ? 'river' : r < 0.84 ? 'rail' : 'grass';
    else if (prev && prev.type === 'river') type = r < 0.3 ? 'river' : 'grass';
    else if (prev && prev.type === 'road') type = r < 0.55 ? 'road' : 'grass';
    const diff = Math.min(1, idx / 120);
    if (type === 'grass') {
      const trees = [];
      const n = randInt(1, 3);
      for (let i = 0; i < n; i++) { const c = randInt(0, COLS - 1); if (!trees.includes(c)) trees.push(c); }
      return { type, trees, coin: Math.random() < 0.22 ? randInt(0, COLS - 1) : -1 };
    }
    const dir = prev && prev.type === type ? -prev.dir : (Math.random() < 0.5 ? 1 : -1);
    if (type === 'road') {
      const L = AREA_W + 220, n = randInt(2, 3), sp = rand(70, 120) + diff * 110;
      const items = [];
      for (let i = 0; i < n; i++) { const truck = Math.random() < 0.3; items.push({ x: i * (L / n) + rand(0, L / n * 0.35), w: truck ? CELL * 1.9 : CELL * 1.0, truck, color: pick(CAR_COLORS) }); }
      return { type, dir, sp, L, items };
    }
    if (type === 'river') {
      const L = AREA_W + 180, n = 3, sp = rand(45, 85) + diff * 50;
      const items = [];
      for (let i = 0; i < n; i++) items.push({ x: i * (L / n) + rand(0, 20), w: CELL * randInt(2, 3) });
      return { type, dir, sp, L, items };
    }
    return { type: 'rail', dir, timer: rand(1, 4), period: rand(4, 6.5), train: null, warn: false };
  };

  const initState = () => {
    const rows = []; let prev = null;
    for (let i = 0; i < VIS + 6; i++) { const r = genRow(i, prev); rows.push(r); prev = r; }
    return { rows, px: OX + 4 * CELL + CELL / 2, row: 1, cam: 0, maxRow: 1, started: false, hop: 0, hopFrom: { x: 0, y: 1 }, t: 0, score: 0, coins: 0, dead: null, scroll: 0.14 };
  };
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };

  const die = (s, why) => {
    if (s.dead) return;
    s.dead = why;
    const y = AREA_H - (s.row - s.cam + 1) * CELL + CELL / 2;
    fx.burst(s.px, y, why === 'water' ? C.cyan : C.red, 24, 260, 0.8, 5); fx.shake(9, 0.35); fx.flash(why === 'water' ? C.blue : C.red, 0.3); hx.die();
    setRes({ isNew: submitBest(s.score), why });
    setPhase('over');
  };
  const colOf = x => clamp(Math.round((x - OX - CELL / 2) / CELL), 0, COLS - 1);
  const move = (dx, dy) => {
    const s = g.current;
    if (phase !== 'play' || s.dead) return;
    let nrow = s.row + dy;
    if (nrow < Math.floor(s.cam) ) { return; }
    const cur = s.rows[s.row];
    let nx = s.px;
    if (dx) nx = clamp(s.px + dx * CELL, OX + CELL / 2, OX + COLS * CELL - CELL / 2);
    else if (cur.type !== 'river' || s.rows[nrow].type !== 'river') nx = OX + colOf(s.px) * CELL + CELL / 2;
    if (dx && cur.type !== 'river') nx = OX + colOf(nx) * CELL + CELL / 2;
    const dest = s.rows[nrow];
    if (!dest) return;
    if (dest.type === 'grass' && dest.trees.includes(colOf(nx))) { fx.pop(nx, AREA_H - (s.row - s.cam + 1) * CELL, '🌲', C.dim, 16); hx.tick(); return; }
    s.hopFrom = { x: s.px, y: s.row }; s.hop = 1;
    s.px = nx; s.row = nrow;
    hx.tap();
    if (nrow > s.maxRow) { s.maxRow = nrow; s.score = (s.maxRow - 1) + s.coins * 5; s.started = true; }
    while (s.rows.length < s.row + VIS + 4) s.rows.push(genRow(s.rows.length, s.rows[s.rows.length - 1]));
    if (dest.type === 'grass' && dest.coin === colOf(nx)) { dest.coin = -1; s.coins += 1; s.score = (s.maxRow - 1) + s.coins * 5; fx.pop(nx, AREA_H - (nrow - s.cam + 1) * CELL, '+5', C.amber, 16); hx.good(); }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.dead) return;
    s.t += dt;
    if (s.hop > 0) s.hop = Math.max(0, s.hop - dt / 0.11);
    // cámara: sigue al jugador y presiona con avance automático
    const target = s.row - 4;
    if (s.started) s.scroll = Math.min(0.7, 0.14 + s.t * 0.005);
    s.cam = Math.max(s.cam + (s.started ? s.scroll * dt : 0), s.cam + (target - s.cam) * Math.min(1, dt * 5) * (target > s.cam ? 1 : 0));
    if (s.row < Math.floor(s.cam)) { die(s, 'cámara'); return; }
    const cur = s.rows[s.row];
    // actualizar filas visibles
    const lo = Math.max(0, Math.floor(s.cam) - 1), hi = Math.min(s.rows.length - 1, Math.ceil(s.cam) + VIS);
    for (let i = lo; i <= hi; i++) {
      const r = s.rows[i];
      if (r.type === 'road' || r.type === 'river') r.items.forEach(it => {
        it.x += r.dir * r.sp * dt;
        if (r.dir > 0 && it.x > AREA_W + 110) it.x -= r.L;
        if (r.dir < 0 && it.x + it.w < -110) it.x += r.L;
      });
      else if (r.type === 'rail') {
        r.timer += dt;
        r.warn = !r.train && r.timer > r.period - 1.4;
        if (!r.train && r.timer >= r.period) { r.train = { x: r.dir > 0 ? -AREA_W * 1.3 : AREA_W, w: AREA_W * 1.3 }; hx.warn(); }
        if (r.train) { r.train.x += r.dir * 900 * dt; if (r.train.x > AREA_W + 20 || r.train.x < -r.train.w - 20) { r.train = null; r.timer = 0; } }
      }
    }
    const hw = CELL * 0.3;
    if (cur.type === 'road') {
      for (const c of cur.items) if (s.px + hw > c.x && s.px - hw < c.x + c.w) { die(s, 'coche'); return; }
    } else if (cur.type === 'rail') {
      if (cur.train && s.px + hw > cur.train.x && s.px - hw < cur.train.x + cur.train.w) { die(s, 'tren'); return; }
    } else if (cur.type === 'river' && s.hop < 0.3) {
      const log = cur.items.find(l => s.px > l.x - 2 && s.px < l.x + l.w + 2);
      if (!log) { die(s, 'water'); return; }
      s.px += cur.dir * cur.sp * dt;
      if (s.px < OX || s.px > OX + COLS * CELL) { die(s, 'water'); return; }
    }
  });

  const pan = usePan(fx, {
    down: () => { const s = g.current; s.sx = null; s.used = false; },
    move: (x, y, gs) => {
      const s = g.current;
      if (s.used) return;
      if (Math.abs(gs.dx) > 22 || Math.abs(gs.dy) > 22) {
        s.used = true;
        if (Math.abs(gs.dx) > Math.abs(gs.dy)) move(gs.dx > 0 ? 1 : -1, 0); else if (gs.dy > 0) move(0, -1); else move(0, 1);
      }
    },
    up: (x, y, gs) => { const s = g.current; if (!s.used && Math.abs(gs.dx) < 12 && Math.abs(gs.dy) < 12) move(0, 1); },
  });

  const s = g.current;
  const rowY = i => AREA_H - (i - s.cam + 1) * CELL;
  const lo = Math.max(0, Math.floor(s.cam) - 1), hi = Math.min(s.rows.length - 1, Math.ceil(s.cam) + VIS);
  const py = s.hop > 0 ? lerp(rowY(s.row), rowY(s.hopFrom.y), s.hop) - Math.sin((1 - s.hop) * Math.PI) * 12 : rowY(s.row);
  const pxv = s.hop > 0 ? lerp(s.px, s.hopFrom.x, s.hop) : s.px;
  const rowEls = [];
  for (let i = lo; i <= hi; i++) {
    const r = s.rows[i]; const y = rowY(i);
    const base = { position: 'absolute', left: 0, width: AREA_W, top: y, height: CELL };
    if (r.type === 'grass') {
      rowEls.push(<View key={`g${i}`} style={[base, { backgroundColor: i % 2 ? '#123a1c' : '#0f3318' }]}>
        {r.trees.map(c => <Text key={c} style={{ position: 'absolute', left: OX + c * CELL, top: -2, width: CELL, textAlign: 'center', fontSize: CELL - 8, lineHeight: CELL }}>🌲</Text>)}
        {r.coin >= 0 && <Text style={{ position: 'absolute', left: OX + r.coin * CELL, top: 0, width: CELL, textAlign: 'center', fontSize: CELL - 16, lineHeight: CELL }}>🪙</Text>}
      </View>);
    } else if (r.type === 'road') {
      rowEls.push(<View key={`r${i}`} style={[base, { backgroundColor: '#1d1f2b' }]}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: CELL / 2 - 1, height: 2, backgroundColor: alpha('#ffffff', 0.12) }} />
        {r.items.map((c, k) => <View key={k} style={{ position: 'absolute', left: c.x, top: 6, width: c.w, height: CELL - 12, borderRadius: 8, backgroundColor: c.color, ...glow(c.color, 6, 0.5) }}>
          <View style={{ position: 'absolute', top: 4, bottom: 4, [r.dir > 0 ? 'right' : 'left']: 4, width: c.truck ? c.w * 0.28 : c.w * 0.32, borderRadius: 4, backgroundColor: 'rgba(8,10,24,0.65)' }} />
        </View>)}
      </View>);
    } else if (r.type === 'river') {
      rowEls.push(<View key={`w${i}`} style={[base, { backgroundColor: '#0b2a55' }]}>
        {r.items.map((c, k) => <View key={k} style={{ position: 'absolute', left: c.x, top: 5, width: c.w, height: CELL - 10, borderRadius: 10, backgroundColor: '#8a5a2b', borderWidth: 2, borderColor: '#c28a4d' }} />)}
      </View>);
    } else {
      rowEls.push(<View key={`t${i}`} style={[base, { backgroundColor: '#25222c' }]}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: CELL * 0.3, height: 2, backgroundColor: '#8a8a99' }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: CELL * 0.7, height: 2, backgroundColor: '#8a8a99' }} />
        {r.warn && <Text style={{ position: 'absolute', left: r.dir > 0 ? 6 : AREA_W - 34, top: 4, fontSize: 24, opacity: Math.floor(s.t * 8) % 2 ? 1 : 0.3 }}>🚨</Text>}
        {r.train && <View style={{ position: 'absolute', left: r.train.x, top: 4, width: r.train.w, height: CELL - 8, borderRadius: 6, backgroundColor: '#c0392b', borderWidth: 2, borderColor: '#ff7a6b' }}>{[0.1, 0.3, 0.5, 0.7, 0.9].map(f => <View key={f} style={{ position: 'absolute', left: r.train.w * f, top: 5, width: 20, height: CELL - 22, backgroundColor: 'rgba(255,230,150,0.8)', borderRadius: 3 }} />)}</View>}
      </View>);
    }
  }
  return (
    <GameScreen title="CROSSY ROAD" emoji="🐸" accent={C.lime} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Monedas <Text style={{ color: C.amber, fontWeight: '800' }}>{s.coins}</Text></Text><Text style={{ color: C.dim, fontSize: 12 }}>Toca: avanzar · Desliza: moverte</Text></>}>
      <PlayArea fx={fx} bg="#0f3318" border={alpha(C.lime, 0.35)} {...pan}>
        {rowEls}
        {!s.dead && <Text style={{ position: 'absolute', left: pxv - CELL / 2, top: py - 2, width: CELL, textAlign: 'center', fontSize: CELL - 8, lineHeight: CELL, ...tglow('#000', 4) }}>🐸</Text>}
        {phase === 'play' && s.started && s.row - s.cam < 1.6 && <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 28, backgroundColor: alpha(C.red, 0.35) }} />}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🐸" title={phase === 'over' ? (res.why === 'water' ? '¡AL AGUA!' : res.why === 'tren' ? '¡ARROLLADO POR UN TREN!' : res.why === 'cámara' ? '¡TE ALCANZARON!' : '¡ATROPELLADO!') : 'CROSSY ROAD'}
          subtitle={phase === 'over' ? `Avanzaste ${s.maxRow - 1} filas` : 'Cruza calles, ríos y vías'}
          score={s.score} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca para avanzar · desliza para moverte', 'Sube a los troncos para cruzar el río', 'Cuidado con los trenes (🚨) · la pantalla te empuja', '🪙 da +5 puntos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ── BUBBLE SHOOTER ────────────────────────────────────────────────

const BS_COLS = 10;
const BS_BUBBLE_R = Math.floor((width - 16) / BS_COLS / 2);
const BS_BUBBLE_D = BS_BUBBLE_R * 2;
const BS_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e91e63'];
const BS_SHOOTER_Y = GAME_HEIGHT - 80;
const BS_MAX_ROWS_VISIBLE = Math.floor((GAME_HEIGHT - 120) / BS_BUBBLE_D);

function bs_randomColor() {
  return BS_COLORS[Math.floor(Math.random() * BS_COLORS.length)];
}

function bs_makeRow(rowIndex, colorPool) {
  return Array.from({ length: BS_COLS }, (_, c) => ({
    id: `${rowIndex}-${c}`,
    color: colorPool[Math.floor(Math.random() * colorPool.length)],
    row: rowIndex,
    col: c,
    alive: true,
  }));
}

function bs_initGrid() {
  const pool = BS_COLORS.slice(0, 6);
  return Array.from({ length: 5 }, (_, i) => bs_makeRow(i, pool));
}

function BubbleShooter({ onExit }) {
  const COLS = 10, R = AREA_W / (COLS * 2), D = R * 2, RH = R * 1.7321;
  const SY = AREA_H - 46, SX = AREA_W / 2;
  const PAL = [C.red, C.cyan, C.lime, C.amber, C.violet, C.pink];
  const fx = useFX();
  const [best, submitBest] = useBest('bubbles');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const colsOf = row => (row.off ? COLS - 1 : COLS);
  const cx = (row, c) => R + c * D + (row.off ? R : 0);
  const mkRow = (off, ncol) => ({ off, cells: Array.from({ length: off ? COLS - 1 : COLS }, () => ({ k: randInt(0, ncol - 1) })) });
  const initState = (level, score) => {
    const ncol = Math.min(6, 3 + Math.floor(level / 2));
    const rows = [];
    const n = Math.min(8, 4 + level);
    for (let i = 0; i < n; i++) rows.push(mkRow(i % 2, ncol));
    const s = { level, score, ncol, rows, ball: null, cur: null, next: null, aim: null, misses: 0, limit: 6, shiftAnim: 0, falling: [], t: 0, shots: 0, combo: 0, over: false };
    s.cur = newBubble(s); s.next = newBubble(s);
    return s;
  };
  const colorsOnBoard = s => { const set = new Set(); s.rows.forEach(r => r.cells.forEach(c => c && set.add(c.k))); return [...set]; };
  const newBubble = s => {
    const cols = colorsOnBoard(s);
    const pool = cols.length ? cols : Array.from({ length: s.ncol }, (_, i) => i);
    const r = Math.random();
    if (s.level >= 2 && r < 0.05) return { k: 'bomb' };
    if (s.level >= 3 && r < 0.09) return { k: 'rainbow' };
    return { k: pick(pool) };
  };
  const g = useRef(null);
  if (!g.current) g.current = initState(1, 0);
  const start = () => { fx.clear(); g.current = initState(1, 0); setPhase('play'); };
  const colorOf = k => (k === 'bomb' ? '#ff9a3d' : k === 'rainbow' ? '#ffffff' : PAL[k]);
  const pos = (s, ri, ci) => ({ x: cx(s.rows[ri], ci), y: ri * RH + R - s.shiftAnim });

  const neighbors = (s, r, c) => {
    const row = s.rows[r]; const out = [];
    const cand = row.off ? [[r, c - 1], [r, c + 1], [r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1]] : [[r, c - 1], [r, c + 1], [r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c]];
    cand.forEach(([rr, cc]) => { if (rr >= 0 && rr < s.rows.length && cc >= 0 && cc < s.rows[rr].cells.length) out.push([rr, cc]); });
    return out;
  };
  const pop = (s, list, pts) => {
    list.forEach(([r, c]) => { const b = s.rows[r].cells[c]; if (!b) return; const p = pos(s, r, c); fx.burst(p.x, p.y, colorOf(b.k), 8, 200, 0.5, 4); s.rows[r].cells[c] = null; });
    if (pts) { const p = pos(s, list[0][0], list[0][1]); s.score += pts; fx.pop(p.x, p.y - 10, `+${pts}`, C.text, 17); }
  };
  const settle = (s, r, c) => {
    const b = s.rows[r].cells[c];
    let matched = [];
    if (b.k === 'bomb') {
      matched = [[r, c], ...neighbors(s, r, c).filter(([rr, cc]) => s.rows[rr].cells[cc])];
      neighbors(s, r, c).forEach(([rr, cc]) => { if (s.rows[rr].cells[cc]) neighbors(s, rr, cc).forEach(([r2, c2]) => { if (s.rows[r2].cells[c2] && !matched.some(m => m[0] === r2 && m[1] === c2) && Math.random() < 0.4) matched.push([r2, c2]); }); });
      const p = pos(s, r, c); fx.ring(p.x, p.y, C.orange, 90); fx.shake(7, 0.3); fx.flash(C.orange, 0.2); hx.heavy();
    } else {
      const seen = new Set([r * 100 + c]); const q = [[r, c]]; const target = b.k;
      while (q.length) {
        const [cr, cc] = q.pop(); matched.push([cr, cc]);
        neighbors(s, cr, cc).forEach(([nr, nc]) => {
          const nb = s.rows[nr].cells[nc]; const id = nr * 100 + nc;
          if (!nb || seen.has(id)) return;
          if (target === 'rainbow' ? true : (nb.k === target || nb.k === 'rainbow')) { seen.add(id); q.push([nr, nc]); }
        });
      }
      if (b.k === 'rainbow' && matched.length > 1) { const first = matched.slice(1).find(([rr, cc]) => typeof s.rows[rr].cells[cc].k === 'number'); if (first) { const tk = s.rows[first[0]].cells[first[1]].k; matched = matched.filter(([rr, cc]) => s.rows[rr].cells[cc].k === tk || (rr === r && cc === c)); } }
    }
    if (matched.length >= 3 || b.k === 'bomb') {
      s.combo += 1; s.misses = 0;
      pop(s, matched, matched.length * 10 + (matched.length - 3) * 8);
      hx.hit();
      // desprender flotantes
      const attached = new Set(); const q = [];
      s.rows[0].cells.forEach((cell, ci) => { if (cell) { attached.add(0 * 100 + ci); q.push([0, ci]); } });
      while (q.length) { const [cr, cc] = q.pop(); neighbors(s, cr, cc).forEach(([nr, nc]) => { const id = nr * 100 + nc; if (s.rows[nr].cells[nc] && !attached.has(id)) { attached.add(id); q.push([nr, nc]); } }); }
      let dropped = 0;
      s.rows.forEach((row, ri) => row.cells.forEach((cell, ci) => {
        if (cell && !attached.has(ri * 100 + ci)) { const p = pos(s, ri, ci); s.falling.push({ id: uid(), x: p.x, y: p.y, vy: 0, vx: rand(-40, 40), k: cell.k }); row.cells[ci] = null; dropped += 1; }
      }));
      if (dropped) { const pts = dropped * 20 * Math.max(1, dropped - 1); s.score += pts; fx.pop(AREA_W / 2, AREA_H * 0.4, `¡${dropped} CAEN! +${pts}`, C.amber, 20); hx.good(); }
    } else {
      s.combo = 0; s.misses += 1; hx.tap();
      if (s.misses >= s.limit) { // baja el techo
        s.misses = 0;
        s.rows.unshift(mkRow(s.rows[0].off ? 0 : 1, s.ncol)); s.shiftAnim = RH; fx.shake(4, 0.2); hx.warn();
      }
    }
    // limpiar filas vacías del final
    while (s.rows.length > 1 && s.rows[s.rows.length - 1].cells.every(x => !x)) s.rows.pop();
    if (!s.rows.some(row => row.cells.some(Boolean))) {
      s.score += 500; fx.flash('#fff', 0.35); fx.pop(AREA_W / 2, AREA_H / 2, `NIVEL ${s.level} SUPERADO +500`, C.lime, 22); hx.win();
      const ns = initState(s.level + 1, s.score); Object.assign(s, ns);
      return;
    }
    // derrota
    const lowest = s.rows.length - 1;
    if (lowest * RH + R > SY - D * 1.1) { s.over = true; hx.die(); fx.shake(10, 0.4); fx.flash(C.red, 0.3); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  };
  const snap = (s, x, y) => {
    let bestD = 1e9, bestC = null;
    for (let ri = Math.max(0, Math.floor((y - R) / RH) - 1); ri <= Math.floor((y - R) / RH) + 2; ri++) {
      if (ri < 0) continue;
      while (ri >= s.rows.length) s.rows.push({ off: s.rows[s.rows.length - 1].off ? 0 : 1, cells: Array(s.rows[s.rows.length - 1].off ? COLS : COLS - 1).fill(null) });
      const row = s.rows[ri];
      row.cells.forEach((cell, ci) => { if (cell) return; const px = cx(row, ci), py = ri * RH + R - s.shiftAnim; const d = Math.hypot(px - x, py - y); if (d < bestD) { bestD = d; bestC = [ri, ci]; } });
    }
    return bestC;
  };
  const fire = () => {
    const s = g.current;
    if (phase !== 'play' || s.ball || s.over || !s.aim) return;
    const a = s.aim; const sp = 1000;
    s.ball = { x: SX, y: SY, vx: Math.cos(a) * sp, vy: -Math.sin(a) * sp, k: s.cur.k };
    s.cur = s.next; s.next = newBubble(s); s.shots += 1; hx.tap();
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    if (s.shiftAnim > 0) s.shiftAnim = Math.max(0, s.shiftAnim - dt * 260);
    s.falling.forEach(f => { f.vy += 1400 * dt; f.y += f.vy * dt; f.x += f.vx * dt; });
    s.falling = s.falling.filter(f => f.y < AREA_H + 40);
    const b = s.ball;
    if (b) {
      const steps = Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 6);
      for (let i = 0; i < steps && s.ball; i++) {
        b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
        if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); }
        if (b.x > AREA_W - R) { b.x = AREA_W - R; b.vx = -Math.abs(b.vx); }
        let hit = b.y <= R - s.shiftAnim + 1;
        if (!hit) for (let ri = 0; ri < s.rows.length && !hit; ri++) { const row = s.rows[ri]; const ry = ri * RH + R - s.shiftAnim; if (Math.abs(ry - b.y) > D) continue; for (let ci = 0; ci < row.cells.length; ci++) { if (row.cells[ci] && Math.hypot(cx(row, ci) - b.x, ry - b.y) < D * 0.88) { hit = true; break; } } }
        if (hit) {
          const cell = snap(s, b.x, b.y);
          const kind = b.k;
          s.ball = null;
          if (cell) { s.rows[cell[0]].cells[cell[1]] = { k: kind }; settle(s, cell[0], cell[1]); }
          break;
        }
      }
    }
  });
  const aimFrom = (x, y) => {
    const dx = x - SX, dy = SY - y;
    let a = Math.atan2(dy, dx);
    a = clamp(a, 0.2, Math.PI - 0.2);
    g.current.aim = a;
  };
  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current;
      if (phase !== 'play') return;
      if (Math.hypot(x - SX, y - SY) < 34) { const t = s.cur; s.cur = s.next; s.next = t; hx.tick(); s.aim = null; s.swapped = true; return; }
      s.swapped = false; aimFrom(x, y);
    },
    move: (x, y) => { if (!g.current.swapped) aimFrom(x, y); },
    up: () => { const s = g.current; if (!s.swapped) fire(); s.aim = null; },
  });
  const s = g.current;
  // trayectoria de apuntado
  const dots = [];
  if (s.aim != null && !s.ball) {
    let x = SX, y = SY, vx = Math.cos(s.aim), vy = -Math.sin(s.aim);
    for (let i = 0; i < 70; i++) {
      x += vx * 9; y += vy * 9;
      if (x < R) { x = R; vx = Math.abs(vx); } if (x > AREA_W - R) { x = AREA_W - R; vx = -Math.abs(vx); }
      let stop = y < R;
      if (!stop) for (let ri = 0; ri < s.rows.length && !stop; ri++) { const ry = ri * RH + R; if (Math.abs(ry - y) > D) continue; for (let ci = 0; ci < s.rows[ri].cells.length; ci++) if (s.rows[ri].cells[ci] && Math.hypot(cx(s.rows[ri], ci) - x, ry - y) < D * 0.88) { stop = true; break; } }
      if (stop) break;
      if (i % 2 === 0) dots.push([x, y]);
    }
  }
  const bubble = (x, y, k, extra) => (
    <View key={extra && extra.key} style={{ position: 'absolute', left: x - R + 1, top: y - R + 1, width: D - 2, height: D - 2, borderRadius: R, backgroundColor: alpha(colorOf(k), 0.9), borderWidth: 2, borderColor: k === 'rainbow' ? C.pink : 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center', ...glow(colorOf(k), 8, 0.6) }}>
      <View style={{ position: 'absolute', left: R * 0.35, top: R * 0.3, width: R * 0.5, height: R * 0.35, borderRadius: R * 0.3, backgroundColor: 'rgba(255,255,255,0.45)' }} />
      {k === 'bomb' && <Text style={{ fontSize: R * 1.1 }}>💣</Text>}{k === 'rainbow' && <Text style={{ fontSize: R * 1.1 }}>🌈</Text>}
    </View>
  );
  const dangerY = SY - D * 1.1;
  return (
    <GameScreen title="BUBBLE SHOOTER" emoji="🫧" accent={C.red} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.red, fontWeight: '800' }}>{s.level}</Text></Text><View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: C.dim, fontSize: 11, marginRight: 6 }}>Techo en</Text>{Array.from({ length: s.limit }, (_, i) => <View key={i} style={{ width: 8, height: 8, borderRadius: 4, marginHorizontal: 1.5, backgroundColor: i < s.limit - s.misses ? C.red : alpha(C.red, 0.2) }} />)}</View><View style={{ minWidth: 60, alignItems: 'flex-end' }}>{s.combo > 1 ? <Combo n={s.combo} color={C.red} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#0a0510" border={alpha(C.red, 0.4)} {...pan}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: dangerY, height: 2, backgroundColor: alpha(C.red, 0.6), ...glow(C.red, 8, 0.7) }} />
        {s.rows.map((row, ri) => row.cells.map((cell, ci) => cell ? bubble(cx(row, ci), ri * RH + R - s.shiftAnim, cell.k, { key: `${ri}-${ci}` }) : null))}
        {s.falling.map(f => bubble(f.x, f.y, f.k, { key: f.id }))}
        {dots.map(([x, y], i) => <View key={i} pointerEvents="none" style={{ position: 'absolute', left: x - 2.5, top: y - 2.5, width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff', opacity: 0.6 - i * 0.008 }} />)}
        {s.ball && bubble(s.ball.x, s.ball.y, s.ball.k, { key: 'ball' })}
        {/* cañón */}
        <View style={{ position: 'absolute', left: SX - 22, top: SY - 22, width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: alpha(C.red, 0.6), backgroundColor: alpha(C.red, 0.1) }} />
        {!s.ball && bubble(SX, SY, s.cur.k, { key: 'cur' })}
        <View style={{ position: 'absolute', left: SX + 52, top: SY - R, opacity: 0.85, transform: [{ scale: 0.8 }] }}><View style={{ width: D, height: D }}>{bubble(R, R, s.next.k, { key: 'nx' })}</View></View>
        <Text style={{ position: 'absolute', left: SX + 42, top: SY + 18, color: C.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>SIGUIENTE</Text>
        <Text pointerEvents="none" style={{ position: 'absolute', left: SX - 100, top: SY + 20, width: 76, color: alpha(C.dim, 0.7), fontSize: 9, fontWeight: '800', textAlign: 'right' }}>TOCA PARA CAMBIAR</Text>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🫧" title={phase === 'over' ? 'LAS BURBUJAS LLEGARON' : 'BUBBLE SHOOTER'}
          subtitle={phase === 'over' ? `Nivel ${s.level} · ${s.shots} disparos` : 'Une 3 burbujas del mismo color'}
          score={s.score} best={best} isNew={res.isNew} accent={C.red} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para apuntar y suelta para disparar', 'Toca la burbuja del cañón para cambiarla', '💣 explota alrededor · 🌈 se une a cualquier color', 'Si fallas varias veces, el techo baja'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
