@echo off
echo.
echo ================================================================
echo            SCUM Server Automation - Manager
echo ================================================================
echo  This will start the PowerShell automation script that manages
echo  your SCUM server automatically (restarts, backups, updates).
echo ================================================================
echo.

:: Check if running as administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] This script must be run as administrator.
    echo [INFO] Administrator privileges are required to control Windows services.
    echo.
    echo Relaunching with elevated privileges...
    powershell -Command "Start-Process '%~f0' -Verb runAs"
    exit /b
)

echo [INFO] Starting SCUM Server Automation with administrator privileges...
echo.

:: Change to script directory (where this batch file is located)
cd /d "%~dp0"

:: Run the PowerShell script with ExecutionPolicy Bypass
powershell.exe -ExecutionPolicy Bypass -File "SCUM-Server-Automation.ps1"

echo.
echo ================================================================
echo  SCUM Server Automation has stopped.
echo ================================================================
pause
