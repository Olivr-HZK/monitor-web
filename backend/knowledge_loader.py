"""加载 backend/knowledge 下 Markdown，供 AI 系统提示与 Codex 用户消息前缀使用。"""
from pathlib import Path

_KNOWLEDGE_DIR = Path(__file__).resolve().parent / "knowledge"


def load_agent_knowledge_text() -> str:
    if not _KNOWLEDGE_DIR.is_dir():
        return ""
    parts: list[str] = []
    for md in sorted(_KNOWLEDGE_DIR.glob("*.md")):
        try:
            text = md.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if text:
            parts.append(f"## {md.stem}\n\n{text}")
    return "\n\n".join(parts)
