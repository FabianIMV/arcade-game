import React, { useRef } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Lives, Combo, Overlay, PlayArea, clamp, hx, pick, rand, uid, useBest, useFX, useLoop, usePan, alpha, tglow } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Mundo: pista de 12 × 14 unidades. La cámara va detrás de la pala (tercera persona) y mira hacia el fondo.
const CW = 12, CX = 6, FAR = -10, NEAR = 4, PAD_Z = 3.2, BR = 0.26;
const COLS = 8, BW = (CW - 0.6) / COLS - 0.12, BD = 0.55;
const HUES = [350, 25, 48, 130, 190, 260];
const IC = { W: C.cyan, M: C.pink, F: C.orange, L: C.red, S: C.violet };

const makeBricks = level => {
  const rows = Math.min(6, 3 + Math.floor(level / 2));
  const pat = level % 4;
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) {
    let hp = 1;
    if (pat === 1 && (r + c) % 2) continue;
    if (pat === 3 && c % 3 === 1) continue;
    if (level >= 2 && r === 0) hp = 2;
    if (level >= 4 && r < 2) hp = 3;
    out.push({ id: uid(), x: -CX + 0.3 + BW / 2 + c * (BW + 0.12), z: -8.6 + r * (BD + 0.22), hp, max: hp, hue: HUES[r % HUES.length] });
  }
  return out;
};

const initState = () => ({
  px: 0, pw: 2.2, balls: [{ x: 0, z: PAD_Z - 0.5, vx: 0, vz: 0, stuck: true }], bricks: makeBricks(1), items: [],
  lives: 3, level: 1, score: 0, combo: 0, wide: 0, fire: 0, slow: 0, t: 0, banner: { text: 'NIVEL 1', t: 1.4 },
});

export function Breakout3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('breakout');
  const [phase, setPhase] = React.useState('ready');
  const [res, setRes] = React.useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const speedOf = s => (7 + s.level * 0.5) * (s.slow > 0 ? 0.7 : 1);
  const launch = s => {
    s.balls.forEach(b => { if (b.stuck) { b.stuck = false; const a = rand(-0.3, 0.3); const sp = speedOf(s); b.vx = Math.sin(a) * sp; b.vz = -Math.cos(a) * sp; } });
    hx.tap();
  };
  const loseLife = s => {
    s.lives -= 1; s.combo = 0; s.wide = 0; s.fire = 0;
    fx.shake(8, 0.3); fx.flash(C.red, 0.3); hx.bad();
    if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
    s.balls = [{ x: s.px, z: PAD_Z - 0.5, vx: 0, vz: 0, stuck: true }];
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    ['wide', 'fire', 'slow'].forEach(k => { if (s[k] > 0) s[k] = Math.max(0, s[k] - dt); });
    s.pw += ((s.wide > 0 ? 3.4 : 2.2) - s.pw) * Math.min(1, dt * 10);
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    const sp = speedOf(s);
    for (let bi = s.balls.length - 1; bi >= 0; bi--) {
      const b = s.balls[bi];
      if (b.stuck) { b.x = s.px; b.z = PAD_Z - 0.5; continue; }
      const m = Math.hypot(b.vx, b.vz) || 1;
      b.vx *= sp / m; b.vz *= sp / m;
      b.x += b.vx * dt; b.z += b.vz * dt;
      if (Math.abs(b.x) > CX - BR) { b.x = Math.sign(b.x) * (CX - BR); b.vx = -b.vx; }
      if (b.z < FAR + BR) { b.z = FAR + BR; b.vz = Math.abs(b.vz); }
      // pala: la pelota viene hacia la cámara (vz > 0)
      if (b.vz > 0 && b.z + BR >= PAD_Z && b.z - BR <= PAD_Z + 0.5 && Math.abs(b.x - s.px) < s.pw / 2 + BR) {
        const rel = clamp((b.x - s.px) / (s.pw / 2), -1, 1);
        const a = rel * 1.0;
        b.vx = Math.sin(a) * sp; b.vz = -Math.cos(a) * sp; b.z = PAD_Z - BR;
        s.combo = 0; hx.tap();
      }
      // ladrillos (caja en el plano x-z)
      for (let i = s.bricks.length - 1; i >= 0; i--) {
        const k = s.bricks[i];
        if (b.x + BR < k.x - BW / 2 || b.x - BR > k.x + BW / 2 || b.z + BR < k.z - BD / 2 || b.z - BR > k.z + BD / 2) continue;
        if (s.fire <= 0) {
          const ox = Math.min(b.x + BR - (k.x - BW / 2), k.x + BW / 2 - (b.x - BR));
          const oz = Math.min(b.z + BR - (k.z - BD / 2), k.z + BD / 2 - (b.z - BR));
          if (ox < oz) b.vx = (b.x < k.x ? -1 : 1) * Math.abs(b.vx); else b.vz = (b.z < k.z ? -1 : 1) * Math.abs(b.vz);
        }
        k.hp -= s.fire > 0 ? 3 : 1;
        if (k.hp <= 0) {
          s.bricks.splice(i, 1); s.combo += 1;
          const pts = 10 * s.level + s.combo * 2;
          s.score += pts;
          fx.burst(AREA_W / 2, 200, `hsl(${k.hue},90%,60%)`, 10, 170, 0.5, 4); hx.hit();
          if (Math.random() < 0.2) s.items.push({ id: uid(), x: k.x, z: k.z, k: pick(['W', 'M', 'F', 'L', 'S']) });
        } else hx.tick();
        if (s.fire <= 0) break;
      }
      if (b.z > PAD_Z + 1.5) s.balls.splice(bi, 1);
    }
    if (!s.balls.length) { loseLife(s); return; }
    s.items.forEach(it => { it.z += 2.4 * dt; });
    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i];
      if (it.z > PAD_Z - 0.4 && it.z < PAD_Z + 0.6 && Math.abs(it.x - s.px) < s.pw / 2 + 0.3) {
        s.items.splice(i, 1); hx.good();
        if (it.k === 'W') s.wide = 10;
        if (it.k === 'F') s.fire = 8;
        if (it.k === 'L') s.lives = Math.min(5, s.lives + 1);
        if (it.k === 'S') s.slow = 9;
        if (it.k === 'M') {
          const b0 = s.balls[0];
          [-0.5, 0.5].forEach(d => { const a = Math.atan2(b0.vx, -b0.vz) + d; s.balls.push({ x: b0.x, z: b0.z, vx: Math.sin(a) * sp, vz: -Math.cos(a) * sp, stuck: b0.stuck }); });
        }
      } else if (it.z > PAD_Z + 2) s.items.splice(i, 1);
    }
    if (!s.bricks.length) {
      s.score += 100 * s.level; hx.win(); fx.flash('#fff', 0.3);
      s.level += 1; s.bricks = makeBricks(s.level); s.items = []; s.balls = [{ x: s.px, z: PAD_Z - 0.5, vx: 0, vz: 0, stuck: true }];
      s.banner = { text: `NIVEL ${s.level}`, t: 1.4 };
    }
  });

  const pan = usePan(fx, {
    down: x => { const s = g.current; s.px = clamp(x / AREA_W * CW - CX, -CX + s.pw / 2, CX - s.pw / 2); if (s.balls.some(b => b.stuck) && phase === 'play') launch(s); },
    move: x => { const s = g.current; s.px = clamp(x / AREA_W * CW - CX, -CX + s.pw / 2, CX - s.pw / 2); },
  });

  const s = g.current;
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, (FAR + NEAR) / 2], s: [CW, NEAR - FAR, 1], c: '#3a2418' },
    { id: 'pared-i', k: 'box', p: [-CX - 0.2, 0.6, (FAR + NEAR) / 2], s: [0.4, 1.2, NEAR - FAR], c: C.orange, e: 0.35 },
    { id: 'pared-d', k: 'box', p: [CX + 0.2, 0.6, (FAR + NEAR) / 2], s: [0.4, 1.2, NEAR - FAR], c: C.orange, e: 0.35 },
    { id: 'pared-f', k: 'box', p: [0, 0.6, FAR - 0.2], s: [CW + 0.8, 1.2, 0.4], c: C.orange, e: 0.35 },
    { id: 'pala', k: 'box', p: [s.px, 0.3, PAD_Z], s: [s.pw, 0.6, 0.5], c: s.wide > 0 ? C.cyan : '#ffffff', e: 0.45 },
    ...s.bricks.map(k => ({ id: `b${k.id}`, k: 'box', p: [k.x, 0.4, k.z], s: [BW, 0.8, BD], c: `hsl(${k.hue},90%,${40 + (k.hp / k.max) * 18}%)`, e: 0.12 })),
    ...s.items.map(it => ({ id: `i${it.id}`, k: 'sph', p: [it.x, 0.5, it.z], n: 0.6, c: IC[it.k], e: 0.6 })),
    ...s.balls.map((b, i) => ({ id: `ball${i}`, k: 'sph', p: [b.x, 0.5, b.z], n: BR * 2, c: s.fire > 0 ? C.orange : '#ffffff', e: 0.7 })),
  ];
  const shake = fx.shakeT > 0 ? fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.04 : 0;
  const scene = {
    bg: '#0b0604', fog: { c: '#0b0604', near: 18, far: 42 }, objs,
    cam: { p: [s.px * 0.5 + (Math.random() - 0.5) * shake, 6.4, PAD_Z + 8.5], l: [s.px * 0.25, 0.2, -3.5], fov: 58 },
  };
  return (
    <GameScreen title="BREAKOUT" emoji="🧱" accent={C.orange} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={Math.max(3, s.lives)} /><Text style={{ color: C.dim, fontSize: 12 }}>Nivel <Text style={{ color: C.orange, fontWeight: '800' }}>{s.level}</Text></Text><Combo n={s.combo} color={C.orange} /></>}>
      <PlayArea fx={fx} bg="#0b0604" {...pan}>
        <World3D scene={scene} />
        {s.balls.some(b => b.stuck) && phase === 'play' && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.82, width: AREA_W, textAlign: 'center', color: C.dim, fontSize: 12, fontWeight: '800', letterSpacing: 2 }}>TOCA PARA LANZAR</Text>}
        {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.45, width: AREA_W, textAlign: 'center', color: C.text, fontSize: 24, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow(C.orange, 12) }}>{s.banner.text}</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🧱" title={phase === 'over' ? 'GAME OVER' : 'BREAKOUT 3D'}
          subtitle={phase === 'over' ? `Llegaste al nivel ${s.level}` : 'Rompe todos los ladrillos'}
          score={s.score} best={best} isNew={res.isNew} accent={C.orange} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para mover la pala · toca para lanzar', '↔ pala grande · ✱ multibola · 🔥 fuego · ❄ lento · ❤ vida', 'Vista en tercera persona detrás de la pala'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
