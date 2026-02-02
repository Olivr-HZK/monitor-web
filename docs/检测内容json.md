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
