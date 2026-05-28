#!/usr/bin/env bash
# 供 crontab 调用：cron 环境无 login shell，PATH 极短，此处补齐常见路径后再启动 Node。
# 日志在此追加，crontab 行只需写本脚本绝对路径（勿在 cron 里写 bash -c / 重定向，减少解析问题）。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONITOR_WEB_ROOT="$(cd "$ROOT/../../.." && pwd)"
export SENSORTOWER_DB_FILE="${SENSORTOWER_DB_FILE:-$MONITOR_WEB_ROOT/data/databases/sensortower_top100.db}"
export SENSORTOWER_DB_BACKUP_DIR="${SENSORTOWER_DB_BACKUP_DIR:-$MONITOR_WEB_ROOT/backups/db/sensortower}"
export SENSORTOWER_PIPELINE_LOG_DIR="${SENSORTOWER_PIPELINE_LOG_DIR:-$MONITOR_WEB_ROOT/logs}"
LOG="${SENSORTOWER_WEEKLY_CRON_LOG:-$MONITOR_WEB_ROOT/logs/sensortower_weekly.log}"
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
# send_sensortower_weekly_push.py 需 Python 3.10+；macOS /usr/bin/python3 常为 3.9，会触发类型注解语法错误
if [[ -z "${SENSORTOWER_WEEKLY_PUSH_PYTHON:-}" ]]; then
  if [[ -x /opt/homebrew/bin/python3 ]] && /opt/homebrew/bin/python3 -c 'import sys; assert sys.version_info >= (3, 10)' 2>/dev/null; then
    export SENSORTOWER_WEEKLY_PUSH_PYTHON=/opt/homebrew/bin/python3
  elif [[ -x /usr/local/bin/python3 ]] && /usr/local/bin/python3 -c 'import sys; assert sys.version_info >= (3, 10)' 2>/dev/null; then
    export SENSORTOWER_WEEKLY_PUSH_PYTHON=/usr/local/bin/python3
  fi
fi
NODE_BIN="${SENSORTOWER_NODE:-}"
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "[cron_run_weekly] 错误: 未找到可执行的 node。请安装 Node 或设置 SENSORTOWER_NODE=/path/to/node"
  exit 127
fi

SQLITE_BIN="${SQLITE_BIN:-$(command -v sqlite3 2>/dev/null || true)}"
if [[ -z "$SQLITE_BIN" || ! -x "$SQLITE_BIN" ]]; then
  echo "[cron_run_weekly] 错误: 未找到 sqlite3，无法校验写库结果"
  exit 127
fi

current_monday() {
  "$NODE_BIN" -e '
const now = new Date();
const day = now.getDay();
const diff = day === 0 ? -6 : 1 - day;
const d = new Date(now);
d.setDate(now.getDate() + diff);
d.setHours(0, 0, 0, 0);
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, "0");
const dayOfMonth = String(d.getDate()).padStart(2, "0");
console.log(`${y}-${m}-${dayOfMonth}`);
'
}

validate_weekly_db() {
  local db="$SENSORTOWER_DB_FILE"
  local target_date="${SENSORTOWER_WEEKLY_REPORT_DATE:-$(current_monday)}"
  if [[ ! "$target_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "[cron_run_weekly] 校验失败: 非法目标日期 $target_date"
    return 1
  fi
  if [[ ! -f "$db" ]]; then
    echo "[cron_run_weekly] 校验失败: 数据库不存在 $db"
    return 1
  fi
  local quick_check count
  quick_check="$("$SQLITE_BIN" "$db" 'PRAGMA quick_check;' 2>/dev/null || true)"
  if [[ "$quick_check" != "ok" ]]; then
    echo "[cron_run_weekly] 校验失败: SQLite quick_check=$quick_check"
    return 1
  fi
  count="$("$SQLITE_BIN" "$db" "SELECT COUNT(*) FROM rank_changes WHERE rank_date_current = '$target_date';" 2>/dev/null || echo 0)"
  if [[ "${count:-0}" -le 0 ]]; then
    echo "[cron_run_weekly] 校验失败: rank_changes 无目标日期数据 rank_date_current=$target_date"
    return 1
  fi
  echo "[cron_run_weekly] 校验通过: rank_changes[$target_date]=$count"
}

ATTEMPTS="${SENSORTOWER_WEEKLY_ATTEMPTS:-3}"
RETRY_SLEEP="${SENSORTOWER_WEEKLY_RETRY_SLEEP:-180}"
status=0
attempt=1
while [[ "$attempt" -le "$ATTEMPTS" ]]; do
  echo "[cron_run_weekly] 第 ${attempt}/${ATTEMPTS} 次执行 weekly_automated_workflow.js"
  status=0
  "$NODE_BIN" "$ROOT/scripts/weekly_automated_workflow.js" || status=$?
  if [[ "$status" -eq 0 ]]; then
    validate_weekly_db || status=$?
  fi
  if [[ "$status" -eq 0 ]]; then
    status=0
    break
  fi
  if [[ "$attempt" -lt "$ATTEMPTS" ]]; then
    echo "[cron_run_weekly] 本次失败，${RETRY_SLEEP}s 后重试（exit=$status）"
    sleep "$RETRY_SLEEP"
  fi
  attempt=$((attempt + 1))
done

if [[ "$status" -eq 0 ]]; then
  if [[ -x "$ROOT/scripts/backup_sqlite_db.sh" ]]; then
    "$ROOT/scripts/backup_sqlite_db.sh" "$SENSORTOWER_DB_FILE" || echo "[cron_run_weekly] 备份失败（主流程已成功）"
  fi
else
  echo "[cron_run_weekly] 连续 ${ATTEMPTS} 次失败，停止"
fi

exit "$status"
