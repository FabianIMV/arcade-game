import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, alpha, clamp, hx, pick, rand, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { animal, hash01, person, rock, shade, tree } from '../utils/prefabs';
import { followCam, forward, makeHeightmap, near, seeded, stepPlayer } from '../utils/openworld';

// LAGO DE PESCA – lago grande con agua que ondula, rodeado de bosque y muelles. Tercera persona.
// Joystick izquierdo: caminar · derecho: girar. LANZAR junto al agua, mirando hacia ella.
// Cuando el corcho se hunda pulsa RECOGER (0,8 s) y luego mantén TENSAR en la zona verde sin pasarte.
// Dificultad progresiva: cada captura hace que el pez tire más fuerte.
//
// Qué enseña este archivo:
//  · scene.water (olas low-poly que siguen a la cámara) sobre un terrain con el fondo del lago
//  · statics: muelles, postes, árboles y rocas precalculados (instancing)
//  · animal('fish') con inst:'pez': 36 peces nadando sin una malla por pez
//  · ring3d para las ondas del corcho, burst3d para salpicaduras, y un pez volando al saco

const PS_SIZE = 160, PS_HALF = 80, PS_LR = 24, PS_TIME = 150, PS_FISH = 36, PS_TREES = 130, PS_LAND = 25;
const PS_WATER = 0.25;                          // altura del terreno por debajo de la cual es agua
const PS_CAST = 14;                             // distancia máxima de lanzamiento
const PS_PIERS = [{ a: 0.5, tip: 18 }, { a: 2.3, tip: 11 }, { a: 4.1, tip: 5.5 }];   // el más lejano da peces raros
const PS_SPECIES = {
  orilla: [{ n: 'Perca', c: '#c9d46a', w: [0.1, 0.6], sz: 0.45, pull: 0.8, m: 1 }, { n: 'Sardina', c: '#d6eef5', w: [0.05, 0.25], sz: 0.3, pull: 0.6, m: 1 }],
  medio: [{ n: 'Trucha', c: '#f08a4b', w: [0.8, 3], sz: 0.7, pull: 1.0, m: 2 }, { n: 'Carpa', c: '#d9a441', w: [1.5, 5], sz: 0.9, pull: 1.1, m: 2 }],
  raro: [{ n: 'Dorado', c: '#ffd23f', w: [4, 9], sz: 1.1, pull: 1.3, m: 4 }, { n: 'Pez luna', c: '#b08cff', w: [8, 15], sz: 1.4, pull: 1.5, m: 6 }],
};
const PS_RING = { orilla: [14, 17.5], medio: [9.5, 13.5], raro: [2.5, 8] };
const zoneOf = r => (r >= 15 ? 'orilla' : r >= 9 ? 'medio' : 'raro');
const SEA = '#bfe6ff', WATER_C = '#2aa0e0';

// suave: se acerca a la cámara ideal (lerp exponencial)
const smoothCam = (s, dt, ideal) => {
  if (!s.cam) { s.cam = ideal; return; }
  const k = 1 - Math.exp(-dt * 9), mix = (a, b) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  s.cam = { p: mix(s.cam.p, ideal.p), l: mix(s.cam.l, ideal.l), fov: ideal.fov };
};

// Lago: cuenca en el centro (y < 0) con orilla suave; fuera, colinas de llanura.
const buildLake = seed => {
  const base = makeHeightmap(seed, PS_SIZE, { amp: 3 });
  const h = (x, z) => {
    const d = Math.hypot(x, z) / PS_LR;
    const bowl = -1.6 + d * d * 3.2;
    const plain = base.h(x, z) * 0.7 + 1.4;
    const t = clamp((d - 0.82) / 0.3, 0, 1);
    const k = t * t * (3 - 2 * t);
    return bowl * (1 - k) + plain * k;
  };
  return { size: PS_SIZE, half: PS_HALF, h };
};

// Muelles: franjas de madera sobre el agua que llegan hasta la orilla.
const onPier = (x, z) => {
  for (const pr of PS_PIERS) {
    const u0 = Math.cos(pr.a), u1 = Math.sin(pr.a);
    const al = x * u0 + z * u1, ac = -x * u1 + z * u0;
    if (al > pr.tip && al < PS_LAND && Math.abs(ac) < 1.1) return true;
  }
  return false;
};
const floorAt = (hm, x, z) => (onPier(x, z) ? Math.max(hm.h(x, z), 0.45) : hm.h(x, z));
const colorOf = y => (y < -0.2 ? '#3f5a4a' : y < PS_WATER ? '#e0cc86' : y < 2.4 ? '#5fae4a' : '#8a8a80');
const terrainColor = (y, x, z) => shade(colorOf(y), 0.93 + hash01(x.toFixed(1) + ',' + z.toFixed(1)) * 0.14);

// Muelles y postes (statics: se calculan una vez)
const pierObjs = () => PS_PIERS.flatMap((pr, i) => {
  const u0 = Math.cos(pr.a), u1 = Math.sin(pr.a), len = PS_LAND - pr.tip, mid = (PS_LAND + pr.tip) / 2;
  const out = [{ id: `pd${i}`, k: 'box', p: [u0 * mid, 0.35, u1 * mid], s: [2.2, 0.2, len], r: [0, Math.atan2(u0, u1), 0], c: '#8a6a42', sh: true, recv: true }];
  for (let al = pr.tip + 1.5; al < PS_LAND - 1; al += 4) out.push({ id: `pp${i}_${Math.round(al)}`, k: 'cyl', p: [u0 * al, -0.6, u1 * al], s: [0.3, 2, 0.3], c: '#4a3620', inst: 'poste', sh: true });
  return out;
});

const buildTrees = (r, hm) => {
  const out = [];
  for (let guard = 0; out.length < PS_TREES && guard < 4000; guard++) {
    const x = (r() - 0.5) * PS_SIZE * 0.7, z = (r() - 0.5) * PS_SIZE * 0.7;
    const d = Math.hypot(x, z);
    if (d < 30 || d > 58 || hm.h(x, z) < 0.6) continue;
    const pine = r() < 0.5;
    out.push({ id: `t${out.length}`, x, z, y: hm.h(x, z), h: 0.75 + r() * 0.4, kind: pine ? 'pine' : 'oak', c: pine ? '#2f7d3a' : '#3c8f45' });
  }
  return out;
};

const buildFish = r => {
  const out = [];
  for (let i = 0; i < PS_FISH; i++) {
    const zone = ['orilla', 'medio', 'raro'][i % 3];
    const [r0, r1] = PS_RING[zone];
    const rr = r0 + r() * (r1 - r0), a = r() * 6.283;
    const list = PS_SPECIES[zone];
    const sp = list[Math.floor(r() * list.length)];
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    out.push({ id: `pz${i}`, h0x: x, h0z: z, x, z, a: r() * 6.283, t: r() * 3, sz: sp.sz * (0.8 + r() * 0.4), c: sp.c, ph: r() * 6 });
  }
  return out;
};

// ¿Puede estar el jugador en (x, z)? No se entra al agua ni a los árboles.
const walkable = (s, x, z) => {
  if (onPier(x, z)) return true;
  if (s.hm.h(x, z) < PS_WATER) return false;
  for (const t of s.trees) if (Math.hypot(t.x - x, t.z - z) < 0.8) return false;
  return true;
};

const physics = (s, dt, move) => {
  const p = s.p;
  const ox = p.x, oy = p.y, oz = p.z, ovy = p.vy;
  const moved = stepPlayer(p, move, dt, { yaw: s.yaw, floor: (x, z) => floorAt(s.hm, x, z), bounds: PS_HALF - 4, speed: 5.5 });
  if (!walkable(s, p.x, p.z)) {   // orilla: se frena antes del agua
    p.x = ox; p.z = oz; p.vy = ovy - 22 * dt; p.y = oy + p.vy * dt;
  }
  const gy = floorAt(s.hm, p.x, p.z);
  if (p.y <= gy) { p.y = gy; p.vy = 0; p.ground = true; } else p.ground = false;
  s.walk += ((moved / Math.max(dt, 1e-3) > 1 ? 1 : 0) - s.walk) * Math.min(1, dt * 10);
};

// Primer punto de agua delante de la cámara entre 5 y PS_CAST m (el corcho no cae pegado a la orilla), o null.
const findWater = (s, p) => {
  const f = forward(s.yaw);
  for (let d = 5; d <= PS_CAST; d += 0.4) {
    const x = p.x + f[0] * d, z = p.z + f[1] * d;
    if (s.hm.h(x, z) < PS_WATER && !onPier(x, z)) return { x, z, r: Math.hypot(x, z) };
  }
  return null;
};

// Punta de la caña y posición del corcho (fly = en el aire, luego flota o se hunde).
const tipOf = s => { const p = s.p; const f = forward(s.yaw); return [p.x + f[0] * 0.8, p.y + 2.0, p.z + f[1] * 0.8]; };
const corkPos = (s, c) => {
  const tip = tipOf(s);
  if (c.stage === 'fly') {
    const k = Math.min(1, c.t / 0.6);
    return [tip[0] + (c.x - tip[0]) * k, tip[1] + (0.05 - tip[1]) * k + Math.sin(k * Math.PI) * 2.5, tip[2] + (c.z - tip[2]) * k, tip];
  }
  return [c.x, 0.05 - c.sink * 0.7 + (c.stage === 'wait' ? Math.sin(s.t * 3) * 0.06 : 0), c.z, tip];
};

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const hm = buildLake(seed);
  const trees = buildTrees(r, hm);
  const rocks = Array.from({ length: 18 }, (_, i) => {
    const a = r() * 6.283, rr = 19 + r() * 4;
    return { id: `ro${i}`, x: Math.cos(a) * rr, z: Math.sin(a) * rr, s: 0.6 + r() * 0.6, c: r() < 0.5 ? '#9a9488' : '#8c8f99' };
  }).filter(o => hm.h(o.x, o.z) > 0.4);
  const statics = [
    ...pierObjs(),
    ...trees.flatMap(t => tree(t.id, [t.x, t.y, t.z], { kind: t.kind, h: t.h, leaf: t.c, inst: t.kind === 'pine' ? 'pino' : 'roble' })),
    ...rocks.flatMap(o => rock(o.id, [o.x, hm.h(o.x, o.z), o.z], { kind: 'rock', c: o.c, h: o.s, inst: 'roca' })),
  ];
  return {
    hm, trees, statics, terrain: { id: `lago${seed}`, h: hm.h, size: PS_SIZE, step: 2.5, color: terrainColor },
    fish: buildFish(r), cast: null, pop: null,
    p: { x: 0, y: hm.h(0, 21), z: 21, vy: 0, face: 0, ground: true }, yaw: 0, cam: null, walk: 0,
    time: PS_TIME, score: 0, catches: 0, kg: 0, t: 0, toast: null, final: null,
  };
};

const swimFish = (s, dt) => {
  for (const f of s.fish) {
    f.t -= dt;
    if (f.t <= 0) { f.a += (Math.random() - 0.5) * 2.5; f.t = 0.8 + Math.random() * 1.5; }
    const nx = f.x + Math.cos(f.a) * 0.7 * dt, nz = f.z + Math.sin(f.a) * 0.7 * dt;
    if (Math.hypot(nx - f.h0x, nz - f.h0z) < 2.5 && s.hm.h(nx, nz) < PS_WATER && !onPier(nx, nz)) { f.x = nx; f.z = nz; }
    else f.a = Math.atan2(f.h0z - f.z, f.h0x - f.x);
  }
};

// Escena (juega y sirve de fondo animado en inicio/fin)
function buildScene(s, t) {
  const p = s.p, c = s.cast, f = forward(s.yaw);
  const objs = [];
  for (const q of near(s.fish, p, 30)) {
    // el pez mira hacia donde nada (cos a, sin a)
    objs.push(...animal(q.id, 'fish', [q.x, -0.45, q.z], { yaw: Math.atan2(-Math.cos(q.a), -Math.sin(q.a)), c: q.c, t: t + q.ph, n: q.sz * 1.3, inst: 'pez' }));
  }
  if (s.pop) {   // el pez capturado sale del agua y vuela hasta el pescador
    const k = Math.min(1, s.pop.t / 0.9);
    const x = s.pop.x + (p.x - s.pop.x) * k, z = s.pop.z + (p.z - s.pop.z) * k, y = 0.2 + Math.sin(k * Math.PI) * 2.2;
    objs.push(...animal('pop', 'fish', [x, y, z], { yaw: Math.atan2(-(p.x - s.pop.x), -(p.z - s.pop.z)), c: s.pop.c, t: t * 6, n: 1.4 }));
  }
  // pescador: person() de pie, caña en la mano y sedal
  objs.push(...person('yo', [p.x, p.y, p.z], { yaw: p.face, t, walk: s.walk, hat: 'straw', shirt: '#2f6fd8', pants: '#3b3f58' }));
  // mano derecha: 0,4 m a la derecha (-f.z, f.x) y 0,2 m hacia delante
  const tip = tipOf(s), hand = [p.x - f[1] * 0.4 + f[0] * 0.2, p.y + 1.1, p.z + f[0] * 0.4 + f[1] * 0.2];
  for (let i = 1; i <= 4; i++) { const k = i / 5; objs.push({ id: `cana${i}`, k: 'sph', p: [hand[0] + (tip[0] - hand[0]) * k, hand[1] + (tip[1] - hand[1]) * k, hand[2] + (tip[2] - hand[2]) * k], n: 0.07, c: '#8a5a2b' }); }
  if (c) {
    const [cx, cy, cz] = corkPos(s, c);
    for (let i = 0; i < 6; i++) {
      const k = (i + 1) / 7;
      objs.push({ id: `ln${i}`, k: 'sph', p: [tip[0] + (cx - tip[0]) * k, tip[1] + (cy - tip[1]) * k, tip[2] + (cz - tip[2]) * k], n: 0.05, c: '#f2f2f2', sh: false });
    }
    objs.push({ id: 'corA', k: 'sph', p: [cx, cy, cz], s: [0.24, 0.24, 0.24], c: '#ff3b3b' });
    objs.push({ id: 'corB', k: 'sph', p: [cx, cy + 0.15, cz], n: 0.11, c: '#ffffff' });
  }
  return {
    sky: { top: '#2f86e6', bottom: SEA, sun: true, sunC: '#fff2c0', clouds: 7 },
    light: { dir: [-0.5, 0.8, 0.35], sun: '#fff4dc', i: 2.5, sky: '#dfeaff', ground: '#5b5648', hi: 1.8 },
    fog: { c: SEA, near: 45, far: 120 }, shadowR: 26,
    terrain: s.terrain, statics: s.statics,
    water: { y: 0, c: WATER_C, o: 0.72, amp: 0.09 },
    objs, cam: s.cam || followCam(p, s.yaw, { dist: 10, height: 5.5, look: 6, hm: s.hm }),
  };
}

export function Pesca3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('pesca');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = s => {
    s.final = s.score; s.cast = null; s.pop = null;
    hx.win();
    setRes({ isNew: submitBest(s.final) }); setPhase('over');
  };

  // LANZAR: el corcho vuela al primer agua delante de la cámara
  const doA = () => {
    const s = g.current;
    if (s.cast) return;
    const tgt = findWater(s, s.p);
    if (!tgt) { hx.tick(); s.toast = { m: 'Mira hacia el agua (a menos de 14 m)', t: 1.4 }; return; }
    const zone = zoneOf(tgt.r), sp = pick(PS_SPECIES[zone]);
    s.cast = { stage: 'fly', t: 0, x: tgt.x, z: tgt.z, zone, sp, kg: rand(sp.w[0], sp.w[1]), waitT: rand(2.5, 5), sink: 0, tens: 0.25, prog: 0, held: false, rip: 0 };
    hx.tap();
  };
  // RECOGER (y luego TENSAR, mantener): el mismo botón
  const doB = () => {
    const c = g.current.cast;
    if (!c) return;
    if (c.stage === 'bite') { c.stage = 'tens'; c.tens = 0.25; c.prog = 0; c.held = true; hx.tap(); }
    else if (c.stage === 'tens') c.held = true;
  };
  const upB = () => { const c = g.current.cast; if (c) c.held = false; };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt; s.time -= dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.time <= 0) { s.time = 0; finish(s); return; }
    s.yaw -= look.x * 2.4 * dt;
    physics(s, dt, move);
    swimFish(s, dt);
    smoothCam(s, dt, followCam(s.p, s.yaw, { dist: 10, height: 5.5, look: 6, hm: s.hm }));
    if (s.pop) { s.pop.t += dt; if (s.pop.t >= 0.9) s.pop = null; }
    const c = s.cast;
    if (!c) return;
    if (c.stage === 'fly') {
      c.t += dt;
      if (c.t >= 0.6) {
        c.stage = 'wait'; c.t = 0;
        burst3d([c.x, 0.1, c.z], ['#ffffff', '#bfe6ff'], 12, { speed: 2.5, up: 2.5, g: 9, size: 0.12, life: 0.5 });
        ring3d([c.x, 0.05, c.z], '#ffffff', 16, { speed: 3.5, life: 0.6 });
      }
    } else if (c.stage === 'wait') {
      c.t += dt; c.rip -= dt;
      if (c.rip <= 0) { c.rip = 1.1; ring3d([c.x, 0.05, c.z], '#e9f8ff', 12, { speed: 2.2, life: 0.8 }); }
      if (c.t >= c.waitT) { c.stage = 'bite'; c.t = 0; hx.hit(); fx.shake(3, 0.2); s.toast = { m: '🎣 ¡PICA! Pulsa RECOGER', t: 1 }; burst3d([c.x, 0.2, c.z], ['#ffffff', '#9fd8ff'], 20, { speed: 4, up: 4, g: 9, size: 0.14, life: 0.6 }); }
    } else if (c.stage === 'bite') {
      c.t += dt; c.sink = Math.min(1, c.t / 0.25);
      if (c.t >= 0.8) { hx.bad(); s.toast = { m: '🐟 Se escapó…', t: 1.4 }; s.cast = null; }
    } else if (c.stage === 'tens') {
      const pull = c.sp.pull * (1 + s.catches * 0.04);   // cada captura, el pez tira más fuerte
      c.tens = clamp(c.tens + (c.held ? 0.5 * pull : -0.4) * dt, 0, 1);
      if (c.tens >= 1) { hx.bad(); fx.shake(8, 0.3); s.toast = { m: '💥 ¡Se rompió el sedal!', t: 1.6 }; s.cast = null; return; }
      if (c.tens >= 0.45 && c.tens <= 0.8) c.prog = Math.min(1, c.prog + dt * 0.28);
      else if (c.tens < 0.45) c.prog = Math.max(0, c.prog - dt * 0.06);
      if (c.prog >= 1) {
        const pts = Math.round(c.kg * 10 * c.sp.m);
        s.score += pts; s.kg += c.kg; s.catches += 1;
        if (c.sp.m >= 4) hx.win(); else hx.good();
        fx.flash(c.sp.c, 0.25);
        burst3d([c.x, 0.3, c.z], [c.sp.c, '#ffffff'], 26, { speed: 4, up: 5, g: 10, size: 0.16, life: 0.8 });
        s.pop = { t: 0, x: c.x, z: c.z, c: c.sp.c };
        s.toast = { m: `🐟 ${c.sp.n} ${c.kg.toFixed(1)} kg · +${pts}`, t: 2 };
        s.cast = null;
      }
    }
  });

  const s = g.current; const p = s.p; const c = s.cast;
  const water = phase === 'play' ? findWater(s, p) : null;
  const scene = buildScene(s, phase === 'play' ? s.t : 0);
  const sc = s.final != null ? s.final : s.score;
  const BAR = 240;
  const labelA = c ? 'EN CURSO' : water ? 'LANZAR' : 'SIN AGUA';
  const labelB = c && c.stage === 'bite' ? 'RECOGER' : c && c.stage === 'tens' ? 'TENSAR' : '···';
  const reelOn = !!c && (c.stage === 'bite' || c.stage === 'tens');
  return (
    <Game3D title="LAGO DE PESCA" emoji="🎣" accent={C.lime} onExit={onExit} score={sc} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(s, t)} orbit={{ r: 18, h: 7, speed: 0.12, ly: 1.5 }}
      hud={<><HudPill icon="🐟" value={String(s.catches)} color={C.lime} /><HudPill icon="⚖️" value={`${s.kg.toFixed(1)} kg`} color={C.amber} /><HudPill icon="⏱" value={`${Math.ceil(s.time)}s`} color={s.time < 20 ? C.red : C.cyan} /></>}
      subtitle="Pesca en el lago y gana puntos por peso"
      lines={['Joystick izquierdo: caminar · derecho: girar la cámara', 'LANZAR junto al agua, mirando hacia ella', 'Cuando el corcho se hunda: RECOGER (0,8 s) y luego TENSAR', `Los muelles lejanos tienen peces raros · ${PS_TIME} s`]}
      result={{ won: true, isNew: res.isNew, title: '¡SE ACABÓ LA PESCA!', emoji: '🎣', subtitle: s.catches > 0 ? 'Buena jornada junto al lago' : 'Hoy el lago no ha querido picar', stats: [['PECES', String(s.catches)], ['PESO', `${s.kg.toFixed(1)} kg`], ['PUNTOS', String(s.score)]] }}>
      {c && c.stage === 'tens' && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 14, left: '50%', marginLeft: -BAR / 2, width: BAR, alignItems: 'stretch' }}>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12, textAlign: 'center', marginBottom: 4, ...tglow('#000', 6) }}>TENSIÓN · mantén TENSAR en la zona verde</Text>
          <View style={{ height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <View style={{ position: 'absolute', left: BAR * 0.45, width: BAR * 0.35, top: 0, bottom: 0, backgroundColor: alpha(C.lime, 0.6) }} />
            <View style={{ position: 'absolute', left: BAR * 0.8, width: BAR * 0.2, top: 0, bottom: 0, backgroundColor: alpha(C.red, 0.6) }} />
            <View style={{ position: 'absolute', left: clamp(c.tens * BAR, 0, BAR - 4), width: 4, top: -3, bottom: -3, backgroundColor: '#ffffff' }} />
          </View>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11, marginTop: 8, textAlign: 'center' }}>Recogiendo</Text>
          <View style={{ height: 8, borderRadius: 4, marginTop: 3, backgroundColor: 'rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <View style={{ width: BAR * c.prog, height: 8, backgroundColor: C.amber }} />
          </View>
        </View>
      )}
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '30%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 20, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      <Stick3D testID="ps-move" v={move} side="left" color={C.lime} />
      <Stick3D testID="ps-look" v={look} side="right" color={C.cyan} />
      <ActionBtn testID="ps-cast" label={labelA} color={C.lime} onDown={doA} style={{ left: '50%', marginLeft: -33, bottom: 24, opacity: c || water ? 1 : 0.5 }} />
      <ActionBtn testID="ps-reel" label={labelB} color={C.amber} onDown={doB} onUp={upB} style={{ left: '50%', marginLeft: -33, bottom: 98, opacity: reelOn ? 1 : 0.35 }} />
    </Game3D>
  );
}
