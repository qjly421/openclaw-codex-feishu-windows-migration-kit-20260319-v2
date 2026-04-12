# Windows migration notes for the Codex Feishu gateway

## Goal

Move the standalone Feishu gateway kit to a Windows machine while preserving:

- Feishu long-connection message receive
- Codex session resume per chat
- inbound attachment download
- outbound attachment send
- reaction typing indicator
- startup automation

## Minimal target layout

Recommended layout on Windows:

- gateway folder: `D:\codex-feishu`
- gateway script: `D:\codex-feishu\codex_feishu_gateway.mjs`
- config file: `C:\Users\<user>\.codex-feishu-gateway\feishu_gateway.json`
- logs, state, and media under `C:\Users\<user>\.codex-feishu-gateway\`

## Dependency checklist

Install and verify:

- Node.js LTS
- Codex CLI or another reachable `codex` binary
- `@larksuiteoapi/node-sdk` in the gateway folder

Suggested commands in the gateway folder:

- `npm install`

## Feishu-side checklist

Confirm the Feishu app has:

- Bot capability enabled
- app published
- long connection enabled
- `im.message.receive_v1` subscribed
- message send/receive permissions
- image/file/reaction permissions if those features are needed

## Recommended config values

For shared group chats with multiple human users, prefer:

- `groupSessionScope = group_sender`

For most deployments, keep:

- `dmPolicy = open`
- `groupPolicy = open`
- `typingIndicator = true`
- `progressCommandUpdates = false`

## Validation flow

Use this order:

1. Run `auth-test`
2. Run `watch` in the foreground
3. Send `/status`
4. Send a plain text message
5. Send an image attachment
6. Ask Codex to return a local file using `[feishu-attachment] C:\absolute\path\to\file.pdf`

## Startup automation

Windows equivalent of `launchd` is Task Scheduler.

Prefer a task that:

- triggers at user logon
- starts in the gateway directory
- runs the `watch` command with the explicit config path
- restarts on failure

## Recovery after power loss

The gateway itself is not enough. Unattended recovery typically needs:

1. BIOS power-on after AC restore
2. Windows auto-login or an equivalent startup path
3. network auto-connect or campus-network auto-auth
4. remote control such as RustDesk, Tailscale, or RDP

## Common failure patterns

### The gateway starts but cannot import the Feishu SDK

Fix by running `npm install` in the gateway folder or setting `FEISHU_LARK_SDK_PATH`.

### Messages arrive but Codex never answers

Check:

- `codexBin`
- `workspace`
- local `codex exec` works manually
- the gateway process can write temp files and state files

### Files download in but do not send back out

Check:

- attachment path is absolute for Windows, such as `C:\work\file.pdf`
- file exists on disk
- Feishu app can upload files/images

### Group members interfere with one another

Use `groupSessionScope = group_sender`.
