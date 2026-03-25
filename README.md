# 监测汇总平台（Monitor Web）

一个现代化的监测汇总平台，支持 AI 热点检测、热点趋势检测、竞品社媒监控和游戏监控。

前端：React + TypeScript + Vite + Tailwind CSS  
后端：FastAPI（Python）

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

项目中存在多处 `.env`，不同命令读取的也不一样。核心规则：

- `VITE_` 开头的变量只在 **前端构建时**生效（会被打进浏览器代码）
- 后端读取进程环境变量；dotenv 会加载：
  1) 根目录 `.env`  
  2) 然后 `backend/.env`（覆盖根目录同名变量）

需要你关注的文件：

1. 根目录 `.env`（给后端/脚本做默认值；示例见 `.env.example`）
2. `backend/.env`（后端运行必需配置；示例见 `backend/.env.example`）
3. 根目录 `.env.development`（本地开发前端联调；至少需要 `VITE_API_BASE_URL`）
4. 根目录 `.env.staging`（预生产构建用；示例见 `.env.staging.example`）

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

本地联调关键：确保根目录 `.env.development`（可从 `.env.development.example` 复制）至少包含：

```env
VITE_API_BASE_URL=http://localhost:3001
```

前端开发地址：`http://localhost:5173`

开发模式下，Vite 已配置了对 `/api` 的本地代理（避免部分接口 404）。

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

# 监测汇总平台

一个现代化的监测汇总平台，支持 AI 热点检测、热点趋势检测、竞品社媒监控和游戏监控。基于 React + TypeScript + Vite + Tailwind CSS 构建。

## 功能特性

- 📱 响应式设计，适配各种屏幕尺寸
- 🎨 现代化的 UI 设计
- 📊 **4 种监测类型**：
  - 🤖 AI 热点检测
  - 📈 热点趋势检测
  - 📱 竞品社媒监控
  - 🎮 游戏监控
- 🔍 多维度筛选和排序功能
- 📚 监测源管理侧边栏
- 🔎 搜索功能（UI已实现）
- 📊 趋势分析和情感分析展示
- 🌓 深色模式切换（UI已实现）

## 技术栈

- **React 19** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **Tailwind CSS** - 样式框架

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动本地后端（FastAPI）

```bash
cd backend
# 如有虚拟环境，先激活（示例）：
# source backend/.venv/bin/activate
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port 3001
```

- 本地后端配置在 `backend/.env` 中，可参考 `backend/.env.example`。

如需把 AI 对话改成 `codex app-server`（并支持数据库查询、联网搜索工具），在 `backend/.env` 设置：

```env
AI_PROVIDER=codex
CODEX_APP_SERVER_BIN=codex
CODEX_MODEL=gpt-5.1-codex
CODEX_ENABLE_DB_TOOL=true
CODEX_ENABLE_WEB_SEARCH_TOOL=true
```

说明：`codex app-server` 建议配 `OPENAI_BASE_URL=https://api.openai.com/v1`（不建议 OpenRouter）。
可选：配置 `TAVILY_API_KEY` 提升联网搜索质量；不配时默认走 DuckDuckGo。

### 3. 启动本地前端（开发模式）

在项目根目录：

```bash
npm run dev
```

建议在根目录创建 `.env.development`（可从 `.env.development.example` 复制），让前端在开发时直连本地后端：

```env
VITE_API_BASE_URL=http://localhost:3001
```

前端开发地址：`http://localhost:5173`

### 4. 构建生产版本

```bash
npm run build
```

### 5. 预览生产构建

```bash
npm run preview
```

默认预览地址：`http://localhost:4173`

---

## 部署静态页 + 后端，以及如何「回到纯静态」

本项目常见部署方式是：

- 前端：静态站（例如 GitHub Pages）
- 后端：单独部署（例如 Railway 上的 FastAPI）

前端是否「连后端」完全由构建时的 `VITE_API_BASE_URL` 决定，因此可以很容易在「连后端」和「纯静态」之间切换。

### 1. 前置：后端允许静态页域名跨域

在后端环境变量中配置（以 Railway 为例）：

```env
CORS_ORIGIN=https://你的静态站域名
```

例如静态页在 GitHub Pages：

```env
CORS_ORIGIN=https://Oliver-HZK.github.io
```

记下后端地址（例如）：

```text
https://monitor-web-production-xxxx.up.railway.app
```

> 注意：不要带末尾 `/`。

### 2. 部署「连后端」版本的静态页

在项目根目录执行（以 GitHub Pages 为例）：

```bash
# 1）构建时写入后端地址
VITE_API_BASE_URL=https://monitor-web-production-xxxx.up.railway.app npm run build

# 2）移除敏感文件（数据库等）
node scripts/strip-sensitive-from-dist.js

# 3）推送到 GitHub Pages
npx gh-pages -d dist
```

构建后的前端会把所有 `/api/...` 请求发到上述后端地址。

### 3. 一键「回到纯静态」版本

如果发现连后端的版本在静态站上有问题，可以随时重新部署一版「纯静态」页面覆盖掉：

```bash
# 不设置（或清空） VITE_API_BASE_URL，回到纯静态
VITE_API_BASE_URL= npm run build

node scripts/strip-sensitive-from-dist.js
npx gh-pages -d dist
```

- 这不会改源码，也不动 git，只是重新生成 `dist` 并再次部署。
- 新部署完成后，线上静态页就会恢复为「不连后端，只使用打包进去的数据文件」的模式。

## 项目结构

```
src/
├── components/          # React 组件
│   ├── Header.tsx       # 顶部导航栏
│   ├── MonitorCard.tsx  # 监测数据卡片组件
│   ├── MonitorList.tsx  # 监测列表组件
│   └── Sidebar.tsx     # 右侧监测源边栏
├── data/               # 数据文件
│   ├── mockData.ts     # Mock 数据
│   └── dataLoader.ts   # 数据加载器（CSV/DB）
├── types/              # TypeScript 类型定义
│   └── index.ts
├── App.tsx             # 主应用组件
└── main.tsx            # 应用入口
```

## 监测类型说明

### 1. AI 热点检测
监测 AI 领域的最新热点和动态，包括：
- 新模型发布
- 技术突破
- 行业动态
- 产品更新

### 2. 热点趋势检测
分析全网话题趋势，包括：
- 话题热度变化
- 趋势方向（上升/下降/稳定）
- 讨论量统计
- 趋势预测

### 3. 竞品社媒监控
监控竞品在社交媒体上的动态，包括：
- 产品发布
- 融资消息
- 用户反馈
- 营销活动

### 4. 游戏监控
监测游戏行业相关动态，包括：
- 游戏上线
- 版本更新
- 行业报告
- 玩家讨论

## 数据集成

当前项目使用 Mock 数据。要集成真实数据源，请参考 `src/data/dataLoader.ts` 中的示例代码。

### 从 CSV 文件读取数据

```typescript
import { parseCSV } from './data/dataLoader';
const items = await parseCSV('path/to/monitors.csv');
```

### 从数据库读取数据

```typescript
import { loadFromDatabase, loadSourcesFromDatabase } from './data/dataLoader';
const items = await loadFromDatabase();
const sources = await loadSourcesFromDatabase();
```

## CSV 数据格式

监测数据的 CSV 格式示例：

```csv
id,type,title,source,platform,date,time,views,engagement,description,tags,language,trend,sentiment
1,ai热点检测,标题,来源,平台,01-28,14:30,12500,892,描述,"AI,GPT-5",中文,up,positive
```

字段说明：
- `id`: 唯一标识符
- `type`: 监测类型（ai热点检测/热点趋势检测/竞品社媒监控/游戏监控）
- `title`: 标题
- `source`: 来源
- `platform`: 平台（微博/Twitter/Reddit等）
- `date`: 日期（MM-DD格式）
- `time`: 时间（HH:MM格式）
- `views`: 浏览量
- `engagement`: 互动数
- `description`: 描述
- `tags`: 标签（用分号分隔）
- `language`: 语言
- `trend`: 趋势（up/down/stable）
- `sentiment`: 情感（positive/negative/neutral）

## 开发说明

### 添加新的监测数据

编辑 `src/data/mockData.ts` 文件，在 `mockMonitorItems` 数组中添加新的监测对象。

### 自定义样式

项目使用 Tailwind CSS，可以直接在组件中使用 Tailwind 类名，或编辑 `tailwind.config.js` 来自定义主题。

## 后续开发建议

1. **数据集成**：实现从 CSV 或数据库读取真实数据
2. **路由**：添加 React Router 实现多页面导航
3. **状态管理**：考虑使用 Zustand 或 Redux 管理全局状态
4. **API 集成**：添加后端 API 接口调用
5. **用户认证**：实现登录/注册功能
6. **实时更新**：添加 WebSocket 支持实时数据更新
7. **数据可视化**：添加图表展示趋势分析
8. **导出功能**：支持导出监测报告
9. **通知系统**：重要监测事件的通知提醒
10. **深色模式**：完善深色模式切换功能

## 许可证

MIT
