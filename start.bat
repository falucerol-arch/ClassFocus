@echo off
cd /d %~dp0

if not exist .env copy .env.example .env >nul

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)

echo Si tienes Docker Desktop, iniciando PostgreSQL...
docker compose up -d postgres 2>nul

echo Iniciando API PostgreSQL...
start "ClassFocus API" cmd /k npm run api

echo Iniciando servidor de camaras...
start "ClassFocus WebRTC" cmd /k npm run signal

echo Iniciando ClassFocus...
call npm run dev
