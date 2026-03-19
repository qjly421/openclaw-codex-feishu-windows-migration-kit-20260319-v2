@echo off
setlocal
set SCRIPT_DIR=%~dp0
if "%SCRIPT_DIR:~-1%"=="\" set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%
if "%FEISHU_GATEWAY_CONFIG%"=="" set FEISHU_GATEWAY_CONFIG=%USERPROFILE%\.codex-feishu-gateway\feishu_gateway.json
if "%NODE_BIN%"=="" set NODE_BIN=node
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\start_codex_feishu_gateway.ps1" -GatewayRoot "%SCRIPT_DIR%" -ConfigPath "%FEISHU_GATEWAY_CONFIG%" -NodePath "%NODE_BIN%"
