@echo off
title Spark Keeper - Setup
cd /d "%~dp0"
chcp 65001 >nul

echo ==========================================================
echo   抖音续火花 · 一键安装运行环境
echo   只需要做一次，装完不用再管
echo ==========================================================
echo.

rem ---- 1. 找 Node.js ----
set "NODE="
for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do if exist "%%d\node.exe" if not defined NODE set "NODE=%%d\node.exe"
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if defined NODE goto HAVE_NODE
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if defined NODE goto HAVE_NODE

echo [1/2] 没有检测到 Node.js
echo.
echo   Node.js 是脚本的运行环境，必须装一次。
echo   接下来会打开官网，请这样操作：
echo     1. 点绿色的「Download Node.js (LTS)」按钮
echo     2. 下载 .msi 安装包，双击一路「下一步」装完
echo     3. 装完后【关掉本窗口】，重新双击本文件
echo.
echo   按任意键打开官网...
pause >nul
start "" "https://nodejs.org/zh-cn/download"
echo.
echo   装好后请重新运行「一键-安装环境.bat」。
pause
exit /b 1

:HAVE_NODE
echo [1/2] Node.js 已就绪  %NODE%
echo.
echo [2/2] 正在安装依赖 playwright-core（几十秒，请稍等）...
echo.
call npm install --no-save --no-audit --no-fund playwright-core
if %errorlevel% equ 0 goto OK

echo.
echo   默认源太慢，自动切换国内镜像重试...
echo.
call npm install --no-save --no-audit --no-fund --registry=https://registry.npmmirror.com playwright-core
if %errorlevel% equ 0 goto OK

echo.
echo   [X] 安装失败。常见原因：
echo       - 网络不通（试试关掉代理或用手机热点）
echo       - npm 权限问题（右键本文件 → 以管理员身份运行）
echo.
pause
exit /b 1

:OK
echo.
echo ==========================================================
echo   环境装好了！接下来：
echo     1. 双击「一键-登录抖音.bat」用手机扫码登录
echo     2. 双击「一键-检查环境.bat」确认能识别到火花
echo     3. 双击「一键-续火花.bat」开始发送
echo ==========================================================
echo.
echo   Edge 浏览器用的是你系统自带的，不需要另外装。
echo.
pause
