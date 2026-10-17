# ClassFocus v4 · USPG Edition

ClassFocus es un prototipo académico para supervisión de clases y evaluaciones virtuales. Incluye React + Vite, MediaPipe, Google Classroom, WebRTC y **PostgreSQL**.

## Arquitectura

```text
React / Vite (5173)
      |
      +--> ClassFocus API / Express (8788) --> PostgreSQL (5432)
      |
      +--> WebRTC signaling (8787) --> cámaras en vivo
      |
      +--> Google Classroom API (opcional)
```

## Qué se guarda en PostgreSQL

- Usuarios y roles.
- Materias.
- Relación alumno · maestro · materia.
- Evaluaciones y duración.
- Incidencias de examen.
- Muestras de atención.
- Datos vinculados de Google Classroom.

## Inicio rápido en Ubuntu

```bash
chmod +x start.sh
./start.sh
```

Si tienes Docker + Docker Compose, el script intenta levantar PostgreSQL automáticamente.

Si prefieres hacerlo paso a paso:

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run api
```

En otra terminal:

```bash
npm run signal
```

Y en otra:

```bash
npm run dev
```

Abre `http://localhost:5173`.

## Accesos demo

- Alumno: `student@classfocus.com`
- Maestro: `teacher@classfocus.com`
- Super Admin: `admin@classfocus.com`
- Contraseña: `123456`

## Estado de PostgreSQL

En el encabezado aparece una insignia:

- **PostgreSQL**: la API y la base están conectadas.
- **Modo local**: la base no está disponible y el prototipo continúa con caché del navegador.

También puedes revisar `http://localhost:8788/api/health`.

Consulta `POSTGRES_SETUP.md`, `GOOGLE_CLASSROOM_SETUP.md` y `LIVE_CAMERA_SETUP.md` para más detalles.



# 📥 Clonar el repositorio

Para descargar el proyecto utilizando Git:

```bash
git clone https://github.com/falucerol-arch/ClassFocus.git
```

Entrar a la carpeta del proyecto:

```bash
cd ClassFocus
```

Instalar las dependencias:

```bash
npm install
```

Crear el archivo de variables de entorno:

```bash
cp .env.example .env
```

## 🗄️ Configurar PostgreSQL en Ubuntu

Dar permisos al instalador:

```bash
chmod +x setup-postgres-ubuntu.sh
```

Ejecutar la instalación y configuración:

```bash
./setup-postgres-ubuntu.sh
```

## 🚀 Iniciar ClassFocus

Dar permisos al archivo de inicio:

```bash
chmod +x start.sh
```

Ejecutar:

```bash
./start.sh
```

Después abrir en el navegador:

```text
http://localhost:5173
```

## 🔄 Descargar futuras actualizaciones

Si ya tienes el proyecto clonado y quieres obtener los cambios más recientes:

```bash
git pull
```

---

# 📦 Descargar sin Git

También se puede descargar directamente desde GitHub:

```text
Code → Download ZIP
```

Después de descomprimir:

```bash
cd ClassFocus
```

Instalar dependencias:

```bash
npm install
```

Crear el archivo `.env`:

```bash
cp .env.example .env
```

Iniciar ClassFocus:

```bash
chmod +x start.sh
./start.sh
```
