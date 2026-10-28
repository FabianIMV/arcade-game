import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_W, C, GameScreen, Overlay, PlayArea, TouchStick, alpha, clamp, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { compassAngle, eyeCam, forward, near, seeded } from '../utils/openworld';

// REPARTO EN MOTO – reparte pedidos en moto por una ciudad en cuadrícula, en primera persona.
// Joystick izquierdo: arriba acelera · abajo frena · izquierda/derecha giran la moto.
// Recoge el pedido en el restaurante (luz ámbar) y entrégalo en la casa (luz cian). 150 s.
const RP_P = 24, RP_SW = 8, RP_K = 7, RP_LEN = RP_K * RP_P + 12;   // calles en k·P; manzana = P - calle
const RP_TIME = 150, RP_MAXV = 26, RP_ACC = 16, RP_BRK = 30, RP_TURN = 2.2, RP_PR = 0.9;
const RP_COLS = ['#ff3df2', '#22e6ff', '#ff8a3d', '#9b6bff', '#7dff6b', '#ffc233', '#4d8bff', '#ff4d6d'];
const RP_CAR_COLS = ['#ffffff', '#ff4d6d', '#22e6ff', '#ffc233', '#7dff6b', '#9b6bff'];
const RP_BLOCK = RP_P - RP_SW;   // 16: lado de una manzana

const rpCount = () => 2 * RP_K + 1;
const rpStreet = r => (Math.floor(r() * rpCount()) - RP_K) * RP_P;

// Punto sobre una calle (a su derecha o izquierda), a una distancia entre minD y maxD de "from".
const spot = (s, from, minD, maxD) => {
  for (let t = 0; t < 200; t++) {
    const k = rpStreet(s.r), u = (s.r() * 2 - 1) * (RP_LEN - 20), alongX = s.r() < 0.5, lane = s.r() < 0.5 ? -2 : 2;
    const x = alongX ? u : k + lane, z = alongX ? k + lane : u;
    const d = Math.hypot(x - from.x, z - from.z);
    if (d >= minD && d <= maxD) return { x, z };
  }
  return { x: from.x + minD, z: from.z };
};
// Posición de un auto (siempre sobre su carril).
const carXZ = c => (c.alongX ? [c.u, c.street + c.lane] : [c.street + c.lane, c.u]);

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const blds = [];
  for (let i = -RP_K; i < RP_K; i++) for (let j = -RP_K; j < RP_K; j++) {
    if (r() < 0.12) continue;   // solar vacío
    const fw = 9 + r() * 5, fd = 9 + r() * 5;
    const cx = (i + 0.5) * RP_P, cz = (j + 0.5) * RP_P;
    const x = cx + (r() - 0.5) * (RP_BLOCK - fw), z = cz + (r() - 0.5) * (RP_BLOCK - fd);
    blds.push({ id: `edif${i}_${j}`, x, z, w: fw, d: fd, h: 8 + r() * 32, c: RP_COLS[Math.floor(r() * RP_COLS.length)], cd: 0 });
  }
  const cars = Array.from({ length: 14 }, (_, i) => {
    const alongX = i % 2 === 1, dir = r() < 0.5 ? -1 : 1;
    const c = { id: `coche${i}`, alongX, street: rpStreet(r), lane: dir > 0 ? 2 : -2, dir, u: (r() * 2 - 1) * RP_LEN, v: 7 + r() * 7, c: RP_CAR_COLS[Math.floor(r() * RP_CAR_COLS.length)], cd: 0 };
    [c.x, c.z] = carXZ(c);
    return c;
  });
  const s = { r, blds, cars, p: { x: 0, y: 0, z: 0 }, yaw: 0, v: 0, time: RP_TIME, t: 0, money: 0, n: 0, carry: false, carryT: 0, pick: null, drop: null, toast: null, final: null };
  s.pick = spot(s, s.p, 50, 140);
  s.drop = s.pick;
  return s;
};

const carObjs = c => {
  const [x, z] = [c.x, c.z], fwd = c.dir * 1.92;
  const body = c.alongX ? { s: [3.8, 1.0, 1.9] } : { s: [1.9, 1.0, 3.8] };
  const fr = c.alongX ? [x + fwd, z] : [x, z + fwd];
  const side = c.alongX ? [0, 0.6] : [0.6, 0];
  const back = c.alongX ? [x - fwd, z] : [x, z - fwd];
  return [
    { id: `${c.id}c`, k: 'box', p: [x, 0.55, z], s: body.s, c: c.c },
    { id: `${c.id}t`, k: 'box', p: [x, 1.35, z], s: c.alongX ? [2.0, 0.7, 1.6] : [1.6, 0.7, 2.0], c: '#15161f' },
    { id: `${c.id}f1`, k: 'box', p: [fr[0] + side[0], 0.5, fr[1] + side[1]], s: [0.35, 0.22, 0.1], c: '#fff7c2', e: 0.5 },
    { id: `${c.id}f2`, k: 'box', p: [fr[0] - side[0], 0.5, fr[1] - side[1]], s: [0.35, 0.22, 0.1], c: '#fff7c2', e: 0.5 },
    { id: `${c.id}b1`, k: 'box', p: [back[0] + side[0], 0.5, back[1] + side[1]], s: [0.35, 0.22, 0.1], c: '#ff3d5a', e: 0.5 },
    { id: `${c.id}b2`, k: 'box', p: [back[0] - side[0], 0.5, back[1] - side[1]], s: [0.35, 0.22, 0.1], c: '#ff3d5a', e: 0.5 },
  ];
};

const markerObjs = (id, q, col) => [
  { id, k: 'cyl', p: [q.x, 8, q.z], s: [1.6, 16, 1.6], c: col, e: 0.6, o: 0.4 },
  { id: `${id}aro`, k: 'tor', p: [q.x, 0.6, q.z], n: 3, r: [Math.PI / 2, 0, 0], c: col, e: 0.6 },
];

export function Reparto3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('reparto');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); move.x = 0; move.y = 0; setPhase('play'); hx.tap(); };
  const finish = s => {
    s.final = s.money; s.time = 0;
    hx.die();
    setRes({ isNew: submitBest(s.final) }); setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current, p = s.p;
    s.t += dt; s.time -= dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.time <= 0) { finish(s); return; }

    // moto: gas/freno con el joystick (arriba/abajo) y giro (izquierda/derecha)
    const gas = clamp(-(move.y || 0), 0, 1), brk = clamp(move.y || 0, 0, 1);
    s.v += gas * RP_ACC * dt;
    s.v -= brk * RP_BRK * dt;
    s.v -= s.v * 0.08 * dt;
    s.v = clamp(s.v, 0, RP_MAXV);
    s.yaw -= (move.x || 0) * RP_TURN * clamp(s.v / 6, 0, 1) * dt;
    const f = forward(s.yaw);
    p.x += f[0] * s.v * dt; p.z += f[1] * s.v * dt;
    const lim = RP_K * RP_P + 10;
    p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim);

    // edificios: AABB; chocar resta tiempo y empuja fuera
    for (const b of s.blds) {
      if (b.cd > 0) b.cd -= dt;
      if (Math.abs(b.x - p.x) > 14 || Math.abs(b.z - p.z) > 14) continue;
      const cx = clamp(p.x, b.x - b.w / 2, b.x + b.w / 2), cz = clamp(p.z, b.z - b.d / 2, b.z + b.d / 2);
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d >= RP_PR) continue;
      if (d > 1e-4) { p.x = cx + (dx / d) * RP_PR; p.z = cz + (dz / d) * RP_PR; } else p.x = b.x - b.w / 2 - RP_PR;
      if (b.cd <= 0 && s.v > 3) {
        b.cd = 1.0; s.time -= 3; s.v *= 0.3;
        hx.hit(); fx.shake(10, 0.35); fx.flash(C.red, 0.2);
        s.toast = { m: '🧱 ¡Choque! −3 s', t: 1.2 };
      }
    }

    // autos: circulan por las calles; chocar resta tiempo
    for (const c of s.cars) {
      if (c.cd > 0) c.cd -= dt;
      c.u += c.dir * c.v * dt;
      if (c.u > RP_LEN) c.u -= 2 * RP_LEN; else if (c.u < -RP_LEN) c.u += 2 * RP_LEN;
      [c.x, c.z] = carXZ(c);
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), R = 2.2;
      if (d >= R || d < 1e-4) continue;
      p.x = c.x + (dx / d) * R; p.z = c.z + (dz / d) * R;
      if (c.cd <= 0 && s.v > 3) {
        c.cd = 1.5; s.time -= 5; s.v *= 0.3;
        hx.bad(); fx.shake(12, 0.4); fx.flash(C.red, 0.25);
        s.toast = { m: '🚗 ¡Choque! −5 s', t: 1.2 };
      }
    }

    // recoger y entregar
    if (!s.carry) {
      if (Math.hypot(s.pick.x - p.x, s.pick.z - p.z) < 7) {
        s.carry = true; s.carryT = 0;
        s.drop = spot(s, s.pick, 60, 170);
        hx.good(); fx.flash(C.amber, 0.2);
        s.toast = { m: '🍜 Pedido recogido', t: 1.4 };
      }
    } else {
      s.carryT += dt;
      if (Math.hypot(s.drop.x - p.x, s.drop.z - p.z) < 7) {
        const tip = clamp(Math.round((40 - s.carryT) * 5), 10, 150), pay = 100 + tip;
        s.money += pay; s.n += 1; s.carry = false;
        s.pick = spot(s, p, 60, 150);
        hx.win(); fx.flash(C.cyan, 0.25);
        s.toast = { m: `✅ +${pay} (propina ${tip})`, t: 1.6 };
      }
    }
  });

  const s = g.current, p = s.p;
  const tgt = s.carry ? s.drop : s.pick;
  const ang = compassAngle(p, s.yaw, tgt);
  const dist = Math.hypot(tgt.x - p.x, tgt.z - p.z);
  const kmh = Math.round(s.v * 3.6);
  const sc = s.final != null ? s.final : s.money;
  const BW = AREA_W * 0.42;
  const streets = [];
  for (let k = -RP_K; k <= RP_K; k++) {
    const sx = k * RP_P;
    if (Math.abs(sx - p.x) < 110) streets.push({ id: `calleX${k}`, k: 'pla', p: [sx, 0.03, 0], s: [RP_SW, 2 * RP_LEN, 1], c: '#1c1f2e' });
    if (Math.abs(sx - p.z) < 110) streets.push({ id: `calleZ${k}`, k: 'pla', p: [0, 0.04, sx], s: [2 * RP_LEN, RP_SW, 1], c: '#1c1f2e' });
  }
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, 0], s: [480, 480, 1], c: '#262a40' },
    ...streets,
    ...near(s.blds, p, 90).flatMap(b => [
      { id: b.id, k: 'box', p: [b.x, b.h / 2, b.z], s: [b.w, b.h, b.d], c: b.c },
      { id: `${b.id}v1`, k: 'box', p: [b.x, b.h * 0.35, b.z], s: [b.w + 0.06, 0.8, b.d + 0.06], c: '#ffe9a8', e: 0.5 },
      { id: `${b.id}v2`, k: 'box', p: [b.x, b.h * 0.7, b.z], s: [b.w + 0.06, 0.8, b.d + 0.06], c: '#ffe9a8', e: 0.5 },
    ]),
    ...near(s.cars, p, 90).flatMap(carObjs),
    ...(s.carry ? markerObjs('casa', s.drop, C.cyan) : markerObjs('recogida', s.pick, C.amber)),
  ];
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const scene = { bg: '#0d0820', fog: { c: '#0d0820', near: 35, far: 110 }, shake, objs, cam: eyeCam(p, s.yaw, 0, { eye: 1.3, fov: 72 }) };
  const pad = (v, cx) => (
    <View pointerEvents="none" style={{ position: 'absolute', left: cx - 50, bottom: 14, width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
      <View style={{ position: 'absolute', left: 34 + v.x * 32, top: 34 + v.y * 32, width: 32, height: 32, borderRadius: 16, backgroundColor: v.on ? alpha(C.orange, 0.7) : 'rgba(255,255,255,0.35)' }} />
    </View>
  );
  return (
    <GameScreen title="REPARTO EN MOTO" emoji="🛵" accent={C.pink} onExit={onExit} score={sc} best={best}
      hud={<><Text style={{ color: C.lime, fontWeight: '900', fontSize: 12 }}>💵 {s.money}</Text><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>📦 {s.n}</Text><Text style={{ color: s.time < 15 ? C.red : C.amber, fontWeight: '900', fontSize: 12 }}>⏱ {Math.ceil(s.time)}s</Text></>}>
      <PlayArea fx={fx} bg="#0d0820">
        <World3D scene={scene} />
        {phase === 'play' && (
          <>
            <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 10, right: 84, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: s.carry ? C.cyan : C.amber, fontWeight: '900', fontSize: 12 }}>{s.carry ? '🏠 Entrega en la casa de luz cian' : '🍜 Recoge el pedido en la luz ámbar'}</Text>
            </View>
            <View pointerEvents="none" style={{ position: 'absolute', top: 10, right: 10, width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: s.carry ? C.cyan : C.amber, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: s.carry ? C.cyan : C.amber, fontSize: 20, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
              <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>{Math.round(dist)} m</Text>
            </View>
          </>
        )}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: 120, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
        {phase === 'play' && (
          <>
            <TouchStick testID="rp-move" v={move} R={44} style={{ position: 'absolute', left: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            {pad(move, 62)}
          </>
        )}
        {/* manillar y tablero (primera persona, como Moto 3D) */}
        <View pointerEvents="none" style={{ position: 'absolute', left: (AREA_W - BW) / 2, bottom: -26, width: BW, height: 120, alignItems: 'center' }}>
          <View style={{ position: 'absolute', top: 30, left: 0, right: 0, height: 12, borderRadius: 6, backgroundColor: '#1d1d24', borderWidth: 2, borderColor: '#444' }} />
          <View style={{ position: 'absolute', top: 22, left: -4, width: 46, height: 28, borderRadius: 10, backgroundColor: '#111' }} />
          <View style={{ position: 'absolute', top: 22, right: -4, width: 46, height: 28, borderRadius: 10, backgroundColor: '#111' }} />
          <View style={{ position: 'absolute', top: 6, width: 120, height: 92, borderTopLeftRadius: 60, borderTopRightRadius: 60, backgroundColor: '#15151c', borderWidth: 2, borderColor: alpha(C.cyan, 0.8), alignItems: 'center', paddingTop: 12 }}>
            <Text style={{ color: '#fff', fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'], ...tglow(C.cyan, 8) }}>{kmh}</Text>
            <Text style={{ color: C.dim, fontSize: 9, fontWeight: '900', letterSpacing: 2 }}>KM/H</Text>
          </View>
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? '🏁' : '🛵'} title={phase === 'over' ? '¡TURNO TERMINADO!' : 'REPARTO EN MOTO'}
          subtitle={phase === 'ready' ? 'Reparte pedidos por la ciudad en 150 s' : `💵 ${s.money} · ${s.n} entregas`}
          score={sc} best={best} isNew={res.isNew} accent={C.pink} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Joystick izquierdo: arriba acelera · abajo frena', 'Izquierda y derecha: giras la moto', '🍜 Recoge el pedido en la luz ámbar', '🏠 Entrégalo en la luz cian: cuanto antes, más propina', '🚗🧱 Autos y edificios restan tiempo'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
