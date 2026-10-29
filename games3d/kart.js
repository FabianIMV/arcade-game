import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, clamp, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { car, hash01, rock, shade, tree } from '../utils/prefabs';
import { compassAngle, followCam, forward, makeHeightmap, seeded } from '../utils/openworld';

// RALLY ABIERTO – contrarreloj en 3D por un paisaje con colinas, árboles, rocas y rampas.
// Joystick izquierdo: girar el auto · FRENO: frenar (el auto acelera solo). Pasa los 10 aros en orden antes de que
// acabe el tiempo; cada aro suma 7 s. Árboles y rocas frenan el auto · las rampas lo lanzan por el aire.
const KT_SIZE = 240, KT_HALF = KT_SIZE / 2, KT_RINGS = 10, KT_TIME = 25, KT_BONUS = 7;
const KT_TREES = 150, KT_ROCKS = 90, KT_RAMPS = 4;
const KT_MAXV = 26, KT_ACC = 12, KT_BRK = 34, KT_VTOP = 34, KT_TURN = 2.4, KT_GRAV = 26, KT_CAR_R = 1.1;
const KT_RL = 9, KT_RW = 6, KT_RH = 3.2;            // rampa: largo, ancho y altura
const KT_TREE_COLS = ['#2f8f3a', '#2c7d46', '#3e9b3a', '#5aa83c'];
const KT_SKY = '#8fd0ff';
const ktColor = (y, x, z) => shade(y < 0 ? '#c2ad74' : y < 2.5 ? '#7cb857' : y < 6 ? '#5f9f45' : '#8f8b74', 0.92 + hash01(`${x.toFixed(0)},${z.toFixed(0)}`) * 0.16);
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
  // salida: 14 m detrás del primer aro, mirando hacia él
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
  const trees = place(KT_TREES, 9, (i, x, z) => ({ id: `arbol${i}`, x, z, y: hm.h(x, z), h: 2.2 + r() * 1.2, r: 1.3, cd: 0, kind: r() < 0.6 ? 'pine' : 'oak', col: KT_TREE_COLS[Math.floor(r() * KT_TREE_COLS.length)] }));
  const rocks = place(KT_ROCKS, 6, (i, x, z) => {
    const sc = 0.8 + r() * 0.9, rr = 1.1 * sc;
    return { id: `roca${i}`, x, z, y: hm.h(x, z), h: sc, rot: r() * 3, r: rr, cd: 0 };
  });
  // decorado ESTÁTICO (una vez, con instancing): árboles y rocas
  const statics = [];
  for (const t of trees) statics.push(...tree(t.id, [t.x, t.y, t.z], { kind: t.kind, h: t.h, leaf: t.col, inst: 'arbol' }));
  for (const o of rocks) statics.push(...rock(o.id, [o.x, o.y, o.z], { kind: 'boulder', h: o.h, c: '#8d8a86', inst: 'roca' }));
  const s = {
    hm, rings, ramps, obs: [...trees, ...rocks], statics, next: 0, prevSd: null, time: KT_TIME, t: 0, toast: null, final: null, vmax: 0,
    terrain: { id: `rally${seed}`, h: hm.h, size: KT_SIZE, step: 3, color: ktColor },
    yaw, camYaw: yaw, spin: 0, steer: 0,
    car: { x: sx, z: sz, y: 0, v: 0, vy: 0, air: false, g: 0, grade: 0 },
  };
  s.car.y = groundAt(s, sx, sz); s.car.g = s.car.y;
  const cam0 = followCam(s.car, yaw, { hm, dist: 9, height: 4.2, look: 3 });
  s.cp = cam0.p.slice(); s.cl = cam0.l.slice();
  return s;
};

// Escena completa (juego y fondo de los menús): cielo, terreno, decorado estático, aros, rampas y el auto.
function buildScene(s, t) {
  const c = s.car, objs = [];
  s.ramps.forEach(rp => {
    const Lr = Math.hypot(KT_RL, KT_RH), th = Math.atan2(KT_RH, KT_RL), cy = rp.base + KT_RH / 2 - 0.25;
    objs.push(rp.axis === 'z'
      ? { id: rp.id, k: 'box', p: [rp.x, cy, rp.z], s: [KT_RW, 0.5, Lr], r: [-rp.dir * th, 0, 0], c: '#ff8a3d', e: 0.15 }
      : { id: rp.id, k: 'box', p: [rp.x, cy, rp.z], s: [Lr, 0.5, KT_RW], r: [0, 0, rp.dir * th], c: '#ff8a3d', e: 0.15 });
  });
  s.rings.slice(s.next).forEach((rr, j) => {
    objs.push({ id: rr.id, k: 'tor', p: [rr.x, rr.y, rr.z], n: 4.2, r: [0, rr.ry, 0], c: j === 0 ? C.lime : C.amber, e: j === 0 ? 0.8 : 0.35 });
    if (j === 0) objs.push({ id: 'haz', k: 'cyl', p: [rr.x, rr.y + 10, rr.z], s: [0.5, 20, 0.5], c: C.lime, e: 0.9, o: 0.22 + Math.sin(t * 4) * 0.05 });
  });
  objs.push(...car('kart', [c.x, c.y, c.z], { kind: 'sport', c: '#ff3d5a', yaw: s.yaw, pitch: s.pitch || 0, roll: s.roll || 0, steer: s.steer, spin: s.spin }));
  return {
    sky: { top: '#3a8fe8', bottom: KT_SKY, sun: true, clouds: 7 },
    fog: { c: KT_SKY, near: 80, far: 210 },
    shadowR: 30,
    terrain: s.terrain,
    statics: s.statics,
    objs,
    cam: { p: s.cp, l: s.cl, fov: 62 },
  };
}

export function Rally3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('kart');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const brake = useRef({ on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); move.x = 0; move.y = 0; brake.on = false; setPhase('play'); hx.tap(); };
  const finish = (s, won) => {
    brake.on = false; move.x = 0;
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
    s.steer += ((move.x || 0) * 0.45 - s.steer) * Math.min(1, dt * 8);

    // velocidad: acelera solo, FRENO frena; las cuestas frenan o empujan
    const d = (brake.on ? 0 : KT_MAXV) - c.v;
    c.v += clamp(d, -KT_BRK * dt, KT_ACC * dt);
    c.v = clamp(c.v - c.grade * 9.8 * dt, 0, KT_VTOP);
    s.vmax = Math.max(s.vmax, c.v);

    // movimiento hacia donde mira el auto
    const f = forward(s.yaw);
    c.x += f[0] * c.v * dt; c.z += f[1] * c.v * dt;
    const lim = KT_HALF - 6;
    if (Math.abs(c.x) > lim || Math.abs(c.z) > lim) { c.x = clamp(c.x, -lim, lim); c.z = clamp(c.z, -lim, lim); c.v *= 0.5; }

    // árboles y rocas: frenan el auto, saltan chispas
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
        burst3d([c.x - nx * 1.2, c.y + 1.0, c.z - nz * 1.2], ['#ffd54a', '#ffffff', '#ff8a3d'], 22, { speed: 7, up: 3, g: 14, size: 0.14, life: 0.6 });
        s.toast = { m: '💥 ¡Choque!', t: 0.9 };
      }
    }

    // suelo, saltos de rampa y gravedad
    const gPrev = c.g, gNow = groundAt(s, c.x, c.z);
    c.g = gNow;
    if (c.air || c.y > gNow + 0.6) {
      if (!c.air && c.vy > 3) burst3d([c.x, c.y, c.z], '#d8c39a', 14, { speed: 4, up: 2, g: 6, size: 0.3, life: 0.8 });
      c.air = true; c.vy -= KT_GRAV * dt; c.y += c.vy * dt; c.grade = 0;
      if (c.y <= gNow) {
        if (c.vy < -14) { hx.hit(); fx.shake(7, 0.25); ring3d([c.x, c.y + 0.1, c.z], '#d8c39a', 16, { speed: 5, life: 0.5, size: 0.2 }); }
        c.y = gNow; c.vy = 0; c.air = false;
      }
    } else {
      c.y = gNow; c.vy = (gNow - gPrev) / Math.max(dt, 1e-4);
      c.grade = clamp((gNow - gPrev) / Math.max(c.v * dt, 0.01), -1, 1);
    }
    s.pitch = c.air ? clamp(c.vy * 0.025, -0.4, 0.4) : clamp(c.grade * 0.5, -0.4, 0.4);
    s.roll = clamp(-(move.x || 0) * Math.min(1, c.v / 20) * 0.08, -0.1, 0.1);
    s.spin += c.v * dt / 0.36;

    // polvo al correr por tierra
    if (!c.air && c.v > 6) {
      s.dustT = (s.dustT || 0) - dt;
      if (s.dustT <= 0) {
        s.dustT = 0.09;
        const bx = c.x - f[0] * 1.8, bz = c.z - f[1] * 1.8;
        burst3d([bx, c.y + 0.25, bz], ['#d8c39a', '#b9a57a'], 2, { speed: 2.4, up: 1.2, g: 3, size: 0.32, life: 0.8, drag: 2 });
      }
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
        ring3d([rg.x, rg.y, rg.z], C.lime, 26, { speed: 7, life: 0.7, size: 0.2 });
        burst3d([rg.x, rg.y, rg.z], [C.lime, C.amber, '#ffffff'], 30, { speed: 7, up: 3, g: 10, size: 0.2, life: 1.0 });
        s.toast = { m: `🏁 Aro ${s.next}/${KT_RINGS} · +${KT_BONUS} s`, t: 1.4 };
        if (s.next >= KT_RINGS) { finish(s, true); return; }
      }
    }

    // cámara suave: sigue el yaw del auto y se acerca a su objetivo con retardo
    s.camYaw += ktWrap(s.yaw - s.camYaw) * Math.min(1, dt * 5);
    const cam = followCam(c, s.camYaw, { hm: s.hm, dist: 9, height: 4.2, look: 3 }), k = 1 - Math.exp(-dt * 10);
    for (let i = 0; i < 3; i++) { s.cp[i] += (cam.p[i] - s.cp[i]) * k; s.cl[i] += (cam.l[i] - s.cl[i]) * k; }
  });

  const s = g.current; const c = s.car;
  const sc = s.final != null ? s.final : s.next * 100;
  const rg = s.rings[s.next];
  const ang = rg ? compassAngle(c, s.yaw, rg) : 0;
  const dist = rg ? Math.hypot(rg.x - c.x, rg.z - c.z) : 0;
  const scene = buildScene(s, s.t);
  const kmh = Math.round(c.v * 3.6);
  return (
    <Game3D title="RALLY ABIERTO" emoji="🏎️" accent={C.orange} onExit={onExit} score={sc} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(s, t)} orbit={{ r: 14, h: 5.5, speed: 0.2, ly: 1.2 }}
      hud={<><HudPill icon="🏁" value={`${s.next}/${KT_RINGS}`} color={C.lime} /><HudPill icon="⏱" value={`${Math.ceil(s.time)}s`} color={s.time < 10 ? C.red : C.amber} /><HudPill value={`${kmh} km/h`} color={C.cyan} /></>}
      subtitle="Contrarreloj por un paisaje abierto"
      lines={['Joystick izquierdo: girar el auto (no se desliza)', 'Acelera solo · FRENO para frenar', `Pasa los ${KT_RINGS} aros en orden: cada uno suma ${KT_BONUS} s`, '🌳 Árboles y rocas frenan · 🟧 las rampas saltan']}
      result={{ won: res.won, isNew: res.isNew, title: res.won ? '¡RALLY COMPLETADO!' : 'TIEMPO AGOTADO', emoji: res.won ? '🏆' : '🏎️', subtitle: res.won ? 'Has pasado todos los aros' : `🏁 ${s.next}/${KT_RINGS} aros`, stats: [['AROS', `${s.next}/${KT_RINGS}`], ['TIEMPO', `${Math.ceil(s.time)}s`], ['VEL. MÁX', `${Math.round(s.vmax * 3.6)} km/h`]] }}>
      {phase === 'play' && rg && (
        <CompassPill>
          <Text style={{ color: C.lime, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Aro {s.next + 1} a {Math.round(dist)} m</Text>
        </CompassPill>
      )}
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '24%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      <Stick3D testID="kt-steer" v={move} side="left" color={C.orange} />
      <ActionBtn testID="kt-brake" label="FRENO" icon="🛑" color={C.red} onDown={() => { brake.on = true; }} onUp={() => { brake.on = false; }} style={{ right: 24, bottom: 40 }} />
    </Game3D>
  );
}

// Píldora centrada arriba con la flecha hacia el siguiente aro.
function CompassPill({ children }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>{children}</View>
    </View>
  );
}
