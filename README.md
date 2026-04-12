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
- `skills/long-task-orchestrator`

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
