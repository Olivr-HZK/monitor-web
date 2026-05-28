#!/usr/bin/env bash
#
# monitor-web 定时链路专用检查入口：
# 只做源库等待、业务完整性校验、本机 API 产物生成、生产 API /api/data 快照校验；
# 不 deploy、不推送。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

export SYNC_CHECK_ONLY=1
export SYNC_SKIP_DEPLOY=1
export SYNC_SKIP_PUSH=1

exec "$SCRIPT_DIR/sync_dbs_and_deploy.sh" "$@"
