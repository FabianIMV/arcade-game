import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Bar, C, SCREEN_H, SCREEN_W, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { enemy, hash01, house, shade, tree } from '../utils/prefabs';
import { compassAngle, eyeCam, project, seeded, stepPlayer } from '../utils/openworld';

// CAZAFANTASMAS – pueblo de noche en primera persona. Joystick izquierdo: caminar · derecho: mirar.
// Mantén ASPIRAR con un fantasma en el centro de la pantalla 1,5 s para atraparlo.
// Los fantasmas rojizos te persiguen si te acercas y te quitan cordura: cuidado.
//
// Qué enseña este archivo:
//  · first person con cielo nocturno, niebla y luz de luna (sky.sunC + light)
//  · scene.lights: linterna en la mano + las 3 farolas más cercanas (máx. 4 luces)
//  · scene.statics: casas, lápidas con instancing, árboles secos y farolas, precalculados
//  · enemy('fantasma') con opacidad según la distancia, y partículas al atrapar

const CZ_GHOSTS = 10, CZ_TIME = 150, CZ_HOLD = 1.5, CZ_BOUND = 38, CZ_CATCH_PX = 52, CZ_HOUSES = 8;
const CZ_CEM = { x: -24, z: -22 };
const CZ_WALLS = ['#5b4a3c', '#4d4f5e', '#6a5548', '#43505a'];
const CZ_ROOFS = ['#7a2f2a', '#2f3f5e', '#4a3328'];
const CZ_SKY = '#0a0f2e';
const CZ_LAMPS = [
  { x: -8, z: 2.4 }, { x: 8, z: -2.4 }, { x: -16, z: -2.4 }, { x: 16, z: 2.4 }, { x: 2.4, z: 10 },
  { x: -2.4, z: -10 }, { x: 2.4, z: -24 }, { x: -2.4, z: 24 }, { x: -30, z: 2.4 }, { x: 30, z: -2.4 },
];

// ¿(x, z) dentro de una casa o la iglesia? (margen para el cuerpo del jugador)
const inHouse = (houses, x, z) => houses.some(h => Math.abs(x - h.x) < h.w / 2 + 0.35 && Math.abs(z - h.z) < h.d / 2 + 0.35);

const makeVillage = r => {
  const houses = [{ x: 13, z: -13, w: 3.8, d: 3.8, yaw: 0, church: true, lit: true, c: '#7a7068' }];
  for (let tries = 0; houses.length < CZ_HOUSES + 1 && tries < 400; tries++) {
    const x = (r() - 0.5) * 60, z = (r() - 0.5) * 60;
    if (Math.abs(x) < 5 || Math.abs(z) < 5) continue;
    if (Math.abs(x - CZ_CEM.x) < 8 && Math.abs(z - CZ_CEM.z) < 8) continue;
    if (houses.some(h => Math.hypot(h.x - x, h.z - z) < 8)) continue;
    houses.push({ x, z, w: 4.6, d: 4.2, yaw: r() < 0.5 ? 0 : Math.PI, church: false, lit: r() < 0.5, c: CZ_WALLS[Math.floor(r() * CZ_WALLS.length)] });
  }
  const stones = [];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 6; col++) {
    stones.push({ id: `st${row}_${col}`, x: CZ_CEM.x + (col - 2.5) * 2.2 + (r() - 0.5) * 0.4, z: CZ_CEM.z + (row - 2) * 2.4 + (r() - 0.5) * 0.4 });
  }
  const trees = [];
  for (let i = 0; i < 16; i++) {
    const x = (r() - 0.5) * 70, z = (r() - 0.5) * 70;
    if (Math.abs(x) < 4 || Math.abs(z) < 4) continue;
    trees.push({ id: `dt${i}`, x, z, h: 1.3 + r() * 0.5 });
  }
  return { houses, stones, trees };
};

// Todo lo que no se mueve, precalculado una vez (scene.statics)
const villageStatics = ({ houses, stones, trees }) => [
  ...houses.flatMap((h, i) => (h.church
    ? house(`hc${i}`, [h.x, 0, h.z], { kind: 'tower', c: h.c, lit: true, yaw: h.yaw })
    : house(`h${i}`, [h.x, 0, h.z], { kind: 'cottage', c: h.c, roof: CZ_ROOFS[i % CZ_ROOFS.length], lit: h.lit, yaw: h.yaw }))),
  ...stones.map(st => ({ id: st.id, k: 'box', p: [st.x, 0.45, st.z], s: [0.7, 0.9, 0.16], c: '#8a8f9a', inst: 'tumba', sh: true })),
  ...trees.flatMap(t => tree(t.id, [t.x, 0, t.z], { kind: 'dead', h: t.h })),
  ...CZ_LAMPS.flatMap((l, i) => [
    { id: `fa${i}p`, k: 'cyl', p: [l.x, 1.6, l.z], s: [0.14, 3.2, 0.14], c: '#2a2a33', sh: true },
    { id: `fa${i}l`, k: 'sph', p: [l.x, 3.3, l.z], n: 0.36, c: '#ffd27a', e: 1 },
    { id: `fa${i}h`, k: 'sph', p: [l.x, 3.3, l.z], n: 1.6, c: '#ffb347', o: 0.12 },
  ]),
  // cruz de caminos de tierra
  { id: 'rd1', k: 'box', p: [0, 0.02, 0], s: [CZ_BOUND * 2.4, 0.04, 3.2], c: '#2f2b33', recv: true },
  { id: 'rd2', k: 'box', p: [0, 0.02, 0], s: [3.2, 0.04, CZ_BOUND * 2.4], c: '#2f2b33', recv: true },
];

const groundColor = (y, x, z) => shade('#2b3a2c', 0.82 + hash01(x.toFixed(1) + ',' + z.toFixed(1)) * 0.3);

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9); const r = seeded(seed);
  const village = makeVillage(r);
  const ghosts = Array.from({ length: CZ_GHOSTS }, (_, i) => {
    let x = 0, z = 0;
    for (let k = 0; k < 200; k++) { x = (r() - 0.5) * 66; z = (r() - 0.5) * 66; if (Math.hypot(x, z) > 9 && !inHouse(village.houses, x, z)) break; }
    return { id: `g${i}`, x, z, hx0: x, hz0: z, tx: x, tz: z, tm: 0, ph: r() * 6.28, bad: i % 5 < 2, caught: false, face: 0, hitT: 0 };
  });
  return {
    houses: village.houses, ghosts,
    terrain: { id: `pueblo${seed}`, h: () => 0, size: 110, step: 2.75, color: groundColor },
    statics: villageStatics(village),
    p: { x: 0, y: 0, z: 0, vy: 0, face: 0 }, yaw: 0, pitch: 0, bobT: 0, walk: 0,
    time: CZ_TIME, caught: 0, sanity: 100, calm: 0, inv: 0, t: 0, hold: 0, aimId: null, lastAim: null,
    vw: SCREEN_W, vh: SCREEN_H - 150, toast: null, final: null,
  };
};

// Escena en primera persona (juega y sirve de fondo animado en inicio/fin)
function buildScene(s, t) {
  const p = s.p;
  const bobY = Math.sin(s.bobT) * 0.035 * s.walk;
  const cam = eyeCam(p, s.yaw, s.pitch, { eye: 1.6 + bobY, fov: 68 });
  // linterna en la mano (ligada a la mirada)
  const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
  const fwd = [-Math.sin(s.yaw) * cp, sp, -Math.cos(s.yaw) * cp], rgt = [Math.cos(s.yaw), 0, -Math.sin(s.yaw)];
  const lp = [cam.p[0] + fwd[0] * 1.1 + rgt[0] * 0.4, cam.p[1] + fwd[1] * 1.1 - 0.45, cam.p[2] + fwd[2] * 1.1 + rgt[2] * 0.4];
  const objs = [];
  for (const gh of s.ghosts) {
    if (gh.caught) continue;
    const d = Math.hypot(gh.x - p.x, gh.z - p.z);
    if (d > 24) continue;
    const v = Math.max(0, Math.min(1, (16 - d) / 10));   // de lejos se difuminan; de cerca se ven bien
    if (v <= 0.02) continue;
    objs.push(...enemy(gh.id, 'fantasma', [gh.x, 0, gh.z], {
      t: t + gh.ph, yaw: gh.face, o: 0.86 * v, flash: gh.hitT > 0,
      c: gh.bad ? '#ff8ad8' : '#cfeaff',
    }));
  }
  objs.push({ id: 'lin', k: 'box', p: lp, s: [0.13, 0.13, 0.36], r: [0, s.yaw, 0], c: '#2a2a33' });
  objs.push({ id: 'linl', k: 'sph', p: lp, n: 0.075, c: '#fff1c2', e: 1, sh: false });
  // las 3 farolas más cercanas (la linterna ya usa una de las 4 luces)
  const lamps = CZ_LAMPS.map(l => ({ l, d: Math.hypot(l.x - p.x, l.z - p.z) })).sort((a, b) => a.d - b.d).slice(0, 3)
    .map(({ l }) => ({ p: [l.x, 3.1, l.z], c: '#ffb347', i: 9, d: 11 }));
  return {
    sky: { top: '#03040a', bottom: CZ_SKY, sun: true, sunC: '#c9d6ff', clouds: 0 },    // la luna es el disco del sol
    light: { dir: [0.35, 0.85, 0.25], sun: '#9fb4ff', i: 0.7, sky: '#2a3566', ground: '#15121c', hi: 1.0 },
    fog: { c: CZ_SKY, near: 7, far: 32 }, shadowR: 20,
    terrain: s.terrain, statics: s.statics,
    lights: [{ p: lp, c: '#fff1c2', i: 10, d: 14 }, ...lamps],
    objs, cam,
  };
}

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

  const start = () => { fx.clear(); clear3d(); asp.on = false; g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = (s, won) => {
    s.final = s.caught * 100 + (won ? Math.ceil(s.time) * 5 : 0);
    if (won) hx.win(); else hx.die();
    setRes({ isNew: submitBest(s.final), won }); setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p;
    s.t += dt; s.time -= dt; s.inv = Math.max(0, s.inv - dt); s.calm += dt; s.bobT += dt * 9;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.time <= 0) { s.time = 0; finish(s, false); return; }

    // mirar y caminar (con la cabeza ligeramente balanceándose al andar)
    s.yaw -= look.x * 2.4 * dt;
    s.pitch = Math.max(-1.2, Math.min(1.2, s.pitch - look.y * 1.5 * dt));
    const ox = p.x, oz = p.z;
    const moved = stepPlayer(p, move, dt, { yaw: s.yaw, speed: 4.6, bounds: CZ_BOUND, floor: () => 0 });
    s.walk += (Math.min(1, moved / Math.max(dt, 1e-3) / 4.6) - s.walk) * Math.min(1, dt * 8);
    if (inHouse(s.houses, p.x, p.z)) {   // las paredes frenan al jugador
      if (!inHouse(s.houses, p.x, oz)) p.z = oz;
      else if (!inHouse(s.houses, ox, p.z)) p.x = ox;
      else { p.x = ox; p.z = oz; }
    }

    // fantasmas: deambulan por el pueblo; los rojizos persiguen al jugador si está cerca
    const spd = 1.5 + s.caught * 0.07;   // cada fantasma atrapado, los rojos son un poco más rápidos
    for (const gh of s.ghosts) {
      if (gh.caught) continue;
      gh.tm -= dt; gh.hitT = Math.max(0, gh.hitT - dt);
      const dP = Math.hypot(gh.x - p.x, gh.z - p.z);
      let tx = gh.tx, tz = gh.tz, sp = 0.9;
      if (gh.bad && dP < 14) { tx = p.x; tz = p.z; sp = spd; }
      else if (gh.tm <= 0) {
        gh.tm = 3 + Math.random() * 3;
        const a = Math.random() * 6.28, rr = Math.random() * 9;
        gh.tx = gh.hx0 + Math.cos(a) * rr; gh.tz = gh.hz0 + Math.sin(a) * rr; tx = gh.tx; tz = gh.tz;
      }
      const dx = tx - gh.x, dz = tz - gh.z, dl = Math.hypot(dx, dz);
      if (dl > 0.2) { const m = Math.min(sp * dt, dl); gh.x += (dx / dl) * m; gh.z += (dz / dl) * m; gh.face = Math.atan2(-dx, -dz); }
      gh.x = Math.max(-CZ_BOUND, Math.min(CZ_BOUND, gh.x)); gh.z = Math.max(-CZ_BOUND, Math.min(CZ_BOUND, gh.z));
      if (gh.bad && s.inv <= 0 && dP < 1.1) {
        s.sanity -= 18; s.inv = 2; s.calm = 0; gh.hitT = 0.3; hx.bad(); fx.shake(10, 0.35); fx.flash(C.violet, 0.3);
        burst3d([p.x, p.y + 1.3, p.z], ['#ff8ad8', '#b58cff'], 22, { speed: 4, size: 0.18, life: 0.8, g: 2 });
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
      const sp2 = project(cam, [gh.x, 1.3, gh.z], s.vw, s.vh);
      if (!sp2 || sp2.z > 14) continue;
      const k = Math.hypot(sp2.x - s.vw / 2, sp2.y - s.vh / 2);
      if (k < CZ_CATCH_PX && k < ad) { ad = k; aim = gh; }
    }
    s.aimId = aim ? aim.id : null;
    if (aim && asp.on) {
      if (s.lastAim !== aim.id) s.hold = 0;
      s.lastAim = aim.id; s.hold += dt;
      if (Math.random() < 0.5) burst3d([aim.x, 1.3, aim.z], '#9ff3ff', 1, { speed: 1.2, size: 0.1, life: 0.35, g: 0 });   // hilo de luz hacia el fantasma
      if (s.hold >= CZ_HOLD) {
        aim.caught = true; s.caught += 1; s.hold = 0; s.lastAim = null; s.aimId = null;
        hx.good(); fx.flash(C.cyan, 0.2);
        burst3d([aim.x, 1.3, aim.z], ['#9ff3ff', '#ffffff', '#b58cff'], 34, { speed: 5, up: 2, g: -2, size: 0.2, life: 1.0 });
        ring3d([aim.x, 0.2, aim.z], '#9ff3ff', 20, { speed: 4, life: 0.7 });
        fx.pop(SCREEN_W / 2, SCREEN_H / 2 - 60, '+1 👻', C.cyan, 20);
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
  const scene = buildScene(s, phase === 'play' ? s.t : 0);
  const sc = s.final != null ? s.final : s.caught * 100;
  const aimV = s.aimId != null ? s.hold / CZ_HOLD : 0;
  return (
    <Game3D title="CAZAFANTASMAS" emoji="👻" accent={C.violet} onExit={onExit} score={sc} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(s, t)} orbit={{ c: [0, 0, 0], r: 26, h: 8, speed: 0.12, ly: 1.5, drop: 0 }}
      hud={<><HudPill icon="👻" value={`${s.caught}/${CZ_GHOSTS}`} color={C.violet} /><HudPill icon="🧠" value={`${Math.round(s.sanity)}%`} color={s.sanity < 30 ? C.red : C.violet} /><HudPill icon="⏱" value={`${Math.ceil(s.time)}s`} color={s.time < 20 ? C.red : C.cyan} /></>}
      subtitle="Recorre el pueblo de noche y atrapa a los fantasmas"
      lines={['Joystick izquierdo: caminar · derecho: mirar', 'Mantén ASPIRAR 1,5 s con un fantasma en el centro', 'Los fantasmas rojizos te asustan si te acercas: cuida la cordura', `Atrapa ${CZ_GHOSTS} fantasmas en ${CZ_TIME} s`]}
      result={{ won: res.won, isNew: res.isNew, title: res.won ? '¡PUEBLO LIMPIO!' : 'TE HAN ATRAPADO LA NOCHE', emoji: res.won ? '🏆' : '👻', subtitle: res.won ? 'El pueblo vuelve a dormir tranquilo' : 'Los fantasmas se quedan con el pueblo', stats: [['ATRAPADOS', `${s.caught}/${CZ_GHOSTS}`], ['CORDURA', `${Math.round(s.sanity)}%`], ['TIEMPO', `${Math.ceil(s.time)}s`]] }}>
      {/* el contenedor mide el área de juego: la retícula queda justo en su centro */}
      <View pointerEvents="none" onLayout={e => { s.vw = e.nativeEvent.layout.width; s.vh = e.nativeEvent.layout.height; }}
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: s.aimId != null ? C.amber : 'rgba(255,255,255,0.55)' }} />
        <View style={{ marginTop: 8, height: 6 }}>{s.aimId != null ? <Bar value={aimV} max={1} color={C.amber} h={6} w={52} /> : null}</View>
      </View>
      {target && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 4, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: C.violet, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Fantasma a {Math.round(td)} m</Text>
          </View>
        </View>
      )}
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '22%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 24, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      <Stick3D testID="cz-move" v={move} side="left" color={C.violet} />
      <Stick3D testID="cz-look" v={look} side="right" color={C.cyan} />
      <ActionBtn testID="cz-aspirar" label="ASPIRAR" color={C.violet} size={80} onDown={() => { asp.on = true; }} onUp={() => { asp.on = false; }} style={{ left: '50%', marginLeft: -40, bottom: 26 }} />
    </Game3D>
  );
}
