/**
 * Neon Warrior 3D – plataformas en 3D con espada y doble salto, cámara lateral-detrás.
 * Niveles, físicas, enemigos, checkpoints y jefes son los del juego 2D (px). El mundo se dibuja
 * con 1 unidad = NW_SC px; el suelo está en y = 0. 🗡️ es un tajo de espada (sustituye al disparo).
 */
import React, { useReducer, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, Bar, GameScreen, Lives, Overlay, PlayArea, TouchBtn, alpha, clamp, glow, hx, pick, rand, tglow, uid, useBest, useFX, useLoop } from '../utils/kit';
import { World3D } from '../utils/World3D';

const NW_AH = 540;             // alto de referencia del nivel (px)
const NW_GY = NW_AH - 64;      // y del suelo (px)
const NW_SC = 40;              // px por unidad 3D
const NW_FOV = 60;
const nwWx = px => px / NW_SC;
const nwWy = py => (NW_GY - py) / NW_SC;

const nwProj = (cam, x, y, z) => {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const m = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / m, a[1] / m, a[2] / m]; };
  const d = [x - cam.p[0], y - cam.p[1], z - cam.p[2]];
  const f = norm([cam.l[0] - cam.p[0], cam.l[1] - cam.p[1], cam.l[2] - cam.p[2]]);
  const r = norm(cross(f, [0, 1, 0])); const u = cross(r, f);
  const zc = dot(d, f); if (zc < 0.2) return null;
  const k = (AREA_H / 2) / Math.tan(NW_FOV * Math.PI / 360) / zc;
  return [AREA_W / 2 + dot(d, r) * k, AREA_H / 2 - dot(d, u) * k];
};
// posición en pantalla (px del PlayArea) de un punto del nivel 2D, para partículas y textos
const nwScr = (s, px, py) => { const q = s && s.camObj && nwProj(s.camObj, nwWx(px), nwWy(py), 0); return q || [AREA_W / 2, AREA_H / 2]; };

// Botón de control mantenido (multi-toque real)
function NwPad({ testID, label, color, big, onDown, onUp }) {
  const d = big ? 74 : 62;
  return (
    <TouchBtn testID={testID} onDown={onDown} onUp={onUp} style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: alpha(color, 0.16), borderWidth: 2, borderColor: alpha(color, 0.8), alignItems: 'center', justifyContent: 'center', ...glow(color, 8, 0.4) }}>
      <Text style={{ color, fontSize: big ? 30 : 24, fontWeight: '900' }}>{label}</Text>
    </TouchBtn>
  );
}

// Objetos 3D del nivel visibles desde la cámara (solo lo que cae en la ventana, para ir fluido)
function nwObjects(s, TH) {
  const objs = []; const lv = s.lv; const p = s.p; const PW = 28, PH = 38;
  const cx = s.c3; const near = (x0, x1) => x1 > cx - 17 && x0 < cx + 17; // en unidades
  // fondo: edificios lejanos (dan profundidad al desplazarse)
  for (let j = Math.floor((cx - 18) / 6); j <= Math.floor((cx + 18) / 6); j++) {
    const bx = j * 6 + ((j * 13) % 4) * 0.7; const bh = 2.5 + ((j * 37) % 5) * 0.9;
    objs.push({ id: `bl${j}`, k: 'box', p: [bx, bh / 2 - 0.6, -9], s: [2.4, bh, 1.5], c: j % 2 ? TH.a : TH.b, o: 0.45, e: 0.12 });
  }
  // suelo y plataformas
  lv.gr.forEach((sf, i) => {
    if (!near(nwWx(sf.x), nwWx(sf.x + sf.w))) return;
    objs.push({ id: `g${i}`, k: 'box', p: [nwWx(sf.x + sf.w / 2), -1.5, 0], s: [sf.w / NW_SC, 3, 4], c: '#1b1f3b', e: 0.02 });
    objs.push({ id: `gt${i}`, k: 'box', p: [nwWx(sf.x + sf.w / 2), 0.06, 0], s: [sf.w / NW_SC, 0.12, 4.05], c: TH.b, e: 0.6 });
  });
  lv.fl.forEach((f, i) => {
    if (!near(nwWx(f.x), nwWx(f.x + f.w))) return;
    objs.push({ id: `f${i}`, k: 'box', p: [nwWx(f.x + f.w / 2), nwWy(f.y + 7), 0], s: [f.w / NW_SC, 0.35, 1.6], c: TH.a, e: 0.35 });
  });
  lv.mv.forEach((m, i) => {
    if (!near(nwWx(m.cx), nwWx(m.cx + m.w))) return;
    objs.push({ id: `mv${m.id}`, k: 'box', p: [nwWx(m.cx + m.w / 2), nwWy(m.y + 7), 0], s: [m.w / NW_SC, 0.35, 1.6], c: C.amber, e: 0.4 });
  });
  lv.hz.forEach((h, i) => {
    if (!near(nwWx(h.x), nwWx(h.x + h.w))) return;
    for (let k = 0; k < Math.floor(h.w / 16); k++) objs.push({ id: `hz${i}_${k}`, k: 'cone', p: [nwWx(h.x + k * 16 + 8), 0.3, 0], s: [0.36, 0.6, 0.36], c: C.red, e: 0.5 });
  });
  lv.fg.forEach((f, i) => {
    if (!near(nwWx(f.x), nwWx(f.x))) return;
    objs.push({ id: `fgp${i}`, k: 'box', p: [nwWx(f.x), 1.1, 0], s: [0.08, 2.2, 0.08], c: '#dddddd', e: 0.1 });
    objs.push({ id: `fgf${i}`, k: 'box', p: [nwWx(f.x) + 0.28, 1.95, 0], s: [0.5, 0.3, 0.06], c: f.on ? C.lime : '#666677', e: f.on ? 0.6 : 0 });
  });
  const bossAlive = lv.en.some(e => e.t === 'boss' && e.alive);
  if (near(nwWx(lv.end), nwWx(lv.end))) {
    objs.push({ id: 'portal', k: 'tor', p: [nwWx(lv.end), 2.4, 0], n: 3.2, c: TH.a, e: 0.8, o: bossAlive ? 0.3 : 1 });
  }
  lv.co.forEach(c => {
    if (c.got || !near(nwWx(c.x), nwWx(c.x + 16))) return;
    objs.push({ id: `co${c.id}`, k: 'cyl', p: [nwWx(c.x + 8), nwWy(c.y + 8), 0.1], s: [0.45, 0.1, 0.45], r: [Math.PI / 2, 0, 0], c: C.amber, e: 0.5 });
  });
  lv.pu.forEach(u => {
    if (u.got || !near(nwWx(u.x), nwWx(u.x + 24))) return;
    const x = nwWx(u.x + 12), y = nwWy(u.y + 12);
    if (u.t === 'star') objs.push({ id: `pu${u.id}`, k: 'box', p: [x, y, 0], s: [0.5, 0.5, 0.5], r: [Math.PI / 4, Math.PI / 4, 0], c: C.amber, e: 0.8 });
    else if (u.t === 'shield') objs.push({ id: `pu${u.id}`, k: 'sph', p: [x, y, 0], n: 0.6, c: C.cyan, e: 0.4, o: 0.8 });
    else if (u.t === 'heart') objs.push({ id: `pu${u.id}`, k: 'sph', p: [x, y, 0], n: 0.5, c: C.red, e: 0.5 });
    else objs.push({ id: `pu${u.id}`, k: 'cone', p: [x, y, 0], s: [0.4, 0.6, 0.4], c: C.violet, e: 0.7 });
  });
  lv.en.forEach(e => {
    if (!e.alive || !near(nwWx(e.x), nwWx(e.x + (e.w || 32)))) return;
    const w = e.w || 32, h = e.h || 32; const x = nwWx(e.x + w / 2), y = nwWy(e.y + h / 2), id = `e${e.id}`;
    if (e.t === 'walker') {
      objs.push({ id, k: 'box', p: [x, y, 0], s: [0.8, 0.8, 0.8], c: '#c85cff', e: 0.25 });
      objs.push({ id: `${id}a`, k: 'sph', p: [x - 0.18, y + 0.1, 0.42], n: 0.18, c: '#ffffff', e: 1 });
      objs.push({ id: `${id}b`, k: 'sph', p: [x + 0.18, y + 0.1, 0.42], n: 0.18, c: '#ffffff', e: 1 });
    } else if (e.t === 'flyer') {
      objs.push({ id, k: 'cyl', p: [x, y, 0], s: [0.9, 0.2, 0.9], c: '#8fcfff', e: 0.4 });
      objs.push({ id: `${id}d`, k: 'sph', p: [x, y + 0.22, 0], n: 0.45, c: '#b8f0ff', e: 0.3, o: 0.85 });
    } else if (e.t === 'hopper') objs.push({ id, k: 'box', p: [x, y, 0], s: [0.7, 0.55, 0.7], c: '#3ccf7a', e: 0.2 });
    else if (e.t === 'turret') {
      objs.push({ id, k: 'box', p: [x, y, 0], s: [0.8, 0.8, 0.8], c: '#8a8fa0', e: 0.1 });
      objs.push({ id: `${id}g`, k: 'box', p: [x + 0.45 * Math.sign(p.x - e.x || 1), y + 0.1, 0], s: [0.5, 0.18, 0.18], c: C.pink, e: 0.6 });
    } else if (e.t === 'boss') {
      objs.push({ id, k: 'box', p: [x, y, 0], s: [w / NW_SC, h / NW_SC, 1.2], c: C.red, e: 0.25 });
      objs.push({ id: `${id}h1`, k: 'cone', p: [x - 0.4, nwWy(e.y) + 0.45, 0], s: [0.3, 0.7, 0.3], c: C.amber, e: 0.4 });
      objs.push({ id: `${id}h2`, k: 'cone', p: [x + 0.4, nwWy(e.y) + 0.45, 0], s: [0.3, 0.7, 0.3], c: C.amber, e: 0.4 });
      objs.push({ id: `${id}ea`, k: 'sph', p: [x - 0.3, y + 0.3, 0.62], n: 0.22, c: '#ffffff', e: 1 });
      objs.push({ id: `${id}eb`, k: 'sph', p: [x + 0.3, y + 0.3, 0.62], n: 0.22, c: '#ffffff', e: 1 });
    }
  });
  s.eb.forEach((b, i) => { if (near(nwWx(b.x), nwWx(b.x))) objs.push({ id: `eb${i}`, k: 'sph', p: [nwWx(b.x), nwWy(b.y), 0.1], n: 0.3, c: C.pink, e: 1 }); });
  // jugador: cuerpo, visor, escudo y espada (gira durante el tajo)
  const px = nwWx(p.x + PW / 2), feet = nwWy(p.y + PH), f = p.face || 1;
  const blink = p.inv > 0 && Math.floor(p.inv * 12) % 2 ? 0.25 : 1;
  const body = p.star > 0 ? C.amber : TH.a;
  objs.push({ id: 'pb', k: 'box', p: [px, feet + 0.42, 0], s: [0.6, 0.8, 0.5], c: body, e: p.star > 0 ? 0.6 : 0.15, o: blink });
  objs.push({ id: 'ph', k: 'sph', p: [px, feet + 1.0, 0], n: 0.46, c: '#ffd9b0', o: blink });
  objs.push({ id: 'pv', k: 'box', p: [px + 0.12 * f, feet + 1.02, 0.22], s: [0.42, 0.12, 0.2], c: TH.b, e: 0.9, o: blink });
  if (p.shield) objs.push({ id: 'pshield', k: 'sph', p: [px, feet + 0.6, 0], n: 1.5, c: C.cyan, e: 0.2, o: 0.22 });
  const swing = p.slash > 0 ? -1.2 + 2.8 * (1 - p.slash / 0.22) : -0.25;
  const pivot = [px + f * 0.22, feet + 0.7, 0.25];
  const d = [f * Math.sin(swing), Math.cos(swing), 0];
  objs.push({ id: 'pespada', k: 'box', p: [pivot[0] + d[0] * 0.45, pivot[1] + d[1] * 0.45, pivot[2]], s: [0.1, 0.9, 0.1], r: [0, 0, -f * swing], c: '#dffcff', e: 0.9 });
  return objs;
}

const NW_THEMES = [
  { bg: '#05051a', a: C.pink, b: C.cyan, name: 'CIUDAD NEÓN' }, { bg: '#04140f', a: C.lime, b: C.cyan, name: 'BOSQUE DIGITAL' },
  { bg: '#180606', a: C.orange, b: C.amber, name: 'FÁBRICA ARDIENTE' }, { bg: '#100618', a: C.violet, b: C.pink, name: 'NÚCLEO CUÁNTICO' },
];

export function NeonWarrior3D({ onExit }) {
  const GY = NW_GY, PW = 28, PH = 38;
  const fx = useFX();
  const fxw = {
    burst: (x, y, ...r) => { const q = nwScr(g.current, x, y); fx.burst(q[0], q[1], ...r); },
    pop: (x, y, ...r) => { const q = nwScr(g.current, x, y); fx.pop(q[0], q[1], ...r); },
    ring: (x, y, ...r) => { const q = nwScr(g.current, x, y); fx.ring(q[0], q[1], ...r); },
    shake: (...r) => fx.shake(...r), flash: (...r) => fx.flash(...r), clear: () => fx.clear(),
  };
  const [best, submitBest] = useBest('warrior');
  const [phase, setPhase] = useState('ready');          // ready | play | clear | over | win
  const [res, setRes] = useState({ isNew: false });
  const input = useRef({ left: false, right: false, jump: false }).current;
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);

  const genLevel = n => {
    const LEN = 2600 + n * 700;
    const gr = [{ x: 0, y: GY, w: 380 }]; const fl = []; const mv = []; const hz = []; const en = []; const co = []; const pu = []; const fg = [];
    let x = 380; let sinceFlag = 0; const gapMax = Math.min(170, 110 + n * 10);
    const flat = (w, ground = true) => { if (ground) gr.push({ x, y: GY, w }); const nE = Math.floor(rand(0, 1 + n * 0.5)); for (let k = 0; k < nE; k++) { const t = Math.random(); const ex = x + rand(60, w - 60); if (t < 0.5) en.push({ id: uid(), t: 'walker', x: ex, y: GY - 30, vx: rand(50, 80) * (Math.random() < 0.5 ? 1 : -1), hp: 1, bx: x + 10, ex: x + w - 10, alive: true }); else if (t < 0.75) en.push({ id: uid(), t: 'hopper', x: ex, y: GY - 30, vx: 0, vy: 0, hp: 1, alive: true, tm: rand(0.5, 1.5) }); else en.push({ id: uid(), t: 'turret', x: ex, y: GY - 34, hp: 2, maxHp: 2, alive: true, tm: rand(0.5, 1.5) }); } for (let k = 0; k < 4; k++) co.push({ id: uid(), x: x + 40 + k * 40, y: GY - 40 - (k === 1 || k === 2 ? 22 : 0), got: false }); x += w; };
    while (x < LEN) {
      const r = Math.random(); const w = rand(240, 400);
      if (r < 0.28) flat(w);
      else if (r < 0.52) { const gap = rand(90, gapMax); if (Math.random() < 0.6) { fl.push({ x: x + gap / 2 - 40, y: GY - rand(90, 140), w: 80 }); co.push({ id: uid(), x: x + gap / 2 - 8, y: GY - 170, got: false }); } x += gap; flat(w); }
      else if (r < 0.66) { gr.push({ x, y: GY, w }); hz.push({ x: x + w / 2 - 40, w: rand(56, 90), y: GY }); for (let k = 0; k < 3; k++) co.push({ id: uid(), x: x + w / 2 - 36 + k * 30, y: GY - 120 + (k === 1 ? -16 : 0), got: false }); x += w; }
      else if (r < 0.8) { gr.push({ x, y: GY, w: w + 60 }); for (let k = 0; k < 4; k++) { fl.push({ x: x + 40 + k * 90, y: GY - 70 - k * 38, w: 70 }); co.push({ id: uid(), x: x + 66 + k * 90, y: GY - 108 - k * 38, got: false }); } x += w + 60; }
      else if (r < 0.9) { const gap = rand(190, 250); mv.push({ id: uid(), x0: x + 30, y: GY - 20, w: 90, amp: gap - 150, spd: rand(0.8, 1.2), ph: 0, cx: x + 30 }); x += gap; flat(w); }
      else { flat(w + 80); if (n > 1) { const t = Math.random() < 0.5 ? 'flyer' : 'flyer'; en.push({ id: uid(), t, x: x - w / 2, y: GY - 130, y0: GY - 130, hp: 1, alive: true, ph: Math.random() * 6, vx: -60 }); } }
      sinceFlag += w; if (sinceFlag > 1200) { fg.push({ x: x - 60, y: GY, on: false }); sinceFlag = 0; }
      if (Math.random() < 0.28) pu.push({ id: uid(), t: pick(['star', 'shield', 'heart', 'bolt']), x: x - w / 2, y: GY - 80 - rand(0, 40), got: false });
    }
    const boss = n % 3 === 0;
    gr.push({ x, y: GY, w: 640 }); const end = x + 540;
    if (boss) en.push({ id: uid(), t: 'boss', x: x + 380, y: GY - 74, w: 70, h: 74, hp: 20 + n * 3, maxHp: 20 + n * 3, alive: true, vx: -90, bx: x + 40, ex: x + 620, tm: 2, jt: 2.2, vy: 0 });
    return { LEN: x + 640, gr, fl, mv, hz, en, co, pu, fg, end, boss };
  };
  const initState = (n, score, lives) => {
    const lv = genLevel(n);
    return { n, lv, score, lives, p: { x: 60, y: GY - PH, vx: 0, vy: 0, jumps: 0, coyote: 0, buf: 0, face: 1, inv: 0, shield: false, star: 0, bolt: 0, cool: 0, ride: null, slash: 0, slashSet: null }, cam: 0, c3: 1.5, cf: 1, bul: [], eb: [], t: 0, time: 0, spawn: { x: 60, y: GY - PH }, coins: 0, kills: 0, over: false, held: false };
  };
  if (!g.current) g.current = initState(1, 0, 3);
  const start = () => { fxw.clear(); g.current = initState(1, 0, 3); setPhase('play'); };
  const nextLevel = () => { const s = g.current; if (s.n >= 6) { setPhase('win'); return; } const lives = Math.min(5, s.lives + 1); g.current = initState(s.n + 1, s.score, lives); setPhase('play'); };
  const jumpPress = () => { const s = g.current; input.jump = true; s.p.buf = 0.13; };
  const jumpRelease = () => { input.jump = false; };
  // Espada: un tajo que golpea a todo lo que está delante durante ~0.2 s (la ⚡ acorta el tiempo entre tajos)
  const slash = () => { const s = g.current; const p = s.p; if (phase !== 'play' || p.cool > 0) return; p.slash = 0.22; p.slashSet = new Set(); p.cool = p.bolt > 0 ? 0.14 : 0.3; hx.tap(); };
  const hurt = (s, push) => {
    const p = s.p; if (p.inv > 0 || p.star > 0) return;
    if (p.shield) { p.shield = false; p.inv = 1; fxw.ring(p.x + PW / 2, p.y + PH / 2, C.cyan, 60); hx.warn(); return; }
    s.lives -= 1; p.inv = 1.6; p.vy = -420; p.vx = push * 280; fxw.burst(p.x + PW / 2, p.y + PH / 2, C.red, 14, 220); fxw.shake(7, 0.25); fxw.flash(C.red, 0.25); hx.bad();
    if (s.lives <= 0) { s.over = true; hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  };
  const fall = s => {
    const p = s.p; s.lives -= 1; hx.bad(); fxw.shake(8, 0.3); fxw.flash(C.red, 0.3);
    if (s.lives <= 0) { s.over = true; hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
    p.x = s.spawn.x; p.y = s.spawn.y - 40; p.vx = 0; p.vy = 0; p.inv = 1.6;
  };
  const kill = (s, e, pts) => { e.alive = false; s.score += pts; s.kills += 1; fxw.burst(e.x + 16, e.y + 16, C.amber, 12, 220); fxw.pop(e.x + 16, e.y - 6, `+${pts}`, C.text, 15); hx.hit(); };

  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p; const lv = s.lv;
    s.t += dt; s.time += dt; p.inv = Math.max(0, p.inv - dt); p.star = Math.max(0, p.star - dt); p.bolt = Math.max(0, p.bolt - dt); p.cool = Math.max(0, p.cool - dt); p.buf = Math.max(0, p.buf - dt);
    const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const targetV = ax * 235; p.vx += (targetV - p.vx) * Math.min(1, dt * (ax ? 12 : 9)); if (ax) p.face = ax;
    // plataformas móviles
    lv.mv.forEach(m => { const nx = m.x0 + (Math.sin(s.t * m.spd + m.ph) * 0.5 + 0.5) * m.amp; m.dx = nx - m.cx; m.cx = nx; });
    if (p.ride) { p.x += p.ride.dx; }
    const grounded0 = p.coyote > 0;
    p.coyote -= dt;
    if (p.buf > 0 && p.coyote > 0) { p.vy = -770; p.buf = 0; p.coyote = 0; p.jumps = 1; fxw.burst(p.x + PW / 2, p.y + PH, '#fff', 5, 100, 0.3, 3); hx.tap(); }
    else if (p.buf > 0 && p.jumps < 2 && !grounded0) { p.vy = -700; p.buf = 0; p.jumps = 2; fxw.ring(p.x + PW / 2, p.y + PH, C.cyan, 30); hx.tick(); }
    p.vy += 2200 * dt; if (!input.jump && p.vy < -240) p.vy += 3400 * dt; p.vy = Math.min(p.vy, 1000);
    p.x = clamp(p.x + p.vx * dt, 0, lv.LEN - PW);
    const prevB = p.y + PH; p.y += p.vy * dt; const curB = p.y + PH;
    let landed = false; p.ride = null;
    if (p.vy >= 0) {
      const surfaces = [...lv.gr, ...lv.fl.map(f => ({ ...f })), ...lv.mv.map(m => ({ x: m.cx, y: m.y, w: m.w, m }))];
      for (const sf of surfaces) { if (p.x + PW > sf.x + 3 && p.x < sf.x + sf.w - 3 && prevB <= sf.y + 6 && curB >= sf.y) { p.y = sf.y - PH; p.vy = 0; landed = true; if (sf.m) p.ride = sf.m; break; } }
    }
    if (landed) { p.coyote = 0.1; p.jumps = 0; }
    if (p.y > NW_AH + 60) { fall(s); if (s.over) return; }
    // cámara
    s.cam += (clamp(p.x - AREA_W * 0.35, 0, lv.LEN - AREA_W) - s.cam) * Math.min(1, dt * 8);
    s.c3 += (nwWx(p.x + PW / 2) - s.c3) * Math.min(1, dt * 8); s.cf += (p.face - s.cf) * Math.min(1, dt * 5);
    // banderas
    lv.fg.forEach(f => { if (!f.on && p.x > f.x) { f.on = true; s.spawn = { x: f.x, y: GY - PH }; fxw.pop(f.x, GY - 80, 'CHECKPOINT', C.lime, 14); hx.good(); } });
    // pinchos
    lv.hz.forEach(h => { if (p.x + PW - 6 > h.x && p.x + 6 < h.x + h.w && p.y + PH > GY - 16) hurt(s, p.x < h.x + h.w / 2 ? -1 : 1); });
    // enemigos
    const boss = lv.en.find(e => e.t === 'boss' && e.alive);
    lv.en.forEach(e => {
      if (!e.alive) return;
      const w = e.w || 32, h = e.h || 32;
      if (e.t === 'walker') { e.x += e.vx * dt; if (e.x <= e.bx || e.x + w >= e.ex) { e.vx *= -1; e.x = clamp(e.x, e.bx, e.ex - w); } }
      else if (e.t === 'flyer') { e.ph += dt * 3; e.x += e.vx * dt; e.y = e.y0 + Math.sin(e.ph) * 40; if (e.x < s.cam - 200) e.x = s.cam + AREA_W + 100; }
      else if (e.t === 'hopper') { e.tm -= dt; e.vy = (e.vy || 0) + 1500 * dt; e.y += e.vy * dt; if (e.y >= GY - 30) { e.y = GY - 30; e.vy = 0; e.vx = 0; } if (e.tm <= 0 && e.y >= GY - 30) { e.tm = rand(1, 2); e.vy = -520; e.vx = Math.sign(p.x - e.x) * 90; } e.x += e.vx * dt; }
      else if (e.t === 'turret') { e.tm -= dt; if (e.tm <= 0 && Math.abs(p.x - e.x) < 380 && e.x > s.cam - 40 && e.x < s.cam + AREA_W) { e.tm = 2; s.eb.push({ x: e.x + 16, y: e.y + 12, vx: Math.sign(p.x - e.x) * 190, vy: 0 }); } }
      else if (e.t === 'boss') {
        e.x += e.vx * dt; if (e.x <= e.bx || e.x + w >= e.ex) e.vx *= -1; e.vy += 1800 * dt; e.y += e.vy * dt; if (e.y >= GY - h) { e.y = GY - h; e.vy = 0; }
        e.jt -= dt; if (e.jt <= 0 && e.y >= GY - h) { e.jt = rand(1.6, 2.6); e.vy = -640; }
        e.tm -= dt; if (e.tm <= 0 && Math.abs(p.x - e.x) < 520) { e.tm = Math.max(1.2, 2.2 - s.n * 0.1); for (let k = -1; k <= 1; k++) s.eb.push({ x: e.x + w / 2, y: e.y + 20, vx: Math.sign(p.x - e.x || 1) * 200, vy: k * 80 }); }
      }
      const hit = p.x + PW > e.x + 4 && p.x + 4 < e.x + w && p.y + PH > e.y + 4 && p.y + 4 < e.y + h;
      if (!hit) return;
      if (p.star > 0) { if (e.t === 'boss') { e.hp -= 1; } else kill(s, e, 50); return; }
      if (p.vy > 100 && p.y + PH < e.y + h * 0.6) {
        e.hp -= 1; p.vy = -540; p.jumps = 1; fxw.burst(e.x + w / 2, e.y, '#fff', 6, 120, 0.3, 3);
        if (e.hp <= 0) { if (e.t === 'boss') { s.score += 500; fxw.burst(e.x + w / 2, e.y + h / 2, C.amber, 40, 360, 1, 7); fxw.flash('#fff', 0.5); fxw.shake(12, 0.5); hx.win(); e.alive = false; } else kill(s, e, e.t === 'turret' ? 80 : 50); } else hx.hit();
      } else hurt(s, p.x < e.x ? -1 : 1);
    });
    s.eb.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; });
    s.eb = s.eb.filter(b => { if (b.x < s.cam - 30 || b.x > s.cam + AREA_W + 30 || b.y > NW_AH || b.y < 0) return false; if (b.x > p.x && b.x < p.x + PW && b.y > p.y && b.y < p.y + PH) { hurt(s, Math.sign(b.vx)); return false; } return true; });
    // espada: golpea a los enemigos delante del jugador mientras dura el tajo
    if (p.slash > 0) {
      p.slash = Math.max(0, p.slash - dt);
      if (p.slash > 0.05 && p.slash < 0.19) {
        const sx0 = p.face > 0 ? p.x + PW - 4 : p.x - 50, sx1 = sx0 + 54;
        lv.en.forEach(e => {
          if (!e.alive || p.slashSet.has(e.id)) return;
          const w = e.w || 32, h = e.h || 32;
          if (!(sx1 > e.x && sx0 < e.x + w && p.y + PH + 8 > e.y && p.y - 8 < e.y + h)) return;
          p.slashSet.add(e.id); e.hp -= 1; fxw.burst(e.x + w / 2, e.y + h / 2, C.cyan, 8, 160, 0.3, 4); hx.hit();
          if (e.hp <= 0) {
            if (e.t === 'boss') { s.score += 500; fxw.burst(e.x + w / 2, e.y + h / 2, C.amber, 40, 360, 1, 7); fxw.flash('#fff', 0.5); fxw.shake(12, 0.5); hx.win(); e.alive = false; }
            else kill(s, e, e.t === 'turret' ? 80 : 50);
          }
        });
      }
    }
    // monedas y poderes
    lv.co.forEach(c => { if (!c.got && Math.abs(c.x + 8 - (p.x + PW / 2)) < 22 && Math.abs(c.y + 8 - (p.y + PH / 2)) < 30) { c.got = true; s.score += 10; s.coins += 1; fxw.burst(c.x, c.y, C.amber, 5, 120, 0.3, 3); hx.tick(); } });
    lv.pu.forEach(u => { if (!u.got && Math.abs(u.x + 12 - (p.x + PW / 2)) < 26 && Math.abs(u.y + 12 - (p.y + PH / 2)) < 32) { u.got = true; hx.good(); s.score += 20; fxw.ring(u.x, u.y, C.lime, 50); if (u.t === 'star') { p.star = 6; fxw.pop(u.x, u.y - 10, 'INVENCIBLE', C.amber, 15); } if (u.t === 'shield') { p.shield = true; fxw.pop(u.x, u.y - 10, 'ESCUDO', C.cyan, 15); } if (u.t === 'heart') { s.lives = Math.min(5, s.lives + 1); fxw.pop(u.x, u.y - 10, '+1 VIDA', C.red, 15); } if (u.t === 'bolt') { p.bolt = 8; fxw.pop(u.x, u.y - 10, 'DISPARO RÁPIDO', C.violet, 14); } } });
    // meta
    if (p.x > lv.end && !(lv.boss && lv.en.some(e => e.t === 'boss' && e.alive))) {
      const bonus = 200 + Math.max(0, Math.round(120 - s.time)) * 5; s.score += bonus; s.bonus = bonus; hx.win(); fxw.flash('#fff', 0.35);
      submitBest(s.score); setPhase(s.n >= 6 ? 'win' : 'clear');
    }
  });

  const TH = NW_THEMES[(g.current.n - 1) % NW_THEMES.length];
  const s = g.current; const p = s.p; const lv = s.lv;
  // cámara lateral-detrás: sigue al jugador y se adelanta hacia donde mira
  const cam = { p: [s.c3 - 1.6 * s.cf, 3.5, 10.5], l: [s.c3 + 2.2 * s.cf, 1.5, 0], fov: NW_FOV };
  s.camObj = cam;
  const scene = { bg: TH.bg, fog: { c: TH.bg, near: 22, far: 48 }, objs: nwObjects(s, TH), cam };
  const nBoss = lv.en.find(e => e.t === 'boss' && e.alive);
  return (
    <GameScreen title="NEON WARRIOR" emoji="🥷" accent={TH.a} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={Math.max(3, s.lives)} /><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: TH.a, fontWeight: '900' }}>{s.n}/6</Text> · {TH.name}</Text><Text style={{ color: C.cyan, fontSize: 12, fontWeight: '800' }}>{p.shield ? '🛡️ ' : ''}{p.star > 0 ? `⭐${Math.ceil(p.star)} ` : ''}{p.bolt > 0 ? `⚡${Math.ceil(p.bolt)}` : ''}</Text></>}>
      <PlayArea fx={fx} bg={TH.bg} border={alpha(TH.a, 0.4)}>
        <World3D scene={scene} />
        {nBoss && <View pointerEvents="none" style={{ position: 'absolute', top: 8, left: 40, right: 40 }}><Text style={{ color: C.red, fontSize: 11, fontWeight: '900', textAlign: 'center', letterSpacing: 2 }}>JEFE</Text><Bar value={nBoss.hp} max={nBoss.maxHp} color={C.red} h={8} /></View>}
        {phase === 'play' && (
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <NwPad testID="nw-left" label="◀" color={TH.a} onDown={() => { input.left = true; }} onUp={() => { input.left = false; }} />
              <NwPad testID="nw-right" label="▶" color={TH.a} onDown={() => { input.right = true; }} onUp={() => { input.right = false; }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-end' }}>
              <NwPad testID="nw-slash" label="🗡️" color={C.amber} onDown={slash} onUp={() => {}} />
              <NwPad testID="nw-jump" label="⬆" color={C.cyan} big onDown={jumpPress} onUp={jumpRelease} />
            </View>
          </View>
        )}
        <Overlay show={phase !== 'play'} kind={phase === 'clear' ? 'win' : phase} emoji={phase === 'win' ? '🏆' : phase === 'clear' ? '✨' : phase === 'over' ? '💀' : '🥷'}
          title={phase === 'win' ? '¡VICTORIA TOTAL!' : phase === 'clear' ? `NIVEL ${s.n} COMPLETO` : phase === 'over' ? 'GAME OVER' : 'NEON WARRIOR 3D'}
          subtitle={phase === 'clear' ? `Bonus +${s.bonus || 0} · ${s.kills} enemigos · ${s.coins} monedas` : phase === 'win' ? `6 niveles superados · ${s.coins} monedas` : phase === 'over' ? `Llegaste al nivel ${s.n}` : '6 niveles · 2 jefes · saltos dobles'}
          score={s.score} best={best} isNew={res.isNew} accent={TH.a} startLabel={phase === 'clear' ? `NIVEL ${s.n + 1} →` : undefined} onStart={phase === 'clear' ? nextLevel : start} onExit={onExit}
          lines={phase === 'ready' ? ['◀ ▶ mover · ⬆ saltar (toca de nuevo en el aire)', '🗡️ tajo de espada · pisa enemigos o golpéalos', '🚩 checkpoints · 🌀 portal de salida', '⭐ invencible · 🛡️ escudo · ⚡ tajos más rápidos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
