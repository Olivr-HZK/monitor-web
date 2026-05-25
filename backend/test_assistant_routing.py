from __future__ import annotations

from pathlib import Path

from ai_tools import AgentToolDispatcher, build_overseas_weekly_prompt_block
from assistant_service import is_overseas_casual_query, is_trend_query, select_relevant_databases
from config import PUBLIC_DIR
from feishu_format import strip_markdown_for_feishu


def test_overseas_query_skips_wechat_db():
    selected = select_relevant_databases("休闲游戏出海最近有什么动向")
    assert "wechatdouyin.db" not in selected


def test_wechat_query_still_includes_wechat_db():
    selected = select_relevant_databases("微信小游戏本周排名变化")
    assert "wechatdouyin.db" in selected


def test_overseas_page_context_detected():
    assert is_overseas_casual_query(
        "这周有什么值得看的",
        {"casualGameCategory": "出海周报"},
    )


def test_build_overseas_weekly_prompt_block_has_read_hint():
    block = build_overseas_weekly_prompt_block(PUBLIC_DIR)
    if (PUBLIC_DIR / "休闲游戏检测/出海周报/index.json").is_file():
        assert "read_public_report" in block
        assert "出海周报" in block


def test_trend_query_includes_multiple_dbs():
    selected = select_relevant_databases("微信小游戏最近排名趋势怎么样")
    assert "wechatdouyin.db" in selected
    assert "sensortower_top100.db" in selected


def test_strip_markdown_for_feishu():
    raw = "## 结论\n**Block Blast** 最近从第 5 升到第 3。\n- [详情](https://example.com)"
    plain = strip_markdown_for_feishu(raw)
    assert "**" not in plain
    assert "##" not in plain
    assert "Block Blast" in plain
    assert "https://example.com" in plain


def test_read_public_report_latest():
    index = PUBLIC_DIR / "休闲游戏检测/出海周报/index.json"
    if not index.is_file():
        return
    dispatcher = AgentToolDispatcher(PUBLIC_DIR, "", True, False)
    result = dispatcher.read_public_report({"path": "latest", "maxChars": 2000})
    assert result.get("summary") or result.get("content")
    assert "休闲游戏检测/出海周报/" in str(result.get("path"))
