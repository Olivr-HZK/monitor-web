/**
 * 日报数据加载器
 * 从 public 目录加载热点日报（JSON 优先，MD 兜底）和AI日报（小红书周报）
 */

import type { MonitorItem, ReportDocument } from '../types';

/** 可选：后端鉴权时传入，用于拼接受保护数据 URL */
type GetDataUrl = (filename: string) => string;

/**
 * 解析热点日报 MD 文件
 */
export async function loadHotTrendReport(getDataUrl?: GetDataUrl): Promise<MonitorItem[]> {
  // 同时加载按日期命名的 JSON 与旧版 JSON，合并后返回，失败再回退到 MD
  const formatDate = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const mdUrl = getDataUrl ? getDataUrl('热点/热点日报.md') : '热点/热点日报.md';
  const opts = (url: string) => (url.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {});
  const baseUrl = (() => {
    const env = (import.meta as { env?: { BASE_URL?: string } }).env;
    return env?.BASE_URL ? String(env.BASE_URL).replace(/\/$/, '') : '';
  })();

  const mergedItems: MonitorItem[] = [];
  const seenKeys = new Set<string>();

  const pushItems = (items: MonitorItem[]) => {
    items.forEach((item) => {
      const key = `${item.type}|${item.title}|${item.url ?? ''}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      mergedItems.push(item);
    });
  };

  const buildCandidateUrls = (filename: string) => {
    if (getDataUrl) {
      return [getDataUrl(filename)];
    }
    // 有 base 时先试「相对路径」和「根路径」，再试 base，避免 dev 下 public 在根路径而请求到 SPA 回退 HTML
    const rawCandidate = filename;
    const absoluteCandidate = `/${filename}`;
    const baseUrlCandidate = baseUrl ? `${baseUrl.replace(/\/$/, '')}/${filename}` : filename;
    const ordered = baseUrl
      ? [rawCandidate, absoluteCandidate, baseUrlCandidate]
      : [baseUrlCandidate, absoluteCandidate, rawCandidate];
    const urls = ordered.flatMap((url) => [url, encodeURI(url)]);
    return Array.from(new Set(urls));
  };

  const normalizeIndexEntry = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.includes('/')) return trimmed;
    if (trimmed.endsWith('.json')) return `热点/${trimmed}`;
    return `热点/${trimmed}.json`;
  };

  const indexFiles: string[] = [];
  const indexCandidates = ['热点/index.json'];
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
            if (typeof entry !== 'string') return;
            const normalized = normalizeIndexEntry(entry);
            if (normalized) indexFiles.push(normalized);
          });
          break;
        }
      } catch {
        // ignore index failures
      }
    }
    if (indexFiles.length > 0) break;
  }

  // 有 index 时不再按日期扫 120 天；无 index 时只尝试最近 14 天，避免大量 404
  const dateCandidates: string[] = [];
  const maxDays = indexFiles.length > 0 ? 0 : 14;
  const today = new Date();
  for (let i = 0; i < maxDays; i += 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dateCandidates.push(`热点/${formatDate(d)}.json`);
  }

  const jsonCandidates = Array.from(
    new Set([
      ...indexFiles,
      ...dateCandidates,
      '热点/final_json_from_csv.json',
      '热点/final_result.json',
      '热点/final_json.json',
    ])
  );

  for (const filename of jsonCandidates) {
    const urls = buildCandidateUrls(filename);
    let loaded = false;
    for (const jsonUrl of urls) {
      try {
        const response = await fetch(jsonUrl, opts(jsonUrl));
        if (!response.ok) {
          console.warn(`Failed to load ${jsonUrl} (status ${response.status}).`);
          continue;
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          // 常见为 404 时服务器返回 index.html（SPA 回退），不读 body、不刷屏
          if (contentType.includes('text/html')) {
            // 静默跳过，避免 "expected JSON, got text/html" 和 HTML 片段刷屏
            continue;
          }
          console.warn(`Failed to parse ${jsonUrl}: unexpected content-type ${contentType || 'unknown'}`);
          continue;
        }
        const data = await response.json();
        const items = parseHotTrendReportJson(data, { useFeishuProxy: !!getDataUrl });
        if (items.length > 0) {
          pushItems(items);
          loaded = true;
        }
      } catch (error) {
        console.warn(`Failed to load ${jsonUrl}, fallback to next.`, error);
      }
    }
    if (loaded) continue;
  }

  if (mergedItems.length > 0) {
    return mergedItems;
  }

  try {
    const response = await fetch(mdUrl, opts(mdUrl));
    if (!response.ok) {
      console.error('Failed to load 热点日报.md');
      return [];
    }
    const text = await response.text();
    return parseHotTrendReport(text);
  } catch (error) {
    console.error('Error loading hot trend report:', error);
    return [];
  }
}

/**
 * 解析小红书周报（AI日报）MD 文件
 */
export async function loadAIDailyReport(getDataUrl?: GetDataUrl): Promise<MonitorItem[]> {
  try {
    const url = getDataUrl ? getDataUrl('ai热点/小红书周报.md') : 'ai热点/小红书周报.md';
    const opts = url.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
    const response = await fetch(url, opts);
    if (!response.ok) {
      console.error('Failed to load ai热点/小红书周报.md');
      return [];
    }
    const text = await response.text();
    return parseAIDailyReport(text);
  } catch (error) {
    console.error('Error loading AI daily report:', error);
    return [];
  }
}

/**
 * 解析热点日报内容
 */
function parseHotTrendReport(text: string): MonitorItem[] {
  const items: MonitorItem[] = [];
  
  // 提取标题（第一行数字+标题）
  const titleMatch = text.match(/^\d+\.\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : '热点日报';
  
  // 提取评分
  const scoreMatch = text.match(/🟣\s*([\d.]+)/);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : undefined;
  
  // 提取热度
  const heatMatch = text.match(/🔥\s*热度\s*\n(\d+)/);
  const heat = heatMatch ? parseInt(heatMatch[1]) : 0;
  
  // 提取摘要
  const summaryMatch = text.match(/摘要[：:]\s*(.+?)(?=\n\n|性质[：:])/s);
  const summary = summaryMatch ? summaryMatch[1].trim() : '';
  
  // 提取性质（标签）
  const typeMatch = text.match(/性质[：:]\s*(.+?)(?=\n|$)/);
  const contentType = typeMatch ? typeMatch[1].trim() : '';
  
  // 提取 UA 灵感
  const uaMatch = text.match(/UA灵感[：:]\s*(.+?)(?=\n\n生成适配|$)/s);
  const uaInspiration = uaMatch ? uaMatch[1].trim() : '';
  
  const today = new Date();
  const dateStr = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const contentParts: string[] = [];
  if (contentType) contentParts.push(`**性质**：${contentType}\n`);
  if (score != null) contentParts.push(`**评分**：${score}\n`);
  if (heat != null) contentParts.push(`**热度**：${heat}\n`);
  if (summary) contentParts.push(`## 摘要\n\n${summary}\n\n`);
  if (uaInspiration) contentParts.push(`## UA灵感\n\n${uaInspiration}\n`);

  const doc: ReportDocument = {
    title,
    tags: contentType ? [contentType, '热点', 'UA灵感'] : ['热点', 'UA灵感'],
    date: dateStr,
    time: '09:00',
    source: '热点监测',
    summary,
    content: contentParts.join('\n') || summary || '暂无内容',
    score,
    coverImage: '/热点/img_v3_02ud_b81bf139-6ea7-4b85-9a02-757d54361c4g.jpg',
  };

  items.push({
    id: 'hot-trend-1',
    type: '热点趋势监测',
    title: doc.title,
    source: doc.source ?? '热点监测',
    platform: '全网',
    date: doc.date ?? dateStr,
    time: doc.time ?? '09:00',
    views: heat * 1000,
    engagement: heat * 100,
    description: doc.summary ?? summary,
    tags: doc.tags ?? [],
    language: '中文',
    trend: 'up',
    sentiment: 'positive',
    score: doc.score,
    coverImage: doc.coverImage,
    url: '#',
    reportContent: JSON.stringify(doc),
  });

  return items;
}

/**
 * 解析热点日报 JSON（public/热点/final_json.json）
 */
function parseHotTrendReportJson(
  raw: unknown,
  options?: { useFeishuProxy?: boolean }
): MonitorItem[] {
  const items: MonitorItem[] = [];
  if (!raw || typeof raw !== 'object') return items;

  const data = raw as {
    generated_at?: string;
    feishu?: {
      documents?: Array<{
        title?: string;
        content?: string;
        tags?: string[];
        summary?: string;
        score?: number;
        coverImage?: string;
        source?: string;
        meta?: {
          heat?: number;
          url?: string;
          image_base64?: string;
          image_type?: string;
          views?: number;
          likes?: number;
          source?: string;
          cover_url?: string;
        };
      }>;
    };
  };

  const generatedAt = data.generated_at;
  const dateFromGenerated = generatedAt ? new Date(generatedAt) : new Date();
  const dateStr = `${String(dateFromGenerated.getMonth() + 1).padStart(2, '0')}-${String(
    dateFromGenerated.getDate()
  ).padStart(2, '0')}`;
  const baseTime = `${String(dateFromGenerated.getHours()).padStart(2, '0')}:${String(
    dateFromGenerated.getMinutes()
  ).padStart(2, '0')}`;

  const documents = data.feishu?.documents ?? [];
  const titles = documents
    .map((doc) => doc.title?.trim())
    .filter((title): title is string => !!title);

  if (titles.length > 0) {
    const sources = documents.map((doc) => {
      const metaSource =
        typeof doc.meta === 'object' && doc.meta && 'source' in doc.meta && typeof doc.meta.source === 'string'
          ? doc.meta.source
          : '';
      return (doc.source ?? metaSource ?? '').trim() || 'Google Trends';
    });
    const grouped: Record<string, Array<{ title: string; entryId: string }>> = {};
    const sourceOrder: string[] = [];
    titles.forEach((title, index) => {
      const source = sources[index] || 'Google Trends';
      if (!grouped[source]) {
        grouped[source] = [];
        sourceOrder.push(source);
      }
      grouped[source].push({
        title,
        entryId: `hot-trend-json-${dateStr.replace(/-/g, '')}-${index}`,
      });
    });

    const summaryLines: string[] = [];
    sourceOrder.forEach((source, sourceIndex) => {
      if (sourceIndex > 0) summaryLines.push('');
      summaryLines.push(`### ${source}`);
      grouped[source].forEach((entry, idx) => {
        summaryLines.push(`${idx + 1}. [${entry.title}](#entry:${entry.entryId})`);
      });
    });

    const summaryTextRaw = `以下为昨天热点共 ${titles.length} 条，按来源分组展示，点击标题可查看对应卡片详情。`;
    const summaryText =
      summaryTextRaw.length > 240 ? `${summaryTextRaw.slice(0, 240)}...` : summaryTextRaw;

    const summaryDoc: ReportDocument = {
      title: `热点日报每日汇总 ${dateStr}`,
      tags: ['每日汇总', '热点'],
      date: dateStr,
      time: baseTime,
      source: '热点监测',
      summary: summaryText,
      content: `## 摘要\n${summaryText}\n\n## 本日热点\n${summaryLines.join('\n')}\n`,
      meta: {
        kind: 'daily_summary',
        titles,
      },
    };

    items.push({
      id: `hot-trend-summary-${dateStr.replace(/-/g, '')}`,
      type: '热点趋势监测',
      title: summaryDoc.title,
      source: summaryDoc.source ?? '热点监测',
      platform: '全网',
      date: summaryDoc.date ?? dateStr,
      time: summaryDoc.time ?? baseTime,
      views: 0,
      engagement: 0,
      description: summaryDoc.summary ?? summaryText,
      tags: summaryDoc.tags ?? [],
      language: '中文',
      trend: 'up',
      sentiment: 'positive',
      score: summaryDoc.score,
      coverImage: summaryDoc.coverImage,
      url: '#',
      reportContent: JSON.stringify(summaryDoc),
    });
  }

  documents.forEach((doc, index) => {
    const title = doc.title?.trim() || `热点日报条目 ${index + 1}`;
    const summary = doc.summary?.trim() || '';
    const views = typeof doc.meta?.views === 'number' ? doc.meta.views : undefined;
    const likes = typeof doc.meta?.likes === 'number' ? doc.meta.likes : undefined;
    const heat = doc.meta?.heat ?? 0;
    const coverImage =
      doc.coverImage ||
      (doc.meta?.cover_url
        ? (options?.useFeishuProxy ? `/api/feishu-media?url=${encodeURIComponent(doc.meta.cover_url)}` : doc.meta.cover_url)
        : undefined) ||
      (doc.meta?.image_base64
        ? `data:image/${doc.meta.image_type ?? 'jpg'};base64,${doc.meta.image_base64}`
        : undefined);

    const reportDoc: ReportDocument = {
      title,
      tags: doc.tags && doc.tags.length > 0 ? doc.tags : ['热点'],
      date: dateStr,
      time: baseTime,
      source: doc.source ?? (typeof doc.meta === 'object' && doc.meta && 'source' in doc.meta ? (doc.meta.source as string) : undefined) ?? '热点监测',
      summary: summary || title,
      content: doc.content || summary || title,
      score: doc.score,
      coverImage,
    };

    items.push({
      id: `hot-trend-json-${dateStr.replace(/-/g, '')}-${index}`,
      type: '热点趋势监测',
      title: reportDoc.title,
      source: reportDoc.source ?? '热点监测',
      platform: '全网',
      date: reportDoc.date ?? dateStr,
      time: reportDoc.time ?? baseTime,
      views: views ?? heat * 1000,
      engagement: likes ?? heat * 100,
      description: (reportDoc.summary ?? summary) || title,
      tags: reportDoc.tags ?? [],
      language: '中文',
      trend: 'up',
      sentiment: 'positive',
      score: reportDoc.score,
      coverImage: reportDoc.coverImage,
      url: doc.meta?.url ?? '#',
      reportContent: JSON.stringify({
        ...reportDoc,
        meta: doc.meta,
      }),
    });
  });

  return items;
}

/**
 * 解析小红书周报（AI日报）内容
 */
function parseAIDailyReport(text: string): MonitorItem[] {
  const items: MonitorItem[] = [];
  
  // 提取日期（标题行）
  const dateMatch = text.match(/日报\s*(\d{4}-\d{2}-\d{2})/);
  const reportDate = dateMatch ? dateMatch[1] : '';
  const dateParts = reportDate.split('-');
  const dateStr = dateParts.length >= 3 ? `${dateParts[1]}-${dateParts[2]}` : '01-30';
  
  // 提取概览
  const overviewMatch = text.match(/📌【概览】\s*\n(.+?)(?=🔷)/s);
  const overview = overviewMatch ? overviewMatch[1].trim() : '';
  
  // 添加概览作为第一条
  if (overview) {
    const doc: ReportDocument = {
      title: `Rednotes AI日报概览 ${reportDate}`,
      tags: ['AI日报', '概览', '小红书'],
      date: dateStr,
      time: '08:00',
      source: '小红书',
      summary: overview.substring(0, 300) + (overview.length > 300 ? '...' : ''),
      content: overview,
    };
    items.push({
      id: 'ai-daily-overview',
      type: 'ai热点监测',
      title: doc.title,
      source: doc.source ?? '小红书',
      platform: 'Rednotes',
      date: doc.date ?? dateStr,
      time: doc.time ?? '08:00',
      views: 5000,
      engagement: 300,
      description: doc.summary ?? '',
      tags: doc.tags ?? [],
      language: '中文',
      trend: 'up',
      sentiment: 'positive',
      url: '#',
      reportContent: JSON.stringify(doc),
    });
  }
  
  // 用正则分割每个条目（以🔷开头）
  const entryPattern = /🔷【(.+?)】\s*\n([\s\S]*?)(?=🔷|$)/g;
  let match;
  let index = 0;
  
  while ((match = entryPattern.exec(text)) !== null) {
    const entryTitle = match[1].trim();
    const entryContent = match[2].trim();
    
    // 提取得分
    const scoreMatch = entryContent.match(/⭐\s*得分[：:]\s*([\d.]+)/);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : undefined;
    
    // 提取标签
    const tagsMatch = entryContent.match(/🏷️\s*标签[：:]\s*(.+?)(?=\n|$)/);
    const tagsStr = tagsMatch ? tagsMatch[1].trim() : '';
    const tags = tagsStr ? tagsStr.split(/[、,，]/).map(t => t.trim()).filter(Boolean) : [];
    
    // 提取观点
    const viewpointMatch = entryContent.match(/🧠\s*观点[：:]\s*(.+?)(?=📝|$)/s);
    const viewpoint = viewpointMatch ? viewpointMatch[1].trim() : '';
    
    // 提取摘要
    const summaryMatch = entryContent.match(/📝\s*摘要[：:]\s*(.+?)(?=$)/s);
    const summary = summaryMatch ? summaryMatch[1].trim() : viewpoint;
    
    // 提取链接
    const linkMatch = entryContent.match(/🔗\s*原文链接[：:]\s*(.+?)(?=\n|$)/);
    const link = linkMatch ? linkMatch[1].trim() : '#';
    
    const contentParts: string[] = [];
    if (score != null) contentParts.push(`**得分**：${score}\n`);
    if (tags.length) contentParts.push(`**标签**：${tags.join('、')}\n`);
    if (viewpoint) contentParts.push(`## 观点\n\n${viewpoint}\n\n`);
    if (summary) contentParts.push(`## 摘要\n\n${summary}\n`);

    const doc: ReportDocument = {
      title: entryTitle,
      tags: tags.length > 0 ? tags.slice(0, 5) : ['AI', '小红书'],
      date: dateStr,
      time: `${String(9 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`,
      source: '小红书',
      summary: summary.substring(0, 250) + (summary.length > 250 ? '...' : ''),
      content: contentParts.join('\n') || summary || viewpoint || '暂无内容',
      score,
    };

    items.push({
      id: `ai-daily-${index}`,
      type: 'ai热点监测',
      title: doc.title,
      source: doc.source ?? '小红书',
      platform: 'Rednotes',
      date: doc.date ?? dateStr,
      time: doc.time ?? '09:00',
      views: Math.floor(3000 + Math.random() * 5000),
      engagement: Math.floor(200 + Math.random() * 500),
      description: doc.summary ?? '',
      tags: doc.tags ?? [],
      language: '中文',
      trend: 'up',
      sentiment: 'positive',
      score: doc.score,
      url: link === '点击打开' ? '#' : (link ?? '#'),
      reportContent: JSON.stringify(doc),
    });
    
    index++;
  }
  
  return items;
}

/**
 * 解析 UA 素材日报 MD 文件
 */
export async function loadUADailyReport(getDataUrl?: GetDataUrl): Promise<MonitorItem[]> {
  try {
    const url = getDataUrl ? getDataUrl('休闲游戏检测/ua_report_daily.md') : '休闲游戏检测/ua_report_daily.md';
    const opts = url.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
    const response = await fetch(url, opts);
    if (!response.ok) {
      console.warn('Failed to load 休闲游戏检测/ua_report_daily.md');
      return [];
    }
    const text = await response.text();
    return parseUADailyReport(text);
  } catch (error) {
    console.error('Error loading UA daily report:', error);
    return [];
  }
}

/**
 * 解析 UA 素材日报内容
 */
function parseUADailyReport(text: string): MonitorItem[] {
  const items: MonitorItem[] = [];
  
  // 提取日期（格式：**日期**: 2026-02-03）
  const dateMatch = text.match(/\*\*日期\*\*[：:]\s*(\d{4}-\d{2}-\d{2})/);
  const reportDate = dateMatch ? dateMatch[1] : '';
  const dateParts = reportDate.split('-');
  const dateStr = dateParts.length >= 3 ? `${dateParts[1]}-${dateParts[2]}` : '02-03';
  
  // 提取素材来源
  const sourceMatch = text.match(/\*\*素材来源\*\*[：:]\s*(.+?)(?=\n|$)/);
  const source = sourceMatch ? sourceMatch[1].trim() : '广大大';
  
  // 提取标题（第一行 # UA 素材日报）
  const titleMatch = text.match(/^#\s*(.+?)(?=\n|$)/m);
  const title = titleMatch ? titleMatch[1].trim() : 'UA 素材日报';
  
  // 提取摘要（从"一、各公司 UA 素材概览"部分提取前几段作为摘要）
  const overviewMatch = text.match(/## UA 素材日报[^\n]*\n\n(.+?)(?=###|##|$)/s);
  let summary = '';
  if (overviewMatch) {
    const overviewText = overviewMatch[1].trim();
    // 提取前300字符作为摘要
    summary = overviewText.substring(0, 300).replace(/\n+/g, ' ').trim();
    if (overviewText.length > 300) {
      summary += '...';
    }
  }
  
  // 如果没有找到摘要，使用默认摘要
  if (!summary) {
    summary = `来自${source}的UA素材日报，涵盖9款竞品游戏的素材分析，包括视频时长、投放平台、展示估值等关键信息。`;
  }
  
  // 创建 ReportDocument
  const doc: ReportDocument = {
    title: `${title} - ${reportDate}`,
    tags: ['UA素材', '竞品', '素材分析', source],
    date: dateStr,
    time: '09:00',
    source: source,
    summary: summary,
    content: text, // 保存完整的 markdown 内容
  };
  
  items.push({
    id: `ua-daily-${reportDate.replace(/-/g, '')}`,
    type: '休闲游戏监测',
    casualGameCategory: '竞品',
    casualGameCompetitorSub: 'UA素材',
    title: doc.title,
    source: doc.source ?? source,
    platform: source,
    date: doc.date ?? dateStr,
    time: doc.time ?? '09:00',
    views: 0,
    engagement: 0,
    description: doc.summary ?? summary,
    tags: doc.tags ?? ['UA素材', '竞品'],
    language: '中文',
    trend: 'stable',
    sentiment: 'neutral',
    url: '#',
    reportContent: JSON.stringify(doc),
  });
  
  return items;
}

/**
 * 加载所有日报数据
 * @param getDataUrl 可选，后端鉴权时传入
 */
export async function loadAllDailyReports(getDataUrl?: GetDataUrl): Promise<MonitorItem[]> {
  // AI 日报内容改为统一从 report_documents.json 输入，
  // 这里仅保留「热点日报」与「UA 素材日报」
  const [hotTrend, uaDaily] = await Promise.all([
    loadHotTrendReport(getDataUrl),
    loadUADailyReport(getDataUrl),
  ]);

  return [...hotTrend, ...uaDaily];
}
