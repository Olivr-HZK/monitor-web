/**
 * 根据 rank_changes 数据生成 SensorTower 周报列表（MonitorItem[]），用于在「休闲游戏监测 - SensorTower - 周报简要」中展示。
 * 不生成 MD 文件，周报内容直接为 Markdown 字符串，底部带详情链接。
 */

import type { SensorTowerRankChangeItem, SensorTowerStoreChangeItem } from '../types';
import type { MonitorItem } from '../types';
import { formatCountryToZh, buildSensorTowerOverviewUrl } from '../utils/rankingLabels';

const DETAIL_LINK = 'https://sites.google.com/castbox.fm/overwatch2/home?authuser=1';

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

function formatNameWithLink(name: string, url?: string): string {
  if (!url) return name;
  return `[${name}](${url})`;
}

function groupByAppId(items: SensorTowerRankChangeItem[]): Map<string, SensorTowerRankChangeItem[]> {
  const map = new Map<string, SensorTowerRankChangeItem[]>();
  for (const item of items) {
    const key = item.appId || item.appName || item.metadataAppName || item.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

/** 从异动数据中按周生成周报 Markdown 内容（新进 Top50、排名飙升 Top10 + 底部详情链接） */
function buildWeekReportMd(
  rankDateCurrent: string,
  rankDateLast: string,
  newTop50: SensorTowerRankChangeItem[],
  surgeTop10: SensorTowerRankChangeItem[]
): string {
  const lines: string[] = [
    `**统计周期**：本周榜单日期 ${rankDateCurrent}，对比上周 ${rankDateLast}（本月内/最近四周）。`,
    '',
  ];
  lines.push(
    '## 一、本周新进 Top50',
    '',
    '当周新进榜单且当前排名在 Top50 内的产品（按当前排名排序）：',
    '',
    '| 排名 | 产品名 | 开发者 | 国家/地区 | 平台 | 下载量 | 收入 |',
    '|------|--------|--------|-----------|------|--------|------|',
  );
  const top50Groups = groupByAppId(newTop50);
  for (const [, group] of top50Groups) {
    const base = group[0];
    const nameRaw = base.metadataAppName || base.appName || base.appId;
    const stUrl = buildSensorTowerOverviewUrl(base.appId, base.country);
    const storeUrl = base.appUrl;
    let name = nameRaw;
    if (storeUrl && stUrl) {
      name = `${formatNameWithLink(nameRaw, storeUrl)} [📊 SensorTower](${stUrl})`;
    } else if (stUrl) {
      name = `[${nameRaw}](${stUrl})`;
    } else if (storeUrl) {
      name = formatNameWithLink(nameRaw, storeUrl);
    }
    const publisher = base.publisherName || '—';
    if (group.length === 1) {
      lines.push(
        `| ${base.currentRank} | ${name} | ${publisher} | ${formatCountryToZh(base.country) || base.country} | ${base.platform} | ${formatNum(base.downloads)} | ${formatRevenue(base.revenue)} |`
      );
    } else {
      const regionRanks = group
        .map((row) => `${formatCountryToZh(row.country) || row.country}：${row.currentRank}`)
        .join('<br>');
      const regionCountries = group
        .map((row) => formatCountryToZh(row.country) || row.country)
        .join('<br>');
      const regionDownloads = group
        .map((row) => `${formatCountryToZh(row.country) || row.country}：${formatNum(row.downloads)}`)
        .join('<br>');
      const regionRevenue = group
        .map((row) => `${formatCountryToZh(row.country) || row.country}：${formatRevenue(row.revenue)}`)
        .join('<br>');
      lines.push(
        `| ${regionRanks} | ${name} | ${publisher} | ${regionCountries} | ${base.platform} | ${regionDownloads} | ${regionRevenue} |`
      );
    }
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
  const surgeGroups = groupByAppId(surgeTop10);
  for (const [, group] of surgeGroups) {
    const base = group[0];
    const nameRaw = base.metadataAppName || base.appName || base.appId;
    const stUrl = buildSensorTowerOverviewUrl(base.appId, base.country);
    const storeUrl = base.appUrl;
    let name = nameRaw;
    if (storeUrl && stUrl) {
      name = `${formatNameWithLink(nameRaw, storeUrl)} [📊 SensorTower](${stUrl})`;
    } else if (stUrl) {
      name = `[${nameRaw}](${stUrl})`;
    } else if (storeUrl) {
      name = formatNameWithLink(nameRaw, storeUrl);
    }
    const publisher = base.publisherName || '—';
    if (group.length === 1) {
      lines.push(
        `| ${base.currentRank} | ${base.lastWeekRank} | ${base.change} | ${name} | ${publisher} | ${formatCountryToZh(base.country) || base.country} | ${base.platform} | ${formatNum(base.downloads)} | ${formatRevenue(base.revenue)} |`
      );
    } else {
      const regionRanks = group
        .map((row) => `${formatCountryToZh(row.country) || row.country}：${row.currentRank}`)
        .join('<br>');
      const regionLastRanks = group
        .map((row) => `${formatCountryToZh(row.country) || row.country}：${row.lastWeekRank || '—'}`)
        .join('<br>');
      const regionChanges = group
        .map((row) => `${formatCountryToZh(row.country) || row.country}：${row.change || '—'}`)
        .join('<br>');
      const regionCountries = group
        .map((row) => formatCountryToZh(row.country) || row.country)
        .join('<br>');
      const regionDownloads = group
        .map((row) => `${formatCountryToZh(row.country) || row.country}：${formatNum(row.downloads)}`)
        .join('<br>');
      const regionRevenue = group
        .map((row) => `${formatCountryToZh(row.country) || row.country}：${formatRevenue(row.revenue)}`)
        .join('<br>');
      lines.push(
        `| ${regionRanks} | ${regionLastRanks} | ${regionChanges} | ${name} | ${publisher} | ${regionCountries} | ${base.platform} | ${regionDownloads} | ${regionRevenue} |`
      );
    }
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
  rankChangeItems: SensorTowerRankChangeItem[],
  storeChangeItems: SensorTowerStoreChangeItem[] = []
): MonitorItem[] {
  const byWeek = new Map<string, SensorTowerRankChangeItem[]>();
  for (const item of rankChangeItems) {
    const week = item.rankDateCurrent;
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week)!.push(item);
  }

  const weeks = Array.from(byWeek.keys()).sort().reverse();
  const result: MonitorItem[] = [];

  const weeksAsc = Array.from(byWeek.keys()).sort();
  const historyTop50 = new Set<string>();
  const filteredNewTop50ByWeek = new Map<string, SensorTowerRankChangeItem[]>();

  for (const rankDateCurrent of weeksAsc) {
    const items = byWeek.get(rankDateCurrent)!;
    const newTop50All = items
      .filter((i) => i.changeType === '🆕 新进榜单' && i.currentRank <= 50)
      .sort((a, b) => a.currentRank - b.currentRank);

    const filtered = newTop50All.filter((i) => {
      const key = `${i.appId}||${i.country}||${i.platform}`;
      return !historyTop50.has(key);
    });
    filteredNewTop50ByWeek.set(rankDateCurrent, filtered);

    for (const i of newTop50All) {
      const key = `${i.appId}||${i.country}||${i.platform}`;
      historyTop50.add(key);
    }
  }

  for (const rankDateCurrent of weeks) {
    const items = byWeek.get(rankDateCurrent)!;
    const rankDateLast = items[0]?.rankDateLast ?? '';

    const newTop50 = filteredNewTop50ByWeek.get(rankDateCurrent) ?? [];

    const surgeAll = items.filter((i) => i.changeType === '🚀 排名飙升');
    surgeAll.sort((a, b) => parseSurgeValue(b.change) - parseSurgeValue(a.change));
    const surgeTop10 = surgeAll.slice(0, 10);

    const content = buildWeekReportMd(rankDateCurrent, rankDateLast, newTop50, surgeTop10);
    const storeChangesForWeek = storeChangeItems
      .filter((c) => c.rankDate === rankDateCurrent)
      .map((c) => ({
        ...c,
        summaries: (c.summaries || []).filter((s) => !/similar_app_ids|similar app|相似/i.test(s)),
      }))
      .filter((c) => (c.summaries || []).length > 0);

    result.push({
      id: `sensortower-weekly-${rankDateCurrent}`,
      type: '休闲游戏监测',
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
        meta: {
          kind: 'sensortower_weekly',
          storeChanges: storeChangesForWeek.map((c) => ({
            id: c.id,
            appName: c.appName,
            platform: c.platform,
            changedAt: c.changedAt || c.rankDate,
            storeUrl: c.storeUrl,
            summaries: c.summaries,
          })),
        },
      }),
    });
  }

  return result;
}
