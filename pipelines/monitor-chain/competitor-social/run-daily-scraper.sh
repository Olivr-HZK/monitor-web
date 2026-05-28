#!/bin/bash
# Bash脚本：每天定时运行爬虫程序
# 用于 macOS/Linux Cron 任务
# 功能：爬取前一天的社媒更新信息
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONITOR_WEB_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$SCRIPT_DIR"

export COMPETITOR_DB_PATH="${COMPETITOR_DB_PATH:-$MONITOR_WEB_ROOT/data/databases/competitor_data.db}"
export COMPETITOR_DB_DIR="${COMPETITOR_DB_DIR:-$(dirname "$COMPETITOR_DB_PATH")}"
export COMPETITOR_DB_BACKUP_DIR="${COMPETITOR_DB_BACKUP_DIR:-$MONITOR_WEB_ROOT/backups/db/competitor-social}"

# 设置 Python 路径，确保能找到项目根目录的模块（如 env_loader）
export PYTHONPATH="$(pwd):${PYTHONPATH:-}"

# 激活虚拟环境（如果使用虚拟环境）
if [ ! -f ".venv/bin/activate" ]; then
    echo "[daily] 缺少 pipeline 本地虚拟环境：$SCRIPT_DIR/.venv"
    echo "[daily] 请执行：cd $SCRIPT_DIR && python3 -m venv .venv && .venv/bin/pip install -r requirements-runtime.txt"
    exit 127
fi
# shellcheck source=/dev/null
source .venv/bin/activate
PYTHON_BIN="${COMPETITOR_PYTHON:-$(command -v python3)}"

# 日志文件路径
LOG_DIR="logs"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/daily_scraper_$(date +%Y-%m-%d).log"

# 记录开始时间
START_TIME=$(date)
START_SECONDS=$(date +%s)

# macOS 和 Linux 的日期计算方式不同
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    TARGET_DATE=$(date -v-1d +%Y-%m-%d)
else
    # Linux
    TARGET_DATE=$(date -d "yesterday" +%Y-%m-%d)
fi

echo "========================================" | tee -a "$LOG_FILE"
echo "开始执行每日爬虫任务" | tee -a "$LOG_FILE"
echo "目标: 爬取前一天的数据 (日期: $TARGET_DATE)" | tee -a "$LOG_FILE"
echo "时间: $START_TIME" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

ATTEMPTS="${COMPETITOR_DAILY_ATTEMPTS:-3}"
RETRY_SLEEP="${COMPETITOR_DAILY_RETRY_SLEEP:-180}"

run_daily_once() {
    "$PYTHON_BIN" scrapers/daily_scraper.py --days-ago 1 --db-path "$COMPETITOR_DB_PATH" 2>&1 | tee -a "$LOG_FILE"
    return "${PIPESTATUS[0]}"
}

validate_daily_db() {
    local min_companies="${COMPETITOR_DAILY_MIN_COMPANIES:-4}"
    "$PYTHON_BIN" - "$TARGET_DATE" "$min_companies" "$COMPETITOR_DB_PATH" <<'PY' 2>&1 | tee -a "$LOG_FILE"
import sqlite3
import sys
from pathlib import Path

target_date = sys.argv[1]
min_companies = int(sys.argv[2])
db_path = Path(sys.argv[3])
if not db_path.exists():
    print(f"[daily] 校验失败: 数据库不存在 {db_path}")
    sys.exit(1)

conn = sqlite3.connect(db_path)
try:
    quick = conn.execute("PRAGMA quick_check").fetchone()[0]
    if quick != "ok":
        print(f"[daily] 校验失败: SQLite quick_check={quick}")
        sys.exit(1)
    tables = [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'company_raw_data_%'"
        )
    ]
    hit_tables = []
    total_rows = 0
    for table in tables:
        count = conn.execute(f'SELECT COUNT(*) FROM "{table}" WHERE fetch_date = ?', (target_date,)).fetchone()[0]
        if count > 0:
            hit_tables.append(table)
            total_rows += count
    if len(hit_tables) < min_companies:
        print(
            f"[daily] 校验失败: fetch_date={target_date} 仅 {len(hit_tables)} 个公司表有数据，"
            f"低于阈值 {min_companies}"
        )
        sys.exit(1)
    print(f"[daily] 校验通过: fetch_date={target_date}, company_tables={len(hit_tables)}, rows={total_rows}")
finally:
    conn.close()
PY
    return "${PIPESTATUS[0]}"
}

is_non_retryable_daily_failure() {
    # RapidAPI monthly quota exhaustion will not recover by immediate retry.
    # Stop early so the healthcheck alerts clearly instead of burning more calls.
    grep -Eiq "MONTHLY quota|exceeded the MONTHLY quota|所有 API Key 都已尝试|current plan, BASIC" "$LOG_FILE"
}

EXIT_CODE=0
ATTEMPT=1
while [ "$ATTEMPT" -le "$ATTEMPTS" ]; do
    echo "[daily] 第 ${ATTEMPT}/${ATTEMPTS} 次执行" | tee -a "$LOG_FILE"
    EXIT_CODE=0
    run_daily_once || EXIT_CODE=$?
    if [ "$EXIT_CODE" -eq 0 ]; then
        validate_daily_db || EXIT_CODE=$?
    fi
    if [ "$EXIT_CODE" -eq 0 ]; then
        EXIT_CODE=0
        break
    fi
    if is_non_retryable_daily_failure; then
        echo "[daily] 检测到非重试型失败（API 月额度/所有 Key 耗尽），停止本轮重试，等待告警/人工处理" | tee -a "$LOG_FILE"
        break
    fi
    if [ "$ATTEMPT" -lt "$ATTEMPTS" ]; then
        echo "[daily] 本次失败，${RETRY_SLEEP}s 后重试（exit=$EXIT_CODE）" | tee -a "$LOG_FILE"
        sleep "$RETRY_SLEEP"
    fi
    ATTEMPT=$((ATTEMPT + 1))
done

if [ "$EXIT_CODE" -eq 0 ] && [ -x "scripts/backup_sqlite_db.sh" ]; then
    scripts/backup_sqlite_db.sh "$COMPETITOR_DB_PATH" 2>&1 | tee -a "$LOG_FILE" || true
fi

END_TIME=$(date)
END_SECONDS=$(date +%s)
DURATION=$((END_SECONDS - START_SECONDS))

echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ 爬虫任务执行成功" | tee -a "$LOG_FILE"
else
    echo "❌ 爬虫任务执行失败，错误码: $EXIT_CODE" | tee -a "$LOG_FILE"
fi
echo "执行时长: ${DURATION} 秒" | tee -a "$LOG_FILE"
echo "结束时间: $END_TIME" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

exit $EXIT_CODE
