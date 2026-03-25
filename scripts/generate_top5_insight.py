#!/usr/bin/env python3
"""
从 sensortower_top100.db 读取最近四周的 Top100 榜单，汇总每个榜单（平台/国家/类型）当前 Top5 的
一个月内排名趋势，调用 OpenRouter（Kimi 2.5）生成一段「Top5 异动陈述」，写入
public/休闲游戏检测/sensortower_周报/top5_异动陈述_YYYY-MM-DD.json（日期为对应周报的榜单日期，即当前周 rank_date）。

API Key：从环境变量 OPENROUTER_API_KEY 读取，建议在项目根目录 .env 中配置：
  OPENROUTER_API_KEY=sk-or-v1-...

使用方式（建议在项目根目录，并激活虚拟环境）：
  python scripts/generate_top5_insight.py
  python scripts/generate_top5_insight.py --db public/sensortower_top100.db --out-dir public/休闲游戏检测/sensortower_周报
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

# 从项目根目录加载 .env
try:
    from dotenv import load_dotenv
    _root = Path(__file__).resolve().parents[1]
    load_dotenv(_root / ".env")
except ImportError:
    pass

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL_ID = "moonshotai/kimi-k2.5"
RANK_WEEKS_LIMIT = 4


def get_last_rank_dates(cursor, table: str) -> list[str]:
    """获取表 table 中最近 RANK_WEEKS_LIMIT 个不同的 rank_date（降序）。"""
    cursor.execute(
        f"SELECT DISTINCT rank_date FROM {table} ORDER BY rank_date DESC LIMIT ?",
        (RANK_WEEKS_LIMIT,),
    )
    return [row[0] for row in cursor.fetchall() if row[0]]


def load_app_metadata(cursor) -> dict[str, str]:
    """(app_id, os) -> name，os 为 ios/android 小写。"""
    cursor.execute("SELECT app_id, os, name FROM app_metadata")
    out = {}
    for app_id, os_val, name in cursor.fetchall():
        key = (str(app_id), str(os_val or "").lower())
        if name:
            out[key] = str(name).strip()
    return out


def collect_top5_trends(conn: sqlite3.Connection) -> list[dict]:
    """
    对 apple_top100 / android_top100 每个表，取最近四周的 rank_date；
    对每个 (country, chart_type) 取「当前周」排名 1～5 的 app_id，再取这些 app 在四周内的 (rank_date, rank)。
    返回结构：[ { "platform", "country", "chart_type", "top5": [ {"app_id", "name", "current_rank"(1～5), "trend": [{"rank_date","rank"}] }, ... ] }, ... ]
    """
    cur = conn.cursor()
    meta = load_app_metadata(cur)
    tables = [
        ("apple_top100", "iOS", "ios"),
        ("android_top100", "Android", "android"),
    ]
    result = []
    for table, platform, os_key in tables:
        try:
            cur.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
            if not cur.fetchone():
                continue
        except Exception:
            continue
        dates = get_last_rank_dates(cur, table)
        if len(dates) == 0:
            continue
        latest_date = dates[0]
        placeholders = ",".join("?" * len(dates))
        # 当前周 (country, chart_type) 下 rank 1～5 的 app_id
        cur.execute(
            f"""
            SELECT country, chart_type, rank, app_id
            FROM {table}
            WHERE rank_date = ? AND rank BETWEEN 1 AND 5
            ORDER BY country, chart_type, rank
            """,
            (latest_date,),
        )
        rows = cur.fetchall()
        # 按 (country, chart_type) 分组，得到每组 top5 的 app_id 列表
        group: dict[tuple[str, str], list[tuple[int, str]]] = defaultdict(list)
        for country, chart_type, rank, app_id in rows:
            group[(country, chart_type)].append((rank, app_id))
        for (country, chart_type), apps in group.items():
            sorted_apps = sorted(apps, key=lambda x: x[0])  # (rank, app_id)，rank 1～5
            app_ids = [a[1] for a in sorted_apps]
            # 取这些 app 在 dates 内所有 (rank_date, rank)
            cur.execute(
                f"""
                SELECT app_id, rank_date, rank
                FROM {table}
                WHERE rank_date IN ({placeholders}) AND app_id IN ({",".join("?" * len(app_ids))})
                ORDER BY app_id, rank_date DESC
                """,
                dates + app_ids,
            )
            raw_trends = cur.fetchall()
            # 按 app_id 聚合成 trend 列表
            by_app: dict[str, list[dict]] = defaultdict(list)
            for app_id, rank_date, rank in raw_trends:
                by_app[app_id].append({"rank_date": rank_date, "rank": rank})
            top5_list = []
            for current_rank, app_id in sorted_apps:
                name = meta.get((app_id, os_key), "") or app_id
                trend = by_app.get(app_id, [])
                trend.sort(key=lambda x: x["rank_date"], reverse=True)
                top5_list.append({
                    "app_id": app_id,
                    "name": name,
                    "current_rank": current_rank,
                    "trend": trend,
                })
            result.append({
                "platform": platform,
                "country": country,
                "chart_type": chart_type,
                "top5": top5_list,
            })
    return result


def build_overview_url(app_id: str, country: str) -> str:
    """构造 SensorTower 概览页 URL（不带 project_id，直接 /overview/{app_id}?country=XX）。"""
    base = os.environ.get("SENSORTOWER_OVERVIEW_BASE", "https://app.sensortower-china.com").rstrip("/")
    code = (country or "").strip() or "US"
    return f"{base}/overview/{app_id}?country={code}"


def build_prompt(data: list[dict]) -> str:
    """将 Top5 趋势数据整理成给大模型的 prompt。"""
    # 为每个 Top5 游戏预先生成一个推荐链接，方便大模型在陈述中直接使用 Markdown 链接。
    link_entries: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for group in data:
        country = str(group.get("country", "") or "").strip() or "US"
        for item in group.get("top5", []):
            app_id = str(item.get("app_id", "") or "").strip()
            name = str(item.get("name", "") or "").strip() or app_id
            if not app_id or not name:
                continue
            key = (name, app_id, country)
            if key in seen:
                continue
            seen.add(key)
            url = build_overview_url(app_id, country)
            link_entries.append({"name": name, "url": url})

    lines = [
        "以下为 SensorTower 休闲游戏 Top100 榜单中，各榜单（平台/国家/类型）当前排名前五的游戏，以及其最近四周的排名趋势。",
        "每个游戏带有 current_rank（当前周排名，1=榜首 2=第二 … 5=第五），trend 为按时间从新到旧的 (rank_date, rank) 列表，第一条即「当前周」数据。",
        "",
        "请严格根据数据写一段「Top5 异动简述」（2～4 句中文）：",
        "1. 「登顶」仅指：当前周 current_rank 为 1，且 trend 中前一周或更早曾出现过 rank 非 1（即本周新上第一）。若某游戏 current_rank 不是 1，切勿说其登顶。",
        "2. 「掉出第一」仅指：当前周 current_rank 非 1，且 trend 中前一周 rank 为 1（即本周从第一滑落）。",
        "3. 可概括整体趋势（谁在上升、谁在下降、是否稳定），不要列举具体数字。",
        "4. 避免编造「转而在某市场登顶」「从 A 市场转战 B 市场」等故事性叙述，除非数据非常明确；更倾向使用「在 X 市场持续领跑 / 表现强势 / 保持领先」等中性表述。",
        "5. 若同时涉及「免费榜」（chart_type = free）与「畅销榜」（chart_type = grossing），请尽量分开描述：免费榜一行、畅销榜一行，例如：第一行以「免费榜方面，……」开头，换行后第二行以「畅销榜方面，……」开头，使逻辑更清晰。若只涉及其中一种榜单，则只写对应的一行即可。",
        "",
        "陈述中提到具体游戏时，请使用 Markdown 链接格式 `[游戏名](链接)`。下面为可用游戏名及链接（不必全用）：",
    ]
    for entry in link_entries:
        lines.append(f"- {entry['name']}：{entry['url']}")
    lines.extend([
        "",
        "数据（JSON）：",
        json.dumps(data, ensure_ascii=False, indent=2),
    ])
    return "\n".join(lines)


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
    except urllib.error.HTTPError as e:
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


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 Top5 异动陈述并写入 JSON")
    parser.add_argument(
        "--db",
        type=Path,
        default=Path("public/sensortower_top100.db"),
        help="sensortower_top100.db 路径",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("public/休闲游戏检测/sensortower_周报"),
        help="输出目录，将写入 top5_异动陈述_YYYY-MM-DD.json",
    )
    args = parser.parse_args()
    if not args.db.exists():
        print(f"数据库不存在: {args.db}", file=sys.stderr)
        sys.exit(1)
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        print("未设置 OPENROUTER_API_KEY，请在 .env 中配置（项目根目录 .env 或环境变量）", file=sys.stderr)
        sys.exit(1)
    conn = sqlite3.connect(args.db)
    cur = conn.cursor()
    try:
        # 当前周报日期 = 最近一周的 rank_date（与周报日期一致）
        for table in ("apple_top100", "android_top100"):
            dates = get_last_rank_dates(cur, table)
            if dates:
                latest_date = dates[0]
                break
        else:
            latest_date = None
        data = collect_top5_trends(conn)
    finally:
        conn.close()
    from datetime import date
    report_date = latest_date or date.today().isoformat()
    out_filename = f"top5_异动陈述_{report_date}.json"
    args.out_dir.mkdir(parents=True, exist_ok=True)
    if not data:
        print("未获取到任何 Top5 趋势数据，跳过调用大模型", file=sys.stderr)
        payload = {"statement": "", "updatedAt": ""}
        (args.out_dir / out_filename).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已写入空陈述: {args.out_dir / out_filename}")
        return
    prompt = build_prompt(data)
    statement = call_openrouter(api_key, prompt)
    payload = {"statement": statement, "updatedAt": date.today().isoformat()}
    out_file = args.out_dir / out_filename
    out_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已写入: {out_file}")


if __name__ == "__main__":
    main()
