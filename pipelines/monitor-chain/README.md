# Monitor Chain Pipelines

This directory is the migration target for crawler and data-producing jobs that feed monitor-web.

Current migration rule:

1. Upstream scrapers may still execute from their original repositories while we migrate them one by one.
2. Every successful monitor chain run mirrors the upstream SQLite databases into `data/databases/`.
3. The backend prefers `data/databases/*.db`, with old external paths kept only as fallback.
4. Pushes run only after upstream freshness, business checks, backend reachability, and `/api/data` snapshot checks pass.

Target layout:

```text
pipelines/
  monitor-chain/
    wechat-douyin/        # WeChat/Douyin ranking crawler and import flow
    sensortower/          # SensorTower weekly and daily app-rank flows
    competitor-social/    # Competitor social crawler and weekly report flow
    shared/               # Shared env loading, logging, DB backup, webhook helpers
data/
  databases/              # Local canonical SQLite snapshots, ignored by git
  artifacts/              # Generated reports, screenshots, diagnostics, ignored by git
```

The next source-code migration should start with `wechat-douyin`, because it has the most fragile browser flow and the smallest database surface.
