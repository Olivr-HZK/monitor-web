"""监测助手：prompt 路由与查库冒烟测试（不调用大模型）。"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Any

import pytest

import assistant_service
from ai_tools import AgentToolDispatcher, build_overseas_weekly_prompt_block
from assistant_service import (
    build_system_content,
    detect_data_source_intents,
    is_overseas_casual_query,
    is_trend_query,
    select_relevant_databases,
    should_use_web_search,
    tool_display_name,
)
from config import PUBLIC_DIR
from feishu_format import strip_markdown_for_feishu


@pytest.fixture(scope="module", autouse=True)
def _warm_schema_cache():
    AgentToolDispatcher.invalidate_schema_cache()
    AgentToolDispatcher(PUBLIC_DIR, "", True, False)
    yield
    AgentToolDispatcher.invalidate_schema_cache()


@pytest.fixture
def ai_products_db(tmp_path):
    """public/ai_products_ua.db 可能为空占位文件；用临时库验证 AI 产品路由与查库。"""
    public = tmp_path / "public"
    public.mkdir()
    db_path = public / "ai_products_ua.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE ua_creatives (id INTEGER PRIMARY KEY, title TEXT, platform TEXT, fetch_date TEXT)"
    )
    conn.executemany(
        "INSERT INTO ua_creatives (title, platform, fetch_date) VALUES (?, ?, ?)",
        [
            ("Demo Creative A", "meta", "2026-05-20"),
            ("Demo Creative B", "tiktok", "2026-05-21"),
        ],
    )
    conn.commit()
    conn.close()

    AgentToolDispatcher.invalidate_schema_cache()
    AgentToolDispatcher(public, "", True, False)
    yield public
    AgentToolDispatcher.invalidate_schema_cache()
    AgentToolDispatcher(PUBLIC_DIR, "", True, False)


def _available_dbs() -> set[str]:
    return set(AgentToolDispatcher.list_db_names())


@dataclass(frozen=True)
class PromptRoutingCase:
    id: str
    prompt: str
    page_context: dict[str, Any] | None = None
    must_include: tuple[str, ...] = ()
    must_exclude: tuple[str, ...] = ()
    overseas: bool | None = None


@dataclass(frozen=True)
class PromptQueryCase:
    id: str
    prompt: str
    db: str
    sql: str
    page_context: dict[str, Any] | None = None
    min_rows: int = 1


PROMPT_ROUTING_CASES: tuple[PromptRoutingCase, ...] = (
    PromptRoutingCase(
        id="wechat_rank_change",
        prompt="微信小游戏本周排名变化",
        must_include=("wechatdouyin.db",),
    ),
    PromptRoutingCase(
        id="douyin_top20",
        prompt="抖音小游戏 Top20 最新排名",
        must_include=("wechatdouyin.db",),
    ),
    PromptRoutingCase(
        id="sensortower_top100",
        prompt="SensorTower 美国免费榜 Top100 最近有什么异动",
        must_include=("sensortower_top100.db",),
    ),
    PromptRoutingCase(
        id="store_listing_change",
        prompt="App Store 商店页最近有哪些变化",
        must_include=("sensortower_top100.db",),
    ),
    PromptRoutingCase(
        id="competitor_social",
        prompt="竞品社媒小红书最近有什么动态",
        must_include=("competitor_data.db",),
    ),
    PromptRoutingCase(
        id="our_product_us_free",
        prompt="我方产品 US 免费榜 appid 排名趋势",
        must_include=("us_free_appid_weekly.db",),
    ),
    PromptRoutingCase(
        id="ai_ua_creative",
        prompt="AI 产品 UA 广告素材最近投放情况",
        must_include=("ai_products_ua.db",),
    ),
    PromptRoutingCase(
        id="overseas_no_wechat",
        prompt="休闲游戏出海最近有什么动向",
        must_include=("sensortower_top100.db",),
        must_exclude=("wechatdouyin.db",),
        overseas=True,
    ),
    PromptRoutingCase(
        id="overseas_page_context",
        prompt="这周有什么值得看的",
        page_context={"monitorType": "休闲游戏监测", "casualGameCategory": "出海周报"},
        must_exclude=("wechatdouyin.db",),
        overseas=True,
    ),
    PromptRoutingCase(
        id="trend_multi_db",
        prompt="微信小游戏最近排名趋势怎么样",
        must_include=("wechatdouyin.db", "sensortower_top100.db"),
    ),
    PromptRoutingCase(
        id="ctx_store_changes",
        prompt="最近有什么变化",
        page_context={"monitorType": "休闲游戏监测", "casualGameCategory": "商店页变化"},
        must_include=("sensortower_top100.db",),
    ),
    PromptRoutingCase(
        id="ctx_weekly_brief",
        prompt="最近有什么变化",
        page_context={"monitorType": "休闲游戏监测", "casualGameCategory": "周报简要"},
        must_include=("wechatdouyin.db",),
    ),
    PromptRoutingCase(
        id="ctx_ai_product_page",
        prompt="最近有什么热点",
        page_context={"monitorType": "AI产品监测", "pageTitle": "AI 产品素材库（新/热/飙升榜）"},
        must_include=("ai_products_ua.db",),
    ),
    PromptRoutingCase(
        id="ctx_wechat_ranking_page",
        prompt="帮我看看榜单",
        page_context={
            "monitorType": "休闲游戏监测",
            "rankingSection": "wechat_douyin",
            "pageTitle": "微信/抖音小游戏排行榜",
        },
        must_include=("wechatdouyin.db",),
    ),
    PromptRoutingCase(
        id="ctx_sensortower_ranking_page",
        prompt="帮我看看榜单",
        page_context={
            "monitorType": "休闲游戏监测",
            "rankingSection": "sensortower",
            "pageTitle": "SensorTower Top100 榜单",
        },
        must_include=("sensortower_top100.db",),
    ),
    PromptRoutingCase(
        id="ctx_competitor_social_sub",
        prompt="最近更新了啥",
        page_context={"monitorType": "休闲游戏监测", "casualCompetitorSub": "社媒动态"},
        must_include=("competitor_data.db",),
    ),
)


PROMPT_QUERY_CASES: tuple[PromptQueryCase, ...] = (
    PromptQueryCase(
        id="wechat_top20",
        prompt="微信 Top20 最近排名",
        db="wechatdouyin.db",
        sql=(
            "SELECT week_range, platform, game_name, rank "
            "FROM top20_ranking ORDER BY week_range DESC LIMIT 5"
        ),
    ),
    PromptQueryCase(
        id="wechat_rank_changes",
        prompt="抖音榜排名变化",
        db="wechatdouyin.db",
        sql=(
            "SELECT week_range, platform, game_name, rank, rank_change "
            "FROM rank_changes ORDER BY week_range DESC LIMIT 5"
        ),
    ),
    PromptQueryCase(
        id="sensortower_rank_changes",
        prompt="SensorTower 排名异动",
        db="sensortower_top100.db",
        sql=(
            "SELECT rank_date_current, app_name, current_rank, signal "
            "FROM rank_changes ORDER BY rank_date_current DESC LIMIT 5"
        ),
    ),
    PromptQueryCase(
        id="sensortower_apple_top100",
        prompt="苹果 Top100",
        db="sensortower_top100.db",
        sql=(
            "SELECT rank_date, app_name, rank "
            "FROM apple_top100 ORDER BY rank_date DESC LIMIT 5"
        ),
    ),
    PromptQueryCase(
        id="competitor_companies",
        prompt="有哪些竞品公司在监测",
        db="competitor_data.db",
        sql="SELECT company_name FROM companies ORDER BY company_name LIMIT 5",
    ),
    PromptQueryCase(
        id="our_product_ranks",
        prompt="我方产品 US 榜排名",
        db="us_free_appid_weekly.db",
        sql=(
            "SELECT display_name, rank_date, rank "
            "FROM app_ranks ORDER BY rank_date DESC LIMIT 5"
        ),
    ),
)


@pytest.mark.parametrize("case", PROMPT_ROUTING_CASES, ids=lambda c: c.id)
def test_prompt_routes_to_expected_databases(case: PromptRoutingCase):
    selected = select_relevant_databases(case.prompt, case.page_context)
    available = _available_dbs()
    for db in case.must_include:
        if db not in available:
            pytest.skip(f"本地未挂载数据库 {db}，跳过 must_include 断言")
        assert db in selected, f"期望选中 {db}，实际 {selected}"
    for db in case.must_exclude:
        assert db not in selected, f"不应选中 {db}，实际 {selected}"
    if case.overseas is not None:
        assert is_overseas_casual_query(case.prompt, case.page_context) is case.overseas


@pytest.mark.parametrize("case", PROMPT_QUERY_CASES, ids=lambda c: c.id)
def test_prompt_routed_db_returns_rows(case: PromptQueryCase):
    available = _available_dbs()
    if case.db not in available:
        pytest.skip(f"本地未挂载数据库 {case.db}")

    selected = select_relevant_databases(case.prompt, case.page_context)
    assert case.db in selected, f"prompt 未路由到 {case.db}，实际 {selected}"

    dispatcher = AgentToolDispatcher(PUBLIC_DIR, "", True, False)
    result = dispatcher.query_sqlite({"db": case.db, "sql": case.sql, "limit": 10})
    assert result.get("rowCount", 0) >= case.min_rows, result
    assert result.get("columns"), "应返回列名"
    assert result.get("rows"), "应返回至少一行数据"


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


def test_overseas_system_prompt_includes_report_tool():
    system, selected = build_system_content(
        "最新出海周报讲了什么",
        {"casualGameCategory": "出海周报"},
    )
    assert "read_public_report" in system
    assert is_overseas_casual_query("最新出海周报讲了什么", {"casualGameCategory": "出海周报"})
    if (PUBLIC_DIR / "休闲游戏检测/出海周报/index.json").is_file():
        assert "出海周报" in system


def test_routed_schema_injected_into_system_prompt():
    system, selected = build_system_content("微信小游戏本周排名")
    if "wechatdouyin.db" not in _available_dbs():
        pytest.skip("wechatdouyin.db 不可用")
    assert "wechatdouyin.db" in selected
    assert "wechatdouyin.db" in system
    assert "weekly_rankings" in system or "top20_ranking" in system


def test_trend_query_includes_multiple_dbs():
    selected = select_relevant_databases("微信小游戏最近排名趋势怎么样")
    assert "wechatdouyin.db" in selected
    assert "sensortower_top100.db" in selected
    assert is_trend_query("微信小游戏最近排名趋势怎么样")


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
        pytest.skip("出海周报索引不存在")
    dispatcher = AgentToolDispatcher(PUBLIC_DIR, "", True, False)
    result = dispatcher.read_public_report({"path": "latest", "maxChars": 2000})
    assert result.get("summary") or result.get("content")
    assert "休闲游戏检测/出海周报/" in str(result.get("path"))


def test_ai_product_prompt_routes_and_queries(ai_products_db):
    prompt = "AI 产品 UA 广告素材最近投放情况"
    selected = select_relevant_databases(prompt)
    assert "ai_products_ua.db" in selected

    dispatcher = AgentToolDispatcher(ai_products_db, "", True, False)
    result = dispatcher.query_sqlite(
        {
            "db": "ai_products_ua.db",
            "sql": "SELECT title, platform FROM ua_creatives ORDER BY fetch_date DESC LIMIT 5",
            "limit": 5,
        }
    )
    assert result["rowCount"] >= 1
    assert "title" in result["columns"]


def test_ai_product_page_context_routes(ai_products_db):
    selected = select_relevant_databases(
        "最近有什么热点",
        {"monitorType": "AI产品监测", "pageTitle": "AI 产品素材库（新/热/飙升榜）"},
    )
    assert "ai_products_ua.db" in selected


OVERSEAS_PROMPT_CASES = (
    "最新一期出海周报重点是什么",
    "Puzzle Game 海外市场买量风向",
    "休闲游戏出海竞品有什么新玩法",
)


@pytest.mark.parametrize("prompt", OVERSEAS_PROMPT_CASES)
def test_overseas_prompts_prefer_json_report_tool(prompt: str):
    assert is_overseas_casual_query(prompt)
    selected = select_relevant_databases(prompt)
    assert "wechatdouyin.db" not in selected
    system, _ = build_system_content(prompt)
    if (PUBLIC_DIR / "休闲游戏检测/出海周报/index.json").is_file():
        assert "read_public_report" in system


def test_casual_persona_wrapper_does_not_pollute_intent():
    prompt = "【业务边界】这里会提到出海、Puzzle、竞品、UA。\n\n玩家问题：微信小游戏最近排名变化"
    intents = detect_data_source_intents(prompt, channel="feishu_casual_dm")
    assert "wechat_douyin" in intents
    assert "overseas_report" not in intents
    assert not is_overseas_casual_query(prompt)


def test_casual_feishu_ua_routes_to_competitor_not_ai_product():
    prompt = "玩家问题：竞品 UA 素材最近有什么变化？"
    intents = detect_data_source_intents(prompt, channel="feishu_casual_dm")
    assert "competitor" in intents
    assert "ai_product" not in intents
    selected = select_relevant_databases(prompt, channel="feishu_casual_dm")
    assert "competitor_data.db" in selected
    assert "ai_products_ua.db" not in selected


def test_casual_ambiguous_trend_uses_four_sources():
    selected = select_relevant_databases(
        "最近有什么变化？",
        {"monitorType": "休闲游戏监测"},
        channel="feishu_casual_group",
    )
    available = _available_dbs()
    for db in ("wechatdouyin.db", "sensortower_top100.db", "competitor_data.db", "us_free_appid_weekly.db"):
        if db in available:
            assert db in selected
    assert "ai_products_ua.db" not in selected


def test_web_search_intent_is_injected_into_system_prompt():
    prompt = "联网搜一下 Block Blast 今天有什么公开新闻"
    assert should_use_web_search(prompt)
    system, _ = build_system_content(prompt, channel="feishu_casual_dm")
    assert "web_search" in system
    assert "联网资料" in system


def test_product_ranking_query_does_not_trigger_web_search_by_default():
    prompt = "Block Blast 最近在 SensorTower 美国 iOS 免费榜排名怎么样？"
    assert not should_use_web_search(prompt)
    system, _ = build_system_content(prompt, channel="feishu_casual_group")
    assert "当前问题已识别为站外/实时意图" not in system


def test_product_reason_query_triggers_web_search_for_related_actions():
    prompt = "Block Blast 最近排名为什么涨了？有没有相关动作可以参考？"
    assert should_use_web_search(prompt)
    system, _ = build_system_content(prompt, channel="feishu_casual_group")
    assert "web_search" in system
    assert "相关动作" in system
    assert "不能证明因果" in system


def test_product_recent_actions_query_triggers_web_search():
    prompt = "Royal Kingdom 最近做了什么产品动作、版本更新或者活动？"
    assert should_use_web_search(prompt)
    system, _ = build_system_content(prompt, channel="feishu_casual_group")
    assert "web_search" in system
    assert "站内监测" in system
    assert "联网资料" in system
    assert "来源 1" in system
    assert "GPT 原生联网" in system
    assert "自己归纳" in system
    assert "不要直接粘贴搜索结果原文" in system


def test_casual_gameplay_question_uses_video_attachment_without_text_guide(monkeypatch):
    monkeypatch.setattr(assistant_service, "DAJIALA_API_KEY", "test-key")
    prompt = "羊了个羊怎么玩？帮我总结一下玩法亮点"

    assert not should_use_web_search(prompt)
    system, selected = build_system_content(prompt, channel="feishu_casual_group")

    assert selected == []
    assert "wechatdouyin.db" not in system
    assert "web_search" not in system
    assert "微信公众号" not in system
    assert "site:mp.weixin.qq.com" not in system
    assert "wechat_video_search" in system
    assert "不要写文字版攻略" in system
    assert "不要编玩法" in system
    assert "不要先查站内榜单" in system


def test_casual_wechat_article_gameplay_question_does_not_summarize_text_guide(monkeypatch):
    monkeypatch.setattr(assistant_service, "DAJIALA_API_KEY", "test-key")
    prompt = "搜微信公众号文章，总结一下羊了个羊的玩法攻略"

    assert not should_use_web_search(prompt)
    system, selected = build_system_content(prompt, channel="feishu_casual_group")

    assert selected == []
    assert "wechatdouyin.db" not in system
    assert "web_search" not in system
    assert "微信公众号" not in system
    assert "wechat_video_search" in system
    assert "不要写文字版攻略" in system


def test_casual_sensortower_prompt_includes_semantic_tool_guidance():
    system, selected = build_system_content(
        "SensorTower 最新美国免费榜 Top20",
        None,
        channel="feishu_casual_group",
    )

    assert "sensortower_top100.db" in selected
    assert "sensortower_applist.db" in selected
    assert "sensortower_query" in system
    assert "飞书群消息卡片表格" in system
    assert "只读 SQL 兜底" in system


def test_casual_game_profile_prompt_includes_single_game_tool_guidance():
    system, selected = build_system_content(
        "帮我看看 Block Blast 这个游戏",
        None,
        channel="feishu_casual_group",
    )

    assert "sensortower_top100.db" in selected
    assert "sensortower_applist.db" in selected
    assert "sensortower_game_profile" in system
    assert "只传游戏名" in system
    assert "画像卡片" in system


def test_sensortower_query_tool_has_friendly_display_name():
    assert tool_display_name("sensortower_query") == "正在查询 SensorTower 数据…"


def test_sensortower_game_profile_tool_has_friendly_display_name():
    assert tool_display_name("sensortower_game_profile") == "正在生成 SensorTower 单游戏画像…"
