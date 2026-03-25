"""
监测汇总 - FastAPI 后端
提供：登录鉴权、受保护数据文件、AI 对话代理、玩法解析申请、飞书媒体代理。
"""
from pathlib import Path
import json
import os
import urllib.parse
import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from passlib.hash import pbkdf2_sha256

from config import (
    PORT,
    CORS_ORIGINS,
    JWT_SECRET,
    LOGIN_USERNAME,
    LOGIN_PASSWORD_HASH,
    PUBLIC_DIR,
    DATA_DIR,
    ALLOWED_PREFIXES,
    ALLOWED_ROOT_FILES,
    FEISHU_APP_ID,
    FEISHU_APP_SECRET,
    FEISHU_MEDIA_PUBLIC,
    FEISHU_WEBHOOK_URL,
    WECOM_WEBHOOK_URL,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_MODEL,
    AI_PROVIDER,
    CODEX_APP_SERVER_BIN,
    CODEX_MODEL,
    CODEX_WORKDIR,
    CODEX_TURN_TIMEOUT_SEC,
    CODEX_ENABLE_DB_TOOL,
    CODEX_ENABLE_WEB_SEARCH_TOOL,
    TAVILY_API_KEY,
)
from auth import create_token, get_current_user, get_token_from_request, require_user_for_ai
from codex_app_server import CodexAppServerSession, CodexProtocolError

app = FastAPI(title="监测汇总 API")
CORS_ALLOW_CREDENTIALS = CORS_ORIGINS != ["*"]
PROJECT_ROOT = Path(__file__).resolve().parent.parent

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

IS_DEV_NO_PASSWORD = not LOGIN_PASSWORD_HASH
GAMEPLAY_REQUESTS_FILE = DATA_DIR / "gameplay_requests.json"
USERS_FILE = DATA_DIR / "users.json"
_feishu_token_cache: dict = {"token": "", "expire_at": 0}


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
    # 仅支持单一管理员账号 LOGIN_USERNAME / 管理员明文密码（本地和小团队内网使用足够）
    if username != LOGIN_USERNAME:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    # 优先从环境变量 ADMIN_PASSWORD 读取；未设置时默认 guru666
    admin_pwd = os.environ.get("ADMIN_PASSWORD", "guru666")
    if password != admin_pwd:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = create_token(username)
    resp = JSONResponse(content={"user": username})
    resp.set_cookie("token", token, httponly=True, max_age=7 * 24 * 3600, samesite="lax")
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


@app.post("/api/logout")
async def logout():
    resp = JSONResponse(content={"ok": True})
    resp.delete_cookie("token")
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


def _classify_intent(text: str, history: list[dict] | None = None) -> dict[str, object]:
    full = " ".join(
        [text]
        + [
            str(item.get("content") or "")
            for item in (history or [])
            if isinstance(item, dict) and isinstance(item.get("content"), str)
        ]
    ).lower()
    db_keywords = [
        "数据库",
        "sql",
        "sqlite",
        "表",
        "字段",
        "排行",
        "rank",
        "wechatdouyin",
        "competitor_data",
        "sensortower",
    ]
    web_keywords = [
        "联网",
        "搜索",
        "最新",
        "今天",
        "新闻",
        "官网",
        "链接",
        "来源",
        "web",
        "url",
    ]
    hybrid_hints = ["对比", "结合", "同时", "再", "之后", "并且"]

    needs_db = any(k in full for k in db_keywords)
    needs_web = any(k in full for k in web_keywords)
    if any(k in full for k in hybrid_hints) and (needs_db or needs_web):
        # If user asks to compare/combine, bias to hybrid planning.
        needs_db = True if needs_db or "数据库" in full or "sql" in full else needs_db
        needs_web = True if needs_web or "新闻" in full or "最新" in full else needs_web

    if needs_db and needs_web:
        mode = "hybrid"
        steps = [
            "先调用 query_sqlite 获取结构化事实。",
            "再调用 web_search 获取最新外部信息。",
            "最后对齐口径并给出结论与引用来源。",
        ]
    elif needs_db:
        mode = "db_only"
        steps = [
            "仅调用 query_sqlite 获取数据。",
            "如 SQL 失败，先用 PRAGMA table_info(表名) 确认字段后重试。",
            "基于查询结果输出结论。",
        ]
    elif needs_web:
        mode = "web_only"
        steps = [
            "仅调用 web_search 获取外部信息。",
            "优先保留来源链接与发布时间。",
            "基于搜索结果输出结论。",
        ]
    else:
        mode = "chat_only"
        steps = [
            "无需调用工具，直接回答。",
            "若缺少事实再建议用户补充问题。",
        ]
    return {"mode": mode, "needs_db": needs_db, "needs_web": needs_web, "steps": steps}


def _attach_execution_plan(text: str, plan: dict[str, object]) -> str:
    steps = plan.get("steps") if isinstance(plan.get("steps"), list) else []
    plan_lines = "\n".join(f"- {str(s)}" for s in steps)
    mode = str(plan.get("mode") or "chat_only")
    return (
        f"【执行模式】{mode}\n"
        f"【执行步骤】\n{plan_lines}\n"
        "【约束】仅在需要时调用工具；回答必须明确是否使用了工具与关键来源。\n\n"
        f"【用户问题】{text}"
    )


def _build_openai_messages(text: str, history: list[dict] | None) -> list[dict[str, str]]:
    messages = [
        {
            "role": "system",
            "content": "你是「监测汇总」内部平台的智能助手，擅长解读 AI 热点、趋势监测、休闲游戏监测和 AI 产品监测相关的数据和周报。回答时尽量用简洁的中文分点说明，给出可执行的建议。若问题超出本平台范围，也可以进行一般性答疑。",
        }
    ]
    for item in history or []:
        if not item or not isinstance(item.get("role"), str) or not isinstance(item.get("content"), str):
            continue
        role = item["role"] if item["role"] in ("assistant", "system") else "user"
        messages.append({"role": role, "content": item["content"]})
    messages.append({"role": "user", "content": text})
    return messages


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


async def _chat_via_openai(text: str, history: list[dict] | None) -> str:
    messages = _build_openai_messages(text, history)
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(
            f"{OPENAI_BASE_URL}/chat/completions",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={"model": OPENAI_MODEL, "messages": messages},
        )
    if r.status_code != 200:
        print("[ai-chat] upstream", r.status_code, r.text[:500])
        raise HTTPException(status_code=502, detail="调用大模型失败，请稍后重试。")
    data = r.json()
    content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    if not content and data.get("choices"):
        content = (data["choices"][0].get("delta") or {}).get("content") or ""
    if not content:
        raise HTTPException(status_code=500, detail="大模型返回为空，请稍后重试。")
    return content


async def _chat_via_codex(text: str, history: list[dict] | None) -> str:
    workdir = Path(CODEX_WORKDIR).expanduser() if CODEX_WORKDIR else PROJECT_ROOT
    print(
        "[ai-codex-config]",
        {
            "AI_PROVIDER": AI_PROVIDER,
            "CODEX_MODEL": CODEX_MODEL,
            "OPENAI_BASE_URL": OPENAI_BASE_URL,
            "OPENAI_API_KEY_prefix": f"{OPENAI_API_KEY[:10]}..." if OPENAI_API_KEY else "",
            "CODEX_APP_SERVER_BIN": CODEX_APP_SERVER_BIN,
            "CODEX_WORKDIR": str(workdir),
        },
    )
    print("[ai-step1-codex] start", f"model={CODEX_MODEL}", f"workdir={workdir}")
    print(
        "[codex-subprocess-env]",
        {
            "OPENAI_BASE_URL": OPENAI_BASE_URL,
            "OPENAI_API_KEY_prefix": f"{OPENAI_API_KEY[:10]}..." if OPENAI_API_KEY else "",
            "MODEL": CODEX_MODEL,
            "CWD": str(workdir),
            "HTTP_PROXY": bool(os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")),
            "HTTPS_PROXY": bool(os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")),
            "ALL_PROXY": bool(os.environ.get("ALL_PROXY") or os.environ.get("all_proxy")),
        },
    )
    async with CodexAppServerSession(
        bin_name=CODEX_APP_SERVER_BIN,
        model=CODEX_MODEL,
        project_root=PROJECT_ROOT,
        public_dir=PUBLIC_DIR,
        workdir=workdir,
        turn_timeout_sec=CODEX_TURN_TIMEOUT_SEC,
        enable_db_tool=CODEX_ENABLE_DB_TOOL,
        enable_web_search_tool=CODEX_ENABLE_WEB_SEARCH_TOOL,
        tavily_api_key=TAVILY_API_KEY,
        subprocess_env=_build_codex_subprocess_env(),
    ) as session:
        return await session.run_chat(text, history)


@app.post("/api/ai/chat")
async def ai_chat(body: AIChatBody, request: Request):
    await require_user_for_ai(request)  # 生产时要求登录，开发时可选
    text = (body.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="缺少提问内容")
    plan = _classify_intent(text, body.history)
    planned_text = _attach_execution_plan(text, plan)
    print("[ai-intent]", plan)
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="AI 服务未配置，请先在 backend/.env 中配置 OPENAI_API_KEY")
    try:
        if AI_PROVIDER == "codex":
            try:
                answer = await _chat_via_codex(planned_text, body.history)
                print("[ai-step1-codex] success", f"chars={len(answer)}")
                return {"answer": answer}
            except CodexProtocolError as e:
                print("[ai-step1-codex] failed", e)
                raise HTTPException(status_code=502, detail=f"Codex 协议错误: {e}")

        print("[ai-step2-responses] start", f"model={OPENAI_MODEL}")
        answer = await _chat_via_openai(planned_text, body.history)
        print("[ai-step2-responses] success", f"chars={len(answer)}")
        return {"answer": answer}
    except HTTPException:
        raise
    except Exception as e:
        print("[ai-chat]", e)
        raise HTTPException(status_code=500, detail="AI 对话服务异常，请稍后重试。")


# ---------- 受保护数据文件 ----------
@app.get("/api/data/{filename:path}")
async def serve_data(filename: str, request: Request):
    await get_current_user(request)
    decoded = urllib.parse.unquote(filename)
    if not decoded or ".." in decoded:
        raise HTTPException(status_code=400, detail="非法路径")
    if "/" in decoded:
        if not any(decoded.startswith(p) for p in ALLOWED_PREFIXES):
            raise HTTPException(status_code=400, detail="非法路径")
        file_path = PUBLIC_DIR / decoded
    else:
        if decoded not in ALLOWED_ROOT_FILES:
            raise HTTPException(status_code=404, detail="文件不存在")
        file_path = PUBLIC_DIR / decoded
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    real = file_path.resolve()
    base = PUBLIC_DIR.resolve()
    if os.path.commonpath([str(real), str(base)]) != str(base):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(file_path)


# ---------- 启动 ----------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
