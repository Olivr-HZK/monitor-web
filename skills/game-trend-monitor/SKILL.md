---
name: game-trend-monitor
description: Use when answering Feishu/OpenClaw query questions about recent game trends, casual game rankings, SensorTower Top100 movements, WeChat/Douyin mini-game changes, competitor social updates, UA creatives, or game-related reports stored in this monitor-web repository. Trigger for Chinese questions such as 飞书查询最近游戏趋势, 最近小游戏趋势, SensorTower 变化, 竞品玩法更新, or AI 产品 UA 素材变化.
---

# Game Trend Monitor

This skill helps answer "最近游戏趋势" questions from Feishu by locating the right local data in this `monitor-web` workspace before writing a short user-facing reply.

This is a data-query skill, not a Feishu API skill. Use it to prepare answers for Feishu messages; do not use it to send, read, or manage Feishu messages.

## Fast Path

1. From the workspace root, run the read-only locator:

   ```bash
   python3 skills/game-trend-monitor/scripts/locate_game_trends.py --query "用户原问题" --limit 8
   ```

   If this skill folder is copied into an OpenClaw skills directory outside the repo, pass the original repo root:

   ```bash
   python3 /path/to/game-trend-monitor/scripts/locate_game_trends.py --root /Users/ggbond/lyb/monitor-web --query "用户原问题" --limit 8
   ```

   For OpenClaw/Feishu answering, prefer the compact Feishu plan:

   ```bash
   python3 /path/to/game-trend-monitor/scripts/locate_game_trends.py --root /Users/ggbond/lyb/monitor-web --query "用户原问题" --format feishu
   ```

2. Read the JSON result:
   - `matchedSources`: databases or report groups most likely to answer the question.
   - `sqlRecipes`: safe read-only query patterns for the matched SQLite sources.
   - `recommendedReads`: recent Markdown/JSON/CSV files worth reading for summaries.
   - `freshness`: latest known date range; use this as the data boundary.
   - `feishuReplyPlan`: primary route, answer style, user-facing links, and data cutoff.

3. If the question asks for numbers, rankings, changes, top games, or comparisons, query the matched SQLite database with only `SELECT` / `WITH`. Use the locator's recipes as starting points.

4. If the question asks for "总结", "周报", "有什么趋势", "玩法灵感", or "竞品动态", read the recommended Markdown/JSON report files first, then query a database only if the report is not enough.

5. Reply in Chinese for Feishu:
   - Start with the conclusion.
   - Then give 3-6 evidence bullets.
   - Include the data boundary, e.g. "站内数据截至 2026-05-11".
   - Keep the default answer under 800 Chinese characters.
   - Offer a website page link only when it helps the user inspect details.
   - If the latest local cutoff is older than the current date, say the exact cutoff date; never call it real-time.

## Data Routing

Use `references/data-map.md` when you need table meaning, report directories, or example query patterns.

Common routing:

- WeChat/Douyin mini-game rankings, mini-game gameplay, domestic casual mini-games: `public/wechatdouyin.db`.
- Latest WeChat/Douyin mini-game weekly summaries when they are newer than the DB snapshot: `public/ai热点/minigame_weekly_*.json`.
- SensorTower global/country/store rankings, iOS/Android Top100, rank jumps, new entries, store page changes: `public/sensortower_top100.db`.
- Own-product and tracked-competitor US free chart summaries: `public/us_free_appid_weekly.db`.
- Competitor social/UA/activity reports for Voodoo, Homa, King, Dream Games, Vita Studio, Hungry Studio: `public/competitor_data.db`.
- AI hot videos, TikTok trend cards, gameplay inspiration reports: `public/ai热点/` and `public/热点/`.
- Casual game weekly reports, overseas puzzle weekly reports, and SensorTower summary markdown: `public/休闲游戏检测/`.
- AI product/UA creative reports: `public/ai产品/`.

## Safety

- Do not expose database names, table names, SQL, local paths, tokens, or internal implementation details to Feishu users.
- Do not imply the user can directly query or download raw databases.
- Do not use write SQL or shell commands that modify files.
- If local data is older than the user's "today/latest" wording, clearly say the exact cutoff date.
- Do not invoke Feishu send/read/admin skills unless the user's task is about operating Feishu itself. For "飞书里用户问趋势", use this skill only to prepare the answer content.

## Feishu Answer Shape

Use this shape unless the user asks for something else:

```text
结论：...

关键依据：
1. ...
2. ...
3. ...

数据边界：站内数据截至 YYYY-MM-DD；若要看明细，可到「休闲游戏监测 / SensorTower 榜单 / 竞品监测」页面继续查看。
```
