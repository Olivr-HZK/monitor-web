# 监测汇总平台（Monitor Web）

一个现代化的监测汇总平台，支持 AI 热点检测、热点趋势检测、竞品社媒监控和游戏监控。

前端：React + TypeScript + Vite + Tailwind CSS  
后端：FastAPI（Python）

### 前端界面与路由（当前版本）

- **整体风格**：高对比、硬边阴影与粗边框的终端/情报面板风格；正文字体 Plus Jakarta Sans，标题数字用 Outfit（见 `index.html` 字体引用与 `tailwind.config.js` 主题扩展）。
- **首页**：路由 `/`，展示四类监测入口与汇总统计；顶栏可选「全部 / AI热点 / 趋势监测 / 休闲游戏监测 / AI产品监测」。
- **按类型工作台**：路由 `/type/:monitorType`（`monitorType` 为 URL 编码的中文类型名，如「休闲游戏监测」）。主内容在左、右侧为「监测源」侧栏（可纵向滚动）。
- **休闲游戏监测**：默认数据源块为 **SensorTower**，侧栏中 **SensorTower 榜单** 区块在 **微信 / 抖音小游戏** 之上；含周报简要、商店页变化、竞品（社媒 / UA）、我方产品检测占位等。可从工作台进入微信/抖音或 SensorTower 排行榜子页。
- **独立休闲入口**：构建产物含 `casual.html`，仅休闲游戏相关布局（`src/casual/`），便于单独嵌入或专注使用。
- **顶栏**：Logo + 类型切换；后端登录时显示用户名与「退出」。不含全局搜索框、通知铃铛、夜间模式开关（以当前代码为准）。

更多面向使用者的界面说明见 **[docs/监测汇总网站说明.md](./docs/监测汇总网站说明.md)**。

---

## 依赖清单

### 前端依赖
- Node.js（建议 LTS，如 20.x）
- npm（随 Node 一起安装）

前端依赖（从 `package.json` 推断）：
- `react@^19`
- `react-router-dom@^7`
- `vite@^7`
- `tailwindcss@^3`
- `typescript@~5.9`
- `sql.js`、`papaparse` 等（用于本地数据/解析）

### 后端依赖
- Python 3.10+（建议 3.11/3.12）
- pip

从 `backend/requirements.txt`：
- `fastapi>=0.109.0`
- `uvicorn[standard]>=0.27.0`
- `PyJWT>=2.8.0`
- `passlib[bcrypt]>=1.7.4`
- `httpx>=0.26.0`
- `python-dotenv>=1.0.0`
- `pydantic>=2.0.0`

补充（仓库根目录 `requirements.txt`）：
- `python-dotenv`（用于跑一些根目录脚本）

---

## 环境变量与配置文件

按 **两套前端、一套后端** 记即可（细则见 **[docs/env说明.md](./docs/env说明.md)**）：

| | 文件 | 说明 |
|--|------|------|
| **前端 · 本地开发** | `.env.development` | `npm run dev` 时加载；`VITE_*` 会打进前端 |
| **前端 · 静态站构建（如 GitHub Pages）** | `.env.production`（或构建时注入 `VITE_*`） | `npm run build` / `npm run deploy`；典型配置 `VITE_API_BASE_URL=https://api.gurublog.uk`，与 [API 文档](https://api.gurublog.uk/docs) 一致 |
| **后端 · FastAPI（含本机与经 Cloudflare 暴露的同一进程）** | 先根目录 `.env`，再 **`backend/.env`**（覆盖） | 登录、CORS、`OPENAI_*` 等 |

另：**根目录 `.env`** 还给脚本、定时任务用。`VITE_` 仅在前端构建/开发时生效。

**后端 CORS**：公网 API 在 `api.gurublog.uk` 时，在 **`backend/.env`** 里设置 `CORS_ORIGIN`，包含静态站 origin（如 `https://olivr-hzk.github.io`）及本地 `http://localhost:5173`（见 `backend/.env.example`）。

### 1) 准备后端登录密码哈希（生产建议）

如果你需要启用登录（`LOGIN_PASSWORD_HASH`），请生成哈希值：

```bash
cd backend
# 如果你有虚拟环境，先激活：
# source backend/.venv/bin/activate

python hash_password.py '你的密码'
```

把输出复制到 `backend/.env` 的 `LOGIN_PASSWORD_HASH`。

> 常见格式：`pbkdf2_sha256`（项目 `hash_password.py` 使用该方式）

---

## 本地开发（开发端：前端 + 后端都在本机）

### 0) 激活虚拟环境（如存在）

仓库里通常有 `backend/.venv`（你当前环境中也存在）。运行命令前建议先激活；若不存在可先创建：

```bash
# 创建虚拟环境（如不存在）
python3 -m venv backend/.venv
source backend/.venv/bin/activate
```

### 1) 安装后端依赖

```bash
cd backend
pip install -r requirements.txt
```

### 2) 启动后端（FastAPI）

默认监听 `3001`：

```bash
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 3001
```

后端环境变量：
- `backend/.env`：按 `backend/.env.example` 复制并填写
- 根目录 `.env`：按 `.env.example` 复制并填写（给脚本/默认值用）

### 3) 启动前端（开发模式）

在项目根目录：

```bash
#
# 如你有虚拟环境（仅影响 Python），前端不需要激活；直接：
npm install
npm run dev
```

本地联调：按需复制 `.env.development.example` 为 `.env.development`。开发模式下 Vite 会将 **`/api` 代理到本机后端**（见 `vite.config.ts`），一般不必再配直连的 `VITE_API_BASE_URL`。

前端开发地址示例：`http://localhost:5173/monitor-web/`

---

## 构建与部署（生产方式）

生产部署通常分三类：**同域部署**、**前后端分离部署**、**纯静态部署**。

### 通用构建命令

```bash
# 基础构建
npm run build

# 预生产/分支构建
npm run build:staging

# 预览（本地预览构建产物）
npm run preview
```

`npm run preview` 默认地址：`http://localhost:4173`

**GitHub Pages 静态站 + 本机后端经 Cloudflare 暴露（`https://api.gurublog.uk`）**

1. 复制 **`.env.production.example`** 为 **`.env.production`**（已加入 `.gitignore`），其中 **`VITE_API_BASE_URL=https://api.gurublog.uk`**。
2. 在本机已能登录 GitHub 的终端执行：**`npm run deploy:api`**（会执行 `npm run build`、`STRIP_DIST_DB=1` 去掉 `dist` 中的 `.db`，再把 `dist` 推到 **`gh-pages`** 分支）。
3. 后端 **`backend/.env`** 里 **`CORS_ORIGIN`** 须包含静态页 origin，例如 **`https://olivr-hzk.github.io`**（与 `package.json` 的 `homepage` 一致）。

---

### 方式 A：前后端同域（同一台服务器 + Nginx 反代）

适用场景：你想让用户访问同一个域名，例如 `https://monitor.xxx.com`，由 Nginx 把 `/api` 转发给后端。

做法：

1. **构建前端时不要设置 `VITE_API_BASE_URL`**（或设为空），这样前端请求会走相对路径 `/api/...`
2. 在服务器上部署前端 `dist/`
3. 在服务器上启动后端（同一台机器上），例如监听 `127.0.0.1:3001`
4. 配置 Nginx：

```nginx
server {
    listen 80;
    server_name monitor.xxx.com;

    root /opt/monitor/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

后端只需正确配置它的环境变量（`backend/.env` 或平台环境变量）。

---

### 方式 B：前后端分离（静态站 + 独立后端）

适用场景：前端托管在 GitHub Pages / Vercel / Cloudflare Pages；后端部署在 Railway/Render/VPS。

做法：

1. **后端部署**
   - 后端使用 `backend/requirements.txt` 安装依赖
   - 启动命令：
     ```bash
     cd backend
     uvicorn main:app --host 0.0.0.0 --port $PORT
     ```
2. **后端配置 CORS**
   - 在后端环境变量里设置 `CORS_ORIGIN` 为你的前端域名（不带末尾 `/`）
   - 示例（仅允许某个前端源）：
     ```env
     CORS_ORIGIN=https://你的前端域名
     ```
   - 不填则默认 `*`（便于本地调试，但生产建议收敛）
3. **前端构建时写入后端地址**

   在项目根目录构建：
   ```bash
   VITE_API_BASE_URL=https://你的后端域名 npm run build
   ```
   注意：`VITE_API_BASE_URL` 不要末尾 `/`。
4. 部署前端 `dist/` 到静态托管。

这样前端会把所有请求（如 `/api/me`、`/api/ai/chat`、`/api/data/...`）发给你的后端。

---

### 方式 C：纯静态部署（不跑后端）

适用场景：你只想展示页面里“已打包进 `dist` 的数据文件”，并且不启用需要后端的 API 功能。

关键点：

1. **前端构建时不设置 `VITE_API_BASE_URL`**，使其走相对 `/api/...`（但由于你不会启动后端，因此相关功能会不可用或失败）
2. `public/` 目录里的文件会被打包进 `dist` 并公开访问
3. 项目已经提供脚本在静态部署前删除部分敏感文件（避免直接被下载）

建议使用项目内置部署脚本（而不是手动 `gh-pages -d dist`）：

```bash
# 生产静态部署（GitHub Pages）
npm run deploy

# 预生产静态部署（staging 分支）
npm run deploy:staging
```

其中 `deploy`/`deploy:staging` 会执行：
- `npm run build` / `npm run build:staging`
- `node scripts/strip-sensitive-from-dist.js`
- `gh-pages -d dist`

---

## API 与鉴权概览

后端（FastAPI）主要接口：

- `POST /api/login`：登录，成功后设置 cookie（`token`）
- `GET /api/me`：获取当前用户（需要 token）
- `POST /api/logout`：登出
- `POST /api/ai/chat`：AI 对话代理（生产环境可配置是否强制登录）
- `POST /api/feedback/gameplay-request`：玩法解析申请（可触发飞书/企微 webhook）
- `GET /api/data/{filename}`：受保护数据文件下载（需要登录，按白名单校验）

受保护数据文件由后端鉴权接口 `/api/data/...` 按白名单提供；而静态部署时仅会额外删除 `scripts/strip-sensitive-from-dist.js` 指定的部分 json/csv/md（避免被直接公开下载）。

---

## 快速部署到 GitHub Pages（配后端/不配后端两种）

### 1) 配后端版本（前后端分离的静态站）

```bash
# 生产：构建时写入后端地址
VITE_API_BASE_URL=https://你的后端域名 npm run build

# 删除静态里不应公开的敏感文件
node scripts/strip-sensitive-from-dist.js

# 推送到 GitHub Pages
npx gh-pages -d dist
```

也可以直接用：

```bash
npm run deploy
```

### 2) 回到纯静态版本

```bash
VITE_API_BASE_URL= npm run build
node scripts/strip-sensitive-from-dist.js
npx gh-pages -d dist
```

---

## 预生产部署（staging）

推荐流程：

1. 创建 `staging` 分支并推送到远程（后续可配合 Pages 做预生产）
2. 部署一个预生产后端（Railway/Render 等）并拿到公网地址
3. 在根目录创建并填写 `.env.staging`：

```env
VITE_API_BASE_URL=https://你的预生产后端域名
```

4. 构建并推送预生产前端：

```bash
npm run deploy:staging
```

---

## 项目目录结构（理解用）

- `src/`：前端代码
- `public/`：会在构建时被拷贝到 `dist/` 的数据/静态文件
- `backend/`：FastAPI 后端
- `scripts/`：构建/部署/脚本工具

---

## 常见问题排查

1. **前端请求 `/api/...` 走错域名**
   - 检查你构建时是否设置了 `VITE_API_BASE_URL`
   - 检查后端 `CORS_ORIGIN` 是否允许你的前端域名
2. **生产部署但 AI 对话不可用**
   - 检查 `backend/.env` 中是否配置 `OPENAI_API_KEY`（或 `AI_PROVIDER=codex` 的相关配置）
3. **静态站部署后仍有不该公开的文件**
   - 使用内置 `npm run deploy` / `npm run deploy:staging`（会自动运行 `strip-sensitive-from-dist.js`）
4. **登录失败**
   - 确保 `LOGIN_USERNAME` 与 `LOGIN_PASSWORD_HASH` 配置正确
   - 确保 `JWT_SECRET` 在生产环境是随机长串

---

## 许可证

MIT

---

## 附录：AI 后端（Codex app-server）可选配置

如需把 AI 对话改成 `codex app-server`（并支持数据库查询、联网搜索工具），在 `backend/.env` 设置：

```env
AI_PROVIDER=codex
CODEX_APP_SERVER_BIN=codex
CODEX_MODEL=gpt-5.1-codex
CODEX_ENABLE_DB_TOOL=true
CODEX_ENABLE_WEB_SEARCH_TOOL=true
```

说明：`codex app-server` 建议配 `OPENAI_BASE_URL=https://api.openai.com/v1`（不建议 OpenRouter）。可选：配置 `TAVILY_API_KEY` 提升联网搜索质量；不配时默认走 DuckDuckGo。
