# 每周自动工作流快速设置

## 🚀 一键设置

```bash
# 在 monitor-web 仓库根目录安装统一定时任务
bash scripts/cron/install_unified_cron.sh
```

## 📋 设置后的效果

- ✅ 每周一 **7:30**：SensorTower Top100 周报源数据爬取
- ✅ 每天 **8:30**：我方产品 US 免费榜日报源数据爬取
- ✅ 每天 **8:00**：Arrow2 竞品日报源数据爬取
- ✅ 所有任务通过 `monitor-web/scripts/cron/run_job.sh` 统一进入，日志写入 `logs/jobs/`

## 🔍 查看日志

```bash
# 查看最新的执行日志
tail -f logs/weekly_workflow.log

# 查看今天的详细日志
cat logs/weekly_workflow_$(date +%Y-%m-%d).log
```

## 🧪 手动测试

```bash
# 手动运行一次（测试）
npm run weekly-automated

# 或直接运行
node scripts/weekly_automated_workflow.js
```

## 📚 详细文档

- [三条工作流说明](docs/THREE_WORKFLOWS.md)（周 Top100 / 日我方 / 日竞品）
- [自动化与定时任务](docs/AUTOMATED_WORKFLOW.md)
