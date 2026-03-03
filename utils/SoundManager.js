/**
 * SoundManager – genera tonos WAV en JS puro, los escribe en caché
 * con expo-file-system y los reproduce con expo-av.
 * Si alguno de estos módulos no existe en el build nativo, simplemente
 * no hace nada (sin crash).
 */

// ─── carga dinámica para no crashear si los módulos no están en el build ───
let Audio = null;
let FileSystem = null;
try { Audio = require('expo-av').Audio; } catch (_) {}
try { FileSystem = require('expo-file-system'); } catch (_) {}

// ─── síntesis WAV (8kHz, 8-bit, mono) ─────────────────────────────────────
function generateWavBase64(freq, durationMs, style) {
  const SR = 8000;
  const n  = Math.floor(SR * durationMs / 1000);
  const buf = new Uint8Array(44 + n);
  const dv  = new DataView(buf.buffer);
  const wr  = (off, s) => s.split('').forEach((c, i) => (buf[off + i] = c.charCodeAt(0)));

  wr(0,  'RIFF'); dv.setUint32(4, 36 + n, true); wr(8,  'WAVE');
  wr(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);  // PCM
  dv.setUint16(22, 1, true);  // mono
  dv.setUint32(24, SR, true); dv.setUint32(28, SR, true);
  dv.setUint16(32, 1, true);  dv.setUint16(34, 8, true); // 8-bit
  wr(36, 'data'); dv.setUint32(40, n, true);

  for (let i = 0; i < n; i++) {
    const p = i / n;
    let env = 1, f = freq;
    switch (style) {
      case 'fall':  env = 1 - p;                      f = freq * (1.2 - 0.4 * p); break;
      case 'rise':  env = Math.sin(Math.PI * p * 0.6); f = freq * (0.6 + 0.8 * p); break;
      case 'blip':  env = Math.sin(Math.PI * p);       break;
      case 'decay': env = Math.exp(-5 * p);            break;
      case 'punch': env = Math.exp(-6 * p);            f = freq * (1.5 - p);       break;
    }
    buf[44 + i] = Math.max(0, Math.min(255, Math.round(128 + 80 * env * Math.sin(2 * Math.PI * f * (i / SR)))));
  }

  // btoa está disponible en React Native (Hermes) a partir de RN 0.70+
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

// ─── definición de sonidos ────────────────────────────────────────────────
const SOUNDS = {
  laser:    () => generateWavBase64(1300, 65,  'fall'),
  shoot:    () => generateWavBase64( 900, 90,  'fall'),
  jump:     () => generateWavBase64( 440, 160, 'rise'),
  coin:     () => generateWavBase64( 750, 110, 'blip'),
  kill:     () => generateWavBase64( 380, 190, 'punch'),
  hit:      () => generateWavBase64( 180, 220, 'decay'),
  powerup:  () => generateWavBase64( 600, 300, 'rise'),
  gameover: () => generateWavBase64( 160, 550, 'fall'),
};

// ─── estado interno ───────────────────────────────────────────────────────
const pool = {};  // { name: Sound }
let loaded = false;

// ─── API pública ──────────────────────────────────────────────────────────
async function preload() {
  if (!Audio || !FileSystem || loaded) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: false,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });
    const dir = FileSystem.cacheDirectory + 'arcade_sounds/';
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

    await Promise.all(
      Object.entries(SOUNDS).map(async ([name, gen]) => {
        const path = dir + name + '.wav';
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists) {
          await FileSystem.writeAsStringAsync(path, gen(), { encoding: FileSystem.EncodingType.Base64 });
        }
        const { sound } = await Audio.Sound.createAsync({ uri: path }, { volume: 0.75 });
        pool[name] = sound;
      })
    );
    loaded = true;
  } catch (e) {
    // silencioso – el juego sigue funcionando sin sonido
  }
}

async function play(name) {
  if (!loaded || !pool[name]) return;
  try {
    await pool[name].setPositionAsync(0);
    await pool[name].playAsync();
  } catch (_) {}
}

async function unload() {
  loaded = false;
  await Promise.all(Object.values(pool).map(s => s.unloadAsync().catch(() => {})));
  Object.keys(pool).forEach(k => delete pool[k]);
}

export default { preload, play, unload };
