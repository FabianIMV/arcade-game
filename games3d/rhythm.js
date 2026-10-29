import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { C, SCREEN_W, alpha, glow, hx, randInt, tglow, useBest, useFX, useLoop } from '../utils/kit';
import { Game3D, HudPill } from '../utils/ui3d';
import { burst3d, clear3d } from '../utils/engine3d';

// RITMO Y COLOR 3D – carriles en PRIMERA PERSONA tipo Guitar Hero: las notas brillantes llegan por los 4 carriles
// hacia la línea de golpeo. Primero se miran; luego hay que repetirlas pulsando los carriles (cada 5 rondas, al revés).
const PADS = [
  { c: C.red, n: 'ROJO', h: 'tap' }, { c: C.blue, n: 'AZUL', h: 'hit' },
  { c: C.lime, n: 'VERDE', h: 'heavy' }, { c: C.amber, n: 'AMARILLO', h: 'tick' },
];
const LANE_X = [-1.5, -0.5, 0.5, 1.5], LANE_W = 0.8;
const HIT_Z = -1.0, SPAWN_Z = -32, SPEED = 12, TRAVEL = (HIT_Z + 32) / SPEED;
const CAM = { p: [0, 2.0, 4.0], l: [0, 0, -8], fov: 66 };
const BG = '#07051a';

const noteZ = (n, now) => HIT_Z - (n.t - now) * SPEED;
const stepOf = rnd => Math.max(0.42, 0.62 - rnd * 0.012);

// Decorado fijo (se calcula una vez): rejilla del suelo y pilares de neón
const STATIC = (() => {
  const out = [];
  for (let z = -30; z <= 2; z += 2) out.push({ id: `rz${z}`, k: 'box', p: [0, 0.005, z], s: [12, 0.01, 0.03], c: '#2a2160', e: 0.4, inst: 'rejilla' });
  for (let i = 0; i < 6; i++) for (const sx of [-3.4, 3.4]) out.push({ id: `pi${i}${sx}`, k: 'box', p: [sx, 1.6, -4 - i * 5], s: [0.25, 3.2, 0.25], c: C.violet, e: 0.9, inst: 'pilar' });
  return out;
})();

const initState = () => ({
  mode: 'wait', waitT: 1.0, round: 0, seq: [], rev: false, pos: 0, notes: [], showEnd: 0,
  now: 0, inputT: 0, limit: 1, timeLeft: 1, lit: [0, 0, 0, 0], score: 0, glowC: C.violet, glowT: 0,
});

export function RhythmTap3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('simon');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); nextRound(g.current); hx.tap(); };
  const fail = (s, why) => {
    s.mode = 'over'; hx.die(); fx.shake(8, 0.3); fx.flash(C.red, 0.3);
    setRes({ isNew: submitBest(s.score), why }); setPhase('over');
  };
  // Nueva ronda: se añade un paso y la secuencia completa vuelve a llegar por los carriles
  const nextRound = s => {
    s.round += 1;
    s.seq = [...s.seq, randInt(0, 3)];
    s.rev = s.round > 0 && s.round % 5 === 0;
    s.mode = 'show'; s.pos = 0;
    const step = stepOf(s.round);
    s.notes = s.seq.map((lane, i) => ({ id: `${s.round}-${i}`, lane, t: s.now + TRAVEL + i * step, done: false }));
    s.showEnd = s.now + TRAVEL + (s.seq.length - 1) * step + 0.6;
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.now += dt;
    s.lit = s.lit.map(v => Math.max(0, v - dt * 4));
    if (s.glowT > 0) s.glowT -= dt;
    if (s.mode === 'wait') { s.waitT -= dt; if (s.waitT <= 0) nextRound(s); }
    else if (s.mode === 'show') {
      for (const n of s.notes) if (!n.done && s.now >= n.t) { n.done = true; s.lit[n.lane] = 1; hx[PADS[n.lane].h](); }
      if (s.now >= s.showEnd) { s.mode = 'input'; s.notes = []; s.inputT = s.now; s.limit = 2.5 + s.seq.length * 0.9; }
    } else if (s.mode === 'input') {
      s.timeLeft = Math.max(0, 1 - (s.now - s.inputT) / s.limit);
      if (s.timeLeft <= 0) fail(s, 'tiempo');
    }
  });

  const press = i => {
    const s = g.current;
    if (phase !== 'play' || s.mode !== 'input') return;
    s.lit[i] = 1; hx[PADS[i].h]();
    s.glowC = PADS[i].c; s.glowT = 0.4;
    burst3d([LANE_X[i], 0.25, HIT_Z], PADS[i].c, 16, { speed: 4, up: 2, g: 8, size: 0.16, life: 0.5 });
    const expect = s.rev ? s.seq[s.seq.length - 1 - s.pos] : s.seq[s.pos];
    if (i !== expect) { fail(s, 'error'); return; }
    s.inputT = s.now;
    if (s.pos + 1 >= s.seq.length) {
      const bonus = s.seq.length * 10 + (s.rev ? 25 : 0);
      s.score += bonus; hx.good(); fx.pop(SCREEN_W / 2, 200, `+${bonus}`, C.amber, 22);
      burst3d([0, 1.0, HIT_Z], [C.amber, '#ffffff', C.violet], 40, { speed: 6, up: 3, size: 0.2, life: 0.9 });
      s.mode = 'wait'; s.pos = 0; s.waitT = 0.8;
    } else s.pos += 1;
  };

  const s = g.current;
  const shakeK = fx.shakeT > 0 ? (fx.shakeT / fx.shakeDur) * fx.shakeMag * 0.03 : 0;
  const cam = { p: [CAM.p[0] + (Math.random() - 0.5) * shakeK, CAM.p[1], CAM.p[2]], l: CAM.l, fov: CAM.fov };
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, -0.03, -14], s: [12, 44, 1], c: '#0a0718', recv: true },
    ...[0, 1, 2, 3].map(i => {
      const on = s.lit[i] > 0.05;
      return { id: `carril${i}`, k: 'box', p: [LANE_X[i], 0.0, -14], s: [LANE_W, 0.04, 40], c: on ? PADS[i].c : '#1d1740', e: on ? 0.3 + s.lit[i] * 0.7 : 0.06 };
    }),
    ...[0, 1, 2, 3].map(i => {
      const on = s.lit[i] > 0.05;
      return { id: `rec${i}`, k: 'box', p: [LANE_X[i], 0.06, HIT_Z], s: [LANE_W * 0.95, 0.12, 0.9], c: PADS[i].c, e: on ? 1 : 0.22 };
    }),
    { id: 'linea', k: 'box', p: [0, 0.03, HIT_Z - 0.55], s: [4.4, 0.04, 0.08], c: '#ffffff', e: 0.9 },
    { id: 'rail-i', k: 'box', p: [-2.2, 0.35, -14], s: [0.12, 0.7, 40], c: C.violet, e: 0.8 },
    { id: 'rail-d', k: 'box', p: [2.2, 0.35, -14], s: [0.12, 0.7, 40], c: C.violet, e: 0.8 },
  ];
  if (s.mode === 'show') {
    for (const n of s.notes) {
      const z = noteZ(n, s.now);
      if (z < SPAWN_Z || z > HIT_Z + 0.6) continue;
      objs.push({ id: `nota${n.id}`, k: 'box', p: [LANE_X[n.lane], 0.14, z], s: [LANE_W * 0.9, 0.22, 0.5], c: PADS[n.lane].c, e: 1 });
    }
  }
  const lights = [{ p: [0, 1.6, HIT_Z], c: s.glowT > 0 ? s.glowC : C.violet, i: s.glowT > 0 ? 8 : 4, d: 9 }];
  const scene = { bg: BG, fog: { c: BG, near: 6, far: 34 }, statics: STATIC, objs, lights, cam };

  const modeText = s.mode === 'show' ? 'MIRA…' : s.mode === 'input' ? (s.rev ? '↩ AL REVÉS' : 'REPITE') : s.mode === 'wait' ? '¡BIEN!' : '';
  const modeColor = s.mode === 'show' ? C.cyan : s.mode === 'input' ? C.lime : C.dim;

  return (
    <Game3D title="RITMO Y COLOR" emoji="🎵" accent={C.violet} onExit={onExit} score={s.score} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene}
      hud={<><HudPill label="RONDA" value={s.round} color={C.violet} /><Text style={{ color: modeColor, fontWeight: '900', fontSize: 14 }}>{phase !== 'play' ? '' : modeText}</Text><HudPill label="PASOS" value={s.seq.length} color={C.cyan} /></>}
      subtitle="Mira las notas y repite la secuencia"
      lines={['Las notas llegan por los carriles: memorízalas', 'Luego pulsa los carriles en el mismo orden', 'Cada 5 rondas: ¡hay que repetirla al revés!']}
      result={{ isNew: res.isNew, title: res.why === 'tiempo' ? '¡SE ACABÓ EL TIEMPO!' : 'SECUENCIA INCORRECTA', emoji: '🎵', subtitle: `Llegaste a la ronda ${s.round}`, stats: [['RONDA', s.round], ['PASOS', s.seq.length]] }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 6, left: 24, right: 24, height: 8, borderRadius: 4, backgroundColor: alpha(C.violet, 0.2), overflow: 'hidden' }}>
        <View style={{ width: `${(s.mode === 'input' ? s.timeLeft : 0) * 100}%`, height: '100%', backgroundColor: s.timeLeft < 0.3 ? C.red : C.violet }} />
      </View>
      {s.rev && s.mode !== 'wait' && phase === 'play' && <Text pointerEvents="none" style={{ position: 'absolute', top: 24, width: SCREEN_W, textAlign: 'center', color: C.pink, fontWeight: '900', letterSpacing: 2, fontSize: 14, ...tglow(C.pink, 8) }}>RONDA ESPECIAL: REPITE AL REVÉS</Text>}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', height: 100 }}>
        {PADS.map((p, i) => {
          const on = s.lit[i] > 0.05;
          return (
            <Pressable key={i} testID={`pad-${i}`} onPressIn={() => press(i)} style={{ flex: 1 }}>
              <View style={{ flex: 1, margin: 5, borderRadius: 16, backgroundColor: on ? p.c : alpha(p.c, 0.2), borderWidth: 2, borderColor: on ? '#fff' : alpha(p.c, 0.75), alignItems: 'center', justifyContent: 'center', ...glow(p.c, on ? 22 : 6, on ? 1 : 0.4) }}>
                <Text style={{ color: on ? '#04040c' : alpha(p.c, 0.95), fontWeight: '900', letterSpacing: 1, fontSize: 12 }}>{p.n}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Game3D>
  );
}
