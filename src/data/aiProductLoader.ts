/**
 * AI产品监测相关数据加载
 * - 竞品动态报告_AI产品.md → 竞品动态列表项（可点击看全文）
 * - ai_sales_batch_crawler.csv → 排行榜「竞品动态」（按收入排序）
 * - ai_products_report_daily.md → UA素材日报（AI产品监测 - UA素材）
 */

import type { GameRanking, GameRankingItem, GameRankingType } from '../types';
import type { MonitorItem, ReportDocument } from '../types';
import Papa from 'papaparse';

const REPORT_MD_FILENAME = 'ai产品/竞品动态报告_AI产品.md';
const AI_SALES_CSV_FILENAME = 'ai产品/ai产品竞品下载量和收益.csv';
const AI_UA_DAILY_REPORT_FILENAME = 'ai产品/ai_products_report_daily.md';
const AI_UA_TOP_AD_REPORT_FILENAME = 'ai产品/ai_UA展示估值最高周报.md';
const AI_PRODUCTS_UA_DB_FILENAME = 'ai_products_ua.db';

function getFetchOptions(url: string): RequestInit {
  return url.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
}

/**
 * 加载竞品动态报告 Markdown，转为一条 MonitorItem（AI产品监测 - 竞品动态），点击可进详情看全文
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
      type: 'AI产品监测',
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
 * 加载 AI 产品 UA 素材日报 Markdown，转为一条 MonitorItem（AI产品监测 - UA素材），点击可进详情看全文
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
      type: 'AI产品监测',
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

/**
 * 加载 AI 产品「展示估值最高的广告」周报 Markdown，转为一条 MonitorItem（AI产品监测 - UA素材），点击可进详情看全文
 */
export async function loadAiProductUATopAdReport(
  getDataUrl?: (filename: string) => string
): Promise<MonitorItem | null> {
  try {
    const url = getDataUrl ? getDataUrl(AI_UA_TOP_AD_REPORT_FILENAME) : AI_UA_TOP_AD_REPORT_FILENAME;
    const res = await fetch(url, getFetchOptions(url));
    if (!res.ok) return null;
    const markdown = await res.text();
    if (!markdown.trim()) return null;

    const dateMatch = markdown.match(/\*\*爬取日期\*\*[：:]\s*(\d{4}-\d{2}-\d{2})/);
    const reportDate = dateMatch ? dateMatch[1] : '2026-02-26';
    const dateParts = reportDate.split('-');
    const dateStr = dateParts.length >= 3 ? `${dateParts[1]}-${dateParts[2]}` : '02-26';

    const doc: ReportDocument = {
      title: 'AI 产品竞品 UA 监测周报（展示估值最高广告）',
      tags: ['AI产品', 'UA素材', '竞品', '展示估值'],
      date: dateStr,
      time: '09:00',
      source: 'ai_products_ua',
      summary: '各产品当周展示估值（impression）最高的一条广告，含标题、正文、封面图与视频链接，便于直接查看与复用。',
      content: markdown,
    };

    const item: MonitorItem = {
      id: `ai-product-ua-top-ad-${reportDate.replace(/-/g, '')}`,
      type: 'AI产品监测',
      aiProductSub: 'UA素材',
      title: doc.title,
      source: doc.source ?? 'ai_products_ua',
      platform: 'ai_products_ua',
      date: doc.date ?? dateStr,
      time: doc.time ?? '09:00',
      views: 0,
      engagement: 0,
      description: doc.summary ?? doc.title,
      tags: doc.tags ?? ['AI产品', 'UA素材'],
      language: '中文',
      reportContent: JSON.stringify(doc),
    };
    return item;
  } catch (e) {
    console.error('Error loading AI product UA top-ad report:', e);
    return null;
  }
}

/**
 * 从 ai_products_ua.db 的 ad_creative_analysis 表读取「有 LLM 拆解」的广告，
 * 为每条广告生成一张 MonitorItem 卡片（AI产品监测 - UA素材）。
 */
export async function loadAiUaCreativeCardsFromDb(
  getDataUrl?: (filename: string) => string
): Promise<MonitorItem[]> {
  try {
    const dbUrl = getDataUrl ? getDataUrl(AI_PRODUCTS_UA_DB_FILENAME) : AI_PRODUCTS_UA_DB_FILENAME;
    const sqlJsModule = await import('sql.js');
    const initSqlJs = sqlJsModule.default;
    const SQL = await initSqlJs({
      locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
    });

    const fetchOpts = dbUrl.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
    const response = await fetch(dbUrl, fetchOpts);
    if (!response.ok) return [];
    const buffer = await response.arrayBuffer();
    const db = new SQL.Database(new Uint8Array(buffer));

    // 取最新一日的 crawl_date
    const latestRes = db.exec(`SELECT MAX(crawl_date) AS crawl_date FROM ad_creative_analysis`);
    if (!latestRes.length || !latestRes[0].values.length || latestRes[0].values[0][0] == null) {
      db.close();
      return [];
    }
    const crawlDate = String(latestRes[0].values[0][0] ?? '').trim();
    if (!crawlDate) {
      db.close();
      return [];
    }
    const crawlSafe = crawlDate.replace(/'/g, "''");

    const result = db.exec(`
      SELECT
        ad_key,
        crawl_date,
        category,
        product,
        advertiser_name,
        title_zh,
        body_zh,
        platform,
        video_url,
        preview_img_url,
        llm_analysis
      FROM ad_creative_analysis
      WHERE crawl_date = '${crawlSafe}'
        AND llm_analysis IS NOT NULL
        AND TRIM(llm_analysis) != ''
      ORDER BY category, product, advertiser_name, ad_key
    `);
    db.close();

    if (!result.length || !result[0].values.length) return [];

    const columns = result[0].columns as string[];
    const rows = result[0].values as unknown[][];

    const toIndex = (name: string): number => columns.indexOf(name);
    const idxAdKey = toIndex('ad_key');
    // const idxCrawlDate = toIndex('crawl_date');
    const idxCategory = toIndex('category');
    const idxProduct = toIndex('product');
    const idxAdvertiser = toIndex('advertiser_name');
    const idxTitleZh = toIndex('title_zh');
    const idxBodyZh = toIndex('body_zh');
    const idxPlatform = toIndex('platform');
    const idxVideoUrl = toIndex('video_url');
    const idxCoverUrl = toIndex('preview_img_url');
    const idxAnalysis = toIndex('llm_analysis');

    const [, m, d] = crawlDate.split('-');
    const dateStr = m && d ? `${m}-${d}` : crawlDate;

    const items: MonitorItem[] = [];

    for (const row of rows) {
      const adKey = String(row[idxAdKey] ?? '');
      const category = String(row[idxCategory] ?? '');
      const product = String(row[idxProduct] ?? '');
      const advertiser = String(row[idxAdvertiser] ?? '');
      const titleZh = String(row[idxTitleZh] ?? '').trim();
      const bodyZhRaw = String(row[idxBodyZh] ?? '').trim();
      const platform = String(row[idxPlatform] ?? '');
      const videoUrl = String(row[idxVideoUrl] ?? '').trim();
      const coverUrl = String(row[idxCoverUrl] ?? '').trim();
      const analysisMd = String(row[idxAnalysis] ?? '').trim();

      if (!analysisMd) continue;

      const title = titleZh || `${product || 'AI 产品'} - ${platform || '广告'}`;
      const summary =
        bodyZhRaw ||
        `${product || 'AI 产品'} 在 ${platform || '广告平台'} 的一则 UA 素材拆解，含 Hook 与情感基调分析。`;

      const headerLines = [
        `# ${title}`,
        '',
        `**产品**：${product || '（未命名产品）'}（${category || '未分类'}）`,
        advertiser ? `**广告主**：${advertiser}` : '',
        platform ? `**投放平台**：${platform}` : '',
        videoUrl ? `**视频**：${videoUrl}` : '',
        coverUrl ? `**封面图**：${coverUrl}` : '',
        bodyZhRaw ? `**中文标题/文案**：${bodyZhRaw}` : '',
        '',
        '---',
        '',
      ].filter(Boolean);

      const content = `${headerLines.join('\n')}${analysisMd}`;

      const doc: ReportDocument = {
        title,
        tags: ['AI产品', 'UA素材', category || '未分类', product || '未知产品', platform || '未知平台'],
        date: dateStr,
        time: '',
        source: advertiser || platform || 'ai_products_ua',
        summary,
        content,
        meta: {
          kind: 'ai_ua_creative',
          crawlDate,
          category,
          product,
          advertiser,
          platform,
          videoUrl,
          coverUrl,
          adKey,
        },
      };

      const item: MonitorItem = {
        id: `ai-ua-creative-${adKey || `${product}-${platform}`}`,
        type: 'AI产品监测',
        aiProductSub: 'UA素材',
        title,
        source: doc.source ?? 'ai_products_ua',
        platform,
        date: doc.date ?? dateStr,
        time: '',
        views: 0,
        engagement: 0,
        description: summary,
        tags: doc.tags ?? ['AI产品', 'UA素材'],
        language: '中文',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(coverUrl ? { coverImage: coverUrl } : ({} as any)),
        reportContent: JSON.stringify(doc),
      };

      items.push(item);
    }

    return items;
  } catch (e) {
    console.error('Error loading AI UA creative cards from DB:', e);
    return [];
  }
}
