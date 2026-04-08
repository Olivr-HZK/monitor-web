/**
 * public/休闲游戏检测 目录数据加载
 * - rankings_*.csv → 微信小游戏榜单、抖音小游戏榜单
 * - 新进榜 → 新游戏；排名飙升(变化≥10) → 新玩法；对应玩法 .md 作为详情
 * - 按日期命名的 .md → 周报简要（完整报告，按监控日期命名，放首页/周报简要）
 */

import Papa from 'papaparse';
import type { GameRanking, GameRankingItem, GameRankingType, WechatDouyinRankingsByWeek } from '../types';
import {
  isNewEntrantToTop10,
  parseMinigameSurgeDelta,
} from '../utils/minigameRankChange';
import type { MonitorItem, ReportDocument, CasualGameMainCategory } from '../types';
import type { GamePlatformKey } from '../types';

const REPORTS_BASE = '休闲游戏检测';
const INDEX_FILENAME = '休闲游戏检测/index.json';

export interface ReportsIndex {
  rankings: string[];
  reports: string[];
}

export interface ReportsLoadResult {
  wechatDouyinRankings: GameRanking[];
  /** 按周聚合的微信/抖音三榜单，用于周选择器（多周数据） */
  wechatDouyinRankingsByWeek: WechatDouyinRankingsByWeek[];
  newGameItems: MonitorItem[];
  newPlayItems: MonitorItem[];
  weeklyBriefItems: MonitorItem[];
}

interface ReportsCsvRow {
  平台: string;
  排名: string;
  游戏名称: string;
  游戏类型: string;
  来源: string;
  榜单: string;
  监控日期: string;
  发布时间: string;
  开发公司: string;
  排名变化: string;
  地区: string;
}

type GetDataUrl = (filename: string) => string;

function getFetchOptions(url: string): RequestInit {
  return url.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
}

/** 静态资源 base（Vite base，如 /monitor-web/），保证请求带上前缀 */
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
  const normalized = base.endsWith('/') ? base + path : base + '/' + path;
  return normalized;
}

/** 平台文案 → GameRankingType */
function platformToRankingType(platform: string): GameRankingType | null {
  if (platform === '微信小游戏') return '微信小游戏';
  if (platform === '抖音小游戏') return '抖音小游戏';
  return null;
}

/** 平台文案 → GamePlatformKey */
function platformToPlatformKey(platform: string): GamePlatformKey | null {
  if (platform === '微信小游戏') return '微信';
  if (platform === '抖音小游戏') return '抖音';
  return null;
}

/** 排名变化是否视为「飙升」（新玩法） */
const SURGE_THRESHOLD = 10;

function isNewEntry(change: string): boolean {
  return change?.trim() === '新进榜';
}

function isSurge(change: string): boolean {
  const n = parseInt(change?.trim() || '0', 10);
  return !Number.isNaN(n) && n >= SURGE_THRESHOLD;
}

/** 加载 reports/index.json */
export async function loadReportsIndex(getDataUrl?: GetDataUrl): Promise<ReportsIndex | null> {
  try {
    const url = resolveUrl(getDataUrl, INDEX_FILENAME);
    const res = await fetch(url, getFetchOptions(url));
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.rankings || !Array.isArray(data.rankings)) return null;
    return {
      rankings: data.rankings,
      reports: Array.isArray(data.reports) ? data.reports : [],
    };
  } catch {
    return null;
  }
}

/** 解析单份 rankings CSV，按平台拆成 微信/抖音 两条 GameRanking */
function parseRankingsCsv(text: string, csvId: string): GameRanking[] {
  const rows = Papa.parse<ReportsCsvRow>(text, { header: true, skipEmptyLines: true }).data ?? [];
  const byType = new Map<GameRankingType, GameRankingItem[]>();
  let monitorDate = '';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const platform = row.平台?.trim();
    const type = platform ? platformToRankingType(platform) : null;
    if (!type) continue;

    const rank = parseInt(row.排名?.trim() || '0', 10);
    if (Number.isNaN(rank) || rank <= 0) continue;
    const name = row.游戏名称?.trim() || '';
    if (!name) continue;

    if (!monitorDate && row.监控日期?.trim()) monitorDate = row.监控日期.trim();

    const change = row.排名变化?.trim() || '--';
    const item: GameRankingItem = {
      id: `${csvId}-${type}-${i}-${rank}`,
      rank,
      name,
      change,
      updateDate: row.监控日期?.trim() || '--',
      developer: row.开发公司?.trim() || undefined,
      category: row.游戏类型?.trim() || undefined,
      platformLabel: platform,
    };
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(item);
  }

  const result: GameRanking[] = [];
  const titles: Record<GameRankingType, string> = {
    微信小游戏: '微信小游戏榜单',
    抖音小游戏: '抖音小游戏榜单',
  } as Record<GameRankingType, string>;
  for (const [type, items] of byType) {
    items.sort((a, b) => a.rank - b.rank);
    result.push({
      type,
      title: titles[type] ?? type,
      updateTime: monitorDate ? `${monitorDate} 12:00` : '',
      period: '周榜',
      items,
    });
  }
  return result;
}

/** 加载所有 rankings CSV，合并为微信小游戏榜单 + 抖音小游戏榜单；可选传入已加载的 index 避免重复请求 */
export async function loadWechatDouyinRankings(
  getDataUrl?: GetDataUrl,
  cachedIndex?: ReportsIndex | null
): Promise<GameRanking[]> {
  const index = cachedIndex ?? (await loadReportsIndex(getDataUrl));
  if (!index || index.rankings.length === 0) return [];

  const allWechat: GameRankingItem[] = [];
  const allDouyin: GameRankingItem[] = [];
  let latestDate = '';

  for (const csvName of index.rankings) {
    const path = `${REPORTS_BASE}/${csvName}`;
    const url = resolveUrl(getDataUrl, path);
    try {
      const res = await fetch(url, getFetchOptions(url));
      if (!res.ok) continue;
      const text = await res.text();
      const rankings = parseRankingsCsv(text, csvName.replace(/\.csv$/i, ''));
      for (const r of rankings) {
        if (r.type === '微信小游戏') {
          r.items.forEach((it) => {
            it.id = `wx-${allWechat.length}-${it.rank}-${it.name}`;
            allWechat.push(it);
          });
          if (r.updateTime) latestDate = r.updateTime.split(' ')[0] || latestDate;
        } else if (r.type === '抖音小游戏') {
          r.items.forEach((it) => {
            it.id = `dy-${allDouyin.length}-${it.rank}-${it.name}`;
            allDouyin.push(it);
          });
          if (r.updateTime) latestDate = r.updateTime.split(' ')[0] || latestDate;
        }
      }
    } catch {
      // skip failed file
    }
  }

  const out: GameRanking[] = [];
  const updateTime = latestDate ? `${latestDate} 12:00` : '';
  if (allWechat.length > 0) {
    allWechat.sort((a, b) => a.rank - b.rank);
    out.push({
      type: '微信小游戏',
      title: '微信小游戏榜单',
      updateTime,
      period: '周榜',
      items: allWechat,
    });
  }
  if (allDouyin.length > 0) {
    allDouyin.sort((a, b) => a.rank - b.rank);
    out.push({
      type: '抖音小游戏',
      title: '抖音小游戏榜单',
      updateTime,
      period: '周榜',
      items: allDouyin,
    });
  }
  return out;
}

/** week_range 可能为 "2026-2-2~2026-2-8" 或 "2026-2-2～2026-2-8"，统一按起始日期排序，最新（2026-2-2～2026-2-8）在前 */
const WEEK_RANGE_SEP = /[~～]/;
function parseWeekRangeStart(weekRange: string): string {
  const start = weekRange.split(WEEK_RANGE_SEP)[0]?.trim() ?? '';
  return start || weekRange;
}
/** 解析 week_range 的结束日期（用于「更新时间」显示最新时间） */
function parseWeekRangeEnd(weekRange: string): string {
  const parts = weekRange.split(WEEK_RANGE_SEP);
  const end = parts.length > 1 ? parts[1]?.trim() : parts[0]?.trim();
  return end ?? '';
}
function sortWeekRangesLatestFirst(weekRanges: string[]): string[] {
  return [...weekRanges].sort((a, b) => {
    const startA = parseWeekRangeStart(a);
    const startB = parseWeekRangeStart(b);
    return startB.localeCompare(startA, undefined, { numeric: true });
  });
}

/** 从 wechatdouyin.db 的 top20_ranking、rank_changes 两张表加载三榜单：只从这两张表取 week_range，用这些日期在两张表内做精确匹配（WHERE week_range = ?），不参与任何时间计算。 */
export async function loadWechatDouyinRankingsFromDb(
  getDataUrl?: GetDataUrl
): Promise<WechatDouyinRankingsByWeek[]> {
  const db = await getGameplayDatabase(getDataUrl);
  if (!db) return [];

  /** 取第一列的值（即 week_range），不依赖列名，避免 sql.js 列名大小写导致只读到一周 */
  const getWeekFromRow = (stmt: { getAsObject: () => Record<string, unknown> }): string | null => {
    const row = stmt.getAsObject() as Record<string, unknown>;
    if (!row || typeof row !== 'object') return null;
    const firstKey = Object.keys(row)[0];
    const v = firstKey != null ? row[firstKey] : (row.week_range ?? (row as Record<string, unknown>).WEEK_RANGE);
    const s = typeof v === 'string' ? v.trim() : '';
    return s || null;
  };

  /** 仅从 top20_ranking、rank_changes 两张表取 DISTINCT week_range，得到所有需要匹配的日期 */
  const getAllWeekRanges = (): string[] => {
    const set = new Set<string>();
    try {
      const stmt = db.prepare(
        `SELECT DISTINCT week_range FROM top20_ranking`
      );
      while (stmt.step()) {
        const w = getWeekFromRow(stmt);
        if (w) set.add(w);
      }
      stmt.free();
    } catch {
      // 忽略单表错误，继续从 rank_changes 取
    }
    try {
      const stmt2 = db.prepare(
        `SELECT DISTINCT week_range FROM rank_changes`
      );
      while (stmt2.step()) {
        const w = getWeekFromRow(stmt2);
        if (w) set.add(w);
      }
      stmt2.free();
    } catch {
      // 忽略
    }
    const list = sortWeekRangesLatestFirst(Array.from(set));
    if (typeof console !== 'undefined' && console.info && list.length > 0) {
      console.info('[微信/抖音排行榜] 从 DB 读取到周数:', list.length, '周区间:', list);
    }
    return list;
  };

  const weekRanges = getAllWeekRanges();
  if (weekRanges.length === 0) return [];

  const result: WechatDouyinRankingsByWeek[] = [];

  /** sql.js 列名可能大小写不一，统一从 row 取 rank_change（兼容 rank_change / RANK_CHANGE / 首字母大写等） */
  const getRankChangeFromRow = (row: Record<string, unknown>): string => {
    let v: unknown = row?.rank_change ?? (row as Record<string, unknown>)?.RANK_CHANGE;
    if (v == null || String(v).trim() === '') {
      const key = Object.keys(row || {}).find((k) => k.toLowerCase() === 'rank_change');
      if (key) v = (row as Record<string, unknown>)[key];
    }
    return v != null && String(v).trim() !== '' ? String(v).trim() : '--';
  };

  /** 用同一 week_range 在 top20_ranking、rank_changes 两张表中分别做精确匹配查询 */
  const buildRankingsForWeek = (weekRange: string): GameRanking[] => {
    const rankings: GameRanking[] = [];
    const startPart = parseWeekRangeStart(weekRange);
    const updateTime = startPart ? `${startPart} 12:00` : '';

    try {
      const wxStmt = db.prepare(
        `SELECT rank, game_name, company, rank_change, monitor_date FROM top20_ranking
         WHERE platform_key = 'wx' AND week_range = ? ORDER BY CAST(rank AS INTEGER) ASC`
      );
      wxStmt.bind([weekRange]);
      const wxItems: GameRankingItem[] = [];
      while (wxStmt.step()) {
        const row = wxStmt.getAsObject() as Record<string, unknown>;
        const rank = parseInt(String(row?.rank ?? 0), 10) || wxItems.length + 1;
        wxItems.push({
          id: `wx-db-${weekRange}-${rank}-${row?.game_name ?? ''}`,
          rank,
          name: String(row?.game_name ?? ''),
          developer: row?.company != null ? String(row.company) : undefined,
          change: getRankChangeFromRow(row),
          updateDate: row?.monitor_date != null ? String(row.monitor_date) : '',
        });
      }
      wxStmt.free();
      if (wxItems.length > 0) {
        rankings.push({
          type: '微信小游戏',
          title: '微信小游戏 Top20',
          updateTime,
          period: '周榜',
          items: wxItems,
        });
      }

      const dyStmt = db.prepare(
        `SELECT rank, game_name, company, rank_change, monitor_date FROM top20_ranking
         WHERE platform_key = 'dy' AND week_range = ? ORDER BY CAST(rank AS INTEGER) ASC`
      );
      dyStmt.bind([weekRange]);
      const dyItems: GameRankingItem[] = [];
      while (dyStmt.step()) {
        const row = dyStmt.getAsObject() as Record<string, unknown>;
        const rank = parseInt(String(row?.rank ?? 0), 10) || dyItems.length + 1;
        dyItems.push({
          id: `dy-db-${weekRange}-${rank}-${row?.game_name ?? ''}`,
          rank,
          name: String(row?.game_name ?? ''),
          developer: row?.company != null ? String(row.company) : undefined,
          change: getRankChangeFromRow(row),
          updateDate: row?.monitor_date != null ? String(row.monitor_date) : '',
        });
      }
      dyStmt.free();
      if (dyItems.length > 0) {
        rankings.push({
          type: '抖音小游戏',
          title: '抖音小游戏 Top20',
          updateTime,
          period: '周榜',
          items: dyItems,
        });
      }

      const changeStmt = db.prepare(
        `SELECT rank, game_name, company, rank_change, platform_key, platform, monitor_date FROM rank_changes
         WHERE week_range = ? ORDER BY platform_key, CAST(rank AS INTEGER) ASC`
      );
      changeStmt.bind([weekRange]);
      const changeItems: GameRankingItem[] = [];
      let idx = 0;
      while (changeStmt.step()) {
        const row = changeStmt.getAsObject() as Record<string, unknown>;
        const rank = parseInt(String(row?.rank ?? 0), 10) || idx + 1;
        const platformVal = row?.platform ?? row?.platform_key;
        const platformLabel = platformVal != null ? String(platformVal) : undefined;
        changeItems.push({
          id: `change-db-${weekRange}-${idx}-${rank}-${row?.game_name ?? ''}`,
          rank,
          name: String(row?.game_name ?? ''),
          developer: row?.company != null ? String(row.company) : undefined,
          change: getRankChangeFromRow(row),
          updateDate: row?.monitor_date != null ? String(row.monitor_date) : '',
          platformLabel: platformLabel === 'wx' ? '微信小游戏' : platformLabel === 'dy' ? '抖音小游戏' : platformLabel,
        });
        idx++;
      }
      changeStmt.free();
      if (changeItems.length > 0) {
        rankings.push({
          type: '榜单异动' as GameRankingType,
          title: '榜单异动',
          updateTime,
          period: '周榜',
          items: changeItems,
        });
      }
    } catch {
      // skip this week
    }
    return rankings;
  };

  for (const weekRange of weekRanges) {
    try {
      const rankings = buildRankingsForWeek(weekRange);
      result.push({ weekRange, rankings });
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[微信/抖音排行榜] 该周查询失败，跳过:', weekRange, e);
      }
      result.push({ weekRange, rankings: [] });
    }
  }

  return result;
}

/** 响应内容是否为 HTML（如 SPA  fallback 返回的 index.html），不应当作 Markdown */
function isHtmlResponse(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html');
}

/** 从 MD 内容提取核心玩法描述（优先提取"核心玩法"部分） */
function extractGameplaySummary(mdContent: string): string {
  // 尝试提取"核心玩法"部分
  const gameplayMatch = mdContent.match(/##\s*核心玩法\s*\n\n(.+?)(?=\n##|$)/s);
  if (gameplayMatch && gameplayMatch[1]) {
    const gameplay = gameplayMatch[1].trim();
    // 移除 Markdown 格式，提取纯文本
    const plainText = gameplay
      .replace(/\*\*(.+?)\*\*/g, '$1') // 移除加粗
      .replace(/#{1,6}\s+/g, '') // 移除标题标记
      .replace(/\n+/g, ' ') // 换行变空格
      .trim();
    if (plainText.length > 0) {
      return plainText.length > 200 ? plainText.slice(0, 200) + '...' : plainText;
    }
  }
  // 如果没有找到"核心玩法"，提取前200字符
  const plainText = mdContent
    .replace(/#{1,6}\s+/g, '') // 移除标题
    .replace(/\*\*(.+?)\*\*/g, '$1') // 移除加粗
    .replace(/\n+/g, ' ') // 换行变空格
    .trim();
  return plainText.length > 200 ? plainText.slice(0, 200) + '...' : plainText;
}

/** CSV 中的游戏名与本地数据库 games 表中的 game_name 不一致时的映射 */
const GAME_NAME_TO_DB_ALIAS: Record<string, string> = {
  '找茬婆婆': '婆婆来找茬',
};

let gameplayDbPromise: Promise<any | null> | null = null;

/** 初始化并缓存 wechatdouyin.db（微信/抖音小游戏数据库，含 games / top20_ranking / rank_changes） */
async function getGameplayDatabase(getDataUrl?: GetDataUrl): Promise<any | null> {
  if (!gameplayDbPromise) {
    gameplayDbPromise = (async () => {
      try {
        const sqlJsModule = await import('sql.js');
        const initSqlJs = sqlJsModule.default;
        const SQL = await initSqlJs({
          locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
        });
        const opts = { credentials: 'include' as RequestCredentials };
        let dbPath = getDataUrl ? getDataUrl('wechatdouyin.db') : 'wechatdouyin.db';
        let res = await fetch(dbPath, dbPath.startsWith('/api') ? opts : {});
        if (!res.ok && typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
          dbPath = '/wechatdouyin.db';
          res = await fetch(dbPath);
        }
        if (!res.ok) {
          console.error('[wechatdouyin.db] 请求失败:', dbPath, res.status, res.statusText);
          return null;
        }
        const buffer = await res.arrayBuffer();
        const db = new SQL.Database(new Uint8Array(buffer));
        if (typeof console !== 'undefined' && console.info) {
          console.info('[wechatdouyin.db] 已加载，路径:', dbPath);
        }
        return db;
      } catch (e) {
        console.error('[wechatdouyin.db] 初始化失败:', e);
        return null;
      }
    })();
  }
  return gameplayDbPromise;
}

/** 从可能是 JSON 的字符串中用正则提取字段（JSON.parse 失败时的兜底） */
function extractGameplayFieldsFromRaw(text: string): { mechanism?: string; operation?: string; rules?: string; features?: string; baseline?: string; coreGameplayStr?: string } {
  const result: {
    mechanism?: string;
    operation?: string;
    rules?: string;
    features?: string;
    baseline?: string;
    coreGameplayStr?: string;
  } = {};
  const fieldRegex = /"(mechanism|operation|rules|features|baseline|innovation|summary|core_gameplay|baseline_game)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = fieldRegex.exec(text)) !== null) {
    const key = m[1];
    const value = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    if (!value) continue;
    if (key === 'mechanism') result.mechanism = value;
    else if (key === 'operation') result.operation = value;
    else if (key === 'rules') result.rules = value;
    else if (key === 'features') result.features = value;
    else if (key === 'core_gameplay') result.coreGameplayStr = value;
    else if (key === 'baseline_game' || key === 'baseline' || key === 'innovation' || key === 'summary') result.baseline = (result.baseline ? result.baseline + '\n\n' : '') + value;
  }
  return result;
}

/** 将 gameplay_analysis 中的 JSON 转为统一 Markdown
 * 数据库中存在两种格式：
 * 格式A：core_gameplay 为对象 { mechanism, operation, rules, features }，可有 baseline_and_innovation、attraction
 * 格式B：core_gameplay 为字符串，baseline_game 字符串，innovation_points 字符串数组
 */
function formatGameplayJsonToMarkdown(rawText: string): string | null {
  if (!rawText) return null;

  let text = rawText.trim();
  if (text.startsWith('```')) {
    const firstNewline = text.indexOf('\n');
    if (firstNewline !== -1) {
      text = text.slice(firstNewline + 1);
      const lastFence = text.lastIndexOf('```');
      if (lastFence !== -1) text = text.slice(0, lastFence);
    }
    text = text.trim();
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    const fallback = extractGameplayFieldsFromRaw(text);
    const parts: string[] = [];
    if (fallback.mechanism || fallback.coreGameplayStr) {
      parts.push('## 核心玩法', '');
      if (fallback.mechanism) parts.push(fallback.mechanism, '');
      else if (fallback.coreGameplayStr) parts.push(fallback.coreGameplayStr, '');
      if (fallback.operation) parts.push(`**操作方式**：${fallback.operation}`);
      if (fallback.rules) parts.push(`**规则**：${fallback.rules}`);
      if (fallback.features) parts.push(`**玩法特性**：${fallback.features}`);
    }
    if (fallback.baseline) {
      if (parts.length) parts.push('');
      parts.push('## 基线与创新点', '', fallback.baseline);
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }

  const parts: string[] = [];
  const core = data.core_gameplay;

  // 格式A：core_gameplay 为对象
  if (core && typeof core === 'object' && !Array.isArray(core)) {
    if (core.mechanism || core.operation || core.rules || core.features) {
      parts.push('## 核心玩法', '');
      if (typeof core.mechanism === 'string' && core.mechanism.trim()) parts.push(core.mechanism.trim(), '');
      if (typeof core.operation === 'string' && core.operation.trim()) parts.push(`**操作方式**：${core.operation.trim()}`);
      if (typeof core.rules === 'string' && core.rules.trim()) parts.push(`**规则**：${core.rules.trim()}`);
      if (typeof core.features === 'string' && core.features.trim()) parts.push(`**玩法特性**：${core.features.trim()}`);
    }
  }
  // 格式B：core_gameplay 为字符串
  else if (typeof core === 'string' && core.trim()) {
    parts.push('## 核心玩法', '', core.trim(), '');
  }

  // 格式B：基线品类
  const baselineGame = data.baseline_game;
  if (typeof baselineGame === 'string' && baselineGame.trim()) {
    if (parts.length) parts.push('');
    parts.push('## 基线品类', '', baselineGame.trim(), '');
  }

  // 格式B：创新点（数组）
  const innovationPoints = data.innovation_points;
  if (Array.isArray(innovationPoints) && innovationPoints.length > 0) {
    const strs = innovationPoints.filter((s: unknown) => typeof s === 'string' && (s as string).trim()).map((s: string) => (s as string).trim());
    if (strs.length > 0) {
      if (parts.length) parts.push('');
      parts.push('## 创新点', '');
      strs.forEach((s) => parts.push(`- ${s}`));
      parts.push('');
    }
  }

  // 格式A：baseline_and_innovation 对象内字符串
  const baselineObj = data.baseline_and_innovation ?? {};
  if (typeof baselineObj === 'object' && baselineObj !== null && !Array.isArray(baselineObj)) {
    const baselineStrings: string[] = [];
    const knownKeys = ['baseline', 'innovation', 'innovations', 'summary', 'highlights'];
    for (const key of knownKeys) {
      const v = baselineObj[key];
      if (typeof v === 'string' && v.trim()) baselineStrings.push(v.trim());
    }
    for (const [k, v] of Object.entries(baselineObj)) {
      if (knownKeys.includes(k)) continue;
      if (typeof v === 'string' && (v as string).trim()) baselineStrings.push((v as string).trim());
    }
    if (baselineStrings.length > 0) {
      if (parts.length) parts.push('');
      parts.push('## 基线与创新点', '');
      baselineStrings.forEach((s) => parts.push(s, ''));
    }
  }

  // 格式A：吸引力/目标用户/留存（可选）
  const attraction = data.attraction;
  if (attraction && typeof attraction === 'object' && !Array.isArray(attraction)) {
    const lines: string[] = [];
    if (typeof attraction.points === 'string' && attraction.points.trim()) lines.push(attraction.points.trim());
    if (typeof attraction.target_audience === 'string' && attraction.target_audience.trim()) lines.push(`**目标用户**：${attraction.target_audience.trim()}`);
    if (typeof attraction.retention_factors === 'string' && attraction.retention_factors.trim()) lines.push(`**留存因素**：${attraction.retention_factors.trim()}`);
    if (lines.length > 0) {
      if (parts.length) parts.push('');
      parts.push('## 吸引力与留存', '');
      parts.push(...lines);
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/** 从本地 wechatdouyin.db 的 games 表中读取玩法说明（gameplay_analysis），并将 JSON 转为 Markdown 文本 */
async function loadGameplayContent(getDataUrl: GetDataUrl | undefined, gameName: string): Promise<string | null> {
  const db = await getGameplayDatabase(getDataUrl);
  if (!db) return null;

  const namesToTry = [gameName];
  if (GAME_NAME_TO_DB_ALIAS[gameName]) {
    namesToTry.push(GAME_NAME_TO_DB_ALIAS[gameName]);
  }

  for (const name of namesToTry) {
    try {
      const stmt = db.prepare('SELECT gameplay_analysis FROM games WHERE game_name = ? LIMIT 1');
      stmt.bind([name]);
      if (stmt.step()) {
        const row: any = stmt.getAsObject();
        // sql.js 列名可能为小写，兼容 gameplay_analysis / GAMEPLAY_ANALYSIS
        const raw = row.gameplay_analysis ?? row.GAMEPLAY_ANALYSIS ?? '';
        const text = String(raw).trim();
        stmt.free();
        if (text) {
          const formatted = formatGameplayJsonToMarkdown(text);
          // 避免把原始 JSON 当正文展示：若解析失败且内容像 JSON，返回提示而非原文
          if (formatted) return formatted;
          if (/^\s*```|"core_gameplay"|"mechanism"\s*:/.test(text)) {
            return '（玩法说明解析失败，请稍后重试或联系管理员检查数据格式。）';
          }
          return text;
        }
      } else {
        stmt.free();
      }
    } catch (e) {
      console.warn(`Error querying gameplay_analysis from wechatdouyin.db for "${name}":`, e);
    }
  }

  console.warn(`No gameplay_analysis found in wechatdouyin.db for "${gameName}" (including aliases).`);
  return null;
}

/** 按游戏名加载玩法解析（供玩法详情页等调用）。getDataUrl 与 loadReportsData 一致（已登录或静态模式时传入）。 */
export async function loadGameplayByGameName(
  getDataUrl: GetDataUrl | undefined,
  gameName: string
): Promise<string | null> {
  return loadGameplayContent(getDataUrl, gameName);
}

/** 从 CSV 行生成新游戏/新玩法 MonitorItem，并拉取对应玩法 md */
async function buildItemsFromCsv(
  getDataUrl: GetDataUrl | undefined,
  csvText: string,
  category: CasualGameMainCategory,
  csvId: string
): Promise<MonitorItem[]> {
  const rows = Papa.parse<ReportsCsvRow>(csvText, { header: true, skipEmptyLines: true }).data ?? [];
  const items: MonitorItem[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const change = row.排名变化?.trim() || '';
    const isNew = category === '新游戏' && isNewEntry(change);
    const isSurgePlay = category === '新玩法' && isSurge(change);
    if (!isNew && !isSurgePlay) continue;

    const name = row.游戏名称?.trim() || '';
    if (!name) continue;
    const platform = row.平台?.trim() || '';
    const platformKey = platformToPlatformKey(platform);
    const monitorDate = row.监控日期?.trim() || '';

    const mdContent = await loadGameplayContent(getDataUrl, name);
    const summary = mdContent ? extractGameplaySummary(mdContent) : `${name} - ${platform}`;
    const doc: ReportDocument = {
      title: name,
      tags: [platform, category, '玩法'],
      date: monitorDate,
      source: row.来源?.trim() || '引力引擎',
      summary: summary,
      content: mdContent || `# ${name}\n\n（暂无玩法说明）`,
    };
    const item: MonitorItem = {
      id: `reports-${category}-${csvId}-${i}-${name}`,
      type: '休闲游戏监测',
      casualGameCategory: category,
      casualGameSource: 'wechat_douyin',
      title: name,
      source: row.来源?.trim() || '引力引擎',
      platform: platformKey ?? platform,
      date: monitorDate ? monitorDate.slice(5).replace(/-/, '-') : '',
      time: '12:00',
      views: 0,
      engagement: 0,
      description: summary,
      tags: doc.tags ?? [],
      language: '中文',
      reportContent: JSON.stringify(doc),
    };
    items.push(item);
  }
  return items;
}

/** 加载新游戏、新玩法列表（玩法 md 分别挂在对应项下）；可选传入已加载的 index 避免重复请求 */
export async function loadNewGamesAndNewPlay(
  getDataUrl?: GetDataUrl,
  cachedIndex?: ReportsIndex | null
): Promise<{ newGameItems: MonitorItem[]; newPlayItems: MonitorItem[] }> {
  const index = cachedIndex ?? (await loadReportsIndex(getDataUrl));
  if (!index) return { newGameItems: [], newPlayItems: [] };

  const newGameItems: MonitorItem[] = [];
  const newPlayItems: MonitorItem[] = [];

  for (const csvName of index.rankings) {
    const path = `${REPORTS_BASE}/${csvName}`;
    const url = resolveUrl(getDataUrl, path);
    try {
      const res = await fetch(url, getFetchOptions(url));
      if (!res.ok) continue;
      const text = await res.text();
      const csvId = csvName.replace(/\.csv$/i, '');
      const [newGames, newPlays] = await Promise.all([
        buildItemsFromCsv(getDataUrl, text, '新游戏', csvId),
        buildItemsFromCsv(getDataUrl, text, '新玩法', csvId),
      ]);
      newGameItems.push(...newGames);
      newPlayItems.push(...newPlays);
    } catch {
      // skip
    }
  }
  return { newGameItems, newPlayItems };
}

/** 从完整报告 md 提取监控日期 */
function extractMonitorDate(md: string): string {
  const m = md.match(/\*\*监控日期\*\*[：:]\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

const WEEKLY_BRIEF_PLATFORM_LABEL: Record<string, string> = {
  wx: '微信小游戏',
  dy: '抖音小游戏',
  微信: '微信小游戏',
  抖音: '抖音小游戏',
};

/** 根据排名变化文案计算异动类型（与 SensorTower 一致：上升>20 为飙升，1~20 为上升，新进榜/下降单独） */
function getChangeTypeFromRankChange(rankChange: string): string {
  const raw = (rankChange || '').trim();
  if (raw.includes('新进榜')) return '🆕 新进榜';
  if (raw.includes('↓')) return '📉 排名下降';
  if (raw.includes('↑')) {
    const n = parseInt(raw.replace(/[^\d]/g, ''), 10);
    if (!Number.isNaN(n) && n > 0) return n > 20 ? '🚀 排名飙升' : '📈 排名上升';
  }
  return '—';
}

/** 从 wechatdouyin.db 的 rank_changes 表按周生成周报简要（仅微信+抖音，仅使用 rank_changes 表） */
export async function loadWeeklyBriefFromDb(getDataUrl?: GetDataUrl): Promise<MonitorItem[]> {
  const db = await getGameplayDatabase(getDataUrl);
  if (!db) return [];

  const rows: {
    week_range: string;
    platform_key: string;
    game_name: string;
    rank: string;
    rank_change: string;
    company: string;
  }[] = [];
  try {
    const stmt = db.prepare(
      `SELECT week_range, platform_key, game_name, rank, rank_change, company
       FROM rank_changes 
       WHERE platform_key IN ('wx','dy') 
       ORDER BY week_range DESC, platform_key, CAST(rank AS INTEGER)`
    );
    while (stmt.step()) {
      const row: any = stmt.getAsObject();
      const rankChangeRaw = row.rank_change ?? row.RANK_CHANGE;
      rows.push({
        week_range: String(row.week_range ?? ''),
        platform_key: String(row.platform_key ?? ''),
        game_name: String(row.game_name ?? ''),
        rank: String(row.rank ?? ''),
        rank_change: rankChangeRaw != null && String(rankChangeRaw).trim() !== '' ? String(rankChangeRaw).trim() : '',
        company: String(row.company ?? ''),
      });
    }
    stmt.free();
  } catch (e) {
    console.warn('loadWeeklyBriefFromDb query failed:', e);
    return [];
  }

  const byWeek = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.week_range) continue;
    if (!byWeek.has(r.week_range)) byWeek.set(r.week_range, []);
    byWeek.get(r.week_range)!.push(r);
  }

  const items: MonitorItem[] = [];

  for (const [weekRange, weekRows] of byWeek) {
    const lines: string[] = [];
    lines.push(`**监控时间**：${weekRange}`);
    lines.push('');

    const parseRankNum = (s: string): number | null => {
      const n = parseInt(String(s || '').trim(), 10);
      return Number.isNaN(n) ? null : n;
    };

    const newTop10Rows = weekRows.filter((r) => {
      const rk = parseRankNum(r.rank);
      if (rk === null) return false;
      return isNewEntrantToTop10(rk, r.rank_change);
    });
    const sortedNewTop10 = [...newTop10Rows].sort((a, b) => {
      const pa = a.platform_key === 'wx' ? 0 : 1;
      const pb = b.platform_key === 'wx' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (parseRankNum(a.rank) ?? 0) - (parseRankNum(b.rank) ?? 0);
    });

    const newTopKeysBrief = new Set(
      sortedNewTop10.map((r) => `${r.platform_key}\t${(r.game_name || '').trim()}`)
    );
    const surgeRows = [...weekRows]
      .map((r) => ({ r, delta: parseMinigameSurgeDelta(r.rank_change) }))
      .filter((x) => x.delta > 0)
      .filter((x) => !newTopKeysBrief.has(`${x.r.platform_key}\t${(x.r.game_name || '').trim()}`))
      .sort((a, b) => {
        if (b.delta !== a.delta) return b.delta - a.delta;
        return (parseRankNum(a.r.rank) ?? 999) - (parseRankNum(b.r.rank) ?? 999);
      })
      .slice(0, 10)
      .map((x) => x.r);

    lines.push('## 一、新进 Top10（本周进入 Top10，上周不在 Top10）');
    lines.push('');
    if (sortedNewTop10.length > 0) {
      lines.push('| 排名 | 游戏名 | 平台 | 开发公司 | 排名变化 | 异动类型 |');
      lines.push('|------|--------|------|----------|----------|----------|');
      sortedNewTop10.forEach((r) => {
        const rank = (r.rank || '').trim() || '—';
        const platformLabel = WEEKLY_BRIEF_PLATFORM_LABEL[r.platform_key] || r.platform_key;
        const name = (r.game_name || '').trim() || '—';
        const company = (r.company || '').trim() || '—';
        const change = (r.rank_change || '').trim() || '—';
        const changeType = getChangeTypeFromRankChange(r.rank_change || '');
        lines.push(`| ${rank} | ${name} | ${platformLabel} | ${company} | ${change} | ${changeType} |`);
      });
      lines.push('');
    } else {
      lines.push('本周暂无「本周进入 Top10、上周不在 Top10」的记录。');
      lines.push('');
    }

    lines.push('## 二、本周排名飙升 Top10');
    lines.push('');
    if (surgeRows.length > 0) {
      lines.push('| 当前排名 | 游戏名 | 平台 | 开发公司 | 排名变化 | 异动类型 |');
      lines.push('|----------|--------|------|----------|----------|----------|');
      surgeRows.forEach((r) => {
        const rank = (r.rank || '').trim() || '—';
        const platformLabel = WEEKLY_BRIEF_PLATFORM_LABEL[r.platform_key] || r.platform_key;
        const name = (r.game_name || '').trim() || '—';
        const company = (r.company || '').trim() || '—';
        const change = (r.rank_change || '').trim() || '—';
        const changeType = getChangeTypeFromRankChange(r.rank_change || '');
        lines.push(`| ${rank} | ${name} | ${platformLabel} | ${company} | ${change} | ${changeType} |`);
      });
      lines.push('');
    } else {
      lines.push('本周暂无排名飙升（↑）记录。');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('详细玩法请登录 [游戏监测网站](https://sites.google.com/castbox.fm/overwatch2/home?authuser=1) 查看。');

    const content = lines.join('\n');
    const doc: ReportDocument = {
      title: `周报简要 ${weekRange}`,
      tags: ['周报简要', '休闲游戏', '微信小游戏', '抖音小游戏'],
      date: weekRange.split('~')[0]?.replace(/-/g, '-') ?? weekRange,
      source: '引力引擎',
      summary: `监控时间 ${weekRange}，新进 Top10 ${sortedNewTop10.length} 款，飙升 Top10 ${surgeRows.length} 款。详细玩法请登录游戏监测网站查看。`,
      content,
    };
    const dateStr = doc.date ?? '';
    items.push({
      id: `reports-weekly-db-${weekRange}`,
      type: '休闲游戏监测',
      casualGameCategory: '周报简要',
      casualGameSource: 'wechat_douyin',
      title: doc.title,
      source: doc.source ?? '引力引擎',
      platform: '周报',
      date: dateStr.length >= 10 ? dateStr.slice(5) : dateStr,
      time: '12:00',
      views: 0,
      engagement: 0,
      description: doc.summary ?? doc.title,
      tags: doc.tags ?? [],
      language: '中文',
      reportContent: JSON.stringify(doc),
    });
  }
  return items;
}

/** 加载按监控日期命名的完整报告（周报简要）；可选传入已加载的 index 避免重复请求 */
export async function loadFullReportsByDate(
  getDataUrl?: GetDataUrl,
  cachedIndex?: ReportsIndex | null
): Promise<MonitorItem[]> {
  const index = cachedIndex ?? (await loadReportsIndex(getDataUrl));
  if (!index || !index.reports.length) return [];

  const items: MonitorItem[] = [];
  for (const reportName of index.reports) {
    const path = `${REPORTS_BASE}/${reportName}`;
    const url = resolveUrl(getDataUrl, path);
    try {
      const res = await fetch(url, getFetchOptions(url));
      if (!res.ok) continue;
      const content = await res.text();
      if (isHtmlResponse(content)) continue;
      const monitorDate = extractMonitorDate(content) || reportName.replace(/\.md$/i, '');
      const doc: ReportDocument = {
        title: `周报简要 ${monitorDate}`,
        tags: ['周报简要', '休闲游戏', '微信小游戏', '抖音小游戏'],
        date: monitorDate,
        source: '引力引擎',
        summary: content.slice(0, 300).replace(/\n+/g, ' ').trim() + (content.length > 300 ? '...' : ''),
        content,
      };
      items.push({
        id: `reports-weekly-${monitorDate}`,
        type: '休闲游戏监测',
        casualGameCategory: '周报简要',
        casualGameSource: 'wechat_douyin',
        title: doc.title,
        source: doc.source ?? '引力引擎',
        platform: '周报',
        date: monitorDate.slice(5),
        time: '12:00',
        views: 0,
        engagement: 0,
        description: doc.summary ?? doc.title,
        tags: doc.tags ?? [],
        language: '中文',
        reportContent: JSON.stringify(doc),
      });
    } catch {
      // skip
    }
  }
  return items;
}

/** 将多周数据合并为一份榜单（与 SensorTower 一致：全部展示，每项带 weekRange 便于筛选） */
function mergeWechatDouyinRankingsAllWeeks(byWeek: WechatDouyinRankingsByWeek[]): GameRanking[] {
  const byType = new Map<GameRankingType, GameRankingItem[]>();
  for (const { weekRange, rankings } of byWeek) {
    for (const r of rankings) {
      const items = r.items.map((it) => ({ ...it, weekRange }));
      const existing = byType.get(r.type) ?? [];
      byType.set(r.type, [...existing, ...items]);
    }
  }
  const result: GameRanking[] = [];
  const order: GameRankingType[] = ['微信小游戏', '抖音小游戏', '榜单异动'];
  const titles: Record<string, string> = {
    微信小游戏: '微信小游戏 Top20',
    抖音小游戏: '抖音小游戏 Top20',
    榜单异动: '榜单异动',
  };
  const latestWeekRange = byWeek[0]?.weekRange ?? '';
  const updateTimeEnd = parseWeekRangeEnd(latestWeekRange);
  const updateTime = updateTimeEnd ? `${updateTimeEnd} 12:00` : '';

  for (const type of order) {
    const items = byType.get(type);
    if (items && items.length > 0) {
      result.push({
        type,
        title: titles[type] ?? type,
        updateTime,
        period: '周榜',
        items,
      });
    }
  }
  return result;
}

/** 一次性加载 reports 全部数据；微信/抖音三榜单优先从 wechatdouyin.db 加载多周并合并为一份展示（与 SensorTower 一致），否则回退 CSV */
export async function loadReportsData(getDataUrl?: GetDataUrl): Promise<ReportsLoadResult> {
  const index = await loadReportsIndex(getDataUrl);
  const [wechatDouyinByWeek, { newGameItems, newPlayItems }, weeklyBriefFromDb, weeklyBriefFromFiles] =
    await Promise.all([
      loadWechatDouyinRankingsFromDb(getDataUrl),
      loadNewGamesAndNewPlay(getDataUrl, index),
      loadWeeklyBriefFromDb(getDataUrl),
      loadFullReportsByDate(getDataUrl, index),
    ]);
  let wechatDouyinRankings: GameRanking[];
  let wechatDouyinRankingsByWeek: WechatDouyinRankingsByWeek[];
  if (wechatDouyinByWeek.length > 0) {
    wechatDouyinRankingsByWeek = wechatDouyinByWeek;
    wechatDouyinRankings = mergeWechatDouyinRankingsAllWeeks(wechatDouyinByWeek);
  } else {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[微信/抖音排行榜] wechatdouyin.db 未返回多周数据，使用 CSV 回退。请确认 public/wechatdouyin.db 可访问且含 top20_ranking、rank_changes 表。');
    }
    const csvRankings = await loadWechatDouyinRankings(getDataUrl, index);
    wechatDouyinRankings = csvRankings;
    wechatDouyinRankingsByWeek = csvRankings.length > 0 ? [{ weekRange: '当前', rankings: csvRankings }] : [];
  }
  const weeklyBriefItems = [...weeklyBriefFromDb, ...weeklyBriefFromFiles];
  return {
    wechatDouyinRankings,
    wechatDouyinRankingsByWeek,
    newGameItems,
    newPlayItems,
    weeklyBriefItems,
  };
}
