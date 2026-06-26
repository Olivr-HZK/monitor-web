#!/usr/bin/env bash
#
# Idempotent hk4 deployment entrypoint for monitor-web.
#
# This script is designed to run on the target server. It only mutates files
# under APP_DIR by default. System service restarts happen only when
# DEPLOY_RESTART_SERVICE is set.

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/root/oliver/monitor-web}"
REPO_URL="${REPO_URL:-git@github.com:Olivr-HZK/monitor-web.git}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-staging}"
DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
DEPLOY_LOCK_DIR="${DEPLOY_LOCK_DIR:-$APP_DIR/logs/deploy.lock}"
DEPLOY_LOG_DIR="${DEPLOY_LOG_DIR:-$APP_DIR/logs/deploy}"
DEPLOY_INSTALL_PIPELINES="${DEPLOY_INSTALL_PIPELINES:-1}"
DEPLOY_RUN_TESTS="${DEPLOY_RUN_TESTS:-0}"
DEPLOY_SMOKE_API="${DEPLOY_SMOKE_API:-1}"
DEPLOY_SMOKE_HOST="${DEPLOY_SMOKE_HOST:-127.0.0.1}"
DEPLOY_SMOKE_PORT="${DEPLOY_SMOKE_PORT:-3001}"
DEPLOY_RESTART_SERVICE="${DEPLOY_RESTART_SERVICE:-}"
DEPLOY_PIP_CACHE_DIR="${DEPLOY_PIP_CACHE_DIR:-$APP_DIR/.cache/pip}"
DEPLOY_NPM_CACHE_DIR="${DEPLOY_NPM_CACHE_DIR:-$APP_DIR/.cache/npm}"
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$APP_DIR/.cache/ms-playwright}"
export PLAYWRIGHT_BROWSERS_PATH

mkdir -p "$APP_DIR" "$DEPLOY_LOG_DIR" "$DEPLOY_PIP_CACHE_DIR" "$DEPLOY_NPM_CACHE_DIR" "$PLAYWRIGHT_BROWSERS_PATH"

LOG_FILE="$DEPLOY_LOG_DIR/deploy_$(date +%Y%m%d_%H%M%S).log"
ln -sfn "$LOG_FILE" "$DEPLOY_LOG_DIR/latest.log"
exec > >(tee -a "$LOG_FILE") 2>&1

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

run() {
  log "+ $*"
  "$@"
}

if ! mkdir "$DEPLOY_LOCK_DIR" 2>/dev/null; then
  fail "another deploy appears to be running: $DEPLOY_LOCK_DIR"
fi

cleanup() {
  local code=$?
  set +e
  rmdir "$DEPLOY_LOCK_DIR" 2>/dev/null || true
  if [[ $code -eq 0 ]]; then
    git -C "$APP_DIR" rev-parse HEAD > "$DEPLOY_LOG_DIR/last_success" 2>/dev/null || true
    date '+%Y-%m-%d %H:%M:%S' > "$DEPLOY_LOG_DIR/last_success_at" 2>/dev/null || true
    log "deploy completed"
  else
    log "deploy failed with exit code $code"
  fi
  exit "$code"
}
trap cleanup EXIT

log "deploy starting"
log "APP_DIR=$APP_DIR"
log "REPO_URL=$REPO_URL"
log "DEPLOY_BRANCH=$DEPLOY_BRANCH"
log "DEPLOY_INSTALL_PIPELINES=$DEPLOY_INSTALL_PIPELINES"
log "DEPLOY_RUN_TESTS=$DEPLOY_RUN_TESTS"
log "DEPLOY_SMOKE_API=$DEPLOY_SMOKE_API"
log "DEPLOY_RESTART_SERVICE=${DEPLOY_RESTART_SERVICE:-<none>}"

command -v git >/dev/null 2>&1 || fail "git is required"
command -v npm >/dev/null 2>&1 || fail "npm is required"
command -v python3 >/dev/null 2>&1 || fail "python3 is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"

cd "$APP_DIR"

if [[ ! -d .git ]]; then
  log "initializing git repository in existing APP_DIR"
  run git init
  run git remote add "$DEPLOY_REMOTE" "$REPO_URL"
else
  if git remote get-url "$DEPLOY_REMOTE" >/dev/null 2>&1; then
    run git remote set-url "$DEPLOY_REMOTE" "$REPO_URL"
  else
    run git remote add "$DEPLOY_REMOTE" "$REPO_URL"
  fi
fi

run git fetch --prune "$DEPLOY_REMOTE" "$DEPLOY_BRANCH"
run git reset --hard "$DEPLOY_REMOTE/$DEPLOY_BRANCH"
run git submodule update --init --recursive

log "current revision: $(git rev-parse --short HEAD)"

run npm ci --cache "$DEPLOY_NPM_CACHE_DIR"
run npm run build

if [[ ! -x backend/.venv/bin/python ]]; then
  run python3 -m venv backend/.venv
fi
run backend/.venv/bin/pip install --cache-dir "$DEPLOY_PIP_CACHE_DIR" -U pip
run backend/.venv/bin/pip install --cache-dir "$DEPLOY_PIP_CACHE_DIR" -r backend/requirements.txt

if [[ "$DEPLOY_RUN_TESTS" == "1" ]]; then
  run backend/.venv/bin/pip install --cache-dir "$DEPLOY_PIP_CACHE_DIR" pytest
  (cd backend && run .venv/bin/python -m pytest -q)
fi

if [[ "$DEPLOY_INSTALL_PIPELINES" == "1" ]]; then
  if [[ ! -x pipelines/monitor-chain/competitor-social/.venv/bin/python ]]; then
    run python3 -m venv pipelines/monitor-chain/competitor-social/.venv
  fi
  run pipelines/monitor-chain/competitor-social/.venv/bin/pip install --cache-dir "$DEPLOY_PIP_CACHE_DIR" -U pip
  run pipelines/monitor-chain/competitor-social/.venv/bin/pip install --cache-dir "$DEPLOY_PIP_CACHE_DIR" -r pipelines/monitor-chain/competitor-social/requirements-runtime.txt

  if [[ ! -x pipelines/monitor-chain/wechat-douyin/.venv/bin/python ]]; then
    run python3 -m venv pipelines/monitor-chain/wechat-douyin/.venv
  fi
  run pipelines/monitor-chain/wechat-douyin/.venv/bin/pip install --cache-dir "$DEPLOY_PIP_CACHE_DIR" -U pip
  run pipelines/monitor-chain/wechat-douyin/.venv/bin/pip install --cache-dir "$DEPLOY_PIP_CACHE_DIR" -r pipelines/monitor-chain/wechat-douyin/requirements.txt
  run pipelines/monitor-chain/wechat-douyin/.venv/bin/python -m playwright install chromium

  if ! pipelines/monitor-chain/wechat-douyin/.venv/bin/python - <<'PY' >/dev/null 2>&1
import cv2  # noqa: F401
PY
  then
    log "cv2 import failed; switching this venv to opencv-python-headless"
    pipelines/monitor-chain/wechat-douyin/.venv/bin/pip uninstall -y opencv-python || true
    run pipelines/monitor-chain/wechat-douyin/.venv/bin/pip install --cache-dir "$DEPLOY_PIP_CACHE_DIR" "opencv-python-headless>=4.8.0"
  fi

  if [[ ! -x pipelines/monitor-chain/gaming-weekly/.venv/bin/python ]]; then
    run python3 -m venv pipelines/monitor-chain/gaming-weekly/.venv
  fi
  run pipelines/monitor-chain/gaming-weekly/.venv/bin/pip install --cache-dir "$DEPLOY_PIP_CACHE_DIR" -U pip
  run pipelines/monitor-chain/gaming-weekly/.venv/bin/pip install --cache-dir "$DEPLOY_PIP_CACHE_DIR" -r pipelines/monitor-chain/gaming-weekly/requirements.txt
  run pipelines/monitor-chain/gaming-weekly/.venv/bin/pip install --cache-dir "$DEPLOY_PIP_CACHE_DIR" -r pipelines/monitor-chain/gaming-weekly/TrendRadar/requirements.txt

  run npm --prefix pipelines/monitor-chain/sensortower ci --cache "$DEPLOY_NPM_CACHE_DIR"
fi

smoke_api() {
  local url="http://$DEPLOY_SMOKE_HOST:$DEPLOY_SMOKE_PORT/openapi.json"
  if curl -fsS "$url" >/dev/null 2>&1; then
    log "API smoke ok via existing listener: $url"
    return 0
  fi

  log "starting temporary API smoke process on $DEPLOY_SMOKE_HOST:$DEPLOY_SMOKE_PORT"
  local smoke_log="$DEPLOY_LOG_DIR/smoke_api.log"
  rm -f "$smoke_log"
  (
    cd "$APP_DIR/backend"
    exec ../backend/.venv/bin/python -m uvicorn main:app --host "$DEPLOY_SMOKE_HOST" --port "$DEPLOY_SMOKE_PORT"
  ) > "$smoke_log" 2>&1 &
  local pid=$!
  local ok=0
  for _ in $(seq 1 30); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 1
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true

  if [[ "$ok" != "1" ]]; then
    sed -n '1,120p' "$smoke_log" >&2 || true
    fail "API smoke failed: $url"
  fi
  log "API smoke ok via temporary listener: $url"
}

if [[ -n "$DEPLOY_RESTART_SERVICE" ]]; then
  run systemctl restart "$DEPLOY_RESTART_SERVICE"
  sleep 2
  if [[ "$DEPLOY_SMOKE_API" == "1" ]]; then
    smoke_api
  fi
elif [[ "$DEPLOY_SMOKE_API" == "1" ]]; then
  smoke_api
fi

log "revision deployed: $(git rev-parse HEAD)"
