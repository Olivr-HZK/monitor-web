"""
竞品监控日报工作流
整合所有平台的爬虫、AI分析和飞书推送
按公司分组生成日报，并保存历史数据
"""
import json
import os
import sys
from datetime import datetime, date, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import env_loader  # noqa: F401

from database.history_db import CompetitorHistoryDB
from scrapers.rapidapi import (
    get_posts_from_twitter,
    get_posts_from_tiktok,
    get_posts_from_instagram,
    get_twitter_user_id_from_username,
    get_tiktok_secuid_from_username,
)
from scrapers.facebook import (
    load_input_json,
    parse_facebook_accounts,
    _fetch_facebook_raw,
    parse_facebook_posts,
)
from analyzers.daily_ai import build_competitor_prompt_for_daily, call_model_with_retry


def parse_all_platform_accounts(input_data: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    """
    解析输入JSON，按公司分组所有平台的账号配置

    Returns:
        {company_name: [account_configs, ...], ...}
    """
    competitors = input_data.get("competitors") or []
    companies: Dict[str, List[Dict[str, Any]]] = {}

    for comp in competitors:
        if not isinstance(comp, dict):
            continue

        company = (comp.get("name") or "").strip()
        if not company:
            continue

        priority = (comp.get("priority") or "medium").strip().lower()

        # 初始化公司条目
        if company not in companies:
            companies[company] = []

        # 解析公司级平台
        for plat in (comp.get("platforms") or []):
            if not isinstance(plat, dict) or not plat.get("enabled", True):
                continue

            platform_type = (plat.get("type") or "").strip().lower()
            if not platform_type:
                continue

            account = {
                "company": company,
                "game": None,
                "platform_type": platform_type,
                "priority": priority,
            }

            # 提取平台特定字段
            if platform_type == "twitter":
                account["username"] = (plat.get("username") or "").strip()
                account["url"] = (plat.get("url") or "").strip()
                account["user_id"] = (plat.get("user_id") or "").strip()
            elif platform_type == "tiktok":
                account["username"] = (plat.get("username") or "").strip().lstrip("@")
                account["url"] = (plat.get("url") or "").strip()
                account["sec_uid"] = (plat.get("sec_uid") or "").strip()
            elif platform_type == "youtube":
                # YouTube 爬虫已禁用，跳过
                continue
            elif platform_type == "facebook":
                account["url"] = (plat.get("url") or "").strip()
                account["page_id"] = (plat.get("page_id") or plat.get("pageid") or "").strip()
            elif platform_type == "instagram":
                account["username"] = (plat.get("username") or "").strip().lstrip("@")
                account["url"] = (plat.get("url") or "").strip()
                if not account["url"] and account["username"]:
                    account["url"] = f"https://www.instagram.com/{account['username']}/"

            companies[company].append(account)

        # 解析游戏级平台
        for game in (comp.get("games") or []):
            if not isinstance(game, dict):
                continue

            game_name = (game.get("name") or "").strip()
            game_priority = (game.get("priority") or priority).strip().lower()

            for plat in (game.get("platforms") or []):
                if not isinstance(plat, dict) or not plat.get("enabled", True):
                    continue

                platform_type = (plat.get("type") or "").strip().lower()
                if not platform_type:
                    continue

                account = {
                    "company": company,
                    "game": game_name,
                    "platform_type": platform_type,
                    "priority": game_priority,
                }

                # 提取平台特定字段
                if platform_type == "twitter":
                    account["username"] = (plat.get("username") or "").strip()
                    account["url"] = (plat.get("url") or "").strip()
                    account["user_id"] = (plat.get("user_id") or "").strip()
                elif platform_type == "tiktok":
                    account["username"] = (plat.get("username") or "").strip().lstrip("@")
                    account["url"] = (plat.get("url") or "").strip()
                    account["sec_uid"] = (plat.get("sec_uid") or "").strip()
                elif platform_type == "youtube":
                    # YouTube 爬虫已禁用，跳过
                    continue
                elif platform_type == "facebook":
                    account["url"] = (plat.get("url") or "").strip()
                    account["page_id"] = (plat.get("page_id") or plat.get("pageid") or "").strip()
                elif platform_type == "instagram":
                    account["username"] = (plat.get("username") or "").strip().lstrip("@")
                    account["url"] = (plat.get("url") or "").strip()
                    if not account["url"] and account["username"]:
                        account["url"] = f"https://www.instagram.com/{account['username']}/"

                companies[company].append(account)

    return companies


def scrape_twitter_account(account: Dict[str, Any], days_ago: int = 1) -> Dict[str, Any]:
    """爬取Twitter账号的前一天推文"""
    username = account.get("username", "")
    user_id = account.get("user_id", "")

    print(f"    [Twitter] 账号: {username}")

    # 如果没有user_id，尝试获取
    if not user_id and username:
        print(f"      [调试] 未找到缓存的user_id，正在获取...")
        user_id = get_twitter_user_id_from_username(username)
        if user_id:
            account["user_id"] = user_id  # 更新account，但不会写回文件

    identifier = user_id if user_id else username
    if not identifier:
        print(f"      ❌ 无法确定Twitter标识符")
        return None

    # 传入期望的 username，只保留该账号发的推文，避免混入转推/他人内容
    expected_username = (username or "").strip().lstrip("@") or None

    try:
        posts = get_posts_from_twitter(
            identifier,
            days_ago=days_ago,
            count=50,
            expected_username=expected_username,
        )
        print(f"      ✓ 获取到 {len(posts)} 条推文（已过滤前一天）")

        return {
            "platform_type": "twitter",
            "game": account.get("game"),
            "url": account.get("url", f"https://x.com/{username}"),
            "username": username,
            "user_id": user_id,
            "posts": posts,
            "posts_count": len(posts),
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        }
    except Exception as exc:
        print(f"      ❌ Twitter爬取失败: {exc}")
        return None


def scrape_tiktok_account(account: Dict[str, Any], days_ago: int = 1) -> Dict[str, Any]:
    """爬取TikTok账号的前一天视频"""
    username = account.get("username", "")
    sec_uid = account.get("sec_uid", "")

    print(f"    [TikTok] 账号: {username}")

    # 如果没有sec_uid，尝试获取
    if not sec_uid and username:
        print(f"      [调试] 未找到缓存的sec_uid，正在获取...")
        sec_uid = get_tiktok_secuid_from_username(username)
        if sec_uid:
            account["sec_uid"] = sec_uid

    identifier = sec_uid if sec_uid else username
    if not identifier:
        print(f"      ❌ 无法确定TikTok标识符")
        return None

    try:
        posts = get_posts_from_tiktok(identifier, days_ago=days_ago, original_username=username)
        print(f"      ✓ 获取到 {len(posts)} 条视频（已过滤前一天）")

        return {
            "platform_type": "tiktok",
            "game": account.get("game"),
            "url": account.get("url", f"https://www.tiktok.com/@{username}"),
            "username": username,
            "sec_uid": sec_uid,
            "posts": posts,
            "posts_count": len(posts),
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        }
    except Exception as exc:
        print(f"      ❌ TikTok爬取失败: {exc}")
        return None


def scrape_instagram_account(account: Dict[str, Any], days_ago: int = 1) -> Dict[str, Any]:
    """爬取Instagram账号的前一天帖子"""
    username = account.get("username", "")
    url = account.get("url", "")

    print(f"    [Instagram] 用户名: {username}")

    # 从URL中提取username（如果没有提供）
    if not username and url:
        import re
        match = re.search(r'instagram\.com/([^/?]+)', url)
        if match:
            username = match.group(1)
            print(f"      [调试] 从URL提取用户名: {username}")

    if not username:
        print(f"      ❌ 未提供Instagram用户名")
        return None

    try:
        posts = get_posts_from_instagram(username, days_ago=days_ago, original_username=username)
        print(f"      ✓ 获取到 {len(posts)} 条帖子（已过滤前一天）")

        return {
            "platform_type": "instagram",
            "game": account.get("game"),
            "url": url or f"https://www.instagram.com/{username}/",
            "username": username,
            "posts": posts,
            "posts_count": len(posts),
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        }
    except Exception as exc:
        print(f"      ❌ Instagram爬取失败: {exc}")
        import traceback
        print(f"      [调试] 错误详情: {traceback.format_exc()}")
        return None


def scrape_facebook_account(account: Dict[str, Any], days_ago: int = 1) -> Dict[str, Any]:
    """爬取Facebook页面的前一天帖子"""
    page_id = account.get("page_id", "")
    url = account.get("url", "")

    print(f"    [Facebook] 页面ID: {page_id}")

    if not page_id:
        print(f"      ❌ 未提供Facebook page_id")
        return None

    try:
        raw_json = _fetch_facebook_raw(page_id)
        if not raw_json:
            print(f"      ❌ 无法获取Facebook数据")
            return None

        posts = parse_facebook_posts(raw_json, max_posts=50)

        # 过滤前一天的数据
        if days_ago is not None:
            target_day = date.today() - timedelta(days=days_ago)
            filtered_posts = []
            for post in posts:
                post_time_str = post.get("time", "")
                if post_time_str:
                    try:
                        # 解析ISO时间
                        if post_time_str.endswith("Z"):
                            post_dt = datetime.fromisoformat(post_time_str.replace("Z", "+00:00"))
                        else:
                            post_dt = datetime.fromisoformat(post_time_str)
                        post_date = post_dt.date()

                        if post_date == target_day:
                            filtered_posts.append(post)
                    except Exception:
                        # 如果解析失败，保留（可能是相对时间）
                        pass
            posts = filtered_posts

        print(f"      ✓ 获取到 {len(posts)} 条帖子（已过滤前一天）")

        return {
            "platform_type": "facebook",
            "game": account.get("game"),
            "url": url,
            "page_id": page_id,
            "posts": posts,
            "posts_count": len(posts),
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        }
    except Exception as exc:
        print(f"      ❌ Facebook爬取失败: {exc}")
        return None


def save_identifiers_to_input_json(input_path: str, company: str, account_identifiers: Dict[str, Dict[str, str]]):
    """
    保存获取到的标识符（user_id, sec_uid等）到input JSON文件
    总是保存到 input/twitter_input.json（相对于项目根目录）

    Args:
        input_path: 输入JSON文件路径（用于读取，但保存时使用 input/twitter_input.json）
        company: 公司名称
        account_identifiers: {platform_key: {identifier_type: value, ...}, ...}
                           例如: {"twitter_voodoo": {"user_id": "123456"}, "tiktok_game1": {"sec_uid": "abc..."}}
    """
    if not account_identifiers:
        return

    try:
        # 确定保存路径：总是使用 input/twitter_input.json（相对于项目根目录）
        script_dir = os.path.dirname(os.path.abspath(__file__))
        save_path = os.path.join(script_dir, "input", "twitter_input.json")

        # 如果脚本目录下的文件不存在，尝试当前工作目录
        if not os.path.exists(save_path):
            rel_path = os.path.join("input", "twitter_input.json")
            if os.path.exists(rel_path):
                save_path = os.path.abspath(rel_path)

        # 确保目录存在
        os.makedirs(os.path.dirname(save_path), exist_ok=True)

        print(f"  [调试] 保存标识符到文件: {save_path}")

        # 读取现有JSON（优先从保存路径读取，如果不存在则从input_path读取）
        input_data = None
        if os.path.exists(save_path):
            with open(save_path, "r", encoding="utf-8") as f:
                input_data = json.load(f)
        elif input_path and os.path.exists(input_path):
            # 如果保存路径不存在，但从input_path可以读取，先读取它
            with open(input_path, "r", encoding="utf-8") as f:
                input_data = json.load(f)

        if not input_data:
            print(f"  ⚠️ 无法读取输入文件，跳过保存标识符")
            return

        competitors = input_data.get("competitors", [])
        updated = False

        # 找到对应公司并更新标识符
        for comp in competitors:
            if not isinstance(comp, dict):
                continue
            comp_name = (comp.get("name") or "").strip()
            if comp_name.lower() != company.lower():
                continue

            # 更新公司级平台
            for plat in (comp.get("platforms") or []):
                if not isinstance(plat, dict):
                    continue
                platform_type = (plat.get("type") or "").strip().lower()
                username = (plat.get("username") or "").strip()

                # 构建key来匹配
                key = f"{platform_type}"
                if username:
                    key = f"{platform_type}_{username}"

                if key in account_identifiers:
                    identifiers = account_identifiers[key]
                    if "user_id" in identifiers:
                        plat["user_id"] = identifiers["user_id"]
                        print(f"      💾 已保存 user_id 到配置: {identifiers['user_id']}")
                        updated = True
                    if "sec_uid" in identifiers:
                        plat["sec_uid"] = identifiers["sec_uid"]
                        print(f"      💾 已保存 sec_uid 到配置: {identifiers['sec_uid'][:30]}...")
                        updated = True

            # 更新游戏级平台
            for game in (comp.get("games") or []):
                if not isinstance(game, dict):
                    continue
                game_name = (game.get("name") or "").strip()

                for plat in (game.get("platforms") or []):
                    if not isinstance(plat, dict):
                        continue
                    platform_type = (plat.get("type") or "").strip().lower()
                    username = (plat.get("username") or "").strip()

                    # 构建key来匹配 - 优先使用 game_name
                    key = f"{platform_type}_{game_name}"
                    if key not in account_identifiers and username:
                        key = f"{platform_type}_{username}"
                    if key not in account_identifiers:
                        key = f"{platform_type}"

                    if key in account_identifiers:
                        identifiers = account_identifiers[key]
                        if "user_id" in identifiers:
                            plat["user_id"] = identifiers["user_id"]
                            print(f"      💾 已保存 user_id 到配置: {identifiers['user_id']}")
                            updated = True
                        if "sec_uid" in identifiers:
                            plat["sec_uid"] = identifiers["sec_uid"]
                            print(f"      💾 已保存 sec_uid 到配置: {identifiers['sec_uid'][:30]}...")
                            updated = True

        # 保存回文件（总是保存到 input/twitter_input.json）
        if updated:
            with open(save_path, "w", encoding="utf-8") as f:
                json.dump(input_data, f, ensure_ascii=False, indent=2)
            abs_path = os.path.abspath(save_path)
            print(f"  ✓ 已更新输入配置文件: {abs_path}")
            print(f"  [调试] 文件大小: {os.path.getsize(abs_path)} 字节")
        else:
            print(f"  ⚠️ 未找到匹配的平台配置，跳过保存标识符")

    except Exception as exc:
        print(f"  ⚠️ 保存标识符到配置文件失败: {exc}")
        import traceback
        print(f"  [调试] 错误详情: {traceback.format_exc()}")


def scrape_company_platforms(
    company: str, accounts: List[Dict[str, Any]], days_ago: int = 1, input_path: str = None
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, str]]]:
    """
    爬取某个公司的所有平台数据

    Args:
        company: 公司名称
        accounts: 账号配置列表
        days_ago: 爬取多少天前的数据
        input_path: 输入JSON文件路径（用于保存标识符）

    Returns:
        (platforms_data, account_identifiers)
        - platforms_data: 爬取到的平台数据列表
        - account_identifiers: 获取到的标识符 {platform_key: {identifier_type: value}}
    """
    print(f"\n  📊 开始爬取公司: {company}")
    print(f"  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    platforms_data = []
    account_identifiers: Dict[str, Dict[str, str]] = {}

    for account in accounts:
        platform_type = account.get("platform_type", "").lower()
        game = account.get("game")
        display_name = f"{company} - {game}" if game else company

        print(f"\n  [{platform_type.upper()}] {display_name}")

        result = None
        platform_key = platform_type
        if game:
            platform_key = f"{platform_type}_{game}"
        elif account.get("username"):
            platform_key = f"{platform_type}_{account['username']}"

        if platform_type == "twitter":
            result = scrape_twitter_account(account, days_ago=days_ago)
            # 收集标识符
            if result and result.get("user_id"):
                if platform_key not in account_identifiers:
                    account_identifiers[platform_key] = {}
                account_identifiers[platform_key]["user_id"] = result["user_id"]
        elif platform_type == "tiktok":
            result = scrape_tiktok_account(account, days_ago=days_ago)
            # 收集标识符
            if result and result.get("sec_uid"):
                if platform_key not in account_identifiers:
                    account_identifiers[platform_key] = {}
                account_identifiers[platform_key]["sec_uid"] = result["sec_uid"]
        elif platform_type == "youtube":
            print(f"      ⚠️ YouTube爬虫已禁用，跳过")
            continue
        elif platform_type == "instagram":
            result = scrape_instagram_account(account, days_ago=days_ago)
        elif platform_type == "facebook":
            result = scrape_facebook_account(account, days_ago=days_ago)
        else:
            print(f"      ⚠️ 不支持的平台类型: {platform_type}")

        if result:
            # 只保存有数据的平台（posts_count > 0）
            posts_count = result.get("posts_count", 0)
            if posts_count > 0:
                platforms_data.append(result)
                print(f"      ✓ 已添加到数据列表（{posts_count} 条帖子）")
            else:
                print(f"      ⚠️ 无数据，跳过保存（posts_count: 0）")

    # 保存标识符到输入JSON文件
    if account_identifiers and input_path:
        print(f"\n  💾 保存获取到的标识符到配置文件...")
        save_identifiers_to_input_json(input_path, company, account_identifiers)

    print(f"\n  ✓ {company} 爬取完成，共 {len(platforms_data)} 个平台有数据")
    return platforms_data, account_identifiers


def analyze_company_posts(company: str, platforms_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """对某个公司的所有平台数据进行AI分析"""
    print(f"\n  🤖 开始AI分析: {company}")
    print(f"  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    ai_results = {}

    for platform_data in platforms_data:
        platform_type = platform_data.get("platform_type", "")
        game = platform_data.get("game")
        posts_count = platform_data.get("posts_count", 0)

        if game:
            title = f"{company} - {game} - {platform_type}"
        else:
            title = f"{company} - {platform_type}"

        print(f"\n    [分析] {title} (帖子数: {posts_count})")

        # 构建AI提示词（即使posts_count=0也要分析）
        item = {
            "company": company,
            "game": game,
            "platform_type": platform_type,
            "url": platform_data.get("url", ""),
            "posts": platform_data.get("posts", []),
            "posts_count": posts_count,
            "priority": platform_data.get("priority", "medium"),
        }

        prompt = build_competitor_prompt_for_daily(item)
        data = call_model_with_retry(prompt)

        if not data:
            print(f"      ⚠️ AI分析失败，跳过")
            continue

        # 构建结果
        try:
            score = float(data.get("usability_score", 0))
        except Exception:
            score = 0.0

        payload = {
            "company": data.get("company") or company,
            "game": data.get("game") or game,
            "platform": data.get("platform") or platform_type,
            "url": data.get("url") or platform_data.get("url", ""),
            "priority": data.get("priority") or platform_data.get("priority", "medium"),
            "usability_score": score,
            "posts_count": platform_data.get("posts_count", 0),
            "fetched_at": platform_data.get("fetched_at"),
            "analysis": data.get("analysis") or {},
        }

        ai_results[title] = payload
        print(f"      ✓ 分析完成，评分: {score}")

    print(f"\n  ✓ {company} AI分析完成，共 {len(ai_results)} 个平台")
    return ai_results


def build_company_daily_report(
    company: str,
    ai_results: Dict[str, Any],
    platforms_data: List[Dict[str, Any]],
    all_accounts_config: List[Dict[str, Any]] = None,
    days_ago: int = 1
) -> str:
    """构建某个公司的日报Markdown

    Args:
        company: 公司名称
        ai_results: AI分析结果
        platforms_data: 爬取到的平台数据（只包含有数据的平台）
        all_accounts_config: 所有平台的配置信息（包括未更新的平台）
        days_ago: 查询多少天前的数据
    """
    from datetime import datetime

    lines = []
    lines.append("=" * 60)
    lines.append(f"🏢 {company} - 竞品监控日报")
    lines.append("=" * 60)

    # 报告日期（目标日期）
    target_date = (date.today() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    lines.append(f"📅 监控日期: {target_date}")

    # 显示所有监控的社交媒体来源URL
    lines.append(f"📎 来源:")
    if all_accounts_config:
        platform_icons = {
            "twitter": "🐦",
            "tiktok": "🎵",
            "youtube": "▶️",
            "facebook": "📘",
            "instagram": "📷",
        }
        for account in all_accounts_config:
            platform_type = account.get("platform_type", "").lower()
            game = account.get("game")
            url = account.get("url", "").strip()

            if not url:
                # 如果没有URL，尝试根据平台类型和用户名生成
                username = account.get("username", "").strip()
                if platform_type == "twitter" and username:
                    url = f"https://x.com/{username}"
                elif platform_type == "tiktok" and username:
                    url = f"https://www.tiktok.com/@{username}"
                elif platform_type == "instagram" and username:
                    url = f"https://www.instagram.com/{username}/"
                elif platform_type == "facebook":
                    page_id = account.get("page_id", "")
                    if page_id:
                        url = f"https://www.facebook.com/{page_id}"

            if url:
                icon = platform_icons.get(platform_type, "🌐")
                label = f"{icon} {platform_type.upper()}"
                if game:
                    label += f" - {game}"
                lines.append(f"   • {label}: {url}")
    else:
        lines.append("   各竞品官方社媒页面")

    lines.append("")

    # 检查是否有无更新的平台
    # 首先从 platforms_data 中找出有数据但 posts_count=0 的平台
    scraped_platforms = {}
    for platform_data in platforms_data:
        platform_type = platform_data.get("platform_type", "").lower()
        game = platform_data.get("game")
        key = f"{platform_type}_{game or 'company'}"
        scraped_platforms[key] = platform_data

    no_update_platforms = []
    # 检查所有配置的平台
    if all_accounts_config:
        for account in all_accounts_config:
            platform_type = account.get("platform_type", "").lower()
            game = account.get("game")
            key = f"{platform_type}_{game or 'company'}"

            # 如果这个平台在 scraped_platforms 中，检查 posts_count
            if key in scraped_platforms:
                platform_data = scraped_platforms[key]
                if platform_data.get("posts_count", 0) == 0:
                    url = platform_data.get("url", "") or account.get("url", "")
                    display_name = f"{platform_type.upper()}"
                    if game:
                        display_name = f"{platform_type.upper()} - {game}"
                    no_update_platforms.append({
                        "name": display_name,
                        "url": url,
                    })
            else:
                # 如果这个平台没有出现在 scraped_platforms 中（可能是爬取失败或跳过），也标记为无更新
                url = account.get("url", "")
                if not url:
                    username = account.get("username", "").strip()
                    if platform_type == "twitter" and username:
                        url = f"https://x.com/{username}"
                    elif platform_type == "tiktok" and username:
                        url = f"https://www.tiktok.com/@{username}"
                    elif platform_type == "instagram" and username:
                        url = f"https://www.instagram.com/{username}/"
                    elif platform_type == "facebook":
                        page_id = account.get("page_id", "")
                        if page_id:
                            url = f"https://www.facebook.com/{page_id}"

                display_name = f"{platform_type.upper()}"
                if game:
                    display_name = f"{platform_type.upper()} - {game}"
                no_update_platforms.append({
                    "name": display_name,
                    "url": url,
                })
    else:
        # 如果没有 all_accounts_config，回退到旧逻辑
        for platform_data in platforms_data:
            if platform_data.get("posts_count", 0) == 0:
                platform_type = platform_data.get("platform_type", "")
                game = platform_data.get("game")
                url = platform_data.get("url", "")

                display_name = f"{platform_type.upper()}"
                if game:
                    display_name = f"{platform_type.upper()} - {game}"

                no_update_platforms.append({
                    "name": display_name,
                    "url": url,
                })

    # 显示无更新平台信息
    if no_update_platforms:
        lines.append("⚠️ 无社媒更新的平台")
        lines.append("-" * 60)
        for no_up in no_update_platforms:
            lines.append(f"  • {no_up['name']}")
            if no_up['url']:
                lines.append(f"    链接: {no_up['url']}（建议手动查看）")
        lines.append("")
        lines.append("")

    # 按评分排序
    sorted_results = sorted(
        ai_results.items(),
        key=lambda x: float(x[1].get("usability_score", 0)),
        reverse=True
    )

    # 检查是否有任何有更新的平台
    has_updates = False
    for platform_data in platforms_data:
        if platform_data.get("posts_count", 0) > 0:
            has_updates = True
            break

    if sorted_results:
        lines.append("📊 有更新的平台分析")
        lines.append("-" * 60)
        lines.append("")
    elif not has_updates:
        # 如果所有平台都没有更新，显示说明
        if no_update_platforms:
            lines.append("📝 说明：所有平台昨天均无社媒更新，请手动查看上述链接确认。")
        else:
            lines.append("📝 说明：所有监控平台昨天均无社媒更新。")
        lines.append("")

    for idx, (title, payload) in enumerate(sorted_results, 1):
        game = payload.get("game")
        platform = payload.get("platform") or ""
        url = payload.get("url") or ""
        priority = payload.get("priority", "medium")
        score = payload.get("usability_score", "")
        posts_count = payload.get("posts_count", 0)
        analysis = payload.get("analysis") or {}

        # 平台图标
        platform_icons = {
            "twitter": "🐦",
            "tiktok": "🎵",
            "youtube": "▶️",
            "facebook": "📘",
            "instagram": "📷",
        }
        icon = platform_icons.get(platform.lower(), "🌐")

        # 子标题
        sub_title = f"{idx}. {icon} "
        if game:
            sub_title += f"{game} - {platform}"
        else:
            sub_title += f"{company} 官方账号 - {platform}"

        if priority and priority != "medium":
            priority_icon = "🔴" if priority == "high" else "🟡"
            sub_title += f" {priority_icon}"

        lines.append(sub_title)
        lines.append("")

        # 基本信息
        if url:
            lines.append(f"   🔗 链接: {url}")
        if score != "":
            try:
                score_val = float(score)
                score_icon = "⭐" * min(int(score_val / 2), 5) if score_val > 0 else ""
                lines.append(f"   📊 可用性评分: {score} {score_icon}")
            except Exception:
                lines.append(f"   📊 可用性评分: {score}")
        if posts_count:
            lines.append(f"   📝 分析帖子数: {posts_count} 条")
        lines.append("")

        # 分析内容
        summary = analysis.get("summary") or ""
        ad_insight = analysis.get("ad_creative_insights") or ""
        gameplay_insight = analysis.get("gameplay_or_mechanic_insights") or ""
        engagement = analysis.get("engagement") or ""
        actions_raw = analysis.get("direct_action_suggestions") or ""

        # 处理actions（可能是数组或字符串）
        if isinstance(actions_raw, list):
            actions = "\n".join([f"      - {item}" for item in actions_raw if item])
        else:
            actions = str(actions_raw) if actions_raw else ""

        if summary:
            lines.append(f"   📝 摘要: {summary}")
        if engagement:
            lines.append(f"   👍 互动概览: {engagement}")
        if ad_insight:
            lines.append(f"   🎯 广告创意观察: {ad_insight}")
        if gameplay_insight:
            lines.append(f"   🎮 玩法/机制观察: {gameplay_insight}")
        if actions:
            lines.append(f"   ✅ 建议动作:")
            lines.append(actions)
        lines.append("")

    # 附录：原帖URL列表
    lines.append("=" * 60)
    lines.append("📎 原帖链接")
    lines.append("=" * 60)
    lines.append("")

    post_urls = []
    for platform_data in platforms_data:
        platform_type = platform_data.get("platform_type", "")
        game = platform_data.get("game")
        posts = platform_data.get("posts", [])

        for post in posts:
            post_url = post.get("post_url") or post.get("link", "")
            if post_url:
                label = f"{platform_type}"
                if game:
                    label = f"{platform_type} - {game}"
                post_urls.append(f"   • [{label}] {post_url}")

    if post_urls:
        lines.extend(post_urls)
    else:
        lines.append("   （无原帖链接）")

    lines.append("")
    lines.append("=" * 60)

    return "\n".join(lines)


def _get_company_color(company: str) -> str:
    """
    为不同公司分配不同颜色的边框
    使用预定义的颜色列表，通过哈希值分配
    """
    colors = [
        "blue", "wathet", "turquoise", "green", "yellow", "orange",
        "red", "carmine", "violet", "purple", "indigo", "grey",
    ]
    hash_value = hash(company.lower()) % len(colors)
    return colors[hash_value]


def _platform_icon(platform: str) -> str:
    """根据平台类型返回图标"""
    p = (platform or "").lower()
    if "twitter" in p or "x.com" in p or p == "x":
        return "🐦"
    if "instagram" in p or "ig" == p:
        return "📸"
    if "tiktok" in p:
        return "🎵"
    if "youtube" in p:
        return "▶️"
    if "facebook" in p or "fb" == p:
        return "📘"
    return "🌐"


def build_company_feishu_card(
    company: str,
    ai_results: Dict[str, Any],
    platforms_data: List[Dict[str, Any]],
    all_accounts_config: List[Dict[str, Any]] = None,
    days_ago: int = 1
) -> Dict[str, Any]:
    """
    构建公司日报的飞书卡片格式

    Args:
        company: 公司名称
        ai_results: AI分析结果 {title: payload}
        platforms_data: 平台数据列表
        all_accounts_config: 所有平台配置
        days_ago: 查询多少天前的数据

    Returns:
        飞书卡片字典
    """
    target_date = (date.today() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    company_color = _get_company_color(company)

    elements: List[Dict[str, Any]] = []

    # 添加日期和来源信息
    header_info = [f"📅 **日期**: {target_date}（监控日期）"]

    # 显示所有监控的社交媒体来源URL
    sources = []
    if all_accounts_config:
        platform_icons = {
            "twitter": "🐦", "tiktok": "🎵", "youtube": "▶️",
            "facebook": "📘", "instagram": "📷",
        }
        for account in all_accounts_config:
            platform_type = account.get("platform_type", "").lower()
            game = account.get("game")
            url = account.get("url", "").strip()

            if not url:
                username = account.get("username", "").strip()
                if platform_type == "twitter" and username:
                    url = f"https://x.com/{username}"
                elif platform_type == "tiktok" and username:
                    url = f"https://www.tiktok.com/@{username}"
                elif platform_type == "instagram" and username:
                    url = f"https://www.instagram.com/{username}/"
                elif platform_type == "facebook":
                    page_id = account.get("page_id", "")
                    if page_id:
                        url = f"https://www.facebook.com/{page_id}"

            if url:
                icon = platform_icons.get(platform_type, "🌐")
                label = f"{icon} {platform_type.upper()}"
                if game:
                    label += f" - {game}"
                sources.append(f"{label}: [{url}]({url})")

    if sources:
        header_info.append(f"📎 **来源**:\n" + "\n".join([f"   • {s}" for s in sources]))
    else:
        header_info.append("📎 **来源**: 各竞品官方社媒页面")

    elements.append({
        "tag": "div",
        "text": {
            "tag": "lark_md",
            "content": "\n".join(header_info)
        }
    })
    elements.append({"tag": "hr"})

    # 检查无更新的平台
    scraped_platforms = {}
    for platform_data in platforms_data:
        platform_type = platform_data.get("platform_type", "").lower()
        game = platform_data.get("game")
        key = f"{platform_type}_{game or 'company'}"
        scraped_platforms[key] = platform_data

    no_update_platforms = []
    if all_accounts_config:
        for account in all_accounts_config:
            platform_type = account.get("platform_type", "").lower()
            game = account.get("game")
            key = f"{platform_type}_{game or 'company'}"

            if key in scraped_platforms:
                platform_data = scraped_platforms[key]
                if platform_data.get("posts_count", 0) == 0:
                    url = platform_data.get("url", "") or account.get("url", "")
                    no_update_platforms.append({
                        "name": f"{platform_type.upper()}" + (f" - {game}" if game else ""),
                        "url": url,
                    })
            else:
                url = account.get("url", "")
                if not url:
                    username = account.get("username", "").strip()
                    if platform_type == "twitter" and username:
                        url = f"https://x.com/{username}"
                    elif platform_type == "tiktok" and username:
                        url = f"https://www.tiktok.com/@{username}"
                    elif platform_type == "instagram" and username:
                        url = f"https://www.instagram.com/{username}/"
                    elif platform_type == "facebook":
                        page_id = account.get("page_id", "")
                        if page_id:
                            url = f"https://www.facebook.com/{page_id}"

                no_update_platforms.append({
                    "name": f"{platform_type.upper()}" + (f" - {game}" if game else ""),
                    "url": url,
                })

    # 显示无更新平台
    if no_update_platforms:
        no_update_lines = ["⚠️ **无社媒更新的平台**"]
        for no_up in no_update_platforms:
            if no_up['url']:
                no_update_lines.append(f"  • {no_up['name']}: [{no_up['url']}]({no_up['url']})（建议手动查看）")
            else:
                no_update_lines.append(f"  • {no_up['name']}")

        elements.append({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": "\n".join(no_update_lines)
            }
        })
        elements.append({"tag": "hr"})

    # 按评分排序AI结果
    sorted_results = sorted(
        ai_results.items(),
        key=lambda x: float(x[1].get("usability_score", 0)),
        reverse=True
    )

    # 检查是否有更新的平台
    has_updates = any(p.get("posts_count", 0) > 0 for p in platforms_data)

    if not sorted_results and not has_updates:
        elements.append({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": "📝 **说明**: 所有平台昨天均无社媒更新，请手动查看上述链接确认。"
            }
        })

    # 添加有更新的平台分析
    if sorted_results:
        elements.append({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": "📊 **有更新的平台分析**"
            }
        })
        elements.append({"tag": "hr"})

    # 为每个平台添加详细信息
    for idx, (title, payload) in enumerate(sorted_results, 1):
        game = payload.get("game")
        platform = payload.get("platform") or ""
        url = payload.get("url") or ""
        priority = payload.get("priority", "medium")
        score = payload.get("usability_score", "")
        posts_count = payload.get("posts_count", 0)
        analysis = payload.get("analysis") or {}

        platform_icon = _platform_icon(platform)

        # 构建平台标题
        platform_title_parts = [f"{platform_icon}"]
        if game:
            platform_title_parts.append(f"**{game}**")
        else:
            platform_title_parts.append(f"**{company} 官方账号**")
        if platform:
            platform_title_parts.append(f"({platform})")

        priority_text = ""
        if priority == "high":
            priority_text = " 🔴 **高优先级**"
        elif priority == "low":
            priority_text = " 🟡 **低优先级**"

        platform_title = " ".join(platform_title_parts) + priority_text

        # 创建字段
        fields: List[Dict[str, Any]] = []

        # 平台信息和链接
        platform_info = f"**{idx}. {platform_title}**"
        if url:
            platform_info += f"\n🔗 [{url}]({url})"

        fields.append({
            "is_short": False,
            "text": {
                "tag": "lark_md",
                "content": platform_info
            }
        })

        # 评分和帖子数
        score_info = []
        if score != "":
            try:
                score_val = float(score)
                score_stars = "⭐" * min(int(score_val / 2), 5) if score_val > 0 else ""
                score_info.append(f"📊 **可用性评分**: {score} {score_stars}")
            except Exception:
                score_info.append(f"📊 **可用性评分**: {score}")

        if posts_count:
            score_info.append(f"📝 **分析帖子数**: {posts_count} 条")

        if score_info:
            fields.append({
                "is_short": False,
                "text": {
                    "tag": "lark_md",
                    "content": "\n".join(score_info)
                }
            })

        if fields:
            elements.append({"tag": "div", "fields": fields})

        # 分析内容
        content_lines = []
        summary = analysis.get("summary") or ""
        engagement = analysis.get("engagement") or ""
        ad_insight = analysis.get("ad_creative_insights") or ""
        gameplay_insight = analysis.get("gameplay_or_mechanic_insights") or ""
        actions_raw = analysis.get("direct_action_suggestions") or ""

        if summary:
            content_lines.append(f"📝 **摘要**: {summary}")
        if engagement:
            content_lines.append(f"👍 **互动概览**: {engagement}")
        if ad_insight:
            content_lines.append(f"🎯 **广告创意观察**: {ad_insight}")
        if gameplay_insight:
            content_lines.append(f"🎮 **玩法/机制观察**: {gameplay_insight}")
        if actions_raw:
            if isinstance(actions_raw, list):
                actions = "\n".join([f"  - {item}" for item in actions_raw if item])
            else:
                actions = str(actions_raw)
            if actions:
                content_lines.append(f"✅ **建议动作**:\n{actions}")

        if content_lines:
            elements.append({
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "\n\n".join(content_lines)
                }
            })

        # 如果不是最后一个，添加分隔线
        if idx < len(sorted_results):
            elements.append({"tag": "hr"})

    # 添加原帖链接部分
    post_urls = []
    for platform_data in platforms_data:
        platform_type = platform_data.get("platform_type", "")
        game = platform_data.get("game")
        posts = platform_data.get("posts", [])

        for post in posts:
            post_url = post.get("post_url") or post.get("link", "")
            if post_url:
                label = f"{platform_type}"
                if game:
                    label = f"{platform_type} - {game}"
                post_urls.append(f"  • [{label}]({post_url})")

    if post_urls:
        elements.append({"tag": "hr"})
        elements.append({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": "📎 **原帖链接**\n\n" + "\n".join(post_urls)
            }
        })

    # 构建卡片
    card = {
        "config": {"wide_screen_mode": True},
        "header": {
            "template": company_color,
            "title": {
                "tag": "plain_text",
                "content": f"🏁 竞品监控 · {company}"
            }
        },
        "elements": elements
    }

    return card


def send_company_report_to_feishu(
    company: str,
    report_text: str = None,
    ai_results: Dict[str, Any] = None,
    platforms_data: List[Dict[str, Any]] = None,
    all_accounts_config: List[Dict[str, Any]] = None,
    days_ago: int = 1
) -> bool:
    """
    发送公司日报到飞书（使用卡片格式）

    Args:
        company: 公司名称
        report_text: Markdown格式的报告文本（保留兼容性，但优先使用卡片格式）
        ai_results: AI分析结果（用于构建卡片）
        platforms_data: 平台数据列表（用于构建卡片）
        all_accounts_config: 所有平台配置（用于构建卡片）
        days_ago: 查询多少天前的数据
    """
    import requests
    import yaml
    import time

    # 获取webhook
    webhook = ""
    for env_key in ("FEISHU_WEBHOOK_URL", "FEISHU_URL", "FEISHU_WEBHOOK"):
        if os.environ.get(env_key):
            webhook = os.environ[env_key]
            break

    if not webhook:
        config_path = os.environ.get("CONFIG_PATH", "/app/config/config.yaml")
        if not os.path.exists(config_path):
            alt = os.path.join(os.path.dirname(__file__), "config", "config.yaml")
            if os.path.exists(alt):
                config_path = alt
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    cfg = yaml.safe_load(f) or {}
                webhook = cfg.get("notification", {}).get("webhooks", {}).get("feishu_url", "")
            except Exception:
                pass

    if not webhook:
        print(f"  ⚠️ 未找到飞书webhook，跳过推送")
        return False

    # 优先使用卡片格式（如果提供了必要数据）
    if ai_results is not None and platforms_data is not None:
        try:
            card = build_company_feishu_card(
                company=company,
                ai_results=ai_results,
                platforms_data=platforms_data,
                all_accounts_config=all_accounts_config,
                days_ago=days_ago
            )

            payload = {"msg_type": "interactive", "card": card}

            sent = False
            for attempt in range(3):
                try:
                    resp = requests.post(webhook, json=payload, timeout=20)
                    resp_data = {}
                    try:
                        resp_data = resp.json()
                    except Exception:
                        resp_data = {}

                    code = resp_data.get("StatusCode", resp_data.get("code", 0))
                    if resp.status_code == 200 and code in (0,):
                        print(f"  ✓ 日报已推送到飞书（卡片格式）")
                        return True
                    else:
                        print(f"  ❌ 飞书推送失败 (尝试 {attempt + 1}/3): {resp.text[:200]}")
                except Exception as exc:
                    print(f"  ❌ 飞书推送异常 (尝试 {attempt + 1}/3): {exc}")

                if attempt < 2:
                    time.sleep(2)

            return False

        except Exception as exc:
            print(f"  ⚠️ 构建卡片失败，回退到文本格式: {exc}")
            # 继续使用文本格式

    # 回退到文本格式（兼容旧方式）
    if not report_text or not report_text.strip():
        print(f"  ⚠️ 报告内容为空，跳过推送")
        return False

    # 飞书对单条消息长度有限制（约4096字符），如果超长需要截断或分段
    max_length = 4000  # 留一些余量
    if len(report_text) > max_length:
        print(f"  ⚠️ 报告内容过长 ({len(report_text)} 字符)，将截断到 {max_length} 字符")
        report_text = report_text[:max_length] + "\n\n...（内容已截断）"

    payload = {
        "msg_type": "text",
        "content": {"text": report_text},
    }

    try:
        resp = requests.post(webhook, json=payload, timeout=20)

        if resp.status_code == 200:
            result = resp.json()
            if result.get("code") == 0:
                print(f"  ✓ 日报已推送到飞书（文本格式）")
                return True
            else:
                print(f"  ❌ 飞书返回错误: {result.get('msg', 'Unknown error')}")
                return False
        else:
            print(f"  ❌ 飞书推送失败: {resp.status_code} {resp.text[:500]}")
            return False
    except Exception as exc:
        print(f"  ❌ 飞书推送异常: {exc}")
        import traceback
        print(f"  [调试] 异常堆栈: {traceback.format_exc()}")
        return False


def run_daily_workflow(
    input_path: str = None,
    days_ago: int = 1,
    skip_ai: bool = False,
    skip_send: bool = False,
    target_companies: List[str] = None,
) -> int:
    """运行完整的日报工作流"""
    print("\n" + "=" * 60)
    print("🚀 竞品监控日报工作流")
    print("=" * 60)
    print(f"📅 目标日期: {(date.today() - timedelta(days=days_ago)).strftime('%Y-%m-%d')}")
    print("=" * 60)
    print()

    # 初始化数据库
    db = CompetitorHistoryDB()
    print(f"📦 历史数据库目录: {db.db_dir}")
    print()

    # 步骤1: 读取配置
    print("【步骤 1/5】读取输入配置")
    print("-" * 60)
    if input_path is None:
        # 优先使用环境变量
        input_path = os.environ.get("COMPETITOR_INPUT_PATH")
        if not input_path:
            # 尝试相对路径（本地开发环境）
            rel_path = os.path.join("input", "twitter_input.json")
            if os.path.exists(rel_path):
                input_path = rel_path
            else:
                # 回退到绝对路径（Docker环境）
                input_path = "/app/input/twitter_input.json"

    print(f"  📋 输入配置文件: {input_path}")
    input_data = load_input_json(input_path)
    if not input_data:
        print("❌ 无法读取输入配置，工作流终止")
        return 1

    companies_config = parse_all_platform_accounts(input_data)
    if not companies_config:
        print("❌ 未找到任何竞品账号配置")
        return 1

    print(f"✓ 找到 {len(companies_config)} 个公司，共 {sum(len(accs) for accs in companies_config.values())} 个平台账号")
    print()

    # 过滤目标公司（如果指定）
    if target_companies:
        companies_config = {
            k: v for k, v in companies_config.items()
            if k.lower() in [c.lower() for c in target_companies]
        }
        print(f"🔍 已过滤到 {len(companies_config)} 个目标公司")
        print()

    # 步骤2: 爬取数据
    print("【步骤 2/5】爬取各平台数据")
    print("-" * 60)

    all_companies_data: Dict[str, List[Dict[str, Any]]] = {}

    for company, accounts in companies_config.items():
        platforms_data, account_identifiers = scrape_company_platforms(
            company, accounts, days_ago=days_ago, input_path=input_path
        )
        # 即使没有数据，也保存空的列表，这样后续可以生成"无更新"的报告
        all_companies_data[company] = platforms_data or []

        if platforms_data:
            # 保存到历史数据库（只保存有数据的平台）
            print(f"\n  💾 保存原始数据到历史数据库...")
            db.save_raw_data(company, platforms_data, fetch_date=date.today() - timedelta(days=days_ago))
        else:
            print(f"  ⚠️ {company} 无有效数据，将生成无更新报告")

    if not all_companies_data:
        print("❌ 未找到任何公司配置，工作流终止")
        return 1

    companies_with_data = sum(1 for v in all_companies_data.values() if v)
    print(f"\n✓ 爬取完成，共 {len(all_companies_data)} 个公司，其中 {companies_with_data} 个公司有数据")
    print()

    # 步骤3: AI分析
    all_companies_ai: Dict[str, Dict[str, Any]] = {}

    if not skip_ai:
        print("【步骤 3/5】AI分析")
        print("-" * 60)

        for company, platforms_data in all_companies_data.items():
            # 如果没有数据，跳过AI分析，但初始化空结果
            if not platforms_data:
                all_companies_ai[company] = {}
                print(f"\n  ⚠️ {company} 无数据，跳过AI分析")
                continue

            print(f"\n  [调试] 开始分析公司: '{company}'")
            ai_results = analyze_company_posts(company, platforms_data)
            print(f"  [调试] analyze_company_posts 返回结果数量: {len(ai_results) if ai_results else 0}")
            print(f"  [调试] ai_results 内容: {list(ai_results.keys()) if ai_results else 'None'}")

            # 无论结果是否为空，都保存到 all_companies_ai（必须保存，这样后续才能正确获取）
            all_companies_ai[company] = ai_results
            print(f"  [调试] 已保存到 all_companies_ai['{company}']")
            print(f"  [调试] 当前all_companies_ai中的所有公司: {list(all_companies_ai.keys())}")

            # 只有非空结果才保存到数据库
            if ai_results:
                # 保存AI分析结果到历史数据库
                print(f"\n  💾 保存AI分析结果到历史数据库...")
                db.save_ai_analysis(company, ai_results, analysis_date=date.today() - timedelta(days=days_ago))
            else:
                print(f"  [调试] {company} 的AI分析结果为空，跳过保存到数据库")

        print(f"\n✓ AI分析完成，共 {len(all_companies_ai)} 个公司处理完成")
        print(f"  [调试] all_companies_ai 中的公司: {list(all_companies_ai.keys())}")
        print()
    else:
        # 如果跳过AI分析，初始化所有公司的空结果
        for company in all_companies_data.keys():
            all_companies_ai[company] = {}
        print("⚠️ 跳过AI分析步骤")
        print()

    # 步骤4: 生成日报
    print("【步骤 4/5】生成日报")
    print("-" * 60)

    reports: Dict[str, str] = {}

    # 对所有配置的公司都生成日报（即使没有数据）
    for company in companies_config.keys():
        platforms_data = all_companies_data.get(company, [])
        print(f"\n  [调试] 生成日报: 公司名称='{company}'")
        print(f"  [调试] all_companies_ai 中的键: {list(all_companies_ai.keys())}")
        print(f"  [调试] 检查 all_companies_ai.get('{company}')...")
        ai_results = all_companies_ai.get(company, {})
        print(f"  [调试] 获取到的 ai_results 类型: {type(ai_results)}, 长度: {len(ai_results) if isinstance(ai_results, dict) else 'N/A'}")

        print(f"\n  📄 生成日报: {company}")
        print(f"    AI结果数量: {len(ai_results)}")
        print(f"    平台数据数量: {len(platforms_data)}")

        # 获取该公司的所有平台配置（包括未更新的平台）
        all_accounts_config = companies_config.get(company, [])
        print(f"    总配置平台数量: {len(all_accounts_config)}")

        # 即使没有AI结果也要生成日报（显示无更新平台信息）
        report_text = build_company_daily_report(
            company, ai_results, platforms_data,
            all_accounts_config=all_accounts_config,
            days_ago=days_ago
        )
        print(f"    日报长度: {len(report_text)} 字符")

        if not report_text.strip():
            print(f"    ⚠️ 生成的日报为空，跳过")
            continue

        reports[company] = report_text

        # 保存日报到文件（Markdown格式）
        # 优先使用环境变量，否则使用项目根目录下的output目录
        output_dir = os.environ.get("OUTPUT_DIR")
        if not output_dir or not os.path.exists(output_dir):
            # 使用项目根目录下的output目录
            alt_dir = os.path.join(os.path.dirname(__file__), "output")
            if not os.path.exists(alt_dir):
                os.makedirs(alt_dir, exist_ok=True)
            output_dir = alt_dir

        report_date = (date.today() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
        safe_company = "".join(c for c in company if c.isalnum() or c in (' ', '-', '_')).strip()
        safe_company = safe_company.replace(' ', '_').lower()
        report_file = os.path.join(output_dir, f"daily_report_{safe_company}_{report_date}.md")

        print(f"    [调试] 保存路径: {report_file}")
        print(f"    [调试] 输出目录: {output_dir}")
        print(f"    [调试] 目录存在: {os.path.exists(output_dir)}")

        try:
            with open(report_file, "w", encoding="utf-8") as f:
                f.write(report_text)
            print(f"    ✓ 日报已保存: {report_file}")
            print(f"    [调试] 文件大小: {os.path.getsize(report_file)} 字节")
        except Exception as exc:
            print(f"    ❌ 保存日报失败: {exc}")
            import traceback
            print(f"    [调试] 错误详情: {traceback.format_exc()}")

        # 同时保存JSON格式的日报到 db/reports 目录
        db_dir = os.environ.get("COMPETITOR_DB_DIR", "/app/db")
        if not os.path.exists(db_dir):
            alt_db_dir = os.path.join(os.path.dirname(__file__), "db")
            if os.path.exists(alt_db_dir):
                db_dir = alt_db_dir
            else:
                alt_db_dir = os.path.join(os.path.dirname(__file__), "db")
                os.makedirs(alt_db_dir, exist_ok=True)
                db_dir = alt_db_dir

        reports_dir = os.path.join(db_dir, "reports")
        os.makedirs(reports_dir, exist_ok=True)

        json_report_file = os.path.join(reports_dir, f"{safe_company}_{report_date}.json")

        # 构建JSON格式的日报数据（确保包含AI结果）
        report_data = {
            "company": company,
            "date": report_date,
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "markdown_content": report_text,
            "ai_results": ai_results,  # 从 all_companies_ai 获取的结果
            "platforms_data": platforms_data,
        }

        print(f"    [调试] 保存JSON日报: {json_report_file}")
        print(f"    [调试] ai_results 数量: {len(ai_results)}")
        print(f"    [调试] ai_results 键: {list(ai_results.keys()) if ai_results else 'None'}")

        try:
            with open(json_report_file, "w", encoding="utf-8") as f:
                json.dump(report_data, f, ensure_ascii=False, indent=2)
            print(f"    ✓ JSON日报已保存: {json_report_file}")
            print(f"    [调试] JSON文件大小: {os.path.getsize(json_report_file)} 字节")
        except Exception as exc:
            print(f"    ❌ 保存JSON日报失败: {exc}")
            import traceback
            print(f"    [调试] 错误详情: {traceback.format_exc()}")

    print(f"\n✓ 日报生成完成，共 {len(reports)} 份日报")
    print()

    # 步骤5: 推送到飞书
    if not skip_send:
        print("【步骤 5/5】推送到飞书")
        print("-" * 60)

        if not reports:
            print("⚠️ 没有可推送的日报，跳过推送步骤")
        else:
            for company, report_text in reports.items():
                print(f"\n  📤 推送日报: {company}")

                # 获取该公司的AI结果和平台数据，用于构建卡片
                ai_results = all_companies_ai.get(company, {})
                platforms_data = all_companies_data.get(company, [])
                all_accounts_config = companies_config.get(company, [])

                # 使用卡片格式发送（传递完整数据）
                success = send_company_report_to_feishu(
                    company=company,
                    report_text=report_text,  # 保留作为后备
                    ai_results=ai_results,
                    platforms_data=platforms_data,
                    all_accounts_config=all_accounts_config,
                    days_ago=days_ago
                )

                if success:
                    print(f"    ✓ {company} 日报推送成功")
                else:
                    print(f"    ❌ {company} 日报推送失败")

            print(f"\n✓ 推送完成，共 {len(reports)} 份日报已处理")
        print()
    else:
        print("⚠️ 跳过飞书推送步骤")
        print()

    print("=" * 60)
    print("✅ 日报工作流完成")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="竞品监控日报工作流")
    parser.add_argument("--input", "-i", help="输入JSON文件路径", default="/input/twitter_input.json")
    parser.add_argument("--days-ago", "-d", type=int, help="爬取多少天前的数据", default=1)
    parser.add_argument("--skip-ai", action="store_true", help="跳过AI分析步骤")
    parser.add_argument("--skip-send", action="store_true", help="跳过飞书推送")
    parser.add_argument("--companies", "-c", nargs="+", help="只处理指定的公司（可多个）", default=None)

    args = parser.parse_args()

    exit_code = run_daily_workflow(
        input_path=args.input,
        days_ago=args.days_ago,
        skip_ai=args.skip_ai,
        skip_send=args.skip_send,
        target_companies=args.companies,
    )

    sys.exit(exit_code)
