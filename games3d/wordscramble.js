import React, { useReducer, useRef, useState } from 'react';
import { Text } from 'react-native';
import { AREA_H, AREA_W, C, Btn, GameScreen, Lives, Combo, Overlay, PlayArea, alpha, hx, pick, shuffle, tglow, useBest, useFX, useLoop, usePan, useTimeouts, Bar } from '../utils/kit';
import { World3D } from '../utils/World3D';
import { View } from 'react-native';

// Mesa 3D: las fichas de letra están en una fila delante de la cámara (tercera persona, a ras de mesa)
// y al tocarlas se deslizan a los huecos de la palabra. Las letras se leen como Text 2D sobre cada ficha.
const FOV = 60, ROW_Z = 2.0, SLOT_Z = -1.0, TOP = 0.42;
const CAM = { p: [0, 3.4, 12.6], l: [0, 0.2, -1.0], fov: FOV };
const COLS = [C.red, C.cyan, C.lime, C.amber, C.violet, C.pink, C.orange, C.blue];

// Proyección de la cámara fija: 3D → píxeles del área (para Text 2D) y picking sobre un plano.
const camRig = cam => {
  const th = Math.tan((cam.fov * Math.PI) / 360);
  const [ex, ey, ez] = cam.p;
  let fx = cam.l[0] - ex, fy = cam.l[1] - ey, fz = cam.l[2] - ez;
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const K = (AREA_H / 2) / th;
  const toScreen = (x, y, z) => {
    const dx = x - ex, dy = y - ey, dz = z - ez;
    const zc = dx * fx + dy * fy + dz * fz;
    const xc = dx * rx + dz * rz, yc = dx * ux + dy * uy + dz * uz;
    const k = K / zc;
    return { x: AREA_W / 2 + xc * k, y: AREA_H / 2 - yc * k, s: k };
  };
  const ray = (sx, sy) => {
    const a = ((sx - AREA_W / 2) / (AREA_H / 2)) * th, b = -((sy - AREA_H / 2) / (AREA_H / 2)) * th;
    return [fx + rx * a + ux * b, fy + uy * b, fz + rz * a + uz * b];
  };
  const onY = (sx, sy, h) => { const d = ray(sx, sy); const t = (h - ey) / d[1]; return [ex + d[0] * t, h, ez + d[2] * t]; };
  return { toScreen, onY };
};
const RIG = camRig(CAM);
// separación y tamaño de las fichas según nº de letras: palabras cortas = fichas más grandes
const spc = n => Math.min(1.25, 6.4 / n);
const tileOf = n => spc(n) * 0.9;
const rowX = (i, n) => (i - (n - 1) / 2) * spc(n);

const BANK = {
  4: [['GATO', 'Maúlla y le gusta el pescado'], ['CASA', 'Donde vives'], ['LUNA', 'Brilla de noche'], ['AGUA', 'Líquido transparente que bebes'], ['MESA', 'Comes sobre ella'], ['FLOR', 'Nace en el jardín y huele bien'], ['PATO', 'Ave que nada y hace cuac'], ['SOPA', 'Plato caliente con caldo']],
  5: [['LIBRO', 'Se lee y tiene páginas'], ['PLAYA', 'Arena y mar'], ['CIELO', 'Azul sobre tu cabeza'], ['FUEGO', 'Quema y da calor'], ['NOCHE', 'Cuando sale la luna'], ['SILLA', 'Te sientas en ella'], ['TIGRE', 'Felino con rayas'], ['RELOJ', 'Marca la hora'], ['PIZZA', 'Redonda, con queso'], ['CARRO', 'Vehículo de cuatro ruedas']],
  6: [['PUERTA', 'Se abre para entrar'], ['BOSQUE', 'Muchos árboles juntos'], ['CAMINO', 'Por donde caminas'], ['COCINA', 'Donde se prepara la comida'], ['DELFÍN', 'Mamífero marino muy listo'], ['CAMISA', 'Prenda con botones'], ['ÁRBOLES', 'Tienen tronco y hojas']],
  7: [['PLANETA', 'Tierra, Marte o Venus'], ['VENTANA', 'Entra luz por ella'], ['ESCUELA', 'Donde estudias'], ['JUGUETE', 'Con él juegan los niños'], ['TORTUGA', 'Lenta, con caparazón'], ['MONTAÑA', 'Más alta que una colina'], ['CUCHARA', 'Sirve para tomar sopa']],
  8: [['ELEFANTE', 'Gran animal con trompa'], ['MARIPOSA', 'Insecto con alas de colores'], ['GUITARRA', 'Instrumento de seis cuerdas'], ['ESTRELLA', 'Brilla en el cielo nocturno'], ['TELÉFONO', 'Sirve para llamar'], ['AVENTURA', 'Viaje lleno de emoción']],
};
const TOTAL = 10;

// Posición de destino de cada ficha: en la fila (si libre) o en su hueco (si está colocada).
const targetOf = (c, t) => {
  const si = t.used ? c.slots.indexOf(t.id) : -1;
  if (si >= 0) return [rowX(si, c.word.length), SLOT_Z];
  return [rowX(c.tiles.indexOf(t), c.tiles.length), ROW_Z];
};
const letterOf = (c, id) => c.tiles.find(t => t.id === id).l;

const mkWord = idx => {
  const len = idx < 2 ? 4 : idx < 5 ? 5 : idx < 7 ? 6 : idx < 9 ? 7 : 8;
  const [w, hint] = pick(BANK[len]);
  let letters = shuffle(w.split(''));
  if (letters.join('') === w) letters = letters.reverse();
  const n = letters.length;
  return { word: w, hint, tiles: letters.map((l, i) => ({ id: i, l, used: false, x: rowX(i, n), z: ROW_Z })), slots: [], limit: 22 + w.length * 3, t: 0, revealed: 0, lock: false, bad: 0 };
};
// las fichas se deslizan hacia su destino
const glide = (c, dt) => c.tiles.forEach(t => {
  const [tx, tz] = targetOf(c, t); const k = Math.min(1, dt * 12);
  t.x += (tx - t.x) * k; t.z += (tz - t.z) * k;
});

export function WordScramble3D({ onExit }) {
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('wordscramble');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);
  const init = () => ({ idx: 0, score: 0, lives: 3, streak: 0, cur: mkWord(0), solved: 0 });
  if (!g.current) g.current = init();
  const start = () => { fx.clear(); g.current = init(); setPhase('play'); };
  const nextWord = s => {
    s.idx += 1;
    if (s.idx >= TOTAL) { hx.win(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
    s.cur = mkWord(s.idx); force();
  };
  const lose = (s, why) => {
    s.lives -= 1; s.streak = 0; hx.bad(); fx.shake(6, 0.25); fx.flash(C.red, 0.2);
    fx.pop(AREA_W / 2, AREA_H * 0.3, `Era: ${s.cur.word}`, C.red, 18);
    s.cur.lock = true; force();
    if (s.lives <= 0) { later(() => { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); }, 900); return; }
    later(() => nextWord(s), 1000);
  };
  const check = s => {
    const c = s.cur;
    const guess = c.slots.map(id => letterOf(c, id)).join('');
    if (guess === c.word) {
      const pts = 50 + Math.max(0, Math.round(c.limit - c.t)) * 3 + s.streak * 10 - c.revealed * 20;
      s.score += Math.max(10, pts); s.streak += 1; s.solved += 1; c.lock = true;
      fx.burst(AREA_W / 2, AREA_H * 0.45, C.lime, 24, 260); fx.pop(AREA_W / 2, AREA_H * 0.36, `+${Math.max(10, pts)}`, C.lime, 24); hx.good(); force();
      later(() => nextWord(s), 800);
    } else {
      c.bad = 0.4; s.streak = 0; hx.bad(); fx.shake(5, 0.2);
      later(() => { c.tiles.forEach(t => { t.used = false; }); c.slots = []; force(); }, 350);
    }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current; const c = s.cur;
    glide(c, dt);
    if (c.lock) return;
    c.t += dt; if (c.bad > 0) c.bad -= dt;
    if (c.t >= c.limit) lose(s, 'tiempo');
  });
  const tapTile = id => {
    const s = g.current; const c = s.cur;
    const t = c.tiles.find(tt => tt.id === id);
    if (phase !== 'play' || c.lock || c.bad > 0 || !t || t.used) return;
    t.used = true; c.slots.push(id); hx.tick();
    if (c.slots.length === c.word.length) check(s);
    force();
  };
  const tapSlot = k => {
    const s = g.current; const c = s.cur;
    if (phase !== 'play' || c.lock || c.bad > 0) return;
    const id = c.slots[k]; if (id == null) return;
    c.tiles.find(t => t.id === id).used = false; c.slots.splice(k, 1); hx.tick(); force();
  };
  const reveal = () => {
    const s = g.current; const c = s.cur;
    if (phase !== 'play' || c.lock) return;
    // devolver todo y poner la siguiente letra correcta
    c.tiles.forEach(t => { t.used = false; }); c.slots = [];
    c.revealed += 1;
    for (let k = 0; k < c.revealed && k < c.word.length; k++) {
      const t = c.tiles.find(tt => !tt.used && tt.l === c.word[k]); if (t) { t.used = true; c.slots.push(t.id); }
    }
    hx.hit(); force();
  };
  const shuffleTiles = () => { const c = g.current.cur; if (c.lock) return; c.tiles = shuffle(c.tiles); hx.tick(); force(); };
  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current; const c = s.cur;
      if (phase !== 'play' || c.lock) return;
      const [wx, , wz] = RIG.onY(x, y, 0.2); // a media altura de la ficha: el dedo cae sobre la cara visible
      const row = c.tiles.find(t => !t.used && Math.abs(wx - t.x) < tileOf(c.word.length) / 2 + 0.25 && Math.abs(wz - t.z) < tileOf(c.word.length) / 2 + 0.25);
      if (row) { tapTile(row.id); return; }
      const k = c.slots.findIndex((id, si) => Math.abs(wx - rowX(si, c.word.length)) < tileOf(c.word.length) / 2 + 0.25 && Math.abs(wz - SLOT_Z) < tileOf(c.word.length) / 2 + 0.25);
      if (k >= 0) tapSlot(k);
    },
  });

  const s = g.current; const c = s.cur;
  const len = c.word.length;
  const ok = c.lock && c.slots.length === len && c.slots.map(id => letterOf(c, id)).join('') === c.word;
  const tileCol = t => {
    if (!t.used) return COLS[t.id % COLS.length];
    return c.bad > 0 ? C.red : ok ? C.lime : C.violet;
  };
  const objs = [
    { id: 'mesa', k: 'pla', p: [0, 0, -1], s: [12, 14, 1], c: '#2b1b10' },
    ...Array.from({ length: len }, (_, k) => ({
      id: `hueco${k}`, k: 'box', p: [rowX(k, len), 0.03, SLOT_Z], s: [tileOf(len), 0.06, tileOf(len)],
      c: c.bad > 0 && c.slots[k] != null ? C.red : '#3b2a6b', e: c.slots[k] != null ? 0.3 : 0.05,
    })),
    ...c.tiles.map(t => ({
      id: `ficha${t.id}`, k: 'box', p: [t.x, t.used ? 0.26 : 0.22, t.z], s: [tileOf(len), 0.4, tileOf(len)], c: tileCol(t), e: t.used ? 0.35 : 0.2,
    })),
  ];
  const scene = { bg: '#0a0616', fog: { c: '#0a0616', near: 16, far: 34 }, objs, cam: CAM };
  return (
    <GameScreen title="PALABRAS" emoji="🔤" accent={C.violet} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.dim, fontSize: 12 }}>Palabra <Text style={{ color: C.violet, fontWeight: '800' }}>{Math.min(TOTAL, s.idx + 1)}/{TOTAL}</Text></Text><View style={{ minWidth: 70, alignItems: 'flex-end' }}>{s.streak > 1 ? <Combo n={s.streak} color={C.violet} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#0a0616" border={alpha(C.violet, 0.4)} {...pan}>
        <World3D scene={scene} />
        <Bar value={c.limit - c.t} max={c.limit} color={c.t / c.limit > 0.75 ? C.red : C.violet} h={10} style={{ position: 'absolute', top: 18, left: 18, right: 18 }} />
        <Text pointerEvents="none" style={{ position: 'absolute', top: 36, width: AREA_W, textAlign: 'center', color: C.dim, fontSize: 14, lineHeight: 20 }}>💡 {c.hint}</Text>
        <Text pointerEvents="none" style={{ position: 'absolute', top: 74, width: AREA_W, textAlign: 'center', color: alpha(C.violet, 0.9), fontSize: 12, fontWeight: '800', letterSpacing: 2 }}>{len} LETRAS</Text>
        {c.tiles.map(t => {
          const p = RIG.toScreen(t.x, TOP + 0.06, t.z);
          const fs = Math.max(12, Math.min(30, Math.round(p.s * 0.5)));
          return <Text key={t.id} pointerEvents="none" style={{ position: 'absolute', left: p.x - 30, top: p.y - fs * 0.6, width: 60, textAlign: 'center', color: t.used ? C.text : '#07040f', fontSize: fs, fontWeight: '900' }}>{t.l}</Text>;
        })}
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 22, flexDirection: 'row', justifyContent: 'center', gap: 14 }}>
          <Btn label="🔀 MEZCLAR" small ghost color={C.violet} onPress={shuffleTiles} />
          <Btn label="💡 LETRA (-20)" small ghost color={C.amber} onPress={reveal} />
        </View>
        <Overlay show={phase !== 'play'} kind={phase} emoji="🔤" title={phase === 'over' ? (s.idx >= TOTAL ? '¡COMPLETADO!' : 'FIN DEL JUEGO') : 'PALABRAS 3D'}
          subtitle={phase === 'over' ? `${s.solved} de ${TOTAL} palabras resueltas` : 'Ordena las letras de 10 palabras'}
          score={s.score} best={best} isNew={res.isNew} accent={C.violet} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca las fichas en orden · toca un hueco para quitarla', 'Cada palabra tiene un tiempo límite', 'Resolver rápido y en racha da más puntos'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
