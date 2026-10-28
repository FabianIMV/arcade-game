import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Lives, Overlay, PlayArea, TouchBtn, TouchStick, alpha, hx, tglow, uid, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { compassAngle, forward, makeHeightmap, near, project, seeded } from '../utils/openworld';

// JINETE DE DRAGÓN – vuelo en tercera persona sobre montañas y lagos.
// Joystick izquierdo: gira (izquierda/derecha) y sube o baja (arriba/abajo). FUEGO (mantener): bolas de fuego.
// Destruye las torres enemigas antes de que acabe el tiempo; los anillos dan puntos. 3 vidas.
const DR_SIZE = 240, DR_TOWERS = 14, DR_RINGS = 16, DR_TIME = 200;
const DR_SPEED = 26, DR_TURN = 1.6, DR_CEIL = 90;
const DR_FIRE_CD = 0.32, DR_FB_SPEED = 64, DR_SHOT_SPEED = 15, DR_RANGE = 85;
const DR_BODY = '#2a9d6b', DR_BELLY = '#d9f5b0', DR_DARK = '#1f6f5a', DR_MEM = '#3fb88a', DR_BONE = '#d8ffe6';
const SKY = '#9fd4ff';

// ── matrices 3x3 (marco del dragón: nariz hacia -Z; Euler XYZ como three.js) ──
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const mm = (A, B) => A.map(row => [0, 1, 2].map(j => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const mv = (M, v) => M.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const rX = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const rY = a => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const rZ = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const eulXYZ = m => {
  const y = Math.asin(Math.max(-1, Math.min(1, m[0][2])));
  return Math.abs(m[0][2]) < 0.9999999 ? [Math.atan2(-m[1][2], m[2][2]), y, Math.atan2(-m[0][1], m[0][0])] : [Math.atan2(m[2][1], m[1][1]), y, 0];
};
const bodyM = (yaw, pitch, bank) => mm(rY(yaw), mm(rX(pitch), rZ(bank)));
const dirOf = (yaw, pitch) => { const c = Math.cos(pitch); return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c]; };
const pivotG = (R, piv) => ({ R, t: sub(piv, mv(R, piv)) });
const B0 = { R: I3, t: [0, 0, 0] };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const drColor = y => (y < 0 ? '#1d4a66' : y < 3 ? '#d9c58a' : y < 18 ? '#5aa84a' : y < 34 ? '#7c7a62' : '#eef4ff');

// Suelo por dos niveles de detalle: bloques finos (6) alrededor del jugador y gruesos (24) en la distancia.
// Las zonas están alineadas a una rejilla de 24 para que no se solapen ni dejen huecos.
const drTerrain = (hm, c) => {
  const out = [];
  const bx = Math.floor(c.x / 24), bz = Math.floor(c.z / 24);
  const cell = (x, z, s, id) => {
    if (Math.abs(x) > hm.half || Math.abs(z) > hm.half) return;
    const y = hm.h(x, z);
    out.push({ id, k: 'box', p: [x, (y - 28) / 2, z], s: [s, y + 28, s], c: drColor(y) });
  };
  for (let gx = (bx - 1) * 4; gx < (bx + 1) * 4; gx++) for (let gz = (bz - 1) * 4; gz < (bz + 1) * 4; gz++) cell((gx + 0.5) * 6, (gz + 0.5) * 6, 6, `n${gx}_${gz}`);
  for (let gx = bx - 5; gx < bx + 5; gx++) for (let gz = bz - 5; gz < bz + 5; gz++) {
    if (gx >= bx - 1 && gx <= bx && gz >= bz - 1 && gz <= bz) continue;
    cell(gx * 24 + 12, gz * 24 + 12, 24, `f${gx}_${gz}`);
  }
  return out;
};

// Dragón: torso, vientre, cuello, cabeza, cola que ondea, patas y dos alas que aletean (cajas y esferas rotadas).
function dragonObjs(P, M, flap, sw) {
  const out = [];
  const put = (id, k, G, v, Rp, sz, c, ex) => {
    const lp = add(G.t, mv(G.R, v));
    const obj = { id, k, p: add(P, mv(M, lp)), r: eulXYZ(mm(M, mm(G.R, Rp))), c };
    if (typeof sz === 'number') obj.n = sz; else obj.s = sz;
    if (ex) Object.assign(obj, ex);
    out.push(obj);
  };
  put('dr_torso', 'sph', B0, [0, 0, 0], I3, [1.9, 1.7, 3.8], DR_BODY);
  put('dr_belly', 'sph', B0, [0, -0.6, -0.1], I3, [1.5, 0.8, 3.2], DR_BELLY);
  put('dr_n0', 'sph', B0, [0, 0.6, -2.2], I3, [1.3, 1.2, 1.5], DR_BODY);
  put('dr_n1', 'sph', B0, [0, 1.1, -3.0], I3, [1.1, 1.0, 1.4], DR_BODY);
  put('dr_n2', 'sph', B0, [0, 1.5, -3.8], I3, [1.0, 0.9, 1.3], DR_BODY);
  put('dr_head', 'sph', B0, [0, 1.8, -4.9], I3, [1.5, 1.1, 2.0], DR_BODY);
  put('dr_snout', 'cone', B0, [0, 1.75, -6.7], rX(-Math.PI / 2), [0.7, 1.3, 0.7], DR_BODY);
  for (const sg of [-1, 1]) {
    put(`dr_horn${sg}`, 'cone', B0, [sg * 0.55, 2.7, -4.3], rX(0.8), [0.35, 1.2, 0.35], DR_BONE);
    put(`dr_eye${sg}`, 'sph', B0, [sg * 0.6, 2.0, -5.6], I3, 0.3, '#ffb000', { e: 0.5 });
  }
  const tg = pivotG(rY(sw), [0, 0, 1.2]);
  put('dr_t0', 'sph', tg, [0, -0.2, 2.6], I3, [1.4, 1.2, 1.8], DR_BODY);
  put('dr_t1', 'sph', tg, [0, -0.45, 4.2], I3, [1.0, 0.9, 1.6], DR_BODY);
  put('dr_t2', 'sph', tg, [0, -0.6, 5.6], I3, [0.7, 0.6, 1.3], DR_BODY);
  put('dr_tip', 'cone', tg, [0, -0.7, 6.6], rX(Math.PI / 2), [0.5, 1.4, 0.5], DR_BONE);
  for (const sg of [-1, 1]) {
    put(`dr_fl${sg}`, 'box', B0, [sg * 1.0, -1.0, -1.4], I3, [0.5, 1.0, 0.6], DR_DARK);
    put(`dr_hl${sg}`, 'box', B0, [sg * 1.1, -0.95, 1.0], I3, [0.7, 0.9, 0.9], DR_DARK);
    // ala: hueso + membrana + garra; gira alrededor del hombro según el aleteo
    const Gw = { R: rZ(sg * flap), t: [sg * 0.9, 0.8, -0.4] };
    put(`dr_arm${sg}`, 'box', Gw, [sg * 2.0, 0, 0], I3, [4.0, 0.26, 0.4], DR_DARK);
    put(`dr_mem${sg}`, 'box', Gw, [sg * 2.0, -0.05, 1.0], I3, [3.8, 0.05, 2.2], DR_MEM, { o: 0.88 });
    put(`dr_claw${sg}`, 'sph', Gw, [sg * 4.0, 0, 0], I3, 0.4, DR_BONE);
  }
  return out;
}

const towerObjs = (t, time) => [
  { id: `${t.id}a`, k: 'cyl', p: [t.x, t.y + 5.5, t.z], s: [2.2, 11, 2.2], c: t.hp < 2 ? '#8a5a3a' : '#6d6a7a' },
  { id: `${t.id}b`, k: 'cyl', p: [t.x, t.y + 11.5, t.z], s: [2.8, 1, 2.8], c: '#4a4860' },
  { id: `${t.id}c`, k: 'cone', p: [t.x, t.y + 13.6, t.z], s: [3.2, 4, 3.2], c: '#b3263e' },
  { id: `${t.id}d`, k: 'sph', p: [t.x, t.y + 16.6, t.z], n: 1 + Math.sin(time * 5) * 0.12, c: '#ff3df2', e: 0.5 },
];
const fbObjs = f => [
  { id: `fb${f.id}a`, k: 'sph', p: [f.x, f.y, f.z], n: 0.8, c: C.orange, e: 0.5 },
  { id: `fb${f.id}b`, k: 'sph', p: [f.x, f.y, f.z], n: 0.45, c: '#ffe27a', e: 0.5 },
];

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const H0 = makeHeightmap(seed, DR_SIZE, { amp: 40 });
  const hm = { size: H0.size, half: H0.half, h: (x, z) => H0.h(x, z) - 11 };   // hundido: aparecen lagos
  const towers = [];
  for (let tries = 0; towers.length < DR_TOWERS && tries < 900; tries++) {
    const x = (r() - 0.5) * DR_SIZE * 0.85, z = (r() - 0.5) * DR_SIZE * 0.85, y = hm.h(x, z);
    if (y < 2 || Math.hypot(x, z) < 35 || towers.some(t => Math.hypot(t.x - x, t.z - z) < 22)) continue;
    towers.push({ id: `tw${towers.length}`, x, y, z, hp: 2, cd: 1 + r() * 2, alive: true });
  }
  const rings = [];
  for (let tries = 0; rings.length < DR_RINGS && tries < 900; tries++) {
    const x = (r() - 0.5) * DR_SIZE * 0.8, z = (r() - 0.5) * DR_SIZE * 0.8;
    if (Math.hypot(x, z) < 20) continue;
    const y = Math.max(hm.h(x, z), 0) + 12 + r() * 22;
    rings.push({ id: `rg${rings.length}`, x, y, z, a: r() * Math.PI * 2, done: false });
  }
  const sy = Math.max(hm.h(0, 0), 0) + 30;
  return { hm, towers, rings, fbs: [], shots: [], p: { x: 0, y: sy, z: 0 }, prev: null, pitch: 0, yaw: 0, bank: 0, fireCd: 0, lives: 3, inv: 0, time: DR_TIME, got: 0, score: 0, t: 0, toast: null, final: null, over: false };
};

// Cámara en tercera persona, detrás del dragón y siempre sobre el terreno.
const camOf = s => {
  // detrás del dragón (horizontal), algo por encima; mira hacia donde vuela
  const p = s.p, fh = forward(s.yaw), F = dirOf(s.yaw, s.pitch);
  const cx = p.x - fh[0] * 22, cz = p.z - fh[1] * 22;
  const cy = Math.max(p.y + 6, s.hm.h(cx, cz) + 3);
  return { p: [cx, cy, cz], l: [p.x + F[0] * 4, p.y + F[1] * 4, p.z + F[2] * 4], fov: 66 };
};
const scr = (cam, pt) => project(cam, pt, AREA_W, AREA_H) || { x: AREA_W / 2, y: AREA_H / 2 };

export function Dragon3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('dragon');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const stick = useRef({ x: 0, y: 0, on: false }).current;
  const fire = useRef(false);
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); fire.current = false; setPhase('play'); hx.tap(); };
  const finish = (s, won) => {
    if (s.over) return;
    s.over = true;
    s.final = s.score + (won ? Math.ceil(s.time) * 5 : 0);
    if (won) hx.win(); else hx.die();
    setRes({ isNew: submitBest(s.final), won }); setPhase('over');
  };
  const hurt = (s, msg) => {
    s.lives -= 1; s.inv = 1.6; hx.bad(); fx.shake(9, 0.35); fx.flash(C.red, 0.3);
    s.toast = { m: msg, t: 1.3 };
    if (s.lives <= 0) finish(s, false);
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; if (s.over) return;
    const p = s.p;
    s.t += dt; s.time -= dt; s.inv = Math.max(0, s.inv - dt); s.fireCd -= dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.time <= 0) { s.time = 0; finish(s, false); return; }

    // vuelo: siempre hacia delante. x gira; y cabecea (arriba = subir)
    s.yaw -= stick.x * DR_TURN * dt;
    s.bank += (-stick.x * 0.5 - s.bank) * Math.min(1, dt * 4);
    s.pitch += (-stick.y * 0.55 - s.pitch) * Math.min(1, dt * 2.5);
    if (Math.hypot(p.x, p.z) > DR_SIZE / 2 - 14) s.yaw += wrap(Math.atan2(p.x, p.z) - s.yaw) * Math.min(1, dt * 1.5);   // vuelve al centro del mapa
    const F = dirOf(s.yaw, s.pitch);
    s.prev = { x: p.x, y: p.y, z: p.z };
    p.x += F[0] * DR_SPEED * dt; p.y += F[1] * DR_SPEED * dt; p.z += F[2] * DR_SPEED * dt;
    const lim = DR_SIZE / 2 - 4;
    p.x = Math.max(-lim, Math.min(lim, p.x)); p.z = Math.max(-lim, Math.min(lim, p.z));
    p.y = Math.min(DR_CEIL, p.y);

    // choque con el terreno o con el agua: rebota hacia arriba y quita una vida
    const surf = Math.max(s.hm.h(p.x, p.z), 0);
    if (p.y - 1.5 < surf) {
      p.y = surf + 9; s.pitch = 0.35; s.prev = { x: p.x, y: p.y, z: p.z };
      if (s.inv <= 0) { hurt(s, '💥 ¡Choque contra el terreno!'); if (s.over) return; }
    }
    const cam = camOf(s);

    // torres: son un obstáculo sólido
    for (const t of s.towers) {
      if (!t.alive || p.y > t.y + 16 || Math.hypot(t.x - p.x, t.z - p.z) > 3) continue;
      s.pitch = 0.4;
      if (s.inv <= 0) { hurt(s, '🧱 ¡Torre!'); if (s.over) return; }
    }

    // anillos: se cuentan si el dragón atraviesa su plano cerca del centro
    for (const rg of s.rings) {
      if (rg.done) continue;
      const nx = Math.sin(rg.a), nz = Math.cos(rg.a);
      const d0 = (s.prev.x - rg.x) * nx + (s.prev.z - rg.z) * nz;
      const d1 = (p.x - rg.x) * nx + (p.z - rg.z) * nz;
      if (d0 * d1 <= 0 && d0 !== d1) {
        const k = d0 / (d0 - d1);
        const qx = s.prev.x + (p.x - s.prev.x) * k, qy = s.prev.y + (p.y - s.prev.y) * k, qz = s.prev.z + (p.z - s.prev.z) * k;
        if (Math.hypot(qx - rg.x, qy - rg.y, qz - rg.z) < 3.2) {
          rg.done = true; s.score += 50; hx.good();
          const q = scr(cam, [rg.x, rg.y, rg.z]); fx.pop(q.x, q.y, '+50', C.lime);
        }
      }
    }

    // disparo: bolas de fuego hacia donde mira el dragón
    if (fire.current && s.fireCd <= 0) {
      s.fireCd = DR_FIRE_CD; hx.tick();
      const mo = add([p.x, p.y, p.z], mv(bodyM(s.yaw, s.pitch, s.bank), [0, 1.9, -7.6]));
      s.fbs.push({ id: uid(), x: mo[0], y: mo[1], z: mo[2], vx: F[0] * DR_FB_SPEED, vy: F[1] * DR_FB_SPEED, vz: F[2] * DR_FB_SPEED, life: 2.4 });
      if (s.fbs.length > 14) s.fbs.shift();
    }
    for (let i = s.fbs.length - 1; i >= 0; i--) {
      const f = s.fbs[i];
      f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      let hit = f.life <= 0 || f.y < Math.max(s.hm.h(f.x, f.z), 0);
      for (const t of s.towers) {
        if (hit || !t.alive || Math.hypot(t.x - f.x, t.z - f.z) > 3.4 || f.y < t.y || f.y > t.y + 17) continue;
        hit = true; t.hp -= 1;
        const q = scr(cam, [f.x, f.y, f.z]);
        if (t.hp <= 0) {
          t.alive = false; s.got += 1; s.score += 150; hx.hit(); fx.flash(C.amber, 0.2);
          fx.burst(q.x, q.y, C.orange, 22, 260); fx.pop(q.x, q.y, '+150', C.amber);
          s.toast = { m: `🔥 Torre ${s.got}/${DR_TOWERS}`, t: 1.4 };
        } else { hx.tick(); fx.burst(q.x, q.y, C.orange, 10); }
      }
      if (hit) s.fbs.splice(i, 1);
      if (s.got >= DR_TOWERS) { finish(s, true); return; }
    }

    // torres enemigas: disparan proyectiles lentos hacia el dragón
    for (const t of s.towers) {
      if (!t.alive || Math.hypot(t.x - p.x, t.z - p.z) > DR_RANGE) continue;
      t.cd -= dt;
      if (t.cd <= 0) {
        t.cd = 2.8 + Math.random() * 1.2;
        const o = [t.x, t.y + 16.6, t.z], dv = [p.x - o[0], p.y - o[1], p.z - o[2]];
        const L = Math.hypot(dv[0], dv[1], dv[2]) || 1;
        s.shots.push({ id: uid(), x: o[0], y: o[1], z: o[2], vx: dv[0] / L * DR_SHOT_SPEED, vy: dv[1] / L * DR_SHOT_SPEED, vz: dv[2] / L * DR_SHOT_SPEED, life: 9 });
      }
    }
    for (let i = s.shots.length - 1; i >= 0; i--) {
      const q = s.shots[i];
      q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < 2.4) {
        s.shots.splice(i, 1);
        if (s.inv <= 0) { hurt(s, '💜 ¡Proyectil!'); if (s.over) return; }
      } else if (q.life <= 0 || q.y < Math.max(s.hm.h(q.x, q.z), 0)) s.shots.splice(i, 1);
    }
    if (s.shots.length > 30) s.shots.splice(0, s.shots.length - 30);
    s.prev = { x: p.x, y: p.y, z: p.z };
  });

  const s = g.current; const p = s.p;
  const M = bodyM(s.yaw, s.pitch, s.bank);
  const flap = 0.2 + 0.7 * Math.sin(s.t * 6);
  const sw = Math.sin(s.t * 2.2) * 0.25;
  const alive = s.towers.filter(t => t.alive);
  let target = null, td = 1e9;
  alive.forEach(t => { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < td) { td = d; target = t; } });
  const ang = target ? compassAngle(p, s.yaw, target) : 0;
  const blink = s.inv > 0 && Math.floor(s.t * 12) % 2 === 0;
  const objs = [
    { id: 'agua', k: 'pla', p: [p.x, 0.02, p.z], s: [520, 520, 1], c: '#2a6fb8', o: 0.9 },
    ...drTerrain(s.hm, p),
    ...dragonObjs([p.x, p.y, p.z], M, flap, sw).map(o => (blink ? { ...o, c: o.c === DR_BODY ? '#ffffff' : o.c } : o)),
    ...near(alive, p, 130).flatMap(t => towerObjs(t, s.t)),
    ...near(s.rings.filter(rg => !rg.done), p, 130).map(rg => ({ id: rg.id, k: 'tor', p: [rg.x, rg.y, rg.z], n: 5, r: [0, rg.a, 0], c: C.lime, e: 0.5 })),
    ...s.fbs.flatMap(fbObjs),
    ...s.shots.map(q => ({ id: `q${q.id}`, k: 'sph', p: [q.x, q.y, q.z], n: 0.9, c: '#c26bff', e: 0.5 })),
  ];
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const scene = { bg: SKY, fog: { c: SKY, near: 70, far: 140 }, shake, objs, cam: camOf(s) };
  const sc = s.final != null ? s.final : s.score;
  const pad = (v, cx) => (
    <View pointerEvents="none" style={{ position: 'absolute', left: cx - 50, bottom: 14, width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
      <View style={{ position: 'absolute', left: 34 + v.x * 32, top: 34 + v.y * 32, width: 32, height: 32, borderRadius: 16, backgroundColor: v.on ? alpha(C.orange, 0.7) : 'rgba(255,255,255,0.35)' }} />
    </View>
  );
  return (
    <GameScreen title="JINETE DE DRAGÓN" emoji="🐉" accent={C.orange} onExit={onExit} score={sc} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>🔥 {s.got}/{DR_TOWERS}</Text><Text style={{ color: s.time < 20 ? C.red : C.amber, fontWeight: '900', fontSize: 12 }}>⏱ {Math.ceil(s.time)}s</Text></>}>
      <PlayArea fx={fx} bg={SKY}>
        <World3D scene={scene} />
        {phase === 'play' && target && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: C.orange, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Torre a {Math.round(td)} m</Text>
            </View>
          </View>
        )}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.25, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
        {phase === 'play' && (
          <>
            <TouchStick testID="dr-move" v={stick} R={44} style={{ position: 'absolute', left: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            {pad(stick, 62)}
            <TouchBtn testID="dr-fire" onDown={() => { fire.current = true; }} onUp={() => { fire.current = false; }} style={{ position: 'absolute', right: 18, bottom: 26, width: 78, height: 78, borderRadius: 39, borderWidth: 2, borderColor: C.orange, backgroundColor: alpha(C.orange, 0.25), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>🔥 FUEGO</Text>
            </TouchBtn>
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? (res.won ? '🏆' : '🐉') : '🐉'}
          title={phase === 'over' ? (res.won ? '¡TODAS LAS TORRES!' : 'EL DRAGÓN CAYÓ') : 'JINETE DE DRAGÓN'}
          subtitle={phase === 'ready' ? 'Vuela sobre montañas y lagos' : `🔥 ${s.got}/${DR_TOWERS} torres destruidas`}
          score={sc} best={best} isNew={res.isNew} accent={C.orange} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Joystick izquierdo: gira y sube o baja', 'Mantén pulsado FUEGO para lanzar bolas de fuego', `Destruye ${DR_TOWERS} torres en ${DR_TIME} s`, 'Atraviesa los anillos para ganar puntos · 3 vidas'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
