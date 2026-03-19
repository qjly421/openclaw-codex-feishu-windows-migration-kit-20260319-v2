param(
  [string]$GatewayRoot = $PSScriptRoot,
  [string]$ConfigPath = "${env:USERPROFILE}\.codex-feishu-gateway\feishu_gateway.json",
  [string]$NodePath = "",
  [int]$WaitForInternetSeconds = 0,
  [int]$InternetCheckIntervalSeconds = 10,
  [string]$InternetProbeUrlsCsv = "https://open.feishu.cn",
  [string]$WifiPortalLoginScript = ""
)

$ErrorActionPreference = 'Stop'

$GatewayRoot = (Resolve-Path $GatewayRoot).Path
$SupervisorScript = Join-Path $GatewayRoot 'run_codex_feishu_gateway_supervisor.ps1'
if (-not (Test-Path $SupervisorScript)) {
  throw "Supervisor script not found: $SupervisorScript"
}

$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
$StateRoot = Split-Path -Parent $ConfigPath
if (-not (Test-Path $StateRoot)) {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
}

$LauncherLog = Join-Path $StateRoot 'launcher.stdout.log'
$LauncherErrorLog = Join-Path $StateRoot 'launcher.stderr.log'
$PortalLog = Join-Path $StateRoot 'portal.login.log'
$StatusFile = Join-Path $StateRoot 'watch.supervisor.status.json'
$SupervisorPidFile = Join-Path $StateRoot 'watch.supervisor.pid'
$GatewayPidFile = Join-Path $StateRoot 'watch.gateway.pid'
$WatchStdoutLog = Join-Path $StateRoot 'watch.stdout.log'
$WatchStderrLog = Join-Path $StateRoot 'watch.stderr.log'
$GatewayScript = Join-Path $GatewayRoot 'codex_feishu_gateway.mjs'
$ProxyEnvironmentVariableNames = @(
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy'
)

function Write-LauncherLogLine {
  param(
    [string]$Message,
    [switch]$Error
  )

  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $path = if ($Error) { $LauncherErrorLog } else { $LauncherLog }
  Add-Content -Path $path -Value "[$timestamp] $Message" -Encoding UTF8
}

function Write-PortalLogLine {
  param(
    [string]$Message,
    [switch]$Error
  )

  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $prefix = if ($Error) { '[error]' } else { '[info]' }
  Add-Content -Path $PortalLog -Value "[$timestamp] $prefix $Message" -Encoding UTF8
}

function Resolve-NodePath {
  param([string]$RequestedPath)

  $candidates = New-Object System.Collections.Generic.List[string]
  if ($RequestedPath) {
    $candidates.Add($RequestedPath)
  }
  if ($env:NODE_BIN) {
    $candidates.Add($env:NODE_BIN)
  }
  $candidates.Add((Join-Path $env:USERPROFILE 'node-v20.19.0-win-x64\node.exe'))

  foreach ($candidate in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path $candidate)) {
      return (Resolve-Path $candidate).Path
    }
  }

  try {
    return (Get-Command node -ErrorAction Stop).Source
  } catch {
    throw "Node.js executable not found. Set -NodePath or NODE_BIN."
  }
}

function Clear-ProxyEnvironmentVariables {
  $cleared = New-Object System.Collections.Generic.List[string]

  foreach ($name in $ProxyEnvironmentVariableNames) {
    $envPath = "Env:$name"
    if (Test-Path $envPath) {
      Remove-Item -Path $envPath -Force -ErrorAction SilentlyContinue
      if (-not (Test-Path $envPath)) {
        $cleared.Add($name)
      }
    }
  }

  @($cleared | Sort-Object -Unique)
}

function Test-ProcessAlive {
  param([int]$ProcessId)

  if ($ProcessId -le 0) {
    return $false
  }

  try {
    $null = Get-Process -Id $ProcessId -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Read-JsonFileWithRetry {
  param(
    [string]$Path,
    [int]$Attempts = 5,
    [int]$DelayMilliseconds = 150
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
    try {
      return (Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop)
    } catch {
      if ($attempt -ge $Attempts) {
        return $null
      }
      Start-Sleep -Milliseconds $DelayMilliseconds
    }
  }

  return $null
}

function Write-AtomicUtf8File {
  param(
    [string]$Path,
    [string]$Content
  )

  $directory = Split-Path -Parent $Path
  if ($directory -and -not (Test-Path $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $tempName = ".{0}.{1}.{2}.tmp" -f [System.IO.Path]::GetFileName($Path), $PID, ([Guid]::NewGuid().ToString('N'))
  $tempPath = Join-Path $directory $tempName

  try {
    [System.IO.File]::WriteAllText($tempPath, [string]$Content, [System.Text.UTF8Encoding]::new($false))
    Move-Item -Path $tempPath -Destination $Path -Force
  } finally {
    Remove-Item -Path $tempPath -Force -ErrorAction SilentlyContinue
  }
}

function Write-AtomicAsciiFile {
  param(
    [string]$Path,
    [string]$Content
  )

  $directory = Split-Path -Parent $Path
  if ($directory -and -not (Test-Path $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $tempName = ".{0}.{1}.{2}.tmp" -f [System.IO.Path]::GetFileName($Path), $PID, ([Guid]::NewGuid().ToString('N'))
  $tempPath = Join-Path $directory $tempName

  try {
    [System.IO.File]::WriteAllText($tempPath, [string]$Content, [System.Text.ASCIIEncoding]::new())
    Move-Item -Path $tempPath -Destination $Path -Force
  } finally {
    Remove-Item -Path $tempPath -Force -ErrorAction SilentlyContinue
  }
}

function Find-GatewayWatchProcessIds {
  param(
    [string]$GatewayScriptPath,
    [string]$ConfigFilePath
  )

  if (-not (Test-Path $GatewayScriptPath)) {
    return @()
  }

  $scriptPattern = [Regex]::Escape((Resolve-Path $GatewayScriptPath).Path)
  $configPattern = [Regex]::Escape([System.IO.Path]::GetFullPath($ConfigFilePath))

  @(
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $cmd = [string]$_.CommandLine
        $cmd -and
        $cmd -match $scriptPattern -and
        $cmd -match '\bwatch\b' -and
        $cmd -match $configPattern
      } |
      Select-Object -ExpandProperty ProcessId |
      Sort-Object -Unique
  )
}

function Repair-StaleSupervisorState {
  param(
    [string]$StatusPath,
    [string]$SupervisorPidPath,
    [string]$GatewayPidPath,
    [int[]]$ActiveGatewayProcessIds = @()
  )

  if (-not (Test-Path $StatusPath)) {
    return
  }

  $status = Read-JsonFileWithRetry -Path $StatusPath
  if (-not $status) {
    return
  }

  $statusText = [string]$status.status
  if ($statusText -notin @('running', 'starting')) {
    return
  }

  $supervisorPid = 0
  if ($status.PSObject.Properties.Name -contains 'supervisorPid' -and $status.supervisorPid) {
    $supervisorPid = [int]$status.supervisorPid
  }

  $childPid = 0
  if ($status.PSObject.Properties.Name -contains 'childPid' -and $status.childPid) {
    $childPid = [int]$status.childPid
  }

  if ((Test-ProcessAlive -ProcessId $supervisorPid) -or (Test-ProcessAlive -ProcessId $childPid) -or $ActiveGatewayProcessIds.Count -gt 0) {
    return
  }

  Remove-Item -Path $SupervisorPidPath -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $GatewayPidPath -Force -ErrorAction SilentlyContinue

  $nextStatus = @{}
  foreach ($property in $status.PSObject.Properties) {
    $nextStatus[$property.Name] = $property.Value
  }
  $nextStatus.status = 'stale'
  $nextStatus.checkedAt = (Get-Date).ToString('o')
  $nextStatus.staleReason = 'missing_supervisor_and_child_process'

  Write-AtomicUtf8File -Path $StatusPath -Content ($nextStatus | ConvertTo-Json -Depth 5)
  Write-LauncherLogLine -Message "cleared stale supervisor markers because status=$statusText but supervisor_pid=$supervisorPid and child_pid=$childPid were not alive"
}

function Resolve-WifiPortalLoginScriptPath {
  param(
    [string]$RequestedPath,
    [string]$GatewayRootPath
  )

  $candidates = New-Object System.Collections.Generic.List[string]
  if ($RequestedPath) {
    $candidates.Add($RequestedPath)
  }

  $gatewayParent = Split-Path -Parent $GatewayRootPath
  if ($gatewayParent) {
    $candidates.Add((Join-Path $gatewayParent 'wifi-portal-auto\login.ps1'))
  }

  foreach ($candidate in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path $candidate)) {
      return (Resolve-Path $candidate).Path
    }
  }

  return ''
}

function Get-InternetProbeUrls {
  param([string]$Csv)

  $items = @()
  $csvValue = if ($null -ne $Csv) { $Csv } else { '' }
  foreach ($entry in ($csvValue -split ',')) {
    $trimmed = $entry.Trim()
    if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
      $items += $trimmed
    }
  }

  if ($items.Count -eq 0) {
    return @('https://open.feishu.cn')
  }

  return $items
}

function Test-InteractiveLauncherSession {
  try {
    $identityName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    if ($identityName -eq 'NT AUTHORITY\SYSTEM') {
      return $false
    }
  } catch {
    return $false
  }

  try {
    $process = Get-Process -Id $PID -ErrorAction Stop
    if ($process.SessionId -eq 0) {
      return $false
    }
  } catch {
    return $false
  }

  return $true
}

function Get-WinInetProxySettings {
  $settingsPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  $result = [ordered]@{
    ProxyEnable = $null
    ProxyServer = ''
    AutoConfigURL = ''
    AutoDetect = $null
  }

  if (-not (Test-Path $settingsPath)) {
    return [PSCustomObject]$result
  }

  try {
    $settings = Get-ItemProperty -Path $settingsPath -ErrorAction Stop
    if ($settings.PSObject.Properties.Name -contains 'ProxyEnable') {
      $result.ProxyEnable = [int]$settings.ProxyEnable
    }
    if ($settings.PSObject.Properties.Name -contains 'ProxyServer' -and $null -ne $settings.ProxyServer) {
      $result.ProxyServer = [string]$settings.ProxyServer
    }
    if ($settings.PSObject.Properties.Name -contains 'AutoConfigURL' -and $null -ne $settings.AutoConfigURL) {
      $result.AutoConfigURL = [string]$settings.AutoConfigURL
    }
    if ($settings.PSObject.Properties.Name -contains 'AutoDetect') {
      $result.AutoDetect = [int]$settings.AutoDetect
    }
  } catch {
  }

  return [PSCustomObject]$result
}

function Format-WinInetProxySettings {
  param([object]$Settings)

  $proxyEnableText = if ($null -ne $Settings.ProxyEnable) { [string]$Settings.ProxyEnable } else { 'n/a' }
  $proxyServerText = if ([string]::IsNullOrWhiteSpace($Settings.ProxyServer)) { '(empty)' } else { $Settings.ProxyServer }
  $autoConfigText = if ([string]::IsNullOrWhiteSpace($Settings.AutoConfigURL)) { '(empty)' } else { $Settings.AutoConfigURL }
  $autoDetectText = if ($null -ne $Settings.AutoDetect) { [string]$Settings.AutoDetect } else { 'n/a' }

  "proxy_enable=$proxyEnableText proxy_server=$proxyServerText auto_config_url=$autoConfigText auto_detect=$autoDetectText"
}

function Test-LoopbackProxyServer {
  param([string]$ProxyServer)

  if ([string]::IsNullOrWhiteSpace($ProxyServer)) {
    return $false
  }

  return $ProxyServer -match '(^|[=;,\s])(127\.0\.0\.1|localhost)(:\d+)?($|[;,\s])'
}

function Disable-WinInetProxySettings {
  $settingsPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  if (-not (Test-Path $settingsPath)) {
    return $false
  }

  Set-ItemProperty -Path $settingsPath -Name ProxyEnable -Type DWord -Value 0
  Set-ItemProperty -Path $settingsPath -Name ProxyServer -Value ''
  Remove-ItemProperty -Path $settingsPath -Name AutoConfigURL -ErrorAction SilentlyContinue
  return $true
}

function Test-InternetProbeUrl {
  param(
    [string]$Url,
    [switch]$BypassProxy
  )

  try {
    $uri = [System.Uri]$Url
  } catch {
    return $false
  }

  try {
    $request = [System.Net.HttpWebRequest]::Create($uri)
    if ($BypassProxy) {
      $request.Proxy = [System.Net.GlobalProxySelection]::GetEmptyWebProxy()
    }
    $request.Method = 'HEAD'
    $request.AllowAutoRedirect = $false
    $request.Timeout = 8000
    $request.ReadWriteTimeout = 8000
    $request.UserAgent = 'CodexFeishuGateway/1.0'
    $response = $request.GetResponse()
    if ($response) {
      $response.Close()
      return $true
    }
  } catch [System.Net.WebException] {
    $response = $_.Exception.Response
    if ($response) {
      try {
        $responseUri = $response.ResponseUri
        if ($responseUri -and $responseUri.Host -eq $uri.Host) {
          return $true
        }
      } finally {
        $response.Close()
      }
    }
  } catch {
    return $false
  }

  return $false
}

function Get-InternetProbeStatus {
  param([string[]]$ProbeUrls)

  foreach ($probeUrl in $ProbeUrls) {
    if (Test-InternetProbeUrl -Url $probeUrl) {
      return [PSCustomObject]@{
        Available = $true
        UsedDirectConnection = $false
        Url = $probeUrl
      }
    }
  }

  foreach ($probeUrl in $ProbeUrls) {
    if (Test-InternetProbeUrl -Url $probeUrl -BypassProxy) {
      return [PSCustomObject]@{
        Available = $true
        UsedDirectConnection = $true
        Url = $probeUrl
      }
    }
  }

  return [PSCustomObject]@{
    Available = $false
    UsedDirectConnection = $false
    Url = ''
  }
}

function Wait-ForInternetIfNeeded {
  param(
    [int]$TimeoutSeconds,
    [int]$CheckIntervalSeconds,
    [string]$ProbeUrlsCsv,
    [string]$GatewayRootPath,
    [string]$PortalLoginScriptPath
  )

  if ($TimeoutSeconds -le 0) {
    return
  }

  $probeUrls = Get-InternetProbeUrls -Csv $ProbeUrlsCsv
  $checkInterval = [Math]::Max(3, $CheckIntervalSeconds)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $resolvedPortalScript = Resolve-WifiPortalLoginScriptPath -RequestedPath $PortalLoginScriptPath -GatewayRootPath $GatewayRootPath
  $portalLoginAttempted = $false

  function Complete-InternetProbeSuccess {
    param(
      [object]$ProbeStatus,
      [nullable[double]]$ElapsedSeconds = $null,
      [switch]$PortalLoginAttempted
    )

    if (-not $ProbeStatus.Available) {
      return $false
    }

    if (-not $ProbeStatus.UsedDirectConnection) {
      if ($null -eq $ElapsedSeconds) {
        $message = "internet probe succeeded immediately via $($probeUrls -join ', ')"
      } else {
        $portalSummary = if ($PortalLoginAttempted) { ' after portal login' } else { '' }
        $message = "internet probe succeeded${portalSummary} after ${ElapsedSeconds}s"
      }
      Write-LauncherLogLine -Message $message
      Write-PortalLogLine -Message $message
      return $true
    }

    $proxySettings = Get-WinInetProxySettings
    $proxySummary = Format-WinInetProxySettings -Settings $proxySettings
    if ($null -eq $ElapsedSeconds) {
      $message = "internet probe succeeded via direct connection without system proxy for $($ProbeStatus.Url); default probe failed ($proxySummary)"
    } else {
      $portalSummary = if ($PortalLoginAttempted) { ' after portal login' } else { '' }
      $message = "internet probe succeeded${portalSummary} after ${ElapsedSeconds}s via direct connection without system proxy for $($ProbeStatus.Url); default probe failed ($proxySummary)"
    }
    Write-LauncherLogLine -Message $message
    Write-PortalLogLine -Message $message

    $shouldRepairWinInetProxy = ($proxySettings.ProxyEnable -eq 1 -and (Test-LoopbackProxyServer -ProxyServer $proxySettings.ProxyServer)) -or `
      (-not [string]::IsNullOrWhiteSpace($proxySettings.AutoConfigURL))
    if ($shouldRepairWinInetProxy) {
      try {
        if (Disable-WinInetProxySettings) {
          $repairMessage = "disabled current-account WinINET proxy because default probe failed while direct probe succeeded ($proxySummary)"
          Write-LauncherLogLine -Message $repairMessage
          Write-PortalLogLine -Message $repairMessage
        }
      } catch {
        $repairError = "failed to disable current-account WinINET proxy: $($_.Exception.Message)"
        Write-LauncherLogLine -Message $repairError -Error
        Write-PortalLogLine -Message $repairError -Error
      }
    }

    return $true
  }

  $initialProbeStatus = Get-InternetProbeStatus -ProbeUrls $probeUrls
  if (Complete-InternetProbeSuccess -ProbeStatus $initialProbeStatus) {
    return
  }

  Write-LauncherLogLine -Message "internet probe failed; waiting up to ${TimeoutSeconds}s via $($probeUrls -join ', ')"
  Write-PortalLogLine -Message "internet probe failed; waiting up to ${TimeoutSeconds}s via $($probeUrls -join ', ')"

  if ($resolvedPortalScript -and (Test-InteractiveLauncherSession)) {
    Write-LauncherLogLine -Message "invoking WiFi portal login script $resolvedPortalScript"
    Write-PortalLogLine -Message "invoking WiFi portal login script $resolvedPortalScript"
    try {
      $portalProcess = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $resolvedPortalScript, '-LogPath', $PortalLog) `
        -PassThru `
        -Wait
      $portalLoginAttempted = $true
      Write-LauncherLogLine -Message "WiFi portal login script completed"
      Write-PortalLogLine -Message "WiFi portal login script completed with exit_code=$($portalProcess.ExitCode)"
    } catch {
      Write-LauncherLogLine -Message "WiFi portal login script failed: $($_.Exception.Message)" -Error
      Write-PortalLogLine -Message "WiFi portal login script failed: $($_.Exception.Message)" -Error
    }
  } elseif ($resolvedPortalScript) {
    Write-LauncherLogLine -Message "WiFi portal login script found but skipped because the launcher is not in an interactive user session"
    Write-PortalLogLine -Message "WiFi portal login script found but skipped because the launcher is not in an interactive user session"
  } else {
    Write-LauncherLogLine -Message "WiFi portal login script not found; continuing with passive internet wait"
    Write-PortalLogLine -Message "WiFi portal login script not found; continuing with passive internet wait"
  }

  while ((Get-Date) -lt $deadline) {
    $probeStatus = Get-InternetProbeStatus -ProbeUrls $probeUrls
    if (Complete-InternetProbeSuccess `
      -ProbeStatus $probeStatus `
      -ElapsedSeconds ([Math]::Round(($TimeoutSeconds - ($deadline - (Get-Date)).TotalSeconds), 1)) `
      -PortalLoginAttempted:$portalLoginAttempted) {
      return
    }

    Start-Sleep -Seconds $checkInterval
  }

  Write-LauncherLogLine -Message "internet probe timed out after ${TimeoutSeconds}s; continuing gateway startup without confirmed internet"
  Write-PortalLogLine -Message "internet probe timed out after ${TimeoutSeconds}s; continuing gateway startup without confirmed internet" -Error
}

$NodePath = Resolve-NodePath -RequestedPath $NodePath
$nodeArgs = @(
  $GatewayScript,
  'watch',
  '--config',
  $ConfigPath
)

$nodeSummary = $NodePath
Write-LauncherLogLine -Message "launch requested gateway_root=$GatewayRoot config=$ConfigPath node=$nodeSummary"

$clearedProxyVars = @(Clear-ProxyEnvironmentVariables)
if ($clearedProxyVars.Count -gt 0) {
  $clearMessage = "cleared inherited proxy environment variables: $($clearedProxyVars -join ', ')"
  Write-LauncherLogLine -Message $clearMessage
  Write-PortalLogLine -Message $clearMessage
}

$existingGatewayProcessIds = @(Find-GatewayWatchProcessIds -GatewayScriptPath $GatewayScript -ConfigFilePath $ConfigPath)
Repair-StaleSupervisorState `
  -StatusPath $StatusFile `
  -SupervisorPidPath $SupervisorPidFile `
  -GatewayPidPath $GatewayPidFile `
  -ActiveGatewayProcessIds $existingGatewayProcessIds

if ($existingGatewayProcessIds.Count -gt 0) {
  $existingSummary = ($existingGatewayProcessIds -join ', ')
  Write-LauncherLogLine -Message "gateway already running with pid=$existingSummary; skipping duplicate launch"
  Write-Host "Feishu gateway already running (pid=$existingSummary)."
  exit 0
}

Wait-ForInternetIfNeeded `
  -TimeoutSeconds $WaitForInternetSeconds `
  -CheckIntervalSeconds $InternetCheckIntervalSeconds `
  -ProbeUrlsCsv $InternetProbeUrlsCsv `
  -GatewayRootPath $GatewayRoot `
  -PortalLoginScriptPath $WifiPortalLoginScript

try {
  Remove-Item -Path $SupervisorPidFile -Force -ErrorAction SilentlyContinue
  $proc = Start-Process -FilePath $NodePath `
    -ArgumentList $nodeArgs `
    -WorkingDirectory $GatewayRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $WatchStdoutLog `
    -RedirectStandardError $WatchStderrLog `
    -PassThru
  Write-AtomicAsciiFile -Path $GatewayPidFile -Content ([string]$proc.Id)
  Write-AtomicUtf8File -Path $StatusFile -Content (@{
      status = 'running'
      supervisorPid = 0
      childPid = $proc.Id
      launcherPid = $proc.Id
      gatewayRoot = $GatewayRoot
      configPath = $ConfigPath
      nodePath = $NodePath
      startedAt = (Get-Date).ToString('o')
      launchMode = 'direct_node_launch'
    } | ConvertTo-Json -Depth 5)
  Write-LauncherLogLine -Message "launcher started node pid=$($proc.Id)"
} catch {
  Write-LauncherLogLine -Message "launcher failed: $($_.Exception.Message)" -Error
  throw
}

$statusMessage = "Feishu gateway started (node pid=$($proc.Id))."
if (Test-Path $StatusFile) {
  $statusMessage = "$statusMessage Status: $StatusFile"
}
Write-Host $statusMessage
