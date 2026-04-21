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

from wecom_webhook import wecom_webhook_succeeded


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

    elements = build_feishu_elements_from_md(text)
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
            "elements": elements,
        },
    }
    status, resp_text = post_json(webhook, payload)
    if status != 200:
        print(f"[飞书] 发送失败，status={status}, resp={resp_text}", file=sys.stderr)
    else:
        print("[飞书] 发送成功")


def send_to_wechat(webhook: str, text: str) -> bool:
    """通过企业微信机器人发送 Markdown 消息。返回 True 表示 errcode==0。"""
    payload = {
        "msgtype": "markdown",
        "markdown": {
            "content": convert_md_tables_to_list(text),
        },
    }
    status, resp_text = post_json(webhook, payload)
    ok, reason = wecom_webhook_succeeded(status, resp_text)
    if ok:
        print("[企业微信] 发送成功")
        return True
    print(f"[企业微信] 发送失败：{reason}；完整响应：{resp_text[:800]!r}", file=sys.stderr)
    return False


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
        if not send_to_wechat(wechat_webhook, text):
            sys.exit(1)


def _is_table_divider(line: str) -> bool:
    stripped = line.strip()
    if "|" not in stripped:
        return False
    cells = [c.strip() for c in stripped.strip("|").split("|")]
    if not cells:
        return False
    for c in cells:
        if not c:
            return False
        if not all(ch in "-: " for ch in c):
            return False
    return True


def _parse_md_table(lines: list[str], start: int) -> tuple[int, list[str], list[list[str]]]:
    header_line = lines[start]
    divider_line = lines[start + 1]
    headers = [c.strip() for c in header_line.strip().strip("|").split("|")]
    if not _is_table_divider(divider_line):
        return start, [], []
    rows: list[list[str]] = []
    i = start + 2
    while i < len(lines):
        line = lines[i]
        if "|" not in line:
            break
        row = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(row) != len(headers):
            break
        rows.append(row)
        i += 1
    return i, headers, rows


def split_md_and_tables(md: str) -> list[tuple[str, object]]:
    lines = md.splitlines()
    parts: list[tuple[str, object]] = []
    buffer: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if (
            i + 1 < len(lines)
            and "|" in line
            and _is_table_divider(lines[i + 1])
        ):
            if buffer:
                parts.append(("md", "\n".join(buffer).rstrip()))
                buffer = []
            next_i, headers, rows = _parse_md_table(lines, i)
            if headers and rows is not None:
                parts.append(("table", {"headers": headers, "rows": rows}))
                i = next_i
                continue
        buffer.append(line)
        i += 1
    if buffer:
        parts.append(("md", "\n".join(buffer).rstrip()))
    return parts


def convert_md_tables_to_list(md: str) -> str:
    parts = split_md_and_tables(md)
    out_lines: list[str] = []
    field_order = ["排名", "国家", "榜单", "平台", "下载量", "收益"]
    header_aliases = {
        "排名": ["排名", "当前排名"],
        "国家": ["国家/地区", "国家"],
        "榜单": ["榜单"],
        "平台": ["平台"],
        "下载量": ["下载量"],
        "收益": ["收入", "收益"],
    }
    name_headers = ["产品名", "游戏名", "应用名", "名称", "标题"]
    for kind, payload in parts:
        if kind == "md":
            text = str(payload).strip()
            if text:
                out_lines.append(text)
            continue
        headers = payload["headers"]
        rows = payload["rows"]
        out_lines.append("**表格**")
        header_index = {h: i for i, h in enumerate(headers)}
        for row in rows:
            name = None
            for h in name_headers:
                if h in header_index:
                    name = row[header_index[h]]
                    break
            if not name:
                name = row[0] if row else "—"

            fields = []
            for label in field_order:
                for h in header_aliases.get(label, []):
                    if h in header_index:
                        value = row[header_index[h]]
                        if value:
                            fields.append(f"{label}：{value}")
                        break
            if fields:
                out_lines.append(f"- {name}（" + "，".join(fields) + "）")
            else:
                out_lines.append(f"- {name}")
        out_lines.append("")
    return "\n".join(out_lines).strip()


def build_feishu_elements_from_md(md: str) -> list[dict]:
    parts = split_md_and_tables(md)
    elements: list[dict] = []
    for kind, payload in parts:
        if kind == "md":
            text = str(payload).strip()
            if text:
                elements.append({"tag": "markdown", "content": text})
            continue
        headers = payload["headers"]
        rows = payload["rows"]
        if headers:
            header_cols = []
            for h in headers:
                header_cols.append(
                    {
                        "tag": "column",
                        "width": "weighted",
                        "weight": 1,
                        "vertical_align": "top",
                        "elements": [{"tag": "markdown", "content": f"**{h}**"}],
                    }
                )
            elements.append({"tag": "column_set", "flex_mode": "none", "columns": header_cols})
        for row in rows:
            cols = []
            for v in row:
                cols.append(
                    {
                        "tag": "column",
                        "width": "weighted",
                        "weight": 1,
                        "vertical_align": "top",
                        "elements": [{"tag": "markdown", "content": v or "—"}],
                    }
                )
            elements.append({"tag": "column_set", "flex_mode": "none", "columns": cols})
        elements.append({"tag": "hr"})
    if not elements:
        elements.append({"tag": "markdown", "content": md})
    return elements


if __name__ == "__main__":
    main()
