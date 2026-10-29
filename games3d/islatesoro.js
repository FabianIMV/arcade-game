import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, Lives, SCREEN_H, SCREEN_W, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { animal, bush, chest, coin, flower, hash01, house, person, rock, shade, tree } from '../utils/prefabs';
import { compassAngle, followCam, jump, makeHeightmap, seeded, stepPlayer } from '../utils/openworld';

// ISLA DEL TESORO – mundo abierto en tercera persona, JUEGO DE REFERENCIA del motor 3D v2.
// Joystick izquierdo: caminar · derecho: girar la cámara · SALTAR. Encuentra los 8 cofres antes de que acabe el tiempo;
// los cangrejos de la playa quitan vidas.
//
// Qué enseña este archivo:
//  · terreno low-poly + agua con olas + cielo con nubes (scene.terrain / water / sky)
//  · decorado ESTÁTICO calculado una vez (scene.statics) con instancing (inst:'…'): palmeras, arbustos, rocas, flores, hierba
//  · prefabs animados (person, animal('crab'), chest, coin) y partículas 3D (burst3d / ring3d)
//  · Game3D: pantalla de inicio/fin con cámara orbital, HUD, controles multitáctil (Stick3D, ActionBtn)
const IT_SIZE = 64, IT_CHESTS = 8, IT_TIME = 150, IT_PALMS = 46, IT_CRABS = 6;
const SEA = '#bfe6ff';

const terrainColor = (y, x, z) => {
  const v = 0.94 + hash01(x.toFixed(1) + ',' + z.toFixed(1)) * 0.12;   // variación por triángulo
  const c = y < -0.2 ? '#b8ab7c' : y < 0.35 ? '#ecda9c' : y < 1.7 ? '#66b44e' : y < 2.5 ? '#58a244' : y < 3.0 ? '#7f9a55' : '#9a9486';
  return shade(c, v);
};

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const hm = makeHeightmap(seed, IT_SIZE, { amp: 3.4, island: true });
  const land = (minY, maxY, minR = 6) => { for (let k = 0; k < 400; k++) { const x = (r() - 0.5) * IT_SIZE * 0.86, z = (r() - 0.5) * IT_SIZE * 0.86; const y = hm.h(x, z); if (y > minY && y < maxY && Math.hypot(x - sp.x, z - sp.z) > minR) return { x, z, y }; } return { x: 4, z: 4, y: hm.h(4, 4) }; };
  let sp = { x: 0, z: 0, y: hm.h(0, 0) }, sd = 1e9;   // salida: terreno de hierba lo más cerca posible del centro
  for (let k = 0; k < 300; k++) { const x = (r() - 0.5) * 30, z = (r() - 0.5) * 30, y = hm.h(x, z), d = Math.hypot(x, z); if (y > 0.9 && y < 2.1 && d < sd) { sd = d; sp = { x, z, y }; } }
  const chests = Array.from({ length: IT_CHESTS }, (_, i) => ({ id: `c${i}`, ...land(0.4, 9), got: false, tGot: 0, yaw: r() * 6.28 }));
  const crabs = Array.from({ length: IT_CRABS }, (_, i) => ({ id: `k${i}`, ...land(0.05, 0.6, 3), a: r() * 6.28, tm: 1 }));

  // decorado estático: se calcula UNA vez y se pasa en scene.statics (sus instancias no se reescriben cada frame)
  const st = [];
  for (let i = 0; i < IT_PALMS; i++) { const q = land(0.2, 2.2, 3); st.push(...tree(`p${i}`, [q.x, q.y, q.z], { kind: 'palm', h: 0.8 + r() * 0.5, inst: 'palma' })); }
  for (let i = 0; i < 30; i++) { const q = land(0.8, 2.8, 3); st.push(...bush(`b${i}`, [q.x, q.y, q.z], { inst: 'arbusto', c: r() < 0.5 ? '#3f9b45' : '#2f8a4a' })); }
  for (let i = 0; i < 22; i++) { const q = land(-0.4, 4, 4); st.push(...rock(`r${i}`, [q.x, q.y, q.z], { inst: 'roca', c: r() < 0.5 ? '#8c8f99' : '#a09a8c' })); }
  const petals = ['#ff6fa8', '#ffd54a', '#ffffff', '#b57bff', '#ff8a3d'];
  for (let i = 0; i < 70; i++) { const q = land(0.7, 2.4, 3); st.push(...flower(`f${i}`, [q.x, q.y, q.z], { inst: 'flor', c: petals[i % petals.length] })); }
  for (let i = 0; i < 70; i++) { const q = land(0.6, 2.6, 2); for (let j = 0; j < 4; j++) st.push({ id: `g${i}_${j}`, k: 'cone', p: [q.x + (r() - 0.5) * 0.35, q.y + 0.15, q.z + (r() - 0.5) * 0.35], s: [0.1, 0.38, 0.1], r: [(r() - 0.5) * 0.7, 0, (r() - 0.5) * 0.7], c: shade('#4fae48', 0.85 + r() * 0.35), inst: 'hierba' }); }
  for (let i = 0; i < 2; i++) { const q = land(0.7, 1.5, 9); st.push(...house(`h${i}`, [q.x, q.y, q.z], { kind: 'hut', yaw: r() * 6.28, lit: false })); }

  return {
    hm, chests, crabs, statics: st, terrain: { id: `isla${seed}`, h: hm.h, size: IT_SIZE, step: 1, color: terrainColor },
    p: { x: sp.x, y: sp.y, z: sp.z, vy: 0, face: 0 }, yaw: 0, time: IT_TIME, got: 0, lives: 3, inv: 0, t: 0, walk: 0, toast: null, final: null, fxT: 0, stepT: 0, wasGround: true,
  };
};

// Escena completa en un instante t (se usa para jugar y para el fondo animado de los menús)
function buildScene(s, t) {
  const p = s.p;
  const blink = s.inv > 0 && Math.floor(s.t * 12) % 2 === 0;
  const objs = [];
  for (const c of s.chests) {
    const age = s.t - c.tGot;
    if (c.got && age > 1.7) continue;
    objs.push(...chest(c.id, [c.x, c.y, c.z], { yaw: c.yaw, open: c.got ? Math.min(1, age / 0.45) : 0 }));
    if (!c.got) objs.push({ id: `${c.id}beam`, k: 'cyl', p: [c.x, c.y + 8, c.z], s: [0.45, 16, 0.45], c: '#ffd54a', e: 1, o: 0.2 + Math.sin(t * 3 + c.x) * 0.05 });
    else for (let i = 0; i < 6; i++) {   // monedas que saltan del cofre
      const a = i * 1.047 + c.x, u = age * 0.9; if (u > 1.4) continue;
      objs.push(...coin(`${c.id}k${i}`, [c.x + Math.cos(a) * 2.4 * u, c.y + 0.8 + 5.2 * u - 6.5 * u * u, c.z + Math.sin(a) * 2.4 * u], { t: t + i }));
    }
  }
  for (const k of s.crabs) objs.push(...animal(k.id, 'crab', [k.x, k.y, k.z], { yaw: Math.atan2(-Math.cos(k.a), -Math.sin(k.a)), t, walk: 1 }));
  objs.push(...person('yo', [p.x, p.y, p.z], { yaw: p.face, t, walk: s.walk, hat: 'straw', shirt: '#2f6fd8', flash: blink }));
  return {
    sky: { top: '#2f86e6', bottom: SEA, clouds: 9 }, fog: { c: SEA, near: 38, far: 92 },
    light: { dir: [-0.5, 0.75, 0.45] }, shadowR: 22,
    terrain: s.terrain, water: { y: 0, c: '#2aa0e0', o: 0.84, amp: 0.1 },
    statics: s.statics, objs, cam: followCam(p, s.yaw, { hm: s.hm, dist: 7.5, height: 4 }),
  };
}

export function IslaTesoro3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('islatesoro');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
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
    const moved = stepPlayer(s.p, move, dt, { yaw: s.yaw, hm: s.hm, speed: 6.5, bounds: IT_SIZE / 2 - 3 });
    if (s.p.y < 0.05) s.p.y = 0.05;   // vadear la orilla
    const p = s.p;
    s.walk += ((moved / Math.max(dt, 1e-3) > 1 ? 1 : 0) - s.walk) * Math.min(1, dt * 10);
    // polvo / salpicaduras al caminar y aterrizar
    s.stepT -= dt;
    if (moved > 0.02 && p.ground && s.stepT <= 0) {
      s.stepT = 0.2;
      if (p.y < 0.3) burst3d([p.x, p.y + 0.05, p.z], '#d8f2ff', 5, { speed: 2.2, up: 2.2, g: 10, size: 0.12, life: 0.55 });
      else burst3d([p.x, p.y + 0.05, p.z], p.y < 0.6 ? '#ecda9c' : '#9ccf7a', 2, { speed: 1.2, up: 0.8, g: 5, size: 0.14, life: 0.5 });
    }
    if (p.ground && !s.wasGround) ring3d([p.x, p.y + 0.1, p.z], p.y < 0.3 ? '#d8f2ff' : '#e9e2c4', 10, { speed: 2.5, life: 0.4, size: 0.12 });
    s.wasGround = p.ground;
    // destellos dorados sobre un cofre cercano
    s.fxT -= dt;
    if (s.fxT <= 0) { s.fxT = 0.12; const c = s.chests[Math.floor(Math.random() * s.chests.length)]; if (!c.got && Math.hypot(c.x - p.x, c.z - p.z) < 26) burst3d([c.x + (Math.random() - 0.5), c.y + 0.9, c.z + (Math.random() - 0.5)], '#ffe9a0', 1, { speed: 0.6, up: 1.2, g: -0.5, size: 0.13, life: 1.2 }); }
    for (const c of s.chests) {
      if (c.got) continue;
      if (Math.hypot(c.x - p.x, c.z - p.z) < 1.6) {
        c.got = true; c.tGot = s.t; s.got += 1; hx.good(); fx.flash(C.amber, 0.22);
        burst3d([c.x, c.y + 0.9, c.z], ['#ffd54a', '#fff3b0', '#ffb300'], 38, { speed: 6.5, up: 4.5, g: 12, size: 0.2, life: 1.1 });
        ring3d([c.x, c.y + 0.3, c.z], '#ffd54a', 22, { speed: 5, life: 0.6 });
        fx.pop(SCREEN_W / 2, SCREEN_H * 0.4, '+100', C.amber, 28);
        s.toast = { m: `💰 Cofre ${s.got}/${IT_CHESTS}`, t: 1.6 };
        if (s.got >= IT_CHESTS) { finish(s, true); return; }
      }
    }
    for (const k of s.crabs) {
      k.tm -= dt; if (k.tm <= 0) { k.a += (Math.random() - 0.5) * 3; k.tm = 1 + Math.random() * 2; }
      const nx = k.x + Math.cos(k.a) * 1.4 * dt, nz = k.z + Math.sin(k.a) * 1.4 * dt;
      const y = s.hm.h(nx, nz); if (y > 0 && y < 0.9) { k.x = nx; k.z = nz; } else k.a += Math.PI;
      k.y = s.hm.h(k.x, k.z);
      if (s.inv <= 0 && Math.hypot(k.x - p.x, k.z - p.z) < 1) {
        s.lives -= 1; s.inv = 1.5; hx.bad(); fx.shake(8, 0.3); fx.flash(C.red, 0.3);
        burst3d([p.x, p.y + 1, p.z], ['#ff4d4d', '#ffb0a0'], 18, { speed: 5, up: 2, size: 0.17, life: 0.7 });
        s.toast = { m: '🦀 ¡Pinza!', t: 1.2 };
        if (s.lives <= 0) { finish(s, false); return; }
      }
    }
  });

  const s = g.current; const p = s.p;
  const left = s.chests.filter(c => !c.got);
  let target = null, td = 1e9; left.forEach(c => { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < td) { td = d; target = c; } });
  const ang = target ? compassAngle(p, s.yaw, target) : 0;
  const tNow = phase === 'play' ? s.t : 0;
  const scene = buildScene(s, tNow);
  const sc = s.final != null ? s.final : s.got * 100;
  return (
    <Game3D title="ISLA DEL TESORO" emoji="🏝️" accent={C.amber} onExit={onExit} score={sc} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(s, t)} orbit={{ r: 12, h: 5.2, speed: 0.2, ly: 1.3 }}
      hud={<><Lives n={s.lives} max={3} /><HudPill icon="💰" value={`${s.got}/${IT_CHESTS}`} color={C.amber} /><HudPill icon="⏱" value={`${Math.ceil(s.time)}s`} color={s.time < 20 ? C.red : C.cyan} /></>}
      subtitle="Explora una isla 3D y encuentra los cofres del tesoro"
      lines={['Joystick izquierdo: caminar · derecho: girar la cámara', 'La brújula apunta al cofre más cercano', `Encuentra ${IT_CHESTS} cofres en ${IT_TIME} s`, '🦀 Cuidado con los cangrejos de la playa']}
      result={{ won: res.won, isNew: res.isNew, title: res.won ? '¡TODOS LOS TESOROS!' : 'FIN DE LA EXPEDICIÓN', emoji: res.won ? '🏆' : '🏝️', subtitle: res.won ? 'Eres el pirata más rico de la isla' : 'La isla guarda aún sus secretos', stats: [['COFRES', `${s.got}/${IT_CHESTS}`], ['VIDAS', String(s.lives)], ['TIEMPO', `${Math.ceil(s.time)}s`]] }}>
      {target && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 4, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: C.amber, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Cofre a {Math.round(td)} m</Text>
          </View>
        </View>
      )}
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '20%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 24, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      <Stick3D testID="it-move" v={move} side="left" color={C.cyan} />
      <Stick3D testID="it-look" v={look} side="right" color={C.amber} />
      <ActionBtn testID="it-jump" label="SALTAR" color={C.cyan} onDown={() => { if (jump(g.current.p, 8)) hx.tap(); }} style={{ left: '50%', marginLeft: -33, bottom: 34 }} />
    </Game3D>
  );
}
