@echo off
chcp 65001 >nul
setlocal
if "%~1"=="" (
  echo Usage: create_views.bat path\to\cbdb.sqlite3
  exit /b 1
)
set "SCRIPT=%~dp0create_views.sh"
where bash >nul 2>&1
if errorlevel 1 (
  echo Error: bash not found. Install Git Bash or WSL, then retry.
  exit /b 1
)
bash "%SCRIPT%" "%~1"
