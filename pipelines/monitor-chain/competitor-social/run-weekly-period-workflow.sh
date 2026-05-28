#!/bin/bash
# Bash脚本：每周定时运行时间段工作流
# 用于 macOS/Linux Cron 任务（建议 crontab：每周一 10:30）
# 功能：生成指定时间段或上周的竞品周报
#
# 用法：
#   ./run-weekly-period-workflow.sh                    # 默认：上周一至上周日
#   ./run-weekly-period-workflow.sh --start-date 2026-01-13 --end-date 2026-01-19
set -uo pipefail

# 切换到脚本所在目录（项目根）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONITOR_WEB_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$SCRIPT_DIR"

export COMPETITOR_DB_PATH="${COMPETITOR_DB_PATH:-$MONITOR_WEB_ROOT/data/databases/competitor_data.db}"
export COMPETITOR_DB_DIR="${COMPETITOR_DB_DIR:-$(dirname "$COMPETITOR_DB_PATH")}"
export COMPETITOR_DB_BACKUP_DIR="${COMPETITOR_DB_BACKUP_DIR:-$MONITOR_WEB_ROOT/backups/db/competitor-social}"

# 解析可选参数：--start-date YYYY-MM-DD --end-date YYYY-MM-DD
CUSTOM_START=""
CUSTOM_END=""
while [ $# -gt 0 ]; do
    case "$1" in
        --start-date)
            CUSTOM_START="$2"
            shift 2
            ;;
        --end-date)
            CUSTOM_END="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# 设置 Python 路径，确保能找到项目根目录的模块
export PYTHONPATH="$SCRIPT_DIR:${PYTHONPATH:-}"

# 激活虚拟环境（若存在），cron 下可正确找到 python3 和依赖
if [ ! -f "$SCRIPT_DIR/.venv/bin/activate" ]; then
    echo "[weekly] 缺少 pipeline 本地虚拟环境：$SCRIPT_DIR/.venv"
    echo "[weekly] 请执行：cd $SCRIPT_DIR && python3 -m venv .venv && .venv/bin/pip install -r requirements-runtime.txt"
    exit 127
fi
# shellcheck source=/dev/null
source "$SCRIPT_DIR/.venv/bin/activate"
PYTHON_BIN="${COMPETITOR_PYTHON:-$(command -v python3)}"

# 日志文件路径
LOG_DIR="logs"
mkdir -p "$LOG_DIR"

# 确定日期范围：若指定了起止日期则用指定的，否则计算上周
if [ -n "$CUSTOM_START" ] && [ -n "$CUSTOM_END" ]; then
    LAST_WEEK_START="$CUSTOM_START"
    LAST_WEEK_END="$CUSTOM_END"
else
    # 计算上周的日期范围（周一到周日）
    if [[ "$OSTYPE" == "darwin"* ]]; then
        DAY_OF_WEEK=$(date +%w)
        [ "$DAY_OF_WEEK" -eq 0 ] && DAY_OF_WEEK=7
        LAST_WEEK_END=$(date -v-${DAY_OF_WEEK}d +%Y-%m-%d)
        LAST_WEEK_START=$(date -v-$(($DAY_OF_WEEK + 6))d +%Y-%m-%d)
    else
        DAY_OF_WEEK=$(date +%w)
        [ "$DAY_OF_WEEK" -eq 0 ] && DAY_OF_WEEK=7
        LAST_WEEK_END=$(date -d "$DAY_OF_WEEK days ago" +%Y-%m-%d)
        LAST_WEEK_START=$(date -d "$(($DAY_OF_WEEK + 6)) days ago" +%Y-%m-%d)
    fi
fi

LOG_FILE="$LOG_DIR/weekly_period_workflow_$(date +%Y-%m-%d).log"

# 记录开始时间
START_TIME=$(date)

echo "========================================" | tee -a "$LOG_FILE"
echo "开始执行每周时间段工作流任务" | tee -a "$LOG_FILE"
echo "时间段: $LAST_WEEK_START 至 $LAST_WEEK_END" | tee -a "$LOG_FILE"
echo "时间: $START_TIME" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

ATTEMPTS="${COMPETITOR_WEEKLY_ATTEMPTS:-3}"
RETRY_SLEEP="${COMPETITOR_WEEKLY_RETRY_SLEEP:-180}"

run_weekly_once() {
    # --skip-send 参数可以加到这里，如果只想生成报告文件不发送。
    "$PYTHON_BIN" workflows/period_workflow.py --start-date "$LAST_WEEK_START" --end-date "$LAST_WEEK_END" --db-path "$COMPETITOR_DB_PATH" 2>&1 | tee -a "$LOG_FILE"
    return "${PIPESTATUS[0]}"
}

validate_weekly_db() {
    local min_reports="${COMPETITOR_WEEKLY_MIN_REPORTS:-4}"
    "$PYTHON_BIN" - "$LAST_WEEK_START" "$LAST_WEEK_END" "$min_reports" "$COMPETITOR_DB_PATH" <<'PY' 2>&1 | tee -a "$LOG_FILE"
import json
import sqlite3
import sys
from pathlib import Path

start_date, end_date, min_reports_raw, db_path_raw = sys.argv[1:5]
min_reports = int(min_reports_raw)
db_path = Path(db_path_raw)
if not db_path.exists():
    print(f"[weekly] 校验失败: 数据库不存在 {db_path}")
    sys.exit(1)

conn = sqlite3.connect(db_path)
try:
    quick = conn.execute("PRAGMA quick_check").fetchone()[0]
    if quick != "ok":
        print(f"[weekly] 校验失败: SQLite quick_check={quick}")
        sys.exit(1)
    rows = conn.execute(
        """
        SELECT company_name, report_content
        FROM weekly_reports
        WHERE start_date = ? AND end_date = ?
        """,
        (start_date, end_date),
    ).fetchall()
    if len(rows) < min_reports:
        print(
            f"[weekly] 校验失败: weekly_reports[{start_date}~{end_date}]={len(rows)}，"
            f"低于阈值 {min_reports}"
        )
        sys.exit(1)
    bad = []
    for company, content in rows:
        try:
            parsed = json.loads(content)
        except Exception:
            bad.append(company)
            continue
        if not parsed:
            bad.append(company)
    if bad:
        print(f"[weekly] 校验失败: report_content 非合法 JSON 或为空: {', '.join(bad)}")
        sys.exit(1)
    print(f"[weekly] 校验通过: weekly_reports[{start_date}~{end_date}]={len(rows)}")
finally:
    conn.close()
PY
    return "${PIPESTATUS[0]}"
}

EXIT_CODE=0
ATTEMPT=1
while [ "$ATTEMPT" -le "$ATTEMPTS" ]; do
    echo "[weekly] 第 ${ATTEMPT}/${ATTEMPTS} 次执行" | tee -a "$LOG_FILE"
    EXIT_CODE=0
    run_weekly_once || EXIT_CODE=$?
    if [ "$EXIT_CODE" -eq 0 ]; then
        validate_weekly_db || EXIT_CODE=$?
    fi
    if [ "$EXIT_CODE" -eq 0 ]; then
        EXIT_CODE=0
        break
    fi
    if [ "$ATTEMPT" -lt "$ATTEMPTS" ]; then
        echo "[weekly] 本次失败，${RETRY_SLEEP}s 后重试（exit=$EXIT_CODE）" | tee -a "$LOG_FILE"
        sleep "$RETRY_SLEEP"
    fi
    ATTEMPT=$((ATTEMPT + 1))
done

if [ "$EXIT_CODE" -eq 0 ] && [ -x "scripts/backup_sqlite_db.sh" ]; then
    scripts/backup_sqlite_db.sh "$COMPETITOR_DB_PATH" 2>&1 | tee -a "$LOG_FILE" || true
fi

END_TIME=$(date)

echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ 周报生成任务执行成功" | tee -a "$LOG_FILE"
    echo "📊 周报时间段: $LAST_WEEK_START 至 $LAST_WEEK_END" | tee -a "$LOG_FILE"
else
    echo "❌ 周报生成任务执行失败，错误码: $EXIT_CODE" | tee -a "$LOG_FILE"
fi
echo "结束时间: $END_TIME" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

exit $EXIT_CODE
