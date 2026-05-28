import json
import os
import time
import re
import warnings
from datetime import datetime, date, timedelta
from typing import Any, Dict, List, Tuple
from pathlib import Path

import requests
import yaml

# 抑制 libpng 警告（来自 PIL/Pillow 等图像处理库）
warnings.filterwarnings('ignore', message='.*tRNS.*')
os.environ['PYTHONWARNINGS'] = 'ignore::UserWarning'

import env_loader  # noqa: F401  # 确保 .env 中的 FEISHU_WEBHOOK_URL 被加载


DEFAULT_INPUT_PATH = "/app/output/competitor_ai_result.json"
DEFAULT_REPORTS_DIR = "/app/db/reports"


def load_ai_results_from_reports(reports_dir: str, target_date: date = None) -> Dict[str, Any]:
    """
    从 db/reports 目录读取指定日期的所有公司日报，合并 ai_results

    Args:
        reports_dir: 报告目录路径
        target_date: 目标日期，如果为None则使用昨天（默认读取昨天的日报）

    Returns:
        合并后的 AI 结果字典，格式为 {title: payload}
    """
    if target_date is None:
        target_date = date.today() - timedelta(days=1)  # 默认读取昨天的日报

    date_str = target_date.strftime("%Y-%m-%d")

    # 兼容本地运行
    if not os.path.exists(reports_dir):
        alt_dir = os.path.join(os.path.dirname(__file__), "db", "reports")
        if os.path.exists(alt_dir):
            reports_dir = alt_dir
        else:
            print(f"❌ 未找到报告目录: {reports_dir}")
            return {}

    print(f"📂 从报告目录读取数据: {reports_dir}")
    print(f"📅 目标日期: {date_str}")

    # 按日期分文件夹：先进入日期子文件夹
    date_reports_dir = os.path.join(reports_dir, date_str)

    # 如果日期文件夹不存在，尝试旧格式（兼容性）
    if not os.path.exists(date_reports_dir):
        print(f"  ⚠️ 日期文件夹不存在: {date_reports_dir}，尝试旧格式...")
        # 回退到旧格式：直接在 reports_dir 下查找文件
        date_reports_dir = reports_dir
        use_old_format = True
    else:
        use_old_format = False

    # 查找所有匹配的日报文件：{company}_{date}.json
    pattern = re.compile(rf"^(.+?)_{re.escape(date_str)}\.json$")
    merged_results: Dict[str, Any] = {}
    found_files = []

    try:
        for filename in os.listdir(date_reports_dir):
            file_path = os.path.join(date_reports_dir, filename)

            # 只处理文件，跳过文件夹
            if not os.path.isfile(file_path):
                continue

            match = pattern.match(filename)
            if match:
                company = match.group(1)
                found_files.append((company, file_path))

        if not found_files:
            print(f"⚠️ 未找到 {date_str} 的日报文件")
            return {}

        print(f"✓ 找到 {len(found_files)} 个公司的日报文件")

        # 读取每个公司的日报并合并 ai_results
        for company, file_path in found_files:
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    report_data = json.load(f)

                ai_results = report_data.get("ai_results", {})
                if ai_results:
                    # 合并到总结果中
                    merged_results.update(ai_results)
                    print(f"  ✓ {company}: 合并了 {len(ai_results)} 个平台的AI结果")
                else:
                    print(f"  ⚠️ {company}: 无AI结果数据")

            except Exception as exc:
                print(f"  ❌ 读取 {company} 的日报失败: {exc}")
                continue

        print(f"✅ 总共合并了 {len(merged_results)} 个平台的AI结果")
        return merged_results

    except Exception as exc:
        print(f"❌ 读取报告目录失败: {exc}")
        return {}


def load_ai_results(file_path: str = None) -> Dict[str, Any]:
    """
    加载AI结果数据

    优先从 db/reports 目录读取当天的日报
    如果指定了 file_path，则从该文件读取（兼容旧方式）
    """
    # 如果指定了文件路径，使用旧方式
    if file_path:
        if not os.path.exists(file_path):
            # 兼容本地运行
            alt = os.path.join(os.path.dirname(__file__), "output", os.path.basename(file_path))
            if os.path.exists(alt):
                file_path = alt
            else:
                print(f"❌ 未找到 AI 结果文件: {file_path}")
                return {}
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            print(f"❌ 读取或解析 AI 结果失败: {exc}")
            return {}

    # 默认从 db/reports 目录读取昨天的日报
    reports_dir = os.environ.get("COMPETITOR_REPORTS_DIR", DEFAULT_REPORTS_DIR)

    # 支持通过环境变量指定日期
    target_date = None
    date_str = os.environ.get("COMPETITOR_REPORT_DATE")
    if date_str:
        try:
            target_date = date.fromisoformat(date_str)
        except ValueError:
            print(f"⚠️ 无效的日期格式: {date_str}，使用昨天")
            target_date = date.today() - timedelta(days=1)

    # 支持通过环境变量指定 days_ago
    days_ago = os.environ.get("COMPETITOR_REPORT_DAYS_AGO")
    if days_ago:
        try:
            days = int(days_ago)
            target_date = date.today() - timedelta(days=days)
        except ValueError:
            print(f"⚠️ 无效的 days_ago: {days_ago}，使用昨天")
            target_date = date.today() - timedelta(days=1)

    # 如果没有指定日期，默认使用昨天
    if target_date is None:
        target_date = date.today() - timedelta(days=1)

    return load_ai_results_from_reports(reports_dir, target_date)


def get_feishu_webhook() -> str:
    """
    与原 sender 中保持一致的 webhook 获取逻辑：
    - 优先读取环境变量 FEISHU_WEBHOOK_URL / FEISHU_URL / FEISHU_WEBHOOK
    - 否则回落到 config/config.yaml 的 notification.webhooks.feishu_url
    """
    for env_key in ("FEISHU_WEBHOOK_URL", "FEISHU_URL", "FEISHU_WEBHOOK"):
        if os.environ.get(env_key):
            return os.environ[env_key]

    config_path = os.environ.get("CONFIG_PATH", "/app/config/config.yaml")
    if not os.path.exists(config_path):
        alt = os.path.join(os.path.dirname(__file__), "config", "config.yaml")
        if os.path.exists(alt):
            config_path = alt
        else:
            return ""
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        return (
            cfg.get("notification", {})
            .get("webhooks", {})
            .get("feishu_url", "")
        )
    except Exception as exc:
        print(f"⚠️ 读取配置失败，跳过 config.yaml: {exc}")
        return ""


def _platform_icon(platform: str) -> str:
    """
    根据平台类型返回一个简单的 icon，提升可读性。
    """
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


def _format_report_date(ai_data: Dict[str, Any]) -> str:
    """
    从结果中推断抓取日期（fetched_at），用于日报头部展示。
    """
    if not isinstance(ai_data, dict):
        return ""

    fetched_at: str | None = None
    for payload in ai_data.values():
        if not isinstance(payload, dict):
            continue
        fetched_at = payload.get("fetched_at")
        if fetched_at:
            break

    if not fetched_at:
        return ""

    try:
        # 兼容 ISO8601 带 Z 的格式
        if fetched_at.endswith("Z"):
            dt = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(fetched_at)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return fetched_at


def _get_company_color(company: str, index: int) -> str:
    """
    为不同公司分配不同颜色的边框
    使用预定义的颜色列表，通过索引或哈希值分配
    """
    # 飞书支持的颜色模板
    colors = [
        "blue",      # 蓝色
        "wathet",    # 浅蓝色
        "turquoise", # 青绿色
        "green",     # 绿色
        "yellow",    # 黄色
        "orange",    # 橙色
        "red",       # 红色
        "carmine",   # 深红色
        "violet",    # 紫色
        "purple",    # 紫色
        "indigo",    # 靛蓝色
        "grey",      # 灰色
    ]

    # 使用公司名称的哈希值来分配颜色，确保同一公司总是使用相同颜色
    hash_value = hash(company.lower()) % len(colors)
    return colors[hash_value]


def build_feishu_cards(ai_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    将竞品 AI 分析结果转成飞书卡片格式，提升可读性和视觉效果。
    - 按公司品牌分组，每个公司一个卡片
    - 不同公司使用不同颜色的边框
    - 使用丰富的视觉元素（图标、颜色、字体样式）
    """
    if not isinstance(ai_data, dict):
        return []

    report_date = _format_report_date(ai_data)

    # 先按公司进行分组
    company_groups: Dict[str, List[Tuple[str, Dict[str, Any]]]] = {}
    for title, payload in ai_data.items():
        if not isinstance(payload, dict):
            continue
        company = payload.get("company") or title
        company_groups.setdefault(company, []).append((title, payload))

    def score_of(payload: Dict[str, Any]) -> float:
        try:
            return float(payload.get("usability_score", -1))
        except Exception:
            return -1.0

    cards: List[Dict[str, Any]] = []

    # 按公司名称排序
    sorted_companies = sorted(company_groups.items(), key=lambda kv: kv[0].lower())

    for company_idx, (company, items) in enumerate(sorted_companies, 1):
        # 为每个公司分配颜色
        company_color = _get_company_color(company, company_idx)

        # 组内按评分排序
        items_sorted = sorted(items, key=lambda kv: score_of(kv[1]), reverse=True)

        # 构建卡片元素
        elements: List[Dict[str, Any]] = []

        # 添加日期和来源信息（仅第一个公司卡片显示）
        if company_idx == 1:
            header_info = []
            if report_date:
                header_info.append(f"📅 **日期**: {report_date}（抓取时间）")
            header_info.append("📎 **来源**: 各竞品官方社媒页面（X / Instagram / TikTok / YouTube 等）")
            elements.append({
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "\n".join(header_info)
                }
            })
            elements.append({"tag": "hr"})  # 分隔线

        # 添加公司标题
        company_title = f"🏢 **{company}**"
        if len(items_sorted) > 1:
            company_title += f" ({len(items_sorted)} 个平台)"
        elements.append({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": company_title
            }
        })

        # 为每个平台/游戏添加详细信息
        for idx, (title, payload) in enumerate(items_sorted, 1):
            game = payload.get("game")
            platform = payload.get("platform") or ""
            url = payload.get("url") or ""
            priority = payload.get("priority", "medium")
            score = payload.get("usability_score", "")
            analysis = payload.get("analysis") or {}

            summary = analysis.get("summary") or ""
            ad_insight = analysis.get("ad_creative_insights") or ""
            gameplay_insight = analysis.get("gameplay_or_mechanic_insights") or ""
            action_suggestions = analysis.get("direct_action_suggestions") or ""
            engagement = analysis.get("engagement") or ""

            platform_icon = _platform_icon(platform)

            # 构建平台/游戏标题
            platform_title_parts = [f"{platform_icon}"]
            if game:
                platform_title_parts.append(f"**{game}**")
            else:
                platform_title_parts.append(f"**{company} 官方账号**")
            if platform:
                platform_title_parts.append(f"({platform})")

            # 优先级标识
            priority_text = ""
            if priority == "high":
                priority_text = " 🔴 **高优先级**"
            elif priority == "low":
                priority_text = " 🟡 **低优先级**"

            platform_title = " ".join(platform_title_parts) + priority_text

            # 创建字段（两列布局）
            fields: List[Dict[str, Any]] = []

            # 第一行：平台信息和链接
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

            # 评分和互动情况（如果有）
            score_info = []
            if score != "":
                try:
                    score_val = float(score)
                    score_stars = "⭐" * min(int(score_val / 2), 5) if score_val > 0 else ""
                    score_info.append(f"📊 **可用性评分**: {score} {score_stars}")
                except Exception:
                    score_info.append(f"📊 **可用性评分**: {score}")

            if engagement:
                score_info.append(f"👍 **互动概览**: {engagement}")

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

            # 内容部分
            content_lines = []
            if summary:
                content_lines.append(f"📝 **摘要**: {summary}")
            if ad_insight:
                content_lines.append(f"🎯 **广告创意观察**: {ad_insight}")
            if gameplay_insight:
                content_lines.append(f"🎮 **玩法/机制观察**: {gameplay_insight}")
            if action_suggestions:
                content_lines.append(f"✅ **建议动作**: {action_suggestions}")

            if content_lines:
                elements.append({
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": "\n\n".join(content_lines)
                    }
                })

            # 如果不是最后一个，添加分隔线
            if idx < len(items_sorted):
                elements.append({"tag": "hr"})

        # 构建卡片
        card = {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": company_color,  # 使用公司专属颜色
                "title": {
                    "tag": "plain_text",
                    "content": f"🏁 竞品监控 · {company}"
                }
            },
            "elements": elements
        }

        cards.append(card)

    return cards


def send_feishu_cards(webhook: str, cards: List[Dict[str, Any]]) -> bool:
    """
    发送飞书卡片消息
    """
    if not webhook:
        print("❌ 未找到飞书 webhook，请设置 FEISHU_WEBHOOK_URL 或配置 config.yaml")
        return False
    if not cards:
        print("⚠️ 卡片内容为空，取消发送。")
        return False

    success = True
    for idx, card in enumerate(cards, 1):
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
                    print(f"✅ 第 {idx}/{len(cards)} 条卡片推送成功")
                    sent = True
                    break
                else:
                    print(f"❌ 第 {idx} 条卡片推送失败: {resp.text}")
            except Exception as exc:
                print(f"❌ 第 {idx} 条卡片推送异常: {exc}")
            if attempt < 2 and not sent:
                time.sleep(2)

        success = success and sent

    if success:
        print(f"✅ 竞品社媒监控已推送至飞书群（共 {len(cards)} 条卡片）。")
    return success


def main() -> int:
    webhook = get_feishu_webhook()

    # 优先从环境变量获取输入路径（兼容旧方式）
    input_path = os.environ.get("COMPETITOR_AI_INPUT_PATH")

    # 如果指定了输入路径，使用旧方式；否则从 db/reports 读取
    ai_data = load_ai_results(input_path if input_path else None)

    if not ai_data:
        print("⚠️ AI 结果为空或格式不符，未发送推送")
        print("💡 提示：")
        print("   - 如果使用旧方式，请设置环境变量 COMPETITOR_AI_INPUT_PATH")
        print("   - 如果使用新方式，请确保 db/reports 目录下有昨天的日报文件（默认读取昨天）")
        print("   - 可以通过 COMPETITOR_REPORT_DATE (YYYY-MM-DD) 指定日期")
        print("   - 或通过 COMPETITOR_REPORT_DAYS_AGO (数字) 指定几天前，默认为1（昨天）")
        return 1

    cards = build_feishu_cards(ai_data)
    ok = send_feishu_cards(webhook, cards)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
