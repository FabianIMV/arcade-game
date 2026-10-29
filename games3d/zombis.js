import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, Lives, SCREEN_H, SCREEN_W, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { enemy, hash01, house, person, shade, tree } from '../utils/prefabs';
import { followCam, forward, makeHeightmap, right, seeded, stepPlayer } from '../utils/openworld';

// SUPERVIVENCIA ZOMBI – bosque abierto en tercera persona. Joystick izquierdo: caminar · derecho: girar la cámara.
// De día: TALAR árboles (madera) y levantar VALLAS. De noche: GOLPE a los zombis. Sobrevive 4 noches.
// La hoguera del centro cura 1 vida cada 10 s. Cada noche llegan más zombis, más rápidos y más resistentes.
//
// Qué enseña este archivo:
//  · scene.statics con instancing (inst:'pino' / 'roble'): el bosque se precalcula y solo se reconstruye al talar
//  · día/noche: terreno recoloreado con terrain.ver, cielo y luces que se mezclan (lerp)
//  · scene.lights: la hoguera parpadea con luz puntual · enemy('zombi') y person() del superviviente
//  · cámara suave (lerp) y partículas de astillas, sangre verde y humo

const ZB_DAY = 45, ZB_NIGHT = 40, ZB_NIGHTS = 4, ZB_LIVES = 5, ZB_SIZE = 80, ZB_BOUND = 36, ZB_TREES = 70, ZB_MAX_WALLS = 24, ZB_HEAL_R = 5.5;
const ZB_CABIN = { x: -4, z: -3 };
const ZSHIRTS = ['#5a6a8a', '#6a4a7a', '#4f6b4a'];
const NIGHT_TINT = '#0b1226';

const mixHex = (a, b, t) => {
  const A = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), B = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const groundCol = (y, x, z, nk) => {
  const base = mixHex(y < 0.3 ? '#8a7a4a' : y < 1.5 ? '#3f7a36' : '#4f7f40', NIGHT_TINT, nk * 0.6);
  return shade(base, 0.9 + hash01(x.toFixed(1) + ',' + z.toFixed(1)) * 0.2);
};

// cámara suave: se acerca a la ideal (lerp exponencial)
const smoothCam = (s, dt, ideal) => {
  if (!s.cam) { s.cam = ideal; return; }
  const k = 1 - Math.exp(-dt * 9), mix = (a, b) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  s.cam = { p: mix(s.cam.p, ideal.p), l: mix(s.cam.l, ideal.l), fov: ideal.fov };
};

// ¿(x, z) choca con un obstáculo (valla o cabaña, rectángulo girado) o con un árbol en pie?
const solidAt = (s, x, z) => {
  for (const o of s.obst) {
    const dx = x - o.x, dz = z - o.z;
    const rt = right(o.yaw), f = forward(o.yaw);
    const lx = dx * rt[0] + dz * rt[1], lz = dx * f[0] + dz * f[1];
    if (Math.abs(lx) < o.L + 0.3 && Math.abs(lz) < o.T + 0.3) return o;
  }
  for (const t of s.trees) if (t.alive && (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < 0.36) return t;
  return null;
};

// Bosque precalculado: solo los árboles en pie (se reconstruye al talar uno)
const treesStatic = trees => trees.filter(t => t.alive).flatMap(t => tree(t.id, [t.x, t.y, t.z], {
  kind: t.kind, h: t.h, leaf: hash01(t.id, 9) < 0.5 ? '#2d7a3e' : '#3a8a48', inst: t.kind === 'pine' ? 'pino' : 'roble',
}));

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const hm = makeHeightmap(seed, ZB_SIZE, { amp: 1.6 });
  const trees = [];
  for (let i = 0; i < ZB_TREES * 3 && trees.length < ZB_TREES; i++) {
    const x = (r() - 0.5) * ZB_BOUND * 2, z = (r() - 0.5) * ZB_BOUND * 2;
    if (Math.hypot(x, z) < 5 || Math.hypot(x - ZB_CABIN.x, z - ZB_CABIN.z) < 4) continue;
    trees.push({ id: `tr${trees.length}`, x, z, y: hm.h(x, z), h: 0.95 + r() * 0.35, kind: r() < 0.7 ? 'pine' : 'oak', hp: 3, alive: true });
  }
  const cabin = { id: 'cabana', x: ZB_CABIN.x, z: ZB_CABIN.z, yaw: 0, L: 2.0, T: 1.8, hp: Infinity, hgt: 2.6, wall: false };
  return {
    hm, tid: `bosque${seed}`, trees, statics: treesStatic(trees), obst: [cabin], zs: [], seq: 0, nk: 0, cam: null,
    p: { x: 0, y: hm.h(0, 3), z: 3, vy: 0, face: 0 }, yaw: Math.PI, isNight: false, night: 0, phaseT: ZB_DAY, walk: 0,
    spawnLeft: 0, spawnT: 0, wood: 0, kills: 0, lives: ZB_LIVES, inv: 0, healT: 0, gcd: 0, t: 0, toast: null, final: null, won: false,
  };
};

// Escena completa en un instante t (juega y sirve de fondo animado en inicio/fin)
function buildScene(s, t) {
  const p = s.p, nk = s.nk;
  const blink = s.inv > 0 && Math.floor(s.t * 12) % 2 === 0;
  const tint = c => mixHex(c, NIGHT_TINT, nk * 0.6);
  const fy = s.hm.h(0, 0), flick = Math.sin(t * 14) * 0.5 + Math.sin(t * 23) * 0.5;
  const objs = [
    // hoguera del campamento (parpadea)
    { id: 'log1', k: 'cyl', p: [0.2, fy + 0.14, 0], s: [0.16, 1.0, 0.16], r: [0, 0.5, Math.PI / 2], c: '#5a3a22', sh: true },
    { id: 'log2', k: 'cyl', p: [-0.2, fy + 0.14, 0.05], s: [0.16, 1.0, 0.16], r: [0, -0.5, Math.PI / 2], c: '#5a3a22', sh: true },
    { id: 'fuego', k: 'cone', p: [0, fy + 0.6 + flick * 0.05, 0], s: [0.55 + flick * 0.06, 1.0 + flick * 0.2, 0.55 + flick * 0.06], c: '#ff8a3d', e: 1, o: 0.9, sh: false },
    { id: 'brasa', k: 'sph', p: [0, fy + 0.25, 0], n: 0.36, c: '#ff5a1f', e: 1, sh: false },
    { id: 'hogueraH', k: 'sph', p: [0, fy + 0.6, 0], n: 1.7, c: '#ff9a40', o: 0.1 + nk * 0.06, sh: false },
    // cabaña
    ...house('cabana', [ZB_CABIN.x, s.hm.h(ZB_CABIN.x, ZB_CABIN.z), ZB_CABIN.z], { kind: 'cottage', c: tint('#8a5a34'), roof: tint('#3a2418'), lit: s.isNight, yaw: 0 }),
  ];
  for (const o of s.obst) {
    if (!o.wall) continue;
    objs.push({ id: o.id, k: 'box', p: [o.x, s.hm.h(o.x, o.z) + o.hgt / 2, o.z], s: [o.L * 2, o.hgt, o.T * 2], r: [0, o.yaw, 0], c: o.hp > 2 ? '#9c6b3c' : '#6e4a28', sh: true });
  }
  // zombis (dentro de 26 m; más allá la niebla los oculta)
  for (const z of s.zs) {
    if (Math.hypot(z.x - p.x, z.z - p.z) > 26) continue;
    const k = Math.floor(hash01(z.id) * 3);
    objs.push(...enemy(z.id, 'zombi', [z.x, z.y, z.z], {
      yaw: z.face, t: t + z.ph, flash: z.kt > 0, walk: 1,
      shirt: tint(ZSHIRTS[k]), pants: tint('#4a4a5a'), skin: tint('#7fae63'),
    }));
  }
  // superviviente (la cabeza mira hacia donde camina)
  objs.push(...person('yo', [p.x, p.y, p.z], { yaw: p.face, t, walk: s.walk, hat: 'cap', band: '#ff8a3d', shirt: '#c2561e', pants: '#2b2f3e', flash: blink }));
  const fogNear = 16 + (8 - 16) * nk, fogFar = 40 + (26 - 40) * nk;
  const skyLow = mixHex('#bfe6ff', '#1a2446', nk);
  return {
    sky: { top: mixHex('#2f86e6', '#050a1c', nk), bottom: skyLow, sun: nk < 0.6, sunC: '#fff2c0', clouds: nk < 0.5 ? 7 : 0 },
    light: { dir: [-0.5, 0.75, 0.45], sun: mixHex('#fff4dc', '#8fa6ff', nk), i: 2.4 - 1.8 * nk, sky: mixHex('#dfeaff', '#2a3566', nk), ground: mixHex('#5b5648', '#15121c', nk), hi: 1.8 - 0.9 * nk },
    fog: { c: skyLow, near: fogNear, far: fogFar }, shadowR: 22,
    terrain: { id: s.tid, h: s.hm.h, size: ZB_SIZE, step: 2, color: (y, x, z) => groundCol(y, x, z, nk), ver: Math.round(nk * 8) },
    statics: s.statics,
    lights: [{ p: [0, fy + 1.2, 0], c: '#ff9a40', i: 9 + flick * 2, d: 16 }],
    objs, cam: s.cam || followCam(p, s.yaw, { hm: s.hm, dist: 7.5, height: 4 }),
  };
}

export function Zombis3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('zombis');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const say = (s, m, t = 1.4) => { s.toast = { m, t }; };
  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = (s, won) => {
    s.won = won;
    s.final = s.kills * 20 + s.night * 100 + (won ? s.lives * 50 : 0);
    if (won) hx.win(); else hx.die();
    setRes({ isNew: submitBest(s.final), won }); setPhase('over');
  };

  // acciones de los botones (día: talar y vallas · noche: golpear)
  const talar = () => {
    const s = g.current; if (!s || phase !== 'play') return;
    if (s.isNight) { say(s, '🌙 De noche no se puede talar'); return; }
    let best = null, bd = 2.8;
    for (const t of s.trees) { if (!t.alive) continue; const d = Math.hypot(t.x - s.p.x, t.z - s.p.z); if (d < bd) { bd = d; best = t; } }
    if (!best) { say(s, 'Acércate a un árbol'); return; }
    best.hp -= 1; s.wood += 1; hx.tap(); fx.pop(SCREEN_W / 2, SCREEN_H * 0.55, '+1 🪵', '#c98a4b', 16);
    burst3d([best.x, best.y + 1.2, best.z], ['#c98a4b', '#8a5a32'], 10, { speed: 3, up: 3, g: 10, size: 0.12, life: 0.6 });
    if (best.hp <= 0) {
      best.alive = false; hx.good(); say(s, '🌲 ¡Árbol talado!', 1);
      ring3d([best.x, best.y + 0.2, best.z], '#c98a4b', 14, { speed: 3, life: 0.5 });
      s.statics = treesStatic(s.trees);   // el bosque se reconstruye solo al talar
    }
  };
  const valla = () => {
    const s = g.current; if (!s || phase !== 'play') return;
    if (s.isNight) { say(s, '🌙 Las vallas se levantan de día'); return; }
    if (s.wood < 2) { say(s, 'Necesitas 2 de madera'); return; }
    if (s.obst.filter(o => o.wall).length >= ZB_MAX_WALLS) { say(s, 'Ya tienes demasiadas vallas'); return; }
    const f = forward(s.yaw);
    const x = s.p.x + f[0] * 2.2, z = s.p.z + f[1] * 2.2;
    if (solidAt(s, x, z)) { say(s, 'No hay sitio aquí'); return; }
    s.wood -= 2; s.seq += 1;
    s.obst.push({ id: `m${s.seq}`, x, z, yaw: s.yaw, L: 1.2, T: 0.15, hp: 4, hgt: 1.3, wall: true });
    hx.tap(); burst3d([x, s.hm.h(x, z) + 0.5, z], ['#c98a4b', '#8a5a32'], 8, { speed: 2, up: 2, g: 8, size: 0.12, life: 0.5 });
  };
  const golpe = () => {
    const s = g.current; if (!s || phase !== 'play' || s.gcd > 0) return;
    s.gcd = 0.4; hx.tap();
    const f = forward(s.yaw);
    for (const z of s.zs) {
      if (z.dead) continue;
      const dx = z.x - s.p.x, dz = z.z - s.p.z, d = Math.hypot(dx, dz);
      if (d > 2.6 || d < 1e-3 || (dx * f[0] + dz * f[1]) / d < 0.2) continue;
      z.hp -= 1; z.kx = (dx / d) * 2.4; z.kz = (dz / d) * 2.4; z.kt = 0.3;
      hx.hit(); fx.shake(3, 0.12);
      burst3d([z.x, z.y + 1.4, z.z], ['#8ee06a', '#c7ff9a'], 10, { speed: 4, up: 2, g: 10, size: 0.14, life: 0.5 });
      if (z.hp <= 0) {
        z.dead = true; s.kills += 1; hx.good(); fx.pop(SCREEN_W / 2, SCREEN_H * 0.45, '+20', C.lime, 18);
        burst3d([z.x, z.y + 1, z.z], ['#8ee06a', '#3d8a3a', '#ff3b3b'], 26, { speed: 5, up: 3, g: 12, size: 0.16, life: 0.8 });
      }
    }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p;
    s.t += dt; s.inv = Math.max(0, s.inv - dt); s.gcd = Math.max(0, s.gcd - dt);
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    s.zs = s.zs.filter(z => !z.dead);
    s.obst = s.obst.filter(o => o.hp > 0);

    // ciclo día / noche
    s.phaseT -= dt;
    if (!s.isNight && s.phaseT <= 0) {
      s.isNight = true; s.night += 1; s.phaseT = ZB_NIGHT; s.spawnLeft = 6 + 3 * (s.night - 1); s.spawnT = 1;
      hx.warn(); fx.flash('#3a2a8a', 0.3); say(s, `🌙 Noche ${s.night}: ¡aguanta!`, 2);
    } else if (s.isNight && s.phaseT <= 0) {
      s.isNight = false; s.zs = []; s.phaseT = ZB_DAY;
      if (s.night >= ZB_NIGHTS) { finish(s, true); return; }
      hx.good(); say(s, `☀️ Amanece: noche ${s.night} superada`, 2);
    }
    s.nk += ((s.isNight ? 1 : 0) - s.nk) * Math.min(1, dt * 1.2);

    // jugador: cámara con el joystick derecho, caminar relativo a la cámara
    s.yaw -= look.x * 2.4 * dt;
    const ox = p.x, oz = p.z;
    const moved = stepPlayer(p, move, dt, { yaw: s.yaw, hm: s.hm, speed: 5.2, bounds: ZB_BOUND });
    s.walk += (Math.min(1, moved / Math.max(dt, 1e-3) / 5.2) - s.walk) * Math.min(1, dt * 10);
    if (solidAt(s, p.x, p.z)) {
      if (!solidAt(s, p.x, oz)) p.z = oz;
      else if (!solidAt(s, ox, p.z)) p.x = ox;
      else { p.x = ox; p.z = oz; }
    }
    smoothCam(s, dt, followCam(p, s.yaw, { hm: s.hm, dist: 7.5, height: 4 }));

    // base: la hoguera cura
    if (Math.hypot(p.x, p.z) < ZB_HEAL_R && s.lives < ZB_LIVES) {
      s.healT += dt;
      if (s.healT >= 10) { s.healT = 0; s.lives += 1; hx.good(); fx.pop(SCREEN_W / 2, SCREEN_H * 0.6, '+1 ❤️', C.lime, 16); }
    } else s.healT = 0;

    // oleadas de zombis desde el bosque
    if (s.isNight && s.spawnLeft > 0) {
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        s.spawnT = Math.max(0.6, 1.4 - s.night * 0.15); s.spawnLeft -= 1; s.seq += 1;
        const a = Math.random() * Math.PI * 2, d = 24 + Math.random() * 3;
        const x = Math.max(-ZB_BOUND + 1, Math.min(ZB_BOUND - 1, p.x + Math.cos(a) * d));
        const z = Math.max(-ZB_BOUND + 1, Math.min(ZB_BOUND - 1, p.z + Math.sin(a) * d));
        s.zs.push({ id: `z${s.seq}`, x, z, y: s.hm.h(x, z), hp: s.night >= 3 ? 3 : 2, face: 0, kx: 0, kz: 0, kt: 0, ph: Math.random() * 6, dead: false });
      }
    }

    // zombis: caminan hacia el jugador, se empujan con el GOLPE y chocan con vallas
    const sp = 1.5 + s.night * 0.12;
    for (const z of s.zs) {
      z.ph += dt * 4;
      const dx = p.x - z.x, dz = p.z - z.z, dl = Math.hypot(dx, dz) || 1;
      let vx = (dx / dl) * sp, vz = (dz / dl) * sp;
      if (z.kt > 0) { z.kt -= dt; vx = z.kx; vz = z.kz; }
      z.face = Math.atan2(-vx, -vz);
      const nx = z.x + vx * dt, nz = z.z + vz * dt;
      if (!solidAt(s, nx, nz)) { z.x = nx; z.z = nz; }
      else if (!solidAt(s, nx, z.z)) z.x = nx;
      else if (!solidAt(s, z.x, nz)) z.z = nz;
      else { const o = solidAt(s, nx, nz); if (o && o.wall) o.hp -= 1.2 * dt; }   // la valla aguanta el empuje
      z.y = s.hm.h(z.x, z.z);
      if (s.inv <= 0 && Math.hypot(z.x - p.x, z.z - p.z) < 1.0) {
        s.lives -= 1; s.inv = 1.2; hx.bad(); fx.shake(9, 0.3); fx.flash(C.red, 0.3); say(s, '🧟 ¡Mordisco!', 1.2);
        burst3d([p.x, p.y + 1.2, p.z], ['#ff4d4d', '#8ee06a'], 16, { speed: 4, up: 2, size: 0.16, life: 0.6 });
        if (s.lives <= 0) { s.lives = 0; finish(s, false); return; }
      }
    }
  });

  const s = g.current; const p = s.p;
  const scene = buildScene(s, phase === 'play' ? s.t : 0);
  const sc = s.final != null ? s.final : s.kills * 20 + s.night * 100;
  const dayOk = !s.isNight;
  return (
    <Game3D title="SUPERVIVENCIA ZOMBI" emoji="🧟" accent={C.lime} onExit={onExit} score={sc} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(s, t)} orbit={{ r: 12, h: 5, speed: 0.2, ly: 1.3 }}
      hud={<><Lives n={s.lives} max={ZB_LIVES} /><HudPill icon={s.isNight ? '🌙' : '☀️'} value={`${s.night}/${ZB_NIGHTS}`} color={s.isNight ? C.violet : C.amber} /><HudPill icon="🪵" value={String(s.wood)} color="#c98a4b" /><HudPill icon="⏱" value={`${Math.ceil(s.phaseT)}s`} color={C.dim} /></>}
      subtitle="Sobrevive 4 noches en el bosque"
      lines={['Joystick izquierdo: caminar · derecho: girar la cámara', 'De día: TALA árboles y levanta VALLAS con la madera', 'De noche: GOLPEA a los zombis que llegan', `Sobrevive ${ZB_NIGHTS} noches · la hoguera cura vidas`]}
      result={{ won: res.won, isNew: res.isNew, title: res.won ? '¡SOBREVIVISTE!' : 'TE HAN DEVORADO', emoji: res.won ? '🏆' : '🧟', subtitle: res.won ? `Superaste las ${ZB_NIGHTS} noches` : `Caíste en la noche ${s.night}`, stats: [['NOCHES', `${s.night}/${ZB_NIGHTS}`], ['ZOMBIS', String(s.kills)], ['VIDAS', String(s.lives)]] }}>
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '22%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 20, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      <Stick3D testID="zb-move" v={move} side="left" color={C.lime} />
      <Stick3D testID="zb-look" v={look} side="right" color={C.amber} />
      <ActionBtn testID="zb-golpe" label="GOLPE" color={C.red} size={80} onDown={golpe} style={{ right: 18, bottom: 186 }} />
      <ActionBtn testID="zb-talar" label="TALAR" color={C.amber} onDown={talar} style={{ right: 106, bottom: 186, opacity: dayOk ? 1 : 0.4 }} />
      <ActionBtn testID="zb-valla" label="VALLA" color={C.lime} onDown={valla} style={{ right: 18, bottom: 272, opacity: dayOk ? 1 : 0.4 }} />
    </Game3D>
  );
}
