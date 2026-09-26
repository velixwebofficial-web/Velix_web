<#
============================================================================
 VELIX - one-step interactive setup.

 Run this ONCE to fully configure and start the server. No Administrator
 rights are needed for this script (only INSTALL-VELIX-SERVICE.ps1, which
 sets up the firewall rule + autostart, needs that - see README.md).

 What it does, in order:
   1. Verifies Node.js/npm are installed and the Node version supports
      node:sqlite.
   2. Runs "npm install" if node_modules is missing.
   3. Creates data\, uploads\{projects,news,media,general}\, backups\,
      logs\ if they don't already exist.
   4. If .env.local isn't already fully configured, asks you (right here,
      in this window) for your admin email, a new admin password, and your
      Anthropic API key. The password and API key are entered masked and
      are NEVER displayed or written anywhere in plain text - the password
      is hashed with bcrypt and only the hash is saved; a random session
      secret is generated for you.
   5. Writes ONLY to C:\VELIX\.env.local (already excluded from git).
   6. Starts the server.

 Safe to re-run: if .env.local is already configured, it asks whether you
 want to reconfigure or just start the server with what's already there.
============================================================================
#>

$ErrorActionPreference = 'Stop'
$ProjectDir = $PSScriptRoot
Set-Location $ProjectDir

function Write-Step($msg) { Write-Host ""; Write-Host "== $msg ==" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "   $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host ""; Write-Host "ERROR: $msg" -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

function ConvertFrom-SecureStringPlain($secure) {
    if (-not $secure -or $secure.Length -eq 0) { return '' }
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

Write-Host ""
Write-Host "VELIX Web Solutions - setup" -ForegroundColor Cyan
Write-Host "Project directory: $ProjectDir"

# ---------------------------------------------------------------------
# 1. Node / npm / node:sqlite version check
# ---------------------------------------------------------------------
Write-Step "Checking Node.js"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Fail "Node.js was not found on PATH. Install Node.js 22.5 or newer from https://nodejs.org, restart this PC's Command Prompt/PowerShell, then run this script again."
}
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    Fail "npm was not found on PATH (it normally installs together with Node.js). Reinstall Node.js from https://nodejs.org."
}

$nodeVersionRaw = (node --version).TrimStart('v')
$npmVersionRaw = npm --version
$parts = $nodeVersionRaw.Split('.')
$nodeMajor = [int]$parts[0]; $nodeMinor = [int]$parts[1]
$supportsSqlite = ($nodeMajor -gt 22) -or ($nodeMajor -eq 22 -and $nodeMinor -ge 5)
if (-not $supportsSqlite) {
    Fail "Node.js v$nodeVersionRaw is installed, but this project needs Node 22.5+ for its built-in database support (node:sqlite). Install a newer Node.js from https://nodejs.org and run this script again."
}
Write-Ok "Node.js v$nodeVersionRaw (supports node:sqlite), npm v$npmVersionRaw"

# ---------------------------------------------------------------------
# 2. npm install
# ---------------------------------------------------------------------
Write-Step "Checking dependencies"
if (-not (Test-Path (Join-Path $ProjectDir 'node_modules'))) {
    Write-Warn2 "node_modules not found - running npm install (this can take a minute)..."
    npm install
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed - see the errors above." }
    Write-Ok "Dependencies installed."
} else {
    Write-Ok "node_modules already present."
}

# ---------------------------------------------------------------------
# 3. Required directories
# ---------------------------------------------------------------------
Write-Step "Creating required directories"
$dirs = @('data', 'uploads\projects', 'uploads\news', 'uploads\media', 'uploads\general', 'backups', 'logs')
foreach ($d in $dirs) {
    $full = Join-Path $ProjectDir $d
    if (-not (Test-Path $full)) { New-Item -ItemType Directory -Path $full -Force | Out-Null }
}
Write-Ok "data\, uploads\{projects,news,media,general}\, backups\, logs\ ready."

# ---------------------------------------------------------------------
# 4. .env.local - check whether it's already configured
# ---------------------------------------------------------------------
$envPath = Join-Path $ProjectDir '.env.local'
function Read-EnvValue($path, $key) {
    if (-not (Test-Path $path)) { return '' }
    $line = Get-Content $path | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -Last 1
    if (-not $line) { return '' }
    return ($line -split '=', 2)[1].Trim()
}

$alreadyConfigured = $false
if (Test-Path $envPath) {
    $existingEmail  = Read-EnvValue $envPath 'ADMIN_EMAIL'
    $existingHash   = Read-EnvValue $envPath 'ADMIN_PASSWORD_HASH'
    $existingSecret = Read-EnvValue $envPath 'ADMIN_SESSION_SECRET'
    if ($existingEmail -and $existingHash -and $existingSecret) { $alreadyConfigured = $true }
}

$doConfigure = $true
if ($alreadyConfigured) {
    Write-Step "Existing configuration found"
    Write-Host "   .env.local is already fully configured (admin email/password/session secret present)."
    $answer = Read-Host "   Reconfigure admin login and/or AI key now? (y/N)"
    $doConfigure = ($answer -eq 'y' -or $answer -eq 'Y')
}

if ($doConfigure) {
    Write-Step "Admin account setup"
    Write-Host "   Nothing you type here is ever sent anywhere except into"
    Write-Host "   C:\VELIX\.env.local on this PC."
    Write-Host ""

    $adminEmail = ''
    while (-not $adminEmail -or $adminEmail -notmatch '@') {
        $adminEmail = Read-Host "   Admin login email"
    }

    $securePwd1 = $null
    while ($true) {
        $securePwd1 = Read-Host "   New admin password (input hidden)" -AsSecureString
        $plain1 = ConvertFrom-SecureStringPlain $securePwd1
        if ($plain1.Length -lt 8) {
            Write-Warn2 "Password must be at least 8 characters."
            continue
        }
        $securePwd2 = Read-Host "   Confirm password (input hidden)" -AsSecureString
        $plain2 = ConvertFrom-SecureStringPlain $securePwd2
        if ($plain1 -ne $plain2) {
            Write-Warn2 "Passwords didn't match - try again."
            $plain2 = $null
            continue
        }
        break
    }

    Write-Host ""
    Write-Host "   Anthropic API key powers the AI chat widget (get one at" -ForegroundColor DarkGray
    Write-Host "   https://console.anthropic.com). Leave blank to skip for now -" -ForegroundColor DarkGray
    Write-Host "   the rest of the site works fine without it; AI chat stays" -ForegroundColor DarkGray
    Write-Host "   disabled until you set it later." -ForegroundColor DarkGray
    $secureKey = Read-Host "   ANTHROPIC_API_KEY (input hidden, optional)" -AsSecureString
    $anthropicKey = ConvertFrom-SecureStringPlain $secureKey

    # --- Hash the password with the project's own bcrypt dependency,
    #     via stdin (never as a command-line argument, so it never shows
    #     up in a process list) -----------------------------------------
    Write-Step "Generating credentials"
    $tmpDir = Join-Path $ProjectDir '.setup-tmp'
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
    $hashScript = Join-Path $tmpDir 'hash-stdin.js'
    @'
process.stdin.setEncoding('utf8');
let data = '';
process.stdin.on('data', c => data += c);
process.stdin.on('end', () => {
  const bcrypt = require('bcryptjs');
  const pwd = data.replace(/\r?\n$/, '');
  process.stdout.write(bcrypt.hashSync(pwd, 10));
});
'@ | Set-Content -Path $hashScript -Encoding UTF8

    $passwordHash = $plain1 | node $hashScript
    if (-not $passwordHash -or $passwordHash -notmatch '^\$2[aby]\$') {
        Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
        Fail "Password hashing failed unexpectedly."
    }

    $sessionSecret = node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Variable plain1, plain2, securePwd1, securePwd2 -ErrorAction SilentlyContinue
    [System.GC]::Collect()
    Write-Ok "Password hashed (bcrypt) and session secret generated. Nothing was printed above."

    # --- Write .env.local -------------------------------------------------
    $envContent = @"
# ==============================================================================
# VELIX WEB SOLUTIONS - PRODUCTION ENVIRONMENT (C:\VELIX)
# Generated by SETUP-VELIX.ps1. Never commit this file or share it.
# ==============================================================================

PORT=3000
HOST=0.0.0.0

ADMIN_EMAIL=$adminEmail
ADMIN_PASSWORD_HASH=$passwordHash
ADMIN_SESSION_SECRET=$sessionSecret

ANTHROPIC_API_KEY=$anthropicKey
"@
    Set-Content -Path $envPath -Value $envContent -Encoding ASCII -NoNewline
    Write-Ok "Configuration written to .env.local (values are not displayed here or ever sent anywhere)."

    if (-not $anthropicKey) {
        Write-Warn2 "ANTHROPIC_API_KEY was left blank - AI chat will show a 'not configured'"
        Write-Warn2 "message until you add it. Edit C:\VELIX\.env.local any time, then restart"
        Write-Warn2 "the server, to enable it. Everything else works normally right now."
    }
} else {
    Write-Ok "Keeping existing .env.local unchanged."
}

# ---------------------------------------------------------------------
# 5. .gitignore already covers .env.local - verify, don't modify.
# ---------------------------------------------------------------------
$gitignorePath = Join-Path $ProjectDir '.gitignore'
if (Test-Path $gitignorePath) {
    $covered = Select-String -Path $gitignorePath -Pattern '^\.env\.\*$|^\.env\.local$' -Quiet
    if ($covered) { Write-Ok ".env.local is already excluded from git (.gitignore)." }
}

# ---------------------------------------------------------------------
# 6. Start the server - refuse to start a second copy if one is already
#    listening on this port.
# ---------------------------------------------------------------------
Write-Step "Starting the server"
$configuredPort = [int](Read-EnvValue $envPath 'PORT')
if (-not $configuredPort) { $configuredPort = 3000 }

$existingListener = Get-NetTCPConnection -LocalPort $configuredPort -State Listen -ErrorAction SilentlyContinue
if ($existingListener) {
    Write-Warn2 "Something is already listening on port $configuredPort - the VELIX server"
    Write-Warn2 "may already be running (e.g. started earlier, or by the autostart task)."
    Write-Warn2 "Open http://localhost:$configuredPort/ in a browser to check before starting another copy."
    Read-Host "Press Enter to close"
    exit 0
}

Write-Host ""
node server.js

Write-Host ""
Write-Host "Server stopped."
Read-Host "Press Enter to close"
