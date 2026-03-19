# Codex Feishu Gateway

This migration kit connects a Feishu bot to local Codex sessions through Feishu long connection.

## What it includes

- `codex_feishu_gateway.mjs`: Feishu long-connection gateway
- `feishu_gateway.example.json`: sanitized config template
- `run_codex_feishu_gateway.sh`: foreground macOS/Linux runner
- `install_codex_feishu_launchagent.sh`: macOS `launchd` installer
- `run_codex_feishu_gateway.cmd`: foreground Windows runner
- `install_codex_feishu_task.ps1`: Windows Task Scheduler installer
- `README-codex-feishu-windows.md`: Windows migration guide
- `skill/codex-feishu-gateway/`: reusable skill version of this workflow

## Features

- Receive `im.message.receive_v1` over Feishu WebSocket long connection
- Map each Feishu chat to a Codex session
- Continue the same conversation with `codex exec resume`
- Support `/status`, `/progress`, `/plan`, `/approve`, `/cancel`, `/run`, `/new`, `/reset`, `/help`
- Download inbound image/file attachments to local disk
- Send local files or images back to Feishu with `[feishu-attachment] <absolute-path>`
- Show a reaction-based processing indicator while Codex is working
- In groups, keep per-sender Codex sessions while also maintaining shared public group memory
- Add lightweight message classification so the bot can answer publicly or suggest moving to direct chat
- In direct chats, simple requests can execute immediately while more complex requests auto-route into planning first
- Planning replies can also render Feishu interactive cards for approval, cancel, and follow-up status

## Prerequisites

- Node.js 20+
- Codex CLI available as `codex`, or set `codexBin` explicitly
- A published Feishu self-built app with Bot capability enabled
- Feishu event subscription set to long connection mode
- Event `im.message.receive_v1` subscribed
- Feishu permissions for message send/receive and any file/image/reaction features you need
- If you want card button clicks, a public HTTP callback endpoint is required in addition to long connection

## Install dependency

In the same directory as this kit:

```bash
npm install
```

## Configuration

1. Copy `feishu_gateway.example.json` to a real config file.
2. Fill in your real `appId`, `appSecret`, `workspace`, and `codexBin`.
3. To enable plan cards with working buttons, set `planCardsEnabled = true`, `cardCallbackEnabled = true`, and configure `cardCallbackHost`, `cardCallbackPort`, `cardCallbackPath`, `verificationToken`, and `encryptKey` to match the Feishu callback settings.
4. Leave `cardCallbackAutoChallenge = true` so the gateway can answer Feishu's callback URL verification challenge automatically.
5. Set `cardCallbackPublicBaseUrl` if you already have a fixed public callback domain, or enable `cardCallbackTunnelEnabled = true` to let the gateway launch a local `cloudflared` quick tunnel and print the public callback URL in the logs.
6. If you only want the card UI without button callbacks yet, leave `cardCallbackEnabled = false`; the gateway will send status cards and fall back to `/approve` and `/cancel`.
7. Keep the real config outside the shareable package if you are distributing the kit.

## Foreground run

macOS / Linux:

```bash
node ./codex_feishu_gateway.mjs auth-test --config /path/to/feishu_gateway.json
./run_codex_feishu_gateway.sh
```

Windows:

```powershell
node .\codex_feishu_gateway.mjs auth-test --config C:\path\to\feishu_gateway.json
.\run_codex_feishu_gateway.cmd
```

## Background run

macOS:

```bash
./install_codex_feishu_launchagent.sh
```

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\install_codex_feishu_task.ps1
```

## Attachment syntax

If Codex should send a local file or image back through Feishu, it must append one line per file:

- POSIX: `[feishu-attachment] /absolute/path/to/file.pdf`
- Windows: `[feishu-attachment] C:\absolute\path\to\file.pdf`

## Planning workflow

- In direct chats, simple single-step requests execute directly; more complex requests start in planning mode automatically.
- Codex can inspect the workspace, ask follow-up questions, and return a plan before making changes.
- Reply normally to answer open questions.
- Send `/approve` to execute the latest approved plan.
- Send `/cancel` to drop the pending plan while keeping the chat session.
- Send `/run <task>` to bypass planning and execute immediately.
- When `planCardsEnabled` is on, the gateway also sends an interactive card that shows the current plan status.
- When card callbacks are enabled, `Approve`, `Revise`, and `Cancel` buttons work from the card itself.

## Card callback setup

- Long connection handles `im.message.receive_v1`, but Feishu card button callbacks are callback subscriptions, so they need a reachable HTTP endpoint.
- Point the Feishu callback URL at `http(s)://<your-public-host><cardCallbackPath>` and expose the local `cardCallbackPort`.
- If you use the built-in tunnel path, install `cloudflared`, set `cardCallbackTunnelEnabled = true`, start the gateway, and then copy the logged public callback URL into the Feishu app's card callback setting.
- The gateway now answers Feishu `url_verification` challenges automatically when `cardCallbackAutoChallenge = true`, which is required for callback URL verification.
- If callback security verification is enabled in Feishu, copy the same `verificationToken` and `encryptKey` into the gateway config.
- Keep long connection enabled as-is; the HTTP callback only supplements card actions.

## Notes

- Use `groupSessionScope = group_sender` if group members should not share one conversation.
- `groupAssistantMode = hybrid` keeps group replies public-first while preserving private/direct-chat execution behavior.
- `groupPublicMemoryLimit` and `groupHighlightLimit` control how much public group context is carried into prompts.
- `startupNotifyChatIds` can send a boot-ready message to one or more Feishu chats after the long connection becomes ready.
- `startupNotifyDeduplicatePerBoot = true` prevents duplicate "ready" messages during reconnect loops in the same Windows boot.
- Prefer foreground validation before enabling startup automation.
- This kit is a standalone local gateway. It does not modify the Codex desktop app bundle.
- The Feishu Node SDK documents that long connection currently supports event subscriptions only, not callback subscriptions, so interactive cards require the extra HTTP callback path described above.
