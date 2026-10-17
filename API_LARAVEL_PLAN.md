# Evolución futura: Laravel + PostgreSQL

ClassFocus v4 ya usa PostgreSQL mediante una API Node/Express incluida para que el proyecto funcione ahora.

Si el proyecto requiere Laravel como backend institucional, PostgreSQL puede mantenerse sin cambiar el modelo de datos:

```text
React/Vite -> Laravel API -> PostgreSQL
```

Laravel soporta PostgreSQL de forma nativa. Las tablas actuales (`users`, `subjects`, `enrollments`, `exams`, `incidents`, `attention_samples`) pueden convertirse a migraciones de Laravel y reemplazar gradualmente la API Express.
