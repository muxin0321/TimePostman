@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies for the first run...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm run start:all
pause
