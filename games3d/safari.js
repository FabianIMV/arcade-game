import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, SCREEN_H, SCREEN_W, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { animal, car, hash01, rock, shade, tree } from '../utils/prefabs';
import { followCam, makeHeightmap, near, project, seeded } from '../utils/openworld';

// SAFARI FOTO 3D: conduce un jeep por la sabana y fotografía fauna. Joystick izquierdo: conducir ·
// derecho: girar la cámara · 📷 FOTO: centra un animal en el visor y a menos de 18 m.
// Puntos por rareza (1 común · 2 poco común · 3 rara) + bonus por la primera foto de cada especie.
const SF_SIZE = 120, SF_LIM = 54, SF_TIME = 120, SF_FILM = 12, SF_RANGE = 18, SF_DRAW = 30, SF_MAX = 15, SF_REV = 6;
const SF_BASE = [0, 100, 200, 350], SF_NEW = [0, 150, 300, 450];
// Especies con prefab de animal (kind) y su aspecto: escala n, velocidad sp y huida fl (m/s)
const SPECIES = [
  { name: 'Cebra', kind: 'horse', rar: 1, c: '#f4f1ea', n: 1.0, sp: 2.4, fl: 6.5 },
  { name: 'Gacela', kind: 'deer', rar: 1, c: '#d9a86a', n: 0.95, sp: 3.0, fl: 9 },
  { name: 'Ñu', kind: 'cow', rar: 1, c: '#6d6a62', n: 1.0, sp: 2.2, fl: 6.5 },
  { name: 'Jabalí', kind: 'pig', rar: 1, c: '#6b5136', n: 0.9, sp: 2.2, fl: 7 },
  { name: 'Hiena', kind: 'dog', rar: 2, c: '#9f8a68', n: 1.0, sp: 2.2, fl: 6.5 },
  { name: 'Búfalo', kind: 'cow', rar: 2, c: '#4a3a2c', n: 1.25, sp: 1.8, fl: 5 },
  { name: 'Leopardo', kind: 'cat', rar: 3, c: '#e6b452', n: 1.1, sp: 2.4, fl: 8 },
  { name: 'León', kind: 'cat', rar: 3, c: '#d19a4b', n: 1.3, sp: 2.1, fl: 7 },
  { name: 'Rinoceronte', kind: 'cow', rar: 3, c: '#7e8189', n: 1.55, sp: 1.5, fl: 4 },
  { name: 'Elefante', kind: 'cow', rar: 3, c: '#8c8f99', n: 2.1, sp: 1.6, fl: 4.5 },
];
const SKY = { top: '#3d8fd9', bottom: '#f2e2b0', sun: true, clouds: 6 };
const sfColor = y => (y < 0.5 ? '#9fb55a' : y < 1.6 ? '#d7bd6a' : '#c9a85c');
const cl = (v, m) => Math.max(-m, Math.min(m, v));
// Yaw con el que el frente del prefab (−Z) mira hacia (dx, dz)
const headingTo = (dx, dz) => Math.atan2(-dx, -dz);
const turn = (cur, want, k) => cur + Math.atan2(Math.sin(want - cur), Math.cos(want - cur)) * Math.min(1, k);
const camOf = s => followCam(s.p, s.yaw, { dist: 9, height: 4.2, look: 2.5, hm: s.hm });

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9), r = seeded(seed);
  const hm = makeHeightmap(seed, SF_SIZE, { amp: 2.2 });
  const at = minD => {
    for (let k = 0; k < 300; k++) { const x = (r() - 0.5) * 2 * SF_LIM, z = (r() - 0.5) * 2 * SF_LIM; if (Math.hypot(x, z) > minD) return { x, z, y: hm.h(x, z) }; }
    return { x: minD, z: minD, y: hm.h(minD, minD) };
  };
  const animals = [];
  SPECIES.forEach((sp, si) => {
    for (let j = 0; j < (sp.rar === 1 ? 3 : 2); j++) {
      const q = at(16);
      animals.push({ id: `an${animals.length}`, k: si, x: q.x, z: q.z, y: q.y, hx0: q.x, hz0: q.z, h: r() * 6.28, mv: 0, tx: q.x, tz: q.z, tm: 1 + r() * 3, walk: false, fl: 0 });
    }
  });
  const solids = [], st = [];
  for (let i = 0; i < 60; i++) { const q = at(8); solids.push({ x: q.x, z: q.z, rad: 0.7 }); st.push(...tree(`ac${i}`, [q.x, q.y, q.z], { kind: 'palm', inst: 'acacia' })); }
  for (let i = 0; i < 22; i++) { const q = at(8); solids.push({ x: q.x, z: q.z, rad: 0.9 }); st.push(...rock(`rk${i}`, [q.x, q.y, q.z], { kind: 'boulder', c: '#8c8074', inst: 'roca' })); }
  return {
    hm, half: SF_LIM, animals, solids, statics: st,
    terrain: { id: `sabana${seed}`, h: hm.h, size: SF_SIZE, step: 2, color: (y, x, z) => shade(sfColor(y), 0.94 + hash01(x.toFixed(1) + ',' + z.toFixed(1)) * 0.12) },
    p: { x: 0, y: hm.h(0, 0), z: 0, jh: 0 }, v: 0, yaw: 0, spin: 0,
    time: SF_TIME, film: SF_FILM, shots: 0, pts: 0, seen: {}, species: 0, t: 0, toast: null, final: null, done: false,
  };
};

// Jeep: acelerador y freno con el joystick izquierdo (arriba = avanzar), giro con X
function driveJeep(s, move, dt) {
  const p = s.p, thr = -(move.y || 0);
  const target = thr >= 0 ? thr * SF_MAX : thr * SF_REV;
  s.v += (target - s.v) * Math.min(1, dt * (Math.abs(target) > Math.abs(s.v) ? 2.2 : 3.5));
  if (Math.abs(s.v) > 0.5) p.jh -= (move.x || 0) * 1.8 * Math.sign(s.v) * Math.min(1, Math.abs(s.v) / 6) * dt;
  p.x += -Math.sin(p.jh) * s.v * dt; p.z += -Math.cos(p.jh) * s.v * dt;
  p.x = cl(p.x, s.half); p.z = cl(p.z, s.half);
  for (const o of s.solids) {
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), m = o.rad + 1.2;
    if (d < m && d > 1e-3) { p.x = o.x + (dx / d) * m; p.z = o.z + (dz / d) * m; s.v *= 0.5; }
  }
  p.y = s.hm.h(p.x, p.z);
  s.spin += (s.v * dt) / 0.45;
}

// Animales: pastan y deambulan; huyen si el jeep se acerca o va rápido
function stepAnimals(s, dt) {
  const p = s.p, fast = Math.abs(s.v) > 3;
  for (const a of s.animals) {
    const sp = SPECIES[a.k];
    const dj = Math.hypot(a.x - p.x, a.z - p.z);
    if (dj < 5 || (dj < 13 && fast)) a.fl = 2.5;
    let want = a.h, v = 0;
    if (a.fl > 0) { a.fl -= dt; want = headingTo(a.x - p.x, a.z - p.z); v = sp.fl; }
    else {
      a.tm -= dt;
      if (a.tm <= 0) {
        const ang = Math.random() * 6.283, d = 2 + Math.random() * 7;
        a.tx = cl(a.hx0 + Math.cos(ang) * d, s.half); a.tz = cl(a.hz0 + Math.sin(ang) * d, s.half);
        a.tm = 2.5 + Math.random() * 3; a.walk = Math.random() < 0.6;
      }
      if (a.walk && Math.hypot(a.tx - a.x, a.tz - a.z) > 0.6) { want = headingTo(a.tx - a.x, a.tz - a.z); v = sp.sp * 0.45; }
    }
    a.h = turn(a.h, want, dt * (a.fl > 0 ? 6 : 2.5));
    a.mv += (v - a.mv) * Math.min(1, dt * 4);
    a.x = cl(a.x - Math.sin(a.h) * a.mv * dt, s.half); a.z = cl(a.z - Math.cos(a.h) * a.mv * dt, s.half);
    a.y = s.hm.h(a.x, a.z);
  }
}

// Animal centrado en el visor y a menos de SF_RANGE m; devuelve el más centrado con su valor
function aimOf(s, cam) {
  let best = null, bo = 1e9;
  for (const a of s.animals) {
    const sp = SPECIES[a.k];
    const d = Math.hypot(a.x - s.p.x, a.z - s.p.z);
    if (d > SF_RANGE) continue;
    const q = project(cam, [a.x, a.y + 0.9 * sp.n, a.z], SCREEN_W, SCREEN_H);
    if (!q) continue;
    const ox = Math.abs(q.x - SCREEN_W / 2) / (SCREEN_W / 2), oy = Math.abs(q.y - SCREEN_H / 2) / (SCREEN_H / 2);
    if (ox > 0.5 || oy > 0.5) continue;
    const off = Math.hypot(ox, oy);
    if (off < bo) { bo = off; best = { a, sp, d, pts: Math.round(SF_BASE[sp.rar] * (d <= 7 ? 1.6 : d <= 12 ? 1.3 : 1)) }; }
  }
  return best;
}

export function Safari3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('safari');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = s => {
    if (s.done) return;
    s.done = true; s.final = s.pts;
    if (s.species >= 6) hx.win(); else hx.heavy();
    setRes({ isNew: submitBest(s.final) }); setPhase('over');
  };
  const shoot = () => {
    const s = g.current;
    if (phase !== 'play' || s.film <= 0 || s.done) return;
    s.film -= 1;
    const hit = aimOf(s, camOf(s));
    if (!hit) {
      s.toast = { m: '📷 Ningún animal centrado', t: 1.1 };
      hx.warn(); fx.pop(SCREEN_W / 2, SCREEN_H / 2 - 40, 'VACÍA', C.dim, 16);
    } else {
      const first = !s.seen[hit.a.k];
      const bonus = first ? SF_NEW[hit.sp.rar] : 0;
      if (first) { s.seen[hit.a.k] = true; s.species += 1; }
      const got = hit.pts + bonus;
      s.pts += got; s.shots += 1;
      burst3d([hit.a.x, hit.a.y + 1, hit.a.z], ['#fff3b0', '#ffd54a', '#ffffff'], 26, { speed: 4, up: 3, life: 0.8, size: 0.16 });
      ring3d([hit.a.x, hit.a.y + 0.1, hit.a.z], C.lime, 22, { speed: 5, life: 0.6 });
      fx.flash('#ffffff', 0.35);
      if (first) hx.win(); else hx.good();
      fx.pop(SCREEN_W / 2, SCREEN_H / 2 - 40, `+${got}`, C.amber, 26);
      s.toast = { m: `📸 ${hit.sp.name}${first ? ' · NUEVA ESPECIE' : ''}`, t: 1.6 };
    }
    if (s.film <= 0) finish(s);
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.done) return;
    s.t += dt; s.time -= dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.time <= 0) { s.time = 0; finish(s); return; }
    driveJeep(s, move, dt);
    s.yaw -= look.x * 2.4 * dt;
    // sin girar la cámara, vuelve detrás del jeep mientras avanza
    if (Math.abs(look.x) < 0.08 && s.v > 2) s.yaw = turn(s.yaw, s.p.jh, dt * 1.2);
    stepAnimals(s, dt);
  });

  const s = g.current, p = s.p;
  const cam = camOf(s);
  const aim = phase === 'play' ? aimOf(s, cam) : null;
  const objs = [
    ...near(s.animals, p, SF_DRAW).flatMap(a => animal(a.id, SPECIES[a.k].kind, [a.x, a.y, a.z], { yaw: a.h, c: SPECIES[a.k].c, n: SPECIES[a.k].n, t: s.t, walk: a.mv > 0.3 ? 1 : 0, sh: false })),
    ...car('jeep', [p.x, p.y, p.z], { kind: 'suv', yaw: p.jh, c: '#e0a040', spin: s.spin, sh: true }),
  ];
  const scene = { sky: SKY, fog: { c: SKY.bottom, near: 40, far: 110 }, light: { dir: [-0.4, 0.9, 0.3] }, shadowR: 20, terrain: s.terrain, statics: s.statics, objs, cam };
  const sc = s.final != null ? s.final : s.pts;

  return (
    <Game3D title="SAFARI FOTO" emoji="📷" accent={C.lime} onExit={onExit} score={sc} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} orbit={{ r: 12, h: 5, speed: 0.18, ly: 1.2, drop: 1.8 }}
      hud={<>
        <HudPill icon="📷" value={`${s.film}/${SF_FILM}`} color={C.text} />
        <HudPill icon="🦁" value={`${s.species}/${SPECIES.length}`} color={C.lime} />
        <HudPill icon="⏱" value={`${Math.ceil(Math.max(0, s.time))}s`} color={s.time < 20 ? C.red : C.amber} />
      </>}
      subtitle="Recorre la sabana en jeep y fotografía la fauna"
      lines={['Joystick izquierdo: conducir · derecho: girar la cámara', 'Centra un animal en el visor y toca 📷 FOTO', 'Las especies raras dan más puntos · bonus por cada especie nueva', `${SF_FILM} fotos y ${SF_TIME} segundos`]}
      result={{ isNew: res.isNew, title: s.species >= 6 ? '¡BUEN REPORTAJE!' : 'FIN DEL SAFARI', emoji: '📸', subtitle: `${s.shots} fotos · ${s.species}/${SPECIES.length} especies`, stats: [['FOTOS', s.shots], ['ESPECIES', `${s.species}/${SPECIES.length}`]] }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: SCREEN_W / 2 - 34, top: SCREEN_H / 2 - 90, width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: aim ? C.lime : 'rgba(255,255,255,0.55)' }} />
      {aim && (
        <Text pointerEvents="none" style={{ position: 'absolute', top: SCREEN_H / 2 - 10, width: SCREEN_W, textAlign: 'center', color: C.lime, fontSize: 13, fontWeight: '900', ...tglow('#000', 6) }}>
          {aim.sp.name} · {Math.round(aim.d)} m · +{aim.pts}{s.seen[aim.a.k] ? '' : ' (nueva)'}
        </Text>
      )}
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: SCREEN_H * 0.16, width: SCREEN_W, textAlign: 'center', color: '#fff', fontSize: 20, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      <Stick3D testID="sf-move" v={move} side="left" color={C.lime} />
      <Stick3D testID="sf-look" v={look} side="right" color={C.amber} />
      <ActionBtn testID="sf-photo" label="FOTO" icon="📷" color={C.lime} onDown={shoot} style={{ left: '50%', marginLeft: -33, bottom: 34 }} />
    </Game3D>
  );
}
