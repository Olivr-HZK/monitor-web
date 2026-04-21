#!/usr/bin/env python3
"""
构建日报/周报内容，并发送到飞书和企业微信：
  1. 热点趋势日报（来自 public/热点/：优先 final_json_from_csv_YYYYMMDD.json，否则 final_json_from_csv.json；摘要 + 本日热点列表）
  2. 微信/抖音小游戏周报（public/wechatdouyin.db 的 rank_changes：新进 Top10、本周排名飙升 Top10，不含 Top20 正文）
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

from feishu_markdown_images import prepare_feishu_card_markdown
from webhook_url import normalize_webhook_url
from wecom_webhook import wecom_webhook_succeeded

from send_sensortower_weekly_push import _build_sensortower_only_push, send_feishu_card_with_segments

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
    from repo_dotenv import load_repo_env

    load_repo_env(repo_root)

def _clean_url(value: str | None) -> str | None:
    if not value:
        return None
    v = value.replace("\r", "").replace("\n", "").strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1].strip()
    return v if v else None

def _weekly_report_url(st_date: str) -> str:
    """当周 SensorTower 周报直链。"""
    if not st_date:
        return DETAIL_LINK
    return f"{DETAIL_LINK}?reportId=sensortower-weekly-{st_date}"


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


def _markdown_icon_prefix(icon_url: str | None) -> str:
    """行内小图标（app_metadata.icon_url），紧挨游戏名；飞书需上传为 image_key。URL 中 ) 需编码。"""
    u = (icon_url or "").strip()
    if not u or not u.lower().startswith(("http://", "https://")):
        return ""
    u_esc = u.replace("(", "%28").replace(")", "%29")
    return f"![ ]({u_esc}) "


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
        icon_url = ""
        if not store_url:
            try:
                cur.execute(
                    "SELECT name, url, icon_url FROM app_metadata WHERE app_id = ? AND LOWER(os) = ? LIMIT 1",
                    (app_id, os_val),
                )
                row_meta = cur.fetchone()
                if row_meta:
                    if len(row_meta) > 2 and (row_meta[2] or "").strip():
                        icon_url = str(row_meta[2]).strip()
                    if len(row_meta) > 1 and (row_meta[1] or "").strip():
                        store_url = str(row_meta[1]).strip()
                    if (row_meta[0] or "").strip() and not app_name:
                        app_name = str(row_meta[0]).strip()
            except sqlite3.OperationalError:
                pass
        if not icon_url:
            try:
                cur.execute(
                    "SELECT icon_url FROM app_metadata WHERE app_id = ? AND LOWER(os) = ? LIMIT 1",
                    (app_id, os_val),
                )
                row_ic = cur.fetchone()
                if row_ic and (row_ic[0] or "").strip():
                    icon_url = str(row_ic[0]).strip()
            except sqlite3.OperationalError:
                pass
        summaries = _parse_weekly_metadata_changed_fields(changed_fields)
        if not summaries:
            continue
        result.append({
            "name": app_name or app_id,
            "store_url": store_url,
            "summaries": summaries,
            "icon_url": icon_url,
        })
    return result

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


def _minigame_last_week_rank(current: int, change: str) -> int | None:
    raw = (change or "").strip()
    if "新进榜" in raw:
        return None
    is_down = "↓" in raw
    m = re.search(r"\d+", raw)
    if not m:
        return None
    n = int(m.group())
    if n <= 0:
        return None
    return current - n if is_down else current + n


def _minigame_is_new_to_top10(current: int, change: str) -> bool:
    if current < 1 or current > 10:
        return False
    raw = (change or "").strip()
    if "新进榜" in raw:
        return True
    last = _minigame_last_week_rank(current, change)
    if last is None:
        return False
    return last > 10


def _minigame_surge_delta(change: str) -> int:
    raw = (change or "").strip()
    if "新进榜" in raw:
        return -1
    if "↑" not in raw:
        return -1
    m = re.search(r"\d+", raw)
    if not m:
        return -1
    n = int(m.group())
    return n if n > 0 else -1


def _build_wechat_douyin_push(
    conn: sqlite3.Connection,
    target_week_range: str | None = None,
    max_top20: int = 5,
    max_changes: int = 5,
) -> tuple[str, str]:
    """从 wechatdouyin.db 的 rank_changes 构建微信/抖音小游戏周报 Markdown（不再包含 Top20 榜单正文）。
    一、新进 Top10：本周名次在 1–10 且上周不在 Top10（由「新进榜」或 ↑/↓ 推算上周名次）。
    二、本周排名飙升 Top10：按「↑」幅度取前 10（不含新进榜）。
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

    platform_label = {"wx": "微信小游戏", "dy": "抖音小游戏"}

    def _parse_rank_int(rank_raw) -> int | None:
        if rank_raw is None:
            return None
        try:
            return int(str(rank_raw).strip())
        except (TypeError, ValueError):
            return None

    def _format_change_row(r: tuple) -> str:
        rank = r[0] if r[0] is not None else "—"
        name = (r[1] or "—").strip()
        company = (r[2] or "—").strip()
        change = (r[3] or "—").strip()
        pk = (r[4] or "").strip().lower() if len(r) > 4 else ""
        plat = platform_label.get(pk, pk or "—")
        return f"- 排名 {rank}：{name}（{plat}，{company}，变化 {change}）"

    def _append_change_section(
        heading: str,
        section_rows: list,
        *,
        empty_hint: str,
    ) -> None:
        lines.append(heading)
        lines.append("")
        total = len(section_rows)
        if total == 0:
            lines.append(empty_hint)
            lines.append("")
            return
        lines.append(f"共 {total} 条记录，示例 {min(total, max_changes)} 条：")
        lines.append("")
        for r in section_rows[:max_changes]:
            lines.append(_format_change_row(r))
        if total > max_changes:
            lines.append("- ……")
        lines.append("")

    try:
        cur = conn.execute(
            "SELECT rank, game_name, company, rank_change, platform_key FROM rank_changes "
            "WHERE week_range = ? ORDER BY platform_key, CAST(rank AS INTEGER) ASC",
            (week_range,),
        )
        rows = list(cur.fetchall())
        new_top10: list = []
        for r in rows:
            ch = (r[3] or "").strip() if len(r) > 3 else ""
            rk = _parse_rank_int(r[0])
            if rk is not None and _minigame_is_new_to_top10(rk, ch):
                new_top10.append(r)

        new_keys = set()
        for r in new_top10:
            pk = (r[4] or "").strip().lower() if len(r) > 4 else ""
            nm = (r[1] or "").strip()
            new_keys.add((pk, nm))

        surge_scored: list[tuple[tuple, int]] = []
        for r in rows:
            ch = (r[3] or "").strip() if len(r) > 3 else ""
            d = _minigame_surge_delta(ch)
            if d <= 0:
                continue
            pk = (r[4] or "").strip().lower() if len(r) > 4 else ""
            nm = (r[1] or "").strip()
            if (pk, nm) in new_keys:
                continue
            surge_scored.append((r, d))
        surge_scored.sort(key=lambda x: (-x[1], _parse_rank_int(x[0][0]) or 999))
        surge_list = [t[0] for t in surge_scored[:10]]

        if new_top10 or surge_list:
            _append_change_section(
                "## 一、新进 Top10（本周进入 Top10，上周不在 Top10）",
                new_top10,
                empty_hint="本周暂无符合条件的记录。",
            )
            _append_change_section(
                "## 二、本周排名飙升 Top10",
                surge_list,
                empty_hint="本周暂无排名飙升（↑）记录。",
            )
    except sqlite3.OperationalError:
        pass

    if len(lines) <= 2:
        return "", ""

    lines.append("---")
    lines.append("")
    lines.append(f"> 👉 查看当周完整周报：[游戏监测网站]({DETAIL_LINK})（用户名：admin，密码：guru666）")
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


# ---------- 发送 ----------
def _post_json(url: str, payload: dict) -> tuple[int, str]:
    url = normalize_webhook_url(url)
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


def send_feishu_card(webhook: str, title: str, md_content: str) -> bool:
    """飞书：发一条互动卡片（内容经飞书格式适配）。仅当 HTTP 200 且响应 JSON 中 code==0 时返回 True。"""
    feishu_md = _adapt_md_for_feishu(prepare_feishu_card_markdown(md_content))
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
        print(f"[飞书] 发送失败 HTTP status={status} resp={resp}", file=sys.stderr)
        return False
    try:
        data = json.loads(resp)
    except json.JSONDecodeError:
        print(f"[飞书] 发送结果无法解析（HTTP 200）resp={resp[:800]!r}", file=sys.stderr)
        return False
    code = data.get("code")
    msg = data.get("msg", "")
    if code == 0:
        print("[飞书] 发送成功")
        return True
    print(f"[飞书] 发送失败（业务错误）code={code!r} msg={msg}", file=sys.stderr)
    return False


WECOM_MARKDOWN_MAX_BYTES = 4096


def _truncate_for_wecom(md: str, max_bytes: int = WECOM_MARKDOWN_MAX_BYTES) -> str:
    data = md.encode("utf-8")
    if len(data) <= max_bytes:
        return md
    suffix = f"\n\n> 内容过长，详见 [游戏监测网站]({DETAIL_LINK}) 查看（用户名：admin，密码：guru666）。"
    suffix_bytes = suffix.encode("utf-8")
    keep = max_bytes - len(suffix_bytes)
    if keep <= 0:
        return suffix.strip()
    chunk = data[:keep]
    while chunk and (chunk[-1] & 0x80) and not (chunk[-1] & 0x40):
        chunk = chunk[:-1]
    return chunk.decode("utf-8", errors="ignore") + suffix


def send_wecom_markdown(webhook: str, md_content: str) -> bool:
    """企业微信：发一条 Markdown 消息（单条不超过 4096 字节）。返回 True 表示 errcode==0。"""
    content = _truncate_for_wecom(md_content)
    payload = {
        "msgtype": "markdown",
        "markdown": {"content": content},
    }
    status, resp = _post_json(webhook, payload)
    ok, reason = wecom_webhook_succeeded(status, resp)
    if ok:
        print("[企业微信] 发送成功")
        return True
    print(f"[企业微信] 发送失败：{reason}；完整响应：{resp[:800]!r}", file=sys.stderr)
    return False


def _split_sensortower_for_wecom(md: str) -> list[str]:
    """SensorTower 周报拆成多条发企业微信（单条 4096 字节上限）：一+二、三、四 各成一段，避免截断把商店页变化或下线游戏的链接截掉。每段末尾带链接。"""
    sep3 = "## 三、商店页的更新"
    sep4 = "## 四、上周榜单中疑似下线的产品"
    if sep3 not in md:
        return [md]
    before, after3 = md.split(sep3, 1)
    part1 = before.rstrip()
    footer = f"\n\n---\n\n> 👉 查看当周完整周报：[游戏监测网站]({DETAIL_LINK})（用户名：admin，密码：guru666）"
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



def push_game_weekly_message(
    title: str,
    body_feishu: str,
    body_wecom: str | None = None,
    *,
    feishu_segments: list | None = None,
) -> None:
    """根据标题与内容发送到已配置的飞书/企微（SensorTower 标题会拆多条企微）。feishu_segments 非空时飞书走 column_set。"""
    feishu = _clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
    wecom = _clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL")) or _clean_url(os.environ.get("WECOM_WEBHOOK_URL"))
    if not feishu and not wecom:
        print(
            "未配置 Webhook。请在 .env 中设置 FEISHU_WEBHOOK_URL 或 WECOM_WEBHOOK_URL_REAL（或 WECOM_WEBHOOK_URL）",
            file=sys.stderr,
        )
        raise SystemExit(1)
    body_w = body_wecom if body_wecom is not None else body_feishu
    if feishu:
        if feishu_segments:
            if not send_feishu_card_with_segments(feishu, title, feishu_segments):
                raise SystemExit(1)
        else:
            if not send_feishu_card(feishu, title, body_feishu):
                raise SystemExit(1)
    if wecom:
        if title.startswith("SensorTower 周报"):
            for part in _split_sensortower_for_wecom(body_w):
                if not send_wecom_markdown(wecom, part):
                    raise SystemExit(1)
        else:
            if not send_wecom_markdown(wecom, body_w):
                raise SystemExit(1)



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
    summary_md = f"# {title}\n\n{content}\n\n> 详情进入 [游戏监测网站]({DETAIL_LINK}) 查看（用户名：admin，密码：guru666）。"
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
    body = f"# {title_str}\n\n{content}\n\n> 详情进入 [游戏监测网站]({DETAIL_LINK}) 查看（用户名：admin，密码：guru666）。"
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
    messages: list[tuple[str, str, str | None, list | None]] = []

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
                    messages.append((f"微信/抖音小游戏周报-{wd_week}", wd_md, None, None))

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
            md, st_date, feishu_seg, md_wecom = _build_sensortower_only_push(
                conn_st, max_items_per_section=5, target_rank_date=target_rank_date
            )
            if md and st_date:
                messages.append((f"SensorTower 周报-{st_date or '最新'}", md, md_wecom, feishu_seg))
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
                messages.append((hot_title, hot_feishu_md, hot_wecom_md, None))
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
                messages.append((ai_title or "AI 日报", ai_md, None, None))
            else:
                print(f"[跳过] AI 日报：{ai_date_json} 内容为空或解析失败", file=sys.stderr)

    if not messages:
        print("未生成任何内容，请检查 --content 及对应数据文件。", file=sys.stderr)
        return 1

    if args.dry_run:
        print("=== 构建结果（dry-run，不发送）===")
        for idx, (title, body_f, body_w, feishu_seg) in enumerate(messages, start=1):
            print(f"[{idx}] 标题: {title}")
            print("--- 飞书推送内容 ---")
            print(body_f)
            if feishu_seg:
                print(f"（飞书 column_set 片段数: {len(feishu_seg)}）")
            if body_w is not None:
                print("--- 企业微信推送内容（每 source 3 条）---")
                print(body_w)
            else:
                print("--- 企业微信同飞书 ---")
            print("\n" + "=" * 40 + "\n")
        return 0

    for title, body_feishu, body_wecom, feishu_seg in messages:
        push_game_weekly_message(title, body_feishu, body_wecom, feishu_segments=feishu_seg)

    return 0


if __name__ == "__main__":
    sys.exit(main())
