#!/usr/bin/env bash
#
# 每周一建议 08:00 触发（crontab）：按固定顺序执行
#   1) 备份 public/*.db
#   2) 等待上游源库就绪后拷库到 public/
#   3) 部署静态站（npm run deploy：predeploy 会 build，再 strip + gh-pages）
#   4) 推送（三条，与 scripts/run_all_latest_reports.sh 一致）：
#        ST 榜单周报 → 竞品社媒周报 → 微信/抖音小游戏周报
#
# 环境变量（可选）：
#   SYNC_CUTOFF_HOUR / SYNC_WAIT_INTERVAL / SYNC_WAIT_MAX — 见下方 wait 逻辑
#   SYNC_SKIP_DEPLOY=1      — 跳过步骤 3（仅拷库+推送，慎用）
#   SYNC_SKIP_PUSH=1        — 跳过步骤 4
#   SYNC_PUSH_CMD           — 若设置：整条替换步骤 4，执行 bash -lc "$SYNC_PUSH_CMD"（自行负责顺序与失败策略）
#
# Cron 提示找不到 npm/node：在 crontab 里设置 PATH（含 Homebrew），或对 npm 使用绝对路径；
# 使用 nvm 时可在 crontab 中先 source nvm.sh。
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GURU_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
PUBLIC_DIR="$REPO_ROOT/public"
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/sync_dbs_and_deploy_$(date +%Y-%m-%d).log"

# 默认 7：要求源库「今日 07:00 之后」有修改，以便 7:30 上游跑完后、8:00 同步能通过就绪检查。
# 若仍设 10，则 8:00 跑会长时间等到 10:00 以后才有「今日已更新」。
# 注意：「我方产品」日更若在 8:30 写库，则周一 8:00 的同步仍早于该次写入；若需同一趟带上当日日更，请把同步改到 8:35 之后或设 SYNC_CUTOFF_HOUR=8 并把同步放在日更之后。
CUTOFF_HOUR="${SYNC_CUTOFF_HOUR:-7}"
WAIT_INTERVAL="${SYNC_WAIT_INTERVAL:-300}"
WAIT_MAX="${SYNC_WAIT_MAX:-5400}"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log_err() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" | tee -a "$LOG_FILE" >&2
}

cd "$REPO_ROOT"

# cron 下常见 PATH 不足
export PATH="${PATH:-}:/opt/homebrew/bin:/usr/local/bin"

if [[ -f "$REPO_ROOT/.venv/bin/activate" ]]; then
  # shellcheck source=/dev/null
  source "$REPO_ROOT/.venv/bin/activate"
fi

# 源路径（与 ~/lyb 下各项目一致）
SENSORTOWER_DB="$GURU_ROOT/sensortower-/data/sensortower_top100.db"
COMPETITOR_DB="$GURU_ROOT/Olivr-competitor-monitor/db/competitor_data.db"
COMPETITOR_DB_ALT="${COMPETITOR_DB_ALT:-}"
WECHAT_DB="$GURU_ROOT/wechat-mini-game-ranking-post/data/wechatdouyin.db"

TARGET_SENSORTOWER="$PUBLIC_DIR/sensortower_top100.db"
TARGET_COMPETITOR="$PUBLIC_DIR/competitor_data.db"
TARGET_WECHAT="$PUBLIC_DIR/wechatdouyin.db"

get_cutoff_epoch() {
  local today
  today=$(date +%Y-%m-%d)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    date -j -f "%Y-%m-%d %H:%M" "$today $CUTOFF_HOUR:00" "+%s"
  else
    date -d "$today $CUTOFF_HOUR:00" "+%s"
  fi
}

is_fresh() {
  local file="$1"
  local cutoff_epoch="$2"
  [[ -f "$file" ]] || return 1
  local mtime
  mtime=$(stat -f "%m" "$file" 2>/dev/null || stat -c "%Y" "$file" 2>/dev/null)
  [[ -n "$mtime" && "$mtime" -ge "$cutoff_epoch" ]] || return 1
}

wait_until_sources_ready() {
  local cutoff_epoch
  cutoff_epoch=$(get_cutoff_epoch)
  local waited=0
  log "等待源库就绪（今日 ${CUTOFF_HOUR}:00 之后已更新），每 ${WAIT_INTERVAL}s 检查一次，最多等 $((WAIT_MAX / 60)) 分钟"

  while true; do
    local competitor_file="$COMPETITOR_DB"
    if [[ ! -f "$competitor_file" && -n "${COMPETITOR_DB_ALT:-}" ]]; then
      competitor_file="$COMPETITOR_DB_ALT"
    fi

    if is_fresh "$SENSORTOWER_DB" "$cutoff_epoch" \
       && is_fresh "$competitor_file" "$cutoff_epoch" \
       && is_fresh "$WECHAT_DB" "$cutoff_epoch"; then
      log "源库均已就绪"
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

# --- 1) 备份 ---
log "========== 1) 备份 public/*.db =========="
if [[ -f "$SCRIPT_DIR/backup_public_dbs.sh" ]]; then
  bash "$SCRIPT_DIR/backup_public_dbs.sh" >> "$LOG_FILE" 2>&1 || log_err "备份失败（继续）"
else
  log_err "未找到 backup_public_dbs.sh，跳过备份"
fi

# --- 2) 拷库 ---
log "========== 2) 等待源库并拷库 =========="
log "监测汇总: $REPO_ROOT | GURU_ROOT: $GURU_ROOT"
wait_until_sources_ready

if [[ -f "$SENSORTOWER_DB" ]]; then
  cp -f "$SENSORTOWER_DB" "$TARGET_SENSORTOWER"
  log "已同步 sensortower: $SENSORTOWER_DB -> $TARGET_SENSORTOWER"
else
  log_err "未找到 sensortower 数据库: $SENSORTOWER_DB，跳过"
fi

if [[ -f "$COMPETITOR_DB" ]]; then
  cp -f "$COMPETITOR_DB" "$TARGET_COMPETITOR"
  log "已同步竞品: $COMPETITOR_DB -> $TARGET_COMPETITOR"
elif [[ -n "${COMPETITOR_DB_ALT:-}" && -f "$COMPETITOR_DB_ALT" ]]; then
  cp -f "$COMPETITOR_DB_ALT" "$TARGET_COMPETITOR"
  log "已同步竞品: $COMPETITOR_DB_ALT -> $TARGET_COMPETITOR"
else
  log_err "未找到竞品数据库，跳过"
fi

if [[ -f "$WECHAT_DB" ]]; then
  cp -f "$WECHAT_DB" "$TARGET_WECHAT"
  log "已同步 wechat-mini-game: $WECHAT_DB -> $TARGET_WECHAT"
else
  log_err "未找到 wechat 数据库: $WECHAT_DB，跳过"
fi

# --- 3) 部署 ---
if [[ "${SYNC_SKIP_DEPLOY:-}" == "1" ]]; then
  log "========== 3) 部署：已跳过（SYNC_SKIP_DEPLOY=1）=========="
else
  log "========== 3) 部署（npm run deploy）=========="
  if ! command -v npm >/dev/null 2>&1; then
    log_err "未找到 npm，无法部署"
    exit 1
  fi
  # 与 scripts/deploy.sh 一致：gh-pages 的 git clone 需 GIT_SSH_COMMAND（cron 下再导出一层更稳）
  if [[ -z "${GIT_SSH_COMMAND:-}" ]]; then
    _git_ssh=$(git config --get core.sshCommand || true)
    if [[ -n "${_git_ssh:-}" ]]; then
      export GIT_SSH_COMMAND="$_git_ssh"
    fi
  fi
  npm run deploy >> "$LOG_FILE" 2>&1
  log "部署完成"
fi

# --- 4) 推送 ---
if [[ "${SYNC_SKIP_PUSH:-}" == "1" ]]; then
  log "========== 4) 推送：已跳过（SYNC_SKIP_PUSH=1）=========="
  log "========== 全部结束 =========="
  exit 0
fi

log "========== 4) 推送（三条：ST → 竞品社媒 → 微信/抖音）=========="
if [[ -n "${SYNC_PUSH_CMD:-}" ]]; then
  log "使用 SYNC_PUSH_CMD 覆盖默认三条推送"
  if bash -lc "$SYNC_PUSH_CMD" >> "$LOG_FILE" 2>&1; then
    log "SYNC_PUSH_CMD 执行完成"
  else
    log_err "SYNC_PUSH_CMD 执行失败"
    exit 1
  fi
else
  push_one() {
    local name="$1"
    shift
    if "$@" >> "$LOG_FILE" 2>&1; then
      log "${name} 推送完成"
    else
      log_err "${name} 推送失败"
      exit 1
    fi
  }

  push_one "SensorTower 榜单周报" python3 "$REPO_ROOT/scripts/send_sensortower_weekly_push.py"
  push_one "竞品社媒周报" python3 "$REPO_ROOT/scripts/send_competitor_social_weekly_push.py"
  push_one "微信/抖音小游戏周报" python3 "$REPO_ROOT/scripts/send_wechat_douyin_weekly_push.py"
fi

log "========== 备份 → 拷库 → 部署 → 推送 全部结束 =========="
