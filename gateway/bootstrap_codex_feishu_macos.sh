#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This bootstrap script targets macOS (Darwin)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GATEWAY_ROOT="$SCRIPT_DIR"
RUNTIME_ROOT="${FEISHU_GATEWAY_RUNTIME_ROOT:-$HOME/.codex-feishu-gateway}"
CONFIG_PATH="${FEISHU_GATEWAY_CONFIG:-$RUNTIME_ROOT/feishu_gateway.json}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
LEGACY_CONFIG_PATH="${FEISHU_GATEWAY_LEGACY_CONFIG:-$CODEX_HOME/feishu_gateway.json}"
LEGACY_STATE_PATH="${FEISHU_GATEWAY_LEGACY_STATE:-$CODEX_HOME/feishu_gateway_state.json}"
LEGACY_MEDIA_ROOT="${FEISHU_GATEWAY_LEGACY_MEDIA_ROOT:-$CODEX_HOME/feishu_media}"
MAC_TEMPLATE_PATH="$GATEWAY_ROOT/feishu_gateway.example.macos.json"
INSTALL_LAUNCHAGENT=1
SYNC_SKILLS=1
RUN_AUTH_TEST=0
CONFIG_PATH_SET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-launchagent)
      INSTALL_LAUNCHAGENT=0
      ;;
    --skip-skill-sync)
      SYNC_SKILLS=0
      ;;
    --run-auth-test)
      RUN_AUTH_TEST=1
      ;;
    --config-path)
      shift
      CONFIG_PATH="${1:-}"
      CONFIG_PATH_SET=1
      ;;
    --runtime-root)
      shift
      RUNTIME_ROOT="${1:-}"
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

if [[ $CONFIG_PATH_SET -eq 0 ]]; then
  CONFIG_PATH="$RUNTIME_ROOT/feishu_gateway.json"
fi

create_default_macos_config() {
  local output_path="$1"
  node - "$MAC_TEMPLATE_PATH" "$output_path" "$REPO_ROOT" "$CODEX_HOME" "$RUNTIME_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const [, , templatePath, outputPath, repoRoot, codexHome, runtimeRoot] = process.argv;
const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
template.workspace = repoRoot;
template.codexSessionsRoot = path.join(codexHome, 'sessions');
template.stateFile = path.join(runtimeRoot, 'feishu_gateway_state.json');
template.usageLedgerFile = path.join(runtimeRoot, 'feishu_usage_ledger.jsonl');
template.mediaRoot = path.join(runtimeRoot, 'media');
template.startupNotifyChatIds = [];
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(template, null, 2));
NODE
}

migrate_legacy_macos_config() {
  local output_path="$1"
  node - "$MAC_TEMPLATE_PATH" "$LEGACY_CONFIG_PATH" "$output_path" "$REPO_ROOT" "$CODEX_HOME" "$RUNTIME_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const [, , templatePath, legacyPath, outputPath, repoRoot, codexHome, runtimeRoot] = process.argv;
const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
const merged = {
  ...template,
  ...legacy,
  workspace: legacy.workspace || repoRoot,
  codexBin: legacy.codexBin || template.codexBin,
  codexSessionsRoot: legacy.codexSessionsRoot || path.join(codexHome, 'sessions'),
  stateFile: legacy.stateFile || path.join(runtimeRoot, 'feishu_gateway_state.json'),
  usageLedgerFile: legacy.usageLedgerFile || path.join(runtimeRoot, 'feishu_usage_ledger.jsonl'),
  mediaRoot: legacy.mediaRoot || path.join(runtimeRoot, 'media'),
  startupNotifyChatIds: Array.isArray(legacy.startupNotifyChatIds) ? legacy.startupNotifyChatIds : [],
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2));
NODE
}

migrate_legacy_runtime_artifacts() {
  local target_state_file="$RUNTIME_ROOT/feishu_gateway_state.json"
  local target_media_root="$RUNTIME_ROOT/media"

  if [[ -f "$LEGACY_STATE_PATH" && ! -f "$target_state_file" ]]; then
    cp "$LEGACY_STATE_PATH" "$target_state_file"
    echo "Copied legacy state into: $target_state_file"
  fi

  if [[ -d "$LEGACY_MEDIA_ROOT" && ! -d "$target_media_root" ]]; then
    mkdir -p "$target_media_root"
    cp -R "$LEGACY_MEDIA_ROOT"/. "$target_media_root"/
    echo "Copied legacy media into: $target_media_root"
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 20+ first." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js 20+ first." >&2
  exit 1
fi

CONFIG_DIR="$(dirname "$CONFIG_PATH")"
mkdir -p "$RUNTIME_ROOT" "$RUNTIME_ROOT/runtime" "$RUNTIME_ROOT/log" "$CONFIG_DIR" "$CODEX_HOME/skills"

if [[ ! -f "$CONFIG_PATH" ]]; then
  if [[ -f "$LEGACY_CONFIG_PATH" ]]; then
    migrate_legacy_macos_config "$CONFIG_PATH"
    echo "Migrated legacy macOS config into: $CONFIG_PATH"
    migrate_legacy_runtime_artifacts
  else
    create_default_macos_config "$CONFIG_PATH"
    echo "Created macOS config template: $CONFIG_PATH"
  fi
else
  echo "Keeping existing config: $CONFIG_PATH"
fi

echo "Installing gateway dependencies in $GATEWAY_ROOT"
(
  cd "$GATEWAY_ROOT"
  npm install
)

if [[ $SYNC_SKILLS -eq 1 ]]; then
  bash "$GATEWAY_ROOT/sync_public_skills.sh"
fi

if [[ $RUN_AUTH_TEST -eq 1 ]]; then
  echo "Running auth-test with config: $CONFIG_PATH"
  (
    cd "$GATEWAY_ROOT"
    node ./codex_feishu_gateway.mjs auth-test --config "$CONFIG_PATH"
  )
fi

if command -v codex >/dev/null 2>&1; then
  echo "Detected codex in PATH: $(command -v codex)"
else
  echo "codex was not found in PATH. Set codexBin in your config if needed."
fi

if [[ $INSTALL_LAUNCHAGENT -eq 1 ]]; then
  FEISHU_GATEWAY_CONFIG="$CONFIG_PATH" bash "$GATEWAY_ROOT/install_codex_feishu_launchagent.sh"
fi

cat <<EOF
Mac bootstrap finished.

Repo root: $REPO_ROOT
Gateway root: $GATEWAY_ROOT
Config path: $CONFIG_PATH
Codex home: $CODEX_HOME

Next steps:
1. Edit $CONFIG_PATH with your real Feishu app values.
2. If you skipped auth-test, run:
   node ./gateway/codex_feishu_gateway.mjs auth-test --config "$CONFIG_PATH"
3. Foreground validation:
   bash ./gateway/run_codex_feishu_gateway.sh
4. Future updates on Mac:
   bash ./gateway/update_codex_feishu_macos.sh
EOF
