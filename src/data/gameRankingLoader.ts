/**
 * 游戏排行榜数据加载器
 * 从CSV文件加载游戏排行榜数据
 */

import Papa from 'papaparse';
import type { GameRanking, GameRankingItem, GameRankingType } from '../types';

interface CSVRow {
  周区间: string;
  平台: string;
  来源: string;
  榜单: string;
  地区: string;
  排名: string;
  游戏名称: string;
  游戏类型: string;
  标签: string;
  热度指数: string;
  监控日期: string;
  发布时间: string;
  开发公司: string;
  排名变化: string;
  核心玩法_mechanism?: string;
  核心玩法_operation?: string;
  核心玩法_rules?: string;
  核心玩法_features?: string;
  基线_base_genre?: string;
  基线_baseline_loop?: string;
  基线_micro_innovations?: string;
}

/**
 * 将平台代码映射到排行榜类型
 */
function mapPlatformToRankingType(platform: string): GameRankingType | null {
  const platformMap: Record<string, GameRankingType> = {
    'android': '安卓游戏',
    'ios': 'iOS游戏',
    'dy': '抖音小游戏',
    'wx': '微信小游戏',
  };
  return platformMap[platform.toLowerCase()] || null;
}


/**
 * 格式化日期
 */
function formatDate(dateStr: string): string {
  if (!dateStr || dateStr === '--') {
    return new Date().toISOString().split('T')[0];
  }
  // 如果日期格式是 2026-01-27，直接返回
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dateStr;
  }
  return dateStr;
}

/**
 * 从CSV文件加载游戏排行榜数据
 */
export async function loadGameRankingsFromCSV(filePath: string): Promise<GameRanking[]> {
  try {
    const opts = filePath.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
    const response = await fetch(filePath, opts);
    if (!response.ok) {
      throw new Error(`Failed to fetch CSV file: ${response.statusText}`);
    }
    const text = await response.text();

    return new Promise((resolve, reject) => {
      Papa.parse<CSVRow>(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            // 按平台分组数据
            const rankingsMap = new Map<GameRankingType, GameRankingItem[]>();

            // 用于去重：同一平台、同一排名、同一游戏名称只保留一个
            const seenItems = new Set<string>();

            results.data.forEach((row, index) => {
              const platform = row.平台?.trim();
              if (!platform) return;

              const rankingType = mapPlatformToRankingType(platform);
              if (!rankingType) return;

              const rank = parseInt(row.排名?.trim() || '0', 10);
              if (isNaN(rank) || rank === 0) return;

              const gameName = row.游戏名称?.trim() || '';
              if (!gameName) return;

              // 创建唯一键用于去重
              const uniqueKey = `${rankingType}-${rank}-${gameName}`;
              if (seenItems.has(uniqueKey)) {
                return; // 跳过重复项
              }
              seenItems.add(uniqueKey);

              // 排名变化：直接使用原始字符串
              const changeStr = row.排名变化?.trim() || '--';
              
              // 玩法机制：合并四个字段
              const mechanismParts: string[] = [];
              if (row.核心玩法_mechanism?.trim()) mechanismParts.push(row.核心玩法_mechanism.trim());
              if (row.核心玩法_operation?.trim()) mechanismParts.push(row.核心玩法_operation.trim());
              if (row.核心玩法_rules?.trim()) mechanismParts.push(row.核心玩法_rules.trim());
              if (row.核心玩法_features?.trim()) mechanismParts.push(row.核心玩法_features.trim());
              const mechanism = mechanismParts.length > 0 ? mechanismParts.join('；') : undefined;

              // 基线创新点：合并三个字段
              const baselineParts: string[] = [];
              if (row.基线_base_genre?.trim()) baselineParts.push(row.基线_base_genre.trim());
              if (row.基线_baseline_loop?.trim()) baselineParts.push(row.基线_baseline_loop.trim());
              if (row.基线_micro_innovations?.trim()) baselineParts.push(row.基线_micro_innovations.trim());
              const microInnovations = baselineParts.length > 0 ? baselineParts.join('；') : undefined;

              const item: GameRankingItem = {
                id: `${platform}-${index}-${rank}`,
                rank,
                name: gameName,
                developer: row.开发公司?.trim() || '--',
                category: row.游戏类型?.trim() || '--',
                change: changeStr,
                updateDate: formatDate(row.监控日期?.trim() || ''),
                mechanism,
                microInnovations,
              };

              // 如果有热度指数，可以转换为score
              if (row.热度指数 && row.热度指数.trim() !== '') {
                const score = parseFloat(row.热度指数.trim());
                if (!isNaN(score)) {
                  item.score = score;
                }
              }

              // 添加到对应排行榜
              if (!rankingsMap.has(rankingType)) {
                rankingsMap.set(rankingType, []);
              }
              rankingsMap.get(rankingType)!.push(item);
            });

            // 转换为GameRanking数组
            const rankings: GameRanking[] = [];

            // 微信小游戏
            if (rankingsMap.has('微信小游戏')) {
              const items = rankingsMap.get('微信小游戏')!;
              items.sort((a, b) => a.rank - b.rank);
              rankings.push({
                type: '微信小游戏',
                title: '微信小游戏周榜',
                updateTime: items[0]?.updateDate ? `${items[0].updateDate} 14:00` : new Date().toISOString(),
                period: '周榜',
                items: items.slice(0, 50), // 限制前50名
              });
            }

            // 抖音小游戏
            if (rankingsMap.has('抖音小游戏')) {
              const items = rankingsMap.get('抖音小游戏')!;
              items.sort((a, b) => a.rank - b.rank);
              rankings.push({
                type: '抖音小游戏',
                title: '抖音小游戏周榜',
                updateTime: items[0]?.updateDate ? `${items[0].updateDate} 14:00` : new Date().toISOString(),
                period: '周榜',
                items: items.slice(0, 50),
              });
            }

            // 安卓游戏
            if (rankingsMap.has('安卓游戏')) {
              const items = rankingsMap.get('安卓游戏')!;
              items.sort((a, b) => a.rank - b.rank);
              rankings.push({
                type: '安卓游戏',
                title: '安卓游戏排行榜',
                updateTime: items[0]?.updateDate ? `${items[0].updateDate} 14:00` : new Date().toISOString(),
                period: '周榜',
                items: items.slice(0, 50),
              });
            }

            // iOS游戏
            if (rankingsMap.has('iOS游戏')) {
              const items = rankingsMap.get('iOS游戏')!;
              items.sort((a, b) => a.rank - b.rank);
              rankings.push({
                type: 'iOS游戏',
                title: 'iOS游戏排行榜',
                updateTime: items[0]?.updateDate ? `${items[0].updateDate} 14:00` : new Date().toISOString(),
                period: '周榜',
                items: items.slice(0, 50),
              });
            }

            resolve(rankings);
          } catch (error) {
            reject(error);
          }
        },
        error: (error: Error) => {
          reject(new Error(`CSV parsing error: ${error.message}`));
        },
      });
    });
  } catch (error) {
    console.error('Error loading game rankings from CSV:', error);
    throw error;
  }
}
