# ClassFocus 4.1 · Preparación para la Expo

## Nuevo
- **Demo pública `/demo`** (sin login): malla facial en vivo, medidor de atención, giro de cabeza, estadísticas,
  gráfica en el tiempo, registro de incidencias y modo anónimo (solo la malla).
- **Alertas en vivo para el maestro**: nuevo endpoint `GET /api/incidents/live` y panel `LiveAlertsFeed`
  (consulta cada 3 s, sonido opcional). El maestro ve solo sus materias; el admin ve todo.
- **Vista rápida de la clase** (`ClassOverview`): recuadro por alumno con color según atención.
- **Detección de varias personas** y de **copiar/pegar** en los exámenes.
- **Consentimiento previo** al examen y **cronómetro persistente** (recargar la página ya no lo reinicia).
- **Modo sin internet**: `npm run setup:offline` deja MediaPipe local; la CDN queda solo como respaldo.
- **Datos de demostración**: `npm run seed:demo` (`-- --reset` para empezar de cero).

## Mejorado
- `FaceAnalyzer`: respaldo a CPU si falla la GPU, uso del iris además del giro de cabeza y devuelve todas las caras.
- API de incidentes y muestras: la hora la fija el servidor; el tipo, la severidad y la atención se validan.
- Router con `basename` y logo con ruta base: ahora funciona bajo `/ClassFocus/` en GitHub Pages.
- Workflow de Pages: Node 22 y `404.html` para abrir rutas directas.

## Pendiente conocido
- El intento de examen aún no se registra en el servidor (la hora límite vive en la pestaña).
- Las pruebas automáticas no cubren aún `/api/incidents/live` ni la demo.
