# 🕹️ ARCADE HUB

> *Un proyecto casero de tardes y fines de semana — orquestado desde un iPhone 12, sin tocar una PC.* 📱✨

## 🧑‍💻 Sobre este proyecto

Este es un **proyecto personal y casero** hecho enteramente desde mi **iPhone 12**, aprovechando **GitHub Codespaces** como entorno de desarrollo en la nube y los modelos de IA como mis "manos" para escribir el código.

No hay PC. No hay escritorio. Solo yo, mi cel, y los modelos:

| Modelo | Rol |
|--------|-----|
| **Claude Sonnet 4.6** (GitHub Copilot) | Arquitectura, juegos, lógica, haptics, correcciones |
| **Gemini Pro 3.1** | Consultas, ideas, revisión de diseño |

Lo voy orquestando en mis ratos libres — una tarde aquí, un fin de semana allá. Le digo qué quiero, los modelos escriben, yo pruebo en Expo Go y pido ajustes. Así de simple y así de divertido.

> *Prueba de que no necesitas una PC, ni saber programar de memoria, para construir algo cool.* 🚀

---

A fully-featured **multi-game arcade hub** built with **React Native + Expo**, packed with haptic feedback, emoji sprites, and retro neon energy. 40 games, one app, zero excuses to be bored.

Deployed over-the-air via **EAS Update** straight to your iPhone through **Expo Go** — no App Store required.

---

## 🎮 Los juegos (40)

Todos los juegos comparten el mismo sistema de diseño (`utils/kit.js`): cabecera con récord, partículas, textos flotantes, *screen shake*, hápticos, pantallas de inicio y fin de partida, y récord persistente por juego. El menú tiene categorías, tarjetas con tu mejor puntuación y un botón **Sorpréndeme** 🎲.

| Categoría | Juegos |
|-----------|--------|
| 🚀 **Acción** | **Neon Galaxy** (oleadas, jefes y power-ups) · **Cyber Run** (corredor de 3 carriles) · **Galactic Hunt** (galería de tiro con cargador) · **Neon Tunnel** (túnel 3D de anillos) · **Neon Warrior** (plataformas con jefes) · **Asteroid Dodge** (esquiva con bonus *cerca*) · **Invasores** (clásico con escudos y ovni) |
| 🕹️ **Arcade** | **Snake Power** · **Ping Pong** (IA que mejora) · **Breakout** (mejoras y multibola) · **Pong Solo** (bumpers estilo pinball) · **Star Catcher** · **Coin Rush** · **Crossy Road** (calles, ríos y trenes) |
| ⚡ **Reflejos** | **Gravity Flip** · **Wall Jumper** · **Whack-a-Mole** · **Fruit Slash** (corta frutas) · **Ritmo y Color** (Simon) · **Flappy Neon** · **Sky Hop** (rebota hacia el cielo) · **Tower Stack** · **Reflejos** · **Color Rush** (Stroop) · **Dino Run** |
| 🧩 **Puzzle** | **Neon Tetris** (hold, fantasma, gestos) · **2048 Neon** (deshacer) · **15 Puzzle** (3×3, 4×4, 5×5) · **Bubble Shooter** (bombas y arcoíris) · **Memory Match** · **Math Rush** · **Palabras** · **Word Chain** · **Buscaminas** (3 dificultades) · **4 en línea** (IA minimax) |
| 🧙 **Aventura** | **Pixel Quest** (30 mundos) · **Void Crawler** (roguelike con niebla y jefe) · **Monster Duel** (captura, evoluciona, líderes) · **Pixel Craft** (mina, fabrica, zombis y noche) · **Pixel RPG** (mundo procedural, tiendas, hechizos, dragón) |

### 🧬 Progreso y extras
- **Sonido** sintetizado para todos los juegos (activable en ⚙️ Ajustes; requiere `expo-audio`, ya incluido en `package.json`).
- **Perfil**: nivel y XP, **12 logros** y **reto del día** con racha 🔥 (un juego distinto cada día).
- **Favoritos** ⭐ con su propia pestaña en el menú.
- **Ajustes**: sonido, vibración y borrado de progreso.

---

## ✨ Key Features

### 📳 Haptic Feedback — Everywhere
Every game uses `expo-haptics` to bring the action to life through your phone. Shots, jumps, hits, deaths, powerups — if something happens in the game, your hand knows about it. It's the closest thing to a physical arcade cabinet you'll get on a phone.

### 💾 Save / Load System
Todos los juegos guardan tu **récord** con `@react-native-async-storage/async-storage`, y los de aventura (**Pixel Quest, Pixel RPG, Monster Duel**) guardan además tu progreso. Tu avance de mundos, nivel y vidas se guarda automáticamente so you can pick up your adventure any time.

### 🎨 Emoji Sprites
Who needs a spritesheet when you have Unicode? All game characters and objects are built from emoji — 😎 🤠 👾 🦆 🛸 💎 ⭐ 🚀 — keeping things lightweight, expressive, and delightfully retro.

### 📡 OTA Updates via EAS
The app is deployed with **Expo EAS Update**. That means new game content, bug fixes, and tweaks land on your phone **without** a new App Store submission. Just open Expo Go, and you're already on the latest version.

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **React Native** | Core mobile framework |
| **Expo SDK 57** | Managed workflow, dev tooling |
| **expo-haptics** | Tactile feedback throughout all games |
| **expo-updates** | OTA delivery via EAS Update |
| **@react-native-async-storage/async-storage** | Récords y partidas guardadas |
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

This entire app — all 40 games, the hub UI, the haptics, the save system, the animations — was architected and coded by an **AI assistant** in collaboration with the user. No game engine. No third-party game framework. Pure React Native, raw creativity, and a lot of emoji.

> *Proof that AI + human > either alone.* 💪

---

## 📄 License

Built for fun. Play for free. Share the joy. 🕹️