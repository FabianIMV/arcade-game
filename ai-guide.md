# 🤖 Guía para IAs (Claude, Gemini, ChatGPT): Desarrollo con Expo Go en Codespaces

Este documento está diseñado para dar contexto a asistentes de IA sobre cómo configurar, depurar y ejecutar correctamente una aplicación de Expo (SDK 54+) cuando el usuario está desarrollando en un entorno Cloud (GitHub Codespaces) y probando en un iPhone físico usando **Expo Go**.

## 🌍 Contexto del Entorno
- **Entorno de Desarrollo:** GitHub Codespaces (Ubuntu Linux, sin interfaz gráfica local).
- **Dispositivo de Prueba:** iPhone físico con la app **Expo Go** instalada.
- **Red:** El iPhone y el Codespace NO están en la misma red local.

## 🚨 El Problema: "Runtime is not ready" / "Mismatch" / Pantalla Blanca
Al actualizar o crear un proyecto en Expo SDK 54, es muy común encontrarse con errores críticos al abrir la app en Expo Go:
1. Error visible: `Runtime is not ready` o `mismatch between JavaScript part and native part`.
2. Error silencioso: La app carga el bundle al 100% pero se queda en una **pantalla blanca** infinita.

### ❌ Lo que NO funciona (Errores comunes de las IAs)
- **Desactivar la nueva arquitectura:** Cambiar `"newArchEnabled": false` en `app.json` ya no es la solución recomendada para SDK 54.
- **Hacer downgrade manual de paquetes:** Forzar `react-native-reanimated` a la v3 suele romper otras dependencias o causar conflictos con el caché de Metro.

### ✅ La Solución Definitiva (El Fix)
El problema de la pantalla blanca en SDK 54 con Expo Go generalmente se debe a un conflicto en la configuración de Babel y versiones desalineadas de módulos nativos.

**Paso 1: Limpiar dependencias conflictivas**
Si el proyecto tiene `expo-updates` y solo se quiere usar Expo Go localmente, es mejor quitarlo para evitar conflictos de runtime:
```bash
npm uninstall expo-updates
```

**Paso 2: Alinear versiones al SDK 54**
Dejar que Expo resuelva las versiones correctas (esto instalará `react-native-reanimated` v4 y las versiones correctas de `gesture-handler`, `screens`, etc.):
```bash
npx expo install --fix
```

**Paso 3: Corregir `babel.config.js` (CRÍTICO)**
En SDK 54 con Reanimated v4, **NO** se debe incluir el plugin de reanimated. Si está, causa la pantalla blanca.
```javascript
// CORRECTO:
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // ELIMINAR: plugins: ['react-native-reanimated/plugin']
  };
};
```

**Paso 4: Asegurar la Nueva Arquitectura**
En `app.json`, asegurarse de que esté habilitada:
```json
"newArchEnabled": true
```

## 🚀 Cómo levantar el servidor para el iPhone

Dado que estamos en un Codespace, la IP local (`127.0.0.1` o `192.168.x.x`) no le sirve al iPhone. Hay dos métodos:

### Método 1: Usar un Túnel (Recomendado para Dev)
```bash
npx expo start --tunnel --clear
```
*Nota para la IA:* Siempre usa `--clear` después de cambiar dependencias o el `babel.config.js`. El usuario deberá escanear el QR o ingresar la URL `exp://...exp.direct` manualmente en Expo Go.

### Método 2: Publicar vía EAS Update (Alternativa)
Si el túnel falla o el usuario quiere ver la app en la pestaña "Projects" de su cuenta en Expo Go:
1. Asegurar que el `app.json` tiene el `projectId` de EAS.
2. Ejecutar el update de forma no interactiva (vital en Codespaces):
```bash
CI=1 npx eas-cli update --branch main --message "Update"
```
*Nota:* El usuario luego abre Expo Go, va a su perfil, selecciona el proyecto y cargará la última actualización de la rama `main`.

---
**Resumen para la IA:** Si el usuario reporta pantalla blanca en Expo Go + SDK 54, revisa inmediatamente el `babel.config.js`, quita el plugin de reanimated, corre `expo install --fix`, y levanta con `--tunnel --clear`.
