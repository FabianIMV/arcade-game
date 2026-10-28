import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Lives, Overlay, PlayArea, TouchBtn, TouchStick, alpha, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { followCam, forward, right, makeHeightmap, near, seeded, stepPlayer, terrainObjs } from '../utils/openworld';

// SUPERVIVENCIA ZOMBI – bosque abierto en tercera persona. Joystick izquierdo: caminar · derecho: girar la cámara.
// De día: TALAR árboles (madera) y levantar VALLAS. De noche: GOLPE a los zombis. Sobrevive 4 noches.
// La hoguera del centro (base) cura 1 vida cada 10 s.
const ZB_DAY = 45, ZB_NIGHT = 40, ZB_NIGHTS = 4, ZB_LIVES = 5, ZB_SIZE = 80, ZB_BOUND = 36, ZB_TREES = 70, ZB_MAX_WALLS = 24, ZB_HEAL_R = 5.5;
const ZB_CABIN = { x: -4, z: -3 };
const mixHex = (a, b, t) => {
  const A = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), B = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const NIGHT_TINT = '#0b1226';

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

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const hm = makeHeightmap(seed, ZB_SIZE, { amp: 1.6 });
  const trees = [];
  for (let i = 0; i < ZB_TREES * 3 && trees.length < ZB_TREES; i++) {
    const x = (r() - 0.5) * ZB_BOUND * 2, z = (r() - 0.5) * ZB_BOUND * 2;
    if (Math.hypot(x, z) < 5 || Math.hypot(x - ZB_CABIN.x, z - ZB_CABIN.z) < 4) continue;
    trees.push({ id: `tr${trees.length}`, x, z, y: hm.h(x, z), h: 2.4 + r() * 1.2, hp: 3, alive: true });
  }
  const cabin = { id: 'cabana', x: ZB_CABIN.x, z: ZB_CABIN.z, yaw: 0, L: 2.2, T: 1.6, hp: Infinity, hgt: 2.6, c: '#6b4a2e' };
  return {
    hm, trees, obst: [cabin], zs: [], seq: 0, nk: 0,
    p: { x: 0, y: hm.h(0, 3), z: 3, vy: 0, face: 0 }, yaw: Math.PI, isNight: false, night: 0, phaseT: ZB_DAY,
    spawnLeft: 0, spawnT: 0, wood: 0, kills: 0, lives: ZB_LIVES, inv: 0, healT: 0, gcd: 0, t: 0, toast: null, final: null, won: false,
  };
};

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
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); hx.tap(); };
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
    best.hp -= 1; s.wood += 1; hx.tap(); fx.pop(AREA_W / 2, AREA_H * 0.55, '+1 🪵', '#c98a4b', 16);
    if (best.hp <= 0) { best.alive = false; hx.good(); say(s, '🌲 ¡Árbol talado!', 1); }
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
    hx.tap();
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
      if (z.hp <= 0) { z.dead = true; s.kills += 1; hx.good(); fx.pop(AREA_W / 2, AREA_H * 0.45, '+20', C.lime, 18); }
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
    stepPlayer(p, move, dt, { yaw: s.yaw, hm: s.hm, speed: 5.2, bounds: ZB_BOUND });
    if (solidAt(s, p.x, p.z)) {
      if (!solidAt(s, p.x, oz)) p.z = oz;
      else if (!solidAt(s, ox, p.z)) p.x = ox;
      else { p.x = ox; p.z = oz; }
    }

    // base: la hoguera cura
    if (Math.hypot(p.x, p.z) < ZB_HEAL_R && s.lives < ZB_LIVES) {
      s.healT += dt;
      if (s.healT >= 10) { s.healT = 0; s.lives += 1; hx.good(); fx.pop(AREA_W / 2, AREA_H * 0.6, '+1 ❤️', C.lime, 16); }
    } else s.healT = 0;

    // oleadas de zombis desde el bosque
    if (s.isNight && s.spawnLeft > 0) {
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        s.spawnT = 1.4; s.spawnLeft -= 1; s.seq += 1;
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
        if (s.lives <= 0) { s.lives = 0; finish(s, false); return; }
      }
    }
  });

  const s = g.current; const p = s.p;
  const nk = s.nk;
  const sky = mixHex('#9fd8ff', '#060a1a', nk);
  const tint = c => mixHex(c, NIGHT_TINT, nk * 0.6);
  const groundCol = y => tint(y < 0.3 ? '#8a7a4a' : y < 1.5 ? '#3f7a36' : '#4f7f40');
  const objs = [
    ...terrainObjs(s.hm, p, 15, 3, groundCol),
    // base: hoguera y cabaña
    { id: 'hoguera', k: 'sph', p: [0, s.hm.h(0, 0) + 0.35, 0], n: 0.45 + Math.sin(s.t * 14) * 0.04, c: '#ff8a3d', e: 0.5 },
    { id: 'hogueraH', k: 'sph', p: [0, s.hm.h(0, 0) + 0.4, 0], n: 1.5, c: '#ff9a40', o: 0.12 + nk * 0.08 },
    { id: 'cabanaT', k: 'box', p: [ZB_CABIN.x, s.hm.h(ZB_CABIN.x, ZB_CABIN.z) + 2.85, ZB_CABIN.z], s: [4.8, 0.3, 3.6], c: tint('#4a2e1a') },
    ...s.obst.map(o => (o.wall
      ? { id: o.id, k: 'box', p: [o.x, s.hm.h(o.x, o.z) + o.hgt / 2, o.z], s: [o.L * 2, o.hgt, o.T * 2], r: [0, o.yaw, 0], c: o.hp > 2 ? '#9c6b3c' : '#6e4a28' }
      : { id: o.id, k: 'box', p: [o.x, s.hm.h(o.x, o.z) + o.hgt / 2, o.z], s: [o.L * 2, o.hgt, o.T * 2], r: [0, o.yaw, 0], c: tint(o.c) }
    )),
    ...near(s.trees.filter(t => t.alive), p, 26).flatMap(t => [
      { id: `${t.id}a`, k: 'cyl', p: [t.x, t.y + t.h / 2, t.z], s: [0.4, t.h, 0.4], c: tint('#6b4a2a') },
      { id: `${t.id}b`, k: 'cone', p: [t.x, t.y + t.h + 0.7, t.z], s: [2.6, 3.0, 2.6], c: tint('#23602c') },
    ]),
    ...near(s.zs, p, 30).flatMap(z => {
      const f = forward(z.face), rt = right(z.face), bob = Math.sin(z.ph) * 0.06;
      const sw = Math.sin(z.ph) * 0.25;
      return [
        { id: `${z.id}b`, k: 'box', p: [z.x, z.y + 1.0 + bob, z.z], s: [0.6, 0.9, 0.36], r: [0, z.face, 0], c: tint('#3d8a3a') },
        { id: `${z.id}h`, k: 'sph', p: [z.x, z.y + 1.6 + bob, z.z], n: 0.5, c: tint('#8ee06a') },
        { id: `${z.id}e1`, k: 'sph', p: [z.x + f[0] * 0.24 + rt[0] * 0.13, z.y + 1.66 + bob, z.z + f[1] * 0.24 + rt[1] * 0.13], n: 0.1, c: '#ff3b3b', e: 0.5 },
        { id: `${z.id}e2`, k: 'sph', p: [z.x + f[0] * 0.24 - rt[0] * 0.13, z.y + 1.66 + bob, z.z + f[1] * 0.24 - rt[1] * 0.13], n: 0.1, c: '#ff3b3b', e: 0.5 },
        { id: `${z.id}a1`, k: 'box', p: [z.x + rt[0] * 0.42 + f[0] * (0.15 + sw), z.y + 1.1 + bob, z.z + rt[1] * 0.42 + f[1] * (0.15 + sw)], s: [0.18, 0.7, 0.18], r: [0, z.face, 0], c: tint('#3d8a3a') },
        { id: `${z.id}a2`, k: 'box', p: [z.x - rt[0] * 0.42 + f[0] * (0.15 - sw), z.y + 1.1 + bob, z.z - rt[1] * 0.42 + f[1] * (0.15 - sw)], s: [0.18, 0.7, 0.18], r: [0, z.face, 0], c: tint('#3d8a3a') },
      ];
    }),
    // jugador
    { id: 'cuerpo', k: 'box', p: [p.x, p.y + 0.8, p.z], s: [0.7, 1.1, 0.45], r: [0, s.yaw, 0], c: s.inv > 0 && Math.floor(s.t * 12) % 2 === 0 ? '#ffffff' : '#c2561e' },
    { id: 'cabeza', k: 'sph', p: [p.x, p.y + 1.65, p.z], n: 0.55, c: '#f2c29b' },
  ];
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const fogNear = 16 + (8 - 16) * nk, fogFar = 40 + (26 - 40) * nk;
  const scene = { bg: sky, fog: { c: sky, near: fogNear, far: fogFar }, shake, objs, cam: followCam(p, s.yaw, { hm: s.hm, dist: 7.5, height: 4 }) };
  const sc = s.final != null ? s.final : s.kills * 20 + s.night * 100;
  const dayOk = !s.isNight;
  const pad = (v, cx) => (
    <View pointerEvents="none" style={{ position: 'absolute', left: cx - 50, bottom: 14, width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
      <View style={{ position: 'absolute', left: 34 + v.x * 32, top: 34 + v.y * 32, width: 32, height: 32, borderRadius: 16, backgroundColor: v.on ? alpha(C.lime, 0.7) : 'rgba(255,255,255,0.35)' }} />
    </View>
  );
  const actBtn = (testID, label, pos, size, color, onDown, enabled) => (
    <TouchBtn testID={testID} onDown={onDown} style={{ position: 'absolute', ...pos, width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color, backgroundColor: alpha(color, 0.22), alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0.4 }}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11 }}>{label}</Text>
    </TouchBtn>
  );
  return (
    <GameScreen title="SUPERVIVENCIA ZOMBI" emoji="🧟" accent={C.lime} onExit={onExit} score={sc} best={best}
      hud={<><Lives n={s.lives} max={ZB_LIVES} /><Text style={{ color: s.isNight ? C.violet : C.amber, fontWeight: '900', fontSize: 12 }}>{s.isNight ? '🌙' : '☀️'} {s.night}/{ZB_NIGHTS}</Text><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>🪵 {s.wood}</Text><Text style={{ color: C.dim, fontWeight: '900', fontSize: 12 }}>⏱ {Math.ceil(s.phaseT)}s</Text></>}>
      <PlayArea fx={fx} bg={sky}>
        <World3D scene={scene} />
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.22, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 20, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
        {phase === 'play' && (
          <>
            <TouchStick testID="zb-move" v={move} R={44} style={{ position: 'absolute', left: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            <TouchStick testID="zb-look" v={look} R={44} style={{ position: 'absolute', right: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            {pad(move, 62)}
            {pad(look, AREA_W - 62)}
            {actBtn('zb-golpe', 'GOLPE', { right: 18, bottom: 186 }, 76, C.red, golpe, true)}
            {actBtn('zb-talar', 'TALAR', { right: 106, bottom: 186 }, 64, C.amber, talar, dayOk)}
            {actBtn('zb-valla', 'VALLA', { right: 18, bottom: 272 }, 64, C.lime, valla, dayOk)}
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? (res.won ? '🏆' : '🧟') : '🧟'}
          title={phase === 'over' ? (res.won ? '¡SOBREVIVISTE!' : 'TE HAN DEVORADO') : 'SUPERVIVENCIA ZOMBI'}
          subtitle={phase === 'ready' ? 'Sobrevive 4 noches en el bosque' : (res.won ? `Superaste las ${ZB_NIGHTS} noches` : `Caíste en la noche ${s.night}`)}
          score={sc} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Joystick izquierdo: caminar · derecho: girar la cámara', 'De día: TALA árboles y levanta VALLAS con la madera', 'De noche: GOLPEA a los zombis que llegan', `Sobrevive ${ZB_NIGHTS} noches · la hoguera cura vidas`] : null} />
      </PlayArea>
    </GameScreen>
  );
}
