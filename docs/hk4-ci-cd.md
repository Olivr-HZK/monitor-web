# hk4 CI/CD 部署

目标目录固定为：

```text
/root/oliver/monitor-web
```

默认部署分支为 `staging`。部署脚本只在项目目录内拉取代码、安装依赖、构建和自检；不会写 nginx、systemd 或 crontab。只有显式设置 `DEPLOY_RESTART_SERVICE` 时才会重启服务。

## 服务器部署入口

```bash
/root/oliver/monitor-web/scripts/deploy/hk4_deploy.sh
```

常用手动命令：

```bash
APP_DIR=/root/oliver/monitor-web \
DEPLOY_BRANCH=staging \
DEPLOY_INSTALL_PIPELINES=1 \
bash /root/oliver/monitor-web/scripts/deploy/hk4_deploy.sh
```

它会执行：

1. 初始化或更新 `/root/oliver/monitor-web/.git`
2. `git fetch` + `git reset --hard origin/<branch>`
3. `npm ci` + `npm run build`
4. 创建/更新 `backend/.venv`
5. 可选创建/更新三条 pipeline 的 `.venv` / `node_modules`
6. 临时启动 API 做 `/openapi.json` 自检，再停止
7. 写入 `logs/deploy/latest.log`、`logs/deploy/last_success`

## GitHub Actions

工作流文件：

```text
.github/workflows/deploy-hk4.yml
```

触发方式：

- push 到 `staging`
- GitHub Actions 页面手动 `workflow_dispatch`

需要在 GitHub 仓库 Settings -> Secrets and variables -> Actions 配置：

| Secret | 用途 |
| --- | --- |
| `HK4_HOST` | hk4 主机 IP 或域名 |
| `HK4_USER` | SSH 用户，当前可用 `root` |
| `HK4_PORT` | SSH 端口，默认 `22` |
| `HK4_SSH_KEY` | GitHub Actions 连接 hk4 的私钥 |

## hk4 拉取 GitHub 仓库权限

hk4 需要能读取：

```text
git@github.com:Olivr-HZK/monitor-web.git
```

当前仓库若是 public，服务器可直接拉取。若改为 private，需要给 hk4 配只读 Deploy Key，或让部署脚本使用可读该仓库的 SSH key。不要把私钥提交到仓库。

## 可选启用 API systemd

模板文件：

```text
scripts/deploy/monitor-web-api.service
```

启用前请先确认要让 API 常驻。示例：

```bash
cp /root/oliver/monitor-web/scripts/deploy/monitor-web-api.service /etc/systemd/system/monitor-web-api.service
systemctl daemon-reload
systemctl enable --now monitor-web-api.service
```

之后 CI/CD 可在手动触发时传入 `restart_service=monitor-web-api.service`，或在 workflow 默认值里打开。

## 不纳入 Git 的运行数据

以下内容由服务器本地保留，不随 Git 覆盖：

- `.env`
- `.env.production`
- `backend/.env`
- `data/`
- `logs/`
- `node_modules/`
- `backend/.venv/`
- `pipelines/**/.venv/`
- `pipelines/**/node_modules/`
- `.cache/`

数据库快照仍放在：

```text
/root/oliver/monitor-web/data/databases
```
