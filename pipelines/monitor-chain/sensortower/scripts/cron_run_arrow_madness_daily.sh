#!/usr/bin/env bash
# 供 crontab 调用：补齐 PATH，日志追加到 logs/arrow_madness_daily_competitors.log
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONITOR_WEB_ROOT="$(cd "$ROOT/../../.." && pwd)"
export US_FREE_APPID_WEEKLY_DB="${US_FREE_APPID_WEEKLY_DB:-$MONITOR_WEB_ROOT/data/databases/us_free_appid_weekly.db}"
export APPID_US_COMPETITORS_DB="${APPID_US_COMPETITORS_DB:-$US_FREE_APPID_WEEKLY_DB}"
export SENSORTOWER_APPID_US_JSON="${SENSORTOWER_APPID_US_JSON:-$ROOT/resources/appid_us.json}"
LOG="${SENSORTOWER_ARROW_MADNESS_DAILY_CRON_LOG:-$MONITOR_WEB_ROOT/logs/sensortower_arrow_madness_daily.log}"
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
NODE_BIN="${SENSORTOWER_NODE:-}"
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "[cron_run_arrow_madness_daily] 错误: 未找到可执行的 node。请安装 Node 或设置 SENSORTOWER_NODE=/path/to/node"
  exit 127
fi
exec "$NODE_BIN" "$ROOT/scripts/arrow_madness_daily_competitors.js"
