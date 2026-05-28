#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from repo_dotenv import load_repo_env
from webhook_url import normalize_webhook_url
from wecom_webhook import wecom_webhook_succeeded


def clean_url(value: str | None) -> str:
    if not value:
        return ""
    return value.replace("\r", "").replace("\n", "").strip().strip('"').strip("'")


def post_json(url: str, payload: dict) -> tuple[int, str]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        normalize_webhook_url(url),
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.getcode(), resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="ignore")
    except urllib.error.URLError as exc:
        return 0, str(exc)


def send_feishu(webhook: str, title: str, body: str) -> bool:
    payload = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": title},
                "template": "green" if "成功" in title else "red",
            },
            "elements": [{"tag": "markdown", "content": body}],
        },
    }
    status, resp = post_json(webhook, payload)
    if status != 200:
        print(f"[飞书状态通知] HTTP 失败 status={status} resp={resp[:500]!r}", file=sys.stderr)
        return False
    try:
        data = json.loads(resp)
    except json.JSONDecodeError:
        print(f"[飞书状态通知] 响应非 JSON resp={resp[:500]!r}", file=sys.stderr)
        return False
    if data.get("code") == 0:
        print("[飞书状态通知] 发送成功")
        return True
    print(f"[飞书状态通知] 业务失败 resp={resp[:500]!r}", file=sys.stderr)
    return False


def send_wecom(webhook: str, body: str) -> bool:
    payload = {"msgtype": "markdown", "markdown": {"content": body[:3900]}}
    status, resp = post_json(webhook, payload)
    ok, reason = wecom_webhook_succeeded(status, resp)
    if ok:
        print("[企业微信状态通知] 发送成功")
        return True
    print(f"[企业微信状态通知] 发送失败：{reason}；resp={resp[:500]!r}", file=sys.stderr)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="发送 monitor-web 定时链路状态摘要")
    parser.add_argument("--title", required=True)
    parser.add_argument("--body", default="")
    parser.add_argument("--body-file", type=Path)
    parser.add_argument("--feishu-only", action="store_true", help="只发送飞书，不发送企业微信")
    parser.add_argument("--no-wecom", action="store_true", help="不发送企业微信")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    load_repo_env(repo_root)

    body = args.body
    if args.body_file:
        body = args.body_file.read_text(encoding="utf-8")
    if not body.strip():
        print("[状态通知] 内容为空，跳过", file=sys.stderr)
        return 0

    feishu = clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
    wecom = ""
    if not args.feishu_only and not args.no_wecom:
        wecom = clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL")) or clean_url(os.environ.get("WECOM_WEBHOOK_URL"))
    if not feishu and not wecom:
        print("[状态通知] 未配置 webhook，跳过")
        return 0

    ok = True
    if feishu:
        ok = send_feishu(feishu, args.title, body) and ok
    if wecom:
        ok = send_wecom(wecom, body) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
