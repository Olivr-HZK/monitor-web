import { getOurProductDatabase } from './ourProductDailyLoader';

type GetDataUrl = (filename: string) => string;

export interface OurProductRankCell {
  ios: number | null;
  android: number | null;
}

export interface OurProductRankSeries {
  key: string;
  label: string;
  platform: 'ios' | 'android';
  device: string;
  chartType: string;
  category: string;
  categoryName: string;
  appId: string;
  ranksByDate: Record<string, number | null>;
}

export interface OurProductRankRow {
  internalName: string;
  displayName: string;
  byDate: Record<string, OurProductRankCell>;
  /** 各日期的 app_id，用于 SensorTower 链接 */
  appIdsByDate: Record<string, { ios: string; android: string }>;
  series: OurProductRankSeries[];
}

export interface OurProductRankAnalytics {
  /** 列日期，升序，最多 maxDates 条 */
  dates: string[];
  products: OurProductRankRow[];
}

const MAX_DATES = 56;

function fmtCell(c: OurProductRankCell): string {
  const pi = c.ios == null ? '—' : String(c.ios);
  const pa = c.android == null ? '—' : String(c.android);
  return `i ${pi} · a ${pa}`;
}

export function formatOurProductCell(c: OurProductRankCell): string {
  return fmtCell(c);
}

function normRankValue(rank: unknown): number | null {
  if (rank == null || rank === '') return null;
  const n = Number(rank);
  if (Number.isNaN(n) || n <= 0 || n > 500) return null;
  return n;
}

function normalizeCategoryName(raw: string, fallback: string): string {
  const s = raw.trim();
  if (!s || /^category[_ -]?\d+$/i.test(s)) return fallback || s || 'Unknown';
  if (s === 'all') return 'All';
  return s;
}

function formatSeriesLabel(input: {
  platform: string;
  device: string;
  category: string;
  categoryName: string;
}): string {
  const platform = input.platform.toLowerCase();
  const device = input.device.toLowerCase();
  const prefix =
    platform === 'ios'
      ? device === 'ipad'
        ? 'iPad'
        : 'iPhone'
      : 'Android';
  const normalized = normalizeCategoryName(input.categoryName, input.category);
  const category = normalized.includes('/') ? normalized.replace(/\//g, ' / ') : normalized;
  return `${prefix} - Free - ${category}`;
}

/**
 * 从 us_free_appid_weekly.app_ranks 聚合「产品 × 日期 × 双端名次」，供数据表与按产品追溯。
 */
export async function loadOurProductRankAnalytics(
  getDataUrl?: GetDataUrl
): Promise<OurProductRankAnalytics | null> {
  const db = await getOurProductDatabase(getDataUrl);
  if (!db) return null;

  type Agg = {
    displayName: string;
    byDate: Record<string, OurProductRankCell>;
    appIdsByDate: Record<string, { ios: string; android: string }>;
    seriesByKey: Map<string, OurProductRankSeries>;
  };
  const byProduct = new Map<string, Agg>();
  const dateSet = new Set<string>();

  try {
    const stmt = db.prepare(
      `SELECT internal_name, display_name, rank_date, lower(platform) AS pf, rank, app_id
       FROM app_ranks
       WHERE country = 'US'
         AND lower(platform) IN ('ios', 'android')
         AND (
           (lower(platform) = 'android' AND chart_type = 'topselling_free' AND category = 'game')
           OR (lower(platform) = 'ios' AND chart_type = 'topfreeapplications' AND category = '6014')
         )`
    );
    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        internal_name: string;
        display_name: string;
        rank_date: string;
        pf: string;
        rank: unknown;
        app_id: string;
      };
      const name = String(row.internal_name ?? '').trim();
      if (!name) continue;
      const d = String(row.rank_date ?? '').trim().slice(0, 10);
      if (!d) continue;
      dateSet.add(d);
      const rnk = normRankValue(row.rank);
      const aid = String(row.app_id ?? '').trim();
      let agg = byProduct.get(name);
      if (!agg) {
        agg = {
          displayName: String(row.display_name ?? name).trim() || name,
          byDate: {},
          appIdsByDate: {},
          seriesByKey: new Map(),
        };
        byProduct.set(name, agg);
      }
      if (row.display_name && String(row.display_name).trim()) {
        agg.displayName = String(row.display_name).trim();
      }
      if (!agg.byDate[d]) agg.byDate[d] = { ios: null, android: null };
      if (!agg.appIdsByDate[d]) agg.appIdsByDate[d] = { ios: '', android: '' };
      const cell = agg.byDate[d];
      const idCell = agg.appIdsByDate[d];
      if (row.pf === 'ios') {
        cell.ios = rnk;
        if (aid) idCell.ios = aid;
      } else if (row.pf === 'android') {
        cell.android = rnk;
        if (aid) idCell.android = aid;
      }
    }
    stmt.free();
  } catch (e) {
    console.error('loadOurProductRankAnalytics:', e);
    return null;
  }

  try {
    const stmt = db.prepare(
      `SELECT internal_name, display_name, rank_date, lower(platform) AS pf, lower(device) AS device,
              chart_type, category, category_name, rank, app_id
       FROM app_ranks
       WHERE country = 'US'
         AND lower(platform) IN ('ios', 'android')
         AND (
           (lower(platform) = 'android' AND chart_type = 'topselling_free')
           OR (lower(platform) = 'ios' AND chart_type IN ('topfreeapplications', 'topfreeipadapplications'))
         )`
    );
    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        internal_name: string;
        display_name: string;
        rank_date: string;
        pf: string;
        device: string;
        chart_type: string;
        category: string;
        category_name: string;
        rank: unknown;
        app_id: string;
      };
      const name = String(row.internal_name ?? '').trim();
      if (!name) continue;
      const d = String(row.rank_date ?? '').trim().slice(0, 10);
      if (!d) continue;
      dateSet.add(d);

      let agg = byProduct.get(name);
      if (!agg) {
        agg = {
          displayName: String(row.display_name ?? name).trim() || name,
          byDate: {},
          appIdsByDate: {},
          seriesByKey: new Map(),
        };
        byProduct.set(name, agg);
      }
      if (row.display_name && String(row.display_name).trim()) {
        agg.displayName = String(row.display_name).trim();
      }

      const pf: 'ios' | 'android' = row.pf === 'android' ? 'android' : 'ios';
      const device = String(row.device ?? '').trim().toLowerCase() || pf;
      const chartType = String(row.chart_type ?? '').trim();
      const category = String(row.category ?? '').trim();
      const categoryName = normalizeCategoryName(String(row.category_name ?? ''), category);
      const key = `${pf}:${device}:${chartType}:${category}`;
      let series = agg.seriesByKey.get(key);
      if (!series) {
        series = {
          key,
          label: formatSeriesLabel({ platform: pf, device, category, categoryName }),
          platform: pf,
          device,
          chartType,
          category,
          categoryName,
          appId: '',
          ranksByDate: {},
        };
        agg.seriesByKey.set(key, series);
      }
      const aid = String(row.app_id ?? '').trim();
      if (aid) series.appId = aid;
      series.ranksByDate[d] = normRankValue(row.rank);
    }
    stmt.free();
  } catch (e) {
    console.error('loadOurProductRankAnalytics series:', e);
    return null;
  }

  let dates = Array.from(dateSet).sort();
  if (dates.length > MAX_DATES) dates = dates.slice(-MAX_DATES);

  const products: OurProductRankRow[] = Array.from(byProduct.entries())
    .map(([internalName, agg]) => ({
      internalName,
      displayName: agg.displayName,
      byDate: agg.byDate,
      appIdsByDate: agg.appIdsByDate,
      series: Array.from(agg.seriesByKey.values())
        .filter((s) => Object.values(s.ranksByDate).some((rank) => rank != null))
        .sort((a, b) => {
          const platformA = a.platform === 'ios' ? 0 : 1;
          const platformB = b.platform === 'ios' ? 0 : 1;
          if (platformA !== platformB) return platformA - platformB;
          const deviceA = a.device === 'iphone' ? 0 : a.device === 'ipad' ? 1 : 2;
          const deviceB = b.device === 'iphone' ? 0 : b.device === 'ipad' ? 1 : 2;
          if (deviceA !== deviceB) return deviceA - deviceB;
          return a.label.localeCompare(b.label, 'zh');
        }),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh'));

  return { dates, products };
}

export interface OurProductTraceDay {
  date: string;
  ios: number | null;
  android: number | null;
  deltaIos: number | null;
  deltaAndroid: number | null;
}

export function buildTraceSeriesForProduct(
  row: OurProductRankRow,
  datesAsc: string[]
): OurProductTraceDay[] {
  const days: OurProductTraceDay[] = [];
  for (let i = 0; i < datesAsc.length; i++) {
    const d = datesAsc[i];
    const cell = row.byDate[d] ?? { ios: null, android: null };
    const prevD = i > 0 ? datesAsc[i - 1] : null;
    const prevCell = prevD ? (row.byDate[prevD] ?? { ios: null, android: null }) : null;
    let deltaIos: number | null = null;
    let deltaAndroid: number | null = null;
    if (prevCell) {
      if (prevCell.ios != null && cell.ios != null) deltaIos = prevCell.ios - cell.ios;
      if (prevCell.android != null && cell.android != null) deltaAndroid = prevCell.android - cell.android;
    }
    days.push({ date: d, ios: cell.ios, android: cell.android, deltaIos, deltaAndroid });
  }
  return days.reverse();
}
