#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="${FEISHU_GATEWAY_LABEL:-com.openclaw.codex-feishu-gateway}"
LEGACY_LABELS_RAW="${FEISHU_GATEWAY_LEGACY_LABELS:-}"
RUNTIME_ROOT="${FEISHU_GATEWAY_RUNTIME_ROOT:-$HOME/.codex-feishu-gateway}"
RUNTIME_DIR="$RUNTIME_ROOT/runtime"
LOG_DIR="$RUNTIME_ROOT/log"
CONFIG_PATH="${FEISHU_GATEWAY_CONFIG:-$RUNTIME_ROOT/feishu_gateway.json}"
REPO_GATEWAY_ROOT="${CODEX_FEISHU_GATEWAY_ROOT:-$SCRIPT_DIR}"
REPO_GATEWAY_SCRIPT="${CODEX_FEISHU_GATEWAY_SCRIPT:-$REPO_GATEWAY_ROOT/codex_feishu_gateway.mjs}"
PACKAGE_JSON="${CODEX_FEISHU_GATEWAY_PACKAGE_JSON:-$REPO_GATEWAY_ROOT/package.json}"
RUNTIME_RUNNER="$RUNTIME_DIR/run_codex_feishu_gateway.sh"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_VALUE="$(id -u)"

mkdir -p "$HOME/Library/LaunchAgents" "$RUNTIME_DIR" "$LOG_DIR"

unload_legacy_launchagents() {
  local raw="$1"
  local item=""
  raw="${raw//,/ }"
  for item in $raw; do
    [[ -z "$item" ]] && continue
    launchctl bootout "gui/${UID_VALUE}/${item}" >/dev/null 2>&1 || true
    rm -f "$HOME/Library/LaunchAgents/${item}.plist"
    echo "Removed legacy LaunchAgent label: $item"
  done
}

if [[ ! -f "$REPO_GATEWAY_SCRIPT" ]]; then
  echo "Gateway script not found: $REPO_GATEWAY_SCRIPT" >&2
  exit 1
fi

if [[ ! -f "$PACKAGE_JSON" ]]; then
  echo "Gateway package.json not found: $PACKAGE_JSON" >&2
  exit 1
fi

if [[ ! -d "$REPO_GATEWAY_ROOT/node_modules/@larksuiteoapi/node-sdk" ]]; then
  echo "Gateway dependencies are missing under $REPO_GATEWAY_ROOT/node_modules." >&2
  echo "Run ./bootstrap_codex_feishu_macos.sh first." >&2
  exit 1
fi

if [[ -n "$LEGACY_LABELS_RAW" ]]; then
  unload_legacy_launchagents "$LEGACY_LABELS_RAW"
fi

cat > "$RUNTIME_RUNNER" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail

NODE_CANDIDATES=(
  "\${FEISHU_GATEWAY_NODE_BIN:-}"
  "\$(command -v node 2>/dev/null || true)"
  "/opt/homebrew/bin/node"
  "/usr/local/bin/node"
)
NODE_BIN=""
for candidate in "\${NODE_CANDIDATES[@]}"; do
  if [[ -n "\$candidate" && -x "\$candidate" ]]; then
    NODE_BIN="\$candidate"
    break
  fi
done
if [[ -z "\$NODE_BIN" ]]; then
  echo "Node.js executable not found for launchd runner." >&2
  exit 1
fi

export PATH="${HOME}/.local/bin:${HOME}/.npm-global/bin:${HOME}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export FEISHU_GATEWAY_CONFIG="$CONFIG_PATH"
export FEISHU_GATEWAY_RUNTIME_ROOT="$RUNTIME_ROOT"
export CODEX_HOME="\${CODEX_HOME:-$HOME/.codex}"

cd "$REPO_GATEWAY_ROOT"
exec "\$NODE_BIN" "$REPO_GATEWAY_SCRIPT" watch --config "$CONFIG_PATH"
RUNNER
chmod 755 "$RUNTIME_RUNNER"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${RUNTIME_RUNNER}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_GATEWAY_ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${HOME}/.local/bin:${HOME}/.npm-global/bin:${HOME}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>CODEX_HOME</key>
    <string>${HOME}/.codex</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/gateway.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/gateway.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/${UID_VALUE}/${LABEL}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${UID_VALUE}" "$PLIST"
launchctl kickstart -k "gui/${UID_VALUE}/${LABEL}"
launchctl print "gui/${UID_VALUE}/${LABEL}" | sed -n '1,60p'
