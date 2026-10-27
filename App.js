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
import { createArena } from './utils/arena3d';
import { ACHIEVEMENTS, Profile, ToastHost, levelInfo, toast, useProfile, useSettings } from './utils/meta';

const { width, height } = Dimensions.get('window');


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
// 3. PIXEL QUEST (plataformas de 30 mundos)
// ==========================================
const PQ_GRAVITY = 1.2;
const PQ_JUMP = -18;
const PQ_SPEED = 7;
const PQ_PLAYER_SIZE = 30;

function pqBuildLevel(lvl, AH) {
  // GY = top of the ground floor. All "y" for objects = GY - objectHeight (so feet land on GY).
  const GY = AH - 60; // ground Y (top surface)
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

  return ld;
}

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

function PixelQuest({ onExit }) {
  const AREA_H = AREA_HF;
  const PS = PQ_PLAYER_SIZE;
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('pixelquest');
  const [phase, setPhase] = useState('ready');        // ready | play | over | win
  const [res, setRes] = useState({ isNew: false });
  const [maxLevel, setMaxLevel] = useState(1);
  const [select, setSelect] = useState(false);
  const [, force] = useReducer(x => x + 1, 0);
  const input = useRef({ left: false, right: false }).current;
  const g = useRef(null);

  const buildLevel = lvl => {
    const ld = pqBuildLevel(lvl, AREA_H);
    const GY = AREA_H - 60;
    ld.coins = [];
    ld.platforms.forEach(pl => { if (pl.y < GY - 5) { const n = Math.min(4, Math.floor(pl.w / 42)); for (let i = 0; i < n; i++) ld.coins.push({ id: uid(), x: pl.x + (pl.w - n * 36) / 2 + i * 36 + 9, y: pl.y - 30, w: 18, h: 18, got: false }); } });
    return ld;
  };
  const newPlayer = () => ({ x: 50, y: 100, vx: 0, vy: 0, w: PS, h: PS, face: 1, ground: false, jumped: false });
  const initState = (lvl, lives, score) => ({ level: lvl, lives, score, p: newPlayer(), cam: 0, world: buildLevel(lvl), proj: [], inv: 0, gun: false, dj: 0, acc: 0, t: 0, safeX: 50, banner: { text: `MUNDO ${lvl}`, t: 1.6 }, coins: 0, stomps: 0, done: false, shake: 0, toast: null });
  if (!g.current) g.current = initState(1, 3, 0);
  useEffect(() => { AsyncStorage.getItem('pixelQuestMaxLevel').then(v => { if (v) setMaxLevel(parseInt(v, 10) || 1); }).catch(() => {}); }, []);
  const unlock = lvl => { setMaxLevel(m => { if (lvl > m) { AsyncStorage.setItem('pixelQuestMaxLevel', String(lvl)).catch(() => {}); return lvl; } return m; }); };
  const save = () => { const s = g.current; AsyncStorage.setItem('pixelQuestSave', JSON.stringify({ level: s.level, lives: s.lives, score: s.score })).catch(() => {}); };
  const loadLevel = (lvl, lives, score) => {
    fx.clear(); const bonusLife = ((lvl >= 11 && lvl <= 13) || (lvl >= 21 && lvl <= 23) || lvl === 26) ? 1 : 0;
    g.current = initState(lvl, Math.min(9, lives + bonusLife), score); input.left = false; input.right = false; unlock(lvl); setPhase('play'); setSelect(false);
  };
  const start = () => loadLevel(1, 3, 0);
  const cont = () => { AsyncStorage.getItem('pixelQuestSave').then(v => { if (v) { try { const d = JSON.parse(v); loadLevel(d.level, d.lives, d.score || 0); return; } catch (e) {} } loadLevel(maxLevel, 3, 0); }).catch(() => loadLevel(maxLevel, 3, 0)); };

  const handleDeath = s => {
    const p = s.p;
    fx.burst(p.x - s.cam + 15, Math.min(p.y, AREA_H - 20), C.red, 20, 260, 0.7, 5); fx.shake(9, 0.3); fx.flash(C.red, 0.3); hx.bad();
    if (s.lives > 1) { s.lives -= 1; p.x = Math.max(0, s.safeX - 40); p.y = 0; p.vy = 0; p.vx = 0; s.inv = 2.5; }
    else { s.lives = 0; hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  };
  const stepFrame = s => {
    const p = s.p; const w = s.world; s.t += 1 / 60;
    if (input.left) { p.vx = -PQ_SPEED; p.face = -1; } else if (input.right) { p.vx = PQ_SPEED; p.face = 1; } else p.vx = 0;
    p.x += p.vx; if (p.x < 0) p.x = 0;
    for (const pl of w.platforms) if (p.x < pl.x + pl.w && p.x + p.w > pl.x && p.y < pl.y + pl.h && p.y + p.h > pl.y) { if (p.vx > 0) p.x = pl.x - p.w; else if (p.vx < 0) p.x = pl.x + pl.w; }
    p.vy += PQ_GRAVITY; p.y += p.vy; p.ground = false;
    for (const pl of w.platforms) if (p.x < pl.x + pl.w && p.x + p.w > pl.x && p.y < pl.y + pl.h && p.y + p.h > pl.y) { if (p.vy > 0) { p.y = pl.y - p.h; p.vy = 0; p.ground = true; if (pl.h > 30 || pl.y > AREA_H - 70) s.safeX = p.x; } else if (p.vy < 0) { p.y = pl.y + pl.h; p.vy = 0; } }
    if (p.y > AREA_H + 20) { handleDeath(s); return; }
    if (s.inv > 0) s.inv -= 1 / 60;
    for (const e of w.enemies) {
      if (!e.active) continue;
      e.x += e.vx; if (e.x > e.startX + e.range || e.x < e.startX) e.vx *= -1;
      if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
        if (s.inv > 0 || (p.vy > 2 && p.y + p.h - e.y < 20)) {
          e.active = false; const stomp = s.inv <= 0; if (stomp) { p.vy = -12; s.stomps += 1; } s.score += stomp ? 50 : 30;
          fx.burst(e.x - s.cam + 15, e.y + 15, C.amber, 12, 220); fx.pop(e.x - s.cam + 15, e.y - 6, `+${stomp ? 50 : 30}`, C.text, 15); hx.hit();
        } else { handleDeath(s); return; }
      }
    }
    for (const c of w.coins) if (!c.got && p.x < c.x + c.w && p.x + p.w > c.x && p.y < c.y + c.h && p.y + p.h > c.y) { c.got = true; s.score += 10; s.coins += 1; fx.burst(c.x - s.cam + 9, c.y + 9, C.amber, 6, 130, 0.3, 3); hx.tick(); }
    for (const pu of w.powerups) {
      if (!pu.active) continue;
      if (p.x < pu.x + pu.w && p.x + p.w > pu.x && p.y < pu.y + pu.h && p.y + p.h > pu.y) {
        pu.active = false; s.score += 25; hx.good(); fx.ring(pu.x - s.cam + 12, pu.y + 12, C.lime, 50);
        if (pu.type === 'life') { s.lives = Math.min(9, s.lives + 1); fx.pop(pu.x - s.cam, pu.y - 8, '+1 VIDA', C.red, 15); }
        else if (pu.type === 'doublejump') { s.dj = Math.min(6, s.dj + 3); fx.pop(pu.x - s.cam, pu.y - 8, '¡DOBLE SALTO!', C.cyan, 14); }
        else { s.inv = 5; s.gun = true; fx.pop(pu.x - s.cam, pu.y - 8, '¡ESTRELLA!', C.amber, 15); }
      }
    }
    for (const blk of (w.blocks || [])) {
      if (!blk.active) continue;
      if (p.x < blk.x + blk.w && p.x + p.w > blk.x && p.y < blk.y + blk.h && p.y + p.h > blk.y) {
        if (p.vy < 0 && !blk.hit) { blk.hit = true; p.y = blk.y + blk.h; p.vy = 0; w.powerups.push({ x: blk.x + blk.w / 2 - 12, y: blk.y - 30, w: 25, h: 25, active: true, type: blk.type }); hx.heavy(); fx.burst(blk.x - s.cam + 17, blk.y, C.amber, 8, 160, 0.4, 4); }
        else if (p.vy > 0) { p.y = blk.y - p.h; p.vy = 0; p.ground = true; }
        else if (p.vy < 0 && blk.hit) { p.y = blk.y + blk.h; p.vy = 0; }
      }
    }
    for (const pr of s.proj) {
      if (!pr.active) continue; pr.x += pr.vx;
      if (Math.abs(pr.x - p.x) > AREA_W) { pr.active = false; continue; }
      for (const e of w.enemies) if (e.active && pr.x < e.x + e.w && pr.x + pr.w > e.x && pr.y < e.y + e.h && pr.y + pr.h > e.y) { e.active = false; pr.active = false; s.score += 30; fx.burst(e.x - s.cam + 15, e.y + 15, C.orange, 10, 200); hx.hit(); break; }
    }
    s.proj = s.proj.filter(q => q.active);
    if (w.goal && !s.done && p.x < w.goal.x + w.goal.w && p.x + p.w > w.goal.x && p.y < w.goal.y + w.goal.h && p.y + p.h > w.goal.y) {
      s.done = true; hx.win(); fx.flash('#fff', 0.35); const bonus = 100 + s.level * 10; s.score += bonus;
      fx.pop(AREA_W / 2, AREA_H * 0.35, `¡MUNDO ${s.level} COMPLETO! +${bonus}`, C.lime, 22); submitBest(s.score);
      if (s.level >= 30) { later(() => { setRes({ isNew: submitBest(s.score) }); setPhase('win'); }, 900); }
      else later(() => { save(); loadLevel(s.level + 1, s.lives, s.score); const ns = g.current; save(); }, 1100);
    }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current; s.acc += dt; let n = 0;
    while (s.acc >= 1 / 60 && n < 4) { s.acc -= 1 / 60; n += 1; if (!s.done) stepFrame(s); if (phase !== 'play') break; }
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    s.cam += (Math.max(0, s.p.x - AREA_W / 3) - s.cam) * Math.min(1, dt * 10);
  });
  const jumpPress = () => {
    const s = g.current; const p = s.p; if (phase !== 'play') return;
    if (p.ground) { p.vy = PQ_JUMP; p.ground = false; hx.tap(); fx.burst(p.x - s.cam + 15, p.y + p.h, '#fff', 4, 80, 0.3, 3); }
    else if (s.dj > 0) { s.dj -= 1; p.vy = PQ_JUMP; hx.hit(); fx.ring(p.x - s.cam + 15, p.y + p.h, C.cyan, 34); }
  };
  const jumpRelease = () => { const p = g.current.p; if (p.vy < -7) p.vy *= 0.55; };
  const shoot = () => { const s = g.current; const p = s.p; if (phase !== 'play' || !s.gun) return; s.proj.push({ x: p.face > 0 ? p.x + p.w : p.x - 10, y: p.y + p.h / 2 - 5, vx: 10 * p.face, w: 10, h: 10, active: true }); hx.hit(); };

  const s = g.current; const p = s.p; const TH = PQ_THEMES[(s.level - 1) % PQ_THEMES.length]; const cam = s.cam;
  const vis = (x, w) => x + w > cam - 60 && x < cam + AREA_W + 60;
  const GY = AREA_H - 60;
  return (
    <GameScreen title={`MUNDO ${s.level}/30`} emoji="🍄" accent={C.lime} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={Math.max(3, s.lives)} /><Text style={{ color: C.dim, fontSize: 11 }}>{s.dj > 0 ? `🦅×${s.dj}  ` : ''}{s.gun ? '🔥 ' : ''}{s.inv > 0 ? `⭐${Math.ceil(s.inv)}s` : ''}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}><Btn label="🗺" small ghost color={C.violet} onPress={() => setSelect(true)} /><Btn label="💾" small ghost color={C.cyan} onPress={() => { save(); s.toast = { m: '💾 Partida guardada', t: 1.5 }; hx.good(); force(); }} /></View></>}
      footer={<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 6 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <NwBtn id="pq-left" label="◀" color={C.lime} on={() => { input.left = true; }} off={() => { input.left = false; }} />
          <NwBtn id="pq-right" label="▶" color={C.lime} on={() => { input.right = true; }} off={() => { input.right = false; }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {s.gun && <NwBtn id="pq-shoot" label="🔥" color={C.orange} on={shoot} off={() => {}} />}
          <NwBtn id="pq-jump" label="🅰" color={C.cyan} on={jumpPress} off={jumpRelease} big />
        </View>
      </View>}>
      <PlayArea fx={fx} h={AREA_H} bg={TH.sky} border={alpha(C.lime, 0.4)}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: AREA_H * 0.6, backgroundColor: TH.sky }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: AREA_H * 0.45, bottom: 0, backgroundColor: TH.sky2, opacity: 0.55 }} />
        {Array.from({ length: 5 }, (_, i) => <Text key={`c${i}`} style={{ position: 'absolute', left: ((i * 170 - cam * 0.25 + s.t * 6) % (AREA_W + 170) + AREA_W + 170) % (AREA_W + 170) - 80, top: 30 + (i % 3) * 46, fontSize: 40, opacity: 0.8 }}>☁️</Text>)}
        {Array.from({ length: 4 }, (_, i) => <View key={`h${i}`} pointerEvents="none" style={{ position: 'absolute', left: ((i * 230 - cam * 0.5) % (AREA_W + 230) + AREA_W + 230) % (AREA_W + 230) - 120, top: GY - 70 - (i % 2) * 24, width: 200, height: 140, borderRadius: 100, backgroundColor: TH.top, opacity: 0.35 }} />)}
        <View style={{ position: 'absolute', left: -cam, top: 0, width: s.world.length + 600, height: AREA_H }}>
          {s.world.platforms.filter(pl => vis(pl.x, pl.w)).map((pl, i) => pl.h > 30 ? (
            <View key={`p${i}`} style={{ position: 'absolute', left: pl.x, top: pl.y, width: pl.w, height: pl.h, backgroundColor: TH.ground, borderTopWidth: 8, borderTopColor: TH.top }} />
          ) : (
            <View key={`p${i}`} style={{ position: 'absolute', left: pl.x, top: pl.y, width: pl.w, height: pl.h, backgroundColor: TH.plat, borderRadius: 4, borderTopWidth: 5, borderTopColor: TH.ptop, borderWidth: 1, borderColor: 'rgba(0,0,0,0.25)' }} />
          ))}
          {s.world.coins.filter(c => !c.got && vis(c.x, 18)).map(c => <Text key={c.id} style={{ position: 'absolute', width: 34, lineHeight: 28, left: c.x - 2, top: c.y - 4, fontSize: 20 }}>🪙</Text>)}
          {s.world.blocks.filter(b => vis(b.x, 35)).map((b, i) => <Text key={`b${i}`} style={{ position: 'absolute', width: 42, lineHeight: 36, left: b.x, top: b.y - 5, fontSize: 28 }}>{b.hit ? '📦' : '❓'}</Text>)}
          {s.world.powerups.filter(u => u.active && vis(u.x, 25)).map((u, i) => <Text key={`u${i}`} style={{ position: 'absolute', width: 39, lineHeight: 33, left: u.x, top: u.y - 5 + Math.sin(s.t * 4 + i) * 3, fontSize: 25, ...tglow(C.amber, 8) }}>{u.type === 'life' ? '❤️' : u.type === 'doublejump' ? '🦅' : '⭐'}</Text>)}
          {s.world.enemies.filter(e => e.active && vis(e.x, 30)).map((e, i) => <Text key={`e${i}`} style={{ position: 'absolute', width: 44, lineHeight: 38, left: e.x, top: e.y - 5 + Math.abs(Math.sin(s.t * 6 + i)) * -3, fontSize: 30 }}>👾</Text>)}
          {s.world.goal && (
            <View style={{ position: 'absolute', left: s.world.goal.x, top: s.world.goal.y, width: s.world.goal.w, height: s.world.goal.h, alignItems: 'center' }}>
              <View style={{ width: 6, flex: 1, backgroundColor: '#ddd', borderRadius: 3 }} />
              <Text style={{ position: 'absolute', top: -4, left: 8, fontSize: 36 }}>🏁</Text>
              <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: 10, borderWidth: 3, borderColor: alpha(C.lime, 0.8), backgroundColor: alpha(C.lime, 0.12), ...glow(C.lime, 12, 0.7) }} />
            </View>
          )}
          {s.proj.map((q, i) => <View key={`q${i}`} style={{ position: 'absolute', left: q.x, top: q.y, width: q.w, height: q.h, backgroundColor: C.orange, borderRadius: 5, ...glow(C.orange, 8, 1) }} />)}
          <Text style={{ position: 'absolute', width: 46, lineHeight: 40, left: p.x - 2, top: p.y - 6, fontSize: 32, opacity: s.inv > 0 && Math.floor(s.inv * 10) % 2 ? 0.45 : 1, transform: [{ scaleX: p.face }], ...tglow(s.inv > 0 ? C.amber : '#000', s.inv > 0 ? 12 : 3) }}>{s.gun ? '🤠' : '😎'}</Text>
        </View>
        {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.2, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow('#000', 8) }}>{s.banner.text}</Text>}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: 12, width: AREA_W, textAlign: 'center', color: '#fff', fontWeight: '900', ...tglow('#000', 5) }}>{s.toast.m}</Text>}
        {select && (
          <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,4,12,0.95)', zIndex: 60, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <Text style={{ color: C.lime, fontSize: 20, fontWeight: '900', letterSpacing: 2 }}>🗺 ELEGIR MUNDO</Text>
            <Text style={{ color: C.dim, fontSize: 12, marginVertical: 8 }}>Desbloqueados: 1 – {maxLevel}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', width: Math.min(AREA_W - 32, 330) }}>
              {Array.from({ length: 30 }, (_, i) => i + 1).map(w => { const ok = w <= maxLevel; return (
                <Pressable key={w} testID={`world-${w}`} disabled={!ok} onPress={() => { hx.tap(); loadLevel(w, 3, 0); }} style={{ opacity: ok ? 1 : 0.35 }}>
                  <View style={{ width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: w === s.level ? alpha(C.lime, 0.3) : alpha(C.cyan, 0.1), borderWidth: 2, borderColor: w === s.level ? C.lime : alpha(C.cyan, 0.5) }}>
                    <Text style={{ color: C.text, fontWeight: '900' }}>{ok ? w : '🔒'}</Text>
                  </View>
                </Pressable>); })}
            </View>
            <View style={{ marginTop: 16 }}><Btn label="CERRAR" small ghost color={C.dim} onPress={() => setSelect(false)} /></View>
          </View>
        )}
        <Overlay show={phase !== 'play' && !select} kind={phase} emoji={phase === 'win' ? '🏆' : phase === 'over' ? '💀' : '🍄'} title={phase === 'win' ? '¡30 MUNDOS CONQUISTADOS!' : phase === 'over' ? 'GAME OVER' : 'PIXEL QUEST'}
          subtitle={phase === 'win' ? `Puntuación final ${s.score}` : phase === 'over' ? `Caíste en el mundo ${s.level}` : 'Un plataformas de 30 mundos'}
          score={s.score} best={best} isNew={res.isNew} accent={C.lime} startLabel={phase === 'ready' ? 'JUGAR' : 'OTRA VEZ'} onStart={start} onExit={onExit}
          extra={phase === 'ready' && maxLevel > 1 ? <View style={{ marginTop: 12, flexDirection: 'row', gap: 10 }}><Btn label={`CONTINUAR`} small ghost color={C.lime} onPress={cont} /><Btn label="🗺 MUNDOS" small ghost color={C.violet} onPress={() => setSelect(true)} /></View> : null}
          lines={phase === 'ready' ? ['◀ ▶ mover · 🅰 saltar (mantén para saltar más alto)', 'Salta sobre los enemigos para aplastarlos', '❓ golpea desde abajo · ⭐ invencible + disparo · 🦅 doble salto', 'Llega a la bandera 🏁 de cada mundo'] : null} />
      </PlayArea>
    </GameScreen>
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
  const sprites = [
    ...s.bricks.map(k => ({ x: k.x, y: k.y, w: BW, h: BH, d: 10 + (k.hp / k.max) * 12, s: 'b', c: `hsl(${k.hue},90%,${40 + (k.hp / k.max) * 18}%)`, e: 0.12 })),
    ...s.items.map(it => ({ x: it.x - 13, y: it.y - 13, w: 26, h: 26, d: 26, s: 'o', c: ITEMC[it.k][0], e: 0.5 })),
    { x: s.px - s.pw / 2, y: PY, w: s.pw, h: 12, d: 10, s: 'b', c: s.wide > 0 ? C.cyan : '#ffffff', e: 0.4 },
    ...s.balls.map(b => ({ x: b.x - BR, y: b.y - BR, w: BR * 2, h: BR * 2, d: BR * 2, s: 'o', c: s.fire > 0 ? C.orange : '#ffffff', e: 0.6 })),
  ];
  return (
    <GameScreen title="BREAKOUT" emoji="🧱" accent={C.orange} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={Math.max(3, s.lives)} /><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.orange, fontWeight: '800' }}>{s.level}</Text></Text><View style={{ minWidth: 60, alignItems: 'flex-end' }}>{s.combo > 1 ? <Combo n={s.combo} color={C.orange} /> : <Text style={{ color: C.cyan, fontSize: 12, fontWeight: '800' }}>{s.fire > 0 ? '🔥' : ''}{s.wide > 0 ? '↔' : ''}</Text>}</View></>}>
      <PlayArea fx={fx} bg="#0b0604" {...pan}>
        <Arena3D bg="#0b0604" shake={fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) : 0} sprites={sprites} />
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

function VoidCrawler({ onExit }) {
  const CELL = Math.floor(AREA_W / 9);
  const VW = 9, VH = Math.floor((AREA_H - 196) / CELL);
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
    return { p, floor: 1, ...lvl, kills: 0, turn: 0, log: ['Los pasillos del vacío te esperan…'], t: 0, fl: { vis: new Set() }, alive: true };
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
  const px = (s, x, y) => ({ x: (x - clamp(s.p.vx - (VW - 1) / 2, 0, VC2_W - VW)) * CELL + CELL / 2 + (AREA_W - VW * CELL) / 2, y: (y - clamp(s.p.vy - (VH - 1) / 2, 0, VC2_H - VH)) * CELL + CELL / 2 });
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
  useLoop(phase === 'play', dt => { const s = g.current; s.t += dt; s.p.vx += (s.p.x - s.p.vx) * Math.min(1, dt * 16); s.p.vy += (s.p.y - s.p.vy) * Math.min(1, dt * 16); });
  const pan = usePan(fx, { down: () => { g.current.used = false; }, move: (x, y, gs) => { const s = g.current; if (s.used) return; if (Math.abs(gs.dx) > 24 || Math.abs(gs.dy) > 24) { s.used = true; if (Math.abs(gs.dx) > Math.abs(gs.dy)) act(gs.dx > 0 ? 1 : -1, 0); else act(0, gs.dy > 0 ? 1 : -1); } } });
  const startHold = (dx, dy) => { act(dx, dy); clearInterval(holdRef.current); holdRef.current = setInterval(() => act(dx, dy), 190); };
  const stopHold = () => { clearInterval(holdRef.current); holdRef.current = null; };
  useEffect(() => () => clearInterval(holdRef.current), []);

  const s = g.current; const p = s.p; const th = VC2_THEMES[s.floor - 1];
  const camX = clamp(p.vx - (VW - 1) / 2, 0, VC2_W - VW), camY = clamp(p.vy - (VH - 1) / 2, 0, VC2_H - VH);
  const ix = Math.floor(camX), iy = Math.floor(camY);
  const OX = (AREA_W - VW * CELL) / 2;
  const cells = [];
  for (let j = 0; j <= VH; j++) for (let i = 0; i <= VW; i++) {
    const x = ix + i, y = iy + j;
    if (x < 0 || y < 0 || x >= VC2_W || y >= VC2_H) continue;
    const seen = s.seen[y][x]; if (!seen) continue;
    const vis = s.fl.vis.has(`${x},${y}`);
    const isWall = s.map[y][x] === 0;
    const left = OX + (x - camX) * CELL, top = (y - camY) * CELL;
    const en = vis ? s.enemies.find(o => o.x === x && o.y === y) : null;
    const it = vis ? s.items.find(o => o.x === x && o.y === y) : null;
    const warn = s.enemies.some(o => o.warn && o.warn.some(([wx, wy]) => wx === x && wy === y)) && !isWall;
    cells.push(
      <View key={`${x},${y}`} style={{ position: 'absolute', left, top, width: CELL, height: CELL, backgroundColor: isWall ? th.wall : ((x + y) % 2 ? th.floor : th.floor + 'ee'), borderTopWidth: isWall ? 3 : 0, borderTopColor: isWall ? alpha(th.accent, 0.35) : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {warn && <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: alpha(C.red, 0.35 + Math.sin(s.t * 12) * 0.15) }} />}
        {!isWall && s.stairs.x === x && s.stairs.y === y && <Text style={{ fontSize: CELL * 0.6 }}>🚪</Text>}
        {it && <Text style={{ fontSize: CELL * 0.55 }}>{it.kind === 'potion' ? '🧪' : it.kind === 'chest' ? '📦' : it.kind === 'gold' ? '💰' : it.kind === 'bomb' ? '💣' : it.kind === 'shrine' ? '⛲' : (Math.abs(x - p.x) + Math.abs(y - p.y) <= 2 ? '⚠️' : '')}</Text>}
        {en && <Text style={{ fontSize: CELL * (en.boss ? 0.85 : en.small ? 0.5 : 0.62), ...tglow(en.warn ? C.red : '#000', en.warn ? 14 : 3) }}>{en.e}</Text>}
        {en && en.hp < en.maxHp && <View style={{ position: 'absolute', bottom: 2, left: 4, right: 4 }}><Bar value={en.hp} max={en.maxHp} color={C.red} h={4} /></View>}
        {!vis && <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.62)' }} />}
      </View>
    );
  }
  const dpad = (label, dx, dy, st) => (
    <Pressable testID={`vd-${label}`} onPressIn={() => startHold(dx, dy)} onPressOut={stopHold} style={[{ width: 54, height: 54, borderRadius: 16, backgroundColor: alpha(th.accent, 0.15), borderWidth: 2, borderColor: alpha(th.accent, 0.7), alignItems: 'center', justifyContent: 'center' }, st]}>
      <Text style={{ color: th.accent, fontSize: 22, fontWeight: '900' }}>{label}</Text>
    </Pressable>
  );
  const sc = s.floor * 100 + s.kills * 10 + p.gold;
  return (
    <GameScreen title="VOID CRAWLER" emoji="☠️" accent={th.accent} onExit={onExit} score={sc} best={best}
      hud={<><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={{ color: C.red, fontSize: 10, fontWeight: '900' }}>HP</Text><Bar value={p.hp} max={p.maxHp} color={p.hp / p.maxHp > 0.4 ? C.lime : C.red} h={8} w={96} /><Text style={{ color: C.dim, fontSize: 10 }}>{p.hp}/{p.maxHp}</Text></View><Text style={{ color: C.dim, fontSize: 11 }}>Piso <Text style={{ color: th.accent, fontWeight: '900' }}>{s.floor}/5</Text> · Nv.{p.lv}</Text></>}>
      <PlayArea fx={fx} bg="#000" border={alpha(th.accent, 0.4)} {...pan}>
        <View style={{ position: 'absolute', left: 0, top: 0, width: AREA_W, height: VH * CELL, overflow: 'hidden' }}>{cells}
          <View style={{ position: 'absolute', left: OX + (p.vx - camX) * CELL, top: (p.vy - camY) * CELL, width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: CELL * 0.66, ...tglow(th.accent, 10) }}>🥷</Text></View>
        </View>
        <View style={{ position: 'absolute', left: 10, right: 10, top: VH * CELL + 4 }}>
          {s.log.map((m, i) => <Text key={i} numberOfLines={1} style={{ color: i === 0 ? C.text : alpha(C.dim, 0.7), fontSize: 11, lineHeight: 15 }}>{m}</Text>)}
        </View>
        <View style={{ position: 'absolute', left: 12, bottom: 12, gap: 8 }}>
          <Text style={{ color: C.dim, fontSize: 11 }}>⚔️ {p.atk + VC2_WEAPONS[p.weapon][1]} ({VC2_WEAPONS[p.weapon][0]})  🛡️ {p.def}</Text>
          <Text style={{ color: C.dim, fontSize: 11 }}>XP {p.xp}/{need(p.lv)}  💰 {p.gold}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn label={`🧪 ${p.potions}`} small ghost color={C.lime} onPress={usePotion} />
            <Btn label={`💣 ${p.bombs}`} small ghost color={C.orange} onPress={useBomb} />
          </View>
          <Btn label="⏳ ESPERAR" small ghost color={C.dim} onPress={() => { if (phase === 'play') afterPlayer(g.current); }} />
        </View>
        <View style={{ position: 'absolute', right: 12, bottom: 10, width: 54 * 3 + 12, height: 54 * 3 + 6 }}>
          {dpad('▲', 0, -1, { position: 'absolute', left: 60, top: 0 })}
          {dpad('◀', -1, 0, { position: 'absolute', left: 0, top: 57 })}
          {dpad('▶', 1, 0, { position: 'absolute', left: 120, top: 57 })}
          {dpad('▼', 0, 1, { position: 'absolute', left: 60, top: 114 })}
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'win' ? '🏆' : phase === 'over' ? '💀' : '☠️'} title={phase === 'win' ? '¡VACÍO CONQUISTADO!' : phase === 'over' ? 'HAS MUERTO' : 'VOID CRAWLER'}
          subtitle={phase === 'win' ? `Derrotaste al dragón · Nv.${p.lv}` : phase === 'over' ? `Caíste en el piso ${s.floor} ante ${res.by || '…'} · ${s.kills} enemigos` : '5 pisos de oscuridad procedural'}
          score={sc + (phase === 'win' ? 500 : 0)} best={best} isNew={res.isNew} accent={th.accent} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Desliza o usa la cruz: mover y atacar al chocar', 'Solo ves lo que alcanza tu luz: explora con cuidado', '🏹 dispara en línea · 🔮 hechizos · ⚠️ trampas · 🐉 jefe final', '🧪 curas · 💣 daña alrededor · 📦 equipo'] : null} />
      </PlayArea>
    </GameScreen>
  );
}


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

function MdBtn({ label, sub, color, onPress, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ width: '48.5%', opacity: disabled ? 0.35 : 1 }}>
      <View style={{ paddingVertical: 9, borderRadius: 14, backgroundColor: alpha(color, 0.16), borderWidth: 2, borderColor: alpha(color, 0.85), alignItems: 'center' }}>
        <Text style={{ color: C.text, fontWeight: '900', fontSize: 13 }}>{label}</Text>{sub ? <Text style={{ color: C.dim, fontSize: 10 }}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

function MonsterDuel({ onExit }) {
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('monster');
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
  const initState = () => ({ team: [], active: 0, balls: 6, potions: 3, wins: 0, badges: 0, caught: [], box: 0, battle: null, log: ['¡Bienvenido al mundo de los Monstruos!'], menu: 'main', bt: 0, busy: false, trainerIdx: 0, steps: 0, nextTrainerAt: 4 });
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
  const load = () => { const d = g.current.save; if (!d) return; const s = initState(); Object.assign(s, d); s.log = ['Partida cargada.']; g.current = s; setScene('explore'); };

  const beginBattle = trainer => {
    const s = g.current; const lead = Math.max(...s.team.map(m => m.lv));
    let foes;
    if (trainer) { const n = 2 + Math.min(1, s.badges); foes = Array.from({ length: n }, () => mkMon(randInt(0, MD_MONSTERS.length - 1), lead + randInt(0, 2) + s.badges)); }
    else foes = [mkMon(randInt(0, MD_MONSTERS.length - 1), Math.max(3, lead + randInt(-2, 2)))];
    s.battle = { foes, fi: 0, trainer, name: trainer ? MD_TRAINERS[s.trainerIdx % MD_TRAINERS.length] : null, t: 0, hit: 0, ahit: 0 };
    s.team.forEach(m => { m.st = { atk: 0, def: 0 }; });
    s.menu = 'main'; s.busy = false;
    addLog(trainer ? `¡${s.battle.name} te desafía!` : `¡Un ${foes[0].name} salvaje apareció!`);
    fx.flash('#fff', 0.5); hx.warn(); setScene('battle');
  };
  const explore = () => {
    const s = g.current; s.steps += 1;
    if (s.wins >= s.nextTrainerAt) { beginBattle(true); return; }
    if (Math.random() < 0.7) beginBattle(false); else { addLog(pick(['Solo hierba y viento…', 'Encuentras una baya y la comes. ¡Yum!', 'Nada por aquí. Sigue explorando.'])); hx.tick(); force(); }
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

  const s = g.current; const b = s.battle; const p = s.team[s.active]; const f = b ? foe() : null;
  const tag = m => <Text style={{ color: MD_TC[m.type], fontSize: 10, fontWeight: '900' }}>{m.type.toUpperCase()}</Text>;
  const hpColor = (h, m) => (h > m * 0.5 ? C.lime : h > m * 0.2 ? C.amber : C.red);
  return (
    <GameScreen title="MONSTER DUEL" emoji="⚡" accent={C.amber} onExit={onExit} score={scoreOf(s)} best={best}
      hud={scene === 'explore' || scene === 'battle' ? <><Text style={{ color: C.dim, fontSize: 12 }}>🏅 {s.badges}/5 · 👾 {s.caught.length}/{MD_MONSTERS.length}</Text><Text style={{ color: C.dim, fontSize: 12 }}>🔴 {s.balls}  🧪 {s.potions}</Text></> : null}>
      <PlayArea fx={fx} bg={scene === 'battle' ? '#0a1220' : '#07140a'} border={alpha(C.amber, 0.4)}>
        {scene === 'explore' && p && (
          <View style={{ flex: 1, padding: 14 }}>
            <Text style={{ color: C.amber, fontWeight: '900', fontSize: 12, letterSpacing: 2, marginBottom: 8 }}>TU EQUIPO ({s.team.length}/4)</Text>
            {s.team.map((m, i) => (
              <Pressable key={i} onPress={() => { s.active = i; hx.tick(); force(); }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 14, marginBottom: 8, backgroundColor: i === s.active ? alpha(MD_TC[m.type], 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 2, borderColor: i === s.active ? MD_TC[m.type] : '#222638' }}>
                  <Text style={{ fontSize: 34, marginRight: 10, opacity: m.hp <= 0 ? 0.35 : 1 }}>{m.e}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>{m.name} <Text style={{ color: C.dim, fontSize: 11 }}>Nv.{m.lv}</Text>  {tag(m)}</Text>
                    <Bar value={m.hp} max={m.maxHp} color={hpColor(m.hp, m.maxHp)} h={7} style={{ marginTop: 4 }} />
                    <Text style={{ color: C.dim, fontSize: 10, marginTop: 2 }}>{m.hp}/{m.maxHp} PS · XP {m.xp}/{m.xpNext}</Text>
                  </View>
                </View>
              </Pressable>
            ))}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, justifyContent: 'space-between' }}>
              <MdBtn label="🌿 EXPLORAR" sub={s.wins >= s.nextTrainerAt ? '¡Hay un líder cerca!' : 'Busca monstruos'} color={C.lime} onPress={explore} />
              <MdBtn label="🛏️ DESCANSAR" sub="Cura todo (riesgo)" color={C.cyan} onPress={rest} />
              <MdBtn label={`🧪 POCIÓN (${s.potions})`} sub="Cura 45% al activo" color={C.red} onPress={usePotion} disabled={s.potions <= 0 || p.hp >= p.maxHp} />
              <MdBtn label="💾 GUARDAR" sub="Progreso" color={C.amber} onPress={() => { save(); addLog('💾 Partida guardada.'); hx.good(); force(); }} />
            </View>
          </View>
        )}
        {scene === 'battle' && b && p && f && (
          <View style={{ flex: 1 }}>
            <View style={{ position: 'absolute', left: 14, top: 12, width: AREA_W * 0.5 }}>
              <Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>{f.name} <Text style={{ color: C.dim, fontSize: 11 }}>Nv.{f.lv}</Text> {tag(f)}</Text>
              <Bar value={f.hp} max={f.maxHp} color={hpColor(f.hp, f.maxHp)} h={9} style={{ marginTop: 4 }} />
              <Text style={{ color: C.dim, fontSize: 10, marginTop: 2 }}>{f.hp}/{f.maxHp}{b.trainer ? `  ·  ${b.name} (${b.fi + 1}/${b.foes.length})` : ''}{f.st.atk < 0 ? ' · ATK↓' : ''}{f.st.def > 0 ? ' · DEF↑' : ''}</Text>
            </View>
            <Text style={{ position: 'absolute', right: AREA_W * 0.1, top: 38, fontSize: 82, transform: [{ translateY: Math.sin(b.t * 3) * 5 }, { translateX: b.hit > 0 ? (Math.random() - 0.5) * 18 : 0 }], opacity: f.hp <= 0 ? 0.2 : b.hit > 0 ? 0.55 : 1 }}>{f.e}</Text>
            <Text style={{ position: 'absolute', left: AREA_W * 0.08, top: 150, fontSize: 82, transform: [{ scaleX: -1 }, { translateY: Math.cos(b.t * 3) * 4 }, { translateX: b.ahit > 0 ? (Math.random() - 0.5) * 18 : 0 }], opacity: b.ahit > 0 ? 0.55 : 1 }}>{p.e}</Text>
            <View style={{ position: 'absolute', right: 14, top: 214, width: AREA_W * 0.5 }}>
              <Text style={{ color: C.text, fontWeight: '900', fontSize: 14, textAlign: 'right' }}>{p.name} <Text style={{ color: C.dim, fontSize: 11 }}>Nv.{p.lv}</Text> {tag(p)}</Text>
              <Bar value={p.hp} max={p.maxHp} color={hpColor(p.hp, p.maxHp)} h={9} style={{ marginTop: 4 }} />
              <Text style={{ color: C.dim, fontSize: 10, marginTop: 2, textAlign: 'right' }}>{p.hp}/{p.maxHp}{p.st.atk < 0 ? ' · ATK↓' : ''}{p.st.def > 0 ? ' · DEF↑' : ''}</Text>
            </View>
            <View style={{ position: 'absolute', left: 12, right: 12, top: 266, padding: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: alpha(C.amber, 0.25), minHeight: 74 }}>
              {s.log.slice(0, 3).map((m, i) => <Text key={i} style={{ color: i === 0 ? C.text : alpha(C.dim, 0.7), fontSize: 12, lineHeight: 17 }}>{m}</Text>)}
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
        {scene === 'explore' && <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12, padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.4)' }}>{s.log.slice(0, 3).map((m, i) => <Text key={i} style={{ color: i === 0 ? C.text : alpha(C.dim, 0.7), fontSize: 12 }}>{m}</Text>)}</View>}
        <Overlay show={scene === 'starter'} kind="start" emoji="⚡" title="MONSTER DUEL" subtitle="Elige a tu compañero inicial" accent={C.amber} noStart onStart={() => {}} extra={
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
        } lines={['Captura monstruos, evoluciónalos y vence a 5 líderes']} />
        <Overlay show={scene === 'over'} kind="over" emoji="💀" title="TODOS CAÍDOS" subtitle={`🏅 ${s.badges} medallas · 👾 ${s.caught.length} capturados`} score={scoreOf(s)} best={best} accent={C.red} onStart={() => { g.current = initState(); setScene('starter'); }} startLabel="NUEVA AVENTURA" onExit={onExit} />
        <Overlay show={scene === 'win'} kind="win" emoji="🏆" title="¡CAMPEÓN!" subtitle={`Derrotaste a los 5 líderes · ${s.caught.length} monstruos capturados`} score={scoreOf(s)} best={best} isNew accent={C.amber} onStart={() => { g.current = initState(); setScene('starter'); }} startLabel="NUEVA AVENTURA" onExit={onExit} />
      </PlayArea>
    </GameScreen>
  );
}


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

// ─── NEON WARRIOR ─────────────────────────────────────────────────
const NW_THEMES = [
  { bg: '#05051a', a: C.pink, b: C.cyan, name: 'CIUDAD NEÓN' }, { bg: '#04140f', a: C.lime, b: C.cyan, name: 'BOSQUE DIGITAL' },
  { bg: '#180606', a: C.orange, b: C.amber, name: 'FÁBRICA ARDIENTE' }, { bg: '#100618', a: C.violet, b: C.pink, name: 'NÚCLEO CUÁNTICO' },
];
function NwBtn({ label, color, id, on, off, big, size }) {
  const d = (size || 66) + (big ? 8 : 0);
  return (
    <TouchBtn testID={id} onDown={on} onUp={off} style={{ width: d, height: d, borderRadius: 40, backgroundColor: alpha(color, 0.14), borderWidth: 2, borderColor: alpha(color, 0.7), alignItems: 'center', justifyContent: 'center', ...glow(color, 8, 0.4) }}>
      <Text style={{ color, fontSize: 26, fontWeight: '900' }}>{label}</Text>
    </TouchBtn>
  );
}

function NeonWarrior({ onExit }) {
  const AREA_H = AREA_HF;
  const GY = AREA_H - 64, PW = 28, PH = 38;
  const fx = useFX();
  const [best, submitBest] = useBest('warrior');
  const [phase, setPhase] = useState('ready');          // ready | play | clear | over | win
  const [res, setRes] = useState({ isNew: false });
  const stars = useRef(makeStars(40, AREA_W * 2, AREA_H)).current;
  const input = useRef({ left: false, right: false, jump: false }).current;
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);

  const genLevel = n => {
    const LEN = 2600 + n * 700;
    const gr = [{ x: 0, y: GY, w: 380 }]; const fl = []; const mv = []; const hz = []; const en = []; const co = []; const pu = []; const fg = [];
    let x = 380; let sinceFlag = 0; const gapMax = Math.min(170, 110 + n * 10);
    const flat = (w, ground = true) => { if (ground) gr.push({ x, y: GY, w }); const nE = Math.floor(rand(0, 1 + n * 0.5)); for (let k = 0; k < nE; k++) { const t = Math.random(); const ex = x + rand(60, w - 60); if (t < 0.5) en.push({ id: uid(), t: 'walker', x: ex, y: GY - 30, vx: rand(50, 80) * (Math.random() < 0.5 ? 1 : -1), hp: 1, bx: x + 10, ex: x + w - 10, alive: true }); else if (t < 0.75) en.push({ id: uid(), t: 'hopper', x: ex, y: GY - 30, vx: 0, vy: 0, hp: 1, alive: true, tm: rand(0.5, 1.5) }); else en.push({ id: uid(), t: 'turret', x: ex, y: GY - 34, hp: 2, maxHp: 2, alive: true, tm: rand(0.5, 1.5) }); } for (let k = 0; k < 4; k++) co.push({ id: uid(), x: x + 40 + k * 40, y: GY - 40 - (k === 1 || k === 2 ? 22 : 0), got: false }); x += w; };
    while (x < LEN) {
      const r = Math.random(); const w = rand(240, 400);
      if (r < 0.28) flat(w);
      else if (r < 0.52) { const gap = rand(90, gapMax); if (Math.random() < 0.6) { fl.push({ x: x + gap / 2 - 40, y: GY - rand(90, 140), w: 80 }); co.push({ id: uid(), x: x + gap / 2 - 8, y: GY - 170, got: false }); } x += gap; flat(w); }
      else if (r < 0.66) { gr.push({ x, y: GY, w }); hz.push({ x: x + w / 2 - 40, w: rand(56, 90), y: GY }); for (let k = 0; k < 3; k++) co.push({ id: uid(), x: x + w / 2 - 36 + k * 30, y: GY - 120 + (k === 1 ? -16 : 0), got: false }); x += w; }
      else if (r < 0.8) { gr.push({ x, y: GY, w: w + 60 }); for (let k = 0; k < 4; k++) { fl.push({ x: x + 40 + k * 90, y: GY - 70 - k * 38, w: 70 }); co.push({ id: uid(), x: x + 66 + k * 90, y: GY - 108 - k * 38, got: false }); } x += w + 60; }
      else if (r < 0.9) { const gap = rand(190, 250); mv.push({ id: uid(), x0: x + 30, y: GY - 20, w: 90, amp: gap - 150, spd: rand(0.8, 1.2), ph: 0, cx: x + 30 }); x += gap; flat(w); }
      else { flat(w + 80); if (n > 1) { const t = Math.random() < 0.5 ? 'flyer' : 'flyer'; en.push({ id: uid(), t, x: x - w / 2, y: GY - 130, y0: GY - 130, hp: 1, alive: true, ph: Math.random() * 6, vx: -60 }); } }
      sinceFlag += w; if (sinceFlag > 1200) { fg.push({ x: x - 60, y: GY, on: false }); sinceFlag = 0; }
      if (Math.random() < 0.28) pu.push({ id: uid(), t: pick(['star', 'shield', 'heart', 'bolt']), x: x - w / 2, y: GY - 80 - rand(0, 40), got: false });
    }
    const boss = n % 3 === 0;
    gr.push({ x, y: GY, w: 640 }); const end = x + 540;
    if (boss) en.push({ id: uid(), t: 'boss', x: x + 380, y: GY - 74, w: 70, h: 74, hp: 20 + n * 3, maxHp: 20 + n * 3, alive: true, vx: -90, bx: x + 40, ex: x + 620, tm: 2, jt: 2.2, vy: 0 });
    return { LEN: x + 640, gr, fl, mv, hz, en, co, pu, fg, end, boss };
  };
  const initState = (n, score, lives) => {
    const lv = genLevel(n);
    return { n, lv, score, lives, p: { x: 60, y: GY - PH, vx: 0, vy: 0, jumps: 0, coyote: 0, buf: 0, face: 1, inv: 0, shield: false, star: 0, bolt: 0, cool: 0, ride: null }, cam: 0, bul: [], eb: [], t: 0, time: 0, spawn: { x: 60, y: GY - PH }, coins: 0, kills: 0, over: false, held: false };
  };
  if (!g.current) g.current = initState(1, 0, 3);
  const start = () => { fx.clear(); g.current = initState(1, 0, 3); setPhase('play'); };
  const nextLevel = () => { const s = g.current; if (s.n >= 6) { setPhase('win'); return; } const lives = Math.min(5, s.lives + 1); g.current = initState(s.n + 1, s.score, lives); setPhase('play'); };
  const jumpPress = () => { const s = g.current; input.jump = true; s.p.buf = 0.13; };
  const jumpRelease = () => { input.jump = false; };
  const shoot = () => {
    const s = g.current; const p = s.p; if (phase !== 'play' || p.cool > 0) return;
    s.bul.push({ x: p.face > 0 ? p.x + PW : p.x - 12, y: p.y + PH * 0.4, vx: 520 * p.face }); p.cool = p.bolt > 0 ? 0.14 : 0.3; hx.tap();
  };
  const hurt = (s, push) => {
    const p = s.p; if (p.inv > 0 || p.star > 0) return;
    if (p.shield) { p.shield = false; p.inv = 1; fx.ring(p.x + PW / 2, p.y + PH / 2, C.cyan, 60); hx.warn(); return; }
    s.lives -= 1; p.inv = 1.6; p.vy = -420; p.vx = push * 280; fx.burst(p.x + PW / 2, p.y + PH / 2, C.red, 14, 220); fx.shake(7, 0.25); fx.flash(C.red, 0.25); hx.bad();
    if (s.lives <= 0) { s.over = true; hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  };
  const fall = s => {
    const p = s.p; s.lives -= 1; hx.bad(); fx.shake(8, 0.3); fx.flash(C.red, 0.3);
    if (s.lives <= 0) { s.over = true; hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
    p.x = s.spawn.x; p.y = s.spawn.y - 40; p.vx = 0; p.vy = 0; p.inv = 1.6;
  };
  const kill = (s, e, pts) => { e.alive = false; s.score += pts; s.kills += 1; fx.burst(e.x + 16, e.y + 16, C.amber, 12, 220); fx.pop(e.x + 16, e.y - 6, `+${pts}`, C.text, 15); hx.hit(); };

  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p; const lv = s.lv;
    s.t += dt; s.time += dt; p.inv = Math.max(0, p.inv - dt); p.star = Math.max(0, p.star - dt); p.bolt = Math.max(0, p.bolt - dt); p.cool = Math.max(0, p.cool - dt); p.buf = Math.max(0, p.buf - dt);
    const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const targetV = ax * 235; p.vx += (targetV - p.vx) * Math.min(1, dt * (ax ? 12 : 9)); if (ax) p.face = ax;
    // plataformas móviles
    lv.mv.forEach(m => { const nx = m.x0 + (Math.sin(s.t * m.spd + m.ph) * 0.5 + 0.5) * m.amp; m.dx = nx - m.cx; m.cx = nx; });
    if (p.ride) { p.x += p.ride.dx; }
    const grounded0 = p.coyote > 0;
    p.coyote -= dt;
    if (p.buf > 0 && p.coyote > 0) { p.vy = -770; p.buf = 0; p.coyote = 0; p.jumps = 1; fx.burst(p.x + PW / 2, p.y + PH, '#fff', 5, 100, 0.3, 3); hx.tap(); }
    else if (p.buf > 0 && p.jumps < 2 && !grounded0) { p.vy = -700; p.buf = 0; p.jumps = 2; fx.ring(p.x + PW / 2, p.y + PH, C.cyan, 30); hx.tick(); }
    p.vy += 2200 * dt; if (!input.jump && p.vy < -240) p.vy += 3400 * dt; p.vy = Math.min(p.vy, 1000);
    p.x = clamp(p.x + p.vx * dt, 0, lv.LEN - PW);
    const prevB = p.y + PH; p.y += p.vy * dt; const curB = p.y + PH;
    let landed = false; p.ride = null;
    if (p.vy >= 0) {
      const surfaces = [...lv.gr, ...lv.fl.map(f => ({ ...f })), ...lv.mv.map(m => ({ x: m.cx, y: m.y, w: m.w, m }))];
      for (const sf of surfaces) { if (p.x + PW > sf.x + 3 && p.x < sf.x + sf.w - 3 && prevB <= sf.y + 6 && curB >= sf.y) { p.y = sf.y - PH; p.vy = 0; landed = true; if (sf.m) p.ride = sf.m; break; } }
    }
    if (landed) { p.coyote = 0.1; p.jumps = 0; }
    if (p.y > AREA_H + 60) { fall(s); if (s.over) return; }
    // cámara
    s.cam += (clamp(p.x - AREA_W * 0.35, 0, lv.LEN - AREA_W) - s.cam) * Math.min(1, dt * 8);
    // banderas
    lv.fg.forEach(f => { if (!f.on && p.x > f.x) { f.on = true; s.spawn = { x: f.x, y: GY - PH }; fx.pop(f.x - s.cam, GY - 80, 'CHECKPOINT', C.lime, 14); hx.good(); } });
    // pinchos
    lv.hz.forEach(h => { if (p.x + PW - 6 > h.x && p.x + 6 < h.x + h.w && p.y + PH > GY - 16) hurt(s, p.x < h.x + h.w / 2 ? -1 : 1); });
    // enemigos
    const boss = lv.en.find(e => e.t === 'boss' && e.alive);
    lv.en.forEach(e => {
      if (!e.alive) return;
      const w = e.w || 32, h = e.h || 32;
      if (e.t === 'walker') { e.x += e.vx * dt; if (e.x <= e.bx || e.x + w >= e.ex) { e.vx *= -1; e.x = clamp(e.x, e.bx, e.ex - w); } }
      else if (e.t === 'flyer') { e.ph += dt * 3; e.x += e.vx * dt; e.y = e.y0 + Math.sin(e.ph) * 40; if (e.x < s.cam - 200) e.x = s.cam + AREA_W + 100; }
      else if (e.t === 'hopper') { e.tm -= dt; e.vy = (e.vy || 0) + 1500 * dt; e.y += e.vy * dt; if (e.y >= GY - 30) { e.y = GY - 30; e.vy = 0; e.vx = 0; } if (e.tm <= 0 && e.y >= GY - 30) { e.tm = rand(1, 2); e.vy = -520; e.vx = Math.sign(p.x - e.x) * 90; } e.x += e.vx * dt; }
      else if (e.t === 'turret') { e.tm -= dt; if (e.tm <= 0 && Math.abs(p.x - e.x) < 380 && e.x > s.cam - 40 && e.x < s.cam + AREA_W) { e.tm = 2; s.eb.push({ x: e.x + 16, y: e.y + 12, vx: Math.sign(p.x - e.x) * 190, vy: 0 }); } }
      else if (e.t === 'boss') {
        e.x += e.vx * dt; if (e.x <= e.bx || e.x + w >= e.ex) e.vx *= -1; e.vy += 1800 * dt; e.y += e.vy * dt; if (e.y >= GY - h) { e.y = GY - h; e.vy = 0; }
        e.jt -= dt; if (e.jt <= 0 && e.y >= GY - h) { e.jt = rand(1.6, 2.6); e.vy = -640; }
        e.tm -= dt; if (e.tm <= 0 && Math.abs(p.x - e.x) < 520) { e.tm = Math.max(1.2, 2.2 - s.n * 0.1); for (let k = -1; k <= 1; k++) s.eb.push({ x: e.x + w / 2, y: e.y + 20, vx: Math.sign(p.x - e.x || 1) * 200, vy: k * 80 }); }
      }
      const hit = p.x + PW > e.x + 4 && p.x + 4 < e.x + w && p.y + PH > e.y + 4 && p.y + 4 < e.y + h;
      if (!hit) return;
      if (p.star > 0) { if (e.t === 'boss') { e.hp -= 1; } else kill(s, e, 50); return; }
      if (p.vy > 100 && p.y + PH < e.y + h * 0.6) {
        e.hp -= 1; p.vy = -540; p.jumps = 1; fx.burst(e.x + w / 2, e.y, '#fff', 6, 120, 0.3, 3);
        if (e.hp <= 0) { if (e.t === 'boss') { s.score += 500; fx.burst(e.x + w / 2, e.y + h / 2, C.amber, 40, 360, 1, 7); fx.flash('#fff', 0.5); fx.shake(12, 0.5); hx.win(); e.alive = false; } else kill(s, e, e.t === 'turret' ? 80 : 50); } else hx.hit();
      } else hurt(s, p.x < e.x ? -1 : 1);
    });
    // balas
    s.bul.forEach(b => { b.x += b.vx * dt; });
    s.bul = s.bul.filter(b => { if (b.x < s.cam - 20 || b.x > s.cam + AREA_W + 20) return false; for (const e of lv.en) { if (!e.alive) continue; const w = e.w || 32, h = e.h || 32; if (b.x + 12 > e.x && b.x < e.x + w && b.y + 5 > e.y && b.y < e.y + h) { e.hp -= 1; fx.burst(b.x, b.y, C.amber, 4, 120, 0.25, 3); if (e.hp <= 0) { if (e.t === 'boss') { s.score += 500; fx.burst(e.x + w / 2, e.y + h / 2, C.amber, 40, 360, 1, 7); fx.flash('#fff', 0.5); fx.shake(12, 0.5); hx.win(); e.alive = false; } else kill(s, e, e.t === 'turret' ? 80 : 50); } return false; } } return true; });
    s.eb.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; });
    s.eb = s.eb.filter(b => { if (b.x < s.cam - 30 || b.x > s.cam + AREA_W + 30 || b.y > AREA_H || b.y < 0) return false; if (b.x > p.x && b.x < p.x + PW && b.y > p.y && b.y < p.y + PH) { hurt(s, Math.sign(b.vx)); return false; } return true; });
    // monedas y poderes
    lv.co.forEach(c => { if (!c.got && Math.abs(c.x + 8 - (p.x + PW / 2)) < 22 && Math.abs(c.y + 8 - (p.y + PH / 2)) < 30) { c.got = true; s.score += 10; s.coins += 1; fx.burst(c.x - s.cam, c.y, C.amber, 5, 120, 0.3, 3); hx.tick(); } });
    lv.pu.forEach(u => { if (!u.got && Math.abs(u.x + 12 - (p.x + PW / 2)) < 26 && Math.abs(u.y + 12 - (p.y + PH / 2)) < 32) { u.got = true; hx.good(); s.score += 20; fx.ring(u.x - s.cam, u.y, C.lime, 50); if (u.t === 'star') { p.star = 6; fx.pop(u.x - s.cam, u.y - 10, 'INVENCIBLE', C.amber, 15); } if (u.t === 'shield') { p.shield = true; fx.pop(u.x - s.cam, u.y - 10, 'ESCUDO', C.cyan, 15); } if (u.t === 'heart') { s.lives = Math.min(5, s.lives + 1); fx.pop(u.x - s.cam, u.y - 10, '+1 VIDA', C.red, 15); } if (u.t === 'bolt') { p.bolt = 8; fx.pop(u.x - s.cam, u.y - 10, 'DISPARO RÁPIDO', C.violet, 14); } } });
    // meta
    if (p.x > lv.end && !(lv.boss && lv.en.some(e => e.t === 'boss' && e.alive))) {
      const bonus = 200 + Math.max(0, Math.round(120 - s.time)) * 5; s.score += bonus; s.bonus = bonus; hx.win(); fx.flash('#fff', 0.35);
      submitBest(s.score); setPhase(s.n >= 6 ? 'win' : 'clear');
    }
  });
  const TH = NW_THEMES[(g.current.n - 1) % NW_THEMES.length];
  const s = g.current; const p = s.p; const lv = s.lv; const cam = s.cam;
  const vis = x => x > cam - 120 && x < cam + AREA_W + 120;
  const nBoss = lv.en.find(e => e.t === 'boss' && e.alive);
  return (
    <GameScreen title="NEON WARRIOR" emoji="🥷" accent={TH.a} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={Math.max(3, s.lives)} /><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: TH.a, fontWeight: '900' }}>{s.n}/6</Text> · {TH.name}</Text><Text style={{ color: C.cyan, fontSize: 12, fontWeight: '800' }}>{p.shield ? '🛡️ ' : ''}{p.star > 0 ? `⭐${Math.ceil(p.star)} ` : ''}{p.bolt > 0 ? `⚡${Math.ceil(p.bolt)}` : ''}</Text></>}
      footer={<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 8 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <NwBtn id="nw-left" label="◀" color={TH.a} on={() => { input.left = true; }} off={() => { input.left = false; }} />
          <NwBtn id="nw-right" label="▶" color={TH.a} on={() => { input.right = true; }} off={() => { input.right = false; }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <NwBtn id="nw-shoot" label="💥" color={C.amber} on={shoot} off={() => {}} />
          <NwBtn id="nw-jump" label="⬆" color={C.cyan} on={jumpPress} off={jumpRelease} big />
        </View>
      </View>}>
      <PlayArea fx={fx} h={AREA_H} bg={TH.bg} border={alpha(TH.a, 0.4)}>
        <Starfield stars={stars.map(st => ({ ...st, x: ((st.x - cam * st.z * 0.3) % AREA_W + AREA_W) % AREA_W }))} offset={0} />
        {[0.2, 0.45].map((k, i) => Array.from({ length: 6 }, (_, j) => { const bx = ((j * 190 - cam * k) % (AREA_W + 190) + AREA_W + 190) % (AREA_W + 190) - 90; const bh = 60 + ((j * 37 + i * 23) % 70) * (i ? 1.2 : 0.8); return <View key={`${i}${j}`} style={{ position: 'absolute', left: bx, top: GY - bh, width: 70, height: bh + 70, backgroundColor: alpha(i ? TH.b : TH.a, i ? 0.06 : 0.04), borderTopWidth: 2, borderColor: alpha(i ? TH.b : TH.a, 0.12) }} />; }))}
        {lv.gr.filter(sf => sf.x < cam + AREA_W + 40 && sf.x + sf.w > cam - 40).map((sf, i) => <View key={`g${i}`} style={{ position: 'absolute', left: sf.x - cam, top: sf.y, width: sf.w, height: AREA_H - sf.y, backgroundColor: alpha(TH.b, 0.08), borderTopWidth: 3, borderTopColor: TH.b, ...glow(TH.b, 8, 0.5) }} />)}
        {lv.fl.filter(f => vis(f.x)).map((f, i) => <View key={`f${i}`} style={{ position: 'absolute', left: f.x - cam, top: f.y, width: f.w, height: 14, borderRadius: 4, backgroundColor: alpha(TH.a, 0.25), borderWidth: 2, borderColor: TH.a, ...glow(TH.a, 8, 0.5) }} />)}
        {lv.mv.filter(m => vis(m.cx)).map(m => <View key={m.id} style={{ position: 'absolute', left: m.cx - cam, top: m.y, width: m.w, height: 14, borderRadius: 4, backgroundColor: alpha(C.amber, 0.28), borderWidth: 2, borderColor: C.amber, ...glow(C.amber, 8, 0.5) }} />)}
        {lv.hz.filter(h => vis(h.x)).map((h, i) => Array.from({ length: Math.floor(h.w / 16) }, (_, k) => <View key={`${i}-${k}`} style={{ position: 'absolute', left: h.x + k * 16 - cam, top: GY - 16, width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 16, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: C.red }} />))}
        {lv.fg.filter(f => vis(f.x)).map((f, i) => <Text key={`fl${i}`} style={{ position: 'absolute', left: f.x - cam, top: GY - 36, fontSize: 28, opacity: f.on ? 1 : 0.45 }}>🚩</Text>)}
        <Text style={{ position: 'absolute', left: lv.end - cam, top: GY - 62, fontSize: 52, opacity: nBoss ? 0.3 : 1, ...tglow(TH.a, 14) }}>🌀</Text>
        {lv.co.filter(c => !c.got && vis(c.x)).map(c => <Text key={c.id} style={{ position: 'absolute', left: c.x - cam, top: c.y, fontSize: 18 }}>🪙</Text>)}
        {lv.pu.filter(u => !u.got && vis(u.x)).map(u => <Text key={u.id} style={{ position: 'absolute', left: u.x - cam, top: u.y, fontSize: 24, ...tglow(C.lime, 8) }}>{u.t === 'star' ? '⭐' : u.t === 'shield' ? '🛡️' : u.t === 'heart' ? '❤️' : '⚡'}</Text>)}
        {lv.en.filter(e => e.alive && vis(e.x)).map(e => (
          <View key={e.id} style={{ position: 'absolute', left: e.x - cam, top: e.y }}>
            <Text style={{ fontSize: e.t === 'boss' ? 64 : 28, lineHeight: e.t === 'boss' ? 74 : 32, ...tglow(e.t === 'boss' ? C.red : '#000', e.t === 'boss' ? 14 : 2) }}>{e.t === 'walker' ? '👾' : e.t === 'flyer' ? '🛸' : e.t === 'hopper' ? '🐸' : e.t === 'turret' ? '🤖' : '👹'}</Text>
            {e.maxHp > 1 && <Bar value={e.hp} max={e.maxHp} color={C.red} h={4} w={e.t === 'boss' ? 70 : 32} />}
          </View>
        ))}
        {s.bul.map((b, i) => <View key={`b${i}`} style={{ position: 'absolute', left: b.x - cam, top: b.y, width: 12, height: 5, borderRadius: 3, backgroundColor: C.amber, ...glow(C.amber, 6, 1) }} />)}
        {s.eb.map((b, i) => <View key={`e${i}`} style={{ position: 'absolute', left: b.x - cam - 4, top: b.y - 4, width: 9, height: 9, borderRadius: 5, backgroundColor: C.pink, ...glow(C.pink, 8, 1) }} />)}
        {!s.over && <Text style={{ position: 'absolute', left: p.x - cam - 2, top: p.y - 2, fontSize: 32, lineHeight: PH + 4, opacity: p.inv > 0 && Math.floor(p.inv * 12) % 2 ? 0.25 : 1, transform: [{ scaleX: p.face }], ...tglow(p.star > 0 ? C.amber : TH.a, p.star > 0 ? 16 : 6) }}>🥷</Text>}
        {p.shield && <View style={{ position: 'absolute', left: p.x - cam - 8, top: p.y - 6, width: PW + 16, height: PH + 12, borderRadius: 24, borderWidth: 2, borderColor: alpha(C.cyan, 0.8), backgroundColor: alpha(C.cyan, 0.1) }} />}
        {nBoss && <View style={{ position: 'absolute', top: 8, left: 40, right: 40 }}><Text style={{ color: C.red, fontSize: 11, fontWeight: '900', textAlign: 'center', letterSpacing: 2 }}>JEFE</Text><Bar value={nBoss.hp} max={nBoss.maxHp} color={C.red} h={8} /></View>}
        <Overlay show={phase !== 'play'} kind={phase === 'clear' ? 'win' : phase} emoji={phase === 'win' ? '🏆' : phase === 'clear' ? '✨' : phase === 'over' ? '💀' : '🥷'}
          title={phase === 'win' ? '¡VICTORIA TOTAL!' : phase === 'clear' ? `NIVEL ${s.n} COMPLETO` : phase === 'over' ? 'GAME OVER' : 'NEON WARRIOR'}
          subtitle={phase === 'clear' ? `Bonus +${s.bonus || 0} · ${s.kills} enemigos · ${s.coins} monedas` : phase === 'win' ? `6 niveles superados · ${s.coins} monedas` : phase === 'over' ? `Llegaste al nivel ${s.n}` : '6 niveles · 2 jefes · saltos dobles'}
          score={s.score} best={best} isNew={res.isNew} accent={TH.a} startLabel={phase === 'clear' ? `NIVEL ${s.n + 1} →` : undefined} onStart={phase === 'clear' ? nextLevel : start} onExit={onExit}
          lines={phase === 'ready' ? ['◀ ▶ mover · ⬆ saltar (toca de nuevo en el aire)', 'Mantén ⬆ para saltar más alto · 💥 dispara', 'Pisa enemigos o dispárales · 🚩 checkpoints', '⭐ invencible · 🛡️ escudo · ⚡ disparo rápido'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
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
function pcGen(seed) {
  const rnd = rpgRng(seed);
  const lat = Array.from({ length: 260 }, () => rnd());
  const n1 = x => { const i = Math.floor(x), f = x - i; const a = lat[((i % 260) + 260) % 260], b = lat[(((i + 1) % 260) + 260) % 260]; const t = f * f * (3 - 2 * f); return a + (b - a) * t; };
  const lat2 = Array.from({ length: 40 * 24 }, () => rnd());
  const vn = (x, y) => { const gx = x / 6, gy = y / 5; const i = Math.floor(gx), j = Math.floor(gy), fx_ = gx - i, fy = gy - j; const g = (a, b) => lat2[((b % 24 + 24) % 24) * 40 + ((a % 40 + 40) % 40)]; const sx = fx_ * fx_ * (3 - 2 * fx_), sy = fy * fy * (3 - 2 * fy); return (g(i, j) * (1 - sx) + g(i + 1, j) * sx) * (1 - sy) + (g(i, j + 1) * (1 - sx) + g(i + 1, j + 1) * sx) * sy; };
  const rows = Array.from({ length: PC_H }, () => new Uint8Array(PC_W));
  const h = Array.from({ length: PC_W }, (_, x) => Math.floor(PC_H * 0.36 + (n1(x * 0.05) - 0.5) * 16 + (n1(x * 0.15 + 100) - 0.5) * 5));
  const biome = Array.from({ length: PC_W }, (_, x) => { const b = n1(x * 0.025 + 500); return b < 0.3 ? 'desert' : b > 0.72 ? 'snow' : 'grass'; });
  for (let x = 0; x < PC_W; x++) {
    for (let y = h[x]; y < PC_H; y++) {
      const d = y - h[x];
      let t;
      if (y >= PC_H - 2) t = 4;
      else if (d === 0) t = biome[x] === 'desert' ? 11 : biome[x] === 'snow' ? 12 : 1;
      else if (d < 4) t = biome[x] === 'desert' ? 11 : 2;
      else {
        const r = rnd(); t = 3;
        if (d > 30 && r < 0.02) t = 8; else if (d > 20 && r < 0.045) t = 7; else if (d > 9 && r < 0.09) t = 6; else if (d > 3 && r < 0.13) t = 5;
        if (d > 6 && y < PC_H - 3 && vn(x, y) > 0.66) t = y > PC_H - 10 ? 15 : 0;
      }
      rows[y][x] = t;
    }
  }
  let last = -9;
  for (let x = 3; x < PC_W - 3; x++) {
    if (biome[x] === 'grass' && x - last > 4 && rnd() < 0.16 && Math.abs(h[x] - h[x - 1]) < 2) {
      last = x; const th = 4 + Math.floor(rnd() * 2);
      for (let y = h[x] - th; y < h[x]; y++) rows[y][x] = 9;
      for (let ly = h[x] - th - 2; ly <= h[x] - th + 1; ly++) for (let lx = x - 2; lx <= x + 2; lx++) if (ly >= 0 && rows[ly][lx] === 0) rows[ly][lx] = 10;
    }
  }
  return { rows, h };
}
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

function PixelCraft({ onExit }) {
  const AREA_H = AREA_HF;
  const S = Math.floor(AREA_W / 11);
  const VC = Math.ceil(AREA_W / S) + 2, VR = Math.ceil(AREA_H / S) + 2;
  const PWD = 0.78, PHT = 1.8;
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('craft');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const [, force] = useReducer(x => x + 1, 0);
  const input = useRef({ left: false, right: false }).current;
  const g = useRef(null);
  const initState = () => {
    const seed = Math.floor(Math.random() * 1e9); const w = pcGen(seed); const sx = 10;
    return { rows: w.rows, h: w.h, p: { x: sx + 0.1, y: w.h[sx] - 3, vx: 0, vy: 0, ground: false, fall: 0, hp: 20, inv: 0, face: 1, calm: 0 }, cam: { x: 0, y: 0 }, inv: {}, mode: 'mine', sel: 0, mine: null, tier: 0, sword: 0, zombies: [], t: 0.05, score: 0, mined: 0, kills: 0, ver: 0, hold: null, craft: false, spawnT: 3, toast: null, maxDepth: 0, oreScore: 0 };
  };
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const solid = (s, x, y) => { if (x < 0 || x >= PC_W) return true; if (y < 0) return false; if (y >= PC_H) return true; const t = s.rows[y][x]; return t > 0 && t !== 14 && t !== 15; };
  const box = (s, x, y, w, h) => { for (let j = Math.floor(y); j <= Math.floor(y + h - 0.001); j++) for (let i = Math.floor(x); i <= Math.floor(x + w - 0.001); i++) if (solid(s, i, j)) return true; return false; };
  const toast = (s, m) => { s.toast = { m, t: 1.6 }; };
  const die = (s, why) => { hx.die(); fx.shake(10, 0.4); fx.flash(C.red, 0.4); const sc = s.mined + s.oreScore + s.kills * 10 + s.maxDepth * 2; s.final = sc; setRes({ isNew: submitBest(sc), why }); setPhase('over'); };
  const hurt = (s, d, why) => { const p = s.p; if (p.inv > 0) return; p.hp -= d; p.inv = 0.9; p.calm = 0; fx.burst((p.x + PWD / 2) * S - s.cam.x * S, (p.y + 0.9) * S - s.cam.y * S, C.red, 8, 160); fx.shake(5, 0.2); hx.bad(); if (p.hp <= 0) die(s, why); };
  const addInv = (s, id, n) => { s.inv[id] = (s.inv[id] || 0) + n; };
  const canPay = (s, cost) => Object.entries(cost).every(([k, v]) => (s.inv[k] || 0) >= v);
  const craft = r => {
    const s = g.current; if (!canPay(s, r.cost)) { hx.bad(); toast(s, 'Te faltan materiales'); force(); return; }
    if (r.tier && s.tier >= r.tier) { toast(s, 'Ya tienes algo mejor'); force(); return; }
    if (r.sword && s.sword >= r.sword) { toast(s, 'Ya tienes algo mejor'); force(); return; }
    Object.entries(r.cost).forEach(([k, v]) => { s.inv[k] -= v; if (!s.inv[k]) delete s.inv[k]; });
    if (r.give) Object.entries(r.give).forEach(([k, v]) => addInv(s, k, v));
    if (r.tier) s.tier = r.tier; if (r.sword) s.sword = r.sword;
    hx.win(); toast(s, '¡Fabricado!'); force();
  };
  const tileAt = (px, py) => { const s = g.current; return [Math.floor(s.cam.x + px / S), Math.floor(s.cam.y + py / S)]; };
  const reach = (s, wx, wy) => Math.hypot(wx + 0.5 - (s.p.x + PWD / 2), wy + 0.5 - (s.p.y + 0.9)) <= 4.6;
  const tapWorld = (px, py) => {
    const s = g.current; if (phase !== 'play' || s.craft) return;
    const [wx, wy] = tileAt(px, py);
    // atacar zombi
    const z = s.zombies.find(o => px >= (o.x - s.cam.x) * S - 8 && px <= (o.x + 0.8 - s.cam.x) * S + 8 && py >= (o.y - s.cam.y) * S - 8 && py <= (o.y + 1.8 - s.cam.y) * S + 8);
    if (z) {
      if (Math.hypot(z.x - s.p.x, z.y - s.p.y) > 3.2) { toast(s, 'Muy lejos'); return; }
      const d = PC_SWORD[s.sword][1]; z.hp -= d; z.vx = Math.sign(z.x - s.p.x) * 6; z.vy = -6; hx.hit();
      fx.burst((z.x + 0.4 - s.cam.x) * S, (z.y + 0.9 - s.cam.y) * S, C.lime, 8, 160, 0.4, 4); fx.pop((z.x + 0.4 - s.cam.x) * S, (z.y - s.cam.y) * S, `-${d}`, C.text, 15);
      if (z.hp <= 0) { s.zombies = s.zombies.filter(o => o !== z); s.kills += 1; fx.burst((z.x + 0.4 - s.cam.x) * S, (z.y + 0.9 - s.cam.y) * S, C.lime, 16, 240); hx.win(); }
      return;
    }
    if (wy < 0 || wy >= PC_H || wx < 0 || wx >= PC_W) return;
    if (!reach(s, wx, wy)) { toast(s, 'Muy lejos'); return; }
    if (s.mode === 'place') {
      const sel = s.sel;
      if (!sel || !s.inv[sel] || s.rows[wy][wx] !== 0) return;
      if (sel !== 14 && (wx + 1 > s.p.x && wx < s.p.x + PWD && wy + 1 > s.p.y && wy < s.p.y + PHT)) return;
      s.rows[wy][wx] = sel; s.inv[sel] -= 1; if (!s.inv[sel]) { delete s.inv[sel]; s.sel = 0; } s.ver += 1; hx.tap(); return;
    }
    s.hold = { wx, wy };
  };
  const toRelease = () => { const s = g.current; s.hold = null; s.mine = null; };
  const pan = usePan(fx, { down: tapWorld, move: (x, y) => { const s = g.current; if (s.hold) { const [wx, wy] = tileAt(x, y); if (wx !== s.hold.wx || wy !== s.hold.wy) s.hold = { wx, wy }; } }, up: toRelease });

  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p;
    s.t += dt / 150; p.inv = Math.max(0, p.inv - dt); p.calm += dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    p.vx = ax * 5.2; if (ax) p.face = ax;
    p.vy = Math.min(p.vy + 40 * dt, 26);
    const dx = p.vx * dt;
    if (!box(s, p.x + dx, p.y, PWD, PHT)) p.x = clamp(p.x + dx, 0, PC_W - PWD);
    else if (ax && p.ground && !box(s, p.x + dx, p.y - 1, PWD, PHT) && !box(s, p.x, p.y - 1, PWD, PHT)) { p.y -= 1; p.x = clamp(p.x + dx, 0, PC_W - PWD); }
    const dy = p.vy * dt; const wasGround = p.ground; p.ground = false;
    if (!box(s, p.x, p.y + dy, PWD, PHT)) { p.y += dy; if (dy > 0) p.fall += dy; }
    else if (dy > 0) { p.y = Math.floor(p.y + dy + PHT) - PHT - 0.001; p.ground = true; if (p.fall > 6.5) hurt(s, Math.round((p.fall - 6) * 2), 'caída'); p.fall = 0; p.vy = 0; }
    else { p.y = Math.floor(p.y + dy) + 1.001; p.vy = 0; }
    if (p.ground) p.fall = 0;
    if (p.hp <= 0) return;
    p.y = clamp(p.y, -2, PC_H - 2);
    s.maxDepth = Math.max(s.maxDepth, Math.floor(p.y - s.h[clamp(Math.floor(p.x), 0, PC_W - 1)]));
    // lava
    for (let j = Math.floor(p.y); j <= Math.floor(p.y + PHT - 0.01); j++) for (let i = Math.floor(p.x); i <= Math.floor(p.x + PWD); i++) if (j >= 0 && j < PC_H && i >= 0 && i < PC_W && s.rows[j][i] === 15) { p.hp -= 14 * dt; p.inv = Math.max(p.inv, 0.05); if (p.hp <= 0) { die(s, 'lava'); return; } }
    if (p.calm > 8 && p.hp < 20) { p.hp = Math.min(20, p.hp + 2 * dt); }
    // cámara
    s.cam.x += (clamp(p.x - VC / 2 + 1 + 0.4, 0, PC_W - VC) - s.cam.x) * Math.min(1, dt * 8);
    s.cam.y += (clamp(p.y - VR / 2 + 1 + 0.9, 0, PC_H - VR) - s.cam.y) * Math.min(1, dt * 8);
    // minado
    if (s.hold) {
      const { wx, wy } = s.hold; const t = (s.rows[wy] || [])[wx];
      if (!t || !reach(s, wx, wy)) { s.mine = null; }
      else {
        const d = PC_BLK[t];
        if (d[3] > s.tier) { if (!s.mine || s.mine.warn !== t) { toast(s, `Necesitas ${PC_PICK[Math.min(3, d[3])]}`); hx.warn(); } s.mine = { wx, wy, prog: 0, warn: t }; }
        else {
          if (!s.mine || s.mine.wx !== wx || s.mine.wy !== wy) s.mine = { wx, wy, prog: 0 };
          s.mine.prog += dt / Math.max(0.05, d[2] / PC_SPEED[s.tier]);
          if (Math.random() < dt * 14) fx.burst((wx + 0.5 - s.cam.x) * S, (wy + 0.5 - s.cam.y) * S, d[1], 2, 90, 0.3, 3);
          if (s.mine.prog >= 1) {
            s.rows[wy][wx] = 0; s.ver += 1; s.mined += 1; if (PC_VALUE[t]) { s.oreScore += PC_VALUE[t]; fx.pop((wx + 0.5 - s.cam.x) * S, (wy - s.cam.y) * S, `+${PC_VALUE[t]}`, C.amber, 16); }
            if (d[4]) addInv(s, d[4], 1);
            fx.burst((wx + 0.5 - s.cam.x) * S, (wy + 0.5 - s.cam.y) * S, d[0], 8, 160, 0.5, 4); hx.hit(); s.mine = null;
            // los árboles sueltan hojas? (no)
          }
        }
      }
    }
    // zombis (noche)
    const night = Math.sin(s.t * Math.PI * 2) < -0.1;
    s.spawnT -= dt;
    if (night && s.spawnT <= 0 && s.zombies.length < 4 && p.y < s.h[clamp(Math.floor(p.x), 0, PC_W - 1)] + 6) {
      s.spawnT = 5; const zx = clamp(Math.floor(p.x + (Math.random() < 0.5 ? -1 : 1) * rand(9, 14)), 1, PC_W - 2);
      s.zombies.push({ id: uid(), x: zx, y: s.h[zx] - 2, vx: 0, vy: 0, hp: 4, face: 1, t: 0 });
    }
    s.zombies.forEach(z => {
      z.t += dt; z.vy = Math.min(z.vy + 40 * dt, 24);
      const dir = Math.sign(p.x - z.x); z.face = dir || 1;
      const wv = dir * 1.7; const zx2 = z.x + (z.vx + wv) * dt; z.vx *= 0.88;
      if (!box(s, zx2, z.y, 0.8, 1.8)) z.x = zx2; else if (z.grounded && !box(s, zx2, z.y - 1, 0.8, 1.8)) { z.vy = -11; }
      const zy2 = z.y + z.vy * dt; z.grounded = false;
      if (!box(s, z.x, zy2, 0.8, 1.8)) z.y = zy2; else if (z.vy > 0) { z.y = Math.floor(zy2 + 1.8) - 1.8 - 0.001; z.vy = 0; z.grounded = true; } else { z.y = Math.floor(zy2) + 1.001; z.vy = 0; }
      if (Math.abs(z.x - p.x) < 0.8 && Math.abs(z.y - p.y) < 1.6) { hurt(s, 3, 'zombi'); p.vx = 0; p.vy = -7; p.x += Math.sign(p.x - z.x) * 0.3; }
    });
    if (!night) s.zombies = s.zombies.filter(z => { if (Math.random() < dt * 0.4) { fx.burst((z.x + 0.4 - s.cam.x) * S, (z.y + 0.9 - s.cam.y) * S, C.orange, 10, 160); return false; } return true; });
    s.zombies = s.zombies.filter(z => Math.abs(z.x - p.x) < 40 && z.y < PC_H);
  });
  const jump = () => { const s = g.current; if (phase !== 'play') return; if (s.p.ground) { s.p.vy = -13.2; s.p.ground = false; hx.tap(); } };

  const s = g.current; const p = s.p; const cam = s.cam;
  const ix = Math.floor(cam.x), iy = Math.floor(cam.y);
  const sunV = Math.sin(s.t * Math.PI * 2);
  const day = clamp((sunV + 0.2) / 1.0, 0, 1);
  const sky = `rgb(${Math.floor(10 + day * 110)},${Math.floor(16 + day * 150)},${Math.floor(38 + day * 175)})`;
  const depth = p.y - s.h[clamp(Math.floor(p.x), 0, PC_W - 1)];
  const under = clamp((depth - 4) / 18, 0, 1) * 0.6;
  const nightD = clamp(-sunV * 1.4, 0, 1) * 0.5;
  const torchNear = (() => { for (let j = Math.floor(p.y) - 5; j <= Math.floor(p.y) + 5; j++) for (let i = Math.floor(p.x) - 5; i <= Math.floor(p.x) + 5; i++) if (j >= 0 && j < PC_H && i >= 0 && i < PC_W && s.rows[j][i] === 14) return true; return false; })();
  const dark = Math.max(under, nightD) * (torchNear ? 0.45 : 1);
  const inv = Object.entries(s.inv).filter(([k, v]) => v > 0 && Number(k) !== 0);
  const hearts = Array.from({ length: 10 }, (_, i) => (p.hp >= (i + 1) * 2 ? '❤️' : p.hp >= i * 2 + 1 ? '💔' : '🖤'));
  const CB = (label, id, on, off, color, big) => <NwBtn key={id} id={id} label={label} color={color} on={on} off={off} big={big} size={Math.min(58, Math.floor((SCREEN_W - 24 - 24) / 5.4))} />;
  const score = s.mined + s.oreScore + s.kills * 10 + s.maxDepth * 2;
  return (
    <GameScreen title="PIXEL CRAFT" emoji="⛏️" accent={C.orange} onExit={onExit} score={score} best={best}
      hud={<><Text style={{ fontSize: 11 }}>{hearts.join('')}</Text><Text style={{ color: C.dim, fontSize: 11 }}>{PC_PICK[s.tier]} · {PC_SWORD[s.sword][0]}</Text><Text style={{ color: sunV < -0.1 ? C.violet : C.amber, fontSize: 12, fontWeight: '900' }}>{sunV < -0.1 ? '🌙 NOCHE' : '☀️ DÍA'}</Text></>}
      footer={<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>{CB('◀', 'pc-left', () => { input.left = true; }, () => { input.left = false; }, C.orange)}{CB('▶', 'pc-right', () => { input.right = true; }, () => { input.right = false; }, C.orange)}</View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {CB(s.mode === 'mine' ? '⛏️' : '🧱', 'pc-mode', () => { s.mode = s.mode === 'mine' ? 'place' : 'mine'; hx.tick(); force(); }, () => {}, s.mode === 'mine' ? C.amber : C.lime)}
          {CB('🔨', 'pc-craft', () => { s.craft = !s.craft; hx.tick(); force(); }, () => {}, C.cyan)}
          {CB('⬆', 'pc-jump', jump, () => {}, C.pink, true)}
        </View>
      </View>}>
      <PlayArea fx={fx} h={AREA_H} bg={sky} border={alpha(C.orange, 0.4)} {...pan}>
        {day > 0.4 && <Text style={{ position: 'absolute', left: ((s.t * 2 % 1) * (AREA_W + 80)) - 40, top: 30 + (1 - day) * 60, fontSize: 40, opacity: 0.9 }}>☀️</Text>}
        {day <= 0.4 && <Text style={{ position: 'absolute', right: 40, top: 30, fontSize: 36 }}>🌙</Text>}
        <View style={{ position: 'absolute', left: -(cam.x - ix) * S, top: -(cam.y - iy) * S, width: VC * S, height: VR * S }}>
          <PcTiles rows={s.rows} x0={ix} y0={iy} cols={VC} rowsN={VR} S={S} ver={s.ver} />
        </View>
        {s.mine && !s.mine.warn && <View pointerEvents="none" style={{ position: 'absolute', left: (s.mine.wx - cam.x) * S, top: (s.mine.wy - cam.y) * S, width: S, height: S, borderWidth: 2, borderColor: '#fff', backgroundColor: `rgba(0,0,0,${Math.min(0.6, s.mine.prog * 0.6)})` }} />}
        {s.hold && s.mode === 'mine' && <View pointerEvents="none" style={{ position: 'absolute', left: (s.hold.wx - cam.x) * S, top: (s.hold.wy - cam.y) * S, width: S, height: S, borderWidth: 2, borderColor: alpha('#ffffff', 0.7) }} />}
        {s.zombies.map(z => <Text key={z.id} style={{ position: 'absolute', left: (z.x - cam.x) * S - S * 0.3, top: (z.y - cam.y) * S - S * 0.15, fontSize: S * 1.7, lineHeight: S * 1.9, transform: [{ scaleX: z.face }] }}>🧟</Text>)}
        <Text style={{ position: 'absolute', left: (p.x - cam.x) * S - S * 0.4, top: (p.y - cam.y) * S - S * 0.12, fontSize: S * 1.7, lineHeight: S * 1.9, opacity: p.inv > 0 && Math.floor(p.inv * 12) % 2 ? 0.3 : 1, transform: [{ scaleX: p.face }] }}>🧑</Text>
        {dark > 0.02 && <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, backgroundColor: `rgba(0,0,12,${dark})` }} />}
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 6, right: 6, bottom: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 5, justifyContent: 'center' }}>
          {inv.slice(0, 9).map(([k, v]) => { const d = PC_BLK[k]; const on = s.sel === Number(k) && s.mode === 'place'; return (
            <Pressable key={k} onPressIn={() => { s.sel = Number(k); s.mode = 'place'; hx.tick(); force(); }}>
              <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 2, borderColor: on ? C.lime : 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                {Number(k) === 14 ? <Text style={{ fontSize: 20 }}>🔦</Text> : <View style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: d[0], borderWidth: 2, borderColor: d[1] }} />}
                <Text style={{ position: 'absolute', right: 2, bottom: 0, color: '#fff', fontSize: 11, fontWeight: '900', ...tglow('#000', 3) }}>{v}</Text>
              </View>
            </Pressable>); })}
        </View>
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: 14, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 13, fontWeight: '900', ...tglow('#000', 5) }}>{s.toast.m}</Text>}
        {s.craft && phase === 'play' && (
          <View style={{ position: 'absolute', left: 12, right: 12, top: 12, bottom: 12, borderRadius: 18, backgroundColor: 'rgba(8,8,18,0.94)', borderWidth: 2, borderColor: alpha(C.cyan, 0.6), padding: 12 }}>
            <Text style={{ color: C.cyan, fontWeight: '900', letterSpacing: 2, fontSize: 14, textAlign: 'center', marginBottom: 8 }}>🔨 FABRICACIÓN</Text>
            <ScrollView>{PC_RECIPES.map(r => { const ok = canPay(s, r.cost); const done = (r.tier && s.tier >= r.tier) || (r.sword && s.sword >= r.sword); return (
              <Pressable key={r.id} testID={`rc-${r.id}`} onPress={() => craft(r)} style={{ opacity: ok && !done ? 1 : 0.45, marginBottom: 6 }}>
                <View style={{ padding: 10, borderRadius: 12, backgroundColor: alpha(C.cyan, 0.1), borderWidth: 1.5, borderColor: alpha(C.cyan, 0.5) }}>
                  <Text style={{ color: C.text, fontWeight: '800', fontSize: 13 }}>{r.label}{done ? '  ✓' : ''}</Text>
                  <Text style={{ color: C.dim, fontSize: 11 }}>Cuesta: {Object.entries(r.cost).map(([k, v]) => `${v} ${PC_BLK[k][5]} (${s.inv[k] || 0})`).join(' · ')}</Text>
                </View>
              </Pressable>); })}</ScrollView>
            <Btn label="CERRAR" small ghost color={C.dim} onPress={() => { s.craft = false; force(); }} />
          </View>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? '💀' : '⛏️'} title={phase === 'over' ? (res.why === 'zombi' ? 'DEVORADO' : res.why === 'lava' ? 'FUNDIDO EN LAVA' : 'FIN DEL JUEGO') : 'PIXEL CRAFT'}
          subtitle={phase === 'over' ? `${s.mined} bloques · ${s.kills} zombis · profundidad ${s.maxDepth}` : 'Mina, fabrica y sobrevive a la noche'}
          score={s.final || score} best={best} isNew={res.isNew} accent={C.orange} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Mantén pulsado un bloque para minarlo', '🔨 fabrica picos, espadas y antorchas con lo que recojas', '🧱 elige un bloque del inventario para colocarlo', 'De noche salen zombis: toca para atacarlos', 'Cuidado con la lava en lo profundo'] : null} />
      </PlayArea>
    </GameScreen>
  );
}


         
         
      // px entre obstáculos

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

function RpgBtn({ label, onPress, color = C.amber, disabled, wide }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ width: wide ? '100%' : '48%', opacity: disabled ? 0.35 : 1 }}>
      <View style={{ paddingVertical: 12, borderRadius: 14, backgroundColor: alpha(color, 0.16), borderWidth: 2, borderColor: alpha(color, 0.8), alignItems: 'center' }}><Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>{label}</Text></View>
    </Pressable>
  );
}

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
          <View style={{ flex: 1, padding: 18, alignItems: 'center' }}>
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

// ─── INVASORES ────────────────────────────────────────────────────
function Invaders({ onExit }) {
  const COLS = 8, ROWS = 5, DX = 38, DY = 34, SY = AREA_H - 54, SHY = AREA_H - 138;
  const FW = (COLS - 1) * DX + 28;
  const fx = useFX();
  const [best, submitBest] = useBest('invaders');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const stars = useRef(makeStars(40)).current;
  const makeShields = () => { const out = []; for (let k = 0; k < 4; k++) { const bx = (AREA_W / 4) * k + AREA_W / 8 - 20; for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) { if (r === 2 && (c === 1 || c === 2 || c === 3)) continue; out.push({ id: uid(), x: bx + c * 8, y: SHY + r * 8, alive: true }); } } return out; };
  const makeWave = wave => ({ aliens: Array.from({ length: ROWS * COLS }, (_, i) => ({ r: Math.floor(i / COLS), c: i % COLS, alive: true })), fx: (AREA_W - FW) / 2, fy: 46 + Math.min(4, wave - 1) * 8, dir: 1, stepAcc: 0, shootT: 1.2 });
  const initState = () => ({ ...makeWave(1), wave: 1, x: AREA_W / 2, tx: AREA_W / 2, bul: [], ab: [], shields: makeShields(), ufo: null, ufoT: 12, score: 0, lives: 3, cool: 0, inv: 0, t: 0, banner: { text: 'OLEADA 1', t: 1.4 } });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const E = ['👽', '👾', '👾', '🐙', '🐙']; const PTS = [30, 20, 20, 10, 10];
  const hit = (s, why) => {
    if (s.inv > 0) return;
    s.lives -= 1; s.inv = 1.6; fx.burst(s.x, SY, C.red, 20, 240); fx.shake(9, 0.3); fx.flash(C.red, 0.3); hx.bad();
    if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt; s.inv = Math.max(0, s.inv - dt); s.cool -= dt;
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    s.x += (s.tx - s.x) * Math.min(1, dt * 18);
    if (s.cool <= 0) { s.cool = 0.42; s.bul.push({ x: s.x, y: SY - 18, vy: -520 }); hx.tick(); }
    const alive = s.aliens.filter(a => a.alive);
    // movimiento de la formación
    const interval = Math.max(0.035, 0.55 * (alive.length / (ROWS * COLS)) - (s.wave - 1) * 0.03);
    s.stepAcc += dt;
    if (s.stepAcc >= interval) {
      s.stepAcc = 0;
      const minC = Math.min(...alive.map(a => a.c)), maxC = Math.max(...alive.map(a => a.c));
      const left = s.fx + minC * DX, right = s.fx + maxC * DX + 28;
      if ((s.dir > 0 && right + 8 > AREA_W - 6) || (s.dir < 0 && left - 8 < 6)) { s.dir *= -1; s.fy += 16; } else s.fx += 8 * s.dir;
    }
    // disparos enemigos
    s.shootT -= dt;
    if (s.shootT <= 0 && alive.length) {
      s.shootT = Math.max(0.35, 1.1 - s.wave * 0.1) * rand(0.6, 1.2);
      const col = pick([...new Set(alive.map(a => a.c))]);
      const low = alive.filter(a => a.c === col).sort((a, b) => b.r - a.r)[0];
      s.ab.push({ x: s.fx + low.c * DX + 14, y: s.fy + low.r * DY + 28, vy: 190 + s.wave * 14 });
    }
    // ovni
    s.ufoT -= dt;
    if (s.ufoT <= 0 && !s.ufo) { s.ufo = { x: -30, vx: 110 }; s.ufoT = rand(14, 22); }
    if (s.ufo) { s.ufo.x += s.ufo.vx * dt; if (s.ufo.x > AREA_W + 30) s.ufo = null; }
    s.bul.forEach(b => { b.y += b.vy * dt; }); s.ab.forEach(b => { b.y += b.vy * dt; });
    // balas jugador
    s.bul = s.bul.filter(b => {
      if (b.y < -10) return false;
      for (const a of alive) { const ax = s.fx + a.c * DX, ay = s.fy + a.r * DY; if (a.alive && b.x > ax && b.x < ax + 28 && b.y > ay && b.y < ay + 28) { a.alive = false; s.score += PTS[a.r] * s.wave; fx.burst(ax + 14, ay + 14, C.lime, 10, 200); fx.pop(ax + 14, ay, `+${PTS[a.r] * s.wave}`, C.text, 13); hx.hit(); return false; } }
      if (s.ufo && b.x > s.ufo.x - 16 && b.x < s.ufo.x + 16 && b.y > 30 && b.y < 56) { const pts = pick([50, 100, 150, 300]); s.score += pts; fx.burst(s.ufo.x, 42, C.pink, 18, 260); fx.pop(s.ufo.x, 28, `+${pts}`, C.pink, 18); hx.win(); s.ufo = null; return false; }
      for (const sh of s.shields) if (sh.alive && b.x > sh.x - 2 && b.x < sh.x + 10 && b.y > sh.y && b.y < sh.y + 10) { sh.alive = false; return false; }
      return true;
    });
    s.ab = s.ab.filter(b => {
      if (b.y > AREA_H) return false;
      for (const sh of s.shields) if (sh.alive && b.x > sh.x - 2 && b.x < sh.x + 10 && b.y > sh.y && b.y < sh.y + 10) { sh.alive = false; fx.burst(sh.x, sh.y, C.lime, 3, 80, 0.3, 3); return false; }
      if (Math.abs(b.x - s.x) < 15 && b.y > SY - 14 && b.y < SY + 16) { hit(s); return false; }
      return true;
    });
    // los invasores llegan abajo
    if (alive.some(a => s.fy + a.r * DY + 28 > SHY - 6)) { s.lives = 0; hx.die(); fx.shake(10, 0.4); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
    if (!alive.length) {
      const bonus = 100 * s.wave; s.score += bonus; hx.win(); fx.flash('#fff', 0.3); fx.pop(AREA_W / 2, AREA_H / 2, `OLEADA SUPERADA +${bonus}`, C.lime, 20);
      const w = s.wave + 1; Object.assign(s, makeWave(w), { wave: w, bul: [], ab: [], banner: { text: `OLEADA ${w}`, t: 1.4 } });
      if (w % 2 === 1) s.shields = makeShields();
    }
  });
  const pan = usePan(fx, { down: x => { g.current.tx = clamp(x, 16, AREA_W - 16); }, move: x => { g.current.tx = clamp(x, 16, AREA_W - 16); } });
  const s = g.current;
  return (
    <GameScreen title="INVASORES" emoji="👽" accent={C.lime} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} icon="🚀" off="💥" /><Text style={{ color: C.dim, fontSize: 12 }}>Oleada <Text style={{ color: C.lime, fontWeight: '900' }}>{s.wave}</Text></Text><Text style={{ color: C.dim, fontSize: 12 }}>Quedan {s.aliens.filter(a => a.alive).length}</Text></>}>
      <PlayArea fx={fx} bg="#030a06" border={alpha(C.lime, 0.35)} {...pan}>
        <Starfield stars={stars} offset={s.t * 12} />
        {s.aliens.map(a => a.alive && <Text key={`${a.r}-${a.c}`} style={{ position: 'absolute', left: s.fx + a.c * DX, top: s.fy + a.r * DY + (Math.floor(s.t * 3 + a.c) % 2 ? 2 : 0), width: 28, textAlign: 'center', fontSize: 24, lineHeight: 28 }}>{E[a.r]}</Text>)}
        {s.shields.map(sh => sh.alive && <View key={sh.id} style={{ position: 'absolute', left: sh.x, top: sh.y, width: 8, height: 8, backgroundColor: C.lime, opacity: 0.8 }} />)}
        {s.ufo && <Text style={{ position: 'absolute', left: s.ufo.x - 16, top: 30, fontSize: 26, ...tglow(C.pink, 10) }}>🛸</Text>}
        {s.bul.map((b, i) => <View key={`b${i}`} style={{ position: 'absolute', left: b.x - 2, top: b.y - 8, width: 4, height: 14, borderRadius: 2, backgroundColor: C.cyan, ...glow(C.cyan, 6, 1) }} />)}
        {s.ab.map((b, i) => <View key={`a${i}`} style={{ position: 'absolute', left: b.x - 2.5, top: b.y - 7, width: 5, height: 14, borderRadius: 2, backgroundColor: C.pink, ...glow(C.pink, 6, 1) }} />)}
        <View style={{ position: 'absolute', left: s.x - 17, top: SY - 16, width: 34, height: 34, alignItems: 'center', opacity: s.inv > 0 && Math.floor(s.t * 14) % 2 ? 0.3 : 1 }}>
          <View style={{ width: 0, height: 0, borderLeftWidth: 17, borderRightWidth: 17, borderBottomWidth: 28, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: C.lime, ...glow(C.lime, 8, 0.9) }} />
          <View style={{ width: 34, height: 6, backgroundColor: C.lime, borderRadius: 2, marginTop: -1 }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: SY + 22, height: 2, backgroundColor: alpha(C.lime, 0.4) }} />
        {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.45, width: AREA_W, textAlign: 'center', color: C.text, fontSize: 24, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow(C.lime, 12) }}>{s.banner.text}</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="👽" title={phase === 'over' ? 'INVADIDOS' : 'INVASORES'}
          subtitle={phase === 'over' ? `Llegaste a la oleada ${s.wave}` : 'Defiende la Tierra'}
          score={s.score} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para mover · disparo automático', 'Los escudos verdes te protegen (y se desgastan)', '🛸 pasa de vez en cuando: ¡puntos extra!', 'Si los invasores bajan hasta los escudos, pierdes'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ─── SKY HOP ──────────────────────────────────────────────────────
function SkyHop({ onExit }) {
  const PW = 64, PH = 14, BODY = 30;
  const fx = useFX();
  const [best, submitBest] = useBest('skyhop');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const stars = useRef(makeStars(30)).current;
  const initState = () => {
    const s = { p: { x: AREA_W / 2, y: AREA_H - 90, vy: -620, face: 1 }, tx: AREA_W / 2, cam: 0, plats: [], mons: [], items: [], top: AREA_H - 60, t: 0, score: 0, bonus: 0, jet: 0, maxH: 0 };
    s.plats.push({ id: uid(), x: AREA_W / 2 - PW / 2, y: AREA_H - 60, k: 'n', ph: 0 });
    return s;
  };
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const gen = s => {
    const h = Math.max(0, -s.top + AREA_H);
    while (s.top > s.cam - AREA_H) {
      const gap = rand(58, 80 + Math.min(34, h / 60));
      s.top -= gap;
      const r = Math.random(); const level = Math.min(1, h / 3000);
      const k = r < 0.12 + level * 0.1 ? 'm' : r < 0.2 + level * 0.18 ? 'b' : r < 0.26 + level * 0.18 ? 's' : 'n';
      const pl = { id: uid(), x: rand(8, AREA_W - PW - 8), y: s.top, k, ph: Math.random() * 6, dx: rand(50, 90) * (Math.random() < 0.5 ? 1 : -1) };
      s.plats.push(pl);
      if (h > 500 && k === 'n' && Math.random() < 0.12) s.mons.push({ id: uid(), x: pl.x + 14, y: pl.y - 32, alive: true });
      else if (Math.random() < 0.07) s.items.push({ id: uid(), x: pl.x + 20, y: pl.y - 30, kind: Math.random() < 0.35 ? 'jet' : 'star', got: false });
    }
  };
  const die = s => { hx.die(); fx.shake(8, 0.3); fx.flash(C.red, 0.3); setRes({ isNew: submitBest(Math.floor(s.score + s.bonus)) }); setPhase('over'); };
  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p; s.t += dt;
    gen(s);
    p.x += (s.tx - p.x) * Math.min(1, dt * 12);
    if (s.tx - p.x > 1) p.face = 1; else if (s.tx - p.x < -1) p.face = -1;
    if (p.x < -10) { p.x += AREA_W + 20; s.tx += AREA_W + 20; } if (p.x > AREA_W + 10) { p.x -= AREA_W + 20; s.tx -= AREA_W + 20; }
    const prevBottom = p.y + BODY;
    if (s.jet > 0) { s.jet -= dt; p.vy = -760; if (Math.random() < dt * 40) fx.burst(p.x, p.y + BODY, C.orange, 2, 90, 0.3, 4); } else p.vy += 1500 * dt;
    p.y += p.vy * dt;
    s.plats.forEach(pl => { if (pl.k === 'm') { pl.x += pl.dx * dt; if (pl.x < 4 || pl.x > AREA_W - PW - 4) pl.dx *= -1; } });
    if (p.vy > 0 && s.jet <= 0) {
      for (const pl of s.plats) {
        if (pl.broken) continue;
        if (p.x + 10 > pl.x && p.x - 10 < pl.x + PW && prevBottom <= pl.y + 6 && p.y + BODY >= pl.y) {
          if (pl.k === 'b') { pl.broken = true; fx.burst(pl.x + PW / 2, pl.y, '#c08c52', 8, 160); hx.tick(); continue; }
          p.y = pl.y - BODY; p.vy = pl.k === 's' ? -1000 : -640; hx.tap();
          fx.burst(p.x, p.y + BODY, pl.k === 's' ? C.amber : C.lime, 4, 90, 0.3, 3); if (pl.k === 's') fx.ring(p.x, p.y + BODY, C.amber, 40);
          break;
        }
      }
    }
    for (const m of s.mons) {
      if (!m.alive) continue;
      if (Math.abs(p.x - (m.x + 14)) < 22 && Math.abs(p.y + BODY / 2 - (m.y + 14)) < 24) {
        if (p.vy > 100 && prevBottom <= m.y + 14 && s.jet <= 0) { m.alive = false; p.vy = -700; s.bonus += 50; fx.burst(m.x + 14, m.y + 14, C.amber, 12, 220); fx.pop(m.x + 14, m.y, '+50', C.text, 16); hx.hit(); }
        else if (s.jet > 0) { m.alive = false; s.bonus += 50; fx.burst(m.x + 14, m.y + 14, C.amber, 12, 220); }
        else { die(s); return; }
      }
    }
    for (const it of s.items) {
      if (!it.got && Math.abs(p.x - (it.x + 12)) < 24 && Math.abs(p.y + BODY / 2 - (it.y + 12)) < 28) {
        it.got = true; hx.good();
        if (it.kind === 'jet') { s.jet = 1.6; fx.pop(it.x, it.y - 6, '¡COHETE!', C.orange, 16); } else { s.bonus += 25; fx.pop(it.x, it.y - 6, '+25', C.amber, 15); }
        fx.ring(it.x + 12 - 0, it.y - s.cam, C.lime, 40);
      }
    }
    s.cam = Math.min(s.cam, p.y - AREA_H * 0.42);
    s.maxH = Math.max(s.maxH, -s.cam);
    s.score = s.maxH / 10;
    s.plats = s.plats.filter(pl => pl.y < s.cam + AREA_H + 60); s.mons = s.mons.filter(m => m.y < s.cam + AREA_H + 60); s.items = s.items.filter(i => i.y < s.cam + AREA_H + 60);
    if (p.y > s.cam + AREA_H + 20) die(s);
  });
  const pan = usePan(fx, { down: x => { g.current.tx = clamp(x, 0, AREA_W); }, move: x => { g.current.tx = clamp(x, 0, AREA_W); } });
  const s = g.current; const p = s.p; const sc = Math.floor(s.score + s.bonus);
  const cam = s.cam;
  return (
    <GameScreen title="SKY HOP" emoji="🦘" accent={C.cyan} onExit={onExit} score={sc} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Altura <Text style={{ color: C.cyan, fontWeight: '900' }}>{Math.floor(s.score)} m</Text></Text><Text style={{ color: C.orange, fontWeight: '900', fontSize: 12 }}>{s.jet > 0 ? '🚀 PROPULSIÓN' : ''}</Text><Text style={{ color: C.dim, fontSize: 12 }}>Toca y arrastra</Text></>}>
      <PlayArea fx={fx} bg="#05102a" border={alpha(C.cyan, 0.35)} {...pan}>
        <Starfield stars={stars} offset={-cam * 0.15} />
        {s.plats.map(pl => !pl.broken && <View key={pl.id} style={{ position: 'absolute', left: pl.x, top: pl.y - cam, width: PW, height: PH, borderRadius: 7, backgroundColor: pl.k === 'm' ? alpha(C.blue, 0.4) : pl.k === 'b' ? alpha('#c08c52', 0.5) : pl.k === 's' ? alpha(C.amber, 0.35) : alpha(C.lime, 0.3), borderWidth: 2, borderColor: pl.k === 'm' ? C.blue : pl.k === 'b' ? '#c08c52' : pl.k === 's' ? C.amber : C.lime, ...glow(pl.k === 'm' ? C.blue : pl.k === 'b' ? '#c08c52' : pl.k === 's' ? C.amber : C.lime, 6, 0.6) }}>{pl.k === 's' && <Text style={{ position: 'absolute', top: -14, left: PW / 2 - 9, fontSize: 16 }}>🔶</Text>}</View>)}
        {s.items.map(it => !it.got && <Text key={it.id} style={{ position: 'absolute', left: it.x, top: it.y - cam, fontSize: 24, ...tglow(C.amber, 8) }}>{it.kind === 'jet' ? '🚀' : '⭐'}</Text>)}
        {s.mons.map(m => m.alive && <Text key={m.id} style={{ position: 'absolute', left: m.x, top: m.y - cam, fontSize: 28 }}>👾</Text>)}
        <Text style={{ position: 'absolute', left: p.x - 20, top: p.y - cam - 6, width: 40, textAlign: 'center', fontSize: 34, lineHeight: 40, transform: [{ scaleX: p.face }, { scaleY: p.vy < 0 ? 1.1 : 0.95 }], ...tglow(C.cyan, 8) }}>🦘</Text>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🦘" title={phase === 'over' ? 'CAÍSTE' : 'SKY HOP'}
          subtitle={phase === 'over' ? `Subiste ${Math.floor(s.score)} metros` : 'Salta sin parar hacia el cielo'}
          score={sc} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra el dedo para mover a izquierda y derecha', 'Rebota en las plataformas · 🔶 resortes dan más impulso', 'Marrón: se rompe · azul: se mueve', 'Cae sobre los 👾 para aplastarlos · 🚀 te propulsa'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ─── BUSCAMINAS ───────────────────────────────────────────────────
const MS_LEVELS = { easy: { c: 8, r: 10, m: 10, base: 500, name: 'Fácil' }, med: { c: 9, r: 12, m: 20, base: 1100, name: 'Medio' }, hard: { c: 10, r: 14, m: 36, base: 2200, name: 'Difícil' } };
const MS_COLORS = ['', '#4d8bff', '#7dff6b', '#ff4d6d', '#9b6bff', '#ff8a3d', '#22e6ff', '#ffffff', '#8b92b8'];
function Buscaminas({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('minesweeper');
  const [phase, setPhase] = useState('ready');
  const [level, setLevel] = useState('easy');
  const [res, setRes] = useState({ isNew: false, won: false, pts: 0 });
  const [, force] = useReducer(x => x + 1, 0);
  const initState = lv => { const L = MS_LEVELS[lv]; return { L, cells: Array.from({ length: L.c * L.r }, () => ({ mine: false, open: false, flag: false, n: 0 })), placed: false, mode: 'dig', t: 0, flags: 0, opened: 0, over: false }; };
  const g = useRef(null);
  if (!g.current) g.current = initState('easy');
  const start = () => { fx.clear(); g.current = initState(level); setPhase('play'); };
  const nb = (s, i) => { const { c, r } = s.L; const x = i % c, y = Math.floor(i / c); const o = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < c && ny < r) o.push(ny * c + nx); } return o; };
  const place = (s, safe) => {
    const banned = new Set([safe, ...nb(s, safe)]); let n = 0;
    while (n < s.L.m) { const i = randInt(0, s.cells.length - 1); if (banned.has(i) || s.cells[i].mine) continue; s.cells[i].mine = true; n++; }
    s.cells.forEach((cl, i) => { cl.n = nb(s, i).filter(j => s.cells[j].mine).length; }); s.placed = true;
  };
  const finish = (s, won) => {
    s.over = true;
    if (won) {
      const pts = Math.max(50, Math.round(s.L.base - s.t * (s.L.base / 400)));
      hx.win(); fx.flash('#fff', 0.3); for (let k = 0; k < 5; k++) fx.burst(rand(30, AREA_W - 30), rand(60, 300), pick([C.cyan, C.pink, C.amber, C.lime]), 16, 260, 0.9, 5);
      setRes({ isNew: submitBest(pts), won: true, pts });
    } else { hx.die(); fx.shake(9, 0.4); fx.flash(C.red, 0.3); s.cells.forEach(cl => { if (cl.mine) cl.open = true; }); setRes({ isNew: false, won: false, pts: 0 }); }
    setTimeout(() => setPhase(won ? 'win' : 'over'), won ? 700 : 1100);
    force();
  };
  const open = (s, i) => {
    const q = [i];
    while (q.length) {
      const j = q.pop(); const cl = s.cells[j];
      if (cl.open || cl.flag) continue;
      cl.open = true; s.opened += 1;
      if (cl.n === 0 && !cl.mine) nb(s, j).forEach(k => { if (!s.cells[k].open) q.push(k); });
    }
  };
  const tap = i => {
    const s = g.current; if (phase !== 'play' || s.over) return;
    const cl = s.cells[i];
    if (s.mode === 'flag' && !cl.open) { cl.flag = !cl.flag; s.flags += cl.flag ? 1 : -1; hx.tick(); force(); return; }
    if (cl.open) { // acorde
      if (cl.n > 0 && nb(s, i).filter(j => s.cells[j].flag).length === cl.n) { nb(s, i).forEach(j => { const c2 = s.cells[j]; if (!c2.flag && !c2.open) { if (c2.mine) { c2.open = true; finish(s, false); } else open(s, j); } }); hx.tap(); }
    } else if (!cl.flag) {
      if (!s.placed) place(s, i);
      if (cl.mine) { cl.open = true; fx.burst(0, 0, C.red, 1); finish(s, false); return; }
      open(s, i); hx.tap();
    }
    if (!s.over && s.opened >= s.cells.length - s.L.m) finish(s, true);
    force();
  };
  const longPress = i => { const s = g.current; if (phase !== 'play' || s.over || s.cells[i].open) return; const cl = s.cells[i]; cl.flag = !cl.flag; s.flags += cl.flag ? 1 : -1; hx.hit(); force(); };
  useLoop(phase === 'play', dt => { const s = g.current; if (s.placed && !s.over) s.t += dt; });
  const s = g.current; const { c, r } = s.L;
  const cs = Math.min(Math.floor((AREA_W - 16) / c), Math.floor((AREA_H - 74) / r));
  const bx = (AREA_W - cs * c) / 2;
  const mins = Math.floor(s.t / 60), secs = Math.floor(s.t % 60);
  return (
    <GameScreen title="BUSCAMINAS" emoji="💣" accent={C.red} onExit={onExit} score={res.pts || 0} best={best}
      hud={<><Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>🚩 {s.L.m - s.flags}</Text><Text style={{ color: C.dim, fontSize: 12 }}>{s.L.name} · {c}×{r}</Text><Text style={{ color: C.text, fontWeight: '900', fontSize: 14 }}>⏱ {mins}:{String(secs).padStart(2, '0')}</Text></>}>
      <PlayArea fx={fx} bg="#0c0508" border={alpha(C.red, 0.35)}>
        <View style={{ position: 'absolute', left: bx, top: 10, width: cs * c, height: cs * r }}>
          {s.cells.map((cl, i) => {
            const x = (i % c) * cs, y = Math.floor(i / c) * cs;
            return (
              <Pressable key={i} testID={`ms-${i}`} onPress={() => tap(i)} onLongPress={() => longPress(i)} delayLongPress={260} style={{ position: 'absolute', left: x, top: y, width: cs, height: cs, padding: 1.5 }}>
                <View style={{ flex: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: cl.open ? (cl.mine ? alpha(C.red, 0.5) : 'rgba(255,255,255,0.04)') : alpha(C.red, 0.16), borderWidth: 1.5, borderColor: cl.open ? 'rgba(255,255,255,0.06)' : alpha(C.red, 0.5) }}>
                  {cl.open ? (cl.mine ? <Text style={{ fontSize: cs * 0.55 }}>💣</Text> : cl.n > 0 ? <Text style={{ color: MS_COLORS[cl.n], fontWeight: '900', fontSize: cs * 0.55 }}>{cl.n}</Text> : null) : cl.flag ? <Text style={{ fontSize: cs * 0.5 }}>🚩</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 10, flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
          <Btn testID="ms-dig" label="⛏️ EXCAVAR" small ghost={s.mode !== 'dig'} color={C.cyan} onPress={() => { s.mode = 'dig'; hx.tick(); force(); }} />
          <Btn testID="ms-flag" label="🚩 BANDERA" small ghost={s.mode !== 'flag'} color={C.amber} onPress={() => { s.mode = 'flag'; hx.tick(); force(); }} />
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'win' ? '🏆' : phase === 'over' ? '💥' : '💣'} title={phase === 'win' ? '¡DESPEJADO!' : phase === 'over' ? '¡BOOM!' : 'BUSCAMINAS'}
          subtitle={phase === 'win' ? `${mins}:${String(secs).padStart(2, '0')} · ${s.L.name}` : phase === 'over' ? 'Pisaste una mina' : 'Descubre todo sin tocar las minas'}
          score={res.pts} best={best} isNew={res.isNew} accent={C.red} onStart={start} onExit={onExit}
          extra={<View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>{Object.entries(MS_LEVELS).map(([k, v]) => <Btn key={k} testID={`lv-${k}`} label={v.name} small ghost={level !== k} color={C.red} onPress={() => setLevel(k)} />)}</View>}
          lines={phase === 'ready' ? ['Toca para excavar · mantén pulsado para poner bandera', 'El número indica minas vecinas', 'Toca un número con sus banderas para abrir alrededor', 'La primera casilla siempre es segura'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

// ─── 4 EN LÍNEA ───────────────────────────────────────────────────
function Connect4({ onExit }) {
  const NC = 7, NR = 6;
  const cs = Math.min(Math.floor((AREA_W - 20) / NC), 62);
  const bx = (AREA_W - cs * NC) / 2, by = 70;
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('connect4');
  const [phase, setPhase] = useState('ready');          // ready | play | win | over
  const [res, setRes] = useState({ isNew: false, draw: false });
  const initState = (lvl, score) => ({ b: Array.from({ length: NR }, () => Array(NC).fill(0)), turn: 1, level: lvl, score, anim: null, line: null, busy: false, t: 0, msg: 'Tu turno' });
  const g = useRef(null);
  if (!g.current) g.current = initState(1, 0);
  const start = () => { fx.clear(); g.current = initState(1, 0); setPhase('play'); };
  const nextRound = () => { const s = g.current; g.current = initState(s.level + 1, s.score); setPhase('play'); };
  const dropRow = (b, c) => { for (let r = NR - 1; r >= 0; r--) if (!b[r][c]) return r; return -1; };
  const winLine = (b, p) => {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) { if (b[r][c] !== p) continue; for (const [dr, dc] of dirs) { const cells = [[r, c]]; for (let k = 1; k < 4; k++) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || rr >= NR || cc < 0 || cc >= NC || b[rr][cc] !== p) break; cells.push([rr, cc]); } if (cells.length === 4) return cells; } }
    return null;
  };
  const full = b => b[0].every(Boolean);
  const evalBoard = (b) => {
    let sc = 0; const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < NR; r++) sc += (b[r][3] === 2 ? 3 : b[r][3] === 1 ? -3 : 0);
    for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) for (const [dr, dc] of dirs) {
      let a = 0, h = 0, e = 0; let ok = true;
      for (let k = 0; k < 4; k++) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || rr >= NR || cc < 0 || cc >= NC) { ok = false; break; } const v = b[rr][cc]; if (v === 2) a++; else if (v === 1) h++; else e++; }
      if (!ok) continue;
      if (a && !h) sc += a === 3 ? 5 : a === 2 ? 2 : 0; if (h && !a) sc -= h === 3 ? 6 : h === 2 ? 2 : 0;
    }
    return sc;
  };
  const minimax = (b, depth, alpha_, beta, maxing) => {
    if (winLine(b, 2)) return 100000 + depth; if (winLine(b, 1)) return -100000 - depth;
    if (full(b) || depth === 0) return evalBoard(b);
    const order = [3, 2, 4, 1, 5, 0, 6];
    if (maxing) { let v = -Infinity; for (const c of order) { const r = dropRow(b, c); if (r < 0) continue; b[r][c] = 2; v = Math.max(v, minimax(b, depth - 1, alpha_, beta, false)); b[r][c] = 0; alpha_ = Math.max(alpha_, v); if (alpha_ >= beta) break; } return v; }
    let v = Infinity; for (const c of order) { const r = dropRow(b, c); if (r < 0) continue; b[r][c] = 1; v = Math.min(v, minimax(b, depth - 1, alpha_, beta, true)); b[r][c] = 0; beta = Math.min(beta, v); if (alpha_ >= beta) break; } return v;
  };
  const aiMove = s => {
    const depth = Math.min(7, 1 + s.level);
    let bestC = -1, bestV = -Infinity; const order = [3, 2, 4, 1, 5, 0, 6].sort(() => Math.random() - 0.5);
    for (const c of order) { const r = dropRow(s.b, c); if (r < 0) continue; s.b[r][c] = 2; const v = minimax(s.b, depth - 1, -Infinity, Infinity, false) + (Math.random() < 0.15 && s.level < 3 ? rand(-30, 30) : 0); s.b[r][c] = 0; if (v > bestV) { bestV = v; bestC = c; } }
    return bestC;
  };
  const place = (c, who) => { const s = g.current; const r = dropRow(s.b, c); if (r < 0) return false; s.anim = { c, r, who, y: by - cs, vy: 0 }; s.busy = true; return true; };
  const land = () => {
    const s = g.current; const { c, r, who } = s.anim; s.b[r][c] = who; s.anim = null; hx.tap();
    fx.burst(bx + c * cs + cs / 2, by + r * cs + cs, who === 1 ? C.red : C.amber, 5, 110, 0.3, 3);
    const line = winLine(s.b, who);
    if (line) {
      s.line = line; s.busy = true;
      if (who === 1) {
        const empties = s.b.flat().filter(v => !v).length; const pts = 100 * s.level + empties * 10; s.score += pts; hx.win(); fx.flash('#fff', 0.25); fx.pop(AREA_W / 2, 36, `+${pts}`, C.lime, 24);
        submitBest(s.score); later(() => setPhase('win'), 1000);
      } else { hx.die(); later(() => { setRes({ isNew: submitBest(s.score), draw: false }); setPhase('over'); }, 1100); }
      return;
    }
    if (full(s.b)) { s.score += 30; later(() => { setRes({ isNew: submitBest(s.score), draw: true }); setPhase('over'); }, 600); return; }
    if (who === 1) { s.turn = 2; s.msg = 'Pensando…'; later(() => { const c2 = aiMove(s); place(c2, 2); }, 350); } else { s.turn = 1; s.msg = 'Tu turno'; s.busy = false; }
  };
  const pan = usePan(fx, { down: x => { const s = g.current; if (phase !== 'play' || s.busy || s.turn !== 1) return; const c = Math.floor((x - bx) / cs); if (c < 0 || c >= NC) return; if (!place(c, 1)) hx.bad(); } });
  useLoop(phase !== 'ready', dt => {
    const s = g.current; s.t += dt;
    if (s.anim) { const a = s.anim; a.vy += 2600 * dt; a.y += a.vy * dt; const ty = by + a.r * cs; if (a.y >= ty) { a.y = ty; land(); } }
  });
  const s = g.current;
  return (
    <GameScreen title="4 EN LÍNEA" emoji="🔴" accent={C.red} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Ronda <Text style={{ color: C.red, fontWeight: '900' }}>{s.level}</Text></Text><Text style={{ color: s.turn === 1 ? C.red : C.amber, fontWeight: '900', fontSize: 13 }}>{phase === 'play' ? s.msg : ''}</Text><Text style={{ color: C.dim, fontSize: 12 }}>IA nivel {Math.min(7, 1 + s.level)}</Text></>}>
      <PlayArea fx={fx} bg="#0a0510" border={alpha(C.red, 0.35)} {...pan}>
        <View style={{ position: 'absolute', left: bx - 6, top: by - 6, width: cs * NC + 12, height: cs * NR + 12, borderRadius: 16, backgroundColor: alpha(C.blue, 0.18), borderWidth: 3, borderColor: alpha(C.blue, 0.8), ...glow(C.blue, 12, 0.5) }} />
        {s.b.map((row, r) => row.map((v, c) => (
          <View key={`${r}-${c}`} style={{ position: 'absolute', left: bx + c * cs + 4, top: by + r * cs + 4, width: cs - 8, height: cs - 8, borderRadius: cs, backgroundColor: v ? (v === 1 ? C.red : C.amber) : 'rgba(0,0,0,0.55)', borderWidth: 2, borderColor: v ? '#fff6' : alpha(C.blue, 0.4), ...(v ? glow(v === 1 ? C.red : C.amber, 8, 0.6) : null) }} />
        )))}
        {s.anim && <View style={{ position: 'absolute', left: bx + s.anim.c * cs + 4, top: s.anim.y + 4, width: cs - 8, height: cs - 8, borderRadius: cs, backgroundColor: s.anim.who === 1 ? C.red : C.amber, borderWidth: 2, borderColor: '#fff6' }} />}
        {s.line && s.line.map(([r, c], i) => <View key={`w${i}`} style={{ position: 'absolute', left: bx + c * cs + 1, top: by + r * cs + 1, width: cs - 2, height: cs - 2, borderRadius: cs, borderWidth: 4, borderColor: '#fff', opacity: 0.6 + Math.sin(s.t * 10) * 0.4 }} />)}
        {phase === 'play' && !s.busy && <Text pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: by + NR * cs + 18, textAlign: 'center', color: alpha(C.dim, 0.8), fontSize: 12, fontWeight: '700' }}>Toca una columna para soltar tu ficha</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'win' ? '🏆' : phase === 'over' ? (res.draw ? '🤝' : '💀') : '🔴'} title={phase === 'win' ? `¡RONDA ${s.level} GANADA!` : phase === 'over' ? (res.draw ? 'EMPATE' : 'PERDISTE') : '4 EN LÍNEA'}
          subtitle={phase === 'win' ? `La IA sube a nivel ${Math.min(7, 2 + s.level)}` : phase === 'over' ? `Llegaste a la ronda ${s.level}` : 'Conecta cuatro fichas contra la IA'}
          score={s.score} best={best} isNew={res.isNew} accent={C.red} startLabel={phase === 'win' ? 'SIGUIENTE RONDA' : undefined} onStart={phase === 'win' ? nextRound : start} onExit={onExit}
          lines={phase === 'ready' ? ['Alinea 4 fichas en horizontal, vertical o diagonal', 'Cada victoria sube el nivel de la IA', 'Ganar con el tablero más vacío da más puntos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}

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
const arenaCreate = o => createArena({ ...o, W: AREA_W, H: AREA_H });
function Arena3D({ sprites, bg, shake }) {
  const store = useRef({}).current;
  store.sprites = sprites; store.bg = bg; store.shake = shake;
  const getState = useRef(() => store).current;
  const [fail, setFail] = useState(null);
  if (fail != null || !getGLView()) return <NoGL accent={C.cyan} err={fail || ''} onRetry={fail != null ? () => setFail(null) : null} />;
  return <GL3D create={arenaCreate} getState={getState} onFail={m => setFail(m || 'error')} />;
}

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
  { id: 'openworld', name: 'MUNDO 3D', emoji: '🌍', tag: 'Mundo abierto en primera persona', color: C.lime, cat: 'aventura', Comp: OpenWorld3D },
  { id: 'moto3d', name: 'MOTO 3D', emoji: '🏍️', tag: 'Autopista 3D en primera persona', color: C.orange, cat: 'accion', Comp: Moto3D },
  { id: 'plane3d', name: 'AVIÓN 3D', emoji: '✈️', tag: 'Vuela por un cañón en primera persona', color: C.blue, cat: 'accion', Comp: Plane3D },
  { id: 'invaders', name: 'INVASORES', emoji: '👽', tag: 'Defiende la Tierra con escudos', color: C.lime, cat: 'accion', Comp: Invaders },
  { id: 'skyhop', name: 'SKY HOP', emoji: '🦘', tag: 'Rebota hacia el cielo sin caer', color: C.cyan, cat: 'reflejos', Comp: SkyHop },
  { id: 'minesweeper', name: 'BUSCAMINAS', emoji: '💣', tag: 'Despeja el campo con lógica', color: C.red, cat: 'puzzle', Comp: Buscaminas },
  { id: 'connect4', name: '4 EN LÍNEA', emoji: '🔴', tag: 'Conecta cuatro contra la IA', color: C.red, cat: 'puzzle', Comp: Connect4 },
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
