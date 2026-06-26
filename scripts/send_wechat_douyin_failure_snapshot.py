#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from feishu_markdown_images import _feishu_tenant_access_token, _upload_image_multipart
from repo_dotenv import load_repo_env
from webhook_url import normalize_webhook_url


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


def latest_file(debug_dir: Path, pattern: str, run_date: str) -> Path | None:
    stamp = run_date.replace("-", "")
    matches = [p for p in debug_dir.glob(pattern) if stamp in p.name and p.is_file()]
    if not matches:
        return None
    return max(matches, key=lambda p: p.stat().st_mtime)


def upload_local_image(path: Path) -> str | None:
    token = _feishu_tenant_access_token()
    if not token:
        return None
    try:
        image_bytes = path.read_bytes()
    except OSError:
        return None
    if not image_bytes or len(image_bytes) > 10 * 1024 * 1024:
        return None
    return _upload_image_multipart(token, image_bytes, path.name)


def dom_summary(path: Path | None) -> list[str]:
    if not path:
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    counts = data.get("counts") or {}
    flags = data.get("flags") or {}
    dialogs = data.get("dialogs") or []
    dialog_text = ""
    if dialogs and isinstance(dialogs[0], dict):
        dialog_text = str(dialogs[0].get("textSample") or "").replace("\n", " ").strip()
    lines = [
        f"- rankItem: {counts.get('rankItem', '--')}",
        f"- rankChildItem: {counts.get('rankChildItem', '--')}",
        f"- rankDialog: {counts.get('rankDialog', '--')}",
    ]
    if flags:
        lines.append(
            "- 页面标记: "
            f"登录提示={bool(flags.get('hasLoginHistoryNotice') or flags.get('hasLoginNowText'))}, "
            f"周平均排名={bool(flags.get('hasWeekAverageText'))}"
        )
    if dialog_text:
        lines.append(f"- 弹层摘要: {dialog_text[:180]}")
    return lines


def send_feishu(webhook: str, title: str, body: str) -> bool:
    payload = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": title},
                "template": "red",
            },
            "elements": [{"tag": "markdown", "content": body}],
        },
    }
    status, resp = post_json(webhook, payload)
    if status != 200:
        print(f"[微信/抖音失败截图] 飞书 HTTP 失败 status={status} resp={resp[:500]!r}", file=sys.stderr)
        return False
    try:
        data = json.loads(resp)
    except json.JSONDecodeError:
        print(f"[微信/抖音失败截图] 飞书响应非 JSON resp={resp[:500]!r}", file=sys.stderr)
        return False
    if data.get("code") == 0:
        print("[微信/抖音失败截图] 飞书发送成功")
        return True
    print(f"[微信/抖音失败截图] 飞书业务失败 resp={resp[:500]!r}", file=sys.stderr)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="发送微信/抖音首跑失败截图到飞书")
    parser.add_argument("--debug-dir", type=Path)
    parser.add_argument("--date", default=datetime.now().strftime("%Y-%m-%d"))
    parser.add_argument("--log-file", type=Path)
    parser.add_argument("--exit-code", default="")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    load_repo_env(repo_root)

    debug_dir = args.debug_dir or repo_root / "data" / "artifacts" / "wechat-douyin" / "debug"
    screenshot = latest_file(debug_dir, "rank_empty_*.png", args.date)
    dom = latest_file(debug_dir, "rank_dom_*.json", args.date)

    webhook = clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
    if not webhook:
        print("[微信/抖音失败截图] 未配置 FEISHU_WEBHOOK_URL，跳过")
        return 0

    title = f"微信/抖音首跑失败截图 - {args.date}"
    lines = [
        f"**时间**：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "**任务**：wechat_douyin_weekly",
    ]
    if args.exit_code:
        lines.append(f"**退出码**：{args.exit_code}")
    if args.log_file:
        lines.append(f"**日志**：`{args.log_file}`")
    if screenshot:
        lines.append(f"**截图文件**：`{screenshot}`")
    else:
        lines.append("**截图文件**：未找到当天 `rank_empty_*.png`")
    if dom:
        lines.append(f"**DOM 诊断**：`{dom}`")
    if dom_lines := dom_summary(dom):
        lines.append("")
        lines.append("**页面诊断**")
        lines.extend(dom_lines)

    if screenshot:
        image_key = upload_local_image(screenshot)
        lines.append("")
        if image_key:
            lines.append(f"![失败截图]({image_key})")
        else:
            lines.append("截图已保存到本机，但飞书图片上传未成功，请按上方路径查看。")

    body = "\n".join(lines)
    return 0 if send_feishu(webhook, title, body) else 1


if __name__ == "__main__":
    raise SystemExit(main())
