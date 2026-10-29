import React, { useReducer, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { C, SCREEN_H, SCREEN_W, Bar, Combo, Lives, clamp, hx, pick, randInt, shuffle, tglow, uid, useBest, useFX, useLoop, usePan, useTimeouts } from '../utils/kit';
import { Game3D, HudPill } from '../utils/ui3d';
import { burst3d } from '../utils/engine3d';
import { shade } from '../utils/prefabs';
import { project, rayGround } from '../utils/openworld';

// WORD CHAIN 3D – pasillo de neón. Cada palabra aceptada es una hilera de bloques (una letra = un bloque)
// que se aleja hacia el fondo; la cadena avanza hacia la cámara. Las opciones son losetas en el suelo.
const CORR_W = 7.5, PAD_Z = -0.2, PAD_TOP = 0.32, PAD_W = 1.2, PAD_D = 1.1, LANE = 1.22;
const SP = 1.0, GAP = 1.2, START_Z = PAD_Z + 1.4, MAX_BLOCKS = 12;
const CAM = { p: [0, 3.6, 6.8], l: [0, 0.2, -6], fov: 68 };
const padX = (i, n) => (i - (n - 1) / 2) * LANE;

// Pasillo, arcos y pilares: se calculan una vez (statics + instancing)
const STATIC = (() => {
  const out = [{ id: 'suelo', k: 'pla', p: [0, 0, -30], s: [CORR_W, 90, 1], c: '#06140c', recv: true }];
  for (const x of [-CORR_W / 2 - 0.15, CORR_W / 2 + 0.15]) out.push({ id: `pared${x}`, k: 'box', p: [x, 0.6, -30], s: [0.25, 1.2, 90], c: C.lime, e: 0.9 });
  for (let z = -64; z <= 8; z += 8) {
    out.push({ id: `arco${z}`, k: 'box', p: [0, 3.3, z], s: [CORR_W + 1.2, 0.25, 0.3], c: C.lime, e: 0.8 });
    for (const x of [-CORR_W / 2 - 0.4, CORR_W / 2 + 0.4]) out.push({ id: `pil${z}${x}`, k: 'box', p: [x, 1.6, z], s: [0.3, 3.2, 0.3], c: '#16402a', e: 0.25, inst: 'pilar' });
  }
  for (let z = -64; z <= 8; z += 2) out.push({ id: `raya${z}`, k: 'box', p: [0, 0.01, z], s: [0.06, 0.02, 0.9], c: C.lime, e: 0.5, inst: 'raya' });
  return out;
})();

const WORDS = ['árbol', 'avión', 'abeja', 'agua', 'anillo', 'araña', 'ardilla', 'arroz', 'azúcar', 'almohada', 'amigo', 'abuelo', 'aceite', 'águila', 'alfombra', 'barco', 'bosque', 'botella', 'burro', 'banana', 'balón', 'bruja', 'bufanda', 'bicicleta', 'botón', 'brazo', 'casa', 'camino', 'caballo', 'cielo', 'campana', 'coche', 'cuchara', 'corazón', 'cohete', 'castillo', 'cebolla', 'camisa', 'cocina', 'conejo', 'dado', 'dragón', 'dedo', 'diamante', 'delfín', 'dinero', 'doctor', 'dulce', 'duende', 'escuela', 'estrella', 'elefante', 'espejo', 'escalera', 'edificio', 'entrada', 'esfera', 'espada', 'error', 'flor', 'fuego', 'foca', 'fruta', 'farol', 'fantasma', 'feria', 'familia', 'fiesta', 'gato', 'globo', 'guitarra', 'gusano', 'gigante', 'galleta', 'gorila', 'guante', 'hormiga', 'huevo', 'hoja', 'helado', 'hongo', 'hamaca', 'hielo', 'hermano', 'hotel', 'isla', 'iglesia', 'imán', 'invierno', 'iguana', 'idea', 'insecto', 'jirafa', 'jardín', 'jugo', 'jabón', 'jaula', 'joya', 'juego', 'koala', 'kiwi', 'luna', 'libro', 'león', 'lápiz', 'lago', 'lluvia', 'lobo', 'limón', 'luz', 'lámpara', 'mesa', 'mano', 'mar', 'mariposa', 'montaña', 'manzana', 'martillo', 'mundo', 'mono', 'moneda', 'museo', 'nube', 'naranja', 'nariz', 'noche', 'nido', 'nieve', 'nave', 'nuez', 'oso', 'oro', 'ola', 'ojo', 'oveja', 'orquesta', 'océano', 'olla', 'otoño', 'perro', 'pan', 'pelota', 'playa', 'planeta', 'puerta', 'pájaro', 'pato', 'piedra', 'payaso', 'pizza', 'pulpo', 'peine', 'queso', 'rana', 'reloj', 'rayo', 'río', 'rosa', 'ratón', 'robot', 'rueda', 'ropa', 'regalo', 'sol', 'silla', 'sapo', 'semilla', 'serpiente', 'sombrero', 'sandía', 'selva', 'sopa', 'tren', 'tigre', 'torre', 'tortuga', 'taza', 'tambor', 'tomate', 'techo', 'tijeras', 'tesoro', 'uva', 'unicornio', 'universo', 'vaca', 'volcán', 'viento', 'ventana', 'vaso', 'verano', 'violín', 'valle', 'vela', 'xilófono', 'yate', 'yoga', 'yema', 'yogur', 'zapato', 'zorro', 'zanahoria', 'zebra', 'zona'];
const norm = w => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const first = w => norm(w)[0];
const lastL = w => { const n = norm(w); return n[n.length - 1]; };
const hueOf = i => `hsl(${(i * 47 + 100) % 360},85%,60%)`;

// Cada palabra aceptada añade un tramo de bloques; las anteriores retroceden hacia la cámara.
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
          <Text key={it.key} pointerEvents="none" numberOfLines={1} style={{ position: 'absolute', left: q.x - w / 2 - org.x, top: q.y - fs * 0.6 - org.y, width: w, textAlign: 'center', color: it.color, fontSize: fs, fontWeight: '900', ...tglow(it.color, 6) }}>{it.text}</Text>
        );
      })}
    </View>
  );
}

export function WordChain3D({ onExit }) {
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('wordchain');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const [, force] = useReducer(x => x + 1, 0);
  const g = useRef(null);
  if (!g.current) g.current = initState();
  const start = () => { fx.clear(); g.current = initState(); setPhase('play'); hx.tap(); };
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
      burst3d([padX(s.opts.findIndex(x => x.w === o.w), s.opts.length), 0.6, PAD_Z], [C.lime, '#ffffff'], 28, { speed: 5, up: 3, size: 0.2, life: 0.9 });
      const q = project(CAM, [0, 1.2, PAD_Z], SCREEN_W, SCREEN_H);
      if (q) fx.pop(q.x, q.y, `+${pts}`, C.lime, 22);
      hx.good(); force();
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
      s.lock = true; s.lives -= 1; s.streak = 0; fx.shake(7, 0.25); fx.flash(C.red, 0.25); fx.pop(SCREEN_W / 2, SCREEN_H * 0.5, '¡TIEMPO!', C.red, 22); hx.bad();
      if (s.lives <= 0) later(() => { if (g.current === s) finish(s); }, 800);
      else later(() => { if (g.current === s) { advance(s, s.opts.find(x => x.ok).w); force(); } }, 900);
    }
  });
  const pan = usePan(fx, {
    down: (x, y) => {
      const s = g.current; if (phase !== 'play' || s.lock) return;
      const hit = rayGround(CAM, x, y, SCREEN_W, SCREEN_H, PAD_TOP);
      if (!hit) return;
      const i = s.opts.findIndex((o, k) => Math.abs(hit[0] - padX(k, s.opts.length)) < PAD_W / 2 && Math.abs(hit[2] - PAD_Z) < PAD_D / 2);
      if (i >= 0) choose(s.opts[i]);
    },
  });

  const s = g.current;
  const n = s.opts.length;
  const newest = s.blocks[s.blocks.length - 1];
  const blockObjs = s.blocks.flatMap(b => Array.from({ length: b.L }, (_, j) => ({
    k: 'box', p: [0, 0.2, b.base + j * SP], s: [0.78, 0.42, 0.82], c: b.col, e: b === newest ? 0.9 : 0.35, inst: 'letra',
  })));
  const objs = [
    ...blockObjs,
    ...s.opts.map((o, i) => {
      const col = s.pick === o.w ? (o.ok ? C.lime : C.red) : s.lock && o.ok ? C.lime : C.cyan;
      return { id: `pad${i}`, k: 'box', p: [padX(i, n), PAD_TOP / 2, PAD_Z], s: [PAD_W, PAD_TOP, PAD_D], c: shade(col, 0.4), e: 0.6, sh: true };
    }),
  ];
  const lights = [
    { p: [0, 2.2, PAD_Z - 1.5], c: '#7dff6b', i: 8, d: 12 },
    { p: [0, 1.6, newest ? newest.base : START_Z], c: '#22e6ff', i: 6, d: 12 },
  ];
  const scene = { bg: '#030a06', fog: { c: '#030a06', near: 9, far: 34 }, shadowR: 12, statics: STATIC, objs, lights, cam: CAM };

  const labels = [
    ...s.blocks.filter(b => b !== newest).map(b => ({ key: `w${b.id}`, p: [0, 1.0, b.base + ((b.L - 1) * SP) / 2], text: b.w, color: b.col, u: 0.55, min: 13, max: 24, w: 160 })),
    ...s.opts.map((o, i) => ({ key: `o${o.w}`, p: [padX(i, n), PAD_TOP + 0.12, PAD_Z], text: o.w, color: C.text, u: 0.42, min: 12, max: 18, w: 104 })),
  ];

  return (
    <Game3D title="WORD CHAIN" emoji="🔗" accent={C.lime} onExit={onExit} score={s.score} best={best} fx={fx} pan={pan}
      phase={phase} onStart={start} scene={scene}
      hud={<><Lives n={s.lives} max={3} /><HudPill label="CADENA" value={s.words.length} color={C.lime} />{s.streak > 2 ? <Combo n={s.streak} color={C.lime} /> : null}</>}
      subtitle="Cada palabra empieza con la última letra de la anterior"
      lines={['Toca la palabra que empiece con la letra indicada', 'Cada palabra aceptada se añade al pasillo de letras', 'Vista en tercera persona: la cadena avanza hacia ti']}
      result={{ won: !!res.won, isNew: res.isNew, title: res.won ? '¡CADENA PERFECTA!' : 'SE ROMPIÓ LA CADENA', emoji: res.won ? '🏆' : '🔗', subtitle: `Cadena de ${s.words.length} palabras`, stats: [['PALABRAS', s.words.length], ['RACHA', s.streak]] }}>
      <Labels3D cam={CAM} items={labels} />
      <Bar value={s.limit - s.t} max={s.limit} color={s.t / s.limit > 0.7 ? C.red : C.lime} h={10} style={{ position: 'absolute', top: 6, left: 18, right: 18 }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: 24, left: 0, right: 0, alignItems: 'center' }}>
        <Text style={{ color: C.text, fontSize: 30, fontWeight: '900', letterSpacing: 1, ...tglow(C.lime, 12) }}>{newest ? newest.w : ''}</Text>
        <Text style={{ color: C.dim, fontSize: 14, marginTop: 6 }}>Elige una palabra que empiece con</Text>
        <Text style={{ color: C.amber, fontSize: 50, fontWeight: '900', lineHeight: 56, ...tglow(C.amber, 14) }}>{s.need.toUpperCase()}</Text>
      </View>
    </Game3D>
  );
}
