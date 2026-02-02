/**
 * 将任意 reportContent（JSON 或纯文本）及可选的 MonitorItem 转为统一日报文档格式 ReportDocument
 */

import type { MonitorItem, ReportContentJson, ReportDocument } from '../types';

/**
 * 从 reportContent 字符串 + 可选 MonitorItem 元数据，生成统一 ReportDocument
 */
export function toReportDocument(
  reportContent: string | undefined,
  item?: Pick<MonitorItem, 'title' | 'source' | 'date' | 'time' | 'tags' | 'description' | 'coverImage' | 'score'>
): ReportDocument {
  const fallback: ReportDocument = {
    title: item?.title ?? '未命名',
    tags: item?.tags,
    date: item?.date,
    time: item?.time,
    source: item?.source,
    summary: item?.description,
    content: reportContent ?? '暂无内容',
    score: item?.score,
    coverImage: item?.coverImage,
  };

  if (!reportContent?.trim()) {
    return fallback;
  }

  const raw = reportContent.trim();
  if (!raw.startsWith('{')) {
    return {
      ...fallback,
      content: raw,
    };
  }

  try {
    const data = JSON.parse(raw) as Partial<ReportDocument & ReportContentJson & Record<string, unknown>>;

    // 优先：统一格式（有 content 即视为 ReportDocument）
    if (typeof data.content === 'string') {
      return {
        title: data.title ?? item?.title ?? '未命名',
        tags: data.tags ?? item?.tags,
        date: data.date ?? item?.date,
        time: data.time ?? item?.time,
        source: data.source ?? item?.source,
        summary: data.summary ?? item?.description,
        content: data.content,
        score: data.score ?? item?.score,
        coverImage: data.coverImage ?? item?.coverImage,
        meta: data.meta,
      };
    }

    switch (data.kind) {
      case 'daily_hot': {
        const parts: string[] = [];
        if (data.type) parts.push(`**性质**：${data.type}\n`);
        if (data.score != null) parts.push(`**评分**：${data.score}\n`);
        if (data.heat != null) parts.push(`**热度**：${data.heat}\n`);
        if (data.summary) parts.push(`## 摘要\n\n${data.summary}\n\n`);
        if (data.uaInspiration) parts.push(`## UA灵感\n\n${data.uaInspiration}\n`);
        return {
          title: data.title ?? item?.title ?? '热点日报',
          tags: data.type ? [data.type, '热点'] : item?.tags,
          date: item?.date,
          time: item?.time,
          source: item?.source ?? '热点监测',
          summary: data.summary ?? item?.description,
          content: parts.join('\n') || data.summary || '暂无内容',
          score: data.score ?? item?.score,
          coverImage: data.coverImage ?? item?.coverImage,
          meta: { heat: data.heat, uaInspiration: data.uaInspiration },
        };
      }
      case 'daily_ai': {
        const parts: string[] = [];
        if (data.score != null) parts.push(`**得分**：${data.score}\n`);
        if (data.tags?.length) parts.push(`**标签**：${data.tags.join('、')}\n`);
        if (data.viewpoint) parts.push(`## 观点\n\n${data.viewpoint}\n\n`);
        if (data.summary) parts.push(`## 摘要\n\n${data.summary}\n`);
        return {
          title: data.title ?? item?.title ?? 'AI日报',
          tags: data.tags ?? item?.tags,
          date: item?.date,
          time: item?.time,
          source: item?.source ?? '小红书',
          summary: data.summary ?? item?.description,
          content: parts.join('\n') || data.summary || data.viewpoint || '暂无内容',
          score: data.score ?? item?.score,
          meta: { viewpoint: data.viewpoint },
        };
      }
      case 'daily_ai_overview': {
        const content = (data as { content?: string }).content ?? raw;
        return {
          title: item?.title ?? 'AI日报概览',
          tags: item?.tags,
          date: item?.date,
          time: item?.time,
          source: item?.source ?? '小红书',
          summary: content.slice(0, 200) + (content.length > 200 ? '...' : ''),
          content,
        };
      }
      case 'weekly_report':
      default:
        if (data.card || data.period) {
          const parts: string[] = [];
          if (data.period) {
            const p = data.period as { start_date?: string; end_date?: string; days?: number };
            parts.push(`**监控时间段**: ${p.start_date ?? ''} 至 ${p.end_date ?? ''} (共 ${p.days ?? 7} 天)\n\n`);
          }
          const card = (data as { card?: { header?: { title?: { content?: string } }; elements?: unknown[] } }).card;
          if (card?.header?.title?.content) parts.push(`# ${card.header.title.content}\n\n`);
          if (card?.elements?.length) {
            (card.elements as Array<{ tag?: string; text?: { content?: string }; fields?: Array<{ text?: { content?: string } }> }>).forEach((el) => {
              if (el.tag === 'hr') parts.push('\n---\n\n');
              else if (el.text?.content) parts.push(el.text.content + '\n\n');
              el.fields?.forEach((f) => { if (f.text?.content) parts.push(f.text.content + '\n\n'); });
            });
          }
          return {
            title: item?.title ?? (card?.header?.title?.content as string) ?? '周报',
            tags: item?.tags,
            date: item?.date,
            time: item?.time,
            source: (data as { company?: string }).company ?? item?.source ?? '周报',
            summary: item?.description,
            content: parts.join('') || '暂无内容',
            score: item?.score,
            meta: { period: data.period, card: data.card },
          };
        }
    }
  } catch {
    // 非 JSON 或解析失败
  }

  return {
    ...fallback,
    content: raw,
  };
}
