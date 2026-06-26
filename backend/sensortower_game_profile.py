"""SensorTower single-game profile wrapper for the casual Feishu agent."""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from feishu_cards import sanitize_cell


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SINGLE_GAME_SCRIPT = (
    PROJECT_ROOT
    / "pipelines"
    / "monitor-chain"
    / "sensortower"
    / "scripts"
    / "single_game_profile.js"
)
DEFAULT_OUTPUT_ROOT = (
    PROJECT_ROOT
    / "public"
    / "休闲游戏检测"
    / "sensortower_单游戏画像"
    / "agent_runs"
)
logger = logging.getLogger(__name__)


def _safe_slug(value: str) -> str:
    text = re.sub(r"[^\w\s-]+", "", value or "", flags=re.UNICODE)
    text = re.sub(r"[\s_]+", "-", text.strip().lower())
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "game"


def _scrub_output(text: str) -> str:
    return re.sub(r"auth_token=[^&\s]+", "auth_token=***", text or "")


def _node_command() -> str:
    configured = os.environ.get("SENSORTOWER_NODE", "").strip()
    if configured:
        return configured
    if shutil.which("node"):
        return "node"
    for candidate in ("/opt/homebrew/bin/node", "/usr/local/bin/node"):
        if Path(candidate).is_file():
            return candidate
    return "node"


def _format_number(value: Any, digits: int = 0) -> str:
    if value is None or value == "":
        return "N/A"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "N/A"
    if not (number == number):
        return "N/A"
    return f"{number:,.{digits}f}"


def _format_money(value: Any, digits: int = 0) -> str:
    formatted = _format_number(value, digits)
    return "N/A" if formatted == "N/A" else f"${formatted}"


def _metric_line(label: str, value: str) -> str:
    return f"{label}: {value}"


def _metric_field(label: str, value: str) -> dict[str, Any]:
    return {
        "is_short": True,
        "text": {
            "tag": "lark_md",
            "content": f"**{sanitize_cell(label, max_chars=40)}**\n{sanitize_cell(value, max_chars=80)}",
        },
    }


def _number_value(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def _date_label(value: Any) -> str:
    text = str(value or "").strip()
    if "T" in text:
        return text.split("T", 1)[0]
    return text[:10]


def _aggregate_daily(rows: list[Any], field: str) -> list[dict[str, Any]]:
    totals: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        date = _date_label(row.get("date"))
        value = _number_value(row.get(field))
        if not date or value is None:
            continue
        totals[date] = totals.get(date, 0.0) + value
    return [{"date": date, field: round(totals[date], 4)} for date in sorted(totals)]


def _find_graph_data(value: Any) -> list[Any] | None:
    if isinstance(value, dict):
        graph = value.get("graphData")
        if isinstance(graph, list):
            return graph
        for child in value.values():
            found = _find_graph_data(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_graph_data(child)
            if found:
                return found
    return None


def _ranking_series_key(rank: dict[str, Any], used: set[str]) -> str:
    base = sanitize_cell(
        " ".join(
            part
            for part in (
                rank.get("device"),
                rank.get("categoryName") or rank.get("category"),
            )
            if part
        )
        or "排名",
        max_chars=40,
    )
    key = base
    suffix = 2
    while key in used:
        key = f"{base} {suffix}"
        suffix += 1
    used.add(key)
    return key


def build_game_profile_charts(profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert profile time series into Feishu image chart payloads."""
    identity = profile.get("identity") if isinstance(profile.get("identity"), dict) else {}
    title = str(identity.get("canonicalName") or identity.get("query") or "单游戏").strip()
    series_block = profile.get("series") if isinstance(profile.get("series"), dict) else {}
    charts: list[dict[str, Any]] = []

    sales_rows = series_block.get("sales") if isinstance(series_block.get("sales"), list) else []
    downloads = _aggregate_daily(sales_rows, "downloads")
    if downloads:
        charts.append(
            {
                "type": "line",
                "title": f"{title} 下载量趋势",
                "xKey": "date",
                "series": [{"key": "downloads", "name": "下载量", "color": "#E87932"}],
                "data": downloads[-60:],
            }
        )

    revenue = _aggregate_daily(sales_rows, "revenue")
    if revenue:
        charts.append(
            {
                "type": "line",
                "title": f"{title} 收入趋势",
                "xKey": "date",
                "series": [{"key": "revenue", "name": "收入", "color": "#2F7DBD"}],
                "data": revenue[-60:],
            }
        )

    active_rows = series_block.get("activeUsers") if isinstance(series_block.get("activeUsers"), list) else []
    active_users = _aggregate_daily(active_rows, "activeUsers")
    if active_users and any((row.get("activeUsers") or 0) > 0 for row in active_users):
        charts.append(
            {
                "type": "line",
                "title": f"{title} 平均 DAU 趋势",
                "xKey": "date",
                "series": [{"key": "activeUsers", "name": "DAU", "color": "#10B981"}],
                "data": active_users[-60:],
            }
        )

    rank_data: dict[str, dict[str, float]] = {}
    rank_series: list[dict[str, str]] = []
    used_keys: set[str] = set()
    for rank in (profile.get("rankings") or [])[:6]:
        if not isinstance(rank, dict):
            continue
        graph = _find_graph_data(rank.get("series"))
        if not graph:
            continue
        key = _ranking_series_key(rank, used_keys)
        rank_series.append({"key": key, "name": key})
        for point in graph:
            if not isinstance(point, list) or len(point) < 2:
                continue
            ts = _number_value(point[0])
            value = _number_value(point[1])
            if ts is None or value is None:
                continue
            date = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
            rank_data.setdefault(date, {"date": date})[key] = value

    if rank_data and rank_series:
        charts.append(
            {
                "type": "line",
                "title": f"{title} 类别排名趋势",
                "xKey": "date",
                "series": rank_series,
                "data": [rank_data[date] for date in sorted(rank_data)][-60:],
                "invertYAxis": True,
                "yAxisHint": "排名数字越小越靠前",
            }
        )

    return charts


def _rank_rows(profile: dict[str, Any]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for rank in (profile.get("rankings") or [])[:8]:
        if not isinstance(rank, dict):
            continue
        rows.append(
            {
                "platform": sanitize_cell(rank.get("os") or "N/A", max_chars=24),
                "device": sanitize_cell(rank.get("device") or "", max_chars=24),
                "category": sanitize_cell(rank.get("categoryName") or rank.get("category") or "N/A", max_chars=36),
                "rank": sanitize_cell(f"#{rank.get('latestRank')}" if rank.get("latestRank") else "N/A", max_chars=16),
            }
        )
    return rows


def build_game_profile_card(profile: dict[str, Any]) -> dict[str, Any]:
    """Build one Feishu interactive card that mirrors the app overview surfaces."""
    identity = profile.get("identity") if isinstance(profile.get("identity"), dict) else {}
    period = profile.get("period") if isinstance(profile.get("period"), dict) else {}
    summary = profile.get("summary") if isinstance(profile.get("summary"), dict) else {}
    title = identity.get("canonicalName") or identity.get("query") or "单游戏画像"

    ios_ids = ", ".join(str(x) for x in (identity.get("iosAppIds") or []) if str(x).strip()) or "N/A"
    android_ids = ", ".join(str(x) for x in (identity.get("androidAppIds") or []) if str(x).strip()) or "N/A"
    period_text = " 至 ".join(
        part for part in (str(period.get("startDate") or ""), str(period.get("endDate") or "")) if part
    )
    if period.get("country"):
        period_text = f"{period_text or 'N/A'} / {period.get('country')}"

    metric_fields = [
        _metric_field("下载量", _format_number(summary.get("downloads"))),
        _metric_field("收入", _format_money(summary.get("revenue"))),
        _metric_field("RPD", _format_money(summary.get("rpd"), 4)),
        _metric_field("平均 DAU", _format_number(summary.get("averageDau"))),
        _metric_field("ARPDAU", _format_money(summary.get("arpdau"), 4)),
    ]
    if summary.get("timeSpentSeconds") is not None:
        metric_fields.append(_metric_field("花费时间", f"{_format_number(summary.get('timeSpentSeconds'))} 秒"))
    if summary.get("websiteVisits") is not None:
        metric_fields.append(_metric_field("网站访问量", _format_number(summary.get("websiteVisits"))))

    elements: list[dict[str, Any]] = [
        {
            "tag": "markdown",
            "content": "\n".join(
                [
                    f"周期: {period_text or 'N/A'}",
                    f"发行商: {sanitize_cell(identity.get('publisher') or 'N/A', max_chars=80)}",
                    f"iOS App ID: {sanitize_cell(ios_ids, max_chars=80)}",
                    f"Android App ID: {sanitize_cell(android_ids, max_chars=80)}",
                    f"识别置信度: {sanitize_cell(identity.get('confidence') or 'N/A', max_chars=40)}",
                ]
            ),
        },
        {"tag": "hr"},
        {
            "tag": "div",
            "fields": metric_fields,
        },
    ]

    rank_rows = _rank_rows(profile)
    if rank_rows:
        elements.extend(
            [
                {"tag": "hr"},
                {
                    "tag": "table",
                    "page_size": len(rank_rows),
                    "row_height": "low",
                    "freeze_first_column": True,
                    "header_style": {"background_style": "grey", "bold": True},
                    "columns": [
                        {"name": "platform", "display_name": "平台", "data_type": "text"},
                        {"name": "device", "display_name": "设备", "data_type": "text"},
                        {"name": "category", "display_name": "榜单", "data_type": "text"},
                        {"name": "rank", "display_name": "最新排名", "data_type": "text"},
                    ],
                    "rows": rank_rows,
                },
            ]
        )

    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "template": "turquoise",
            "title": {
                "tag": "plain_text",
                "content": sanitize_cell(f"游戏之神｜{title} 单游戏画像", max_chars=60),
            },
        },
        "elements": elements,
    }


def _log_profile_diagnostics(profile: dict[str, Any], json_path: Path) -> None:
    identity = profile.get("identity") if isinstance(profile.get("identity"), dict) else {}
    period = profile.get("period") if isinstance(profile.get("period"), dict) else {}
    api_calls = profile.get("apiCalls") if isinstance(profile.get("apiCalls"), list) else []
    warnings = [str(item) for item in (profile.get("warnings") or []) if str(item).strip()]
    logger.info(
        "SensorTower game profile diagnostics game=%s country=%s period=%s..%s api_calls=%s warnings=%s json=%s",
        identity.get("canonicalName") or identity.get("query") or "",
        period.get("country") or "",
        period.get("startDate") or "",
        period.get("endDate") or "",
        len(api_calls),
        "；".join(warnings) if warnings else "none",
        json_path,
    )


def run_single_game_profile(
    game_name: str,
    *,
    country: str = "WW",
    start_date: str | None = None,
    end_date: str | None = None,
    output_root: Path | str | None = None,
    timeout_sec: int = 180,
) -> dict[str, Any]:
    """Run the existing Node SensorTower workflow and return a Feishu-ready payload."""
    clean_game_name = str(game_name or "").strip()
    if not clean_game_name:
        raise ValueError("gameName 不能为空")
    if not SINGLE_GAME_SCRIPT.is_file():
        raise ValueError(f"单游戏画像脚本不存在: {SINGLE_GAME_SCRIPT}")

    root = Path(output_root) if output_root else DEFAULT_OUTPUT_ROOT
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    out_dir = root / f"{_safe_slug(clean_game_name)}-{run_id}"
    node_bin = _node_command()
    cmd = [
        node_bin,
        str(SINGLE_GAME_SCRIPT),
        clean_game_name,
        "--country",
        str(country or "WW").upper(),
        "--out-dir",
        str(out_dir),
    ]
    if start_date:
        cmd.extend(["--start-date", str(start_date)])
    if end_date:
        cmd.extend(["--end-date", str(end_date)])
    if os.environ.get("SENSORTOWER_GAME_PROFILE_DRY_RUN", "").strip() in {"1", "true", "TRUE", "yes"}:
        cmd.append("--dry-run")

    completed = subprocess.run(
        cmd,
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        check=False,
    )
    if completed.returncode != 0:
        detail = _scrub_output("\n".join(part for part in (completed.stdout, completed.stderr) if part))
        raise RuntimeError(f"SensorTower 单游戏画像生成失败: {detail[:1000]}")

    json_files = sorted(out_dir.glob("game_profile_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not json_files:
        detail = _scrub_output(completed.stdout + "\n" + completed.stderr)
        raise RuntimeError(f"SensorTower 单游戏画像未生成 JSON: {detail[:1000]}")

    profile = json.loads(json_files[0].read_text(encoding="utf-8"))
    _log_profile_diagnostics(profile, json_files[0])
    card = build_game_profile_card(profile)
    charts = build_game_profile_charts(profile)
    identity = profile.get("identity") if isinstance(profile.get("identity"), dict) else {}
    return {
        "output": "profile_card",
        "title": card["header"]["title"]["content"],
        "canonicalName": identity.get("canonicalName") or identity.get("query") or clean_game_name,
        "publisher": identity.get("publisher") or "",
        "period": profile.get("period") or {},
        "summary": profile.get("summary") or {},
        "rankings": profile.get("rankings") or [],
        "apiCallCount": len(profile.get("apiCalls") or []),
        "warnings": profile.get("warnings") or [],
        "jsonPath": str(json_files[0]),
        "markdownPath": str(profile.get("markdownPath") or ""),
        "profile": profile,
        "card": card,
        "charts": charts,
        "hint": "画像卡片已生成并会由系统发送；文字回复只需简短解读关键指标，不要重复整张卡片。",
    }
