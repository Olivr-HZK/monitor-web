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


PORT = _int(os.environ.get("PORT"), 3001)
JWT_SECRET = _str(os.environ.get("JWT_SECRET"), "monitor-web-secret-change-in-production")
LOGIN_USERNAME = _str(os.environ.get("LOGIN_USERNAME"), "admin")
LOGIN_PASSWORD_HASH = _str(os.environ.get("LOGIN_PASSWORD_HASH"))
CORS_ORIGIN = _str(os.environ.get("CORS_ORIGIN"), "*")

FEISHU_APP_ID = _str(os.environ.get("FEISHU_APP_ID") or os.environ.get("app_id"))
FEISHU_APP_SECRET = _str(os.environ.get("FEISHU_APP_SECRET") or os.environ.get("app_secret"))
FEISHU_MEDIA_PUBLIC = _bool(os.environ.get("FEISHU_MEDIA_PUBLIC"))
FEISHU_WEBHOOK_URL = _str(os.environ.get("FEISHU_WEBHOOK_URL"))
WECOM_WEBHOOK_URL = _str(os.environ.get("WECOM_WEBHOOK_URL_REAL") or os.environ.get("WECOM_WEBHOOK_URL"))

OPENAI_API_KEY = _str(os.environ.get("OPENAI_API_KEY"))
OPENAI_BASE_URL = (_str(os.environ.get("OPENAI_BASE_URL")) or "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = _str(os.environ.get("OPENAI_MODEL"), "gpt-4.1-mini")
# 生产且未显式关闭时，AI 对话需要登录
AI_CHAT_REQUIRE_AUTH = os.environ.get("NODE_ENV") == "production" and os.environ.get("AI_CHAT_REQUIRE_AUTH", "true").lower() not in ("0", "false")

PUBLIC_DIR = Path(os.environ.get("PUBLIC_DIR", _PROJECT_ROOT / "public")).resolve()
DATA_DIR = Path(os.environ.get("DATA_DIR", _PROJECT_ROOT / "data")).resolve()

ALLOWED_PREFIXES = ("ai产品/", "ai热点/", "休闲游戏检测/")
ALLOWED_ROOT_FILES = {
    "competitor_data.db",
    "sensortower_applist.db",
    "wechatdouyin.db",
    "videos.db",
    "周报谷歌表单.csv",
    "热点日报.md",
    "report_documents.json",
    "auth-config.json",
}
