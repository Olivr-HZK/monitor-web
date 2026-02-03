/**
 * 日报数据加载器
 * 从 public 目录的 md 文件加载热点日报和AI日报（小红书周报）
 */

import type { MonitorItem, ReportDocument } from '../types';

/** 可选：后端鉴权时传入，用于拼接受保护数据 URL */
type GetDataUrl = (filename: string) => string;

/**
 * 解析热点日报 MD 文件
 */
export async function loadHotTrendReport(getDataUrl?: GetDataUrl): Promise<MonitorItem[]> {
  try {
    const url = getDataUrl ? getDataUrl('热点日报.md') : '热点日报.md';
    const opts = url.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
    const response = await fetch(url, opts);
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
    const url = getDataUrl ? getDataUrl('小红书周报.md') : '小红书周报.md';
    const opts = url.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
    const response = await fetch(url, opts);
    if (!response.ok) {
      console.error('Failed to load 小红书周报.md');
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
    title: `热点日报：${title}`,
    tags: contentType ? [contentType, '热点', 'UA灵感'] : ['热点', 'UA灵感'],
    date: dateStr,
    time: '09:00',
    source: '热点监测',
    summary,
    content: contentParts.join('\n') || summary || '暂无内容',
    score,
    coverImage: '/img_v3_02ud_b81bf139-6ea7-4b85-9a02-757d54361c4g.jpg',
  };

  items.push({
    id: 'hot-trend-1',
    type: '热点趋势检测',
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
      type: 'ai热点检测',
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
      type: 'ai热点检测',
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
    const url = getDataUrl ? getDataUrl('ua_report_daily.md') : 'ua_report_daily.md';
    const opts = url.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
    const response = await fetch(url, opts);
    if (!response.ok) {
      console.warn('Failed to load ua_report_daily.md');
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
    type: '休闲游戏检测',
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
  const [hotTrend, aiDaily, uaDaily] = await Promise.all([
    loadHotTrendReport(getDataUrl),
    loadAIDailyReport(getDataUrl),
    loadUADailyReport(getDataUrl),
  ]);
  
  return [...hotTrend, ...aiDaily, ...uaDaily];
}
