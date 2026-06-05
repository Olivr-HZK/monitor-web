"""SensorTower semantic query tool tests."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from ai_tools import AgentToolDispatcher
from sensortower_tools import SensorTowerQueryTools


@pytest.fixture
def sensortower_public_dir(tmp_path: Path) -> Path:
    public = tmp_path / "public"
    public.mkdir()

    top100 = public / "sensortower_top100.db"
    conn = sqlite3.connect(top100)
    conn.execute(
        """
        CREATE TABLE apple_top100 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rank_date TEXT,
            country TEXT,
            chart_type TEXT,
            rank INTEGER,
            app_id TEXT,
            app_name TEXT,
            created_at TEXT,
            country_display TEXT,
            chart_type_display TEXT,
            downloads REAL,
            revenue REAL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE android_top100 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rank_date TEXT,
            country TEXT,
            chart_type TEXT,
            rank INTEGER,
            app_id TEXT,
            app_name TEXT,
            created_at TEXT,
            country_display TEXT,
            chart_type_display TEXT,
            downloads REAL,
            revenue REAL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE rank_changes (
            rank_date_current TEXT,
            rank_date_last TEXT,
            signal TEXT,
            app_name TEXT,
            app_id TEXT,
            country TEXT,
            platform TEXT,
            current_rank INTEGER,
            last_week_rank TEXT,
            change TEXT,
            change_type TEXT,
            publisher_name TEXT,
            store_url TEXT,
            downloads REAL,
            revenue REAL,
            created_at TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE weekly_removed_games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rank_date TEXT,
            os TEXT,
            country TEXT,
            chart_type TEXT,
            app_id TEXT,
            app_name TEXT,
            store_url TEXT,
            http_status INTEGER,
            removed INTEGER,
            reason TEXT,
            checked_at TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE weekly_top5_overview (
            rank_date TEXT,
            statement TEXT,
            trend_json TEXT,
            model_used TEXT,
            created_at TEXT
        )
        """
    )
    conn.executemany(
        """
        INSERT INTO apple_top100
            (
                rank_date, country, chart_type, rank, app_id, app_name,
                created_at, country_display, chart_type_display, downloads, revenue
            )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            ("2026-06-01", "US", "free", 1, "ios_a", "Royal Match", "2026-06-02", "United States", "Free", 1000, 500),
            ("2026-06-01", "US", "free", 2, "ios_b", "Block Blast", "2026-06-02", "United States", "Free", 900, 450),
            ("2026-06-01", "US", "free", 3, "ios_c", "Whiteout Survival", "2026-06-02", "United States", "Free", 800, 400),
            ("2026-06-01", "US", "free", 4, "ios_d", "Township", "2026-06-02", "United States", "Free", 700, 350),
        ],
    )
    conn.executemany(
        """
        INSERT INTO rank_changes
            (
                rank_date_current, rank_date_last, signal, app_name, app_id, country, platform,
                current_rank, last_week_rank, change, change_type, publisher_name, store_url,
                downloads, revenue, created_at
            )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "2026-06-01", "2026-05-25", "rise", "Royal Match", "ios_a", "🇺🇸 美国", "IOS",
                1, "3", "+2", "rise", "Dream Games", "https://apps.apple.com/app/ios_a",
                1000, 500, "2026-06-02",
            ),
            (
                "2026-06-01", "2026-05-25", "fall", "Block Blast", "ios_b", "🇺🇸 美国", "IOS",
                2, "1", "-1", "fall", "Hungry Studio", "https://apps.apple.com/app/ios_b",
                900, 450, "2026-06-02",
            ),
            (
                "2026-06-01", "2026-05-25", "rise", "Localized Rise", "ios_localized", "🇺🇸 美国", "IOS",
                3, "9", "+6", "📈 排名上升", "Localized Publisher", "https://apps.apple.com/app/ios_localized",
                850, 425, "2026-06-02",
            ),
        ],
    )
    conn.execute(
        """
        INSERT INTO weekly_removed_games
            (rank_date, os, country, chart_type, app_id, app_name, store_url, http_status, removed, reason, checked_at)
        VALUES ('2026-06-01', 'ios', 'US', 'free', 'ios_gone', 'Gone Game', 'https://apps.apple.com/app/ios_gone', 404, 1, 'not_found', '2026-06-02')
        """
    )
    conn.execute(
        """
        INSERT INTO weekly_top5_overview
            (rank_date, statement, trend_json, model_used, created_at)
        VALUES ('2026-06-01', 'Top5 remained puzzle-heavy this week.', '{}', 'test-model', '2026-06-02')
        """
    )
    conn.commit()
    conn.close()

    applist = public / "sensortower_applist.db"
    conn = sqlite3.connect(applist)
    conn.execute(
        """
        CREATE TABLE app_list_weekly_sales (
            week_start TEXT,
            app_id TEXT,
            platform TEXT,
            country TEXT,
            downloads INTEGER,
            revenue INTEGER
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE applist_ai_summary (
            week_start TEXT,
            app_id TEXT,
            platform TEXT,
            summary_md TEXT,
            created_at TEXT
        )
        """
    )
    conn.executemany(
        """
        INSERT INTO app_list_weekly_sales
            (week_start, app_id, platform, country, downloads, revenue)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            ("2026-04-13", "ios_a", "ios", "US", 500, 50),
            ("2026-04-20", "ios_a", "ios", "US", 650, 60),
            ("2026-04-27", "ios_a", "ios", "US", 700, 70),
            ("2026-05-04", "ios_a", "ios", "US", 800, 80),
            ("2026-05-11", "ios_a", "ios", "US", 900, 90),
            ("2026-05-18", "ios_a", "ios", "US", 1000, 100),
            ("2026-05-25", "ios_a", "ios", "US", 1050, 110),
            ("2026-06-01", "ios_a", "ios", "US", 1100, 120),
        ],
    )
    conn.commit()
    conn.close()

    return public


@pytest.fixture
def tools(sensortower_public_dir: Path) -> SensorTowerQueryTools:
    dispatcher = AgentToolDispatcher(sensortower_public_dir, "", True, False)
    return SensorTowerQueryTools(dispatcher)


def test_top_ranking_latest_returns_table_envelope(tools: SensorTowerQueryTools):
    result = tools.run(
        {"operation": "top_ranking", "platform": "ios", "country": "US", "chartType": "free", "limit": 2}
    )

    assert result["output"] == "table_card"
    assert result["title"] == "SensorTower iOS US free Top 2"
    assert result["cutoff"] == "2026-06-01"
    assert [row["app_name"] for row in result["rows"]] == ["Royal Match", "Block Blast"]
    assert result["columns"][0]["label"] == "排名"


def test_rank_changes_latest_returns_table_envelope(tools: SensorTowerQueryTools):
    result = tools.run({"operation": "rank_changes", "platform": "ios", "country": "US", "chartType": "free"})

    assert result["output"] == "table_card"
    assert result["cutoff"] == "2026-06-01"
    assert result["comparisonPeriod"] == "2026-05-25"
    assert result["rows"][0]["app_name"] == "Royal Match"
    assert result["rows"][0]["change_type"] == "rise"


def test_rank_changes_direction_rise_matches_localized_change_type(tools: SensorTowerQueryTools):
    result = tools.run({"operation": "rank_changes", "platform": "ios", "country": "US", "direction": "rise"})

    assert result["output"] == "table_card"
    assert [row["app_name"] for row in result["rows"]] == ["Royal Match", "Localized Rise"]
    assert result["rows"][1]["change_type"] == "📈 排名上升"


def test_weekly_sales_trend_returns_chart_envelope_and_registers_chart(tools: SensorTowerQueryTools):
    result = tools.run(
        {
            "operation": "weekly_sales_trend",
            "appId": "ios_a",
            "platform": "ios",
            "country": "US",
            "metric": "downloads",
            "limit": 8,
        }
    )

    assert result["output"] == "chart_png"
    assert result["cutoff"] == "2026-06-01"
    assert result["rows"][-1]["downloads"] == 1100
    assert tools.dispatcher.chart_payloads[-1]["type"] == "line"
    assert tools.dispatcher.chart_payloads[-1]["xKey"] == "week_start"


def test_removed_games_and_top5_overview_surfaces_are_supported(tools: SensorTowerQueryTools):
    removed = tools.run({"operation": "removed_games", "platform": "ios", "country": "US", "chartType": "free"})
    overview = tools.run({"operation": "top5_overview", "platform": "ios", "country": "US", "chartType": "free"})

    assert removed["output"] == "table_card"
    assert removed["rows"][0]["app_name"] == "Gone Game"
    assert overview["output"] == "text_only"
    assert "Top5" in overview["statement"]


def test_fallback_sql_is_sensor_tower_only_and_hides_sql(tools: SensorTowerQueryTools):
    result = tools.run(
        {
            "operation": "fallback_sql",
            "db": "sensortower_top100.db",
            "sql": "SELECT country, COUNT(*) AS app_count FROM apple_top100 GROUP BY country",
        }
    )

    assert result["output"] == "table_card"
    assert result["rows"] == [{"country": "US", "app_count": 4}]
    assert "sql" not in result


def test_fallback_sql_rejects_non_sensortower_database(tools: SensorTowerQueryTools):
    with pytest.raises(ValueError, match="仅允许查询 SensorTower"):
        tools.run({"operation": "fallback_sql", "db": "wechatdouyin.db", "sql": "SELECT 1"})


def test_dispatcher_routes_sensortower_query_and_collects_table(sensortower_public_dir: Path):
    AgentToolDispatcher.invalidate_schema_cache()
    dispatcher = AgentToolDispatcher(sensortower_public_dir, "", True, False)

    result = dispatcher.sensortower_query(
        {"operation": "top_ranking", "platform": "ios", "country": "US", "limit": 2}
    )

    assert result["output"] == "table_card"
    assert dispatcher.table_payloads[-1]["title"] == result["title"]
    AgentToolDispatcher.invalidate_schema_cache()
