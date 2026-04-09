import { useEffect, useMemo, useState } from 'react';
import type { GameRanking, GameRankingItem, GameRankingType } from '../types';
import GameRankingTable from './GameRankingTable';

/** 空 chart_key 在 select value 中的占位，避免与「全部」混淆 */
const CHART_KEY_EMPTY = '__chart_empty__';

interface GameRankingViewProps {
  rankings: GameRanking[];
  /** 只显示该平台的周榜；不传则显示全部平台标签页 */
  selectedPlatform?: GameRankingType | null;
  /** 从休闲游戏监测跳转时传入，显示返回按钮 */
  onBack?: () => void;
  /** 点击游戏名时跳转（仅微信/抖音小游戏 Top20，如跳转玩法解析页） */
  onGameNameClick?: (gameName: string) => void;
}

const GameRankingView = ({ rankings, selectedPlatform, onBack, onGameNameClick }: GameRankingViewProps) => {
  const [activeTab, setActiveTab] = useState<GameRankingType>(() => rankings[0]?.type ?? '微信小游戏');
  const [platformFilter, setPlatformFilter] = useState<'all' | '微信小游戏' | '抖音小游戏'>('all');
  const [chartBoardFilter, setChartBoardFilter] = useState<'all' | string>('all');

  useEffect(() => {
    if (rankings.length === 0) return;
    setActiveTab((prev) => (rankings.some((r) => r.type === prev) ? prev : rankings[0]!.type));
  }, [rankings]);

  useEffect(() => {
    setChartBoardFilter('all');
  }, [activeTab]);

  const isWechatDouyin = rankings.some(
    (r) => r.type === '微信小游戏' || r.type === '抖音小游戏'
  );

  const activeRanking = selectedPlatform
    ? rankings.find((r) => r.type === selectedPlatform)
    : rankings.find((r) => r.type === activeTab);

  const chartBoardOptions = useMemo(() => {
    if (!activeRanking || activeRanking.type === '榜单异动') return [];
    const m = new Map<string, string>();
    for (const it of activeRanking.items) {
      const k = it.chartKey ?? '';
      if (!m.has(k)) {
        m.set(k, it.listType || (k === '' ? '默认榜' : k));
      }
    }
    return Array.from(m.entries())
      .map(([k, label]) => ({ key: k === '' ? CHART_KEY_EMPTY : k, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  }, [activeRanking]);

  const showChartBoardFilter =
    !selectedPlatform &&
    isWechatDouyin &&
    activeRanking &&
    (activeRanking.type === '微信小游戏' || activeRanking.type === '抖音小游戏') &&
    chartBoardOptions.length > 1;

  const chartFilteredItems: GameRankingItem[] = useMemo(() => {
    if (!activeRanking) return [];
    if (activeRanking.type === '榜单异动') return activeRanking.items;
    if (chartBoardFilter === 'all') return activeRanking.items;
    const want = chartBoardFilter === CHART_KEY_EMPTY ? '' : chartBoardFilter;
    return activeRanking.items.filter((it) => (it.chartKey ?? '') === want);
  }, [activeRanking, chartBoardFilter]);

  const handleExportCsv = () => {
    if (!activeRanking || chartFilteredItems.length === 0) return;

    const type = activeRanking.type;
    const rows: string[] = [];

    if (type === '微信小游戏' || type === '抖音小游戏') {
      const hasBoardCol = chartFilteredItems.some((it) => it.listType || it.chartKey !== undefined);
      const header = hasBoardCol
        ? ['排名', '游戏名称', '榜单', '开发公司', '排名变化', '监控日期']
        : ['排名', '游戏名称', '开发公司', '排名变化', '监控日期'];
      rows.push(header.join(','));
      chartFilteredItems.forEach((item) => {
        const q = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;
        const cols = hasBoardCol
          ? [
              item.rank,
              q(item.name ?? ''),
              q(item.listType ?? ''),
              q(item.developer ?? ''),
              q(item.change ?? ''),
              q(item.updateDate ?? ''),
            ]
          : [
              item.rank,
              q(item.name ?? ''),
              q(item.developer ?? ''),
              q(item.change ?? ''),
              q(item.updateDate ?? ''),
            ];
        rows.push(cols.join(','));
      });
    } else if (type === '榜单异动') {
      rows.push(['当前排名', '游戏名', '平台', '开发公司', '排名变化', '异动类型', '监控日期', '周区间'].join(','));
      chartFilteredItems.forEach((item) => {
        const cols = [
          item.rank,
          `"${(item.name ?? '').replace(/"/g, '""')}"`,
          `"${(item.platformLabel ?? '').replace(/"/g, '""')}"`,
          `"${(item.developer ?? '').replace(/"/g, '""')}"`,
          `"${(item.change ?? '').replace(/"/g, '""')}"`,
          `"${(item.changeType ?? '').replace(/"/g, '""')}"`,
          `"${(item.updateDate ?? '').replace(/"/g, '""')}"`,
          `"${(item.weekRange ?? '').replace(/"/g, '""')}"`,
        ];
        rows.push(cols.join(','));
      });
    } else {
      return;
    }

    const csvContent = rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const datePart = (activeRanking.updateTime || '').split(' ')[0] || 'export';
    const baseName =
      type === '微信小游戏'
        ? 'wechat_minigame_top20'
        : type === '抖音小游戏'
          ? 'douyin_minigame_top20'
          : 'minigame_rank_changes';
    a.href = url;
    a.download = `${baseName}_${datePart}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getTabIcon = (type: GameRankingType) => {
    switch (type) {
      case '微信小游戏':
        return '💬';
      case '抖音小游戏':
        return '🎵';
      case '安卓游戏':
        return '🤖';
      case 'iOS游戏':
        return '🍎';
      case '榜单异动':
        return '📊';
      case '竞品动态':
        return '🏆';
      default:
        return '🎮';
    }
  };

  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            {selectedPlatform
              ? activeRanking?.title ?? '休闲游戏周榜'
              : isWechatDouyin
                ? '微信抖音小游戏排行榜'
                : '休闲游戏排行榜'}
          </h1>
          <p className="text-sm text-slate-600">
            {selectedPlatform
              ? '该平台小游戏周榜'
              : isWechatDouyin
                ? '按平台查看 Top20，可用「榜单」筛选子榜；支持榜单异动'
                : 'US Top Charts & 榜单异动'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center px-3 py-2 rounded-md border border-slate-200 text-sm font-medium text-slate-700 bg-white hover:bg-slate-100 transition-colors"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7 7-7M3 12h18" />
              </svg>
              返回
            </button>
          )}
          {!selectedPlatform && isWechatDouyin && activeRanking && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center px-3 py-2 rounded-md border border-slate-200 text-sm font-medium text-slate-700 bg-white hover:bg-slate-100 transition-colors"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v12a2 2 0 002 2h3m5 0h4a2 2 0 002-2V4M8 4h8m-4 4v8m0 0l-3-3m3 3l3-3" />
              </svg>
              导出 CSV
            </button>
          )}
        </div>
      </div>

      {!selectedPlatform && (
        <div className="border-b border-slate-200 mb-4">
          <nav className="flex space-x-2" aria-label="Tabs">
            {rankings.map((ranking) => (
              <button
                key={ranking.type}
                onClick={() => setActiveTab(ranking.type)}
                className={`
                  px-6 py-4 text-sm font-semibold transition-all relative
                  ${
                    activeTab === ranking.type
                      ? 'text-blue-600'
                      : 'text-slate-500 hover:text-slate-900'
                  }
                `}
              >
                <span className="mr-2 text-lg">{getTabIcon(ranking.type)}</span>
                {ranking.title}
                {activeTab === ranking.type && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"></span>
                )}
              </button>
            ))}
          </nav>
        </div>
      )}

      {!selectedPlatform && isWechatDouyin && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-slate-600">平台：</label>
          <select
            value={platformFilter}
            onChange={(e) => {
              const v = e.target.value as 'all' | '微信小游戏' | '抖音小游戏';
              setPlatformFilter(v);
              if (v === '微信小游戏') setActiveTab('微信小游戏');
              else if (v === '抖音小游戏') setActiveTab('抖音小游戏');
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">全部</option>
            <option value="微信小游戏">微信小游戏</option>
            <option value="抖音小游戏">抖音小游戏</option>
          </select>

          {showChartBoardFilter && (
            <>
              <label className="text-sm font-medium text-slate-600">榜单：</label>
              <select
                value={chartBoardFilter}
                onChange={(e) => setChartBoardFilter(e.target.value as 'all' | string)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[12rem]"
              >
                <option value="all">全部榜单</option>
                {chartBoardOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {activeRanking && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden">
          <div className="px-8 py-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-1">{activeRanking.title}</h2>
                <div className="flex items-center gap-4 text-sm text-slate-600">
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    更新时间：{activeRanking.updateTime}
                  </span>
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md font-medium border border-blue-200">
                    {activeRanking.period}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-slate-900">{chartFilteredItems.length}</div>
                <div className="text-sm text-slate-600">款游戏</div>
              </div>
            </div>
          </div>

          <div className="p-6">
            <GameRankingTable
              items={chartFilteredItems}
              rankingType={activeRanking.type}
              platformFilter={isWechatDouyin ? platformFilter : undefined}
              onGameNameClick={
                onGameNameClick && (activeRanking.type === '微信小游戏' || activeRanking.type === '抖音小游戏')
                  ? (item) => onGameNameClick(item.name)
                  : undefined
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default GameRankingView;
