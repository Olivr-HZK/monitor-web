"""Semantic SensorTower query tools for Feishu agents."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ai_tools import (
    AgentToolDispatcher,
    _execute_readonly_query,
    _prepare_readonly_sql,
    _validate_db_name,
)

TOP100_DB = "sensortower_top100.db"
APPLIST_DB = "sensortower_applist.db"
SENSORTOWER_DBS = {TOP100_DB, APPLIST_DB}


class SensorTowerQueryTools:
    def __init__(self, dispatcher: AgentToolDispatcher) -> None:
        self.dispatcher = dispatcher

    def run(self, args: dict[str, Any]) -> dict[str, Any]:
        operation = str(args.get("operation") or "").strip()
        if operation == "top_ranking":
            return self._top_ranking(args)
        if operation == "rank_changes":
            return self._rank_changes(args)
        if operation == "weekly_sales_trend":
            return self._weekly_sales_trend(args)
        if operation == "removed_games":
            return self._removed_games(args)
        if operation == "top5_overview":
            return self._top5_overview(args)
        if operation == "fallback_sql":
            return self._fallback_sql(args)
        raise ValueError(f"unknown SensorTower operation: {operation}")

    def _top_ranking(self, args: dict[str, Any]) -> dict[str, Any]:
        platform = _normalize_platform(args.get("platform"))
        country = _normalize_country(args.get("country"))
        chart_type = _normalize_chart_type(args.get("chartType"))
        limit_int = _normalize_limit(args.get("limit"), default=20, maximum=100)
        table = "apple_top100" if platform == "ios" else "android_top100"
        db_path = self._db_path(TOP100_DB)

        cutoff = self._latest_value(
            db_path,
            f"SELECT MAX(rank_date) AS cutoff FROM {table} WHERE country = ? AND chart_type = ?",
            (country, chart_type),
        )
        rows, _ = _execute_readonly_query(
            db_path,
            f"""
            SELECT rank, app_name, app_id, publisher_name
            FROM {table}
            WHERE rank_date = ? AND country = ? AND chart_type = ?
            ORDER BY rank ASC
            """,
            limit_int,
            params=(cutoff, country, chart_type),
        )
        display_platform = "iOS" if platform == "ios" else "Android"
        return _table_envelope(
            title=f"SensorTower {display_platform} {country} {chart_type} Top {limit_int}",
            cutoff=cutoff,
            rows=rows,
            columns=[
                {"key": "rank", "label": "排名"},
                {"key": "app_name", "label": "App"},
                {"key": "app_id", "label": "App ID"},
                {"key": "publisher_name", "label": "发行商"},
            ],
            limit=limit_int,
        )

    def _rank_changes(self, args: dict[str, Any]) -> dict[str, Any]:
        platform = _normalize_platform(args.get("platform"))
        country = _normalize_country(args.get("country"))
        chart_type = _normalize_chart_type(args.get("chartType"))
        limit_int = _normalize_limit(args.get("limit"), default=20, maximum=100)
        db_path = self._db_path(TOP100_DB)

        cutoff = self._latest_value(
            db_path,
            """
            SELECT MAX(rank_date_current) AS cutoff
            FROM rank_changes
            WHERE platform = ? AND country = ? AND chart_type = ?
            """,
            (platform, country, chart_type),
        )
        rows, _ = _execute_readonly_query(
            db_path,
            """
            SELECT
                app_name, app_id, current_rank, previous_rank, rank_delta, change_type,
                rank_date_previous
            FROM rank_changes
            WHERE rank_date_current = ? AND platform = ? AND country = ? AND chart_type = ?
            ORDER BY ABS(rank_delta) DESC, current_rank ASC
            """,
            limit_int,
            params=(cutoff, platform, country, chart_type),
        )
        comparison = rows[0].get("rank_date_previous") if rows else None
        for row in rows:
            row.pop("rank_date_previous", None)
        return _table_envelope(
            title=f"SensorTower {platform} {country} {chart_type} rank changes",
            cutoff=cutoff,
            rows=rows,
            columns=[
                {"key": "app_name", "label": "App"},
                {"key": "current_rank", "label": "当前排名"},
                {"key": "previous_rank", "label": "上期排名"},
                {"key": "rank_delta", "label": "变化"},
                {"key": "change_type", "label": "类型"},
            ],
            limit=limit_int,
            comparison_period=comparison,
        )

    def _weekly_sales_trend(self, args: dict[str, Any]) -> dict[str, Any]:
        app_id = str(args.get("appId") or args.get("app_id") or "").strip()
        if not app_id:
            raise ValueError("appId 不能为空")
        platform = _normalize_platform(args.get("platform"))
        country = _normalize_country(args.get("country"))
        metric = str(args.get("metric") or "downloads").strip()
        if metric not in {"downloads", "revenue"}:
            raise ValueError("metric 仅支持 downloads / revenue")
        limit_int = _normalize_limit(args.get("limit"), default=8, maximum=52)
        db_path = self._db_path(APPLIST_DB)

        rows_desc, _ = _execute_readonly_query(
            db_path,
            f"""
            SELECT week_start, app_id, platform, country, {metric}
            FROM app_list_weekly_sales
            WHERE app_id = ? AND platform = ? AND country = ?
            ORDER BY week_start DESC
            """,
            limit_int,
            params=(app_id, platform, country),
        )
        rows = list(reversed(rows_desc))
        cutoff = rows[-1]["week_start"] if rows else None
        title = f"SensorTower {app_id} {metric} weekly trend"
        payload = {
            "type": "line",
            "title": title,
            "xKey": "week_start",
            "series": [{"key": metric, "name": metric, "color": None}],
            "data": rows,
        }
        if rows:
            self.dispatcher.chart_payloads.append(payload)
        return {
            "output": "chart_png",
            "title": title,
            "cutoff": cutoff,
            "rows": rows,
            "columns": [
                {"key": "week_start", "label": "周"},
                {"key": metric, "label": metric},
            ],
            "truncated": False,
        }

    def _removed_games(self, args: dict[str, Any]) -> dict[str, Any]:
        platform = _normalize_platform(args.get("platform"))
        country = _normalize_country(args.get("country"))
        chart_type = _normalize_chart_type(args.get("chartType"))
        limit_int = _normalize_limit(args.get("limit"), default=20, maximum=100)
        db_path = self._db_path(TOP100_DB)
        cutoff = self._latest_value(
            db_path,
            """
            SELECT MAX(week_start) AS cutoff
            FROM weekly_removed_games
            WHERE platform = ? AND country = ? AND chart_type = ?
            """,
            (platform, country, chart_type),
        )
        rows, _ = _execute_readonly_query(
            db_path,
            """
            SELECT app_name, app_id, previous_rank
            FROM weekly_removed_games
            WHERE week_start = ? AND platform = ? AND country = ? AND chart_type = ?
            ORDER BY previous_rank ASC
            """,
            limit_int,
            params=(cutoff, platform, country, chart_type),
        )
        return _table_envelope(
            title=f"SensorTower removed games {cutoff}",
            cutoff=cutoff,
            rows=rows,
            columns=[
                {"key": "app_name", "label": "App"},
                {"key": "previous_rank", "label": "上期排名"},
            ],
            limit=limit_int,
        )

    def _top5_overview(self, args: dict[str, Any]) -> dict[str, Any]:
        platform = _normalize_platform(args.get("platform"))
        country = _normalize_country(args.get("country"))
        chart_type = _normalize_chart_type(args.get("chartType"))
        db_path = self._db_path(TOP100_DB)
        rows, _ = _execute_readonly_query(
            db_path,
            """
            SELECT week_start, statement
            FROM weekly_top5_overview
            WHERE platform = ? AND country = ? AND chart_type = ?
            ORDER BY week_start DESC
            """,
            1,
            params=(platform, country, chart_type),
        )
        row = rows[0] if rows else {}
        return {
            "output": "text_only",
            "title": f"SensorTower Top5 overview {country} {chart_type}",
            "cutoff": row.get("week_start"),
            "statement": row.get("statement", ""),
            "rows": rows,
            "columns": [{"key": "statement", "label": "摘要"}],
            "truncated": False,
        }

    def _fallback_sql(self, args: dict[str, Any]) -> dict[str, Any]:
        db_raw = str(args.get("db") or "").strip()
        db = Path(db_raw).name.strip()
        if db not in SENSORTOWER_DBS:
            raise ValueError("仅允许查询 SensorTower 数据库")
        sql_raw = str(args.get("sql") or "").strip()
        if not sql_raw:
            raise ValueError("sql 不能为空")
        limit_int = _normalize_limit(args.get("limit"), default=50, maximum=200)
        db_path = self._db_path(db)
        sql, _ = _prepare_readonly_sql(sql_raw)
        rows, cols = _execute_readonly_query(db_path, sql, limit_int)
        return _table_envelope(
            title="SensorTower SQL 查询结果",
            cutoff=None,
            rows=rows,
            columns=[{"key": col, "label": col} for col in cols],
            limit=limit_int,
        )

    def _db_path(self, db_name: str) -> Path:
        public_db_path = self.dispatcher.public_dir / db_name
        if public_db_path.is_file() and public_db_path.suffix.lower() == ".db":
            return public_db_path.resolve()
        _, db_path = _validate_db_name(self.dispatcher.public_dir, db_name)
        return db_path

    def _latest_value(self, db_path: Path, sql: str, params: tuple[Any, ...]) -> Any:
        rows, _ = _execute_readonly_query(db_path, sql, 1, params=params)
        if not rows:
            return None
        return rows[0].get("cutoff")


def _normalize_platform(value: Any) -> str:
    platform = str(value or "ios").strip().lower()
    if platform in {"ios", "apple"}:
        return "ios"
    if platform in {"android", "google", "googleplay", "google_play"}:
        return "android"
    raise ValueError("platform 仅支持 ios / android")


def _normalize_country(value: Any) -> str:
    country = str(value or "US").strip().upper()
    if not country:
        raise ValueError("country 不能为空")
    return country


def _normalize_chart_type(value: Any) -> str:
    chart_type = str(value or "free").strip().lower()
    if not chart_type:
        raise ValueError("chartType 不能为空")
    return chart_type


def _normalize_limit(value: Any, *, default: int, maximum: int) -> int:
    try:
        limit_int = int(value)
    except (TypeError, ValueError):
        limit_int = default
    return max(1, min(limit_int, maximum))


def _table_envelope(
    *,
    title: str,
    cutoff: Any,
    rows: list[dict[str, Any]],
    columns: list[dict[str, str]],
    limit: int,
    comparison_period: Any | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "output": "table_card",
        "title": title,
        "cutoff": cutoff,
        "rows": rows,
        "columns": columns,
        "truncated": len(rows) >= limit,
    }
    if comparison_period is not None:
        result["comparisonPeriod"] = comparison_period
    return result
