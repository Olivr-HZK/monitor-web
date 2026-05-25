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

# 登录 Cookie：前端与 API 不同站点（如 GitHub Pages → api.xxx）时须 COOKIE_SAMESITE=none + COOKIE_SECURE=true，否则跨站 fetch 不会带上 token，/api/data 全 401。
# Safari 对第三方 Cookie 更严格：默认 lax 时跨站 credentialed fetch 常不带 Cookie；若必须用「账号密码 + /api/data」，务必 none + 精确 CORS_ORIGIN（勿 *）。
_raw_cookie_samesite = _str(os.environ.get("COOKIE_SAMESITE"), "lax").lower()
if _raw_cookie_samesite not in ("lax", "strict", "none"):
    _raw_cookie_samesite = "lax"
COOKIE_SAMESITE: str = _raw_cookie_samesite
_cookie_secure_env = (os.environ.get("COOKIE_SECURE") or "").strip().lower()
if _cookie_secure_env in ("1", "true", "yes"):
    COOKIE_SECURE = True
elif _cookie_secure_env in ("0", "false", "no"):
    COOKIE_SECURE = False
else:
    COOKIE_SECURE = COOKIE_SAMESITE == "none"

FEISHU_APP_ID = _str(os.environ.get("FEISHU_APP_ID") or os.environ.get("app_id"))
FEISHU_APP_SECRET = _str(os.environ.get("FEISHU_APP_SECRET") or os.environ.get("app_secret"))
FEISHU_MEDIA_PUBLIC = _bool(os.environ.get("FEISHU_MEDIA_PUBLIC"))
FEISHU_WEBHOOK_URL = _str(os.environ.get("FEISHU_WEBHOOK_URL"))
FEISHU_BOT_ENABLED = _bool(os.environ.get("FEISHU_BOT_ENABLED"))
FEISHU_VERIFICATION_TOKEN = _str(os.environ.get("FEISHU_VERIFICATION_TOKEN"))
FEISHU_ENCRYPT_KEY = _str(os.environ.get("FEISHU_ENCRYPT_KEY"))
FEISHU_ALLOWED_OPEN_IDS = _csv(os.environ.get("FEISHU_ALLOWED_OPEN_IDS"))
FEISHU_ALLOWED_CHAT_IDS = _csv(os.environ.get("FEISHU_ALLOWED_CHAT_IDS"))
FEISHU_BOT_MENTION_NAMES = _csv(os.environ.get("FEISHU_BOT_MENTION_NAMES"), ["监测助手", "飞书监测助手", "飞书 CLI"])
FEISHU_ASSISTANT_SEND_THINKING = os.environ.get("FEISHU_ASSISTANT_SEND_THINKING", "true").strip().lower() not in ("0", "false", "no")
CASUAL_FEISHU_BOT_ENABLED = _bool(os.environ.get("CASUAL_FEISHU_BOT_ENABLED"))
CASUAL_FEISHU_APP_ID = _str(os.environ.get("CASUAL_FEISHU_APP_ID"))
CASUAL_FEISHU_APP_SECRET = _str(os.environ.get("CASUAL_FEISHU_APP_SECRET"))
CASUAL_FEISHU_VERIFICATION_TOKEN = _str(os.environ.get("CASUAL_FEISHU_VERIFICATION_TOKEN"))
CASUAL_FEISHU_ENCRYPT_KEY = _str(os.environ.get("CASUAL_FEISHU_ENCRYPT_KEY"))
CASUAL_FEISHU_ALLOWED_OPEN_IDS = _csv(os.environ.get("CASUAL_FEISHU_ALLOWED_OPEN_IDS"))
CASUAL_FEISHU_ALLOWED_CHAT_IDS = _csv(os.environ.get("CASUAL_FEISHU_ALLOWED_CHAT_IDS"))
CASUAL_FEISHU_BOT_MENTION_NAMES = _csv(
    os.environ.get("CASUAL_FEISHU_BOT_MENTION_NAMES"),
    ["休闲监测助手", "休闲游戏助手"],
)
CASUAL_FEISHU_BOT_OPEN_ID = _str(os.environ.get("CASUAL_FEISHU_BOT_OPEN_ID"))
CASUAL_FEISHU_ASSISTANT_SEND_THINKING = (
    os.environ.get("CASUAL_FEISHU_ASSISTANT_SEND_THINKING", "true").strip().lower()
    not in ("0", "false", "no")
)
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
ASSISTANT_MAX_HISTORY_TURNS = _int(os.environ.get("ASSISTANT_MAX_HISTORY_TURNS"), 10)
# 生产且未显式关闭时，AI 对话需要登录
AI_CHAT_REQUIRE_AUTH = os.environ.get("NODE_ENV") == "production" and os.environ.get("AI_CHAT_REQUIRE_AUTH", "true").lower() not in ("0", "false")

PUBLIC_DIR = Path(os.environ.get("PUBLIC_DIR", _PROJECT_ROOT / "public")).resolve()
DATA_DIR = Path(os.environ.get("DATA_DIR", _PROJECT_ROOT / "data")).resolve()
MONITOR_SOURCE_ROOT = Path(os.environ.get("MONITOR_SOURCE_ROOT", _PROJECT_ROOT.parent)).resolve()


def _path_env(name: str, default: Path) -> Path:
    return Path(os.environ.get(name, default)).expanduser().resolve()


DATA_SOURCE_DB_PATHS = {
    "sensortower_top100.db": _path_env(
        "MONITOR_DB_SENSORTOWER",
        MONITOR_SOURCE_ROOT / "sensortower-" / "data" / "sensortower_top100.db",
    ),
    "competitor_data.db": _path_env(
        "MONITOR_DB_COMPETITOR",
        MONITOR_SOURCE_ROOT / "Olivr-competitor-monitor" / "db" / "competitor_data.db",
    ),
    "wechatdouyin.db": _path_env(
        "MONITOR_DB_WECHATDOUYIN",
        MONITOR_SOURCE_ROOT / "wechat-mini-game-ranking-post" / "data" / "wechatdouyin.db",
    ),
    "us_free_appid_weekly.db": _path_env(
        "MONITOR_DB_US_FREE",
        MONITOR_SOURCE_ROOT / "sensortower-" / "data" / "us_free_appid_weekly.db",
    ),
}

# /api/data/*.db 从源库生成请求级 SQLite backup 快照，避免直接下载正在写入的 WAL 库。
DB_SNAPSHOT_DIR = Path(os.environ.get("DB_SNAPSHOT_DIR", DATA_DIR / "db_snapshots")).resolve()
DB_SNAPSHOT_TTL_SEC = _int(os.environ.get("DB_SNAPSHOT_TTL_SEC"), 600)

# GET /api/data：已登录用户可读取数据文件。
# - 根目录下的 canonical *.db 优先映射到 DATA_SOURCE_DB_PATHS，并按请求生成 SQLite backup 快照返回。
# - 其它相对路径仍从 PUBLIC_DIR 读取（子目录、JSON/CSV/MD/图片等）。
# 安全边界见 main.serve_data（禁止 ..、静态路径解析后必须在 PUBLIC_DIR 内）。
# 以下**仅 basename** 不通过 API 返回（避免把含敏感配置的静态门文件当附件拉取）。
DATA_SERVE_DENYLIST_BASENAMES = frozenset({"auth-config.json"})
