param(
  [string]$GatewayRoot = $PSScriptRoot,
  [string]$ConfigPath = "${env:USERPROFILE}\.codex-feishu-gateway\feishu_gateway.json",
  [string]$NodePath = "",
  [string]$UserProfilePath = $env:USERPROFILE,
  [int]$BootDelaySeconds = 45,
  [int]$WaitForInternetSeconds = 600,
  [int]$InternetCheckIntervalSeconds = 10,
  [string]$InternetProbeUrlsCsv = "https://open.feishu.cn"
)

$ErrorActionPreference = 'Stop'

$GatewayRoot = (Resolve-Path $GatewayRoot).Path
$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
$UserProfilePath = [System.IO.Path]::GetFullPath($UserProfilePath)
$StateRoot = Split-Path -Parent $ConfigPath
if (-not (Test-Path $StateRoot)) {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
}

$BootLog = Join-Path $StateRoot 'watch.boot.log'

function Write-BootLogLine {
  param([string]$Message)

  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $BootLog -Value "[$timestamp] $Message" -Encoding UTF8
}

if (-not $NodePath) {
  $preferredNode = Join-Path $UserProfilePath 'node-v20.19.0-win-x64\node.exe'
  if (Test-Path $preferredNode) {
    $NodePath = $preferredNode
  } else {
    $NodePath = (Get-Command node -ErrorAction Stop).Source
  }
}

Set-Location $GatewayRoot

if ($BootDelaySeconds -gt 0) {
  Write-BootLogLine -Message "boot task waiting ${BootDelaySeconds}s before launcher start"
  Start-Sleep -Seconds $BootDelaySeconds
}

$LauncherScript = Join-Path $GatewayRoot 'start_codex_feishu_gateway.ps1'
if (-not (Test-Path $LauncherScript)) {
  throw "Gateway launcher script not found: $LauncherScript"
}

Write-BootLogLine -Message "boot task target user profile=$UserProfilePath"
Write-BootLogLine -Message "boot task launching supervisor via $LauncherScript"
& $LauncherScript `
  -GatewayRoot $GatewayRoot `
  -ConfigPath $ConfigPath `
  -NodePath $NodePath `
  -UserProfilePath $UserProfilePath `
  -WaitForInternetSeconds $WaitForInternetSeconds `
  -InternetCheckIntervalSeconds $InternetCheckIntervalSeconds `
  -InternetProbeUrlsCsv $InternetProbeUrlsCsv
Write-BootLogLine -Message "boot task finished launcher handoff"
