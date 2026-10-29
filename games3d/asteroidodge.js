import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, Lives, SCREEN_H, SCREEN_W, clamp, hx, pick, rand, uid, useBest, useFX, useLoop, usePan, alpha, tglow } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { gem, ship } from '../utils/prefabs';

// ASTEROID DODGE 3D – esquivar en TERCERA PERSONA. Récord: 'asteroid'.
// La nave está en z=0 y la cámara detrás. Los asteroides nacen lejos (z=-70) y vienen hacia ti:
// hay que pasar entre ellos moviéndote en x. Bonus "CERCA" al rozarlos; ⏳ cámara lenta · 🛡️ escudo · ⭐ puntos.
const AD_XH = 2.4;            // límite lateral de la nave
const AD_SY = 0.8;            // altura de la nave
const AD_SPAWN = -70;         // profundidad de aparición
const AD_CR = 0.6;            // radio de la nave (colisión)
const ROCK_C = ['#7a6a5c', '#6b5d70', '#8a7360', '#5c6478'];
const ITEM_C = { slow: C.violet, shield: C.cyan, star: C.lime };

const hsh = n => { const v = Math.sin(n * 91.3458) * 47453.5453; return v - Math.floor(v); };

// Estrellas que pasan a toda velocidad (instancing: sin ids). fly = distancia recorrida
const adStars = fly => Array.from({ length: 48 }, (_, i) => {
  const z = -70 + ((hsh(i + 7) * 76 + fly) % 76);
  return { k: 'sph', inst: 'ad-estrella', p: [(hsh(i) * 2 - 1) * 22, hsh(i + 3) * 14 - 3, z], n: 0.12 + hsh(i + 9) * 0.08, c: i % 7 === 0 ? C.amber : '#cfe9ff', e: 1 };
});

// Decorado FIJO (se calcula una vez): planeta con anillo en el fondo y rejilla de neón bajo la nave
const AD_STATIC = [
  { id: 'ad-suelo', k: 'pla', p: [0, -2.6, -30], s: [240, 240, 1], c: '#080a1c', recv: true, m: { r: 0.9, m: 0 } },
  { id: 'ad-planeta', k: 'sph', p: [-24, 10, -66], n: 12, c: '#2f4f9a', e: 0.14 },
  { id: 'ad-anillo', k: 'ring', p: [-24, 10, -66], s: [30, 30, 1], r: [1.1, 0, 0.3], c: C.amber, e: 0.6, o: 0.8 },
  ...Array.from({ length: 19 }, (_, i) => ({ k: 'box', inst: 'ad-rejilla', p: [-44 + i * 4.8, -2.58, -30], s: [0.05, 0.02, 240], c: C.cyan, e: 0.8 })),
  ...Array.from({ length: 16 }, (_, i) => ({ k: 'box', inst: 'ad-rejilla', p: [0, -2.58, -120 + i * 8], s: [240, 0.02, 0.05], c: C.cyan, e: 0.8 })),
];

// Roca: dos trozos irregulares que giran (instancing, sin ids)
const rockObjs = r => [
  { k: 'ico', inst: 'ad-roca', p: [r.x, r.y, r.z], s: [r.r * 1.9, r.r * 1.6, r.r * 1.8], r: [r.ang, r.ang * 0.7, r.ang * 0.4], c: r.c, m: { r: 0.95, m: 0 } },
  { k: 'ico', inst: 'ad-roca', p: [r.x + r.r * 0.7, r.y - r.r * 0.35, r.z + r.r * 0.3], s: [r.r, r.r * 0.9, r.r * 1.1], r: [r.ang * 1.3, 0, r.ang], c: r.c2, m: { r: 0.95, m: 0 } },
];

const initState = () => ({
  x: 0, tx: 0, cx: 0, t: 0, bonus: 0, rocks: [], items: [], spawn: 1, slow: 0, shield: 0, near: 0,
  shower: 18, showerLeft: 0, banner: null, fly: 0, hitT: 0, dead: false, over: false,
});

// Escena completa: fly = avance de las estrellas (en juego, s.fly; en menús, animado con el reloj)
const buildScene = (s, fly) => {
  const objs = [
    ...adStars(fly),
    ...s.items.map(it => gem(`it${it.id}`, [it.x, it.y - 0.4, it.z], { c: ITEM_C[it.type], n: 0.9, t: s.t })).flat(),
    ...s.rocks.flatMap(rockObjs),
  ];
  if (!s.dead) {
    objs.push(...ship('ad-nave', [s.x, AD_SY, 0], { c: '#e4eaff', c2: C.orange, thrust: 0.9, t: s.t, n: 0.7, roll: clamp((s.tx - s.x) * -0.25, -0.4, 0.4), flash: s.hitT > 0.2 }));
    if (s.shield > 0) objs.push({ id: 'ad-escudo', k: 'sph', p: [s.x, AD_SY, 0], n: AD_CR * 3.2, c: C.cyan, o: 0.18 + 0.05 * Math.sin(s.t * 6), e: 0.6 });
  }
  return {
    sky: { top: '#03030c', bottom: '#110a2e', sun: false, clouds: 0 },
    fog: { c: '#110a2e', near: 26, far: 100 },
    light: { dir: [-0.4, 0.8, 0.4], sun: '#fff4e0', i: 2.0, sky: '#9fb4ff', ground: '#1a1030', hi: 1.2 },
    statics: AD_STATIC,
    objs,
    cam: { p: [s.cx * 0.5, 3.2, 7.2], l: [s.cx * 0.3, 0.6, -12], fov: 62 },
  };
};

export function AsteroidDodge3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('asteroid');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, secs: 0, near: 0, bonus: 0, score: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };

  const die = s => {
    if (s.over) return;
    s.over = true; s.dead = true;
    const score = Math.floor(s.t * 10) + s.bonus;
    burst3d([s.x, AD_SY, 0], ['#ff8a3d', '#ffc233', '#ffffff'], 60, { speed: 12, size: 0.3, life: 1.3, g: 2 });
    ring3d([s.x, AD_SY, 0], C.orange, 30, { speed: 9, life: 0.8 });
    fx.shake(14, 0.5); fx.flash(C.red, 0.4); hx.die();
    setRes({ isNew: submitBest(score), secs: Math.floor(s.t), near: s.near, bonus: s.bonus, score });
    setPhase('over');
  };

  useLoop(phase === 'play', rawDt => {
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    const k = s.slow > 0 ? 0.45 : 1;     // cámara lenta: el mundo va al 45 %
    const dt = rawDt * k;
    s.t += rawDt;
    s.hitT = Math.max(0, s.hitT - rawDt);
    s.fly += (s.slow > 0 ? 40 : 140) * rawDt * 0.25;
    if (s.slow > 0) s.slow -= rawDt;
    if (s.banner) { s.banner.t -= rawDt; if (s.banner.t <= 0) s.banner = null; }
    s.x += (s.tx - s.x) * Math.min(1, rawDt * 18);
    s.cx += (s.x - s.cx) * Math.min(1, rawDt * 4);
    const diff = Math.min(1, s.t / 90);

    // aparición de asteroides desde el fondo
    s.spawn -= dt;
    if (s.spawn <= 0) {
      const r = rand(0.5, 0.9 + diff * 0.8);
      const c = pick(ROCK_C);
      s.rocks.push({
        id: uid(), x: rand(-AD_XH * 1.1, AD_XH * 1.1), y: rand(-0.6, 2.6), z: AD_SPAWN, r,
        vz: rand(15, 23) + diff * 22, vx: rand(-0.6, 0.6), vy: rand(-0.2, 0.2), rot: rand(-3, 3), ang: 0, g: false,
        c, c2: ROCK_C[(ROCK_C.indexOf(c) + 1) % ROCK_C.length],
      });
      s.spawn = Math.max(0.16, 0.62 - diff * 0.42) * (s.showerLeft > 0 ? 0.35 : 1);
      if (Math.random() < 0.07) s.items.push({ id: uid(), x: rand(-AD_XH, AD_XH), y: rand(0, 1.8), z: AD_SPAWN, type: pick(['slow', 'shield', 'star', 'star']) });
    }
    // lluvia de meteoritos cada 22 s
    s.shower -= rawDt;
    if (s.shower <= 0) { s.shower = 22; s.showerLeft = 4; s.banner = { text: '☄️ ¡LLUVIA DE METEORITOS!', t: 1.8 }; hx.warn(); }
    if (s.showerLeft > 0) s.showerLeft -= rawDt;
    s.rocks.forEach(r => { r.z += r.vz * dt; r.x += r.vx * dt; r.y += r.vy * dt; r.ang += r.rot * dt; });
    s.items.forEach(it => { it.z += 11 * dt; });
    s.rocks = s.rocks.filter(r => r.z < 8);
    s.items = s.items.filter(it => it.z < 8);

    // colisiones con la nave (esfera) y bonus "CERCA"
    for (let i = s.rocks.length - 1; i >= 0 && !s.over; i--) {
      const r = s.rocks[i];
      const d = Math.hypot(r.x - s.x, r.y - AD_SY, r.z);
      if (d < r.r + AD_CR) {
        if (s.shield > 0) {
          s.shield -= 1; s.rocks.splice(i, 1); s.hitT = 0.3;
          burst3d([r.x, r.y, r.z], [C.cyan, '#ffffff'], 18, { speed: 8, size: 0.2, life: 0.7, g: 0 });
          ring3d([s.x, AD_SY, 0], C.cyan, 30, { speed: 8, life: 0.6 });
          fx.shake(6, 0.25); hx.hit();
          continue;
        }
        die(s);
        return;
      }
      if (!r.g && d < r.r + AD_CR + 1.2) {
        r.g = true; s.near += 1; s.bonus += 15;
        burst3d([s.x, AD_SY, 0], [C.amber, '#ffffff'], 8, { speed: 4, size: 0.14, life: 0.45, g: 0 });
        fx.pop(SCREEN_W / 2, SCREEN_H * 0.6, 'CERCA +15', C.amber, 13); hx.tick();
      }
    }
    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i];
      if (Math.hypot(it.x - s.x, it.y - AD_SY, it.z) < 1.1) {
        s.items.splice(i, 1); hx.good();
        const px = SCREEN_W / 2, py = SCREEN_H * 0.55;
        ring3d([it.x, it.y, it.z], ITEM_C[it.type], 26, { speed: 6, life: 0.6 });
        if (it.type === 'slow') { s.slow = 5; fx.pop(px, py, 'CÁMARA LENTA', C.violet, 14); }
        else if (it.type === 'shield') { s.shield = Math.min(2, s.shield + 1); fx.pop(px, py, 'ESCUDO', C.cyan, 14); }
        else { s.bonus += 50; fx.pop(px, py, '+50', C.amber, 16); }
      }
    }
  });

  const toX = x => clamp((x / SCREEN_W - 0.5) * 2 * AD_XH, -AD_XH, AD_XH);
  const pan = usePan(fx, {
    down: x => { g.current.tx = toX(x); },
    move: x => { g.current.tx = toX(x); },
  });

  const s = g.current;
  const score = Math.floor(s.t * 10) + s.bonus;
  const scene = buildScene(s, s.fly);

  return (
    <Game3D title="ASTEROID DODGE" emoji="☄️" accent={C.cyan} onExit={onExit} score={score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => buildScene(g.current, t * 40)}
      orbit={{ c: [0, 0.6, -2], r: 9, h: 2.6, speed: 0.2, ly: 1.2 }} pan={pan}
      hud={<>
        {s.shield > 0 ? <HudPill icon="🛡️" value={`×${s.shield}`} color={C.cyan} /> : null}
        <HudPill icon="⏱" label="CERCA" value={s.near} color={C.amber} />
        {s.slow > 0 ? <HudPill icon="⏳" value={`${s.slow.toFixed(1)}s`} color={C.violet} /> : null}
        <HudPill icon="⏱" value={`${Math.floor(s.t)}s`} color={C.cyan} />
      </>}
      subtitle="Sobrevive el mayor tiempo posible entre la lluvia de rocas"
      lines={['Arrastra el dedo para mover la nave', 'Pasa cerca de las rocas para ganar bonus "CERCA"', '⏳ cámara lenta · 🛡️ escudo · ⭐ puntos', '☄️ Cada 22 s cae una lluvia de meteoritos']}
      result={{ won: false, isNew: res.isNew, title: 'IMPACTO', emoji: '💥', subtitle: `Sobreviviste ${res.secs} segundos`, stats: [['TIEMPO', `${res.secs}s`], ['CERCA', res.near], ['BONUS', res.bonus]] }}>
      {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: SCREEN_H * 0.22, left: 0, right: 0, textAlign: 'center', color: C.orange, fontSize: 20, fontWeight: '900', letterSpacing: 2, ...tglow(C.orange, 12) }}>{s.banner.text}</Text>}
      {s.slow > 0 && <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: alpha(C.violet, 0.08) }} />}
    </Game3D>
  );
}
