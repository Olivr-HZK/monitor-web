/**
 * 根据 rank_changes 数据生成 SensorTower 周报列表（MonitorItem[]），用于在「休闲游戏检测 - SensorTower - 周报简要」中展示。
 * 不生成 MD 文件，周报内容直接为 Markdown 字符串，底部带详情链接。
 */

import type { SensorTowerRankChangeItem } from '../types';
import type { MonitorItem } from '../types';

const DETAIL_LINK = 'https://olivr-hzk.github.io/monitor-web/';

function parseSurgeValue(change: string): number {
  if (!change || change === 'NEW') return 0;
  const m = change.trim().match(/↑\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function formatNum(n: number | undefined | null): string {
  if (n == null) return '—';
  if (n >= 10000) return `${(n / 10000).toFixed(2)}万`;
  return n.toLocaleString();
}

function formatRevenue(r: number | undefined | null): string {
  if (r == null) return '—';
  if (r >= 10000) return `$${(r / 10000).toFixed(2)}万`;
  return `$${r.toFixed(0)}`;
}

/** 从异动数据中按周生成周报 Markdown 内容（含新进 Top50、排名飙升 Top10 + 底部详情链接） */
function buildWeekReportMd(
  rankDateCurrent: string,
  rankDateLast: string,
  newTop50: SensorTowerRankChangeItem[],
  surgeTop10: SensorTowerRankChangeItem[]
): string {
  const lines: string[] = [
    `**统计周期**：本周榜单日期 ${rankDateCurrent}，对比上周 ${rankDateLast}。`,
    '',
    '---',
    '',
    '## 一、本周新进 Top50',
    '',
    '当周新进榜单且当前排名在 Top50 内的产品（按当前排名排序）：',
    '',
    '| 排名 | 产品名 | 开发者 | 国家/地区 | 平台 | 下载量 | 收入 |',
    '|------|--------|--------|-----------|------|--------|------|',
  ];
  for (const row of newTop50) {
    const name = row.metadataAppName || row.appName || row.appId;
    const publisher = row.publisherName || '—';
    lines.push(
      `| ${row.currentRank} | ${name} | ${publisher} | ${row.country} | ${row.platform} | ${formatNum(row.downloads)} | ${formatRevenue(row.revenue)} |`
    );
  }
  if (newTop50.length === 0) {
    lines.push('| — | 本周无新进 Top50 记录 | — | — | — | — | — |');
  }
  lines.push(
    '',
    '---',
    '',
    '## 二、本周排名飙升 Top10',
    '',
    '当周排名飙升中，上升幅度最大的 10 款产品：',
    '',
    '| 当前排名 | 上周排名 | 上升幅度 | 产品名 | 开发者 | 国家/地区 | 平台 | 下载量 | 收入 |',
    '|----------|----------|----------|--------|--------|-----------|------|--------|------|',
  );
  for (const row of surgeTop10) {
    const name = row.metadataAppName || row.appName || row.appId;
    const publisher = row.publisherName || '—';
    lines.push(
      `| ${row.currentRank} | ${row.lastWeekRank} | ${row.change} | ${name} | ${publisher} | ${row.country} | ${row.platform} | ${formatNum(row.downloads)} | ${formatRevenue(row.revenue)} |`
    );
  }
  if (surgeTop10.length === 0) {
    lines.push('| — | — | — | 本周无排名飙升记录 | — | — | — | — | — |');
  }
  lines.push(
    '',
    '---',
    '',
    `详情请进入 [${DETAIL_LINK}](${DETAIL_LINK})`,
    '',
  );
  return lines.join('\n');
}

/**
 * 根据异动榜单数据生成 SensorTower 周报列表（按 rank_date_current 分组，每周一条 MonitorItem）。
 */
export function buildSensorTowerWeeklyItems(
  rankChangeItems: SensorTowerRankChangeItem[]
): MonitorItem[] {
  const byWeek = new Map<string, SensorTowerRankChangeItem[]>();
  for (const item of rankChangeItems) {
    const week = item.rankDateCurrent;
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week)!.push(item);
  }

  const weeks = Array.from(byWeek.keys()).sort().reverse();
  const result: MonitorItem[] = [];

  for (const rankDateCurrent of weeks) {
    const items = byWeek.get(rankDateCurrent)!;
    const rankDateLast = items[0]?.rankDateLast ?? '';

    const newTop50 = items
      .filter((i) => i.changeType === '🆕 新进榜单' && i.currentRank <= 50)
      .sort((a, b) => a.currentRank - b.currentRank);

    const surgeAll = items.filter((i) => i.changeType === '🚀 排名飙升');
    surgeAll.sort((a, b) => parseSurgeValue(b.change) - parseSurgeValue(a.change));
    const surgeTop10 = surgeAll.slice(0, 10);

    const content = buildWeekReportMd(rankDateCurrent, rankDateLast, newTop50, surgeTop10);

    result.push({
      id: `sensortower-weekly-${rankDateCurrent}`,
      type: '休闲游戏检测',
      title: `SensorTower 周报（${rankDateCurrent}）`,
      source: 'SensorTower',
      platform: 'SensorTower',
      date: rankDateCurrent,
      time: '',
      views: 0,
      engagement: 0,
      description: `本周新进 Top50 ${newTop50.length} 条，排名飙升 Top10 ${surgeTop10.length} 条。`,
      tags: ['周报', 'SensorTower', '休闲游戏'],
      language: 'zh',
      casualGameCategory: '周报简要',
      casualGameSource: 'sensortower',
      reportContent: JSON.stringify({
        title: `SensorTower 周报（${rankDateCurrent}）`,
        date: rankDateCurrent,
        source: 'SensorTower',
        content,
      }),
    });
  }

  return result;
}
