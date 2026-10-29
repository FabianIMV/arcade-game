/**
 * prefabs.js – objetos 3D listos para usar con el motor (utils/engine3d.js). Sin React.
 * Cada prefab devuelve un ARRAY de objetos del motor { id, k, p, s|n, r, c, e, o, sh, … } con ids `${id}.parte` estables.
 *
 * Firma común:  prefab(id, p, opts)   (animal y enemy: animal(id, kind, p, opts))
 *   id   : texto único y estable de ESTA instancia
 *   p    : [x, y, z]  – para seres y edificios es el punto de los PIES (suelo); para vehículos voladores, el centro
 *   opts : { yaw, pitch, roll,   rotación del conjunto (yaw 0 mira hacia -Z, igual que forward() de openworld.js)
 *            n,                  escala uniforme (1 = tamaño real en metros)
 *            t,                  reloj de animación en segundos (avanza siempre) · walk 0..1: intensidad de la marcha
 *            c,                  color principal · o: opacidad · flash: true → blanco brillante (golpe recibido)
 *            inst: 'nombre',     todas las partes se dibujan con InstancedMesh (miles de árboles/monedas)
 *            sh: false,          sin sombras · …y opciones propias de cada prefab }
 *
 * Los prefabs ESTÁTICOS (árboles, casas, rocas) se calculan UNA vez y se reutiliza el array en cada frame.
 */

const PI = Math.PI, cs = Math.cos, sn = Math.sin;

// ─── Colores y azar ───────────────────────────────────────────────
const hex2 = (c) => { if (typeof c !== 'string' || c[0] !== '#') return null; const h = c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** shade('#2f9a3e', 0.7) oscurece · shade(c, 1.3) aclara (mezcla con blanco) */
export const shade = (c, f) => { const a = hex2(c); if (!a) return c; return f <= 1 ? toHex(a.map(v => v * f)) : toHex(a.map(v => v + (255 - v) * (f - 1))); };
/** mix('#ff0000', '#0000ff', 0.5) */
export const mix = (c1, c2, t) => { const a = hex2(c1), b = hex2(c2); if (!a || !b) return c1; return toHex(a.map((v, i) => v + (b[i] - v) * t)); };
/** Número 0..1 estable a partir de un texto/número (variación por instancia sin Math.random). */
export const hash01 = (s, k = 0) => { let h = 2166136261 ^ (k * 374761393); const str = String(s); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

// ─── Matrices 3×3 (fila a fila) para componer rotaciones ──────────
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const rotX = a => [1, 0, 0, 0, cs(a), -sn(a), 0, sn(a), cs(a)];
const rotY = a => [cs(a), 0, sn(a), 0, 1, 0, -sn(a), 0, cs(a)];
const rotZ = a => [cs(a), -sn(a), 0, sn(a), cs(a), 0, 0, 0, 1];
const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8]];
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const rotXYZ = r => mul(rotX(r[0]), mul(rotY(r[1]), rotZ(r[2])));
// matriz → Euler 'XYZ' (mismo convenio que three.js)
const eul = m => {
  const y = Math.asin(Math.max(-1, Math.min(1, m[2])));
  if (Math.abs(m[2]) < 0.9999999) return [Math.atan2(-m[5], m[8]), y, Math.atan2(-m[1], m[0])];
  return [Math.atan2(m[7], m[4]), y, 0];
};
// eje largo (Y) de una pieza → apuntando en la dirección (yaw, elev): elev>0 sube, <0 cae. yaw 0 = hacia -Z
const dirRot = (yaw, elev) => mul(rotY(yaw), rotZ(-(PI / 2 - elev)));   // lleva +Y hacia fuera (+X con yaw 0, luego girado)

// ─── Constructor común ────────────────────────────────────────────
function B(id, p, o) {
  const n = o.n == null ? 1 : o.n;
  const G = (o.yaw || o.pitch || o.roll) ? mul(rotY(o.yaw || 0), mul(rotX(o.pitch || 0), rotZ(o.roll || 0))) : null;
  const out = [];
  const fl = !!o.flash;
  const add = (name, k, lp, ls, c, x) => {
    x = x || {};
    let rm = x.rm, r = x.r;
    if (!rm && !r && (k === 'pla' || k === 'ring')) r = [-PI / 2, 0, 0];
    const q = G ? mv(G, lp) : lp;
    const ob = { id: id + '.' + name, k, p: [p[0] + q[0] * n, p[1] + q[1] * n, p[2] + q[2] * n], c: fl ? '#ffffff' : c };
    if (typeof ls === 'number') ob.n = ls * n; else ob.s = [ls[0] * n, ls[1] * n, ls[2] * n];
    if (G) ob.r = eul(mul(G, rm || (r ? rotXYZ(r) : I3)));
    else if (rm) ob.r = eul(rm);
    else if (r) ob.r = r;
    if (fl) ob.e = 0.7; else if (x.e) ob.e = x.e;
    const op = (o.o != null ? o.o : 1) * (x.o != null ? x.o : 1);
    if (op < 1) ob.o = op;
    if (x.m) ob.m = x.m;
    if (x.sh !== false && o.sh !== false && !(op < 1)) ob.sh = true;
    if (o.recv) ob.recv = true;
    if (o.inst) ob.inst = o.inst;
    out.push(ob);
    return ob;
  };
  // pieza larga (cápsula/cilindro) que cuelga de una articulación (hx,hy,hz) y se balancea ang rad alrededor de X (ang>0 → el extremo va hacia delante, -Z)
  const limb = (name, hx, hy, hz, len, th, ang, c, k, x) => {
    const cy = hy - (len / 2) * cs(ang), cz = hz - (len / 2) * sn(ang);
    add(name, k || 'cap', [hx, cy, cz], [th, len, th], c, { ...(x || {}), r: [ang, 0, 0] });
    return [hx, hy - len * cs(ang), hz - len * sn(ang)];
  };
  return { add, limb, out, n, seed: o.seed != null ? o.seed : hash01(id) };
}

// ═══════════════════════════════════════════════════════════════════
// PERSONA
// ═══════════════════════════════════════════════════════════════════
/**
 * person(id, p, { skin, shirt, pants, hair, hat: 'none'|'straw'|'cap'|'pirate'|'helmet'|'crown'|'cowboy', arms (ángulo de ambos brazos: π = al cielo, 1.4 = al frente), eyeC, lean, … })
 * Altura 1.75. t + walk animan piernas y brazos.
 */
export function person(id, p, o = {}) {
  const { add, limb, out } = B(id, p, o);
  const t = o.t || 0, w = o.walk || 0;
  const skin = o.skin || '#f2c29b', shirt = o.shirt || o.c || '#2f6fd8', pants = o.pants || '#3b3f58', hair = o.hair || '#4a2f1b', shoe = '#262630';
  const sw = Math.sin(t * 10) * 0.75 * w, bob = Math.abs(Math.sin(t * 10)) * 0.045 * w + Math.sin(t * 2) * 0.006;
  const aL = o.arms != null ? o.arms : -sw * 0.9, aR = o.arms != null ? o.arms : sw * 0.9;
  const lean = o.lean || 0;   // inclina el torso/cabeza hacia delante (zombi)
  const hip = 0.84;
  let e = limb('legL', -0.13, hip, 0, 0.84, 0.24, sw, pants);
  add('shoeL', 'box', [-0.13, e[1] + 0.05, e[2] - 0.05], [0.21, 0.11, 0.34], shoe, { r: [sw, 0, 0], sh: false });
  e = limb('legR', 0.13, hip, 0, 0.84, 0.24, -sw, pants);
  add('shoeR', 'box', [0.13, e[1] + 0.05, e[2] - 0.05], [0.21, 0.11, 0.34], shoe, { r: [-sw, 0, 0], sh: false });
  add('torso', 'cap', [0, 1.15 + bob, -lean * 0.12], [0.54, 0.66, 0.32], shirt, { r: [lean, 0, 0] });
  add('belt', 'box', [0, 0.86 + bob * 0.5, 0], [0.49, 0.09, 0.3], shade(pants, 0.7), { sh: false });
  e = limb('armL', -0.36, 1.4 + bob, 0, 0.62, 0.17, aL, shirt);
  add('handL', 'sph', [e[0], e[1] - 0.02, e[2]], 0.15, skin, { sh: false });
  e = limb('armR', 0.36, 1.4 + bob, 0, 0.62, 0.17, aR, shirt);
  add('handR', 'sph', [e[0], e[1] - 0.02, e[2]], 0.15, skin, { sh: false });
  const hy = 1.64 + bob, hz = -lean * 0.3;
  add('head', 'sph', [0, hy, hz], 0.36, skin);
  add('hair', 'sph', [0, hy + 0.07, hz + 0.04], [0.385, 0.27, 0.38], hair, { sh: false });
  add('eyeL', 'box', [-0.075, hy + 0.01, hz - 0.165], [0.055, 0.07, 0.03], o.eyeC || '#1a1a22', { sh: false, e: o.eyeC ? 0.9 : 0 });
  add('eyeR', 'box', [0.075, hy + 0.01, hz - 0.165], [0.055, 0.07, 0.03], o.eyeC || '#1a1a22', { sh: false, e: o.eyeC ? 0.9 : 0 });
  const hat = o.hat || 'none', hty = hy + 0.17;
  if (hat === 'straw') { add('hat', 'cyl', [0, hty, hz], [0.78, 0.045, 0.78], '#e3c36b'); add('hat2', 'cyl', [0, hty + 0.1, hz], [0.36, 0.2, 0.36], '#e3c36b'); add('hat3', 'cyl', [0, hty + 0.05, hz], [0.375, 0.07, 0.375], o.band || '#c0392b', { sh: false }); }
  else if (hat === 'cowboy') { add('hat', 'cyl', [0, hty, hz], [0.8, 0.05, 0.8], '#7a4a26'); add('hat2', 'cyl', [0, hty + 0.12, hz], [0.38, 0.26, 0.38], '#7a4a26'); }
  else if (hat === 'cap') { add('hat', 'sph', [0, hty - 0.03, hz], [0.39, 0.25, 0.39], o.band || '#d6402f'); add('hat2', 'box', [0, hty - 0.07, hz - 0.22], [0.3, 0.04, 0.2], shade(o.band || '#d6402f', 0.8), { sh: false }); }
  else if (hat === 'pirate') { add('hat', 'box', [0, hty + 0.02, hz], [0.62, 0.11, 0.34], '#1f1f28'); add('hat2', 'cyl', [0, hty + 0.1, hz], [0.36, 0.2, 0.36], '#1f1f28'); add('hat3', 'sph', [0, hty + 0.1, hz - 0.18], 0.07, '#f2f2f2', { sh: false }); }
  else if (hat === 'helmet') add('hat', 'sph', [0, hty - 0.04, hz], [0.42, 0.34, 0.42], o.band || '#9aa5b8', { m: { r: 0.3, m: 0.6 } });
  else if (hat === 'crown') { add('hat', 'cyl', [0, hty, hz], [0.34, 0.14, 0.34], '#ffc233', { e: 0.35, m: { r: 0.3, m: 0.7 } }); add('hat2', 'cone', [0, hty + 0.12, hz], [0.2, 0.14, 0.2], '#ffc233', { e: 0.35 }); }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// VEHÍCULOS
// ═══════════════════════════════════════════════════════════════════
const CARS = {
  sedan: { w: 1.8, l: 4.2, hh: 0.55, cabW: 1.5, cabL: 2.0, cabH: 0.55, cabZ: 0.25, wr: 0.36 },
  sport: { w: 1.9, l: 4.4, hh: 0.45, cabW: 1.45, cabL: 1.7, cabH: 0.45, cabZ: 0.35, wr: 0.34 },
  suv: { w: 1.95, l: 4.5, hh: 0.8, cabW: 1.75, cabL: 2.9, cabH: 0.7, cabZ: 0.3, wr: 0.44 },
  truck: { w: 2.0, l: 5.0, hh: 0.8, cabW: 1.75, cabL: 1.5, cabH: 0.7, cabZ: -0.9, wr: 0.46 },
};
/**
 * car(id, p, { kind: 'sedan'|'sport'|'suv'|'truck', steer (rad, ruedas delanteras), spin (rad acumulados de rodadura), c, roll })
 * Largo en Z (frente en -Z), 1.8 de ancho. p = suelo bajo el centro.
 */
export function car(id, p, o = {}) {
  const { add, out } = B(id, p, o);
  const K = CARS[o.kind] || CARS.sedan, c = o.c || '#e0453a', spin = o.spin || 0, steer = o.steer || 0, wr = K.wr;
  const by = wr + 0.12;
  add('chassis', 'box', [0, by, 0], [K.w * 0.97, 0.22, K.l * 0.96], '#22232c', { sh: false });
  add('body', 'box', [0, by + 0.15 + K.hh / 2 - 0.05, 0], [K.w, K.hh, K.l], c, { m: { r: 0.35, m: 0.45 } });
  const cy = by + 0.1 + K.hh + K.cabH / 2 - 0.05;
  add('cabin', 'box', [0, cy, K.cabZ], [K.cabW, K.cabH, K.cabL], '#1c2733', { m: { r: 0.1, m: 0.7 } });
  add('roof', 'box', [0, cy + K.cabH / 2 + 0.03, K.cabZ], [K.cabW * 0.97, 0.08, K.cabL * 0.9], shade(c, 0.9));
  if (o.kind === 'truck') add('bed', 'box', [0, by + 0.15 + K.hh * 0.75, 1.5], [K.w * 0.95, 0.14, 2.0], shade(c, 0.7));
  if (o.kind === 'sport') { add('spoilerL', 'box', [-0.7, by + K.hh + 0.35, K.l / 2 - 0.2], [0.07, 0.3, 0.3], shade(c, 0.6), { sh: false }); add('spoilerR', 'box', [0.7, by + K.hh + 0.35, K.l / 2 - 0.2], [0.07, 0.3, 0.3], shade(c, 0.6), { sh: false }); add('wing', 'box', [0, by + K.hh + 0.52, K.l / 2 - 0.2], [1.9, 0.06, 0.45], shade(c, 0.6), { sh: false }); }
  if (o.kind === 'taxi') add('sign', 'box', [0, cy + K.cabH / 2 + 0.15, K.cabZ], [0.5, 0.16, 0.22], '#fff2a8', { e: 0.8, sh: false });
  const ly = by + 0.3;
  for (const sx of [-1, 1]) {
    add('hl' + sx, 'box', [sx * K.w * 0.33, ly, -K.l / 2], [0.4, 0.17, 0.08], '#fff6c8', { e: 0.9, sh: false });
    add('tl' + sx, 'box', [sx * K.w * 0.33, ly, K.l / 2], [0.4, 0.15, 0.08], '#ff2030', { e: 0.8, sh: false });
  }
  add('bumperF', 'box', [0, by - 0.05, -K.l / 2 - 0.02], [K.w * 0.98, 0.14, 0.14], '#2a2a33', { sh: false });
  add('bumperB', 'box', [0, by - 0.05, K.l / 2 + 0.02], [K.w * 0.98, 0.14, 0.14], '#2a2a33', { sh: false });
  for (const [sx, sz, f] of [[-1, -1, 1], [1, -1, 1], [-1, 1, 0], [1, 1, 0]]) {
    const rm = mul(rotY(f ? steer : 0), mul(rotX(spin), rotZ(PI / 2)));
    const pos = [sx * (K.w / 2 - 0.1), wr, sz * K.l * 0.3];
    add('w' + sx + sz, 'cyl', pos, [wr * 2, 0.34, wr * 2], '#16161c', { rm });
    add('h' + sx + sz, 'cyl', [pos[0] + sx * 0.03, pos[1], pos[2]], [wr * 1.1, 0.36, wr * 1.1], '#c9ced8', { rm, m: { r: 0.3, m: 0.8 }, sh: false });
  }
  return out;
}

/** moto(id, p, { c, spin, steer, roll (inclinación en curva), rider: true|'#color casco' }) – largo en Z, frente -Z. */
export function moto(id, p, o = {}) {
  const { add, out } = B(id, p, o);
  const c = o.c || '#e0453a', spin = o.spin || 0, steer = o.steer || 0, wr = 0.37;
  for (const [nm, z, f] of [['wF', -0.82, 1], ['wB', 0.82, 0]]) {
    const rm = mul(rotY(f ? steer : 0), mul(rotX(spin), rotZ(PI / 2)));
    add(nm, 'cyl', [0, wr, z], [wr * 2, 0.18, wr * 2], '#16161c', { rm });
    add(nm + 'h', 'cyl', [0, wr, z], [wr * 1.1, 0.2, wr * 1.1], '#c9ced8', { rm, m: { r: 0.3, m: 0.8 }, sh: false });
  }
  add('engine', 'box', [0, 0.55, 0.05], [0.32, 0.38, 0.55], '#2a2a33');
  add('frame', 'box', [0, 0.75, 0.2], [0.14, 0.2, 1.1], shade(c, 0.6));
  add('tank', 'cap', [0, 0.98, -0.2], [0.36, 0.62, 0.34], c, { rm: rotX(PI / 2), m: { r: 0.3, m: 0.5 } });
  add('seat', 'box', [0, 0.93, 0.5], [0.3, 0.12, 0.66], '#1d1d24', { sh: false });
  add('fork', 'box', [0, 0.72, -0.84], [0.08, 0.86, 0.1], '#aab0bd', { r: [-0.28, 0, 0], m: { r: 0.3, m: 0.8 }, sh: false });
  add('bar', 'box', [0, 1.14, -0.72], [0.82, 0.06, 0.06], '#1d1d24', { sh: false });
  add('light', 'sph', [0, 0.98, -0.98], 0.22, '#fff6c8', { e: 0.9, sh: false });
  add('tail', 'box', [0, 0.95, 0.95], [0.18, 0.1, 0.1], '#ff2030', { e: 0.8, sh: false });
  add('pipe', 'cyl', [0.22, 0.42, 0.6], [0.1, 0.9, 0.1], '#b8bdc9', { rm: rotX(PI / 2), m: { r: 0.3, m: 0.9 }, sh: false });
  if (o.rider) {
    const rc = typeof o.rider === 'string' ? o.rider : '#2f6fd8';
    add('rTorso', 'cap', [0, 1.38, 0.18], [0.46, 0.62, 0.3], '#22262e', { r: [-0.75, 0, 0] });
    add('rHead', 'sph', [0, 1.78, -0.12], 0.34, rc, { m: { r: 0.25, m: 0.4 } });
    add('rVisor', 'box', [0, 1.77, -0.28], [0.26, 0.1, 0.08], '#10151c', { e: 0.3, sh: false });
    for (const sx of [-1, 1]) {
      add('rArm' + sx, 'cap', [sx * 0.3, 1.3, -0.38], [0.14, 0.62, 0.14], '#22262e', { r: [1.15, 0, sx * 0.15] });
      add('rLeg' + sx, 'cap', [sx * 0.22, 0.9, 0.15], [0.2, 0.7, 0.2], '#2a3550', { r: [-0.9, 0, 0] });
    }
  }
  return out;
}

/** ship(id, p, { c, c2 (acento), thrust 0..1 (llama), t }) – nave espacial de combate, frente -Z. p = centro. */
export function ship(id, p, o = {}) {
  const { add, out } = B(id, p, o);
  const c = o.c || '#cfd6e8', c2 = o.c2 || '#ff4d6d', th = o.thrust != null ? o.thrust : 0.7, t = o.t || 0;
  const fl = th * (0.8 + 0.2 * Math.sin(t * 40));
  add('hull', 'cap', [0, 0, 0.1], [0.85, 2.7, 0.62], c, { rm: rotX(PI / 2), m: { r: 0.3, m: 0.5 } });
  add('nose', 'cone', [0, 0, -1.9], [0.5, 1.1, 0.4], shade(c, 0.85), { rm: rotX(-PI / 2), m: { r: 0.3, m: 0.5 } });
  add('cockpit', 'sph', [0, 0.26, -0.55], [0.52, 0.4, 1.0], '#5fe9ff', { e: 0.55, m: { r: 0.1, m: 0.5 }, sh: false });
  for (const sx of [-1, 1]) {
    add('wing' + sx, 'box', [sx * 1.15, -0.06, 0.45], [1.7, 0.09, 1.25], c, { r: [0, sx * 0.35, sx * -0.08], m: { r: 0.35, m: 0.5 } });
    add('tip' + sx, 'box', [sx * 1.95, -0.04, 0.78], [0.14, 0.2, 1.0], c2, { r: [0, sx * 0.35, 0], e: 0.35 });
    add('eng' + sx, 'cyl', [sx * 0.42, -0.02, 1.35], [0.34, 0.7, 0.34], '#3a3f52', { rm: rotX(PI / 2), m: { r: 0.4, m: 0.7 } });
    if (th > 0.02) add('flame' + sx, 'cone', [sx * 0.42, -0.02, 1.7 + 0.45 * fl], [0.3, 0.9 * fl + 0.1, 0.3], '#ffb23d', { rm: rotX(PI / 2), e: 1, sh: false });
  }
  add('fin', 'box', [0, 0.38, 1.0], [0.08, 0.6, 0.75], c2, { r: [-0.25, 0, 0] });
  return out;
}

/** plane(id, p, { c, c2, t (hélice) }) – avioneta de hélice, frente -Z. p = centro. Usa pitch/roll del conjunto para virar. */
export function plane(id, p, o = {}) {
  const { add, out } = B(id, p, o);
  const c = o.c || '#e8ecf5', c2 = o.c2 || '#d6402f', t = o.t || 0;
  add('fus', 'cap', [0, 0, 0.2], [0.92, 3.5, 0.9], c, { rm: rotX(PI / 2), m: { r: 0.4, m: 0.3 } });
  add('cowl', 'cyl', [0, 0, -1.6], [0.9, 0.32, 0.9], c2, { rm: rotX(PI / 2) });
  add('spinner', 'cone', [0, 0, -1.9], [0.3, 0.3, 0.3], '#c9ced8', { rm: rotX(-PI / 2), m: { r: 0.3, m: 0.8 }, sh: false });
  add('wing', 'box', [0, -0.12, -0.2], [4.8, 0.1, 1.0], c, { m: { r: 0.4, m: 0.3 } });
  add('wingstripe', 'box', [0, -0.07, -0.2], [4.82, 0.02, 0.3], c2, { sh: false });
  add('stab', 'box', [0, 0.05, 1.75], [1.8, 0.07, 0.55], c);
  add('fin', 'box', [0, 0.42, 1.7], [0.08, 0.8, 0.7], c2, { r: [-0.2, 0, 0] });
  add('canopy', 'sph', [0, 0.38, -0.2], [0.62, 0.45, 1.1], '#6fd0ff', { e: 0.25, m: { r: 0.05, m: 0.6 }, sh: false });
  add('gear', 'box', [0, -0.45, -0.5], [1.2, 0.07, 0.07], '#2a2a33', { sh: false });
  for (const sx of [-0.6, 0.6]) add('wheel' + sx, 'cyl', [sx, -0.58, -0.5], [0.34, 0.1, 0.34], '#16161c', { rm: rotZ(PI / 2), sh: false });
  const a = t * 45;
  add('blade1', 'box', [0, 0, -1.95], [0.14, 1.9, 0.04], '#2a2a33', { rm: rotZ(a), sh: false });
  add('blade2', 'box', [0, 0, -1.95], [0.14, 1.9, 0.04], '#2a2a33', { rm: rotZ(a + PI / 2), sh: false });
  add('disc', 'cyl', [0, 0, -1.96], [1.9, 0.01, 1.9], '#ffffff', { rm: rotX(PI / 2), o: 0.14, sh: false });
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// NATURALEZA
// ═══════════════════════════════════════════════════════════════════
/**
 * tree(id, p, { kind: 'pine'|'palm'|'oak'|'birch'|'dead'|'cactus', h (factor de altura), leaf (color de hojas), snow, seed })
 * Variación por id (altura, giro, inclinación). pine ≈ 4 piezas · oak 5 · palm 19 · usa inst:'arboles' para bosques.
 */
export function tree(id, p, o = {}) {
  const kind = o.kind || 'pine', hv = (o.h != null ? o.h : 1) * (0.85 + hash01(id, 1) * 0.35);
  const yw = hash01(id, 2) * PI * 2;
  const { add, out } = B(id, p, { ...o, n: (o.n == null ? 1 : o.n) * hv, yaw: (o.yaw || 0) + yw });
  const A = add;
  if (kind === 'pine') {
    const g = o.leaf || '#2d7a3e', sn1 = o.snow ? '#f4f8ff' : null;
    A('trunk', 'cyl', [0, 0.55, 0], [0.34, 1.1, 0.34], '#6b4524', { sh: true });
    A('c1', 'cone', [0, 1.7, 0], [2.5, 1.7, 2.5], shade(g, 0.85));
    A('c2', 'cone', [0, 2.65, 0], [2.0, 1.5, 2.0], g);
    A('c3', 'cone', [0, 3.5, 0], [1.4, 1.3, 1.4], sn1 || shade(g, 1.12));
  } else if (kind === 'oak' || kind === 'birch') {
    const g = o.leaf || (kind === 'birch' ? '#8cc152' : '#3f9b45'), tk = kind === 'birch' ? '#e8e4d8' : '#6b4524';
    A('trunk', 'cyl', [0, 0.85, 0], [0.42, 1.7, 0.42], tk);
    A('l1', 'ico', [0, 2.5, 0], [2.4, 2.0, 2.4], g);
    A('l2', 'ico', [0.75, 2.0, 0.3], [1.6, 1.4, 1.6], shade(g, 0.88));
    A('l3', 'ico', [-0.7, 2.2, -0.35], [1.7, 1.5, 1.7], shade(g, 1.1));
    A('l4', 'ico', [0.1, 3.2, -0.2], [1.5, 1.2, 1.5], shade(g, 1.18));
  } else if (kind === 'dead') {
    A('trunk', 'cyl', [0, 1.1, 0], [0.38, 2.2, 0.38], '#4a3a30');
    A('b1', 'cyl', [0.5, 2.1, 0], [0.16, 1.2, 0.16], '#4a3a30', { r: [0, 0, -0.9] });
    A('b2', 'cyl', [-0.4, 1.7, 0.1], [0.14, 1.0, 0.14], '#4a3a30', { r: [0, 0, 0.9] });
  } else if (kind === 'cactus') {
    const g = o.leaf || '#4aa05a';
    A('body', 'cap', [0, 1.1, 0], [0.55, 2.2, 0.55], g);
    A('a1', 'cap', [0.45, 1.3, 0], [0.3, 0.9, 0.3], g, { r: [0, 0, -0.0] });
    A('a1b', 'cap', [0.3, 1.0, 0], [0.3, 0.5, 0.3], g, { r: [0, 0, PI / 2] });
    A('a2', 'cap', [-0.45, 1.6, 0], [0.28, 0.8, 0.28], g);
    A('a2b', 'cap', [-0.3, 1.3, 0], [0.28, 0.5, 0.28], g, { r: [0, 0, PI / 2] });
  } else {   // palm
    const lean = (hash01(id, 3) - 0.5) * 0.5, g = o.leaf || '#35a047';
    let x = 0, y = 0;
    const segs = 3, sl = 1.0;
    for (let i = 0; i < segs; i++) {
      const ang = lean * (0.4 + i * 0.5);
      const cx = x + Math.sin(ang) * sl / 2, cy = y + Math.cos(ang) * sl / 2;
      A('t' + i, 'cyl', [cx, cy, 0], [0.34 - i * 0.05, sl * 1.02, 0.34 - i * 0.05], i % 2 ? '#9a6a3c' : '#8a5a32', { r: [0, 0, -ang] });
      x += Math.sin(ang) * sl; y += Math.cos(ang) * sl;
    }
    const nf = 7;
    for (let f = 0; f < nf; f++) {
      const a = (f / nf) * PI * 2 + hash01(id, 5) * 2;
      const L1 = 1.2, L2 = 1.3, e1 = 0.45, e2 = -0.55;
      const d1 = [Math.cos(a) * Math.cos(e1), Math.sin(e1), Math.sin(a) * Math.cos(e1)];
      const m1 = mul(rotY(-a), rotZ(-(PI / 2 - e1)));
      A('f' + f, 'cone', [x + d1[0] * L1 / 2, y + 0.1 + d1[1] * L1 / 2, d1[2] * L1 / 2], [1.0, L1, 0.1], f % 2 ? g : shade(g, 0.88), { rm: m1 });
      const e = [x + d1[0] * L1, y + 0.1 + d1[1] * L1, d1[2] * L1];
      const d2 = [Math.cos(a) * Math.cos(e2), Math.sin(e2), Math.sin(a) * Math.cos(e2)];
      const m2 = mul(rotY(-a), rotZ(-(PI / 2 - e2)));
      A('g' + f, 'cone', [e[0] + d2[0] * L2 / 2, e[1] + d2[1] * L2 / 2, e[2] + d2[2] * L2 / 2], [0.8, L2, 0.09], shade(g, f % 2 ? 0.8 : 1.0), { rm: m2 });
    }
    A('co1', 'sph', [x + 0.12, y - 0.02, 0.1], 0.24, '#5a3a22');
    A('co2', 'sph', [x - 0.1, y - 0.04, -0.1], 0.22, '#5a3a22');
  }
  return out;
}

/** rock(id, p, { kind: 'rock'|'crystal'|'boulder', c }) – roca de 1–3 trozos (cristales: c = color brillante). */
export function rock(id, p, o = {}) {
  const { add, out } = B(id, p, o);
  const kind = o.kind || 'rock', c = o.c || (kind === 'crystal' ? '#6ee7ff' : '#8c8f99'), sc = (o.h != null ? o.h : 1) * (0.8 + hash01(id, 1) * 0.6);
  if (kind === 'crystal') {
    for (let i = 0; i < 4; i++) {
      const a = hash01(id, 10 + i) * PI * 2, d = i ? 0.3 + hash01(id, 20 + i) * 0.25 : 0, h = (i ? 0.5 : 1.0) * sc * (0.7 + hash01(id, 30 + i) * 0.6);
      add('x' + i, 'oct', [Math.cos(a) * d * sc, h * 0.55, Math.sin(a) * d * sc], [0.45 * sc, h * 1.2, 0.45 * sc], shade(c, 0.85 + i * 0.1), { e: 0.55, r: [(hash01(id, 40 + i) - 0.5) * 0.5, a, (hash01(id, 50 + i) - 0.5) * 0.5], m: { r: 0.15, m: 0.3 } });
    }
    return out;
  }
  const big = kind === 'boulder' ? 2.2 : 1;
  add('a', 'ico', [0, 0.42 * sc * big, 0], [1.3 * sc * big, 0.95 * sc * big, 1.1 * sc * big], shade(c, 0.9 + hash01(id, 2) * 0.2), { r: [0, hash01(id, 3) * 3, 0], m: { r: 0.95, m: 0 } });
  add('b', 'ico', [0.62 * sc * big, 0.22 * sc * big, 0.25 * sc * big], [0.8 * sc * big, 0.6 * sc * big, 0.75 * sc * big], shade(c, 1.12), { r: [0, hash01(id, 4) * 3, 0.3], m: { r: 0.95, m: 0 } });
  if (hash01(id, 6) > 0.4) add('c', 'ico', [-0.5 * sc * big, 0.18 * sc * big, -0.35 * sc * big], [0.6 * sc * big, 0.45 * sc * big, 0.55 * sc * big], shade(c, 0.78), { m: { r: 0.95, m: 0 } });
  return out;
}

/** bush(id, p, { c }) – arbusto de 2 piezas; flower(id, p, {c}) – flor pequeña de 2 piezas. */
export function bush(id, p, o = {}) {
  const { add, out } = B(id, p, o); const c = o.c || '#3f9b45', sc = 0.8 + hash01(id, 1) * 0.5;
  add('a', 'ico', [0, 0.4 * sc, 0], [1.2 * sc, 0.9 * sc, 1.2 * sc], c);
  add('b', 'ico', [0.4 * sc, 0.3 * sc, 0.2 * sc], [0.8 * sc, 0.65 * sc, 0.8 * sc], shade(c, 1.15));
  return out;
}
export function flower(id, p, o = {}) {
  const { add, out } = B(id, p, o);
  add('s', 'cyl', [0, 0.14, 0], [0.04, 0.28, 0.04], '#3f8a3a', { sh: false });
  add('h', 'sph', [0, 0.3, 0], 0.16, o.c || '#ff6fa8', { sh: false });
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// EDIFICIOS
// ═══════════════════════════════════════════════════════════════════
/** house(id, p, { kind: 'cottage'|'hut'|'barn'|'tower', c (pared), roof, lit (ventanas encendidas) }) – puerta hacia -Z. p = suelo en el centro. */
export function house(id, p, o = {}) {
  const { add, out } = B(id, p, o);
  const kind = o.kind || 'cottage', lit = o.lit;
  if (kind === 'hut') {
    const c = o.c || '#d9b77c', r = o.roof || '#b98a3a';
    add('wall', 'cyl', [0, 0.9, 0], [3.0, 1.8, 3.0], c);
    add('roof', 'cone', [0, 2.5, 0], [3.9, 1.9, 3.9], r);
    add('door', 'box', [0, 0.7, -1.5], [0.8, 1.4, 0.12], '#5a3a22', { sh: false });
    add('win', 'box', [1.1, 1.1, -1.05], [0.4, 0.4, 0.12], lit ? '#ffd27a' : '#2a3a4a', { e: lit ? 0.9 : 0, sh: false });
  } else if (kind === 'barn') {
    const c = o.c || '#b8372c', r = o.roof || '#4a4a55';
    add('wall', 'box', [0, 1.8, 0], [5, 3.6, 7], c);
    add('roofA', 'box', [-1.45, 4.35, 0], [3.2, 0.2, 7.6], r, { r: [0, 0, 0.55] });
    add('roofB', 'box', [1.45, 4.35, 0], [3.2, 0.2, 7.6], r, { r: [0, 0, -0.55] });
    add('door', 'box', [0, 1.4, -3.55], [2.2, 2.8, 0.12], '#f2efe6', { sh: false });
    add('x1', 'box', [0, 1.4, -3.62], [0.14, 3.2, 0.06], c, { r: [0, 0, 0.7], sh: false });
    add('x2', 'box', [0, 1.4, -3.62], [0.14, 3.2, 0.06], c, { r: [0, 0, -0.7], sh: false });
    add('hay', 'box', [0, 3.5, -3.55], [1.2, 0.8, 0.12], '#2a2a33', { sh: false });
  } else if (kind === 'tower') {
    const c = o.c || '#9aa0ad', r = o.roof || '#6a4aa8';
    add('wall', 'cyl', [0, 3, 0], [3.0, 6, 3.0], c);
    add('top', 'cyl', [0, 6.2, 0], [3.5, 0.5, 3.5], shade(c, 0.85));
    add('roof', 'cone', [0, 7.8, 0], [3.7, 2.8, 3.7], r);
    add('door', 'box', [0, 0.9, -1.5], [1.0, 1.8, 0.14], '#5a3a22', { sh: false });
    add('win', 'box', [0, 4.2, -1.5], [0.5, 0.9, 0.14], lit ? '#ffd27a' : '#1c2733', { e: lit ? 0.9 : 0, sh: false });
    add('flag', 'box', [0.45, 9.6, 0], [0.9, 0.5, 0.05], '#d6402f', { sh: false });
    add('pole', 'cyl', [0, 9.4, 0], [0.06, 1.4, 0.06], '#2a2a33', { sh: false });
  } else {
    const c = o.c || '#efe3c8', r = o.roof || '#c0463a';
    add('base', 'box', [0, 0.15, 0], [4.3, 0.3, 3.9], '#8a8f99');
    add('wall', 'box', [0, 1.5, 0], [4, 2.4, 3.6], c);
    add('roof', 'pyr', [0, 3.35, 0], [5.0, 1.6, 4.5], r);
    add('door', 'box', [0, 1.0, -1.82], [0.95, 1.7, 0.12], '#6b4524', { sh: false });
    add('knob', 'sph', [0.28, 1.0, -1.9], 0.1, '#ffc233', { sh: false });
    for (const sx of [-1.25, 1.25]) add('win' + sx, 'box', [sx, 1.7, -1.82], [0.75, 0.7, 0.12], lit ? '#ffd27a' : '#6fb7e0', { e: lit ? 0.9 : 0.1, sh: false });
    add('chim', 'box', [1.2, 3.7, 0.6], [0.55, 1.2, 0.55], '#7a4a3a');
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// TESOROS
// ═══════════════════════════════════════════════════════════════════
/** coin(id, p, { spin (giro en rad), bob (amplitud de vaivén), t }) – moneda de oro de 0.6 de diámetro, de pie. 2 piezas. */
export function coin(id, p, o = {}) {
  const t = o.t || 0, y = (o.bob || 0) * Math.sin(t * 3 + hash01(id) * 6);
  const q = [p[0], p[1] + y, p[2]];
  const { add, out } = B(id, q, { ...o, yaw: o.spin != null ? o.spin : t * 2.5 });
  add('d', 'cyl', [0, 0, 0], [0.6, 0.09, 0.6], o.c || '#ffc233', { rm: rotX(PI / 2), e: 0.5, m: { r: 0.3, m: 0.8 } });
  add('r', 'tor', [0, 0, 0], [0.6, 0.6, 0.9], shade(o.c || '#ffc233', 0.85), { e: 0.4, m: { r: 0.3, m: 0.8 }, sh: false });
  return out;
}
/** gem(id, p, { c, spin, bob, t }) – gema de 0.6 de ancho, flota sobre p. 2 piezas. */
export function gem(id, p, o = {}) {
  const t = o.t || 0, y = (o.bob != null ? o.bob : 0.08) * Math.sin(t * 2.5 + hash01(id) * 6);
  const { add, out } = B(id, [p[0], p[1] + y + 0.4, p[2]], { ...o, yaw: o.spin != null ? o.spin : t * 1.6 });
  const c = o.c || '#4de1ff';
  add('g', 'oct', [0, 0, 0], [0.6, 0.85, 0.6], c, { e: 0.6, m: { r: 0.1, m: 0.3 } });
  add('core', 'oct', [0, 0, 0], [0.26, 0.4, 0.26], '#ffffff', { e: 1, sh: false });
  return out;
}
/** chest(id, p, { open 0..1 (tapa), c (madera), glow }) – cofre del tesoro 1.1 × 0.55 × 0.75, frente -Z. 9 piezas. */
export function chest(id, p, o = {}) {
  const { add, out } = B(id, p, o);
  const op = Math.max(0, Math.min(1, o.open || 0)), wood = o.c || '#a8692a', gold = '#ffc233', dark = shade(wood, 0.7);
  const ph = op * 1.9;   // ángulo de la tapa
  const pv = [0, 0.55, 0.375];   // bisagra (trasera)
  const lid = off => { const r = mv(rotX(ph), off); return [pv[0] + r[0], pv[1] + r[1], pv[2] + r[2]]; };
  add('base', 'box', [0, 0.275, 0], [1.1, 0.55, 0.75], wood);
  add('inside', 'box', [0, 0.53, 0], [0.96, 0.04, 0.62], '#2a1608', { sh: false });
  add('bandA', 'box', [-0.32, 0.275, 0], [0.12, 0.57, 0.77], gold, { e: 0.2, m: { r: 0.3, m: 0.8 }, sh: false });
  add('bandB', 'box', [0.32, 0.275, 0], [0.12, 0.57, 0.77], gold, { e: 0.2, m: { r: 0.3, m: 0.8 }, sh: false });
  const lr = rotX(ph);
  add('lid', 'box', lid([0, 0.12, -0.39]), [1.12, 0.26, 0.78], wood, { rm: lr });
  add('lidTop', 'box', lid([0, 0.3, -0.39]), [1.04, 0.14, 0.56], shade(wood, 1.08), { rm: lr });
  add('lidA', 'box', lid([-0.32, 0.18, -0.39]), [0.12, 0.38, 0.8], gold, { rm: lr, e: 0.2, m: { r: 0.3, m: 0.8 }, sh: false });
  add('lidB', 'box', lid([0.32, 0.18, -0.39]), [0.12, 0.38, 0.8], gold, { rm: lr, e: 0.2, m: { r: 0.3, m: 0.8 }, sh: false });
  add('lock', 'box', [0, 0.5, -0.4], [0.18, 0.22, 0.06], gold, { e: 0.3, m: { r: 0.3, m: 0.8 }, sh: false });
  if (op > 0.05 || o.glow) add('heap', 'ico', [0, 0.55, 0], [0.9, 0.3, 0.55], gold, { e: 0.85, sh: false });
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// ANIMALES
// ═══════════════════════════════════════════════════════════════════
const quadLegs = (b, t, w, S) => {
  const s = Math.sin(t * 9) * 0.55 * w;
  [[-1, -1, s], [1, -1, -s], [-1, 1, -s], [1, 1, s]].forEach(([sx, sz, a]) => {
    const e = b.limb('leg' + sx + sz, sx * S.x, S.y, sz * S.z, S.len, S.th, a, S.c, 'cap');
    if (S.hoof) b.add('hoof' + sx + sz, 'box', [e[0], e[1] + 0.03, e[2] - 0.01], [S.th * 0.95, 0.08, S.th * 1.05], S.hoof, { sh: false });
  });
};
const eyes = (b, y, z, x, sz, c) => {
  b.add('eyeL', 'sph', [-x, y, z], sz, c || '#14141a', { sh: false });
  b.add('eyeR', 'sph', [x, y, z], sz, c || '#14141a', { sh: false });
};

/**
 * animal(id, kind, p, opts) – kind: 'dog'|'cow'|'sheep'|'deer'|'horse'|'pig'|'crab'|'fish'|'cat'
 * opts: { c (color del cuerpo), t, walk, … }. crab ≈ 15 piezas, dog/cow/horse 15–22, fish (p = centro) 7.
 */
export function animal(id, kind, p, o = {}) {
  const b = B(id, p, o); const { add, limb, out } = b;
  const t = o.t || 0, w = o.walk || 0, bob = Math.abs(Math.sin(t * 9)) * 0.03 * w;
  if (kind === 'dog') {
    const c = o.c || '#c98a4b', c2 = shade(c, 0.7);
    quadLegs(b, t, w, { x: 0.13, y: 0.4, z: 0.28, len: 0.4, th: 0.12, c, hoof: c2 });
    add('body', 'cap', [0, 0.52 + bob, 0], [0.4, 0.95, 0.38], c, { rm: rotX(PI / 2) });
    add('chest', 'sph', [0, 0.52 + bob, -0.3], [0.42, 0.4, 0.4], shade(c, 1.15));
    add('head', 'sph', [0, 0.72 + bob, -0.52], [0.3, 0.28, 0.32], c);
    add('snout', 'box', [0, 0.66 + bob, -0.72], [0.14, 0.12, 0.2], shade(c, 1.2));
    add('nose', 'sph', [0, 0.69 + bob, -0.83], 0.06, '#14141a', { sh: false });
    add('earL', 'box', [-0.13, 0.78 + bob, -0.5], [0.08, 0.2, 0.13], c2, { r: [0, 0, 0.35], sh: false });
    add('earR', 'box', [0.13, 0.78 + bob, -0.5], [0.08, 0.2, 0.13], c2, { r: [0, 0, -0.35], sh: false });
    eyes(b, 0.77 + bob, -0.66, 0.08, 0.05);
    const wag = Math.sin(t * 14) * 0.5 * (o.happy != null ? o.happy : 0.6 + w * 0.4);
    const R = mul(rotY(wag), rotX(-0.9)), tp = mv(R, [0, 0.16, 0]);
    add('tail', 'cap', [tp[0], 0.62 + bob + tp[1], 0.45 + tp[2]], [0.07, 0.34, 0.07], c2, { rm: R, sh: false });
  } else if (kind === 'cat') {
    const c = o.c || '#7d7d88', c2 = shade(c, 0.7);
    quadLegs(b, t, w, { x: 0.1, y: 0.3, z: 0.2, len: 0.3, th: 0.09, c });
    add('body', 'cap', [0, 0.38 + bob, 0], [0.3, 0.62, 0.28], c, { rm: rotX(PI / 2) });
    add('head', 'sph', [0, 0.5 + bob, -0.38], [0.26, 0.24, 0.24], c);
    add('earL', 'cone', [-0.08, 0.66 + bob, -0.38], [0.08, 0.12, 0.08], c2, { sh: false });
    add('earR', 'cone', [0.08, 0.66 + bob, -0.38], [0.08, 0.12, 0.08], c2, { sh: false });
    eyes(b, 0.53 + bob, -0.49, 0.06, 0.045, '#9be15d');
    add('tail', 'cap', [0, 0.55 + Math.sin(t * 3) * 0.04, 0.42], [0.06, 0.5, 0.06], c2, { r: [-0.3, 0, 0], sh: false });
  } else if (kind === 'cow') {
    const c = o.c || '#f4f1ea', sp = '#2b2b30';
    quadLegs(b, t, w, { x: 0.28, y: 0.74, z: 0.55, len: 0.74, th: 0.17, c, hoof: '#3a3a40' });
    add('body', 'cap', [0, 1.05 + bob, 0], [0.82, 1.6, 0.8], c, { rm: rotX(PI / 2) });
    add('spot1', 'ico', [0.3, 1.2 + bob, -0.2], [0.35, 0.5, 0.5], sp, { sh: false });
    add('spot2', 'ico', [-0.3, 1.1 + bob, 0.3], [0.3, 0.45, 0.55], sp, { sh: false });
    add('spot3', 'ico', [0.1, 1.45 + bob, 0.1], [0.5, 0.2, 0.45], sp, { sh: false });
    add('udder', 'sph', [0, 0.72, 0.5], [0.3, 0.2, 0.3], '#f0a3b4', { sh: false });
    add('head', 'box', [0, 1.2 + bob, -1.0], [0.46, 0.44, 0.5], c);
    add('muzzle', 'box', [0, 1.1 + bob, -1.27], [0.4, 0.26, 0.12], '#f0a3b4');
    add('hornL', 'cone', [-0.22, 1.5 + bob, -0.95], [0.08, 0.2, 0.08], '#e9e2cf', { r: [0, 0, 0.5], sh: false });
    add('hornR', 'cone', [0.22, 1.5 + bob, -0.95], [0.08, 0.2, 0.08], '#e9e2cf', { r: [0, 0, -0.5], sh: false });
    add('earL', 'box', [-0.3, 1.36 + bob, -0.9], [0.18, 0.08, 0.14], sp, { sh: false });
    add('earR', 'box', [0.3, 1.36 + bob, -0.9], [0.18, 0.08, 0.14], sp, { sh: false });
    eyes(b, 1.3 + bob, -1.22, 0.14, 0.06);
    limb('tail', 0, 1.3 + bob, 0.82, 0.7, 0.07, -0.15 + Math.sin(t * 3) * 0.15, sp, 'cap', { sh: false });
  } else if (kind === 'sheep') {
    const c = o.c || '#f1eee4', dk = '#3a3a40';
    quadLegs(b, t, w, { x: 0.18, y: 0.45, z: 0.3, len: 0.45, th: 0.1, c: dk });
    add('w1', 'ico', [0, 0.72 + bob, -0.05], [0.8, 0.7, 0.95], c, { m: { r: 1, m: 0 } });
    add('w2', 'ico', [0.2, 0.8 + bob, 0.28], [0.55, 0.5, 0.55], shade(c, 0.95), { m: { r: 1, m: 0 } });
    add('w3', 'ico', [-0.2, 0.78 + bob, 0.25], [0.55, 0.5, 0.55], shade(c, 1.05), { m: { r: 1, m: 0 } });
    add('head', 'sph', [0, 0.78 + bob, -0.55], [0.26, 0.3, 0.32], dk);
    add('wcap', 'ico', [0, 0.93 + bob, -0.45], [0.32, 0.18, 0.3], c, { sh: false });
    add('earL', 'box', [-0.17, 0.8 + bob, -0.52], [0.16, 0.06, 0.1], dk, { r: [0, 0, 0.3], sh: false });
    add('earR', 'box', [0.17, 0.8 + bob, -0.52], [0.16, 0.06, 0.1], dk, { r: [0, 0, -0.3], sh: false });
    eyes(b, 0.82 + bob, -0.68, 0.08, 0.045, '#f4f4f4');
  } else if (kind === 'deer') {
    const c = o.c || '#a8703c', c2 = '#f1e6cf';
    quadLegs(b, t, w, { x: 0.15, y: 0.9, z: 0.42, len: 0.9, th: 0.1, c: shade(c, 0.85), hoof: '#2a2018' });
    add('body', 'cap', [0, 1.1 + bob, 0], [0.5, 1.25, 0.46], c, { rm: rotX(PI / 2) });
    add('belly', 'cap', [0, 0.98 + bob, 0], [0.42, 1.1, 0.26], c2, { rm: rotX(PI / 2), sh: false });
    add('neck', 'cap', [0, 1.55 + bob, -0.62], [0.2, 0.7, 0.2], c, { r: [-0.5, 0, 0] });
    add('head', 'sph', [0, 1.88 + bob, -0.85], [0.26, 0.26, 0.38], c);
    add('snout', 'box', [0, 1.83 + bob, -1.05], [0.12, 0.12, 0.16], c2);
    add('earL', 'box', [-0.16, 1.98 + bob, -0.78], [0.14, 0.06, 0.1], c, { r: [0, 0, 0.5], sh: false });
    add('earR', 'box', [0.16, 1.98 + bob, -0.78], [0.14, 0.06, 0.1], c, { r: [0, 0, -0.5], sh: false });
    for (const sx of [-1, 1]) {
      add('ant' + sx, 'cyl', [sx * 0.14, 2.18 + bob, -0.8], [0.04, 0.5, 0.04], '#d8c7a0', { r: [0, 0, -sx * 0.4], sh: false });
      add('antb' + sx, 'cyl', [sx * 0.3, 2.3 + bob, -0.86], [0.035, 0.3, 0.035], '#d8c7a0', { r: [0.5, 0, -sx * 0.9], sh: false });
    }
    eyes(b, 1.92 + bob, -0.95, 0.1, 0.045);
    add('tail', 'sph', [0, 1.3 + bob, 0.66], [0.14, 0.16, 0.12], c2, { sh: false });
  } else if (kind === 'horse') {
    const c = o.c || '#7a4a2a', mane = shade(c, 0.45);
    quadLegs(b, t, w, { x: 0.2, y: 1.0, z: 0.5, len: 1.0, th: 0.14, c, hoof: '#1f1a16' });
    add('body', 'cap', [0, 1.3 + bob, 0], [0.7, 1.5, 0.66], c, { rm: rotX(PI / 2) });
    add('neck', 'cap', [0, 1.8 + bob, -0.78], [0.3, 0.9, 0.3], c, { r: [-0.55, 0, 0] });
    add('head', 'box', [0, 2.2 + bob, -1.12], [0.26, 0.3, 0.6], c, { r: [-0.45, 0, 0] });
    add('muzzle', 'box', [0, 2.02 + bob, -1.38], [0.22, 0.2, 0.18], shade(c, 1.2), { r: [-0.45, 0, 0], sh: false });
    for (let i = 0; i < 4; i++) add('mane' + i, 'box', [0, 2.2 - i * 0.2 + bob, -0.8 + i * 0.13 - 0.1], [0.07, 0.28, 0.16], mane, { r: [0.6, 0, 0], sh: false });
    add('earL', 'cone', [-0.1, 2.38 + bob, -1.0], [0.08, 0.16, 0.08], c, { sh: false });
    add('earR', 'cone', [0.1, 2.38 + bob, -1.0], [0.08, 0.16, 0.08], c, { sh: false });
    eyes(b, 2.2 + bob, -1.2, 0.14, 0.05);
    limb('tail', 0, 1.55 + bob, 0.8, 0.9, 0.12, -0.3 + Math.sin(t * 4) * 0.2, mane, 'cap', { sh: false });
  } else if (kind === 'pig') {
    const c = o.c || '#f2a3b3';
    quadLegs(b, t, w, { x: 0.2, y: 0.28, z: 0.3, len: 0.28, th: 0.13, c: shade(c, 0.9) });
    add('body', 'cap', [0, 0.5 + bob, 0], [0.66, 1.0, 0.62], c, { rm: rotX(PI / 2) });
    add('head', 'sph', [0, 0.55 + bob, -0.6], [0.4, 0.38, 0.38], c);
    add('snout', 'cyl', [0, 0.5 + bob, -0.82], [0.2, 0.1, 0.18], shade(c, 1.1), { rm: rotX(PI / 2) });
    add('earL', 'cone', [-0.15, 0.78 + bob, -0.58], [0.13, 0.16, 0.1], shade(c, 0.9), { r: [0, 0, 0.4], sh: false });
    add('earR', 'cone', [0.15, 0.78 + bob, -0.58], [0.13, 0.16, 0.1], shade(c, 0.9), { r: [0, 0, -0.4], sh: false });
    eyes(b, 0.62 + bob, -0.76, 0.12, 0.045);
    add('tail', 'tor', [0, 0.62 + bob, 0.52], 0.14, shade(c, 0.9), { sh: false });
  } else if (kind === 'crab') {
    const c = o.c || '#e2553a', c2 = shade(c, 0.78), s = Math.sin(t * 14) * 0.5 * w;
    add('body', 'sph', [0, 0.3, 0], [0.9, 0.42, 0.7], c);
    add('shell', 'sph', [0, 0.38, 0.02], [0.7, 0.28, 0.55], shade(c, 1.12), { sh: false });
    for (const sx of [-1, 1]) {
      add('stalk' + sx, 'cyl', [sx * 0.17, 0.55, -0.22], [0.04, 0.2, 0.04], c2, { sh: false });
      add('eye' + sx, 'sph', [sx * 0.17, 0.68, -0.22], 0.13, '#ffffff', { sh: false });
      add('pupil' + sx, 'sph', [sx * 0.17, 0.69, -0.29], 0.06, '#14141a', { sh: false });
      const open = 0.25 + (o.snap != null ? o.snap : Math.sin(t * 3 + sx) * 0.2);
      add('arm' + sx, 'cap', [sx * 0.46, 0.3, -0.34], [0.1, 0.34, 0.1], c2, { r: [1.2, 0, sx * 0.9], sh: false });
      add('claw' + sx, 'sph', [sx * 0.64, 0.32, -0.55], [0.34, 0.2, 0.3], c);
      add('pinch' + sx, 'cone', [sx * 0.6 - sx * open * 0.1, 0.35, -0.74], [0.1, 0.2, 0.1], c2, { r: [-PI / 2, 0, 0], sh: false });
      for (let i = 0; i < 3; i++) {
        const ph = i * 1.3 + (sx > 0 ? PI : 0);
        add('leg' + sx + i, 'cap', [sx * 0.5, 0.17, 0.12 + i * 0.17 - 0.1 + Math.sin(t * 14 + ph) * 0.05 * w], [0.06, 0.4, 0.06], c2, { r: [s * 0.2, 0, sx * 1.1], sh: false });
      }
    }
  } else if (kind === 'fish') {
    const c = o.c || '#ff9f43', wig = Math.sin(t * 9) * 0.35;
    add('body', 'sph', [0, 0, 0], [0.42, 0.42, 0.95], c);
    add('belly', 'sph', [0, -0.07, -0.05], [0.34, 0.26, 0.8], shade(c, 1.4), { sh: false });
    add('tail', 'cone', [Math.sin(wig) * 0.1, 0, 0.62], [0.34, 0.45, 0.06], shade(c, 0.85), { rm: mul(rotY(wig), rotX(-PI / 2)), sh: false });
    add('fin', 'box', [0, 0.26, 0], [0.04, 0.2, 0.3], shade(c, 0.85), { sh: false });
    eyes(b, 0.07, -0.34, 0.14, 0.06, '#14141a');
    add('stripe', 'sph', [0, 0, -0.1], [0.44, 0.44, 0.08], '#ffffff', { sh: false });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// ENEMIGOS
// ═══════════════════════════════════════════════════════════════════
/**
 * enemy(id, kind, p, opts) – kind: 'zombi'|'robot'|'ovni'|'fantasma'|'slime'
 * zombi/robot/slime: p = pies · ovni: p = centro (opts.beam: true → rayo tractor) · fantasma: p = suelo (flota solo)
 * opts: { t, walk, c, flash, o … } – t anima flotación/rebote/luces.
 */
export function enemy(id, kind, p, o = {}) {
  const t = o.t || 0, w = o.walk != null ? o.walk : 0.6;
  if (kind === 'zombi') {
    const sw = Math.sin(t * 6) * 0.2;
    return person(id, p, { ...o, skin: o.skin || '#7fae63', shirt: o.shirt || '#5a6a8a', pants: o.pants || '#4a4a5a', hair: '#2b3a22', arms: 1.35 + sw * 0.3, lean: 0.25, eyeC: '#ff3030', walk: w * 0.55, t: o.t });
  }
  const { add, limb, out } = B(id, p, o);
  if (kind === 'robot') {
    const c = o.c || '#9aa5b8', a = '#ff6b3d', sw = Math.sin(t * 8) * 0.5 * w, bob = Math.abs(Math.sin(t * 8)) * 0.03 * w;
    limb('legL', -0.2, 0.7, 0, 0.7, 0.2, sw, '#59606e', 'cyl');
    limb('legR', 0.2, 0.7, 0, 0.7, 0.2, -sw, '#59606e', 'cyl');
    add('footL', 'box', [-0.2, 0.06, -0.06 - sw * 0.4], [0.3, 0.12, 0.44], '#3a3f4c', { sh: false });
    add('footR', 'box', [0.2, 0.06, -0.06 + sw * 0.4], [0.3, 0.12, 0.44], '#3a3f4c', { sh: false });
    add('body', 'box', [0, 1.15 + bob, 0], [0.78, 0.82, 0.52], c, { m: { r: 0.3, m: 0.7 } });
    add('chest', 'box', [0, 1.2 + bob, -0.27], [0.4, 0.3, 0.04], a, { e: 0.7 + Math.sin(t * 5) * 0.2, sh: false });
    limb('armL', -0.5, 1.45 + bob, 0, 0.7, 0.16, -sw, '#59606e', 'cyl');
    limb('armR', 0.5, 1.45 + bob, 0, 0.7, 0.16, sw, '#59606e', 'cyl');
    add('head', 'box', [0, 1.8 + bob, 0], [0.55, 0.42, 0.46], c, { m: { r: 0.3, m: 0.7 } });
    add('visor', 'box', [0, 1.82 + bob, -0.24], [0.44, 0.12, 0.04], '#38f0ff', { e: 1, sh: false });
    add('ant', 'cyl', [0.18, 2.1 + bob, 0], [0.04, 0.3, 0.04], '#59606e', { sh: false });
    add('bulb', 'sph', [0.18, 2.28 + bob, 0], 0.1, '#ff2a2a', { e: 0.6 + 0.4 * Math.sin(t * 6), sh: false });
  } else if (kind === 'ovni') {
    const c = o.c || '#aab3c6', bob = Math.sin(t * 2) * 0.15, tilt = Math.sin(t * 1.3) * 0.12;
    const { add: ad, out: ou } = B(id, [p[0], p[1] + bob, p[2]], { ...o, roll: (o.roll || 0) + tilt });
    ad('disc', 'sph', [0, 0, 0], [2.6, 0.62, 2.6], c, { m: { r: 0.25, m: 0.8 } });
    ad('dome', 'sph', [0, 0.28, 0], [1.2, 0.95, 1.2], '#7fe9ff', { o: 0.7, e: 0.35, sh: false });
    ad('alien', 'sph', [0, 0.32, 0], 0.4, '#7be36b', { sh: false });
    ad('eyeA', 'sph', [-0.1, 0.36, -0.15], 0.1, '#14141a', { sh: false });
    ad('eyeB', 'sph', [0.1, 0.36, -0.15], 0.1, '#14141a', { sh: false });
    ad('under', 'sph', [0, -0.28, 0], [0.9, 0.3, 0.9], '#ff4de2', { e: 0.9, sh: false });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2 + t * 1.5; ad('l' + i, 'sph', [Math.cos(a) * 1.18, -0.02, Math.sin(a) * 1.18], 0.14, i % 2 ? '#ffe45e' : '#ff4d6d', { e: 1, sh: false }); }
    if (o.beam) ad('beam', 'cone', [0, -1.7, 0], [2.0, 3.2, 2.0], '#fff6a0', { rm: rotX(PI), o: 0.25, e: 0.9, sh: false });
    return ou;
  } else if (kind === 'fantasma') {
    const c = o.c || '#e8f0ff', y = 0.95 + Math.sin(t * 2.2) * 0.2, so = o.o != null ? o.o : 0.82;
    const { add: ad, out: ou } = B(id, [p[0], p[1] + y, p[2]], { ...o, o: so });
    ad('body', 'cap', [0, 0.2, 0], [0.95, 1.3, 0.85], c, { e: 0.45, sh: false });
    for (let i = 0; i < 5; i++) { const a = (i / 5) * PI * 2; ad('sk' + i, 'sph', [Math.cos(a) * 0.36, -0.52 + Math.sin(t * 5 + i * 1.4) * 0.08, Math.sin(a) * 0.32], 0.34, c, { e: 0.45, sh: false }); }
    ad('eyeL', 'sph', [-0.2, 0.42, -0.36], [0.17, 0.26, 0.1], '#14141f', { sh: false, o: 1 });
    ad('eyeR', 'sph', [0.2, 0.42, -0.36], [0.17, 0.26, 0.1], '#14141f', { sh: false, o: 1 });
    ad('mouth', 'sph', [0, 0.1, -0.38], [0.2, 0.28, 0.08], '#14141f', { sh: false, o: 1 });
    ad('armL', 'cap', [-0.58, 0.1, -0.1], [0.2, 0.55, 0.2], c, { r: [0, 0, 0.8 + Math.sin(t * 3) * 0.2], e: 0.45, sh: false });
    ad('armR', 'cap', [0.58, 0.1, -0.1], [0.2, 0.55, 0.2], c, { r: [0, 0, -0.8 - Math.sin(t * 3) * 0.2], e: 0.45, sh: false });
    return ou;
  } else if (kind === 'slime') {
    const c = o.c || '#6fe05b', bn = Math.abs(Math.sin(t * 3)), sq = 1 + 0.18 * (1 - bn) - 0.1 * bn;
    const { add: ad, out: ou } = B(id, [p[0], p[1] + bn * 0.3, p[2]], o);
    ad('body', 'sph', [0, 0.5 / sq, 0], [1.25 * sq, 1.0 / sq, 1.25 * sq], c, { o: 0.82, e: 0.2, m: { r: 0.15, m: 0.1 } });
    ad('core', 'sph', [0, 0.45, 0.1], 0.5, shade(c, 0.55), { o: 0.6, sh: false });
    ad('shine', 'sph', [-0.3, 0.8 / sq, -0.28], [0.22, 0.14, 0.12], '#ffffff', { e: 0.8, sh: false });
    ad('eyeL', 'sph', [-0.2, 0.55 / sq, -0.55 * sq], 0.2, '#ffffff', { sh: false });
    ad('eyeR', 'sph', [0.2, 0.55 / sq, -0.55 * sq], 0.2, '#ffffff', { sh: false });
    ad('pupL', 'sph', [-0.2, 0.55 / sq, -0.64 * sq], 0.1, '#14141a', { sh: false });
    ad('pupR', 'sph', [0.2, 0.55 / sq, -0.64 * sq], 0.1, '#14141a', { sh: false });
    return ou;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// DRAGÓN
// ═══════════════════════════════════════════════════════════════════
/**
 * dragon(id, p, { c, belly, wing (color membrana), t (aleteo), flap (velocidad, 1 = normal), fire 0..1 }) – frente -Z, p = centro del pecho.
 * Largo ≈ 9 (con cola) · envergadura ≈ 9 · ~40 piezas (usar solo unos pocos a la vez).
 */
export function dragon(id, p, o = {}) {
  const { add, out } = B(id, p, o);
  const c = o.c || '#c0392b', belly = o.belly || '#f1c27a', wc = o.wing || shade(c, 0.7), t = o.t || 0, fl = (o.flap != null ? o.flap : 1);
  const fp = Math.sin(t * 5 * fl) * 0.55;
  add('chest', 'ico', [0, 0, 0], [1.7, 1.5, 2.2], c);
  add('belly', 'ico', [0, -0.28, -0.1], [1.2, 0.9, 1.9], belly, { sh: false });
  add('hip', 'ico', [0, -0.05, 1.5], [1.25, 1.1, 1.6], shade(c, 0.92));
  // cuello y cabeza
  const nk = [[0, 0.5, -1.2, 0.85], [0, 0.95, -1.9, 0.7], [0, 1.25, -2.5, 0.62]];
  nk.forEach((q, i) => add('neck' + i, 'sph', [q[0], q[1] + Math.sin(t * 2 + i) * 0.04, q[2]], q[3], i % 2 ? shade(c, 1.06) : c));
  const hy = 1.38 + Math.sin(t * 2 + 3) * 0.04;
  add('head', 'box', [0, hy, -3.25], [0.8, 0.62, 1.1], c);
  add('snout', 'box', [0, hy - 0.08, -3.9], [0.55, 0.38, 0.5], shade(c, 1.1));
  add('jaw', 'box', [0, hy - 0.4 - (o.fire || 0) * 0.15, -3.6], [0.5, 0.14, 0.9], shade(c, 0.8), { sh: false });
  for (const sx of [-1, 1]) {
    add('horn' + sx, 'cone', [sx * 0.3, hy + 0.5, -3.0], [0.16, 0.6, 0.16], '#efe6cf', { r: [-0.6, 0, -sx * 0.25], sh: false });
    add('eye' + sx, 'sph', [sx * 0.32, hy + 0.1, -3.65], 0.16, '#ffe14d', { e: 1, sh: false });
    add('nost' + sx, 'sph', [sx * 0.14, hy + 0.04, -4.15], 0.08, '#2a1410', { sh: false });
  }
  // alas: hueso + membrana, con plegado
  for (const sx of [-1, 1]) {
    const el1 = 0.35 + fp, el2 = el1 + fp * 0.6 - 0.25, L1 = 2.4, L2 = 2.6;
    const b1 = [sx * 0.7 + sx * Math.cos(el1) * L1 / 2, 0.55 + Math.sin(el1) * L1 / 2, -0.4];
    const e1 = [sx * 0.7 + sx * Math.cos(el1) * L1, 0.55 + Math.sin(el1) * L1];
    add('wb1' + sx, 'cyl', b1, [0.2, L1, 0.2], shade(c, 0.85), { rm: rotZ(sx * (el1 - PI / 2)), sh: false });
    add('wm1' + sx, 'box', [b1[0], b1[1] - 0.05, b1[2] + 0.95], [L1, 0.05, 1.8], wc, { r: [0, 0, sx * el1], o: 0.95 });
    const b2 = [e1[0] + sx * Math.cos(el2) * L2 / 2, e1[1] + Math.sin(el2) * L2 / 2, -0.4];
    add('wb2' + sx, 'cyl', b2, [0.15, L2, 0.15], shade(c, 0.85), { rm: rotZ(sx * (el2 - PI / 2)), sh: false });
    add('wm2' + sx, 'box', [b2[0], b2[1] - 0.05, b2[2] + 0.75], [L2, 0.05, 1.5], shade(wc, 1.05), { r: [0, 0, sx * el2], o: 0.95 });
  }
  // cola ondulada
  for (let i = 0; i < 6; i++) {
    const s = 0.95 - i * 0.14, z = 2.3 + i * 0.85, x = Math.sin(t * 3 - i * 0.7) * 0.28 * (i + 1) * 0.5;
    add('tail' + i, 'ico', [x, -0.15 - i * 0.04, z], [s, s * 0.85, 1.0], i % 2 ? shade(c, 0.9) : c);
    if (i < 5) add('spk' + i, 'cone', [x, 0.3 + s * 0.4 - i * 0.04, z], [0.2, 0.38, 0.2], '#efe6cf', { sh: false });
  }
  add('tip', 'cone', [Math.sin(t * 3 - 6 * 0.7) * 0.28 * 3.4, -0.4, 7.8], [0.4, 0.8, 0.12], '#efe6cf', { rm: rotX(PI / 2), sh: false });
  for (let i = 0; i < 4; i++) add('bsp' + i, 'cone', [0, 0.85 - i * 0.05, -0.9 + i * 0.7], [0.22, 0.4, 0.22], '#efe6cf', { sh: false });
  for (const sx of [-1, 1]) add('leg' + sx, 'cap', [sx * 0.65, -0.9, 0.2], [0.34, 0.8, 0.34], shade(c, 0.85), { r: [0.5, 0, sx * 0.1], sh: false });
  if (o.fire > 0.02) {
    const f = o.fire;
    add('fire', 'cone', [0, hy - 0.1, -4.2 - 1.6 * f], [0.9 * f + 0.2, 3.2 * f + 0.2, 0.9 * f + 0.2], '#ff9d2e', { rm: rotX(-PI / 2), e: 1, o: 0.75, sh: false });
    add('fire2', 'cone', [0, hy - 0.1, -4.2 - 1.0 * f], [0.5 * f + 0.1, 2.0 * f + 0.1, 0.5 * f + 0.1], '#fff2a0', { rm: rotX(-PI / 2), e: 1, o: 0.9, sh: false });
  }
  return out;
}

/** Catálogo para galerías/pruebas: nombre → función(id, p, t) que devuelve el prefab con parámetros de muestra. */
export const PREFAB_DEMO = [
  ['person', (id, p, t) => person(id, p, { t, walk: 1, hat: 'straw' })],
  ['zombi', (id, p, t) => enemy(id, 'zombi', p, { t })],
  ['robot', (id, p, t) => enemy(id, 'robot', p, { t })],
  ['ovni', (id, p, t) => enemy(id, 'ovni', [p[0], p[1] + 1.4, p[2]], { t, beam: true })],
  ['fantasma', (id, p, t) => enemy(id, 'fantasma', p, { t })],
  ['slime', (id, p, t) => enemy(id, 'slime', p, { t })],
  ['dog', (id, p, t) => animal(id, 'dog', p, { t, walk: 1 })],
  ['cow', (id, p, t) => animal(id, 'cow', p, { t, walk: 1 })],
  ['sheep', (id, p, t) => animal(id, 'sheep', p, { t, walk: 1 })],
  ['deer', (id, p, t) => animal(id, 'deer', p, { t, walk: 1 })],
  ['horse', (id, p, t) => animal(id, 'horse', p, { t, walk: 1 })],
  ['pig', (id, p, t) => animal(id, 'pig', p, { t, walk: 1 })],
  ['cat', (id, p, t) => animal(id, 'cat', p, { t, walk: 1 })],
  ['crab', (id, p, t) => animal(id, 'crab', p, { t, walk: 1 })],
  ['fish', (id, p, t) => animal(id, 'fish', [p[0], p[1] + 0.6, p[2]], { t })],
  ['car', (id, p, t) => car(id, p, { spin: t * 6 })],
  ['sport', (id, p, t) => car(id, p, { kind: 'sport', c: '#2f6fd8', spin: t * 6 })],
  ['truck', (id, p, t) => car(id, p, { kind: 'truck', c: '#2aa86a', spin: t * 6 })],
  ['moto', (id, p, t) => moto(id, p, { spin: t * 8, rider: '#f2c233' })],
  ['ship', (id, p, t) => ship(id, [p[0], p[1] + 1, p[2]], { t })],
  ['plane', (id, p, t) => plane(id, [p[0], p[1] + 1.2, p[2]], { t, roll: Math.sin(t) * 0.3 })],
  ['pine', (id, p) => tree(id, p, { kind: 'pine' })],
  ['palm', (id, p) => tree(id, p, { kind: 'palm' })],
  ['oak', (id, p) => tree(id, p, { kind: 'oak' })],
  ['cactus', (id, p) => tree(id, p, { kind: 'cactus' })],
  ['rock', (id, p) => rock(id, p, {})],
  ['crystal', (id, p) => rock(id, p, { kind: 'crystal' })],
  ['cottage', (id, p) => house(id, p, { lit: true })],
  ['hut', (id, p) => house(id, p, { kind: 'hut' })],
  ['barn', (id, p) => house(id, p, { kind: 'barn' })],
  ['tower', (id, p) => house(id, p, { kind: 'tower', lit: true })],
  ['coin', (id, p, t) => coin(id, [p[0], p[1] + 0.5, p[2]], { t })],
  ['gem', (id, p, t) => gem(id, p, { t })],
  ['chest', (id, p, t) => chest(id, p, { open: (Math.sin(t) + 1) / 2 })],
  ['dragon', (id, p, t) => dragon(id, [p[0], p[1] + 2.5, p[2]], { t, fire: (Math.sin(t * 0.7) + 1) / 2 })],
];
