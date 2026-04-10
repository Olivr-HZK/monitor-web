# 数据与数据库（给 AI 助手 · 内部文档）

> **读者对象**：仅供**后端 AI 助手**在服务器侧使用，**不是**用户功能说明。  
> **对用户**：**不要**向用户暗示可以「访问数据库」「执行 SQL」「下载 .db 文件」或「直连数据文件」。用户**只能**通过**网站页面**（列表、详情、排行榜、表格等）浏览已加工的数据；若用户问「能不能查库」，应明确说明：**不能**，数据以网站展示为准；助手若需核对事实，由**服务端工具**在后台完成，用户本人不操作数据库。

后端工具 `query_sqlite` 仅允许对 `public/` 目录下**该目录内**的 `.db` 文件做只读 `SELECT`（及允许的 `PRAGMA table_info`）；**凡在 `public/` 下的库名均可作为 `db` 参数**（如下表及同目录其它 `.db`）。常见文件名：

| 文件 | 用途（概要） |
|------|----------------|
| `wechatdouyin.db` | 微信/抖音小游戏：`top20_ranking`、`rank_changes`、`games.gameplay_analysis` 等 |
| `sensortower_top100.db` | SensorTower：Top100、异动、商店信息、周报相关表等 |
| `competitor_data.db` | 竞品社媒：`weekly_reports` 等 |
| `ai_products_ua.db` | AI 产品 UA：素材榜单视图、`ad_creative_analysis` 等 |

**检索策略（重要）**：助手**没有**「自动扫全库」；每次只执行你在工具调用里写的那条 SQL、指定的那个 `db`。因此当用户问**某游戏/产品名、排名、是否上榜**时：

- **不要**默认只查 `wechatdouyin.db` 的 `games`（该表仅覆盖部分有玩法等记录的游戏，**不是**全量榜单）。
- 若问题可能涉及**全球/商店榜、包名级产品**，应查询 **`sensortower_top100.db`**（如 `apple_top100`、`android_top100`，列名多为 `app_name` 等；不确定列请先 `PRAGMA table_info(表名)`）。
- 若问题明确是**微信/抖音小游戏榜**，再优先 `wechatdouyin.db` 的 `top20_ranking`、`weekly_rankings` 等。
- **名称不确定**时，可对**多个库分别**发起 `query_sqlite`（先查列名再 `SELECT`），直到有结果或确认无数据。

前端另从 `public/` 下 JSON、Markdown、CSV 加载日报与索引（如 `ai热点/`、`热点/`、`休闲游戏检测/`）。

联网工具 `web_search`：若配置 `TAVILY_API_KEY` 则走 Tavily，否则回退 DuckDuckGo。

**SQL 提示**：微信/抖音相关表常用列名含 `rank`、`game_name`、`week_range`、`platform_key`、`monitor_date` 等；SensorTower 榜单表常用 `app_name`、`rank`、`chart_type` 等。勿臆造列名，不确定时先用 `PRAGMA table_info(表名)`。
