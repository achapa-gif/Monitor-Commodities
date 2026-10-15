@echo off
rem Descarga los precios mas recientes y regenera el dashboard.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\actualizar.ps1"
if "%1"=="/silencioso" exit /b %errorlevel%
start "" "%~dp0dashboard\index.html"
