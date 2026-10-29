import React, { useRef, useState } from 'react';
import { C, useFX, useLoop } from '../utils/kit';
import { Btn3D, Game3D, orbitCam } from '../utils/ui3d';
import { PREFAB_DEMO, tree } from '../utils/prefabs';
import { burst3d, ring3d } from '../utils/engine3d';

// GALERÍA 3D (herramienta de desarrollo, no está en el menú): todos los prefabs sobre un suelo con sombras.
// Para verla, registra temporalmente en GAMES de App.js: { id:'gallery', name:'GALERÍA', emoji:'🧪', tag:'Prefabs', color:C.cyan, cat:'arcade', Comp: Gallery3D }
const PER_PAGE = 12, COLS = 3, GAP = 6.5;
const forest = (() => {
  const out = [];
  for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) out.push(...tree(`f${i}_${j}`, [(i - 15) * 3.2 + ((j * 7) % 3), 0, (j - 15) * 3.2 + ((i * 5) % 3)], { kind: (i + j) % 5 === 0 ? 'oak' : 'pine', inst: 'bosque' }));
  return out;
})();

export function Gallery3D({ onExit }) {
  const fx = useFX();
  const [phase, setPhase] = useState('ready');
  const [page, setPage] = useState(0);
  const g = useRef({ t: 0 }).current;
  useLoop(phase === 'play', dt => {
    g.t += dt; g.b = (g.b || 0) - dt;
    if (g.b <= 0 && typeof globalThis.__gone === 'string') { g.b = 1.2; burst3d([0, 1, 0], ['#ffd54a', '#fff3b0', '#ffb300'], 38, { speed: 6.5, up: 4.5, size: 0.2, life: 1.1 }); ring3d([0, 0.3, 0], '#ffd54a', 22, { speed: 5 }); }
  });
  const pages = Math.ceil(PREFAB_DEMO.length / PER_PAGE) + 1;
  const pg = typeof globalThis.__gpage === 'number' ? globalThis.__gpage : page;
  const items = PREFAB_DEMO.slice(pg * PER_PAGE, pg * PER_PAGE + PER_PAGE);
  const objs = [{ id: 'ground', k: 'pla', p: [0, 0, 0], s: [400, 400, 1], c: '#6fae58', recv: true, m: { r: 1, m: 0 } }];
  let dist = 36, ly = 1.2;
  const one = typeof globalThis.__gone === 'string' ? PREFAB_DEMO.find(d => d[0] === globalThis.__gone) : null;   // modo primer plano (pruebas)
  if (one) { objs.push(...one[1](one[0], [0, 0, 0], g.t)); dist = ['barn', 'tower', 'cottage'].includes(one[0]) ? 18 : ['dragon', 'ovni', 'palm', 'plane', 'truck', 'car', 'sport', 'pine', 'oak', 'hut', 'ship', 'horse', 'cow'].includes(one[0]) ? 10 : 5; ly = 1; if (one[0] === 'dragon') { dist = 18; ly = 0; } if (one[0] === 'tower') { ly = 3; } }
  else if (pg < pages - 1) {
    items.forEach(([name, fn], i) => objs.push(...fn(name, [((i % COLS) - (COLS - 1) / 2) * GAP, 0, (Math.floor(i / COLS) - 1.5) * GAP], g.t)));
  } else { objs.push(...forest); dist = 42; }
  const scene = {
    sky: { top: '#2f7fe0', bottom: '#cfeaff', clouds: 8 }, fog: { c: '#cfeaff', near: 50, far: 130 }, objs, shadowR: pg < pages - 1 ? 22 : 30,
    cam: orbitCam({ cam: { p: [0, 12, dist], l: [0, ly, 0] } }, g.t, { speed: one ? 0.5 : 0.12, r: dist, h: dist * (one ? 0.4 : 0.62), ly, drop: 0 }),
  };
  return (
    <Game3D title="GALERÍA 3D" emoji="🧪" accent={C.cyan} onExit={onExit} score={pg + 1} scoreLabel="PÁGINA" phase={phase} onStart={() => setPhase('play')}
      scene={scene} fx={fx} best={1234} result={{ won: true, isNew: true, subtitle: 'Prueba de pantalla final', stats: [['A', 3], ['B', '12s']] }} subtitle="Prefabs del motor 3D v2" lines={['Prefabs: ' + PREFAB_DEMO.map(p => p[0]).join(' · ')]}>
      <Btn3D label="◀" size="sm" color={C.cyan} onPress={() => setPage((pg + pages - 1) % pages)} style={{ position: 'absolute', left: 16, bottom: 24 }} />
      <Btn3D testID="gfin" label="FIN" size="sm" color={C.pink} onPress={() => setPhase('over')} style={{ position: 'absolute', alignSelf: 'center', bottom: 24 }} />
      <Btn3D label="▶" size="sm" color={C.cyan} onPress={() => setPage((pg + 1) % pages)} style={{ position: 'absolute', right: 16, bottom: 24 }} />
    </Game3D>
  );
}
