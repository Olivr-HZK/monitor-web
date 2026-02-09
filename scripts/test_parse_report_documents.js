// 简单测试脚本：在 Node 环境下解析 public/ai热点/report_documents.json
// 并打印前几条条目的 标题 / 摘要 / 链接，验证解析逻辑是否正确

const fs = require('fs');
const path = require('path');

function parseAiReportContent(content) {
  const result = { overview: undefined, entries: [] };
  if (!content) return result;

  const text = content.replace(/\r\n/g, '\n');

  // 总览
  const overviewMatch = text.match(
    /##\s*总览\s*\n([\s\S]*?)(?=^##\s*(条目|Top 3|其他高分)|^###\s+\d+\.|\s*$)/m
  );
  if (overviewMatch && overviewMatch[1]) {
    result.overview = overviewMatch[1].trim();
  }

  // 条目：### n. 标题
  const entryRegex = /^###\s+(?:\d+\.\s*)?(.*)\n([\s\S]*?)(?=^###\s+\d+\.|\s*$)/gm;
  let match;

  while ((match = entryRegex.exec(text)) !== null) {
    const title = (match[1] || '').trim() || '未命名条目';
    const body = (match[2] || '').trim();

    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // 评分
    const scoreLine = lines.find((l) => l.startsWith('**评分**'));
    let score;
    if (scoreLine) {
      const m = scoreLine.match(/\*\*评分\*\*：[ \t]*([\d.]+)/);
      score = m ? parseFloat(m[1]) : undefined;
    }

    // 标签
    const tagsLine = lines.find((l) => l.startsWith('**标签**'));
    let tags;
    if (tagsLine) {
      const m = tagsLine.replace(/^\*\*标签\*\*：[ \t]*/, '');
      tags = m
        .split(/[、,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
    }

    // 摘要
    const summaryLine = lines.find((l) => l.startsWith('**摘要**'));
    const summary = summaryLine
      ? summaryLine.replace(/^\*\*摘要\*\*：[ \t]*/, '').trim()
      : undefined;

    // 链接
    const linkLine = lines.find((l) => l.startsWith('**链接**'));
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

