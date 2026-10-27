/**
 * World3D.js – componente React que muestra un mundo 3D (utils/world3d.js) dentro del PlayArea.
 * Uso: <World3D scene={scene} /> donde scene = { objs, cam, bg, fog } se reconstruye en cada render.
 */
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AREA_W, AREA_H, C } from './kit';
import { createWorld } from './engine3d';

let _GLV;
export const getGLView = () => { if (_GLV === undefined) { try { _GLV = require('expo-gl').GLView; require('three'); } catch (e) { _GLV = null; } } return _GLV; };

const worldCreate = o => createWorld(o);

export function World3D({ scene }) {
  const store = useRef({}).current;
  store.scene = scene;
  const getState = useRef(() => store.scene).current;
  const [fail, setFail] = useState(null);
  const GLV = getGLView();
  if (!GLV || fail != null) return (
    <View style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(10,10,20,0.9)' }}>
      <Text style={{ fontSize: 48 }}>🛠️</Text>
      <Text style={{ color: C.cyan, fontWeight: '900', fontSize: 16, marginTop: 8, textAlign: 'center' }}>Este juego necesita gráficos 3D (OpenGL)</Text>
      {fail != null && !!fail && <Text selectable style={{ color: C.red, fontSize: 10, marginTop: 8, textAlign: 'center' }}>{String(fail).slice(0, 220)}</Text>}
      {fail != null && <Text onPress={() => setFail(null)} style={{ color: C.cyan, fontWeight: '900', marginTop: 12 }}>🔄 REINTENTAR</Text>}
    </View>
  );
  const onCtx = gl => {
    const st = { v: false };
    try {
      const THREE = require('three');
      const world = worldCreate({ gl, THREE, getState, aspect: AREA_W / AREA_H });
      const tick = () => {
        if (st.v) { world.dispose(); return; }
        try { world.frame(); if (gl.endFrameEXP) gl.endFrameEXP(); } catch (e) { st.v = true; setFail(String((e && e.message) || e)); return; }
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { setFail(String((e && e.message) || e)); }
  };
  return <GLV style={StyleSheet.absoluteFill} onContextCreate={onCtx} />;
}
