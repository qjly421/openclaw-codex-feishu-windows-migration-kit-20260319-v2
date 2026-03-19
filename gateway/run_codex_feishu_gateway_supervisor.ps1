param(
  [string]$GatewayRoot = $PSScriptRoot,
  [string]$ConfigPath = "${env:USERPROFILE}\.codex-feishu-gateway\feishu_gateway.json",
  [string]$NodePath = "",
  [int]$InitialRestartDelaySeconds = 2,
  [int]$MaxRestartDelaySeconds = 60,
  [int]$StableRunSeconds = 300,
  [int]$LogRotateBytes = 5242880,
  [int]$LogRotateKeep = 5
)

$ErrorActionPreference = 'Stop'
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

function Rotate-Log {
  param(
    [string]$Path,
    [int]$MaxBytes,
    [int]$Keep
  )

  if (-not (Test-Path $Path)) {
    return
  }
  $item = Get-Item $Path
  if ($item.Length -lt $MaxBytes) {
    return
  }

  for ($index = $Keep - 1; $index -ge 1; $index--) {
    $older = "$Path.$index"
    $newer = "$Path." + ($index + 1)
    if (Test-Path $older) {
      Move-Item -Force $older $newer
    }
  }
  Move-Item -Force $Path "$Path.1"
}

function Write-LogLine {
  param(
    [string]$Path,
    [string]$Message
  )

  Rotate-Log -Path $Path -MaxBytes $LogRotateBytes -Keep $LogRotateKeep
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $Path -Value "[$timestamp] $Message" -Encoding UTF8
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

function Remove-ProxyEnvironmentVariablesFromStartInfo {
  param([System.Diagnostics.ProcessStartInfo]$StartInfo)

  foreach ($name in $ProxyEnvironmentVariableNames) {
    try {
      $StartInfo.EnvironmentVariables.Remove($name)
    } catch {
    }
  }
}

function Write-AtomicTextFile {
  param(
    [string]$Path,
    [string]$Content,
    [System.Text.Encoding]$Encoding
  )

  $directory = Split-Path -Parent $Path
  if ($directory -and -not (Test-Path $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $tempName = ".{0}.{1}.{2}.tmp" -f [System.IO.Path]::GetFileName($Path), $PID, ([Guid]::NewGuid().ToString('N'))
  $tempPath = Join-Path $directory $tempName

  try {
    [System.IO.File]::WriteAllText($tempPath, [string]$Content, $Encoding)
    Move-Item -Path $tempPath -Destination $Path -Force
  } finally {
    Remove-Item -Path $tempPath -Force -ErrorAction SilentlyContinue
  }
}

function Write-AtomicUtf8File {
  param(
    [string]$Path,
    [string]$Content
  )

  Write-AtomicTextFile -Path $Path -Content $Content -Encoding ([System.Text.UTF8Encoding]::new($false))
}

function Write-AtomicAsciiFile {
  param(
    [string]$Path,
    [string]$Content
  )

  Write-AtomicTextFile -Path $Path -Content $Content -Encoding ([System.Text.ASCIIEncoding]::new())
}

function Write-Status {
  param(
    [string]$Path,
    [hashtable]$Data
  )

  Write-AtomicUtf8File -Path $Path -Content ($Data | ConvertTo-Json -Depth 5)
}

function Quote-ProcessArgument {
  param([string]$Value)

  if ($null -eq $Value) {
    return '""'
  }

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  $escaped = $Value -replace '(\\*)"', '$1$1\"'
  $escaped = $escaped -replace '(\\+)$', '$1$1'
  return '"' + $escaped + '"'
}

function Join-ProcessArguments {
  param([string[]]$Arguments)

  (($Arguments | ForEach-Object { Quote-ProcessArgument -Value $_ }) -join ' ')
}

function Start-LoggedProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [string]$StdoutPath,
    [string]$StderrPath
  )

  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  $stdoutWriter = [System.IO.StreamWriter]::new($StdoutPath, $true, $utf8NoBom)
  $stderrWriter = [System.IO.StreamWriter]::new($StderrPath, $true, $utf8NoBom)
  $stdoutWriter.AutoFlush = $true
  $stderrWriter.AutoFlush = $true

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = Join-ProcessArguments -Arguments $ArgumentList
  $startInfo.WorkingDirectory = $WorkingDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  Remove-ProxyEnvironmentVariablesFromStartInfo -StartInfo $startInfo

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo

  $stdoutHandler = [System.Diagnostics.DataReceivedEventHandler]{
    param($sender, $eventArgs)
    if ($null -ne $eventArgs.Data) {
      try {
        $stdoutWriter.WriteLine($eventArgs.Data)
      } catch {
      }
    }
  }
  $stderrHandler = [System.Diagnostics.DataReceivedEventHandler]{
    param($sender, $eventArgs)
    if ($null -ne $eventArgs.Data) {
      try {
        $stderrWriter.WriteLine($eventArgs.Data)
      } catch {
      }
    }
  }

  $process.add_OutputDataReceived($stdoutHandler)
  $process.add_ErrorDataReceived($stderrHandler)

  try {
    if (-not $process.Start()) {
      throw "Failed to start process: $FilePath"
    }
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    return @{
      Process = $process
      StdoutWriter = $stdoutWriter
      StderrWriter = $stderrWriter
      StdoutHandler = $stdoutHandler
      StderrHandler = $stderrHandler
    }
  } catch {
    try {
      $process.remove_OutputDataReceived($stdoutHandler)
    } catch {
    }
    try {
      $process.remove_ErrorDataReceived($stderrHandler)
    } catch {
    }
    try {
      $stdoutWriter.Dispose()
    } catch {
    }
    try {
      $stderrWriter.Dispose()
    } catch {
    }
    try {
      $process.Dispose()
    } catch {
    }
    throw
  }
}

function Stop-LoggedProcessCapture {
  param([hashtable]$ProcessRecord)

  if (-not $ProcessRecord) {
    return
  }

  $process = $ProcessRecord.Process
  if ($process) {
    try {
      $process.CancelOutputRead()
    } catch {
    }
    try {
      $process.CancelErrorRead()
    } catch {
    }
    try {
      if ($ProcessRecord.StdoutHandler) {
        $process.remove_OutputDataReceived($ProcessRecord.StdoutHandler)
      }
    } catch {
    }
    try {
      if ($ProcessRecord.StderrHandler) {
        $process.remove_ErrorDataReceived($ProcessRecord.StderrHandler)
      }
    } catch {
    }
    try {
      $process.Dispose()
    } catch {
    }
  }

  try {
    if ($ProcessRecord.StdoutWriter) {
      $ProcessRecord.StdoutWriter.Dispose()
    }
  } catch {
  }
  try {
    if ($ProcessRecord.StderrWriter) {
      $ProcessRecord.StderrWriter.Dispose()
    }
  } catch {
  }
}

function Get-ChildProcessIds {
  param([int]$ParentPid)

  @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentPid" -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty ProcessId)
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

  $all
}

function Find-NodeChildPid {
  param(
    [int]$ParentPid,
    [int]$TimeoutMs = 5000
  )

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  do {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentPid" -ErrorAction SilentlyContinue)
    $nodeChild = $children | Where-Object { $_.Name -ieq 'node.exe' } | Select-Object -First 1
    if ($nodeChild) {
      return [int]$nodeChild.ProcessId
    }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)

  return $null
}

function Find-StaleGatewayProcessIds {
  param(
    [string]$GatewayScriptPath,
    [string]$ConfigPath,
    [int[]]$ExcludeProcessIds = @()
  )

  $scriptPattern = [Regex]::Escape($GatewayScriptPath)
  $configPattern = [Regex]::Escape($ConfigPath)

  @(
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $cmd = [string]$_.CommandLine
        $cmd -and
        $_.ProcessId -notin $ExcludeProcessIds -and
        $cmd -match $scriptPattern -and
        $cmd -match '\bwatch\b' -and
        $cmd -match $configPattern
      } |
      Select-Object -ExpandProperty ProcessId |
      Sort-Object -Unique
  )
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

$GatewayRoot = (Resolve-Path $GatewayRoot).Path
$GatewayScript = Join-Path $GatewayRoot 'codex_feishu_gateway.mjs'
if (-not (Test-Path $GatewayScript)) {
  throw "Gateway script not found: $GatewayScript"
}

$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
$StateRoot = Split-Path -Parent $ConfigPath
if (-not (Test-Path $StateRoot)) {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
}

$NodePath = Resolve-NodePath -RequestedPath $NodePath
$StdoutLog = Join-Path $StateRoot 'watch.stdout.log'
$StderrLog = Join-Path $StateRoot 'watch.stderr.log'
$SupervisorLog = Join-Path $StateRoot 'watch.supervisor.log'
$SupervisorPidFile = Join-Path $StateRoot 'watch.supervisor.pid'
$GatewayPidFile = Join-Path $StateRoot 'watch.gateway.pid'
$StatusFile = Join-Path $StateRoot 'watch.supervisor.status.json'
$LockFile = Join-Path $StateRoot 'watch.supervisor.lock'

$lockHandle = $null
try {
  $lockHandle = [System.IO.File]::Open($LockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
  Write-LogLine -Path $SupervisorLog -Message "supervisor already running; refusing duplicate launch"
  exit 0
}

$supervisorPid = $PID
$childProcess = $null
$childProcessRecord = $null
$gatewayPid = $null
$restartDelaySeconds = [Math]::Max(1, $InitialRestartDelaySeconds)
$clearedProxyVars = @(Clear-ProxyEnvironmentVariables)

try {
  Write-LogLine -Path $SupervisorLog -Message "supervisor starting gateway_root=$GatewayRoot node=$NodePath config=$ConfigPath pid=$supervisorPid"
  if ($clearedProxyVars.Count -gt 0) {
    Write-LogLine -Path $SupervisorLog -Message "cleared inherited proxy environment variables: $($clearedProxyVars -join ', ')"
  }
  Write-AtomicAsciiFile -Path $SupervisorPidFile -Content ([string]$supervisorPid)

  foreach ($stalePid in (Find-StaleGatewayProcessIds -GatewayScriptPath $GatewayScript -ConfigPath $ConfigPath -ExcludeProcessIds @($PID))) {
    Write-LogLine -Path $SupervisorLog -Message "terminating stale gateway process tree pid=$stalePid before supervisor launch"
    Stop-ProcessTree -RootPid $stalePid
    Start-Sleep -Milliseconds 500
  }

  while ($true) {
    Rotate-Log -Path $StdoutLog -MaxBytes $LogRotateBytes -Keep $LogRotateKeep
    Rotate-Log -Path $StderrLog -MaxBytes $LogRotateBytes -Keep $LogRotateKeep
    Rotate-Log -Path $SupervisorLog -MaxBytes $LogRotateBytes -Keep $LogRotateKeep

    $gatewayArgs = @($GatewayScript, 'watch', '--config', $ConfigPath)
    $startedAt = Get-Date
    Write-Status -Path $StatusFile -Data @{
      status = 'starting'
      supervisorPid = $supervisorPid
      childPid = $null
      gatewayRoot = $GatewayRoot
      configPath = $ConfigPath
      nodePath = $NodePath
      startedAt = $startedAt.ToString('o')
      restartDelaySeconds = $restartDelaySeconds
    }
    Write-LogLine -Path $SupervisorLog -Message ("launching gateway: {0} {1}" -f $NodePath, (Join-ProcessArguments -Arguments $gatewayArgs))

    $childProcessRecord = Start-LoggedProcess `
      -FilePath $NodePath `
      -ArgumentList $gatewayArgs `
      -WorkingDirectory $GatewayRoot `
      -StdoutPath $StdoutLog `
      -StderrPath $StderrLog
    $childProcess = $childProcessRecord.Process
    $gatewayPid = $childProcess.Id
    Write-AtomicAsciiFile -Path $GatewayPidFile -Content ([string]$gatewayPid)
    Write-Status -Path $StatusFile -Data @{
      status = 'running'
      supervisorPid = $supervisorPid
      childPid = $gatewayPid
      launcherPid = $gatewayPid
      gatewayRoot = $GatewayRoot
      configPath = $ConfigPath
      nodePath = $NodePath
      startedAt = $startedAt.ToString('o')
      restartDelaySeconds = $restartDelaySeconds
    }

    $childProcess.WaitForExit()
    Start-Sleep -Milliseconds 200
    $exitCode = $childProcess.ExitCode
    $ranSeconds = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)

    Remove-Item -Path $GatewayPidFile -Force -ErrorAction SilentlyContinue
    Write-Status -Path $StatusFile -Data @{
      status = 'exited'
      supervisorPid = $supervisorPid
      childPid = $gatewayPid
      launcherPid = $gatewayPid
      gatewayRoot = $GatewayRoot
      configPath = $ConfigPath
      nodePath = $NodePath
      startedAt = $startedAt.ToString('o')
      exitedAt = (Get-Date).ToString('o')
      exitCode = $exitCode
      ranSeconds = $ranSeconds
      restartDelaySeconds = $restartDelaySeconds
    }
    Write-LogLine -Path $SupervisorLog -Message "gateway exited code=$exitCode runtime=${ranSeconds}s"
    Stop-LoggedProcessCapture -ProcessRecord $childProcessRecord
    $childProcessRecord = $null
    $childProcess = $null
    $gatewayPid = $null

    if ($ranSeconds -ge $StableRunSeconds) {
      $restartDelaySeconds = [Math]::Max(1, $InitialRestartDelaySeconds)
    } else {
      $restartDelaySeconds = [Math]::Min($MaxRestartDelaySeconds, [Math]::Max(1, $restartDelaySeconds * 2))
    }

    Write-LogLine -Path $SupervisorLog -Message "sleeping ${restartDelaySeconds}s before restart"
    Start-Sleep -Seconds $restartDelaySeconds
  }
} finally {
  try {
    Write-Status -Path $StatusFile -Data @{
      status = 'stopped'
      supervisorPid = $supervisorPid
      childPid = $gatewayPid
      gatewayRoot = $GatewayRoot
      configPath = $ConfigPath
      nodePath = $NodePath
      stoppedAt = (Get-Date).ToString('o')
      restartDelaySeconds = $restartDelaySeconds
    }
  } catch {
    try {
      Write-LogLine -Path $SupervisorLog -Message "failed to update stopped status in finally: $($_.Exception.Message)"
    } catch {
    }
  }
  if ($childProcess -and -not $childProcess.HasExited) {
    Stop-ProcessTree -RootPid $childProcess.Id
  }
  Stop-LoggedProcessCapture -ProcessRecord $childProcessRecord
  Remove-Item -Path $GatewayPidFile -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $SupervisorPidFile -Force -ErrorAction SilentlyContinue
  if ($lockHandle) {
    $lockHandle.Dispose()
  }
}
