# SensorTower Pipeline

This directory contains the migrated SensorTower jobs that used to live in
`~/lyb/sensortower-`.

Runtime entrypoints:

- `scripts/cron_run_weekly.sh` - weekly Casual Top100 workflow. It writes
  `sensortower_top100.db` and skips its own push by default when run through
  `monitor-web` cron.
- `scripts/cron_run_us_free_daily.sh` - daily US free ranking workflow for our
  products.
- `scripts/cron_run_arrow_madness_daily.sh` - Arrow2 competitor daily workflow.

Canonical databases are no longer stored under this pipeline. The wrappers set
these paths by default:

- `SENSORTOWER_DB_FILE=$MONITOR_WEB_ROOT/data/databases/sensortower_top100.db`
- `US_FREE_APPID_WEEKLY_DB=$MONITOR_WEB_ROOT/data/databases/us_free_appid_weekly.db`
- `APPID_US_COMPETITORS_DB=$MONITOR_WEB_ROOT/data/databases/us_free_appid_weekly.db`

Local secrets stay in `.env` next to this README and are ignored by git. The
tracked product list is `resources/appid_us.json`.

Useful checks:

```bash
JOB_DRY_RUN=1 ../../../scripts/cron/run_job.sh sensortower_weekly
JOB_DRY_RUN=1 ../../../scripts/cron/run_job.sh sensortower_us_free_daily
JOB_DRY_RUN=1 ../../../scripts/cron/run_job.sh sensortower_arrow_madness_daily
```
