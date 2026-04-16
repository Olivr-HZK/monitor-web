#!/usr/bin/env python3
"""
微信/抖音小游戏周报推送（单文件自包含，不依赖本目录其他脚本）。

仅依赖：标准库、可选 python-dotenv、wechatdouyin.db、项目根目录 .env（Webhook）。

用法（项目根目录）：
  python3 scripts/send_wechat_douyin_weekly_push.py
  python3 scripts/send_wechat_douyin_weekly_push.py --date 2026-02-24 --dry-run
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

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

from feishu_markdown_images import prepare_feishu_card_markdown

DETAIL_LINK = "https://sites.google.com/castbox.fm/overwatch2/home?authuser=1"


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

def _clean_url(value: str | None) -> str | None:
    if not value:
        return None
    v = value.replace("\r", "").replace("\n", "").strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1].strip()
    return v if v else None

def _pick_wechatdouyin_week_for_report_date(
    conn: sqlite3.Connection,
    report_date_iso: str,
) -> str | None:
    """
    根据日报日期为微信/抖音榜单选择周区间：
    - 期望锁定到「日期参数的前一周」，即 end_date = report_date - 1 所在的 week_range。
    - week_range 形如 '2026-2-16~2026-2-22' 或 '2026-02-16～2026-02-22'。
    """
    try:
        target_date = datetime.strptime(report_date_iso, "%Y-%m-%d")
    except ValueError:
        return None
    target_end = target_date - timedelta(days=1)

    # 收集所有 week_range
    week_ranges: set[str] = set()
    for table in ("top20_ranking", "rank_changes"):
        try:
            cur = conn.execute(f"SELECT DISTINCT week_range FROM {table}")
            for (w,) in cur.fetchall():
                if w:
                    week_ranges.add(str(w).strip())
        except sqlite3.OperationalError:
            continue

    if not week_ranges:
        return None

    def parse_end_date(week_range: str) -> datetime | None:
        # "2026-2-16~2026-2-22" 或 "2026-2-16～2026-2-22"
        parts = re.split(r"[~～]", week_range)
        if len(parts) < 2:
            return None
        end_str = parts[1].strip()
        if not end_str:
            return None
        try:
            return datetime.strptime(end_str, "%Y-%m-%d")
        except ValueError:
            return None

    candidates: list[tuple[datetime, str]] = []
    for w in week_ranges:
        end_dt = parse_end_date(w)
        if end_dt is None:
            continue
        if end_dt.date() == target_end.date():
            candidates.append((end_dt, w))

    if not candidates:
        return None

    # 若有多个匹配，取 end_date 最大的那个
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


def _minigame_last_week_rank(current: int, change: str) -> int | None:
    raw = (change or "").strip()
    if "新进榜" in raw:
        return None
    is_down = "↓" in raw
    m = re.search(r"\d+", raw)
    if not m:
        return None
    n = int(m.group())
    if n <= 0:
        return None
    return current - n if is_down else current + n


def _minigame_is_new_to_top10(current: int, change: str) -> bool:
    if current < 1 or current > 10:
        return False
    raw = (change or "").strip()
    if "新进榜" in raw:
        return True
    last = _minigame_last_week_rank(current, change)
    if last is None:
        return False
    return last > 10


def _minigame_surge_delta(change: str) -> int:
    raw = (change or "").strip()
    if "新进榜" in raw:
        return -1
    if "↑" not in raw:
        return -1
    m = re.search(r"\d+", raw)
    if not m:
        return -1
    n = int(m.group())
    return n if n > 0 else -1


def _build_wechat_douyin_push(
    conn: sqlite3.Connection,
    target_week_range: str | None = None,
    max_top20: int = 5,
    max_changes: int = 5,
) -> tuple[str, str]:
    """从 wechatdouyin.db 的 rank_changes 构建微信/抖音小游戏周报 Markdown（不再包含 Top20 榜单正文）。
    一、新进 Top10：本周名次在 1–10 且上周不在 Top10（由「新进榜」或 ↑/↓ 推算上周名次）。
    二、本周排名飙升 Top10：按「↑」幅度取前 10（不含新进榜）。
    返回 (markdown, week_range)；无数据时返回 ('', '')。
    target_week_range：若指定则只生成该周；否则取最新一周（按 week_range 排序取最大）。"""
    lines: list[str] = []
    week_range = ""

    def get_latest_week() -> str | None:
        for table in ("top20_ranking", "rank_changes"):
            try:
                cur = conn.execute(
                    f"SELECT DISTINCT week_range FROM {table} ORDER BY week_range DESC LIMIT 1"
                )
                row = cur.fetchone()
                if row and row[0]:
                    return str(row[0]).strip()
            except sqlite3.OperationalError:
                continue
        return None

    if target_week_range and target_week_range.strip():
        week_range = target_week_range.strip()
    else:
        w = get_latest_week()
        if not w:
            return "", ""
        week_range = w

    lines.append(f"# 微信/抖音小游戏周报-{week_range}")
    lines.append("")

    platform_label = {"wx": "微信小游戏", "dy": "抖音小游戏"}

    def _parse_rank_int(rank_raw) -> int | None:
        if rank_raw is None:
            return None
        try:
            return int(str(rank_raw).strip())
        except (TypeError, ValueError):
            return None

    def _format_change_row(r: tuple) -> str:
        rank = r[0] if r[0] is not None else "—"
        name = (r[1] or "—").strip()
        company = (r[2] or "—").strip()
        change = (r[3] or "—").strip()
        pk = (r[4] or "").strip().lower() if len(r) > 4 else ""
        plat = platform_label.get(pk, pk or "—")
        return f"- 排名 {rank}：{name}（{plat}，{company}，变化 {change}）"

    def _append_change_section(
        heading: str,
        section_rows: list,
        *,
        empty_hint: str,
    ) -> None:
        lines.append(heading)
        lines.append("")
        total = len(section_rows)
        if total == 0:
            lines.append(empty_hint)
            lines.append("")
            return
        lines.append(f"共 {total} 条记录，示例 {min(total, max_changes)} 条：")
        lines.append("")
        for r in section_rows[:max_changes]:
            lines.append(_format_change_row(r))
        if total > max_changes:
            lines.append("- ……")
        lines.append("")

    try:
        cur = conn.execute(
            "SELECT rank, game_name, company, rank_change, platform_key FROM rank_changes "
            "WHERE week_range = ? ORDER BY platform_key, CAST(rank AS INTEGER) ASC",
            (week_range,),
        )
        rows = list(cur.fetchall())
        new_top10: list = []
        for r in rows:
            ch = (r[3] or "").strip() if len(r) > 3 else ""
            rk = _parse_rank_int(r[0])
            if rk is not None and _minigame_is_new_to_top10(rk, ch):
                new_top10.append(r)

        new_keys = set()
        for r in new_top10:
            pk = (r[4] or "").strip().lower() if len(r) > 4 else ""
            nm = (r[1] or "").strip()
            new_keys.add((pk, nm))

        surge_scored: list[tuple[tuple, int]] = []
        for r in rows:
            ch = (r[3] or "").strip() if len(r) > 3 else ""
            d = _minigame_surge_delta(ch)
            if d <= 0:
                continue
            pk = (r[4] or "").strip().lower() if len(r) > 4 else ""
            nm = (r[1] or "").strip()
            if (pk, nm) in new_keys:
                continue
            surge_scored.append((r, d))
        surge_scored.sort(key=lambda x: (-x[1], _parse_rank_int(x[0][0]) or 999))
        surge_list = [t[0] for t in surge_scored[:10]]

        if new_top10 or surge_list:
            _append_change_section(
                "## 一、新进 Top10（本周进入 Top10，上周不在 Top10）",
                new_top10,
                empty_hint="本周暂无符合条件的记录。",
            )
            _append_change_section(
                "## 二、本周排名飙升 Top10",
                surge_list,
                empty_hint="本周暂无排名飙升（↑）记录。",
            )
    except sqlite3.OperationalError:
        pass

    if len(lines) <= 2:
        return "", ""

    lines.append("---")
    lines.append("")
    lines.append(f"> 👉 查看当周完整周报：[游戏监测网站]({DETAIL_LINK})（密码：guru666）")
    return "\n".join(lines), week_range


def build_minigame_weekly_report_doc(
    week_range: str,
    content_md: str,
    *,
    title_prefix: str = "微信/抖音小游戏周报",
) -> dict:
    """
    构造「小游戏周报」的 ReportDocument 结构，供前端 WeeklyReportDetail 直接使用。
    注意：这里只返回 dict，写入 JSON 的位置由调用方决定。
    """
    now = datetime.now()
    title = f"{title_prefix}-{week_range}"
    summary = f"{title_prefix}（{week_range}）周榜概览。"
    return {
        "title": title,
        "tags": [title_prefix, "小游戏周报", "微信", "抖音"],
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M"),
        "source": "微信/抖音小游戏榜单",
        "summary": summary,
        "content": content_md,
        "meta": {
            "kind": "minigame_weekly",
            "week_range": week_range,
        },
    }
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

def push_wechat_douyin_message(title: str, body: str) -> None:
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
    parser = argparse.ArgumentParser(description="从 wechatdouyin.db 推送微信/抖音小游戏周报")
    parser.add_argument("--db", type=Path, default=Path("public/wechatdouyin.db"))
    parser.add_argument("--date", type=str, default=None, metavar="YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    _load_env(repo_root)
    db_path = repo_root / args.db if not args.db.is_absolute() else args.db
    if not db_path.exists():
        print(f"[错误] 数据库不存在：{db_path}", file=sys.stderr)
        return 1
    if args.date:
        try:
            datetime.strptime(args.date.strip(), "%Y-%m-%d")
            report_date_iso = args.date.strip()[:10]
        except ValueError:
            print(f"[错误] --date 应为 YYYY-MM-DD：{args.date!r}", file=sys.stderr)
            return 1
    else:
        report_date_iso = datetime.now().strftime("%Y-%m-%d")
    target_week = None
    conn = sqlite3.connect(str(db_path))
    try:
        if args.date:
            target_week = _pick_wechatdouyin_week_for_report_date(conn, report_date_iso)
        wd_md, wd_week = _build_wechat_douyin_push(conn, target_week_range=target_week)
    finally:
        conn.close()
    if not wd_md or not wd_week:
        print("[跳过] wechatdouyin.db 中无可用数据", file=sys.stderr)
        return 1
    title = f"微信/抖音小游戏周报-{wd_week}"
    if args.dry_run:
        print(f"=== {title}（dry-run）===\n")
        print(wd_md)
        return 0
    push_wechat_douyin_message(title, wd_md)
    try:
        weekly_doc = build_minigame_weekly_report_doc(wd_week, wd_md)
        reports_dir = repo_root / "public" / "ai热点"
        reports_dir.mkdir(parents=True, exist_ok=True)
        safe_week = (
            wd_week.replace("～", "~").replace(" ", "").replace("年", "-").replace("月", "-").replace("日", "")
        )
        safe_week = safe_week.replace("~", "_").replace("/", "_")
        json_path = reports_dir / f"minigame_weekly_{safe_week}.json"
        json_path.write_text(json.dumps(weekly_doc, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as e:
        print(f"[警告] 写入 JSON 失败：{e}", file=sys.stderr)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
