#!/usr/bin/env python3
"""
根据 sensortower_top100.db 的 rank_changes 表，按周生成 SensorTower 周报。

重点内容：
  - 本周新进 Top50：当周新进榜单且当前排名 ≤50 的产品，按当前排名排序
  - 本周排名飙升 Top10：当周排名飙升中上升幅度最大的 10 款产品

输出：Markdown 文件到 public/休闲游戏检测/sensortower_周报/周报_YYYY-MM-DD.md
（日期为当周榜单日期 rank_date_current）

使用方式（在项目根目录）：
  python scripts/generate_sensortower_weekly_report.py
  python scripts/generate_sensortower_weekly_report.py --db public/sensortower_top100.db --out public/休闲游戏检测/sensortower_周报
"""

import argparse
import re
import sqlite3
from pathlib import Path


def parse_surge_value(change: str) -> int:
    """从变化字符串解析上升幅度，如 '↑20' -> 20，'↑61' -> 61。无法解析返回 0。"""
    if not change or change == "NEW":
        return 0
    m = re.search(r"↑\s*(\d+)", str(change).strip())
    return int(m.group(1)) if m else 0


def format_number(n) -> str:
    """格式化数字：过万显示为 x.xx万，否则千分位。"""
    if n is None:
        return "—"
    try:
        n = int(n)
    except (TypeError, ValueError):
        return str(n)
    if n >= 10000:
        return f"{n / 10000:.2f}万"
    return f"{n:,}"


def format_revenue(r) -> str:
    """收入格式化：美元千分位或万。"""
    if r is None:
        return "—"
    try:
        r = float(r)
    except (TypeError, ValueError):
        return str(r)
    if r >= 10000:
        return f"${r / 10000:.2f}万"
    return f"${r:,.0f}"


def get_weeks(cursor) -> list[tuple[str, str]]:
    """返回 (rank_date_current, rank_date_last) 列表，按当周日期倒序。"""
    cursor.execute(
        """
        SELECT DISTINCT rank_date_current, rank_date_last
        FROM rank_changes
        ORDER BY rank_date_current DESC
        """
    )
    return cursor.fetchall()


def get_new_entries_top50(cursor, rank_date_current: str) -> list[dict]:
    """获取当周新进 Top50 列表（新进榜单且 current_rank <= 50），按 current_rank 排序。"""
    cursor.execute(
        """
        SELECT
            r.current_rank,
            r.app_id,
            r.country,
            r.platform,
            r.downloads,
            r.revenue,
            COALESCE(m.name, r.app_name, r.app_id) AS display_name,
            COALESCE(NULLIF(TRIM(r.publisher_name), ''), m.publisher_name) AS publisher_name
        FROM rank_changes r
        LEFT JOIN app_metadata m ON m.app_id = r.app_id AND m.os = LOWER(r.platform)
        WHERE r.rank_date_current = ?
          AND r.change_type = '🆕 新进榜单'
          AND r.current_rank <= 50
        ORDER BY r.current_rank ASC, r.country, r.platform
        """,
        (rank_date_current,),
    )
    rows = cursor.fetchall()
    return [
        {
            "current_rank": r[0],
            "app_id": r[1],
            "country": r[2],
            "platform": r[3],
            "downloads": r[4],
            "revenue": r[5],
            "display_name": r[6] or r[1],
            "publisher_name": r[7] or "—",
        }
        for r in rows
    ]


def get_surge_top10(cursor, rank_date_current: str) -> list[dict]:
    """获取当周排名飙升 Top10（按上升幅度降序取前 10）。"""
    cursor.execute(
        """
        SELECT
            r.current_rank,
            r.last_week_rank,
            r.change,
            r.app_id,
            r.country,
            r.platform,
            r.downloads,
            r.revenue,
            COALESCE(m.name, r.app_name, r.app_id) AS display_name,
            COALESCE(NULLIF(TRIM(r.publisher_name), ''), m.publisher_name) AS publisher_name
        FROM rank_changes r
        LEFT JOIN app_metadata m ON m.app_id = r.app_id AND m.os = LOWER(r.platform)
        WHERE r.rank_date_current = ?
          AND r.change_type = '🚀 排名飙升'
        ORDER BY r.current_rank ASC
        """,
        (rank_date_current,),
    )
    rows = cursor.fetchall()
    # 在 Python 里解析 change 并按上升幅度排序，取前 10
    with_surge = []
    for r in rows:
        change_str = r[2] or ""
        surge = parse_surge_value(change_str)
        with_surge.append(
            {
                "current_rank": r[0],
                "last_week_rank": r[1],
                "change": change_str,
                "surge_value": surge,
                "app_id": r[3],
                "country": r[4],
                "platform": r[5],
                "downloads": r[6],
                "revenue": r[7],
                "display_name": (r[8] or r[3]),
                "publisher_name": r[9] or "—",
            }
        )
    with_surge.sort(key=lambda x: (-x["surge_value"], x["current_rank"]))
    return with_surge[:10]


def render_week_md(rank_date_current: str, rank_date_last: str, new_top50: list, surge_top10: list) -> str:
    """生成单周周报 Markdown 内容。"""
    lines = [
        f"# SensorTower 榜单周报（{rank_date_current}）",
        "",
        f"**统计周期**：本周榜单日期 {rank_date_current}，对比上周 {rank_date_last}。",
        "",
        "---",
        "",
        "## 一、本周新进 Top50",
        "",
        "当周新进榜单且当前排名在 Top50 内的产品（按当前排名排序）：",
        "",
        "| 排名 | 产品名 | 开发者 | 国家/地区 | 平台 | 下载量 | 收入 |",
        "|------|--------|--------|-----------|------|--------|------|",
    ]
    for row in new_top50:
        lines.append(
            f"| {row['current_rank']} | {row['display_name']} | {row.get('publisher_name', '—')} | {row['country']} | {row['platform']} | "
            f"{format_number(row['downloads'])} | {format_revenue(row['revenue'])} |"
        )
    if not new_top50:
        lines.append("| — | 本周无新进 Top50 记录 | — | — | — | — | — |")
    lines.extend(
        [
            "",
            "---",
            "",
            "## 二、本周排名飙升 Top10",
            "",
            "当周排名飙升中，上升幅度最大的 10 款产品：",
            "",
            "| 当前排名 | 上周排名 | 上升幅度 | 产品名 | 开发者 | 国家/地区 | 平台 | 下载量 | 收入 |",
            "|----------|----------|----------|--------|--------|-----------|------|--------|------|",
        ]
    )
    for row in surge_top10:
        lines.append(
            f"| {row['current_rank']} | {row['last_week_rank']} | {row['change']} | {row['display_name']} | {row.get('publisher_name', '—')} | "
            f"{row['country']} | {row['platform']} | {format_number(row['downloads'])} | {format_revenue(row['revenue'])} |"
        )
    if not surge_top10:
        lines.append("| — | — | — | 本周无排名飙升记录 | — | — | — | — | — |")
    lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="根据 rank_changes 生成 SensorTower 周报")
    parser.add_argument(
        "--db",
        type=Path,
        default=Path("public/sensortower_top100.db"),
        help="sensortower_top100.db 路径",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("public/休闲游戏检测/sensortower_周报"),
        help="周报 Markdown 输出目录",
    )
    args = parser.parse_args()

    if not args.db.exists():
        print(f"错误：数据库不存在 {args.db}")
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    weeks = get_weeks(cur)
    if not weeks:
        print("未找到任何周次数据（rank_changes 为空或无有效记录）")
        conn.close()
        return 0

    for rank_date_current, rank_date_last in weeks:
        new_top50 = get_new_entries_top50(cur, rank_date_current)
        surge_top10 = get_surge_top10(cur, rank_date_current)
        md = render_week_md(rank_date_current, rank_date_last, new_top50, surge_top10)
        out_file = args.out / f"周报_{rank_date_current}.md"
        out_file.write_text(md, encoding="utf-8")
        print(f"已生成：{out_file}（新进 Top50: {len(new_top50)} 条，排名飙升 Top10: {len(surge_top10)} 条）")

    conn.close()
    return 0


if __name__ == "__main__":
    exit(main())
