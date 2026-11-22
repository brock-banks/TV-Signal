@echo off
setlocal
cd /d "%~dp0"
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
 echo Install Node.js 24 LTS or newer, then run this file again.
 exit /b 1
)
if exist package-lock.json (call npm.cmd ci) else (call npm.cmd install)
if errorlevel 1 exit /b 1
if not exist .env copy .env.example .env >nul
call npm.cmd run build
if errorlevel 1 exit /b 1
call npm.cmd run fixtures
if errorlevel 1 exit /b 1
echo Installation complete. Run start.bat, then visit http://localhost:3000/admin/
pause
