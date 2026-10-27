import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Lives, Combo, Overlay, PlayArea, clamp, hx, rand, randInt, uid, useBest, useFX, useLoop, alpha, glow, tglow } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Corredor en PRIMERA PERSONA: las puertas de color vienen hacia ti. Antes de cruzarlas, elige tu color (botones).
// La palabra va escrita sobre cada puerta (2D) con la tinta de color: la regla dice si cuenta la tinta o la palabra.
const CR_FOV = 70, CAM_Z = 0.9, CAM_H = 1.5;
const GATE_W = 4.7, GATE_H = 2.2, WALL_X = 2.35, LABEL_Y = 2.6;
const GATE_START = -45, GAP = 11, MAX_SPEED = 17;
const STRIPES = 22, STRIPE_GAP = 3, STRIPE_LOOP = STRIPES * STRIPE_GAP;
const BG = '#0a0612';
const COLS6 = [
  { n: 'ROJO', c: C.red }, { n: 'AZUL', c: C.blue }, { n: 'VERDE', c: C.lime },
  { n: 'AMARILLO', c: C.amber }, { n: 'MORADO', c: C.violet }, { n: 'NARANJA', c: C.orange },
];

// Vectores y proyección 3D -> píxeles del PlayArea (misma cámara que la escena, FOV vertical)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const toScreen = (cam, P) => {
  const f = nrm(sub(cam.l, cam.p)); const r = nrm(cross(f, [0, 1, 0])); const u = cross(r, f);
  const d = sub(P, cam.p); const z = dot(d, f);
  const t = Math.tan((cam.fov * Math.PI) / 360) * z;
  return { x: AREA_W / 2 + (dot(d, r) / (t * (AREA_W / AREA_H))) * (AREA_W / 2), y: AREA_H / 2 - (dot(d, u) / t) * (AREA_H / 2), z, px: (AREA_H / 2) / t };
};

const newGate = s => {
  const n = s.ok >= 14 ? 6 : 4;
  const w = randInt(0, n - 1);
  const ink = Math.random() < 0.35 ? w : randInt(0, n - 1);
  return { id: uid(), n, w, ink, z: GATE_START, done: false };
};

const initState = () => ({
  mine: 0, ok: 0, score: 0, lives: 3, combo: 0, maxCombo: 0, rule: 'ink', ruleLeft: 6,
  gates: [], dist: 0, nextAt: 0, speed: 9, t: 0, sway: 0, flash: null, banner: null,
});

export function ColorRush3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('colorrush');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const choose = i => { const s = g.current; if (phase !== 'play' || s.lives <= 0) return; if (s.mine !== i) { s.mine = i; hx.tick(); } };

  const wrong = s => {
    s.lives -= 1; s.combo = 0; s.flash = { c: C.red, t: 0.25 };
    fx.shake(7, 0.25); fx.flash(C.red, 0.2); fx.pop(AREA_W / 2, AREA_H * 0.42, '✖', C.red, 26); hx.bad();
    if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  };
  // Se cruza la puerta: el color elegido debe coincidir con el que marca la regla
  const judge = (s, k) => {
    const want = s.rule === 'ink' ? k.ink : k.w;
    if (s.mine !== want) { wrong(s); return; }
    s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo); s.ok += 1;
    const pts = 10 * (1 + Math.floor(s.combo / 8));
    s.score += pts; s.flash = { c: C.lime, t: 0.2 };
    fx.pop(AREA_W / 2, AREA_H * 0.42, `+${pts}`, C.lime, 22); fx.burst(AREA_W / 2, AREA_H * 0.6, COLS6[k.ink].c, 16, 220); hx.hit();
    s.ruleLeft -= 1;
    if (s.ruleLeft <= 0) { s.rule = s.rule === 'ink' ? 'word' : 'ink'; s.ruleLeft = randInt(5, 8); s.banner = { t: 1.4 }; fx.flash(C.violet, 0.25); hx.warn(); }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    s.speed = Math.min(MAX_SPEED, 9 + s.ok * 0.22);
    const mv = s.speed * dt;
    s.dist += mv;
    s.sway = Math.sin(s.t * 1.6) * 0.08;
    if (s.flash) { s.flash.t -= dt; if (s.flash.t <= 0) s.flash = null; }
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    if (s.dist >= s.nextAt) { s.gates.push(newGate(s)); s.nextAt = s.dist + GAP * rand(0.9, 1.25); }
    for (let i = s.gates.length - 1; i >= 0; i--) {
      const k = s.gates[i];
      k.z += mv;
      if (!k.done && k.z >= 0) { k.done = true; judge(s, k); }
      if (k.z > 1.6) s.gates.splice(i, 1);
    }
  });

  const s = g.current;
  const n = s.ok >= 14 ? 6 : 4;
  const shakeK = fx.shakeT > 0 ? (fx.shakeT / fx.shakeDur) * fx.shakeMag * 0.02 : 0;
  const cam = {
    p: [s.sway + (Math.random() - 0.5) * shakeK, CAM_H + Math.sin(s.t * 9) * 0.02, CAM_Z],
    l: [s.sway * 0.4, 1.2, -12], fov: CR_FOV,
  };
  const mine = COLS6[s.mine].c;
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, -30], s: [GATE_W + 1.6, 72, 1], c: '#120c24' },
    { id: 'pared-i', k: 'box', p: [-WALL_X - 0.2, 1.1, -30], s: [0.4, 2.2, 72], c: mine, e: 0.18, o: 0.85 },
    { id: 'pared-d', k: 'box', p: [WALL_X + 0.2, 1.1, -30], s: [0.4, 2.2, 72], c: mine, e: 0.18, o: 0.85 },
    ...Array.from({ length: STRIPES }, (_, i) => {
      const z = -((((i * STRIPE_GAP) - s.dist) % STRIPE_LOOP) + STRIPE_LOOP) % STRIPE_LOOP;
      return { id: `st${i}`, k: 'pla', p: [0, 0.01, z], s: [GATE_W, 1, 1], c: i % 2 ? '#1c1436' : '#150f2c' };
    }),
    ...s.gates.map(k => ({ id: `g${k.id}`, k: 'box', p: [0, GATE_H / 2, k.z], s: [GATE_W, GATE_H, 0.22], c: COLS6[k.ink].c, e: 0.4, o: k.done ? 0.12 : 0.5 })),
  ];
  const scene = { bg: BG, fog: { c: BG, near: 6, far: 48 }, objs, cam };

  const bw = n > 4 ? (AREA_W - 68) / 3 : (AREA_W - 78) / 4;
  const rule = s.rule === 'ink' ? 'PASA CON EL COLOR DE LA TINTA' : 'PASA CON EL COLOR DE LA PALABRA';

  return (
    <GameScreen title="COLOR RUSH" emoji="🎨" accent={C.pink} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.dim, fontSize: 12 }}>Aciertos <Text style={{ color: C.pink, fontWeight: '800' }}>{s.ok}</Text></Text><View style={{ minWidth: 70, alignItems: 'flex-end' }}>{s.combo > 2 ? <Combo n={s.combo} color={C.pink} /> : null}</View></>}>
      <PlayArea fx={fx} bg={BG} border={alpha(C.pink, 0.4)}>
        <World3D scene={scene} />
        {(() => {
          // Solo la puerta que toca ahora (la más cercana sin cruzar): así las palabras no se solapan a lo lejos
          const next = s.gates.filter(k => !k.done).sort((a, b) => b.z - a.z)[0];
          if (!next) return null;
          const sc = toScreen(cam, [0, LABEL_Y, next.z]);
          const fs = Math.round(clamp(sc.px * 0.8, 14, 52));
          return (
            <Text key={next.id} pointerEvents="none" style={{ position: 'absolute', left: sc.x - 160, top: sc.y - fs, width: 320, textAlign: 'center', fontSize: fs, fontWeight: '900', letterSpacing: 2, color: COLS6[next.ink].c, ...tglow(COLS6[next.ink].c, 12) }}>{COLS6[next.w].n}</Text>
          );
        })()}
        <View pointerEvents="none" style={{ position: 'absolute', top: 14, left: 18, right: 18, alignItems: 'center' }}>
          <Text style={{ color: s.rule === 'ink' ? C.cyan : C.amber, fontSize: 13, fontWeight: '900', letterSpacing: 2 }}>{rule}</Text>
          <Text style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>Tu color: <Text style={{ color: mine, fontWeight: '900' }}>{COLS6[s.mine].n}</Text></Text>
        </View>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 14, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: AREA_W - 48, gap: 10, justifyContent: 'center' }}>
            {COLS6.slice(0, n).map((c, i) => {
              const on = s.mine === i;
              return (
                <Pressable key={i} testID={`cr-${i}`} onPressIn={() => choose(i)} style={{ width: bw, height: 44 }}>
                  <View style={{ flex: 1, borderRadius: 18, backgroundColor: alpha(c.c, on ? 1 : 0.55), borderWidth: 3, borderColor: on ? '#fff' : '#fff3', ...glow(c.c, on ? 18 : 6, on ? 1 : 0.4) }} />
                </Pressable>
              );
            })}
          </View>
        </View>
        {s.banner && <View pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.45, left: 0, right: 0, alignItems: 'center' }}><Text style={{ color: C.violet, fontSize: 18, fontWeight: '900', letterSpacing: 2, ...tglow(C.violet, 12) }}>¡CAMBIÓ LA REGLA!</Text></View>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🎨" title={phase === 'over' ? 'TE CONFUNDISTE' : 'COLOR RUSH 3D'}
          subtitle={phase === 'over' ? `${s.ok} aciertos · mejor racha ${s.maxCombo}` : 'Tu cerebro contra tus ojos'}
          score={s.score} best={best} isNew={res.isNew} accent={C.pink} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Corre por el corredor: elige tu color con los botones', 'Cruza cada puerta con el color que pide la regla', 'La regla cambia cada pocos aciertos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
