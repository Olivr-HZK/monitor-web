# SensorTower Feishu Group Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the casual Feishu group bot answer SensorTower-only questions across the current local SensorTower databases and return text plus Feishu group-message table cards or PNG charts.

**Architecture:** Add a SensorTower semantic tool layer that wraps controlled SQL behind business parameters and keeps generic read-only SQL as a constrained fallback. Extend assistant results with table-card payloads, add Feishu interactive-card reply support, and route table-shaped SensorTower results to group-message cards while trend outputs continue to use PNG charts.

**Tech Stack:** Python 3, FastAPI, httpx, SQLite, pytest, existing OpenRouter function-calling dispatcher, existing Feishu event client.

---

## File Structure

- Create `backend/sensortower_tools.py`: SensorTower semantic query tools, period resolution, safe SQL execution through the existing dispatcher helpers, and result-envelope helpers.
- Create `backend/feishu_cards.py`: Feishu interactive card table payload builder with compact Chinese column labels and row limits.
- Create `backend/test_sensortower_tools.py`: unit tests for semantic tools and SensorTower SQL fallback using temporary SQLite fixtures.
- Create `backend/test_feishu_cards.py`: unit tests for Feishu table-card payload shape and truncation behavior.
- Modify `backend/assistant_service.py`: extend `AssistantResult` with `tables`, update SensorTower prompt guidance, include both `sensortower_top100.db` and `sensortower_applist.db`, and pass table payloads through OpenRouter results.
- Modify `backend/ai_tools.py`: register `sensortower_query`, store returned table payloads, and expose the tool in `openai_style_tools_schema`.
- Modify `backend/feishu_bot.py`: add `reply_interactive_card()` for Feishu group-message cards.
- Modify `backend/casual_feishu_agent.py`: send `AssistantResult.tables` as Feishu cards after the text answer and before or after charts based on payload order.
- Modify `backend/test_assistant_routing.py`: verify SensorTower-only prompt and database selection include the applist database and semantic-tool guidance.
- Modify `backend/test_casual_feishu_agent.py`: verify table-card replies are sent for SensorTower table results.

Implementation should run in an isolated worktree if the current checkout is dirty. The current checkout already has unrelated SensorTower single-game-profile changes, so do not stage or edit those unless the user explicitly redirects.

---

### Task 1: SensorTower Semantic Tool Core

**Files:**
- Create: `backend/sensortower_tools.py`
- Modify: `backend/ai_tools.py`
- Test: `backend/test_sensortower_tools.py`

- [ ] **Step 1: Write failing tests for Top ranking, rank changes, weekly sales trend, and SQL fallback**

Create `backend/test_sensortower_tools.py` with:

```python
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from ai_tools import AgentToolDispatcher
from sensortower_tools import SensorTowerQueryTools


def _create_top100_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE apple_top100 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rank_date TEXT NOT NULL,
            country TEXT NOT NULL,
            chart_type TEXT NOT NULL,
            rank INTEGER NOT NULL,
            app_id TEXT NOT NULL,
            app_name TEXT DEFAULT '',
            downloads REAL,
            revenue REAL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE android_top100 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rank_date TEXT NOT NULL,
            country TEXT NOT NULL,
            chart_type TEXT NOT NULL,
            rank INTEGER NOT NULL,
            app_id TEXT NOT NULL,
            app_name TEXT DEFAULT '',
            downloads REAL,
            revenue REAL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE rank_changes (
            rank_date_current TEXT NOT NULL,
            rank_date_last TEXT NOT NULL,
            signal TEXT,
            app_name TEXT,
            app_id TEXT NOT NULL,
            country TEXT,
            platform TEXT,
            current_rank INTEGER,
            last_week_rank TEXT,
            change TEXT,
            change_type TEXT,
            publisher_name TEXT,
            store_url TEXT,
            downloads REAL,
            revenue REAL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE weekly_removed_games (
            rank_date TEXT NOT NULL,
            os TEXT NOT NULL,
            country TEXT NOT NULL,
            chart_type TEXT NOT NULL,
            app_id TEXT NOT NULL,
            app_name TEXT,
            store_url TEXT,
            http_status INTEGER,
            removed INTEGER NOT NULL,
            reason TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE weekly_top5_overview (
            rank_date TEXT PRIMARY KEY,
            statement TEXT NOT NULL,
            trend_json TEXT
        )
        """
    )
    conn.executemany(
        "INSERT INTO apple_top100(rank_date, country, chart_type, rank, app_id, app_name, downloads, revenue) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("2026-05-25", "US", "free", 1, "ios_a", "Block Blast", 1000, 20),
            ("2026-05-25", "US", "free", 2, "ios_b", "Royal Match", 900, 40),
            ("2026-06-01", "US", "free", 1, "ios_b", "Royal Match", 1200, 60),
            ("2026-06-01", "US", "free", 2, "ios_a", "Block Blast", 1100, 30),
        ],
    )
    conn.executemany(
        "INSERT INTO rank_changes(rank_date_current, rank_date_last, signal, app_name, app_id, country, platform, current_rank, last_week_rank, change, change_type, publisher_name, store_url, downloads, revenue) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("2026-06-01", "2026-05-25", "rise", "Royal Match", "ios_b", "US", "ios", 1, "2", "+1", "rise", "Dream", "https://example.com/royal", 1200, 60),
            ("2026-06-01", "2026-05-25", "fall", "Block Blast", "ios_a", "US", "ios", 2, "1", "-1", "fall", "Hungry", "https://example.com/block", 1100, 30),
        ],
    )
    conn.execute(
        "INSERT INTO weekly_removed_games(rank_date, os, country, chart_type, app_id, app_name, store_url, http_status, removed, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("2026-06-01", "ios", "US", "free", "gone_1", "Gone Game", "https://example.com/gone", 404, 1, "not_found"),
    )
    conn.execute(
        "INSERT INTO weekly_top5_overview(rank_date, statement, trend_json) VALUES (?, ?, ?)",
        ("2026-06-01", "Top5 continues to rotate around puzzle titles.", "{}"),
    )
    conn.commit()
    conn.close()


def _create_applist_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE app_list_weekly_sales (
            app_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            country TEXT NOT NULL,
            week_start TEXT NOT NULL,
            downloads REAL,
            revenue REAL,
            PRIMARY KEY (app_id, platform, country, week_start)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE applist_ai_summary (
            week_start TEXT NOT NULL,
            app_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            summary_md TEXT NOT NULL,
            PRIMARY KEY (week_start, app_id, platform)
        )
        """
    )
    conn.executemany(
        "INSERT INTO app_list_weekly_sales(app_id, platform, country, week_start, downloads, revenue) VALUES (?, ?, ?, ?, ?, ?)",
        [
            ("ios_a", "ios", "US", "2026-05-18", 800, 10),
            ("ios_a", "ios", "US", "2026-05-25", 1000, 20),
            ("ios_a", "ios", "US", "2026-06-01", 1100, 30),
        ],
    )
    conn.execute(
        "INSERT INTO applist_ai_summary(week_start, app_id, platform, summary_md) VALUES (?, ?, ?, ?)",
        ("2026-06-01", "ios_a", "ios", "Block Blast summary"),
    )
    conn.commit()
    conn.close()


@pytest.fixture
def tools(tmp_path):
    public = tmp_path / "public"
    public.mkdir()
    _create_top100_db(public / "sensortower_top100.db")
    _create_applist_db(public / "sensortower_applist.db")
    AgentToolDispatcher.invalidate_schema_cache()
    dispatcher = AgentToolDispatcher(public, "", True, False)
    yield SensorTowerQueryTools(dispatcher)
    AgentToolDispatcher.invalidate_schema_cache()


def test_top_ranking_latest_returns_table_envelope(tools):
    result = tools.run({"operation": "top_ranking", "platform": "ios", "country": "US", "chartType": "free", "limit": 2})

    assert result["output"] == "table_card"
    assert result["title"] == "SensorTower iOS US free Top 2"
    assert result["cutoff"] == "2026-06-01"
    assert [row["app_name"] for row in result["rows"]] == ["Royal Match", "Block Blast"]
    assert result["columns"][0]["label"] == "排名"


def test_rank_changes_latest_returns_table_envelope(tools):
    result = tools.run({"operation": "rank_changes", "platform": "ios", "country": "US", "direction": "rise", "limit": 5})

    assert result["output"] == "table_card"
    assert result["cutoff"] == "2026-06-01"
    assert result["comparisonPeriod"] == "2026-05-25"
    assert result["rows"][0]["app_name"] == "Royal Match"
    assert result["rows"][0]["change_type"] == "rise"


def test_weekly_sales_trend_returns_chart_envelope_and_registers_chart(tools):
    result = tools.run({"operation": "weekly_sales_trend", "appId": "ios_a", "platform": "ios", "country": "US", "metric": "downloads", "limit": 8})

    assert result["output"] == "chart_png"
    assert result["cutoff"] == "2026-06-01"
    assert result["rows"][-1]["downloads"] == 1100
    assert tools.dispatcher.chart_payloads[-1]["type"] == "line"
    assert tools.dispatcher.chart_payloads[-1]["xKey"] == "week_start"


def test_removed_games_and_top5_overview_surfaces_are_supported(tools):
    removed = tools.run({"operation": "removed_games", "platform": "ios", "country": "US", "limit": 10})
    overview = tools.run({"operation": "top5_overview", "limit": 1})

    assert removed["output"] == "table_card"
    assert removed["rows"][0]["app_name"] == "Gone Game"
    assert overview["output"] == "text_only"
    assert "Top5" in overview["rows"][0]["statement"]


def test_fallback_sql_is_sensor_tower_only_and_hides_sql(tools):
    result = tools.run({"operation": "fallback_sql", "db": "sensortower_top100.db", "sql": "SELECT country, COUNT(*) AS app_count FROM apple_top100 GROUP BY country", "limit": 10})

    assert result["output"] == "table_card"
    assert result["rows"] == [{"country": "US", "app_count": 4}]
    assert "sql" not in result


def test_fallback_sql_rejects_non_sensortower_database(tools):
    with pytest.raises(ValueError, match="仅允许查询 SensorTower"):
        tools.run({"operation": "fallback_sql", "db": "wechatdouyin.db", "sql": "SELECT 1"})
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
python -m pytest backend/test_sensortower_tools.py -q
```

Expected: FAIL because `sensortower_tools` does not exist.

- [ ] **Step 3: Update the read-only query helper to support bound parameters**

In `backend/ai_tools.py`, change `_execute_readonly_query` signature and `cur.execute`:

```python
def _execute_readonly_query(
    db_path: Path,
    sql: str,
    limit_int: int,
    *,
    timeout_sec: float = 5.0,
    params: tuple[Any, ...] = (),
) -> tuple[list[dict[str, Any]], list[str]]:
    started = time.monotonic()
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=timeout_sec)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON")

        def _progress() -> int:
            return 1 if time.monotonic() - started > timeout_sec else 0

        conn.set_progress_handler(_progress, 2000)
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchmany(limit_int)
        out_rows: list[dict[str, Any]] = [dict(row) for row in rows]
        cols = list(out_rows[0].keys()) if out_rows else [d[0] for d in (cur.description or [])]
        return out_rows, cols
    except sqlite3.OperationalError as e:
        if "interrupted" in str(e).lower():
            raise ValueError("SQL 查询超时，请缩小范围或增加过滤条件") from e
        raise
    finally:
        conn.close()
```

- [ ] **Step 4: Implement the semantic tool core**

Create `backend/sensortower_tools.py` with:

```python
"""SensorTower semantic query tools built on top of read-only SQLite queries."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ai_tools import AgentToolDispatcher, _execute_readonly_query, _prepare_readonly_sql, _validate_db_name


TOP100_DB = "sensortower_top100.db"
APPLIST_DB = "sensortower_applist.db"
SENSORTOWER_DBS = {TOP100_DB, APPLIST_DB}


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _limit(value: Any, default: int = 20, hard_max: int = 50) -> int:
    try:
        n = int(value)
    except Exception:
        n = default
    return max(1, min(n, hard_max))


def _platform(value: Any) -> str:
    raw = _clean(value).lower()
    if raw in {"ios", "apple", "iphone", "ipad"}:
        return "ios"
    if raw in {"android", "google", "google_play", "gp"}:
        return "android"
    return raw or "ios"


def _top_table(platform: str) -> str:
    if platform == "ios":
        return "apple_top100"
    if platform == "android":
        return "android_top100"
    raise ValueError("platform 仅支持 ios/android")


def _rows_to_columns(rows: list[dict[str, Any]], labels: dict[str, str] | None = None) -> list[dict[str, str]]:
    labels = labels or {}
    keys: list[str] = []
    for row in rows:
        for key in row.keys():
            if key not in keys:
                keys.append(key)
    return [{"key": key, "label": labels.get(key, key)} for key in keys]


@dataclass
class SensorTowerQueryTools:
    dispatcher: AgentToolDispatcher

    def run(self, args: dict[str, Any]) -> dict[str, Any]:
        op = _clean(args.get("operation")).lower()
        if op == "top_ranking":
            return self.top_ranking(args)
        if op == "rank_changes":
            return self.rank_changes(args)
        if op == "weekly_sales_trend":
            return self.weekly_sales_trend(args)
        if op == "removed_games":
            return self.removed_games(args)
        if op == "top5_overview":
            return self.top5_overview(args)
        if op == "fallback_sql":
            return self.fallback_sql(args)
        raise ValueError(f"未知 SensorTower operation: {op}")

    def _query(self, db: str, sql: str, params: tuple[Any, ...], limit: int) -> tuple[list[dict[str, Any]], list[str]]:
        db_name, db_path = _validate_db_name(self.dispatcher.public_dir, db)
        if db_name not in SENSORTOWER_DBS:
            raise ValueError("仅允许查询 SensorTower 数据库")
        prepared, _ = _prepare_readonly_sql(sql)
        return _execute_readonly_query(db_path, prepared, limit, params=params)

    def _latest_value(self, db: str, table: str, column: str, where: str = "", params: tuple[Any, ...] = ()) -> str:
        sql = f"SELECT DISTINCT {column} AS value FROM {table} {where} ORDER BY {column} DESC"
        rows, _ = self._query(db, sql, params, 1)
        return _clean(rows[0].get("value")) if rows else ""

    def top_ranking(self, args: dict[str, Any]) -> dict[str, Any]:
        platform = _platform(args.get("platform"))
        table = _top_table(platform)
        country = _clean(args.get("country")) or "US"
        chart_type = _clean(args.get("chartType")) or _clean(args.get("chart_type")) or "free"
        limit = _limit(args.get("limit"), 20, 50)
        period = _clean(args.get("period"))
        if period in {"", "latest", "recent", "this_week"}:
            period = self._latest_value(
                TOP100_DB,
                table,
                "rank_date",
                "WHERE country = ? AND chart_type = ?",
                (country, chart_type),
            )
        rows, _ = self._query(
            TOP100_DB,
            f"""
            SELECT rank, app_name, app_id, downloads, revenue
            FROM {table}
            WHERE rank_date = ? AND country = ? AND chart_type = ?
            ORDER BY rank ASC
            """,
            (period, country, chart_type),
            limit,
        )
        return {
            "output": "table_card",
            "title": f"SensorTower {platform.upper() if platform == 'ios' else 'Android'} {country} {chart_type} Top {limit}",
            "cutoff": period,
            "rows": rows,
            "columns": _rows_to_columns(rows, {
                "rank": "排名",
                "app_name": "游戏",
                "app_id": "App ID",
                "downloads": "下载",
                "revenue": "收入",
            }),
            "truncated": len(rows) >= limit,
        }

    def rank_changes(self, args: dict[str, Any]) -> dict[str, Any]:
        platform = _platform(args.get("platform"))
        country = _clean(args.get("country")) or "US"
        direction = _clean(args.get("direction")).lower()
        limit = _limit(args.get("limit"), 20, 50)
        period = _clean(args.get("period"))
        if period in {"", "latest", "recent", "this_week"}:
            period = self._latest_value(
                TOP100_DB,
                "rank_changes",
                "rank_date_current",
                "WHERE country = ? AND lower(platform) = ?",
                (country, platform),
            )
        where = "WHERE rank_date_current = ? AND country = ? AND lower(platform) = ?"
        params: list[Any] = [period, country, platform]
        if direction:
            where += " AND lower(change_type) = ?"
            params.append(direction)
        rows, _ = self._query(
            TOP100_DB,
            f"""
            SELECT app_name, current_rank, last_week_rank, change, change_type, publisher_name, downloads, revenue
            FROM rank_changes
            {where}
            ORDER BY current_rank ASC
            """,
            tuple(params),
            limit,
        )
        comparison = self._latest_value(
            TOP100_DB,
            "rank_changes",
            "rank_date_last",
            "WHERE rank_date_current = ? AND country = ? AND lower(platform) = ?",
            (period, country, platform),
        )
        return {
            "output": "table_card",
            "title": f"SensorTower {platform} {country} 排名异动",
            "cutoff": period,
            "comparisonPeriod": comparison,
            "rows": rows,
            "columns": _rows_to_columns(rows, {
                "app_name": "游戏",
                "current_rank": "当前排名",
                "last_week_rank": "上期排名",
                "change": "变化",
                "change_type": "类型",
                "publisher_name": "发行商",
                "downloads": "下载",
                "revenue": "收入",
            }),
            "truncated": len(rows) >= limit,
        }

    def weekly_sales_trend(self, args: dict[str, Any]) -> dict[str, Any]:
        app_id = _clean(args.get("appId") or args.get("app_id"))
        platform = _platform(args.get("platform"))
        country = _clean(args.get("country")) or "US"
        metric = _clean(args.get("metric")).lower() or "downloads"
        if metric not in {"downloads", "revenue"}:
            metric = "downloads"
        limit = _limit(args.get("limit"), 8, 52)
        if not app_id:
            raise ValueError("appId 不能为空")
        rows, _ = self._query(
            APPLIST_DB,
            """
            SELECT week_start, downloads, revenue
            FROM app_list_weekly_sales
            WHERE app_id = ? AND lower(platform) = ? AND country = ?
            ORDER BY week_start DESC
            """,
            (app_id, platform, country),
            limit,
        )
        rows = list(reversed(rows))
        cutoff = _clean(rows[-1].get("week_start")) if rows else ""
        title = f"SensorTower {app_id} {country} {metric} trend"
        self.dispatcher.chart_payloads.append({
            "type": "line",
            "title": title,
            "xKey": "week_start",
            "series": [{"key": metric, "name": "下载" if metric == "downloads" else "收入"}],
            "data": rows,
        })
        return {
            "output": "chart_png",
            "title": title,
            "cutoff": cutoff,
            "rows": rows,
            "columns": _rows_to_columns(rows, {"week_start": "周", "downloads": "下载", "revenue": "收入"}),
            "truncated": len(rows) >= limit,
        }

    def removed_games(self, args: dict[str, Any]) -> dict[str, Any]:
        platform = _platform(args.get("platform"))
        country = _clean(args.get("country")) or "US"
        limit = _limit(args.get("limit"), 20, 50)
        period = _clean(args.get("period"))
        if period in {"", "latest", "recent", "this_week"}:
            period = self._latest_value(
                TOP100_DB,
                "weekly_removed_games",
                "rank_date",
                "WHERE country = ? AND lower(os) = ?",
                (country, platform),
            )
        rows, _ = self._query(
            TOP100_DB,
            """
            SELECT app_name, app_id, http_status, reason, store_url
            FROM weekly_removed_games
            WHERE rank_date = ? AND country = ? AND lower(os) = ? AND removed = 1
            ORDER BY app_name ASC
            """,
            (period, country, platform),
            limit,
        )
        return {
            "output": "table_card",
            "title": f"SensorTower {platform} {country} 下架检测",
            "cutoff": period,
            "rows": rows,
            "columns": _rows_to_columns(rows, {
                "app_name": "游戏",
                "app_id": "App ID",
                "http_status": "状态码",
                "reason": "原因",
                "store_url": "链接",
            }),
            "truncated": len(rows) >= limit,
        }

    def top5_overview(self, args: dict[str, Any]) -> dict[str, Any]:
        limit = _limit(args.get("limit"), 1, 10)
        rows, _ = self._query(
            TOP100_DB,
            """
            SELECT rank_date, statement, trend_json
            FROM weekly_top5_overview
            ORDER BY rank_date DESC
            """,
            (),
            limit,
        )
        cutoff = _clean(rows[0].get("rank_date")) if rows else ""
        return {
            "output": "text_only",
            "title": "SensorTower Top5 周度总览",
            "cutoff": cutoff,
            "rows": rows,
            "columns": _rows_to_columns(rows, {"rank_date": "日期", "statement": "总结", "trend_json": "趋势"}),
            "truncated": len(rows) >= limit,
        }

    def fallback_sql(self, args: dict[str, Any]) -> dict[str, Any]:
        db = _clean(args.get("db"))
        if db not in SENSORTOWER_DBS:
            raise ValueError("仅允许查询 SensorTower 数据库")
        sql = _clean(args.get("sql"))
        limit = _limit(args.get("limit"), 50, 100)
        db_name, db_path = _validate_db_name(self.dispatcher.public_dir, db)
        prepared, _ = _prepare_readonly_sql(sql, allow_pragma_table_info=False)
        rows, cols = _execute_readonly_query(db_path, prepared, limit)
        return {
            "output": "table_card",
            "title": "SensorTower 自定义查询",
            "cutoff": "",
            "rows": rows,
            "columns": [{"key": col, "label": col} for col in cols],
            "truncated": len(rows) >= limit,
        }
```

- [ ] **Step 5: Run tests and verify they pass**

Run:

```bash
python -m pytest backend/test_sensortower_tools.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/sensortower_tools.py backend/test_sensortower_tools.py backend/ai_tools.py
git commit -m "feat: add sensortower semantic query tools"
```

---

### Task 2: Register `sensortower_query` In The Agent Tool Dispatcher

**Files:**
- Modify: `backend/ai_tools.py`
- Modify: `backend/assistant_service.py`
- Test: `backend/test_sensortower_tools.py`
- Test: `backend/test_assistant_routing.py`

- [ ] **Step 1: Write failing dispatcher and routing tests**

Append to `backend/test_sensortower_tools.py`:

```python
def test_dispatcher_routes_sensortower_query_and_collects_table(tmp_path):
    public = tmp_path / "public"
    public.mkdir()
    _create_top100_db(public / "sensortower_top100.db")
    _create_applist_db(public / "sensortower_applist.db")
    AgentToolDispatcher.invalidate_schema_cache()
    dispatcher = AgentToolDispatcher(public, "", True, False)

    result = dispatcher.sensortower_query({"operation": "top_ranking", "platform": "ios", "country": "US", "limit": 2})

    assert result["output"] == "table_card"
    assert dispatcher.table_payloads[-1]["title"] == result["title"]
    AgentToolDispatcher.invalidate_schema_cache()
```

Append to `backend/test_assistant_routing.py`:

```python
def test_casual_sensortower_prompt_includes_semantic_tool_guidance():
    system, selected = build_system_content(
        "SensorTower 最新美国免费榜 Top20",
        None,
        channel="feishu_casual_group",
    )

    assert "sensortower_top100.db" in selected
    assert "sensortower_query" in system
    assert "飞书群消息卡片表格" in system
    assert "只读 SQL 兜底" in system
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
python -m pytest backend/test_sensortower_tools.py::test_dispatcher_routes_sensortower_query_and_collects_table backend/test_assistant_routing.py::test_casual_sensortower_prompt_includes_semantic_tool_guidance -q
```

Expected: FAIL because dispatcher has no `sensortower_query`, no `table_payloads`, and prompt lacks new guidance.

- [ ] **Step 3: Add dispatcher table storage and `sensortower_query`**

In `backend/ai_tools.py`, import the semantic tool lazily to avoid circular imports and add table storage:

```python
class AgentToolDispatcher:
    ...
    def __init__(
        self,
        public_dir: Path,
        tavily_api_key: str = "",
        enable_db_tool: bool = True,
        enable_web_search_tool: bool = True,
    ) -> None:
        ...
        self.chart_payloads: list[dict[str, Any]] = []
        self.table_payloads: list[dict[str, Any]] = []
        ...

    async def dispatch(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        if tool_name == "sensortower_query" and self.enable_db_tool:
            return self.sensortower_query(args)
        ...

    def sensortower_query(self, args: dict[str, Any]) -> dict[str, Any]:
        from sensortower_tools import SensorTowerQueryTools

        result = SensorTowerQueryTools(self).run(args)
        if result.get("output") == "table_card":
            self.table_payloads.append({
                "title": result.get("title") or "SensorTower 查询结果",
                "cutoff": result.get("cutoff") or "",
                "comparisonPeriod": result.get("comparisonPeriod") or "",
                "columns": result.get("columns") or [],
                "rows": result.get("rows") or [],
                "truncated": bool(result.get("truncated")),
            })
        return result
```

- [ ] **Step 4: Expose `sensortower_query` in OpenRouter tool schema**

In `openai_style_tools_schema()` before `query_and_chart`, add:

```python
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": "sensortower_query",
                    "description": (
                        "SensorTower 专用语义查询工具。优先用它回答 SensorTower 本地数据库支持的问题。"
                        "常见 operation: top_ranking, rank_changes, weekly_sales_trend, removed_games, top5_overview, fallback_sql。"
                        "表格型结果会由系统发成飞书群消息卡片表格；趋势结果会生成 PNG 图。"
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "operation": {"type": "string"},
                            "platform": {"type": "string", "description": "ios 或 android"},
                            "country": {"type": "string", "description": "国家代码，默认 US"},
                            "chartType": {"type": "string", "description": "榜单类型，默认 free"},
                            "period": {"type": "string", "description": "latest 或具体日期"},
                            "limit": {"type": "integer", "description": "返回行数"},
                            "direction": {"type": "string", "description": "rank_changes 可用 rise/fall/new/dropped"},
                            "appId": {"type": "string", "description": "app id 或 package id"},
                            "metric": {"type": "string", "description": "downloads 或 revenue"},
                            "db": {"type": "string", "description": "fallback_sql 专用，只允许 SensorTower db"},
                            "sql": {"type": "string", "description": "fallback_sql 专用，只读 SELECT/WITH SQL"},
                        },
                        "required": ["operation"],
                    },
                },
            }
        )
```

- [ ] **Step 5: Add SensorTower prompt guidance and return table payloads**

In `backend/assistant_service.py`, update `AssistantResult`:

```python
@dataclass
class AssistantResult:
    answer: str
    charts: list[dict[str, Any]] = field(default_factory=list)
    tables: list[dict[str, Any]] = field(default_factory=list)
    selected_dbs: list[str] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
```

In `CASUAL_SOURCE_DBS`, include the applist database:

```python
CASUAL_SOURCE_DBS: dict[str, tuple[str, ...]] = {
    "wechat_douyin": ("wechatdouyin.db",),
    "sensortower": ("sensortower_top100.db", "sensortower_applist.db"),
    "competitor": ("competitor_data.db",),
    "our_product": ("us_free_appid_weekly.db",),
}
```

In the Feishu casual SensorTower system prompt block, add:

```python
            "\n- SensorTower 问题优先用 sensortower_query；它是受控 SQL 模板 + 参数规范 + 输出策略，不是外部实时抓取。"
            "\n- SensorTower 表格型结果会由系统发成飞书群消息卡片表格；趋势/对比结果会生成 PNG 图。"
            "\n- SensorTower 未封装但库内支持的问题，可用 sensortower_query(operation=fallback_sql) 做只读 SQL 兜底；不要向用户暴露 SQL、表名或内部路径。"
```

In `chat_via_openrouter()` return:

```python
    return AssistantResult(
        answer=answer,
        charts=dispatcher.chart_payloads,
        tables=dispatcher.table_payloads,
        selected_dbs=selected_dbs,
        tool_calls=tool_calls,
    )
```

Apply the same `tables=dispatcher.table_payloads` return behavior in `chat_via_openai()` or any other provider path that constructs `AssistantResult` from the dispatcher.

- [ ] **Step 6: Run focused tests**

Run:

```bash
python -m pytest backend/test_sensortower_tools.py backend/test_assistant_routing.py::test_casual_sensortower_prompt_includes_semantic_tool_guidance -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/ai_tools.py backend/assistant_service.py backend/sensortower_tools.py backend/test_sensortower_tools.py backend/test_assistant_routing.py
git commit -m "feat: register sensortower semantic tool"
```

---

### Task 3: Feishu Group Table Card Builder

**Files:**
- Create: `backend/feishu_cards.py`
- Test: `backend/test_feishu_cards.py`

- [ ] **Step 1: Write failing card-builder tests**

Create `backend/test_feishu_cards.py`:

```python
from __future__ import annotations

from feishu_cards import build_table_card, sanitize_cell


def test_sanitize_cell_removes_newlines_and_limits_length():
    assert sanitize_cell("a\nb", max_chars=10) == "a b"
    assert sanitize_cell("abcdef", max_chars=4) == "abc…"


def test_build_table_card_uses_feishu_table_component():
    card = build_table_card(
        {
            "title": "SensorTower iOS US free Top 2",
            "cutoff": "2026-06-01",
            "columns": [
                {"key": "rank", "label": "排名"},
                {"key": "app_name", "label": "游戏"},
            ],
            "rows": [
                {"rank": 1, "app_name": "Royal Match"},
                {"rank": 2, "app_name": "Block Blast"},
            ],
        }
    )

    assert card["config"]["wide_screen_mode"] is True
    assert card["header"]["title"]["content"] == "SensorTower iOS US free Top 2"
    table = card["elements"][1]
    assert table["tag"] == "table"
    assert table["columns"][0]["display_name"] == "排名"
    assert table["rows"][0]["app_name"] == "Royal Match"


def test_build_table_card_marks_truncated_results():
    rows = [{"rank": idx, "app_name": f"Game {idx}"} for idx in range(1, 8)]
    card = build_table_card(
        {
            "title": "Big Result",
            "cutoff": "2026-06-01",
            "truncated": True,
            "columns": [{"key": "rank", "label": "排名"}, {"key": "app_name", "label": "游戏"}],
            "rows": rows,
        },
        max_rows=5,
    )

    assert len(card["elements"][1]["rows"]) == 5
    assert "已截断" in card["elements"][2]["content"]
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
python -m pytest backend/test_feishu_cards.py -q
```

Expected: FAIL because `feishu_cards` does not exist.

- [ ] **Step 3: Implement card builder**

Create `backend/feishu_cards.py`:

```python
"""Feishu card builders for assistant visual outputs."""
from __future__ import annotations

from typing import Any


def sanitize_cell(value: Any, *, max_chars: int = 80) -> str:
    text = str(value if value is not None else "").replace("\r", " ").replace("\n", " ").strip()
    text = " ".join(text.split())
    if len(text) <= max_chars:
        return text
    return text[: max(1, max_chars - 1)] + "…"


def _columns(payload: dict[str, Any], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    raw_columns = payload.get("columns")
    if isinstance(raw_columns, list) and raw_columns:
        pairs = [
            (str(col.get("key") or "").strip(), str(col.get("label") or col.get("key") or "").strip())
            for col in raw_columns
            if isinstance(col, dict) and str(col.get("key") or "").strip()
        ]
    else:
        keys: list[str] = []
        for row in rows:
            for key in row.keys():
                if key not in keys:
                    keys.append(key)
        pairs = [(key, key) for key in keys]

    return [
        {
            "name": key,
            "display_name": sanitize_cell(label or key, max_chars=18),
            "data_type": "text",
            "horizontal_align": "left",
            "vertical_align": "top",
            "width": "auto",
        }
        for key, label in pairs[:8]
    ]


def build_table_card(payload: dict[str, Any], *, max_rows: int = 20) -> dict[str, Any]:
    title = sanitize_cell(payload.get("title") or "SensorTower 查询结果", max_chars=80)
    cutoff = sanitize_cell(payload.get("cutoff") or "", max_chars=40)
    comparison = sanitize_cell(payload.get("comparisonPeriod") or "", max_chars=40)
    raw_rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    rows = [row for row in raw_rows if isinstance(row, dict)]
    columns = _columns(payload, rows)
    col_keys = [col["name"] for col in columns]
    limited_rows = rows[:max_rows]
    table_rows = [
        {key: sanitize_cell(row.get(key), max_chars=120) for key in col_keys}
        for row in limited_rows
    ]
    if not table_rows:
        table_rows = [{columns[0]["name"] if columns else "empty": "无数据"}] if columns else [{"empty": "无数据"}]
        if not columns:
            columns = [{"name": "empty", "display_name": "结果", "data_type": "text", "width": "auto"}]

    intro_parts = []
    if cutoff:
        intro_parts.append(f"数据截止：{cutoff}")
    if comparison:
        intro_parts.append(f"对比期：{comparison}")
    intro = " · ".join(intro_parts) or "SensorTower 本地数据库结果"

    elements: list[dict[str, Any]] = [
        {"tag": "markdown", "content": intro},
        {
            "tag": "table",
            "page_size": min(10, max(1, len(table_rows))),
            "row_height": "low",
            "freeze_first_column": True,
            "header_style": {
                "text_align": "left",
                "text_size": "normal",
                "background_style": "grey",
                "text_color": "default",
                "bold": True,
                "lines": 1,
            },
            "columns": columns,
            "rows": table_rows,
        },
    ]
    if payload.get("truncated") or len(rows) > len(limited_rows):
        elements.append({"tag": "markdown", "content": f"结果已截断，仅展示前 {len(limited_rows)} 行。可继续指定平台、国家、游戏或时间范围缩小结果。"})

    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "template": "turquoise",
            "title": {"tag": "plain_text", "content": title},
        },
        "elements": elements,
    }
```

- [ ] **Step 4: Run tests**

Run:

```bash
python -m pytest backend/test_feishu_cards.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/feishu_cards.py backend/test_feishu_cards.py
git commit -m "feat: build feishu table cards"
```

---

### Task 4: Feishu Interactive Card Reply Path

**Files:**
- Modify: `backend/feishu_bot.py`
- Modify: `backend/casual_feishu_agent.py`
- Modify: `backend/test_casual_feishu_agent.py`

- [ ] **Step 1: Write failing tests for interactive card reply and casual-agent table sending**

Append to `backend/test_casual_feishu_agent.py`:

```python
def test_casual_feishu_sends_table_cards_after_text(monkeypatch, tmp_path):
    main = load_main(
        monkeypatch,
        tmp_path,
        CASUAL_FEISHU_BOT_ENABLED="true",
        CASUAL_FEISHU_VERIFICATION_TOKEN="verify-token",
        CASUAL_FEISHU_BOT_MENTION_NAMES="休闲监测助手",
        CASUAL_FEISHU_ASSISTANT_SEND_THINKING="false",
        OPENAI_API_KEY="test-key",
    )
    replies: list[str] = []
    cards: list[dict[str, Any]] = []

    class Result:
        answer = "最新榜单已经回收完毕。"
        charts = []
        tables = [
            {
                "title": "SensorTower iOS US free Top 2",
                "cutoff": "2026-06-01",
                "columns": [{"key": "rank", "label": "排名"}, {"key": "app_name", "label": "游戏"}],
                "rows": [{"rank": 1, "app_name": "Royal Match"}],
            }
        ]

    async def fake_run(user_text, history=None, page_context=None, *, channel="web", on_tool_call=None):
        return Result()

    async def fake_reply(message_id: str, text: str, *, uuid_prefix: str | None = None) -> None:
        replies.append(text)

    async def fake_card(message_id: str, card: dict[str, Any], *, uuid_prefix: str | None = None) -> None:
        cards.append(card)

    pending = _patch_immediate_create_task(monkeypatch, main)
    monkeypatch.setattr(main, "run_monitor_assistant", fake_run)
    monkeypatch.setattr(main._casual_feishu_bot_client, "reply_text", fake_reply)
    monkeypatch.setattr(main._casual_feishu_bot_client, "reply_interactive_card", fake_card)
    client = TestClient(main.app)

    response = client.post(
        "/api/feishu/casual-agent/events",
        json=event_payload(
            chat_type="group",
            text="@休闲监测助手 SensorTower 最新美国 iOS 免费榜 Top2",
            mentions=[{"key": "@_user_1", "name": "休闲监测助手"}],
        ),
    )
    _run_pending_tasks(pending)

    assert response.status_code == 200
    assert replies[-1] == "最新榜单已经回收完毕。"
    assert cards
    assert cards[0]["elements"][1]["tag"] == "table"
```

Create a focused unit test in the same file for `FeishuBotClient.reply_interactive_card` by monkeypatching `tenant_access_token` and `httpx.AsyncClient` only if the repo already has similar patterns. If not, keep coverage at the casual-agent layer to avoid brittle HTTP mocks.

- [ ] **Step 2: Run failing test**

Run:

```bash
python -m pytest backend/test_casual_feishu_agent.py::test_casual_feishu_sends_table_cards_after_text -q
```

Expected: FAIL because `reply_interactive_card` does not exist and casual agent does not send tables.

- [ ] **Step 3: Add `reply_interactive_card()` to Feishu client**

In `backend/feishu_bot.py`, add to `FeishuBotClient`:

```python
    async def reply_interactive_card(
        self,
        message_id: str,
        card: dict[str, Any],
        *,
        uuid_prefix: str | None = None,
    ) -> None:
        token = await self.tenant_access_token()
        prefix = uuid_prefix or message_id or str(uuid.uuid4())
        payload = {
            "msg_type": "interactive",
            "content": json.dumps(card, ensure_ascii=False),
            "reply_in_thread": True,
            "uuid": _stable_uuid(f"{prefix}:interactive:{json.dumps(card, ensure_ascii=False)[:120]}"),
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/reply",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
            )
        if r.status_code >= 400:
            raise FeishuEventError(f"飞书卡片回复 HTTP {r.status_code}: {r.text[:1000]}")
        data = r.json()
        if data.get("code") != 0:
            raise FeishuEventError(f"飞书卡片回复失败: code={data.get('code')} msg={data.get('msg')}")
```

- [ ] **Step 4: Send table cards from the casual Feishu agent**

In `backend/casual_feishu_agent.py`, import the builder:

```python
from feishu_cards import build_table_card
```

In `_reply_result()`, after `reply_text()` and before chart rendering, add:

```python
        table_count = 0
        table_errors = 0
        tables = getattr(result, "tables", []) or []
        for idx, table_payload in enumerate(tables):
            if not isinstance(table_payload, dict):
                continue
            try:
                card = build_table_card(table_payload)
                await self.bot_client.reply_interactive_card(
                    event.message_id,
                    card,
                    uuid_prefix=f"{uuid_prefix}:casual-table:{idx}",
                )
                table_count += 1
            except Exception as table_err:
                table_errors += 1
                print("[casual-feishu-table]", str(table_err)[:500])
        if tables and table_count == 0:
            await self.bot_client.reply_text(
                event.message_id,
                "📋 表格卡带这次没能成功上屏，我先把文字结论交给你。可以缩小平台、国家、时间或游戏名再问一局。",
                uuid_prefix=f"{uuid_prefix}:casual-table-fallback",
            )
        elif table_errors:
            print("[casual-feishu-table]", {"sent": table_count, "failed": table_errors})
```

- [ ] **Step 5: Run focused test**

Run:

```bash
python -m pytest backend/test_casual_feishu_agent.py::test_casual_feishu_sends_table_cards_after_text -q
```

Expected: PASS.

- [ ] **Step 6: Run all casual Feishu tests**

Run:

```bash
python -m pytest backend/test_casual_feishu_agent.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/feishu_bot.py backend/casual_feishu_agent.py backend/test_casual_feishu_agent.py
git commit -m "feat: send sensortower table cards in feishu"
```

---

### Task 5: Complete SensorTower Coverage And Prompt Routing

**Files:**
- Modify: `backend/sensortower_tools.py`
- Modify: `backend/test_sensortower_tools.py`
- Modify: `backend/test_assistant_routing.py`

- [ ] **Step 1: Add failing tests for remaining current DB surfaces**

Extend the temporary fixture tables in `backend/test_sensortower_tools.py` to include:

```python
    conn.execute(
        """
        CREATE TABLE app_metadata (
            app_id TEXT,
            os TEXT,
            name TEXT,
            publisher_name TEXT,
            rating TEXT,
            humanized_worldwide_last_month_downloads TEXT,
            humanized_worldwide_last_month_revenue TEXT,
            PRIMARY KEY (app_id, os)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE appstoreinfo_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_id TEXT NOT NULL,
            rank_date TEXT,
            changed_at TEXT,
            changes_json TEXT,
            old_data_json TEXT,
            new_data_json TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE weekly_metadata_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rank_date TEXT NOT NULL,
            app_id TEXT NOT NULL,
            os TEXT NOT NULL,
            app_name TEXT,
            changed_fields TEXT,
            old_values TEXT,
            new_values TEXT
        )
        """
    )
    conn.execute(
        "INSERT INTO app_metadata(app_id, os, name, publisher_name, rating, humanized_worldwide_last_month_downloads, humanized_worldwide_last_month_revenue) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("ios_a", "ios", "Block Blast", "Hungry", "4.8", "10M", "$100k"),
    )
    conn.execute(
        "INSERT INTO appstoreinfo_changes(app_id, rank_date, changed_at, changes_json, old_data_json, new_data_json) VALUES (?, ?, ?, ?, ?, ?)",
        ("ios_a", "2026-06-01", "2026-06-02", '{"subtitle": true}', '{"subtitle": "old"}', '{"subtitle": "new"}'),
    )
    conn.execute(
        "INSERT INTO weekly_metadata_changes(rank_date, app_id, os, app_name, changed_fields, old_values, new_values) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("2026-06-01", "ios_a", "ios", "Block Blast", "subtitle", '{"subtitle":"old"}', '{"subtitle":"new"}'),
    )
```

Append tests:

```python
def test_game_lookup_store_changes_metadata_changes_and_ai_summary(tools):
    lookup = tools.run({"operation": "game_lookup", "appId": "ios_a", "platform": "ios"})
    store_changes = tools.run({"operation": "store_changes", "appId": "ios_a", "platform": "ios", "limit": 5})
    metadata_changes = tools.run({"operation": "metadata_changes", "appId": "ios_a", "platform": "ios", "limit": 5})
    summary = tools.run({"operation": "applist_summary", "appId": "ios_a", "platform": "ios"})

    assert lookup["output"] == "table_card"
    assert lookup["rows"][0]["name"] == "Block Blast"
    assert store_changes["rows"][0]["app_id"] == "ios_a"
    assert metadata_changes["rows"][0]["changed_fields"] == "subtitle"
    assert summary["output"] == "text_only"
    assert summary["rows"][0]["summary_md"] == "Block Blast summary"
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
python -m pytest backend/test_sensortower_tools.py::test_game_lookup_store_changes_metadata_changes_and_ai_summary -q
```

Expected: FAIL because the operations do not exist.

- [ ] **Step 3: Implement remaining operations**

In `SensorTowerQueryTools.run()`, add:

```python
        if op == "game_lookup":
            return self.game_lookup(args)
        if op == "store_changes":
            return self.store_changes(args)
        if op == "metadata_changes":
            return self.metadata_changes(args)
        if op == "applist_summary":
            return self.applist_summary(args)
```

Add methods:

```python
    def game_lookup(self, args: dict[str, Any]) -> dict[str, Any]:
        app_id = _clean(args.get("appId") or args.get("app_id"))
        platform = _platform(args.get("platform"))
        if not app_id:
            raise ValueError("appId 不能为空")
        rows, _ = self._query(
            TOP100_DB,
            """
            SELECT app_id, os, name, publisher_name, rating,
                   humanized_worldwide_last_month_downloads,
                   humanized_worldwide_last_month_revenue
            FROM app_metadata
            WHERE app_id = ? AND lower(os) = ?
            """,
            (app_id, platform),
            10,
        )
        return {
            "output": "table_card",
            "title": f"SensorTower {app_id} 游戏信息",
            "cutoff": "",
            "rows": rows,
            "columns": _rows_to_columns(rows, {
                "app_id": "App ID",
                "os": "平台",
                "name": "游戏",
                "publisher_name": "发行商",
                "rating": "评分",
                "humanized_worldwide_last_month_downloads": "上月下载",
                "humanized_worldwide_last_month_revenue": "上月收入",
            }),
            "truncated": False,
        }

    def store_changes(self, args: dict[str, Any]) -> dict[str, Any]:
        app_id = _clean(args.get("appId") or args.get("app_id"))
        platform = _platform(args.get("platform"))
        table = "appstoreinfo_changes" if platform == "ios" else "gamestoreinfo_changes"
        limit = _limit(args.get("limit"), 10, 50)
        where = ""
        params: list[Any] = []
        if app_id:
            where = "WHERE app_id = ?"
            params.append(app_id)
        rows, _ = self._query(
            TOP100_DB,
            f"""
            SELECT rank_date, app_id, changed_at, changes_json
            FROM {table}
            {where}
            ORDER BY COALESCE(rank_date, changed_at) DESC
            """,
            tuple(params),
            limit,
        )
        cutoff = _clean(rows[0].get("rank_date") or rows[0].get("changed_at")) if rows else ""
        return {
            "output": "table_card",
            "title": f"SensorTower {platform} 商店页变化",
            "cutoff": cutoff,
            "rows": rows,
            "columns": _rows_to_columns(rows, {
                "rank_date": "日期",
                "app_id": "App ID",
                "changed_at": "检测时间",
                "changes_json": "变化",
            }),
            "truncated": len(rows) >= limit,
        }

    def metadata_changes(self, args: dict[str, Any]) -> dict[str, Any]:
        app_id = _clean(args.get("appId") or args.get("app_id"))
        platform = _platform(args.get("platform"))
        limit = _limit(args.get("limit"), 10, 50)
        where = "WHERE lower(os) = ?"
        params: list[Any] = [platform]
        if app_id:
            where += " AND app_id = ?"
            params.append(app_id)
        rows, _ = self._query(
            TOP100_DB,
            f"""
            SELECT rank_date, app_name, app_id, os, changed_fields, old_values, new_values
            FROM weekly_metadata_changes
            {where}
            ORDER BY rank_date DESC
            """,
            tuple(params),
            limit,
        )
        cutoff = _clean(rows[0].get("rank_date")) if rows else ""
        return {
            "output": "table_card",
            "title": f"SensorTower {platform} 周度元数据变化",
            "cutoff": cutoff,
            "rows": rows,
            "columns": _rows_to_columns(rows, {
                "rank_date": "日期",
                "app_name": "游戏",
                "app_id": "App ID",
                "os": "平台",
                "changed_fields": "变化字段",
                "old_values": "旧值",
                "new_values": "新值",
            }),
            "truncated": len(rows) >= limit,
        }

    def applist_summary(self, args: dict[str, Any]) -> dict[str, Any]:
        app_id = _clean(args.get("appId") or args.get("app_id"))
        platform = _platform(args.get("platform"))
        if not app_id:
            raise ValueError("appId 不能为空")
        rows, _ = self._query(
            APPLIST_DB,
            """
            SELECT week_start, app_id, platform, summary_md
            FROM applist_ai_summary
            WHERE app_id = ? AND lower(platform) = ?
            ORDER BY week_start DESC
            """,
            (app_id, platform),
            5,
        )
        cutoff = _clean(rows[0].get("week_start")) if rows else ""
        return {
            "output": "text_only",
            "title": f"SensorTower {app_id} 周度 AI 摘要",
            "cutoff": cutoff,
            "rows": rows,
            "columns": _rows_to_columns(rows, {"week_start": "周", "summary_md": "摘要"}),
            "truncated": len(rows) >= 5,
        }
```

- [ ] **Step 4: Update OpenRouter tool schema operation description**

In `backend/ai_tools.py`, extend the `sensortower_query` description:

```python
"常见 operation: top_ranking, rank_changes, weekly_sales_trend, removed_games, top5_overview, game_lookup, store_changes, metadata_changes, applist_summary, fallback_sql。"
```

- [ ] **Step 5: Run full SensorTower and routing tests**

Run:

```bash
python -m pytest backend/test_sensortower_tools.py backend/test_assistant_routing.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/sensortower_tools.py backend/test_sensortower_tools.py backend/ai_tools.py backend/test_assistant_routing.py
git commit -m "feat: cover sensortower database surfaces"
```

---

### Task 6: End-To-End Verification And Documentation Notes

**Files:**
- Modify: `docs/休闲游戏飞书Agent配置指南.md`
- Test: existing backend tests

- [ ] **Step 1: Add documentation note for SensorTower group output**

In `docs/休闲游戏飞书Agent配置指南.md`, add a short section under the capability list:

```markdown
### SensorTower 群聊问数输出

SensorTower 问数优先读取本地数据库，不默认访问外部 SensorTower API。

- 表格型结果：机器人回复飞书群消息卡片表格，例如 TopN、排名异动、商店页变化、下架检测。
- 趋势/对比型结果：机器人生成 PNG 图并回复到同一线程，例如排名趋势、下载趋势、收入趋势。
- “最新 / 最近 / 本周”以数据库最新可用期为准；“上周 / 环比 / 变化”以最新可用期对比上一可用期。
- 机器人不会在群里暴露 SQL、数据库表名、内部路径或密钥。
```

- [ ] **Step 2: Run backend focused test suite**

Run:

```bash
python -m pytest backend/test_sensortower_tools.py backend/test_feishu_cards.py backend/test_casual_feishu_agent.py backend/test_assistant_routing.py -q
```

Expected: PASS.

- [ ] **Step 3: Run all backend tests**

Run:

```bash
python -m pytest backend -q
```

Expected: PASS, except tests marked skipped due to missing external keys should remain skipped.

- [ ] **Step 4: Optional live-free smoke script**

Run a no-network smoke in Python:

```bash
python - <<'PY'
from pathlib import Path
from ai_tools import AgentToolDispatcher
from sensortower_tools import SensorTowerQueryTools
from config import PUBLIC_DIR

dispatcher = AgentToolDispatcher(PUBLIC_DIR, "", True, False)
tools = SensorTowerQueryTools(dispatcher)
print(tools.run({"operation": "top_ranking", "platform": "ios", "country": "US", "limit": 5})["title"])
print("tables", len(dispatcher.table_payloads), "charts", len(dispatcher.chart_payloads))
PY
```

Expected: prints a SensorTower title and does not raise.

- [ ] **Step 5: Commit docs and final verification state**

```bash
git add docs/休闲游戏飞书Agent配置指南.md
git commit -m "docs: document sensortower feishu group outputs"
```

---

## Self-Review Checklist

- Spec coverage:
  - SensorTower-only local DB scope is covered by `SENSORTOWER_DBS`, prompt guidance, and fallback rejection tests.
  - Semantic tools are covered by `sensortower_query` operations.
  - Read-only SQL fallback is covered by `fallback_sql` restrictions and hidden-SQL result assertions.
  - Feishu group-message table cards are covered by `feishu_cards.py` and casual-agent send tests.
  - Trend PNG behavior is covered by `weekly_sales_trend` registering chart payloads.
  - Data cutoff and comparison metadata are included in semantic tool envelopes and cards.

- Placeholders:
  - No `TBD`, `TODO`, or “implement later” steps remain.
  - Each implementation step names exact files and includes concrete code.

- Type consistency:
  - `AssistantResult.tables` is a `list[dict[str, Any]]`.
  - `AgentToolDispatcher.table_payloads` stores card-ready dictionaries.
  - `build_table_card(payload)` accepts the same keys returned by semantic tools.
  - `reply_interactive_card(message_id, card, uuid_prefix=...)` matches the casual-agent call.
