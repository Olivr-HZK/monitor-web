# 各板块检测内容 - 统一 JSON 格式

## 统一日报文档格式（后续全部使用）

**约定**：后续全部使用统一格式；新进数据均为 **ReportDocument**，**差异性均体现在 `content` 中**。列表用标题、标签、时间、来源、摘要等字段；详情页只渲染 `content` 作为正文。

### ReportDocument 结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 是 | 标题 |
| content | string | 是 | 正文内容（Markdown 或纯文本）；**所有差异性都放在这里** |
| tags | string[] | 否 | 标签 |
| date | string | 否 | 日期，如 2026-01-28 或 01-28 |
| time | string | 否 | 时间，如 09:00 |
| source | string | 否 | 来源 |
| summary | string | 否 | 摘要（列表/卡片用） |
| score | number | 否 | 评分 |
| coverImage | string | 否 | 封面图 URL |
| meta | object | 否 | 扩展信息（可选） |

### 示例（一种格式描述所有日报）

```json
{
  "title": "热点日报：memory of a killer",
  "tags": ["影视", "热点", "UA灵感"],
  "date": "01-28",
  "time": "09:00",
  "source": "热点监测",
  "summary": "由Patrick Dempsey主演的Fox新剧《杀手记忆》首映...",
  "content": "**性质**：影视\n\n**评分**：8.5\n\n**热度**：17\n\n## 摘要\n\n由Patrick Dempsey主演...\n\n## UA灵感\n\n从'杀手与失忆'的双重矛盾切入...",
  "score": 8.5,
  "coverImage": "/img_xxx.jpg",
  "meta": { "heat": 17 }
}
```

- **列表/卡片**：用 `title`、`tags`、`date`、`time`、`source`、`summary`、`score`、`coverImage`。
- **详情页**：仅用 `content` 渲染正文；标题、标签、时间、来源等从文档同层字段取。

历史数据若为旧格式（带 `kind` 或飞书 card），会通过 `toReportDocument()`（见 `src/utils/reportDocument.ts`）转为 ReportDocument 再渲染。

---

## 旧格式（仅兼容历史数据，新数据勿用）

以下按 **kind** 区分的格式仅用于兼容已有数据；新进数据请一律使用上面的 ReportDocument，差异性写在 **content** 中。

### 通用约定

- `MonitorItem.reportContent` 存 **JSON 字符串** 或 **纯文本**。
- JSON 根对象可包含 **`kind`**，取值见下表。
- 可选根字段：`version: "1.0"` 表示 schema 版本。

### kind 与类型对照

| kind | 板块 | 说明 |
|------|------|------|
| `daily_hot` | 热点趋势检测 | 热点日报（评分、热度、摘要、UA灵感） |
| `daily_ai` | AI热点检测 | 小红书/Rednotes 单条（得分、观点、摘要） |
| `daily_ai_overview` | AI热点检测 | 日报概览（纯文本） |
| `weekly_report` | 竞品社媒监控 | 飞书周报（card + period） |
| `game_ranking` | 休闲游戏检测 | 周榜（榜单类型 + items） |

---

## 1. daily_hot（热点日报）

**板块**：热点趋势检测

```json
{
  "kind": "daily_hot",
  "title": "memory of a killer",
  "score": 8.5,
  "heat": 17,
  "summary": "由Patrick Dempsey主演的Fox新剧《杀手记忆》...",
  "type": "影视",
  "uaInspiration": "从'杀手与失忆'的双重矛盾切入...",
  "coverImage": "/img_xxx.jpg"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| kind | string | 是 | 固定 `"daily_hot"` |
| title | string | 否 | 标题 |
| score | number | 否 | 评分 |
| heat | number | 否 | 热度 |
| summary | string | 否 | 摘要 |
| type | string | 否 | 性质（影视/游戏等） |
| uaInspiration | string | 否 | UA灵感正文 |
| coverImage | string | 否 | 封面图 URL |

---

## 2. daily_ai（AI 日报单条）

**板块**：AI热点检测（小红书单条）

```json
{
  "kind": "daily_ai",
  "title": "蚂蚁灵波，第一次让我对世界模型的感受具象",
  "score": 8.7,
  "tags": ["世界模型", "具身智能", "技术叙事"],
  "viewpoint": "该条目排第一因其精准锚定...",
  "summary": "摘要内容..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| kind | string | 是 | 固定 `"daily_ai"` |
| title | string | 否 | 标题 |
| score | number | 否 | 得分 |
| tags | string[] | 否 | 标签 |
| viewpoint | string | 否 | 观点 |
| summary | string | 否 | 摘要 |

---

## 3. weekly_report（竞品周报）

**板块**：竞品社媒监控（飞书/数据库周报）

```json
{
  "kind": "weekly_report",
  "company": "某公司",
  "start_date": "2026-01-20",
  "end_date": "2026-01-26",
  "period": {
    "start_date": "2026-01-20",
    "end_date": "2026-01-26",
    "days": 7
  },
  "card": {
    "header": { "title": { "content": "周报标题" } },
    "elements": [
      { "tag": "div", "text": { "tag": "lark_md", "content": "**小节**\n内容..." } },
      { "tag": "hr" }
    ]
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| kind | string | 是 | 固定 `"weekly_report"` |
| company | string | 否 | 公司名 |
| start_date / end_date | string | 否 | 周期起止 |
| period | object | 否 | 同上 + days |
| card | object | 否 | 飞书卡片（header + elements） |

兼容现有 DB 中无 `kind` 的旧 JSON：详情页通过 `card` 或 `period` 存在与否识别为周报。

---

## 5. game_ranking（休闲游戏周榜）

**板块**：休闲游戏检测 - 新游戏周榜

```json
{
  "kind": "game_ranking",
  "type": "微信小游戏",
  "title": "微信小游戏周榜",
  "updateTime": "2026-01-27",
  "period": "周榜",
  "items": [
    {
      "id": "1",
      "rank": 1,
      "name": "游戏名",
      "developer": "开发商",
      "category": "休闲",
      "change": "↑2",
      "updateDate": "2026-01-27",
      "mechanism": "玩法机制简述",
      "microInnovations": "基线微调创新点"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| kind | string | 是 | 固定 `"game_ranking"` |
| type | string | 是 | 微信小游戏/抖音小游戏/安卓游戏/iOS游戏 |
| title | string | 是 | 榜单标题 |
| updateTime | string | 是 | 更新时间 |
| period | string | 是 | 周期（如「周榜」） |
| items | array | 是 | 榜单行，见 GameRankingItem |

---

### 使用方式

1. **新数据**：一律产出 **ReportDocument**（`title`、`tags`、`date`、`time`、`source`、`summary`、**`content`** 等），`JSON.stringify` 写入 `MonitorItem.reportContent`。差异性只放在 **content**（Markdown 或纯文本）。
2. **详情页**：优先解析为 ReportDocument（有 `content` 即视为统一格式），用文档字段做标题栏，仅用 **content** 渲染正文；旧数据通过 `toReportDocument()` 兼容。
3. **类型定义**：`src/types/index.ts` 中 `ReportDocument`。
