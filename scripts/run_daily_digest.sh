#!/usr/bin/env bash
# 每日 10:30 定时任务：发送最新热点日报 + AI 日报到飞书和企业微信。
# 用法：
#   发送当天日报：  ./scripts/run_daily_digest.sh
#   发送指定日期：  ./scripts/run_daily_digest.sh --date 2026-02-10
#
# Crontab 示例（每天 10:30 执行，日志写入项目下 logs/）：
#   30 10 * * * /absolute/path/to/监测汇总/scripts/run_daily_digest.sh >> /absolute/path/to/监测汇总/logs/daily_digest.log 2>&1

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -d ".venv" ]; then
  # shellcheck disable=SC1091
  source ".venv/bin/activate"
fi

exec python3 scripts/send_minigame_weekly_reports.py --content hot,ai "$@"
