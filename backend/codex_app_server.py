"""Codex app-server client with dynamic tools for DB query and web search."""
from __future__ import annotations

import asyncio
import inspect
import json
import os
import re
import sqlite3
from pathlib import Path
from typing import Any

import httpx


class CodexProtocolError(RuntimeError):
    pass


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _tool_result(output_text: str, success: bool) -> dict[str, Any]:
    # Keep backward compatibility (`output`) and satisfy newer app-server schema (`contentItems`).
    return {
        "output": output_text,
        "success": success,
        "contentItems": [
            {
                "type": "inputText",
                "text": output_text,
            }
        ],
    }


def _extract_item_text(item: dict[str, Any]) -> str:
    if not isinstance(item, dict):
        return ""
    if isinstance(item.get("text"), str):
        return item["text"]
    content = item.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
                continue
            if not isinstance(part, dict):
                continue
            if isinstance(part.get("text"), str):
                parts.append(part["text"])
                continue
            if isinstance(part.get("content"), str):
                parts.append(part["content"])
        return "".join(parts).strip()
    return ""


class CodexAppServerSession:
    def __init__(
        self,
        bin_name: str,
        model: str,
        project_root: Path,
        public_dir: Path,
        workdir: Path | None = None,
        turn_timeout_sec: int = 120,
        enable_db_tool: bool = True,
        enable_web_search_tool: bool = True,
        tavily_api_key: str = "",
        subprocess_env: dict[str, str] | None = None,
    ) -> None:
        self.bin_name = bin_name
        self.model = model
        self.project_root = project_root
        self.public_dir = public_dir
        self.workdir = workdir or project_root
        self.turn_timeout_sec = turn_timeout_sec
        self.enable_db_tool = enable_db_tool
        self.enable_web_search_tool = enable_web_search_tool
        self.tavily_api_key = tavily_api_key
        self.subprocess_env = subprocess_env or {}

        self._process: asyncio.subprocess.Process | None = None
        self._reader_task: asyncio.Task | None = None
        self._stderr_task: asyncio.Task | None = None
        self._request_id = 1
        self._write_lock = asyncio.Lock()
        self._pending: dict[str, asyncio.Future] = {}
        self._turn_waiters: dict[str, asyncio.Future] = {}
        self._turn_text: dict[str, list[str]] = {}
        self._item_text: dict[str, str] = {}
        self._turn_delta_handlers: dict[str, Any] = {}

    async def __aenter__(self) -> "CodexAppServerSession":
        env = os.environ.copy()
        env.update({k: v for k, v in self.subprocess_env.items() if isinstance(v, str) and v})
        base_url = (env.get("OPENAI_BASE_URL") or "").lower()
        if "openrouter.ai" in base_url:
            raise CodexProtocolError("codex app-server 当前不支持 OpenRouter /responses websocket。请将 OPENAI_BASE_URL 改为 https://api.openai.com/v1，或把 AI_PROVIDER 改回 openai。")
        if not self.workdir.exists():
            raise CodexProtocolError(f"CODEX_WORKDIR 不存在: {self.workdir}")
        if not self.workdir.is_dir():
            raise CodexProtocolError(f"CODEX_WORKDIR 不是目录: {self.workdir}")
        self._process = await asyncio.create_subprocess_exec(
            self.bin_name,
            "app-server",
            cwd=str(self.workdir),
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._reader_task = asyncio.create_task(self._read_loop())
        self._stderr_task = asyncio.create_task(self._stderr_loop())
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._reader_task:
            self._reader_task.cancel()
        if self._stderr_task:
            self._stderr_task.cancel()
        if self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=2)
            except asyncio.TimeoutError:
                self._process.kill()
                await self._process.wait()
        self._process = None

    async def run_chat(self, message: str, history: list[dict[str, Any]] | None, on_delta: Any = None) -> str:
        await self._initialize()
        thread_resp = await self._send_request(
            "thread/start",
            {
                "model": self.model,
                "dynamicTools": self._build_dynamic_tools(),
            },
            timeout=10,
        )
        thread_id = (((thread_resp or {}).get("thread") or {}).get("id")) or (thread_resp or {}).get("threadId")
        if not thread_id:
            raise CodexProtocolError(f"thread/start 未返回 thread id: {thread_resp}")

        prompt = self._build_prompt(message, history)
        turn_resp = await self._send_request(
            "turn/start",
            {
                "threadId": thread_id,
                "input": [{"type": "text", "text": prompt}],
            },
            timeout=10,
        )
        turn = (turn_resp or {}).get("turn") or {}
        turn_id = turn.get("id") or (turn_resp or {}).get("turnId")
        if not turn_id:
            raise CodexProtocolError(f"turn/start 未返回 turn id: {turn_resp}")
        if on_delta is not None:
            self._turn_delta_handlers[turn_id] = on_delta
        return await self._wait_turn_completed(turn_id, timeout=self.turn_timeout_sec)

    def _build_prompt(self, message: str, history: list[dict[str, Any]] | None) -> str:
        lines = [
            "你是监测汇总平台的后端智能助手。",
            "可按需调用工具：",
            "1) query_sqlite：查询业务数据库（只读，SQL）。",
            "2) web_search：联网搜索最新信息。",
            "SQL 提示：wechatdouyin.db 常用列是 rank、game_name、platform、monitor_date，不是 ranking/date。",
            "回答使用简洁中文，优先基于工具结果给结论并标注关键数据来源。",
            "",
        ]
        for item in history or []:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").strip() or "user"
            content = item.get("content")
            if isinstance(content, str) and content.strip():
                lines.append(f"{role}: {content.strip()}")
        lines.append(f"user: {message.strip()}")
        return "\n".join(lines)

    async def _initialize(self) -> None:
        await self._send_request(
            "initialize",
            {
                "clientInfo": {
                    "name": "monitor-backend",
                    "title": "Monitor Backend",
                    "version": "1.0.0",
                },
                "capabilities": {
                    "experimentalApi": True,
                    "optOutNotificationMethods": [],
                },
            },
            timeout=5,
        )
        await self._send_notification("initialized", {})

    def _build_dynamic_tools(self) -> list[dict[str, Any]]:
        tools: list[dict[str, Any]] = []
        if self.enable_db_tool:
            tools.append(
                {
                    "name": "query_sqlite",
                    "description": "查询监测平台 SQLite 数据库（只读）。",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "db": {"type": "string", "description": "数据库文件名，如 wechatdouyin.db"},
                            "sql": {"type": "string", "description": "只允许 SELECT 查询"},
                            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                        },
                        "required": ["db", "sql"],
                        "additionalProperties": False,
                    },
                }
            )
        if self.enable_web_search_tool:
            tools.append(
                {
                    "name": "web_search",
                    "description": "联网搜索最新信息并返回摘要结果。",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string"},
                            "maxResults": {"type": "integer", "minimum": 1, "maximum": 10},
                        },
                        "required": ["query"],
                        "additionalProperties": False,
                    },
                }
            )
        return tools

    async def _read_loop(self) -> None:
        assert self._process and self._process.stdout
        while True:
            line = await self._process.stdout.readline()
            if not line:
                break
            raw = line.decode("utf-8", errors="ignore").strip()
            if not raw:
                continue
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            try:
                await self._handle_message(msg)
            except Exception as e:
                print("[codex] handle message error:", e)

        for fut in list(self._pending.values()):
            if not fut.done():
                fut.set_exception(CodexProtocolError("codex app-server 已退出"))
        for fut in list(self._turn_waiters.values()):
            if not fut.done():
                fut.set_exception(CodexProtocolError("codex app-server 已退出"))

    async def _stderr_loop(self) -> None:
        assert self._process and self._process.stderr
        while True:
            line = await self._process.stderr.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="ignore").rstrip()
            if text:
                print(f"[codex-stderr] {text}")

    async def _handle_message(self, msg: dict[str, Any]) -> None:
        has_method = isinstance(msg.get("method"), str)
        has_id = "id" in msg

        if has_method and has_id:
            await self._handle_server_request(msg)
            return
        if has_method and not has_id:
            await self._handle_notification(msg)
            return
        if has_id and ("result" in msg or "error" in msg):
            req_id = str(msg.get("id"))
            fut = self._pending.get(req_id)
            if fut and not fut.done():
                if "error" in msg and msg["error"]:
                    fut.set_exception(CodexProtocolError(_json_text(msg["error"])))
                else:
                    fut.set_result(msg.get("result"))
            return

    async def _handle_notification(self, msg: dict[str, Any]) -> None:
        method = msg.get("method")
        params = msg.get("params") if isinstance(msg.get("params"), dict) else {}
        turn_id = (
            params.get("turnId")
            or ((params.get("turn") or {}).get("id") if isinstance(params.get("turn"), dict) else None)
            or ((params.get("item") or {}).get("turnId") if isinstance(params.get("item"), dict) else None)
        )
        if isinstance(turn_id, str):
            self._turn_text.setdefault(turn_id, [])

        if method == "item/agentMessage/delta":
            delta = params.get("delta")
            if isinstance(delta, str) and turn_id:
                self._turn_text.setdefault(turn_id, []).append(delta)
                cb = self._turn_delta_handlers.get(turn_id)
                if cb is not None:
                    ret = cb(delta)
                    if inspect.isawaitable(ret):
                        await ret
            return

        if method == "item/completed":
            item = params.get("item")
            if not isinstance(item, dict):
                return
            item_id = item.get("id")
            item_type = str(item.get("type") or "")
            text = _extract_item_text(item)
            if isinstance(item_id, str) and text:
                self._item_text[item_id] = text
            if "agentMessage" in item_type and text and turn_id:
                if not self._turn_text.get(turn_id):
                    self._turn_text[turn_id] = [text]
                    cb = self._turn_delta_handlers.get(turn_id)
                    if cb is not None:
                        ret = cb(text)
                        if inspect.isawaitable(ret):
                            await ret
            return

        if method == "turn/completed":
            waiter = self._turn_waiters.get(str(turn_id))
            if waiter and not waiter.done():
                status = (params.get("turn") or {}).get("status") if isinstance(params.get("turn"), dict) else None
                err = (params.get("turn") or {}).get("error") if isinstance(params.get("turn"), dict) else None
                if status == "failed":
                    waiter.set_exception(CodexProtocolError(f"turn failed: {_json_text(err)}"))
                else:
                    text = "".join(self._turn_text.get(str(turn_id), [])).strip()
                    waiter.set_result(text)
            if turn_id:
                self._turn_delta_handlers.pop(str(turn_id), None)

    async def _handle_server_request(self, msg: dict[str, Any]) -> None:
        req_id = msg.get("id")
        method = msg.get("method")
        params = msg.get("params") if isinstance(msg.get("params"), dict) else {}

        if method == "item/tool/call":
            tool = str(params.get("tool") or "")
            args = params.get("arguments")
            if not isinstance(args, dict):
                args = {}
            result = await self._dispatch_dynamic_tool(tool, args)
            await self._write_message({"id": req_id, "result": result})
            return

        await self._write_message(
            {
                "id": req_id,
                "error": {
                    "code": -32601,
                    "message": f"unsupported server request method: {method}",
                },
            }
        )

    async def _dispatch_dynamic_tool(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        print(f"[codex-tool] start tool={tool_name} args={_json_text(args)[:300]}")
        try:
            if tool_name == "query_sqlite" and self.enable_db_tool:
                output = self._query_sqlite(args)
                print(f"[codex-tool] success tool={tool_name} output_len={len(_json_text(output))}")
                return _tool_result(_json_text(output), True)
            if tool_name == "web_search" and self.enable_web_search_tool:
                output = await self._web_search(args)
                print(f"[codex-tool] success tool={tool_name} output_len={len(_json_text(output))}")
                return _tool_result(_json_text(output), True)
            print(f"[codex-tool] failed tool={tool_name} reason=unknown tool")
            return _tool_result(f"unknown tool: {tool_name}", False)
        except Exception as e:
            print(f"[codex-tool] failed tool={tool_name} error={e}")
            return _tool_result(str(e), False)

    def _query_sqlite(self, args: dict[str, Any]) -> dict[str, Any]:
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

        # Model may send an absolute/relative path; normalize to basename and enforce public/*.db boundary.
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
        # Allow one trailing semicolon (already trimmed), but reject multi-statements and write/ddl keywords.
        if ";" in sql_l:
            raise ValueError("SQL 包含禁用关键字")
        banned = ["insert ", "update ", "delete ", "drop ", "alter ", "attach ", "pragma ", "vacuum "]
        if any(k in sql_l for k in banned):
            raise ValueError("SQL 包含禁用关键字")

        db_path = (self.public_dir / db).resolve()
        if not db_path.exists() or db_path.suffix.lower() != ".db":
            raise ValueError(f"数据库不存在: {db}")
        if db_path.parent != self.public_dir.resolve():
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

    async def _web_search(self, args: dict[str, Any]) -> dict[str, Any]:
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

    async def _wait_turn_completed(self, turn_id: str, timeout: int) -> str:
        fut = asyncio.get_running_loop().create_future()
        self._turn_waiters[turn_id] = fut
        try:
            text = await asyncio.wait_for(fut, timeout=timeout)
            if not isinstance(text, str) or not text.strip():
                raise CodexProtocolError("empty assistant reply from app-server")
            return text.strip()
        finally:
            self._turn_waiters.pop(turn_id, None)

    async def _send_request(self, method: str, params: dict[str, Any], timeout: int) -> Any:
        req_id = str(self._request_id)
        self._request_id += 1
        fut = asyncio.get_running_loop().create_future()
        self._pending[req_id] = fut
        await self._write_message({"id": req_id, "method": method, "params": params})
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            self._pending.pop(req_id, None)

    async def _send_notification(self, method: str, params: dict[str, Any] | None = None) -> None:
        data: dict[str, Any] = {"method": method}
        if params is not None:
            data["params"] = params
        await self._write_message(data)

    async def _write_message(self, payload: dict[str, Any]) -> None:
        if not self._process or not self._process.stdin:
            raise CodexProtocolError("codex app-server 未启动")
        line = (_json_text(payload) + "\n").encode("utf-8")
        async with self._write_lock:
            self._process.stdin.write(line)
            await self._process.stdin.drain()
