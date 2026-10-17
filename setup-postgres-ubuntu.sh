#!/usr/bin/env bash
set -e

DB_NAME="classfocus"
DB_USER="classfocus"
DB_PASSWORD="classfocus123"

echo "Instalando PostgreSQL para ClassFocus..."
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql

echo "Creando usuario y base de datos de desarrollo..."
sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

if [ ! -f .env ]; then
  cp .env.example .env
fi

echo "PostgreSQL listo. Ahora ejecuta: ./start.sh"
echo "Base: ${DB_NAME} | Usuario: ${DB_USER} | Puerto: 5432"
