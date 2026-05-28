#!/usr/bin/env node
/**
 * 通过 metadata 接口获取「本周」US Top100 免费榜（iOS + Android）的商店页信息，
 * 与「上周」同榜游戏的快照对比，检测商店页是否有变化，并写入变更表。
 *
 * 数据流：
 * 1. 从 apple_top100 / android_top100 取本周、上周 US 免费榜 app 列表
 * 2. 本周榜内 app 调用 SensorTower GET /v1/{os}/apps 拉取当前商店页信息
 * 3. 与上周快照（weekly_metadata_snapshot）对比，有变化的写入 weekly_metadata_changes
 * 4. 将本周拉取结果写入 weekly_metadata_snapshot，供下周对比
 *
 * 用法：
 *   node fetch_us_free_metadata_and_compare.js
 *   node fetch_us_free_metadata_and_compare.js --date 2026-02-03
 *
 * --date：本周一日期（YYYY-MM-DD），不传则用库中最新 rank_date（US 免费榜）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = process.env.SENSORTOWER_DB_FILE
  ? path.isAbsolute(process.env.SENSORTOWER_DB_FILE)
    ? process.env.SENSORTOWER_DB_FILE
    : path.join(ROOT, process.env.SENSORTOWER_DB_FILE)
  : path.join(ROOT, 'data', 'sensortower_top100.db');

const BASE_URL = 'https://api.sensortower-china.com/v1';
const BATCH_SIZE = 100;
const DELAY_MS = 300;

/** 参与对比的商店页字段（与 API 返回一致） */
const STORE_PAGE_FIELDS = [
  'name',
  'description',
  'subtitle',
  'short_description',
  'screenshot_urls',
];

function loadEnvToken() {
  const envPath = path.join(ROOT, '.env');
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
    // 去掉行内注释、首尾空白和引号
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runSql(sql, silent = false) {
  const compact = sql
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
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

function runSqlReturn(sql, separator = '|') {
  const compact = sql
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
  const safe = compact.replace(/"/g, '""');
  try {
    return execSync(`sqlite3 -separator '${separator}' "${DB_FILE}" "${safe}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (_) {
    return '';
  }
}

function escapeSqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/** 获取库中 US 免费榜有记录的所有 rank_date（周一），升序 */
function getUsFreeRankDates() {
  const out = runSqlReturn(
    `
    SELECT DISTINCT rank_date FROM (
      SELECT rank_date FROM apple_top100 WHERE country = 'US' AND chart_type = 'topfreeapplications'
      UNION
      SELECT rank_date FROM android_top100 WHERE country = 'US' AND chart_type = 'topselling_free'
    )
    ORDER BY rank_date ASC;
  `,
    '|'
  );
  return (out || '')
    .trim()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 上周一 = 本周一 - 7 天 */
function previousMonday(mondayYmd) {
  const d = new Date(mondayYmd + 'T12:00:00Z');
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 7);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 加载指定 rank_date 的 US 免费榜 (app_id, os) 列表 */
function loadUsFreeAppList(rankDate) {
  const safe = rankDate.replace(/'/g, "''");
  const set = new Set();
  const iosOut = runSqlReturn(
    `SELECT app_id FROM apple_top100 WHERE rank_date = '${safe}' AND country = 'US' AND chart_type = 'topfreeapplications' AND app_id IS NOT NULL AND app_id != ''`,
    '|'
  );
  for (const line of (iosOut || '').trim().split('\n')) {
    const id = line.split('|')[0]?.trim();
    if (id) set.add(`${id}|ios`);
  }
  const andOut = runSqlReturn(
    `SELECT app_id FROM android_top100 WHERE rank_date = '${safe}' AND country = 'US' AND chart_type = 'topselling_free' AND app_id IS NOT NULL AND app_id != ''`,
    '|'
  );
  for (const line of (andOut || '').trim().split('\n')) {
    const id = line.split('|')[0]?.trim();
    if (id) set.add(`${id}|android`);
  }
  return [...set].map((key) => {
    const [app_id, os] = key.split('|');
    return { app_id, os };
  });
}

/** 从 API 拉取一批 app 的 metadata，返回仅含商店页相关字段的对象数组 */
async function fetchMetadataBatch(appIds, os, authToken) {
  const params = {
    app_ids: appIds.join(','),
    country: 'US',
    include_sdk_data: 'false',
    auth_token: authToken,
  };
  const url = `${BASE_URL}/${os}/apps?${buildQuery(params)}`;
  const data = await fetchJson(url);
  const apps = (data && data.apps) || [];
  return apps.map((app) => {
    const row = { app_id: String(app.app_id), os };
    for (const k of STORE_PAGE_FIELDS) {
      const v = app[k];
      if (v === null || v === undefined) row[k] = null;
      else if (typeof v === 'object') row[k] = JSON.stringify(v);
      else row[k] = v;
    }
    return row;
  });
}

/** 初始化 weekly_metadata_snapshot 表 */
function ensureSnapshotTable() {
  const cols = ['rank_date TEXT', 'app_id TEXT', 'os TEXT']
    .concat(STORE_PAGE_FIELDS.map((c) => `"${c}" TEXT`))
    .join(', ');
  runSql(
    `CREATE TABLE IF NOT EXISTS weekly_metadata_snapshot (${cols}, PRIMARY KEY (rank_date, app_id, os));`,
    true
  );
}

/** 初始化 weekly_metadata_changes 表 */
function ensureChangesTable() {
  runSql(
    `CREATE TABLE IF NOT EXISTS weekly_metadata_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rank_date TEXT NOT NULL,
      app_id TEXT NOT NULL,
      os TEXT NOT NULL,
      app_name TEXT,
      changed_fields TEXT,
      old_values TEXT,
      new_values TEXT,
      detected_at TEXT DEFAULT (datetime('now'))
    );`,
    true
  );
}

function ensureRunLogTable() {
  runSql(
    `CREATE TABLE IF NOT EXISTS weekly_metadata_run_log (
      rank_date TEXT PRIMARY KEY,
      snapshot_count INTEGER NOT NULL,
      change_count INTEGER NOT NULL,
      completed_at TEXT DEFAULT (datetime('now'))
    );`,
    true
  );
}

function metadataCompareComplete(rankDate, expectedCount) {
  const safe = rankDate.replace(/'/g, "''");
  const snapOut = runSqlReturn(
    `SELECT COUNT(*) FROM weekly_metadata_snapshot WHERE rank_date = '${safe}'`,
    '|'
  ).trim();
  const snapshotCount = Number((snapOut.split('\n')[0] || '').split('|')[0] || 0);
  const logOut = runSqlReturn(
    `SELECT snapshot_count, change_count FROM weekly_metadata_run_log WHERE rank_date = '${safe}'`,
    '|'
  ).trim();
  if (!logOut) return { complete: false, snapshotCount, log: null };
  const [logSnapshotRaw, logChangeRaw] = (logOut.split('\n')[0] || '').split('|');
  const logSnapshot = Number(logSnapshotRaw || 0);
  const logChange = Number(logChangeRaw || 0);
  return {
    complete: snapshotCount >= expectedCount && logSnapshot >= expectedCount,
    snapshotCount,
    log: { snapshotCount: logSnapshot, changeCount: logChange },
  };
}

function saveRunLog(rankDate, snapshotCount, changeCount) {
  runSql(
    `INSERT OR REPLACE INTO weekly_metadata_run_log (rank_date, snapshot_count, change_count, completed_at)
     VALUES (${escapeSqlValue(rankDate)}, ${Number(snapshotCount) || 0}, ${Number(changeCount) || 0}, datetime('now'));`,
    true
  );
}

/** 标准化用于比较：null/undefined 视为空字符串；数组/对象用排序后的 JSON */
function normalizeForCompare(val) {
  if (val === null || val === undefined) return '';
  const s = typeof val === 'string' ? val : String(val);
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? JSON.stringify([...arr].sort()) : s;
    } catch (_) {
      return s;
    }
  }
  return s.trim();
}

/**
 * 标准化截图列表用于比较：
 * - 兼容标准 JSON 数组字符串：["u1","u2"]
 * - 兼容非标准数组字符串：[u1,u2]
 * - 忽略顺序与空白，仅比较 URL 集合
 */
function normalizeScreenshotList(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  if (!s) return '';

  let items = [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) items = parsed.map((x) => String(x || '').trim());
  } catch (_) {
    const body = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s;
    items = body
      .split(',')
      .map((x) => x.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  const uniqSorted = [...new Set(items)].sort();
  return JSON.stringify(uniqSorted);
}

/** 比较当前与上周快照，返回有变化的字段及 old/new */
function diffStorePage(current, last) {
  const changed = {};
  for (const k of STORE_PAGE_FIELDS) {
    const cur = k === 'screenshot_urls' ? normalizeScreenshotList(current[k]) : normalizeForCompare(current[k]);
    const prev = last
      ? (k === 'screenshot_urls' ? normalizeScreenshotList(last[k]) : normalizeForCompare(last[k]))
      : '';
    if (cur !== prev) {
      changed[k] = { old: last ? last[k] : null, new: current[k] };
    }
  }
  return Object.keys(changed).length ? changed : null;
}

/** 从 weekly_metadata_snapshot 加载指定 rank_date 的 (app_id, os) -> row（用 JSON 输出避免字段内含 | 等分隔符） */
function loadSnapshot(rankDate) {
  const safe = rankDate.replace(/'/g, "''");
  try {
    const out = execSync(
      `sqlite3 -json "${DB_FILE}" "SELECT app_id, os, ${STORE_PAGE_FIELDS.map((c) => `"${c}"`).join(', ')} FROM weekly_metadata_snapshot WHERE rank_date = '${safe}'"`,
      { encoding: 'utf8', stdio: 'pipe', cwd: ROOT }
    );
    const rows = JSON.parse(out || '[]');
    const map = new Map();
    for (const r of rows) {
      const key = `${r.app_id}|${r.os}`;
      map.set(key, { app_id: r.app_id, os: r.os, ...r });
    }
    return map;
  } catch (_) {
    return new Map();
  }
}

/** 写入一条快照 */
function insertSnapshot(rankDate, row) {
  const cols = ['rank_date', 'app_id', 'os', ...STORE_PAGE_FIELDS];
  const vals = cols.map((c) => escapeSqlValue(c === 'rank_date' ? rankDate : row[c])).join(', ');
  const names = cols.map((c) => `"${c}"`).join(', ');
  runSql(`INSERT OR REPLACE INTO weekly_metadata_snapshot (${names}) VALUES (${vals});`, true);
}

/** 写入一条变更记录 */
function insertChange(rankDate, appId, os, appName, changedFields, oldValues, newValues) {
  runSql(
    `INSERT INTO weekly_metadata_changes (rank_date, app_id, os, app_name, changed_fields, old_values, new_values) VALUES (${escapeSqlValue(rankDate)}, ${escapeSqlValue(appId)}, ${escapeSqlValue(os)}, ${escapeSqlValue(appName)}, ${escapeSqlValue(JSON.stringify(changedFields))}, ${escapeSqlValue(oldValues)}, ${escapeSqlValue(newValues)});`,
    true
  );
}

async function main() {
  let thisMonday = null;
  const dateArg = process.argv.find((a) => a.startsWith('--date='));
  if (dateArg) {
    thisMonday = dateArg.split('=')[1]?.trim();
  } else {
    const idx = process.argv.indexOf('--date');
    if (idx >= 0 && process.argv[idx + 1]) thisMonday = process.argv[idx + 1].trim();
  }

  if (!thisMonday) {
    const dates = getUsFreeRankDates();
    if (dates.length === 0) {
      console.error('库中无 US 免费榜数据，请先跑 fetch_top100_to_db 或指定 --date YYYY-MM-DD');
      process.exit(1);
    }
    thisMonday = dates[dates.length - 1];
    console.log('未指定 --date，使用库中最新 rank_date（周一）:', thisMonday);
  }

  const lastMonday = previousMonday(thisMonday);
  if (!lastMonday) {
    console.error('无效的周一日期:', thisMonday);
    process.exit(1);
  }

  if (!fs.existsSync(DB_FILE)) {
    console.error('数据库不存在:', DB_FILE);
    process.exit(1);
  }

  const thisWeekApps = loadUsFreeAppList(thisMonday);
  const lastWeekApps = loadUsFreeAppList(lastMonday);
  const lastWeekSet = new Set(lastWeekApps.map((a) => `${a.app_id}|${a.os}`));
  const intersection = thisWeekApps.filter((a) => lastWeekSet.has(`${a.app_id}|${a.os}`));

  console.log('\n本周一:', thisMonday, '| 上周一:', lastMonday);
  console.log('本周 US 免费榜 app 数:', thisWeekApps.length);
  console.log('上周 US 免费榜 app 数:', lastWeekApps.length);
  console.log('两周均在榜（参与对比）:', intersection.length);

  if (thisWeekApps.length === 0) {
    console.log('本周榜无数据，退出');
    return;
  }

  ensureSnapshotTable();
  ensureChangesTable();
  ensureRunLogTable();

  const runStatus = metadataCompareComplete(thisMonday, thisWeekApps.length);
  if (runStatus.complete) {
    console.log(
      `weekly_metadata 已完成：snapshot ${runStatus.snapshotCount}/${thisWeekApps.length}，changes ${runStatus.log.changeCount}，跳过 /apps metadata API`
    );
    return;
  }

  // 同一周允许重跑：先清理该周历史变化，避免重复累计或旧误报残留
  runSql(`DELETE FROM weekly_metadata_changes WHERE rank_date = ${escapeSqlValue(thisMonday)};`, true);

  const authToken = loadEnvToken();

  // 按平台分组拉取本周榜全部 app 的 metadata
  const byOs = { ios: [], android: [] };
  for (const a of thisWeekApps) {
    const os = a.os === 'ios' ? 'ios' : 'android';
    byOs[os].push(a.app_id);
  }

  const currentMap = new Map();
  for (const os of ['ios', 'android']) {
    const appIds = [...new Set(byOs[os])];
    if (appIds.length === 0) continue;
    console.log(`\n[${os}] 拉取 ${appIds.length} 个 app 的 metadata...`);
    for (let i = 0; i < appIds.length; i += BATCH_SIZE) {
      const batch = appIds.slice(i, i + BATCH_SIZE);
      try {
        const rows = await fetchMetadataBatch(batch, os, authToken);
        for (const row of rows) {
          currentMap.set(`${row.app_id}|${row.os}`, row);
        }
        console.log(`  已拉取 ${i + batch.length}/${appIds.length}`);
        if (i + BATCH_SIZE < appIds.length) await sleep(DELAY_MS);
      } catch (e) {
        console.error('  请求失败:', e.message);
      }
    }
  }

  // 与上周快照对比
  const snapshotLast = loadSnapshot(lastMonday);
  let changeCount = 0;
  for (const { app_id, os } of intersection) {
    const current = currentMap.get(`${app_id}|${os}`);
    if (!current) continue;
    const last = snapshotLast.get(`${app_id}|${os}`);
    // 如果没有上一周快照（例如第一周跑脚本），只建立本周快照，不写入变更记录
    if (!last) continue;
    const diff = diffStorePage(current, last);
    if (diff) {
      const changedFields = Object.keys(diff);
      const oldVals = {};
      const newVals = {};
      changedFields.forEach((k) => {
        oldVals[k] = diff[k].old;
        newVals[k] = diff[k].new;
      });
      insertChange(
        thisMonday,
        app_id,
        os,
        current.name || app_id,
        changedFields,
        JSON.stringify(oldVals),
        JSON.stringify(newVals)
      );
      changeCount++;
      console.log(`  变化: ${current.name || app_id} (${os}) [${changedFields.join(', ')}]`);
    }
  }

  // 写入本周快照（本周榜全部 app）
  for (const [key, row] of currentMap) {
    insertSnapshot(thisMonday, row);
  }

  console.log('\n完成。');
  console.log('  本周快照写入:', currentMap.size, '条 -> weekly_metadata_snapshot');
  console.log('  商店页变化:', changeCount, '条 -> weekly_metadata_changes');
  saveRunLog(thisMonday, currentMap.size, changeCount);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
