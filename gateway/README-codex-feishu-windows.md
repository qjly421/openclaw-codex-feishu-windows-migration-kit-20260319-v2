# Codex Feishu Gateway on Windows

This guide explains how to move the Feishu gateway to a Windows machine.

## Recommended layout

- Gateway folder: `D:\codex-feishu`
- Gateway script: `D:\codex-feishu\codex_feishu_gateway.mjs`
- Config file: `C:\Users\<user>\.codex-feishu-gateway\feishu_gateway.json`
- State and media: under `C:\Users\<user>\.codex-feishu-gateway\`

## Required software

- Node.js LTS
- Codex CLI available as `codex`, or a full path to the binary
- The official Feishu SDK installed locally in the gateway folder

## Install steps

### 1. Copy the kit

Copy this whole directory to the Windows machine, for example:

- `D:\codex-feishu`

### 2. Install Node dependency

In PowerShell inside the gateway folder:

```powershell
npm install
```

### 3. Create the real config file

Copy:

- `feishu_gateway.example.json`

To something like:

- `C:\Users\<user>\.codex-feishu-gateway\feishu_gateway.json`

Update at least these fields:

- `appId`
- `appSecret`
- `workspace`
- `codexBin`
- `groupSessionScope`
- `typingIndicator`
- `mediaRoot`

Recommended defaults:

- `codexBin = "codex"`
- `groupSessionScope = "group_sender"`
- `typingIndicator = true`

### 4. Verify foreground first

```powershell
node .\codex_feishu_gateway.mjs auth-test --config C:\Users\<user>\.codex-feishu-gateway\feishu_gateway.json
node .\codex_feishu_gateway.mjs watch --config C:\Users\<user>\.codex-feishu-gateway\feishu_gateway.json
```

Then test in Feishu:

- `/status`
- a plain text message
- an image or file attachment
- a reply that contains `[feishu-attachment] C:\absolute\path\to\file.pdf`

## Auto-start with Task Scheduler

Install a scheduled task:

```powershell
powershell -ExecutionPolicy Bypass -File .\install_codex_feishu_task.ps1 -GatewayRoot D:\codex-feishu -ConfigPath C:\Users\<user>\.codex-feishu-gateway\feishu_gateway.json
```

What it does:

- trigger at user logon
- add a periodic health-check task
- run a PowerShell supervisor from the gateway directory
- restart automatically on failure
- keep append-only logs in `C:\Users\<user>\.codex-feishu-gateway\`

Runtime files:

- `watch.stdout.log`
- `watch.stderr.log`
- `watch.supervisor.log`
- `watch.supervisor.status.json`
- `watch.health.log`

The health-check task runs every 5 minutes and will restart the gateway if:

- the `watch` process disappears
- an `activeRuns` entry is still marked `running` after the stale threshold
- the recorded `codexPid` for that active run is gone

## Feishu-side checklist

Confirm the Feishu app has:

- Bot capability enabled
- app published
- long connection enabled
- `im.message.receive_v1` subscribed
- permissions for message send/receive
- image/file/reaction permissions if those features are enabled

## Common issues

### Cannot import the Feishu SDK

Run:

```powershell
npm install
```

Or set `FEISHU_LARK_SDK_PATH` to the SDK entry file.

### Messages arrive but Codex does not answer

Check:

- `codexBin`
- `workspace`
- local `codex exec` works manually
- the process can write state files and temp files

### Windows attachment send does not work

Use an absolute Windows path such as:

- `[feishu-attachment] C:\work\report.pdf`

### Group users share one context

Set:

- `groupSessionScope = group_sender`

## Recovery after power loss

If the machine must recover unattended after lab or office power loss, the gateway alone is not enough. Also consider:

1. BIOS auto power-on after AC restore
2. Windows auto-login or equivalent startup path
3. network auto-connect / campus network authentication
4. remote management such as RustDesk, Tailscale, or RDP
