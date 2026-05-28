#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PATH="${1:-$ROOT/data/sensortower_top100.db}"
BACKUP_DIR="${SENSORTOWER_DB_BACKUP_DIR:-$ROOT/backups/db}"
RETENTION_DAYS="${SENSORTOWER_DB_BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DB_PATH" ]]; then
  echo "[backup_sqlite_db] 数据库不存在：$DB_PATH" >&2
  exit 1
fi

base="$(basename "$DB_PATH")"
stamp="$(date +%Y%m%d_%H%M%S)"
tmp="$BACKUP_DIR/${base}.${stamp}.tmp"
out="$BACKUP_DIR/${base}.${stamp}.db"

rm -f "$tmp" "$tmp-shm" "$tmp-wal"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".timeout 10000" ".backup '$tmp'"
  integrity="$(sqlite3 "$tmp" "PRAGMA integrity_check;" | head -n 1 | tr -d '\r')"
  if [[ "$integrity" != "ok" ]]; then
    rm -f "$tmp" "$tmp-shm" "$tmp-wal"
    echo "[backup_sqlite_db] integrity_check=$integrity" >&2
    exit 1
  fi
  mv -f "$tmp" "$out"
  rm -f "$tmp-shm" "$tmp-wal"
else
  cp -f "$DB_PATH" "$out"
fi

if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  find "$BACKUP_DIR" -type f -name "${base}.*.db" -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
fi

echo "[backup_sqlite_db] 已备份：$out"
