# Competitor Social Pipeline

This directory contains the migrated competitor social jobs that used to live in
`~/lyb/Olivr-competitor-monitor`.

Runtime entrypoints:

- `run-daily-scraper.sh` - fetches the previous day's social posts and writes
  raw rows into the competitor database.
- `run-weekly-period-workflow.sh` - generates the previous week's competitor
  social reports.

Both wrappers default to the monitor-web canonical database:

```bash
COMPETITOR_DB_PATH=$MONITOR_WEB_ROOT/data/databases/competitor_data.db
COMPETITOR_DB_DIR=$MONITOR_WEB_ROOT/data/databases
```

Local secrets and `config/config.yaml` are kept on disk and ignored by git. The
cron wrappers require the pipeline-local `.venv`; install the runtime
dependencies here rather than falling back to the legacy project environment.

Useful checks:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-runtime.txt
JOB_DRY_RUN=1 ../../../scripts/cron/run_job.sh competitor_daily_scraper
JOB_DRY_RUN=1 ../../../scripts/cron/run_job.sh competitor_weekly_period
```
