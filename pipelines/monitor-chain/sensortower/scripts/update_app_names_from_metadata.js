#!/usr/bin/env node
/**
 * 从 app_metadata 表读取应用名称，更新 apple_top100 / android_top100 表的 app_name 字段
 *
 * 功能：
 * - 从 app_metadata 表读取 name 字段
 * - 更新 apple_top100 / android_top100 表中对应 app_id 的 app_name 字段
 * - 同时更新 app_name_cache 表
 *
 * 使用方法：
 *   node scripts/update_app_names_from_metadata.js
 */

const path = require('path');
const { execSync } = require('child_process');

const DB_FILE = process.env.SENSORTOWER_DB_FILE
  ? (path.isAbsolute(process.env.SENSORTOWER_DB_FILE)
      ? process.env.SENSORTOWER_DB_FILE
      : path.join(__dirname, '..', process.env.SENSORTOWER_DB_FILE))
  : path.join(__dirname, '..', 'data', 'sensortower_top100.db');

function runSql(sql, silent = false) {
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
    return execSync(`sqlite3 -separator '|' "${DB_FILE}" "${safe}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    return '';
  }
}

function escapeSqlValue(v) {
  return String(v).replace(/'/g, "''");
}

function main() {
  console.log('从 app_metadata 更新应用名称...\n');

  // 确保 app_name_cache 表存在
  runSql(`
    CREATE TABLE IF NOT EXISTS app_name_cache (
      app_id TEXT NOT NULL,
      app_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      PRIMARY KEY (app_id, platform)
    );
  `, true);

  // 从 app_metadata 读取应用名称
  const metadataOut = runSqlReturn(`
    SELECT app_id, os, name
    FROM app_metadata
    WHERE app_id IS NOT NULL AND name IS NOT NULL AND name != ''
  `);

  const metadataMap = new Map();
  for (const line of (metadataOut || '').trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length >= 3) {
      const appId = parts[0].trim();
      const os = parts[1].trim().toLowerCase();
      const name = parts[2].trim();
      if (appId && name) {
        metadataMap.set(`${appId}|${os}`, name);
      }
    }
  }

  console.log(`从 app_metadata 读取到 ${metadataMap.size} 个应用名称\n`);

  // 更新 apple_top100 表（批量更新，提高效率）
  const iosUpdates = [];
  for (const [key, name] of metadataMap.entries()) {
    const [appId, os] = key.split('|');
    if (os === 'ios') {
      iosUpdates.push({ appId, name });
    }
  }

  if (iosUpdates.length > 0) {
    // 批量更新 iOS
    for (const { appId, name } of iosUpdates) {
      const sql = `
        UPDATE apple_top100
        SET app_name = ${escapeSqlValue(name)}
        WHERE app_id = ${escapeSqlValue(appId)}
          AND (app_name IS NULL OR app_name = '' OR app_name = app_id)
      `;
      runSql(sql, true);
    }
  }

  // 更新 android_top100 表（批量更新，提高效率）
  const androidUpdates = [];
  for (const [key, name] of metadataMap.entries()) {
    const [appId, os] = key.split('|');
    if (os === 'android') {
      androidUpdates.push({ appId, name });
    }
  }

  if (androidUpdates.length > 0) {
    // 批量更新 Android
    for (const { appId, name } of androidUpdates) {
      const sql = `
        UPDATE android_top100
        SET app_name = ${escapeSqlValue(name)}
        WHERE app_id = ${escapeSqlValue(appId)}
          AND (app_name IS NULL OR app_name = '' OR app_name = app_id)
      `;
      runSql(sql, true);
    }
  }

  const iosUpdated = iosUpdates.length;
  const androidUpdated = androidUpdates.length;

  // 更新 app_name_cache 表
  const cacheValues = [];
  for (const [key, name] of metadataMap.entries()) {
    const [appId, os] = key.split('|');
    const platform = os === 'ios' ? 'ios' : 'android';
    cacheValues.push(`('${escapeSqlValue(appId)}','${escapeSqlValue(name)}','${platform}')`);
  }

  if (cacheValues.length > 0) {
    const sql = `
      INSERT OR REPLACE INTO app_name_cache (app_id, app_name, platform)
      VALUES ${cacheValues.join(',')}
    `;
    runSql(sql, true);
  }

  // 统计实际更新的记录数
  const iosActualUpdated = runSqlReturn(`
    SELECT COUNT(*) FROM apple_top100
    WHERE app_name IS NOT NULL AND app_name != '' AND app_name != app_id
  `).trim();

  const androidActualUpdated = runSqlReturn(`
    SELECT COUNT(*) FROM android_top100
    WHERE app_name IS NOT NULL AND app_name != '' AND app_name != app_id
  `).trim();

  console.log(`\n更新完成：`);
  console.log(`  iOS: 处理了 ${iosUpdated} 个应用，实际更新了 ${iosActualUpdated || 0} 条记录`);
  console.log(`  Android: 处理了 ${androidUpdated} 个应用，实际更新了 ${androidActualUpdated || 0} 条记录`);
  console.log(`  app_name_cache: ${cacheValues.length} 条记录已更新`);
}

main();
