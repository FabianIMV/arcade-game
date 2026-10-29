# Motor 3D v2 — guía rápida para los juegos

Archivos: `utils/engine3d.js` (motor) · `utils/World3D.js` (componente) · `utils/prefabs.js` (objetos listos) · `utils/ui3d.js` (`Game3D` y UI) · `utils/openworld.js` (terreno, cámara, movimiento).
**Juego de referencia: `games3d/islatesoro.js`** (cópialo como plantilla). Galería de prefabs: `games3d/gallery3d.js` (dev, regístrala temporalmente en `GAMES`).

## 1. Esqueleto de un juego

```js
import { C, useBest, useFX, useLoop, hx } from '../utils/kit';
import { Game3D, HudPill, Stick3D, ActionBtn } from '../utils/ui3d';
import { person, tree, coin } from '../utils/prefabs';
import { burst3d } from '../utils/engine3d';

export function MiJuego3D({ onExit }) {
  const fx = useFX();
  const [best, submitBest] = useBest('migame');      // mismas claves de récord de siempre
  const [phase, setPhase] = useState('ready');       // 'ready' | 'play' | 'over'
  const [res, setRes] = useState({});
  const g = useRef(null); if (!g.current) g.current = initState();
  useLoop(phase === 'play', dt => { /* lógica; dt en segundos; re-renderiza cada frame */ });
  const scene = buildScene(g.current, t);            // { objs, cam, sky, … } (ver §2)
  return (
    <Game3D title="MI JUEGO" emoji="🎮" accent={C.cyan} onExit={onExit} score={…} best={best} fx={fx}
      phase={phase} onStart={start} scene={scene}
      menuScene={t => buildScene(g.current, t)}      // opcional: escena animada para inicio/fin
      hud={<><HudPill icon="⏱" value="30s" /></>}
      subtitle="una frase" lines={['cómo se juega', '…']}
      result={{ won, isNew: res.isNew, title: '…', subtitle: '…', stats: [['NIVEL', 3]] }}>
      {/* controles 2D: SOLO se montan en phase === 'play' */}
      <Stick3D testID="mv" v={move} side="left" />
      <ActionBtn testID="jump" label="SALTAR" onDown={…} style={{ right: 24, bottom: 34 }} />
    </Game3D>
  );
}
```

- Estado del juego en `useRef` (no `useState`), igual que siempre. `phase`/resultado sí en `useState`.
- `onStart` debe reiniciar el estado y hacer `setPhase('play')`. Al terminar: `submitBest(score)` (devuelve si es récord) → `setRes(...)`, `setPhase('over')`. Los récords y el perfil (`useBest`, `Profile`) funcionan igual que antes.
- **No definas componentes dentro del render.** Texto = SIEMPRE `Text` 2D de RN encima del 3D (nunca texturas/sprites de texto).
- Mantén `testID="start"` (lo pone `Game3D`) y `testID="back"`: los tests automáticos los usan. Pon `testID` a tus joysticks/botones.
- Coordenadas de pantalla (para `usePan`, `project()`, `rayGround()`): el área es **toda la pantalla**: `SCREEN_W × SCREEN_H` de `kit`. `usePan(fx, {...})` y pásalo como `pan={pan}`; solo actúa en `play`.

## 2. Formato de escena (se reconstruye cada frame)

```js
{
  objs:   [ { id, k, p, s|n, r, c, e, o, m, sh, recv, inst } ],   // objetos dinámicos
  statics:[ … ],      // opcional: array PRECALCULADO (mismo array siempre) con lo que no se mueve
  cam:    { p:[x,y,z], l:[x,y,z] | yaw, pitch, fov },
  sky:    { top:'#2f86e6', bottom:'#bfe6ff', sun:true, clouds:9 },  // cielo degradado (sustituye a bg)
  bg:     '#hex',                                // solo si no hay sky
  fog:    { c, near, far },                      // pon c = sky.bottom para que el horizonte case
  light:  { dir:[x,y,z]→HACIA el sol, sun:'#fff4dc', i:2.4, sky:'#dfeaff', ground:'#5b5648', hi:1.8 },
  shadows: false,     // apaga las sombras de ESTA escena · shadowR: radio de sombra alrededor del foco (24)
  terrain:{ id, h:(x,z)=>y, size:64, step:1, color:(y,x,z)=>'#hex', ver },   // malla low-poly de una vez
  water:  { y:0, c:'#2aa0e0', o:0.85, amp:0.1 },  // plano con olas que sigue a la cámara
  lights: [ { p, c, i, d } ],                    // hasta 4 luces puntuales (antorchas, farolas)
  shake:  0.3                                    // temblor de cámara (Game3D lo calcula solo a partir de fx.shake)
}
```

**Objeto.** `id` texto/número ESTABLE (si cambia se recrea la malla) · `k` forma · `p` centro · `s:[x,y,z]` tamaño o `n` escala uniforme · `r:[rx,ry,rz]` radianes (orden XYZ; yaw 0 mira a −Z) · `c` color (hex/`hsl()`) · `e` brillo propio 0..1 (se tiñe con `c`) · `o` opacidad · `m:{r,m}` rugosidad/metal (el metal se atenúa ×0.4: no hay mapa de entorno) · `sh:true` proyecta sombra · `recv:true` la recibe (el terreno ya la recibe; para suelos propios con `k:'pla'` pon `recv:true`) · `inst:'nombre'` instancing.

**Formas** (todas caben en una caja 1×1×1): `box sph cyl cone tor pla cap ico oct ring pyr`. `pla` y `ring` son horizontales (`s:[ancho, fondo, 1]`). `cap` = cápsula/píldora (el eje largo es Y). `ico` = roca/arbusto (80 caras), `oct` = gema, `pyr` = pirámide de base cuadrada (tejados).

**Instancing.** Todos los objetos con el mismo `k` + `inst` se dibujan con UN `InstancedMesh` (miles). No necesitan `id` estable. En instancias: `e` solo se aproxima (≥0.75 = sin luz, p. ej. monedas neón), `o` se ignora, `c` sí es por instancia. Para cosas que nunca cambian (bosque, rocas, hierba) construye el array UNA vez y pásalo en `scene.statics`: el motor no vuelve a escribirlas cada frame (coste ≈ 0). Los objetos de `statics` SIN `inst` también se dibujan (con id estable).

**Partículas** (las gestiona el motor, no van en `objs`):
```js
burst3d([x,y,z], color|[colores], n=14, { speed:5, life:0.8, size:0.18, g:12, up:0, drag:1.5, spread:1 })
ring3d([x,y,z], color, n=18, { speed:6, life:0.6 })      // onda horizontal
clear3d()                                                // al empezar partida
```
Recetas: chispas `n:12,g:12` · explosión `n:40,speed:8,up:3` · humo `g:-1.5,size:.5,life:1.4,speed:1` · polvo `n:3,speed:1.2,g:4` · confeti `color:[…varios]`. Máx. 700 a la vez.

**Sombras.** PCFSoft, mapa 1024, siguen a `cam.l` (o delante de la cámara). Solo proyectan los objetos con `sh:true`. Si van lentas: `scene.shadows=false` o el interruptor global `gfx.shadows=false` (`import { gfx } from engine3d`). En swiftshader (tests) son lentas pero correctas.

## 3. Reglas (aprendidas en iPhone)

1. Nada de `readPixels`/"probe" de pantalla negra (en iOS el framebuffer es MSAA y da negro). No toques `makeRenderer` de `gl3dx.js`.
2. Sin roll en la cámara (solo `l` o `yaw/pitch`).
3. IDs estables; no crees ids nuevos cada frame. **< ~300 mallas con id por frame**; lo repetido, con `inst`/`statics`.
4. Precalcula los prefabs estáticos (árboles, casas, rocas); recalcula cada frame solo lo que se mueve.
5. `e` (emisivo) se tiñe con el color del objeto; para neón usa `e:0.6–1`.
6. Texto siempre 2D (`Text`) sobre el 3D. Controles mantenidos con `TouchStick/TouchBtn` (o `Stick3D/ActionBtn`), nunca `Pressable/PanResponder`.
7. `useLoop` re-renderiza cada frame: el estado va en refs; el motor lee la escena más reciente por su cuenta.
8. Escala: 1 unidad = 1 metro. Una persona mide 1.75.

## 4. Prefabs (`utils/prefabs.js`)

Firma: `prefab(id, [x,y,z], opts)` → array de objetos del motor (ids `id.parte`). `animal(id, kind, p, opts)` y `enemy(id, kind, p, opts)`. Pivote = pies/suelo (vehículos voladores: centro). Frente = −Z con `yaw:0`.

Opciones comunes: `yaw, pitch, roll` (conjunto), `n` (escala), `t` (reloj de animación en segundos, siempre creciente), `walk` (0..1 intensidad de marcha), `c` (color principal), `o` (opacidad), `flash:true` (blanco de golpe), `inst:'nombre'`, `sh:false`.

| prefab | partes | opciones propias |
|---|---|---|
| `person` | 17 | `skin shirt pants hair hat('straw','cap','pirate','helmet','crown','cowboy') arms(π=al cielo, 1.4=al frente) lean eyeC` |
| `car` | 18–21 | `kind('sedan','sport','suv','truck') steer spin c` |
| `moto` | 10–20 | `rider(true|color casco) steer spin roll c` |
| `ship` | 12 | `c c2 thrust(0..1) t` (nave espacial) |
| `plane` | 14 | `c c2 t(hélice)` (avioneta; usa `pitch/roll` para virar) |
| `tree` | 4–19 | `kind('pine','palm','oak','birch','dead','cactus') h leaf snow` (variación automática por id) |
| `rock` | 2–4 | `kind('rock','crystal','boulder') c h` |
| `bush`, `flower` | 2 | `c` |
| `house` | 4–8 | `kind('cottage','hut','barn','tower') c roof lit` |
| `coin` / `gem` | 2 | `spin bob t` / `c spin bob t` |
| `chest` | 9 | `open(0..1) c glow` |
| `animal(id, kind, …)` | 7–22 | kind: `dog cat cow sheep deer horse pig crab fish` · `c t walk` |
| `enemy(id, kind, …)` | 7–15 | kind: `zombi robot ovni fantasma slime` · `t walk c beam(ovni)` |
| `dragon` | 43 | `c belly wing t flap fire(0..1)` |

Helpers: `shade('#hex', 0.7)` oscurece / `1.3` aclara · `mix(c1,c2,t)` · `hash01(texto, k)` número 0..1 estable.
Ejemplo animado: `person('yo', [x,y,z], { yaw: p.face, t: s.t, walk: moving ? 1 : 0, hat: 'cap' })`. Un enemigo golpeado: `enemy('z1','zombi',p,{ t, flash: hitTimer>0 })`.

## 5. `Game3D` y UI (`utils/ui3d.js`)

- `Game3D`: escena a pantalla completa (detrás del notch), cabecera (volver, título, puntos/récord), fila `hud`, pantalla de INICIO (título con brillo, récord, reglas en `Panel3D`, botón JUGAR) y de FIN (puntos con cuenta animada, ¡NUEVO RÉCORD!, `stats`, OTRA VEZ / MENÚ) con la cámara **orbitando** la escena (`menuScene` si existe, si no `scene`). `orbit={{ r, h, speed, ly, drop }}` o `orbit={t => cam}` ajusta esa cámara; `drop` (2.6) sube al sujeto a la mitad superior. Props: `title emoji accent onExit score best scoreLabel hud phase onStart scene menuScene orbit subtitle lines result fx pan controlsAlways startLabel retryLabel`.
- `orbitCam(scene, t, opts)`: cámara orbital reutilizable (cinemáticas).
- `Btn3D` (botón con profundidad: `label color size('lg','md','sm') icon ghost testID`), `Panel3D` (tarjeta de cristal: `title accent`), `HudPill` (`icon label value color`), `Stick3D` (`v` ref `{x,y,on}`, `side`), `ActionBtn` (botón redondo multitáctil, `onDown/onUp`), `Fade`.
- Los hijos de `Game3D` se montan bajo la cabecera; posiciónalos con `position:'absolute'` y porcentajes (`left:'50%'`, `bottom:34`).

## 6. Probar (sin dispositivo)

```
HARN=$(bash $SP/mkh.sh <letra>);  REPO=$(pwd) HARNESS=$HARN bash $SP/build_wt.sh
cd $HARN && node smoke.js <id>          # sin errores de runtime
node arenat.js <id>                     # captura arena-<id>.png tras pulsar JUGAR
node owdrive.js <id> <testID-mover> <testID-mirar>   # conduce y captura drive-<id>-*.png
```
Abre las capturas con Read: comprueba sombras, cielo, que la cámara encuadra y que se ve bonito. `globalThis.__w3d` (mallas, instancias, draw calls, triángulos) se actualiza cada 30 frames para depurar rendimiento.

## 7. Compatibilidad

Las escenas v1 (`{objs, cam, bg, fog, shake}`) siguen funcionando: usan material estándar con luz hemisférica + sol (algo más brillantes que antes) y sin sombras salvo que pongas `sh`/`recv`. `World3D` acepta `scene` o `getScene(t)`.
