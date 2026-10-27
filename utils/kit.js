/**
 * kit.js – sistema de diseño y "juice" compartido por todos los juegos.
 * Tema, hápticos, mejor puntuación persistente, game loop, partículas,
 * textos flotantes, screen shake, pantallas de inicio / game over.
 */
import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react';
import {
  Animated, Dimensions, Easing, PanResponder, Platform, Pressable, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Profile, getSettings, playSfx } from './meta';

export const GameCtx = createContext(null);

// ─── Medidas ──────────────────────────────────────────────────────
const { width: W, height: H } = Dimensions.get('window');
export const SCREEN_W = W;
export const SCREEN_H = H;
export const AREA_W = Math.min(W - 20, 460);
export const AREA_H = Math.max(360, Math.min(H - 230, 640));
// Alto del área de juego cuando la pantalla lleva una barra de controles abajo (footer)
export const AREA_HF = Math.max(330, AREA_H - 60);

// ─── Tema ─────────────────────────────────────────────────────────
export const C = {
  bg: '#06060f', panel: '#0d0e1d', panel2: '#151731', line: '#262a4a',
  text: '#f4f6ff', dim: '#8b92b8',
  cyan: '#22e6ff', pink: '#ff3df2', lime: '#7dff6b', amber: '#ffc233',
  red: '#ff4d6d', violet: '#9b6bff', blue: '#4d8bff', orange: '#ff8a3d',
};
export const glow = (color, radius = 12, opacity = 0.9) => ({
  shadowColor: color, shadowOpacity: opacity, shadowRadius: radius, shadowOffset: { width: 0, height: 0 },
});
export const tglow = (color, radius = 10) => ({
  textShadowColor: color, textShadowRadius: radius, textShadowOffset: { width: 0, height: 0 },
});
export const alpha = (hex, a) => {
  // '#rrggbb' + 0..1 -> rgba()
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(f, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

// ─── Utilidades ───────────────────────────────────────────────────
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const lerp = (a, b, t) => a + (b - a) * t;
let _uid = 0;
export const uid = () => ++_uid;
export const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
export const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ─── Hápticos ─────────────────────────────────────────────────────
const safe = fn => { try { const r = fn(); if (r && r.catch) r.catch(() => {}); } catch (_) {} };
const later = (fn, ms) => setTimeout(() => safe(fn), ms);
const imp = s => () => { if (getSettings().haptics) return Haptics.impactAsync(s); return null; };
// Patrón de vibración: lista de [ms, estilo] (estilo: 'L' | 'M' | 'H' | 'X' = éxito | 'W' = aviso | 'E' = error)
const STY = { L: Haptics.ImpactFeedbackStyle.Light, M: Haptics.ImpactFeedbackStyle.Medium, H: Haptics.ImpactFeedbackStyle.Heavy };
const NOTE = { X: Haptics.NotificationFeedbackType.Success, W: Haptics.NotificationFeedbackType.Warning, E: Haptics.NotificationFeedbackType.Error };
const buzz = steps => { if (!getSettings().haptics) return; let t = 0; for (const [ms, k] of steps) { t += ms; later(() => (NOTE[k] ? Haptics.notificationAsync(NOTE[k]) : Haptics.impactAsync(STY[k])), t); } };
export const hx = {
  tick: () => { playSfx('tick'); safe(imp(STY.L)); },
  tap: () => { playSfx('tap'); buzz([[0, 'M']]); },
  hit: () => { playSfx('hit'); buzz([[0, 'H'], [60, 'M']]); },
  heavy: () => { playSfx('heavy'); buzz([[0, 'H'], [50, 'H'], [50, 'M']]); },
  good: () => { playSfx('good'); buzz([[0, 'X'], [40, 'M']]); },
  warn: () => { playSfx('warn'); buzz([[0, 'W'], [90, 'M']]); },
  bad: () => { playSfx('bad'); buzz([[0, 'E'], [70, 'H'], [70, 'H']]); },
  die: () => { playSfx('die'); buzz([[0, 'E'], [90, 'H'], [90, 'H'], [90, 'H'], [120, 'H'], [160, 'M']]); },
  win: () => { playSfx('win'); buzz([[0, 'X'], [120, 'M'], [120, 'H'], [120, 'M'], [120, 'H'], [160, 'X']]); },
};

// ─── Mejor puntuación persistente ─────────────────────────────────
export function useBest(id, lowerIsBetter = false) {
  const key = `@best:${id}`;
  const [best, setBest] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    AsyncStorage.getItem(key).then(v => {
      if (v != null) { ref.current = parseFloat(v) || 0; setBest(ref.current); }
    }).catch(() => {});
  }, [key]);
  // devuelve true si es un nuevo récord
  const submit = useCallback(score => {
    const cur = ref.current;
    const better = lowerIsBetter ? (cur === 0 || score < cur) : score > cur;
    if (better && score > 0) {
      ref.current = score;
      setBest(score);
      AsyncStorage.setItem(key, String(score)).catch(() => {});
      Profile.finished(id, score, true);
      return true;
    }
    Profile.finished(id, score, false);
    return false;
  }, [key, lowerIsBetter, id]);
  return [best, submit];
}

// ─── Game loop (requestAnimationFrame, dt en segundos) ────────────
export function useLoop(active, fn) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [, force] = useReducer(x => (x + 1) % 1e9, 0);
  useEffect(() => {
    if (!active) return undefined;
    let raf;
    let last = null;
    const step = t => {
      const dt = last == null ? 0.016 : Math.min(0.05, (t - last) / 1000);
      last = t;
      fnRef.current(dt, t);
      force();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return force;
}

// Re-render manual
export function useForce() {
  const [, force] = useReducer(x => (x + 1) % 1e9, 0);
  return force;
}

// Timeouts que se limpian solos al desmontar
export function useTimeouts() {
  const ids = useRef(new Set());
  useEffect(() => () => { ids.current.forEach(clearTimeout); ids.current.clear(); }, []);
  return useCallback((fn, ms) => {
    const id = setTimeout(() => { ids.current.delete(id); fn(); }, ms);
    ids.current.add(id);
    return id;
  }, []);
}

// ─── FX: partículas, textos flotantes, anillos, shake, flash ──────
function createFX() {
  const fx = {
    parts: [], pops: [], rings: [], shakeT: 0, shakeDur: 0.25, shakeMag: 0,
    flashC: null, flashA: 0, ox: 0, oy: 0, _wake: null,
  };
  const wake = () => { if (fx._wake) fx._wake(); };
  fx.burst = (x, y, color = C.cyan, n = 12, speed = 180, life = 0.6, size = 5) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      fx.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: size * (0.6 + Math.random() * 0.8) });
    }
    if (fx.parts.length > 140) fx.parts.splice(0, fx.parts.length - 140);
    wake();
  };
  fx.pop = (x, y, text, color = C.text, size = 18) => {
    fx.pops.push({ x, y, text: String(text), color, size, life: 0.9, max: 0.9 });
    if (fx.pops.length > 14) fx.pops.shift();
    wake();
  };
  fx.ring = (x, y, color = C.cyan, r = 50) => { fx.rings.push({ x, y, color, r, life: 0.45, max: 0.45 }); wake(); };
  fx.shake = (mag = 6, dur = 0.25) => { fx.shakeMag = mag; fx.shakeDur = dur; fx.shakeT = dur; wake(); };
  fx.flash = (color = '#ffffff', a = 0.25) => { fx.flashC = color; fx.flashA = a; wake(); };
  fx.clear = () => { fx.parts.length = 0; fx.pops.length = 0; fx.rings.length = 0; fx.shakeT = 0; fx.flashA = 0; };
  fx._step = dt => {
    for (let i = fx.parts.length - 1; i >= 0; i--) {
      const p = fx.parts[i];
      p.life -= dt;
      if (p.life <= 0) { fx.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.vx *= 0.985;
    }
    for (let i = fx.pops.length - 1; i >= 0; i--) {
      const p = fx.pops[i];
      p.life -= dt; p.y -= 38 * dt;
      if (p.life <= 0) fx.pops.splice(i, 1);
    }
    for (let i = fx.rings.length - 1; i >= 0; i--) {
      fx.rings[i].life -= dt;
      if (fx.rings[i].life <= 0) fx.rings.splice(i, 1);
    }
    if (fx.shakeT > 0) fx.shakeT = Math.max(0, fx.shakeT - dt);
    if (fx.flashA > 0) fx.flashA = Math.max(0, fx.flashA - dt * 1.6);
    return fx.parts.length > 0 || fx.pops.length > 0 || fx.rings.length > 0 || fx.shakeT > 0 || fx.flashA > 0;
  };
  return fx;
}
export function useFX() {
  const ref = useRef(null);
  if (!ref.current) ref.current = createFX();
  return ref.current;
}

/**
 * Área de juego con bordes redondeados, capa de FX y screen shake.
 * Los hijos se posicionan en coordenadas locales (0..AREA_W, 0..AREA_H).
 */
export function PlayArea({ fx, children, style, bg = C.panel, border = C.line, w = AREA_W, h = AREA_H, ...rest }) {
  const [, force] = useReducer(x => (x + 1) % 1e9, 0);
  const box = useRef(null);
  useEffect(() => {
    if (!fx) return undefined;
    let raf = null;
    let last = 0;
    const step = t => {
      const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
      last = t;
      const alive = fx._step(dt);
      force();
      raf = alive ? requestAnimationFrame(step) : null;
    };
    fx._wake = () => { if (raf == null) { last = 0; raf = requestAnimationFrame(step); } };
    return () => { if (raf != null) cancelAnimationFrame(raf); fx._wake = null; };
  }, [fx]);

  const onLayout = () => {
    if (box.current && box.current.measureInWindow && fx) {
      box.current.measureInWindow((x, y) => { fx.ox = x; fx.oy = y; });
    }
  };
  useEffect(() => { const id = setTimeout(onLayout, 350); return () => clearTimeout(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  let sx = 0; let sy = 0;
  if (fx && fx.shakeT > 0) {
    const k = fx.shakeT / fx.shakeDur;
    sx = (Math.random() - 0.5) * 2 * fx.shakeMag * k;
    sy = (Math.random() - 0.5) * 2 * fx.shakeMag * k;
  }
  return (
    <View
      ref={box}
      onLayout={onLayout}
      onTouchStart={onLayout}
      style={[{ width: w, height: h, borderRadius: 18, overflow: 'hidden', backgroundColor: bg, borderWidth: 1, borderColor: border, alignSelf: 'center' }, Platform.OS === 'web' ? { userSelect: 'none' } : null, style]}
      {...rest}
    >
      <View style={{ flex: 1, transform: [{ translateX: sx }, { translateY: sy }] }}>{children}</View>
      {fx && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {fx.rings.map((r, i) => {
            const t = 1 - r.life / r.max;
            const d = r.r * 2 * (0.2 + t * 0.8);
            return <View key={`r${i}`} style={{ position: 'absolute', left: r.x - d / 2, top: r.y - d / 2, width: d, height: d, borderRadius: d / 2, borderWidth: 2, borderColor: r.color, opacity: 1 - t }} />;
          })}
          {fx.parts.map((p, i) => (
            <View key={`p${i}`} style={{ position: 'absolute', left: p.x - p.size / 2, top: p.y - p.size / 2, width: p.size, height: p.size, borderRadius: p.size / 2, backgroundColor: p.color, opacity: Math.max(0, p.life / p.max), ...glow(p.color, 4, 0.8) }} />
          ))}
          {fx.pops.map((p, i) => (
            <Text key={`t${i}`} style={{ position: 'absolute', left: p.x - 140, width: 280, top: p.y - p.size, textAlign: 'center', color: p.color, fontSize: p.size, fontWeight: '900', opacity: Math.min(1, (p.life / p.max) * 1.6), textShadowColor: p.color, textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } }}>{p.text}</Text>
          ))}
          {fx.flashA > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: fx.flashC, opacity: fx.flashA }]} />}
        </View>
      )}
    </View>
  );
}

// Drag/tap → coordenadas locales del PlayArea. handlers: {down(x,y), move(x,y), up(x,y)}
export function usePan(fx, handlers) {
  const hRef = useRef(handlers);
  hRef.current = handlers;
  const pr = useRef(null);
  if (!pr.current) {
    pr.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // no robar el gesto a botones hijos por un pequeño temblor del dedo
      onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 8,
      onPanResponderGrant: (e, g) => { const h = hRef.current; if (h.down) h.down(g.x0 - fx.ox, g.y0 - fx.oy, e); },
      onPanResponderMove: (e, g) => { const h = hRef.current; if (h.move) h.move(g.moveX - fx.ox, g.moveY - fx.oy, g); },
      onPanResponderRelease: (e, g) => { const h = hRef.current; if (h.up) h.up(g.moveX - fx.ox, g.moveY - fx.oy, g); },
      onPanResponderTerminate: (e, g) => { const h = hRef.current; if (h.up) h.up(g.moveX - fx.ox, g.moveY - fx.oy, g); },
    });
  }
  return pr.current.panHandlers;
}

// ─── Componentes ──────────────────────────────────────────────────
export function Btn({ label, onPress, color = C.cyan, ghost = false, small = false, testID, style, textStyle, disabled }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = v => Animated.spring(s, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => to(0.93)}
      onPressOut={() => to(1)}
      hitSlop={8}
    >
      <Animated.View
        style={[{
          transform: [{ scale: s }],
          paddingHorizontal: small ? 16 : 28, paddingVertical: small ? 9 : 14,
          borderRadius: 40, backgroundColor: ghost ? 'transparent' : color, borderWidth: ghost ? 1.5 : 0,
          borderColor: color, opacity: disabled ? 0.4 : 1, alignItems: 'center',
        }, !ghost && glow(color, 14, 0.55), style]}
      >
        <Text style={[{ color: ghost ? color : '#04040c', fontSize: small ? 13 : 17, fontWeight: '900', letterSpacing: 1 }, textStyle]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

export function Pill({ label, value, color = C.cyan, style }) {
  return (
    <View style={[{ backgroundColor: alpha(color, 0.12), borderColor: alpha(color, 0.5), borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center', minWidth: 58 }, style]}>
      <Text style={{ color: alpha(color, 0.85), fontSize: 9, fontWeight: '800', letterSpacing: 1.5 }}>{label}</Text>
      <Text style={{ color, fontSize: 17, fontWeight: '900' }}>{value}</Text>
    </View>
  );
}

export function Lives({ n, max = 3, icon = '❤️', off = '🖤' }) {
  const items = [];
  for (let i = 0; i < max; i++) items.push(<Text key={i} style={{ fontSize: 16, marginHorizontal: 1 }}>{i < n ? icon : off}</Text>);
  return <View style={{ flexDirection: 'row' }}>{items}</View>;
}

export function Bar({ value, max = 1, color = C.cyan, h = 8, w, style }) {
  const p = clamp(value / max, 0, 1);
  return (
    <View style={[{ height: h, width: w, borderRadius: h / 2, backgroundColor: alpha(color, 0.15), overflow: 'hidden' }, style]}>
      <View style={{ width: `${p * 100}%`, height: '100%', backgroundColor: color, borderRadius: h / 2 }} />
    </View>
  );
}

export function Combo({ n, color = C.amber }) {
  if (n < 2) return null;
  return (
    <View style={{ backgroundColor: alpha(color, 0.18), borderColor: color, borderWidth: 1, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 2, ...glow(color, 8, 0.6) }}>
      <Text style={{ color, fontWeight: '900', fontSize: 13 }}>COMBO ×{n}</Text>
    </View>
  );
}

/** Estructura de pantalla estándar: cabecera + HUD + área de juego */
export function GameScreen({ title, emoji, accent = C.cyan, onExit, score, best, scoreLabel = 'PUNTOS', bestLabel = 'RÉCORD', hud, children, footer }) {
  const gid = useContext(GameCtx);
  useEffect(() => { if (gid) Profile.played(gid); }, [gid]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable testID="back" onPress={onExit} hitSlop={14} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.text, fontSize: 20, fontWeight: '800', marginTop: -2 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <Text numberOfLines={1} style={{ color: accent, fontSize: 17, fontWeight: '900', letterSpacing: 1.2, ...tglow(accent, 8, 0.8) }}>{emoji} {title}</Text>
        </View>
        {score != null && (
          <View style={{ alignItems: 'flex-end', minWidth: 70 }}>
            <Text style={{ color: accent, fontSize: 24, fontWeight: '900', lineHeight: 26, ...tglow(accent, 8, 0.7) }}>{score}</Text>
            {best != null && <Text style={{ color: C.amber, fontSize: 11, fontWeight: '800' }}>🏆 {best}</Text>}
          </View>
        )}
      </View>
      {hud ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 26, marginBottom: 4 }}>{hud}</View> : <View style={{ height: 6 }} />}
      <View style={{ flex: 1, alignItems: 'center' }}>{children}</View>
      {footer}
    </SafeAreaView>
  );
}

/** Pantalla de inicio / fin de partida sobre el PlayArea */
export function Overlay({ show, kind = 'start', emoji, title, subtitle, lines, score, best, isNew, accent = C.cyan, startLabel, onStart, onExit, scoreLabel = 'PUNTOS', extra, noStart }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (show) {
      a.setValue(0);
      Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 9 }).start();
    }
  }, [show, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show) return null;
  const over = kind === 'over' || kind === 'win';
  return (
    <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,4,12,0.82)', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 18 }}>
      <Animated.View style={{ alignItems: 'center', opacity: a, transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }}>
        {emoji ? <Text style={{ fontSize: 54, marginBottom: 6 }}>{emoji}</Text> : null}
        <Text style={{ color: accent, fontSize: 30, fontWeight: '900', letterSpacing: 2, textAlign: 'center', ...tglow(accent, 14, 0.9) }}>{title}</Text>
        {subtitle ? <Text style={{ color: C.dim, fontSize: 14, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>{subtitle}</Text> : null}
        {over && score != null && (
          <View style={{ alignItems: 'center', marginTop: 16 }}>
            <Text style={{ color: C.dim, fontSize: 11, fontWeight: '800', letterSpacing: 2 }}>{scoreLabel}</Text>
            <Text style={{ color: C.text, fontSize: 46, fontWeight: '900' }}>{score}</Text>
            {isNew ? (
              <Text style={{ color: C.amber, fontSize: 15, fontWeight: '900', letterSpacing: 1, ...tglow(C.amber, 10, 0.9) }}>🏆 ¡NUEVO RÉCORD!</Text>
            ) : best != null && best > 0 ? (
              <Text style={{ color: C.dim, fontSize: 13, fontWeight: '700' }}>Récord: {best}</Text>
            ) : null}
          </View>
        )}
        {extra}
        {lines && lines.length > 0 && (
          <View style={{ marginTop: 14, alignItems: 'center' }}>
            {lines.map((l, i) => <Text key={i} style={{ color: C.dim, fontSize: 13, lineHeight: 20, textAlign: 'center' }}>{l}</Text>)}
          </View>
        )}
        <View style={{ marginTop: 22, alignItems: 'center', gap: 12 }}>
          {noStart ? null : <Btn testID="start" label={startLabel || (over ? 'OTRA VEZ' : 'JUGAR')} color={accent} onPress={onStart} />}
          {over && onExit ? <Btn label="MENÚ" ghost small color={C.dim} onPress={onExit} /> : null}
        </View>
      </Animated.View>
    </View>
  );
}

/** Fondo con rejilla sutil (retro-futurista) */
export function GridBg({ color = C.cyan, step = 40, w = AREA_W, h = AREA_H, offset = 0 }) {
  const lines = [];
  const o = ((offset % step) + step) % step;
  for (let y = -step + o; y < h; y += step) lines.push(<View key={`h${y}`} style={{ position: 'absolute', left: 0, right: 0, top: y, height: 1, backgroundColor: alpha(color, 0.07) }} />);
  for (let x = step / 2; x < w; x += step) lines.push(<View key={`v${x}`} style={{ position: 'absolute', top: 0, bottom: 0, left: x, width: 1, backgroundColor: alpha(color, 0.05) }} />);
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{lines}</View>;
}

/** Campo de estrellas con parallax (offset en px) */
export function Starfield({ stars, offset = 0, h = AREA_H }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {stars.map((s, i) => {
        const y = (s.y + offset * s.z) % h;
        return <View key={i} style={{ position: 'absolute', left: s.x, top: y < 0 ? y + h : y, width: s.s, height: s.s, borderRadius: s.s, backgroundColor: '#fff', opacity: 0.25 + s.z * 0.45 }} />;
      })}
    </View>
  );
}
export const makeStars = (n = 36, w = AREA_W, h = AREA_H) =>
  Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, s: 1 + Math.random() * 1.8, z: 0.3 + Math.random() * 0.7 }));

// ─── Multi-touch real ─────────────────────────────────────────────
// Pressable y PanResponder usan el "responder" de React Native, que solo deja UN control activo
// a la vez (no puedes correr y saltar juntos). Los eventos de toque crudos (onTouchStart/Move/End)
// llegan a cada vista por separado, así que estos controles funcionan con varios dedos a la vez.
const touchesOf = ne => (ne.identifier != null ? [ne] : Array.from(ne.changedTouches || []));
const activeIds = ne => new Set(Array.from(ne.touches || []).map(t => t.identifier));

// Botón de mantener pulsado: onDown al primer dedo, onUp cuando se levanta el último.
export function TouchBtn({ testID, onDown, onUp, style, children }) {
  const ids = useRef(new Set()).current;
  const down = e => { const had = ids.size > 0; touchesOf(e.nativeEvent).forEach(t => ids.add(t.identifier)); if (!had && ids.size && onDown) onDown(); };
  const up = e => {
    if (!ids.size) return;
    const ne = e.nativeEvent; touchesOf(ne).forEach(t => ids.delete(t.identifier));
    const act = activeIds(ne); for (const i of [...ids]) if (!act.has(i)) ids.delete(i);
    if (!ids.size && onUp) onUp();
  };
  return <View testID={testID} style={style} onTouchStart={down} onTouchEnd={up} onTouchCancel={up}>{children}</View>;
}

// Joystick relativo: v = { x, y ∈ [-1, 1], on } según cuánto arrastra el dedo desde donde tocó.
export function TouchStick({ testID, v, R = 50, style, children }) {
  const o = useRef({ id: null, ox: 0, oy: 0 }).current;
  const reset = () => { o.id = null; v.x = 0; v.y = 0; v.on = false; };
  const start = e => { if (o.id != null) return; const t = touchesOf(e.nativeEvent)[0]; if (!t) return; o.id = t.identifier; o.ox = t.pageX; o.oy = t.pageY; v.x = 0; v.y = 0; v.on = true; };
  const move = e => {
    if (o.id == null) return; const ne = e.nativeEvent;
    const t = touchesOf(ne).find(k => k.identifier === o.id) || Array.from(ne.touches || []).find(k => k.identifier === o.id); if (!t) return;
    let dx = t.pageX - o.ox, dy = t.pageY - o.oy; const m = Math.hypot(dx, dy); if (m > R) { dx *= R / m; dy *= R / m; }
    v.x = dx / R; v.y = dy / R;
  };
  const end = e => { if (o.id == null) return; const ne = e.nativeEvent; if (touchesOf(ne).some(t => t.identifier === o.id) || !activeIds(ne).has(o.id)) reset(); };
  return <View testID={testID} style={style} onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={end}>{children}</View>;
}
