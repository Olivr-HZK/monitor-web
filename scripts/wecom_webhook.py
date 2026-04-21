# -*- coding: utf-8 -*-
"""企业微信「群机器人」Webhook：仅 HTTP 200 不足以判断是否推送成功，须解析 JSON 且 errcode==0。

文档：https://developer.work.weixin.qq.com/document/path/91770 等；典型成功响应：
{"errcode":0,"errmsg":"ok"}
"""

from __future__ import annotations

import json


def wecom_webhook_succeeded(http_status: int, response_text: str) -> tuple[bool, str]:
    """
    返回 (是否成功, 说明)。
    成功：HTTP 200 且 JSON 中 errcode 为 0。
    """
    if http_status != 200:
        return False, f"HTTP {http_status}"
    text = (response_text or "").strip()
    if not text:
        return False, "空响应体"
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return False, f"响应非 JSON：{text[:500]!r}"
    if "errcode" not in data:
        return False, f"响应无 errcode 字段：{text[:500]!r}"
    try:
        ec = int(data["errcode"])
    except (TypeError, ValueError):
        return False, f"errcode 无法解析：{data!r}"
    if ec == 0:
        return True, "ok"
    em = data.get("errmsg") or data.get("errMsg") or ""
    return False, f"errcode={ec} errmsg={em}"
