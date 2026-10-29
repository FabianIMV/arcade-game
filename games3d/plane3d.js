import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, SCREEN_H, SCREEN_W, alpha, clamp, hx, lerp, rand, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill, Stick3D } from '../utils/ui3d';
import { bush, hash01, plane, shade, tree } from '../utils/prefabs';
import { project } from '../utils/openworld';

// AVIÓN 3D – vuelo en primera persona por un cañón.
// Arrastra en cualquier parte de la pantalla para pilotar (arriba = subir, lados = girar). Atraviesa los anillos para
// ganar puntos, combo y combustible; esquiva las columnas de roca y no toques el suelo ni las paredes.
//
// Mundo: el cañón es infinito y se genera por FILAS de 12 m (rowObjs) con roca instanciada (`inst`). Las filas son
// deterministas por índice y se guardan en caché, así que el coste por frame es solo escribir las instancias visibles.
// La cámara va en los ojos del piloto (sin roll); delante se ve la hélice del prefab `plane`.
const AV_WALL = 27, ROW = 12, AHEAD = 34, FOV = 76;
const SKY_TOP = '#2c7be0', SKY_BOT = '#ffd9a6';
const STRATA = ['#8f3f2a', '#b5553a', '#d2733f', '#e39a55', '#e8bd7a'];
const riverX = z => Math.sin(z * 0.017) * 7;

// ─── Mundo: filas del cañón (caché) ───────────────────────────────
const rowCache = new Map();
function rowObjs(i) {
  let out = rowCache.get(i);
  if (out) return out;
  out = [];
  const z = -i * ROW;
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 3; k++) {   // paredes: 3 capas de rocas facetadas con estratos de color
      const R = 9 + hash01(`w${i}_${sd}_${k}`, 1) * 6;
      const cx = sd * (AV_WALL + 1.5 + R * (1.0 + hash01(`w${i}_${sd}_${k}`, 2) * 0.25));
      out.push({ k: 'ico', inst: 'pared', p: [cx, 3 + k * 14.5 + R * 0.12, z + (hash01(`w${i}_${sd}_${k}`, 3) - 0.5) * 5], s: [R * 2, R * 2.5, R * 2.2], r: [0, hash01(`w${i}_${sd}_${k}`, 4) * 6, 0], c: shade(STRATA[Math.min(4, k + (hash01(`w${i}_${sd}_${k}`, 5) < 0.3 ? 1 : 0))], 0.9 + hash01(`w${i}_${sd}_${k}`, 6) * 0.25), sh: true });
    }
    out.push({ k: 'box', inst: 'meseta', p: [sd * (50 + hash01(`m${i}${sd}`, 1) * 8), 47, z], s: [34, 9, ROW + 1.5], c: shade('#e8bd7a', 0.9 + hash01(`m${i}${sd}`, 2) * 0.2) });
    if (hash01(`b${i}${sd}`, 1) < 0.55) {   // peñascos al pie de la pared
      const rr = 1.6 + hash01(`b${i}${sd}`, 2) * 3;
      out.push({ k: 'ico', inst: 'penasco', p: [sd * (AV_WALL - 1.5 - hash01(`b${i}${sd}`, 3) * 6), rr * 0.3, z + (hash01(`b${i}${sd}`, 4) - 0.5) * 8], s: [rr * 2, rr * 1.4, rr * 1.8], c: shade('#9a5a3e', 0.85 + hash01(`b${i}${sd}`, 5) * 0.3), sh: true });
    }
    if (hash01(`t${i}${sd}`, 1) < 0.65) {   // pinos y arbustos del fondo del valle
      const tx = sd * (13 + hash01(`t${i}${sd}`, 2) * 11), tz = z + (hash01(`t${i}${sd}`, 3) - 0.5) * ROW;
      out.push(...tree(`pn${i}${sd}`, [tx, 0, tz], { kind: 'pine', h: 1.5 + hash01(`t${i}${sd}`, 4) * 1.2, inst: 'pino', sh: false, leaf: hash01(`t${i}${sd}`, 5) < 0.5 ? '#2f7d44' : '#3b8a3a' }));
    }
    if (hash01(`u${i}${sd}`, 1) < 0.5) out.push(...bush(`bu${i}${sd}`, [sd * (9 + hash01(`u${i}${sd}`, 2) * 16), 0, z + (hash01(`u${i}${sd}`, 3) - 0.5) * ROW], { inst: 'mata', sh: false, c: hash01(`u${i}${sd}`, 4) < 0.5 ? '#6b9a3e' : '#8a9a3a' }));
  }
  // río sinuoso por el centro del valle
  const rx = riverX(z), rx2 = riverX(z - ROW);
  out.push({ k: 'pla', inst: 'rio', p: [(rx + rx2) / 2, 0.18, z - ROW / 2], s: [10 + hash01(`r${i}`, 1) * 2, ROW + 0.6, 1], r: [-Math.PI / 2, 0, Math.atan2(rx - rx2, ROW)], c: '#38a8de' });
  out.push({ k: 'pla', inst: 'espuma', p: [(rx + rx2) / 2 + 3.2 + hash01(`r${i}`, 2), 0.22, z - ROW / 2], s: [0.5, ROW * 0.6, 1], r: [-Math.PI / 2, 0, 0], c: '#d8f4ff' });
  rowCache.set(i, out);
  if (rowCache.size > 140) rowCache.delete(rowCache.keys().next().value);
  return out;
}

// pilar de roca (obstáculo): cono con base ancha + casquete
function spireObjs(it) {
  const R = it.r * 1.15, c = STRATA[1 + (it.n % 3)];
  return [
    { k: 'cone', inst: 'pilar', p: [it.x, it.h / 2, -it.z], s: [R * 2, it.h, R * 2], c, sh: true },
    { k: 'ico', inst: 'pilarb', p: [it.x, R * 0.35, -it.z], s: [R * 2.7, R * 1.1, R * 2.7], c: shade(c, 0.85), sh: true },
    { k: 'ico', inst: 'pilarc', p: [it.x, it.h * 0.55, -it.z], s: [R * 1.1, it.h * 0.25, R * 1.1], c: shade(c, 1.12), sh: true },
  ];
}


// hélice vista desde la cabina: se coloca respecto a la cámara (adelante f, derecha r, arriba u)
const mm3 = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8]];
const eulXYZ = m => { const y = Math.asin(clamp(m[2], -1, 1)); return Math.abs(m[2]) < 0.99999 ? [Math.atan2(-m[5], m[8]), y, Math.atan2(-m[1], m[0])] : [Math.atan2(m[7], m[4]), y, 0]; };
function propObjs(pz, t) {
  const a = pz.yaw, b = pz.pitch, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const f = [-sa * cb, sb, -ca * cb], r = [ca, 0, -sa], u = [sa * sb, cb, ca * sb];
  const at = (rx, ry, rz) => [pz.x + r[0] * rx + u[0] * ry + f[0] * rz, pz.y + r[1] * rx + u[1] * ry + f[1] * rz, pz.z + r[2] * rx + u[2] * ry + f[2] * rz];
  const base = mm3([ca, 0, sa, 0, 1, 0, -sa, 0, ca], [1, 0, 0, 0, cb, -sb, 0, sb, cb]);   // Ry(yaw)·Rx(pitch)
  const c = at(0, -1.5, 6), out = [];
  for (let k = 0; k < 2; k++) {
    const sp = t * 16 + k * Math.PI / 2, cs = Math.cos(sp), sn = Math.sin(sp);
    out.push({ id: `hel${k}`, k: 'box', p: c, s: [0.09, 1.2, 0.02], r: eulXYZ(mm3(base, [cs, -sn, 0, sn, cs, 0, 0, 0, 1])), c: '#2a2d38', o: 0.55 });
  }
  out.push({ id: 'helD', k: 'cyl', p: c, s: [1.2, 0.01, 1.2], r: eulXYZ(mm3(base, [1, 0, 0, 0, 0, -1, 0, 1, 0])), c: '#ffffff', o: 0.08, e: 0.4 });
  out.push({ id: 'helC', k: 'cone', p: at(0, -1.5, 5.7), s: [0.26, 0.4, 0.26], r: eulXYZ(mm3(base, [1, 0, 0, 0, 0, 1, 0, -1, 0])), c: '#d6402f', e: 0.2 });
  return out;
}

// ─── Estado ───────────────────────────────────────────────────────
const initState = () => ({ d: 0, speed: 32, x: 0, y: 14, vx: 0, vy: 0, roll: 0, pitch: 0, fuel: 100, t: 0, rings: 0, combo: 0, bonus: 0, items: [], nextZ: 70, nid: 0, toast: null, final: null, why: '', hitFx: [], wall: 0, lowT: 0 });

function spawn(s) {
  while (s.nextZ < s.d + 400) {
    const z = s.nextZ;
    const last = [...s.items].reverse().find(o => o.kind === 'ring');
    const bx = last ? clamp(last.x + rand(-11, 11), -18, 18) : 0, by = last ? clamp(last.y + rand(-7, 7), 6, 32) : 14;
    s.items.push({ id: s.nid++, kind: 'ring', x: bx, y: by, z, done: false });
    if (s.t > 4 || z > 200) for (let k = 0; k < (Math.random() < 0.5 ? 1 : 2); k++) {
      const px = rand(-AV_WALL + 3, AV_WALL - 3);
      if (Math.abs(px - bx) > 7) s.items.push({ id: s.nid++, kind: 'rock', n: s.nid, x: px, z: z + rand(15, 35), r: rand(2.2, 4), h: rand(12, 40), done: false });
    }
    s.nextZ += Math.max(42, 70 - s.d / 300);
  }
}

// Posición y orientación de la cámara/avión a partir del estado
function poseOf(s) {
  return { yaw: -s.vx * 0.018, pitch: s.pitch, x: s.x, y: s.y, z: -s.d };
}

// Escena. mode 'fp' = primera persona (jugando) · 'show' = avión visible (menús)
function buildScene(s, t, mode) {
  const pz = poseOf(s);
  const objs = [];
  const i0 = Math.floor(s.d / ROW) - 2;
  for (let i = i0; i < i0 + AHEAD; i++) objs.push(...rowObjs(i));
  let next = null;
  for (const it of s.items) {
    if (it.done && it.kind === 'ring' && !it.hitT) continue;
    const rel = it.z - s.d; if (rel < -14 || rel > 420) continue;
    if (it.kind === 'ring') {
      if (!next && !it.done) next = it;
      const isNext = it === next, pulse = isNext ? 1 + Math.sin(t * 8) * 0.04 : 1;
      const k = it.hitT != null ? 1 + (t - it.hitT) * 3 : pulse;
      const o = it.hitT != null ? Math.max(0, 1 - (t - it.hitT) * 2.2) : 1;
      if (o <= 0) continue;
      const col = isNext ? '#ffd23f' : '#3fe0ff';
      objs.push({ id: `rg${it.id}`, k: 'tor', p: [it.x, it.y, -it.z], s: [7.6 * k, 7.6 * k, 3.4], c: col, e: 0.9, o });
      objs.push({ id: `rh${it.id}`, k: 'tor', p: [it.x, it.y, -it.z], s: [8.6 * k, 8.6 * k, 1.2], c: '#ffffff', e: 1, o: 0.28 * o });
      if (isNext) objs.push({ id: `rd${it.id}`, k: 'cyl', p: [it.x, it.y, -it.z], s: [6.4, 0.2, 6.4], r: [Math.PI / 2, 0, 0], c: '#ffe27a', e: 1, o: 0.12 });
    } else objs.push(...spireObjs(it));
  }
  // suelo del valle (recibe sombras) y sombra circular bajo el avión
  objs.push({ id: 'suelo', k: 'pla', p: [0, 0, -s.d - 150], s: [300, 640, 1], c: '#a3935a', recv: true });
  const h = Math.max(0, s.y);
  objs.push({ id: 'blob', k: 'pla', p: [s.x, 0.3, -s.d], s: [5 + h * 0.06, 7 + h * 0.08, 1], c: '#1a1208', o: Math.max(0.1, 0.42 - h * 0.008) });

  const wob = mode === 'show' ? Math.sin(t * 1.3) * 0.2 : 0;
  let cam;
  if (mode === 'fp') {
    cam = { p: [pz.x, pz.y, pz.z], yaw: pz.yaw, pitch: pz.pitch, fov: FOV };
    objs.push(...propObjs(pz, s.t));
  } else {
    objs.push(...plane('me', [pz.x, pz.y, pz.z], { yaw: pz.yaw + wob * 0.3, pitch: pz.pitch, roll: s.roll * 0.8 + wob, t: t * 0.5, c: '#f4f6fb', c2: '#e8423a' }));
    cam = { p: [pz.x + 7, pz.y + 3, pz.z + 12], l: [pz.x, pz.y, pz.z], fov: 58 };
  }
  return {
    sky: { top: SKY_TOP, bottom: SKY_BOT, clouds: 12, sunC: '#fff0c0' }, fog: { c: SKY_BOT, near: 110, far: 360 },
    light: { dir: [0.3, 0.46, -0.84], sun: '#fff1d6', i: 2.7, sky: '#cfe2ff', ground: '#9a6a48', hi: 1.7 },
    shadowR: 46, objs, cam, _next: next,
  };
}

// ─── Piezas 2D (a nivel de módulo) ────────────────────────────────
function FuelPill({ fuel }) {
  const low = fuel < 25, col = low ? C.red : C.amber;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(6,8,20,0.58)', borderRadius: 14, borderWidth: 1, borderColor: alpha(col, 0.6), paddingHorizontal: 9, paddingVertical: 3 }}>
      <Text style={{ fontSize: 13, marginRight: 6 }}>⛽</Text>
      <View style={{ width: 84, height: 9, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
        <View style={{ width: `${clamp(fuel, 0, 100)}%`, height: 9, backgroundColor: col }} />
      </View>
    </View>
  );
}

// horizonte artificial: la bola de cielo/tierra se inclina con el alabeo
function Horizon({ roll, pitch }) {
  const S = 78;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: '50%', marginLeft: -S / 2, bottom: 18, width: S, height: S, borderRadius: S / 2, overflow: 'hidden', borderWidth: 3, borderColor: 'rgba(20,24,34,0.9)', backgroundColor: '#8a5a34' }}>
      <View style={{ position: 'absolute', left: -S, width: S * 3, top: -S * 2 + S / 2 + pitch * 90, height: S * 2, backgroundColor: '#4aa3f0', transform: [{ rotate: `${-roll}rad` }] }} />
      <View style={{ position: 'absolute', left: S / 2 - 22, top: S / 2 - 1.5, width: 44, height: 3, borderRadius: 2, backgroundColor: C.amber }} />
      <View style={{ position: 'absolute', left: S / 2 - 2, top: S / 2 - 6, width: 4, height: 6, backgroundColor: C.amber }} />
    </View>
  );
}

// marcador sobre el próximo anillo (o flecha en el borde si queda fuera de pantalla)
function RingMarker({ cam, s, it }) {
  if (!it) return null;
  const dist = Math.max(0, Math.round(it.z - s.d));
  const q = project(cam, [it.x, it.y, -it.z], SCREEN_W, SCREEN_H);
  const inside = q && q.x > 40 && q.x < SCREEN_W - 40 && q.y > 130 && q.y < SCREEN_H - 150;
  if (inside) {
    return (
      <View pointerEvents="none" style={{ position: 'absolute', left: q.x - 40, top: q.y - 58, width: 80, alignItems: 'center' }}>
        <Text style={{ color: C.amber, fontSize: 11, fontWeight: '900', ...tglow('#000', 4) }}>{dist} m</Text>
        <Text style={{ color: C.amber, fontSize: 22, fontWeight: '900', lineHeight: 24, ...tglow('#000', 5) }}>▼</Text>
      </View>
    );
  }
  const dx = it.x - s.x, dy = -(it.y - s.y), a = Math.atan2(dy, dx);
  const cx = SCREEN_W / 2 + Math.cos(a) * Math.min(SCREEN_W / 2 - 40, 140), cy = SCREEN_H * 0.42 + Math.sin(a) * 150;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: cx - 20, top: cy - 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: `${a + Math.PI / 2}rad` }] }}>
      <Text style={{ color: C.amber, fontSize: 30, fontWeight: '900', ...tglow('#000', 5) }}>▲</Text>
    </View>
  );
}

export function Plane3DGame({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('plane3d');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, why: '' });
  const stick = useRef({ x: 0, y: 0, on: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const menu = useRef({ s: null }).current;   // estado de la demo cinemática de los menús

  const start = () => { fx.clear(); clear3d(); const s = initState(); s.speed = 32; spawn(s); g.current = s; setPhase('play'); hx.tap(); };
  const end = (s, why) => {
    s.final = s.rings * 100 + s.bonus + Math.floor(s.d / 10); s.why = why; hx.die(); fx.shake(14, 0.5); fx.flash(why === 'fuel' ? C.amber : C.red, 0.5);
    const pos = [s.x, s.y, -s.d];
    burst3d(pos, ['#ff7a2e', '#ffd23f', '#ffffff'], 46, { speed: 11, up: 3, g: 6, size: 0.55, life: 1.2 });
    burst3d(pos, '#3a3a40', 22, { speed: 4, g: -2, size: 1.0, life: 1.8 });
    ring3d(pos, '#ffb23d', 24, { speed: 10, life: 0.7, size: 0.3 });
    setRes({ isNew: submitBest(s.final), why }); setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    s.hitFx = s.hitFx.filter(h => s.t - h < 0.5);
    s.speed = Math.min(64, 32 + s.t * 0.4);
    // stick: x = alabeo/giro · y = cabeceo (arrastrar arriba = subir)
    s.roll = lerp(s.roll, stick.x, Math.min(1, dt * 4));
    s.vx = lerp(s.vx, stick.x * 20, Math.min(1, dt * 2.5));
    s.vy = lerp(s.vy, -stick.y * 15, Math.min(1, dt * 2.5));
    s.pitch = Math.atan2(s.vy, s.speed);
    s.x += s.vx * dt; s.y = clamp(s.y + s.vy * dt, 0, 42);
    if (s.wall > 0) s.wall -= dt;
    if (Math.abs(s.x) > AV_WALL) {
      s.x = Math.sign(s.x) * AV_WALL; s.vx *= -0.5; s.fuel -= 10; s.combo = 0; hx.bad(); fx.shake(8, 0.25); fx.flash(C.orange, 0.25);
      burst3d([s.x + Math.sign(s.x) * 1.5, s.y, -s.d - 4], ['#e39a55', '#8f3f2a', '#ffffff'], 26, { speed: 8, g: 10, size: 0.4, life: 0.8 });
      s.toast = { m: '⛰️ ¡Cuidado con el cañón!', t: 1 };
    }
    if (s.y < 1.2) { end(s, 'suelo'); return; }
    s.d += s.speed * dt;
    s.fuel -= dt * (3.2 + s.t * 0.01);
    s.lowT = s.fuel < 25 ? s.lowT + dt : 0;
    if (s.fuel <= 0) { s.fuel = 0; end(s, 'fuel'); return; }
    // líneas de velocidad: puntos blancos que pasan junto a la cabina
    burst3d([s.x + rand(-9, 9), s.y + rand(-6, 6), -s.d - rand(35, 90)], '#ffffff', 1, { speed: 0.01, life: 0.8, size: 0.14, g: 0, drag: 0 });
    burst3d([s.x + rand(-7, 7), s.y + rand(-4, 5), -s.d - rand(30, 70)], '#ffe9b8', 1, { speed: 0.01, life: 0.7, size: 0.1, g: 0, drag: 0 });
    for (const o of s.items) {
      if (o.done) continue;
      const rel = o.z - s.d;
      if (o.kind === 'ring' && rel <= 0) {
        o.done = true; const d = Math.hypot(o.x - s.x, o.y - s.y);
        if (d < 3.4) {
          o.hitT = s.t; s.hitFx.push(s.t); s.rings += 1; s.combo += 1; const b = 20 * (s.combo - 1); s.bonus += b; s.fuel = Math.min(100, s.fuel + 11); hx.good(); fx.flash(C.lime, 0.14);
          burst3d([o.x, o.y, -o.z], ['#ffd23f', '#3fe0ff', '#ffffff'], 30, { speed: 8, g: 2, size: 0.3, life: 0.9 });
          ring3d([o.x, o.y, -o.z], '#ffe27a', 22, { speed: 9, life: 0.6, size: 0.24 });
          fx.pop(SCREEN_W / 2, SCREEN_H * 0.34, b ? `+100 · +${b}` : '+100', C.amber, 26);
          s.toast = { m: s.combo > 1 ? `¡ANILLO! x${s.combo}` : '¡ANILLO!', t: 0.8 };
        } else { s.combo = 0; s.toast = { m: 'Anillo perdido', t: 0.8 }; hx.warn(); }
      } else if (o.kind === 'rock' && Math.abs(rel) < o.r * 1.15 + 0.9) {
        const rad = o.r * 1.15 * Math.max(0, 1 - s.y / o.h) + 0.8;
        if (s.y < o.h && Math.hypot(o.x - s.x, rel) < rad) { end(s, 'roca'); return; }
      }
      if (rel < -14) o.done = true;
    }
    s.items = s.items.filter(o => o.z - s.d > -16);
    spawn(s);
  });

  const s = g.current;
  const sc = s.final != null ? s.final : s.rings * 100 + s.bonus + Math.floor(s.d / 10);
  const tNow = phase === 'play' ? s.t : 0;
  const scene = buildScene(s, tNow, 'fp');
  const next = scene._next;
  const why = res.why === 'fuel' ? 'SIN COMBUSTIBLE' : res.why === 'roca' ? '¡CHOCASTE CON UNA ROCA!' : '¡TE ESTRELLASTE!';
  // demo cinemática del avión volando por el cañón (inicio) o el lugar del accidente (fin)
  const menuScene = t => {
    if (s.final != null) return buildScene({ ...s, y: Math.max(s.y, 1.4), roll: 0.5, pitch: -0.4 }, t, 'show');
    let m = menu.s; if (!m) m = menu.s = initState();
    m.d = t * 38; m.t = t; m.x = Math.sin(t * 0.5) * 8; m.vx = Math.cos(t * 0.5) * 8; m.y = 14 + Math.sin(t * 0.8) * 2.5; m.roll = Math.cos(t * 0.5) * 0.6; m.pitch = Math.cos(t * 0.8) * 0.08;
    if (m.nextZ < m.d - 60) { m.nextZ = m.d + 40; m.items = []; }
    spawn(m); m.items = m.items.filter(o => o.z - m.d > -16);
    return buildScene(m, t, 'show');
  };
  const roll = s.roll * 0.9;
  return (
    <Game3D title="AVIÓN 3D" emoji="✈️" accent={C.blue} onExit={onExit} score={sc} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={menuScene} orbit={{ r: 19, h: 3.6, speed: 0.22, ly: 0.3, drop: 2.2 }}
      hud={<><HudPill icon="⭕" value={String(s.rings)} color={C.cyan} /><HudPill icon="🔥" value={`x${s.combo}`} color={C.amber} /><FuelPill fuel={s.fuel} /></>}
      subtitle="Vuela en primera persona por un cañón de roca roja"
      lines={['Arrastra en cualquier parte de la pantalla para pilotar', 'Arriba: subir · abajo: bajar · lados: girar', 'Atraviesa los ⭕ anillos: puntos, combo y combustible', 'Esquiva las columnas de roca y no toques el suelo', '⛽ El combustible se acaba: ¡no falles anillos!']}
      result={{ won: false, isNew: res.isNew, title: why, emoji: res.why === 'fuel' ? '⛽' : '💥', subtitle: res.why === 'fuel' ? 'El motor se quedó sin gasolina' : 'El cañón no perdona', stats: [['ANILLOS', s.rings], ['DISTANCIA', `${(s.d / 1000).toFixed(2)} km`], ['COMBO', `x${s.combo}`]] }}>
      <RingMarker cam={scene.cam} s={s} it={next} />
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '17%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontWeight: '900', fontSize: 24, ...tglow('#000', 8) }}>{s.toast.m}</Text>}
      {s.fuel < 25 && <Text pointerEvents="none" style={{ position: 'absolute', top: '11%', left: 0, right: 0, textAlign: 'center', color: C.red, fontWeight: '900', fontSize: 13, opacity: Math.sin(s.lowT * 10) > 0 ? 1 : 0.3, ...tglow('#000', 6) }}>⛽ ¡COMBUSTIBLE BAJO! Pasa por los anillos</Text>}
      {/* mira */}
      <View pointerEvents="none" style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -16, marginTop: -16, width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'rgba(125,255,107,0.75)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -2, marginTop: -2, width: 4, height: 4, borderRadius: 2, backgroundColor: C.lime }} />
      <Horizon roll={roll} pitch={s.pitch} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 16, bottom: 28, alignItems: 'center', backgroundColor: 'rgba(6,8,20,0.5)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
        <Text style={{ color: C.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>ALT</Text>
        <Text style={{ color: s.y < 5 ? C.red : '#fff', fontSize: 18, fontWeight: '900' }}>{Math.round(s.y * 10)}</Text>
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', right: 16, bottom: 150, alignItems: 'center', backgroundColor: 'rgba(6,8,20,0.5)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
        <Text style={{ color: C.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>NUDOS</Text>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>{Math.round(s.speed * 4.5)}</Text>
      </View>
      <Stick3D testID="av-stick" v={stick} side="right" color={C.blue} R={60} style={{ left: 0, right: 0, top: 0, width: '100%', height: '100%' }} />
    </Game3D>
  );
}
