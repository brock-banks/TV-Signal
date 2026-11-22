@echo off
setlocal
cd /d "%~dp0"
node -e "for(const p of ['express','multer','sharp','ffmpeg-static','ffprobe-static','zod'])require.resolve(p)" >nul 2>&1
if errorlevel 1 (
 echo Application dependencies are missing. Restoring them now...
 call npm.cmd ci
 if errorlevel 1 (
  echo Dependency installation failed. Check your internet connection and run install.bat.
  pause
  exit /b 1
 )
)
if not exist dist\server.js (
 echo Run install.bat first.
 exit /b 1
)
node --env-file-if-exists=.env dist/server.js
if errorlevel 1 pause
