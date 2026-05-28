#!/usr/bin/env node
/**
 * 从 sensortower_top100.db 的 apple_top100 / android_top100 比对生成「榜单异动」，
 * 逻辑与 market_monitor_v1.6.js 的 analyzeRankChanges 一致，
 * 应用名直接取自库内 app_name，不调 API。
 *
 * 输出：
 *   1. 数据库表 rank_changes（按本周一+上周一追加：先删同日期组合再写入本次，历史周次保留）
 *   2. 榜单异动.csv
 *
 * 运行：
 *   node generate_rank_changes_from_db.js
 *      → 自动取库中最近两个周一做比对
 *   node generate_rank_changes_from_db.js 2026-02-02
 *      → 指定「本周一」为 2026-02-02，上周一自动为 2026-01-26
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DB_FILE = process.env.SENSORTOWER_DB_FILE ? (require('path').isAbsolute(process.env.SENSORTOWER_DB_FILE) ? process.env.SENSORTOWER_DB_FILE : path.join(__dirname, '..', process.env.SENSORTOWER_DB_FILE)) : path.join(__dirname, '..', 'data', 'sensortower_top100.db');
const OUT_CSV = path.join(__dirname, '..', 'output', '榜单异动.csv');

const COUNTRIES = ['US', 'JP', 'GB', 'DE', 'IN'];
const COUNTRY_DISPLAY = { US: '🇺🇸 美国', JP: '🇯🇵 日本', GB: '🇬🇧 英国', DE: '🇩🇪 德国', IN: '🇮🇳 印度' };
const RANK_CHANGE_THRESHOLD = 20; // 与原脚本 CONFIG.RANK_CHANGE_THRESHOLD 一致
const TOP_N = 50; // 只分析 Top 50 的异动

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

/** 库中已有的 rank_date 列表（升序） */
function getAvailableRankDates() {
  const out = runSqlReturn(
    "SELECT DISTINCT rank_date FROM apple_top100 ORDER BY rank_date ASC"
  );
  return (out || '').trim().split('\n').filter(Boolean).map((l) => l.trim());
}

/** 不传参时：取库中最近两个周一 */
function getTwoLatestMondays() {
  const dates = getAvailableRankDates();
  if (dates.length < 2) {
    throw new Error('数据库中至少需要两个周一日期的榜单数据才能生成异动');
  }
  return { current: dates[dates.length - 1], last: dates[dates.length - 2] };
}

/** 指定「本周一」时：current = 起始日期，last = 起始日期 - 7 天（格式 YYYY-MM-DD） */
function getLastMondayFrom(currentYmd) {
  const d = new Date(currentYmd + 'T12:00:00Z');
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 7);
  const y = d.getUTCFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 生成商店链接（与 market_monitor_v1.6.js 一致，用于 Google 表格可点击名称） */
function getStoreUrl(appId, platform) {
  const p = (platform || '').toLowerCase();
  if (p === 'ios') return 'https://apps.apple.com/app/id' + appId;
  return 'https://play.google.com/store/apps/details?id=' + appId;
}

/** 从 app_metadata 表读取 (app_id, platform) -> { publisher_name, url } */
function getMetadataMap() {
  const map = new Map();
  try {
    const out = runSqlReturn(
      `SELECT app_id, os, publisher_name, url FROM app_metadata WHERE app_id IS NOT NULL AND (os = 'ios' OR os = 'android')`
    );
    for (const line of (out || '').trim().split('\n')) {
      if (!line) continue;
      const parts = line.split('|');
      if (parts.length >= 3) {
        const appId = parts[0].trim();
        const os = parts[1].trim().toLowerCase();
        const publisherName = (parts[2] || '').trim();
        const url = (parts[3] || '').trim();
        map.set(`${appId}|${os}`, { publisherName, url });
      }
    }
  } catch (_) {}
  return map;
}

/** 从表里取某日、某国家、某榜单类型的 Top N，按 rank 升序，返回 { appId, appName, rank }[] */
function getRanking(table, rankDate, country, chartType, topN) {
  const sql = `SELECT app_id, COALESCE(NULLIF(trim(app_name),''), app_id) AS app_name, rank
    FROM ${table}
    WHERE rank_date = '${rankDate}' AND country = '${country}' AND chart_type = '${chartType}'
    ORDER BY rank ASC LIMIT ${topN}`;
  const raw = runSqlReturn(sql);
  const rows = [];
  for (const line of (raw || '').trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length >= 3) {
      rows.push({
        appId: parts[0].trim(),
        appName: parts[1].trim(),
        rank: parseInt(parts[2], 10) || 0,
      });
    }
  }
  return rows;
}

/** 读取某平台当周 Top100 免费榜里的 downloads / revenue，映射到 (appId|countryDisplay) */
function getSalesMapFromTop100(platform, rankDateCurrent) {
  const map = new Map();
  const isIos = platform.toLowerCase() === 'ios';
  const table = isIos ? 'apple_top100' : 'android_top100';
  const chartType = isIos ? 'topfreeapplications' : 'topselling_free';
  const sql = `
    SELECT app_id, country, downloads, revenue
    FROM ${table}
    WHERE rank_date = '${rankDateCurrent}' AND chart_type = '${chartType}'
  `;
  const raw = runSqlReturn(sql);
  if (!raw) return map;
  for (const line of raw.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length < 4) continue;
    const appId = parts[0].trim();
    const countryCode = parts[1].trim();
    const downloads = parts[2] === '' ? null : Number(parts[2]);
    const revenue = parts[3] === '' ? null : Number(parts[3]);
    const countryDisplay = COUNTRY_DISPLAY[countryCode] || countryCode;
    const key = `${appId}|${countryDisplay}`;
    map.set(key, { downloads, revenue });
  }
  return map;
}

function analyzeOne(platform, table, chartType, currentDate, lastDate) {
  const allChanges = [];
  for (const country of COUNTRIES) {
    const currentRanking = getRanking(table, currentDate, country, chartType, TOP_N);
    const lastRanking = getRanking(table, lastDate, country, chartType, 500);
    const lastWeekMap = {};
    lastRanking.forEach((r) => {
      lastWeekMap[r.appId] = r.rank;
    });

    for (let k = 0; k < currentRanking.length; k++) {
      const { appId, appName } = currentRanking[k];
      const currentRank = k + 1;
      const lastWeekRank = lastWeekMap[appId];
      let changeType = '';
      let signal = '';
      let changeStr = '';

      if (lastWeekRank == null) {
        changeType = '🆕 新进榜单';
        signal = '🔴';
        changeStr = 'NEW';
      } else {
        const change = lastWeekRank - currentRank;
        if (change >= RANK_CHANGE_THRESHOLD) {
          changeType = '🚀 排名飙升';
          signal = '🔴';
        } else if (change >= 10) {
          changeType = '📈 排名上升';
          signal = '🟡';
        } else if (change <= -RANK_CHANGE_THRESHOLD) {
          changeType = '📉 排名下跌';
          signal = '🟢';
        } else {
          continue;
        }
        changeStr = change > 0 ? '↑' + change : '↓' + Math.abs(change);
      }

      allChanges.push({
        signal,
        appName: appName || appId,
        appId,
        country: COUNTRY_DISPLAY[country] || country,
        platform: platform.toUpperCase(),
        currentRank,
        lastWeekRank: lastWeekRank == null ? '-' : lastWeekRank,
        change: changeStr,
        changeType,
      });
    }
  }
  return allChanges;
}

function escapeCsvCell(s) {
  const str = String(s ?? '');
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function writeCsv(filePath, rows, headers) {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(','));
  }
  fs.writeFileSync(filePath, '\uFEFF' + lines.join('\n'), 'utf8');
}

function main() {
  if (!fs.existsSync(DB_FILE)) {
    console.error('数据库不存在:', DB_FILE);
    process.exit(1);
  }

  let current;
  let last;
  const startArg = process.argv[2];

  if (startArg) {
    const startDate = startArg.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      console.error('起始日期格式须为 YYYY-MM-DD，例如 2026-02-02');
      process.exit(1);
    }
    last = getLastMondayFrom(startDate);
    if (!last) {
      console.error('起始日期无效:', startDate);
      process.exit(1);
    }
    const available = getAvailableRankDates();
    if (!available.includes(startDate)) {
      console.error('库中无该「本周一」数据:', startDate, '可选日期:', available.join(', '));
      process.exit(1);
    }
    if (!available.includes(last)) {
      console.error('库中无「上周一」数据:', last, '可选日期:', available.join(', '));
      process.exit(1);
    }
    current = startDate;
  } else {
    const pair = getTwoLatestMondays();
    current = pair.current;
    last = pair.last;
  }

  console.log('本周一（当前）:', current);
  console.log('上周一:', last);

  const iosChanges = analyzeOne(
    'ios',
    'apple_top100',
    'topfreeapplications',
    current,
    last
  );
  const androidChanges = analyzeOne(
    'android',
    'android_top100',
    'topselling_free',
    current,
    last
  );

  const allChanges = [...iosChanges, ...androidChanges];

  // 从 top100 继承 downloads / revenue（已由 fetch_top100_sales.js 写入 top100）
  const iosSalesMap = getSalesMapFromTop100('ios', current);
  const androidSalesMap = getSalesMapFromTop100('android', current);
  for (const r of allChanges) {
    const plat = (r.platform || '').toLowerCase();
    const salesMap = plat === 'ios' ? iosSalesMap : plat === 'android' ? androidSalesMap : null;
    if (!salesMap) continue;
    const key = `${r.appId}|${r.country}`;
    const s = salesMap.get(key);
    if (s) {
      r.downloads = s.downloads;
      r.revenue = s.revenue;
    }
  }
  // 按信号排序：🔴 🟡 🟢
  const order = { '🔴': 0, '🟡': 1, '🟢': 2 };
  allChanges.sort((a, b) => (order[a.signal] ?? 3) - (order[b.signal] ?? 3));

  // 写入数据库新表 rank_changes（与 market_monitor 异动榜单一致）
  const tableName = 'rank_changes';
  runSql(`
    CREATE TABLE IF NOT EXISTS rank_changes (
      rank_date_current TEXT NOT NULL,
      rank_date_last TEXT NOT NULL,
      signal TEXT,
      app_name TEXT,
      app_id TEXT NOT NULL,
      country TEXT,
      platform TEXT,
      current_rank INTEGER,
      last_week_rank TEXT,
      change TEXT,
      change_type TEXT,
      publisher_name TEXT,
      store_url TEXT,
      downloads REAL,
      revenue REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  try {
    runSql('ALTER TABLE rank_changes ADD COLUMN publisher_name TEXT;');
  } catch (_) {}
  try {
    runSql('ALTER TABLE rank_changes ADD COLUMN store_url TEXT;');
  } catch (_) {}
  try {
    runSql('ALTER TABLE rank_changes ADD COLUMN downloads REAL;');
  } catch (_) {}
  try {
    runSql('ALTER TABLE rank_changes ADD COLUMN revenue REAL;');
  } catch (_) {}
  const metadataMap = getMetadataMap();
  runSql(`DELETE FROM rank_changes WHERE rank_date_current = ${escapeSqlValue(current)} AND rank_date_last = ${escapeSqlValue(last)};`);
  for (const r of allChanges) {
    const os = (r.platform || '').toLowerCase();
    const meta = metadataMap.get(`${r.appId}|${os}`) || { publisherName: '', url: '' };
    const publisherName = meta.publisherName || '';
    const storeUrl = meta.url || getStoreUrl(r.appId, r.platform);
    r.publisher_name = publisherName;
    r['开发者/公司'] = publisherName;
    r.store_url = storeUrl;
    r['商店链接'] = storeUrl;
    const sql = `INSERT INTO rank_changes (rank_date_current, rank_date_last, signal, app_name, app_id, country, platform, current_rank, last_week_rank, change, change_type, publisher_name, store_url, downloads, revenue)
      VALUES (${escapeSqlValue(current)}, ${escapeSqlValue(last)}, ${escapeSqlValue(r.signal)}, ${escapeSqlValue(r.appName)}, ${escapeSqlValue(r.appId)}, ${escapeSqlValue(r.country)}, ${escapeSqlValue(r.platform)}, ${r.currentRank}, ${escapeSqlValue(String(r.lastWeekRank))}, ${escapeSqlValue(r.change)}, ${escapeSqlValue(r.changeType)}, ${escapeSqlValue(publisherName)}, ${escapeSqlValue(storeUrl)}, ${escapeSqlValue(r.downloads == null ? '' : r.downloads)}, ${escapeSqlValue(r.revenue == null ? '' : r.revenue)});`;
    runSql(sql);
  }
  console.log('已写入表:', tableName, '共', allChanges.length, '条');

  // 准备 CSV 数据，确保字段名匹配
  const csvRows = allChanges.map(r => ({
    '信号': r.signal,
    '应用名称': r.appName,
    'App ID': r.appId,
    '国家': r.country,
    '平台': r.platform,
    '本周排名': r.currentRank,
    '上周排名': r.lastWeekRank,
    '变化': r.change,
    '异动类型': r.changeType,
    '开发者/公司': r['开发者/公司'] || r.publisher_name || '',
    '商店链接': r['商店链接'] || r.store_url || ''
  }));
  const headers = ['信号', '应用名称', 'App ID', '国家', '平台', '本周排名', '上周排名', '变化', '异动类型', '开发者/公司', '商店链接'];
  writeCsv(OUT_CSV, csvRows, headers);
  console.log('已写入:', OUT_CSV);
}

main();
