import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AREA_H, AREA_W, C, GameScreen, Lives, Combo, Bar, Overlay, PlayArea, clamp, hx, rand, uid, useBest, useFX, useLoop, usePan, tglow } from '../utils/kit';
import { World3D } from '../utils/World3D';

// Mundo: espacio profundo. La nave está en z=0 y la cámara detrás (tercera persona).
// Los enemigos nacen lejos (z=-60) y vienen hacia la cámara; los disparos viajan hacia el fondo.
// Escala: 1 unidad ≈ 1 metro. La nave se mueve en x (arrastrar).
const NG_XH = 2.5;            // límite lateral de la nave
const NG_FAR = -60;           // profundidad de aparición de enemigos
const NG_BOSS_Z = -30;        // el jefe se planta a esta profundidad
const NG_BULLET_V = 60;       // velocidad de los disparos (u/s, hacia el fondo)
const NG_FOC = (AREA_H / 2) / Math.tan((58 / 2) * Math.PI / 180); // para situar textos 2D aproximados
const ENEMY = {
  drone: { hp: 1, r: 0.55, vz: 9.5, pts: 10, c: C.pink },
  zig: { hp: 2, r: 0.6, vz: 8, pts: 20, c: C.cyan },
  tank: { hp: 6, r: 0.85, vz: 4.5, pts: 50, c: C.orange },
  kami: { hp: 1, r: 0.5, vz: 20, pts: 30, c: C.red },
};
const IC = { W: C.amber, S: C.cyan, H: C.red, B: C.orange };

// Posición aproximada en píxeles del PlayArea para textos 2D (puntos, efectos)
const ngScr = (s, x, y, z) => {
  const d = Math.max(0.5, 9 - z);
  return [AREA_W / 2 + (x - s.x * 0.35) / d * NG_FOC, AREA_H / 2 - (y - 2.6) / d * NG_FOC];
};

// Pseudoaleatorio determinista para estrellas estables
const hsh = n => { const v = Math.sin(n * 91.3458) * 47453.5453; return v - Math.floor(v); };
const ngStars = t => Array.from({ length: 48 }, (_, i) => {
  const z = -70 + ((hsh(i + 7) * 76 + t * 28) % 76);
  return { id: `st${i}`, k: 'sph', p: [(hsh(i) * 2 - 1) * 24, hsh(i + 3) * 16 - 4, z], n: 0.14, c: '#cfe9ff', e: 1 };
});

const dropItem = (s, x, y, z, force) => {
  if (!force && Math.random() > 0.13) return;
  const r = Math.random();
  const type = r < 0.38 ? 'W' : r < 0.62 ? 'S' : r < 0.82 ? 'H' : 'B';
  s.items.push({ id: uid(), x, y, z, type });
};

const enemyObj = (e, t) => {
  const base = { id: `en${e.id}`, p: [e.x, e.y, e.z], c: ENEMY[e.type].c, e: 0.55 };
  if (e.type === 'zig') return { ...base, k: 'cyl', s: [1.3, 0.35, 1.3], r: [0.3, t * 2, 0] };          // platillo
  if (e.type === 'tank') return { ...base, k: 'box', s: [1.5, 1.5, 1.5], r: [t * 0.6, t * 0.8, 0] };   // blindado
  if (e.type === 'kami') return { ...base, k: 'cone', s: [0.9, 1.4, 0.9], r: [Math.PI / 2, 0, 0] };    // picado hacia la cámara
  return { ...base, k: 'box', s: [0.9, 0.9, 0.9], r: [t * 2, t * 1.3, 0] };                              // dron
};

const initState = () => ({
  x: 0, tx: 0, score: 0, lives: 3, shield: 0, weapon: 1, fireT: 0,
  enemies: [], bullets: [], eb: [], items: [], wave: 0, queue: [], spawnT: 0, gap: 0,
  banner: null, combo: 0, comboT: 0, boss: null, t: 0, inv: 0, kills: 0,
});

export function NeonGalaxy3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('neon');
  const [phase, setPhase] = useState('ready');
  const [res, setRes] = useState({ isNew: false });
  const g = useRef(null);
  if (!g.current) g.current = initState();

  const nextWave = s => {
    s.wave += 1;
    s.gap = 0;
    if (s.wave % 5 === 0) {
      s.banner = { text: `⚠ JEFE · OLEADA ${s.wave}`, t: 2 };
      const hp = 28 + s.wave * 5;
      s.boss = { x: 0, y: 1.1, z: NG_FAR, r: 2.1, hp, max: hp, t: 0, fire: 1.5 };
      s.queue = [];
    } else {
      s.banner = { text: `OLEADA ${s.wave}`, t: 1.6 };
      const n = 6 + s.wave * 2;
      const q = [];
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        let type = 'drone';
        if (s.wave >= 2 && r < 0.3) type = 'zig';
        if (s.wave >= 3 && r > 0.82) type = 'kami';
        if (s.wave >= 4 && r > 0.92) type = 'tank';
        q.push(type);
      }
      s.queue = q;
      s.spawnT = 1.2;
    }
  };

  const start = () => {
    fx.clear();
    g.current = initState();
    nextWave(g.current);
    setPhase('play');
  };

  const hurtPlayer = s => {
    if (s.inv > 0) return;
    if (s.shield > 0) {
      s.shield -= 1; s.inv = 0.8;
      fx.ring(AREA_W / 2, AREA_H * 0.8, C.cyan, 60); fx.shake(4); hx.hit();
      return;
    }
    s.lives -= 1; s.inv = 1.6; s.weapon = Math.max(1, s.weapon - 1);
    s.combo = 0;
    const [px, py] = ngScr(s, s.x, 0, 0);
    fx.burst(px, py, C.red, 18, 220); fx.shake(9); fx.flash(C.red, 0.3); hx.bad();
    if (s.lives <= 0) {
      hx.die();
      setRes({ isNew: submitBest(s.score) });
      setPhase('over');
    }
  };

  const killEnemy = (s, e) => {
    s.combo += 1; s.comboT = 2; s.kills += 1;
    const mult = Math.min(8, 1 + Math.floor(s.combo / 4));
    const pts = ENEMY[e.type].pts * mult;
    s.score += pts;
    const [px, py] = ngScr(s, e.x, e.y, e.z);
    fx.burst(px, py, ENEMY[e.type].c, 14, 200);
    fx.pop(px, py, `+${pts}`, mult > 1 ? C.amber : C.text, 15);
    hx.tap();
    dropItem(s, e.x, e.y, e.z, ENEMY[e.type].hp >= 6);
  };

  const bossDown = s => {
    const bs = s.boss;
    s.combo += 5; s.comboT = 2;
    s.score += 500 + s.wave * 50;
    const [px, py] = ngScr(s, bs.x, bs.y, bs.z);
    fx.burst(px, py, C.amber, 40, 320, 0.9, 7);
    fx.ring(AREA_W / 2, AREA_H / 2, C.amber, 120);
    fx.pop(px, py - 30, `JEFE +${500 + s.wave * 50}`, C.amber, 20);
    fx.shake(12, 0.5); fx.flash('#ffffff', 0.4); hx.win();
    dropItem(s, bs.x, bs.y, bs.z, true);
    dropItem(s, bs.x - 1.2, bs.y, bs.z, true);
    s.eb = [];
    s.boss = null;
  };

  useLoop(phase === 'play', dt => {
    const s = g.current;
    if (phase !== 'play') return;
    s.t += dt;
    s.inv = Math.max(0, s.inv - dt);
    s.x += (s.tx - s.x) * Math.min(1, dt * 16);
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    if (s.comboT > 0) { s.comboT -= dt; if (s.comboT <= 0) s.combo = 0; }

    // disparo automático
    s.fireT -= dt;
    if (s.fireT <= 0) {
      s.fireT = s.weapon >= 3 ? 0.19 : 0.23;
      const b = (dx, vx) => s.bullets.push({ id: uid(), x: s.x + dx, y: 0, z: -0.9, vx, vz: -NG_BULLET_V });
      if (s.weapon === 1) b(0, 0);
      else if (s.weapon === 2) { b(-0.45, 0); b(0.45, 0); }
      else { b(0, 0); b(-0.5, -0.9); b(0.5, 0.9); }
    }

    // aparición de enemigos
    if (s.queue.length) {
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        const type = s.queue.shift();
        const d = ENEMY[type];
        s.enemies.push({ id: uid(), type, x: rand(-NG_XH * 0.9, NG_XH * 0.9), y: rand(-0.6, 0.9), z: NG_FAR, hp: d.hp, vz: d.vz + s.wave * 0.3, ph: Math.random() * 6, fire: rand(0.8, 2) });
        s.spawnT = Math.max(0.28, 0.75 - s.wave * 0.03);
      }
    }

    // jefe: entra en profundidad, se balancea y dispara abanicos hacia la nave
    if (s.boss) {
      const bs = s.boss;
      bs.t += dt;
      bs.z = Math.min(NG_BOSS_Z, bs.z + 9 * dt);
      bs.x = Math.sin(bs.t * 1.1) * (NG_XH * 0.7);
      bs.fire -= dt;
      if (bs.fire <= 0 && bs.z >= NG_BOSS_Z) {
        bs.fire = Math.max(0.7, 1.3 - s.wave * 0.03);
        const n = 3 + Math.min(4, Math.floor(s.wave / 5));
        for (let i = 0; i < n; i++) {
          const sp = (i - (n - 1) / 2) * 0.9;
          s.eb.push({ id: uid(), x: bs.x, y: bs.y, z: bs.z + 2.2, vx: sp, vy: (Math.random() - 0.5) * 0.6, vz: 15 + s.wave * 0.2 });
        }
      }
    }

    // mover enemigos (hacia la cámara)
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i];
      e.z += e.vz * dt;
      if (e.type === 'zig') e.x += Math.sin(s.t * 3 + e.ph) * 0.9 * dt;
      if (e.type === 'kami' && e.z > -20) e.x += clamp(s.x - e.x, -1, 1) * 5 * dt;
      if (e.type === 'tank' && e.z > -25) {
        e.fire -= dt;
        if (e.fire <= 0) { e.fire = 1.7; s.eb.push({ id: uid(), x: e.x, y: e.y, z: e.z + 0.6, vx: 0, vy: 0, vz: 13 }); }
      }
      e.x = clamp(e.x, -NG_XH * 1.1, NG_XH * 1.1);
      if (e.z > 7) { s.enemies.splice(i, 1); s.combo = 0; }
    }

    // proyectiles
    s.bullets.forEach(b => { b.x += b.vx * dt; b.z += b.vz * dt; });
    s.bullets = s.bullets.filter(b => b.z > -72);
    s.eb.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; });
    s.eb = s.eb.filter(b => b.z < 10);
    s.items.forEach(it => { it.z += 9 * dt; });
    s.items = s.items.filter(it => it.z < 9);

    // disparos del jugador vs enemigos / jefe
    for (let j = s.bullets.length - 1; j >= 0; j--) {
      const b = s.bullets[j];
      let used = false;
      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        if (Math.abs(b.z - e.z) < 1.3 && Math.hypot(b.x - e.x, b.y - e.y) < ENEMY[e.type].r + 0.25) {
          e.hp -= 1; used = true;
          const [px, py] = ngScr(s, b.x, b.y, b.z);
          fx.burst(px, py, C.cyan, 3, 90, 0.25, 3);
          if (e.hp <= 0) { killEnemy(s, e); s.enemies.splice(i, 1); }
          break;
        }
      }
      if (!used && s.boss) {
        const bs = s.boss;
        if (Math.abs(b.z - bs.z) < 1.6 && Math.hypot(b.x - bs.x, b.y - bs.y) < bs.r) {
          bs.hp -= 1; used = true;
          const [px, py] = ngScr(s, b.x, b.y, b.z);
          fx.burst(px, py, C.amber, 3, 100, 0.25, 3);
          if (bs.hp <= 0) bossDown(s);
        }
      }
      if (used) s.bullets.splice(j, 1);
    }

    // nave vs enemigos / disparos enemigos / items
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i];
      if (Math.abs(e.z) < 0.9 && Math.hypot(e.x - s.x, e.y) < ENEMY[e.type].r + 0.55) {
        const [px, py] = ngScr(s, e.x, e.y, e.z);
        fx.burst(px, py, C.red, 10, 160);
        s.enemies.splice(i, 1);
        hurtPlayer(s);
      }
    }
    for (let i = s.eb.length - 1; i >= 0; i--) {
      const b = s.eb[i];
      if (Math.abs(b.z) < 0.55 && Math.hypot(b.x - s.x, b.y) < 0.7) { s.eb.splice(i, 1); hurtPlayer(s); }
    }
    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i];
      if (Math.abs(it.z) < 1.0 && Math.hypot(it.x - s.x, it.y) < 0.9) {
        s.items.splice(i, 1);
        hx.good();
        const [px, py] = ngScr(s, it.x, it.y, it.z);
        if (it.type === 'W') { s.weapon = Math.min(3, s.weapon + 1); fx.pop(px, py, 'ARMA +', C.amber, 16); }
        if (it.type === 'S') { s.shield = Math.min(3, s.shield + 1); fx.pop(px, py, 'ESCUDO', C.cyan, 16); }
        if (it.type === 'H') { s.lives = Math.min(5, s.lives + 1); fx.pop(px, py, '+1 VIDA', C.red, 16); }
        if (it.type === 'B') {
          fx.ring(AREA_W / 2, AREA_H / 2, C.orange, 260); fx.flash(C.orange, 0.35); fx.shake(8);
          s.eb = [];
          s.enemies.forEach(e => { e.hp -= 4; });
          for (let k = s.enemies.length - 1; k >= 0; k--) if (s.enemies[k].hp <= 0) { killEnemy(s, s.enemies[k]); s.enemies.splice(k, 1); }
          if (s.boss) { s.boss.hp -= 12; if (s.boss.hp <= 0) bossDown(s); }
        }
      }
    }

    // siguiente oleada
    if (!s.queue.length && !s.enemies.length && !s.boss) {
      s.gap += dt;
      if (s.gap > 1.2) { s.score += 100 * s.wave; fx.pop(AREA_W / 2, AREA_H / 2 - 40, `OLEADA SUPERADA +${100 * s.wave}`, C.lime, 16); nextWave(s); }
    }
  });

  // arrastrar: la nave sigue el dedo en x (0..AREA_W -> -NG_XH..NG_XH)
  const toX = x => clamp((x / AREA_W - 0.5) * 2 * NG_XH, -NG_XH, NG_XH);
  const pan = usePan(fx, {
    down: x => { g.current.tx = toX(x); },
    move: x => { g.current.tx = toX(x); },
  });

  const s = g.current;
  const mult = Math.min(8, 1 + Math.floor(s.combo / 4));
  const blink = s.inv > 0 && Math.floor(s.t * 14) % 2 === 1;
  const shake = fx.shakeT > 0 ? (Math.random() - 0.5) * fx.shakeMag * (fx.shakeT / fx.shakeDur) * 0.08 : 0;

  const objs = [
    ...ngStars(s.t),
    ...s.enemies.map(e => enemyObj(e, s.t)),
    ...s.bullets.map(b => ({ id: `pb${b.id}`, k: 'box', p: [b.x, b.y, b.z], s: [0.12, 0.12, 1.4], c: C.cyan, e: 0.5 })),
    ...s.eb.map(b => ({ id: `eb${b.id}`, k: 'sph', p: [b.x, b.y, b.z], n: 0.42, c: C.pink, e: 0.45 })),
    ...s.items.map(it => ({ id: `it${it.id}`, k: 'sph', p: [it.x, it.y, it.z], n: 0.7, c: IC[it.type], e: 0.4 })),
  ];
  if (!blink) {
    // nave vista desde atrás: morro (cono) apuntando al fondo, alas y motor
    objs.push(
      { id: 'ship-body', k: 'box', p: [s.x, 0, -0.2], s: [0.55, 0.32, 2.2], c: C.cyan, e: 0.5 },
      { id: 'ship-cab', k: 'sph', p: [s.x, 0.22, -0.5], n: 0.5, c: C.violet, e: 0.6 },
      { id: 'ship-wing', k: 'box', p: [s.x, -0.04, 0.3], s: [2.6, 0.07, 0.8], c: C.violet, e: 0.45 },
      { id: 'ship-eng', k: 'sph', p: [s.x, 0, 1.0], n: 0.4, c: C.orange, e: 0.5 },
    );
    if (s.shield > 0) objs.push({ id: 'ship-shield', k: 'sph', p: [s.x, 0, 0], n: 2.0, c: C.cyan, o: 0.18, e: 0.3 });
  }
  if (s.boss) {
    const bs = s.boss;
    objs.push(
      { id: 'boss', k: 'sph', p: [bs.x, bs.y, bs.z], s: [4.2, 3.6, 3.0], c: C.amber, e: 0.35 },
      { id: 'boss-ring', k: 'tor', p: [bs.x, bs.y, bs.z], n: 5.6, r: [0.25, s.t, 0], c: C.pink, e: 0.8 },
    );
  }

  const scene = {
    bg: '#04040e', fog: { c: '#04040e', near: 14, far: 70 }, objs,
    cam: { p: [s.x * 0.35 + shake, 2.6, 9], l: [s.x * 0.2, 0.2, -12], fov: 58 },
  };

  return (
    <GameScreen title="NEON GALAXY" emoji="🚀" accent={C.cyan} onExit={onExit} score={s.score} best={best}
      hud={<>
        <Lives n={s.lives} max={Math.max(3, s.lives)} />
        <Text style={{ color: C.cyan, fontWeight: '800', fontSize: 12 }}>{s.shield > 0 ? `🛡️×${s.shield}  ` : ''}⚡ Nv.{s.weapon}</Text>
        <View style={{ minWidth: 70, alignItems: 'flex-end' }}>{mult > 1 ? <Combo n={mult} /> : <Text style={{ color: C.dim, fontSize: 12 }}>Oleada {s.wave}</Text>}</View>
      </>}>
      <PlayArea fx={fx} bg="#04040e" {...pan}>
        <World3D scene={scene} />
        {s.boss && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: AREA_W / 2 - 90, width: 180 }}>
            <Bar value={s.boss.hp} max={s.boss.max} color={C.red} h={6} w={180} />
          </View>
        )}
        {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: AREA_H * 0.3, width: AREA_W, textAlign: 'center', color: C.text, fontSize: 24, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow(C.cyan, 12) }}>{s.banner.text}</Text>}
        <Overlay show={phase !== 'play'} kind={phase} emoji="🚀" title={phase === 'over' ? 'FIN DEL VIAJE' : 'NEON GALAXY 3D'}
          subtitle={phase === 'over' ? `Llegaste a la oleada ${s.wave}` : 'Defiende la galaxia'}
          score={s.score} best={best} isNew={res.isNew} accent={C.cyan} onStart={start} onExit={onExit}
          lines={phase === 'ready' ? ['Arrastra para mover · disparo automático', '⚡ mejora el arma · 🛡️ escudo · ❤️ vida · 💣 bomba', 'Vista en tercera persona detrás de la nave'] : null} />
      </PlayArea>
    </GameScreen>
  );
}
