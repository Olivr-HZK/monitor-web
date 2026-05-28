# WeChat / Douyin Three-Chart Pipeline

This pipeline owns the WeChat/Douyin mini-game weekly ranking flow inside monitor-web.

## Runtime Paths

| Item | Path |
| --- | --- |
| SQLite output | `monitor-web/data/databases/wechatdouyin.db` |
| CSV/debug/browser artifacts | `monitor-web/data/artifacts/wechat-douyin/` |
| DB backups | `monitor-web/backups/db/wechat-douyin/` |
| Cron logs | `monitor-web/logs/wechat_douyin_weekly*.log` |

The browser profile defaults to the legacy profile when available:

```text
../wechat-mini-game-ranking-post/data/pw_user_data
```

This keeps the existing Gravity Engine login state during migration. To fully localize it later, set:

```bash
WECHAT_DOUYIN_USER_DATA_DIR=/Users/ggbond/lyb/monitor-web/data/artifacts/wechat-douyin/pw_user_data
```

## Commands

Run the weekly scrape/import:

```bash
./scripts/weekly_wx_three_charts_scrape_and_import.sh
```

Check whether the target week is complete and rerun only if needed:

```bash
./scripts/rerun_weekly_wx_three_charts_if_needed.sh
```

Use the unified monitor-web entrypoint:

```bash
../../../../scripts/cron/run_job.sh wechat_douyin_weekly
../../../../scripts/cron/run_job.sh wechat_douyin_weekly_rerun
```

## Migration Notes

This is now the production entrypoint for the WeChat/Douyin weekly ranking job. The legacy repository remains only for fallback and for the existing browser login profile until the profile is moved or refreshed under monitor-web.
