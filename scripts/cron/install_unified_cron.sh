#!/usr/bin/env bash
#
# Install the unified monitor-web cron block.
#
# Default mode is preview-only. Use --apply to write crontab.
# Use --replace-known to remove the legacy lines/blocks that this unified
# block replaces, preventing duplicate scheduled runs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FRAGMENT="$SCRIPT_DIR/monitor-web-unified.cron.fragment.txt"
BACKUP_DIR="$REPO_ROOT/logs/cron-backups"
APPLY=0
REPLACE_KNOWN=0
PRINT_BLOCK=0

usage() {
  cat <<'EOF'
Usage:
  scripts/cron/install_unified_cron.sh [--print-block]
  scripts/cron/install_unified_cron.sh --apply [--replace-known]

Options:
  --print-block     Print the generated unified cron block only.
  --apply           Install the generated crontab.
  --replace-known   Remove known legacy monitor jobs before appending the block.

Recommended first install:
  scripts/cron/install_unified_cron.sh --apply --replace-known
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      ;;
    --replace-known)
      REPLACE_KNOWN=1
      ;;
    --print-block)
      PRINT_BLOCK=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ ! -f "$FRAGMENT" ]]; then
  echo "Missing fragment: $FRAGMENT" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

rendered_block="$(sed "s|__REPO_ROOT__|$REPO_ROOT|g" "$FRAGMENT")"

if [[ "$PRINT_BLOCK" == "1" ]]; then
  printf '%s\n' "$rendered_block"
  exit 0
fi

current="$(mktemp)"
next="$(mktemp)"
trap 'rm -f "$current" "$next"' EXIT

crontab -l > "$current" 2>/dev/null || true

REPO_ROOT="$REPO_ROOT" \
REPLACE_KNOWN="$REPLACE_KNOWN" \
CURRENT_CRON="$current" \
NEXT_CRON="$next" \
RENDERED_BLOCK="$rendered_block" \
python3 - <<'PY'
from __future__ import annotations

import os
from pathlib import Path

current_path = Path(os.environ["CURRENT_CRON"])
next_path = Path(os.environ["NEXT_CRON"])
replace_known = os.environ["REPLACE_KNOWN"] == "1"
rendered_block = os.environ["RENDERED_BLOCK"].rstrip() + "\n"

text = current_path.read_text() if current_path.exists() else ""
lines = text.splitlines()

managed_markers = [
    ("# BEGIN MONITOR_WEB_UNIFIED_CRON", "# END MONITOR_WEB_UNIFIED_CRON"),
]

legacy_blocks = [
]

legacy_patterns = [
    "Olivr-competitor-monitor && /bin/bash run-weekly-period-workflow.sh",
    "Olivr-competitor-monitor && /bin/bash run-daily-scraper.sh",
    "sensortower-/scripts/cron_run_us_free_daily.sh",
    "sensortower-/scripts/cron_run_weekly.sh",
    "sensortower-/scripts/cron_run_arrow_madness_daily.sh",
    "sensortower-/scripts/us_free_appid_weekly_rank_changes.js",
    "wechat-mini-game-ranking-post && /bin/bash ./scripts/weekly_scrape_and_import.sh",
    "wechat-mini-game-ranking-post && /bin/bash ./scripts/weekly_wx_three_charts_scrape_and_import.sh",
    "wechat-mini-game-ranking-post && /bin/bash ./scripts/rerun_weekly_wx_three_charts_if_needed.sh",
    "gaming-daily-report2 && bash ./run_gaming_daily.sh",
    "gaming-daily-report2\" && ./run_gaming_daily.sh",
    "gaming-daily-report2 && .venv/bin/python3 send_gaming_weekly.py --phase generate",
    "gaming-daily-report2\" && ./.venv/bin/python3 send_gaming_weekly.py --phase generate",
    "gaming-daily-report2 && bash ./run_gaming_weekly_push_cron.sh",
    "gaming-daily-report2\" && ./run_gaming_weekly_push_cron.sh",
    "monitor-web/pipelines/monitor-chain/wechat-douyin && /bin/bash ./scripts/weekly_wx_three_charts_scrape_and_import.sh",
    "monitor-web/pipelines/monitor-chain/wechat-douyin && /bin/bash ./scripts/rerun_weekly_wx_three_charts_if_needed.sh",
    "monitor-web && SYNC_CHECK_ONLY=1 ./scripts/sync_dbs_and_deploy.sh",
    "monitor-web && SYNC_SKIP_DEPLOY=1 ./scripts/sync_dbs_and_deploy.sh",
    "monitor-web && ./scripts/check_monitor_chain.sh",
    "monitor-web && ./scripts/run_reports.sh",
]

legacy_comment_patterns = [
    "monitor-web 监测链补充",
    "Olivr-competitor-monitor",
]

blocks = managed_markers + (legacy_blocks if replace_known else [])

out: list[str] = []
skip_until: str | None = None

for line in lines:
    stripped = line.strip()
    if skip_until is not None:
        if stripped == skip_until:
            skip_until = None
        continue

    matched_block = False
    for start, end in blocks:
        if stripped == start:
            skip_until = end
            matched_block = True
            break
    if matched_block:
        continue

    if replace_known and any(pattern in line for pattern in legacy_patterns):
        continue
    if replace_known and stripped.startswith("#") and any(pattern in line for pattern in legacy_comment_patterns):
        continue

    out.append(line.rstrip())

while out and out[-1] == "":
    out.pop()

if out:
    out.extend(["", rendered_block.rstrip()])
else:
    out.append(rendered_block.rstrip())

next_path.write_text("\n".join(out) + "\n")
PY

if [[ "$APPLY" != "1" ]]; then
  echo "Preview only. No crontab changes were made."
  echo
  echo "Generated crontab:"
  echo "------------------"
  cat "$next"
  echo
  echo "To install and remove known legacy lines:"
  echo "  $0 --apply --replace-known"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
stamp="$(date '+%Y%m%d-%H%M%S')"
backup="$BACKUP_DIR/crontab-before-unified-$stamp.txt"
candidate="$BACKUP_DIR/crontab-unified-next-$stamp.txt"
cp "$current" "$backup"
cp "$next" "$candidate"

set +e
CRONTAB_FILE="$next" \
CRONTAB_INSTALL_TIMEOUT="${CRONTAB_INSTALL_TIMEOUT:-20}" \
python3 - <<'PY'
from __future__ import annotations

import os
import signal
import subprocess
import sys

crontab_file = os.environ["CRONTAB_FILE"]
timeout = int(os.environ.get("CRONTAB_INSTALL_TIMEOUT", "20"))
proc = subprocess.Popen(
    ["crontab", crontab_file],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    start_new_session=True,
)
try:
    out, err = proc.communicate(timeout=timeout)
except subprocess.TimeoutExpired:
    os.killpg(proc.pid, signal.SIGTERM)
    try:
        out, err = proc.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        out, err = proc.communicate()
    if out:
        print(out, end="")
    if err:
        print(err, end="", file=sys.stderr)
    print(f"crontab install timed out after {timeout}s", file=sys.stderr)
    raise SystemExit(124)

if out:
    print(out, end="")
if err:
    print(err, end="", file=sys.stderr)
raise SystemExit(proc.returncode)
PY
install_code=$?
set -e

if [[ "$install_code" -ne 0 ]]; then
  echo "Failed to install unified monitor-web cron block (exit $install_code)." >&2
  echo "Backup: $backup" >&2
  echo "Candidate: $candidate" >&2
  exit "$install_code"
fi

echo "Installed unified monitor-web cron block."
echo "Backup: $backup"
echo "Candidate: $candidate"
echo "Current unified lines:"
crontab -l | sed -n '/# BEGIN MONITOR_WEB_UNIFIED_CRON/,/# END MONITOR_WEB_UNIFIED_CRON/p'
