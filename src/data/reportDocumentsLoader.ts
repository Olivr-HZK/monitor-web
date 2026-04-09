/**
 * 从 public 目录加载 report_documents.json（统一 ReportDocument 格式的 AI 日报）
 * 每一条拆成：
 * - 1 条 AI 日报总览（type 为 ai热点监测）
 * - 若干条条目卡片（type 也为 ai热点监测）
 * @param getDataUrl 可选，后端鉴权时传入
 */

import type { MonitorItem, ReportDocument } from '../types';
import { fetchInitForDataUrl } from '../utils/api';

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

type AiHotspotMeta = {
  source?: string;
  date?: string;
  time?: string;
  url?: string;
  rank?: number;
  unique_key?: string;
  image_path?: string;
  image_base64?: string;
  image_type?: string;
};

type AiHotspotDoc = {
  title?: string;
  content?: string;
  tags?: string[];
  summary?: string;
  score?: number;
  coverImage?: string;
  meta?: AiHotspotMeta;
};

const mapAiPlatformLabel = (source?: string) => {
  if (!source) return 'AI日报';
  if (source === 'wechat') return '微信公众号';
  if (source === 'xhs' || source === 'xiaohongshu') return '小红书';
  return 'AI日报';
};

const normalizeDate = (dateStr?: string) => {
  if (!dateStr) return '';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return dateStr;
};

const toShortDate = (dateStr?: string) => {
  const normalized = normalizeDate(dateStr);
  if (normalized && normalized.length >= 10) {
    return `${normalized.slice(5, 7)}-${normalized.slice(8, 10)}`;
  }
  return normalized || '01-01';
};

const toTime = (time?: string, generatedAt?: string) => {
  if (time && time.trim()) return time.trim();
  if (generatedAt && generatedAt.includes('T') && generatedAt.length >= 16) {
    return generatedAt.slice(11, 16);
  }
  return '00:00';
};

const resolvePublicUrl = (path: string | undefined, baseUrl: string) => {
  if (!path) return undefined;
  const trimmed = path.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('data:') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return baseUrl ? `${baseUrl}${trimmed}` : trimmed;
  }
  return baseUrl ? `${baseUrl}/${trimmed}` : trimmed;
};

function buildAiDailyItemsFromFeishu(
  raw: unknown,
  baseUrl: string
): MonitorItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = raw as { generated_at?: string; feishu?: { documents?: AiHotspotDoc[] } };
  const documents = data.feishu?.documents ?? [];
  if (!Array.isArray(documents) || documents.length === 0) return [];

  const generatedAt = data.generated_at ?? '';
  const firstDoc = documents[0];
  const dateFull = normalizeDate(firstDoc?.meta?.date) || (generatedAt ? generatedAt.slice(0, 10) : '');
  const shortDate = toShortDate(dateFull);
  const baseTime = toTime(firstDoc?.meta?.time, generatedAt);
  const platform = mapAiPlatformLabel(firstDoc?.meta?.source);
  const sourceLabel = 'AI日报';
  const baseId = `ai-daily-${(dateFull || shortDate).replace(/-/g, '') || 'unknown'}`;

  const entries = documents.map((doc, index) => {
    const title = doc.title?.trim() || `AI日报条目 ${index + 1}`;
    const summary = doc.summary?.trim();
    const coverImage =
      (doc.meta?.image_base64 && doc.meta.image_base64.trim()
        ? `data:image/${doc.meta.image_type ?? 'jpg'};base64,${doc.meta.image_base64}`
        : doc.coverImage?.trim()) ||
      resolvePublicUrl(doc.meta?.image_path, baseUrl);
    return {
      title,
      summary,
      content: doc.content ?? '',
      score: doc.score,
      tags: doc.tags ?? [],
      link: doc.meta?.url,
      date: normalizeDate(doc.meta?.date) || dateFull,
      time: toTime(doc.meta?.time, generatedAt),
      coverImage,
      meta: doc.meta,
    };
  });

  const tagsPool = entries.flatMap((entry) => entry.tags || []);
  const topTags = Array.from(
    tagsPool.reduce((map, tag) => {
      map.set(tag, (map.get(tag) ?? 0) + 1);
      return map;
    }, new Map<string, number>()).entries()
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([tag]) => tag);
  const topicHint = topTags.length > 0 ? topTags.join('、') : 'AI 视频、大模型、多模态等方向';
  const overviewSummary = `本日共 ${entries.length} 条话题，涵盖 ${topicHint}。点击下方标题可跳转到对应报告详情。`;
  const topicList = entries
    .map((entry, idx) => {
      const entryId = `${baseId}-entry-${idx}`;
      return `${idx + 1}. [${entry.title}](#entry:${entryId})`;
    })
    .join('\n');

  const overviewDoc: ReportDocument = {
    title: `AI热点日报（${dateFull || shortDate}）`,
    tags: ['AI日报', '总览', platform],
    date: dateFull || shortDate,
    time: baseTime,
    source: sourceLabel,
    summary: overviewSummary,
    content: `## 摘要\n${overviewSummary}\n\n## 本日话题\n${topicList}\n`,
    coverImage: entries.find((entry) => !!entry.coverImage)?.coverImage,
    meta: {
      kind: 'daily_summary',
      titles: entries.map((entry) => entry.title),
    },
  };

  const items: MonitorItem[] = [
    {
      id: `${baseId}-overview`,
      type: 'ai热点监测',
      title: overviewDoc.title,
      source: overviewDoc.source ?? sourceLabel,
      platform,
      date: shortDate,
      time: overviewDoc.time ?? baseTime,
      views: 0,
      engagement: 0,
      description: overviewDoc.summary ?? overviewDoc.title,
      tags: (overviewDoc.tags ?? []).concat(['总览']),
      language: '中文',
      score: undefined,
      coverImage: overviewDoc.coverImage,
      reportContent: JSON.stringify(overviewDoc),
    },
  ];

  entries.forEach((entry, entryIndex) => {
    const entryDoc: ReportDocument = {
      title: entry.title,
      tags: entry.tags && entry.tags.length > 0 ? entry.tags : ['AI日报'],
      date: entry.date || dateFull || shortDate,
      time: entry.time || baseTime,
      source: sourceLabel,
      summary: entry.summary ?? entry.title,
      content: entry.content || entry.summary || entry.title,
      score: entry.score,
      coverImage: entry.coverImage,
      meta: entry.meta ? { ...entry.meta } : undefined,
    };

    items.push({
      id: `${baseId}-entry-${entryIndex}`,
      type: 'ai热点监测',
      title: entryDoc.title,
      source: entryDoc.source ?? sourceLabel,
      platform,
      date: shortDate,
      time: entryDoc.time ?? baseTime,
      views: 0,
      engagement: 0,
      description: entryDoc.summary ?? entryDoc.title,
      tags: entryDoc.tags ?? [],
      language: '中文',
      score: entryDoc.score,
      coverImage: entryDoc.coverImage,
      url: entry.link,
      reportContent: JSON.stringify(entryDoc),
    });
  });

  return items;
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

const formatDate = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const normalizeIndexEntry = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('ai热点/')) return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
  if (trimmed.endsWith('.json')) return `ai热点/${trimmed}`;
  return `ai热点/${trimmed}.json`;
};

export async function loadReportDocuments(
  getDataUrl?: (filename: string) => string
): Promise<MonitorItem[]> {
  try {
    const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as { env?: { BASE_URL?: string } }).env : undefined;
    const baseUrl =
      metaEnv?.BASE_URL
        ? String(metaEnv.BASE_URL).replace(/\/$/, '')
        : '';
    const items: MonitorItem[] = [];
    const seenIds = new Set<string>();

    const buildCandidateUrls = (filename: string) => {
      if (getDataUrl) {
        return [getDataUrl(filename)];
      }
      const baseUrlCandidate = baseUrl ? `${baseUrl}/${filename}` : filename;
      const absoluteCandidate = `/${filename}`;
      const rawCandidate = filename;
      const urls = [baseUrlCandidate, absoluteCandidate, rawCandidate];
      return Array.from(new Set(urls.flatMap((url) => [url, encodeURI(url)])));
    };

    const opts = (url: string) => fetchInitForDataUrl(url);

    // 1）尝试加载 ai热点/index.json 获取日期文件列表（可选）
    const indexFiles: string[] = [];
    const indexCandidates = ['ai热点/index.json'];
    for (const indexName of indexCandidates) {
      const urls = buildCandidateUrls(indexName);
      for (const indexUrl of urls) {
        try {
          const res = await fetch(indexUrl, opts(indexUrl));
          if (!res.ok) continue;
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) continue;
          const json = await res.json();
          if (Array.isArray(json)) {
            json.forEach((entry) => {
              if (typeof entry === 'string') {
                const normalized = normalizeIndexEntry(entry);
                if (normalized) indexFiles.push(normalized);
              }
            });
            break;
          }
        } catch {
          // ignore
        }
      }
      if (indexFiles.length > 0) break;
    }

    // 2）有 index 时只拉 index 里的文件；无 index 时只尝试最近 14 天，避免大量 404
    const dateFiles: string[] = [];
    const maxDays = indexFiles.length > 0 ? 0 : 14;
    const today = new Date();
    for (let i = 0; i < maxDays; i += 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      dateFiles.push(`ai热点/${formatDate(d)}.json`);
    }
    const allCandidates = Array.from(new Set([...indexFiles, ...dateFiles]));

    for (const filename of allCandidates) {
      const urls = buildCandidateUrls(filename);
      for (const url of urls) {
        try {
          const res = await fetch(url, opts(url));
          if (!res.ok) continue;
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) continue;
          const json = await res.json();
          const built = buildAiDailyItemsFromFeishu(json, baseUrl);
          built.forEach((item) => {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              items.push(item);
            }
          });
          break;
        } catch {
          // skip failed fetch
        }
      }
    }

    if (items.length > 0) {
      return items;
    }

    // 静态模式下文件实际位于 public/ai热点/...
    const filenames = [
      'ai热点/report_documents.json',
      'ai热点/report_documents_20260122.json',
      'ai热点/report_documents_20260127.json',
    ];

    const fetchOne = async (filename: string) => {
      const urls = buildCandidateUrls(filename);
      for (const url of urls) {
        try {
          const response = await fetch(url, fetchInitForDataUrl(url));
          if (!response.ok) {
            console.warn(`${filename} not found or failed to load (status ${response.status})`);
            continue;
          }
          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) {
            const text = await response.text();
            console.warn(`${filename}: invalid content-type`, contentType || 'unknown', text.slice(0, 120));
            continue;
          }
          const json = await response.json();
          if (!Array.isArray(json)) {
            console.warn(`${filename}: expected array, got`, typeof json);
            continue;
          }
          return json as ReportDocument[];
        } catch (e) {
          console.warn(`${filename}: fetch failed`, e);
        }
      }
      return [] as ReportDocument[];
    };

    const dataArrays = await Promise.all(filenames.map(fetchOne));
    const data = dataArrays.flat();

    // 解析老的 report_documents*.json（若有）
    try {
      if (data.length === 0) {
        return items;
      }

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

            // 构建前十话题列表：话题名称作为可点击链接，跳转到对应卡片详情（内部链接）
            const top10List = top10Entries
              .map((entry, idx) => {
                const entryIndex = entries.indexOf(entry);
                const entryId = `${baseId}-entry-${entryIndex}`;
                return `${idx + 1}. [${entry.title}](#entry:${entryId})`;
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
    } catch (e) {
      console.error('parse report_documents*.json failed, only using with_images items:', e);
    }

    return items;
  } catch (error) {
    console.error('Error loading report_documents.json:', error);
    return [];
  }
}
