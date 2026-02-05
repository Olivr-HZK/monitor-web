#!/usr/bin/env python3
"""
按前端「休闲游戏检测」中两个小游戏周报的格式构建内容，并发送到飞书和企业微信：
  1. 微信/抖音小游戏周报（来自 public/videos.db 的 weekly_report_simple）
  2. SensorTower 周报（来自 public/sensortower_top100.db 的 rank_changes）

飞书：发一条互动卡片（interactive card，内容为 Markdown）。
企业微信：发一条 Markdown 消息。

环境变量（.env 或系统环境）：
  - FEISHU_WEBHOOK_URL：飞书自定义机器人 Webhook
  - WECOM_WEBHOOK_URL_REAL：企业微信自定义机器人 Webhook

使用方式（在项目根目录）：
  python scripts/send_minigame_weekly_reports.py
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


# ---------- 微信/抖音小游戏周报（与前端 reportsLoader.loadWeeklyBriefFromDb 一致）----------
def build_wechat_douyin_weekly_md(conn: sqlite3.Connection) -> str | None:
    """从 weekly_report_simple 取最新一周，生成与前端一致的周报 Markdown。"""
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
    """从 rank_changes 取最新一周，生成与前端一致的 SensorTower 周报 Markdown。"""
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
    parser = argparse.ArgumentParser(description="构建两个小游戏周报并发送到飞书、企业微信")
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
        "--dry-run",
        action="store_true",
        help="只构建内容并打印，不发送",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    _load_env(repo_root)

    videos_db = repo_root / args.videos_db if not args.videos_db.is_absolute() else args.videos_db
    st_db = repo_root / args.sensortower_db if not args.sensortower_db.is_absolute() else args.sensortower_db

    parts: list[str] = []

    # 1) 微信/抖音小游戏周报
    if videos_db.exists():
        conn_wx = sqlite3.connect(str(videos_db))
        try:
            md_wx = build_wechat_douyin_weekly_md(conn_wx)
            if md_wx:
                parts.append(md_wx)
        finally:
            conn_wx.close()
    else:
        print(f"[跳过] videos.db 不存在: {videos_db}", file=sys.stderr)

    # 2) SensorTower 周报
    if st_db.exists():
        conn_st = sqlite3.connect(str(st_db))
        try:
            md_st = build_sensortower_weekly_md(conn_st)
            if md_st:
                parts.append(md_st)
        finally:
            conn_st.close()
    else:
        print(f"[跳过] sensortower_top100.db 不存在: {st_db}", file=sys.stderr)

    if not parts:
        print("未生成任何周报内容，请检查数据库与表结构。", file=sys.stderr)
        return 1

    # 合并为一条：两个周报用分隔线隔开
    combined_md = "\n\n---\n\n".join(parts)
    card_title = "小游戏周报（微信/抖音 + SensorTower）"

    if args.dry_run:
        print("=== 构建结果（dry-run，不发送）===")
        print(f"标题: {card_title}")
        print("---")
        print(combined_md)
        return 0

    feishu = _clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
    wecom = _clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL")) or _clean_url(os.environ.get("WECOM_WEBHOOK_URL"))
    if not feishu and not wecom:
        print(
            "未配置 Webhook。请在 .env 中设置 FEISHU_WEBHOOK_URL 或 WECOM_WEBHOOK_URL_REAL（或 WECOM_WEBHOOK_URL）",
            file=sys.stderr,
        )
        return 1

    if feishu:
        send_feishu_card(feishu, card_title, combined_md)
    if wecom:
        # 企业微信单条 Markdown 限制 4096 字节，分两条发送：微信/抖音 + SensorTower
        for i, part in enumerate(parts):
            send_wecom_markdown(wecom, part)

    return 0


if __name__ == "__main__":
    sys.exit(main())
