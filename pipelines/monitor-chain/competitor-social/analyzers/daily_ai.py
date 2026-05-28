"""
竞品日报AI分析模块
基于结构化帖子数据（标题、互动数据）进行分析
"""
import json
import os
import time
from typing import Any, Dict, List

from openai import OpenAI

import env_loader  # noqa: F401


API_KEY = os.getenv("OPENROUTER_API_KEY", "") or os.getenv("OPENAI_API_KEY", "")
DEFAULT_TIMEOUT = float(os.environ.get("OPENAI_TIMEOUT", "40"))
client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=API_KEY, timeout=DEFAULT_TIMEOUT)

# 模型顺序：优先主模型，失败则依次尝试后备。可通过环境变量覆盖。
# 主模型：OPENROUTER_MODEL，默认 Gemini；后备：OPENROUTER_MODEL_FALLBACKS，逗号分隔，默认 Kimi、Qwen
_DEFAULT_MODEL = "google/gemini-2.5-flash"
_DEFAULT_FALLBACKS = "moonshotai/kimi-k2.5,qwen/qwen3-32b"


def _get_model_list() -> List[str]:
    """主模型 + 后备模型列表（去重、去空）。"""
    primary = (os.getenv("OPENROUTER_MODEL") or "").strip() or _DEFAULT_MODEL
    fallbacks_str = (os.getenv("OPENROUTER_MODEL_FALLBACKS") or "").strip() or _DEFAULT_FALLBACKS
    fallbacks = [m.strip() for m in fallbacks_str.split(",") if m.strip()]
    seen = set()
    result = []
    for m in [primary] + fallbacks:
        if m and m not in seen:
            seen.add(m)
            result.append(m)
    return result


def build_competitor_prompt_for_daily(item: Dict[str, Any]) -> str:
    """
    针对单个竞品社媒账号构建日报AI分析提示词
    基于结构化的帖子数据（标题、互动数据）进行分析
    """
    company = item["company"]
    game = item.get("game")
    platform_type = item["platform_type"]
    url = item["url"]
    posts = item.get("posts", [])
    posts_count = item.get("posts_count", 0)
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

    # 如果没有帖子，返回特殊提示
    if posts_count == 0 or not posts:
        return f"""你是一个资深的游戏发行与投放总监，专门帮团队做「竞品社媒监控 & UA 创意洞察」。

现在给你的是某个竞品公司（或其旗下游戏）在社交媒体上的监控结果：

---
{context_desc}
【链接】{url}
【优先级】{priority}
【状态】昨天（目标日期）该账号无社媒更新（posts_count: 0）
---

请简要说明：
1. 该账号昨天没有发布新内容
2. 建议手动查看该账号链接，了解可能的原因（账号暂停更新、内容被删除、或其他情况）

请严格按以下 JSON 结构输出（不要出现多余字段或自然语言）：

{{
  "title": "{title}",
  "company": "{company}",
  "game": {game_json},
  "platform": "{platform_type}",
  "url": "{url}",
  "priority": "{priority}",
  "usability_score": 0,
  "analysis": {{
    "summary": "该账号昨天无社媒更新，建议手动查看链接了解情况。",
    "ad_creative_insights": "无新内容可分析。",
    "gameplay_or_mechanic_insights": "无新内容可分析。",
    "trend_and_positioning": "无新内容可分析。",
    "risk_or_warning": "",
    "direct_action_suggestions": "建议手动查看 {url} 了解账号状态和可能的原因。",
    "engagement": "无互动数据（昨天无新发布）。"
  }}
}}"""

    # 构建帖子数据内容
    posts_summary = []
    for i, post in enumerate(posts[:20], 1):  # 最多展示20条
        post_info = f"帖子 {i}:\n"

        # 标题/文本内容
        text = post.get("text") or post.get("title") or ""
        if text:
            post_info += f"- 标题/内容: {text[:300]}\n"  # 限制长度

        # 发布时间
        if post.get("published_at") or post.get("published_at_display"):
            post_info += f"- 发布时间: {post.get('published_at_display') or post.get('published_at', '')}\n"

        # 互动数据
        engagement = post.get("engagement", {})
        if engagement:
            eng_items = []
            if engagement.get("like"):
                eng_items.append(f"点赞: {engagement['like']}")
            if engagement.get("comment"):
                eng_items.append(f"评论: {engagement['comment']}")
            if engagement.get("share"):
                eng_items.append(f"分享: {engagement['share']}")
            if engagement.get("retweet"):
                eng_items.append(f"转发: {engagement['retweet']}")
            if engagement.get("view"):
                eng_items.append(f"观看: {engagement['view']}")
            if eng_items:
                post_info += f"- 互动数据: {', '.join(eng_items)}\n"

        # 帖子链接
        post_url = post.get("post_url") or post.get("link", "")
        if post_url:
            post_info += f"- 链接: {post_url}\n"

        # 媒体链接（如果有）
        media_urls = post.get("media_urls", [])
        if media_urls:
            post_info += f"- 媒体: {len(media_urls)} 个图片/视频\n"

        posts_summary.append(post_info)

    data_content = f"""【帖子数据】（共 {posts_count} 条，展示前 {min(len(posts), 20)} 条）

{chr(10).join(posts_summary)}

---
注意：这些是结构化数据，包含：
1. 标题/内容：帖子的文本内容
2. 发布时间：帖子发布时间
3. 互动数据：点赞、评论、分享、观看等数据
4. 链接：原帖链接（可用于直接查看）

请重点关注：
1. 他们发布了什么内容？标题/文案有什么特点？
2. 哪些帖子互动量高？互动数据透露了什么信息（用户偏好、内容热度）？
3. 有没有值得参考的创意方向、文案风格、内容形式？
4. 发帖频率和节奏如何？"""

    return f"""你是一个资深的游戏发行与投放总监，专门帮团队做「竞品社媒监控 & UA 创意洞察」。

现在给你的是某个竞品公司（或其旗下游戏）在社交媒体上昨天发布的帖子数据：

---
{context_desc}
【链接】{url}
【优先级】{priority}
{data_content}
---

请你分析他们昨天在社交媒体上的动态，并从「广告创意」和「玩法/机制」两个角度给出专业观察。

分析重点：
1. **内容分析**：他们昨天发布了什么内容？标题/文案有什么特点？主题是什么？
2. **互动分析**：哪些帖子互动量高？互动数据（点赞、评论、分享、观看）透露了什么信息？用户更偏好什么类型的内容？
3. **创意洞察**：从文案、内容形式、发布节奏等方面，有哪些值得参考的广告创意启发？
4. **玩法/机制**：有没有显露出新的玩法、活动机制、互动方式？
5. **趋势定位**：他们在形象/品牌/用户心智上试图占据什么位置？

特别说明（针对Instagram平台）：
- Instagram以视觉内容为主，请重点关注图片/视频的视觉风格、色彩搭配、构图方式
- 注意分析Hashtag的使用策略和话题标签的选择
- 关注Stories、Reels、Posts等不同内容形式的发布策略
- 分析文案长度、语气、emoji使用等文案风格特点

输出要求：
- 使用简体中文，面向懂投放和产品的同事
- 不要夸大其词，基于实际数据进行分析
- 尽量给出可以落地的 UA 素材 / 活动玩法建议
- 如果这是某个具体游戏的账号，请重点关注该游戏的玩法、活动、素材方向

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
    "summary": "用 3-6 句话总结这个竞品昨天在社媒上的主要动作（发布了什么内容、主题是什么、重点强调什么）。",
    "ad_creative_insights": "从标题/文案风格、内容形式、发布节奏等方面，总结值得参考的广告创意启发。用条列式中文总结。",
    "gameplay_or_mechanic_insights": "有没有显露出新的玩法、数值/活动机制、互动方式？如果有，简要概括，并说明为什么对我们有启发；如果看不出来，请写明。",
    "trend_and_positioning": "他们在形象/品牌/用户心智上试图占据什么位置？例如：硬核、休闲、搞笑、故事感、情绪价值等。",
    "risk_or_warning": "如果我们照抄这些创意/玩法，在哪些方面可能有风险（合规、品牌形象、舆论等）？如信息不足请注明。",
    "direct_action_suggestions": "给我们内部团队的可执行建议：可以尝试哪些具体素材方向、活动机制？请用中文列表列出 3-6 条。",
    "engagement": "结合互动数据（点赞、评论、分享、观看等），用一两句话概括昨天内容的大致互动情况。例如：'昨天发布的3条视频平均点赞1.2k，评论较少；其中一条关于新玩法的视频互动量最高（2.5k点赞）'。"
  }}
}}"""


def call_model_with_retry(prompt: str) -> Dict[str, Any]:
    """
    调用大模型并做简单重试，返回解析后的 JSON。
    先尝试主模型（默认 Gemini），失败则依次尝试后备模型（默认 Kimi、Qwen）。
    """
    if not API_KEY:
        print("⚠️ 未配置 OPENROUTER_API_KEY / OPENAI_API_KEY，大模型分析将被跳过。")
        return {}

    timeout = float(os.environ.get("OPENAI_TIMEOUT", DEFAULT_TIMEOUT))
    model_list = _get_model_list()
    last_error: Exception | None = None

    for model in model_list:
        for attempt in range(2):
            try:
                resp = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"},
                    timeout=timeout,
                )
                content = (resp.choices[0].message.content or "").strip()
                if not content:
                    continue
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    # 兼容被包在 ```json ... ``` 里的返回
                    if "```" in content:
                        start = content.find("```")
                        start = content.find("\n", start) + 1 if content.find("\n", start) >= 0 else start + 3
                        end = content.rfind("```")
                        if end > start:
                            try:
                                return json.loads(content[start:end].strip())
                            except json.JSONDecodeError:
                                pass
                    raise
            except Exception as exc:
                last_error = exc
                if attempt < 1:
                    print(f"  [WARN] 模型 {model} 调用失败，重试 {attempt+1}/2: {exc}")
                    time.sleep(2 * (attempt + 1))
                else:
                    print(f"  [WARN] 模型 {model} 调用失败，尝试后备模型: {exc}")
        # 当前模型两次都失败，尝试下一个
        if model != model_list[-1]:
            print(f"  [INFO] 切换到后备模型: {model_list[model_list.index(model) + 1]}")

    print(f"❌ 所有模型均调用失败: {last_error}")
    return {}
