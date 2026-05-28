#!/usr/bin/env bash
#
# Small log rotation helper for monitor-web LaunchAgent logs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$REPO_ROOT/logs"
MAX_MB="${MONITOR_LOG_MAX_MB:-20}"
KEEP_DAYS="${MONITOR_LOG_KEEP_DAYS:-30}"

[[ "$MAX_MB" =~ ^[0-9]+$ && "$MAX_MB" -ge 1 ]] || MAX_MB=20
[[ "$KEEP_DAYS" =~ ^[0-9]+$ && "$KEEP_DAYS" -ge 1 ]] || KEEP_DAYS=30

mkdir -p "$LOG_DIR"

file_size_bytes() {
  stat -f "%z" "$1" 2>/dev/null || stat -c "%s" "$1" 2>/dev/null || echo 0
}

rotate_one() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local size max_bytes rotated
  size="$(file_size_bytes "$file")"
  max_bytes=$((MAX_MB * 1024 * 1024))
  [[ "$size" -gt "$max_bytes" ]] || return 0
  rotated="${file}.$(date +%Y%m%d_%H%M%S)"
  mv "$file" "$rotated"
  : > "$file"
  gzip -f "$rotated" 2>/dev/null || true
  echo "[rotate] $file -> ${rotated}.gz"
}

for file in \
  "$LOG_DIR/backend-api.out.log" \
  "$LOG_DIR/backend-api.err.log" \
  "$LOG_DIR/cloudflared-api.out.log" \
  "$LOG_DIR/cloudflared-api.err.log" \
  "$LOG_DIR/monitor_web_watchdog.out.log" \
  "$LOG_DIR/monitor_web_watchdog.err.log" \
  "$LOG_DIR/sync_dbs_cron.log"; do
  rotate_one "$file"
done

find "$LOG_DIR" -type f \( -name '*.log.*.gz' -o -name '*.log.*' \) -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
