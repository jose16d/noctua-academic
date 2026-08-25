@echo off
chcp 65001 >nul
title Cerrar Noctua Academic 🦉
echo Cerrando instancias de Noctua Academic...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo.
echo ✅ Noctua se ha cerrado correctamente.
timeout /t 2 >nul
