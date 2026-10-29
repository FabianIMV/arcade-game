/**
 * Neon Warrior 3D – plataformas de acción en tercera persona sobre una ciudad neón (motor 3D v2).
 * Reglas del juego original: 6 niveles generados, física con doble salto, espada (tajo), pisotones, enemigos
 * (caminantes, saltadores, torretas, voladores), checkpoints, poderes (⭐ escudo ❤ ⚡) y jefes cada 3 niveles.
 * Física en "px" como el original; el mundo 3D usa 1 unidad = NW_SC px y el suelo está en y = 0.
 * Cámara: detrás del guerrero en diagonal, se adelanta hacia donde mira, con rascacielos con parallax al fondo.
 */
import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Bar, C, Lives, SCREEN_H, SCREEN_W, alpha, clamp, hx, pick, rand, tglow, uid, useBest, useFX, useLoop } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Game3D, HudPill } from '../utils/ui3d';
import { coin, enemy, gem, hash01, person, shade } from '../utils/prefabs';
import { project } from '../utils/openworld';

const NW_AH = 540, NW_GY = NW_AH - 64, NW_SC = 40, PW = 28, PH = 38;
const wx = px => px / NW_SC;
const wy = py => (NW_GY - py) / NW_SC;
const PI = Math.PI, cs = Math.cos, sn = Math.sin;
const TH = [
  { name: 'CIUDAD NEÓN', a: C.pink, b: C.cyan, top: '#0b0630', bot: '#5a1a80', kind: 'city', body: '#1a1d45' },
  { name: 'BOSQUE DIGITAL', a: C.lime, b: C.cyan, top: '#031c18', bot: '#0f6a50', kind: 'forest', body: '#0f3a34' },
  { name: 'FÁBRICA ARDIENTE', a: C.orange, b: C.amber, top: '#1c0606', bot: '#8a3010', kind: 'factory', body: '#3a1a18' },
  { name: 'NÚCLEO CUÁNTICO', a: C.violet, b: C.pink, top: '#10062a', bot: '#4a1f9a', kind: 'quantum', body: '#2a1a5a' },
];

// ─── constructor de modelos (mismo convenio que prefabs.js) ───
const rotX = a => [1, 0, 0, 0, cs(a), -sn(a), 0, sn(a), cs(a)];
const rotY = a => [cs(a), 0, sn(a), 0, 1, 0, -sn(a), 0, cs(a)];
const rotZ = a => [cs(a), -sn(a), 0, sn(a), cs(a), 0, 0, 0, 1];
const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8]];
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const rotXYZ = r => mul(rotX(r[0]), mul(rotY(r[1]), rotZ(r[2])));
const eul = m => { const y = Math.asin(Math.max(-1, Math.min(1, m[2]))); if (Math.abs(m[2]) < 0.9999999) return [Math.atan2(-m[5], m[8]), y, Math.atan2(-m[1], m[0])]; return [Math.atan2(m[7], m[4]), y, 0]; };
function Bld(id, p, o = {}) {
  const n = o.n == null ? 1 : o.n;
  const G = o.yaw ? rotY(o.yaw) : null;
  const out = [];
  const add = (name, k, lp, ls, c, x) => {
    x = x || {};
    const q = G ? mv(G, lp) : lp; const r = x.r || null;
    const ob = { id: id + '.' + name, k, p: [p[0] + q[0] * n, p[1] + q[1] * n, p[2] + q[2] * n], c: o.flash ? '#ffffff' : c };
    if (typeof ls === 'number') ob.n = ls * n; else ob.s = [ls[0] * n, ls[1] * n, ls[2] * n];
    if (G) ob.r = eul(mul(G, r ? rotXYZ(r) : [1, 0, 0, 0, 1, 0, 0, 0, 1])); else if (r) ob.r = r;
    if (o.flash) ob.e = 0.7; else if (x.e) ob.e = x.e;
    if (x.o != null) ob.o = x.o;
    if (x.sh !== false && !ob.o) ob.sh = true;
    out.push(ob); return ob;
  };
  return { add, out };
}

// ─── generador de niveles (igual que el 2D) ───
function genLevel(n) {
  const GY = NW_GY, LEN = 2600 + n * 700;
  const gr = [{ x: 0, y: GY, w: 380 }], fl = [], mv2 = [], hz = [], en = [], co = [], pu = [], fg = [];
  let x = 380, sinceFlag = 0; const gapMax = Math.min(170, 110 + n * 10);
  const flat = (w, ground = true) => {
    if (ground) gr.push({ x, y: GY, w });
    const nE = Math.floor(rand(0, 1 + n * 0.5));
    for (let k = 0; k < nE; k++) {
      const t = Math.random(), ex = x + rand(60, w - 60);
      if (t < 0.5) en.push({ id: uid(), t: 'walker', x: ex, y: GY - 30, vx: rand(50, 80) * (Math.random() < 0.5 ? 1 : -1), hp: 1, bx: x + 10, ex: x + w - 10, alive: true });
      else if (t < 0.75) en.push({ id: uid(), t: 'hopper', x: ex, y: GY - 30, vx: 0, vy: 0, hp: 1, alive: true, tm: rand(0.5, 1.5) });
      else en.push({ id: uid(), t: 'turret', x: ex, y: GY - 34, hp: 2, maxHp: 2, alive: true, tm: rand(0.5, 1.5) });
    }
    for (let k = 0; k < 4; k++) co.push({ id: uid(), x: x + 40 + k * 40, y: GY - 40 - (k === 1 || k === 2 ? 22 : 0), got: false });
    x += w;
  };
  while (x < LEN) {
    const r = Math.random(), w = rand(240, 400);
    if (r < 0.28) flat(w);
    else if (r < 0.52) { const gap = rand(90, gapMax); if (Math.random() < 0.6) { fl.push({ x: x + gap / 2 - 40, y: GY - rand(90, 140), w: 80 }); co.push({ id: uid(), x: x + gap / 2 - 8, y: GY - 170, got: false }); } x += gap; flat(w); }
    else if (r < 0.66) { gr.push({ x, y: GY, w }); hz.push({ x: x + w / 2 - 40, w: rand(56, 90), y: GY }); for (let k = 0; k < 3; k++) co.push({ id: uid(), x: x + w / 2 - 36 + k * 30, y: GY - 120 + (k === 1 ? -16 : 0), got: false }); x += w; }
    else if (r < 0.8) { gr.push({ x, y: GY, w: w + 60 }); for (let k = 0; k < 4; k++) { fl.push({ x: x + 40 + k * 90, y: GY - 70 - k * 38, w: 70 }); co.push({ id: uid(), x: x + 66 + k * 90, y: GY - 108 - k * 38, got: false }); } x += w + 60; }
    else if (r < 0.9) { const gap = rand(190, 250); mv2.push({ id: uid(), x0: x + 30, y: GY - 20, w: 90, amp: gap - 150, spd: rand(0.8, 1.2), ph: 0, cx: x + 30 }); x += gap; flat(w); }
    else { flat(w + 80); if (n > 1) en.push({ id: uid(), t: 'flyer', x: x - w / 2, y: GY - 130, y0: GY - 130, hp: 1, alive: true, ph: Math.random() * 6, vx: -60 }); }
    sinceFlag += w; if (sinceFlag > 1200) { fg.push({ x: x - 60, y: GY, on: false }); sinceFlag = 0; }
    if (Math.random() < 0.28) pu.push({ id: uid(), t: pick(['star', 'shield', 'heart', 'bolt']), x: x - w / 2, y: GY - 80 - rand(0, 40), got: false });
  }
  const boss = n % 3 === 0;
  gr.push({ x, y: GY, w: 640 }); const end = x + 540;
  if (boss) en.push({ id: uid(), t: 'boss', x: x + 380, y: GY - 74, w: 70, h: 74, hp: 20 + n * 3, maxHp: 20 + n * 3, alive: true, vx: -90, bx: x + 40, ex: x + 620, tm: 2, jt: 2.2, vy: 0 });
  const lv = { LEN: x + 640, gr, fl, mv: mv2, hz, en, co, pu, fg, end, boss };
  lv.statics = buildStatics(lv, TH[(n - 1) % TH.length]);
  return lv;
}

// ─── decorado fijo del nivel (todo con instancing; se escribe una sola vez) ───
function buildStatics(lv, th) {
  const st = []; const L = lv.LEN / NW_SC;
  st.push({ id: 'abismo', k: 'pla', p: [L / 2, -22, 0], s: [L + 200, 200, 1], c: shade(th.bot, 0.3), e: 0.1 });
  lv.gr.forEach(sf => {
    const w = sf.w / NW_SC, cx = wx(sf.x) + w / 2;
    st.push({ id: 'g', k: 'box', p: [cx, -2.5, 0], s: [w, 5, 5.4], c: shade(th.body, 1.3), inst: 'calle', recv: true });
    st.push({ id: 'gt', k: 'box', p: [cx, 0.02, 0], s: [w, 0.05, 5.4], c: shade(th.body, 1.9), inst: 'calleTop', recv: true });
    st.push({ id: 'ge1', k: 'box', p: [cx, 0.05, 2.7], s: [w, 0.12, 0.12], c: th.b, e: 1, inst: 'neon' });
    st.push({ id: 'ge2', k: 'box', p: [cx, 0.05, -2.7], s: [w, 0.12, 0.12], c: th.a, e: 1, inst: 'neon' });
    st.push({ id: 'gs', k: 'box', p: [cx, -1.3, 2.72], s: [w, 0.1, 0.04], c: th.a, e: 1, inst: 'neon' });
    st.push({ id: 'gs2', k: 'box', p: [cx, -2.6, 2.72], s: [w, 0.06, 0.04], c: th.b, e: 1, inst: 'neon' });
    for (let x = 1; x < w - 0.5; x += 2.6) st.push({ id: 'gm', k: 'box', p: [wx(sf.x) + x, 0.06, 1.6], s: [1.0, 0.02, 0.14], c: '#a8b4ff', e: 1, inst: 'neon' });
  });
  lv.fl.forEach(f => {
    const w = f.w / NW_SC, cx = wx(f.x) + w / 2, y = wy(f.y);
    st.push({ id: 'f', k: 'box', p: [cx, y - 0.18, 0], s: [w, 0.36, 3.4], c: shade(th.body, 1.6), inst: 'plat', recv: true, sh: true });
    st.push({ id: 'fe', k: 'box', p: [cx, y + 0.02, 1.7], s: [w, 0.1, 0.1], c: th.b, e: 1, inst: 'neon' });
    st.push({ id: 'fu', k: 'box', p: [cx, y - 0.38, 0], s: [w * 0.9, 0.06, 3.0], c: th.a, e: 1, inst: 'neon' });
  });
  lv.hz.forEach(h => {
    const w = h.w / NW_SC, cx = wx(h.x) + w / 2;
    st.push({ id: 'hp', k: 'box', p: [cx, 0.06, 0], s: [w, 0.05, 3.4], c: '#ff2050', e: 1, inst: 'neon' });
    const nn = Math.max(2, Math.floor(w / 0.42));
    for (let i = 0; i < nn; i++) for (const z of [-1.1, 0, 1.1]) st.push({ id: 'hs', k: 'cone', p: [wx(h.x) + (i + 0.5) * w / nn, 0.3, z], s: [0.34, 0.6, 0.34], c: '#ff5a7a', e: 0.6, inst: 'pincho' });
  });
  // fondo: rascacielos / árboles digitales / chimeneas / cristales según el tema
  const wcol = [th.a, th.b, '#ffd27a', '#ffffff'];
  for (let layer = 0; layer < 3; layer++) {
    for (let x = -24; x < L + 50; x += 4.2 + Math.random() * 3.2) {
      const z = -9 - layer * 9 - Math.random() * 3, h = 6 + Math.random() * 14 + layer * 4, w = 2.4 + Math.random() * 2.6, col = shade(th.body, 0.6 + layer * 0.25 + Math.random() * 0.3);
      if (th.kind === 'forest') {
        st.push({ id: 'tt', k: 'cyl', p: [x, h * 0.3, z], s: [0.7, h * 0.6, 0.7], c: shade(th.body, 0.8), inst: 'tronco' });
        for (let i = 0; i < 3; i++) st.push({ id: 'tc', k: 'cone', p: [x, h * 0.45 + i * h * 0.17, z], s: [w * (1.3 - i * 0.28), h * 0.34, w * (1.3 - i * 0.28)], c: shade(th.a, 0.35 + layer * 0.12 + i * 0.1), e: 0.1 + i * 0.1, inst: 'arbolD' });
        if (Math.random() < 0.5) st.push({ id: 'tg', k: 'sph', p: [x + 1, 1 + Math.random() * 3, z + 3], n: 0.3, c: th.b, e: 1, inst: 'neon' });
      } else if (th.kind === 'factory') {
        st.push({ id: 'fb', k: 'box', p: [x, h * 0.35, z], s: [w * 1.5, h * 0.7, w], c: col, inst: 'fabrica' });
        st.push({ id: 'fc', k: 'cyl', p: [x + w * 0.6, h * 0.8, z], s: [1.1, h * 0.9, 1.1], c: shade(col, 1.2), inst: 'chimenea' });
        st.push({ id: 'fr', k: 'cyl', p: [x + w * 0.6, h * 1.25, z], s: [1.4, 0.35, 1.4], c: th.a, e: 1, inst: 'neon' });
        for (let i = 0; i < 3; i++) st.push({ id: 'fw', k: 'box', p: [x - w * 0.5 + i * 1.2, h * 0.35, z + w * 0.5 + 0.02], s: [0.8, 1.2, 0.05], c: th.b, e: 1, inst: 'neon' });
      } else if (th.kind === 'quantum') {
        st.push({ id: 'qt', k: 'oct', p: [x, 3 + h * 0.6 + Math.sin(x) * 2, z], s: [w * 0.8, h * 0.9, w * 0.8], c: shade(th.a, 0.4 + layer * 0.12), e: 0.5, inst: 'cristal' });
        st.push({ id: 'qr', k: 'tor', p: [x, 3 + h * 0.6 + Math.sin(x) * 2, z], r: [PI / 2.4, 0.5, 0], n: w * 1.6, c: th.b, e: 1, inst: 'neon' });
      } else {
        st.push({ id: 'b', k: 'box', p: [x, h / 2, z], s: [w, h, w * 0.9], c: col, inst: 'edificio' });
        const cols = Math.max(2, Math.floor(w / 1.0)), rows = Math.min(6, Math.floor(h / 1.7));
        for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) if (Math.random() < 0.5) st.push({ id: 'w', k: 'box', p: [x - w / 2 + 0.6 + c2 * (w - 1.0) / Math.max(1, cols - 1), 1.6 + r * 1.7 + layer, z + w * 0.45 + 0.03], s: [0.5, 0.7, 0.04], c: pick(wcol), e: 1, inst: 'ventana' });
        if (Math.random() < 0.5) st.push({ id: 's', k: 'box', p: [x + w * 0.3, h + 1.2, z + 0.2], s: [0.35, 2.4, 0.35], c: pick([th.a, th.b]), e: 1, inst: 'neon' });
        st.push({ id: 'ant', k: 'cyl', p: [x - w * 0.2, h + 1.0, z], s: [0.08, 2, 0.08], c: '#7a82a8', inst: 'antena' });
        st.push({ id: 'antl', k: 'sph', p: [x - w * 0.2, h + 2.05, z], n: 0.2, c: '#ff3040', e: 1, inst: 'neon' });
      }
    }
  }
  // farolas y vallas en primer plano
  for (let x = 6; x < L; x += 11) {
    st.push({ id: 'lp', k: 'cyl', p: [x, 2.2, -3.8], s: [0.12, 4.4, 0.12], c: '#2a2f55', inst: 'farola' });
    st.push({ id: 'lpl', k: 'sph', p: [x, 4.5, -3.8], n: 0.5, c: th.b, e: 1, inst: 'neon' });
  }
  return st;
}

export function NeonWarrior3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('warrior');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, kind: 'over' });
  const input = useRef({ left: false, right: false, jump: false }).current;
  const g = useRef(null);
  const initState = (n, score, lives) => {
    const lv = genLevel(n);
    return { n, lv, score, lives, p: { x: 60, y: NW_GY - PH, vx: 0, vy: 0, jumps: 0, coyote: 0, buf: 0, face: 1, yaw: -PI / 2, inv: 0, shield: false, star: 0, bolt: 0, cool: 0, ride: null, slash: 0, slashSet: null, walk: 0, air: false }, c3: 1.5, cf: 1, cy: 0, eb: [], t: 0, time: 0, spawn: { x: 60, y: NW_GY - PH }, coins: 0, kills: 0, over: false, bonus: 0, toast: null, trail: [] };
  };
  if (!g.current) g.current = initState(1, 0, 3);
  if (globalThis.__TEST) globalThis.__game = g;
  const scr = (s, px, py) => { const q = s.camObj && project(s.camObj, [wx(px), wy(py), 0], SCREEN_W, SCREEN_H); return q ? [q.x, q.y] : [SCREEN_W / 2, SCREEN_H / 2]; };
  const W3 = (px, py) => [wx(px), wy(py), 0];
  const pop = (s, px, py, txt, color, size) => { const q = scr(s, px, py); fx.pop(q[0], q[1], txt, color, size || 20); };

  const start = () => { fx.clear(); clear3d(); g.current = initState(1, 0, 3); setPhase('play'); hx.tap(); };
  const nextLevel = () => { const s = g.current; fx.clear(); clear3d(); g.current = initState(s.n + 1, s.score, Math.min(5, s.lives + 1)); setPhase('play'); hx.tap(); };
  const jumpPress = () => { input.jump = true; g.current.p.buf = 0.13; };
  const slash = () => { const s = g.current; const p = s.p; if (phase !== 'play' || p.cool > 0) return; p.slash = 0.22; p.slashSet = new Set(); p.cool = p.bolt > 0 ? 0.14 : 0.3; hx.tap(); };
  const endGame = (s, kind) => {
    s.over = true; hx.die();
    setRes({ isNew: submitBest(s.score), kind }); setPhase('over');
  };
  const hurt = (s, push) => {
    const p = s.p; if (p.inv > 0 || p.star > 0) return;
    const c = W3(p.x + PW / 2, p.y + PH / 2);
    if (p.shield) { p.shield = false; p.inv = 1; ring3d(c, C.cyan, 24, { speed: 6, life: 0.6 }); burst3d(c, [C.cyan, '#fff'], 16, { speed: 5, size: 0.14 }); hx.warn(); return; }
    s.lives -= 1; p.inv = 1.6; p.vy = -420; p.vx = push * 280; burst3d(c, [C.red, '#ffb0a0'], 22, { speed: 6, up: 2, size: 0.18 }); fx.shake(9, 0.3); fx.flash(C.red, 0.3); hx.bad();
    if (s.lives <= 0) endGame(s, 'over');
  };
  const fall = s => {
    const p = s.p; s.lives -= 1; hx.bad(); fx.shake(10, 0.35); fx.flash(C.red, 0.3);
    if (s.lives <= 0) { endGame(s, 'over'); return; }
    p.x = s.spawn.x; p.y = s.spawn.y - 40; p.vx = 0; p.vy = 0; p.inv = 1.6;
  };
  const kill = (s, e, pts) => {
    e.alive = false; s.score += pts; s.kills += 1; hx.hit();
    const c = W3(e.x + (e.w || 32) / 2, e.y + (e.h || 32) / 2);
    burst3d(c, [C.amber, '#fff', e.t === 'walker' ? '#c85cff' : '#8fcfff'], 26, { speed: 6, up: 3, size: 0.16 }); ring3d(c, C.amber, 14, { speed: 4, life: 0.4 });
    pop(s, e.x + 16, e.y - 6, `+${pts}`, C.text, 18);
  };
  const killBoss = (s, e) => {
    e.alive = false; s.score += 500; const c = W3(e.x + e.w / 2, e.y + e.h / 2);
    burst3d(c, [C.amber, C.red, '#fff'], 90, { speed: 10, up: 4, size: 0.3, life: 1.2 }); ring3d(c, C.amber, 30, { speed: 8, life: 0.8 }); fx.flash('#fff', 0.5); fx.shake(14, 0.6); hx.win(); pop(s, e.x + e.w / 2, e.y - 10, '+500', C.amber, 30);
  };
  const dmgEnemy = (s, e, d) => {
    e.hp -= d; const c = W3(e.x + (e.w || 32) / 2, e.y + (e.h || 32) / 2); e.flash = 0.15;
    burst3d(c, [C.cyan, '#fff'], 10, { speed: 5, size: 0.12 });
    if (e.hp <= 0) { if (e.t === 'boss') killBoss(s, e); else kill(s, e, e.t === 'turret' ? 80 : 50); } else hx.hit();
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p; const lv = s.lv; const GY = NW_GY;
    s.t += dt; s.time += dt; p.inv = Math.max(0, p.inv - dt); p.star = Math.max(0, p.star - dt); p.bolt = Math.max(0, p.bolt - dt); p.cool = Math.max(0, p.cool - dt); p.buf = Math.max(0, p.buf - dt);
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const targetV = ax * 235; p.vx += (targetV - p.vx) * Math.min(1, dt * (ax ? 12 : 9)); if (ax) p.face = ax;
    lv.mv.forEach(m => { const nx = m.x0 + (Math.sin(s.t * m.spd + m.ph) * 0.5 + 0.5) * m.amp; m.dx = nx - m.cx; m.cx = nx; });
    if (p.ride) p.x += p.ride.dx;
    const grounded0 = p.coyote > 0; p.coyote -= dt;
    if (p.buf > 0 && p.coyote > 0) { p.vy = -770; p.buf = 0; p.coyote = 0; p.jumps = 1; burst3d(W3(p.x + PW / 2, p.y + PH), ['#fff', C.cyan], 8, { speed: 2.5, up: 1, g: 6, size: 0.13, life: 0.4 }); ring3d(W3(p.x + PW / 2, p.y + PH), '#fff', 8, { speed: 2.5, life: 0.3, size: 0.1 }); hx.tap(); }
    else if (p.buf > 0 && p.jumps < 2 && !grounded0) { p.vy = -700; p.buf = 0; p.jumps = 2; ring3d(W3(p.x + PW / 2, p.y + PH), C.cyan, 18, { speed: 4, life: 0.5, size: 0.14 }); burst3d(W3(p.x + PW / 2, p.y + PH), C.cyan, 8, { speed: 2, up: -1, g: 4, size: 0.12 }); hx.tick(); }
    p.vy += 2200 * dt; if (!input.jump && p.vy < -240) p.vy += 3400 * dt; p.vy = Math.min(p.vy, 1000);
    p.x = clamp(p.x + p.vx * dt, 0, lv.LEN - PW);
    const prevB = p.y + PH; p.y += p.vy * dt; const curB = p.y + PH;
    let landed = false; p.ride = null;
    if (p.vy >= 0) {
      const surfaces = [...lv.gr, ...lv.fl, ...lv.mv.map(m => ({ x: m.cx, y: m.y, w: m.w, m }))];
      for (const sf of surfaces) { if (p.x + PW > sf.x + 3 && p.x < sf.x + sf.w - 3 && prevB <= sf.y + 6 && curB >= sf.y) { p.y = sf.y - PH; p.vy = 0; landed = true; if (sf.m) p.ride = sf.m; break; } }
    }
    if (landed) { if (p.air) { burst3d(W3(p.x + PW / 2, p.y + PH), '#c8d0ff', 6, { speed: 2.2, up: 0.6, g: 5, size: 0.14, life: 0.4 }); ring3d(W3(p.x + PW / 2, p.y + PH + 2), '#c8d0ff', 8, { speed: 2.5, life: 0.3, size: 0.1 }); } p.coyote = 0.1; p.jumps = 0; }
    p.air = !landed;
    const spd = Math.abs(p.vx);
    p.walk += ((landed && spd > 40 ? 1 : 0) - p.walk) * Math.min(1, dt * 12);
    if (landed && spd > 120 && Math.random() < dt * 14) burst3d(W3(p.x + PW / 2 - p.face * 8, p.y + PH), '#8f98d8', 1, { speed: 1, up: 0.5, g: 3, size: 0.12, life: 0.4 });
    let dy = p.face > 0 ? -PI / 2 : PI / 2; let dd = dy - p.yaw; dd = ((dd + PI * 3) % (PI * 2)) - PI; p.yaw += dd * Math.min(1, dt * 14);
    if (p.y > NW_AH + 60) { fall(s); if (s.over) return; }
    s.c3 += (wx(p.x + PW / 2) - s.c3) * Math.min(1, dt * 8); s.cf += (p.face - s.cf) * Math.min(1, dt * 4);
    s.cy += (clamp(wy(p.y + PH), 0, 6) * 0.6 - s.cy) * Math.min(1, dt * 4);
    if (Math.random() < dt * 5) burst3d([s.c3 + (Math.random() - 0.5) * 22, 0.5 + Math.random() * 7, 1 + Math.random() * 3], [lv.theme ? '#fff' : TH[(s.n - 1) % 4].b, TH[(s.n - 1) % 4].a], 1, { speed: 0.3, g: 0.3, size: 0.09, life: 3 });
    lv.fg.forEach(f => { if (!f.on && p.x > f.x) { f.on = true; s.spawn = { x: f.x, y: GY - PH }; const c = W3(f.x, GY); ring3d(c, C.lime, 22, { speed: 5, life: 0.6 }); burst3d([c[0], 1.5, 0], [C.lime, '#fff'], 20, { speed: 4, up: 4, size: 0.14 }); pop(s, f.x, GY - 90, 'CHECKPOINT', C.lime, 18); hx.good(); } });
    lv.hz.forEach(h => { if (p.x + PW - 6 > h.x && p.x + 6 < h.x + h.w && p.y + PH > GY - 16) hurt(s, p.x < h.x + h.w / 2 ? -1 : 1); });
    lv.en.forEach(e => {
      if (!e.alive) return;
      e.flash = Math.max(0, (e.flash || 0) - dt);
      const w = e.w || 32, h = e.h || 32;
      if (e.t === 'walker') { e.x += e.vx * dt; if (e.x <= e.bx || e.x + w >= e.ex) { e.vx *= -1; e.x = clamp(e.x, e.bx, e.ex - w); } }
      else if (e.t === 'flyer') { e.ph += dt * 3; e.x += e.vx * dt; e.y = e.y0 + Math.sin(e.ph) * 40; if (e.x < p.x - 700) e.x = p.x + 700; }
      else if (e.t === 'hopper') { e.tm -= dt; e.vy = (e.vy || 0) + 1500 * dt; e.y += e.vy * dt; if (e.y >= GY - 30) { e.y = GY - 30; e.vy = 0; e.vx = 0; } if (e.tm <= 0 && e.y >= GY - 30) { e.tm = rand(1, 2); e.vy = -520; e.vx = Math.sign(p.x - e.x) * 90; } e.x += e.vx * dt; }
      else if (e.t === 'turret') { e.tm -= dt; if (e.tm <= 0 && Math.abs(p.x - e.x) < 380) { e.tm = 2; s.eb.push({ x: e.x + 16, y: e.y + 12, vx: Math.sign(p.x - e.x) * 190, vy: 0 }); burst3d(W3(e.x + 16, e.y + 12), C.pink, 6, { speed: 3, size: 0.12 }); } }
      else if (e.t === 'boss') {
        e.x += e.vx * dt; if (e.x <= e.bx || e.x + w >= e.ex) e.vx *= -1; e.vy += 1800 * dt; e.y += e.vy * dt; if (e.y >= GY - h) { if (e.vy > 300) { fx.shake(6, 0.2); ring3d(W3(e.x + w / 2, GY), '#ffb23d', 20, { speed: 6, life: 0.5 }); } e.y = GY - h; e.vy = 0; }
        e.jt -= dt; if (e.jt <= 0 && e.y >= GY - h) { e.jt = rand(1.6, 2.6); e.vy = -640; }
        e.tm -= dt; if (e.tm <= 0 && Math.abs(p.x - e.x) < 520) { e.tm = Math.max(1.2, 2.2 - s.n * 0.1); for (let k = -1; k <= 1; k++) s.eb.push({ x: e.x + w / 2, y: e.y + 20, vx: Math.sign(p.x - e.x || 1) * 200, vy: k * 80 }); hx.warn(); }
      }
      const hit = p.x + PW > e.x + 4 && p.x + 4 < e.x + w && p.y + PH > e.y + 4 && p.y + 4 < e.y + h;
      if (!hit) return;
      if (p.star > 0) { if (e.t === 'boss') dmgEnemy(s, e, 0.05); else kill(s, e, 50); return; }
      if (p.vy > 100 && p.y + PH < e.y + h * 0.6) { p.vy = -540; p.jumps = 1; ring3d(W3(p.x + PW / 2, p.y + PH), '#fff', 10, { speed: 3, life: 0.3 }); dmgEnemy(s, e, 1); }
      else hurt(s, p.x < e.x ? -1 : 1);
    });
    s.eb.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; if (Math.random() < 0.5) burst3d(W3(b.x, b.y), C.pink, 1, { speed: 0.4, size: 0.12, life: 0.3, g: 0 }); });
    s.eb = s.eb.filter(b => { if (b.x < p.x - 700 || b.x > p.x + 700 || b.y > NW_AH || b.y < 0) return false; if (b.x > p.x && b.x < p.x + PW && b.y > p.y && b.y < p.y + PH) { hurt(s, Math.sign(b.vx)); return false; } return true; });
    if (p.slash > 0) {
      p.slash = Math.max(0, p.slash - dt);
      if (p.slash > 0.05 && p.slash < 0.19) {
        const sx0 = p.face > 0 ? p.x + PW - 4 : p.x - 50, sx1 = sx0 + 54;
        lv.en.forEach(e => {
          if (!e.alive || p.slashSet.has(e.id)) return;
          const w = e.w || 32, h = e.h || 32;
          if (!(sx1 > e.x && sx0 < e.x + w && p.y + PH + 8 > e.y && p.y - 8 < e.y + h)) return;
          p.slashSet.add(e.id); dmgEnemy(s, e, 1); fx.shake(3, 0.1);
        });
      }
    }
    lv.co.forEach(c => { if (!c.got && Math.abs(c.x + 8 - (p.x + PW / 2)) < 22 && Math.abs(c.y + 8 - (p.y + PH / 2)) < 30) { c.got = true; s.score += 10; s.coins += 1; burst3d(W3(c.x + 8, c.y + 8), [C.amber, '#fff3b0'], 8, { speed: 3, up: 1, size: 0.12 }); hx.tick(); } });
    lv.pu.forEach(u => {
      if (!u.got && Math.abs(u.x + 12 - (p.x + PW / 2)) < 26 && Math.abs(u.y + 12 - (p.y + PH / 2)) < 32) {
        u.got = true; hx.good(); s.score += 20; const c = W3(u.x + 12, u.y + 12); ring3d(c, C.lime, 20, { speed: 4, life: 0.5 }); burst3d(c, [C.lime, '#fff'], 16, { speed: 4, up: 2, size: 0.14 });
        if (u.t === 'star') { p.star = 6; s.toast = { m: '⭐ INVENCIBLE', t: 1.6 }; } if (u.t === 'shield') { p.shield = true; s.toast = { m: '🛡️ ESCUDO', t: 1.6 }; }
        if (u.t === 'heart') { s.lives = Math.min(5, s.lives + 1); s.toast = { m: '❤️ +1 VIDA', t: 1.6 }; } if (u.t === 'bolt') { p.bolt = 8; s.toast = { m: '⚡ TAJOS RÁPIDOS', t: 1.6 }; }
      }
    });
    if (p.x > lv.end && !(lv.boss && lv.en.some(e => e.t === 'boss' && e.alive))) {
      const bonus = 200 + Math.max(0, Math.round(120 - s.time)) * 5; s.score += bonus; s.bonus = bonus; hx.win(); fx.flash('#fff', 0.35);
      burst3d(W3(lv.end, GY - 60), [C.amber, '#fff', TH[(s.n - 1) % 4].a], 60, { speed: 8, up: 5, size: 0.22, life: 1.2 });
      const kind = s.n >= 6 ? 'win' : 'clear';
      setRes({ isNew: submitBest(s.score), kind }); s.over = true; setPhase('over');
    }
  });

  const s = g.current; const p = s.p; const lv = s.lv; const th = TH[(s.n - 1) % TH.length];
  const buildScene = (t, cam) => {
    const objs = []; const cx = s.c3; const near = (x0, x1) => x1 > cx - 20 && x0 < cx + 24;
    lv.mv.forEach(m => {
      if (!near(wx(m.cx), wx(m.cx + m.w))) return;
      const x = wx(m.cx + m.w / 2), y = wy(m.y);
      objs.push({ id: `mv${m.id}`, k: 'box', p: [x, y - 0.18, 0], s: [m.w / NW_SC, 0.36, 3.0], c: C.amber, e: 0.5, recv: true, sh: true });
      objs.push({ id: `mv${m.id}t`, k: 'cone', p: [x, y - 0.65, 0], s: [0.8, 0.6, 0.8], r: [PI, 0, 0], c: '#ffe45e', e: 1 });
    });
    lv.fg.forEach((f, i) => {
      if (!near(wx(f.x), wx(f.x))) return; const x = wx(f.x);
      objs.push({ id: `fgp${i}`, k: 'cyl', p: [x, 1.2, 0], s: [0.1, 2.4, 0.1], c: '#dddddd' });
      objs.push({ id: `fgf${i}`, k: 'box', p: [x + 0.4, 2.0 + Math.sin(t * 4 + i) * 0.03, 0], s: [0.8, 0.5, 0.05], c: f.on ? C.lime : '#666677', e: f.on ? 0.9 : 0 });
      if (f.on) objs.push({ id: `fgb${i}`, k: 'cyl', p: [x, 4, 0], s: [0.2, 8, 0.2], c: C.lime, e: 1, o: 0.18 });
    });
    const bossAlive = lv.en.some(e => e.t === 'boss' && e.alive);
    if (near(wx(lv.end), wx(lv.end))) {
      const x = wx(lv.end);
      objs.push({ id: 'pt1', k: 'tor', p: [x, 2.6, 0], r: [0, 0, t * 1.5], n: 3.6, c: th.a, e: bossAlive ? 0.2 : 1, o: bossAlive ? 0.35 : 1 });
      objs.push({ id: 'pt2', k: 'tor', p: [x, 2.6, 0], r: [0, 0, -t * 2.2], n: 2.6, c: th.b, e: bossAlive ? 0.2 : 1, o: bossAlive ? 0.35 : 1 });
      objs.push({ id: 'pt3', k: 'sph', p: [x, 2.6, 0], n: 1.5, c: '#ffffff', e: 1, o: bossAlive ? 0.05 : 0.3 + 0.1 * Math.sin(t * 4) });
    }
    lv.co.forEach(c => { if (c.got || !near(wx(c.x), wx(c.x + 16))) return; objs.push(...coin(`co${c.id}`, [wx(c.x + 8), wy(c.y + 8), 0], { t: t + c.id, spin: t * 2.8 + c.id, n: 0.9, inst: 'moneda' })); });
    lv.pu.forEach(u => {
      if (u.got || !near(wx(u.x), wx(u.x + 24))) return; const x = wx(u.x + 12), y = wy(u.y + 12);
      const col = { star: '#ffd54a', shield: '#22e6ff', heart: '#ff4d6d', bolt: '#b57bff' }[u.t];
      objs.push(...gem(`pu${u.id}`, [x, y - 0.4, 0], { c: col, t, n: 1.3, bob: 0.15 }));
      objs.push({ id: `pur${u.id}`, k: 'ring', p: [x, y - 0.5, 0], r: [0, 0, 0], s: [1.2, 1.2, 1], c: col, e: 1, o: 0.4 });
    });
    lv.en.forEach(e => {
      if (!e.alive || !near(wx(e.x), wx(e.x + (e.w || 32)))) return;
      const w = e.w || 32, h = e.h || 32, x = wx(e.x + w / 2), feet = wy(e.y + h), id = `e${e.id}`, fl = e.flash > 0;
      if (e.t === 'walker') objs.push(...enemy(id, 'robot', [x, feet, 0], { yaw: e.vx > 0 ? -PI / 2 : PI / 2, t, walk: 1, n: 0.58, c: '#b86cff', flash: fl }));
      else if (e.t === 'hopper') objs.push(...enemy(id, 'slime', [x, feet + (e.vy < 0 ? 0.1 : 0), 0], { t, n: 0.8, c: '#3ccf7a', flash: fl, yaw: p.x < e.x ? PI / 2 : -PI / 2 }));
      else if (e.t === 'flyer') objs.push(...enemy(id, 'ovni', [x, wy(e.y + 16), 0], { t, n: 0.36, c: '#9ad8ff', flash: fl, beam: false }));
      else if (e.t === 'turret') {
        const dir = Math.sign(p.x - e.x || 1), B = Bld(id, [x, feet, 0], { flash: fl });
        B.add('base', 'box', [0, 0.28, 0], [0.9, 0.56, 0.9], '#4a4f6a', { m: { r: 0.4, m: 0.6 } }); B.add('stripe', 'box', [0, 0.3, 0.46], [0.7, 0.08, 0.02], C.pink, { e: 1, sh: false });
        B.add('head', 'sph', [0, 0.78, 0], 0.7, '#6a7090', { m: { r: 0.3, m: 0.6 } });
        B.add('barrel', 'cyl', [dir * 0.5, 0.8, 0], [0.18, 0.7, 0.18], '#2a2f45', { r: [0, 0, PI / 2] }); B.add('tip', 'sph', [dir * 0.86, 0.8, 0], 0.16, C.pink, { e: 1, sh: false });
        B.add('eye', 'sph', [dir * 0.18, 0.88, 0.3], 0.16, '#fff', { e: 1, sh: false });
        objs.push(...B.out);
      } else if (e.t === 'boss') {
        objs.push(...enemy(id, 'robot', [x, feet, 0], { yaw: p.x < e.x ? PI / 2 : -PI / 2, t, walk: e.y >= NW_GY - h ? 0.8 : 0, n: 2.0, c: '#d84a3a', flash: fl }));
        const B = Bld(id + 'x', [x, feet, 0], { yaw: p.x < e.x ? PI / 2 : -PI / 2, flash: fl });
        B.add('hl', 'cone', [-0.55, 4.5, 0], [0.5, 1.0, 0.5], C.amber, { e: 0.8 }); B.add('hr', 'cone', [0.55, 4.5, 0], [0.5, 1.0, 0.5], C.amber, { e: 0.8 });
        objs.push(...B.out);
      }
    });
    s.eb.forEach((b, i) => { objs.push({ id: `eb${i}`, k: 'sph', p: [wx(b.x), wy(b.y), 0.1], n: 0.38 + 0.06 * Math.sin(t * 20), c: C.pink, e: 1 }); objs.push({ id: `ebg${i}`, k: 'sph', p: [wx(b.x), wy(b.y), 0.1], n: 0.75, c: C.pink, e: 1, o: 0.25 }); });
    // guerrero: persona con casco visor, bufanda y katana de neón
    const px = wx(p.x + PW / 2), feet = wy(p.y + PH), blink = p.inv > 0 && Math.floor(p.inv * 12) % 2 === 0;
    const sl = p.slash > 0 ? 1 - p.slash / 0.22 : -1;
    const air = p.air, arms = sl >= 0 ? 1.1 - sl * 0.5 : air ? 2.4 : undefined;
    const pc = p.star > 0 ? C.amber : th.a;
    objs.push(...person('yo', [px, feet, 0], { yaw: p.yaw, t, walk: p.walk, arms, hat: 'helmet', band: '#222a48', shirt: p.star > 0 ? '#ffd54a' : '#262c52', pants: '#15192e', skin: '#e0b890', hair: '#101018', eyeC: th.b, lean: air ? 0.1 : p.walk * 0.12, flash: blink }));
    const B = Bld('yox', [px, feet, 0], { yaw: p.yaw, flash: blink });
    const sw = sl >= 0 ? -1.2 + 2.9 * sl : -0.3 + Math.sin(t * 10) * 0.05 * p.walk;
    const pv = [0.34, 1.2, -0.3], d = [0, cs(sw), -sn(sw)], bl = 1.15;
    B.add('hilt', 'cyl', [pv[0] - d[0] * 0.1, pv[1] - d[1] * 0.1, pv[2] - d[2] * 0.1], [0.07, 0.24, 0.07], '#20243a', { r: [-sw, 0, 0] });
    B.add('guard', 'box', [pv[0], pv[1], pv[2]], [0.3, 0.05, 0.1], th.b, { e: 0.6, r: [-sw, 0, 0] });
    B.add('blade', 'box', [pv[0] + d[0] * bl / 2, pv[1] + d[1] * bl / 2, pv[2] + d[2] * bl / 2], [0.07, bl, 0.025], '#e8ffff', { e: 1, r: [-sw, 0, 0], sh: false });
    B.add('glow', 'box', [pv[0] + d[0] * bl / 2, pv[1] + d[1] * bl / 2, pv[2] + d[2] * bl / 2], [0.16, bl, 0.1], th.b, { e: 1, r: [-sw, 0, 0], o: 0.3 });
    // bufanda
    const flap = Math.sin(t * 12) * 0.08 + p.walk * 0.25 + (air ? 0.2 : 0);
    for (let i = 0; i < 3; i++) B.add('sc' + i, 'box', [0, 1.46 - i * 0.04 - flap * i * 0.3, 0.2 + i * 0.28], [0.16, 0.1, 0.3], th.a, { e: 0.8, sh: false });
    B.add('belt', 'box', [0, 0.9, 0], [0.5, 0.07, 0.34], th.b, { e: 1, sh: false });
    objs.push(...B.out);
    // estela del tajo
    if (sl >= 0) for (let i = 0; i < 6; i++) {
      const a = -1.2 + 2.9 * Math.max(0, sl - i * 0.07), dd2 = [0, cs(a), -sn(a)], r = 1.3, X = Bld('arc' + i, [px, feet, 0], { yaw: p.yaw });
      X.add('s', 'box', [0.34, 1.2 + dd2[1] * r, -0.3 + dd2[2] * r], [0.06, 0.34, 0.2 - i * 0.02], th.b, { e: 1, o: 0.7 - i * 0.11, r: [-a, 0, 0] }); objs.push(...X.out);
    }
    if (p.shield) objs.push({ id: 'pshield', k: 'sph', p: [px, feet + 1, 0], n: 2.3, c: C.cyan, e: 0.3, o: 0.2 + 0.05 * Math.sin(t * 8) });
    if (p.star > 0) objs.push({ id: 'pstar', k: 'sph', p: [px, feet + 1, 0], n: 2.6, c: C.amber, e: 0.8, o: 0.16 });
    const sunDir = [-0.3, 0.6, -0.7];
    return {
      sky: { top: th.top, bottom: th.bot, sun: true, sunC: '#ffe9ff' }, fog: { c: th.bot, near: 30, far: 90 },
      light: { dir: sunDir, sun: '#ffd9ff', i: 1.7, sky: '#9a8aff', ground: '#2a1e5a', hi: 1.3 }, shadowR: 20,
      statics: lv.statics, objs, cam,
    };
  };
  const cam = { p: [s.c3 - 0.7 * s.cf, 3.5 + s.cy, 9.2], l: [s.c3 + 1.5 * s.cf, 1.5 + s.cy, 0], fov: 76 };
  s.camObj = cam;
  const t = phase === 'play' ? s.t : 0;
  const scene = buildScene(t, cam);
  const bossE = lv.en.find(e => e.t === 'boss' && e.alive && Math.abs(e.x - p.x) < 900);
  const kind = res.kind;
  return (
    <Game3D title="NEON WARRIOR" emoji="🥷" accent={th.a} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={phase === 'over' && kind === 'clear' ? nextLevel : start} scene={scene} menuScene={tt => buildScene(tt, scene.cam)} orbit={{ r: 8, h: 2.8, speed: 0.22, ly: 1.2, drop: 1.4 }}
      retryLabel={kind === 'clear' ? `NIVEL ${s.n + 1} →` : 'OTRA VEZ'}
      hud={<><Lives n={s.lives} max={Math.max(3, s.lives)} /><HudPill icon="🌆" value={`${s.n}/6`} label="NIVEL" color={th.a} /><HudPill icon="🪙" value={s.coins} color={C.amber} />{(p.shield || p.star > 0 || p.bolt > 0) ? <HudPill value={`${p.shield ? '🛡️' : ''}${p.star > 0 ? '⭐' + Math.ceil(p.star) : ''}${p.bolt > 0 ? '⚡' + Math.ceil(p.bolt) : ''}`} color={C.cyan} /> : null}</>}
      subtitle="Recorre la ciudad neón con espada, doble salto y mucho estilo"
      lines={['◀ ▶ mover · ⬆ saltar (toca de nuevo en el aire para el doble salto)', '🗡️ tajo de espada · también puedes pisar a los enemigos', '🚩 checkpoints · 🌀 portal al final · 👾 jefe cada 3 niveles', '⭐ invencible · 🛡️ escudo · ⚡ tajos más rápidos · ❤️ vida extra']}
      result={{ won: kind !== 'over', isNew: res.isNew, emoji: kind === 'win' ? '🏆' : kind === 'clear' ? '✨' : '💀', title: kind === 'win' ? '¡VICTORIA TOTAL!' : kind === 'clear' ? `NIVEL ${s.n} COMPLETO` : 'GAME OVER', subtitle: kind === 'clear' ? `Bonus +${s.bonus} · ${s.kills} enemigos · ${s.coins} monedas` : kind === 'win' ? `6 niveles superados · ${s.coins} monedas` : `Llegaste al nivel ${s.n}`, stats: [['NIVEL', s.n], ['ENEMIGOS', s.kills], ['MONEDAS', s.coins]] }}>
      {phase === 'play' && <>
        {bossE && <View pointerEvents="none" style={{ position: 'absolute', top: 4, left: 40, right: 40 }}><Text style={{ color: C.red, fontSize: 11, fontWeight: '900', textAlign: 'center', letterSpacing: 3, ...tglow('#000', 4) }}>JEFE</Text><Bar value={bossE.hp} max={bossE.maxHp} color={C.red} h={9} /></View>}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: '16%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 24, fontWeight: '900', ...tglow(th.a, 10) }}>{s.toast.m}</Text>}
        <ActionBtn testID="nw-left" icon="◀" color={th.a} size={68} onDown={() => { input.left = true; }} onUp={() => { input.left = false; }} style={{ left: 14, bottom: 28 }} />
        <ActionBtn testID="nw-right" icon="▶" color={th.a} size={68} onDown={() => { input.right = true; }} onUp={() => { input.right = false; }} style={{ left: 96, bottom: 28 }} />
        <ActionBtn testID="nw-slash" icon="🗡️" color={C.amber} size={64} onDown={slash} style={{ right: 106, bottom: 28 }} />
        <ActionBtn testID="nw-jump" icon="⬆" label="SALTAR" color={C.cyan} size={78} onDown={jumpPress} onUp={() => { input.jump = false; }} style={{ right: 16, bottom: 36 }} />
      </>}
    </Game3D>
  );
}
