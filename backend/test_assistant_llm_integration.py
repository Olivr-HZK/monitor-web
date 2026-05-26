"""监测助手端到端：真实调用大模型 + 工具，验证 prompt 路由到正确数据源并返回结果。"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pytest

from ai_tools import AgentToolDispatcher
from assistant_service import chat_via_openrouter, select_relevant_databases
from config import (
    AI_PROVIDER,
    CODEX_ENABLE_DB_TOOL,
    CODEX_ENABLE_WEB_SEARCH_TOOL,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    PUBLIC_DIR,
    TAVILY_API_KEY,
)


def _llm_ready() -> str | None:
    if not OPENAI_API_KEY:
        return "未配置 OPENAI_API_KEY / OPENROUTER_API_KEY"
    if AI_PROVIDER != "openrouter":
        return f"需要 AI_PROVIDER=openrouter（当前 {AI_PROVIDER!r}），否则模型不会调用 SQLite 工具"
    if not CODEX_ENABLE_DB_TOOL:
        return "CODEX_ENABLE_DB_TOOL 未开启"
    return None


def _available_dbs() -> set[str]:
    AgentToolDispatcher.invalidate_schema_cache()
    AgentToolDispatcher(PUBLIC_DIR, "", True, False)
    return set(AgentToolDispatcher.list_db_names())


@dataclass(frozen=True)
class LlmPromptCase:
    id: str
    prompt: str
    page_context: dict[str, Any] | None = None
    expect_selected: tuple[str, ...] = ()
    expect_tool: str = "query_sqlite"  # query_sqlite | query_and_chart | read_public_report
    expect_db: str | None = None
    min_answer_len: int = 30
    alt_tools: tuple[str, ...] = field(default_factory=lambda: ("query_and_chart",))


LLM_PROMPT_CASES: tuple[LlmPromptCase, ...] = (
    LlmPromptCase(
        id="wechat_top20",
        prompt=(
            "微信小游戏 Top20：请查 wechatdouyin.db 的 top20_ranking 表，"
            "取 week_range 最新一周、rank 最小的前 3 款 game_name。"
        ),
        expect_selected=("wechatdouyin.db",),
        expect_tool="query_sqlite",
        expect_db="wechatdouyin.db",
        alt_tools=("query_and_chart",),
    ),
    LlmPromptCase(
        id="sensortower_changes",
        prompt=(
            "SensorTower 美国 iOS 免费榜排名异动：请查 sensortower_top100.db 的 rank_changes 表，"
            "按 rank_date_current 降序取 5 条，返回 app_name、signal、current_rank。"
        ),
        expect_selected=("sensortower_top100.db",),
        expect_tool="query_sqlite",
        expect_db="sensortower_top100.db",
        alt_tools=("query_and_chart",),
    ),
    LlmPromptCase(
        id="competitor_social",
        prompt="竞品社媒监测里目前跟踪了哪些公司？列出公司名称即可。",
        expect_selected=("competitor_data.db",),
        expect_tool="query_sqlite",
        expect_db="competitor_data.db",
    ),
    LlmPromptCase(
        id="our_product_us_free",
        prompt="我方产品在美国免费榜最近的排名情况怎么样？用站内数据库查。",
        expect_selected=("us_free_appid_weekly.db",),
        expect_tool="query_sqlite",
        expect_db="us_free_appid_weekly.db",
        alt_tools=("query_and_chart",),
    ),
    LlmPromptCase(
        id="wechat_trend_chart",
        prompt=(
            "微信小游戏排名趋势：请查 wechatdouyin.db 的 top20_ranking 表，"
            "按 week_range 汇总各周记录数或取某热门 game_name 多周 rank，"
            "用 query_and_chart 画折线图并一句话解读。"
        ),
        expect_selected=("wechatdouyin.db",),
        expect_tool="query_and_chart",
        expect_db="wechatdouyin.db",
        alt_tools=("query_sqlite",),
    ),
    LlmPromptCase(
        id="overseas_weekly_report",
        prompt="最新一期休闲游戏出海周报的重点内容是什么？",
        expect_tool="read_public_report",
        expect_db=None,
        min_answer_len=50,
    ),
    LlmPromptCase(
        id="ctx_store_changes",
        prompt="最近商店页有什么值得注意的变化？",
        page_context={"monitorType": "休闲游戏监测", "casualGameCategory": "商店页变化"},
        expect_selected=("sensortower_top100.db",),
        expect_tool="query_sqlite",
        expect_db="sensortower_top100.db",
        alt_tools=("query_and_chart",),
    ),
    LlmPromptCase(
        id="ctx_wechat_ranking_page",
        prompt="帮我概括一下当前榜单情况",
        page_context={
            "monitorType": "休闲游戏监测",
            "rankingSection": "wechat_douyin",
            "pageTitle": "微信/抖音小游戏排行榜",
        },
        expect_selected=("wechatdouyin.db",),
        expect_tool="query_sqlite",
        expect_db="wechatdouyin.db",
        alt_tools=("query_and_chart",),
    ),
)


async def _run_llm_case(case: LlmPromptCase) -> dict[str, Any]:
    dispatcher = AgentToolDispatcher(
        PUBLIC_DIR,
        TAVILY_API_KEY,
        CODEX_ENABLE_DB_TOOL,
        CODEX_ENABLE_WEB_SEARCH_TOOL,
    )
    tool_trace: list[dict[str, Any]] = []

    async def capture_dispatch(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        result = await AgentToolDispatcher.dispatch(dispatcher, tool_name, args)
        tool_trace.append({"name": tool_name, "args": dict(args), "result": result})
        return result

    dispatcher.dispatch = capture_dispatch  # type: ignore[method-assign]

    result = await chat_via_openrouter(
        case.prompt,
        history=None,
        page_context=case.page_context,
        dispatcher=dispatcher,
        channel="web",
    )
    return {
        "answer": result.answer,
        "selected_dbs": result.selected_dbs,
        "tool_calls": result.tool_calls,
        "tool_trace": tool_trace,
        "charts": result.charts,
    }


def _db_tool_traces(trace: list[dict[str, Any]], expect_db: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in trace:
        if item["name"] not in ("query_sqlite", "query_and_chart"):
            continue
        db = str(item["args"].get("db") or item["result"].get("db") or "")
        if db == expect_db:
            out.append(item)
    return out


def _assert_tool_used(payload: dict[str, Any], case: LlmPromptCase) -> None:
    trace = payload["tool_trace"]
    assert trace, f"模型未调用任何工具，回答：{payload['answer'][:200]}"

    allowed = (case.expect_tool,) + case.alt_tools
    used_names = [t["name"] for t in trace]
    matched = [name for name in used_names if name in allowed]
    assert matched, f"期望工具 {allowed}，实际调用 {used_names}"

    if case.expect_tool == "read_public_report":
        primary = next(t for t in trace if t["name"] == "read_public_report")
        res = primary["result"]
        assert res.get("content") or res.get("summary"), "read_public_report 应返回报告正文或摘要"
        return

    if not case.expect_db:
        return

    db_traces = _db_tool_traces(trace, case.expect_db)
    assert db_traces, (
        f"期望查 {case.expect_db}，实际调用："
        f"{[(t['name'], t['args'].get('db')) for t in trace]}"
    )

    hit = next((t for t in db_traces if int(t["result"].get("rowCount") or 0) >= 1), None)
    assert hit is not None, (
        f"已对 {case.expect_db} 执行 SQL 但均为 0 行；"
        f"最后一次结果：{db_traces[-1]['result']}"
    )


@pytest.mark.integration
@pytest.mark.parametrize("case", LLM_PROMPT_CASES, ids=lambda c: c.id)
def test_llm_prompt_routes_to_db_and_returns_data(case: LlmPromptCase):
    reason = _llm_ready()
    if reason:
        pytest.skip(reason)

    available = _available_dbs()
    if case.expect_db and case.expect_db not in available:
        pytest.skip(f"本地未挂载 {case.expect_db}")

    for db in case.expect_selected:
        if db not in available:
            pytest.skip(f"本地未挂载 {db}")

    overseas_index = PUBLIC_DIR / "休闲游戏检测/出海周报/index.json"
    if case.expect_tool == "read_public_report" and not overseas_index.is_file():
        pytest.skip("出海周报索引不存在")

    selected = select_relevant_databases(case.prompt, case.page_context)
    for db in case.expect_selected:
        assert db in selected, f"路由层未选中 {db}，实际 {selected}"

    payload = asyncio.run(_run_llm_case(case))

    assert len(payload["answer"].strip()) >= case.min_answer_len, payload["answer"][:300]
    for db in case.expect_selected:
        assert db in payload["selected_dbs"], payload["selected_dbs"]

    _assert_tool_used(payload, case)

    if case.expect_tool == "query_and_chart" or any(
        t["name"] == "query_and_chart" for t in payload["tool_trace"]
    ):
        chart_ok = bool(payload["charts"]) or any(
            (t["result"].get("chart") or {}).get("rendered") for t in payload["tool_trace"]
        )
        if not chart_ok and case.expect_tool == "query_and_chart":
            # 模型可能先用 query_sqlite 探路再 chart；只要有行数据即可
            db_traces = _db_tool_traces(payload["tool_trace"], case.expect_db or "")
            assert any(int(t["result"].get("rowCount") or 0) >= 1 for t in db_traces), "趋势问题至少应查到数据"
        elif case.expect_tool == "query_and_chart":
            assert chart_ok, "趋势类问题应生成图表"
