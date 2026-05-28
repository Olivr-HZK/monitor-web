#!/usr/bin/env python3
"""Mirror upstream SQLite databases into monitor-web/data/databases.

The mirror uses SQLite's backup API instead of a raw copy so WAL-mode databases
can be snapshotted while upstream jobs are writing.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE_ROOT = Path(os.environ.get("MONITOR_SOURCE_ROOT", REPO_ROOT.parent)).expanduser().resolve()
DEFAULT_DEST_DIR = Path(os.environ.get("MONITOR_LOCAL_DB_DIR", REPO_ROOT / "data" / "databases")).expanduser().resolve()


@dataclass(frozen=True)
class MirrorJob:
    name: str
    source: Path
    dest_name: str

    @property
    def dest(self) -> Path:
        return DEFAULT_DEST_DIR / self.dest_name


def env_path(name: str, fallback: Path) -> Path:
    return Path(os.environ.get(name, fallback)).expanduser().resolve()


def default_source(env_name: str, dest_name: str, fallback: Path, *, prefer_local: bool = False) -> Path:
    if os.environ.get(env_name):
        return Path(os.environ[env_name]).expanduser().resolve()
    local = DEFAULT_DEST_DIR / dest_name
    if prefer_local and local.exists():
        return local.resolve()
    return fallback.expanduser().resolve()


def default_jobs(source_root: Path) -> list[MirrorJob]:
    return [
        MirrorJob(
            "sensortower",
            default_source(
                "MONITOR_DB_SENSORTOWER_SOURCE",
                "sensortower_top100.db",
                source_root / "sensortower-" / "data" / "sensortower_top100.db",
                prefer_local=True,
            ),
            "sensortower_top100.db",
        ),
        MirrorJob(
            "competitor",
            default_source(
                "MONITOR_DB_COMPETITOR_SOURCE",
                "competitor_data.db",
                source_root / "Olivr-competitor-monitor" / "db" / "competitor_data.db",
                prefer_local=True,
            ),
            "competitor_data.db",
        ),
        MirrorJob(
            "wechatdouyin",
            default_source(
                "MONITOR_DB_WECHATDOUYIN_SOURCE",
                "wechatdouyin.db",
                source_root / "wechat-mini-game-ranking-post" / "data" / "wechatdouyin.db",
                prefer_local=True,
            ),
            "wechatdouyin.db",
        ),
        MirrorJob(
            "us_free",
            default_source(
                "MONITOR_DB_US_FREE_SOURCE",
                "us_free_appid_weekly.db",
                source_root / "sensortower-" / "data" / "us_free_appid_weekly.db",
                prefer_local=True,
            ),
            "us_free_appid_weekly.db",
        ),
    ]


def sqlite_quick_check(path: Path) -> str:
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
        row = conn.execute("PRAGMA quick_check").fetchone()
    return str(row[0] if row else "")


def mirror_sqlite(job: MirrorJob, dest_dir: Path) -> None:
    source = job.source.expanduser().resolve()
    dest = dest_dir / job.dest_name
    tmp = dest.with_name(dest.name + ".tmp")
    tmp_sidecars = [Path(str(tmp) + "-wal"), Path(str(tmp) + "-shm")]

    if not source.exists():
        raise FileNotFoundError(f"{job.name}: source not found: {source}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if tmp.exists():
        tmp.unlink()
    for sidecar in tmp_sidecars:
        sidecar.unlink(missing_ok=True)

    with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as src:
        result = src.execute("PRAGMA quick_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError(f"{job.name}: source quick_check failed: {result!r}")
        with sqlite3.connect(str(tmp)) as dst:
            dst.execute("PRAGMA journal_mode=DELETE")
            src.backup(dst)
            dst.execute("PRAGMA optimize")

    mirrored_check = sqlite_quick_check(tmp)
    if mirrored_check != "ok":
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"{job.name}: mirrored quick_check failed: {mirrored_check!r}")

    tmp.replace(dest)
    for sidecar in tmp_sidecars:
        sidecar.unlink(missing_ok=True)
    print(f"[mirror] {job.name}: {source} -> {dest} ({dest.stat().st_size} bytes)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mirror upstream monitor SQLite databases into this repo.")
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--dest-dir", type=Path, default=DEFAULT_DEST_DIR)
    parser.add_argument("--only", action="append", choices=["sensortower", "competitor", "wechatdouyin", "us_free"])
    parser.add_argument("--sensortower", type=Path)
    parser.add_argument("--competitor", type=Path)
    parser.add_argument("--wechatdouyin", type=Path)
    parser.add_argument("--us-free", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    dest_dir = args.dest_dir.expanduser().resolve()
    jobs = {job.name: job for job in default_jobs(args.source_root.expanduser().resolve())}

    overrides = {
        "sensortower": args.sensortower,
        "competitor": args.competitor,
        "wechatdouyin": args.wechatdouyin,
        "us_free": args.us_free,
    }
    for name, source in overrides.items():
        if source:
            existing = jobs[name]
            jobs[name] = MirrorJob(name, source.expanduser().resolve(), existing.dest_name)

    selected = args.only or list(jobs)
    failures = []
    for name in selected:
        try:
            mirror_sqlite(jobs[name], dest_dir)
        except Exception as exc:  # noqa: BLE001 - report all mirror failures together.
            failures.append(f"{name}: {exc}")

    if failures:
        print("[mirror] failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
