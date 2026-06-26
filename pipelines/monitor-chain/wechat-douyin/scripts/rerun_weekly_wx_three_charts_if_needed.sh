#!/usr/bin/env bash
#
# Check whether the current target week has complete WeChat/Douyin three-chart
# data. If not, rerun the weekly scraper/import once for this invocation.
#
# Intended as a cron safety net after the 07:30 primary run. It is safe to
# schedule multiple times on Monday: complete data exits immediately, incomplete
# data gets another chance after Gravity Engine catches up.

set -euo pipefail

MONITOR_DATE="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MONITOR_WEB_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$PROJECT_ROOT"

if [ -d "$PROJECT_ROOT/.venv" ] && [ -f "$PROJECT_ROOT/.venv/bin/activate" ]; then
    # shellcheck source=/dev/null
    source "$PROJECT_ROOT/.venv/bin/activate"
elif [ -d "$PROJECT_ROOT/venv" ] && [ -f "$PROJECT_ROOT/venv/bin/activate" ]; then
    # shellcheck source=/dev/null
    source "$PROJECT_ROOT/venv/bin/activate"
elif [ -d "$PROJECT_ROOT/env" ] && [ -f "$PROJECT_ROOT/env/bin/activate" ]; then
    # shellcheck source=/dev/null
    source "$PROJECT_ROOT/env/bin/activate"
fi

resolve_python_bin() {
    if [ -n "${PYTHON_BIN:-}" ]; then
        printf '%s\n' "$PYTHON_BIN"
        return 0
    fi
    if command -v python >/dev/null 2>&1; then
        command -v python
        return 0
    fi
    if command -v python3 >/dev/null 2>&1; then
        command -v python3
        return 0
    fi
    return 1
}

PYTHON_BIN="$(resolve_python_bin)" || {
    echo "[rerun-if-needed] 未找到 Python。请安装 python3，或设置 PYTHON_BIN=/path/to/python"
    exit 127
}

DB_PATH="${RANKING_IMPORT_DB:-$MONITOR_WEB_ROOT/data/databases/wechatdouyin.db}"
LOCK_DIR="${WEEKLY_WX_RERUN_LOCK_DIR:-$MONITOR_WEB_ROOT/logs/weekly_wx_three_charts_rerun.lock}"
MAIN_SCRIPT="$SCRIPT_DIR/weekly_wx_three_charts_scrape_and_import.sh"

week_range_for_validation() {
    "$PYTHON_BIN" - "$MONITOR_DATE" <<'PY'
import sys
from datetime import datetime, timedelta

raw = (sys.argv[1] or "").strip()
base = datetime.strptime(raw[:10], "%Y-%m-%d") if raw else datetime.now()
end = base - timedelta(days=base.isoweekday())
start = end - timedelta(days=6)
print(f"{start:%Y-%m-%d}~{end:%Y-%m-%d}")
PY
}

validate_week_complete() {
    local week_range="$1"
    "$PYTHON_BIN" - "$DB_PATH" "$week_range" <<'PY'
import sqlite3
import sys
from pathlib import Path

db_path = Path(sys.argv[1])
week_range = sys.argv[2]
expected = (
    ("dy", "bestseller"),
    ("dy", "new_games"),
    ("dy", "popularity"),
    ("wx", "bestseller"),
    ("wx", "casual_play"),
    ("wx", "popularity"),
)

if not db_path.exists():
    raise SystemExit(f"missing_db:{db_path}")

with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as conn:
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        raise SystemExit(f"bad_integrity:{integrity}")
    counts = []
    missing = []
    for platform_key, chart_key in expected:
        count = conn.execute(
            """
            SELECT COUNT(*)
            FROM top20_ranking
            WHERE week_range = ? AND platform_key = ? AND chart_key = ?
            """,
            (week_range, platform_key, chart_key),
        ).fetchone()[0]
        counts.append(f"{platform_key}/{chart_key}={count}")
        if count <= 0:
            missing.append(f"{platform_key}/{chart_key}")
    changes = conn.execute(
        "SELECT COUNT(*) FROM rank_changes WHERE week_range = ?",
        (week_range,),
    ).fetchone()[0]

if missing:
    raise SystemExit("missing:" + ",".join(missing) + "; " + "; ".join(counts))
if changes <= 0:
    raise SystemExit("missing:rank_changes")

print("; ".join(counts) + f"; rank_changes={changes}")
PY
}

mkdir -p "$(dirname "$LOCK_DIR")"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "[rerun-if-needed] 已有补跑检查在执行：$LOCK_DIR"
    exit 0
fi

cleanup() {
    rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

WEEK_RANGE="$(week_range_for_validation)"
echo "============================================================"
echo "[rerun-if-needed] $(date '+%Y-%m-%d %H:%M:%S')"
echo "项目目录: $PROJECT_ROOT"
echo "监控日期: ${MONITOR_DATE:-（默认今天）}"
echo "目标周区间: $WEEK_RANGE"
echo "数据库: $DB_PATH"
echo "============================================================"

if validate_output="$(validate_week_complete "$WEEK_RANGE" 2>&1)"; then
    echo "[rerun-if-needed] 已完整，无需补跑：$validate_output"
    exit 0
fi

echo "[rerun-if-needed] 数据不完整，准备补跑：$validate_output"

if pgrep -f "scripts/weekly_wx_three_charts_scrape_and_import.sh" >/dev/null 2>&1; then
    echo "[rerun-if-needed] 主爬取脚本仍在运行，跳过本次补跑，等待下一次检查。"
    exit 0
fi

export WEEKLY_WX_THREE_CHARTS_ATTEMPTS="${WEEKLY_WX_RERUN_ATTEMPTS:-1}"
export WEEKLY_WX_IMPORT_ATTEMPTS="${WEEKLY_WX_RERUN_IMPORT_ATTEMPTS:-2}"
export WEEKLY_WX_IMPORT_RETRY_SLEEP="${WEEKLY_WX_RERUN_IMPORT_RETRY_SLEEP:-20}"

if [ -n "$MONITOR_DATE" ]; then
    "$MAIN_SCRIPT" "$MONITOR_DATE"
else
    "$MAIN_SCRIPT"
fi

echo "[rerun-if-needed] 补跑完成，重新校验。"
validate_week_complete "$WEEK_RANGE"
