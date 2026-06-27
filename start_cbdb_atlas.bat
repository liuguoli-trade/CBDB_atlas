@echo off

chcp 65001 >nul

cd /d "%~dp0"

REM One-click launcher: start service if not running; open browser if already running

python -u run.py

if errorlevel 1 pause
