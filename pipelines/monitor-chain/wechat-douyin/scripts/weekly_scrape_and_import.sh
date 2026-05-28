#!/usr/bin/env bash
#
# 兼容旧入口：历史上本脚本只爬「微信+抖音 × 人气榜」。
# 监测链当前标准为每周每个平台三榜：
#   人气榜 + 畅销榜 + 第三榜（微信畅玩 / 抖音新游）
# 因此旧入口统一转调 weekly_wx_three_charts_scrape_and_import.sh，避免 cron 或文档误用后漏榜。
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[兼容提示] scripts/weekly_scrape_and_import.sh 已废弃单榜行为；现在转调三榜入口 weekly_wx_three_charts_scrape_and_import.sh" >&2
exec "$SCRIPT_DIR/weekly_wx_three_charts_scrape_and_import.sh" "$@"
