#!/usr/bin/env python3
# 兼容 cron 使用 macOS 自带 Python 3.9：延迟解析类型注解（PEP 563），避免 str|None 等在 3.10 才生效。
from __future__ import annotations

"""
SensorTower 榜单周报推送（单文件自包含，不依赖本目录其他脚本）。

仅依赖：标准库、可选 python-dotenv、sensortower_top100.db、项目根目录 .env（Webhook）。

用法（项目根目录）：
  python3 scripts/send_sensortower_weekly_push.py
  python3 scripts/send_sensortower_weekly_push.py --date 2026-04-06 --dry-run

飞书 ST 周报：
  - 默认整卡 Markdown，不带应用图标，避免飞书卡片图片格式兼容问题。
  - 若需恢复应用图标，设 FEISHU_ST_INCLUDE_ICONS=1；若还需左图右文 column_set，再设 FEISHU_ST_USE_COLUMN_CARD=1。
列式时：FEISHU_ST_COLUMN_IMG_MODE 默认 small；可设 medium/large 或 FEISHU_ST_COLUMN_ICON_PX。
"""
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from feishu_markdown_images import feishu_icon_http_url_to_image_key, prepare_feishu_card_markdown
from webhook_url import normalize_webhook_url
from wecom_webhook import wecom_webhook_succeeded

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
    """从项目根目录与 backend/.env 加载环境变量（见 repo_dotenv）。"""
    from repo_dotenv import load_repo_env

    load_repo_env(repo_root)


def _weekly_report_url(st_date: str) -> str:
    """当周 SensorTower 周报直链。"""
    if not st_date:
        return DETAIL_LINK
    sep = "&" if "?" in DETAIL_LINK else "?"
    return f"{DETAIL_LINK}{sep}reportId=sensortower-weekly-{st_date}"


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
            "app_id": app_id,
            "name": app_name or app_id,
            "store_url": store_url,
            "summaries": summaries,
            "icon_url": icon_url,
        })
    return result


def feishu_st_use_column_card() -> bool:
    """是否用 column_set（左图右文）。需同时开启 FEISHU_ST_INCLUDE_ICONS。"""
    v = (os.environ.get("FEISHU_ST_USE_COLUMN_CARD") or "0").strip().lower()
    return v not in ("0", "false", "no", "off")


def feishu_st_include_icons() -> bool:
    """是否在飞书 ST 周报里展示应用图标。默认关闭，避免卡片图片格式问题。"""
    v = (os.environ.get("FEISHU_ST_INCLUDE_ICONS") or "0").strip().lower()
    return v in ("1", "true", "yes", "on")


def _feishu_st_column_img_mode_and_upload_px() -> tuple[str, int]:
    """
    列式卡片左侧图：飞书 img.mode 与上传边长应对齐（小图上屏才清晰）。
    FEISHU_ST_COLUMN_IMG_MODE：tiny|small|medium|large，默认 small（约 40×40）。
    FEISHU_ST_COLUMN_ICON_PX：可选，覆盖上传像素（建议与 mode 一致）。
    """
    raw = (os.environ.get("FEISHU_ST_COLUMN_IMG_MODE") or "small").strip().lower()
    if raw not in ("tiny", "small", "medium", "large", "fit_horizontal", "crop_center"):
        raw = "small"
    # 飞书文档：tiny 16、small 40、medium 80、large 160；上传时用同阶像素避免先压太小再被拉大
    default_px = {"tiny": 16, "small": 40, "medium": 80, "large": 160}.get(raw, 40)
    px_env = (os.environ.get("FEISHU_ST_COLUMN_ICON_PX") or "").strip()
    if px_env:
        try:
            px = max(8, min(512, int(px_env)))
        except ValueError:
            px = default_px
    else:
        px = default_px
    return raw, px


def _feishu_column_row_element(img_key: str, right_md: str, *, img_mode: str) -> dict:
    return {
        "tag": "column_set",
        "flex_mode": "none",
        "horizontal_spacing": "8px",
        "columns": [
            {
                "tag": "column",
                "width": "auto",
                "vertical_align": "center",
                "elements": [
                    {
                        "tag": "img",
                        "img_key": img_key,
                        "mode": img_mode,
                        "alt": {"tag": "plain_text", "content": ""},
                        "preview": False,
                    }
                ],
            },
            {
                "tag": "column",
                "width": "weighted",
                "weight": 1,
                "vertical_align": "center",
                "elements": [{"tag": "markdown", "content": right_md}],
            },
        ],
    }


def send_feishu_card_with_segments(webhook: str, title: str, segments: list) -> bool:
    """飞书互动卡片：多条 markdown 与 column_set 行交替（segments: ('md', str) | ('row', url, rhs_md)）。"""
    col_mode, col_px = _feishu_st_column_img_mode_and_upload_px()
    cache: dict[str, str] = {}
    elements: list[dict] = []
    for seg in segments:
        if not seg or len(seg) < 2:
            continue
        kind = seg[0]
        if kind == "md":
            text = seg[1]
            feishu_md = _adapt_md_for_feishu(prepare_feishu_card_markdown(text))
            if feishu_md.strip():
                elements.append({"tag": "markdown", "content": feishu_md})
        elif kind == "row" and len(seg) >= 3:
            url, rhs = seg[1], seg[2]
            key = feishu_icon_http_url_to_image_key(url, cache, upload_side_px=col_px)
            rhs_adapted = _adapt_md_for_feishu(rhs)
            if key:
                elements.append(_feishu_column_row_element(key, rhs_adapted, img_mode=col_mode))
            else:
                elements.append({"tag": "markdown", "content": rhs_adapted})
    if cache:
        print(f"[飞书] column_set 已上传 {len(cache)} 个 icon（image_key）", file=sys.stderr)
    if not elements:
        print("[飞书] 列式卡片元素为空", file=sys.stderr)
        return False
    payload = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": title},
                "template": "blue",
            },
            "elements": elements,
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


def _build_sensortower_only_push(
    st_conn: sqlite3.Connection,
    max_items_per_section: int = 5,
    target_rank_date: str | None = None,
) -> tuple[str, str, list | None, str]:
    """仅 SensorTower：总标题 + 一、新进 Top50；二、排名飙升 Top10；三、商店页更新。游戏名用 rank_changes.store_url 做链接。
    target_rank_date：若指定（如 2026-02-02），只生成该 rank_date_current 的周报；否则取最新一周。
    第三项为飞书列式卡片段（FEISHU_ST_USE_COLUMN_CARD=1 时）：('md', 文本块) 与 ('row', icon_https, 右列无内联图的 Markdown 行)。
    第四项为企业微信专用正文：无应用行内图标、无装饰 emoji 链接文案（与飞书 md 可能不同）。"""
    lines: list[str] = []
    lines_wecom: list[str] = []
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
        return "", "", None, ""

    include_icons = feishu_st_include_icons()
    use_col = include_icons and feishu_st_use_column_card()
    segments: list = []
    seg_text: list[str] = []
    # JOIN app_metadata.os 与 rank_changes.platform 不完全一致时 icon 常为空；按 app_id 回退任一条有 icon_url 的记录
    _icon_resolve_cache: dict[str, str] = {}

    def icon_for_row(app_id: str, primary: str | None) -> str:
        pid = (app_id or "").strip()
        p = (primary or "").strip()
        if p.lower().startswith(("http://", "https://")):
            return p
        if not pid:
            return ""
        if pid in _icon_resolve_cache:
            return _icon_resolve_cache[pid]
        out = ""
        try:
            cur_ic = st_conn.cursor()
            cur_ic.execute(
                "SELECT icon_url FROM app_metadata WHERE app_id = ? AND TRIM(COALESCE(icon_url, '')) != '' LIMIT 1",
                (pid,),
            )
            row_ic = cur_ic.fetchone()
            if row_ic and (row_ic[0] or "").strip():
                out = str(row_ic[0]).strip()
        except sqlite3.OperationalError:
            pass
        _icon_resolve_cache[pid] = out
        return out

    def flush_md() -> None:
        if seg_text:
            segments.append(("md", "\n".join(seg_text)))
            seg_text.clear()

    def append_line(line: str, line_wecom: str | None = None) -> None:
        lines.append(line)
        lines_wecom.append(line if line_wecom is None else line_wecom)
        if use_col:
            seg_text.append(line)

    def append_game_row(icon_url: str | None, rhs_no_icon: str, full_line: str) -> None:
        line = full_line if include_icons else rhs_no_icon
        lines.append(line)
        lines_wecom.append(rhs_no_icon)
        if not use_col:
            return
        u = (icon_url or "").strip()
        if u.lower().startswith(("http://", "https://")):
            flush_md()
            segments.append(("row", u, rhs_no_icon))
        else:
            seg_text.append(line)

    st_project_id = os.environ.get("SENSORTOWER_OVERVIEW_PROJECT_ID", "").strip() or None

    append_line(f"# SensorTower 周报-{st_date or '日期'}")
    append_line("")

    # 一、新进 Top50（按 app_id 合并，store_url 来自 rank_changes）
    try:
        cur = st_conn.cursor()
        rank_date_current = st_date
        cur.execute(
            """
            SELECT r.app_id, COALESCE(m.name, r.app_name, r.app_id) AS display_name, r.store_url, r.country, r.current_rank, m.icon_url
            FROM rank_changes r
            LEFT JOIN app_metadata m ON m.app_id = r.app_id AND LOWER(TRIM(COALESCE(m.os, ''))) = LOWER(TRIM(COALESCE(r.platform, '')))
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
            icon_from_m = str(r[5] or "").strip() if len(r) > 5 else ""
            try:
                rank_int = int(current_rank) if current_rank is not None else None
            except (TypeError, ValueError):
                rank_int = None
            if not app_id:
                continue
            if app_id not in by_app:
                by_app[app_id] = {
                    "name": name,
                    "count": 0,
                    "store_url": url_from_rank,
                    "country": country,
                    "current_rank": rank_int,
                    "icon_url": icon_from_m,
                }
                seen_order.append(app_id)
            else:
                if url_from_rank and not by_app[app_id].get("store_url"):
                    by_app[app_id]["store_url"] = url_from_rank
                if country and not by_app[app_id].get("country"):
                    by_app[app_id]["country"] = country
                if rank_int is not None and (by_app[app_id].get("current_rank") is None or rank_int < by_app[app_id]["current_rank"]):
                    by_app[app_id]["current_rank"] = rank_int
                if icon_from_m and not by_app[app_id].get("icon_url"):
                    by_app[app_id]["icon_url"] = icon_from_m
            by_app[app_id]["count"] += 1
        new_entries = [by_app[aid] for aid in seen_order]
        new_count = len(new_entries)
        append_line("## 一、SensorTower 本周新进 Top50")
        append_line("")
        append_line(f"**统计周期**：本周榜单日期 {rank_date_current}，对比上周 {rank_date_last}。")
        append_line("")
        append_line(
            f"共 {new_count} 款（已合并同款多地区），例（* 表示该游戏在多个地区上榜，展示的是各地区中最佳名次）："
        )
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
            icon_u = icon_for_row(app_id, entry.get("icon_url"))
            icon_p = _markdown_icon_prefix(icon_u or None)
            st_link = f" [SensorTower]({st_url})" if st_url else ""
            if store_url:
                full = f"- {rank_str}{icon_p}[{text}]({store_url})" + (f" [📊 SensorTower]({st_url})" if st_url else "")
                rhs = f"- {rank_str}[{text}]({store_url})" + st_link
            else:
                full = f"- {rank_str}{icon_p}{text}" + (f" [📊 SensorTower]({st_url})" if st_url else "")
                rhs = f"- {rank_str}{text}" + st_link
            append_game_row(icon_u, rhs, full)
        if new_count > max_items_per_section:
            append_line("- ……")
        append_line("")
    except sqlite3.OperationalError:
        pass

    # 二、排名飙升 Top10（store_url 来自 rank_changes）
    if st_date:
        try:
            cur = st_conn.cursor()
            cur.execute(
                """
                SELECT r.app_id, r.change, COALESCE(m.name, r.app_name, r.app_id) AS display_name, r.store_url, r.country, r.current_rank, m.icon_url
                FROM rank_changes r
                LEFT JOIN app_metadata m ON m.app_id = r.app_id AND LOWER(TRIM(COALESCE(m.os, ''))) = LOWER(TRIM(COALESCE(r.platform, '')))
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
                icon_from_m = str(r[6] or "").strip() if len(r) > 6 else ""
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
                        "icon_url": icon_from_m,
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
                        info["icon_url"] = icon_from_m or info.get("icon_url") or ""
            surge_list = sorted(surge_by_app.values(), key=lambda x: -x["surge"])[:10]
            append_line("## 二、SensorTower 本周排名飙升 Top10")
            append_line("")
            append_line(
                f"共 {len(surge_list)} 款（已合并同款多地区），例（* 表示该游戏在多个地区上榜，展示的是各地区中最佳名次）："
            )
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
                icon_u = icon_for_row(str(x.get("app_id") or ""), x.get("icon_url"))
                icon_p = _markdown_icon_prefix(icon_u or None)
                st_link = f" [SensorTower]({st_url})" if st_url else ""
                if store_url:
                    full = f"- {rank_str}{icon_p}[{text}]({store_url})" + (f" [📊 SensorTower]({st_url})" if st_url else "")
                    rhs = f"- {rank_str}[{text}]({store_url})" + st_link
                else:
                    full = f"- {rank_str}{icon_p}{text}" + (f" [📊 SensorTower]({st_url})" if st_url else "")
                    rhs = f"- {rank_str}{text}" + st_link
                append_game_row(icon_u, rhs, full)
            if len(surge_list) > max_items_per_section:
                append_line("- ……")
            append_line("")
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
            append_line("## 异动简述")
            append_line("")
            append_line(_stmt)
            append_line("")
    except sqlite3.OperationalError:
        pass

    # 三、商店页的更新（从 weekly_metadata_changes 读取当周 rank_date，取 5 条）
    append_line("## 三、商店页的更新")
    append_line("")
    store_items = _get_store_changes_from_weekly_metadata(st_conn, st_date, limit=5)
    if store_items:
        for item in store_items:
            name = item.get("name") or "—"
            store_url = item.get("store_url") or ""
            brief = "、".join(item.get("summaries") or [])
            _aid = (item.get("app_id") or "").strip()
            icon_u = icon_for_row(_aid, item.get("icon_url"))
            icon_p = _markdown_icon_prefix(icon_u or None)
            if store_url:
                line = f"- {icon_p}[{name}]({store_url})"
                rhs = f"- [{name}]({store_url})"
            else:
                line = f"- {icon_p}{name}"
                rhs = f"- {name}"
            if brief:
                line += f"（{brief}）"
                rhs += f"（{brief}）"
            append_game_row(icon_u, rhs, line)
    else:
        append_line("本周期暂无商店页变化。")
    append_line("")

    # 四、上周榜单中疑似下线的产品（与前端 sensortowerWeeklyReport 一致：用 rank_date_last）
    append_line("## 四、上周榜单中疑似下线的产品")
    append_line("")
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
                    "os_key": str(r[1] or "").strip().lower(),
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
            icon_url_rm = ""
            aid = (item.get("app_id") or "").strip()
            os_key = (item.get("os_key") or "").strip().lower()
            if aid and os_key:
                try:
                    cur_ic = st_conn.cursor()
                    cur_ic.execute(
                        "SELECT icon_url FROM app_metadata WHERE app_id = ? AND LOWER(TRIM(COALESCE(os, ''))) = LOWER(TRIM(?)) LIMIT 1",
                        (aid, os_key),
                    )
                    row_ic = cur_ic.fetchone()
                    if row_ic and (row_ic[0] or "").strip():
                        icon_url_rm = str(row_ic[0]).strip()
                except sqlite3.OperationalError:
                    pass
            icon_url_rm = icon_for_row(aid, icon_url_rm or None)
            icon_p = _markdown_icon_prefix(icon_url_rm or None)
            if store_url:
                line = f"- {icon_p}[{name}]({store_url})（{country} | {chart_label} | {platform}"
                rhs = f"- [{name}]({store_url})（{country} | {chart_label} | {platform}"
            else:
                line = f"- {icon_p}{name}（{country} | {chart_label} | {platform}"
                rhs = f"- {name}（{country} | {chart_label} | {platform}"
            if reason:
                line += f"；{reason}"
                rhs += f"；{reason}"
            line += "）"
            rhs += "）"
            append_game_row(icon_url_rm if icon_url_rm else None, rhs, line)
        if len(removed_items) > max_items_per_section:
            append_line(f"- …… 共 {len(removed_items)} 款，详见平台")
    else:
        append_line("上周无疑似下线产品。")
    append_line("")

    append_line("---")
    append_line("")
    weekly_url = _weekly_report_url(st_date)
    append_line(
        f"> 👉 查看当周完整周报：[游戏监测网站]({weekly_url})（用户名：admin，密码：guru666）",
        f"> 查看当周完整周报：[游戏监测网站]({weekly_url})（用户名：admin，密码：guru666）",
    )
    if use_col:
        flush_md()
    return "\n".join(lines), st_date, segments if use_col else None, "\n".join(lines_wecom)

def _clean_url(value: str | None) -> str | None:
    if not value:
        return None
    v = value.replace("\r", "").replace("\n", "").strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1].strip()
    return v if v else None

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
    feishu_only: bool = False,
    feishu_segments: list | None = None,
) -> None:
    """根据标题与内容发送到已配置的飞书/企微（SensorTower 标题会拆多条企微）。feishu_only=True 时只发飞书。
    feishu_segments 非空时飞书走 column_set 列式卡片；body_wecom 非空时企微用其正文（无行内应用图），否则回退 body_feishu。"""
    feishu = _clean_url(os.environ.get("FEISHU_WEEKLY_WEBHOOK_URL")) or _clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
    wecom = None if feishu_only else (
        _clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL")) or _clean_url(os.environ.get("WECOM_WEBHOOK_URL"))
    )
    if not feishu and not wecom:
        print(
            "未配置 Webhook。请在 .env 中设置 FEISHU_WEEKLY_WEBHOOK_URL / FEISHU_WEBHOOK_URL 或 WECOM_WEBHOOK_URL_REAL（或 WECOM_WEBHOOK_URL）",
            file=sys.stderr,
        )
        raise SystemExit(1)
    if feishu_only and not feishu:
        print("已指定仅发飞书，但未配置 FEISHU_WEEKLY_WEBHOOK_URL 或 FEISHU_WEBHOOK_URL。", file=sys.stderr)
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

def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="从 sensortower_top100.db 推送 SensorTower 周报")
    parser.add_argument("--db", type=Path, default=Path("public/sensortower_top100.db"))
    parser.add_argument("--date", type=str, default=None, metavar="YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--feishu-only", action="store_true", help="只推送飞书，不推企业微信")
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    _load_env(repo_root)
    db_path = repo_root / args.db if not args.db.is_absolute() else args.db
    if not db_path.exists():
        print(f"[错误] 数据库不存在：{db_path}", file=sys.stderr)
        return 1
    target_rank_date = args.date.strip()[:10] if args.date else None
    conn = sqlite3.connect(str(db_path))
    try:
        md, st_date, feishu_seg, md_wecom = _build_sensortower_only_push(
            conn, max_items_per_section=5, target_rank_date=target_rank_date
        )
    finally:
        conn.close()
    if not md or not st_date:
        if args.date:
            print(f"[跳过] rank_changes 中无 rank_date_current={args.date}", file=sys.stderr)
        else:
            print("[跳过] 无法从 rank_changes 解析周报日期", file=sys.stderr)
        return 1
    title = f"SensorTower 周报-{st_date}"
    if args.dry_run:
        print(f"=== {title}（dry-run）===\n")
        print(md)
        if feishu_seg:
            print(f"\n（飞书将用 column_set，共 {len(feishu_seg)} 个片段：md / row）", file=sys.stderr)
        return 0
    push_game_weekly_message(
        title, md, md_wecom, feishu_only=args.feishu_only, feishu_segments=feishu_seg
    )
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
