#!/usr/bin/env bash
# 供 npm run deploy / deploy:staging / deploy:api 使用。
# gh-pages 内部会执行 git clone，clone 阶段不会沿用本仓库的 core.sshCommand，
# 必须把 ssh 命令显式导出为 GIT_SSH_COMMAND，否则会 Permission denied (publickey)。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -z "${GIT_SSH_COMMAND:-}" ]]; then
  _sc=$(git config --get core.sshCommand || true)
  if [[ -n "${_sc:-}" ]]; then
    export GIT_SSH_COMMAND="$_sc"
  fi
fi

node scripts/strip-sensitive-from-dist.js
exec gh-pages -d dist "$@"
