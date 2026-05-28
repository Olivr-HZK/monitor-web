"""
将每周「人气榜 / 畅销榜 / 畅玩榜」目录下的 CSV 导入到数据库两张表：
- full 榜 -> top20_ranking
- 异动榜 -> rank_changes

与 scrape_weekly_popularity 输出一致：三个子目录同名周区间下各有 wx_full.csv、dy_full.csv 等。
入库时 **platform_key** 为 wx / dy，**chart_key** 为 popularity / bestseller / casual_play / new_games（两列独立）。
微信第三榜用 **casual_play**（畅玩），抖音第三榜用 **new_games**（新游，与畅玩区分）。
同一周下按 (platform_key, chart_key) 区分榜单，先删后插。

抖音侧 CSV「榜单」列已由爬虫写为热门榜/新游榜等产品名；此处不再改列，仅按文件来源区分 key。

CSV 的 11 列与表字段一一对应：排名,游戏名称,游戏类型,平台,来源,榜单,监控日期,发布时间,开发公司,排名变化,地区

用法（项目根目录）：
  python scripts/tools/import_ranking_csv_to_tables.py
  python scripts/tools/import_ranking_csv_to_tables.py "data/人气榜/2026-02-02~2026-02-08"
  python scripts/tools/import_ranking_csv_to_tables.py --week-dir "data/人气榜/2026-02-02~2026-02-08"
  python scripts/tools/import_ranking_csv_to_tables.py --week-dir "data/人气榜/2026-02-02~2026-02-08" --only 人气榜
  python scripts/tools/import_ranking_csv_to_tables.py --only-platform wx
  python scripts/tools/import_ranking_csv_to_tables.py --db data/wechatdouyin_test.db
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import config
from modules.database import VideoDatabase


DATA_ROOT = Path(
    os.environ.get("WECHAT_DOUYIN_DATA_DIR", PROJECT_ROOT / "data")
).expanduser()
if not DATA_ROOT.is_absolute():
    DATA_ROOT = PROJECT_ROOT / DATA_ROOT

# 子目录名 -> 每平台 chart_key（畅玩目录下：微信=畅玩 casual_play，抖音=新游 new_games）
CHART_FOLDERS: list[tuple[str, str | dict[str, str]]] = [
    ("人气榜", "popularity"),
    ("畅销榜", "bestseller"),
    ("畅玩榜", {"wx": "casual_play", "dy": "new_games"}),
]


def _chart_key_for_row(folder_chart: str | dict[str, str], pref: str) -> str:
    if isinstance(folder_chart, dict):
        return folder_chart[pref]
    return folder_chart


def read_csv_as_dicts(csv_path: Path) -> list[dict]:
    """读取 CSV 为 list[dict]，key 为表头。尝试多种编码。"""
    encodings = ["utf-8-sig", "utf-8", "gbk", "gb2312"]
    for enc in encodings:
        try:
            with csv_path.open("r", encoding=enc, newline="") as f:
                reader = csv.DictReader(f)
                return list(reader)
        except Exception:
            continue
    raise RuntimeError(f"无法读取 CSV：{csv_path}")


def _latest_week_range_under(base: Path) -> str | None:
    """在 base 下找含 ~ 的子目录名，按修改时间取最新。"""
    if not base.is_dir():
        return None
    dirs = [d for d in base.iterdir() if d.is_dir() and "~" in d.name]
    if not dirs:
        return None
    return max(dirs, key=lambda d: d.stat().st_mtime).name


def main() -> int:
    parser = argparse.ArgumentParser(
        description="将每周人气/畅销/畅玩三目录下的 full/异动 CSV 导入 top20_ranking 与 rank_changes"
    )
    parser.add_argument(
        "week_dir",
        nargs="?",
        default=None,
        help="任一周目录（通常传人气榜路径），如 data/人气榜/2026-02-02~2026-02-08；不传则自动选最新一周",
    )
    parser.add_argument("--week-dir", dest="week_dir_flag", help="同 week_dir 位置参数")
    parser.add_argument(
        "--only",
        dest="only_folders",
        action="append",
        choices=["人气榜", "畅销榜", "畅玩榜"],
        metavar="DIR",
        help="只导入这些子目录（可多次写 --only）；默认三个都导入",
    )
    parser.add_argument(
        "--db",
        default=None,
        metavar="PATH",
        help="SQLite 库路径（默认 data/wechatdouyin.db，相对项目根）",
    )
    parser.add_argument(
        "--only-platform",
        choices=["wx", "dy", "all"],
        default="all",
        help="只导入对应平台 CSV（wx/dy）；默认 all。仅爬微信时建议 wx，避免导入人气榜目录里旧的 dy 文件",
    )
    args = parser.parse_args()
    week_dir = args.week_dir_flag or args.week_dir

    if not week_dir:
        base = Path(config.RANKINGS_CSV_PATH)
        if not base.is_dir():
            base = DATA_ROOT / "人气榜"
        if not base.exists():
            print(f"未找到人气榜目录：{base}")
            return 1
        week_range = _latest_week_range_under(base)
        if not week_range:
            print(f"未找到任何周目录（含 ~）：{base}")
            return 1
        print(f"[*] 自动选择周区间：{week_range}")
    else:
        week_path_arg = Path(week_dir)
        if not week_path_arg.is_absolute():
            week_path_arg = PROJECT_ROOT / week_path_arg
        if not week_path_arg.is_dir():
            print(f"目录不存在：{week_path_arg}")
            return 1
        week_range = week_path_arg.name

    db_path_arg = args.db
    if db_path_arg:
        p = Path(db_path_arg)
        db_resolved = str(p if p.is_absolute() else PROJECT_ROOT / p)
    else:
        db_resolved = None
    db = VideoDatabase(db_path=db_resolved)
    if db_resolved:
        print(f"[*] 数据库文件: {db_resolved}")

    chart_folders = CHART_FOLDERS
    if args.only_folders:
        allow = set(args.only_folders)
        chart_folders = [x for x in CHART_FOLDERS if x[0] in allow]
        if not chart_folders:
            print("[错误] --only 未匹配任何子目录")
            return 1

    full_pairs = [("wx", "wx_full.csv"), ("dy", "dy_full.csv")]
    anom_pairs = [("wx", "wx_anomalies.csv"), ("dy", "dy_anomalies.csv")]
    if args.only_platform == "wx":
        full_pairs = [full_pairs[0]]
        anom_pairs = [anom_pairs[0]]
    elif args.only_platform == "dy":
        full_pairs = [full_pairs[1]]
        anom_pairs = [anom_pairs[1]]

    for folder_cn, folder_chart in chart_folders:
        week_path = DATA_ROOT / folder_cn / week_range
        if not week_path.is_dir():
            print(f"[跳过] 无目录：{week_path}")
            continue

        for pref, filename in full_pairs:
            fp = week_path / filename
            if not fp.exists():
                print(f"[跳过] 不存在：{fp}")
                continue
            chart_key = _chart_key_for_row(folder_chart, pref)
            rows = read_csv_as_dicts(fp)
            n = db.insert_top20_ranking(week_range, pref, chart_key, rows)
            print(f"[top20_ranking] {folder_cn}/{filename} -> platform_key={pref} chart_key={chart_key} {n} 行")

        for pref, filename in anom_pairs:
            fp = week_path / filename
            if not fp.exists():
                print(f"[跳过] 不存在：{fp}")
                continue
            chart_key = _chart_key_for_row(folder_chart, pref)
            rows = read_csv_as_dicts(fp)
            n = db.insert_rank_changes(week_range, pref, chart_key, rows)
            print(f"[rank_changes] {folder_cn}/{filename} -> platform_key={pref} chart_key={chart_key} {n} 行")

    print(f"完成：{week_range}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
