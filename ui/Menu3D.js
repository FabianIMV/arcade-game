/**
 * Menu3D.js – menú principal como ESCENA 3D a pantalla completa: una rotonda arcade de neón con una
 * máquina recreativa por juego (instancing). La cámara está dentro del anillo y gira al deslizar el dedo;
 * la máquina del centro es la «enfocada» y muestra su tarjeta (nombre, descripción, récord, JUGAR, favorito).
 *
 *   <Menu3D games={GAMES} categories={CATEGORIES} onPick={id => …} />
 *
 * - El GL (World3D) vive solo mientras el menú está montado: al abrir un juego se desmonta (un único contexto GL).
 * - La física del carrusel se integra dentro de getScene (mismo frame que el render) y los textos 2D
 *   (emoji / nombre sobre cada máquina) se proyectan con project() y solo se re-renderizan mientras algo se mueve.
 * - Ajustes y Perfil/Logros están en ui/Panels3D.js y se abren sobre esta misma escena (la cámara se aleja y orbita).
 * - testIDs: menu-<id> (capa de accesibilidad/pruebas, solo web), cat-<id>, daily, surprise, play, fav-<id>,
 *   open-ach, open-profile, open-settings, panel-close.
 */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, alpha, glow, hx, tglow } from '../utils/kit';
import { ACHIEVEMENTS, Profile, levelInfo, useProfile } from '../utils/meta';
import { World3D } from '../utils/World3D';
import { Btn3D, Fade } from '../utils/ui3d';
import { mix, shade } from '../utils/prefabs';
import { burst3d, ring3d, clear3d } from '../utils/engine3d';
import { project } from '../utils/openworld';
import { ProfilePanel3D, SettingsPanel3D } from './Panels3D';

// ─── Constantes ───────────────────────────────────────────────────
const SP = 1.75;                 // separación entre máquinas (m)
const GAP = 0.8;                 // hueco extra entre grupos de categoría (en «máquinas»)
const RMIN = 7.5, RMAX = 40;     // radio de la rotonda
const CAM_D = 6.0, CAM_H = 2.15, CAM_LY = 0.35, CAM_FOV = 52;
const PXU = 96;                  // píxeles de arrastre por máquina
const VIS = 5.6;                 // máquinas visibles a cada lado
const BG = '#07051a';
const CAT_COL = { all: C.cyan, fav: C.amber, accion: C.pink, arcade: C.lime, reflejos: C.orange, puzzle: C.violet, aventura: C.blue };
const MEM = { cat: 'all', id: null, seen: false };   // el menú recuerda dónde te quedaste al volver de un juego

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = x => 1 - Math.pow(1 - clamp01(x), 3);
const easeBack = x => { const k = clamp01(x), c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
const nowS = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const dayHash = () => { const d = new Date(); let h = d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate(); h = (h * 2654435761) >>> 0; return h; };

// ─── Disposición en anillo ────────────────────────────────────────
function listFor(games, categories, cat, favs) {
  const order = {}; categories.forEach((c, i) => { order[c.id] = i; });
  let arr = games.filter(g => cat === 'all' || (cat === 'fav' ? favs[g.id] : g.cat === cat));
  if (cat === 'all' || cat === 'fav') arr = arr.map((g, i) => [g, i]).sort((a, b) => ((order[a[0].cat] || 0) - (order[b[0].cat] || 0)) || a[1] - b[1]).map(x => x[0]);
  return arr;
}
const wd = (lay, d) => (lay.closed ? d - lay.total * Math.round(d / lay.total) : d);   // diferencia (en máquinas) envuelta en el anillo
function nearestIdx(lay, p) {
  let bi = 0, bd = 1e9;
  for (let i = 0; i < lay.n; i++) { const d = Math.abs(wd(lay, lay.slot[i] - p)); if (d < bd) { bd = d; bi = i; } }
  return bi;
}
const unwrapTo = (lay, p, i) => p + wd(lay, lay.slot[i] - p);

function buildLayout(items, grouped) {
  const n = items.length;
  const slot = []; let u = 0;
  for (let i = 0; i < n; i++) { if (i && grouped && items[i].cat !== items[i - 1].cat) u += GAP; slot.push(u); u += 1; }
  const total = n ? u + (grouped && n > 1 && items[0].cat !== items[n - 1].cat ? GAP : 0) : 1;
  const R0 = (total * SP) / (Math.PI * 2);
  const closed = n > 1 && R0 >= RMIN;
  const R = closed ? Math.min(R0, RMAX) : RMIN;
  const aStep = closed ? (Math.PI * 2) / total : SP / R;
  const lay = { items, n, slot, total, closed, R, aStep, grouped, ang: [], px: [], pz: [], statics: null };
  for (let i = 0; i < n; i++) { const a = slot[i] * aStep; lay.ang.push(a); lay.px.push(Math.sin(a) * R); lay.pz.push(-Math.cos(a) * R); }
  lay.statics = buildStatics(lay);
  return lay;
}

// Decorado fijo (se escribe UNA vez en el motor): suelo, líneas de neón, muro de paneles y arcos entre categorías.
function buildStatics(lay) {
  const out = [];
  const { R, aStep, total, closed, items, n } = lay;
  out.push({ id: 'floor', k: 'pla', p: [0, 0, 0], s: [320, 320, 1], c: '#0b0922', recv: true, m: { r: 0.3, m: 0 } });
  const a0 = closed ? 0 : -3.4 * aStep, a1 = closed ? Math.PI * 2 : (total + 2.4) * aStep, span = a1 - a0;
  const colAt = ang => (n ? items[nearestIdx(lay, ang / aStep)].color : C.cyan);
  const seg = (name, k, rad, ang, y, sx, sy, sz, c, e, extra) => out.push({ inst: name, k, p: [Math.sin(ang) * rad, y, -Math.cos(ang) * rad], s: [sx, sy, sz], r: [0, -ang, 0], c, e, ...(extra || null) });
  const ring = (rad, colorFn, w, dash) => {
    const cnt = Math.max(8, Math.round((span * rad) / 1.1)), st = span / cnt;
    for (let j = 0; j < cnt; j++) { if (dash && (j & 1)) continue; const ang = a0 + (j + 0.5) * st; seg('fl', 'box', rad, ang, 0.012, st * rad * (dash ? 0.9 : 1.04), 0.012, w, colorFn(ang), 1); }
  };
  ring(R - 1.35, ang => shade(colAt(ang), 0.85), 0.07);
  ring(R - 3.3, () => '#ff3df2', 0.05, true);
  ring(R - 6.4, () => '#6c4dff', 0.05, true);
  // muro
  const Rw = R + 2.0, Mw = Math.max(6, Math.ceil((span * Rw) / 2.3)), wa = span / Mw;
  for (let j = 0; j < Mw; j++) {
    const ang = a0 + (j + 0.5) * wa;
    seg('wl', 'box', Rw, ang, 3.4, wa * Rw * 1.02, 6.8, 0.5, j & 1 ? '#141032' : '#0f0b27', 0, { recv: true });
    const c = colAt(ang);
    seg('wh', 'box', Rw - 0.3, ang, 0.45, wa * Rw * 1.0, 0.07, 0.07, shade(c, 0.9), 1);
    seg('wh', 'box', Rw - 0.3, ang, 5.6, wa * Rw * 1.0, 0.07, 0.07, shade(c, 0.6), 1);
  }
  for (let j = 0; j <= Mw; j++) { const ang = a0 + j * wa; seg('ws', 'box', Rw - 0.3, ang, 3.4, 0.08, 6.8, 0.08, shade(colAt(ang), 0.75), 1); }
  // arcos entre categorías (solo en «TODOS»)
  if (lay.grouped && n > 1) {
    for (let i = closed ? 0 : 1; i < n; i++) {
      const prev = items[(i + n - 1) % n];
      if (prev.cat === items[i].cat) continue;
      const u = i === 0 ? lay.slot[n - 1] + (1 + GAP) / 2 : (lay.slot[i - 1] + lay.slot[i]) / 2;
      const ang = u * aStep, col = CAT_COL[items[i].cat] || C.cyan, d = 0.58 / (R - 0.5);
      seg('gp', 'box', R - 0.5, ang - d, 2.2, 0.14, 4.4, 0.14, col, 1);
      seg('gp', 'box', R - 0.5, ang + d, 2.2, 0.14, 4.4, 0.14, col, 1);
      seg('gb', 'box', R - 0.5, ang, 4.45, 1.5, 0.16, 0.16, col, 1);
    }
  }
  return out;
}

// ─── Máquina recreativa (instanciada) ─────────────────────────────
const PREP = new Map();
function prep(g) {
  let p = PREP.get(g.id);
  if (!p) {
    const c = g.color;
    p = { body: mix('#171333', c, 0.12), body2: mix('#100d28', c, 0.09), deck: mix('#231e48', c, 0.16), white: mix(c, '#ffffff', 0.6), lv: [0.14, 0.28, 0.44, 0.62, 0.8, 1].map(f => shade(c, f)) };
    PREP.set(g.id, p);
  }
  return p;
}
const CTX = { out: null, px: 0, pz: 0, c: 1, s: 0, ms: 1, phi: 0 };
// parte local (frente = +Z local) → mundo. tilt: inclinación en X (Ry·Rx → Euler XYZ)
function put(k, lx, ly, lz, sx, sy, sz, c, e, sh, tilt) {
  const m = CTX.ms;
  lx *= m; ly *= m; lz *= m;
  let r;
  if (tilt) { const phi = CTX.phi, sp = Math.sin(phi), cp = Math.cos(phi), st = Math.sin(tilt), ct = Math.cos(tilt); r = [Math.atan2(st, cp * ct), Math.asin(sp * ct), Math.atan2(-sp * st, cp)]; }
  else r = [0, CTX.phi, 0];
  const o = { inst: 'm', k, p: [CTX.px + lx * CTX.c + lz * CTX.s, ly, CTX.pz - lx * CTX.s + lz * CTX.c], s: [sx * m, sy * m, sz * m], r, c, e };
  if (sh) o.sh = true;
  CTX.out.push(o);
}
function pushMachine(out, g, px, pz, phi, ms, br, lod, hero, t) {
  const P = prep(g);
  CTX.out = out; CTX.px = px; CTX.pz = pz; CTX.c = Math.cos(phi); CTX.s = Math.sin(phi); CTX.ms = ms; CTX.phi = phi;
  const lv = Math.max(0, Math.min(5, Math.round(br * 5)));
  const col = P.lv[lv], dimc = P.lv[Math.max(0, lv - 2)];
  put('box', 0, 0.475, 0, 1.05, 0.95, 0.9, P.body, 0, true);            // cuerpo bajo
  put('box', 0, 0.8, 0.452, 0.92, 0.035, 0.02, col, 1);                  // neón bajo el panel
  put('box', 0, 1.62, -0.12, 1.05, 1.0, 0.62, P.body2, 0, true);         // caja de la pantalla
  put('box', 0, 1.63, 0.2, 0.95, 0.82, 0.03, '#05040f', 0);              // bisel
  put('box', 0, 1.64, 0.222, 0.8, 0.64, 0.02, dimc, 1);                  // pantalla (halo)
  put('box', 0, 1.64, 0.232, 0.68, 0.5, 0.02, col, 1);                   // pantalla (núcleo)
  put('box', 0, 2.24, 0.02, 1.05, 0.3, 0.52, P.body, 0, true);           // marquesina
  put('box', 0, 2.24, 0.285, 0.93, 0.2, 0.02, col, 1);                   // rótulo
  put('box', 0, 0.99, 0.43, 1.05, 0.08, 0.56, P.deck, 0, false, 0.28);   // panel de mandos inclinado
  put('box', 0, 0.015, 0.1, 1.5, 0.03, 1.3, dimc, 1);                    // peana luminosa
  if (!lod) {
    put('cyl', -0.27, 1.09, 0.5, 0.045, 0.17, 0.045, '#b8bcd8', 0);      // palanca
    put('sph', -0.27, 1.2, 0.5, 0.11, 0.11, 0.11, '#ff2e4d', 1);
    put('cyl', 0.1, 1.035, 0.47, 0.09, 0.035, 0.09, col, 1);             // botones
    put('cyl', 0.26, 1.045, 0.43, 0.09, 0.035, 0.09, '#ffc233', 1);
    put('cyl', 0.4, 1.055, 0.39, 0.09, 0.035, 0.09, '#ff3df2', 1);
    put('box', 0, 0.42, 0.455, 0.26, 0.3, 0.02, '#0c0a1e', 0);           // monedero
    put('box', 0, 0.5, 0.468, 0.05, 0.1, 0.02, '#ffc233', 1);
    put('box', 0, 0.34, 0.468, 0.12, 0.03, 0.02, col, 1);
    for (let sd = -1; sd <= 1; sd += 2) {                                 // neón de las aristas
      put('box', sd * 0.535, 0.475, 0.44, 0.03, 0.95, 0.03, col, 1);
      put('box', sd * 0.535, 1.62, 0.19, 0.03, 1.0, 0.03, col, 1);
      put('box', sd * 0.535, 2.24, 0.275, 0.03, 0.3, 0.03, col, 1);
    }
    if (hero) put('box', 0, 1.64 + Math.sin(t * 1.7) * 0.22, 0.246, 0.68, 0.025, 0.02, P.white, 1);   // línea de barrido
  }
}

// ─── Estado y física del carrusel ─────────────────────────────────
function newState() {
  return {
    lay: null, pos: 0, target: 0, vel: 0, idx: 0, dragging: false, dragT: 0, moved: false,
    introT: MEM.seen ? 0.35 : 0, panelT: 0, panel: false, launch: null, launchT: 0, spin: null,
    t0: 0, lastT: 0, wasActive: true, listeners: new Set(), lc: '#22e6ff', mote: 0, cam: null, W: 390, H: 844,
    timers: [], onFocus: null, dailyId: null,
  };
}
function stepPhysics(S, dt) {
  const lay = S.lay;
  if (S.introT < 1) S.introT = Math.min(1, S.introT + dt / 1.15);
  const pt = S.panel ? 1 : 0;
  S.panelT += (pt - S.panelT) * Math.min(1, dt * 4.5); if (Math.abs(pt - S.panelT) < 0.002) S.panelT = pt;
  if (S.launch) S.launchT = Math.min(1, S.launchT + dt / 0.26);
  let active = S.introT < 1 || S.panelT !== pt || !!S.launch;
  if (lay.n) {
    if (S.spin) {
      const k = clamp01((S.t - S.spin.t0) / S.spin.dur);
      const np = S.spin.from + (S.spin.to - S.spin.from) * easeOut(k);
      S.vel = (np - S.pos) / Math.max(dt, 0.001); S.pos = np; S.target = np; active = true;
      if (k >= 1) { S.spin = null; S.vel = 0; }
    } else if (!S.dragging) {
      const d = S.target - S.pos;
      if (Math.abs(d) > 0.0004 || Math.abs(S.vel) > 0.0004) {
        const steps = dt > 0.02 ? 2 : 1, h = dt / steps, k = 130, c = 2 * Math.sqrt(k) * 0.93;
        for (let q = 0; q < steps; q++) { S.vel += (k * (S.target - S.pos) - c * S.vel) * h; S.pos += S.vel * h; }
        active = true;
      } else { S.pos = S.target; S.vel = 0; }
    } else active = true;
    const i = nearestIdx(lay, S.pos);
    if (i !== S.idx) { S.idx = i; if (S.onFocus) S.onFocus(i); }
  }
  return active;
}

// Cámara: dentro del anillo, mirando a la máquina enfocada. `pr` = predicción de 1 frame (para los textos 2D)
function camFor(S, t, pr) {
  const lay = S.lay;
  const pos = pr ? S.pos + S.vel * 0.016 : S.pos;
  const a = pos * lay.aStep;
  const ie = easeOut(S.introT), pe = S.panelT, le = easeOut(S.launchT);
  let D = CAM_D + (1 - ie) * 7 + pe * 5.5, h = CAM_H + (1 - ie) * 3 + pe * 1.6, ly = CAM_LY, fov = CAM_FOV + (1 - ie) * 9;
  D -= le * (D - 1.15); ly += le * 1.2; h -= le * 0.5; fov += le * 16;
  const aa = a + pe * Math.sin(t * 0.22) * 0.5, R = lay.R;
  return { p: [Math.sin(aa) * (R - D), h, -Math.cos(aa) * (R - D)], l: [Math.sin(a) * R, ly, -Math.cos(a) * R], fov };
}

function sceneAt(S, t) {
  const lay = S.lay;
  const dt = Math.min(0.05, Math.max(0.001, t - (S.lastT || t - 0.016))); S.lastT = t; S.t = t;
  const active = stepPhysics(S, dt);
  if (active || S.wasActive) S.listeners.forEach(f => f());
  S.wasActive = active;
  const cam = camFor(S, t, false); S.cam = cam;

  const a = S.pos * lay.aStep, sa = Math.sin(a), ca = Math.cos(a);
  const hx0 = sa * lay.R, hz0 = -ca * lay.R, nx = -sa, nz = ca, tx = ca, tz = sa;   // n = hacia el centro · tg = tangente
  const hero = lay.n ? lay.items[Math.min(S.idx, lay.n - 1)] : null;
  S.lc = mix(S.lc, hero ? hero.color : '#22e6ff', 1 - Math.exp(-dt * 7));
  const lc = S.lc;

  const objs = [];
  for (let i = 0; i < lay.n; i++) {
    const off = wd(lay, lay.slot[i] - S.pos), ao = Math.abs(off);
    if (ao > VIS) continue;
    const g = lay.items[i];
    const age = t - S.t0 - ao * 0.05;
    if (age <= 0) continue;
    const pop = easeBack(age / 0.5);
    const w = Math.max(0, 1 - ao);
    const ms = Math.max(0.001, pop * (1 + 0.05 * w));
    const phi = -lay.ang[i] + Math.sin(t * 1.3 + i) * 0.04 * w;
    const br = Math.max(0.28, 1 - ao * 0.3) * (w > 0.5 ? 0.93 + 0.07 * Math.sin(t * 7) : 1);
    pushMachine(objs, g, lay.px[i], lay.pz[i], phi, ms, br, ao > 2.3, w > 0.5, t);
    if (g.id === S.dailyId) objs.push({ inst: 'dr', k: 'ring', p: [lay.px[i] - Math.sin(lay.ang[i]) * 0.2, 0.03, lay.pz[i] + Math.cos(lay.ang[i]) * 0.2], s: [2.2 * ms, 2.2 * ms, 1], c: '#ffc233', e: 1 });
  }
  if (hero) {
    objs.push({ id: 'pool', k: 'box', p: [hx0 + nx * 1.1, 0.025, hz0 + nz * 1.1], s: [3.6, 0.02, 3.0], r: [0, -a, 0], c: lc, e: 1, o: 0.16 });
    objs.push({ id: 'beam', k: 'cone', p: [hx0 + nx * 0.2, 3.3, hz0 + nz * 0.2], s: [2.8, 6.6, 2.8], c: lc, e: 1, o: 0.055 });
  }
  // polvo de luz flotando
  S.mote -= dt;
  if (S.mote <= 0 && lay.n) {
    S.mote = 0.09;
    const u = (Math.random() - 0.5) * 7, v = 0.5 + Math.random() * 4;
    burst3d([hx0 + tx * u + nx * v, 0.2 + Math.random() * 3.2, hz0 + tz * u + nz * v], [lc, '#ffffff', '#22e6ff', '#ff3df2'], 1, { speed: 0.25, life: 3.2, size: 0.05, g: -0.12, drag: 0.4 });
  }
  const sunX = nx * 0.6 - tx * 0.35, sunZ = nz * 0.6 - tz * 0.35;
  return {
    objs, statics: lay.statics, cam, bg: BG, fog: { c: BG, near: 5, far: 28 },
    light: { dir: [sunX, 1.0, sunZ], sun: '#c9b8ff', i: 1.25, sky: mix('#3f3590', lc, 0.3), ground: '#15102e', hi: 1.0 },
    lights: [
      { p: [hx0 + nx * 2.0, 2.7, hz0 + nz * 2.0], c: lc, i: 10, d: 10 },
      { p: [hx0 + nx * 1.6 - tx * 3.2, 1.6, hz0 + nz * 1.6 - tz * 3.2], c: '#22e6ff', i: 5, d: 8 },
      { p: [hx0 + nx * 1.6 + tx * 3.2, 1.6, hz0 + nz * 1.6 + tz * 3.2], c: '#ff3df2', i: 5, d: 8 },
    ],
    shadowR: 12,
  };
}

function hitTest(S, x, y) {
  const lay = S.lay;
  if (!lay.n) return -1;
  const cam = camFor(S, nowS(), false);
  const tf = Math.tan((cam.fov * Math.PI) / 360);
  let best = -1, bz = 1e9;
  for (let i = 0; i < lay.n; i++) {
    const off = wd(lay, lay.slot[i] - S.pos);
    if (Math.abs(off) > 3.4) continue;
    const c = project(cam, [lay.px[i], 1.2, lay.pz[i]], S.W, S.H);
    if (!c) continue;
    const pxu = S.H / 2 / (c.z * tf);
    if (Math.abs(x - c.x) < 0.62 * pxu && Math.abs(y - c.y) < 1.3 * pxu && c.z < bz) { best = i; bz = c.z; }
  }
  return best;
}

// ─── Textos 2D proyectados sobre las máquinas ─────────────────────
function Labels({ S }) {
  const [, force] = useReducer(x => (x + 1) % 1e9, 0);
  useEffect(() => { S.listeners.add(force); return () => S.listeners.delete(force); }, [S]);
  const lay = S.lay;
  if (!lay || !lay.n || S.panelT > 0.25 || S.launchT > 0.15) return null;
  const t = nowS(), cam = camFor(S, t, true), tf = Math.tan((cam.fov * Math.PI) / 360), W = S.W, H = S.H;
  const pos = S.pos + S.vel * 0.016;
  const out = [];
  for (let i = 0; i < lay.n; i++) {
    const off = wd(lay, lay.slot[i] - pos), ao = Math.abs(off);
    if (ao > 2.7) continue;
    const g = lay.items[i], age = t - S.t0 - ao * 0.05;
    if (age < 0.38) continue;
    const a = lay.ang[i], sa = Math.sin(a), ca = Math.cos(a);   // phi = -a → sφ = -sa · cφ = ca
    const ld = (lx, ly, lz) => project(cam, [lay.px[i] - lz * sa + lx * ca, ly, lay.pz[i] + lz * ca + lx * sa], W, H);
    const sc = ld(0, 1.64, 0.24);
    if (!sc) continue;
    const pxu = H / 2 / (sc.z * tf), op = clamp01(1.25 - ao * 0.42) * clamp01((age - 0.38) / 0.2);
    const fs = Math.round(0.33 * pxu);
    out.push(
      <View key={g.id + 'e'} pointerEvents="none" style={{ position: 'absolute', left: sc.x - fs * 0.85, top: sc.y - fs * 0.85, width: fs * 1.7, height: fs * 1.7, borderRadius: fs * 0.85, backgroundColor: 'rgba(5,4,15,0.34)', alignItems: 'center', justifyContent: 'center', opacity: op }}>
        <Text style={{ fontSize: fs, lineHeight: Math.round(fs * 1.18), textAlign: 'center' }}>{g.emoji}</Text>
      </View>,
    );
    if (ao < 1.7) {
      const mq = ld(0, 2.24, 0.3);
      if (mq) {
        const pw = 0.9 * pxu, nf = Math.max(6, Math.min(15, Math.floor(pw / (g.name.length * 0.8))));
        out.push(<Text key={g.id + 'n'} pointerEvents="none" numberOfLines={1} style={{ position: 'absolute', left: mq.x - pw / 2, width: pw, top: mq.y - nf * 0.62, textAlign: 'center', color: '#07051a', fontSize: nf, lineHeight: nf * 1.25, fontWeight: '900', letterSpacing: 0.4, opacity: op }}>{g.name}</Text>);
      }
    }
    if (ao < 2.3) {
      const top = ld(0, 2.62, 0.2);
      if (top) {
        if (g.id === S.dailyId) out.push(<View key={g.id + 'd'} pointerEvents="none" style={{ position: 'absolute', left: top.x - 36, top: top.y - 22, width: 72, alignItems: 'center', opacity: op }}><View style={{ backgroundColor: C.amber, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ color: '#04040c', fontSize: 10, fontWeight: '900' }}>🎯 RETO</Text></View></View>);
        if (S.favs && S.favs[g.id]) out.push(<Text key={g.id + 'f'} pointerEvents="none" style={{ position: 'absolute', left: top.x + 0.42 * pxu - 12, top: top.y - 4, width: 24, fontSize: Math.max(12, 0.17 * pxu), textAlign: 'center', opacity: op }}>⭐</Text>);
      }
    }
  }
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{out}</View>;
}

// ─── Interfaz 2D ──────────────────────────────────────────────────
function IconBtn({ emoji, onPress, testID, color = C.cyan }) {
  return (
    <Pressable testID={testID} onPress={onPress} hitSlop={6} style={{ marginLeft: 8 }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(8,10,26,0.62)', borderWidth: 1.5, borderColor: alpha(color, 0.6), alignItems: 'center', justifyContent: 'center', ...glow(color, 10, 0.4) }}>
        <Text style={{ fontSize: 20 }}>{emoji}</Text>
      </View>
    </Pressable>
  );
}

function TopBar({ xp, streak, achN, onProfile, onSettings }) {
  const lv = levelInfo(xp);
  return (
    <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8 }}>
      <Pressable testID="open-profile" onPress={onProfile} style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingLeft: 6, paddingRight: 12, borderRadius: 26, backgroundColor: 'rgba(8,10,26,0.62)', borderWidth: 1.5, borderColor: alpha(C.cyan, 0.55), ...glow(C.cyan, 10, 0.35) }}>
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: alpha(C.cyan, 0.16), borderWidth: 2, borderColor: C.cyan, alignItems: 'center', justifyContent: 'center', ...glow(C.cyan, 8, 0.7) }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900', ...tglow(C.cyan, 8) }}>{lv.level}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 1 }}>NIVEL {lv.level}</Text>
              <Text style={{ color: C.dim, fontSize: 10, fontWeight: '700' }}>{lv.into}/{lv.need} XP</Text>
            </View>
            <View style={{ height: 7, borderRadius: 4, backgroundColor: alpha(C.cyan, 0.16), marginTop: 4, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(3, lv.pct * 100)}%`, height: '100%', borderRadius: 4, backgroundColor: C.cyan }} />
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', marginLeft: 10 }}>
            <Text style={{ color: C.amber, fontSize: 12, fontWeight: '900' }}>🔥 {streak}</Text>
            <Text style={{ color: C.dim, fontSize: 10, fontWeight: '700' }}>🏅 {achN}/{ACHIEVEMENTS.length}</Text>
          </View>
        </View>
      </Pressable>
      <IconBtn testID="open-ach" emoji="🏆" color={C.amber} onPress={onProfile} />
      <IconBtn testID="open-settings" emoji="⚙️" color={C.cyan} onPress={onSettings} />
    </View>
  );
}

function CatChips({ cats, cat, onCat, counts }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
      {cats.map(c => {
        const on = cat === c.id, col = CAT_COL[c.id] || C.cyan;
        return (
          <Pressable key={c.id} testID={`cat-${c.id}`} onPress={() => onCat(c.id)}>
            <View style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: on ? col : 'rgba(8,10,26,0.62)', borderWidth: 1.5, borderColor: on ? shade(col, 1.4) : alpha(col, 0.5), flexDirection: 'row', alignItems: 'center', ...glow(col, on ? 14 : 0, 0.7) }}>
              <Text style={{ color: on ? '#07051a' : col, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 }}>{c.label}</Text>
              <Text style={{ color: on ? alpha('#07051a', 0.65) : alpha(col, 0.65), fontSize: 10, fontWeight: '800', marginLeft: 6 }}>{counts[c.id]}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const GameCard = React.memo(function GameCard({ g, best, fav, isDaily, idx, n, catLabel, onPlay, onFav }) {
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => { pop.setValue(0); Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 7 }).start(); }, [g.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cc = CAT_COL[g.cat] || C.cyan;
  return (
    <Animated.View style={{ opacity: pop.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }), transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }, { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] }}>
      <View style={{ borderRadius: 26, backgroundColor: 'rgba(7,9,24,0.8)', borderWidth: 1.5, borderColor: alpha(g.color, 0.75), padding: 14, overflow: 'hidden', ...glow(g.color, 20, 0.5) }}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 18, right: 18, top: 0, height: 3, borderRadius: 2, backgroundColor: g.color }} />
        <View pointerEvents="none" style={{ position: 'absolute', right: -30, top: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: alpha(g.color, 0.1) }} />
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: alpha(g.color, 0.18), borderWidth: 2, borderColor: g.color, alignItems: 'center', justifyContent: 'center', ...glow(g.color, 12, 0.7) }}>
            <Text style={{ fontSize: 30 }}>{g.emoji}</Text>
          </View>
          <View style={{ flex: 1, marginHorizontal: 12 }}>
            <Text numberOfLines={1} style={{ color: shade(g.color, 1.45), fontSize: 18, fontWeight: '900', letterSpacing: 1.4, ...tglow(g.color, 10) }}>{g.name}</Text>
            <Text numberOfLines={2} style={{ color: '#c9cfee', fontSize: 12, lineHeight: 16, marginTop: 2 }}>{g.tag}</Text>
          </View>
          <Pressable testID={`fav-${g.id}`} onPress={onFav} hitSlop={10}>
            <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: fav ? alpha(C.amber, 0.2) : 'rgba(255,255,255,0.06)', borderWidth: 1.5, borderColor: fav ? C.amber : 'rgba(255,255,255,0.16)' }}>
              <Text style={{ fontSize: 22, opacity: fav ? 1 : 0.45 }}>{fav ? '⭐' : '☆'}</Text>
            </View>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 12, gap: 8 }}>
          <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10, backgroundColor: alpha(cc, 0.16), borderWidth: 1, borderColor: alpha(cc, 0.6) }}><Text style={{ color: cc, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }}>{catLabel}</Text></View>
          <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: alpha(C.amber, best > 0 ? 0.6 : 0.2) }}><Text style={{ color: best > 0 ? C.amber : C.dim, fontSize: 11, fontWeight: '900' }}>🏆 {best > 0 ? best : 'SIN RÉCORD'}</Text></View>
          {isDaily ? <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: C.amber }}><Text style={{ color: '#04040c', fontSize: 10, fontWeight: '900' }}>🎯 RETO</Text></View> : null}
          <View style={{ flex: 1 }} />
          <Text style={{ color: C.dim, fontSize: 11, fontWeight: '800' }}>{idx + 1}/{n}</Text>
        </View>
        <Btn3D testID="play" wide size="lg" color={g.color} icon="▶" label="JUGAR" onPress={onPlay} />
      </View>
    </Animated.View>
  );
});

/** Barra para recorrer rápido la lista (una marca de color por juego). */
function Scrubber({ items, idx, onScrub }) {
  const cb = useRef({}); cb.current = { items, onScrub, w: 0 };
  const pr = useRef(null);
  if (!pr.current) {
    const pick = e => { const { items: it, w } = cb.current; if (!w || !it.length) return; const f = clamp01(e.nativeEvent.locationX / w); cb.current.onScrub(Math.round(f * (it.length - 1))); };
    pr.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: pick, onPanResponderMove: pick,
    });
  }
  return (
    <View onLayout={e => { cb.current.w = e.nativeEvent.layout.width; }} {...pr.current.panHandlers} style={{ height: 30, marginTop: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
      {items.map((g, i) => (
        <View key={g.id} pointerEvents="none" style={{ flex: 1, height: i === idx ? 14 : 6, marginHorizontal: 0.5, borderRadius: 2, backgroundColor: i === idx ? '#fff' : alpha(g.color, 0.6), ...(i === idx ? glow(g.color, 8, 1) : null) }} />
      ))}
    </View>
  );
}

// ─── Menú ─────────────────────────────────────────────────────────
export function Menu3D({ games, categories, onPick }) {
  const { width: W, height: H } = useWindowDimensions();
  const prof = useProfile();
  const [bests, setBests] = useState({});
  const [cat, setCatState] = useState(() => MEM.cat);
  const [panel, setPanel] = useState(null);                    // null | 'settings' | 'ach'
  const [fi, setFi] = useState(0);
  const [flashC, setFlashC] = useState('#ffffff');
  const flash = useRef(new Animated.Value(0)).current;
  const chrome = useRef(new Animated.Value(0)).current;
  const splash = useRef(new Animated.Value(MEM.seen ? 0 : 1)).current;

  const daily = useMemo(() => games[dayHash() % games.length], [games]);
  const dailyDone = prof.daily.done && prof.daily.date !== '';
  const sref = useRef(null); if (!sref.current) sref.current = newState();
  const S = sref.current;
  S.W = W; S.H = H; S.dailyId = dailyDone ? null : daily.id; S.favs = prof.favs; S.panel = !!panel;

  // lista y disposición en anillo
  const favKey = cat === 'fav' ? Object.keys(prof.favs).filter(k => prof.favs[k]).join(',') : '';
  const lay = useMemo(() => buildLayout(listFor(games, categories, cat, prof.favs), cat === 'all'), [games, categories, cat, favKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (S.lay !== lay) {
    S.lay = lay;
    const keep = lay.items.findIndex(g => g.id === MEM.id), i = keep >= 0 ? keep : 0;
    S.pos = S.target = lay.n ? lay.slot[i] : 0; S.vel = 0; S.idx = i; S.t0 = nowS(); S.spin = null; S.dragging = false;
  }
  S.onFocus = i => { const g = S.lay.items[i]; if (g) MEM.id = g.id; setFi(i); hx.tick(); };
  useEffect(() => { setFi(S.idx); }, [lay]); // eslint-disable-line react-hooks/exhaustive-deps
  const hero = lay.n ? lay.items[Math.min(fi, lay.n - 1)] : null;

  // arranque
  useEffect(() => {
    Profile.setTotal(games.length); Profile.setDaily(daily.id);
    AsyncStorage.multiGet(games.map(g => `@best:${g.id}`)).then(rows => {
      const o = {}; rows.forEach(([k, v]) => { if (v) o[k.slice(6)] = parseFloat(v) || 0; }); setBests(o);
    }).catch(() => {});
    Animated.timing(chrome, { toValue: 1, duration: 420, delay: MEM.seen ? 120 : 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    if (!MEM.seen) Animated.sequence([Animated.delay(900), Animated.timing(splash, { toValue: 0, duration: 650, useNativeDriver: true })]).start();
    MEM.seen = true;
    clear3d();
    return () => { S.timers.forEach(clearTimeout); S.timers = []; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { Animated.timing(chrome, { toValue: panel ? 0 : 1, duration: 200, useNativeDriver: true }).start(); }, [!!panel]); // eslint-disable-line react-hooks/exhaustive-deps

  const later = (fn, ms) => { const id = setTimeout(fn, ms); S.timers.push(id); };
  const goTo = i => { if (!S.lay.n) return; S.spin = null; S.target = unwrapTo(S.lay, S.pos, i); };
  const launch = (id, fast) => {
    if (S.launch) return;
    const g = games.find(x => x.id === id); if (!g) return;
    S.launch = { id }; S.launchT = fast ? 0.7 : 0; S.dragging = false;
    hx.tap(); setFlashC(g.color);
    const a = S.pos * S.lay.aStep;
    ring3d([Math.sin(a) * S.lay.R, 0.1, -Math.cos(a) * S.lay.R], g.color, 28, { speed: 7, life: 0.5 });
    Animated.timing(flash, { toValue: 1, duration: fast ? 70 : 230, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
    Animated.timing(chrome, { toValue: 0, duration: 160, useNativeDriver: true }).start();
    later(() => onPick(id), fast ? 80 : 270);
  };
  const setCat = c => { hx.tick(); MEM.cat = c; setCatState(c); };
  const doSurprise = () => {
    const L = S.lay; if (!L.n) return;
    const j = Math.floor(Math.random() * L.n);
    const to = unwrapTo(L, S.pos, j) + (L.closed ? L.total * (Math.random() < 0.5 ? 1 : -1) : 0);
    S.spin = { from: S.pos, to, t0: nowS(), dur: 1.25 }; S.vel = 0;
    const id = L.items[j].id; later(() => launch(id), 1250 + 380);
  };
  const doDaily = () => {
    const L = S.lay, j = L.items.findIndex(g => g.id === daily.id);
    if (j < 0) return;
    if (j === S.idx) { launch(daily.id); return; }
    goTo(j); later(() => launch(daily.id), 650);
  };
  const onSurprise = () => { hx.tap(); if (cat !== 'all') { S.pending = 'surprise'; setCat('all'); } else doSurprise(); };
  const onDaily = () => { hx.tap(); if (cat !== 'all') { S.pending = 'daily'; setCat('all'); } else doDaily(); };
  useEffect(() => { const p = S.pending; if (p && cat === 'all') { S.pending = null; if (p === 'surprise') doSurprise(); else doDaily(); } }, [lay]); // eslint-disable-line react-hooks/exhaustive-deps

  // gestos: arrastrar = girar el carrusel · tocar = enfocar (o jugar si ya está enfocada)
  const cb = useRef({}); cb.current = { S, launch, goTo, W, H };
  const pan = useRef(null);
  if (!pan.current) {
    pan.current = PanResponder.create({
      onStartShouldSetPanResponder: () => !cb.current.S.launch && !cb.current.S.panel,
      onMoveShouldSetPanResponder: () => !cb.current.S.launch && !cb.current.S.panel,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { const s = cb.current.S; s.dragging = true; s.moved = false; s.spin = null; s.drag0 = s.pos; s.dragT = nowS(); s.vel = 0; },
      onPanResponderMove: (e, g) => {
        const s = cb.current.S, L = s.lay; if (!L.n) return;
        if (Math.abs(g.dx) + Math.abs(g.dy) > 9) s.moved = true;
        let np = s.drag0 - g.dx / PXU;
        if (!L.closed) { const lo = L.slot[0] - 0.55, hi = L.slot[L.n - 1] + 0.55; if (np < lo) np = lo - (lo - np) * 0.3; else if (np > hi) np = hi + (np - hi) * 0.3; }
        const t = nowS(), dtm = Math.max(0.008, t - s.dragT); s.dragT = t;
        s.vel = s.vel * 0.55 + ((np - s.pos) / dtm) * 0.45; s.pos = np;
      },
      onPanResponderRelease: (e, g) => {
        const c = cb.current, s = c.S, L = s.lay; s.dragging = false;
        if (!L.n) return;
        if (!s.moved) {
          s.vel = 0;
          const i = hitTest(s, g.x0, g.y0);
          if (i >= 0) { if (i === s.idx) c.launch(L.items[i].id); else { hx.tick(); c.goTo(i); } } else c.goTo(s.idx);
          return;
        }
        const v = Math.max(-14, Math.min(14, s.vel));
        let j = nearestIdx(L, s.pos + v * 0.2);
        if (!L.closed) j = Math.max(0, Math.min(L.n - 1, j));
        s.target = unwrapTo(L, s.pos, j); s.vel = v;
      },
      onPanResponderTerminate: () => { const s = cb.current.S; s.dragging = false; if (s.lay.n) s.target = unwrapTo(s.lay, s.pos, nearestIdx(s.lay, s.pos)); },
    });
  }

  const getScene = useRef(t => sceneAt(sref.current, t)).current;
  const cats = useMemo(() => [categories[0], { id: 'fav', label: '⭐ FAVORITOS' }, ...categories.slice(1)], [categories]);
  const counts = useMemo(() => { const o = { all: games.length, fav: 0 }; games.forEach(g => { o[g.cat] = (o[g.cat] || 0) + 1; if (prof.favs[g.id]) o.fav++; }); return o; }, [games, favKey, prof.xp]); // eslint-disable-line react-hooks/exhaustive-deps
  const catLabel = hero ? ((categories.find(c => c.id === hero.cat) || {}).label || '') : '';
  const achN = Object.keys(prof.ach).length;

  return (
    <View style={{ width: W, height: H, backgroundColor: BG, overflow: 'hidden' }}>
      <World3D getScene={getScene} />
      <View style={StyleSheet.absoluteFill} {...pan.current.panHandlers} />
      <Labels S={S} />

      <Fade side="top" h={150} max={0.72} color={BG} />
      <Fade side="bottom" h={380} max={0.9} color={BG} />

      <SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <Animated.View pointerEvents="box-none" style={{ flex: 1, opacity: chrome, transform: [{ translateY: chrome.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
          <TopBar xp={prof.xp} streak={prof.streak} achN={achN} onProfile={() => { hx.tick(); setPanel('ach'); }} onSettings={() => { hx.tick(); setPanel('settings'); }} />
          <CatChips cats={cats} cat={cat} onCat={setCat} counts={counts} />
          <View pointerEvents="none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {lay.n === 0 ? <Text style={{ color: C.dim, textAlign: 'center', fontSize: 14, paddingHorizontal: 40 }}>Marca juegos con ☆ para verlos aquí.</Text> : null}
          </View>
          <View pointerEvents="box-none" style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
            <View style={{ flexDirection: 'row', marginBottom: 8, gap: 8 }}>
              <Pressable testID="daily" onPress={onDaily} style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, backgroundColor: alpha(C.amber, dailyDone ? 0.07 : 0.16), borderWidth: 1.5, borderColor: alpha(C.amber, dailyDone ? 0.4 : 0.85), ...glow(C.amber, dailyDone ? 4 : 12, dailyDone ? 0.2 : 0.55) }}>
                  <Text style={{ fontSize: 22, marginRight: 9 }}>{daily.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.amber, fontSize: 10, fontWeight: '900', letterSpacing: 1.6 }}>🎯 RETO DEL DÍA {dailyDone ? '· ¡CUMPLIDO!' : '· +50 XP'}</Text>
                    <Text numberOfLines={1} style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>{daily.name}</Text>
                  </View>
                  <Text style={{ color: C.amber, fontSize: 20 }}>{dailyDone ? '✓' : '›'}</Text>
                </View>
              </Pressable>
              <Pressable testID="surprise" onPress={onSurprise}>
                <View style={{ height: '100%', minWidth: 104, paddingHorizontal: 12, borderRadius: 18, backgroundColor: alpha(C.pink, 0.15), borderWidth: 1.5, borderColor: alpha(C.pink, 0.8), alignItems: 'center', justifyContent: 'center', ...glow(C.pink, 12, 0.5) }}>
                  <Text style={{ fontSize: 22 }}>🎲</Text>
                  <Text style={{ color: C.pink, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>SORPRÉNDEME</Text>
                </View>
              </Pressable>
            </View>
            {hero ? <GameCard g={hero} best={bests[hero.id] || 0} fav={!!prof.favs[hero.id]} isDaily={hero.id === daily.id && !dailyDone} idx={Math.min(fi, lay.n - 1)} n={lay.n} catLabel={catLabel}
              onPlay={() => launch(hero.id)} onFav={() => { hx.tick(); Profile.toggleFav(hero.id); }} /> : null}
            {lay.n > 1 ? <Scrubber items={lay.items} idx={Math.min(fi, lay.n - 1)} onScrub={i => { goTo(i); }} /> : null}
          </View>
        </Animated.View>
      </SafeAreaView>

      {/* título de bienvenida (solo la primera vez) */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', opacity: splash }]}>
        <Text style={{ color: '#fff', fontSize: 40, fontWeight: '900', letterSpacing: 5, ...tglow(C.cyan, 24) }}>ARCADE</Text>
        <Text style={{ color: C.cyan, fontSize: 40, fontWeight: '900', letterSpacing: 9, ...tglow(C.cyan, 24) }}>HUB</Text>
        <Text style={{ color: C.dim, fontSize: 13, marginTop: 8, letterSpacing: 2 }}>{games.length} JUEGOS</Text>
      </Animated.View>

      {panel === 'settings' && <SettingsPanel3D total={games.length} onClose={() => setPanel(null)} onReset={() => setBests({})} />}
      {panel === 'ach' && <ProfilePanel3D total={games.length} daily={daily} onClose={() => setPanel(null)} />}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: flashC, opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.9] }), zIndex: 90 }]} />

      {/* capa de accesibilidad / pruebas (solo web): una zona por juego en el borde inferior; abre el juego directamente */}
      {Platform.OS === 'web' ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 10, flexDirection: 'row', zIndex: 95 }}>
          {games.map(g => <Pressable key={g.id} testID={`menu-${g.id}`} accessibilityRole="button" accessibilityLabel={`Jugar ${g.name}`} onPress={() => launch(g.id, true)} style={{ flex: 1, height: 10 }} />)}
        </View>
      ) : null}
    </View>
  );
}
