import React, { useRef, useState } from 'react';
import { C, Combo, Lives, SCREEN_H, SCREEN_W, clamp, hx, rand, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { coin, gem } from '../utils/prefabs';
import { project, rayGround } from '../utils/openworld';

// STAR CATCHER 3D · cielo nocturno con luna. La cesta está sobre el suelo, bajo una cámara que sigue su posición.
// Arrastra o toca el suelo para llevarla. ⭐ 1 · 💎 5 · 💣 quita vida · 🧲 imán · 🌈 ×2 · ❄ congela · ❤ vida.
const SC_TIME = 60, SC_SPAWN_Y = 13, SC_BASKET_Y = 0.6, SC_CATCH_R = 1.35;
const SC_X = 4.5, SC_Z0 = -5.5, SC_Z1 = 3;                // límites de la cesta sobre el suelo
const SC_WEIGHTS = { star: 50, gem: 18, bomb: 16, heart: 5, magnet: 4, dbl: 4, ice: 3 };
const CAM_FOV = 70, CAM_Z = 14, CAM_Y = 9;
const FOLLOW = 0.15;                                      // la cámara se desplaza un poco con la cesta

const pickType = () => {
  const tot = Object.values(SC_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (const k of Object.keys(SC_WEIGHTS)) { r -= SC_WEIGHTS[k]; if (r <= 0) return k; }
  return 'star';
};
const lerpV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const camOf = s => ({ p: s.cp || [FOLLOW * s.x, CAM_Y, CAM_Z], l: s.cl || [FOLLOW * s.x, 0.6, -4], fov: CAM_FOV });

// Fondo de estrellas y rejilla del suelo: fijos, se crean una vez.
const SKY = Array.from({ length: 46 }, (_, i) => ({ id: `bg${i}`, x: rand(-40, 40), y: rand(2, 30), z: rand(-80, -30), n: rand(0.12, 0.3) }));
const GRID = [
  { id: 'suelo', k: 'pla', p: [0, 0, -1.5], s: [34, 46, 1], c: '#0b0b24', recv: true, m: { r: 0.9, m: 0 } },
  ...Array.from({ length: 11 }, (_, i) => ({ id: `lx${i}`, k: 'box', p: [-10 + i * 2, 0.01, -1.5], s: [0.05, 0.02, 46], c: '#2a3aa8', e: 0.5 })),
  ...Array.from({ length: 12 }, (_, j) => ({ id: `lz${j}`, k: 'box', p: [0, 0.01, -18 + j * 2], s: [34, 0.02, 0.05], c: '#2a3aa8', e: 0.5 })),
  ...SKY.map(b => ({ inst: 'estrella', k: 'sph', p: [b.x, b.y, b.z], n: b.n, c: '#ffffff', e: 1 })),
];

const spawn = (s, y) => {
  s.objs.push({ id: uid(), type: pickType(), x: rand(-SC_X + 0.6, SC_X - 0.6), y, z: rand(-6.5, -1), vy: (3.4 + s.t * 0.07) * rand(0.9, 1.25), vz: rand(0.2, 0.9), spin: rand(0, 6) });
};

const initState = () => {
  const s = { x: 0, z: 0, tx: 0, tz: 0, objs: [], spawn: 0.4, time: SC_TIME, t: 0, score: 0, lives: 3, combo: 0, maxCombo: 0, magnet: 0, dbl: 0, freeze: 0, cp: null, cl: null, dead: false };
  for (let i = 0; i < 7; i++) spawn(s, rand(2, 10));   // ya hay estrellas cayendo en el menú
  return s;
};

// Escena: cesta con luz, objetos que caen y el cielo con la luna.
function buildScene(s, t) {
  const objs = [];
  objs.push({ id: 'cesta', k: 'cyl', p: [s.x, 0.3, s.z], s: [2.4, 0.6, 2.4], c: C.amber, m: { r: 0.3, m: 0.6 }, sh: true });
  objs.push({ id: 'cesta-hueco', k: 'cyl', p: [s.x, 0.46, s.z], s: [2.0, 0.5, 2.0], c: '#1a1433', e: 0.02 });
  objs.push({ id: 'cesta-aro', k: 'tor', p: [s.x, 0.62, s.z], n: 2.5, r: [Math.PI / 2, 0, 0], c: '#ffd54a', e: 0.6 });
  if (s.magnet > 0) objs.push({ id: 'iman', k: 'tor', p: [s.x, 0.15, s.z], n: 3.6, r: [Math.PI / 2, 0, 0], c: '#22e6ff', e: 0.5, o: 0.6 });
  s.objs.forEach(o => {
    const id = String(o.id);
    if (o.type === 'star') objs.push(...coin(id, [o.x, o.y, o.z], { c: '#ffc233', spin: o.spin, t, bob: 0 }));
    if (o.type === 'gem') objs.push(...gem(id, [o.x, o.y, o.z], { c: '#22e6ff', spin: o.spin, t, bob: 0.06 }));
    if (o.type === 'bomb') {
      objs.push({ id, k: 'sph', p: [o.x, o.y, o.z], n: 0.92, c: '#20202c', m: { r: 0.4, m: 0 }, sh: true });
      objs.push({ id: `f${id}`, k: 'box', p: [o.x, o.y + 0.56, o.z], s: [0.12, 0.3, 0.12], c: '#ff8a3d', e: 0.4 });
      objs.push({ id: `c${id}`, k: 'sph', p: [o.x, o.y + 0.78 + Math.sin(t * 20) * 0.03, o.z], n: 0.2, c: '#ffd54a', e: 1 });
    }
    if (o.type === 'heart') objs.push({ id, k: 'sph', p: [o.x, o.y, o.z], n: 0.8, c: '#ff4d6d', e: 0.4, sh: true });
    if (o.type === 'magnet') objs.push({ id, k: 'tor', p: [o.x, o.y, o.z], n: 0.95, r: [o.spin, 0.4, 0], c: '#22e6ff', e: 0.5 });
    if (o.type === 'dbl') objs.push({ id, k: 'tor', p: [o.x, o.y, o.z], n: 0.95, r: [o.spin, 0.4, 0], c: '#ff3df2', e: 0.5 });
    if (o.type === 'ice') objs.push({ id, k: 'box', p: [o.x, o.y, o.z], s: [0.85, 0.85, 0.85], r: [o.spin * 0.5, o.spin * 0.7, 0], c: '#8be9ff', e: 0.35, o: 0.8 });
  });
  const c = camOf(s);
  return {
    sky: { top: '#04041a', bottom: '#1a1450', sun: true, sunC: '#dfe8ff', clouds: 0 },
    fog: { c: '#1a1450', near: 22, far: 60 },
    light: { dir: [-0.5, 0.9, 0.35], sun: '#dbe6ff', i: 1.6, sky: '#8fa2ff', ground: '#141430', hi: 1.1 },
    shadowR: 16, statics: GRID, objs,
    lights: [{ p: [s.x, 1.4, s.z], c: '#ffc233', i: 5, d: 6 }],
    cam: { p: c.p, l: c.l, fov: CAM_FOV },
  };
}

export function StarCatcher3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('starcatcher');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = (s, why) => { s.dead = true; hx.win(); setRes({ isNew: submitBest(s.score), why }); setPhase('over'); };
  // posición en pantalla de la cesta, para situar los textos 2D sobre ella
  const basketPx = s => project({ p: s.cp || camOf(s).p, l: s.cl || camOf(s).l, fov: CAM_FOV }, [s.x, 1.4, s.z], SCREEN_W, SCREEN_H) || { x: SCREEN_W / 2, y: SCREEN_H / 2 };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.dead) return;
    s.t += dt; s.time -= dt;
    ['magnet', 'dbl', 'freeze'].forEach(k => { if (s[k] > 0) s[k] = Math.max(0, s[k] - dt); });
    const follow = Math.min(1, dt * 12);
    s.x += (s.tx - s.x) * follow; s.z += (s.tz - s.z) * follow;
    const tp = [FOLLOW * s.x, CAM_Y, CAM_Z], tl = [FOLLOW * s.x, 0.6, -4], cf = Math.min(1, dt * 4);
    s.cp = s.cp ? lerpV(s.cp, tp, cf) : tp; s.cl = s.cl ? lerpV(s.cl, tl, cf) : tl;
    const fall = (3.4 + s.t * 0.07) * (s.freeze > 0 ? 0.4 : 1);
    s.spawn -= dt;
    if (s.spawn <= 0) {
      spawn(s, SC_SPAWN_Y);
      s.spawn = Math.max(0.22, 0.6 - s.t * 0.005);
    }
    for (let i = s.objs.length - 1; i >= 0; i--) {
      const o = s.objs[i];
      o.spin += dt * 2.5;
      o.z += o.vz * dt;                                   // avanzan hacia la cámara
      if (s.magnet > 0 && (o.type === 'star' || o.type === 'gem') && o.y > 3) {
        const dx = s.x - o.x, dz = s.z - o.z, m = Math.hypot(dx, dz) || 1, sp = Math.min(m, 6 * dt);
        o.x += (dx / m) * sp; o.z += (dz / m) * sp;
      }
      o.y -= (s.freeze > 0 ? fall : o.vy) * dt;
      // destellos al caer (monedas y gemas)
      if ((o.type === 'star' || o.type === 'gem') && Math.random() < 0.35) burst3d([o.x, o.y + 0.4, o.z], ['#ffe9a0', '#ffffff'], 1, { speed: 0.7, up: 0.5, g: -0.4, size: 0.08, life: 0.6, spread: 0.6 });
      const caught = o.y < SC_BASKET_Y + 0.4 && o.y > SC_BASKET_Y - 1.0 && Math.hypot(o.x - s.x, o.z - s.z) < SC_CATCH_R;
      if (caught) {
        s.objs.splice(i, 1);
        const m = s.dbl > 0 ? 2 : 1, bp = basketPx(s);
        const cx3 = [s.x, 0.9, s.z];
        if (o.type === 'star' || o.type === 'gem') {
          s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
          const pts = (o.type === 'gem' ? 5 : 1) * m * (1 + Math.floor(s.combo / 8));
          s.score += pts;
          burst3d(cx3, o.type === 'gem' ? ['#22e6ff', '#ffffff'] : ['#ffd54a', '#fff3b0'], 14, { speed: 4.5, up: 3.5, g: 10, size: 0.14, life: 0.8 });
          fx.pop(bp.x, bp.y - 30, `+${pts}`, C.text, 15); hx.tap();
        } else if (o.type === 'bomb') {
          s.lives -= 1; s.combo = 0;
          burst3d(cx3, ['#ff4d6d', '#ff8a3d', '#ffd54a'], 46, { speed: 7, up: 4, g: 9, size: 0.2, life: 0.9 });
          ring3d([s.x, 0.2, s.z], '#ff4d6d', 28, { speed: 6, life: 0.6, size: 0.14 });
          fx.shake(9, 0.3); fx.flash(C.red, 0.3); hx.bad();
          if (s.lives <= 0) { finish(s, 'bombas'); return; }
        } else if (o.type === 'heart') {
          s.lives = Math.min(5, s.lives + 1);
          fx.pop(bp.x, bp.y - 30, '+1 VIDA', C.red, 15); ring3d([s.x, 0.2, s.z], '#ff4d6d', 24, { speed: 4, life: 0.6, size: 0.12 }); hx.good();
        } else if (o.type === 'magnet') { s.magnet = 8; fx.pop(bp.x, bp.y - 30, 'IMÁN', C.cyan, 15); ring3d([s.x, 0.2, s.z], '#22e6ff', 24, { speed: 4, life: 0.6, size: 0.12 }); hx.good(); }
        else if (o.type === 'dbl') { s.dbl = 8; fx.pop(bp.x, bp.y - 30, 'PUNTOS ×2', C.pink, 15); ring3d([s.x, 0.2, s.z], '#ff3df2', 24, { speed: 4, life: 0.6, size: 0.12 }); hx.good(); }
        else if (o.type === 'ice') { s.freeze = 5; fx.pop(bp.x, bp.y - 30, 'CONGELADO', C.cyan, 15); fx.flash(C.cyan, 0.2); hx.good(); }
      } else if (o.y < -0.8 || o.z > 6) {
        s.objs.splice(i, 1);
        if (o.type === 'star' || o.type === 'gem') s.combo = 0;
      }
    }
    if (s.time <= 0) { s.time = 0; finish(s, 'tiempo'); }
  });

  // arrastrar o tocar: la cesta va al punto del suelo bajo el dedo
  const aim = (x, y) => {
    const s = g.current;
    const hit = rayGround(camOf(s), x, y, SCREEN_W, SCREEN_H, 0);
    if (!hit) return;
    s.tx = clamp(hit[0], -SC_X, SC_X);
    s.tz = clamp(hit[2], SC_Z0, SC_Z1);
  };
  const pan = usePan(fx, { down: aim, move: aim });

  const s = g.current;
  const scene = buildScene(s, s.t);
  const bp = basketPx(s);
  return (
    <Game3D title="STAR CATCHER" emoji="⭐" accent={C.amber} onExit={onExit} score={s.score} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene} orbit={{ r: 14, h: 6, speed: 0.16, ly: 0.8, drop: 2.2 }}
      hud={<>
        <HudPill icon="⏱" value={`${Math.ceil(s.time)}s`} color={s.time < 10 ? C.red : C.cyan} />
        <Lives n={s.lives} max={Math.max(3, s.lives)} />
        {s.combo > 2 && <Combo n={s.combo} color={C.amber} />}
        {s.magnet > 0 && <HudPill icon="🧲" value={`${Math.ceil(s.magnet)}s`} color={C.cyan} />}
        {s.dbl > 0 && <HudPill icon="🌈" value={`×2 ${Math.ceil(s.dbl)}s`} color={C.pink} />}
        {s.freeze > 0 && <HudPill icon="❄️" value={`${Math.ceil(s.freeze)}s`} color={C.cyan} />}
      </>}
      subtitle="60 segundos para atrapar estrellas"
      lines={['Arrastra o toca el suelo para mover la cesta', '⭐ 1 · 💎 5 · 💣 quita vida', '🧲 imán · 🌈 ×2 · ❄️ congela · ❤️ vida', 'No dejar caer estrellas mantiene la racha']}
      result={{ title: res.why === 'bombas' ? 'DEMASIADAS BOMBAS' : '¡TIEMPO!', emoji: '⭐', subtitle: `Mejor racha: ${s.maxCombo}`, isNew: res.isNew, stats: [['RACHA', s.maxCombo], ['VIDAS', s.lives]] }}>
    </Game3D>
  );
}
