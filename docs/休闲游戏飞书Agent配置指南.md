# 休闲游戏飞书 Agent 配置指南

本文说明如何为**休闲游戏监测**单独配置一个飞书机器人 Agent。它与全站「监测助手」(`POST /api/feishu/events`) 使用**不同的飞书自建应用**和**不同的环境变量**，互不干扰。

## 1. 能力范围

- 微信 / 抖音小游戏榜单、排名变化、玩法分析
- SensorTower Top100、商店页变化
- 竞品社媒 / UA 素材
- 我方产品 US 免费榜追踪
- 联网补充公开网页 / 新闻 / 官网 / 应用商店实时信息，并与站内监测数据分开说明

群聊需 @ 机器人；私聊直接提问。支持 `/reset` 或「清空上下文」重置会话。

## 2. 后端环境变量

在 `backend/.env` 配置（见 `backend/.env.example`）：

| 变量 | 必填 | 说明 |
|---|---:|---|
| `CASUAL_FEISHU_BOT_ENABLED` | 是 | 设为 `true` 后启用回调 |
| `CASUAL_FEISHU_APP_ID` | 是 | 独立飞书自建应用 App ID |
| `CASUAL_FEISHU_APP_SECRET` | 是 | 独立飞书自建应用 App Secret |
| `CASUAL_FEISHU_VERIFICATION_TOKEN` | 建议 | 事件订阅 Verification Token |
| `CASUAL_FEISHU_ENCRYPT_KEY` | 可选 | 签名校验；MVP 建议飞书后台关闭事件加密 |
| `CASUAL_FEISHU_BOT_MENTION_NAMES` | 建议 | 群聊 @ 识别名，逗号分隔，如 `休闲监测助手,休闲游戏助手` |
| `CASUAL_FEISHU_ALLOWED_OPEN_IDS` | 可选 | 用户白名单；为空则不限制 |
| `CASUAL_FEISHU_ALLOWED_CHAT_IDS` | 可选 | 群聊白名单；为空则不限制 |
| `CASUAL_FEISHU_ASSISTANT_SEND_THINKING` | 可选 | 默认 `true`，先回复「正在查询」 |

AI、数据查询与联网搜索沿用现有配置：`OPENAI_API_KEY`、`AI_PROVIDER=openrouter`（推荐）、`CODEX_ENABLE_DB_TOOL=true`、`CODEX_ENABLE_WEB_SEARCH_TOOL=true` 等；配置 `TAVILY_API_KEY` 时优先用 Tavily，否则走 DuckDuckGo 摘要接口兜底。

## 3. 飞书开放平台步骤

1. 登录 [飞书开放平台](https://open.feishu.cn/app) → **创建企业自建应用**（不要复用监测助手或推送 webhook 的应用）。
2. **应用能力** → 开启 **机器人**。
3. **权限管理** → 申请并开通（至少）：
   - 获取与发送单聊、群组消息
   - 读取用户发给机器人的单聊消息（`im:message` 相关）
   - 接收群聊中 @ 机器人消息事件
4. **事件订阅** → 请求地址：
   ```
   https://api.gurublog.uk/api/feishu/casual-agent/events
   ```
   （本地调试可用 Cloudflare Tunnel / ngrok 暴露本机 `3001`，路径保持一致。）
5. 订阅事件：**`im.message.receive_v1`**
6. 复制 **Verification Token** 到 `CASUAL_FEISHU_VERIFICATION_TOKEN`。
7. **加密策略**：MVP 建议先**关闭**事件加密；若开启，需配置 `CASUAL_FEISHU_ENCRYPT_KEY` 并实现解密（当前后端未实现 encrypt 载荷解密）。
8. **版本管理与发布** → 创建版本并发布到测试企业 / 全员。
9. 将机器人拉入测试群，或直接与机器人单聊。

## 4. URL 验证（challenge）失败排查

飞书保存事件订阅时会 POST：

```json
{"type":"url_verification","token":"你的Verification Token","challenge":"随机字符串"}
```

后端必须原样返回 `{"challenge":"随机字符串"}`。若飞书提示 **challenge 没有返回**，按下面顺序检查：

1. **请求地址是否正确**  
   必须是 `https://api.gurublog.uk/api/feishu/casual-agent/events`（不是 `/api/feishu/events`）。

2. **`CASUAL_FEISHU_VERIFICATION_TOKEN` 是否与飞书后台一致**  
   在飞书开放平台 → 事件订阅 → **Verification Token** 复制到 `backend/.env`。不一致会返回 400，飞书侧也会报验证失败。

3. **生产环境是否已重启 API**  
   改 `.env` 后需重启进程（本机 LaunchAgent 或服务器上的 uvicorn/systemd），否则仍跑旧配置。

4. **事件加密是否已关闭**  
   若开启了加密，当前后端未实现解密，会校验失败。MVP 请在飞书后台关闭事件加密。

5. **用 curl 自测**（将 `你的token` 换成飞书后台值）：

```bash
curl -s -X POST https://api.gurublog.uk/api/feishu/casual-agent/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"url_verification","token":"你的token","challenge":"test123"}'
```

期望：`{"challenge":"test123"}`。若返回 `casual feishu bot disabled`，说明生产代码尚未更新到支持「未启用 bot 也可完成 URL 验证」的版本，或请求未打到最新 API。

URL 验证通过后，再设 `CASUAL_FEISHU_BOT_ENABLED=true` 并填写 `APP_ID` / `APP_SECRET` 以接收消息。

## 5. 启动与自检

```bash
cd backend
source .venv/bin/activate
python -m uvicorn main:app --reload --host 0.0.0.0 --port 3001
```

自检：

```bash
# 健康检查（需登录 Cookie 时加鉴权；开发环境可看 casualFeishuBotEnabled）
curl -s http://127.0.0.1:3001/api/ai/health | python3 -m json.tool

# URL 验证（将 token/challenge 换成飞书后台值）
curl -s -X POST http://127.0.0.1:3001/api/feishu/casual-agent/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"url_verification","token":"你的token","challenge":"test123"}'
```

期望返回：`{"challenge":"test123"}`

未启用时：

```bash
curl -s -X POST http://127.0.0.1:3001/api/feishu/casual-agent/events \
  -H 'Content-Type: application/json' \
  -d '{}'
# {"ok":true,"ignored":"casual feishu bot disabled"}
```

## 6. 验收问题集

| 场景 | 预期 |
|---|---|
| 飞书 URL 验证 | 返回 challenge |
| 私聊：「最近微信小游戏榜单有什么变化？」 | 先「正在查询」（若开启 thinking），再中文摘要回答 |
| 群聊未 @ | 不回复 |
| 群聊 @休闲监测助手 + 问题 | 正常回答 |
| 发送 `/reset` | 提示已清空休闲助手会话 |
| 未在白名单用户 | 提示无权限 |

## 7. 与全站监测助手的区别

| | 全站监测助手 | 休闲游戏 Agent |
|---|---|---|
| 回调 URL | `/api/feishu/events` | `/api/feishu/casual-agent/events` |
| 环境变量前缀 | `FEISHU_*` | `CASUAL_FEISHU_*` |
| 会话库 | `assistant_sessions.db` | `casual_assistant_sessions.db` |
| 数据范围 | 四类监测 | 休闲游戏监测为主 |

休闲游戏 Agent 的站内路由默认围绕四个源：微信/抖音小游戏、SensorTower、竞品社媒/UA、我方产品 US 免费榜；用户明确问站外、新闻、官网或实时页面时，再调用联网搜索补充。

## 8. 常见问题

- **URL 验证失败**：检查 `CASUAL_FEISHU_VERIFICATION_TOKEN` 是否与飞书后台一致；API 是否可从公网访问。
- **收不到消息**：确认应用已发布、机器人已入群、事件 `im.message.receive_v1` 已订阅。
- **群聊无响应**：必须 @ 配置在 `CASUAL_FEISHU_BOT_MENTION_NAMES` 中的机器人显示名。
- **回答报错**：查看后端日志 `[casual-feishu-assistant]`；确认 `OPENAI_API_KEY` 与 `AI_PROVIDER` 可用。
