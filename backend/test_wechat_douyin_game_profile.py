from __future__ import annotations

import sqlite3
from pathlib import Path

import ai_tools
from ai_tools import AgentToolDispatcher, openai_style_tools_schema


def _init_wechatdouyin_db(public_dir: Path) -> None:
    db_path = public_dir / "wechatdouyin.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE top20_ranking (
          id INTEGER PRIMARY KEY,
          week_range TEXT NOT NULL,
          platform_key TEXT NOT NULL,
          rank TEXT,
          game_name TEXT,
          game_type TEXT,
          platform TEXT,
          source TEXT,
          board_name TEXT,
          monitor_date TEXT,
          publish_time TEXT,
          company TEXT,
          rank_change TEXT,
          region TEXT,
          chart_key TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE rank_changes (
          id INTEGER PRIMARY KEY,
          week_range TEXT NOT NULL,
          platform_key TEXT NOT NULL,
          rank TEXT,
          game_name TEXT,
          game_type TEXT,
          platform TEXT,
          source TEXT,
          board_name TEXT,
          monitor_date TEXT,
          publish_time TEXT,
          company TEXT,
          rank_change TEXT,
          region TEXT,
          chart_key TEXT NOT NULL DEFAULT ''
        );
        """
    )
    rows = [
        (
            "2026-05-25~2026-05-31",
            "wx",
            "7",
            "挪了下车",
            "休闲",
            "微信小游戏",
            "引力引擎",
            "微信小游戏人气周榜",
            "2026-06-01",
            "周平均排名:8.2",
            "广州指望科技有限公司",
            "↑63",
            "中国",
            "popularity",
        ),
        (
            "2026-06-01~2026-06-07",
            "wx",
            "5",
            "挪了下车",
            "休闲",
            "微信小游戏",
            "引力引擎",
            "微信小游戏畅玩周榜异动",
            "2026-06-08",
            "周平均排名:6.4",
            "广州指望科技有限公司",
            "↑31",
            "中国",
            "casual_play",
        ),
    ]
    conn.executemany(
        """
        INSERT INTO top20_ranking(
          week_range, platform_key, rank, game_name, game_type, platform, source,
          board_name, monitor_date, publish_time, company, rank_change, region, chart_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.execute(
        """
        INSERT INTO rank_changes(
          week_range, platform_key, rank, game_name, game_type, platform, source,
          board_name, monitor_date, publish_time, company, rank_change, region, chart_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows[-1],
    )
    conn.commit()
    conn.close()


def test_wechat_douyin_game_profile_collects_card_and_rank_trend(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(ai_tools, "DATA_SOURCE_DB_PATHS", {})
    AgentToolDispatcher.invalidate_schema_cache()
    _init_wechatdouyin_db(tmp_path)
    dispatcher = AgentToolDispatcher(tmp_path, "", True, False)

    result = dispatcher.wechat_douyin_game_profile({"gameName": "挪了下车", "maxWeeks": 8})

    assert result["output"] == "minigame_profile_card"
    assert result["canonicalName"] == "挪了下车"
    assert result["latestWeek"] == "2026-06-01~2026-06-07"
    assert result["latestRankings"][0]["rank"] == 5
    assert result["latestRankings"][0]["rankChange"] == "↑31"
    assert result["summary"]["bestRank"] == 5
    assert result["summary"]["weeksOnChart"] == 2
    assert result["signalCount"] == 1
    assert result["chartCount"] == 1

    assert dispatcher.card_payloads
    card_json = str(dispatcher.card_payloads[0])
    assert "挪了下车 小游戏画像" in card_json
    assert "广州指望科技有限公司" in card_json
    assert "微信小游戏畅玩周榜异动" in card_json

    assert dispatcher.chart_payloads == [
        {
            "type": "line",
            "title": "挪了下车 微信/抖音排名走势",
            "xKey": "week_range",
            "series": [{"key": "微信小游戏", "name": "微信小游戏"}],
            "data": [
                {"week_range": "2026-05-25~2026-05-31", "微信小游戏": 7},
                {"week_range": "2026-06-01~2026-06-07", "微信小游戏": 5},
            ],
            "invertYAxis": True,
        }
    ]


def test_wechat_douyin_game_profile_exposes_candidates_when_no_exact_match(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(ai_tools, "DATA_SOURCE_DB_PATHS", {})
    AgentToolDispatcher.invalidate_schema_cache()
    _init_wechatdouyin_db(tmp_path)
    dispatcher = AgentToolDispatcher(tmp_path, "", True, False)

    result = dispatcher.wechat_douyin_game_profile({"gameName": "挪车"})

    assert result["output"] == "not_found"
    assert result["candidates"] == ["挪了下车"]


def test_wechat_douyin_game_profile_is_exposed_to_llm_schema() -> None:
    names = {
        tool["function"]["name"]
        for tool in openai_style_tools_schema(enable_db=True, enable_web=False)
    }

    assert "wechat_douyin_game_profile" in names
