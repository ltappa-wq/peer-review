@echo off
REM Starts the peer review app and opens the admin page in your browser.
cd /d "%~dp0"
start "" http://localhost:3000
echo.
echo Peer Review is running. Keep this window open while you use the app.
echo When you are done, close this window to shut it down.
echo.
node server.js
pause
