@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=C:\Users\ASUS\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE%" set "NODE=node"
set "NODE_PATH=C:\Users\ASUS\.workbuddy\binaries\node\workspace\node_modules"
"%NODE%" "%~dp0spark.js" --dump %*
