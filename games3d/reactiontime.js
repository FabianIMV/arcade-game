import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, SCREEN_H, SCREEN_W, alpha, hx, rand, randInt, tglow, useBest, useFX, useLoop, usePan } from '../utils/kit';
import { Game3D, HudPill } from '../utils/ui3d';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { project } from '../utils/openworld';

// REFLEJOS 3D – arena con muro de 9 paneles. Rondas pares: todo el escenario se pone verde, toca donde sea.
// Rondas impares: se ilumina UN panel, tócalo. Tocar antes de tiempo repite la ronda.
const ROUNDS = 5, HIT_R = 70;
const CAM = { p: [0, 3.1, 7.5], l: [0, 2.3, -4], fov: 60 };
const PANEL_X = [-2.7, 0, 2.7], PANEL_Y = [1.4, 2.9, 4.4], PANEL_Z = -7.2;
const PANELS = Array.from({ length: 9 }, (_, i) => [PANEL_X[i % 3], PANEL_Y[Math.floor(i / 3)], PANEL_Z]);
const BG_IDLE = '#0d0a18', BG_GO = '#06371b', BG_EARLY = '#3a0a14';

const GRADE = ms => (ms < 220 ? ['⚡ SOBREHUMANO', C.cyan] : ms < 280 ? ['🐆 RAPIDÍSIMO', C.lime] : ms < 340 ? ['🐇 BUEN REFLEJO', C.amber] : ms < 450 ? ['🚶 NORMAL', C.orange] : ['🐢 DESPIERTA', C.red]);

// Escenario fijo (se calcula una vez): pilares de neón a los lados y líneas del suelo
const STATIC = (() => {
  const out = [];
  for (let i = 0; i < 7; i++) out.push({ id: `lin${i}`, k: 'box', p: [0, 0.01, -1.5 - i * 2.2], s: [12, 0.02, 0.05], c: '#3a3166', e: 0.4, inst: 'linea' });
  for (let i = 0; i < 4; i++) for (const sx of [-5.2, 5.2]) out.push({ id: `pil${i}${sx}`, k: 'box', p: [sx, 2.5, -2 - 3 * i], s: [0.5, 5, 0.5], c: C.violet, e: 0.55, inst: 'pilar' });
  return out;
})();

const initState = () => ({ st: 'wait', tm: rand(1.2, 3.4), round: 0, times: [], goAt: 0, target: 0, last: 0, final: false, avg: 0, t: 0, fl: 0 });

export function ReactionTime3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('reaction', true);
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const arm = (s, r) => { s.round = r; s.st = 'wait'; s.tm = rand(1.2, 3.6); };
  const start = () => { fx.clear(); clear3d(); g.current = initState(); setPhase('play'); hx.tap(); };
  const finish = s => { hx.win(); setRes({ isNew: submitBest(s.avg), avg: s.avg }); setPhase('over'); };

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
    burst3d([0, 1.0, -1], [GRADE(ms)[1], '#ffffff'], 34, { speed: 7, up: 2, size: 0.22, life: 0.9 });
    ring3d([0, 0.9, -1], GRADE(ms)[1], 24, { speed: 6, life: 0.7 });
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
        const p = project(CAM, PANELS[s.target], SCREEN_W, SCREEN_H);
        if (!p || Math.hypot(x - p.x, y - p.y) > HIT_R) return;
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
    { id: 'suelo', k: 'pla', p: [0, 0, -6], s: [24, 30, 1], c: goGreen ? '#0f5a2c' : '#0d0a1c', e: goGreen ? 0.35 : 0.03, recv: true },
    { id: 'muro', k: 'box', p: [0, 2.6, PANEL_Z - 0.6], s: [14, 6.4, 0.4], c: '#0e0b1c', recv: true },
    ...PANELS.map((p, i) => {
      const on = goGreen || i === lit;
      return { id: `p${i}`, k: 'box', p, s: [2.0, 1.2, 0.22], c: on ? (goGreen ? '#7dff6b' : C.lime) : '#34306a', e: on ? 1 : 0.16, sh: false };
    }),
    { id: 'anillo', k: 'tor', p: [0, 0.9, -1.0], n: 1.1, c: ringC, e: 0.95 },
  ];
  const lights = [
    { p: [0, 4.2, -3], c: ringC, i: 9, d: 16 },
    { p: [0, 1.4, 3.5], c: '#ffffff', i: 3, d: 9 },
  ];
  const scene = { bg, fog: { c: bg, near: 12, far: 36 }, statics: STATIC, objs, lights, cam };

  const finalAvg = res.avg || (s.times.length ? Math.round(s.times.reduce((a, b) => a + b, 0) / s.times.length) : 0);
  const avgNow = s.times.length ? Math.round(s.times.reduce((a, b) => a + b, 0) / s.times.length) : 0;
  const stateText = s.st === 'wait' ? 'ESPERA…' : s.st === 'go' ? (targetMode ? 'TOCA EL PANEL ILUMINADO' : '¡YA!') : s.st === 'early' ? '¡DEMASIADO PRONTO!' : `${s.last} ms`;
  const stateColor = s.st === 'go' ? C.lime : s.st === 'early' ? C.red : s.st === 'result' ? GRADE(s.last)[1] : C.text;

  return (
    <Game3D title="REFLEJOS" emoji="⚡" accent={C.pink} onExit={onExit} score={phase === 'over' ? finalAvg : avgNow} scoreLabel="MEDIA (ms)" best={best || null} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene}
      hud={<><HudPill label="RONDA" value={`${Math.min(ROUNDS, s.times.length + (s.st === 'result' ? 0 : 1))}/${ROUNDS}`} color={C.pink} /><View style={{ flexDirection: 'row', gap: 4 }}>{Array.from({ length: ROUNDS }, (_, i) => <View key={i} style={{ width: 20, height: 6, borderRadius: 3, backgroundColor: i < s.times.length ? C.pink : alpha(C.pink, 0.25) }} />)}</View><HudPill label={targetMode ? 'OBJETIVO' : 'PANTALLA'} value={targetMode ? 'TOCA' : 'VERDE'} color={targetMode ? C.amber : C.lime} /></>}
      subtitle="5 rondas · mide tu tiempo de reacción"
      lines={['Pantalla verde: toca lo más rápido posible', 'Rondas alternas: toca el panel que se ilumina', 'Si tocas antes de tiempo, repites la ronda']}
      result={{ isNew: res.isNew, title: GRADE(finalAvg)[0], emoji: '⚡', subtitle: `Tus tiempos: ${s.times.join(' · ')} ms`, stats: [['MEJOR', s.times.length ? Math.min(...s.times) : 0], ['PEOR', s.times.length ? Math.max(...s.times) : 0]] }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 14, alignItems: 'center' }}>
        <Text style={{ color: stateColor, fontSize: s.st === 'result' ? 46 : 26, fontWeight: '900', letterSpacing: 2, textAlign: 'center', ...tglow(stateColor, 14) }}>{stateText}</Text>
        {s.st === 'wait' && <Text style={{ color: C.dim, fontSize: 15, marginTop: 6 }}>{targetMode ? 'Aparecerá un objetivo' : 'Toca cuando se ponga verde'}</Text>}
        {s.st === 'result' && <Text style={{ color: GRADE(s.last)[1], fontSize: 18, fontWeight: '900', marginTop: 6 }}>{GRADE(s.last)[0]}</Text>}
      </View>
    </Game3D>
  );
}
