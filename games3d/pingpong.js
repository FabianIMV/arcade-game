import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { C, SCREEN_H, SCREEN_W, clamp, hx, rand, tglow, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { Game3D, HudPill } from '../utils/ui3d';
import { project } from '../utils/openworld';

// PING PONG 3D · mesa con proporciones reales (ancho 1,525 m : largo 2,74 m), red con postes y bordes blancos.
// Tu paleta está en primer plano y la cámara va detrás de ella; la IA juega al fondo.
// Arrastra para mover tu paleta. La bola ampliada rebota sobre la mesa y deja un rastro azul.
const TW = 5.8, HL = 5.4, PZ = 5.0, AZ = -5.0;   // ancho de la mesa, semilongitud, z de tu paleta y de la IA
const PW0 = 1.0, PD = 0.3, BR = 0.13;            // diámetro de la paleta, grosor, radio de la bola
const WIN = 7, SP0 = 5.6, SPMAX = 12.5;          // partido a 7; velocidades en unidades/s
const FOLLOW = 0.25;                              // la cámara sigue un 25 % de tu paleta
const NET_H = 0.58;                               // altura de la red (15,25 cm escalados)
const REF = { p: [0, 2.9, PZ + 10], l: [0, 0.3, -2.5], fov: 68 };
// píxeles por unidad de x a la profundidad de la paleta (con la cámara de referencia): para mapear el dedo
const PPU = project(REF, [1, 0.45, PZ], SCREEN_W, SCREEN_H).x - project(REF, [0, 0.45, PZ], SCREEN_W, SCREEN_H).x;
const xFromTouch = sx => (sx - SCREEN_W / 2) / (PPU * (1 - FOLLOW));
const lerpV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Decorado fijo: mesa, red, patas, sala con neón. Se calcula una sola vez.
const TABLE = [
  { id: 'suelo', k: 'pla', p: [0, -2.9, 0], s: [70, 70, 1], c: '#080a16', recv: true, m: { r: 0.9, m: 0 } },
  { id: 'mesa', k: 'box', p: [0, -0.12, 0], s: [TW, 0.24, HL * 2], c: '#1f5fbf', recv: true, m: { r: 0.4, m: 0.05 } },
  { id: 'l-iz', k: 'box', p: [-TW / 2 + 0.06, 0.012, 0], s: [0.07, 0.02, HL * 2], c: '#ffffff', e: 0.35 },
  { id: 'l-de', k: 'box', p: [TW / 2 - 0.06, 0.012, 0], s: [0.07, 0.02, HL * 2], c: '#ffffff', e: 0.35 },
  { id: 'l-fo', k: 'box', p: [0, 0.012, HL - 0.06], s: [TW, 0.02, 0.07], c: '#ffffff', e: 0.35 },
  { id: 'l-fa', k: 'box', p: [0, 0.012, -HL + 0.06], s: [TW, 0.02, 0.07], c: '#ffffff', e: 0.35 },
  { id: 'l-ce', k: 'box', p: [0, 0.012, 0], s: [0.05, 0.02, HL * 2], c: '#ffffff', e: 0.35 },
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => ({ id: `pata${i}`, k: 'cyl', p: [sx * (TW / 2 - 0.45), -1.52, sz * (HL - 0.5)], s: [0.22, 2.6, 0.22], c: '#2b2f42', sh: true, m: { r: 0.4, m: 0.6 } })),
  { id: 'red-cuerpo', k: 'box', p: [0, NET_H / 2, 0], s: [TW + 1.0, NET_H, 0.03], c: '#ffffff', o: 0.42, e: 0.25 },
  { id: 'red-cinta', k: 'box', p: [0, NET_H + 0.02, 0], s: [TW + 1.0, 0.04, 0.06], c: '#ffffff', e: 0.7 },
  { id: 'poste-i', k: 'cyl', p: [-(TW / 2 + 0.5), NET_H / 2 + 0.02, 0], s: [0.12, NET_H + 0.04, 0.12], c: '#e8e8f0', sh: true, m: { r: 0.3, m: 0.8 } },
  { id: 'poste-d', k: 'cyl', p: [TW / 2 + 0.5, NET_H / 2 + 0.02, 0], s: [0.12, NET_H + 0.04, 0.12], c: '#e8e8f0', sh: true, m: { r: 0.3, m: 0.8 } },
  { id: 'fondo-sala', k: 'box', p: [0, 2.5, -13], s: [46, 10, 0.4], c: '#0c1230', e: 0.05 },
  { id: 'neon-alto', k: 'box', p: [0, 5.2, -12.7], s: [46, 0.08, 0.1], c: '#ff3df2', e: 1 },
  { id: 'neon-bajo', k: 'box', p: [0, -2.2, -12.7], s: [46, 0.08, 0.1], c: '#22e6ff', e: 1 },
];

const initState = () => ({
  px: 0, ax: 0, pvel: 0, lastPx: 0, ball: { x: 0, z: 0, vx: 0, vz: 0 }, speed: SP0,
  me: 0, ai: 0, level: 1, total: 0, serve: 1, wait: 1.0, rally: 0, trail: [], t: 0, aiErr: 0, bph: 0,
  banner: { text: 'PARTIDO 1', t: 1.3 }, cp: null, cl: null, dead: false,
});

// Escena: tu paleta (roja, con mango), la de la IA (azul), la bola y su rastro, y luces de neón.
function buildScene(s) {
  const b = s.ball;
  const by = s.wait > 0 ? BR : BR + 0.3 * Math.abs(Math.sin(s.bph));   // pequeño bote sobre la mesa
  const cam = s.cp ? { p: s.cp, l: s.cl, fov: REF.fov } : { p: REF.p, l: REF.l, fov: REF.fov };
  const objs = [
    { id: 'yo-cara', k: 'cyl', p: [s.px, 0.45, PZ + 0.04], r: [Math.PI / 2, 0, 0], s: [PW0, 0.06, PW0], c: '#e53935', e: 0.15, sh: true, m: { r: 0.5, m: 0 } },
    { id: 'yo-dorso', k: 'cyl', p: [s.px, 0.45, PZ - 0.04], r: [Math.PI / 2, 0, 0], s: [PW0 * 0.94, 0.05, PW0 * 0.94], c: '#15151d', sh: true, m: { r: 0.6, m: 0 } },
    { id: 'yo-mango', k: 'cyl', p: [s.px, 0.1, PZ + 0.42], r: [Math.PI / 2, 0, 0], s: [0.2, 0.6, 0.2], c: '#8a5a33', sh: true, m: { r: 0.7, m: 0 } },
    { id: 'ia-cara', k: 'cyl', p: [s.ax, 0.45, AZ], r: [Math.PI / 2, 0, 0], s: [PW0, 0.07, PW0], c: '#4d8bff', e: 0.25, sh: true, m: { r: 0.5, m: 0 } },
    { id: 'ia-dorso', k: 'cyl', p: [s.ax, 0.45, AZ - 0.05], r: [Math.PI / 2, 0, 0], s: [PW0 * 0.92, 0.05, PW0 * 0.92], c: '#15151d', sh: true, m: { r: 0.6, m: 0 } },
    { id: 'ia-mango', k: 'cyl', p: [s.ax, 0.1, AZ - 0.42], r: [Math.PI / 2, 0, 0], s: [0.2, 0.6, 0.2], c: '#8a5a33', sh: true, m: { r: 0.7, m: 0 } },
  ];
  s.trail.forEach((p, i) => objs.push({ id: `tr${i}`, k: 'sph', p: [p.x, BR, p.z], n: BR * 1.1, c: '#7fe9ff', e: 0.9, o: Math.max(0, p.a * 0.5) }));
  objs.push({ id: 'bola', k: 'sph', p: [b.x, by, b.z], n: BR * 2, c: '#ffffff', e: 0.9, sh: true });
  return {
    sky: { top: '#060818', bottom: '#1b2650', sun: false, clouds: 0 },
    fog: { c: '#1b2650', near: 16, far: 40 },
    light: { dir: [-0.4, 1, 0.5], sun: '#fff1dc', i: 2.2, sky: '#a9bcff', ground: '#1a1f3a', hi: 1.2 },
    shadowR: 12, statics: TABLE, objs,
    lights: [{ p: [b.x, 1.6, b.z], c: '#7fe9ff', i: 5, d: 6 }, { p: [0, 3.2, AZ - 1], c: '#ff5ad8', i: 6, d: 9 }],
    cam,
  };
}

export function PingPong3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('pingpong');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const serveBall = s => {
    s.speed = SP0 + (s.level - 1) * 0.27; s.rally = 0;
    const a = rand(-0.5, 0.5);
    s.ball = { x: 0, z: 0, vx: Math.sin(a) * s.speed, vz: Math.cos(a) * s.speed * s.serve };
    s.wait = 0; s.trail = [];
  };
  const gameOver = s => {
    s.dead = true; hx.die(); setRes({ isNew: submitBest(s.total) }); setPhase('over');
  };
  const score = (s, who) => {
    s.wait = 0.9; s.ball.vx = 0; s.ball.vz = 0;
    const zz = who === 'me' ? AZ : PZ;
    if (who === 'me') {
      s.me += 1; s.total += 1; s.serve = -1;
      fx.pop(SCREEN_W / 2, SCREEN_H * 0.42, '¡PUNTO!', C.lime, 24); hx.good();
      burst3d([s.ball.x, 0.2, zz], ['#7dff6b', '#ffffff'], 36, { speed: 4.5, up: 3, g: 10, size: 0.1, life: 0.9 });
      ring3d([s.ball.x, 0.04, zz], C.lime, 24, { speed: 5, life: 0.6, size: 0.09 });
    } else {
      s.ai += 1; s.serve = 1;
      fx.shake(7, 0.3); fx.flash(C.red, 0.2); hx.bad();
      burst3d([s.ball.x, 0.2, zz], ['#ff4d6d', '#ffd0d8'], 36, { speed: 4.5, up: 3, g: 10, size: 0.1, life: 0.9 });
      ring3d([s.ball.x, 0.04, zz], C.red, 24, { speed: 5, life: 0.6, size: 0.09 });
    }
    s.ball.x = 0; s.ball.z = 0;
    if (s.me >= WIN) {
      s.level += 1; s.me = 0; s.ai = 0; s.wait = 1.4; s.total += 3;
      s.banner = { text: `PARTIDO GANADO · NIVEL ${s.level}`, t: 1.6 }; fx.flash('#ffffff', 0.25); hx.win();
      fx.pop(SCREEN_W / 2, SCREEN_H / 2, '+3', C.amber, 24);
    } else if (s.ai >= WIN) {
      gameOver(s);
    }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.dead) return;
    s.t += dt;
    s.pvel = (s.px - s.lastPx) / dt; s.lastPx = s.px;
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    // cámara detrás de tu paleta: se desliza suave siguiendo una parte de su posición
    const tp = [FOLLOW * s.px, 2.9, PZ + 10], tl = [FOLLOW * s.px, 0.3, -2.5], cf = Math.min(1, dt * 5);
    s.cp = s.cp ? lerpV(s.cp, tp, cf) : tp; s.cl = s.cl ? lerpV(s.cl, tl, cf) : tl;
    const b = s.ball;
    // IA: sigue la bola con un pequeño error que cambia en cada golpe
    const aiSpeed = 2.5 + s.level * 0.74;
    const target = b.vz < 0 ? b.x + s.aiErr : 0;
    s.ax += clamp(target - s.ax, -aiSpeed * dt, aiSpeed * dt);
    s.ax = clamp(s.ax, -TW / 2 + 0.8, TW / 2 - 0.8);
    if (s.wait > 0) { s.wait -= dt; if (s.wait <= 0) serveBall(s); return; }

    b.x += b.vx * dt; b.z += b.vz * dt;
    s.bph += dt * (4 + s.speed * 0.6);
    s.trail.push({ x: b.x, z: b.z, a: 0.5 }); s.trail.forEach(p => { p.a -= dt * 2.5; }); s.trail = s.trail.filter(p => p.a > 0);
    const HW = TW / 2 - BR;
    if (b.x < -HW) { b.x = -HW; b.vx = Math.abs(b.vx); hx.tick(); }
    if (b.x > HW) { b.x = HW; b.vx = -Math.abs(b.vx); hx.tick(); }
    // tu paleta (la bola viene hacia la cámara: vz > 0)
    if (b.vz > 0 && b.z + BR >= PZ - PD / 2 && b.z - BR <= PZ + PD / 2 + 0.6 && Math.abs(b.x - s.px) < PW0 / 2 + BR) {
      const rel = clamp((b.x - s.px) / (PW0 / 2 + BR), -1, 1);
      s.rally += 1;
      let sp = Math.min(SPMAX, s.speed + 0.3);
      if (Math.abs(s.pvel) > 10) {
        sp = Math.min(SPMAX + 0.8, sp * 1.22);
        fx.pop(SCREEN_W / 2, SCREEN_H * 0.5, 'SMASH', C.amber, 22); fx.shake(4); hx.heavy();
        ring3d([b.x, 0.1, PZ], C.amber, 26, { speed: 4, life: 0.5, size: 0.08 });
      } else hx.hit();
      s.speed = sp;
      const a = rel * 1.0 + clamp(s.pvel / 60, -0.3, 0.3);
      b.vx = Math.sin(a) * sp; b.vz = -Math.cos(a) * sp; b.z = PZ - PD / 2 - BR;
      s.aiErr = rand(-1, 1) * Math.max(0.16, 1.37 - s.level * 0.16);
      burst3d([b.x, BR, PZ], ['#22e6ff', '#ffffff'], 14, { speed: 3, life: 0.45, size: 0.07, g: 6, up: 0.6 });
    }
    // paleta de la IA (la bola va hacia el fondo: vz < 0)
    if (b.vz < 0 && b.z - BR <= AZ + PD / 2 && b.z + BR >= AZ - PD / 2 - 0.6 && Math.abs(b.x - s.ax) < PW0 / 2 + BR) {
      const rel = clamp((b.x - s.ax) / (PW0 / 2 + BR), -1, 1);
      const sp = Math.min(SPMAX, s.speed + 0.2); s.speed = sp;
      const a = rel * 0.95;
      b.vx = Math.sin(a) * sp; b.vz = Math.cos(a) * sp; b.z = AZ + PD / 2 + BR;
      burst3d([b.x, BR, AZ], ['#4d8bff', '#ffffff'], 12, { speed: 3, life: 0.4, size: 0.07, g: 6, up: 0.6 }); hx.tick();
    }
    if (b.z > PZ + 1.2) score(s, 'ai');
    else if (b.z < AZ - 1.2) score(s, 'me');
  });

  const setPx = x => { const s = g.current; s.px = clamp(xFromTouch(x), -TW / 2 + PW0 / 2, TW / 2 - PW0 / 2); };
  const pan = usePan(fx, { down: setPx, move: setPx });

  const s = g.current;
  const scene = buildScene(s);
  const cam = s.cp ? { p: s.cp, l: s.cl, fov: REF.fov } : REF;
  const tagAI = project(cam, [s.ax, 1.2, AZ], SCREEN_W, SCREEN_H);
  const tagMe = project(cam, [s.px, 1.2, PZ], SCREEN_W, SCREEN_H);
  return (
    <Game3D title="PING PONG" emoji="🏓" accent={C.blue} onExit={onExit} score={s.total} best={best} scoreLabel="PUNTOS" fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene} orbit={{ r: 14, h: 4.5, speed: 0.18, ly: 0.2, drop: 1.6 }}
      hud={<>
        <HudPill icon="🤖" label="IA" value={`NIVEL ${s.level}`} color={C.pink} />
        <HudPill label="MARCADOR" value={`${s.me} - ${s.ai}`} color={C.cyan} />
        <HudPill icon="🔥" label="RACHA" value={s.rally} color={C.amber} />
      </>}
      subtitle="Duelo contra una IA que mejora cada partido"
      lines={['Arrastra para mover tu paleta roja', 'Pega con el borde para desviar la bola', 'Mueve la paleta rápido al golpear: ¡SMASH!', 'Ganar un partido da +3 y sube la dificultad']}
      result={{ title: 'PARTIDO PERDIDO', emoji: '🏓', subtitle: `Llegaste al nivel ${s.level} de IA`, isNew: res.isNew, stats: [['NIVEL IA', s.level], ['MARCADOR', `${s.me} - ${s.ai}`]] }}>
      {tagAI && <Text pointerEvents="none" style={{ position: 'absolute', left: tagAI.x - 20, top: tagAI.y - 26, width: 40, textAlign: 'center', color: '#8fb4ff', fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>IA</Text>}
      {tagMe && <Text pointerEvents="none" style={{ position: 'absolute', left: tagMe.x - 20, top: tagMe.y + 34, width: 40, textAlign: 'center', color: '#ff8a8a', fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>TÚ</Text>}
      {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: SCREEN_H * 0.3, left: 0, right: 0, textAlign: 'center', color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: 2, opacity: Math.min(1, s.banner.t), ...tglow(C.blue, 12) }}>{s.banner.text}</Text>}
    </Game3D>
  );
}
