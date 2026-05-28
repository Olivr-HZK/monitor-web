#!/usr/bin/env node
/**
 * 从数据库两个 Top100 表读取 app_id，批量调用 GET /v1/{os}/apps 获取 metadata，写入 app_metadata 表。
 * 已在 app_metadata 中存在的 (app_id, os) 不会再次请求。
 *
 * 用法：
 *   node fetch_app_metadata_to_db.js [ios|android]
 * 不传参数时：先拉 ios（apple_top100），再拉 android（android_top100）。
 * 传 ios 或 android 时：只拉该平台，app_id 来自对应 top100 表。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const BASE_URL = 'https://api.sensortower-china.com/v1';
const DB_FILE = process.env.SENSORTOWER_DB_FILE ? (require('path').isAbsolute(process.env.SENSORTOWER_DB_FILE) ? process.env.SENSORTOWER_DB_FILE : path.join(__dirname, '..', process.env.SENSORTOWER_DB_FILE)) : path.join(__dirname, '..', 'data', 'sensortower_top100.db');
const BATCH_SIZE = 100;

function loadEnvToken() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('请配置 .env 中的 SENSORTOWER_API_TOKEN');
    process.exit(1);
  }
  let content = fs.readFileSync(envPath, 'utf8');
  content = content.replace(/^\uFEFF/, ''); // 去掉 BOM
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^SENSORTOWER_API_TOKEN\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[1].split('#')[0].trim().replace(/^["']|["']$/g, '');
    if (val) return val;
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
            return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed && parsed.error) {
              return reject(new Error(String(parsed.error)));
            }
            resolve(parsed);
          } catch (e) {
            reject(new Error('JSON 解析失败: ' + e.message));
          }
        });
      })
      .on('error', reject);
  });
}

function getStoreUrl(appId, os) {
  const p = String(os || '').toLowerCase();
  if (p === 'ios') return 'https://apps.apple.com/app/id' + appId;
  return 'https://play.google.com/store/apps/details?id=' + appId;
}

/** 将单个 app 对象压平为一行：基本类型直接存，对象/数组存 JSON 字符串 */
function flattenApp(app, os) {
  const row = { app_id: String(app.app_id), os };
  for (const [k, v] of Object.entries(app)) {
    if (k === 'app_id') continue;
    if (v === null || v === undefined) {
      row[k] = null;
    } else if (typeof v === 'object') {
      row[k] = JSON.stringify(v);
    } else {
      row[k] = v;
    }
  }
  // 补全统一的商店链接，避免下游再拼接
  if (!row.url) row.url = getStoreUrl(row.app_id, os);
  return row;
}

/** 收集所有出现过的 key（用于建表） */
function getAllKeys(rows) {
  const set = new Set();
  for (const row of rows) {
    for (const k of Object.keys(row)) set.add(k);
  }
  return [...set];
}

/** SQL 列名安全：只保留字母数字下划线 */
function safeCol(name) {
  return String(name).replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeSqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function runSql(sql, silent) {
  const compact = sql.split('\n').map((s) => s.trim()).filter(Boolean).join(' ');
  const safe = compact.replace(/"/g, '""');
  try {
    return execSync(`sqlite3 "${DB_FILE}" "${safe}"`, {
      encoding: 'utf8',
      stdio: silent ? 'pipe' : 'inherit',
    });
  } catch (e) {
    if (!silent) throw e;
    return null;
  }
}

function ensureTable(columns) {
  const cols = columns.map((c) => `"${safeCol(c)}" TEXT`).join(', ');
  runSql(
    `CREATE TABLE IF NOT EXISTS app_metadata (${cols}, PRIMARY KEY (app_id, os));`,
    true
  );
}

function addColumnIfMissing(col) {
  try {
    runSql(`ALTER TABLE app_metadata ADD COLUMN "${safeCol(col)}" TEXT;`, true);
  } catch (_) {}
}

function insertRow(columns, row) {
  const cols = columns.map((c) => `"${safeCol(c)}"`).join(', ');
  const vals = columns.map((c) => escapeSqlValue(row[c] ?? null)).join(', ');
  runSql(`INSERT OR REPLACE INTO app_metadata (${cols}) VALUES (${vals});`, true);
}

async function fetchBatch(appIds, os, authToken) {
  const params = {
    app_ids: appIds.join(','),
    country: 'US',
    include_sdk_data: 'false',
    auth_token: authToken,
  };
  const url = `${BASE_URL}/${os}/apps?${buildQuery(params)}`;
  const data = await fetchJson(url);
  const apps = data && data.apps ? data.apps : [];
  return apps.map((app) => flattenApp(app, os));
}

/** 从 apple_top100 / android_top100 取去重 app_id */
function getAppIdsFromTop100(os) {
  const table = os === 'ios' ? 'apple_top100' : 'android_top100';
  try {
    const out = execSync(
      `sqlite3 -separator '|' "${DB_FILE}" "SELECT DISTINCT app_id FROM ${table} WHERE app_id IS NOT NULL AND app_id != ''"`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
    return [...new Set(out.trim().split('\n').map((l) => l.split('|')[0].trim()).filter(Boolean))];
  } catch (e) {
    return [];
  }
}

/** 已在 app_metadata 中存在的 app_id（按 os），不再请求 */
function getExistingAppIdsInMetadata(os) {
  try {
    const out = execSync(
      `sqlite3 -separator '|' "${DB_FILE}" "SELECT app_id FROM app_metadata WHERE os = '${os}'"`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
    return new Set(out.trim().split('\n').map((l) => l.split('|')[0].trim()).filter(Boolean));
  } catch (e) {
    return new Set();
  }
}

function getAppIdsFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return [...new Set(content.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean))];
}

async function runForPlatform(os, authToken) {
  let appIds = getAppIdsFromTop100(os);
  if (appIds.length === 0) {
    console.log(`[${os}] Top100 表中无 app_id，跳过`);
    return;
  }
  const existing = getExistingAppIdsInMetadata(os);
  appIds = appIds.filter((id) => !existing.has(id));
  if (appIds.length === 0) {
    console.log(`[${os}] 共 ${getAppIdsFromTop100(os).length} 个 app_id，均已存在于 app_metadata，跳过请求`);
    return;
  }
  console.log(`[${os}] Top100 共 ${getAppIdsFromTop100(os).length} 个，已存在 ${existing.size} 个，待拉取 ${appIds.length} 个`);

  let allColumns = ['app_id', 'os'];
  let tableEnsured = false;

  for (let i = 0; i < appIds.length; i += BATCH_SIZE) {
    const batch = appIds.slice(i, i + BATCH_SIZE);
    console.log(`  请求 ${i + 1}-${i + batch.length} / ${appIds.length} ...`);
    try {
      const rows = await fetchBatch(batch, os, authToken);
      if (rows.length === 0) continue;
      const keys = getAllKeys(rows);
      for (const k of keys) {
        if (!allColumns.includes(k)) allColumns.push(k);
      }
      if (!tableEnsured) {
        ensureTable(allColumns);
        tableEnsured = true;
      } else {
        for (const k of keys) {
          if (!allColumns.includes(k)) {
            allColumns.push(k);
            addColumnIfMissing(k);
          }
        }
      }
      for (const row of rows) {
        insertRow(allColumns, row);
      }
      console.log(`    写入 ${rows.length} 条`);
    } catch (e) {
      console.error('    失败:', e.message);
    }
  }
}

async function main() {
  const arg = process.argv[2];
  const platforms = [];
  if (!arg) {
    platforms.push('ios', 'android');
  } else if (['ios', 'android'].includes(arg)) {
    platforms.push(arg);
  } else {
    console.error('用法: node fetch_app_metadata_to_db.js [ios|android]');
    console.error('  不传参数：从 apple_top100 + android_top100 读取，分别拉取并写入，已存在的不请求');
    process.exit(1);
  }

  if (!fs.existsSync(DB_FILE)) {
    console.error('数据库不存在:', DB_FILE);
    process.exit(1);
  }

  const authToken = loadEnvToken();
  for (const os of platforms) {
    await runForPlatform(os, authToken);
  }
  console.log('完成。表: app_metadata');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
