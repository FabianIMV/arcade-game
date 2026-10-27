import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Overlay, PlayArea, alpha, hx, rand, randInt, useBest, useFX, useLoop, usePan, tglow } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Escenario en TERCERA PERSONA: muro 3D de 9 paneles. Rondas pares: todo el escenario se pone verde, toca donde sea.
// Rondas impares: se ilumina UN panel, tócalo. Tocar antes de tiempo repite la ronda.
const ROUNDS = 5, HIT_R = 70;
const CAM = { p: [0, 3.1, 7.5], l: [0, 2.3, -4], fov: 60 };
const PANEL_X = [-2.7, 0, 2.7], PANEL_Y = [1.4, 2.9, 4.4], PANEL_Z = -7.2;
const PANELS = Array.from({ length: 9 }, (_, i) => [PANEL_X[i % 3], PANEL_Y[Math.floor(i / 3)], PANEL_Z]);
const BG_IDLE = '#0d0a18', BG_GO = '#06371b', BG_EARLY = '#3a0a14';

// Proyección 3D -> píxeles del PlayArea (misma cámara que la escena)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const toScreen = (cam, P) => {
  const f = nrm(sub(cam.l, cam.p)); const r = nrm(cross(f, [0, 1, 0])); const u = cross(r, f);
  const d = sub(P, cam.p); const z = dot(d, f);
  const t = Math.tan((cam.fov * Math.PI) / 360) * z;
  return { x: AREA_W / 2 + (dot(d, r) / (t * (AREA_W / AREA_H))) * (AREA_W / 2), y: AREA_H / 2 - (dot(d, u) / t) * (AREA_H / 2) };
};

const GRADE = ms => (ms < 220 ? ['⚡ SOBREHUMANO', C.cyan] : ms < 280 ? ['🐆 RAPIDÍSIMO', C.lime] : ms < 340 ? ['🐇 BUEN REFLEJO', C.amber] : ms < 450 ? ['🚶 NORMAL', C.orange] : ['🐢 DESPIERTA', C.red]);

const initState = () => ({ st: 'wait', tm: rand(1.2, 3.4), round: 0, times: [], goAt: 0, target: 0, last: 0, final: false, avg: 0, t: 0, fl: 0 });

export function ReactionTime3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('reaction', true);
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const arm = (s, r) => { s.round = r; s.st = 'wait'; s.tm = rand(1.2, 3.6); };
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const finish = s => {
    hx.win(); setRes({ isNew: submitBest(s.avg), avg: s.avg }); setPhase('over');
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    s.t += dt;
    if (s.fl > 0) s.fl = Math.max(0, s.fl - dt * 2);
    if (s.st === 'wait') { s.tm -= dt; if (s.tm <= 0) { s.st = 'go'; s.goAt = Date.now(); s.target = randInt(0, 8); } }
    else if (s.st === 'early') { s.tm -= dt; if (s.tm <= 0) arm(s, s.round); }
    else if (s.st === 'result') {
      s.tm -= dt;
      if (s.tm <= 0) { if (s.final) finish(s); else arm(s, s.round + 1); }
    }
  });

  const hitGo = (s, x, y) => {
    const ms = Date.now() - s.goAt;
    s.last = ms; s.times.push(ms); hx.hit(); s.fl = 1;
    fx.burst(x, y, GRADE(ms)[1], 18, 240);
    s.st = 'result';
    if (s.times.length >= ROUNDS) {
      s.final = true; s.avg = Math.round(s.times.reduce((a, b) => a + b, 0) / s.times.length); s.tm = 0.7;
    } else s.tm = 1.1;
  };
  const press = (x, y) => {
    const s = g.current;
    if (phase !== 'play') return;
    if (s.st === 'wait') { s.st = 'early'; s.tm = 1.3; hx.bad(); fx.shake(6, 0.25); return; }
    if (s.st === 'go') {
      if (s.round % 2 === 1) {
        const p = toScreen(CAM, PANELS[s.target]);
        if (Math.hypot(x - p.x, y - p.y) > HIT_R) return;
      }
      hitGo(s, x, y);
    }
  };
  const pan = usePan(fx, { down: (x, y) => press(x, y) });

  const s = g.current;
  const targetMode = s.round % 2 === 1;
  const goGreen = s.st === 'go' && !targetMode;
  const lit = s.st === 'go' && targetMode ? s.target : -1;
  const bg = goGreen ? BG_GO : s.st === 'early' ? BG_EARLY : BG_IDLE;
  const ringC = s.st === 'go' ? (goGreen ? C.lime : C.amber) : s.st === 'early' ? C.red : s.st === 'result' ? GRADE(s.last)[1] : '#5a5a80';
  const shakeK = fx.shakeT > 0 ? (fx.shakeT / fx.shakeDur) * fx.shakeMag * 0.03 : 0;
  const cam = { p: [CAM.p[0] + (Math.random() - 0.5) * shakeK, CAM.p[1], CAM.p[2]], l: CAM.l, fov: CAM.fov };
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, -6], s: [16, 26, 1], c: goGreen ? '#0f5a2c' : '#0d0a1c', e: goGreen ? 0.25 : 0.02 },
    ...[0, 1, 2, 3, 4, 5, 6].map(i => ({ id: `lin${i}`, k: 'box', p: [0, 0.01, -1.5 - i * 2.2], s: [12, 0.02, 0.05], c: '#3a3166', e: 0.3 })),
    { id: 'muro', k: 'box', p: [0, 2.6, PANEL_Z - 0.6], s: [14, 6.4, 0.4], c: '#0e0b1c' },
    ...PANELS.map((p, i) => {
      const on = goGreen || i === lit;
      return { id: `p${i}`, k: 'box', p, s: [2.0, 1.2, 0.2], c: on ? (goGreen ? '#7dff6b' : C.lime) : '#2a2350', e: on ? 0.9 : 0.05 };
    }),
    ...[0, 1, 2, 3].flatMap(i => [
      { id: `cl${i}`, k: 'box', p: [-5.2, 2.5, -2 - 3 * i], s: [0.6, 5, 0.6], c: '#2a2350', e: 0.25 },
      { id: `cr${i}`, k: 'box', p: [5.2, 2.5, -2 - 3 * i], s: [0.6, 5, 0.6], c: '#2a2350', e: 0.25 },
    ]),
    { id: 'anillo', k: 'tor', p: [0, 0.9, -1.0], n: 1.1, c: ringC, e: 0.8 },
  ];
  const scene = { bg, fog: { c: bg, near: 12, far: 34 }, objs, cam };

  const finalAvg = res.avg || (s.times.length ? Math.round(s.times.reduce((a, b) => a + b, 0) / s.times.length) : 0);
  const avgNow = s.times.length ? Math.round(s.times.reduce((a, b) => a + b, 0) / s.times.length) : 0;
  const stateText = s.st === 'wait' ? 'ESPERA…' : s.st === 'go' ? (targetMode ? 'TOCA EL PANEL ILUMINADO' : '¡YA!') : s.st === 'early' ? '¡DEMASIADO PRONTO!' : `${s.last} ms`;
  const stateColor = s.st === 'go' ? C.lime : s.st === 'early' ? C.red : s.st === 'result' ? GRADE(s.last)[1] : C.text;

  return (
    <GameScreen title="REFLEJOS" emoji="⚡" accent={C.pink} onExit={onExit} score={phase === 'over' ? finalAvg : avgNow} scoreLabel="MEDIA ms" best={best} bestLabel="MEJOR ms"
      hud={<><Text style={{ color: C.dim, fontSize: 12 }}>Ronda <Text style={{ color: C.pink, fontWeight: '800' }}>{Math.min(ROUNDS, s.times.length + (s.st === 'result' ? 0 : 1))}/{ROUNDS}</Text></Text><View style={{ flexDirection: 'row', gap: 4 }}>{Array.from({ length: ROUNDS }, (_, i) => <View key={i} style={{ width: 22, height: 6, borderRadius: 3, backgroundColor: i < s.times.length ? C.pink : alpha(C.pink, 0.2) }} />)}</View><Text style={{ color: C.dim, fontSize: 12 }}>{targetMode ? 'Toca el objetivo' : 'Toca la pantalla'}</Text></>}>
      <PlayArea fx={fx} bg={bg} border={alpha(C.pink, 0.4)} {...pan}>
        <World3D scene={scene} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: AREA_H * 0.08, alignItems: 'center' }}>
          <Text style={{ color: stateColor, fontSize: s.st === 'result' ? 46 : 24, fontWeight: '900', letterSpacing: 2, textAlign: 'center', ...tglow(stateColor, 14) }}>{stateText}</Text>
          {s.st === 'wait' && <Text style={{ color: C.dim, marginTop: 6 }}>{targetMode ? 'Aparecerá un objetivo' : 'Toca cuando se ponga verde'}</Text>}
          {s.st === 'result' && <Text style={{ color: GRADE(s.last)[1], fontSize: 16, fontWeight: '900', marginTop: 6 }}>{GRADE(s.last)[0]}</Text>}
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji="⚡" title={phase === 'over' ? GRADE(finalAvg)[0] : 'REFLEJOS 3D'}
          subtitle={phase === 'over' ? `Tus tiempos: ${s.times.join(' · ')} ms` : '5 rondas · mide tu tiempo de reacción'}
          score={finalAvg} scoreLabel="MEDIA (ms)" best={best} isNew={res.isNew} accent={C.pink} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Pantalla verde: toca lo más rápido posible', 'Rondas alternas: toca el panel que se ilumina', 'Si tocas antes de tiempo, repites la ronda'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
