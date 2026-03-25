#!/usr/bin/env bash

# 一键发送「最新」的核心推送（不含 AI 日报 / 热点日报 / AI 工具相关推送），顺序为：
#  1）SensorTower 榜单周报（游戏检测 - SensorTower）
#  2）竞品社媒周报（玩法更新 / 线下活动）
#  3）微信 / 抖音小游戏周报
#
# 使用方式（在项目根目录执行）：
#   ./scripts/run_all_latest_reports.sh
#
# 说明：
# - 本脚本只负责「发送最新一期」，不支持日期参数；若需指定日期，请单独调用各子脚本。

set -euo pipefail

# 仓库根目录（本脚本位于 scripts/ 下）
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[run_all_latest_reports] 仓库根目录：$REPO_ROOT"

# 若存在虚拟环境，则自动激活（遵循项目约定）
if [ -d ".venv" ]; then
  # shellcheck disable=SC1091
  source ".venv/bin/activate"
  echo "[run_all_latest_reports] 已激活虚拟环境 .venv"
fi

echo "[1/3] 发送 SensorTower 榜单周报（游戏检测 - SensorTower）..."
python3 scripts/send_minigame_weekly_reports.py --content game_st || echo "[警告] send_minigame_weekly_reports.py --content game_st 发送失败"

echo "[2/3] 发送竞品社媒周报（玩法更新 / 线下活动）..."
python3 scripts/send_competitor_digest.py || echo "[警告] send_competitor_digest.py 发送失败"

echo "[3/3] 发送微信 / 抖音小游戏周报..."
python3 scripts/send_minigame_weekly_reports.py --content game_wd || echo "[警告] send_minigame_weekly_reports.py --content game_wd 发送失败"

echo "[run_all_latest_reports] 全部非 AI 日报 / 热点推送已尝试发送完成。"

