# Google Classroom: conexión real desde Express

Esta versión conecta cuentas de Google mediante OAuth 2.0 con código de autorización,
PKCE y un estado de un solo uso ligado al navegador y a la sesión de ClassFocus.
Los tokens se cifran con AES-256-GCM en PostgreSQL; no se guardan en React.
No cambia a Laravel ni MySQL: se conservan Express y PostgreSQL.

## 1. Preparar Google Cloud

1. Abre https://console.cloud.google.com/ y crea un proyecto para ClassFocus.
2. Activa **Google Classroom API**.
3. En **Google Auth Platform**, configura nombre de aplicación, correo de soporte y audiencia.
   Para probar con cuentas de distintos dominios, usa audiencia externa en estado de prueba y
   agrega como usuarios de prueba los correos exactos que autorizarán la conexión.
   La audiencia interna solo sirve para la organización Workspace del proyecto.
4. Configura estos permisos de lectura, además de identidad `openid`, `email` y `profile`:
   - `https://www.googleapis.com/auth/classroom.courses.readonly`
   - `https://www.googleapis.com/auth/classroom.rosters.readonly`
   - `https://www.googleapis.com/auth/classroom.profile.emails`
5. Crea un cliente OAuth de tipo **Aplicación web**.
6. Registra exactamente esta **URI de redireccionamiento autorizada**:
   `http://localhost:8788/api/classroom/callback`
7. Guarda el **Client ID** y el **Client secret** en tu `.env`, no en GitHub ni en el chat.

La cuenta institucional puede necesitar autorización del administrador de Workspace para
aplicaciones externas. Si Google bloquea el acceso, registra el mensaje y solicita la aprobación;
no se simula una conexión exitosa ni se omiten sus restricciones.

## 2. Configurar el proyecto existente

No reemplaces tu `.env` si ya contiene configuración local. Agrega o actualiza estas variables:

```env
FRONTEND_URL=http://localhost:5173
GOOGLE_CLIENT_ID=EL_ID_REAL.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=EL_SECRETO_REAL
GOOGLE_REDIRECT_URI=http://localhost:8788/api/classroom/callback
GOOGLE_TOKEN_ENCRYPTION_KEY=CLAVE_HEXADECIMAL_DE_64_CARACTERES
```

Genera la clave una vez:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copia el resultado en `GOOGLE_TOKEN_ENCRYPTION_KEY`. Conserva esa clave con tus respaldos:
si la cambias, las conexiones guardadas ya no podrán descifrarse. La antigua variable
`VITE_GOOGLE_CLIENT_ID` dejó de utilizarse y se puede quitar.

```bash
npm ci
docker compose up -d postgres
npm run api
```

En otras dos terminales, desde la carpeta del proyecto:

```bash
npm run signal
```

```bash
npm run dev
```

El arranque local ya usa `/`; no necesita `--base /`.
Usa siempre `http://localhost:5173`, no la IP de la red, para esta configuración de OAuth.
La API agrega las tablas nuevas sin eliminar las anteriores.
Las sesiones anteriores a este cambio requieren iniciar sesión nuevamente.

## 3. Prueba con correo universitario de estudiante

1. Entra con el perfil **Alumno** de ClassFocus (`student@classfocus.com`, clave demo `123456`).
2. Pulsa **Conectar Google Classroom** y elige tu correo universitario.
3. Autoriza los permisos. Volverás al panel del alumno.
4. Selecciona la cuenta vinculada y pulsa **Consultar cursos**.
5. Comprueba tus cursos activos. Se marcan como **ESTUDIANTE** y no habilitan la importación.

El rol de ClassFocus no concede permisos adicionales en Google. Elegir el perfil Maestro
no transforma una cuenta de estudiante en docente de sus cursos.

## 4. Prueba de importación con una cuenta docente

1. Entra al perfil **Maestro** (`teacher@classfocus.com`, clave demo `123456`).
2. Conecta una cuenta que sea docente de una clase de prueba con alumnos.
3. Pulsa **Consultar cursos**. Solo los cursos marcados **DOCENTE** ofrecen importar.
4. Pulsa **Importar curso y alumnos**. El servidor consulta todas las páginas de la matrícula.
5. El éxito se muestra después de confirmar la transacción en PostgreSQL.
6. Pulsa de nuevo **Sincronizar alumnos**: no debe duplicar materia ni alumnos.
7. Agrega o retira un alumno en Classroom y vuelve a sincronizar. Solo cambia la matrícula
   del curso seleccionado; no se eliminan las personas ni sus incidencias históricas.
8. Comprueba el resultado desde Super Admin. Las materias y matrículas de Classroom se
   administran desde Classroom y no mediante los formularios manuales del administrador.

Un error de permisos o una página fallida cancela la importación completa. No se interpreta
como «cero alumnos». Si Google no permite ver todos los correos, la operación se detiene
con una explicación, sin inventar usuarios por nombres.

## Comportamiento y alcance

- Un usuario local puede vincular varias cuentas institucionales o personales; cada una conserva
  su propia conexión. Una cuenta de Google solo puede vincularse a un usuario de ClassFocus.
- El curso se identifica por el ID de Google, nunca por nombre, sección o universidad.
- Los alumnos se vinculan por ID de Google y, en el primer encuentro, por correo exacto sin
  distinguir mayúsculas. Un cambio posterior de nombre no crea otra persona.
- La cuenta local del maestro que importa es responsable del curso. Los datos de los docentes
  de Google también se conservan como referencia. Esta versión admite **un responsable local
  de sincronización por curso**; otro maestro no puede apropiarse del curso al reimportarlo.
- El modelo existente admite un rol por usuario. Si un correo ya existe con otro rol, se cancela
  la importación y se informa el conflicto, sin cambiar ese rol silenciosamente.
- Importar crea la matrícula; no activa cámaras ni inicia sesiones de los alumnos.
- Los alumnos nuevos importados **no reciben la contraseña demo** ni pueden entrar con `123456`.
  Si el alumno ya tenía cuenta local, conserva su acceso. Para habilitar cuentas importadas nuevas
  falta implementar acceso con Google o invitación y establecimiento de contraseña.
- Esta primera entrega importa cursos y participantes. No importa actividades ni notas, no crea
  exámenes a partir de tareas y no escribe en Google Classroom. Los datos de actividades importados
  por versiones anteriores se conservan, pero no se actualizan aquí.
- Desvincular elimina los tokens de esa cuenta local; conserva los datos importados. No revoca el
  consentimiento global del proyecto Google para evitar afectar otras conexiones. El usuario
  puede revocarlo desde la sección de conexiones de su cuenta de Google.
- Las credenciales pueden caducar o ser revocadas; en ese caso se pide reconectar. En proyectos
  externos en estado de prueba Google puede limitar la duración del refresh token.
- La API requiere sesiones de servidor (8 horas) y limita consultas/escrituras por usuario y rol.
  Los paneles conservan datos en la sesión de cada pestaña para no mezclar usuarios distintos.
- Para un despliegue real aún se debe revisar HTTPS, alojamiento del frontend/API, señalización
  WebSocket autenticada, limitación de intentos y políticas institucionales. GitHub Pages por sí
  solo no ejecuta Express ni PostgreSQL. Esta entrega valida desarrollo en localhost.

## Verificación local

```bash
npm test
npm run build
```

Las pruebas normales no contactan Google y ejecutan SQL sobre PostgreSQL en memoria mediante PGlite. Para probar la API y las transacciones contra una
**base PostgreSQL desechable dedicada**, ejecuta:

```bash
CLASSFOCUS_TEST_DATABASE_URL=postgresql://USUARIO:CLAVE@localhost:5432/classfocus_test npm test
```

Con esa variable se repite el contrato de integración contra el servidor PostgreSQL indicado,
en un esquema temporal que se elimina al terminar. Sin ella, se usa PGlite en memoria.
La prueba rechaza bases cuyo nombre no contenga `test` y no usa la base de desarrollo `classfocus`.
La autorización real con Google requiere tus credenciales y consentimiento y se verifica con
los pasos anteriores; no está sustituida por las pruebas simuladas.

## Referencias oficiales

- OAuth de servidor: https://developers.google.com/identity/protocols/oauth2/web-server
- Permisos de Classroom: https://developers.google.com/workspace/classroom/guides/auth
- Paginación de alumnos: https://developers.google.com/workspace/classroom/reference/rest/v1/courses.students/list
- Roles por curso: https://developers.google.com/workspace/classroom/guides/manage-users
