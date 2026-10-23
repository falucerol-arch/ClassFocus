# ClassFocus · Guía de demostración (Expo de Admisiones USPG)

## 1. Preparación (hacerla ANTES, con internet)

```bash
npm ci
npm run setup:offline            # copia el WASM y descarga el modelo facial: la demo funciona sin internet
docker compose up -d postgres
npm run api                      # terminal 1
npm run signal                   # terminal 2
npm run dev                      # terminal 3
npm run seed:demo -- --reset     # llena los paneles con 3 días de datos (borra incidencias/muestras previas)
```

Comprobar en `http://localhost:5173/demo`: al iniciar la cámara debe aparecer
**Motor: archivos locales (sin internet)**. Si dice “descarga desde CDN”, falta ejecutar `setup:offline`.

> La cámara solo funciona en `localhost` o HTTPS. Para la demo, usa una sola laptop con dos
> pestañas (cada pestaña tiene su propia sesión). No abras la app por la IP de la red.

## 2. Guion de 3 minutos

1. **Demo pública** (`/demo`, sin iniciar sesión). Inicia la cámara. Muestra la malla facial y el medidor.
2. **Pruebas en vivo con el profesor**: gira la cabeza, mira a un lado, tapa el rostro, que se asome otra persona,
   cambia de pestaña. Cada acción genera una alerta y cambia el estado (Atento / Distraído / Varias personas).
3. **Modo anónimo**: activa “solo la malla” y explica que no hace falta mostrar el rostro real.
4. **Doble pantalla**: pestaña 1 como *maestro* (`teacher@classfocus.com`), pestaña 2 como *alumno*
   (`student@classfocus.com`). El alumno entra al examen, acepta el consentimiento y cambia de pestaña:
   la alerta aparece sola en el panel del maestro en ~3 segundos.
5. **Vista rápida de la clase**: recuadros verde/ámbar/rojo por alumno (datos de `seed:demo`).
6. **Cierre ético**: consentimiento previo, nada de video guardado y las señales son apoyo, no prueba.

## 3. Plan B

- Si la cámara falla: usa solo el panel del maestro con los datos de `seed:demo`.
- Si el modelo no carga: revisa `public/models/face_landmarker.task` y vuelve a ejecutar `npm run setup:offline -- --force`.
- Si la base no responde: `docker compose up -d postgres` y reinicia `npm run api`.

## 4. Demo pública en GitHub Pages

Al subir a `main`, el workflow publica el frontend. La ruta `/ClassFocus/demo` funciona **sin API** (usa la
descarga desde CDN de MediaPipe), así que puede compartirse como enlace o código QR. El inicio de sesión y los
paneles sí requieren la API y la base de datos.
