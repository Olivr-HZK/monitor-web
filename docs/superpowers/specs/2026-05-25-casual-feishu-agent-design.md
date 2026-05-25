# 休闲游戏飞书 Agent 设计

## 背景

当前项目已有 FastAPI 后端、网页端监测助手、飞书事件接入、会话存储、AI 助手服务、SQLite 只读查询工具和平台知识库。现有飞书助手面向整个“监测汇总”平台，用户希望新增一个独立 agent，通过飞书机器人询问休闲游戏网站相关数据。

本设计选择“独立飞书自建应用 + 独立事件回调入口 + 复用底层监测助手能力”的方案。这样飞书侧权限、白名单、会话上下文和审计标识清晰隔离，同时避免重复实现数据查询和模型调用链路。

## 目标

- 新增一个独立的休闲游戏飞书 Agent，支持飞书群聊 @ 机器人和私聊机器人。
- 覆盖全量休闲游戏监测数据：微信/抖音小游戏、SensorTower、竞品社媒/UA、我方产品榜单追踪。
- 复用现有后端 AI 工具能力：只读 SQLite 查询、数据新鲜度、知识库、模型调用、审计记录。
- 与现有飞书监测助手隔离：独立配置、独立回调 URL、独立白名单、独立会话库和独立审计 channel。
- 默认关闭，只有部署环境显式配置并开启后才处理飞书事件。

## 非目标

- 不新增前端页面。
- 不提供用户直接访问数据库、执行 SQL 或下载原始数据文件的能力。
- 不改变现有 `/api/feishu/events` 和网页 AI 助手的行为。
- 不在本轮实现复杂的订阅推送、日报自动推送或主动提醒。

## 推荐架构

新增一个后端入口：

- `POST /api/feishu/casual-agent/events`

该入口用于飞书自建应用事件订阅。它与现有 `/api/feishu/events` 平行，不复用现有飞书应用配置。请求进入后按如下流程处理：

1. 检查 `CASUAL_FEISHU_BOT_ENABLED`，未开启时直接忽略。
2. 读取原始请求体，按独立的 token / encrypt key 校验事件来源。
3. 处理飞书 URL verification。
4. 解析 `im.message.receive_v1` 文本消息。
5. 群聊中必须 @ 休闲 agent 的机器人名；私聊直接响应。
6. 按独立白名单校验 open_id / chat_id。
7. 基于独立会话库加载历史上下文。
8. 构造休闲游戏专属 prompt，调用现有 `run_monitor_assistant`，channel 按场景传入 `feishu_casual_group` 或 `feishu_casual_dm`。
9. 回复飞书消息，并写入独立会话历史与审计日志。

底层能力复用现有模块：

- `feishu_bot.py`：事件解析、飞书回复、会话存储等通用能力。
- `assistant_service.py`：模型调用、系统提示词、数据库选择和知识库注入。
- `ai_tools.py`：SQLite 只读查询、图表数据生成、联网搜索。

## 配置设计

新增环境变量建议如下：

```env
CASUAL_FEISHU_BOT_ENABLED=false
CASUAL_FEISHU_APP_ID=
CASUAL_FEISHU_APP_SECRET=
CASUAL_FEISHU_VERIFICATION_TOKEN=
CASUAL_FEISHU_ENCRYPT_KEY=
CASUAL_FEISHU_ALLOWED_OPEN_IDS=
CASUAL_FEISHU_ALLOWED_CHAT_IDS=
CASUAL_FEISHU_BOT_MENTION_NAMES=休闲监测助手,休闲游戏助手
CASUAL_FEISHU_ASSISTANT_SEND_THINKING=true
```

其中：

- `CASUAL_FEISHU_BOT_ENABLED` 默认关闭，避免未配置时误处理事件。
- `CASUAL_FEISHU_APP_ID` / `CASUAL_FEISHU_APP_SECRET` 使用独立飞书自建应用。
- `CASUAL_FEISHU_ALLOWED_OPEN_IDS` / `CASUAL_FEISHU_ALLOWED_CHAT_IDS` 为空时默认允许所有事件；生产建议配置白名单。
- `CASUAL_FEISHU_BOT_MENTION_NAMES` 只用于群聊 @ 识别，不应留空后宽松匹配任意 @。

## 数据范围

休闲游戏 Agent 应优先覆盖以下数据源语义：

- 微信 / 抖音小游戏榜单、Top20、排名变化、玩法分析。
- SensorTower Top100、商店页变化、应用榜单与异动。
- 竞品监测中的社媒、UA 素材、周报信息。
- 我方产品 US 免费榜日报、周报和按产品追踪。

对用户的表述应使用“榜单、页面、监测数据、周报、商店页变化”等业务语言，不暴露数据库名、表名、SQL、内部路径或密钥。

## Prompt 与回答策略

休闲游戏飞书 Agent 的系统语义应在现有监测助手基础上收窄：

- 明确自己是“休闲游戏监测飞书助手”。
- 默认优先查询休闲游戏相关数据源。
- 回答先给结论，再给关键依据。
- 飞书回答默认控制在 800 字以内，列表不超过 10 条。
- 当用户问“最新、最近、本周、今天”时，必须说明站内数据截止时间或数据边界。
- 信息不足时直接说明缺口，并建议继续追问具体游戏、平台、时间范围或榜单类型。

## 会话与权限

会话存储使用独立 SQLite 文件，例如：

- `data/casual_assistant_sessions.db`

这样不会与现有飞书助手共享上下文。群聊按 chat/thread 维度保存上下文，私聊按用户维度保存上下文，沿用现有 `AssistantSessionStore` 的 session key 策略。

权限控制使用独立白名单：

- 用户维度：`CASUAL_FEISHU_ALLOWED_OPEN_IDS`
- 群聊维度：`CASUAL_FEISHU_ALLOWED_CHAT_IDS`

如果两个白名单都为空，按开发友好策略允许访问；生产环境建议至少配置一个白名单。

## 错误处理与审计

新增入口应沿用现有飞书助手的错误处理模型：

- 重复事件直接忽略。
- 非文本消息忽略。
- 群聊未 @ 机器人忽略。
- 未通过白名单时回复无权限提示。
- 频率过高时回复稍后重试。
- 模型或查询失败时回复通用失败提示，不暴露内部异常细节。

审计记录继续写入现有 `assistant_audit.jsonl`，但 channel 使用独立标识：

- `feishu_casual_group`
- `feishu_casual_dm`

审计内容包含状态、耗时、提问摘要、回答长度、用户标识和 session key，不记录密钥或完整敏感配置。

## 测试策略

单元级验证：

- 事件入口关闭时返回忽略结果。
- URL verification 使用独立 token。
- 群聊未 @ 时忽略。
- 群聊 @ 和私聊可进入处理流程。
- 白名单拒绝时返回权限提示。
- reset 命令只清空休闲 agent 会话库。

集成级验证：

- 使用 FastAPI TestClient 模拟飞书事件回调。
- mock 飞书回复客户端，避免真实发送消息。
- mock `run_monitor_assistant`，验证 channel 和 prompt 语义。
- 启动后确认现有 `/api/feishu/events` 行为不受影响。

手工验收：

- 在飞书后台配置新应用事件订阅 URL。
- 完成 URL verification。
- 私聊提问“最近微信小游戏榜单有什么变化？”能收到回答。
- 群聊未 @ 不响应，@ 休闲机器人后响应。
- 无权限用户收到白名单提示。

## 实施顺序

1. 在 `backend/config.py` 增加休闲飞书 Agent 独立配置。
2. 在 `backend/main.py` 初始化独立飞书客户端、会话库和限流器。
3. 新增休闲 agent 的 prompt 包装函数和事件处理函数。
4. 新增 `POST /api/feishu/casual-agent/events`。
5. 更新 `backend/.env.example` 和相关 README / 使用文档。
6. 增加或补充后端测试。
7. 运行后端导入检查、相关测试和前端 lint/build 中与本改动相关的验证。

