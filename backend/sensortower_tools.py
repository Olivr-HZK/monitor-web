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
        if operation == "game_lookup":
            return self._game_lookup(args)
        if operation == "store_changes":
            return self._store_changes(args)
        if operation == "metadata_changes":
            return self._metadata_changes(args)
        if operation == "applist_summary":
            return self._applist_summary(args)
        if operation == "fallback_sql":
            return self._fallback_sql(args)
        raise ValueError(f"unknown SensorTower operation: {operation}")

    def _top_ranking(self, args: dict[str, Any]) -> dict[str, Any]:
        platform = _normalize_platform(args.get("platform"))
        country = _normalize_country(args.get("country"))
        chart_type = _normalize_chart_type(args.get("chartType"))
        limit_int = _normalize_limit(args.get("limit"), default=20, maximum=100)
        table = "apple_top100" if platform == "ios" else "android_top100"
        chart_types = _chart_type_values(platform, chart_type)
        chart_clause = _in_clause("chart_type", len(chart_types))
        db_path = self._db_path(TOP100_DB)

        cutoff = self._latest_value(
            db_path,
            f"SELECT MAX(rank_date) AS cutoff FROM {table} WHERE country = ? AND {chart_clause}",
            (country, *chart_types),
        )
        rows, _ = _execute_readonly_query(
            db_path,
            f"""
            SELECT rank, app_name, app_id, downloads, revenue
            FROM {table}
            WHERE rank_date = ? AND country = ? AND {chart_clause}
            ORDER BY rank ASC
            """,
            limit_int,
            params=(cutoff, country, *chart_types),
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
                {"key": "downloads", "label": "下载"},
                {"key": "revenue", "label": "收入"},
            ],
            limit=limit_int,
        )

    def _rank_changes(self, args: dict[str, Any]) -> dict[str, Any]:
        platform = _normalize_platform(args.get("platform"))
        country = _normalize_country(args.get("country"))
        chart_type = _normalize_chart_type(args.get("chartType"))
        limit_int = _normalize_limit(args.get("limit"), default=20, maximum=100)
        db_path = self._db_path(TOP100_DB)
        country_values = _country_values(country)

        cutoff = self._latest_value(
            db_path,
            f"""
            SELECT MAX(rank_date_current) AS cutoff
            FROM rank_changes
            WHERE lower(platform) = ? AND {_in_clause("country", len(country_values))}
            """,
            (platform, *country_values),
        )
        direction = str(args.get("direction") or args.get("changeType") or "").strip().lower()
        direction_clause = ""
        params: tuple[Any, ...] = (cutoff, platform, *country_values)
        if direction:
            direction_values = _direction_values(direction)
            direction_clause = f" AND {_in_clause('change_type', len(direction_values))}"
            params = (cutoff, platform, *country_values, *direction_values)
        rows, _ = _execute_readonly_query(
            db_path,
            f"""
            SELECT
                app_name, current_rank, last_week_rank, change, change_type,
                publisher_name, downloads, revenue, rank_date_last
            FROM rank_changes
            WHERE rank_date_current = ? AND lower(platform) = ?
              AND {_in_clause("country", len(country_values))}{direction_clause}
            ORDER BY current_rank ASC
            """,
            limit_int,
            params=params,
        )
        comparison = rows[0].get("rank_date_last") if rows else None
        for row in rows:
            row.pop("rank_date_last", None)
        return _table_envelope(
            title=f"SensorTower {platform} {country} {chart_type} rank changes",
            cutoff=cutoff,
            rows=rows,
            columns=[
                {"key": "app_name", "label": "App"},
                {"key": "current_rank", "label": "当前排名"},
                {"key": "last_week_rank", "label": "上期排名"},
                {"key": "change", "label": "变化"},
                {"key": "change_type", "label": "类型"},
                {"key": "publisher_name", "label": "发行商"},
                {"key": "downloads", "label": "下载"},
                {"key": "revenue", "label": "收入"},
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
            SELECT MAX(rank_date) AS cutoff
            FROM weekly_removed_games
            WHERE lower(os) = ? AND country = ? AND chart_type = ? AND removed = 1
            """,
            (platform, country, chart_type),
        )
        rows, _ = _execute_readonly_query(
            db_path,
            """
            SELECT app_name, app_id, http_status, reason, store_url
            FROM weekly_removed_games
            WHERE rank_date = ? AND lower(os) = ? AND country = ? AND chart_type = ? AND removed = 1
            ORDER BY app_name ASC
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
                {"key": "app_id", "label": "App ID"},
                {"key": "http_status", "label": "HTTP"},
                {"key": "reason", "label": "原因"},
                {"key": "store_url", "label": "链接"},
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
            SELECT rank_date, statement, trend_json
            FROM weekly_top5_overview
            ORDER BY rank_date DESC
            """,
            1,
        )
        row = rows[0] if rows else {}
        return {
            "output": "text_only",
            "title": f"SensorTower Top5 overview {country} {chart_type}",
            "cutoff": row.get("rank_date"),
            "statement": row.get("statement", ""),
            "rows": rows,
            "columns": [{"key": "statement", "label": "摘要"}],
            "truncated": False,
        }

    def _game_lookup(self, args: dict[str, Any]) -> dict[str, Any]:
        app_id = _required_app_id(args)
        platform = _normalize_platform(args.get("platform"))
        db_path = self._db_path(TOP100_DB)
        rows, _ = _execute_readonly_query(
            db_path,
            """
            SELECT
                app_id,
                os,
                name,
                publisher_name,
                rating,
                humanized_worldwide_last_month_downloads,
                humanized_worldwide_last_month_revenue
            FROM app_metadata
            WHERE app_id = ? AND lower(os) = ?
            ORDER BY app_id ASC
            """,
            1,
            params=(app_id, platform),
        )
        return _table_envelope(
            title=f"SensorTower game lookup {app_id}",
            cutoff=None,
            rows=rows,
            columns=[
                {"key": "app_id", "label": "App ID"},
                {"key": "os", "label": "平台"},
                {"key": "name", "label": "App"},
                {"key": "publisher_name", "label": "发行商"},
                {"key": "rating", "label": "评分"},
                {"key": "humanized_worldwide_last_month_downloads", "label": "上月下载"},
                {"key": "humanized_worldwide_last_month_revenue", "label": "上月收入"},
            ],
            limit=2,
        )

    def _store_changes(self, args: dict[str, Any]) -> dict[str, Any]:
        platform = _normalize_platform(args.get("platform"))
        app_id = str(args.get("appId") or args.get("app_id") or "").strip()
        limit_int = _normalize_limit(args.get("limit"), default=20, maximum=100)
        table = "appstoreinfo_changes" if platform == "ios" else "gamestoreinfo_changes"
        db_path = self._db_path(TOP100_DB)
        where_clause = ""
        params: tuple[Any, ...] = ()
        if app_id:
            where_clause = "WHERE app_id = ?"
            params = (app_id,)
        rows, _ = _execute_readonly_query(
            db_path,
            f"""
            SELECT rank_date, app_id, changed_at, changes_json
            FROM {table}
            {where_clause}
            ORDER BY COALESCE(rank_date, changed_at) DESC
            """,
            limit_int,
            params=params,
        )
        cutoff = None
        if rows:
            cutoff = rows[0].get("rank_date") or rows[0].get("changed_at")
        return _table_envelope(
            title=f"SensorTower store changes {platform}",
            cutoff=cutoff,
            rows=rows,
            columns=[
                {"key": "rank_date", "label": "榜单日期"},
                {"key": "app_id", "label": "App ID"},
                {"key": "changed_at", "label": "变更时间"},
                {"key": "changes_json", "label": "变更"},
            ],
            limit=limit_int,
        )

    def _metadata_changes(self, args: dict[str, Any]) -> dict[str, Any]:
        platform = _normalize_platform(args.get("platform"))
        app_id = str(args.get("appId") or args.get("app_id") or "").strip()
        limit_int = _normalize_limit(args.get("limit"), default=20, maximum=100)
        db_path = self._db_path(TOP100_DB)
        where_clause = "WHERE lower(os) = ?"
        params: tuple[Any, ...] = (platform,)
        if app_id:
            where_clause += " AND app_id = ?"
            params = (platform, app_id)
        rows, _ = _execute_readonly_query(
            db_path,
            f"""
            SELECT rank_date, app_name, app_id, os, changed_fields, old_values, new_values
            FROM weekly_metadata_changes
            {where_clause}
            ORDER BY rank_date DESC
            """,
            limit_int,
            params=params,
        )
        cutoff = rows[0].get("rank_date") if rows else None
        return _table_envelope(
            title=f"SensorTower metadata changes {platform}",
            cutoff=cutoff,
            rows=rows,
            columns=[
                {"key": "rank_date", "label": "榜单日期"},
                {"key": "app_name", "label": "App"},
                {"key": "app_id", "label": "App ID"},
                {"key": "os", "label": "平台"},
                {"key": "changed_fields", "label": "变更字段"},
                {"key": "old_values", "label": "旧值"},
                {"key": "new_values", "label": "新值"},
            ],
            limit=limit_int,
        )

    def _applist_summary(self, args: dict[str, Any]) -> dict[str, Any]:
        app_id = _required_app_id(args)
        platform = _normalize_platform(args.get("platform"))
        db_path = self._db_path(APPLIST_DB)
        rows, _ = _execute_readonly_query(
            db_path,
            """
            SELECT week_start, app_id, platform, summary_md
            FROM applist_ai_summary
            WHERE app_id = ? AND lower(platform) = ?
            ORDER BY week_start DESC
            """,
            5,
            params=(app_id, platform),
        )
        return {
            "output": "text_only",
            "title": f"SensorTower applist summary {app_id}",
            "cutoff": rows[0].get("week_start") if rows else None,
            "rows": rows,
            "columns": [
                {"key": "week_start", "label": "周"},
                {"key": "app_id", "label": "App ID"},
                {"key": "platform", "label": "平台"},
                {"key": "summary_md", "label": "摘要"},
            ],
            "statement": rows[0].get("summary_md", "") if rows else "",
            "truncated": len(rows) >= 5,
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


def _required_app_id(args: dict[str, Any]) -> str:
    app_id = str(args.get("appId") or args.get("app_id") or "").strip()
    if not app_id:
        raise ValueError("appId 不能为空")
    return app_id


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


def _chart_type_values(platform: str, chart_type: str) -> tuple[str, ...]:
    aliases = [chart_type]
    if chart_type == "free":
        aliases.append("topfreeapplications" if platform == "ios" else "topselling_free")
    elif chart_type in {"grossing", "revenue"}:
        aliases.append("topgrossingapplications" if platform == "ios" else "topgrossing")
    return tuple(dict.fromkeys(aliases))


def _country_values(country: str) -> tuple[str, ...]:
    aliases = {
        "US": "🇺🇸 美国",
        "GB": "🇬🇧 英国",
        "UK": "🇬🇧 英国",
        "DE": "🇩🇪 德国",
        "IN": "🇮🇳 印度",
        "JP": "🇯🇵 日本",
    }
    values = [country]
    if country in aliases:
        values.append(aliases[country])
    return tuple(dict.fromkeys(values))


def _direction_values(direction: str) -> tuple[str, ...]:
    aliases = {
        "rise": ("rise", "📈 排名上升", "🚀 排名飙升"),
        "up": ("rise", "📈 排名上升", "🚀 排名飙升"),
        "upward": ("rise", "📈 排名上升", "🚀 排名飙升"),
        "fall": ("fall", "📉 排名下跌"),
        "down": ("fall", "📉 排名下跌"),
        "downward": ("fall", "📉 排名下跌"),
        "new": ("new", "🆕 新进榜单"),
        "new_entry": ("new", "🆕 新进榜单"),
        "new-entry": ("new", "🆕 新进榜单"),
    }
    return aliases.get(direction, (direction,))


def _in_clause(column: str, count: int) -> str:
    placeholders = ", ".join("?" for _ in range(count))
    return f"{column} IN ({placeholders})"


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
