# OpenRouter-first skill agent architecture design

Date: 2026-06-04

## Decision

Keep the production model path on OpenRouter with DeepSeek v4 Pro. The new architecture should improve modularity and skill-style domain routing without replacing the current provider stack.

Production configuration remains:

```env
AI_PROVIDER=openrouter
OPENAI_MODEL=deepseekv4pro
```

Claude Agent SDK is not the production runner for this change. It may remain a future experimental provider, but the implementation must not make Claude SDK required for web chat, normal Feishu chat, or casual Feishu chat.

## Goals

- Preserve the current working web and Feishu behavior.
- Keep OpenRouter multi-turn function calling as the primary agent loop.
- Refactor the current agent code into clearer runner, tool, skill, and adapter boundaries.
- Convert monitor-domain routing knowledge into project-owned skill files that can be loaded into prompts.
- Keep rollback simple: switching `AI_PROVIDER=openrouter` with the existing model must still work without a new external service.
- Add parity tests so the same representative prompts keep selecting the expected data sources and tools.

## Non-goals

- Do not migrate production to Claude Agent SDK in this phase.
- Do not remove `chat_via_openrouter`, `chat_via_codex`, or `chat_via_openai` until a later cleanup is explicitly approved.
- Do not change Feishu app event configuration or bot URLs.
- Do not expose database names, SQL, file paths, or secrets to end users beyond existing internal debug UI.
- Do not implement a full plugin marketplace or runtime skill package installer.

## Current state

The current central path is `run_monitor_assistant()` in `backend/assistant_service.py`.

Current entrypoints:

- Web chat uses `/api/ai/chat/stream` and `/api/ai/chat`, with `channel="web"`.
- Normal Feishu uses `/api/feishu/events`, then wraps the prompt for Feishu and calls the same assistant service with a Feishu channel.
- Casual Feishu uses `/api/feishu/casual-agent/events`, adds casual-game context, and sends chart payloads as Feishu images.

Current tools live behind `AgentToolDispatcher` in `backend/ai_tools.py`:

- `query_sqlite`
- `query_and_chart`
- `read_public_report`
- `web_search`
- `render_chart`

The implementation already works, but responsibilities are concentrated in `assistant_service.py`: intent routing, system prompt composition, provider dispatch, and message construction are all mixed together.

## Proposed architecture

Introduce four boundaries while keeping the public API stable.

### 1. Channel adapters

Channel adapters keep all web and Feishu platform behavior outside the core agent.

Adapters are responsible for:

- Authentication and permission checks.
- Rate limiting.
- Session key selection and history persistence.
- Channel-specific prompt envelope.
- Response delivery: SSE, JSON, Feishu text, Feishu image.
- Audit payload enrichment.

The existing web, normal Feishu, and casual Feishu routes should continue to call `run_monitor_assistant()` so the external interface stays stable.

### 2. Agent runner layer

Add an explicit runner interface:

```python
class AgentRunner(Protocol):
    async def run(self, request: AgentRequest) -> AssistantResult: ...
```

Initial runners:

- `OpenRouterAgentRunner`: primary production path, uses DeepSeek v4 Pro through OpenRouter and the current tool-calling loop.
- `OpenAIChatRunner`: simple chat fallback with no tool loop, matching current behavior.
- `CodexAgentRunner`: preserves the current Codex app-server path.

`run_monitor_assistant()` becomes an orchestrator:

1. Build an `AgentRequest`.
2. Resolve channel scope and skill context.
3. Select the configured runner.
4. Execute tools through the shared tool registry.
5. Return a normalized `AssistantResult`.

### 3. Tool registry

Extract the callable tool definitions from `AgentToolDispatcher` into a registry-style module.

The first implementation can wrap the existing dispatcher to reduce risk:

- `MonitorToolRegistry.list_openai_tools()`
- `MonitorToolRegistry.dispatch(name, args)`
- `MonitorToolRegistry.schema_text(selected_dbs)`
- `MonitorToolRegistry.list_db_names()`

This keeps OpenRouter function calling unchanged while making the same tool inventory reusable by future SDK or MCP experiments.

Tool safety remains unchanged:

- SQLite is read-only.
- SQL remains limited to safe `SELECT` / `WITH` style queries.
- Public report reading stays restricted to allowed report prefixes.
- Web search remains controlled by `CODEX_ENABLE_WEB_SEARCH_TOOL` and `TAVILY_API_KEY` / fallback behavior.

### 4. Project skills

Create project-owned skill files under `.claude/skills/` and load them into the prompt through a backend skill loader.

Recommended initial skill:

```text
monitor-web-game-trends
```

It should contain the stable business routing and answer behavior:

- 微信/抖音小游戏榜、Top20、玩法、新游戏 -> `wechatdouyin.db`
- SensorTower、Top100、App Store、Google Play、美国免费榜、商店页变化 -> `sensortower_top100.db`
- 竞品动态、社媒、Facebook、Instagram、TikTok、小红书、竞品 UA/素材/投放 -> `competitor_data.db`
- 我方产品、自家产品、US Free、appid -> `us_free_appid_weekly.db`
- 休闲游戏出海周报 -> `read_public_report`, not SQLite
- Trend and ranking-change questions should prefer `query_and_chart`
- Feishu responses must be plain text and avoid Markdown tables/code blocks

Because production stays on OpenRouter, skill loading is implemented by our prompt builder, not by Claude SDK's automatic Skill tool.

The loader should support:

- Selecting skills by channel and intent.
- Injecting only relevant skill text into the system prompt.
- Keeping existing `backend/knowledge/` content available.
- Tests that assert the important routing instructions appear in system prompts for relevant channels.

## Data flow

Web flow:

1. `AiChatWidget` sends message, history, and page context.
2. FastAPI validates auth and rate limit.
3. Adapter calls `run_monitor_assistant(channel="web")`.
4. Orchestrator loads relevant skill text and selected DB schema.
5. `OpenRouterAgentRunner` runs DeepSeek v4 Pro with OpenAI-compatible tools.
6. Tool calls go through `MonitorToolRegistry`.
7. Response returns answer, selected DBs, tool calls, and chart payloads.
8. Web SSE renders deltas, thinking states, charts, data source chips, and tool chips.

Normal Feishu flow:

1. Feishu event route verifies signature, mention, duplicate event, and whitelist.
2. Adapter loads session history and wraps the user prompt for Feishu.
3. Orchestrator runs the same OpenRouter runner.
4. Adapter strips or avoids unsupported formatting and replies text.

Casual Feishu flow:

1. Casual Feishu event route verifies the dedicated app config and whitelist.
2. Adapter adds `monitorType=休闲游戏监测` and `channel=feishu_casual_*`.
3. Orchestrator loads casual-game skill context and four-source routing guidance.
4. Runner can produce chart payloads.
5. Adapter sends text first, then renders chart payloads as PNG images and replies with images.

## Configuration

Add or document these environment variables:

```env
AI_PROVIDER=openrouter
OPENAI_MODEL=deepseekv4pro
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=...
AGENT_SKILLS_ENABLED=true
AGENT_SKILLS_DIR=.claude/skills
AGENT_SKILLS=monitor-web-game-trends
```

`AGENT_SKILLS_ENABLED=false` should fully disable project skill injection and fall back to the current knowledge-only prompt behavior.

`AGENT_SKILLS_DIR` is resolved relative to the repository root unless an absolute path is provided.

No Claude SDK key is required for production.

## Error handling

- If skill loading fails, log the error, continue without skill text, and include an audit flag.
- If OpenRouter returns a tool-calling error, preserve the existing user-facing failure behavior.
- If a tool fails, return a tool error result to the model rather than crashing the whole request where possible.
- If chart rendering fails in casual Feishu, keep the existing fallback: send text answer and a short chart failure note.
- If `AGENT_SKILLS` references a missing skill, startup health should report it but runtime should continue.

## Testing

Unit tests:

- Skill loader reads `SKILL.md` frontmatter and body.
- Skill selector chooses `monitor-web-game-trends` for casual game channels and relevant web page contexts.
- Prompt builder includes skill text when enabled and excludes it when disabled.
- Existing routing tests continue to pass for data source selection.

Tool tests:

- Tool registry returns OpenAI-compatible schemas equivalent to the current tool schema.
- Tool registry dispatches to read-only SQLite, public report, web search, and chart paths.

Integration tests:

- Keep existing OpenRouter LLM integration tests.
- Add a small parity fixture for the representative prompts:
  - 微信小游戏 Top20
  - SensorTower 商店页变化
  - 竞品社媒动态
  - 我方 US Free 排名
  - 最新出海周报
  - 趋势图表问题

Manual verification:

- Web chat returns answer, selected DB chips, tool chips, and chart block for a trend prompt.
- Normal Feishu returns plain text and honors reset/whitelist behavior.
- Casual Feishu returns text plus chart image for a trend prompt.

## Migration plan

Phase 1: Introduce skill loader and tool registry wrappers.

- No behavior change by default except optional skill prompt injection.
- Keep all existing tests passing.

Phase 2: Introduce runner interface and move OpenRouter logic behind `OpenRouterAgentRunner`.

- `run_monitor_assistant()` remains the public service function.
- Existing API routes do not change.

Phase 3: Enable `AGENT_SKILLS_ENABLED=true` in local/staging.

- Compare route selection and answer quality against current baseline.
- Keep an immediate rollback by setting `AGENT_SKILLS_ENABLED=false`.

Phase 4: Production rollout.

- Use OpenRouter and DeepSeek v4 Pro.
- Monitor assistant audit logs for tool-call count, selected DBs, chart count, and errors.

## Risks

- Skill prompt injection may make prompts longer and increase latency or cost.
- DeepSeek's tool-calling behavior may respond differently when skill text changes wording.
- Splitting dispatcher code may accidentally change tool schema names or arguments.
- Feishu formatting can regress if Markdown guidance is moved incorrectly.

Mitigations:

- Keep existing prompt text until tests cover the extracted skill behavior.
- Snapshot key tool schemas in tests.
- Gate skill injection behind `AGENT_SKILLS_ENABLED`.
- Keep current runners until parity is proven.

## Acceptance criteria

- `AI_PROVIDER=openrouter` and `OPENAI_MODEL=deepseekv4pro` remain the documented production path.
- Web, normal Feishu, and casual Feishu still call `run_monitor_assistant()`.
- Skill text is stored outside `assistant_service.py` and can be enabled or disabled by config.
- Existing routing tests pass.
- OpenRouter integration tests still validate representative tool use when credentials are present.
- Casual Feishu still sends chart images for chart payloads.
- Rollback requires only disabling skill injection or reverting the provider config to the existing OpenRouter path.
