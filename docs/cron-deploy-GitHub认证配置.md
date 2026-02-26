# Cron 下自动部署到 GitHub Pages 的认证配置

定时任务 `sync_dbs_and_deploy.sh` 会执行 `npm run deploy`（gh-pages 推送到 GitHub）。在 cron 环境中没有交互界面，无法输入用户名/密码，需要事先配置**免交互认证**。

**推荐方式：为该仓库单独配置 SSH Deploy Key（无密码）**  
- 只对当前仓库有推送权限，不影响其他仓库  
- cron 运行时无需输入任何内容  
- 不把 Token 写在脚本或环境变量里，相对更安全  

---

## 一、生成仅用于本仓库的 SSH 密钥（无密码）

在终端执行（一路回车，**密码留空**，方便 cron 使用）：

```bash
# 在 ~/.ssh 下生成专用于 monitor-web 的密钥对
ssh-keygen -t ed25519 -C "cron-deploy-monitor-web" -f ~/.ssh/id_ed25519_monitor_web -N ""
```

- 会得到两个文件：  
  - `~/.ssh/id_ed25519_monitor_web`（私钥，勿泄露、勿提交到 Git）  
  - `~/.ssh/id_ed25519_monitor_web.pub`（公钥，下一步要贴到 GitHub）

---

## 二、在 GitHub 上添加 Deploy Key

1. 打开仓库：<https://github.com/Olivr-HZK/monitor-web>
2. 进入 **Settings** → 左侧 **Deploy keys** → **Add deploy key**
3. **Title** 填：`cron deploy (Mac)`（或任意备注）
4. **Key** 里粘贴公钥内容（整段，一行）：

   ```bash
   cat ~/.ssh/id_ed25519_monitor_web.pub
   ```

   复制终端输出的整行，粘贴到 GitHub 的 Key 输入框。
5. 勾选 **Allow write access**（部署需要 push）
6. 点击 **Add key**

---

## 三、把监测汇总仓库的 remote 改为 SSH

当前是 HTTPS，推送时会要密码/凭据。改成 SSH 后，会改用上面的 Deploy Key。

在终端执行：

```bash
cd /Users/oliver/guru/监测汇总
git remote set-url origin git@github.com:Olivr-HZK/monitor-web.git
git remote -v
```

确认两行都是 `git@github.com:Olivr-HZK/monitor-web.git`。

---

## 四、让 cron 使用这把密钥（仅在该仓库生效）

cron 默认不会用你平时用的 `id_ed25519`，需要显式指定用 `id_ed25519_monitor_web`。用 Git 的 `core.sshCommand` 只对当前仓库生效，不会影响其他项目：

```bash
cd /Users/oliver/guru/监测汇总
git config core.sshCommand "ssh -i ~/.ssh/id_ed25519_monitor_web -o IdentitiesOnly=yes"
```

之后在该仓库里执行 `git push`、`gh-pages` 等都会自动用这把密钥。

---

## 五、验证能否免交互推送

在**同一用户、同一终端环境**下跑（不通过 cron）：

```bash
cd /Users/oliver/guru/监测汇总
npm run deploy
```

- 若成功：说明 SSH + Deploy Key 已生效，cron 里一般也能用。  
- 若仍报错：  
  - 检查 GitHub Deploy keys 里是否勾选了 **Allow write access**  
  - 执行 `ssh -T -i ~/.ssh/id_ed25519_monitor_web git@github.com`，应看到类似 “Hi Olivr-HZK/... You've successfully authenticated.”

---

## 六、cron 下再测一次

确认手动 `npm run deploy` 成功后，再跑一次完整脚本（跳过等待）：

```bash
SYNC_WAIT_MAX=0 /bin/bash /Users/oliver/guru/监测汇总/scripts/sync_dbs_and_deploy.sh
```

若能看到 “npm run deploy 完成” 和 “游戏检测周报推送完成”，说明在你这台机器上 cron 定时跑也会用同一套 Git 配置，周一 11:30 的定时任务即可正常部署并推送游戏周报。

---

## 小结

| 步骤 | 操作 |
|------|------|
| 1 | 生成无密码 SSH 密钥：`ssh-keygen -t ed25519 -C "cron-deploy-monitor-web" -f ~/.ssh/id_ed25519_monitor_web -N ""` |
| 2 | 在 GitHub 仓库 Settings → Deploy keys 添加公钥，并勾选 Allow write access |
| 3 | 监测汇总目录下：`git remote set-url origin git@github.com:Olivr-HZK/monitor-web.git` |
| 4 | 监测汇总目录下：`git config core.sshCommand "ssh -i ~/.ssh/id_ed25519_monitor_web -o IdentitiesOnly=yes"` |
| 5 | 运行 `npm run deploy` 验证；再运行 `SYNC_WAIT_MAX=0 .../sync_dbs_and_deploy.sh` 做完整测试 |

若你有多台机器或多人跑 cron，每台机器生成自己的 Deploy Key 并在 GitHub 里加多个 key 即可（同一仓库可添加多个 Deploy keys）。
