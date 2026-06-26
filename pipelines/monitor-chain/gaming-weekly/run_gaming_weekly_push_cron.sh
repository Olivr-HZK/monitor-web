#!/bin/bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$PROJECT_DIR/../../.." && pwd)"
PROJECT_NAME="Puzzle Game Weekly Report"

if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_DIR/.env"
  set +a
fi

RUNTIME_DIR="$PROJECT_DIR/.runtime"
STATE_DIR="$RUNTIME_DIR/cron_state"
LOCK_ROOT="$RUNTIME_DIR/cron_lock"
PATH_PREFIX="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"
# Weekly report push window: Monday 08:00 Asia/Shanghai.
PUSH_HHMM="08:00"
DRY_RUN=0
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      echo "Usage: run_gaming_weekly_push_cron.sh [--dry-run] [--force]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: run_gaming_weekly_push_cron.sh [--dry-run] [--force]" >&2
      exit 1
      ;;
  esac
done

export PATH="$PATH_PREFIX:${PATH:-}"

today_shanghai() {
  TZ=Asia/Shanghai date '+%F'
}

timestamp_shanghai() {
  TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S'
}

hhmm_shanghai() {
  TZ=Asia/Shanghai date '+%H:%M'
}

weekday_shanghai() {
  TZ=Asia/Shanghai date '+%u'
}

log_file() {
  printf '%s/gaming_weekly_push_%s.log\n' "$RUNTIME_DIR" "$(today_shanghai)"
}

push_ok_file() {
  printf '%s/%s.gaming-weekly-push.ok\n' "$STATE_DIR" "$(today_shanghai)"
}

push_failed_file() {
  printf '%s/%s.gaming-weekly-push.failed\n' "$STATE_DIR" "$(today_shanghai)"
}

lock_dir() {
  printf '%s/gaming-weekly-push.lock\n' "$LOCK_ROOT"
}

append_plain_log() {
  local file="$1"
  shift
  mkdir -p "$(dirname "$file")"
  printf '[%s] %s\n' "$(timestamp_shanghai)" "$*" >> "$file"
}

append_once_log() {
  local file="$1"
  local key="$2"
  shift 2
  local marker
  mkdir -p "$STATE_DIR"
  marker="$STATE_DIR/$(today_shanghai).gaming-weekly-push.notice.$key"
  if [[ -f "$marker" ]]; then
    return 0
  fi
  printf '%s\n' "$(timestamp_shanghai)" > "$marker"
  append_plain_log "$file" "$*"
}

acquire_lock() {
  local path="$1"
  mkdir -p "$LOCK_ROOT"
  mkdir "$path" 2>/dev/null
}

release_lock() {
  local path="$1"
  rmdir "$path" 2>/dev/null || true
}

run_push_command() {
  local file="$1"
  local python_bin="$2"
  local rc=0

  mkdir -p "$(dirname "$file")"
  {
    printf '===== %s start =====\n' "$(timestamp_shanghai)"
    printf '[%s] Project: %s\n' "$(timestamp_shanghai)" "$PROJECT_NAME"
    printf '[%s] Command: %s -c import-send_gaming_weekly-push\n' "$(timestamp_shanghai)" "$python_bin"
  } >> "$file"

  (
    cd "$PROJECT_DIR"
    "$python_bin" -c 'import send_gaming_weekly as weekly; raise SystemExit(0 if weekly._push_reports_from_snapshot(push_channels=["feishu", "wework"]) else 1)'
  ) >> "$file" 2>&1 || rc=$?

  if [[ $rc -ne 0 ]]; then
    printf '[%s] ERROR: Command failed with exit code %s\n' "$(timestamp_shanghai)" "$rc" >> "$file"
  fi
  printf '===== %s end =====\n' "$(timestamp_shanghai)" >> "$file"
  return "$rc"
}

PYTHON_BIN="$("$PROJECT_DIR/ensure_python_env.sh")"
LOG_FILE="$(log_file)"
CURRENT_HHMM="$(hhmm_shanghai)"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] project=$PROJECT_NAME"
  echo "[dry-run] python=$PYTHON_BIN"
  echo "[dry-run] log_file=$LOG_FILE"
  echo "[dry-run] allowed_push_time=Monday $PUSH_HHMM"
  echo "[dry-run] force=$FORCE"
  echo "[dry-run] state_push_ok=$(push_ok_file)"
  echo "[dry-run] state_push_failed=$(push_failed_file)"
  echo "[dry-run] lock_dir=$(lock_dir)"
fi

if [[ $FORCE -ne 1 && "$(weekday_shanghai)" != "1" ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] push would skip because today is not Monday"
  else
    append_once_log "$LOG_FILE" "not_monday" "Weekly push is limited to Monday; skipping."
  fi
  exit 0
fi

mkdir -p "$STATE_DIR"
if [[ -f "$(push_ok_file)" ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] push would skip because $(push_ok_file) exists"
  else
    append_once_log "$LOG_FILE" "already_ok" "Weekly push already completed for $(today_shanghai); skipping retry."
  fi
  exit 0
fi

if [[ -f "$(push_failed_file)" ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] push would skip because $(push_failed_file) exists"
  else
    append_once_log "$LOG_FILE" "already_failed" "Weekly push already marked failed for $(today_shanghai); skipping."
  fi
  exit 0
fi

if [[ $FORCE -ne 1 && "$CURRENT_HHMM" != "$PUSH_HHMM" ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] push would skip because current time is outside $PUSH_HHMM"
  else
    append_once_log "$LOG_FILE" "outside_window" "Weekly push trigger is limited to $PUSH_HHMM Asia/Shanghai; current time is $CURRENT_HHMM, skipping."
  fi
  exit 0
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] push would run: $PYTHON_BIN -c import-send_gaming_weekly-push"
  exit 0
fi

LOCK_DIR="$(lock_dir)"
if ! acquire_lock "$LOCK_DIR"; then
  append_once_log "$LOG_FILE" "lock_exists" "Lock exists at $LOCK_DIR; skipping concurrent run."
  exit 0
fi
trap 'release_lock "$LOCK_DIR"' EXIT

rc=0
run_push_command "$LOG_FILE" "$PYTHON_BIN" || rc=$?
if [[ $rc -eq 0 ]]; then
  printf '%s\n' "$(timestamp_shanghai)" > "$(push_ok_file)"
else
  printf '%s\n' "$(timestamp_shanghai)" > "$(push_failed_file)"
  append_once_log "$LOG_FILE" "terminal_failed" "ERROR: Weekly push failed at $PUSH_HHMM Asia/Shanghai."
fi

exit "$rc"
