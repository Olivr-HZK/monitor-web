/**
 * AI产品监测相关数据加载
 * - 竞品动态报告_AI产品.md → 竞品动态列表项（可点击看全文）
 * - ai_sales_batch_crawler.csv → 排行榜「竞品动态」（按收入排序）
 * - ai_products_report_daily.md → UA素材日报（AI产品监测 - UA素材）
 */

import type {
  AiCreativeLibraryItem,
  AiCreativeLibraryKind,
  AiCreativeLibraryPayload,
  GameRanking,
  GameRankingItem,
  GameRankingType,
  MonitorItem,
  ReportDocument,
} from '../types';
import { fetchInitForDataUrl } from '../utils/api';
import Papa from 'papaparse';

const REPORT_MD_FILENAME = 'ai产品/竞品动态报告_AI产品.md';
const AI_SALES_CSV_FILENAME = 'ai产品/ai产品竞品下载量和收益.csv';
const AI_UA_DAILY_REPORT_FILENAME = 'ai产品/ai_products_report_daily.md';
const AI_PRODUCTS_UA_DB_FILENAME = 'ai_products_ua.db';

interface SqlJsDatabase {
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
  close: () => void;
}

function getFetchOptions(url: string): RequestInit {
  return fetchInitForDataUrl(url);
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

function formatUnixDate(value: unknown): string | undefined {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  const ms = num > 10_000_000_000 ? num : num * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function parseCreativeCountries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim().toUpperCase())
    .filter(Boolean);
}

function parseCreativePrimaryVideoUrl(rawJson: Record<string, unknown>, fallback?: string): string | undefined {
  const resourceUrls = rawJson.resource_urls;
  if (Array.isArray(resourceUrls)) {
    for (const item of resourceUrls) {
      if (item && typeof item === 'object' && 'video_url' in item) {
        const videoUrl = String((item as { video_url?: unknown }).video_url ?? '').trim();
        if (videoUrl) return videoUrl;
      }
    }
  }
  const safeFallback = String(fallback ?? '').trim();
  return safeFallback || undefined;
}

function formatWeekStart(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (!/^\d{8}$/.test(raw)) return undefined;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function addDays(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(base.getTime())) return dateStr;
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function formatExposure(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 10000) return `${(value / 10000).toFixed(2)}万`;
  return value.toLocaleString();
}

function formatGrowth(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function buildCreativeLinks(item: AiCreativeLibraryItem): string {
  const links: string[] = [];
  if (item.videoUrl) links.push(`[视频](${item.videoUrl})`);
  if (item.previewImgUrl) links.push(`[封面](${item.previewImgUrl})`);
  if (item.logoUrl) links.push(`[Logo](${item.logoUrl})`);
  return links.length ? links.join(' / ') : '—';
}

function escapeMdTableCell(value: string | undefined): string {
  return String(value ?? '—')
    .replace(/\|/g, '/')
    .replace(/\r?\n+/g, ' ')
    .trim() || '—';
}

async function openAiProductsUaDb(getDataUrl?: (filename: string) => string): Promise<SqlJsDatabase | null> {
  const dbUrl = getDataUrl ? getDataUrl(AI_PRODUCTS_UA_DB_FILENAME) : AI_PRODUCTS_UA_DB_FILENAME;
  const sqlJsModule = await import('sql.js');
  const initSqlJs = sqlJsModule.default;
  const SQL = await initSqlJs({
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
  });

  const response = await fetch(dbUrl, fetchInitForDataUrl(dbUrl));
  if (!response.ok) return null;

  const buffer = await response.arrayBuffer();
  return new SQL.Database(new Uint8Array(buffer)) as SqlJsDatabase;
}

function mapCreativeRows(
  kind: AiCreativeLibraryKind,
  rows: unknown[][],
  columns: string[]
): AiCreativeLibraryItem[] {
  const toIndex = (name: string): number => columns.indexOf(name);
  const idxId = toIndex('id');
  const idxCategory = toIndex('category');
  const idxAdKey = toIndex('ad_key');
  const idxAdvertiser = toIndex('advertiser_name');
  const idxPlatform = toIndex('platform');
  const idxHeat = toIndex('heat');
  const idxAllExposure = toIndex('all_exposure_value');
  const idxNewWeekExposure = toIndex('new_week_exposure_value');
  const idxDaysCount = toIndex('days_count');
  const idxPreview = toIndex('preview_img_url');
  const idxVideo = toIndex('video_url');
  const idxRawJson = toIndex('raw_json');
  const idxCreatedAt = toIndex('created_at');

  const items = rows.map((row) => {
    let rawJson: Record<string, unknown> = {};
    const rawJsonText = String(row[idxRawJson] ?? '').trim();
    if (rawJsonText) {
      try {
        rawJson = JSON.parse(rawJsonText) as Record<string, unknown>;
      } catch (error) {
        console.warn('[AI Creative Library] Failed to parse raw_json:', error);
      }
    }

    return {
      id: `ai-creative-${kind}-${String(row[idxId] ?? row[idxAdKey] ?? '')}`,
      kind,
      rank: 0,
      exposureTopWeek: formatWeekStart(
        rawJson.exposure_top &&
          typeof rawJson.exposure_top === 'object' &&
          'exposure_top_week' in rawJson.exposure_top
          ? (rawJson.exposure_top as { exposure_top_week?: unknown }).exposure_top_week
          : undefined
      ),
      category: String(row[idxCategory] ?? '').trim() || '未分类',
      adKey: String(row[idxAdKey] ?? '').trim(),
      advertiserName: String(row[idxAdvertiser] ?? '').trim() || '未知广告主',
      appDeveloper: String(rawJson.app_developer ?? '').trim() || undefined,
      platform: String(row[idxPlatform] ?? rawJson.platform ?? '').trim() || undefined,
      heat: Number(row[idxHeat] ?? rawJson.heat ?? 0) || 0,
      allExposureValue: Number(row[idxAllExposure] ?? rawJson.all_exposure_value ?? 0) || 0,
      newWeekExposureValue: Number(row[idxNewWeekExposure] ?? rawJson.new_week_exposure_value ?? 0) || 0,
      exposureDiff: Number(rawJson.exposure_diff ?? 0) || undefined,
      exposureGrowth: Number(rawJson.exposure_growth ?? 0) || undefined,
      daysCount: Number(row[idxDaysCount] ?? rawJson.days_count ?? 0) || 0,
      title: String(rawJson.title ?? '').trim() || undefined,
      message:
        String(rawJson.message ?? rawJson.body ?? '').trim() || undefined,
      callToAction: String(rawJson.call_to_action ?? '').trim() || undefined,
      logoUrl: String(rawJson.logo_url ?? '').trim() || undefined,
      previewImgUrl:
        String(row[idxPreview] ?? rawJson.preview_img_url ?? '').trim() || undefined,
      videoUrl: parseCreativePrimaryVideoUrl(rawJson, String(row[idxVideo] ?? '')),
      countries: parseCreativeCountries(rawJson.countries),
      createdAt: String(row[idxCreatedAt] ?? '').trim() || undefined,
      firstSeen: formatUnixDate(rawJson.first_seen),
      lastSeen: formatUnixDate(rawJson.last_seen),
    } satisfies Omit<AiCreativeLibraryItem, 'rank'> & { rank: number };
  });

  const sorters: Record<AiCreativeLibraryKind, (a: AiCreativeLibraryItem, b: AiCreativeLibraryItem) => number> = {
    new: (a, b) =>
      (b.heat ?? 0) - (a.heat ?? 0) ||
      (b.newWeekExposureValue ?? 0) - (a.newWeekExposureValue ?? 0) ||
      (b.allExposureValue ?? 0) - (a.allExposureValue ?? 0),
    hot: (a, b) =>
      (b.heat ?? 0) - (a.heat ?? 0) ||
      (b.allExposureValue ?? 0) - (a.allExposureValue ?? 0) ||
      (b.daysCount ?? 0) - (a.daysCount ?? 0),
    surge: (a, b) =>
      (b.exposureGrowth ?? 0) - (a.exposureGrowth ?? 0) ||
      (b.exposureDiff ?? 0) - (a.exposureDiff ?? 0) ||
      (b.heat ?? 0) - (a.heat ?? 0),
  };

  return items.sort(sorters[kind]).map((item, index) => ({ ...item, rank: index + 1 }));
}

export function buildAiProductWeeklyReportItem(
  creativeLibrary: AiCreativeLibraryPayload
): MonitorItem | null {
  const newTop10 = (creativeLibrary.newItems ?? []).slice(0, 10);
  const surgeTop10 = (creativeLibrary.surgeItems ?? []).slice(0, 10);
  const weekStart =
    newTop10[0]?.exposureTopWeek ??
    surgeTop10[0]?.exposureTopWeek ??
    creativeLibrary.hotItems?.[0]?.exposureTopWeek;

  if (!weekStart) return null;

  const weekEnd = addDays(weekStart, 6);
  const lines: string[] = [
    `**统计周期**：${weekStart} 至 ${weekEnd}（基于 AI 产品素材榜单最新周快照）。`,
    '',
    '## 一、本周新进前十',
    '',
    '根据 `latest_creative_library_new` 生成，按热度优先展示本周最值得关注的新进素材：',
    '',
    '| 排名 | 广告主 | 素材信息 | 平台 | 品类 | 热度 | 新增周曝光 | 累计曝光 | 持续天数 | 重要链接 |',
    '|------|--------|----------|------|------|------|------------|----------|----------|----------|',
  ];

  if (newTop10.length > 0) {
    newTop10.forEach((item) => {
      lines.push(
        `| ${item.rank} | ${escapeMdTableCell(item.advertiserName)} | ${escapeMdTableCell(item.title || item.message || item.callToAction || '—')} | ${escapeMdTableCell(item.platform || '—')} | ${escapeMdTableCell(item.category)} | ${formatExposure(item.heat)} | ${formatExposure(item.newWeekExposureValue)} | ${formatExposure(item.allExposureValue)} | ${item.daysCount ?? '—'} | ${buildCreativeLinks(item)} |`
      );
    });
  } else {
    lines.push('| — | 本周暂无新进素材 | — | — | — | — | — | — | — | — |');
  }

  lines.push(
    '',
    '---',
    '',
    '## 二、本周飙升前十',
    '',
    '根据 `latest_creative_library_surge` 生成，优先关注曝光增速最快的素材：',
    '',
    '| 排名 | 广告主 | 素材信息 | 平台 | 品类 | 热度 | 曝光增量 | 增长率 | 累计曝光 | 持续天数 | 重要链接 |',
    '|------|--------|----------|------|------|------|----------|--------|----------|----------|----------|',
  );

  if (surgeTop10.length > 0) {
    surgeTop10.forEach((item) => {
      lines.push(
        `| ${item.rank} | ${escapeMdTableCell(item.advertiserName)} | ${escapeMdTableCell(item.title || item.message || item.callToAction || '—')} | ${escapeMdTableCell(item.platform || '—')} | ${escapeMdTableCell(item.category)} | ${formatExposure(item.heat)} | ${formatExposure(item.exposureDiff)} | ${formatGrowth(item.exposureGrowth)} | ${formatExposure(item.allExposureValue)} | ${item.daysCount ?? '—'} | ${buildCreativeLinks(item)} |`
      );
    });
  } else {
    lines.push('| — | 本周暂无飙升素材 | — | — | — | — | — | — | — | — | — |');
  }

  const description = `本周新进前十 ${newTop10.length} 条，飙升前十 ${surgeTop10.length} 条，覆盖 AI 产品素材榜单最新周快照。`;
  const doc: ReportDocument = {
    title: `AI 产品周报（${weekStart}）`,
    tags: ['AI产品', '产品周报', '素材库', '周报'],
    date: weekStart,
    time: '',
    source: 'ai_products_ua',
    summary: description,
    content: lines.join('\n'),
    meta: {
      kind: 'ai_product_weekly',
      weekStart,
      weekEnd,
      newTop10: newTop10.map((item) => ({
        rank: item.rank,
        advertiserName: item.advertiserName,
        platform: item.platform,
        category: item.category,
        videoUrl: item.videoUrl,
      })),
      surgeTop10: surgeTop10.map((item) => ({
        rank: item.rank,
        advertiserName: item.advertiserName,
        platform: item.platform,
        category: item.category,
        videoUrl: item.videoUrl,
      })),
    },
  };

  return {
    id: `ai-product-weekly-${weekStart.replace(/-/g, '')}`,
    type: 'AI产品监测',
    aiProductSub: '产品周报',
    title: doc.title,
    source: doc.source ?? 'ai_products_ua',
    platform: '素材周报',
    date: weekStart,
    time: '',
    views: 0,
    engagement: 0,
    description,
    tags: doc.tags ?? ['AI产品', '产品周报'],
    language: '中文',
    reportContent: JSON.stringify(doc),
  };
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
 * 从 ai_products_ua.db 聚合生成「AI 产品 UA 素材周报」：
 * - 只看最新一日 crawl_date
 * - 按（category, product, advertiser_name）聚合，统计当日素材条数
 * - 每个产品给出一个示例视频链接
 */
export async function loadAiUaWeeklyReportFromDb(
  getDataUrl?: (filename: string) => string
): Promise<MonitorItem | null> {
  try {
    const db = await openAiProductsUaDb(getDataUrl);
    if (!db) return null;

    const latestRes = db.exec(`SELECT MAX(crawl_date) AS crawl_date FROM ad_creative_analysis`);
    if (!latestRes.length || !latestRes[0].values.length || latestRes[0].values[0][0] == null) {
      db.close();
      return null;
    }
    const crawlDate = String(latestRes[0].values[0][0] ?? '').trim();
    if (!crawlDate) {
      db.close();
      return null;
    }
    const crawlSafe = crawlDate.replace(/'/g, "''");

    const result = db.exec(`
      SELECT
        category,
        product,
        advertiser_name,
        platform,
        COUNT(*) AS creative_count,
        MAX(CASE WHEN video_url IS NOT NULL AND TRIM(video_url) != '' THEN video_url ELSE '' END) AS sample_video_url
      FROM ad_creative_analysis
      WHERE crawl_date = '${crawlSafe}'
      GROUP BY category, product, advertiser_name, platform
      HAVING creative_count > 0
      ORDER BY category, product, advertiser_name, platform
    `);
    db.close();

    if (!result.length || !result[0].values.length) return null;

    const columns = result[0].columns as string[];
    const rows = result[0].values as unknown[][];

    const toIndex = (name: string): number => columns.indexOf(name);
    const idxCategory = toIndex('category');
    const idxProduct = toIndex('product');
    const idxAdvertiser = toIndex('advertiser_name');
    const idxPlatform = toIndex('platform');
    const idxCount = toIndex('creative_count');
    const idxVideo = toIndex('sample_video_url');

    const [, m, d] = crawlDate.split('-');
    const dateStr = m && d ? `${m}-${d}` : crawlDate;

    const groupsByCategory = new Map<string, string[]>();

    for (const row of rows) {
      const category = String(row[idxCategory] ?? '').trim() || '未分类';
      const product = String(row[idxProduct] ?? '').trim() || '（未命名产品）';
      const advertiser = String(row[idxAdvertiser] ?? '').trim();
      const platform = String(row[idxPlatform] ?? '').trim();
      const count = Number(row[idxCount] ?? 0) || 0;
      const videoUrl = String(row[idxVideo] ?? '').trim();

      const header = advertiser ? `${product}（${advertiser}）` : product;
      const parts: string[] = [`- **${header}**`];
      const meta: string[] = [];
      if (platform) meta.push(`平台：${platform}`);
      if (count > 0) meta.push(`新增素材：${count} 条`);
      if (meta.length) parts.push(`（${meta.join('，')}）`);
      if (videoUrl) {
        parts.push(`，示例视频：[点击查看](${videoUrl})`);
      }
      const line = parts.join('');

      const list = groupsByCategory.get(category) ?? [];
      list.push(line);
      groupsByCategory.set(category, list);
    }

    if (!groupsByCategory.size) return null;

    const lines: string[] = [];
    lines.push(`# AI 产品 UA 素材周报 - ${crawlDate}`);
    lines.push('');
    lines.push(`**数据来源**：ai_products_ua.db（ad_creative_analysis）`);
    lines.push(`**统计口径**：${crawlDate} 当日新增 UA 素材（按产品 / 广告主 / 平台聚合）。`);
    lines.push('');

    for (const [category, items] of groupsByCategory.entries()) {
      lines.push(`## ${category}`);
      lines.push('');
      for (const l of items) {
        lines.push(l);
      }
      lines.push('');
    }

    const content = lines.join('\n');

    const doc: ReportDocument = {
      title: `AI 产品 UA 素材周报 - ${crawlDate}`,
      tags: ['AI产品', 'UA素材', '周报', '竞品'],
      date: dateStr,
      time: '',
      source: 'ai_products_ua',
      summary: `统计 ${crawlDate} 当日各竞品新增 UA 素材的产品列表，并给出示例视频链接。`,
      content,
    };

    const item: MonitorItem = {
      id: `ai-product-ua-weekly-${crawlDate.replace(/-/g, '')}`,
      type: 'AI产品监测',
      aiProductSub: 'UA素材',
      title: doc.title,
      source: doc.source ?? 'ai_products_ua',
      platform: '周报',
      date: doc.date ?? dateStr,
      time: '',
      views: 0,
      engagement: 0,
      description: doc.summary ?? '',
      tags: doc.tags ?? ['AI产品', 'UA素材'],
      language: '中文',
      reportContent: JSON.stringify(doc),
    };

    return item;
  } catch (e) {
    console.error('Error loading AI UA weekly report from DB:', e);
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
    const db = await openAiProductsUaDb(getDataUrl);
    if (!db) return [];

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

export async function loadAiCreativeLibraryFromDb(
  getDataUrl?: (filename: string) => string
): Promise<AiCreativeLibraryPayload> {
  try {
    const db = await openAiProductsUaDb(getDataUrl);
    if (!db) {
      return { newItems: [], hotItems: [], surgeItems: [] };
    }

    const queries: Record<AiCreativeLibraryKind, string> = {
      new: `
        SELECT id, category, ad_key, advertiser_name, platform, heat, all_exposure_value,
               new_week_exposure_value, days_count, preview_img_url, video_url, raw_json, created_at
        FROM latest_creative_library_new
      `,
      hot: `
        SELECT id, category, ad_key, advertiser_name, platform, heat, all_exposure_value,
               new_week_exposure_value, days_count, preview_img_url, video_url, raw_json, created_at
        FROM latest_creative_library_hot
      `,
      surge: `
        SELECT id, category, ad_key, advertiser_name, platform, heat, all_exposure_value,
               new_week_exposure_value, days_count, preview_img_url, video_url, raw_json, created_at
        FROM latest_creative_library_surge
      `,
    };

    const result = {
      newItems: [] as AiCreativeLibraryItem[],
      hotItems: [] as AiCreativeLibraryItem[],
      surgeItems: [] as AiCreativeLibraryItem[],
    };

    (Object.entries(queries) as Array<[AiCreativeLibraryKind, string]>).forEach(([kind, sql]) => {
      const queryResult = db.exec(sql);
      if (!queryResult.length || !queryResult[0].values.length) return;
      const mapped = mapCreativeRows(kind, queryResult[0].values, queryResult[0].columns);
      if (kind === 'new') result.newItems = mapped;
      if (kind === 'hot') result.hotItems = mapped;
      if (kind === 'surge') result.surgeItems = mapped;
    });

    db.close();
    return result;
  } catch (error) {
    console.error('Error loading AI creative library from DB:', error);
    return { newItems: [], hotItems: [], surgeItems: [] };
  }
}
