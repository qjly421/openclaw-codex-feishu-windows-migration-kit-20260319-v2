---
name: codex-feishu-gateway
description: Set up, migrate, package, or troubleshoot the local Feishu gateway that connects Feishu bot messages to Codex CLI/Desktop sessions, including long-connection event handling, chat-to-session mapping, attachment in/out, reaction typing indicators, startup automation, and Windows migration. Use when Codex needs to deploy this gateway on a new machine, especially Windows, or explain and repair the end-to-end Feishu integration flow.
---

# Codex Feishu Gateway

Use this skill to deploy or migrate the standalone Feishu gateway kit that bridges Feishu bot conversations into local Codex sessions.

## Workflow

### 1. Start from the kit directory

Use the files in the migration kit itself rather than machine-specific source paths:

- `codex_feishu_gateway.mjs`
- `feishu_gateway.example.json`
- `README-codex-feishu-gateway.md`
- `README-codex-feishu-windows.md`
- `run_codex_feishu_gateway.cmd`
- `install_codex_feishu_task.ps1`

### 2. Keep the architecture simple

Prefer one Feishu app bot and one local gateway process per machine.

Use session isolation like this:

- Different chats run in parallel
- One chat session key runs serially
- Group chats usually should use `groupSessionScope = group_sender`

### 3. Prepare dependencies on the target machine

Ensure all of these exist:

- `node`
- `codex` or an explicit `codexBin`
- Feishu `appId` and `appSecret`
- local `@larksuiteoapi/node-sdk` installed in the gateway folder, or `FEISHU_LARK_SDK_PATH` set

On Windows, prefer a local npm install in the gateway folder.

### 4. Configure the gateway

Write the real config file at the machine-local path, for example:

- Windows: `C:\Users\<user>\.codex-feishu-gateway\feishu_gateway.json`
- macOS: `$HOME/.codex-feishu-gateway/feishu_gateway.json`

Use `references/config.windows.example.json` as the base example for Windows.

Pay special attention to:

- `workspace`
- `codexBin`
- `groupSessionScope`
- `typingIndicator`
- `progressCommandUpdates`
- `mediaRoot`
- `codexArgs`

Keep `progressCommandUpdates = false` when the bot should only send progress/todo notes back to Feishu without echoing `Running command` or `Command finished` messages.

### 5. Verify in order

Verify in this order:

1. `auth-test`
2. foreground `watch`
3. `/status`
4. plain text message
5. inbound image or file
6. outbound `[feishu-attachment]` reply using an absolute path appropriate for the target OS

Do not jump directly to background autostart until the foreground flow works.

### 6. Automate startup per platform

On macOS, use `install_codex_feishu_launchagent.sh`.

On Windows, use `install_codex_feishu_task.ps1` with Task Scheduler.

If the user wants unattended recovery after power cuts, remind them that BIOS power restore, OS auto-login, and network auto-auth are separate prerequisites.

## Current behavior reference

The gateway supports:

- `im.message.receive_v1` via Feishu long connection
- chat-to-Codex session mapping
- `/status`, `/stop`, `/new`, `/reset`, `/help`
- inbound image/file download into `mediaRoot/inbound`
- outbound file/image sending through `[feishu-attachment] <absolute-path>`
- reaction-based processing indicator through `typingIndicator`

For planning flows, keep the plan card lifecycle consistent:

- an approval should patch the same card into a green execution-state card
- the execution-state card should not keep the old action buttons
- `/stop` should interrupt only the active run for that chat, not silently flush later queued requests

## Troubleshooting heuristics

If replies duplicate, check for duplicate gateway processes before changing session logic.

If group users share context unexpectedly, switch `groupSessionScope` to `group_sender`.

If attachments fail on Windows, verify that the reply path is a real Windows absolute path such as `C:\work\file.pdf`.

If the target machine cannot load the Feishu SDK, install `@larksuiteoapi/node-sdk` locally in the gateway directory first.

## Resources

Use these files as needed:

- `references/windows-migration.md`
- `references/config.windows.example.json`
