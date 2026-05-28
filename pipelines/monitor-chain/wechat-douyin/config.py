"""
配置文件
"""
import os
from pathlib import Path
from dotenv import load_dotenv

PIPELINE_ROOT = Path(__file__).resolve().parent
MONITOR_WEB_ROOT = PIPELINE_ROOT.parents[2]

load_dotenv(MONITOR_WEB_ROOT / ".env")
load_dotenv(PIPELINE_ROOT / ".env")

# OpenRouter API配置
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
# 推荐使用支持视频的多模态模型。
# 这里默认改为 OpenRouter 官方支持的 Qwen3 VL 8B 多模态模型。
# 如需切换模型，可在 .env 中设置 VIDEO_ANALYSIS_MODEL 覆盖，例如：
#   VIDEO_ANALYSIS_MODEL=qwen/qwen3-vl-32b-instruct
VIDEO_ANALYSIS_MODEL = os.getenv(
    "VIDEO_ANALYSIS_MODEL",
    "qwen/qwen3-vl-8b-instruct",  # Qwen3-VL-8B-Instruct（支持图像/视频）
)

# 飞书机器人配置
FEISHU_WEBHOOK_URL = os.getenv("FEISHU_WEBHOOK_URL", "")
FEISHU_APP_ID = os.getenv("FEISHU_APP_ID", "")
FEISHU_APP_SECRET = os.getenv("FEISHU_APP_SECRET", "")

# 企业微信机器人配置（群机器人 Webhook）
WECOM_WEBHOOK_URL = os.getenv("WECOM_WEBHOOK_URL", "")
WECOM_WEBHOOK_URL_REAL = os.getenv("WECOM_WEBHOOK_URL_REAL", "")

# 抖音搜索API配置
DOUYIN_API_BASE_URL = "https://api.tikhub.io"
DOUYIN_API_TOKEN = os.getenv("DOUYIN_API_TOKEN", "")
DOUYIN_SEARCH_ENDPOINT = "/api/v1/douyin/search/fetch_general_search_v3"

# YouTube API 配置（TikHub）
YOUTUBE_API_TOKEN = os.getenv("DOUYIN_API_TOKEN", "")  # 复用抖音 API Token（TikHub 统一使用）
YOUTUBE_API_BASE_URL = "https://api.tikhub.io"

# 抖音下载API配置（可选，如果使用专门的下载API）
DOUYIN_DOWNLOAD_ENDPOINT = os.getenv("DOUYIN_DOWNLOAD_ENDPOINT", "")  # 下载API端点，如 "/api/v1/douyin/video/download"
USE_DOWNLOAD_API = os.getenv("USE_DOWNLOAD_API", "false").lower() == "true"  # 是否使用专门的下载API

# 抖音最高画质API配置（付费API，0.005$一次）
DOUYIN_HIGH_QUALITY_ENDPOINT = "/api/v1/douyin/app/v3/fetch_video_high_quality_play_url"
USE_HIGH_QUALITY_API_FALLBACK = os.getenv("USE_HIGH_QUALITY_API_FALLBACK", "true").lower() == "true"  # 普通URL失败时是否使用付费API

# 文件路径配置
# 现在排行榜按“人气榜/畅销榜/畅玩榜”落到各自文件夹；
# 工作流默认使用“人气榜”里最新日期的CSV（也可通过环境变量覆盖为具体文件/目录）。
WECHAT_DOUYIN_DATA_DIR = Path(
    os.getenv("WECHAT_DOUYIN_DATA_DIR", MONITOR_WEB_ROOT / "data" / "artifacts" / "wechat-douyin")
).expanduser().resolve()
RANKINGS_CSV_PATH = os.getenv("RANKINGS_CSV_PATH", str(WECHAT_DOUYIN_DATA_DIR / "人气榜"))
VIDEOS_DIR = str(WECHAT_DOUYIN_DATA_DIR / "videos")
VIDEO_INFO_DIR = str(WECHAT_DOUYIN_DATA_DIR / "video_info")  # 保存视频URL和ID的目录

# 工作流配置
MAX_GAMES_TO_PROCESS = int(os.getenv("MAX_GAMES_TO_PROCESS", "5"))  # 每次处理的最大游戏数量

# API请求配置
API_REQUEST_DELAY = float(os.getenv("API_REQUEST_DELAY", "1.0"))  # 请求间隔（秒），避免频率过高
API_MAX_RETRIES = int(os.getenv("API_MAX_RETRIES", "3"))  # 最大重试次数（针对502等临时错误）
API_RETRY_DELAY = float(os.getenv("API_RETRY_DELAY", "2.0"))  # 重试延迟（秒）

# Google Sheets（游戏排行榜写入）
GOOGLE_SHEET_ID = os.getenv("GOOGLE_SHEET_ID", "")  # 目标表格 ID 或完整 URL
GOOGLE_SHEETS_CREDENTIALS = os.getenv("GOOGLE_SHEETS_CREDENTIALS", "")  # OAuth2 凭证 JSON 路径（单独配置，不复用 Drive）
GOOGLE_SHEETS_TOKEN = os.getenv("GOOGLE_SHEETS_TOKEN", "")  # 可选，token 保存路径；不填则用凭证同目录下的 token_sheets.json

# SensorTower API 配置（用于榜单异动分析）
SENSORTOWER_API_TOKEN = os.getenv("SENSORTOWER_API_TOKEN", "")  # SensorTower API Token

# RapidAPI 配置（用于 YouTube 搜索）
RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")  # RapidAPI Key for YouTube search
