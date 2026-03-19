param(
  [string]$GatewayRoot = $PSScriptRoot,
  [string]$ConfigPath = "${env:USERPROFILE}\.codex-feishu-gateway\feishu_gateway.json",
  [string]$NodePath = "",
  [int]$StaleActiveRunMinutes = 5,
  [int]$RestartCooldownMinutes = 5,
  [int]$WaitForInternetSeconds = 60,
  [int]$InternetCheckIntervalSeconds = 10,
  [string]$InternetProbeUrlsCsv = "https://open.feishu.cn",
  [string]$WifiPortalLoginScript = ""
)

$ErrorActionPreference = 'Stop'

$GatewayRoot = (Resolve-Path $GatewayRoot).Path
$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
$StateRoot = Split-Path -Parent $ConfigPath
$GatewayScript = Join-Path $GatewayRoot 'codex_feishu_gateway.mjs'
$StartScript = Join-Path $GatewayRoot 'start_codex_feishu_gateway.ps1'
$StatusFile = Join-Path $StateRoot 'watch.supervisor.status.json'
$StateFile = Join-Path $StateRoot 'feishu_gateway_state.json'
$HealthLog = Join-Path $StateRoot 'watch.health.log'
$RestartStampFile = Join-Path $StateRoot 'watch.health.restart.json'

if (-not (Test-Path $GatewayScript)) {
  throw "Gateway script not found: $GatewayScript"
}
if (-not (Test-Path $StartScript)) {
  throw "Gateway start script not found: $StartScript"
}

function Write-HealthLogLine {
  param(
    [string]$Message,
    [switch]$Error
  )

  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $prefix = if ($Error) { '[error]' } else { '[info]' }
  Add-Content -Path $HealthLog -Value "[$timestamp] $prefix $Message" -Encoding UTF8
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

function Read-JsonFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $null
  }

  for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    try {
      return (Get-Content -Raw -Encoding UTF8 $Path | ConvertFrom-Json -ErrorAction Stop)
    } catch {
      if ($attempt -ge 3) {
        return $null
      }
      Start-Sleep -Milliseconds 200
    }
  }

  return $null
}

function Parse-IsoTime {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  try {
    return [DateTimeOffset]::Parse($Value)
  } catch {
    return $null
  }
}

function Find-GatewayWatchProcessIds {
  param(
    [string]$GatewayScriptPath,
    [string]$ConfigFilePath
  )

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

function Get-ChildProcessIds {
  param([int]$ParentPid)

  @(
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentPid" -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty ProcessId
  )
}

function Get-DescendantProcessIds {
  param([int]$RootPid)

  $all = New-Object System.Collections.Generic.List[int]
  $pending = New-Object System.Collections.Generic.Queue[int]
  $pending.Enqueue($RootPid)

  while ($pending.Count -gt 0) {
    $current = $pending.Dequeue()
    foreach ($childId in (Get-ChildProcessIds -ParentPid $current)) {
      $all.Add([int]$childId)
      $pending.Enqueue([int]$childId)
    }
  }

  @($all | Sort-Object -Unique)
}

function Find-CodexDescendantProcessIds {
  param([int[]]$GatewayProcessIds = @())

  $codexIds = New-Object System.Collections.Generic.List[int]
  foreach ($gatewayProcessId in $GatewayProcessIds) {
    foreach ($descendantId in (Get-DescendantProcessIds -RootPid $gatewayProcessId)) {
      try {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $descendantId" -ErrorAction Stop
        if ($process.Name -ieq 'codex.exe') {
          $codexIds.Add([int]$descendantId)
        }
      } catch {
      }
    }
  }

  @($codexIds | Sort-Object -Unique)
}

function Stop-ProcessTree {
  param([int]$RootPid)

  $ids = New-Object System.Collections.Generic.List[int]
  foreach ($childId in (Get-DescendantProcessIds -RootPid $RootPid)) {
    $ids.Add([int]$childId)
  }
  $ids.Add([int]$RootPid)

  foreach ($id in ($ids | Sort-Object -Descending -Unique)) {
    try {
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    } catch {
    }
  }
}

function Get-RestartReasons {
  param(
    [object]$StatusObject = $null,
    [object]$StateObject,
    [int[]]$WatchProcessIds = @(),
    [int[]]$CodexDescendantProcessIds = @(),
    [int]$StaleMinutes = 5
  )

  $reasons = New-Object System.Collections.Generic.List[string]
  $runningActiveRunCount = 0

  if ($WatchProcessIds.Count -eq 0) {
    $reasons.Add('gateway_watch_process_missing')
  }

  $now = [DateTimeOffset]::Now
  if ($StateObject -and $StateObject.activeRuns) {
    foreach ($property in $StateObject.activeRuns.PSObject.Properties) {
      $key = [string]$property.Name
      $activeRun = $property.Value
      if (-not $activeRun -or [string]$activeRun.status -ne 'running') {
        continue
      }

      $runningActiveRunCount += 1

      $activityAt = Parse-IsoTime -Value ([string]$activeRun.lastUpdateAt)
      if (-not $activityAt) {
        $activityAt = Parse-IsoTime -Value ([string]$activeRun.startedAt)
      }
      if (-not $activityAt) {
        continue
      }

      $ageMinutes = ($now - $activityAt).TotalMinutes
      if ($ageMinutes -lt $StaleMinutes) {
        continue
      }

      $codexPid = 0
      if ($activeRun.PSObject.Properties.Name -contains 'codexPid' -and $activeRun.codexPid) {
        $codexPid = [int]$activeRun.codexPid
      }
      if ($codexPid -gt 0) {
        if (-not (Test-ProcessAlive -ProcessId $codexPid)) {
          $reasons.Add(("stale_active_run key={0} codex_pid_missing={1} age_min={2}" -f $key, $codexPid, [math]::Round($ageMinutes, 1)))
        }
        continue
      }

      if ($CodexDescendantProcessIds.Count -eq 0) {
        $reasons.Add(("stale_active_run key={0} codex_pid_not_recorded age_min={1}" -f $key, [math]::Round($ageMinutes, 1)))
      }
    }
  }

  $supervisorPid = 0
  if ($StatusObject -and $StatusObject.PSObject.Properties.Name -contains 'supervisorPid' -and $StatusObject.supervisorPid) {
    $supervisorPid = [int]$StatusObject.supervisorPid
  }
  if ($WatchProcessIds.Count -gt 0 -and $supervisorPid -gt 0 -and -not (Test-ProcessAlive -ProcessId $supervisorPid) -and $runningActiveRunCount -eq 0 -and $CodexDescendantProcessIds.Count -eq 0) {
    $reasons.Add(("gateway_supervisor_missing supervisor_pid={0} watch_pid={1}" -f $supervisorPid, ($WatchProcessIds -join ',')))
  }

  @($reasons | Sort-Object -Unique)
}

function Restart-CodexFeishuGateway {
  param(
    [int[]]$WatchProcessIds = @(),
    [int]$SupervisorPid = 0
  )

  foreach ($watchProcessId in $WatchProcessIds) {
    Write-HealthLogLine -Message "stopping gateway process tree pid=$watchProcessId before restart"
    Stop-ProcessTree -RootPid $watchProcessId
  }

  if ($SupervisorPid -gt 0 -and (Test-ProcessAlive -ProcessId $SupervisorPid)) {
    Write-HealthLogLine -Message "stopping supervisor process tree pid=$SupervisorPid before restart"
    Stop-ProcessTree -RootPid $SupervisorPid
  }

  Start-Sleep -Seconds 2

  $startArgs = @{
    GatewayRoot = $GatewayRoot
    ConfigPath = $ConfigPath
    WaitForInternetSeconds = $WaitForInternetSeconds
    InternetCheckIntervalSeconds = $InternetCheckIntervalSeconds
    InternetProbeUrlsCsv = $InternetProbeUrlsCsv
  }
  if ($NodePath) {
    $startArgs.NodePath = $NodePath
  }
  if ($WifiPortalLoginScript) {
    $startArgs.WifiPortalLoginScript = $WifiPortalLoginScript
  }

  try {
    & $StartScript @startArgs | Out-Null
  } catch {
    Write-HealthLogLine -Message "gateway start script failed: $($_.Exception.Message)" -Error
    throw
  }
}

$status = Read-JsonFile -Path $StatusFile
$state = Read-JsonFile -Path $StateFile
$watchProcessIds = @(Find-GatewayWatchProcessIds -GatewayScriptPath $GatewayScript -ConfigFilePath $ConfigPath)
$codexDescendantProcessIds = @(Find-CodexDescendantProcessIds -GatewayProcessIds $watchProcessIds)
$restartReasons = @(Get-RestartReasons -StatusObject $status -StateObject $state -WatchProcessIds $watchProcessIds -CodexDescendantProcessIds $codexDescendantProcessIds -StaleMinutes $StaleActiveRunMinutes)

if ($restartReasons.Count -eq 0) {
  exit 0
}

$restartStamp = Read-JsonFile -Path $RestartStampFile
if ($restartStamp -and $restartStamp.lastRestartAt) {
  $lastRestartAt = Parse-IsoTime -Value ([string]$restartStamp.lastRestartAt)
  if ($lastRestartAt -and (([DateTimeOffset]::Now - $lastRestartAt).TotalMinutes -lt $RestartCooldownMinutes)) {
    Write-HealthLogLine -Message ("restart suppressed by cooldown reasons={0}" -f ($restartReasons -join '; '))
    exit 0
  }
}

$supervisorPid = 0
if ($status -and $status.PSObject.Properties.Name -contains 'supervisorPid' -and $status.supervisorPid) {
  $supervisorPid = [int]$status.supervisorPid
}

Write-HealthLogLine -Message ("restarting gateway reasons={0}" -f ($restartReasons -join '; '))
Restart-CodexFeishuGateway -WatchProcessIds $watchProcessIds -SupervisorPid $supervisorPid

$restartStampPayload = @{
  lastRestartAt = (Get-Date).ToString('o')
  reasons = $restartReasons
}
$restartStampPayload | ConvertTo-Json -Depth 4 | Set-Content -Path $RestartStampFile -Encoding UTF8
Write-HealthLogLine -Message 'gateway restart requested successfully'
