@echo off
:: Check for Administrator privileges
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [INFO] Running with Administrator privileges...
) else (
    echo [INFO] Requesting Administrator privileges...
    powershell -Command "Start-Process -FilePath '%0' -Verb RunAs"
    exit /b
)

:: Get the directory where this script is located
cd /d "%~dp0"

echo ==================================================
echo       Git Auto-Sync Service Setup Autopilot       
echo ==================================================
echo.

:: Run the PowerShell installer script
echo [1/3] Running installation script...
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
if %errorLevel% neq 0 (
    echo [ERROR] Installation failed! Please check Node.js and Git installation.
    pause
    exit /b
)

:: Start the background daemon using launcher.vbs
echo.
echo [2/3] Starting the background daemon...
wscript.exe launcher.vbs
echo [SUCCESS] Daemon started silently in the background.

:: Run verification script to confirm
echo.
echo [3/3] Verifying service status...
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify_sync.ps1
echo.

:: Open Dashboard automatically in the default browser
echo [INFO] Opening Web Dashboard...
start http://localhost:3000

echo ==================================================
echo     Autopilot Setup Completed Successfully!        
echo ==================================================
echo.
pause
