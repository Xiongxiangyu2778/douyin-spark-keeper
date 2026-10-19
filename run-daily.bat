@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "NODE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if defined NODE goto OK
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if defined NODE goto OK
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if defined NODE goto OK
exit /b 1

:OK
set "NODE_PATH=%~dp0node_modules"
"%NODE%" "%~dp0spark.js" --dump %*
