#!/bin/bash

# ═══════════════════════════════════════════════════════════════
#                    游戏行业资讯日报启动脚本
#                    专注出海 Puzzle Game 厂商
# ═══════════════════════════════════════════════════════════════

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$SCRIPT_DIR"

if [ -f "$REPO_ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$REPO_ROOT/.env"
    set +a
fi

if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$SCRIPT_DIR/.env"
    set +a
fi

RUNTIME_DIR="$SCRIPT_DIR/.runtime"
STATE_DIR="$RUNTIME_DIR/cron_state"
STAGE="gaming-daily"

timestamp_shanghai() {
    TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S'
}

today_shanghai() {
    if [ -n "${GAMING_DAILY_DATE_OVERRIDE:-}" ]; then
        printf '%s\n' "$GAMING_DAILY_DATE_OVERRIDE"
        return 0
    fi
    TZ=Asia/Shanghai date '+%F'
}

LOG_FILE="$RUNTIME_DIR/gaming_daily_$(today_shanghai).log"

state_file() {
    printf '%s/%s.%s.%s\n' "$STATE_DIR" "$(today_shanghai)" "$STAGE" "$1"
}

append_once_log() {
    local key="$1"
    shift
    local marker
    mkdir -p "$STATE_DIR" "$RUNTIME_DIR"
    marker="$(state_file "notice.$key")"
    if [ -f "$marker" ]; then
        return 0
    fi
    printf '%s\n' "$(timestamp_shanghai)" > "$marker"
    printf '[%s] %s\n' "$(timestamp_shanghai)" "$*" >> "$LOG_FILE"
}

mark_ok() {
    mkdir -p "$STATE_DIR"
    printf '%s\n' "$(timestamp_shanghai)" > "$(state_file ok)"
}

mark_failed() {
    mkdir -p "$STATE_DIR"
    printf '%s\n' "$(timestamp_shanghai)" > "$(state_file failed)"
}

fail_once() {
    local message="$1"
    mark_failed
    append_once_log "terminal_failed" "$message"
    echo -e "${RED}${message}${NC}"
    exit 1
}

mkdir -p "$STATE_DIR" "$RUNTIME_DIR"
if [ -f "$(state_file ok)" ]; then
    append_once_log "already_ok" "Gaming daily already completed for $(today_shanghai); skipping."
    exit 0
fi
if [ -f "$(state_file failed)" ]; then
    append_once_log "already_failed" "Gaming daily already marked failed for $(today_shanghai); skipping."
    exit 0
fi

# 优先使用项目内 venv；缺失或依赖不完整时自动修复，避免 cron 环境漂移。
PYTHON_BIN="$("$SCRIPT_DIR/ensure_python_env.sh")"
# 本仓库 TrendRadar 以源码形式放在 ./TrendRadar，需加入 PYTHONPATH（与 pip 安装的 .pth 解耦）
export PYTHONPATH="$SCRIPT_DIR/TrendRadar${PYTHONPATH:+:$PYTHONPATH}"
if [ -n "${GAMING_DAILY_DATE_OVERRIDE:-}" ] && [ -z "${TRENDRADAR_DATE_OVERRIDE:-}" ]; then
    export TRENDRADAR_DATE_OVERRIDE="$GAMING_DAILY_DATE_OVERRIDE"
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}              游戏行业资讯日报 - TrendRadar Gaming${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# 检查 Python 环境
if ! "$PYTHON_BIN" --version &> /dev/null; then
    fail_once "错误: 无法执行 $PYTHON_BIN，请在项目根目录创建 .venv 或安装 Python 3.8+"
fi

echo -e "${GREEN}✓ Python: $("$PYTHON_BIN" --version 2>&1) ($PYTHON_BIN)${NC}"

# 检查依赖
if [ ! -f "requirements.txt" ]; then
    fail_once "错误: 未找到 requirements.txt"
fi

# 检查配置文件
if [ ! -f "config/config_gaming.yaml" ]; then
    fail_once "错误: 未找到游戏行业配置文件 config/config_gaming.yaml"
fi

if [ ! -f "config/frequency_words_gaming_strict.txt" ]; then
    fail_once "错误: 未找到游戏行业关键词配置 config/frequency_words_gaming_strict.txt"
fi

echo -e "${GREEN}✓ 配置文件检查通过${NC}"

# 检查环境变量
if [ -z "$AI_API_KEY" ] && [ -z "$DASHSCOPE_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  警告: 未设置 AI_API_KEY 或 DASHSCOPE_API_KEY 环境变量${NC}"
    echo -e "${YELLOW}   AI 分析功能将无法使用${NC}"
    echo -e "${YELLOW}   请设置环境变量: export AI_API_KEY=your_api_key${NC}"
    echo ""
fi

# 备份原配置文件
if [ -f "config/config.yaml" ]; then
    cp config/config.yaml config/config.yaml.backup
    echo -e "${GREEN}✓ 已备份原配置文件到 config/config.yaml.backup${NC}"
fi

if [ -f "config/frequency_words.txt" ]; then
    cp config/frequency_words.txt config/frequency_words.txt.backup
    echo -e "${GREEN}✓ 已备份原关键词配置到 config/frequency_words.txt.backup${NC}"
fi

# 使用游戏行业配置
cp config/config_gaming.yaml config/config.yaml
cp config/frequency_words_gaming_strict.txt config/frequency_words.txt
# TrendRadar 的 schedule.preset 依赖 config/timeline.yaml
# 本脚本在项目根目录运行，所以需要把 timeline 同步到根目录 config/ 下
if [ -f "TrendRadar/config/timeline.yaml" ]; then
    cp TrendRadar/config/timeline.yaml config/timeline.yaml
fi
echo -e "${GREEN}✓ 已切换到游戏行业配置${NC}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}                    开始运行游戏行业资讯日报${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 运行 TrendRadar
set +e
"$PYTHON_BIN" -m trendradar
RUN_RC=$?
set -e

# 恢复原配置文件
if [ -f "config/config.yaml.backup" ]; then
    mv config/config.yaml.backup config/config.yaml
    echo -e "${GREEN}✓ 已恢复原配置文件${NC}"
fi

if [ -f "config/frequency_words.txt.backup" ]; then
    mv config/frequency_words.txt.backup config/frequency_words.txt
    echo -e "${GREEN}✓ 已恢复原关键词配置${NC}"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                    游戏行业资讯日报运行完成${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"

if [ "$RUN_RC" -eq 0 ]; then
    mark_ok
else
    mark_failed
    append_once_log "terminal_failed" "ERROR: Gaming daily failed with exit code $RUN_RC."
fi

exit "$RUN_RC"
