@echo off
REM ============================================================================
REM VELIX - Windows server launcher (for normal day-to-day starts).
REM
REM First time setting this up? Run SETUP-VELIX.ps1 instead - it configures
REM your admin login and AI key interactively and starts the server for you.
REM This file is for starting the server again afterwards (e.g. if you closed
REM its window, or aren't using the autostart task from
REM INSTALL-VELIX-SERVICE.ps1).
REM
REM Assumes: Node.js 22.5+ on PATH, `npm install` already run once, and
REM .env.local already configured (SETUP-VELIX.ps1 does both).
REM
REM The server keeps running in this window. Closing the window stops it.
REM ============================================================================

cd /d "%~dp0"

echo.
echo  VELIX Web Solutions - starting local server...
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo  Node.js was not found on PATH. Install Node.js 22.5+ from
    echo  https://nodejs.org, then run this file again.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  node_modules not found - running "npm install" first...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo  npm install failed. See the errors above.
        pause
        exit /b 1
    )
)

if not exist ".env.local" (
    echo  .env.local not found. Run SETUP-VELIX.ps1 first - it configures your
    echo  admin login and AI key interactively ^(right-click it, "Run with
    echo  PowerShell"^), then starts the server for you.
    echo.
    if exist ".env.example" (
        echo  Starting anyway with a blank config copied from .env.example:
        echo  the public website will work, but admin login and AI chat will
        echo  not until you run SETUP-VELIX.ps1 or edit .env.local by hand.
        copy /y ".env.example" ".env.local" >nul
    )
    echo.
)

REM Refuse to start a second copy if something is already listening on the
REM configured port (default 3000) - e.g. the autostart task already
REM started it, or it's running in another window.
set "VELIX_PORT=3000"
for /f "tokens=2 delims==" %%P in ('findstr /r "^PORT=" ".env.local" 2^>nul') do set "VELIX_PORT=%%P"
netstat -ano | findstr /r ":%VELIX_PORT% .*LISTENING" >nul
if not errorlevel 1 (
    echo  A server already appears to be running on port %VELIX_PORT%.
    echo  Open http://localhost:%VELIX_PORT%/ in a browser to check before
    echo  starting another copy - running two at once is not supported.
    pause
    exit /b 0
)

node server.js

echo.
echo  Server stopped.
pause
