#!/usr/bin/env bash
#
# 每周一建议 08:45 触发（crontab）：按固定顺序执行
#   1) 等待上游源库就绪（后端 /api/data 直接读取这些源库的请求级 SQLite 快照）
#   2) 校验四库业务完整性，并生成 API 本机可读取的小游戏周报 JSON
#   3) 默认探测 CF/API 与远端 /api/data 快照后 deploy:api，再幂等推送三条报告；
#      若 SYNC_CHECK_ONLY=1，则只做源库/业务/API 数据链路检查，不部署、不推送。
#
# 本脚本不再复制 .db 到 monitor-web/public/，也不发布静态备用 .db；数据库备份由各上游项目自行完成。
#
# 环境变量（可选）：
#   SYNC_REPORT_DATE=YYYY-MM-DD — 指定本次报告日期；默认 today。周一运行时指本周一，小游戏/竞品取其前一周。
#   SYNC_CUTOFF_HOUR / SYNC_WAIT_INTERVAL / SYNC_WAIT_MAX — 见下方 wait 逻辑
#   SYNC_ALLOW_STALE_SOURCES=1 — 源库等待超时后仍继续（默认中止，避免发旧数据）
#   SYNC_CHECK_ONLY=1 — 只检查链路连通性：源库就绪、业务完整性、API 可达、/api/data 四库快照可读；不 deploy、不推送
#   SYNC_SKIP_DEPLOY=1 — 跳过 deploy:api（仅校验+生成产物+推送，数据仍由 API 直连源库读取）
#   SYNC_SKIP_API_CHECK=1 — 不探测 API，始终 deploy:api（确认后端已恢复时用；可无 curl）
#   MONITOR_API_BASE_URL — 健康检查用的 API 根，默认读 .env.production 的 VITE_API_BASE_URL，再默认 https://api.gurublog.uk
#   MONITOR_API_HEALTH_PATH — 健康检查路径，默认 /openapi.json
#   MONITOR_API_TOKEN — 可选：用于 /api/data 检查；默认用 backend/.env 的 JWT_SECRET/LOGIN_USERNAME 生成短期 Bearer token
#   MONITOR_API_DATA_TIMEOUT=60 — /api/data 单库下载超时时间
#   SYNC_API_DATA_ATTEMPTS=2 / SYNC_API_DATA_RETRY_SLEEP=20 — /api/data 快照校验失败后的重试策略
#   SYNC_SKIP_PUSH=1 — 跳过推送
#   SYNC_FORCE_PUSH=1 / FORCE_PUSH=1 — 忽略 sent marker，强制重发默认推送
#   SYNC_PUSH_ATTEMPTS=3 / SYNC_PUSH_RETRY_SLEEP=90 — 单条推送失败（如飞书限流）后的重试策略
#   SYNC_PUSH_CMD — 若设置：整条替换步骤 5，执行 bash -lc "$SYNC_PUSH_CMD"（自行负责顺序、幂等与失败策略）
#   SYNC_PYTHON_BIN — 固定 Python 解释器；默认优先 .venv/bin/python，再 python3
#   SYNC_SKIP_STATUS_PUSH=1 — 只写状态文件，不发送飞书/企微状态摘要
#   SYNC_LOG_RETENTION_DAYS=30 — 清理旧 sync_dbs_and_deploy_*.log 的保留天数
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
REPORT_DATE="${SYNC_REPORT_DATE:-$(date +%Y-%m-%d)}"
LOG_FILE="$LOG_DIR/sync_dbs_and_deploy_$(date +%Y-%m-%d).log"
STATUS_FILE="$LOG_DIR/monitor_chain_status_${REPORT_DATE}.md"
LAST_STATUS_FILE="$LOG_DIR/monitor_chain_last_status.md"
SENT_DIR="$LOG_DIR/sent"

# 默认 7：要求源库「今日 07:00 之后」有修改，以便 7:30 上游与 8:30 我方产品日更跑完后，8:45 同步能通过就绪检查。
# 若仍设 10，则 8:45 跑会长时间等到 10:00 以后才有「今日已更新」。
CUTOFF_HOUR="${SYNC_CUTOFF_HOUR:-7}"
WAIT_INTERVAL="${SYNC_WAIT_INTERVAL:-300}"
WAIT_MAX="${SYNC_WAIT_MAX:-5400}"
DEPLOY_MODE="pending"

mkdir -p "$LOG_DIR" "$SENT_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log_err() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" | tee -a "$LOG_FILE" >&2
}

cd "$REPO_ROOT"

# cron 下常见 PATH 不足
export PATH="${PATH:-}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if [[ -f "$REPO_ROOT/.venv/bin/activate" ]]; then
  # shellcheck source=/dev/null
  source "$REPO_ROOT/.venv/bin/activate"
fi

resolve_python_bin() {
  if [[ -n "${SYNC_PYTHON_BIN:-}" ]]; then
    printf '%s\n' "$SYNC_PYTHON_BIN"
    return 0
  fi
  if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
    printf '%s\n' "$REPO_ROOT/.venv/bin/python"
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi
  return 1
}

PYTHON_BIN="$(resolve_python_bin)" || {
  log_err "未找到 Python。请安装 python3，或设置 SYNC_PYTHON_BIN=/path/to/python"
  exit 1
}

compute_week_info() {
  "$PYTHON_BIN" - "$REPORT_DATE" <<'PY'
import sys
from datetime import datetime, timedelta

report_date = datetime.strptime(sys.argv[1][:10], "%Y-%m-%d")
end_date = report_date - timedelta(days=1)
start_date = end_date - timedelta(days=6)
print(start_date.strftime("%Y-%m-%d"), end_date.strftime("%Y-%m-%d"), f"{start_date:%Y-%m-%d}~{end_date:%Y-%m-%d}")
PY
}

read -r TARGET_WEEK_START TARGET_WEEK_END TARGET_WEEK_RANGE <<< "$(compute_week_info)"

STATUS_LINES=()
status_line() {
  STATUS_LINES+=("- $*")
}

send_status_summary() {
  local final_status="$1"
  local exit_code="$2"
  {
    echo "# monitor-web 定时链路${final_status}"
    echo
    echo "- report_date: ${REPORT_DATE}"
    echo "- target_week: ${TARGET_WEEK_RANGE}"
    echo "- deploy_mode: ${DEPLOY_MODE}"
    echo "- exit_code: ${exit_code}"
    echo "- log: ${LOG_FILE}"
    if [[ ${#STATUS_LINES[@]} -gt 0 ]]; then
      echo
      printf '%s\n' "${STATUS_LINES[@]}"
    fi
  } > "$STATUS_FILE"
  cp -f "$STATUS_FILE" "$LAST_STATUS_FILE"

  if [[ "${SYNC_SKIP_STATUS_PUSH:-}" == "1" ]]; then
    log "状态摘要已写入：${STATUS_FILE}（SYNC_SKIP_STATUS_PUSH=1，不推送）"
    return 0
  fi
  "$PYTHON_BIN" "$SCRIPT_DIR/send_monitor_chain_status.py" \
    --title "monitor-web 定时链路${final_status}" \
    --body-file "$STATUS_FILE" \
    --feishu-only >> "$LOG_FILE" 2>&1
}

LOCK_DIR="$LOG_DIR/sync_dbs_and_deploy.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log_err "已有 sync_dbs_and_deploy 正在运行：$LOCK_DIR"
  exit 1
fi

on_exit() {
  local code=$?
  set +e
  rmdir "$LOCK_DIR" 2>/dev/null || true
  if [[ $code -eq 0 ]]; then
    send_status_summary "成功" "$code" || log_err "状态摘要发送失败（主流程已成功）"
  else
    send_status_summary "失败" "$code" || true
  fi
  exit "$code"
}
trap on_exit EXIT

rotate_old_logs() {
  local days="${SYNC_LOG_RETENTION_DAYS:-30}"
  [[ "$days" =~ ^[0-9]+$ ]] || return 0
  find "$LOG_DIR" -type f \( -name 'sync_dbs_and_deploy_*.log' -o -name 'monitor_chain_status_*.md' \) -mtime +"$days" -delete 2>/dev/null || true
  find "$SENT_DIR" -type f -name '*.sent' -mtime +180 -delete 2>/dev/null || true
}

rotate_old_logs

log "========== monitor-web 定时链路启动 =========="
log "REPORT_DATE=$REPORT_DATE | TARGET_WEEK=$TARGET_WEEK_RANGE | PYTHON=$($PYTHON_BIN --version 2>&1)"
status_line "启动：report_date=${REPORT_DATE}，target_week=${TARGET_WEEK_RANGE}"

# 源路径（与 ~/lyb 下各项目一致）
SENSORTOWER_DB="$GURU_ROOT/sensortower-/data/sensortower_top100.db"
COMPETITOR_DB="$GURU_ROOT/Olivr-competitor-monitor/db/competitor_data.db"
COMPETITOR_DB_ALT="${COMPETITOR_DB_ALT:-}"
WECHAT_DB="$GURU_ROOT/wechat-mini-game-ranking-post/data/wechatdouyin.db"
OUR_PRODUCT_DB="${OUR_PRODUCT_DB:-$GURU_ROOT/sensortower-/data/us_free_appid_weekly.db}"
OUR_PRODUCT_DB_ALT="${OUR_PRODUCT_DB_ALT:-$GURU_ROOT/sensortower-/data/us free app id.db}"
OUR_PRODUCT_DB_LEGACY="${OUR_PRODUCT_DB_LEGACY:-$GURU_ROOT/sensortower/data/us_free_appid_weekly.db}"
OUR_PRODUCT_DB_LEGACY_ALT="${OUR_PRODUCT_DB_LEGACY_ALT:-$GURU_ROOT/sensortower/data/us free app id.db}"

get_cutoff_epoch() {
  local today
  today=$(date +%Y-%m-%d)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    date -j -f "%Y-%m-%d %H:%M" "$today $CUTOFF_HOUR:00" "+%s"
  else
    date -d "$today $CUTOFF_HOUR:00" "+%s"
  fi
}

file_mtime_epoch() {
  local file="$1"
  stat -f "%m" "$file" 2>/dev/null || stat -c "%Y" "$file" 2>/dev/null
}

file_mtime_text() {
  local file="$1"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    date -r "$file" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || true
  else
    date -r "$file" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || true
  fi
}

is_fresh() {
  local file="$1"
  local cutoff_epoch="$2"
  [[ -f "$file" ]] || return 1
  local mtime
  mtime=$(file_mtime_epoch "$file")
  [[ -n "$mtime" && "$mtime" -ge "$cutoff_epoch" ]] || return 1
}

log_source_state() {
  local label="$1"
  local file="$2"
  local cutoff_epoch="$3"
  if [[ ! -f "$file" ]]; then
    log_err "$label 源库不存在：$file"
    return 0
  fi
  if is_fresh "$file" "$cutoff_epoch"; then
    log "$label 源库已就绪：$file (mtime=$(file_mtime_text "$file"))"
  else
    log "$label 源库未达 cutoff：$file (mtime=$(file_mtime_text "$file"))"
  fi
}

# 从 .env.production 读取 VITE_API_BASE_URL（不含引号与首尾空格）
read_env_production_api_base() {
  local f="$REPO_ROOT/.env.production"
  [[ -f "$f" ]] || { printf '%s\n' ''; return; }
  local line
  line="$(grep -E '^[[:space:]]*VITE_API_BASE_URL=' "$f" 2>/dev/null | grep -Ev '^[[:space:]]*#' | tail -n 1 || true)"
  [[ -n "$line" ]] || { printf '%s\n' ''; return; }
  local val="${line#*=}"
  val="${val//$'\r'/}"
  val="${val// /}"
  val="${val%\"}"
  val="${val#\"}"
  val="${val%\'}"
  val="${val#\'}"
  printf '%s\n' "$val"
}

# 用于健康检查的 API 根地址（无末尾 /）
resolve_monitor_api_base() {
  local b="${MONITOR_API_BASE_URL:-}"
  if [[ -z "$b" ]]; then
    b="$(read_env_production_api_base)"
  fi
  b="${b:-https://api.gurublog.uk}"
  b="${b%/}"
  printf '%s\n' "$b"
}

check_monitor_api_online() {
  if [[ "${SYNC_SKIP_API_CHECK:-}" == "1" ]]; then
    log "========== API 检测：已跳过（SYNC_SKIP_API_CHECK=1），将使用 deploy:api =========="
    return 0
  fi
  local base path url
  base="$(resolve_monitor_api_base)"
  path="${MONITOR_API_HEALTH_PATH:-/openapi.json}"
  [[ "$path" =~ ^/ ]] || path="/$path"
  url="${base}${path}"
  log "========== API 可达性检测（API-only；离线则中止）=========="
  log "GET $url"
  if curl -sfS --max-time 25 -o /dev/null "$url"; then
    if [[ "${SYNC_CHECK_ONLY:-}" == "1" ]]; then
      log "API 在线 -> 连通性检查通过: $base"
    else
      log "API 在线 -> 使用 deploy:api（账号登录 + API）: $base"
    fi
    return 0
  fi
  log_err "API 不可达或超时: $url"
  return 1
}

check_monitor_api_data() {
  if [[ "${SYNC_SKIP_API_CHECK:-}" == "1" ]]; then
    log "远端 /api/data 检查：已跳过（SYNC_SKIP_API_CHECK=1）"
    return 0
  fi
  local base
  base="$(resolve_monitor_api_base)"
  log "========== 远端 /api/data 四库快照校验 =========="
  local attempts="${SYNC_API_DATA_ATTEMPTS:-2}"
  local retry_sleep="${SYNC_API_DATA_RETRY_SLEEP:-20}"
  [[ "$attempts" =~ ^[0-9]+$ && "$attempts" -ge 1 ]] || attempts=2
  [[ "$retry_sleep" =~ ^[0-9]+$ && "$retry_sleep" -ge 0 ]] || retry_sleep=20

  local attempt=1
  local rc=0
  while [[ "$attempt" -le "$attempts" ]]; do
    log "远端 /api/data 校验尝试 ${attempt}/${attempts}"
    rc=0
    "$PYTHON_BIN" "$SCRIPT_DIR/check_monitor_api_data.py" \
      --api-base "$base" \
      --report-date "$REPORT_DATE" >> "$LOG_FILE" 2>&1 || rc=$?
    if [[ "$rc" -eq 0 ]]; then
      return 0
    fi
    if [[ "$attempt" -lt "$attempts" ]]; then
      log_err "远端 /api/data 校验失败（exit=${rc}），${retry_sleep}s 后重试"
      sleep "$retry_sleep"
    fi
    attempt=$((attempt + 1))
  done
  return "$rc"
}

current_competitor_source() {
  if [[ -f "$COMPETITOR_DB" ]]; then
    printf '%s\n' "$COMPETITOR_DB"
  elif [[ -n "${COMPETITOR_DB_ALT:-}" && -f "$COMPETITOR_DB_ALT" ]]; then
    printf '%s\n' "$COMPETITOR_DB_ALT"
  else
    printf '%s\n' "$COMPETITOR_DB"
  fi
}

current_our_product_source() {
  if [[ -f "$OUR_PRODUCT_DB" ]]; then
    printf '%s\n' "$OUR_PRODUCT_DB"
  elif [[ -n "${OUR_PRODUCT_DB_ALT:-}" && -f "$OUR_PRODUCT_DB_ALT" ]]; then
    printf '%s\n' "$OUR_PRODUCT_DB_ALT"
  elif [[ -n "${OUR_PRODUCT_DB_LEGACY:-}" && -f "$OUR_PRODUCT_DB_LEGACY" ]]; then
    printf '%s\n' "$OUR_PRODUCT_DB_LEGACY"
  elif [[ -n "${OUR_PRODUCT_DB_LEGACY_ALT:-}" && -f "$OUR_PRODUCT_DB_LEGACY_ALT" ]]; then
    printf '%s\n' "$OUR_PRODUCT_DB_LEGACY_ALT"
  else
    printf '%s\n' "$OUR_PRODUCT_DB"
  fi
}

wait_until_sources_ready() {
  local cutoff_epoch
  cutoff_epoch=$(get_cutoff_epoch)
  local waited=0
  log "等待源库就绪（今日 ${CUTOFF_HOUR}:00 之后已更新），每 ${WAIT_INTERVAL}s 检查一次，最多等 $((WAIT_MAX / 60)) 分钟"

  while true; do
    local competitor_file our_product_file
    competitor_file="$(current_competitor_source)"
    our_product_file="$(current_our_product_source)"

    if is_fresh "$SENSORTOWER_DB" "$cutoff_epoch" \
       && is_fresh "$competitor_file" "$cutoff_epoch" \
       && is_fresh "$WECHAT_DB" "$cutoff_epoch" \
       && is_fresh "$our_product_file" "$cutoff_epoch"; then
      log "源库均已就绪"
      status_line "源库 mtime 检查通过（cutoff=${CUTOFF_HOUR}:00）"
      return 0
    fi

    if [[ $waited -ge $WAIT_MAX ]]; then
      log_source_state "SensorTower" "$SENSORTOWER_DB" "$cutoff_epoch"
      log_source_state "竞品社媒" "$competitor_file" "$cutoff_epoch"
      log_source_state "微信/抖音" "$WECHAT_DB" "$cutoff_epoch"
      log_source_state "我方产品" "$our_product_file" "$cutoff_epoch"
      if [[ "${SYNC_ALLOW_STALE_SOURCES:-}" == "1" ]]; then
        log_err "等待超时（${WAIT_MAX}s），但 SYNC_ALLOW_STALE_SOURCES=1，继续执行（可能含未更新数据）"
        status_line "源库等待超时但被允许继续（SYNC_ALLOW_STALE_SOURCES=1）"
        return 0
      fi
      log_err "等待超时（${WAIT_MAX}s），默认中止，避免部署/推送旧数据；临时继续可设 SYNC_ALLOW_STALE_SOURCES=1"
      exit 1
    fi

    log "源库尚未全部就绪，${WAIT_INTERVAL}s 后重试（已等 $((waited / 60)) 分钟）..."
    sleep "$WAIT_INTERVAL"
    waited=$((waited + WAIT_INTERVAL))
  done
}

# --- 1) 源库就绪 ---
log "========== 1) 等待上游源库 =========="
log "监测汇总: $REPO_ROOT | GURU_ROOT: $GURU_ROOT"
wait_until_sources_ready

COMPETITOR_SOURCE="$(current_competitor_source)"
OUR_PRODUCT_SOURCE="$(current_our_product_source)"
log "源库路径：ST=$SENSORTOWER_DB"
log "源库路径：竞品=$COMPETITOR_SOURCE"
log "源库路径：微信/抖音=$WECHAT_DB"
log "源库路径：我方产品=$OUR_PRODUCT_SOURCE"
status_line "上游源库就绪；monitor-web API 将按请求读取源库快照"

# --- 2) 校验 + 生成本机 API 产物 ---
log "========== 2) 业务校验 + 生成本机 API 产物 =========="
"$PYTHON_BIN" "$SCRIPT_DIR/validate_monitor_chain_sources.py" \
  --report-date "$REPORT_DATE" \
  --sensortower-db "$SENSORTOWER_DB" \
  --competitor-db "$COMPETITOR_SOURCE" \
  --wechat-db "$WECHAT_DB" \
  --our-product-db "$OUR_PRODUCT_SOURCE" >> "$LOG_FILE" 2>&1
status_line "四库业务校验通过"

"$PYTHON_BIN" "$SCRIPT_DIR/send_wechat_douyin_weekly_push.py" \
  --db "$WECHAT_DB" \
  --date "$REPORT_DATE" \
  --write-json-only >> "$LOG_FILE" 2>&1
status_line "微信/抖音小游戏周报 JSON 已生成到本机 public/ai热点（由 API 读取）"

log "提示：API 后端通过 DATA_SOURCE_DB_PATHS 直连四份源库；本脚本不再复制 DB 到 public/。"

# --- 3) check-only：只做链路连通性检查 ---
if [[ "${SYNC_CHECK_ONLY:-}" == "1" ]]; then
  log "========== 3) 连通性检查（SYNC_CHECK_ONLY=1；不部署、不推送）=========="
  if ! command -v curl >/dev/null 2>&1; then
    log_err "未找到 curl（PATH 需含 /usr/bin），无法检查 API 连通性"
    exit 1
  fi
  if ! check_monitor_api_online; then
    DEPLOY_MODE="api_unreachable"
    log_err "API 不可达；check-only 中止"
    exit 1
  fi
  if ! check_monitor_api_data; then
    DEPLOY_MODE="api_data_unavailable"
    log_err "API 在线但 /api/data 四库快照读取或校验失败；check-only 中止"
    exit 1
  fi
  DEPLOY_MODE="check_only"
  status_line "API 可达；远端 /api/data 四库快照读取校验通过"
  status_line "源库/业务/API 数据链路连通性检查完成"
  log "========== 源库校验/产物 → API 连通性检查 全部结束 =========="
  exit 0
fi

# --- 3) 探测 API -> deploy:api ---
if [[ "${SYNC_SKIP_DEPLOY:-}" == "1" ]]; then
  DEPLOY_MODE="skipped"
  log "========== 3) 部署：已跳过（SYNC_SKIP_DEPLOY=1）=========="
  status_line "部署已跳过（SYNC_SKIP_DEPLOY=1）"
else
  if ! command -v npm >/dev/null 2>&1; then
    log_err "未找到 npm，无法部署"
    exit 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    if [[ "${SYNC_SKIP_API_CHECK:-}" != "1" ]]; then
      log_err "未找到 curl（PATH 需含 /usr/bin）；或设 SYNC_SKIP_API_CHECK=1 直接 deploy:api"
      exit 1
    fi
    log "未找到 curl；SYNC_SKIP_API_CHECK=1 时将跳过探测并 deploy:api"
  fi
  if [[ -z "${GIT_SSH_COMMAND:-}" ]]; then
    _git_ssh=$(git config --get core.sshCommand || true)
    if [[ -n "${_git_ssh:-}" ]]; then
      export GIT_SSH_COMMAND="$_git_ssh"
    fi
  fi

  if ! check_monitor_api_online; then
    DEPLOY_MODE="api_unreachable"
    log_err "API 不可达；已切到 API-only + 直连源库模式，不再发布静态备用 .db"
    exit 1
  fi
  DEPLOY_MODE="api"
  log "========== 3b) deploy:api =========="
  npm run deploy:api >> "$LOG_FILE" 2>&1
  log "deploy:api 完成"
  status_line "部署完成：deploy:api"
fi

if ! check_monitor_api_data; then
  log_err "远端 /api/data 四库快照读取或校验失败；中止推送，避免通知旧数据/坏数据"
  exit 1
fi
status_line "远端 /api/data 四库快照读取校验通过"

# --- 4) 推送 ---
if [[ "${SYNC_SKIP_PUSH:-}" == "1" ]]; then
  log "========== 4) 推送：已跳过（SYNC_SKIP_PUSH=1）=========="
  status_line "推送已跳过（SYNC_SKIP_PUSH=1）"
  log "========== 全部结束 =========="
  exit 0
fi

log "========== 4) 推送（三条：ST → 竞品社媒 → 微信/抖音；带 sent marker）=========="
if [[ -n "${SYNC_PUSH_CMD:-}" ]]; then
  log "使用 SYNC_PUSH_CMD 覆盖默认推送（调用方需自行负责幂等）"
  if bash -lc "$SYNC_PUSH_CMD" >> "$LOG_FILE" 2>&1; then
    log "SYNC_PUSH_CMD 执行完成"
    status_line "自定义推送命令执行完成"
  else
    log_err "SYNC_PUSH_CMD 执行失败"
    exit 1
  fi
else
  push_one() {
    local marker_key="$1"
    local name="$2"
    shift 2
    local marker="$SENT_DIR/${marker_key}.sent"
    local force="${SYNC_FORCE_PUSH:-${FORCE_PUSH:-}}"
	    if [[ -f "$marker" && "$force" != "1" ]]; then
	      log "${name} 已有 sent marker，跳过：${marker}（需要重发可设 SYNC_FORCE_PUSH=1）"
	      status_line "${name}：跳过（已发送）"
	      return 0
	    fi
	    local attempts="${SYNC_PUSH_ATTEMPTS:-3}"
	    local retry_sleep="${SYNC_PUSH_RETRY_SLEEP:-90}"
	    [[ "$attempts" =~ ^[0-9]+$ && "$attempts" -ge 1 ]] || attempts=3
	    [[ "$retry_sleep" =~ ^[0-9]+$ && "$retry_sleep" -ge 0 ]] || retry_sleep=90
	    local attempt=1
	    local rc=0
	    while [[ "$attempt" -le "$attempts" ]]; do
	      log "${name} 推送尝试 ${attempt}/${attempts}"
	      rc=0
	      "$@" >> "$LOG_FILE" 2>&1 || rc=$?
	      if [[ "$rc" -eq 0 ]]; then
	        break
	      fi
	      if [[ "$attempt" -lt "$attempts" ]]; then
	        log_err "${name} 推送失败（exit=${rc}），${retry_sleep}s 后重试"
	        sleep "$retry_sleep"
	      fi
	      attempt=$((attempt + 1))
	    done
	    if [[ "$rc" -eq 0 ]]; then
	      {
	        echo "sent_at=$(date '+%Y-%m-%d %H:%M:%S')"
	        echo "report_date=$REPORT_DATE"
	        echo "target_week=$TARGET_WEEK_RANGE"
	        echo "command=$*"
      } > "$marker"
	      log "${name} 推送完成，marker=${marker}"
	      status_line "${name}：推送完成"
	    else
	      log_err "${name} 推送失败（已重试 ${attempts} 次，last_exit=${rc}）"
	      exit 1
	    fi
	  }

  push_one "sensortower_${REPORT_DATE}" \
    "SensorTower 榜单周报" \
    "$PYTHON_BIN" "$REPO_ROOT/scripts/send_sensortower_weekly_push.py" --db "$SENSORTOWER_DB" --date "$REPORT_DATE"

  push_one "competitor_${TARGET_WEEK_END}" \
    "竞品社媒周报" \
    "$PYTHON_BIN" "$REPO_ROOT/scripts/send_competitor_social_weekly_push.py" --db "$COMPETITOR_SOURCE" --date "$TARGET_WEEK_END"

  push_one "wechatdouyin_${TARGET_WEEK_RANGE}" \
    "微信/抖音小游戏周报" \
    "$PYTHON_BIN" "$REPO_ROOT/scripts/send_wechat_douyin_weekly_push.py" --db "$WECHAT_DB" --date "$REPORT_DATE" --skip-json-write
fi

log "========== 源库校验/产物 → deploy:api → 幂等推送 全部结束 =========="
