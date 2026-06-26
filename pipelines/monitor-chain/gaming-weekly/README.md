# Gaming Weekly Pipeline

This directory contains the migrated Puzzle Game overseas weekly report jobs
that used to run from `~/lyb/gaming-daily-report2` locally and
`/opt/gaming-daily-report2` on hk4.

Runtime entrypoints:

- `run_gaming_daily.sh` - fetches daily gaming RSS/news data through the bundled
  TrendRadar source and writes SQLite/HTML output under `output/`.
- `run_gaming_weekly_generate.sh` - builds and validates the weekly
  bilingual Puzzle Game report snapshot.
- `run_gaming_weekly_push_cron.sh` - pushes the latest validated Monday snapshot
  at 08:00 Asia/Shanghai.

Local runtime output is intentionally ignored:

```text
.runtime/
output/
.venv/
```

Required runtime secrets are read from environment variables or a local `.env`
loaded by the deployment environment:

```bash
AI_API_KEY=...
OPENROUTER_API_KEY=...
FEISHU_WEBHOOK=...
WEWORK_WEBHOOK=...
```

Useful checks:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
JOB_DRY_RUN=1 ../../../scripts/cron/run_job.sh gaming_daily
JOB_DRY_RUN=1 ../../../scripts/cron/run_job.sh gaming_weekly_generate
JOB_DRY_RUN=1 ../../../scripts/cron/run_job.sh gaming_weekly_push --dry-run
```

To send a manual test outside the cron window, pass `--force` to the push job
and provide webhook variables in the shell environment.
