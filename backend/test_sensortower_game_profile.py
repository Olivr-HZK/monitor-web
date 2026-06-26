"""SensorTower single-game profile tool tests."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from ai_tools import AgentToolDispatcher, openai_style_tools_schema


def sample_profile() -> dict[str, Any]:
    return {
        "generatedAt": "2026-06-15T00:00:00.000Z",
        "identity": {
            "query": "Block Blast",
            "canonicalName": "Block Blast!",
            "publisher": "Hungry Studio",
            "iosAppIds": ["1617391485"],
            "androidAppIds": ["com.block.juggle"],
            "confidence": "high",
        },
        "period": {
            "startDate": "2026-05-04",
            "endDate": "2026-06-02",
            "country": "US",
        },
        "summary": {
            "downloads": 20311739,
            "revenue": 1770652,
            "rpd": 0.0872,
            "averageDau": 35231652,
            "arpdau": 0.0503,
            "timeSpentSeconds": None,
            "websiteVisits": None,
        },
        "series": {
            "sales": [
                {"date": "2026-05-04T00:00:00Z", "downloads": 100, "revenue": 10},
                {"date": "2026-05-05T00:00:00Z", "downloads": 150, "revenue": 20},
            ],
            "activeUsers": [
                {"date": "2026-05-04T00:00:00Z", "activeUsers": 1000},
                {"date": "2026-05-05T00:00:00Z", "activeUsers": 1200},
            ],
        },
        "rankings": [
            {
                "os": "ios",
                "device": "iphone",
                "categoryName": "Games/Puzzle",
                "chartType": "topfreeapplications",
                "latestRank": 1,
                "series": {
                    "1617391485": {
                        "US": {
                            "7012": {
                                "topfreeapplications": {
                                    "graphData": [
                                        [1777852800, 2, None],
                                        [1777939200, 1, None],
                                    ]
                                }
                            }
                        }
                    }
                },
            }
        ],
        "apiCalls": [{"name": "sales_report_estimates"}, {"name": "active_users"}],
        "warnings": ["website visits endpoint unavailable"],
    }


def test_build_game_profile_card_contains_core_metrics() -> None:
    from sensortower_game_profile import build_game_profile_card

    card = build_game_profile_card(sample_profile())

    assert card["config"]["wide_screen_mode"] is True
    assert "Block Blast" in card["header"]["title"]["content"]
    card_json = json.dumps(card, ensure_ascii=False)
    assert "下载量" in card_json
    assert "20,311,739" in card_json
    assert "收入" in card_json
    assert "$1,770,652" in card_json
    assert "平均 DAU" in card_json
    assert "35,231,652" in card_json
    assert any(element.get("tag") == "table" for element in card["elements"])


def test_build_game_profile_card_uses_metric_blocks_and_hides_diagnostics() -> None:
    from sensortower_game_profile import build_game_profile_card

    card = build_game_profile_card(sample_profile())
    metric_sections = [
        element
        for element in card["elements"]
        if element.get("tag") == "div" and isinstance(element.get("fields"), list)
    ]
    assert len(metric_sections) == 1
    metric_fields = metric_sections[0]["fields"]
    assert all(field.get("is_short") is True for field in metric_fields)
    metric_text = [str((field.get("text") or {}).get("content") or "") for field in metric_fields]

    assert any("下载量" in text and "20,311,739" in text for text in metric_text)
    assert any("收入" in text and "$1,770,652" in text for text in metric_text)
    assert any("RPD" in text and "$0.0872" in text for text in metric_text)
    assert sum(text.startswith("**下载量**") for text in metric_text) == 1
    assert sum(text.startswith("**收入**") for text in metric_text) == 1
    assert sum(text.startswith("**RPD**") for text in metric_text) == 1

    card_json = json.dumps(card, ensure_ascii=False)
    assert "API 调用数" not in card_json
    assert "website visits endpoint unavailable" not in card_json
    assert "花费时间" not in card_json
    assert "网站访问量" not in card_json


def test_build_game_profile_charts_returns_metric_and_ranking_trends() -> None:
    from sensortower_game_profile import build_game_profile_charts

    charts = build_game_profile_charts(sample_profile())

    titles = [chart["title"] for chart in charts]
    assert "Block Blast! 下载量趋势" in titles
    assert "Block Blast! 收入趋势" in titles
    assert "Block Blast! 平均 DAU 趋势" in titles
    rank_chart = next(chart for chart in charts if chart["title"] == "Block Blast! 类别排名趋势")
    assert rank_chart["invertYAxis"] is True
    assert rank_chart["data"][0]["iphone Games/Puzzle"] == 2


def test_run_single_game_profile_invokes_node_cli_and_reads_json(monkeypatch, tmp_path: Path) -> None:
    import sensortower_game_profile

    profile = sample_profile()

    def fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        assert Path(cmd[0]).name == "node"
        assert "single_game_profile.js" in cmd[1]
        assert "Block Blast" in cmd
        assert "--country" in cmd and cmd[cmd.index("--country") + 1] == "US"
        out_dir = Path(cmd[cmd.index("--out-dir") + 1])
        out_dir.mkdir(parents=True)
        (out_dir / "game_profile_block-blast.json").write_text(
            json.dumps(profile, ensure_ascii=False),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(cmd, 0, stdout="ok", stderr="")

    monkeypatch.setattr(sensortower_game_profile.subprocess, "run", fake_run)

    result = sensortower_game_profile.run_single_game_profile(
        "Block Blast",
        country="US",
        start_date="2026-05-04",
        end_date="2026-06-02",
        output_root=tmp_path,
    )

    assert result["profile"]["identity"]["canonicalName"] == "Block Blast!"
    assert result["output"] == "profile_card"
    assert result["apiCallCount"] == 2
    assert "Block Blast" in result["card"]["header"]["title"]["content"]
    assert [chart["title"] for chart in result["charts"]][:2] == [
        "Block Blast! 下载量趋势",
        "Block Blast! 收入趋势",
    ]


def test_run_single_game_profile_logs_internal_diagnostics(monkeypatch, tmp_path: Path, caplog) -> None:  # type: ignore[no-untyped-def]
    import sensortower_game_profile

    profile = sample_profile()

    def fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        out_dir = Path(cmd[cmd.index("--out-dir") + 1])
        out_dir.mkdir(parents=True)
        (out_dir / "game_profile_block-blast.json").write_text(
            json.dumps(profile, ensure_ascii=False),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(cmd, 0, stdout="ok", stderr="")

    monkeypatch.setattr(sensortower_game_profile.subprocess, "run", fake_run)

    with caplog.at_level("INFO", logger="sensortower_game_profile"):
        sensortower_game_profile.run_single_game_profile(
            "Block Blast",
            country="US",
            output_root=tmp_path,
        )

    assert "api_calls=2" in caplog.text
    assert "website visits endpoint unavailable" in caplog.text


def test_dispatcher_routes_game_profile_and_collects_card(monkeypatch, tmp_path: Path) -> None:
    import sensortower_game_profile

    profile = sample_profile()
    card = sensortower_game_profile.build_game_profile_card(profile)
    charts = sensortower_game_profile.build_game_profile_charts(profile)

    def fake_run_single_game_profile(game_name: str, **kwargs):  # type: ignore[no-untyped-def]
        assert game_name == "Block Blast"
        assert kwargs["country"] == "US"
        return {
            "output": "profile_card",
            "profile": profile,
            "card": card,
            "charts": charts,
            "apiCallCount": 2,
            "warnings": [],
        }

    monkeypatch.setattr(
        sensortower_game_profile,
        "run_single_game_profile",
        fake_run_single_game_profile,
    )

    dispatcher = AgentToolDispatcher(tmp_path, "", True, False)
    result = dispatcher.sensortower_game_profile({"gameName": "Block Blast", "country": "US"})

    assert result["output"] == "profile_card"
    assert result["canonicalName"] == "Block Blast!"
    assert "apiCallCount" not in result
    assert "warnings" not in result
    assert "profile" not in result
    assert "jsonPath" not in result
    assert dispatcher.card_payloads == [card]
    assert dispatcher.chart_payloads == charts


def test_sensortower_game_profile_is_exposed_to_llm_schema() -> None:
    names = {
        tool["function"]["name"]
        for tool in openai_style_tools_schema(enable_db=True, enable_web=False)
    }

    assert "sensortower_game_profile" in names
