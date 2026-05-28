#!/usr/bin/env node
/**
 * 检测 Top100 榜单中的游戏是否已经在商店下架（或页面不可访问），结果写入 SQLite 表：weekly_removed_games。
 *
 * 设计：
 *   - 只关心「下架」，不关心是否掉出 Top100。
 *   - 以某个周一 rank_date 为一周标识，读取这一天在 apple_top100 / android_top100 中的全部 Top100。
 *   - 为每条记录构造商店链接（iOS App Store / Google Play），对该 URL 发起多次 HTTP 请求（默认 3 次，间隔 2 秒）：
 *       - 任一次返回 2xx / 3xx：视为仍可访问，不写入表。
 *       - 多次尝试均返回 4xx / 5xx 或网络错误：才视为疑似下架（removed = 1），写入 weekly_removed_games。
 *
 * 用法：
 *   node detect_removed_games.js
 *      → 自动取 apple_top100 中最新的 rank_date 作为本周一
 *   node detect_removed_games.js 2026-02-23
 *      → 对 2026-02-23 这一周的 Top100 做下架检测
 *
 * 表结构（weekly_removed_games）：
 *   id          INTEGER PRIMARY KEY AUTOINCREMENT
 *   rank_date   TEXT    周一（与 Top100 中 rank_date 一致）
 *   os          TEXT    'ios' / 'android'
 *   country     TEXT
 *   chart_type  TEXT
 *   app_id      TEXT
 *   app_name    TEXT    来自 apple_top100 / android_top100 的 app_name
 *   store_url   TEXT
 *   http_status INTEGER
 *   removed     INTEGER  1=疑似下架 / 不可访问，0=页面可访问
 *   reason      TEXT     可选，记录错误信息 / 状态说明
 *   checked_at  TEXT     默认 datetime('now')
 *
 * 注意：
 *   - 这里只做「URL 是否还能访问」的粗略判断，并不解析页面文案。
 *   - iOS 链接：https://apps.apple.com/{country-lower}/app/id{app_id}
 *   - Android 链接：https://play.google.com/store/apps/details?id={app_id}
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const DB_FILE = process.env.SENSORTOWER_DB_FILE
  ? (path.isAbsolute(process.env.SENSORTOWER_DB_FILE)
      ? process.env.SENSORTOWER_DB_FILE
      : path.join(__dirname, '..', process.env.SENSORTOWER_DB_FILE))
  : path.join(__dirname, '..', 'data', 'sensortower_top100.db');

// 多次请求均失败才记为「疑似下架」，减少偶发网络/超时误判
const REMOVED_CHECK_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runSqlReturn(sql) {
  const compact = sql
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
  const safe = compact.replace(/"/g, '""');
  try {
    return execSync(`sqlite3 -separator '|' "${DB_FILE}" "${safe}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (_) {
    return '';
  }
}

function runSql(sql) {
  const compact = sql
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
  const safe = compact.replace(/"/g, '""');
  execSync(`sqlite3 "${DB_FILE}" "${safe}"`, {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function escapeSqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function ensureTable() {
  runSql(`
    CREATE TABLE IF NOT EXISTS weekly_removed_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rank_date TEXT NOT NULL,
      os TEXT NOT NULL,
      country TEXT NOT NULL,
      chart_type TEXT NOT NULL,
      app_id TEXT NOT NULL,
      app_name TEXT,
      store_url TEXT,
      http_status INTEGER,
      removed INTEGER NOT NULL,
      reason TEXT,
      checked_at TEXT DEFAULT (datetime('now')),
      UNIQUE (rank_date, os, country, chart_type, app_id)
    );
  `);
}

function getLatestRankDate() {
  let out = runSqlReturn('SELECT MAX(rank_date) FROM apple_top100;');
  if (!(out || '').trim()) {
    out = runSqlReturn('SELECT MAX(rank_date) FROM android_top100;');
  }
  const v = (out || '').trim();
  if (!v) return null;
  return v.split('\n')[0].trim();
}

function loadTargets(rankDate) {
  const safeDate = rankDate.replace(/'/g, "''");
  const targets = [];

  // iOS Top100
  const iosOut = runSqlReturn(`
    SELECT country, chart_type, app_id,
           COALESCE(NULLIF(TRIM(app_name), ''), app_id) AS app_name
    FROM apple_top100
    WHERE rank_date = '${safeDate}';
  `);
  for (const line of (iosOut || '').trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length < 4) continue;
    targets.push({
      os: 'ios',
      country: parts[0].trim(),
      chart_type: parts[1].trim(),
      app_id: parts[2].trim(),
      app_name: parts[3].trim(),
    });
  }

  // Android Top100
  const andOut = runSqlReturn(`
    SELECT country, chart_type, app_id,
           COALESCE(NULLIF(TRIM(app_name), ''), app_id) AS app_name
    FROM android_top100
    WHERE rank_date = '${safeDate}';
  `);
  for (const line of (andOut || '').trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length < 4) continue;
    targets.push({
      os: 'android',
      country: parts[0].trim(),
      chart_type: parts[1].trim(),
      app_id: parts[2].trim(),
      app_name: parts[3].trim(),
    });
  }

  return targets;
}

function buildStoreUrl(target) {
  const country = (target.country || 'US').toLowerCase();
  if (target.os === 'ios') {
    // iOS App Store：按国家区分
    return `https://apps.apple.com/${country}/app/id${encodeURIComponent(
      target.app_id
    )}`;
  }
  // Android Google Play
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(
    target.app_id
  )}`;
}

function checkUrl(url) {
  return new Promise((resolve) => {
    let resolved = false;
    try {
      const req = https.request(
        url,
        {
          method: 'GET',
          timeout: 15000,
        },
        (res) => {
          resolved = true;
          const status = res.statusCode || 0;
          // 不需要完整 body，只要状态码即可
          res.resume();
          resolve({ status, error: null });
        }
      );
      req.on('timeout', () => {
        if (resolved) return;
        resolved = true;
        req.destroy();
        resolve({ status: 0, error: 'timeout' });
      });
      req.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        resolve({ status: 0, error: String(err && err.message ? err.message : err) });
      });
      req.end();
    } catch (e) {
      if (resolved) return;
      resolved = true;
      resolve({ status: 0, error: String(e && e.message ? e.message : e) });
    }
  });
}

async function main() {
  let rankDate = process.argv[2] ? process.argv[2].trim() : null;
  if (rankDate && !/^\d{4}-\d{2}-\d{2}$/.test(rankDate)) {
    console.error('日期格式须为 YYYY-MM-DD，例如 2026-02-23（作为周一 rank_date）');
    process.exit(1);
  }
  if (!rankDate) {
    rankDate = getLatestRankDate();
    if (!rankDate) {
      console.error('apple_top100/android_top100 中无 rank_date 数据，请先运行 fetch_top100_to_db.js');
      process.exit(1);
    }
  }

  console.log('检测 Top100 游戏是否下架，rank_date =', rankDate);
  ensureTable();

  const targets = loadTargets(rankDate);
  if (targets.length === 0) {
    console.log('指定 rank_date 下无 Top100 记录，直接返回。');
    return;
  }
  console.log('需要检测的应用数量：', targets.length);

  let checked = 0;
  for (const t of targets) {
    const url = buildStoreUrl(t);
    let status = 0;
    let reason = '';
    let removed = 0;

    for (let attempt = 1; attempt <= REMOVED_CHECK_RETRIES; attempt++) {
      try {
        const result = await checkUrl(url);
        status = result.status || 0;
        if (status >= 200 && status < 400) {
          // 任一次 2xx/3xx 即视为仍在架，不再重试
          removed = 0;
          break;
        }
        if (status >= 400 && status < 600) {
          reason = `HTTP ${status}`;
          removed = 1;
        } else if (status === 0 && result.error) {
          reason = result.error;
          removed = 1;
        }
      } catch (e) {
        reason = String(e && e.message ? e.message : e);
        removed = 1;
      }
      if (removed && attempt < REMOVED_CHECK_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }

    // 只在「多次尝试均失败」时写入表，任一次 2xx/3xx 则不写
    if (removed) {
      runSql(`
        INSERT OR REPLACE INTO weekly_removed_games
          (rank_date, os, country, chart_type, app_id, app_name, store_url, http_status, removed, reason)
        VALUES (
          ${escapeSqlValue(rankDate)},
          ${escapeSqlValue(t.os)},
          ${escapeSqlValue(t.country)},
          ${escapeSqlValue(t.chart_type)},
          ${escapeSqlValue(t.app_id)},
          ${escapeSqlValue(t.app_name)},
          ${escapeSqlValue(url)},
          ${status || 0},
          1,
          ${escapeSqlValue(reason)}
        );
      `);

      checked++;
      if (checked % 20 === 0) {
        console.log('已记录疑似下架应用', checked, '/', targets.length);
      }
    }
  }

  console.log('检测完成，共写入 weekly_removed_games（疑似下架）记录条数：', checked);
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
