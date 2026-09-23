#requires -Version 5.1
<#
.SYNOPSIS
  Launch Tandem Browser on the gtx1660 Windows 10 host with Wingman/OpenClaw live.

.DESCRIPTION
  This is the production Electron path: Windows bare-metal, ANGLE D3D11, GTX 1660.
  OpenClaw stays in WSL. The signed webchat handshake reads the live Ubuntu
  openclaw.json via \\wsl$\ so Wingman does not use the stale Windows stub token.
#>
param(
  [string]$RepoRoot = $(if ($PSScriptRoot) { Split-Path (Split-Path $PSScriptRoot -Parent) -Parent } else { (Get-Location).Path }),
  [switch]$SkipCompile
)

$ErrorActionPreference = 'Stop'
$RigPath = Join-Path $PSScriptRoot 'rig.json'
$Rig = Get-Content -Raw -Path $RigPath | ConvertFrom-Json
$NodeHome = $Rig.windows.nodeHome
$env:Path = "$NodeHome;$env:Path"
$env:TANDEM_PERF_PROFILE = 'gtx1660'
$env:TANDEM_WSL_DISTRO = $Rig.wsl.distro
$env:TANDEM_WSL_USER = $Rig.wsl.user
$env:TANDEM_OPENCLAW_CONFIG = ('\\wsl$\' + $Rig.wsl.distro + ($Rig.wsl.openclawConfig -replace '/', '\'))
$env:TANDEM_API_PORT = [string]$Rig.tandem.apiPort

Write-Host "[gtx1660] Repo: $RepoRoot"
Write-Host "[gtx1660] OpenClaw config: $env:TANDEM_OPENCLAW_CONFIG"

$Wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if ($Wsl) {
  Write-Host '[gtx1660] Ensuring OpenClaw gateway in WSL...'
  & wsl.exe -d $Rig.wsl.distro -- systemctl --user start openclaw-gateway.service
}

if (-not (Test-Path (Join-Path $NodeHome 'node.exe'))) {
  throw "Windows Node not found at $NodeHome"
}

if (-not $SkipCompile) {
  Write-Host '[gtx1660] Compiling on Windows...'
  Push-Location $RepoRoot
  try {
    & (Join-Path $NodeHome 'npm.cmd') run compile
    if ($LASTEXITCODE -ne 0) { throw "npm run compile failed ($LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}

$Electron = Join-Path $RepoRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $Electron)) {
  Write-Host '[gtx1660] Installing Windows Electron + native modules (first run)...'
  Push-Location $RepoRoot
  try {
    & (Join-Path $NodeHome 'npm.cmd') install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed ($LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $Electron)) {
  throw "electron.exe missing after npm install: $Electron"
}

Write-Host '[gtx1660] Starting Tandem Browser (Windows GPU path)...'
$StartJs = Join-Path $RepoRoot 'scripts\start.js'
if (Test-Path $StartJs) {
  & (Join-Path $NodeHome 'node.exe') $StartJs --skip-compile --profile=gtx1660
} else {
  & $Electron $RepoRoot --tandem-profile=gtx1660
}
