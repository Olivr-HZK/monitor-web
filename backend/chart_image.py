"""将 agent 图表 payload 渲染为 PNG，供飞书等渠道发送。"""
from __future__ import annotations

from io import BytesIO
from typing import Any


DEFAULT_COLORS = ("#0055FF", "#FF4500", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899")


def render_chart_png(chart: dict[str, Any]) -> bytes | None:
    """把 query_and_chart 的 payload 渲染成 PNG 字节；失败时返回 None。"""
    chart_type = str(chart.get("type") or "line").strip().lower()
    if chart_type == "table":
        return None
    data = chart.get("data")
    x_key = str(chart.get("xKey") or "").strip()
    series = chart.get("series")
    if not isinstance(data, list) or not data or not x_key or not isinstance(series, list) or not series:
        return None

    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return None

    plt.rcParams["font.sans-serif"] = [
        "PingFang SC",
        "Heiti SC",
        "Arial Unicode MS",
        "Noto Sans CJK SC",
        "DejaVu Sans",
    ]
    plt.rcParams["axes.unicode_minus"] = False

    fig, ax = plt.subplots(figsize=(8.5, 4.5), dpi=120)
    title = str(chart.get("title") or "").strip()
    if title:
        ax.set_title(title, fontsize=12, pad=10)

    x_vals = [str(row.get(x_key, "")) for row in data if isinstance(row, dict)]
    plotted = False
    for idx, spec in enumerate(series):
        if not isinstance(spec, dict):
            continue
        key = str(spec.get("key") or "").strip()
        if not key:
            continue
        name = str(spec.get("name") or key)
        color = str(spec.get("color") or "").strip() or DEFAULT_COLORS[idx % len(DEFAULT_COLORS)]
        y_vals: list[float | None] = []
        for row in data:
            if not isinstance(row, dict):
                y_vals.append(None)
                continue
            raw = row.get(key)
            try:
                y_vals.append(float(raw) if raw is not None and raw != "" else None)
            except (TypeError, ValueError):
                y_vals.append(None)
        if not any(v is not None for v in y_vals):
            continue
        plotted = True
        if chart_type == "bar":
            ax.bar(x_vals, [v if v is not None else 0 for v in y_vals], label=name, color=color, alpha=0.85)
        elif chart_type == "area":
            ax.plot(x_vals, y_vals, label=name, color=color, linewidth=2)
            ax.fill_between(range(len(x_vals)), y_vals, alpha=0.12, color=color)
        else:
            ax.plot(x_vals, y_vals, label=name, color=color, linewidth=2, marker="o", markersize=4)

    if not plotted:
        plt.close(fig)
        return None

    if bool(chart.get("invertYAxis")):
        ax.invert_yaxis()
    ax.grid(True, linestyle="--", alpha=0.35)
    ax.legend(loc="best", fontsize=9)
    ax.tick_params(axis="x", labelrotation=28, labelsize=8)
    ax.tick_params(axis="y", labelsize=8)
    fig.tight_layout()

    buf = BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
