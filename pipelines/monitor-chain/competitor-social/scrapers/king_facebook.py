"""
专门爬取 King 公司及其旗下游戏的 Facebook 数据
参考 CompetitorDailyScraperFromDB.py 的实现方式
"""
import os
import sys
import json
from datetime import date, datetime, timezone, timedelta
from typing import Dict, List, Any, Optional

import env_loader  # noqa: F401

from scrapers.facebook import _fetch_facebook_raw, parse_facebook_posts


def load_king_company_from_json(json_path: str = "input/twitter_input.json") -> Optional[Dict[str, Any]]:
    """从 JSON 文件加载 King 公司配置"""
    try:
        if not os.path.exists(json_path):
            print(f"❌ 文件不存在: {json_path}")
            return None

        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        competitors = data.get("competitors", [])
        for competitor in competitors:
            if competitor.get("name", "").lower() == "king":
                return competitor

        print(f"❌ 在 {json_path} 中未找到 King 公司")
        return None

    except Exception as exc:
        print(f"❌ 读取 JSON 文件失败: {exc}")
        import traceback
        print(f"[调试] 错误详情: {traceback.format_exc()}")
        return None


def scrape_facebook_platform(
    platform: Dict[str, Any],
    company: str,
    game: Optional[str] = None,
    days_ago: Optional[int] = None
) -> Dict[str, Any]:
    """
    爬取 Facebook 平台数据（参考 CompetitorDailyScraperFromDB.py 的实现）

    Args:
        platform: 平台配置字典
        company: 公司名称
        game: 游戏名称（可选）
        days_ago: 爬取多少天前的数据（None 表示不过滤日期，获取最新数据）

    Returns:
        包含爬取结果的字典
    """
    page_id = platform.get("page_id", "")
    url = platform.get("url", "")

    display_name = f"{company} - {game}" if game else company

    print(f"\n  [Facebook] {display_name}")
    print(f"      URL: {url}")
    print(f"      Page ID: {page_id}")

    result = {
        "platform_type": "facebook",
        "company": company,
        "game": game,
        "page_id": page_id,
        "url": url,
        "posts": [],
        "posts_count": 0,
        "error": None
    }

    if not page_id:
        result["error"] = "未提供Facebook page_id"
        print(f"      ❌ {result['error']}")
        return result

    try:
        print(f"      📥 正在获取 Facebook 数据...")
        raw_json = _fetch_facebook_raw(page_id)

        if not raw_json:
            result["error"] = "无法获取Facebook数据（API 返回空）"
            print(f"      ❌ {result['error']}")
            return result

        print(f"      ✓ 成功获取原始 JSON 数据")

        # 解析帖子（获取最多50条，然后根据日期过滤）
        posts = parse_facebook_posts(raw_json, max_posts=50)
        print(f"      ℹ️ 解析到 {len(posts)} 条帖子（解析后）")

        # 如果指定了 days_ago，过滤当天的数据
        if days_ago is not None:
            target_day = date.today() - timedelta(days=days_ago)
            filtered_posts = []
            for post in posts:
                post_time_str = post.get("time", "")
                if post_time_str:
                    try:
                        if post_time_str.endswith("Z"):
                            post_dt = datetime.fromisoformat(post_time_str.replace("Z", "+00:00"))
                        else:
                            post_dt = datetime.fromisoformat(post_time_str)
                        post_date = post_dt.date()

                        if post_date == target_day:
                            filtered_posts.append(post)
                    except Exception as e:
                        print(f"      ⚠️ 解析时间失败: {post_time_str}, 错误: {e}")
                        pass
            posts = filtered_posts
            print(f"      ℹ️ 日期过滤后剩余 {len(posts)} 条帖子")
        else:
            # 不过滤日期，只取最新5条
            posts = posts[:5]
            print(f"      ℹ️ 取最新5条帖子")

        result["posts"] = posts
        result["posts_count"] = len(posts)

        if posts:
            print(f"      ✅ 成功获取 {len(posts)} 条帖子")
        else:
            result["error"] = "未获取到任何帖子（可能该页面没有帖子，或日期过滤后无结果）"
            print(f"      ⚠️ {result['error']}")

    except Exception as exc:
        result["error"] = str(exc)
        print(f"      ❌ Facebook爬取失败: {exc}")
        import traceback
        print(f"      [调试] 错误详情: {traceback.format_exc()}")

    return result


def scrape_all_king_facebook(days_ago: Optional[int] = None) -> Dict[str, Any]:
    """
    爬取 King 公司及其所有游戏的 Facebook 数据

    Args:
        days_ago: 爬取多少天前的数据（None 表示不过滤日期，获取最新数据）

    Returns:
        包含所有爬取结果的字典
    """
    print("=" * 60)
    print("🕷️  King 公司 Facebook 数据爬取")
    print("=" * 60)

    # 1. 读取 King 公司配置
    print("\n📖 步骤 1: 读取 King 公司配置...")
    king_data = load_king_company_from_json()
    if not king_data:
        print("❌ 无法加载 King 公司数据，退出")
        return {}

    company = king_data.get("name", "King")
    print(f"✅ 成功加载 King 公司数据")
    print(f"   公司名称: {company}")
    print(f"   公司级平台数: {len(king_data.get('platforms', []))}")
    print(f"   游戏数: {len(king_data.get('games', []))}")

    # 2. 爬取公司级 Facebook 平台
    print("\n📊 步骤 2: 爬取公司级 Facebook 平台...")
    company_platforms = king_data.get("platforms", [])
    company_results = []

    for platform in company_platforms:
        platform_type = platform.get("type", "").lower()
        enabled = platform.get("enabled", True)

        if not enabled:
            print(f"\n  ⏭️ 跳过已禁用的平台: {platform_type}")
            continue

        if platform_type != "facebook":
            continue

        result = scrape_facebook_platform(platform, company, None, days_ago)
        company_results.append(result)

    # 3. 爬取游戏级 Facebook 平台
    print("\n📊 步骤 3: 爬取游戏级 Facebook 平台...")
    games = king_data.get("games", [])
    game_results = []

    for game_data in games:
        game_name = game_data.get("name", "")
        if not game_name:
            continue

        print(f"\n  🎮 游戏: {game_name}")
        game_platforms = game_data.get("platforms", [])

        for platform in game_platforms:
            platform_type = platform.get("type", "").lower()
            enabled = platform.get("enabled", True)

            if not enabled:
                print(f"\n    ⏭️ 跳过已禁用的平台: {platform_type}")
                continue

            if platform_type != "facebook":
                continue

            result = scrape_facebook_platform(platform, company, game_name, days_ago)
            game_results.append(result)

    # 4. 汇总结果
    all_results = {
        "company": company,
        "scraped_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "days_ago": days_ago,
        "company_platforms": company_results,
        "game_platforms": game_results,
        "summary": {
            "total_company_platforms": len(company_results),
            "total_game_platforms": len(game_results),
            "total_posts": (
                sum(p.get("posts_count", 0) for p in company_results) +
                sum(p.get("posts_count", 0) for p in game_results)
            ),
            "successful_platforms": (
                len([p for p in company_results if p.get("posts_count", 0) > 0]) +
                len([p for p in game_results if p.get("posts_count", 0) > 0])
            ),
            "failed_platforms": (
                len([p for p in company_results if p.get("error")]) +
                len([p for p in game_results if p.get("error")])
            ),
            "errors": [
                p.get("error") for p in company_results if p.get("error")
            ] + [
                p.get("error") for p in game_results if p.get("error")
            ]
        }
    }

    return all_results


def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(
        description="爬取 King 公司及其旗下游戏的 Facebook 数据"
    )
    parser.add_argument(
        "--days-ago",
        type=int,
        default=None,
        help="爬取多少天前的数据（默认: None，即获取最新数据，不过滤日期）"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="output/king_facebook_scrape_result.json",
        help="输出文件路径（默认: output/king_facebook_scrape_result.json）"
    )

    args = parser.parse_args()

    # 爬取数据
    results = scrape_all_king_facebook(days_ago=args.days_ago)

    if not results:
        print("\n❌ 爬取失败，退出")
        return 1

    # 保存结果
    print("\n💾 步骤 4: 保存结果到文件...")
    output_file = args.output
    os.makedirs(os.path.dirname(output_file), exist_ok=True)

    try:
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"✅ 结果已保存到: {output_file}")
    except Exception as exc:
        print(f"❌ 保存结果文件失败: {exc}")
        return 1

    # 打印摘要
    print("\n" + "=" * 60)
    print("📊 爬取摘要")
    print("=" * 60)
    summary = results["summary"]
    print(f"公司级平台: {summary['total_company_platforms']} 个")
    print(f"游戏级平台: {summary['total_game_platforms']} 个")
    print(f"总帖子数: {summary['total_posts']} 条")
    print(f"成功平台: {summary['successful_platforms']} 个")
    if summary['failed_platforms'] > 0:
        print(f"失败平台: {summary['failed_platforms']} 个")
        print(f"\n错误列表:")
        for error in summary['errors']:
            print(f"  - {error}")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    sys.exit(main())
