# 环境变量说明

按**两套前端、一套后端**理解即可；其它文件都是在这三套上的补充或可选场景。

---

## 总览

| 层 | 场景 | 用哪些文件 |
|----|------|------------|
| **前端 A：本地开发** | `npm run dev` | 根目录 **`.env.development`**（可从 `.env.development.example` 复制） |
| **前端 B：静态站（如 GitHub Pages）** | `npm run build` / `npm run deploy` | 根目录 **`.env.production`**，或在构建命令前设置 `VITE_*`；不接后端时可不配 API 地址 |
| **后端：FastAPI** | `uvicorn`、本机或经 Tunnel 暴露的公网 API | **`backend/.env`**（先读根目录 `.env`，再读 `backend/.env`，后者覆盖） |

**根目录 `.env`**：给**定时脚本、Python 工具**等用；后端也会先加载它作为默认值。敏感项优先写在 **`backend/.env`** 且勿提交。

**约定**：只有 **`VITE_` 开头**的变量会打进浏览器；后端变量不进前端。

---

## 前端 A：本地开发

- 文件：**`.env.development`**
- 常用：`VITE_API_BASE_URL`（若需直连后端；当前 Vite 开发模式亦可用代理把 `/api` 转到本机 3001，见 `vite.config.ts`）
- 开发地址示例：`http://localhost:5173/monitor-web/`

---

## 前端 B：GitHub Pages 等静态部署

- 文件：**`.env.production`**（可选；不配时看根 `.env` 里 `VITE_*` 或构建时环境变量）
- 常用：**`VITE_API_BASE_URL`** = 公网 API 根地址（不要末尾 `/`），例如 `https://api.gurublog.uk`
- 其它：`VITE_BASE`（子路径如 `/monitor-web/`）、`VITE_STATIC_PASSWORD_HASH`（静态访问密码，按需）

---

## 后端（唯一一套运行时配置）

- 文件：**`backend/.env`**（必看示例：`backend/.env.example`）
- 加载顺序：根 **`.env`** → **`backend/.env`**
- 常用：`PORT`、`JWT_SECRET`、`LOGIN_*`、`CORS_ORIGIN`（须包含静态站 origin，如 `https://olivr-hzk.github.io`）、`OPENAI_*`、`AI_PROVIDER`、飞书/企微等

**说明**：经 **Cloudflare Tunnel** 访问的 `https://api.xxx` 仍是同一套 FastAPI，**不单独再建一份 env**；只要在跑 `uvicorn` 的机器上维护好 **`backend/.env`** 即可。

---

## 脚本（根目录 `.env`）

跑 `scripts/` 下任务时多读**根目录 `.env`**（大模型 Key、飞书多维表格、SensorTower 等）。与「两套前端」无冲突；按需填写即可。

---

## 可选：预生产构建

若使用 **`npm run build:staging` / `deploy:staging`**，可另建 **`.env.staging`**（见 `.env.staging.example`）。不属于上述「两套前端」的必选项。

---

## 一般不需要

- **`server/.env`**：仅在使用 `node server/server.js` 时；当前以 FastAPI 为主时可忽略。

---

## 从示例复制

| 示例 | 复制为 |
|------|--------|
| `.env.example` | 根 `.env` |
| `.env.development.example` | `.env.development` |
| `.env.staging.example` | `.env.staging`（可选） |
| `backend/.env.example` | `backend/.env` |

含密钥的文件请 `.gitignore`，只提交 `.example`。
