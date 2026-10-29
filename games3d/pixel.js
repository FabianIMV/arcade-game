/**
 * PIXEL QUEST 3D – plataformas de 30 mundos de bloques, ahora en tercera persona con cámara lateral inclinada.
 * Reglas (físicas a 60 Hz, enemigos, bloques ❓, monedas, meta, 30 mundos) = las del juego original; el nivel 2D (px) se
 * dibuja en 3D: 1 unidad = SC px, el suelo está en y = 0. Novedades: personaje (prefab person) con animaciones, slimes,
 * JEFES en los mundos 10, 20 y 30 (3, 4 y 5 pisotones), decorado de bosque/colinas/nubes por tema, sombras y partículas 3D.
 * Con la ⭐ (invencible) disparas bolas de fuego.
 *
 * Todo lo estático del nivel (bloques, césped, árboles…) se precalcula UNA vez por nivel (buildStatics → scene.statics).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, Lives, SCREEN_H, SCREEN_W, alpha, hx, overlap, tglow, uid, useBest, useFX, useLoop, useTimeouts } from '../utils/kit';
import { burst3d, clear3d, ring3d } from '../utils/engine3d';
import { ActionBtn, Btn3D, Game3D, HudPill, orbitCam } from '../utils/ui3d';
import { bush, coin, enemy, gem, hash01, house, person, shade, tree } from '../utils/prefabs';
import { project } from '../utils/openworld';

// ─── Datos del nivel 2D (copiados sin cambios de App.js: pqBuildLevel y PQ_THEMES) ───
// ==========================================
// 3. PIXEL QUEST (plataformas de 30 mundos)
// ==========================================
const PQ_GRAVITY = 1.2;
const PQ_JUMP = -18;
const PQ_SPEED = 7;
const PQ_PLAYER_SIZE = 30;

function pqBuildLevel(lvl, AH) {
  // GY = top of the ground floor. All "y" for objects = GY - objectHeight (so feet land on GY).
  const GY = AH - 60; // ground Y (top surface)
  const GH = 60;               // ground thickness
  const PH = 18;               // floating platform height
  const ld = { platforms: [], enemies: [], powerups: [], blocks: [], goal: null, length: 0 };

  // Helpers
  const gnd   = (x, w)              => ({ x, y: GY,     w, h: GH });      // ground slab
  const plat  = (x, yUp, w)         => ({ x, y: GY - yUp, w, h: PH });    // floating (yUp = px above GY)
  const enm   = (x, range, spd)     => ({ x, y: GY - 30, w: 30, h: 30, vx: spd, startX: x, range, active: true });
  const enmP  = (x, yUp, range, spd)=> ({ x, y: GY - yUp - 30, w: 30, h: 30, vx: spd, startX: x, range, active: true });
  const star  = (x, yUp)            => ({ x, y: GY - yUp, w: 25, h: 25, active: true, type: 'star' });
  const life  = (x, yUp)            => ({ x, y: GY - yUp, w: 25, h: 25, active: true, type: 'life' });
  const djump = (x, yUp)            => ({ x, y: GY - yUp, w: 25, h: 25, active: true, type: 'doublejump' });
  const goal  = (x, yUp = 140)      => ({ x, y: GY - yUp, w: 55, h: yUp });
  // Bloques ❓ golpeables desde abajo (tipo: 'star' | 'life' | 'doublejump')
  const qBlock = (x, yUp, type)     => ({ x, y: GY - yUp, w: 35, h: 35, active: true, hit: false, type });

  switch (lvl) {

    // ═══════════════════════════════════════════════════════════════
    // WORLD 1 ── COLINAS VERDES  (tutorial)
    // Terreno continuo con 2 hoyos pequeños, 2 enemigos lentos.
    // El jugador aprende a saltar gaps y esquivar enemigos.
    // ═══════════════════════════════════════════════════════════════
    case 1:
      ld.platforms.push(
        gnd(0,   440),          // suelo largo de inicio
        gnd(530, 350),          // suelo central  (gap 90px → fácil)
        gnd(990, 850),          // suelo final largo (gap 110px → fácil)
        // puente sobre el primer gap
        plat(450, 65, 120),     // x=450-570, cubre gap 440-530
        // puente sobre el segundo gap
        plat(905, 70, 130),     // x=905-1035, cubre gap 880-990
        // plataforma bonus alta (recompensa exploración)
        plat(280, 110, 110),    // yUp=110 < límite 125 → alcanzable
      );
      ld.enemies.push(
        enm(330, 130, 1.5),     // patrulla lenta en suelo inicio
        enm(1250, 160, 1.8),    // patrulla lenta en suelo final
      );
      ld.powerups.push(star(290, 155), life(700, 35)); // ⭐ plataforma bonus, ❤️ mid-level
      ld.goal = goal(1680);
      ld.length = 1850;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 2 ── SENDERO ROCOSO  (3 gaps, introduce alturas)
    // Tres hoyos de dificultad creciente con puentes a distinta altura.
    // ═══════════════════════════════════════════════════════════════
    case 2:
      ld.platforms.push(
        gnd(0,   350),          // inicio
        gnd(470, 270),          // tras gap 1  (gap=120px)
        gnd(850, 250),          // tras gap 2  (gap=110px)
        gnd(1200,800),          // final largo (gap=100px)
        // puentes crecientes en altura
        plat(365, 70, 145),     // sobre gap 1
        plat(740, 80, 140),     // sobre gap 2
        plat(1090, 90, 140),    // sobre gap 3  (1100-1200)
        // bonus 1 y bonus 2
        plat(160, 115, 105),    // bonus izquierda
        plat(1420, 115, 105),   // bonus derecha
      );
      ld.enemies.push(
        enm(200,  130, 2.0),
        enm(520,  120, 2.2),
        enm(1300, 150, 2.0),
      );
      ld.powerups.push(star(165, 160), star(1428, 160), life(1100, 35));
      ld.goal = goal(1830);
      ld.length = 2000;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 3 ── LA GRAN ESCALERA  (subida y bajada simétricas)
    // 4 peldaños ascendentes (+35px cada uno) y 3 descendentes.
    // Camino VISUAL Y LÓGICAMENTE claro: sube → llega a la cima → baja.
    // Cada peldaño: ancho=115, gap=15px entre peldaños (muy légible).
    // ═══════════════════════════════════════════════════════════════
    case 3:
      ld.platforms.push(
        gnd(0,   290),               // suelo de inicio
        gnd(1240, 650),              // suelo tras bajar la escalera
        // ── SUBIDA (4 peldaños) ──
        plat(310, 60,  115),         // escalón 1  yUp= 60
        plat(440, 95,  115),         // escalón 2  yUp= 95  gap=15
        plat(570, 130, 115),         // escalón 3  yUp=130  gap=15
        plat(700, 165, 115),         // escalón 4  yUp=165  gap=15  ← CIMA
        // ── BAJADA (3 peldaños) ──
        plat(840, 130, 115),         // escalón 5  yUp=130  gap=25
        plat(970, 95,  115),         // escalón 6  yUp= 95  gap=15
        plat(1100, 60, 115),         // escalón 7  yUp= 60  gap=15
      );
      ld.enemies.push(
        enm(150,  110, 2.0),         // patrulla en inicio
        enmP(340,  60, 70, 2.3),     // guarda escalón 1
        enmP(855, 130, 70, 2.5),     // guarda escalón 5 (bajada)
        enm(1450, 140, 2.2),         // patrulla en final
      );
      ld.powerups.push(star(710, 212), life(1400, 35)); // ⭐ CIMA, ❤️ final ground
      ld.goal = goal(1720);
      ld.length = 1900;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 4 ── PATRULLA ENEMIGA  (terreno con muchos enemies)
    // 4 suelos con gaps medios, 5 enemigos de velocidad creciente.
    // El reto es ESQUIVAR enemigos mientras saltas los hoyos.
    // ═══════════════════════════════════════════════════════════════
    case 4:
      ld.platforms.push(
        gnd(0,   320),
        gnd(440, 250),          // gap 120
        gnd(800, 230),          // gap 110
        gnd(1140,280),          // gap 110
        gnd(1520,800),          // gap 100 → final largo
        plat(340, 75, 140),     // puente 1
        plat(700, 80, 140),     // puente 2
        plat(1040, 85, 130),    // puente 3
        plat(1425, 80, 125),    // puente 4
        plat(150, 120, 100),    // bonus izq
        plat(1700, 115, 100),   // bonus der
      );
      ld.enemies.push(
        enm(180,  120, 2.2),
        enm(490,  110, 2.5),
        enm(845,  120, 2.8),
        enm(1190, 110, 2.5),
        enm(1650, 150, 2.2),
      );
      ld.powerups.push(star(155, 165), star(1705, 160), life(950, 35));
      ld.goal = goal(2180);
      ld.length = 2350;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 5 ── ISLAS FLOTANTES  (casi sin suelo, ritmo up-down)
    // Cadena de 12 plataformas flotantes alternando bajo(75)↔alto(130).
    // El patrón rítmico enseña al jugador el timing de saltos continuos.
    // ═══════════════════════════════════════════════════════════════
    case 5:
      ld.platforms.push(
        gnd(0,   160),               // pequeño inicio
        gnd(2200, 500),              // aterrizaje final
        // ── CADENA RÍTMICA (bajo=75, alto=130, gap ~60px) ──
        plat(210,  75, 105),         // isla 1  baja
        plat(375, 130, 100),         // isla 2  alta   gap=60 rise=55
        plat(535,  75, 105),         // isla 3  baja   gap=60 drop=55
        plat(700, 130, 100),         // isla 4  alta   gap=60 rise=55
        plat(860,  75, 105),         // isla 5  baja   gap=60 drop=55
        plat(1025,130, 100),         // isla 6  alta   gap=60
        plat(1185, 75, 105),         // isla 7  baja
        plat(1350,135, 100),         // isla 8  alta
        plat(1510, 75, 105),         // isla 9  baja
        plat(1675,130, 100),         // isla 10 alta
        plat(1835, 80, 105),         // isla 11 baja
        plat(2000,120, 150),         // isla 12 amplia (aterrizaje seguro)
      );
      ld.enemies.push(
        enmP(220,  75,  80, 2.5),    // isla 1
        enmP(720,  130, 70, 2.8),    // isla 4
        enmP(1045, 130, 70, 3.0),    // isla 6
        enmP(1695, 130, 70, 3.0),    // isla 10
        enmP(2015, 120, 90, 2.8),    // isla 12
      );
      ld.powerups.push(star(710, 178), star(1860, 125), life(2300, 35)); // islas altas, ❤️ final
      ld.goal = goal(2550);
      ld.length = 2700;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 6 ── VELOCIDAD  (enemigos rápidos, gaps medios-grandes)
    // Mismo esquema de gaps+puentes pero los enemigos se mueven rápido.
    // 4 suelos + 4 puentes + 2 bonus. 6 enemigos a 3.0–3.5.
    // ═══════════════════════════════════════════════════════════════
    case 6:
      ld.platforms.push(
        gnd(0,   340),
        gnd(480, 260),          // gap 140
        gnd(860, 240),          // gap 120
        gnd(1220,250),          // gap 120
        gnd(1600,750),          // gap 130 → final
        plat(360, 80, 160),     // puente 1
        plat(740, 85, 155),     // puente 2
        plat(1100, 90, 155),    // puente 3
        plat(1475, 85, 155),    // puente 4
        plat(160, 120, 100),    // bonus izq
        plat(1780, 125, 100),   // bonus der
      );
      ld.enemies.push(
        enm(200,  130, 3.0),
        enm(530,  120, 3.5),
        enm(910,  130, 3.2),
        enm(1270, 110, 3.5),
        enm(1660, 150, 3.0),
        enm(1930, 140, 3.2),
      );
      ld.powerups.push(star(165, 165), star(1785, 170), life(1000, 35));
      ld.goal = goal(2170);
      ld.length = 2320;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 7 ── PLATAFORMAS ANGOSTAS  (90→80px, gaps crecen)
    // Sin suelo central. Plataformas alternas angostas sobre el vacío.
    // Cada salto exige precisión. Enemies en posiciones que obligan a moverse.
    // ═══════════════════════════════════════════════════════════════
    case 7:
      ld.platforms.push(
        gnd(0,   200),
        gnd(2620, 450),
        // ── CADENA ANGOSTA (gap ~85px, alternas baja/alta) ──
        plat(250,  70,  90),     // p1  end=340
        plat(425, 125,  85),     // p2  gap=85  rise=55
        plat(595,  70,  90),     // p3  gap=85  drop=55
        plat(775, 135,  85),     // p4  gap=85  rise=65
        plat(950,  75,  90),     // p5  gap=90  drop=60
        plat(1135,140,  85),     // p6  gap=90  rise=65
        plat(1315, 80,  90),     // p7  gap=95  drop=60
        plat(1505,145,  85),     // p8  gap=95  rise=65
        plat(1685, 85,  90),     // p9  gap=95  drop=60
        plat(1880,150,  85),     // p10 gap=100 rise=65
        plat(2065, 90,  90),     // p11 gap=100 drop=60
        plat(2260, 75, 100),     // p12 gap=105
        plat(2450, 80, 180),     // p13 amplia → entrada a suelo final
      );
      ld.enemies.push(
        enm(100,  80, 2.8),
        enmP(455, 125, 60, 3.0),
        enmP(800, 135, 60, 3.5),
        enmP(1160,140, 55, 3.2),
        enmP(1530,145, 55, 3.5),
        enmP(1905,150, 55, 3.8),
      );
      ld.powerups.push(star(785, 182), star(1515, 192), life(2700, 35));
      ld.goal = goal(2900);
      ld.length = 3050;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 8 ── BLOQUES EN ALTURA  (plataformas altas en parejas)
    // Clusters de 2 plataformas a la misma altura, con saltos entre clusters.
    // Lo difícil: subir de cluster bajo→alto→muy alto→alto→bajo.
    // ═══════════════════════════════════════════════════════════════
    case 8:
      ld.platforms.push(
        gnd(0,   200),
        gnd(2800, 500),
        // cluster A (bajo yUp=80)
        plat(250, 80, 100),  plat(420, 80, 100),   // end=520
        // cluster B (medio yUp=130)
        plat(600, 130, 95),  plat(775, 130, 95),   // end=870
        // cluster C (alto yUp=175)
        plat(970, 175, 90),  plat(1145,175, 90),   // end=1235  ← CIMA
        // cluster D (medio yUp=130)
        plat(1340,130, 95),  plat(1515,130, 95),   // end=1610
        // cluster E (bajo yUp=80)
        plat(1710, 80, 100), plat(1885, 80, 100),  // end=1985
        // finale (alto yUp=150, ancho)
        plat(2090,150, 90),  plat(2270,150, 90),   plat(2460, 90, 200),
      );
      ld.enemies.push(
        enm(110,  80, 3.5),
        enmP(280, 80, 70, 3.5),  enmP(450, 80, 70, 3.8),
        enmP(630,130, 70, 3.8),  enmP(805,130, 65, 4.0),
        enmP(1000,175, 60, 4.0),
        enmP(1370,130, 65, 4.2), enmP(1740, 80, 65, 4.0),
        enmP(2120,150, 60, 4.5), enmP(2490, 90, 80, 4.0),
      );
      ld.powerups.push(star(785, 178), star(1155, 222), star(2285, 196), life(2900, 35));
      ld.goal = goal(3020, 160);
      ld.length = 3200;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 9 ── CAOS TOTAL  (todo mezclado, enemigos muy rápidos)
    // Alterna: suelo corto → gap → plataforma → gap → …
    // 7 enemigos a 4.0–4.5. Requiere dominar saltos Y combate.
    // ═══════════════════════════════════════════════════════════════
    case 9:
      ld.platforms.push(
        gnd(0,   200), gnd(380, 210), gnd(700, 190), gnd(1010,200),
        gnd(1310,210), gnd(1650,190), gnd(1980,200), gnd(2550,600),
        // puentes sobre gaps + plataformas altas opcionales
        plat(230,  75, 190),   // puente gap1  (200-380)
        plat(560,  80, 170),   // puente gap2  (590-700)
        plat(870,  85, 170),   // puente gap3  (900-1010)
        plat(1180, 90, 160),   // puente gap4  (1200-1310)
        plat(1520, 85, 160),   // puente gap5  (1520-1650)
        plat(1840, 90, 170),   // puente gap6  (1840-1980)
        plat(2250, 95, 170),   // puente gap7 + inicio zona final
        // bonus
        plat(80,  120, 100), plat(1320,125, 100), plat(2180,120, 100),
      );
      ld.enemies.push(
        enm(120,  110, 4.0),
        enm(420,  110, 4.0),  enm(740, 120, 4.2),
        enm(1050, 110, 4.2),  enm(1350,120, 4.5),
        enm(1690, 110, 4.5),  enm(2030,120, 4.5),
      );
      ld.powerups.push(star(85, 165), star(1325, 170), star(2185, 165), life(1700, 35));
      ld.goal = goal(2980, 160);
      ld.length = 3150;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 10 ── EL FINAL  (todo al máximo)
    // Plataformas angostas (80-85px), gaps grandes (90-110px),
    // 10 enemigos a 4.5-5.0, estrellas en posiciones peligrosas.
    // ═══════════════════════════════════════════════════════════════
    case 10:
      ld.platforms.push(
        gnd(0,   180),
        gnd(2920, 500),
        // ── SECCIÓN 1: zigzag de 5 plataformas ──
        plat(230,  75,  85),   // end=315
        plat(405, 145,  80),   // gap=90   rise=70
        plat(575,  80,  85),   // gap=90   drop=65
        plat(760, 150,  80),   // gap=90   rise=70
        plat(930,  80,  85),   // gap=90   drop=70
        // ── SECCIÓN 2: serie alta ──
        plat(1110,160,  80),   // gap=95   rise=80
        plat(1285, 90,  85),   // gap=95   drop=70
        plat(1470,165,  80),   // gap=100  rise=75
        plat(1650, 90,  85),   // gap=100  drop=75
        plat(1840,170,  80),   // gap=105  rise=80
        // ── SECCIÓN 3: bajada y aterrizaje ──
        plat(2025,110,  85),   // gap=100  drop=60
        plat(2215, 80,  90),   // gap=105  drop=30
        plat(2410, 85, 120),   // gap=105  (ancho para seguridad)
        plat(2630, 80, 200),   // amplia → suelo final
      );
      ld.enemies.push(
        enmP(265,  75,  60, 4.5),  enmP(440, 145, 55, 5.0),
        enmP(610,  80,  55, 4.8),  enmP(795, 150, 55, 5.0),
        enmP(965,  80,  55, 4.5),  enmP(1145,160, 50, 5.0),
        enmP(1505,165,  50, 5.0),  enmP(1875,170, 50, 5.0),
        enmP(2055,110,  55, 4.8),  enmP(2445, 85, 70, 4.5),
      );
      ld.powerups.push(star(770, 197), star(1295, 137), star(1855, 215), life(2680, 115));
      ld.goal = goal(3000, 180);
      ld.length = 3200;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 11 ── CASCADA  (sube suave → baja → sube de nuevo)
    // Primera plataforma yUp=65 (fácilmente alcanzable), luego escala.
    // ═══════════════════════════════════════════════════════════════
    case 11:
      ld.platforms.push(
        gnd(0,   280),
        gnd(2800, 500),
        // subida suave al inicio (yUp 65→85→105→120)
        plat(320,  65, 110), plat(500,  85, 105), plat(680, 105, 100),
        plat(850, 120, 100),
        // suelo intermedio de descanso
        gnd(1000, 210),
        // bajada al otro lado (120→95→70)
        plat(1260, 120, 105), plat(1430,  95, 105), plat(1600,  70, 100),
        // suelo bajo y subida final (70→100→120→105→80)
        gnd(1760, 180),
        plat(2000, 70, 100), plat(2165, 100, 100), plat(2330, 120,  95),
        plat(2490,  80, 160),
      );
      ld.enemies.push(
        enm(160, 130, 3.5),
        enmP(345,  65, 80, 3.5), enmP(525,  85, 75, 4.0),
        enm(1050, 110, 3.8),
        enmP(1285, 120, 75, 4.0), enmP(1455,  95, 70, 4.2),
        enm(1810, 110, 4.0),
        enmP(2025,  70, 70, 4.2), enmP(2355, 120, 65, 4.5),
      );
      ld.powerups.push(star(860, 165), star(1615, 115));
      ld.goal = goal(3000, 180);
      ld.length = 3200;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 12 ── LABERINTO  (zigzag extremo, 15 plataformas 80px)
    // Alternancia bajo/alto/muy alto, gaps 95-100px, 9 enemigos 4.5-5.0.
    // ═══════════════════════════════════════════════════════════════
    case 12:
      ld.platforms.push(
        gnd(0,   180),
        gnd(3100, 500),
        plat(220,  65,  85), plat(400, 145,  80), plat(575,  70,  85),
        plat(755, 155,  80), plat(935,  75,  85), plat(1115, 165,  80),
        plat(1295, 80,  85), plat(1475,170,  80), plat(1655,  85,  85),
        plat(1835,165,  80), plat(2015, 90,  80), plat(2200,155,  80),
        plat(2380, 95,  80), plat(2560, 80, 150),
        plat(2750, 80, 200),
      );
      ld.enemies.push(
        enm(100, 80, 4.0),
        enmP(250, 65, 60, 4.0), enmP(430, 145, 55, 4.5),
        enmP(785, 155, 55, 4.5), enmP(1145, 165, 50, 4.8),
        enmP(1505, 170, 50, 4.8), enmP(1865, 165, 50, 5.0),
        enmP(2230, 155, 50, 5.0), enmP(2590, 80, 80, 4.5),
      );
      ld.powerups.push(star(765, 200), djump(1130, 215), star(1485, 215));
      ld.blocks.push(
        qBlock(420, 190, 'star'),
        qBlock(1120, 130, 'doublejump'),
        qBlock(2015, 135, 'life'),
      );
      ld.goal = goal(3280, 180);
      ld.length = 3450;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 13 ── TORMENTA  (gaps de 115px, 14 plataformas 90px)
    // Tres zonas de dificultad creciente, 10 enemigos 4.0-5.0.
    // ═══════════════════════════════════════════════════════════════
    case 13:
      ld.platforms.push(
        gnd(0,   160),
        gnd(3300, 500),
        // zona 1
        plat(200,  80, 100), plat(390, 155, 95), plat(580,  85, 100),
        // zona 2
        plat(790, 165, 90), plat(995,  90, 95), plat(1205, 170, 90),
        // zona 3
        plat(1420, 95, 90), plat(1630,175, 85), plat(1850, 100, 90),
        // zona final
        plat(2075, 170, 85), plat(2295, 95, 90), plat(2510, 165, 85),
        plat(2725, 100, 85), plat(2920, 80, 200),
      );
      ld.enemies.push(
        enm(100, 80, 4.2),
        enmP(220, 80, 75, 4.0), enmP(810, 165, 65, 4.5),
        enmP(1010, 90, 65, 4.5), enmP(1225, 170, 60, 4.8),
        enmP(1440, 95, 60, 5.0), enmP(1650, 175, 55, 5.0),
        enmP(2095, 170, 55, 5.0), enmP(2530, 165, 55, 5.0),
        enmP(2935, 80, 80, 4.8),
      );
      ld.powerups.push(star(800, 210), djump(1210, 215), star(1645, 220));
      ld.blocks.push(
        qBlock(590, 130, 'doublejump'),
        qBlock(1425, 140, 'star'),
        qBlock(2510, 210, 'life'),
      );
      ld.goal = goal(3450, 180);
      ld.length = 3620;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 14 ── ABISMO  (plataformas 75-80px, gaps manejables)
    // Enemies ultra rápidos 5.0-5.5. Doble salto disponible.
    // CORREGIDO: plataforma puente al final para alcanzar la meta.
    // ═══════════════════════════════════════════════════════════════
    case 14:
      ld.platforms.push(
        gnd(0,   160),
        gnd(3380, 500),
        plat(200,  75,  80), plat(390, 160,  75), plat(580,  80,  80),
        plat(775, 165,  75), plat(975,  80,  80), plat(1175, 170,  75),
        plat(1380, 80,  80), plat(1580, 165,  75), plat(1785, 85,  80),
        plat(1985, 170,  75), plat(2190, 90,  80), plat(2390, 160,  75),
        plat(2595, 95,  80), plat(2795, 75, 115),
        plat(2995, 80, 200),   // termina en x=3195
        plat(3270, 85,  85),   // PUENTE: gap=75px desde x=3195, termina en x=3355
      );
      ld.enemies.push(
        enm(100, 80, 4.5),
        enmP(220, 75, 55, 4.5), enmP(410, 160, 50, 5.0),
        enmP(795, 165, 50, 5.0), enmP(1195, 170, 45, 5.5),
        enmP(1600, 165, 45, 5.5), enmP(2005, 170, 45, 5.5),
        enmP(2410, 160, 45, 5.5), enmP(2615, 95, 60, 5.0),
        enmP(3010, 80, 80, 5.0),
      );
      ld.powerups.push(
        star(785, 208), djump(1195, 215), star(2002, 215),
        djump(2800, 120), life(3050, 115),
      );
      ld.blocks.push(
        qBlock(600,  130, 'doublejump'),
        qBlock(1395, 125, 'star'),
        qBlock(1790, 130, 'doublejump'),
        qBlock(2595, 140, 'star'),
        qBlock(3000, 125, 'life'),
      );
      ld.goal = goal(3490, 180);
      ld.length = 3700;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 15 ── EL OLIMPO  (nivel final absoluto)
    // Plataformas 70px, gaps 120-125px, 12 enemies 5.0-6.0.
    // ═══════════════════════════════════════════════════════════════
    case 15:
      ld.platforms.push(
        gnd(0,   140),
        gnd(3800, 500),
        // fase 1
        plat(190,  80,  75), plat(385, 165,  70), plat(580,  85,  75),
        plat(785, 170,  70), plat(985,  85,  75),
        // fase 2
        plat(1200, 170,  70), plat(1410, 90,  75), plat(1625, 175,  70),
        plat(1840, 90,  75), plat(2055, 170,  70),
        // fase 3
        plat(2280,  90,  75), plat(2505, 170,  70), plat(2725,  90,  75),
        plat(2950, 165,  70), plat(3175,  85,  80),
        plat(3395,  80, 200),
      );
      ld.enemies.push(
        enm(100, 80, 5.0),
        enmP(210, 80, 50, 5.0), enmP(405, 165, 45, 5.5),
        enmP(805, 170, 45, 5.5), enmP(1005, 85, 50, 5.0),
        enmP(1220, 170, 45, 5.5), enmP(1645, 175, 45, 6.0),
        enmP(1860, 90, 45, 6.0), enmP(2075, 170, 45, 6.0),
        enmP(2525, 170, 45, 6.0), enmP(2745, 90, 50, 5.5),
        enmP(3415, 80, 90, 5.5),
      );
      ld.powerups.push(star(795, 213), djump(1215, 220), star(1640, 220), djump(2530, 215), star(3205, 130), life(3435, 115));
      ld.blocks.push(
        qBlock(590, 130, 'doublejump'),
        qBlock(1210, 215, 'star'),
        qBlock(1845, 135, 'doublejump'),
        qBlock(2725, 135, 'life'),
        qBlock(3200, 130, 'doublejump'),
      );
      ld.goal = goal(3920, 185);
      ld.length = 4100;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 16 ── PUENTE ROTO  (plataformas alternas cortas 65px)
    // ═══════════════════════════════════════════════════════════════
    case 16:
      ld.platforms.push(
        gnd(0, 180),
        gnd(3900, 500),
        plat(210, 90, 65),  plat(400, 170, 65),  plat(600, 90, 65),
        plat(800, 175, 65), plat(1005, 95, 65),  plat(1210, 180, 65),
        plat(1415, 95, 65), plat(1625, 180, 65), plat(1835, 95, 65),
        plat(2050, 175, 65),plat(2265, 95, 65),  plat(2480, 175, 65),
        plat(2695, 90, 65), plat(2905, 175, 65), plat(3115, 90, 70),
        plat(3340, 80, 200),
      );
      ld.enemies.push(
        enm(100, 80, 5.5),
        enmP(230, 90, 40, 5.5), enmP(620, 90, 40, 6.0),
        enmP(1025, 95, 40, 6.0), enmP(1435, 95, 40, 6.5),
        enmP(1855, 95, 40, 6.5), enmP(2285, 95, 40, 6.5),
        enmP(2715, 90, 40, 6.5), enmP(3360, 80, 90, 6.0),
      );
      ld.powerups.push(star(810, 220), djump(1420, 225), star(2060, 220), djump(2910, 220), life(3365, 115));
      ld.blocks.push(
        qBlock(610, 135, 'doublejump'), qBlock(1215, 225, 'star'),
        qBlock(1840, 140, 'life'), qBlock(2700, 135, 'doublejump'),
      );
      ld.goal = goal(4010, 185);
      ld.length = 4200;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 17 ── TÚNEL OSCURO  (techo bajo + piso, ritmo constante)
    // ═══════════════════════════════════════════════════════════════
    case 17:
      ld.platforms.push(
        gnd(0, 190),
        gnd(4000, 500),
        plat(220, 95, 70),  plat(430, 175, 65),  plat(640, 90, 70),
        plat(850, 180, 65), plat(1065, 90, 70),  plat(1280, 180, 65),
        plat(1495, 90, 70), plat(1710, 175, 65), plat(1930, 90, 70),
        plat(2150, 175, 65),plat(2370, 90, 70),  plat(2595, 175, 65),
        plat(2815, 90, 70), plat(3040, 175, 65), plat(3265, 90, 75),
        plat(3490, 80, 220),
      );
      ld.enemies.push(
        enm(100, 80, 6.0),
        enmP(240, 95, 45, 6.0),  enmP(660, 90, 45, 6.5),
        enmP(1085, 90, 40, 6.5), enmP(1515, 90, 40, 7.0),
        enmP(1950, 90, 40, 7.0), enmP(2390, 90, 40, 7.0),
        enmP(2835, 90, 40, 7.0), enmP(3510, 80, 90, 6.5),
      );
      ld.powerups.push(star(860, 225), djump(1500, 135), star(2155, 220), djump(3045, 220), life(3515, 115));
      ld.blocks.push(
        qBlock(650, 135, 'star'), qBlock(1290, 225, 'doublejump'),
        qBlock(1940, 135, 'life'), qBlock(2820, 135, 'star'),
      );
      ld.goal = goal(4120, 185);
      ld.length = 4300;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 18 ── AVALANCHA  (gaps 130px, plataformas 65-70px)
    // ═══════════════════════════════════════════════════════════════
    case 18:
      ld.platforms.push(
        gnd(0, 170),
        gnd(4100, 500),
        plat(210, 85, 70),  plat(415, 165, 65),  plat(615, 85, 70),
        plat(820, 170, 65), plat(1025, 85, 70),  plat(1235, 170, 65),
        plat(1445, 85, 70), plat(1655, 165, 65), plat(1870, 85, 70),
        plat(2085, 165, 65),plat(2300, 85, 70),  plat(2515, 165, 65),
        plat(2730, 85, 70), plat(2945, 165, 70), plat(3165, 85, 80),
        plat(3390, 80, 230),
      );
      ld.enemies.push(
        enm(100, 75, 6.5),
        enmP(230, 85, 40, 6.5), enmP(635, 85, 40, 7.0),
        enmP(1045, 85, 40, 7.0), enmP(1465, 85, 40, 7.5),
        enmP(1890, 85, 40, 7.5), enmP(2320, 85, 40, 7.5),
        enmP(2750, 85, 40, 7.5), enmP(3410, 80, 95, 7.0),
      );
      ld.powerups.push(star(830, 215), djump(1450, 130), star(2095, 210), djump(2950, 210), life(3415, 115));
      ld.blocks.push(
        qBlock(625, 130, 'doublejump'), qBlock(1240, 215, 'star'),
        qBlock(1875, 130, 'life'), qBlock(2735, 130, 'doublejump'),
      );
      ld.goal = goal(4230, 180);
      ld.length = 4400;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 19 ── ESCALADA EXTREMA  (subida pura, gaps 110px)
    // ═══════════════════════════════════════════════════════════════
    case 19:
      ld.platforms.push(
        gnd(0, 160),
        gnd(4200, 500),
        plat(200, 80, 70),  plat(395, 155, 65),  plat(590, 240, 65),
        plat(780, 155, 65), plat(975, 80, 70),   plat(1175, 200, 65),
        plat(1375, 120, 65),plat(1575, 220, 65), plat(1775, 130, 70),
        plat(1985, 200, 65),plat(2195, 110, 70), plat(2415, 195, 65),
        plat(2630, 105, 70),plat(2850, 185, 65), plat(3075, 95, 75),
        plat(3300, 80, 230),
      );
      ld.enemies.push(
        enm(100, 70, 6.5),
        enmP(215, 80, 40, 7.0),  enmP(605, 240, 40, 7.0),
        enmP(995, 80, 40, 7.5),  enmP(1390, 120, 40, 7.5),
        enmP(1790, 130, 40, 8.0),enmP(2210, 110, 40, 8.0),
        enmP(2645, 105, 40, 8.0),enmP(3315, 80, 95, 7.5),
      );
      ld.powerups.push(star(790, 200), djump(1380, 165), star(1985, 245), djump(2855, 230), life(3320, 115));
      ld.blocks.push(
        qBlock(600, 285, 'doublejump'), qBlock(1185, 245, 'star'),
        qBlock(1785, 175, 'life'), qBlock(2635, 150, 'doublejump'),
      );
      ld.goal = goal(4320, 180);
      ld.length = 4500;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 20 ── INFIERNO DE FUEGO  (enemies 8.0, plataformas 60px)
    // ═══════════════════════════════════════════════════════════════
    case 20:
      ld.platforms.push(
        gnd(0, 160),
        gnd(4300, 500),
        plat(210, 90, 62),  plat(415, 170, 60),  plat(620, 90, 62),
        plat(825, 175, 60), plat(1035, 90, 62),  plat(1250, 175, 60),
        plat(1465, 90, 62), plat(1680, 170, 60), plat(1895, 90, 62),
        plat(2115, 170, 60),plat(2335, 90, 62),  plat(2555, 170, 60),
        plat(2775, 90, 62), plat(2995, 170, 62), plat(3220, 90, 68),
        plat(3445, 80, 240),
      );
      ld.enemies.push(
        enm(100, 70, 7.0),
        enmP(228, 90, 37, 7.5),  enmP(638, 90, 37, 8.0),
        enmP(1053, 90, 37, 8.0), enmP(1483, 90, 37, 8.5),
        enmP(1913, 90, 37, 8.5), enmP(2353, 90, 37, 8.5),
        enmP(2793, 90, 37, 8.5), enmP(3465, 80, 95, 8.0),
      );
      ld.powerups.push(star(835, 220), djump(1470, 135), star(2125, 215), djump(3005, 215), life(3470, 115));
      ld.blocks.push(
        qBlock(630, 135, 'doublejump'), qBlock(1260, 220, 'star'),
        qBlock(1905, 135, 'life'), qBlock(2785, 135, 'doublejump'),
      );
      ld.goal = goal(4420, 180);
      ld.length = 4600;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 21 ── ESPIRAL  (plataformas en zigzag amplio, gaps 115px)
    // ═══════════════════════════════════════════════════════════════
    case 21:
      ld.platforms.push(
        gnd(0, 155),
        gnd(4400, 500),
        plat(200, 80, 60),  plat(380, 200, 60),  plat(560, 85, 60),
        plat(745, 210, 60), plat(935, 90, 60),   plat(1130, 215, 60),
        plat(1330, 95, 60), plat(1535, 215, 60), plat(1740, 95, 60),
        plat(1950, 210, 60),plat(2165, 90, 60),  plat(2375, 205, 60),
        plat(2590, 85, 60), plat(2800, 200, 60), plat(3025, 85, 65),
        plat(3260, 80, 250),
      );
      ld.enemies.push(
        enm(100, 65, 7.5),
        enmP(218, 80, 35, 7.5),  enmP(578, 85, 35, 8.0),
        enmP(953, 90, 35, 8.0),  enmP(1348, 95, 35, 8.5),
        enmP(1758, 95, 35, 8.5), enmP(2183, 90, 35, 9.0),
        enmP(2608, 85, 35, 9.0), enmP(3280, 80, 90, 8.5),
      );
      ld.powerups.push(star(755, 255), djump(1335, 140), star(1955, 255), djump(2805, 245), life(3285, 115));
      ld.blocks.push(
        qBlock(570, 130, 'doublejump'), qBlock(1140, 260, 'star'),
        qBlock(1750, 140, 'life'), qBlock(2595, 130, 'doublejump'),
      );
      ld.goal = goal(4510, 178);
      ld.length = 4700;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 22 ── MURO INFINITO  (pendiente continua de subida)
    // ═══════════════════════════════════════════════════════════════
    case 22:
      ld.platforms.push(
        gnd(0, 150),
        gnd(4500, 500),
        plat(205, 85, 60),  plat(400, 160, 58),  plat(600, 235, 58),
        plat(795, 160, 58), plat(995, 90, 60),   plat(1200, 185, 58),
        plat(1405, 260, 58),plat(1610, 185, 58), plat(1820, 100, 60),
        plat(2035, 195, 58),plat(2250, 270, 58), plat(2465, 195, 58),
        plat(2680, 100, 60),plat(2895, 190, 58), plat(3120, 90, 65),
        plat(3355, 80, 255),
      );
      ld.enemies.push(
        enm(100, 60, 8.0),
        enmP(222, 85, 35, 8.0),  enmP(617, 235, 35, 8.5),
        enmP(1013, 90, 35, 8.5), enmP(1422, 260, 35, 9.0),
        enmP(1838, 100, 35, 9.0),enmP(2268, 270, 35, 9.0),
        enmP(2698, 100, 35, 9.0),enmP(3375, 80, 90, 8.5),
      );
      ld.powerups.push(star(805, 205), djump(1410, 305), star(2045, 240), djump(2905, 235), life(3380, 115));
      ld.blocks.push(
        qBlock(610, 280, 'doublejump'), qBlock(1210, 230, 'star'),
        qBlock(1830, 145, 'life'), qBlock(2690, 145, 'doublejump'),
      );
      ld.goal = goal(4610, 175);
      ld.length = 4800;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 23 ── RAIN OF DEATH  (muchos enemigos, plataformas 58px)
    // ═══════════════════════════════════════════════════════════════
    case 23:
      ld.platforms.push(
        gnd(0, 145),
        gnd(4600, 500),
        plat(210, 90, 58),  plat(415, 170, 56),  plat(625, 90, 58),
        plat(840, 175, 56), plat(1055, 90, 58),  plat(1275, 175, 56),
        plat(1495, 90, 58), plat(1715, 170, 56), plat(1935, 90, 58),
        plat(2160, 170, 56),plat(2385, 90, 58),  plat(2610, 170, 56),
        plat(2835, 90, 58), plat(3060, 170, 60), plat(3290, 90, 65),
        plat(3520, 80, 255),
      );
      ld.enemies.push(
        enm(100, 55, 8.5),
        enmP(227, 90, 33, 8.5),  enmP(642, 90, 33, 9.0),
        enmP(1072, 90, 33, 9.0), enmP(1512, 90, 33, 9.5),
        enmP(1952, 90, 33, 9.5), enmP(2402, 90, 33, 9.5),
        enmP(2852, 90, 33, 9.5), enmP(3308, 90, 33, 9.0),
        enmP(3540, 80, 90, 9.0),
      );
      ld.powerups.push(star(850, 220), djump(1500, 135), star(2170, 215), djump(3070, 215), life(3545, 115));
      ld.blocks.push(
        qBlock(635, 135, 'doublejump'), qBlock(1285, 220, 'star'),
        qBlock(1945, 135, 'life'), qBlock(2845, 135, 'doublejump'),
      );
      ld.goal = goal(4710, 175);
      ld.length = 4900;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 24 ── CAÍDA LIBRE  (plataformas super angostas 55px)
    // ═══════════════════════════════════════════════════════════════
    case 24:
      ld.platforms.push(
        gnd(0, 140),
        gnd(4700, 500),
        plat(215, 90, 56),  plat(430, 170, 55),  plat(645, 90, 56),
        plat(860, 175, 55), plat(1075, 90, 56),  plat(1295, 175, 55),
        plat(1515, 90, 56), plat(1735, 170, 55), plat(1955, 90, 56),
        plat(2180, 170, 55),plat(2405, 90, 56),  plat(2630, 170, 55),
        plat(2855, 90, 56), plat(3080, 170, 58), plat(3310, 90, 63),
        plat(3545, 80, 260),
      );
      ld.enemies.push(
        enm(100, 50, 9.0),
        enmP(232, 90, 31, 9.0),  enmP(662, 90, 31, 9.5),
        enmP(1092, 90, 31, 9.5), enmP(1532, 90, 31, 10.0),
        enmP(1972, 90, 31, 10.0),enmP(2422, 90, 31, 10.0),
        enmP(2872, 90, 31, 10.0),enmP(3565, 80, 90, 9.5),
      );
      ld.powerups.push(star(870, 220), djump(1520, 135), star(2190, 215), djump(3090, 215), life(3570, 115));
      ld.blocks.push(
        qBlock(655, 135, 'doublejump'), qBlock(1305, 220, 'star'),
        qBlock(1965, 135, 'life'), qBlock(2865, 135, 'doublejump'),
      );
      ld.goal = goal(4810, 172);
      ld.length = 5000;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 25 ── EL UMBRAL  (punto medio de la expansión, 10+ enemies)
    // ═══════════════════════════════════════════════════════════════
    case 25:
      ld.platforms.push(
        gnd(0, 135),
        gnd(4800, 500),
        plat(220, 90, 55),  plat(445, 175, 55),  plat(665, 90, 55),
        plat(890, 175, 55), plat(1115, 90, 55),  plat(1345, 175, 55),
        plat(1575, 90, 55), plat(1805, 175, 55), plat(2035, 90, 55),
        plat(2270, 175, 55),plat(2505, 90, 55),  plat(2740, 175, 55),
        plat(2975, 90, 55), plat(3210, 170, 60), plat(3450, 90, 65),
        plat(3685, 80, 265),
      );
      ld.enemies.push(
        enm(100, 50, 9.5),
        enmP(238, 90, 30, 9.5),  enmP(682, 90, 30, 10.0),
        enmP(1132, 90, 30, 10.0),enmP(1592, 90, 30, 10.5),
        enmP(2052, 90, 30, 10.5),enmP(2522, 90, 30, 10.5),
        enmP(2992, 90, 30, 10.5),enmP(3470, 90, 30, 10.0),
        enmP(3705, 80, 90, 10.0),
      );
      ld.powerups.push(
        star(900, 220), djump(1350, 220), star(2045, 135),
        djump(2745, 220), star(3220, 215), life(3710, 115),
      );
      ld.blocks.push(
        qBlock(675, 135, 'doublejump'), qBlock(1355, 220, 'star'),
        qBlock(2045, 135, 'life'), qBlock(2985, 135, 'doublejump'),
        qBlock(3460, 135, 'star'),
      );
      ld.goal = goal(4920, 170);
      ld.length = 5100;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 26 ── TORMENTA ELÉCTRICA  (plataformas 53px, gaps 130px)
    // ═══════════════════════════════════════════════════════════════
    case 26:
      ld.platforms.push(
        gnd(0, 130),
        gnd(4900, 500),
        plat(220, 90, 54),  plat(455, 175, 52),  plat(685, 90, 54),
        plat(920, 175, 52), plat(1155, 90, 54),  plat(1395, 175, 52),
        plat(1635, 90, 54), plat(1875, 175, 52), plat(2115, 90, 54),
        plat(2360, 175, 52),plat(2605, 90, 54),  plat(2850, 175, 52),
        plat(3095, 90, 54), plat(3345, 170, 58), plat(3590, 90, 63),
        plat(3835, 80, 265),
      );
      ld.enemies.push(
        enm(100, 45, 10.0),
        enmP(237, 90, 29, 10.0), enmP(702, 90, 29, 10.5),
        enmP(1172, 90, 29, 10.5),enmP(1652, 90, 29, 11.0),
        enmP(2132, 90, 29, 11.0),enmP(2622, 90, 29, 11.0),
        enmP(3112, 90, 29, 11.0),enmP(3855, 80, 90, 10.5),
      );
      ld.powerups.push(star(930, 220), djump(1640, 135), star(2370, 220), djump(3105, 135), life(3860, 115));
      ld.blocks.push(
        qBlock(695, 135, 'star'), qBlock(1405, 220, 'doublejump'),
        qBlock(2125, 135, 'life'), qBlock(2860, 220, 'doublejump'),
      );
      ld.goal = goal(5020, 168);
      ld.length = 5200;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 27 ── CAVERNA DEL DRAGÓN  (10 enemies, plataformas 52px)
    // ═══════════════════════════════════════════════════════════════
    case 27:
      ld.platforms.push(
        gnd(0, 125),
        gnd(5000, 500),
        plat(225, 90, 52),  plat(465, 175, 52),  plat(705, 90, 52),
        plat(950, 175, 52), plat(1195, 90, 52),  plat(1445, 175, 52),
        plat(1695, 90, 52), plat(1945, 175, 52), plat(2195, 90, 52),
        plat(2450, 175, 52),plat(2705, 90, 52),  plat(2960, 175, 52),
        plat(3215, 90, 52), plat(3475, 170, 57), plat(3730, 90, 62),
        plat(3985, 80, 265),
      );
      ld.enemies.push(
        enm(100, 42, 10.5),
        enmP(242, 90, 27, 10.5),enmP(722, 90, 27, 11.0),
        enmP(1212, 90, 27, 11.0),enmP(1712, 90, 27, 11.5),
        enmP(2212, 90, 27, 11.5),enmP(2722, 90, 27, 11.5),
        enmP(3232, 90, 27, 11.5),enmP(3750, 90, 27, 11.0),
        enmP(4005, 80, 90, 11.0),
      );
      ld.powerups.push(star(960, 220), djump(1700, 135), star(2460, 220), djump(2970, 220), life(4010, 115));
      ld.blocks.push(
        qBlock(715, 135, 'doublejump'), qBlock(1455, 220, 'star'),
        qBlock(2205, 135, 'life'), qBlock(3225, 135, 'doublejump'),
      );
      ld.goal = goal(5120, 165);
      ld.length = 5300;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 28 ── EL VACÍO  (plataformas 50px, gaps extremos 140px)
    // ═══════════════════════════════════════════════════════════════
    case 28:
      ld.platforms.push(
        gnd(0, 120),
        gnd(5100, 500),
        plat(230, 90, 50),  plat(480, 175, 50),  plat(730, 90, 50),
        plat(985, 175, 50), plat(1240, 90, 50),  plat(1500, 175, 50),
        plat(1760, 90, 50), plat(2020, 175, 50), plat(2280, 90, 50),
        plat(2545, 175, 50),plat(2810, 90, 50),  plat(3075, 175, 50),
        plat(3340, 90, 50), plat(3610, 170, 55), plat(3875, 90, 60),
        plat(4140, 80, 270),
      );
      ld.enemies.push(
        enm(100, 38, 11.0),
        enmP(248, 90, 25, 11.0),enmP(748, 90, 25, 11.5),
        enmP(1258, 90, 25, 11.5),enmP(1778, 90, 25, 12.0),
        enmP(2298, 90, 25, 12.0),enmP(2828, 90, 25, 12.0),
        enmP(3358, 90, 25, 12.0),enmP(3895, 90, 25, 11.5),
        enmP(4160, 80, 90, 11.5),
      );
      ld.powerups.push(star(995, 220), djump(1765, 135), star(2555, 220), djump(3085, 220), life(4165, 115));
      ld.blocks.push(
        qBlock(740, 135, 'doublejump'), qBlock(1510, 220, 'star'),
        qBlock(2290, 135, 'life'), qBlock(3350, 135, 'doublejump'),
      );
      ld.goal = goal(5220, 162);
      ld.length = 5400;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 29 ── PESADILLA  (11 enemies, plataformas 48px, gaps 140px)
    // ═══════════════════════════════════════════════════════════════
    case 29:
      ld.platforms.push(
        gnd(0, 115),
        gnd(5200, 500),
        plat(235, 90, 49),  plat(495, 175, 48),  plat(755, 90, 49),
        plat(1015, 175, 48),plat(1275, 90, 49),  plat(1540, 175, 48),
        plat(1805, 90, 49), plat(2070, 175, 48), plat(2335, 90, 49),
        plat(2605, 175, 48),plat(2875, 90, 49),  plat(3145, 175, 48),
        plat(3415, 90, 49), plat(3690, 170, 54), plat(3960, 90, 59),
        plat(4235, 80, 270),
      );
      ld.enemies.push(
        enm(100, 35, 11.5),
        enmP(252, 90, 24, 11.5),enmP(772, 90, 24, 12.0),
        enmP(1292, 90, 24, 12.0),enmP(1822, 90, 24, 12.5),
        enmP(2352, 90, 24, 12.5),enmP(2892, 90, 24, 12.5),
        enmP(3432, 90, 24, 12.5),enmP(3978, 90, 24, 12.0),
        enmP(3705, 170, 29, 12.0),enmP(4255, 80, 90, 12.0),
      );
      ld.powerups.push(
        star(1025, 220), djump(1545, 220), star(2345, 135),
        djump(3155, 220), star(3700, 215), life(4260, 115),
      );
      ld.blocks.push(
        qBlock(765, 135, 'doublejump'), qBlock(1550, 220, 'star'),
        qBlock(2345, 135, 'life'), qBlock(3425, 135, 'doublejump'),
        qBlock(3970, 135, 'star'),
      );
      ld.goal = goal(5320, 158);
      ld.length = 5500;
      break;

    // ═══════════════════════════════════════════════════════════════
    // WORLD 30 ── DIOS DE LOS MUNDOS  (nivel final definitivo)
    // Plataformas 45px, gaps 140-145px, 12 enemies 12.0-14.0.
    // ═══════════════════════════════════════════════════════════════
    default:
      ld.platforms.push(
        gnd(0, 110),
        gnd(5300, 500),
        // fase 1
        plat(240, 90, 47),  plat(510, 175, 45),  plat(780, 90, 47),
        plat(1055, 175, 45),plat(1330, 90, 47),
        // fase 2
        plat(1610, 175, 45),plat(1890, 90, 47),  plat(2170, 175, 45),
        plat(2450, 90, 47), plat(2735, 175, 45),
        // fase 3
        plat(3020, 90, 47), plat(3310, 175, 45), plat(3600, 90, 47),
        plat(3895, 170, 52),plat(4195, 90, 57),
        plat(4470, 80, 280),
      );
      ld.enemies.push(
        enm(100, 30, 12.0),
        enmP(257, 90, 22, 12.0),enmP(797, 90, 22, 12.5),
        enmP(1347, 90, 22, 12.5),enmP(1907, 90, 22, 13.0),
        enmP(2467, 90, 22, 13.0),enmP(3037, 90, 22, 13.5),
        enmP(3617, 90, 22, 13.5),enmP(4215, 90, 22, 13.0),
        enmP(1625, 175, 27, 13.0),enmP(2750, 175, 27, 13.5),
        enmP(4490, 80, 90, 14.0),
      );
      ld.powerups.push(
        star(1065, 220), djump(1615, 220), star(2460, 135),
        djump(2745, 220), star(3910, 215), life(3320, 220), life(4495, 115),
      );
      ld.blocks.push(
        qBlock(790, 135, 'doublejump'), qBlock(1620, 220, 'star'),
        qBlock(2460, 135, 'life'), qBlock(3030, 135, 'doublejump'),
        qBlock(3610, 135, 'star'), qBlock(4210, 135, 'doublejump'),
      );
      ld.goal = goal(5420, 155);
      ld.length = 5600;
      break;
  }

  return ld;
}

const PQ_THEMES = [
  { sky: '#6ec6ff', sky2: '#c9ecff', ground: '#6b4423', top: '#4cc04c', plat: '#a8693a', ptop: '#d9954f' },
  { sky: '#7be0a5', sky2: '#d7ffe6', ground: '#5a4a2c', top: '#3fae6b', plat: '#8f7a45', ptop: '#c2a660' },
  { sky: '#c79bff', sky2: '#eed9ff', ground: '#4a3560', top: '#9b6bff', plat: '#6f4f9a', ptop: '#a982dc' },
  { sky: '#ffd27a', sky2: '#fff1cf', ground: '#7a4a1c', top: '#e0a030', plat: '#a9702f', ptop: '#d89b55' },
  { sky: '#ff9fb8', sky2: '#ffdbe6', ground: '#6a3040', top: '#ff6b8f', plat: '#9a4a5c', ptop: '#d97a90' },
  { sky: '#6fd0ff', sky2: '#d9f3ff', ground: '#33506a', top: '#45b8e0', plat: '#4c7090', ptop: '#7fb0d0' },
  { sky: '#ff9a5a', sky2: '#ffd9bf', ground: '#5a2a1a', top: '#ff7a3d', plat: '#8a4528', ptop: '#d27a52' },
  { sky: '#2b3b5a', sky2: '#52688f', ground: '#20283a', top: '#6b84c4', plat: '#34415e', ptop: '#5b72a5' },
];

// ─── Motor 3D: escala, mundo y cámara ───
const SC = 40;                 // 1 unidad 3D = 40 px del nivel 2D
const AH = 540;                // alto de referencia del nivel (el suelo queda en AH-60)
const GYP = AH - 60;
const PZ = 2.6;                // profundidad de los bloques del camino (eje z)
const FOV = 60;
const wx = px => px / SC;
const wy = py => (GYP - py) / SC;
const rect = (x, y, w, h) => ({ cx: wx(x + w / 2), cy: wy(y + h / 2), sx: w / SC, sy: h / SC });
// cámara en tercera persona: detrás y arriba del personaje, hacia donde mira
const camOf = s => ({ p: [s.camX - 5.0 * s.cf, s.camY + 3.6, 8.4], l: [s.camX + 2.4 * s.cf, s.camY + 1.0, 0], fov: FOV });
// punto del nivel 2D (px) → píxeles de pantalla (para textos flotantes)
const at = (s, px, py) => { const q = s.cam && project(s.cam, [wx(px), wy(py), 0], SCREEN_W, SCREEN_H); return q ? [q.x, q.y] : [SCREEN_W / 2, SCREEN_H * 0.45]; };
const w3 = (px, py, z = 0.3) => [wx(px), wy(py), z];

// árbol y color de enemigo por tema
const TREES = [{ kind: 'oak' }, { kind: 'pine' }, { kind: 'birch', leaf: '#b58cff' }, { kind: 'cactus' }, { kind: 'oak', leaf: '#ff8fb0' }, { kind: 'pine', snow: true }, { kind: 'dead' }, { kind: 'pine', leaf: '#3a5a8a' }];
const SLIMES = ['#6fe05b', '#ff9ad0', '#8fd0ff', '#ffb347', '#c98bff', '#7fe0d0', '#ffd23f', '#9bd0ff'];

const newPlayer = () => ({ x: 50, y: GYP - PQ_PLAYER_SIZE - 1, vx: 0, vy: 0, w: PQ_PLAYER_SIZE, h: PQ_PLAYER_SIZE, face: 1, ground: false, jumped: false });
const buildLevel = lvl => {
  const ld = pqBuildLevel(lvl, AH);
  ld.coins = [];
  ld.platforms.forEach(pl => { if (pl.y < GYP - 5) { const n = Math.min(4, Math.floor(pl.w / 42)); for (let i = 0; i < n; i++) ld.coins.push({ id: uid(), x: pl.x + (pl.w - n * 36) / 2 + i * 36 + 9, y: pl.y - 30, w: 18, h: 18, got: false }); } });
  // JEFE en los mundos 10, 20 y 30: un slime gigante que patrulla justo antes de la meta
  if (lvl % 10 === 0 && ld.goal) {
    const slab = ld.platforms.filter(pl => pl.h > 30 && pl.x <= ld.goal.x && pl.x + pl.w >= ld.goal.x + ld.goal.w).pop();
    if (slab) {
      const x0 = Math.max(slab.x + 30, ld.goal.x - 330), range = Math.max(60, Math.min(170, ld.goal.x - 100 - x0));
      ld.enemies.push({ x: x0, y: GYP - 60, w: 60, h: 60, vx: 1.6 + lvl / 25, startX: x0, range, active: true, boss: true, hp: lvl / 10 + 2, hp0: lvl / 10 + 2, hurt: 0 });
    }
  }
  return ld;
};

// Decorado estático del nivel (se calcula una vez): bloques de tierra/césped, fondo de bosque, colinas y nubes
function buildStatics(ld, TH, lvl) {
  const st = [], th = (lvl - 1) % 8, len = wx(ld.length) + 8, TR = TREES[th];
  const hh = (k, n = 1) => hash01(`pq${lvl}_${k}`, n);
  // suelo lejano detrás del camino: los hoyos se ven como trincheras en vez de vacío
  st.push({ k: 'box', inst: 'fondo', p: [len / 2 - 4, -1.3, -9.5], s: [len + 40, 2, 14], c: shade(TH.top, 0.82), recv: true });
  ld.platforms.forEach((pl, i) => {
    const r = rect(pl.x, pl.y, pl.w, pl.h), ground = pl.h > 30, dz = ground ? PZ : 1.8;
    st.push({ k: 'box', inst: 'tierra', p: [r.cx, r.cy - 0.05, 0], s: [r.sx, r.sy - 0.1, dz], c: ground ? TH.ground : TH.plat, recv: true, sh: !ground });
    const n = Math.max(1, Math.round(r.sx)), bw = r.sx / n;
    for (let j = 0; j < n; j++) st.push({ k: 'box', inst: 'cesped', p: [r.cx - r.sx / 2 + bw * (j + 0.5), r.cy + r.sy / 2 - 0.09, 0], s: [bw * 0.985, 0.19, dz + 0.05], c: shade(ground ? TH.top : TH.ptop, j % 2 ? 0.93 : 1.05), recv: true });
    if (ground) {   // hiladas de ladrillo en el frente del bloque de suelo
      for (let k = 1; k < 3; k++) st.push({ k: 'box', inst: 'junta', p: [r.cx, r.cy + r.sy / 2 - k * 0.5 - 0.1, dz / 2 + 0.02], s: [r.sx, 0.05, 0.04], c: shade(TH.ground, 0.72) });
      for (let k = 0; k < 3; k++) for (let x = r.cx - r.sx / 2 + 0.5 * (k % 2) + 1; x < r.cx + r.sx / 2 - 0.2; x += 1) st.push({ k: 'box', inst: 'junta', p: [x, r.cy + r.sy / 2 - k * 0.5 - 0.35, dz / 2 + 0.02], s: [0.05, 0.42, 0.04], c: shade(TH.ground, 0.72) });
    }
    // matas, flores y rocas sobre el césped
    const top = r.cy + r.sy / 2 + 0.01;
    for (let x = r.cx - r.sx / 2 + 0.6; x < r.cx + r.sx / 2 - 0.3; x += 1.1 + hh(`g${i}_${x.toFixed(1)}`) * 1.6) {
      const q = hh(`gk${i}_${x.toFixed(1)}`), z = (hh(`gz${i}_${x.toFixed(1)}`) - 0.5) * (dz - 0.4);
      if (q < 0.5) st.push({ k: 'cone', inst: 'hierba', p: [x, top + 0.13, z], s: [0.14, 0.34, 0.14], c: shade(TH.top, 0.9), sh: false });
      else if (q < 0.8) st.push({ k: 'oct', inst: 'flor', p: [x, top + 0.3, z], s: [0.2, 0.2, 0.2], c: ['#ffd54a', '#ffffff', '#ff6fa8', '#b57bff'][Math.floor(q * 40) % 4] }, { k: 'box', inst: 'tallo', p: [x, top + 0.14, z], s: [0.04, 0.28, 0.04], c: '#3f8a3a' });
      else if (ground) st.push(...bush(`bu${i}_${x.toFixed(1)}`, [x, top, -0.5 - Math.abs(z) * 0.5], { inst: 'mata', sh: false, c: shade(TH.top, 0.8), n: 0.55 }));
    }
  });
  // fondo: árboles, colinas, nubes, montañas
  for (let i = 0, x = -6; x < len + 6; i++, x += 2.4 + hh(`dx${i}`) * 1.6) {
    const z = -3.2 - hh(`dz${i}`, 2) * 5;
    st.push(...tree(`dt${i}`, [x, -0.3, z], { ...TR, h: 0.9 + hh(`dh${i}`) * 0.9, n: 0.55, inst: 'arbol', sh: false }));
    if (i % 3 === 0) st.push(...bush(`db${i}`, [x + 1, -0.3, -2.6 - hh(`dbz${i}`) * 2], { inst: 'mata', sh: false, c: shade(TH.top, 0.85), n: 0.6 }));
  }
  for (let i = 0, x = -14; x < len + 14; i++, x += 12 + hh(`hx${i}`) * 8) {
    const s = 9 + hh(`hs${i}`) * 8;
    st.push({ k: 'ico', inst: 'colina', p: [x, -s * 0.28, -17 - hh(`hz${i}`) * 8], s: [s * 2, s, s * 1.6], c: shade(TH.top, 0.7 + hh(`hc${i}`) * 0.2) });
    st.push({ k: 'cone', inst: 'monte', p: [x + 6, 5 + hh(`mh${i}`) * 5, -34 - hh(`mz${i}`) * 8], s: [30, 14 + hh(`mh${i}`) * 10, 22], c: shade(TH.sky, 0.82) });
  }
  for (let i = 0, x = -10; x < len + 10; i++, x += 7 + hh(`cx${i}`) * 5) {
    const y = 8 + hh(`cy${i}`) * 5, z = -13 - hh(`cz${i}`) * 8, s = 2 + hh(`cs${i}`) * 2;
    for (let k = 0; k < 3; k++) st.push({ k: 'ico', inst: 'nube', p: [x + (k - 1) * s * 0.9, y + (k === 1 ? s * 0.3 : 0), z], s: [s * 1.6, s * 0.8, s], c: '#ffffff' });
  }
  // meta: torre-castillo detrás de la bandera
  if (ld.goal) { const g = ld.goal; st.push(...house('castillo', [wx(g.x + g.w / 2) + 2.6, 0, -2.4], { kind: 'tower', n: 0.45, lit: true, inst: 'castillo' })); }
  return st;
}

const initState = (lvl, lives, score) => {
  const TH = PQ_THEMES[(lvl - 1) % PQ_THEMES.length], world = buildLevel(lvl);
  const s = { level: lvl, lives, score, p: newPlayer(), world, theme: TH, statics: null, proj: [], inv: 0, gun: false, dj: 0, acc: 0, t: 0, safeX: 50, banner: { text: lvl % 10 === 0 ? `MUNDO ${lvl} · ¡JEFE!` : `MUNDO ${lvl}`, t: 1.8 }, coins: 0, stomps: 0, done: false, over: false, toast: null, camX: wx(50), camY: 0, cf: 1, cam: null, yawv: -Math.PI / 2, wasGround: false, walk: 0, hurtT: 0 };
  s.statics = buildStatics(world, TH, lvl);
  s.cam = camOf(s);
  return s;
};

// ─── Escena 3D ───
function buildScene(s, t) {
  const p = s.p, TH = s.theme, cam = s.cam, cx = cam.l[0], th = (s.level - 1) % 8, objs = [];
  const near = (x0, x1) => x1 > cx - 24 && x0 < cx + 24;   // ¿visible? (en unidades)
  const lava = th === 6, icy = th === 5;
  objs.push({ id: 'abismo', k: 'pla', p: [cx, -9, -6], s: [120, 60, 1], c: lava ? '#ff5a1f' : icy ? '#2c6fa8' : shade(TH.ground, 0.5), e: lava ? 0.7 : 0.05 });
  s.world.coins.forEach(c => { if (!c.got && near(wx(c.x), wx(c.x + c.w))) objs.push(...coin(`c${c.id}`, [wx(c.x + 9), wy(c.y + 9), 0], { t: s.t, bob: 0.08, n: 0.55, inst: 'moneda', sh: false })); });
  s.world.blocks.forEach((b, i) => {
    if (!b.active || !near(wx(b.x), wx(b.x + b.w))) return;
    const x = wx(b.x + b.w / 2), y = wy(b.y + b.h / 2) + (b.bump ? Math.sin(b.bump * 14) * 0.15 : 0);
    objs.push({ id: `bk${i}`, k: 'box', p: [x, y, 0], s: [0.92, 0.92, 0.92], c: b.hit ? '#8a5a2a' : '#ffc233', e: b.hit ? 0 : 0.3, sh: true, m: { r: 0.4, m: 0.3 } });
    objs.push({ id: `bf${i}`, k: 'box', p: [x, y, 0], s: [1.0, 0.1, 1.0], c: b.hit ? '#6a4420' : '#d99a14', sh: false });
  });
  s.world.powerups.forEach((u, i) => {
    if (!u.active || !near(wx(u.x), wx(u.x + u.w))) return;
    const x = wx(u.x + 12.5), y = wy(u.y + 12.5) + Math.sin(s.t * 4 + i) * 0.1;
    if (u.type === 'life') {
      objs.push({ id: `pu${i}a`, k: 'sph', p: [x - 0.13, y + 0.08, 0], n: 0.36, c: '#ff4d6d', e: 0.5 }, { id: `pu${i}b`, k: 'sph', p: [x + 0.13, y + 0.08, 0], n: 0.36, c: '#ff4d6d', e: 0.5 }, { id: `pu${i}c`, k: 'cone', p: [x, y - 0.12, 0], s: [0.5, 0.4, 0.36], r: [0, 0, Math.PI], c: '#ff4d6d', e: 0.5 });
    } else if (u.type === 'doublejump') {
      objs.push({ id: `pu${i}a`, k: 'tor', p: [x, y, 0], n: 0.7, c: '#22e6ff', e: 0.8, r: [0, s.t * 2, 0] }, { id: `pu${i}b`, k: 'box', p: [x - 0.32, y + 0.1, 0], s: [0.3, 0.1, 0.16], c: '#ffffff', e: 0.5, r: [0, 0, 0.4] }, { id: `pu${i}c`, k: 'box', p: [x + 0.32, y + 0.1, 0], s: [0.3, 0.1, 0.16], c: '#ffffff', e: 0.5, r: [0, 0, -0.4] });
    } else objs.push(...gem(`pu${i}`, [x, y - 0.4, 0], { c: '#ffc233', t: s.t, bob: 0, n: 0.85 }));
  });
  s.world.enemies.forEach((e, i) => {
    if (!e.active || !near(wx(e.x), wx(e.x + e.w))) return;
    const yaw = e.vx > 0 ? -Math.PI / 2 : Math.PI / 2, x = wx(e.x + e.w / 2), feet = wy(e.y + e.h);
    if (e.boss) {
      objs.push(...enemy('boss', 'slime', [x, feet, 0], { t: s.t * 0.8, c: '#b04bff', n: 1.25, yaw, flash: e.hurt > 0 }));
      for (let k = 0; k < 3; k++) objs.push({ id: `bc${k}`, k: 'cone', p: [x + (k - 1) * 0.32, feet + 1.45 + (k === 1 ? 0.1 : 0), 0], s: [0.26, 0.4, 0.26], c: '#ffc233', e: 0.5 });
      objs.push({ id: 'bcb', k: 'cyl', p: [x, feet + 1.3, 0], s: [1.0, 0.16, 0.5], c: '#ffc233', e: 0.4 });
      for (let k = 0; k < e.hp; k++) objs.push({ id: `bh${k}`, k: 'sph', p: [x + (k - (e.hp - 1) / 2) * 0.3, feet + 2.1, 0], n: 0.22, c: '#ff3b5c', e: 0.9 });
    } else objs.push(...enemy(`en${i}`, 'slime', [x, feet, 0], { t: s.t + i * 0.7, c: SLIMES[th], n: 0.72, yaw }));
  });
  if (s.world.goal && near(wx(s.world.goal.x), wx(s.world.goal.x + s.world.goal.w))) {
    const gw = s.world.goal, gx = wx(gw.x + gw.w / 2), gh = gw.h / SC, wave = Math.sin(s.t * 4) * 0.12;
    objs.push({ id: 'gpole', k: 'cyl', p: [gx, gh / 2, 0], s: [0.14, gh, 0.14], c: '#e8e8f0', m: { r: 0.3, m: 0.6 }, sh: true });
    objs.push({ id: 'gball', k: 'sph', p: [gx, gh + 0.1, 0], n: 0.34, c: '#ffc233', e: 0.8 });
    objs.push({ id: 'gflag', k: 'box', p: [gx + 0.55, gh - 0.4, 0], s: [1.0, 0.6, 0.06], r: [0, wave, 0], c: C.lime, e: 0.5 });
    objs.push({ id: 'gring', k: 'tor', p: [gx, 0.12, 0], s: [2.0, 2.0, 2.0], r: [Math.PI / 2, 0, 0], c: C.lime, e: 0.8 });
  }
  s.proj.forEach(q => objs.push({ id: `q${q.id}`, k: 'sph', p: [wx(q.x + q.w / 2), wy(q.y + q.h / 2), 0.1], n: 0.42, c: '#ff8a3d', e: 1 }, { id: `qg${q.id}`, k: 'sph', p: [wx(q.x + q.w / 2), wy(q.y + q.h / 2), 0.1], n: 0.7, c: '#ffd23f', e: 1, o: 0.35 }));
  // jugador: persona con gorra; con la estrella brilla en dorado, tras un golpe parpadea
  const px = wx(p.x + p.w / 2), feet = wy(p.y + p.h);
  const blink = s.hurtT > 0 && Math.floor(s.hurtT * 14) % 2 ? 0.3 : 1, star = s.inv > 0;
  objs.push(...person('yo', [px, feet, 0], { n: 0.58, yaw: s.yawv, t: s.t, walk: p.ground ? s.walk : 0.2, arms: p.ground ? undefined : 2.5, hat: 'cap', shirt: star || s.gun ? '#ffb020' : '#3a7bff', pants: '#2c3a6a', o: blink, flash: star && Math.floor(s.t * 8) % 2 === 0 }));
  return {
    sky: { top: TH.sky, bottom: TH.sky2, clouds: 4, sun: true }, fog: { c: TH.sky2, near: 32, far: 95 },
    light: { dir: [-0.45, 0.8, 0.55], i: 2.5, hi: 1.7 }, shadowR: 24,
    statics: s.statics, objs, cam: { p: cam.p, l: cam.l, fov: FOV },
  };
}

function WorldSelect({ maxLevel, level, onPick, onClose }) {
  return (
    <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,4,12,0.93)', zIndex: 90, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Text style={{ color: C.lime, fontSize: 22, fontWeight: '900', letterSpacing: 2, ...tglow(C.lime, 10) }}>🗺 ELEGIR MUNDO</Text>
      <Text style={{ color: C.dim, fontSize: 12, marginVertical: 8 }}>Desbloqueados: 1 – {maxLevel}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', width: Math.min(SCREEN_W - 32, 340) }}>
        {Array.from({ length: 30 }, (_, i) => i + 1).map(wd => { const ok = wd <= maxLevel; return (
          <Pressable key={wd} testID={`world-${wd}`} disabled={!ok} onPress={() => onPick(wd)} style={{ opacity: ok ? 1 : 0.35 }}>
            <View style={{ width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: wd === level ? alpha(C.lime, 0.3) : alpha(C.cyan, 0.1), borderWidth: 2, borderColor: wd === level ? C.lime : alpha(wd % 10 === 0 ? C.red : C.cyan, 0.55) }}>
              <Text style={{ color: C.text, fontWeight: '900' }}>{ok ? wd : '🔒'}</Text>
              {ok && wd % 10 === 0 ? <Text style={{ position: 'absolute', top: -7, right: -4, fontSize: 13 }}>👑</Text> : null}
            </View>
          </Pressable>); })}
      </View>
      <View style={{ marginTop: 18 }}><Btn3D label="CERRAR" size="sm" ghost color="#aab3d8" onPress={onClose} /></View>
    </View>
  );
}

export function PixelQuest3D({ onExit }) {
  const fx = useFX();
  const later = useTimeouts();
  const [best, submitBest] = useBest('pixelquest');
  const [phase, setPhase] = useState('ready');        // ready | play | over
  const [res, setRes] = useState({ isNew: false, won: false });
  const [maxLevel, setMaxLevel] = useState(1);
  const [select, setSelect] = useState(false);
  const input = useRef({ left: false, right: false }).current;
  const g = useRef(null);
  if (!g.current) g.current = initState(1, 3, 0);

  useEffect(() => { AsyncStorage.getItem('pixelQuestMaxLevel').then(v => { if (v) setMaxLevel(parseInt(v, 10) || 1); }).catch(() => {}); }, []);
  const unlock = lvl => { setMaxLevel(m => { if (lvl > m) { AsyncStorage.setItem('pixelQuestMaxLevel', String(lvl)).catch(() => {}); return lvl; } return m; }); };
  const save = () => { const s = g.current; AsyncStorage.setItem('pixelQuestSave', JSON.stringify({ level: s.level, lives: s.lives, score: s.score })).catch(() => {}); };
  const loadLevel = (lvl, lives, score) => {
    fx.clear(); clear3d(); const bonusLife = ((lvl >= 11 && lvl <= 13) || (lvl >= 21 && lvl <= 23) || lvl === 26) ? 1 : 0;
    g.current = initState(lvl, Math.min(9, lives + bonusLife), score); input.left = false; input.right = false; unlock(lvl); setPhase('play'); setSelect(false);
  };
  const start = () => loadLevel(1, 3, 0);
  const cont = () => { AsyncStorage.getItem('pixelQuestSave').then(v => { if (v) { try { const d = JSON.parse(v); loadLevel(d.level, d.lives, d.score || 0); return; } catch (e) {} } loadLevel(maxLevel, 3, 0); }).catch(() => loadLevel(maxLevel, 3, 0)); };

  const handleDeath = s => {
    const p = s.p; const [ex, ey] = at(s, p.x + p.w / 2, p.y + p.h / 2);
    burst3d(w3(p.x + p.w / 2, Math.min(p.y + p.h / 2, AH - 20)), ['#ff4d6d', '#ffffff', '#ffb0a0'], 26, { speed: 6, up: 3, size: 0.2, life: 0.8 });
    fx.shake(9, 0.3); fx.flash(C.red, 0.3); hx.bad(); ex; ey;
    if (s.lives > 1) { s.lives -= 1; p.x = Math.max(0, s.safeX - 40); p.y = 0; p.vy = 0; p.vx = 0; s.inv = 2.5; s.hurtT = 2.5; s.gun = false; }
    else { s.lives = 0; s.over = true; hx.die(); setRes({ isNew: submitBest(s.score), won: false }); setPhase('over'); }
  };
  const hurtBoss = (s, e, stomp) => {
    e.hp -= 1; e.hurt = 0.9; e.vx *= 1.18;
    const c = w3(e.x + 30, e.y + 20);
    if (e.hp <= 0) {
      e.active = false; s.score += 500; hx.win(); fx.flash('#ffffff', 0.4); fx.shake(10, 0.4);
      burst3d(c, ['#b04bff', '#ffc233', '#ffffff'], 60, { speed: 9, up: 4, g: 8, size: 0.35, life: 1.3 }); ring3d(c, '#ffc233', 28, { speed: 9, life: 0.8, size: 0.25 });
      const [ex, ey] = at(s, e.x + 30, e.y); fx.pop(ex, ey - 20, '¡JEFE VENCIDO! +500', C.amber, 20);
    } else {
      hx.heavy(); fx.shake(6, 0.2); burst3d(c, ['#b04bff', '#ffffff'], 24, { speed: 7, up: 3, size: 0.25, life: 0.7 });
      const [ex, ey] = at(s, e.x + 30, e.y); fx.pop(ex, ey - 20, `${e.hp} ♥`, C.red, 18);
    }
    return stomp;
  };

  const stepFrame = s => {
    const p = s.p; const w = s.world; s.t += 1 / 60;
    if (input.left) { p.vx = -PQ_SPEED; p.face = -1; } else if (input.right) { p.vx = PQ_SPEED; p.face = 1; } else p.vx = 0;
    p.x += p.vx; if (p.x < 0) p.x = 0;
    for (const pl of w.platforms) if (overlap(p, pl)) { if (p.vx > 0) p.x = pl.x - p.w; else if (p.vx < 0) p.x = pl.x + pl.w; }
    p.vy += PQ_GRAVITY; p.y += p.vy; p.ground = false;
    for (const pl of w.platforms) if (overlap(p, pl)) { if (p.vy > 0) { p.y = pl.y - p.h; p.vy = 0; p.ground = true; if (pl.h > 30 || pl.y > AH - 70) s.safeX = p.x; } else if (p.vy < 0) { p.y = pl.y + pl.h; p.vy = 0; } }
    if (p.y > AH + 20) { handleDeath(s); return; }
    if (s.inv > 0) s.inv -= 1 / 60;
    if (s.hurtT > 0) s.hurtT -= 1 / 60;
    for (const e of w.enemies) {
      if (!e.active) continue;
      if (e.hurt > 0) e.hurt -= 1 / 60;
      e.x += e.vx; if (e.x > e.startX + e.range || e.x < e.startX) e.vx *= -1;
      if (overlap(p, e)) {
        if (e.boss) {
          if (e.hurt > 0) continue;
          if (s.inv > 0) { hurtBoss(s, e, false); continue; }
          if (p.vy > 2 && p.y + p.h - e.y < 26) { hurtBoss(s, e, true); p.vy = -15; s.stomps += 1; s.score += 100; continue; }
          handleDeath(s); return;
        }
        if (s.inv > 0 || (p.vy > 2 && p.y + p.h - e.y < 20)) {
          e.active = false; const stomp = s.inv <= 0; if (stomp) { p.vy = -12; s.stomps += 1; } s.score += stomp ? 50 : 30;
          const c = w3(e.x + 15, e.y + 18); burst3d(c, ['#6fe05b', '#ffffff', '#ffd23f'], 16, { speed: 5, up: 3, size: 0.2, life: 0.7 }); ring3d(c, '#ffffff', 12, { speed: 4, life: 0.4, size: 0.15 });
          const [ex, ey] = at(s, e.x + 15, e.y + 15); fx.pop(ex, ey - 20, `+${stomp ? 50 : 30}`, C.text, 17); hx.hit();
        } else { handleDeath(s); return; }
      }
    }
    for (const c of w.coins) if (!c.got && overlap(p, c)) { c.got = true; s.score += 10; s.coins += 1; burst3d(w3(c.x + 9, c.y + 9), ['#ffd23f', '#fff3b0'], 8, { speed: 3.5, up: 2, g: 9, size: 0.12, life: 0.5 }); hx.tick(); }
    for (const pu of w.powerups) {
      if (!pu.active || !overlap(p, pu)) continue;
      pu.active = false; s.score += 25; hx.good();
      const c = w3(pu.x + 12, pu.y + 12); ring3d(c, C.lime, 20, { speed: 5, life: 0.6, size: 0.18 }); burst3d(c, ['#7dff6b', '#ffffff'], 14, { speed: 4, up: 2, size: 0.15, life: 0.6 });
      const [ex, ey] = at(s, pu.x + 12, pu.y + 12);
      if (pu.type === 'life') { s.lives = Math.min(9, s.lives + 1); fx.pop(ex, ey - 20, '+1 VIDA', C.red, 17); }
      else if (pu.type === 'doublejump') { s.dj = Math.min(6, s.dj + 3); fx.pop(ex, ey - 20, '¡DOBLE SALTO!', C.cyan, 16); }
      else { s.inv = 5; s.gun = true; fx.pop(ex, ey - 20, '¡ESTRELLA!', C.amber, 17); }
    }
    for (const blk of (w.blocks || [])) {
      if (!blk.active) continue;
      if (blk.bump > 0) blk.bump = Math.max(0, blk.bump - 1 / 60);
      if (overlap(p, blk)) {
        if (p.vy < 0 && !blk.hit) {
          blk.hit = true; blk.bump = 0.25; p.y = blk.y + blk.h; p.vy = 0; w.powerups.push({ x: blk.x + blk.w / 2 - 12, y: blk.y - 30, w: 25, h: 25, active: true, type: blk.type }); hx.heavy();
          burst3d(w3(blk.x + 17, blk.y + 30), ['#ffc233', '#ffe9a0', '#8a5a2a'], 14, { speed: 4, up: 2, g: 10, size: 0.16, life: 0.6 });
        }
        else if (p.vy > 0) { p.y = blk.y - p.h; p.vy = 0; p.ground = true; }
        else if (p.vy < 0 && blk.hit) { p.y = blk.y + blk.h; p.vy = 0; }
      }
    }
    for (const pr of s.proj) {
      if (!pr.active) continue; pr.x += pr.vx;
      burst3d(w3(pr.x + 5, pr.y + 5, 0.1), '#ffb23d', 1, { speed: 0.4, life: 0.3, size: 0.18, g: 0 });
      if (Math.abs(pr.x - p.x) > 520) { pr.active = false; continue; }
      for (const e of w.enemies) if (e.active && overlap(pr, e)) {
        pr.active = false; hx.hit(); burst3d(w3(pr.x, pr.y), ['#ff8a3d', '#ffd23f'], 10, { speed: 5, size: 0.18, life: 0.5 });
        if (e.boss) { if (e.hurt <= 0) hurtBoss(s, e, false); break; }
        e.active = false; s.score += 30; burst3d(w3(e.x + 15, e.y + 15), ['#6fe05b', '#ffffff'], 14, { speed: 5, up: 2, size: 0.2, life: 0.6 }); break;
      }
    }
    s.proj = s.proj.filter(q => q.active);
    if (w.goal && !s.done && overlap(p, w.goal)) {
      s.done = true; hx.win(); fx.flash('#fff', 0.35); const bonus = 100 + s.level * 10; s.score += bonus;
      const gc = w3(w.goal.x + w.goal.w / 2, w.goal.y, 0.5);
      burst3d(gc, ['#7dff6b', '#ffc233', '#ff6fa8', '#4de1ff', '#ffffff'], 70, { speed: 9, up: 5, g: 9, size: 0.26, life: 1.4 }); ring3d(gc, '#7dff6b', 28, { speed: 8, life: 0.8, size: 0.2 });
      fx.pop(SCREEN_W / 2, SCREEN_H * 0.35, `¡MUNDO ${s.level} COMPLETO! +${bonus}`, C.lime, 22); submitBest(s.score);
      if (s.level >= 30) { later(() => { setRes({ isNew: submitBest(s.score), won: true }); s.over = true; setPhase('over'); }, 1100); }
      else later(() => { save(); loadLevel(s.level + 1, s.lives, s.score); save(); }, 1200);
    }
  };

  useLoop(phase === 'play', dt => {
    const s = g.current; s.acc += dt; let n = 0;
    while (s.acc >= 1 / 60 && n < 4) { s.acc -= 1 / 60; n += 1; if (!s.done && !s.over) stepFrame(s); if (s.over) break; }
    const p = s.p;
    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    if (s.toast) { s.toast.t -= dt; if (s.toast.t <= 0) s.toast = null; }
    // animación del personaje: gira hacia donde mira, camina al moverse, polvo al aterrizar
    s.yawv += ((p.face > 0 ? -Math.PI / 2 : Math.PI / 2) - s.yawv) * Math.min(1, dt * 14);
    s.walk += ((p.vx !== 0 && p.ground ? 1 : 0) - s.walk) * Math.min(1, dt * 12);
    if (p.ground && !s.wasGround) burst3d(w3(p.x + p.w / 2, p.y + p.h, 0.4), '#e8e0cc', 5, { speed: 2.2, up: 0.6, g: 5, size: 0.14, life: 0.45 });
    if (p.ground && p.vx !== 0 && Math.random() < dt * 8) burst3d(w3(p.x + p.w / 2 - p.face * 10, p.y + p.h, 0.3), '#e8e0cc', 1, { speed: 1, up: 0.8, g: 4, size: 0.12, life: 0.4 });
    s.wasGround = p.ground;
    // cámara suavizada, detrás del personaje según hacia dónde mira
    const k = Math.min(1, dt * 7);
    s.camX += (wx(p.x + p.w / 2) - s.camX) * k;
    s.camY += (wy(p.y + p.h) - s.camY) * k;
    s.cf += (p.face - s.cf) * Math.min(1, dt * 4);
    s.cam = camOf(s);
  });

  const jumpPress = () => {
    const s = g.current; const p = s.p; if (phase !== 'play' || s.over) return;
    if (p.ground) { p.vy = PQ_JUMP; p.ground = false; hx.tap(); burst3d(w3(p.x + 15, p.y + p.h, 0.4), '#ffffff', 5, { speed: 2.5, up: 0.5, g: 5, size: 0.13, life: 0.4 }); }
    else if (s.dj > 0) { s.dj -= 1; p.vy = PQ_JUMP; hx.hit(); ring3d(w3(p.x + 15, p.y + p.h, 0.3), C.cyan, 18, { speed: 4, life: 0.5, size: 0.15 }); }
  };
  const jumpRelease = () => { const p = g.current.p; if (p.vy < -7) p.vy *= 0.55; };
  const shoot = () => {
    const s = g.current; const p = s.p; if (phase !== 'play' || !s.gun) return;
    s.proj.push({ id: uid(), x: p.face > 0 ? p.x + p.w : p.x - 10, y: p.y + p.h / 2 - 5, vx: 10 * p.face, w: 10, h: 10, active: true }); hx.hit();
  };

  const s = g.current;
  const scene = buildScene(s, phase === 'play' ? s.t : s.t);
  const cam = scene.cam;
  const qLabels = phase === 'play' ? s.world.blocks.filter(b => b.active && !b.hit && Math.abs(wx(b.x) - cam.l[0]) < 12).map(b => { const q = project(cam, [wx(b.x + b.w / 2), wy(b.y + b.h / 2), 0.55], SCREEN_W, SCREEN_H); return q ? { x: q.x, y: q.y, id: b.x } : null; }).filter(Boolean) : [];
  const hud = <>
    <Lives n={s.lives} max={Math.max(3, s.lives)} />
    <HudPill icon="🌍" value={`${s.level}/30`} color={s.level % 10 === 0 ? C.red : C.lime} />
    {(s.dj > 0 || s.gun || s.inv > 0) ? <HudPill value={`${s.dj > 0 ? `🦅×${s.dj} ` : ''}${s.gun ? '🔥 ' : ''}${s.inv > 0 ? `⭐${Math.ceil(s.inv)}s` : ''}`} color={C.amber} /> : null}
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <Btn3D label="🗺" size="sm" ghost color={C.violet} onPress={() => setSelect(true)} testID="pq-map" />
      <Btn3D label="💾" size="sm" ghost color={C.cyan} testID="pq-save" onPress={() => { save(); s.toast = { m: '💾 Partida guardada', t: 1.5 }; hx.good(); }} />
    </View>
  </>;

  return (
    <View style={{ flex: 1 }}>
      <Game3D title={`PIXEL QUEST · MUNDO ${s.level}`} emoji="🍄" accent={C.lime} onExit={onExit} score={s.score} best={best} fx={fx}
        phase={phase} onStart={start} scene={scene} menuScene={() => buildScene(s, s.t)} orbit={t => orbitCam(scene, t, { c: [wx(s.p.x + 15), wy(s.p.y + 30) + 0.9, 0], r: 8, h: 2.6, speed: 0.2, ly: 0, drop: 1.4 })} hud={hud}
        subtitle="Plataformas en 30 mundos de bloques 3D"
        lines={['◀ ▶ mover · 🅰 saltar (mantén para saltar más alto)', 'Salta sobre los slimes para aplastarlos', '❓ golpea desde abajo · ⭐ invencible + 🔥 disparo · 🦅 doble salto', 'Llega a la bandera 🏁 de cada mundo · 👑 jefes en los mundos 10, 20 y 30']}
        result={{ won: res.won, isNew: res.isNew, title: res.won ? '¡30 MUNDOS CONQUISTADOS!' : 'GAME OVER', emoji: res.won ? '🏆' : '💀', subtitle: res.won ? `Puntuación final ${s.score}` : `Caíste en el mundo ${s.level}`, stats: [['MUNDO', `${s.level}/30`], ['MONEDAS', s.coins], ['PISOTONES', s.stomps]] }}>
        {qLabels.map(q => <Text key={q.id} pointerEvents="none" style={{ position: 'absolute', left: q.x - 20, top: q.y - 20, width: 40, textAlign: 'center', color: '#fff', fontSize: 26, fontWeight: '900', ...tglow('#b06a00', 6) }}>?</Text>)}
        {s.banner && <Text pointerEvents="none" style={{ position: 'absolute', top: '22%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: 3, opacity: Math.min(1, s.banner.t), ...tglow('#000', 8) }}>{s.banner.text}</Text>}
        {s.toast && <Text pointerEvents="none" style={{ position: 'absolute', top: 6, left: 0, right: 0, textAlign: 'center', color: '#fff', fontWeight: '900', ...tglow('#000', 5) }}>{s.toast.m}</Text>}
        {!select && (
          <>
            <ActionBtn testID="pq-left" label="◀" color={C.lime} size={70} onDown={() => { input.left = true; }} onUp={() => { input.left = false; }} style={{ left: 14, bottom: 28 }} />
            <ActionBtn testID="pq-right" label="▶" color={C.lime} size={70} onDown={() => { input.right = true; }} onUp={() => { input.right = false; }} style={{ left: 96, bottom: 28 }} />
            <ActionBtn testID="pq-shoot" label="🔥" color={C.orange} size={60} onDown={shoot} style={{ right: 100, bottom: 30, opacity: s.gun ? 1 : 0.35 }} />
            <ActionBtn testID="pq-jump" label="🅰" color={C.cyan} size={84} onDown={jumpPress} onUp={jumpRelease} style={{ right: 14, bottom: 28 }} />
          </>
        )}
      </Game3D>
      {phase === 'ready' && !select && (
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 12, top: 56, zIndex: 50, alignItems: 'flex-end', gap: 8 }}>
          {maxLevel > 1 ? <Btn3D testID="pq-cont" label={`CONTINUAR`} size="sm" color={C.lime} onPress={cont} /> : null}
          <Btn3D testID="pq-worlds" label="🗺 MUNDOS" size="sm" ghost color={C.violet} onPress={() => setSelect(true)} />
        </View>
      )}
      {select && <WorldSelect maxLevel={maxLevel} level={s.level} onPick={wd => { hx.tap(); loadLevel(wd, 3, 0); }} onClose={() => setSelect(false)} />}
    </View>
  );
}
