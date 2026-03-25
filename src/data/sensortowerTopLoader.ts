import type {
  SensorTowerTopItem,
  SensorTowerRankChangeItem,
  SensorTowerStoreCard,
  AppStoreInfo,
  GameStoreInfo,
  SensorTowerStoreChangeItem,
  SensorTowerRemovedGameItem,
  SensorTowerTop5OverviewItem,
} from '../types';

type GetDataUrl = (filename: string) => string;

let sensorTowerDbPromise: Promise<any | null> | null = null;

async function getSensorTowerDatabase(getDataUrl?: GetDataUrl): Promise<any | null> {
  if (!sensorTowerDbPromise) {
    sensorTowerDbPromise = (async () => {
      try {
        const sqlJsModule = await import('sql.js');
        const initSqlJs = sqlJsModule.default;
        const SQL = await initSqlJs({
          locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
        });
        const dbPath = getDataUrl ? getDataUrl('sensortower_top100.db') : 'sensortower_top100.db';
        const opts = dbPath.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
        const res = await fetch(dbPath, opts);
        if (!res.ok) {
          console.error('Failed to fetch sensortower_top100.db:', res.status, res.statusText);
          return null;
        }
        const buffer = await res.arrayBuffer();
        return new SQL.Database(new Uint8Array(buffer));
      } catch (e) {
        console.error('Error initializing sensortower_top100.db with sql.js:', e);
        return null;
      }
    })();
  }
  return sensorTowerDbPromise;
}

/** app_metadata 键：app_id + 小写 os (ios/android) */
function metadataKey(appId: string, platform: 'iOS' | 'Android'): string {
  return `${appId}|${platform === 'iOS' ? 'ios' : 'android'}`;
}

/** 从 app_metadata 表加载 Map，用于按 app_id + platform 补全名称、发行商、发行日期、URL */
function loadAppMetadataMap(db: any): Map<string, { name: string; publisher_name: string; release_date: string; url: string }> {
  const map = new Map<string, { name: string; publisher_name: string; release_date: string; url: string }>();
  try {
    const stmt = db.prepare(
      `SELECT app_id, os, name, publisher_name, release_date, url FROM app_metadata`
    );
    while (stmt.step()) {
      const row: any = stmt.getAsObject();
      const os = String(row.os || '').toLowerCase();
      const key = `${row.app_id}|${os}`;
      map.set(key, {
        name: String(row.name ?? ''),
        publisher_name: String(row.publisher_name ?? ''),
        release_date: String(row.release_date ?? ''),
        url: String(row.url ?? ''),
      });
    }
    stmt.free();
  } catch (e) {
    console.error('Error reading app_metadata from sensortower_top100.db:', e);
  }
  return map;
}

/** 格式化发行日期为 YYYY-MM-DD 展示 */
function formatReleaseDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function parseScreenshotUrls(raw?: string): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item)).filter((item) => item);
    }
  } catch {
    // fall through to split logic
  }
  const candidates = trimmed
    .split(/[\n,|;]/g)
    .map((item) => item.trim())
    .filter((item) => item);
  return candidates;
}

function stripLooseQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitTopLevel(input: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '{' || ch === '[') depth += 1;
    if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      result.push(input.slice(start, i));
      start = i + 1;
    }
  }
  result.push(input.slice(start));
  return result.map((s) => s.trim()).filter(Boolean);
}

function parseLooseMap(raw: string): Record<string, string> {
  let s = (raw || '').trim();
  if (!s) return {};
  if (s.startsWith('{') && s.endsWith('}')) {
    s = s.slice(1, -1);
  }
  const result: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    while (i < s.length && (s[i] === ' ' || s[i] === ',')) i += 1;
    if (i >= s.length) break;
    const keyStart = i;
    while (i < s.length && s[i] !== ':') i += 1;
    if (i >= s.length) break;
    const key = stripLooseQuotes(s.slice(keyStart, i).trim());
    i += 1;
    let depth = 0;
    const valStart = i;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '{' || ch === '[') depth += 1;
      if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) break;
      i += 1;
    }
    const value = s.slice(valStart, i).trim();
    if (key) result[key] = value;
    if (i < s.length && s[i] === ',') i += 1;
  }
  return result;
}

function parseChangedFields(raw?: string): string[] {
  const text = (raw || '').trim();
  if (!text) return [];
  let s = text;
  if (s.startsWith('[') && s.endsWith(']')) {
    s = s.slice(1, -1);
  }
  return splitTopLevel(s)
    .map((item) => stripLooseQuotes(item).trim())
    .filter(Boolean);
}

function parseChangesJson(
  changesJson: string
): {
  summaries: string[];
  screenshotBefore?: string[];
  screenshotAfter?: string[];
  screenshotUrls?: string[];
  iconBefore?: string;
  iconAfter?: string;
  videoImagesBefore?: string[];
  videoImagesAfter?: string[];
  priority: 0 | 1 | 2;
  priorityLabel: '最高' | '高' | '普通';
  hasMeaningfulChange: boolean;
} {
  const stripQuotes = (value: string) => {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  };

  const splitTopLevel = (input: string): string[] => {
    const result: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        result.push(input.slice(start, i));
        start = i + 1;
      }
    }
    result.push(input.slice(start));
    return result.map((s) => s.trim()).filter(Boolean);
  };

  const parseLooseMap = (raw: string): Record<string, string> => {
    let s = raw.trim();
    if (s.startsWith('{') && s.endsWith('}')) {
      s = s.slice(1, -1);
    }
    const result: Record<string, string> = {};
    let i = 0;
    while (i < s.length) {
      while (i < s.length && (s[i] === ' ' || s[i] === ',')) i++;
      if (i >= s.length) break;
      const keyStart = i;
      while (i < s.length && s[i] !== ':') i++;
      if (i >= s.length) break;
      const key = stripQuotes(s.slice(keyStart, i).trim());
      i += 1;
      let depth = 0;
      const valStart = i;
      while (i < s.length) {
        const ch = s[i];
        if (ch === '{' || ch === '[') depth++;
        if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
        if (ch === ',' && depth === 0) break;
        i++;
      }
      const value = s.slice(valStart, i).trim();
      if (key) result[key] = value;
      if (i < s.length && s[i] === ',') i++;
    }
    return result;
  };

  const parseArray = (raw?: string): string[] => {
    if (!raw) return [];
    let s = raw.trim();
    if (s.startsWith('[') && s.endsWith(']')) {
      s = s.slice(1, -1);
    }
    if (!s) return [];
    return splitTopLevel(s).map((item) => stripQuotes(item));
  };

  const normalizeValue = (raw?: string): string => {
    if (!raw) return '空';
    const v = stripQuotes(raw);
    if (!v || v === 'null' || v === 'undefined') return '空';
    return v;
  };

  const normalizeList = (items: string[]) =>
    items
      .map((item) => stripQuotes(item).trim())
      .filter((item) => item);

  const sameStringList = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  };

  const sameStringSet = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const sa = new Set(a);
    const sb = new Set(b);
    if (sa.size !== sb.size) return false;
    for (const v of sa) {
      if (!sb.has(v)) return false;
    }
    return true;
  };

  const isUrlLike = (value: string) => /^https?:\/\//i.test(value.trim());

  const labelMap: Record<string, string> = {
    app_name: '名称',
    title: '名称',
    subtitle: '副标题',
    developer: '开发者',
    category: '分类',
    rating: '评分',
    rating_count: '评分人数',
    price: '价格',
    price_type: '价格类型',
    installs: '安装量',
    content_rating: '内容评级',
    description: '完整描述',
    full_description: '完整描述',
    description_short: '短描述',
    short_description: '短描述',
    store_url: '商店链接',
    icon_url: '图标',
    screenshot_urls: '截图',
    languages: '语言',
    'video id': '视频',
    video_id: '视频',
    'video thumbnail url': '视频封面',
    video_thumbnail_url: '视频封面',
  };

  let hasScreenshotChange = false;
  let hasScreenshotCountChange = false;
  let hasVideoChange = false;
  let hasIconChange = false;
  let screenshotUrls: string[] | undefined;
  let screenshotBefore: string[] | undefined;
  let screenshotAfter: string[] | undefined;
  let iconBefore: string | undefined;
  let iconAfter: string | undefined;
  let videoImagesBefore: string[] | undefined;
  let videoImagesAfter: string[] | undefined;
  let hasMeaningfulChange = false;

  const summarizeFieldChange = (field: string, oldVal?: string, newVal?: string): string => {
    const lowerField = field.toLowerCase();
    // similar_app_ids / similar_apps 只用于内部参考，不在前端卡片和详情中展示
    if (lowerField === 'similar_app_ids' || lowerField === 'similar_apps') {
      return '';
    }
    // 活动结束时间等纯时间字段不展示（例如 event end time / event_end_time）
    if (lowerField === 'event end time' || lowerField === 'event_end_time') {
      return '';
    }
    // size / sizebytes 不展示
    if (lowerField === 'size' || lowerField === 'sizebytes') {
      return '';
    }
    const label = labelMap[field] || labelMap[lowerField] || field;
    if (field === 'screenshot_urls') {
      const oldArr = normalizeList(parseArray(oldVal));
      const newArr = normalizeList(parseArray(newVal));
      if (sameStringSet(oldArr, newArr)) return '';
      hasScreenshotChange = true;
      if (newArr.length > 0) {
        screenshotUrls = newArr.slice(0, 6);
      }
      const oldSet = new Set(oldArr);
      const newSet = new Set(newArr);
      screenshotBefore = oldArr.filter((url) => !newSet.has(url));
      screenshotAfter = newArr.filter((url) => !oldSet.has(url));
      if (oldArr.length !== newArr.length) hasScreenshotCountChange = true;
      hasMeaningfulChange = true;
      return '截图已更新';
    }
    if (field === 'icon_url') {
      const oldUrl = normalizeValue(oldVal);
      const newUrl = normalizeValue(newVal);
      if (oldUrl === newUrl) return '';
      iconBefore = isUrlLike(oldUrl) ? oldUrl : undefined;
      iconAfter = isUrlLike(newUrl) ? newUrl : undefined;
      hasIconChange = true;
      hasMeaningfulChange = true;
      return '图标已更新';
    }
    // 视频相关：只有「视频封面 URL」才写入 videoImagesBefore/After；video_id 等只生成摘要，不覆盖 URL
    if (field.toLowerCase().includes('video')) {
      const oldArr = normalizeList(parseArray(oldVal));
      const newArr = normalizeList(parseArray(newVal));
      const oldUrl = oldArr.length === 0 ? normalizeValue(oldVal) : '';
      const newUrl = newArr.length === 0 ? normalizeValue(newVal) : '';
      const oldList = oldArr.length ? oldArr : (isUrlLike(oldUrl) ? [oldUrl] : []);
      const newList = newArr.length ? newArr : (isUrlLike(newUrl) ? [newUrl] : []);
      if (sameStringList(oldList, newList)) return '';
      // 仅当字段是 video_thumbnail_url（或值像 URL）时才写入封面链接，避免 video_id 覆盖
      const isThumbnailUrlField =
        lowerField === 'video_thumbnail_url' || lowerField === 'video thumbnail url';
      const oldAreUrls = oldList.length > 0 && oldList.every((u) => isUrlLike(u));
      const newAreUrls = newList.length > 0 && newList.every((u) => isUrlLike(u));
      if (isThumbnailUrlField && (oldAreUrls || newAreUrls)) {
        videoImagesBefore = oldAreUrls ? oldList : undefined;
        videoImagesAfter = newAreUrls ? newList : undefined;
      }
      hasVideoChange = true;
      hasMeaningfulChange = true;
      return `${label}有更新`;
    }
    // 语言变更暂不关注
    if (field === 'languages') {
      return '';
    }
    if (field === 'icon_url') {
      return '图标已更新';
    }
    // 商店链接变更暂不在摘要中展示
    if (field === 'store_url') {
      return '';
    }
    if (field === 'rating') {
      const oldNum = parseFloat(normalizeValue(oldVal));
      const newNum = parseFloat(normalizeValue(newVal));
      if (Number.isNaN(oldNum) || Number.isNaN(newNum)) return '';
      if (Math.abs(oldNum - newNum) <= 0.1) return '';
      hasMeaningfulChange = true;
      return `评分：${oldNum.toFixed(2)} → ${newNum.toFixed(2)}`;
    }
    if (field === 'rating_count') {
      return '';
    }
    // 描述、名称、分类等通用文案暂不在摘要中展示，只保留「下载量」这类核心数值
    if (field === 'description' || field === 'full_description' || field === 'description_short' || field === 'short_description') {
      return '';
    }
    // 仅保留 installs（下载量）这类关心的数值变更
    if (lowerField === 'installs') {
      const oldText = normalizeValue(oldVal);
      const newText = normalizeValue(newVal);
      if (oldText === newText) return '';
      hasMeaningfulChange = true;
      return `${label}：${oldText} → ${newText}`;
    }
    return '';
  };

  const topMap = parseLooseMap(changesJson);
  const summaries: string[] = [];
  for (const [field, raw] of Object.entries(topMap)) {
    const pair = parseLooseMap(raw);
    const oldVal = pair.old ?? pair.before ?? pair.prev ?? '';
    const newVal = pair.new ?? pair.after ?? pair.next ?? '';
    const summary = summarizeFieldChange(field, oldVal, newVal);
    if (summary) summaries.push(summary);
  }

  let priority: 0 | 1 | 2 = 0;
  if (hasScreenshotCountChange || hasScreenshotChange) {
    priority = 2;
  } else if (hasVideoChange) {
    priority = 1;
  }
  const priorityLabel: '最高' | '高' | '普通' =
    priority === 2 ? '最高' : priority === 1 ? '高' : '普通';

  return {
    summaries: summaries.slice(0, 6),
    screenshotUrls,
    screenshotBefore,
    screenshotAfter,
    iconBefore,
    iconAfter,
    videoImagesBefore,
    videoImagesAfter,
    priority,
    priorityLabel,
    hasMeaningfulChange: hasMeaningfulChange || hasScreenshotChange || hasVideoChange || hasIconChange,
  };
}

function loadStoreInfoMap(
  db: any,
  platform: 'iOS' | 'Android'
): Map<string, { name: string; developer?: string; storeUrl?: string }> {
  const map = new Map<string, { name: string; developer?: string; storeUrl?: string }>();
  try {
    const stmt =
      platform === 'iOS'
        ? db.prepare(`SELECT app_id, app_name, developer, store_url FROM appstoreinfo`)
        : db.prepare(`SELECT app_id, title, developer, store_url FROM gamestoreinfo`);
    while (stmt.step()) {
      const row: any = stmt.getAsObject();
      const appId = String(row.app_id ?? '');
      const name = platform === 'iOS' ? String(row.app_name ?? '') : String(row.title ?? '');
      map.set(appId, {
        name,
        developer: row.developer != null ? String(row.developer) : undefined,
        storeUrl: row.store_url != null ? String(row.store_url) : undefined,
      });
    }
    stmt.free();
  } catch (e) {
    console.error('Error loading store info map:', e);
  }
  return map;
}

/** 最近 N 周的 rank_date 列表（用于只展示最近四周） */
const RANK_WEEKS_LIMIT = 4;

function getLastRankDates(db: any, tableName: string): string[] {
  const dates: string[] = [];
  try {
    const stmt = db.prepare(`SELECT DISTINCT rank_date FROM ${tableName} ORDER BY rank_date DESC LIMIT ${RANK_WEEKS_LIMIT}`);
    while (stmt.step()) {
      const row = stmt.getAsObject() as { rank_date: string };
      if (row.rank_date) dates.push(String(row.rank_date));
    }
    stmt.free();
  } catch {
    // ignore
  }
  return dates;
}

/** 从 sensortower_top100.db 读取 iOS / Android Top100 榜单（仅最近四周），并关联 app_metadata */
export async function loadSensorTowerTop100(getDataUrl?: GetDataUrl): Promise<SensorTowerTopItem[]> {
  const db = await getSensorTowerDatabase(getDataUrl);
  if (!db) return [];

  const metaMap = loadAppMetadataMap(db);
  const result: SensorTowerTopItem[] = [];

  const tables: Array<{ name: string; platform: 'iOS' | 'Android' }> = [
    { name: 'apple_top100', platform: 'iOS' },
    { name: 'android_top100', platform: 'Android' },
  ];

  for (const { name, platform } of tables) {
    try {
      const allowedDates = getLastRankDates(db, name);
      if (allowedDates.length === 0) continue;
      const placeholders = allowedDates.map(() => '?').join(',');
      const stmt = db.prepare(
        `SELECT rank_date, country, chart_type, rank, app_id, downloads, revenue FROM ${name} WHERE rank_date IN (${placeholders}) ORDER BY rank_date DESC, country, chart_type, rank ASC`
      );
      stmt.bind(allowedDates);
      while (stmt.step()) {
        const row: any = stmt.getAsObject();
        const appId = String(row.app_id);
        const key = metadataKey(appId, platform);
        const meta = metaMap.get(key);
        result.push({
          id: `${platform}-${row.rank_date}-${row.country}-${row.chart_type}-${row.rank}-${appId}`,
          platform,
          rankDate: String(row.rank_date),
          country: String(row.country),
          chartType: String(row.chart_type),
          rank: Number(row.rank),
          appId,
          appName: meta?.name || undefined,
          appUrl: meta?.url || undefined,
          publisherName: meta?.publisher_name || undefined,
          releaseDate: meta?.release_date ? formatReleaseDate(meta.release_date) : undefined,
          downloads: row.downloads != null ? Number(row.downloads) : undefined,
          revenue: row.revenue != null ? Number(row.revenue) : undefined,
        });
      }
      stmt.free();
    } catch (e) {
      console.error(`Error reading table ${name} from sensortower_top100.db:`, e);
    }
  }

  return result;
}

/** 从 sensortower_top100.db 读取异动榜单 rank_changes（仅最近四周），并关联 app_metadata */
export async function loadSensorTowerRankChanges(getDataUrl?: GetDataUrl): Promise<SensorTowerRankChangeItem[]> {
  const db = await getSensorTowerDatabase(getDataUrl);
  if (!db) return [];

  const metaMap = loadAppMetadataMap(db);
  const result: SensorTowerRankChangeItem[] = [];

  try {
    const dateStmt = db.prepare(
      `SELECT DISTINCT rank_date_current FROM rank_changes ORDER BY rank_date_current DESC LIMIT ${RANK_WEEKS_LIMIT}`
    );
    const allowedDates: string[] = [];
    while (dateStmt.step()) {
      const row = dateStmt.getAsObject() as { rank_date_current: string };
      if (row.rank_date_current) allowedDates.push(String(row.rank_date_current));
    }
    dateStmt.free();
    if (allowedDates.length === 0) return result;

    const placeholders = allowedDates.map(() => '?').join(',');
    const stmt = db.prepare(
      `SELECT rank_date_current, rank_date_last, signal, app_name, app_id, country, platform, current_rank, last_week_rank, "change", change_type, downloads, revenue, publisher_name FROM rank_changes WHERE rank_date_current IN (${placeholders}) ORDER BY rank_date_current DESC, country, platform, current_rank ASC`
    );
    stmt.bind(allowedDates);
    while (stmt.step()) {
      const row: any = stmt.getAsObject();
      const appId = String(row.app_id ?? '');
      const platformRaw = String(row.platform ?? '').toUpperCase();
      const platform: 'iOS' | 'Android' = platformRaw === 'ANDROID' ? 'Android' : 'iOS';
      const key = metadataKey(appId, platform);
      const meta = metaMap.get(key);
      const currentRank = Number(row.current_rank) || 0;
      const lastWeekRank = String(row.last_week_rank ?? '').trim();
      // Top5 异动：上周第一本周 2～5 为「掉出第一」；上周 2～5 本周第一为「登顶」
      let top5Movement: '登顶' | '掉出第一' | undefined;
      if (lastWeekRank === '1' && currentRank >= 2 && currentRank <= 5) {
        top5Movement = '掉出第一';
      } else if (['2', '3', '4', '5'].includes(lastWeekRank) && currentRank === 1) {
        top5Movement = '登顶';
      }
      result.push({
        id: `rc-${row.rank_date_current}-${row.country}-${platform}-${row.current_rank}-${appId}`,
        rankDateCurrent: String(row.rank_date_current),
        rankDateLast: String(row.rank_date_last),
        signal: String(row.signal ?? ''),
        appName: String(row.app_name ?? ''),
        appId,
        country: String(row.country ?? ''),
        platform,
        currentRank,
        lastWeekRank: String(row.last_week_rank ?? ''),
        change: String(row['change'] ?? row.change ?? ''),
        changeType: String(row.change_type ?? ''),
        metadataAppName: meta?.name || undefined,
        appUrl: meta?.url || undefined,
        publisherName: (row.publisher_name != null && String(row.publisher_name).trim() !== '')
          ? String(row.publisher_name)
          : (meta?.publisher_name || undefined),
        releaseDate: meta?.release_date ? formatReleaseDate(meta.release_date) : undefined,
        downloads: row.downloads != null ? Number(row.downloads) : undefined,
        revenue: row.revenue != null ? Number(row.revenue) : undefined,
        top5Movement,
      });
    }
    stmt.free();
  } catch (e) {
    console.error('Error reading rank_changes from sensortower_top100.db:', e);
  }

  return result;
}

/** 美国新进 Top50 中取前三款（按当前排名），仅最新一周、iOS + Android，并从 appstoreinfo/gamestoreinfo 拉取商店信息 */
export async function loadSensorTowerNewTop3StoreCards(
  getDataUrl?: GetDataUrl
): Promise<SensorTowerStoreCard[]> {
  const db = await getSensorTowerDatabase(getDataUrl);
  if (!db) return [];

  const result: SensorTowerStoreCard[] = [];
  try {
    let latestDate: string | null = null;
    const dateStmt = db.prepare(
      `SELECT rank_date_current FROM rank_changes WHERE country = '🇺🇸 美国' AND change_type = '🆕 新进榜单' AND current_rank <= 50 ORDER BY rank_date_current DESC LIMIT 1`
    );
    if (dateStmt.step()) {
      latestDate = String((dateStmt.getAsObject() as any).rank_date_current);
    }
    dateStmt.free();
    if (!latestDate) return [];

    const topStmt = db.prepare(
      `SELECT app_id, app_name, country, platform, current_rank FROM rank_changes
       WHERE rank_date_current = ? AND country = '🇺🇸 美国' AND change_type = '🆕 新进榜单' AND current_rank <= 50
       ORDER BY current_rank ASC LIMIT 3`
    );
    topStmt.bind([latestDate]);
    const rows: Array<{ app_id: string; app_name: string; country: string; platform: string; current_rank: number }> = [];
    while (topStmt.step()) {
      const r = topStmt.getAsObject() as any;
      rows.push({
        app_id: String(r.app_id),
        app_name: String(r.app_name ?? ''),
        country: String(r.country ?? ''),
        platform: String(r.platform ?? ''),
        current_rank: Number(r.current_rank) ?? 0,
      });
    }
    topStmt.free();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const appId = r.app_id;
      const platform: 'iOS' | 'Android' = r.platform.toUpperCase() === 'ANDROID' ? 'Android' : 'iOS';
      let storeInfo: AppStoreInfo | GameStoreInfo | null = null;

      if (platform === 'iOS') {
        const stmt = db.prepare(
          `SELECT app_id, app_name, subtitle, price, price_type, rating, rating_count, age_rating, category, developer, description, description_short, store_url, icon_url, screenshot_urls FROM appstoreinfo WHERE app_id = ? LIMIT 1`
        );
        stmt.bind([appId]);
        if (stmt.step()) {
          const row = stmt.getAsObject() as any;
          storeInfo = {
            app_id: String(row.app_id),
            app_name: String(row.app_name ?? ''),
            subtitle: row.subtitle != null ? String(row.subtitle) : undefined,
            price: row.price != null ? String(row.price) : undefined,
            price_type: row.price_type != null ? String(row.price_type) : undefined,
            rating: row.rating != null ? Number(row.rating) : undefined,
            rating_count: row.rating_count != null ? Number(row.rating_count) : undefined,
            age_rating: row.age_rating != null ? String(row.age_rating) : undefined,
            category: row.category != null ? String(row.category) : undefined,
            developer: row.developer != null ? String(row.developer) : undefined,
            description: row.description != null ? String(row.description) : undefined,
            description_short: row.description_short != null ? String(row.description_short) : undefined,
            store_url: row.store_url != null ? String(row.store_url) : undefined,
            icon_url: row.icon_url != null ? String(row.icon_url) : undefined,
            screenshot_urls: row.screenshot_urls != null ? String(row.screenshot_urls) : undefined,
          };
        }
        stmt.free();
      } else {
        const stmt = db.prepare(
          `SELECT app_id, title, developer, rating, category, short_description, full_description, store_url, icon_url, screenshot_urls, installs, content_rating FROM gamestoreinfo WHERE app_id = ? LIMIT 1`
        );
        stmt.bind([appId]);
        if (stmt.step()) {
          const row = stmt.getAsObject() as any;
          storeInfo = {
            app_id: String(row.app_id),
            title: String(row.title ?? ''),
            developer: row.developer != null ? String(row.developer) : undefined,
            rating: row.rating != null ? Number(row.rating) : undefined,
            category: row.category != null ? String(row.category) : undefined,
            short_description: row.short_description != null ? String(row.short_description) : undefined,
            full_description: row.full_description != null ? String(row.full_description) : undefined,
            store_url: row.store_url != null ? String(row.store_url) : undefined,
            icon_url: row.icon_url != null ? String(row.icon_url) : undefined,
            screenshot_urls: row.screenshot_urls != null ? String(row.screenshot_urls) : undefined,
            installs: row.installs != null ? String(row.installs) : undefined,
            content_rating: row.content_rating != null ? String(row.content_rating) : undefined,
          };
        }
        stmt.free();
      }

      // 兜底优先级：iOS app_name / Android title / rank_changes.app_name / appId
      let gameName: string = r.app_name || appId;
      if (storeInfo) {
        if ('app_name' in storeInfo && typeof storeInfo.app_name === 'string' && storeInfo.app_name) {
          gameName = storeInfo.app_name;
        } else if ('title' in storeInfo && typeof storeInfo.title === 'string' && storeInfo.title) {
          gameName = storeInfo.title;
        }
      }

      const screenshotUrl = parseScreenshotUrls(storeInfo?.screenshot_urls)[0];

      // iOS description_short / Android short_description
      let shortDescription: string | undefined;
      if (storeInfo) {
        if ('description_short' in storeInfo && typeof storeInfo.description_short === 'string' && storeInfo.description_short) {
          shortDescription = storeInfo.description_short;
        } else if ('short_description' in storeInfo && typeof storeInfo.short_description === 'string' && storeInfo.short_description) {
          shortDescription = storeInfo.short_description;
        }
      }
      result.push({
        id: `st-store-${latestDate}-${platform}-${appId}-${i}`,
        appId,
        platform,
        gameName,
        currentRank: r.current_rank,
        country: r.country,
        storeInfo,
        screenshotUrl,
        shortDescription,
      });
    }
  } catch (e) {
    console.error('Error loading SensorTower new top3 store cards:', e);
  }
  return result;
}

/** 从 appstoreinfo_changes / gamestoreinfo_changes 读取最新一批商店页变化 */
export async function loadSensorTowerStoreChanges(
  getDataUrl?: GetDataUrl
): Promise<SensorTowerStoreChangeItem[]> {
  const db = await getSensorTowerDatabase(getDataUrl);
  if (!db) return [];

  const results: SensorTowerStoreChangeItem[] = [];
  const iosInfoMap = loadStoreInfoMap(db, 'iOS');
  const androidInfoMap = loadStoreInfoMap(db, 'Android');

  try {
    const dateStmt = db.prepare(
      `SELECT DISTINCT rank_date FROM weekly_metadata_changes ORDER BY rank_date DESC LIMIT 30`
    );
    const rankDates: string[] = [];
    while (dateStmt.step()) {
      const row = dateStmt.getAsObject() as any;
      const d = String(row.rank_date ?? '');
      if (d) rankDates.push(d);
    }
    dateStmt.free();
    if (rankDates.length === 0) return results;

    const snapshotMap = new Map<string, string[]>();
    try {
      const snapshotStmt = db.prepare(
        `SELECT rank_date, app_id, os, screenshot_urls FROM weekly_metadata_snapshot
         WHERE rank_date IN (${rankDates.map(() => '?').join(',')})`
      );
      snapshotStmt.bind(rankDates);
      while (snapshotStmt.step()) {
        const row = snapshotStmt.getAsObject() as any;
        const key = `${String(row.rank_date ?? '')}|${String(row.app_id ?? '')}|${String(row.os ?? '').toLowerCase()}`;
        snapshotMap.set(key, parseScreenshotUrls(String(row.screenshot_urls ?? '')));
      }
      snapshotStmt.free();
    } catch (e) {
      console.warn('Error reading weekly_metadata_snapshot from sensortower_top100.db:', e);
    }

    let index = 0;
    const stmt = db.prepare(
      `SELECT rank_date, app_id, os, app_name, changed_fields, old_values, new_values, detected_at
       FROM weekly_metadata_changes
       WHERE rank_date IN (${rankDates.map(() => '?').join(',')})
       ORDER BY rank_date DESC, detected_at DESC, id DESC`
    );
    stmt.bind(rankDates);
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      const appId = String(row.app_id ?? '');
      const os = String(row.os ?? '').toLowerCase();
      const platform: 'iOS' | 'Android' = os === 'android' ? 'Android' : 'iOS';
      const infoMap = platform === 'Android' ? androidInfoMap : iosInfoMap;
      const info = infoMap.get(appId);
      const changedFields = parseChangedFields(String(row.changed_fields ?? ''));
      const oldMap = parseLooseMap(String(row.old_values ?? ''));
      const newMap = parseLooseMap(String(row.new_values ?? ''));

      const summaries: string[] = [];
      let screenshotBefore = parseScreenshotUrls(oldMap.screenshot_urls);
      let screenshotAfter = parseScreenshotUrls(newMap.screenshot_urls);
      const snapshotKey = `${String(row.rank_date ?? '')}|${appId}|${os}`;
      if (screenshotAfter.length === 0 && snapshotMap.has(snapshotKey)) {
        screenshotAfter = snapshotMap.get(snapshotKey) ?? [];
      }
      const screenshotChanged = changedFields.includes('screenshot_urls');
      const nameChanged = changedFields.includes('name');
      const descriptionChanged =
        changedFields.includes('description') || changedFields.includes('short_description');

      if (screenshotChanged) summaries.push('截图已更新');
      if (nameChanged) summaries.push('名称已更新');
      if (descriptionChanged) summaries.push('描述已更新');

      if (summaries.length === 0) continue;

      results.push({
        id: `st-store-change-${platform}-${row.rank_date}-${appId}-${index++}`,
        appId,
        platform,
        rankDate: String(row.rank_date ?? ''),
        changedAt: String(row.detected_at ?? row.rank_date ?? ''),
        appName: String(row.app_name ?? '') || info?.name || appId,
        developer: info?.developer,
        summaries,
        storeUrl: info?.storeUrl,
        screenshotUrls: screenshotAfter.length > 0 ? screenshotAfter.slice(0, 6) : undefined,
        screenshotBefore: screenshotBefore.length > 0 ? screenshotBefore.slice(0, 6) : undefined,
        screenshotAfter: screenshotAfter.length > 0 ? screenshotAfter.slice(0, 6) : undefined,
        iconBefore: undefined,
        iconAfter: undefined,
        videoImagesBefore: undefined,
        videoImagesAfter: undefined,
        priority: screenshotChanged ? 2 : 0,
        priorityLabel: screenshotChanged ? '最高' : '普通',
      });
    }
    stmt.free();
  } catch (e) {
    console.error('Error reading weekly_metadata_changes from sensortower_top100.db:', e);
  }

  return results;
}

export async function loadSensorTowerRemovedGames(
  getDataUrl?: GetDataUrl
): Promise<SensorTowerRemovedGameItem[]> {
  const db = await getSensorTowerDatabase(getDataUrl);
  if (!db) return [];

  const result: SensorTowerRemovedGameItem[] = [];
  const metaMap = loadAppMetadataMap(db);
  try {
    const dateStmt = db.prepare(
      `SELECT DISTINCT rank_date FROM weekly_removed_games WHERE removed = 1 ORDER BY rank_date DESC LIMIT ${RANK_WEEKS_LIMIT}`
    );
    const rankDates: string[] = [];
    while (dateStmt.step()) {
      const row = dateStmt.getAsObject() as any;
      const d = String(row.rank_date ?? '');
      if (d) rankDates.push(d);
    }
    dateStmt.free();
    if (rankDates.length === 0) return result;

    const stmt = db.prepare(
      `SELECT rank_date, os, country, chart_type, app_id, app_name, store_url, reason
       FROM weekly_removed_games
       WHERE removed = 1 AND rank_date IN (${rankDates.map(() => '?').join(',')})
       ORDER BY rank_date DESC, os, country, chart_type, app_name`
    );
    stmt.bind(rankDates);
    let index = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      const os = String(row.os ?? '').toLowerCase();
      const platform: 'iOS' | 'Android' = os === 'android' ? 'Android' : 'iOS';
      const appId = String(row.app_id ?? '');
      const meta = metaMap.get(metadataKey(appId, platform));
      result.push({
        id: `st-removed-${String(row.rank_date ?? '')}-${platform}-${appId}-${index++}`,
        rankDate: String(row.rank_date ?? ''),
        platform,
        country: String(row.country ?? ''),
        chartType: String(row.chart_type ?? ''),
        appId,
        appName: String(row.app_name ?? '') || meta?.name || appId,
        storeUrl: String(row.store_url ?? '') || meta?.url || undefined,
        reason: String(row.reason ?? '').trim() || undefined,
      });
    }
    stmt.free();
  } catch (e) {
    console.error('Error reading weekly_removed_games from sensortower_top100.db:', e);
  }

  return result;
}

export async function loadSensorTowerTop5Overview(
  getDataUrl?: GetDataUrl
): Promise<SensorTowerTop5OverviewItem[]> {
  const db = await getSensorTowerDatabase(getDataUrl);
  if (!db) return [];

  const result: SensorTowerTop5OverviewItem[] = [];
  try {
    const stmt = db.prepare(
      `SELECT rank_date, statement, trend_json, model_used, created_at
       FROM weekly_top5_overview
       ORDER BY rank_date DESC
       LIMIT ${RANK_WEEKS_LIMIT}`
    );
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      const statement = String(row.statement ?? '').trim();
      const rankDate = String(row.rank_date ?? '').trim();
      if (!rankDate || !statement) continue;
      result.push({
        rankDate,
        statement,
        trendJson: row.trend_json != null ? String(row.trend_json) : undefined,
        modelUsed: row.model_used != null ? String(row.model_used) : undefined,
        createdAt: row.created_at != null ? String(row.created_at) : undefined,
      });
    }
    stmt.free();
  } catch (e) {
    console.error('Error reading weekly_top5_overview from sensortower_top100.db:', e);
  }

  return result;
}
