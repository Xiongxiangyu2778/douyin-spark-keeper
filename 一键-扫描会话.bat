@echo off
title Douyin Spark
cd /d "%~dp0"
chcp 65001 >nul
set "NODE=C:\Users\ASUS\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE%" set "NODE=node"
set "NODE_PATH=C:\Users\ASUS\.workbuddy\binaries\node\workspace\node_modules"

echo [1/1] Scanning conversations, this does NOT send anything...
"%NODE%" "%~dp0spark.js" --scan %*
echo.
pause
