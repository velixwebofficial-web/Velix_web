@echo off
REM Double-click this to run SETUP-VELIX.ps1 reliably, even if this PC's
REM PowerShell execution policy would otherwise block .ps1 files. This does
REM not change any system-wide policy - it only bypasses it for this one run.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0SETUP-VELIX.ps1"
