"""Prompt Lab endpoint tests."""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

from fastapi.testclient import TestClient


def load_main(monkeypatch, tmp_path, **env: str):
    keys = [
        "DATA_DIR",
        "AI_CHAT_REQUIRE_AUTH",
        "NODE_ENV",
        "OPENAI_API_KEY",
        "AI_PROVIDER",
        "CODEX_ENABLE_DB_TOOL",
        "CODEX_ENABLE_WEB_SEARCH_TOOL",
    ]
    for key in keys:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AI_CHAT_REQUIRE_AUTH", "false")
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("AI_PROVIDER", "openrouter")
    monkeypatch.setenv("CODEX_ENABLE_DB_TOOL", "true")
    monkeypatch.setenv("CODEX_ENABLE_WEB_SEARCH_TOOL", "true")
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parent))

    import dotenv

    monkeypatch.setattr(dotenv, "load_dotenv", lambda *args, **kwargs: False)
    for module_name in ("main", "config", "auth", "assistant_service", "ai_tools"):
        sys.modules.pop(module_name, None)
    return importlib.import_module("main")


def test_prompt_lab_inspect_reports_sensortower_boundary(monkeypatch, tmp_path):
    main = load_main(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.post(
        "/api/ai/prompt-lab/inspect",
        json={
            "message": "SensorTower 最新美国 iOS 免费榜 Top5",
            "channel": "feishu_casual_group",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["channel"] == "feishu_casual_group"
    assert "sensortower" in data["sourceIntents"]
    assert "sensortower_top100.db" in data["selectedDbs"]
    assert "sensortower_applist.db" in data["selectedDbs"]
    assert data["flags"]["trend"] is False
    assert data["hints"]["sensortowerQuery"] is True
    assert data["hints"]["feishuTableCards"] is True
    assert data["hints"]["fallbackSql"] is True


def test_prompt_lab_inspect_keeps_casual_ua_on_competitor(monkeypatch, tmp_path):
    main = load_main(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.post(
        "/api/ai/prompt-lab/inspect",
        json={
            "message": "竞品 UA 素材最近有什么变化？",
            "channel": "feishu_casual_group",
            "pageContext": {"monitorType": "休闲游戏监测"},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert "competitor" in data["sourceIntents"]
    assert "competitor_data.db" in data["selectedDbs"]
    assert "ai_products_ua.db" not in data["selectedDbs"]
    assert data["flags"]["trend"] is True


def test_prompt_lab_run_passes_requested_channel_and_returns_tables(monkeypatch, tmp_path):
    main = load_main(monkeypatch, tmp_path)
    from assistant_service import AssistantResult

    seen: dict[str, object] = {}

    async def fake_run_monitor_assistant(text, history=None, page_context=None, *, channel="web", on_tool_call=None):
        seen["text"] = text
        seen["history"] = history
        seen["page_context"] = page_context
        seen["channel"] = channel
        if on_tool_call:
            on_tool_call("sensortower_query", {"operation": "top_ranking"})
        return AssistantResult(
            answer="SensorTower Top5 ready",
            selected_dbs=["sensortower_top100.db"],
            tool_calls=[{"name": "sensortower_query", "args": {"operation": "top_ranking"}}],
            tables=[{"title": "Top5", "rows": [{"rank": 1}], "columns": [{"key": "rank", "label": "排名"}]}],
        )

    monkeypatch.setattr(main, "run_monitor_assistant", fake_run_monitor_assistant)
    client = TestClient(main.app)

    response = client.post(
        "/api/ai/prompt-lab/run",
        json={
            "message": "SensorTower 最新美国 iOS 免费榜 Top5",
            "channel": "feishu_casual_group",
            "pageContext": {"monitorType": "休闲游戏监测"},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert seen["channel"] == "feishu_casual_group"
    assert seen["page_context"] == {"monitorType": "休闲游戏监测"}
    assert data["answer"] == "SensorTower Top5 ready"
    assert data["selectedDbs"] == ["sensortower_top100.db"]
    assert data["toolCalls"][0]["name"] == "sensortower_query"
    assert data["tables"][0]["title"] == "Top5"
