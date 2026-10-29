import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Bar, C, Combo, Lives, SCREEN_H, SCREEN_W, clamp, hx, rand, tglow, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { enemy, ship } from '../utils/prefabs';
import { project } from '../utils/openworld';

// NEON GALAXY 3D – shooter espacial en TERCERA PERSONA. Récord: 'neon'.
// La nave está en z=0 y la cámara detrás; los enemigos nacen lejos (z negativo) y vienen hacia ti.
// Arrastra para mover la nave · disparo automático · oleadas y un jefe cada 5 oleadas.
// Power-ups: ⚡ arma (más disparos) · 🛡️ escudo · ❤️ vida · 💣 bomba (limpia la pantalla).
const NG_XH = 2.6;            // límite lateral de la nave
const NG_FAR = -64;           // profundidad de aparición de enemigos
const NG_BOSS_Z = -30;        // el jefe se planta a esta profundidad
const NG_BULLET_V = 62;       // velocidad de los disparos (u/s, hacia el fondo)
const ENEMY = {
  drone: { hp: 1, r: 0.65, vz: 9.5, pts: 10, c: C.pink },
  zig: { hp: 2, r: 0.7, vz: 8, pts: 20, c: C.cyan },
  tank: { hp: 6, r: 1.0, vz: 4.5, pts: 50, c: C.orange },
  kami: { hp: 1, r: 0.6, vz: 20, pts: 30, c: C.red },
};
const IC = { W: C.amber, S: C.cyan, H: C.red, B: C.orange };
const hsh = n => { const v = Math.sin(n * 91.3458) * 47453.5453; return v - Math.floor(v); };

// cámara de tercera persona: sigue a la nave con retardo (cx suaviza el movimiento)
const ngCam = cx => ({ p: [cx * 0.4, 2.9, 9.5], l: [cx * 0.25, 0.3, -12], fov: 58 });
// punto 3D → píxel de la pantalla completa (textos 2D y efectos)
const scr = (s, x, y, z) => { const q = project(ngCam(s.cx), [x, y, z], SCREEN_W, SCREEN_H); return q ? [q.x, q.y] : [SCREEN_W / 2, SCREEN_H / 2]; };

// decorado FIJO (se calcula una vez): suelo de rejilla de neón bajo la nave y un planeta con anillos
const NG_STATIC = (() => {
  const out = [
    { id: 'ng-suelo', k: 'pla', p: [0, -2.6, -30], s: [260, 260, 1], c: '#07031a', recv: true, m: { r: 0.9, m: 0 } },
    { id: 'ng-planeta', k: 'sph', p: [-24, 9, -74], n: 16, c: '#3a1c6e', e: 0.12 },
    { id: 'ng-anillo', k: 'ring', p: [-24, 9, -74], s: [40, 40, 1], r: [1.1, 0, 0.3], c: C.pink, e: 0.7, o: 0.8 },
  ];
  for (let x = -48; x <= 48; x += 4) out.push({ k: 'box', inst: 'ng-rejilla', p: [x, -2.58, -30], s: [0.05, 0.02, 260], c: C.violet, e: 0.9 });
  for (let z = -130; z <= 20; z += 8) out.push({ k: 'box', inst: 'ng-rejilla', p: [0, -2.58, z], s: [260, 0.02, 0.05], c: C.violet, e: 0.9 });
  return out;
})();

// estrellas que pasan hacia ti (instancing: sin ids, miles a coste bajo)
const ngStars = t => Array.from({ length: 64 }, (_, i) => {
  const z = -74 + ((hsh(i + 7) * 78 + t * 26) % 78);
  return { k: 'sph', inst: 'ng-estrella', p: [(hsh(i) * 2 - 1) * 26, hsh(i + 3) * 17 - 4, z], n: 0.1 + hsh(i + 11) * 0.12, c: i % 6 === 0 ? C.cyan : '#e6f1ff', e: 1 };
});

const dropItem = (s, x, y, z, force) => {
  if (!force && Math.random() > 0.13) return;
  const r = Math.random();
  const type = r < 0.38 ? 'W' : r < 0.62 ? 'S' : r < 0.82 ? 'H' : 'B';
  s.items.push({ id: uid(), x, y, z, type });
};

// Enemigos con prefabs del motor. Frente de cada prefab = -Z; los enemigos vienen hacia la cámara (+Z),
// así que los que tienen "cara" (robot, nave kamikaze) se giran 180° para mirar hacia ti.
const enemyObjs = (e, t) => {
  const id = `en${e.id}`, ph = e.ph, flash = e.hitT > 0;
  if (e.type === 'drone') return enemy(id, 'ovni', [e.x, e.y, e.z], { c: C.pink, n: 0.5, t: t + ph, flash, sh: false, inst: 'ng-dron' });
  if (e.type === 'zig') return enemy(id, 'fantasma', [e.x, e.y - 0.9, e.z], { c: '#8ef3ff', n: 0.8, t: t + ph, flash, sh: false, inst: 'ng-zig' });
  if (e.type === 'tank') return enemy(id, 'robot', [e.x, e.y - 1.25, e.z], { c: '#ffb13d', n: 1.25, yaw: Math.PI, walk: 0.7, t: t + ph, flash, sh: false, inst: 'ng-tanque' });
  return ship(id, [e.x, e.y, e.z], { c: '#ffd0da', c2: '#ffd166', thrust: 1, yaw: Math.PI, n: 0.42, t, flash, sh: false, inst: 'ng-kami' });
};

// jefe: un ovni enorme con un anillo de neón que gira
const bossObjs = (bs, t) => [
  ...enemy('ng-jefe', 'ovni', [bs.x, bs.y, bs.z], { c: '#ffb13d', n: 3.4, t, flash: bs.hitT > 0, sh: false }),
  { id: 'ng-jefe-anillo', k: 'tor', p: [bs.x, bs.y, bs.z], n: 6.2, r: [0.25, t, 0], c: C.pink, e: 0.9 },
];

// nave del jugador: parpadea tras un golpe, se inclina al moverse y lleva escudo cuando lo tiene
const shipObjs = (s, t) => {
  const out = [];
  const blink = s.inv > 0 && Math.floor(s.t * 14) % 2 === 1;
  if (!s.dead && !blink) out.push(...ship('nave', [s.x, 0, 0], { c: '#e4eaff', c2: C.pink, thrust: 0.9, t, n: 0.85, roll: clamp((s.tx - s.x) * -0.2, -0.4, 0.4), flash: s.inv > 1.3 }));
  if (!s.dead && s.shield > 0) out.push({ id: 'nave-escudo', k: 'sph', p: [s.x, 0, 0], n: 2.6, c: C.cyan, o: 0.16 + 0.05 * Math.sin(t * 6), e: 0.6 });
  return out;
};

// Escena completa en un instante t (se usa para jugar y para el fondo animado de los menús)
const buildScene = (s, t) => {
  const objs = [
    ...ngStars(t),
    ...s.enemies.flatMap(e => enemyObjs(e, t)),
    ...s.bullets.map(b => ({ k: 'box', inst: 'ng-bala', p: [b.x, b.y, b.z], s: [0.12, 0.12, 1.5], c: C.cyan, e: 1 })),
    ...s.eb.map(b => ({ k: 'sph', inst: 'ng-ebala', p: [b.x, b.y, b.z], n: 0.42, c: C.pink, e: 1 })),
    ...s.items.map(it => ({ id: `it${it.id}`, k: 'oct', p: [it.x, it.y, it.z], n: 0.8, r: [0, t * 2.2, 0.4], c: IC[it.type], e: 0.95 })),
    ...(s.boss ? bossObjs(s.boss, t) : []),
    ...shipObjs(s, t),
  ];
  return {
    sky: { top: '#02010a', bottom: '#15093f', sun: false, clouds: 0 },
    fog: { c: '#15093f', near: 30, far: 115 },
    light: { dir: [-0.45, 0.8, 0.4], sun: '#e8efff', i: 2.1, sky: '#8ea0ff', ground: '#1a0d3a', hi: 1.3 },
    shadowR: 26,
    statics: NG_STATIC,
    lights: [{ p: [s.cx * 0.5, 1.6, 2.5], c: '#22e6ff', i: 7, d: 12 }],
    objs,
    cam: ngCam(s.cx),
  };
};

const initState = () => ({
  x: 0, tx: 0, cx: 0, score: 0, lives: 3, shield: 0, weapon: 1, fireT: 0,
  enemies: [], bullets: [], eb: [], items: [], wave: 0, queue: [], spawnT: 0, gap: 0,
  banner: null, combo: 0, comboT: 0, boss: null, t: 0, inv: 0, kills: 0, dead: false, over: false,
});

export function NeonGalaxy3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('neon');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, wave: 0, kills: 0, weapon: 1 });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const nextWave = s => {
    s.wave += 1;
    s.gap = 0;
    if (s.wave % 5 === 0) {
      s.banner = { text: `⚠ JEFE · OLEADA ${s.wave}`, t: 2.2 };
      const hp = 28 + s.wave * 5;
      s.boss = { x: 0, y: 1.4, z: NG_FAR, r: 3.0, hp, max: hp, t: 0, fire: 1.5, hitT: 0 };
      s.queue = [];
      hx.warn();
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
    clear3d();
    g.current = initState();
    nextWave(g.current);
    setPhase('play');
    hx.tap();
  };

  const finish = s => {
    if (s.over) return;
    s.over = true; s.dead = true;
    s.enemies = []; s.bullets = []; s.eb = []; s.items = []; s.boss = null;
    burst3d([s.x, 0, 0], ['#ff4d6d', '#ffc233', '#ffffff'], 70, { speed: 11, size: 0.3, life: 1.5, g: 3 });
    ring3d([s.x, 0, 0], C.cyan, 30, { speed: 9, life: 0.9 });
    fx.shake(12, 0.5); fx.flash(C.red, 0.4); hx.die();
    setRes({ isNew: submitBest(s.score), wave: s.wave, kills: s.kills, weapon: s.weapon });
    setPhase('over');
  };

  const hurtPlayer = s => {
    if (s.inv > 0 || s.over) return;
    if (s.shield > 0) {
      s.shield -= 1; s.inv = 0.8;
      ring3d([s.x, 0, 0], C.cyan, 26, { speed: 7, life: 0.6 });
      burst3d([s.x, 0, -0.4], C.cyan, 16, { speed: 6, size: 0.18, life: 0.6 });
      fx.shake(4, 0.2); hx.hit();
      return;
    }
    s.lives -= 1; s.inv = 1.6; s.weapon = Math.max(1, s.weapon - 1); s.combo = 0;
    burst3d([s.x, 0, 0], ['#ff4d6d', '#ffc233', '#ffffff'], 34, { speed: 8, size: 0.24, life: 1, g: 4 });
    ring3d([s.x, 0, 0], C.red, 24, { speed: 6, life: 0.6 });
    fx.shake(10, 0.35); fx.flash(C.red, 0.3); hx.bad();
    if (s.lives <= 0) finish(s);
  };

  const killEnemy = (s, e) => {
    s.combo += 1; s.comboT = 2; s.kills += 1;
    const mult = Math.min(8, 1 + Math.floor(s.combo / 4));
    const pts = ENEMY[e.type].pts * mult;
    s.score += pts;
    burst3d([e.x, e.y, e.z], [ENEMY[e.type].c, '#ffffff', C.amber], 26, { speed: 8, size: 0.22, life: 0.9, g: 3, up: 1 });
    if (e.type === 'tank') { ring3d([e.x, e.y, e.z], C.orange, 22, { speed: 7, life: 0.7, size: 0.2 }); hx.hit(); } else hx.tap();
    const [px, py] = scr(s, e.x, e.y, e.z);
    fx.pop(px, py, `+${pts}`, mult > 1 ? C.amber : C.text, 15);
    dropItem(s, e.x, e.y, e.z, ENEMY[e.type].hp >= 6);
  };

  const bossDown = s => {
    const bs = s.boss;
    s.combo += 5; s.comboT = 2; s.kills += 1;
    const pts = 500 + s.wave * 50;
    s.score += pts;
    burst3d([bs.x, bs.y, bs.z], [C.amber, C.pink, '#ffffff'], 60, { speed: 13, size: 0.32, life: 1.4, g: 3 });
    ring3d([bs.x, bs.y, bs.z], C.amber, 40, { speed: 11, life: 1.0 });
    fx.shake(14, 0.6); fx.flash('#ffffff', 0.4); hx.win();
    const [px, py] = scr(s, bs.x, bs.y, bs.z);
    fx.pop(px, py - 30, `JEFE +${pts}`, C.amber, 20);
    dropItem(s, bs.x, bs.y, bs.z, true);
    dropItem(s, bs.x - 1.2, bs.y, bs.z, true);
    s.eb = [];
    s.boss = null;
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    s.t += dt;
    s.inv = Math.max(0, s.inv - dt);
    s.x += (s.tx - s.x) * Math.min(1, dt * 16);
    s.cx += (s.x - s.cx) * Math.min(1, dt * 4);          // la cámara sigue a la nave con suavidad
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    if (s.comboT > 0) { s.comboT -= dt; if (s.comboT <= 0) s.combo = 0; }
    s.enemies.forEach(e => { e.hitT = Math.max(0, e.hitT - dt); });
    if (s.boss) s.boss.hitT = Math.max(0, s.boss.hitT - dt);

    // disparo automático con destello en la boca del cañón
    s.fireT -= dt;
    if (s.fireT <= 0) {
      s.fireT = s.weapon >= 3 ? 0.19 : 0.23;
      const b = (dx, vx) => s.bullets.push({ id: uid(), x: s.x + dx, y: 0, z: -1.1, vx, vz: -NG_BULLET_V });
      if (s.weapon === 1) b(0, 0);
      else if (s.weapon === 2) { b(-0.45, 0); b(0.45, 0); }
      else { b(0, 0); b(-0.5, -0.9); b(0.5, 0.9); }
      burst3d([s.x, 0, -1.1], C.cyan, 2, { speed: 1.6, size: 0.12, life: 0.22, g: 0 });
    }

    // aparición de enemigos
    if (s.queue.length) {
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        const type = s.queue.shift();
        const d = ENEMY[type];
        s.enemies.push({ id: uid(), type, x: rand(-NG_XH * 0.9, NG_XH * 0.9), y: rand(-0.6, 0.9), z: NG_FAR, hp: d.hp, vz: d.vz + s.wave * 0.3, ph: Math.random() * 6, fire: rand(0.8, 2), hitT: 0 });
        s.spawnT = Math.max(0.28, 0.75 - s.wave * 0.03);
      }
    }

    // jefe: entra en profundidad, se balancea y dispara abanicos hacia la nave
    if (s.boss) {
      const bs = s.boss;
      bs.t += dt;
      bs.z = Math.min(NG_BOSS_Z, bs.z + 9 * dt);
      bs.x = Math.sin(bs.t * 1.1) * (NG_XH * 0.7);
      bs.fire -= dt;
      if (bs.fire <= 0 && bs.z >= NG_BOSS_Z) {
        bs.fire = Math.max(0.7, 1.3 - s.wave * 0.03);
        const n = 3 + Math.min(4, Math.floor(s.wave / 5));
        for (let i = 0; i < n; i++) {
          const sp = (i - (n - 1) / 2) * 0.9;
          s.eb.push({ id: uid(), x: bs.x, y: bs.y, z: bs.z + 4.4, vx: sp, vy: (Math.random() - 0.5) * 0.6, vz: 15 + s.wave * 0.2 });
        }
      }
    }

    // mover enemigos (hacia la cámara)
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i];
      e.z += e.vz * dt;
      if (e.type === 'zig') e.x += Math.sin(s.t * 3 + e.ph) * 0.9 * dt;
      if (e.type === 'kami' && e.z > -20) e.x += clamp(s.x - e.x, -1, 1) * 5 * dt;
      if (e.type === 'tank' && e.z > -25) {
        e.fire -= dt;
        if (e.fire <= 0) { e.fire = 1.7; s.eb.push({ id: uid(), x: e.x, y: e.y, z: e.z + 0.6, vx: 0, vy: 0, vz: 13 }); }
      }
      e.x = clamp(e.x, -NG_XH * 1.1, NG_XH * 1.1);
      if (e.z > 7) { s.enemies.splice(i, 1); s.combo = 0; }
    }

    // proyectiles
    s.bullets.forEach(b => { b.x += b.vx * dt; b.z += b.vz * dt; });
    s.bullets = s.bullets.filter(b => b.z > -72);
    s.eb.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; });
    s.eb = s.eb.filter(b => b.z < 10);
    s.items.forEach(it => { it.z += 9 * dt; });
    s.items = s.items.filter(it => it.z < 9);

    // disparos del jugador vs enemigos / jefe
    for (let j = s.bullets.length - 1; j >= 0; j--) {
      const b = s.bullets[j];
      let used = false;
      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        if (Math.abs(b.z - e.z) < 1.3 && Math.hypot(b.x - e.x, b.y - e.y) < ENEMY[e.type].r + 0.25) {
          e.hp -= 1; e.hitT = 0.12; used = true;
          burst3d([b.x, b.y, b.z], C.cyan, 4, { speed: 4, size: 0.14, life: 0.35, g: 0 });
          if (e.hp <= 0) { killEnemy(s, e); s.enemies.splice(i, 1); }
          break;
        }
      }
      if (!used && s.boss) {
        const bs = s.boss;
        if (Math.abs(b.z - bs.z) < 1.8 && Math.hypot(b.x - bs.x, b.y - bs.y) < bs.r + 1.2) {
          bs.hp -= 1; bs.hitT = 0.12; used = true;
          burst3d([b.x, b.y, b.z], C.amber, 4, { speed: 4, size: 0.16, life: 0.35, g: 0 });
          if (bs.hp <= 0) bossDown(s);
        }
      }
      if (used) s.bullets.splice(j, 1);
    }

    // nave vs enemigos / disparos enemigos / items
    for (let i = s.enemies.length - 1; i >= 0 && !s.over; i--) {
      const e = s.enemies[i];
      if (Math.abs(e.z) < 0.9 && Math.hypot(e.x - s.x, e.y) < ENEMY[e.type].r + 0.55) {
        burst3d([e.x, e.y, e.z], [ENEMY[e.type].c, '#ffffff'], 16, { speed: 7, size: 0.2, life: 0.7, g: 2 });
        s.enemies.splice(i, 1);
        hurtPlayer(s);
      }
    }
    for (let i = s.eb.length - 1; i >= 0 && !s.over; i--) {
      const b = s.eb[i];
      if (Math.abs(b.z) < 0.55 && Math.hypot(b.x - s.x, b.y) < 0.7) { s.eb.splice(i, 1); hurtPlayer(s); }
    }
    for (let i = s.items.length - 1; i >= 0 && !s.over; i--) {
      const it = s.items[i];
      if (Math.abs(it.z) < 1.0 && Math.hypot(it.x - s.x, it.y) < 0.9) {
        s.items.splice(i, 1);
        const [px, py] = scr(s, it.x, it.y, it.z);
        if (it.type === 'W') { s.weapon = Math.min(3, s.weapon + 1); fx.pop(px, py, 'ARMA +', C.amber, 16); hx.good(); }
        if (it.type === 'S') { s.shield = Math.min(3, s.shield + 1); fx.pop(px, py, 'ESCUDO', C.cyan, 16); hx.good(); }
        if (it.type === 'H') { s.lives = Math.min(5, s.lives + 1); fx.pop(px, py, '+1 VIDA', C.red, 16); hx.good(); }
        if (it.type === 'B') {
          ring3d([s.x, 0, 0], C.orange, 40, { speed: 14, life: 0.9, size: 0.25 });
          burst3d([s.x, 0, -2], [C.orange, C.amber, '#ffffff'], 50, { speed: 12, size: 0.28, life: 1.1, g: 2 });
          fx.flash(C.orange, 0.35); fx.shake(8); hx.hit();
          s.eb = [];
          s.enemies.forEach(e => { e.hp -= 4; });
          for (let k = s.enemies.length - 1; k >= 0; k--) if (s.enemies[k].hp <= 0) { killEnemy(s, s.enemies[k]); s.enemies.splice(k, 1); }
          if (s.boss) { s.boss.hp -= 12; s.boss.hitT = 0.12; if (s.boss.hp <= 0) bossDown(s); }
        }
      }
    }

    // siguiente oleada
    if (!s.over && !s.queue.length && !s.enemies.length && !s.boss) {
      s.gap += dt;
      if (s.gap > 1.2) { s.score += 100 * s.wave; fx.pop(SCREEN_W / 2, SCREEN_H * 0.4, `OLEADA SUPERADA +${100 * s.wave}`, C.lime, 16); hx.good(); nextWave(s); }
    }
  });

  // arrastrar: la nave sigue el dedo en x (toda la pantalla -> -NG_XH..NG_XH)
  const toX = x => clamp((x / SCREEN_W - 0.5) * 2 * NG_XH, -NG_XH, NG_XH);
  const pan = usePan(fx, {
    down: x => { g.current.tx = toX(x); },
    move: x => { g.current.tx = toX(x); },
  });

  const s = g.current;
  const mult = Math.min(8, 1 + Math.floor(s.combo / 4));
  const scene = buildScene(s, s.t);

  return (
    <Game3D title="NEON GALAXY" emoji="🚀" accent={C.cyan} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(g.current, t)}
      orbit={{ c: [0, 0, -2], r: 9, h: 2.8, speed: 0.22, ly: 1.2 }} pan={pan}
      hud={<>
        <Lives n={s.lives} max={Math.max(3, s.lives)} />
        <HudPill icon="⚡" value={`Nv.${s.weapon}`} color={C.amber} />
        {s.shield > 0 && <HudPill icon="🛡️" value={`×${s.shield}`} color={C.cyan} />}
        <HudPill label="OLEADA" value={s.wave} color={C.violet} />
        {mult > 1 ? <Combo n={mult} /> : null}
      </>}
      subtitle="Defiende la galaxia de la invasión"
      lines={['Arrastra para mover la nave · disparo automático', '⚡ arma · 🛡️ escudo · ❤️ vida · 💣 bomba', '⚠ Un jefe cada 5 oleadas: aguanta sus abanicos', 'Los enemigos que escapen rompen tu combo']}
      result={{ won: false, isNew: res.isNew, title: 'FIN DEL VIAJE', emoji: '💥', subtitle: `Llegaste a la oleada ${res.wave}`, stats: [['OLEADA', res.wave], ['ABATIDOS', res.kills], ['ARMA', `Nv.${res.weapon}`]] }}>
      {s.boss && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 92, left: 0, right: 0, alignItems: 'center' }}>
          <Text style={{ color: C.red, fontSize: 11, fontWeight: '900', letterSpacing: 2, marginBottom: 4, ...tglow(C.red, 8) }}>JEFE</Text>
          <Bar value={s.boss.hp} max={s.boss.max} color={C.red} h={8} w={220} />
        </View>
      )}
      {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: '30%', left: 0, right: 0, textAlign: 'center', color: C.text, fontSize: 26, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow(C.cyan, 14) }}>{s.banner.text}</Text>}
    </Game3D>
  );
}
