# Clase en vivo · prueba local

Esta implementación parte de la integración de Classroom del commit `760774e`.
No añade dependencias ni cambia el esquema de la base de datos.

## Iniciar

Conserva tu `.env` actual, incluidos los secretos de Classroom. **No lo reemplaces por
`.env.example`**. El servicio de señalización ahora lee ese mismo archivo para validar
las sesiones y matrículas mediante `DATABASE_URL`.

Para la prueba en esta PC, los valores existentes bastan:

```dotenv
FRONTEND_URL=http://localhost:5173
SIGNALING_PORT=8787
# Opcional; si no existe, se usa este valor:
SIGNALING_HOST=127.0.0.1
```

Si Vite cambia automáticamente a 5174 porque 5173 está ocupado, cierra el proceso antiguo
y vuelve a abrir 5173. El origen de la página debe coincidir con `FRONTEND_URL`.
`VITE_SIGNALING_URL` puede seguir vacío: se calcula a partir del host del navegador.

Desde `~/projects/ClassFocus`, mantén tres terminales:

```bash
# Terminal 1: PostgreSQL y API; espera a ver la API activa.
docker compose up -d postgres
npm run api
```

```bash
# Terminal 2: reiniciar este proceso es obligatorio si seguía abierta la versión anterior.
npm run signal
```

```bash
# Terminal 3:
npm run dev
```

Abre `http://localhost:5173/`. `localhost` permite solicitar cámara, micrófono y pantalla.
La dirección HTTP de la red local no equivale a un contexto seguro para esos permisos.
La configuración de esta prueba escucha la señalización solo en esta PC.

## Probar como maestro y alumnos

Usa pestañas independientes: las sesiones locales se guardan en `sessionStorage`.
Cada usuario entra con su rol y contraseña local, no con la contraseña de Google.
No dupliques una pestaña ya autenticada para probar otro alumno sin cerrar primero su sesión.

| Participante | Correo | Contraseña demo | Materia |
| --- | --- | --- | --- |
| Maestro | teacher@classfocus.com | 123456 | Programación I |
| Alumno 1 | student@classfocus.com | 123456 | Programación I |
| Alumno 2 | maria@classfocus.com | 123456 | Programación I |

Estas matrículas son las demo iniciales; si las editaste, elige una materia que compartan.
Los alumnos nuevos importados desde Classroom todavía necesitan un mecanismo de acceso
local: importar su matrícula no les asigna la contraseña demo. Para esta primera prueba,
usa las cuentas anteriores.

1. Maestro: en su panel, selecciona **Programación I** en **Un espacio para tu clase** y pulsa
   **Abrir aula**. Se abre una pantalla dedicada; allí pulsa **Iniciar clase**.
2. Antes de iniciar, puedes probar cámara, micrófono y altavoces con los controles de la previa.
   El maestro conserva al entrar los dispositivos que haya activado; también puede activarlos después.
3. Alumno: en su panel, la materia muestra **Clase en vivo**. Pulsa **Unirse a clase**,
   después **Entrar a clase**. Debe ver y escuchar
   al maestro. Su cámara mantiene la elección de la previa y su micrófono entra apagado.
4. Alumno: activa su cámara. Aparece únicamente en el aula del maestro. El análisis facial
   utiliza esa misma cámara y guarda muestras como antes, sin capturarla por segunda vez.
   Si MediaPipe no carga, la llamada continúa y se muestra que el análisis no está disponible.
5. Alumno 1: pulsa **Levantar la mano**. Maestro: en **Participantes**, selecciona al alumno y pulsa **Dar la palabra** en su ficha.
   También puedes abrir esa ficha desde los tres puntos de su video.
   El alumno puede entonces pulsar **Activar micrófono**: deben escucharlo el maestro y el
   alumno 2. No recibe su propia voz reenviada. El maestro puede seguir hablando.
6. Maestro: pulsa **Quitar la palabra**, o el alumno pulsa **Devolver la palabra**. Su micrófono
   se detiene. Conceder el turno a otro alumno retira el anterior.
7. Maestro: pulsa **Compartir pantalla** y elige una ventana. La pantalla sustituye el video
   que ven los alumnos; el micrófono del maestro sigue funcionando. No se captura audio de
   sistema ni de pestaña. **Dejar de compartir** o el botón del navegador devuelve la cámara.
   Si la cámara está apagada, el alumno debe ver el marcador de cámara apagada, sin conservar
   el último fotograma de la pantalla. El audio continúa sin reiniciar la llamada.
8. Alumno: pulsa **Salir de clase**. Maestro: debe desaparecer de la lista. Maestro:
   **Finalizar clase → Finalizar para todos** debe sacar a los alumnos y liberar cámara, micrófono y pantalla.

Si el navegador bloquea la reproducción automática, usa el botón **Escuchar** que aparece.
Para evitar acople, usa audífonos. En una sola PC puedes verificar la imagen del maestro,
apagar su cámara y luego activar la del alumno si el dispositivo no permite uso simultáneo.
La prueba de voces requiere dispositivos de audio que el navegador pueda compartir.
No podemos sustituir estas comprobaciones por los tests automatizados.

## Comprobar dispositivos antes de entrar

La previa del maestro y del alumno permite **Probar cámara**, **Probar micrófono** y
**Probar altavoces**. No abre una sala ni envía audio/video a otros participantes.

- La cámara muestra video local y permite elegir entre las cámaras disponibles.
- El micrófono permite elegir la entrada y muestra un medidor al hablar. La voz no se reproduce
  por los altavoces ni se graba. Puedes detener la prueba antes de entrar.
- **Probar altavoces** reproduce un tono breve generado en la aplicación. La selección de salida
  se ofrece si el navegador admite `setSinkId`; en caso contrario utiliza la configuración del
  sistema. La salida seleccionada también se usa para escuchar la llamada.
- Los nombres de los dispositivos pueden aparecer después de conceder permiso. Si no hay
  micrófono o cámara, aparece una indicación en español y puedes entrar sin activarlos.
- Al entrar se transfiere la cámara ya abierta sin volver a capturarla. El maestro conserva
  también su micrófono si lo dejó activo. El alumno **siempre entra silenciado**: se detiene su
  micrófono de prueba y solo podrá activarlo cuando tenga un turno concedido.
- Volver al panel libera la captura y el sonido de prueba. Si cierras mientras se solicita un
  permiso, los dispositivos concedidos tarde también se detienen. Si falla la entrada a la
  clase, se liberan los medios transferidos antes de volver a la previa.

## Aula independiente y opciones de vista

El maestro y el alumno utilizan una pantalla dedicada a su materia. El panel del maestro
solo conserva un selector y **Abrir aula**; la llamada ya no aparece entre los cursos,
evaluaciones y métricas. El aula se abre como otra página dentro de la misma pestaña,
igual que el acceso del alumno, y mantiene la sesión local existente.

- **Mosaico**: videos distribuidos en una cuadrícula. Para el maestro incluye su cámara y las
  de sus alumnos; para el alumno, únicamente la del maestro y la suya.
- **Enfoque**: un video grande con los demás en una tira inferior. **Fijar video** elige a quién
  destacar; quitar la fijación permite seguir al alumno con turno o al primer participante.
  La fijación solo cambia tu vista y no altera lo que reciben los demás.
- **Presentación**: área principal para la pantalla compartida, con cámaras pequeñas debajo.
  Al compartir, el maestro cambia automáticamente a esta vista; al detener, vuelve a su vista
  anterior. La cámara propia puede seguir activa durante la presentación.
- El inicio y fin de la presentación se sincronizan con los alumnos. Al terminar, se limpia el
  reproductor y se restaura la vista previa a la presentación; si el maestro tiene cámara
  encendida, vuelve a ella, y si no, aparece su cámara apagada. Esta actualización requiere
  reiniciar tanto `npm run signal` como `npm run dev` después de aplicar el parche.
- **Pantalla completa**: botón de la cabecera. **Ampliar video** fija el video y amplía el aula.
  Pulsa Escape o el botón de salida para volver. No solicita permisos de cámara o micrófono.
- **Participantes**: panel lateral que se puede ocultar; en pantallas pequeñas aparece sobre
  los videos. Las manos levantadas se muestran primero. Selecciona a un alumno para abrir una
  única ficha de acciones: **Dar/Quitar la palabra** o **Ver enfocado**. Los tres puntos de su video
  abren esa misma ficha. La lista tiene desplazamiento propio, sin amontonar nombres y botones.
- Los controles de cámara, micrófono, presentación/mano y salida permanecen en la barra inferior.
  Cambiar la distribución o fijar videos no reinicia WebRTC ni detiene los dispositivos.
- **Volver al panel** y **Finalizar clase / Salir de clase** piden confirmación mientras la llamada
  está activa. Cerrar o recargar la pestaña utiliza el aviso nativo del navegador cuando este lo
  permite. Navegar fuera del aula detiene sus medios; la llamada no continúa en segundo plano.

Si no hay micrófono, aparece **No se encontró ningún micrófono disponible** con indicaciones
para conectarlo o habilitarlo. El error no finaliza la llamada ni apaga la cámara. También se
traducen permisos rechazados, dispositivos ocupados y errores al compartir o ampliar.

## Avisos de clase en el panel del alumno

El panel consulta el servidor de señalización con la sesión local. Solo muestra salas de
materias matriculadas: abrirlo no entra a una llamada ni solicita cámara o micrófono.

- Con el alumno ya en su panel, inicia una clase desde otra pestaña como maestro. La materia
  debe cambiar a **Clase en vivo**, mostrar al docente y habilitar **Unirse a clase** sin recargar.
  También aparece un aviso de inicio con acceso directo; **Cerrar** oculta solo ese aviso.
- Si el alumno abre el panel cuando la clase ya empezó, verá la materia activa y el botón.
- Al finalizar la clase o desconectarse el maestro, vuelve a **Sin clase activa** y el botón
  queda deshabilitado. Si se abre de nuevo, se trata como una nueva clase.
- Al detener señalización, el panel muestra **Estado de clase no disponible** y borra los
  indicadores anteriores. Intenta reconectar automáticamente; no presenta una clase como
  inactiva sin haberlo confirmado con el servidor.
- Las sesiones revocadas dejan de recibir avisos. Los cambios de matrícula también se revisan
  periódicamente, además de en cada actualización. El panel no recibe listas de alumnos.

## Comportamiento y límites de esta etapa

- Una sala activa por materia, un maestro y hasta ocho alumnos. Es un límite del prototipo,
  no una garantía de rendimiento: depende del equipo y del ancho de banda del maestro.
- Cada alumno se conecta únicamente al maestro. El maestro reenvía solo el audio del turno
  autorizado a los otros alumnos. Las cámaras de alumnos no se distribuyen entre ellos.
- La previa solo abre dispositivos cuando el usuario los prueba. Dar la palabra no activa automáticamente el micrófono.
  Revocar el turno detiene la captura. Salir, cambiar de página o finalizar libera los medios.
- La caída o salida del maestro finaliza la sala. No hay reconexión automática: vuelve a iniciar
  o entrar con el botón. Las sesiones inválidas y matrículas retiradas se revisan en las
  acciones y periódicamente; no se conserva acceso indefinido tras cerrar sesión.
- Si falla una conexión de un alumno, puede salir y volver a entrar sin reiniciar toda la clase.
- La clase no se graba. Las muestras de atención siguen guardándose mediante la API existente.
  Las métricas estiman orientación facial y no demuestran aprendizaje o distracción.

## Pruebas automatizadas

```bash
npm test
npm run build
```

Las pruebas existentes de Classroom permanecen. Las nuevas pruebas verifican WebSockets
reales, consultas de permisos con PostgreSQL en memoria, suplantación, salas ajenas,
solicitudes de palabra, cambios de turno, baja de matrícula, expiración de sesión y cierre.
Las pruebas comprueban selección y liberación de dispositivos, traspaso sin recaptura,
entrada silenciada del alumno, medidor sin retorno de voz y tono de prueba local.
Las pruebas React comprueban previa interactiva, lista de ocho alumnos, ficha seleccionada,
navegación al aula, cambio de vistas, fijación, pantalla
completa, confirmación de salida y mensajes de dispositivos en español. Usan un transporte
simulado y no sustituyen la prueba visual o de medios reales en tu navegador.
Los dobles de WebRTC verifican colas ICE, pistas reservadas, reenvío sin eco y liberación
cuando se cierra la clase durante un permiso pendiente. No simulan la red ni los codecs
reales de un navegador: la lista manual anterior completa esa validación.

## Despliegue posterior

GitHub Pages no ejecuta este servidor. Por ahora seguimos en local. Para varias redes harán
falta HTTPS/WSS, un backend accesible, revisión de orígenes, servidores TURN y, para grupos
grandes, una arquitectura con servidor de medios (SFU). STUN por sí solo no conecta todas
las redes. Ese despliegue queda fuera de esta prueba local.

El cliente admite `VITE_RTC_ICE_SERVERS` como lista JSON opcional de servidores ICE; sin ella
usa STUN de Google. Un TURN futuro debe emitir credenciales temporales. Todo valor `VITE_`
queda visible en el navegador y el build, así que nunca pongas secretos permanentes allí.

Referencias técnicas: [addTransceiver](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addTransceiver),
[replaceTrack](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/replaceTrack),
[getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).
