import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, Combo, GameScreen, Lives, Overlay, PlayArea, alpha, clamp, hx, rand, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Tercera persona: la cesta está sobre el suelo 3D, detrás de la cámara. Arrastra o toca para
// llevarla a ese punto del suelo (horizontal = izquierda/derecha, vertical = más cerca/más lejos).
// Las estrellas caen desde el fondo, avanzan en profundidad hacia la cámara y hay que cogerlas.
const SC_TIME = 60, SC_SPAWN_Y = 13, SC_BASKET_Y = 0.6, SC_CATCH_R = 1.35;
const SC_X = 4.5, SC_Z0 = -5.5, SC_Z1 = 3;                // límites de la cesta sobre el suelo
const SC_WEIGHTS = { star: 50, gem: 18, bomb: 16, heart: 5, magnet: 4, dbl: 4, ice: 3 };

const pickType = () => {
  const tot = Object.values(SC_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (const k of Object.keys(SC_WEIGHTS)) { r -= SC_WEIGHTS[k]; if (r <= 0) return k; }
  return 'star';
};
const aimBasket = (s, x, y) => {
  s.tx = clamp((x / AREA_W - 0.5) * SC_X * 2, -SC_X, SC_X);
  s.tz = clamp(SC_Z0 + (y / AREA_H) * (SC_Z1 - SC_Z0), SC_Z0, SC_Z1);
};
const initState = () => ({ x: 0, z: 0, tx: 0, tz: 0, objs: [], spawn: 0.4, time: SC_TIME, t: 0, score: 0, lives: 3, combo: 0, maxCombo: 0, magnet: 0, dbl: 0, freeze: 0 });

// Estrellas de fondo y rejilla del suelo: son fijas, se crean una vez.
const makeSky = () => Array.from({ length: 40 }, (_, i) => ({ id: `bg${i}`, x: rand(-34, 34), y: rand(2, 26), z: rand(-70, -28), n: rand(0.1, 0.25) }));

export function StarCatcher3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('starcatcher');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const sky = useRef(null);
  if (!sky.current) sky.current = makeSky();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const finish = (s, why) => { hx.win(); setRes({ isNew: submitBest(s.score), why }); setPhase('over'); };
  // posición en pantalla aproximada de la cesta, para situar los textos 2D
  const basketX = s => AREA_W / 2 + clamp(s.x / SC_X, -1, 1) * AREA_W * 0.36;

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt; s.time -= dt;
    ['magnet', 'dbl', 'freeze'].forEach(k => { if (s[k] > 0) s[k] = Math.max(0, s[k] - dt); });
    const follow = Math.min(1, dt * 12);
    s.x += (s.tx - s.x) * follow; s.z += (s.tz - s.z) * follow;
    const fall = (3.4 + s.t * 0.07) * (s.freeze > 0 ? 0.4 : 1);
    s.spawn -= dt;
    if (s.spawn <= 0) {
      s.objs.push({ id: uid(), type: pickType(), x: rand(-SC_X + 0.6, SC_X - 0.6), y: SC_SPAWN_Y, z: rand(-6.5, -1), vy: fall * rand(0.9, 1.25), vz: rand(0.2, 0.9), spin: rand(0, 6) });
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
      const caught = o.y < SC_BASKET_Y + 0.4 && o.y > SC_BASKET_Y - 1.0 && Math.hypot(o.x - s.x, o.z - s.z) < SC_CATCH_R;
      if (caught) {
        s.objs.splice(i, 1);
        const m = s.dbl > 0 ? 2 : 1, bx = basketX(s), by = AREA_H * 0.72;
        if (o.type === 'star' || o.type === 'gem') {
          s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
          const pts = (o.type === 'gem' ? 5 : 1) * m * (1 + Math.floor(s.combo / 8));
          s.score += pts; fx.burst(bx, by, o.type === 'gem' ? C.cyan : C.amber, 8, 150, 0.4, 4); fx.pop(bx, by - 30, `+${pts}`, C.text, 14); hx.tap();
        } else if (o.type === 'bomb') {
          s.lives -= 1; s.combo = 0; fx.burst(bx, by, C.red, 22, 260); fx.shake(9, 0.3); fx.flash(C.red, 0.3); hx.bad();
          if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score), why: 'bombas' }); setPhase('over'); return; }
        } else if (o.type === 'heart') { s.lives = Math.min(5, s.lives + 1); fx.pop(bx, by - 30, '+1 VIDA', C.red, 15); fx.ring(bx, by, C.red, 44); hx.good(); }
        else if (o.type === 'magnet') { s.magnet = 8; fx.pop(bx, by - 30, 'IMÁN', C.cyan, 15); hx.good(); }
        else if (o.type === 'dbl') { s.dbl = 8; fx.pop(bx, by - 30, 'PUNTOS ×2', C.pink, 15); hx.good(); }
        else if (o.type === 'ice') { s.freeze = 5; fx.pop(bx, by - 30, 'CONGELADO', C.cyan, 15); fx.flash(C.cyan, 0.2); hx.good(); }
      } else if (o.y < -0.8 || o.z > 6) {
        s.objs.splice(i, 1);
        if (o.type === 'star' || o.type === 'gem') s.combo = 0;
      }
    }
    if (s.time <= 0) { s.time = 0; finish(s, 'tiempo'); }
  });

  const pan = usePan(fx, { down: (x, y) => aimBasket(g.current, x, y), move: (x, y) => aimBasket(g.current, x, y) });
  const s = g.current;
  const objs = [];
  objs.push({ id: 'suelo', k: 'pla', p: [0, 0, -1.5], s: [30, 40, 1], c: '#0b0b24' });
  for (let i = -10; i <= 10; i += 2) objs.push({ id: `lx${i}`, k: 'box', p: [i, 0.01, -1.5], s: [0.04, 0.02, 40], c: '#1c1f4d' });
  for (let j = -18; j <= 4; j += 2) objs.push({ id: `lz${j}`, k: 'box', p: [0, 0.01, j], s: [30, 0.02, 0.04], c: '#1c1f4d' });
  sky.current.forEach(b => objs.push({ id: b.id, k: 'sph', p: [b.x, b.y, b.z], n: b.n, c: '#ffffff', e: 0.6 }));
  // cesta
  objs.push({ id: 'cesta', k: 'cyl', p: [s.x, 0.3, s.z], s: [2.4, 0.6, 2.4], c: C.amber, e: 0.08 });
  objs.push({ id: 'cesta-hueco', k: 'cyl', p: [s.x, 0.46, s.z], s: [2.0, 0.5, 2.0], c: '#1a1433', e: 0.02 });
  objs.push({ id: 'cesta-aro', k: 'tor', p: [s.x, 0.62, s.z], n: 2.5, r: [Math.PI / 2, 0, 0], c: C.amber, e: 0.25 });
  if (s.magnet > 0) objs.push({ id: 'iman', k: 'tor', p: [s.x, 0.15, s.z], n: 3.6, r: [Math.PI / 2, 0, 0], c: C.cyan, e: 0.3, o: 0.6 });
  // objetos que caen
  s.objs.forEach(o => {
    const id = String(o.id);
    if (o.type === 'star') objs.push({ id, k: 'box', p: [o.x, o.y, o.z], s: [0.75, 0.75, 0.75], r: [o.spin, o.spin * 1.3, 0], c: '#ffae00', e: 0.06 });
    if (o.type === 'gem') objs.push({ id, k: 'sph', p: [o.x, o.y, o.z], n: 0.8, c: '#22e6ff', e: 0.14 });
    if (o.type === 'bomb') {
      objs.push({ id, k: 'sph', p: [o.x, o.y, o.z], n: 0.95, c: '#20202c', e: 0.04 });
      objs.push({ id: `f${id}`, k: 'box', p: [o.x, o.y + 0.55, o.z], s: [0.14, 0.3, 0.14], c: '#ff8a3d', e: 0.4 });
    }
    if (o.type === 'heart') objs.push({ id, k: 'sph', p: [o.x, o.y, o.z], n: 0.8, c: '#ff4d6d', e: 0.12 });
    if (o.type === 'magnet') objs.push({ id, k: 'tor', p: [o.x, o.y, o.z], n: 0.95, r: [o.spin, 0.4, 0], c: '#22e6ff', e: 0.2 });
    if (o.type === 'dbl') objs.push({ id, k: 'tor', p: [o.x, o.y, o.z], n: 0.95, r: [o.spin, 0.4, 0], c: '#ff3df2', e: 0.2 });
    if (o.type === 'ice') objs.push({ id, k: 'box', p: [o.x, o.y, o.z], s: [0.85, 0.85, 0.85], r: [o.spin * 0.5, o.spin * 0.7, 0], c: '#8be9ff', e: 0.12, o: 0.8 });
  });

  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.05 : 0;
  const scene = {
    bg: '#06061a', fog: { c: '#06061a', near: 16, far: 42 }, objs,
    cam: { p: [s.x * 0.35 + (Math.random() - 0.5) * shake, 8.2, 11], l: [s.x * 0.35, 0.6, -4], fov: 60 },
  };

  return (
    <GameScreen title="STAR CATCHER" emoji="⭐" accent={C.amber} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: s.time < 10 ? C.red : C.text, fontWeight: '900', fontSize: 15 }}>⏱ {Math.ceil(s.time)}s</Text><Lives n={s.lives} max={Math.max(3, s.lives)} /><View style={{ minWidth: 80, alignItems: 'flex-end' }}>{s.combo > 2 ? <Combo n={s.combo} /> : <Text style={{ color: C.cyan, fontSize: 12, fontWeight: '800' }}>{s.magnet > 0 ? '🧲' : ''}{s.dbl > 0 ? '🌈' : ''}{s.freeze > 0 ? '❄️' : ''}</Text>}</View></>}>
      <PlayArea fx={fx} bg="#06061a" border={alpha(C.amber, 0.35)} {...pan}>
        <World3D scene={scene} />
        <Overlay show={phase !== 'play'} kind={phase} emoji="⭐" title={phase === 'over' ? (res.why === 'bombas' ? 'DEMASIADAS BOMBAS' : '¡TIEMPO!') : 'STAR CATCHER'}
          subtitle={phase === 'over' ? `Mejor racha: ${s.maxCombo}` : '60 segundos para atrapar estrellas'}
          score={s.score} best={best} isNew={res.isNew} accent={C.amber} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para mover la cesta por el suelo', '⭐ 1 · 💎 5 · 💣 quita vida', '🧲 imán · 🌈 ×2 · ❄️ congela · ❤️ vida', 'No dejar caer estrellas mantiene la racha'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
