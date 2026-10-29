# Claude Code Instructions

## Git Workflow

**Push directly to `main` — do NOT create pull requests.**

- Work directly on `main` (or the current working branch)
- Commit and push with `git push origin main` after each change
- No PRs, no feature branches required
- Branch naming for Claude sessions: `claude/<task>-<sessionId>`

## Project Overview

React Native / Expo arcade app where **everything is real 3D** (three.js 0.166 on `expo-gl`).

- `App.js`: only the `GAMES` registry, `CATEGORIES` and navigation (menu ↔ game). No game code lives here.
- `games3d/<id>.js`: one file per game, exporting its component (e.g. `SnakePower3D`).
- `ui/Menu3D.js` (3D arcade-hall menu) and `ui/Panels3D.js` (settings, profile/achievements, graphics quality).
- `utils/engine3d.js` (scene format, shadows, sky, terrain, water, instancing, particles), `utils/World3D.js` (GL view), `utils/prefabs.js` (person, car, tree, chest, dragon…), `utils/ui3d.js` (`Game3D` shell, `Btn3D`, `Panel3D`, `HudPill`, `Stick3D`, `ActionBtn`, `ScreenLayer`), `utils/openworld.js` (heightmap, movement, cameras, `project`/`rayGround`), `utils/gl3dx.js` (`makeRenderer`, required expo-gl fix).
- `utils/kit.js`: theme, haptics (`hx`), FX, `useBest`, `useLoop`, `usePan`, `TouchBtn`/`TouchStick`. `utils/meta.js`: settings, sound, profile/XP/achievements/daily challenge, toasts (`useBest().submit` already feeds the profile).

**Read `docs/ENGINE3D.md` before touching any game.** Reference game: `games3d/islatesoro.js`.

## Adding a New Game

1. Create `games3d/<id>.js` exporting `function MyGame3D({ onExit })`, built on `Game3D` (see `docs/ENGINE3D.md` §1).
2. Import it in `App.js` and register it in `GAMES`:
   ```js
   { id: 'mygame', name: 'MY GAME', emoji: '🎮', tag: 'Una línea de descripción', color: C.cyan, cat: 'arcade', Comp: MyGame3D },
   ```
   (`cat` is one of `accion | arcade | reflejos | puzzle | aventura`). The 3D menu and categories are generated from it.
3. Keep the `useBest('<key>')` key stable forever: changing it wipes the player's record.

## Rules of thumb

- Game state in `useRef`; `useLoop` re-renders every frame. Never define a component inside another component's render.
- Text is always 2D (`Text`) over the 3D view. Labels placed with `project()` go inside `<ScreenLayer>` (children of `Game3D` start below the header).
- Held / simultaneous controls: `TouchBtn` / `TouchStick` (or `Stick3D` / `ActionBtn`). Never `Pressable`/`PanResponder` for held controls (RN allows only one responder at a time).
- Stable object ids; < ~300 id meshes per frame; repeated scenery with `inst` / `statics`. Shadows only on what matters (`sh:true`); users can turn shadows off (graphics quality).
- No `readPixels` "black screen" probes on device (iOS MSAA framebuffer always reads black). No camera roll. Don't touch `makeRenderer`.
- Haptics via `hx.tap/hit/good/bad/die/win` on every event (players love strong vibration); effects via `burst3d`/`ring3d` + `fx.shake`.
- User-facing text in neutral Spanish (tú, never voseo).

## Testing (no device needed)

The app can be bundled for web with `react-native-web` + `esbuild` (aliasing `expo-haptics` and AsyncStorage to stubs) and driven with Playwright to smoke-test every game for runtime errors.

## Stack

- React Native + Expo
- `expo-haptics` for vibration
- `@react-native-async-storage/async-storage` for persistence
- No external game engines
