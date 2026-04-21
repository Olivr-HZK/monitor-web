#!/usr/bin/env bash
#
# 备份 monitor-web/public 下所有 .db（在上游 cp 覆盖之前执行）。
# 快照目录：<仓库>/backups/public_dbs/YYYYMMDD_HHMMSS/
#
# 与本机常见定时关系（按你当前 crontab / launchd，请以实际为准）：
#   - 每周一 07:30  LaunchAgent：wechat-mini-game 周报入库结束后会复制 wechatdouyin.db
#   - 每周一 07:40  cron：Olivr 竞品周报成功后复制 competitor_data.db
#   - 每天 10:00     cron：sensortower- 日更写本机 data/sensortower_top100.db（若另有同步到
#     public 的任务，请把备份排在那之前）
#   - 每周一 10:30   cron：sensortower 周工作流
#   - 每周一 11:30  左右：可跑 sync_dbs_and_deploy.sh（脚本内已会先调本备份）
#
# 建议在 crontab 增加（早于当日第一次会覆盖 public 库的操作）：
#   # 周一 07:22 全量备份（早于 07:30 / 07:40）
#   22 7 * * 1 /bin/bash -c 'cd /Users/ggbond/lyb/monitor-web && ./scripts/backup_public_dbs.sh >> logs/backup_public_dbs.log 2>&1'
#   # 若某流程只在每天 10:00 后把 ST 库同步进 public，可再加（示例仅备份 ST）：
#   # 55 9 * * * /bin/bash -c 'cd /Users/ggbond/lyb/monitor-web && ./scripts/backup_public_dbs.sh --only sensortower_top100.db >> logs/backup_public_dbs.log 2>&1'
#
# 用法：
#   ./scripts/backup_public_dbs.sh
#   ./scripts/backup_public_dbs.sh --only sensortower_top100.db
# 环境变量：
#   BACKUP_ROOT  备份根目录，默认 <仓库>/backups/public_dbs
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_DIR="$REPO_ROOT/public"
BACKUP_ROOT="${BACKUP_ROOT:-$REPO_ROOT/backups/public_dbs}"
ONLY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --only)
      ONLY="${2:-}"
      shift 2
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 1
      ;;
  esac
done

TS="$(date +%Y%m%d_%H%M%S)"
DEST="$BACKUP_ROOT/$TS"
mkdir -p "$DEST"

n=0
shopt -s nullglob
for f in "$PUBLIC_DIR"/*.db; do
  base="$(basename "$f")"
  if [[ -n "$ONLY" && "$base" != "$ONLY" ]]; then
    continue
  fi
  cp -p "$f" "$DEST/$base"
  n=$((n + 1))
done
shopt -u nullglob

if [[ "$n" -eq 0 ]]; then
  echo "[backup_public_dbs] 未复制任何文件（public 下无匹配的 .db） DEST=$DEST" >&2
  rmdir "$DEST" 2>/dev/null || true
  exit 0
fi

echo "[backup_public_dbs] 已备份 ${n} 个文件 -> $DEST"
