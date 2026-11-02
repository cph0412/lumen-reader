@echo off
chcp 65001 >nul
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
echo [1/4] 运行单元测试...
call npm test
if errorlevel 1 goto :fail
echo [2/4] 生成产品截图...
call npm run screenshots
if errorlevel 1 goto :fail
echo [3/4] 打包 Windows 便携版...
call npm run dist
if errorlevel 1 goto :fail
echo [4/4] 完成：release\Lumen-1.0.0-portable.exe
pause
exit /b 0
:fail
echo.
echo [Lumen] 构建失败，请检查上方错误信息。
pause
exit /b 1
