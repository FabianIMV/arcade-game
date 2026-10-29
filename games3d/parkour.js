import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, Lives, clamp, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { coin, person } from '../utils/prefabs';
import { compassAngle, followCam, forward, right, seeded, stepPlayer } from '../utils/openworld';

// PARKOUR URBANO – ciudad de azoteas al atardecer, tercera persona. Joystick izquierdo: correr · derecho: girar · SALTAR.
// Recoge las fichas doradas de las azoteas en 120 s. Caer a la calle quita una vida y te devuelve a la última azotea.
// Dificultad progresiva: tras 60 s las fichas tardan más en reaparecer.
//
// Qué enseña este archivo:
//  · ciudad completa en scene.statics con instancing (edificio, azotea, tanque, neón): una sola malla por tipo
//  · recv:true en azoteas y calle para que el sol del atardecer proyecte sombras
//  · person() animado: brazos al cielo en el aire, zancada según la velocidad
//  · cielo y niebla de atardecer, luz cálida y un punto de luz rosa que sigue al jugador

const PK_G = 11, PK_P = 8.2, PK_MID = 5, PK_TIME = 120, PK_LIVES = 3, PK_GRAV = 22, PK_STREET = -20;
const PK_LIM = PK_G * PK_P / 2 - 1;
const PK_COL = ['#8c93a8', '#a9927a', '#6f8fb0', '#b7a3c7', '#9aa88a', '#c08f7a'];
const PK_NEON = ['#ff3df2', '#22e6ff', '#ffc233', '#7dff6b'];

// smoothing de cámara (lerp exponencial)
const smoothCam = (s, dt, ideal) => {
  if (!s.cam) { s.cam = ideal; return; }
  const k = 1 - Math.exp(-dt * 10), mix = (a, b) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  s.cam = { p: mix(s.cam.p, ideal.p), l: mix(s.cam.l, ideal.l), fov: ideal.fov };
};

// Ciudad: árbol aleatorio de azoteas sobre una cuadrícula. Cada azotea nace junto a otra, así que siempre hay camino.
// Los huecos entre edificios son la calle (-20). La diferencia de altura entre vecinos es ≤ 2.1 (salto ~2.5).
const buildCity = seed => {
  const r = seeded(seed);
  const cells = new Map();
  const key = (a, b) => `${a},${b}`;
  const add = (gx, gz, top) => {
    const b = {
      id: `b${cells.size}`, gx, gz, x: (gx - PK_MID) * PK_P, z: (gz - PK_MID) * PK_P, s: 4.5 + r() * 0.8, top,
      c: PK_COL[Math.floor(r() * PK_COL.length)], tank: r() < 0.3, neon: r() < 0.45 ? PK_NEON[Math.floor(r() * PK_NEON.length)] : null,
    };
    cells.set(key(gx, gz), b);
    return b;
  };
  const root = add(PK_MID, PK_MID, 2.5 + r() * 1.5);
  const front = [root];
  const want = Math.round(PK_G * PK_G * 0.55);
  for (let guard = 0; cells.size < want && guard < 4000; guard++) {
    const par = front[Math.floor(r() * front.length)];
    const d = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(r() * 4)];
    const gx = par.gx + d[0], gz = par.gz + d[1];
    if (gx < 0 || gz < 0 || gx >= PK_G || gz >= PK_G || cells.has(key(gx, gz))) continue;
    front.push(add(gx, gz, clamp(par.top + (r() - 0.5) * 4.2, 1.2, 7.5)));
  }
  const roofs = [...cells.values()];
  const tokens = [];
  roofs.forEach((b, i) => {
    if (r() < 0.6) {
      const dx = (r() - 0.5) * b.s * 0.6, dz = (r() - 0.5) * b.s * 0.6;
      tokens.push({ id: `f${i}`, b, x: b.x + dx, z: b.z + dz, cd: 0 });
    }
  });
  return { cells, roofs, tokens, root };
};

// Todos los edificios, azoteas, tanques y letreros de neón: una sola vez (scene.statics, instancing)
const cityStatics = roofs => roofs.flatMap(b => {
  const out = [
    { id: b.id, k: 'box', p: [b.x, (b.top + PK_STREET) / 2, b.z], s: [b.s, b.top - PK_STREET, b.s], c: b.c, inst: 'edificio', sh: true },
    { id: `${b.id}r`, k: 'box', p: [b.x, b.top + 0.07, b.z], s: [b.s * 0.94, 0.14, b.s * 0.94], c: '#d9cbb0', inst: 'azotea', recv: true },
  ];
  if (b.tank) out.push({ id: `${b.id}t`, k: 'cyl', p: [b.x + b.s * 0.25, b.top + 0.7, b.z - b.s * 0.2], s: [0.9, 1.4, 0.9], c: '#7a5b3e', inst: 'tanque', sh: true });
  if (b.neon) out.push({ id: `${b.id}n`, k: 'box', p: [b.x + b.s / 2 + 0.03, b.top - 1.6, b.z], s: [0.06, 0.9, b.s * 0.6], c: b.neon, e: 1, inst: 'neon' });
  return out;
});

// Azotea bajo (x, z), o null si es calle.
const roofAt = (cells, x, z) => {
  const gx = Math.round(x / PK_P + PK_MID), gz = Math.round(z / PK_P + PK_MID);
  for (let a = gx - 1; a <= gx + 1; a++) for (let b = gz - 1; b <= gz + 1; b++) {
    const c = cells.get(`${a},${b}`);
    if (c && Math.abs(x - c.x) <= c.s / 2 && Math.abs(z - c.z) <= c.s / 2) return c;
  }
  return null;
};
// ¿Hay un edificio que bloquee (x, z) a la altura y? lim = cuánto se puede subir de escalón (0.6); con -0.4 sirve para la cámara.
const hitAt = (cells, x, z, y, lim) => {
  const gx = Math.round(x / PK_P + PK_MID), gz = Math.round(z / PK_P + PK_MID);
  for (let a = gx - 1; a <= gx + 1; a++) for (let b = gz - 1; b <= gz + 1; b++) {
    const c = cells.get(`${a},${b}`);
    if (c && c.top > y + lim && Math.abs(x - c.x) < c.s / 2 + 0.3 && Math.abs(z - c.z) < c.s / 2 + 0.3) return true;
  }
  return false;
};
const floorAt = (cells, x, z) => { const b = roofAt(cells, x, z); return b ? b.top : PK_STREET; };

// Un paso de física: stepPlayer (joystick + gravedad + floor = azotea o calle), impulso del salto y paredes.
const physics = (s, dt, move) => {
  const p = s.p;
  const ox = p.x, oy = p.y, oz = p.z, ovy = p.vy;
  const air = !p.ground;
  const f = forward(s.yaw), rt = right(s.yaw);
  stepPlayer(p, air ? { x: move.x * 0.15, y: move.y * 0.15 } : move, dt, { yaw: s.yaw, floor: (x, z) => floorAt(s.cells, x, z), bounds: PK_LIM, speed: 8 });
  if (!air) s.mv = [(f[0] * -move.y + rt[0] * move.x) * 8, (f[1] * -move.y + rt[1] * move.x) * 8];
  else { p.x = clamp(p.x + s.mv[0] * dt, -PK_LIM, PK_LIM); p.z = clamp(p.z + s.mv[1] * dt, -PK_LIM, PK_LIM); }
  if (hitAt(s.cells, p.x, p.z, oy, 0.6)) {   // pared: no se entra en un edificio más alto que tú
    p.x = ox; p.z = oz; s.mv = [0, 0];
    p.vy = ovy - PK_GRAV * dt; p.y = oy + p.vy * dt;
  }
  const gy = floorAt(s.cells, p.x, p.z);
  if (p.y <= gy) {
    if (!p.ground && p.vy < -6) burst3d([p.x, p.y + 0.05, p.z], ['#d9cbb0', '#ffffff'], 8, { speed: 2.5, up: 1.2, g: 8, size: 0.14, life: 0.5 });
    p.y = gy; p.vy = 0; p.ground = true;
  } else p.ground = false;
  if (p.ground && gy > 0) {
    const roof = roofAt(s.cells, p.x, p.z);
    if (roof) { s.safe = roof; s.seen.add(roof.id); }
  }
  s.coy = p.ground ? 0.12 : Math.max(0, s.coy - dt);   // margen para saltar justo después de salir de la azotea
};

// Cámara en tercera persona que no se mete dentro de los edificios.
const camFor = (s, p) => {
  let c = null;
  for (const d of [8, 6, 4.5, 3, 2]) {
    c = followCam(p, s.yaw, { dist: d, height: 4.2, look: 1.5 });
    if (!hitAt(s.cells, c.p[0], c.p[2], c.p[1], -0.4)) break;
  }
  return c;
};

const initState = () => {
  const seed = Math.floor(Math.random() * 1e9);
  const city = buildCity(seed);
  const r0 = city.root;
  return {
    cells: city.cells, roofs: city.roofs, tokens: city.tokens, safe: r0, seen: new Set([r0.id]),
    statics: cityStatics(city.roofs),
    p: { x: r0.x, y: r0.top, z: r0.z, vy: 0, face: 0, ground: true }, mv: [0, 0], coy: 0, yaw: 0, cam: null, walk: 0,
    time: PK_TIME, got: 0, lives: PK_LIVES, inv: 0, t: 0, toast: null, final: null,
  };
};

// Escena (juega y sirve de fondo animado en inicio/fin)
function buildScene(s, t) {
  const p = s.p;
  const blink = s.inv > 0 && Math.floor(s.t * 12) % 2 === 0;
  const avail = s.tokens.filter(k => k.cd <= 0);
  const objs = [];
  for (const k of avail) {
    if (Math.hypot(k.x - p.x, k.z - p.z) > 40) continue;
    objs.push(...coin(k.id, [k.x, k.b.top + 1.4, k.z], { t: t + k.x, c: '#ffd23f', n: 1.5, bob: 0.12 }));
  }
  // jugador: corre con zancada, brazos al cielo cuando está en el aire
  objs.push(...person('yo', [p.x, p.y, p.z], {
    yaw: p.face, t, walk: s.walk, arms: p.ground ? undefined : Math.PI, hat: 'cap', band: '#22e6ff',
    shirt: '#ff5a36', pants: '#262b40', skin: '#f2c29b', hair: '#2a1d14', flash: blink,
  }));
  return {
    sky: { top: '#2b2f6e', bottom: '#f5a77a', sun: true, sunC: '#ffd29a', clouds: 5 },
    light: { dir: [-0.6, 0.35, 0.5], sun: '#ffd3a1', i: 2.6, sky: '#c9d2ff', ground: '#3a3050', hi: 1.5 },
    fog: { c: '#f5a77a', near: 40, far: 110 }, shadowR: 22,
    statics: s.statics,
    lights: [{ p: [p.x, p.y + 2.5, p.z], c: '#ff7ad9', i: 5, d: 10 }],
    objs: [
      { id: 'calle', k: 'pla', p: [0, PK_STREET, 0], s: [240, 240, 1], c: '#1b1e28', recv: true },
      ...objs,
    ],
    cam: s.cam || camFor(s, p),
  };
}

export function Parkour3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('parkour');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, why: 'time' });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = (s, why) => {
    s.final = s.got * 10 + s.seen.size * 5;
    if (why === 'time') hx.win(); else hx.die();
    setRes({ isNew: submitBest(s.final), why }); setPhase('over');
  };
  const doJump = () => {
    const s = g.current;
    const moving = Math.hypot(move.x, move.y) > 0.4;
    // salto largo: si corres, el impulso de la carrera se conserva en el aire (≈ 7 m); parado solo sube
    if (s.p.ground || s.coy > 0) {
      s.p.vy = moving ? 9.6 : 10.8; s.p.ground = false; s.coy = 0; hx.tap();
      burst3d([s.p.x, s.p.y + 0.05, s.p.z], ['#d9cbb0', '#ffffff'], 6, { speed: 2, up: 1, g: 6, size: 0.12, life: 0.4 });
    }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p;
    s.t += dt; s.time -= dt; s.inv = Math.max(0, s.inv - dt);
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.time <= 0) { s.time = 0; finish(s, 'time'); return; }
    s.yaw -= look.x * 2.4 * dt;
    const px = p.x, pz = p.z;
    physics(s, dt, move);
    const moved = Math.hypot(p.x - px, p.z - pz);
    s.walk += (Math.min(1, moved / Math.max(dt, 1e-3) / 8) * (p.ground ? 1 : 0) - s.walk) * Math.min(1, dt * 10);
    smoothCam(s, dt, camFor(s, p));
    if (p.y < -3) {   // caída a la calle
      s.lives -= 1; s.inv = 1.5; hx.bad(); fx.shake(8, 0.3); fx.flash(C.red, 0.3);
      burst3d([p.x, p.y + 1, p.z], ['#ff5a36', '#ffd23f'], 18, { speed: 4, up: 2, size: 0.18, life: 0.7 });
      s.toast = { m: '💥 ¡Caída!', t: 1.2 };
      if (s.lives <= 0) { finish(s, 'lives'); return; }
      const b = s.safe;
      p.x = b.x; p.z = b.z; p.y = b.top + 3; p.vy = 0; p.ground = false; s.mv = [0, 0];
      ring3d([b.x, b.top + 0.2, b.z], '#22e6ff', 14, { speed: 4, life: 0.5 });
      return;
    }
    // fichas: tardan más en reaparecer tras 60 s (dificultad progresiva)
    const respawn = s.t > 60 ? 13 : 9;
    for (const k of s.tokens) {
      if (k.cd > 0) { k.cd -= dt; continue; }
      if (Math.hypot(k.x - p.x, k.z - p.z) < 1.8 && Math.abs(p.y - k.b.top) < 2.5) {
        k.cd = respawn; s.got += 1; hx.good(); fx.flash(C.amber, 0.18);
        burst3d([k.x, k.b.top + 1.4, k.z], ['#ffd23f', '#fff3b0', '#ffb300'], 22, { speed: 4, up: 3, g: 8, size: 0.16, life: 0.8 });
        s.toast = { m: `⭐ Ficha ${s.got}`, t: 1.2 };
      }
    }
  });

  const s = g.current; const p = s.p;
  const avail = s.tokens.filter(t => t.cd <= 0);
  let target = null, td = 1e9;
  avail.forEach(t => { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < td) { td = d; target = t; } });
  const ang = target ? compassAngle(p, s.yaw, target) : 0;
  const scene = buildScene(s, phase === 'play' ? s.t : 0);
  const sc = s.final != null ? s.final : s.got * 10 + s.seen.size * 5;
  return (
    <Game3D title="PARKOUR URBANO" emoji="🏙️" accent={C.pink} onExit={onExit} score={sc} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(s, t)} orbit={{ r: 16, h: 7, speed: 0.14, ly: 2.2 }}
      hud={<><Lives n={s.lives} max={PK_LIVES} /><HudPill icon="⭐" value={String(s.got)} color={C.amber} /><HudPill icon="⏱" value={`${Math.ceil(s.time)}s`} color={s.time < 15 ? C.red : C.pink} /></>}
      subtitle="Salta de azotea en azotea"
      lines={['Joystick izquierdo: correr · derecho: girar la cámara', 'SALTAR mientras corres = salto largo', 'Caer a la calle quita una vida', `Recoge fichas doradas en ${PK_TIME} s`]}
      result={{ won: res.why === 'time', isNew: res.isNew, title: res.why === 'time' ? '¡SE ACABÓ EL TIEMPO!' : '¡SIN VIDAS!', emoji: res.why === 'time' ? '🏆' : '🏙️', subtitle: res.why === 'time' ? 'Buena carrera por los tejados' : 'La calle te ha tragado', stats: [['FICHAS', String(s.got)], ['AZOTEAS', String(s.seen.size)], ['VIDAS', String(s.lives)]] }}>
      {target && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 4, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: C.pink, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Ficha a {Math.round(td)} m</Text>
          </View>
        </View>
      )}
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '22%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      <Stick3D testID="pk-move" v={move} side="left" color={C.pink} />
      <Stick3D testID="pk-look" v={look} side="right" color={C.cyan} />
      <ActionBtn testID="pk-jump" label="SALTAR" color={C.pink} onDown={doJump} style={{ left: '50%', marginLeft: -33, bottom: 34 }} />
    </Game3D>
  );
}
