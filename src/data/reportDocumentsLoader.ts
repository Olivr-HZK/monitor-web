/**
 * 从 public 目录加载 report_documents.json（统一 ReportDocument 格式的 AI 日报）
 * 每一条拆成：
 * - 1 条 AI 日报总览（type 为 ai热点监测）
 * - 若干条条目卡片（type 也为 ai热点监测）
 * @param getDataUrl 可选，后端鉴权时传入
 */

import type { MonitorItem, ReportDocument } from '../types';

interface ParsedAiEntry {
  title: string;
  body: string;
  score?: number;
  tags?: string[];
  summary?: string;
  link?: string;
}

interface ParsedAiContent {
  overview?: string;
  entries: ParsedAiEntry[];
}

/**
 * 从 ReportDocument.content 中抽取：
 * - 总览（## 总览 ...）
 * - 每一条具体条目（### 开头），用于在前端作为单独卡片展示
 *
 * 采用逐行扫描，避免复杂多行正则带来的问题。
 */
function parseAiReportContent(content: string): ParsedAiContent {
  const result: ParsedAiContent = { overview: undefined, entries: [] };
  if (!content) return result;

  const lines = content.replace(/\r\n/g, '\n').split('\n');

  // 1）抽取「总览」：从 "## 总览" 下一行开始，直到遇到下一个 "## " 或 "### "
  const overviewLines: string[] = [];
  let inOverview = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line.startsWith('## 总览')) {
      inOverview = true;
      continue;
    }
    if (inOverview) {
      if (line.startsWith('## ') || line.startsWith('### ')) break;
      overviewLines.push(raw);
    }
  }
  const overviewText = overviewLines.join('\n').trim();
  if (overviewText) {
    result.overview = overviewText;
  }

  // 2）按 "### " 划分每一条条目
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line.startsWith('### ')) continue;

    // 标题行：去掉前缀与编号
    let title = line.replace(/^###\s+/, '').trim();
    title = title.replace(/^\d+\.\s*/, '').trim();
    if (!title) title = '未命名条目';

    const bodyLines: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const nextRaw = lines[j];
      const next = nextRaw.trim();
      if (next.startsWith('### ') || next.startsWith('## ')) break;
      bodyLines.push(nextRaw);
      j++;
    }

    const body = bodyLines.join('\n').trim();
    const logicalLines = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // 提取得分（如果有）
    const scoreLine = logicalLines.find((l) => l.startsWith('**评分**'));
    let score: number | undefined;
    if (scoreLine) {
      const m = scoreLine.match(/\*\*评分\*\*：[ \t]*([\d.]+)/);
      score = m ? parseFloat(m[1]) : undefined;
    }

    // 提取标签（如果有）
    const tagsLine = logicalLines.find((l) => l.startsWith('**标签**'));
    let tags: string[] | undefined;
    if (tagsLine) {
      const m = tagsLine.replace(/^\*\*标签\*\*：[ \t]*/, '');
      tags = m
        .split(/[、,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
    }

    // 提取摘要（如果有）
    const summaryLine = logicalLines.find((l) => l.startsWith('**摘要**'));
    const summary = summaryLine
      ? summaryLine.replace(/^\*\*摘要\*\*：[ \t]*/, '').trim()
      : undefined;

    // 提取原文链接（如果有）
    const linkLine = logicalLines.find((l) => l.startsWith('**链接**'));
    let link: string | undefined;
    if (linkLine) {
      const urlMatch = linkLine.match(/https?:\/\/[^\s)]+/);
      if (urlMatch) {
        link = urlMatch[0].trim();
      }
    }

    result.entries.push({
      title,
      body,
      score,
      tags,
      summary,
      link,
    });

    // 跳过已经处理过的 body 段落
    i = j - 1;
  }

  return result;
}

export async function loadReportDocuments(
  getDataUrl?: (filename: string) => string
): Promise<MonitorItem[]> {
  try {
    // 静态模式下文件实际位于 public/ai热点/...
    const filenames = [
      'ai热点/report_documents.json',
      'ai热点/report_documents_20260122.json',
      'ai热点/report_documents_20260127.json',
    ];

    const fetchOne = async (filename: string) => {
      const url = getDataUrl ? getDataUrl(filename) : filename;
      const opts = url.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
      const response = await fetch(url, opts);
      if (!response.ok) {
        console.warn(`${filename} not found or failed to load`);
        return [] as ReportDocument[];
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        console.warn(`${filename}: expected array`);
        return [] as ReportDocument[];
      }
      return data as ReportDocument[];
    };

    const dataArrays = await Promise.all(filenames.map(fetchOne));
    const data = dataArrays.flat();

    if (data.length === 0) {
      return [];
    }

    const items: MonitorItem[] = [];

    data
      .filter(
        (doc: unknown): doc is ReportDocument =>
          doc != null &&
          typeof doc === 'object' &&
          'title' in doc &&
          typeof (doc as ReportDocument).content === 'string'
      )
      .forEach((doc: ReportDocument, index: number) => {
        const dateStr = doc.date ?? '';
        const dateParts = dateStr.split('-');
        const shortDate =
          dateParts.length >= 3 ? `${dateParts[1]}-${dateParts[2]}` : dateStr || '01-01';

        const baseId = `report-doc-${index}-${(doc.date ?? '').replace(/-/g, '')}`;
        const platform =
          doc.source === 'wechat'
            ? '微信公众号'
            : doc.source === 'xhs'
            ? '小红书'
            : 'AI日报';

        const { overview, entries } = parseAiReportContent(doc.content);

        // 1）日报总览：作为一条单独的 AI 日报内容
        if (overview) {
          // 提取前10条话题（按评分降序，评分相同按标题排序）
          const top10Entries = [...entries]
            .sort((a, b) => {
              const scoreA = a.score ?? 0;
              const scoreB = b.score ?? 0;
              if (scoreB !== scoreA) return scoreB - scoreA;
              return a.title.localeCompare(b.title);
            })
            .slice(0, 10);

          // 构建前十话题列表（Markdown 格式，话题名称作为链接）
          const top10List = top10Entries
            .map((entry, idx) => {
              const link = entry.link || '#';
              return `${idx + 1}. [${entry.title}](${link})`;
            })
            .join('\n');

          const overviewSummary =
            doc.summary ??
            (overview.length > 200 ? `${overview.slice(0, 200)}...` : overview || doc.title);

          const overviewDoc: ReportDocument = {
            ...doc,
            // 总览内容 + 本日前十话题列表
            content: `## 总览\n${overview}\n\n## 本日前十话题\n${top10List}\n`,
            // 确保概要不太长
            summary: overviewSummary,
          };

          items.push({
            id: `${baseId}-overview`,
            type: 'ai热点监测',
            title: overviewDoc.title,
            source: overviewDoc.source ?? 'AI日报',
            platform,
            date: shortDate,
            time: overviewDoc.time ?? '00:00',
            views: 0,
            engagement: 0,
            description: overviewDoc.summary ?? overviewDoc.title,
            tags: (overviewDoc.tags ?? []).concat(['总览']),
            language: '中文',
            score: overviewDoc.score,
            coverImage: overviewDoc.coverImage,
            reportContent: JSON.stringify(overviewDoc),
          });
        }

        // 2）每一条「条目」单独作为一个卡片
        entries.forEach((entry, entryIndex) => {
          const entrySummary =
            entry.summary ??
            (entry.body.length > 200 ? `${entry.body.slice(0, 200)}...` : entry.body);

          const entryDoc: ReportDocument = {
            title: entry.title,
            tags: entry.tags && entry.tags.length > 0 ? entry.tags : doc.tags ?? [],
            date: doc.date,
            time: doc.time,
            source: doc.source,
            summary: entrySummary,
            content: entry.body,
            score: entry.score,
          };

          items.push({
            id: `${baseId}-entry-${entryIndex}`,
            type: 'ai热点监测',
            title: entryDoc.title,
            source: entryDoc.source ?? 'AI日报',
            platform,
            date: shortDate,
            time: entryDoc.time ?? doc.time ?? '00:00',
            views: 0,
            engagement: 0,
            description: entryDoc.summary ?? entryDoc.title,
            tags: entryDoc.tags ?? [],
            language: '中文',
            score: entryDoc.score,
            coverImage: doc.coverImage,
            url: entry.link,
            reportContent: JSON.stringify(entryDoc),
          });
        });

        // 如果没有解析出总览和条目，兜底为一条完整日报
        if (!overview && entries.length === 0) {
          items.push({
            id: baseId,
            type: 'ai热点监测',
            title: doc.title,
            source: doc.source ?? 'AI日报',
            platform,
            date: shortDate,
            time: doc.time ?? '00:00',
            views: 0,
            engagement: 0,
            description: doc.summary ?? doc.title,
            tags: doc.tags ?? [],
            language: '中文',
            score: doc.score,
            coverImage: doc.coverImage,
            reportContent: JSON.stringify(doc),
          });
        }
      });

    return items;
  } catch (error) {
    console.error('Error loading report_documents.json:', error);
    return [];
  }
}
