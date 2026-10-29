import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { C, SCREEN_H, SCREEN_W, Combo, Lives, alpha, clamp, glow, hx, rand, randInt, tglow, uid, useBest, useFX, useLoop } from '../utils/kit';
import { Game3D, HudPill } from '../utils/ui3d';
import { burst3d, clear3d } from '../utils/engine3d';
import { project } from '../utils/openworld';
import { shade } from '../utils/prefabs';

// COLOR RUSH 3D – corredor en PRIMERA PERSONA con puertas de neón. La palabra escrita sobre cada puerta
// va con la tinta de un color: la regla dice si cuenta la TINTA o la PALABRA. Elige tu color (botones) y cruza.
const CR_FOV = 70, CAM_Z = 0.9, CAM_H = 1.5;
const GATE_W = 4.7, GATE_H = 2.2, WALL_X = 2.35, LABEL_Y = 2.75;
const GATE_START = -45, GAP = 11, MAX_SPEED = 17;
const STRIPES = 22, STRIPE_GAP = 3, STRIPE_LOOP = STRIPES * STRIPE_GAP;
const BG = '#0a0612';
const COLS6 = [
  { n: 'ROJO', c: C.red }, { n: 'AZUL', c: C.blue }, { n: 'VERDE', c: C.lime },
  { n: 'AMARILLO', c: C.amber }, { n: 'MORADO', c: C.violet }, { n: 'NARANJA', c: C.orange },
];

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

// Textos 2D sobre objetos 3D (proyección con la cámara del juego); compensa la cabecera de Game3D.
function Labels3D({ cam, items }) {
  const box = useRef(null);
  const org = useRef({ x: 0, y: 0 }).current;
  const measure = () => { if (box.current && box.current.measureInWindow) box.current.measureInWindow((x, y) => { org.x = x; org.y = y; }); };
  const K = (SCREEN_H / 2) / Math.tan((cam.fov * Math.PI) / 360);
  return (
    <View ref={box} onLayout={measure} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      {items.map(it => {
        const q = project(cam, it.p, SCREEN_W, SCREEN_H);
        if (!q) return null;
        const fs = Math.round(clamp((K / q.z) * it.u, it.min, it.max));
        const w = it.w || 300;
        return (
          <Text key={it.key} pointerEvents="none" numberOfLines={1} style={{ position: 'absolute', left: q.x - w / 2 - org.x, top: q.y - fs * 0.6 - org.y, width: w, textAlign: 'center', color: it.color, fontSize: fs, fontWeight: '900', letterSpacing: 2, ...tglow(it.color, 12) }}>{it.text}</Text>
        );
      })}
    </View>
  );
}

export function ColorRush3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('colorrush');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const choose = i => { const s = g.current; if (phase !== 'play' || s.lives <= 0) return; if (s.mine !== i) { s.mine = i; hx.tick(); } };

  const wrong = s => {
    s.lives -= 1; s.combo = 0; s.flash = { c: C.red, t: 0.25 };
    fx.shake(7, 0.25); fx.flash(C.red, 0.2); fx.pop(SCREEN_W / 2, SCREEN_H * 0.42, '✖', C.red, 26); hx.bad();
    burst3d([0, 1.2, -1.2], C.red, 26, { speed: 5, up: 2, size: 0.2, life: 0.8 });
    if (s.lives <= 0) { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }
  };
  // Se cruza la puerta: el color elegido debe coincidir con el que marca la regla
  const judge = (s, k) => {
    const want = s.rule === 'ink' ? k.ink : k.w;
    if (s.mine !== want) { wrong(s); return; }
    s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo); s.ok += 1;
    const pts = 10 * (1 + Math.floor(s.combo / 8));
    s.score += pts; s.flash = { c: C.lime, t: 0.2 };
    fx.pop(SCREEN_W / 2, SCREEN_H * 0.42, `+${pts}`, C.lime, 22);
    burst3d([0, 1.2, -1.2], [COLS6[k.ink].c, '#ffffff'], 30, { speed: 6, up: 2.5, size: 0.22, life: 0.9 });
    hx.hit();
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
  const next = s.gates.filter(k => !k.done).sort((a, b) => b.z - a.z)[0];
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, -30], s: [GATE_W + 1.6, 72, 1], c: '#120c24', recv: true },
    { id: 'pared-i', k: 'box', p: [-WALL_X - 0.2, 1.1, -30], s: [0.4, 2.2, 72], c: shade(mine, 0.55), e: 0.3 },
    { id: 'pared-d', k: 'box', p: [WALL_X + 0.2, 1.1, -30], s: [0.4, 2.2, 72], c: shade(mine, 0.55), e: 0.3 },
    ...Array.from({ length: STRIPES }, (_, i) => {
      const z = -((((i * STRIPE_GAP) - s.dist) % STRIPE_LOOP) + STRIPE_LOOP) % STRIPE_LOOP;
      return { id: `st${i}`, k: 'pla', p: [0, 0.01, z], s: [GATE_W, 1, 1], c: i % 2 ? '#1c1436' : '#150f2c', e: 0.08 };
    }),
    ...s.gates.flatMap(k => {
      const ink = COLS6[k.ink].c, o = k.done ? 0.12 : 0.5;
      return [
        { id: `g${k.id}`, k: 'box', p: [0, GATE_H / 2, k.z], s: [GATE_W, GATE_H, 0.22], c: ink, e: 0.45, o },
        { id: `gl${k.id}`, k: 'box', p: [-GATE_W / 2 - 0.12, GATE_H / 2, k.z], s: [0.22, GATE_H + 0.3, 0.4], c: '#1b1442', e: 0.3 },
        { id: `gr${k.id}`, k: 'box', p: [GATE_W / 2 + 0.12, GATE_H / 2, k.z], s: [0.22, GATE_H + 0.3, 0.4], c: '#1b1442', e: 0.3 },
        { id: `gt${k.id}`, k: 'box', p: [0, GATE_H + 0.1, k.z], s: [GATE_W + 0.6, 0.26, 0.4], c: ink, e: 1 },
      ];
    }),
  ];
  const lights = next ? [{ p: [0, 2.4, next.z - 1.5], c: COLS6[next.ink].c, i: 7, d: 12 }] : [];
  const scene = { bg: BG, fog: { c: BG, near: 6, far: 48 }, objs, lights, cam };

  const labels = next ? [{ key: `next${next.id}`, p: [0, LABEL_Y, next.z], text: COLS6[next.w].n, color: COLS6[next.ink].c, u: 0.85, min: 16, max: 56, w: 320 }] : [];
  const bw = n > 4 ? (SCREEN_W - 80) / 3 : (SCREEN_W - 92) / 4;
  const rule = s.rule === 'ink' ? 'PASA CON EL COLOR DE LA TINTA' : 'PASA CON EL COLOR DE LA PALABRA';

  return (
    <Game3D title="COLOR RUSH" emoji="🎨" accent={C.pink} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene}
      hud={<><Lives n={s.lives} max={3} /><HudPill label="OK" value={s.ok} color={C.pink} />{s.combo > 2 ? <Combo n={s.combo} color={C.pink} /> : null}</>}
      subtitle="Tu cerebro contra tus ojos"
      lines={['Corre por el corredor: elige tu color con los botones', 'Cruza cada puerta con el color que pide la regla', 'La regla cambia cada pocos aciertos']}
      result={{ isNew: res.isNew, title: 'TE CONFUNDISTE', emoji: '🎨', subtitle: `${s.ok} aciertos · mejor racha ${s.maxCombo}`, stats: [['ACIERTOS', s.ok], ['RACHA', s.maxCombo]] }}>
      <Labels3D cam={cam} items={labels} />
      <View pointerEvents="none" style={{ position: 'absolute', top: 6, left: 18, right: 18, alignItems: 'center' }}>
        <Text style={{ color: s.rule === 'ink' ? C.cyan : C.amber, fontSize: 14, fontWeight: '900', letterSpacing: 2, ...tglow(s.rule === 'ink' ? C.cyan : C.amber, 8) }}>{rule}</Text>
        <Text style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>Tu color: <Text style={{ color: mine, fontWeight: '900' }}>{COLS6[s.mine].n}</Text></Text>
      </View>
      {s.banner && <View pointerEvents="none" style={{ position: 'absolute', top: SCREEN_H * 0.36, left: 0, right: 0, alignItems: 'center' }}><Text style={{ color: C.violet, fontSize: 20, fontWeight: '900', letterSpacing: 2, ...tglow(C.violet, 12) }}>¡CAMBIÓ LA REGLA!</Text></View>}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 26, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: SCREEN_W - 48, gap: 10, justifyContent: 'center' }}>
          {COLS6.slice(0, n).map((c, i) => {
            const on = s.mine === i;
            return (
              <Pressable key={i} testID={`cr-${i}`} onPressIn={() => choose(i)} style={{ width: bw, height: 48 }}>
                <View style={{ flex: 1, borderRadius: 18, backgroundColor: alpha(c.c, on ? 1 : 0.5), borderWidth: 3, borderColor: on ? '#fff' : '#fff3', ...glow(c.c, on ? 18 : 6, on ? 1 : 0.4) }} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </Game3D>
  );
}
