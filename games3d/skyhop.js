import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, clamp, hx, rand, uid, useBest, useFX, useLoop, usePan, alpha } from '../utils/kit';
import { World3D } from '../utils/World3D';

// SKY HOP 3D: saltas de plataforma en plataforma por un cielo 3D. Arrastra para llevarte a un punto:
// horizontal = izquierda/derecha, vertical = más lejos / más cerca de la cámara. Cámara detrás, sigue tu altura.
const PWX = 1.7, PWZ = 1.5, BODY = 1.0;   // tamaño de plataforma (x, z) y altura del personaje
const G = 29.3, JUMP = 12.5, SPRING = 19.5, JET_V = 14.8; // gravedad y velocidades de salto (u/s)
const XMAX = 4.2, ZMAX = 3.2, WRAP = 9;
const CAM_Z = 10.5;

const initState = () => {
  const s = {
    p: { x: 0, y: 0.2, z: 0, vy: 0, face: 1 }, tx: 0, tz: 0, camY: 0, top: 0, plats: [], mons: [], items: [],
    t: 0, score: 0, bonus: 0, jet: 0, maxH: 0,
  };
  s.plats.push({ id: uid(), x: 0, z: 0, y: 0, k: 'n', broken: false });
  return s;
};

// Ayuda visual de cielo: estrellas que se desplazan con la altura (parallax)
const STARS = Array.from({ length: 28 }, (_, i) => ({ x: ((i * 37) % 17) / 17 * 16 - 8, z: -16 - (i % 4) * 3, f: 0.25 + ((i * 13) % 7) / 14 }));

export function SkyHop3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('skyhop');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const die = s => { hx.die(); fx.shake(8, 0.3); fx.flash(C.red, 0.3); setRes({ isNew: submitBest(Math.floor(s.maxH + s.bonus)) }); setPhase('over'); };
  // genera plataformas por encima de la cámara
  const gen = s => {
    const h = Math.max(0, s.maxH);
    while (s.top < s.camY + 18) {
      s.top += rand(1.1, 1.6 + Math.min(0.7, h / 80));
      const r = Math.random(); const level = Math.min(1, h / 58);
      const k = r < 0.12 + level * 0.1 ? 'm' : r < 0.2 + level * 0.18 ? 'b' : r < 0.26 + level * 0.18 ? 's' : 'n';
      const pl = { id: uid(), x: rand(-3.2, 3.2), z: rand(-2.6, 2.6), y: s.top, k, dx: rand(1, 1.8) * (Math.random() < 0.5 ? 1 : -1), broken: false };
      s.plats.push(pl);
      if (h > 9 && k === 'n' && Math.random() < 0.12) s.mons.push({ id: uid(), x: pl.x, z: pl.z, y: pl.y, alive: true });
      else if (Math.random() < 0.07) s.items.push({ id: uid(), x: pl.x, z: pl.z, y: pl.y + 0.9, kind: Math.random() < 0.35 ? 'jet' : 'star', got: false });
    }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p; s.t += dt;
    gen(s);
    p.x += (s.tx - p.x) * Math.min(1, dt * 12); p.z += (s.tz - p.z) * Math.min(1, dt * 12);
    if (p.x - s.tx > 0.2) p.face = -1; else if (p.x - s.tx < -0.2) p.face = 1;
    if (p.x < -XMAX - 0.3) { p.x += WRAP; s.tx += WRAP; } if (p.x > XMAX + 0.3) { p.x -= WRAP; s.tx -= WRAP; }
    const prevY = p.y;
    if (s.jet > 0) { s.jet -= dt; p.vy = JET_V; if (Math.random() < dt * 40) fx.burst(AREA_W / 2, AREA_H * 0.7, C.orange, 2, 90, 0.3, 4); } else p.vy -= G * dt;
    p.y += p.vy * dt;
    s.plats.forEach(pl => { if (pl.k === 'm') { pl.x += pl.dx * dt; if (pl.x < -3.2 || pl.x > 3.2) pl.dx *= -1; } });
    // aterrizar sobre una plataforma (solo cayendo)
    if (p.vy < 0 && s.jet <= 0) {
      for (const pl of s.plats) {
        if (pl.broken) continue;
        if (Math.abs(p.x - pl.x) < PWX / 2 + 0.3 && Math.abs(p.z - pl.z) < PWZ / 2 + 0.3 && prevY >= pl.y - 0.05 && p.y <= pl.y) {
          if (pl.k === 'b') { pl.broken = true; fx.burst(AREA_W / 2, AREA_H * 0.6, '#c08c52', 8, 160); hx.tick(); continue; }
          p.y = pl.y; p.vy = pl.k === 's' ? SPRING : JUMP; hx.tap();
          if (pl.k === 's') fx.pop(AREA_W / 2, AREA_H * 0.4, '¡RESORTE!', C.amber, 16);
          break;
        }
      }
    }
    // monstruos: aplastarlos desde arriba o chocar = morir
    for (const m of s.mons) {
      if (!m.alive) continue;
      const top = m.y + 0.6;
      if (Math.abs(p.x - m.x) < 0.7 && Math.abs(p.z - m.z) < 0.7 && p.y < top && p.y + BODY > m.y) {
        if (p.vy < 0 && prevY >= top - 0.25 && s.jet <= 0) { m.alive = false; p.vy = 10; s.bonus += 50; hx.hit(); }
        else if (s.jet > 0) { m.alive = false; s.bonus += 50; hx.hit(); }
        else { die(s); return; }
      }
    }
    for (const it of s.items) {
      if (!it.got && Math.abs(p.x - it.x) < 0.9 && Math.abs(p.z - it.z) < 0.9 && Math.abs(p.y + 0.5 - it.y) < 1.1) {
        it.got = true; hx.good();
        if (it.kind === 'jet') { s.jet = 1.6; fx.pop(AREA_W / 2, AREA_H * 0.35, '¡COHETE!', C.orange, 16); } else { s.bonus += 25; fx.pop(AREA_W / 2, AREA_H * 0.35, '+25', C.amber, 15); }
      }
    }
    s.camY = Math.max(s.camY, p.y - 0.8);
    s.maxH = Math.max(s.maxH, p.y);
    s.score = Math.floor(s.maxH);
    s.plats = s.plats.filter(pl => !pl.broken && pl.y > s.camY - 8);
    s.mons = s.mons.filter(m => m.y > s.camY - 8); s.items = s.items.filter(i => i.y > s.camY - 8 && !i.got);
    if (p.y < s.camY - 4.2) die(s);
  });

  const pan = usePan(fx, {
    down: (x, y) => { const s = g.current; s.tx = clamp((x / AREA_W - 0.5) * 6.6, -XMAX, XMAX); s.tz = clamp((0.5 - y / AREA_H) * 6, -ZMAX, ZMAX); },
    move: (x, y) => { const s = g.current; s.tx = clamp((x / AREA_W - 0.5) * 6.6, -XMAX, XMAX); s.tz = clamp((0.5 - y / AREA_H) * 6, -ZMAX, ZMAX); },
  });

  const s = g.current; const p = s.p; const sc = Math.floor(s.score + s.bonus);
  const camY = s.camY;
  const objs = [
    ...STARS.map((st, i) => ({ id: `st${i}`, k: 'sph', p: [st.x, camY - 6 + ((i * 4.37 + camY * st.f) % 14), st.z], n: 0.09, c: '#ffffff', e: 0.9 })),
    ...s.plats.map(pl => ({ id: `pl${pl.id}`, k: 'box', p: [pl.x, pl.y - 0.15, pl.z], s: [PWX, 0.3, PWZ], c: pl.k === 'm' ? C.blue : pl.k === 'b' ? '#c08c52' : pl.k === 's' ? C.amber : C.lime, e: 0.45 })),
    ...s.items.map(it => it.kind === 'jet'
      ? { id: `it${it.id}`, k: 'cone', p: [it.x, it.y + 0.4, it.z], s: [0.5, 0.8, 0.5], c: C.orange, e: 0.9 }
      : { id: `it${it.id}`, k: 'sph', p: [it.x, it.y + 0.4, it.z], n: 0.45, c: C.amber, e: 0.9 }),
    ...s.mons.map(m => ({ id: `mo${m.id}`, k: 'box', p: [m.x, m.y + 0.3, m.z], s: [0.6, 0.6, 0.6], c: C.violet, e: 0.5, o: m.alive ? 1 : 0 })),
    ...(s.jet > 0 ? [{ id: 'llama', k: 'cone', p: [p.x, p.y - 0.25, p.z], r: [Math.PI, 0, 0], s: [0.35, 0.6, 0.35], c: C.orange, e: 1, o: 0.85 }] : []),
    { id: 'cuerpo', k: 'box', p: [p.x, p.y + 0.35, p.z], s: [0.55, 0.7, 0.5], c: C.cyan, e: 0.6 },
    { id: 'cabeza', k: 'sph', p: [p.x, p.y + 0.9, p.z], n: 0.42, c: '#ffffff', e: 0.7 },
  ];
  const scene = {
    bg: '#05102a', fog: { c: '#05102a', near: 14, far: 40 }, objs,
    cam: { p: [0, camY + 3.4, CAM_Z], l: [0, camY + 1.2, 0], fov: 64 },
  };
  return (
    <GameScreen title="SKY HOP" emoji="🦘" accent={C.cyan} onExit={onExit} score={sc} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Altura <Text style={{ color: C.cyan, fontWeight: '900' }}>{Math.floor(s.maxH)} m</Text></Text><Text style={{ color: C.orange, fontWeight: '900', fontSize: 12 }}>{s.jet > 0 ? '🚀 PROPULSIÓN' : ''}</Text><Text style={{ color: C.dim, fontSize: 12 }}>Toca y arrastra</Text></>}>
      <PlayArea fx={fx} bg="#05102a" border={alpha(C.cyan, 0.35)} {...pan}>
        <World3D scene={scene} />
        <Overlay show={phase !== 'play'} kind={phase} emoji="🦘" title={phase === 'over' ? 'CAÍSTE' : 'SKY HOP 3D'}
          subtitle={phase === 'over' ? `Subiste ${Math.floor(s.maxH)} metros` : 'Salta sin parar hacia el cielo'}
          score={sc} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra el dedo: izquierda/derecha y arriba/abajo', 'Rebota en las plataformas · 🔶 resortes dan más impulso', 'Marrón: se rompe · azul: se mueve', 'Cae sobre los 👾 para aplastarlos · 🚀 te propulsa'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
