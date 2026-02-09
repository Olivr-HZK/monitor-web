#!/usr/bin/env python3
"""
从远程地址下载最新的 sensortower_top100.db，并覆盖本地文件。

使用方式（在项目根目录）：
  1）在 .env 中配置下载地址（推荐）：
     - SENSORTOWER_DB_URL=https://example.com/sensortower_top100.db
  2）运行脚本：
     - python scripts/fetch_sensortower_db.py
     - 或指定参数：
       python scripts/fetch_sensortower_db.py --url <下载地址> --out public/sensortower_top100.db

可选：
  - --sha256  下载完成后校验文件哈希
  - --backup  下载前备份旧文件（生成 .bak-时间戳）

说明：
  - 使用标准库 urllib 进行下载
  - 使用 python-dotenv 读取 .env
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv


def sha256sum(path: Path) -> str:
    """计算文件 SHA256。"""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def download_to_file(url: str, dest: Path, timeout: int) -> None:
    """把 URL 内容流式下载到目标文件。"""
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status != 200:
            raise urllib.error.HTTPError(
                url, resp.status, f"HTTP status {resp.status}", resp.headers, None
            )
        with dest.open("wb") as f:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)


def main() -> None:
    parser = argparse.ArgumentParser(description="下载并更新 sensortower_top100.db")
    parser.add_argument(
        "--url",
        type=str,
        default="",
        help="数据库下载地址（默认读取 SENSORTOWER_DB_URL）",
    )
    parser.add_argument(
        "--out",
        type=str,
        default="public/sensortower_top100.db",
        help="输出数据库路径（相对仓库根目录）",
    )
    parser.add_argument(
        "--sha256",
        type=str,
        default="",
        help="期望的 SHA256（可选）",
    )
    parser.add_argument(
        "--backup",
        action="store_true",
        help="下载前备份旧文件（.bak-时间戳）",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="下载超时时间（秒）",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    env_path = repo_root / ".env"
    if env_path.exists():
        load_dotenv(env_path)

    url = args.url or os.environ.get("SENSORTOWER_DB_URL", "").strip()
    if not url:
        print("未提供下载地址，请设置 SENSORTOWER_DB_URL 或使用 --url", file=sys.stderr)
        sys.exit(1)

    out_path = (repo_root / args.out).resolve()
    out_dir = out_path.parent
    if not out_dir.exists():
        print(f"输出目录不存在：{out_dir}", file=sys.stderr)
        sys.exit(1)

    if args.backup and out_path.exists():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = out_path.with_suffix(out_path.suffix + f".bak-{ts}")
        out_path.replace(backup_path)
        print(f"已备份旧文件：{backup_path}")

    with tempfile.NamedTemporaryFile(
        prefix="sensortower_db_", suffix=".tmp", dir=str(out_dir), delete=False
    ) as tmp:
        tmp_path = Path(tmp.name)

    try:
        download_to_file(url, tmp_path, args.timeout)
        if tmp_path.stat().st_size == 0:
            raise RuntimeError("下载文件为空，已中止替换")

        if args.sha256:
            actual = sha256sum(tmp_path)
            expected = args.sha256.lower()
            if actual.lower() != expected:
                raise RuntimeError(f"SHA256 校验失败：expected={expected}, actual={actual}")

        tmp_path.replace(out_path)
        print(f"下载成功：{out_path}")
    except Exception as e:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        print(f"下载失败：{e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
