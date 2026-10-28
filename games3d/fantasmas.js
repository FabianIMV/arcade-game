import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, Bar, C, GameScreen, Overlay, PlayArea, TouchBtn, TouchStick, alpha, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { compassAngle, eyeCam, near, project, seeded, stepPlayer } from '../utils/openworld';

// CAZAFANTASMAS – pueblo de noche en primera persona. Joystick izquierdo: caminar · derecho: mirar.
// Mantén ASPIRAR con un fantasma en el centro de la pantalla 1,5 s para atraparlo.
// Algunos fantasmas te asustan si te tocan y te restan cordura.
const CZ_GHOSTS = 10, CZ_TIME = 150, CZ_HOLD = 1.5, CZ_BOUND = 38, CZ_CATCH_PX = 52, CZ_HOUSES = 8;
const CZ_CEM = { x: -24, z: -22 };
const CZ_WALLS = ['#5b4a3c', '#4d4f5e', '#6a5548', '#43505a'];
const CZ_LAMPS = [
  { x: -8, z: 2.4 }, { x: 8, z: -2.4 }, { x: -16, z: -2.4 }, { x: 16, z: 2.4 }, { x: 2.4, z: 10 },
  { x: -2.4, z: -10 }, { x: 2.4, z: -24 }, { x: -2.4, z: 24 }, { x: -30, z: 2.4 }, { x: 30, z: -2.4 },
];

// ¿(x, z) dentro de una casa o la iglesia? (margen para el cuerpo del jugador)
const inHouse = (houses, x, z) => houses.some(h => Math.abs(x - h.x) < h.w / 2 + 0.35 && Math.abs(z - h.z) < h.d / 2 + 0.35);

const makeVillage = r => {
  const houses = [{ x: 13, z: -13, w: 5, d: 4.5, h: 3, c: '#7a7068', church: true }];
  for (let tries = 0; houses.length < CZ_HOUSES + 1 && tries < 400; tries++) {
    const x = (r() - 0.5) * 60, z = (r() - 0.5) * 60;
    if (Math.abs(x) < 5 || Math.abs(z) < 5) continue;
    if (Math.abs(x - CZ_CEM.x) < 8 && Math.abs(z - CZ_CEM.z) < 8) continue;
    if (houses.some(h => Math.hypot(h.x - x, h.z - z) < 8)) continue;
    const w = 3.6 + r() * 1.6, d = 3 + r() * 1.5, h = 2.6 + r() * 0.8;
    houses.push({ x, z, w, d, h, c: CZ_WALLS[Math.floor(r() * CZ_WALLS.length)], lit: r() < 0.5, church: false });
  }
  const stones = [];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 6; col++) {
    stones.push({ id: `st${row}_${col}`, x: CZ_CEM.x + (col - 2.5) * 2.2 + (r() - 0.5) * 0.4, z: CZ_CEM.z + (row - 2) * 2.4 + (r() - 0.5) * 0.4 });
  }
  const trees = [];
  for (let i = 0; i < 16; i++) {
    const x = (r() - 0.5) * 70, z = (r() - 0.5) * 70;
    if (Math.abs(x) < 4 || Math.abs(z) < 4) continue;
    trees.push({ id: `dt${i}`, x, z, h: 3.2 + r() * 1.6 });
  }
  return { houses, stones, trees };
};

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const { houses, stones, trees } = makeVillage(r);
  const ghosts = Array.from({ length: CZ_GHOSTS }, (_, i) => {
    let x = 0, z = 0;
    for (let k = 0; k < 200; k++) { x = (r() - 0.5) * 66; z = (r() - 0.5) * 66; if (Math.hypot(x, z) > 9 && !inHouse(houses, x, z)) break; }
    return { id: `g${i}`, x, y: 1.5, z, hx: x, hz: z, tx: x, tz: z, tm: 0, ph: r() * 6.28, bad: i % 5 < 2, caught: false };
  });
  return { houses, stones, trees, ghosts, p: { x: 0, y: 0, z: 0, vy: 0, face: 0 }, yaw: 0, pitch: 0, time: CZ_TIME, caught: 0, sanity: 100, calm: 0, inv: 0, t: 0, hold: 0, aimId: null, lastAim: null, toast: null, final: null };
};

export function Cazafantasmas3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('fantasmas');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, won: false });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const asp = useRef({ on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); asp.on = false; g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = (s, won) => {
    s.final = s.caught * 100 + (won ? Math.ceil(s.time) * 5 : 0);
    if (won) hx.win(); else hx.die();
    setRes({ isNew: submitBest(s.final), won }); setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p;
    s.t += dt; s.time -= dt; s.inv = Math.max(0, s.inv - dt); s.calm += dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.time <= 0) { s.time = 0; finish(s, false); return; }

    // mirar y caminar
    s.yaw -= look.x * 2.4 * dt;
    s.pitch = Math.max(-1.2, Math.min(1.2, s.pitch - look.y * 1.5 * dt));
    const ox = p.x, oz = p.z;
    stepPlayer(p, move, dt, { yaw: s.yaw, speed: 4.6, bounds: CZ_BOUND, floor: () => 0 });
    if (inHouse(s.houses, p.x, p.z)) {
      if (!inHouse(s.houses, p.x, oz)) p.z = oz;
      else if (!inHouse(s.houses, ox, p.z)) p.x = ox;
      else { p.x = ox; p.z = oz; }
    }

    // fantasmas: deambulan por el pueblo; los que asustan persiguen al jugador de cerca
    for (const gh of s.ghosts) {
      if (gh.caught) continue;
      gh.tm -= dt; gh.ph += dt;
      const dP = Math.hypot(gh.x - p.x, gh.z - p.z);
      let tx = gh.tx, tz = gh.tz, sp = 0.9;
      if (gh.bad && dP < 14) { tx = p.x; tz = p.z; sp = 1.5; }
      else if (gh.tm <= 0) {
        gh.tm = 3 + Math.random() * 3;
        const a = Math.random() * 6.28, rr = Math.random() * 9;
        gh.tx = gh.hx + Math.cos(a) * rr; gh.tz = gh.hz + Math.sin(a) * rr; tx = gh.tx; tz = gh.tz;
      }
      const dx = tx - gh.x, dz = tz - gh.z, dl = Math.hypot(dx, dz);
      if (dl > 0.2) { const m = Math.min(sp * dt, dl); gh.x += (dx / dl) * m; gh.z += (dz / dl) * m; }
      gh.x = Math.max(-CZ_BOUND, Math.min(CZ_BOUND, gh.x)); gh.z = Math.max(-CZ_BOUND, Math.min(CZ_BOUND, gh.z));
      gh.y = 1.5 + Math.sin(gh.ph * 1.6) * 0.25;
      if (gh.bad && s.inv <= 0 && dP < 1.1) {
        s.sanity -= 18; s.inv = 2; s.calm = 0; hx.bad(); fx.shake(10, 0.35); fx.flash(C.violet, 0.3);
        s.toast = { m: '👻 ¡Te asustó!', t: 1.4 };
        if (s.sanity <= 0) { s.sanity = 0; finish(s, false); return; }
      }
    }
    if (s.calm > 5) s.sanity = Math.min(100, s.sanity + 3 * dt);

    // mira: el fantasma más centrado en pantalla (proyección 3D) con la mano en ASPIRAR
    const cam = eyeCam(p, s.yaw, s.pitch, { eye: 1.6, fov: 68 });
    let aim = null, ad = 1e9;
    for (const gh of s.ghosts) {
      if (gh.caught || Math.hypot(gh.x - p.x, gh.z - p.z) > 13) continue;
      const sp = project(cam, [gh.x, gh.y, gh.z], AREA_W, AREA_H);
      if (!sp || sp.z > 14) continue;
      const k = Math.hypot(sp.x - AREA_W / 2, sp.y - AREA_H / 2);
      if (k < CZ_CATCH_PX && k < ad) { ad = k; aim = gh; }
    }
    s.aimId = aim ? aim.id : null;
    if (aim && asp.on) {
      if (s.lastAim !== aim.id) s.hold = 0;
      s.lastAim = aim.id; s.hold += dt;
      if (s.hold >= CZ_HOLD) {
        aim.caught = true; s.caught += 1; s.hold = 0; s.lastAim = null; s.aimId = null;
        hx.good(); fx.flash(C.cyan, 0.2); fx.burst(AREA_W / 2, AREA_H / 2, C.cyan, 22, 220);
        fx.pop(AREA_W / 2, AREA_H / 2 - 60, '+1 👻', C.cyan, 20);
        s.toast = { m: `👻 Atrapado ${s.caught}/${CZ_GHOSTS}`, t: 1.6 };
        if (s.caught >= CZ_GHOSTS) { finish(s, true); return; }
      }
    } else { s.hold = 0; s.lastAim = null; }
  });

  const s = g.current; const p = s.p;
  const cam = eyeCam(p, s.yaw, s.pitch, { eye: 1.6, fov: 68 });
  const left = s.ghosts.filter(gh => !gh.caught);
  let target = null, td = 1e9; left.forEach(gh => { const d = Math.hypot(gh.x - p.x, gh.z - p.z); if (d < td) { td = d; target = gh; } });
  const ang = target ? compassAngle(p, s.yaw, target) : 0;
  // linterna en la mano (ligada a la mirada)
  const cp = Math.cos(s.pitch), sp2 = Math.sin(s.pitch);
  const fwd = [-Math.sin(s.yaw) * cp, sp2, -Math.cos(s.yaw) * cp], rgt = [Math.cos(s.yaw), 0, -Math.sin(s.yaw)];
  const lp = [cam.p[0] + fwd[0] * 1.1 + rgt[0] * 0.4, cam.p[1] + fwd[1] * 1.1 - 0.45, cam.p[2] + fwd[2] * 1.1 + rgt[2] * 0.4];
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, 0], s: [120, 120, 1], c: '#141b28' },
    { id: 'rd1', k: 'box', p: [0, 0.02, 0], s: [CZ_BOUND * 2.4, 0.04, 3.2], c: '#2f2b33' },
    { id: 'rd2', k: 'box', p: [0, 0.02, 0], s: [3.2, 0.04, CZ_BOUND * 2.4], c: '#2f2b33' },
    ...near(s.houses, p, 34).flatMap(h => {
      const i = s.houses.indexOf(h);
      const out = [
        { id: `h${i}`, k: 'box', p: [h.x, h.h / 2, h.z], s: [h.w, h.h, h.d], c: h.c },
        { id: `h${i}r`, k: 'box', p: [h.x, h.h + 0.2, h.z], s: [h.w + 0.6, 0.4, h.d + 0.6], c: '#2a1f22' },
        { id: `h${i}w`, k: 'box', p: [h.x - h.w / 4, 1.5, h.z + h.d / 2 + 0.03], s: [0.8, 0.9, 0.06], c: h.lit ? '#ffd27a' : '#1b2030', e: h.lit ? 0.5 : 0 },
        { id: `h${i}v`, k: 'box', p: [h.x + h.w / 4, 1.5, h.z + h.d / 2 + 0.03], s: [0.8, 0.9, 0.06], c: h.lit ? '#ffd27a' : '#1b2030', e: h.lit ? 0.5 : 0 },
      ];
      if (h.church) out.push(
        { id: `h${i}t`, k: 'cyl', p: [h.x, h.h + 2.6, h.z], s: [1.8, 5.2, 1.8], c: '#8d8a9a' },
        { id: `h${i}s`, k: 'cone', p: [h.x, h.h + 6.3, h.z], s: [2.3, 2.4, 2.3], c: '#3a3446' },
      );
      return out;
    }),
    ...near(s.stones, p, 30).flatMap(st => [
      { id: st.id, k: 'box', p: [st.x, 0.45, st.z], s: [0.7, 0.9, 0.16], c: '#8a8f9a' },
    ]),
    ...near(s.trees, p, 30).flatMap(t => [
      { id: `${t.id}a`, k: 'cyl', p: [t.x, t.h / 2, t.z], s: [0.3, t.h, 0.3], c: '#2e2620' },
      { id: `${t.id}b`, k: 'box', p: [t.x, t.h * 0.8, t.z], s: [1.4, 0.15, 0.15], r: [0, 0.6, 0.3], c: '#2e2620' },
    ]),
    ...[...CZ_LAMPS.map((l, i) => ({ ...l, id: `fa${i}` }))].filter(l => Math.hypot(l.x - p.x, l.z - p.z) < 26).flatMap(l => [
      { id: `${l.id}p`, k: 'cyl', p: [l.x, 1.6, l.z], s: [0.14, 3.2, 0.14], c: '#2a2a33' },
      { id: `${l.id}l`, k: 'sph', p: [l.x, 3.3, l.z], n: 0.36, c: '#ffd27a', e: 0.5 },
      { id: `${l.id}h`, k: 'sph', p: [l.x, 3.3, l.z], n: 1.6, c: '#ffb347', o: 0.12 },
    ]),
    ...left.flatMap(gh => {
      const d = Math.hypot(gh.x - p.x, gh.z - p.z);
      if (d > 24) return [];
      const v = Math.max(0, Math.min(1, (16 - d) / 10));   // de cerca se ven; de lejos se difuminan
      return [
        { id: gh.id, k: 'sph', p: [gh.x, gh.y, gh.z], n: 0.9, c: '#ffffff', o: 0.6 * v },
        { id: `${gh.id}h`, k: 'sph', p: [gh.x, gh.y, gh.z], n: 1.7, c: '#9fe3ff', o: 0.12 * v },
      ];
    }),
    { id: 'linterna', k: 'sph', p: lp, n: 0.07, c: '#fff1c2', e: 0.5 },
  ];
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const scene = { bg: '#04050c', fog: { c: '#06070f', near: 5, far: 30 }, shake, objs, cam };
  const sc = s.final != null ? s.final : s.caught * 100;
  const aimV = s.aimId != null ? s.hold / CZ_HOLD : 0;
  const pad = (v, cx) => (
    <View pointerEvents="none" style={{ position: 'absolute', left: cx - 50, bottom: 14, width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
      <View style={{ position: 'absolute', left: 34 + v.x * 32, top: 34 + v.y * 32, width: 32, height: 32, borderRadius: 16, backgroundColor: v.on ? alpha(C.violet, 0.7) : 'rgba(255,255,255,0.35)' }} />
    </View>
  );
  return (
    <GameScreen title="CAZAFANTASMAS" emoji="👻" accent={C.violet} onExit={onExit} score={sc} best={best}
      hud={<><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>👻 {s.caught}/{CZ_GHOSTS}</Text><View style={{ width: 80, flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: C.text, fontSize: 11, marginRight: 4 }}>🧠</Text><Bar value={s.sanity} max={100} color={s.sanity < 30 ? C.red : C.violet} h={8} w={64} /></View><Text style={{ color: s.time < 20 ? C.red : C.violet, fontWeight: '900', fontSize: 12 }}>⏱ {Math.ceil(s.time)}s</Text></>}>
      <PlayArea fx={fx} bg="#04050c">
        <World3D scene={scene} />
        {/* retícula: se llena mientras aspiras al fantasma centrado */}
        {phase === 'play' && (
          <View pointerEvents="none" style={{ position: 'absolute', left: AREA_W / 2 - 26, top: AREA_H / 2 - 26, width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: s.aimId != null ? C.amber : 'rgba(255,255,255,0.55)' }} />
        )}
        {phase === 'play' && s.aimId != null && (
          <View pointerEvents="none" style={{ position: 'absolute', left: AREA_W / 2 - 26, top: AREA_H / 2 + 34 }}>
            <Bar value={aimV} max={1} color={C.amber} h={6} w={52} />
          </View>
        )}
        {phase === 'play' && target && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: C.violet, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Fantasma a {Math.round(td)} m</Text>
            </View>
          </View>
        )}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.25, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
        {phase === 'play' && (
          <>
            <TouchStick testID="cz-move" v={move} R={44} style={{ position: 'absolute', left: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            <TouchStick testID="cz-look" v={look} R={44} style={{ position: 'absolute', right: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            {pad(move, 62)}
            {pad(look, AREA_W - 62)}
            <TouchBtn testID="cz-aspirar" onDown={() => { asp.on = true; }} onUp={() => { asp.on = false; }} style={{ position: 'absolute', left: AREA_W / 2 - 40, bottom: 26, width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: C.violet, backgroundColor: alpha(C.violet, 0.22), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11 }}>ASPIRAR</Text>
            </TouchBtn>
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji={phase === 'over' ? (res.won ? '🏆' : '👻') : '👻'}
          title={phase === 'over' ? (res.won ? '¡PUEBLO LIMPIO!' : 'TE HAN ATRAPADO LA NOCHE') : 'CAZAFANTASMAS'}
          subtitle={phase === 'ready' ? 'Recorre el pueblo de noche y atrapa a los fantasmas' : `👻 ${s.caught}/${CZ_GHOSTS} fantasmas`}
          score={sc} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Joystick izquierdo: caminar · derecho: mirar', 'Mantén ASPIRAR 1,5 s con un fantasma en el centro', 'Algunos fantasmas te asustan si te tocan: cuidado con la cordura', `Atrapa ${CZ_GHOSTS} fantasmas en ${CZ_TIME} s`] : null} />
      </PlayArea>
    </GameScreen>
  );
}
