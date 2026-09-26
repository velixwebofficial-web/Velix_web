@echo off
REM Double-click this to run INSTALL-VELIX-SERVICE.ps1 reliably (it will
REM still prompt you for one Administrator confirmation - that part is
REM expected and required to create the firewall rule + autostart task).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL-VELIX-SERVICE.ps1"
