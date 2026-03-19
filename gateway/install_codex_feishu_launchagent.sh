#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="${FEISHU_GATEWAY_LABEL:-com.example.codex.feishu-gateway}"
RUNTIME_ROOT="${FEISHU_GATEWAY_RUNTIME_ROOT:-$HOME/.codex-feishu-gateway}"
RUNTIME_DIR="$RUNTIME_ROOT/runtime"
LOG_DIR="$RUNTIME_ROOT/log"
CONFIG_PATH="${FEISHU_GATEWAY_CONFIG:-$RUNTIME_ROOT/feishu_gateway.json}"
REPO_GATEWAY_SCRIPT="${CODEX_FEISHU_GATEWAY_SCRIPT:-$SCRIPT_DIR/codex_feishu_gateway.mjs}"
RUNTIME_GATEWAY_SCRIPT="$RUNTIME_DIR/codex_feishu_gateway.mjs"
RUNTIME_RUNNER="$RUNTIME_DIR/run_codex_feishu_gateway.sh"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_VALUE="$(id -u)"

mkdir -p "$HOME/Library/LaunchAgents" "$RUNTIME_DIR" "$LOG_DIR"
cp "$REPO_GATEWAY_SCRIPT" "$RUNTIME_GATEWAY_SCRIPT"
chmod 755 "$RUNTIME_GATEWAY_SCRIPT"

cat > "$RUNTIME_RUNNER" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  NODE_BIN="/opt/homebrew/bin/node"
fi
export FEISHU_GATEWAY_CONFIG="$CONFIG_PATH"
exec "$NODE_BIN" "$RUNTIME_GATEWAY_SCRIPT" watch --config "$CONFIG_PATH"
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
  <string>${HOME}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${HOME}</string>
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
