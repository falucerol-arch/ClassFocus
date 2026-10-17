# PostgreSQL en ClassFocus v4

## Opción recomendada: Docker

1. Copia `.env.example` a `.env`.
2. Inicia PostgreSQL:

```bash
docker compose up -d postgres
```

3. Inicia ClassFocus:

```bash
./start.sh
```

Servicios:
- React/Vite: http://localhost:5173
- API: http://localhost:8788/api
- PostgreSQL: localhost:5432
- WebRTC signaling: ws://localhost:8787

Credenciales de desarrollo de PostgreSQL:
- Base: `classfocus`
- Usuario: `classfocus`
- Contraseña: `classfocus123`

> Son credenciales exclusivas para desarrollo local. Cámbialas antes de desplegar.

## PostgreSQL instalado directamente

Crea una base y configura en `.env`:

```env
DATABASE_URL=postgresql://USUARIO:CONTRASENA@localhost:5432/classfocus
DATABASE_SSL=false
API_PORT=8788
VITE_API_URL=http://localhost:8788/api
```

La API crea automáticamente las tablas necesarias al arrancar.

## Comprobar conexión

Abre:

```text
http://localhost:8788/api/health
```

Debe responder `ok: true` y `database: classfocus`.

## Si no tienes Docker en Ubuntu

El proyecto incluye un instalador para desarrollo:

```bash
chmod +x setup-postgres-ubuntu.sh
./setup-postgres-ubuntu.sh
```

Después ejecuta:

```bash
./start.sh
```
