import type { MonitorItem, MonitorType, CasualGameMainCategory } from '../types';
import { fetchInitForDataUrl, getApiUrl, withApiAuth } from '../utils/api';
import { buildSensorTowerOverviewUrl } from '../utils/rankingLabels';

type GetDataUrl = (filename: string) => string;

let ourProductDbPromise: Promise<any | null> | null = null;

function shouldUseBackendFrontendData(getDataUrl?: GetDataUrl): boolean {
  if (!getDataUrl) return false;
  try {
    return getDataUrl('us_free_appid_weekly.db').includes('/api/data/');
  } catch {
    return false;
  }
}

async function loadBackendDailyItems(getDataUrl?: GetDataUrl): Promise<MonitorItem[] | null> {
  if (!shouldUseBackendFrontendData(getDataUrl)) return null;
  try {
    const res = await fetch(
      getApiUrl('/api/frontend/our-products/daily-items'),
      withApiAuth({ headers: { Accept: 'application/json' } })
    );
    if (!res.ok) {
      console.warn('Failed to fetch /api/frontend/our-products/daily-items:', res.status, res.statusText);
      return null;
    }
    const data = await res.json();
    return Array.isArray(data?.items) ? (data.items as MonitorItem[]) : null;
  } catch (e) {
    console.warn('Error fetching /api/frontend/our-products/daily-items:', e);
    return null;
  }
}

/**
 * public 下的文件在 Vite 里挂在 import.meta.env.BASE_URL 下（如 /monitor-web/xxx.db），
 * 与「仓库里有 public/xxx」不是同一条 URL；后端模式还会先走 /api/data。
 * 按序尝试，避免因单一 URL 解析错误而 404。
 */
async function fetchUsFreeDbBinary(getDataUrl?: GetDataUrl): Promise<Response | null> {
  const DB_FILES = ['us_free_appid_weekly.db', 'us free app id.db'];
  const candidates: string[] = [];
  const push = (u: string) => {
    const s = u.trim();
    if (s && !candidates.includes(s)) candidates.push(s);
  };

  for (const DB_FILE of DB_FILES) {
    if (getDataUrl) {
      push(getDataUrl(DB_FILE));
    } else {
      push(DB_FILE);
    }
    // Vite 官方约定：public 资源 URL = BASE_URL + 文件名（与磁盘路径 public/ 不是同一条）
    const baseUrl = String(import.meta.env.BASE_URL ?? '/');
    push(`${baseUrl}${DB_FILE}`.replace(/\/+/g, '/'));
    // 部分部署：文件在站点根路径
    push(`/${DB_FILE}`);
    if (typeof window !== 'undefined') {
      try {
        push(new URL(DB_FILE, window.location.href).href);
      } catch {
        /**/
      }
    }
  }

  let last: Response | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    last = await fetch(url, fetchInitForDataUrl(url));
    if (last.ok) {
      if (import.meta.env.DEV && i > 0) {
        console.warn(`[dev] us free app id DB：已用候选 URL（${i + 1}/${candidates.length}）`, url);
      }
      return last;
    }
  }
  if (import.meta.env.DEV && last) {
    console.warn('[dev] us free app id DB：候选 URL 均未成功', candidates);
  }
  return last;
}

export function resetOurProductDatabaseCache(): void {
  ourProductDbPromise = null;
}

export async function getOurProductDatabase(getDataUrl?: GetDataUrl): Promise<any | null> {
  if (!ourProductDbPromise) {
    ourProductDbPromise = (async () => {
      try {
        const sqlJsModule = await import('sql.js');
        const initSqlJs = sqlJsModule.default;
        const SQL = await initSqlJs({
          locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
        });
        const res = await fetchUsFreeDbBinary(getDataUrl);
        if (!res?.ok) {
          console.error(
            'Failed to fetch us free app id DB:',
            res?.status,
            res?.statusText
          );
          // 勿缓存失败结果：未登录时 /api/data 会 401，登录后需能重新拉取
          ourProductDbPromise = null;
          return null;
        }
        const buffer = await res.arrayBuffer();
        return new SQL.Database(new Uint8Array(buffer));
      } catch (e) {
        console.error('Error initializing us free app id DB with sql.js:', e);
        ourProductDbPromise = null;
        return null;
      }
    })();
  }
  return ourProductDbPromise;
}

function normRank(r: unknown): number | null {
  if (r === null || r === undefined) return null;
  const n = Number(r);
  if (Number.isNaN(n) || n <= 0 || n > 500) return null;
  return n;
}

interface SegmentRow {
  internalName: string;
  displayName: string;
  platform: 'ios' | 'android';
  prev: number;
  curr: number;
  /** 当前日在榜行的 app_id，用于 SensorTower 链接 */
  stAppId: string;
}

type RankSnap = { rank: number | null; appId: string };

function emptySnap(): RankSnap {
  return { rank: null, appId: '' };
}

function buildRankMap(
  db: any,
  date: string
): Map<string, { displayName: string; ios: RankSnap; android: RankSnap }> {
  const map = new Map<string, { displayName: string; ios: RankSnap; android: RankSnap }>();
  try {
    const stmt = db.prepare(
      `SELECT internal_name, display_name, lower(platform) AS pf, rank, app_id
       FROM app_ranks
       WHERE country = 'US' AND rank_date = ?
         AND lower(platform) IN ('ios', 'android')
         AND (
           (lower(platform) = 'android' AND chart_type = 'topselling_free')
           OR (lower(platform) = 'ios' AND chart_type = 'topfreeapplications')
         )`
    );
    stmt.bind([date]);
    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        internal_name: string;
        display_name: string;
        pf: string;
        rank: unknown;
        app_id: string;
      };
      const name = String(row.internal_name ?? '').trim();
      if (!name) continue;
      const r = normRank(row.rank);
      const aid = String(row.app_id ?? '').trim();
      let rec = map.get(name);
      if (!rec) {
        rec = {
          displayName: String(row.display_name ?? name).trim() || name,
          ios: emptySnap(),
          android: emptySnap(),
        };
        map.set(name, rec);
      }
      if (row.display_name && String(row.display_name).trim()) {
        rec.displayName = String(row.display_name).trim();
      }
      if (row.pf === 'ios') {
        rec.ios = { rank: r, appId: aid || rec.ios.appId };
      } else if (row.pf === 'android') {
        rec.android = { rank: r, appId: aid || rec.android.appId };
      }
    }
    stmt.free();
  } catch (e) {
    console.error('ourProductDailyLoader: read app_ranks failed', e);
  }
  return map;
}

/** 合并多平台时优先用 iOS 的 app_id 做游戏名链接（与 ST 习惯一致） */
function pickStAppIdForName(entries: SegmentRow[]): string {
  const ios = entries.find((e) => e.platform === 'ios' && e.stAppId.trim());
  if (ios) return ios.stAppId.trim();
  const any = entries.find((e) => e.stAppId.trim());
  return any ? any.stAppId.trim() : '';
}

function markdownLinkedTitle(displayName: string, stAppId: string): string {
  const url = buildSensorTowerOverviewUrl(stAppId, 'US');
  if (!url) return displayName;
  const safe = displayName.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  return `[${safe}](${url})`;
}

function mergeLines(rows: SegmentRow[], order: 'up' | 'down'): string[] {
  const byName = new Map<string, SegmentRow[]>();
  for (const r of rows) {
    const list = byName.get(r.internalName) ?? [];
    list.push(r);
    byName.set(r.internalName, list);
  }
  const groups = Array.from(byName.values());
  groups.sort((a, b) => {
    const maxA = Math.max(...a.map((x) => Math.abs(x.prev - x.curr)));
    const maxB = Math.max(...b.map((x) => Math.abs(x.prev - x.curr)));
    if (maxA !== maxB) return order === 'up' ? maxB - maxA : maxA - maxB;
    return (a[0].displayName || a[0].internalName).localeCompare(b[0].displayName || b[0].internalName, 'zh');
  });
  return groups.map((entries) => {
    const sorted = [...entries].sort((x, y) => (x.platform === 'ios' ? 0 : 1) - (y.platform === 'ios' ? 0 : 1));
    const display = sorted[0].displayName || sorted[0].internalName;
    const linkId = pickStAppIdForName(sorted);
    const title = markdownLinkedTitle(display, linkId);
    const segs = sorted.map((e) => {
      const d = e.prev - e.curr;
      const sign = d > 0 ? '+' : '';
      return `${e.platform} ${e.prev}→${e.curr}（${sign}${d}）`;
    });
    return `${title}（${segs.join('，')}）`;
  });
}

function buildCompactMarkdown(
  db: any,
  dateFrom: string,
  dateTo: string,
  fallbackSummary?: string
): string {
  const prevMap = buildRankMap(db, dateFrom);
  const currMap = buildRankMap(db, dateTo);
  const names = new Set<string>([...prevMap.keys(), ...currMap.keys()]);
  const up: SegmentRow[] = [];
  const down: SegmentRow[] = [];

  for (const internalName of names) {
    const p = prevMap.get(internalName) ?? {
      displayName: internalName,
      ios: emptySnap(),
      android: emptySnap(),
    };
    const c = currMap.get(internalName) ?? {
      displayName: p.displayName,
      ios: emptySnap(),
      android: emptySnap(),
    };
    const displayName = c.displayName || p.displayName || internalName;
    for (const platform of ['ios', 'android'] as const) {
      const pr = platform === 'ios' ? p.ios.rank : p.android.rank;
      const cr = platform === 'ios' ? c.ios.rank : c.android.rank;
      const stAppId = platform === 'ios' ? c.ios.appId : c.android.appId;
      if (pr === null || cr === null) continue;
      const delta = pr - cr;
      if (delta === 0) continue;
      const row: SegmentRow = {
        internalName,
        displayName,
        platform,
        prev: pr,
        curr: cr,
        stAppId: stAppId || (platform === 'ios' ? p.ios.appId : p.android.appId),
      };
      if (delta > 0) up.push(row);
      else down.push(row);
    }
  }

  const header = [
    '公司自有产品 · SensorTower US 免费榜 · 日总结',
    '',
    '📍 美国 US · 免费榜（iOS/Android）',
    '',
    '统计口径 · 仅统计各维度入围前 500 名的本公司产品。',
    '',
    `日环比 · ${dateFrom} → ${dateTo}`,
    '',
  ].join('\n');

  if (up.length === 0 && down.length === 0) {
    if (fallbackSummary?.trim()) {
      return `${header}\n\n---\n\n${fallbackSummary.trim()}`;
    }
    return `${header}\n\n（暂无有效日环比：两日均在榜数据不足或排名无变化。）`;
  }

  const upLines = mergeLines(up, 'up');
  const downLines = mergeLines(down, 'down');
  const body = [
    '上升',
    '',
    ...upLines.map((l) => `- ${l}`),
    '',
    '下降',
    '',
    ...downLines.map((l) => `- ${l}`),
  ].join('\n');

  return `${header}\n\n${body}`;
}

export async function loadOurProductDailyItems(getDataUrl?: GetDataUrl): Promise<MonitorItem[]> {
  const backendItems = await loadBackendDailyItems(getDataUrl);
  if (backendItems) return backendItems;

  const db = await getOurProductDatabase(getDataUrl);
  if (!db) return [];

  let summaries: { date_from: string; date_to: string; summary_text: string; product_count: number | null }[] = [];
  try {
    const stmt = db.prepare(
      `SELECT date_from, date_to, summary_text, product_count FROM weekly_summaries ORDER BY date_to DESC`
    );
    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        date_from: string;
        date_to: string;
        summary_text: string;
        product_count: number | null;
      };
      summaries.push({
        date_from: String(row.date_from ?? '').trim(),
        date_to: String(row.date_to ?? '').trim(),
        summary_text: String(row.summary_text ?? ''),
        product_count: row.product_count != null ? Number(row.product_count) : null,
      });
    }
    stmt.free();
  } catch (e) {
    console.error('ourProductDailyLoader: weekly_summaries failed', e);
    return [];
  }

  const items: MonitorItem[] = [];
  const seenSummaryKeys = new Set<string>();
  for (const s of summaries) {
    if (!s.date_from || !s.date_to) continue;
    const summaryKey = `${s.date_from}__${s.date_to}`;
    if (seenSummaryKeys.has(summaryKey)) continue;
    seenSummaryKeys.add(summaryKey);
    const md = buildCompactMarkdown(db, s.date_from, s.date_to, s.summary_text);
    const id = `our-product-us-free-${s.date_to}`;
    const title = '公司自有产品 · SensorTower US 免费榜 · 日总结';
    const desc =
      s.product_count != null && !Number.isNaN(s.product_count)
        ? `日环比 ${s.date_from} → ${s.date_to} · 覆盖 ${s.product_count} 个产品（详情见正文）`
        : `日环比 ${s.date_from} → ${s.date_to}`;
    const reportContent = JSON.stringify({
      title,
      date: s.date_to,
      time: '',
      source: '自有产品',
      summary: desc,
      content: md,
      tags: ['我方产品', 'SensorTower', 'US', '免费榜', '日总结'],
      meta: {
        kind: 'our_product_daily',
        dateFrom: s.date_from,
        dateTo: s.date_to,
      },
    });
    items.push({
      id,
      type: '休闲游戏监测' as MonitorType,
      title,
      source: '自有产品',
      platform: '多平台',
      casualGameCategory: '我方产品' as CasualGameMainCategory,
      casualGameSource: 'our_product',
      date: s.date_to,
      time: '',
      views: 0,
      engagement: 0,
      description: desc,
      tags: ['我方产品', 'SensorTower', 'US', '免费榜', '日总结'],
      language: 'zh',
      reportContent,
    });
  }
  return items;
}
