"""AI 助手工具：SQLite 只读查询与联网搜索（Codex / OpenRouter agent 共用）。"""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Any

import httpx


class AgentToolDispatcher:
    def __init__(
        self,
        public_dir: Path,
        tavily_api_key: str = "",
        enable_db_tool: bool = True,
        enable_web_search_tool: bool = True,
    ) -> None:
        self.public_dir = public_dir.resolve()
        self.tavily_api_key = (tavily_api_key or "").strip()
        self.enable_db_tool = enable_db_tool
        self.enable_web_search_tool = enable_web_search_tool

    async def dispatch(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        if tool_name == "query_sqlite" and self.enable_db_tool:
            return self.query_sqlite(args)
        if tool_name == "web_search" and self.enable_web_search_tool:
            return await self.web_search(args)
        raise ValueError(f"unknown or disabled tool: {tool_name}")

    def query_sqlite(self, args: dict[str, Any]) -> dict[str, Any]:
        db_raw = str(args.get("db") or "").strip()
        sql_raw = str(args.get("sql") or "").strip()
        limit = args.get("limit", 50)
        try:
            limit_int = int(limit)
        except Exception:
            limit_int = 50
        limit_int = max(1, min(limit_int, 200))
        if not db_raw or not sql_raw:
            raise ValueError("db 和 sql 不能为空")

        db = Path(db_raw).name.strip()
        if not db or db.startswith(".") or "/" in db or "\\" in db:
            raise ValueError("db 参数非法，仅允许数据库文件名")

        sql = sql_raw.strip()
        if sql.endswith(";"):
            sql = sql[:-1].rstrip()
        sql_l = sql.lower().strip()
        pragma_table_info = re.match(r"^pragma\s+table_info\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\)$", sql_l) is not None
        if not (sql_l.startswith("select") or sql_l.startswith("with") or pragma_table_info):
            raise ValueError("只允许 SELECT / WITH 查询")
        if ";" in sql_l:
            raise ValueError("SQL 包含禁用关键字")
        if not pragma_table_info:
            banned = ["insert ", "update ", "delete ", "drop ", "alter ", "attach ", "vacuum "]
            if any(k in sql_l for k in banned):
                raise ValueError("SQL 包含禁用关键字")
            if sql_l.startswith("pragma"):
                raise ValueError("仅允许 PRAGMA table_info(表名)")

        db_path = (self.public_dir / db).resolve()
        if not db_path.exists() or db_path.suffix.lower() != ".db":
            raise ValueError(f"数据库不存在: {db}")
        if db_path.parent != self.public_dir:
            raise ValueError("数据库路径越界")

        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute(sql)
            rows = cur.fetchmany(limit_int)
            out_rows = [dict(row) for row in rows]
            cols = list(out_rows[0].keys()) if out_rows else [d[0] for d in (cur.description or [])]
            return {
                "db": db,
                "rowCount": len(out_rows),
                "columns": cols,
                "rows": out_rows,
            }
        finally:
            conn.close()

    async def web_search(self, args: dict[str, Any]) -> dict[str, Any]:
        query = str(args.get("query") or "").strip()
        max_results = args.get("maxResults", 5)
        try:
            n = int(max_results)
        except Exception:
            n = 5
        n = max(1, min(n, 10))
        if not query:
            raise ValueError("query 不能为空")

        if self.tavily_api_key:
            async with httpx.AsyncClient(timeout=20.0) as client:
                r = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": self.tavily_api_key,
                        "query": query,
                        "max_results": n,
                        "include_answer": True,
                    },
                )
                r.raise_for_status()
                data = r.json()
                results = data.get("results") or []
                return {
                    "query": query,
                    "answer": data.get("answer") or "",
                    "results": [
                        {
                            "title": x.get("title"),
                            "url": x.get("url"),
                            "content": x.get("content"),
                        }
                        for x in results[:n]
                    ],
                }

        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json", "no_html": "1", "no_redirect": "1"},
            )
            r.raise_for_status()
            data = r.json()

        related = data.get("RelatedTopics") or []
        items: list[dict[str, Any]] = []
        for it in related:
            if len(items) >= n:
                break
            if isinstance(it, dict) and isinstance(it.get("Text"), str):
                items.append(
                    {
                        "title": it.get("Text"),
                        "url": it.get("FirstURL") or "",
                    }
                )
            elif isinstance(it, dict) and isinstance(it.get("Topics"), list):
                for sub in it.get("Topics") or []:
                    if len(items) >= n:
                        break
                    if isinstance(sub, dict) and isinstance(sub.get("Text"), str):
                        items.append({"title": sub.get("Text"), "url": sub.get("FirstURL") or ""})

        return {
            "query": query,
            "answer": data.get("AbstractText") or "",
            "results": items,
        }


def openai_style_tools_schema(
    enable_db: bool,
    enable_web: bool,
) -> list[dict[str, Any]]:
    """OpenAI / OpenRouter `tools` 列表（function calling）。"""
    tools: list[dict[str, Any]] = []
    if enable_db:
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": "query_sqlite",
                    "description": "查询监测平台 SQLite 数据库（只读）。仅允许 SELECT / WITH；不确定列名时可用 PRAGMA table_info(表名)。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "db": {"type": "string", "description": "数据库文件名，如 wechatdouyin.db"},
                            "sql": {"type": "string", "description": "SQL 查询语句"},
                            "limit": {"type": "integer", "description": "最多返回行数，默认 50，最大 200"},
                        },
                        "required": ["db", "sql"],
                    },
                },
            }
        )
    if enable_web:
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": "web_search",
                    "description": "联网搜索最新信息并返回摘要与链接。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string"},
                            "maxResults": {"type": "integer", "description": "1–10，默认 5"},
                        },
                        "required": ["query"],
                    },
                },
            }
        )
    return tools
