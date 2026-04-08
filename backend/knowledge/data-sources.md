# 数据与数据库（给 AI 助手 · 内部文档）

> **读者对象**：仅供**后端 AI 助手**在服务器侧使用，**不是**用户功能说明。  
> **对用户**：**不要**向用户暗示可以「访问数据库」「执行 SQL」「下载 .db 文件」或「直连数据文件」。用户**只能**通过**网站页面**（列表、详情、排行榜、表格等）浏览已加工的数据；若用户问「能不能查库」，应明确说明：**不能**，数据以网站展示为准；助手若需核对事实，由**服务端工具**在后台完成，用户本人不操作数据库。

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
