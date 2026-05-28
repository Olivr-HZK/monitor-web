#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from validate_monitor_chain_sources import (
    target_week,
    parse_report_date,
    validate_competitor,
    validate_our_product,
    validate_sensortower,
    validate_wechat_douyin,
)


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_API_BASE = "https://api.gurublog.uk"
DB_NAMES = (
    "sensortower_top100.db",
    "competitor_data.db",
    "wechatdouyin.db",
    "us_free_appid_weekly.db",
)


def _strip_env_value(raw: str) -> str:
    value = raw.strip().strip("\r")
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        value = value[1:-1]
    return value


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = _strip_env_value(value)


def load_default_envs() -> None:
    # Earlier files win only when the variable was not already set by the caller.
    load_env_file(REPO_ROOT / ".env")
    load_env_file(REPO_ROOT / "backend" / ".env")
    load_env_file(REPO_ROOT / ".env.production")


def resolve_api_base(raw: str | None) -> str:
    base = raw or os.environ.get("MONITOR_API_BASE_URL") or os.environ.get("VITE_API_BASE_URL") or DEFAULT_API_BASE
    return base.strip().rstrip("/")


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def create_token(username: str, secret: str, ttl_sec: int) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"username": username, "exp": int(time.time()) + ttl_sec}
    signing_input = ".".join(
        (
            b64url(json.dumps(header, separators=(",", ":")).encode("utf-8")),
            b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
        )
    ).encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return signing_input.decode("ascii") + "." + b64url(signature)


def resolve_token(ttl_sec: int) -> str:
    explicit = os.environ.get("MONITOR_API_TOKEN")
    if explicit:
        return explicit.strip()
    secret = os.environ.get("JWT_SECRET", "").strip()
    username = os.environ.get("LOGIN_USERNAME", "admin").strip() or "admin"
    if not secret:
        raise SystemExit("[错误] 未找到 JWT_SECRET；请配置 backend/.env，或设置 MONITOR_API_TOKEN")
    return create_token(username=username, secret=secret, ttl_sec=ttl_sec)


def download_db(api_base: str, db_name: str, dest: Path, token: str, timeout: int) -> int:
    url = f"{api_base}/api/data/{urllib.parse.quote(db_name)}"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/octet-stream",
            "User-Agent": "monitor-web-chain-check/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response, dest.open("wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
    except urllib.error.HTTPError as exc:
        body = exc.read(300).decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {exc.code} {exc.reason}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"请求失败: {exc.reason}") from exc

    size = dest.stat().st_size
    if size < 1024:
        raise RuntimeError(f"下载体过小，疑似非 DB 响应：{size} bytes")
    return size


def quick_check(db_path: Path) -> str:
    uri = f"file:{db_path}?mode=ro"
    with sqlite3.connect(uri, uri=True) as conn:
        row = conn.execute("PRAGMA quick_check").fetchone()
    return str(row[0]) if row else ""


def validate_remote_business(downloaded: dict[str, Path], report_date_iso: str) -> tuple[list[str], list[str]]:
    report_dt = parse_report_date(report_date_iso)
    _, week_end, week_range = target_week(report_dt)
    errors: list[str] = []
    summary: list[str] = []

    validate_sensortower(downloaded["sensortower_top100.db"], report_date_iso, errors, summary)
    validate_competitor(downloaded["competitor_data.db"], week_end, errors, summary)
    validate_wechat_douyin(downloaded["wechatdouyin.db"], week_range, errors, summary)
    validate_our_product(downloaded["us_free_appid_weekly.db"], week_end, errors, summary)
    return errors, summary


def main() -> int:
    load_default_envs()
    parser = argparse.ArgumentParser(description="检查生产 API /api/data/*.db 是否能读取并返回有效 SQLite 快照")
    parser.add_argument("--api-base", default=None, help="默认读取 MONITOR_API_BASE_URL / VITE_API_BASE_URL")
    parser.add_argument("--report-date", required=True, metavar="YYYY-MM-DD")
    parser.add_argument("--timeout", type=int, default=int(os.environ.get("MONITOR_API_DATA_TIMEOUT", "60")))
    parser.add_argument("--token-ttl-sec", type=int, default=900)
    parser.add_argument(
        "--skip-business-check",
        action="store_true",
        help="只做下载和 SQLite quick_check，不检查本周业务数据",
    )
    args = parser.parse_args()

    api_base = resolve_api_base(args.api_base)
    token = resolve_token(ttl_sec=args.token_ttl_sec)
    downloaded: dict[str, Path] = {}

    print(f"[检查] API data base={api_base}")
    with tempfile.TemporaryDirectory(prefix="monitor_api_data_") as tmp_raw:
        tmp_dir = Path(tmp_raw)
        for db_name in DB_NAMES:
            dest = tmp_dir / db_name
            try:
                size = download_db(api_base, db_name, dest, token, timeout=args.timeout)
                result = quick_check(dest)
            except Exception as exc:  # noqa: BLE001 - operator-facing check script.
                print(f"[失败] /api/data/{db_name}: {exc}", file=sys.stderr)
                return 1
            if result != "ok":
                print(f"[失败] /api/data/{db_name}: SQLite quick_check={result!r}", file=sys.stderr)
                return 1
            downloaded[db_name] = dest
            print(f"[通过] /api/data/{db_name}: 下载 {size} bytes，SQLite quick_check=ok")

        if not args.skip_business_check:
            errors, summary = validate_remote_business(downloaded, args.report_date)
            if errors:
                for err in errors:
                    print(f"[失败] 远端业务校验: {err}", file=sys.stderr)
                return 1
            for line in summary:
                print(f"[通过] 远端业务校验: {line}")

    print("[通过] 远端 /api/data 四库快照读取与完整性校验完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
