@echo off
rem GUARDIANS demo: static data and a single Vite frontend.
cd /d "%~dp0"
if not exist "node_modules" call npm install
start "GUARDIANS demo" /D "%~dp0" cmd /k "npm run dev"
timeout /t 3 >nul
start "" http://localhost:5199/
echo.
echo   GUARDIANS demo  http://localhost:5199
echo   20 static slicks; no backend or planner process
echo.
