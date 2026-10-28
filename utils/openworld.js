/**
 * openworld.js – piezas comunes para juegos de MUNDO ABIERTO 3D (sin React).
 * Ejes del motor (utils/engine3d.js): X lateral, Y arriba, Z hacia la cámara. yaw = 0 mira hacia -Z.
 *
 * Uso típico en un juego:
 *   const hm = makeHeightmap(seed, 60);                  // terreno
 *   stepPlayer(p, stick, dt, { yaw, hm, speed: 6 });     // mover con el joystick, relativo a la cámara
 *   const cam = followCam(p, yaw, { hm });               // tercera persona   (o eyeCam para primera)
 *   objs.push(...terrainObjs(hm, p, 21, 3, colorFn));    // suelo cercano
 *   objs.push(...near(arboles, p, 26).map(toObjs));      // solo lo que está cerca (< ~300 objetos)
 */

export const forward = yaw => [-Math.sin(yaw), -Math.cos(yaw)];   // [x, z] hacia donde mira la cámara
export const right = yaw => [Math.cos(yaw), -Math.sin(yaw)];

// pseudoaleatorio reproducible
export const seeded = seed => { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

/**
 * Terreno con colinas suaves. size = lado del mapa (centro en 0,0). amp = altura de colinas.
 * island: true → el borde baja bajo el agua (y < 0).
 */
export function makeHeightmap(seed = 1, size = 60, { amp = 3, island = false } = {}) {
  const r = seeded(seed); const a = [r() * 6, r() * 6, r() * 6, r() * 6];
  const half = size / 2;
  const h = (x, z) => {
    let y = Math.sin(x * 0.13 + a[0]) * 0.5 + Math.sin(z * 0.11 + a[1]) * 0.5 + Math.sin((x + z) * 0.07 + a[2]) * 0.7 + Math.sin((x - z) * 0.21 + a[3]) * 0.25;
    y = (y + 1.2) * 0.5 * amp;
    if (island) { const d = Math.hypot(x, z) / half; y = y * Math.max(0, 1 - d * d) + (1 - d) * 2.2 - 0.9; }
    return y;
  };
  return { size, half, h };
}

/** Losas de terreno alrededor de c (columnas con la altura del suelo). Ids estables por casilla. */
export function terrainObjs(hm, c, radius = 21, step = 3, colorFn = y => (y < 0.4 ? '#e8d48b' : y < 2.4 ? '#5fae4a' : '#8a8a80'), minY = -1) {
  const out = [];
  const gx0 = Math.floor((c.x - radius) / step), gx1 = Math.floor((c.x + radius) / step);
  const gz0 = Math.floor((c.z - radius) / step), gz1 = Math.floor((c.z + radius) / step);
  for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
    const x = (gx + 0.5) * step, z = (gz + 0.5) * step;
    if (Math.abs(x) > hm.half || Math.abs(z) > hm.half) continue;
    const y = hm.h(x, z); if (y < minY) continue;
    out.push({ id: `t${gx}_${gz}`, k: 'box', p: [x, (y + minY) / 2, z], s: [step, Math.max(0.1, y - minY), step], c: colorFn(y) });
  }
  return out;
}

/** Filtra por distancia (en X/Z) para no dibujar todo el mapa. */
export const near = (list, c, r) => list.filter(o => (o.x - c.x) * (o.x - c.x) + (o.z - c.z) * (o.z - c.z) < r * r);

/**
 * Mueve al jugador p = { x, y, z, vy, ground } con el joystick (stick.x, stick.y ∈ [-1, 1]; arriba = avanzar).
 * Relativo al yaw de la cámara, con gravedad y apoyo sobre el terreno. Devuelve la distancia recorrida.
 */
export function stepPlayer(p, stick, dt, { yaw = 0, hm, speed = 6, gravity = 22, bounds, floor } = {}) {
  const f = forward(yaw), rt = right(yaw);
  const fw = -(stick.y || 0), st = stick.x || 0;
  const dx = (f[0] * fw + rt[0] * st) * speed * dt, dz = (f[1] * fw + rt[1] * st) * speed * dt;
  const ox = p.x, oz = p.z;
  p.x += dx; p.z += dz;
  const lim = bounds != null ? bounds : (hm ? hm.half - 1 : 1e9);
  p.x = Math.max(-lim, Math.min(lim, p.x)); p.z = Math.max(-lim, Math.min(lim, p.z));
  if (Math.abs(dx) + Math.abs(dz) > 1e-4) p.face = Math.atan2(-dx, -dz);
  const g = floor ? floor(p.x, p.z) : hm ? hm.h(p.x, p.z) : 0;
  p.vy = (p.vy || 0) - gravity * dt; p.y += p.vy * dt;
  if (p.y <= g) { p.y = g; p.vy = 0; p.ground = true; } else p.ground = false;
  return Math.hypot(p.x - ox, p.z - oz);
}
export const jump = (p, v = 8.5) => { if (p.ground) { p.vy = v; p.ground = false; return true; } return false; };

/** Cámara en tercera persona detrás del jugador (nunca bajo el terreno). */
export function followCam(p, yaw, { dist = 7, height = 3.6, look = 1.5, hm, fov = 62 } = {}) {
  const f = forward(yaw);
  const cx = p.x - f[0] * dist, cz = p.z - f[1] * dist;
  let cy = p.y + height; if (hm) cy = Math.max(cy, hm.h(cx, cz) + 1.2);
  return { p: [cx, cy, cz], l: [p.x + f[0] * look, p.y + 1.1, p.z + f[1] * look], fov };
}
/** Cámara en primera persona (ojos del jugador). */
export const eyeCam = (p, yaw, pitch = 0, { eye = 1.6, fov = 70 } = {}) => ({ p: [p.x, p.y + eye, p.z], yaw, pitch, fov });

// base de la cámara (adelante, derecha, arriba) para cam con l o con yaw/pitch
function camBasis(cam) {
  let f;
  if (cam.l) { f = [cam.l[0] - cam.p[0], cam.l[1] - cam.p[1], cam.l[2] - cam.p[2]]; }
  else { const y = cam.yaw || 0, pt = cam.pitch || 0; f = [-Math.sin(y) * Math.cos(pt), Math.sin(pt), -Math.cos(y) * Math.cos(pt)]; }
  const fl = Math.hypot(f[0], f[1], f[2]) || 1; f = [f[0] / fl, f[1] / fl, f[2] / fl];
  let r = [-f[2], 0, f[0]]; const rl = Math.hypot(r[0], r[2]) || 1; r = [r[0] / rl, 0, r[2] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u, t: Math.tan(((cam.fov || 60) * Math.PI) / 360) };
}

/** Punto 3D → píxeles del PlayArea (W×H). null si queda detrás de la cámara. */
export function project(cam, pt, W, H) {
  const { f, r, u, t } = camBasis(cam); const a = W / H;
  const d = [pt[0] - cam.p[0], pt[1] - cam.p[1], pt[2] - cam.p[2]];
  const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]; if (z < 0.05) return null;
  const x = d[0] * r[0] + d[1] * r[1] + d[2] * r[2], y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
  return { x: W / 2 + (x / (z * t * a)) * (W / 2), y: H / 2 - (y / (z * t)) * (H / 2), z };
}

/** Toque en píxeles → punto del plano horizontal y = y0 (para tocar el suelo). null si no lo corta. */
export function rayGround(cam, sx, sy, W, H, y0 = 0) {
  const { f, r, u, t } = camBasis(cam); const a = W / H;
  const nx = (sx / W) * 2 - 1, ny = 1 - (sy / H) * 2;
  const d = [f[0] + r[0] * nx * t * a + u[0] * ny * t, f[1] + r[1] * nx * t * a + u[1] * ny * t, f[2] + r[2] * nx * t * a + u[2] * ny * t];
  if (Math.abs(d[1]) < 1e-6) return null;
  const k = (y0 - cam.p[1]) / d[1]; if (k <= 0) return null;
  return [cam.p[0] + d[0] * k, y0, cam.p[2] + d[2] * k];
}

/** Ángulo (rad) para una flecha de brújula 2D: 0 = recto hacia delante en pantalla. */
export const compassAngle = (p, yaw, target) => {
  const f = forward(yaw), rt = right(yaw);
  const dx = target.x - p.x, dz = target.z - p.z;
  return Math.atan2(dx * rt[0] + dz * rt[1], dx * f[0] + dz * f[1]);
};
