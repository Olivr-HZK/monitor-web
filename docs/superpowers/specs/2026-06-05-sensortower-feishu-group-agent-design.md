# SensorTower Feishu Group Agent Design

## Goal

Build the first SensorTower-only end-to-end data Q&A chain for casual-game monitoring. A user can mention the Feishu group bot, ask for any data supported by the current local SensorTower databases, and receive a concise answer plus the right group-message visual output. The user should not need to log in to SensorTower or the monitor website for these questions.

This design covers requirements and architecture only. Implementation starts after review.

## Scope

The first version is limited to data already present in the local SensorTower databases:

- `sensortower_top100.db`
- `sensortower_applist.db`

Supported data surfaces include all current tables in those databases, including Top100 rankings, rank changes, app metadata, App Store / Google Play store-info changes, weekly metadata changes, removed games, weekly Top5 overview and comments, app-list weekly downloads and revenue, merged weekly sales, and stored AI summaries.

The bot must treat “latest”, “recent”, and “this week” as the latest period available in the database, not the calendar week on the day of the question. It must treat “last week”, “change”, and “week over week” as the latest available period compared with the previous available period when the underlying data supports that comparison.

## Non-Goals

- Do not create or send Excel files by default.
- Do not create Feishu spreadsheet files by default.
- Do not fetch live SensorTower data from the external SensorTower API in this first version.
- Do not expose SQL, database names, table names, file paths, credentials, or internal implementation details in Feishu replies.
- Do not expand beyond SensorTower data unless the user explicitly approves a later phase.

## Existing Project Context

The repo already has the main pieces needed for a first chain:

- The casual Feishu agent receives group messages and can reply in thread.
- The assistant service and OpenRouter agent can call backend data tools.
- `query_sqlite` and `query_and_chart` can run read-only SQL against whitelisted SQLite databases.
- Chart payloads can be rendered to PNG and sent back as Feishu image messages.

Missing pieces for this design are:

- SensorTower semantic query tools that wrap common SQL patterns behind business parameters.
- Feishu group-message table cards for tabular results.
- A routing layer that chooses text, table card, or PNG chart based on the result shape.
- A SensorTower-only safety policy and validation tests that cover all supported database surfaces.

## Architecture

Use a hybrid tool model: SensorTower semantic query tools first, read-only SQL fallback second.

Semantic query tools are not separate from SQL at the storage layer. They are named business operations whose internals generate fixed or parameterized SQL safely. For example:

```text
get_top_ranking(platform=ios, country=US, chart_type=free, period=latest, limit=20)
```

Internally this becomes a controlled query against the appropriate ranking table, with default period resolution, row limits, field normalization, and output-shape metadata.

Read-only SQL fallback exists for SensorTower questions that are supported by the current databases but not yet covered by a semantic tool. The fallback may generate temporary SQL, but it must be constrained to SensorTower database aliases, `SELECT` / `WITH` / safe schema inspection, row limits, timeout limits, and no internal details in the Feishu answer.

## Components

### Feishu Group Entry

The existing casual Feishu group agent remains the entrypoint. In a SensorTower-only context, it should:

- Accept mentioned group messages.
- Preserve thread-based conversation history.
- Pass user text and history into the assistant.
- Send one text explanation and zero or more visual follow-ups.

### SensorTower Capability Registry

Add a registry that describes the SensorTower databases and supported data surfaces in business language. The registry should be loaded by the assistant prompt and by tool validation.

Each surface should declare:

- Supported question types.
- Canonical date field, such as `rank_date` or `week_start`.
- Default period resolution.
- Recommended output shape: text, table card, PNG chart, or mixed.
- Maximum default row count.

### Semantic Query Tools

First-version tools should cover:

- Top rankings: latest or specific period TopN by platform, country, and chart type.
- Rank changes: rise, fall, new entry, dropped, and latest-vs-previous comparisons.
- Game lookup: one game or app id across rankings, metadata, and weekly sales.
- Store info and store changes: App Store / Google Play metadata and detected changes.
- Weekly metadata changes: changed title, subtitle, description, short description, screenshots, and related fields.
- Removed games: removed or inaccessible apps by platform, country, chart type, and period.
- Weekly Top5 overview and comments: stored summary and detail JSON.
- App-list weekly sales: downloads and revenue by app, platform, country, and week.
- App-list merged sales: cross-country weekly downloads and revenue when available.
- Stored AI summaries: `applist_ai_summary` by week, app, and platform.

Each tool returns structured rows plus metadata:

- Data cutoff period.
- Comparison period when relevant.
- Human-readable title.
- Preferred output shape.
- Columns allowed for Feishu display.
- Whether the result is complete or truncated.

### Read-Only SQL Fallback

The fallback is for legitimate SensorTower questions that are not yet covered by semantic tools, such as publisher distribution, cross-country counts, or custom grouping.

Rules:

- Only query SensorTower database aliases.
- Only allow read-only statements.
- Enforce a default limit and a hard maximum.
- Prefer aggregate summaries for broad questions.
- Hide SQL and raw schema details from users.
- Return the same structured result envelope as semantic tools so output rendering remains consistent.

### Output Router

The assistant should not decide output format by prose alone. Tool results should carry an output hint:

- `table_card`: tabular results such as TopN, rank changes, removed games, or store changes.
- `chart_png`: trends, time series, platform comparison, download or revenue curves.
- `text_only`: stored summaries or no-data explanations.
- `mixed`: short text plus table and/or chart.

Default behavior:

- Table-shaped results are sent as Feishu group-message table cards.
- Trend and comparison results are rendered as PNG images and sent as Feishu image messages.
- Every answer includes a concise text explanation before the visual output.

### Feishu Table Cards

Feishu table output should be a group-message card, not a spreadsheet file.

The table card renderer should:

- Use readable Chinese column labels.
- Keep default results compact, such as Top20 or Top50 depending on the question.
- Show the data cutoff period in the card title or footer.
- Mark truncated results clearly.
- Avoid markdown tables in plain text.

If the result is too large for a practical group card, the bot should ask the user to narrow platform, country, app, or date range rather than silently dumping a huge table.

### Trend PNG Rendering

Trend results should reuse the existing chart rendering path where possible. The first version should support:

- Ranking trend line charts.
- Downloads and revenue trend charts.
- Bar charts for grouped comparisons.
- Simple table-like PNG only when a Feishu card is not suitable.

PNG output must include clear titles, axis labels, and the data cutoff period.

## Data Flow

1. User mentions the Feishu group bot with a SensorTower question.
2. Feishu event processor verifies signature, permission, mention, and dedupe state.
3. Assistant receives the user question, history, and SensorTower-only context.
4. Assistant chooses a semantic SensorTower tool when possible.
5. If no semantic tool fits, assistant may use read-only SQL fallback within SensorTower constraints.
6. Tool returns structured rows, cutoff metadata, and output hint.
7. Assistant writes a concise business explanation.
8. Output router sends the explanation as text.
9. Output router sends a Feishu table card or PNG chart based on the output hint.
10. Audit log records the question, selected capability, cutoff period, row count, output shape, and errors without storing secrets.

## Error Handling

No data:

- Reply that the requested data is not available in the current SensorTower database.
- Suggest the smallest useful refinement, such as platform, country, app name, or date.

Ambiguous app name:

- Return likely matches as a compact table card.
- Ask the user to choose one if confidence is low.

Too much data:

- Truncate only within explicit limits.
- State that the result is truncated.
- Ask for a narrower filter when the table would be unreadable.

Chart rendering failure:

- Still send the text explanation.
- If the raw rows are table-shaped, send a table card fallback.
- Otherwise ask the user to narrow the trend request.

Feishu card send failure:

- Fall back to concise text summary and, where possible, PNG rendering.
- Log the Feishu error internally.

## Security And Governance

- Database access is read-only.
- The assistant must not reveal SQL, table names, database file names, internal paths, or secrets in group replies.
- All queries must target SensorTower database aliases only.
- Row count, timeout, and result-size limits are mandatory.
- Generated visuals must be derived from database results, not invented.
- Responses must distinguish missing local data from unsupported questions.

## Testing And Acceptance

Acceptance requires tests or scripted checks for each data surface:

- Latest Top100 ranking returns a Feishu table-card-shaped result.
- Rank changes return rise/fall/new/dropped examples with latest and previous periods.
- Store info and store changes return compact cards.
- Weekly metadata changes return changed fields with old/new summaries.
- Removed games return removed status and reason.
- Weekly Top5 overview and comments return text or compact card output.
- App-list weekly sales returns downloads and revenue trends as PNG chart payloads.
- Merged weekly sales returns aggregate trends.
- Stored AI summaries return text-only or mixed output.
- Custom fallback SQL can answer a supported aggregate question without exposing SQL.
- Unsupported non-SensorTower questions are rejected or routed out of scope.

Manual Feishu validation should include:

- A TopN table question.
- A rank-change table question.
- A game trend chart question.
- A store-change question.
- A too-broad question that triggers narrowing.
- A no-data question that explains the missing data cleanly.

## Open Decisions

These can be finalized during implementation planning:

- Exact Feishu card table component format and maximum row count per card.
- Whether broad table results should use pagination or a single truncated card.
- Whether the current casual-game persona should remain enabled for SensorTower analytical replies or become quieter for data-heavy answers.
