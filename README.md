# ClassFocus v4 · USPG Edition

Prototipo académico para gestionar materias y supervisar clases y evaluaciones virtuales.
React/Vite usa una API Express con PostgreSQL; MediaPipe estima presencia y orientación
facial, y WebRTC/WebSocket permite impartir clases con audio, cámara y pantalla compartida.

## Arranque en Ubuntu

Requisitos: Node.js 22 o 24, npm y PostgreSQL. El repositorio incluye Docker Compose
para ejecutar PostgreSQL 16 sin instalarlo directamente en el sistema.

```bash
git clone https://github.com/falucerol-arch/ClassFocus.git
cd ClassFocus
cp .env.example .env  # solo en una instalación nueva
npm ci
docker compose up -d postgres
npm run api
```

En otra terminal, desde la carpeta del proyecto:

```bash
npm run signal
```

En una tercera:

```bash
npm run dev
```

- Aplicación: http://localhost:5173
- Salud de API/base: http://localhost:8788/api/health
- Señalización: ws://localhost:8787

La API crea las tablas y los usuarios demo al iniciar. Las ampliaciones de Classroom son
aditivas y conservan los datos existentes. `start.sh` también permite iniciar los servicios
juntos; para diagnosticar problemas es más claro mantener las tres terminales separadas.
No combines el contenedor con el instalador `setup-postgres-ubuntu.sh` en el mismo puerto.

## Demo para exposiciones

`/demo` es una página pública (sin iniciar sesión) que muestra el análisis facial en vivo con malla,
medidor de atención y alertas. Sigue **[DEMO_EXPO.md](DEMO_EXPO.md)** para prepararla, el guion de 3 minutos
y el plan B. Para funcionar sin internet: `npm run setup:offline`. Para llenar los paneles con datos:
`npm run seed:demo`. Los cambios de esta versión están en **[CHANGELOG_4.1.md](CHANGELOG_4.1.md)**.

## Accesos de demostración

| Perfil | Correo | Contraseña local demo |
| --- | --- | --- |
| Alumno | student@classfocus.com | 123456 |
| Maestro | teacher@classfocus.com | 123456 |
| Super Admin | admin@classfocus.com | 123456 |

Selecciona el rol correspondiente en la pantalla de acceso. Las sesiones se emiten desde
Express y duran ocho horas. El inicio de sesión y Google Classroom requieren la API.
Una sesión ya abierta puede conservar datos en la caché de su pestaña si se interrumpe
la conexión; esa caché no prueba que un cambio se haya guardado en PostgreSQL.

## Google Classroom

Sigue **[GOOGLE_CLASSROOM_SETUP.md](GOOGLE_CLASSROOM_SETUP.md)** para crear las credenciales,
configurar `.env` y probar cuentas institucionales de estudiante o de docente.

- Cada usuario local puede conectar varias cuentas Google.
- El estudiante puede consultar sus cursos activos.
- El maestro puede importar cursos en los que Google lo reconoce como docente.
- Se consultan todas las páginas de alumnos y se confirma el guardado en una transacción.
- Sincronizar actualiza solo la matrícula del curso seleccionado, sin duplicar personas ni
  mezclar cursos con el mismo nombre o sección de instituciones distintas.
- Los datos importados se conservan al desvincular una cuenta.
- Los tokens de Google se cifran en PostgreSQL y nunca se entregan al frontend.

Esta etapa importa cursos y participantes, sin sincronizar actividades o calificaciones.
Las cuentas nuevas de alumnos importados no reciben `123456`: para habilitarles acceso
falta implementar invitaciones o inicio de sesión con Google. La guía detalla también los
límites del modelo existente (un rol por usuario y un responsable local por curso).

## Clases en vivo

Sigue **[LIVE_CLASS_SETUP.md](LIVE_CLASS_SETUP.md)** para probar una clase local.
El maestro elige una materia y abre un aula independiente; los alumnos matriculados
entran desde su panel. Ambos pueden comprobar sus dispositivos antes de entrar y disponen
de mosaico, enfoque, presentación y pantalla completa. El maestro gestiona los turnos
seleccionando al alumno en la lista o desde los tres puntos de su video.
El panel del alumno indica las clases activas y avisa cuando empiezan, sin recargar.
Los alumnos ven al maestro o su pantalla, y sus cámaras solo las recibe el maestro.
Levantar la mano permite solicitar un turno: el maestro lo concede y el alumno decide
activar su micrófono. El grupo escucha únicamente al alumno autorizado, además del maestro.

La señalización valida sesiones y matrículas en PostgreSQL y separa las salas por materia.
La versión actual limita cada sala a ocho alumnos; el maestro mantiene una conexión WebRTC
con cada uno. No graba llamadas. Una desconexión del maestro finaliza su sala.

## Validación

```bash
npm test
npm run build
```

Las pruebas cubren paginación, permisos, OAuth simulado, cifrado, SQL transaccional,
importación repetida y recuperación ante errores. Usan PostgreSQL en memoria mediante
PGlite y no contactan Google. La guía explica cómo repetirlas contra un PostgreSQL de prueba.
La autorización real requiere credenciales y consentimiento de una cuenta Google.
Las pruebas de clase usan WebSockets reales, SQL en PGlite y dobles de WebRTC/dispositivos;
cubren aislamiento, turnos, ICE adelantado, permisos y liberación de medios.
El audio/video real y la pantalla compartida se prueban en el navegador según la guía.

## Persistencia y despliegue

PostgreSQL guarda usuarios, materias, asignaciones, evaluaciones, incidencias, muestras
de atención, sesiones y conexiones de Classroom. Los videos no se guardan en la base.

`.env`, `node_modules` y `dist` no se versionan. No publiques secretos ni claves de cifrado.
El build conserva la ruta `/ClassFocus/` existente para GitHub Pages, mientras que desarrollo
usa `/`. GitHub Pages por sí solo no ejecuta Express ni PostgreSQL: la integración completa
requiere alojar también la API y configurar HTTPS, sus direcciones y OAuth para ese entorno.

Las métricas faciales son estimaciones y no son evidencia suficiente para calificar o sancionar.
Este proyecto sigue siendo un prototipo; antes de producción deben revisarse privacidad,
consentimiento, seguridad de señalización y operación institucional.
