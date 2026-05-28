"""Front-end optimized data endpoints.

These endpoints keep backend deployments from shipping large SQLite files to the
browser. They return the same shapes the React loaders already use, but query
the source databases server-side.
"""
from __future__ import annotations

from datetime import datetime
from functools import wraps
from pathlib import Path
import json
import re
import sqlite3
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from config import DATA_SOURCE_DB_PATHS

router = APIRouter(prefix="/api/frontend", dependencies=[Depends(get_current_user)])

RANK_WEEKS_LIMIT = 4
OUR_PRODUCT_MAX_DATES = 56
FRONTEND_DATA_CACHE_TTL_SEC = 300
_response_cache: dict[str, tuple[float, tuple[int, int], dict[str, Any]]] = {}


def _db_path(name: str) -> Path:
    path = DATA_SOURCE_DB_PATHS.get(name)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail=f"{name} 不存在")
    return path


def _connect(name: str) -> sqlite3.Connection:
    path = _db_path(name)
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


def _db_signature(name: str) -> tuple[int, int]:
    stat = _db_path(name).stat()
    return (stat.st_mtime_ns, stat.st_size)


def _cached_response(key: str, db_name: str, build: Any) -> dict[str, Any]:
    signature = _db_signature(db_name)
    now = time.monotonic()
    cached = _response_cache.get(key)
    if cached and cached[0] > now and cached[1] == signature:
        return cached[2]
    value = build()
    _response_cache[key] = (now + FRONTEND_DATA_CACHE_TTL_SEC, signature, value)
    return value


def _db_cached(db_name: str):
    def decorator(fn: Any):
        @wraps(fn)
        def wrapper() -> dict[str, Any]:
            return _cached_response(fn.__name__, db_name, fn)

        return wrapper

    return decorator


def _rows(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    return conn.execute(sql, params).fetchall()


def _latest_values(conn: sqlite3.Connection, table: str, column: str, limit: int) -> list[str]:
    rows = _rows(
        conn,
        f"SELECT DISTINCT {column} AS value FROM {table} ORDER BY {column} DESC LIMIT ?",
        (limit,),
    )
    return [str(row["value"]) for row in rows if row["value"]]


def _placeholders(values: list[Any]) -> str:
    return ",".join("?" for _ in values)


def _format_release_date(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return text[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", text) else text


def _num(value: Any) -> float | int | None:
    if value is None or value == "":
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return int(n) if n.is_integer() else n


def _metadata_map(conn: sqlite3.Connection) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    try:
        for row in _rows(
            conn,
            "SELECT app_id, os, name, publisher_name, release_date, url, icon_url FROM app_metadata",
        ):
            key = f"{row['app_id']}|{str(row['os'] or '').lower()}"
            result[key] = {
                "name": str(row["name"] or ""),
                "publisherName": str(row["publisher_name"] or ""),
                "releaseDate": _format_release_date(row["release_date"]),
                "url": str(row["url"] or ""),
                "iconUrl": str(row["icon_url"] or "").strip(),
            }
    except sqlite3.Error:
        return result
    return result


def _metadata_key(app_id: str, platform: str) -> str:
    return f"{app_id}|{'ios' if platform == 'iOS' else 'android'}"


def _parse_screenshot_urls(raw: Any) -> list[str]:
    text = str(raw or "").strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(item) for item in parsed if item]
    except json.JSONDecodeError:
        pass
    return [item.strip().strip('"').strip("'") for item in re.split(r"[\n,|;]", text) if item.strip()]


def _strip_quotes(value: str) -> str:
    text = value.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in ("'", '"'):
        return text[1:-1]
    return text


def _split_top_level(text: str) -> list[str]:
    items: list[str] = []
    depth = 0
    start = 0
    for i, ch in enumerate(text):
        if ch in "[{":
            depth += 1
        elif ch in "]}":
            depth = max(0, depth - 1)
        elif ch == "," and depth == 0:
            items.append(text[start:i].strip())
            start = i + 1
    items.append(text[start:].strip())
    return [item for item in items if item]


def _parse_changed_fields(raw: Any) -> list[str]:
    text = str(raw or "").strip()
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    return [_strip_quotes(item).strip() for item in _split_top_level(text) if item.strip()]


def _parse_loose_map(raw: Any) -> dict[str, str]:
    text = str(raw or "").strip()
    if not text:
        return {}
    if text.startswith("{") and text.endswith("}"):
        text = text[1:-1]
    result: dict[str, str] = {}
    i = 0
    while i < len(text):
        while i < len(text) and text[i] in " ,":
            i += 1
        if i >= len(text):
            break
        key_start = i
        while i < len(text) and text[i] != ":":
            i += 1
        if i >= len(text):
            break
        key = _strip_quotes(text[key_start:i].strip())
        i += 1
        depth = 0
        value_start = i
        while i < len(text):
            ch = text[i]
            if ch in "[{":
                depth += 1
            elif ch in "]}":
                depth = max(0, depth - 1)
            elif ch == "," and depth == 0:
                break
            i += 1
        if key:
            result[key] = text[value_start:i].strip()
        if i < len(text) and text[i] == ",":
            i += 1
    return result


def _store_info_map(conn: sqlite3.Connection, platform: str) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    try:
        if platform == "iOS":
            rows = _rows(conn, "SELECT app_id, app_name, developer, store_url FROM appstoreinfo")
            for row in rows:
                result[str(row["app_id"] or "")] = {
                    "name": str(row["app_name"] or ""),
                    "developer": str(row["developer"] or ""),
                    "storeUrl": str(row["store_url"] or ""),
                }
        else:
            rows = _rows(conn, "SELECT app_id, title, developer, store_url FROM gamestoreinfo")
            for row in rows:
                result[str(row["app_id"] or "")] = {
                    "name": str(row["title"] or ""),
                    "developer": str(row["developer"] or ""),
                    "storeUrl": str(row["store_url"] or ""),
                }
    except sqlite3.Error:
        return result
    return result


@router.get("/sensortower/top100")
@_db_cached("sensortower_top100.db")
def sensortower_top100() -> dict[str, Any]:
    with _connect("sensortower_top100.db") as conn:
        meta = _metadata_map(conn)
        items: list[dict[str, Any]] = []
        for table, platform in (("apple_top100", "iOS"), ("android_top100", "Android")):
            dates = _latest_values(conn, table, "rank_date", RANK_WEEKS_LIMIT)
            if not dates:
                continue
            sql = (
                f"SELECT rank_date, country, chart_type, rank, app_id, downloads, revenue "
                f"FROM {table} WHERE rank_date IN ({_placeholders(dates)}) "
                "ORDER BY rank_date DESC, country, chart_type, rank ASC"
            )
            for row in _rows(conn, sql, tuple(dates)):
                app_id = str(row["app_id"] or "")
                m = meta.get(_metadata_key(app_id, platform), {})
                items.append({
                    "id": f"{platform}-{row['rank_date']}-{row['country']}-{row['chart_type']}-{row['rank']}-{app_id}",
                    "platform": platform,
                    "rankDate": str(row["rank_date"] or ""),
                    "country": str(row["country"] or ""),
                    "chartType": str(row["chart_type"] or ""),
                    "rank": int(row["rank"] or 0),
                    "appId": app_id,
                    "appName": m.get("name") or None,
                    "appUrl": m.get("url") or None,
                    "publisherName": m.get("publisherName") or None,
                    "releaseDate": m.get("releaseDate") or None,
                    "downloads": _num(row["downloads"]),
                    "revenue": _num(row["revenue"]),
                })
        return {"items": items}


@router.get("/sensortower/rank-changes")
@_db_cached("sensortower_top100.db")
def sensortower_rank_changes() -> dict[str, Any]:
    with _connect("sensortower_top100.db") as conn:
        meta = _metadata_map(conn)
        dates = _latest_values(conn, "rank_changes", "rank_date_current", RANK_WEEKS_LIMIT)
        if not dates:
            return {"items": []}
        sql = (
            "SELECT rank_date_current, rank_date_last, signal, app_name, app_id, country, platform, "
            'current_rank, last_week_rank, "change", change_type, downloads, revenue, publisher_name '
            f"FROM rank_changes WHERE rank_date_current IN ({_placeholders(dates)}) "
            "ORDER BY rank_date_current DESC, country, platform, current_rank ASC"
        )
        items: list[dict[str, Any]] = []
        for row in _rows(conn, sql, tuple(dates)):
            app_id = str(row["app_id"] or "")
            platform = "Android" if str(row["platform"] or "").upper() == "ANDROID" else "iOS"
            current_rank = int(row["current_rank"] or 0)
            last_week_rank = str(row["last_week_rank"] or "").strip()
            top5_movement = None
            if last_week_rank == "1" and 2 <= current_rank <= 5:
                top5_movement = "掉出第一"
            elif last_week_rank in {"2", "3", "4", "5"} and current_rank == 1:
                top5_movement = "登顶"
            m = meta.get(_metadata_key(app_id, platform), {})
            icon_url = m.get("iconUrl") or ""
            items.append({
                "id": f"rc-{row['rank_date_current']}-{row['country']}-{platform}-{row['current_rank']}-{app_id}",
                "rankDateCurrent": str(row["rank_date_current"] or ""),
                "rankDateLast": str(row["rank_date_last"] or ""),
                "signal": str(row["signal"] or ""),
                "appName": str(row["app_name"] or ""),
                "appId": app_id,
                "country": str(row["country"] or ""),
                "platform": platform,
                "currentRank": current_rank,
                "lastWeekRank": last_week_rank,
                "change": str(row["change"] or ""),
                "changeType": str(row["change_type"] or ""),
                "metadataAppName": m.get("name") or None,
                "appUrl": m.get("url") or None,
                "iconUrl": icon_url if re.match(r"^https?://", icon_url, re.I) else None,
                "publisherName": str(row["publisher_name"] or "") or m.get("publisherName") or None,
                "releaseDate": m.get("releaseDate") or None,
                "downloads": _num(row["downloads"]),
                "revenue": _num(row["revenue"]),
                "top5Movement": top5_movement,
            })
        return {"items": items}


@router.get("/sensortower/store-cards")
@_db_cached("sensortower_top100.db")
def sensortower_store_cards() -> dict[str, Any]:
    with _connect("sensortower_top100.db") as conn:
        latest = conn.execute(
            "SELECT rank_date_current FROM rank_changes "
            "WHERE country = '🇺🇸 美国' AND change_type = '🆕 新进榜单' AND current_rank <= 50 "
            "ORDER BY rank_date_current DESC LIMIT 1"
        ).fetchone()
        if not latest:
            return {"items": []}
        latest_date = str(latest["rank_date_current"])
        rows = _rows(
            conn,
            "SELECT app_id, app_name, country, platform, current_rank FROM rank_changes "
            "WHERE rank_date_current = ? AND country = '🇺🇸 美国' AND change_type = '🆕 新进榜单' "
            "AND current_rank <= 50 ORDER BY current_rank ASC LIMIT 3",
            (latest_date,),
        )
        items: list[dict[str, Any]] = []
        for index, row in enumerate(rows):
            app_id = str(row["app_id"] or "")
            platform = "Android" if str(row["platform"] or "").upper() == "ANDROID" else "iOS"
            store_info: dict[str, Any] | None = None
            if platform == "iOS":
                info = conn.execute(
                    "SELECT app_id, app_name, subtitle, price, price_type, rating, rating_count, age_rating, "
                    "category, developer, description, description_short, store_url, icon_url, screenshot_urls "
                    "FROM appstoreinfo WHERE app_id = ? LIMIT 1",
                    (app_id,),
                ).fetchone()
                if info:
                    store_info = {k: info[k] for k in info.keys()}
            else:
                info = conn.execute(
                    "SELECT app_id, title, developer, rating, category, short_description, full_description, "
                    "store_url, icon_url, screenshot_urls, installs, content_rating "
                    "FROM gamestoreinfo WHERE app_id = ? LIMIT 1",
                    (app_id,),
                ).fetchone()
                if info:
                    store_info = {k: info[k] for k in info.keys()}
            game_name = str(row["app_name"] or "") or app_id
            if store_info:
                game_name = str(store_info.get("app_name") or store_info.get("title") or game_name)
            screenshots = _parse_screenshot_urls((store_info or {}).get("screenshot_urls"))
            short_desc = (store_info or {}).get("description_short") or (store_info or {}).get("short_description")
            items.append({
                "id": f"st-store-{latest_date}-{platform}-{app_id}-{index}",
                "appId": app_id,
                "platform": platform,
                "gameName": game_name,
                "currentRank": int(row["current_rank"] or 0),
                "country": str(row["country"] or ""),
                "storeInfo": store_info,
                "screenshotUrl": screenshots[0] if screenshots else None,
                "shortDescription": str(short_desc) if short_desc else None,
            })
        return {"items": items}


@router.get("/sensortower/store-changes")
@_db_cached("sensortower_top100.db")
def sensortower_store_changes() -> dict[str, Any]:
    with _connect("sensortower_top100.db") as conn:
        dates = _latest_values(conn, "weekly_metadata_changes", "rank_date", 30)
        if not dates:
            return {"items": []}
        ios_info = _store_info_map(conn, "iOS")
        android_info = _store_info_map(conn, "Android")
        snapshot: dict[str, list[str]] = {}
        try:
            snap_rows = _rows(
                conn,
                "SELECT rank_date, app_id, os, screenshot_urls FROM weekly_metadata_snapshot "
                f"WHERE rank_date IN ({_placeholders(dates)})",
                tuple(dates),
            )
            for row in snap_rows:
                key = f"{row['rank_date']}|{row['app_id']}|{str(row['os'] or '').lower()}"
                snapshot[key] = _parse_screenshot_urls(row["screenshot_urls"])
        except sqlite3.Error:
            pass

        rows = _rows(
            conn,
            "SELECT id, rank_date, app_id, os, app_name, changed_fields, old_values, new_values, detected_at "
            "FROM weekly_metadata_changes "
            f"WHERE rank_date IN ({_placeholders(dates)}) ORDER BY rank_date DESC, detected_at DESC, id DESC",
            tuple(dates),
        )
        items: list[dict[str, Any]] = []
        for index, row in enumerate(rows):
            app_id = str(row["app_id"] or "")
            os_name = str(row["os"] or "").lower()
            platform = "Android" if os_name == "android" else "iOS"
            info = (android_info if platform == "Android" else ios_info).get(app_id, {})
            changed_fields = _parse_changed_fields(row["changed_fields"])
            old_map = _parse_loose_map(row["old_values"])
            new_map = _parse_loose_map(row["new_values"])
            summaries: list[str] = []
            screenshot_before = _parse_screenshot_urls(old_map.get("screenshot_urls"))
            screenshot_after = _parse_screenshot_urls(new_map.get("screenshot_urls"))
            snap_key = f"{row['rank_date']}|{app_id}|{os_name}"
            if not screenshot_after and snap_key in snapshot:
                screenshot_after = snapshot[snap_key]
            screenshot_changed = "screenshot_urls" in changed_fields
            if screenshot_changed:
                summaries.append("截图已更新")
            if "name" in changed_fields or "title" in changed_fields or "app_name" in changed_fields:
                summaries.append("名称已更新")
            if "description" in changed_fields or "short_description" in changed_fields:
                summaries.append("描述已更新")
            if not summaries:
                continue
            items.append({
                "id": f"st-store-change-{platform}-{row['rank_date']}-{app_id}-{index}",
                "appId": app_id,
                "platform": platform,
                "rankDate": str(row["rank_date"] or ""),
                "changedAt": str(row["detected_at"] or row["rank_date"] or ""),
                "appName": str(row["app_name"] or "") or info.get("name") or app_id,
                "developer": info.get("developer") or None,
                "summaries": summaries,
                "storeUrl": info.get("storeUrl") or None,
                "screenshotUrls": screenshot_after[:6] if screenshot_after else None,
                "screenshotBefore": screenshot_before[:6] if screenshot_before else None,
                "screenshotAfter": screenshot_after[:6] if screenshot_after else None,
                "iconBefore": None,
                "iconAfter": None,
                "videoImagesBefore": None,
                "videoImagesAfter": None,
                "priority": 2 if screenshot_changed else 0,
                "priorityLabel": "最高" if screenshot_changed else "普通",
            })
        return {"items": items}


@router.get("/sensortower/removed-games")
@_db_cached("sensortower_top100.db")
def sensortower_removed_games() -> dict[str, Any]:
    with _connect("sensortower_top100.db") as conn:
        meta = _metadata_map(conn)
        dates = _rows(
            conn,
            "SELECT DISTINCT rank_date FROM weekly_removed_games WHERE removed = 1 "
            "ORDER BY rank_date DESC LIMIT ?",
            (RANK_WEEKS_LIMIT,),
        )
        rank_dates = [str(row["rank_date"]) for row in dates if row["rank_date"]]
        if not rank_dates:
            return {"items": []}
        rows = _rows(
            conn,
            "SELECT rank_date, os, country, chart_type, app_id, app_name, store_url, reason "
            "FROM weekly_removed_games "
            f"WHERE removed = 1 AND rank_date IN ({_placeholders(rank_dates)}) "
            "ORDER BY rank_date DESC, os, country, chart_type, app_name",
            tuple(rank_dates),
        )
        items: list[dict[str, Any]] = []
        for index, row in enumerate(rows):
            platform = "Android" if str(row["os"] or "").lower() == "android" else "iOS"
            app_id = str(row["app_id"] or "")
            m = meta.get(_metadata_key(app_id, platform), {})
            icon_url = m.get("iconUrl") or ""
            items.append({
                "id": f"st-removed-{row['rank_date']}-{platform}-{app_id}-{index}",
                "rankDate": str(row["rank_date"] or ""),
                "platform": platform,
                "country": str(row["country"] or ""),
                "chartType": str(row["chart_type"] or ""),
                "appId": app_id,
                "appName": str(row["app_name"] or "") or m.get("name") or app_id,
                "storeUrl": str(row["store_url"] or "") or m.get("url") or None,
                "iconUrl": icon_url if re.match(r"^https?://", icon_url, re.I) else None,
                "reason": str(row["reason"] or "").strip() or None,
            })
        return {"items": items}


@router.get("/sensortower/top5-overview")
@_db_cached("sensortower_top100.db")
def sensortower_top5_overview() -> dict[str, Any]:
    with _connect("sensortower_top100.db") as conn:
        rows = _rows(
            conn,
            "SELECT rank_date, statement, trend_json, model_used, created_at "
            "FROM weekly_top5_overview ORDER BY rank_date DESC LIMIT ?",
            (RANK_WEEKS_LIMIT,),
        )
        return {
            "items": [
                {
                    "rankDate": str(row["rank_date"] or ""),
                    "statement": str(row["statement"] or ""),
                    "trendJson": str(row["trend_json"]) if row["trend_json"] is not None else None,
                    "modelUsed": str(row["model_used"]) if row["model_used"] is not None else None,
                    "createdAt": str(row["created_at"]) if row["created_at"] is not None else None,
                }
                for row in rows
                if row["rank_date"] and row["statement"]
            ]
        }


def _norm_rank(value: Any) -> int | None:
    try:
        rank = int(value)
    except (TypeError, ValueError):
        return None
    return rank if 0 < rank <= 500 else None


def _overview_url(app_id: str, country: str = "US") -> str:
    return f"https://app.sensortower-china.com/overview/{app_id}?country={country}" if app_id else ""


def _markdown_linked_title(display_name: str, app_id: str) -> str:
    if not app_id:
        return display_name
    safe = display_name.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")
    return f"[{safe}]({_overview_url(app_id)})"


def _build_rank_map(conn: sqlite3.Connection, date: str) -> dict[str, dict[str, Any]]:
    rows = _rows(
        conn,
        "SELECT internal_name, display_name, lower(platform) AS pf, rank, app_id "
        "FROM app_ranks WHERE country = 'US' AND rank_date = ? "
        "AND lower(platform) IN ('ios', 'android') AND ("
        "(lower(platform) = 'android' AND chart_type = 'topselling_free') OR "
        "(lower(platform) = 'ios' AND chart_type = 'topfreeapplications'))",
        (date,),
    )
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = str(row["internal_name"] or "").strip()
        if not name:
            continue
        rec = result.setdefault(
            name,
            {
                "displayName": str(row["display_name"] or name).strip() or name,
                "ios": {"rank": None, "appId": ""},
                "android": {"rank": None, "appId": ""},
            },
        )
        if row["display_name"]:
            rec["displayName"] = str(row["display_name"]).strip()
        pf = str(row["pf"] or "")
        if pf in {"ios", "android"}:
            rec[pf] = {"rank": _norm_rank(row["rank"]), "appId": str(row["app_id"] or "").strip()}
    return result


def _merge_rank_lines(rows: list[dict[str, Any]], order: str) -> list[str]:
    by_name: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_name.setdefault(row["internalName"], []).append(row)

    def sort_key(group: list[dict[str, Any]]) -> tuple[int, str]:
        max_delta = max(abs(item["prev"] - item["curr"]) for item in group)
        name = group[0]["displayName"] or group[0]["internalName"]
        return ((-max_delta if order == "up" else max_delta), name)

    lines: list[str] = []
    for group in sorted(by_name.values(), key=sort_key):
        sorted_group = sorted(group, key=lambda item: 0 if item["platform"] == "ios" else 1)
        display = sorted_group[0]["displayName"] or sorted_group[0]["internalName"]
        link_id = next((item["stAppId"] for item in sorted_group if item["platform"] == "ios" and item["stAppId"]), "")
        if not link_id:
            link_id = next((item["stAppId"] for item in sorted_group if item["stAppId"]), "")
        title = _markdown_linked_title(display, link_id)
        segs = []
        for item in sorted_group:
            delta = item["prev"] - item["curr"]
            sign = "+" if delta > 0 else ""
            segs.append(f"{item['platform']} {item['prev']}→{item['curr']}（{sign}{delta}）")
        lines.append(f"{title}（{'，'.join(segs)}）")
    return lines


def _build_compact_markdown(conn: sqlite3.Connection, date_from: str, date_to: str) -> str:
    prev = _build_rank_map(conn, date_from)
    curr = _build_rank_map(conn, date_to)
    up: list[dict[str, Any]] = []
    down: list[dict[str, Any]] = []
    for name in set(prev.keys()) | set(curr.keys()):
        p = prev.get(name) or {"displayName": name, "ios": {"rank": None, "appId": ""}, "android": {"rank": None, "appId": ""}}
        c = curr.get(name) or {"displayName": p["displayName"], "ios": {"rank": None, "appId": ""}, "android": {"rank": None, "appId": ""}}
        display = c["displayName"] or p["displayName"] or name
        for platform in ("ios", "android"):
            pr = p[platform]["rank"]
            cr = c[platform]["rank"]
            if pr is None or cr is None or pr == cr:
                continue
            row = {
                "internalName": name,
                "displayName": display,
                "platform": platform,
                "prev": pr,
                "curr": cr,
                "stAppId": c[platform]["appId"] or p[platform]["appId"],
            }
            if pr - cr > 0:
                up.append(row)
            else:
                down.append(row)
    body = "\n".join([
        "上升",
        "",
        *[f"- {line}" for line in _merge_rank_lines(up, "up")],
        "",
        "下降",
        "",
        *[f"- {line}" for line in _merge_rank_lines(down, "down")],
    ])
    return f"公司自有产品 · SensorTower US 免费榜 · 日总结\n\n{body}"


@router.get("/our-products/daily-items")
@_db_cached("us_free_appid_weekly.db")
def our_products_daily_items() -> dict[str, Any]:
    with _connect("us_free_appid_weekly.db") as conn:
        summaries = _rows(
            conn,
            "SELECT date_from, date_to, summary_text, product_count "
            "FROM weekly_summaries ORDER BY date_to DESC",
        )
        items: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in summaries:
            date_from = str(row["date_from"] or "").strip()
            date_to = str(row["date_to"] or "").strip()
            if not date_from or not date_to:
                continue
            key = f"{date_from}__{date_to}"
            if key in seen:
                continue
            seen.add(key)
            product_count = row["product_count"]
            title = "公司自有产品 · SensorTower US 免费榜 · 日总结"
            desc = (
                f"日环比 {date_from} → {date_to} · 覆盖 {int(product_count)} 个产品（详情见正文）"
                if product_count is not None
                else f"日环比 {date_from} → {date_to}"
            )
            content = _build_compact_markdown(conn, date_from, date_to)
            report_content = {
                "title": title,
                "date": date_to,
                "time": "",
                "source": "自有产品",
                "summary": desc,
                "content": content,
                "tags": ["我方产品", "SensorTower", "US", "免费榜", "日总结"],
                "meta": {"kind": "our_product_daily", "dateFrom": date_from, "dateTo": date_to},
            }
            items.append({
                "id": f"our-product-us-free-{date_to}",
                "type": "休闲游戏监测",
                "title": title,
                "source": "自有产品",
                "platform": "多平台",
                "casualGameCategory": "我方产品",
                "casualGameSource": "our_product",
                "date": date_to,
                "time": "",
                "views": 0,
                "engagement": 0,
                "description": desc,
                "tags": ["我方产品", "SensorTower", "US", "免费榜", "日总结"],
                "language": "zh",
                "reportContent": json.dumps(report_content, ensure_ascii=False),
            })
        return {"items": items}


@router.get("/our-products/analytics")
@_db_cached("us_free_appid_weekly.db")
def our_products_analytics() -> dict[str, Any]:
    with _connect("us_free_appid_weekly.db") as conn:
        base_rows = _rows(
            conn,
            "SELECT internal_name, display_name, rank_date, lower(platform) AS pf, rank, app_id "
            "FROM app_ranks WHERE country = 'US' AND lower(platform) IN ('ios', 'android') AND ("
            "(lower(platform) = 'android' AND chart_type = 'topselling_free' AND category = 'game') OR "
            "(lower(platform) = 'ios' AND chart_type = 'topfreeapplications' AND category = '6014'))",
        )
        by_product: dict[str, dict[str, Any]] = {}
        date_set: set[str] = set()
        for row in base_rows:
            name = str(row["internal_name"] or "").strip()
            date = str(row["rank_date"] or "").strip()[:10]
            if not name or not date:
                continue
            date_set.add(date)
            rec = by_product.setdefault(
                name,
                {
                    "displayName": str(row["display_name"] or name).strip() or name,
                    "byDate": {},
                    "appIdsByDate": {},
                    "seriesByKey": {},
                },
            )
            if row["display_name"]:
                rec["displayName"] = str(row["display_name"]).strip()
            rec["byDate"].setdefault(date, {"ios": None, "android": None})
            rec["appIdsByDate"].setdefault(date, {"ios": "", "android": ""})
            pf = str(row["pf"] or "")
            if pf in {"ios", "android"}:
                rec["byDate"][date][pf] = _norm_rank(row["rank"])
                if row["app_id"]:
                    rec["appIdsByDate"][date][pf] = str(row["app_id"]).strip()

        series_rows = _rows(
            conn,
            "SELECT internal_name, display_name, rank_date, lower(platform) AS pf, lower(device) AS device, "
            "chart_type, category, category_name, rank, app_id FROM app_ranks "
            "WHERE country = 'US' AND lower(platform) IN ('ios', 'android') AND ("
            "(lower(platform) = 'android' AND chart_type = 'topselling_free') OR "
            "(lower(platform) = 'ios' AND chart_type IN ('topfreeapplications', 'topfreeipadapplications')))",
        )
        for row in series_rows:
            name = str(row["internal_name"] or "").strip()
            date = str(row["rank_date"] or "").strip()[:10]
            if not name or not date:
                continue
            rec = by_product.setdefault(
                name,
                {
                    "displayName": str(row["display_name"] or name).strip() or name,
                    "byDate": {},
                    "appIdsByDate": {},
                    "seriesByKey": {},
                },
            )
            pf = str(row["pf"] or "")
            device = str(row["device"] or "")
            chart = str(row["chart_type"] or "")
            category = str(row["category"] or "")
            key = f"{pf}|{device}|{chart}|{category}"
            category_name = str(row["category_name"] or "").strip()
            if not category_name or re.match(r"^category[_ -]?\d+$", category_name, re.I):
                category_name = category or "Unknown"
            if category_name == "all":
                category_name = "All"
            prefix = "iPad" if pf == "ios" and device == "ipad" else ("iPhone" if pf == "ios" else "Android")
            label = f"{prefix} - Free - {category_name.replace('/', ' / ')}"
            series = rec["seriesByKey"].setdefault(
                key,
                {
                    "key": key,
                    "label": label,
                    "platform": pf,
                    "device": device,
                    "chartType": chart,
                    "category": category,
                    "categoryName": category_name,
                    "appId": str(row["app_id"] or "").strip(),
                    "ranksByDate": {},
                },
            )
            if row["app_id"]:
                series["appId"] = str(row["app_id"]).strip()
            series["ranksByDate"][date] = _norm_rank(row["rank"])

        dates = sorted(date_set)[-OUR_PRODUCT_MAX_DATES:]
        products: list[dict[str, Any]] = []
        for internal_name, rec in by_product.items():
            if not any(date in rec["byDate"] for date in dates):
                continue
            by_date = {date: rec["byDate"].get(date, {"ios": None, "android": None}) for date in dates}
            app_ids = {date: rec["appIdsByDate"].get(date, {"ios": "", "android": ""}) for date in dates}
            series = []
            for item in rec["seriesByKey"].values():
                if any(date in item["ranksByDate"] for date in dates):
                    item["ranksByDate"] = {date: item["ranksByDate"].get(date) for date in dates}
                    series.append(item)
            products.append({
                "internalName": internal_name,
                "displayName": rec["displayName"],
                "byDate": by_date,
                "appIdsByDate": app_ids,
                "series": sorted(series, key=lambda item: item["label"]),
            })
        products.sort(key=lambda item: item["displayName"])
        return {"dates": dates, "products": products}
