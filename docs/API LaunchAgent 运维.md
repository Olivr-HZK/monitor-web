# API LaunchAgent 运维

本机 `api.gurublog.uk` 后端对应的是 `monitor-web/backend` 的 FastAPI 进程，建议用 macOS LaunchAgent 保活，避免终端进程退出或重启后 API 变 502。

## 安装或刷新

在仓库根目录执行：

```bash
./scripts/install_monitor_web_api_launchagent.sh
```

默认配置：

- Label：`com.ggbond.monitor-web-api`
- Python：优先 `backend/.venv/bin/python`
- 端口：`3001`
- 工作目录：`backend/`
- 日志：`logs/backend-api.out.log`、`logs/backend-api.err.log`

需要覆盖时可用环境变量：

```bash
MONITOR_API_PORT=3001 \
MONITOR_API_LABEL=com.ggbond.monitor-web-api \
MONITOR_API_PYTHON_BIN=/Users/ggbond/lyb/monitor-web/backend/.venv/bin/python \
./scripts/install_monitor_web_api_launchagent.sh
```

## 检查

```bash
launchctl list | grep com.ggbond.monitor-web-api
curl -sfS http://127.0.0.1:3001/openapi.json >/dev/null
curl -sfS https://api.gurublog.uk/openapi.json >/dev/null
```

若修改了 backend 代码、依赖或 `.env`，执行安装脚本会重新 bootstrap 并 `kickstart`。公网域名仍依赖 Cloudflare Tunnel；如果本地 API 正常但公网 502，再检查 tunnel 进程/LaunchAgent。
