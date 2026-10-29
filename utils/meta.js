/**
 * meta.js – ajustes, efectos de sonido, perfil (XP, logros, reto diario) y avisos.
 * Lo usa kit.js, así que todos los juegos reciben sonido y progreso sin tocar nada.
 */
import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// expo-audio es opcional: si no está instalado, el juego sigue sin sonido
let Audio = null;
try { Audio = require('expo-audio'); } catch (_) {}

// ─── Ajustes ──────────────────────────────────────────────────────
const settings = { sound: true, haptics: true, quality: 'high' };   // quality: 'high' (sombras) | 'fast' (sin sombras)
const setListeners = new Set();
const notifySettings = () => setListeners.forEach(f => f());
AsyncStorage.getItem('@settings').then(v => {
  if (v) { try { Object.assign(settings, JSON.parse(v)); notifySettings(); } catch (_) {} }
}).catch(() => {});
export const getSettings = () => settings;
export function setSetting(key, value) {
  settings[key] = value;
  AsyncStorage.setItem('@settings', JSON.stringify(settings)).catch(() => {});
  notifySettings();
}
export function useSettings() {
  const [, force] = useReducer(x => (x + 1) % 1e9, 0);
  useEffect(() => { setListeners.add(force); return () => setListeners.delete(force); }, []);
  return [settings, setSetting];
}

// ─── Síntesis de sonido (WAV 11 kHz, 8 bit, mono) ─────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b || 0) >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | ((c || 0) >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}
export function synthWav(notes) {
  const SR = 11025;
  const lens = notes.map(n => Math.floor((SR * n[1]) / 1000));
  const total = lens.reduce((a, b) => a + b, 0);
  const buf = new Uint8Array(44 + total);
  const dv = new DataView(buf.buffer);
  const wr = (off, s) => { for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + total, true); wr(8, 'WAVE'); wr(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  wr(36, 'data'); dv.setUint32(40, total, true);
  let pos = 44;
  notes.forEach((n, k) => {
    const [freq, , style] = n;
    for (let i = 0; i < lens[k]; i++) {
      const p = i / lens[k];
      let env = 1; let f = freq;
      if (style === 'blip') env = Math.sin(Math.PI * Math.min(1, p * 1.15));
      else if (style === 'decay') env = Math.exp(-5 * p);
      else if (style === 'punch') { env = Math.exp(-6 * p); f = freq * (1.5 - p); }
      else if (style === 'fall') { env = 1 - p; f = freq * (1.2 - 0.5 * p); }
      const sq = Math.sin(2 * Math.PI * f * (i / SR)) + 0.35 * Math.sin(4 * Math.PI * f * (i / SR));
      buf[pos++] = Math.max(0, Math.min(255, Math.round(128 + 62 * env * sq)));
    }
  });
  return toBase64(buf);
}
export const SFX_DEFS = {
  tick: [[1500, 22, 'decay']],
  tap: [[900, 38, 'blip']],
  hit: [[520, 75, 'punch']],
  heavy: [[210, 120, 'punch']],
  good: [[660, 70, 'blip'], [880, 110, 'blip']],
  warn: [[420, 80, 'blip'], [420, 80, 'blip']],
  bad: [[240, 170, 'fall']],
  die: [[360, 110, 'fall'], [250, 150, 'fall'], [150, 320, 'fall']],
  win: [[523, 90, 'blip'], [659, 90, 'blip'], [784, 90, 'blip'], [1047, 240, 'blip']],
};
const sfxPool = {}; const sfxLast = {}; let sfxState = 0; // 0 sin cargar · 1 cargando · 2 listo
async function loadSfx() {
  if (!Audio || sfxState) return;
  sfxState = 1;
  try {
    if (Audio.setAudioModeAsync) await Audio.setAudioModeAsync({ playsInSilentMode: false, shouldPlayInBackground: false });
    Object.keys(SFX_DEFS).forEach(name => {
      const uri = `data:audio/wav;base64,${synthWav(SFX_DEFS[name])}`;
      const player = Audio.createAudioPlayer({ uri });
      player.volume = 0.8;
      sfxPool[name] = player;
    });
  } catch (_) { /* sin sonido */ }
  sfxState = 2;
}
export function playSfx(name) {
  if (!settings.sound || !Audio) return;
  if (!sfxState) { loadSfx(); return; }
  const p = sfxPool[name]; const now = Date.now();
  if (!p || now - (sfxLast[name] || 0) < 45) return;
  sfxLast[name] = now;
  try { const r = p.seekTo(0); if (r && r.then) r.then(() => p.play()).catch(() => {}); else p.play(); } catch (_) {}
}

// ─── Avisos (toasts) ──────────────────────────────────────────────
const toastListeners = new Set();
export const toast = (text, emoji = '🏆') => toastListeners.forEach(f => f({ text, emoji, id: Math.random() }));
export function ToastHost() {
  const [queue, setQueue] = useState([]);
  const [cur, setCur] = useState(null);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { const f = t => setQueue(q => [...q, t]); toastListeners.add(f); return () => toastListeners.delete(f); }, []);
  useEffect(() => {
    if (cur || !queue.length) return;
    const next = queue[0]; setQueue(q => q.slice(1)); setCur(next);
    a.setValue(0);
    Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(2400),
      Animated.timing(a, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start(() => setCur(null));
  }, [queue, cur]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cur) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 44, left: 16, right: 16, zIndex: 999, alignItems: 'center', opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(16,18,40,0.96)', borderRadius: 18, borderWidth: 1.5, borderColor: '#ffc233', paddingVertical: 10, paddingHorizontal: 16, shadowColor: '#ffc233', shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } }}>
        <Text style={{ fontSize: 24, marginRight: 10 }}>{cur.emoji}</Text>
        <Text style={{ color: '#f4f6ff', fontWeight: '800', fontSize: 14, flexShrink: 1 }}>{cur.text}</Text>
      </View>
    </Animated.View>
  );
}

// ─── Perfil: XP, nivel, logros, reto diario, favoritos ────────────
const PKEY = '@profile';
const blank = () => ({ xp: 0, plays: {}, finished: 0, records: 0, ach: {}, daily: { date: '', id: '', done: false }, streak: 0, lastDone: '', favs: {} });
let prof = blank(); let totalGames = 40; let sessionRec = {}; const lastFinish = {};
const profListeners = new Set();
const notifyProf = () => profListeners.forEach(f => f());
const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => fmt(new Date());
const yesterday = () => fmt(new Date(Date.now() - 86400000));
const saveProf = () => AsyncStorage.setItem(PKEY, JSON.stringify(prof)).catch(() => {});
AsyncStorage.getItem(PKEY).then(v => { if (v) { try { prof = { ...blank(), ...JSON.parse(v) }; notifyProf(); } catch (_) {} } }).catch(() => {});

export const levelOf = xp => Math.floor(Math.sqrt(xp / 40)) + 1;
export const levelInfo = xp => { const L = levelOf(xp); const a = 40 * (L - 1) ** 2; const b = 40 * L ** 2; return { level: L, into: xp - a, need: b - a, pct: (xp - a) / (b - a) }; };

export const ACHIEVEMENTS = [
  { id: 'first', emoji: '🎮', name: 'Primera partida', desc: 'Termina tu primera partida', test: p => p.finished >= 1 },
  { id: 'explorer', emoji: '🧭', name: 'Explorador', desc: 'Prueba 10 juegos distintos', test: p => Object.keys(p.plays).length >= 10 },
  { id: 'collector', emoji: '🗂️', name: 'Coleccionista', desc: 'Prueba todos los juegos', test: p => Object.keys(p.plays).length >= totalGames },
  { id: 'rec5', emoji: '📈', name: 'Recordista', desc: 'Bate 5 récords', test: p => p.records >= 5 },
  { id: 'rec25', emoji: '👑', name: 'Leyenda', desc: 'Bate 25 récords', test: p => p.records >= 25 },
  { id: 'play50', emoji: '🔁', name: 'Incansable', desc: 'Termina 50 partidas', test: p => p.finished >= 50 },
  { id: 'play200', emoji: '🔥', name: 'Adicto al arcade', desc: 'Termina 200 partidas', test: p => p.finished >= 200 },
  { id: 'daily1', emoji: '🎯', name: 'Reto cumplido', desc: 'Completa un reto del día', test: p => p.streak >= 1 },
  { id: 'daily3', emoji: '📅', name: 'Constante', desc: 'Racha de 3 días de retos', test: p => p.streak >= 3 },
  { id: 'daily7', emoji: '🏅', name: 'Imparable', desc: 'Racha de 7 días de retos', test: p => p.streak >= 7 },
  { id: 'lv5', emoji: '⭐', name: 'Veterano', desc: 'Llega al nivel 5', test: p => levelOf(p.xp) >= 5 },
  { id: 'fav3', emoji: '💖', name: 'Curador', desc: 'Marca 3 favoritos', test: p => Object.values(p.favs).filter(Boolean).length >= 3 },
];
const checkAch = () => {
  let again = true;
  while (again) {
    again = false;
    ACHIEVEMENTS.forEach(a => {
      if (!prof.ach[a.id] && a.test(prof)) { prof.ach[a.id] = Date.now(); prof.xp += 30; toast(`Logro: ${a.name} (+30 XP)`, a.emoji); playSfx('win'); again = true; }
    });
  }
};
export const Profile = {
  get: () => prof,
  subscribe: f => { profListeners.add(f); return () => profListeners.delete(f); },
  setTotal: n => { totalGames = n; },
  played: id => { prof.plays[id] = (prof.plays[id] || 0) + 1; sessionRec[id] = false; checkAch(); saveProf(); notifyProf(); },
  finished: (id, score, isNew) => {
    const now = Date.now();
    const fresh = now - (lastFinish[id] || 0) > 8000;
    lastFinish[id] = now;
    const before = levelOf(prof.xp);
    if (fresh) { prof.finished += 1; prof.xp += 10; }
    if (isNew && !sessionRec[id]) { sessionRec[id] = true; prof.records += 1; prof.xp += 25; toast('¡Nuevo récord! +25 XP', '🏆'); }
    const d = prof.daily;
    if (d.id === id && d.date === today() && !d.done && score > 0) {
      d.done = true; prof.streak = prof.lastDone === yesterday() ? prof.streak + 1 : 1; prof.lastDone = today(); prof.xp += 50;
      toast(`Reto del día cumplido · racha ${prof.streak} (+50 XP)`, '🎯');
    }
    checkAch();
    const after = levelOf(prof.xp);
    if (after > before) toast(`¡Subiste al nivel ${after}!`, '⬆️');
    saveProf(); notifyProf();
  },
  setDaily: id => {
    if (prof.daily.date !== today()) {
      prof.daily = { date: today(), id, done: false };
      if (prof.lastDone && prof.lastDone !== yesterday() && prof.lastDone !== today()) prof.streak = 0;
      saveProf(); notifyProf();
    }
  },
  toggleFav: id => { prof.favs[id] = !prof.favs[id]; checkAch(); saveProf(); notifyProf(); },
  reset: async () => {
    prof = blank(); sessionRec = {};
    try { const keys = await AsyncStorage.getAllKeys(); const del = keys.filter(k => k.startsWith('@best:') || k === PKEY); if (del.length) await AsyncStorage.multiRemove(del); } catch (_) {}
    saveProf(); notifyProf();
  },
};
export function useProfile() {
  const [, force] = useReducer(x => (x + 1) % 1e9, 0);
  useEffect(() => Profile.subscribe(force), []);
  return prof;
}
