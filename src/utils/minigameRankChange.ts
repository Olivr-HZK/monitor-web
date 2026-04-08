/**
 * 微信/抖音小游戏 rank_changes 文案解析（与 GameRankingTable 中上周排名逻辑一致）
 */

/** 根据当前排名与「排名变化」推算上周名次；新进榜返回 null（表示上周不在榜内） */
export function computeMinigameLastWeekRank(currentRank: number, change: string): number | null {
  const raw = (change || '').toString().trim();
  if (raw.includes('新进榜')) return null;
  const isDown = raw.includes('↓');
  const numericChange = parseInt(raw.replace(/[^\d]/g, ''), 10);
  const hasNumeric = !Number.isNaN(numericChange) && numericChange > 0;
  if (!hasNumeric) return null;
  return isDown ? currentRank - numericChange : currentRank + numericChange;
}

/**
 * 本周名次在 Top10 内，且上周不在 Top10（含上周不在榜、或上周名次 >10）
 */
export function isNewEntrantToTop10(currentRank: number, change: string): boolean {
  if (currentRank < 1 || currentRank > 10) return false;
  const raw = (change || '').toString().trim();
  if (raw.includes('新进榜')) return true;
  const last = computeMinigameLastWeekRank(currentRank, change);
  if (last === null) return false;
  return last > 10;
}

/** 从「↑N」解析上升幅度；新进榜或非上升返回 -1（不参与飙升排序） */
export function parseMinigameSurgeDelta(change: string): number {
  const raw = (change || '').toString().trim();
  if (raw.includes('新进榜')) return -1;
  if (!raw.includes('↑')) return -1;
  const n = parseInt(raw.replace(/[^\d]/g, ''), 10);
  return Number.isNaN(n) || n <= 0 ? -1 : n;
}
