"""Codex app-server client with dynamic tools for DB query and web search."""
from __future__ import annotations

import asyncio
import inspect
import json
import os
from pathlib import Path
from typing import Any

import httpx

from ai_tools import AgentToolDispatcher


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
        self._tools = AgentToolDispatcher(
            public_dir,
            tavily_api_key,
            enable_db_tool,
            enable_web_search_tool,
        )

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
            raise CodexProtocolError(
                "Codex app-server 与 OpenRouter 不兼容。请设置 AI_PROVIDER=openrouter（OpenRouter + query_sqlite/web_search），"
                "或将 OPENAI_BASE_URL 改为 OpenAI 官方地址后再使用 AI_PROVIDER=codex。"
            )
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
            "可用工具：query_sqlite（只读 SQL）、web_search（联网搜索）；是否调用由你根据问题自行决定。",
            "技术提示：wechatdouyin.db 常用列含 rank、game_name、platform、monitor_date（列名以 PRAGMA 为准）。",
            "回答使用简洁中文。",
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
            output = await self._tools.dispatch(tool_name, args)
            print(f"[codex-tool] success tool={tool_name} output_len={len(_json_text(output))}")
            return _tool_result(_json_text(output), True)
        except Exception as e:
            print(f"[codex-tool] failed tool={tool_name} error={e}")
            return _tool_result(str(e), False)

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
