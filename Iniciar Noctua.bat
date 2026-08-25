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

:: 1. Cerrar cualquier instancia previa residual
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" >nul 2>&1

:: 2. Iniciar servidor en segundo plano
start /B node server.js

:: 3. Esperar inicio
ping -n 3 127.0.0.1 >nul

:: 4. Detectar navegador y abrir en modo ventana independiente
set "EDGE_EXE="
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

set "CHROME_EXE="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

echo  ✅ Noctua se está ejecutando correctamente en http://localhost:3000
echo.
echo  La aplicación se cerrará automáticamente cuando cierres la ventana.
echo  Si deseas forzar el cierre ahora, presiona cualquier tecla.
echo.

if defined EDGE_EXE (
    "%EDGE_EXE%" --app=http://localhost:3000 --window-size=1280,820
) else if defined CHROME_EXE (
    "%CHROME_EXE%" --app=http://localhost:3000 --window-size=1280,820
) else (
    start http://localhost:3000
    pause
)

:: 5. Al cerrar la ventana, detener el servidor Node y liberar archivos
echo Cerrando servidor local y liberando base de datos...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
