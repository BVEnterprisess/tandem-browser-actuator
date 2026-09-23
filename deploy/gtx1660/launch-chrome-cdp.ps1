#requires -Version 5.1
<#
.SYNOPSIS
  Start Google Chrome with a remote-debugging port for Tandem CDP cookie import.

.DESCRIPTION
  Network.getAllCookies only works when THIS Chrome instance owns the debug port.
  A second chrome.exe against the same user-data-dir is ignored if Chrome is
  already running without --remote-debugging-port. Close that Chrome first.
#>
param(
  [string]$ProfileDir = 'Default',
  [int]$Port = 9222
)

$ErrorActionPreference = 'Stop'

function Test-CdpPort([int]$ListenPort) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$ListenPort/json/version" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match 'webSocketDebuggerUrl'
  } catch {
    return $false
  }
}

if (Test-CdpPort $Port) {
  Write-Host "[gtx1660] Chrome CDP already listening on 127.0.0.1:$Port"
  exit 0
}

$candidates = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$chrome = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $chrome) {
  throw 'chrome.exe not found under Program Files or LOCALAPPDATA'
}

Write-Host "[gtx1660] Starting Chrome CDP profile=$ProfileDir port=$Port"
Write-Host '[gtx1660] If Chrome was already running without the debug flag, close it and rerun.'
Start-Process -FilePath $chrome -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--profile-directory=$ProfileDir",
  '--restore-last-session'
)
