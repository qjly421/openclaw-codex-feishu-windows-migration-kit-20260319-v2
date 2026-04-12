# Codex Feishu Framework

This repository is the public framework layer for running a local Feishu-to-Codex gateway, sharing reusable Codex skills, and keeping multi-device deployment patterns in one place.

It has evolved from a one-off Windows migration kit into a maintainable public framework for:

- Feishu + Codex gateway runtime and operations
- reusable public Codex skills
- Windows and macOS deployment helpers
- a clean public/private repository split for future private research work

## What Is Included

- `gateway/`
  - Feishu gateway source
  - startup scripts
  - health checks
  - operational helpers
  - usage reporting utilities
- `skills/`
  - public skills that can be copied into a Codex skill directory
- `docs/`
  - architecture
  - sync workflow
  - deployment notes
  - public/private boundary guidance
- `templates/`
  - a starter structure for a companion private repository

## Quick Start

### Gateway

1. Install Node.js LTS.
2. Enter `gateway/`.
3. Run `npm install`.
4. Copy `feishu_gateway.example.json` into a real local config file.
5. Verify auth with:

```bash
node ./codex_feishu_gateway.mjs auth-test --config <config-path>
```

6. Start the gateway:

```bash
node ./codex_feishu_gateway.mjs watch --config <config-path>
```

### Skills

Copy the directories under `skills/` into your local Codex skills directory:

- macOS: `~/.codex/skills/`
- Windows: `%USERPROFILE%\.codex\skills\`

Recommended starting skills:

- `skills/codex-feishu-gateway`
- `skills/feishu-doc-writer`
- `skills/github-repo-sync`
- `skills/long-task-orchestrator`

## Updating An Existing Machine

Use this section when a machine is already running the gateway and you want to update it in place without re-reading the whole repo.

### 1. Pull the latest framework

If the machine runs directly from this repository:

```bash
git pull --ff-only origin main
```

If the machine runs from a copied gateway directory instead of a git checkout, re-sync these directories from the latest repo snapshot:

- `gateway/`
- `skills/`

### 2. Refresh dependencies only if needed

If `gateway/package.json` or `gateway/package-lock.json` changed, run:

```bash
cd gateway
npm install
```

If those files did not change, you usually do not need to reinstall Node dependencies.

### 3. Review config changes without overwriting secrets

Compare your real machine-local config against:

- `gateway/feishu_gateway.example.json`
- `gateway/README-codex-feishu-gateway.md`
- `gateway/README-codex-feishu-windows.md`

Do not replace your real config file blindly. Copy only the new keys or behavioral changes you want.

Current high-signal update points:

- `progressCommandUpdates = false`
  - keeps Feishu progress updates enabled
  - suppresses `Running command` and `Command finished` chat noise
- `/stop`
  - interrupts only the currently running task for that chat
  - does not automatically flush later queued messages
- planning card approval flow
  - after approval starts, the existing plan card should patch into a green execution-state card
  - the green execution-state card should no longer show the old action buttons

### 4. Re-copy public skills if that machine uses local skill copies

If another machine copied skills into a local Codex skill directory, refresh at least:

- `skills/codex-feishu-gateway`

Also refresh any other skills you actively use from this repo.

### 5. Restart only during an idle window

Code and config changes do not affect an already-running gateway process until it is restarted.

If the machine uses:

- Windows Task Scheduler
  - restart the running gateway process or rerun the scheduled task during an idle window
- macOS `launchd`
  - restart the LaunchAgent during an idle window
- foreground `watch`
  - stop the old process and start `watch` again

If the install path did not change, you usually do not need to reinstall the scheduled task or LaunchAgent.

### 6. Verify after restart

Minimum verification checklist:

1. `/status`
2. `/progress`
3. send a task that enters planning mode
4. approve the plan and confirm the existing card turns green
5. confirm the green execution-state card no longer shows the old action buttons
6. run a long task and test `/stop`
7. confirm later queued messages still run in order
8. confirm Feishu now shows progress updates without command echo if `progressCommandUpdates = false`

## Repository Positioning

Use this repository for public-safe materials:

- gateway code
- reusable skills
- sanitized config examples
- deployment docs
- architecture notes
- agent sync rules

Keep private research code, sensitive configs, and task-specific internal workflows in a separate private companion repository.

## Main Documentation

- `README-ZH.md`
- `docs/ARCHITECTURE-ZH.md`
- `docs/AGENT-SYNC-WORKFLOW-ZH.md`
- `docs/PUBLIC-PRIVATE-BOUNDARY-ZH.md`
- `docs/WINDOWS-3090-DEPLOYMENT-ZH.md`

## Naming Note

The repository slug still reflects its migration-kit history, but the project should now be treated as **Codex Feishu Framework**.
