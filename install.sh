#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${CODEX_SELECTION_EXPLAINER_HOME:-$HOME/.local/share/codex-selection-explainer}"
APP_DIR="${CODEX_DESKTOP_APP_DIR:-$HOME/.local/share/codex-desktop}"
PORT="${CODEX_SELECTION_EXPLAINER_PORT:-34891}"
CDP_PORT="${CODEX_LINUX_DEV_TOOLS_PORT:-9222}"

if [ ! -x "$APP_DIR/start.sh" ]; then
  echo "Codex Desktop start.sh not found at $APP_DIR/start.sh" >&2
  exit 1
fi

if [ -n "${CODEX_CLI_PATH:-}" ]; then
  CODEX_PATH="$CODEX_CLI_PATH"
elif command -v codex >/dev/null 2>&1; then
  CODEX_PATH="$(command -v codex)"
else
  echo "Could not find Codex CLI. Set CODEX_CLI_PATH and run again." >&2
  exit 1
fi

mkdir -p "$DEST_DIR/src" "$DEST_DIR/assets" "$DEST_DIR/vendor/katex/fonts"
cp "$SOURCE_DIR/src/server.mjs" "$SOURCE_DIR/src/renderer.js" "$DEST_DIR/src/"
cp "$SOURCE_DIR/assets/icon.png" "$DEST_DIR/assets/" 2>/dev/null || true
cp "$SOURCE_DIR/vendor/katex/katex.min.js" \
  "$SOURCE_DIR/vendor/katex/katex.min.css" \
  "$SOURCE_DIR/vendor/katex/LICENSE" \
  "$DEST_DIR/vendor/katex/"
cp "$SOURCE_DIR"/vendor/katex/fonts/*.woff2 "$DEST_DIR/vendor/katex/fonts/"

if [ ! -f "$DEST_DIR/config.json" ]; then
  cat > "$DEST_DIR/config.json" <<EOF
{
  "codexPath": "$CODEX_PATH",
  "model": "",
  "timeoutMs": 120000,
  "workspaceDir": "$DEST_DIR/workspace"
}
EOF
fi

mkdir -p \
  "$APP_DIR/.codex-linux/env.d" \
  "$APP_DIR/.codex-linux/launcher.d" \
  "$APP_DIR/.codex-linux/after-exit.d"

cat > "$APP_DIR/.codex-linux/env.d/20-codex-selection-explainer" <<EOF
CODEX_LINUX_DEV_TOOLS=1
CODEX_LINUX_DEV_TOOLS_PORT=$CDP_PORT
EOF

cat > "$APP_DIR/.codex-linux/launcher.d/20-codex-selection-explainer" <<EOF
#!/usr/bin/env bash
set -euo pipefail

HELPER_DIR="\$HOME/.local/share/codex-selection-explainer"
HELPER_BIN="\$HELPER_DIR/src/server.mjs"
PID_FILE="\$HELPER_DIR/helper.pid"
CDP_PORT="\${CODEX_LINUX_DEV_TOOLS_PORT:-$CDP_PORT}"
NODE_BIN=""

port_is_free() {
  ( exec 3<>/dev/tcp/127.0.0.1/"\$1" ) 2>/dev/null && return 1 || return 0
}

if ! port_is_free "\$CDP_PORT"; then
  for candidate in 9223 9224 9225 9226 9227 9228 9229 9230 9231 9232 9233 9234 9235; do
    if port_is_free "\$candidate"; then
      CDP_PORT="\$candidate"
      break
    fi
  done
fi

if [ -x "\${CODEX_MANAGED_NODE_RUNTIME_DIR:-}/bin/node" ]; then
  NODE_BIN="\${CODEX_MANAGED_NODE_RUNTIME_DIR:-}/bin/node"
elif [ -x "\$HOME/.local/share/codex-desktop/resources/node-runtime/bin/node" ]; then
  NODE_BIN="\$HOME/.local/share/codex-desktop/resources/node-runtime/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="\$(command -v node)"
fi

if [ -z "\$NODE_BIN" ] || [ ! -f "\$HELPER_BIN" ]; then
  exit 0
fi

if [ -f "\$PID_FILE" ]; then
  OLD_PID="\$(cat "\$PID_FILE" 2>/dev/null || echo 0)"
  if [ "\$OLD_PID" != "0" ] && kill -0 "\$OLD_PID" 2>/dev/null; then
    if tr '\0' ' ' < "/proc/\$OLD_PID/cmdline" 2>/dev/null | grep -q -- "--cdp-port \$CDP_PORT"; then
      exit 0
    fi
    kill "\$OLD_PID" 2>/dev/null || true
  fi
  rm -f "\$PID_FILE"
fi

mkdir -p "\$HELPER_DIR"
nohup "\$NODE_BIN" "\$HELPER_BIN" \
  --port "$PORT" \
  --cdp-port "\$CDP_PORT" \
  --pid-file "\$PID_FILE" \
  > "\$HELPER_DIR/helper.log" 2>&1 &
disown || true
echo "env CODEX_LINUX_DEV_TOOLS_PORT=\$CDP_PORT"
EOF
chmod +x "$APP_DIR/.codex-linux/launcher.d/20-codex-selection-explainer"

cat > "$APP_DIR/.codex-linux/after-exit.d/20-codex-selection-explainer" <<EOF
#!/usr/bin/env bash
set -euo pipefail

PID_FILE="\$HOME/.local/share/codex-selection-explainer/helper.pid"
if [ -f "\$PID_FILE" ]; then
  PID="\$(cat "\$PID_FILE" 2>/dev/null || echo 0)"
  if [ "\$PID" != "0" ] && kill -0 "\$PID" 2>/dev/null; then
    kill "\$PID" 2>/dev/null || true
  fi
  rm -f "\$PID_FILE"
fi
EOF
chmod +x "$APP_DIR/.codex-linux/after-exit.d/20-codex-selection-explainer"

echo "Installed Codex Selection Explainer helper:"
echo "  helper: $DEST_DIR"
echo "  HTTP port: $PORT"
echo "  CDP port: $CDP_PORT"
echo "  Codex CLI: $CODEX_PATH"
echo
echo "Fully quit Codex Desktop and reopen it to enable the floating explainer."
