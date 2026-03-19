param(
  [string]$TaskName = "CodexFeishuGateway",
  [string]$BootTaskName = "CodexFeishuGatewayBoot",
  [string]$HealthTaskName = "CodexFeishuGatewayHealth",
  [string]$GatewayRoot = "${env:USERPROFILE}\codex-feishu",
  [string]$ConfigPath = "${env:USERPROFILE}\.codex-feishu-gateway\feishu_gateway.json",
  [string]$NodePath = "",
  [string]$UserProfilePath = $env:USERPROFILE,
  [int]$BootDelaySeconds = 45,
  [int]$WaitForInternetSeconds = 600,
  [int]$InternetCheckIntervalSeconds = 10,
  [string]$InternetProbeUrlsCsv = "https://open.feishu.cn",
  [string]$WifiPortalLoginScript = "",
  [int]$HealthCheckIntervalMinutes = 5,
  [int]$StaleActiveRunMinutes = 5,
  [int]$HealthRestartCooldownMinutes = 5,
  [switch]$SkipHealthTask,
  [switch]$SkipBootTask
)

$SupervisorScript = Join-Path $GatewayRoot "run_codex_feishu_gateway_supervisor.ps1"
if (-not (Test-Path $SupervisorScript)) {
  throw "Gateway supervisor script not found: $SupervisorScript"
}

$StartScript = Join-Path $GatewayRoot "start_codex_feishu_gateway.ps1"
if (-not (Test-Path $StartScript)) {
  throw "Gateway start script not found: $StartScript"
}

$BootScript = Join-Path $GatewayRoot "start_codex_feishu_gateway_boot.ps1"
if (-not (Test-Path $BootScript)) {
  throw "Gateway boot script not found: $BootScript"
}

$HealthScript = Join-Path $GatewayRoot "check_codex_feishu_gateway_health.ps1"
if (-not (Test-Path $HealthScript)) {
  throw "Gateway health script not found: $HealthScript"
}

if (-not $NodePath) {
  $preferredNode = Join-Path $env:USERPROFILE 'node-v20.19.0-win-x64\node.exe'
  if (Test-Path $preferredNode) {
    $NodePath = $preferredNode
  } else {
    try {
      $NodePath = (Get-Command node -ErrorAction Stop).Source
    } catch {
      throw "Node.js executable not found. Pass -NodePath explicitly."
    }
  }
}

if (-not $WifiPortalLoginScript) {
  $defaultPortalLoginScript = Join-Path (Split-Path -Parent $GatewayRoot) 'wifi-portal-auto\login.ps1'
  if (Test-Path $defaultPortalLoginScript) {
    $WifiPortalLoginScript = (Resolve-Path $defaultPortalLoginScript).Path
  }
}

$logonArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`" -GatewayRoot `"$GatewayRoot`" -ConfigPath `"$ConfigPath`" -NodePath `"$NodePath`" -WaitForInternetSeconds $WaitForInternetSeconds -InternetCheckIntervalSeconds $InternetCheckIntervalSeconds -InternetProbeUrlsCsv `"$InternetProbeUrlsCsv`""
if ($WifiPortalLoginScript) {
  $logonArgs = "$logonArgs -WifiPortalLoginScript `"$WifiPortalLoginScript`""
}

$logonAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $logonArgs -WorkingDirectory $GatewayRoot
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $logonAction -Trigger $logonTrigger -Settings $settings -Description "Start Codex Feishu Gateway at logon" -Force | Out-Null
Write-Host "Installed scheduled task: $TaskName"

if (-not $SkipBootTask) {
  $bootArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$BootScript`" -GatewayRoot `"$GatewayRoot`" -ConfigPath `"$ConfigPath`" -NodePath `"$NodePath`" -UserProfilePath `"$UserProfilePath`" -BootDelaySeconds $BootDelaySeconds -WaitForInternetSeconds $WaitForInternetSeconds -InternetCheckIntervalSeconds $InternetCheckIntervalSeconds -InternetProbeUrlsCsv `"$InternetProbeUrlsCsv`""
  $bootAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $bootArgs -WorkingDirectory $GatewayRoot
  $bootTrigger = New-ScheduledTaskTrigger -AtStartup
  $bootPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $bootTask = New-ScheduledTask -Action $bootAction -Trigger $bootTrigger -Settings $settings -Principal $bootPrincipal -Description "Start Codex Feishu Gateway at boot without interactive logon"
  Register-ScheduledTask -TaskName $BootTaskName -InputObject $bootTask -Force | Out-Null
  Write-Host "Installed scheduled task: $BootTaskName"
}

if (-not $SkipHealthTask) {
  $healthArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$HealthScript`" -GatewayRoot `"$GatewayRoot`" -ConfigPath `"$ConfigPath`" -NodePath `"$NodePath`" -StaleActiveRunMinutes $StaleActiveRunMinutes -RestartCooldownMinutes $HealthRestartCooldownMinutes -WaitForInternetSeconds 60 -InternetCheckIntervalSeconds $InternetCheckIntervalSeconds -InternetProbeUrlsCsv `"$InternetProbeUrlsCsv`""
  if ($WifiPortalLoginScript) {
    $healthArgs = "$healthArgs -WifiPortalLoginScript `"$WifiPortalLoginScript`""
  }

  $healthAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $healthArgs -WorkingDirectory $GatewayRoot
  $healthTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes $HealthCheckIntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
  $healthPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $healthSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
  $healthTask = New-ScheduledTask -Action $healthAction -Trigger $healthTrigger -Settings $healthSettings -Principal $healthPrincipal -Description "Health-check and restart Codex Feishu Gateway when it stalls"
  Register-ScheduledTask -TaskName $HealthTaskName -InputObject $healthTask -Force | Out-Null
  Write-Host "Installed scheduled task: $HealthTaskName"
}
