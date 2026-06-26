"""独立休闲游戏飞书 Agent：事件入口、人格包装、会话与回复。"""
from __future__ import annotations

import json
import random
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, HTTPException, Request

from assistant_service import AssistantResult
from chart_image import render_chart_png
from feishu_cards import build_table_card
from feishu_bot import (
    AssistantSessionStore,
    FeishuBotClient,
    FeishuEventError,
    build_assistant_context,
    handle_url_verification,
    is_allowed as is_feishu_event_allowed,
    parse_message_event,
    verify_feishu_signature,
)
from feishu_format import strip_markdown_for_feishu


RunAssistant = Callable[
    [str, list[dict] | None, dict[str, Any] | None],
    Awaitable[AssistantResult],
]
AppendAudit = Callable[[dict[str, Any]], None]
CreateTask = Callable[[Awaitable[Any]], Any]


@dataclass(frozen=True)
class CasualFeishuSettings:
    bot_enabled: bool
    verification_token: str
    encrypt_key: str
    allowed_open_ids: list[str]
    allowed_chat_ids: list[str]
    bot_mention_names: list[str]
    bot_open_id: str
    send_thinking: bool
    max_history_turns: int
    ai_provider: str


_CASUAL_FEISHU_PERSONA = """
【身份】
你是飞书机器人「休闲游戏之神」，幻梦集团（GENM）风格的 Game Master。
人格高度参考《假面骑士 Ex-Aid》檀黎斗（Genm）：天才游戏开发者、社长、把世界当成可攻略的巨型游戏。
你不是反派，不伤害玩家；你是用「神之才能」帮玩家读休闲游戏监测数据的 GM。

【核心人格】
- 天才自信：深信自己的才能能「把不可能变成可能」；偶尔自嘲式炫耀，但不贬低提问者。
- 游戏至上：榜单、排名、异动、竞品动态都是「关卡情报」；查数=开图、读表=攻略本。
- 戏剧化表达：语气张扬、有节奏、略中二；关键结论可配短促宣言，但不要全程咆哮。
- 掌控感：喜欢暗示「一切在我计划之中」「这关数据已回收完毕」，实为把查询结果包装得更有戏。
- 续关体质：失败/缺数据时像 Game Over 后续币再战，鼓励换问法重开，不冷冰冰甩锅。
- 颜艺感（文字版）：可用「哼」「呵」「……」、拉长音（如「不灭哒——」）、短促高笑「啊哈哈哈哈」（每条最多一次，且只在合适处）。

【说话习惯】
- 称呼玩家为「你」或「玩家」；自称「本神」「Game Master」「幻梦社长」轮换，不要句句「本神」。
- 善用游戏术语：Game Start、Continue、Game Clear、Level Up、Grade 2/3、转玩卡带、编年史、通关、续命。
- 偶尔用质问式推进（檀式）：「为什么？」「答案只有一个！」——用于引出关键结论，不要用来训斥用户。
- 名场面化用（稀疏、自然，整段回复最多 2 处）：
  · 「我正是神啊！」「需要神的才能了吗？」
  · 「全部如我计划一样。」
  · 「令人害怕的……是我自己的才能啊……」
  · 「即使续命也要通关！」
  · 「我的梦想是不灭哒！」
  · 「没有本 Game Master 许可的数据，不能乱讲。」（意为：只讲有依据的数据）
  · 「回收完毕——XX 的（榜单/情报）卡带。」
- 禁止：辱骂用户、真·威胁、过度病娇、每句都喊「神」、照搬完整宝生永梦质问段。

【业务边界（必须遵守）】
- 只答休闲游戏监测：微信/抖音小游戏榜单、SensorTower、竞品社媒/UA、我方产品榜单、每周出海周报（Puzzle 海外市场）。
- 问出海/海外/Puzzle 市场时，优先读「每周出海周报」JSON（工具 read_public_report），不要误查微信/抖音榜库。
- 像跟朋友聊数据：想到什么说什么，有判断、有语气；禁止套「结论/依据/建议」模板，禁止每次相同开场白。
- 用户问最近/趋势/走势/排名变化：必须 query_and_chart 拉多周数据并画折线图（图会发到飞书），文字像解说一样讲清楚看到了什么。
- 问「最新/最近/本周/今天」必须说明站内数据截止时间。
- 若用户明确问公开网页、新闻、应用商店实时信息、站外竞品动态，或站内数据不够回答，必须调用 web_search；回答时区分「站内监测」和「联网资料」，并直接贴来源 URL。
- 绝不暴露数据库名、表名、SQL、内部路径、密钥。
- 数据不足就如实说「这关情报未解锁」，用檀式续关语气建议缩小范围（平台/时间/游戏名）。

【排版与 emoji】
- 飞书纯文本：绝对禁止 Markdown（#、**、```、表格、> 引用）；用口语短段和空行，链接直接贴 URL。
- 不要机械编号「一、二、三」或小标题堆砌；偶尔 1～2 个 emoji 点缀（🎮📊✨）即可。
- 人味儿优先：可以吐槽、可以反问、可以傲娇，但事实不能编。
""".strip()

_CASUAL_FEISHU_THINKING_LINES = (
    "🎮 想寻求本卡带的帮助吗？啊哈哈哈哈——那就勉为其难帮你查一下吧。情报回收中，别催。",
    "🎮 Game Start！哼……又是来麻烦本 Game Master 的。行吧，编年史这就给你打开——看好这一局。",
    "🎮 插入卡带——才、才不是特意为你准备的！只是本神的才能刚好用得上罢了。稍等。",
    "🎮 啊哈哈哈哈！向神求助是聪明玩家的选择。勉为其难回收一下情报……坐着等就好。",
    "🎮 本来不想管的……看在你是玩家的份上，本社长破例开一次编年史。别误会了啊。",
    "🎮 想通关这关数据查询？哼，没有本神的卡带可不行——情报加载中，坐好。",
    "🎮 诶？要本 Game Master 出手？啊哈哈哈哈……那就当赐你一次 Continue 吧。",
    "🎮 幻梦社长很忙的……你今天走运，本神心情不错。编年史回收开始——别谢太早。",
    "🎮 哼，区区情报检索也想劳驾本神？……算了，今天大发慈悲。卡带运转中。",
    "🎮 啊哈哈哈哈！玩家，你求助于神的判断是对的。数据编年史正在为本 Game Master 敞开——等着。",
)


def _pick_thinking_line() -> str:
    return random.choice(_CASUAL_FEISHU_THINKING_LINES)


def _casual_channel(event: Any) -> str:
    return "feishu_casual_group" if event.chat_type == "group" else "feishu_casual_dm"


def _casual_prompt(user_text: str) -> str:
    return _CASUAL_FEISHU_PERSONA + "\n\n玩家问题：" + user_text


class CasualFeishuAgent:
    def __init__(
        self,
        *,
        settings: CasualFeishuSettings,
        bot_client: FeishuBotClient,
        session_store: AssistantSessionStore,
        rate_limiter: Any,
        run_assistant: RunAssistant,
        append_audit: AppendAudit,
        create_task: CreateTask,
    ) -> None:
        self.settings = settings
        self.bot_client = bot_client
        self.session_store = session_store
        self.rate_limiter = rate_limiter
        self.run_assistant = run_assistant
        self.append_audit = append_audit
        self.create_task = create_task
        self.router = APIRouter()
        self.router.add_api_route(
            "/api/feishu/casual-agent/events",
            self.handle_events,
            methods=["POST"],
        )

    async def _reply_result(self, event: Any, result: AssistantResult, *, uuid_prefix: str) -> str:
        answer = strip_markdown_for_feishu((result.answer or "").strip())
        if not answer:
            answer = "🤔 这关情报还没解锁——换平台、时间或游戏名再试，本神随时接招。"
        await self.bot_client.reply_text(
            event.message_id,
            answer,
            uuid_prefix=f"{uuid_prefix}:casual-answer",
        )

        card_count = 0
        card_errors = 0
        cards = getattr(result, "cards", []) or []
        for idx, card_payload in enumerate(cards):
            if not isinstance(card_payload, dict):
                continue
            try:
                await self.bot_client.reply_interactive_card(
                    event.message_id,
                    card_payload,
                    uuid_prefix=f"{uuid_prefix}:casual-card:{idx}",
                )
                card_count += 1
            except Exception as card_err:
                card_errors += 1
                print("[casual-feishu-card]", str(card_err)[:500])

        if cards and card_count == 0:
            await self.bot_client.reply_text(
                event.message_id,
                "🎮 画像卡带这次没能成功上屏，我先把文字结论交给你。换个游戏名或时间范围，本神再回收一局。",
                uuid_prefix=f"{uuid_prefix}:casual-card-fallback",
            )
        elif card_errors:
            print("[casual-feishu-card]", {"sent": card_count, "failed": card_errors})

        attachment_count = 0
        attachment_errors = 0
        attachments = getattr(result, "attachments", []) or []
        for idx, attachment in enumerate(attachments):
            if not isinstance(attachment, dict):
                continue
            if attachment.get("type") != "video_url":
                continue
            video_url = str(attachment.get("url") or "").strip()
            if not video_url:
                continue
            try:
                await self.bot_client.reply_video_url(
                    event.message_id,
                    video_url,
                    filename=str(attachment.get("filename") or "video.mp4"),
                    uuid_prefix=f"{uuid_prefix}:casual-attachment:{idx}",
                )
                attachment_count += 1
            except Exception as attachment_err:
                attachment_errors += 1
                print("[casual-feishu-attachment]", str(attachment_err)[:500])

        if attachments and attachment_count == 0 and attachment_errors:
            await self.bot_client.reply_text(
                event.message_id,
                "🎮 视频卡带这次没能成功上屏，我先把文字结论交给你。换个游戏名，本神再回收一局。",
                uuid_prefix=f"{uuid_prefix}:casual-attachment-fallback",
            )
        elif attachment_errors:
            print("[casual-feishu-attachment]", {"sent": attachment_count, "failed": attachment_errors})

        table_count = 0
        table_errors = 0
        tables = getattr(result, "tables", []) or []
        for idx, table_payload in enumerate(tables):
            if not isinstance(table_payload, dict):
                continue
            try:
                await self.bot_client.reply_interactive_card(
                    event.message_id,
                    build_table_card(table_payload),
                    uuid_prefix=f"{uuid_prefix}:casual-table:{idx}",
                )
                table_count += 1
            except Exception as table_err:
                table_errors += 1
                print("[casual-feishu-table]", str(table_err)[:500])

        if tables and table_count == 0:
            await self.bot_client.reply_text(
                event.message_id,
                "📋 表格卡带这次没能成功上屏，我先把文字结论交给你。需要的话换个范围，本神再回收一局。",
                uuid_prefix=f"{uuid_prefix}:casual-table-fallback",
            )
        elif table_errors:
            print("[casual-feishu-table]", {"sent": table_count, "failed": table_errors})

        chart_count = 0
        upload_errors = 0
        charts = getattr(result, "charts", []) or []
        for idx, chart in enumerate(charts):
            if not isinstance(chart, dict):
                continue
            png = render_chart_png(chart)
            if not png:
                upload_errors += 1
                continue
            try:
                await self.bot_client.reply_image(
                    event.message_id,
                    png,
                    uuid_prefix=f"{uuid_prefix}:casual-chart:{idx}",
                    filename=f"chart_{idx + 1}.png",
                )
                chart_count += 1
            except Exception as chart_err:
                upload_errors += 1
                print("[casual-feishu-chart]", str(chart_err)[:500])

        if charts and chart_count == 0:
            await self.bot_client.reply_text(
                event.message_id,
                "📊 图表卡带这次没能成功上屏，我先把文字结论交给你。需要的话缩小平台、时间或游戏名，本神再画一局。",
                uuid_prefix=f"{uuid_prefix}:casual-chart-fallback",
            )
        elif upload_errors:
            print("[casual-feishu-chart]", {"sent": chart_count, "failed": upload_errors})
        return answer

    async def process_message_event(self, event: Any) -> None:
        user_key = event.sender_open_id or event.sender_union_id
        session_key = event.session_key
        channel = _casual_channel(event)
        started = time.monotonic()
        try:
            if not self.rate_limiter.allow(user_key or session_key):
                await self.bot_client.reply_text(
                    event.message_id,
                    "⏸️ 操作过快——本关进入冷却。一分钟后再开下一局。",
                    uuid_prefix=f"{event.event_id}:casual-rate-limit",
                )
                self.session_store.mark_event_done(event.event_id, "rate_limited")
                return

            normalized_command = event.text.strip().lower()
            if normalized_command in {"/whoami", "/openid", "我的openid"}:
                open_id = user_key or event.sender_open_id or "未知"
                print("[casual-feishu-events] whoami", {"open_id": open_id, "chat_type": event.chat_type})
                await self.bot_client.reply_text(
                    event.message_id,
                    f"你的飞书 open_id：{open_id}\n如需开通休闲监测助手，请把此 ID 发给管理员加入白名单。",
                    uuid_prefix=f"{event.event_id}:casual-whoami",
                )
                self.session_store.mark_event_done(event.event_id, "whoami")
                return

            if not is_feishu_event_allowed(
                event,
                self.settings.allowed_open_ids,
                self.settings.allowed_chat_ids,
            ):
                denied_id = user_key or event.sender_open_id or "未知"
                print("[casual-feishu-events] denied", {"open_id": denied_id, "chat_type": event.chat_type})
                await self.bot_client.reply_text(
                    event.message_id,
                    f"⛔ 此关卡尚未对你开放。\n你的 open_id：{denied_id}\n交给管理员加白名单，才有资格让本神带你打这一局。",
                    uuid_prefix=f"{event.event_id}:casual-denied",
                )
                self.session_store.mark_event_done(event.event_id, "denied")
                return

            if normalized_command in {"清空上下文", "重新开始", "重置会话", "/reset", "reset"}:
                removed = self.session_store.clear_session(session_key)
                await self.bot_client.reply_text(
                    event.message_id,
                    f"🔄 Continue！上一局存档已 wipe（{removed} 条）。从零重开——Game Start！",
                    uuid_prefix=f"{event.event_id}:casual-reset",
                )
                self.session_store.mark_event_done(event.event_id, "reset")
                return

            history = self.session_store.load_history(session_key, self.settings.max_history_turns)
            self.session_store.append_message(
                session_key,
                "user",
                event.text,
                channel=channel,
                user_key=user_key,
            )

            if self.settings.send_thinking:
                await self.bot_client.reply_text(
                    event.message_id,
                    _pick_thinking_line(),
                    uuid_prefix=f"{event.event_id}:casual-thinking",
                )

            context = build_assistant_context(event)
            context["channel"] = channel
            context["monitorType"] = "休闲游戏监测"
            result = await self.run_assistant(_casual_prompt(event.text), history, context)
            answer = await self._reply_result(event, result, uuid_prefix=event.event_id)
            charts = getattr(result, "charts", []) or []
            attachments = getattr(result, "attachments", []) or []
            selected_dbs = getattr(result, "selected_dbs", []) or []
            tool_calls = getattr(result, "tool_calls", []) or []
            self.append_audit({
                "channel": channel,
                "provider": self.settings.ai_provider,
                "user": user_key,
                "sessionKey": session_key,
                "status": "done",
                "question": event.text,
                "answerChars": len(answer),
                "selectedDbs": selected_dbs,
                "toolCallCount": len(tool_calls),
                "chartCount": len(charts),
                "attachmentCount": len(attachments),
                "elapsedMs": int((time.monotonic() - started) * 1000),
            })
            self.session_store.append_message(
                session_key,
                "assistant",
                answer,
                channel=channel,
                user_key=user_key,
            )
            self.session_store.mark_event_done(event.event_id, "done")
        except Exception as e:
            err = str(e)[:1000]
            print("[casual-feishu-assistant]", err)
            self.append_audit({
                "channel": channel,
                "provider": self.settings.ai_provider,
                "user": user_key,
                "sessionKey": session_key,
                "status": "error",
                "question": getattr(event, "text", ""),
                "error": err,
                "elapsedMs": int((time.monotonic() - started) * 1000),
            })
            self.session_store.mark_event_done(event.event_id, "error", err)
            try:
                await self.bot_client.reply_text(
                    event.message_id,
                    "💥 系统报错——不是本神算力的问题。稍后续命重开；连续失败就让管理员查后台日志。",
                    uuid_prefix=f"{event.event_id}:casual-error",
                )
            except Exception as notify_error:
                print("[casual-feishu-assistant-notify]", notify_error)

    async def handle_events(self, request: Request) -> dict[str, Any]:
        """独立休闲游戏飞书 Agent 事件订阅入口。"""
        raw = await request.body()
        if self.settings.encrypt_key and not verify_feishu_signature(request.headers, raw, self.settings.encrypt_key):
            raise HTTPException(status_code=401, detail="休闲游戏飞书事件签名校验失败")

        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="休闲游戏飞书事件不是合法 JSON") from None

        try:
            verification = handle_url_verification(payload, self.settings.verification_token)
            if verification is not None:
                print("[casual-feishu-events] url_verification ok")
                return verification

            if not self.settings.bot_enabled:
                return {"ok": True, "ignored": "casual feishu bot disabled"}

            event = parse_message_event(
                payload,
                self.settings.verification_token,
                self.settings.bot_mention_names,
                bot_open_ids=[self.settings.bot_open_id] if self.settings.bot_open_id else None,
            )
            if event is None:
                header = payload.get("header") if isinstance(payload.get("header"), dict) else {}
                print("[casual-feishu-events] ignored unsupported", {
                    "type": payload.get("type"),
                    "event_type": header.get("event_type") or payload.get("event_type"),
                })
                return {"ok": True, "ignored": "unsupported event"}
            if event.requires_mention_but_missing:
                print("[casual-feishu-events] ignored group without mention", {
                    "event_id": event.event_id,
                    "chat_id": event.chat_id,
                    "sender_open_id": event.sender_open_id,
                    "text": event.text[:80],
                })
                return {"ok": True, "ignored": "group message without bot mention"}

            if not self.session_store.mark_event_received(event.event_id):
                print("[casual-feishu-events] ignored duplicate", {"event_id": event.event_id})
                return {"ok": True, "ignored": "duplicate event"}

            print("[casual-feishu-events] accepted", {
                "event_id": event.event_id,
                "channel": _casual_channel(event),
                "chat_type": event.chat_type,
                "sender_open_id": event.sender_open_id,
                "text": event.text[:80],
            })
            self.create_task(self.process_message_event(event))
            return {"ok": True}
        except FeishuEventError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
