#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
游戏行业资讯周报 - Puzzle Game 出海市场
每周一 07:00 生成分析，10:00 分渠道推送
"""

import sqlite3
import requests
import json
import hashlib
from datetime import datetime, timedelta
import os
import sys
from pathlib import Path
import re
import argparse
from decimal import Decimal, ROUND_HALF_UP

# 配置
FEISHU_WEBHOOK = os.environ.get(
    "FEISHU_WEBHOOK",
    os.environ.get(
        "FEISHU_WEEKLY_WEBHOOK_URL",
        os.environ.get("FEISHU_WEBHOOK_URL", ""),
    ),
)
WEWORK_WEBHOOK = os.environ.get(
    "WEWORK_WEBHOOK",
    os.environ.get(
        "WEWORK_WEBHOOK_URL",
        os.environ.get(
            "WECOM_WEBHOOK_URL_REAL",
            os.environ.get("WECOM_WEBHOOK_URL", ""),
        ),
    ),
)
AI_API_KEY = os.environ.get(
    "AI_API_KEY",
    os.environ.get(
        "OPENROUTER_API_KEY",
        "",
    ),
)
AI_MODEL = os.environ.get("AI_MODEL", "qwen/qwen3.7-max")
AI_API_BASE = os.environ.get("AI_API_BASE", "https://openrouter.ai/api/v1")
AI_FALLBACK_MODEL = os.environ.get("AI_FALLBACK_MODEL", "qwen/qwen3.7-max")
AI_FALLBACK_API_KEY = os.environ.get(
    "AI_FALLBACK_API_KEY",
    os.environ.get("OPENROUTER_API_KEY", AI_API_KEY),
)
AI_FALLBACK_API_BASE = os.environ.get(
    "AI_FALLBACK_API_BASE",
    "https://openrouter.ai/api/v1",
)
AI_VALIDATION_MODEL = os.environ.get("AI_VALIDATION_MODEL", "qwen/qwen3.7-max")
WEWORK_MD_MAX_LEN = int(os.environ.get("WEWORK_MD_MAX_LEN", "3900"))

# 默认从项目内的 TrendRadar 输出目录读取 RSS SQLite DB
PROJECT_ROOT = Path(__file__).resolve().parent
LOCAL_PUSH_DISABLED_ROOT = Path("/Users/ggbond/lyb/gaming-daily-report2").resolve()
# run_gaming_daily.sh 在项目根目录启动 trendradar，因此默认输出是 `./output/rss/`
DEFAULT_RSS_DB_DIR_CWD = PROJECT_ROOT / "output" / "rss"
DEFAULT_RSS_DB_DIR_TREND = PROJECT_ROOT / "TrendRadar" / "output" / "rss"
_fallback_rss_dir = (
    DEFAULT_RSS_DB_DIR_CWD
    if DEFAULT_RSS_DB_DIR_CWD.exists()
    else DEFAULT_RSS_DB_DIR_TREND
)
RSS_DB_DIR = os.environ.get("RSS_DB_DIR", str(_fallback_rss_dir))
WEEKLY_REPORT_JSON_DIR = PROJECT_ROOT / "output" / "weekly_reports"
WEEKLY_REPORT_FILE_GLOB = "weekly_report_*.json"
WEEKLY_REPAIR_DIR = PROJECT_ROOT / "output" / "weekly_repairs"
GURU_MONITOR_ROOT = Path(os.environ.get("GURU_MONITOR_ROOT", "/Users/ggbond/lyb/guru-monitor"))


def _local_push_disabled():
    return PROJECT_ROOT == LOCAL_PUSH_DISABLED_ROOT

SECTION_HEADING_EN = {
    "**🔥 本周 Top 3 大事**": "**🔥 Top 3 This Week**",
    "**一、竞品与头部动态**": "**1. Competitor and Leading Publisher Moves**",
    "**二、玩法与机制创新**": "**2. Gameplay and Mechanic Innovation**",
    "**三、游戏厂商的AI探索**": "**3. Game Publishers' AI Exploration**",
    "**四、买量风向与素材**": "**4. UA Trends and Creative Signals**",
    "**五、新兴市场机会**": "**5. Emerging Market Opportunities**",
    "**六、分析师洞察**": "**6. Analyst Takeaways**",
}
SECTION_HEADING_ZH = {v: k for k, v in SECTION_HEADING_EN.items()}

# 游戏公司名单
GAME_COMPANIES = [
    "ncsoft", "justplay", "capcom", "konami", "sega", "bandai", "namco",
    "king", "playrix", "zynga", "supercell", "rovio", "glu", "jam city",
    "scopely", "playtika", "huuuge", "product madness",
    "tencent", "netease", "mihoyo", "lilith", "funplus",
    "腾讯", "网易", "米哈游", "莉莉丝", "三七", "完美", "巨人",
    "unity", "unreal", "epic games", "roblox",
    "nintendo", "sony", "playstation", "microsoft", "xbox",
    "activision", "blizzard", "ea", "electronic arts", "ubisoft",
    "take-two", "rockstar", "valve", "steam"
]

# 周报三条主信源：等权重（传给 AI 的前 N 条里轮询混合，避免某一源刷屏）
PRIMARY_TRIO_FEEDS = ("mobilegamer", "gamesindustry", "pocketgamer-biz")
# 旧配置/历史数据里的 feed_id → 归入哪条「主源」桶参与均衡
FEED_ID_ALIASES = {"pocketgamer": "pocketgamer-biz"}
# 与 weekly_ai_validator.py 的候选遗漏检查对齐，避免验证器检查生成器未看见的候选。
BALANCED_HEAD_LIMIT = int(os.environ.get("WEEKLY_GENERATION_CANDIDATE_LIMIT", "180"))

WORKPLACE_EXCLUSION_KEYWORDS = (
    "layoff", "layoffs", "workplace culture", "work culture", "job security",
    "brain drain", "hiring", "career", "recruitment", "redundancy",
    "staff morale", "headcount", "hr strategy", "people strategy",
    "toxic culture", "burnout", "union", "职场", "裁员", "工作文化",
    "企业文化", "组织文化", "招聘", "求职", "岗位", "脑流失"
)

LOW_SIGNAL_ROUNDUP_KEYWORDS = (
    "on the podcast:",
    "podcast:",
    "subscribe to the mobilegamer.biz podcast",
)

GENERIC_DIGEST_KEYWORDS = (
    "data digest:",
    "plenty more",
    "round-up",
    "roundup",
    "week in views",
)

PUZZLE_SPECIFIC_SIGNALS = (
    "puzzle", "match-3", "merge", "word game", "hidden object", "solitaire",
    "casual game", "candy crush", "royal match", "gardenscapes", "homescapes",
    "fishdom", "project makeover", "merge mansion", "wordscapes", "nyt games",
    "sort", "mahjong", "jigsaw"
)

CASUAL_GAME_COMPANIES = (
    "king", "playrix", "scopely", "zynga", "supercell", "rovio", "jam city",
    "playtika", "huuuge", "product madness", "dream games", "moon active",
    "tripledot", "metacore", "superplay", "candivore", "saygames", "voodoo",
    "homa", "tactile", "rollic", "peak"
)

TOP_GAME_COMPANIES = (
    "tencent", "netease", "mihoyo", "lilith", "funplus", "king", "playrix",
    "scopely", "supercell", "zynga", "rovio", "nintendo", "sony",
    "playstation", "microsoft", "xbox", "activision", "blizzard", "ea",
    "electronic arts", "ubisoft", "take-two", "rockstar", "valve", "steam",
    "epic games", "roblox", "capcom", "konami", "bandai", "namco", "sega"
)

AI_TOOL_KEYWORDS = (
    "ai", "aigc", "generative ai", "genai", "agentic ai", "llm",
    "ai tool", "ai tools", "ai assistant", "copilot", "automation",
    "workflow", "productivity", "efficiency", "tooling", "pipeline",
    "prompt", "model", "assistant", "智能工具", "ai工具", "生成式ai",
    "大模型", "智能助手", "自动化", "提效", "效率"
)

GAME_DEV_AI_APPLICATION_KEYWORDS = (
    "game development", "game dev", "level generation", "level design",
    "content pipeline", "asset generation", "creative pipeline", "prototype",
    "prototyping", "testing", "qa", "liveops", "live ops", "game design",
    "content production", "content iteration", "meme in their level",
    "关卡生成", "关卡设计", "游戏开发", "开发提效", "内容生产", "素材生产",
    "原型验证", "测试自动化", "活动内容", "关卡生产", "工作流", "游戏设计"
)


def _normalize_feed_id_for_balance(feed_id):
    fid = (feed_id or "").strip().lower()
    return FEED_ID_ALIASES.get(fid, fid)


def _balance_game_news_for_weekly(items):
    """
    三主信源等权：对主三源各自按时间从新到旧排序后，按轮询拼出前 BALANCED_HEAD_LIMIT 条，
    再拼接三源剩余条目（按时间），最后拼接非主源条目（按时间）。
    """
    if not items:
        return items

    def _priority_date_key(x):
        return (x.get("priority_score") or 0, x.get("date") or "")

    buckets = {k: [] for k in PRIMARY_TRIO_FEEDS}
    rest = []
    for it in items:
        fid = _normalize_feed_id_for_balance(it.get("source"))
        if fid in buckets:
            buckets[fid].append(it)
        else:
            rest.append(it)

    for k in PRIMARY_TRIO_FEEDS:
        buckets[k].sort(key=_priority_date_key, reverse=True)
    rest.sort(key=_priority_date_key, reverse=True)

    merged = []
    while len(merged) < BALANCED_HEAD_LIMIT:
        progressed = False
        for k in PRIMARY_TRIO_FEEDS:
            if len(merged) >= BALANCED_HEAD_LIMIT:
                break
            if buckets[k]:
                merged.append(buckets[k].pop(0))
                progressed = True
        if not progressed:
            break

    remainder_priority = []
    for k in PRIMARY_TRIO_FEEDS:
        remainder_priority.extend(buckets[k])
    remainder_priority.sort(key=_priority_date_key, reverse=True)

    return merged + remainder_priority + rest


def _is_workplace_analysis_article(title, summary, url):
    text = " ".join([(title or "").lower(), (summary or "").lower(), (url or "").lower()])
    hits = sum(1 for keyword in WORKPLACE_EXCLUSION_KEYWORDS if keyword in text)
    if hits == 0:
        return False
    if "/opinion" in (url or "").lower():
        return True
    title_lower = (title or "").lower()
    strong_title_signals = (
        "layoff", "layoffs", "workplace culture", "job security",
        "brain drain", "裁员", "职场", "工作文化", "企业文化"
    )
    return any(signal in title_lower for signal in strong_title_signals) or hits >= 2


def _is_low_signal_roundup_article(title, summary, url):
    title_lower = (title or "").lower()
    url_lower = (url or "").lower()
    if any(keyword in title_lower for keyword in LOW_SIGNAL_ROUNDUP_KEYWORDS):
        return True
    if "podcast" in url_lower and ("subscribe" in url_lower or "podcast-now" in url_lower):
        return True
    return False


def _is_generic_digest_without_puzzle_focus(title, summary, url):
    text = " ".join([(title or "").lower(), (summary or "").lower(), (url or "").lower()])
    if not any(keyword in text for keyword in GENERIC_DIGEST_KEYWORDS):
        return False
    return not any(signal in text for signal in PUZZLE_SPECIFIC_SIGNALS)


def _dedupe_news_by_link(items):
    deduped = []
    seen_links = set()
    for item in items:
        link = (item.get("link") or "").strip()
        if not link:
            deduped.append(item)
            continue
        if link in seen_links:
            continue
        seen_links.add(link)
        deduped.append(item)
    return deduped


def _compute_ai_priority(item):
    text = " ".join([
        (item.get("title") or "").lower(),
        (item.get("summary") or "").lower(),
        (item.get("link") or "").lower(),
        (item.get("source") or "").lower(),
    ])

    has_ai_tool_signal = any(keyword in text for keyword in AI_TOOL_KEYWORDS)
    has_game_dev_ai_signal = any(keyword in text for keyword in GAME_DEV_AI_APPLICATION_KEYWORDS)
    has_casual_company = any(company in text for company in CASUAL_GAME_COMPANIES)
    has_top_company = any(company in text for company in TOP_GAME_COMPANIES)

    if has_casual_company and has_ai_tool_signal:
        return 3, "高优先级：休闲游戏公司使用 AI 工具（新产品开发或提效）"
    if has_top_company and has_ai_tool_signal:
        return 2, "次高优先级：头部游戏公司使用 AI 工具"
    if has_ai_tool_signal and has_game_dev_ai_signal:
        return 1, "次高优先级：AI 工具应用于游戏开发"
    return 0, ""


def _should_preserve_despite_workplace_exclusion(item):
    priority_score, _ = _compute_ai_priority(item)
    text = " ".join([
        (item.get("title") or "").lower(),
        (item.get("summary") or "").lower(),
        (item.get("link") or "").lower(),
    ])
    product_signal_keywords = (
        "ai use", "automation", "level", "levels", "level management",
        "testing", "live ops", "liveops", "player insights", "player research",
        "competition", "match 3", "match-3", "two by two"
    )
    has_product_signal = any(keyword in text for keyword in product_signal_keywords)
    is_specific_known_article = (
        "candy-crush-maker-king-on-ai-use-layoffs-workplace-culture-and-the-competition" in text
    )
    return priority_score >= 3 and (has_product_signal or is_specific_known_article)


def _sort_news_by_priority(items):
    prioritized = []
    for item in items:
        priority, reason = _compute_ai_priority(item)
        cloned = dict(item)
        cloned["priority_score"] = priority
        cloned["priority_reason"] = reason
        prioritized.append(cloned)

    prioritized.sort(
        key=lambda x: (
            x.get("priority_score") or 0,
            x.get("date") or "",
        ),
        reverse=True,
    )
    return prioritized


def _build_strategic_hint(item):
    title = (item.get("title") or "").lower()
    url = (item.get("link") or "").lower()
    priority_reason = item.get("priority_reason") or ""
    if "candy-crush-maker-king-on-ai-use-layoffs-workplace-culture-and-the-competition" in url:
        return (
            "高优先级：**King / Candy Crush** 使用 AI 与 automation 支持 level management，"
            "在约 **21,000** 个关卡规模下快速识别过难、可被轻易破关的问题并提前修复，"
            "同时加快新关卡测试与上线前质量控制，把设计师产能释放到创意与创新工作；"
            "文中还提到 **Candy Crush** 去年补上了市场已普及的 **two by two** matching 机制，"
            "说明头部休闲产品正在用 AI + 玩家研究 + 快速产品跟进来应对 **Royal Match** 等竞品。"
        )
    if priority_reason:
        return priority_reason
    if "how china came to dominate mobile games" in title or "how-china-came-to-dominate-mobile-games" in url:
        return "战略线索：文中强调中国团队会把 TikTok 上表现好的 meme 很快做进具体关卡，甚至次日就上线同类内容，体现出内容迭代、关卡生产与热点素材联动效率。分析时优先提炼这类具体打法，而不是泛泛讨论中国厂商优势。"
    return ""


def _extract_chat_content(result):
    """从 OpenAI/OpenRouter 兼容响应中提取文本，并给出更清晰的错误。"""
    choices = result.get("choices")
    if not choices:
        error = result.get("error")
        if isinstance(error, dict):
            message = error.get("message") or json.dumps(error, ensure_ascii=False)
        else:
            message = json.dumps(result, ensure_ascii=False)[:1000]
        raise ValueError(f"AI 响应缺少 choices: {message}")

    message = choices[0].get("message", {})
    return message.get("content")


def _request_chat_completion(api_base, api_key, model, messages, temperature, max_tokens, timeout):
    url = f"{api_base.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    data = {
        "model": model,
        "messages": messages,
    }
    data["temperature"] = temperature
    data["max_tokens"] = max_tokens
    response = requests.post(url, headers=headers, json=data, timeout=timeout)
    if not response.ok:
        try:
            error_text = json.dumps(response.json(), ensure_ascii=False)
        except ValueError:
            error_text = response.text
        raise RuntimeError(
            f"LLM 请求失败: status={response.status_code}, body={_limit_text(error_text, 1200)}"
        )
    return response.json()


def _chat_completion_with_fallback(messages, temperature, max_tokens, timeout=120):
    routes = [{
        "label": "OpenRouter",
        "api_base": AI_API_BASE,
        "api_key": AI_API_KEY,
        "model": AI_MODEL,
    }]
    if AI_FALLBACK_API_KEY and AI_FALLBACK_MODEL:
        routes.append({
            "label": "OpenRouter fallback",
            "api_base": AI_FALLBACK_API_BASE,
            "api_key": AI_FALLBACK_API_KEY,
            "model": AI_FALLBACK_MODEL,
        })

    last_error = None
    for index, route in enumerate(routes):
        try:
            if index > 0:
                print(f"↪ 切换到备用 LLM 路径: {route['label']} / {route['model']}")
            result = _request_chat_completion(
                api_base=route["api_base"],
                api_key=route["api_key"],
                model=route["model"],
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=timeout,
            )
            return result, route
        except Exception as exc:
            last_error = exc
            if index < len(routes) - 1:
                print(f"⚠️ 主 LLM 路径调用失败，将尝试备用路径: {exc}")
            else:
                raise

    if last_error:
        raise last_error
    raise RuntimeError("未配置可用的 LLM 路径")


def _weekly_window_bounds(now=None):
    current = now or datetime.now()
    start_dt = datetime.combine((current - timedelta(days=7)).date(), datetime.min.time())
    end_exclusive_dt = datetime.combine((current + timedelta(days=1)).date(), datetime.min.time())
    return start_dt, end_exclusive_dt


def _parse_published_at(value):
    if not value:
        return None

    text = str(value).strip()
    if not text:
        return None

    candidates = [text]
    if text.endswith("Z"):
        candidates.append(text[:-1] + "+00:00")
    if " " in text and "T" not in text:
        candidates.append(text.replace(" ", "T", 1))

    for candidate in candidates:
        try:
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is not None:
                dt = dt.astimezone().replace(tzinfo=None)
            return dt
        except ValueError:
            continue

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue

    return None


def fetch_weekly_news():
    """从 RSS 数据库获取最近 7 天的游戏资讯"""
    try:
        if not os.path.isdir(RSS_DB_DIR):
            print(f"✗ 未找到 RSS DB 目录: {RSS_DB_DIR}")
            return []
        window_start, window_end_exclusive = _weekly_window_bounds()
        # 获取所有可用的数据库文件
        all_rows = []
        
        # 列出所有 .db 文件并按日期排序
        db_files = sorted([f for f in os.listdir(RSS_DB_DIR) if f.endswith('.db')], reverse=True)
        
        if not db_files:
            print("  ✗ 未找到任何数据库文件")
            return []
        
        # 读取最近的数据库文件（最多7个）
        for db_file in db_files[:7]:
            db_path = os.path.join(RSS_DB_DIR, db_file)
            
            try:
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                
                query = """
                SELECT title, url, feed_id, published_at, summary
                FROM rss_items
                ORDER BY published_at DESC
                """
                
                cursor.execute(query)
                rows = cursor.fetchall()
                all_rows.extend(rows)
                conn.close()
                print(f"  ✓ 读取 {db_file}: {len(rows)} 条")
            except Exception as e:
                print(f"  ✗ 读取 {db_file} 失败: {e}")
                continue
        
        # 过滤游戏相关内容
        game_news = []
        
        filtered_out_of_window = 0
        filtered_unparseable = 0

        for row in all_rows:
            title, url, feed_id, pub_date, summary = row
            published_at = _parse_published_at(pub_date)
            if not published_at:
                filtered_unparseable += 1
                continue
            if not (window_start <= published_at < window_end_exclusive):
                filtered_out_of_window += 1
                continue
            title_lower = title.lower()
            summary_lower = (summary or "").lower()
            full_text = title_lower + " " + summary_lower
            
            # 方式1：直接包含游戏关键词（扩展关键词列表）
            has_game_keyword = any(keyword.lower() in full_text for keyword in [
                "游戏", "game", "gaming", "puzzle", "match-3", "match-", "merge", "casual",
                "mobile game", "手游", "gdc", "chinajoy", "gamescom",
                "gameplay", "player", "玩家", "玩法", "关卡", "level",
                "rpg", "mmorpg", "fps", "moba", "battle royale",
                "indie game", "独立游戏", "电竞", "esports",
                "steam", "playstation", "xbox", "nintendo", "switch",
                "app store", "google play", "游戏引擎", "game engine",
                "游戏开发", "game dev", "游戏设计", "game design",
                "游戏发行", "game publisher", "游戏工作室", "game studio",
                "dlc", "season pass", "loot box", "gacha", "抽卡",
                "f2p", "free-to-play", "付费", "内购", "iap",
                "dau", "mau", "arpu", "ltv", "retention", "留存"
            ])
            
            # 方式2：包含游戏公司名
            has_game_company = any(company.lower() in full_text for company in GAME_COMPANIES)
            
            # 排除明显非游戏的内容（扩展排除列表）
            is_excluded = any(keyword in full_text for keyword in [
                "东方雨虹", "万事达", "bvnk", "五金", "建材", "房地产",
                "证券", "基金", "理财", "保险", "银行",
                "汽车", "新能源", "电动车", "充电桩",
                "qclaw", "法律工具", "legal tool", "法务",
                "招聘", "hiring", "job opening", "career",
                "股票", "stock", "ipo", "上市公司"
            ])
            current_item = {
                "title": title,
                "link": url,
                "source": feed_id,
                "date": pub_date,
                "summary": summary or "",
            }
            preserve_despite_workplace = _should_preserve_despite_workplace_exclusion(current_item)
            is_workplace_analysis = _is_workplace_analysis_article(title, summary, url) and not preserve_despite_workplace
            is_low_signal_roundup = _is_low_signal_roundup_article(title, summary, url)
            is_generic_digest = _is_generic_digest_without_puzzle_focus(title, summary, url)
            
            # 必须满足：(有游戏关键词 OR 有游戏公司名) AND 不在排除列表
            if (has_game_keyword or has_game_company) and not is_excluded and not is_workplace_analysis and not is_low_signal_roundup and not is_generic_digest:
                game_news.append({
                    "title": title,
                    "link": url,
                    "source": feed_id,
                    "date": pub_date,
                    "summary": summary or "",
                    "strategic_hint": ""
                })
        
        deduped_news = _dedupe_news_by_link(game_news)
        print(
            f"✓ 总共获取 {len(all_rows)} 条资讯，窗口内保留 {len(all_rows) - filtered_out_of_window - filtered_unparseable} 条，"
            f"超出周窗口过滤 {filtered_out_of_window} 条，无法解析时间过滤 {filtered_unparseable} 条"
        )
        print(f"  ✓ 最终筛选出 {len(game_news)} 条游戏相关")
        if len(deduped_news) != len(game_news):
            print(f"  ✓ 按链接去重后保留 {len(deduped_news)} 条（去重 {len(game_news) - len(deduped_news)} 条）")
        game_news = deduped_news
        game_news = _sort_news_by_priority(game_news)
        high_priority_n = sum(1 for item in game_news if item.get("priority_score") == 3)
        secondary_priority_n = sum(1 for item in game_news if item.get("priority_score") in (1, 2))
        if high_priority_n or secondary_priority_n:
            print(f"  ✓ AI 优先级命中：高优先级 {high_priority_n} 条，次高优先级 {secondary_priority_n} 条")
        game_news = _balance_game_news_for_weekly(game_news)
        head = game_news[:BALANCED_HEAD_LIMIT]
        trio_counts = {k: 0 for k in PRIMARY_TRIO_FEEDS}
        other_n = 0
        for it in head:
            k = _normalize_feed_id_for_balance(it.get("source"))
            if k in PRIMARY_TRIO_FEEDS:
                trio_counts[k] += 1
            else:
                other_n += 1
        trio_str = ", ".join(f"{k}={trio_counts[k]}" for k in PRIMARY_TRIO_FEEDS)
        extra = f"，其他信源={other_n}" if other_n else ""
        print(
            f"  ✓ 主三源等权轮询（前 {len(head)} 条供 AI）：{trio_str}{extra}"
        )
        return game_news
        
    except Exception as e:
        print(f"✗ 读取数据库失败: {e}")
        return []


def _build_weekly_news_content(news_list):
    news_lines = []
    for i, item in enumerate(news_list[:BALANCED_HEAD_LIMIT]):
        summary = (item.get("summary") or "").strip()
        strategic_hint = _build_strategic_hint(item)
        parts = [
            f"[#{i+1}] {item['title']}",
            f"来源: {item['source']}",
            f"链接: {item['link']}",
            f"日期: {item['date']}",
        ]
        if summary:
            parts.append(f"摘要: {summary[:260]}")
        if strategic_hint:
            parts.append(strategic_hint)
        news_lines.append("\n".join(parts))
    return "\n\n".join(news_lines)


def _log_llm_usage(result, route, label):
    usage = result.get("usage", {})
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)
    total_tokens = usage.get("total_tokens", 0)
    finish_reason = ""
    if result.get("choices"):
        finish_reason = result["choices"][0].get("finish_reason", "")

    print(f"✓ 周报生成成功（{label}）")
    print("📊 Token 使用统计:")
    print(f"   输入 tokens: {prompt_tokens:,}")
    print(f"   输出 tokens: {completion_tokens:,}")
    print(f"   总计 tokens: {total_tokens:,}")
    print(f"   LLM 路径: {route['label']} / {route['model']}")
    if finish_reason:
        print(f"   finish_reason: {finish_reason}")
    if "openrouter.ai" in route["api_base"]:
        print("   费用说明: 当前走 OpenRouter，实际账单以 OpenRouter 后台为准")


def generate_weekly_report_en(news_list, repair_context=None):
    """Generate the canonical English weekly report."""
    if not news_list:
        return "No major game industry updates this week."

    today = datetime.now()
    week_start = (today - timedelta(days=7)).strftime("%B %d, %Y")
    week_end = today.strftime("%B %d, %Y")
    news_content = _build_weekly_news_content(news_list)

    prompt = f"""You are a senior analyst focused on the global mobile games market, with deep expertise in Puzzle Games, including Match-3, Merge, Word, Hidden Object, Solitaire, and casual games.

Based on the following {len(news_list[:BALANCED_HEAD_LIMIT])} game-industry news items, write a concise professional weekly report in English.

**Important selection rules:**
1. Select only news directly related to the games industry: game products, game companies, game technology, game market dynamics, monetization, UA, LiveOps, or development workflows.
2. Exclude non-game content such as legal tools, recruitment-only news, non-game acquisitions, stock IPOs, workplace commentary, or broad business items without game relevance.
3. If a headline mentions a game company but the content is not about its game business, skip it.
4. Prioritize items involving casual games, puzzle mechanics, casual game revenue, product metrics, content strategy, LiveOps, UA, LTV, retention, or production efficiency.
5. Explicitly exclude workplace/organization-analysis articles such as layoffs, hiring, culture, work environment, career commentary, and generic industry opinion unless they provide directly actionable product, UA, LTV, retention, level/content production, or LiveOps information for the Puzzle/Casual segment.
6. Prioritize Puzzle Game, Match-3, Merge, Word, Hidden Object, Solitaire, and casual-game relevance. The input has been balanced across Mobile Gamer, GamesIndustry.biz, and PocketGamer.biz; avoid over-representing one source across the full report.
7. Top 3 must contain the three most important news items this week. Later sections must cover other important items and must not repeat Top 3 items.
8. The same page/article, represented by the same [#number], may appear at most twice in the full report and at most once in a single section.
9. Fill sections when good material exists. Each section may contain up to 5 items.
10. For digest, roundup, or chart/list articles, do not report the roundup itself as a conclusion. Use it only when you can extract a specific game, mechanic, product metric, or concrete strategy.
11. If an article provides actionable content strategy, creative strategy, level iteration, LiveOps cadence, or production workflow signals, prioritize it over broad industry summaries.
12. High-priority direction: casual-game companies using AI tools, whether for new product development or efficiency. If present, these must be strongly considered for Top 3.
13. Secondary priority A: top game companies, regardless of genre, using AI tools.
14. Secondary priority B: AI tools applied to game development.
15. If a competitor company's AI-related news does not enter Top 3, it must still be considered for the competitor/leading publisher section.
16. Outside Top 3, any game-company AI item should preferentially go into the Game Publishers' AI Exploration section.

**Content quality rules:**
1. All analysis must be grounded in the provided news items. Do not invent facts.
2. Any data point must exactly match the source item. Do not create or infer unsupported data.
3. Every analytical item must be about at least one concrete game, product, mechanic, metric, company action, strategy, or workflow.
4. Keep English financial and scale expressions natural, e.g. $41m, $14.7bn, RMB 25.7 billion.

**Format rules:**
1. Write entirely in English.
2. Bold all company, organization, product, and key metric names.
3. Top 3 must be the three most important game-industry news items this week.
4. Add one or more [#number] placeholders at the end of each item. Links are inserted later by code.
5. Skip empty sections.
6. Each section may contain up to 5 items.
7. Keep core terms such as CPI, ROAS, LTV, DAU, MAU, Match-3, Merge, LiveOps, UA, and DTC.
8. Be concise and emphasize concrete product, market, or execution implications.
9. The Analyst Takeaways section is mandatory and must contain 1-2 actionable recommendations.

Output format:

📅 Puzzle Game Overseas Weekly | {week_start} - {week_end}

**🔥 Top 3 This Week**
1. ...
2. ...
3. ...

**1. Competitor and Leading Publisher Moves**
• ...

**2. Gameplay and Mechanic Innovation**
• ...

**3. Game Publishers' AI Exploration**
• ...

**4. UA Trends and Creative Signals**
• ...

**5. Emerging Market Opportunities**
• ...

**6. Analyst Takeaways**
> 1-2 actionable recommendations based on this week's signals

Important:
1. Write only [#number] placeholders after each item.
2. Do not repeat Top 3 items in later sections.

This week's news items:
{news_content}
"""
    if repair_context:
        prompt += f"""

**Validation feedback from the second AI validator (must be fixed in this regeneration)**
{repair_context}

Regenerate a complete English weekly report from the same source items. Fix every issue listed above, avoid reusing unreliable claims from the failed report, and output only the final report body without explaining the revision process.
"""

    try:
        print("⏳ 正在调用 AI 生成周报（英文）...")
        result, route = _chat_completion_with_fallback(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=6000,
            timeout=120,
        )
        raw_report = _extract_chat_content(result)
        _log_llm_usage(result, route, "英文")
        report = _sanitize_report_text(raw_report)
        report = _enforce_reference_limits(report, news_list)
        report = _ensure_required_sections_en(report)
        print(f"   原始正文长度: {len(raw_report or '')}")
        print(f"   清洗后正文长度: {len(report or '')}")
        if not (report or "").strip():
            print(f"   原始正文预览: {_limit_text(raw_report, 600)}")
        return report
    except Exception as e:
        print(f"✗ AI 英文周报生成失败: {e}")
        return None


def generate_weekly_report(news_list, repair_context=None):
    """使用千问 AI 生成中文版周报"""
    if not news_list:
        return "本周暂无游戏行业重大资讯。"
    
    # 计算日期范围
    today = datetime.now()
    week_start = (today - timedelta(days=7)).strftime('%Y年%m月%d日')
    week_end = today.strftime('%Y年%m月%d日')
    
    # 构建新闻内容（带编号）
    news_lines = []
    for i, item in enumerate(news_list[:BALANCED_HEAD_LIMIT]):
        summary = (item.get("summary") or "").strip()
        strategic_hint = _build_strategic_hint(item)
        parts = [
            f"[#{i+1}] {item['title']}",
            f"来源: {item['source']}",
            f"链接: {item['link']}",
            f"日期: {item['date']}",
        ]
        if summary:
            parts.append(f"摘要: {summary[:260]}")
        if strategic_hint:
            parts.append(strategic_hint)
        news_lines.append("\n".join(parts))
    news_content = "\n\n".join(news_lines)
    
    prompt = f"""你是一位专注全球移动游戏出海市场的资深分析师，精通 Puzzle Game（益智类，含 Match-3, Merge, Word, Hidden Object 等）赛道。

请基于以下 {len(news_list[:BALANCED_HEAD_LIMIT])} 条游戏行业资讯，生成一份简洁专业的周报。

**重要内容筛选原则：**
1. 只选择与游戏行业直接相关的新闻（游戏产品、游戏公司、游戏技术、游戏市场）
2. 排除与游戏无关的内容，例如：法律工具、招聘信息、非游戏业务的收购、股票IPO等
3. 如果某条新闻标题提到游戏公司（如腾讯、网易），但内容与游戏业务无关，则不要选择
4. 如果某些资讯中多次提及了休闲游戏玩法、休闲游戏销量、休闲游戏市场等内容，则该资讯优先级和重要性提高
5. 明确排除“职场/组织分析类”信息：如裁员、招聘、企业文化、工作环境、职场评论、泛行业观点；除非它直接提供 Puzzle 产品、买量、留存、LTV、关卡/内容生产效率等可执行业务信息
6. 优先选择与 Puzzle Game、Match-3、Merge、休闲游戏相关的内容；资讯列表已按 **Mobile Gamer、GamesIndustry.biz、PocketGamer.biz** 三源均衡编排，请避免某一来源在全文（含 Top 3 与各板块）中占比明显过高
7. **重要去重规则：Top 3 展示本周最重要的3条新闻（排名1-3），后面的板块（一、二、三、四、五）展示其他重要新闻（排名4-8或更多），Top 3中的新闻不要在后面板块重复出现**
8. **同一页面（同一 [#编号] 对应的文章）全文最多出现两次，且在同一个板块中最多出现一次**
9. **尽量填满每个板块**，每个板块最多5条，确保有足够的内容展示
10. 如果一篇文章是 digest / roundup / 榜单汇总，不要把“汇总”本身写成结论；只有当你能从中提炼出具体游戏、具体玩法、具体产品数据时才可采用，否则跳过
11. 如果一篇文章提供了可执行的内容策略、素材策略、关卡迭代或 LiveOps 节奏线索，应显著提高优先级，优先于宽泛的行业总结
12. 高优先级筛选方向：休闲游戏公司使用 AI 工具（无论用于新产品开发还是提效），如果出现，必须优先进入 Top 3
13. 次高优先级筛选方向 A：头部游戏公司（不限游戏类型）使用 AI 工具
14. 次高优先级筛选方向 B：AI 工具应用于游戏开发
15. 如果有竞品公司的 AI 相关消息未进入 Top 3，也必须在“竞品与头部动态”栏目中体现
16. Top 3 之外，任何游戏公司发布的 AI 相关消息，应优先收集到“游戏厂商的AI探索”栏目

**内容质量要求：**
1. 你的分析内容需要基于资讯提供，不允许没有根据凭空捏造内容
2. 你在分析中使用的数据必须与资讯中的源数据保持完全一致，不允许自主生成资讯中没有涉及的数据

**重要格式要求：**
1. 全部使用中文（板块标题、内容等）
2. **所有公司、组织、产品名称必须加粗**
3. **关键数据指标必须加粗**
4. Top 3 必须是本周最重要的 3 条游戏新闻
5. 每条信息后面添加 [#编号] 占位符（链接由程序替换）
6. 没有内容的板块直接跳过
7. 每个板块最多 5 条
8. 保留核心英文术语：CPI, ROAS, LTV, DAU, MAU, Match-3, Merge 等
9. 言简意赅，突出关键数据
10. 避免选择泛行业评论、播客串讲、职场观察、企业文化复盘类内容，除非其中包含可直接指导 Puzzle 赛道产品或买量决策的硬数据
11. 每一条结论必须落到“具体游戏 / 具体产品 / 具体玩法 / 具体策略动作”中的至少一个，不要写成空泛的行业观察
12. 如文章提到“把 TikTok meme 很快做进关卡”这类内容策略，请直接提炼成内容生产或关卡迭代方法论，不要只写成“中国厂商效率更高”
13. 如果命中 AI 优先级方向，请在结论中明确写出是哪家公司、用了什么 AI 工具 / 工作流、作用于哪个开发或提效环节
14. “六、分析师洞察”栏目必须输出，不能为空
15. “三、游戏厂商的AI探索”栏目放在“玩法与机制创新”和“买量风向与素材”之间，优先收集 Top 3 之外的游戏公司 AI 消息

输出格式：

📅 Puzzle Game 出海市场周报 | {week_start} - {week_end}

**🔥 本周 Top 3 大事**
1. ...
2. ...
3. ...

**一、竞品与头部动态**
• ...

**二、玩法与机制创新**
• ...

**三、游戏厂商的AI探索**
• ...

**四、买量风向与素材**
• ...

**五、新兴市场机会**
• ...

**六、分析师洞察**
> 基于本周动态，给出 1-2 条实操级建议

注意：
1. 每条新闻后面只写 [#编号]
2. Top 3 新闻不能在后续板块重复

本周资讯列表：
{news_content}
"""
    if repair_context:
        prompt += f"""

**第二个 AI 验证失败反馈（本次必须修订重生成）**
{repair_context}

请基于同一批资讯重新生成一份完整中文周报。必须修复上面列出的失败原因，避免复用失败报告里的不可靠表述；输出只保留最终周报正文，不要解释修订过程。
"""

    try:
        print("⏳ 正在调用 AI 生成周报（中文）...")
        result, route = _chat_completion_with_fallback(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=6000,
            timeout=120,
        )
        report = _extract_chat_content(result)
        
        # 统计 token 使用量
        usage = result.get('usage', {})
        prompt_tokens = usage.get('prompt_tokens', 0)
        completion_tokens = usage.get('completion_tokens', 0)
        total_tokens = usage.get('total_tokens', 0)
        finish_reason = ""
        if result.get("choices"):
            finish_reason = result["choices"][0].get("finish_reason", "")

        print("✓ 周报生成成功（中文）")
        print(f"📊 Token 使用统计:")
        print(f"   输入 tokens: {prompt_tokens:,}")
        print(f"   输出 tokens: {completion_tokens:,}")
        print(f"   总计 tokens: {total_tokens:,}")
        print(f"   LLM 路径: {route['label']} / {route['model']}")
        if finish_reason:
            print(f"   finish_reason: {finish_reason}")
        if "openrouter.ai" in route["api_base"]:
            print("   费用说明: 当前走 OpenRouter，实际账单以 OpenRouter 后台为准")

        # 清理模型偶发输出的提示词残留，避免污染最终推送
        raw_report = report
        report = _sanitize_report_text(report)
        report = _normalize_section_names(report)
        report = _enforce_reference_limits(report, news_list)
        report = _normalize_section_names(report)
        report = _ensure_required_sections(report)
        print(f"   原始正文长度: {len(raw_report or '')}")
        print(f"   清洗后正文长度: {len(report or '')}")
        if not (report or "").strip():
            print(f"   原始正文预览: {_limit_text(raw_report, 600)}")
        return report
        
    except Exception as e:
        print(f"✗ AI 分析失败: {e}")
        return None


def translate_report_zh_to_en(report_zh, news_list=None):
    """兼容旧调用名；新版逻辑改为基于中文版引用链接逐行生成英文。"""
    return generate_aligned_english_report(report_zh, news_list or [])


def _sanitize_report_text(report):
    """移除提示词泄漏文本和示例占位语句"""
    if not report:
        return report

    lines = report.split("\n")
    cleaned = []

    # 这类行属于提示词说明，不应出现在最终消息里
    leak_patterns = [
        r"^\*\*重要：以下板块不要重复Top\s*3",
        r"^重要：以下板块不要重复Top\s*3",
        r"^（最多\s*\d+\s*条，不要包含Top\s*3中的新闻）$",
        r"^（仅在有相关内容时输出，最多\s*\d+\s*条）$",
    ]

    for line in lines:
        stripped = line.strip()
        if any(re.search(p, stripped) for p in leak_patterns):
            continue
        cleaned.append(line)

    # 压缩过多空行，保持消息紧凑
    text = "\n".join(cleaned)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def _normalize_section_names(report):
    if not report:
        return report
    return report.replace("**三、游戏与AI消息**", "**三、游戏厂商的AI探索**")


def _ensure_required_sections(report):
    if not report:
        return report

    required_heading = "**六、分析师洞察**"
    if required_heading in report:
        return report

    fallback = (
        f"{required_heading}\n"
        "> 1. 优先跟进本周进入 Top 3 与“游戏厂商的AI探索”栏目的公司动作，把 AI 工具、关卡迭代、素材生产和 LiveOps 提效拆成可测试清单。\n"
        "> 2. 对未进入 Top 3 但已在竞品或 AI 栏目出现的头部公司消息，优先做竞品拆解，评估其对 Match-3、Merge、Word、Solitaire 等赛道的直接影响。"
    )
    return f"{report.strip()}\n\n{fallback}"


def _ensure_required_sections_en(report):
    if not report:
        return report

    required_heading = "**6. Analyst Takeaways**"
    if required_heading in report:
        return report

    fallback = (
        f"{required_heading}\n"
        "> 1. Prioritize follow-up on companies appearing in Top 3 and the AI exploration section, "
        "then turn AI tooling, level iteration, creative production, and LiveOps efficiency into testable workstreams.\n"
        "> 2. For leading-publisher news that did not enter Top 3, run competitor tear-downs and assess the direct impact on Match-3, Merge, Word, Solitaire, and broader casual-game roadmaps."
    )
    return f"{report.strip()}\n\n{fallback}"


def _format_decimal(value):
    value = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    text = format(value.normalize(), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def _format_zh_money(amount, scale, currency):
    value = Decimal(str(amount))
    scale_lower = scale.lower()
    if scale_lower in {"billion", "bn"}:
        wan_value = value * Decimal("100000")
        yi_value = value * Decimal("10")
    else:
        wan_value = value * Decimal("100")
        yi_value = value / Decimal("100")

    if yi_value >= Decimal("1"):
        number = _format_decimal(yi_value)
        unit = "亿"
    else:
        number = _format_decimal(wan_value)
        unit = "万"

    currency_key = currency.strip().lower()
    if currency_key in {"rmb", "cny", "¥", "￥", "人民币"}:
        return f"人民币{number}{unit}元"
    if currency_key in {"$", "usd", "us$", "美元"}:
        return f"{number}{unit}美元"
    if currency_key in {"£", "gbp", "英镑"}:
        return f"{number}{unit}英镑"
    if currency_key in {"€", "eur", "欧元"}:
        return f"{number}{unit}欧元"
    return f"{number}{unit}{currency}"


def _normalize_zh_financial_units(report):
    if not report:
        return report

    currency = r"(?:US\$|USD|RMB|CNY|GBP|EUR|\$|¥|￥|£|€|美元|人民币|英镑|欧元)"
    scale = r"(?:billion|bn|million|m)"

    def repl_currency_first(match):
        return _format_zh_money(
            amount=match.group("amount"),
            scale=match.group("scale"),
            currency=match.group("currency"),
        )

    def repl_currency_last(match):
        return _format_zh_money(
            amount=match.group("amount"),
            scale=match.group("scale"),
            currency=match.group("currency"),
        )

    text = re.sub(
        rf"(?P<currency>{currency})\s*(?P<amount>\d+(?:\.\d+)?)\s*(?P<scale>{scale})\b",
        repl_currency_first,
        report,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        rf"(?P<amount>\d+(?:\.\d+)?)\s*(?P<scale>{scale})\s*(?P<currency>{currency})\b",
        repl_currency_last,
        text,
        flags=re.IGNORECASE,
    )
    return text


def _format_date_range_title_en(title_line):
    if not title_line:
        return "📅 Puzzle Game Overseas Weekly"

    date_match = re.search(
        r"(\d{4})年(\d{1,2})月(\d{1,2})日\s*\|\s*(\d{4})年(\d{1,2})月(\d{1,2})日",
        title_line,
    )
    if not date_match:
        date_match = re.search(
            r"(\d{4})年(\d{1,2})月(\d{1,2})日\s*-\s*(\d{4})年(\d{1,2})月(\d{1,2})日",
            title_line,
        )
    if not date_match:
        return "📅 Puzzle Game Overseas Weekly"

    start_dt = datetime(
        int(date_match.group(1)),
        int(date_match.group(2)),
        int(date_match.group(3)),
    )
    end_dt = datetime(
        int(date_match.group(4)),
        int(date_match.group(5)),
        int(date_match.group(6)),
    )
    return (
        f"📅 Puzzle Game Overseas Weekly | "
        f"{start_dt.strftime('%B %d, %Y')} - {end_dt.strftime('%B %d, %Y')}"
    )


def _format_date_range_title_zh(title_line):
    if not title_line:
        return "📅 Puzzle Game 出海市场周报"

    date_match = re.search(
        r"([A-Za-z]+ \d{1,2}, \d{4})\s*-\s*([A-Za-z]+ \d{1,2}, \d{4})",
        title_line,
    )
    if not date_match:
        return "📅 Puzzle Game 出海市场周报"

    try:
        start_dt = datetime.strptime(date_match.group(1), "%B %d, %Y")
        end_dt = datetime.strptime(date_match.group(2), "%B %d, %Y")
    except ValueError:
        return "📅 Puzzle Game 出海市场周报"

    return (
        "📅 Puzzle Game 出海市场周报 | "
        f"{start_dt.strftime('%Y年%m月%d日')} - {end_dt.strftime('%Y年%m月%d日')}"
    )


def _split_report_lines_by_sections(report):
    sections = []
    current_heading = None
    current_lines = []

    for raw_line in report.splitlines():
        line = raw_line.rstrip()
        if line.startswith("**"):
            if current_heading is not None or current_lines:
                sections.append((current_heading, current_lines))
            current_heading = line
            current_lines = []
            continue
        current_lines.append(line)

    if current_heading is not None or current_lines:
        sections.append((current_heading, current_lines))
    return sections


def _extract_reference_numbers(text):
    refs = []
    for match in re.findall(r"\[#(\d+)\]", text or ""):
        try:
            refs.append(int(match))
        except ValueError:
            continue
    return refs


def _build_news_context_for_refs(ref_numbers, news_list):
    contexts = []
    for ref_num in ref_numbers:
        idx = ref_num - 1
        if not (0 <= idx < len(news_list)):
            continue
        item = news_list[idx]
        parts = [
            f"[#{ref_num}] 标题: {item.get('title') or ''}",
            f"来源: {item.get('source') or ''}",
            f"链接: {item.get('link') or ''}",
            f"日期: {item.get('date') or ''}",
        ]
        summary = (item.get("summary") or "").strip()
        if summary:
            parts.append(f"摘要: {summary[:400]}")
        strategic_hint = _build_strategic_hint(item)
        if strategic_hint:
            parts.append(f"分析提示: {strategic_hint}")
        contexts.append("\n".join(parts))
    return "\n\n".join(contexts)


def _normalize_line_prefix(source_line, generated_line):
    source = source_line or ""
    generated = (generated_line or "").strip()
    prefix_match = re.match(r"^(\d+\.\s+|•\s+|>\s*)", source.strip())
    if not prefix_match:
        return generated

    prefix = prefix_match.group(1)
    generated = re.sub(r"^(\d+\.\s+|•\s+|>\s*)", "", generated).strip()
    return f"{prefix}{generated}".rstrip()


def _normalize_reference_placeholders(source_line, generated_line):
    source_refs = re.findall(r"\[#\d+\]", source_line or "")
    if not source_refs:
        return generated_line

    candidate = re.sub(r"\s+", " ", (generated_line or "").strip())
    generated_refs = re.findall(r"\[#\d+\]", candidate)
    if generated_refs == source_refs:
        return candidate

    candidate = re.sub(r"\s*\[#\d+\]", "", candidate).strip()
    if candidate:
        return f"{candidate} {' '.join(source_refs)}".strip()
    return " ".join(source_refs)


def _normalize_reference_placeholders_for_fragment(source_fragment, generated_fragment):
    source_refs = re.findall(r"\[#\d+\]", source_fragment or "")
    if not source_refs:
        return generated_fragment

    candidate = re.sub(r"\s+", " ", (generated_fragment or "").strip())
    generated_refs = re.findall(r"\[#\d+\]", candidate)
    if generated_refs == source_refs:
        return candidate

    candidate = re.sub(r"\s*\[#\d+\]", "", candidate).strip()
    if candidate:
        return f"{candidate} {' '.join(source_refs)}".strip()
    return " ".join(source_refs)


def _extract_preservation_hints(source_line):
    bold_terms = []
    for term in re.findall(r"\*\*(.+?)\*\*", source_line or ""):
        cleaned = term.strip()
        if cleaned and re.search(r"[A-Za-z0-9]", cleaned) and cleaned not in bold_terms:
            bold_terms.append(cleaned)

    numeric_tokens = []
    for token in re.findall(r"\d[\d,\.]*%?", source_line or ""):
        normalized = token.replace(",", "")
        if normalized and normalized not in numeric_tokens:
            numeric_tokens.append(normalized)

    return {
        "bold_terms": bold_terms,
        "numeric_tokens": numeric_tokens,
    }


def _is_english_line_aligned(source_line, english_line, preservation_hints):
    source_refs = re.findall(r"\[#\d+\]", source_line or "")
    english_refs = re.findall(r"\[#\d+\]", english_line or "")
    if source_refs != english_refs:
        return False
    if re.search(r"[\u4e00-\u9fff]", english_line or ""):
        return False

    normalized_en = (english_line or "").replace(",", "")
    for term in preservation_hints.get("bold_terms", []):
        if term not in (english_line or ""):
            return False
    for token in preservation_hints.get("numeric_tokens", []):
        if token not in normalized_en:
            return False
    return True


def _polish_english_only_line(source_line, english_line, news_list):
    stripped = (source_line or "").strip()
    english_draft = (english_line or "").strip()
    ref_numbers = _extract_reference_numbers(stripped)
    context = _build_news_context_for_refs(ref_numbers, news_list)
    prompt_parts = [
        "You are polishing one line from the English version of a weekly mobile games report.",
        "The current English draft is mostly correct, but it still contains Chinese fragments.",
        "Rewrite the line into pure English only while keeping the exact same meaning, numbers, Markdown emphasis, and [#n] placeholders.",
        "Do not add or remove facts. Output one line only.",
        "",
        "Chinese source line:",
        stripped,
        "",
        "Current English draft to clean up:",
        english_draft,
    ]
    if context:
        prompt_parts.extend(
            [
                "",
                "Source-page context:",
                context,
            ]
        )
    prompt = "\n".join(prompt_parts)
    result, route = _chat_completion_with_fallback(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=300,
        timeout=120,
    )
    polished = _extract_chat_content(result)
    polished = _sanitize_report_text(polished).replace("\n", " ").strip()
    polished = _normalize_line_prefix(stripped, polished)
    polished = _normalize_reference_placeholders(stripped, polished)
    if "openrouter.ai" in route["api_base"]:
        print("   费用说明: 当前走 OpenRouter，实际账单以 OpenRouter 后台为准")
    return polished


def _split_text_into_sentence_chunks(text):
    chunks = []
    current = []
    for ch in text or "":
        current.append(ch)
        if ch in ".!?;。！？；":
            chunks.append("".join(current))
            current = []
    if current:
        chunks.append("".join(current))
    return chunks if chunks else [text or ""]


def _repair_dirty_sentence(source_line, english_line, dirty_sentence, news_list):
    stripped_source = (source_line or "").strip()
    dirty_sentence = (dirty_sentence or "").strip()
    if not dirty_sentence:
        return dirty_sentence

    ref_numbers = _extract_reference_numbers(stripped_source)
    context = _build_news_context_for_refs(ref_numbers, news_list)
    messages = [{
        "role": "user",
        "content": "\n".join([
            "You are fixing one sentence in the English version of a weekly mobile games report.",
            "Only rewrite the dirty sentence below. It currently contains Chinese fragments.",
            "Return one sentence in pure English only while keeping the exact same meaning, numbers, Markdown emphasis, and any [#n] placeholders.",
            "Do not rewrite the rest of the line. Do not add or remove facts.",
            "",
            "Chinese source line:",
            stripped_source,
            "",
            "Full English line for context:",
            (english_line or "").strip(),
            "",
            "Dirty sentence to fix:",
            dirty_sentence,
            "",
            "Source-page context:",
            context,
        ])
    }]

    repaired_sentence = dirty_sentence
    for attempt in range(2):
        result, route = _chat_completion_with_fallback(
            messages=messages,
            temperature=0.2,
            max_tokens=220,
            timeout=120,
        )
        repaired_sentence = _extract_chat_content(result)
        repaired_sentence = _sanitize_report_text(repaired_sentence).replace("\n", " ").strip()
        repaired_sentence = _normalize_reference_placeholders_for_fragment(dirty_sentence, repaired_sentence)
        if not re.search(r"[\u4e00-\u9fff]", repaired_sentence or ""):
            if "openrouter.ai" in route["api_base"]:
                print("   费用说明: 当前走 OpenRouter，实际账单以 OpenRouter 后台为准")
            return repaired_sentence
        if attempt == 0:
            messages.extend(
                [
                    {"role": "assistant", "content": repaired_sentence},
                    {
                        "role": "user",
                        "content": (
                            "The sentence above still contains Chinese characters. Rewrite that single sentence again in pure English only, "
                            "while keeping the exact same meaning, numbers, Markdown emphasis, and [#n] placeholders."
                        ),
                    },
                ]
            )

    if "openrouter.ai" in route["api_base"]:
        print("   费用说明: 当前走 OpenRouter，实际账单以 OpenRouter 后台为准")
    return repaired_sentence


def _repair_dirty_sentences_in_line(source_line, english_line, news_list):
    if not re.search(r"[\u4e00-\u9fff]", english_line or ""):
        return english_line, 0

    repaired_count = 0
    rebuilt_chunks = []
    for chunk in _split_text_into_sentence_chunks(english_line):
        if re.search(r"[\u4e00-\u9fff]", chunk):
            repaired_chunk = _repair_dirty_sentence(source_line, english_line, chunk, news_list)
            if repaired_chunk != chunk:
                repaired_count += 1
            rebuilt_chunks.append(repaired_chunk)
        else:
            rebuilt_chunks.append(chunk)

    repaired_line = " ".join(part.strip() for part in rebuilt_chunks if part and part.strip()).strip()
    repaired_line = _normalize_line_prefix(source_line, repaired_line)
    repaired_line = _normalize_reference_placeholders(source_line, repaired_line)
    if re.search(r"[\u4e00-\u9fff]", repaired_line or ""):
        fallback_line = _polish_english_only_line(source_line, repaired_line, news_list)
        fallback_line = _normalize_line_prefix(source_line, fallback_line)
        fallback_line = _normalize_reference_placeholders(source_line, fallback_line)
        if fallback_line != repaired_line:
            repaired_count += 1
        repaired_line = fallback_line
    return repaired_line, repaired_count


def _repair_dirty_sentences_in_english_report(report_zh, report_en, news_list):
    zh_lines = report_zh.splitlines()
    en_lines = report_en.splitlines()
    repaired_lines = []
    repaired_sentence_count = 0

    for idx, en_line in enumerate(en_lines):
        source_line = zh_lines[idx] if idx < len(zh_lines) else ""
        repaired_line, repaired_count = _repair_dirty_sentences_in_line(source_line, en_line, news_list)
        repaired_lines.append(repaired_line)
        repaired_sentence_count += repaired_count

    return "\n".join(repaired_lines).strip(), repaired_sentence_count


def _generate_english_line_from_zh(source_line, news_list):
    stripped = (source_line or "").strip()
    if not stripped:
        return source_line
    if stripped.startswith("📅"):
        return _format_date_range_title_en(stripped)
    if stripped in SECTION_HEADING_EN:
        return SECTION_HEADING_EN[stripped]

    ref_numbers = _extract_reference_numbers(stripped)
    context = _build_news_context_for_refs(ref_numbers, news_list)
    preservation_hints = _extract_preservation_hints(stripped)
    prompt_parts = [
        "You are a mobile game market analyst writing the English version of one line from a weekly report.",
        "The Chinese line is the canonical version. Rewrite it into concise, natural English for international business readers.",
        "Your English line must describe the same company, product, metric, action, and conclusion as the Chinese line.",
        "",
        "Strict rules:",
        "1. Keep any [#n] placeholders exactly unchanged and in the same order.",
        "2. Keep the same Markdown line style if present: numbered item, bullet, blockquote, or plain text.",
        "3. Keep **bold** Markdown when company names or metrics are emphasized.",
        "4. Use the Chinese line as the main source of truth; use the source-page context only to clarify terminology and localize wording.",
        "5. Do not change the analytical angle. The English line must still be talking about the same thing as the Chinese line.",
        "6. Do not add, remove, swap, or reinterpret companies, products, mechanisms, metrics, strategic actions, or conclusions.",
        "7. Localized wording is preferred, but factual scope must remain the same.",
        "8. Output one line only.",
        "",
    ]
    if preservation_hints["bold_terms"]:
        prompt_parts.append(
            "Required bold entities/terms to preserve in English: "
            + ", ".join(f"**{term}**" for term in preservation_hints["bold_terms"])
        )
    if preservation_hints["numeric_tokens"]:
        prompt_parts.append(
            "Required numbers/metrics to preserve in English: "
            + ", ".join(preservation_hints["numeric_tokens"])
        )
    if preservation_hints["bold_terms"] or preservation_hints["numeric_tokens"]:
        prompt_parts.append("")
    if context:
        prompt_parts.extend(
            [
                "Source-page context:",
                context,
                "",
            ]
        )
    prompt_parts.extend(
        [
            "Chinese line:",
            stripped,
        ]
    )
    prompt = "\n".join(prompt_parts)

    messages = [{"role": "user", "content": prompt}]

    for attempt in range(2):
        result, route = _chat_completion_with_fallback(
            messages=messages,
            temperature=0.3,
            max_tokens=300,
            timeout=120,
        )
        english_line = _extract_chat_content(result)
        english_line = _sanitize_report_text(english_line).replace("\n", " ").strip()
        english_line = _normalize_line_prefix(stripped, english_line)
        english_line = _normalize_reference_placeholders(stripped, english_line)
        if _is_english_line_aligned(stripped, english_line, preservation_hints):
            if "openrouter.ai" in route["api_base"]:
                print("   费用说明: 当前走 OpenRouter，实际账单以 OpenRouter 后台为准")
            return english_line
        if attempt == 0:
            messages.extend(
                [
                    {"role": "assistant", "content": english_line},
                    {
                        "role": "user",
                        "content": (
                            "The draft above drifted from the canonical Chinese line, still contains Chinese characters, "
                            "or missed required entities/numbers. Rewrite it again in pure English only. Keep the exact same "
                            "meaning as the Chinese line, preserve all required bold entities, preserve all required numbers, "
                            "and keep the same [#n] placeholders."
                        ),
                    },
                ]
            )

    if "openrouter.ai" in route["api_base"]:
        print("   费用说明: 当前走 OpenRouter，实际账单以 OpenRouter 后台为准")
    return english_line


def generate_aligned_english_report(report_zh, news_list):
    """基于中文版的实际引用链接，逐行生成英文版，保证中英文引用页对齐。"""
    if not report_zh:
        return None
    if report_zh.strip() == "本周暂无游戏行业重大资讯。":
        return "No major game industry updates this week."

    try:
        print("⏳ 正在基于中文版引用链接生成英文周报...")
        translated_lines = []
        total_lines = len(report_zh.splitlines())
        for idx, source_line in enumerate(report_zh.splitlines(), 1):
            try:
                translated_lines.append(_generate_english_line_from_zh(source_line, news_list))
            except Exception as line_exc:
                print(
                    f"✗ 英文第 {idx}/{total_lines} 行生成失败: "
                    f"{_limit_text(source_line.strip(), 220)}"
                )
                raise line_exc
        report_en = "\n".join(translated_lines).strip()
        report_en = _sanitize_report_text(report_en)
        report_en, repaired_sentence_count = _repair_dirty_sentences_in_english_report(report_zh, report_en, news_list)
        if repaired_sentence_count:
            print(f"✓ 英文脏句修复完成：共修复 {repaired_sentence_count} 句")
        print("✓ 英文周报生成完成（与中文版链接对齐）")
        return report_en
    except Exception as e:
        print(f"✗ 英文周报生成失败: {e}")
        return None


def _contains_unlocalized_financial_units(text):
    return bool(re.search(r"\b(?:billion|million|bn|RMB|USD|GBP|EUR|CNY)\b|\d+(?:\.\d+)?\s*m(?=\s|美元|人民币|英镑|欧元|$)|\$\s*\d|£\s*\d|€\s*\d|[¥￥]\s*\d", text or "", re.IGNORECASE))


def _is_chinese_line_aligned(source_line, chinese_line):
    source_refs = re.findall(r"\[#\d+\]", source_line or "")
    chinese_refs = re.findall(r"\[#\d+\]", chinese_line or "")
    if source_refs != chinese_refs:
        return False
    if source_refs and not re.search(r"[\u4e00-\u9fff]", chinese_line or ""):
        return False
    if _contains_unlocalized_financial_units(chinese_line):
        return False
    return True


def _generate_chinese_line_from_en(source_line, news_list):
    stripped = (source_line or "").strip()
    if not stripped:
        return source_line
    if stripped.startswith("📅"):
        return _format_date_range_title_zh(stripped)
    if stripped in SECTION_HEADING_ZH:
        return SECTION_HEADING_ZH[stripped]

    ref_numbers = _extract_reference_numbers(stripped)
    context = _build_news_context_for_refs(ref_numbers, news_list)
    prompt_parts = [
        "你是一位移动游戏市场分析师，正在把英文周报逐行本地化为中文。",
        "英文行是事实、结构和引用编号的唯一主版本。请忠实翻译成自然、专业的中文，不要重新选题、不要重排、不要新增或删除事实。",
        "",
        "严格规则：",
        "1. 保持所有 [#n] 占位符完全不变，顺序也必须一致。",
        "2. 保持原行样式：编号、项目符号、引用块或普通文本。",
        "3. 保持 **加粗** Markdown；公司、组织、产品名和关键指标仍需加粗。",
        "4. 保留允许的英文业务术语：CPI, ROAS, LTV, DAU, MAU, Match-3, Merge, LiveOps, UA, DTC。",
        "5. 金额和数量级必须中文本地化，不得保留 billion, million, bn, m, RMB, USD, GBP, EUR 等英文单位或货币代码。",
        "   示例：$41m → 4100万美元；$168m → 1.68亿美元；$14.7bn → 147亿美元；RMB 25.7 billion → 人民币257亿元；¥100 billion → 人民币1000亿元；£125 million → 1.25亿英镑。",
        "6. 不要输出解释，不要添加额外行；只输出翻译后的单行。",
        "",
    ]
    if context:
        prompt_parts.extend(["来源上下文：", context, ""])
    prompt_parts.extend(["英文行：", stripped])
    messages = [{"role": "user", "content": "\n".join(prompt_parts)}]

    chinese_line = stripped
    for attempt in range(2):
        result, route = _chat_completion_with_fallback(
            messages=messages,
            temperature=0.2,
            max_tokens=360,
            timeout=120,
        )
        chinese_line = _extract_chat_content(result)
        chinese_line = _sanitize_report_text(chinese_line).replace("\n", " ").strip()
        chinese_line = _normalize_line_prefix(stripped, chinese_line)
        chinese_line = _normalize_reference_placeholders(stripped, chinese_line)
        chinese_line = _normalize_zh_financial_units(chinese_line)
        if _is_chinese_line_aligned(stripped, chinese_line):
            if "openrouter.ai" in route["api_base"]:
                print("   费用说明: 当前走 OpenRouter，实际账单以 OpenRouter 后台为准")
            return chinese_line
        if attempt == 0:
            messages.extend(
                [
                    {"role": "assistant", "content": chinese_line},
                    {
                        "role": "user",
                        "content": (
                            "上面的中文行仍有问题：可能引用编号不一致、没有中文化，或仍保留了未本地化的英文金额单位。"
                            "请重新输出单行中文，保持原 [#n] 顺序，并把金额/数量级全部转成中文单位。"
                        ),
                    },
                ]
            )

    if "openrouter.ai" in route["api_base"]:
        print("   费用说明: 当前走 OpenRouter，实际账单以 OpenRouter 后台为准")
    return chinese_line


def generate_aligned_chinese_report(report_en, news_list):
    """Translate the canonical English report line-by-line into Chinese."""
    if not report_en:
        return None
    if report_en.strip() == "No major game industry updates this week.":
        return "本周暂无游戏行业重大资讯。"

    try:
        print("⏳ 正在基于英文版引用链接生成中文周报...")
        translated_lines = []
        total_lines = len(report_en.splitlines())
        for idx, source_line in enumerate(report_en.splitlines(), 1):
            try:
                translated_lines.append(_generate_chinese_line_from_en(source_line, news_list))
            except Exception as line_exc:
                print(
                    f"✗ 中文第 {idx}/{total_lines} 行生成失败: "
                    f"{_limit_text(source_line.strip(), 220)}"
                )
                raise line_exc
        report_zh = "\n".join(translated_lines).strip()
        report_zh = _sanitize_report_text(report_zh)
        report_zh = _normalize_section_names(report_zh)
        report_zh = _normalize_zh_financial_units(report_zh)
        report_zh = _ensure_required_sections(report_zh)
        print("✓ 中文周报生成完成（与英文版链接对齐）")
        return report_zh
    except Exception as e:
        print(f"✗ 中文周报生成失败: {e}")
        return None


def _section_id_from_heading(heading):
    return heading.strip() if heading else "__preamble__"


def _extract_line_urls(line, news_list):
    urls = []
    for match in re.findall(r"\[#(\d+)\]", line):
        idx = int(match) - 1
        if 0 <= idx < len(news_list):
            url = (news_list[idx].get("link") or "").strip()
            if url:
                urls.append(url)
    return urls


def _renumber_top_items(lines):
    counter = 1
    result = []
    for line in lines:
        if re.match(r"^\d+\.\s+", line.strip()):
            updated = re.sub(r"^\d+\.\s+", f"{counter}. ", line.strip(), count=1)
            result.append(updated)
            counter += 1
        else:
            result.append(line)
    return result


def _enforce_reference_limits(report, news_list):
    lines = report.split("\n")
    sections = []
    preamble = []
    current_heading = None
    current_lines = []

    for line in lines:
        if line.startswith("**"):
            if current_heading is None and not sections:
                if preamble:
                    sections.append((None, preamble))
                    preamble = []
            elif current_heading is not None:
                sections.append((current_heading, current_lines))
            else:
                sections.append((None, preamble))
                preamble = []
            current_heading = line
            current_lines = []
            continue

        if current_heading is None:
            preamble.append(line)
        else:
            current_lines.append(line)

    if current_heading is None:
        sections.append((None, preamble))
    else:
        if preamble:
            sections.append((None, preamble))
        sections.append((current_heading, current_lines))

    global_counts = {}
    rebuilt = []

    for heading, section_lines in sections:
        section_seen = set()
        kept_lines = []
        for line in section_lines:
            urls = _extract_line_urls(line, news_list)
            if urls:
                unique_urls = set(urls)
                violates_section = any(url in section_seen for url in unique_urls)
                violates_global = any(global_counts.get(url, 0) >= 2 for url in unique_urls)
                if violates_section or violates_global:
                    continue
                for url in unique_urls:
                    section_seen.add(url)
                    global_counts[url] = global_counts.get(url, 0) + 1
            kept_lines.append(line)

        while kept_lines and not kept_lines[0].strip():
            kept_lines.pop(0)
        while kept_lines and not kept_lines[-1].strip():
            kept_lines.pop()

        if heading and "Top 3" in heading:
            kept_lines = _renumber_top_items(kept_lines)

        if heading is None:
            if kept_lines:
                rebuilt.extend(kept_lines)
        elif kept_lines:
            if rebuilt and rebuilt[-1].strip():
                rebuilt.append("")
            rebuilt.append(heading)
            rebuilt.extend(kept_lines)

    text = "\n".join(rebuilt)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def _replace_reference_links(content, news_list, wework_mode=False, link_label="查看原文"):
    """把 [#编号] 占位符替换成真实链接"""
    def _repl(match):
        idx = int(match.group(1)) - 1
        if 0 <= idx < len(news_list):
            link = news_list[idx]["link"]
            return f"[{link_label}]({link})"
        return match.group(0)

    return re.sub(r"\[#(\d+)\]", _repl, content)


def _save_reports_json(
    report_zh,
    report_en,
    news_list,
    repair_attempt=0,
    source_snapshot_path=None,
    validation_feedback=None,
    date_window=None,
):
    """保存中英文周报 JSON 快照"""
    WEEKLY_REPORT_JSON_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now()
    start_dt = datetime.combine((now - timedelta(days=7)).date(), datetime.min.time())
    end_exclusive_dt = datetime.combine((now + timedelta(days=1)).date(), datetime.min.time())
    resolved_window = date_window or {
        "timezone": "Asia/Shanghai",
        "start": start_dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "end_exclusive": end_exclusive_dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "title_start_date": start_dt.date().isoformat(),
        "title_end_date": now.date().isoformat(),
    }
    payload = {
        "generated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
        "rss_db_dir": RSS_DB_DIR,
        "date_window": resolved_window,
        "news_count": len(news_list),
        "generator_candidate_limit": BALANCED_HEAD_LIMIT,
        "report_generation_mode": "en_first_then_link_aligned_zh",
        "repair_attempt": repair_attempt,
        "source_snapshot_path": source_snapshot_path,
        "validation_feedback": validation_feedback,
        "reports": {
            "zh": report_zh,
            "en": report_en,
        },
        "news_preview": news_list[:20],
        "news_list": news_list,
    }
    file_path = WEEKLY_REPORT_JSON_DIR / f"weekly_report_{now.strftime('%Y%m%d_%H%M%S')}.json"
    file_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ 已保存周报 JSON: {file_path}")
    return str(file_path)


def _snapshot_sha256(snapshot_path):
    digest = hashlib.sha256()
    with open(snapshot_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run_reports_validation(snapshot_path):
    """运行本地 AI 验证门禁，返回完整验证结果。"""
    try:
        from weekly_ai_validator import ensure_snapshot_valid

        result = ensure_snapshot_valid(
            snapshot_path=snapshot_path,
            api_key=os.environ.get("AI_VALIDATION_API_KEY") or AI_API_KEY,
            model=AI_VALIDATION_MODEL,
            rss_db_dir=RSS_DB_DIR,
            allowed_feeds=PRIMARY_TRIO_FEEDS,
        )
        result_path = result.get("validation_result_path") or ""
        if result.get("overall_status") == "pass":
            print(f"✓ AI 验证通过: {result_path}")
            return result

        print(f"⚠️ AI 验证未通过: {result_path}")
        for issue in (result.get("blocking_issues") or [])[:8]:
            print(f"  - {issue}")
        return result
    except Exception as e:
        print(f"✗ AI 验证执行失败: {e}")
        return {
            "overall_status": "fail",
            "snapshot_path": str(snapshot_path),
            "snapshot_sha256": _snapshot_sha256(snapshot_path),
            "validation_result_path": "",
            "model": AI_VALIDATION_MODEL,
            "blocking_issues": ["ai_validation_error"],
            "warnings": [],
            "ai_error": str(e),
            "dimensions": {},
        }


def _validate_reports_snapshot(snapshot_path):
    """运行本地 AI 验证门禁，返回是否通过。"""
    return _run_reports_validation(snapshot_path).get("overall_status") == "pass"


def _condense_text(text, limit=1200):
    normalized = " ".join(str(text or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3] + "..."


def _limit_text(text, limit=1400):
    value = str(text or "").strip()
    if len(value) <= limit:
        return value
    return value[: limit - 3] + "..."


def _format_validation_feedback(result):
    lines = []
    if result.get("ai_error"):
        lines.append(f"验证执行错误：{_condense_text(result.get('ai_error'), 600)}")

    dimensions = result.get("dimensions") or {}
    for name, detail in dimensions.items():
        if not isinstance(detail, dict) or detail.get("status") != "fail":
            continue
        dimension_label = {
            "time_source": "发布时间与来源周期",
            "english_purity": "英文版本地化",
            "fact_trust": "事实可信度",
            "key_omissions": "关键遗漏",
            "zh_localization": "中文版本地化",
            "en_localization": "英文版本地化",
        }.get(name, name)
        if detail.get("issues"):
            lines.extend(
                f"- {dimension_label}问题：{_condense_text(item, 320)}"
                for item in detail.get("issues", [])[:6]
            )
        if detail.get("checks"):
            for item in detail.get("checks", [])[:8]:
                verdict = item.get("verdict", "")
                if verdict in {"unsupported", "partially_supported", "not_enough_evidence"}:
                    line_no = item.get("line_no")
                    line_label = f"第 {line_no} 行" if line_no else "某条分析"
                    lines.append(
                        f"- {line_label}的 AI 分析存在事实可信度问题（{verdict}）："
                        f"{_condense_text(item.get('reason'), 420)}"
                    )
        if detail.get("critical_missing_items"):
            for item in detail.get("critical_missing_items", [])[:6]:
                title = _condense_text(item.get("title"), 180)
                lines.append(
                    f"- 遗漏信息源中的重要帖子：{title}；原因："
                    f"{_condense_text(item.get('reason'), 320)}"
                )
        if detail.get("top3_issues"):
            for item in detail.get("top3_issues", [])[:6]:
                lines.append(
                    f"- 每周 Top 3 选择/排序问题：{_condense_text(item.get('issue'), 180)}；原因："
                    f"{_condense_text(item.get('reason'), 320)}"
                )

    warnings = result.get("warnings") or []
    if warnings:
        lines.extend(f"- 警告：{_condense_text(item, 300)}" for item in warnings[:8])
    issues = result.get("blocking_issues") or []
    if issues and not lines:
        lines.extend(f"- 阻断问题：{issue}" for issue in issues[:12])
    return "\n".join(lines) if lines else "第二个 AI 未给出具体失败原因，请全面检查事实依据、Top 3 优先级、中英文质量和引用编号。"


def _build_repair_context(payload, validation_result):
    reports = payload.get("reports") or {}
    feedback = _format_validation_feedback(validation_result)
    failed_zh = _condense_text(reports.get("zh", ""), 4500)
    failed_en = _condense_text(reports.get("en", ""), 2500)
    return f"""验证失败原因：
{feedback}

验证失败的中文报告：
{failed_zh}

验证失败的英文报告（用于理解双语一致性问题，不要直接翻译复用）：
{failed_en}
"""


def _repair_week_key(payload):
    window = payload.get("date_window") or {}
    start = window.get("title_start_date") or str(window.get("start") or "")[:10]
    end = window.get("title_end_date") or str(window.get("end_exclusive") or "")[:10]
    if not start or not end:
        generated = str(payload.get("generated_at") or datetime.now().strftime("%Y-%m-%d"))
        start = generated[:10]
        end = generated[:10]
    raw = f"{start}_to_{end}"
    return re.sub(r"[^0-9A-Za-z_-]+", "_", raw)


def _repair_marker_path(payload):
    WEEKLY_REPAIR_DIR.mkdir(parents=True, exist_ok=True)
    return WEEKLY_REPAIR_DIR / f"weekly_repair_{_repair_week_key(payload)}.json"


def _has_weekly_repair_attempt(payload, snapshot_path=None, validation_result=None):
    if int(payload.get("repair_attempt") or 0) >= 1:
        return True

    marker_path = _repair_marker_path(payload)
    if not marker_path.exists():
        return False

    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except Exception:
        return True

    current_snapshot_path = str(snapshot_path or payload.get("_snapshot_path") or "")
    current_snapshot_sha = str((validation_result or {}).get("snapshot_sha256") or "")
    marker_snapshot_path = str(marker.get("source_snapshot_path") or "")
    marker_snapshot_sha = str(marker.get("source_snapshot_sha256") or "")

    if current_snapshot_sha and marker_snapshot_sha:
        return current_snapshot_sha == marker_snapshot_sha
    if current_snapshot_path and marker_snapshot_path:
        return current_snapshot_path == marker_snapshot_path
    return True


def _mark_weekly_repair_attempt(payload, snapshot_path, validation_result):
    marker = _repair_marker_path(payload)
    marker.write_text(
        json.dumps(
            {
                "created_at": datetime.now().isoformat(timespec="seconds"),
                "source_snapshot_path": str(snapshot_path),
                "source_snapshot_sha256": validation_result.get("snapshot_sha256"),
                "validation_result_path": validation_result.get("validation_result_path"),
                "blocking_issues": validation_result.get("blocking_issues") or [],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return marker


def _integrated_report_path(payload):
    WEEKLY_REPAIR_DIR.mkdir(parents=True, exist_ok=True)
    return WEEKLY_REPAIR_DIR / f"weekly_integrated_validation_{_repair_week_key(payload)}.json"


def _write_integrated_validation_report(
    payload,
    original_snapshot_path,
    original_validation_result,
    repaired_snapshot_path=None,
    repaired_validation_result=None,
    final_status="fail",
    note="",
):
    report_path = _integrated_report_path(payload)
    report = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "week_key": _repair_week_key(payload),
        "final_status": final_status,
        "note": note,
        "original": {
            "snapshot_path": str(original_snapshot_path),
            "validation_result_path": original_validation_result.get("validation_result_path"),
            "overall_status": original_validation_result.get("overall_status"),
            "blocking_issues": original_validation_result.get("blocking_issues") or [],
            "feedback": _format_validation_feedback(original_validation_result),
        },
        "repaired": None,
    }
    if repaired_validation_result:
        report["repaired"] = {
            "snapshot_path": str(repaired_snapshot_path or repaired_validation_result.get("snapshot_path") or ""),
            "validation_result_path": repaired_validation_result.get("validation_result_path"),
            "overall_status": repaired_validation_result.get("overall_status"),
            "blocking_issues": repaired_validation_result.get("blocking_issues") or [],
            "feedback": _format_validation_feedback(repaired_validation_result),
        }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ 已保存整合验证报告: {report_path}")
    return report_path, report


def _format_integrated_report_body(report_path, report):
    original = report.get("original") or {}
    repaired = report.get("repaired") or {}
    final_status = report.get("final_status")
    status_text = (
        "首轮验证失败，AI修改后验证成功"
        if final_status == "pass"
        else "failed_then_failed"
    )
    final_text = "推送成功" if final_status == "pass" else "验证失败，未推送"
    week_text = str(report.get("week_key") or "")
    week_text = week_text.replace("_to_", " - ")
    service_text = "Gaming Daily Report 2周报推送"
    first_feedback = _limit_text(original.get("feedback"), 1400)
    if repaired:
        second_status = repaired.get("overall_status")
        second_feedback = (
            "第二次验证通过"
            if second_status == "pass"
            else f"验证失败原因：{_limit_text(repaired.get('feedback'), 1400)}"
        )
    else:
        second_status = "未执行"
        second_feedback = f"说明：{report.get('note') or '未能进入重生成复验流程'}"
    parts = [
        "服务: " + service_text,
        "状态: " + status_text,
    ]
    if final_status != "pass":
        parts.append("说明: 第一次失败不立即推送，第二次验证完成后推送整合报告。")
    parts.extend([
        "",
        "最终状态",
        final_text,
        "",
        "本地报告",
        str(report_path),
        "",
        "周报周期",
        week_text,
        "",
        "第一次验证",
        f"状态: {original.get('overall_status')}",
        f"验证失败原因：{first_feedback}",
        "",
        "第二次验证",
        f"状态: {second_status}",
        second_feedback,
    ])
    return "\n".join(parts)


def _load_guru_monitor_config():
    config_path = GURU_MONITOR_ROOT / "config" / "monitor.json"
    if not config_path.exists():
        return None
    return json.loads(config_path.read_text(encoding="utf-8"))


def _guru_service_for_phase(config, phase):
    wanted = "gaming_daily_report_weekly_push" if phase == "push" else "gaming_daily_report_weekly_generate"
    for service in config.get("services", []):
        if service.get("name") == wanted:
            return service
    return {
        "name": wanted,
        "display_name": "Gaming Daily Report 周报",
        "repo_name": "gaming-daily-report 2",
        "service_type": "Puzzle Game 周报流程",
    }


def _send_guru_monitor_feishu(webhook_url, title, body, level="error"):
    if not webhook_url:
        return False
    template = "red" if level == "error" else "green"
    payload = {
        "msg_type": "interactive",
        "card": {
            "header": {
                "template": template,
                "title": {"tag": "plain_text", "content": title},
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {"tag": "plain_text", "content": _condense_text(body, 3500)},
                }
            ],
        },
    }
    response = requests.post(webhook_url, json=payload, timeout=20)
    response.raise_for_status()
    try:
        parsed = response.json()
    except ValueError:
        return True
    code = parsed.get("code", 0)
    if code not in (0, None):
        raise RuntimeError(parsed.get("msg") or parsed.get("message") or response.text)
    return True


def _send_guru_monitor_report(phase, level, title, body, validation_result=None, snapshot_path=None, force_feishu=False):
    try:
        config = _load_guru_monitor_config()
        if not config:
            print(f"⚠️ guru-monitor 配置不存在，跳过上报: {GURU_MONITOR_ROOT}")
            return False
        service = _guru_service_for_phase(config, phase)
        db_path = GURU_MONITOR_ROOT / "data" / "events.sqlite"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        event_time = datetime.now().astimezone().isoformat(timespec="seconds")
        snapshot_sha = (validation_result or {}).get("snapshot_sha256")
        if not snapshot_sha and snapshot_path:
            snapshot_sha = _snapshot_sha256(snapshot_path)
        dedup_seed = "|".join([
            "gaming-weekly-ai-validation",
            phase,
            level,
            title,
            snapshot_sha or str(snapshot_path or ""),
        ])
        dedup_key = hashlib.sha256(dedup_seed.encode("utf-8")).hexdigest()
        metadata = {
            "phase": phase,
            "snapshot_path": str(snapshot_path or (validation_result or {}).get("snapshot_path") or ""),
            "snapshot_sha256": snapshot_sha,
            "validation_result_path": (validation_result or {}).get("validation_result_path"),
            "blocking_issues": (validation_result or {}).get("blocking_issues") or [],
            "direct_feishu": bool(force_feishu),
        }
        conn = sqlite3.connect(db_path)
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    dedup_key TEXT NOT NULL UNIQUE,
                    service_name TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    repo_name TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    level TEXT NOT NULL,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL,
                    event_time TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    push_enabled INTEGER NOT NULL DEFAULT 1,
                    notified_at TEXT,
                    notification_attempts INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_events_event_time ON events(event_time);
                """
            )
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO events (
                    dedup_key, service_name, display_name, repo_name, event_type,
                    level, title, body, event_time, source_type, metadata_json,
                    push_enabled, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    dedup_key,
                    service.get("name"),
                    service.get("display_name"),
                    service.get("repo_name"),
                    "error" if level == "error" else "completion",
                    level,
                    title,
                    body,
                    event_time,
                    "ai_validation",
                    json.dumps(metadata, ensure_ascii=False),
                    0,
                    event_time,
                ),
            )
            conn.commit()
            inserted = cursor.rowcount > 0
        finally:
            conn.close()
        if inserted:
            print(f"✓ 已写入 guru-monitor 事件: {title}")
        else:
            print(f"↪ guru-monitor 已存在同类事件，跳过重复入库: {title}")
        if force_feishu and inserted:
            try:
                _send_guru_monitor_feishu(config.get("webhook_url"), title, body, level=level)
                print("✓ 已通过 guru-monitor 飞书 webhook 推送验证报告")
            except Exception as exc:
                print(f"⚠️ guru-monitor 飞书推送失败: {exc}")
        return inserted
    except Exception as exc:
        print(f"⚠️ 上报 guru-monitor 失败: {exc}")
        return False


def _attempt_regenerate_after_validation_failure(snapshot_path, validation_result, phase):
    payload = _load_report_snapshot(snapshot_path=snapshot_path, require_today=False)
    if _has_weekly_repair_attempt(payload, snapshot_path=snapshot_path, validation_result=validation_result):
        print("⚠️ 本周周报已经执行过一次 AI 打回重生成，按规则不再重复重试")
        report_path, report = _write_integrated_validation_report(
            payload,
            snapshot_path,
            validation_result,
            final_status="fail",
            note="本周已存在一次打回重生成记录，本次不再重复重试。",
        )
        _send_guru_monitor_report(
            phase=phase,
            level="error",
            title="Gaming Weekly AI 验证整合报告",
            body=_format_integrated_report_body(report_path, report),
            validation_result=validation_result,
            snapshot_path=snapshot_path,
            force_feishu=True,
        )
        return None, validation_result

    marker = _mark_weekly_repair_attempt(payload, snapshot_path, validation_result)
    print(f"↪ 已记录本周 AI 打回重生成尝试: {marker}")
    news_list = payload.get("news_list") or payload.get("news_preview") or []
    if not news_list:
        print("✗ 无法重生成周报: 快照中缺少 news_list")
        report_path, report = _write_integrated_validation_report(
            payload,
            snapshot_path,
            validation_result,
            final_status="fail",
            note="快照中缺少 news_list，无法打回第一个 AI 重生成。",
        )
        _send_guru_monitor_report(
            phase=phase,
            level="error",
            title="Gaming Weekly AI 验证整合报告",
            body=_format_integrated_report_body(report_path, report),
            validation_result=validation_result,
            snapshot_path=snapshot_path,
            force_feishu=True,
        )
        return None, validation_result

    repair_context = _build_repair_context(payload, validation_result)
    print("⏳ 正在把验证失败原因交给第一个 AI 重新生成周报（英文先行）...")
    report_en = generate_weekly_report_en(news_list, repair_context=repair_context)
    report_zh = generate_aligned_chinese_report(report_en, news_list) if report_en else None
    if not report_zh or not report_en:
        print("✗ AI 打回重生成失败")
        report_path, report = _write_integrated_validation_report(
            payload,
            snapshot_path,
            validation_result,
            final_status="fail",
            note="第一个 AI 重生成失败，未产生可验证的新快照。",
        )
        _send_guru_monitor_report(
            phase=phase,
            level="error",
            title="Gaming Weekly AI 验证整合报告",
            body=_format_integrated_report_body(report_path, report),
            validation_result=validation_result,
            snapshot_path=snapshot_path,
            force_feishu=True,
        )
        return None, validation_result

    repair_attempt = int(payload.get("repair_attempt") or 0) + 1
    repaired_snapshot = _save_reports_json(
        report_zh,
        report_en,
        news_list,
        repair_attempt=repair_attempt,
        source_snapshot_path=str(snapshot_path),
        validation_feedback=_format_validation_feedback(validation_result),
        date_window=payload.get("date_window"),
    )
    repaired_result = _run_reports_validation(repaired_snapshot)
    if repaired_result.get("overall_status") == "pass":
        _send_guru_monitor_report(
            phase=phase,
            level="info",
            title="Gaming Weekly AI 验证修复成功",
            body=(
                "第二个 AI 首次验证失败后，已将失败原因交给第一个 AI 重生成周报；"
                f"重生成快照已通过验证。\n快照: {repaired_snapshot}"
            ),
            validation_result=repaired_result,
            snapshot_path=repaired_snapshot,
            force_feishu=False,
        )
        report_path, report = _write_integrated_validation_report(
            payload,
            snapshot_path,
            validation_result,
            repaired_snapshot_path=repaired_snapshot,
            repaired_validation_result=repaired_result,
            final_status="pass",
            note="第二次验证通过，周报已恢复。",
        )
        _send_guru_monitor_report(
            phase=phase,
            level="error",
            title="Gaming Weekly AI 验证报告",
            body=_format_integrated_report_body(report_path, report),
            validation_result=repaired_result,
            snapshot_path=repaired_snapshot,
            force_feishu=True,
        )
        return repaired_snapshot, repaired_result

    failure_body = (
        "第二个 AI 首次验证失败后已按规则打回第一个 AI 重生成一次，但重生成快照仍未通过验证。\n"
        f"快照: {repaired_snapshot}\n"
        f"失败原因:\n{_format_validation_feedback(repaired_result)}"
    )
    _send_guru_monitor_report(
        phase=phase,
        level="error",
        title="Gaming Weekly AI 修复后验证仍失败",
        body=failure_body,
        validation_result=repaired_result,
        snapshot_path=repaired_snapshot,
        force_feishu=False,
    )
    report_path, report = _write_integrated_validation_report(
        payload,
        snapshot_path,
        validation_result,
        repaired_snapshot_path=repaired_snapshot,
        repaired_validation_result=repaired_result,
        final_status="fail",
        note="第二次验证仍未通过，周报继续被门禁阻断。",
    )
    _send_guru_monitor_report(
        phase=phase,
        level="error",
        title="Gaming Weekly AI 验证报告",
        body=_format_integrated_report_body(report_path, report),
        validation_result=repaired_result,
        snapshot_path=repaired_snapshot,
        force_feishu=True,
    )
    return None, repaired_result


def _validate_or_repair_snapshot(snapshot_path, phase):
    validation_result = _run_reports_validation(snapshot_path)
    if validation_result.get("overall_status") == "pass":
        return snapshot_path, validation_result

    block_text = "周报推送已被门禁阻断" if phase == "push" else "当前周报快照未通过门禁，后续推送会被阻断"
    failure_body = (
        f"第二个 AI 验证失败，{block_text}；系统将按规则最多打回第一个 AI 重生成一次。\n"
        f"快照: {snapshot_path}\n"
        f"验证结果: {validation_result.get('validation_result_path') or '无'}\n"
        f"失败原因:\n{_format_validation_feedback(validation_result)}"
    )
    _send_guru_monitor_report(
        phase=phase,
        level="error",
        title="Gaming Weekly AI 验证失败",
        body=failure_body,
        validation_result=validation_result,
        snapshot_path=snapshot_path,
        force_feishu=False,
    )
    return _attempt_regenerate_after_validation_failure(snapshot_path, validation_result, phase)


def _load_report_snapshot(snapshot_path=None, require_today=True):
    if snapshot_path:
        path = Path(snapshot_path)
        if not path.exists():
            raise FileNotFoundError(f"未找到指定快照: {path}")
    else:
        if not WEEKLY_REPORT_JSON_DIR.exists():
            raise FileNotFoundError(f"未找到周报快照目录: {WEEKLY_REPORT_JSON_DIR}")
        candidates = sorted(WEEKLY_REPORT_JSON_DIR.glob(WEEKLY_REPORT_FILE_GLOB))
        if require_today:
            today_prefix = f"weekly_report_{datetime.now().strftime('%Y%m%d')}_"
            candidates = [candidate for candidate in candidates if candidate.name.startswith(today_prefix)]
        if not candidates:
            date_hint = "今日" if require_today else "可用"
            raise FileNotFoundError(f"未找到{date_hint}周报快照")
        path = candidates[-1]

    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["_snapshot_path"] = str(path)
    if "news_list" not in payload:
        payload["news_list"] = payload.get("news_preview", [])
    return payload


def _utf8_len(text):
    """返回 UTF-8 字节长度（企业微信限制按字节更准确）"""
    return len(text.encode("utf-8"))


def _truncate_by_utf8_bytes(text, max_bytes):
    """按 UTF-8 字节上限截断，保证不破坏编码"""
    if _utf8_len(text) <= max_bytes:
        return text
    b = text.encode("utf-8")[:max_bytes]
    return b.decode("utf-8", errors="ignore")


def _split_text_by_utf8_bytes(text, max_bytes):
    """把超长文本按 UTF-8 字节长度硬切分"""
    parts = []
    remaining = text
    while remaining:
        part = _truncate_by_utf8_bytes(remaining, max_bytes)
        if not part:
            break
        parts.append(part)
        remaining = remaining[len(part):]
    return parts


def _split_sections_for_wework(markdown_text, max_len):
    """
    企业微信 markdown 智能分段（按 UTF-8 字节长度）：
    1) 优先按板块分段（尽量保持语义完整）
    2) 板块过长时按行切分
    3) 单行仍超限时再硬切
    """
    lines = markdown_text.split("\n")
    sections = []
    current = []

    def flush_current():
        if current:
            sections.append("\n".join(current).strip())
            current.clear()

    # 以标题行为优先边界，尽量保持每条消息的完整板块
    for line in lines:
        stripped = line.strip()
        is_section_title = (
            stripped.startswith("**")
            or stripped.startswith("📅")
            or stripped.startswith("---")
        )
        if is_section_title and current:
            flush_current()
        current.append(line)
    flush_current()

    chunks = []
    current_chunk = ""

    def push_chunk(chunk):
        if chunk and chunk.strip():
            chunks.append(chunk.strip())

    for sec in sections:
        if _utf8_len(sec) <= max_len:
            if not current_chunk:
                current_chunk = sec
            elif _utf8_len(current_chunk + "\n\n" + sec) <= max_len:
                current_chunk += "\n\n" + sec
            else:
                push_chunk(current_chunk)
                current_chunk = sec
            continue

        # 单个板块超限：按行拆分
        if current_chunk:
            push_chunk(current_chunk)
            current_chunk = ""

        line_buf = ""
        for line in sec.split("\n"):
            if _utf8_len(line) > max_len:
                # 单行超限：硬切
                if line_buf:
                    push_chunk(line_buf)
                    line_buf = ""
                for p in _split_text_by_utf8_bytes(line, max_len):
                    push_chunk(p)
                continue

            candidate = line if not line_buf else (line_buf + "\n" + line)
            if _utf8_len(candidate) <= max_len:
                line_buf = candidate
            else:
                push_chunk(line_buf)
                line_buf = line
        if line_buf:
            push_chunk(line_buf)

    if current_chunk:
        push_chunk(current_chunk)

    return chunks

def send_to_feishu(content, news_list):
    """推送到飞书（使用美观的卡片）"""
    if not FEISHU_WEBHOOK:
        print("✗ 飞书推送失败: 未配置 FEISHU_WEBHOOK")
        return False
    try:
        print("⏳ 正在推送到飞书...")
        
        import re
        from datetime import datetime, timedelta
        
        # 计算日期范围
        today = datetime.now()
        week_start = (today - timedelta(days=7)).strftime('%m.%d')
        week_end = today.strftime('%m.%d')
        
        # 解析内容
        lines = content.split('\n')
        
        # 提取标题和日期（从AI生成的内容中提取，如果有的话）
        title_line = lines[0] if lines else "Puzzle Game 出海市场周报"
        
        # 如果AI生成的标题中已经包含日期，提取出来；否则使用计算的日期
        date_match = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日\s*-\s*(\d{4})年(\d{1,2})月(\d{1,2})日', title_line)
        if date_match:
            # 提取AI生成的日期
            start_month, start_day = date_match.group(2), date_match.group(3)
            end_month, end_day = date_match.group(5), date_match.group(6)
            week_start = f"{start_month}.{start_day}"
            week_end = f"{end_month}.{end_day}"
        
        # 构建卡片元素
        elements = []
        
        # 解析内容，按板块分组
        current_section = None
        section_items = []
        
        for line in lines[1:]:
            line = line.strip()
            if not line:
                continue
            
            # 检查是否是板块标题
            if line.startswith("**"):
                # 保存上一个板块
                if current_section and section_items:
                    # 添加板块标题
                    elements.append({
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": current_section
                        }
                    })
                    # 添加板块内容
                    for item in section_items:
                        elements.append(item)
                    # 添加分割线
                    elements.append({"tag": "hr"})
                
                # 开始新板块
                current_section = line
                section_items = []
            
            # 检查是否包含 [#编号]
            elif '[#' in line:
                match = re.search(r'\[#(\d+)\]', line)
                if match:
                    news_index = int(match.group(1)) - 1
                    if news_index < len(news_list):
                        link_url = news_list[news_index]['link']
                        # 替换 [#编号] 为链接
                        text = line.replace(match.group(0), f"[查看原文]({link_url})")
                        
                        section_items.append({
                            "tag": "div",
                            "text": {
                                "tag": "lark_md",
                                "content": text
                            }
                        })
            
            # 分析师洞察（保持正常格式）
            elif line.startswith('>'):
                section_items.append({
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": line  # 保留 > 符号，Markdown会自动渲染为引用
                    }
                })
            
            # 普通文本
            elif line and not line.startswith('**'):
                section_items.append({
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": line
                    }
                })
        
        # 添加最后一个板块
        if current_section and section_items:
            elements.append({
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": current_section
                }
            })
            for item in section_items:
                elements.append(item)
        
        # 构建卡片
        payload = {
            "msg_type": "interactive",
            "card": {
                "config": {
                    "wide_screen_mode": True
                },
                "header": {
                    "template": "blue",
                    "title": {
                        "tag": "plain_text",
                        "content": f"🎮 Puzzle Game 出海市场周报 | {week_start} - {week_end}"
                    }
                },
                "elements": elements
            }
        }
        
        response = requests.post(FEISHU_WEBHOOK, json=payload, timeout=10)
        response.raise_for_status()
        
        result = response.json()
        if result.get('code') == 0:
            print("✓ 飞书推送成功！")
            return True
        else:
            print(f"✗ 飞书推送失败: {result}")
            return False
            
    except Exception as e:
        print(f"✗ 飞书推送失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def send_to_wework_markdown(content, news_list, link_label="查看原文"):
    """推送到企业微信（Markdown + 智能分段）"""
    if not WEWORK_WEBHOOK:
        print("✗ 企业微信推送失败: 未配置 WEWORK_WEBHOOK")
        return False

    try:
        print("⏳ 正在推送到企业微信...")
        md_content = _replace_reference_links(
            content,
            news_list,
            wework_mode=True,
            link_label=link_label,
        )
        # 预留分片前缀空间，避免加上“第x/n条”后超限
        split_limit = max(500, WEWORK_MD_MAX_LEN - 64)
        chunks = _split_sections_for_wework(md_content, split_limit)
        if not chunks:
            print("✗ 企业微信推送失败: 内容为空")
            return False

        for i, chunk in enumerate(chunks, 1):
            payload = {
                "msgtype": "markdown",
                "markdown": {"content": chunk}
            }
            response = requests.post(WEWORK_WEBHOOK, json=payload, timeout=10)
            response.raise_for_status()
            result = response.json()
            if result.get("errcode", -1) != 0:
                if result.get("errcode") == 40058:
                    print(
                        f"✗ 企业微信推送失败(分片 {i}/{len(chunks)}): 内容超长，"
                        f"当前字节数={_utf8_len(chunk)}，上限约=4096"
                    )
                else:
                    print(f"✗ 企业微信推送失败(分片 {i}/{len(chunks)}): {result}")
                return False

        print(f"✓ 企业微信推送成功！共 {len(chunks)} 条消息")
        return True
    except Exception as e:
        print(f"✗ 企业微信推送失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def _generate_reports_snapshot():
    print("开始运行 Puzzle Game 周报生成")
    print("步骤 1/2: 获取最近 7 天的游戏资讯")
    news_list = fetch_weekly_news()
    if not news_list:
        print("✗ 没有找到游戏相关资讯")
        return None

    print()
    print("步骤 2/2: 生成 AI 周报（先英文，再按相同链接生成中文）")
    report_en = generate_weekly_report_en(news_list)
    report_zh = generate_aligned_chinese_report(report_en, news_list) if report_en else None
    if not report_zh or not report_en:
        print("✗ 周报生成失败")
        return None

    snapshot_path = _save_reports_json(report_zh, report_en, news_list)
    return snapshot_path


def _push_reports_from_snapshot(snapshot_path=None, push_channels=None, require_today=True):
    print("开始运行 Puzzle Game 周报推送")
    if _local_push_disabled():
        print(
            "❌ 旧目录 gaming-daily-report2 已禁用真实周报推送；"
            "请改用 monitor-web/pipelines/monitor-chain/gaming-weekly 链路。"
        )
        return False
    payload = _load_report_snapshot(snapshot_path=snapshot_path, require_today=require_today)
    validated_snapshot, _validation_result = _validate_or_repair_snapshot(payload["_snapshot_path"], phase="push")
    if not validated_snapshot:
        print("❌ 周报推送已被 AI 验证门禁阻断")
        return False
    if validated_snapshot != payload["_snapshot_path"]:
        payload = _load_report_snapshot(snapshot_path=validated_snapshot, require_today=False)
    news_list = payload.get("news_list") or payload.get("news_preview") or []
    report_zh = ((payload.get("reports") or {}).get("zh") or "").strip()
    report_en = ((payload.get("reports") or {}).get("en") or "").strip()
    if not report_zh:
        print("✗ 周报推送失败: 快照中缺少中文报告")
        return False
    if not report_en:
        print("✗ 周报推送失败: 快照中缺少英文报告")
        return False

    print(f"步骤 1/1: 从快照推送消息 -> {payload['_snapshot_path']}")
    success = True
    pushed = []
    push_channels = push_channels or []

    if "feishu" in push_channels:
        feishu_ok = send_to_feishu(report_zh, news_list)
        success = success and feishu_ok
        if feishu_ok:
            pushed.append("飞书(中文)")

    if "wework" in push_channels:
        wework_zh_ok = send_to_wework_markdown(report_zh, news_list, link_label="查看原文")
        wework_en_ok = send_to_wework_markdown(report_en, news_list, link_label="Read original")
        wework_ok = wework_zh_ok and wework_en_ok
        success = success and wework_ok
        if wework_ok:
            pushed.append("企业微信(中英)")

    if success and pushed:
        print(f"Puzzle Game 周报推送完成：{', '.join(pushed)}")
    elif success and not pushed:
        print("⚠️ 未启用任何推送渠道，请检查 PUSH_CHANNELS")
    else:
        print("❌ 周报推送失败")
    return success

def main():
    parser = argparse.ArgumentParser(description="Puzzle Game 周报推送")
    parser.add_argument(
        "--phase",
        default="all",
        choices=("all", "generate", "validate", "push"),
        help="执行阶段：all=生成验证并推送，generate=生成并验证快照，validate=只验证快照，push=验证后推送",
    )
    parser.add_argument(
        "--channels",
        default="feishu,wework",
        help="推送通道，逗号分隔：feishu,wework（默认两个都推；飞书仅中文，企业微信中英）",
    )
    parser.add_argument(
        "--snapshot",
        default="",
        help="推送阶段指定周报快照 JSON 路径；不传则默认读取今日最新快照",
    )
    args = parser.parse_args()
    push_channels = [c.strip().lower() for c in args.channels.split(",") if c.strip()]

    print("=" * 60)
    print("🎮 Puzzle Game 出海市场周报")
    print("=" * 60)
    print()
    
    success = True
    snapshot_path = args.snapshot or None

    if args.phase in ("all", "generate"):
        snapshot_path = _generate_reports_snapshot()
        success = success and bool(snapshot_path)
        if snapshot_path:
            snapshot_path, _validation_result = _validate_or_repair_snapshot(snapshot_path, phase="generate")
            success = success and bool(snapshot_path)
        if success:
            print("Puzzle Game 周报生成完成")
        print()

    if success and args.phase == "validate":
        payload = _load_report_snapshot(
            snapshot_path=snapshot_path,
            require_today=not bool(args.snapshot),
        )
        snapshot_path, _validation_result = _validate_or_repair_snapshot(payload["_snapshot_path"], phase="validate")
        success = bool(snapshot_path)

    if success and args.phase in ("all", "push"):
        success = _push_reports_from_snapshot(
            snapshot_path=snapshot_path,
            push_channels=push_channels,
            require_today=not bool(args.snapshot),
        )

    print()
    print("=" * 60)
    if success:
        print("✅ Puzzle Game 出海市场周报流程完成！")
    else:
        print("❌ Puzzle Game 出海市场周报流程失败")
    print("=" * 60)
    return success

if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
