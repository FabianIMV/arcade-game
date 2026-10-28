import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Lives, Overlay, PlayArea, TouchBtn, TouchStick, alpha, clamp, hx, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { compassAngle, followCam, forward, near, right, seeded, stepPlayer } from '../utils/openworld';

// PARKOUR URBANO – ciudad de azoteas en tercera persona. Joystick izquierdo: correr · derecho: girar · SALTAR.
// Recoge las fichas brillantes de las azoteas en 120 s. Caer a la calle quita una vida y te devuelve a la última azotea.
const PK_G = 11, PK_P = 8.2, PK_MID = 5, PK_TIME = 120, PK_LIVES = 3, PK_GRAV = 22, PK_STREET = -20;
const PK_LIM = PK_G * PK_P / 2 - 1;
const PK_COL = ['#8c93a8', '#a9927a', '#6f8fb0', '#b7a3c7', '#9aa88a', '#c08f7a'];

// Ciudad: árbol aleatorio de azoteas sobre una cuadrícula. Cada azotea nace junto a otra, así que siempre hay camino.
// Los huecos entre edificios son la calle (-20). La diferencia de altura entre vecinos es ≤ 2.1 (salto ~2.5).
const buildCity = seed => {
  const r = seeded(seed);
  const cells = new Map();
  const key = (a, b) => `${a},${b}`;
  const add = (gx, gz, top) => {
    const b = { id: `b${cells.size}`, gx, gz, x: (gx - PK_MID) * PK_P, z: (gz - PK_MID) * PK_P, s: 4.5 + r() * 0.8, top, c: PK_COL[Math.floor(r() * PK_COL.length)], tank: r() < 0.3 };
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
  if (p.y <= gy) { p.y = gy; p.vy = 0; p.ground = true; } else p.ground = false;
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
    p: { x: r0.x, y: r0.top, z: r0.z, vy: 0, face: 0, ground: true }, mv: [0, 0], coy: 0, yaw: 0,
    time: PK_TIME, got: 0, lives: PK_LIVES, inv: 0, t: 0, toast: null, final: null,
  };
};

export function Parkour3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('parkour');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, why: 'time' });
  const move = useRef({ x: 0, y: 0, on: false }).current;
  const look = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); hx.tap(); };
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
    }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p;
    s.t += dt; s.time -= dt; s.inv = Math.max(0, s.inv - dt);
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.time <= 0) { s.time = 0; finish(s, 'time'); return; }
    s.yaw -= look.x * 2.4 * dt;
    physics(s, dt, move);
    if (p.y < -3) {   // caída a la calle
      s.lives -= 1; s.inv = 1.5; hx.bad(); fx.shake(8, 0.3); fx.flash(C.red, 0.3);
      s.toast = { m: '💥 ¡Caída!', t: 1.2 };
      if (s.lives <= 0) { finish(s, 'lives'); return; }
      const b = s.safe;
      p.x = b.x; p.z = b.z; p.y = b.top + 3; p.vy = 0; p.ground = false; s.mv = [0, 0];
      return;
    }
    for (const t of s.tokens) {
      if (t.cd > 0) { t.cd -= dt; continue; }
      if (Math.hypot(t.x - p.x, t.z - p.z) < 1.8 && Math.abs(p.y - t.b.top) < 2.5) {
        t.cd = 9; s.got += 1; hx.good(); fx.flash(C.amber, 0.18);
        s.toast = { m: `⭐ Ficha ${s.got}`, t: 1.2 };
      }
    }
  });

  const s = g.current; const p = s.p;
  const avail = s.tokens.filter(t => t.cd <= 0);
  let target = null, td = 1e9;
  avail.forEach(t => { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < td) { td = d; target = t; } });
  const ang = target ? compassAngle(p, s.yaw, target) : 0;
  const blink = s.inv > 0 && Math.floor(s.t * 12) % 2 === 0;
  const cam = camFor(s, p);
  const objs = [
    { id: 'calle', k: 'pla', p: [p.x, PK_STREET, p.z], s: [240, 240, 1], c: '#1b1e28' },
    ...near(s.roofs, p, 44).flatMap(b => [
      { id: b.id, k: 'box', p: [b.x, (b.top + PK_STREET) / 2, b.z], s: [b.s, b.top - PK_STREET, b.s], c: b.c },
      { id: `${b.id}r`, k: 'box', p: [b.x, b.top + 0.07, b.z], s: [b.s * 0.94, 0.14, b.s * 0.94], c: '#d9cbb0' },
      ...(b.tank ? [{ id: `${b.id}t`, k: 'cyl', p: [b.x + b.s * 0.25, b.top + 0.7, b.z - b.s * 0.2], s: [0.9, 1.4, 0.9], c: '#7a5b3e' }] : []),
    ]),
    ...near(avail, p, 40).flatMap(t => [
      { id: t.id, k: 'sph', p: [t.x, t.b.top + 1.2 + Math.sin(s.t * 3 + t.x) * 0.15, t.z], n: 0.5, c: '#ffe066', e: 0.8 },
      { id: `${t.id}o`, k: 'tor', p: [t.x, t.b.top + 1.2, t.z], n: 0.8, c: '#ffd23f', e: 0.5, r: [Math.PI / 2, 0, s.t * 2.5] },
    ]),
    // jugador
    { id: 'cuerpo', k: 'box', p: [p.x, p.y + 0.7, p.z], s: [0.7, 1.0, 0.45], r: [0, p.face, 0], c: blink ? '#ffffff' : '#ff5a36' },
    { id: 'cabeza', k: 'sph', p: [p.x, p.y + 1.45, p.z], n: 0.55, c: '#f2c29b' },
    { id: 'gorra', k: 'cyl', p: [p.x, p.y + 1.78, p.z], s: [0.8, 0.12, 0.8], c: '#22e6ff', e: 0.2 },
  ];
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const scene = { bg: '#1d2140', fog: { c: '#1d2140', near: 30, far: 70 }, shake, objs, cam };
  const sc = s.final != null ? s.final : s.got * 10 + s.seen.size * 5;
  const pad = (v, cx) => (
    <View pointerEvents="none" style={{ position: 'absolute', left: cx - 50, bottom: 14, width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
      <View style={{ position: 'absolute', left: 34 + v.x * 32, top: 34 + v.y * 32, width: 32, height: 32, borderRadius: 16, backgroundColor: v.on ? alpha(C.pink, 0.7) : 'rgba(255,255,255,0.35)' }} />
    </View>
  );
  return (
    <GameScreen title="PARKOUR URBANO" emoji="🏙️" accent={C.pink} onExit={onExit} score={sc} best={best}
      hud={<><Lives n={s.lives} max={PK_LIVES} /><Text style={{ color: C.text, fontWeight: '900', fontSize: 12 }}>⭐ {s.got}</Text><Text style={{ color: s.time < 15 ? C.red : C.pink, fontWeight: '900', fontSize: 12 }}>⏱ {Math.ceil(s.time)}s</Text></>}>
      <PlayArea fx={fx} bg="#1d2140">
        <World3D scene={scene} />
        {phase === 'play' && target && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: C.pink, fontSize: 18, fontWeight: '900', transform: [{ rotate: `${ang}rad` }] }}>▲</Text>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 8 }}>Ficha a {Math.round(td)} m</Text>
            </View>
          </View>
        )}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.25, width: AREA_W, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', ...tglow('#000', 8) }}>{s.toast.m}</Text>}
        {phase === 'play' && (
          <>
            <TouchStick testID="pk-move" v={move} R={44} style={{ position: 'absolute', left: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            <TouchStick testID="pk-look" v={look} R={44} style={{ position: 'absolute', right: 0, bottom: 0, width: AREA_W * 0.4, height: 170 }} />
            {pad(move, 62)}
            {pad(look, AREA_W - 62)}
            <TouchBtn testID="pk-jump" onDown={doJump} style={{ position: 'absolute', left: AREA_W / 2 - 32, bottom: 26, width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: C.pink, backgroundColor: alpha(C.pink, 0.2), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11 }}>SALTAR</Text>
            </TouchBtn>
          </>
        )}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🏙️"
          title={phase === 'over' ? (res.why === 'time' ? '¡SE ACABÓ EL TIEMPO!' : '¡SIN VIDAS!') : 'PARKOUR URBANO'}
          subtitle={phase === 'ready' ? 'Salta de azotea en azotea' : `⭐ ${s.got} fichas`}
          score={sc} best={best} isNew={res.isNew} accent={C.pink} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Joystick izquierdo: correr · derecho: girar la cámara', 'SALTAR mientras corres = salto largo', 'Caer a la calle quita una vida', `Recoge fichas brillantes en ${PK_TIME} s`] : null} />
      </PlayArea>
    </GameScreen>
  );
}
