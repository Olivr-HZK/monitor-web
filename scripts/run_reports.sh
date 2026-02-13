#!/usr/bin/env bash

set -euo pipefail

# 仓库根目录（本脚本位于 scripts/ 下）
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 若存在虚拟环境，则自动激活
if [ -d ".venv" ]; then
  # shellcheck disable=SC1091
  source ".venv/bin/activate"
fi

# 将所有参数原样传给 Python 脚本
python3 scripts/send_minigame_weekly_reports.py "$@"

