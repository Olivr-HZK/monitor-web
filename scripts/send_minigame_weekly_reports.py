#!/usr/bin/env python3
"""
构建日报/周报内容，并发送到飞书和企业微信：
  1. 热点趋势日报（来自 public/热点/：优先 final_json_from_csv_YYYYMMDD.json，否则 final_json_from_csv.json；摘要 + 本日热点列表）
  2. 微信/抖音小游戏排行榜（数据来自 public/wechatdouyin.db 的 top20_ranking、rank_changes 两表：微信 Top20、抖音 Top20、异动榜单）
  3. SensorTower 周报（来自 public/sensortower_top100.db 的 rank_changes）

飞书：发互动卡片（内容经 _adapt_md_for_feishu 适配）。
企业微信：发 Markdown 消息（单条 4096 字节上限，每条日报/周报单独发送）。

环境变量（.env 或系统环境）：
  - FEISHU_WEBHOOK_URL：飞书自定义机器人 Webhook
  - WECOM_WEBHOOK_URL_REAL 或 WECOM_WEBHOOK_URL：企业微信自定义机器人 Webhook
  - SENSORTOWER_OVERVIEW_BASE：SensorTower 概览页域名，默认 https://app.sensortower-china.com
  - SENSORTOWER_OVERVIEW_PROJECT_ID：可选，一般不填（站点会自动处理）

使用示例：
  python scripts/send_minigame_weekly_reports.py --content game
  python scripts/send_minigame_weekly_reports.py --content hot,ai
  python scripts/send_minigame_weekly_reports.py --content game,hot,ai --dry-run
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

DETAIL_LINK = "https://sites.google.com/castbox.fm/overwatch2/home?authuser=1"
SENSORTOWER_OVERVIEW_BASE = "https://app.sensortower-china.com"

# rank_changes.country 如 "🇺🇸 美国" -> SensorTower 国家代码
COUNTRY_TO_CODE: dict[str, str] = {
    "美国": "US",
    "日本": "JP",
    "英国": "GB",
    "德国": "DE",
    "印度": "IN",
    "中国": "CN",
    "法国": "FR",
    "韩国": "KR",
    "巴西": "BR",
    "加拿大": "CA",
    "澳大利亚": "AU",
    "俄罗斯": "RU",
    "墨西哥": "MX",
    "印尼": "ID",
    "土耳其": "TR",
    "意大利": "IT",
    "西班牙": "ES",
}


def _country_to_code(country: str) -> str:
    """从 rank_changes.country（如 🇺🇸 美国）解析出 SensorTower 国家代码。"""
    if not country:
        return "US"
    s = str(country).strip()
    for name, code in COUNTRY_TO_CODE.items():
        if name in s:
            return code
    return "US"


def _sensortower_overview_url(app_id: str, country: str, project_id: str | None = None) -> str:
    """拼 SensorTower 应用概览页 URL。project_id 可选（overview 路径中间那串 id）。"""
    if not app_id or not app_id.strip():
        return ""
    base = os.environ.get("SENSORTOWER_OVERVIEW_BASE", SENSORTOWER_OVERVIEW_BASE).rstrip("/")
    code = _country_to_code(country)
    if project_id and project_id.strip():
        return f"{base}/overview/{project_id.strip()}/{app_id.strip()}?country={code}"
    return f"{base}/overview/{app_id.strip()}?country={code}"


def _load_env(repo_root: Path) -> None:
    """从项目根目录加载 .env。"""
    env_path = repo_root / ".env"
    if env_path.exists() and load_dotenv is not None:
        load_dotenv(env_path)
    elif env_path.exists():
        # 无 python-dotenv 时简单解析
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


def _parse_content_option(content: str) -> set[str]:
    """解析 --content：
    - game：游戏检测（微信/抖音 + SensorTower）
    - game_st：仅 SensorTower 榜单周报
    - game_wd：仅 微信/抖音 榜单周报
    - hot：热点日报
    - ai：AI 日报
    """
    alias = {
        "游戏检测": "game",
        "热点日报": "hot",
        "ai日报": "ai",
        "sensortower": "game_st",
        "小游戏": "game_wd",
    }
    out = set()
    for part in content.replace("，", ",").split(","):
        key = (part or "").strip().lower()
        out.add(alias.get(key, key) if key else "game")
    return out if out else {"game"}


def _parse_iso_date(iso_str: str) -> str:
    """从 ISO 日期时间取 MM-DD。"""
    if not iso_str:
        return datetime.now().strftime("%m-%d")
    try:
        d = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return d.strftime("%m-%d")
    except (ValueError, TypeError):
        return datetime.now().strftime("%m-%d")


def _weekly_report_url(st_date: str) -> str:
    """当周 SensorTower 周报直链。"""
    if not st_date:
        return DETAIL_LINK
    return f"{DETAIL_LINK}?reportId=sensortower-weekly-{st_date}"


# ---------- 热点趋势日报（与网站 dailyReportLoader 一致：按 source 分组，### source + 编号列表）----------
HOT_SOURCE_DISPLAY: dict[str, str] = {
    "tiktok": "TikTok",
    "google_trends": "Google Trends",
    "xiaohongshu": "小红书",
    "weibo": "微博",
}


def _hot_source_label(key: str) -> str:
    k = (key or "").strip().lower()
    return HOT_SOURCE_DISPLAY.get(k) or (k.title() if k else "其他")


def build_hot_trend_daily_md(
    json_path: Path,
    top_count: int = 20,
    max_per_source: int | None = None,
) -> tuple[str | None, str | None]:
    """热点日报：摘要 + 本日热点（按 source 分组，### 来源名 + 编号+链接+摘要）。
    max_per_source：若指定（如 3），每个 source 最多展示几条，用于企业微信精简版。"""
    if not json_path.exists():
        return None, None
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"[热点趋势日报] JSON 解析失败: {e}", file=sys.stderr)
        return None, None

    generated_at = str(data.get("generated_at") or "")
    date_str = _parse_iso_date(generated_at)
    feishu_block = data.get("feishu", {}) or {}
    documents = feishu_block.get("documents", []) if isinstance(feishu_block, dict) else []
    if not documents:
        return None, None

    by_source: dict[str, list[tuple[str, str, str]]] = {}
    for doc in documents:
        if not isinstance(doc, dict):
            continue
        t = str(doc.get("title") or "").strip()
        if not t:
            continue
        url = ""
        source_key = "其他"
        meta = doc.get("meta")
        if isinstance(meta, dict):
            url = str(meta.get("url") or "").strip()
            source_key = str(meta.get("source") or "").strip() or "其他"
        source_key = source_key or str(doc.get("source") or "").strip() or "Google Trends"
        summary = str(doc.get("summary") or "").strip()
        by_source.setdefault(source_key, []).append((t, url, summary))

    if not by_source:
        return None, None

    order = ["tiktok", "google_trends", "xiaohongshu", "weibo"]
    source_order = [k for k in order if k in by_source]
    for k in sorted(by_source.keys()):
        if k not in source_order:
            source_order.append(k)

    if max_per_source is not None:
        by_source = {k: v[:max_per_source] for k, v in by_source.items()}

    total = sum(len(by_source[k]) for k in source_order)
    summary_text_raw = f"以下是本日 {total} 条热点，按来源分组展示，点击标题可查看对应卡片详情。"
    summary_text = summary_text_raw[:240] + "..." if len(summary_text_raw) > 240 else summary_text_raw
    topic_lines: list[str] = []
    max_summary_len = 160
    counter = 1
    for si, source_key in enumerate(source_order):
        if si > 0:
            topic_lines.append("")
        label = _hot_source_label(source_key)
        topic_lines.append(f"### {label}")
        for title, url, summary in by_source[source_key]:
            if url:
                topic_lines.append(f"{counter}. [{title}]({url})")
            else:
                topic_lines.append(f"{counter}. {title}")
            if summary:
                short = summary if len(summary) <= max_summary_len else summary[:max_summary_len] + "..."
                topic_lines.append(f"   摘要：{short}")
            counter += 1
    content = (
        f"## 摘要\n{summary_text}\n\n## 本日热点\n"
        + "\n".join(topic_lines)
        + "\n"
    )
    title = f"热点日报每日汇总 {date_str}"
    summary_md = f"# {title}\n\n{content}\n\n> 详情进入 [游戏监测网站]({DETAIL_LINK}) 查看（密码：guru666）。"
    return summary_md, summary_md


# ---------- AI 日报 ----------
def build_ai_daily_from_json(json_path: Path) -> tuple[str, str] | None:
    """从 JSON 生成 AI 日报总览（摘要 + 本日话题前 10 条，带原文链接）。"""
    if not json_path.exists():
        return None
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    feishu = data.get("feishu") or {}
    documents = feishu.get("documents", []) if isinstance(feishu, dict) else []
    if not documents:
        return None
    generated_at = str(data.get("generated_at") or "")
    date_full = generated_at[:10] if len(generated_at) >= 10 else ""
    short_date = f"{date_full[5:7]}-{date_full[8:10]}" if len(date_full) >= 10 else "01-01"

    items: list[tuple[str, str]] = []
    for doc in documents:
        if not isinstance(doc, dict):
            continue
        t = str(doc.get("title") or "").strip()
        if not t:
            continue
        url = ""
        meta = doc.get("meta")
        if isinstance(meta, dict):
            url = str(meta.get("url") or "").strip()
        items.append((t, url))
    if not items:
        return None

    tags_pool: list[str] = []
    for doc in documents:
        if isinstance(doc, dict) and isinstance(doc.get("tags"), list):
            tags_pool.extend(doc.get("tags", []))
    top_tags = [tag for tag, _ in Counter(tags_pool).most_common(4)]
    topic_hint = "、".join(top_tags) if top_tags else "AI 视频、大模型、多模态等方向"
    total = len(items)
    show_count = 10
    shown = items[:show_count]
    overview_summary = f"本日共 {total} 条话题，以下为前 {len(shown)} 条，涵盖 {topic_hint}。点击下方标题可跳转到对应报告详情。"
    topic_lines: list[str] = []
    for i, (title, url) in enumerate(shown):
        if url:
            topic_lines.append(f"{i + 1}. [{title}]({url})")
        else:
            topic_lines.append(f"{i + 1}. {title}")
    topic_list = "\n".join(topic_lines)
    if total > show_count:
        topic_list += "\n……"
    content = f"## 摘要\n{overview_summary}\n\n## 本日话题\n{topic_list}\n"
    title_str = f"AI热点日报（{date_full or short_date}）"
    body = f"# {title_str}\n\n{content}\n\n> 详情进入 [游戏监测网站]({DETAIL_LINK}) 查看（密码：guru666）。"
    return title_str, body


def build_ai_daily_md(report_path: Path) -> tuple[str, str] | None:
    """读取 AI 日报 Markdown 文件，返回 (标题, 正文)。"""
    if not report_path.exists():
        return None
    try:
        raw = report_path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not raw:
        return None
    lines = raw.splitlines()
    title = "AI 日报"
    for line in lines:
        t = line.strip()
        if t.startswith("#"):
            title = t.lstrip("#").strip() or title
            break
    return title, raw


# ---------- SensorTower 周报 ----------
def _parse_surge(change: str) -> int:
    if not change or change == "NEW":
        return 0
    m = re.search(r"↑\s*(\d+)", str(change).strip())
    return int(m.group(1)) if m else 0


def _parse_store_changes_json(changes_json: str) -> list[str]:
    if not (changes_json or changes_json.strip()):
        return []
    try:
        data = json.loads(changes_json)
    except json.JSONDecodeError:
        data = None
    fields: set[str] = set()
    if isinstance(data, dict):
        for field, val in data.items():
            if val is not None:
                fields.add(str(field))
    if not fields:
        for m in re.finditer(r'["\']?([A-Za-z0-9_]+)["\']?\s*:', changes_json):
            fields.add(m.group(1))
    return [f"{f} 有更新" for f in sorted(fields)[:5]]


def _store_change_brief(summaries: list[str]) -> str:
    """
    将商店页变化的字段列表压缩为简短中文说明，用于括号内展示，例如「截图、图标有更新」。
    summaries 形如 ["screenshot_urls 有更新", "icon_url 有更新", ...]
    """
    if not summaries:
        return ""
    label_map: dict[str, str] = {
        "screenshot": "截图",
        "screenshot_urls": "截图",
        "icon": "图标",
        "icon_url": "图标",
        "description": "文案",
        "full_description": "文案",
        "description_short": "文案",
        "short_description": "文案",
        "title": "标题",
        "app_name": "标题",
        "name": "标题",
        "price": "价格",
        "price_type": "价格",
        "rating": "评分",
        "rating_count": "评分",
        "languages": "语言",
        "video": "视频",
        "store_url": "链接",
        "url": "链接",
    }

    labels: list[str] = []
    for s in summaries:
        raw = (s or "").strip()
        if not raw:
            continue
        # 取空格前的字段名部分（如 "screenshot_urls 有更新" -> "screenshot_urls"）
        field = raw.split()[0]
        key = field.lower()
        # 跳过通用包装字段，如 new/old/https 等
        if key in {"new", "old"} or key.startswith("http"):
            continue
        mapped = None
        for k, v in label_map.items():
            if k in key:
                mapped = v
                break
        labels.append(mapped or field)

    # 去重并保留顺序，只取前 3 个
    seen: set[str] = set()
    uniq: list[str] = []
    for lbl in labels:
        if lbl and lbl not in seen:
            seen.add(lbl)
            uniq.append(lbl)
        if len(uniq) >= 3:
            break

    if not uniq:
        return ""
    # 组装成「截图、图标有更新」这类短语
    return "、".join(uniq) + "有更新"


def _chart_type_label(chart_type: str) -> str:
    """榜单类型转中文，与前端 formatChartTypeLabel 一致。"""
    s = (chart_type or "").strip().lower()
    if "free" in s:
        return "免费榜"
    if "grossing" in s:
        return "畅销榜"
    return chart_type or "—"


def _parse_weekly_metadata_changed_fields(changed_fields_raw: str) -> list[str]:
    """解析 weekly_metadata_changes.changed_fields（JSON 数组或逗号分隔），返回中文摘要列表，与前端一致。"""
    summaries: list[str] = []
    s = (changed_fields_raw or "").strip()
    if not s:
        return summaries
    # 支持 ["screenshot_urls","name"] 或 screenshot_urls,name
    if s.startswith("["):
        try:
            arr = json.loads(s)
            fields = [str(x).strip() for x in arr if x]
        except json.JSONDecodeError:
            fields = [f.strip() for f in re.split(r"[,;\s]+", s) if f.strip()]
    else:
        fields = [f.strip() for f in re.split(r"[,;\s]+", s) if f.strip()]
    for f in fields:
        key = f.lower()
        if "screenshot" in key:
            summaries.append("截图已更新")
        elif key in ("name", "app_name", "title"):
            summaries.append("名称已更新")
        elif "description" in key or "short_description" in key:
            summaries.append("描述已更新")
    # 去重并保留顺序
    seen: set[str] = set()
    out: list[str] = []
    for x in summaries:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _get_store_changes_from_weekly_metadata(
    conn: sqlite3.Connection,
    rank_date: str,
    limit: int = 5,
) -> list[dict]:
    """从 weekly_metadata_changes 取指定 rank_date 的商店页变化，最多 limit 条。与前端 loadSensorTowerStoreChanges 一致。"""
    if not rank_date or not rank_date.strip():
        return []
    result: list[dict] = []
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT rank_date, app_id, os, app_name, changed_fields, detected_at
            FROM weekly_metadata_changes
            WHERE rank_date = ?
            ORDER BY detected_at DESC, id DESC
            LIMIT ?
            """,
            (rank_date.strip(), limit),
        )
        rows = cur.fetchall()
    except sqlite3.OperationalError:
        return []
    for r in rows:
        app_id = str(r[1] or "").strip()
        os_val = str(r[2] or "").strip().lower()
        app_name = str(r[3] or "").strip() or app_id
        changed_fields = str(r[4] or "")
        info_table = "appstoreinfo" if os_val == "ios" else "gamestoreinfo"
        name_col = "app_name" if info_table == "appstoreinfo" else "title"
        store_url = ""
        try:
            cur.execute(
                f"SELECT {name_col}, store_url FROM {info_table} WHERE app_id = ? LIMIT 1",
                (app_id,),
            )
            row_info = cur.fetchone()
            if row_info:
                if (row_info[0] or "").strip():
                    app_name = str(row_info[0]).strip()
                store_url = str(row_info[1] or "").strip() if len(row_info) > 1 else ""
        except sqlite3.OperationalError:
            pass
        # 若 appstoreinfo/gamestoreinfo 无 store_url，用 app_metadata.url 兜底（与前端下线游戏一致）
        if not store_url:
            try:
                cur.execute(
                    "SELECT name, url FROM app_metadata WHERE app_id = ? AND LOWER(os) = ? LIMIT 1",
                    (app_id, os_val),
                )
                row_meta = cur.fetchone()
                if row_meta and len(row_meta) > 1 and (row_meta[1] or "").strip():
                    store_url = str(row_meta[1]).strip()
                    if (row_meta[0] or "").strip() and not app_name:
                        app_name = str(row_meta[0]).strip()
            except sqlite3.OperationalError:
                pass
        summaries = _parse_weekly_metadata_changed_fields(changed_fields)
        if not summaries:
            continue
        result.append({
            "name": app_name or app_id,
            "store_url": store_url,
            "summaries": summaries,
        })
    return result


def _get_store_changes(
    conn: sqlite3.Connection,
    table: str,
    limit: int = 10,
    rank_date_filter: str | None = None,
) -> tuple[str | None, list[dict]]:
    """从 appstoreinfo_changes / gamestoreinfo_changes 取一批变更，带 store_url。
    rank_date_filter：若指定则只取该 rank_date；否则取最新一批。"""
    cur = conn.cursor()
    try:
        if rank_date_filter:
            cur.execute(
                f"SELECT rank_date FROM {table} WHERE rank_date = ? LIMIT 1",
                (rank_date_filter,),
            )
            row = cur.fetchone()
            rank_date = rank_date_filter if row else None
        else:
            cur.execute(f"SELECT rank_date FROM {table} ORDER BY rank_date DESC LIMIT 1")
            row = cur.fetchone()
            rank_date = row[0] if row else None
        if not rank_date:
            return None, []
        cur.execute(
            f"""
            SELECT app_id, rank_date, changed_at, changes_json
            FROM {table}
            WHERE rank_date = ?
            ORDER BY changed_at DESC, id DESC
            LIMIT ?
            """,
            (rank_date, limit),
        )
        rows = cur.fetchall()
    except sqlite3.OperationalError:
        return None, []

    info_table = "appstoreinfo" if table.startswith("appstoreinfo") else "gamestoreinfo"
    name_col = "app_name" if info_table == "appstoreinfo" else "title"
    result: list[dict] = []
    for app_id, _rd, changed_at, changes_json in rows:
        name = str(app_id)
        developer = ""
        store_url_store = ""
        try:
            cur.execute(
                f"SELECT {name_col}, developer, store_url FROM {info_table} WHERE app_id = ? LIMIT 1",
                (app_id,),
            )
            s = cur.fetchone()
            if s:
                name, developer, store_url_store = s[0], s[1] or "", s[2] or ""
        except sqlite3.OperationalError:
            pass
        summaries = _parse_store_changes_json(changes_json or "")
        result.append({
            "name": name or app_id,
            "developer": developer,
            "store_url": store_url_store,
            "platform": "iOS" if table.startswith("appstoreinfo") else "Android",
            "rank_date": rank_date,
            "changed_at": changed_at or "",
            "summaries": summaries,
        })
    return rank_date, result


def _pick_wechatdouyin_week_for_report_date(
    conn: sqlite3.Connection,
    report_date_iso: str,
) -> str | None:
    """
    根据日报日期为微信/抖音榜单选择周区间：
    - 期望锁定到「日期参数的前一周」，即 end_date = report_date - 1 所在的 week_range。
    - week_range 形如 '2026-2-16~2026-2-22' 或 '2026-02-16～2026-02-22'。
    """
    try:
        target_date = datetime.strptime(report_date_iso, "%Y-%m-%d")
    except ValueError:
        return None
    target_end = target_date - timedelta(days=1)

    # 收集所有 week_range
    week_ranges: set[str] = set()
    for table in ("top20_ranking", "rank_changes"):
        try:
            cur = conn.execute(f"SELECT DISTINCT week_range FROM {table}")
            for (w,) in cur.fetchall():
                if w:
                    week_ranges.add(str(w).strip())
        except sqlite3.OperationalError:
            continue

    if not week_ranges:
        return None

    def parse_end_date(week_range: str) -> datetime | None:
        # "2026-2-16~2026-2-22" 或 "2026-2-16～2026-2-22"
        parts = re.split(r"[~～]", week_range)
        if len(parts) < 2:
            return None
        end_str = parts[1].strip()
        if not end_str:
            return None
        try:
            return datetime.strptime(end_str, "%Y-%m-%d")
        except ValueError:
            return None

    candidates: list[tuple[datetime, str]] = []
    for w in week_ranges:
        end_dt = parse_end_date(w)
        if end_dt is None:
            continue
        if end_dt.date() == target_end.date():
            candidates.append((end_dt, w))

    if not candidates:
        return None

    # 若有多个匹配，取 end_date 最大的那个
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


def _build_wechat_douyin_push(
    conn: sqlite3.Connection,
    target_week_range: str | None = None,
    max_top20: int = 5,
    max_changes: int = 5,
) -> tuple[str, str]:
    """从 wechatdouyin.db 的 top20_ranking、rank_changes 构建微信/抖音小游戏周报 Markdown。
    返回 (markdown, week_range)；无数据时返回 ('', '')。
    target_week_range：若指定则只生成该周；否则取最新一周（按 week_range 排序取最大）。"""
    lines: list[str] = []
    week_range = ""

    def get_latest_week() -> str | None:
        for table in ("top20_ranking", "rank_changes"):
            try:
                cur = conn.execute(
                    f"SELECT DISTINCT week_range FROM {table} ORDER BY week_range DESC LIMIT 1"
                )
                row = cur.fetchone()
                if row and row[0]:
                    return str(row[0]).strip()
            except sqlite3.OperationalError:
                continue
        return None

    if target_week_range and target_week_range.strip():
        week_range = target_week_range.strip()
    else:
        w = get_latest_week()
        if not w:
            return "", ""
        week_range = w

    lines.append(f"# 微信/抖音小游戏周报-{week_range}")
    lines.append("")

    # 一、微信小游戏 Top20（真实总数 + 前 max_top20 条示例，仅展示排名与名称）
    try:
        cur = conn.execute(
            "SELECT rank, game_name, company, rank_change FROM top20_ranking "
            "WHERE platform_key = 'wx' AND week_range = ? ORDER BY CAST(rank AS INTEGER) ASC",
            (week_range,),
        )
        rows = cur.fetchall()
        if rows:
            lines.append("## 一、微信小游戏 Top20")
            lines.append("")
            total = len(rows)
            lines.append(f"共 {total} 款，示例 {min(total, max_top20)} 款：")
            lines.append("")
            for r in rows[: max_top20]:
                rank = r[0] if r[0] is not None else "—"
                name = (r[1] or "—").strip()
                lines.append(f"- 排名 {rank}：{name}")
            if total > max_top20:
                lines.append("- ……")
            lines.append("")
    except sqlite3.OperationalError:
        pass

    # 二、抖音小游戏 Top20（真实总数 + 前 max_top20 条示例，仅展示排名与名称）
    try:
        cur = conn.execute(
            "SELECT rank, game_name, company, rank_change FROM top20_ranking "
            "WHERE platform_key = 'dy' AND week_range = ? ORDER BY CAST(rank AS INTEGER) ASC",
            (week_range,),
        )
        rows = cur.fetchall()
        if rows:
            lines.append("## 二、抖音小游戏 Top20")
            lines.append("")
            total = len(rows)
            lines.append(f"共 {total} 款，示例 {min(total, max_top20)} 款：")
            lines.append("")
            for r in rows[: max_top20]:
                rank = r[0] if r[0] is not None else "—"
                name = (r[1] or "—").strip()
                lines.append(f"- 排名 {rank}：{name}")
            if total > max_top20:
                lines.append("- ……")
            lines.append("")
    except sqlite3.OperationalError:
        pass

    # 三、榜单异动（真实总数 + 前 max_changes 条示例）
    try:
        cur = conn.execute(
            "SELECT rank, game_name, company, rank_change, platform_key FROM rank_changes "
            "WHERE week_range = ? ORDER BY platform_key, CAST(rank AS INTEGER) ASC",
            (week_range,),
        )
        rows = cur.fetchall()
        if rows:
            lines.append("## 三、榜单异动")
            lines.append("")
            platform_label = {"wx": "微信小游戏", "dy": "抖音小游戏"}
            total = len(rows)
            lines.append(f"共 {total} 条记录，示例 {min(total, max_changes)} 条：")
            lines.append("")
            for r in rows[:max_changes]:
                rank = r[0] if r[0] is not None else "—"
                name = (r[1] or "—").strip()
                company = (r[2] or "—").strip()
                change = (r[3] or "—").strip()
                pk = (r[4] or "").strip().lower() if len(r) > 4 else ""
                plat = platform_label.get(pk, pk or "—")
                lines.append(f"- 排名 {rank}：{name}（{plat}，{company}，变化 {change}）")
            if total > max_changes:
                lines.append("- ……")
            lines.append("")
    except sqlite3.OperationalError:
        pass

    if len(lines) <= 2:
        return "", ""

    lines.append("---")
    lines.append("")
    lines.append(f"> 👉 查看当周完整周报：[游戏监测网站]({DETAIL_LINK})（密码：guru666）")
    return "\n".join(lines), week_range


def build_minigame_weekly_report_doc(
    week_range: str,
    content_md: str,
    *,
    title_prefix: str = "微信/抖音小游戏周报",
) -> dict:
    """
    构造「小游戏周报」的 ReportDocument 结构，供前端 WeeklyReportDetail 直接使用。
    注意：这里只返回 dict，写入 JSON 的位置由调用方决定。
    """
    now = datetime.now()
    title = f"{title_prefix}-{week_range}"
    summary = f"{title_prefix}（{week_range}）周榜概览。"
    return {
        "title": title,
        "tags": [title_prefix, "小游戏周报", "微信", "抖音"],
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M"),
        "source": "微信/抖音小游戏榜单",
        "summary": summary,
        "content": content_md,
        "meta": {
            "kind": "minigame_weekly",
            "week_range": week_range,
        },
    }


def _build_sensortower_only_push(
    st_conn: sqlite3.Connection,
    max_items_per_section: int = 5,
    target_rank_date: str | None = None,
) -> tuple[str, str]:
    """仅 SensorTower：总标题 + 一、新进 Top50；二、排名飙升 Top10；三、商店页更新。游戏名用 rank_changes.store_url 做链接。
    target_rank_date：若指定（如 2026-02-02），只生成该 rank_date_current 的周报；否则取最新一周。"""
    lines: list[str] = []
    st_date = ""
    rank_date_last = ""

    try:
        cur = st_conn.cursor()
        if target_rank_date:
            cur.execute(
                "SELECT DISTINCT rank_date_current, rank_date_last FROM rank_changes WHERE rank_date_current = ? LIMIT 1",
                (target_rank_date.strip(),),
            )
        else:
            cur.execute(
                "SELECT DISTINCT rank_date_current, rank_date_last FROM rank_changes ORDER BY rank_date_current DESC LIMIT 1"
            )
        row = cur.fetchone()
        if row:
            st_date = str(row[0])
            rank_date_last = str(row[1] or "")
    except sqlite3.OperationalError:
        rank_date_last = ""

    if not st_date:
        return "", ""

    st_project_id = os.environ.get("SENSORTOWER_OVERVIEW_PROJECT_ID", "").strip() or None

    lines.append(f"# SensorTower 周报-{st_date or '日期'}")
    lines.append("")

    # 一、新进 Top50（按 app_id 合并，store_url 来自 rank_changes）
    try:
        cur = st_conn.cursor()
        rank_date_current = st_date
        cur.execute(
            """
            SELECT r.app_id, COALESCE(m.name, r.app_name, r.app_id) AS display_name, r.store_url, r.country, r.current_rank
            FROM rank_changes r
            LEFT JOIN app_metadata m ON m.app_id = r.app_id AND m.os = LOWER(r.platform)
            WHERE r.rank_date_current = ? AND r.change_type = '🆕 新进榜单' AND r.current_rank <= 50
            ORDER BY r.current_rank ASC, r.country, r.platform
            """,
            (rank_date_current,),
        )
        seen_order: list[str] = []
        by_app: dict[str, dict] = {}
        for r in cur.fetchall():
            app_id = str(r[0] or "").strip()
            name = str(r[1] or "").strip() or app_id
            url_from_rank = str(r[2] or "").strip() if len(r) > 2 else ""
            country = str(r[3] or "").strip() if len(r) > 3 else ""
            current_rank = r[4] if len(r) > 4 and r[4] is not None else None
            try:
                rank_int = int(current_rank) if current_rank is not None else None
            except (TypeError, ValueError):
                rank_int = None
            if not app_id:
                continue
            if app_id not in by_app:
                by_app[app_id] = {"name": name, "count": 0, "store_url": url_from_rank, "country": country, "current_rank": rank_int}
                seen_order.append(app_id)
            else:
                if url_from_rank and not by_app[app_id].get("store_url"):
                    by_app[app_id]["store_url"] = url_from_rank
                if country and not by_app[app_id].get("country"):
                    by_app[app_id]["country"] = country
                if rank_int is not None and (by_app[app_id].get("current_rank") is None or rank_int < by_app[app_id]["current_rank"]):
                    by_app[app_id]["current_rank"] = rank_int
            by_app[app_id]["count"] += 1
        new_entries = [by_app[aid] for aid in seen_order]
        new_count = len(new_entries)
        lines.append("## 一、SensorTower 本周新进 Top50")
        lines.append("")
        lines.append(f"**统计周期**：本周榜单日期 {rank_date_current}，对比上周 {rank_date_last}。")
        lines.append("")
        lines.append(f"共 {new_count} 款（已合并同款多地区），例（* 表示该游戏在多个地区上榜，展示的是各地区中最佳名次）：")
        for idx, entry in enumerate(new_entries[:max_items_per_section]):
            app_id = seen_order[idx]
            display = entry["name"]
            region_count = entry["count"]
            store_url = entry.get("store_url") or ""
            text = display
            rank_val = entry.get("current_rank")
            if rank_val is not None:
                rank_label = f"{rank_val}{'*' if region_count > 1 else ''}"
                rank_str = f"本周排名 {rank_label} | "
            else:
                rank_str = ""
            st_url = _sensortower_overview_url(app_id, entry.get("country", ""), st_project_id)
            if store_url:
                lines.append(f"- {rank_str}[{text}]({store_url})" + (f" [📊 SensorTower]({st_url})" if st_url else ""))
            else:
                lines.append(f"- {rank_str}{text}" + (f" [📊 SensorTower]({st_url})" if st_url else ""))
        if new_count > max_items_per_section:
            lines.append("- ……")
        lines.append("")
    except sqlite3.OperationalError:
        pass

    # 二、排名飙升 Top10（store_url 来自 rank_changes）
    if st_date:
        try:
            cur = st_conn.cursor()
            cur.execute(
                """
                SELECT r.app_id, r.change, COALESCE(m.name, r.app_name, r.app_id) AS display_name, r.store_url, r.country, r.current_rank
                FROM rank_changes r
                LEFT JOIN app_metadata m ON m.app_id = r.app_id AND m.os = LOWER(r.platform)
                WHERE r.rank_date_current = ? AND r.change_type = '🚀 排名飙升'
                ORDER BY r.current_rank ASC
                """,
                (st_date,),
            )
            rows_st = list(cur.fetchall())
            surge_by_app: dict[str, dict] = {}
            for r in rows_st:
                app_id = str(r[0] or "").strip()
                change_str = str(r[1] or "").strip()
                name = str(r[2] or "").strip() or app_id
                url_from_rank = str(r[3] or "").strip() if len(r) > 3 else ""
                country = str(r[4] or "").strip() if len(r) > 4 else ""
                current_rank = r[5] if len(r) > 5 and r[5] is not None else None
                try:
                    rank_int = int(current_rank) if current_rank is not None else None
                except (TypeError, ValueError):
                    rank_int = None
                surge = _parse_surge(change_str)
                if not app_id:
                    continue
                info = surge_by_app.get(app_id)
                if info is None:
                    surge_by_app[app_id] = {
                        "app_id": app_id,
                        "name": name,
                        "change": change_str,
                        "surge": surge,
                        "store_url": url_from_rank,
                        "country": country,
                        "current_rank": rank_int,
                        "region_count": 1,
                    }
                else:
                    info["region_count"] = info.get("region_count", 1) + 1
                    if surge > info["surge"]:
                        info["name"] = name
                        info["change"] = change_str
                        info["surge"] = surge
                        info["store_url"] = url_from_rank
                        info["country"] = country
                        info["current_rank"] = rank_int
            surge_list = sorted(surge_by_app.values(), key=lambda x: -x["surge"])[:10]
            lines.append("## 二、SensorTower 本周排名飙升 Top10")
            lines.append("")
            lines.append(f"共 {len(surge_list)} 款（已合并同款多地区），例（* 表示该游戏在多个地区上榜，展示的是各地区中最佳名次）：")
            for x in surge_list[:max_items_per_section]:
                name = x["name"]
                change_str = x["change"]
                store_url = x.get("store_url") or ""
                rank_val = x.get("current_rank")
                region_count = x.get("region_count", 1)
                if rank_val is not None:
                    rank_label = f"{rank_val}{'*' if region_count > 1 else ''}"
                    rank_str = f"本周排名 {rank_label} | "
                else:
                    rank_str = ""
                st_url = _sensortower_overview_url(x.get("app_id", ""), x.get("country", ""), st_project_id)
                text = f"{name}（{change_str}）"
                if store_url:
                    lines.append(f"- {rank_str}[{text}]({store_url})" + (f" [📊 SensorTower]({st_url})" if st_url else ""))
                else:
                    lines.append(f"- {rank_str}{text}" + (f" [📊 SensorTower]({st_url})" if st_url else ""))
            if len(surge_list) > max_items_per_section:
                lines.append("- ……")
            lines.append("")
        except sqlite3.OperationalError:
            pass

    # 异动简述（直接来自 weekly_top5_overview.statement）
    try:
        cur = st_conn.cursor()
        cur.execute(
            "SELECT statement FROM weekly_top5_overview WHERE rank_date = ? LIMIT 1",
            (st_date,),
        )
        row = cur.fetchone()
        _stmt = str(row[0] or "").strip() if row and len(row) > 0 else ""
        if _stmt:
            lines.append("## 异动简述")
            lines.append("")
            lines.append(_stmt)
            lines.append("")
    except sqlite3.OperationalError:
        pass

    # 三、商店页的更新（从 weekly_metadata_changes 读取当周 rank_date，取 5 条）
    lines.append("## 三、商店页的更新")
    lines.append("")
    store_items = _get_store_changes_from_weekly_metadata(st_conn, st_date, limit=5)
    if store_items:
        for item in store_items:
            name = item.get("name") or "—"
            store_url = item.get("store_url") or ""
            brief = "、".join(item.get("summaries") or [])
            if store_url:
                line = f"- [{name}]({store_url})"
            else:
                line = f"- {name}"
            if brief:
                line += f"（{brief}）"
            lines.append(line)
    else:
        lines.append("本周期暂无商店页变化。")
    lines.append("")

    # 四、上周榜单中疑似下线的产品（与前端 sensortowerWeeklyReport 一致：用 rank_date_last）
    lines.append("## 四、上周榜单中疑似下线的产品")
    lines.append("")
    removed_items: list[dict] = []
    if rank_date_last:
        try:
            cur = st_conn.cursor()
            cur.execute(
                """
                SELECT rank_date, os, country, chart_type, app_id, app_name, store_url, reason
                FROM weekly_removed_games
                WHERE removed = 1 AND rank_date = ?
                ORDER BY os, country, chart_type, app_name
                """,
                (rank_date_last,),
            )
            for r in cur.fetchall():
                removed_items.append({
                    "rank_date": str(r[0] or ""),
                    "platform": "Android" if str(r[1] or "").lower() == "android" else "iOS",
                    "country": str(r[2] or ""),
                    "chart_type": str(r[3] or ""),
                    "app_id": str(r[4] or ""),
                    "app_name": str(r[5] or "").strip() or str(r[4] or ""),
                    "store_url": str(r[6] or "").strip() or "",
                    "reason": str(r[7] or "").strip() or "",
                })
        except sqlite3.OperationalError:
            pass
    if removed_items:
        for item in removed_items[:max_items_per_section]:
            name = item.get("app_name") or item.get("app_id") or "—"
            store_url = item.get("store_url") or ""
            country = item.get("country") or "—"
            chart_label = _chart_type_label(item.get("chart_type") or "")
            platform = item.get("platform") or "—"
            reason = item.get("reason") or "—"
            if store_url:
                line = f"- [{name}]({store_url})（{country} | {chart_label} | {platform}"
            else:
                line = f"- {name}（{country} | {chart_label} | {platform}"
            if reason:
                line += f"；{reason}"
            line += "）"
            lines.append(line)
        if len(removed_items) > max_items_per_section:
            lines.append(f"- …… 共 {len(removed_items)} 款，详见平台")
    else:
        lines.append("上周无疑似下线产品。")
    lines.append("")

    lines.append("---")
    lines.append("")
    weekly_url = _weekly_report_url(st_date)
    lines.append(f"> 👉 查看当周完整周报：[游戏监测网站]({weekly_url})（密码：guru666）")
    return "\n".join(lines), st_date


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


def _adapt_md_for_feishu(md: str) -> str:
    """将 Markdown 适配为飞书卡片：标题转加粗、去掉引用前缀、分隔线改横线。"""
    out_lines: list[str] = []
    for line in md.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("#"):
            content = stripped.lstrip("#").strip()
            if content:
                out_lines.append(f"**{content}**")
            continue
        if stripped.startswith(">"):
            content = stripped.lstrip(">").strip()
            if content:
                out_lines.append(content)
            continue
        if stripped.strip() == "---":
            out_lines.append("------")
            continue
        out_lines.append(line)
    return "\n".join(out_lines)


def send_feishu_card(webhook: str, title: str, md_content: str) -> None:
    """飞书：发一条互动卡片（内容经飞书格式适配）。"""
    feishu_md = _adapt_md_for_feishu(md_content)
    payload = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": title},
                "template": "blue",
            },
            "elements": [{"tag": "markdown", "content": feishu_md}],
        },
    }
    status, resp = _post_json(webhook, payload)
    if status != 200:
        print(f"[飞书] 发送失败 status={status} resp={resp}", file=sys.stderr)
    else:
        print("[飞书] 发送成功")


WECOM_MARKDOWN_MAX_BYTES = 4096


def _truncate_for_wecom(md: str, max_bytes: int = WECOM_MARKDOWN_MAX_BYTES) -> str:
    data = md.encode("utf-8")
    if len(data) <= max_bytes:
        return md
    suffix = f"\n\n> 内容过长，详见 [游戏监测网站]({DETAIL_LINK}) 查看（密码：guru666）。"
    suffix_bytes = suffix.encode("utf-8")
    keep = max_bytes - len(suffix_bytes)
    if keep <= 0:
        return suffix.strip()
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


def _split_sensortower_for_wecom(md: str) -> list[str]:
    """SensorTower 周报拆成多条发企业微信（单条 4096 字节上限）：一+二、三、四 各成一段，避免截断把商店页变化或下线游戏的链接截掉。每段末尾带链接。"""
    sep3 = "## 三、商店页的更新"
    sep4 = "## 四、上周榜单中疑似下线的产品"
    if sep3 not in md:
        return [md]
    before, after3 = md.split(sep3, 1)
    part1 = before.rstrip()
    footer = f"\n\n---\n\n> 👉 查看当周完整周报：[游戏监测网站]({DETAIL_LINK})（密码：guru666）"
    part1 = part1 + footer
    out = []
    for block in (part1,):
        block_utf8 = block.encode("utf-8")
        if len(block_utf8) <= WECOM_MARKDOWN_MAX_BYTES:
            out.append(block)
        else:
            out.append(_truncate_for_wecom(block))
    # 三、商店页的更新：单独一条，避免和「四」合在一起超长被截断导致最后几条没链接
    block3 = sep3 + after3
    if sep4 in block3:
        part3_content, part4_content = block3.split(sep4, 1)
        part3_content = part3_content.rstrip() + footer
        part4_content = sep4 + part4_content  # 已含文末 --- 与链接
        for block in (part3_content, part4_content):
            block_utf8 = block.encode("utf-8")
            if len(block_utf8) <= WECOM_MARKDOWN_MAX_BYTES:
                out.append(block)
            else:
                out.append(_truncate_for_wecom(block))
    else:
        block_utf8 = block3.encode("utf-8")
        if len(block_utf8) <= WECOM_MARKDOWN_MAX_BYTES:
            out.append(block3)
        else:
            out.append(_truncate_for_wecom(block3))
    return out


def _clean_url(value: str | None) -> str | None:
    if not value:
        return None
    v = value.replace("\r", "").replace("\n", "").strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1].strip()
    return v if v else None


def main() -> int:
    parser = argparse.ArgumentParser(description="构建日报/周报并发送到飞书、企业微信（每条单独发送）")
    parser.add_argument(
        "--content",
        type=str,
        default="game",
        help="逗号分隔：game/游戏检测、hot/热点日报、ai/ai日报。默认 game",
    )
    parser.add_argument(
        "--ai-report",
        type=Path,
        default=Path("public/ai热点/日报.md"),
        help="AI 日报 MD 路径（ai 回退用）",
    )
    parser.add_argument(
        "--wechatdouyin-db",
        type=Path,
        default=Path("public/wechatdouyin.db"),
        help="wechatdouyin.db 路径（微信/抖音三榜单：top20_ranking + rank_changes，可选）",
    )
    parser.add_argument(
        "--sensortower-db",
        type=Path,
        default=Path("public/sensortower_top100.db"),
        help="sensortower_top100.db 路径",
    )
    parser.add_argument(
        "--hot-trend-json",
        type=Path,
        default=Path("public/热点"),
        help="热点数据：目录（自动选 final_json_from_csv_YYYYMMDD.json 或 final_json_from_csv.json）或单文件",
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        metavar="YYYY-MM-DD",
        help="指定日报日期，用于加载该日热点/AI 的 JSON（如 2026-02-10）。不传则使用当天日期",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只构建并打印，不发送",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    _load_env(repo_root)

    # 解析日报日期（--date 或当天）
    if args.date:
        try:
            dt = datetime.strptime(args.date.strip(), "%Y-%m-%d")
            report_date_iso = dt.strftime("%Y-%m-%d")
            report_date_compact = dt.strftime("%Y%m%d")
        except ValueError:
            print(f"[错误] --date 格式应为 YYYY-MM-DD，例如 2026-02-10，当前为：{args.date!r}", file=sys.stderr)
            return 1
    else:
        report_date_iso = datetime.now().strftime("%Y-%m-%d")
        report_date_compact = datetime.now().strftime("%Y%m%d")

    wechatdouyin_db = repo_root / args.wechatdouyin_db if not args.wechatdouyin_db.is_absolute() else args.wechatdouyin_db
    st_db = repo_root / args.sensortower_db if not args.sensortower_db.is_absolute() else args.sensortower_db
    hot_trend_path = repo_root / args.hot_trend_json if not args.hot_trend_json.is_absolute() else args.hot_trend_json
    # 仅当存在该日期的文件时才发送，不落回其他日期或通用文件
    if hot_trend_path.is_dir():
        date_iso = hot_trend_path / f"{report_date_iso}.json"
        date_named = hot_trend_path / f"final_json_from_csv_{report_date_compact}.json"
        if date_iso.exists():
            hot_json = date_iso
        elif date_named.exists():
            hot_json = date_named
        else:
            hot_json = date_iso  # 该日期无文件，后续会跳过发送
    else:
        hot_json = hot_trend_path
    ai_report_path = repo_root / args.ai_report if not args.ai_report.is_absolute() else args.ai_report

    content_set = _parse_content_option(args.content)
    if not content_set:
        content_set = {"game"}

    # (title, body_feishu, body_wecom)；body_wecom 为 None 时与 body_feishu 相同
    messages: list[tuple[str, str, str | None]] = []

    # 微信/抖音小游戏周报（wechatdouyin.db：top20_ranking + rank_changes）
    if ("game" in content_set or "game_wd" in content_set) and wechatdouyin_db.exists():
        try:
            conn_wd = sqlite3.connect(str(wechatdouyin_db))
            try:
                # 若指定 --date，则根据日期锁定到「前一周」的 week_range；否则用最新一周
                target_week = None
                if args.date:
                    target_week = _pick_wechatdouyin_week_for_report_date(conn_wd, report_date_iso)
                wd_md, wd_week = _build_wechat_douyin_push(conn_wd, target_week_range=target_week)
                if wd_md and wd_week:
                    # 1）推送用 Markdown
                    messages.append((f"微信/抖音小游戏周报-{wd_week}", wd_md, None))

                    # 2）写一份给前端用的 ReportDocument JSON（kind = minigame_weekly）
                    try:
                        weekly_doc = build_minigame_weekly_report_doc(wd_week, wd_md)
                        reports_dir = repo_root / "public" / "ai热点"
                        reports_dir.mkdir(parents=True, exist_ok=True)
                        # 文件名中避免中文和波浪线，统一成 minigame_weekly_YYYYMMDD_YYYYMMDD.json 之类
                        safe_week = (
                            wd_week.replace("～", "~")
                            .replace(" ", "")
                            .replace("年", "-")
                            .replace("月", "-")
                            .replace("日", "")
                        )
                        safe_week = safe_week.replace("~", "_").replace("/", "_")
                        json_path = reports_dir / f"minigame_weekly_{safe_week}.json"
                        json_path.write_text(json.dumps(weekly_doc, ensure_ascii=False, indent=2), encoding="utf-8")
                    except Exception as e:  # noqa: BLE001
                        print(f"[警告] 写入小游戏周报 JSON 失败：{e}", file=sys.stderr)
                elif ("game" in content_set or "game_wd" in content_set) and not wd_md:
                    print("[跳过] 微信/抖音小游戏：wechatdouyin.db 中无 top20_ranking/rank_changes 数据或无匹配周", file=sys.stderr)
            finally:
                conn_wd.close()
        except Exception as e:
            print(f"[跳过] 微信/抖音小游戏：读取 wechatdouyin.db 失败：{e}", file=sys.stderr)

    if ("game" in content_set or "game_st" in content_set) and st_db.exists():
        conn_st = sqlite3.connect(str(st_db))
        try:
            target_rank_date = report_date_iso if args.date else None
            md, st_date = _build_sensortower_only_push(
                conn_st, max_items_per_section=5, target_rank_date=target_rank_date
            )
            if md and st_date:
                messages.append((f"SensorTower 周报-{st_date or '最新'}", md, None))
            elif args.date and not st_date:
                print(f"[跳过] 游戏检测：未找到 {report_date_iso} 对应周报数据（rank_changes 中无该 rank_date_current）", file=sys.stderr)
        finally:
            conn_st.close()
    elif "game" in content_set or "game_st" in content_set:
        print(f"[跳过] 游戏检测：sensortower_top100.db 不存在 {st_db}", file=sys.stderr)

    if "hot" in content_set:
        if hot_trend_path.is_dir() and not hot_json.exists():
            print(f"[跳过] 热点日报：未找到 {report_date_iso} 对应文件（{hot_json}）", file=sys.stderr)
        else:
            hot_full, hot_feishu_md = build_hot_trend_daily_md(hot_json, top_count=20, max_per_source=None)
            _, hot_wecom_md = build_hot_trend_daily_md(hot_json, top_count=20, max_per_source=3)
            if hot_feishu_md:
                hot_title = (
                    hot_feishu_md.split("\n")[0].lstrip("#").strip()
                    if hot_feishu_md and hot_feishu_md.split("\n")[0].lstrip("#").strip()
                    else "热点日报每日汇总"
                )
                messages.append((hot_title, hot_feishu_md, hot_wecom_md))
            else:
                print(f"[跳过] 热点日报：未生成内容（{hot_json}）", file=sys.stderr)

    if "ai" in content_set:
        ai_date_json = repo_root / "public/ai热点" / f"{report_date_iso}.json"
        if not ai_date_json.exists():
            print(f"[跳过] AI 日报：未找到 {report_date_iso} 对应文件（{ai_date_json}）", file=sys.stderr)
        else:
            ai_title, ai_md = None, None
            ai_result = build_ai_daily_from_json(ai_date_json)
            if ai_result:
                ai_title, ai_md = ai_result
            if ai_md:
                messages.append((ai_title or "AI 日报", ai_md, None))
            else:
                print(f"[跳过] AI 日报：{ai_date_json} 内容为空或解析失败", file=sys.stderr)

    if not messages:
        print("未生成任何内容，请检查 --content 及对应数据文件。", file=sys.stderr)
        return 1

    if args.dry_run:
        print("=== 构建结果（dry-run，不发送）===")
        for idx, (title, body_f, body_w) in enumerate(messages, start=1):
            print(f"[{idx}] 标题: {title}")
            print("--- 飞书推送内容 ---")
            print(body_f)
            if body_w is not None:
                print("--- 企业微信推送内容（每 source 3 条）---")
                print(body_w)
            else:
                print("--- 企业微信同飞书 ---")
            print("\n" + "=" * 40 + "\n")
        return 0

    feishu = _clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
    wecom = _clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL")) or _clean_url(os.environ.get("WECOM_WEBHOOK_URL"))
    if not feishu and not wecom:
        print("未配置 Webhook。请在 .env 中设置 FEISHU_WEBHOOK_URL 或 WECOM_WEBHOOK_URL_REAL（或 WECOM_WEBHOOK_URL）", file=sys.stderr)
        return 1

    for title, body_feishu, body_wecom in messages:
        body_w = body_wecom if body_wecom is not None else body_feishu
        if feishu:
            send_feishu_card(feishu, title, body_feishu)
        if wecom:
            if title.startswith("SensorTower 周报"):
                for part in _split_sensortower_for_wecom(body_w):
                    send_wecom_markdown(wecom, part)
            else:
                send_wecom_markdown(wecom, body_w)

    return 0


if __name__ == "__main__":
    sys.exit(main())
