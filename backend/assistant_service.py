"""统一的监测助手服务：网页、飞书和后续订阅入口共用同一套 agent 能力。"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import json
import os
from typing import Any, Callable, AsyncIterator

import httpx

from ai_tools import AgentToolDispatcher, build_data_freshness_text, build_overseas_weekly_prompt_block
from codex_app_server import CodexAppServerSession, CodexProtocolError
from config import (
    AI_PROVIDER,
    CODEX_APP_SERVER_BIN,
    CODEX_ENABLE_DB_TOOL,
    CODEX_ENABLE_WEB_SEARCH_TOOL,
    CODEX_MODEL,
    CODEX_TURN_TIMEOUT_SEC,
    CODEX_WORKDIR,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_MODEL,
    OPENROUTER_HTTP_REFERER,
    PUBLIC_DIR,
    TAVILY_API_KEY,
)
from knowledge_loader import load_agent_knowledge_text
from openrouter_agent import _TOOL_DISPLAY_NAMES, run_openrouter_agent_chat


_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_agent_knowledge_cache: str | None = None


@dataclass
class AssistantResult:
    answer: str
    charts: list[dict[str, Any]] = field(default_factory=list)
    selected_dbs: list[str] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


def get_agent_knowledge() -> str:
    global _agent_knowledge_cache
    if _agent_knowledge_cache is None:
        _agent_knowledge_cache = load_agent_knowledge_text()
    return _agent_knowledge_cache


def format_page_context(ctx: dict[str, Any] | None) -> str:
    if not ctx or not isinstance(ctx, dict):
        return ""
    lines: list[str] = []
    for key in sorted(ctx.keys()):
        val = ctx[key]
        if val is None or val == "":
            continue
        lines.append(f"- {key}: {val}")
    if not lines:
        return ""
    header = (
        "【页面/渠道上下文】（仅表示用户当前所在入口和语境；"
        "不限制你只能使用某一个数据库。若问题涉及跨榜单、跨监测类型或需交叉核对，"
        "应按需查询相关数据源。）\n"
    )
    return header + "\n".join(lines)


def public_db_catalog_for_prompt() -> str:
    names = AgentToolDispatcher.list_db_names()
    if not names:
        try:
            names = sorted(p.name for p in PUBLIC_DIR.glob("*.db") if p.is_file())
        except OSError:
            names = []
    if not names:
        return ""
    return "\n\n【可用的 SQLite 文件名（query_sqlite/query_and_chart 的 db 只填文件名）】\n" + ", ".join(names)


def _has_any(text: str, words: tuple[str, ...]) -> bool:
    return any(w.lower() in text for w in words)


def is_trend_query(text: str, page_context: dict[str, Any] | None = None) -> bool:
    blob = (text or "").lower()
    if page_context:
        blob += " " + " ".join(str(v).lower() for v in page_context.values() if v is not None)
    return _has_any(
        blob,
        (
            "趋势",
            "走势",
            "变化",
            "最近",
            "近期",
            "近来",
            "上升",
            "下降",
            "波动",
            "对比",
            "排名变化",
            "异动",
        ),
    )


def is_overseas_casual_query(text: str, page_context: dict[str, Any] | None = None) -> bool:
    """休闲游戏出海周报意图：数据在 public JSON，不在 SQLite。"""
    blob = (text or "").lower()
    if page_context:
        for key, val in page_context.items():
            if val is None:
                continue
            sval = str(val).lower()
            if key in ("casualGameCategory", "casualGameSource", "monitorType") and any(
                token in sval for token in ("出海", "overseas", "overseas_weekly")
            ):
                return True
            blob += " " + sval
    return _has_any(
        blob,
        (
            "出海",
            "出海周报",
            "海外",
            "overseas",
            "puzzle game",
            "新兴市场",
            "liveops",
            "买量风向",
        ),
    )


def select_relevant_databases(user_text: str, page_context: dict[str, Any] | None = None) -> list[str]:
    """按问题语义选择要注入的 schema，避免每次把所有库塞进 prompt。"""
    text = (user_text or "").lower()
    if page_context:
        text += " " + " ".join(str(v).lower() for v in page_context.values() if v is not None)
    names = AgentToolDispatcher.list_db_names()
    if not names:
        AgentToolDispatcher(PUBLIC_DIR, TAVILY_API_KEY, CODEX_ENABLE_DB_TOOL, CODEX_ENABLE_WEB_SEARCH_TOOL)
        names = AgentToolDispatcher.list_db_names()

    selected: list[str] = []
    overseas_intent = is_overseas_casual_query(text, page_context)
    trend_intent = is_trend_query(text, page_context)

    def add_exact(name: str) -> None:
        if name in names and name not in selected:
            selected.append(name)

    def add_contains(fragment: str, *, max_items: int = 1) -> None:
        count = 0
        for name in names:
            if fragment in name and name not in selected:
                selected.append(name)
                count += 1
                if count >= max_items:
                    break

    if _has_any(text, ("sensortower", "sensor tower", "top100", "商店", "app store", "google play", "美国榜", "免费榜")):
        add_exact("sensortower_top100.db")
        add_exact("sensortower_applist.db")
    wechat_intent = _has_any(text, ("微信", "抖音", "小游戏", "rank_changes", "top20"))
    casual_intent = _has_any(text, ("休闲游戏", "玩法"))
    if wechat_intent or (casual_intent and not overseas_intent):
        add_exact("wechatdouyin.db")
    if _has_any(text, ("竞品", "社媒", "小红书", "facebook", "instagram", "tiktok", "线下活动", "social")):
        add_exact("competitor_data.db")
    if _has_any(text, ("ai 产品", "ai产品", "ua", "素材", "creative", "广告", "投放")):
        add_exact("ai_products_ua.db")
    if _has_any(text, ("我方", "自家", "own product", "appid", "us free", "us免费")):
        add_exact("us_free_appid_weekly.db")
    if _has_any(text, ("video enhancer", "视频增强", "remaker", "enhancer")):
        add_exact("video_enhancer_pipeline.db")

    # 页面上下文：问法模糊时按当前入口补全 schema（与前端 AiPageContext 对齐）
    if page_context:
        mt = str(page_context.get("monitorType") or "")
        cat = str(page_context.get("casualGameCategory") or "")
        ai_sub = str(page_context.get("aiProductSub") or "")
        comp_sub = str(page_context.get("casualCompetitorSub") or "")
        ranking_section = str(page_context.get("rankingSection") or "")
        page_title = str(page_context.get("pageTitle") or "")

        if any(token in mt for token in ("AI产品监测", "AI 产品")):
            add_exact("ai_products_ua.db")
        if any(token in cat for token in ("商店页变化", "商店页")):
            add_exact("sensortower_top100.db")
        if any(token in cat for token in ("周报简要", "新游戏", "玩法")) and not overseas_intent:
            add_exact("wechatdouyin.db")
        if any(token in ai_sub for token in ("UA", "素材", "投放", "创意")):
            add_exact("ai_products_ua.db")
        if any(token in comp_sub for token in ("社媒", "竞品", "动态")):
            add_exact("competitor_data.db")
        if ranking_section == "wechat_douyin":
            add_exact("wechatdouyin.db")
        elif ranking_section == "sensortower":
            add_exact("sensortower_top100.db")
        if any(token in page_title for token in ("我方产品", "US 免费", "US免费")):
            add_exact("us_free_appid_weekly.db")

    # 趋势/最近类问题：多拉几个时间序列数据源，便于画折线图
    if trend_intent and not overseas_intent:
        for name in (
            "wechatdouyin.db",
            "sensortower_top100.db",
            "us_free_appid_weekly.db",
            "competitor_data.db",
        ):
            add_exact(name)
    elif trend_intent and overseas_intent:
        add_exact("sensortower_top100.db")

    if not selected and not overseas_intent:
        for name in (
            "wechatdouyin.db",
            "sensortower_top100.db",
            "competitor_data.db",
            "ai_products_ua.db",
            "us_free_appid_weekly.db",
        ):
            add_exact(name)

    # 明确问历史快照时，补少量带日期库；普通问题优先当前 canonical db。
    if _has_any(text, ("历史", "快照", "2026-", "对比上周", "上周")) or trend_intent:
        add_contains(" 2026-", max_items=3)

    return selected[:8]


def build_system_content(
    user_text: str = "",
    page_context: dict[str, Any] | None = None,
    *,
    channel: str = "web",
) -> tuple[str, list[str]]:
    selected_dbs = select_relevant_databases(user_text, page_context)
    base = (
        "你是「监测汇总」内部平台的智能监测 agent，擅长解读 AI 热点、趋势监测、休闲游戏监测和 AI 产品监测相关的数据和周报。"
        "像同事聊天一样回答：先点出用户最关心的，再补依据；不要套模板，不要报告腔。"
        "如果站内数据有截止时间，必须说明数据边界。"
        "\n\n【工具策略】"
        "\n- 用户问最近/趋势/走势/排名变化/对比：必须 query_and_chart，chartType 优先 line，SQL 拉多周/多期数据（通常 4–12 个时间点）。"
        "\n- 涉及排名变化、趋势走势、数据对比等可视化场景时，优先 query_and_chart 一步完成查库+画图。"
        "\n- 只有纯事实查询（如「XX 本周排第几」）不需要图表时，才用 query_sqlite。"
        "\n- 休闲游戏「出海/海外市场/Puzzle Game 周报」在 JSON 报告里，必须用 read_public_report（path=latest 或指定期数），不要用 SQLite。"
        "\n- 需要站外动态信息时才用 web_search，并区分站内数据与公开网页信息。"
        "\n- 不要向普通用户暴露数据库名、表名、SQL、内部路径或密钥；这些仅是服务端工具。"
        "\n- 当问题使用「最新/最近/本周/今天」等词时，先看站内数据新鲜度，不要编造实时数据。"
        "\n- 图表生成后，文字只做口头解读，不要逐条复读表格数据。"
    )
    if is_overseas_casual_query(user_text, page_context):
        overseas_block = build_overseas_weekly_prompt_block(PUBLIC_DIR)
        if overseas_block:
            base += overseas_block
    if channel.startswith("feishu"):
        base += (
            "\n\n【飞书回答格式】"
            "\n- 纯文本：禁止使用 Markdown（不要用 #、**、```、| 表格、> 引用、[]() 链接语法）；飞书无法渲染。"
            "\n- 用口语化短段，空行自然分段；链接直接贴 URL。"
            "\n- 禁止固定结构：不要每次都用「结论/依据/建议」三段式，不要机械编号「一、二、三」，不要小标题堆砌。"
            "\n- 每次回复的开场和收尾都可以不同，像真人带看数据，有温度、有判断。"
            "\n- 默认 800 字以内；长报告只给摘要和下一步建议。"
            "\n- 信息不足时直接说明缺口并建议追问。"
        )
    if "feishu_casual" in channel:
        base += (
            "\n\n【休闲 GM 语气】"
            "\n- 保持 Genm/Game Master 中二傲娇感，但信息准确第一。"
            "\n- 问趋势/最近/变化：务必 query_and_chart 画折线图（系统会把图发到飞书），文字像解说一样讲清楚「看到了什么、意味着什么」。"
            "\n- 可同时查微信/抖音榜、SensorTower、我方产品等多个相关源，帮用户把趋势看全。"
        )
    knowledge = get_agent_knowledge()
    if knowledge:
        base += "\n\n【平台知识库（供回答时参考）】\n" + knowledge
    freshness = build_data_freshness_text(PUBLIC_DIR)
    if freshness:
        base += freshness
    base += public_db_catalog_for_prompt()
    schema_text = AgentToolDispatcher.get_schema_text(selected_dbs)
    if schema_text:
        base += schema_text
    return base, selected_dbs


def build_messages_for_request(
    user_text: str,
    history: list[dict] | None,
    page_context: dict[str, Any] | None,
    *,
    channel: str = "web",
) -> tuple[list[dict[str, str]], list[str]]:
    system_content, selected_dbs = build_system_content(user_text, page_context, channel=channel)
    messages: list[dict[str, str]] = [{"role": "system", "content": system_content}]
    history_items = list(history or [])
    if history_items:
        last = history_items[-1]
        if (
            isinstance(last, dict)
            and last.get("role") == "user"
            and isinstance(last.get("content"), str)
            and last["content"].strip() == (user_text or "").strip()
        ):
            history_items = history_items[:-1]
    for item in history_items:
        if not item or not isinstance(item.get("role"), str) or not isinstance(item.get("content"), str):
            continue
        role = item["role"] if item["role"] in ("assistant", "system") else "user"
        content = item["content"].strip()
        if content:
            messages.append({"role": role, "content": content[:20000]})
    page_block = format_page_context(page_context)
    user_content = f"{page_block}\n\n{user_text}" if page_block else user_text
    messages.append({"role": "user", "content": user_content})
    return messages, selected_dbs


def compose_codex_user_message(user_text: str, page_context: dict[str, Any] | None, *, channel: str = "web") -> tuple[str, list[str]]:
    system_content, selected_dbs = build_system_content(user_text, page_context, channel=channel)
    page_block = format_page_context(page_context)
    parts = [system_content]
    if page_block:
        parts.append(page_block)
    parts.append(user_text)
    return "\n\n".join(parts), selected_dbs


def _build_codex_subprocess_env() -> dict[str, str]:
    env = {
        "OPENAI_API_KEY": OPENAI_API_KEY,
        "OPENAI_BASE_URL": OPENAI_BASE_URL,
    }
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"):
        value = os.environ.get(key)
        if value:
            env[key] = value
    return env


def _openrouter_extra_headers() -> dict[str, str]:
    h: dict[str, str] = {}
    if OPENROUTER_HTTP_REFERER.strip():
        h["HTTP-Referer"] = OPENROUTER_HTTP_REFERER.strip()
    return h


async def chat_via_openrouter(
    user_text: str,
    history: list[dict] | None,
    page_context: dict[str, Any] | None,
    *,
    dispatcher: AgentToolDispatcher | None = None,
    on_tool_call: Callable[[str, dict[str, Any]], None] | None = None,
    channel: str = "web",
) -> AssistantResult:
    messages, selected_dbs = build_messages_for_request(user_text, history, page_context, channel=channel)
    if dispatcher is None:
        dispatcher = AgentToolDispatcher(PUBLIC_DIR, TAVILY_API_KEY, CODEX_ENABLE_DB_TOOL, CODEX_ENABLE_WEB_SEARCH_TOOL)
    tool_calls: list[dict[str, Any]] = []

    def wrapped_tool_call(name: str, args: dict[str, Any]) -> None:
        safe_args = dict(args)
        if "sql" in safe_args:
            safe_args.pop("sql", None)
        tool_calls.append({"name": name, "args": safe_args})
        if on_tool_call:
            on_tool_call(name, args)

    answer = await run_openrouter_agent_chat(
        [dict(m) for m in messages],
        model=OPENAI_MODEL,
        base_url=OPENAI_BASE_URL,
        api_key=OPENAI_API_KEY,
        dispatcher=dispatcher,
        extra_headers=_openrouter_extra_headers() or None,
        on_tool_call=wrapped_tool_call,
    )
    return AssistantResult(answer=answer, charts=dispatcher.chart_payloads, selected_dbs=selected_dbs, tool_calls=tool_calls)


async def chat_via_openai(
    user_text: str,
    history: list[dict] | None,
    page_context: dict[str, Any] | None,
    *,
    channel: str = "web",
) -> AssistantResult:
    messages, selected_dbs = build_messages_for_request(user_text, history, page_context, channel=channel)
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(
            f"{OPENAI_BASE_URL}/chat/completions",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={"model": OPENAI_MODEL, "messages": messages},
        )
    if r.status_code != 200:
        raise ValueError(f"调用大模型失败（{r.status_code}）：{r.text[:500]}")
    data = r.json()
    content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    if not content and data.get("choices"):
        content = (data["choices"][0].get("delta") or {}).get("content") or ""
    if not content:
        raise ValueError("大模型返回为空，请稍后重试。")
    return AssistantResult(answer=content, selected_dbs=selected_dbs)


async def chat_via_codex(
    user_text: str,
    history: list[dict] | None,
    page_context: dict[str, Any] | None,
    *,
    channel: str = "web",
) -> AssistantResult:
    workdir = Path(CODEX_WORKDIR).expanduser() if CODEX_WORKDIR else _PROJECT_ROOT
    combined, selected_dbs = compose_codex_user_message(user_text, page_context, channel=channel)
    async with CodexAppServerSession(
        bin_name=CODEX_APP_SERVER_BIN,
        model=CODEX_MODEL,
        project_root=_PROJECT_ROOT,
        public_dir=PUBLIC_DIR,
        workdir=workdir,
        turn_timeout_sec=CODEX_TURN_TIMEOUT_SEC,
        enable_db_tool=CODEX_ENABLE_DB_TOOL,
        enable_web_search_tool=CODEX_ENABLE_WEB_SEARCH_TOOL,
        tavily_api_key=TAVILY_API_KEY,
        subprocess_env=_build_codex_subprocess_env(),
    ) as session:
        answer = await session.run_chat(combined, history)
    return AssistantResult(answer=answer, selected_dbs=selected_dbs)


async def run_monitor_assistant(
    user_text: str,
    history: list[dict] | None = None,
    page_context: dict[str, Any] | None = None,
    *,
    channel: str = "web",
    on_tool_call: Callable[[str, dict[str, Any]], None] | None = None,
) -> AssistantResult:
    if not OPENAI_API_KEY:
        raise RuntimeError("AI 服务未配置，请先配置 OPENAI_API_KEY")
    if AI_PROVIDER == "codex":
        return await chat_via_codex(user_text, history, page_context, channel=channel)
    if AI_PROVIDER == "openrouter":
        return await chat_via_openrouter(user_text, history, page_context, on_tool_call=on_tool_call, channel=channel)
    return await chat_via_openai(user_text, history, page_context, channel=channel)


async def stream_openai_text_chunks(messages: list[dict[str, str]]) -> AsyncIterator[str]:
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            f"{OPENAI_BASE_URL}/chat/completions",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={"model": OPENAI_MODEL, "messages": messages, "stream": True},
        ) as r:
            if r.status_code != 200:
                body = await r.aread()
                err_text = body.decode("utf-8", errors="replace")[:2000]
                raise ValueError(f"调用大模型失败（{r.status_code}），请稍后重试。{err_text[:500]}")
            async for line in r.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    data = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                choices = data.get("choices") or []
                if not choices:
                    continue
                delta = (choices[0].get("delta") or {}).get("content")
                if isinstance(delta, str) and delta:
                    yield delta


def tool_display_name(name: str) -> str:
    return _TOOL_DISPLAY_NAMES.get(name, f"正在执行 {name}…")
