"""Feishu interactive card payload builders."""
from __future__ import annotations

import re
from typing import Any


def sanitize_cell(value: Any, *, max_chars: int = 80) -> str:
    """Normalize a table cell for compact Feishu card display."""
    if value is None:
        return ""

    text = re.sub(r"\s+", " ", str(value).replace("\r", " ").replace("\n", " ")).strip()
    if max_chars <= 0:
        return ""
    if len(text) > max_chars:
        return text[: max_chars - 1] + "…"
    return text


def build_table_card(payload: dict[str, Any], *, max_rows: int = 20) -> dict[str, Any]:
    """Build a Feishu interactive card table payload for assistant table output."""
    raw_rows = payload.get("rows") or []
    rows = [row for row in raw_rows if isinstance(row, dict)]
    column_defs = _resolve_columns(payload.get("columns"), rows)
    visible_rows = rows[:max_rows]
    truncated = bool(payload.get("truncated")) or len(rows) > max_rows

    if not column_defs:
        column_defs = [{"key": "message", "label": "结果"}]
        table_rows = [{"message": "暂无数据"}]
    elif not visible_rows:
        table_rows = [{column_defs[0]["key"]: "暂无数据"}]
    else:
        table_rows = [
            {
                column["key"]: sanitize_cell(row.get(column["key"]))
                for column in column_defs
            }
            for row in visible_rows
        ]

    elements = [
        {
            "tag": "markdown",
            "content": _build_intro(payload),
        },
        {
            "tag": "table",
            "page_size": len(table_rows),
            "row_height": "low",
            "freeze_first_column": True,
            "header_style": {
                "background_style": "grey",
                "bold": True,
            },
            "columns": [
                {
                    "name": column["key"],
                    "display_name": sanitize_cell(column["label"], max_chars=24),
                    "data_type": "text",
                }
                for column in column_defs
            ],
            "rows": table_rows,
        },
    ]

    if truncated:
        elements.append(
            {
                "tag": "markdown",
                "content": f"已截断，仅展示前 {len(table_rows)} 行。",
            }
        )

    return {
        "config": {
            "wide_screen_mode": True,
        },
        "header": {
            "template": "turquoise",
            "title": {
                "tag": "plain_text",
                "content": sanitize_cell(payload.get("title") or "查询结果", max_chars=60),
            },
        },
        "elements": elements,
    }


def _resolve_columns(raw_columns: Any, rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    if isinstance(raw_columns, list) and raw_columns:
        columns = [
            {
                "key": sanitize_cell(column.get("key"), max_chars=40),
                "label": sanitize_cell(column.get("label") or column.get("key"), max_chars=40),
            }
            for column in raw_columns
            if isinstance(column, dict) and column.get("key")
        ]
        return columns[:8]

    keys: list[str] = []
    for row in rows:
        for key in row:
            if key not in keys:
                keys.append(key)
            if len(keys) >= 8:
                break
        if len(keys) >= 8:
            break

    return [{"key": key, "label": key} for key in keys]


def _build_intro(payload: dict[str, Any]) -> str:
    details = []
    cutoff = sanitize_cell(payload.get("cutoff"), max_chars=40)
    comparison = sanitize_cell(payload.get("comparisonPeriod"), max_chars=60)
    if cutoff:
        details.append(f"截止：{cutoff}")
    if comparison:
        details.append(f"对比周期：{comparison}")
    return "｜".join(details) if details else "查询结果"
