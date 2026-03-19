#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node 2>/dev/null || echo /opt/homebrew/bin/node)}"
GATEWAY_SCRIPT="${CODEX_FEISHU_GATEWAY_SCRIPT:-$SCRIPT_DIR/codex_feishu_gateway.mjs}"
CONFIG_PATH="${FEISHU_GATEWAY_CONFIG:-$HOME/.codex-feishu-gateway/feishu_gateway.json}"

exec "$NODE_BIN" "$GATEWAY_SCRIPT" watch --config "$CONFIG_PATH"
