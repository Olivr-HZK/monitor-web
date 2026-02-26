#!/usr/bin/env python3
"""
从 competitor_data.db 的 weekly_reports 表筛选「有玩法更新」或「有线下活动」的竞品周报，
按评分排序后生成简报并推送到飞书和企业微信。

筛选规则：
  - report_content 原始文本包含「玩法更新」或「线下活动」
  - 能解析出可用性评分（**可用性评分**: X ⭐）
仅推送满足以上条件的周报，并按评分从高到低排序，每条展示：公司、周期、评分。

使用方式（项目根目录）：
  python scripts/send_competitor_digest.py                    # 最新一周（库里 max(end_date)）
  python scripts/send_competitor_digest.py --date 2026-02-16  # 指定该周（end_date=2026-02-16）
  python scripts/send_competitor_digest.py --db public/competitor_data.db --dry-run
"""

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime
import urllib.error
import urllib.request
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

# 监测汇总平台链接（与游戏周报一致，可点击跳转）
PLATFORM_LINK = "https://sites.google.com/castbox.fm/overwatch2/home?authuser=1"


def _load_env(repo_root: Path) -> None:
    env_path = repo_root / ".env"
    if env_path.exists() and load_dotenv is not None:
        load_dotenv(env_path)
    elif env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip()
            if v.startswith('"') and v.endswith('"'):
                v = v[1:-1]
            elif v.startswith("'") and v.endswith("'"):
                v = v[1:-1]
            os.environ.setdefault(k, v)


def _post_json(url: str, payload: dict) -> tuple[int, str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.getcode(), resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="ignore")
    except urllib.error.URLError as e:
        return 0, str(e)


def extract_score_from_report_content(report_content: str) -> float | None:
    """从 report_content JSON 中解析评分。支持两种格式：
    - **可用性评分**: 2.0 ⭐（旧版）
    - **周报评分**: 6/10 ⭐（新版，取分子为分数）
    """
    try:
        data = json.loads(report_content)
    except json.JSONDecodeError:
        return None
    card = data.get("card") if isinstance(data, dict) else None
    elements = card.get("elements") if isinstance(card, dict) else []
    if not isinstance(elements, list):
        return None
    scores: list[float] = []
    pattern_old = re.compile(r"\*\*可用性评分\*\*:\s*([\d.]+)\s*⭐")
    pattern_new = re.compile(r"\*\*周报评分\*\*:\s*(\d+)/10\s*⭐")
    for el in elements:
        if not isinstance(el, dict):
            continue
        for node in [el.get("text"), *([] if not el.get("fields") else el["fields"])]:
            if not isinstance(node, dict):
                continue
            # 内容可能在 node["content"]（如 lark_md 的 text）或 node["text"]["content"]（如 fields 里）
            content = node.get("content") if isinstance(node.get("content"), str) else None
            if not content and isinstance(node.get("text"), dict):
                content = node["text"].get("content")
            if not isinstance(content, str):
                continue
            m = pattern_old.search(content)
            if m:
                try:
                    scores.append(float(m.group(1)))
                except ValueError:
                    pass
            m = pattern_new.search(content)
            if m:
                try:
                    scores.append(float(m.group(1)))
                except ValueError:
                    pass
    if not scores:
        return None
    return round(sum(scores) / len(scores) * 10) / 10


def extract_title_from_report_content(report_content: str) -> str:
    """从 report_content JSON 中解析周报标题（本周标题 或 card.header.title）。"""
    try:
        data = json.loads(report_content)
    except json.JSONDecodeError:
        return ""
    card = data.get("card") if isinstance(data, dict) else None
    if not isinstance(card, dict):
        return ""
    # 优先从 elements 里 **本周标题**: xxx 提取
    elements = card.get("elements") or []
    title_pattern = re.compile(r"\*\*本周标题\*\*[：:]\s*(.+?)(?:\n|$)", re.DOTALL)
    for el in elements:
        if not isinstance(el, dict):
            continue
        for node in [el.get("text"), *([] if not el.get("fields") else el["fields"])]:
            if not isinstance(node, dict):
                continue
            content = node.get("content") if isinstance(node.get("content"), str) else None
            if not content and isinstance(node.get("text"), dict):
                content = node["text"].get("content")
            if isinstance(content, str):
                m = title_pattern.search(content)
                if m:
                    return m.group(1).strip()
    # 否则用 header.title.content（可能带「竞品监控 · 公司名 · 」前缀）
    header = card.get("header") or {}
    title_obj = header.get("title") or {}
    raw_title = title_obj.get("content") if isinstance(title_obj, dict) else ""
    if isinstance(raw_title, str) and raw_title.strip():
        # 去掉 "🏁 竞品监控 · 公司名 · " 前缀，保留后半段作为标题
        for prefix in ("竞品监控 · ", "🏁 ", "· "):
            if raw_title.startswith(prefix):
                raw_title = raw_title[len(prefix):].strip()
            if " · " in raw_title:
                parts = raw_title.split(" · ", 1)
                if len(parts) > 1:
                    raw_title = parts[1].strip()  # 取「 · 」后的部分
        return raw_title.strip()
    return ""


def has_gameplay_or_offline(report_content: str) -> bool:
    """报告内容是否包含「玩法更新」「新玩法」或「线下活动」关键词（没有这些的不推送）。"""
    return (
        "玩法更新" in report_content
        or "新玩法" in report_content
        or "线下活动" in report_content
    )


def fetch_competitor_reports_for_digest(
    db_path: Path,
    end_date_filter: str | None = None,
) -> list[dict]:
    """从 weekly_reports 读取周报，筛选含玩法更新/线下活动且有评分的，按评分降序。
    end_date_filter: 若指定（YYYY-MM-DD），只保留该 end_date 的一周；否则用库里最新一周（max end_date）。"""
    if not db_path.exists():
        return []
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    if end_date_filter:
        cur = conn.execute(
            """
            SELECT id, company_name, start_date, end_date, report_content, created_at
            FROM weekly_reports
            WHERE end_date = ?
            ORDER BY company_name ASC
            """,
            (end_date_filter[:10],),
        )
    else:
        # 最新一周：先取 max(end_date)，再查该周
        cur = conn.execute(
            "SELECT end_date FROM weekly_reports ORDER BY end_date DESC LIMIT 1"
        )
        row = cur.fetchone()
        if not row:
            conn.close()
            return []
        latest_end = (row[0] or "")[:10]
        cur = conn.execute(
            """
            SELECT id, company_name, start_date, end_date, report_content, created_at
            FROM weekly_reports
            WHERE end_date = ?
            ORDER BY company_name ASC
            """,
            (latest_end,),
        )
    rows = cur.fetchall()
    conn.close()
    out: list[dict] = []
    for row in rows:
        raw = row["report_content"] or ""
        if not has_gameplay_or_offline(raw):
            continue
        score = extract_score_from_report_content(raw)
        if score is None:
            continue
        title = extract_title_from_report_content(raw)
        start_date = (row["start_date"] or "")[:10]
        end_date = (row["end_date"] or "")[:10]
        out.append({
            "id": row["id"],
            "company_name": row["company_name"],
            "start_date": start_date,
            "end_date": end_date,
            "score": score,
            "title": title,
            "created_at": row["created_at"] or "",
        })
    out.sort(key=lambda x: (-x["score"], x["start_date"], x["company_name"]))
    return out


def build_digest_md(items: list[dict], week_label: str = "") -> str:
    """生成竞品检测简报 Markdown（按评分排序，带评分）。week_label 可选，如「2026-02-16 当周」。"""
    lines = [
        "# 竞品检测简报（玩法更新 / 线下活动）",
        "",
    ]
    if week_label:
        lines.append(f"**{week_label}** 含**玩法更新**或**线下活动**的竞品周报，按可用性评分从高到低排列。")
    else:
        lines.append("以下为含**玩法更新**或**线下活动**的竞品周报，按可用性评分从高到低排列。")
    lines.append("")
    lines.append(
        "**评分说明**：同时含「新玩法」和「线下活动」的周报一般给 **7–10 分**，"
        "仅包含其中一项（有新玩法或有线下活动）一般给 **5–7 分**，"
        "两者都没有或主要为日常维护一般给 **1–3 分**；"
        "只要有帖子更新就不会给 **0 分**。"
    )
    lines.append("")
    if not items:
        lines.append("")
        lines.append("本周暂无符合条件的周报。")
        return "\n".join(lines)
    for i, r in enumerate(items, 1):
        company = r.get("company_name") or "—"
        start = r.get("start_date") or ""
        end = r.get("end_date") or ""
        score = r.get("score")
        title = (r.get("title") or "").strip()
        period = f"{start} ~ {end}" if start and end else ""
        score_str = f"**评分 {score}**" if score is not None else ""
        if title:
            # 公司后面括号展示本周标题
            lines.append(f"{i}. **{company}** {period} {score_str}（{title}）")
        else:
            lines.append(f"{i}. **{company}** {period} {score_str}")
    lines.append("")
    lines.append(f"> 👉 查看竞品周报详情：[监测汇总平台]({PLATFORM_LINK})")
    return "\n".join(lines)


def send_feishu(webhook: str, title: str, md: str) -> None:
    """飞书互动卡片。"""
    md_adapted = "\n".join(
        f"**{line.lstrip('#').strip()}**" if line.strip().startswith("#") else line
        for line in md.splitlines()
    )
    payload = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {"title": {"tag": "plain_text", "content": title}, "template": "blue"},
            "elements": [{"tag": "markdown", "content": md_adapted}],
        },
    }
    status, resp = _post_json(webhook, payload)
    if status != 200:
        print(f"[飞书] 发送失败 status={status} resp={resp}", file=sys.stderr)
    else:
        print("[飞书] 发送成功")


def send_wecom(webhook: str, md: str, max_bytes: int = 4096) -> None:
    """企业微信 Markdown，超长截断。"""
    data = md.encode("utf-8")
    if len(data) > max_bytes:
        suffix = f"\n\n> 内容过长，详见 [监测汇总平台]({PLATFORM_LINK}) 查看。"
        keep = max_bytes - len(suffix.encode("utf-8"))
        if keep > 0:
            chunk = data[:keep]
            while chunk and (chunk[-1] & 0x80) and not (chunk[-1] & 0x40):
                chunk = chunk[:-1]
            md = chunk.decode("utf-8", errors="ignore") + suffix
    payload = {"msgtype": "markdown", "markdown": {"content": md}}
    status, resp = _post_json(webhook, payload)
    if status != 200:
        print(f"[企业微信] 发送失败 status={status} resp={resp}", file=sys.stderr)
    else:
        print("[企业微信] 发送成功")


def main() -> int:
    parser = argparse.ArgumentParser(description="推送竞品检测简报（玩法更新/线下活动+评分）到飞书和企业微信")
    parser.add_argument(
        "--db",
        type=Path,
        default=Path("public/competitor_data.db"),
        help="competitor_data.db 路径",
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        metavar="YYYY-MM-DD",
        help="指定周报所在周的 start_date（如 2026-02-16）。不传则使用库里最新一周",
    )
    parser.add_argument("--dry-run", action="store_true", help="只生成内容不发送")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    _load_env(repo_root)

    if args.date:
        try:
            datetime.strptime(args.date.strip(), "%Y-%m-%d")
            end_date_filter = args.date.strip()[:10]
        except ValueError:
            print(f"[错误] --date 格式应为 YYYY-MM-DD，例如 2026-02-16，当前为：{args.date!r}", file=sys.stderr)
            return 1
    else:
        end_date_filter = None

    db_path = repo_root / args.db if not args.db.is_absolute() else args.db
    items = fetch_competitor_reports_for_digest(db_path, end_date_filter=end_date_filter)
    week_label = ""
    if items:
        week_label = f"{items[0].get('end_date', '')} 当周"
    md = build_digest_md(items, week_label=week_label)

    if args.dry_run:
        print("=== 竞品检测简报（dry-run）===")
        print(md)
        return 0

    feishu_url = (os.environ.get("FEISHU_WEBHOOK_URL") or "").strip().replace("\r", "").replace("\n", "")
    wecom_url = (
        (os.environ.get("WECOM_WEBHOOK_URL_REAL") or os.environ.get("WECOM_WEBHOOK_URL") or "").strip().replace("\r", "").replace("\n", "")
    )
    if not feishu_url and not wecom_url:
        print("未配置 FEISHU_WEBHOOK_URL 或 WECOM_WEBHOOK_URL_REAL/WECOM_WEBHOOK_URL", file=sys.stderr)
        return 1

    title = "竞品检测简报（玩法更新/线下活动）"
    if week_label:
        title = f"{title}-{week_label}"
    if feishu_url:
        send_feishu(feishu_url, title, md)
    if wecom_url:
        send_wecom(wecom_url, md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
