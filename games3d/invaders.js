import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, Lives, SCREEN_H, SCREEN_W, alpha, clamp, hx, pick, rand, uid, useBest, useFX, useLoop, usePan, tglow } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { enemy } from '../utils/prefabs';

// INVASORES 3D – cañón abajo, cerca de la cámara. La formación baja en filas hacia ti (avanza en z).
// Escudos verdes entre el cañón y la formación. Arrastra para mover el cañón (disparo automático).
// Récord: 'invaders'. Si los invasores llegan hasta los escudos, pierdes.
const TW = 7.2, WALL = 3.4;                   // ancho de la pista y límite lateral del cañón/formación
const COLS = 8, ROWS = 5, DX = 0.8, DZ = 0.7; // formación: columnas (x) y filas (z; la última fila es la más cercana)
const PZ = 5.0, SHZ = 2.6, FAR_UFO = -7.0;    // z del cañón, de los escudos y del ovni
const CAM = { p: [0, 4.2, PZ + 9], l: [0, 0.3, -3], fov: 70 };
// Cada fila es un prefab distinto (de la más lejana a la más cercana); n = escala, y = altura de los pies/centro
const ROW = [
  { kind: 'ovni', c: '#b6ff5c', n: 0.32, y: 0.5, yaw: 0 },
  { kind: 'robot', c: '#ff4dd2', n: 0.46, y: 0, yaw: Math.PI },
  { kind: 'robot', c: '#ff4dd2', n: 0.46, y: 0, yaw: Math.PI },
  { kind: 'slime', c: '#b57bff', n: 0.5, y: 0, yaw: Math.PI },
  { kind: 'slime', c: '#b57bff', n: 0.5, y: 0, yaw: Math.PI },
];
const PTS = [30, 20, 20, 10, 10];
const STARS = Array.from({ length: 28 }, (_, i) => ({ x: ((i * 37) % 19) / 19 * 16 - 8, y: ((i * 53) % 13) / 13 * 5 + 1.5, z: -13 - (i % 5) * 2 }));

// Proyecta un punto 3D a píxeles de la pantalla completa con la misma cámara del motor (para efectos 2D)
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
  return [(xc / (zc * t * (SCREEN_W / SCREEN_H)) + 1) / 2 * SCREEN_W, (1 - yc / (zc * t)) / 2 * SCREEN_H];
};
const pxPerUnit = z => sproj(CAM, 1, 0.2, z)[0] - SCREEN_W / 2;

// Escudos: 4 bloques de celdas de 0.18 u. Cada celda es un objeto (se dibuja con instancing)
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
  ...makeWave(1), wave: 1, x: 0, tx: 0, cx: 0, bul: [], ab: [], shields: makeShields(), ufo: null, ufoT: 12,
  score: 0, kills: 0, lives: 3, cool: 0, inv: 0, t: 0, banner: { text: 'OLEADA 1', t: 1.4 }, over: false,
});

// Decorado FIJO: suelo, línea de defensa y estrellas (se calculan una vez)
const INV_STATIC = [
  { id: 'inv-suelo', k: 'pla', p: [0, 0, 0], s: [TW + 4, 24, 1], c: '#06160c', recv: true, m: { r: 0.95, m: 0 } },
  { id: 'inv-linea', k: 'box', p: [0, 0.03, PZ - 0.7], s: [TW, 0.05, 0.06], c: C.lime, e: 0.9, o: 0.6 },
  ...STARS.map(st => ({ k: 'sph', inst: 'inv-estrella', p: [st.x, st.y, st.z], n: 0.07, c: '#ffffff', e: 1 })),
  ...Array.from({ length: 12 }, (_, i) => ({ k: 'box', inst: 'inv-rejilla', p: [0, 0.01, -8 + i * 2.2], s: [TW + 4, 0.02, 0.03], c: C.lime, e: 0.6, o: 0.4 })),
];

export function Invaders3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('invaders');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false, wave: 1, kills: 0 });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };

  const finish = s => {
    if (s.over) return;
    s.over = true; s.lives = Math.max(0, s.lives);
    burst3d([s.x, 0.4, PZ], [C.red, C.amber, '#ffffff'], 40, { speed: 9, size: 0.26, life: 1, g: 3 });
    fx.shake(10, 0.4); hx.die();
    setRes({ isNew: submitBest(s.score), wave: s.wave, kills: s.kills });
    setPhase('over');
  };

  const hit = s => {
    if (s.inv > 0 || s.over) return;
    s.lives -= 1; s.inv = 1.6;
    burst3d([s.x, 0.4, PZ], [C.red, C.amber], 30, { speed: 8, size: 0.24, life: 0.9, g: 3 });
    ring3d([s.x, 0.1, PZ], C.red, 24, { speed: 6, life: 0.6 });
    fx.shake(9, 0.3); fx.flash(C.red, 0.3); hx.bad();
    if (s.lives <= 0) finish(s);
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (phase !== 'play' || s.over) return;
    s.t += dt; s.inv = Math.max(0, s.inv - dt); s.cool -= dt;
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    s.x += (s.tx - s.x) * Math.min(1, dt * 18);
    if (s.cool <= 0) { s.cool = 0.42; s.bul.push({ x: s.x, z: PZ - 0.4, vz: -10 }); }
    const alive = s.aliens.filter(a => a.alive);
    // movimiento de la formación (lateral; al tocar la pared baja un paso hacia ti)
    const interval = Math.max(0.035, 0.55 * (alive.length / (ROWS * COLS)) - (s.wave - 1) * 0.03);
    s.stepAcc += dt;
    if (s.stepAcc >= interval && alive.length) {
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
    s.bul.forEach(b => { b.z += b.vz * dt; });
    s.ab.forEach(b => { b.z += b.vz * dt; });

    // balas del jugador: alien, ovni o escudo
    s.bul = s.bul.filter(b => {
      if (b.z < FAR_UFO - 0.6) return false;
      for (const a of alive) {
        const ax = s.fx + a.c * DX, az = s.fz + a.r * DZ;
        if (a.alive && Math.abs(b.x - ax) < 0.3 && Math.abs(b.z - az) < 0.3) {
          a.alive = false; s.kills += 1; const pts = PTS[a.r] * s.wave; s.score += pts;
          burst3d([ax, 0.4, az], ROW[a.r].c, 18, { speed: 7, size: 0.2, life: 0.8, g: 2 });
          const [sx, sy] = sproj(CAM, ax, 0.4, az); fx.pop(sx, sy, `+${pts}`, C.text, 13); hx.hit();
          return false;
        }
      }
      if (s.ufo && Math.abs(b.x - s.ufo.x) < 0.45 && Math.abs(b.z - FAR_UFO) < 0.5) {
        const pts = pick([50, 100, 150, 300]); s.score += pts; s.kills += 1;
        burst3d([s.ufo.x, 0.8, FAR_UFO], [C.pink, '#ffffff', C.amber], 40, { speed: 10, size: 0.26, life: 1, g: 2 });
        ring3d([s.ufo.x, 0.8, FAR_UFO], C.pink, 30, { speed: 8, life: 0.8 });
        const [sx, sy] = sproj(CAM, s.ufo.x, 0.8, FAR_UFO); fx.pop(sx, sy - 14, `+${pts}`, C.pink, 18);
        hx.win(); s.ufo = null; return false;
      }
      for (const sh of s.shields) if (sh.alive && Math.abs(b.x - sh.x) < 0.11 && Math.abs(b.z - sh.z) < 0.11) { sh.alive = false; return false; }
      return true;
    });
    s.ab = s.ab.filter(b => {
      if (b.z > PZ + 0.8) return false;
      for (const sh of s.shields) if (sh.alive && Math.abs(b.x - sh.x) < 0.11 && Math.abs(b.z - sh.z) < 0.11) {
        sh.alive = false; burst3d([sh.x, 0.2, sh.z], C.lime, 4, { speed: 2, size: 0.1, life: 0.3, g: 3 }); return false;
      }
      if (Math.abs(b.x - s.x) < 0.35 && Math.abs(b.z - PZ) < 0.3) { hit(s); return false; }
      return true;
    });
    if (s.over) return;

    // los invasores llegan a los escudos: fin de la partida
    if (alive.some(a => s.fz + a.r * DZ + 0.25 > SHZ - 0.3)) { s.lives = 0; finish(s); return; }
    if (!alive.length) {
      const bonus = 100 * s.wave; s.score += bonus; hx.win(); fx.flash('#ffffff', 0.3);
      fx.pop(SCREEN_W / 2, SCREEN_H / 2, `OLEADA SUPERADA +${bonus}`, C.lime, 20);
      const w = s.wave + 1;
      Object.assign(s, makeWave(w), { wave: w, bul: [], ab: [], banner: { text: `OLEADA ${w}`, t: 1.4 } });
      if (w % 2 === 1) s.shields = makeShields();
    }
  });

  const setTx = x => { const s = g.current; s.tx = clamp((x - SCREEN_W / 2) / pxPerUnit(PZ), -WALL, WALL); };
  const pan = usePan(fx, { down: setTx, move: setTx });

  const s = g.current;
  const alienObjs = s.aliens.filter(a => a.alive).flatMap(a => {
    const R = ROW[a.r];
    const bob = Math.floor(s.t * 3 + a.c) % 2 ? 0.05 : 0;
    return enemy(`al${a.r}-${a.c}`, R.kind, [s.fx + a.c * DX, R.y + bob, s.fz + a.r * DZ], { c: R.c, n: R.n, yaw: R.yaw, t: s.t, walk: 0.5, sh: false, inst: `inv-${R.kind}` });
  });
  const blinkO = s.inv > 0 && Math.floor(s.t * 14) % 2 ? 0.3 : 1;
  const scene = {
    sky: { top: '#030a06', bottom: '#0a2014', sun: false, clouds: 0 },
    fog: { c: '#0a2014', near: 14, far: 34 },
    light: { dir: [-0.3, 0.9, 0.3], sun: '#eafff0', i: 2.2, sky: '#b8ffd0', ground: '#0a2014', hi: 1.3 },
    statics: INV_STATIC,
    objs: [
      ...s.shields.filter(sh => sh.alive).map(sh => ({ k: 'box', inst: 'inv-escudo', p: [sh.x, 0.15, sh.z], s: [0.16, 0.3, 0.16], c: C.lime, e: 0.7 })),
      ...alienObjs,
      ...(s.ufo ? enemy('inv-ufo', 'ovni', [s.ufo.x, 0.9, FAR_UFO], { c: C.pink, n: 0.7, t: s.t, sh: false }) : []),
      // cañón: base, torreta y boca con destello
      { id: 'can-base', k: 'cyl', p: [s.x, 0.1, PZ], s: [0.9, 0.2, 0.9], c: '#2be36b', e: 0.3, o: blinkO },
      { id: 'can-torre', k: 'box', p: [s.x, 0.36, PZ], s: [0.5, 0.32, 0.5], c: C.lime, e: 0.5, o: blinkO },
      { id: 'can-canon', k: 'box', p: [s.x, 0.4, PZ - 0.32], s: [0.13, 0.13, 0.5], c: C.lime, e: 0.6, o: blinkO },
      { id: 'can-boca', k: 'sph', p: [s.x, 0.4, PZ - 0.6], n: 0.14, c: C.cyan, e: 1, o: blinkO },
      ...s.bul.map(b => ({ k: 'box', inst: 'inv-bala', p: [b.x, 0.4, b.z], s: [0.07, 0.07, 0.42], c: C.cyan, e: 1 })),
      ...s.ab.map(b => ({ k: 'box', inst: 'inv-ebala', p: [b.x, 0.4, b.z], s: [0.12, 0.12, 0.36], c: C.pink, e: 1 })),
    ],
    cam: { p: [CAM.p[0], CAM.p[1], CAM.p[2]], l: CAM.l, fov: CAM.fov },
  };
  return (
    <Game3D title="INVASORES" emoji="👽" accent={C.lime} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene} menuScene={t => ({ ...scene, cam: { p: [Math.sin(t * 0.2) * 3, 4.2, PZ + 9], l: CAM.l, fov: CAM.fov } })}
      orbit={{ c: [0, 0.6, 0], r: 10, h: 4, speed: 0.18, ly: 1.2 }} pan={pan}
      hud={<><Lives n={s.lives} max={3} icon="🚀" off="💥" /><HudPill label="OLEADA" value={s.wave} color={C.lime} /><HudPill label="QUEDAN" value={s.aliens.filter(a => a.alive).length} color={C.dim} /></>}
      subtitle="Defiende la Tierra con escudos y un cañón"
      lines={['Arrastra para mover el cañón · disparo automático', 'Los escudos verdes te protegen (y se desgastan)', '🛸 pasa de vez en cuando: ¡puntos extra!', 'Si los invasores llegan hasta los escudos, pierdes']}
      result={{ won: false, isNew: res.isNew, title: 'INVADIDOS', emoji: '👽', subtitle: `Llegaste a la oleada ${res.wave}`, stats: [['OLEADA', res.wave], ['ABATIDOS', res.kills]] }}>
      {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: SCREEN_H * 0.42, left: 0, right: 0, textAlign: 'center', color: C.text, fontSize: 24, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow(C.lime, 12) }}>{s.banner.text}</Text>}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 8, alignItems: 'center' }}>
        <Text style={{ color: alpha(C.dim, 0.8), fontSize: 11, fontWeight: '700' }}>Arrastra para mover · disparo automático</Text>
      </View>
    </Game3D>
  );
}
