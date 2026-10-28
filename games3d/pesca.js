import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, TouchBtn, TouchStick, alpha, clamp, hx, pick, rand, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { followCam, forward, makeHeightmap, near, seeded, stepPlayer, terrainObjs } from '../utils/openworld';

// LAGO DE PESCA – lago grande rodeado de bosque y muelles, tercera persona. Joystick izquierdo: caminar · derecho: girar.
// LANZAR junto al agua, mirando hacia ella. Cuando el corcho se hunda pulsa RECOGER (0,8 s) y luego mantén TENSAR sin pasarte.
const PS_SIZE = 110, PS_HALF = 55, PS_LR = 24, PS_TIME = 150, PS_FISH = 36, PS_TREES = 150, PS_LAND = 25;
const PS_WATER = 0.25;                          // altura del heightmap por debajo de la cual es agua
const PS_CAST = 14;                             // distancia máxima de lanzamiento
const PS_PIERS = [{ a: 0.5, tip: 18 }, { a: 2.3, tip: 11 }, { a: 4.1, tip: 5.5 }];   // el más lejano da peces raros
const PS_SPECIES = {
  orilla: [{ n: 'Perca', c: '#c9d46a', w: [0.1, 0.6], sz: 0.45, pull: 0.8, m: 1 }, { n: 'Sardina', c: '#d6eef5', w: [0.05, 0.25], sz: 0.3, pull: 0.6, m: 1 }],
  medio: [{ n: 'Trucha', c: '#f08a4b', w: [0.8, 3], sz: 0.7, pull: 1.0, m: 2 }, { n: 'Carpa', c: '#d9a441', w: [1.5, 5], sz: 0.9, pull: 1.1, m: 2 }],
  raro: [{ n: 'Dorado', c: '#ffd23f', w: [4, 9], sz: 1.1, pull: 1.3, m: 4 }, { n: 'Pez luna', c: '#b08cff', w: [8, 15], sz: 1.4, pull: 1.5, m: 6 }],
};
const PS_RING = { orilla: [14, 17.5], medio: [9.5, 13.5], raro: [2.5, 8] };
const zoneOf = r => (r >= 15 ? 'orilla' : r >= 9 ? 'medio' : 'raro');

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

const PIER_OBJS = PS_PIERS.flatMap((pr, i) => {
  const u0 = Math.cos(pr.a), u1 = Math.sin(pr.a), len = PS_LAND - pr.tip, mid = (PS_LAND + pr.tip) / 2;
  const out = [{ id: `pd${i}`, k: 'box', p: [u0 * mid, 0.35, u1 * mid], s: [2.2, 0.2, len], r: [0, Math.atan2(u0, u1), 0], c: '#8a6a42' }];
  for (let al = pr.tip + 1.5; al < PS_LAND - 1; al += 4) out.push({ id: `pp${i}_${Math.round(al)}`, k: 'cyl', p: [u0 * al, -0.6, u1 * al], s: [0.3, 2, 0.3], c: '#4a3620' });
  return out;
});

const buildTrees = (r, hm) => {
  const out = [];
  for (let guard = 0; out.length < PS_TREES && guard < 4000; guard++) {
    const x = (r() - 0.5) * PS_SIZE * 0.9, z = (r() - 0.5) * PS_SIZE * 0.9;
    const d = Math.hypot(x, z);
    if (d < 30 || d > 50 || hm.h(x, z) < 0.6) continue;
    out.push({ id: `t${out.length}`, x, z, y: hm.h(x, z), h: 2.4 + r() * 1.4, c: r() < 0.5 ? '#2f7d3a' : '#3c8f45' });
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
    out.push({ id: `pz${i}`, hx: x, hz: z, x, z, a: r() * 6.283, t: r() * 3, sz: sp.sz * (0.8 + r() * 0.4), c: sp.c });
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
  stepPlayer(p, move, dt, { yaw: s.yaw, floor: (x, z) => floorAt(s.hm, x, z), bounds: PS_HALF - 4, speed: 5.5 });
  if (!walkable(s, p.x, p.z)) {   // orilla: se frena antes del agua
    p.x = ox; p.z = oz; p.vy = ovy - 22 * dt; p.y = oy + p.vy * dt;
  }
  const gy = floorAt(s.hm, p.x, p.z);
  if (p.y <= gy) { p.y = gy; p.vy = 0; p.ground = true; } else p.ground = false;
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
const tipOf = (s) => { const p = s.p; const f = forward(s.yaw); return [p.x + f[0] * 0.6, p.y + 2.1, p.z + f[1] * 0.6]; };
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
  return {
    hm, trees: buildTrees(r, hm), fish: buildFish(r), cast: null,
    p: { x: 0, y: hm.h(0, 21), z: 21, vy: 0, face: 0, ground: true }, yaw: 0,
    time: PS_TIME, score: 0, catches: 0, kg: 0, t: 0, toast: null, final: null,
  };
};

const swimFish = (s, dt) => {
  for (const f of s.fish) {
    f.t -= dt;
    if (f.t <= 0) { f.a += (Math.random() - 0.5) * 2.5; f.t = 0.8 + Math.random() * 1.5; }
    const nx = f.x + Math.cos(f.a) * 0.7 * dt, nz = f.z + Math.sin(f.a) * 0.7 * dt;
    if (Math.hypot(nx - f.hx, nz - f.hz) < 2.5 && s.hm.h(nx, nz) < PS_WATER && !onPier(nx, nz)) { f.x = nx; f.z = nz; }
    else f.a = Math.atan2(f.hz - f.z, f.hx - f.x);
  }
};

const colorOf = y => (y < -0.2 ? '#3f5a4a' : y < PS_WATER ? '#e0cc86' : y < 2.4 ? '#5fae4a' : '#8a8a80');

export function Pesca3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('pesca');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = s => {
    s.final = s.score; s.cast = null;
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
    s.cast = { stage: 'fly', t: 0, x: tgt.x, z: tgt.z, zone, sp, kg: rand(sp.w[0], sp.w[1]), waitT: rand(2.5, 5), sink: 0, tens: 0.25, prog: 0, held: false };
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
    const c = s.cast;
    if (!c) return;
    if (c.stage === 'fly') { c.t += dt; if (c.t >= 0.6) { c.stage = 'wait'; c.t = 0; } }
    else if (c.stage === 'wait') {
      c.t += dt;
      if (c.t >= c.waitT) { c.stage = 'bite'; c.t = 0; hx.hit(); fx.shake(3, 0.2); s.toast = { m: '🎣 ¡PICA! Pulsa RECOGER', t: 1 }; }
    } else if (c.stage === 'bite') {
      c.t += dt; c.sink = Math.min(1, c.t / 0.25);
      if (c.t >= 0.8) { hx.bad(); s.toast = { m: '🐟 Se escapó…', t: 1.4 }; s.cast = null; }
    } else if (c.stage === 'tens') {
      c.tens = clamp(c.tens + (c.held ? 0.5 * c.sp.pull : -0.4) * dt, 0, 1);
      if (c.tens >= 1) { hx.bad(); fx.shake(8, 0.3); s.toast = { m: '💥 ¡Se rompió el sedal!', t: 1.6 }; s.cast = null; return; }
      if (c.tens >= 0.45 && c.tens <= 0.8) c.prog = Math.min(1, c.prog + dt * 0.28);
      else if (c.tens < 0.45) c.prog = Math.max(0, c.prog - dt * 0.06);
      if (c.prog >= 1) {
        const pts = Math.round(c.kg * 10 * c.sp.m);
        s.score += pts; s.kg += c.kg; s.catches += 1;
        if (c.sp.m >= 4) hx.win(); else hx.good();
        fx.flash(c.sp.c, 0.25);
        s.toast = { m: `🐟 ${c.sp.n} ${c.kg.toFixed(1)} kg · +${pts}`, t: 2 };
        s.cast = null;
      }
    }
  });

  const s = g.current; const p = s.p; const c = s.cast;
  const water = phase === 'play' ? findWater(s, p) : null;
  const cam = followCam(p, s.yaw, { dist: 10, height: 5.5, look: 6, hm: s.hm });
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const f = forward(s.yaw);
  const objs = [
    { id: 'agua', k: 'pla', p: [p.x, 0, p.z], s: [160, 160, 1], c: '#2a7fb8', o: 0.82 },
    ...terrainObjs(s.hm, p, 21, 3.5, colorOf, -2),
    ...PIER_OBJS,
    ...near(s.trees, p, 30).flatMap(t => [
      { id: `${t.id}a`, k: 'cyl', p: [t.x, t.y + 0.8, t.z], s: [0.4, 1.6, 0.4], c: '#6b4a2b' },
      { id: `${t.id}b`, k: 'cone', p: [t.x, t.y + 2.4, t.z], s: [2.2, 2.6, 2.2], c: t.c },
    ]),
    ...near(s.fish, p, 26).map(q => ({ id: q.id, k: 'sph', p: [q.x, -0.45, q.z], r: [0, q.a, 0], s: [q.sz * 1.6, q.sz * 0.6, q.sz * 0.6], c: q.c, o: 0.9 })),
    // jugador y caña
    { id: 'cana', k: 'cyl', p: [p.x + f[0] * 0.6, p.y + 1.4, p.z + f[1] * 0.6], s: [0.08, 1.4, 0.08], c: '#6b4a2b' },
    { id: 'cuerpo', k: 'box', p: [p.x, p.y + 0.7, p.z], s: [0.7, 1.0, 0.45], r: [0, p.face, 0], c: '#2f6fd8' },
    { id: 'cabeza', k: 'sph', p: [p.x, p.y + 1.45, p.z], n: 0.55, c: '#f2c29b' },
    { id: 'gorra', k: 'cyl', p: [p.x, p.y + 1.78, p.z], s: [0.8, 0.12, 0.8], c: '#3a2a1a' },
  ];
  if (c) {
    const [cx, cy, cz, tip] = corkPos(s, c);
    for (let i = 0; i < 6; i++) {
      const k = (i + 1) / 7;
      objs.push({ id: `ln${i}`, k: 'sph', p: [tip[0] + (cx - tip[0]) * k, tip[1] + (cy - tip[1]) * k, tip[2] + (cz - tip[2]) * k], n: 0.05, c: '#f2f2f2' });
    }
    objs.push({ id: 'corA', k: 'sph', p: [cx, cy, cz], s: [0.24, 0.24, 0.24], c: '#ff3b3b' });
    objs.push({ id: 'corB', k: 'sph', p: [cx, cy + 0.15, cz], n: 0.11, c: '#ffffff' });
  }
  const scene = { bg: '#9fd8ff', fog: { c: '#9fd8ff', near: 40, far: 90 }, shake, objs, cam };
  const sc = s.final != null ? s.final : s.score;
  const pad = (v, cx) => (
    <View pointerEvents="none" style={{ position: 'absolute', left: cx - 50, bottom: 14, width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
      <View style={{ position: 'absolute', left: 34 + v.x * 32, top: 34 + v.y * 32, width: 32, height: 32, borderRadius: 16, backgroundColor: v.on ? alpha(C.lime, 0.7) : 'rgba(255,255,255,0.35)' }} />
    </View>
  );
  const BAR = 240;
  const labelA = c ? 'EN CURSO' : water ? 'LANZAR' : 'SIN AGUA';
  const labelB = c && c.stage === 'bite' ? 'RECOGER' : c && c.stage === 'tens' ? 'TENSAR' : '···';
  return (
    <GameScreen title="LAGO DE PESCA" emoji="🎣" accent={C.lime} onExit={onExit} score={sc} best={best}
      hud={<><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>🐟 {s.catches}</Text><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>⚖️ {s.kg.toFixed(1)} kg</Text><Text style={{ color: s.time < 20 ? C.red : C.lime, fontWeight: '900', fontSize: 12 }}>⏱ {Math.ceil(s.time)}s</Text></>}>
      <PlayArea fx={fx} bg="#9fd8ff">
        <World3D scene={scene} />
        {phase === 'play' && c && c.stage === 'tens' && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 14, left: AREA_W / 2 - BAR / 2, width: BAR, alignItems: 'stretch' }}>
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
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.3, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 20, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
        {phase === 'play' && (
          <>
            <TouchStick testID="ps-move" v={move} R={44} style={{ position: 'absolute', left: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            <TouchStick testID="ps-look" v={look} R={44} style={{ position: 'absolute', right: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            {pad(move, 62)}
            {pad(look, AREA_W - 62)}
            <TouchBtn testID="ps-cast" onDown={doA} style={{ position: 'absolute', left: AREA_W / 2 - 32, bottom: 24, width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: C.lime, backgroundColor: alpha(C.lime, c || water ? 0.25 : 0.08), alignItems: 'center', justifyContent: 'center', opacity: c || water ? 1 : 0.5 }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 10 }}>{labelA}</Text>
            </TouchBtn>
            <TouchBtn testID="ps-reel" onDown={doB} onUp={upB} style={{ position: 'absolute', left: AREA_W / 2 - 32, bottom: 98, width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: C.amber, backgroundColor: alpha(C.amber, c && (c.stage === 'bite' || c.stage === 'tens') ? 0.3 : 0.06), alignItems: 'center', justifyContent: 'center', opacity: c && (c.stage === 'bite' || c.stage === 'tens') ? 1 : 0.35 }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 10 }}>{labelB}</Text>
            </TouchBtn>
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🎣"
          title={phase === 'over' ? '¡SE ACABÓ LA PESCA!' : 'LAGO DE PESCA'}
          subtitle={phase === 'ready' ? 'Pesca en el lago y gana puntos por peso' : `🐟 ${s.catches} capturas · ${s.kg.toFixed(1)} kg`}
          score={sc} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Joystick izquierdo: caminar · derecho: girar la cámara', 'LANZAR junto al agua, mirando hacia ella', `Cuando el corcho se hunda: RECOGER (0,8 s) y luego TENSAR`, `Los muelles lejanos tienen peces raros · ${PS_TIME} s`] : null} />
      </PlayArea>
    </GameScreen>
  );
}
