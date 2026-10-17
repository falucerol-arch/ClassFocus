# Google Classroom + ClassFocus

ClassFocus incluye dos modos para Google Classroom:

1. **Modo demo**: funciona inmediatamente y permite probar la importación de cursos, alumnos, docentes y actividades sin credenciales.
2. **OAuth real**: conecta la cuenta Google del usuario con Google Classroom API.

## 1. Crear el proyecto en Google Cloud

1. Entra a Google Cloud Console.
2. Crea o selecciona un proyecto, por ejemplo `ClassFocus-USPG`.
3. Activa **Google Classroom API**.
4. Abre **Google Auth Platform** y configura la pantalla de consentimiento.
   - Para una cuenta institucional de Google Workspace, puedes usar audiencia interna si aplica.
5. Crea un **OAuth Client ID** de tipo **Web application**.
6. En **Authorized JavaScript origins** agrega:
   - `http://localhost:5173`
   - El dominio HTTPS real de ClassFocus cuando se publique.
7. Copia el Client ID.

## 2. Configurar ClassFocus

Copia `.env.example` como `.env`:

```bash
cp .env.example .env
```

Edita `.env`:

```env
VITE_GOOGLE_CLIENT_ID=TU_CLIENT_ID.apps.googleusercontent.com
VITE_FORMS_URL=
```

Reinicia Vite después de modificar `.env`.

## 3. Permisos que solicita ClassFocus

La aplicación solicita únicamente permisos de lectura para la sincronización actual:

- `classroom.courses.readonly`
- `classroom.rosters.readonly`
- `classroom.profile.emails`
- `classroom.coursework.students.readonly`

Con esto ClassFocus puede leer cursos activos, listas de alumnos, docentes, correos permitidos y actividades. No publica ni modifica tareas de Classroom.

## 4. Flujo dentro de ClassFocus

1. Inicia sesión como **Super Admin**.
2. En la tarjeta **Google Classroom**, pulsa **Conectar Google Classroom**.
3. Autoriza la cuenta de Google.
4. ClassFocus muestra los cursos activos disponibles para esa cuenta.
5. Pulsa **Importar a ClassFocus** en un curso.
6. La aplicación:
   - crea o actualiza la materia;
   - vincula al docente;
   - crea o reutiliza los alumnos por correo;
   - asigna la materia a esos alumnos;
   - guarda una referencia a las actividades del curso.

## Nota de producción

Esta versión usa el modelo OAuth de navegador de Google Identity Services y mantiene el access token solamente durante la sesión del navegador. Para una instalación universitaria completa conviene mover la autorización y la sincronización periódica al backend Laravel, guardar tokens de forma segura en el servidor y utilizar MySQL como fuente persistente.
