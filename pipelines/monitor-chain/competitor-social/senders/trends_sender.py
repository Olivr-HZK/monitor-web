# coding=utf-8
"""
轻量级 Sender：读取 AI 结果，格式化飞书文本并推送
"""

import json
import os
import sys
from datetime import datetime
from typing import Dict, List, Tuple

import requests
import yaml

import env_loader  # noqa: F401  # 从 .env 加载 FEISHU_* 等环境变量
import base64
import time


DEFAULT_INPUT_PATH = "/app/output/ai_result_with_images.json"
DEFAULT_MAX_BYTES = 29000


def load_ai_results(file_path: str) -> Dict:
    if not os.path.exists(file_path):
        print(f"❌ 未找到 AI 结果文件: {file_path}")
        return {}
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        print(f"❌ 读取或解析 AI 结果失败: {exc}")
        return {}


def extract_trends(ai_data: Dict) -> List[Tuple[str, Dict]]:
    """从 AI 结果中提取趋势项"""
    if not isinstance(ai_data, dict):
        return []

    # 数据格式可能以 google_trend_ai 包裹
    if "google_trend_ai" in ai_data and isinstance(ai_data["google_trend_ai"], dict):
        ai_data = ai_data["google_trend_ai"]

    trends: List[Tuple[str, Dict]] = []
    for title, payload in ai_data.items():
        if isinstance(payload, dict):
            trends.append((title, payload))

    return trends


def format_rank(ranks) -> str:
    if isinstance(ranks, list) and ranks:
        return str(ranks[0])
    if isinstance(ranks, (int, float)):
        return str(ranks)
    return ""


def format_score(score) -> str:
    """根据分数返回带颜色提示的显示（使用彩色圆点以兼容文本消息）"""
    try:
        val = float(score)
    except Exception:
        return ""

    if val > 9.0:
        icon = "🟡"  # golden
    elif val > 8:
        icon = "🟣"  # purple
    elif val > 6.5:
        icon = "⚫"   # black
    else:
        icon = "⚪"   # gray

    return f"{icon} {val:.2f}"


def get_feishu_tenant_token() -> str:
    app_id = os.environ.get("FEISHU_APP_ID")
    app_secret = os.environ.get("FEISHU_APP_SECRET")
    if not app_id or not app_secret:
        return ""
    try:
        resp = requests.post(
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": app_id, "app_secret": app_secret},
            timeout=10,
        )
        data = resp.json()
        if data.get("code") == 0:
            return data.get("tenant_access_token", "")
    except Exception as exc:
        print(f"⚠️ 获取 Feishu token 失败: {exc}")
    return ""


def upload_image_if_needed(payload: Dict, token: str) -> None:
    """如果存在 image_path/base64，尝试上传以获取 image_key"""
    if not token:
        return

    image_path = payload.get("image_path")
    image_b64 = payload.get("image_base64")
    image_bytes = None

    if image_path and os.path.exists(image_path):
        try:
            with open(image_path, "rb") as f:
                image_bytes = f.read()
        except Exception as exc:
            print(f"⚠️ 读取图片失败 {image_path}: {exc}")
    elif image_b64:
        try:
            image_bytes = base64.b64decode(image_b64)
        except Exception as exc:
            print(f"⚠️ 解码图片失败: {exc}")

    if not image_bytes:
        return

    files = {
        "image_type": (None, "message"),
        "image": ("image.jpg", image_bytes, "image/jpeg"),
    }
    headers = {"Authorization": f"Bearer {token}"}
    try:
        resp = requests.post(
            "https://open.feishu.cn/open-apis/im/v1/images",
            headers=headers,
            files=files,
            timeout=20,
        )
        data = resp.json()
        if data.get("code") == 0:
            payload["image_key"] = data.get("data", {}).get("image_key")
        else:
            print(f"⚠️ 图片上传失败: {data}")
    except Exception as exc:
        print(f"⚠️ 图片上传异常: {exc}")


def build_feishu_card(title: str, payload: Dict, idx: int) -> Dict:
    url = (
        payload.get("mobileUrl")
        or payload.get("mobile_url")
        or payload.get("url")
        or ""
    )
    rank_text = format_rank(payload.get("ranks"))
    analysis = payload.get("analysis", {}) if isinstance(payload, dict) else {}
    score_val = payload.get("usability_score")
    score_text = format_score(score_val)
    high_score_tag = ""
    try:
        if float(score_val) > 9.0:
            high_score_tag = " ❗"
    except Exception:
        pass

    summary = analysis.get("summary") or ""
    nature = analysis.get("nature") or ""
    ua_inspiration = analysis.get("ua_inspiration") or ""
    suitability = analysis.get("ai_suitability_check") or ""

    image_key = payload.get("image_key")  # 上传后会填充

    fields = []
    if score_text:
        fields.append({"is_short": True, "text": {"tag": "lark_md", "content": f"⭐ 评分\n{score_text}"}})
    if rank_text:
        fields.append({"is_short": True, "text": {"tag": "lark_md", "content": f"🔥 热度\n{rank_text}"}})

    body_lines = []
    if summary:
        body_lines.append(f"**摘要**：{summary}")
    if nature:
        body_lines.append(f"**性质**：{nature}")
    if ua_inspiration:
        body_lines.append(f"**UA灵感**：{ua_inspiration}")
    if suitability:
        body_lines.append(f"**生成适配**：{suitability}")

    elements = []
    if fields:
        elements.append({"tag": "div", "fields": fields})
    if body_lines:
        elements.append({"tag": "div", "text": {"tag": "lark_md", "content": "\n\n".join(body_lines)}})
    if image_key:
        elements.append({"tag": "img", "img_key": image_key, "alt": {"tag": "plain_text", "content": title}})
    if url:
        elements.append(
            {
                "tag": "action",
                "actions": [
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": "🔗 点击查看"},
                        "type": "primary",
                        "url": url,
                    }
                ],
            }
        )

    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "template": "turquoise",
            "title": {"tag": "plain_text", "content": f"{idx}. {title.strip()}{high_score_tag}"},
        },
        "elements": elements,
    }


def get_feishu_webhook() -> str:
    for env_key in ("FEISHU_WEBHOOK_URL", "FEISHU_URL", "FEISHU_WEBHOOK"):
        if os.environ.get(env_key):
            return os.environ[env_key]

    config_path = os.environ.get("CONFIG_PATH", "/app/config/config.yaml")
    if os.path.exists(config_path):
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


def send_feishu_cards(webhook: str, cards: List[Dict]) -> bool:
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
                    print(f"✅ 第 {idx} 条卡片推送成功")
                    sent = True
                    break
                else:
                    print(f"❌ 第 {idx} 条卡片推送失败: {resp.text}")
            except Exception as exc:
                print(f"❌ 第 {idx} 条卡片推送异常: {exc}")
            if attempt < 2 and not sent:
                time.sleep(2)

        success = success and sent
    return success


def main() -> int:
    input_path = os.environ.get("SENDER_INPUT_PATH", DEFAULT_INPUT_PATH)
    webhook = get_feishu_webhook()
    if not webhook:
        print("❌ 未找到飞书 webhook，请设置 FEISHU_WEBHOOK_URL 或配置 config.yaml")
        return 1

    ai_data = load_ai_results(input_path)
    trends = extract_trends(ai_data)

    if not trends:
        print("⚠️ AI 结果为空或格式不符，未发送推送")
        return 1

    tenant_token = get_feishu_tenant_token()

    # 按评分排序（降序），无评分排后
    def score_key(item):
        _, payload = item
        try:
            return float(payload.get("usability_score", -1))
        except Exception:
            return -1

    sorted_trends = sorted(trends, key=score_key, reverse=True)
    cards = []
    for idx, (title, payload) in enumerate(sorted_trends, 1):
        upload_image_if_needed(payload, tenant_token)
        cards.append(build_feishu_card(title, payload, idx))

    ok = send_feishu_cards(webhook, cards)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
