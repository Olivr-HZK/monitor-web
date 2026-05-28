#!/usr/bin/env bash
#
# Watchdog for monitor-web API and Cloudflare tunnel.
# Runs safely under launchd StartInterval. It restarts local API/tunnel when
# checks fail, sends deduped alerts, and periodically verifies remote DB
# snapshots without doing full business validation every five minutes.

set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$REPO_ROOT/logs"
STATE_DIR="$LOG_DIR/state"
STATE_FILE="$STATE_DIR/monitor_web_watchdog.state"
LOCK_DIR="/tmp/monitor-web-watchdog.lock"
OPS="$SCRIPT_DIR/monitor_web_ops.sh"

LOCAL_URL="${MONITOR_API_LOCAL_URL:-http://127.0.0.1:3001/openapi.json}"
REMOTE_BASE="${MONITOR_API_BASE_URL:-}"
DB_CHECK_INTERVAL="${MONITOR_WATCHDOG_DB_CHECK_INTERVAL:-3600}"
ALERT_DEDUPE_SEC="${MONITOR_WATCHDOG_ALERT_DEDUPE_SEC:-3600}"

mkdir -p "$LOG_DIR" "$STATE_DIR"
cd "$REPO_ROOT"
export PATH="${PATH:-}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] previous watchdog run is still active"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

read_env_value() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 1
  awk -F= -v k="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 ~ "^[[:space:]]*" k "[[:space:]]*$" {
      v=$0
      sub(/^[^=]*=/, "", v)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      gsub(/^["'"'"']|["'"'"']$/, "", v)
      print v
    }
  ' "$file" | tail -n 1
}

resolve_remote_base() {
  if [[ -n "$REMOTE_BASE" ]]; then
    printf '%s\n' "${REMOTE_BASE%/}"
    return 0
  fi
  local from_file
  from_file="$(read_env_value "$REPO_ROOT/.env.production" VITE_API_BASE_URL || true)"
  printf '%s\n' "${from_file:-https://api.gurublog.uk}" | sed 's#/*$##'
}

load_state() {
  LAST_DB_CHECK_EPOCH=0
  LAST_ALERT_EPOCH=0
  LAST_STATUS="OK"
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$STATE_FILE" 2>/dev/null || true
  fi
}

save_state() {
  local tmp="${STATE_FILE}.tmp"
  {
    echo "LAST_DB_CHECK_EPOCH=${LAST_DB_CHECK_EPOCH:-0}"
    echo "LAST_ALERT_EPOCH=${LAST_ALERT_EPOCH:-0}"
    echo "LAST_STATUS=${LAST_STATUS:-OK}"
  } > "$tmp"
  mv "$tmp" "$STATE_FILE"
}

curl_ok() {
  local url="$1"
  local timeout="$2"
  curl -sfS --max-time "$timeout" -o /dev/null "$url" >/dev/null 2>&1
}

append_detail() {
  DETAILS+=("$*")
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

send_alert() {
  local title="$1"
  local status="$2"
  local tmp
  local matched
  local line
  tmp="$(mktemp)"
  {
    echo "# $title"
    echo
    echo "- 时间：$(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "- 状态：$status"
    echo "- 本机 API：$LOCAL_URL"
    echo "- 远端 API：$(resolve_remote_base)/openapi.json"
    echo "- Watchdog 日志：$LOG_DIR/monitor_web_watchdog.out.log"
    if [[ -s /tmp/monitor_web_watchdog_db_check.log ]]; then
      echo "- DB 快检日志：/tmp/monitor_web_watchdog_db_check.log"
    fi
    echo
    echo "## 异常摘要"
    matched=0
    for line in "${DETAILS[@]}"; do
      if [[ "$line" =~ failed|failing|restart|recovered|恢复|失败|异常 ]]; then
        echo "- $line"
        matched=$((matched + 1))
        [[ "$matched" -ge 8 ]] && break
      fi
    done
    if (( matched == 0 )); then
      echo "- $status"
    fi
  } > "$tmp"
  "$REPO_ROOT/.venv/bin/python" "$REPO_ROOT/scripts/send_monitor_chain_status.py" \
    --title "$title" \
    --body-file "$tmp" \
    --feishu-only >/dev/null 2>&1 \
    || python3 "$REPO_ROOT/scripts/send_monitor_chain_status.py" \
      --title "$title" \
      --body-file "$tmp" \
      --feishu-only >/dev/null 2>&1 \
    || true
  rm -f "$tmp"
}

run_db_check() {
  local py="$REPO_ROOT/.venv/bin/python"
  [[ -x "$py" ]] || py="$(command -v python3)"
  "$py" "$REPO_ROOT/scripts/check_monitor_api_data.py" \
    --api-base "$(resolve_remote_base)" \
    --report-date "$(date +%Y-%m-%d)" \
    --skip-business-check \
    --timeout "${MONITOR_WATCHDOG_DB_TIMEOUT:-45}" >/tmp/monitor_web_watchdog_db_check.log 2>&1
}

load_state
NOW="$(date +%s)"
DETAILS=()
FAIL=0
REMOTE_BASE_RESOLVED="$(resolve_remote_base)"

"$SCRIPT_DIR/rotate_monitor_logs.sh" >/dev/null 2>&1 || true

append_detail "watchdog start"

if ! curl_ok "$LOCAL_URL" 8; then
  FAIL=1
  append_detail "local API failed; restarting API LaunchAgent"
  "$OPS" restart-api >/tmp/monitor_web_watchdog_restart_api.log 2>&1 || append_detail "restart-api failed; see /tmp/monitor_web_watchdog_restart_api.log"
  sleep 5
  if curl_ok "$LOCAL_URL" 8; then
    append_detail "local API recovered after restart"
  else
    append_detail "local API still failing after restart"
  fi
else
  append_detail "local API ok"
fi

if ! curl_ok "$REMOTE_BASE_RESOLVED/openapi.json" 20; then
  FAIL=1
  append_detail "remote API failed; restarting tunnel LaunchAgent"
  "$OPS" restart-tunnel >/tmp/monitor_web_watchdog_restart_tunnel.log 2>&1 || append_detail "restart-tunnel failed; see /tmp/monitor_web_watchdog_restart_tunnel.log"
  sleep 10
  if curl_ok "$REMOTE_BASE_RESOLVED/openapi.json" 25; then
    append_detail "remote API recovered after tunnel restart"
  else
    append_detail "remote API still failing after tunnel restart"
  fi
else
  append_detail "remote API ok"
fi

if [[ "$DB_CHECK_INTERVAL" =~ ^[0-9]+$ ]] && (( NOW - ${LAST_DB_CHECK_EPOCH:-0} >= DB_CHECK_INTERVAL )); then
  append_detail "remote DB snapshot quick-check due"
  if run_db_check; then
    LAST_DB_CHECK_EPOCH="$NOW"
    append_detail "remote DB snapshot quick-check ok"
  else
    FAIL=1
    append_detail "remote DB snapshot quick-check failed; restarting API+tunnel once"
    "$OPS" restart-all >/tmp/monitor_web_watchdog_restart_all.log 2>&1 || append_detail "restart-all failed; see /tmp/monitor_web_watchdog_restart_all.log"
    sleep 12
    if run_db_check; then
      LAST_DB_CHECK_EPOCH="$NOW"
      append_detail "remote DB snapshot quick-check recovered after restart-all"
    else
      append_detail "remote DB snapshot quick-check still failing; see /tmp/monitor_web_watchdog_db_check.log"
    fi
  fi
fi

if (( FAIL == 0 )); then
  if [[ "${LAST_STATUS:-OK}" == "FAIL" ]]; then
    LAST_STATUS="OK"
    DETAILS=("monitor-web watchdog recovered")
    send_alert "monitor-web watchdog恢复" "OK"
  else
    LAST_STATUS="OK"
  fi
  save_state
  append_detail "watchdog ok"
  exit 0
fi

if (( NOW - ${LAST_ALERT_EPOCH:-0} >= ALERT_DEDUPE_SEC )); then
  LAST_ALERT_EPOCH="$NOW"
  LAST_STATUS="FAIL"
  send_alert "monitor-web watchdog失败" "FAIL"
else
  LAST_STATUS="FAIL"
  append_detail "alert suppressed by dedupe window"
fi
save_state
exit 0
