@echo off
REM One-time setup: installs the app's dependencies.
cd /d "%~dp0"
echo Installing app dependencies. This only needs to run once.
echo.
call npm install
echo.
if %errorlevel% neq 0 (
  echo.
  echo Install failed. Make sure Node.js is installed from https://nodejs.org
  pause
  exit /b 1
)
echo.
echo Install complete. You can now double-click "Start app.bat" to run the app.
pause
