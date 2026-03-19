param(
  [switch]$ForceInstall
)

$ErrorActionPreference = 'Stop'

function Test-CommandExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-CommandExists -Name 'node')) {
  Write-Error "Node.js is not installed or not on PATH. Install Node.js LTS first, then rerun this script."
}

if (-not (Test-CommandExists -Name 'npm')) {
  Write-Error "npm is not available. Reinstall Node.js LTS, then rerun this script."
}

$existingCodex = Get-Command codex -ErrorAction SilentlyContinue
if ($existingCodex -and -not $ForceInstall) {
  Write-Host "Codex CLI is already available:" $existingCodex.Source
  try {
    & codex --version
  } catch {
    Write-Warning "codex exists but version check failed. Re-run with -ForceInstall if needed."
  }
  Write-Host "If you want to reinstall anyway, run:"
  Write-Host "powershell -ExecutionPolicy Bypass -File .\\install_codex_cli_windows.ps1 -ForceInstall"
  exit 0
}

Write-Host "Installing Codex CLI with npm..."
npm install -g @openai/codex
if ($LASTEXITCODE -ne 0) {
  Write-Error "npm install -g @openai/codex failed."
}

if (-not (Test-CommandExists -Name 'codex')) {
  Write-Error "Installation finished but 'codex' is still not on PATH. Open a new PowerShell window and run 'codex --version'."
}

Write-Host "Codex CLI installed successfully."
try {
  & codex --version
} catch {
  Write-Warning "codex was installed, but version output could not be read in this shell."
}

Write-Host "Next steps:"
Write-Host "1. Run: codex"
Write-Host "2. Sign in with ChatGPT or configure your API key"
Write-Host "3. Return to the gateway folder and continue the gateway deployment steps"
