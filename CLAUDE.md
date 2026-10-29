# Claude Code Instructions

## Git Workflow

**Push directly to `main` — do NOT create pull requests.**

- Work directly on `main` (or the current working branch)
- Commit and push with `git push origin main` after each change
- No PRs, no feature branches required
- Branch naming for Claude sessions: `claude/<task>-<sessionId>`

## Project Overview

React Native / Expo arcade game app. All games live in `App.js` as separate function components.
Shared UI/juice (theme, haptics, FX, overlays, best score, game loop) lives in `utils/kit.js`.
Settings, sound effects (`expo-audio`, optional), profile/XP/achievements/daily challenge and toasts live in `utils/meta.js`; `hx.*` already plays sound + haptics, and `useBest().submit` already feeds the profile — games need no extra code.

## Adding a New Game

1. Add game constants at the top of the game's section in `App.js` (prefixed, e.g. `MG_`)
2. Add the game component function `function MyGame({ onExit }) { ... }`
3. Register it in the `GAMES` array (just above `function Menu`) — the menu, categories and routing are generated from it:
   ```js
   { id: 'mygame', name: 'MY GAME', emoji: '🎮', tag: 'Una línea de descripción', color: C.cyan, cat: 'arcade', Comp: MyGame },
   ```
   (`cat` is one of `accion | arcade | reflejos | puzzle | aventura`)

## Game structure (follow this pattern)

```js
function MyGame({ onExit }) {
  const fx = useFX();                                  // partículas / textos flotantes / shake
  const [best, submitBest] = useBest('mygame');        // récord persistente (AsyncStorage `@best:mygame`)
  const [phase, setPhase] = useState('ready');         // ready | play | over
  const g = useRef(null);                              // estado mutable del juego (refs, no useState)
  if (!g.current) g.current = initState();
  useLoop(phase === 'play', dt => { /* dt en segundos, re-renderiza cada frame */ });
  const pan = usePan(fx, { down(x, y) {}, move(x, y, gs) {}, up() {} });  // coords locales del PlayArea
  return (
    <GameScreen title="MY GAME" emoji="🎮" accent={C.cyan} onExit={onExit} score={...} best={best} hud={...}>
      <PlayArea fx={fx} {...pan}>
        {/* dibuja en coordenadas 0..AREA_W × 0..AREA_H */}
        <Overlay show={phase !== 'play'} kind={phase} title="..." score={...} best={best} onStart={start} onExit={onExit} />
      </PlayArea>
    </GameScreen>
  );
}
```

Kit rules of thumb:
- Haptics via `hx.tap/hit/good/bad/die/win`; effects via `fx.burst/pop/ring/shake/flash`.
- Never define a component inside another component's render (it remounts every frame and breaks presses). Hoist it to module level.
- For multi-touch controls (hold left + jump, two joysticks) use `TouchBtn` / `TouchStick` from `utils/kit.js` (raw touch events). Never `Pressable`/`PanResponder` for held controls: React Native's responder system allows only ONE active control at a time.
- 3D games: create the three.js renderer with `makeRenderer(gl, THREE)` from `utils/gl3dx.js` (works around expo-gl's WebGL2 context failing three.js's WebGL 1 check).
- Use `text` glow with `tglow(color)`, not `glow()` (which is for Views).

## 3D games (engine v2)

New/rewritten 3D games use `utils/engine3d.js` (scene format, shadows, sky, instancing, particles), `utils/prefabs.js` (person, car, tree, chest, dragon…) and `Game3D` from `utils/ui3d.js` (start/over screens, HUD, joysticks). Read `docs/ENGINE3D.md`; the reference game is `games3d/islatesoro.js`.

## Testing (no device needed)

The app can be bundled for web with `react-native-web` + `esbuild` (aliasing `expo-haptics` and AsyncStorage to stubs) and driven with Playwright to smoke-test every game for runtime errors.

## Stack

- React Native + Expo
- `expo-haptics` for vibration
- `@react-native-async-storage/async-storage` for persistence
- No external game engines
