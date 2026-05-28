import json
import os
from typing import Any, Dict, List, Tuple

import env_loader  # noqa: F401  # 确保 .env 中的 OPENROUTER_API_KEY / OPENAI_API_KEY 被加载

from analyzers.daily_ai import call_model_with_retry


def load_raw_social(path: str = "/app/output/competitor_social_raw.json") -> Tuple[List[Dict[str, Any]], str | None]:
    """
    读取第 1 步爬虫的结果：competitor_social_raw.json
    返回 (items, fetched_at_iso)
    """
    if not os.path.exists(path):
        # 兼容本地运行
        alt = os.path.join(os.path.dirname(__file__), "output", "competitor_social_raw.json")
        if os.path.exists(alt):
            path = alt
        else:
            print(f"❌ 未找到社媒原始数据文件: {path}")
            return [], None

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        print(f"❌ 读取或解析社媒原始数据失败: {exc}")
        return [], None

    items = data.get("items") or []
    fetched_at = data.get("fetched_at")
    norm_items: List[Dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        # 支持新格式：company, game, platform_type
        company = (it.get("company") or "").strip()
        game = it.get("game")  # 可能为 None
        platform_type = (it.get("platform_type") or it.get("platform") or "unknown").strip()
        url = (it.get("url") or "").strip()
        html_snippet = (it.get("html_snippet") or "").strip()
        posts = it.get("posts") or []  # 新增：解析出的帖子列表
        posts_count = it.get("posts_count", 0)  # 新增：帖子数量
        priority = (it.get("priority") or "medium").strip()

        # 兼容旧格式：name, platform
        if not company:
            company = (it.get("name") or "").strip()
        if not company or not url:
            continue
        # 允许没有html_snippet（如果已经有posts数据）

        norm_items.append(
            {
                "company": company,
                "game": game,
                "platform_type": platform_type,
                "url": url,
                "html_snippet": html_snippet,
                "posts": posts,  # 新增
                "posts_count": posts_count,  # 新增
                "priority": priority,
            }
        )
    return norm_items, fetched_at


def build_competitor_prompt(item: Dict[str, Any]) -> str:
    """
    针对单个竞品社媒账号构建提示词：
    - 优先使用解析出的帖子数据（posts），如果没有则回退到HTML片段
    - 让模型分析最近的发帖内容、互动情况
    - 帮忙识别"新广告创意"和"新玩法/机制"
    - 用中文输出，方便直接给投放和产品同学看
    """
    company = item["company"]
    game = item.get("game")
    platform_type = item["platform_type"]
    url = item["url"]
    posts = item.get("posts", [])  # 新增：解析出的帖子列表
    posts_count = item.get("posts_count", 0)
    snippet = item.get("html_snippet", "")  # 备选：HTML片段
    priority = item.get("priority", "medium")

    # 构建显示标题
    if game:
        title = f"{company} - {game} - {platform_type}"
        context_desc = f"【竞品公司】{company}\n【游戏名称】{game}\n【平台】{platform_type}"
    else:
        title = f"{company} - {platform_type}"
        context_desc = f"【竞品公司】{company}\n【平台】{platform_type}"

    # 处理 game 字段的 JSON 格式
    game_json = "null" if game is None else f'"{game}"'

    # 构建数据内容部分
    if posts and len(posts) > 0:
        # 优先使用解析出的帖子数据
        posts_summary = []
        for i, post in enumerate(posts[:10], 1):  # 最多展示10条
            post_info = f"帖子 {i}:\n"
            if post.get("text"):
                post_info += f"- 内容: {post['text'][:500]}\n"  # 限制长度
            if post.get("published_at") or post.get("published_at_display"):
                post_info += f"- 发布时间: {post.get('published_at_display') or post.get('published_at', '')}\n"
            if post.get("post_url"):
                post_info += f"- 链接: {post['post_url']}\n"
            if post.get("engagement"):
                eng = post["engagement"]
                eng_str = ", ".join([f"{k}: {v}" for k, v in eng.items() if v])
                if eng_str:
                    post_info += f"- 互动数据: {eng_str}\n"
            if post.get("media_urls"):
                post_info += f"- 媒体: {len(post['media_urls'])} 个图片/视频\n"
            posts_summary.append(post_info)

        data_content = f"""【解析出的帖子数据】（共 {posts_count} 条，展示前 {min(len(posts), 10)} 条）

{chr(10).join(posts_summary)}

---
注意：这些是从HTML中解析出的结构化帖子数据。请重点关注：
1. 他们最近发布了什么内容（新游戏、活动、更新等）？
2. 哪些帖子互动量高（点赞、评论、分享）？可能暗示什么创意方向？
3. 有没有新的视频/图片素材值得参考？
4. 发帖频率和节奏如何？
"""
    else:
        # 回退到HTML片段
        data_content = f"""【HTML 片段】（可能包含最近多条发帖、评论、活动文案等，但需要你从HTML中提取信息）

{snippet[:8000] if snippet else "（无HTML数据）"}

---
注意：由于无法解析出结构化帖子数据，请尝试从HTML片段中提取关键信息。
"""

    return f"""你是一个资深的游戏发行与投放总监，专门帮团队做「竞品社媒监控 & UA 创意洞察」。

现在给你的是某个竞品公司（或其旗下游戏）在社交媒体上的最新动态：

---
{context_desc}
【链接】{url}
【优先级】{priority}
{data_content}
---

请你分析他们最近在社交媒体上做了哪些动作，并从「广告创意」和「玩法/机制」两个角度给出专业观察。

输出要求：
- 使用简体中文，面向懂投放和产品的同事。
- 不要夸大其词，如果信息不够清晰，要明确说明「信息不足」。
- 尽量给出可以落地的 UA 素材 / 活动玩法建议。
- 如果这是某个具体游戏的账号，请重点关注该游戏的玩法、活动、素材方向。
- 重点关注：他们有没有发新的帖子/视频？内容是什么？互动情况如何？

请严格按以下 JSON 结构输出（不要出现多余字段或自然语言）：

{{
  "title": "{title}",
  "company": "{company}",
  "game": {game_json},
  "platform": "{platform_type}",
  "url": "{url}",
  "priority": "{priority}",
  "usability_score": 0-10 的数字评分（越高代表越值得跟进作为广告创意/玩法参考）,
  "analysis": {{
    "summary": "用 3-6 句话总结这个竞品在最近社媒上的主要动作（发布了什么内容、在强调什么卖点/活动）。特别说明：有没有发新的帖子/视频？",
    "ad_creative_insights": "他们在文案、素材形式、节奏上有哪些值得参考的广告创意？用条列式中文总结。",
    "gameplay_or_mechanic_insights": "有没有显露出新的玩法、数值/活动机制、互动方式？如果有，简要概括，并说明为什么对我们有启发；如果看不出来，请写明。",
    "trend_and_positioning": "他们在形象/品牌/用户心智上试图占据什么位置？例如：硬核、休闲、搞笑、故事感、情绪价值等。",
    "risk_or_warning": "如果我们照抄这些创意/玩法，在哪些方面可能有风险（合规、品牌形象、舆论等）？如信息不足请注明。",
    "direct_action_suggestions": "给我们内部团队的可执行建议：可以尝试哪些具体素材方向、活动机制？请用中文列表列出 3-6 条。",
    "engagement": "结合解析出的互动数据（点赞、评论、分享、观看等），用一两句话概括最近内容的大致互动情况。例如：'最近发布的3条视频平均点赞1.2k，评论较少；其中一条关于新玩法的视频互动量最高（2.5k点赞）'。如信息不足请说明。"
  }}
}}"""


def analyze_competitors() -> None:
    """
    工作流第 2 步：对爬取到的竞品社媒内容做 AI 总结与创意洞察。
    输出为 /app/output/competitor_ai_result.json
    """
    items, fetched_at = load_raw_social()
    if not items:
        return

    results: Dict[str, Any] = {}
    for it in items:
        company = it["company"]
        game = it.get("game")
        platform_type = it["platform_type"]

        # 构建显示标题
        if game:
            title = f"{company} - {game} - {platform_type}"
        else:
            title = f"{company} - {platform_type}"

        print(f"[*] 正在分析：{title}")
        prompt = build_competitor_prompt(it)
        data = call_model_with_retry(prompt)
        if not data:
            print(f"⚠️ 分析失败，跳过：{title}")
            continue

        # 兼容 sender 现有的结构习惯：顶层是一个映射 title -> payload
        key = data.get("title") or title
        try:
            score = float(data.get("usability_score", 0))
        except Exception:
            score = 0.0

        payload = {
            "company": data.get("company") or company,
            "game": data.get("game") or game,
            "platform": data.get("platform") or platform_type,
            "url": data.get("url") or it["url"],
            "priority": data.get("priority") or it.get("priority", "medium"),
            "usability_score": score,
            "analysis": data.get("analysis") or {},
        }
        # 将抓取时间透传给下游，用于日报展示来源日期
        if fetched_at:
            payload["fetched_at"] = fetched_at
        results[key] = payload

    if not results:
        print("⚠️ 未生成任何有效的竞品 AI 分析结果。")
        return

    output_dir = "/app/output"
    if not os.path.exists(output_dir):
        output_dir = os.path.join(os.path.dirname(__file__), "output")
        os.makedirs(output_dir, exist_ok=True)

    out_path = os.path.join(output_dir, "competitor_ai_result.json")
    try:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"✅ 竞品社媒 AI 分析结果已保存至: {out_path}")
    except Exception as exc:
        print(f"❌ 保存 AI 结果失败: {exc}")


if __name__ == "__main__":
    analyze_competitors()
