# Cloudflare 域名 + 公开 API（HTTPS）与静态站对接

本文说明如何用你在 **Cloudflare 托管的域名**，让 **后端 API 被公网以 HTTPS 访问**，并与 **静态前端**（GitHub Pages、Cloudflare Pages 等）通过 `VITE_API_BASE_URL` 对接。

---

## 一、先理清：Cloudflare 帮你做什么、不做什么

| Cloudflare 能做的 | Cloudflare 不能替你做的 |
|-------------------|-------------------------|
| 把你的域名解析到「源站」或 **Tunnel**，对外提供 **HTTPS**（证书由 Cloudflare 签发） | 在云端直接运行你的 **Python FastAPI** 进程 |
| 隐藏源站 IP、DDoS 防护、CDN（视配置而定） | 代替数据库或业务逻辑 |

**结论**：API 仍然要在 **某台机器**上跑（家里服务器、云 VPS、Railway 等）。Cloudflare 负责：**域名 → 指向那台机器（或 Tunnel）→ 对外统一用 `https://你的域名` 访问**。

生产环境应使用 **HTTPS**（`https://`）。浏览器里「混合内容」、Cookie 等也要求 HTTPS；若你提到「公开 HTTP」，在 Cloudflare 下用户侧通常是 **自动升级为 HTTPS**。

---

## 二、整体结构（推荐子域名）

常见做法：

| 用途 | 示例 | 说明 |
|------|------|------|
| 静态站 | `https://app.example.com` 或 `https://example.com` | 部署 `dist`（GitHub Pages / Cloudflare Pages） |
| API | `https://api.example.com` | 同一域名下用 **子域名** 区分，避免与静态站路径冲突 |

前端构建时：

```bash
VITE_API_BASE_URL=https://api.example.com npm run build
```

后端环境变量（与 [前后端分离部署](./前后端分离部署.md) 一致）：

```env
CORS_ORIGIN=https://app.example.com
```

若静态站与 API 同主域不同子域，**必须**配置 CORS 为静态站完整 origin（不要用 `*` 若带 Cookie 登录）。

---

## 三、方式 A：Cloudflare Tunnel（无公网 IP 或不想开端口时）

适合：家里 NAS、内网机器、或不想在防火墙开 80/443。

1. 在 **Cloudflare Zero Trust / Tunnels** 里创建一条 Tunnel，安装 `cloudflared` 到跑 API 的机器上。
2. 在 Tunnel 里配置 **Public Hostname**：
   - **Subdomain**：`api.example.com`（或你选的子域）
   - **Service**：`http://127.0.0.1:3001`（与 `backend` 的 `PORT` 一致）
3. 确保本机已启动 API，例如：

   ```bash
   cd backend && uvicorn main:app --host 127.0.0.1 --port 3001
   ```

4. Cloudflare 会自动为该子域提供 **HTTPS**；访客访问 `https://api.example.com`，实际请求经 Tunnel 转到本机。

**注意**：若机器关机或 `cloudflared` 未运行，API 会不可用。生产可用 **systemd** 或进程守护保证 `cloudflared` 与 `uvicorn` 常驻。

---

## 四、方式 B：云服务器 / VPS + 公网 IP + Cloudflare DNS 代理

适合：有固定公网 IP 的 VPS，或云厂商负载均衡。

1. 在服务器上 **监听** 例如 `0.0.0.0:3001`（或前面加 **Nginx/Caddy** 反代到 `127.0.0.1:3001`）。
2. 在 Cloudflare **DNS** 添加记录：
   - **Type**：`A`（或 `AAAA`）
   - **Name**：`api`（即 `api.example.com`）
   - **Content**：服务器公网 IP
   - **Proxy status**：**已代理（橙色云）**（推荐，便于统一 HTTPS）
3. **SSL/TLS** 加密模式：
   - 源站若已配置 **有效证书**：选 **Full (strict)**。
   - 源站仅 HTTP（如 `http://127.0.0.1:3001` 仅本机 Nginx 再对外）：常用 **Full** 并在源站或 Nginx 做自签/证书（按 Cloudflare 文档调整）。
4. 防火墙放行：若 **不** 走 Tunnel，仅 Cloudflare 访问源站，可只放行 Cloudflare IP 段到 80/443（见 Cloudflare 文档「IP 范围」）。

---

## 五、后端 CORS 与 Cookie（与登录相关）

若前端使用 `credentials: 'include'`（本项目部分请求会带 Cookie）：

- `CORS_ORIGIN` 必须设为 **静态站完整 URL**（含 `https://`，不要末尾 `/`）。
- 多个前端（如预发、生产）用逗号分隔：

  ```env
  CORS_ORIGIN=https://app.example.com,https://olivr-hzk.github.io
  ```

- 不要长期用 `CORS_ORIGIN=*` 配合带 Cookie 的跨域（浏览器会拒绝）。

详见仓库内 `backend/config.py` 与 `backend/.env.example`。

---

## 六、静态站部署到 Cloudflare Pages（可选）

若静态站也放在 **Cloudflare Pages**：

- 构建命令里设置环境变量 **`VITE_API_BASE_URL`** = `https://api.example.com`（无末尾斜杠）。
- 在 **Pages → Custom domains** 绑定 `app.example.com` 等。
- 后端 `CORS_ORIGIN` 填该 Pages 的 **HTTPS** 地址。

---

## 七、自检清单

1. 浏览器访问 `https://api.example.com/docs`（FastAPI 自带文档，若生产未关闭）或任意已知的 `GET /api/...` 能返回预期状态。
2. 打开静态站，开发者工具 **Network** 里请求 `https://api.example.com/api/...` 无 **CORS** 红字。
3. 若需登录，确认 Cookie 与 `SameSite`、跨域策略符合预期。

---

## 八、与本文档相关的其他说明

- 前后端环境变量与构建参数：[前后端分离部署](./前后端分离部署.md)  
- 后端部署细节：[后端部署说明](./后端部署说明.md)  
- 静态部署勿把 `public/*.db` 等敏感文件打进公网：`前后端分离部署` 第五节

---

**总结**：借助 Cloudflare 域名，你可以把 **API 以 HTTPS 形式暴露为 `https://api.你的域名`**，再在 **构建静态站时** 设置 `VITE_API_BASE_URL` 指向该地址，并在后端配置 **`CORS_ORIGIN`** 为你的静态站域名。Cloudflare 本身不运行 Python，**Tunnel 或 DNS 指向** 才是把域名和「跑 API 的那台机器」连起来的关键。
