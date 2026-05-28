#!/usr/bin/env python3
"""Locate monitor-web game trend data sources for OpenClaw skills.

This script is read-only. It scores known local databases and report files
against a user question, then prints JSON that tells an agent where to look.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sqlite3
import sys
from datetime import datetime
from typing import Any


def find_repo_root(explicit: str = "") -> Path:
    if explicit:
        return Path(explicit).expanduser().resolve()
    here = Path(__file__).resolve()
    for candidate in [here, *here.parents]:
        if (candidate / "public").is_dir() and (candidate / "package.json").exists():
            return candidate
    return here.parents[3]


def iso_mtime(path: Path) -> str:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
    except OSError:
        return ""


def normalize_date(value: Any) -> str:
    """Extract the latest YYYY-MM-DD-like date from a scalar string."""
    text = str(value or "")
    matches = re.findall(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", text)
    if not matches:
        return ""
    normalized = [f"{int(y):04d}-{int(m):02d}-{int(d):02d}" for y, m, d in matches]
    return max(normalized)


def contains_any(text: str, keywords: list[str]) -> list[str]:
    lower = text.lower()
    hits: list[str] = []
    for kw in keywords:
        if kw.lower() in lower:
            hits.append(kw)
    return hits


def quote_ident(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
        (table,),
    ).fetchone()
    return bool(row)


def summarize_table(conn: sqlite3.Connection, table: str, date_col: str | None = None) -> dict[str, Any]:
    if not table_exists(conn, table):
        return {"table": table, "exists": False}
    out: dict[str, Any] = {"table": table, "exists": True}
    try:
        out["rows"] = conn.execute(f"SELECT COUNT(*) FROM {quote_ident(table)}").fetchone()[0]
    except sqlite3.Error:
        out["rows"] = None
    if date_col:
        try:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({quote_ident(table)})").fetchall()]
            if date_col in cols:
                row = conn.execute(
                    f"SELECT MIN({quote_ident(date_col)}), MAX({quote_ident(date_col)}) FROM {quote_ident(table)}"
                ).fetchone()
                out["minDate"] = row[0]
                out["maxDate"] = row[1]
        except sqlite3.Error:
            pass
    return out


SOURCE_DEFS: list[dict[str, Any]] = [
    {
        "id": "wechat_douyin",
        "name": "WeChat/Douyin mini-game rankings",
        "kind": "sqlite",
        "path": "public/wechatdouyin.db",
        "keywords": [
            "微信",
            "抖音",
            "小游戏",
            "小程序",
            "休闲游戏",
            "国内",
            "top20",
            "引力引擎",
            "玩法",
            "新进榜",
            "上升",
            "飙升",
            "排名变化",
            "小游戏榜",
        ],
        "tables": [
            ("top20_ranking", "monitor_date"),
            ("rank_changes", "monitor_date"),
            ("games", "monitor_date"),
            ("weekly_report_simple", "week_range"),
            ("weekly_report_trends", "monitor_date"),
        ],
        "sqlRecipes": [
            {
                "title": "Latest WeChat/Douyin Top20",
                "sql": "WITH latest AS (SELECT MAX(monitor_date) AS d FROM top20_ranking) "
                "SELECT monitor_date, platform_key, rank, game_name, company, rank_change, board_name "
                "FROM top20_ranking WHERE monitor_date = (SELECT d FROM latest) "
                "ORDER BY platform_key, CAST(rank AS INTEGER) LIMIT 40;",
            },
            {
                "title": "Latest rising/new mini-games",
                "sql": "WITH latest AS (SELECT MAX(monitor_date) AS d FROM rank_changes) "
                "SELECT monitor_date, platform_key, rank, game_name, company, rank_change, board_name "
                "FROM rank_changes WHERE monitor_date = (SELECT d FROM latest) "
                "ORDER BY CASE WHEN rank_change = '新进榜' THEN 999 "
                "WHEN rank_change LIKE '↑%' THEN CAST(SUBSTR(rank_change, 2) AS INTEGER) ELSE 0 END DESC, "
                "CAST(rank AS INTEGER) LIMIT 20;",
            },
            {
                "title": "Find one game's recent mini-game ranking rows",
                "sql": "SELECT monitor_date, platform_key, rank, game_name, company, rank_change, board_name "
                "FROM top20_ranking WHERE game_name LIKE '%{game_name}%' "
                "ORDER BY monitor_date DESC, platform_key, CAST(rank AS INTEGER) LIMIT 50;",
            },
        ],
    },
    {
        "id": "sensortower",
        "name": "SensorTower Top100 game rankings",
        "kind": "sqlite",
        "path": "public/sensortower_top100.db",
        "keywords": [
            "sensortower",
            "sensor tower",
            "top100",
            "app store",
            "google play",
            "ios",
            "android",
            "美国",
            "英国",
            "德国",
            "日本",
            "免费榜",
            "畅销榜",
            "商店页",
            "新进",
            "飙升",
            "rank",
            "downloads",
            "revenue",
            "全球",
        ],
        "tables": [
            ("apple_top100", "rank_date"),
            ("android_top100", "rank_date"),
            ("rank_changes", "rank_date_current"),
            ("weekly_top5_overview", "rank_date"),
            ("weekly_metadata_changes", "rank_date"),
            ("appstoreinfo_changes", "rank_date"),
            ("gamestoreinfo_changes", "rank_date"),
        ],
        "sqlRecipes": [
            {
                "title": "Latest SensorTower new entries and surges",
                "sql": "WITH latest AS (SELECT MAX(rank_date_current) AS d FROM rank_changes) "
                "SELECT rc.rank_date_current, rc.platform, rc.country, rc.current_rank, "
                "COALESCE(c.app_name, rc.app_name) AS app_name, rc.last_week_rank, rc.change, "
                "rc.change_type, rc.publisher_name, rc.store_url "
                "FROM rank_changes rc LEFT JOIN app_name_cache c "
                "ON c.app_id = rc.app_id AND UPPER(c.platform) = UPPER(rc.platform) "
                "WHERE rc.rank_date_current = (SELECT d FROM latest) "
                "AND (rc.change_type LIKE '%新进%' OR rc.change_type LIKE '%飙升%') "
                "ORDER BY CASE WHEN rc.change_type LIKE '%新进%' THEN 1 ELSE 2 END, rc.current_rank LIMIT 30;",
            },
            {
                "title": "Latest iOS Top10 snapshots",
                "sql": "WITH latest AS (SELECT MAX(rank_date) AS d FROM apple_top100) "
                "SELECT rank_date, 'iOS' AS platform, country, chart_type, rank, app_name, downloads, revenue "
                "FROM apple_top100 WHERE rank_date = (SELECT d FROM latest) AND rank <= 10 "
                "ORDER BY country, chart_type, rank LIMIT 60;",
            },
            {
                "title": "Latest SensorTower weekly overview",
                "sql": "SELECT rank_date, statement FROM weekly_top5_overview ORDER BY rank_date DESC LIMIT 3;",
            },
        ],
    },
    {
        "id": "competitor",
        "name": "Competitor social and UA weekly reports",
        "kind": "sqlite",
        "path": "public/competitor_data.db",
        "keywords": [
            "竞品",
            "社媒",
            "social",
            "facebook",
            "instagram",
            "tiktok",
            "youtube",
            "线下活动",
            "玩法更新",
            "ua",
            "voodoo",
            "homa",
            "king",
            "dream games",
            "vita",
            "hungry",
        ],
        "tables": [
            ("weekly_reports", "end_date"),
            ("company_platforms", None),
            ("company_tables_index", None),
        ],
        "sqlRecipes": [
            {
                "title": "Latest competitor weekly reports",
                "sql": "SELECT company_name, start_date, end_date, SUBSTR(report_content, 1, 1200) AS excerpt "
                "FROM weekly_reports WHERE end_date = (SELECT MAX(end_date) FROM weekly_reports) "
                "ORDER BY company_name LIMIT 20;",
            },
            {
                "title": "Find competitor reports by company",
                "sql": "SELECT company_name, start_date, end_date, SUBSTR(report_content, 1, 1600) AS excerpt "
                "FROM weekly_reports WHERE LOWER(company_name) LIKE LOWER('%{company}%') "
                "ORDER BY end_date DESC LIMIT 5;",
            },
        ],
    },
    {
        "id": "own_product",
        "name": "Own product SensorTower US free ranking",
        "kind": "sqlite",
        "path": "public/us_free_appid_weekly.db",
        "keywords": [
            "我方",
            "自家",
            "自有产品",
            "公司产品",
            "own product",
            "us free",
            "us免费",
            "美国免费榜",
            "免费榜日总结",
            "日总结",
            "按产品追溯",
            "appid",
            "app id",
            "arrow2",
            "arrow",
            "G-058",
            "产品追溯",
            "竞品排名",
        ],
        "tables": [
            ("weekly_summaries", "date_to"),
            ("app_ranks", "rank_date"),
            ("rank_subjects", None),
        ],
        "sqlRecipes": [
            {
                "title": "Latest own-product US free ranking summary",
                "sql": "SELECT date_from, date_to, product_count, line_count, SUBSTR(summary_text, 1, 1800) AS excerpt "
                "FROM weekly_summaries ORDER BY date_to DESC, id DESC LIMIT 3;",
            },
            {
                "title": "Latest own-product and competitor rank rows",
                "sql": "WITH latest AS (SELECT MAX(rank_date) AS d FROM app_ranks) "
                "SELECT rank_date, display_name, internal_name, product_code, platform, country, chart_type, "
                "category_name, rank FROM app_ranks WHERE rank_date = (SELECT d FROM latest) "
                "ORDER BY product_code DESC, display_name, platform, chart_type, category_name LIMIT 80;",
            },
            {
                "title": "Trace one own product and its competitors",
                "sql": "SELECT rank_date, display_name, internal_name, product_code, platform, country, chart_type, "
                "category_name, rank FROM app_ranks WHERE internal_name LIKE '%{product_or_competitor}%' "
                "ORDER BY rank_date DESC, platform, chart_type, category_name LIMIT 120;",
            },
        ],
    },
]


FILE_GROUPS: list[dict[str, Any]] = [
    {
        "name": "AI hot and mini-game weekly JSON",
        "glob": "public/ai热点/*",
        "keywords": ["ai热点", "ai 热点", "热点", "玩法灵感", "tiktok", "视频", "模板", "minigame", "小游戏"],
    },
    {
        "name": "Trend daily reports",
        "glob": "public/热点/*",
        "keywords": ["热点", "趋势", "tiktok", "视频", "日报", "trending"],
    },
    {
        "name": "Casual game markdown and SensorTower weekly reports",
        "glob": "public/休闲游戏检测/**/*",
        "keywords": ["休闲游戏", "sensortower", "sensor tower", "周报", "玩法", "商店页", "小游戏"],
    },
    {
        "name": "Overseas puzzle game weekly reports",
        "glob": "public/休闲游戏检测/出海周报/*",
        "keywords": ["出海", "出海周报", "海外", "puzzle", "puzzle game", "休闲游戏", "买量", "素材", "玩法机制", "新兴市场", "liveops"],
    },
    {
        "name": "AI product and UA reports",
        "glob": "public/ai产品/*",
        "keywords": ["ai产品", "ai 产品", "ua", "素材", "creative", "广告", "投放"],
    },
]


GENERIC_GAME_TERMS = ["游戏", "趋势", "最近", "最新", "本周", "榜单", "排名", "变化", "周报"]
FILE_GENERIC_TERMS = ["游戏", "小游戏", "趋势", "榜单", "排名", "周报", "日报", "sensortower", "sensor tower", "出海"]
COMPETITOR_TERMS = ["竞品", "社媒", "线下活动", "玩法更新", "voodoo", "homa", "king", "dream games", "vita", "hungry"]
OWN_PRODUCT_TERMS = ["我方", "自家", "自有产品", "公司产品", "own product", "us free", "us免费", "美国免费榜", "日总结", "按产品追溯", "arrow2", "appid", "app id"]
OVERSEAS_TERMS = ["出海", "出海周报", "海外", "puzzle", "买量", "新兴市场", "liveops", "puzzle game"]
NUMBER_QUERY_TERMS = ["多少", "top", "top10", "top 10", "排名", "第几", "榜单", "变化", "上升", "下降", "新进", "飙升", "对比"]
SUMMARY_QUERY_TERMS = ["总结", "趋势", "周报", "日报", "机会", "玩法", "有什么", "怎么看", "解读"]
UA_QUERY_TERMS = ["ua", "素材", "广告", "投放", "creative"]
SITE_LINKS = {
    "wechat_douyin": {"label": "微信/抖音小游戏排行榜", "url": "/rankings/casual/wechat_douyin"},
    "sensortower": {"label": "SensorTower 休闲游戏榜", "url": "/rankings/casual/sensortower"},
    "competitor": {"label": "休闲游戏竞品监测", "url": "/type/休闲游戏监测"},
    "own_product": {"label": "我方产品 · US 免费榜", "url": "/type/休闲游戏监测"},
    "overseas_weekly": {"label": "每周出海周报", "url": "/type/休闲游戏监测"},
    "ai_product": {"label": "AI 产品素材库", "url": "/rankings/ai"},
}


def score_source(query: str, source: dict[str, Any]) -> tuple[int, list[str]]:
    hits = contains_any(query, source["keywords"])
    if source.get("id") == "own_product" and not hits:
        return 0, []
    score = len(hits) * 10
    generic_hits = contains_any(query, GENERIC_GAME_TERMS)
    score += min(len(generic_hits), 4)
    return score, hits


def summarize_sqlite_source(repo_root: Path, source: dict[str, Any]) -> dict[str, Any]:
    db_path = repo_root / source["path"]
    out = {
        "id": source["id"],
        "name": source["name"],
        "kind": source["kind"],
        "path": source["path"],
        "exists": db_path.exists(),
        "modifiedAt": iso_mtime(db_path) if db_path.exists() else "",
        "tables": [],
    }
    if not db_path.exists():
        return out
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            out["tables"] = [summarize_table(conn, table, date_col) for table, date_col in source["tables"]]
        finally:
            conn.close()
    except sqlite3.Error as exc:
        out["error"] = str(exc)
    max_dates = [
        normalize_date(t.get("maxDate"))
        for t in out.get("tables", [])
        if isinstance(t, dict) and normalize_date(t.get("maxDate"))
    ]
    if max_dates:
        out["latestDataDate"] = max(max_dates)
    return out


def file_score(query: str, file_path: Path, group: dict[str, Any]) -> tuple[int, list[str]]:
    hits = contains_any(query, group["keywords"])
    score = len(hits) * 7
    filename = file_path.name.lower()
    for token in re.findall(r"[\w\u4e00-\u9fff]+", query.lower()):
        if len(token) >= 2 and token in filename:
            score += 4
            hits.append(token)
    if any(word in query for word in ("最新", "最近", "本周", "周报", "日报")):
        score += 2
    if "minigame_weekly_" in filename and contains_any(query, ["游戏", "小游戏", "趋势", "周报"]):
        score += 8
    if filename.startswith("weekly_report_") and contains_any(query, OVERSEAS_TERMS + ["周报", "游戏趋势"]):
        score += 10
    if ("周报" in file_path.name or "top5_异动" in filename) and contains_any(query, ["sensortower", "sensor tower", "游戏", "趋势", "周报"]):
        score += 6
    if file_path.suffix.lower() == ".md" and "周报" not in file_path.name and contains_any(query, ["周报", "趋势"]):
        score -= 3
    return score, sorted(set(hits))


def collect_recommended_files(repo_root: Path, query: str, limit: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for group in FILE_GROUPS:
        is_competitor_query = bool(contains_any(query, COMPETITOR_TERMS))
        is_ua_query = bool(contains_any(query, ["ua", "素材", "广告", "投放", "creative"]))
        is_overseas_query = bool(contains_any(query, OVERSEAS_TERMS))
        if is_competitor_query and not (is_ua_query and "AI product" in group["name"]):
            continue
        if is_overseas_query and group["name"] not in {"Overseas puzzle game weekly reports", "Casual game markdown and SensorTower weekly reports"}:
            continue
        for path in repo_root.glob(group["glob"]):
            if not path.is_file() or path.name.startswith("."):
                continue
            if path.suffix.lower() not in {".md", ".json", ".csv"}:
                continue
            score, hits = file_score(query, path, group)
            if score <= 0 and contains_any(query, FILE_GENERIC_TERMS):
                score = 1
            if score <= 0:
                continue
            rel = path.relative_to(repo_root).as_posix()
            items.append(
                {
                    "group": group["name"],
                    "path": rel,
                    "score": score,
                    "matchedKeywords": hits,
                    "fileDate": normalize_date(path.name),
                    "modifiedAt": iso_mtime(path),
                    "why": "Recent/local report file that may contain narrative trend summaries.",
                }
            )
    items.sort(key=lambda x: (x["score"], x.get("fileDate") or "", x["modifiedAt"], x["path"]), reverse=True)
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    group_counts: dict[str, int] = {}
    is_specific_file_focus = bool(
        contains_any(query, OVERSEAS_TERMS + UA_QUERY_TERMS + ["小游戏", "minigame", "sensortower", "sensor tower", "热点日报", "ai产品"])
    )
    def diversity_key(item: dict[str, Any]) -> str:
        path = str(item.get("path") or "")
        if "/出海周报/" in path:
            return "overseas_weekly"
        if "minigame_weekly_" in path:
            return "minigame_weekly"
        if "/sensortower_周报/" in path:
            return "sensortower_weekly"
        return str(item.get("group") or "")

    for item in items:
        path = str(item.get("path") or "")
        if path in seen:
            continue
        group = diversity_key(item)
        if not is_specific_file_focus and group_counts.get(group, 0) >= 2:
            continue
        deduped.append(item)
        seen.add(path)
        group_counts[group] = group_counts.get(group, 0) + 1
        if len(deduped) >= limit:
            break
    return deduped


def infer_query_style(query: str) -> str:
    is_number = bool(contains_any(query, NUMBER_QUERY_TERMS))
    is_summary = bool(contains_any(query, SUMMARY_QUERY_TERMS))
    is_competitor = bool(contains_any(query, COMPETITOR_TERMS))
    is_own_product = bool(contains_any(query, OWN_PRODUCT_TERMS))
    is_overseas = bool(contains_any(query, OVERSEAS_TERMS))
    is_ua = bool(contains_any(query, UA_QUERY_TERMS))
    if is_own_product:
        return "own_product_ranking"
    if is_overseas:
        return "overseas_weekly_summary"
    if is_competitor:
        return "competitor_summary"
    if is_ua:
        return "ua_creative_summary"
    if is_number and is_summary:
        return "hybrid_lookup_then_summary"
    if is_number:
        return "factual_lookup"
    if is_summary:
        return "trend_summary"
    return "general_game_trend_query"


def latest_cutoff(matched: list[dict[str, Any]], reads: list[dict[str, Any]]) -> str:
    dates: list[str] = []
    for item in matched:
        date = normalize_date(item.get("latestDataDate")) or normalize_date(item.get("modifiedAt"))
        if date:
            dates.append(date)
    for item in reads:
        date = normalize_date(item.get("fileDate")) or normalize_date(item.get("modifiedAt"))
        if date:
            dates.append(date)
    return max(dates) if dates else ""


def site_links_for_result(query: str, matched: list[dict[str, Any]], reads: list[dict[str, Any]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    links: list[dict[str, str]] = []

    def add(link_id: str) -> None:
        if link_id in seen:
            return
        link = SITE_LINKS.get(link_id)
        if link:
            links.append(dict(link))
            seen.add(link_id)

    for item in matched:
        source_id = str(item.get("id") or "")
        if source_id:
            add(source_id)
    if contains_any(query, OVERSEAS_TERMS) or any("出海周报" in str(item.get("path", "")) for item in reads):
        add("overseas_weekly")
    if contains_any(query, UA_QUERY_TERMS) or any("ai产品" in str(item.get("path", "")) for item in reads):
        add("ai_product")
    return links[:4]


def build_feishu_reply_plan(query: str, matched: list[dict[str, Any]], reads: list[dict[str, Any]]) -> dict[str, Any]:
    query_style = infer_query_style(query)
    primary = matched[0] if matched else {}
    local_cutoff = latest_cutoff(matched, reads)
    primary_cutoff = normalize_date(primary.get("latestDataDate")) or normalize_date(primary.get("modifiedAt"))
    primary_route = {
        "id": primary.get("id", ""),
        "name": primary.get("name", ""),
        "latestDataDate": primary.get("latestDataDate", ""),
    }
    if query_style == "ua_creative_summary" and reads:
        read_cutoff = latest_cutoff([], reads)
        primary_cutoff = read_cutoff or primary_cutoff
        primary_route = {
            "id": "ai_product",
            "name": "AI product and UA reports",
            "latestDataDate": read_cutoff,
        }
    if query_style in {"trend_summary", "hybrid_lookup_then_summary"} and reads:
        read_cutoff = latest_cutoff([], reads)
        primary_cutoff = max([d for d in (primary_cutoff, read_cutoff) if d], default="")
    if query_style == "overseas_weekly_summary" and reads:
        read_cutoff = latest_cutoff([], reads)
        primary_cutoff = read_cutoff or primary_cutoff
        primary_route = {
            "id": "overseas_weekly",
            "name": "Overseas puzzle game weekly reports",
            "latestDataDate": read_cutoff,
        }
    action_by_style = {
        "factual_lookup": "Run the first relevant sqlRecipes query, then summarize exact rows.",
        "trend_summary": "Read recommendedReads first, then use SQLite recipes for 2-4 evidence points.",
        "hybrid_lookup_then_summary": "Run SQLite recipes for facts, then write a short trend interpretation.",
        "competitor_summary": "Query latest competitor weekly reports first; inspect raw posts only if the weekly report is vague.",
        "ua_creative_summary": "Read AI product/UA reports first; use competitor data only for cross-checking.",
        "own_product_ranking": "Query latest own-product US free ranking summaries first; use app_ranks for product/competitor trace details.",
        "overseas_weekly_summary": "Read the latest overseas weekly JSON report first; use SQLite ranking sources only for supporting evidence.",
        "general_game_trend_query": "Use the highest-scored matched source and mention the data cutoff.",
    }
    return {
        "queryStyle": query_style,
        "primaryRoute": primary_route,
        "dataBoundary": primary_cutoff or local_cutoff,
        "latestLocalDataCutoff": local_cutoff,
        "recommendedNextAction": action_by_style.get(query_style, action_by_style["general_game_trend_query"]),
        "siteLinks": site_links_for_result(query, matched, reads),
        "mustSay": [
            "Start with the conclusion.",
            "Use 3-6 bullets for evidence.",
            "Mention the exact local data cutoff.",
            "Do not expose db names, table names, SQL, local file paths, tokens, or internal implementation details to Feishu users.",
        ],
        "answerTemplate": "结论：...\n\n关键依据：\n1. ...\n2. ...\n3. ...\n\n数据边界：站内数据截至 YYYY-MM-DD。",
    }


def build_result(repo_root: Path, query: str, limit: int) -> dict[str, Any]:
    matched: list[dict[str, Any]] = []
    for source in SOURCE_DEFS:
        score, hits = score_source(query, source)
        if score <= 0 and source.get("id") != "own_product" and contains_any(query, GENERIC_GAME_TERMS):
            score = 1
        if score <= 0:
            continue
        summary = summarize_sqlite_source(repo_root, source)
        summary["score"] = score
        summary["matchedKeywords"] = hits
        summary["sqlRecipes"] = source["sqlRecipes"]
        matched.append(summary)

    if not matched and query.strip():
        for source in SOURCE_DEFS:
            summary = summarize_sqlite_source(repo_root, source)
            summary["score"] = 1
            summary["matchedKeywords"] = []
            summary["sqlRecipes"] = source["sqlRecipes"][:1]
            matched.append(summary)

    matched.sort(key=lambda x: (x.get("score", 0), x.get("latestDataDate", ""), x.get("modifiedAt", "")), reverse=True)
    matched = matched[:limit]

    freshness = []
    for item in matched:
        if item.get("latestDataDate") or item.get("modifiedAt"):
            freshness.append(
                {
                    "source": item["name"],
                    "path": item["path"],
                    "latestDataDate": item.get("latestDataDate", ""),
                    "modifiedAt": item.get("modifiedAt", ""),
                }
            )
    recommended_reads = collect_recommended_files(repo_root, query, limit)

    return {
        "query": query,
        "repoRoot": str(repo_root),
        "matchedSources": matched,
        "recommendedReads": recommended_reads,
        "freshness": freshness,
        "feishuReplyPlan": build_feishu_reply_plan(query, matched, recommended_reads),
        "guidance": [
            "Use matched SQLite sources for numbers, rankings, changes, and comparisons.",
            "Use recommended report files for narrative summaries, weekly reports, and trend interpretation.",
            "Mention exact data cutoff dates in the Feishu reply.",
            "Do not expose db names, table names, SQL, or local paths to normal Feishu users.",
        ],
    }


def to_markdown(result: dict[str, Any]) -> str:
    lines = [f"# Locator Result", "", f"Query: {result.get('query', '')}", ""]
    lines.append("## Matched Sources")
    for src in result.get("matchedSources", []):
        lines.append(f"- {src.get('name')} ({src.get('path')}), score={src.get('score')}, latest={src.get('latestDataDate') or src.get('modifiedAt')}")
    lines.append("")
    lines.append("## Recommended Reads")
    for item in result.get("recommendedReads", []):
        lines.append(f"- {item.get('path')} ({item.get('group')}), modified={item.get('modifiedAt')}")
    lines.append("")
    lines.append("## Guidance")
    for item in result.get("guidance", []):
        lines.append(f"- {item}")
    return "\n".join(lines)


def to_feishu_plan(result: dict[str, Any]) -> str:
    plan = result.get("feishuReplyPlan") or {}
    primary = plan.get("primaryRoute") or {}
    lines = [
        "# Feishu Query Plan",
        "",
        f"Question: {result.get('query', '')}",
        f"Query style: {plan.get('queryStyle', '')}",
        f"Primary route: {primary.get('name', '') or 'n/a'}",
        f"Data cutoff: {plan.get('dataBoundary', '') or 'unknown'}",
        "",
        "Next action:",
        f"- {plan.get('recommendedNextAction', '')}",
        "",
        "Internal sources to inspect:",
    ]
    for src in result.get("matchedSources", [])[:3]:
        lines.append(f"- {src.get('name')} (latest {src.get('latestDataDate') or src.get('modifiedAt')})")
        recipes = src.get("sqlRecipes") or []
        if recipes:
            lines.append(f"  recipe: {recipes[0].get('title')}")
    reads = result.get("recommendedReads") or []
    if reads:
        lines.append("")
        lines.append("Report files to inspect:")
        for item in reads[:4]:
            lines.append(f"- {item.get('path')}")
    links = plan.get("siteLinks") or []
    if links:
        lines.append("")
        lines.append("User-facing links if needed:")
        for link in links:
            lines.append(f"- {link.get('label')}: {link.get('url')}")
    lines.extend([
        "",
        "Answer contract:",
        "- Chinese, Feishu-friendly, under 800 Chinese characters by default.",
        "- Conclusion first, then 3-6 evidence bullets.",
        "- Include exact data cutoff.",
        "- Do not show db/table/SQL/path details to the user.",
    ])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Locate monitor-web game trend data sources.")
    parser.add_argument("--query", "-q", default="", help="User question. Use '-' to read from stdin.")
    parser.add_argument("--root", default="", help="Optional monitor-web repo root.")
    parser.add_argument("--limit", type=int, default=8, help="Max sources/files to return.")
    parser.add_argument("--format", choices=["json", "markdown", "feishu"], default="json")
    args = parser.parse_args(argv)

    query = args.query
    if query == "-" or not query:
        if not sys.stdin.isatty():
            query = sys.stdin.read()
    query = query.strip()
    repo_root = find_repo_root(args.root)
    result = build_result(repo_root, query, max(1, args.limit))
    if args.format == "markdown":
        print(to_markdown(result))
    elif args.format == "feishu":
        print(to_feishu_plan(result))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
