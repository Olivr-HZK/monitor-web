#!/usr/bin/env bash
# 供 crontab 调用：cron 环境无 login shell，PATH 极短，此处补齐常见路径后再启动 Node。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONITOR_WEB_ROOT="$(cd "$ROOT/../../.." && pwd)"
export US_FREE_APPID_WEEKLY_DB="${US_FREE_APPID_WEEKLY_DB:-$MONITOR_WEB_ROOT/data/databases/us_free_appid_weekly.db}"
export APPID_US_COMPETITORS_DB="${APPID_US_COMPETITORS_DB:-$US_FREE_APPID_WEEKLY_DB}"
export SENSORTOWER_APPID_US_JSON="${SENSORTOWER_APPID_US_JSON:-$ROOT/resources/appid_us.json}"
export SENSORTOWER_DB_BACKUP_DIR="${SENSORTOWER_DB_BACKUP_DIR:-$MONITOR_WEB_ROOT/backups/db/sensortower}"
LOG="${SENSORTOWER_US_FREE_DAILY_CRON_LOG:-$MONITOR_WEB_ROOT/logs/sensortower_us_free_daily.log}"
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
NODE_BIN="${SENSORTOWER_NODE:-}"
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "[cron_run_us_free_daily] 错误: 未找到可执行的 node。请安装 Node 或设置 SENSORTOWER_NODE=/path/to/node"
  exit 127
fi

SQLITE_BIN="${SQLITE_BIN:-$(command -v sqlite3 2>/dev/null || true)}"
if [[ -z "$SQLITE_BIN" || ! -x "$SQLITE_BIN" ]]; then
  echo "[cron_run_us_free_daily] 错误: 未找到 sqlite3，无法校验写库结果"
  exit 127
fi

calendar_yesterday() {
  "$NODE_BIN" -e '
const tz = process.env.US_FREE_DAILY_CALENDAR_TZ || "Asia/Shanghai";
const now = new Date();
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: tz,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(now).reduce((acc, p) => {
  if (p.type !== "literal") acc[p.type] = p.value;
  return acc;
}, {});
const d = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
d.setUTCDate(d.getUTCDate() - 1);
const y = d.getUTCFullYear();
const m = String(d.getUTCMonth() + 1).padStart(2, "0");
const day = String(d.getUTCDate()).padStart(2, "0");
console.log(`${y}-${m}-${day}`);
'
}

validate_us_free_db() {
  local db="$US_FREE_APPID_WEEKLY_DB"
  local target_date="${SENSORTOWER_US_FREE_DAILY_DATE_TO:-$(calendar_yesterday)}"
  if [[ ! "$target_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "[cron_run_us_free_daily] 校验失败: 非法目标日期 $target_date"
    return 1
  fi
  if [[ ! -f "$db" ]]; then
    echo "[cron_run_us_free_daily] 校验失败: 数据库不存在 $db"
    return 1
  fi
  local quick_check rank_count summary_count
  quick_check="$("$SQLITE_BIN" "$db" 'PRAGMA quick_check;' 2>/dev/null || true)"
  if [[ "$quick_check" != "ok" ]]; then
    echo "[cron_run_us_free_daily] 校验失败: SQLite quick_check=$quick_check"
    return 1
  fi
  rank_count="$("$SQLITE_BIN" "$db" "SELECT COUNT(*) FROM app_ranks WHERE country = 'US' AND rank_date = '$target_date';" 2>/dev/null || echo 0)"
  summary_count="$("$SQLITE_BIN" "$db" "SELECT COUNT(*) FROM weekly_summaries WHERE date_to = '$target_date';" 2>/dev/null || echo 0)"
  if [[ "${rank_count:-0}" -le 0 || "${summary_count:-0}" -le 0 ]]; then
    echo "[cron_run_us_free_daily] 校验失败: app_ranks[$target_date]=$rank_count, weekly_summaries[$target_date]=$summary_count"
    return 1
  fi
  echo "[cron_run_us_free_daily] 校验通过: app_ranks[$target_date]=$rank_count, weekly_summaries[$target_date]=$summary_count"
}

ATTEMPTS="${SENSORTOWER_US_FREE_DAILY_ATTEMPTS:-3}"
RETRY_SLEEP="${SENSORTOWER_US_FREE_DAILY_RETRY_SLEEP:-180}"
status=0
attempt=1
while [[ "$attempt" -le "$ATTEMPTS" ]]; do
  echo "[cron_run_us_free_daily] 第 ${attempt}/${ATTEMPTS} 次执行 us_free_appid_weekly_rank_changes.js"
  status=0
  "$NODE_BIN" "$ROOT/scripts/us_free_appid_weekly_rank_changes.js" --daily --no-competitors || status=$?
  if [[ "$status" -eq 0 ]]; then
    validate_us_free_db || status=$?
  fi
  if [[ "$status" -eq 0 ]]; then
    status=0
    break
  fi
  if [[ "$attempt" -lt "$ATTEMPTS" ]]; then
    echo "[cron_run_us_free_daily] 本次失败，${RETRY_SLEEP}s 后重试（exit=$status）"
    sleep "$RETRY_SLEEP"
  fi
  attempt=$((attempt + 1))
done

if [[ "$status" -eq 0 ]]; then
  if [[ -x "$ROOT/scripts/backup_sqlite_db.sh" ]]; then
    "$ROOT/scripts/backup_sqlite_db.sh" "$US_FREE_APPID_WEEKLY_DB" || echo "[cron_run_us_free_daily] 备份失败（主流程已成功）"
  fi
else
  echo "[cron_run_us_free_daily] 连续 ${ATTEMPTS} 次失败，停止"
fi

exit "$status"
