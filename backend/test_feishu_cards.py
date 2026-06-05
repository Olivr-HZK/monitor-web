"""Feishu interactive card table payload tests."""
from __future__ import annotations

from feishu_cards import build_table_card, sanitize_cell


def test_sanitize_cell_removes_newlines_and_limits_length() -> None:
    assert sanitize_cell("a\nb", max_chars=10) == "a b"
    assert sanitize_cell("abcdef", max_chars=4) == "abc…"


def test_build_table_card_uses_feishu_table_component() -> None:
    card = build_table_card(
        {
            "title": "Top Games",
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
    assert card["header"]["title"]["content"] == "Top Games"
    assert card["elements"][1]["tag"] == "table"
    assert card["elements"][1]["columns"][0]["display_name"] == "排名"
    assert card["elements"][1]["rows"][0]["app_name"] == "Royal Match"


def test_build_table_card_marks_truncated_results() -> None:
    card = build_table_card(
        {
            "title": "Top Games",
            "columns": [
                {"key": "rank", "label": "排名"},
                {"key": "app_name", "label": "游戏"},
            ],
            "rows": [
                {"rank": rank, "app_name": f"Game {rank}"}
                for rank in range(1, 8)
            ],
            "truncated": True,
        },
        max_rows=5,
    )

    assert len(card["elements"][1]["rows"]) == 5
    assert "已截断" in card["elements"][2]["content"]
