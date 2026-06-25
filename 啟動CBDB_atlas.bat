@echo off

chcp 65001 >nul

cd /d "%~dp0"



REM 一鍵入口：服務未運行則自動啟動；已在運行則只打開瀏覽器

python -u run.py

if errorlevel 1 pause

