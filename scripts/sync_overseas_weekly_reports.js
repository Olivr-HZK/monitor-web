#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const sourceDir =
  process.argv[2] ||
  process.env.OVERSEAS_WEEKLY_SOURCE ||
  '/Users/ggbond/lyb/gaming-daily-report2/output/weekly_reports';
const destDir =
  process.argv[3] ||
  path.join(repoRoot, 'public', '休闲游戏检测', '出海周报');
const stateDir =
  process.env.OVERSEAS_WEEKLY_STATE_DIR ||
  path.resolve(sourceDir, '..', '..', '.runtime', 'cron_state');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toDateOnly(value) {
  const s = String(value || '').trim();
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function generatedMs(report, filePath) {
  const raw = String(report.generated_at || '').replace(' ', 'T');
  const t = raw ? new Date(raw).getTime() : Number.NaN;
  if (Number.isFinite(t)) return t;
  return fs.statSync(filePath).mtimeMs;
}

function markdownLinkLabel(text) {
  return String(text || '未命名来源')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function markdownUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function citedSourceIds(content) {
  const ids = new Set();
  const re = /\[#(\d+)\]/g;
  let match = re.exec(content);
  while (match) {
    ids.add(Number(match[1]));
    match = re.exec(content);
  }
  return Array.from(ids).sort((a, b) => a - b);
}

function buildReferences(content, newsList) {
  const ids = citedSourceIds(content);
  const lines = [];
  for (const id of ids) {
    const source = Array.isArray(newsList) ? newsList[id - 1] : undefined;
    if (!source) continue;
    const title = markdownLinkLabel(source.title);
    const url = markdownUrl(source.link);
    const sourceName = String(source.source || '').trim();
    const date = toDateOnly(source.date);
    const suffix = [sourceName, date].filter(Boolean).join(' · ');
    lines.push(`- [#${id}] ${url ? `[${title}](${url})` : title}${suffix ? ` · ${suffix}` : ''}`);
  }
  if (lines.length === 0) return '';
  return ['---', '', '## 引用来源', '', ...lines].join('\n');
}

function titleFromReport(content, startDate, endDate) {
  const firstLine = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) return firstLine;
  return `Puzzle Game 出海市场周报 | ${startDate} - ${endDate}`;
}

function normalizeReport(filePath, report) {
  const startDate = toDateOnly(report.date_window?.title_start_date || report.date_window?.start);
  const endDate = toDateOnly(report.date_window?.title_end_date || report.date_window?.end_exclusive);
  if (!startDate || !endDate) {
    throw new Error(`缺少周报日期窗口: ${filePath}`);
  }

  const zhContent = String(report.reports?.zh || '').trim();
  if (!zhContent) {
    throw new Error(`缺少中文周报正文: ${filePath}`);
  }

  const generatedAt = String(report.generated_at || '').trim();
  const time = generatedAt.match(/\d{2}:\d{2}/)?.[0] || '';
  const newsCount = Number(report.news_count || 0);
  const title = titleFromReport(zhContent, startDate, endDate);
  const references = buildReferences(zhContent, report.news_list);
  const content = references ? `${zhContent}\n\n${references}` : zhContent;
  const summary = newsCount > 0
    ? `本周跟踪 ${newsCount} 条出海游戏资讯，覆盖竞品动态、玩法机制、AI 探索、买量风向与新兴市场。`
    : stripMarkdown(zhContent).slice(0, 140);
  const id = `overseas-weekly-${startDate}-${endDate}`;

  return {
    id,
    title,
    tags: ['每周出海周报', 'Puzzle', '休闲游戏', '出海市场'],
    date: endDate,
    time,
    source: 'game daily report2',
    summary,
    content,
    meta: {
      kind: 'overseas_weekly',
      startDate,
      endDate,
      generatedAt,
      newsCount,
      sourceFile: path.basename(filePath),
      citedSourceCount: citedSourceIds(zhContent).length,
    },
  };
}

function markerExists(name) {
  const marker = path.join(stateDir, name);
  if (!fs.existsSync(marker)) return false;
  return fs.statSync(marker).size > 0;
}

function publishStateForEndDate(endDate) {
  if (!fs.existsSync(stateDir)) return 'unknown';
  const ok = markerExists(`${endDate}.gaming-weekly-push.ok`);
  if (ok) return 'ok';
  const failed = markerExists(`${endDate}.gaming-weekly-push.failed`);
  if (failed) return 'failed';
  return 'unknown';
}

function main() {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`源目录不存在: ${sourceDir}`);
  }
  fs.mkdirSync(destDir, { recursive: true });

  const candidates = fs
    .readdirSync(sourceDir)
    .filter((name) => /^weekly_report_\d{8}_\d{6}\.json$/.test(name))
    .map((name) => path.join(sourceDir, name));

  const latestByWeek = new Map();
  const skippedFailed = [];
  for (const filePath of candidates) {
    const report = readJson(filePath);
    const startDate = toDateOnly(report.date_window?.title_start_date || report.date_window?.start);
    const endDate = toDateOnly(report.date_window?.title_end_date || report.date_window?.end_exclusive);
    if (!startDate || !endDate || !report.reports?.zh) continue;
    const publishState = publishStateForEndDate(endDate);
    if (publishState === 'failed') {
      skippedFailed.push(`${startDate}_${endDate}`);
      continue;
    }
    const key = `${startDate}_${endDate}`;
    const current = latestByWeek.get(key);
    const nextMs = generatedMs(report, filePath);
    if (!current || nextMs > current.generatedMs) {
      latestByWeek.set(key, { filePath, report, generatedMs: nextMs });
    }
  }

  for (const name of fs.readdirSync(destDir)) {
    if (/^weekly_report_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/.test(name)) {
      fs.unlinkSync(path.join(destDir, name));
    }
  }

  const outputs = Array.from(latestByWeek.values())
    .map(({ filePath, report }) => normalizeReport(filePath, report))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const reportFiles = [];
  for (const doc of outputs) {
    const fileName = `weekly_report_${doc.meta.startDate}_${doc.meta.endDate}.json`;
    fs.writeFileSync(path.join(destDir, fileName), `${JSON.stringify(doc, null, 2)}\n`);
    reportFiles.push(fileName);
  }

  const index = {
    generated_at: new Date().toISOString(),
    source: 'gaming-daily-report2/output/weekly_reports',
    skipped_failed_weeks: Array.from(new Set(skippedFailed)).sort(),
    reports: reportFiles,
  };
  fs.writeFileSync(path.join(destDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Synced ${reportFiles.length} overseas weekly reports to ${destDir}`);
}

main();
