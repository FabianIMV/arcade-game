import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, Combo, GameScreen, Overlay, PlayArea, TouchBtn, TouchStick, alpha, hx, rand, uid, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Mundo abierto: el personaje recorre plataformas 3D y recoge monedas. Cámara detrás del personaje.
// Joystick izquierdo para moverse (relativo a la cámara) y botón SALTAR a la derecha.
const CC_DUR = 30, CC_G = 22, CC_JUMP = 8.6, CC_SPEED = 6.2, CC_EDGE = 20;
const CC_STEP = 0.7;                      // altura máxima que se sube sin saltar
const CC_PLATS = [                        // plataformas: centro x/z, tamaño w (x) × d (z), altura h
  { x: 0, z: -2, w: 5, d: 5, h: 1.0 },
  { x: 8, z: -5, w: 4, d: 4, h: 1.4 },
  { x: -8, z: -6, w: 3, d: 3, h: 1.0 },
  { x: -3, z: 6, w: 4, d: 3, h: 0.5 },
  { x: 6, z: 6, w: 3, d: 3, h: 1.0 },
  { x: -11, z: 3, w: 3, d: 6, h: 0.5 },
  { x: 13, z: 2, w: 2, d: 8, h: 1.0 },
  { x: 0, z: -13, w: 9, d: 3, h: 1.4 },
  { x: -14, z: -12, w: 2, d: 2, h: 1.4 },
  { x: 3, z: 13, w: 3, d: 2, h: 0.5 },
];
const CC_PCOL = ['#3b3f73', '#4a4f8c', '#34396b'];

const surfaceAt = (x, z) => {
  let y = 0;
  for (const p of CC_PLATS) if (Math.abs(x - p.x) < p.w / 2 && Math.abs(z - p.z) < p.d / 2) y = Math.max(y, p.h);
  return y;
};
const lerpAng = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
const initState = () => ({
  p: { x: 0, z: 4, y: 0, vy: 0, grounded: true, heading: 0 },
  camYaw: 0, coins: [], spawn: 0.3, time: CC_DUR, t: 0, score: 0, combo: 0, maxCombo: 0, frenzy: 0, taps: 0, hits: 0,
});

export function CoinCollector3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('coinrush');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const stick = useRef({ x: 0, y: 0, on: false }).current;

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const multOf = s => (1 + (s.combo >= 5 ? 1 : 0) + (s.combo >= 15 ? 1 : 0) + (s.combo >= 30 ? 1 : 0)) * (s.frenzy > 0 ? 2 : 1);
  const spawn = s => {
    const a = rand(0, Math.PI * 2), d = rand(3, 10);
    const x = Math.max(-CC_EDGE, Math.min(CC_EDGE, s.p.x + Math.cos(a) * d));
    const z = Math.max(-CC_EDGE, Math.min(CC_EDGE, s.p.z + Math.sin(a) * d));
    const r = Math.random();
    const type = r < 0.62 ? 'coin' : r < 0.74 ? 'gold' : r < 0.9 ? 'bomb' : 'clock';
    const life = (type === 'gold' ? 3.2 : type === 'bomb' ? 4.4 : 4.8) * Math.max(0.6, 1 - s.t * 0.01);
    s.coins.push({ id: uid(), type, x, z, y: surfaceAt(x, z) + 0.9, age: 0, life, spin: rand(0, 6) });
  };
  const jump = () => {
    const s = g.current;
    if (phase !== 'play' || !s.p.grounded) return;
    s.p.vy = CC_JUMP; s.p.grounded = false; hx.tap();
  };
  const collect = (s, c) => {
    const bx = AREA_W / 2, by = AREA_H * 0.5;
    if (c.type === 'bomb') {
      s.time = Math.max(0, s.time - 3); s.combo = 0;
      fx.burst(bx, by, C.red, 22, 260); fx.shake(9, 0.3); fx.flash(C.red, 0.3); fx.pop(bx, by - 40, '-3s', C.red, 22); hx.bad();
    } else if (c.type === 'clock') {
      s.time += 2; fx.burst(bx, by, C.lime, 12, 190); fx.pop(bx, by - 40, '+2s', C.lime, 22); hx.good();
    } else {
      s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
      const pts = (c.type === 'gold' ? 5 : 1) * multOf(s);
      s.score += pts;
      fx.burst(bx, by, C.amber, 10, 200, 0.5, 4); fx.pop(bx, by - 40, `+${pts}`, multOf(s) > 1 ? C.amber : C.text, 16); hx.hit();
      if (s.combo % 12 === 0) { s.frenzy = 5; fx.flash(C.amber, 0.25); fx.pop(AREA_W / 2, AREA_H * 0.35, '¡FRENESÍ!', C.amber, 28); hx.win(); }
    }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current, p = s.p;
    s.t += dt; s.time -= dt;
    if (s.frenzy > 0) s.frenzy = Math.max(0, s.frenzy - dt);

    // movimiento relativo a la cámara: arriba del joystick = hacia donde mira la cámara
    const th = s.camYaw, fX = Math.sin(th), fZ = -Math.cos(th), rX = Math.cos(th), rZ = Math.sin(th);
    const mx = rX * stick.x - fX * stick.y, mz = rZ * stick.x - fZ * stick.y;
    const mag = Math.hypot(mx, mz);
    if (mag > 0.05) {
      const sp = Math.min(1, mag) * CC_SPEED * dt;
      const dx = (mx / mag) * sp, dz = (mz / mag) * sp;
      const free = (nx, nz) => !(p.grounded && surfaceAt(nx, nz) - p.y > CC_STEP) && Math.abs(nx) < CC_EDGE && Math.abs(nz) < CC_EDGE;
      if (free(p.x + dx, p.z)) p.x += dx;
      if (free(p.x, p.z + dz)) p.z += dz;
      p.heading = lerpAng(p.heading, Math.atan2(mx, -mz), Math.min(1, dt * 12));
    }
    // física vertical: caer, saltar y subir/bajar escalones
    const ground = surfaceAt(p.x, p.z);
    if (p.grounded) {
      if (Math.abs(ground - p.y) <= CC_STEP) { p.y = ground; p.vy = 0; } else p.grounded = false;
    }
    if (!p.grounded) {
      p.vy -= CC_G * dt; p.y += p.vy * dt;
      if (p.y <= ground && p.vy <= 0) { p.y = ground; p.vy = 0; p.grounded = true; }
    }
    s.camYaw = lerpAng(s.camYaw, p.heading, Math.min(1, dt * 2.5));

    s.spawn -= dt;
    if (s.spawn <= 0) { spawn(s); s.spawn = Math.max(0.2, 0.55 - s.t * 0.008) * (s.frenzy > 0 ? 0.5 : 1) * rand(0.7, 1.2); }
    for (let i = s.coins.length - 1; i >= 0; i--) {
      const c = s.coins[i];
      c.age += dt; c.spin += dt * 4;
      if (Math.hypot(c.x - p.x, c.z - p.z) < 1.0 && Math.abs(c.y - (p.y + 0.6)) < 1.5) {
        s.coins.splice(i, 1); s.hits += 1; collect(s, c); continue;
      }
      if (c.age >= c.life) {
        s.coins.splice(i, 1);
        if (c.type === 'coin' || c.type === 'gold') s.combo = 0;
      }
    }
    if (s.time <= 0) { s.time = 0; hx.win(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  });

  const s = g.current, p = s.p;
  const objs = [];
  objs.push({ id: 'suelo', k: 'pla', p: [0, 0, 0], s: [60, 60, 1], c: '#1c3b2a' });
  CC_PLATS.forEach((q, i) => objs.push({ id: `pl${i}`, k: 'box', p: [q.x, q.h / 2, q.z], s: [q.w, q.h, q.d], c: CC_PCOL[i % 3], e: 0.04 }));
  s.coins.forEach(c => {
    const id = `m${c.id}`;
    if (c.type === 'coin') objs.push({ id, k: 'cyl', p: [c.x, c.y, c.z], s: [0.7, 0.12, 0.7], r: [Math.PI / 2 + c.spin, 0, 0], c: '#ffc233', e: 0.1 });
    if (c.type === 'gold') objs.push({ id, k: 'cyl', p: [c.x, c.y, c.z], s: [0.9, 0.16, 0.9], r: [Math.PI / 2 + c.spin, 0, 0], c: '#ffe066', e: 0.14 });
    if (c.type === 'bomb') {
      objs.push({ id, k: 'sph', p: [c.x, c.y, c.z], n: 0.8, c: '#222230', e: 0.04 });
      objs.push({ id: `${id}f`, k: 'box', p: [c.x, c.y + 0.5, c.z], s: [0.12, 0.26, 0.12], c: '#ff8a3d', e: 0.4 });
    }
    if (c.type === 'clock') objs.push({ id, k: 'tor', p: [c.x, c.y, c.z], n: 0.85, r: [c.spin, 0, 0], c: '#7dff6b', e: 0.2 });
  });
  // personaje: cuerpo, cabeza, visera hacia donde mira, sombra en el suelo
  const hd = p.heading, fwX = Math.sin(hd), fwZ = -Math.cos(hd);
  objs.push({ id: 'sombra', k: 'pla', p: [p.x, surfaceAt(p.x, p.z) + 0.02, p.z], s: [0.9, 0.9, 1], c: '#000000', o: 0.35 });
  objs.push({ id: 'cuerpo', k: 'box', p: [p.x, p.y + 0.45, p.z], s: [0.6, 0.9, 0.5], r: [0, hd, 0], c: C.cyan, e: 0.06 });
  objs.push({ id: 'cabeza', k: 'sph', p: [p.x, p.y + 1.1, p.z], n: 0.5, c: '#ffe0b0', e: 0.05 });
  objs.push({ id: 'visera', k: 'box', p: [p.x + fwX * 0.22, p.y + 1.15, p.z + fwZ * 0.22], s: [0.42, 0.14, 0.14], r: [0, hd, 0], c: '#0b0b22' });

  const cth = s.camYaw, cfX = Math.sin(cth), cfZ = -Math.cos(cth);
  const scene = {
    bg: '#0b1630', fog: { c: '#0b1630', near: 18, far: 46 }, objs,
    cam: { p: [p.x - cfX * 6.4, p.y + 3.6, p.z - cfZ * 6.4], l: [p.x + cfX * 1.2, p.y + 1.0, p.z + cfZ * 1.2], fov: 62 },
  };
  const m = multOf(s);

  return (
    <GameScreen title="COIN RUSH" emoji="🪙" accent={C.amber} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: s.time < 8 ? C.red : C.text, fontWeight: '900', fontSize: 15 }}>⏱ {Math.ceil(s.time)}s</Text>{s.frenzy > 0 ? <Text style={{ color: C.amber, fontWeight: '900', fontSize: 13 }}>🔥 FRENESÍ {Math.ceil(s.frenzy)}</Text> : <Text style={{ color: C.dim, fontSize: 12 }}>Racha {s.combo}</Text>}<View style={{ minWidth: 64, alignItems: 'flex-end' }}>{m > 1 ? <Combo n={m} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#0b1630" border={alpha(C.amber, 0.4)}>
        <World3D scene={scene} />
        {phase === 'play' && <>
          <TouchStick testID="stick" v={stick} R={46} style={{ position: 'absolute', left: 6, bottom: 6, width: 132, height: 132 }}>
            <View pointerEvents="none" style={{ flex: 1, borderRadius: 66, borderWidth: 2, borderColor: alpha(C.cyan, 0.4), backgroundColor: alpha(C.cyan, 0.08), alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: alpha(C.cyan, 0.45), borderWidth: 2, borderColor: C.cyan, transform: [{ translateX: stick.x * 36 }, { translateY: stick.y * 36 }] }} />
            </View>
          </TouchStick>
          <TouchBtn testID="jump" onDown={jump} style={{ position: 'absolute', right: 16, bottom: 22, width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: C.amber, backgroundColor: alpha(C.amber, 0.18), alignItems: 'center', justifyContent: 'center' }}>
            <Text pointerEvents="none" style={{ color: C.amber, fontWeight: '900', fontSize: 13, letterSpacing: 1 }}>SALTAR</Text>
          </TouchBtn>
        </>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🪙" title={phase === 'over' ? '¡TIEMPO!' : 'COIN RUSH'}
          subtitle={phase === 'over' ? `Monedas ${s.hits} · Mejor racha ${s.maxCombo}` : '30 segundos en un mundo abierto'}
          score={s.score} best={best} isNew={res.isNew} accent={C.amber} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Joystick izquierdo para moverte · SALTAR para subir', 'Recoge las monedas caminando hacia ellas', '🥇 vale 5 · ⏱️ +2s · 💣 -3s', 'Las rachas suben el multiplicador y activan el frenesí'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
