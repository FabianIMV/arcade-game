import React, { useReducer, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, SCREEN_H, SCREEN_W, Bar, Combo, Lives, alpha, clamp, hx, pick, shuffle, tglow, useBest, useFX, useLoop, usePan, useTimeouts } from '../utils/kit';
import { Btn3D, Game3D, HudPill } from '../utils/ui3d';
import { project, rayGround } from '../utils/openworld';
import { hash01, shade } from '../utils/prefabs';
import { burst3d } from '../utils/engine3d';

// PALABRAS 3D – mesa de madera bajo una lámpara. Las letras son fichas redondas (discos 3D) en una fila;
// tócalas en orden para llenar los huecos de la palabra. Cada letra se lee como Text 2D sobre su ficha.
const ROW_Z = 2.0, SLOT_Z = -1.0, TOTAL = 10;
const CAM = { p: [0, 3.2, 10.2], l: [0, 0.2, -1.0], fov: 60 };
const COLS = [C.red, C.cyan, C.lime, C.amber, C.violet, C.pink, C.orange, C.blue];
const spc = n => Math.min(1.0, 4.4 / n);   // la fila cabe siempre en el encuadre
const tileOf = n => spc(n) * 0.9;
const rowX = (i, n) => (i - (n - 1) / 2) * spc(n);

const BANK = {
  4: [['GATO', 'Maúlla y le gusta el pescado'], ['CASA', 'Donde vives'], ['LUNA', 'Brilla de noche'], ['AGUA', 'Líquido transparente que bebes'], ['MESA', 'Comes sobre ella'], ['FLOR', 'Nace en el jardín y huele bien'], ['PATO', 'Ave que nada y hace cuac'], ['SOPA', 'Plato caliente con caldo']],
  5: [['LIBRO', 'Se lee y tiene páginas'], ['PLAYA', 'Arena y mar'], ['CIELO', 'Azul sobre tu cabeza'], ['FUEGO', 'Quema y da calor'], ['NOCHE', 'Cuando sale la luna'], ['SILLA', 'Te sientas en ella'], ['TIGRE', 'Felino con rayas'], ['RELOJ', 'Marca la hora'], ['PIZZA', 'Redonda, con queso'], ['CARRO', 'Vehículo de cuatro ruedas']],
  6: [['PUERTA', 'Se abre para entrar'], ['BOSQUE', 'Muchos árboles juntos'], ['CAMINO', 'Por donde caminas'], ['COCINA', 'Donde se prepara la comida'], ['DELFÍN', 'Mamífero marino muy listo'], ['CAMISA', 'Prenda con botones'], ['ÁRBOLES', 'Tienen tronco y hojas']],
  7: [['PLANETA', 'Tierra, Marte o Venus'], ['VENTANA', 'Entra luz por ella'], ['ESCUELA', 'Donde estudias'], ['JUGUETE', 'Con él juegan los niños'], ['TORTUGA', 'Lenta, con caparazón'], ['MONTAÑA', 'Más alta que una colina'], ['CUCHARA', 'Sirve para tomar sopa']],
  8: [['ELEFANTE', 'Gran animal con trompa'], ['MARIPOSA', 'Insecto con alas de colores'], ['GUITARRA', 'Instrumento de seis cuerdas'], ['ESTRELLA', 'Brilla en el cielo nocturno'], ['TELÉFONO', 'Sirve para llamar'], ['AVENTURA', 'Viaje lleno de emoción']],
};

// Mesa y escenario: tablas de madera (instancing con tono propio), pared de fondo y lámparas colgantes. Se calcula una vez.
const STATIC = (() => {
  const out = [];
  for (let z = -10; z <= 8; z += 1) out.push({ id: `tb${z}`, k: 'box', p: [0, -0.2, z + 0.5], s: [18, 0.4, 0.96], c: shade('#5a3519', 0.85 + hash01(z) * 0.3), recv: true, inst: 'tabla' });
  out.push({ id: 'pared', k: 'box', p: [0, 4, -12], s: [30, 12, 0.6], c: '#120820', recv: true });
  out.push({ id: 'franja', k: 'box', p: [0, 1.6, -11.6], s: [30, 0.12, 0.1], c: C.violet, e: 1 });
  for (const x of [-4.6, 4.6]) {
    out.push({ id: `cable${x}`, k: 'cyl', p: [x, 6.6, -1], s: [0.05, 2.4, 0.05], c: '#1a1430' });
    out.push({ id: `cono${x}`, k: 'cone', p: [x, 5.3, -1], s: [1.3, 0.9, 1.3], c: x < 0 ? C.violet : C.amber, e: 0.25 });
    out.push({ id: `bom${x}`, k: 'sph', p: [x, 4.9, -1], n: 0.45, c: x < 0 ? '#e0ccff' : '#fff1c2', e: 1 });
  }
  return out;
})();

const mkWord = idx => {
  const len = idx < 2 ? 4 : idx < 5 ? 5 : idx < 7 ? 6 : idx < 9 ? 7 : 8;
  const [w, hint] = pick(BANK[len]);
  let letters = shuffle(w.split(''));
  if (letters.join('') === w) letters = letters.reverse();
  const n = letters.length;
  return { word: w, hint, tiles: letters.map((l, i) => ({ id: i, l, used: false, x: rowX(i, n), z: ROW_Z })), slots: [], limit: 22 + w.length * 3, t: 0, revealed: 0, lock: false, bad: 0 };
};
// Posición destino de cada ficha: en la fila (si libre) o en su hueco (si está colocada). Se deslizan hacia ella.
const targetOf = (c, t) => {
  const si = t.used ? c.slots.indexOf(t.id) : -1;
  if (si >= 0) return [rowX(si, c.word.length), SLOT_Z];
  return [rowX(c.tiles.indexOf(t), c.tiles.length), ROW_Z];
};
const letterOf = (c, id) => c.tiles.find(t => t.id === id).l;
const glide = (c, dt) => c.tiles.forEach(t => {
  const [tx, tz] = targetOf(c, t); const k = Math.min(1, dt * 12);
  t.x += (tx - t.x) * k; t.z += (tz - t.z) * k;
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
        const w = it.w || 200;
        return (
          <Text key={it.key} pointerEvents="none" numberOfLines={1} style={{ position: 'absolute', left: q.x - w / 2 - org.x, top: q.y - fs * 0.6 - org.y, width: w, textAlign: 'center', color: it.color, fontSize: fs, fontWeight: '900', ...tglow(it.glow || 'transparent', 6) }}>{it.text}</Text>
        );
      })}
    </View>
  );
}

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
  const start = () => { fx.clear(); g.current = init(); setPhase('play'); hx.tap(); };
  const nextWord = s => {
    s.idx += 1;
    if (s.idx >= TOTAL) { hx.win(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); return; }
    s.cur = mkWord(s.idx); force();
  };
  const lose = s => {
    s.lives -= 1; s.streak = 0; hx.bad(); fx.shake(6, 0.25); fx.flash(C.red, 0.2);
    fx.pop(SCREEN_W / 2, SCREEN_H * 0.3, `Era: ${s.cur.word}`, C.red, 18);
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
      burst3d([0, 0.6, SLOT_Z], [C.lime, '#ffffff', C.cyan], 40, { speed: 5, up: 3, size: 0.2, life: 1.0 });
      fx.burst(SCREEN_W / 2, SCREEN_H * 0.45, C.lime, 24, 260); fx.pop(SCREEN_W / 2, SCREEN_H * 0.36, `+${Math.max(10, pts)}`, C.lime, 24); hx.good(); force();
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
    if (c.t >= c.limit) { fx.pop(SCREEN_W / 2, SCREEN_H * 0.5, '¡TIEMPO!', C.red, 22); lose(s); }
  });
  const tapTile = id => {
    const c = g.current.cur;
    const t = c.tiles.find(tt => tt.id === id);
    if (phase !== 'play' || c.lock || c.bad > 0 || !t || t.used) return;
    t.used = true; c.slots.push(id); hx.tick();
    if (c.slots.length === c.word.length) check(g.current);
    force();
  };
  const tapSlot = k => {
    const c = g.current.cur;
    if (phase !== 'play' || c.lock || c.bad > 0) return;
    const id = c.slots[k]; if (id == null) return;
    c.tiles.find(t => t.id === id).used = false; c.slots.splice(k, 1); hx.tick(); force();
  };
  const reveal = () => {
    const s = g.current; const c = s.cur;
    if (phase !== 'play' || c.lock) return;
    // devolver todo y colocar la siguiente letra correcta
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
      const c = g.current.cur;
      if (phase !== 'play' || c.lock) return;
      const hit = rayGround(CAM, x, y, SCREEN_W, SCREEN_H, 0.3); // a media altura de la ficha
      if (!hit) return;
      const [wx, , wz] = hit; const R = tileOf(c.word.length) / 2 + 0.2;
      const row = c.tiles.find(t => !t.used && Math.abs(wx - t.x) < R && Math.abs(wz - t.z) < R);
      if (row) { tapTile(row.id); return; }
      const k = c.slots.findIndex((id, si) => Math.abs(wx - rowX(si, c.word.length)) < R && Math.abs(wz - SLOT_Z) < R);
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
    ...Array.from({ length: len }, (_, k) => {
      const filled = c.slots[k] != null;
      const col = c.bad > 0 && filled ? C.red : ok ? C.lime : '#2a1d4f';
      return { id: `hueco${k}`, k: 'cyl', p: [rowX(k, len), 0.03, SLOT_Z], s: [tileOf(len) * 1.08, 0.06, tileOf(len) * 1.08], c: col, e: filled ? 0.5 : 0.08, recv: true };
    }),
    ...c.tiles.map(t => {
      const lift = t.used ? 0.14 : 0;
      return { id: `ficha${t.id}`, k: 'cyl', p: [t.x, 0.22 + lift, t.z], s: [tileOf(len) * 0.94, 0.4 + lift, tileOf(len) * 0.94], c: tileCol(t), e: t.used ? 0.45 : 0.18, sh: true, m: { r: 0.3, m: 0.1 } };
    }),
  ];
  const lights = [{ p: [-4, 5, 0], c: '#b98bff', i: 12, d: 16 }, { p: [4, 5, 0], c: '#ffc233', i: 12, d: 16 }];
  const scene = { bg: '#0a0616', fog: { c: '#0a0616', near: 18, far: 42 }, shadowR: 16, statics: STATIC, objs, lights, cam: CAM };

  const labels = c.tiles.map(t => ({
    key: `t${t.id}`, p: [t.x, (t.used ? 0.55 : 0.42) + 0.02, t.z], text: t.l, color: t.used ? C.text : '#07040f', u: 0.62, min: 14, max: 36, w: 60,
  }));
  return (
    <Game3D title="PALABRAS" emoji="🔤" accent={C.violet} onExit={onExit} score={s.score} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene}
      hud={<><Lives n={s.lives} max={3} /><HudPill label="PALABRA" value={`${Math.min(TOTAL, s.idx + 1)}/${TOTAL}`} color={C.violet} />{s.streak > 1 ? <Combo n={s.streak} color={C.violet} /> : null}</>}
      subtitle="Ordena las letras de 10 palabras"
      lines={['Toca las fichas en orden · toca un hueco para quitarla', 'Cada palabra tiene un tiempo límite', 'Resolver rápido y en racha da más puntos']}
      result={{ won: s.idx >= TOTAL, isNew: res.isNew, title: s.idx >= TOTAL ? '¡COMPLETADO!' : 'FIN DEL JUEGO', emoji: s.idx >= TOTAL ? '🏆' : '🔤', subtitle: `${s.solved} de ${TOTAL} palabras resueltas`, stats: [['RESUELTAS', s.solved], ['RACHA', s.streak], ['VIDAS', s.lives]] }}>
      <Labels3D cam={CAM} items={labels} />
      <Bar value={c.limit - c.t} max={c.limit} color={c.t / c.limit > 0.75 ? C.red : C.violet} h={10} style={{ position: 'absolute', top: 6, left: 18, right: 18 }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: 26, left: 0, right: 0, alignItems: 'center' }}>
        <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', textAlign: 'center', paddingHorizontal: 20, ...tglow(C.violet, 8) }}>💡 {c.hint}</Text>
        <Text style={{ color: alpha(C.violet, 0.9), fontSize: 12, fontWeight: '900', letterSpacing: 2, marginTop: 4 }}>{len} LETRAS</Text>
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 26, flexDirection: 'row', justifyContent: 'center', gap: 14 }}>
        <Btn3D testID="ws-shuffle" size="sm" ghost color={C.violet} label="MEZCLAR" icon="🔀" onPress={shuffleTiles} />
        <Btn3D testID="ws-reveal" size="sm" ghost color={C.amber} label="LETRA (-20)" icon="💡" onPress={reveal} />
      </View>
    </Game3D>
  );
}
