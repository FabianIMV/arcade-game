# Claude Code Instructions

## Git Workflow

**Push directly to `main` — do NOT create pull requests.**

- Work directly on `main` (or the current working branch)
- Commit and push with `git push origin main` after each change
- No PRs, no feature branches required
- Branch naming for Claude sessions: `claude/<task>-<sessionId>`

## Project Overview

React Native / Expo arcade game app. All games live in `App.js` as separate function components.

## Adding a New Game

1. Add game constants at the top of `App.js` (prefixed, e.g. `MG_`)
2. Add the game component function `function MyGame({ onExit }) { ... }`
3. Add a route in `export default function App()`:
   ```js
   if (currentScreen === 'mygame') return <MyGame onExit={() => setCurrentScreen('menu')} />;
   ```
4. Add a `<Pressable>` button in the menu ScrollView

## Stack

- React Native + Expo
- `expo-haptics` for vibration
- `@react-native-async-storage/async-storage` for persistence
- No external game engines
