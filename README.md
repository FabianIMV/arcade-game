# 🕹️ ARCADE HUB

> *Built by an AI. Played by humans. Vibes immaculate.* 🤖✨

A fully-featured **multi-game arcade hub** built with **React Native + Expo**, packed with haptic feedback, emoji sprites, and retro neon energy. Four unique games, one app, zero excuses to be bored.

Deployed over-the-air via **EAS Update** straight to your iPhone through **Expo Go** — no App Store required.

---

## 🎮 The Games

### 👾 NEON GALAXY — Space Shooter
> *The aliens are coming. You are the only one who can stop them.*

- **Drag** your ship across the screen to dodge alien formations
- Your ship **auto-fires** — no button mashing needed, just pure evasion skill
- **3 lives** stand between you and the void of space
- Haptic feedback fires on every **shot**, every **enemy hit**, and every **life lost** — your phone basically becomes a mini arcade controller
- How long can you survive the neon galaxy? 🚀

---

### 🏃 CYBER RUN — Endless Runner
> *The city never sleeps. Neither do the obstacles.*

- **Tap** to jump over neon obstacles hurtling toward you at increasingly brutal speeds
- Your **score climbs** every time you clear an obstacle — chase that high score
- The longer you survive, the faster it gets — good luck with that
- Haptic bumps on every **jump** and a satisfying thud on every **crash** 💥
- A true one-more-try machine

---

### 🌟 PIXEL QUEST — Mario-Style Platformer
> *10 worlds. 3 lives. One hero in sunglasses.*

This is the big one. Ten handcrafted worlds of side-scrolling platformer action:

- **D-Pad controls** — tap left, right, and jump buttons on screen
- **3 lives** with **checkpoint respawning** — die, respawn at last checkpoint, keep going
- Collect ⭐ **Star Powerup** for full invincibility AND a gun (your player goes from 😎 to 🤠🔫 — literally)
- Enemies are 👾 — stomp them, shoot them, or just run
- **Save & Load** your game progress via `AsyncStorage` — close the app, come back, pick up where you left off
- Haptic feedback is *everywhere*:
  - 📳 Movement: subtle vrr vrr as you walk
  - 🦘 Jumps: satisfying pop
  - 💀 Deaths: dramatic rumble
  - ⭐ Powerups: celebratory buzz
- This is the game that keeps giving

---

### 🦆 GALACTIC HUNT — Target Shooter
> *Ducks. UFOs. Gems. Your finger. Let's go.*

A chaotic shooting gallery with three types of targets zipping across the screen:

| Target | Speed | Points |
|--------|-------|--------|
| 🦆 Duck | Slow | Low |
| 🛸 UFO | Fast | Medium |
| 💎 Gem | Very Fast | High |

- **10 shots** per round — make them count
- **30-second timer** per round — no time to think, only shoot
- **3 rounds** per game — your total score adds up across all rounds
- Tap targets to splat them before they escape the screen
- Perfect for when you just need to tap things aggressively

---

## ✨ Key Features

### 📳 Haptic Feedback — Everywhere
Every game uses `expo-haptics` to bring the action to life through your phone. Shots, jumps, hits, deaths, powerups — if something happens in the game, your hand knows about it. It's the closest thing to a physical arcade cabinet you'll get on a phone.

### 💾 Save / Load System
**PIXEL QUEST** uses `@react-native-async-storage/async-storage` to persist your game state. Your world progress, current world, and lives are saved automatically so you can pick up your adventure any time.

### 🎨 Emoji Sprites
Who needs a spritesheet when you have Unicode? All game characters and objects are built from emoji — 😎 🤠 👾 🦆 🛸 💎 ⭐ 🚀 — keeping things lightweight, expressive, and delightfully retro.

### 📡 OTA Updates via EAS
The app is deployed with **Expo EAS Update**. That means new game content, bug fixes, and tweaks land on your phone **without** a new App Store submission. Just open Expo Go, and you're already on the latest version.

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **React Native** | Core mobile framework |
| **Expo SDK 54** | Managed workflow, dev tooling |
| **expo-haptics** | Tactile feedback throughout all games |
| **expo-updates** | OTA delivery via EAS Update |
| **@react-native-async-storage/async-storage** | Save/Load for PIXEL QUEST |
| **EAS Update** | Over-the-air deployment to Expo Go |

---

## 🚀 How to Run

### Prerequisites
- Node.js installed
- Expo Go app installed on your iPhone
- EAS CLI: `npm install -g eas-cli`

### Install dependencies
```bash
npm install
```

### Push an OTA update to your device
```bash
eas update --branch main --platform ios
```

Then open **Expo Go** on your iPhone, navigate to your project, and the latest update will load automatically. 🎉

---

## 🤖 Built By AI

This entire app — all four games, the hub UI, the haptics, the save system, the animations — was architected and coded by an **AI assistant** in collaboration with the user. No game engine. No third-party game framework. Pure React Native, raw creativity, and a lot of emoji.

> *Proof that AI + human > either alone.* 💪

---

## 📄 License

Built for fun. Play for free. Share the joy. 🕹️