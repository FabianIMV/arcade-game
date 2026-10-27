import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, Combo, GameScreen, Overlay, PlayArea, alpha, clamp, hx, pick, rand, randInt, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Tablero inclinado en 3D: la lógica de juego trabaja en píxeles de la zona de juego y se proyecta
// a mundo 3D al dibujar (tablero inclinado hacia el fondo). Cámara detrás del cañón.
const BS_COLS = 10, BS_R = AREA_W / (BS_COLS * 2), BS_D = BS_R * 2, BS_RH = BS_R * 1.7321;
const BS_SCALE = 1 / BS_D;              // 1 unidad = diámetro de una burbuja
const BS_TILT = 0.5;                    // inclinación del tablero (rad)
const BS_CY = Math.cos(BS_TILT), BS_SY_ = Math.sin(BS_TILT);
const BS_PAL = [C.red, C.cyan, C.lime, C.amber, C.violet, C.pink];
const BS_SY = AREA_H - 46, BS_SX = AREA_W / 2;

// píxeles de la zona → mundo 3D (x lateral, y arriba, z hacia el fondo)
const to3 = (x, y) => {
  const u = (x - AREA_W / 2) * BS_SCALE, v = (AREA_H - y) * BS_SCALE;
  return [u, v * BS_CY, -v * BS_SY_];
};
const NORMAL = [0, BS_SY_, BS_CY];    // normal del tablero (hacia la cámara)

const initState = (level, score) => {
  const s = { level, score, ncol: 0, rows: [], ball: null, cur: null, next: null, aim: null, misses: 0, limit: 6, shiftAnim: 0, falling: [], t: 0, shots: 0, combo: 0, over: false, swapped: false };
  s.ncol = Math.min(6, 3 + Math.floor(level / 2));
  const n = Math.min(8, 4 + level);
  for (let i = 0; i < n; i++) s.rows.push(mkRow(i % 2, s.ncol));
  s.cur = newBubble(s); s.next = newBubble(s);
  return s;
};
const mkRow = (off, ncol) => ({ off, cells: Array.from({ length: off ? BS_COLS - 1 : BS_COLS }, () => ({ k: randInt(0, ncol - 1) })) });
const colsOfBoard = s => { const set = new Set(); s.rows.forEach(r => r.cells.forEach(c => c && set.add(c.k))); return [...set]; };
const newBubble = s => {
  const cols = colsOfBoard(s);
  const pool = cols.length ? cols : Array.from({ length: s.ncol }, (_, i) => i);
  const r = Math.random();
  if (s.level >= 2 && r < 0.05) return { k: 'bomb' };
  if (s.level >= 3 && r < 0.09) return { k: 'rainbow' };
  return { k: pick(pool) };
};
const cx = (row, c) => BS_R + c * BS_D + (row.off ? BS_R : 0);
const colorOf = k => (k === 'bomb' ? '#ff9a3d' : k === 'rainbow' ? '#ffffff' : BS_PAL[k]);

export function BubbleShooter3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('bubbles');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState(1, 0);

  const start = () => { fx.clear(); g.current = initState(1, 0); setPhase('play'); };
  const pos = (s, ri, ci) => ({ x: cx(s.rows[ri], ci), y: ri * BS_RH + BS_R - s.shiftAnim });

  const neighbors = (s, r, c) => {
    const row = s.rows[r]; const out = [];
    const cand = row.off ? [[r, c - 1], [r, c + 1], [r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1]] : [[r, c - 1], [r, c + 1], [r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c]];
    cand.forEach(([rr, cc]) => { if (rr >= 0 && rr < s.rows.length && cc >= 0 && cc < s.rows[rr].cells.length) out.push([rr, cc]); });
    return out;
  };
  const pop = (s, list, pts) => {
    list.forEach(([r, c]) => { const b = s.rows[r].cells[c]; if (!b) return; const p = pos(s, r, c); fx.burst(p.x, p.y, colorOf(b.k), 8, 200, 0.5, 4); s.rows[r].cells[c] = null; });
    if (pts) { const p = pos(s, list[0][0], list[0][1]); s.score += pts; fx.pop(p.x, p.y - 10, `+${pts}`, C.text, 17); }
  };
  const settle = (s, r, c) => {
    const b = s.rows[r].cells[c];
    let matched = [];
    if (b.k === 'bomb') {
      matched = [[r, c], ...neighbors(s, r, c).filter(([rr, cc]) => s.rows[rr].cells[cc])];
      neighbors(s, r, c).forEach(([rr, cc]) => { if (s.rows[rr].cells[cc]) neighbors(s, rr, cc).forEach(([r2, c2]) => { if (s.rows[r2].cells[c2] && !matched.some(m => m[0] === r2 && m[1] === c2) && Math.random() < 0.4) matched.push([r2, c2]); }); });
      const p = pos(s, r, c); fx.ring(p.x, p.y, C.orange, 90); fx.shake(7, 0.3); fx.flash(C.orange, 0.2); hx.heavy();
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
      if (dropped) { const pts = dropped * 20 * Math.max(1, dropped - 1); s.score += pts; fx.pop(AREA_W / 2, AREA_H * 0.4, `¡${dropped} CAEN! +${pts}`, C.amber, 20); hx.good(); }
    } else {
      s.combo = 0; s.misses += 1; hx.tap();
      if (s.misses >= s.limit) { // baja el techo
        s.misses = 0;
        s.rows.unshift(mkRow(s.rows[0].off ? 0 : 1, s.ncol)); s.shiftAnim = BS_RH; fx.shake(4, 0.2); hx.warn();
      }
    }
    while (s.rows.length > 1 && s.rows[s.rows.length - 1].cells.every(x => !x)) s.rows.pop();
    if (!s.rows.some(row => row.cells.some(Boolean))) {
      s.score += 500; fx.flash('#fff', 0.35); fx.pop(AREA_W / 2, AREA_H / 2, `NIVEL ${s.level} SUPERADO +500`, C.lime, 22); hx.win();
      const ns = initState(s.level + 1, s.score); Object.assign(s, ns);
      return;
    }
    const lowest = s.rows.length - 1;
    if (lowest * BS_RH + BS_R > (AREA_H - 46) - BS_D * 1.1) { s.over = true; hx.die(); fx.shake(10, 0.4); fx.flash(C.red, 0.3); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  };
  const snap = (s, x, y) => {
    let bestD = 1e9, bestC = null;
    for (let ri = Math.max(0, Math.floor((y - BS_R) / BS_RH) - 1); ri <= Math.floor((y - BS_R) / BS_RH) + 2; ri++) {
      if (ri < 0) continue;
      while (ri >= s.rows.length) s.rows.push({ off: s.rows[s.rows.length - 1].off ? 0 : 1, cells: Array(s.rows[s.rows.length - 1].off ? BS_COLS : BS_COLS - 1).fill(null) });
      const row = s.rows[ri];
      row.cells.forEach((cell, ci) => { if (cell) return; const px = cx(row, ci), py = ri * BS_RH + BS_R - s.shiftAnim; const d = Math.hypot(px - x, py - y); if (d < bestD) { bestD = d; bestC = [ri, ci]; } });
    }
    return bestC;
  };
  const fire = () => {
    const s = g.current;
    if (phase !== 'play' || s.ball || s.over || s.aim == null) return;
    const a = s.aim; const sp = 1000;
    s.ball = { x: BS_SX, y: BS_SY, vx: Math.cos(a) * sp, vy: -Math.sin(a) * sp, k: s.cur.k };
    s.cur = s.next; s.next = newBubble(s); s.shots += 1; hx.tap();
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    if (s.shiftAnim > 0) s.shiftAnim = Math.max(0, s.shiftAnim - dt * 260);
    s.falling.forEach(f => { f.vy += 1400 * dt; f.y += f.vy * dt; f.x += f.vx * dt; });
    s.falling = s.falling.filter(f => f.y < AREA_H + 40);
    const b = s.ball;
    if (b) {
      const steps = Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 6);
      for (let i = 0; i < steps && s.ball; i++) {
        b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
        if (b.x < BS_R) { b.x = BS_R; b.vx = Math.abs(b.vx); }
        if (b.x > AREA_W - BS_R) { b.x = AREA_W - BS_R; b.vx = -Math.abs(b.vx); }
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

  const aimFrom = (x, y) => {
    const dx = x - BS_SX, dy = BS_SY - y;
    g.current.aim = clamp(Math.atan2(dy, dx), 0.2, Math.PI - 0.2);
  };
  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current;
      if (phase !== 'play') return;
      if (Math.hypot(x - BS_SX, y - BS_SY) < 34) { const t = s.cur; s.cur = s.next; s.next = t; hx.tick(); s.aim = null; s.swapped = true; return; }
      s.swapped = false; aimFrom(x, y);
    },
    move: (x, y) => { if (!g.current.swapped) aimFrom(x, y); },
    up: () => { const s = g.current; if (!s.swapped) fire(); s.aim = null; },
  });

  const s = g.current;
  // trayectoria de apuntado (puntos en el tablero)
  const dots = [];
  if (s.aim != null && !s.ball) {
    let x = BS_SX, y = BS_SY, vx = Math.cos(s.aim), vy = -Math.sin(s.aim);
    for (let i = 0; i < 70; i++) {
      x += vx * 9; y += vy * 9;
      if (x < BS_R) { x = BS_R; vx = Math.abs(vx); } if (x > AREA_W - BS_R) { x = AREA_W - BS_R; vx = -Math.abs(vx); }
      let stop = y < BS_R;
      if (!stop) for (let ri = 0; ri < s.rows.length && !stop; ri++) { const ry = ri * BS_RH + BS_R; if (Math.abs(ry - y) > BS_D) continue; for (let ci = 0; ci < s.rows[ri].cells.length; ci++) if (s.rows[ri].cells[ci] && Math.hypot(cx(s.rows[ri], ci) - x, ry - y) < BS_D * 0.88) { stop = true; break; } }
      if (stop) break;
      if (i % 2 === 0) dots.push([x, y]);
    }
  }

  // ----- escena 3D -----
  const objs = [];
  const boardC = to3(AREA_W / 2, AREA_H / 2);
  objs.push({ id: 'tablero', k: 'box', p: [boardC[0], boardC[1] - NORMAL[1] * 0.2, boardC[2] - NORMAL[2] * 0.2], s: [AREA_W * BS_SCALE + 0.6, AREA_H * BS_SCALE + 0.6, 0.3], r: [-BS_TILT, 0, 0], c: '#1a0c18', e: 0.02 });
  const dz = to3(AREA_W / 2, BS_SY - BS_D * 1.1 - 0);
  objs.push({ id: 'linea', k: 'box', p: [0, dz[1] + 0.0, dz[2] + 0.02], s: [AREA_W * BS_SCALE, 0.06, 0.06], r: [-BS_TILT, 0, 0], c: C.red, e: 0.5 });
  const bub = (x, y, k, id) => ({ id, k: 'sph', p: to3(x, y), n: BS_D * BS_SCALE * 0.92, c: k === 'rainbow' ? `hsl(${(s.t * 90) % 360},95%,65%)` : colorOf(k), e: k === 'rainbow' ? 0.3 : 0.08 });
  s.rows.forEach((row, ri) => row.cells.forEach((cell, ci) => { if (cell) objs.push(bub(cx(row, ci), ri * BS_RH + BS_R - s.shiftAnim, cell.k, `c${ri}-${ci}`)); }));
  s.falling.forEach(f => objs.push(bub(f.x, f.y, f.k, `f${f.id}`)));
  dots.forEach(([x, y], i) => objs.push({ id: `p${i}`, k: 'sph', p: to3(x, y), n: 0.16, c: '#ffffff', e: 0.4, o: 0.7 - i * 0.008 }));
  if (s.ball) objs.push(bub(s.ball.x, s.ball.y, s.ball.k, 'bola'));
  // cañón: base y cañón que apunta hacia donde se dispara
  const base = to3(BS_SX, BS_SY);
  const aim = s.aim != null ? s.aim : Math.PI / 2;
  const dir3 = [Math.cos(aim) * 0.9, Math.sin(aim) * BS_CY * 0.9, -Math.sin(aim) * BS_SY_ * 0.9];
  objs.push({ id: 'base', k: 'sph', p: [base[0], base[1] + 0.1, base[2]], n: 1.2, c: C.red, e: 0.12 });
  objs.push({ id: 'cañon', k: 'box', p: [base[0] + dir3[0] * 0.6, base[1] + dir3[1] * 0.6, base[2] + dir3[2] * 0.6], s: [0.34, 1.6, 0.34], r: [-BS_TILT, 0, aim - Math.PI / 2], c: '#ffb3c7', e: 0.1 });
  if (!s.ball) objs.push(bub(BS_SX, BS_SY, s.cur.k, 'cur'));
  const nx = to3(BS_SX + 52, BS_SY);
  objs.push({ id: 'nxt', k: 'sph', p: nx, n: BS_D * BS_SCALE * 0.7, c: s.next.k === 'rainbow' ? '#ffffff' : colorOf(s.next.k), e: 0.12 });

  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.04 : 0;
  const scene = {
    bg: '#0a0510', fog: { c: '#0a0510', near: 16, far: 34 }, objs,
    cam: { p: [(Math.random() - 0.5) * shake, 8.6, 10.4], l: [0, 6.4, -7], fov: 62 },
  };

  return (
    <GameScreen title="BUBBLE SHOOTER" emoji="🫧" accent={C.red} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.red, fontWeight: '800' }}>{s.level}</Text></Text><View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: C.dim, fontSize: 11, marginRight: 6 }}>Techo en</Text>{Array.from({ length: s.limit }, (_, i) => <View key={i} style={{ width: 8, height: 8, borderRadius: 4, marginHorizontal: 1.5, backgroundColor: i < s.limit - s.misses ? C.red : alpha(C.red, 0.2) }} />)}</View><View style={{ minWidth: 60, alignItems: 'flex-end' }}>{s.combo > 1 ? <Combo n={s.combo} color={C.red} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#0a0510" border={alpha(C.red, 0.4)} {...pan}>
        <World3D scene={scene} />
        <Text pointerEvents="none" style={{ position: 'absolute', left: BS_SX + 42, top: BS_SY + 18, color: C.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>SIGUIENTE</Text>
        <Text pointerEvents="none" style={{ position: 'absolute', left: BS_SX - 100, top: BS_SY + 20, width: 76, color: alpha(C.dim, 0.7), fontSize: 9, fontWeight: '800', textAlign: 'right' }}>TOCA PARA CAMBIAR</Text>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🫧" title={phase === 'over' ? 'LAS BURBUJAS LLEGARON' : 'BUBBLE SHOOTER'}
          subtitle={phase === 'over' ? `Nivel ${s.level} · ${s.shots} disparos` : 'Une 3 burbujas del mismo color'}
          score={s.score} best={best} isNew={res.isNew} accent={C.red} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para apuntar y suelta para disparar', 'Toca la burbuja del cañón para cambiarla', '💣 explota alrededor · 🌈 se une a cualquier color', 'Si fallas varias veces, el techo baja'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
