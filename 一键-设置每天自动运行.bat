@echo off
title Douyin Spark
cd /d "%~dp0"
chcp 65001 >nul
set "NODE=C:\Users\ASUS\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE%" set "NODE=node"
set "NODE_PATH=C:\Users\ASUS\.workbuddy\binaries\node\workspace\node_modules"

echo [1/2] Creating scheduled task "DouyinSpark" at 21:30 every day...
schtasks /Create /TN "DouyinSpark" /TR "\"%~dp0run-daily.bat\"" /SC DAILY /ST 21:30 /F
echo [2/2] Done. Change 21:30 in this bat if needed. The script waits a RANDOM
echo 0-30 min after start, so it will not send at a fixed second.
echo.
pause
