#!/usr/bin/env bash
#
# 安装/刷新本机 monitor-web FastAPI 的 macOS LaunchAgent。
#
# 用法：
#   ./scripts/install_monitor_web_api_launchagent.sh
#   MONITOR_API_PORT=3001 MONITOR_API_LABEL=com.ggbond.monitor-web-api ./scripts/install_monitor_web_api_launchagent.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/launchd/com.ggbond.monitor-web-api.plist.template"
LABEL="${MONITOR_API_LABEL:-com.ggbond.monitor-web-api}"
PORT="${MONITOR_API_PORT:-3001}"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DEST="$LAUNCH_AGENTS_DIR/${LABEL}.plist"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "未找到模板：$TEMPLATE" >&2
  exit 1
fi

if [[ -n "${MONITOR_API_PYTHON_BIN:-}" ]]; then
  PYTHON_BIN="$MONITOR_API_PYTHON_BIN"
elif [[ -x "$REPO_ROOT/backend/.venv/bin/python" ]]; then
  PYTHON_BIN="$REPO_ROOT/backend/.venv/bin/python"
elif [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
  PYTHON_BIN="$REPO_ROOT/.venv/bin/python"
else
  PYTHON_BIN="$(command -v python3)"
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python 不可执行：$PYTHON_BIN" >&2
  exit 1
fi

mkdir -p "$LAUNCH_AGENTS_DIR" "$REPO_ROOT/logs"

tmp="$(mktemp)"
sed \
  -e "s|__LABEL__|$LABEL|g" \
  -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
  -e "s|__PYTHON_BIN__|$PYTHON_BIN|g" \
  -e "s|__PORT__|$PORT|g" \
  "$TEMPLATE" > "$tmp"

plutil -lint "$tmp" >/dev/null
cp "$tmp" "$DEST"
rm -f "$tmp"

domain="gui/$(id -u)"
launchctl bootout "$domain" "$DEST" >/dev/null 2>&1 || true
launchctl bootstrap "$domain" "$DEST"
launchctl kickstart -k "$domain/$LABEL"

echo "已安装并启动 LaunchAgent：$DEST"
echo "Label: $LABEL"
echo "Python: $PYTHON_BIN"
echo "Port: $PORT"
launchctl print "$domain/$LABEL" | sed -n '1,40p'
