#!/usr/bin/env bash
#
# 每周一执行：将 sensortower、竞品(-)、wechat-mini-game-ranking-post 的数据库
# 同步到监测汇总/public 并覆盖原库，然后执行 npm run deploy。
# 必须在「竞品周报」和「sensortower 周任务」都完成之后执行（建议 crontab 周一 11:00）。
#
# 用法：/Users/oliver/guru/监测汇总/scripts/sync_dbs_and_deploy.sh
# 定时：0 11 * * 1（每周一 11:00）
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GURU_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
PUBLIC_DIR="$REPO_ROOT/public"
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/sync_dbs_and_deploy_$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log_err() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" | tee -a "$LOG_FILE" >&2
}

# 源路径
SENSORTOWER_DB="$GURU_ROOT/sensortower/data/sensortower_top100.db"
COMPETITOR_DB="$GURU_ROOT/-/db/competitor_data.db"
COMPETITOR_DB_ALT="$GURU_ROOT/-/database/db/competitor_data.db"
WECHAT_DB="$GURU_ROOT/wechat-mini-game-ranking-post/data/videos.db"

# 目标均在 public 下，覆盖
TARGET_SENSORTOWER="$PUBLIC_DIR/sensortower_top100.db"
TARGET_COMPETITOR="$PUBLIC_DIR/competitor_data.db"
TARGET_WECHAT="$PUBLIC_DIR/wechatdouyin.db"

log "========== 开始同步数据库并部署 =========="
log "监测汇总目录: $REPO_ROOT"
log "public 目录: $PUBLIC_DIR"

# 1. 同步 sensortower 数据库
if [ -f "$SENSORTOWER_DB" ]; then
  cp -f "$SENSORTOWER_DB" "$TARGET_SENSORTOWER"
  log "已同步 sensortower: $SENSORTOWER_DB -> $TARGET_SENSORTOWER"
else
  log_err "未找到 sensortower 数据库: $SENSORTOWER_DB，跳过"
fi

# 2. 同步竞品数据库（优先 db/，其次 database/db/）
if [ -f "$COMPETITOR_DB" ]; then
  cp -f "$COMPETITOR_DB" "$TARGET_COMPETITOR"
  log "已同步竞品: $COMPETITOR_DB -> $TARGET_COMPETITOR"
elif [ -f "$COMPETITOR_DB_ALT" ]; then
  cp -f "$COMPETITOR_DB_ALT" "$TARGET_COMPETITOR"
  log "已同步竞品: $COMPETITOR_DB_ALT -> $TARGET_COMPETITOR"
else
  log_err "未找到竞品数据库: $COMPETITOR_DB 或 $COMPETITOR_DB_ALT，跳过"
fi

# 3. 同步微信/抖音小游戏数据库（videos.db -> wechatdouyin.db）
if [ -f "$WECHAT_DB" ]; then
  cp -f "$WECHAT_DB" "$TARGET_WECHAT"
  log "已同步 wechat-mini-game: $WECHAT_DB -> $TARGET_WECHAT"
else
  log_err "未找到 wechat 数据库: $WECHAT_DB，跳过"
fi

# 4. 在监测汇总下执行 deploy
log "开始执行 npm run deploy ..."
cd "$REPO_ROOT"
if npm run deploy >> "$LOG_FILE" 2>&1; then
  log "npm run deploy 完成"
else
  log_err "npm run deploy 失败"
  exit 1
fi

log "========== 同步并部署结束 =========="
