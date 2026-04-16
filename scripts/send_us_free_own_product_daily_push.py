#!/usr/bin/env python3
"""
从 public/us_free_appid_weekly.db 的 app_ranks 生成「公司自有产品 · SensorTower US 免费榜 · 日总结」
并推送到飞书 / 企业微信（与 scripts/send_wechat_douyin_weekly_push.py 共用 Webhook 环境变量）。

日环比区间来自 weekly_summaries（date_from → date_to），正文按两日在榜名次（前 500）生成上升/下降列表。

用法（项目根目录）：
  python3 scripts/send_us_free_own_product_daily_push.py
  python3 scripts/send_us_free_own_product_daily_push.py --date-to 2026-04-12 --dry-run
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

from feishu_markdown_images import prepare_feishu_card_markdown

DETAIL_LINK = "https://sites.google.com/castbox.fm/overwatch2/home?authuser=1"
SENSORTOWER_OVERVIEW_BASE = "https://app.sensortower-china.com"


def _st_overview_url(app_id: str) -> str:
    if not (app_id or "").strip():
        return ""
    return f"{SENSORTOWER_OVERVIEW_BASE.rstrip('/')}/overview/{app_id.strip()}?country=US"


def _load_env(repo_root: Path) -> None:
    env_path = repo_root / ".env"
    if env_path.exists() and load_dotenv is not None:
        load_dotenv(env_path)
    elif env_path.exists():
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


def _post_json(url: str, payload: dict) -> tuple[int, str]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        return 0, str(e.reason)


def _norm_rank(r) -> int | None:
    if r is None:
        return None
    try:
        n = int(r)
    except (TypeError, ValueError):
        return None
    if n <= 0 or n > 500:
        return None
    return n


def _empty_rank_row() -> dict[str, dict]:
    return {"display": "", "ios": {"rank": None, "app_id": ""}, "android": {"rank": None, "app_id": ""}}


def _load_rank_map(conn: sqlite3.Connection, rank_date: str) -> dict[str, dict]:
    """internal_name -> { display, ios: {rank, app_id}, android: {...} }"""
    cur = conn.execute(
        """
        SELECT internal_name, display_name, lower(platform) AS pf, rank, app_id
        FROM app_ranks
        WHERE country = 'US'
          AND rank_date = ?
          AND lower(platform) IN ('ios', 'android')
          AND (
            (lower(platform) = 'android' AND chart_type = 'topselling_free')
            OR (lower(platform) = 'ios' AND chart_type = 'topfreeapplications')
          )
        """,
        (rank_date,),
    )
    out: dict[str, dict] = {}
    for internal_name, display_name, pf, rank, app_id in cur.fetchall():
        name = str(internal_name or "").strip()
        if not name:
            continue
        disp = str(display_name or "").strip() or name
        if name not in out:
            row = _empty_rank_row()
            row["display"] = disp
            out[name] = row
        else:
            if disp:
                out[name]["display"] = disp
        r = _norm_rank(rank)
        aid = str(app_id or "").strip()
        if pf == "ios":
            out[name]["ios"]["rank"] = r
            if aid:
                out[name]["ios"]["app_id"] = aid
        elif pf == "android":
            out[name]["android"]["rank"] = r
            if aid:
                out[name]["android"]["app_id"] = aid
    return out


def _pick_st_app_id_for_title(rows_group: list[tuple]) -> str:
    """rows: (internal_name, display_name, platform, prev, curr, st_app_id) — 优先 iOS app_id"""
    for r in sorted(rows_group, key=lambda x: (0 if x[2] == "ios" else 1)):
        if r[2] == "ios" and r[5]:
            return str(r[5]).strip()
    for r in rows_group:
        if r[5]:
            return str(r[5]).strip()
    return ""


def _merge_lines(rows: list[tuple[str, str, str, int, int, str]]) -> list[str]:
    """rows: (internal_name, display_name, platform, prev, curr, st_app_id)"""
    by_name: dict[str, list[tuple]] = {}
    for row in rows:
        by_name.setdefault(row[0], []).append(row)

    def max_abs(rs: list[tuple]) -> int:
        return max(abs(a - b) for _, _, _, a, b, _ in rs)

    groups = sorted(by_name.values(), key=max_abs, reverse=True)
    lines: list[str] = []
    for g in groups:
        g2 = sorted(g, key=lambda x: (0 if x[2] == "ios" else 1))
        display = g2[0][1] or g2[0][0]
        link_id = _pick_st_app_id_for_title(g2)
        title = f"[{display}]({_st_overview_url(link_id)})" if link_id else display
        segs = []
        for _, _, plat, prev, curr, _ in g2:
            d = prev - curr
            sign = "+" if d > 0 else ""
            segs.append(f"{plat} {prev}→{curr}（{sign}{d}）")
        lines.append(f"{title}（{'，'.join(segs)}）")
    return lines


def build_compact_markdown(
    conn: sqlite3.Connection,
    date_from: str,
    date_to: str,
    fallback_summary: str | None = None,
) -> str:
    prev_m = _load_rank_map(conn, date_from)
    curr_m = _load_rank_map(conn, date_to)
    names = set(prev_m.keys()) | set(curr_m.keys())
    up_rows: list[tuple[str, str, str, int, int, str]] = []
    down_rows: list[tuple[str, str, str, int, int, str]] = []

    for internal_name in names:
        empty = _empty_rank_row()
        empty["display"] = internal_name
        p = prev_m.get(internal_name) or empty
        c = curr_m.get(internal_name) or {**_empty_rank_row(), "display": p["display"]}
        display_name = str(c["display"] or p["display"] or internal_name)
        for plat_key, lab in (("ios", "ios"), ("android", "android")):
            pr = p[plat_key]["rank"]
            cr = c[plat_key]["rank"]
            st_app_id = str(c[plat_key]["app_id"] or "").strip() or str(p[plat_key]["app_id"] or "").strip()
            if pr is None or cr is None:
                continue
            d = pr - cr
            if d == 0:
                continue
            row = (internal_name, display_name, lab, pr, cr, st_app_id)
            if d > 0:
                up_rows.append(row)
            else:
                down_rows.append(row)

    header = (
        f"公司自有产品 · SensorTower US 免费榜 · 日总结\n\n"
        f"📍 美国 US · 免费榜（iOS/Android）\n\n"
        f"统计口径 · 仅统计各维度入围前 500 名的本公司产品。\n\n"
        f"日环比 · {date_from} → {date_to}\n\n"
        f"详情：[游戏监测网站]({DETAIL_LINK})（密码：guru666）\n\n"
    )

    if not up_rows and not down_rows:
        if fallback_summary and fallback_summary.strip():
            return header + "---\n\n" + fallback_summary.strip()
        return header + "（暂无有效日环比：两日在榜数据不足或排名无变化。）\n"

    up_lines = _merge_lines(up_rows)
    down_lines = _merge_lines(down_rows)
    body: list[str] = ["上升", ""]
    body.extend(f"- {l}" for l in up_lines)
    body.extend(["", "下降", ""])
    body.extend(f"- {l}" for l in down_lines)
    return header + "\n".join(body) + "\n"


WECOM_MARKDOWN_MAX_BYTES = 4096


def _truncate_for_wecom(md: str, max_bytes: int = WECOM_MARKDOWN_MAX_BYTES) -> str:
    data = md.encode("utf-8")
    if len(data) <= max_bytes:
        return md
    suffix = f"\n\n> 内容过长，详见 [游戏监测网站]({DETAIL_LINK})（密码：guru666）。"
    suffix_bytes = suffix.encode("utf-8")
    keep = max_bytes - len(suffix_bytes)
    if keep <= 0:
        return suffix.strip()
    chunk = data[:keep]
    while chunk and (chunk[-1] & 0x80) and not (chunk[-1] & 0x40):
        chunk = chunk[:-1]
    return chunk.decode("utf-8", errors="ignore") + suffix


def send_feishu_card(webhook: str, title: str, body: str) -> bool:
    """仅当 HTTP 200 且响应 JSON 中 code==0 时返回 True。"""
    feishu_md = prepare_feishu_card_markdown(body.replace("\n\n", "\n").strip())
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


def send_wecom_markdown(webhook: str, md_content: str) -> None:
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


def push_message(title: str, body: str) -> None:
    feishu = _clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
    wecom = _clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL")) or _clean_url(os.environ.get("WECOM_WEBHOOK_URL"))
    if not feishu and not wecom:
        print(
            "未配置 Webhook。请在 .env 中设置 FEISHU_WEBHOOK_URL 或 WECOM_WEBHOOK_URL_REAL（或 WECOM_WEBHOOK_URL）",
            file=sys.stderr,
        )
        raise SystemExit(1)
    if feishu:
        if not send_feishu_card(feishu, title, body):
            raise SystemExit(1)
    if wecom:
        send_wecom_markdown(wecom, body)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="推送 US 免费榜我方产品日总结")
    parser.add_argument("--db", type=Path, default=Path("public/us_free_appid_weekly.db"))
    parser.add_argument(
        "--date-to",
        type=str,
        default=None,
        metavar="YYYY-MM-DD",
        help="对应 weekly_summaries.date_to；默认取库中最新一条",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    _load_env(repo_root)
    db_path = repo_root / args.db if not args.db.is_absolute() else args.db
    if not db_path.exists():
        print(f"[错误] 数据库不存在：{db_path}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(str(db_path))
    try:
        if args.date_to:
            cur = conn.execute(
                "SELECT date_from, date_to, summary_text FROM weekly_summaries WHERE date_to = ? ORDER BY id DESC LIMIT 1",
                (args.date_to.strip()[:10],),
            )
        else:
            cur = conn.execute(
                "SELECT date_from, date_to, summary_text FROM weekly_summaries ORDER BY date_to DESC LIMIT 1"
            )
        row = cur.fetchone()
        if not row:
            print("[错误] weekly_summaries 中无数据", file=sys.stderr)
            return 1
        date_from, date_to, summary_text = str(row[0]), str(row[1]), str(row[2] or "")
        md = build_compact_markdown(conn, date_from, date_to, summary_text or None)
    finally:
        conn.close()

    title = f"公司自有产品 US 免费榜日总结-{date_to}"
    if args.dry_run:
        print(f"=== {title}（dry-run）===\n")
        print(md)
        return 0
    push_message(title, md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
