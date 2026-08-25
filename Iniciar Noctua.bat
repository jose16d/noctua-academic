@echo off
chcp 65001 >nul
title Noctua Academic 🦉 - Servidor Portable
cd /d "%~dp0"

echo ============================================================================
echo  🦉 NOCTUA ACADEMIC - APLICACIÓN PORTABLE PARA WINDOWS
echo ============================================================================
echo.
echo  Iniciando base de datos SQLite y servidor local...
echo.

:: Iniciar servidor en segundo plano
start /B node server.js

:: Esperar inicio
timeout /t 2 /nobreak >nul

:: Abrir en modo aplicación nativa
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:3000 --window-size=1280,820
) else if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:3000 --window-size=1280,820
) else if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app=http://localhost:3000 --window-size=1280,820
) else (
    start http://localhost:3000
)

echo.
echo  ✅ Noctua se está ejecutando correctamente en http://localhost:3000
echo.
echo  Puedes minimizar esta ventana. Para cerrar la aplicación completamente,
echo  presiona Ctrl+C o ejecuta 'Cerrar Noctua.bat'.
echo.
pause
