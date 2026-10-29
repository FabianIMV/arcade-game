import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, Lives, SCREEN_H, SCREEN_W, clamp, hx, tglow, uid, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { dragon, house, shade } from '../utils/prefabs';
import { compassAngle, forward, makeHeightmap, project, seeded } from '../utils/openworld';

// Dirección de vuelo (nariz) con yaw y cabeceo: mismo convenio que forward() (yaw 0 mira hacia -Z).
const dirOf = (yaw, pitch) => { const c = Math.cos(pitch); return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c]; };

// JINETE DE DRAGÓN – vuelo en tercera persona sobre montañas, valles y lagos.
// Joystick izquierdo: gira (izquierda/derecha) y sube o baja (arriba/abajo). FUEGO (mantener): bolas de fuego.
// Destruye las torres enemigas (2 impactos cada una) antes de que acabe el tiempo; los anillos dan puntos.
// Las torres disparan: 3 vidas. Chocar con el terreno también resta una vida.
const DR_SIZE = 240, DR_TOWERS = 14, DR_RINGS = 16, DR_TIME = 200, DR_CEIL = 90;
const DR_SPEED = 26, DR_TURN = 1.6;
const DR_FIRE_CD = 0.3, DR_FB_SPEED = 64, DR_SHOT_SPEED = 15, DR_RANGE = 85;
const DR_SKY = '#9fd4ff';
const DR_SEA = '#2a6fb8';

// Colores del terreno por altura: valle y lago, hierba, roca y nieve.
const drColor = (y, x, z) => {
  const base = y < 0 ? '#1d4a66' : y < 4 ? '#d9c58a' : y < 22 ? '#5aa84a' : y < 36 ? '#7c7a62' : '#eef4ff';
  return shade(base, 0.92 + ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.16);
};

// Torre enemiga: prefab de casa tipo torre (por instancing) + orbe magenta que palpita.
const towerObjs = (t, time) => [
  ...house(`tw${t.id}`, [t.x, t.y, t.z], { kind: 'tower', c: t.hp < 2 ? '#8a6a5a' : '#9aa0ad', roof: '#b3263e', lit: true, n: 1.4, inst: 'torre' }),
  { id: `${t.id}orb`, k: 'sph', p: [t.x, t.y + 16.5 + Math.sin(time * 4) * 0.4, t.z], n: 1.2, c: '#ff3df2', e: 0.9 },
];

const fbObjs = f => [
  { id: `fb${f.id}a`, k: 'sph', p: [f.x, f.y, f.z], n: 1.1, c: C.orange, e: 0.8 },
  { id: `fb${f.id}b`, k: 'sph', p: [f.x, f.y, f.z], n: 0.6, c: '#ffe27a', e: 1 },
];

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const H0 = makeHeightmap(seed, DR_SIZE, { amp: 52 });
  const hm = { size: H0.size, half: H0.half, h: (x, z) => H0.h(x, z) - 14 };   // hundido: aparecen valles con lagos
  const towers = [];
  for (let tries = 0; towers.length < DR_TOWERS && tries < 900; tries++) {
    const x = (r() - 0.5) * DR_SIZE * 0.85, z = (r() - 0.5) * DR_SIZE * 0.85, y = hm.h(x, z);
    if (y < 2 || Math.hypot(x, z) < 35 || towers.some(t => Math.hypot(t.x - x, t.z - z) < 22)) continue;
    towers.push({ id: `${towers.length}`, x, y, z, hp: 2, cd: 1 + r() * 2, alive: true });
  }
  const rings = [];
  for (let tries = 0; rings.length < DR_RINGS && tries < 900; tries++) {
    const x = (r() - 0.5) * DR_SIZE * 0.8, z = (r() - 0.5) * DR_SIZE * 0.8;
    if (Math.hypot(x, z) < 20) continue;
    const y = Math.max(hm.h(x, z), 0) + 12 + r() * 22;
    rings.push({ id: `rg${rings.length}`, x, y, z, a: r() * Math.PI * 2, done: false });
  }
  const sy = Math.max(hm.h(0, 0), 0) + 30;
  const p = { x: 0, y: sy, z: 0 };
  const cam0 = camFor({ p, yaw: 0, pitch: 0 }, hm);
  return {
    hm, towers, rings, fbs: [], shots: [], p, prev: null, pitch: 0, yaw: 0, bank: 0, fire: 0, fireCd: 0, flap: 0,
    lives: 3, inv: 0, time: DR_TIME, got: 0, score: 0, t: 0, toast: null, final: null, over: false,
    terrain: { id: `dragon${seed}`, h: hm.h, size: DR_SIZE, step: 4, color: drColor },
    cp: cam0.p.slice(), cl: cam0.l.slice(),
  };
};

// Cámara en tercera persona, detrás del dragón y siempre sobre el terreno.
function camFor(s, hm) {
  const p = s.p, fh = forward(s.yaw), F = dirOf(s.yaw, s.pitch);
  const cx = p.x - fh[0] * 22, cz = p.z - fh[1] * 22;
  const cy = Math.max(p.y + 6, hm.h(cx, cz) + 3);
  return { p: [cx, cy, cz], l: [p.x + F[0] * 4, p.y + F[1] * 4, p.z + F[2] * 4], fov: 66 };
}

function buildScene(s, t) {
  const p = s.p, alive = s.towers.filter(tw => tw.alive);
  const objs = [];
  objs.push(...dragon('dr', [p.x, p.y, p.z], { yaw: s.yaw, pitch: s.pitch, roll: s.bank, n: 0.9, t, flap: 1, fire: s.fire, c: '#2a9d6b', belly: '#d9f5b0', wing: '#1f6f5a', o: s.inv > 0 && Math.floor(s.t * 12) % 2 === 0 ? 0.55 : 1 }));
  for (const tw of alive) if (Math.hypot(tw.x - p.x, tw.z - p.z) < 160) objs.push(...towerObjs(tw, t));
  for (const rg of s.rings) if (!rg.done && Math.hypot(rg.x - p.x, rg.z - p.z) < 160) objs.push({ id: rg.id, k: 'tor', p: [rg.x, rg.y, rg.z], n: 5, r: [0, rg.a, 0], c: C.lime, e: 0.6 });
  for (const f of s.fbs) objs.push(...fbObjs(f));
  for (const q of s.shots) objs.push({ id: `q${q.id}`, k: 'sph', p: [q.x, q.y, q.z], n: 1.0, c: '#c26bff', e: 0.9 });
  return {
    sky: { top: '#3a8fe8', bottom: DR_SKY, sun: true, clouds: 9 },
    fog: { c: DR_SKY, near: 90, far: 230 },
    shadowR: 30,
    water: { y: 0, c: DR_SEA, o: 0.86, amp: 0.12 },
    terrain: s.terrain,
    objs,
    cam: { p: s.cp, l: s.cl, fov: 66 },
  };
}

export function Dragon3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('dragon');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const stick = useRef({ x: 0, y: 0, on: false }).current;
  const fire = useRef(false);
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); fire.current = false; stick.x = stick.y = 0; setPhase('play'); hx.tap(); };
  const finish = (s, won) => {
    if (s.over) return;
    s.over = true; fire.current = false;
    s.final = s.score + (won ? Math.ceil(s.time) * 5 : 0);
    if (won) hx.win(); else hx.die();
    setRes({ isNew: submitBest(s.final), won }); setPhase('over');
  };
  const hurt = (s, msg) => {
    s.lives -= 1; s.inv = 1.6; hx.bad(); fx.shake(9, 0.35); fx.flash(C.red, 0.3);
    burst3d([s.p.x, s.p.y, s.p.z], ['#ff4d4d', '#ffb0a0', '#ffffff'], 24, { speed: 6, size: 0.18, life: 0.8 });
    s.toast = { m: msg, t: 1.3 };
    if (s.lives <= 0) finish(s, false);
  };
  const scrOf = (cam, pt) => project(cam, pt, SCREEN_W, SCREEN_H) || { x: SCREEN_W / 2, y: SCREEN_H / 2 };

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
    p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim);
    p.y = Math.min(DR_CEIL, p.y);
    s.fire += ((fire.current ? 1 : 0) - s.fire) * Math.min(1, dt * 10);

    // choque con el terreno o con el agua: rebota hacia arriba y quita una vida
    const surf = Math.max(s.hm.h(p.x, p.z), 0);
    if (p.y - 1.5 < surf) {
      p.y = surf + 9; s.pitch = 0.35; s.prev = { x: p.x, y: p.y, z: p.z };
      if (s.inv <= 0) { hurt(s, '💥 ¡Choque contra el terreno!'); if (s.over) return; }
    }

    // torres: son un obstáculo sólido
    for (const t of s.towers) {
      if (!t.alive || p.y > t.y + 16 || Math.hypot(t.x - p.x, t.z - p.z) > 3) continue;
      s.pitch = 0.4;
      if (s.inv <= 0) { hurt(s, '🧱 ¡Torre!'); if (s.over) return; }
    }

    // anillos: se cuentan si el dragón atraviesa su plano cerca del centro
    const cam = camFor(s, s.hm);
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
          ring3d([rg.x, rg.y, rg.z], C.lime, 26, { speed: 7, life: 0.7 });
          burst3d([rg.x, rg.y, rg.z], [C.lime, '#ffffff', C.amber], 26, { speed: 6, life: 0.9, size: 0.2 });
          const q = scrOf(cam, [rg.x, rg.y, rg.z]); fx.pop(q.x, q.y, '+50', C.lime);
        }
      }
    }

    // disparo: bolas de fuego hacia donde mira el dragón
    if (fire.current && s.fireCd <= 0) {
      s.fireCd = DR_FIRE_CD; hx.tick();
      const mo = mouth(s);
      s.fbs.push({ id: uid(), x: mo[0], y: mo[1], z: mo[2], vx: F[0] * DR_FB_SPEED, vy: F[1] * DR_FB_SPEED, vz: F[2] * DR_FB_SPEED, life: 2.4 });
      if (s.fbs.length > 14) s.fbs.shift();
    }
    // llama continua en la boca mientras se mantiene el botón
    if (fire.current) { const mo = mouth(s); burst3d(mo, ['#ff9d2e', '#ffe27a', '#ff5a1f'], 3, { speed: 4, up: 0.5, g: -1.5, size: 0.35, life: 0.45, spread: 0.25 }); }
    for (let i = s.fbs.length - 1; i >= 0; i--) {
      const f = s.fbs[i];
      f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      if (Math.random() < 0.6) burst3d([f.x, f.y, f.z], ['#ff9d2e', '#ffe27a'], 1, { speed: 1, g: -0.5, size: 0.3, life: 0.4, drag: 2 });
      let hit = f.life <= 0 || f.y < Math.max(s.hm.h(f.x, f.z), 0);
      for (const t of s.towers) {
        if (hit || !t.alive || Math.hypot(t.x - f.x, t.z - f.z) > 3.4 || f.y < t.y || f.y > t.y + 17) continue;
        hit = true; t.hp -= 1;
        const q = scrOf(cam, [f.x, f.y, f.z]);
        if (t.hp <= 0) {
          t.alive = false; s.got += 1; s.score += 150; hx.hit(); fx.flash(C.amber, 0.2); fx.shake(4, 0.2);
          burst3d([t.x, t.y + 10, t.z], [C.orange, '#ffe27a', '#ff3df2', '#ffffff'], 60, { speed: 9, up: 4, g: 10, size: 0.3, life: 1.3 });
          ring3d([t.x, t.y + 1, t.z], C.amber, 30, { speed: 8, life: 0.8, size: 0.25 });
          fx.pop(q.x, q.y, '+150', C.amber);
          s.toast = { m: `🔥 Torre ${s.got}/${DR_TOWERS}`, t: 1.4 };
        } else { hx.tick(); burst3d([f.x, f.y, f.z], [C.orange, '#ffe27a'], 16, { speed: 6, life: 0.6 }); }
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
    s.cam = cam;

    // cámara suave: se acerca a su objetivo con un retardo corto
    const target = camFor(s, s.hm), k = 1 - Math.exp(-dt * 7);
    for (let i = 0; i < 3; i++) { s.cp[i] += (target.p[i] - s.cp[i]) * k; s.cl[i] += (target.l[i] - s.cl[i]) * k; }
  });

  const s = g.current;
  const alive = s.towers.filter(tw => tw.alive);
  const p = s.p;
  let target = null, td = 1e9;
  alive.forEach(tw => { const d = Math.hypot(tw.x - p.x, tw.z - p.z); if (d < td) { td = d; target = tw; } });
  const ang = target ? compassAngle(p, s.yaw, target) : 0;
  const sc = s.final != null ? s.final : s.score;
  const scene = buildScene(s, s.t);
  return (
    <Game3D title="JINETE DE DRAGÓN" emoji="🐉" accent={C.orange} onExit={onExit} score={sc} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(s, t)} orbit={{ r: 26, h: 9, speed: 0.12, ly: 2.5 }}
      hud={<><Lives n={s.lives} max={3} /><HudPill icon="🔥" value={`${s.got}/${DR_TOWERS}`} color={C.orange} /><HudPill icon="⏱" value={`${Math.ceil(s.time)}s`} color={s.time < 20 ? C.red : C.amber} /></>}
      subtitle="Vuela sobre montañas y lagos"
      lines={['Joystick izquierdo: gira y sube o baja', 'Mantén pulsado FUEGO para lanzar bolas de fuego', `Destruye ${DR_TOWERS} torres en ${DR_TIME} s (cada una resiste 2 impactos)`, 'Atraviesa los anillos para ganar puntos · 3 vidas']}
      result={{ won: res.won, isNew: res.isNew, title: res.won ? '¡TODAS LAS TORRES!' : 'EL DRAGÓN CAYÓ', emoji: res.won ? '🏆' : '🐉', subtitle: res.won ? 'El cielo es tuyo' : `🔥 ${s.got}/${DR_TOWERS} torres destruidas`, stats: [['TORRES', `${s.got}/${DR_TOWERS}`], ['VIDAS', String(s.lives)], ['TIEMPO', `${Math.ceil(s.time)}s`]] }}>
      {phase === 'play' && target && (
        <TopPill>
          <Text style={{ color: C.orange, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Torre a {Math.round(td)} m</Text>
        </TopPill>
      )}
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '24%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      <Stick3D testID="dr-move" v={stick} side="left" color={C.orange} />
      <ActionBtn testID="dr-fire" label="FUEGO" icon="🔥" color={C.orange} onDown={() => { fire.current = true; }} onUp={() => { fire.current = false; }} style={{ right: 24, bottom: 40 }} />
    </Game3D>
  );
}

// Píldora centrada arriba con la flecha hacia la torre más cercana.
function TopPill({ children }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>{children}</View>
    </View>
  );
}

// Boca del dragón en coordenadas del mundo (sale de la cabeza, en su dirección de vuelo).
function mouth(s) {
  const F = dirOf(s.yaw, s.pitch), p = s.p;
  return [p.x + F[0] * 7.2, p.y + F[1] * 7.2 + 1.2, p.z + F[2] * 7.2];
}
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
