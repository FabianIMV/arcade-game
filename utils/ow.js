/**
 * ow.js – mundo del juego "Mundo 3D": generación del mapa y alturas del terreno.
 * 0 vacío · 1 árbol · 2 roca · 3 casa · 4 torre · 5 montaña
 */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const OW_N = 64;
// 0 vacío · 1 árbol · 2 roca · 3 casa · 4 torre · 5 montaña
export const OW_H = [0, 1.7, 0.6, 1.25, 3, 2.6];
export const OW_COL = {
  trunk: [112, 72, 36], leaf: [40, 142, 62], rock: [132, 132, 142], wall: [206, 176, 132], roof: [176, 62, 52],
  tower: [150, 132, 205], band: [255, 214, 90], mount: [104, 110, 128], snow: [236, 241, 250],
};
export function owGen(seed) {
  const rnd = mulberry(seed);
  const lat = Array.from({ length: 14 * 14 }, () => rnd());
  const vn = (x, y) => { const gx = x / 5, gy = y / 5; const i = Math.floor(gx), j = Math.floor(gy), fx_ = gx - i, fy = gy - j; const g = (a, b) => lat[((b % 14 + 14) % 14) * 14 + ((a % 14 + 14) % 14)]; const sx = fx_ * fx_ * (3 - 2 * fx_), sy = fy * fy * (3 - 2 * fy); return (g(i, j) * (1 - sx) + g(i + 1, j) * sx) * (1 - sy) + (g(i, j + 1) * (1 - sx) + g(i + 1, j + 1) * sx) * sy; };
  const m = Array.from({ length: OW_N }, () => new Uint8Array(OW_N));
  const C0 = OW_N / 2;
  for (let y = 0; y < OW_N; y++) for (let x = 0; x < OW_N; x++) {
    if (x < 3 || y < 3 || x >= OW_N - 3 || y >= OW_N - 3) { m[y][x] = 5; continue; }
    const v = vn(x, y), r = rnd();
    if (v > 0.8 && r < 0.5) m[y][x] = 5;
    else if (v > 0.58 && r < 0.5) m[y][x] = 1;
    else if (r < 0.014) m[y][x] = 1;
    else if (r < 0.026) m[y][x] = 2;
  }
  const clear = (cx, cy, r) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (x > 2 && y > 2 && x < OW_N - 3 && y < OW_N - 3) m[y][x] = 0; };
  clear(C0, C0, 5);
  const villages = [];
  for (let k = 0; k < 6; k++) {
    let cx, cy, tries = 0;
    do { cx = 8 + Math.floor(rnd() * (OW_N - 16)); cy = 8 + Math.floor(rnd() * (OW_N - 16)); tries++; } while (tries < 40 && (Math.hypot(cx - C0, cy - C0) < 12 || villages.some(v => Math.hypot(v[0] - cx, v[1] - cy) < 12)));
    villages.push([cx, cy]); clear(cx, cy, 4);
    const n = 4 + Math.floor(rnd() * 3);
    for (let h = 0; h < n; h++) { const a = (h / n) * Math.PI * 2; const hx = Math.round(cx + Math.cos(a) * 3), hy = Math.round(cy + Math.sin(a) * 3); m[hy][hx] = 3; if (m[hy][hx + 1] === 0) m[hy][hx + 1] = 3; }
  }
  const towers = [];
  for (let k = 0; k < 5; k++) { const tx = 8 + Math.floor(rnd() * (OW_N - 16)), ty = 8 + Math.floor(rnd() * (OW_N - 16)); if (Math.hypot(tx - C0, ty - C0) < 9) continue; clear(tx, ty, 1); m[ty][tx] = 4; towers.push([tx, ty]); }
  // zona alcanzable desde el centro
  const reach = new Uint8Array(OW_N * OW_N); const q = [[C0, C0]]; reach[C0 * OW_N + C0] = 1; const free = [];
  while (q.length) { const [x, y] = q.pop(); free.push([x, y]); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= OW_N || ny >= OW_N || reach[ny * OW_N + nx] || m[ny][nx]) continue; reach[ny * OW_N + nx] = 1; q.push([nx, ny]); } }
  return { m, free, villages, towers };
}

// altura suave del terreno (solo visual en la versión 3D con GPU)
export const owHeight = (x, y) => {
  const edge = Math.min(1, Math.max(0, (Math.min(x, y, OW_N - x, OW_N - y) - 2) / 6));
  return (Math.sin(x * 0.21) * 0.35 + Math.sin(y * 0.17 + 1.3) * 0.35 + Math.sin((x + y) * 0.09) * 0.55) * (0.35 + 0.65 * edge);
};
