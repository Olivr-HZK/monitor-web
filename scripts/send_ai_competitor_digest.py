#!/usr/bin/env python3
"""
从本地 Markdown 简报文件读取内容，通过飞书机器人和企业微信机器人发送简报。

使用方式：
  1. 在项目根目录配置 .env（示例）：
     - FEISHU_WEBHOOK_URL=飞书自定义机器人 Webhook
     - WECOM_WEBHOOK_URL_REAL=企业微信自定义机器人 Webhook
  2. 激活虚拟环境并安装依赖：
     - pip install -r requirements.txt
  3. 运行脚本，例如：
     - python scripts/send_ai_competitor_digest.py
     - 或指定文件：
       python scripts/send_ai_competitor_digest.py --file public/ai产品/竞品动态报告_AI产品.md

说明：
  - 使用标准库 urllib 发送 HTTP 请求，加载 .env 依赖 python-dotenv。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv


def read_report(path: Path) -> str:
    """读取 Markdown 报告内容并返回字符串。"""
    if not path.exists():
        raise FileNotFoundError(f"报告文件不存在：{path}")
    content = path.read_text(encoding="utf-8")
    return content.strip()


def post_json(url: str, payload: dict) -> tuple[int, str]:
    """向指定 URL 发送 JSON 请求，返回 (status_code, response_text)。"""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_text = resp.read().decode("utf-8", errors="ignore")
            return resp.getcode(), resp_text
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        return e.code, body
    except urllib.error.URLError as e:
        return 0, f"URL error: {e}"


def send_to_feishu(webhook: str, text: str) -> None:
    """通过飞书机器人发送卡片消息（interactive card）。"""
    # 把 Markdown 第一行标题拿出来作为卡片标题（例如：# AI 竞品动态报告（本周简要版））
    title = "AI 竞品动态报告"
    lines = text.splitlines()
    for line in lines:
        l = line.strip()
        if l.startswith("#"):
            # 去掉开头的井号和空格
            title = l.lstrip("#").strip() or title
            break

    payload = {
        "msg_type": "interactive",
        "card": {
            "config": {
                "wide_screen_mode": True,
            },
            "header": {
                "title": {
                    "tag": "plain_text",
                    "content": title,
                },
                "template": "blue",
            },
            "elements": [
                {
                    # 直接把简报 Markdown 内容作为一个 markdown 元素展示
                    "tag": "markdown",
                    "content": text,
                },
            ],
        },
    }
    status, resp_text = post_json(webhook, payload)
    if status != 200:
        print(f"[飞书] 发送失败，status={status}, resp={resp_text}", file=sys.stderr)
    else:
        print("[飞书] 发送成功")


def send_to_wechat(webhook: str, text: str) -> None:
    """通过企业微信机器人发送 Markdown 消息。"""
    payload = {
        "msgtype": "markdown",
        "markdown": {
            "content": text,
        },
    }
    status, resp_text = post_json(webhook, payload)
    if status != 200:
        print(f"[企业微信] 发送失败，status={status}, resp={resp_text}", file=sys.stderr)
    else:
        print("[企业微信] 发送成功")


def main() -> None:
    parser = argparse.ArgumentParser(description="发送 AI 竞品简报到飞书和企业微信机器人")
    parser.add_argument(
        "--file",
        type=str,
        default="public/ai产品/竞品动态报告_AI产品.md",
        help="要发送的 Markdown 报告文件路径（相对仓库根目录）",
    )
    args = parser.parse_args()

    # 仓库根目录（scripts/ 的上一级）
    repo_root = Path(__file__).resolve().parents[1]

    # 优先从项目根目录加载 .env
    env_path = repo_root / ".env"
    if env_path.exists():
        load_dotenv(env_path)

    report_path = (repo_root / args.file).resolve()

    try:
        text = read_report(report_path)
    except Exception as e:  # noqa: BLE001
        print(f"读取报告失败：{e}", file=sys.stderr)
        sys.exit(1)

    # 从 .env / 环境变量获取 Webhook，清洗可能存在的引号、换行、空格
    def _clean_url(value: str | None) -> str | None:
        if not value:
            return None
        # 去掉换行、回车（.env 行尾或复制粘贴常带入），再首尾去空
        v = value.replace("\r", "").replace("\n", "").strip()
        # 去掉可能包在外层的引号（.env 里写 "https://..." 时 dotenv 有时会保留引号）
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1].strip()
        return v if v else None

    feishu_webhook = _clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
    wechat_webhook = _clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL"))

    if not feishu_webhook and not wechat_webhook:
        print(
            "未配置任何机器人 Webhook，请在 .env 中设置 FEISHU_WEBHOOK_URL 或 WECOM_WEBHOOK_URL_REAL",
            file=sys.stderr,
        )
        sys.exit(1)

    # 为了兼容机器人长度限制和展示效果，这里可以酌情截断或直接发送全文。
    # 目前报告已是极简版，默认直接发送全文。
    if feishu_webhook:
        send_to_feishu(feishu_webhook, text)

    if wechat_webhook:
        send_to_wechat(wechat_webhook, text)


if __name__ == "__main__":
    main()

