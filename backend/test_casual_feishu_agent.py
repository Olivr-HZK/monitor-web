from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient


def load_main(monkeypatch, tmp_path, **env: str):
    keys = [
        "DATA_DIR",
        "CASUAL_FEISHU_BOT_ENABLED",
        "CASUAL_FEISHU_APP_ID",
        "CASUAL_FEISHU_APP_SECRET",
        "CASUAL_FEISHU_VERIFICATION_TOKEN",
        "CASUAL_FEISHU_ENCRYPT_KEY",
        "CASUAL_FEISHU_ALLOWED_OPEN_IDS",
        "CASUAL_FEISHU_ALLOWED_CHAT_IDS",
        "CASUAL_FEISHU_BOT_MENTION_NAMES",
        "CASUAL_FEISHU_BOT_OPEN_ID",
        "CASUAL_FEISHU_ASSISTANT_SEND_THINKING",
        "OPENAI_API_KEY",
    ]
    for key in keys:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parent))

    import dotenv

    monkeypatch.setattr(dotenv, "load_dotenv", lambda *args, **kwargs: False)

    for module_name in ("main", "config", "auth", "assistant_service", "feishu_bot"):
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


def test_casual_feishu_route_ignores_when_disabled(monkeypatch, tmp_path):
    main = load_main(monkeypatch, tmp_path, CASUAL_FEISHU_BOT_ENABLED="false")
    client = TestClient(main.app)

    response = client.post("/api/feishu/casual-agent/events", json=event_payload())

    assert response.status_code == 200
    assert response.json() == {"ok": True, "ignored": "casual feishu bot disabled"}


def test_casual_feishu_url_verification_uses_independent_token(monkeypatch, tmp_path):
    main = load_main(
        monkeypatch,
        tmp_path,
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


def test_casual_feishu_url_verification_works_when_bot_disabled(monkeypatch, tmp_path):
    main = load_main(
        monkeypatch,
        tmp_path,
        CASUAL_FEISHU_BOT_ENABLED="false",
        CASUAL_FEISHU_VERIFICATION_TOKEN="verify-token",
    )
    client = TestClient(main.app)

    response = client.post(
        "/api/feishu/casual-agent/events",
        json={"type": "url_verification", "token": "verify-token", "challenge": "ok"},
    )

    assert response.status_code == 200
    assert response.json() == {"challenge": "ok"}


def _patch_immediate_create_task(monkeypatch, main) -> list:
    pending: list = []

    def fake_create_task(coro):
        pending.append(coro)

        class _DummyTask:
            pass

        return _DummyTask()

    monkeypatch.setattr(main.asyncio, "create_task", fake_create_task)
    return pending


def _run_pending_tasks(pending: list) -> None:
    import asyncio

    for coro in pending:
        asyncio.run(coro)


def test_casual_feishu_group_without_mention_is_ignored(monkeypatch, tmp_path):
    main = load_main(
        monkeypatch,
        tmp_path,
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


def test_casual_feishu_denies_user_outside_whitelist(monkeypatch, tmp_path):
    main = load_main(
        monkeypatch,
        tmp_path,
        CASUAL_FEISHU_BOT_ENABLED="true",
        CASUAL_FEISHU_VERIFICATION_TOKEN="verify-token",
        CASUAL_FEISHU_ALLOWED_OPEN_IDS="ou_allowed",
        CASUAL_FEISHU_ASSISTANT_SEND_THINKING="false",
        OPENAI_API_KEY="test-key",
    )
    replies: list[str] = []

    async def fake_reply(message_id: str, text: str, *, uuid_prefix: str | None = None) -> None:
        replies.append(text)

    pending = _patch_immediate_create_task(monkeypatch, main)
    monkeypatch.setattr(main._casual_feishu_bot_client, "reply_text", fake_reply)
    client = TestClient(main.app)

    response = client.post("/api/feishu/casual-agent/events", json=event_payload(open_id="ou_denied"))
    _run_pending_tasks(pending)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert any("休闲游戏之神" in item for item in replies) or any("白名单" in item for item in replies)


def test_casual_feishu_dm_runs_casual_assistant(monkeypatch, tmp_path):
    main = load_main(
        monkeypatch,
        tmp_path,
        CASUAL_FEISHU_BOT_ENABLED="true",
        CASUAL_FEISHU_VERIFICATION_TOKEN="verify-token",
        CASUAL_FEISHU_ASSISTANT_SEND_THINKING="false",
        OPENAI_API_KEY="test-key",
    )
    calls: list[tuple[str, str, dict[str, Any] | None]] = []
    replies: list[str] = []

    class Result:
        answer = "微信小游戏最近榜单变化摘要"
        charts = []

    async def fake_run(user_text, history=None, page_context=None, *, channel="web", on_tool_call=None):
        calls.append((user_text, channel, page_context))
        return Result()

    async def fake_reply(message_id: str, text: str, *, uuid_prefix: str | None = None) -> None:
        replies.append(text)

    pending = _patch_immediate_create_task(monkeypatch, main)
    monkeypatch.setattr(main, "run_monitor_assistant", fake_run)
    monkeypatch.setattr(main._casual_feishu_bot_client, "reply_text", fake_reply)
    client = TestClient(main.app)

    response = client.post("/api/feishu/casual-agent/events", json=event_payload())
    _run_pending_tasks(pending)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert calls
    assert calls[0][1] == "feishu_casual_dm"
    assert "休闲游戏之神" in calls[0][0]
    assert replies[-1] == "微信小游戏最近榜单变化摘要"


def test_casual_feishu_group_mention_runs_with_group_channel(monkeypatch, tmp_path):
    main = load_main(
        monkeypatch,
        tmp_path,
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
        charts = []

    async def fake_run(user_text, history=None, page_context=None, *, channel="web", on_tool_call=None):
        calls.append((user_text, channel, page_context))
        return Result()

    async def fake_reply(message_id: str, text: str, *, uuid_prefix: str | None = None) -> None:
        replies.append(text)

    pending = _patch_immediate_create_task(monkeypatch, main)
    monkeypatch.setattr(main, "run_monitor_assistant", fake_run)
    monkeypatch.setattr(main._casual_feishu_bot_client, "reply_text", fake_reply)
    client = TestClient(main.app)
    payload = event_payload(
        chat_type="group",
        text="@休闲监测助手 SensorTower 最近有什么变化？",
        mentions=[{"key": "@_user_1", "name": "休闲监测助手"}],
    )

    response = client.post("/api/feishu/casual-agent/events", json=payload)
    _run_pending_tasks(pending)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert calls
    assert calls[0][1] == "feishu_casual_group"
    assert replies[-1] == "SensorTower 榜单摘要"


def test_casual_feishu_group_mention_matches_bot_open_id(monkeypatch, tmp_path):
    main = load_main(
        monkeypatch,
        tmp_path,
        CASUAL_FEISHU_BOT_ENABLED="true",
        CASUAL_FEISHU_VERIFICATION_TOKEN="verify-token",
        CASUAL_FEISHU_BOT_MENTION_NAMES="wrong-name",
        CASUAL_FEISHU_BOT_OPEN_ID="ou_bot_test",
        CASUAL_FEISHU_ASSISTANT_SEND_THINKING="false",
        OPENAI_API_KEY="test-key",
    )
    calls: list[tuple[str, str, dict[str, Any] | None]] = []
    replies: list[str] = []

    class Result:
        answer = "榜单摘要"
        charts = []

    async def fake_run(user_text, history=None, page_context=None, *, channel="web", on_tool_call=None):
        calls.append((user_text, channel, page_context))
        return Result()

    async def fake_reply(message_id: str, text: str, *, uuid_prefix: str | None = None) -> None:
        replies.append(text)

    pending = _patch_immediate_create_task(monkeypatch, main)
    monkeypatch.setattr(main, "run_monitor_assistant", fake_run)
    monkeypatch.setattr(main._casual_feishu_bot_client, "reply_text", fake_reply)
    client = TestClient(main.app)
    payload = event_payload(
        chat_type="group",
        text="@_user_1 最近微信小游戏榜单有什么变化",
        mentions=[{"key": "@_user_1", "name": "游戏之神", "id": {"open_id": "ou_bot_test"}}],
    )

    response = client.post("/api/feishu/casual-agent/events", json=payload)
    _run_pending_tasks(pending)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert calls
    assert calls[0][1] == "feishu_casual_group"


def test_casual_feishu_reset_clears_casual_session(monkeypatch, tmp_path):
    main = load_main(
        monkeypatch,
        tmp_path,
        CASUAL_FEISHU_BOT_ENABLED="true",
        CASUAL_FEISHU_VERIFICATION_TOKEN="verify-token",
        CASUAL_FEISHU_ASSISTANT_SEND_THINKING="false",
    )
    replies: list[str] = []

    async def fake_reply(message_id: str, text: str, *, uuid_prefix: str | None = None) -> None:
        replies.append(text)

    pending = _patch_immediate_create_task(monkeypatch, main)
    monkeypatch.setattr(main._casual_feishu_bot_client, "reply_text", fake_reply)
    client = TestClient(main.app)

    response = client.post(
        "/api/feishu/casual-agent/events",
        json=event_payload(text="/reset", event_id="evt_reset", message_id="msg_reset"),
    )
    _run_pending_tasks(pending)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert any("Game Start" in item or "清空" in item for item in replies)
