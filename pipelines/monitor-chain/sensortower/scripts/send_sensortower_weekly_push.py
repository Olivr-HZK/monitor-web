#!/usr/bin/env python3
"""
SensorTower 榜单周报推送（单文件自包含，不依赖本目录其他脚本）。

仅依赖：标准库、可选 python-dotenv、sensortower_top100.db、项目根目录 .env（Webhook）。

用法（项目根目录）：
  python3 scripts/send_sensortower_weekly_push.py
  python3 scripts/send_sensortower_weekly_push.py --date 2026-04-06 --dry-run
"""
import html
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request
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

def _clean_url(value: str | None) -> str | None:
    if not value:
        return None
    v = value.replace("\r", "").replace("\n", "").strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1].strip()
    return v if v else None

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


FEISHU_INLINE_ICON_PX = 18
_MD_IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


def _normalize_icon_url_for_feishu_inline(url: str) -> str:
    """压缩商店图标 CDN 路径，再配合固定宽高避免飞书里图占满一行。"""
    u = (url or "").strip()
    if not u:
        return u
    if "mzstatic.com" in u:
        u = re.sub(r"/(\d+)x(\d+)(bb\.(?:jpg|webp|png))", r"/60x60\3", u, count=1, flags=re.IGNORECASE)
    if "googleusercontent.com" in u:
        u = re.sub(r"=w(\d+)-h(\d+)(?:-c)?$", "=w48-h48-c", u, count=1, flags=re.IGNORECASE)
        u = re.sub(r"=s\d{2,4}(-c)?$", "=s48-c", u, count=1, flags=re.IGNORECASE)
    return u


def _shrink_feishu_markdown_images(md: str) -> str:
    """把 ![](url) 换成行内小图，视觉接近正文。"""

    def repl(m: re.Match[str]) -> str:
        raw = (m.group(2) or "").strip()
        u = _normalize_icon_url_for_feishu_inline(raw)
        esc = html.escape(u, quote=True)
        w = FEISHU_INLINE_ICON_PX
        return (
            f'<img src="{esc}" width="{w}" height="{w}" '
            'style="vertical-align:middle;margin-right:4px;object-fit:contain;border-radius:20%;"/>'
        )

    return _MD_IMG_RE.sub(repl, md)


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
    feishu_md = _shrink_feishu_markdown_images(_adapt_md_for_feishu(md_content))
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



def _use_test_webhooks() -> bool:
    return os.environ.get("SENSORTOWER_PUSH_USE_TEST", "").strip().lower() in ("1", "true", "yes")


def _webhook_feishu() -> str | None:
    if _use_test_webhooks():
        return _clean_url(
            os.environ.get("FEISHU_WEBHOOK_URL_TEST")
            or os.environ.get("FEISHU_WEBHOOK_URL_Test")
        ) or _clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
    return _clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))


def _webhook_wecom() -> str | None:
    if _use_test_webhooks():
        explicit = os.environ.get("WECOM_WEBHOOK_URL_TEST") or os.environ.get("WEWORK_WEBHOOK_URL_TEST")
        u = (
            _clean_url(explicit)
            or _clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL"))
            or _clean_url(os.environ.get("WECOM_WEBHOOK_URL"))
            or _clean_url(os.environ.get("WEWORK_WEBHOOK_URL"))
        )
        if u and not explicit:
            print(
                "[企微] 测试模式未配置 WEWORK_WEBHOOK_URL_TEST，已回退到 WEWORK_WEBHOOK_URL",
                file=sys.stderr,
            )
        return u
    return (
        _clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL"))
        or _clean_url(os.environ.get("WECOM_WEBHOOK_URL"))
        or _clean_url(os.environ.get("WEWORK_WEBHOOK_URL"))
    )


def push_game_weekly_message(title: str, body_feishu: str, body_wecom: str | None = None) -> None:
    """根据标题与内容发送到已配置的飞书/企微（SensorTower 标题会拆多条企微）。"""
    feishu = _webhook_feishu()
    wecom = _webhook_wecom()
    if not feishu and not wecom:
        print(
            "未配置 Webhook。请在 .env 中设置 FEISHU_WEBHOOK_URL 或 WECOM_WEBHOOK_URL / WEWORK_WEBHOOK_URL"
            "（测试：SENSORTOWER_PUSH_USE_TEST=1 且 FEISHU_WEBHOOK_URL_Test 等）",
            file=sys.stderr,
        )
        raise SystemExit(1)
    body_w = body_wecom if body_wecom is not None else body_feishu
    if feishu:
        send_feishu_card(feishu, title, body_feishu)
    if wecom:
        if title.startswith("SensorTower 周报"):
            for part in _split_sensortower_for_wecom(body_w):
                send_wecom_markdown(wecom, part)
        else:
            send_wecom_markdown(wecom, body_w)

def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="从 sensortower_top100.db 推送 SensorTower 周报")
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="SQLite 路径，默认仓库内 data/sensortower_top100.db（若存在）否则 public/sensortower_top100.db",
    )
    parser.add_argument("--date", type=str, default=None, metavar="YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--use-test-webhooks",
        action="store_true",
        help="使用测试 Webhook：读 FEISHU_WEBHOOK_URL_Test / FEISHU_WEBHOOK_URL_TEST；企微优先 WEWORK_WEBHOOK_URL_TEST",
    )
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    _load_env(repo_root)
    if args.use_test_webhooks:
        os.environ["SENSORTOWER_PUSH_USE_TEST"] = "1"
    if args.db is None:
        for candidate in ("data/sensortower_top100.db", "public/sensortower_top100.db"):
            p = repo_root / candidate
            if p.is_file():
                db_path = p
                break
        else:
            db_path = repo_root / "data/sensortower_top100.db"
    else:
        db_path = repo_root / args.db if not args.db.is_absolute() else args.db
    if not db_path.exists():
        print(f"[错误] 数据库不存在：{db_path}", file=sys.stderr)
        return 1
    target_rank_date = args.date.strip()[:10] if args.date else None
    conn = sqlite3.connect(str(db_path))
    try:
        md, st_date = _build_sensortower_only_push(conn, max_items_per_section=5, target_rank_date=target_rank_date)
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
        return 0
    push_game_weekly_message(title, md, None)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
