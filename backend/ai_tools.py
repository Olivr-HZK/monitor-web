"""AI 助手工具：SQLite 只读查询、联网搜索、图表渲染（Codex / OpenRouter agent 共用）。"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

OVERSEAS_WEEKLY_DIR = "休闲游戏检测/出海周报"
ALLOWED_PUBLIC_REPORT_PREFIXES = (
    f"{OVERSEAS_WEEKLY_DIR}/",
    "休闲游戏检测/",
)

import httpx

try:
    from config import DATA_SOURCE_DB_PATHS
except Exception:  # pragma: no cover - keeps this module usable in isolated tests.
    DATA_SOURCE_DB_PATHS = {}


def _iter_available_db_paths(public_dir: Path) -> list[tuple[str, Path]]:
    """返回 canonical DB 名到实际路径的映射；源库优先，public 作为兼容回退。"""
    out: list[tuple[str, Path]] = []
    seen: set[str] = set()
    for name, raw_path in sorted(DATA_SOURCE_DB_PATHS.items()):
        db_path = Path(raw_path).resolve()
        if db_path.is_file() and db_path.suffix.lower() == ".db" and not name.startswith("."):
            out.append((name, db_path))
            seen.add(name)
    try:
        public_paths = sorted(public_dir.glob("*.db"))
    except OSError:
        public_paths = []
    for db_path in public_paths:
        if not db_path.is_file() or db_path.name.startswith(".") or db_path.name in seen:
            continue
        out.append((db_path.name, db_path.resolve()))
        seen.add(db_path.name)
    return out


def _build_db_schema_cache(public_dir: Path) -> dict[str, dict[str, list[str]]]:
    """启动时扫描可用 .db 的表结构，缓存为 {db_name: {table: [col1, col2, ...]}}。"""
    cache: dict[str, dict[str, list[str]]] = {}
    for db_name, db_path in _iter_available_db_paths(public_dir):
        tables: dict[str, list[str]] = {}
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            for (tbl,) in cur.fetchall():
                cur.execute(f"PRAGMA table_info([{tbl}])")
                cols = [row[1] for row in cur.fetchall()]
                tables[tbl] = cols
            conn.close()
        except Exception:
            continue
        if tables:
            cache[db_name] = tables
    return cache


def _format_schema_for_prompt(cache: dict[str, dict[str, list[str]]]) -> str:
    """将 Schema 缓存格式化为可注入 system prompt 的文本。"""
    if not cache:
        return ""
    lines: list[str] = ["\n\n【数据库 Schema（已预加载，无需 PRAGMA 探查）】"]
    for db_name, tables in cache.items():
        lines.append(f"\n{db_name}")
        for tbl, cols in tables.items():
            lines.append(f"  {tbl}({', '.join(cols)})")
    return "\n".join(lines)


def _normalize_db_filter(db_names: list[str] | tuple[str, ...] | set[str] | None) -> set[str] | None:
    if not db_names:
        return None
    out = {Path(str(name)).name.strip() for name in db_names if str(name).strip()}
    return out or None


def _clean_html_text(raw: str) -> str:
    text = re.sub(r"<[^>]+>", " ", raw or "")
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_duckduckgo_result_url(raw_href: str) -> str:
    href = unescape((raw_href or "").strip())
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path == "/l/":
        qs = parse_qs(parsed.query)
        uddg = (qs.get("uddg") or [""])[0]
        if uddg:
            return unquote(uddg)
    return href


def _parse_duckduckgo_html_results(html: str, limit: int) -> list[dict[str, Any]]:
    """Parse DuckDuckGo HTML search rows from https://duckduckgo.com/html/."""
    matches = list(
        re.finditer(
            r'<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
            html or "",
            flags=re.IGNORECASE | re.DOTALL,
        )
    )
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for idx, match in enumerate(matches):
        if len(results) >= limit:
            break
        href, title_raw = match.group(1), match.group(2)
        title = _clean_html_text(title_raw)
        url = _normalize_duckduckgo_result_url(href)
        if not title or not url or url in seen:
            continue
        next_start = matches[idx + 1].start() if idx + 1 < len(matches) else len(html or "")
        block = (html or "")[match.end():next_start]
        snippet = ""
        snippet_match = re.search(
            r'<(?:a|div)\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>(.*?)</(?:a|div)>',
            block,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if snippet_match:
            snippet = _clean_html_text(snippet_match.group(1))
        seen.add(url)
        results.append(
            {
                "sourceId": len(results) + 1,
                "title": title,
                "url": url,
                "content": snippet,
            }
        )
    return results


_GAME_VIDEO_QUERY_TRAILING_TERMS = (
    "小游戏",
    "怎么玩",
    "怎么通关",
    "玩法攻略",
    "玩法分析",
    "玩法",
    "攻略",
    "通关",
    "视频号",
    "视频",
    "看看",
    "看一下",
)


def _clean_wechat_video_game_name(raw: str) -> str:
    """Keep the paid video search keyword to the game name only."""
    text = re.sub(r"\s+", " ", (raw or "").strip())
    for term in _GAME_VIDEO_QUERY_TRAILING_TERMS:
        text = text.replace(term, " ")
    text = re.sub(r"\s+", " ", text).strip(" -_，,。:：")
    return text


def _build_wechat_video_search_keyword(game_name: str) -> str:
    return f"{game_name} 小游戏".strip()


def _safe_video_filename(raw: str) -> str:
    stem = re.sub(r"[\\/:*?\"<>|\r\n\t]+", "_", (raw or "").strip())
    stem = re.sub(r"\s+", " ", stem).strip(" ._")[:80] or "wechat_video"
    return stem if stem.lower().endswith(".mp4") else f"{stem}.mp4"


def _extract_wechat_video_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for data_item in payload.get("data") or []:
        if not isinstance(data_item, dict):
            continue
        for sub_box in data_item.get("subBoxes") or []:
            if not isinstance(sub_box, dict):
                continue
            for item in sub_box.get("items") or []:
                if isinstance(item, dict):
                    items.append(item)
    return items


def _wechat_video_source_title(item: dict[str, Any]) -> str:
    source = item.get("source")
    if isinstance(source, dict):
        return str(source.get("title") or "").strip()
    return ""


def _score_wechat_video_item(item: dict[str, Any], game_name: str) -> int:
    title = str(item.get("title") or "").strip()
    source = _wechat_video_source_title(item)
    score = 0
    if item.get("videoUrl"):
        score += 100
    if game_name and game_name in title:
        score += 80
    if game_name and game_name in source:
        score += 20
    if title == game_name:
        score += 15
    return score


def _wechat_video_item_to_public_candidate(item: dict[str, Any], idx: int, game_name: str) -> dict[str, Any]:
    return {
        "sourceId": idx,
        "title": str(item.get("title") or "").strip(),
        "videoUrl": str(item.get("videoUrl") or "").strip(),
        "dateTime": str(item.get("dateTime") or "").strip(),
        "duration": str(item.get("duration") or "").strip(),
        "image": str(item.get("image") or "").strip(),
        "source": _wechat_video_source_title(item),
        "likeNum": item.get("likeNum"),
        "score": _score_wechat_video_item(item, game_name),
    }


def build_data_freshness_text(public_dir: Path) -> str:
    """生成面向模型的数据新鲜度摘要，让回答“最近/最新”时有边界感。"""
    items: list[tuple[float, str, int]] = []
    for db_name, p in _iter_available_db_paths(public_dir):
        try:
            stat = p.stat()
        except OSError:
            continue
        items.append((stat.st_mtime, db_name, stat.st_size))
    if not items:
        return ""
    items.sort(reverse=True)
    lines = ["\n\n【站内数据新鲜度】"]
    newest_ts = items[0][0]
    lines.append(f"- 最新数据文件更新时间：{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(newest_ts))}")
    lines.append("- 回答“最新/最近/本周”类问题时，请优先基于站内数据实际截止时间说明，不要暗示已有今天实时数据。")
    lines.append("- 当前可用数据文件（按更新时间取前 8 个）：")
    for ts, name, size in items[:8]:
        mb = size / 1024 / 1024
        lines.append(f"  - {name}，更新时间 {time.strftime('%Y-%m-%d', time.localtime(ts))}，约 {mb:.1f} MB")
    return "\n".join(lines)


def _validate_public_report_path(public_dir: Path, rel_path: str) -> tuple[str, Path]:
    decoded = rel_path.replace("\\", "/").strip().lstrip("/")
    if not decoded or ".." in decoded:
        raise ValueError("path 非法")
    basename = Path(decoded).name
    if basename.startswith("."):
        raise ValueError("path 非法")
    if not any(decoded.startswith(prefix) for prefix in ALLOWED_PUBLIC_REPORT_PREFIXES):
        raise ValueError("仅允许读取休闲游戏监测目录下的报告文件")
    file_path = (public_dir / decoded).resolve()
    base = public_dir.resolve()
    if os.path.commonpath([str(file_path), str(base)]) != str(base):
        raise ValueError("path 越界")
    if not file_path.is_file():
        raise ValueError(f"报告不存在: {decoded}")
    if file_path.suffix.lower() not in (".json", ".md", ".markdown"):
        raise ValueError("仅支持 .json / .md 报告")
    return decoded, file_path


def _resolve_overseas_weekly_latest(public_dir: Path) -> str:
    index_path = public_dir / OVERSEAS_WEEKLY_DIR / "index.json"
    if not index_path.is_file():
        raise ValueError("出海周报索引不存在")
    try:
        index = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("出海周报索引读取失败") from exc
    reports = index.get("reports") or []
    if not reports:
        raise ValueError("出海周报暂无可用期数")
    return f"{OVERSEAS_WEEKLY_DIR}/{reports[0]}"


def build_overseas_weekly_prompt_block(public_dir: Path) -> str:
    """为 system prompt 注入出海周报索引与读法（数据在 JSON，不在 SQLite）。"""
    index_path = public_dir / OVERSEAS_WEEKLY_DIR / "index.json"
    if not index_path.is_file():
        return ""
    try:
        index = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    reports = [str(name) for name in (index.get("reports") or []) if str(name).strip()]
    if not reports:
        return ""
    lines = [
        "\n\n【每周出海周报（JSON 报告，非 SQLite）】",
        "Puzzle Game 出海市场周报同步自 game daily report2，覆盖竞品、玩法、AI、买量与新兴市场。",
        "请用 read_public_report 读取，不要用 query_sqlite / query_and_chart。",
        f"- 索引路径：{OVERSEAS_WEEKLY_DIR}/index.json",
        f"- 可用期数（新→旧）：{', '.join(reports[:8])}",
        f'- 读最新：read_public_report(path="latest")',
        f'- 读指定期：read_public_report(path="{OVERSEAS_WEEKLY_DIR}/<文件名>")',
    ]
    latest_rel = f"{OVERSEAS_WEEKLY_DIR}/{reports[0]}"
    latest_path = public_dir / latest_rel
    if latest_path.is_file():
        try:
            doc = json.loads(latest_path.read_text(encoding="utf-8"))
            title = str(doc.get("title") or "").strip()
            summary = str(doc.get("summary") or "").strip()
            end_date = str((doc.get("meta") or {}).get("endDate") or doc.get("date") or "").strip()
            if title or summary:
                headline = title or summary
                if end_date:
                    headline = f"{headline}（截至 {end_date}）"
                lines.append(f"- 最新一期速览：{headline}")
        except (OSError, json.JSONDecodeError):
            pass
    return "\n".join(lines)


def _validate_db_name(public_dir: Path, db_raw: str) -> tuple[str, Path]:
    db = Path(db_raw).name.strip()
    if not db or db.startswith(".") or "/" in db or "\\" in db:
        raise ValueError("db 参数非法，仅允许数据库文件名")
    source_path = DATA_SOURCE_DB_PATHS.get(db)
    if source_path:
        db_path = Path(source_path).resolve()
        if db_path.exists() and db_path.suffix.lower() == ".db":
            return db, db_path
        raise ValueError(f"数据库不存在: {db}")
    db_path = (public_dir / db).resolve()
    if not db_path.exists() or db_path.suffix.lower() != ".db":
        raise ValueError(f"数据库不存在: {db}")
    if db_path.parent != public_dir:
        raise ValueError("数据库路径越界")
    return db, db_path


def _prepare_readonly_sql(sql_raw: str, *, allow_pragma_table_info: bool = False) -> tuple[str, bool]:
    sql = sql_raw.strip()
    if sql.endswith(";"):
        sql = sql[:-1].rstrip()
    sql_l = sql.lower().strip()
    pragma_table_info = (
        allow_pragma_table_info
        and re.match(r"^pragma\s+table_info\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\)$", sql_l) is not None
    )
    if not (sql_l.startswith("select") or sql_l.startswith("with") or pragma_table_info):
        raise ValueError("只允许 SELECT / WITH 查询")
    if ";" in sql_l:
        raise ValueError("SQL 包含禁用关键字")
    if not pragma_table_info:
        banned = [
            "insert ",
            "update ",
            "delete ",
            "drop ",
            "alter ",
            "attach ",
            "detach ",
            "vacuum ",
            "replace ",
            "create ",
            "pragma ",
        ]
        if any(k in sql_l for k in banned):
            raise ValueError("SQL 包含禁用关键字")
    return sql, pragma_table_info


def _execute_readonly_query(
    db_path: Path,
    sql: str,
    limit_int: int,
    *,
    params: tuple[Any, ...] = (),
    timeout_sec: float = 5.0,
) -> tuple[list[dict[str, Any]], list[str]]:
    started = time.monotonic()
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=timeout_sec)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON")

        def _progress() -> int:
            return 1 if time.monotonic() - started > timeout_sec else 0

        conn.set_progress_handler(_progress, 2000)
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchmany(limit_int)
        out_rows: list[dict[str, Any]] = [dict(row) for row in rows]
        cols = list(out_rows[0].keys()) if out_rows else [d[0] for d in (cur.description or [])]
        return out_rows, cols
    except sqlite3.OperationalError as e:
        if "interrupted" in str(e).lower():
            raise ValueError("SQL 查询超时，请缩小范围或增加过滤条件") from e
        raise
    finally:
        conn.close()


def _is_number_like(value: Any) -> bool:
    if isinstance(value, bool) or value is None:
        return False
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        if not text:
            return False
        try:
            float(text)
            return True
        except ValueError:
            return False
    return False


_WECHAT_DOUYIN_PROFILE_COLUMNS = (
    "week_range",
    "platform_key",
    "rank",
    "game_name",
    "game_type",
    "platform",
    "source",
    "board_name",
    "monitor_date",
    "publish_time",
    "company",
    "rank_change",
    "region",
    "chart_key",
)


def _to_int_or_none(value: Any) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    m = re.search(r"-?\d+", text)
    if not m:
        return None
    try:
        return int(m.group(0))
    except ValueError:
        return None


def _clean_profile_text(value: Any, fallback: str = "") -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if text in {"", "--", "None", "null"}:
        return fallback
    return text


def _is_loose_name_match(query: str, candidate: str) -> bool:
    q = re.sub(r"\s+", "", query or "")
    c = re.sub(r"\s+", "", candidate or "")
    if not q or not c:
        return False
    if q in c or c in q:
        return True
    pos = 0
    for ch in q:
        found = c.find(ch, pos)
        if found < 0:
            return False
        pos = found + 1
    return True


def _wechat_douyin_row_public(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    rank = _to_int_or_none(row["rank"])
    return {
        "weekRange": _clean_profile_text(row["week_range"]),
        "platformKey": _clean_profile_text(row["platform_key"]),
        "rank": rank,
        "gameName": _clean_profile_text(row["game_name"]),
        "gameType": _clean_profile_text(row["game_type"], "未知"),
        "platform": _clean_profile_text(row["platform"], "未知平台"),
        "source": _clean_profile_text(row["source"]),
        "boardName": _clean_profile_text(row["board_name"], "未知榜单"),
        "monitorDate": _clean_profile_text(row["monitor_date"]),
        "publishTime": _clean_profile_text(row["publish_time"]),
        "company": _clean_profile_text(row["company"], "未记录"),
        "rankChange": _clean_profile_text(row["rank_change"], "未记录"),
        "region": _clean_profile_text(row["region"], "未知"),
        "chartKey": _clean_profile_text(row["chart_key"]),
    }


def _latest_by_platform(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []
    latest_week = max(str(row.get("weekRange") or "") for row in rows)
    latest_rows = [row for row in rows if row.get("weekRange") == latest_week]
    latest_rows.sort(key=lambda row: (str(row.get("platform") or ""), row.get("rank") or 9999, str(row.get("boardName") or "")))
    return latest_rows


def _build_wechat_douyin_chart_payload(game_name: str, rows: list[dict[str, Any]], max_weeks: int) -> dict[str, Any] | None:
    if not rows:
        return None
    week_order = sorted({str(row.get("weekRange") or "") for row in rows if row.get("weekRange")})
    if not week_order:
        return None
    week_order = week_order[-max_weeks:]
    platforms = sorted({str(row.get("platform") or "") for row in rows if row.get("platform")})
    if not platforms:
        return None

    data: list[dict[str, Any]] = []
    for week in week_order:
        point: dict[str, Any] = {"week_range": week}
        week_rows = [row for row in rows if row.get("weekRange") == week]
        for platform in platforms:
            platform_rows = [
                row for row in week_rows
                if row.get("platform") == platform and isinstance(row.get("rank"), int)
            ]
            if not platform_rows:
                continue
            point[platform] = min(int(row["rank"]) for row in platform_rows)
        data.append(point)

    series = [{"key": platform, "name": platform} for platform in platforms if any(platform in point for point in data)]
    if not series:
        return None
    return {
        "type": "line",
        "title": f"{game_name} 微信/抖音排名走势",
        "xKey": "week_range",
        "series": series,
        "data": data,
        "invertYAxis": True,
    }


def _build_wechat_douyin_profile_card(profile: dict[str, Any]) -> dict[str, Any]:
    game_name = _clean_profile_text(profile.get("canonicalName"), "小游戏")
    summary = profile.get("summary") if isinstance(profile.get("summary"), dict) else {}
    latest_rows = [row for row in profile.get("latestRankings") or [] if isinstance(row, dict)]
    signals = [row for row in profile.get("signals") or [] if isinstance(row, dict)]

    intro = (
        f"最新周：{_clean_profile_text(profile.get('latestWeek'), '暂无')}｜"
        f"最高排名：{summary.get('bestRank') or '暂无'}｜"
        f"上榜周数：{summary.get('weeksOnChart') or 0}｜"
        f"平台：{', '.join(summary.get('platforms') or []) or '暂无'}"
    )
    company = _clean_profile_text(summary.get("company"), "未记录")
    game_type = _clean_profile_text(summary.get("gameType"), "未知")

    elements: list[dict[str, Any]] = [
        {
            "tag": "markdown",
            "content": f"{intro}\n开发公司：{company}｜类型：{game_type}",
        }
    ]

    def _table(rows: list[dict[str, Any]], columns: list[tuple[str, str]], empty: str) -> dict[str, Any]:
        visible_rows = rows[:8]
        if not visible_rows:
            return {
                "tag": "table",
                "page_size": 1,
                "row_height": "low",
                "header_style": {"background_style": "grey", "bold": True},
                "columns": [{"name": "message", "display_name": "结果", "data_type": "text"}],
                "rows": [{"message": empty}],
            }
        return {
            "tag": "table",
            "page_size": len(visible_rows),
            "row_height": "low",
            "freeze_first_column": True,
            "header_style": {"background_style": "grey", "bold": True},
            "columns": [
                {"name": key, "display_name": label, "data_type": "text"}
                for key, label in columns
            ],
            "rows": [
                {
                    key: _clean_profile_text(row.get(key), "-")
                    for key, _label in columns
                }
                for row in visible_rows
            ],
        }

    elements.append({"tag": "markdown", "content": "最新上榜"})
    elements.append(
        _table(
            [
                {
                    "platform": row.get("platform"),
                    "board": row.get("boardName"),
                    "rank": row.get("rank"),
                    "change": row.get("rankChange"),
                    "date": row.get("monitorDate"),
                }
                for row in latest_rows
            ],
            [("platform", "平台"), ("board", "榜单"), ("rank", "排名"), ("change", "变化"), ("date", "日期")],
            "暂无上榜记录",
        )
    )

    elements.append({"tag": "markdown", "content": "近期异动"})
    elements.append(
        _table(
            [
                {
                    "week": row.get("weekRange"),
                    "platform": row.get("platform"),
                    "board": row.get("boardName"),
                    "rank": row.get("rank"),
                    "change": row.get("rankChange"),
                }
                for row in signals
            ],
            [("week", "周次"), ("platform", "平台"), ("board", "榜单"), ("rank", "排名"), ("change", "变化")],
            "暂无异动记录",
        )
    )

    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "template": "blue",
            "title": {
                "tag": "plain_text",
                "content": f"{game_name} 小游戏画像",
            },
        },
        "elements": elements,
    }


class AgentToolDispatcher:
    _schema_cache: dict[str, dict[str, list[str]]] | None = None

    def __init__(
        self,
        public_dir: Path,
        tavily_api_key: str = "",
        enable_db_tool: bool = True,
        enable_web_search_tool: bool = True,
        *,
        dajiala_api_key: str = "",
        dajiala_verifycode: str = "",
    ) -> None:
        self.public_dir = public_dir.resolve()
        self.tavily_api_key = (tavily_api_key or "").strip()
        self.dajiala_api_key = (dajiala_api_key or "").strip()
        self.dajiala_verifycode = (dajiala_verifycode or "").strip()
        self.enable_db_tool = enable_db_tool
        self.enable_web_search_tool = enable_web_search_tool
        self.enable_wechat_video_search_tool = bool(self.dajiala_api_key)
        self.chart_payloads: list[dict[str, Any]] = []
        self.table_payloads: list[dict[str, Any]] = []
        self.card_payloads: list[dict[str, Any]] = []
        self.attachment_payloads: list[dict[str, Any]] = []
        if AgentToolDispatcher._schema_cache is None:
            AgentToolDispatcher._schema_cache = _build_db_schema_cache(self.public_dir)

    @classmethod
    def get_schema_text(cls, db_names: list[str] | tuple[str, ...] | set[str] | None = None) -> str:
        if cls._schema_cache is None:
            return ""
        wanted = _normalize_db_filter(db_names)
        if not wanted:
            return _format_schema_for_prompt(cls._schema_cache)
        filtered = {name: tables for name, tables in cls._schema_cache.items() if name in wanted}
        return _format_schema_for_prompt(filtered)

    @classmethod
    def list_db_names(cls) -> list[str]:
        if cls._schema_cache is None:
            return []
        return sorted(cls._schema_cache.keys())

    @classmethod
    def invalidate_schema_cache(cls) -> None:
        cls._schema_cache = None

    async def dispatch(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        if tool_name == "sensortower_game_profile" and self.enable_db_tool:
            return self.sensortower_game_profile(args)
        if tool_name == "wechat_douyin_game_profile" and self.enable_db_tool:
            return self.wechat_douyin_game_profile(args)
        if tool_name == "sensortower_query" and self.enable_db_tool:
            return self.sensortower_query(args)
        if tool_name == "query_and_chart" and self.enable_db_tool:
            return self.query_and_chart(args)
        if tool_name == "query_sqlite" and self.enable_db_tool:
            return self.query_sqlite(args)
        if tool_name == "read_public_report":
            return self.read_public_report(args)
        if tool_name == "web_search" and self.enable_web_search_tool:
            return await self.web_search(args)
        if tool_name == "wechat_video_search" and self.enable_wechat_video_search_tool:
            return await self.wechat_video_search(args)
        if tool_name == "render_chart":
            return self.render_chart(args)
        raise ValueError(f"unknown or disabled tool: {tool_name}")

    # ------------------------------------------------------------------
    #  query_and_chart：查库 + 画图一步完成（推荐优先使用）
    # ------------------------------------------------------------------
    def query_and_chart(self, args: dict[str, Any]) -> dict[str, Any]:
        db_raw = str(args.get("db") or "").strip()
        sql_raw = str(args.get("sql") or "").strip()
        limit = args.get("limit", 50)
        try:
            limit_int = int(limit)
        except Exception:
            limit_int = 50
        limit_int = max(1, min(limit_int, 200))

        chart_type = str(args.get("chartType") or "line").strip().lower()
        if chart_type not in ("line", "bar", "area", "table"):
            chart_type = "line"
        chart_title = str(args.get("chartTitle") or "").strip()
        x_key = str(args.get("xKey") or "").strip()
        series_spec = args.get("series")

        if not db_raw or not sql_raw:
            raise ValueError("db 和 sql 不能为空")

        # --- 查库 ---
        db, db_path = _validate_db_name(self.public_dir, db_raw)
        sql, _ = _prepare_readonly_sql(sql_raw)
        out_rows, cols = _execute_readonly_query(db_path, sql, limit_int)

        # --- 自动推断图表参数 ---
        if not x_key and cols:
            x_key = cols[0]

        if not isinstance(series_spec, list) or len(series_spec) == 0:
            if x_key and cols:
                if chart_type == "table":
                    y_cols = [c for c in cols if c != x_key]
                else:
                    y_cols = [
                        c for c in cols
                        if c != x_key and any(_is_number_like(row.get(c)) for row in out_rows[:20])
                    ]
                series_spec = [{"key": c, "name": c} for c in y_cols]

        validated_series: list[dict[str, Any]] = []
        if isinstance(series_spec, list):
            for s in series_spec:
                if not isinstance(s, dict):
                    continue
                key = str(s.get("key") or "").strip()
                if not key:
                    continue
                if chart_type != "table" and not any(_is_number_like(row.get(key)) for row in out_rows[:20]):
                    continue
                validated_series.append({
                    "key": key,
                    "name": str(s.get("name") or key),
                    "color": str(s.get("color") or "").strip() or None,
                })

        # --- 生成图表 ---
        chart_result: dict[str, Any] | None = None
        if x_key and validated_series and out_rows:
            payload = {
                "type": chart_type,
                "title": chart_title,
                "xKey": x_key,
                "series": validated_series,
                "data": out_rows[:200],
            }
            self.chart_payloads.append(payload)
            chart_result = {
                "rendered": True,
                "chartType": chart_type,
                "title": chart_title,
                "dataPoints": len(out_rows),
                "seriesCount": len(validated_series),
            }

        return {
            "db": db,
            "rowCount": len(out_rows),
            "columns": cols,
            "rows": out_rows,
            "chart": chart_result,
            "hint": "图表已生成，请在文字中简要解读趋势即可，无需重复列出数据点。" if chart_result else "数据已返回，但无法自动生成图表，请用文字总结。",
        }

    # ------------------------------------------------------------------
    #  read_public_report：读取 public 下 JSON/Markdown 周报（如出海周报）
    # ------------------------------------------------------------------
    def read_public_report(self, args: dict[str, Any]) -> dict[str, Any]:
        path_raw = str(args.get("path") or "").strip()
        if not path_raw:
            raise ValueError("path 不能为空")
        if path_raw.lower() in {"latest", "最新", "最新一期"}:
            path_raw = _resolve_overseas_weekly_latest(self.public_dir)
        rel, file_path = _validate_public_report_path(self.public_dir, path_raw)
        try:
            max_chars = int(args.get("maxChars") or 16000)
        except Exception:
            max_chars = 16000
        max_chars = max(1000, min(max_chars, 32000))
        raw_text = file_path.read_text(encoding="utf-8")
        suffix = file_path.suffix.lower()
        if suffix == ".json":
            try:
                doc = json.loads(raw_text)
            except json.JSONDecodeError as exc:
                raise ValueError("JSON 报告解析失败") from exc
            if not isinstance(doc, dict):
                raise ValueError("JSON 报告格式异常")
            content = str(doc.get("content") or "")
            if len(content) > max_chars:
                content = content[:max_chars] + "\n…（内容已截断，可缩小问题范围或指定更早一期）"
            meta = doc.get("meta") if isinstance(doc.get("meta"), dict) else {}
            return {
                "path": rel,
                "title": doc.get("title"),
                "date": doc.get("date"),
                "summary": doc.get("summary"),
                "tags": doc.get("tags"),
                "meta": meta,
                "content": content,
                "hint": "请基于 content 与 summary 回答；对用户不要暴露 path 或内部文件名。",
            }
        text = raw_text
        if len(text) > max_chars:
            text = text[:max_chars] + "\n…（内容已截断）"
        return {"path": rel, "content": text, "hint": "Markdown 源文仅供理解，回复用户时请转为纯文本。"}

    # ------------------------------------------------------------------
    #  query_sqlite：纯查库（保留向后兼容）
    # ------------------------------------------------------------------
    def query_sqlite(self, args: dict[str, Any]) -> dict[str, Any]:
        db_raw = str(args.get("db") or "").strip()
        sql_raw = str(args.get("sql") or "").strip()
        limit = args.get("limit", 50)
        try:
            limit_int = int(limit)
        except Exception:
            limit_int = 50
        limit_int = max(1, min(limit_int, 200))
        if not db_raw or not sql_raw:
            raise ValueError("db 和 sql 不能为空")

        db, db_path = _validate_db_name(self.public_dir, db_raw)
        sql, _ = _prepare_readonly_sql(sql_raw, allow_pragma_table_info=True)
        out_rows, cols = _execute_readonly_query(db_path, sql, limit_int)
        return {
            "db": db,
            "rowCount": len(out_rows),
            "columns": cols,
            "rows": out_rows,
        }

    def sensortower_query(self, args: dict[str, Any]) -> dict[str, Any]:
        from sensortower_tools import SensorTowerQueryTools

        result = SensorTowerQueryTools(self).run(args)
        if result.get("output") == "table_card":
            self.table_payloads.append({
                "title": result.get("title") or "SensorTower 查询结果",
                "cutoff": result.get("cutoff") or "",
                "comparisonPeriod": result.get("comparisonPeriod") or "",
                "columns": result.get("columns") or [],
                "rows": result.get("rows") or [],
                "truncated": bool(result.get("truncated")),
            })
        return result

    def sensortower_game_profile(self, args: dict[str, Any]) -> dict[str, Any]:
        from sensortower_game_profile import run_single_game_profile

        game_name = str(args.get("gameName") or args.get("game") or args.get("name") or "").strip()
        if not game_name:
            raise ValueError("gameName 不能为空")
        country = str(args.get("country") or "WW").strip().upper() or "WW"
        start_date = str(args.get("startDate") or args.get("start_date") or "").strip() or None
        end_date = str(args.get("endDate") or args.get("end_date") or "").strip() or None

        result = run_single_game_profile(
            game_name,
            country=country,
            start_date=start_date,
            end_date=end_date,
        )
        card = result.get("card")
        if isinstance(card, dict):
            self.card_payloads.append(card)
        charts = result.get("charts")
        if isinstance(charts, list):
            self.chart_payloads.extend(chart for chart in charts if isinstance(chart, dict))
        if not result.get("canonicalName") and isinstance(result.get("profile"), dict):
            identity = result["profile"].get("identity") if isinstance(result["profile"].get("identity"), dict) else {}
            result["canonicalName"] = identity.get("canonicalName") or identity.get("query") or game_name
        return {
            "output": result.get("output") or "profile_card",
            "title": result.get("title") or "",
            "canonicalName": result.get("canonicalName") or game_name,
            "publisher": result.get("publisher") or "",
            "period": result.get("period") or {},
            "summary": result.get("summary") or {},
            "rankings": result.get("rankings") or [],
            "chartCount": len(charts) if isinstance(charts, list) else 0,
            "hint": "画像卡片和趋势图已生成；回复用户时只简短解读关键指标，不要提 API 调用数、内部路径或 warning。",
        }

    def wechat_douyin_game_profile(self, args: dict[str, Any]) -> dict[str, Any]:
        game_name = str(args.get("gameName") or args.get("game") or args.get("name") or "").strip()
        if not game_name:
            raise ValueError("gameName 不能为空")
        try:
            max_weeks = int(args.get("maxWeeks") or 8)
        except Exception:
            max_weeks = 8
        max_weeks = max(2, min(max_weeks, 16))

        _db, db_path = _validate_db_name(self.public_dir, "wechatdouyin.db")
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('top20_ranking', 'rank_changes')")
            available_tables = {str(row[0]) for row in cur.fetchall()}
            if "top20_ranking" not in available_tables and "rank_changes" not in available_tables:
                raise ValueError("微信/抖音小游戏榜单数据暂不可用")

            select_cols = ", ".join(_WECHAT_DOUYIN_PROFILE_COLUMNS)
            top_rows: list[sqlite3.Row] = []
            signal_rows: list[sqlite3.Row] = []
            if "top20_ranking" in available_tables:
                cur.execute(
                    f"""
                    SELECT {select_cols}
                    FROM top20_ranking
                    WHERE game_name = ?
                    ORDER BY monitor_date DESC, week_range DESC, CAST(rank AS INTEGER) ASC
                    LIMIT 200
                    """,
                    (game_name,),
                )
                top_rows = list(cur.fetchall())
            if "rank_changes" in available_tables:
                cur.execute(
                    f"""
                    SELECT {select_cols}
                    FROM rank_changes
                    WHERE game_name = ?
                    ORDER BY monitor_date DESC, week_range DESC, CAST(rank AS INTEGER) ASC
                    LIMIT 100
                    """,
                    (game_name,),
                )
                signal_rows = list(cur.fetchall())

            if not top_rows and not signal_rows:
                candidates: list[str] = []
                like = f"%{game_name}%"
                for table in ("top20_ranking", "rank_changes"):
                    if table not in available_tables:
                        continue
                    cur.execute(
                        f"""
                        SELECT DISTINCT game_name
                        FROM {table}
                        WHERE game_name LIKE ?
                        ORDER BY game_name
                        LIMIT 8
                        """,
                        (like,),
                    )
                    for row in cur.fetchall():
                        candidate = _clean_profile_text(row[0])
                        if candidate and candidate not in candidates:
                            candidates.append(candidate)
                    if len(candidates) >= 8:
                        continue
                    cur.execute(
                        f"""
                        SELECT DISTINCT game_name
                        FROM {table}
                        WHERE game_name IS NOT NULL AND game_name != ''
                        ORDER BY game_name
                        LIMIT 2000
                        """
                    )
                    for row in cur.fetchall():
                        candidate = _clean_profile_text(row[0])
                        if (
                            candidate
                            and candidate not in candidates
                            and _is_loose_name_match(game_name, candidate)
                        ):
                            candidates.append(candidate)
                            if len(candidates) >= 8:
                                break
                return {
                    "output": "not_found",
                    "canonicalName": game_name,
                    "candidates": candidates[:8],
                    "hint": "未找到精确游戏名；如有候选，请让用户确认具体游戏名后再查，不要用模糊结果硬凑画像。",
                }

            ranking_rows = [_wechat_douyin_row_public(row) for row in top_rows]
            signal_public_rows = [_wechat_douyin_row_public(row) for row in signal_rows]
            all_rows = ranking_rows or signal_public_rows
            all_rows_sorted = sorted(
                all_rows,
                key=lambda row: (str(row.get("monitorDate") or ""), str(row.get("weekRange") or ""), -(row.get("rank") or 9999)),
                reverse=True,
            )
            latest_week = str(all_rows_sorted[0].get("weekRange") or "") if all_rows_sorted else ""
            latest_rankings = _latest_by_platform(ranking_rows or signal_public_rows)
            ranks = [int(row["rank"]) for row in all_rows if isinstance(row.get("rank"), int)]
            company = next((_clean_profile_text(row.get("company")) for row in all_rows if _clean_profile_text(row.get("company"))), "未记录")
            game_type = next((_clean_profile_text(row.get("gameType")) for row in all_rows if _clean_profile_text(row.get("gameType"))), "未知")
            platforms = sorted({str(row.get("platform") or "") for row in all_rows if row.get("platform")})
            weeks = sorted({str(row.get("weekRange") or "") for row in all_rows if row.get("weekRange")})

            profile = {
                "output": "minigame_profile_card",
                "canonicalName": game_name,
                "latestWeek": latest_week,
                "latestRankings": latest_rankings,
                "signals": signal_public_rows[:12],
                "summary": {
                    "bestRank": min(ranks) if ranks else None,
                    "weeksOnChart": len(weeks),
                    "platforms": platforms,
                    "company": company,
                    "gameType": game_type,
                },
            }
            card = _build_wechat_douyin_profile_card(profile)
            self.card_payloads.append(card)
            chart = _build_wechat_douyin_chart_payload(game_name, ranking_rows, max_weeks)
            if chart:
                self.chart_payloads.append(chart)
            return {
                **profile,
                "signalCount": len(signal_public_rows),
                "chartCount": 1 if chart else 0,
                "hint": "微信/抖音小游戏榜单画像已生成；文字回复简短解读最新排名、趋势和异动即可。不要提数据库、SQL 或内部路径；不要承诺下载量/收入/DAU。",
            }
        finally:
            conn.close()

    # ------------------------------------------------------------------
    #  web_search
    # ------------------------------------------------------------------
    async def web_search(self, args: dict[str, Any]) -> dict[str, Any]:
        query = str(args.get("query") or "").strip()
        max_results = args.get("maxResults", 5)
        try:
            n = int(max_results)
        except Exception:
            n = 5
        n = max(1, min(n, 10))
        if not query:
            raise ValueError("query 不能为空")

        if self.tavily_api_key:
            async with httpx.AsyncClient(timeout=20.0) as client:
                r = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": self.tavily_api_key,
                        "query": query,
                        "max_results": n,
                        "include_answer": True,
                    },
                )
                r.raise_for_status()
                data = r.json()
                results = data.get("results") or []
                return {
                    "query": query,
                    "answer": data.get("answer") or "",
                    "results": [
                        {
                            "sourceId": idx + 1,
                            "title": x.get("title"),
                            "url": x.get("url"),
                            "content": x.get("content"),
                            "publishedDate": x.get("published_date") or x.get("publishedDate") or "",
                        }
                        for idx, x in enumerate(results[:n])
                    ],
                }

        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json", "no_html": "1", "no_redirect": "1"},
            )
            r.raise_for_status()
            data = r.json()

        related = data.get("RelatedTopics") or []
        items: list[dict[str, Any]] = []
        for it in related:
            if len(items) >= n:
                break
            if isinstance(it, dict) and isinstance(it.get("Text"), str):
                items.append(
                    {
                        "sourceId": len(items) + 1,
                        "title": it.get("Text"),
                        "url": it.get("FirstURL") or "",
                    }
                )
            elif isinstance(it, dict) and isinstance(it.get("Topics"), list):
                for sub in it.get("Topics") or []:
                    if len(items) >= n:
                        break
                    if isinstance(sub, dict) and isinstance(sub.get("Text"), str):
                        items.append(
                            {
                                "sourceId": len(items) + 1,
                                "title": sub.get("Text"),
                                "url": sub.get("FirstURL") or "",
                            }
                        )

            if not items:
                html_resp = await client.get(
                    "https://duckduckgo.com/html/",
                    params={"q": query},
                    headers={
                        "User-Agent": (
                            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/125.0 Safari/537.36"
                        )
                    },
                    follow_redirects=True,
                )
                html_resp.raise_for_status()
                items = _parse_duckduckgo_html_results(html_resp.text, n)

        return {
            "query": query,
            "answer": data.get("AbstractText") or "",
            "results": items,
        }

    async def wechat_video_search(self, args: dict[str, Any]) -> dict[str, Any]:
        raw_game_name = str(args.get("gameName") or args.get("keyword") or "").strip()
        game_name = _clean_wechat_video_game_name(raw_game_name)
        if not game_name:
            raise ValueError("gameName 不能为空")
        if not self.dajiala_api_key:
            raise ValueError("DAJIALA_API_KEY 未配置，无法搜索视频号")

        try:
            sort_type = int(args.get("sortType", 0))
        except Exception:
            sort_type = 0
        if sort_type not in (0, 1, 2):
            sort_type = 0

        try:
            publish_time_type = int(args.get("publishTimeType", 3))
        except Exception:
            publish_time_type = 3
        if publish_time_type not in (0, 1, 2, 3):
            publish_time_type = 3

        try:
            max_candidates = int(args.get("maxCandidates", 5))
        except Exception:
            max_candidates = 5
        max_candidates = max(1, min(max_candidates, 10))

        search_keyword = _build_wechat_video_search_keyword(game_name)

        request_body = {
            "mode": 1,
            "keyword": search_keyword,
            "search_type": 2,
            "publish_time_type": publish_time_type,
            "sort_type": sort_type,
            "currentPage": 1,
            "offset": 0,
            "cookies_buffer": "",
            "key": self.dajiala_api_key,
            "verifycode": self.dajiala_verifycode,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                "https://www.dajiala.com/fbmain/monitor/v3/web_search",
                json=request_body,
            )
            r.raise_for_status()
            payload = r.json()

        if isinstance(payload, dict) and payload.get("code") not in (None, 0):
            raise ValueError(f"视频号搜索失败: code={payload.get('code')} msg={payload.get('msg') or payload}")
        if not isinstance(payload, dict):
            raise ValueError("视频号搜索返回非 JSON 对象")

        raw_items = _extract_wechat_video_items(payload)
        candidates = [
            _wechat_video_item_to_public_candidate(item, idx + 1, game_name)
            for idx, item in enumerate(raw_items)
        ]
        candidates.sort(key=lambda item: item.get("score") or 0, reverse=True)
        candidates = candidates[:max_candidates]
        best = next((item for item in candidates if item.get("videoUrl")), None)

        if best:
            attachment = {
                "type": "video_url",
                "url": best["videoUrl"],
                "title": best.get("title") or game_name,
                "source": best.get("source") or "",
                "filename": _safe_video_filename(best.get("title") or game_name),
                "contentType": "video/mp4",
                "expiresIn": "1 day",
            }
            self.attachment_payloads.append(attachment)

        public_request = {key: value for key, value in request_body.items() if key != "key"}
        return {
            "query": game_name,
            "searchKeyword": search_keyword,
            "request": public_request,
            "best": best,
            "candidates": candidates,
            "costHint": "mode=1 按接口文档为 0.5 元/次；本工具固定只查第一页，不自动翻页。",
            "attachmentQueued": bool(best),
        }

    # ------------------------------------------------------------------
    #  render_chart：单独调用（保留向后兼容）
    # ------------------------------------------------------------------
    def render_chart(self, args: dict[str, Any]) -> dict[str, Any]:
        chart_type = str(args.get("type") or "line").strip().lower()
        if chart_type not in ("line", "bar", "area", "table"):
            chart_type = "line"
        title = str(args.get("title") or "").strip()
        x_key = str(args.get("xKey") or "").strip()
        series = args.get("series")
        data_points = args.get("data")

        if not x_key:
            raise ValueError("xKey 不能为空（指定横轴字段名）")
        if not isinstance(data_points, list) or len(data_points) == 0:
            raise ValueError("data 不能为空，需提供数据点数组")

        if not isinstance(series, list) or len(series) == 0:
            if data_points and isinstance(data_points[0], dict):
                non_x_keys = [k for k in data_points[0].keys() if k != x_key]
                series = [{"key": k, "name": k} for k in non_x_keys]
            else:
                raise ValueError("series 不能为空")

        validated_series = []
        for s in series:
            if not isinstance(s, dict):
                continue
            key = str(s.get("key") or "").strip()
            if not key:
                continue
            validated_series.append({
                "key": key,
                "name": str(s.get("name") or key),
                "color": str(s.get("color") or "").strip() or None,
            })

        if not validated_series:
            raise ValueError("至少需要一个有效的 series")

        payload = {
            "type": chart_type,
            "title": title,
            "xKey": x_key,
            "series": validated_series,
            "data": data_points[:200],
        }

        self.chart_payloads.append(payload)

        return {
            "rendered": True,
            "chartType": chart_type,
            "title": title,
            "dataPoints": len(data_points),
            "seriesCount": len(validated_series),
            "hint": "图表已生成，请在文字回复中简要解读图表趋势即可，无需重复列出所有数据点。",
        }


def openai_style_tools_schema(
    enable_db: bool,
    enable_web: bool,
    enable_wechat_video: bool = False,
) -> list[dict[str, Any]]:
    """OpenAI / OpenRouter `tools` 列表（function calling）。"""
    tools: list[dict[str, Any]] = []
    tools.append(
        {
            "type": "function",
            "function": {
                "name": "read_public_report",
                "description": (
                    "读取站内 JSON/Markdown 报告（非 SQLite）。"
                    "休闲游戏「每周出海周报」、Puzzle Game 海外市场动态必须用此工具；"
                    "path 填 latest 读最新一期，或填 index.json 列出的具体文件名（含目录前缀）。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": '如 latest、或 休闲游戏检测/出海周报/weekly_report_YYYY-MM-DD_YYYY-MM-DD.json',
                        },
                        "maxChars": {
                            "type": "integer",
                            "description": "content 最大字符数，默认 16000",
                        },
                    },
                    "required": ["path"],
                },
            },
        }
    )
    if enable_db:
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": "sensortower_game_profile",
                    "description": (
                        "SensorTower 单游戏画像工具。用户说“帮我看看/分析/查一下/看一下某个具体游戏”时优先使用。"
                        "只传游戏名即可，工具会自动解析 iOS/Android app id，调用 SensorTower App Analysis API，"
                        "获取下载量、收入、RPD、平均 DAU、ARPDAU、类别排名等，并生成一张飞书画像卡片。"
                        "不要自己向用户询问 app id，除非工具返回无法识别。"
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "gameName": {
                                "type": "string",
                                "description": "用户提到的游戏名原文，如 Block Blast、Royal Match",
                            },
                            "country": {
                                "type": "string",
                                "description": "国家/地区代码，默认 WW；用户说美国时填 US",
                            },
                            "startDate": {
                                "type": "string",
                                "description": "可选，YYYY-MM-DD；不填则工具取最近完整 30 天",
                            },
                            "endDate": {
                                "type": "string",
                                "description": "可选，YYYY-MM-DD；不填则工具取最近完整 30 天",
                            },
                        },
                        "required": ["gameName"],
                    },
                },
            }
        )
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": "wechat_douyin_game_profile",
                    "description": (
                        "微信/抖音小游戏单游戏榜单画像工具。用户说“帮我看看/分析/查一下/看一下 + 某个微信/抖音小游戏”"
                        "或“某小游戏怎么样”时优先使用。工具基于站内小游戏榜单历史生成画像卡片和排名趋势图，"
                        "包含最新上榜、近几周排名走势、异动摘要、公司/类型等；没有下载量、收入、DAU。"
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "gameName": {
                                "type": "string",
                                "description": "用户提到的小游戏名原文，如 挪了下车、赵云与阿斗",
                            },
                            "maxWeeks": {
                                "type": "integer",
                                "description": "排名走势图最多展示周数，默认 8，最大 16",
                            },
                        },
                        "required": ["gameName"],
                    },
                },
            }
        )
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": "sensortower_query",
                    "description": (
                        "SensorTower 语义查询工具，优先用于 SensorTower/Top100/App Store/Google Play/美国免费榜问题。"
                        "当前支持操作：top_ranking、rank_changes、weekly_sales_trend、removed_games、top5_overview、"
                        "game_lookup、store_changes、metadata_changes、applist_summary、fallback_sql。"
                        "使用受控 SQL 模板与参数/输出策略；fallback_sql 仅作为只读 SQL 兜底，不要向用户暴露 SQL、表名或内部路径。"
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "operation": {
                                "type": "string",
                                "enum": [
                                    "top_ranking",
                                    "rank_changes",
                                    "weekly_sales_trend",
                                    "removed_games",
                                    "top5_overview",
                                    "game_lookup",
                                    "store_changes",
                                    "metadata_changes",
                                    "applist_summary",
                                    "fallback_sql",
                                ],
                                "description": "SensorTower 查询类型",
                            },
                            "platform": {
                                "type": "string",
                                "enum": ["ios", "android"],
                                "description": "平台，iOS 用 ios，Google Play 用 android",
                            },
                            "country": {
                                "type": "string",
                                "description": "国家/地区代码，如 US",
                            },
                            "chartType": {
                                "type": "string",
                                "description": "榜单类型，如 free",
                            },
                            "limit": {
                                "type": "integer",
                                "description": "最多返回行数，默认由工具按操作决定",
                            },
                            "direction": {
                                "type": "string",
                                "description": "rank_changes 可选：rise/fall/new/removed 等方向",
                            },
                            "appId": {
                                "type": "string",
                                "description": "app_id，供 weekly_sales_trend、game_lookup、store_changes、metadata_changes、applist_summary 使用",
                            },
                            "metric": {
                                "type": "string",
                                "enum": ["downloads", "revenue"],
                                "description": "weekly_sales_trend 指标",
                            },
                            "db": {
                                "type": "string",
                                "description": "fallback_sql 专用，只允许 SensorTower 数据库文件名",
                            },
                            "sql": {
                                "type": "string",
                                "description": "fallback_sql 专用，只读 SELECT/WITH SQL",
                            },
                        },
                        "required": ["operation"],
                    },
                },
            }
        )
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": "query_and_chart",
                    "description": (
                        "查询数据库并自动生成可视化图表，一步完成。这是你唯一需要的数据库工具。"
                        "你只需提供 db、sql 和 chartType，系统会查库、自动推断横轴和数据系列并渲染图表。"
                        "返回查询结果和图表状态，你只需用文字简要解读趋势。"
                        "列名已在系统提示的 Schema 中预加载，直接写 SQL 即可。"
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "db": {
                                "type": "string",
                                "description": "数据库文件名，如 wechatdouyin.db、sensortower_top100.db、competitor_data.db、ai_products_ua.db、us_free_appid_weekly.db",
                            },
                            "sql": {"type": "string", "description": "SQL 查询语句（仅 SELECT/WITH）。列名已在系统提示的 Schema 中给出，直接写即可。"},
                            "chartType": {
                                "type": "string",
                                "enum": ["line", "bar", "area", "table"],
                                "description": "图表类型：line=折线图（趋势/时间序列），bar=柱状图（横向对比），area=面积图，table=数据表格。默认 line。",
                            },
                            "chartTitle": {
                                "type": "string",
                                "description": "图表标题，如「Block Blast 近8周排名变化」",
                            },
                            "xKey": {
                                "type": "string",
                                "description": "横轴字段名。不指定则默认取查询结果第一列。如 week_range、rank_date、app_name",
                            },
                            "series": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "key": {"type": "string", "description": "数据字段名"},
                                        "name": {"type": "string", "description": "图例显示名"},
                                        "color": {"type": "string", "description": "可选颜色，如 #FF4500"},
                                    },
                                    "required": ["key", "name"],
                                },
                                "description": "数据系列。不指定则自动取除 xKey 外所有数值列。",
                            },
                            "limit": {"type": "integer", "description": "最多返回行数，默认 50，最大 200"},
                        },
                        "required": ["db", "sql", "chartType"],
                    },
                },
            }
        )
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": "query_sqlite",
                    "description": "仅查询数据库不生成图表。仅在不需要可视化时使用（如只需一个简单数值）。列名已在系统提示的 Schema 中预加载，直接写 SQL 即可。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "db": {
                                "type": "string",
                                "description": "仅文件名",
                            },
                            "sql": {"type": "string", "description": "SQL 查询语句"},
                            "limit": {"type": "integer", "description": "最多返回行数，默认 50，最大 200"},
                        },
                        "required": ["db", "sql"],
                    },
                },
            }
        )
    if enable_web:
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": "web_search",
                    "description": "联网搜索最新信息并返回摘要与链接。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string"},
                            "maxResults": {"type": "integer", "description": "1–10，默认 5"},
                        },
                        "required": ["query"],
                    },
                },
            }
        )
    if enable_wechat_video:
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": "wechat_video_search",
                    "description": (
                        "搜索微信视频号视频，找到最匹配的小游戏视频并排队为飞书视频附件。"
                        "只传游戏名，不要追加“玩法/攻略/怎么玩”等词；工具固定只查第一页以控制成本。"
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "gameName": {
                                "type": "string",
                                "description": "游戏名原文，只填游戏名，例如 脑筋抖一抖",
                            },
                            "sortType": {
                                "type": "integer",
                                "description": "0 综合，1 最新，2 最热；默认 0",
                            },
                            "publishTimeType": {
                                "type": "integer",
                                "description": "0 不限，1 最近1天，2 最近7天，3 最近半年；默认 3",
                            },
                            "maxCandidates": {
                                "type": "integer",
                                "description": "最多返回候选，默认 5，最大 10；不影响 API 只请求第一页",
                            },
                        },
                        "required": ["gameName"],
                    },
                },
            }
        )
    return tools
