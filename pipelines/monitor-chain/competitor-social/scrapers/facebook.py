import json
import os
from datetime import datetime
from typing import Any, Dict, List

import requests

import env_loader  # noqa: F401
from scrapers.rapidapi import get_rapidapi_key, RAPIDAPI_HOSTS


def load_input_json(input_path: str = "/app/input/twitter_input.json") -> Dict[str, Any]:
    """读取 input/twitter_input.json 配置"""
    if not os.path.exists(input_path):
        alt = os.path.join(os.path.dirname(__file__), "input", "twitter_input.json")
        if os.path.exists(alt):
            input_path = alt
        else:
            print(f"❌ 未找到输入文件: {input_path}")
            return {}
    try:
        with open(input_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        print(f"❌ 读取或解析输入失败: {exc}")
        return {}


def parse_facebook_accounts(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """从 JSON 中解析 Facebook page 配置（company/game 级别）"""
    competitors = data.get("competitors") or []
    accounts: List[Dict[str, Any]] = []

    for comp in competitors:
        if not isinstance(comp, dict):
            continue
        company = (comp.get("name") or "").strip()
        if not company:
            continue
        priority = (comp.get("priority") or "medium").strip().lower()

        # 公司级平台
        for plat in (comp.get("platforms") or []):
            if not isinstance(plat, dict) or not plat.get("enabled", True):
                continue
            if (plat.get("type") or "").strip().lower() != "facebook":
                continue
            url = (plat.get("url") or "").strip()
            page_id = (plat.get("page_id") or plat.get("pageid") or "").strip()
            if not page_id and url:
                # 从 URL 中提取连续数字段作为 page_id
                import re

                m = re.search(r"/(\\d+)(?:/)?$", url.split("?", 1)[0])
                if m:
                    page_id = m.group(1)
            if not page_id:
                print(f"⚠️ 跳过：未提供 facebook page_id，且无法从 url 提取。company={company}, url={url}")
                continue
            accounts.append(
                {
                    "company": company,
                    "game": None,
                    "platform_type": "facebook",
                    "url": url,
                    "page_id": page_id,
                    "priority": priority,
                }
            )

        # 游戏级平台
        for game in (comp.get("games") or []):
            if not isinstance(game, dict):
                continue
            game_name = (game.get("name") or "").strip()
            game_priority = (game.get("priority") or priority).strip().lower()
            for plat in (game.get("platforms") or []):
                if not isinstance(plat, dict) or not plat.get("enabled", True):
                    continue
                if (plat.get("type") or "").strip().lower() != "facebook":
                    continue
                url = (plat.get("url") or "").strip()
                page_id = (plat.get("page_id") or plat.get("pageid") or "").strip()
                if not page_id and url:
                    import re

                    m = re.search(r"/(\\d+)(?:/)?$", url.split("?", 1)[0])
                    if m:
                        page_id = m.group(1)
                if not page_id:
                    print(
                        f"⚠️ 跳过：未提供 facebook page_id，且无法从 url 提取。company={company}, game={game_name}, url={url}"
                    )
                    continue
                accounts.append(
                    {
                        "company": company,
                        "game": game_name,
                        "platform_type": "facebook",
                        "url": url,
                        "page_id": page_id,
                        "priority": game_priority,
                    }
                )
    return accounts


def _fetch_facebook_raw(page_id: str) -> Dict[str, Any]:
    """调用 RapidAPI 获取 Facebook page 原始 JSON"""
    api_key = get_rapidapi_key()
    if not api_key:
        print("  ❌ 未配置 RAPIDAPI_KEY")
        return {}
    host = RAPIDAPI_HOSTS.get("facebook") or "facebook-scraper3.p.rapidapi.com"
    url = f"https://{host}/page/posts"
    headers = {
        "x-rapidapi-key": api_key,
        "x-rapidapi-host": host,
    }
    params = {"page_id": page_id}
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        print(f"  ❌ Facebook API 调用失败: {exc}")
        return {}


def _collect_posts_recursive(obj: Any, posts: List[Dict[str, Any]]) -> None:
    """递归从任意 JSON 结构中收集包含 post_id 和 timestamp 的对象"""
    if isinstance(obj, dict):
        if "post_id" in obj and "timestamp" in obj:
            posts.append(obj)
        for v in obj.values():
            _collect_posts_recursive(v, posts)
    elif isinstance(obj, list):
        for it in obj:
            _collect_posts_recursive(it, posts)


def parse_facebook_posts(raw_json: Dict[str, Any], max_posts: int = 5) -> List[Dict[str, Any]]:
    posts_raw: List[Dict[str, Any]] = []
    _collect_posts_recursive(raw_json, posts_raw)

    out: List[Dict[str, Any]] = []
    import datetime

    for p in posts_raw:
        ts = p.get("timestamp")
        try:
            ts_int = int(ts)
            time_iso = datetime.datetime.utcfromtimestamp(ts_int).isoformat() + "Z"
        except Exception:
            time_iso = str(ts)

        # 标题
        title = ""
        author = p.get("author")
        if isinstance(author, dict):
            title = author.get("name") or p.get("author_title") or ""
        if not title:
            title = p.get("author_title") or ""

        text = (
            p.get("message")
            or p.get("message_rich")
            or p.get("story")
            or p.get("description")
            or ""
        )
        link = p.get("url") or p.get("external_url") or ""

        out.append({"time": time_iso, "title": title, "text": text, "link": link})

    # 根据时间倒序取前 max_posts 条
    out.sort(key=lambda x: x.get("time", ""), reverse=True)
    return out[:max_posts]


def scrape_facebook_posts(accounts: List[Dict[str, Any]], max_posts: int = 5) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for acc in accounts:
        company = acc["company"]
        game = acc.get("game")
        page_id = acc["page_id"]
        url = acc.get("url", "")
        priority = acc.get("priority", "medium")
        display_name = f"{company} - {game}" if game else company
        print(f"\n[*] 正在抓取：{display_name} (Facebook page_id={page_id}) [优先级: {priority}]")

        raw_json = _fetch_facebook_raw(page_id)
        if not raw_json:
            print("  ⚠️ 未获取到原始 JSON，跳过")
            continue
        posts = parse_facebook_posts(raw_json, max_posts=max_posts)
        print(f"  ✓ 解析到 {len(posts)} 条帖子")

        items.append(
            {
                "company": company,
                "game": game,
                "platform_type": "facebook",
                "url": url,
                "page_id": page_id,
                "priority": priority,
                "posts": posts,
                "posts_count": len(posts),
            }
        )
    return items


def save_facebook_data(items: List[Dict[str, Any]], output_path: str = "/app/output/facebook_raw.json") -> None:
    output_dir = os.path.dirname(output_path)
    if not os.path.exists(output_dir):
        alt_dir = os.path.join(os.path.dirname(__file__), "output")
        os.makedirs(alt_dir, exist_ok=True)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)
    payload = {"fetched_at": datetime.utcnow().isoformat() + "Z", "items": items}
    try:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"\n✅ Facebook 数据已保存至: {output_path}")
    except Exception as exc:
        print(f"❌ 保存数据失败: {exc}")


def scrape_facebook_workflow(input_path: str = None, max_posts: int = 5) -> str:
    if input_path is None:
        input_path = os.environ.get("FACEBOOK_INPUT_PATH", "/app/input/twitter_input.json")
    print("=" * 60)
    print("Facebook 帖子爬虫工作流")
    print("=" * 60)
    print()

    print("[步骤 1] 读取输入配置...")
    data = load_input_json(input_path)
    if not data:
        return ""

    print("[步骤 2] 解析 Facebook 账号...")
    accounts = parse_facebook_accounts(data)
    if not accounts:
        print("⚠️ 未找到任何 Facebook 账号配置")
        return ""
    print(f"✓ 找到 {len(accounts)} 个 Facebook 账号")

    print("\n[步骤 3] 抓取 Facebook 帖子...")
    items = scrape_facebook_posts(accounts, max_posts=max_posts)
    if not items:
        print("⚠️ 未成功抓取到任何帖子")
        return ""

    print("\n[步骤 4] 保存数据...")
    output_path = os.environ.get("FACEBOOK_OUTPUT_PATH", "/app/output/facebook_raw.json")
    save_facebook_data(items, output_path)
    return output_path


if __name__ == "__main__":
    scrape_facebook_workflow()

{
  "cells": [],
  "metadata": {
    "language_info": {
      "name": "python"
    }
  },
  "nbformat": 4,
  "nbformat_minor": 2
}