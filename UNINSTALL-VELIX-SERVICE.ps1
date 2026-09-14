<#
============================================================================
 VELIX - removes the autostart Scheduled Task and firewall rule created by
 INSTALL-VELIX-SERVICE.ps1. Run as Administrator (it will self-elevate).

 Does NOT delete the project, the database, uploads, or backups - only the
 Windows-level autostart/firewall configuration.
============================================================================
#>

$ErrorActionPreference = 'Stop'
$FirewallName = 'VELIX Web Solutions (port 3000)'
$TaskName     = 'VELIX Server'

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Re-launching as Administrator (you'll see a UAC prompt)..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"") -Verb RunAs
    exit
}

Write-Host ""
Write-Host "Removing VELIX autostart + firewall configuration..." -ForegroundColor Cyan

$removedTask = $false
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    $removedTask = $true
}
Write-Host ("  Scheduled Task '{0}': {1}" -f $TaskName, $(if ($removedTask) { 'removed' } else { 'was not present' }))

$removedRule = $false
if (Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -DisplayName $FirewallName
    $removedRule = $true
}
Write-Host ("  Firewall rule '{0}': {1}" -f $FirewallName, $(if ($removedRule) { 'removed' } else { 'was not present' }))

Write-Host ""
Write-Host "The project, database, uploads, and backups in this folder were not touched." -ForegroundColor Green
Write-Host "The server will no longer start automatically. You can still start it any time"
Write-Host "with START-VELIX-SERVER.bat."
Write-Host ""
Read-Host "Press Enter to close"
