import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, SCREEN_H, SCREEN_W, clamp, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { car } from '../utils/prefabs';
import { compassAngle, forward, right, seeded } from '../utils/openworld';

// REPARTO EN MOTO – reparte pedidos en moto por una ciudad de neón, en primera persona.
// Joystick izquierdo: arriba acelera · abajo frena · izquierda/derecha giran la moto.
// Recoge el pedido en la luz ámbar y entrégalo en la luz cian: cuanto antes, más propina. 150 s.
// Chocar con autos (−5 s) o con edificios (−3 s) resta tiempo.
const RP_P = 24, RP_SW = 8, RP_K = 7, RP_LEN = RP_K * RP_P + 12;   // calles cada RP_P; ancho RP_SW
const RP_TIME = 150, RP_MAXV = 26, RP_ACC = 16, RP_BRK = 30, RP_TURN = 2.2, RP_PR = 0.9;
const RP_BLOCK = RP_P - RP_SW;   // 16: lado de una manzana
const RP_NEON = ['#ff3df2', '#22e6ff', '#ff8a3d', '#9b6bff', '#7dff6b', '#ffc233', '#4d8bff', '#ff4d6d'];
const RP_BODY = ['#1d2238', '#252b47', '#2a2140', '#1f3a44', '#2b2a3e'];
const RP_WIN = ['#ffd27a', '#8fe9ff', '#ffa6e6', '#c7b8ff'];
const RP_CAR_COLS = ['#ffffff', '#ff4d6d', '#22e6ff', '#ffc233', '#7dff6b', '#9b6bff'];
const RP_CAR_KINDS = ['sedan', 'sport', 'suv', 'truck'];
const RP_SKY = '#2a1640';

const rpStreet = r => (Math.floor(r() * (2 * RP_K + 1)) - RP_K) * RP_P;
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
  const blds = [], statics = [];
  // edificios: cuerpo oscuro + franjas de ventanas + remate de neón (todo por instancing y estático)
  for (let i = -RP_K; i < RP_K; i++) for (let j = -RP_K; j < RP_K; j++) {
    if (r() < 0.12) continue;   // solar vacío
    const fw = 9 + r() * 5, fd = 9 + r() * 5, h = 8 + r() * 32;
    const cx = (i + 0.5) * RP_P, cz = (j + 0.5) * RP_P;
    const x = cx + (r() - 0.5) * (RP_BLOCK - fw), z = cz + (r() - 0.5) * (RP_BLOCK - fd);
    const body = RP_BODY[Math.floor(r() * RP_BODY.length)], neon = RP_NEON[Math.floor(r() * RP_NEON.length)], win = RP_WIN[Math.floor(r() * RP_WIN.length)];
    blds.push({ x, z, w: fw, d: fd, h, cd: 0 });
    statics.push({ inst: 'edif', k: 'box', p: [x, h / 2, z], s: [fw, h, fd], c: body, sh: true, recv: true });
    for (let y = 4; y < h - 1.5; y += 5) statics.push({ inst: 'ventana', k: 'box', p: [x, y, z], s: [fw + 0.08, 1.1, fd + 0.08], c: win, e: 0.6 });
    statics.push({ inst: 'neon', k: 'box', p: [x, h + 0.15, z], s: [fw + 0.3, 0.3, fd + 0.3], c: neon, e: 1 });
    if (r() < 0.35) statics.push({ inst: 'antena', k: 'cyl', p: [x + (r() - 0.5) * fw * 0.4, h + 2, z], s: [0.12, 4, 0.12], c: '#9aa3c0' });
  }
  // calles con línea central discontinua (las dos direcciones), sin pintar en los cruces
  for (let k = -RP_K; k <= RP_K; k++) {
    const sx = k * RP_P;
    statics.push({ inst: 'calle', k: 'pla', p: [sx, 0.02, 0], s: [RP_SW, 2 * RP_LEN, 1], c: '#1c1f33', recv: true });
    statics.push({ inst: 'calle', k: 'pla', p: [0, 0.03, sx], s: [2 * RP_LEN, RP_SW, 1], c: '#1c1f33', recv: true });
    for (let z = -RP_LEN; z <= RP_LEN; z += 10) {
      if (Math.abs(z / RP_P - Math.round(z / RP_P)) * RP_P < RP_SW / 2 + 1) continue;
      statics.push({ inst: 'raya', k: 'pla', p: [sx, 0.04, z], s: [0.25, 4, 1], c: '#ffe9a8', e: 0.5 });
      statics.push({ inst: 'raya', k: 'pla', p: [z, 0.05, sx], s: [4, 0.25, 1], c: '#ffe9a8', e: 0.5 });
    }
  }
  statics.push({ inst: 'suelo', k: 'pla', p: [0, 0, 0], s: [700, 700, 1], c: '#15172b', recv: true });

  const cars = Array.from({ length: 14 }, (_, i) => {
    const alongX = i % 2 === 1, dir = r() < 0.5 ? -1 : 1;
    const c = { id: `coche${i}`, alongX, street: rpStreet(r), lane: dir > 0 ? 2 : -2, dir, u: (r() * 2 - 1) * RP_LEN, v: 7 + r() * 7, c: RP_CAR_COLS[Math.floor(r() * RP_CAR_COLS.length)], kind: RP_CAR_KINDS[Math.floor(r() * RP_CAR_KINDS.length)], cd: 0 };
    [c.x, c.z] = carXZ(c);
    return c;
  });
  const s = { r, blds, cars, statics, p: { x: 0, y: 0, z: 0 }, yaw: 0, v: 0, bob: 0, time: RP_TIME, t: 0, money: 0, n: 0, tips: 0, crashes: 0, carry: false, carryT: 0, pick: null, drop: null, toast: null, final: null };
  s.pick = spot(s, s.p, 50, 140);
  s.drop = s.pick;
  return s;
};

// Un auto del tráfico: prefab car con instancing (todas sus piezas en un solo grupo).
const trafficObjs = c => {
  const dx = c.alongX ? c.dir : 0, dz = c.alongX ? 0 : c.dir;
  return car(c.id, [c.x, 0, c.z], { kind: c.kind, c: c.c, yaw: Math.atan2(-dx, -dz), inst: 'trafico' });
};

// Marcador de recogida (ámbar) o entrega (cian): haz de luz y anillo en el suelo.
const markerObjs = (id, q, col, t) => [
  { id, k: 'cyl', p: [q.x, 11, q.z], s: [1.4, 22, 1.4], c: col, e: 0.8, o: 0.22 + Math.sin(t * 3) * 0.05 },
  { id: `${id}aro`, k: 'tor', p: [q.x, 0.5, q.z], n: 3, r: [Math.PI / 2, 0, t * 1.5], c: col, e: 0.9 },
];

// Escena: ciudad estática, tráfico, marcador activo, luces y la moto vista desde el manillar (primera persona).
function buildScene(s, t) {
  const p = s.p, v = s.v / RP_MAXV, bob = Math.sin(s.t * 13) * 0.03 * v;
  const cp = [p.x, 1.25 + bob, p.z], F = forward(s.yaw), R = right(s.yaw);
  const at = (fw, rt, up) => [cp[0] + F[0] * fw + R[0] * rt, cp[1] + up, cp[2] + F[1] * fw + R[1] * rt];
  const objs = [];
  for (const c of s.cars) if (Math.hypot(c.x - p.x, c.z - p.z) < 110) objs.push(...trafficObjs(c));
  objs.push(...(s.carry ? markerObjs('casa', s.drop, C.cyan, t) : markerObjs('recogida', s.pick, C.amber, t)));
  // manillar, depósito y faro (3D, pegados a la cámara)
  const bar = { r: [0, s.yaw, Math.PI / 2] };
  objs.push(
    { id: 'mbar', k: 'cyl', p: at(1.9, 0, -0.55), s: [0.05, 0.8, 0.05], r: bar.r, c: '#2a2d3a', m: { r: 0.3, m: 0.8 } },
    { id: 'mgriL', k: 'cyl', p: at(1.9, -0.36, -0.55), s: [0.07, 0.16, 0.07], r: bar.r, c: '#15151c' },
    { id: 'mgriR', k: 'cyl', p: at(1.9, 0.36, -0.55), s: [0.07, 0.16, 0.07], r: bar.r, c: '#15151c' },
    { id: 'mtan', k: 'box', p: at(2.5, 0, -0.78), s: [0.4, 0.2, 0.6], r: [0, s.yaw, 0], c: '#ff3df2', e: 0.25, m: { r: 0.25, m: 0.6 } },
    { id: 'mfar', k: 'sph', p: at(2.9, 0, -0.62), n: 0.12, c: '#fff7c2', e: 1, sh: false },
  );
  const lights = [{ p: [(s.carry ? s.drop : s.pick).x, 3, (s.carry ? s.drop : s.pick).z], c: s.carry ? '#22e6ff' : '#ffb020', i: 14, d: 18 }];
  return {
    sky: { top: '#07061a', bottom: RP_SKY, sun: false, clouds: 0 },
    fog: { c: RP_SKY, near: 40, far: 135 },
    light: { dir: [-0.3, 0.6, 0.4], sun: '#8a7bff', i: 0.8, sky: '#7a6aff', ground: '#1a1433', hi: 1.2 },
    shadowR: 30,
    statics: s.statics,
    lights,
    objs,
    cam: { p: cp, yaw: s.yaw, pitch: 0, fov: 66 + v * 8 },
  };
}

export function Reparto3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('reparto');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); move.x = 0; move.y = 0; setPhase('play'); hx.tap(); };
  const finish = s => {
    if (s.final != null) return;
    s.final = s.money; s.time = 0; move.x = move.y = 0;
    if (s.n >= 5) hx.win(); else hx.die();
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

    // edificios: caja sólida; chocar resta tiempo y empuja fuera
    for (const b of s.blds) {
      if (b.cd > 0) b.cd -= dt;
      if (Math.abs(b.x - p.x) > 14 || Math.abs(b.z - p.z) > 14) continue;
      const cx = clamp(p.x, b.x - b.w / 2, b.x + b.w / 2), cz = clamp(p.z, b.z - b.d / 2, b.z + b.d / 2);
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d >= RP_PR) continue;
      if (d > 1e-4) { p.x = cx + (dx / d) * RP_PR; p.z = cz + (dz / d) * RP_PR; } else p.x = b.x - b.w / 2 - RP_PR;
      if (b.cd <= 0 && s.v > 3) {
        b.cd = 1.0; s.time -= 3; s.v *= 0.3; s.crashes += 1;
        hx.hit(); fx.shake(10, 0.35); fx.flash(C.red, 0.2);
        burst3d([p.x + f[0] * 0.5, 1.0, p.z + f[1] * 0.5], ['#ffc233', '#ffffff', '#ff8a3d'], 22, { speed: 6, up: 2, g: 12, size: 0.14, life: 0.6 });
        s.toast = { m: '🧱 ¡Choque! −3 s', t: 1.2 };
      }
    }

    // autos: circulan por las calles; chocar resta tiempo
    for (const c of s.cars) {
      if (c.cd > 0) c.cd -= dt;
      c.u += c.dir * c.v * dt;
      if (c.u > RP_LEN) c.u -= 2 * RP_LEN; else if (c.u < -RP_LEN) c.u += 2 * RP_LEN;
      [c.x, c.z] = carXZ(c);
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), R2 = 2.2;
      if (d >= R2 || d < 1e-4) continue;
      p.x = c.x + (dx / d) * R2; p.z = c.z + (dz / d) * R2;
      if (c.cd <= 0 && s.v > 3) {
        c.cd = 1.5; s.time -= 5; s.v *= 0.3; s.crashes += 1;
        hx.bad(); fx.shake(12, 0.4); fx.flash(C.red, 0.25);
        burst3d([c.x, 1.0, c.z], ['#ff8a3d', '#ffffff', '#ff4d6d'], 26, { speed: 7, up: 3, g: 12, size: 0.16, life: 0.7 });
        s.toast = { m: '🚗 ¡Choque! −5 s', t: 1.2 };
      }
    }

    // recoger y entregar
    if (!s.carry) {
      if (Math.hypot(s.pick.x - p.x, s.pick.z - p.z) < 7) {
        s.carry = true; s.carryT = 0;
        s.drop = spot(s, s.pick, 60, 170);
        hx.good(); fx.flash(C.amber, 0.2);
        ring3d([s.pick.x, 1, s.pick.z], C.amber, 24, { speed: 6, life: 0.7 });
        s.toast = { m: '🍜 Pedido recogido', t: 1.4 };
      }
    } else {
      s.carryT += dt;
      if (Math.hypot(s.drop.x - p.x, s.drop.z - p.z) < 7) {
        const tip = clamp(Math.round((40 - s.carryT) * 5), 10, 150), pay = 100 + tip;
        s.money += pay; s.n += 1; s.tips += tip; s.carry = false;
        s.pick = spot(s, p, 60, 150);
        hx.win(); fx.flash(C.cyan, 0.25);
        ring3d([s.drop.x, 1, s.drop.z], C.cyan, 30, { speed: 7, life: 0.8 });
        burst3d([s.drop.x, 3, s.drop.z], ['#ff3df2', '#22e6ff', '#ffc233', '#7dff6b'], 40, { speed: 7, up: 5, g: 9, size: 0.2, life: 1.2 });
        fx.pop(SCREEN_W / 2, SCREEN_H * 0.4, `+${pay}`, C.lime, 28);
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
  const scene = buildScene(s, s.t);
  const tc = s.carry ? C.cyan : C.amber;
  return (
    <Game3D title="REPARTO EN MOTO" emoji="🛵" accent={C.pink} onExit={onExit} score={sc} best={best} scoreLabel="DINERO" fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(s, t)} orbit={{ r: 16, h: 6, speed: 0.14, ly: 1.5 }}
      hud={<><HudPill icon="📦" value={String(s.n)} color={C.lime} /><HudPill icon="⏱" value={`${Math.ceil(s.time)}s`} color={s.time < 15 ? C.red : C.amber} /><HudPill value={`${kmh} km/h`} color={C.cyan} /></>}
      subtitle="Reparte pedidos por la ciudad de neón"
      lines={['Joystick izquierdo: arriba acelera · abajo frena', 'Izquierda y derecha: giras la moto', '🍜 Recoge el pedido en la luz ámbar', '🏠 Entrégalo en la luz cian: cuanto antes, más propina', '🚗🧱 Autos (−5 s) y edificios (−3 s) restan tiempo']}
      result={{ won: false, isNew: res.isNew, title: '¡TURNO TERMINADO!', emoji: '🏁', subtitle: `${s.n} entregas · ${s.crashes} choques`, stats: [['ENTREGAS', s.n], ['PROPINAS', s.tips], ['CHOQUES', s.crashes]] }}>
      {phase === 'play' && (
        <>
          <View3 l={10} r={84}>
            <Text style={{ color: tc, fontWeight: '900', fontSize: 12 }}>{s.carry ? '🏠 Entrega en la luz cian' : '🍜 Recoge el pedido en la luz ámbar'}</Text>
          </View3>
          <CompassDisc color={tc} ang={ang} dist={dist} />
        </>
      )}
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '24%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      <Stick3D testID="rp-move" v={move} side="left" color={C.pink} />
    </Game3D>
  );
}

// Banda superior con la instrucción actual (sin tapar la brújula).
function View3({ l, r, children }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: l, right: r, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 }}>{children}</View>
  );
}

// Brújula: flecha hacia el objetivo y la distancia.
function CompassDisc({ color, ang, dist }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 10, right: 10, width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: color, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontSize: 20, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>{Math.round(dist)} m</Text>
    </View>
  );
}
