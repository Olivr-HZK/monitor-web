from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

import ai_tools
from ai_tools import AgentToolDispatcher, openai_style_tools_schema


class _FakeResponse:
    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data
        self.status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self._data


@pytest.mark.anyio
async def test_wechat_video_search_uses_game_name_only_and_stores_video_attachment(monkeypatch):
    captured: dict[str, Any] = {}

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb) -> None:
            return None

        async def post(self, url: str, *, json: dict[str, Any]) -> _FakeResponse:
            captured["url"] = url
            captured["json"] = json
            return _FakeResponse(
                {
                    "data": [
                        {
                            "subBoxes": [
                                {
                                    "items": [
                                        {
                                            "title": "别的小游戏通关视频",
                                            "videoUrl": "https://cdn.example.com/other.mp4",
                                            "dateTime": "2026-06-15",
                                            "source": {"title": "其他作者"},
                                        },
                                        {
                                            "title": "脑筋抖一抖",
                                            "videoUrl": "https://cdn.example.com/best.mp4",
                                            "dateTime": "2026-06-16",
                                            "source": {"title": "游戏观察员"},
                                            "duration": "00:42",
                                        },
                                    ]
                                }
                            ]
                        }
                    ]
                }
            )

    monkeypatch.setattr(ai_tools.httpx, "AsyncClient", _FakeAsyncClient)
    dispatcher = AgentToolDispatcher(
        Path("public"),
        "",
        True,
        True,
        dajiala_api_key="secret-key",
        dajiala_verifycode="",
    )

    result = await dispatcher.dispatch("wechat_video_search", {"gameName": "脑筋抖一抖 玩法", "maxCandidates": 3})

    assert captured["url"] == "https://www.dajiala.com/fbmain/monitor/v3/web_search"
    assert captured["json"]["keyword"] == "脑筋抖一抖"
    assert captured["json"]["search_type"] == 2
    assert captured["json"]["mode"] == 1
    assert captured["json"]["currentPage"] == 1
    assert captured["json"]["offset"] == 0
    assert captured["json"]["cookies_buffer"] == ""
    assert captured["json"]["key"] == "secret-key"
    assert "key" not in result["request"]
    assert result["best"]["videoUrl"] == "https://cdn.example.com/best.mp4"
    assert dispatcher.attachment_payloads == [
        {
            "type": "video_url",
            "url": "https://cdn.example.com/best.mp4",
            "title": "脑筋抖一抖",
            "source": "游戏观察员",
            "filename": "脑筋抖一抖.mp4",
            "contentType": "video/mp4",
            "expiresIn": "1 day",
        }
    ]


def test_wechat_video_search_tool_schema_is_optional():
    without_video = openai_style_tools_schema(False, True, False)
    with_video = openai_style_tools_schema(False, True, True)

    assert all(tool["function"]["name"] != "wechat_video_search" for tool in without_video)
    assert any(tool["function"]["name"] == "wechat_video_search" for tool in with_video)
