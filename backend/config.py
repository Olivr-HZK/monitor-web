"""从环境变量读取配置。"""
from pathlib import Path
import os

_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _str(v: str | None, default: str = "") -> str:
    return (v or "").strip() or default


def _int(v: str | None, default: int = 0) -> int:
    try:
        return int(v) if v else default
    except ValueError:
        return default


def _bool(v: str | None) -> bool:
    return (v or "").strip().lower() in ("1", "true", "yes")


def _csv(v: str | None, default: list[str] | None = None) -> list[str]:
    raw = (v or "").strip()
    if not raw:
        return default[:] if default else []
    return [item.strip() for item in raw.split(",") if item.strip()]


PORT = _int(os.environ.get("PORT"), 3001)
JWT_SECRET = _str(os.environ.get("JWT_SECRET"), "monitor-web-secret-change-in-production")
LOGIN_USERNAME = _str(os.environ.get("LOGIN_USERNAME"), "admin")
LOGIN_PASSWORD_HASH = _str(os.environ.get("LOGIN_PASSWORD_HASH"))
CORS_ORIGIN = _str(os.environ.get("CORS_ORIGIN"), "*")
CORS_ORIGINS = _csv(os.environ.get("CORS_ORIGIN"), ["*"])

FEISHU_APP_ID = _str(os.environ.get("FEISHU_APP_ID") or os.environ.get("app_id"))
FEISHU_APP_SECRET = _str(os.environ.get("FEISHU_APP_SECRET") or os.environ.get("app_secret"))
FEISHU_MEDIA_PUBLIC = _bool(os.environ.get("FEISHU_MEDIA_PUBLIC"))
FEISHU_WEBHOOK_URL = _str(os.environ.get("FEISHU_WEBHOOK_URL"))
WECOM_WEBHOOK_URL = _str(os.environ.get("WECOM_WEBHOOK_URL_REAL") or os.environ.get("WECOM_WEBHOOK_URL"))

OPENAI_API_KEY = _str(os.environ.get("OPENAI_API_KEY"))
OPENAI_BASE_URL = (_str(os.environ.get("OPENAI_BASE_URL")) or "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = _str(os.environ.get("OPENAI_MODEL"), "gpt-4.1-mini")
# openai=仅对话 | codex=Codex app-server+工具 | openrouter=OpenRouter+多轮 function calling+工具
AI_PROVIDER = _str(os.environ.get("AI_PROVIDER"), "openai").lower()
# OpenRouter 可选：部分场景建议设置站点 Referer（见 https://openrouter.ai/docs）
OPENROUTER_HTTP_REFERER = _str(os.environ.get("OPENROUTER_HTTP_REFERER"))
CODEX_APP_SERVER_BIN = _str(os.environ.get("CODEX_APP_SERVER_BIN"), "codex")
CODEX_MODEL = _str(os.environ.get("CODEX_MODEL"), "gpt-5.1-codex")
CODEX_WORKDIR = _str(os.environ.get("CODEX_WORKDIR"))
CODEX_TURN_TIMEOUT_SEC = _int(os.environ.get("CODEX_TURN_TIMEOUT_SEC"), 180)
CODEX_ENABLE_DB_TOOL = _bool(os.environ.get("CODEX_ENABLE_DB_TOOL") or "1")
CODEX_ENABLE_WEB_SEARCH_TOOL = _bool(os.environ.get("CODEX_ENABLE_WEB_SEARCH_TOOL") or "1")
TAVILY_API_KEY = _str(os.environ.get("TAVILY_API_KEY"))
# 生产且未显式关闭时，AI 对话需要登录
AI_CHAT_REQUIRE_AUTH = os.environ.get("NODE_ENV") == "production" and os.environ.get("AI_CHAT_REQUIRE_AUTH", "true").lower() not in ("0", "false")

PUBLIC_DIR = Path(os.environ.get("PUBLIC_DIR", _PROJECT_ROOT / "public")).resolve()
DATA_DIR = Path(os.environ.get("DATA_DIR", _PROJECT_ROOT / "data")).resolve()

ALLOWED_PREFIXES = ("ai产品/", "ai热点/", "休闲游戏检测/", "热点/")
ALLOWED_ROOT_FILES = {
    "competitor_data.db",
    "sensortower_applist.db",
    "ai_products_ua.db",
    "wechatdouyin.db",
    "videos.db",
    "周报谷歌表单.csv",
    "热点日报.md",
    "report_documents.json",
    "auth-config.json",
}
