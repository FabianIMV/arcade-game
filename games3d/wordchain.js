import React, { useReducer, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, Bar, Combo, GameScreen, Lives, Overlay, PlayArea, alpha, hx, pick, randInt, shuffle, tglow, uid, useBest, useFX, useLoop, usePan, useTimeouts } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Pasillo 3D: las palabras de la cadena son hileras de bloques (una letra = un bloque) que fluyen hacia la cámara.
// Las opciones son losetas en el suelo delante de la cadena. Cámara fija detrás de la cabeza de la cadena.
const FOV = 68, CORR_W = 7.5;
const CAM = { p: [0, 3.6, 6.8], l: [0, 0.2, -6], fov: FOV };
const PAD_Z = -0.2, PAD_TOP = 0.32, PAD_W = 1.3, PAD_D = 1.1, LANE = 1.5;
const SP = 1.0, GAP = 1.2, START_Z = PAD_Z + 1.4, MAX_BLOCKS = 12;
const padX = (i, n) => (i - (n - 1) / 2) * LANE;

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
const lbl = (sx, sy, w = 120) => ({ position: 'absolute', left: sx - w / 2, top: sy - 10, width: w, textAlign: 'center' });

const WORDS = ['árbol', 'avión', 'abeja', 'agua', 'anillo', 'araña', 'ardilla', 'arroz', 'azúcar', 'almohada', 'amigo', 'abuelo', 'aceite', 'águila', 'alfombra', 'barco', 'bosque', 'botella', 'burro', 'banana', 'balón', 'bruja', 'bufanda', 'bicicleta', 'botón', 'brazo', 'casa', 'camino', 'caballo', 'cielo', 'campana', 'coche', 'cuchara', 'corazón', 'cohete', 'castillo', 'cebolla', 'camisa', 'cocina', 'conejo', 'dado', 'dragón', 'dedo', 'diamante', 'delfín', 'dinero', 'doctor', 'dulce', 'duende', 'escuela', 'estrella', 'elefante', 'espejo', 'escalera', 'edificio', 'entrada', 'esfera', 'espada', 'error', 'flor', 'fuego', 'foca', 'fruta', 'farol', 'fantasma', 'feria', 'familia', 'fiesta', 'gato', 'globo', 'guitarra', 'gusano', 'gigante', 'galleta', 'gorila', 'guante', 'hormiga', 'huevo', 'hoja', 'helado', 'hongo', 'hamaca', 'hielo', 'hermano', 'hotel', 'isla', 'iglesia', 'imán', 'invierno', 'iguana', 'idea', 'insecto', 'jirafa', 'jardín', 'jugo', 'jabón', 'jaula', 'joya', 'juego', 'koala', 'kiwi', 'luna', 'libro', 'león', 'lápiz', 'lago', 'lluvia', 'lobo', 'limón', 'luz', 'lámpara', 'mesa', 'mano', 'mar', 'mariposa', 'montaña', 'manzana', 'martillo', 'mundo', 'mono', 'moneda', 'museo', 'nube', 'naranja', 'nariz', 'noche', 'nido', 'nieve', 'nave', 'nuez', 'oso', 'oro', 'ola', 'ojo', 'oveja', 'orquesta', 'océano', 'olla', 'otoño', 'perro', 'pan', 'pelota', 'playa', 'planeta', 'puerta', 'pájaro', 'pato', 'piedra', 'payaso', 'pizza', 'pulpo', 'peine', 'queso', 'rana', 'reloj', 'rayo', 'río', 'rosa', 'ratón', 'robot', 'rueda', 'ropa', 'regalo', 'sol', 'silla', 'sapo', 'semilla', 'serpiente', 'sombrero', 'sandía', 'selva', 'sopa', 'tren', 'tigre', 'torre', 'tortuga', 'taza', 'tambor', 'tomate', 'techo', 'tijeras', 'tesoro', 'uva', 'unicornio', 'universo', 'vaca', 'volcán', 'viento', 'ventana', 'vaso', 'verano', 'violín', 'valle', 'vela', 'xilófono', 'yate', 'yoga', 'yema', 'yogur', 'zapato', 'zorro', 'zanahoria', 'zebra', 'zona'];
const norm = w => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const first = w => norm(w)[0];
const lastL = w => { const n = norm(w); return n[n.length - 1]; };
const hueOf = i => `hsl(${(i * 47 + 100) % 360},85%,60%)`;

// Cada palabra aceptada es un tramo de bloques en el pasillo; las anteriores retroceden hacia la cámara.
const addWord = (s, w) => {
  const D = w.length * SP + GAP;
  s.blocks.forEach(b => { b.base += D; });
  s.blocks.push({ w, L: w.length, base: START_Z, id: uid(), col: hueOf(s.words.length) });
  if (s.blocks.length > MAX_BLOCKS) s.blocks.shift();
  s.words.push(w); s.used.add(w);
};
const nextRound = s => {
  const need = lastL(s.words[s.words.length - 1]);
  const unused = WORDS.filter(w => !s.used.has(w));
  const follow = w => unused.some(x => x !== w && first(x) === lastL(w));
  const good = shuffle(unused.filter(w => first(w) === need && follow(w))).slice(0, randInt(1, 2));
  if (!good.length) return false; // callejón sin salida: el jugador gana la cadena
  const decoys = shuffle(unused.filter(w => first(w) !== need)).slice(0, 4 - good.length);
  s.opts = shuffle([...good, ...decoys].map(w => ({ w, ok: first(w) === need })));
  s.need = need; s.limit = Math.max(2.6, 7 - s.words.length * 0.12); s.t = 0; s.lock = false; s.pick = null;
  return true;
};
const initState = () => {
  const s = { blocks: [], words: [], used: new Set(), opts: [], need: '', score: 0, lives: 3, streak: 0, t: 0, limit: 7, lock: false, pick: null };
  const w = pick(WORDS); addWord(s, w); nextRound(s);
  return s;
};

export function WordChain3D({ onExit }) {
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('wordchain');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); };
  const finish = s => { hx.die(); setRes({ isNew: submitBest(s.score) }); setPhase('over'); };
  // añade la palabra a la cadena y prepara la siguiente ronda; false = la cadena se queda sin salida
  const advance = (s, w) => {
    addWord(s, w);
    if (nextRound(s)) return true;
    hx.win(); setRes({ isNew: submitBest(s.score), won: true }); setPhase('over');
    return false;
  };
  const choose = o => {
    const s = g.current;
    if (phase !== 'play' || s.lock) return;
    s.lock = true; s.pick = o.w;
    if (o.ok) {
      s.streak += 1;
      const pts = 10 + Math.round((1 - s.t / s.limit) * 10) + Math.min(20, s.streak * 2); s.score += pts;
      fx.burst(AREA_W / 2, AREA_H * 0.6, C.lime, 14, 200); fx.pop(AREA_W / 2, AREA_H * 0.5, `+${pts}`, C.lime, 22); hx.good(); force();
      later(() => { if (g.current === s) { advance(s, o.w); force(); } }, 450);
    } else {
      s.lives -= 1; s.streak = 0; fx.shake(7, 0.25); fx.flash(C.red, 0.25); hx.bad(); force();
      if (s.lives <= 0) later(() => { if (g.current === s) finish(s); }, 800);
      else later(() => { if (g.current === s) { advance(s, s.opts.find(x => x.ok).w); force(); } }, 900);
    }
  };
  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (s.lock) return;
    s.t += dt;
    if (s.t >= s.limit) {
      s.lock = true; s.lives -= 1; s.streak = 0; fx.shake(7, 0.25); fx.flash(C.red, 0.25); fx.pop(AREA_W / 2, AREA_H * 0.5, '¡TIEMPO!', C.red, 22); hx.bad();
      if (s.lives <= 0) later(() => { if (g.current === s) finish(s); }, 800);
      else later(() => { if (g.current === s) { advance(s, s.opts.find(x => x.ok).w); force(); } }, 900);
    }
  });
  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current; if (phase !== 'play' || s.lock) return;
      const [wx, , wz] = RIG.onY(x, y, PAD_TOP);
      const i = s.opts.findIndex((o, k) => Math.abs(wx - padX(k, s.opts.length)) < PAD_W / 2 && Math.abs(wz - PAD_Z) < PAD_D / 2);
      if (i >= 0) choose(s.opts[i]);
    },
  });

  const s = g.current;
  const n = s.opts.length;
  const objs = [
    { id: 'suelo', k: 'pla', p: [0, 0, -14], s: [CORR_W, 70, 1], c: '#06140c' },
    { id: 'pared-i', k: 'box', p: [-CORR_W / 2 - 0.2, 0.6, -14], s: [0.4, 1.2, 70], c: C.lime, e: 0.4 },
    { id: 'pared-d', k: 'box', p: [CORR_W / 2 + 0.2, 0.6, -14], s: [0.4, 1.2, 70], c: C.lime, e: 0.4 },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `st${i}`, k: 'box', p: [0, 0.01, 6 - i * 1.5], s: [CORR_W, 0.02, 0.08], c: '#1f5c36', e: 0.25 })),
    ...s.blocks.flatMap(b => Array.from({ length: b.L }, (_, j) => {
      const last = b === s.blocks[s.blocks.length - 1];
      return { id: `b${b.id}_${j}`, k: 'box', p: [0, 0.2, b.base + j * SP], s: [0.75, 0.4, 0.8], c: b.col, e: last ? 0.6 : 0.2 };
    })),
    ...s.opts.map((o, i) => {
      const col = s.pick === o.w ? (o.ok ? C.lime : C.red) : s.lock && o.ok ? C.lime : C.cyan;
      return { id: `pad${i}`, k: 'box', p: [padX(i, n), PAD_TOP / 2, PAD_Z], s: [PAD_W, PAD_TOP, PAD_D], c: col, e: 0.45 };
    }),
  ];
  const scene = { bg: '#030a06', fog: { c: '#030a06', near: 9, far: 30 }, objs, cam: CAM };
  const newest = s.blocks[s.blocks.length - 1];
  const recent = s.blocks.slice(-3);
  return (
    <GameScreen title="WORD CHAIN" emoji="🔗" accent={C.lime} onExit={onExit} score={s.score} best={best}
      hud={<><Lives n={s.lives} max={3} /><Text style={{ color: C.dim, fontSize: 12 }}>Cadena <Text style={{ color: C.lime, fontWeight: '800' }}>{s.words.length}</Text></Text><View style={{ minWidth: 70, alignItems: 'flex-end' }}>{s.streak > 2 ? <Combo n={s.streak} color={C.lime} /> : null}</View></>}>
      <PlayArea fx={fx} bg="#04100a" border={alpha(C.lime, 0.4)} {...pan}>
        <World3D scene={scene} />
        <Bar value={s.limit - s.t} max={s.limit} color={s.t / s.limit > 0.7 ? C.red : C.lime} h={10} style={{ position: 'absolute', top: 18, left: 18, right: 18 }} />
        <Text pointerEvents="none" style={{ position: 'absolute', top: 36, width: AREA_W, textAlign: 'center', color: C.lime, fontSize: 30, fontWeight: '900', letterSpacing: 1, ...tglow(C.lime, 12) }}>{newest ? newest.w : ''}</Text>
        <Text pointerEvents="none" style={{ position: 'absolute', top: 78, width: AREA_W, textAlign: 'center', color: C.dim, fontSize: 14 }}>Elige una palabra que empiece con</Text>
        <Text pointerEvents="none" style={{ position: 'absolute', top: 96, width: AREA_W, textAlign: 'center', color: C.amber, fontSize: 50, fontWeight: '900', ...tglow(C.amber, 14) }}>{s.need.toUpperCase()}</Text>
        {recent.slice(0, -1).map(b => {
          const p = RIG.toScreen(0, 0.8, b.base + ((b.L - 1) * SP) / 2);
          return <Text key={b.id} pointerEvents="none" style={{ ...lbl(p.x, p.y, 120), color: alpha(C.dim, 0.7), fontSize: 13, fontWeight: '700' }}>{b.w}</Text>;
        })}
        {s.opts.map((o, i) => {
          const p = RIG.toScreen(padX(i, n), PAD_TOP + 0.05, PAD_Z);
          return <Text key={o.w} pointerEvents="none" style={{ ...lbl(p.x, p.y, 96), color: C.text, fontSize: 13, fontWeight: '800' }}>{o.w}</Text>;
        })}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🔗" title={phase === 'over' ? (res.won ? '¡CADENA PERFECTA!' : 'SE ROMPIÓ LA CADENA') : 'WORD CHAIN 3D'}
          subtitle={phase === 'over' ? `Cadena de ${s.words.length} palabras` : 'Cada palabra empieza con la última letra de la anterior'}
          score={s.score} best={best} isNew={res.isNew} accent={C.lime} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Toca la palabra que empiece con la letra indicada', 'Cada palabra aceptada se añade al pasillo de letras', 'Vista en tercera persona: la cadena avanza hacia ti'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
