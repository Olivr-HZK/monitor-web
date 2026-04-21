#!/usr/bin/env python3
"""
发送「AI 产品监测 - 竞品动态（sensortower_applist）」周报卡片中的摘要到飞书 / 企业微信。

数据来源：
  - public/sensortower_applist.db 中的 app_list_weekly_sales_merged + app_metadata
  - 摘要逻辑与前端详情页一致：用最近一周/上一周的下载量与收益调用大模型生成要点列表

使用方式（在项目根目录执行）：
  # 发送「最新一周」的 AI 竞品周报摘要（week_start 最大的那一周）
  python scripts/send_ai_competitor_weekly_digest.py

  # 指定周起始日期（与 sensortower_applist.db 中的 week_start 一致，YYYY-MM-DD）
  python scripts/send_ai_competitor_weekly_digest.py --week 2026-02-16

  # 只预览摘要，不真正发送到飞书 / 企微
  python scripts/send_ai_competitor_weekly_digest.py --dry-run

环境变量（.env 或系统环境）：
  - FEISHU_WEBHOOK_URL：飞书自定义机器人 Webhook
  - WECOM_WEBHOOK_URL_REAL / WECOM_WEBHOOK_URL：企业微信自定义机器人 Webhook
  - OPENROUTER_API_KEY：用于生成摘要的大模型 API Key（与 generate_top5_insight.py 共用）
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

try:
    # 复用已有的飞书/企微发送逻辑
    from send_ai_competitor_digest import send_to_feishu, send_to_wechat  # type: ignore
except Exception:  # pragma: no cover
    send_to_feishu = None  # type: ignore[assignment]
    send_to_wechat = None  # type: ignore[assignment]


DB_DEFAULT = Path("public/sensortower_applist.db")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL_ID = "moonshotai/kimi-k2.5"
SENSORTOWER_OVERVIEW_BASE = "https://app.sensortower-china.com"


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


def _clean_url(value: str | None) -> str | None:
    if not value:
        return None
    v = value.replace("\r", "").replace("\n", "").strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1].strip()
    return v if v else None


@dataclass
class AiCompetitorWeeklyItem:
    appId: str
    platform: str
    productName: str
    publisherName: str
    storeUrl: str | None
    downloadsThisWeek: float
    downloadsLastWeek: float
    revenueThisWeek: float
    revenueLastWeek: float


@dataclass
class AiCompetitorWeeklyPayload:
    weekThis: str
    weekLast: str
    items: list[AiCompetitorWeeklyItem]


def load_ai_competitor_weekly_from_db(db_path: Path, week_start: str | None = None) -> AiCompetitorWeeklyPayload | None:
    """
    从 sensortower_applist.db 中读取 AI 竞品周报数据：
    - 若未指定 week_start，则取 app_list_weekly_sales_merged 中最新的两周；
    - 若指定 week_start，则以内为上限，向前取最近两周（包含该周）。
    """
    if not db_path.exists():
        print(f"[AI竞品周报] 数据库不存在：{db_path}", file=sys.stderr)
        return None

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        if week_start:
            cur.execute(
                """
                SELECT DISTINCT week_start
                FROM app_list_weekly_sales_merged
                WHERE week_start <= ?
                ORDER BY week_start DESC
                LIMIT 2
                """,
                (week_start,),
            )
        else:
            cur.execute(
                """
                SELECT DISTINCT week_start
                FROM app_list_weekly_sales_merged
                ORDER BY week_start DESC
                LIMIT 2
                """
            )
        week_rows = [str(r[0]) for r in cur.fetchall() if r[0] is not None]
        if not week_rows:
            print("[AI竞品周报] app_list_weekly_sales_merged 中未找到 week_start", file=sys.stderr)
            return None
        week_this = week_rows[0]
        week_last = week_rows[1] if len(week_rows) > 1 else week_rows[0]

        week_this_safe = week_this.replace("'", "''")
        week_last_safe = week_last.replace("'", "''")

        sales_sql = f"""
          SELECT app_id, platform, week_start, downloads, revenue
          FROM app_list_weekly_sales_merged
          WHERE week_start = '{week_this_safe}' OR week_start = '{week_last_safe}'
          ORDER BY app_id, platform, week_start
        """
        sales_res = cur.execute(sales_sql).fetchall()
        if not sales_res:
            print("[AI竞品周报] 未取到本周/上周销量数据", file=sys.stderr)
            return None

        by_key: dict[tuple[str, str], dict[str, dict[str, float]]] = {}
        for row in sales_res:
            app_id = str(row["app_id"])
            platform = str(row["platform"])
            ws = str(row["week_start"])
            d = float(row["downloads"] or 0)
            r = float(row["revenue"] or 0)
            key = (app_id, platform)
            entry = by_key.setdefault(key, {"thisWeek": {"d": 0.0, "r": 0.0}, "lastWeek": {"d": 0.0, "r": 0.0}})
            if ws == week_this:
                entry["thisWeek"]["d"] += d
                entry["thisWeek"]["r"] += r
            else:
                entry["lastWeek"]["d"] += d
                entry["lastWeek"]["r"] += r

        meta_res = cur.execute(
            "SELECT app_id, os, name, publisher_name, url FROM app_metadata"
        ).fetchall()
        meta_map: dict[str, dict[str, Any]] = {}
        for row in meta_res:
            app_id = str(row["app_id"])
            os_val = str(row["os"])
            meta_map[f"{app_id}|{os_val}"] = {
                "name": row["name"],
                "publisher_name": row["publisher_name"],
                "url": row["url"],
            }
    finally:
        conn.close()

    items: list[AiCompetitorWeeklyItem] = []
    for (app_id, platform), val in by_key.items():
        meta = meta_map.get(f"{app_id}|{platform}") or meta_map.get(f"{app_id}|ios")
        name = str(meta["name"]).strip() if meta and meta.get("name") else app_id
        publisher = str(meta["publisher_name"]).strip() if meta and meta.get("publisher_name") else "—"
        url = str(meta["url"]).strip() if meta and meta.get("url") else None
        items.append(
            AiCompetitorWeeklyItem(
                appId=app_id,
                platform=platform,
                productName=name,
                publisherName=publisher,
                storeUrl=url or None,
                downloadsThisWeek=val["thisWeek"]["d"],
                downloadsLastWeek=val["lastWeek"]["d"],
                revenueThisWeek=val["thisWeek"]["r"],
                revenueLastWeek=val["lastWeek"]["r"],
            )
        )

    if not items:
        print("[AI竞品周报] 聚合后没有任何产品条目", file=sys.stderr)
        return None

    items.sort(key=lambda x: x.revenueThisWeek, reverse=True)
    return AiCompetitorWeeklyPayload(weekThis=week_this, weekLast=week_last, items=items)


def build_summary_prompt(payload: AiCompetitorWeeklyPayload) -> str:
    """
    构造与前端 WeeklyReportDetail.tsx 相同逻辑的 prompt，
    让大模型输出「本周竞品变化摘要」要点列表。
    """
    significant_items = [
        {
            "appId": it.appId,
            "name": it.productName,
            "publisher": it.publisherName,
            "platform": it.platform,
            "downloadsThisWeek": it.downloadsThisWeek,
            "downloadsLastWeek": it.downloadsLastWeek,
            "revenueThisWeek": it.revenueThisWeek,
            "revenueLastWeek": it.revenueLastWeek,
        }
        for it in payload.items
    ]
    data = {
        "weekThis": payload.weekThis,
        "weekLast": payload.weekLast,
        "items": significant_items,
    }
    lines = [
        "下面是一份 AI 产品竞品周报的源数据，字段包括每款产品本周/上周的下载量和收入：",
        json.dumps(data, ensure_ascii=False),
        "",
        "请用简洁的中文总结本周变化**明显**的产品（例如下载量或收入环比变化 ≥20% 或绝对变化特别大）。",
        "- 只说变化比较大的产品，没有明显变化的可以忽略；",
        "- 以要点列表形式输出，每条形如「产品A：下载量较上周 +35%，收入基本持平，主要亮点是……」；",
        "- 优先关注下载和收入同时大幅上升/下降的产品，其次是某一项大幅变化的产品；",
        "- 不需要重复列出原始数字，只需给出大致变化方向和量级（如「+30% 左右」「翻倍」「腰斩」等）。",
    ]
    return "\n".join(lines)


def _build_sensortower_overview_url(app_id: str, country: str = "US") -> str:
    """
    构造 SensorTower 概览页 URL（不带 project_id，直接 /overview/{app_id}?country=XX）。
    后台会自动选择/填充 project_id。
    """
    app_id = (app_id or "").strip()
    if not app_id:
        return ""
    base = os.environ.get("SENSORTOWER_OVERVIEW_BASE", SENSORTOWER_OVERVIEW_BASE).rstrip("/")
    code = (country or "").strip().upper() or "US"
    return f"{base}/overview/{app_id}?country={code}"


def add_links_to_summary(summary: str, payload: AiCompetitorWeeklyPayload) -> str:
    """
    将摘要中的产品名替换为可点击的 SensorTower 链接：
    - 对于每个 item.productName，若有 appId，则构造 /overview/{appId}?country=US
    - 支持多种出现形式：精确名、"名称 (平台)"、"名称（平台）"，按候选长度从长到短尝试，每产品只替换一次
    """
    text = summary or ""
    if not text.strip():
        return text

    for item in payload.items:
        name = (item.productName or "").strip()
        app_id = (item.appId or "").strip()
        platform = (item.platform or "").strip()
        if not name or not app_id:
            continue
        url = _build_sensortower_overview_url(app_id, "US")
        if not url:
            continue
        candidates = [name]
        if platform:
            candidates.append(f"{name} ({platform})")
            candidates.append(f"{name}（{platform}）")
        # 按长度降序，先匹配长串（如 "Himalaya (Android)" 再 "Himalaya"）
        candidates = sorted(set(c for c in candidates if c), key=len, reverse=True)
        for candidate in candidates:
            if f"[{candidate}](" in text:
                break
            if candidate in text:
                text = text.replace(candidate, f"[{candidate}]({url})", 1)
                break
    return text


def write_summary_json(repo_root: Path, payload: AiCompetitorWeeklyPayload, summary: str) -> None:
    """
    将每次生成的摘要写入 JSON 文件，供前端卡片使用：
    - 路径：public/ai产品/ai_竞品周报摘要_YYYY-MM-DD.json（YYYY-MM-DD 为 weekThis）
    - 字段：weekThis, weekLast, summary
    """
    out_dir = repo_root / "public" / "ai产品"
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = f"ai_竞品周报摘要_{payload.weekThis}.json"
    out_path = out_dir / filename
    data = {
        "weekThis": payload.weekThis,
        "weekLast": payload.weekLast,
        "summary": summary.strip(),
    }
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[AI竞品周报] 已写入摘要 JSON: {out_path}", file=sys.stderr)


def call_openrouter(api_key: str, prompt: str) -> str:
    """调用 OpenRouter Chat Completions，返回 content 文本。"""
    payload = {
        "model": MODEL_ID,
        "messages": [{"role": "user", "content": prompt}],
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=data,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8", errors="ignore"))
    except urllib.error.HTTPError as e:  # pragma: no cover - 网络错误时退出
        body_b = e.read()
        try:
            body = json.loads(body_b.decode("utf-8", errors="ignore"))
        except Exception:
            raise SystemExit(f"OpenRouter HTTP {e.code}: {body_b[:500]}")
        raise SystemExit(f"OpenRouter API 错误: {body.get('error', body)}")
    choice = (body.get("choices") or [None])[0]
    if not choice:
        raise SystemExit("OpenRouter 返回无 choices")
    msg = choice.get("message") or {}
    return (msg.get("content") or "").strip()


def build_digest_md(payload: AiCompetitorWeeklyPayload, summary: str) -> str:
    """构建发送到飞书 / 企微的 Markdown 文本。"""
    week_this = payload.weekThis
    week_last = payload.weekLast
    lines: list[str] = []
    lines.append("# AI 竞品周报（下载与收益）")
    lines.append("")
    lines.append(f"**周起始：{week_this}，对比上一周：{week_last}**")
    lines.append("")
    lines.append("## 本周竞品变化摘要")
    lines.append("")
    lines.append(summary.strip() or "本周暂无明显变化的产品。")
    lines.append("")
    lines.append("> 数据来源：SensorTower App List（app_list_weekly_sales_merged + app_metadata）")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="发送 AI 竞品周报（sensortower_applist）摘要到飞书和企业微信")
    parser.add_argument(
        "--db",
        type=Path,
        default=DB_DEFAULT,
        help="sensortower_applist.db 路径（相对仓库根目录或绝对路径），默认 public/sensortower_applist.db",
    )
    parser.add_argument(
        "--week",
        type=str,
        default=None,
        metavar="YYYY-MM-DD",
        help="指定周起始日期（week_start），不传则使用数据库中最新一周",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只生成摘要并打印，不发送到飞书/企业微信",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    _load_env(repo_root)

    db_path = repo_root / args.db if not args.db.is_absolute() else args.db

    payload = load_ai_competitor_weekly_from_db(db_path, week_start=args.week)
    if not payload:
        print("[AI竞品周报] 未获取到周报数据，停止发送。", file=sys.stderr)
        return 1

    api_key = (
        os.environ.get("OPENROUTER_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    ).strip()
    if not api_key:
        print("未设置 OPENROUTER_API_KEY / OPENAI_API_KEY，请在 .env 中配置。", file=sys.stderr)
        return 1

    prompt = build_summary_prompt(payload)
    summary = call_openrouter(api_key, prompt)

    # 将摘要中的产品名替换为可点击的 SensorTower 链接
    summary_with_links = add_links_to_summary(summary, payload)

    # 写入供前端使用的 JSON 摘要文件
    write_summary_json(repo_root, payload, summary_with_links)

    md = build_digest_md(payload, summary_with_links)

    if args.dry_run:
        print("=== AI 竞品周报摘要（dry-run）===")
        print(md)
        return 0

    feishu_url = _clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
    wecom_url = _clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL") or os.environ.get("WECOM_WEBHOOK_URL"))

    if not feishu_url and not wecom_url:
        print("未配置 FEISHU_WEBHOOK_URL 或 WECOM_WEBHOOK_URL_REAL/WECOM_WEBHOOK_URL，无法发送。", file=sys.stderr)
        return 1

    title = f"AI 竞品周报摘要-{payload.weekThis}"

    if feishu_url:
        if send_to_feishu is not None:
            send_to_feishu(feishu_url, md)  # type: ignore[arg-type]
        else:
            from send_ai_competitor_digest import post_json as _post_json  # type: ignore

            card_payload = {
                "msg_type": "interactive",
                "card": {
                    "config": {"wide_screen_mode": True},
                    "header": {"title": {"tag": "plain_text", "content": title}, "template": "blue"},
                    "elements": [{"tag": "markdown", "content": md}],
                },
            }
            status, resp = _post_json(feishu_url, card_payload)  # type: ignore[arg-type]
            if status != 200:
                print(f"[飞书] 发送失败 status={status} resp={resp}", file=sys.stderr)
            else:
                print("[飞书] 发送成功")

    if wecom_url:
        if send_to_wechat is not None:
            if not send_to_wechat(wecom_url, md):  # type: ignore[arg-type]
                return 1
        else:
            from send_ai_competitor_digest import post_json as _post_json  # type: ignore
            from wecom_webhook import wecom_webhook_succeeded  # type: ignore

            payload_md = {"msgtype": "markdown", "markdown": {"content": md}}
            status, resp = _post_json(wecom_url, payload_md)  # type: ignore[arg-type]
            ok, reason = wecom_webhook_succeeded(status, resp)
            if not ok:
                print(f"[企业微信] 发送失败：{reason}；完整响应：{resp[:800]!r}", file=sys.stderr)
                return 1
            print("[企业微信] 发送成功")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

