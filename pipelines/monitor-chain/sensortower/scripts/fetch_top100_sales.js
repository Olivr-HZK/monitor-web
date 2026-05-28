#!/usr/bin/env node
/**
 * 为 Top100 榜单（所有榜单类型）补充「上一周」下载量与收益，并写回 apple_top100 / android_top100，
 * 同时覆盖 rank_changes 中对应周的 downloads / revenue。
 *
 * 数据来源说明：
 * - **不再调用 ranking 接口，不重新拉榜单**
 * - 仅从本地 SQLite 中已有的 apple_top100 / android_top100 读取 app_id + country
 *
 * 逻辑：
 * - 给定某个「周一 rank_date」，统计其「上一周」的 downloads / revenue：
 *     start_date = rank_date - 7 天（上周一）
 *     end_date   = rank_date - 1 天（上周日）
 *   示例：rank_date = 2026-02-23，则 start_date=2026-02-16，end_date=2026-02-22
 * - 使用 date_granularity = 'daily'，脚本内对 7 天数据求和
 * - iOS:  处理 topfreeapplications / topgrossingapplications 等所有 chart_type
 * - Android: 处理 topselling_free / topgrossing 等所有 chart_type
 * - 然后 generate_rank_changes_from_db.js 可以直接从 top100 继承 downloads / revenue（免费榜部分）
 * - 本脚本还会用同一周的汇总结果覆盖 rank_changes.rank_date_current = rank_date 的 downloads / revenue
 *
 * 用法：
 *   node scripts/fetch_top100_sales.js
 *     → 自动取 apple_top100 中最新的 rank_date 作为本周一
 *
 *   node scripts/fetch_top100_sales.js 2026-02-02
 *     → 指定「本周一」为 2026-02-02，统计 2026-02-02 ~ 2026-02-08
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const BASE_URL = 'https://api.sensortower-china.com/v1';
const DB_FILE = process.env.SENSORTOWER_DB_FILE
  ? (require('path').isAbsolute(process.env.SENSORTOWER_DB_FILE)
      ? process.env.SENSORTOWER_DB_FILE
      : path.join(__dirname, '..', process.env.SENSORTOWER_DB_FILE))
  : path.join(__dirname, '..', 'data', 'sensortower_top100.db');

const BATCH_SIZE = Number(process.env.SENSORTOWER_SALES_BATCH_SIZE || 400);
const DELAY_MS = 400;

// 与其它脚本保持一致的国家展示名映射（code -> display）
const COUNTRY_DISPLAY = {
  US: '🇺🇸 美国',
  JP: '🇯🇵 日本',
  GB: '🇬🇧 英国',
  DE: '🇩🇪 德国',
  IN: '🇮🇳 印度',
};
// 展示名 -> 国家码，用于从 rank_changes 的 country 反查 salesMap（API 返回的是 US/JP 等）
const DISPLAY_TO_CODE = {};
for (const [code, display] of Object.entries(COUNTRY_DISPLAY)) {
  DISPLAY_TO_CODE[display] = code;
}

function loadEnvToken() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('请配置 .env 中的 SENSORTOWER_API_TOKEN');
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*SENSORTOWER_API_TOKEN\s*=\s*(.+)\s*$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  console.error('.env 中未找到 SENSORTOWER_API_TOKEN');
  process.exit(1);
}

function buildQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('JSON 解析失败: ' + e.message));
          }
        });
      })
      .on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runSqlReturn(sql) {
  const compact = sql.split('\n').map((s) => s.trim()).filter(Boolean).join(' ');
  const safe = compact.replace(/"/g, '""');
  try {
    return execSync(`sqlite3 -separator '|' "${DB_FILE}" "${safe}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    return '';
  }
}

function runSql(sql) {
  const compact = sql.split('\n').map((s) => s.trim()).filter(Boolean).join(' ');
  const safe = compact.replace(/"/g, '""');
  execSync(`sqlite3 "${DB_FILE}" "${safe}"`, { encoding: 'utf8', stdio: 'pipe' });
}

function escapeSqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/** 给 top100 表追加 downloads / revenue 列（若不存在） */
function ensureTop100SalesColumns() {
  try {
    runSql('ALTER TABLE apple_top100 ADD COLUMN downloads REAL;');
  } catch (_) {}
  try {
    runSql('ALTER TABLE apple_top100 ADD COLUMN revenue REAL;');
  } catch (_) {}
  try {
    runSql('ALTER TABLE android_top100 ADD COLUMN downloads REAL;');
  } catch (_) {}
  try {
    runSql('ALTER TABLE android_top100 ADD COLUMN revenue REAL;');
  } catch (_) {}
}

function salesCompleteForRankDate(rankDateMonday) {
  const safeDate = rankDateMonday.replace(/'/g, "''");
  function tableStatus(table) {
    const out = runSqlReturn(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN downloads IS NOT NULL AND revenue IS NOT NULL THEN 1 ELSE 0 END) AS ready
      FROM ${table}
      WHERE rank_date = '${safeDate}';
    `).trim();
    const [totalRaw, readyRaw] = (out.split('\n')[0] || '').split('|');
    const total = Number(totalRaw || 0);
    const ready = Number(readyRaw || 0);
    return { total, ready, complete: total > 0 && ready === total };
  }
  const ios = tableStatus('apple_top100');
  const android = tableStatus('android_top100');
  const rcOut = runSqlReturn(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN downloads IS NOT NULL AND revenue IS NOT NULL THEN 1 ELSE 0 END) AS ready
    FROM rank_changes
    WHERE rank_date_current = '${safeDate}';
  `).trim();
  const [rcTotalRaw, rcReadyRaw] = (rcOut.split('\n')[0] || '').split('|');
  const rcTotal = Number(rcTotalRaw || 0);
  const rcReady = Number(rcReadyRaw || 0);
  return {
    complete: ios.complete && android.complete && rcTotal > 0 && rcReady === rcTotal,
    ios,
    android,
    rankChanges: { total: rcTotal, ready: rcReady },
  };
}

/** 日期加减 N 天，返回 YYYY-MM-DD（UTC） */
function dateAdd(ymd, deltaDays) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 给定周一 rank_date，返回该周周日 */
// 不再使用：我们现在只统计前一周
// function getWeekEnd(rankDateMonday) {
//   return dateAdd(rankDateMonday, 6);
// }

/** 解析 sales_report_estimates 响应，按 (app_id, country) 汇总 downloads/revenue */
function parseResponse(data, platform) {
  let list = null;
  if (Array.isArray(data)) list = data;
  else if (data && data.sales_report_estimates_key) {
    const inner = data.sales_report_estimates_key;
    list = Array.isArray(inner) ? inner : (inner && inner.unified ? inner.unified : null);
  } else if (data && data.unified) list = data.unified;
  else if (data && data.lines) list = data.lines;
  if (!list || !Array.isArray(list)) return [];

  const key = (appId, country) => `${appId}\t${country}`;
  const sum = new Map();

  for (const item of list) {
    const appId = String(item.app_id || item.aid || '');
    const country = item.country || item.c || item.cc || '';
    let units = 0;
    let revenue = 0;
    if (platform === 'android') {
      units = Number(item.android_units ?? item.u ?? 0) || 0;
      revenue = Number(item.android_revenue ?? item.r ?? 0) || 0;
    } else {
      units =
        (Number(item.iphone_units ?? item.iu ?? 0) || 0) +
        (Number(item.ipad_units ?? item.au ?? 0) || 0);
      revenue =
        (Number(item.iphone_revenue ?? item.ir ?? 0) || 0) +
        (Number(item.ipad_revenue ?? item.ar ?? 0) || 0);
    }
    const k = key(appId, country);
    const prev = sum.get(k) || { downloads: 0, revenue: 0 };
    sum.set(k, { downloads: prev.downloads + units, revenue: prev.revenue + revenue });
  }

  return Array.from(sum.entries()).map(([k, v]) => {
    const [app_id, country] = k.split('\t');
    return { app_id, country, downloads: v.downloads, revenue: v.revenue };
  });
}

async function fetchSalesBatch(appIds, platform, startDate, endDate, authToken) {
  const params = {
    app_ids: appIds.join(','),
    date_granularity: 'daily', // 按天返回，脚本内自行按周聚合
    start_date: startDate,
    end_date: endDate,
    data_model: 'DM_2025_Q2',
    auth_token: authToken,
  };
  const url = `${BASE_URL}/${platform}/sales_report_estimates?${buildQuery(params)}`;
  const data = await fetchJson(url);
  return parseResponse(data, platform);
}

/** 取 apple_top100 / android_top100 中最新的 rank_date 作为默认周一 */
function getLatestRankDate() {
  const out = runSqlReturn(`
    SELECT MAX(rank_date) FROM (
      SELECT rank_date FROM apple_top100
      UNION ALL
      SELECT rank_date FROM android_top100
    )
  `);
  const v = (out || '').trim();
  return v || null;
}

/** 从 rank_changes 取出指定 rank_date_current 的所有行（app_id, platform, country 展示名） */
function getRankChangesRows(rankDateCurrent, opts = {}) {
  const missingOnly = !!opts.missingOnly;
  const out = runSqlReturn(
    `SELECT app_id, platform, country FROM rank_changes
     WHERE rank_date_current = '${rankDateCurrent.replace(/'/g, "''")}'
       ${missingOnly ? 'AND (downloads IS NULL OR revenue IS NULL)' : ''}`
  );
  const rows = [];
  for (const line of (out || '').trim().split('\n')) {
    if (!line) continue;
    const [appId, platform, country] = line.split('|').map((s) => s && s.trim());
    if (appId && platform) rows.push({ app_id: appId, platform, country: country || '' });
  }
  return rows;
}

/** 某平台指定周一的 Top100（所有榜单类型） app_id+country+chart_type 列表 */
function getTop100AppsForWeek(table, rankDate, opts = {}) {
  const missingOnly = !!opts.missingOnly;
  const out = runSqlReturn(
    `SELECT DISTINCT app_id, country, chart_type
     FROM ${table}
     WHERE rank_date = '${rankDate}'
       ${missingOnly ? 'AND (downloads IS NULL OR revenue IS NULL)' : ''}`
  );
  const rows = [];
  for (const line of (out || '').trim().split('\n')) {
    if (!line) continue;
    const [appId, country, chartType] = line.split('|').map((s) => s && s.trim());
    if (appId && country) rows.push({ app_id: appId, country, chart_type: chartType });
  }
  return rows;
}

async function main() {
  if (!fs.existsSync(DB_FILE)) {
    console.error('数据库不存在:', DB_FILE);
    process.exit(1);
  }

  ensureTop100SalesColumns();

  const dateArg = process.argv[2];
  let rankDateMonday = null;

  if (dateArg) {
    const d = dateArg.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      console.error('日期格式须为 YYYY-MM-DD，例如 2026-02-02（作为周一 rank_date）');
      process.exit(1);
    }
    rankDateMonday = d;
  } else {
    rankDateMonday = getLatestRankDate();
    if (!rankDateMonday) {
      console.error('apple_top100 中无可用 rank_date，请先运行 fetch_top100_to_db.js');
      process.exit(1);
    }
  }

  // 上一周：rank_date -7 ~ rank_date -1
  const startDate = dateAdd(rankDateMonday, -7);
  const endDate = dateAdd(rankDateMonday, -1);
  console.log(
    'rank_date(周一):',
    rankDateMonday,
    '，上一周区间 start_date~end_date:',
    startDate,
    '~',
    endDate
  );

  const completeStatus = salesCompleteForRankDate(rankDateMonday);
  if (completeStatus.complete) {
    console.log(
      `downloads/revenue 已完整：ios ${completeStatus.ios.ready}/${completeStatus.ios.total}，android ${completeStatus.android.ready}/${completeStatus.android.total}，rank_changes ${completeStatus.rankChanges.ready}/${completeStatus.rankChanges.total}，跳过 sales_report_estimates API`
    );
    return;
  }

  const authToken = loadEnvToken();

  const iosRows = getTop100AppsForWeek('apple_top100', rankDateMonday, { missingOnly: true });
  const androidRows = getTop100AppsForWeek('android_top100', rankDateMonday, { missingOnly: true });
  const rcRowsMissing = getRankChangesRows(rankDateMonday, { missingOnly: true });
  for (const row of rcRowsMissing) {
    const plat = (row.platform || '').toUpperCase();
    const countryCode = DISPLAY_TO_CODE[row.country] || row.country;
    if (plat === 'IOS') iosRows.push({ app_id: row.app_id, country: countryCode, chart_type: '' });
    else if (plat === 'ANDROID') androidRows.push({ app_id: row.app_id, country: countryCode, chart_type: '' });
  }

  const iosAppIds = [...new Set(iosRows.map((r) => r.app_id))];
  const androidAppIds = [...new Set(androidRows.map((r) => r.app_id))];

  const key = (appId, country) => `${appId}|${country}`;
  const iosSalesMap = new Map();
  const androidSalesMap = new Map();

  // iOS
  if (iosAppIds.length > 0) {
    console.log(`[ios] 缺失 downloads/revenue 的 app_id ${iosAppIds.length} 个，分批请求 sales_report_estimates`);
    for (let i = 0; i < iosAppIds.length; i += BATCH_SIZE) {
      const batch = iosAppIds.slice(i, i + BATCH_SIZE);
      try {
        const list = await fetchSalesBatch(batch, 'ios', startDate, endDate, authToken);
        for (const r of list) {
          const k = key(r.app_id, r.country);
          iosSalesMap.set(k, { downloads: r.downloads, revenue: r.revenue });
        }
        console.log(`  ${i + 1}-${i + batch.length}/${iosAppIds.length} 返回 ${list.length} 条`);
      } catch (e) {
        console.error('  请求失败:', e.message);
      }
      if (i + BATCH_SIZE < iosAppIds.length) await sleep(DELAY_MS);
    }
  }

  // Android
  if (androidAppIds.length > 0) {
    console.log(`[android] 缺失 downloads/revenue 的 app_id ${androidAppIds.length} 个，分批请求 sales_report_estimates`);
    for (let i = 0; i < androidAppIds.length; i += BATCH_SIZE) {
      const batch = androidAppIds.slice(i, i + BATCH_SIZE);
      try {
        const list = await fetchSalesBatch(batch, 'android', startDate, endDate, authToken);
        for (const r of list) {
          const k = key(r.app_id, r.country);
          androidSalesMap.set(k, { downloads: r.downloads, revenue: r.revenue });
        }
        console.log(
          `  ${i + 1}-${i + batch.length}/${androidAppIds.length} 返回 ${list.length} 条`
        );
      } catch (e) {
        console.error('  请求失败:', e.message);
      }
      if (i + BATCH_SIZE < androidAppIds.length) await sleep(DELAY_MS);
    }
  }

  // 写回 apple_top100（所有 chart_type）
  let iosUpdated = 0;
  for (const r of iosRows) {
    const k = key(r.app_id, r.country);
    const s = iosSalesMap.get(k);
    if (!s) continue;
    const downloads = s.downloads ?? '';
    const revenue = s.revenue ?? '';
    runSql(
      `UPDATE apple_top100
       SET downloads = ${escapeSqlValue(downloads)}, revenue = ${escapeSqlValue(revenue)}
       WHERE rank_date = ${escapeSqlValue(rankDateMonday)}
         AND app_id = ${escapeSqlValue(r.app_id)}
         AND country = ${escapeSqlValue(r.country)};`
    );
    iosUpdated++;
  }

  // 写回 android_top100（所有 chart_type）
  let androidUpdated = 0;
  for (const r of androidRows) {
    const k = key(r.app_id, r.country);
    const s = androidSalesMap.get(k);
    if (!s) continue;
    const downloads = s.downloads ?? '';
    const revenue = s.revenue ?? '';
    runSql(
      `UPDATE android_top100
       SET downloads = ${escapeSqlValue(downloads)}, revenue = ${escapeSqlValue(revenue)}
       WHERE rank_date = ${escapeSqlValue(rankDateMonday)}
         AND app_id = ${escapeSqlValue(r.app_id)}
         AND country = ${escapeSqlValue(r.country)};`
    );
    androidUpdated++;
  }

  console.log(
    '已更新 apple_top100 downloads/revenue 条数:',
    iosUpdated,
    '；android_top100:',
    androidUpdated
  );

  // 以 rank_changes 为基准：只更新该周已有的异动行，用 app_id + 日期 + 平台 + 国家 匹配销量
  const rcRows = getRankChangesRows(rankDateMonday);
  let rcUpdated = 0;
  for (const row of rcRows) {
    const plat = (row.platform || '').toUpperCase();
    const salesMap = plat === 'IOS' ? iosSalesMap : plat === 'ANDROID' ? androidSalesMap : null;
    if (!salesMap) continue;
    const countryCode = DISPLAY_TO_CODE[row.country] || row.country;
    const k = key(row.app_id, countryCode);
    const s = salesMap.get(k);
    if (!s) continue;
    const downloads = s.downloads ?? '';
    const revenue = s.revenue ?? '';
    runSql(
      `UPDATE rank_changes
       SET downloads = ${escapeSqlValue(downloads)}, revenue = ${escapeSqlValue(revenue)}
       WHERE rank_date_current = ${escapeSqlValue(rankDateMonday)}
         AND app_id = ${escapeSqlValue(row.app_id)}
         AND platform = ${escapeSqlValue(row.platform)}
         AND country = ${escapeSqlValue(row.country)};`
    );
    rcUpdated++;
  }

  console.log('已覆盖 rank_changes downloads/revenue 行数:', rcUpdated);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
