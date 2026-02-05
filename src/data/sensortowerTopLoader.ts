import type { SensorTowerTopItem, SensorTowerRankChangeItem } from '../types';

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

/** 从 app_metadata 表加载 Map，用于按 app_id + platform 补全名称、发行商、发行日期 */
function loadAppMetadataMap(db: any): Map<string, { name: string; publisher_name: string; release_date: string }> {
  const map = new Map<string, { name: string; publisher_name: string; release_date: string }>();
  try {
    const stmt = db.prepare(
      `SELECT app_id, os, name, publisher_name, release_date FROM app_metadata`
    );
    while (stmt.step()) {
      const row: any = stmt.getAsObject();
      const os = String(row.os || '').toLowerCase();
      const key = `${row.app_id}|${os}`;
      map.set(key, {
        name: String(row.name ?? ''),
        publisher_name: String(row.publisher_name ?? ''),
        release_date: String(row.release_date ?? ''),
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

/** 从 sensortower_top100.db 读取 iOS / Android Top100 榜单，并关联 app_metadata 补全游戏名、开发公司、发行日期 */
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
      const stmt = db.prepare(
        `SELECT rank_date, country, chart_type, rank, app_id FROM ${name} ORDER BY rank_date DESC, country, chart_type, rank ASC`
      );
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
          publisherName: meta?.publisher_name || undefined,
          releaseDate: meta?.release_date ? formatReleaseDate(meta.release_date) : undefined,
        });
      }
      stmt.free();
    } catch (e) {
      console.error(`Error reading table ${name} from sensortower_top100.db:`, e);
    }
  }

  return result;
}

/** 从 sensortower_top100.db 读取异动榜单 rank_changes，并关联 app_metadata */
export async function loadSensorTowerRankChanges(getDataUrl?: GetDataUrl): Promise<SensorTowerRankChangeItem[]> {
  const db = await getSensorTowerDatabase(getDataUrl);
  if (!db) return [];

  const metaMap = loadAppMetadataMap(db);
  const result: SensorTowerRankChangeItem[] = [];

  try {
    const stmt = db.prepare(
      `SELECT rank_date_current, rank_date_last, signal, app_name, app_id, country, platform, current_rank, last_week_rank, "change", change_type, downloads, revenue, publisher_name FROM rank_changes ORDER BY rank_date_current DESC, country, platform, current_rank ASC`
    );
    while (stmt.step()) {
      const row: any = stmt.getAsObject();
      const appId = String(row.app_id ?? '');
      const platformRaw = String(row.platform ?? '').toUpperCase();
      const platform: 'iOS' | 'Android' = platformRaw === 'ANDROID' ? 'Android' : 'iOS';
      const key = metadataKey(appId, platform);
      const meta = metaMap.get(key);
      result.push({
        id: `rc-${row.rank_date_current}-${row.country}-${platform}-${row.current_rank}-${appId}`,
        rankDateCurrent: String(row.rank_date_current),
        rankDateLast: String(row.rank_date_last),
        signal: String(row.signal ?? ''),
        appName: String(row.app_name ?? ''),
        appId,
        country: String(row.country ?? ''),
        platform,
        currentRank: Number(row.current_rank) || 0,
        lastWeekRank: String(row.last_week_rank ?? ''),
        change: String(row['change'] ?? row.change ?? ''),
        changeType: String(row.change_type ?? ''),
        metadataAppName: meta?.name || undefined,
        publisherName: (row.publisher_name != null && String(row.publisher_name).trim() !== '')
          ? String(row.publisher_name)
          : (meta?.publisher_name || undefined),
        releaseDate: meta?.release_date ? formatReleaseDate(meta.release_date) : undefined,
        downloads: row.downloads != null ? Number(row.downloads) : undefined,
        revenue: row.revenue != null ? Number(row.revenue) : undefined,
      });
    }
    stmt.free();
  } catch (e) {
    console.error('Error reading rank_changes from sensortower_top100.db:', e);
  }

  return result;
}

