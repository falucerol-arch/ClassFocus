# Base de datos de ClassFocus

ClassFocus v4 utiliza PostgreSQL mediante la API Node/Express incluida en `server/apiServer.js`.
Las tablas se crean automáticamente al iniciar la API y los usuarios demo se insertan si no existen.

Tablas principales:
- `users`
- `subjects`
- `enrollments`
- `exams`
- `incidents`
- `attention_samples`

Para desarrollo, la forma más rápida es ejecutar `docker compose up -d postgres`.
