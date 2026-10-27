/**
 * world3d.js – motor 3D (three.js sobre expo-gl) para los juegos en 3D de verdad.
 * El juego describe su mundo cada frame como una lista de objetos con id estable;
 * el motor crea, mueve y borra las mallas. La cámara la decide el juego (primera o tercera persona, mundo abierto).
 *
 * Escena: { objs, cam, bg, fog, lights }
 *   objs: [{ id, k, p:[x,y,z], s:[sx,sy,sz] | n, r:[rx,ry,rz], c, e, o }]
 *     id : texto o número ESTABLE entre frames (así se reutiliza la malla)
 *     k  : forma. 'box' caja · 'sph' esfera · 'cyl' cilindro · 'cone' cono · 'tor' aro · 'pla' plano horizontal
 *     p  : posición (centro). s: tamaño (o n: escala uniforme). r: rotación en radianes.
 *     c  : color (hex o 'hsl(...)'). e: brillo propio 0..1 (neón). o: opacidad 0..1.
 *   cam: { p:[x,y,z], l:[x,y,z] (mira a), fov }   ó   { p, yaw, pitch, fov }
 *   bg: color de fondo. fog: { c, near, far }  (opcional). shake: temblor de cámara en unidades (opcional)
 */
import { makeRenderer, probeGL } from './gl3dx';

const GEO_KEYS = ['box', 'sph', 'cyl', 'cone', 'tor', 'pla'];

export function createWorld({ gl, THREE, getState, aspect }) {
  const renderer = makeRenderer(gl, THREE);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, aspect, 0.05, 600);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303048, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(-8, 16, 10); scene.add(sun);

  const GEO = {
    box: new THREE.BoxGeometry(1, 1, 1),
    sph: new THREE.SphereGeometry(0.5, 16, 12),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    cone: new THREE.ConeGeometry(0.5, 1, 12),
    tor: new THREE.TorusGeometry(0.5, 0.12, 8, 24),
    pla: new THREE.PlaneGeometry(1, 1),
  };
  const meshes = new Map();   // id -> { m, k }

  const make = (o) => {
    const k = GEO_KEYS.includes(o.k) ? o.k : 'box';
    const m = new THREE.Mesh(GEO[k], new THREE.MeshLambertMaterial({ flatShading: true, transparent: true, side: THREE.DoubleSide }));
    scene.add(m);
    return { m, k };
  };

  return {
    frame() {
      const st = getState(); if (!st) return;
      const seen = new Set();
      for (const o of st.objs || []) {
        const key = String(o.id);
        seen.add(key);
        let rec = meshes.get(key);
        const k = GEO_KEYS.includes(o.k) ? o.k : 'box';
        if (!rec || rec.k !== k) { if (rec) { scene.remove(rec.m); rec.m.material.dispose(); } rec = make(o); meshes.set(key, rec); }
        const m = rec.m;
        m.visible = true;
        m.position.set(o.p[0], o.p[1], o.p[2]);
        m.rotation.set(o.r ? o.r[0] : (k === 'pla' ? -Math.PI / 2 : 0), o.r ? o.r[1] : 0, o.r ? o.r[2] : 0);
        if (typeof o.n === 'number') m.scale.set(o.n, o.n, o.n);
        else if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
        else m.scale.set(1, 1, 1);
        // brillo propio del color del objeto (no luz blanca): neón sin lavar los colores
        m.material.color.set(o.c || 0xffffff);
        m.material.emissive.copy(m.material.color).multiplyScalar(o.e || 0);
        m.material.opacity = o.o != null ? o.o : 1;
      }
      meshes.forEach((rec, key) => { if (!seen.has(key)) { scene.remove(rec.m); rec.m.material.dispose(); meshes.delete(key); } });
      if (st.fog) { if (!scene.fog) scene.fog = new THREE.Fog(st.fog.c, st.fog.near, st.fog.far); else { scene.fog.color.set(st.fog.c); scene.fog.near = st.fog.near; scene.fog.far = st.fog.far; } }
      else scene.fog = null;
      const cam = st.cam || { p: [0, 5, 10], l: [0, 0, 0] };
      const sh = (st.shake || 0) * (Math.random() - 0.5);   // temblor de cámara (fx.shakeT)
      camera.fov = cam.fov || 60; camera.aspect = aspect; camera.updateProjectionMatrix();
      camera.position.set(cam.p[0] + sh, cam.p[1] + sh * 0.5, cam.p[2]);
      if (cam.l) camera.lookAt(cam.l[0], cam.l[1], cam.l[2]);
      else { camera.rotation.order = 'YXZ'; camera.rotation.set(cam.pitch || 0, cam.yaw || 0, 0); }
      if (st.bg != null) renderer.setClearColor(st.bg, 1);
      renderer.render(scene, camera);
    },
    probe: () => probeGL(gl),
    dispose() { meshes.forEach(rec => { rec.m.material.dispose(); }); try { renderer.dispose(); } catch (_) {} },
  };
}
