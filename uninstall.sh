#!/usr/bin/env bash
set -euo pipefail

DEST_DIR="${CODEX_SELECTION_EXPLAINER_HOME:-$HOME/.local/share/codex-selection-explainer}"
APP_DIR="${CODEX_DESKTOP_APP_DIR:-$HOME/.local/share/codex-desktop}"

if [ -f "$DEST_DIR/helper.pid" ]; then
  PID="$(cat "$DEST_DIR/helper.pid" 2>/dev/null || echo 0)"
  if [ "$PID" != "0" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
  fi
  rm -f "$DEST_DIR/helper.pid"
fi

rm -f \
  "$APP_DIR/.codex-linux/env.d/20-codex-selection-explainer" \
  "$APP_DIR/.codex-linux/launcher.d/20-codex-selection-explainer" \
  "$APP_DIR/.codex-linux/after-exit.d/20-codex-selection-explainer"

if [ "${1:-}" = "--purge" ]; then
  rm -rf "$DEST_DIR"
fi

echo "Uninstalled Codex Selection Explainer launcher hooks."
echo "Fully quit and reopen Codex Desktop to finish unloading."
