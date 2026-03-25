#!/usr/bin/env python3
"""
发送「AI 工具竞品动态」简报到飞书和企业微信：
- 数据来源：public/ai产品/ai产品竞品下载量和收益.csv
- 只发送**指定日期**或**最新日期**的一天数据的 TopN 摘要（卡片摘要），不发送完整表格。

使用方式（在项目根目录执行）：
  # 推送「最新日期」数据（CSV 中最大日期，支持 2026-01-26 或 2026-01-26T00:00:00Z 格式）
  python scripts/send_ai_tools_competitor_digest.py

  # 推送指定日期（YYYY-MM-DD）
  python scripts/send_ai_tools_competitor_digest.py --date 2026-01-26

  # 只预览内容，不发送到飞书/企微
  python scripts/send_ai_tools_competitor_digest.py --date 2026-01-26 --dry-run

环境变量（.env 或系统环境）：
  - FEISHU_WEBHOOK_URL：飞书自定义机器人 Webhook
  - WECOM_WEBHOOK_URL_REAL：企业微信自定义机器人 Webhook
  - SENSORTOWER_OVERVIEW_BASE：SensorTower 概览页域名，默认 https://app.sensortower-china.com（产品名会生成可点击链接）
"""

import argparse
import csv
import os
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

try:
    # 复用已有的飞书/企微发送逻辑与适配
    from send_ai_competitor_digest import send_to_feishu, send_to_wechat  # type: ignore
except Exception:  # pragma: no cover
    send_to_feishu = None  # type: ignore[assignment]
    send_to_wechat = None  # type: ignore[assignment]


CSV_DEFAULT = Path("public/ai产品/ai产品竞品下载量和收益.csv")
SENSORTOWER_OVERVIEW_BASE = "https://app.sensortower-china.com"


def _sensortower_overview_url(app_id: str, country: str) -> str:
    """构造 SensorTower 概览页 URL（/overview/{app_id}?country=XX）。"""
    if not (app_id and app_id.strip()):
        return ""
    base = os.environ.get("SENSORTOWER_OVERVIEW_BASE", SENSORTOWER_OVERVIEW_BASE).rstrip("/")
    code = (country or "").strip().upper() or "US"
    return f"{base}/overview/{app_id}?country={code}"


def _load_env(repo_root: Path) -> None:
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


def _clean_url(value: str | None) -> str | None:
    if not value:
        return None
    v = value.replace("\r", "").replace("\n", "").strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1].strip()
    return v if v else None


@dataclass
class AiSalesRow:
    product_name: str
    category: str
    app_id: str
    country: str
    date: str
    android_units: int
    android_revenue: int


def _parse_int(value: str) -> int:
    try:
        v = value.replace(",", "").strip()
        return int(v or "0")
    except Exception:
        return 0


def _date_only(s: str) -> str:
    """从 CSV 的 date（如 2026-01-26T00:00:00Z）或 YYYY-MM-DD 取出 YYYY-MM-DD。"""
    if not s:
        return ""
    s = s.strip()[:10]
    return s if len(s) == 10 and s[4] == "-" and s[7] == "-" else ""


def load_rows(csv_path: Path, date_filter: str | None = None) -> list[AiSalesRow]:
    if not csv_path.exists():
        print(f"[AI竞品动态] CSV 不存在：{csv_path}", file=sys.stderr)
        return []
    want_date = _date_only(date_filter) if date_filter else ""
    rows: list[AiSalesRow] = []
    with csv_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            date_str = (r.get("date") or "").strip()
            if want_date and _date_only(date_str) != want_date:
                continue
            row = AiSalesRow(
                product_name=(r.get("product_name") or "").strip(),
                category=(r.get("category") or "").strip(),
                app_id=(r.get("app_id") or "").strip(),
                country=(r.get("country") or "").strip(),
                date=date_str,
                android_units=_parse_int(r.get("android_units") or "0"),
                android_revenue=_parse_int(r.get("android_revenue") or "0"),
            )
            if not row.product_name:
                continue
            rows.append(row)
    return rows


def pick_latest_date(csv_path: Path) -> str | None:
    """从 CSV 中取最大日期（YYYY-MM-DD）。支持 date 列为 2026-01-26 或 2026-01-26T00:00:00Z。"""
    if not csv_path.exists():
        return None
    dates: set[str] = set()
    with csv_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            d = _date_only((r.get("date") or "").strip())
            if d:
                dates.add(d)
    if not dates:
        return None
    return sorted(dates)[-1]


def aggregate_by_product(rows: list[AiSalesRow]) -> list[dict]:
    """
    按产品聚合下载量/收入：
    - key: product_name
    - 汇总 android_units / android_revenue
    - 保留第一个出现的 category / app_id；country 取该产品收入最高的国家（用于 SensorTower 链接）
    """
    agg: dict[str, dict] = defaultdict(
        lambda: {"name": "", "category": "", "app_id": "", "country": "", "units": 0, "revenue": 0, "best_country_revenue": 0}
    )
    for r in rows:
        key = r.product_name
        item = agg[key]
        item["name"] = key
        if not item["category"] and r.category:
            item["category"] = r.category
        if not item["app_id"] and r.app_id:
            item["app_id"] = r.app_id
        item["units"] += r.android_units
        item["revenue"] += r.android_revenue
        if r.android_revenue and r.android_revenue > item.get("best_country_revenue", 0):
            item["best_country_revenue"] = r.android_revenue
            item["country"] = r.country or "US"
        elif not item["country"] and r.country:
            item["country"] = r.country
    for item in agg.values():
        if not item.get("country"):
            item["country"] = "US"
    # 按收入降序
    data = list(agg.values())
    data.sort(key=lambda x: x["revenue"], reverse=True)
    return data


def format_number(n: int) -> str:
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}K"
    return str(n)


def build_digest_md(date_str: str, items: list[dict], top_n: int = 10) -> str:
    """
    构建 AI 工具竞品动态简报 Markdown：
    - 仅发送指定日期的 TopN 摘要（按收入排序）
    """
    lines: list[str] = []
    lines.append("# AI 工具竞品动态简报")
    lines.append("")
    lines.append(f"**{date_str} 当日** AI 工具竞品下载量和收益 Top {top_n} 摘要：")
    lines.append("")

    if not items:
        lines.append("当日暂无有效数据。")
        return "\n".join(lines)

    for idx, item in enumerate(items[:top_n], start=1):
        name = item.get("name") or "—"
        category = item.get("category") or "—"
        app_id = (item.get("app_id") or "").strip()
        country = item.get("country") or "US"
        units = item.get("units") or 0
        revenue = item.get("revenue") or 0
        units_str = format_number(int(units))
        rev_str = format_number(int(revenue))
        st_url = _sensortower_overview_url(app_id, country) if app_id else ""
        if st_url:
            name_part = f"**[{name}]({st_url})**"
        else:
            name_part = f"**{name}**"
        lines.append(
            f"{idx}. {name_part}（品类：{category}，AppID：{app_id or '—'}）—— "
            f"Android 下载量约 {units_str}，收入约 {rev_str}。"
        )

    lines.append("")
    lines.append("> 以上为 AI 工具竞品当日表现摘要，完整明细与历史趋势请在监测汇总平台查看（密码：guru666）。")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="发送 AI 工具竞品动态简报到飞书和企业微信")
    parser.add_argument(
        "--csv",
        type=Path,
        default=CSV_DEFAULT,
        help="ai产品竞品下载量和收益 CSV 路径（相对仓库根目录），默认 public/ai产品/ai产品竞品下载量和收益.csv",
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        metavar="YYYY-MM-DD",
        help="指定日期，只发送该日数据；不传则使用 CSV 中最大日期",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只构建并打印，不发送到飞书/企业微信",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    _load_env(repo_root)

    csv_path = repo_root / args.csv if not args.csv.is_absolute() else args.csv

    if args.date:
        try:
            datetime.strptime(args.date.strip(), "%Y-%m-%d")
        except ValueError:
            print(f"[错误] --date 格式应为 YYYY-MM-DD，例如 2026-02-24，当前为：{args.date!r}", file=sys.stderr)
            return 1
        target_date = args.date.strip()[:10]
    else:
        latest = pick_latest_date(csv_path)
        if not latest:
            print("[AI竞品动态] CSV 中未找到任何日期字段，无法确定最新日期。", file=sys.stderr)
            return 1
        target_date = latest

    rows = load_rows(csv_path, date_filter=target_date)
    if not rows:
        print(f"[AI竞品动态] {target_date} 当日无数据，跳过发送。", file=sys.stderr)
        return 0

    agg_items = aggregate_by_product(rows)
    md = build_digest_md(target_date, agg_items, top_n=10)

    if args.dry_run:
        print("=== AI 工具竞品动态简报（dry-run）===")
        print(md)
        return 0

    feishu_url = _clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
    wecom_url = _clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL") or os.environ.get("WECOM_WEBHOOK_URL"))

    if not feishu_url and not wecom_url:
        print("未配置 FEISHU_WEBHOOK_URL 或 WECOM_WEBHOOK_URL_REAL/WECOM_WEBHOOK_URL", file=sys.stderr)
        return 1

    title = f"AI 工具竞品动态简报-{target_date}"

    # 若无法复用 send_ai_competitor_digest 的封装，则退回简单文本推送
    if feishu_url:
        if send_to_feishu is not None:
            send_to_feishu(feishu_url, md)  # type: ignore[arg-type]
        else:
            # 简单文本 fallback
            from send_ai_competitor_digest import post_json as _post_json  # type: ignore

            payload = {
                "msg_type": "interactive",
                "card": {
                    "config": {"wide_screen_mode": True},
                    "header": {"title": {"tag": "plain_text", "content": title}, "template": "blue"},
                    "elements": [{"tag": "markdown", "content": md}],
                },
            }
            status, resp = _post_json(feishu_url, payload)  # type: ignore[arg-type]
            if status != 200:
                print(f"[飞书] 发送失败 status={status} resp={resp}", file=sys.stderr)
            else:
                print("[飞书] 发送成功")

    if wecom_url:
        if send_to_wechat is not None:
            send_to_wechat(wecom_url, md)  # type: ignore[arg-type]
        else:
            from send_ai_competitor_digest import post_json as _post_json  # type: ignore

            payload = {"msgtype": "markdown", "markdown": {"content": md}}
            status, resp = _post_json(wecom_url, payload)  # type: ignore[arg-type]
            if status != 200:
                print(f"[企业微信] 发送失败 status={status} resp={resp}", file=sys.stderr)
            else:
                print("[企业微信] 发送成功")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

