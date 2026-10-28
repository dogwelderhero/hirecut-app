@echo off
rem Stop hirecute started with up.cmd. Runs inside it are discarded.
docker rm -f hirecute-local >nul 2>&1
if errorlevel 1 (echo It was not running.) else (echo Stopped.)
pause
