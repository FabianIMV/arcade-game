import React, { useRef, useState } from 'react';
import { C, SCREEN_H, SCREEN_W, clamp, hx, rand, uid, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { enemy, gem, person } from '../utils/prefabs';

// SKY HOP 3D: rebotas de plataforma en plataforma hacia el cielo. Arrastra el dedo para llevarte a un punto:
// horizontal = izquierda/derecha, vertical = más lejos / más cerca de la cámara. Cámara detrás, sigue tu altura.
// Marrón: se rompe · azul: se mueve · ámbar: resorte (más impulso) · slime violeta: aplástalo desde arriba.
const PWX = 1.7, PWZ = 1.5, BODY = 1.0;   // tamaño de plataforma (x, z) y altura del personaje
const G = 29.3, JUMP = 12.5, SPRING = 19.5, JET_V = 14.8; // gravedad y velocidades de salto (u/s)
const XMAX = 4.2, ZMAX = 3.2, WRAP = 9;
const CAM_Z = 10.5;
const PI = Math.PI;

// Añade plataformas por encima de la cámara (dificultad creciente con la altura)
const genPlats = s => {
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

const initState = () => {
  const s = {
    p: { x: 0, y: 0.2, z: 0, vy: 0, face: 1 }, tx: 0, tz: 0, camY: 0, cy: 0, top: 0, plats: [], mons: [], items: [],
    t: 0, score: 0, bonus: 0, jet: 0, maxH: 0,
  };
  s.plats.push({ id: uid(), x: 0, z: 0, y: 0, k: 'n', broken: false });
  genPlats(s);
  return s;
};

// Estrellas con paralaje: se desplazan con la altura (inst)
const STARS = Array.from({ length: 30 }, (_, i) => ({ x: ((i * 37) % 17) / 17 * 16 - 8, z: -16 - (i % 4) * 3, f: 0.25 + ((i * 13) % 7) / 14 }));

// Escena (juego y menús)
function buildScene(s, t, moving) {
  const p = s.p;
  const camY = s.cy;
  const objs = [];
  STARS.forEach((st, i) => objs.push({ k: 'sph', inst: 'estrella', p: [st.x, camY - 6 + ((i * 4.37 + camY * st.f) % 14), st.z], n: 0.09, c: '#ffffff', e: 1 }));
  for (const pl of s.plats) {
    const col = pl.k === 'm' ? C.blue : pl.k === 'b' ? '#c08c52' : pl.k === 's' ? C.amber : C.lime;
    objs.push({ k: 'box', inst: 'plat', p: [pl.x, pl.y - 0.15, pl.z], s: [PWX, 0.3, PWZ], c: col, e: 0.5 });
    if (pl.k === 's') objs.push({ k: 'cyl', inst: 'resorte', p: [pl.x, pl.y + 0.14, pl.z], s: [0.36, 0.22, 0.36], c: '#fff3b0', e: 1 });
  }
  for (const it of s.items) {
    if (it.got) continue;
    if (it.kind === 'jet') objs.push({ id: `it${it.id}`, k: 'cone', p: [it.x, it.y + 0.4, it.z], s: [0.5, 0.8, 0.5], c: C.orange, e: 0.9 });
    else objs.push(...gem(`it${it.id}`, [it.x, it.y, it.z], { c: C.amber, t }));
  }
  for (const m of s.mons) if (m.alive) objs.push(...enemy(`mo${m.id}`, 'slime', [m.x, m.y, m.z], { t, c: C.violet }));
  // jugador: persona de cara a la cámara; brazos arriba al subir; cohete como llama
  const rising = p.vy > 0;
  if (s.jet > 0) objs.push({ id: 'llama', k: 'cone', p: [p.x, p.y - 0.4, p.z], r: [PI, 0, 0], s: [0.35, 0.7, 0.35], c: C.orange, e: 1, o: 0.85 });
  objs.push(...person('yo', [p.x, p.y, p.z], { yaw: PI, t, walk: moving && s.jet <= 0 ? 1 : 0, n: 0.85, hat: 'helmet', band: C.cyan, shirt: '#22e6ff', pants: '#1d2b5a', skin: '#f0c09a', hair: '#2a2a40', arms: rising ? 2.9 : 1.2 }));
  return {
    sky: { top: '#040a22', bottom: '#1a3d7a', sun: true, clouds: 0 },
    fog: { c: '#1a3d7a', near: 16, far: 44 },
    light: { dir: [-0.3, 0.85, 0.4], sun: '#fff3c4', i: 2.2, sky: '#8fb4ff', ground: '#1a2c52', hi: 1.4 },
    shadowR: 10,
    objs,
    cam: { p: [0, camY + 3.4, CAM_Z], l: [0, camY + 1.2, 0], fov: 64 },
  };
}

export function SkyHop3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('skyhop');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const die = s => {
    hx.die(); fx.shake(8, 0.3); fx.flash(C.red, 0.3);
    burst3d([s.p.x, s.p.y + 0.5, s.p.z], ['#4fb8ff', '#ffffff', C.cyan], 26, { speed: 5, up: 2, g: 10, size: 0.18, life: 0.9 });
    setRes({ isNew: submitBest(Math.floor(s.maxH + s.bonus)) });
    setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; const p = s.p; s.t += dt;
    genPlats(s);
    p.x += (s.tx - p.x) * Math.min(1, dt * 12); p.z += (s.tz - p.z) * Math.min(1, dt * 12);
    if (p.x - s.tx > 0.2) p.face = -1; else if (p.x - s.tx < -0.2) p.face = 1;
    if (p.x < -XMAX - 0.3) { p.x += WRAP; s.tx += WRAP; } if (p.x > XMAX + 0.3) { p.x -= WRAP; s.tx -= WRAP; }
    const prevY = p.y;
    if (s.jet > 0) { s.jet -= dt; p.vy = JET_V; burst3d([p.x, p.y - 0.5, p.z], ['#ff8a3d', '#ffc233'], 1, { speed: 1.5, up: -4, g: 2, size: 0.18, life: 0.35 }); } else p.vy -= G * dt;
    p.y += p.vy * dt;
    s.plats.forEach(pl => { if (pl.k === 'm') { pl.x += pl.dx * dt; if (pl.x < -3.2 || pl.x > 3.2) pl.dx *= -1; } });
    // aterrizar sobre una plataforma (solo cayendo)
    if (p.vy < 0 && s.jet <= 0) {
      for (const pl of s.plats) {
        if (pl.broken) continue;
        if (Math.abs(p.x - pl.x) < PWX / 2 + 0.3 && Math.abs(p.z - pl.z) < PWZ / 2 + 0.3 && prevY >= pl.y - 0.05 && p.y <= pl.y) {
          if (pl.k === 'b') { pl.broken = true; burst3d([pl.x, pl.y, pl.z], ['#c08c52', '#8a5a2b'], 14, { speed: 4, up: 1, g: 10, size: 0.2, life: 0.8 }); hx.tick(); continue; }
          p.y = pl.y; p.vy = pl.k === 's' ? SPRING : JUMP; hx.tap();
          burst3d([p.x, p.y, p.z], '#ffffff', 6, { speed: 2.4, up: 0.6, g: 6, size: 0.12, life: 0.45 });
          if (pl.k === 's') { ring3d([pl.x, pl.y + 0.1, pl.z], C.amber, 16, { speed: 5, life: 0.5 }); fx.pop(SCREEN_W / 2, SCREEN_H * 0.4, '¡RESORTE!', C.amber, 16); }
          break;
        }
      }
    }
    // monstruos: aplastarlos desde arriba o chocar = morir
    for (const m of s.mons) {
      if (!m.alive) continue;
      const top = m.y + 0.6;
      if (Math.abs(p.x - m.x) < 0.7 && Math.abs(p.z - m.z) < 0.7 && p.y < top && p.y + BODY > m.y) {
        if (p.vy < 0 && prevY >= top - 0.25 && s.jet <= 0) { m.alive = false; p.vy = 10; s.bonus += 50; hx.hit(); burst3d([m.x, m.y + 0.5, m.z], [C.violet, '#ffffff'], 22, { speed: 5, size: 0.18, life: 0.7 }); }
        else if (s.jet > 0) { m.alive = false; s.bonus += 50; hx.hit(); burst3d([m.x, m.y + 0.5, m.z], [C.violet, '#ffffff'], 22, { speed: 5, size: 0.18, life: 0.7 }); }
        else { die(s); return; }
      }
    }
    for (const it of s.items) {
      if (!it.got && Math.abs(p.x - it.x) < 0.9 && Math.abs(p.z - it.z) < 0.9 && Math.abs(p.y + 0.5 - it.y) < 1.1) {
        it.got = true; hx.good();
        if (it.kind === 'jet') {
          s.jet = 1.6; fx.pop(SCREEN_W / 2, SCREEN_H * 0.35, '¡COHETE!', C.orange, 16);
          ring3d([p.x, p.y, p.z], C.orange, 20, { speed: 6, life: 0.5 });
        } else {
          s.bonus += 25; fx.pop(SCREEN_W / 2, SCREEN_H * 0.35, '+25', C.amber, 15);
          burst3d([it.x, it.y + 0.4, it.z], ['#ffc233', '#fff3b0'], 22, { speed: 5, up: 2, size: 0.16, life: 0.7 });
        }
      }
    }
    s.camY = Math.max(s.camY, p.y - 0.8);
    s.cy += (s.camY - s.cy) * Math.min(1, dt * 6);
    s.maxH = Math.max(s.maxH, p.y);
    s.score = Math.floor(s.maxH);
    s.plats = s.plats.filter(pl => !pl.broken && pl.y > s.camY - 8);
    s.mons = s.mons.filter(m => m.y > s.camY - 8); s.items = s.items.filter(i => i.y > s.camY - 8 && !i.got);
    if (p.y < s.camY - 4.2) die(s);
  });

  const pan = usePan(fx, {
    down: (x, y) => { const s = g.current; s.tx = clamp((x / SCREEN_W - 0.5) * 6.6, -XMAX, XMAX); s.tz = clamp((0.5 - y / SCREEN_H) * 6, -ZMAX, ZMAX); },
    move: (x, y) => { const s = g.current; s.tx = clamp((x / SCREEN_W - 0.5) * 6.6, -XMAX, XMAX); s.tz = clamp((0.5 - y / SCREEN_H) * 6, -ZMAX, ZMAX); },
  });

  const s = g.current; const sc = Math.floor(s.score + s.bonus);
  const moving = Math.abs(s.p.x - s.tx) > 0.25;
  const scene = buildScene(s, s.t, moving);
  const menu = t => buildScene(g.current, t, Math.sin(t * 2) > 0);

  return (
    <Game3D title="SKY HOP" emoji="🦘" accent={C.cyan} onExit={onExit} score={sc} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene} menuScene={menu} orbit={{ c: [0, 2.6, 0], r: 8.5, h: 2.2, speed: 0.2, ly: 1.2, drop: 2.6 }}
      hud={<><HudPill icon="⬆" value={`${Math.floor(s.maxH)} m`} color={C.cyan} />{s.jet > 0 ? <HudPill icon="🚀" value={`${Math.ceil(s.jet)}s`} color={C.orange} /> : null}</>}
      subtitle="Salta sin parar hacia el cielo"
      lines={['Arrastra el dedo: izquierda/derecha y arriba/abajo', 'Rebota en las plataformas · resortes dan más impulso', 'Marrón: se rompe · azul: se mueve', 'Cae sobre los slimes para aplastarlos · 🚀 te propulsa']}
      result={{ isNew: res.isNew, title: 'CAÍSTE', emoji: '🦘', subtitle: `Subiste ${Math.floor(s.maxH)} metros`, stats: [['ALTURA', `${Math.floor(s.maxH)} m`], ['BONUS', s.bonus]] }}>
    </Game3D>
  );
}
