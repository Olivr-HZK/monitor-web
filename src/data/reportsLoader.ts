/**
 * public/休闲游戏检测 目录数据加载
 * - rankings_*.csv → 微信小游戏榜单、抖音小游戏榜单
 * - 新进榜 → 新游戏；排名飙升(变化≥10) → 新玩法；对应玩法 .md 作为详情
 * - 按日期命名的 .md → 周报简要（完整报告，按监控日期命名，放首页/周报简要）
 */

import Papa from 'papaparse';
import type { GameRanking, GameRankingItem, GameRankingType } from '../types';
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

/** 加载所有 rankings CSV，合并为微信小游戏榜单 + 抖音小游戏榜单 */
export async function loadWechatDouyinRankings(getDataUrl?: GetDataUrl): Promise<GameRanking[]> {
  const index = await loadReportsIndex(getDataUrl);
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

/** 初始化并缓存 videos.db（本地玩法与素材数据库） */
async function getGameplayDatabase(getDataUrl?: GetDataUrl): Promise<any | null> {
  if (!gameplayDbPromise) {
    gameplayDbPromise = (async () => {
      try {
        const sqlJsModule = await import('sql.js');
        const initSqlJs = sqlJsModule.default;
        const SQL = await initSqlJs({
          locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
        });
        const dbPath = getDataUrl ? getDataUrl('videos.db') : 'videos.db';
        const opts = dbPath.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
        const res = await fetch(dbPath, opts);
        if (!res.ok) {
          console.error('Failed to fetch videos.db:', res.status, res.statusText);
          return null;
        }
        const buffer = await res.arrayBuffer();
        return new SQL.Database(new Uint8Array(buffer));
      } catch (e) {
        console.error('Error initializing videos.db with sql.js:', e);
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

/** 从本地 videos.db 的 games 表中读取玩法说明（gameplay_analysis），并将 JSON 转为 Markdown 文本 */
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
      console.warn(`Error querying gameplay_analysis from videos.db for "${name}":`, e);
    }
  }

  console.warn(`No gameplay_analysis found in videos.db for "${gameName}" (including aliases).`);
  return null;
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
      type: '休闲游戏检测',
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

/** 加载新游戏、新玩法列表（玩法 md 分别挂在对应项下） */
export async function loadNewGamesAndNewPlay(getDataUrl?: GetDataUrl): Promise<{
  newGameItems: MonitorItem[];
  newPlayItems: MonitorItem[];
}> {
  const index = await loadReportsIndex(getDataUrl);
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

/** 从 videos.db 的 weekly_report_simple 表读取 wx/dy 数据，按周生成周报（带监控时间），仅微信+抖音 */
export async function loadWeeklyBriefFromDb(getDataUrl?: GetDataUrl): Promise<MonitorItem[]> {
  const db = await getGameplayDatabase(getDataUrl);
  if (!db) return [];

  const rows: { week_range: string; platform: string; game_name: string; change_type: string; rank: string; rank_change: string }[] = [];
  try {
    const stmt = db.prepare(
      `SELECT week_range, platform, game_name, change_type, rank, rank_change 
       FROM weekly_report_simple 
       WHERE platform IN ('wx','dy') 
       ORDER BY week_range DESC, platform, change_type, CAST(rank AS INTEGER)`
    );
    while (stmt.step()) {
      const row: any = stmt.getAsObject();
      rows.push({
        week_range: String(row.week_range ?? ''),
        platform: String(row.platform ?? ''),
        game_name: String(row.game_name ?? ''),
        change_type: String(row.change_type ?? ''),
        rank: String(row.rank ?? ''),
        rank_change: String(row.rank_change ?? ''),
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
    const newIn = weekRows.filter((r) => r.change_type === '新进榜');
    const surge = weekRows.filter((r) => r.change_type === '飙升');
    const lines: string[] = [];
    lines.push(`**监控时间**：${weekRange}`);
    lines.push('');
    if (newIn.length > 0) {
      lines.push('## 本周新进榜');
      lines.push('');
      newIn.forEach((r) => {
        const platformLabel = WEEKLY_BRIEF_PLATFORM_LABEL[r.platform] || r.platform;
        lines.push(`- **${r.game_name}**（${platformLabel}）`);
      });
      lines.push('');
    }
    if (surge.length > 0) {
      lines.push('## 本周排名飙升');
      lines.push('');
      surge.forEach((r) => {
        const platformLabel = WEEKLY_BRIEF_PLATFORM_LABEL[r.platform] || r.platform;
        lines.push(`- **${r.game_name}**（${platformLabel}，排名变化 ${r.rank_change}）`);
      });
      lines.push('');
    }
    if (newIn.length === 0 && surge.length === 0) {
      lines.push('该周暂无新进榜或排名飙升记录。');
      lines.push('');
    }
    lines.push('---');
    lines.push('');
    lines.push('详细玩法请登录 [监测汇总平台](https://olivr-hzk.github.io/monitor-web/) 查看。');

    const content = lines.join('\n');
    const doc: ReportDocument = {
      title: `周报简要 ${weekRange}`,
      tags: ['周报简要', '休闲游戏', '微信小游戏', '抖音小游戏'],
      date: weekRange.split('~')[0]?.replace(/-/g, '-') ?? weekRange,
      source: '引力引擎',
      summary: `监控时间 ${weekRange}，新进榜 ${newIn.length} 款，飙升 ${surge.length} 款。详细玩法请登录监测汇总平台查看。`,
      content,
    };
    const dateStr = doc.date ?? '';
    items.push({
      id: `reports-weekly-db-${weekRange}`,
      type: '休闲游戏检测',
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

/** 加载按监控日期命名的完整报告（周报简要），放在首页/周报简要（仅微信/抖音来源，标记 wechat_douyin） */
export async function loadFullReportsByDate(getDataUrl?: GetDataUrl): Promise<MonitorItem[]> {
  const index = await loadReportsIndex(getDataUrl);
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
        type: '休闲游戏检测',
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

/** 一次性加载 reports 全部数据；周报仅来自数据库 weekly_report_simple（wx+dy），与 SensorTower 隔离 */
export async function loadReportsData(getDataUrl?: GetDataUrl): Promise<ReportsLoadResult> {
  const [wechatDouyinRankings, { newGameItems, newPlayItems }, weeklyBriefFromDb, weeklyBriefFromFiles] =
    await Promise.all([
      loadWechatDouyinRankings(getDataUrl),
      loadNewGamesAndNewPlay(getDataUrl),
      loadWeeklyBriefFromDb(getDataUrl),
      loadFullReportsByDate(getDataUrl),
    ]);
  const weeklyBriefItems = [...weeklyBriefFromDb, ...weeklyBriefFromFiles];
  return {
    wechatDouyinRankings,
    newGameItems,
    newPlayItems,
    weeklyBriefItems,
  };
}
