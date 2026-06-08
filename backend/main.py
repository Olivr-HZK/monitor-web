"""
监测汇总 - FastAPI 后端
提供：登录鉴权、受保护数据文件、AI 对话代理、玩法解析申请、飞书媒体代理。
"""
from datetime import datetime
from pathlib import Path
import asyncio
import json
import os
import re
import sqlite3
import time
import urllib.parse
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from passlib.hash import pbkdf2_sha256
from starlette.background import BackgroundTask

from config import (
    PORT,
    CORS_ORIGINS,
    COOKIE_SAMESITE,
    COOKIE_SECURE,
    LOGIN_USERNAME,
    LOGIN_PASSWORD_HASH,
    PUBLIC_DIR,
    DATA_DIR,
    DATA_SOURCE_DB_PATHS,
    DB_SNAPSHOT_DIR,
    DB_SNAPSHOT_TTL_SEC,
    DATA_SERVE_DENYLIST_BASENAMES,
    FEISHU_APP_ID,
    FEISHU_APP_SECRET,
    FEISHU_MEDIA_PUBLIC,
    FEISHU_WEBHOOK_URL,
    FEISHU_BOT_ENABLED,
    FEISHU_VERIFICATION_TOKEN,
    FEISHU_ENCRYPT_KEY,
    FEISHU_ALLOWED_OPEN_IDS,
    FEISHU_ALLOWED_CHAT_IDS,
    FEISHU_BOT_MENTION_NAMES,
    FEISHU_ASSISTANT_SEND_THINKING,
    CASUAL_FEISHU_BOT_ENABLED,
    CASUAL_FEISHU_APP_ID,
    CASUAL_FEISHU_APP_SECRET,
    CASUAL_FEISHU_VERIFICATION_TOKEN,
    CASUAL_FEISHU_ENCRYPT_KEY,
    CASUAL_FEISHU_ALLOWED_OPEN_IDS,
    CASUAL_FEISHU_ALLOWED_CHAT_IDS,
    CASUAL_FEISHU_BOT_MENTION_NAMES,
    CASUAL_FEISHU_BOT_OPEN_ID,
    CASUAL_FEISHU_ASSISTANT_SEND_THINKING,
    WECOM_WEBHOOK_URL,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    AI_PROVIDER,
    CODEX_ENABLE_DB_TOOL,
    CODEX_ENABLE_WEB_SEARCH_TOOL,
    TAVILY_API_KEY,
    ASSISTANT_MAX_HISTORY_TURNS,
)
from auth import (
    create_token,
    get_current_user,
    get_current_user_optional,
    get_token_from_request,
    require_user_for_ai,
)
from ai_tools import AgentToolDispatcher
from assistant_service import (
    build_messages_for_request as assistant_build_messages_for_request,
    build_system_content,
    detect_data_source_intents,
    get_agent_knowledge,
    is_overseas_casual_query,
    is_trend_query,
    run_monitor_assistant,
    select_relevant_databases,
    should_use_web_search,
    stream_openai_text_chunks as assistant_stream_openai_text_chunks,
    tool_display_name,
)
from casual_feishu_agent import CasualFeishuAgent, CasualFeishuSettings
from codex_app_server import CodexProtocolError
from feishu_bot import (
    AssistantSessionStore,
    FeishuBotClient,
    FeishuEventError,
    build_assistant_context,
    handle_url_verification,
    is_allowed as is_feishu_event_allowed,
    parse_message_event,
    verify_feishu_signature,
)
from frontend_data import router as frontend_data_router

app = FastAPI(title="监测汇总 API")
CORS_ALLOW_CREDENTIALS = CORS_ORIGINS != ["*"]


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.include_router(frontend_data_router)

IS_DEV_NO_PASSWORD = not LOGIN_PASSWORD_HASH
GAMEPLAY_REQUESTS_FILE = DATA_DIR / "gameplay_requests.json"
USERS_FILE = DATA_DIR / "users.json"
_feishu_token_cache: dict = {"token": "", "expire_at": 0}
_feishu_bot_client = FeishuBotClient(FEISHU_APP_ID, FEISHU_APP_SECRET)
_assistant_session_store = AssistantSessionStore(DATA_DIR / "assistant_sessions.db")


def _existing_db_path(db_name: str) -> Path:
    source = DATA_SOURCE_DB_PATHS.get(db_name)
    if source and source.exists():
        return source
    return PUBLIC_DIR / db_name


class InMemoryRateLimiter:
    def __init__(self, max_events: int, window_sec: int) -> None:
        self.max_events = max_events
        self.window_sec = window_sec
        self._events: dict[str, list[float]] = {}

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        clean_after = now - self.window_sec
        bucket = [ts for ts in self._events.get(key, []) if ts >= clean_after]
        if len(bucket) >= self.max_events:
            self._events[key] = bucket
            return False
        bucket.append(now)
        self._events[key] = bucket
        return True


_ai_rate_limiter = InMemoryRateLimiter(max_events=12, window_sec=60)
_feishu_rate_limiter = InMemoryRateLimiter(max_events=8, window_sec=60)
_casual_feishu_rate_limiter = InMemoryRateLimiter(max_events=8, window_sec=60)


def _client_rate_key(request: Request, prefix: str) -> str:
    token_user = ""
    token = get_token_from_request(request)
    if token:
        try:
            from auth import verify_token
            token_user = verify_token(token) or ""
        except Exception:
            token_user = ""
    host = request.client.host if request.client else "unknown"
    return f"{prefix}:{token_user or host}"


def _append_assistant_audit(payload: dict[str, Any]) -> None:
    try:
        _ensure_data_dir()
        safe = dict(payload)
        if isinstance(safe.get("question"), str):
            safe["question"] = safe["question"][:500]
        if isinstance(safe.get("error"), str):
            safe["error"] = safe["error"][:1000]
        safe["at"] = datetime.utcnow().isoformat() + "Z"
        path = DATA_DIR / "assistant_audit.jsonl"
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(safe, ensure_ascii=False) + "\n")
    except Exception as e:
        print("[assistant-audit]", e)


def _assistant_audit_stats(limit: int = 200) -> dict[str, Any]:
    path = DATA_DIR / "assistant_audit.jsonl"
    if not path.exists():
        return {"recentRuns": 0, "recentErrors": 0, "lastRunAt": ""}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()[-limit:]
    except OSError:
        return {"recentRuns": 0, "recentErrors": 0, "lastRunAt": ""}
    runs = 0
    errors = 0
    last_at = ""
    for line in lines:
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        runs += 1
        if item.get("status") == "error":
            errors += 1
        if isinstance(item.get("at"), str):
            last_at = item["at"]
    return {"recentRuns": runs, "recentErrors": errors, "lastRunAt": last_at}


async def _run_casual_monitor_assistant_proxy(
    text: str,
    history: list[dict] | None,
    context: dict[str, Any] | None,
):
    channel = str((context or {}).get("channel") or "feishu_casual")
    return await run_monitor_assistant(text, history, context, channel=channel)


def _create_background_task(coro):
    return asyncio.create_task(coro)


_casual_feishu_bot_client = FeishuBotClient(CASUAL_FEISHU_APP_ID, CASUAL_FEISHU_APP_SECRET)
_casual_assistant_session_store = AssistantSessionStore(DATA_DIR / "casual_assistant_sessions.db")
_casual_feishu_agent = CasualFeishuAgent(
    settings=CasualFeishuSettings(
        bot_enabled=CASUAL_FEISHU_BOT_ENABLED,
        verification_token=CASUAL_FEISHU_VERIFICATION_TOKEN,
        encrypt_key=CASUAL_FEISHU_ENCRYPT_KEY,
        allowed_open_ids=CASUAL_FEISHU_ALLOWED_OPEN_IDS,
        allowed_chat_ids=CASUAL_FEISHU_ALLOWED_CHAT_IDS,
        bot_mention_names=CASUAL_FEISHU_BOT_MENTION_NAMES,
        bot_open_id=CASUAL_FEISHU_BOT_OPEN_ID,
        send_thinking=CASUAL_FEISHU_ASSISTANT_SEND_THINKING,
        max_history_turns=ASSISTANT_MAX_HISTORY_TURNS,
        ai_provider=AI_PROVIDER,
    ),
    bot_client=_casual_feishu_bot_client,
    session_store=_casual_assistant_session_store,
    rate_limiter=_casual_feishu_rate_limiter,
    run_assistant=_run_casual_monitor_assistant_proxy,
    append_audit=_append_assistant_audit,
    create_task=_create_background_task,
)
app.include_router(_casual_feishu_agent.router)


def _ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _read_users() -> list[dict]:
    _ensure_data_dir()
    if not USERS_FILE.exists():
        return []
    try:
        raw = USERS_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_users(users: list[dict]) -> None:
    _ensure_data_dir()
    USERS_FILE.write_text(json.dumps(users, ensure_ascii=False, indent=2), encoding="utf-8")


def _find_user(username: str) -> dict | None:
    name = (username or "").strip()
    if not name:
        return None
    for u in _read_users():
        if u.get("username") == name:
            return u
    return None


# ---------- 登录 /（暂不开放）注册 / 登出 / 当前用户 ----------
class LoginBody(BaseModel):
    username: str = ""
    password: str = ""


class RegisterBody(BaseModel):
    username: str = ""
    password: str = ""


@app.post("/api/register")
async def register(body: RegisterBody):
    # 当前版本不开放自助注册，如需新账号请由管理员在服务器侧创建或直接修改配置。
    raise HTTPException(status_code=403, detail="当前暂未开放注册，请联系管理员开通账号")


@app.post("/api/login")
async def login(body: LoginBody, request: Request):
    username = (body.username or "").strip()
    password = (body.password or "").strip()
    if not username or not password:
        raise HTTPException(status_code=400, detail="请填写用户名和密码")
    # 仅支持单一管理员账号 LOGIN_USERNAME；生产必须使用 LOGIN_PASSWORD_HASH。
    if username != LOGIN_USERNAME:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if LOGIN_PASSWORD_HASH:
        try:
            ok = pbkdf2_sha256.verify(password, LOGIN_PASSWORD_HASH)
        except Exception:
            ok = False
        if not ok:
            raise HTTPException(status_code=401, detail="用户名或密码错误")
    else:
        admin_pwd = os.environ.get("ADMIN_PASSWORD", "").strip()
        if not admin_pwd:
            raise HTTPException(status_code=500, detail="登录服务未配置密码哈希，请联系管理员")
        if password != admin_pwd:
            raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = create_token(username)
    # token 同时放入 JSON，便于 GitHub Pages 等跨站场景下 Safari 无法带 Cookie 时用 Authorization 头鉴权
    resp = JSONResponse(content={"user": username, "token": token})
    resp.set_cookie(
        "token",
        token,
        path="/",
        httponly=True,
        max_age=7 * 24 * 3600,
        samesite=COOKIE_SAMESITE,  # type: ignore[arg-type]
        secure=COOKIE_SECURE,
    )
    return resp


@app.get("/api/me")
async def me(request: Request):
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    from auth import verify_token
    username = verify_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="登录已过期")
    return {"user": username}


@app.get("/api/debug/cors")
async def debug_cors():
    return {
        "cors_origins": CORS_ORIGINS,
        "allow_credentials": CORS_ALLOW_CREDENTIALS,
    }


@app.get("/api/ai/health")
async def ai_health(request: Request):
    await require_user_for_ai(request)
    dispatcher = AgentToolDispatcher(
        PUBLIC_DIR,
        TAVILY_API_KEY,
        CODEX_ENABLE_DB_TOOL,
        CODEX_ENABLE_WEB_SEARCH_TOOL,
    )
    db_names = AgentToolDispatcher.list_db_names()
    latest_db_mtime = None
    for db_name in db_names:
        try:
            mtime = _existing_db_path(db_name).stat().st_mtime
        except OSError:
            continue
        latest_db_mtime = max(latest_db_mtime or 0, mtime)
    audit = _assistant_audit_stats()
    return {
        "ok": bool(OPENAI_API_KEY),
        "provider": AI_PROVIDER,
        "model": OPENAI_MODEL if OPENAI_API_KEY else "",
        "openaiConfigured": bool(OPENAI_API_KEY),
        "dbToolEnabled": dispatcher.enable_db_tool,
        "webSearchEnabled": dispatcher.enable_web_search_tool,
        "databaseCount": len(db_names),
        "latestDatabaseUpdatedAt": datetime.fromtimestamp(latest_db_mtime).isoformat() if latest_db_mtime else "",
        "knowledgeChars": len(get_agent_knowledge()),
        "feishuBotEnabled": FEISHU_BOT_ENABLED,
        "casualFeishuBotEnabled": CASUAL_FEISHU_BOT_ENABLED,
        "maxHistoryTurns": ASSISTANT_MAX_HISTORY_TURNS,
        "audit": audit,
    }


@app.post("/api/logout")
async def logout():
    resp = JSONResponse(content={"ok": True})
    resp.delete_cookie(
        "token",
        path="/",
        secure=COOKIE_SECURE,
        httponly=True,
        samesite=COOKIE_SAMESITE,  # type: ignore[arg-type]
    )
    return resp


# ---------- 玩法解析申请 ----------
class GameplayRequestBody(BaseModel):
    gameName: str = ""
    source: str = "wechat_douyin"
    remark: str = ""


def _read_gameplay_requests() -> list:
    _ensure_data_dir()
    if not GAMEPLAY_REQUESTS_FILE.exists():
        return []
    try:
        raw = GAMEPLAY_REQUESTS_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _append_gameplay_request(payload: dict):
    lst = _read_gameplay_requests()
    lst.append({
        "gameName": payload["gameName"],
        "source": payload.get("source") or "wechat_douyin",
        "remark": payload.get("remark") or "",
        "requestedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z"
    })
    GAMEPLAY_REQUESTS_FILE.write_text(json.dumps(lst, ensure_ascii=False, indent=2), encoding="utf-8")


async def _notify_gameplay_request(payload: dict):
    text = f"【玩法解析申请】游戏：{payload['gameName']}，来源：{payload.get('source') or 'wechat_douyin'}"
    if payload.get("remark"):
        text += f"，备注：{payload['remark']}"
    md = f"**玩法解析申请**\n- 游戏：{payload['gameName']}\n- 来源：{payload.get('source') or 'wechat_douyin'}"
    if payload.get("remark"):
        md += f"\n- 备注：{payload['remark']}"
    async with httpx.AsyncClient() as client:
        if FEISHU_WEBHOOK_URL:
            try:
                await client.post(FEISHU_WEBHOOK_URL, json={"msg_type": "text", "content": {"text": text}})
            except Exception as e:
                print("[feedback] 飞书通知失败:", e)
        wecom = WECOM_WEBHOOK_URL
        if wecom:
            try:
                await client.post(wecom, json={"msgtype": "markdown", "markdown": {"content": md}})
            except Exception as e:
                print("[feedback] 企业微信通知失败:", e)


@app.post("/api/feedback/gameplay-request")
async def gameplay_request(body: GameplayRequestBody):
    name = (body.gameName or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="请填写游戏名称")
    payload = {"gameName": name, "source": body.source or "wechat_douyin", "remark": body.remark or ""}
    try:
        _append_gameplay_request(payload)
        await _notify_gameplay_request(payload)
        return {"ok": True}
    except Exception as e:
        print("[feedback] 写入失败:", e)
        raise HTTPException(status_code=500, detail="提交失败，请稍后重试")


# ---------- AI 助手回复质量反馈（赞 / 踩）----------
class AiMessageFeedbackBody(BaseModel):
    messageId: str = ""
    rating: str = ""  # up | down
    sessionId: str = ""
    pathname: str = ""


def _append_ai_message_feedback_line(payload: dict) -> None:
    _ensure_data_dir()
    path = DATA_DIR / "ai_message_feedback.jsonl"
    line = json.dumps(payload, ensure_ascii=False)
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


@app.post("/api/ai/feedback")
async def ai_message_feedback(body: AiMessageFeedbackBody, request: Request):
    """记录用户对某条助手回复的赞/踩；可选登录，便于区分用户。"""
    mid = (body.messageId or "").strip()
    r = (body.rating or "").strip().lower()
    if not mid or r not in ("up", "down"):
        raise HTTPException(status_code=400, detail="参数无效")
    user = await get_current_user_optional(request)
    payload = {
        "messageId": mid,
        "rating": r,
        "sessionId": (body.sessionId or "").strip()[:128],
        "pathname": (body.pathname or "").strip()[:500],
        "user": user or "",
        "at": datetime.utcnow().isoformat() + "Z",
    }
    try:
        _append_ai_message_feedback_line(payload)
        return {"ok": True}
    except Exception as e:
        print("[ai-feedback]", e)
        raise HTTPException(status_code=500, detail="记录失败，请稍后重试")


# ---------- 飞书媒体代理 ----------
async def _get_feishu_tenant_token() -> str:
    import time
    now = time.time()
    if _feishu_token_cache.get("token") and _feishu_token_cache.get("expire_at", 0) > now + 60:
        return _feishu_token_cache["token"]
    if not FEISHU_APP_ID or not FEISHU_APP_SECRET:
        raise ValueError("FEISHU_APP_ID/FEISHU_APP_SECRET 未配置")
    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": FEISHU_APP_ID, "app_secret": FEISHU_APP_SECRET},
        )
        r.raise_for_status()
        data = r.json()
    token = data.get("tenant_access_token")
    if not token:
        raise ValueError("飞书 token 响应缺少 tenant_access_token")
    expire = int(data.get("expire", 3600))
    _feishu_token_cache["token"] = token
    _feishu_token_cache["expire_at"] = now + expire
    return token


def _feishu_media_auth(request: Request) -> bool:
    """生产且未公开时需登录。"""
    if FEISHU_MEDIA_PUBLIC or __import__("os").environ.get("NODE_ENV") != "production":
        return True
    token = get_token_from_request(request)
    if not token:
        return False
    from auth import verify_token
    return verify_token(token) is not None


@app.get("/api/feishu-media")
async def feishu_media(request: Request, url: str = ""):
    raw = (url or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="缺少 url 参数")
    decoded = urllib.parse.unquote(raw) if "%" in raw else raw
    try:
        from urllib.parse import urlparse
        parsed = urlparse(decoded)
        target_url = decoded
        hostname = parsed.hostname or ""
    except Exception:
        raise HTTPException(status_code=400, detail="非法 url")
    if not (hostname.endswith("feishu.cn") or hostname.endswith("open.feishu.cn") or hostname.endswith("larksuite.com")):
        raise HTTPException(status_code=400, detail="非法域名")
    if "/open-apis/drive/v1/medias/" not in decoded:
        raise HTTPException(status_code=400, detail="非法资源路径")
    if not _feishu_media_auth(request):
        raise HTTPException(status_code=401, detail="未登录")
    try:
        token = await _get_feishu_tenant_token()
        async with httpx.AsyncClient() as client:
            r = await client.get(target_url, headers={"Authorization": f"Bearer {token}"})
        if r.status_code != 200:
            from fastapi.responses import Response
            return Response(content=r.content, status_code=r.status_code, media_type=r.headers.get("content-type"))
        from fastapi.responses import Response
        return Response(content=r.content, media_type=r.headers.get("content-type", "application/octet-stream"))
    except Exception as e:
        print("[feishu-media]", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------- AI 对话 ----------
class AIChatBody(BaseModel):
    message: str = ""
    history: list[dict] | None = None
    pageContext: dict[str, Any] | None = None


class PromptLabInspectBody(BaseModel):
    message: str = ""
    pageContext: dict[str, Any] | None = None
    channel: str = "web"


@app.post("/api/ai/prompt-lab/inspect")
async def prompt_lab_inspect(body: PromptLabInspectBody, request: Request):
    await require_user_for_ai(request)
    text = (body.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="缺少提问内容")
    channel = (body.channel or "web").strip() or "web"
    page_context = body.pageContext if isinstance(body.pageContext, dict) else None
    system_content, selected_dbs = build_system_content(text, page_context, channel=channel)
    source_intents = detect_data_source_intents(text, page_context, channel=channel)
    return {
        "channel": channel,
        "selectedDbs": selected_dbs,
        "sourceIntents": source_intents,
        "flags": {
            "trend": is_trend_query(text, page_context),
            "overseas": is_overseas_casual_query(text, page_context),
            "webSearch": should_use_web_search(text, page_context),
        },
        "hints": {
            "sensortowerQuery": "sensortower_query" in system_content,
            "readPublicReport": "read_public_report" in system_content,
            "feishuTableCards": "飞书群消息卡片表格" in system_content,
            "fallbackSql": "只读 SQL 兜底" in system_content,
            "webSearch": "web_search" in system_content,
        },
        "systemPreview": system_content[:1600],
    }


@app.post("/api/ai/prompt-lab/run")
async def prompt_lab_run(body: PromptLabInspectBody, request: Request):
    await require_user_for_ai(request)
    text = (body.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="缺少提问内容")
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="AI 服务未配置，请先在 backend/.env 中配置 OPENAI_API_KEY")
    if not _ai_rate_limiter.allow(_client_rate_key(request, "prompt-lab")):
        raise HTTPException(status_code=429, detail="提问太频繁了，请稍后再试。")
    channel = (body.channel or "web").strip() or "web"
    page_context = body.pageContext if isinstance(body.pageContext, dict) else None
    try:
        result = await run_monitor_assistant(text, [], page_context, channel=channel)
        payload: dict[str, Any] = {
            "answer": result.answer,
            "selectedDbs": result.selected_dbs,
            "toolCalls": result.tool_calls,
        }
        if result.charts:
            payload["charts"] = result.charts
        if result.tables:
            payload["tables"] = result.tables
        return payload
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e)[:1000]) from e
    except HTTPException:
        raise
    except Exception as e:
        print("[prompt-lab-run]", e)
        raise HTTPException(status_code=500, detail="Prompt Lab 运行异常，请稍后重试。") from e


@app.post("/api/ai/chat/stream")
async def ai_chat_stream(body: AIChatBody, request: Request):
    user = await require_user_for_ai(request)
    text = (body.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="缺少提问内容")
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="AI 服务未配置，请先在 backend/.env 中配置 OPENAI_API_KEY")
    if not _ai_rate_limiter.allow(_client_rate_key(request, "ai")):
        raise HTTPException(status_code=429, detail="提问太频繁了，请稍后再试。")

    started = time.monotonic()
    print("[ai-chat-stream] chars=", len(text))

    async def event_generator():
        try:
            if AI_PROVIDER == "codex":
                result = await run_monitor_assistant(text, body.history, body.pageContext, channel="web")
                answer = result.answer
                step = 256
                for i in range(0, len(answer), step):
                    yield _sse_event("delta", {"delta": answer[i : i + step]})
                if not answer.strip():
                    yield _sse_event("error", {"error": "大模型返回为空，请稍后重试。"})
                    return
                _append_assistant_audit({
                    "channel": "web_stream",
                    "provider": AI_PROVIDER,
                    "user": user or "",
                    "status": "done",
                    "question": text,
                    "answerChars": len(answer),
                    "selectedDbs": result.selected_dbs,
                    "toolCallCount": len(result.tool_calls),
                    "elapsedMs": int((time.monotonic() - started) * 1000),
                })
                yield _sse_event("done", {"answer": answer})
                return

            if AI_PROVIDER == "openrouter":
                import asyncio

                sse_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

                async def _run_openrouter():
                    try:
                        def on_tool_call(name: str, args: dict[str, Any]) -> None:
                            display = tool_display_name(name)
                            sse_queue.put_nowait({"event": "thinking", "data": {"tool": name, "display": display}})

                        result = await run_monitor_assistant(
                            text,
                            body.history,
                            body.pageContext,
                            channel="web",
                            on_tool_call=on_tool_call,
                        )
                        answer = result.answer
                        step = 256
                        for i in range(0, len(answer), step):
                            sse_queue.put_nowait({"event": "delta", "data": {"delta": answer[i : i + step]}})
                        if not answer.strip():
                            sse_queue.put_nowait({"event": "error", "data": {"error": "大模型返回为空，请稍后重试。"}})
                        else:
                            for cp in result.charts:
                                sse_queue.put_nowait({"event": "chart", "data": {"chart": cp}})
                            sse_queue.put_nowait({
                                "event": "done",
                                "data": {
                                    "answer": answer,
                                    "selectedDbs": result.selected_dbs,
                                    "toolCalls": result.tool_calls,
                                },
                            })
                            _append_assistant_audit({
                                "channel": "web_stream",
                                "provider": AI_PROVIDER,
                                "user": user or "",
                                "status": "done",
                                "question": text,
                                "answerChars": len(answer),
                                "selectedDbs": result.selected_dbs,
                                "toolCallCount": len(result.tool_calls),
                                "elapsedMs": int((time.monotonic() - started) * 1000),
                            })
                    except Exception as e:
                        _append_assistant_audit({
                            "channel": "web_stream",
                            "provider": AI_PROVIDER,
                            "user": user or "",
                            "status": "error",
                            "question": text,
                            "error": str(e),
                            "elapsedMs": int((time.monotonic() - started) * 1000),
                        })
                        sse_queue.put_nowait({"event": "error", "data": {"error": str(e)[:500]}})
                    finally:
                        sse_queue.put_nowait(None)

                asyncio.create_task(_run_openrouter())

                while True:
                    item = await sse_queue.get()
                    if item is None:
                        return
                    yield _sse_event(item["event"], item["data"])
                    if item["event"] in ("done", "error"):
                        return

            messages, selected_dbs = assistant_build_messages_for_request(text, body.history, body.pageContext, channel="web")
            full = ""
            async for chunk in assistant_stream_openai_text_chunks(messages):
                full += chunk
                yield _sse_event("delta", {"delta": chunk})
            if not full.strip():
                yield _sse_event("error", {"error": "大模型返回为空，请稍后重试。"})
                return
            _append_assistant_audit({
                "channel": "web_stream",
                "provider": AI_PROVIDER,
                "user": user or "",
                "status": "done",
                "question": text,
                "answerChars": len(full),
                "selectedDbs": selected_dbs,
                "toolCallCount": 0,
                "elapsedMs": int((time.monotonic() - started) * 1000),
            })
            yield _sse_event("done", {"answer": full, "selectedDbs": selected_dbs})
        except CodexProtocolError as e:
            print("[ai-chat-stream-codex]", e)
            yield _sse_event("error", {"error": f"Codex 协议错误: {e}"})
        except HTTPException as e:
            detail = e.detail if isinstance(e.detail, str) else str(e.detail)
            yield _sse_event("error", {"error": detail or "请求失败"})
        except ValueError as e:
            print("[ai-chat-stream-upstream]", e)
            yield _sse_event("error", {"error": str(e)[:800]})
        except Exception as e:
            print("[ai-chat-stream]", e)
            yield _sse_event("error", {"error": "AI 流式对话异常，请稍后重试。"})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream; charset=utf-8",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/ai/chat")
async def ai_chat(body: AIChatBody, request: Request):
    user = await require_user_for_ai(request)  # 生产时要求登录，开发时可选
    text = (body.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="缺少提问内容")
    print("[ai-chat]", f"chars={len(text)}", f"provider={AI_PROVIDER}")
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="AI 服务未配置，请先在 backend/.env 中配置 OPENAI_API_KEY")
    if not _ai_rate_limiter.allow(_client_rate_key(request, "ai")):
        raise HTTPException(status_code=429, detail="提问太频繁了，请稍后再试。")
    started = time.monotonic()
    try:
        result = await run_monitor_assistant(text, body.history, body.pageContext, channel="web")
        print("[ai-chat] success", f"chars={len(result.answer)}", f"dbs={','.join(result.selected_dbs[:4])}")
        _append_assistant_audit({
            "channel": "web",
            "provider": AI_PROVIDER,
            "user": user or "",
            "status": "done",
            "question": text,
            "answerChars": len(result.answer),
            "selectedDbs": result.selected_dbs,
            "toolCallCount": len(result.tool_calls),
            "elapsedMs": int((time.monotonic() - started) * 1000),
        })
        payload: dict[str, Any] = {
            "answer": result.answer,
            "selectedDbs": result.selected_dbs,
        }
        if result.charts:
            payload["charts"] = result.charts
        if result.tool_calls:
            payload["toolCalls"] = result.tool_calls
        return payload
    except CodexProtocolError as e:
        print("[ai-chat-codex]", e)
        _append_assistant_audit({
            "channel": "web",
            "provider": AI_PROVIDER,
            "user": user or "",
            "status": "error",
            "question": text,
            "error": str(e),
            "elapsedMs": int((time.monotonic() - started) * 1000),
        })
        raise HTTPException(status_code=502, detail=f"Codex 协议错误: {e}")
    except ValueError as e:
        print("[ai-chat-upstream]", e)
        _append_assistant_audit({
            "channel": "web",
            "provider": AI_PROVIDER,
            "user": user or "",
            "status": "error",
            "question": text,
            "error": str(e),
            "elapsedMs": int((time.monotonic() - started) * 1000),
        })
        raise HTTPException(status_code=502, detail=str(e)[:1000])
    except HTTPException:
        raise
    except Exception as e:
        print("[ai-chat]", e)
        _append_assistant_audit({
            "channel": "web",
            "provider": AI_PROVIDER,
            "user": user or "",
            "status": "error",
            "question": text,
            "error": str(e),
            "elapsedMs": int((time.monotonic() - started) * 1000),
        })
        raise HTTPException(status_code=500, detail="AI 对话服务异常，请稍后重试。")


# ---------- 飞书监测助手 ----------
async def _run_monitor_assistant_for_feishu(
    text: str,
    history: list[dict] | None,
    context: dict[str, Any] | None,
) -> str:
    result = await run_monitor_assistant(text, history, context, channel=str((context or {}).get("channel") or "feishu"))
    return result.answer


async def _process_feishu_message_event(event) -> None:
    user_key = event.sender_open_id or event.sender_union_id
    session_key = event.session_key
    started = time.monotonic()
    try:
        if not _feishu_rate_limiter.allow(user_key or session_key):
            await _feishu_bot_client.reply_text(
                event.message_id,
                "当前提问有点密集，我先保护一下模型和数据查询服务。请稍等一分钟再继续。",
                uuid_prefix=f"{event.event_id}:rate-limit",
            )
            _assistant_session_store.mark_event_done(event.event_id, "rate_limited")
            return

        if not is_feishu_event_allowed(event, FEISHU_ALLOWED_OPEN_IDS, FEISHU_ALLOWED_CHAT_IDS):
            await _feishu_bot_client.reply_text(
                event.message_id,
                "你暂时没有使用监测助手的权限，请联系管理员加入飞书助手白名单。",
                uuid_prefix=f"{event.event_id}:denied",
            )
            _assistant_session_store.mark_event_done(event.event_id, "denied")
            return

        normalized_command = event.text.strip().lower()
        if normalized_command in {"清空上下文", "重新开始", "重置会话", "/reset", "reset"}:
            removed = _assistant_session_store.clear_session(session_key)
            await _feishu_bot_client.reply_text(
                event.message_id,
                f"已清空当前会话上下文（{removed} 条历史）。接下来我会从新问题开始回答。",
                uuid_prefix=f"{event.event_id}:reset",
            )
            _assistant_session_store.mark_event_done(event.event_id, "reset")
            return

        history = _assistant_session_store.load_history(session_key, ASSISTANT_MAX_HISTORY_TURNS)
        _assistant_session_store.append_message(
            session_key,
            "user",
            event.text,
            channel=event.channel,
            user_key=user_key,
        )

        if FEISHU_ASSISTANT_SEND_THINKING:
            await _feishu_bot_client.reply_text(
                event.message_id,
                "收到，我在查询监测数据并整理答案。",
                uuid_prefix=f"{event.event_id}:thinking",
            )

        context = build_assistant_context(event)
        prompt = (
            "你正在飞书里回答用户。请用适合飞书阅读的中文回复：先给结论，再给关键依据；"
            "默认控制在 800 字以内，列表不超过 10 条；不要暴露数据库名、表名、SQL、内部路径或密钥。"
            "\n\n用户问题："
            + event.text
        )
        answer = await _run_monitor_assistant_for_feishu(prompt, history, context)
        answer = (answer or "").strip() or "我这边没有生成可用回答，请换个问法再试一次。"
        _append_assistant_audit({
            "channel": event.channel,
            "provider": AI_PROVIDER,
            "user": user_key,
            "sessionKey": session_key,
            "status": "done",
            "question": event.text,
            "answerChars": len(answer),
            "elapsedMs": int((time.monotonic() - started) * 1000),
        })
        _assistant_session_store.append_message(
            session_key,
            "assistant",
            answer,
            channel=event.channel,
            user_key=user_key,
        )
        await _feishu_bot_client.reply_text(
            event.message_id,
            answer,
            uuid_prefix=f"{event.event_id}:answer",
        )
        _assistant_session_store.mark_event_done(event.event_id, "done")
    except Exception as e:
        err = str(e)[:1000]
        print("[feishu-assistant]", err)
        _append_assistant_audit({
            "channel": getattr(event, "channel", "feishu"),
            "provider": AI_PROVIDER,
            "user": user_key,
            "sessionKey": session_key,
            "status": "error",
            "question": getattr(event, "text", ""),
            "error": err,
            "elapsedMs": int((time.monotonic() - started) * 1000),
        })
        _assistant_session_store.mark_event_done(event.event_id, "error", err)
        try:
            await _feishu_bot_client.reply_text(
                event.message_id,
                "监测助手这次处理失败了，请稍后重试；如果连续失败，请联系管理员查看后端日志。",
                uuid_prefix=f"{event.event_id}:error",
            )
        except Exception as notify_error:
            print("[feishu-assistant-notify]", notify_error)


@app.post("/api/feishu/events")
async def feishu_events(request: Request):
    """飞书自建应用机器人事件订阅入口。"""
    if not FEISHU_BOT_ENABLED:
        return {"ok": True, "ignored": "feishu bot disabled"}

    raw = await request.body()
    if FEISHU_ENCRYPT_KEY and not verify_feishu_signature(request.headers, raw, FEISHU_ENCRYPT_KEY):
        raise HTTPException(status_code=401, detail="飞书事件签名校验失败")

    try:
        payload = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="飞书事件不是合法 JSON") from None

    try:
        verification = handle_url_verification(payload, FEISHU_VERIFICATION_TOKEN)
        if verification is not None:
            print("[feishu-events] url_verification ok")
            return verification

        event = parse_message_event(payload, FEISHU_VERIFICATION_TOKEN, FEISHU_BOT_MENTION_NAMES)
        if event is None:
            header = payload.get("header") if isinstance(payload.get("header"), dict) else {}
            print("[feishu-events] ignored unsupported", {
                "type": payload.get("type"),
                "event_type": header.get("event_type") or payload.get("event_type"),
            })
            return {"ok": True, "ignored": "unsupported event"}
        if event.requires_mention_but_missing:
            print("[feishu-events] ignored group without mention", {
                "event_id": event.event_id,
                "chat_id": event.chat_id,
                "text": event.text[:80],
            })
            return {"ok": True, "ignored": "group message without bot mention"}

        if not _assistant_session_store.mark_event_received(event.event_id):
            print("[feishu-events] ignored duplicate", {"event_id": event.event_id})
            return {"ok": True, "ignored": "duplicate event"}

        print("[feishu-events] accepted", {
            "event_id": event.event_id,
            "channel": event.channel,
            "chat_type": event.chat_type,
            "text": event.text[:80],
        })
        asyncio.create_task(_process_feishu_message_event(event))
        return {"ok": True}
    except FeishuEventError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _cleanup_old_db_snapshots() -> None:
    try:
        cutoff = time.time() - max(DB_SNAPSHOT_TTL_SEC, 60)
        for path in DB_SNAPSHOT_DIR.glob("api_*.db"):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink(missing_ok=True)
            except OSError:
                continue
    except OSError:
        return


def _remove_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _create_sqlite_snapshot(source_path: Path, db_name: str) -> Path:
    """用 SQLite backup API 生成一致快照，避免直接下载正在写入/WAL 中的源库。"""
    DB_SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    _cleanup_old_db_snapshots()
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", db_name)
    snapshot_path = DB_SNAPSHOT_DIR / f"api_{safe_name}.{os.getpid()}.{int(time.time() * 1000)}.db"
    src = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True, timeout=15)
    try:
        dst = sqlite3.connect(str(snapshot_path))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    return snapshot_path


async def _source_db_file_response(db_name: str, source_path: Path) -> FileResponse:
    snapshot_path = await asyncio.to_thread(_create_sqlite_snapshot, source_path, db_name)
    return FileResponse(
        snapshot_path,
        media_type="application/octet-stream",
        filename=db_name,
        background=BackgroundTask(_remove_file, snapshot_path),
    )


# ---------- 受保护数据文件 ----------
@app.get("/api/data/{filename:path}")
async def serve_data(filename: str, request: Request):
    """已登录用户可访问数据文件；根目录 canonical .db 直接来自上游源库快照。"""
    await get_current_user(request)
    decoded = urllib.parse.unquote(filename)
    if not decoded or ".." in decoded:
        raise HTTPException(status_code=400, detail="非法路径")
    rel = decoded.replace("\\", "/").lstrip("/")
    if not rel:
        raise HTTPException(status_code=400, detail="非法路径")
    basename = Path(rel).name
    if basename.startswith("."):
        raise HTTPException(status_code=400, detail="非法路径")
    if basename in DATA_SERVE_DENYLIST_BASENAMES:
        raise HTTPException(status_code=404, detail="文件不存在")
    if "/" not in rel and basename in DATA_SOURCE_DB_PATHS:
        source_path = DATA_SOURCE_DB_PATHS[basename]
        if not source_path.exists():
            raise HTTPException(status_code=404, detail="文件不存在")
        return await _source_db_file_response(basename, source_path)
    file_path = (PUBLIC_DIR / rel).resolve()
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    base = PUBLIC_DIR.resolve()
    if os.path.commonpath([str(file_path), str(base)]) != str(base):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(file_path)


# ---------- 启动 ----------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
