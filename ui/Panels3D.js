/**
 * Panels3D.js – paneles del menú (Ajustes y Perfil/Logros) como cristal sobre la escena 3D del menú.
 * El fondo es la propia sala arcade de Menu3D (que se aleja y orbita mientras hay un panel abierto).
 * También aplica el ajuste «Calidad gráfica» (Alta = sombras · Rápida = sin sombras) a gfx.shadows.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, alpha, glow, hx, tglow } from '../utils/kit';
import { ACHIEVEMENTS, Profile, levelInfo, toast, useProfile, useSettings } from '../utils/meta';
import { gfx } from '../utils/engine3d';
import { Btn3D, Fade, Panel3D } from '../utils/ui3d';
import { shade } from '../utils/prefabs';

// ─── Calidad gráfica ──────────────────────────────────────────────
/** 'high' → sombras on · 'fast' → sombras off (se aplica a gfx.shadows del motor). */
export const applyQuality = q => { gfx.shadows = q !== 'fast'; };
/** Úsalo UNA vez en la raíz de la app: aplica el ajuste guardado al arrancar y cada vez que cambia. */
export function useApplyQuality() {
  const [settings] = useSettings();
  applyQuality(settings.quality);
  useEffect(() => { applyQuality(settings.quality); }, [settings.quality]);
}

// ─── Piezas ───────────────────────────────────────────────────────
function PanelShell({ title, emoji, accent, onClose, children }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }).start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 60, opacity: a }]} onStartShouldSetResponder={() => true}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(3,2,14,0.74)' }]} />
      <Fade side="top" h={170} max={0.7} />
      <Fade side="bottom" h={150} max={0.7} />
      <SafeAreaView style={{ flex: 1, alignItems: 'center' }}>
        <Animated.View style={{ width: '100%', maxWidth: 520, flex: 1, paddingHorizontal: 16, paddingTop: 10, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [36, 0] }) }, { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: alpha(accent, 0.16), borderWidth: 1.5, borderColor: accent, alignItems: 'center', justifyContent: 'center', marginRight: 12, ...glow(accent, 12, 0.6) }}>
              <Text style={{ fontSize: 24 }}>{emoji}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: 2.5, ...tglow(accent, 14) }}>{title}</Text>
            </View>
            <Btn3D testID="panel-close" size="sm" ghost color="#cfd6ff" label="CERRAR" icon="✕" onPress={onClose} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>{children}</ScrollView>
        </Animated.View>
      </SafeAreaView>
    </Animated.View>
  );
}

/** Interruptor con perilla animada. */
function Switch3D({ on, onPress, color = C.lime, icon, label, sub, testID }) {
  const k = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => { Animated.spring(k, { toValue: on ? 1 : 0, useNativeDriver: false, speed: 22, bounciness: 8 }).start(); }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Pressable testID={testID} onPress={onPress} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 20, backgroundColor: 'rgba(10,12,30,0.72)', borderWidth: 1, borderColor: on ? alpha(color, 0.55) : 'rgba(255,255,255,0.12)', ...glow(color, on ? 12 : 0, 0.3) }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: alpha(color, on ? 0.18 : 0.06), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <Text style={{ fontSize: 22, opacity: on ? 1 : 0.5 }}>{icon}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 }}>{label}</Text>
          <Text style={{ color: C.dim, fontSize: 12, marginTop: 1 }}>{sub}</Text>
        </View>
        <Animated.View style={{ width: 58, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: k.interpolate({ inputRange: [0, 1], outputRange: ['#262a4a', color] }) }}>
          <Animated.View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', transform: [{ translateX: k.interpolate({ inputRange: [0, 1], outputRange: [3, 29] }) }], ...glow(color, 6, on ? 0.9 : 0) }} />
        </Animated.View>
      </View>
    </Pressable>
  );
}

/** Selector de dos o más opciones grandes. options: [{ id, label, sub, icon }] */
function Segment3D({ value, options, onChange, color = C.cyan, testIDPrefix }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {options.map(o => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} testID={`${testIDPrefix}-${o.id}`} onPress={() => onChange(o.id)} style={{ flex: 1 }}>
            <View style={{ alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8, borderRadius: 18, backgroundColor: on ? alpha(color, 0.18) : 'rgba(10,12,30,0.6)', borderWidth: on ? 2 : 1, borderColor: on ? color : 'rgba(255,255,255,0.14)', ...glow(color, on ? 14 : 0, 0.5) }}>
              <Text style={{ fontSize: 24, opacity: on ? 1 : 0.55 }}>{o.icon}</Text>
              <Text style={{ color: on ? '#fff' : C.dim, fontWeight: '900', fontSize: 14, letterSpacing: 1.5, marginTop: 4 }}>{o.label}</Text>
              <Text style={{ color: on ? alpha('#ffffff', 0.75) : alpha(C.dim, 0.8), fontSize: 11, textAlign: 'center', marginTop: 2 }}>{o.sub}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const SectionTitle = ({ children, color = C.cyan }) => (
  <Text style={{ color, fontSize: 11, fontWeight: '900', letterSpacing: 3, marginBottom: 8, marginTop: 8, marginLeft: 4, ...tglow(color, 8) }}>{children}</Text>
);

// ─── Ajustes ──────────────────────────────────────────────────────
export function SettingsPanel3D({ onClose, onReset, total = 0 }) {
  const [settings, setSetting] = useSettings();
  const [confirm, setConfirm] = useState(false);
  const setQ = q => { hx.tick(); setSetting('quality', q); applyQuality(q); };
  return (
    <PanelShell title="AJUSTES" emoji="⚙️" accent={C.cyan} onClose={() => { setConfirm(false); onClose(); }}>
      <SectionTitle>EXPERIENCIA</SectionTitle>
      <Switch3D testID="tg-sound" icon="🔊" label="Sonido" sub="Efectos de sonido en los juegos" on={settings.sound} color={C.lime} onPress={() => { setSetting('sound', !settings.sound); hx.tick(); }} />
      <Switch3D testID="tg-haptics" icon="📳" label="Vibración" sub="Respuesta háptica al jugar" on={settings.haptics} color={C.pink} onPress={() => { setSetting('haptics', !settings.haptics); hx.tick(); }} />

      <SectionTitle>CALIDAD GRÁFICA</SectionTitle>
      <Segment3D testIDPrefix="q" value={settings.quality === 'fast' ? 'fast' : 'high'} color={C.cyan} onChange={setQ}
        options={[{ id: 'high', icon: '✨', label: 'ALTA', sub: 'Sombras activadas' }, { id: 'fast', icon: '⚡', label: 'RÁPIDA', sub: 'Sin sombras, más fluido' }]} />
      <Text style={{ color: alpha(C.dim, 0.85), fontSize: 11, textAlign: 'center', marginTop: 8, marginHorizontal: 10 }}>Si un juego va lento en tu teléfono, prueba «Rápida». Se aplica al instante.</Text>

      <SectionTitle color={C.red}>ZONA DE PELIGRO</SectionTitle>
      <Panel3D accent={C.red} pad={14}>
        <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>Borrar progreso</Text>
        <Text style={{ color: C.dim, fontSize: 12, marginVertical: 6 }}>Elimina récords, nivel, logros y favoritos (no borra las partidas guardadas de los juegos de aventura).</Text>
        <Btn3D testID="reset" size="sm" ghost color={C.red} label={confirm ? 'TOCA DE NUEVO PARA CONFIRMAR' : 'BORRAR TODO'} icon="🗑️"
          onPress={() => {
            if (!confirm) { setConfirm(true); hx.warn(); return; }
            Profile.reset().then(() => { setConfirm(false); if (onReset) onReset(); toast('Progreso borrado', '🗑️'); });
          }} />
      </Panel3D>
      <Text style={{ color: alpha(C.dim, 0.7), fontSize: 11, textAlign: 'center', marginTop: 22, letterSpacing: 1 }}>ARCADE HUB · {total} juegos · motor 3D</Text>
    </PanelShell>
  );
}

// ─── Perfil y logros ──────────────────────────────────────────────
function Stat({ icon, value, label, color }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 16, backgroundColor: 'rgba(10,12,30,0.7)', borderWidth: 1, borderColor: alpha(color, 0.4) }}>
      <Text style={{ fontSize: 18 }}>{icon}</Text>
      <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900', marginTop: 2 }}>{value}</Text>
      <Text style={{ color: alpha(color, 0.9), fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

export function ProfilePanel3D({ onClose, total = 0, daily }) {
  const prof = useProfile();
  const lv = levelInfo(prof.xp);
  const achN = Object.keys(prof.ach).length;
  const played = Object.keys(prof.plays).length;
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(grow, { toValue: Math.max(0.02, lv.pct), duration: 900, delay: 250, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const dailyDone = prof.daily.done && prof.daily.date !== '';
  return (
    <PanelShell title="PERFIL" emoji="🏆" accent={C.amber} onClose={onClose}>
      <Panel3D accent={C.cyan} pad={16} style={{ alignItems: 'center' }}>
        <View style={{ width: 104, height: 104, borderRadius: 52, borderWidth: 4, borderColor: C.cyan, backgroundColor: alpha(C.cyan, 0.12), alignItems: 'center', justifyContent: 'center', ...glow(C.cyan, 22, 0.85) }}>
          <View style={{ position: 'absolute', width: 86, height: 86, borderRadius: 43, borderWidth: 1.5, borderColor: alpha(C.cyan, 0.45) }} />
          <Text style={{ color: alpha(C.cyan, 0.9), fontSize: 10, fontWeight: '900', letterSpacing: 3 }}>NIVEL</Text>
          <Text style={{ color: '#fff', fontSize: 40, fontWeight: '900', lineHeight: 44, ...tglow(C.cyan, 14) }}>{lv.level}</Text>
        </View>
        <View style={{ alignSelf: 'stretch', marginTop: 16 }}>
          <View style={{ height: 14, borderRadius: 7, backgroundColor: alpha(C.cyan, 0.15), overflow: 'hidden', borderWidth: 1, borderColor: alpha(C.cyan, 0.35) }}>
            <Animated.View style={{ height: '100%', width: grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }), borderRadius: 7, backgroundColor: C.cyan }}>
              <View style={{ position: 'absolute', left: 4, right: 4, top: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.45)' }} />
            </Animated.View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{lv.into} / {lv.need} XP</Text>
            <Text style={{ color: C.dim, fontSize: 12 }}>faltan {lv.need - lv.into} para el nivel {lv.level + 1}</Text>
          </View>
        </View>
      </Panel3D>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <Stat icon="🎮" value={prof.finished} label="PARTIDAS" color={C.cyan} />
        <Stat icon="📈" value={prof.records} label="RÉCORDS" color={C.lime} />
        <Stat icon="🔥" value={prof.streak} label="RACHA" color={C.orange} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Stat icon="🧭" value={`${played}/${total}`} label="PROBADOS" color={C.violet} />
        <Stat icon="⭐" value={prof.xp} label="XP TOTAL" color={C.amber} />
        <Stat icon="🏅" value={`${achN}/${ACHIEVEMENTS.length}`} label="LOGROS" color={C.pink} />
      </View>

      {daily ? (
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 18, backgroundColor: alpha(C.amber, dailyDone ? 0.05 : 0.12), borderWidth: 1.5, borderColor: alpha(C.amber, dailyDone ? 0.35 : 0.8) }}>
          <Text style={{ fontSize: 30, marginRight: 12 }}>{daily.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.amber, fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>🎯 RETO DEL DÍA {dailyDone ? '· ¡CUMPLIDO!' : '· +50 XP'}</Text>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{daily.name}</Text>
            <Text style={{ color: C.dim, fontSize: 11 }}>{dailyDone ? 'Vuelve mañana para mantener tu racha' : 'Termina una partida hoy para sumar racha'}</Text>
          </View>
          <Text style={{ color: C.amber, fontSize: 22 }}>{dailyDone ? '✓' : ''}</Text>
        </View>
      ) : null}

      <SectionTitle color={C.amber}>LOGROS · {achN} DE {ACHIEVEMENTS.length} · +30 XP CADA UNO</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        {ACHIEVEMENTS.map(a => {
          const ok = !!prof.ach[a.id];
          return (
            <View key={a.id} style={{ width: '48.5%', marginBottom: 8, padding: 12, borderRadius: 18, alignItems: 'center', backgroundColor: ok ? alpha(C.amber, 0.12) : 'rgba(10,12,30,0.62)', borderWidth: 1, borderColor: ok ? alpha(C.amber, 0.75) : 'rgba(255,255,255,0.1)', ...glow(C.amber, ok ? 12 : 0, 0.35) }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: ok ? alpha(C.amber, 0.2) : 'rgba(255,255,255,0.05)', borderWidth: 2, borderColor: ok ? C.amber : 'rgba(255,255,255,0.14)' }}>
                <Text style={{ fontSize: 26, opacity: ok ? 1 : 0.5 }}>{ok ? a.emoji : '🔒'}</Text>
              </View>
              <Text numberOfLines={1} style={{ color: ok ? shade(C.amber, 1.3) : C.text, fontWeight: '900', fontSize: 13, marginTop: 8 }}>{a.name}</Text>
              <Text numberOfLines={2} style={{ color: C.dim, fontSize: 11, textAlign: 'center', marginTop: 2, minHeight: 28 }}>{a.desc}</Text>
              {ok ? <Text style={{ color: C.lime, fontSize: 11, fontWeight: '900', marginTop: 2 }}>✓ DESBLOQUEADO</Text> : <Text style={{ color: alpha(C.dim, 0.6), fontSize: 10, fontWeight: '800', marginTop: 2, letterSpacing: 1 }}>BLOQUEADO</Text>}
            </View>
          );
        })}
      </View>
    </PanelShell>
  );
}
