import type { CasualGameMainCategory, MonitorItem, ReportDocument } from '../types';
import { fetchInitForDataUrl } from '../utils/api';

const REPORTS_BASE = '休闲游戏检测/出海周报';
const INDEX_FILENAME = `${REPORTS_BASE}/index.json`;

type GetDataUrl = (filename: string) => string;

interface OverseasWeeklyIndex {
  reports?: string[];
}

type OverseasWeeklyMeta = {
  kind?: string;
  startDate?: string;
  endDate?: string;
  generatedAt?: string;
  newsCount?: number;
};

type OverseasWeeklyDocument = ReportDocument & {
  id?: string;
  meta?: OverseasWeeklyMeta & Record<string, unknown>;
};

function getStaticBase(): string {
  try {
    const base = import.meta.env.BASE_URL;
    return typeof base === 'string' && base.length > 0 ? base : '/';
  } catch {
    return '/';
  }
}

function resolveUrl(getDataUrl: GetDataUrl | undefined, path: string): string {
  if (getDataUrl) return getDataUrl(path);
  const base = getStaticBase();
  return base.endsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

function getFetchOptions(url: string): RequestInit {
  return fetchInitForDataUrl(url);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarize(doc: OverseasWeeklyDocument): string {
  if (doc.summary?.trim()) return doc.summary.trim();
  const newsCount = doc.meta?.newsCount;
  if (typeof newsCount === 'number' && newsCount > 0) {
    return `本周跟踪 ${newsCount} 条出海游戏资讯，覆盖竞品动态、玩法机制、AI 探索、买量风向与新兴市场。`;
  }
  const text = stripMarkdown(doc.content || '');
  return text.length > 160 ? `${text.slice(0, 160)}...` : text || '点击查看出海市场周报详情。';
}

function normalizeTime(doc: OverseasWeeklyDocument): string {
  if (doc.time?.trim()) return doc.time.trim();
  const generatedAt = doc.meta?.generatedAt ?? '';
  return generatedAt.match(/\d{2}:\d{2}/)?.[0] ?? '';
}

function toMonitorItem(doc: OverseasWeeklyDocument, fileName: string): MonitorItem {
  const startDate = doc.meta?.startDate ?? '';
  const endDate = doc.meta?.endDate ?? doc.date ?? '';
  const id = doc.id || `overseas-weekly-${startDate || fileName}`;
  const tags = doc.tags && doc.tags.length > 0
    ? doc.tags
    : ['每周出海周报', '休闲游戏', '出海市场'];

  return {
    id,
    type: '休闲游戏监测',
    title: doc.title || `Puzzle Game 出海市场周报${startDate && endDate ? `（${startDate} 至 ${endDate}）` : ''}`,
    source: doc.source || 'game daily report2',
    platform: '出海周报',
    date: endDate || doc.date || '',
    time: normalizeTime(doc),
    views: 0,
    engagement: 0,
    description: summarize(doc),
    tags,
    language: 'zh',
    casualGameCategory: '出海周报' as CasualGameMainCategory,
    casualGameSource: 'overseas_weekly',
    reportContent: JSON.stringify({
      ...doc,
      tags,
      source: doc.source || 'game daily report2',
      summary: summarize(doc),
    }),
  };
}

export async function loadOverseasWeeklyReportItems(getDataUrl?: GetDataUrl): Promise<MonitorItem[]> {
  try {
    const indexUrl = resolveUrl(getDataUrl, INDEX_FILENAME);
    const indexRes = await fetch(indexUrl, getFetchOptions(indexUrl));
    if (!indexRes.ok) return [];
    const index = (await indexRes.json()) as OverseasWeeklyIndex;
    const reportFiles = Array.isArray(index.reports) ? index.reports : [];
    if (reportFiles.length === 0) return [];

    const items = await Promise.all(
      reportFiles.map(async (fileName) => {
        const path = `${REPORTS_BASE}/${fileName}`;
        const url = resolveUrl(getDataUrl, path);
        const res = await fetch(url, getFetchOptions(url));
        if (!res.ok) return null;
        const doc = (await res.json()) as OverseasWeeklyDocument;
        if (!doc || typeof doc.content !== 'string') return null;
        return toMonitorItem(doc, fileName);
      })
    );

    return items
      .filter((item): item is MonitorItem => item !== null)
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (error) {
    console.error('Failed to load overseas weekly reports:', error);
    return [];
  }
}
