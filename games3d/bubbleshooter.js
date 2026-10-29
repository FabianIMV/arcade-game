import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { C, SCREEN_H, SCREEN_W, clamp, hx, pick, rand, randInt, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { Game3D, HudPill } from '../utils/ui3d';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { project, rayGround } from '../utils/openworld';

// BUBBLE SHOOTER 3D: tablero de burbujas brillantes sobre una mesa neón. Arrastra para apuntar,
// suelta para disparar, toca la burbuja del cañón para cambiarla. Une 3 del mismo color para
// hacerlas caer. 💣 explota alrededor · 🌈 se une a cualquier color. Si fallas varias veces, el techo baja.
// La lógica trabaja en coordenadas de tablero (px lógicos, y hacia abajo); se dibuja en 3D y el toque se
// convierte con el rayo de la cámara al plano de la mesa.
const BS_COLS = 8, BS_D = 40, BS_R = 20, BS_RH = BS_D * 0.8660254;
const W = BS_COLS * BS_D, LH = 640, CY = LH - 50;   // tablero W × LH; cañón en (W/2, CY)
const S = 1 / BS_D;                                  // 1 unidad del mundo = 1 diámetro de burbuja
const DANGER = CY - BS_D * 1.1;
const BR = BS_D * S * 0.92;                          // diámetro visible de una burbuja (unidades)
const CAM = { p: [0, 17.5, 16.5], l: [0, 0, -1.6], fov: 52 };
const PAL = ['#ff4d6d', '#22d3ee', '#a3e635', '#fbbf24', '#a78bfa', '#f472b6'];
const SKY = { top: '#07030f', bottom: '#1b0d33' };

// tablero → mundo (y = altura) y mundo → tablero (el toque)
const toW = (lx, ly, y = 0.5) => [(lx - W / 2) * S, y, (ly - LH / 2) * S];
const toL = (X, Z) => [X / S + W / 2, Z / S + LH / 2];
const px = (lx, ly, y) => project(CAM, toW(lx, ly, y), SCREEN_W, SCREEN_H) || { x: SCREEN_W / 2, y: SCREEN_H / 2 };
const touchL = (x, y) => { const p = rayGround(CAM, x, y, SCREEN_W, SCREEN_H, 0); return p ? toL(p[0], p[2]) : null; };

// Decorado estático (mesa, bordes neón, línea de peligro)
const STATICS = [
  { id: 'mesa', k: 'box', p: [0, -0.22, 0], s: [8.8, 0.4, 16.8], c: '#1c1033', recv: true },
  { id: 'bordeI', k: 'box', p: [-4.25, 0.35, 0], s: [0.22, 0.7, 16.9], c: '#ff4d8d', e: 0.6 },
  { id: 'bordeD', k: 'box', p: [4.25, 0.35, 0], s: [0.22, 0.7, 16.9], c: '#22d3ee', e: 0.6 },
  { id: 'techo', k: 'box', p: [0, 0.35, -8.35], s: [8.7, 0.7, 0.22], c: '#a78bfa', e: 0.6 },
  { id: 'peligro', k: 'box', p: [0, 0.03, (DANGER - LH / 2) * S], s: [8.0, 0.04, 0.1], c: '#ff3b5c', e: 0.9 },
];

const cx = (row, c) => BS_R + c * BS_D + (row.off ? BS_R : 0);
const mkRow = (off, ncol) => ({ off, cells: Array.from({ length: off ? BS_COLS - 1 : BS_COLS }, () => ({ k: randInt(0, ncol - 1) })) });
const colsOf = s => { const set = new Set(); s.rows.forEach(r => r.cells.forEach(c => c && set.add(c.k))); return [...set]; };
const newBubble = s => {
  const cols = colsOf(s), pool = cols.length ? cols : Array.from({ length: s.ncol }, (_, i) => i);
  const r = Math.random();
  if (s.level >= 2 && r < 0.05) return { k: 'bomb' };
  if (s.level >= 3 && r < 0.09) return { k: 'rainbow' };
  return { k: pick(pool) };
};
const initState = (level = 1, score = 0) => {
  const s = { level, score, ncol: Math.min(6, 3 + Math.floor(level / 2)), rows: [], ball: null, cur: null, next: null, aim: null, misses: 0, limit: 6, shiftAnim: 0, falling: [], t: 0, shots: 0, combo: 0, over: false, swapped: false, toast: null };
  const n = Math.min(8, 4 + level);
  for (let i = 0; i < n; i++) s.rows.push(mkRow(i % 2, s.ncol));
  s.cur = newBubble(s); s.next = newBubble(s);
  return s;
};
const colorOf = k => (k === 'bomb' ? '#ff9a3d' : k === 'rainbow' ? '#ffffff' : PAL[k]);

// Burbujas del tablero: todas con instancing (una malla por tipo); el brillo es otra instancia blanca
function bubbleObjs(out, x, y, k, t, moving) {
  const w = toW(x, y);
  const col = k === 'rainbow' ? `hsl(${(t * 90) % 360},95%,65%)` : colorOf(k);
  out.push({ k: 'sph', p: w, n: BR, c: col, e: k === 'bomb' ? 0.45 : 0.12, m: { r: 0.22, m: 0.1 }, inst: moving ? 'burb-m' : 'burbuja' });
  out.push({ k: 'sph', p: [w[0] - 0.13, w[1] + 0.15, w[2] - 0.13], n: 0.17, c: '#ffffff', e: 1, inst: moving ? 'brillo-m' : 'brillo' });
}

export function BubbleShooter3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('bubbles');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState(1, 0);

  const start = () => { fx.clear(); clear3d(); g.current = initState(1, 0); setPhase('play'); hx.tap(); };
  const pos = (s, ri, ci) => ({ x: cx(s.rows[ri], ci), y: ri * BS_RH + BS_R - s.shiftAnim });
  const boom = (s, x, y, col, n = 10) => burst3d(toW(x, y), col, n, { speed: 3.2, up: 1, size: 0.12, life: 0.55, g: 8 });
  const neighbors = (s, r, c) => {
    const row = s.rows[r]; const out = [];
    const cand = row.off ? [[r, c - 1], [r, c + 1], [r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1]] : [[r, c - 1], [r, c + 1], [r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c]];
    cand.forEach(([rr, cc]) => { if (rr >= 0 && rr < s.rows.length && cc >= 0 && cc < s.rows[rr].cells.length) out.push([rr, cc]); });
    return out;
  };
  const pop = (s, list, pts) => {
    list.forEach(([r, c]) => { const b = s.rows[r].cells[c]; if (!b) return; const p = pos(s, r, c); boom(s, p.x, p.y, colorOf(b.k), 10); s.rows[r].cells[c] = null; });
    if (pts) { const p = pos(s, list[0][0], list[0][1]); s.score += pts; const q = px(p.x, p.y, 0.5); fx.pop(q.x, q.y - 12, `+${pts}`, C.text, 17); }
  };
  const settle = (s, r, c) => {
    const b = s.rows[r].cells[c];
    let matched = [];
    if (b.k === 'bomb') {
      matched = [[r, c], ...neighbors(s, r, c).filter(([rr, cc]) => s.rows[rr].cells[cc])];
      neighbors(s, r, c).forEach(([rr, cc]) => { if (s.rows[rr].cells[cc]) neighbors(s, rr, cc).forEach(([r2, c2]) => { if (s.rows[r2].cells[c2] && !matched.some(m => m[0] === r2 && m[1] === c2) && Math.random() < 0.4) matched.push([r2, c2]); }); });
      const p = pos(s, r, c), w = toW(p.x, p.y, 0.2);
      ring3d(w, '#ff9a3d', 34, { speed: 6, life: 0.7 }); burst3d(toW(p.x, p.y), ['#ff9a3d', '#ffe066', '#ff4d6d'], 40, { speed: 5, up: 2, size: 0.16, life: 0.8 });
      s.toast = { m: '💥 ¡BOOM!', t: 1.1 }; fx.shake(7, 0.3); fx.flash(C.orange, 0.2); hx.heavy();
    } else {
      const seen = new Set([r * 100 + c]); const q = [[r, c]]; const target = b.k;
      while (q.length) {
        const [cr, cc] = q.pop(); matched.push([cr, cc]);
        neighbors(s, cr, cc).forEach(([nr, nc]) => {
          const nb = s.rows[nr].cells[nc]; const id = nr * 100 + nc;
          if (!nb || seen.has(id)) return;
          if (target === 'rainbow' ? true : (nb.k === target || nb.k === 'rainbow')) { seen.add(id); q.push([nr, nc]); }
        });
      }
      if (b.k === 'rainbow' && matched.length > 1) { const first = matched.slice(1).find(([rr, cc]) => typeof s.rows[rr].cells[cc].k === 'number'); if (first) { const tk = s.rows[first[0]].cells[first[1]].k; matched = matched.filter(([rr, cc]) => s.rows[rr].cells[cc].k === tk || (rr === r && cc === c)); } }
    }
    if (matched.length >= 3 || b.k === 'bomb') {
      s.combo += 1; s.misses = 0;
      pop(s, matched, matched.length * 10 + (matched.length - 3) * 8);
      hx.hit();
      // las burbujas que ya no están unidas al techo caen
      const attached = new Set(); const q = [];
      s.rows[0].cells.forEach((cell, ci) => { if (cell) { attached.add(ci); q.push([0, ci]); } });
      while (q.length) { const [cr, cc] = q.pop(); neighbors(s, cr, cc).forEach(([nr, nc]) => { const id = nr * 100 + nc; if (s.rows[nr].cells[nc] && !attached.has(id)) { attached.add(id); q.push([nr, nc]); } }); }
      let dropped = 0;
      s.rows.forEach((row, ri) => row.cells.forEach((cell, ci) => {
        if (cell && !attached.has(ri * 100 + ci)) { const p = pos(s, ri, ci); s.falling.push({ id: uid(), x: p.x, y: p.y, vy: 0, vx: rand(-40, 40), k: cell.k }); row.cells[ci] = null; dropped += 1; }
      }));
      if (dropped) { const pts = dropped * 20 * Math.max(1, dropped - 1); s.score += pts; s.toast = { m: `¡${dropped} CAEN! +${pts}`, t: 1.3 }; hx.good(); }
    } else {
      s.combo = 0; s.misses += 1; hx.tap();
      if (s.misses >= s.limit) { // baja el techo
        s.misses = 0;
        s.rows.unshift(mkRow(s.rows[0].off ? 0 : 1, s.ncol)); s.shiftAnim = BS_RH; fx.shake(4, 0.2); hx.warn();
      }
    }
    while (s.rows.length > 1 && s.rows[s.rows.length - 1].cells.every(x => !x)) s.rows.pop();
    if (!s.rows.some(row => row.cells.some(Boolean))) {
      s.score += 500; fx.flash('#fff', 0.35); s.toast = { m: `NIVEL ${s.level} SUPERADO +500`, t: 1.6 }; hx.win();
      const ns = initState(s.level + 1, s.score); Object.assign(s, ns);
      return;
    }
    const lowest = s.rows.length - 1;
    if (lowest * BS_RH + BS_R > DANGER) { s.over = true; hx.die(); fx.shake(10, 0.4); fx.flash(C.red, 0.3); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  };
  const snap = (s, x, y) => {
    let bestD = 1e9, bestC = null;
    for (let ri = Math.max(0, Math.floor((y - BS_R) / BS_RH) - 1); ri <= Math.floor((y - BS_R) / BS_RH) + 2; ri++) {
      if (ri < 0) continue;
      while (ri >= s.rows.length) s.rows.push({ off: s.rows[s.rows.length - 1].off ? 0 : 1, cells: Array(s.rows[s.rows.length - 1].off ? BS_COLS : BS_COLS - 1).fill(null) });
      const row = s.rows[ri];
      row.cells.forEach((cell, ci) => { if (cell) return; const qx = cx(row, ci), qy = ri * BS_RH + BS_R - s.shiftAnim; const d = Math.hypot(qx - x, qy - y); if (d < bestD) { bestD = d; bestC = [ri, ci]; } });
    }
    return bestC;
  };
  const aimFrom = q => {
    const dx = q[0] - W / 2, dy = CY - q[1];
    g.current.aim = clamp(Math.atan2(dy, dx), 0.2, Math.PI - 0.2);
  };
  const fire = () => {
    const s = g.current;
    if (phase !== 'play' || s.ball || s.over || s.aim == null) return;
    const a = s.aim, sp = 900;
    s.ball = { x: W / 2, y: CY, vx: Math.cos(a) * sp, vy: -Math.sin(a) * sp, k: s.cur.k };
    s.cur = s.next; s.next = newBubble(s); s.shots += 1; hx.tap();
  };
  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current, q = touchL(x, y);
      if (phase !== 'play' || !q) return;
      if (Math.hypot(q[0] - W / 2, q[1] - CY) < 48) { const t = s.cur; s.cur = s.next; s.next = t; hx.tick(); s.aim = null; s.swapped = true; return; }
      s.swapped = false; aimFrom(q);
    },
    move: (x, y) => { const s = g.current; if (s.swapped) return; const q = touchL(x, y); if (q) aimFrom(q); },
    up: () => { const s = g.current; if (!s.swapped) fire(); s.aim = null; },
  });

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.over) return;
    s.t += dt;
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    if (s.shiftAnim > 0) s.shiftAnim = Math.max(0, s.shiftAnim - dt * 260);
    s.falling.forEach(f => { f.vy += 1400 * dt; f.y += f.vy * dt; f.x += f.vx * dt; });
    s.falling = s.falling.filter(f => f.y < LH + 40);
    const b = s.ball;
    if (b) {
      const steps = Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 6);
      for (let i = 0; i < steps && s.ball; i++) {
        b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
        if (b.x < BS_R) { b.x = BS_R; b.vx = Math.abs(b.vx); }
        if (b.x > W - BS_R) { b.x = W - BS_R; b.vx = -Math.abs(b.vx); }
        let hit = b.y <= BS_R - s.shiftAnim + 1;
        if (!hit) for (let ri = 0; ri < s.rows.length && !hit; ri++) { const row = s.rows[ri]; const ry = ri * BS_RH + BS_R - s.shiftAnim; if (Math.abs(ry - b.y) > BS_D) continue; for (let ci = 0; ci < row.cells.length; ci++) { if (row.cells[ci] && Math.hypot(cx(row, ci) - b.x, ry - b.y) < BS_D * 0.88) { hit = true; break; } } }
        if (hit) {
          const cell = snap(s, b.x, b.y);
          const kind = b.k;
          s.ball = null;
          if (cell) { s.rows[cell[0]].cells[cell[1]] = { k: kind }; settle(s, cell[0], cell[1]); }
          break;
        }
      }
    }
  });

  const s = g.current;
  // trayectoria de apuntado (rebota en las paredes; puntos en el tablero)
  const dots = [];
  if (s.aim != null && !s.ball) {
    let x = W / 2, y = CY, vx = Math.cos(s.aim), vy = -Math.sin(s.aim);
    for (let i = 0; i < 90; i++) {
      x += vx * 9; y += vy * 9;
      if (x < BS_R) { x = BS_R; vx = Math.abs(vx); } if (x > W - BS_R) { x = W - BS_R; vx = -Math.abs(vx); }
      let stop = y < BS_R;
      if (!stop) for (let ri = 0; ri < s.rows.length && !stop; ri++) { const ry = ri * BS_RH + BS_R; if (Math.abs(ry - y) > BS_D) continue; for (let ci = 0; ci < s.rows[ri].cells.length; ci++) if (s.rows[ri].cells[ci] && Math.hypot(cx(s.rows[ri], ci) - x, ry - y) < BS_D * 0.88) { stop = true; break; } }
      if (stop) break;
      if (i % 2 === 0) dots.push([x, y]);
    }
  }
  const objs = [];
  const bubbles = [];
  s.rows.forEach((row, ri) => row.cells.forEach((cell, ci) => { if (cell) bubbleObjs(bubbles, cx(row, ci), ri * BS_RH + BS_R - s.shiftAnim, cell.k, s.t, false); }));
  s.falling.forEach(f => bubbleObjs(bubbles, f.x, f.y, f.k, s.t, true));
  objs.push(...bubbles);
  dots.forEach(([x, y], i) => objs.push({ id: `p${i}`, k: 'sph', p: toW(x, y, 0.22), n: 0.13 - i * 0.001, c: '#ffffff', e: 0.8, o: Math.max(0.15, 0.85 - i * 0.02) }));
  if (s.ball) objs.push({ id: 'bola', k: 'sph', p: toW(s.ball.x, s.ball.y), n: BR, c: s.ball.k === 'rainbow' ? '#ffffff' : colorOf(s.ball.k), e: 0.25, sh: true });
  // cañón: base y barril que apunta hacia el disparo
  const base = toW(W / 2, CY, 0.25), aim = s.aim != null ? s.aim : Math.PI / 2;
  const dX = Math.cos(aim), dZ = -Math.sin(aim);
  objs.push({ id: 'base', k: 'cyl', p: base, s: [1.3, 0.5, 1.3], c: '#2a1f4a', e: 0.1, sh: true });
  objs.push({ id: 'base2', k: 'tor', p: [base[0], 0.5, base[2]], n: 0.7, r: [Math.PI / 2, 0, 0], c: '#ff4d8d', e: 0.8 });
  objs.push({ id: 'barril', k: 'box', p: [base[0] + dX * 0.8, 0.55, base[2] + dZ * 0.8], s: [0.34, 0.34, 1.5], r: [0, Math.atan2(dX, dZ), 0], c: '#ffb3c7', e: 0.15, sh: true });
  if (!s.ball) objs.push({ id: 'cur', k: 'sph', p: [base[0], 1.0, base[2]], n: BR, c: s.cur.k === 'rainbow' ? '#ffffff' : colorOf(s.cur.k), e: 0.25, sh: true });
  const nxW = toW(W / 2 + 70, CY, 0.4);
  objs.push({ id: 'nxt', k: 'sph', p: nxW, n: BR * 0.66, c: s.next.k === 'rainbow' ? '#ffffff' : colorOf(s.next.k), e: 0.3, sh: true });

  const scene = { sky: SKY, fog: { c: SKY.bottom, near: 24, far: 44 }, light: { dir: [-0.3, 0.9, 0.35] }, shadowR: 12, statics: STATICS, objs, cam: CAM };
  const nxPx = px(W / 2 + 70, CY, 0.4), basePx = px(W / 2, CY, 0.4);

  return (
    <Game3D title="BUBBLE SHOOTER" emoji="🫧" accent={C.red} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} orbit={{ r: 21, h: 12, speed: 0.12, ly: 0.5, drop: 1.6 }}
      pan={pan}
      hud={<>
        <HudPill icon="🏁" label="NIVEL" value={s.level} color={C.red} />
        <HudPill icon="⬇" label="TECHO" value={s.limit - s.misses} color={s.limit - s.misses <= 2 ? C.red : C.dim} />
        <HudPill icon="🔥" value={s.combo} color={C.amber} />
      </>}
      subtitle="Une 3 burbujas del mismo color"
      lines={['Arrastra para apuntar y suelta para disparar', 'Toca la burbuja del cañón para cambiarla', '💣 explota alrededor · 🌈 se une a cualquier color', 'Si fallas varias veces, el techo baja']}
      result={{ isNew: res.isNew, title: 'LAS BURBUJAS LLEGARON', emoji: '🫧', subtitle: `Nivel ${s.level} · ${s.shots} disparos`, stats: [['NIVEL', s.level], ['DISPAROS', s.shots]] }}>
      <Text pointerEvents="none" style={{ position: 'absolute', left: nxPx.x - 44, top: nxPx.y - 46, width: 88, textAlign: 'center', color: C.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>SIGUIENTE</Text>
      <Text pointerEvents="none" style={{ position: 'absolute', left: basePx.x - 70, top: basePx.y + 22, width: 140, textAlign: 'center', color: C.dim, fontSize: 10, fontWeight: '800' }}>TOCA EL CAÑÓN PARA CAMBIAR</Text>
      {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: SCREEN_H * 0.3, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 22, fontWeight: '900', textShadowColor: '#000', textShadowRadius: 8 }}>{s.toast.m}</Text>}
    </Game3D>
  );
}
