#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js no está instalado. Instala Node.js 18 o superior."
  exit 1
fi

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "Se creó .env usando la configuración local de desarrollo."
fi

if [ ! -d "node_modules" ] || [ ! -d "node_modules/vite" ] || [ ! -d "node_modules/pg" ] || [ ! -d "node_modules/express" ]; then
  echo "Instalando dependencias..."
  npm install --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "Iniciando PostgreSQL con Docker..."
  docker compose up -d postgres || echo "No se pudo iniciar Docker PostgreSQL; se intentará usar DATABASE_URL de .env."
else
  echo "Docker Compose no disponible. Se usará PostgreSQL configurado en DATABASE_URL."
fi

echo "Esperando brevemente a PostgreSQL..."
sleep 3

echo "Iniciando API PostgreSQL en puerto 8788..."
npm run api &
API_PID=$!

echo "Iniciando señalización de cámaras en puerto 8787..."
npm run signal &
SIGNAL_PID=$!

cleanup() {
  kill "$API_PID" "$SIGNAL_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Iniciando ClassFocus..."
echo "Frontend: http://localhost:5173"
echo "API:      http://localhost:8788/api/health"
echo "WebRTC:   ws://localhost:8787"
npm run dev
