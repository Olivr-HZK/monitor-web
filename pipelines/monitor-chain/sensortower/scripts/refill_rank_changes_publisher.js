#!/usr/bin/env node
/**
 * 为已有 rank_changes 表补全「开发者/公司」（publisher_name）和「商店链接」（store_url）。
 * 不重跑 generate_rank_changes_from_db.js，避免覆盖已有数据。
 *
 * 运行：node refill_rank_changes_publisher.js
 *
 * 依赖：publisher 需先运行 fetch_app_metadata_to_db.js；store_url 仅用 app_id+platform 生成，无依赖。
 */

const path = require('path');
const { execSync } = require('child_process');

const DB_FILE = process.env.SENSORTOWER_DB_FILE ? (require('path').isAbsolute(process.env.SENSORTOWER_DB_FILE) ? process.env.SENSORTOWER_DB_FILE : path.join(__dirname, '..', process.env.SENSORTOWER_DB_FILE)) : path.join(__dirname, '..', 'data', 'sensortower_top100.db');

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

function runSqlReturn(sql) {
  const compact = sql.split('\n').map((s) => s.trim()).filter(Boolean).join(' ');
  const safe = compact.replace(/"/g, '""');
  try {
    return (
      execSync(`sqlite3 -separator '|' "${DB_FILE}" "${safe}"`, {
        encoding: 'utf8',
        stdio: 'pipe',
      }) || ''
    );
  } catch (e) {
    return '';
  }
}

function escapeSqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/** 生成商店链接（与 market_monitor_v1.6.js / generate_rank_changes_from_db.js 一致） */
function getStoreUrl(appId, platform) {
  const p = (String(platform || '')).toLowerCase();
  if (p === 'ios') return 'https://apps.apple.com/app/id' + appId;
  return 'https://play.google.com/store/apps/details?id=' + appId;
}

/** 从 app_metadata 表读取 (app_id, os) -> { publisher_name, url } */
function getMetadataMap() {
  const map = new Map();
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
  return map;
}

function main() {
  if (!require('fs').existsSync(DB_FILE)) {
    console.error('数据库不存在:', DB_FILE);
    process.exit(1);
  }

  try {
    runSql('ALTER TABLE rank_changes ADD COLUMN publisher_name TEXT;', true);
  } catch (_) {}
  try {
    runSql('ALTER TABLE rank_changes ADD COLUMN store_url TEXT;', true);
  } catch (_) {}

  const metadataMap = getMetadataMap();
  console.log('app_metadata 中共', metadataMap.size, '条 (app_id, os) 的 publisher 信息');

  const out = runSqlReturn(
    'SELECT rowid, app_id, platform FROM rank_changes'
  );
  const rows = [];
  for (const line of (out || '').trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length >= 3) {
      rows.push({
        rowid: parts[0].trim(),
        app_id: parts[1].trim(),
        platform: parts[2].trim(),
      });
    }
  }

  let pubFilled = 0;
  let pubSkipped = 0;
  for (const r of rows) {
    const os = (r.platform || '').toLowerCase();
    const meta = metadataMap.get(`${r.app_id}|${os}`) || { publisherName: '', url: '' };
    const publisherName = meta.publisherName ?? '';
    const storeUrl = meta.url || getStoreUrl(r.app_id, r.platform);
    runSql(
      `UPDATE rank_changes SET publisher_name = ${escapeSqlValue(publisherName)}, store_url = ${escapeSqlValue(storeUrl)} WHERE rowid = ${r.rowid};`,
      true
    );
    if (publisherName) pubFilled++;
    else pubSkipped++;
  }

  console.log('已更新 rank_changes：publisher_name 有值', pubFilled, '条、无匹配', pubSkipped, '条；store_url 已全部填充');
  console.log('导入 Google 表格后，可新增一列输入 =HYPERLINK(K2,B2) 并下拉（K=商店链接列，B=应用名称列），得到可点击名称');
}

main();
