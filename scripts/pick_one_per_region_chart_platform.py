#!/usr/bin/env python3
"""
从 sensortower_top100.db 的 rank_changes 表中，取「最近一周」异动数据，
在每个 (地区, 榜单, 平台) 组合下各取一条游戏（取当前排名最高的一条，即 current_rank 最小）。

输出：打印表格到 stdout，可选输出 CSV。

使用方式（在项目根目录）：
  python scripts/pick_one_per_region_chart_platform.py
  python scripts/pick_one_per_region_chart_platform.py --db public/sensortower_top100.db
  python scripts/pick_one_per_region_chart_platform.py --csv out.csv
"""

import argparse
import csv
import sqlite3
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description="最近一周异动榜单：每个地区每个榜单每个平台取一条游戏（排名最高的一条）"
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=Path("public/sensortower_top100.db"),
        help="sensortower_top100.db 路径",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="若指定则同时输出到该 CSV 文件",
    )
    args = parser.parse_args()

    if not args.db.exists():
        print(f"错误：数据库不存在 {args.db}")
        return 1

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 最近一周的日期
    cur.execute("SELECT MAX(rank_date_current) AS dt FROM rank_changes")
    row = cur.fetchone()
    if not row or not row["dt"]:
        print("未找到任何异动数据（rank_changes 为空）")
        conn.close()
        return 0

    latest_week = row["dt"]
    print(f"最近一周榜单日期：{latest_week}\n")

    # 每个 (country, signal, platform) 取 current_rank 最小的一条，并关联 app_metadata 取显示名
    cur.execute(
        """
        WITH latest AS (
            SELECT * FROM rank_changes WHERE rank_date_current = ?
        ),
        ranked AS (
            SELECT
                l.*,
                ROW_NUMBER() OVER (
                    PARTITION BY l.country, l.signal, l.platform
                    ORDER BY l.current_rank ASC
                ) AS rn
            FROM latest l
        )
        SELECT
            r.country,
            r.signal,
            r.platform,
            r.current_rank,
            r.last_week_rank,
            r.change,
            r.change_type,
            r.app_id,
            COALESCE(m.name, r.app_name, r.app_id) AS display_name,
            r.downloads,
            r.revenue
        FROM ranked r
        LEFT JOIN app_metadata m ON m.app_id = r.app_id AND m.os = LOWER(r.platform)
        WHERE r.rn = 1
        ORDER BY r.country, r.signal, r.platform
        """,
        (latest_week,),
    )
    rows = cur.fetchall()
    conn.close()

    if not rows:
        print("该周没有任何异动记录。")
        return 0

    # 表头
    headers = ["地区", "榜单", "平台", "当前排名", "上周排名", "变化", "异动类型", "App ID", "游戏名", "下载量", "收入"]
    col_keys = ["country", "signal", "platform", "current_rank", "last_week_rank", "change", "change_type", "app_id", "display_name", "downloads", "revenue"]

    # 打印表格
    col_widths = [max(len(str(h)), 4) for h in headers]
    for r in rows:
        for i, k in enumerate(col_keys):
            val = r[k]
            if val is None:
                val = ""
            col_widths[i] = max(col_widths[i], len(str(val)))

    def sep():
        return "+" + "+".join("-" * (w + 2) for w in col_widths) + "+"

    def line(vals):
        return "|" + "|".join(f" {str(v):<{col_widths[i]}} " for i, v in enumerate(vals)) + "|"

    print(sep())
    print(line(headers))
    print(sep())
    for r in rows:
        print(line([r[k] for k in col_keys]))
    print(sep())
    print(f"共 {len(rows)} 条（每地区每榜单每平台一条）\n")

    # 可选 CSV
    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(headers)
            for r in rows:
                w.writerow([r[k] for k in col_keys])
        print(f"已写入 CSV：{args.csv}")

    return 0


if __name__ == "__main__":
    exit(main())
