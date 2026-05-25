# Casual Feishu Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent Feishu bot event endpoint for the casual-game monitoring agent while reusing the existing monitor assistant and read-only data tools.

**Architecture:** Add a separate configuration group, Feishu client, session store, rate limiter, event processor, and route for `POST /api/feishu/casual-agent/events`. Keep the existing `/api/feishu/events` behavior unchanged, but share common helpers from `feishu_bot.py` and `assistant_service.py`.

**Tech Stack:** FastAPI, Python 3, httpx, sqlite3, existing `FeishuBotClient`, `AssistantSessionStore`, `run_monitor_assistant`, pytest-style backend tests.

---

## File Structure

- Modify `backend/config.py`: add `CASUAL_FEISHU_*` environment variables.
- Modify `backend/main.py`: import config values, initialize independent casual-agent runtime objects, add prompt wrapper, event processor, and route.
- Modify `backend/.env.example`: document the new environment variables.
- Create `backend/test_casual_feishu_agent.py`: cover disabled route, URL verification, group mention behavior, DM processing, whitelist denial, and reset behavior.
- Modify `docs/监测助手使用说明.md`: add a short operations section for the independent casual Feishu agent.

No git commit step is included here because repository commits require an explicit user request.

---

### Task 1: Add Casual Feishu Configuration

**Files:**
- Modify: `backend/config.py`
- Modify: `backend/.env.example`

- [ ] **Step 1: Add config values in `backend/config.py`**

Add these names after the existing `FEISHU_*` bot configuration block:

```python
CASUAL_FEISHU_BOT_ENABLED = _bool(os.environ.get("CASUAL_FEISHU_BOT_ENABLED"))
CASUAL_FEISHU_APP_ID = _str(os.environ.get("CASUAL_FEISHU_APP_ID"))
CASUAL_FEISHU_APP_SECRET = _str(os.environ.get("CASUAL_FEISHU_APP_SECRET"))
CASUAL_FEISHU_VERIFICATION_TOKEN = _str(os.environ.get("CASUAL_FEISHU_VERIFICATION_TOKEN"))
CASUAL_FEISHU_ENCRYPT_KEY = _str(os.environ.get("CASUAL_FEISHU_ENCRYPT_KEY"))
CASUAL_FEISHU_ALLOWED_OPEN_IDS = _csv(os.environ.get("CASUAL_FEISHU_ALLOWED_OPEN_IDS"))
CASUAL_FEISHU_ALLOWED_CHAT_IDS = _csv(os.environ.get("CASUAL_FEISHU_ALLOWED_CHAT_IDS"))
CASUAL_FEISHU_BOT_MENTION_NAMES = _csv(
    os.environ.get("CASUAL_FEISHU_BOT_MENTION_NAMES"),
    ["休闲监测助手", "休闲游戏助手"],
)
CASUAL_FEISHU_ASSISTANT_SEND_THINKING = (
    os.environ.get("CASUAL_FEISHU_ASSISTANT_SEND_THINKING", "true").strip().lower()
    not in ("0", "false", "no")
)
```

- [ ] **Step 2: Document env vars in `backend/.env.example`**

Append this block after the current “飞书对话助手” section:

```env
# 休闲游戏飞书 Agent（可选）：建议使用独立飞书自建应用
CASUAL_FEISHU_BOT_ENABLED=false
CASUAL_FEISHU_APP_ID=
CASUAL_FEISHU_APP_SECRET=
CASUAL_FEISHU_VERIFICATION_TOKEN=
CASUAL_FEISHU_ENCRYPT_KEY=
CASUAL_FEISHU_ALLOWED_OPEN_IDS=
CASUAL_FEISHU_ALLOWED_CHAT_IDS=
CASUAL_FEISHU_BOT_MENTION_NAMES=休闲监测助手,休闲游戏助手
CASUAL_FEISHU_ASSISTANT_SEND_THINKING=true
```

- [ ] **Step 3: Verify config imports**

Run:

```bash
source backend/.venv/bin/activate
python - <<'PY'
import sys
sys.path.insert(0, "backend")
import config
print(config.CASUAL_FEISHU_BOT_ENABLED)
print(config.CASUAL_FEISHU_BOT_MENTION_NAMES)
PY
```

Expected: prints `False` and `['休闲监测助手', '休闲游戏助手']`.

---

### Task 2: Add Failing Route Tests

**Files:**
- Create: `backend/test_casual_feishu_agent.py`
- Modify later: `backend/main.py`

- [ ] **Step 1: Create `backend/test_casual_feishu_agent.py`**

Use module reloading so each test can set env vars before importing `main`:

```python
from __future__ import annotations

import importlib
import json
import sys
from typing import Any

from fastapi.testclient import TestClient


def load_main(monkeypatch, **env: str):
    keys = [
        "CASUAL_FEISHU_BOT_ENABLED",
        "CASUAL_FEISHU_APP_ID",
        "CASUAL_FEISHU_APP_SECRET",
        "CASUAL_FEISHU_VERIFICATION_TOKEN",
        "CASUAL_FEISHU_ENCRYPT_KEY",
        "CASUAL_FEISHU_ALLOWED_OPEN_IDS",
        "CASUAL_FEISHU_ALLOWED_CHAT_IDS",
        "CASUAL_FEISHU_BOT_MENTION_NAMES",
        "CASUAL_FEISHU_ASSISTANT_SEND_THINKING",
        "OPENAI_API_KEY",
    ]
    for key in keys:
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    sys.path.insert(0, "backend")
    for module_name in ("main", "config"):
        sys.modules.pop(module_name, None)
    return importlib.import_module("main")


def event_payload(
    *,
    text: str = "最近微信小游戏榜单有什么变化？",
    chat_type: str = "p2p",
    event_id: str = "evt_1",
    message_id: str = "msg_1",
    chat_id: str = "chat_1",
    open_id: str = "ou_1",
    mentions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "schema": "2.0",
        "header": {
            "event_id": event_id,
            "event_type": "im.message.receive_v1",
            "token": "verify-token",
        },
        "event": {
            "sender": {"sender_id": {"open_id": open_id, "union_id": "on_1"}},
            "message": {
                "message_id": message_id,
                "chat_id": chat_id,
                "chat_type": chat_type,
                "message_type": "text",
                "content": json.dumps({"text": text}, ensure_ascii=False),
                "mentions": mentions or [],
            },
        },
    }
```

- [ ] **Step 2: Add disabled-route test**

```python
def test_casual_feishu_route_ignores_when_disabled(monkeypatch):
    main = load_main(monkeypatch, CASUAL_FEISHU_BOT_ENABLED="false")
    client = TestClient(main.app)

    response = client.post("/api/feishu/casual-agent/events", json=event_payload())

    assert response.status_code == 200
    assert response.json() == {"ok": True, "ignored": "casual feishu bot disabled"}
```

- [ ] **Step 3: Add URL verification test**

```python
def test_casual_feishu_url_verification_uses_independent_token(monkeypatch):
    main = load_main(
        monkeypatch,
        CASUAL_FEISHU_BOT_ENABLED="true",
        CASUAL_FEISHU_VERIFICATION_TOKEN="verify-token",
    )
    client = TestClient(main.app)

    response = client.post(
        "/api/feishu/casual-agent/events",
        json={"type": "url_verification", "token": "verify-token", "challenge": "ok"},
    )

    assert response.status_code == 200
    assert response.json() == {"challenge": "ok"}
```

- [ ] **Step 4: Run tests and confirm failure**

Run:

```bash
source backend/.venv/bin/activate
python -m pytest backend/test_casual_feishu_agent.py -q
```

Expected: fails because `/api/feishu/casual-agent/events` does not exist yet.

---

### Task 3: Implement Casual Route Skeleton

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Import config values in `backend/main.py`**

Extend the `from config import (...)` block:

```python
    CASUAL_FEISHU_BOT_ENABLED,
    CASUAL_FEISHU_APP_ID,
    CASUAL_FEISHU_APP_SECRET,
    CASUAL_FEISHU_VERIFICATION_TOKEN,
    CASUAL_FEISHU_ENCRYPT_KEY,
    CASUAL_FEISHU_ALLOWED_OPEN_IDS,
    CASUAL_FEISHU_ALLOWED_CHAT_IDS,
    CASUAL_FEISHU_BOT_MENTION_NAMES,
    CASUAL_FEISHU_ASSISTANT_SEND_THINKING,
```

- [ ] **Step 2: Initialize independent runtime objects**

Add after the existing `_assistant_session_store` initialization:

```python
_casual_feishu_bot_client = FeishuBotClient(CASUAL_FEISHU_APP_ID, CASUAL_FEISHU_APP_SECRET)
_casual_assistant_session_store = AssistantSessionStore(DATA_DIR / "casual_assistant_sessions.db")
_casual_feishu_rate_limiter = InMemoryRateLimiter(max_events=8, window_sec=60)
```

- [ ] **Step 3: Add route skeleton**

Add after the existing `feishu_events` route:

```python
@app.post("/api/feishu/casual-agent/events")
async def casual_feishu_events(request: Request):
    """独立休闲游戏飞书 Agent 事件订阅入口。"""
    if not CASUAL_FEISHU_BOT_ENABLED:
        return {"ok": True, "ignored": "casual feishu bot disabled"}

    raw = await request.body()
    if CASUAL_FEISHU_ENCRYPT_KEY and not verify_feishu_signature(request.headers, raw, CASUAL_FEISHU_ENCRYPT_KEY):
        raise HTTPException(status_code=401, detail="休闲游戏飞书事件签名校验失败")

    try:
        payload = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="休闲游戏飞书事件不是合法 JSON") from None

    try:
        verification = handle_url_verification(payload, CASUAL_FEISHU_VERIFICATION_TOKEN)
        if verification is not None:
            print("[casual-feishu-events] url_verification ok")
            return verification

        event = parse_message_event(payload, CASUAL_FEISHU_VERIFICATION_TOKEN, CASUAL_FEISHU_BOT_MENTION_NAMES)
        if event is None:
            header = payload.get("header") if isinstance(payload.get("header"), dict) else {}
            print("[casual-feishu-events] ignored unsupported", {
                "type": payload.get("type"),
                "event_type": header.get("event_type") or payload.get("event_type"),
            })
            return {"ok": True, "ignored": "unsupported event"}
        if event.requires_mention_but_missing:
            print("[casual-feishu-events] ignored group without mention", {
                "event_id": event.event_id,
                "chat_id": event.chat_id,
                "text": event.text[:80],
            })
            return {"ok": True, "ignored": "group message without bot mention"}

        if not _casual_assistant_session_store.mark_event_received(event.event_id):
            print("[casual-feishu-events] ignored duplicate", {"event_id": event.event_id})
            return {"ok": True, "ignored": "duplicate event"}

        print("[casual-feishu-events] accepted", {
            "event_id": event.event_id,
            "channel": _casual_feishu_channel(event),
            "chat_type": event.chat_type,
            "text": event.text[:80],
        })
        asyncio.create_task(_process_casual_feishu_message_event(event))
        return {"ok": True}
    except FeishuEventError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
```

- [ ] **Step 4: Add temporary helper stubs to satisfy imports**

Add above the new route:

```python
def _casual_feishu_channel(event) -> str:
    return "feishu_casual_group" if event.chat_type == "group" else "feishu_casual_dm"


async def _process_casual_feishu_message_event(event) -> None:
    _casual_assistant_session_store.mark_event_done(event.event_id, "queued")
```

- [ ] **Step 5: Run route skeleton tests**

Run:

```bash
source backend/.venv/bin/activate
python -m pytest backend/test_casual_feishu_agent.py -q
```

Expected: disabled-route and URL verification tests pass.

---

### Task 4: Add Processing Tests

**Files:**
- Modify: `backend/test_casual_feishu_agent.py`
- Modify later: `backend/main.py`

- [ ] **Step 1: Add group-without-mention test**

```python
def test_casual_feishu_group_without_mention_is_ignored(monkeypatch):
    main = load_main(
        monkeypatch,
        CASUAL_FEISHU_BOT_ENABLED="true",
        CASUAL_FEISHU_VERIFICATION_TOKEN="verify-token",
    )
    client = TestClient(main.app)

    response = client.post(
        "/api/feishu/casual-agent/events",
        json=event_payload(chat_type="group", text="最近榜单怎么样？"),
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "ignored": "group message without bot mention"}
```

- [ ] **Step 2: Add whitelist denial test**

```python
def test_casual_feishu_denies_user_outside_whitelist(monkeypatch):
    main = load_main(
        monkeypatch,
        CASUAL_FEISHU_BOT_ENABLED="true",
        CASUAL_FEISHU_VERIFICATION_TOKEN="verify-token",
        CASUAL_FEISHU_ALLOWED_OPEN_IDS="ou_allowed",
        CASUAL_FEISHU_ASSISTANT_SEND_THINKING="false",
    )
    replies: list[str] = []

    async def fake_reply(message_id: str, text: str, *, uuid_prefix: str | None = None) -> None:
        replies.append(text)

    monkeypatch.setattr(main._casual_feishu_bot_client, "reply_text", fake_reply)
    client = TestClient(main.app)

    response = client.post("/api/feishu/casual-agent/events", json=event_payload(open_id="ou_denied"))

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert any("没有使用休闲游戏监测助手的权限" in item for item in replies)
```

- [ ] **Step 3: Add DM processing test**

```python
def test_casual_feishu_dm_runs_casual_assistant(monkeypatch):
    main = load_main(
        monkeypatch,
        CASUAL_FEISHU_BOT_ENABLED="true",
        CASUAL_FEISHU_VERIFICATION_TOKEN="verify-token",
        CASUAL_FEISHU_ASSISTANT_SEND_THINKING="false",
        OPENAI_API_KEY="test-key",
    )
    calls: list[tuple[str, str, dict[str, Any] | None]] = []
    replies: list[str] = []

    class Result:
        answer = "微信小游戏最近榜单变化摘要"

    async def fake_run(user_text, history=None, page_context=None, *, channel="web", on_tool_call=None):
        calls.append((user_text, channel, page_context))
        return Result()

    async def fake_reply(message_id: str, text: str, *, uuid_prefix: str | None = None) -> None:
        replies.append(text)

    monkeypatch.setattr(main, "run_monitor_assistant", fake_run)
    monkeypatch.setattr(main._casual_feishu_bot_client, "reply_text", fake_reply)
    client = TestClient(main.app)

    response = client.post("/api/feishu/casual-agent/events", json=event_payload())

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert calls
    assert calls[0][1] == "feishu_casual_dm"
    assert "休闲游戏监测飞书助手" in calls[0][0]
    assert replies[-1] == "微信小游戏最近榜单变化摘要"
```

- [ ] **Step 4: Add group mention processing test**

```python
def test_casual_feishu_group_mention_runs_with_group_channel(monkeypatch):
    main = load_main(
        monkeypatch,
        CASUAL_FEISHU_BOT_ENABLED="true",
        CASUAL_FEISHU_VERIFICATION_TOKEN="verify-token",
        CASUAL_FEISHU_BOT_MENTION_NAMES="休闲监测助手",
        CASUAL_FEISHU_ASSISTANT_SEND_THINKING="false",
        OPENAI_API_KEY="test-key",
    )
    calls: list[tuple[str, str, dict[str, Any] | None]] = []
    replies: list[str] = []

    class Result:
        answer = "SensorTower 榜单摘要"

    async def fake_run(user_text, history=None, page_context=None, *, channel="web", on_tool_call=None):
        calls.append((user_text, channel, page_context))
        return Result()

    async def fake_reply(message_id: str, text: str, *, uuid_prefix: str | None = None) -> None:
        replies.append(text)

    monkeypatch.setattr(main, "run_monitor_assistant", fake_run)
    monkeypatch.setattr(main._casual_feishu_bot_client, "reply_text", fake_reply)
    client = TestClient(main.app)
    payload = event_payload(
        chat_type="group",
        text="@休闲监测助手 SensorTower 最近有什么变化？",
        mentions=[{"key": "@_user_1", "name": "休闲监测助手"}],
    )

    response = client.post("/api/feishu/casual-agent/events", json=payload)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert calls
    assert calls[0][1] == "feishu_casual_group"
    assert replies[-1] == "SensorTower 榜单摘要"
```

- [ ] **Step 5: Run tests and confirm processor failures**

Run:

```bash
source backend/.venv/bin/activate
python -m pytest backend/test_casual_feishu_agent.py -q
```

Expected: new processing tests fail until the processor is implemented.

---

### Task 5: Implement Casual Message Processor

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Replace the temporary processor stub**

Replace `_process_casual_feishu_message_event` with:

```python
def _casual_feishu_prompt(user_text: str) -> str:
    return (
        "你是「休闲游戏监测飞书助手」，只聚焦休闲游戏监测相关数据。"
        "你可以回答微信/抖音小游戏榜单、SensorTower 榜单与商店页变化、竞品社媒/UA、我方产品榜单追踪。"
        "请用适合飞书阅读的中文回复：先给结论，再给关键依据；默认控制在 800 字以内，列表不超过 10 条。"
        "如果问题涉及最新、最近、本周或今天，必须说明站内数据边界；"
        "不要暴露数据库名、表名、SQL、内部路径或密钥。"
        "\n\n用户问题："
        + user_text
    )


async def _run_casual_monitor_assistant_for_feishu(
    text: str,
    history: list[dict] | None,
    context: dict[str, Any] | None,
) -> str:
    channel = str((context or {}).get("channel") or "feishu_casual")
    result = await run_monitor_assistant(text, history, context, channel=channel)
    return result.answer


async def _process_casual_feishu_message_event(event) -> None:
    user_key = event.sender_open_id or event.sender_union_id
    session_key = event.session_key
    channel = _casual_feishu_channel(event)
    started = time.monotonic()
    try:
        if not _casual_feishu_rate_limiter.allow(user_key or session_key):
            await _casual_feishu_bot_client.reply_text(
                event.message_id,
                "当前提问有点密集，我先保护一下休闲游戏监测查询服务。请稍等一分钟再继续。",
                uuid_prefix=f"{event.event_id}:casual-rate-limit",
            )
            _casual_assistant_session_store.mark_event_done(event.event_id, "rate_limited")
            return

        if not is_feishu_event_allowed(event, CASUAL_FEISHU_ALLOWED_OPEN_IDS, CASUAL_FEISHU_ALLOWED_CHAT_IDS):
            await _casual_feishu_bot_client.reply_text(
                event.message_id,
                "你暂时没有使用休闲游戏监测助手的权限，请联系管理员加入休闲助手白名单。",
                uuid_prefix=f"{event.event_id}:casual-denied",
            )
            _casual_assistant_session_store.mark_event_done(event.event_id, "denied")
            return

        normalized_command = event.text.strip().lower()
        if normalized_command in {"清空上下文", "重新开始", "重置会话", "/reset", "reset"}:
            removed = _casual_assistant_session_store.clear_session(session_key)
            await _casual_feishu_bot_client.reply_text(
                event.message_id,
                f"已清空当前休闲游戏监测助手会话上下文（{removed} 条历史）。接下来我会从新问题开始回答。",
                uuid_prefix=f"{event.event_id}:casual-reset",
            )
            _casual_assistant_session_store.mark_event_done(event.event_id, "reset")
            return

        history = _casual_assistant_session_store.load_history(session_key, ASSISTANT_MAX_HISTORY_TURNS)
        _casual_assistant_session_store.append_message(
            session_key,
            "user",
            event.text,
            channel=channel,
            user_key=user_key,
        )

        if CASUAL_FEISHU_ASSISTANT_SEND_THINKING:
            await _casual_feishu_bot_client.reply_text(
                event.message_id,
                "收到，我在查询休闲游戏监测数据并整理答案。",
                uuid_prefix=f"{event.event_id}:casual-thinking",
            )

        context = build_assistant_context(event)
        context["channel"] = channel
        prompt = _casual_feishu_prompt(event.text)
        answer = await _run_casual_monitor_assistant_for_feishu(prompt, history, context)
        answer = (answer or "").strip() or "我这边没有生成可用回答，请换个问法再试一次。"
        _append_assistant_audit({
            "channel": channel,
            "provider": AI_PROVIDER,
            "user": user_key,
            "sessionKey": session_key,
            "status": "done",
            "question": event.text,
            "answerChars": len(answer),
            "elapsedMs": int((time.monotonic() - started) * 1000),
        })
        _casual_assistant_session_store.append_message(
            session_key,
            "assistant",
            answer,
            channel=channel,
            user_key=user_key,
        )
        await _casual_feishu_bot_client.reply_text(
            event.message_id,
            answer,
            uuid_prefix=f"{event.event_id}:casual-answer",
        )
        _casual_assistant_session_store.mark_event_done(event.event_id, "done")
    except Exception as e:
        err = str(e)[:1000]
        print("[casual-feishu-assistant]", err)
        _append_assistant_audit({
            "channel": channel,
            "provider": AI_PROVIDER,
            "user": user_key,
            "sessionKey": session_key,
            "status": "error",
            "question": getattr(event, "text", ""),
            "error": err,
            "elapsedMs": int((time.monotonic() - started) * 1000),
        })
        _casual_assistant_session_store.mark_event_done(event.event_id, "error", err)
        try:
            await _casual_feishu_bot_client.reply_text(
                event.message_id,
                "休闲游戏监测助手这次处理失败了，请稍后重试；如果连续失败，请联系管理员查看后端日志。",
                uuid_prefix=f"{event.event_id}:casual-error",
            )
        except Exception as notify_error:
            print("[casual-feishu-assistant-notify]", notify_error)
```

- [ ] **Step 2: Run processing tests**

Run:

```bash
source backend/.venv/bin/activate
python -m pytest backend/test_casual_feishu_agent.py -q
```

Expected: all tests in `backend/test_casual_feishu_agent.py` pass.

---

### Task 6: Add Reset Test And Finalize Behavior

**Files:**
- Modify: `backend/test_casual_feishu_agent.py`
- Modify if needed: `backend/main.py`

- [ ] **Step 1: Add reset test**

```python
def test_casual_feishu_reset_clears_casual_session(monkeypatch):
    main = load_main(
        monkeypatch,
        CASUAL_FEISHU_BOT_ENABLED="true",
        CASUAL_FEISHU_VERIFICATION_TOKEN="verify-token",
        CASUAL_FEISHU_ASSISTANT_SEND_THINKING="false",
    )
    replies: list[str] = []

    async def fake_reply(message_id: str, text: str, *, uuid_prefix: str | None = None) -> None:
        replies.append(text)

    monkeypatch.setattr(main._casual_feishu_bot_client, "reply_text", fake_reply)
    client = TestClient(main.app)

    response = client.post(
        "/api/feishu/casual-agent/events",
        json=event_payload(text="/reset", event_id="evt_reset", message_id="msg_reset"),
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert any("休闲游戏监测助手会话上下文" in item for item in replies)
```

- [ ] **Step 2: Run reset test**

Run:

```bash
source backend/.venv/bin/activate
python -m pytest backend/test_casual_feishu_agent.py::test_casual_feishu_reset_clears_casual_session -q
```

Expected: pass.

- [ ] **Step 3: Run all casual tests**

Run:

```bash
source backend/.venv/bin/activate
python -m pytest backend/test_casual_feishu_agent.py -q
```

Expected: pass.

---

### Task 7: Update Usage Documentation

**Files:**
- Modify: `docs/监测助手使用说明.md`

- [ ] **Step 1: Add operations section**

Append this section:

```markdown
## 休闲游戏飞书 Agent

后端支持一个独立的休闲游戏飞书 Agent，事件订阅地址为：

- `POST /api/feishu/casual-agent/events`

建议在飞书开放平台创建独立自建应用，并配置独立的 `CASUAL_FEISHU_APP_ID`、`CASUAL_FEISHU_APP_SECRET`、`CASUAL_FEISHU_VERIFICATION_TOKEN`。开启方式：

```env
CASUAL_FEISHU_BOT_ENABLED=true
CASUAL_FEISHU_BOT_MENTION_NAMES=休闲监测助手,休闲游戏助手
```

能力范围包括微信/抖音小游戏、SensorTower、竞品社媒/UA、我方产品榜单追踪。群聊中需要 @ 配置的机器人名，私聊会直接响应。生产环境建议配置 `CASUAL_FEISHU_ALLOWED_OPEN_IDS` 或 `CASUAL_FEISHU_ALLOWED_CHAT_IDS` 做访问控制。
```

- [ ] **Step 2: Verify Markdown has no placeholder terms**

Run:

```bash
python - <<'PY'
from pathlib import Path
patterns = ["T" + "BD", "TO" + "DO", "待" + "定"]
paths = [
    Path("docs/监测助手使用说明.md"),
    Path("docs/superpowers/plans/2026-05-25-casual-feishu-agent.md"),
]
for path in paths:
    text = path.read_text(encoding="utf-8")
    for pattern in patterns:
        if pattern in text:
            raise SystemExit(f"{path}: found placeholder marker {pattern}")
print("placeholder scan passed")
PY
```

Expected: prints `placeholder scan passed`.

---

### Task 8: Final Verification

**Files:**
- Verify: `backend/config.py`
- Verify: `backend/main.py`
- Verify: `backend/test_casual_feishu_agent.py`
- Verify: `backend/.env.example`
- Verify: `docs/监测助手使用说明.md`

- [ ] **Step 1: Run import check**

Run:

```bash
source backend/.venv/bin/activate
python - <<'PY'
import sys
sys.path.insert(0, "backend")
import main
print(main.app.title)
PY
```

Expected: prints `监测汇总 API`.

- [ ] **Step 2: Run focused backend tests**

Run:

```bash
source backend/.venv/bin/activate
python -m pytest backend/test_casual_feishu_agent.py -q
```

Expected: pass.

- [ ] **Step 3: Run existing backend smoke test if available**

Run:

```bash
source backend/.venv/bin/activate
python backend/test_tavily.py
```

Expected: either succeeds or reports missing external API configuration without affecting the new casual Feishu agent. If it requires network/API keys, record that it could not be fully verified.

- [ ] **Step 4: Run frontend lint**

Run:

```bash
npm run lint
```

Expected: pass, or only report pre-existing unrelated lint issues.

- [ ] **Step 5: Run linter diagnostics in Cursor**

Check diagnostics for:

- `backend/config.py`
- `backend/main.py`
- `backend/test_casual_feishu_agent.py`

Expected: no newly introduced errors.

