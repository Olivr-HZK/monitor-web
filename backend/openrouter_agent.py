"""使用 OpenRouter（OpenAI 兼容 /chat/completions）做多轮 function calling，与 Codex 共用 AgentToolDispatcher。"""
from __future__ import annotations

import json
from typing import Any, Callable

import httpx

from ai_tools import AgentToolDispatcher, openai_style_tools_schema


def _extract_message_text(message: dict[str, Any]) -> str:
    c = message.get("content")
    if isinstance(c, str):
        return c.strip()
    if isinstance(c, list):
        parts: list[str] = []
        for block in c:
            if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
                parts.append(block["text"])
        return "".join(parts).strip()
    return ""


# 工具名称到中文友好提示的映射
_TOOL_DISPLAY_NAMES: dict[str, str] = {
    "query_and_chart": "正在查询数据并生成图表…",
    "query_sqlite": "正在查询数据库…",
    "sensortower_query": "正在查询 SensorTower 数据…",
    "sensortower_game_profile": "正在生成 SensorTower 单游戏画像…",
    "read_public_report": "正在读取周报报告…",
    "render_chart": "正在生成图表…",
    "web_search": "正在联网搜索…",
    "wechat_douyin_game_profile": "正在生成微信/抖音小游戏画像…",
    "wechat_video_search": "正在搜索视频号视频…",
}


async def run_openrouter_agent_chat(
    messages: list[dict[str, Any]],
    *,
    model: str,
    base_url: str,
    api_key: str,
    dispatcher: AgentToolDispatcher,
    extra_headers: dict[str, str] | None = None,
    max_tool_rounds: int = 15,
    on_tool_call: Callable[[str, dict[str, Any]], None] | None = None,
) -> str:
    """
    多轮 tools 循环，直到模型返回无 tool_calls 的文本。
    base_url 应含 /v1 前缀，如 https://openrouter.ai/api/v1
    on_tool_call: 可选回调，每次工具调用时触发，参数为 (tool_name, args)
    """
    base = base_url.rstrip("/")
    tools = openai_style_tools_schema(
        dispatcher.enable_db_tool,
        dispatcher.enable_web_search_tool,
        dispatcher.enable_wechat_video_search_tool,
    )

    headers: dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if extra_headers:
        for k, v in extra_headers.items():
            if isinstance(k, str) and isinstance(v, str) and v.strip():
                headers[k] = v

    async with httpx.AsyncClient(timeout=180.0) as client:
        for _ in range(max_tool_rounds):
            payload: dict[str, Any] = {
                "model": model,
                "messages": messages,
            }
            if tools:
                payload["tools"] = tools
                payload["tool_choice"] = "auto"

            r = await client.post(f"{base}/chat/completions", headers=headers, json=payload)
            try:
                data = r.json()
            except Exception:
                raise ValueError(f"上游返回非 JSON（HTTP {r.status_code}）：{r.text[:800]}") from None

            if r.status_code != 200:
                err = data.get("error") if isinstance(data, dict) else None
                if isinstance(err, dict):
                    msg = err.get("message") or json.dumps(err, ensure_ascii=False)
                elif isinstance(err, str):
                    msg = err
                else:
                    msg = r.text[:800]
                raise ValueError(f"OpenRouter 请求失败（{r.status_code}）：{msg}")

            choices = data.get("choices") or []
            if not choices:
                raise ValueError("上游未返回 choices")

            choice0 = choices[0] or {}
            message = choice0.get("message")
            if not isinstance(message, dict):
                raise ValueError("上游未返回 message")

            tool_calls = message.get("tool_calls")
            if tool_calls:
                messages.append(message)
                for tc in tool_calls:
                    if not isinstance(tc, dict):
                        continue
                    fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                    name = str(fn.get("name") or "").strip()
                    raw_args = fn.get("arguments")
                    if isinstance(raw_args, str):
                        try:
                            args = json.loads(raw_args) if raw_args.strip() else {}
                        except json.JSONDecodeError:
                            args = {}
                    elif isinstance(raw_args, dict):
                        args = raw_args
                    else:
                        args = {}

                    if on_tool_call:
                        try:
                            on_tool_call(name, args)
                        except Exception:
                            pass

                    try:
                        result = await dispatcher.dispatch(name, args)
                        content = json.dumps(result, ensure_ascii=False)
                    except Exception as e:
                        content = json.dumps({"error": str(e)}, ensure_ascii=False)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": str(tc.get("id") or ""),
                            "content": content,
                        }
                    )
                continue

            text = _extract_message_text(message)
            if text:
                return text

            finish = choice0.get("finish_reason")
            if finish == "length":
                raise ValueError("模型因长度截断未输出最终回答，请缩短问题或换模型。")
            if finish == "content_filter":
                raise ValueError("内容被提供方过滤，请换模型或改写问题。")

            raise ValueError("模型未返回可用文本且无工具调用，请换用支持 function calling 的模型。")

    raise ValueError("工具调用轮数过多，请简化问题。")
