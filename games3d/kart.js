import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, TouchBtn, TouchStick, alpha, clamp, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { compassAngle, followCam, forward, makeHeightmap, near, right, seeded, terrainObjs } from '../utils/openworld';

// RALLY ABIERTO – contrarreloj en tercera persona por un paisaje con colinas, árboles y rocas.
// Joystick izquierdo: girar el auto · FRENO: frenar (el auto acelera solo).
// Pasa los 10 aros en orden antes de que acabe el tiempo; cada aro suma tiempo.
const KT_SIZE = 240, KT_HALF = KT_SIZE / 2, KT_RINGS = 10, KT_TIME = 25, KT_BONUS = 7;
const KT_TREES = 150, KT_ROCKS = 90, KT_RAMPS = 4;
const KT_MAXV = 26, KT_ACC = 12, KT_BRK = 34, KT_VTOP = 34, KT_TURN = 2.4, KT_GRAV = 26, KT_CAR_R = 1.1;
const KT_RL = 9, KT_RW = 6, KT_RH = 3.2;            // rampa: largo, ancho y altura
const KT_TREE_COLS = ['#2f8f3a', '#2c7d46', '#3e9b3a'];
const ktColor = y => (y < 0 ? '#b8a46a' : y < 2.5 ? '#7cb857' : y < 5 ? '#5f9f45' : '#8f8b74');
const ktWrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// Altura de una rampa bajo (x, z); -1e9 si el punto no está sobre ella.
const rampY = (rp, x, z) => {
  const a = rp.axis === 'z' ? z - rp.z : x - rp.x;
  const l = rp.axis === 'z' ? x - rp.x : z - rp.z;
  if (Math.abs(a) > KT_RL / 2 || Math.abs(l) > KT_RW / 2) return -1e9;
  const t = rp.dir > 0 ? (a + KT_RL / 2) / KT_RL : (KT_RL / 2 - a) / KT_RL;
  return rp.base + KT_RH * t;
};
// Suelo bajo el auto: colinas o rampa, lo que esté más alto.
const groundAt = (s, x, z) => {
  let y = s.hm.h(x, z);
  for (const rp of s.ramps) { const ry = rampY(rp, x, z); if (ry > y) y = ry; }
  return y;
};

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const rnd = (a, b) => a + (b - a) * r();
  const hm = makeHeightmap(seed, KT_SIZE, { amp: 7 });
  // 10 aros en un bucle grande alrededor del mapa
  const pts = Array.from({ length: KT_RINGS }, (_, i) => {
    const th = (i / KT_RINGS) * Math.PI * 2 + rnd(-0.08, 0.08), R = rnd(70, 92);
    return { x: Math.cos(th) * R, z: Math.sin(th) * R };
  });
  const rings = pts.map((q, i) => {
    const n = pts[(i + 1) % KT_RINGS];
    return { id: `aro${i}`, x: q.x, z: q.z, y: hm.h(q.x, q.z) + 2.4, ry: Math.atan2(n.x - q.x, n.z - q.z) };
  });
  // inicio: 14 m detrás del primer aro, mirando hacia él
  const p0 = pts[0], p1 = pts[1];
  const ddx = p1.x - p0.x, ddz = p1.z - p0.z, dl = Math.hypot(ddx, ddz) || 1;
  const sx = p0.x - (ddx / dl) * 14, sz = p0.z - (ddz / dl) * 14;
  const yaw = Math.atan2(-ddx / dl, -ddz / dl);
  // rampas en el centro de algunos tramos del recorrido
  const ramps = Array.from({ length: KT_RAMPS }, (_, k) => {
    const a = pts[(2 * k + 1) % KT_RINGS], b = pts[(2 * k + 2) % KT_RINGS];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, dx = b.x - a.x, dz = b.z - a.z;
    const axis = Math.abs(dx) > Math.abs(dz) ? 'x' : 'z';
    const dir = axis === 'x' ? (dx > 0 ? 1 : -1) : (dz > 0 ? 1 : -1);
    return { id: `rampa${k}`, x: mx, z: mz, axis, dir, base: hm.h(mx, mz) };
  });
  const free = (x, z, rad) => rings.every(q => Math.hypot(q.x - x, q.z - z) > rad) && ramps.every(q => Math.hypot(q.x - x, q.z - z) > rad + 4) && Math.hypot(sx - x, sz - z) > 12;
  const place = (n, rad, make) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 20; k++) {
        const x = rnd(-KT_HALF + 8, KT_HALF - 8), z = rnd(-KT_HALF + 8, KT_HALF - 8);
        if (free(x, z, rad)) { out.push(make(i, x, z)); break; }
      }
    }
    return out;
  };
  const trees = place(KT_TREES, 9, (i, x, z) => ({ id: `arbol${i}`, x, z, y: hm.h(x, z), h: 2.2 + r() * 1.2, r: 1.3, cd: 0, col: KT_TREE_COLS[Math.floor(r() * KT_TREE_COLS.length)] }));
  const rocks = place(KT_ROCKS, 6, (i, x, z) => {
    const sx2 = 1.4 + r() * 1.6, sy = 0.9 + r() * 0.9, sz2 = 1.2 + r() * 1.2;
    return { id: `roca${i}`, x, z, y: hm.h(x, z), s: [sx2, sy, sz2], rot: [r() * 3, r() * 3, 0], r: (sx2 + sz2) / 4, cd: 0 };
  });
  const s = {
    hm, rings, ramps, trees, rocks, obs: [...trees, ...rocks], next: 0, prevSd: null, time: KT_TIME, t: 0, toast: null, final: null,
    yaw, camYaw: yaw,
    car: { x: sx, z: sz, y: hm.h(sx, sz), v: 0, vy: 0, air: false, g: hm.h(sx, sz), grade: 0 },
  };
  s.car.y = groundAt(s, sx, sz); s.car.g = s.car.y;
  return s;
};

export function Rally3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('kart');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const brake = useRef({ on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); move.x = 0; move.y = 0; brake.on = false; setPhase('play'); hx.tap(); };
  const finish = (s, won) => {
    brake.on = false;
    s.final = s.next * 100 + (won ? Math.ceil(s.time) * 10 : 0);
    if (won) hx.win(); else hx.die();
    setRes({ isNew: submitBest(s.final), won }); setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; const c = s.car;
    s.t += dt; s.time -= dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.time <= 0) { s.time = 0; finish(s, false); return; }

    // giro: el auto gira con su velocidad; nunca se desliza de lado
    s.yaw -= (move.x || 0) * KT_TURN * Math.min(1, c.v / 6) * dt;

    // velocidad: acelera solo, FRENO frena; las cuestas frenan o empujan
    const d = (brake.on ? 0 : KT_MAXV) - c.v;
    c.v += clamp(d, -KT_BRK * dt, KT_ACC * dt);
    c.v = clamp(c.v - c.grade * 9.8 * dt, 0, KT_VTOP);

    // movimiento hacia donde mira el auto
    const f = forward(s.yaw);
    c.x += f[0] * c.v * dt; c.z += f[1] * c.v * dt;
    const lim = KT_HALF - 6;
    if (Math.abs(c.x) > lim || Math.abs(c.z) > lim) { c.x = clamp(c.x, -lim, lim); c.z = clamp(c.z, -lim, lim); c.v *= 0.5; }

    // árboles y rocas: frenan el auto y vibran
    for (const o of s.obs) {
      if (o.cd > 0) o.cd -= dt;
      if (c.y > o.y + 1.6) continue;
      const dx = c.x - o.x, dz = c.z - o.z, dist = Math.hypot(dx, dz), R = o.r + KT_CAR_R;
      if (dist >= R || dist < 1e-4) continue;
      const nx = dx / dist, nz = dz / dist;
      const into = -(f[0] * nx + f[1] * nz);
      c.x = o.x + nx * R; c.z = o.z + nz * R;
      if (into > 0.2 && c.v > 5 && o.cd <= 0) {
        o.cd = 0.6; c.v *= 0.2;
        hx.heavy(); fx.shake(14, 0.4); fx.flash(C.red, 0.22);
        s.toast = { m: '💥 ¡Choque!', t: 0.9 };
      }
    }

    // suelo, saltos de rampa y gravedad
    const gPrev = c.g, gNow = groundAt(s, c.x, c.z);
    c.g = gNow;
    if (c.air || c.y > gNow + 0.6) {
      c.air = true; c.vy -= KT_GRAV * dt; c.y += c.vy * dt; c.grade = 0;
      if (c.y <= gNow) {
        if (c.vy < -14) { hx.hit(); fx.shake(7, 0.25); }
        c.y = gNow; c.vy = 0; c.air = false;
      }
    } else {
      c.y = gNow; c.vy = (gNow - gPrev) / Math.max(dt, 1e-4);
      c.grade = clamp((gNow - gPrev) / Math.max(c.v * dt, 0.01), -1, 1);
    }

    // aros en orden: cuenta si el auto cruza el plano del aro por dentro (cada uno suma tiempo)
    const rg = s.rings[s.next];
    if (rg) {
      const sd = (c.x - rg.x) * Math.sin(rg.ry) + (c.z - rg.z) * Math.cos(rg.ry);
      const lat = Math.abs((c.x - rg.x) * Math.cos(rg.ry) - (c.z - rg.z) * Math.sin(rg.ry));
      const crossed = s.prevSd != null && s.prevSd < 0 && sd >= 0;
      s.prevSd = sd;
      if (crossed && lat < 2.8 && Math.abs(rg.y - c.y) < 4.5) {
        s.next += 1; s.time += KT_BONUS; s.prevSd = null;
        hx.good(); fx.flash(C.amber, 0.2);
        s.toast = { m: `🏁 Aro ${s.next}/${KT_RINGS} · +${KT_BONUS} s`, t: 1.4 };
        if (s.next >= KT_RINGS) { finish(s, true); return; }
      }
    }

    // cámara: sigue el yaw del auto con suavizado
    s.camYaw += ktWrap(s.yaw - s.camYaw) * Math.min(1, dt * 5);
  });

  const s = g.current; const c = s.car;
  const f = forward(s.yaw), rt = right(s.yaw);
  const at = (dd, ll, hh) => [c.x + f[0] * dd + rt[0] * ll, c.y + hh, c.z + f[1] * dd + rt[1] * ll];
  const yaw = s.yaw;
  const sc = s.final != null ? s.final : s.next * 100;
  const rg = s.rings[s.next];
  const ang = rg ? compassAngle(c, s.yaw, rg) : 0;
  const dist = rg ? Math.hypot(rg.x - c.x, rg.z - c.z) : 0;

  const carObjs = [
    { id: 'sombra', k: 'box', p: [c.x, c.y + 0.05, c.z], s: [2.2, 0.06, 4.0], r: [0, yaw, 0], c: '#000000', o: 0.35 },
    { id: 'coche', k: 'box', p: [c.x, c.y + 0.6, c.z], s: [1.9, 0.6, 3.8], r: [0, yaw, 0], c: '#ff3d5a' },
    { id: 'cabina', k: 'box', p: at(-0.4, 0, 1.15), s: [1.5, 0.55, 1.8], r: [0, yaw, 0], c: '#15161f' },
    { id: 'aleron', k: 'box', p: at(-1.85, 0, 1.25), s: [2.0, 0.14, 0.4], r: [0, yaw, 0], c: '#ffc233' },
    { id: 'faroI', k: 'box', p: at(1.92, 0.6, 0.45), s: [0.3, 0.2, 0.1], r: [0, yaw, 0], c: '#fff7c2', e: 0.5 },
    { id: 'faroD', k: 'box', p: at(1.92, -0.6, 0.45), s: [0.3, 0.2, 0.1], r: [0, yaw, 0], c: '#fff7c2', e: 0.5 },
    { id: 'rueda1', k: 'cyl', p: at(1.25, 1.0, 0.4), s: [0.8, 0.5, 0.8], r: [0, yaw, Math.PI / 2], c: '#111111' },
    { id: 'rueda2', k: 'cyl', p: at(1.25, -1.0, 0.4), s: [0.8, 0.5, 0.8], r: [0, yaw, Math.PI / 2], c: '#111111' },
    { id: 'rueda3', k: 'cyl', p: at(-1.25, 1.0, 0.4), s: [0.8, 0.5, 0.8], r: [0, yaw, Math.PI / 2], c: '#111111' },
    { id: 'rueda4', k: 'cyl', p: at(-1.25, -1.0, 0.4), s: [0.8, 0.5, 0.8], r: [0, yaw, Math.PI / 2], c: '#111111' },
  ];
  const rampObj = rp => {
    const Lr = Math.hypot(KT_RL, KT_RH), th = Math.atan2(KT_RH, KT_RL), cy = rp.base + KT_RH / 2 - 0.25;
    return rp.axis === 'z'
      ? { id: rp.id, k: 'box', p: [rp.x, cy, rp.z], s: [KT_RW, 0.5, Lr], r: [-rp.dir * th, 0, 0], c: '#ff8a3d', e: 0.15 }
      : { id: rp.id, k: 'box', p: [rp.x, cy, rp.z], s: [Lr, 0.5, KT_RW], r: [0, 0, rp.dir * th], c: '#ff8a3d', e: 0.15 };
  };
  const ringObj = (rr, next) => ({ id: rr.id, k: 'tor', p: [rr.x, rr.y, rr.z], n: 4.2, r: [0, rr.ry, 0], c: next ? C.lime : C.amber, e: next ? 0.6 : 0.3 });
  const objs = [
    ...terrainObjs(s.hm, c, 35, 5, ktColor, -5),
    ...near(s.trees, c, 45).flatMap(t => [
      { id: `${t.id}a`, k: 'cyl', p: [t.x, t.y + t.h / 2, t.z], s: [0.5, t.h, 0.5], c: '#7a4f2a' },
      { id: `${t.id}b`, k: 'cone', p: [t.x, t.y + t.h + 1.8, t.z], s: [3.0, 3.6, 3.0], c: t.col },
    ]),
    ...near(s.rocks, c, 45).map(o => ({ id: o.id, k: 'sph', p: [o.x, o.y + o.s[1] * 0.3, o.z], s: o.s, r: o.rot, c: '#8d8a86' })),
    ...near(s.ramps, c, 60).map(rampObj),
    ...s.rings.slice(s.next).map((rr, j) => ringObj(rr, j === 0)),
    ...carObjs,
  ];
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const scene = { bg: '#9fd8ff', fog: { c: '#9fd8ff', near: 20, far: 52 }, shake, objs, cam: followCam(c, s.camYaw, { hm: s.hm, dist: 9, height: 4.2, look: 3 }) };
  const pad = (v, cx) => (
    <View pointerEvents="none" style={{ position: 'absolute', left: cx - 50, bottom: 14, width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
      <View style={{ position: 'absolute', left: 34 + v.x * 32, top: 34 + v.y * 32, width: 32, height: 32, borderRadius: 16, backgroundColor: v.on ? alpha(C.orange, 0.7) : 'rgba(255,255,255,0.35)' }} />
    </View>
  );
  return (
    <GameScreen title="RALLY ABIERTO" emoji="🏎️" accent={C.orange} onExit={onExit} score={sc} best={best}
      hud={<><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>🏁 {s.next}/{KT_RINGS}</Text><Text style={{ color: s.time < 10 ? C.red : C.amber, fontWeight: '900', fontSize: 12 }}>⏱ {Math.ceil(s.time)}s</Text><Text style={{ color: C.cyan, fontWeight: '900', fontSize: 12 }}>{Math.round(c.v * 3.6)} km/h</Text></>}>
      <PlayArea fx={fx} bg="#9fd8ff">
        <World3D scene={scene} />
        {phase === 'play' && rg && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: C.lime, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Aro {s.next + 1} a {Math.round(dist)} m</Text>
            </View>
          </View>
        )}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.25, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
        {phase === 'play' && (
          <>
            <TouchStick testID="kt-steer" v={move} R={44} style={{ position: 'absolute', left: 0, bottom: 0, width: AREA_W * 0.5, height: 170 }} />
            {pad(move, 62)}
            <TouchBtn testID="kt-brake" onDown={() => { brake.on = true; }} onUp={() => { brake.on = false; }} style={{ position: 'absolute', right: 14, bottom: 26, width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: C.red, backgroundColor: alpha(C.red, 0.25), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>FRENO</Text>
            </TouchBtn>
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? (res.won ? '🏆' : '🏎️') : '🏎️'}
          title={phase === 'over' ? (res.won ? '¡RALLY COMPLETADO!' : 'TIEMPO AGOTADO') : 'RALLY ABIERTO'}
          subtitle={phase === 'ready' ? 'Contrarreloj por un paisaje abierto' : `🏁 ${s.next}/${KT_RINGS} aros`}
          score={sc} best={best} isNew={res.isNew} accent={C.orange} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Joystick izquierdo: girar el auto (no se desliza)', 'Acelera solo · 🛑 FRENO para frenar', `Pasa los ${KT_RINGS} aros en orden: cada uno suma ${KT_BONUS} s`, '🌳 Árboles y rocas frenan · 🟧 las rampas saltan'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
