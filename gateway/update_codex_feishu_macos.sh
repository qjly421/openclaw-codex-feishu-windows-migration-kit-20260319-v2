#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This update script targets macOS (Darwin)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GATEWAY_ROOT="$SCRIPT_DIR"
CONFIG_PATH="${FEISHU_GATEWAY_CONFIG:-$HOME/.codex-feishu-gateway/feishu_gateway.json}"
TARGET_BRANCH=""
SKIP_PULL=0
SKIP_SKILL_SYNC=0
SKIP_LAUNCHAGENT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      shift
      TARGET_BRANCH="${1:-}"
      ;;
    --skip-pull)
      SKIP_PULL=1
      ;;
    --skip-skill-sync)
      SKIP_SKILL_SYNC=1
      ;;
    --skip-launchagent)
      SKIP_LAUNCHAGENT=1
      ;;
    --config-path)
      shift
      CONFIG_PATH="${1:-}"
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

if [[ $SKIP_PULL -eq 0 ]]; then
  if [[ ! -d "$REPO_ROOT/.git" ]]; then
    echo "This folder is not a git checkout: $REPO_ROOT" >&2
    echo "Either clone the repo on Mac, or rerun with --skip-pull." >&2
    exit 1
  fi
  if ! command -v git >/dev/null 2>&1; then
    echo "git is required for update pulls." >&2
    exit 1
  fi
  if [[ -z "$TARGET_BRANCH" ]]; then
    TARGET_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
  fi
  echo "Pulling latest changes from origin/$TARGET_BRANCH"
  git -C "$REPO_ROOT" fetch origin "$TARGET_BRANCH"
  git -C "$REPO_ROOT" pull --ff-only origin "$TARGET_BRANCH"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js 20+ first." >&2
  exit 1
fi

echo "Refreshing gateway dependencies"
(
  cd "$GATEWAY_ROOT"
  npm install
)

if [[ $SKIP_SKILL_SYNC -eq 0 ]]; then
  bash "$GATEWAY_ROOT/sync_public_skills.sh"
fi

if [[ $SKIP_LAUNCHAGENT -eq 0 ]]; then
  FEISHU_GATEWAY_CONFIG="$CONFIG_PATH" bash "$GATEWAY_ROOT/install_codex_feishu_launchagent.sh"
fi

cat <<EOF
Mac update finished.

Repo root: $REPO_ROOT
Config path: $CONFIG_PATH

If you need a foreground recheck, run:
node ./gateway/codex_feishu_gateway.mjs auth-test --config "$CONFIG_PATH"
EOF
