"""飞书消息文本格式化（纯文本，无 Markdown）。"""
from __future__ import annotations

import re


def strip_markdown_for_feishu(text: str) -> str:
    """把模型可能输出的 Markdown 转成飞书可读的纯文本。"""
    s = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"```[^\n]*\n(.*?)```", r"\1", s, flags=re.DOTALL)
    s = re.sub(r"`([^`\n]+)`", r"\1", s)
    s = re.sub(r"\*\*\*([^*]+)\*\*\*", r"\1", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"__([^_]+)__", r"\1", s)
    s = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"\1", s)
    s = re.sub(r"(?<!_)_([^_\n]+)_(?!_)", r"\1", s)
    s = re.sub(r"^#{1,6}\s+", "", s, flags=re.MULTILINE)
    s = re.sub(r"^\s*>\s?", "", s, flags=re.MULTILINE)
    s = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 \2", s)
    s = re.sub(r"^\|[-:\s|]+\|\s*$", "", s, flags=re.MULTILINE)
    s = re.sub(r"^\|\s*", "", s, flags=re.MULTILINE)
    s = re.sub(r"\s*\|\s*$", "", s, flags=re.MULTILINE)
    s = re.sub(r"\s*\|\s*", " · ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()
