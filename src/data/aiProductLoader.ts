/**
 * AI产品检测相关数据加载
 * - 竞品动态报告_AI产品.md → 竞品动态列表项（可点击看全文）
 * - ai_sales_batch_crawler.csv → 排行榜「竞品动态」（按收入排序）
 * - ai_products_report_daily.md → UA素材日报（AI产品检测 - UA素材）
 */

import type { GameRanking, GameRankingItem, GameRankingType } from '../types';
import type { MonitorItem, ReportDocument } from '../types';
import Papa from 'papaparse';

const REPORT_MD_FILENAME = 'ai产品/竞品动态报告_AI产品.md';
const AI_SALES_CSV_FILENAME = 'ai产品/ai产品竞品下载量和收益.csv';
const AI_UA_DAILY_REPORT_FILENAME = 'ai产品/ai_products_report_daily.md';

function getFetchOptions(url: string): RequestInit {
  return url.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
}

/**
 * 加载竞品动态报告 Markdown，转为一条 MonitorItem（AI产品检测 - 竞品动态），点击可进详情看全文
 */
export async function loadCompetitorReportMd(
  getDataUrl?: (filename: string) => string
): Promise<MonitorItem | null> {
  try {
    const url = getDataUrl ? getDataUrl(REPORT_MD_FILENAME) : REPORT_MD_FILENAME;
    const res = await fetch(url, getFetchOptions(url));
    if (!res.ok) return null;
    const markdown = await res.text();
    if (!markdown.trim()) return null;

    const doc: ReportDocument = {
      title: '竞品动态报告（AI 品类销售监测）',
      tags: ['AI产品', '竞品动态', '销售监测'],
      date: '2026-01-26',
      source: 'ai_sales_batch_crawler',
      summary: '数据周期：2026-01-26（单日数据）。Android 下载量 + 收入估算，10 款产品总览与分产品分析。',
      content: markdown,
    };

    const item: MonitorItem = {
      id: 'ai-competitor-report-md',
      type: 'AI产品检测',
      aiProductSub: '竞品动态',
      title: doc.title,
      source: doc.source ?? '竞品动态',
      platform: '报告',
      date: '01-26',
      time: '14:00',
      views: 0,
      engagement: 0,
      description: doc.summary ?? doc.title,
      tags: doc.tags ?? [],
      language: '中文',
      reportContent: JSON.stringify(doc),
    };
    return item;
  } catch (e) {
    console.error('Error loading competitor report md:', e);
    return null;
  }
}

interface AiSalesRow {
  product_name: string;
  category: string;
  app_id: string;
  country: string;
  date: string;
  android_units: string;
  android_revenue: string;
}

/** 按产品聚合：总下载量、总收入 */
function aggregateByProduct(rows: AiSalesRow[]): Map<string, { name: string; category: string; appId: string; units: number; revenue: number }> {
  const map = new Map<string, { name: string; category: string; appId: string; units: number; revenue: number }>();
  for (const row of rows) {
    const key = row.product_name?.trim() || '';
    if (!key) continue;
    const units = parseInt(String(row.android_units || '0').replace(/,/g, ''), 10) || 0;
    const revenue = parseInt(String(row.android_revenue || '0').replace(/,/g, ''), 10) || 0;
    const existing = map.get(key);
    if (existing) {
      existing.units += units;
      existing.revenue += revenue;
    } else {
      map.set(key, {
        name: key,
        category: row.category?.trim() || '—',
        appId: row.app_id?.trim() || '—',
        units,
        revenue,
      });
    }
  }
  return map;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * 加载 ai_sales_batch_crawler.csv，按产品聚合下载量/收入，按收入排序，生成排行榜「竞品动态」
 */
export async function loadAiSalesRankingFromCsv(
  getDataUrl?: (filename: string) => string
): Promise<GameRanking[]> {
  try {
    const url = getDataUrl ? getDataUrl(AI_SALES_CSV_FILENAME) : AI_SALES_CSV_FILENAME;
    const res = await fetch(url, getFetchOptions(url));
    if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
    const text = await res.text();

    const parsed = Papa.parse<AiSalesRow>(text, { header: true, skipEmptyLines: true });
    const rows = parsed.data ?? [];
    const aggregated = aggregateByProduct(rows);

    const list = Array.from(aggregated.values())
      .filter((a) => a.revenue > 0 || a.units > 0)
      .sort((a, b) => b.revenue - a.revenue);

    const items: GameRankingItem[] = list.map((a, index) => ({
      id: `ai-sales-${index}-${a.name}`,
      rank: index + 1,
      name: a.name,
      category: a.category,
      appId: a.appId,
      change: '--',
      updateDate: '2026-01-26',
      score: a.revenue,
      downloads: formatNumber(a.units),
    }));

    if (items.length === 0) return [];

    const ranking: GameRanking = {
      type: '竞品动态' as GameRankingType,
      title: '竞品动态',
      updateTime: '2026-01-26 14:00',
      period: 'AI 品类销售监测',
      items,
    };
    return [ranking];
  } catch (e) {
    console.error('Error loading AI sales ranking CSV:', e);
    return [];
  }
}

/**
 * 加载 AI 产品 UA 素材日报 Markdown，转为一条 MonitorItem（AI产品检测 - UA素材），点击可进详情看全文
 */
export async function loadAiProductUADailyReport(
  getDataUrl?: (filename: string) => string
): Promise<MonitorItem | null> {
  try {
    const url = getDataUrl ? getDataUrl(AI_UA_DAILY_REPORT_FILENAME) : AI_UA_DAILY_REPORT_FILENAME;
    const res = await fetch(url, getFetchOptions(url));
    if (!res.ok) {
      console.warn('Failed to load AI product UA daily report');
      return null;
    }
    const markdown = await res.text();
    if (!markdown.trim()) return null;

    // 提取日期（格式：**日期**: 2026-02-04）
    const dateMatch = markdown.match(/\*\*日期\*\*[：:]\s*(\d{4}-\d{2}-\d{2})/);
    const reportDate = dateMatch ? dateMatch[1] : '';
    const dateParts = reportDate.split('-');
    const dateStr = dateParts.length >= 3 ? `${dateParts[1]}-${dateParts[2]}` : '02-04';

    // 提取素材来源
    const sourceMatch = markdown.match(/\*\*素材来源\*\*[：:]\s*(.+?)(?=\n|$)/);
    const source = sourceMatch ? sourceMatch[1].trim() : '广大大';

    // 提取摘要（从"一、各分类 AI 产品 UA 素材概览"部分提取前几段作为摘要）
    const overviewMatch = markdown.match(/### 一、各分类 AI 产品 UA 素材概览\s*\n([\s\S]*?)(?=### 二、|##|$)/);
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
      summary = `来自${source}的AI产品UA素材日报，涵盖10款竞品AI产品的素材分析，包括视频时长、投放平台、展示估值等关键信息。`;
    }

    const doc: ReportDocument = {
      title: `AI 产品 UA 素材日报 - ${reportDate}`,
      tags: ['AI产品', 'UA素材', '竞品', '素材分析', source],
      date: dateStr,
      time: '09:00',
      source: source,
      summary: summary,
      content: markdown, // 保存完整的 markdown 内容
    };

    const item: MonitorItem = {
      id: `ai-product-ua-daily-${reportDate.replace(/-/g, '')}`,
      type: 'AI产品检测',
      aiProductSub: 'UA素材',
      title: doc.title,
      source: doc.source ?? source,
      platform: source,
      date: doc.date ?? dateStr,
      time: doc.time ?? '09:00',
      views: 0,
      engagement: 0,
      description: doc.summary ?? summary,
      tags: doc.tags ?? ['AI产品', 'UA素材'],
      language: '中文',
      trend: 'stable',
      sentiment: 'neutral',
      url: '#',
      reportContent: JSON.stringify(doc),
    };
    return item;
  } catch (e) {
    console.error('Error loading AI product UA daily report:', e);
    return null;
  }
}
