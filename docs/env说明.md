# 环境变量说明

项目里有多处 `.env`，不同命令读取的也不一样。下面按「谁在用」和「你需要哪些文件」整理。

---

## 一、.env 文件都在哪、谁在读

| 文件 | 何时被读 | 谁在读 |
|------|----------|--------|
| **根目录 `.env`** | 始终 | 后端 FastAPI（先读）、Node server（先读）、各 Python 脚本 |
| **根目录 `.env.development`** | 仅 `npm run dev` | Vite 前端开发模式 |
| **根目录 `.env.staging`** | 仅 `npm run build:staging` / `deploy:staging` | Vite 预生产构建 |
| **根目录 `.env.production`** | 仅 `npm run build`（生产构建） | Vite 生产构建（可选，不建则用 `.env` 里以 VITE_ 开头的） |
| **`backend/.env`** | 启动后端时 | 后端 FastAPI（在根 .env 之后读，可覆盖） |
| **`server/.env`** | 启动 Node server 时 | Node server（在根 .env 之后读，可覆盖） |

说明：

- **Vite** 只会把 **`VITE_` 开头**的变量打进前端代码，其它变量不会带到浏览器。
- **后端 / server** 读的是进程环境变量，所以根目录和各自目录下的 `.env` 都会被 dotenv 加载（先根目录再子目录）。

---

## 二、按「用途」分类的变量清单

### 1. 前端构建（Vite）—— 只认 `VITE_` 开头

这些要在 **构建时** 就确定，写进打包后的前端里。

| 变量 | 说明 | 哪里配 | 何时需要 |
|------|------|--------|----------|
| `VITE_API_BASE_URL` | 后端 API 根地址（不要末尾 `/`） | `.env.development` 本地联调 / `.env.staging` 预生产 / 生产构建时命令行或 `.env.production` | 前后端分离、本地 dev 连后端时必配 |
| `VITE_STATIC_PASSWORD_HASH` | 静态模式「访问密码」的 SHA-256 十六进制哈希 | 根 `.env` 或 `.env.production`（生产静态站时） | 仅当部署纯静态站且要用「访问密码」时 |
| `VITE_BASE` | 前端站点 base 路径，如 `/monitor-web/` | 根 `.env`（可选） | 部署到子路径时改，默认用 vite 里的 `/monitor-web/` |

**你需要的前端 env 文件：**

- **本地开发**：根目录 `.env.development`（可从 `.env.development.example` 复制），里面至少 `VITE_API_BASE_URL=http://localhost:3001`。
- **预生产部署**：根目录 `.env.staging`（可从 `.env.staging.example` 复制），里面 `VITE_API_BASE_URL=https://预生产后端地址`。
- **生产部署**：若用「接后端」的构建，在构建命令前加 `VITE_API_BASE_URL=...` 或建 `.env.production`；若用当前「纯静态」部署，可以不设。

---

### 2. 后端（FastAPI，`backend/`）

后端会先读 **根目录 `.env`**，再读 **`backend/.env`**（后者覆盖前者）。部署到 Railway 等平台时，在平台里配即可，不必依赖本地文件。

| 变量 | 说明 | 必填 |
|------|------|------|
| `PORT` | 监听端口 | 否，默认 3001 |
| `JWT_SECRET` | JWT 签名密钥 | 生产必填，且要随机长串 |
| `LOGIN_USERNAME` | 登录用户名 | 否，默认 admin |
| `LOGIN_PASSWORD_HASH` | 登录密码哈希（pbkdf2-sha256 或 bcrypt） | 生产必填，否则等于无密码 |
| `CORS_ORIGIN` | 允许的前端来源，如 `https://Oliver-HZK.github.io` | 生产建议填，本地可 `*` |
| `OPENAI_API_KEY` | 大模型 API Key（OpenRouter / OpenAI 等） | 要用 AI 对话必填 |
| `OPENAI_BASE_URL` | 大模型接口根地址 | 否，默认 OpenAI；用 OpenRouter 则填其 API 地址 |
| `OPENAI_MODEL` | 模型名 | 否，有默认值 |
| `FEISHU_WEBHOOK_URL` | 飞书机器人 Webhook（玩法解析等通知） | 可选 |
| `WECOM_WEBHOOK_URL_REAL` 或 `WECOM_WEBHOOK_URL` | 企微机器人 Webhook | 可选 |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 飞书应用，用于飞书媒体代理等 | 可选 |
| `FEISHU_MEDIA_PUBLIC` | 飞书媒体是否对未登录用户开放 | 可选 |
| `PUBLIC_DIR` | 数据文件根目录（默认项目下 `public`） | 一般不配 |
| `DATA_DIR` | 玩法申请等数据目录 | 一般不配 |

**你需要的：** 本地跑后端时，在 **`backend/.env`** 里配一套（或沿用根 `.env`）；上线在 Railway 等处填同一批变量。

---

### 3. Node 静态站后端（`server/`）

和 FastAPI 类似，先读 **根目录 `.env`**，再读 **`server/.env`**。只有当你用 `node server/server.js` 这类方式起一个「带 /api 的静态站」时才需要。

| 变量 | 说明 | 必填 |
|------|------|------|
| `PORT` | 监听端口 | 否 |
| `JWT_SECRET` | 同后端 | 生产必填 |
| `LOGIN_USERNAME` / `LOGIN_PASSWORD_HASH` | 同后端 | 生产必填 |
| `CORS_ORIGIN` | 同后端 | 建议 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | AI 对话 | 要用则填 |
| `FEISHU_*` / `WECOM_*` | 同后端 | 可选 |

**你需要的：** 若当前只用 FastAPI 做后端、不用 Node server，可以只保留 **`server/.env.example`** 作参考，不建 `server/.env` 也行。

---

### 4. 各类 Python 脚本（根目录 `.env`）

脚本一般只读 **根目录 `.env`**，用于跑一次性任务或定时任务。

| 变量 | 说明 | 用到的脚本示例 |
|------|------|----------------|
| `OPENROUTER_API_KEY` 或 `OPENAI_API_KEY` | 大模型 Key | `generate_top5_insight.py`、周报/竞品摘要等 |
| `FEISHU_WEBHOOK_URL` / `WECOM_WEBHOOK_URL_REAL` | 通知推送 | `send_minigame_weekly_reports.py`、`send_competitor_digest.py` 等 |
| `SENSORTOWER_OVERVIEW_BASE` | SensorTower 后台地址 | 部分周报/摘要脚本 |
| `SENSORTOWER_OVERVIEW_PROJECT_ID` | 项目 ID | 部分脚本 |
| `SENSORTOWER_DB_URL` | 数据库拉取地址 | `fetch_sensortower_db.py` |
| `hot_app_id` / `hot_app_secret` / `hot_app_token` / `hot_table_id` / `hot_view_id` 等 | 飞书多维表格（热点） | `fetch_feishu_bitable_export.py`、`convert_tiktok_trending_csv.py` |
| `ai_app_id` / `ai_app_secret` / `ai_*` | 飞书多维表格（AI 等） | 相关脚本 |

**你需要的：** 根目录保留一个 **`.env`**，把上面用到的脚本所需的键都写上（没用的可以留空或注释）。脚本按需读取，不会影响前端或后端运行。

---

## 三、建议：你实际需要保留的 .env 文件

| 文件 | 是否建议保留 | 用途 |
|------|--------------|------|
| **根目录 `.env`** | 是 | 脚本、以及给 backend/server 做默认值；只放非敏感或可提交的示例，敏感内容用 backend/.env 或本地忽略 |
| **根目录 `.env.development`** | 是 | 本地 `npm run dev` 时前端连本地后端，至少 `VITE_API_BASE_URL=http://localhost:3001` |
| **根目录 `.env.staging`** | 按需 | 预生产构建时用，填 `VITE_API_BASE_URL=预生产后端地址`（可从 `.env.staging.example` 复制） |
| **根目录 `.env.production`** | 可选 | 只有在你用 `npm run build` 且要接生产后端时再建，写 `VITE_API_BASE_URL=生产后端地址` |
| **`backend/.env`** | 是 | 本地/部署后端时用，包含登录、CORS、AI、飞书/企微等；**不要提交敏感内容**，用 `.gitignore` 忽略 |
| **`server/.env`** | 仅当用 Node server 时 | 和 backend 类似，不用 Node server 可只保留 example |

**示例：只做本地开发 + 静态站部署 + 一个生产后端时**

- 根目录：`.env`（给脚本用）、`.env.development`（`VITE_API_BASE_URL=http://localhost:3001`）。
- 后端：`backend/.env`（登录、CORS、OPENAI_* 等），且不提交。
- 若要做预生产：再建 `.env.staging`，内容参考 `.env.staging.example`。

---

## 四、.env.example 与复制关系

| 示例文件 | 复制为 | 说明 |
|----------|--------|------|
| 根目录 `.env.example` | 根 `.env` | 脚本 + 通用示例 |
| `backend/.env.example` | `backend/.env` | 后端必填/选填项说明 |
| `server/.env.example` | `server/.env` | Node server 用 |
| `.env.staging.example` | `.env.staging` | 预生产构建用 |

各 `.env` 文件建议加入 `.gitignore`（至少 `backend/.env`、根 `.env` 若含密钥也要忽略），只提交对应的 `.env.example`。
