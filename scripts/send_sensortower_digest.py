#!/usr/bin/env python3
"""
从 sensortower_top100.db 生成 SensorTower 榜单简报，并通过飞书 / 企业微信机器人推送。

目前仅关注 SensorTower，两块内容：
  1）本周美国 iOS / Android 免费榜「新进榜」Top3（与前端卡片逻辑一致）
  2）Top100 应用的商店页变化（来自 appstoreinfo_changes / gamestoreinfo_changes）

使用方式（在项目根目录）：
  python scripts/send_sensortower_digest.py
  可选参数：
    --db  指定 sensortower_top100.db 路径，默认 public/sensortower_top100.db

依赖：
  - python-dotenv（加载 .env）
  - 使用 send_ai_competitor_digest.py 中已经实现的 send_to_feishu / send_to_wechat
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

from dotenv import load_dotenv

from send_ai_competitor_digest import send_to_feishu, send_to_wechat


def format_number(n: float | int | None) -> str:
  """格式化数字：过万显示为 x.xx万，否则千分位。"""
  if n is None:
    return "—"
  try:
    n = float(n)
  except (TypeError, ValueError):
    return str(n)
  if n >= 10000:
    return f"{n / 10000:.2f}万"
  return f"{int(n):,}"


def format_revenue(r: float | int | None) -> str:
  """收入格式化，单位按美元假设：>=1万 显示 x.xx 万。"""
  if r is None:
    return "—"
  try:
    r = float(r)
  except (TypeError, ValueError):
    return str(r)
  if r >= 10000:
    return f"${r / 10000:.2f}万"
  return f"${r:,.0f}"


def get_new_top3(conn: sqlite3.Connection) -> tuple[str | None, list[dict]]:
  """
  从 rank_changes 中取最新一周美国新进 Top50 里的 Top3（按 current_rank），并补充商店信息。
  返回：(latest_date, rows)
  """
  cur = conn.cursor()

  cur.execute(
    """
    SELECT rank_date_current
    FROM rank_changes
    WHERE country = '🇺🇸 美国'
      AND change_type = '🆕 新进榜单'
      AND current_rank <= 50
    ORDER BY rank_date_current DESC
    LIMIT 1
    """
  )
  row = cur.fetchone()
  if not row:
    return None, []

  latest_date = row[0]

  cur.execute(
    """
    SELECT app_id, app_name, country, platform, current_rank, downloads, revenue, publisher_name, store_url
    FROM rank_changes
    WHERE rank_date_current = ?
      AND country = '🇺🇸 美国'
      AND change_type = '🆕 新进榜单'
      AND current_rank <= 50
    ORDER BY current_rank ASC
    LIMIT 3
    """,
    (latest_date,),
  )
  rows = cur.fetchall()

  result: list[dict] = []
  for app_id, app_name, country, platform, current_rank, downloads, revenue, publisher_name, store_url in rows:
    platform_norm = "iOS" if str(platform).upper() == "IOS" else "Android"

    store_info: dict | None = None
    name_from_store: str | None = None
    dev_from_store: str | None = None

    if platform_norm == "iOS":
      cur.execute(
        """
        SELECT app_name, developer, store_url
        FROM appstoreinfo
        WHERE app_id = ?
        LIMIT 1
        """,
        (app_id,),
      )
      s = cur.fetchone()
      if s:
        name_from_store, dev_from_store, store_url_store = s
        store_info = {
          "name": name_from_store,
          "developer": dev_from_store,
          "store_url": store_url_store,
        }
    else:
      cur.execute(
        """
        SELECT title, developer, installs, store_url
        FROM gamestoreinfo
        WHERE app_id = ?
        LIMIT 1
        """,
        (app_id,),
      )
      s = cur.fetchone()
      if s:
        title, dev, installs, store_url_store = s
        name_from_store = title
        dev_from_store = dev
        store_info = {
          "name": title,
          "developer": dev,
          "installs": installs,
          "store_url": store_url_store,
        }

    display_name = name_from_store or app_name or app_id
    dev = dev_from_store or publisher_name

    result.append(
      {
        "app_id": app_id,
        "name": display_name,
        "developer": dev or "—",
        "country": country,
        "platform": platform_norm,
        "current_rank": current_rank,
        "downloads": downloads,
        "revenue": revenue,
        "store_url": (store_info or {}).get("store_url") or store_url,
        "total_installs": (store_info or {}).get("installs"),
      }
    )

  return latest_date, result


def parse_changes_json(changes_json: str) -> list[str]:
  """
  解析 changes_json，只指出「哪些字段有变化」，不展开具体 old/new 内容。
  示例输出：["rating 有更新", "screenshot_urls 有更新"]
  """
  # 1）优先尝试当作 JSON 解析
  try:
    data = json.loads(changes_json)
  except Exception:  # noqa: BLE001
    data = None

  fields: set[str] = set()
  if isinstance(data, dict):
    for field, val in data.items():
      # 只要字段存在且结构非空，就认为该字段有更新
      if val is not None:
        fields.add(str(field))
  elif isinstance(data, list):
    # list 结构时不太好区分字段，退回正则方案
    pass

  # 2）如果 JSON 解析不了，或无法得到字段名，则用正则从原始字符串粗略提取 key
  if not fields:
    import re

    # 匹配形如 field: 或 "field":
    for m in re.finditer(r'["\']?([A-Za-z0-9_]+)["\']?\s*:', changes_json):
      fields.add(m.group(1))

  if not fields:
    return []

  summaries = [f"{field} 有更新" for field in sorted(fields)]
  return summaries[:5]


def get_store_changes(
  conn: sqlite3.Connection,
  table: str,
) -> tuple[str | None, list[dict]]:
  """
  从 appstoreinfo_changes / gamestoreinfo_changes 中取最新一批变更记录。
  返回：(rank_date, rows)
  """
  cur = conn.cursor()
  cur.execute(
    f"SELECT rank_date FROM {table} ORDER BY rank_date DESC LIMIT 1",
  )
  row = cur.fetchone()
  if not row:
    return None, []

  rank_date = row[0]
  cur.execute(
    f"""
    SELECT app_id, rank_date, changed_at, changes_json
    FROM {table}
    WHERE rank_date = ?
    ORDER BY changed_at DESC, id DESC
    LIMIT 10
    """,
    (rank_date,),
  )
  rows = cur.fetchall()

  result: list[dict] = []
  for app_id, _rank_date, changed_at, changes_json in rows:
    # 取名称 + 开发者
    name = app_id
    developer = ""
    if table.startswith("appstoreinfo"):
      cur.execute(
        """
        SELECT app_name, developer
        FROM appstoreinfo
        WHERE app_id = ?
        LIMIT 1
        """,
        (app_id,),
      )
      s = cur.fetchone()
      if s:
        name, developer = s
    else:
      cur.execute(
        """
        SELECT title, developer
        FROM gamestoreinfo
        WHERE app_id = ?
        LIMIT 1
        """,
        (app_id,),
      )
      s = cur.fetchone()
      if s:
        name, developer = s

    changes = parse_changes_json(changes_json)
    result.append(
      {
        "app_id": app_id,
        "name": name,
        "developer": developer or "",
        "changed_at": changed_at,
        "summaries": changes,
      }
    )

  return rank_date, result


def build_markdown(db_path: Path) -> str:
  """生成完整的 SensorTower 简报 Markdown 文本。"""
  conn = sqlite3.connect(db_path)
  try:
    latest_date, top3 = get_new_top3(conn)
    ios_rank_date, ios_changes = get_store_changes(conn, "appstoreinfo_changes")
    android_rank_date, android_changes = get_store_changes(conn, "gamestoreinfo_changes")
  finally:
    conn.close()

  lines: list[str] = []
  title_date = latest_date or ios_rank_date or android_rank_date or ""
  title_suffix = f"（{title_date}）" if title_date else ""
  lines.append(f"# SensorTower 榜单简报{title_suffix}")
  lines.append("")

  # 一、本周新进 Top3
  lines.append("## 一、本周新进榜游戏 Top3（美国 iOS / Android 免费榜）")
  lines.append("")
  if not top3:
    lines.append("本周暂无符合条件的美国新进 Top50 游戏。")
  else:
    # 第二列表头使用「游戏名」，方便企业微信转换为列表时识别为名称
    lines.append("| 排名 | 游戏名 | 平台 | 国家 | 发行商 | 本周下载 | 本周收入 | 商店链接 |")
    lines.append("|------|--------|------|------|--------|----------|----------|----------|")
    for row in top3:
      name = row["name"]
      dev = row["developer"]
      platform = row["platform"]
      country = row["country"]
      rank = row["current_rank"]
      dl = format_number(row["downloads"])
      rev = format_revenue(row["revenue"])
      url = row["store_url"] or ""
      url_md = f"[链接]({url})" if url else "—"
      lines.append(
        f"| {rank} | {name} | {platform} | {country} | {dev} | {dl} | {rev} | {url_md} |"
      )
  lines.append("")
  lines.append("---")
  lines.append("")

  # 二、Top100 商店页变化
  lines.append("## 二、Top100 商店页变化")
  lines.append("")

  if not ios_changes and not android_changes:
    lines.append("最近一次抓取中，Top100 应用的商店页暂无检测到字段变化。")
  else:
    if ios_changes:
      lines.append(f"### iOS 商店页变化（rank_date = {ios_rank_date}）")
      lines.append("")
      for row in ios_changes:
        name = row["name"]
        dev = row["developer"]
        changed_at = row["changed_at"]
        changes = row["summaries"]
        head = f"- **{name}**"
        if dev:
          head += f"（{dev}）"
        head += f"  _变更时间：{changed_at}_"
        lines.append(head)
        for c in changes:
          lines.append(f"  - {c}")
      lines.append("")
    if android_changes:
      lines.append(f"### Android 商店页变化（rank_date = {android_rank_date}）")
      lines.append("")
      for row in android_changes:
        name = row["name"]
        dev = row["developer"]
        changed_at = row["changed_at"]
        changes = row["summaries"]
        head = f"- **{name}**"
        if dev:
          head += f"（{dev}）"
        head += f"  _变更时间：{changed_at}_"
        lines.append(head)
        for c in changes:
          lines.append(f"  - {c}")
      lines.append("")

  # 底部：引导访问站点查看更多详情
  lines.append("---")
  lines.append("")
  lines.append("更多榜单详情和玩法拆解，请访问：[游戏监测网站](https://sites.google.com/castbox.fm/overwatch2/home?authuser=1)")
  lines.append("")

  return "\n".join(lines).strip()


def main() -> None:
  parser = argparse.ArgumentParser(description="发送 SensorTower 榜单简报到飞书和企业微信机器人")
  parser.add_argument(
    "--db",
    type=str,
    default="public/sensortower_top100.db",
    help="sensortower_top100.db 路径（相对仓库根目录）",
  )
  args = parser.parse_args()

  repo_root = Path(__file__).resolve().parents[1]

  # 加载 .env
  env_path = repo_root / ".env"
  if env_path.exists():
    load_dotenv(env_path)

  db_path = (repo_root / args.db).resolve()
  if not db_path.exists():
    print(f"数据库不存在：{db_path}", file=sys.stderr)
    sys.exit(1)

  text = build_markdown(db_path)

  # 读取 Webhook（与 send_ai_competitor_digest 保持一致）
  def _clean_url(value: str | None) -> str | None:
    if not value:
      return None
    v = value.replace("\r", "").replace("\n", "").strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
      v = v[1:-1].strip()
    return v if v else None

  feishu_webhook = _clean_url(os.environ.get("FEISHU_WEBHOOK_URL"))
  wechat_webhook = _clean_url(os.environ.get("WECOM_WEBHOOK_URL_REAL"))

  if not feishu_webhook and not wechat_webhook:
    print(
      "未配置任何机器人 Webhook，请在 .env 中设置 FEISHU_WEBHOOK_URL 或 WECOM_WEBHOOK_URL_REAL",
      file=sys.stderr,
    )
    sys.exit(1)

  if feishu_webhook:
    send_to_feishu(feishu_webhook, text)

  if wechat_webhook:
    send_to_wechat(wechat_webhook, text)


if __name__ == "__main__":
  main()

