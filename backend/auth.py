"""JWT 鉴权：创建/校验 token，依赖项 get_current_user。"""
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException, Request
import jwt as pyjwt

from config import JWT_SECRET, AI_CHAT_REQUIRE_AUTH

ALGORITHM = "HS256"
EXPIRE_DAYS = 7


def create_token(username: str) -> str:
    payload = {"username": username, "exp": datetime.utcnow() + timedelta(days=EXPIRE_DAYS)}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def verify_token(token: str) -> str | None:
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        return payload.get("username")
    except Exception:
        return None


def get_token_from_request(request: Request) -> str | None:
    token = request.cookies.get("token")
    if token:
        return token
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    return None


async def get_current_user(request: Request) -> str:
    """依赖：必须登录，否则 401。"""
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    username = verify_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="登录已过期")
    return username


async def get_current_user_optional(request: Request) -> str | None:
    """依赖：能取到用户就取，取不到返回 None。"""
    token = get_token_from_request(request)
    if not token:
        return None
    return verify_token(token)


def ai_chat_auth_required() -> bool:
    """生产环境且未关闭时，AI 对话需要登录。"""
    return AI_CHAT_REQUIRE_AUTH


async def require_user_for_ai(request: Request) -> str | None:
    """AI 对话用：若配置要求登录则必须带有效 token，否则不强制。"""
    if not ai_chat_auth_required():
        return None
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    username = verify_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="登录已过期")
    return username
