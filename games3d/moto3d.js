import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, SCREEN_H, SCREEN_W, alpha, clamp, hx, lerp, pick, rand, tglow, uid, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { bush, car, hash01, moto, shade, tree } from '../utils/prefabs';

// MOTO 3D – autopista infinita en primera persona al atardecer.
// Joystick izquierdo: inclinarte a los lados · 🔥 nitro · 🛑 freno. Carriles izquierdos = contramano (más peligrosos y mejor pagados).
// Rozar autos: combo de puntos y recarga de nitro. Choque = fin.
//
// Mundo: la autopista se genera por FILAS de 14 m (rowObjs, caché) con todo instanciado (asfalto, líneas, postes, árboles,
// montañas). Los autos del tráfico usan el prefab `car` con inst:'auto' (cientos de piezas en pocas llamadas de dibujo).
// El manubrio de la vista en primera persona son objetos 3D pegados a la cámara (mirrors, puños, tablero).
const MT_LANES = [-5.4, -1.8, 1.8, 5.4];          // izq: sentido contrario · der: tu sentido
const MT_COLORS = ['#e63946', '#2a9df4', '#ffc233', '#8ac926', '#f5f5f5', '#8a5cd6', '#ff7f11', '#2b3340', '#19c6a8'];
const DIM = { sedan: { w: 1.8, l: 4.2 }, sport: { w: 1.9, l: 4.4 }, suv: { w: 1.95, l: 4.5 }, truck: { w: 2.0, l: 5.0 } };
const ROW = 14, AHEAD = 26;
const SKY_TOP = '#2b1f66', SKY_BOT = '#ff9a5e';
const NEON = ['#ff3df2', '#22e6ff', '#ffc233', '#7dff6b', '#ff4d6d'];

// ─── Mundo: filas de carretera (caché) ────────────────────────────
const rowCache = new Map();
function rowObjs(i) {
  let out = rowCache.get(i);
  if (out) return out;
  out = [];
  const zc = -(i + 0.5) * ROW, z0 = -i * ROW;
  const h = (k, n = 1) => hash01(`r${i}_${k}`, n);
  out.push({ k: 'pla', inst: 'asfalto', p: [0, 0.02, zc], s: [14.8, ROW + 0.05, 1], c: i % 2 ? '#3a3a44' : '#34343d', recv: true });
  for (const sd of [-1, 1]) {
    out.push({ k: 'pla', inst: 'arcen', p: [sd * 8.6, 0.015, zc], s: [2.4, ROW + 0.05, 1], c: '#524b48', recv: true });
    out.push({ k: 'pla', inst: 'borde', p: [sd * 7.2, 0.04, zc], s: [0.22, ROW + 0.05, 1], c: '#f4f4f4' });
    out.push({ k: 'pla', inst: 'amarilla', p: [sd * 0.2, 0.04, zc], s: [0.16, ROW + 0.05, 1], c: '#f2c233' });
    out.push({ k: 'pla', inst: 'raya', p: [sd * 3.6, 0.04, zc], s: [0.2, 4.6, 1], c: '#f4f4f4' });
    // valla de seguridad
    out.push({ k: 'box', inst: 'valla', p: [sd * 9.9, 0.78, zc], s: [0.12, 0.36, ROW], c: '#c3c8d2', m: { r: 0.4, m: 0.6 }, sh: true });
    out.push({ k: 'box', inst: 'valla', p: [sd * 9.9, 0.5, zc], s: [0.1, 0.1, ROW], c: '#9aa0ac' });
    out.push({ k: 'box', inst: 'pilote', p: [sd * 9.95, 0.5, z0], s: [0.14, 1.0, 0.14], c: '#6a707c' });
    out.push({ k: 'box', inst: 'cat', p: [sd * 9.82, 0.8, zc], s: [0.04, 0.12, 0.3], c: '#ff9a2e', e: 0.6 });
    // farolas (una cada dos filas)
    if ((i + (sd > 0 ? 1 : 0)) % 2 === 0) {
      out.push({ k: 'cyl', inst: 'poste', p: [sd * 10.8, 4.2, zc], s: [0.2, 8.4, 0.2], c: '#4a4f5c', sh: true });
      out.push({ k: 'box', inst: 'brazo', p: [sd * 9.5, 8.35, zc], s: [2.6, 0.16, 0.16], c: '#4a4f5c' });
      out.push({ k: 'box', inst: 'lampara', p: [sd * 8.3, 8.22, zc], s: [1.1, 0.14, 0.45], c: '#ffe4a8', e: 1 });
    }
    // vegetación y rocas fuera de la valla
    for (let k = 0; k < 3; k++) {
      if (h(`t${sd}${k}`) < 0.55) {
        const tx = sd * (14 + h(`tx${sd}${k}`) * 40), tz = z0 - h(`tz${sd}${k}`) * ROW;
        out.push(...tree(`t${i}_${sd}_${k}`, [tx, 0, tz], { kind: h(`tk${sd}${k}`) < 0.7 ? 'pine' : 'oak', h: 1.2 + h(`th${sd}${k}`) * 1.3, inst: 'arbol', sh: false, leaf: h(`tl${sd}${k}`) < 0.5 ? '#2d6a45' : '#3d7a3a' }));
      }
    }
    if (h(`b${sd}`) < 0.5) out.push(...bush(`bu${i}${sd}`, [sd * (11.5 + h(`bx${sd}`) * 6), 0, z0 - h(`bz${sd}`) * ROW], { inst: 'mata', sh: false, c: h(`bc${sd}`) < 0.5 ? '#6a8a3a' : '#8a7a3a' }));
    if (h(`o${sd}`) < 0.25) { const rr = 0.8 + h(`or${sd}`) * 2; out.push({ k: 'ico', inst: 'roca', p: [sd * (12 + h(`ox${sd}`) * 14), rr * 0.3, z0 - h(`oz${sd}`) * ROW], s: [rr * 2, rr * 1.2, rr * 1.7], c: shade('#8a7a7e', 0.8 + h(`oc${sd}`) * 0.4), sh: true }); }
    // cartel de neón
    if (h(`c${sd}`) < 0.05) {
      const col = NEON[Math.floor(h(`cc${sd}`) * NEON.length)], bx = sd * 17;
      out.push({ k: 'cyl', inst: 'poste', p: [bx - 3, 3.5, zc], s: [0.3, 7, 0.3], c: '#3a3f4a' });
      out.push({ k: 'cyl', inst: 'poste', p: [bx + 3, 3.5, zc], s: [0.3, 7, 0.3], c: '#3a3f4a' });
      out.push({ k: 'box', inst: 'cartel', p: [bx, 8, zc], s: [8, 3.4, 0.4], c: col, e: 1 });
      out.push({ k: 'box', inst: 'marco', p: [bx, 8, zc + 0.05], s: [8.5, 3.9, 0.3], c: '#202432' });
    }
    // montañas lejanas, siluetas moradas
    if (i % 4 === (sd > 0 ? 0 : 2)) {
      const mw = 70 + h(`mw${sd}`) * 70, mh = 35 + h(`mh${sd}`) * 60;
      out.push({ k: 'cone', inst: 'monte', p: [sd * (110 + h(`mx${sd}`) * 90), mh / 2 - 2, zc], s: [mw, mh, mw * 0.9], c: shade('#5b3f73', 0.8 + h(`mc${sd}`) * 0.5) });
    }
  }
  rowCache.set(i, out);
  if (rowCache.size > 160) rowCache.delete(rowCache.keys().next().value);
  return out;
}

// ─── Manubrio en 3D pegado a la cámara ────────────────────────────
const mm3 = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8]];
const eulXYZ = m => { const y = Math.asin(clamp(m[2], -1, 1)); return Math.abs(m[2]) < 0.99999 ? [Math.atan2(-m[5], m[8]), y, Math.atan2(-m[1], m[0])] : [Math.atan2(m[7], m[4]), y, 0]; };
const rotZm = a => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const rotXm = a => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotYm = a => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
function handlebar(cam, steer, roll, turbo, kmh) {
  const a = cam.yaw, b = cam.pitch, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const f = [-sa * cb, sb, -ca * cb], r = [ca, 0, -sa], u = [sa * sb, cb, ca * sb];
  const base = mm3(rotYm(a), rotXm(b));
  // punto en el marco de la cámara, girado por el alabeo del manubrio alrededor del eje de la vista
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const at = (rx, ry, rz) => { const x = rx * cr - ry * sr, y = rx * sr + ry * cr; return [cam.p[0] + r[0] * x + u[0] * y + f[0] * rz, cam.p[1] + r[1] * x + u[1] * y + f[1] * rz, cam.p[2] + r[2] * x + u[2] * y + f[2] * rz]; };
  const ori = (ex = 0, ey = 0, ez = 0) => eulXYZ(mm3(base, mm3(rotZm(roll), mm3(rotYm(ey), mm3(rotXm(ex), rotZm(ez))))));
  const o = [];
  const Z = 1.3, Y = -0.52;
  o.push({ id: 'hb.bar', k: 'cyl', p: at(0, Y, Z), s: [0.05, 0.74, 0.05], r: ori(0, 0, Math.PI / 2), c: '#16181f', m: { r: 0.4, m: 0.6 } });
  for (const sx of [-1, 1]) {
    o.push({ id: 'hb.grip' + sx, k: 'cyl', p: at(sx * 0.36, Y, Z - 0.02), s: [0.085, 0.2, 0.085], r: ori(0, 0, Math.PI / 2), c: '#0a0a0e' });
    o.push({ id: 'hb.lever' + sx, k: 'box', p: at(sx * 0.3, Y + 0.02, Z - 0.18), s: [0.035, 0.02, 0.24], r: ori(0, sx * 0.15, 0), c: '#8d93a3', m: { r: 0.3, m: 0.8 } });
    o.push({ id: 'hb.stem' + sx, k: 'cyl', p: at(sx * 0.31, Y + 0.12, Z + 0.04), s: [0.022, 0.24, 0.022], r: ori(0, 0, sx * -0.1), c: '#aab0bd', m: { r: 0.3, m: 0.8 } });
    o.push({ id: 'hb.mirror' + sx, k: 'box', p: at(sx * 0.32, Y + 0.27, Z + 0.05), s: [0.17, 0.11, 0.02], r: ori(-0.3, sx * -0.35, 0), c: '#9fb4c4', m: { r: 0.05, m: 0.9 } });
    o.push({ id: 'hb.mirrorB' + sx, k: 'box', p: at(sx * 0.32, Y + 0.27, Z + 0.062), s: [0.2, 0.14, 0.02], r: ori(-0.3, sx * -0.35, 0), c: '#15171d' });
  }
  o.push({ id: 'hb.dash', k: 'box', p: at(0, Y + 0.05, Z + 0.1), s: [0.26, 0.11, 0.1], r: ori(-0.5, 0, 0), c: '#15171d', m: { r: 0.3, m: 0.4 } });
  o.push({ id: 'hb.screen', k: 'box', p: at(0, Y + 0.1, Z + 0.06), s: [0.21, 0.07, 0.015], r: ori(-0.5, 0, 0), c: turbo ? '#22e6ff' : '#ff8a3d', e: 0.9 });
  return o;
}

// ─── Estado ───────────────────────────────────────────────────────
const initState = () => ({ z: 0, x: 3.6, speed: 0, lean: 0, cars: [], turbo: 0, nitro: 40, offroad: false, t: 0, dist: 0, bonus: 0, near: 0, spawnT: 0, toast: null, final: null, crash: null, wheel: 0, dustT: 0 });

function spawnCar(s) {
  const lane = pick(MT_LANES), onc = lane < 0;
  const far = s.z + (onc ? rand(240, 290) : rand(200, 250));
  if (s.cars.some(c => c.x === lane && Math.abs(c.z - far) < 22)) return;
  const kr = Math.random(), kind = kr < 0.4 ? 'sedan' : kr < 0.55 ? 'sport' : kr < 0.8 ? 'suv' : 'truck';
  s.cars.push({ id: uid(), x: lane, z: far, v: onc ? -rand(16, 26) : rand(9, 18), color: pick(MT_COLORS), kind, passed: false, spin: 0 });
}

function stepTraffic(s, dt) {
  s.spawnT -= dt;
  if (s.spawnT <= 0) { s.spawnT = Math.max(0.35, 1.1 - s.t * 0.012) * rand(0.6, 1.3); spawnCar(s); }
}

// Escena. mode 'fp' = ojos del piloto · 'show' = moto visible con piloto (menús)
function buildScene(s, t, mode, extra = {}) {
  const objs = [];
  const i0 = Math.floor(s.z / ROW) - 2;
  for (let i = i0; i < i0 + AHEAD; i++) objs.push(...rowObjs(i));
  for (const c of s.cars) {
    const rel = c.z - s.z; if (rel < -30 || rel > 345) continue;
    objs.push(...car(`c${c.id}`, [c.x, 0, -c.z], { kind: c.kind, c: c.color, yaw: c.v < 0 ? Math.PI : 0, spin: c.spin, inst: 'auto' }));
  }
  const bz = -s.z, sun = [s.x - 55, 34, bz - 300];
  objs.push({ id: 'sol', k: 'sph', p: sun, n: 62, c: '#fff0c0', e: 1, o: 1 });
  objs.push({ id: 'suelo', k: 'pla', p: [s.x, -0.03, bz - 150], s: [700, 760, 1], c: '#59603f', recv: true });
  let cam;
  const speedK = clamp(s.speed / 62, 0, 1.3);
  const lights = [{ p: [s.x, 1.4, bz - 9], c: s.turbo > 0 ? '#9fe8ff' : '#fff0d0', i: 4, d: 22 }];
  if (mode === 'fp') {
    cam = { p: [s.x, 1.55, bz], yaw: -s.lean * 0.05, pitch: -0.07, fov: 70 + speedK * 8 + (s.turbo > 0 ? 9 : 0) };
    objs.push(...handlebar(cam, s.lean, -s.lean * 0.22, s.turbo > 0, 0));
  } else {
    objs.push(...moto('yo', [s.x, 0, bz], { rider: extra.rider || '#f2c233', c: '#e0453a', spin: s.wheel, steer: s.lean * 0.3, roll: extra.roll != null ? extra.roll : -s.lean * 0.35, pitch: extra.pitch || 0, yaw: extra.yaw || 0 }));
    cam = { p: [s.x + 4.5, 2.4, bz + 6.5], l: [s.x, 1.1, bz], fov: 56 };
  }
  return {
    sky: { top: SKY_TOP, bottom: SKY_BOT, clouds: 9, sun: false, cloud: '#ffc9a8' }, fog: { c: SKY_BOT, near: 150, far: 420 },
    light: { dir: [0.35, 0.42, 0.84], sun: '#ffb36b', i: 2.5, sky: '#a98ad8', ground: '#5a3a3c', hi: 1.55 }, shadowR: 40,
    lights, objs, cam, shake: extra.shake,
  };
}

// ─── Piezas 2D ────────────────────────────────────────────────────
function NitroPill({ nitro, on }) {
  const col = on ? '#ffffff' : C.cyan;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(6,8,20,0.58)', borderRadius: 14, borderWidth: 1, borderColor: alpha(C.cyan, 0.6), paddingHorizontal: 9, paddingVertical: 3 }}>
      <Text style={{ fontSize: 13, marginRight: 6 }}>🔥</Text>
      <View style={{ width: 84, height: 9, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
        <View style={{ width: `${clamp(nitro, 0, 100)}%`, height: 9, backgroundColor: col }} />
      </View>
    </View>
  );
}

export function Moto3DGame({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('moto3d');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const stick = useRef({ x: 0, y: 0, on: false }).current;
  const hold = useRef({ brake: false, nitro: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const menu = useRef({ s: null }).current;

  const start = () => { fx.clear(); clear3d(); const s = initState(); s.speed = 14; g.current = s; hold.brake = false; hold.nitro = false; setPhase('play'); hx.tap(); };
  const crash = (s, c) => {
    s.speed = 0; s.final = Math.floor(s.dist / 2) + s.bonus; s.crash = c; hx.die(); fx.shake(14, 0.5); fx.flash(C.red, 0.5);
    const pos = [(s.x + c.x) / 2, 1.0, -s.z - 1];
    burst3d(pos, ['#ff7a2e', '#ffd23f', '#ffffff'], 46, { speed: 10, up: 3, g: 6, size: 0.5, life: 1.2 });
    burst3d(pos, '#2e2e34', 22, { speed: 4, g: -2, size: 0.9, life: 1.8 });
    ring3d(pos, '#ffb23d', 22, { speed: 9, life: 0.7, size: 0.28 });
    setRes({ isNew: submitBest(s.final) }); setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    const maxSp = Math.min(62, 36 + s.t * 0.35);
    const useNitro = hold.nitro && s.nitro > 0;
    if (useNitro) { s.nitro = Math.max(0, s.nitro - 30 * dt); s.turbo = 0.3; } else s.turbo = Math.max(0, s.turbo - dt);
    const target = hold.brake ? 12 : s.offroad ? 16 : useNitro ? maxSp * 1.35 : maxSp;
    s.speed += clamp(target - s.speed, -32 * dt, (useNitro ? 22 : 8) * dt);
    s.lean = lerp(s.lean, clamp(stick.x * 1.15, -1, 1), Math.min(1, dt * 6));
    s.x = clamp(s.x + s.lean * (7 + s.speed * 0.16) * dt, -9.5, 9.5);
    const wasOff = s.offroad; s.offroad = Math.abs(s.x) > 7.2;
    if (s.offroad && !wasOff) { hx.warn(); fx.shake(5, 0.2); }
    const dz = s.speed * dt; s.z += dz; s.dist += dz; s.wheel += dz / 0.37;
    stepTraffic(s, dt);
    // partículas: líneas de velocidad, chispas de nitro y polvo fuera del asfalto
    const sp = s.speed / 62;
    burst3d([s.x + rand(-7, 7), rand(0.4, 5), -s.z - rand(30, 80)], useNitro ? '#9fe8ff' : '#fff0d8', 1, { speed: 0.01, life: 0.6, size: useNitro ? 0.2 : 0.12, g: 0, drag: 0 });
    if (useNitro) burst3d([s.x + rand(-3, 3), rand(0.3, 2.5), -s.z - rand(8, 20)], '#ffffff', 1, { speed: 0.01, life: 0.4, size: 0.18, g: 0, drag: 0 });
    if (s.offroad) { s.dustT -= dt; if (s.dustT <= 0) { s.dustT = 0.05; burst3d([s.x + rand(-0.4, 0.4), 0.15, -s.z - 1.2], ['#a8845c', '#d2b48c'], 3, { speed: 2.5, up: 2.2, g: 7, size: 0.28, life: 0.7 }); } }
    for (const c of s.cars) {
      const prevRel = c.z - (s.z - dz); c.z += c.v * dt; c.spin += (c.v * dt) / 0.4 * -1;
      // los autos de tu carril frenan si alcanzan a otro
      if (c.v > 0) for (const o of s.cars) if (o !== c && o.x === c.x && o.z > c.z && o.z - c.z < 9) c.v = Math.min(c.v, o.v);
      const rel = c.z - s.z, dx = Math.abs(c.x - s.x), D = DIM[c.kind];
      if (dx < D.w / 2 + 0.45 && (Math.abs(rel) < D.l / 2 + 0.2 || (prevRel > 0) !== (rel > 0))) { crash(s, c); return; }
      if (!c.passed && rel < -(D.l / 2 + 0.2)) {
        c.passed = true;
        if (dx < 2.7) {
          s.near += 1; const b = 50 * s.near; s.bonus += b; s.nitro = Math.min(100, s.nitro + 12); s.toast = { m: `¡ROCE! +${b}`, t: 1 }; hx.good(); fx.flash(C.amber, 0.12);
          const side = Math.sign(c.x - s.x) || 1, pos = [(s.x + c.x) / 2 + side * 0.3, 0.9, -c.z];
          burst3d(pos, ['#ffd23f', '#ffffff', '#ff8a3d'], 16, { speed: 6, up: 1, g: 8, size: 0.14, life: 0.5 });
          ring3d(pos, '#ffe27a', 12, { speed: 6, life: 0.4, size: 0.14 });
          fx.pop(SCREEN_W / 2, SCREEN_H * 0.36, `x${s.near}`, C.amber, 30);
        }
      }
    }
    s.cars = s.cars.filter(c => { const rel = c.z - s.z; return rel > -32 && rel < 330; });
    if (s.offroad) { if (Math.random() < dt * 4) hx.tap(); s.near = 0; }
  });

  const s = g.current;
  const kmh = Math.round(s.speed * 3.6);
  const sc = s.final != null ? s.final : Math.floor(s.dist / 2) + s.bonus;
  const tNow = phase === 'play' ? s.t : 0;
  const fxS = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const rumble = phase === 'play' ? Math.max(s.offroad ? 0.05 : 0, s.turbo > 0 ? 0.03 : 0, 0.004 * s.speed / 62) : 0;
  const scene = buildScene(s, tNow, 'fp', { shake: Math.max(fxS, rumble) });
  // demo de inicio: moto con piloto circulando entre el tráfico · fin: el lugar del choque
  const menuScene = t => {
    if (s.final != null) {
      return buildScene({ ...s, x: s.x, speed: 0, wheel: 0 }, t, 'show', { rider: '#f2c233', roll: 1.2, pitch: -0.25, yaw: 0.3 });
    }
    let m = menu.s; if (!m) m = menu.s = initState();
    const dtm = Math.min(0.05, Math.max(0, t - (m.t0 || t))); m.t0 = t;
    m.speed = 34; m.t = t; m.z += 34 * dtm; m.wheel += 34 * dtm / 0.37; m.x = 3.6 + Math.sin(t * 0.7) * 1.8; m.lean = Math.cos(t * 0.7) * 0.5; m.turbo = 0;
    stepTraffic(m, dtm); for (const c of m.cars) { c.z += c.v * dtm; c.spin -= c.v * dtm / 0.4; if (Math.abs(c.x - m.x) < 2.3 && Math.abs(c.z - m.z) < 7) c.z += 14 * dtm * (c.v > 0 ? 1 : -1); }
    m.cars = m.cars.filter(c => c.z - m.z > -32 && c.z - m.z < 330);
    return buildScene(m, t, 'show');
  };
  return (
    <Game3D title="MOTO 3D" emoji="🏍️" accent={C.orange} onExit={onExit} score={sc} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={menuScene} orbit={{ r: 8, h: 2.4, speed: 0.25, ly: 1.0, drop: 1.6 }}
      hud={<><HudPill icon="🛣️" value={`${(s.dist / 1000).toFixed(2)} km`} color={C.cyan} /><HudPill icon="⚡" value={`x${s.near}`} color={C.amber} /><NitroPill nitro={s.nitro} on={s.turbo > 0} /></>}
      subtitle="Autopista infinita al atardecer, en primera persona"
      lines={['Joystick izquierdo: inclínate a izquierda y derecha', 'Carriles derechos: tu sentido · izquierdos: ¡contramano!', 'Pasa rozando autos: combo de puntos y nitro 🔥', '🔥 nitro (se recarga con roces) · 🛑 freno', 'Fuera del asfalto pierdes velocidad']}
      result={{ won: false, isNew: res.isNew, title: '¡CHOQUE!', emoji: '💥', subtitle: 'La autopista no perdona', stats: [['DISTANCIA', `${(s.dist / 1000).toFixed(2)} km`], ['ROCES', `+${s.bonus}`], ['COMBO', `x${s.near}`]] }}>
      {s.turbo > 0 && <View pointerEvents="none" style={{ position: 'absolute', left: -2, right: -2, top: -60, bottom: -40, borderWidth: 12, borderColor: 'rgba(34,230,255,0.22)', borderRadius: 30 }} />}
      {s.offroad && <Text pointerEvents="none" style={{ position: 'absolute', top: '13%', left: 0, right: 0, textAlign: 'center', color: C.amber, fontWeight: '900', fontSize: 14, ...tglow('#000', 6) }}>⚠️ ¡FUERA DE LA PISTA!</Text>}
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '22%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontWeight: '900', fontSize: 26, ...tglow(C.amber, 10) }}>{s.toast.m}</Text>}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 74, alignItems: 'center' }}>
        <Text style={{ color: s.turbo > 0 ? C.cyan : '#fff', fontSize: 34, fontWeight: '900', lineHeight: 36, ...tglow(s.turbo > 0 ? C.cyan : C.orange, 10) }}>{kmh}</Text>
        <Text style={{ color: C.dim, fontSize: 9, fontWeight: '900', letterSpacing: 2 }}>KM/H</Text>
      </View>
      <Stick3D testID="mt-steer" v={stick} side="left" color={C.orange} />
      <ActionBtn testID="mt-nitro" icon="🔥" label="NITRO" color={C.cyan} size={72} onDown={() => { hold.nitro = true; }} onUp={() => { hold.nitro = false; }} style={{ right: 22, bottom: 108 }} />
      <ActionBtn testID="mt-brake" icon="🛑" label="FRENO" color={C.red} size={62} onDown={() => { hold.brake = true; }} onUp={() => { hold.brake = false; }} style={{ right: 100, bottom: 40 }} />
    </Game3D>
  );
}
