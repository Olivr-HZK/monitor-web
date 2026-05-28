#!/usr/bin/env node
/**
 * 从 sensortower_top100.db 读取最近四周的 Top100 榜单，汇总每个榜单（平台/国家/类型）当前 Top5
 * 的一个月内排名趋势，调用 OpenRouter 生成一段「Top5 异动综述」，写入表 weekly_top5_overview。
 *
 * 逻辑：
 *   - 入参：本周一 rank_date（YYYY-MM-DD），可选；未传则取库中最新 rank_date。
 *   - 对 apple_top100 / android_top100 各取最近 4 个 rank_date（<= 本周一）。
 *   - 对每个 (platform, country, chart_type)，取「当前周」排名 1～5 的 app，再取这些 app 在四周内的 (rank_date, rank)。
 *   - 调用 OpenRouter（.env 中 OPENROUTER_API_KEY、OPENROUTER_MODEL，缺省可用 moonshotai/kimi-k2.5）生成 2～4 句中文综述。
 *   - 写入表 weekly_top5_overview：rank_date, statement, trend_json, model_used, created_at。
 *
 * 用法：
 *   node generate_top5_overview.js
 *   node generate_top5_overview.js 2026-03-02
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

const RANK_WEEKS_LIMIT = 4;

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

function loadOpenRouterConfig() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, 'utf8');
  let key = null;
  let baseUrl = null;
  let model = null;
  for (const line of content.split('\n')) {
    const m1 = line.match(/^\s*OPENROUTER_API_KEY\s*=\s*(.+)\s*$/);
    const m2 = line.match(/^\s*OPENROUTER_API_TOKEN\s*=\s*(.+)\s*$/);
    const m3 = line.match(/^\s*OPENROUTER_BASE_URL\s*=\s*(.+)\s*$/);
    const m4 = line.match(/^\s*OPENROUTER_MODEL\s*=\s*(.+)\s*$/);
    if (m1) key = m1[1].trim().replace(/^["']|["']$/g, '');
    if (m2 && !key) key = m2[1].trim().replace(/^["']|["']$/g, '');
    if (m3) baseUrl = m3[1].trim().replace(/^["']|["']$/g, '');
    if (m4) model = m4[1].trim().replace(/^["']|["']$/g, '');
  }
  if (!key) return null;
  let fallback = null;
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*OPENROUTER_FALLBACK_MODEL\s*=\s*(.+)\s*$/);
    if (m) fallback = m[1].trim().replace(/^["']|["']$/g, '') || null;
  }
  return {
    apiKey: key,
    baseUrl: baseUrl || 'https://openrouter.ai/api/v1',
    model: model || 'qwen/qwen3-32b',
    fallbackModel: fallback || 'qwen/qwen3-30b-a3b',
  };
}

function getLastRankDates(table, currentMonday, limit) {
  const safeDate = currentMonday.replace(/'/g, "''");
  const out = runSqlReturn(`
    SELECT DISTINCT rank_date FROM ${table}
    WHERE rank_date <= '${safeDate}'
    ORDER BY rank_date DESC LIMIT ${limit};
  `);
  const list = [];
  for (const line of (out || '').trim().split('\n')) {
    const d = (line || '').trim();
    if (d) list.push(d);
  }
  return list;
}

function loadAppMetadata() {
  const out = runSqlReturn('SELECT app_id, os, name FROM app_metadata');
  const map = {};
  for (const line of (out || '').trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length < 3) continue;
    const appId = String(parts[0]).trim();
    const os = String(parts[1] || '').trim().toLowerCase();
    const name = (parts[2] || '').trim();
    if (appId && os) map[appId + '\t' + os] = name || appId;
  }
  return map;
}

function collectTop5Trends(currentMonday) {
  const meta = loadAppMetadata();
  const tables = [
    ['apple_top100', 'iOS', 'ios'],
    ['android_top100', 'Android', 'android'],
  ];
  const result = [];

  for (const [table, platform, osKey] of tables) {
    const dates = getLastRankDates(table, currentMonday, RANK_WEEKS_LIMIT);
    if (dates.length === 0) continue;
    const latestDate = dates[0];
    const placeholders = dates.map(() => '?').join(',');
    const out = runSqlReturn(`
      SELECT country, chart_type, rank, app_id
      FROM ${table}
      WHERE rank_date = ${escapeSqlValue(latestDate)} AND rank BETWEEN 1 AND 5
      ORDER BY country, chart_type, rank
    `);
    const rows = [];
    for (const line of (out || '').trim().split('\n')) {
      if (!line) continue;
      const p = line.split('|');
      if (p.length < 4) continue;
      rows.push({
        country: p[0].trim(),
        chart_type: p[1].trim(),
        rank: parseInt(p[2], 10) || 0,
        app_id: p[3].trim(),
      });
    }
    const byGroup = {};
    for (const r of rows) {
      const key = r.country + '\t' + r.chart_type;
      if (!byGroup[key]) byGroup[key] = [];
      byGroup[key].push({ rank: r.rank, app_id: r.app_id });
    }
    for (const key of Object.keys(byGroup)) {
      const [country, chart_type] = key.split('\t');
      const apps = byGroup[key].sort((a, b) => a.rank - b.rank);
      const appIds = apps.map((a) => a.app_id);
      const idsList = appIds.map((id) => escapeSqlValue(id)).join(',');
      const datesList = dates.map((d) => escapeSqlValue(d)).join(',');
      const trendOut = runSqlReturn(`
        SELECT app_id, rank_date, rank FROM ${table}
        WHERE rank_date IN (${datesList}) AND app_id IN (${idsList})
        ORDER BY app_id, rank_date DESC
      `);
      const byApp = {};
      for (const line of (trendOut || '').trim().split('\n')) {
        if (!line) continue;
        const p = line.split('|');
        if (p.length < 3) continue;
        const appId = p[0].trim();
        if (!byApp[appId]) byApp[appId] = [];
        byApp[appId].push({ rank_date: p[1].trim(), rank: parseInt(p[2], 10) || 0 });
      }
      const top5 = apps.map(({ rank: current_rank, app_id }) => {
        const trend = (byApp[app_id] || []).slice();
        trend.sort((a, b) => (a.rank_date > b.rank_date ? -1 : 1));
        const name = meta[app_id + '\t' + osKey] || app_id;
        return { app_id, name, current_rank, trend };
      });
      result.push({ platform, country, chart_type, top5 });
    }
  }
  return result;
}

function buildOverviewUrl(appId, country) {
  const base = (process.env.SENSORTOWER_OVERVIEW_BASE || 'https://app.sensortower-china.com').replace(/\/$/, '');
  const code = (country || 'US').trim() || 'US';
  return `${base}/overview/${appId}?country=${code}`;
}

function buildPrompt(data) {
  const seen = new Set();
  const linkEntries = [];
  for (const group of data) {
    const country = (group.country || 'US').trim() || 'US';
    for (const item of group.top5 || []) {
      const appId = (item.app_id || '').trim();
      const name = (item.name || appId).trim() || appId;
      if (!appId) continue;
      const k = name + '\t' + appId + '\t' + country;
      if (seen.has(k)) continue;
      seen.add(k);
      linkEntries.push({ name, url: buildOverviewUrl(appId, country) });
    }
  }
  const lines = [
    '以下为 SensorTower 休闲游戏 Top100 榜单中，各榜单（平台/国家/类型）当前排名前五的游戏，以及其最近四周的排名趋势。',
    '每个游戏带有 current_rank（当前周排名，1=榜首 2=第二 … 5=第五），trend 为按时间从新到旧的 (rank_date, rank) 列表，第一条即「当前周」数据。',
    '',
    '请严格根据数据写一段「Top5 异动综述」（2～4 句中文）：',
    '1. 「登顶」仅指：当前周 current_rank 为 1，且 trend 中前一周或更早曾出现过 rank 非 1（即本周新上第一）。若某游戏 current_rank 不是 1，切勿说其登顶。',
    '2. 「掉出第一」仅指：当前周 current_rank 非 1，且 trend 中前一周 rank 为 1（即本周从第一滑落）。',
    '3. 可概括整体趋势（谁在上升、谁在下降、是否稳定），不要列举具体数字。',
    '',
    '陈述中提到具体游戏时，请使用 Markdown 链接格式 [游戏名](链接)。下面为可用游戏名及链接（不必全用）：',
  ];
  for (const e of linkEntries) {
    lines.push(`- ${e.name}：${e.url}`);
  }
  lines.push('', '数据（JSON）：', JSON.stringify(data, null, 2));
  return lines.join('\n');
}

function buildOpenRouterChatUrl(baseUrl) {
  const normalized = String(baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  // 不能用 new URL('/chat/completions', baseUrl)，否则会把 /api/v1 截掉，打到 HTML 错误页。
  return new URL(normalized + '/chat/completions');
}

function extractMessageText(content) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && typeof item.text === 'string') return item.text;
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

function callOpenRouter(cfg, prompt, useFallbackModel = false) {
  const model = useFallbackModel ? (cfg.fallbackModel || 'qwen/qwen3-30b-a3b') : cfg.model;
  return new Promise((resolve, reject) => {
    const url = buildOpenRouterChatUrl(cfg.baseUrl);
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.5,
    });
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
    };
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`OpenRouter HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        }
        const trimmed = (data || '').trim();
        if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
          return reject(new Error('OpenRouter 返回 HTML 而非 JSON，可能为错误页或网关异常'));
        }
        try {
          const json = JSON.parse(data);
          const content =
            json && json.choices && json.choices[0] && json.choices[0].message
              ? json.choices[0].message.content
              : null;
          const text = extractMessageText(content);
          if (!text) {
            const preview = JSON.stringify(json).slice(0, 500);
            return reject(new Error('OpenRouter 返回空内容，响应片段: ' + preview));
          }
          resolve(text);
        } catch (e) {
          reject(new Error('OpenRouter 响应解析失败: ' + (trimmed ? trimmed.slice(0, 80) : e.message)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function ensureTable() {
  runSql(`
    CREATE TABLE IF NOT EXISTS weekly_top5_overview (
      rank_date TEXT PRIMARY KEY,
      statement TEXT NOT NULL,
      trend_json TEXT,
      model_used TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function getLatestRankDate() {
  let out = runSqlReturn('SELECT MAX(rank_date) FROM apple_top100');
  if (!(out || '').trim()) {
    out = runSqlReturn('SELECT MAX(rank_date) FROM android_top100');
  }
  const v = (out || '').trim();
  if (!v) return null;
  return v.split('\n')[0].trim();
}

async function main() {
  let currentMonday = process.argv[2] ? process.argv[2].trim() : null;
  if (!currentMonday || !/^\d{4}-\d{2}-\d{2}$/.test(currentMonday)) {
    currentMonday = getLatestRankDate();
    if (!currentMonday) {
      console.error('库中无 rank_date 数据，请先运行 fetch_top100_to_db.js');
      process.exit(1);
    }
  }

  console.log('Top5 异动综述：当前周 rank_date =', currentMonday);

  ensureTable();

  const data = collectTop5Trends(currentMonday);
  if (data.length === 0) {
    console.log('未获取到任何 Top5 趋势数据，跳过写入 weekly_top5_overview');
    return;
  }

  const cfg = loadOpenRouterConfig();
  let statement = '';
  let modelUsed = '';

  if (cfg) {
    try {
      console.log('调用 OpenRouter 生成综述，模型:', cfg.model);
      statement = await callOpenRouter(cfg, buildPrompt(data));
      modelUsed = cfg.model;
    } catch (e) {
      console.error('OpenRouter 主模型调用失败:', e.message);
      try {
        console.log('使用 fallback 模型重试:', cfg.fallbackModel || 'qwen/qwen3-30b-a3b');
        statement = await callOpenRouter(cfg, buildPrompt(data), true);
        modelUsed = cfg.fallbackModel || 'qwen/qwen3-30b-a3b';
      } catch (e2) {
        console.error('Fallback 模型调用失败:', e2.message);
        throw new Error('Top5 异动综述生成失败：' + e2.message);
      }
    }
  } else {
    throw new Error('未配置 OPENROUTER_API_KEY，跳过写入 weekly_top5_overview');
  }

  if (!statement || !statement.trim()) {
    throw new Error('Top5 异动综述为空，跳过写入 weekly_top5_overview');
  }

  const trendJson = JSON.stringify(data, null, 0);
  runSql(`
    INSERT OR REPLACE INTO weekly_top5_overview (rank_date, statement, trend_json, model_used)
    VALUES (
      ${escapeSqlValue(currentMonday)},
      ${escapeSqlValue(statement)},
      ${escapeSqlValue(trendJson)},
      ${escapeSqlValue(modelUsed)}
    )
  `);
  console.log('已写入 weekly_top5_overview，rank_date =', currentMonday);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
