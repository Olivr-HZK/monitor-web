#!/usr/bin/env python3
"""从后端环境与 ai_tools 直连测试 Tavily / DuckDuckGo。用法：cd backend && .venv/bin/python test_tavily.py"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

_root = Path(__file__).resolve().parent.parent
load_dotenv(_root / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

from ai_tools import AgentToolDispatcher
from config import CODEX_ENABLE_DB_TOOL, CODEX_ENABLE_WEB_SEARCH_TOOL, PUBLIC_DIR, TAVILY_API_KEY


async def main() -> int:
    key = (TAVILY_API_KEY or "").strip()
    if not key:
        print("FAIL: TAVILY_API_KEY 为空。请保存 backend/.env 后重试。")
        return 1

    d = AgentToolDispatcher(
        PUBLIC_DIR,
        key,
        CODEX_ENABLE_DB_TOOL,
        CODEX_ENABLE_WEB_SEARCH_TOOL,
    )
    r = await d.dispatch("web_search", {"query": "Tavily search API", "maxResults": 2})
    n = len(r.get("results") or [])
    ans = (r.get("answer") or "")[:200]
    print("OK: web_search 返回成功")
    print("  backend: Tavily (已配置 TAVILY_API_KEY)")
    print("  results_count:", n)
    if ans:
        print("  answer_preview:", ans.replace("\n", " ") + ("…" if len(r.get("answer") or "") > 200 else ""))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
