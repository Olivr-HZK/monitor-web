"""
从历史数据库读取一周的AI分析结果，生成周报并发送到飞书
"""
import os
import sys
import json
import argparse
from datetime import date, timedelta
from typing import Dict, Any, List, Optional
from collections import defaultdict

# 修复Windows控制台编码问题
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

from database.history_db import CompetitorHistoryDB
import requests
import yaml
import json


def load_input_json(input_path: str = None) -> Dict[str, Any]:
    """读取 input/twitter_input.json 配置"""
    if input_path is None:
        input_path = os.environ.get("COMPETITOR_INPUT_PATH", "/app/input/twitter_input.json")
        if not os.path.exists(input_path):
            rel_path = os.path.join("input", "twitter_input.json")
            if os.path.exists(rel_path):
                input_path = rel_path
            else:
                script_dir = os.path.dirname(os.path.abspath(__file__))
                alt_path = os.path.join(script_dir, "input", "twitter_input.json")
                if os.path.exists(alt_path):
                    input_path = alt_path

    if not os.path.exists(input_path):
        print(f"❌ 未找到输入文件: {input_path}")
        return {}

    try:
        with open(input_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        print(f"❌ 读取或解析输入失败: {exc}")
        return {}


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
                account["channel_id"] = (plat.get("channel_id") or "").strip()
                account["handle"] = (plat.get("handle") or "").strip().lstrip("@")
                account["url"] = (plat.get("url") or "").strip()
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
                    account["channel_id"] = (plat.get("channel_id") or "").strip()
                    account["handle"] = (plat.get("handle") or "").strip().lstrip("@")
                    account["url"] = (plat.get("url") or "").strip()
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


def send_company_report_to_feishu(company: str, report_text: str) -> bool:
    """发送公司报告到飞书"""
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

    if not report_text.strip():
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
        print(f"  [调试] 推送内容长度: {len(report_text)} 字符")
        print(f"  [调试] Webhook: {webhook[:50]}...")

        resp = requests.post(webhook, json=payload, timeout=20)

        print(f"  [调试] 响应状态码: {resp.status_code}")
        if resp.status_code != 200:
            print(f"  [调试] 响应内容: {resp.text[:500]}")

        if resp.status_code == 200:
            result = resp.json()
            if result.get("code") == 0:
                print(f"  ✓ 报告已推送到飞书")
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


def load_weekly_ai_analysis(
    db: CompetitorHistoryDB,
    company: str,
    start_date: date,
    end_date: date
) -> Dict[str, List[Dict[str, Any]]]:
    """
    从数据库加载一周的AI分析结果，按平台分组

    Returns:
        {platform_key: [ai_result1, ai_result2, ...], ...}
    """
    weekly_data = defaultdict(list)

    current_date = start_date
    while current_date <= end_date:
        ai_data = db.load_ai_analysis(company, current_date)
        if ai_data:
            results = ai_data.get("results", {})
            if not results and "companies" in ai_data:
                # 兼容新格式
                company_data = ai_data.get("companies", {}).get(company, {})
                results = company_data.get("results", {})

            for title, payload in results.items():
                # 提取平台信息
                platform = payload.get("platform", "")
                game = payload.get("game")
                platform_key = f"{platform}"
                if game:
                    platform_key = f"{platform}_{game}"

                # 添加日期信息
                payload_with_date = payload.copy()
                payload_with_date["date"] = current_date.strftime("%Y-%m-%d")
                weekly_data[platform_key].append(payload_with_date)

        current_date += timedelta(days=1)

    return dict(weekly_data)


def load_weekly_raw_data(
    db: CompetitorHistoryDB,
    company: str,
    start_date: date,
    end_date: date
) -> Dict[str, List[Dict[str, Any]]]:
    """
    从数据库加载一周的原始数据，按平台分组

    Returns:
        {platform_key: [platform_data1, platform_data2, ...], ...}
    """
    weekly_data = defaultdict(list)

    current_date = start_date
    while current_date <= end_date:
        raw_data = db.load_raw_data(company, current_date)
        if raw_data:
            platforms_dict = raw_data.get("platforms", {})
            if not platforms_dict:
                # 尝试从新格式中获取
                all_data = db.load_raw_data_by_date(current_date)
                if all_data:
                    companies_dict = all_data.get("companies", {})
                    company_data = companies_dict.get(company, {})
                    platforms_dict = company_data.get("platforms", {})

            for key, platform_info in platforms_dict.items():
                platform_data = {
                    "platform_type": platform_info.get("platform_type", ""),
                    "game": platform_info.get("game"),
                    "url": platform_info.get("url", ""),
                    "posts": platform_info.get("posts", []),
                    "posts_count": platform_info.get("posts_count", 0),
                    "date": current_date.strftime("%Y-%m-%d"),
                }
                weekly_data[key].append(platform_data)

        current_date += timedelta(days=1)

    return dict(weekly_data)


def build_company_weekly_report(
    company: str,
    weekly_ai_data: Dict[str, List[Dict[str, Any]]],
    weekly_raw_data: Dict[str, List[Dict[str, Any]]],
    all_accounts_config: List[Dict[str, Any]] = None,
    start_date: date = None,
    end_date: date = None,
) -> str:
    """构建公司周报Markdown"""
    lines = []
    lines.append("=" * 60)
    lines.append(f"🏢 {company} - 竞品监控周报")
    lines.append("=" * 60)

    # 报告日期范围
    if start_date and end_date:
        lines.append(f"📅 监控周期: {start_date.strftime('%Y-%m-%d')} 至 {end_date.strftime('%Y-%m-%d')}")
    else:
        lines.append(f"📅 监控周期: 最近一周")

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

    # 统计信息
    total_posts = 0
    total_platforms = len(weekly_ai_data)
    active_days = set()

    for platform_data_list in weekly_raw_data.values():
        for platform_data in platform_data_list:
            total_posts += platform_data.get("posts_count", 0)
            if platform_data.get("date"):
                active_days.add(platform_data.get("date"))

    lines.append("📊 本周统计")
    lines.append("-" * 60)
    lines.append(f"   • 活跃平台数: {total_platforms}")
    lines.append(f"   • 总发帖数: {total_posts}")
    lines.append(f"   • 活跃天数: {len(active_days)} 天")
    lines.append("")

    # 按平台汇总分析
    if weekly_ai_data:
        lines.append("📈 平台周报汇总")
        lines.append("-" * 60)
        lines.append("")

        # 按平台分组展示
        platform_icons = {
            "twitter": "🐦",
            "tiktok": "🎵",
            "youtube": "▶️",
            "facebook": "📘",
            "instagram": "📷",
        }

        for platform_key, ai_results_list in sorted(weekly_ai_data.items()):
            if not ai_results_list:
                continue

            # 解析平台信息
            parts = platform_key.split("_", 1)
            platform = parts[0] if parts else ""
            game = parts[1] if len(parts) > 1 else None

            icon = platform_icons.get(platform.lower(), "🌐")

            # 子标题
            sub_title = f"{icon} "
            if game:
                sub_title += f"{game} - {platform.upper()}"
            else:
                sub_title += f"{company} 官方账号 - {platform.upper()}"

            lines.append(sub_title)
            lines.append("")

            # 汇总本周数据
            total_posts_platform = 0
            avg_score = 0.0
            score_count = 0
            all_summaries = []
            all_insights = []
            all_suggestions = []
            dates_with_posts = []

            for ai_result in ai_results_list:
                posts_count = ai_result.get("posts_count", 0)
                if posts_count > 0:
                    total_posts_platform += posts_count
                    dates_with_posts.append(ai_result.get("date", ""))

                score = ai_result.get("usability_score", 0)
                try:
                    score_val = float(score)
                    if score_val > 0:
                        avg_score += score_val
                        score_count += 1
                except Exception:
                    pass

                analysis = ai_result.get("analysis", {})
                if analysis:
                    summary = analysis.get("summary", "")
                    if summary:
                        all_summaries.append(summary)

                    ad_insight = analysis.get("ad_creative_insights", "")
                    gameplay_insight = analysis.get("gameplay_or_mechanic_insights", "")
                    if ad_insight:
                        all_insights.append(f"广告创意: {ad_insight}")
                    if gameplay_insight:
                        all_insights.append(f"玩法机制: {gameplay_insight}")

                    actions = analysis.get("direct_action_suggestions", "")
                    if actions:
                        if isinstance(actions, list):
                            all_suggestions.extend(actions)
                        else:
                            all_suggestions.append(actions)

            # 显示汇总信息
            url = ai_results_list[0].get("url", "") if ai_results_list else ""
            if url:
                lines.append(f"   🔗 链接: {url}")

            if total_posts_platform > 0:
                lines.append(f"   📝 本周发帖数: {total_posts_platform} 条")
                lines.append(f"   📅 活跃日期: {', '.join(sorted(set(dates_with_posts)))}")

            if score_count > 0:
                avg_score = avg_score / score_count
                score_icon = "⭐" * min(int(avg_score / 2), 5) if avg_score > 0 else ""
                lines.append(f"   📊 平均可用性评分: {avg_score:.1f} {score_icon}")

            lines.append("")

            # 汇总分析内容（去重并合并）
            if all_summaries:
                unique_summaries = list(dict.fromkeys(all_summaries))  # 保持顺序的去重
                if len(unique_summaries) == 1:
                    lines.append(f"   📝 本周摘要: {unique_summaries[0]}")
                else:
                    lines.append(f"   📝 本周摘要:")
                    for idx, summary in enumerate(unique_summaries[:3], 1):  # 最多显示3条
                        lines.append(f"      {idx}. {summary}")
                lines.append("")

            if all_insights:
                unique_insights = list(dict.fromkeys(all_insights))
                lines.append(f"   🎯 本周洞察:")
                for idx, insight in enumerate(unique_insights[:5], 1):  # 最多显示5条
                    lines.append(f"      {idx}. {insight}")
                lines.append("")

            if all_suggestions:
                unique_suggestions = list(dict.fromkeys(all_suggestions))
                lines.append(f"   ✅ 本周建议:")
                for idx, suggestion in enumerate(unique_suggestions[:5], 1):  # 最多显示5条
                    if isinstance(suggestion, str):
                        lines.append(f"      {idx}. {suggestion}")
                lines.append("")

            lines.append("-" * 60)
            lines.append("")
    else:
        lines.append("⚠️ 本周无AI分析数据")
        lines.append("")

    # 附录：本周所有原帖URL列表
    lines.append("=" * 60)
    lines.append("📎 本周原帖链接")
    lines.append("=" * 60)
    lines.append("")

    post_urls = []
    for platform_key, platform_data_list in weekly_raw_data.items():
        parts = platform_key.split("_", 1)
        platform = parts[0] if parts else ""
        game = parts[1] if len(parts) > 1 else None

        for platform_data in platform_data_list:
            posts = platform_data.get("posts", [])
            date_str = platform_data.get("date", "")

            for post in posts:
                post_url = post.get("post_url") or post.get("link", "")
                if post_url:
                    label = f"{platform}"
                    if game:
                        label = f"{platform} - {game}"
                    if date_str:
                        label = f"[{date_str}] {label}"
                    post_urls.append(f"   • {label}: {post_url}")

    if post_urls:
        lines.extend(post_urls)
    else:
        lines.append("   （无原帖链接）")

    lines.append("")
    lines.append("=" * 60)

    return "\n".join(lines)


def generate_weekly_report_from_db(
    company: str,
    start_date: date,
    end_date: date,
    db: CompetitorHistoryDB,
    input_path: Optional[str] = None
) -> Optional[str]:
    """从数据库生成公司周报"""
    print(f"\n  📖 读取 {company} 一周的数据...")
    print(f"     日期范围: {start_date} 至 {end_date}")

    # 1. 加载一周的AI分析结果
    weekly_ai_data = load_weekly_ai_analysis(db, company, start_date, end_date)
    print(f"    ✓ 找到 {len(weekly_ai_data)} 个平台有AI分析数据")

    # 2. 加载一周的原始数据
    weekly_raw_data = load_weekly_raw_data(db, company, start_date, end_date)
    print(f"    ✓ 找到 {len(weekly_raw_data)} 个平台有原始数据")

    # 3. 加载所有平台配置
    all_accounts_config = None
    if input_path:
        try:
            input_data = load_input_json(input_path)
            if input_data:
                companies_config = parse_all_platform_accounts(input_data)
                all_accounts_config = companies_config.get(company, [])
                print(f"    ✓ 加载了 {len(all_accounts_config)} 个平台的配置")
        except Exception as exc:
            print(f"    ⚠️ 加载平台配置失败: {exc}")

    # 4. 生成周报
    print(f"    📝 生成周报...")
    report_text = build_company_weekly_report(
        company=company,
        weekly_ai_data=weekly_ai_data,
        weekly_raw_data=weekly_raw_data,
        all_accounts_config=all_accounts_config,
        start_date=start_date,
        end_date=end_date,
    )

    print(f"    ✓ 周报生成完成，长度: {len(report_text)} 字符")
    return report_text


def run_weekly_report_workflow(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    target_companies: Optional[List[str]] = None,
    skip_send: bool = False,
    input_path: Optional[str] = None,
    days_back: int = 7,
):
    """
    从数据库读取一周的AI分析结果，生成周报并发送到飞书

    Args:
        start_date: 开始日期，如果为None则使用 days_back 计算
        end_date: 结束日期，如果为None则使用昨天
        target_companies: 目标公司列表，如果为None则处理所有有数据的公司
        skip_send: 是否跳过发送到飞书
        input_path: 输入JSON文件路径
        days_back: 从今天往前推多少天（默认7天，即最近一周）
    """
    print("=" * 60)
    print("📊 从数据库生成周报工作流")
    print("=" * 60)
    print()

    # 确定日期范围
    if end_date is None:
        end_date = date.today() - timedelta(days=1)  # 昨天

    if start_date is None:
        start_date = end_date - timedelta(days=days_back - 1)  # 往前推 days_back 天

    print(f"📅 日期范围: {start_date} 至 {end_date}")
    print()

    # 确定输入路径
    if input_path is None:
        input_path = os.environ.get("COMPETITOR_INPUT_PATH")
        if not input_path:
            rel_path = os.path.join("input", "twitter_input.json")
            if os.path.exists(rel_path):
                input_path = rel_path
            else:
                script_dir = os.path.dirname(os.path.abspath(__file__))
                alt_path = os.path.join(script_dir, "input", "twitter_input.json")
                if os.path.exists(alt_path):
                    input_path = alt_path

    if input_path and os.path.exists(input_path):
        print(f"📋 输入配置文件: {input_path}")
    else:
        print(f"⚠️ 未找到输入配置文件，将无法显示所有平台来源")
        input_path = None

    print()

    # 初始化数据库
    db = CompetitorHistoryDB()

    # 确定要处理的公司列表
    if target_companies:
        companies = target_companies
        print(f"📋 指定公司: {', '.join(companies)}")
    else:
        # 获取日期范围内所有有数据的公司
        companies_set = set()
        current_date = start_date
        while current_date <= end_date:
            companies_list = db.get_companies_for_date(current_date, is_ai=True)
            if not companies_list:
                companies_list = db.get_companies_for_date(current_date, is_ai=False)
            companies_set.update(companies_list)
            current_date += timedelta(days=1)

        companies = sorted(list(companies_set))
        print(f"📋 找到 {len(companies)} 个公司有数据: {', '.join(companies) if companies else '无'}")

    if not companies:
        print("⚠️ 未找到任何公司的数据，退出")
        return

    print()

    # 处理每个公司
    success_count = 0
    fail_count = 0

    for company in companies:
        print(f"\n{'=' * 60}")
        print(f"🏢 处理公司: {company}")
        print(f"{'=' * 60}")

        try:
            # 生成周报
            report_text = generate_weekly_report_from_db(
                company=company,
                start_date=start_date,
                end_date=end_date,
                db=db,
                input_path=input_path
            )

            if not report_text:
                print(f"  ❌ {company} 周报生成失败")
                fail_count += 1
                continue

            # 保存周报到文件
            output_dir = os.environ.get("OUTPUT_DIR")
            if not output_dir or not os.path.exists(output_dir):
                alt_dir = os.path.join(os.path.dirname(__file__), "output")
                if not os.path.exists(alt_dir):
                    os.makedirs(alt_dir, exist_ok=True)
                output_dir = alt_dir

            start_str = start_date.strftime("%Y-%m-%d")
            end_str = end_date.strftime("%Y-%m-%d")
            safe_company = "".join(c for c in company if c.isalnum() or c in (' ', '-', '_')).strip()
            safe_company = safe_company.replace(' ', '_').lower()
            report_file = os.path.join(output_dir, f"weekly_report_{safe_company}_{start_str}_to_{end_str}.md")

            try:
                with open(report_file, "w", encoding="utf-8") as f:
                    f.write(report_text)
                print(f"  💾 周报已保存: {report_file}")
            except Exception as exc:
                print(f"  ⚠️ 保存周报失败: {exc}")

            # 发送到飞书
            if not skip_send:
                print(f"\n  📤 发送 {company} 的周报到飞书...")
                success = send_company_report_to_feishu(company, report_text)
                if success:
                    print(f"    ✓ {company} 周报已发送到飞书")
                    success_count += 1
                else:
                    print(f"    ❌ {company} 周报发送失败")
                    fail_count += 1
            else:
                print(f"  ⏭️ 跳过发送到飞书")
                success_count += 1

        except Exception as exc:
            print(f"  ❌ 处理 {company} 时出错: {exc}")
            import traceback
            print(f"  [调试] 错误详情: {traceback.format_exc()}")
            fail_count += 1

    # 总结
    print()
    print("=" * 60)
    print("📊 周报工作流完成")
    print("=" * 60)
    print(f"✓ 成功: {success_count} 个公司")
    if fail_count > 0:
        print(f"❌ 失败: {fail_count} 个公司")
    print()


def main():
    """命令行入口"""
    parser = argparse.ArgumentParser(description="从数据库读取一周的AI分析结果，生成周报并发送到飞书")
    parser.add_argument(
        "--start-date",
        type=str,
        help="开始日期 (YYYY-MM-DD)，如果不指定则使用 --days-back 计算",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        help="结束日期 (YYYY-MM-DD)，如果不指定则使用昨天",
    )
    parser.add_argument(
        "--days-back",
        type=int,
        default=7,
        help="从结束日期往前推多少天（默认: 7，即最近一周）",
    )
    parser.add_argument(
        "--companies",
        type=str,
        nargs="+",
        help="指定要处理的公司列表（空格分隔）",
    )
    parser.add_argument(
        "--skip-send",
        action="store_true",
        help="跳过发送到飞书，只生成报告文件",
    )
    parser.add_argument(
        "--input",
        type=str,
        help="输入JSON文件路径（用于获取所有平台配置）",
    )

    args = parser.parse_args()

    # 解析日期
    start_date = None
    if args.start_date:
        try:
            start_date = date.fromisoformat(args.start_date)
        except ValueError:
            print(f"❌ 无效的开始日期格式: {args.start_date}，请使用 YYYY-MM-DD")
            return 1

    end_date = None
    if args.end_date:
        try:
            end_date = date.fromisoformat(args.end_date)
        except ValueError:
            print(f"❌ 无效的结束日期格式: {args.end_date}，请使用 YYYY-MM-DD")
            return 1

    # 运行工作流
    run_weekly_report_workflow(
        start_date=start_date,
        end_date=end_date,
        target_companies=args.companies,
        skip_send=args.skip_send,
        input_path=args.input,
        days_back=args.days_back,
    )

    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
