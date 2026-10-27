import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Lives, Overlay, PlayArea, clamp, hx, pick, rand, uid, useBest, useFX, useLoop, usePan, alpha, tglow } from '../utils/kit';
import { World3D } from '../utils/World3D';

// INVASORES 3D: cañón abajo (cerca de la cámara). La formación baja en filas hacia ti (avanza en z).
// Escudos entre el cañón y la formación. Cámara en tercera persona detrás del cañón.
const TW = 7.2, WALL = 3.4;                  // ancho de la pista y límite lateral del cañón/formación
const COLS = 8, ROWS = 5, DX = 0.8, DZ = 0.7; // formación: columnas (x) y filas (z, la última fila es la más cercana)
const PZ = 5.0, SHZ = 2.6, FAR_UFO = -7.0;   // z del cañón, de los escudos y del ovni
const CAM = { p: [0, 4.2, PZ + 9], l: [0, 0.3, -3], fov: 70 };
const STARS = Array.from({ length: 28 }, (_, i) => ({ x: ((i * 37) % 19) / 19 * 16 - 8, y: ((i * 53) % 13) / 13 * 5 + 1.5, z: -13 - (i % 5) * 2 }));

// Proyecta un punto 3D a píxeles del PlayArea con la misma cámara del motor (para efectos 2D).
const sproj = (c, x, y, z) => {
  const [cx, cy, cz] = c.p;
  let fx0 = c.l[0] - cx, fy0 = c.l[1] - cy, fz0 = c.l[2] - cz;
  const fl = Math.hypot(fx0, fy0, fz0); fx0 /= fl; fy0 /= fl; fz0 /= fl;
  let rx = -fz0, rz = fx0; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = -rz * fy0, uy = rz * fx0 - rx * fz0, uz = rx * fy0;
  const dx = x - cx, dy = y - cy, dz = z - cz;
  const zc = dx * fx0 + dy * fy0 + dz * fz0;
  const xc = dx * rx + dz * rz, yc = dx * ux + dy * uy + dz * uz;
  const t = Math.tan(c.fov * Math.PI / 360);
  return [(xc / (zc * t * (AREA_W / AREA_H)) + 1) / 2 * AREA_W, (1 - yc / (zc * t)) / 2 * AREA_H];
};
const pxPerUnit = z => sproj(CAM, 1, 0.2, z)[0] - AREA_W / 2;

// Escudos: 4 bloques de celdas de 0.18 u. Cada celda es un objeto con id estable.
const makeShields = () => {
  const out = [];
  [-2.7, -0.9, 0.9, 2.7].forEach((cx, k) => {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      if (r === 2 && (c === 1 || c === 2 || c === 3)) continue;
      out.push({ id: `sh${k}-${r}-${c}`, x: cx + (c - 2) * 0.18, z: SHZ + r * 0.18, alive: true });
    }
  });
  return out;
};
const makeWave = wave => ({
  aliens: Array.from({ length: ROWS * COLS }, (_, i) => ({ r: Math.floor(i / COLS), c: i % COLS, alive: true })),
  fx: -(COLS - 1) * DX / 2, fz: -6.2 + Math.min(4, wave - 1) * 0.3, dir: 1, stepAcc: 0, shootT: 1.2,
});
const initState = () => ({
  ...makeWave(1), wave: 1, x: 0, tx: 0, bul: [], ab: [], shields: makeShields(), ufo: null, ufoT: 12,
  score: 0, lives: 3, cool: 0, inv: 0, t: 0, banner: { text: 'OLEADA 1', t: 1.4 },
});
const KIND = [{ k: 'sph', c: C.lime }, { k: 'box', c: C.pink }, { k: 'box', c: C.pink }, { k: 'cyl', c: C.violet }, { k: 'cyl', c: C.violet }];
const PTS = [30, 20, 20, 10, 10];

export function Invaders3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('invaders');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const hit = s => {
    if (s.inv > 0) return;
    s.lives -= 1; s.inv = 1.6;
    const [sx, sy] = sproj(CAM, s.x, 0.3, PZ);
    fx.burst(sx, sy, C.red, 20, 240); fx.shake(9, 0.3); fx.flash(C.red, 0.3); hx.bad();
    if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; s.t += dt; s.inv = Math.max(0, s.inv - dt); s.cool -= dt;
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    s.x += (s.tx - s.x) * Math.min(1, dt * 18);
    if (s.cool <= 0) { s.cool = 0.42; s.bul.push({ x: s.x, z: PZ - 0.4, vz: -10 }); hx.tick(); }
    const alive = s.aliens.filter(a => a.alive);
    // movimiento de la formación (lateral; al tocar la pared baja un paso hacia ti)
    const interval = Math.max(0.035, 0.55 * (alive.length / (ROWS * COLS)) - (s.wave - 1) * 0.03);
    s.stepAcc += dt;
    if (s.stepAcc >= interval) {
      s.stepAcc = 0;
      const minC = Math.min(...alive.map(a => a.c)), maxC = Math.max(...alive.map(a => a.c));
      const left = s.fx + minC * DX - 0.25, right = s.fx + maxC * DX + 0.25;
      if ((s.dir > 0 && right + 0.16 > WALL) || (s.dir < 0 && left - 0.16 < -WALL)) { s.dir *= -1; s.fz += 0.35; } else s.fx += 0.16 * s.dir;
    }
    // disparos enemigos desde la columna más cercana al cañón
    s.shootT -= dt;
    if (s.shootT <= 0 && alive.length) {
      s.shootT = Math.max(0.35, 1.1 - s.wave * 0.1) * rand(0.6, 1.2);
      const col = pick([...new Set(alive.map(a => a.c))]);
      const low = alive.filter(a => a.c === col).sort((a, b) => b.r - a.r)[0];
      s.ab.push({ id: uid(), x: s.fx + low.c * DX, z: s.fz + low.r * DZ + 0.3, vz: 3.7 + s.wave * 0.27 });
    }
    // ovni que cruza al fondo
    s.ufoT -= dt;
    if (s.ufoT <= 0 && !s.ufo) { s.ufo = { x: -4.2, vx: 2.1 }; s.ufoT = rand(14, 22); }
    if (s.ufo) { s.ufo.x += s.ufo.vx * dt; if (s.ufo.x > 4.2) s.ufo = null; }
    s.bul.forEach(b => { b.z += b.vz * dt; }); s.ab.forEach(b => { b.z += b.vz * dt; });
    // balas del jugador: alien, ovni o escudo
    s.bul = s.bul.filter(b => {
      if (b.z < FAR_UFO - 0.6) return false;
      for (const a of alive) {
        const ax = s.fx + a.c * DX, az = s.fz + a.r * DZ;
        if (a.alive && Math.abs(b.x - ax) < 0.3 && Math.abs(b.z - az) < 0.3) {
          a.alive = false; const pts = PTS[a.r] * s.wave; s.score += pts;
          const [sx, sy] = sproj(CAM, ax, 0.4, az); fx.burst(sx, sy, C.lime, 10, 200); fx.pop(sx, sy, `+${pts}`, C.text, 13); hx.hit(); return false;
        }
      }
      if (s.ufo && Math.abs(b.x - s.ufo.x) < 0.45 && Math.abs(b.z - FAR_UFO) < 0.5) {
        const pts = pick([50, 100, 150, 300]); s.score += pts; const [sx, sy] = sproj(CAM, s.ufo.x, 0.8, FAR_UFO);
        fx.burst(sx, sy, C.pink, 18, 260); fx.pop(sx, sy - 14, `+${pts}`, C.pink, 18); hx.win(); s.ufo = null; return false;
      }
      for (const sh of s.shields) if (sh.alive && Math.abs(b.x - sh.x) < 0.11 && Math.abs(b.z - sh.z) < 0.11) { sh.alive = false; return false; }
      return true;
    });
    s.ab = s.ab.filter(b => {
      if (b.z > PZ + 0.8) return false;
      for (const sh of s.shields) if (sh.alive && Math.abs(b.x - sh.x) < 0.11 && Math.abs(b.z - sh.z) < 0.11) {
        sh.alive = false; const [sx, sy] = sproj(CAM, sh.x, 0.2, sh.z); fx.burst(sx, sy, C.lime, 3, 80, 0.3, 3); return false;
      }
      if (Math.abs(b.x - s.x) < 0.35 && Math.abs(b.z - PZ) < 0.3) { hit(s); return false; }
      return true;
    });
    // los invasores llegan a los escudos
    if (alive.some(a => s.fz + a.r * DZ + 0.25 > SHZ - 0.3)) { s.lives = 0; hx.die(); fx.shake(10, 0.4); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
    if (!alive.length) {
      const bonus = 100 * s.wave; s.score += bonus; hx.win(); fx.flash('#fff', 0.3); fx.pop(AREA_W / 2, AREA_H / 2, `OLEADA SUPERADA +${bonus}`, C.lime, 20);
      const w = s.wave + 1; Object.assign(s, makeWave(w), { wave: w, bul: [], ab: [], banner: { text: `OLEADA ${w}`, t: 1.4 } });
      if (w % 2 === 1) s.shields = makeShields();
    }
  });

  const setTx = x => { const s = g.current; s.tx = clamp((x - AREA_W / 2) / pxPerUnit(PZ), -WALL, WALL); };
  const pan = usePan(fx, { down: setTx, move: setTx });

  const s = g.current;
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.03 : 0;
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, 0], s: [TW + 2, 20, 1], c: '#06160c' },
    { id: 'linea', k: 'box', p: [0, 0.02, PZ - 0.7], s: [TW, 0.04, 0.05], c: C.lime, e: 0.8, o: 0.5 },
    ...STARS.map((st, i) => ({ id: `st${i}`, k: 'sph', p: [st.x, st.y, st.z], n: 0.07, c: '#ffffff', e: 0.9 })),
    ...s.shields.map(sh => ({ id: sh.id, k: 'box', p: [sh.x, 0.15, sh.z], s: [0.16, 0.3, 0.16], c: C.lime, e: 0.4, o: 0.85 })),
    ...s.aliens.filter(a => a.alive).map(a => {
      const x = s.fx + a.c * DX, z = s.fz + a.r * DZ, kd = KIND[a.r];
      const bob = Math.floor(s.t * 3 + a.c) % 2 ? 0.06 : 0;
      return { id: `al${a.r}-${a.c}`, k: kd.k, p: [x, 0.35 + bob, z], n: kd.k === 'sph' ? 0.5 : undefined, s: kd.k === 'sph' ? undefined : [0.5, 0.42, 0.42], c: kd.c, e: 0.4 };
    }),
    ...(s.ufo ? [{ id: 'ufo', k: 'sph', p: [s.ufo.x, 0.8, FAR_UFO], n: 0.7, c: C.pink, e: 0.6 }] : []),
    { id: 'can-base', k: 'box', p: [s.x, 0.1, PZ], s: [0.9, 0.2, 0.6], c: C.lime, e: 0.3, o: s.inv > 0 && Math.floor(s.t * 14) % 2 ? 0.3 : 1 },
    { id: 'can-torre', k: 'box', p: [s.x, 0.36, PZ], s: [0.5, 0.32, 0.5], c: C.lime, e: 0.5, o: s.inv > 0 && Math.floor(s.t * 14) % 2 ? 0.3 : 1 },
    { id: 'can-canon', k: 'box', p: [s.x, 0.4, PZ - 0.3], s: [0.13, 0.13, 0.45], c: C.lime, e: 0.6, o: s.inv > 0 && Math.floor(s.t * 14) % 2 ? 0.3 : 1 },
    ...s.bul.map((b, i) => ({ id: `pb${i}`, k: 'box', p: [b.x, 0.4, b.z], s: [0.07, 0.07, 0.42], c: C.cyan, e: 1 })),
    ...s.ab.map(b => ({ id: `eb${b.id}`, k: 'box', p: [b.x, 0.4, b.z], s: [0.12, 0.12, 0.36], c: C.pink, e: 1 })),
  ];
  const scene = {
    bg: '#030a06', fog: { c: '#030a06', near: 14, far: 30 }, objs,
    cam: { p: [(Math.random() - 0.5) * shake, CAM.p[1], CAM.p[2]], l: CAM.l, fov: CAM.fov },
  };
  return (
    <GameScreen title="INVASORES" emoji="👽" accent={C.lime} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} icon="🚀" off="💥" /><Text style={{ color: C.dim, fontSize: 12 }}>Oleada <Text style={{ color: C.lime, fontWeight: '900' }}>{s.wave}</Text></Text><Text style={{ color: C.dim, fontSize: 12 }}>Quedan {s.aliens.filter(a => a.alive).length}</Text></>}>
      <PlayArea fx={fx} bg="#030a06" border={alpha(C.lime, 0.35)} {...pan}>
        <World3D scene={scene} />
        {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.45, width: AREA_W, textAlign: 'center', color: C.text, fontSize: 24, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow(C.lime, 12) }}>{s.banner.text}</Text>}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 6, alignItems: 'center' }}>
          <Text style={{ color: alpha(C.dim, 0.8), fontSize: 11, fontWeight: '700' }}>Arrastra para mover · disparo automático</Text>
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji="👽" title={phase === 'over' ? 'INVADIDOS' : 'INVASORES 3D'}
          subtitle={phase === 'over' ? `Llegaste a la oleada ${s.wave}` : 'Defiende la Tierra'}
          score={s.score} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para mover · disparo automático', 'Los escudos verdes te protegen (y se desgastan)', '🛸 pasa de vez en cuando: ¡puntos extra!', 'Si los invasores llegan hasta los escudos, pierdes'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
