import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, Bar, GameScreen, Lives, Overlay, PlayArea, TouchBtn, TouchStick, alpha, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { compassAngle, followCam, jump, makeHeightmap, near, seeded, stepPlayer } from '../utils/openworld';

// PLANETA ALIEN – exploración en tercera persona con baja gravedad.
// Joystick izquierdo: caminar · derecho: girar la cámara · SALTAR (saltos largos).
// Recoge 12 cristales antes de quedarte sin oxígeno. Las cúpulas recargan el oxígeno; los aliens te persiguen.
const PL_SIZE = 200, PL_HALF = 100, PL_CRYSTALS = 12, PL_STATIONS = 4, PL_ALIENS = 5, PL_O2_MAX = 100;
const PL_GRAVITY = 6, PL_SPEED = 7, PL_JUMP = 9, PL_DRAIN = 1.2, PL_REFILL = 38;
const SKY = '#1a0a2e';

// Vectores y rotación en Y (yaw): nariz hacia -Z, como en el resto del mundo abierto
const rotY = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };
const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const plColor = y => (y < 1 ? '#3b0f4a' : y < 4 ? '#6e1f6e' : y < 7 ? '#9c2d5c' : '#c2413a');

// Suelo por dos niveles de detalle: bloques finos (6) cerca y gruesos (24) en la distancia, alineados para no dejar huecos.
const plTerrain = (hm, c) => {
  const out = [];
  const bx = Math.floor(c.x / 24), bz = Math.floor(c.z / 24);
  const cell = (x, z, s, id) => {
    if (Math.abs(x) > hm.half || Math.abs(z) > hm.half) return;
    const y = hm.h(x, z);
    out.push({ id, k: 'box', p: [x, (y - 14) / 2, z], s: [s, y + 14, s], c: plColor(y) });
  };
  for (let gx = (bx - 1) * 4; gx < (bx + 1) * 4; gx++) for (let gz = (bz - 1) * 4; gz < (bz + 1) * 4; gz++) cell((gx + 0.5) * 6, (gz + 0.5) * 6, 6, `n${gx}_${gz}`);
  for (let gx = bx - 5; gx < bx + 5; gx++) for (let gz = bz - 5; gz < bz + 5; gz++) {
    if (gx >= bx - 1 && gx <= bx && gz >= bz - 1 && gz <= bz) continue;
    cell(gx * 24 + 12, gz * 24 + 12, 24, `f${gx}_${gz}`);
  }
  return out;
};

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
  return { hm, crystals, stations, aliens, p: { x: 0, y: hm.h(0, 0), z: 0, vy: 0, face: 0, ground: true }, yaw: 0, o2: PL_O2_MAX, warned: false, lives: 3, inv: 0, t: 0, got: 0, time: 0, toast: null, final: null, over: false };
};

// Objetos de la escena (cada función devuelve ids estables)
const crystalObjs = (c, time) => {
  const y = c.y + 1.4 + Math.sin(time * 2 + c.ph) * 0.2;
  return [
    { id: `${c.id}a`, k: 'cone', p: [c.x, y + 0.5, c.z], s: [0.8, 1.0, 0.8], c: '#5ff0ff', e: 0.5 },
    { id: `${c.id}b`, k: 'cone', p: [c.x, y - 0.5, c.z], s: [0.8, 1.0, 0.8], r: [Math.PI, 0, 0], c: '#5ff0ff', e: 0.5 },
  ];
};
const stationObjs = st => [
  { id: `${st.id}b`, k: 'cyl', p: [st.x, st.y + 0.3, st.z], s: [7.6, 0.6, 7.6], c: '#3a3450' },
  { id: `${st.id}d`, k: 'sph', p: [st.x, st.y + 0.2, st.z], s: [7, 4.2, 7], c: '#7fe7ff', o: 0.35 },
  { id: `${st.id}p`, k: 'cyl', p: [st.x, st.y + 2.5, st.z], s: [0.3, 4.2, 0.3], c: '#cfd6ff' },
  { id: `${st.id}l`, k: 'sph', p: [st.x, st.y + 4.7, st.z], n: 0.6, c: '#ffe27a', e: 0.5 },
];
const alienObjs = al => {
  const col = al.chase ? '#ff3d6e' : '#9b5cff';
  const at = (lx, ly, lz) => { const q = rotY([lx, ly, lz], al.a); return [al.x + q[0], al.y + q[1], al.z + q[2]]; };
  return [
    { id: `${al.id}b`, k: 'sph', p: [al.x, al.y + 0.7, al.z], s: [1.2, 1.3, 1.2], r: [0, al.a, 0], c: col },
    { id: `${al.id}c`, k: 'cone', p: at(0, 1.6, 0.1), s: [0.5, 0.8, 0.5], r: [0, al.a, 0], c: col },
    { id: `${al.id}e1`, k: 'sph', p: at(0.35, 1.1, -0.55), n: 0.25, c: '#ffe14d', e: 0.5 },
    { id: `${al.id}e2`, k: 'sph', p: at(-0.35, 1.1, -0.55), n: 0.25, c: '#ffe14d', e: 0.5 },
  ];
};
// Astronauta: traje blanco, mochila, casco con visera naranja (parpadea al recibir daño)
const astroObjs = (p, blink) => {
  const a = p.face || 0;
  const at = (lx, ly, lz) => { const q = rotY([lx, ly, lz], a); return [p.x + q[0], p.y + q[1], p.z + q[2]]; };
  const suit = blink ? '#ff6b6b' : '#f2f2f7';
  return [
    { id: 'as_body', k: 'box', p: at(0, 0.75, 0), s: [0.7, 0.9, 0.45], r: [0, a, 0], c: suit },
    { id: 'as_pack', k: 'box', p: at(0, 0.8, 0.35), s: [0.5, 0.7, 0.25], r: [0, a, 0], c: '#9aa3b5' },
    { id: 'as_arm1', k: 'box', p: at(0.5, 0.8, 0), s: [0.18, 0.6, 0.18], r: [0, a, 0], c: suit },
    { id: 'as_arm2', k: 'box', p: at(-0.5, 0.8, 0), s: [0.18, 0.6, 0.18], r: [0, a, 0], c: suit },
    { id: 'as_leg1', k: 'box', p: at(0.2, 0.15, 0), s: [0.25, 0.5, 0.3], r: [0, a, 0], c: '#dfe6f0' },
    { id: 'as_leg2', k: 'box', p: at(-0.2, 0.15, 0), s: [0.25, 0.5, 0.3], r: [0, a, 0], c: '#dfe6f0' },
    { id: 'as_helmet', k: 'sph', p: at(0, 1.5, 0), n: 0.5, c: suit },
    { id: 'as_visor', k: 'sph', p: at(0, 1.5, -0.3), s: [0.7, 0.45, 0.45], r: [0, a, 0], c: '#ffb347', e: 0.4 },
  ];
};

export function Planeta3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('planeta');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); hx.tap(); };
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
    if (s.lives <= 0) finish(s, false);
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; if (s.over) return;
    const p = s.p;
    s.t += dt; s.inv = Math.max(0, s.inv - dt);
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    s.yaw -= look.x * 2.4 * dt;
    stepPlayer(p, move, dt, { yaw: s.yaw, hm: s.hm, speed: PL_SPEED, gravity: PL_GRAVITY, bounds: PL_HALF - 3 });

    // oxígeno: baja con el tiempo y se recarga dentro de una cúpula
    const dome = s.stations.find(st => Math.hypot(st.x - p.x, st.z - p.z) < 5 && p.ground);
    s.o2 = Math.min(PL_O2_MAX, s.o2 - PL_DRAIN * dt + (dome ? PL_REFILL * dt : 0));
    if (dome && s.o2 < PL_O2_MAX) s.toast = { m: '🫁 Recargando oxígeno', t: 0.3 };
    if (s.o2 < 25 && !s.warned) { s.warned = true; hx.warn(); s.toast = { m: '🫁 ¡Oxígeno bajo!', t: 1.4 }; }
    if (s.o2 > 40) s.warned = false;
    if (s.o2 <= 0) { s.o2 = 0; s.toast = { m: '🫁 Sin oxígeno', t: 1.4 }; finish(s, false); return; }

    // cristales
    for (const c of s.crystals) {
      if (c.got || Math.hypot(c.x - p.x, c.z - p.z) > 2.2 || Math.abs(c.y + 1.4 - p.y) > 3) continue;
      c.got = true; s.got += 1; hx.good(); fx.flash(C.cyan, 0.2);
      s.toast = { m: `💎 Cristal ${s.got}/${PL_CRYSTALS}`, t: 1.5 };
      if (s.got >= PL_CRYSTALS) { finish(s, true); return; }
    }

    // aliens: vagan; si te ven (< 24 m) te persiguen hasta que te pierden (> 42 m)
    const lim = PL_HALF - 6;
    for (const al of s.aliens) {
      const dx = p.x - al.x, dz = p.z - al.z, d = Math.hypot(dx, dz);
      if (!al.chase && d < 24) al.chase = true;
      if (al.chase && d > 42) al.chase = false;
      let spd;
      if (al.chase) { al.a = Math.atan2(-dx, -dz); spd = 4.4; } else {
        al.tm -= dt; if (al.tm <= 0) { al.a += (Math.random() - 0.5) * 4; al.tm = 1 + Math.random() * 2; }
        spd = 1.8;
      }
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
  const blink = s.inv > 0 && Math.floor(s.t * 12) % 2 === 0;
  const cam = followCam(p, s.yaw, { hm: s.hm, dist: 9, height: 2.6 });
  // dos lunas grandes en una dirección fija del cielo (delante, a izquierda y derecha; van con la cámara)
  const moonA = unit([-0.2, 0.21, -0.96]), moonB = unit([0.2, 0.12, -0.97]);
  const at = (d, k) => [cam.p[0] + d[0] * k, cam.p[1] + d[1] * k, cam.p[2] + d[2] * k];
  const objs = [
    { id: 'luna1', k: 'sph', p: at(moonA, 95), n: 22, c: '#f1e7ff', e: 0.4 },
    { id: 'luna2', k: 'sph', p: at(moonB, 95), n: 13, c: '#ffb3d9', e: 0.4 },
    ...plTerrain(s.hm, p),
    ...near(left, p, 60).flatMap(c => crystalObjs(c, s.t)),
    ...near(s.stations, p, 60).flatMap(stationObjs),
    ...near(s.aliens, p, 60).flatMap(alienObjs),
    ...astroObjs(p, blink),
  ];
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const scene = { bg: SKY, fog: { c: SKY, near: 40, far: 130 }, shake, objs, cam };
  const sc = s.final != null ? s.final : s.got * 100;
  const pad = (v, cx) => (
    <View pointerEvents="none" style={{ position: 'absolute', left: cx - 50, bottom: 14, width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
      <View style={{ position: 'absolute', left: 34 + v.x * 32, top: 34 + v.y * 32, width: 32, height: 32, borderRadius: 16, backgroundColor: v.on ? alpha(C.violet, 0.7) : 'rgba(255,255,255,0.35)' }} />
    </View>
  );
  return (
    <GameScreen title="PLANETA ALIEN" emoji="👽" accent={C.violet} onExit={onExit} score={sc} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>💎 {s.got}/{PL_CRYSTALS}</Text><View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: C.cyan, fontWeight: '900', fontSize: 12, marginRight: 4 }}>O₂</Text><Bar value={s.o2} max={PL_O2_MAX} color={s.o2 < 25 ? C.red : C.cyan} w={54} h={6} /></View></>}>
      <PlayArea fx={fx} bg={SKY}>
        <World3D scene={scene} />
        {phase === 'play' && target && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: C.cyan, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Cristal a {Math.round(td)} m</Text>
            </View>
          </View>
        )}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.25, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
        {phase === 'play' && (
          <>
            <TouchStick testID="pl-move" v={move} R={44} style={{ position: 'absolute', left: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            <TouchStick testID="pl-look" v={look} R={44} style={{ position: 'absolute', right: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            {pad(move, 62)}
            {pad(look, AREA_W - 62)}
            <TouchBtn testID="pl-jump" onDown={() => { if (jump(g.current.p, PL_JUMP)) hx.tap(); }} style={{ position: 'absolute', left: AREA_W / 2 - 32, bottom: 26, width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: C.cyan, backgroundColor: alpha(C.cyan, 0.2), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11 }}>SALTAR</Text>
            </TouchBtn>
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? (res.won ? '🏆' : '👽') : '👽'}
          title={phase === 'over' ? (res.won ? '¡CRISTALES RECOGIDOS!' : 'MISIÓN FALLIDA') : 'PLANETA ALIEN'}
          subtitle={phase === 'ready' ? 'Explora un planeta morado con baja gravedad' : `💎 ${s.got}/${PL_CRYSTALS} cristales`}
          score={sc} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Joystick izquierdo: caminar · derecho: girar la cámara', `Recoge ${PL_CRYSTALS} cristales brillantes`, 'El oxígeno baja: recárgalo en las cúpulas', '👽 Los aliens te persiguen si te ven'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
