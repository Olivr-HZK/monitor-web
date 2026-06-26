#!/usr/bin/env node
/**
 * 从 2025-12-29（周一，可自行修改 START_DATE）到今天，
 * 每个周一抓取 iOS / Android Casual 品类在指定国家的 Top100 榜单，
 * 写入本地 SQLite 数据库：sensortower_top100.db
 *
 * - iOS:  category = 7003, chart_type ∈ { topfreeapplications, topgrossingapplications }
 * - Android: category = game_casual, chart_type ∈ { topselling_free, topgrossing }
 * - 国家：US, JP, GB, DE, IN
 *
 * 注意：
 * - 不再获取应用名称（已优化，应用名称从 app_metadata 更新）
 * - app_name 字段会先设置为 app_id，稍后通过 update_app_names_from_metadata.js 更新
 *
 * 依赖：
 * - Node 内置模块（fs/path/https/child_process），无需 npm 安装额外包
 * - 系统需安装 sqlite3 命令行工具（macOS 默认自带）
 *
 * 运行：
 *   1. 在项目根目录配置 .env，包含：SENSORTOWER_API_TOKEN=你的token
 *   2. node fetch_top100_to_db.js
 *        → 从 START_DATE 到今天的每个周一都抓取
 *   node fetch_top100_to_db.js 2026-02-02
 *        → 只抓取指定「本周一」及「上周一」对应周的周日榜单（API 用周日，库中 rank_date 存周一）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// 榜单接口：与中国区脚本一致
const BASE_URL = 'https://api.sensortower-china.com/v1';
// 应用名称接口：与 market_monitor_v1.6.js 一致，使用国际 API（/category/category_history）
const BASE_URL_NAMES = 'https://api.sensortower.com/v1';

// 国家、品类、榜单配置，参考 market_monitor_v1.6.js
const COUNTRIES = ['US', 'JP', 'GB', 'DE', 'IN'];

const CATEGORY_IOS = '7003';
const CHART_TYPES_IOS = ['topfreeapplications', 'topgrossingapplications'];

const CATEGORY_ANDROID = 'game_casual';
const CHART_TYPES_ANDROID = ['topselling_free', 'topgrossing'];

const DB_FILE = process.env.SENSORTOWER_DB_FILE ? (require('path').isAbsolute(process.env.SENSORTOWER_DB_FILE) ? process.env.SENSORTOWER_DB_FILE : path.join(__dirname, '..', process.env.SENSORTOWER_DB_FILE)) : path.join(__dirname, '..', 'data', 'sensortower_top100.db');

// 批量获取应用名称时每批数量（与原脚本一致）
const APP_NAMES_BATCH_SIZE = 30;
const DELAY_MS = 400;

// 起始日期：你说的 12.29，这里默认 2025-12-29，可按需改成其它年份
const START_DATE = new Date('2025-12-29');

// 与原脚本一致：国家/榜单展示名（符号+中文）
const COUNTRY_DISPLAY = { US: '🇺🇸 美国', JP: '🇯🇵 日本', GB: '🇬🇧 英国', DE: '🇩🇪 德国', IN: '🇮🇳 印度' };
const CHART_TYPE_DISPLAY = {
  topfreeapplications: '免费榜',
  topgrossingapplications: '畅销榜',
  topselling_free: '免费榜',
  topgrossing: '畅销榜',
};

function loadEnvToken() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('请在项目根目录创建 .env，并配置 SENSORTOWER_API_TOKEN');
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*SENSORTOWER_API_TOKEN\s*=\s*(.+)\s*$/);
    if (m) {
      return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  console.error('.env 中未找到 SENSORTOWER_API_TOKEN');
  process.exit(1);
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMondayDates(startDate, endDate) {
  // 假设 startDate 本身就是周一，则每次 +7 天即可
  const dates = [];
  let cur = new Date(startDate);
  while (cur <= endDate) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return dates;
}

/** 指定本周一时，返回 [上周一, 本周一] 两个 Date，用于只抓指定周 */
function getTwoMondaysForWeek(mondayYmd) {
  const d = new Date(mondayYmd + 'T12:00:00Z');
  if (isNaN(d.getTime())) return null;
  const last = new Date(d);
  last.setUTCDate(last.getUTCDate() - 7);
  return [last, new Date(d)];
}

/** 周一对应的「上周日」Date（用于 API 请求：拉取周日榜单，库中仍存 rank_date=周一） */
function getSundayBeforeMonday(mondayDate) {
  const sun = new Date(mondayDate);
  sun.setUTCDate(sun.getUTCDate() - 1);
  return sun;
}

function buildQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function fetchJson(url, retries = 3, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const attemptFetch = (attempt) => {
      const req = https.get(url, {
        timeout: timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(
              new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`)
            );
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('JSON 解析失败: ' + e.message));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        if (attempt < retries) {
          console.log(`  请求超时，重试 ${attempt + 1}/${retries}...`);
          setTimeout(() => attemptFetch(attempt + 1), 1000 * attempt);
        } else {
          reject(new Error(`连接超时（已重试 ${retries} 次）: ${url}`));
        }
      });

      req.on('error', (e) => {
        if (attempt < retries && (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET' || e.code === 'ENOTFOUND')) {
          console.log(`  网络错误 ${e.code}，重试 ${attempt + 1}/${retries}...`);
          setTimeout(() => attemptFetch(attempt + 1), 1000 * attempt);
        } else {
          reject(e);
        }
      });
    };

    attemptFetch(1);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 批量根据 app_id 获取应用名称（与 market_monitor_v1.6.js 中 fetchAppNames 一致）
 * 调用 /v1/{platform}/category/category_history，解析 name 或 humanized_app_name
 * @param {string[]} appIds - 去重后的 app_id 列表
 * @param {'ios'|'android'} platform
 * @param {string} authToken
 * @returns {Promise<Object.<string,string>>} appId -> appName
 */
/** 从数据库 app_name_cache 表读取 app_id -> app_name，只返回 appIds 中有的 */
function loadNameMapFromCache(platform, appIds) {
  const want = new Set(appIds.filter(Boolean));
  if (want.size === 0) return {};
  const plat = platform === 'ios' ? 'ios' : 'android';
  const out = runSqlReturn(
    `SELECT app_id, app_name FROM app_name_cache WHERE platform = '${plat}'`
  );
  const nameMap = {};
  for (const line of (out || '').trim().split('\n')) {
    if (!line) continue;
    const idx = line.indexOf('|');
    if (idx === -1) continue;
    const appId = line.slice(0, idx).trim();
    const appName = line.slice(idx + 1).trim();
    if (want.has(appId)) nameMap[appId] = appName || appId;
  }
  return nameMap;
}

/** 将 API 拉到的 nameMap 写入 app_name_cache */
function saveNameMapToCache(platform, nameMap) {
  if (!nameMap || Object.keys(nameMap).length === 0) return;
  const plat = platform === 'ios' ? 'ios' : 'android';
  const values = Object.entries(nameMap)
    .map(([appId, appName]) => `('${escapeSqlValue(appId)}','${escapeSqlValue(appName)}','${plat}')`)
    .join(',');
  runSql(
    `INSERT OR REPLACE INTO app_name_cache (app_id, app_name, platform) VALUES ${values}`,
    true
  );
}

/**
 * 先查缓存，缺失或“名=id”（当时没拉到真名）的再调 API，并把新结果写入缓存
 */
async function getAppNames(appIds, platform, authToken) {
  const seen = new Set();
  const uniqueIds = appIds.filter((id) => id && !seen.has(id) && (seen.add(id), true));
  if (uniqueIds.length === 0) return {};

  let nameMap = loadNameMapFromCache(platform, uniqueIds);
  // 缓存里没有、或名字为空、或名字等于 app_id（说明从未拉到真名）的都要重新请求 API
  const missingIds = uniqueIds.filter(
    (id) => !nameMap[id] || String(nameMap[id]).trim() === '' || nameMap[id] === id
  );
  if (missingIds.length > 0) {
    console.log(`  [${platform}] 需拉取应用名 ${missingIds.length} 个（走 /category/category_history）`);
    const apiMap = await fetchAppNames(missingIds, platform, authToken);
    Object.assign(nameMap, apiMap);
    if (Object.keys(apiMap).length > 0) saveNameMapToCache(platform, apiMap);
  }
  return nameMap;
}

/**
 * 调用 /category/category_history 拉取应用名（与 market_monitor_v1.6.js 中 fetchAppNames 一致）
 * 使用国际 API BASE_URL_NAMES，返回结构：{ appId: { US: { category: { chartType: { name, humanized_app_name } } } } }
 */
async function fetchAppNames(appIds, platform, authToken) {
  const nameMap = {};
  if (!appIds || appIds.length === 0) return nameMap;

  const category = platform === 'ios' ? CATEGORY_IOS : CATEGORY_ANDROID;
  const chartType = platform === 'ios' ? 'topfreeapplications' : 'topselling_free';

  for (let i = 0; i < appIds.length; i += APP_NAMES_BATCH_SIZE) {
    const batch = appIds.slice(i, i + APP_NAMES_BATCH_SIZE);
    const batchIds = batch.join(',');
    const params = {
      app_ids: batchIds,
      category,
      chart_type_ids: chartType,
      countries: 'US',
      auth_token: authToken,
    };
    const url = `${BASE_URL_NAMES}/${platform}/category/category_history?${buildQuery(params)}`;
    try {
      let data = await fetchJson(url, 3, 30000); // 重试3次，超时30秒
      if (data && data.data && typeof data.data === 'object') data = data.data;
      for (const appId of Object.keys(data || {})) {
        if (appId === 'lines') continue;
        const appData = data[appId];
        if (appData && appData.US) {
          const catData = appData.US[category];
          if (catData && catData[chartType]) {
            const name = catData[chartType].name || catData[chartType].humanized_app_name || appId;
            nameMap[appId] = name;
          }
        }
      }
    } catch (e) {
      console.error(`  获取应用名称失败 (批次 ${i + 1}-${i + batch.length}):`, e.message);
      // 即使失败也继续处理下一批，避免中断整个流程
    }
    if (i + APP_NAMES_BATCH_SIZE < appIds.length) await sleep(DELAY_MS);
  }
  return nameMap;
}

async function callRanking(platform, category, chartType, country, dateStr, authToken) {
  const params = {
    category,
    chart_type: chartType,
    country,
    date: dateStr,
    auth_token: authToken,
  };
  const url = `${BASE_URL}/${platform}/ranking?${buildQuery(params)}`;
  console.log('  请求:', url.replace(authToken, '***'));
  const data = await fetchJson(url);
  const ranking = (data && data.ranking) || [];
  return ranking.slice(0, 100).map(String);
}

// ---- SQLite 相关（通过 sqlite3 CLI，避免 npm 依赖）----

function assertSqlite3Exists() {
  try {
    execSync('sqlite3 -version', { stdio: 'ignore' });
  } catch (e) {
    console.error('未检测到 sqlite3 命令，请先在系统中安装 sqlite3 再运行本脚本。');
    process.exit(1);
  }
}

function runSql(sql, silent) {
  const compact = sql
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
  const cmd = `sqlite3 "${DB_FILE}" "${compact.replace(/"/g, '""')}"`;
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: silent ? 'pipe' : 'inherit',
    });
  } catch (e) {
    // 如果是列已存在的错误，静默忽略
    if (e.message && e.message.includes('duplicate column name')) {
      return '';
    }
    throw e;
  }
}

/** 执行 SQL 并返回标准输出（用于 SELECT），用 | 分隔列避免 app_name 中含逗号 */
function runSqlReturn(sql) {
  const compact = sql
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
  const safe = compact.replace(/"/g, '""');
  const cmd = `sqlite3 -separator '|' "${DB_FILE}" "${safe}"`;
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) || '';
  } catch (e) {
    return '';
  }
}

function initDb() {
  const ddl = `
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS apple_top100 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rank_date TEXT NOT NULL,
      country TEXT NOT NULL,
      chart_type TEXT NOT NULL,
      rank INTEGER NOT NULL,
      app_id TEXT NOT NULL,
      app_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE (rank_date, country, chart_type, rank)
    );
    CREATE TABLE IF NOT EXISTS android_top100 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rank_date TEXT NOT NULL,
      country TEXT NOT NULL,
      chart_type TEXT NOT NULL,
      rank INTEGER NOT NULL,
      app_id TEXT NOT NULL,
      app_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE (rank_date, country, chart_type, rank)
    );
  `;
  runSql(ddl);
  // 若数据库已存在（无 app_name 列），则追加列（静默处理，列已存在则忽略）
  runSql("ALTER TABLE apple_top100 ADD COLUMN app_name TEXT DEFAULT ''", true);
  runSql("ALTER TABLE android_top100 ADD COLUMN app_name TEXT DEFAULT ''", true);
  // app_name 缓存表：拉名时优先读此表，相同 app_id 直接走缓存
  runSql(`
    CREATE TABLE IF NOT EXISTS app_name_cache (
      app_id TEXT NOT NULL,
      app_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      PRIMARY KEY (app_id, platform)
    );
  `);
  // 添加显示名称列（静默处理，列已存在则忽略）
  runSql("ALTER TABLE apple_top100 ADD COLUMN country_display TEXT;", true);
  runSql("ALTER TABLE apple_top100 ADD COLUMN chart_type_display TEXT;", true);
  runSql("ALTER TABLE android_top100 ADD COLUMN country_display TEXT;", true);
  runSql("ALTER TABLE android_top100 ADD COLUMN chart_type_display TEXT;", true);
}

function escapeSqlValue(v) {
  return String(v).replace(/'/g, "''");
}

function sqlStringList(values) {
  return values.map((v) => `'${escapeSqlValue(v)}'`).join(',');
}

function getRankingWeekStatus(table, rankDate, countries, chartTypes) {
  const dateStr = formatDate(rankDate);
  const countryList = sqlStringList(countries);
  const chartTypeList = sqlStringList(chartTypes);
  const expectedGroups = countries.length * chartTypes.length;
  const out = runSqlReturn(`
    SELECT COUNT(*) AS group_count, COALESCE(MIN(cnt), 0) AS min_count, COALESCE(MAX(cnt), 0) AS max_count
    FROM (
      SELECT country, chart_type, COUNT(*) AS cnt
      FROM ${table}
      WHERE rank_date = '${escapeSqlValue(dateStr)}'
        AND country IN (${countryList})
        AND chart_type IN (${chartTypeList})
      GROUP BY country, chart_type
    );
  `).trim();
  const [groupCountRaw, minCountRaw, maxCountRaw] = (out.split('\n')[0] || '').split('|');
  const groupCount = Number(groupCountRaw || 0);
  const minCount = Number(minCountRaw || 0);
  const maxCount = Number(maxCountRaw || 0);
  return {
    complete: groupCount === expectedGroups && minCount >= 100,
    groupCount,
    minCount,
    maxCount,
    expectedGroups,
  };
}

function isAuthFailure(message) {
  return /HTTP\s+(401|403)\b/.test(String(message || ''));
}

function formatWeekStatus(status) {
  return `${status.groupCount}/${status.expectedGroups} 组，min=${status.minCount}，max=${status.maxCount}`;
}

function insertRanking(table, rankDate, country, chartType, appIds, nameMap) {
  if (!appIds || appIds.length === 0) return;
  const dateStr = formatDate(rankDate);
  nameMap = nameMap || {};
  const countryDisplay = escapeSqlValue(COUNTRY_DISPLAY[country] || country);
  const chartTypeDisplay = escapeSqlValue(CHART_TYPE_DISPLAY[chartType] || chartType);
  const values = appIds
    .map((appId, idx) => {
      const rank = idx + 1;
      // 应用名称优先使用 nameMap，否则使用 app_id（稍后从 app_metadata 更新）
      const appName = nameMap[appId] != null ? nameMap[appId] : appId;
      return `('${escapeSqlValue(dateStr)}','${escapeSqlValue(country)}','${escapeSqlValue(chartType)}',${rank},'${escapeSqlValue(appId)}','${escapeSqlValue(appName)}','${countryDisplay}','${chartTypeDisplay}')`;
    })
    .join(',');
  const sql = `
    BEGIN;
    INSERT OR IGNORE INTO ${table}
      (rank_date, country, chart_type, rank, app_id, app_name, country_display, chart_type_display)
    VALUES ${values};
    COMMIT;
  `;
  runSql(sql);
}

async function main() {
  const authToken = loadEnvToken();
  assertSqlite3Exists();
  initDb();

  let mondayDates;
  const dateArg = process.argv[2];
  if (dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg.trim())) {
    const pair = getTwoMondaysForWeek(dateArg.trim());
    if (!pair) {
      console.error('无效的周一日期，格式 YYYY-MM-DD');
      process.exit(1);
    }
    mondayDates = pair;
    console.log('指定周模式，只处理：', mondayDates.map((d) => formatDate(d)).join(', '));
  } else {
    const today = new Date();
    mondayDates = getMondayDates(START_DATE, today);
    console.log(
      '将处理周一日期：',
      mondayDates.map((d) => formatDate(d)).join(', ')
    );
  }

  for (const d of mondayDates) {
    const rankDateMonday = d; // 库中存「周一」作为该周标识
    const sundayForApi = getSundayBeforeMonday(d);
    const apiDateStr = formatDate(sundayForApi);
    const mondayStr = formatDate(d);
    console.log(`\n===== 周 ${mondayStr}（API 拉取周日 ${apiDateStr} 榜单，rank_date 存周一） =====`);

    // iOS：拉取周日榜单并写入，rank_date 存周一
    const iosStatus = getRankingWeekStatus('apple_top100', rankDateMonday, COUNTRIES, CHART_TYPES_IOS);
    if (iosStatus.complete) {
      console.log(
        `[iOS] ${mondayStr} 已有完整 Top100（${iosStatus.groupCount}/${iosStatus.expectedGroups} 组，min=${iosStatus.minCount}），跳过 ranking API`
      );
    } else {
      const iosResults = [];
      const iosFailures = [];
      for (const country of COUNTRIES) {
        for (const chartType of CHART_TYPES_IOS) {
          console.log(`[iOS] ${country} ${chartType} ${apiDateStr}`);
          try {
            const ranking = await callRanking(
              'ios',
              CATEGORY_IOS,
              chartType,
              country,
              apiDateStr,
              authToken
            );
            iosResults.push({ country, chartType, ranking });
          } catch (e) {
            const message = e && e.message ? e.message : String(e);
            console.error('  -> 请求失败：', message);
            iosFailures.push({ country, chartType, message });
            if (isAuthFailure(message)) {
              throw new Error(
                `[iOS] ranking API 认证失败（${country} ${chartType} ${apiDateStr}）。` +
                  '请确认 SENSORTOWER_API_TOKEN 是否具备 /v1/ios/ranking 权限；' +
                  '我方产品日报使用的是 /category/category_history，不能证明 ranking API 可用。'
              );
            }
          }
        }
      }
      if (iosFailures.length > 0) {
        throw new Error(`[iOS] ranking API 请求失败 ${iosFailures.length} 组，停止写入不完整 Top100`);
      }
      for (const { country, chartType, ranking } of iosResults) {
        insertRanking('apple_top100', rankDateMonday, country, chartType, ranking, {});
      }
      const iosAfterStatus = getRankingWeekStatus('apple_top100', rankDateMonday, COUNTRIES, CHART_TYPES_IOS);
      if (!iosAfterStatus.complete) {
        throw new Error(`[iOS] ${mondayStr} Top100 不完整：${formatWeekStatus(iosAfterStatus)}`);
      }
    }

    // Android：拉取周日榜单并写入，rank_date 存周一
    const androidStatus = getRankingWeekStatus('android_top100', rankDateMonday, COUNTRIES, CHART_TYPES_ANDROID);
    if (androidStatus.complete) {
      console.log(
        `[Android] ${mondayStr} 已有完整 Top100（${androidStatus.groupCount}/${androidStatus.expectedGroups} 组，min=${androidStatus.minCount}），跳过 ranking API`
      );
    } else {
      const androidResults = [];
      const androidFailures = [];
      for (const country of COUNTRIES) {
        for (const chartType of CHART_TYPES_ANDROID) {
          console.log(`[Android] ${country} ${chartType} ${apiDateStr}`);
          try {
            const ranking = await callRanking(
              'android',
              CATEGORY_ANDROID,
              chartType,
              country,
              apiDateStr,
              authToken
            );
            androidResults.push({ country, chartType, ranking });
          } catch (e) {
            const message = e && e.message ? e.message : String(e);
            console.error('  -> 请求失败：', message);
            androidFailures.push({ country, chartType, message });
            if (isAuthFailure(message)) {
              throw new Error(
                `[Android] ranking API 认证失败（${country} ${chartType} ${apiDateStr}）。` +
                  '请确认 SENSORTOWER_API_TOKEN 是否具备 /v1/android/ranking 权限；' +
                  '我方产品日报使用的是 /category/category_history，不能证明 ranking API 可用。'
              );
            }
          }
        }
      }
      if (androidFailures.length > 0) {
        throw new Error(`[Android] ranking API 请求失败 ${androidFailures.length} 组，停止写入不完整 Top100`);
      }
      for (const { country, chartType, ranking } of androidResults) {
        insertRanking('android_top100', rankDateMonday, country, chartType, ranking, {});
      }
      const androidAfterStatus = getRankingWeekStatus('android_top100', rankDateMonday, COUNTRIES, CHART_TYPES_ANDROID);
      if (!androidAfterStatus.complete) {
        throw new Error(`[Android] ${mondayStr} Top100 不完整：${formatWeekStatus(androidAfterStatus)}`);
      }
    }
  }

  console.log('\n全部完成，数据已写入 sqlite 数据库：', DB_FILE);
}

main().catch((err) => {
  console.error('执行失败：', err.message);
  process.exit(1);
});
