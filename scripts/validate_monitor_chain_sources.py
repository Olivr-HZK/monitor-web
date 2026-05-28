#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path


EXPECTED_WECHAT_CHARTS = (
    ("dy", "bestseller"),
    ("dy", "new_games"),
    ("dy", "popularity"),
    ("wx", "bestseller"),
    ("wx", "casual_play"),
    ("wx", "popularity"),
)


def parse_report_date(raw: str) -> datetime:
    try:
        return datetime.strptime(raw.strip()[:10], "%Y-%m-%d")
    except ValueError as exc:
        raise SystemExit(f"[错误] --report-date 应为 YYYY-MM-DD：{raw!r}") from exc


def target_week(report_date: datetime) -> tuple[str, str, str]:
    end_date = report_date - timedelta(days=1)
    start_date = end_date - timedelta(days=6)
    start_iso = start_date.strftime("%Y-%m-%d")
    end_iso = end_date.strftime("%Y-%m-%d")
    return start_iso, end_iso, f"{start_iso}~{end_iso}"


def connect_readonly(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise FileNotFoundError(str(db_path))
    uri = f"file:{db_path}?mode=ro"
    return sqlite3.connect(uri, uri=True)


def scalar(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> object:
    row = conn.execute(sql, params).fetchone()
    return row[0] if row else None


def require_integrity(db_path: Path, label: str, errors: list[str]) -> None:
    try:
        with connect_readonly(db_path) as conn:
            result = scalar(conn, "PRAGMA integrity_check")
    except Exception as exc:  # noqa: BLE001 - print concrete DB path in operator output.
        errors.append(f"{label}: 无法打开或检查 SQLite：{db_path} ({exc})")
        return
    if result != "ok":
        errors.append(f"{label}: SQLite integrity_check={result!r}，路径：{db_path}")


def validate_sensortower(db_path: Path, report_date_iso: str, errors: list[str], summary: list[str]) -> None:
    require_integrity(db_path, "SensorTower", errors)
    try:
        with connect_readonly(db_path) as conn:
            count = int(
                scalar(
                    conn,
                    "SELECT COUNT(*) FROM rank_changes WHERE rank_date_current = ?",
                    (report_date_iso,),
                )
                or 0
            )
            latest = scalar(conn, "SELECT MAX(rank_date_current) FROM rank_changes")
    except sqlite3.Error as exc:
        errors.append(f"SensorTower: rank_changes 校验失败：{exc}")
        return
    if count <= 0:
        errors.append(
            "SensorTower: 未找到本次报告日期的 rank_changes，"
            f"report_date={report_date_iso}，latest={latest or '无'}"
        )
        return
    summary.append(f"SensorTower rank_changes[{report_date_iso}]={count}")


def validate_competitor(db_path: Path, week_end_iso: str, errors: list[str], summary: list[str]) -> None:
    require_integrity(db_path, "竞品社媒", errors)
    try:
        with connect_readonly(db_path) as conn:
            count = int(
                scalar(
                    conn,
                    "SELECT COUNT(*) FROM weekly_reports WHERE end_date = ?",
                    (week_end_iso,),
                )
                or 0
            )
            latest = scalar(conn, "SELECT MAX(end_date) FROM weekly_reports")
    except sqlite3.Error as exc:
        errors.append(f"竞品社媒: weekly_reports 校验失败：{exc}")
        return
    if count <= 0:
        errors.append(
            "竞品社媒: 未找到目标周结束日的 weekly_reports，"
            f"week_end={week_end_iso}，latest={latest or '无'}"
        )
        return
    summary.append(f"竞品 weekly_reports[end_date={week_end_iso}]={count}")


def validate_wechat_douyin(db_path: Path, week_range: str, errors: list[str], summary: list[str]) -> None:
    require_integrity(db_path, "微信/抖音", errors)
    try:
        with connect_readonly(db_path) as conn:
            missing: list[str] = []
            counts: list[str] = []
            for platform_key, chart_key in EXPECTED_WECHAT_CHARTS:
                count = int(
                    scalar(
                        conn,
                        """
                        SELECT COUNT(*)
                        FROM top20_ranking
                        WHERE week_range = ? AND platform_key = ? AND chart_key = ?
                        """,
                        (week_range, platform_key, chart_key),
                    )
                    or 0
                )
                counts.append(f"{platform_key}/{chart_key}={count}")
                if count <= 0:
                    missing.append(f"{platform_key}/{chart_key}")
            change_count = int(
                scalar(
                    conn,
                    "SELECT COUNT(*) FROM rank_changes WHERE week_range = ?",
                    (week_range,),
                )
                or 0
            )
            latest = scalar(conn, "SELECT MAX(week_range) FROM top20_ranking")
    except sqlite3.Error as exc:
        errors.append(f"微信/抖音: 榜单表校验失败：{exc}")
        return

    if missing:
        errors.append(
            "微信/抖音: 目标周 top20_ranking 缺少三榜组合，"
            f"week_range={week_range}，missing={', '.join(missing)}，latest={latest or '无'}"
        )
        return
    if change_count <= 0:
        errors.append(f"微信/抖音: 目标周 rank_changes 为空，week_range={week_range}")
        return
    summary.append(f"微信/抖音 top20[{week_range}] " + ", ".join(counts))
    summary.append(f"微信/抖音 rank_changes[{week_range}]={change_count}")


def validate_our_product(db_path: Path, report_date_iso: str, errors: list[str], summary: list[str]) -> None:
    require_integrity(db_path, "我方产品", errors)
    try:
        with connect_readonly(db_path) as conn:
            rank_count = int(
                scalar(
                    conn,
                    """
                    SELECT COUNT(*)
                    FROM app_ranks
                    WHERE country = 'US' AND rank_date = ?
                    """,
                    (report_date_iso,),
                )
                or 0
            )
            latest_rank_date = scalar(conn, "SELECT MAX(rank_date) FROM app_ranks")
            daily_row = conn.execute(
                """
                SELECT date_from, date_to
                FROM weekly_summaries
                WHERE date_to = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (report_date_iso,),
            ).fetchone()
            latest_summary_date = scalar(conn, "SELECT MAX(date_to) FROM weekly_summaries")
            changed_segments = 0
            if daily_row:
                changed_segments = int(
                    scalar(
                        conn,
                        """
                        WITH prev AS (
                          SELECT internal_name, lower(platform) AS pf, lower(coalesce(device, '')) AS dev,
                                 chart_type, category, rank
                          FROM app_ranks
                          WHERE country = 'US'
                            AND rank_date = ?
                            AND lower(platform) IN ('ios', 'android')
                            AND rank > 0 AND rank <= 500
                        ),
                        curr AS (
                          SELECT internal_name, lower(platform) AS pf, lower(coalesce(device, '')) AS dev,
                                 chart_type, category, rank
                          FROM app_ranks
                          WHERE country = 'US'
                            AND rank_date = ?
                            AND lower(platform) IN ('ios', 'android')
                            AND rank > 0 AND rank <= 500
                        )
                        SELECT COUNT(*)
                        FROM curr
                        JOIN prev USING (internal_name, pf, dev, chart_type, category)
                        WHERE curr.rank != prev.rank
                        """,
                        (str(daily_row[0]), str(daily_row[1])),
                    )
                    or 0
                )
    except sqlite3.Error as exc:
        errors.append(f"我方产品: app_ranks / weekly_summaries 校验失败：{exc}")
        return

    if rank_count <= 0:
        errors.append(
            "我方产品: 未找到本次报告日期的 app_ranks，"
            f"report_date={report_date_iso}，latest={latest_rank_date or '无'}"
        )
        return
    if not daily_row:
        errors.append(
            "我方产品: 未找到本次报告日期的 daily summary，"
            f"date_to={report_date_iso}，latest={latest_summary_date or '无'}"
        )
        return
    summary.append(
        "我方产品 "
        f"app_ranks[{report_date_iso}]={rank_count}，"
        f"daily_summary={daily_row[0]}→{daily_row[1]}，"
        f"changed_segments={changed_segments}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="校验 monitor-web 周一同步链路的四份 SQLite 源数据")
    parser.add_argument("--report-date", required=True, metavar="YYYY-MM-DD")
    parser.add_argument("--sensortower-db", type=Path, required=True)
    parser.add_argument("--competitor-db", type=Path, required=True)
    parser.add_argument("--wechat-db", type=Path, required=True)
    parser.add_argument("--our-product-db", type=Path, required=True)
    args = parser.parse_args()

    report_dt = parse_report_date(args.report_date)
    week_start, week_end, week_range = target_week(report_dt)

    errors: list[str] = []
    summary = [
        f"report_date={report_dt.strftime('%Y-%m-%d')}",
        f"target_week={week_start}~{week_end}",
    ]

    validate_sensortower(args.sensortower_db, report_dt.strftime("%Y-%m-%d"), errors, summary)
    validate_competitor(args.competitor_db, week_end, errors, summary)
    validate_wechat_douyin(args.wechat_db, week_range, errors, summary)
    validate_our_product(args.our_product_db, week_end, errors, summary)

    if errors:
        for err in errors:
            print(f"[失败] {err}", file=sys.stderr)
        return 1

    for line in summary:
        print(f"[通过] {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
