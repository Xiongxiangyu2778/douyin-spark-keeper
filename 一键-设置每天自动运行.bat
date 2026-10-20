@echo off
title Spark Keeper - Schedule
cd /d "%~dp0"
chcp 65001 >nul

rem ---- 1. 找 Node.js（先看标准安装位置）----
set "NODE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if defined NODE goto HAVE_NODE
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if defined NODE goto HAVE_NODE
for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do if exist "%%d\node.exe" if not defined NODE set "NODE=%%d\node.exe"
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if defined NODE goto HAVE_NODE

:NO_NODE
echo.
echo   [X] 没有找到 Node.js —— 脚本要靠它运行。
echo.
echo   请先双击「一键-安装环境.bat」装好环境，再回来运行本文件。
echo.
pause
exit /b 1

:HAVE_NODE
rem ---- 2. 依赖从脚本自己的目录找 ----
set "NODE_PATH=%~dp0node_modules"
if exist "%~dp0node_modules\playwright-core\package.json" goto HAVE_DEP

:NO_DEP
echo.
echo   [X] 缺少运行依赖 playwright-core。
echo.
echo   请先双击「一键-安装环境.bat」自动安装（几十秒），再回来运行本文件。
echo.
pause
exit /b 1

:HAVE_DEP
echo   Node : %NODE%
echo.
echo 正在注册每天 12:00 的自动运行任务...
echo.
schtasks /Create /TN "DouyinSpark" /TR "\"%~dp0run-daily.bat\"" /SC DAILY /ST 12:00 /F & powershell -NoProfile -Command "$t=Get-ScheduledTask -TaskName DouyinSpark; $t.Settings.StartWhenAvailable=$true; $t.Settings.DisallowStartIfOnBatteries=$false; $t.Settings.StopIfGoingOnBatteries=$false; Set-ScheduledTask -InputObject $t | Out-Null"
echo.
echo 已完成。到点若电脑在睡眠/关机，开机后会自动补跑一次（不会错过）。
echo 电池供电也能运行。想换时间，用记事本改本文件里的 12:00 后重新双击本文件。
echo.
pause
