import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, Lives, SCREEN_H, SCREEN_W, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { enemy, gem, hash01, person, shade } from '../utils/prefabs';
import { compassAngle, followCam, jump, makeHeightmap, seeded, stepPlayer } from '../utils/openworld';

// PLANETA ALIEN – exploración en tercera persona con baja gravedad, en un planeta morado de cráteres.
// Joystick izquierdo: caminar · derecho: girar la cámara · SALTAR (saltos largos).
// Recoge 12 cristales antes de quedarte sin oxígeno. Las cúpulas recargan el oxígeno.
// Los aliens te persiguen si te ven; cada 4 cristales aparece uno más (dificultad progresiva).
//
// Qué enseña este archivo:
//  · scene.terrain con color por altura, cielo con luna (sky.sunC) y luz de planeta extraño
//  · scene.statics: cúpulas precalculadas · gem() animado para los cristales + rayo de luz
//  · person() como astronauta (casco + mochila) · enemy('slime') como aliens
//  · cámara suave (lerp) y polvo lunar con burst3d

const PL_SIZE = 200, PL_HALF = 100, PL_STEP = 2.5, PL_CRYSTALS = 12, PL_STATIONS = 4, PL_ALIENS = 6, PL_O2_MAX = 100;
const PL_GRAVITY = 6, PL_SPEED = 7, PL_JUMP = 9, PL_DRAIN = 1.2, PL_REFILL = 38;
const SKY_TOP = '#1a0a2e', SKY_LOW = '#7a2d7a', CRYSTAL = '#5ff0ff';

const plColor = y => (y < 1 ? '#3b0f4a' : y < 4 ? '#6e1f6e' : y < 7 ? '#9c2d5c' : '#c2413a');
const terrainColor = (y, x, z) => shade(plColor(y), 0.93 + hash01(x.toFixed(1) + ',' + z.toFixed(1)) * 0.14);

// vector local → mundo, girado por yaw (0 = hacia -Z), igual que person()
const rotY = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };

// cámara suave: se acerca a la ideal (lerp exponencial) para que no tiemble al girar o saltar
const smoothCam = (s, dt, ideal) => {
  if (!s.cam) { s.cam = ideal; return; }
  const k = 1 - Math.exp(-dt * 9), mix = (a, b) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  s.cam = { p: mix(s.cam.p, ideal.p), l: mix(s.cam.l, ideal.l), fov: ideal.fov };
};

// cúpula de oxígeno (precalculada una vez: va en scene.statics)
const stationObjs = st => [
  { id: `${st.id}b`, k: 'cyl', p: [st.x, st.y + 0.3, st.z], s: [7.6, 0.6, 7.6], c: '#3a3450', sh: true },
  { id: `${st.id}d`, k: 'sph', p: [st.x, st.y + 0.6, st.z], s: [7, 4.2, 7], c: '#7fe7ff', o: 0.3, e: 0.25 },
  { id: `${st.id}p`, k: 'cyl', p: [st.x, st.y + 2.5, st.z], s: [0.3, 4.2, 0.3], c: '#cfd6ff', sh: true },
  { id: `${st.id}l`, k: 'sph', p: [st.x, st.y + 4.7, st.z], n: 0.6, c: '#ffe27a', e: 0.9 },
];

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const H0 = makeHeightmap(seed, PL_SIZE, { amp: 6 });
  const craters = Array.from({ length: 46 }, () => ({ x: (r() - 0.5) * PL_SIZE * 0.9, z: (r() - 0.5) * PL_SIZE * 0.9, r: 4 + r() * 10, d: 1.5 + r() * 4 }));
  const dip = (x, z) => { let d = 0; for (const c of craters) { const q = ((x - c.x) ** 2 + (z - c.z) ** 2) / (c.r * c.r); if (q < 1) d += c.d * (1 - q); } return d; };
  const hm = { size: H0.size, half: H0.half, h: (x, z) => H0.h(x, z) - dip(x, z) };   // relieve + cráteres
  const place = (minD, span) => {
    for (let k = 0; k < 500; k++) {
      const x = (r() - 0.5) * span * 2, z = (r() - 0.5) * span * 2;
      if (Math.hypot(x, z) >= minD) return { x, z, y: hm.h(x, z) };
    }
    return { x: minD, z: 0, y: hm.h(minD, 0) };
  };
  const crystals = Array.from({ length: PL_CRYSTALS }, (_, i) => ({ id: `cr${i}`, ...place(14, 88), ph: r() * 6, got: false }));
  const stations = Array.from({ length: PL_STATIONS }, (_, i) => ({ id: `st${i}`, ...place(18, 80) }));
  const aliens = Array.from({ length: PL_ALIENS }, (_, i) => ({ id: `al${i}`, ...place(30, 80), a: r() * 6.28, tm: 1, chase: false }));
  return {
    hm, terrain: { id: `pl${seed}`, h: hm.h, size: PL_SIZE, step: PL_STEP, color: terrainColor },
    statics: stations.flatMap(stationObjs), crystals, stations, aliens,
    p: { x: 0, y: hm.h(0, 0), z: 0, vy: 0, face: 0, ground: true },
    yaw: 0, cam: null, o2: PL_O2_MAX, warned: false, lives: 3, inv: 0, t: 0, got: 0, walk: 0, stepT: 0, dust: 0, wasGround: true,
    toast: null, final: null, over: false,
  };
};

// Escena completa en un instante t (juega y sirve de fondo animado en inicio/fin)
function buildScene(s, t) {
  const p = s.p;
  const blink = s.inv > 0 && Math.floor(s.t * 12) % 2 === 0;
  const active = Math.min(PL_ALIENS, 3 + Math.floor(s.got / 4));
  const objs = [];
  for (const c of s.crystals) {
    if (c.got) continue;
    objs.push({ id: `${c.id}beam`, k: 'cyl', p: [c.x, c.y + 8, c.z], s: [0.14, 16, 0.14], c: CRYSTAL, e: 1, o: 0.16 });
    objs.push(...gem(c.id, [c.x, c.y + 1.4, c.z], { c: CRYSTAL, t: t + c.ph, bob: 0.15, n: 1.3 }));
    objs.push({ id: `${c.id}halo`, k: 'sph', p: [c.x, c.y + 1.8, c.z], n: 1.8, c: CRYSTAL, e: 1, o: 0.12 });
  }
  for (let i = 0; i < active; i++) {
    const al = s.aliens[i];
    objs.push(...enemy(al.id, 'slime', [al.x, al.y, al.z], { yaw: al.a, t: t + i * 0.9, walk: 1, c: al.chase ? '#ff3d6e' : '#9b5cff' }));
  }
  // astronauta: person() con traje, brazos al cielo en el aire, mochila y casco de cristal con visera naranja
  objs.push(...person('yo', [p.x, p.y, p.z], {
    yaw: p.face, t, walk: s.walk, shirt: '#f2f2f7', pants: '#c9d1e0', skin: '#f2c29b', hair: '#f2f2f7', hat: 'none',
    arms: p.ground ? undefined : Math.PI, flash: blink,
  }));
  const bp = rotY([0, 1.25, 0.26], p.face), vz = rotY([0, 1.66, -0.3], p.face);
  objs.push({ id: 'yo.pack', k: 'box', p: [p.x + bp[0], p.y + bp[1], p.z + bp[2]], s: [0.5, 0.7, 0.22], r: [0, p.face, 0], c: '#9aa3b5', sh: true });
  objs.push({ id: 'yo.helm', k: 'sph', p: [p.x, p.y + 1.66, p.z], n: 0.44, c: '#e9f7ff', o: 0.38, m: { r: 0.1, m: 0.2 } });
  objs.push({ id: 'yo.visor', k: 'sph', p: [p.x + vz[0], p.y + vz[1], p.z + vz[2]], s: [0.44, 0.26, 0.16], r: [0, p.face, 0], c: '#ffb347', e: 0.6 });
  return {
    sky: { top: SKY_TOP, bottom: SKY_LOW, sun: true, sunC: '#f1e7ff', clouds: 0 },     // la "luna" es el disco del sol
    light: { dir: [-0.35, 0.5, -0.6], sun: '#ffd6f2', i: 2.2, sky: '#b9a6ff', ground: '#3a1446', hi: 1.5 },
    fog: { c: SKY_LOW, near: 46, far: 150 }, shadowR: 22,
    terrain: s.terrain, statics: s.statics,
    lights: [{ p: [p.x, p.y + 1.8, p.z], c: '#ff9ad5', i: 3, d: 7 }],
    objs, cam: s.cam || followCam(p, s.yaw, { hm: s.hm, dist: 9, height: 2.6 }),
  };
}

export function Planeta3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('planeta');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = (s, won) => {
    if (s.over) return;
    s.over = true;
    s.final = s.got * 100 + (won ? Math.floor(s.o2) * 3 : 0);
    if (won) hx.win(); else hx.die();
    setRes({ isNew: submitBest(s.final), won }); setPhase('over');
  };
  const hurt = (s, msg) => {
    s.lives -= 1; s.inv = 1.5; hx.bad(); fx.shake(8, 0.3); fx.flash(C.red, 0.3);
    s.toast = { m: msg, t: 1.2 };
    burst3d([s.p.x, s.p.y + 1, s.p.z], ['#ff3d6e', '#ffb0c8'], 20, { speed: 5, up: 2, size: 0.17, life: 0.7 });
    if (s.lives <= 0) finish(s, false);
  };
  const doJump = () => { if (jump(g.current.p, PL_JUMP)) hx.tap(); };

  useLoop(phase === 'play', dt => {
    const s = g.current; if (s.over) return;
    const p = s.p;
    s.t += dt; s.inv = Math.max(0, s.inv - dt);
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    s.yaw -= look.x * 2.4 * dt;
    const moved = stepPlayer(p, move, dt, { yaw: s.yaw, hm: s.hm, speed: PL_SPEED, gravity: PL_GRAVITY, bounds: PL_HALF - 3 });
    s.walk += (Math.min(1, moved / Math.max(dt, 1e-3) / PL_SPEED) - s.walk) * Math.min(1, dt * 10);
    smoothCam(s, dt, followCam(p, s.yaw, { hm: s.hm, dist: 9, height: 2.6 }));

    // polvo al caminar, onda al aterrizar y motas flotando (ambiente)
    s.stepT -= dt;
    if (moved > 0.02 && p.ground && s.stepT <= 0) {
      s.stepT = 0.28;
      burst3d([p.x, p.y + 0.05, p.z], ['#d9a6ff', '#f2e6ff'], 3, { speed: 1.4, up: 1.6, g: 4, size: 0.12, life: 0.6 });
    }
    if (p.ground && !s.wasGround) ring3d([p.x, p.y + 0.1, p.z], '#e9c6ff', 12, { speed: 2.6, life: 0.45, size: 0.12 });
    s.wasGround = p.ground;
    s.dust -= dt;
    if (s.dust <= 0) {
      s.dust = 0.25;
      burst3d([p.x + (Math.random() - 0.5) * 10, p.y + Math.random() * 4, p.z + (Math.random() - 0.5) * 10], '#e9c6ff', 1, { speed: 0.3, g: -0.4, size: 0.1, life: 2.2 });
    }

    // oxígeno: baja con el tiempo y se recarga dentro de una cúpula
    const dome = s.stations.find(st => Math.hypot(st.x - p.x, st.z - p.z) < 5 && p.ground);
    s.o2 = Math.min(PL_O2_MAX, s.o2 - PL_DRAIN * dt + (dome ? PL_REFILL * dt : 0));
    if (s.o2 < 25 && !s.warned) { s.warned = true; hx.warn(); s.toast = { m: '🫁 ¡Oxígeno bajo!', t: 1.4 }; }
    if (s.o2 > 40) s.warned = false;
    if (s.o2 <= 0) { s.o2 = 0; s.toast = { m: '🫁 Sin oxígeno', t: 1.4 }; finish(s, false); return; }

    // cristales
    for (const c of s.crystals) {
      if (c.got || Math.hypot(c.x - p.x, c.z - p.z) > 2.2 || Math.abs(c.y + 1.4 - p.y) > 3) continue;
      c.got = true; s.got += 1; hx.good(); fx.flash(C.cyan, 0.2);
      burst3d([c.x, c.y + 1.4, c.z], [CRYSTAL, '#e6fdff', '#b58cff'], 34, { speed: 6, up: 3.5, g: 6, size: 0.2, life: 1.1 });
      ring3d([c.x, c.y + 0.3, c.z], CRYSTAL, 20, { speed: 5, life: 0.6 });
      fx.pop(SCREEN_W / 2, SCREEN_H * 0.4, '+1 💎', C.cyan, 26);
      s.toast = { m: `💎 Cristal ${s.got}/${PL_CRYSTALS}`, t: 1.5 };
      if (s.got >= PL_CRYSTALS) { finish(s, true); return; }
    }

    // aliens activos: vagan; si te ven (< 24 m) te persiguen hasta que te pierden (> 42 m)
    const lim = PL_HALF - 6, active = Math.min(PL_ALIENS, 3 + Math.floor(s.got / 4));
    for (let i = 0; i < active; i++) {
      const al = s.aliens[i];
      const dx = p.x - al.x, dz = p.z - al.z, d = Math.hypot(dx, dz);
      if (!al.chase && d < 24) al.chase = true;
      if (al.chase && d > 42) al.chase = false;
      let spd;
      if (al.chase) { al.a = Math.atan2(-dx, -dz); spd = 4.2 + s.got * 0.08; }
      else { al.tm -= dt; if (al.tm <= 0) { al.a += (Math.random() - 0.5) * 4; al.tm = 1 + Math.random() * 2; } spd = 1.8; }
      const nx = al.x - Math.sin(al.a) * spd * dt, nz = al.z - Math.cos(al.a) * spd * dt;
      if (Math.abs(nx) < lim && Math.abs(nz) < lim) { al.x = nx; al.z = nz; } else { al.a += Math.PI; al.tm = 1; }
      al.y = s.hm.h(al.x, al.z);
      if (s.inv <= 0 && p.ground && Math.hypot(al.x - p.x, al.z - p.z) < 1.7) {
        hurt(s, '👽 ¡Un alien te atrapó!');
        p.vy = 7; p.ground = false;
        if (s.over) return;
      }
    }
  });

  const s = g.current; const p = s.p;
  const left = s.crystals.filter(c => !c.got);
  let target = null, td = 1e9;
  left.forEach(c => { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < td) { td = d; target = c; } });
  const ang = target ? compassAngle(p, s.yaw, target) : 0;
  const scene = buildScene(s, phase === 'play' ? s.t : 0);
  const sc = s.final != null ? s.final : s.got * 100;
  return (
    <Game3D title="PLANETA ALIEN" emoji="👽" accent={C.violet} onExit={onExit} score={sc} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(s, t)} orbit={{ r: 14, h: 4.5, speed: 0.18, ly: 1.4 }}
      hud={<><Lives n={s.lives} max={3} /><HudPill icon="💎" value={`${s.got}/${PL_CRYSTALS}`} color={C.cyan} /><HudPill icon="🫁" value={`${Math.ceil(s.o2)}%`} color={s.o2 < 25 ? C.red : C.cyan} /></>}
      subtitle="Explora un planeta morado con baja gravedad"
      lines={['Joystick izquierdo: caminar · derecho: girar la cámara', `Recoge ${PL_CRYSTALS} cristales brillantes`, 'El oxígeno baja: recárgalo en las cúpulas', '👽 Los aliens te persiguen si te ven · aparecen más con cada 4 cristales']}
      result={{ won: res.won, isNew: res.isNew, title: res.won ? '¡CRISTALES RECOGIDOS!' : 'MISIÓN FALLIDA', emoji: res.won ? '🏆' : '👽', subtitle: res.won ? 'Vuelves a la nave con el planeta en el bolsillo' : 'El planeta guarda sus cristales', stats: [['CRISTALES', `${s.got}/${PL_CRYSTALS}`], ['O₂', `${Math.ceil(s.o2)}%`], ['VIDAS', String(s.lives)]] }}>
      {target && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 4, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: C.cyan, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Cristal a {Math.round(td)} m</Text>
          </View>
        </View>
      )}
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '22%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 24, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      <Stick3D testID="pl-move" v={move} side="left" color={C.violet} />
      <Stick3D testID="pl-look" v={look} side="right" color={C.cyan} />
      <ActionBtn testID="pl-jump" label="SALTAR" color={C.cyan} onDown={doJump} style={{ left: '50%', marginLeft: -33, bottom: 34 }} />
    </Game3D>
  );
}
