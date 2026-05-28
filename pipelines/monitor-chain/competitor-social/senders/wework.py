"""
从已生成的报告文件发送到企业微信
读取飞书格式的报告JSON文件，转换为企业微信格式并发送
"""
import argparse
import json
import os
import re
import sys
import time
from typing import Dict, Any, Optional

import requests
import yaml

import env_loader  # noqa: F401


def get_wework_webhook(webhook_type: str = "default") -> tuple[str, str]:
    """
    获取企业微信webhook地址和消息类型

    Args:
        webhook_type: webhook类型，可选值：
            - "default" 或 "wework": 使用 WEWORK_WEBHOOK_URL
            - "real": 使用 REAL_WEBHOOK_URL

    Returns:
        (webhook_url, msg_type) - webhook地址和消息类型（markdown/text）
    """
    webhook = ""
    msg_type = os.environ.get("WEWORK_MSG_TYPE", "markdown")

    # 根据类型选择不同的环境变量
    if webhook_type.lower() in ("real", "real_webhook"):
        # 使用REAL_WEBHOOK_URL
        webhook = os.environ.get("REAL_WEBHOOK_URL", "")
    else:
        # 默认使用WEWORK_WEBHOOK_URL
        webhook = os.environ.get("WEWORK_WEBHOOK_URL") or os.environ.get("WEWORK_URL") or ""

    # 如果环境变量没有，从配置文件读取
    if not webhook:
        config_path = os.environ.get("CONFIG_PATH", "config/config.yaml")
        if not os.path.exists(config_path):
            alt = os.path.join(os.path.dirname(__file__), "config", "config.yaml")
            if os.path.exists(alt):
                config_path = alt
            else:
                return "", "markdown"

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            webhooks = cfg.get("notification", {}).get("webhooks", {})

            if webhook_type.lower() in ("real", "real_webhook"):
                webhook = webhooks.get("real_wework_url", webhooks.get("wework_url", ""))
            else:
                webhook = webhooks.get("wework_url", "")

            msg_type = webhooks.get("wework_msg_type", "markdown")
        except Exception:
            return "", "markdown"

    return webhook, msg_type


def convert_feishu_card_to_wework_markdown(
    company: str,
    card: Dict[str, Any]
) -> str:
    """
    将飞书卡片转换为企业微信markdown格式

    Args:
        company: 公司名称
        card: 飞书卡片字典

    Returns:
        企业微信markdown格式的字符串
    """
    header = card.get("header", {})
    title = header.get("title", {}).get("content", f"🏁 竞品监控 · {company}")
    elements = card.get("elements", [])

    markdown_lines = [f"# {title}", ""]

    for element in elements:
        tag = element.get("tag", "")

        if tag == "hr":
            markdown_lines.append("---")
            markdown_lines.append("")

        elif tag == "div":
            # 处理文本内容
            text = element.get("text", {})
            if text:
                content = text.get("content", "")
                if content:
                    # 清理多余的换行，但保留段落分隔
                    content = content.strip()
                    if content:
                        markdown_lines.append(content)
                        markdown_lines.append("")

            # 处理字段
            fields = element.get("fields", [])
            if fields:
                for field in fields:
                    field_text = field.get("text", {})
                    if field_text:
                        content = field_text.get("content", "")
                        if content:
                            content = content.strip()
                            if content:
                                markdown_lines.append(content)
                                markdown_lines.append("")

    # 移除末尾多余的换行
    while markdown_lines and not markdown_lines[-1].strip():
        markdown_lines.pop()

    return "\n".join(markdown_lines)


def split_card_by_platforms(
    company: str,
    card: Dict[str, Any]
) -> list[Dict[str, Any]]:
    """
    将飞书卡片按平台分割成多个部分
    每个平台的分析作为独立的消息

    Args:
        company: 公司名称
        card: 飞书卡片字典

    Returns:
        平台消息列表，每个元素包含 {"header": str, "content": str, "char_count": int, "platform_index": int}
    """
    header = card.get("header", {})
    title = header.get("title", {}).get("content", f"🏁 竞品监控 · {company}")
    elements = card.get("elements", [])

    # 首先转换为完整的markdown，然后按平台分割
    full_markdown = convert_feishu_card_to_wework_markdown(company, card)

    # 按"---"分隔符和平台标题模式分割
    # 平台标题模式：**数字. 图标 **游戏名** (平台类型)**
    lines = full_markdown.split('\n')

    # 找到"平台更新分析"标题的位置
    analysis_start_idx = -1
    for i, line in enumerate(lines):
        if "平台更新分析" in line:
            analysis_start_idx = i
            break

    if analysis_start_idx < 0:
        # 没有找到平台分析部分，返回完整内容
        return [{
            "header": full_markdown,
            "content": full_markdown,
            "char_count": len(full_markdown),
            "platform_index": 1,
            "platform_content": full_markdown
        }]

    # 提取头部信息（标题、时间段、监控平台列表）
    header_lines = lines[:analysis_start_idx + 2]  # 包括"平台更新分析"标题和后面的分隔线
    header_content = '\n'.join(header_lines).strip()

    # 提取平台分析部分
    platform_lines = lines[analysis_start_idx + 2:]

    # 按平台分割（每个平台以"**数字."开头）
    platform_blocks = []
    current_platform = []

    for line in platform_lines:
        # 检测平台标题：以"**"开头，包含数字和点号
        if line.strip().startswith('**') and re.match(r'\*\*\d+\.', line.strip()):
            # 新平台开始
            if current_platform:
                platform_blocks.append(current_platform)
            current_platform = [line]
        elif line.strip() == '---':
            # 分隔线，可能是平台之间的分隔
            if current_platform:
                # 检查下一个非空行是否是新的平台标题
                current_platform.append(line)
        else:
            if current_platform:
                current_platform.append(line)

    # 添加最后一个平台
    if current_platform:
        platform_blocks.append(current_platform)

    if not platform_blocks:
        # 没有找到平台块，返回完整内容
        return [{
            "header": header_content,
            "content": full_markdown,
            "char_count": len(full_markdown),
            "platform_index": 1,
            "platform_content": '\n'.join(platform_lines).strip()
        }]

    # 构建每个平台的消息
    result = []

    for idx, platform_lines_block in enumerate(platform_blocks, 1):
        # 清理平台内容
        platform_content_lines = []
        for line in platform_lines_block:
            if line.strip() or platform_content_lines:  # 保留非空行，或已有内容后的空行
                platform_content_lines.append(line)

        # 移除末尾空行
        while platform_content_lines and not platform_content_lines[-1].strip():
            platform_content_lines.pop()

        platform_content = '\n'.join(platform_content_lines).strip()
        full_content = f"{header_content}\n\n---\n\n{platform_content}"
        char_count = len(full_content)

        result.append({
            "header": header_content,
            "content": full_content,
            "char_count": char_count,
            "platform_index": idx,
            "platform_content": platform_content
        })

    return result


def convert_feishu_card_to_wework_text(
    company: str,
    card: Dict[str, Any]
) -> str:
    """
    将飞书卡片转换为企业微信text格式（纯文本）

    Args:
        company: 公司名称
        card: 飞书卡片字典

    Returns:
        企业微信text格式的字符串
    """
    header = card.get("header", {})
    title = header.get("title", {}).get("content", f"竞品监控 · {company}")
    elements = card.get("elements", [])

    text_lines = [title, ""]
    for element in elements:
        tag = element.get("tag", "")
        if tag == "hr":
            text_lines.append("-" * 20)
        elif tag == "div":
            text = element.get("text", {})
            if text:
                content = text.get("content", "")
                # 移除markdown格式，只保留文本
                content = re.sub(r'\*\*(.*?)\*\*', r'\1', content)  # 移除加粗
                content = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', content)  # 移除链接，保留文本
                if content:
                    text_lines.append(content)
            fields = element.get("fields", [])
            if fields:
                for field in fields:
                    field_text = field.get("text", {})
                    if field_text:
                        content = field_text.get("content", "")
                        content = re.sub(r'\*\*(.*?)\*\*', r'\1', content)
                        content = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', content)
                        if content:
                            text_lines.append(content)

    return "\n".join(text_lines)


def split_markdown_content(content: str, max_length: int = 4000) -> list[str]:
    """
    将过长的Markdown内容分割成多个片段
    尽量在段落边界（空行）处分割

    Args:
        content: Markdown内容
        max_length: 每个片段的最大长度（默认4000，留96字符的余量）

    Returns:
        内容片段列表
    """
    if len(content) <= max_length:
        return [content]

    lines = content.split('\n')
    chunks = []
    current_chunk = []
    current_length = 0

    for line in lines:
        line_length = len(line) + 1  # +1 for newline

        # 如果当前行本身超过最大长度，需要强制分割
        if len(line) > max_length:
            # 先保存当前chunk
            if current_chunk:
                chunks.append('\n'.join(current_chunk))
                current_chunk = []
                current_length = 0

            # 对超长行进行强制分割（尽量在句子边界）
            # 先尝试在句号、感叹号、问号处分割
            sentences = re.split(r'([。！？\.!?]\s*)', line)
            current_line = ""
            for part in sentences:
                if len(current_line) + len(part) > max_length - 50:
                    if current_line:
                        chunks.append(current_line.strip())
                    current_line = part
                else:
                    current_line += part
            if current_line.strip():
                chunks.append(current_line.strip())
            continue

        # 如果加上当前行会超过限制
        if current_length + line_length > max_length:
            # 如果是空行，直接开始新chunk
            if not line.strip():
                if current_chunk:
                    chunks.append('\n'.join(current_chunk))
                    current_chunk = []
                    current_length = 0
                continue

            # 尝试在最近的空行处分割（向前查找）
            split_index = -1
            for i in range(len(current_chunk) - 1, -1, -1):
                if not current_chunk[i].strip():
                    split_index = i
                    break

            if split_index >= 0:
                # 在空行处分割
                chunks.append('\n'.join(current_chunk[:split_index + 1]))
                current_chunk = current_chunk[split_index + 1:]
                current_length = sum(len(l) + 1 for l in current_chunk)
            else:
                # 没有找到空行，强制分割
                chunks.append('\n'.join(current_chunk))
                current_chunk = []
                current_length = 0

        current_chunk.append(line)
        current_length += line_length

    # 添加最后一个chunk
    if current_chunk:
        chunks.append('\n'.join(current_chunk))

    return chunks


def send_single_markdown_message(
    webhook: str,
    content: str,
    msg_label: str = "",
    max_length: int = 4000
) -> bool:
    """
    发送单个Markdown消息，如果超长则自动分片

    Args:
        webhook: 企业微信webhook地址
        content: Markdown内容
        msg_label: 消息标签（用于日志）
        max_length: 最大长度限制

    Returns:
        是否发送成功
    """
    if len(content) <= max_length:
        # 单个消息
        payload = {
            "msgtype": "markdown",
            "markdown": {
                "content": content
            }
        }

        for attempt in range(3):
            try:
                resp = requests.post(webhook, json=payload, timeout=20)
                resp_data = {}
                try:
                    resp_data = resp.json()
                except Exception:
                    resp_data = {}

                errcode = resp_data.get("errcode", -1)
                if resp.status_code == 200 and errcode == 0:
                    return True
                else:
                    errmsg = resp_data.get("errmsg", resp.text[:200])
                    if attempt == 2:
                        print(f"    ❌ {msg_label} 发送失败: {errmsg}")
            except Exception as exc:
                if attempt == 2:
                    print(f"    ❌ {msg_label} 发送异常: {exc}")

            if attempt < 2:
                time.sleep(1)

        return False
    else:
        # 需要分片
        chunks = split_markdown_content(content, max_length)
        all_success = True

        for chunk_idx, chunk in enumerate(chunks, 1):
            chunk_content = chunk if chunk_idx == 1 else f"**{msg_label}（续 {chunk_idx}/{len(chunks)}）**\n\n---\n\n{chunk}"
            payload = {
                "msgtype": "markdown",
                "markdown": {
                    "content": chunk_content
                }
            }

            chunk_success = False
            for attempt in range(3):
                try:
                    resp = requests.post(webhook, json=payload, timeout=20)
                    resp_data = {}
                    try:
                        resp_data = resp.json()
                    except Exception:
                        resp_data = {}

                    errcode = resp_data.get("errcode", -1)
                    if resp.status_code == 200 and errcode == 0:
                        chunk_success = True
                        break
                    else:
                        errmsg = resp_data.get("errmsg", resp.text[:200])
                        if attempt == 2:
                            print(f"    ❌ {msg_label} 第 {chunk_idx} 条消息发送失败: {errmsg}")
                except Exception as exc:
                    if attempt == 2:
                        print(f"    ❌ {msg_label} 第 {chunk_idx} 条消息发送异常: {exc}")

                if attempt < 2:
                    time.sleep(1)

            if not chunk_success:
                all_success = False

            if chunk_idx < len(chunks):
                time.sleep(1)

        return all_success


def send_report_to_wework(
    company: str,
    card: Dict[str, Any],
    msg_type: str = "markdown",
    webhook_type: str = "default"
) -> bool:
    """
    发送报告到企业微信

    Args:
        company: 公司名称
        card: 飞书卡片（会被转换为企业微信格式）
        msg_type: 消息类型（markdown/text）
        webhook_type: webhook类型（"default" 或 "real"）

    Returns:
        是否发送成功
    """
    webhook, default_msg_type = get_wework_webhook(webhook_type)

    if not webhook:
        print(f"  ❌ 未找到企业微信webhook配置")
        return False

    # 使用参数指定的消息类型，如果没有则使用配置的默认类型
    actual_msg_type = msg_type if msg_type else default_msg_type

    # 企业微信Markdown消息最大长度4096字符，我们使用4000作为安全值
    WEWORK_MARKDOWN_MAX_LENGTH = 4000
    WEWORK_TEXT_MAX_LENGTH = 2048  # Text消息限制更短

    # 转换为企业微信格式
    if actual_msg_type.lower() == "markdown":
        # markdown格式 - 按平台分割发送
        platform_messages = split_card_by_platforms(company, card)

        if not platform_messages:
            # 如果没有平台分析，发送完整内容
            markdown_content = convert_feishu_card_to_wework_markdown(company, card)
            return send_single_markdown_message(webhook, markdown_content, f"{company} 报告", WEWORK_MARKDOWN_MAX_LENGTH)

        print(f"  📊 {company} 共有 {len(platform_messages)} 个平台分析")
        print(f"  📝 字数统计：")
        for msg in platform_messages:
            print(f"     平台 {msg['platform_index']}: {msg['char_count']} 字符")
        print()

        all_success = True
        for msg in platform_messages:
            platform_idx = msg['platform_index']
            content = msg['content']
            char_count = msg['char_count']

            print(f"  📤 发送平台 {platform_idx} 的分析（{char_count} 字符）...")
            success = send_single_markdown_message(
                webhook,
                content,
                f"{company} 平台 {platform_idx}",
                WEWORK_MARKDOWN_MAX_LENGTH
            )

            if success:
                print(f"    ✓ 平台 {platform_idx} 分析已发送")
            else:
                print(f"    ❌ 平台 {platform_idx} 分析发送失败")
                all_success = False

            # 平台消息之间延迟
            time.sleep(1)

        if all_success:
            print(f"  ✓ {company} 所有平台分析已推送到企业微信（共 {len(platform_messages)} 条消息）")
        return all_success
    else:
        # text格式
        text_content = convert_feishu_card_to_wework_text(company, card)
        return send_single_markdown_message(webhook, text_content, f"{company} 报告", WEWORK_TEXT_MAX_LENGTH)


def main() -> int:
    """命令行入口"""
    parser = argparse.ArgumentParser(
        description="从已生成的报告文件发送到企业微信"
    )
    parser.add_argument(
        "--input",
        type=str,
        required=True,
        help="报告JSON文件路径（例如：output/competitor_period_reports_2026-01-12_to_2026-01-18.json）"
    )
    parser.add_argument(
        "--company",
        type=str,
        help="只发送指定公司的报告（如果不指定则发送所有公司）"
    )
    parser.add_argument(
        "--msg-type",
        type=str,
        choices=["markdown", "text"],
        help="消息类型：markdown（默认）或 text"
    )
    parser.add_argument(
        "--save-md",
        action="store_true",
        help="同时保存Markdown文件到本地"
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        help="Markdown文件输出目录（默认与输入文件同一目录）"
    )
    parser.add_argument(
        "--webhook-type",
        type=str,
        choices=["default", "real"],
        default="default",
        help="选择使用的webhook类型：default（使用WEWORK_WEBHOOK_URL）或real（使用REAL_WEBHOOK_URL），默认为default"
    )

    args = parser.parse_args()

    # 读取报告文件
    if not os.path.exists(args.input):
        print(f"❌ 报告文件不存在: {args.input}")
        return 1

    try:
        with open(args.input, "r", encoding="utf-8") as f:
            reports = json.load(f)
    except Exception as e:
        print(f"❌ 读取报告文件失败: {e}")
        return 1

    if not isinstance(reports, dict):
        print(f"❌ 报告文件格式错误：应为字典格式")
        return 1

    # 获取企业微信配置
    webhook_type_display = "WEWORK_WEBHOOK_URL" if args.webhook_type == "default" else "REAL_WEBHOOK_URL"
    webhook, default_msg_type = get_wework_webhook(args.webhook_type)
    if not webhook:
        print(f"❌ 未找到企业微信webhook配置（类型: {args.webhook_type}）")
        print(f"   请设置环境变量 {webhook_type_display} 或在 config/config.yaml 中配置")
        return 1

    print(f"📡 使用webhook类型: {args.webhook_type} ({webhook_type_display})")

    msg_type = args.msg_type or default_msg_type
    # 如果指定保存MD文件，强制使用markdown格式转换（即使发送的是text格式）
    convert_to_md = args.save_md or msg_type == "markdown"

    print(f"📤 开始发送报告到企业微信（消息类型: {msg_type}）")
    print(f"   报告文件: {args.input}")
    print(f"   企业数量: {len(reports)}")
    if args.company:
        print(f"   仅发送: {args.company}")
    if args.save_md:
        print(f"   💾 将同时保存Markdown文件")
    print()

    # 确定输出目录
    if args.save_md:
        if args.output_dir:
            output_dir = args.output_dir
        else:
            # 默认与输入文件同一目录
            output_dir = os.path.dirname(os.path.abspath(args.input))
            if not output_dir:
                output_dir = "."
        os.makedirs(output_dir, exist_ok=True)

    # 发送报告
    success_count = 0
    fail_count = 0

    for company, report_data in reports.items():
        # 如果指定了公司，只发送该公司的报告
        if args.company and company != args.company:
            continue

        # 获取飞书卡片
        card = report_data.get("card")
        if not card:
            print(f"  ⚠️ {company} 报告中没有找到card字段，跳过")
            fail_count += 1
            continue

        # 如果需要保存Markdown文件
        if args.save_md:
            markdown_content = convert_feishu_card_to_wework_markdown(company, card)
            # 生成文件名（从输入文件名提取日期范围）
            input_basename = os.path.basename(args.input)
            # 移除.json扩展名
            base_name = os.path.splitext(input_basename)[0]
            # 添加公司名称
            safe_company = company.replace("/", "_").replace("\\", "_").replace(":", "_")
            md_filename = f"{base_name}_{safe_company}.md"
            md_filepath = os.path.join(output_dir, md_filename)

            try:
                with open(md_filepath, "w", encoding="utf-8") as f:
                    f.write(markdown_content)
                print(f"  💾 {company} Markdown文件已保存: {md_filepath}")
            except Exception as e:
                print(f"  ⚠️ {company} 保存Markdown文件失败: {e}")

        print(f"  📤 发送 {company} 的报告...")
        if send_report_to_wework(company, card, msg_type, args.webhook_type):
            success_count += 1
        else:
            fail_count += 1

        # 避免发送过快
        time.sleep(1)

    print()
    print(f"✅ 发送完成：成功 {success_count} 个，失败 {fail_count} 个")

    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
