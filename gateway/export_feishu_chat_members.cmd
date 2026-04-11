@echo off
setlocal
set SCRIPT_DIR=%~dp0
if "%SCRIPT_DIR:~-1%"=="\" set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%
if "%NODE_BIN%"=="" set NODE_BIN=%USERPROFILE%\node-v20.19.0-win-x64\node.exe
if not exist "%NODE_BIN%" set NODE_BIN=node
"%NODE_BIN%" "%SCRIPT_DIR%\export_feishu_chat_members.mjs" %*
