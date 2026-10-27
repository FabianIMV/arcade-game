import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, alpha, glow, hx, randInt, useBest, useFX, useLoop, tglow } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Ritmo en PRIMERA PERSONA, carriles 3D: la secuencia llega como notas por los 4 carriles hacia la línea de golpeo.
// Luego hay que repetirla pulsando los carriles (cada 5 rondas, al revés).
const PADS = [
  { c: C.red, n: 'ROJO', h: 'tap' }, { c: C.blue, n: 'AZUL', h: 'hit' },
  { c: C.lime, n: 'VERDE', h: 'heavy' }, { c: C.amber, n: 'AMARILLO', h: 'tick' },
];
const LANE_X = [-1.5, -0.5, 0.5, 1.5], LANE_W = 0.8;
const HIT_Z = -1.0, SPAWN_Z = -32, SPEED = 12, TRAVEL = (HIT_Z - SPAWN_Z) / SPEED;
const CAM = { p: [0, 2.0, 4.0], l: [0, 0, -8], fov: 66 };
const BG = '#07051a';

const noteZ = (n, now) => HIT_Z - (n.t - now) * SPEED;
const stepOf = rnd => Math.max(0.42, 0.62 - rnd * 0.012);

const initState = () => ({
  mode: 'wait', waitT: 1.0, round: 0, seq: [], rev: false, pos: 0, notes: [], showEnd: 0,
  now: 0, inputT: 0, limit: 1, timeLeft: 1, lit: [0, 0, 0, 0], score: 0,
});

export function RhythmTap3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('simon');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); nextRound(g.current); };
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
    const expect = s.rev ? s.seq[s.seq.length - 1 - s.pos] : s.seq[s.pos];
    if (i !== expect) { fail(s, 'error'); return; }
    s.inputT = s.now;
    if (s.pos + 1 >= s.seq.length) {
      const bonus = s.seq.length * 10 + (s.rev ? 25 : 0);
      s.score += bonus; hx.good(); fx.pop(AREA_W / 2, AREA_H * 0.2, `+${bonus}`, C.amber, 22);
      s.mode = 'wait'; s.pos = 0; s.waitT = 0.8;
    } else s.pos += 1;
  };

  const s = g.current;
  const shakeK = fx.shakeT > 0 ? (fx.shakeT / fx.shakeDur) * fx.shakeMag * 0.03 : 0;
  const cam = { p: [CAM.p[0] + (Math.random() - 0.5) * shakeK, CAM.p[1], CAM.p[2]], l: CAM.l, fov: CAM.fov };
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, -0.03, -14], s: [12, 44, 1], c: '#0a0718' },
    ...[0, 1, 2, 3].map(i => {
      const on = s.lit[i] > 0.05;
      return { id: `carril${i}`, k: 'box', p: [LANE_X[i], 0.0, -14], s: [LANE_W, 0.04, 40], c: on ? PADS[i].c : '#1d1740', e: on ? 0.2 + s.lit[i] * 0.7 : 0.05 };
    }),
    { id: 'linea', k: 'box', p: [0, 0.03, HIT_Z], s: [4.4, 0.05, 0.12], c: '#ffffff', e: 0.9 },
    { id: 'rail-i', k: 'box', p: [-2.5, 0.25, -14], s: [0.1, 0.5, 40], c: C.violet, e: 0.5 },
    { id: 'rail-d', k: 'box', p: [2.5, 0.25, -14], s: [0.1, 0.5, 40], c: C.violet, e: 0.5 },
  ];
  if (s.mode === 'show') {
    for (const n of s.notes) {
      const z = noteZ(n, s.now);
      if (z < SPAWN_Z || z > HIT_Z + 0.6) continue;
      objs.push({ id: `nota${n.id}`, k: 'box', p: [LANE_X[n.lane], 0.12, z], s: [LANE_W * 0.9, 0.16, 0.5], c: PADS[n.lane].c, e: 0.8 });
    }
  }
  const scene = { bg: BG, fog: { c: BG, near: 6, far: 34 }, objs, cam };

  const pads = PADS.map((p, i) => ({ ...p, i }));
  const modeText = s.mode === 'show' ? 'MIRA…' : s.mode === 'input' ? (s.rev ? '↩ AL REVÉS' : 'REPITE') : s.mode === 'wait' ? '¡BIEN!' : '';
  const modeColor = s.mode === 'show' ? C.cyan : s.mode === 'input' ? C.lime : C.dim;

  return (
    <GameScreen title="RITMO Y COLOR" emoji="🎵" accent={C.violet} onExit={onExit} score={s.score} best={best}
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Ronda <Text style={{ color: C.violet, fontWeight: '800' }}>{s.round}</Text></Text><Text style={{ color: modeColor, fontWeight: '900', fontSize: 13 }}>{phase !== 'play' ? '' : modeText}</Text><Text style={{ color: C.dim, fontSize: 12 }}>{s.seq.length} pasos</Text></>}>
      <PlayArea fx={fx} bg={BG} border={alpha(C.violet, 0.4)}>
        <World3D scene={scene} />
        <View pointerEvents="none" style={{ position: 'absolute', top: 14, left: 24, right: 24, height: 8, borderRadius: 4, backgroundColor: alpha(C.violet, 0.15), overflow: 'hidden' }}>
          <View style={{ width: `${(s.mode === 'input' ? s.timeLeft : 0) * 100}%`, height: '100%', backgroundColor: s.timeLeft < 0.3 ? C.red : C.violet }} />
        </View>
        {s.rev && s.mode !== 'wait' && phase === 'play' && <Text pointerEvents="none" style={{ position: 'absolute', top: 30, width: AREA_W, textAlign: 'center', color: C.pink, fontWeight: '900', letterSpacing: 2, fontSize: 13, ...tglow(C.pink, 8) }}>RONDA ESPECIAL: REPITE AL REVÉS</Text>}
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', height: 96 }}>
          {pads.map(p => {
            const on = s.lit[p.i] > 0.05;
            return (
              <Pressable key={p.i} testID={`pad-${p.i}`} onPressIn={() => press(p.i)} style={{ flex: 1 }}>
                <View style={{ flex: 1, margin: 4, borderRadius: 16, backgroundColor: on ? p.c : alpha(p.c, 0.18), borderWidth: 2, borderColor: on ? '#fff' : alpha(p.c, 0.7), alignItems: 'center', justifyContent: 'center', ...glow(p.c, on ? 22 : 6, on ? 1 : 0.4) }}>
                  <Text style={{ color: on ? '#04040c' : alpha(p.c, 0.9), fontWeight: '900', letterSpacing: 1, fontSize: 11 }}>{p.n}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🎵" title={phase === 'over' ? (res.why === 'tiempo' ? '¡SE ACABÓ EL TIEMPO!' : 'SECUENCIA INCORRECTA') : 'RITMO 3D'}
          subtitle={phase === 'over' ? `Llegaste a la ronda ${s.round}` : 'Mira las notas y repite la secuencia'}
          score={s.score} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Las notas llegan por los carriles: memorízalas', 'Luego pulsa los carriles en el mismo orden', 'Cada 5 rondas: ¡hay que repetirla al revés!'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
