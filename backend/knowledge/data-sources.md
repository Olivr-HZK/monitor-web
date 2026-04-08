# 数据与数据库（给 AI 助手）

后端工具 `query_sqlite` 仅允许对 `public/` 目录下**白名单内**数据库做只读 `SELECT`（及允许的 `PRAGMA table_info`）。常见文件名：

| 文件 | 用途（概要） |
|------|----------------|
| `wechatdouyin.db` | 微信/抖音小游戏：`top20_ranking`、`rank_changes`、`games.gameplay_analysis` 等 |
| `sensortower_top100.db` | SensorTower：Top100、异动、商店信息、周报相关表等 |
| `competitor_data.db` | 竞品社媒：`weekly_reports` 等 |
| `ai_products_ua.db` | AI 产品 UA：素材榜单视图、`ad_creative_analysis` 等 |

前端另从 `public/` 下 JSON、Markdown、CSV 加载日报与索引（如 `ai热点/`、`热点/`、`休闲游戏检测/`）。

联网工具 `web_search`：若配置 `TAVILY_API_KEY` 则走 Tavily，否则回退 DuckDuckGo。

**SQL 提示**：微信/抖音相关表常用列名含 `rank`、`game_name`、`week_range`、`platform_key`、`monitor_date` 等；勿臆造 `ranking` 等不存在的列，不确定时先用 `PRAGMA table_info(表名)`。
