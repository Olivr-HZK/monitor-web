# Monitor-Web Game Trend Data Map

Use this reference after the `game-trend-monitor` skill triggers and the locator points here.

## Feishu Query Behavior

For questions coming from Feishu, first decide whether the user wants a factual lookup, a trend summary, or competitor/UA narrative:

- Factual lookup: latest rankings, top games, rank changes, new entries, comparisons. Use SQLite recipes first.
- Trend summary: "最近有什么趋势", "总结周报", "有什么玩法机会". Read recommended report files first, then query SQLite for evidence. Weekly JSON reports can be newer than the ranking DB snapshots, so use the newest local cutoff across both.
- Competitor/UA narrative: competitor actions, gameplay updates, offline activity, creative/UA changes. Use `competitor_data.db` or `public/ai产品/` reports first.

Feishu replies should be short and business-facing. Mention "站内数据截至 YYYY-MM-DD" and present internal paths only as "站内监测数据" or website page names.

## SQLite Sources

### `public/wechatdouyin.db`

Use for WeChat/Douyin mini-game ranking questions, domestic casual game trends, rank jumps, new entries, and gameplay summaries.

Important tables:

- `top20_ranking`: weekly/top ranking rows. Useful fields: `monitor_date`, `week_range`, `platform_key`, `rank`, `game_name`, `company`, `rank_change`, `board_name`, `region`.
- `rank_changes`: games with noticeable changes. Same core fields as `top20_ranking`.
- `games`: gameplay analysis and video metadata. Useful fields: `game_name`, `gameplay_analysis`, `platform`, `monitor_date`, `title`, `description`, `video_url`, `play_count`, `like_count`.
- `weekly_report_simple`: summarized new/rising games and gameplay summaries.
- `weekly_report_trends`: short trend analysis by platform.

Good questions:

- "最近微信/抖音小游戏有哪些新上榜?"
- "哪些小游戏连续上升?"
- "XX 游戏最近排名怎么样?"
- "帮我总结最近小游戏玩法趋势。"

### `public/sensortower_top100.db`

Use for SensorTower Top100, iOS/Android, App Store/Google Play, country rankings, new entries, rank jumps, removed games, and store-page changes.

Important tables:

- `apple_top100`, `android_top100`: Top100 snapshots. Useful fields: `rank_date`, `country`, `chart_type`, `rank`, `app_id`, `app_name`, `downloads`, `revenue`.
- `rank_changes`: weekly changes. Useful fields: `rank_date_current`, `rank_date_last`, `platform`, `country`, `current_rank`, `last_week_rank`, `change`, `change_type`, `publisher_name`, `store_url`.
- `app_name_cache`: maps app ids to readable names when `rank_changes.app_name` is numeric.
- `weekly_top5_overview`: model-generated weekly overview text.
- `weekly_metadata_changes`, `appstoreinfo_changes`, `gamestoreinfo_changes`: store metadata and store page changes.

Good questions:

- "这周 SensorTower Top 10 有哪些变化?"
- "最近 iOS 美国免费榜哪些休闲游戏涨得快?"
- "有哪些新进 Top100?"
- "某个游戏商店页最近有没有更新?"

### `public/us_free_appid_weekly.db`

Use for own-product and tracked-competitor US free chart monitoring, especially when the user asks about "我方", "自家产品", "US 免费榜", "日总结", "产品追溯", or a known internal product code/name.

Important tables:

- `weekly_summaries`: generated daily/weekly summary text. Useful fields: `date_from`, `date_to`, `summary_text`, `product_count`, `line_count`.
- `app_ranks`: rank rows for own products and related competitors. Useful fields: `rank_date`, `display_name`, `internal_name`, `product_code`, `platform`, `country`, `chart_type`, `category_name`, `rank`.
- `rank_subjects`: tracked subject mapping between products and competitors. Useful fields: `app_name`, `root_internal_name`, `subject_role`, `competitor_name`, `display_name`, `product_code`.

Good questions:

- "我方产品最近 US 免费榜怎么样?"
- "免费榜日总结有哪些异常?"
- "按产品追溯 Arrow2 最近的排名。"
- "自家产品和竞品在美国免费榜有什么变化?"

### `public/competitor_data.db`

Use for competitor social monitoring, gameplay updates, offline activities, UA/social activity, and weekly competitor reports.

Important tables:

- `weekly_reports`: company-level weekly reports. Useful fields: `company_name`, `start_date`, `end_date`, `report_content`.
- `company_platforms`: configured social accounts by company/game/platform.
- `company_raw_data_*`: raw fetched posts by company. Use only when the weekly report is insufficient.

Good questions:

- "最近竞品有没有玩法更新或线下活动?"
- "Voodoo / Homa / King 这周有什么动作?"
- "竞品社媒最近在推什么?"

## File/Report Sources

### `public/ai热点/`

AI hot trend reports and weekly mini-game style JSON reports.

- `minigame_weekly_YYYY-MM-DD_YYYY-MM-DD.json`: weekly trend summaries and game/play inspiration.
- `日报.md`, dated JSON files, and `bitable_export_*.json/csv`: AI hot cards and TikTok-style trend analysis.

### `public/热点/`

General TikTok/trend monitoring.

- `热点日报.md`: latest daily summary.
- dated JSON files and `tiktoktrending_base_Table_tiktok_record.csv`: trend cards and raw exported records.

### `public/休闲游戏检测/`

Casual game pages and reports.

- `sensortower_周报/周报_YYYY-MM-DD.md`: SensorTower weekly report markdown.
- `sensortower_周报/top5_异动陈述_YYYY-MM-DD.json`: Top5 movement statements.
- `出海周报/weekly_report_YYYY-MM-DD_YYYY-MM-DD.json`: overseas puzzle-game weekly reports covering competitor dynamics, gameplay mechanisms, AI exploration, UA direction, and emerging markets.
- `*.md` game files: individual gameplay analysis pages.
- ranking CSVs: fallback/static ranking snapshots.

### `public/ai产品/`

AI product and UA creative reports. Use when the user asks about AI products or creative/UA trends rather than games.

## Query Recipes

These are examples; adjust filters and limits to the user's question. Always run read-only queries.

### Latest WeChat/Douyin Top20

```sql
WITH latest AS (
  SELECT MAX(monitor_date) AS d FROM top20_ranking
)
SELECT monitor_date, platform_key, rank, game_name, company, rank_change, board_name
FROM top20_ranking
WHERE monitor_date = (SELECT d FROM latest)
ORDER BY platform_key, CAST(rank AS INTEGER)
LIMIT 40;
```

### Latest WeChat/Douyin Rising or New Games

```sql
WITH latest AS (
  SELECT MAX(monitor_date) AS d FROM rank_changes
)
SELECT monitor_date, platform_key, rank, game_name, company, rank_change, board_name
FROM rank_changes
WHERE monitor_date = (SELECT d FROM latest)
ORDER BY
  CASE
    WHEN rank_change = '新进榜' THEN 999
    WHEN rank_change LIKE '↑%' THEN CAST(SUBSTR(rank_change, 2) AS INTEGER)
    ELSE 0
  END DESC,
  CAST(rank AS INTEGER)
LIMIT 20;
```

### SensorTower Latest New Entries and Surges

```sql
WITH latest AS (
  SELECT MAX(rank_date_current) AS d FROM rank_changes
)
SELECT
  rc.rank_date_current,
  rc.platform,
  rc.country,
  rc.current_rank,
  COALESCE(c.app_name, rc.app_name) AS app_name,
  rc.last_week_rank,
  rc.change,
  rc.change_type,
  rc.publisher_name,
  rc.store_url
FROM rank_changes rc
LEFT JOIN app_name_cache c
  ON c.app_id = rc.app_id AND UPPER(c.platform) = UPPER(rc.platform)
WHERE rc.rank_date_current = (SELECT d FROM latest)
  AND (rc.change_type LIKE '%新进%' OR rc.change_type LIKE '%飙升%')
ORDER BY
  CASE WHEN rc.change_type LIKE '%新进%' THEN 1 ELSE 2 END,
  rc.current_rank
LIMIT 30;
```

### SensorTower Latest Top10 By Platform

```sql
WITH latest AS (
  SELECT MAX(rank_date) AS d FROM apple_top100
)
SELECT rank_date, 'iOS' AS platform, country, chart_type, rank, app_name, downloads, revenue
FROM apple_top100
WHERE rank_date = (SELECT d FROM latest)
  AND rank <= 10
ORDER BY country, chart_type, rank
LIMIT 60;
```

For Android, use the same pattern on `android_top100`.

### Competitor Latest Weekly Reports

```sql
SELECT company_name, start_date, end_date, SUBSTR(report_content, 1, 1200) AS excerpt
FROM weekly_reports
WHERE end_date = (SELECT MAX(end_date) FROM weekly_reports)
ORDER BY company_name
LIMIT 20;
```

### Own-Product Latest US Free Summary

```sql
SELECT date_from, date_to, product_count, line_count, SUBSTR(summary_text, 1, 1800) AS excerpt
FROM weekly_summaries
ORDER BY date_to DESC, id DESC
LIMIT 3;
```

### Own-Product Latest Rank Rows

```sql
WITH latest AS (
  SELECT MAX(rank_date) AS d FROM app_ranks
)
SELECT rank_date, display_name, internal_name, product_code, platform, country, chart_type, category_name, rank
FROM app_ranks
WHERE rank_date = (SELECT d FROM latest)
ORDER BY product_code DESC, display_name, platform, chart_type, category_name
LIMIT 80;
```

## User-Facing Boundaries

Say "站内数据截至 ..." rather than "实时". If the user asks for "today" but the latest row is earlier, give the exact date and avoid pretending the data is live.

Never tell regular Feishu users to run SQL, open `.db` files, or read local paths. Present sources as website pages or "站内监测数据".
