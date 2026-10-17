# Cámaras en vivo · ClassFocus 3.0

ClassFocus 3.0 incluye un prototipo funcional para que el maestro vea las cámaras de los alumnos que estén dentro de una clase.

## Cómo funciona

1. El alumno entra a **Clase** y pulsa **Iniciar cámara**.
2. El navegador publica que el alumno está conectado.
3. El panel del maestro detecta al alumno y solicita el video.
4. El video viaja entre navegadores mediante **WebRTC**.
5. `server/signalingServer.js` usa WebSocket únicamente para intercambiar las ofertas/respuestas de conexión WebRTC.

## Iniciar todo

En Linux/Ubuntu:

```bash
chmod +x start.sh
./start.sh
```

El script inicia:
- Vite: `http://localhost:5173`
- Señalización WebSocket: `ws://localhost:8787`

## Probar con dos pestañas

- Pestaña 1: inicia sesión como `teacher@classfocus.com` / `123456`.
- Pestaña 2: inicia sesión como `student@classfocus.com` / `123456`, entra a Programación I, abre **Clase** y enciende la cámara.
- En el panel del maestro debe aparecer el alumno en **Cámaras de alumnos conectados**.

## Probar con dos equipos en la misma red

1. En la computadora que ejecuta ClassFocus obtén su IP local, por ejemplo `192.168.1.25`.
2. Desde el alumno abre `http://192.168.1.25:5173`.
3. El servidor de señalización se detecta automáticamente en `ws://192.168.1.25:8787`.
4. Asegúrate de que el firewall permita los puertos 5173 y 8787.

> Nota: algunos navegadores solo permiten `getUserMedia()` (cámara) en `localhost` o HTTPS. Para pruebas reales entre equipos, usa HTTPS o configura un certificado de desarrollo.

## Producción

Para una universidad real se recomienda:
- Laravel para autenticar usuarios y validar que maestro/alumno pertenezcan a la misma materia.
- Laravel Reverb / WebSocket o un servidor equivalente para señalización autenticada.
- HTTPS + WSS.
- TURN (por ejemplo Coturn) para redes donde WebRTC P2P no pueda conectarse directamente.
- Consentimiento visible para la cámara y política de privacidad/retención de video.

El prototipo actual **no graba video**: transmite el stream mientras la cámara del alumno permanece encendida.
