"""AI 助手工具：SQLite 只读查询、联网搜索、图表渲染（Codex / OpenRouter agent 共用）。"""
from __future__ import annotations

import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

import httpx


def _build_db_schema_cache(public_dir: Path) -> dict[str, dict[str, list[str]]]:
    """启动时扫描 public/*.db 的表结构，缓存为 {db_name: {table: [col1, col2, ...]}}。"""
    cache: dict[str, dict[str, list[str]]] = {}
    for db_path in sorted(public_dir.glob("*.db")):
        if not db_path.is_file() or db_path.name.startswith("."):
            continue
        tables: dict[str, list[str]] = {}
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            for (tbl,) in cur.fetchall():
                cur.execute(f"PRAGMA table_info([{tbl}])")
                cols = [row[1] for row in cur.fetchall()]
                tables[tbl] = cols
            conn.close()
        except Exception:
            continue
        if tables:
            cache[db_path.name] = tables
    return cache


def _format_schema_for_prompt(cache: dict[str, dict[str, list[str]]]) -> str:
    """将 Schema 缓存格式化为可注入 system prompt 的文本。"""
    if not cache:
        return ""
    lines: list[str] = ["\n\n【数据库 Schema（已预加载，无需 PRAGMA 探查）】"]
    for db_name, tables in cache.items():
        lines.append(f"\n{db_name}")
        for tbl, cols in tables.items():
            lines.append(f"  {tbl}({', '.join(cols)})")
    return "\n".join(lines)


def _normalize_db_filter(db_names: list[str] | tuple[str, ...] | set[str] | None) -> set[str] | None:
    if not db_names:
        return None
    out = {Path(str(name)).name.strip() for name in db_names if str(name).strip()}
    return out or None


def build_data_freshness_text(public_dir: Path) -> str:
    """生成面向模型的数据新鲜度摘要，让回答“最近/最新”时有边界感。"""
    items: list[tuple[float, str, int]] = []
    try:
        db_paths = sorted(public_dir.glob("*.db"))
    except OSError:
        db_paths = []
    for p in db_paths:
        if not p.is_file() or p.name.startswith("."):
            continue
        try:
            stat = p.stat()
        except OSError:
            continue
        items.append((stat.st_mtime, p.name, stat.st_size))
    if not items:
        return ""
    items.sort(reverse=True)
    lines = ["\n\n【站内数据新鲜度】"]
    newest_ts = items[0][0]
    lines.append(f"- 最新数据文件更新时间：{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(newest_ts))}")
    lines.append("- 回答“最新/最近/本周”类问题时，请优先基于站内数据实际截止时间说明，不要暗示已有今天实时数据。")
    lines.append("- 当前可用数据文件（按更新时间取前 8 个）：")
    for ts, name, size in items[:8]:
        mb = size / 1024 / 1024
        lines.append(f"  - {name}，更新时间 {time.strftime('%Y-%m-%d', time.localtime(ts))}，约 {mb:.1f} MB")
    return "\n".join(lines)


def _validate_db_name(public_dir: Path, db_raw: str) -> tuple[str, Path]:
    db = Path(db_raw).name.strip()
    if not db or db.startswith(".") or "/" in db or "\\" in db:
        raise ValueError("db 参数非法，仅允许数据库文件名")
    db_path = (public_dir / db).resolve()
    if not db_path.exists() or db_path.suffix.lower() != ".db":
        raise ValueError(f"数据库不存在: {db}")
    if db_path.parent != public_dir:
        raise ValueError("数据库路径越界")
    return db, db_path


def _prepare_readonly_sql(sql_raw: str, *, allow_pragma_table_info: bool = False) -> tuple[str, bool]:
    sql = sql_raw.strip()
    if sql.endswith(";"):
        sql = sql[:-1].rstrip()
    sql_l = sql.lower().strip()
    pragma_table_info = (
        allow_pragma_table_info
        and re.match(r"^pragma\s+table_info\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\)$", sql_l) is not None
    )
    if not (sql_l.startswith("select") or sql_l.startswith("with") or pragma_table_info):
        raise ValueError("只允许 SELECT / WITH 查询")
    if ";" in sql_l:
        raise ValueError("SQL 包含禁用关键字")
    if not pragma_table_info:
        banned = [
            "insert ",
            "update ",
            "delete ",
            "drop ",
            "alter ",
            "attach ",
            "detach ",
            "vacuum ",
            "replace ",
            "create ",
            "pragma ",
        ]
        if any(k in sql_l for k in banned):
            raise ValueError("SQL 包含禁用关键字")
    return sql, pragma_table_info


def _execute_readonly_query(db_path: Path, sql: str, limit_int: int, *, timeout_sec: float = 5.0) -> tuple[list[dict[str, Any]], list[str]]:
    started = time.monotonic()
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=timeout_sec)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON")

        def _progress() -> int:
            return 1 if time.monotonic() - started > timeout_sec else 0

        conn.set_progress_handler(_progress, 2000)
        cur = conn.cursor()
        cur.execute(sql)
        rows = cur.fetchmany(limit_int)
        out_rows: list[dict[str, Any]] = [dict(row) for row in rows]
        cols = list(out_rows[0].keys()) if out_rows else [d[0] for d in (cur.description or [])]
        return out_rows, cols
    except sqlite3.OperationalError as e:
        if "interrupted" in str(e).lower():
            raise ValueError("SQL 查询超时，请缩小范围或增加过滤条件") from e
        raise
    finally:
        conn.close()


def _is_number_like(value: Any) -> bool:
    if isinstance(value, bool) or value is None:
        return False
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        if not text:
            return False
        try:
            float(text)
            return True
        except ValueError:
            return False
    return False


class AgentToolDispatcher:
    _schema_cache: dict[str, dict[str, list[str]]] | None = None

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
        self.chart_payloads: list[dict[str, Any]] = []
        if AgentToolDispatcher._schema_cache is None:
            AgentToolDispatcher._schema_cache = _build_db_schema_cache(self.public_dir)

    @classmethod
    def get_schema_text(cls, db_names: list[str] | tuple[str, ...] | set[str] | None = None) -> str:
        if cls._schema_cache is None:
            return ""
        wanted = _normalize_db_filter(db_names)
        if not wanted:
            return _format_schema_for_prompt(cls._schema_cache)
        filtered = {name: tables for name, tables in cls._schema_cache.items() if name in wanted}
        return _format_schema_for_prompt(filtered)

    @classmethod
    def list_db_names(cls) -> list[str]:
        if cls._schema_cache is None:
            return []
        return sorted(cls._schema_cache.keys())

    @classmethod
    def invalidate_schema_cache(cls) -> None:
        cls._schema_cache = None

    async def dispatch(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        if tool_name == "query_and_chart" and self.enable_db_tool:
            return self.query_and_chart(args)
        if tool_name == "query_sqlite" and self.enable_db_tool:
            return self.query_sqlite(args)
        if tool_name == "web_search" and self.enable_web_search_tool:
            return await self.web_search(args)
        if tool_name == "render_chart":
            return self.render_chart(args)
        raise ValueError(f"unknown or disabled tool: {tool_name}")

    # ------------------------------------------------------------------
    #  query_and_chart：查库 + 画图一步完成（推荐优先使用）
    # ------------------------------------------------------------------
    def query_and_chart(self, args: dict[str, Any]) -> dict[str, Any]:
        db_raw = str(args.get("db") or "").strip()
        sql_raw = str(args.get("sql") or "").strip()
        limit = args.get("limit", 50)
        try:
            limit_int = int(limit)
        except Exception:
            limit_int = 50
        limit_int = max(1, min(limit_int, 200))

        chart_type = str(args.get("chartType") or "line").strip().lower()
        if chart_type not in ("line", "bar", "area", "table"):
            chart_type = "line"
        chart_title = str(args.get("chartTitle") or "").strip()
        x_key = str(args.get("xKey") or "").strip()
        series_spec = args.get("series")

        if not db_raw or not sql_raw:
            raise ValueError("db 和 sql 不能为空")

        # --- 查库 ---
        db, db_path = _validate_db_name(self.public_dir, db_raw)
        sql, _ = _prepare_readonly_sql(sql_raw)
        out_rows, cols = _execute_readonly_query(db_path, sql, limit_int)

        # --- 自动推断图表参数 ---
        if not x_key and cols:
            x_key = cols[0]

        if not isinstance(series_spec, list) or len(series_spec) == 0:
            if x_key and cols:
                if chart_type == "table":
                    y_cols = [c for c in cols if c != x_key]
                else:
                    y_cols = [
                        c for c in cols
                        if c != x_key and any(_is_number_like(row.get(c)) for row in out_rows[:20])
                    ]
                series_spec = [{"key": c, "name": c} for c in y_cols]

        validated_series: list[dict[str, Any]] = []
        if isinstance(series_spec, list):
            for s in series_spec:
                if not isinstance(s, dict):
                    continue
                key = str(s.get("key") or "").strip()
                if not key:
                    continue
                if chart_type != "table" and not any(_is_number_like(row.get(key)) for row in out_rows[:20]):
                    continue
                validated_series.append({
                    "key": key,
                    "name": str(s.get("name") or key),
                    "color": str(s.get("color") or "").strip() or None,
                })

        # --- 生成图表 ---
        chart_result: dict[str, Any] | None = None
        if x_key and validated_series and out_rows:
            payload = {
                "type": chart_type,
                "title": chart_title,
                "xKey": x_key,
                "series": validated_series,
                "data": out_rows[:200],
            }
            self.chart_payloads.append(payload)
            chart_result = {
                "rendered": True,
                "chartType": chart_type,
                "title": chart_title,
                "dataPoints": len(out_rows),
                "seriesCount": len(validated_series),
            }

        return {
            "db": db,
            "rowCount": len(out_rows),
            "columns": cols,
            "rows": out_rows,
            "chart": chart_result,
            "hint": "图表已生成，请在文字中简要解读趋势即可，无需重复列出数据点。" if chart_result else "数据已返回，但无法自动生成图表，请用文字总结。",
        }

    # ------------------------------------------------------------------
    #  query_sqlite：纯查库（保留向后兼容）
    # ------------------------------------------------------------------
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

        db, db_path = _validate_db_name(self.public_dir, db_raw)
        sql, _ = _prepare_readonly_sql(sql_raw, allow_pragma_table_info=True)
        out_rows, cols = _execute_readonly_query(db_path, sql, limit_int)
        return {
            "db": db,
            "rowCount": len(out_rows),
            "columns": cols,
            "rows": out_rows,
        }

    # ------------------------------------------------------------------
    #  web_search
    # ------------------------------------------------------------------
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

    # ------------------------------------------------------------------
    #  render_chart：单独调用（保留向后兼容）
    # ------------------------------------------------------------------
    def render_chart(self, args: dict[str, Any]) -> dict[str, Any]:
        chart_type = str(args.get("type") or "line").strip().lower()
        if chart_type not in ("line", "bar", "area", "table"):
            chart_type = "line"
        title = str(args.get("title") or "").strip()
        x_key = str(args.get("xKey") or "").strip()
        series = args.get("series")
        data_points = args.get("data")

        if not x_key:
            raise ValueError("xKey 不能为空（指定横轴字段名）")
        if not isinstance(data_points, list) or len(data_points) == 0:
            raise ValueError("data 不能为空，需提供数据点数组")

        if not isinstance(series, list) or len(series) == 0:
            if data_points and isinstance(data_points[0], dict):
                non_x_keys = [k for k in data_points[0].keys() if k != x_key]
                series = [{"key": k, "name": k} for k in non_x_keys]
            else:
                raise ValueError("series 不能为空")

        validated_series = []
        for s in series:
            if not isinstance(s, dict):
                continue
            key = str(s.get("key") or "").strip()
            if not key:
                continue
            validated_series.append({
                "key": key,
                "name": str(s.get("name") or key),
                "color": str(s.get("color") or "").strip() or None,
            })

        if not validated_series:
            raise ValueError("至少需要一个有效的 series")

        payload = {
            "type": chart_type,
            "title": title,
            "xKey": x_key,
            "series": validated_series,
            "data": data_points[:200],
        }

        self.chart_payloads.append(payload)

        return {
            "rendered": True,
            "chartType": chart_type,
            "title": title,
            "dataPoints": len(data_points),
            "seriesCount": len(validated_series),
            "hint": "图表已生成，请在文字回复中简要解读图表趋势即可，无需重复列出所有数据点。",
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
                    "name": "query_and_chart",
                    "description": (
                        "查询数据库并自动生成可视化图表，一步完成。这是你唯一需要的数据库工具。"
                        "你只需提供 db、sql 和 chartType，系统会查库、自动推断横轴和数据系列并渲染图表。"
                        "返回查询结果和图表状态，你只需用文字简要解读趋势。"
                        "列名已在系统提示的 Schema 中预加载，直接写 SQL 即可。"
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "db": {
                                "type": "string",
                                "description": "数据库文件名，如 wechatdouyin.db、sensortower_top100.db、competitor_data.db、ai_products_ua.db、us_free_appid_weekly.db",
                            },
                            "sql": {"type": "string", "description": "SQL 查询语句（仅 SELECT/WITH）。列名已在系统提示的 Schema 中给出，直接写即可。"},
                            "chartType": {
                                "type": "string",
                                "enum": ["line", "bar", "area", "table"],
                                "description": "图表类型：line=折线图（趋势/时间序列），bar=柱状图（横向对比），area=面积图，table=数据表格。默认 line。",
                            },
                            "chartTitle": {
                                "type": "string",
                                "description": "图表标题，如「Block Blast 近8周排名变化」",
                            },
                            "xKey": {
                                "type": "string",
                                "description": "横轴字段名。不指定则默认取查询结果第一列。如 week_range、rank_date、app_name",
                            },
                            "series": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "key": {"type": "string", "description": "数据字段名"},
                                        "name": {"type": "string", "description": "图例显示名"},
                                        "color": {"type": "string", "description": "可选颜色，如 #FF4500"},
                                    },
                                    "required": ["key", "name"],
                                },
                                "description": "数据系列。不指定则自动取除 xKey 外所有数值列。",
                            },
                            "limit": {"type": "integer", "description": "最多返回行数，默认 50，最大 200"},
                        },
                        "required": ["db", "sql", "chartType"],
                    },
                },
            }
        )
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": "query_sqlite",
                    "description": "仅查询数据库不生成图表。仅在不需要可视化时使用（如只需一个简单数值）。列名已在系统提示的 Schema 中预加载，直接写 SQL 即可。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "db": {
                                "type": "string",
                                "description": "仅文件名",
                            },
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
