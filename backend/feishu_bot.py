"""飞书机器人事件接入、会话存储与消息回复。"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import base64
import hashlib
import hmac
import json
from pathlib import Path
import sqlite3
import time
import uuid
from typing import Any

import httpx


class FeishuEventError(ValueError):
    """飞书事件无法校验或解析。"""


@dataclass(frozen=True)
class FeishuMessageEvent:
    event_id: str
    event_type: str
    message_id: str
    chat_id: str
    chat_type: str
    root_id: str
    parent_id: str
    sender_open_id: str
    sender_union_id: str
    text: str
    mention_keys: tuple[str, ...]
    text_has_mention: bool
    bot_mentioned: bool
    raw: dict[str, Any]

    @property
    def channel(self) -> str:
        return "feishu_group" if self.chat_type == "group" else "feishu_dm"

    @property
    def session_key(self) -> str:
        if self.chat_type == "group" and self.chat_id:
            thread_id = self.root_id or self.parent_id
            if thread_id:
                return f"feishu:group:{self.chat_id}:thread:{thread_id}"
            return f"feishu:group:{self.chat_id}"
        return f"feishu:user:{self.sender_open_id or self.sender_union_id or self.message_id}"

    @property
    def requires_mention_but_missing(self) -> bool:
        return self.chat_type == "group" and not self.bot_mentioned


class FeishuBotClient:
    def __init__(self, app_id: str, app_secret: str) -> None:
        self.app_id = app_id.strip()
        self.app_secret = app_secret.strip()
        self._tenant_token = ""
        self._tenant_token_expire_at = 0.0

    async def tenant_access_token(self) -> str:
        now = time.time()
        if self._tenant_token and self._tenant_token_expire_at > now + 60:
            return self._tenant_token
        if not self.app_id or not self.app_secret:
            raise FeishuEventError("FEISHU_APP_ID/FEISHU_APP_SECRET 未配置")
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": self.app_id, "app_secret": self.app_secret},
            )
            r.raise_for_status()
            data = r.json()
        if data.get("code") not in (0, None):
            raise FeishuEventError(f"获取飞书 tenant_access_token 失败: {data.get('msg') or data}")
        token = str(data.get("tenant_access_token") or "").strip()
        if not token:
            raise FeishuEventError("飞书 token 响应缺少 tenant_access_token")
        self._tenant_token = token
        self._tenant_token_expire_at = now + int(data.get("expire") or 3600)
        return token

    async def reply_text(self, message_id: str, text: str, *, uuid_prefix: str | None = None) -> None:
        token = await self.tenant_access_token()
        chunks = _chunk_text(text, 3500)
        prefix = uuid_prefix or message_id or str(uuid.uuid4())
        async with httpx.AsyncClient(timeout=30.0) as client:
            for idx, chunk in enumerate(chunks):
                payload = {
                    "msg_type": "text",
                    "content": json.dumps({"text": chunk}, ensure_ascii=False),
                    "reply_in_thread": True,
                    "uuid": _stable_uuid(f"{prefix}:{idx}:{chunk[:80]}"),
                }
                r = await client.post(
                    f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/reply",
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json=payload,
                )
                if r.status_code >= 400:
                    body = r.text[:1000]
                    raise FeishuEventError(f"飞书回复 HTTP {r.status_code}: {body}")
                data = r.json()
                if data.get("code") != 0:
                    raise FeishuEventError(f"飞书回复失败: code={data.get('code')} msg={data.get('msg')}")

    async def reply_interactive_card(
        self,
        message_id: str,
        card: dict[str, Any],
        *,
        uuid_prefix: str | None = None,
    ) -> None:
        token = await self.tenant_access_token()
        prefix = uuid_prefix or message_id or str(uuid.uuid4())
        card_seed = json.dumps(card, ensure_ascii=False, sort_keys=True)[:120]
        payload = {
            "msg_type": "interactive",
            "content": json.dumps(card, ensure_ascii=False),
            "reply_in_thread": True,
            "uuid": _stable_uuid(f"{prefix}:interactive:{card_seed}"),
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/reply",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
            )
        if r.status_code >= 400:
            raise FeishuEventError(f"飞书卡片回复 HTTP {r.status_code}: {r.text[:1000]}")
        data = r.json()
        if data.get("code") != 0:
            raise FeishuEventError(f"飞书卡片回复失败: code={data.get('code')} msg={data.get('msg')}")

    async def upload_image(self, image_bytes: bytes, *, filename: str = "chart.png") -> str:
        token = await self.tenant_access_token()
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                "https://open.feishu.cn/open-apis/im/v1/images",
                headers={"Authorization": f"Bearer {token}"},
                data={"image_type": "message"},
                files={"image": (filename, image_bytes, "image/png")},
            )
        if r.status_code >= 400:
            raise FeishuEventError(f"飞书上传图片 HTTP {r.status_code}: {r.text[:1000]}")
        data = r.json()
        if data.get("code") != 0:
            raise FeishuEventError(f"飞书上传图片失败: code={data.get('code')} msg={data.get('msg')}")
        image_key = str((data.get("data") or {}).get("image_key") or "").strip()
        if not image_key:
            raise FeishuEventError("飞书上传图片响应缺少 image_key")
        return image_key

    async def upload_file(
        self,
        file_bytes: bytes,
        *,
        filename: str,
        file_type: str = "stream",
        content_type: str = "application/octet-stream",
    ) -> str:
        token = await self.tenant_access_token()
        safe_filename = filename.strip() or "attachment.bin"
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                "https://open.feishu.cn/open-apis/im/v1/files",
                headers={"Authorization": f"Bearer {token}"},
                data={"file_type": file_type, "file_name": safe_filename},
                files={"file": (safe_filename, file_bytes, content_type)},
            )
        if r.status_code >= 400:
            raise FeishuEventError(f"飞书上传文件 HTTP {r.status_code}: {r.text[:1000]}")
        data = r.json()
        if data.get("code") != 0:
            raise FeishuEventError(f"飞书上传文件失败: code={data.get('code')} msg={data.get('msg')}")
        file_key = str((data.get("data") or {}).get("file_key") or "").strip()
        if not file_key:
            raise FeishuEventError("飞书上传文件响应缺少 file_key")
        return file_key

    async def download_external_file(self, url: str, *, max_bytes: int = 30 * 1024 * 1024) -> bytes:
        target = (url or "").strip()
        if not target.startswith(("http://", "https://")):
            raise FeishuEventError("视频 URL 非法")
        async with httpx.AsyncClient(timeout=90.0, follow_redirects=True) as client:
            r = await client.get(target)
        if r.status_code >= 400:
            raise FeishuEventError(f"下载视频 HTTP {r.status_code}: {r.text[:500]}")
        content = r.content or b""
        if not content:
            raise FeishuEventError("下载视频为空")
        if len(content) > max_bytes:
            raise FeishuEventError(f"视频超过飞书上传上限：{len(content)} bytes")
        return content

    async def reply_video(
        self,
        message_id: str,
        video_bytes: bytes,
        *,
        filename: str = "video.mp4",
        uuid_prefix: str | None = None,
    ) -> None:
        file_key = await self.upload_file(
            video_bytes,
            filename=filename,
            file_type="mp4",
            content_type="video/mp4",
        )
        token = await self.tenant_access_token()
        prefix = uuid_prefix or message_id or str(uuid.uuid4())
        payload = {
            "msg_type": "media",
            "content": json.dumps({"file_key": file_key}, ensure_ascii=False),
            "reply_in_thread": True,
            "uuid": _stable_uuid(f"{prefix}:media:{file_key}"),
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/reply",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
            )
        if r.status_code >= 400:
            raise FeishuEventError(f"飞书视频回复 HTTP {r.status_code}: {r.text[:1000]}")
        data = r.json()
        if data.get("code") != 0:
            raise FeishuEventError(f"飞书视频回复失败: code={data.get('code')} msg={data.get('msg')}")

    async def reply_video_url(
        self,
        message_id: str,
        video_url: str,
        *,
        filename: str = "video.mp4",
        uuid_prefix: str | None = None,
    ) -> None:
        video_bytes = await self.download_external_file(video_url)
        await self.reply_video(
            message_id,
            video_bytes,
            filename=filename,
            uuid_prefix=uuid_prefix,
        )

    async def reply_image(
        self,
        message_id: str,
        image_bytes: bytes,
        *,
        uuid_prefix: str | None = None,
        filename: str = "chart.png",
    ) -> None:
        image_key = await self.upload_image(image_bytes, filename=filename)
        token = await self.tenant_access_token()
        prefix = uuid_prefix or message_id or str(uuid.uuid4())
        payload = {
            "msg_type": "image",
            "content": json.dumps({"image_key": image_key}, ensure_ascii=False),
            "reply_in_thread": True,
            "uuid": _stable_uuid(f"{prefix}:image:{image_key}"),
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/reply",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
            )
        if r.status_code >= 400:
            raise FeishuEventError(f"飞书图片回复 HTTP {r.status_code}: {r.text[:1000]}")
        data = r.json()
        if data.get("code") != 0:
            raise FeishuEventError(f"飞书图片回复失败: code={data.get('code')} msg={data.get('msg')}")


class AssistantSessionStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    error TEXT DEFAULT ''
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_key TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    channel TEXT NOT NULL,
                    user_key TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_key, id)")

    def mark_event_received(self, event_id: str) -> bool:
        if not event_id:
            return True
        try:
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO events(event_id, status, created_at) VALUES (?, ?, ?)",
                    (event_id, "received", _utc_now()),
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def mark_event_done(self, event_id: str, status: str, error: str = "") -> None:
        if not event_id:
            return
        with self._connect() as conn:
            conn.execute(
                "UPDATE events SET status = ?, error = ? WHERE event_id = ?",
                (status[:40], error[:1000], event_id),
            )

    def load_history(self, session_key: str, max_turns: int) -> list[dict[str, str]]:
        limit = max(0, max_turns) * 2
        if limit <= 0:
            return []
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT role, content
                FROM messages
                WHERE session_key = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (session_key, limit),
            ).fetchall()
        out: list[dict[str, str]] = []
        for row in reversed(rows):
            role = row["role"] if row["role"] in ("user", "assistant", "system") else "user"
            content = str(row["content"] or "").strip()
            if content:
                out.append({"role": role, "content": content})
        return out

    def append_message(
        self,
        session_key: str,
        role: str,
        content: str,
        *,
        channel: str,
        user_key: str = "",
    ) -> None:
        text = (content or "").strip()
        if not session_key or not text:
            return
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO messages(session_key, role, content, channel, user_key, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (session_key, role, text[:20000], channel, user_key[:200], _utc_now()),
            )

    def clear_session(self, session_key: str) -> int:
        if not session_key:
            return 0
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM messages WHERE session_key = ?", (session_key,))
            return int(cur.rowcount or 0)


def verify_feishu_signature(headers: Any, raw_body: bytes, encrypt_key: str) -> bool:
    """校验飞书事件回调签名；未配置 encrypt_key 时由调用方跳过。"""
    key = (encrypt_key or "").strip()
    if not key:
        return True
    timestamp = str(headers.get("X-Lark-Request-Timestamp") or headers.get("X-Request-Timestamp") or "")
    nonce = str(headers.get("X-Lark-Request-Nonce") or headers.get("X-Request-Nonce") or "")
    signature = str(headers.get("X-Lark-Signature") or headers.get("X-Request-Signature") or "")
    if not timestamp or not nonce or not signature:
        return False
    base = f"{timestamp}{nonce}{key}".encode("utf-8")
    candidates = [
        base64.b64encode(hmac.new(base, raw_body, digestmod=hashlib.sha256).digest()).decode("utf-8"),
        hashlib.sha256(base + raw_body).hexdigest(),
        base64.b64encode(hmac.new(key.encode("utf-8"), f"{timestamp}{nonce}".encode("utf-8") + raw_body, digestmod=hashlib.sha256).digest()).decode("utf-8"),
    ]
    return any(hmac.compare_digest(item, signature) for item in candidates)


def handle_url_verification(payload: dict[str, Any], verification_token: str = "") -> dict[str, str] | None:
    if payload.get("type") != "url_verification":
        return None
    _verify_token(payload.get("token"), verification_token)
    challenge = str(payload.get("challenge") or "")
    if not challenge:
        raise FeishuEventError("飞书 URL 校验缺少 challenge")
    return {"challenge": challenge}


def parse_message_event(
    payload: dict[str, Any],
    verification_token: str = "",
    bot_mention_names: list[str] | None = None,
    bot_open_ids: list[str] | None = None,
) -> FeishuMessageEvent | None:
    if "encrypt" in payload:
        raise FeishuEventError("当前未启用飞书加密事件解密，请在飞书后台关闭事件加密或补充解密实现")

    header = payload.get("header") if isinstance(payload.get("header"), dict) else {}
    event = payload.get("event") if isinstance(payload.get("event"), dict) else {}
    event_type = str(header.get("event_type") or payload.get("event_type") or "").strip()
    if event_type and event_type != "im.message.receive_v1":
        return None
    if payload.get("type") not in (None, "event_callback") and not event_type:
        return None

    _verify_token(header.get("token") or payload.get("token"), verification_token)

    message = event.get("message") if isinstance(event.get("message"), dict) else {}
    sender = event.get("sender") if isinstance(event.get("sender"), dict) else {}
    sender_id = sender.get("sender_id") if isinstance(sender.get("sender_id"), dict) else {}

    message_type = str(message.get("message_type") or "").strip()
    if message_type and message_type != "text":
        return None

    mention_keys = _extract_mention_keys(message.get("mentions"))
    raw_text = _extract_text(message.get("content"))
    text_has_mention = raw_text.strip().startswith("@")
    bot_mentioned = _mentions_include_bot(
        message.get("mentions"),
        raw_text,
        bot_mention_names,
        bot_open_ids=bot_open_ids,
    )
    text = _clean_user_text(raw_text, mention_keys if bot_mentioned else [])
    if not text:
        return None

    message_id = str(message.get("message_id") or "").strip()
    if not message_id:
        raise FeishuEventError("飞书消息事件缺少 message_id")

    return FeishuMessageEvent(
        event_id=str(header.get("event_id") or payload.get("uuid") or message_id).strip(),
        event_type=event_type or "im.message.receive_v1",
        message_id=message_id,
        chat_id=str(message.get("chat_id") or "").strip(),
        chat_type=str(message.get("chat_type") or "").strip(),
        root_id=str(message.get("root_id") or "").strip(),
        parent_id=str(message.get("parent_id") or "").strip(),
        sender_open_id=str(sender_id.get("open_id") or "").strip(),
        sender_union_id=str(sender_id.get("union_id") or "").strip(),
        text=text,
        mention_keys=tuple(mention_keys),
        text_has_mention=text_has_mention,
        bot_mentioned=bot_mentioned,
        raw=payload,
    )


def is_allowed(event: FeishuMessageEvent, allowed_open_ids: list[str], allowed_chat_ids: list[str]) -> bool:
    open_allow = {x.strip() for x in allowed_open_ids if x.strip()}
    chat_allow = {x.strip() for x in allowed_chat_ids if x.strip()}
    if not open_allow and not chat_allow:
        return True
    if event.sender_open_id and event.sender_open_id in open_allow:
        return True
    if event.chat_id and event.chat_id in chat_allow:
        return True
    return False


def build_assistant_context(event: FeishuMessageEvent) -> dict[str, Any]:
    return {
        "channel": event.channel,
        "feishuChatType": event.chat_type,
        "feishuChatId": event.chat_id,
        "feishuRootId": event.root_id,
        "feishuParentId": event.parent_id,
        "feishuSenderOpenId": event.sender_open_id,
    }


def _verify_token(received: Any, expected: str) -> None:
    if not expected:
        return
    token = str(received or "")
    if not hmac.compare_digest(token, expected):
        raise FeishuEventError("飞书事件 token 校验失败")


def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            return content
    elif isinstance(content, dict):
        data = content
    else:
        return ""
    text = data.get("text")
    if isinstance(text, str):
        return text
    return ""


def _extract_mention_keys(mentions: Any) -> list[str]:
    if not isinstance(mentions, list):
        return []
    keys: list[str] = []
    for item in mentions:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        if key:
            keys.append(key)
    return keys


def _normalize_mention_name(text: str) -> str:
    return (text or "").strip().lstrip("@").replace("\u200b", "").strip().lower()


def _mentions_include_bot(
    mentions: Any,
    raw_text: str,
    bot_names: list[str] | None,
    bot_open_ids: list[str] | None = None,
) -> bool:
    allowed = {_normalize_mention_name(name) for name in (bot_names or []) if _normalize_mention_name(name)}
    allowed_open_ids = {x.strip() for x in (bot_open_ids or []) if x.strip()}

    if isinstance(mentions, list):
        for item in mentions:
            if not isinstance(item, dict):
                continue
            id_obj = item.get("id") if isinstance(item.get("id"), dict) else {}
            mention_open_id = str(id_obj.get("open_id") or "").strip()
            if mention_open_id and mention_open_id in allowed_open_ids:
                return True
            candidates = [
                item.get("name"),
                item.get("text"),
                item.get("key"),
                item.get("tenant_key"),
            ]
            for candidate in candidates:
                normalized = _normalize_mention_name(str(candidate or ""))
                if normalized and normalized in allowed:
                    return True
    if not allowed and not allowed_open_ids:
        return False

    stripped = (raw_text or "").strip().replace("\u200b", "")
    for name in allowed:
        if stripped.startswith(f"@{name}") or stripped.startswith(name):
            return True
    return False


def _clean_user_text(text: str, mention_keys: list[str]) -> str:
    out = (text or "").strip()
    for key in mention_keys:
        out = out.replace(key, "")
    if not mention_keys and out.startswith("@"):
        # Some Feishu events omit the structured mentions array but keep a display mention
        # like "@监测助手 问题". Mention routing is handled before this cleanup.
        for prefix in ("@监测助手 ", "@飞书监测助手 ", "@飞书 CLI "):
            if out.startswith(prefix):
                out = out[len(prefix) :]
                break
    # 飞书 @ 机器人后文本中可能残留 mention 标记；这里做保守清理。
    out = out.replace("\u200b", "").strip()
    return out


def _chunk_text(text: str, max_chars: int) -> list[str]:
    raw = (text or "").strip() or "我这边没有生成可用回答，请稍后重试。"
    if len(raw) <= max_chars:
        return [raw]
    chunks: list[str] = []
    start = 0
    while start < len(raw):
        chunks.append(raw[start : start + max_chars])
        start += max_chars
    return chunks


def _stable_uuid(seed: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, seed))


def _utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"
