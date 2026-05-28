#!/usr/bin/env bash
#
# Install/refresh the monitor-web watchdog LaunchAgent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="${MONITOR_WATCHDOG_LABEL:-com.ggbond.monitor-web-watchdog}"
INTERVAL="${MONITOR_WATCHDOG_INTERVAL:-300}"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DEST="$LAUNCH_AGENTS_DIR/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

if [[ ! "$INTERVAL" =~ ^[0-9]+$ || "$INTERVAL" -lt 60 ]]; then
  echo "MONITOR_WATCHDOG_INTERVAL 必须是 >=60 的秒数，当前：$INTERVAL" >&2
  exit 1
fi

mkdir -p "$LAUNCH_AGENTS_DIR" "$REPO_ROOT/logs"

PLIST_DEST="$DEST" \
PLIST_LABEL="$LABEL" \
PLIST_REPO_ROOT="$REPO_ROOT" \
PLIST_INTERVAL="$INTERVAL" \
/usr/bin/python3 - <<'PY'
from pathlib import Path
import os
import plistlib

dest = Path(os.environ["PLIST_DEST"])
repo = Path(os.environ["PLIST_REPO_ROOT"])
data = {
    "Label": os.environ["PLIST_LABEL"],
    "ProgramArguments": [str(repo / "scripts" / "ops" / "monitor_web_watchdog.sh")],
    "WorkingDirectory": str(repo),
    "RunAtLoad": True,
    "StartInterval": int(os.environ["PLIST_INTERVAL"]),
    "StandardOutPath": str(repo / "logs" / "monitor_web_watchdog.out.log"),
    "StandardErrorPath": str(repo / "logs" / "monitor_web_watchdog.err.log"),
    "EnvironmentVariables": {
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        "PYTHONUNBUFFERED": "1",
    },
}
dest.write_bytes(plistlib.dumps(data, sort_keys=False))
PY

chmod 644 "$DEST"
plutil -lint "$DEST" >/dev/null
launchctl bootout "$DOMAIN" "$DEST" >/dev/null 2>&1 || true
launchctl bootstrap "$DOMAIN" "$DEST"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo "已安装并启动 monitor-web watchdog LaunchAgent：$DEST"
echo "Label: $LABEL"
echo "Interval: ${INTERVAL}s"
launchctl print "$DOMAIN/$LABEL" | sed -n '1,35p'
