import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Lives, Overlay, PlayArea, TouchBtn, TouchStick, alpha, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { compassAngle, followCam, jump, makeHeightmap, near, seeded, stepPlayer, terrainObjs } from '../utils/openworld';

// ISLA DEL TESORO – mundo abierto en tercera persona. Joystick izquierdo: caminar · derecho: girar la cámara · SALTAR.
// Encuentra los 8 cofres antes de que acabe el tiempo; los cangrejos de la playa quitan vidas.
const IT_SIZE = 64, IT_CHESTS = 8, IT_TIME = 150, IT_PALMS = 46, IT_CRABS = 6;
const itColor = y => (y < 0.25 ? '#e9d79a' : y < 1.6 ? '#62b04c' : y < 2.6 ? '#4f9640' : '#8d8a7c');

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const hm = makeHeightmap(seed, IT_SIZE, { amp: 3.4, island: true });
  const land = (minY, maxY) => { for (let k = 0; k < 400; k++) { const x = (r() - 0.5) * IT_SIZE * 0.8, z = (r() - 0.5) * IT_SIZE * 0.8; const y = hm.h(x, z); if (y > minY && y < maxY && Math.hypot(x, z) > 6) return { x, z, y }; } return { x: 4, z: 4, y: hm.h(4, 4) }; };
  const chests = Array.from({ length: IT_CHESTS }, (_, i) => ({ id: `c${i}`, ...land(0.4, 9), got: false }));
  const palms = Array.from({ length: IT_PALMS }, (_, i) => ({ id: `p${i}`, ...land(0.2, 2.2), h: 2.6 + r() * 1.6 }));
  const crabs = Array.from({ length: IT_CRABS }, (_, i) => ({ id: `k${i}`, ...land(0.05, 0.6), a: r() * 6.28, tm: 1 }));
  return { hm, chests, palms, crabs, p: { x: 0, y: hm.h(0, 0), z: 0, vy: 0, face: 0 }, yaw: 0, time: IT_TIME, got: 0, lives: 3, inv: 0, t: 0, toast: null, final: null };
};

export function IslaTesoro3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('islatesoro');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = (s, won) => {
    s.final = s.got * 100 + (won ? Math.ceil(s.time) * 5 : 0);
    if (won) hx.win(); else hx.die();
    setRes({ isNew: submitBest(s.final), won }); setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt; s.time -= dt; s.inv = Math.max(0, s.inv - dt);
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.time <= 0) { s.time = 0; finish(s, false); return; }
    s.yaw -= look.x * 2.4 * dt;
    stepPlayer(s.p, move, dt, { yaw: s.yaw, hm: s.hm, speed: 6.5, bounds: IT_SIZE / 2 - 3 });
    if (s.p.y < 0.05) { s.p.y = 0.05; }   // vadear la orilla
    for (const c of s.chests) {
      if (c.got) continue;
      if (Math.hypot(c.x - s.p.x, c.z - s.p.z) < 1.6) {
        c.got = true; s.got += 1; hx.good(); fx.flash(C.amber, 0.25);
        s.toast = { m: `💰 Cofre ${s.got}/${IT_CHESTS}`, t: 1.6 };
        if (s.got >= IT_CHESTS) { finish(s, true); return; }
      }
    }
    for (const k of s.crabs) {
      k.tm -= dt; if (k.tm <= 0) { k.a += (Math.random() - 0.5) * 3; k.tm = 1 + Math.random() * 2; }
      const nx = k.x + Math.cos(k.a) * 1.4 * dt, nz = k.z + Math.sin(k.a) * 1.4 * dt;
      const y = s.hm.h(nx, nz); if (y > 0 && y < 0.9) { k.x = nx; k.z = nz; } else k.a += Math.PI;
      k.y = s.hm.h(k.x, k.z);
      if (s.inv <= 0 && Math.hypot(k.x - s.p.x, k.z - s.p.z) < 1) {
        s.lives -= 1; s.inv = 1.5; hx.bad(); fx.shake(8, 0.3); fx.flash(C.red, 0.3);
        s.toast = { m: '🦀 ¡Pinza!', t: 1.2 };
        if (s.lives <= 0) { finish(s, false); return; }
      }
    }
  });

  const s = g.current; const p = s.p;
  const left = s.chests.filter(c => !c.got);
  let target = null, td = 1e9; left.forEach(c => { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < td) { td = d; target = c; } });
  const ang = target ? compassAngle(p, s.yaw, target) : 0;
  const blink = s.inv > 0 && Math.floor(s.t * 12) % 2 === 0;
  const objs = [
    { id: 'mar', k: 'pla', p: [p.x, 0.02, p.z], s: [160, 160, 1], c: '#2a8ad8', o: 0.92 },
    ...terrainObjs(s.hm, p, 24, 3, itColor),
    ...near(s.palms, p, 28).flatMap(t => [
      { id: `${t.id}a`, k: 'cyl', p: [t.x, t.y + t.h / 2, t.z], s: [0.32, t.h, 0.32], c: '#8a5a32' },
      { id: `${t.id}b`, k: 'cone', p: [t.x, t.y + t.h + 0.3, t.z], s: [2.4, 1, 2.4], c: '#2f9a3e' },
    ]),
    ...near(left, p, 34).flatMap(c => [
      { id: c.id, k: 'box', p: [c.x, c.y + 0.4, c.z], s: [1.1, 0.8, 0.8], c: '#a8692a' },
      { id: `${c.id}t`, k: 'box', p: [c.x, c.y + 0.85, c.z], s: [1.15, 0.12, 0.85], c: C.amber, e: 0.4 },
      { id: `${c.id}r`, k: 'tor', p: [c.x, c.y + 2 + Math.sin(s.t * 3) * 0.2, c.z], n: 0.9, c: C.amber, e: 0.6, r: [Math.PI / 2, 0, s.t * 2] },
    ]),
    ...near(s.crabs, p, 26).flatMap(k => [
      { id: k.id, k: 'sph', p: [k.x, k.y + 0.3, k.z], s: [0.9, 0.45, 0.7], c: '#e2553a' },
      { id: `${k.id}o`, k: 'sph', p: [k.x, k.y + 0.6, k.z], n: 0.2, c: '#ffffff' },
    ]),
    // jugador
    { id: 'cuerpo', k: 'box', p: [p.x, p.y + 0.7, p.z], s: [0.7, 1.0, 0.45], r: [0, p.face, 0], c: blink ? '#ffffff' : '#2f6fd8' },
    { id: 'cabeza', k: 'sph', p: [p.x, p.y + 1.45, p.z], n: 0.55, c: '#f2c29b' },
    { id: 'sombrero', k: 'cyl', p: [p.x, p.y + 1.78, p.z], s: [0.8, 0.12, 0.8], c: '#3a2a1a' },
  ];
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const scene = { bg: '#8fd3ff', fog: { c: '#8fd3ff', near: 22, far: 46 }, shake, objs, cam: followCam(p, s.yaw, { hm: s.hm, dist: 7.5, height: 4 }) };
  const sc = s.final != null ? s.final : s.got * 100;
  const pad = (v, cx) => (
    <View pointerEvents="none" style={{ position: 'absolute', left: cx - 50, bottom: 14, width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
      <View style={{ position: 'absolute', left: 34 + v.x * 32, top: 34 + v.y * 32, width: 32, height: 32, borderRadius: 16, backgroundColor: v.on ? alpha(C.amber, 0.7) : 'rgba(255,255,255,0.35)' }} />
    </View>
  );
  return (
    <GameScreen title="ISLA DEL TESORO" emoji="🏝️" accent={C.amber} onExit={onExit} score={sc} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>💰 {s.got}/{IT_CHESTS}</Text><Text style={{ color: s.time < 20 ? C.red : C.amber, fontWeight: '900', fontSize: 12 }}>⏱ {Math.ceil(s.time)}s</Text></>}>
      <PlayArea fx={fx} bg="#8fd3ff">
        <World3D scene={scene} />
        {phase === 'play' && target && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: C.amber, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Cofre a {Math.round(td)} m</Text>
            </View>
          </View>
        )}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.25, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
        {phase === 'play' && (
          <>
            <TouchStick testID="it-move" v={move} R={44} style={{ position: 'absolute', left: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            <TouchStick testID="it-look" v={look} R={44} style={{ position: 'absolute', right: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            {pad(move, 62)}
            {pad(look, AREA_W - 62)}
            <TouchBtn testID="it-jump" onDown={() => { if (jump(g.current.p, 8)) hx.tap(); }} style={{ position: 'absolute', left: AREA_W / 2 - 32, bottom: 26, width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: C.cyan, backgroundColor: alpha(C.cyan, 0.2), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11 }}>SALTAR</Text>
            </TouchBtn>
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? (res.won ? '🏆' : '🏝️') : '🏝️'}
          title={phase === 'over' ? (res.won ? '¡TODOS LOS TESOROS!' : 'FIN DE LA EXPEDICIÓN') : 'ISLA DEL TESORO'}
          subtitle={phase === 'ready' ? 'Explora una isla 3D y encuentra los cofres' : `💰 ${s.got}/${IT_CHESTS} cofres`}
          score={sc} best={best} isNew={res.isNew} accent={C.amber} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Joystick izquierdo: caminar · derecho: girar la cámara', 'La brújula apunta al cofre más cercano', `Encuentra ${IT_CHESTS} cofres en ${IT_TIME} s`, '🦀 Cuidado con los cangrejos de la playa'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
