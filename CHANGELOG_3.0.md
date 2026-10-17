# Cambios ClassFocus 3.0

- Panel Super Admin para crear, editar y eliminar materias.
- Código, sección, horario y docente base por materia.
- Asignación alumno → materia → maestro.
- Maestro con monitor de cámaras de alumnos conectados.
- WebRTC + servidor de señalización WebSocket incluido.
- Maestro puede crear, editar, publicar, ocultar y eliminar evaluaciones.
- Tiempo límite configurable de 1 a 480 minutos.
- Contador regresivo en el examen del alumno.
- Enlace opcional para Google Forms / Microsoft Forms por evaluación.
- Evaluaciones publicadas visibles en el panel del alumno.
- Marca visual USPG en encabezado/login con respaldo local.
- Sesión por pestaña para probar maestro y alumno simultáneamente.
- Scripts `start.sh` y `start.bat` levantan la app y el servidor de señalización.
- Documentación de WebRTC/Laravel actualizada.

## 3.1.0 - Identidad USPG
- Se reemplazó el recorte remoto anterior por el logotipo completo de Universidad San Pablo de Guatemala suministrado por el usuario.
- El encabezado muestra ClassFocus + divisor + marca USPG completa.
- El recurso queda local en `public/uspg-logo-full.png`, por lo que no depende de Internet para mostrar el logotipo.
- Ajuste responsive: en pantallas pequeñas se conserva ClassFocus y se oculta la marca extendida para evitar desbordes.
