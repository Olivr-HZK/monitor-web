#!/usr/bin/env bash
#
# Unified cron entrypoint for monitor-web related jobs.
# The source projects stay in place; this wrapper centralizes logs, locks,
# PATH setup, and job names under monitor-web.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
JOB_ID="${1:-}"

if [[ -n "$JOB_ID" ]]; then
  shift || true
fi

LYB_ROOT="${LYB_ROOT:-$(cd "$REPO_ROOT/.." && pwd)}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/workspace}"
OLIVER_ROOT="${OLIVER_ROOT:-$HOME/oliver}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
LOG_ROOT="${MONITOR_WEB_JOB_LOG_DIR:-$REPO_ROOT/logs/jobs}"
LOCK_ROOT="$LOG_ROOT/locks"
PATH_VALUE="${MONITOR_WEB_CRON_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin}"

export PATH="$PATH_VALUE:${PATH:-}"

usage() {
  cat <<'EOF'
Usage:
  scripts/cron/run_job.sh <job-id> [extra args...]

Environment overrides:
  LYB_ROOT=/Users/ggbond/lyb
  WORKSPACE_ROOT=/Users/ggbond/workspace
  OLIVER_ROOT=/Users/ggbond/oliver
  OPENCLAW_WORKSPACE=/Users/ggbond/.openclaw/workspace
  MONITOR_WEB_JOB_LOG_DIR=/path/to/logs/jobs
  JOB_DRY_RUN=1

Job ids:
  trendradar_ainews_prepare
  trendradar_daily_0800
  trendradar_daily_0900
  trendradar_ainews_push
  xiaohei_ainews_prepare
  xiaohei_ainews_prepare_if_needed
  xiaohei_ainews_push
  competitor_daily_scraper
  competitor_weekly_period
  wechat_douyin_weekly
  wechat_douyin_weekly_rerun
  sensortower_weekly
  sensortower_us_free_daily
  sensortower_arrow_madness_daily
  monitor_chain_check
  monitor_chain_checked_push
  monitor_reports_daily
  trustmrr_daily
  trustmrr_weekly_generate
  trustmrr_weekly_push
  aitools_cleanup_logs
  aitools_backup_db
  aitools_daily_scraper
  aitools_weekly_period
  gaming_daily
  gaming_weekly_generate
  gaming_weekly_push
  ai_video_enhancer_daily
  ai_ve_feedback_training_daily
  ai_arrow2_latest_daily
  ai_arrow2_exposure_wed_sat
  festivals_daily_bitable
  festivals_weekly_push
  task_butler_watch_send
EOF
}

if [[ -z "$JOB_ID" || "$JOB_ID" == "-h" || "$JOB_ID" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! "$JOB_ID" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "Invalid job id: $JOB_ID" >&2
  exit 2
fi

mkdir -p "$LOG_ROOT" "$LOCK_ROOT"
LOG_FILE="$LOG_ROOT/${JOB_ID}.log"
STATUS_FILE="$LOG_ROOT/${JOB_ID}.last_status"
LOCK_DIR="$LOCK_ROOT/${JOB_ID}.lock"
JOB_STATUS_KIND="ok"
JOB_STATUS_NOTE=""

exec >> "$LOG_FILE" 2>&1

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

describe_cmd() {
  local cwd="$1"
  shift
  printf 'cwd=%q cmd=' "$cwd"
  printf '%q ' "$@"
  printf '\n'
}

run_in() {
  local cwd="$1"
  shift

  if [[ ! -d "$cwd" ]]; then
    log "ERROR: working directory not found: $cwd"
    exit 66
  fi

  describe_cmd "$cwd" "$@"

  if [[ "${JOB_DRY_RUN:-}" == "1" ]]; then
    return 0
  fi

  (
    cd "$cwd"
    "$@"
  )
}

run_in_timeout() {
  local cwd="$1"
  local timeout_sec="$2"
  shift 2

  if [[ ! -d "$cwd" ]]; then
    log "ERROR: working directory not found: $cwd"
    exit 66
  fi

  describe_cmd "$cwd" "$@"

  if [[ "${JOB_DRY_RUN:-}" == "1" ]]; then
    return 0
  fi

  (
    cd "$cwd"
    "$@" &
    local child=$!
    (
      sleep "$timeout_sec"
      if kill -0 "$child" 2>/dev/null; then
        log "TIMEOUT: killing $JOB_ID after ${timeout_sec}s"
        kill "$child" 2>/dev/null || true
        sleep 5
        kill -9 "$child" 2>/dev/null || true
      fi
    ) &
    local watchdog=$!
    local code=0
    wait "$child" || code=$?
    kill "$watchdog" 2>/dev/null || true
    wait "$watchdog" 2>/dev/null || true
    return "$code"
  )
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "SKIP: job is already running: $JOB_ID"
  printf 'status=locked\njob=%s\ntime=%s\nlog=%s\n' "$JOB_ID" "$(date '+%Y-%m-%d %H:%M:%S')" "$LOG_FILE" > "$STATUS_FILE"
  exit "${JOB_LOCKED_EXIT_CODE:-75}"
fi

on_exit() {
  local code=$?
  set +e
  rmdir "$LOCK_DIR" 2>/dev/null || true
  if [[ "${JOB_DRY_RUN:-}" == "1" ]]; then
    log "DRY_RUN_DONE: $JOB_ID exit_code=$code"
    exit "$code"
  fi
  if [[ $code -eq 0 ]]; then
    local status_kind="${JOB_STATUS_KIND:-ok}"
    log "DONE: $JOB_ID"
    {
      printf 'status=%s\njob=%s\ntime=%s\nlog=%s\n' "$status_kind" "$JOB_ID" "$(date '+%Y-%m-%d %H:%M:%S')" "$LOG_FILE"
      if [[ -n "${JOB_STATUS_NOTE:-}" ]]; then
        printf 'note=%s\n' "$JOB_STATUS_NOTE"
      fi
    } > "$STATUS_FILE"
  else
    log "FAILED: $JOB_ID exit_code=$code"
    printf 'status=failed\njob=%s\nexit_code=%s\ntime=%s\nlog=%s\n' "$JOB_ID" "$code" "$(date '+%Y-%m-%d %H:%M:%S')" "$LOG_FILE" > "$STATUS_FILE"
  fi
  exit "$code"
}
trap on_exit EXIT

log "START: $JOB_ID"
log "repo=$REPO_ROOT lyb=$LYB_ROOT workspace=$WORKSPACE_ROOT oliver=$OLIVER_ROOT"

case "$JOB_ID" in
  trendradar_ainews_prepare)
    run_in "$LYB_ROOT/TrendRadar-deployment-20260316-134108" ./run_ainews_top20_daily.sh prepare "$@"
    ;;
  trendradar_daily_0800|trendradar_daily_0900)
    run_in "$LYB_ROOT/TrendRadar-deployment-20260316-134108" ./run_trendradar_daily.sh "$@"
    ;;
  trendradar_ainews_push)
    run_in "$LYB_ROOT/TrendRadar-deployment-20260316-134108" ./run_ainews_top20_daily.sh push "$@"
    ;;
  xiaohei_ainews_prepare)
    run_in_timeout "$LYB_ROOT/xiaohei-agent" "${XIAOHEI_JOB_TIMEOUT_SEC:-1800}" /bin/bash ./scripts/run_daily_cron.sh prepare --audit-profile auto "$@"
    ;;
  xiaohei_ainews_prepare_if_needed)
    run_in_timeout "$LYB_ROOT/xiaohei-agent" "${XIAOHEI_JOB_TIMEOUT_SEC:-1800}" /bin/bash ./scripts/run_daily_cron.sh guarded-prepare --audit-profile auto "$@"
    ;;
  xiaohei_ainews_push)
    run_in_timeout "$LYB_ROOT/xiaohei-agent" "${XIAOHEI_JOB_TIMEOUT_SEC:-1800}" /bin/bash ./scripts/run_daily_cron.sh guarded-push --audit-profile auto "$@"
    ;;
  competitor_daily_scraper)
    run_in "$REPO_ROOT/pipelines/monitor-chain/competitor-social" /bin/bash ./run-daily-scraper.sh "$@"
    ;;
  competitor_weekly_period)
    run_in "$REPO_ROOT/pipelines/monitor-chain/competitor-social" /bin/bash ./run-weekly-period-workflow.sh "$@"
    ;;
  wechat_douyin_weekly)
    run_in "$REPO_ROOT/pipelines/monitor-chain/wechat-douyin" /bin/bash ./scripts/weekly_wx_three_charts_scrape_and_import.sh "$@"
    ;;
  wechat_douyin_weekly_rerun)
    run_in "$REPO_ROOT/pipelines/monitor-chain/wechat-douyin" /bin/bash ./scripts/rerun_weekly_wx_three_charts_if_needed.sh "$@"
    ;;
  sensortower_weekly)
    export SKIP_SENSORTOWER_WEEKLY_PUSH="${SKIP_SENSORTOWER_WEEKLY_PUSH:-1}"
    run_in "$REPO_ROOT/pipelines/monitor-chain/sensortower" /bin/bash ./scripts/cron_run_weekly.sh "$@"
    ;;
  sensortower_us_free_daily)
    run_in "$REPO_ROOT/pipelines/monitor-chain/sensortower" /bin/bash ./scripts/cron_run_us_free_daily.sh "$@"
    ;;
  sensortower_arrow_madness_daily)
    run_in "$REPO_ROOT/pipelines/monitor-chain/sensortower" /bin/bash ./scripts/cron_run_arrow_madness_daily.sh "$@"
    ;;
  monitor_chain_check)
    run_in "$REPO_ROOT" /bin/bash ./scripts/check_monitor_chain.sh "$@"
    ;;
  monitor_chain_checked_push)
    export SYNC_SKIP_DEPLOY="${SYNC_SKIP_DEPLOY:-1}"
    run_in "$REPO_ROOT" /bin/bash ./scripts/sync_dbs_and_deploy.sh "$@"
    ;;
  monitor_reports_daily)
    run_in "$REPO_ROOT" /bin/bash ./scripts/run_reports.sh --content hot,ai "$@"
    ;;
  trustmrr_daily)
    run_in "$LYB_ROOT/trustmrr-feishu-push" ./run_trustmrr_cron.sh daily "$@"
    ;;
  trustmrr_weekly_generate)
    run_in "$LYB_ROOT/trustmrr-feishu-push" ./run_trustmrr_cron.sh weekly-generate "$@"
    ;;
  trustmrr_weekly_push)
    run_in "$LYB_ROOT/trustmrr-feishu-push" ./run_trustmrr_cron.sh weekly-push "$@"
    ;;
  aitools_cleanup_logs)
    run_in "$WORKSPACE_ROOT/AITools Competitor Monitor" /bin/bash ./scripts/cleanup-logs.sh "$@"
    ;;
  aitools_backup_db)
    run_in "$WORKSPACE_ROOT/AITools Competitor Monitor" /bin/bash ./scripts/backup-db.sh "$@"
    ;;
  aitools_daily_scraper)
    run_in "$WORKSPACE_ROOT/AITools Competitor Monitor" /bin/bash ./run-daily-scraper.sh "$@"
    ;;
  aitools_weekly_period)
    run_in "$WORKSPACE_ROOT/AITools Competitor Monitor" /bin/bash ./run-weekly-period-workflow.sh "$@"
    ;;
  gaming_daily)
    run_in "$LYB_ROOT/gaming-daily-report2" ./run_gaming_daily.sh "$@"
    ;;
  gaming_weekly_generate)
    run_in_timeout "$LYB_ROOT/gaming-daily-report2" "${GAMING_WEEKLY_GENERATE_TIMEOUT_SEC:-3600}" ./.venv/bin/python3 send_gaming_weekly.py --phase generate "$@"
    ;;
  gaming_weekly_push)
    JOB_STATUS_KIND="disabled"
    JOB_STATUS_NOTE="Local gaming weekly push is disabled; production push is owned by the server cron under /opt/gaming-daily-report2."
    log "DISABLED: local gaming_weekly_push will not send Feishu/WeCom messages or write push ok markers."
    ;;
  ai_video_enhancer_daily)
    run_in "$OLIVER_ROOT/ai-" /bin/bash ./scripts/cron_ai_video_enhancer_daily.sh "$@"
    ;;
  ai_ve_feedback_training_daily)
    run_in "$OLIVER_ROOT/ai-" /bin/bash ./scripts/cron_ve_feedback_training_daily.sh "$@"
    ;;
  ai_arrow2_latest_daily)
    run_in "$OLIVER_ROOT/ai-" /bin/bash ./scripts/cron_ai_arrow2_latest_daily.sh "$@"
    ;;
  ai_arrow2_exposure_wed_sat)
    run_in "$OLIVER_ROOT/ai-" /bin/bash ./scripts/cron_ai_arrow2_exposure_wed_sat.sh "$@"
    ;;
  festivals_daily_bitable)
    run_in "$LYB_ROOT/festivals-marketing" /bin/bash ./run-cron-task.sh daily-bitable "$@"
    ;;
  festivals_weekly_push)
    run_in "$LYB_ROOT/festivals-marketing" /bin/bash ./run-cron-task.sh weekly-push "$@"
    ;;
  task_butler_watch_send)
    run_in "$OPENCLAW_WORKSPACE" ./scripts/task_butler_status.py --watch-send "$@"
    ;;
  *)
    log "ERROR: unknown job id: $JOB_ID"
    usage
    exit 64
    ;;
esac
