@echo off
title SCUM Server Automation
cd /d "%~dp0"

:: ── 1. Require administrator privileges ──────────────────────────────────────
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs -WorkingDirectory '%~dp0'"
    exit /b
)

:: ── 2. Ensure Node.js is available ───────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% equ 0 goto :node_ok

if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    goto :node_ok
)

echo.
echo  [Setup] Node.js not found. Installing automatically, please wait...
echo.

where winget >nul 2>&1
if %ERRORLEVEL% equ 0 (
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -e --silent
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "PATH=%ProgramFiles%\nodejs;%PATH%"
        goto :node_ok
    )
)

echo  [Setup] Downloading Node.js installer...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-node.ps1"

if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    goto :node_ok
)
if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
    set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
    goto :node_ok
)

echo.
echo  [ERROR] Could not install Node.js. Install manually from: https://nodejs.org
echo.
pause
exit /b 1

:node_ok

:: ── 3. Install npm dependencies on first run ─────────────────────────────────
:: Use the compiled better-sqlite3 binary as the "fully installed" marker — a
:: bare node_modules folder can exist from a previously failed/partial install.
if not exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" (
    echo  [Setup] Installing dependencies, please wait...
    call npm install --no-audit --no-fund --loglevel=error
    if errorlevel 1 (
        echo.
        echo  [ERROR] npm install failed. See the messages above.
        echo  [ERROR] If it mentions Python / node-gyp, delete the "node_modules" folder
        echo          and this "package-lock.json", then run Start.bat again.
        echo.
        pause
        exit /b 1
    )
    echo  [Setup] Done.
    echo.
)

:: ── 4. Open browser once the server is ready ─────────────────────────────────
start "" /b cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:8080"

:: ── 5. Start the app ─────────────────────────────────────────────────────────
node src\index.js

echo.
echo  Server stopped. Press any key to close.
pause >nul
