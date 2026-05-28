#!/usr/bin/env bash
#
# Unified local operations entrypoint for monitor-web.
#
# Examples:
#   scripts/ops/monitor_web_ops.sh status
#   scripts/ops/monitor_web_ops.sh restart-api
#   scripts/ops/monitor_web_ops.sh restart-tunnel
#   scripts/ops/monitor_web_ops.sh restart-all
#   scripts/ops/monitor_web_ops.sh check-chain
#   scripts/ops/monitor_web_ops.sh tail-logs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$REPO_ROOT/logs"
DOMAIN="gui/$(id -u)"

API_LABEL="${MONITOR_API_LABEL:-com.ggbond.monitor-web-api}"
TUNNEL_LABEL="${MONITOR_TUNNEL_LABEL:-com.ggbond.monitor-web-cloudflared}"
WATCHDOG_LABEL="${MONITOR_WATCHDOG_LABEL:-com.ggbond.monitor-web-watchdog}"
API_LOCAL_URL="${MONITOR_API_LOCAL_URL:-http://127.0.0.1:3001/openapi.json}"
API_BASE="${MONITOR_API_BASE_URL:-}"

cd "$REPO_ROOT"
export PATH="${PATH:-}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

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

resolve_api_base() {
  if [[ -n "$API_BASE" ]]; then
    printf '%s\n' "${API_BASE%/}"
    return 0
  fi
  local from_file
  from_file="$(read_env_value "$REPO_ROOT/.env.production" VITE_API_BASE_URL || true)"
  printf '%s\n' "${from_file:-https://api.gurublog.uk}" | sed 's#/*$##'
}

is_loaded() {
  launchctl print "$DOMAIN/$1" >/dev/null 2>&1
}

kickstart_label() {
  local label="$1"
  if ! is_loaded "$label"; then
    return 1
  fi
  launchctl kickstart -k "$DOMAIN/$label"
}

print_curl_status() {
  local label="$1"
  local url="$2"
  local timeout="${3:-10}"
  local result
  result="$(curl -sfS --max-time "$timeout" -o /dev/null -w '%{http_code} %{time_total}' "$url" 2>&1)" || {
    printf 'FAIL  %-18s %s\n' "$label" "$result"
    return 1
  }
  printf 'OK    %-18s %s\n' "$label" "$result"
}

sanitize_cloudflared_ps() {
  ps -axo pid,ppid,stat,lstart,command \
    | awk '/cloudflared/ && !/awk / {print}' \
    | sed -E 's/(--token )[A-Za-z0-9._=-]+/\1***/g'
}

status() {
  local remote_base
  remote_base="$(resolve_api_base)"
  echo "repo=$REPO_ROOT"
  echo "domain=$DOMAIN"
  echo
  echo "LaunchAgents:"
  for label in "$API_LABEL" "$TUNNEL_LABEL" "$WATCHDOG_LABEL"; do
    if is_loaded "$label"; then
      launchctl list | awk -v label="$label" '$3 == label {print "OK    " $0}'
    else
      echo "MISS  $label"
    fi
  done
  echo
  echo "HTTP:"
  print_curl_status "local-api" "$API_LOCAL_URL" 10 || true
  print_curl_status "remote-api" "$remote_base/openapi.json" 20 || true
  echo
  echo "Processes:"
  sanitize_cloudflared_ps || true
  ps -axo pid,ppid,stat,lstart,command | awk '/uvicorn main:app/ && !/awk / {print}'
  echo
  if [[ -f "$LOG_DIR/monitor_chain_last_status.md" ]]; then
    echo "Last monitor-chain status:"
    sed -n '1,18p' "$LOG_DIR/monitor_chain_last_status.md"
  fi
}

restart_api() {
  if ! kickstart_label "$API_LABEL"; then
    "$REPO_ROOT/scripts/install_monitor_web_api_launchagent.sh"
  fi
  sleep 3
  print_curl_status "local-api" "$API_LOCAL_URL" 10
}

restart_tunnel() {
  if ! kickstart_label "$TUNNEL_LABEL"; then
    "$REPO_ROOT/scripts/install_monitor_web_cloudflared_launchagent.sh"
  fi
  sleep 8
  print_curl_status "remote-api" "$(resolve_api_base)/openapi.json" 25
}

restart_all() {
  restart_api
  restart_tunnel
}

check_chain() {
  SYNC_SKIP_STATUS_PUSH="${SYNC_SKIP_STATUS_PUSH:-1}" "$REPO_ROOT/scripts/check_monitor_chain.sh"
}

check_api_data() {
  local py="$REPO_ROOT/.venv/bin/python"
  [[ -x "$py" ]] || py="$(command -v python3)"
  "$py" "$REPO_ROOT/scripts/check_monitor_api_data.py" \
    --api-base "$(resolve_api_base)" \
    --report-date "${SYNC_REPORT_DATE:-$(date +%Y-%m-%d)}" \
    --skip-business-check
}

tail_logs() {
  for file in \
    "$LOG_DIR/backend-api.err.log" \
    "$LOG_DIR/backend-api.out.log" \
    "$LOG_DIR/cloudflared-api.err.log" \
    "$LOG_DIR/cloudflared-api.out.log" \
    "$LOG_DIR/monitor_web_watchdog.err.log" \
    "$LOG_DIR/monitor_web_watchdog.out.log" \
    "$LOG_DIR/sync_dbs_cron.log"; do
    [[ -f "$file" ]] || continue
    echo "========== $file =========="
    tail -n "${TAIL_LINES:-80}" "$file"
  done
}

install_agents() {
  "$REPO_ROOT/scripts/install_monitor_web_api_launchagent.sh"
  "$REPO_ROOT/scripts/install_monitor_web_cloudflared_launchagent.sh"
  "$REPO_ROOT/scripts/install_monitor_web_watchdog_launchagent.sh"
}

usage() {
  cat <<USAGE
Usage: $0 <command>

Commands:
  status          Show LaunchAgent, process, local API, remote API status
  restart-api     Restart or install monitor-web FastAPI LaunchAgent
  restart-tunnel  Restart or install named Cloudflare tunnel LaunchAgent
  restart-all     Restart API, then tunnel
  check-chain     Run monitor-web check-only chain
  check-api-data  Download remote /api/data DB snapshots and quick-check them
  tail-logs       Tail monitor-web API/tunnel/watchdog logs
  install-agents  Install API, tunnel, and watchdog LaunchAgents
  prune-tunnels   Kill unmanaged duplicate named cloudflared tunnel processes
USAGE
}

prune_tunnels() {
  local managed_pid
  managed_pid="$(launchctl list | awk -v label="$TUNNEL_LABEL" '$3 == label {print $1}' | tail -n 1)"
  if [[ -z "$managed_pid" || "$managed_pid" == "-" ]]; then
    echo "未找到已加载的 $TUNNEL_LABEL；不清理 named tunnel 进程" >&2
    return 1
  fi
  ps -axo pid=,command= \
    | awk -v keep="$managed_pid" '/cloudflared/ && / tunnel run / && /--token / {if ($1 != keep) print $1}' \
    | while read -r pid; do
        [[ -n "$pid" ]] || continue
        echo "killing unmanaged cloudflared named tunnel pid=$pid"
        kill "$pid" 2>/dev/null || true
      done
}

cmd="${1:-status}"
case "$cmd" in
  status) status ;;
  restart-api) restart_api ;;
  restart-tunnel) restart_tunnel ;;
  restart-all) restart_all ;;
  check-chain) check_chain ;;
  check-api-data) check_api_data ;;
  tail-logs) tail_logs ;;
  install-agents) install_agents ;;
  prune-tunnels) prune_tunnels ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
