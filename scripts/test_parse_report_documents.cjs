// CommonJS 版本测试脚本，避免 ESM require 限制

const fs = require('fs');
const path = require('path');

function parseAiReportContent(content) {
  const result = { overview: undefined, entries: [] };
  if (!content) return result;

  const lines = content.replace(/\r\n/g, '\n').split('\n');

  // 总览
  let overviewLines = [];
  let inOverview = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line.startsWith('## 总览')) {
      inOverview = true;
      continue;
    }
    if (inOverview) {
      if (line.startsWith('## ') || line.startsWith('### ')) break;
      overviewLines.push(raw);
    }
  }
  const overviewText = overviewLines.join('\n').trim();
  if (overviewText) result.overview = overviewText;

  // 条目：扫描 "### " 标题
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line.startsWith('### ')) continue;

    let title = line.replace(/^###\s+/, '').trim();
    title = title.replace(/^\d+\.\s*/, '').trim();
    if (!title) title = '未命名条目';

    const bodyLines = [];
    let j = i + 1;
    while (j < lines.length) {
      const nextRaw = lines[j];
      const next = nextRaw.trim();
      if (next.startsWith('### ') || next.startsWith('## ')) break;
      bodyLines.push(nextRaw);
      j++;
    }

    const body = bodyLines.join('\n').trim();
    const logicalLines = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // 评分
    const scoreLine = logicalLines.find((l) => l.startsWith('**评分**'));
    let score;
    if (scoreLine) {
      const m = scoreLine.match(/\*\*评分\*\*：[ \t]*([\d.]+)/);
      score = m ? parseFloat(m[1]) : undefined;
    }

    // 标签
    const tagsLine = logicalLines.find((l) => l.startsWith('**标签**'));
    let tags;
    if (tagsLine) {
      const m = tagsLine.replace(/^\*\*标签\*\*：[ \t]*/, '');
      tags = m
        .split(/[、,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
    }

    // 摘要
    const summaryLine = logicalLines.find((l) => l.startsWith('**摘要**'));
    const summary = summaryLine
      ? summaryLine.replace(/^\*\*摘要\*\*：[ \t]*/, '').trim()
      : undefined;

    // 链接
    const linkLine = logicalLines.find((l) => l.startsWith('**链接**'));
    let link;
    if (linkLine) {
      const urlMatch = linkLine.match(/https?:\/\/[^\s)]+/);
      if (urlMatch) {
        link = urlMatch[0].trim();
      }
    }

    result.entries.push({
      title,
      summary,
      score,
      tags,
      link,
    });

    i = j - 1;
  }

  return result;
}

function main() {
  const filePath = path.join(__dirname, '..', 'public', 'ai热点', 'report_documents.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const arr = JSON.parse(raw);

  console.log('总条数:', arr.length);

  arr.slice(0, 1).forEach((doc, docIndex) => {
    console.log('==== 文档', docIndex, '====');
    console.log('title:', doc.title);
    const parsed = parseAiReportContent(doc.content);
    console.log('overview (截断):', parsed.overview ? parsed.overview.slice(0, 50) + '...' : '(无)');
    console.log('entries count:', parsed.entries.length);
    parsed.entries.slice(0, 3).forEach((e, i) => {
      console.log('--- entry', i, '---');
      console.log('title:', e.title);
      console.log('summary:', e.summary);
      console.log('link:', e.link);
      console.log('tags:', e.tags);
    });
  });
}

main();

