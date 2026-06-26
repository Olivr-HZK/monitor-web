#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
PYTHON_BIN="$VENV_DIR/bin/python3"
PIP_BIN="$VENV_DIR/bin/pip"
BOOTSTRAP_LOCK="$SCRIPT_DIR/.runtime/ensure_python_env.lock"

base_python() {
  if [ -n "${PYTHON:-}" ] && command -v "$PYTHON" >/dev/null 2>&1; then
    command -v "$PYTHON"
    return 0
  fi
  command -v python3
}

deps_ok() {
  "$PYTHON_BIN" - <<'PY' >/dev/null 2>&1
import feedparser
import litellm
import pytz
import requests
import yaml
PY
}

install_deps() {
  "$PIP_BIN" install \
    -r "$SCRIPT_DIR/requirements.txt" \
    -r "$SCRIPT_DIR/TrendRadar/requirements.txt"
}

mkdir -p "$SCRIPT_DIR/.runtime"

if [ ! -x "$PYTHON_BIN" ]; then
  "$(base_python)" -m venv "$VENV_DIR"
fi

if ! deps_ok; then
  if mkdir "$BOOTSTRAP_LOCK" 2>/dev/null; then
    trap 'rmdir "$BOOTSTRAP_LOCK" 2>/dev/null || true' EXIT
    "$PYTHON_BIN" -m pip install --upgrade pip setuptools wheel
    install_deps
  else
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
      sleep 5
      deps_ok && break
    done
    deps_ok
  fi
fi

printf '%s\n' "$PYTHON_BIN"
