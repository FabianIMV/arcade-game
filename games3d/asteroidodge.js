import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, clamp, hx, pick, rand, uid, useBest, useFX, useLoop, usePan, alpha, tglow } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Esquivar en TERCERA PERSONA: la nave está en z=0 y la cámara detrás. Los asteroides nacen lejos
// (z=-70) y vienen hacia la cámara; hay que pasar entre ellos moviéndose en x.
// Escala: 1 unidad ≈ 1 metro.
const AD_XH = 2.4;            // límite lateral de la nave
const AD_SY = 0.8;            // altura de la nave
const AD_SPAWN = -70;         // profundidad de aparición
const AD_CR = 0.6;            // radio de la nave (colisión)

const hsh = n => { const v = Math.sin(n * 91.3458) * 47453.5453; return v - Math.floor(v); };
const adStars = fly => Array.from({ length: 40 }, (_, i) => {
  const z = -70 + ((hsh(i + 7) * 76 + fly) % 76);
  return { id: `st${i}`, k: 'sph', p: [(hsh(i) * 2 - 1) * 22, hsh(i + 3) * 14 - 3, z], n: 0.13, c: '#cfe9ff', e: 1 };
});

const rockObjs = (r) => {
  const spin = [r.ang, r.ang * 0.7, r.ang * 0.4];
  if (r.odd) return [{ id: `rk${r.id}`, k: 'sph', p: [r.x, r.y, r.z], n: r.r * 2, r: spin, c: '#6b5443', e: 0.12 }];
  return [{ id: `rk${r.id}`, k: 'box', p: [r.x, r.y, r.z], s: [r.r * 1.8, r.r * 1.8, r.r * 1.8], r: spin, c: '#6b5443', e: 0.12 }];
};

const initState = () => ({
  x: 0, tx: 0, t: 0, bonus: 0, rocks: [], items: [], spawn: 1, slow: 0, shield: 0, near: 0,
  shower: 18, showerLeft: 0, banner: null, fly: 0,
});

export function AsteroidDodge3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('asteroid');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };

  const die = s => {
    fx.burst(AREA_W / 2, AREA_H * 0.7, C.orange, 30, 280, 0.8, 6); fx.shake(12, 0.4); fx.flash(C.red, 0.4); hx.die();
    const score = Math.floor(s.t * 10) + s.bonus;
    setRes({ isNew: submitBest(score) });
    setPhase('over');
  };

  useLoop(phase === 'play', rawDt => {
    const s = g.current;
    const k = s.slow > 0 ? 0.45 : 1;
    const dt = rawDt * k;
    s.t += rawDt;
    s.fly += (s.slow > 0 ? 40 : 140) * rawDt * 0.25;
    if (s.slow > 0) s.slow -= rawDt;
    if (s.banner) { s.banner.t -= rawDt; if (s.banner.t <= 0) s.banner = null; }
    s.x += (s.tx - s.x) * Math.min(1, rawDt * 18);
    const diff = Math.min(1, s.t / 90);
    // aparición de asteroides desde el fondo
    s.spawn -= dt;
    if (s.spawn <= 0) {
      const r = rand(0.5, 0.9 + diff * 0.8);
      s.rocks.push({
        id: uid(), x: rand(-AD_XH * 1.1, AD_XH * 1.1), y: rand(-0.6, 2.6), z: AD_SPAWN, r,
        vz: rand(15, 23) + diff * 22, vx: rand(-0.6, 0.6), vy: rand(-0.2, 0.2), rot: rand(-3, 3), ang: 0, odd: Math.random() < 0.5, g: false,
      });
      s.spawn = Math.max(0.16, 0.62 - diff * 0.42) * (s.showerLeft > 0 ? 0.35 : 1);
      if (Math.random() < 0.07) s.items.push({ id: uid(), x: rand(-AD_XH, AD_XH), y: rand(0, 1.8), z: AD_SPAWN, type: pick(['slow', 'shield', 'star', 'star']) });
    }
    s.shower -= rawDt;
    if (s.shower <= 0) { s.shower = 22; s.showerLeft = 4; s.banner = { text: '☄️ ¡LLUVIA DE METEORITOS!', t: 1.8 }; hx.warn(); }
    if (s.showerLeft > 0) s.showerLeft -= rawDt;
    s.rocks.forEach(r => { r.z += r.vz * dt; r.x += r.vx * dt; r.y += r.vy * dt; r.ang += r.rot * dt; });
    s.items.forEach(it => { it.z += 11 * dt; });
    s.rocks = s.rocks.filter(r => r.z < 8);
    s.items = s.items.filter(it => it.z < 8);

    // colisiones con la nave (esfera) y bonus "CERCA"
    for (let i = s.rocks.length - 1; i >= 0; i--) {
      const r = s.rocks[i];
      const d = Math.hypot(r.x - s.x, r.y - AD_SY, r.z);
      if (d < r.r + AD_CR) {
        if (s.shield > 0) {
          s.shield -= 1; s.rocks.splice(i, 1);
          fx.burst(AREA_W / 2, AREA_H * 0.7, C.cyan, 12, 180); fx.ring(AREA_W / 2, AREA_H * 0.7, C.cyan, 60); fx.shake(5); hx.hit();
          continue;
        }
        die(s);
        return;
      }
      if (!r.g && d < r.r + AD_CR + 1.2) {
        r.g = true; s.near += 1; s.bonus += 15;
        fx.pop(AREA_W / 2, AREA_H * 0.6, 'CERCA +15', C.amber, 13); hx.tick();
      }
    }
    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i];
      if (Math.hypot(it.x - s.x, it.y - AD_SY, it.z) < 1.1) {
        s.items.splice(i, 1); hx.good();
        const px = AREA_W / 2, py = AREA_H * 0.6;
        fx.ring(px, py, C.lime, 44);
        if (it.type === 'slow') { s.slow = 5; fx.pop(px, py, 'CÁMARA LENTA', C.violet, 14); }
        else if (it.type === 'shield') { s.shield = Math.min(2, s.shield + 1); fx.pop(px, py, 'ESCUDO', C.cyan, 14); }
        else { s.bonus += 50; fx.pop(px, py, '+50', C.amber, 16); }
      }
    }
  });

  const pan = usePan(fx, {
    down: x => { g.current.tx = clamp((x / AREA_W - 0.5) * 2 * AD_XH, -AD_XH, AD_XH); },
    move: x => { g.current.tx = clamp((x / AREA_W - 0.5) * 2 * AD_XH, -AD_XH, AD_XH); },
  });

  const s = g.current;
  const score = Math.floor(s.t * 10) + s.bonus;
  const shake = fx.shakeT > 0 ? (Math.random() - 0.5) * fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.1 : 0;
  const objs = [
    ...adStars(s.fly),
    ...s.items.map(it => ({ id: `it${it.id}`, k: 'sph', p: [it.x, it.y, it.z], n: 0.6, c: it.type === 'slow' ? C.violet : it.type === 'shield' ? C.cyan : C.lime, e: 0.9 })),
    ...s.rocks.flatMap(rockObjs),
  ];
  if (phase !== 'over') {
    objs.push(
      { id: 'ad-body', k: 'box', p: [s.x, AD_SY, -0.2], s: [0.55, 0.32, 1.9], c: C.cyan, e: 0.55 },
      { id: 'ad-cab', k: 'sph', p: [s.x, AD_SY + 0.2, -0.45], n: 0.42, c: C.orange, e: 0.6 },
      { id: 'ad-wing', k: 'box', p: [s.x, AD_SY - 0.04, 0.25], s: [2.0, 0.07, 0.7], c: C.violet, e: 0.45 },
      { id: 'ad-eng', k: 'sph', p: [s.x, AD_SY, 0.9], n: 0.38, c: C.orange, e: 1 },
    );
    if (s.shield > 0) objs.push({ id: 'ad-shield', k: 'sph', p: [s.x, AD_SY, 0], n: AD_CR * 3.2, c: C.cyan, o: 0.18, e: 0.3 });
  }
  const scene = {
    bg: '#03030c', fog: { c: '#03030c', near: 14, far: 58 }, objs,
    cam: { p: [s.x * 0.5 + shake, 3.2, 7.2], l: [s.x * 0.3, 0.6, -12], fov: 62 },
  };

  return (
    <GameScreen title="ASTEROID DODGE" emoji="☄️" accent={C.cyan} onExit={onExit} score={score} best={best}
      hud={<>
        <Text style={{ color: C.dim, fontSize: 12 }}>Cerca: <Text style={{ color: C.amber, fontWeight: '800' }}>{s.near}</Text></Text>
        <Text style={{ color: C.violet, fontSize: 12, fontWeight: '800' }}>{s.slow > 0 ? `⏳ ${s.slow.toFixed(1)}s` : ''}{s.shield > 0 ? `  🛡️×${s.shield}` : ''}</Text>
        <Text style={{ color: C.dim, fontSize: 12 }}>{Math.floor(s.t)}s</Text>
      </>}>
      <PlayArea fx={fx} bg="#03030c" {...pan}>
        <World3D scene={scene} />
        {s.slow > 0 && <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: alpha(C.violet, 0.08) }} />}
        {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.22, width: AREA_W, textAlign: 'center', color: C.orange, fontSize: 20, fontWeight: '900', letterSpacing: 2, ...tglow(C.orange, 12, 1) }}>{s.banner.text}</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="☄️" title={phase === 'over' ? 'IMPACTO' : 'ASTEROID DODGE 3D'}
          subtitle={phase === 'over' ? `Sobreviviste ${Math.floor(s.t)} segundos` : 'Sobrevive el mayor tiempo posible'}
          score={score} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Desliza el dedo para mover la nave', 'Pasa cerca de las rocas para ganar bonus "CERCA"', '⏳ cámara lenta · 🛡️ escudo · ⭐ puntos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
