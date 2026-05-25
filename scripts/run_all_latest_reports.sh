#!/usr/bin/env bash

# 一键发送「最新」的 monitor-web 核心推送（不含 AI 日报 / 热点日报 / AI 工具相关推送），顺序为：
#  1）scripts/send_sensortower_weekly_push.py（仅 sensortower_top100.db）
#  2）scripts/send_competitor_social_weekly_push.py（仅 competitor_data.db）
#  3）scripts/send_wechat_douyin_weekly_push.py（仅 wechatdouyin.db）
#
# 说明：monitor-web 这边默认不推送「我方产品变化 / 指定产品竞品变化」；
# 如确实要手动补发我方产品日总结，可设置 REPORTS_INCLUDE_OUR_PRODUCT=1。
#
# 使用方式（在项目根目录执行）：
#   ./scripts/run_all_latest_reports.sh
#
# 说明：
# - 本脚本只负责「发送最新一期」，不支持日期参数；若需指定日期，请单独调用各子脚本。

set -euo pipefail

# 仓库根目录（本脚本位于 scripts/ 下）
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GURU_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

echo "[run_all_latest_reports] 仓库根目录：$REPO_ROOT"

# 若存在虚拟环境，则自动激活（遵循项目约定）
if [ -d ".venv" ]; then
  # shellcheck disable=SC1091
  source ".venv/bin/activate"
  echo "[run_all_latest_reports] 已激活虚拟环境 .venv"
fi

PYTHON_BIN="${REPORTS_PYTHON_BIN:-}"
if [ -z "$PYTHON_BIN" ]; then
  if [ -x "$REPO_ROOT/.venv/bin/python" ]; then
    PYTHON_BIN="$REPO_ROOT/.venv/bin/python"
  else
    PYTHON_BIN="$(command -v python3)"
  fi
fi
echo "[run_all_latest_reports] Python: $("$PYTHON_BIN" --version 2>&1)"

SENSORTOWER_DB="${SENSORTOWER_DB:-$GURU_ROOT/sensortower-/data/sensortower_top100.db}"
COMPETITOR_DB="${COMPETITOR_DB:-$GURU_ROOT/Olivr-competitor-monitor/db/competitor_data.db}"
WECHAT_DB="${WECHAT_DB:-$GURU_ROOT/wechat-mini-game-ranking-post/data/wechatdouyin.db}"
OUR_PRODUCT_DB="${OUR_PRODUCT_DB:-$GURU_ROOT/sensortower-/data/us_free_appid_weekly.db}"

echo "[1/3] 发送 SensorTower 榜单周报（游戏检测 - SensorTower）..."
"$PYTHON_BIN" scripts/send_sensortower_weekly_push.py --db "$SENSORTOWER_DB" || echo "[警告] send_sensortower_weekly_push.py 发送失败"

if [ "${REPORTS_INCLUDE_OUR_PRODUCT:-}" = "1" ]; then
  echo "[可选] 发送我方产品排名变化日总结（SensorTower US 免费榜）..."
  "$PYTHON_BIN" scripts/send_us_free_own_product_daily_push.py --db "$OUR_PRODUCT_DB" || echo "[警告] send_us_free_own_product_daily_push.py 发送失败"
fi

echo "[2/3] 发送竞品社媒周报（玩法更新 / 线下活动）..."
"$PYTHON_BIN" scripts/send_competitor_social_weekly_push.py --db "$COMPETITOR_DB" || echo "[警告] send_competitor_social_weekly_push.py 发送失败"

echo "[3/3] 发送微信 / 抖音小游戏周报..."
"$PYTHON_BIN" scripts/send_wechat_douyin_weekly_push.py --db "$WECHAT_DB" || echo "[警告] send_wechat_douyin_weekly_push.py 发送失败"

echo "[run_all_latest_reports] 全部非 AI 日报 / 热点推送已尝试发送完成。"
