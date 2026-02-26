#!/usr/bin/env bash
#
# 每周一执行：将 sensortower、竞品(-)、wechat-mini-game-ranking-post 的数据库
# 同步到监测汇总/public 并覆盖原库；用 generate_top5_insight.py 生成最新一周异动分析；
# 然后执行 npm run deploy，成功后再推送游戏检测周报与竞品周报。
# 通过「等待源库今日已更新」保证在 sensortower（约 30min～1h）和竞品周报完成后再执行，
# 而非单纯靠时间点（crontab 建议 11:30 触发，脚本内会轮询等待）。
#
# 用法：/Users/oliver/guru/监测汇总/scripts/sync_dbs_and_deploy.sh
# 定时：30 11 * * 1（每周一 11:30 开始，内部最多等 90 分钟直到源就绪）
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GURU_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
PUBLIC_DIR="$REPO_ROOT/public"
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/sync_dbs_and_deploy_$(date +%Y-%m-%d).log"

# 等待源就绪：今日 10:00 之后修改的才视为「本周一任务已更新」
CUTOFF_HOUR="${SYNC_CUTOFF_HOUR:-10}"
WAIT_INTERVAL="${SYNC_WAIT_INTERVAL:-300}"   # 秒，默认 5 分钟
WAIT_MAX="${SYNC_WAIT_MAX:-5400}"            # 秒，默认 90 分钟

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

# 获取「今日 CUTOFF_HOUR:00」的时间戳（用于判断文件是否已被今日任务更新）
get_cutoff_epoch() {
  local today
  today=$(date +%Y-%m-%d)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    date -j -f "%Y-%m-%d %H:%M" "$today $CUTOFF_HOUR:00" "+%s"
  else
    date -d "$today $CUTOFF_HOUR:00" "+%s"
  fi
}

# 检查单个文件是否存在且在 cutoff 之后有修改
is_fresh() {
  local file="$1"
  local cutoff_epoch="$2"
  [[ -f "$file" ]] || return 1
  local mtime
  mtime=$(stat -f "%m" "$file" 2>/dev/null || stat -c "%Y" "$file" 2>/dev/null)
  [[ -n "$mtime" && "$mtime" -ge "$cutoff_epoch" ]] || return 1
}

# 等待三个源库都在今日 10:00 之后被更新（或超时后继续，避免无限等）
wait_until_sources_ready() {
  local cutoff_epoch
  cutoff_epoch=$(get_cutoff_epoch)
  local waited=0
  log "等待源库就绪（今日 ${CUTOFF_HOUR}:00 之后已更新），每 ${WAIT_INTERVAL}s 检查一次，最多等 $((WAIT_MAX / 60)) 分钟"

  while true; do
    local competitor_file="$COMPETITOR_DB"
    [[ -f "$COMPETITOR_DB" ]] || competitor_file="$COMPETITOR_DB_ALT"

    if is_fresh "$SENSORTOWER_DB" "$cutoff_epoch" \
       && is_fresh "$competitor_file" "$cutoff_epoch" \
       && is_fresh "$WECHAT_DB" "$cutoff_epoch"; then
      log "源库均已就绪，开始同步"
      return 0
    fi

    if [[ $waited -ge $WAIT_MAX ]]; then
      log "等待超时（${WAIT_MAX}s），将使用当前已有的源库继续执行（可能含未更新数据）"
      return 0
    fi

    log "源库尚未全部就绪，${WAIT_INTERVAL}s 后重试（已等 $((waited / 60)) 分钟）..."
    sleep "$WAIT_INTERVAL"
    waited=$((waited + WAIT_INTERVAL))
  done
}

log "========== 开始同步数据库并部署 =========="
log "监测汇总目录: $REPO_ROOT"
log "public 目录: $PUBLIC_DIR"

wait_until_sources_ready

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

# 4. 使用已同步的 sensortower 库生成最新一周的 Top5 异动分析
log "开始生成最新一周异动分析（generate_top5_insight.py）..."
cd "$REPO_ROOT"
if [ -d "$REPO_ROOT/.venv" ] && [ -f "$REPO_ROOT/.venv/bin/activate" ]; then
  # shellcheck source=/dev/null
  source "$REPO_ROOT/.venv/bin/activate"
fi
if python3 "$REPO_ROOT/scripts/generate_top5_insight.py" --db "$PUBLIC_DIR/sensortower_top100.db" --out-dir "$PUBLIC_DIR/休闲游戏检测/sensortower_周报" >> "$LOG_FILE" 2>&1; then
  log "异动分析生成完成"
else
  log_err "异动分析生成失败，继续执行部署"
  # 不 exit，允许后续 deploy 照常进行
fi

# 5. 在监测汇总下执行 deploy
log "开始执行 npm run deploy ..."
cd "$REPO_ROOT"
if ! npm run deploy >> "$LOG_FILE" 2>&1; then
  log_err "npm run deploy 失败，不推送游戏周报与竞品周报"
  exit 1
fi
log "npm run deploy 完成"

# 6. deploy 成功后推送游戏检测周报（依赖 sensortower 数据与已部署网站）
log "开始推送游戏检测周报 ..."
if /bin/bash "$REPO_ROOT/scripts/run_reports.sh" --content game >> "$LOG_FILE" 2>&1; then
  log "游戏检测周报推送完成"
else
  log_err "游戏检测周报推送失败"
  exit 1
fi

# 7. 推送竞品周报
log "开始推送竞品周报 ..."
if /bin/bash "$GURU_ROOT/-/run-weekly-period-workflow.sh" >> "$LOG_FILE" 2>&1; then
  log "竞品周报推送完成"
else
  log_err "竞品周报推送失败"
  exit 1
fi

log "========== 同步、部署、游戏周报与竞品周报推送结束 =========="
