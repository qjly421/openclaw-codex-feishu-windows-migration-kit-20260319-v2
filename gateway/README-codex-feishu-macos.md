# Codex Feishu Gateway on macOS

This guide explains how to run the public Feishu gateway framework on a Mac and keep it updated from the repository.

## Recommended layout

- Repo root: `~/openclaw-codex-feishu-framework`
- Gateway folder: `~/openclaw-codex-feishu-framework/gateway`
- Config file: `~/.codex-feishu-gateway/feishu_gateway.json`
- Runtime logs and media: under `~/.codex-feishu-gateway/`
- Public skills: `~/.codex/skills/`

## Required software

- macOS with a regular logged-in user session
- Node.js 20+
- Codex CLI available as `codex`, or an explicit `codexBin` path in the config
- Git if you want `git pull` based updates on the Mac

## Install steps

### 1. Get the repository onto the Mac

Either clone the public repository or copy the upgraded package to the Mac.

Recommended:

```bash
git clone <your-public-repo-url> ~/openclaw-codex-feishu-framework
cd ~/openclaw-codex-feishu-framework
```

### 2. Run the Mac bootstrap

From the repo root:

```bash
bash ./gateway/bootstrap_codex_feishu_macos.sh
```

What it does:

- runs `npm install` in `gateway/`
- copies public skills into `~/.codex/skills/`
- creates `~/.codex-feishu-gateway/feishu_gateway.json` with Mac-friendly paths if it does not exist
- if it finds a legacy `~/.codex/feishu_gateway.json`, it migrates that config into the new runtime root and copies the old state/media forward
- installs or refreshes the macOS `launchd` agent

If you want to install manually first without background startup:

```bash
bash ./gateway/bootstrap_codex_feishu_macos.sh --skip-launchagent
```

### 3. Fill the real config

Edit:

- `~/.codex-feishu-gateway/feishu_gateway.json`

At minimum, review these fields:

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

If you want a static reference file for Mac, start from:

- `gateway/feishu_gateway.example.macos.json`

### 4. Verify in foreground first

From the repo root:

```bash
node ./gateway/codex_feishu_gateway.mjs auth-test --config ~/.codex-feishu-gateway/feishu_gateway.json
bash ./gateway/run_codex_feishu_gateway.sh
```

Then test in Feishu:

- `/status`
- a plain text message
- an image or file attachment
- a reply that contains `[feishu-attachment] /absolute/path/to/file.pdf`

## Auto-start with launchd

The bootstrap script installs a user `LaunchAgent` by default.

Manual reinstall command:

```bash
FEISHU_GATEWAY_CONFIG="$HOME/.codex-feishu-gateway/feishu_gateway.json" \
  bash ./gateway/install_codex_feishu_launchagent.sh
```

What it does:

- keeps the gateway tied to the repository checkout instead of copying a partial runtime
- uses the repo-local `node_modules`
- writes logs to `~/.codex-feishu-gateway/log/`
- restarts the agent after reinstall
- can unload older LaunchAgent labels first if you export `FEISHU_GATEWAY_LEGACY_LABELS="old.label.one,old.label.two"`

Runtime files:

- `~/.codex-feishu-gateway/log/gateway.out.log`
- `~/.codex-feishu-gateway/log/gateway.err.log`
- `~/.codex-feishu-gateway/runtime/run_codex_feishu_gateway.sh`

If you move the repository to a new path on the Mac, rerun the bootstrap or launchagent installer.

## Updating on the Mac

From the repo root:

```bash
bash ./gateway/update_codex_feishu_macos.sh
```

What it does:

- `git fetch` + `git pull --ff-only`
- refreshes `gateway/node_modules`
- resyncs public skills into `~/.codex/skills/`
- reinstalls the `launchd` agent

If your Mac was still on the old `~/.codex/feishu_gateway.json` layout, run the bootstrap once before the normal update flow so the config and runtime files move into `~/.codex-feishu-gateway/`.

Useful variants:

```bash
bash ./gateway/update_codex_feishu_macos.sh --skip-launchagent
bash ./gateway/update_codex_feishu_macos.sh --skip-pull
```

## Common issues

### Node exists in Terminal but launchd cannot find it

The installer already tries the common Homebrew paths:

- `/opt/homebrew/bin/node`
- `/usr/local/bin/node`

If you use a custom Node location, export it before reinstalling:

```bash
export FEISHU_GATEWAY_NODE_BIN="/custom/path/to/node"
bash ./gateway/install_codex_feishu_launchagent.sh
```

### Codex is not found by the gateway

Either:

- make sure `codex` is in the login-shell PATH used on the Mac
- or set `codexBin` in `~/.codex-feishu-gateway/feishu_gateway.json`

### Skills did not update

Rerun:

```bash
bash ./gateway/sync_public_skills.sh
```

Then confirm the skills exist under:

- `~/.codex/skills/`

## Recovery advice

For an unattended Mac workstation, also consider:

1. auto-login only if your security model allows it
2. remote access such as Tailscale + macOS Screen Sharing or RustDesk
3. power settings that avoid sleep during gateway service hours
