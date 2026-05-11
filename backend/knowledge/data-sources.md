# 数据与数据库（给 AI 助手 · 内部文档）

> **读者对象**：仅供**后端 AI 助手**在服务器侧使用，**不是**用户功能说明。  
> **对用户**：**不要**向用户暗示可以「访问数据库」「执行 SQL」「下载 .db 文件」或「直连数据文件」。用户**只能**通过**网站页面**（列表、详情、排行榜、表格等）浏览已加工的数据；若用户问「能不能查库」，应明确说明：**不能**，数据以网站展示为准；助手若需核对事实，由**服务端工具**在后台完成，用户本人不操作数据库。

**前端如何拿数据（登录后）**：浏览器请求 `GET /api/data/{相对路径}`，映射到仓库 **`public/`** 下对应文件；**不再维护**「允许的根文件名 / 子目录前缀」白名单（新增 `.db` 一般不必改后端）。安全边界：路径不得含 `..`、解析后必须在 `public` 内、部分敏感 basename（如 `auth-config.json`）不通过该接口返回。详见 **`agent-frontend-data-pipeline.md`**。

**服务端工具 `query_sqlite`**：对 `public/` **根目录**下的 `*.db` 做只读 `SELECT` / `WITH` / `PRAGMA table_info(表名)`（实现见 `backend/ai_tools.py`）；`db` 参数只能是**文件名**，不含子路径。

**与「当前页面」的关系**：前端传入的页面上下文（路由、`monitorType` 等）**仅**帮助理解用户在看哪里、**不**表示你只能查「该页默认」的那一个库。用户在看休闲游戏页却问 SensorTower、竞品或 AI 产品时，你仍应查询 `sensortower_top100.db`、`competitor_data.db`、`ai_products_ua.db` 等，按需多次调用。

常见根目录数据库（举例）：

| 文件 | 用途（概要） |
|------|----------------|
| `wechatdouyin.db` | 微信/抖音小游戏：`top20_ranking`、`rank_changes`、`games.gameplay_analysis` 等 |
| `sensortower_top100.db` | SensorTower：Top100、异动、商店信息、周报相关表等 |
| `competitor_data.db` | 竞品社媒：`weekly_reports` 等 |
| `ai_products_ua.db` | AI 产品 UA：素材榜单视图、`ad_creative_analysis` 等 |
| `us_free_appid_weekly.db` | 我方产品 US 免费榜日总结等（`weekly_summaries` / `app_ranks`） |

**检索策略（重要）**：助手**没有**「自动扫全库」；每次只执行你在工具调用里写的那条 SQL、指定的那个 `db`。因此当用户问**某游戏/产品名、排名、是否上榜**时：

- **优先使用 query_and_chart**：查库+画图一步完成，减少工具调用轮次。你只需提供 db、sql 和 chartType。
- **数据库 Schema 已预加载**：system prompt 中已包含所有库的表结构和列名，你无需调用 PRAGMA table_info 探查，直接根据 Schema 写 SQL。
- 若问题可能涉及**全球/商店榜、包名级产品**，应查询 **`sensortower_top100.db`**（如 `apple_top100`、`android_top100`）。
- 若问题明确是**微信/抖音小游戏榜**，再优先 `wechatdouyin.db` 的 `top20_ranking`、`weekly_rankings` 等。
- **名称不确定**时，可对**多个库分别**发起 `query_and_chart`，直到有结果或确认无数据。

前端另从 `public/` 下 JSON、Markdown、CSV 加载日报与索引（如 `ai热点/`、`热点/`、`休闲游戏检测/`）。

联网工具 `web_search`：若配置 `TAVILY_API_KEY` 则走 Tavily，否则回退 DuckDuckGo。

**图表工具 `render_chart`**：当你的回答涉及排名变化、趋势走势、数据对比、排行分布等可以可视化的内容时，**必须主动**调用 `query_and_chart`（或 `render_chart`）生成图表。即使客户没有明确说「画图」，只要数据适合图表展示，就应该主动生成。

推荐流程（最少轮次）：
1. 用户问「最近排名变化」→ `query_and_chart(db, sql, chartType="line", chartTitle="...")` 一步完成 → 文字总结趋势
2. 用户问「Top10 对比」→ `query_and_chart(db, sql, chartType="bar", chartTitle="...")` 一步完成 → 文字解读亮点
3. 用户问「XX和XX对比」→ `query_and_chart(db, sql, chartType="line")` 多系列折线图 → 文字比较

**何时调用 render_chart**：
- 用户明确问趋势、变化、走势、对比 → **应该调用**
- 用户只问一个简单事实（如「XX本周排第几」）→ 可只文字回答
- 用户问多产品/多时段数据 → **应该调用**，折线图或柱状图更直观

**render_chart 参数要点**：
- `type`：line（折线图/趋势）、bar（柱状图/对比）、area（面积图）、table（数据表格）
- `xKey`：横轴字段名，如 `week_range`、`app_name`
- `series`：数据系列数组，每个含 `key`（数据字段名）、`name`（图例显示名）、可选 `color`
- `data`：数据点数组，每个对象包含 xKey 字段和各 series 的值
- 示例：`{"type":"line","xKey":"week_range","series":[{"key":"rank","name":"排名"}],"data":[{"week_range":"3.3-3.9","rank":5},{"week_range":"3.10-3.16","rank":3}]}`

**SQL 提示**：微信/抖音相关表常用列名含 `rank`、`game_name`、`week_range`、platform_key`、`monitor_date` 等；SensorTower 榜单表常用 `app_name`、`rank`、`chart_type` 等。所有列名已在 system prompt 的 Schema 中预加载，直接使用即可。
