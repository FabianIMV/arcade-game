/**
 * ui3d.js – carcasa estándar de los juegos 3D (Game3D) y piezas 2D de estilo "con profundidad".
 *
 *   <Game3D title emoji accent onExit score best hud phase onStart scene menuScene lines subtitle result fx pan>
 *     {controles 2D: Stick3D, ActionBtn, textos…}      ← solo se montan mientras phase === 'play'
 *   </Game3D>
 *
 * La escena 3D ocupa TODA la pantalla (detrás del notch); el HUD y los controles flotan encima.
 * Los textos son SIEMPRE 2D (Text de RN). Lee docs/ENGINE3D.md.
 */
import React, { useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, GameCtx, PlayArea, TouchBtn, TouchStick, alpha, glow, hx, tglow, useFX } from './kit';
import { Profile } from './meta';
import { World3D } from './World3D';
import { shade } from './prefabs';

// ─── Piezas 2D ────────────────────────────────────────────────────

/** Degradado vertical falso (varias franjas translúcidas). side: 'top' oscurece arriba · 'bottom' abajo. */
export function Fade({ side = 'bottom', h = 200, color = '#04040c', max = 0.85, steps = 28 }) {
  const rows = [];
  for (let i = 0; i < steps; i++) {
    const k = (i + 1) / steps;   // 0 = lejos del borde, 1 = junto al borde
    rows.push(<View key={i} style={{ height: h / steps + 0.5, backgroundColor: color, opacity: max * Math.pow(side === 'bottom' ? k : 1 - i / steps, 1.6) }} />);
  }
  return <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, [side]: 0, height: h }}>{rows}</View>;
}

/**
 * Btn3D – botón con profundidad: cara brillante + borde inferior que se hunde al pulsar.
 * size: 'lg' | 'md' | 'sm' · ghost: solo contorno · icon: emoji a la izquierda del texto
 */
export function Btn3D({ label, onPress, color = C.cyan, size = 'md', icon, ghost = false, testID, disabled, style, textStyle, wide }) {
  const [down, setDown] = useState(false);
  const S = { lg: { py: 16, px: 40, fs: 21, d: 7 }, md: { py: 12, px: 28, fs: 17, d: 5 }, sm: { py: 8, px: 18, fs: 13, d: 3 } }[size] || { py: 12, px: 28, fs: 17, d: 5 };
  const r = 16 + (size === 'lg' ? 6 : 0);
  const face = ghost ? 'rgba(8,10,24,0.55)' : color;
  return (
    <Pressable testID={testID} disabled={disabled} onPress={onPress} onPressIn={() => { setDown(true); hx.tick(); }} onPressOut={() => setDown(false)} hitSlop={8} style={[{ opacity: disabled ? 0.45 : 1, alignSelf: wide ? 'stretch' : 'center' }, style]}>
      <View style={{ paddingBottom: S.d }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: S.d, bottom: 0, borderRadius: r, backgroundColor: ghost ? alpha(color, 0.35) : shade(color, 0.5) }} />
        <View style={[{ borderRadius: r, backgroundColor: face, paddingVertical: S.py, paddingHorizontal: S.px, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', overflow: 'hidden', transform: [{ translateY: down ? S.d - 1 : 0 }], borderWidth: ghost ? 2 : 1, borderColor: ghost ? color : shade(color, 1.5) }, !ghost && glow(color, down ? 6 : 16, 0.55)]}>
          {!ghost && <View pointerEvents="none" style={{ position: 'absolute', left: 8, right: 8, top: 2, height: '42%', borderRadius: r, backgroundColor: 'rgba(255,255,255,0.28)' }} />}
          {icon ? <Text style={{ fontSize: S.fs + 2, marginRight: 8 }}>{icon}</Text> : null}
          <Text style={[{ color: ghost ? color : '#07070f', fontSize: S.fs, fontWeight: '900', letterSpacing: 1.5 }, textStyle]}>{label}</Text>
        </View>
      </View>
    </Pressable>
  );
}

/** Panel3D – tarjeta de cristal oscuro con borde de color y un brillo superior. */
export function Panel3D({ title, accent = C.cyan, children, style, pad = 14 }) {
  return (
    <View style={[{ borderRadius: 20, backgroundColor: 'rgba(8,10,26,0.66)', borderWidth: 1, borderColor: alpha(accent, 0.5), padding: pad, overflow: 'hidden' }, glow(accent, 14, 0.25), style]}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 14, right: 14, top: 0, height: 2, backgroundColor: alpha(accent, 0.8), borderRadius: 2 }} />
      {title ? <Text style={{ color: accent, fontSize: 11, fontWeight: '900', letterSpacing: 2.5, marginBottom: 8, textAlign: 'center' }}>{title}</Text> : null}
      {children}
    </View>
  );
}

/** Pastilla del HUD: <HudPill icon="💰" value="3/8" color={C.amber} label="COFRES" /> */
export function HudPill({ icon, label, value, color = C.cyan, style }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(6,8,20,0.58)', borderRadius: 14, borderWidth: 1, borderColor: alpha(color, 0.55), paddingHorizontal: 9, paddingVertical: 3 }, style]}>
      {icon ? <Text style={{ fontSize: 13, marginRight: 5 }}>{icon}</Text> : null}
      {label ? <Text style={{ color: alpha(color, 0.8), fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginRight: 5 }}>{label}</Text> : null}
      <Text style={{ color, fontSize: 14, fontWeight: '900' }}>{value}</Text>
    </View>
  );
}

/** Joystick con dibujo: <Stick3D testID="mv" v={move} side="left" /> (v = ref { x, y, on } que lee el juego). Multitáctil real. */
export function Stick3D({ testID, v, side = 'left', color = C.cyan, R = 44, style }) {
  return (
    <TouchStick testID={testID} v={v} R={R} style={[{ position: 'absolute', [side]: 0, bottom: 0, width: '40%', height: 190 }, style]}>
      <View pointerEvents="none" style={{ position: 'absolute', [side]: 16, bottom: 18, width: 104, height: 104, borderRadius: 52, borderWidth: 2, borderColor: alpha(color, v.on ? 0.8 : 0.4), backgroundColor: alpha(color, v.on ? 0.14 : 0.06) }}>
        <View style={{ position: 'absolute', left: 34 + v.x * 34, top: 34 + v.y * 34, width: 36, height: 36, borderRadius: 18, backgroundColor: alpha(color, v.on ? 0.9 : 0.5), ...glow(color, v.on ? 14 : 4, 0.8) }} />
      </View>
    </TouchStick>
  );
}

/** Botón de acción redondo, multitáctil. Posición con style: { position:'absolute', right:24, bottom:30 }. */
export function ActionBtn({ testID, label, icon, onDown, onUp, color = C.cyan, size = 66, style }) {
  const [on, setOn] = useState(false);
  return (
    <TouchBtn testID={testID} onDown={() => { setOn(true); if (onDown) onDown(); }} onUp={() => { setOn(false); if (onUp) onUp(); }}
      style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color, backgroundColor: alpha(color, on ? 0.55 : 0.2), alignItems: 'center', justifyContent: 'center', transform: [{ scale: on ? 0.93 : 1 }] }, glow(color, on ? 16 : 8, 0.7), style]}>
      {icon ? <Text pointerEvents="none" style={{ fontSize: size * 0.4 }}>{icon}</Text> : null}
      {label ? <Text pointerEvents="none" style={{ color: '#fff', fontWeight: '900', fontSize: icon ? 9 : 11, letterSpacing: 1 }}>{label}</Text> : null}
    </TouchBtn>
  );
}

/** Título grande con halo de color. */
function GlowTitle({ text, accent, size = 36 }) {
  const common = { fontSize: size, fontWeight: '900', letterSpacing: 2.5, textAlign: 'center' };
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ ...common, color: accent, position: 'absolute', ...tglow(accent, 26) }}>{text}</Text>
      <Text style={{ ...common, color: shade(accent, 1.65), textShadowColor: 'rgba(0,0,0,0.75)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 3 } }}>{text}</Text>
    </View>
  );
}

function useCountUp(target, active, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!active || typeof target !== 'number') return undefined;
    let raf, t0 = null;
    const step = t => { if (t0 == null) t0 = t; const k = Math.min(1, (t - t0) / ms); setV(target * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, target, ms]);
  return v;
}

// ─── Cámara orbital para las pantallas de inicio / fin ────────────
/**
 * orbitCam(scene, t, { c, r, h, speed, ly, fov }) → cam que da vueltas alrededor del punto de interés de la escena
 * (por defecto: cam.l de la escena, con radio/altura parecidos a su cámara). Úsala también para "cámaras cinemáticas".
 * drop (2.6): baja el punto de mira para que el sujeto quede en la mitad SUPERIOR de la pantalla (el título/botones tapan la inferior).
 */
export function orbitCam(scene, t, o = {}) {
  const cam = (scene && scene.cam) || { p: [0, 6, 10], l: [0, 0, 0] };
  let c, r, h, a0 = 0;
  if (o.c) c = o.c;
  else if (cam.l) c = cam.l;
  else { const y = cam.yaw || 0; c = [cam.p[0] - Math.sin(y) * 8, cam.p[1], cam.p[2] - Math.cos(y) * 8]; }
  if (cam.l) { const dx = cam.p[0] - cam.l[0], dz = cam.p[2] - cam.l[2]; r = o.r || Math.max(9, Math.hypot(dx, dz) * 1.25); h = o.h != null ? o.h : Math.max(3.2, (cam.p[1] - cam.l[1]) * 0.9); a0 = Math.atan2(dx, dz); }
  else { r = o.r || 9; h = o.h != null ? o.h : 3.5; }
  const a = a0 + t * (o.speed != null ? o.speed : 0.22);
  return { p: [c[0] + Math.sin(a) * r, c[1] + h + Math.sin(t * 0.6) * 0.35, c[2] + Math.cos(a) * r], l: [c[0], c[1] + (o.ly != null ? o.ly : 0.9) - (o.drop != null ? o.drop : 2.6), c[2]], fov: o.fov || cam.fov || 58 };
}

// ─── Game3D ───────────────────────────────────────────────────────
/**
 * Props:
 *   title, emoji, accent      identidad del juego (cabecera y pantallas)
 *   onExit                    volver al menú
 *   score, best, scoreLabel   marcador (cabecera durante 'play'; pantalla final)
 *   hud                       nodos 2D en la fila bajo la cabecera (usa <HudPill/>, Lives…)
 *   phase                     'ready' | 'play' | 'over'  (otros valores, p. ej. 'pause', cuentan como juego)
 *   onStart                   JUGAR / OTRA VEZ
 *   scene                     escena del motor (se reconstruye cada render)
 *   menuScene                 (opcional) escena o t => escena para ready/over; si falta se usa `scene`
 *   orbit                     (opcional) opciones de orbitCam, o una función t => cam
 *   subtitle, lines           pantalla de inicio: frase y reglas/controles
 *   result                    pantalla final: { won, title, subtitle, emoji, isNew, stats: [[etiqueta, valor], …] }
 *   fx, pan                   useFX() y usePan(fx, …) del juego (pan solo actúa en 'play')
 *   controlsAlways            monta los hijos también fuera de 'play'
 *   startLabel, retryLabel    textos de los botones
 */
// Capa en coordenadas de PANTALLA (las de project()/rayGround con SCREEN_W×SCREEN_H).
// Los hijos de Game3D empiezan bajo la cabecera; envuelve aquí los Text colocados sobre objetos 3D
// para que no queden corridos hacia abajo. Se mide a sí misma y compensa su desplazamiento.
export function ScreenLayer({ children }) {
  const ref = useRef(null);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const measure = () => {
    if (ref.current && ref.current.measureInWindow) ref.current.measureInWindow((x, y) => {
      if (Math.abs(x - off.x) > 0.5 || Math.abs(y - off.y) > 0.5) setOff({ x: x || 0, y: y || 0 });
    });
  };
  return (
    <View ref={ref} onLayout={measure} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: -off.x }, { translateY: -off.y }] }]}>{children}</View>
    </View>
  );
}

export function Game3D({ title, emoji, accent = C.cyan, onExit, score, best, scoreLabel = 'PUNTOS', hud, phase = 'ready', onStart, scene, menuScene, orbit, subtitle, lines, result, fx: fxIn, pan, controlsAlways, startLabel, retryLabel, children }) {
  const fxOwn = useFX(); const fx = fxIn || fxOwn;
  const gid = useContext(GameCtx);
  useEffect(() => { if (gid) Profile.played(gid); }, [gid]);
  const { width, height } = useWindowDimensions();
  const playing = phase !== 'ready' && phase !== 'over';

  // el motor pide la escena en cada frame: así la cámara orbital de los menús se anima sin re-renderizar el juego
  const ref = useRef({}); ref.current = { phase: playing, scene, menuScene, orbit, fx };
  const getScene = useRef(t => {
    const s = ref.current;
    let sc;
    if (s.phase) sc = s.scene;
    else {
      sc = typeof s.menuScene === 'function' ? s.menuScene(t) : (s.menuScene || s.scene);
      const cam = typeof s.orbit === 'function' ? s.orbit(t) : orbitCam(sc, t, s.orbit || {});
      sc = { ...sc, cam, shake: 0 };
    }
    if (!sc) return sc;
    const f = s.fx;
    if (sc.shake == null && f && f.shakeT > 0) sc = { ...sc, shake: f.shakeMag * (f.shakeT / f.shakeDur) * 0.03 };
    return sc;
  }).current;

  // animaciones de las pantallas inicio/fin
  const enter = useRef(new Animated.Value(0)).current, bob = useRef(new Animated.Value(0)).current, pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (playing) return undefined;
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, speed: 11, bounciness: 9 }).start();
    const l1 = Animated.loop(Animated.sequence([Animated.timing(bob, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), Animated.timing(bob, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true })]));
    const l2 = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true })]));
    l1.start(); l2.start();
    return () => { l1.stop(); l2.stop(); };
  }, [playing, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const over = phase === 'over';
  const won = !!(result && result.won);
  const shown = useCountUp(score, over);
  const scoreTxt = typeof score === 'number' ? String(Math.round(over ? shown : score)) : String(score == null ? '' : score);
  const slideY = enter.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });

  const header = playing ? (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingTop: 6 }}>
        <BackBtn onExit={onExit} />
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <Text numberOfLines={1} style={{ color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 1.4, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } }}>{emoji} {title}</Text>
        </View>
        {score != null && (
          <View style={{ alignItems: 'flex-end', minWidth: 70 }}>
            <Text style={{ color: '#fff', fontSize: 26, fontWeight: '900', lineHeight: 28, textShadowColor: accent, textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } }}>{score}</Text>
            {best != null && <Text style={{ color: C.amber, fontSize: 11, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } }}>🏆 {best}</Text>}
          </View>
        )}
      </View>
      {hud ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, minHeight: 28, marginTop: 6 }}>{hud}</View> : null}
    </>
  ) : (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingTop: 6 }}><BackBtn onExit={onExit} /></View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <PlayArea fx={fx} w={width} h={height} bg="#000" border="#000" noShake style={{ borderRadius: 0, borderWidth: 0 }} {...(playing && pan ? pan : null)}>
        <World3D getScene={getScene} />
        <SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {header}
          {(playing || controlsAlways) && <View pointerEvents="box-none" style={{ flex: 1 }}>{children}</View>}
        </SafeAreaView>
        {!playing && (
          <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 40 }]}>
            <Fade side="top" h={150} max={0.6} />
            <Fade side="bottom" h={over ? 430 : 400} max={0.92} />
            <SafeAreaView pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
              <Animated.View pointerEvents="box-none" style={{ alignItems: 'center', paddingHorizontal: 22, paddingBottom: 26, opacity: enter, transform: [{ translateY: slideY }] }}>
                <Animated.Text style={{ fontSize: 58, transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -9] }) }, { scale: enter }] }}>{over ? ((result && result.emoji) || (won ? '🏆' : emoji)) : emoji}</Animated.Text>
                <GlowTitle text={over ? ((result && result.title) || (won ? '¡VICTORIA!' : 'FIN DEL JUEGO')) : title} accent={won ? C.amber : accent} size={over ? 34 : 38} />
                {over ? (
                  <Panel3D accent={won ? C.amber : accent} style={{ marginTop: 14, alignSelf: 'stretch', maxWidth: 420, alignItems: 'center' }} pad={14}>
                    {result && result.subtitle ? <Text style={{ color: C.dim, fontSize: 13, textAlign: 'center', marginBottom: 6 }}>{result.subtitle}</Text> : null}
                    <Text style={{ color: C.dim, fontSize: 11, fontWeight: '800', letterSpacing: 2.5 }}>{scoreLabel}</Text>
                    <Text style={{ color: '#fff', fontSize: 52, fontWeight: '900', lineHeight: 58, ...tglow(accent, 14) }}>{scoreTxt}</Text>
                    {result && result.isNew ? (
                      <Animated.Text style={{ color: C.amber, fontSize: 16, fontWeight: '900', letterSpacing: 1.5, ...tglow(C.amber, 12), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] }}>🏆 ¡NUEVO RÉCORD!</Animated.Text>
                    ) : best != null && best > 0 ? <Text style={{ color: C.dim, fontSize: 13, fontWeight: '700' }}>Récord: {best}</Text> : null}
                    {result && result.stats && result.stats.length ? (
                      <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 10, gap: 18 }}>
                        {result.stats.map(([k, val], i) => <View key={i} style={{ alignItems: 'center' }}><Text style={{ color: C.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 }}>{k}</Text><Text style={{ color: '#fff', fontSize: 16, fontWeight: '900' }}>{val}</Text></View>)}
                      </View>
                    ) : null}
                  </Panel3D>
                ) : (
                  <>
                    {subtitle ? <Text style={{ color: '#e6ebff', fontSize: 14, marginTop: 6, textAlign: 'center', lineHeight: 20, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } }}>{subtitle}</Text> : null}
                    {best != null && best > 0 ? <View style={{ marginTop: 10 }}><HudPill icon="🏆" label="RÉCORD" value={best} color={C.amber} /></View> : null}
                    {lines && lines.length ? (
                      <Panel3D accent={accent} style={{ marginTop: 14, alignSelf: 'stretch', maxWidth: 420 }} pad={12}>
                        {lines.map((l, i) => <Text key={i} style={{ color: '#d6dcf5', fontSize: 13, lineHeight: 20, textAlign: 'center' }}>{l}</Text>)}
                      </Panel3D>
                    ) : null}
                  </>
                )}
                {/* el pulso es solo de opacidad (halo): un botón que cambia de tamaño rompe los tests con Playwright ("element is not stable") */}
                <View style={{ marginTop: 20 }}>
                  <Animated.View pointerEvents="none" style={{ position: 'absolute', left: -8, right: -8, top: -8, bottom: 2, borderRadius: 34, backgroundColor: won ? C.amber : accent, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.32] }) }} />
                  <Btn3D testID="start" size="lg" color={won ? C.amber : accent} icon={over ? '🔁' : '▶'} label={over ? (retryLabel || 'OTRA VEZ') : (startLabel || 'JUGAR')} onPress={onStart} />
                </View>
                {onExit ? <View style={{ marginTop: 12 }}><Btn3D testID="menu" size="sm" ghost color="#aab3d8" label="MENÚ" icon="☰" onPress={onExit} /></View> : null}
              </Animated.View>
            </SafeAreaView>
          </View>
        )}
      </PlayArea>
    </View>
  );
}

function BackBtn({ onExit }) {
  return (
    <Pressable testID="back" onPress={onExit} hitSlop={14} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(6,8,20,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginTop: -2 }}>‹</Text>
    </Pressable>
  );
}
