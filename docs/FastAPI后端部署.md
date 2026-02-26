# FastAPI 后端部署说明

后端已改为 **FastAPI（Python）**，提供：**登录鉴权**、**受保护数据文件**（/api/data）、**AI 对话代理**（/api/ai/chat）、**玩法解析申请**（/api/feedback/gameplay-request）、**飞书媒体代理**（/api/feishu-media）。

---

## 一、本地运行

```bash
# 在项目根目录
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # 填写 .env
uvicorn main:app --reload --host 0.0.0.0 --port 3001
```

或从项目根目录指定端口：

```bash
cd backend && uvicorn main:app --host 0.0.0.0 --port 3001
```

前端开发时 Vite 会把 `/api` 代理到 `http://localhost:3001`，直接 `npm run dev` + 上面命令即可联调。

---

## 二、部署到线上并获取访问地址（端口）

线上部署后，平台会给你一个 **公网 URL**（含端口或 80/443），前端用这个 URL 作为 `VITE_API_BASE_URL` 即可，**不需要自己“获取端口”**，端口由平台分配。

### 方式 A：Railway（推荐，有免费额度）

1. 打开 [railway.app](https://railway.app)，用 GitHub 登录。
2. **New Project** → **Deploy from GitHub repo**，选本仓库。
3. 在项目里添加 **Service**，选择该仓库；**Root Directory** 填 `backend`（或只部署 backend 目录）。
4. **Settings**：
   - **Build Command**：`pip install -r requirements.txt`（或留空，Railway 会检测）
   - **Start Command**：`uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Variables**：把 `backend/.env` 里需要的变量都填进去（`PORT` 由 Railway 自动注入）。
5. **Settings → Networking** 里生成 **Public Domain**，得到类似：  
   `https://xxx.up.railway.app`  
   这就是你的**后端地址**，没有显式端口（走 443）。

前端构建时：

```bash
VITE_API_BASE_URL=https://xxx.up.railway.app npm run build
```

然后 `npm run deploy` 部署静态站即可。

---

### 方式 B：Render

1. [render.com](https://render.com) → **New +** → **Web Service**，连 GitHub 仓库。
2. **Root Directory**：`backend`  
   **Runtime**：Python 3  
   **Build Command**：`pip install -r requirements.txt`  
   **Start Command**：`uvicorn main:app --host 0.0.0.0 --port $PORT`
3. **Environment** 里添加和本地 `.env` 相同的变量；`PORT` 由 Render 注入。
4. 部署完成后会得到一个 URL，如：  
   `https://监测汇总-xxxx.onrender.com`  
   即后端地址。

前端构建：

```bash
VITE_API_BASE_URL=https://监测汇总-xxxx.onrender.com npm run build
```

---

### 方式 C：自建 VPS（如 Ubuntu）

1. 把代码拉到服务器（或只拉 `backend` + 同级的 `public`、`data` 等）。
2. 安装 Python 3.10+，创建虚拟环境并安装依赖：
   ```bash
   cd backend && python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```
3. 配置 `.env`（或系统环境变量）。
4. 用 **systemd** 或 **PM2** 跑 uvicorn（示例 systemd）：
   ```ini
   [Unit]
   Description=Monitor FastAPI
   After=network.target
   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/path/to/监测汇总/backend
   Environment="PATH=/path/to/监测汇总/backend/.venv/bin"
   ExecStart=/path/to/监测汇总/backend/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 3001
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```
5. 用 Nginx 反代 3001 并配 HTTPS，对外暴露 80/443，例如：  
   `https://api.yourdomain.com` → 后端。

前端构建时：

```bash
VITE_API_BASE_URL=https://api.yourdomain.com npm run build
```

---

## 三、环境变量汇总（线上必填/选填）

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 平台常自动注入 | 监听端口，Railway/Render 会给你 `$PORT`。 |
| `JWT_SECRET` | 建议 | 随机长字符串，生产务必改。 |
| `LOGIN_USERNAME` | 选填 | 默认 `admin`。 |
| `LOGIN_PASSWORD_HASH` | 建议 | `python -c "from passlib.hash import bcrypt; print(bcrypt.hash('你的密码'))"` 的输出。 |
| `CORS_ORIGIN` | 建议 | 前端域名，如 `https://xxx.github.io`，不填则 `*`。 |
| `OPENAI_API_KEY` | 若用 AI 对话 | OpenRouter / OpenAI 等 Key。 |
| `OPENAI_BASE_URL` | 选填 | 默认 OpenAI；用 OpenRouter 填 `https://openrouter.ai/api/v1`。 |
| `OPENAI_MODEL` | 选填 | 如 `google/gemini-2.0-flash-001`。 |
| `FEISHU_WEBHOOK_URL` / `WECOM_*` | 选填 | 玩法解析申请通知。 |

---

## 四、总结：如何“在线上获取端口”

- **Railway / Render**：不需要自己管端口，平台分配并注入 `PORT`，你只要在 **Networking** 里开 **Public Domain**，得到的就是**最终后端地址**（一般是 `https://xxx`，无端口）。
- **自建 VPS**：自己选一个端口（如 3001）跑 uvicorn，再用 Nginx 用 80/443 反代，对外只暴露 `https://api.xxx.com`，前端用这个域名即可。

拿到后端地址后，用 **`VITE_API_BASE_URL=你的后端地址 npm run build`** 再部署前端，即可前后端分离访问。
