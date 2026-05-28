#!/usr/bin/env bash
#
# 每周执行：微信 + 抖音 × 三榜（人气 + 畅销 + 第三榜：微信畅玩 / 抖音新游）爬取 CSV，并写入 top20_ranking / rank_changes。
# 与「全平台仅人气」的 weekly_scrape_and_import.sh 区分：本脚本拉三榜且双平台。
#
# 用法：
#   ./scripts/weekly_wx_three_charts_scrape_and_import.sh
#   ./scripts/weekly_wx_three_charts_scrape_and_import.sh 2026-04-20   # 指定监控日期（决定「上一周」区间目录名）
#
# 指定入库库路径（例如测试库，避免写生产库）：
#   RANKING_IMPORT_DB=data/wechatdouyin_test.db ./scripts/weekly_wx_three_charts_scrape_and_import.sh
#
# 仅入库某一平台（例如只写了 wx CSV）：
#   python scripts/tools/import_ranking_csv_to_tables.py --only-platform wx
#
set -euo pipefail

MONITOR_DATE="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MONITOR_WEB_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
LEGACY_ROOT="${WECHAT_DOUYIN_LEGACY_ROOT:-$MONITOR_WEB_ROOT/../wechat-mini-game-ranking-post}"

export WECHAT_DOUYIN_DATA_DIR="${WECHAT_DOUYIN_DATA_DIR:-$MONITOR_WEB_ROOT/data/artifacts/wechat-douyin}"
export RANKING_IMPORT_DB="${RANKING_IMPORT_DB:-$MONITOR_WEB_ROOT/data/databases/wechatdouyin.db}"
export RANKINGS_CSV_PATH="${RANKINGS_CSV_PATH:-$WECHAT_DOUYIN_DATA_DIR/人气榜}"
export WECHAT_DB_BACKUP_DIR="${WECHAT_DB_BACKUP_DIR:-$MONITOR_WEB_ROOT/backups/db/wechat-douyin}"

cd "$PROJECT_ROOT"

if [ -n "${WECHAT_DOUYIN_VENV:-}" ] && [ -f "$WECHAT_DOUYIN_VENV/bin/activate" ]; then
    source "$WECHAT_DOUYIN_VENV/bin/activate"
    echo "[*] 已激活虚拟环境: $WECHAT_DOUYIN_VENV"
elif [ -d "$MONITOR_WEB_ROOT/.venv" ] && [ -f "$MONITOR_WEB_ROOT/.venv/bin/activate" ]; then
    source "$MONITOR_WEB_ROOT/.venv/bin/activate"
    echo "[*] 已激活虚拟环境: monitor-web/.venv"
elif [ -d "$MONITOR_WEB_ROOT/backend/.venv" ] && [ -f "$MONITOR_WEB_ROOT/backend/.venv/bin/activate" ]; then
    source "$MONITOR_WEB_ROOT/backend/.venv/bin/activate"
    echo "[*] 已激活虚拟环境: monitor-web/backend/.venv"
elif [ -d "$PROJECT_ROOT/.venv" ] && [ -f "$PROJECT_ROOT/.venv/bin/activate" ]; then
    source "$PROJECT_ROOT/.venv/bin/activate"
    echo "[*] 已激活虚拟环境: .venv"
elif [ -d "$LEGACY_ROOT/.venv" ] && [ -f "$LEGACY_ROOT/.venv/bin/activate" ]; then
    source "$LEGACY_ROOT/.venv/bin/activate"
    echo "[*] 已激活虚拟环境: legacy wechat-douyin .venv"
elif [ -d "$PROJECT_ROOT/venv" ] && [ -f "$PROJECT_ROOT/venv/bin/activate" ]; then
    source "$PROJECT_ROOT/venv/bin/activate"
    echo "[*] 已激活虚拟环境: venv"
elif [ -d "$PROJECT_ROOT/env" ] && [ -f "$PROJECT_ROOT/env/bin/activate" ]; then
    source "$PROJECT_ROOT/env/bin/activate"
    echo "[*] 已激活虚拟环境: env"
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
    echo "[错误] 未找到 Python。请安装 python3，或设置 PYTHON_BIN=/path/to/python"
    exit 127
}
echo "[*] Python: $("$PYTHON_BIN" --version 2>&1)"

IMPORT_DB="${RANKING_IMPORT_DB:-}"
IMPORT_CMD=("$PYTHON_BIN" scripts/tools/import_ranking_csv_to_tables.py)
if [ -n "$IMPORT_DB" ]; then
    IMPORT_CMD+=(--db "$IMPORT_DB")
fi

MAX_ATTEMPTS="${WEEKLY_WX_THREE_CHARTS_ATTEMPTS:-3}"
RETRY_SLEEP="${WEEKLY_WX_THREE_CHARTS_RETRY_SLEEP:-180}"
IMPORT_ATTEMPTS="${WEEKLY_WX_IMPORT_ATTEMPTS:-3}"
IMPORT_RETRY_SLEEP="${WEEKLY_WX_IMPORT_RETRY_SLEEP:-20}"

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

validate_import() {
    local db_path="${IMPORT_DB:-data/wechatdouyin.db}"
    local week_range
    week_range="$(week_range_for_validation)"
    "$PYTHON_BIN" - "$db_path" "$week_range" <<'PY'
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
    raise SystemExit(f"[校验失败] 数据库不存在：{db_path}")

with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as conn:
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        raise SystemExit(f"[校验失败] SQLite integrity_check={integrity!r}")

    missing = []
    counts = []
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
    raise SystemExit(
        "[校验失败] 目标周三榜不完整："
        f"week_range={week_range}, missing={', '.join(missing)}, counts={'; '.join(counts)}"
    )

if changes <= 0:
    raise SystemExit(f"[校验失败] 目标周 rank_changes 为空：week_range={week_range}")

print(f"[校验通过] week_range={week_range}; " + "; ".join(counts) + f"; rank_changes={changes}")
PY
}

import_and_validate() {
    local import_attempt=1
    while [ "$import_attempt" -le "$IMPORT_ATTEMPTS" ]; do
        echo "[2/3] 导入数据库（第 ${import_attempt}/${IMPORT_ATTEMPTS} 次；同名周区间下：人气榜 / 畅销榜 / 畅玩榜）"
        if "${IMPORT_CMD[@]}"; then
            echo ""
            echo "[3/3] 校验目标周六个榜单组合与 rank_changes"
            if validate_import; then
                return 0
            fi
        fi
        if [ "$import_attempt" -lt "$IMPORT_ATTEMPTS" ]; then
            echo "[!] 入库/校验失败，${IMPORT_RETRY_SLEEP}s 后重试入库（不重新爬页面）..."
            sleep "$IMPORT_RETRY_SLEEP"
        fi
        import_attempt=$((import_attempt + 1))
    done
    return 1
}

echo "============================================================"
echo "每周微信+抖音三榜爬取 + 入库 - $(date '+%Y-%m-%d %H:%M:%S')"
echo "项目目录: $PROJECT_ROOT"
echo "监控日期: ${MONITOR_DATE:-（默认今天，上一周）}"
echo "monitor-web: $MONITOR_WEB_ROOT"
echo "pipeline: $PROJECT_ROOT"
echo "产物目录: $WECHAT_DOUYIN_DATA_DIR"
echo "入库目标: $IMPORT_DB"
echo "============================================================"

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
    echo ""
    echo "---------- 第 ${attempt}/${MAX_ATTEMPTS} 次尝试 ----------"
    echo "[1/3] 爬取引力引擎 - 微信+抖音 × 人气榜 + 畅销榜 + 第三榜（畅玩/新游）"
    SCRAPE=("$PYTHON_BIN" scripts/scrapers/scrape_weekly_popularity.py --chart both --platform all)
    if [ -n "${WECHAT_DOUYIN_USER_DATA_DIR:-}" ]; then
        SCRAPE+=(--user-data-dir "$WECHAT_DOUYIN_USER_DATA_DIR")
    elif [ -d "$LEGACY_ROOT/data/pw_user_data" ]; then
        SCRAPE+=(--user-data-dir "$LEGACY_ROOT/data/pw_user_data")
    fi
    if [ -n "$MONITOR_DATE" ]; then
        SCRAPE+=(--monitor-date "$MONITOR_DATE")
    fi

    if "${SCRAPE[@]}"; then
        echo ""
        if import_and_validate; then
            if [ -x "$SCRIPT_DIR/backup_sqlite_db.sh" ]; then
                "$SCRIPT_DIR/backup_sqlite_db.sh" "$IMPORT_DB"
            else
                echo "[!] 未找到可执行备份脚本：$SCRIPT_DIR/backup_sqlite_db.sh"
            fi
            echo ""
            echo "============================================================"
            echo "全部完成 - $(date '+%Y-%m-%d %H:%M:%S')"
            echo "============================================================"
            exit 0
        fi
    fi

    if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
        echo "[!] 本次失败，${RETRY_SLEEP}s 后重试..."
        sleep "$RETRY_SLEEP"
    fi
    attempt=$((attempt + 1))
done

echo "[错误] 微信/抖音三榜爬取入库连续 ${MAX_ATTEMPTS} 次失败，已停止。"
exit 1
