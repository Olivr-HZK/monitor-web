#!/usr/bin/env bash
#
# Install/refresh a macOS LaunchAgent for the named Cloudflare Tunnel used by
# api.gurublog.uk. The tunnel token is intentionally stored only in the local
# LaunchAgent plist, not in this repository.
#
# Token sources, in order:
#   1) MONITOR_CLOUDFLARED_TOKEN
#   2) currently running "cloudflared tunnel run --token ..." process

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="${MONITOR_TUNNEL_LABEL:-com.ggbond.monitor-web-cloudflared}"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DEST="$LAUNCH_AGENTS_DIR/${LABEL}.plist"
LOG_DIR="$REPO_ROOT/logs"
DOMAIN="gui/$(id -u)"

export PATH="${PATH:-}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

resolve_cloudflared() {
  if [[ -n "${MONITOR_CLOUDFLARED_BIN:-}" ]]; then
    printf '%s\n' "$MONITOR_CLOUDFLARED_BIN"
    return 0
  fi
  command -v cloudflared
}

discover_running_token() {
  /usr/bin/python3 - <<'PY'
import subprocess

try:
    out = subprocess.check_output(["ps", "-axo", "command"], text=True)
except Exception:
    raise SystemExit(1)

for line in out.splitlines():
    if "cloudflared" not in line or " tunnel run " not in line or "--token " not in line:
        continue
    token = line.split("--token ", 1)[1].strip().split()[0]
    if token:
        print(token)
        raise SystemExit(0)
raise SystemExit(1)
PY
}

CLOUDFLARED_BIN="$(resolve_cloudflared)"
if [[ ! -x "$CLOUDFLARED_BIN" ]]; then
  echo "cloudflared 不可执行：$CLOUDFLARED_BIN" >&2
  exit 1
fi

TOKEN="${MONITOR_CLOUDFLARED_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  TOKEN="$(discover_running_token || true)"
fi
if [[ -z "$TOKEN" ]]; then
  cat >&2 <<'ERR'
未找到 Cloudflare named tunnel token。
请设置 MONITOR_CLOUDFLARED_TOKEN 后重跑，或先手动启动一次：
  cloudflared tunnel run --token <token>
ERR
  exit 1
fi

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

PLIST_DEST="$DEST" \
PLIST_LABEL="$LABEL" \
PLIST_CLOUDFLARED_BIN="$CLOUDFLARED_BIN" \
PLIST_TOKEN="$TOKEN" \
PLIST_REPO_ROOT="$REPO_ROOT" \
/usr/bin/python3 - <<'PY'
from pathlib import Path
import os
import plistlib

dest = Path(os.environ["PLIST_DEST"])
repo = Path(os.environ["PLIST_REPO_ROOT"])
data = {
    "Label": os.environ["PLIST_LABEL"],
    "ProgramArguments": [
        os.environ["PLIST_CLOUDFLARED_BIN"],
        "tunnel",
        "run",
        "--token",
        os.environ["PLIST_TOKEN"],
    ],
    "RunAtLoad": True,
    "KeepAlive": True,
    "StandardOutPath": str(repo / "logs" / "cloudflared-api.out.log"),
    "StandardErrorPath": str(repo / "logs" / "cloudflared-api.err.log"),
    "EnvironmentVariables": {
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    },
}
dest.write_bytes(plistlib.dumps(data, sort_keys=False))
PY

chmod 600 "$DEST"
plutil -lint "$DEST" >/dev/null
launchctl bootout "$DOMAIN" "$DEST" >/dev/null 2>&1 || true
launchctl bootstrap "$DOMAIN" "$DEST"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo "已安装并启动 Cloudflare named tunnel LaunchAgent：$DEST"
echo "Label: $LABEL"
echo "cloudflared: $CLOUDFLARED_BIN"
launchctl list | awk -v label="$LABEL" '$3 == label {print "launchctl: " $0}'
