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
  cp "$GATEWAY_ROOT/feishu_gateway.example.json" "$CONFIG_PATH"
  echo "Created config template: $CONFIG_PATH"
else
  echo "Keeping existing config: $CONFIG_PATH"
fi

echo "Installing gateway dependencies in $GATEWAY_ROOT"
(
  cd "$GATEWAY_ROOT"
  npm install
)

if [[ $SYNC_SKILLS -eq 1 ]]; then
  "$GATEWAY_ROOT/sync_public_skills.sh"
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
  FEISHU_GATEWAY_CONFIG="$CONFIG_PATH" "$GATEWAY_ROOT/install_codex_feishu_launchagent.sh"
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
