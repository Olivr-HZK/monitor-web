#!/usr/bin/env python3
"""
构建日报/周报内容，并发送到飞书和企业微信：
  1. 热点趋势日报（来自 public/热点/final_json.json）
  2. 微信/抖音小游戏周报（来自 public/videos.db 的 weekly_report_simple）
  3. SensorTower 周报（来自 public/sensortower_top100.db 的 rank_changes）

飞书：发一条互动卡片（interactive card，内容为 Markdown）。
企业微信：发一条 Markdown 消息。

环境变量（.env 或系统环境）：
  - FEISHU_WEBHOOK_URL：飞书自定义机器人 Webhook
  - WECOM_WEBHOOK_URL_REAL：企业微信自定义机器人 Webhook

使用方式（在项目根目录）：
  python scripts/send_minigame_weekly_reports.py
  python scripts/send_minigame_weekly_reports.py --reports hot_trend_daily,wechat_douyin_weekly
  python scripts/send_minigame_weekly_reports.py --videos-db public/videos.db --sensortower-db public/sensortower_top100.db
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def _load_env(repo_root: Path) -> None:
    """从项目根目录加载 .env 到 os.environ。有 dotenv 用 dotenv，否则简单解析。"""
    env_path = repo_root / ".env"
    if not env_path.exists():
        return
    if load_dotenv is not None:
        load_dotenv(env_path)
        return
    # 无 python-dotenv 时简单解析 KEY=VALUE（忽略空行、# 注释、去引号）
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1].strip()
        elif value.startswith("'") and value.endswith("'"):
            value = value[1:-1].strip()
        if key:
            os.environ[key] = value


DETAIL_LINK = "https://olivr-hzk.github.io/monitor-web/"
WEEKLY_BRIEF_PLATFORM = {"wx": "微信小游戏", "dy": "抖音小游戏"}


# ---------- 热点趋势日报（来自 public/热点/final_json.json）----------
def _parse_iso_date(value: str | None) -> str:
    if not value:
        return datetime.now().strftime("%Y-%m-%d")
    try:
        return datetime.fromisoformat(value).strftime("%Y-%m-%d")
    except ValueError:
        return datetime.now().strftime("%Y-%m-%d")


def _extract_section(content: str, heading: str) -> str:
    if not content:
        return ""
    pattern = re.compile(rf"##\s*{re.escape(heading)}\s*\n([\s\S]*?)(?=\n##\s|$)")
    match = pattern.search(content)
    return match.group(1).strip() if match else ""


def build_hot_trend_daily_md(json_path: Path, top_count: int = 5) -> tuple[str | None, str | None]:
    if not json_path.exists():
        return None, None
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"[热点趋势日报] JSON 解析失败: {e}", file=sys.stderr)
        return None, None

    generated_at = str(data.get("generated_at") or "")
    date_str = _parse_iso_date(generated_at)
    feishu_block = data.get("feishu", {})
    documents = feishu_block.get("documents", []) if isinstance(feishu_block, dict) else []
    if not documents:
        return None, None

    titles = []
    for doc in documents:
        if not isinstance(doc, dict):
            continue
        title = str(doc.get("title") or "").strip()
        if title:
            titles.append(title)
    top_titles = titles[:top_count] if titles else []

    summary_lines = [
        f"【热点趋势日报】{date_str}",
        f"- 本周 Google Trends Top {len(top_titles)} 热点：{'、'.join(top_titles) if top_titles else '暂无'}",
        f"> 详情进入 [监测汇总平台]({DETAIL_LINK}) 查看。",
    ]
    summary_md = "\n".join(summary_lines)

    full_lines = [f"# 热点趋势日报（{date_str}）", ""]
    for idx, doc in enumerate(documents, start=1):
        if not isinstance(doc, dict):
            continue
        title = str(doc.get("title") or f"热点 {idx}").strip()
        content = str(doc.get("content") or "")
        score = doc.get("score")
        meta = doc.get("meta", {}) if isinstance(doc.get("meta", {}), dict) else {}
        heat = meta.get("heat")
        summary = _extract_section(content, "摘要") or str(doc.get("summary") or "").strip()
        ua = _extract_section(content, "UA灵感")
        gen = _extract_section(content, "生成适配")
        link = _extract_section(content, "原文链接")
        if link:
            link = next((v for v in link.split() if v.startswith("http")), link)
        if not link:
            link = meta.get("url")

        full_lines.append(f"## {idx}. {title}")
        if score is not None:
            full_lines.append(f"**评分**：{score}")
        if heat is not None:
            full_lines.append(f"**热度**：{heat}")
        if summary:
            full_lines.append(f"**摘要**：{summary}")
        if ua:
            full_lines.append(f"**UA灵感**：{ua}")
        if gen:
            full_lines.append(f"**生成适配**：{gen}")
        if link:
            full_lines.append(f"**原文链接**：{link}")
        full_lines.append("")

    full_lines.append(f"详情进入 [监测汇总平台]({DETAIL_LINK}) 查看。")
    full_md = "\n".join(full_lines).strip()
    return full_md, summary_md


# ---------- 微信/抖音小游戏周报（与前端 reportsLoader.loadWeeklyBriefFromDb 一致）----------
def build_wechat_douyin_weekly_md(conn: sqlite3.Connection) -> str | None:
    """从 weekly_report_simple 取最新一周，生成与前端一致的「完整版」周报 Markdown。"""
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT week_range, platform, game_name, change_type, rank, rank_change
            FROM weekly_report_simple
            WHERE platform IN ('wx', 'dy')
            ORDER BY week_range DESC, platform, change_type, CAST(rank AS INTEGER)
            """
        )
        rows = [
            {
                "week_range": r[0],
                "platform": r[1],
                "game_name": r[2],
                "change_type": r[3],
                "rank": r[4],
                "rank_change": r[5],
            }
            for r in cur.fetchall()
        ]
    except sqlite3.OperationalError as e:
        print(f"[微信/抖音] 读取 weekly_report_simple 失败: {e}", file=sys.stderr)
        return None

    if not rows:
        return None

    by_week: dict[str, list] = {}
    for r in rows:
        w = r["week_range"] or ""
        if not w:
            continue
        if w not in by_week:
            by_week[w] = []
        by_week[w].append(r)

    # 取最新一周
    latest_week = max(by_week.keys())
    week_rows = by_week[latest_week]
    new_in = [r for r in week_rows if r["change_type"] == "新进榜"]
    surge = [r for r in week_rows if r["change_type"] == "飙升"]

    lines = [
        f"# 周报简要 {latest_week}",
        "",
        f"**监控时间**：{latest_week}",
        "",
    ]
    if new_in:
        lines.append("## 本周新进榜")
        lines.append("")
        for r in new_in:
            label = WEEKLY_BRIEF_PLATFORM.get(r["platform"], r["platform"])
            lines.append(f"- **{r['game_name']}**（{label}）")
        lines.append("")
    if surge:
        lines.append("## 本周排名飙升")
        lines.append("")
        for r in surge:
            label = WEEKLY_BRIEF_PLATFORM.get(r["platform"], r["platform"])
            lines.append(f"- **{r['game_name']}**（{label}，排名变化 {r['rank_change']}）")
        lines.append("")
    if not new_in and not surge:
        lines.append("该周暂无新进榜或排名飙升记录。")
        lines.append("")
    lines.append("---")
    lines.append("")
    lines.append(f"详细玩法请登录 [监测汇总平台]({DETAIL_LINK}) 查看。")
    return "\n".join(lines)


def build_wechat_douyin_summary_md(conn: sqlite3.Connection) -> str | None:
    """构建给 IM 使用的「简报版」微信/抖音小游戏周报（不含表格，只保留摘要+代表游戏）。"""
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT week_range, platform, game_name, change_type, rank, rank_change
            FROM weekly_report_simple
            WHERE platform IN ('wx','dy')
            ORDER BY week_range DESC, platform, change_type, CAST(rank AS INTEGER)
            """
        )
        rows = [
            {
                "week_range": r[0],
                "platform": r[1],
                "game_name": r[2],
                "change_type": r[3],
                "rank": r[4],
                "rank_change": r[5],
            }
            for r in cur.fetchall()
        ]
    except sqlite3.OperationalError as e:
        print(f"[微信/抖音] 读取 weekly_report_simple(摘要) 失败: {e}", file=sys.stderr)
        return None

    if not rows:
        return None

    by_week: dict[str, list] = {}
    for r in rows:
        w = str(r["week_range"] or "")
        if not w:
            continue
        by_week.setdefault(w, []).append(r)

    latest_week = max(by_week.keys())
    week_rows = by_week[latest_week]
    new_in = [r for r in week_rows if r["change_type"] == "新进榜"]
    surge = [r for r in week_rows if r["change_type"] == "飙升"]

    def pick_names(items: list[dict], limit: int = 5) -> str:
        names = [str(r.get("game_name") or "").strip() for r in items[:limit]]
        names = [n for n in names if n]
        return "、".join(names)

    new_names = pick_names(new_in, 5)
    surge_names = pick_names(surge, 5)

    lines: list[str] = []
    lines.append(f"【微信/抖音小游戏周报】{latest_week}")
    if new_in:
        if new_names:
            lines.append(f"- 新进榜：{len(new_in)} 款，代表：{new_names}")
        else:
            lines.append(f"- 新进榜：{len(new_in)} 款")
    else:
        lines.append("- 新进榜：0 款")

    if surge:
        if surge_names:
            lines.append(f"- 排名飙升：{len(surge)} 款，代表：{surge_names}")
        else:
            lines.append(f"- 排名飙升：{len(surge)} 款")
    else:
        lines.append("- 排名飙升：0 款")

    return "\n".join(lines)


# ---------- SensorTower 周报（与前端 sensortowerWeeklyReport + generate_sensortower_weekly_report 一致）----------
def _parse_surge(change: str) -> int:
    if not change or change == "NEW":
        return 0
    m = re.search(r"↑\s*(\d+)", str(change).strip())
    return int(m.group(1)) if m else 0


def _fmt_num(n) -> str:
    if n is None:
        return "—"
    try:
        n = int(n)
    except (TypeError, ValueError):
        return str(n)
    if n >= 10000:
        return f"{n / 10000:.2f}万"
    return f"{n:,}"


def _fmt_revenue(r) -> str:
    if r is None:
        return "—"
    try:
        r = float(r)
    except (TypeError, ValueError):
        return str(r)
    if r >= 10000:
        return f"${r / 10000:.2f}万"
    return f"${r:,.0f}"


def build_sensortower_weekly_md(conn: sqlite3.Connection) -> str | None:
    """从 rank_changes 取最新一周，生成与前端一致的「完整版」 SensorTower 周报 Markdown。"""
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT DISTINCT rank_date_current, rank_date_last
            FROM rank_changes
            ORDER BY rank_date_current DESC
            LIMIT 1
            """
        )
        row = cur.fetchone()
        if not row:
            return None
        rank_date_current, rank_date_last = row[0], row[1] or ""
    except sqlite3.OperationalError as e:
        print(f"[SensorTower] 读取 rank_changes 失败: {e}", file=sys.stderr)
        return None

    cur.execute(
        """
        SELECT
            r.current_rank,
            r.last_week_rank,
            r.change,
            r.app_id,
            r.country,
            r.platform,
            r.downloads,
            r.revenue,
            COALESCE(m.name, r.app_name, r.app_id) AS display_name,
            COALESCE(NULLIF(TRIM(r.publisher_name), ''), m.publisher_name) AS publisher_name
        FROM rank_changes r
        LEFT JOIN app_metadata m ON m.app_id = r.app_id AND m.os = LOWER(r.platform)
        WHERE r.rank_date_current = ?
          AND r.change_type = '🆕 新进榜单'
          AND r.current_rank <= 50
        ORDER BY r.current_rank ASC, r.country, r.platform
        """,
        (rank_date_current,),
    )
    new_top50 = [
        {
            "current_rank": r[0],
            "last_week_rank": r[1],
            "change": r[2],
            "app_id": r[3],
            "country": r[4],
            "platform": r[5],
            "downloads": r[6],
            "revenue": r[7],
            "display_name": r[8] or r[3],
            "publisher_name": r[9] or "—",
        }
        for r in cur.fetchall()
    ]

    cur.execute(
        """
        SELECT
            r.current_rank,
            r.last_week_rank,
            r.change,
            r.app_id,
            r.country,
            r.platform,
            r.downloads,
            r.revenue,
            COALESCE(m.name, r.app_name, r.app_id) AS display_name,
            COALESCE(NULLIF(TRIM(r.publisher_name), ''), m.publisher_name) AS publisher_name
        FROM rank_changes r
        LEFT JOIN app_metadata m ON m.app_id = r.app_id AND m.os = LOWER(r.platform)
        WHERE r.rank_date_current = ?
          AND r.change_type = '🚀 排名飙升'
        ORDER BY r.current_rank ASC
        """,
        (rank_date_current,),
    )
    surge_rows = [
        {
            "current_rank": r[0],
            "last_week_rank": r[1],
            "change": r[2],
            "surge_value": _parse_surge(r[2] or ""),
            "app_id": r[3],
            "country": r[4],
            "platform": r[5],
            "downloads": r[6],
            "revenue": r[7],
            "display_name": r[8] or r[3],
            "publisher_name": r[9] or "—",
        }
        for r in cur.fetchall()
    ]
    surge_rows.sort(key=lambda x: (-x["surge_value"], x["current_rank"]))
    surge_top10 = surge_rows[:10]

    lines = [
        f"# SensorTower 周报（{rank_date_current}）",
        "",
        f"**统计周期**：本周榜单日期 {rank_date_current}，对比上周 {rank_date_last}。",
        "",
        "---",
        "",
        "## 一、本周新进 Top50",
        "",
        "当周新进榜单且当前排名在 Top50 内的产品（按当前排名排序）：",
        "",
        "| 排名 | 产品名 | 开发者 | 国家/地区 | 平台 | 下载量 | 收入 |",
        "|------|--------|--------|-----------|------|--------|------|",
    ]
    for row in new_top50:
        lines.append(
            f"| {row['current_rank']} | {row['display_name']} | {row['publisher_name']} | {row['country']} | {row['platform']} | "
            f"{_fmt_num(row['downloads'])} | {_fmt_revenue(row['revenue'])} |"
        )
    if not new_top50:
        lines.append("| — | 本周无新进 Top50 记录 | — | — | — | — | — |")
    lines.extend([
        "",
        "---",
        "",
        "## 二、本周排名飙升 Top10",
        "",
        "当周排名飙升中，上升幅度最大的 10 款产品：",
        "",
        "| 当前排名 | 上周排名 | 上升幅度 | 产品名 | 开发者 | 国家/地区 | 平台 | 下载量 | 收入 |",
        "|----------|----------|----------|--------|--------|-----------|------|--------|------|",
    ])
    for row in surge_top10:
        lines.append(
            f"| {row['current_rank']} | {row['last_week_rank']} | {row['change']} | {row['display_name']} | {row['publisher_name']} | "
            f"{row['country']} | {row['platform']} | {_fmt_num(row['downloads'])} | {_fmt_revenue(row['revenue'])} |"
        )
    if not surge_top10:
        lines.append("| — | — | — | 本周无排名飙升记录 | — | — | — | — | — |")
    lines.append("")
    lines.append(f"详情请进入 [监测汇总平台]({DETAIL_LINK}) 查看。")
    return "\n".join(lines)


def build_sensortower_summary_md(conn: sqlite3.Connection) -> str | None:
    """构建给 IM 使用的「简报版」 SensorTower 周报（只保留数量 + 代表产品）。"""
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT DISTINCT rank_date_current, rank_date_last
            FROM rank_changes
            ORDER BY rank_date_current DESC
            LIMIT 1
            """
        )
        row = cur.fetchone()
        if not row:
            return None
        rank_date_current, rank_date_last = row[0], row[1] or ""
    except sqlite3.OperationalError as e:
        print(f"[SensorTower] 读取 rank_changes(摘要) 失败: {e}", file=sys.stderr)
        return None

    # 新进 Top50 列表（只为摘要拿名字）
    cur.execute(
        """
        SELECT
            COALESCE(m.name, r.app_name, r.app_id) AS display_name
        FROM rank_changes r
        LEFT JOIN app_metadata m ON m.app_id = r.app_id AND m.os = LOWER(r.platform)
        WHERE r.rank_date_current = ?
          AND r.change_type = '🆕 新进榜单'
          AND r.current_rank <= 50
        ORDER BY r.current_rank ASC, r.country, r.platform
        """,
        (rank_date_current,),
    )
    new_names_all = [str(r[0] or "").strip() for r in cur.fetchall() if (r[0] or "").strip()]

    # 排名飙升 Top10（名字 + change）
    cur.execute(
        """
        SELECT
            r.change,
            COALESCE(m.name, r.app_name, r.app_id) AS display_name
        FROM rank_changes r
        LEFT JOIN app_metadata m ON m.app_id = r.app_id AND m.os = LOWER(r.platform)
        WHERE r.rank_date_current = ?
          AND r.change_type = '🚀 排名飙升'
        ORDER BY r.current_rank ASC
        """,
        (rank_date_current,),
    )
    surge_rows = []
    for change_str, name in cur.fetchall():
        name_str = str(name or "").strip()
        surge_rows.append(
            {
                "change": str(change_str or "").strip(),
                "surge_value": _parse_surge(change_str or ""),
                "name": name_str or "—",
            }
        )
    surge_rows.sort(key=lambda x: -x["surge_value"])
    surge_top10 = surge_rows[:10]

    def join_names(names: list[str], limit: int) -> str:
        picked = [n for n in names[:limit] if n]
        return "、".join(picked)

    new_count = len(new_names_all)
    new_repr = join_names(new_names_all, 5)

    surge_count = len(surge_top10)
    surge_repr_names = [
        (item["name"], item["change"]) for item in surge_top10[:3]
    ]
    if surge_repr_names:
        surge_repr_str = "、".join(
            f"{name}（{change}）" for name, change in surge_repr_names
        )
    else:
        surge_repr_str = ""

    lines: list[str] = []
    lines.append(f"【SensorTower 周报】{rank_date_current}")
    if new_count:
        if new_repr:
            lines.append(f"- 新进 Top50：{new_count} 款，代表：{new_repr}")
        else:
            lines.append(f"- 新进 Top50：{new_count} 款")
    else:
        lines.append("- 新进 Top50：0 款")

    if surge_count:
        if surge_repr_str:
            lines.append(f"- 排名飙升 Top10：{surge_count} 款，TOP3：{surge_repr_str}")
        else:
            lines.append(f"- 排名飙升 Top10：{surge_count} 款")
    else:
        lines.append("- 排名飙升 Top10：0 款")

    return "\n".join(lines)


# ---------- 发送 ----------
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


def send_feishu_card(webhook: str, title: str, md_content: str) -> None:
    """飞书：发一条互动卡片，标题 + Markdown 正文。"""
    payload = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": title},
                "template": "blue",
            },
            "elements": [{"tag": "markdown", "content": md_content}],
        },
    }
    status, resp = _post_json(webhook, payload)
    if status != 200:
        print(f"[飞书] 发送失败 status={status} resp={resp}", file=sys.stderr)
    else:
        print("[飞书] 发送成功")


# 企业微信机器人 Markdown 单条消息上限 4096 字节（UTF-8），超限会报 40058
WECOM_MARKDOWN_MAX_BYTES = 4096


def _truncate_for_wecom(md: str, max_bytes: int = WECOM_MARKDOWN_MAX_BYTES) -> str:
    """将 Markdown 截断到不超过 max_bytes（UTF-8），末尾追加详见链接。"""
    data = md.encode("utf-8")
    if len(data) <= max_bytes:
        return md
    suffix = f"\n\n> 内容过长，详见 [监测汇总平台]({DETAIL_LINK}) 查看。"
    suffix_bytes = suffix.encode("utf-8")
    keep = max_bytes - len(suffix_bytes)
    if keep <= 0:
        return suffix.strip()
    # 按字节截断，避免截断 UTF-8 多字节字符中间
    chunk = data[:keep]
    while chunk and (chunk[-1] & 0x80) and not (chunk[-1] & 0x40):
        chunk = chunk[:-1]
    return chunk.decode("utf-8", errors="ignore") + suffix


def send_wecom_markdown(webhook: str, md_content: str) -> None:
    """企业微信：发一条 Markdown 消息（单条不超过 4096 字节）。"""
    content = _truncate_for_wecom(md_content)
    payload = {
        "msgtype": "markdown",
        "markdown": {"content": content},
    }
    status, resp = _post_json(webhook, payload)
    if status != 200:
        print(f"[企业微信] 发送失败 status={status} resp={resp}", file=sys.stderr)
    else:
        print("[企业微信] 发送成功")


def _clean_url(value: str | None) -> str | None:
    if not value:
        return None
    v = value.replace("\r", "").replace("\n", "").strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1].strip()
    return v if v else None


def main() -> int:
    parser = argparse.ArgumentParser(description="构建日报/周报并发送到飞书、企业微信")
    parser.add_argument(
        "--reports",
        type=str,
        default="hot_trend_daily,wechat_douyin_weekly,sensortower_weekly",
        help="要发送的报告类型，逗号分隔：hot_trend_daily,wechat_douyin_weekly,sensortower_weekly",
    )
    parser.add_argument(
        "--videos-db",
        type=Path,
        default=Path("public/videos.db"),
        help="videos.db 路径（微信/抖音周报）",
    )
    parser.add_argument(
        "--sensortower-db",
        type=Path,
        default=Path("public/sensortower_top100.db"),
        help="sensortower_top100.db 路径（SensorTower 周报）",
    )
    parser.add_argument(
        "--hot-trend-json",
        type=Path,
        default=Path("public/热点/final_json.json"),
        help="热点趋势日报 JSON 路径（来自热点/final_json.json）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只构建内容并打印，不发送",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    _load_env(repo_root)

    videos_db = repo_root / args.videos_db if not args.videos_db.is_absolute() else args.videos_db
    st_db = repo_root / args.sensortower_db if not args.sensortower_db.is_absolute() else args.sensortower_db
    hot_json = repo_root / args.hot_trend_json if not args.hot_trend_json.is_absolute() else args.hot_trend_json

    selected = {s.strip() for s in args.reports.split(",") if s.strip()}
    if not selected or "all" in selected:
        selected = {"hot_trend_daily", "wechat_douyin_weekly", "sensortower_weekly"}

    full_parts: list[str] = []      # 完整版内容（飞书用）
    summary_parts: list[str] = []   # 简报内容（飞书摘要 + 企业微信用）

    # 0) 热点趋势日报
    if "hot_trend_daily" in selected:
        md_full, md_summary = build_hot_trend_daily_md(hot_json)
        if md_full:
            full_parts.append(md_full)
        if md_summary:
            summary_parts.append(md_summary)
        if not md_full and not md_summary:
            print(f"[跳过] 热点趋势日报未生成：{hot_json}", file=sys.stderr)

    # 1) 微信/抖音小游戏周报
    if "wechat_douyin_weekly" in selected:
        if videos_db.exists():
            conn_wx = sqlite3.connect(str(videos_db))
            try:
                md_full = build_wechat_douyin_weekly_md(conn_wx)
                if md_full:
                    full_parts.append(md_full)
                md_summary = build_wechat_douyin_summary_md(conn_wx)
                if md_summary:
                    summary_parts.append(md_summary)
            finally:
                conn_wx.close()
        else:
            print(f"[跳过] videos.db 不存在: {videos_db}", file=sys.stderr)

    # 2) SensorTower 周报
    if "sensortower_weekly" in selected:
        if st_db.exists():
            conn_st = sqlite3.connect(str(st_db))
            try:
                md_full = build_sensortower_weekly_md(conn_st)
                if md_full:
                    full_parts.append(md_full)
                md_summary = build_sensortower_summary_md(conn_st)
                if md_summary:
                    summary_parts.append(md_summary)
            finally:
                conn_st.close()
        else:
            print(f"[跳过] sensortower_top100.db 不存在: {st_db}", file=sys.stderr)

    if not full_parts and not summary_parts:
        print("未生成任何日报/周报内容，请检查数据文件或参数。", file=sys.stderr)
        return 1

    # 飞书：摘要 + 完整内容合并为一条卡片
    combined_full = "\n\n---\n\n".join(full_parts) if full_parts else ""
    combined_summary = "\n\n".join(summary_parts) if summary_parts else ""
    if combined_summary and combined_full:
        feishu_md = f"{combined_summary}\n\n---\n\n{combined_full}"
    else:
        feishu_md = combined_full or combined_summary

    report_order = ["hot_trend_daily", "wechat_douyin_weekly", "sensortower_weekly"]
    title_map = {
        "hot_trend_daily": "热点趋势日报",
        "wechat_douyin_weekly": "微信/抖音小游戏周报",
        "sensortower_weekly": "SensorTower 周报",
    }
    selected_titles = [title_map.get(k, k) for k in report_order if k in selected]
    card_title = selected_titles[0] if len(selected_titles) == 1 else "监测汇总日报/周报"

    if args.dry_run:
        print("=== 构建结果（dry-run，不发送）===")
        print(f"标题: {card_title}")
        print("--- 摘要 ---")
        print(combined_summary or "(无摘要)")
        print("\n--- 完整内容 ---")
        print(combined_full or "(无完整内容)")
        return 0

    feishu = _clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
    wecom = _clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL")) or _clean_url(os.environ.get("WECOM_WEBHOOK_URL"))
    if not feishu and not wecom:
        print(
            "未配置 Webhook。请在 .env 中设置 FEISHU_WEBHOOK_URL 或 WECOM_WEBHOOK_URL_REAL（或 WECOM_WEBHOOK_URL）",
            file=sys.stderr,
        )
        return 1

    if feishu and feishu_md:
        send_feishu_card(feishu, card_title, feishu_md)
    if wecom:
        # 企业微信：优先发「简报版」，避免过长；若无摘要则发完整内容并自动截断
        wecom_md = combined_summary or combined_full
        if wecom_md:
            wecom_md = wecom_md + f"\n\n> 详情请访问：[监测汇总平台]({DETAIL_LINK})"
            send_wecom_markdown(wecom, wecom_md)

    return 0


if __name__ == "__main__":
    sys.exit(main())
