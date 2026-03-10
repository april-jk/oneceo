@echo off
echo Starting OneCEO.ai Development Servers...

start "OneCEO API" cmd /k "cd /d %~dp0apps\api && pnpm dev"
start "OneCEO Web" cmd /k "cd /d %~dp0apps\web && pnpm dev"

echo Both servers are starting...
echo Backend: http://localhost:4000
echo Frontend: http://localhost:3000
pause
