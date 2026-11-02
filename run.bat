@echo off
chcp 65001 >nul
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if not exist "node_modules\electron" (
  echo [Lumen] 首次运行，正在安装 Electron（约 1-2 分钟）...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :fail
)
call npx electron . %*
if errorlevel 1 goto :fail
exit /b 0
:fail
echo.
echo [Lumen] 启动失败，请检查上方错误信息。
pause
exit /b 1
