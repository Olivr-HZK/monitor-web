import { useMemo, useState } from 'react';
import type { GameRankingItem, GameRankingType } from '../types';

interface GameRankingTableProps {
  items: GameRankingItem[];
  rankingType: GameRankingType;
  /** 点击游戏名时回调（仅微信/抖音小游戏榜单时使用，用于跳转玩法解析页） */
  onGameNameClick?: (item: GameRankingItem) => void;
}

const GameRankingTable = ({ items, rankingType, onGameNameClick }: GameRankingTableProps) => {
  const hasWeekRange = items.some((it) => it.weekRange);
  const uniqueWeeks = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => { if (it.weekRange) set.add(it.weekRange); });
    return Array.from(set).sort().reverse();
  }, [items]);
  const [weekFilter, setWeekFilter] = useState<'all' | string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const filteredItems = useMemo(() => {
    let list = items;
    if (weekFilter !== 'all' && hasWeekRange) {
      list = list.filter((it) => it.weekRange === weekFilter);
    }
    const q = searchTerm.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (it) =>
        (it.name && it.name.toLowerCase().includes(q)) ||
        (it.developer && it.developer.toLowerCase().includes(q)) ||
        (it.category && it.category.toLowerCase().includes(q))
    );
  }, [items, weekFilter, hasWeekRange, searchTerm]);
  const getRankChangeDisplay = (change: string) => {
    if (!change || change === '--' || change.trim() === '') {
      return (
        <span className="flex items-center text-slate-400">
          <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
          —
        </span>
      );
    }

    // 如果包含"新进榜"
    if (change.includes('新进榜')) {
      return (
        <span className="flex items-center text-blue-600 font-semibold">
          <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
          </svg>
          新进榜
        </span>
      );
    }

    // 如果包含"↑"
    if (change.includes('↑')) {
      return (
        <span className="flex items-center text-green-500 font-semibold">
          <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          {change}
        </span>
      );
    }

    // 如果包含"↓"
    if (change.includes('↓')) {
      return (
        <span className="flex items-center text-red-500 font-semibold">
          <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          {change}
        </span>
      );
    }

    // 其他情况直接显示
    return (
        <span className="text-slate-700 font-medium">{change}</span>
    );
  };

  const isChangeRanking = rankingType === '榜单异动';
  const isCompetitorRanking = rankingType === '竞品动态';
  const isMiniGameRanking = rankingType === '微信小游戏' || rankingType === '抖音小游戏';

  // 微信/抖音小游戏榜单：排名、游戏名称、游戏类型、排名变化、监控日期、开发公司；多周合并时加周区间列与筛选；支持游戏名搜索
  if (isMiniGameRanking) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">搜索：</label>
            <input
              type="search"
              placeholder="游戏名、开发公司、类型"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48 sm:w-56"
            />
          </div>
          {hasWeekRange && uniqueWeeks.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-600">周区间：</label>
                <select
                  value={weekFilter}
                  onChange={(e) => setWeekFilter(e.target.value as 'all' | string)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="all">全部</option>
                  {uniqueWeeks.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <span className="text-sm text-slate-500">共 {filteredItems.length} 条</span>
        </div>
        <div className="overflow-x-auto -mx-6">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">排名</th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">游戏名称</th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">游戏类型</th>
                <th className="text-center py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">排名变化</th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">监控日期</th>
                {hasWeekRange && <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">周区间</th>}
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">开发公司</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredItems.map((item, index) => (
              <tr
                key={item.id}
                className={`hover:bg-slate-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
              >
                <td className="py-4 px-6 whitespace-nowrap">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold bg-slate-100 text-slate-700">
                    {item.rank}
                  </span>
                </td>
                <td className="py-4 px-6">
                  {onGameNameClick ? (
                    <button
                      type="button"
                      onClick={() => onGameNameClick(item)}
                      className="font-semibold text-slate-900 text-base text-left hover:text-blue-600 hover:underline"
                    >
                      {item.name}
                    </button>
                  ) : (
                    <div className="font-semibold text-slate-900 text-base">{item.name}</div>
                  )}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-slate-600">
                  {item.category || '—'}
                </td>
                <td className="py-4 px-6 text-center whitespace-nowrap">
                  {getRankChangeDisplay(item.change)}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-slate-600">
                  {item.updateDate || '—'}
                </td>
                {hasWeekRange && (
                  <td className="py-4 px-6 whitespace-nowrap text-sm text-slate-600">
                    {item.weekRange || '—'}
                  </td>
                )}
                <td className="py-4 px-6 whitespace-nowrap text-sm text-slate-600">
                  {item.developer || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    );
  }

  // 竞品动态（AI 品类销售）：排名、产品名称、品类、App ID、Android 下载量、Android 收入
  if (isCompetitorRanking) {
    return (
      <div className="overflow-x-auto -mx-6">
        <table className="w-full min-w-[1000px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">排名</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">产品名称</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">品类</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">App ID</th>
              <th className="text-right py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">Android 下载量</th>
              <th className="text-right py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">Android 收入（估算）</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {items.map((item, index) => (
              <tr
                key={item.id}
                className={`hover:bg-slate-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
              >
                <td className="py-4 px-6 whitespace-nowrap">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold bg-slate-100 text-slate-700">
                    {item.rank}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <div className="font-semibold text-slate-900 text-base">{item.name}</div>
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-slate-600">
                  {item.category || '—'}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-slate-600 font-mono">
                  {item.appId || '—'}
                </td>
                <td className="py-4 px-6 text-right whitespace-nowrap text-sm font-medium text-slate-600">
                  {item.downloads || '—'}
                </td>
                <td className="py-4 px-6 text-right whitespace-nowrap text-sm font-medium text-slate-900">
                  {item.score != null ? item.score.toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // 榜单异动：本周 / 上周 / 异动类型；多周合并时加周区间列与筛选；支持游戏名搜索
  if (isChangeRanking) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">搜索：</label>
            <input
              type="search"
              placeholder="游戏名、开发公司"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48 sm:w-56"
            />
          </div>
          {hasWeekRange && uniqueWeeks.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-600">周区间：</label>
                <select
                  value={weekFilter}
                  onChange={(e) => setWeekFilter(e.target.value as 'all' | string)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="all">全部</option>
                  {uniqueWeeks.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <span className="text-sm text-slate-500">共 {filteredItems.length} 条</span>
        </div>
        <div className="overflow-x-auto -mx-6">
          <table className="w-full min-w-[1200px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">信号</th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">应用名称</th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">App ID</th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">国家</th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">平台</th>
                <th className="text-right py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">本周排名</th>
                <th className="text-right py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">上周排名</th>
                <th className="text-center py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">变化</th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">异动类型</th>
                {hasWeekRange && <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">周区间</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredItems.map((item, index) => (
              <tr
                key={item.id}
                className={`hover:bg-slate-50 transition-colors ${
                  index % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                }`}
              >
                <td className="py-4 px-6 whitespace-nowrap text-lg text-slate-700">
                  {item.signal || '—'}
                </td>
                <td className="py-4 px-6">
                  <div className="font-semibold text-slate-900 text-base">{item.name}</div>
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-slate-600">
                  {item.appId || '—'}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-slate-600">
                  {item.country || '—'}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-slate-600">
                  {item.platformLabel || '—'}
                </td>
                <td className="py-4 px-6 text-right whitespace-nowrap font-semibold text-slate-900">
                  {item.rank}
                </td>
                <td className="py-4 px-6 text-right whitespace-nowrap text-sm text-slate-600">
                  {item.lastRankRaw || '-'}
                </td>
                <td className="py-4 px-6 text-center whitespace-nowrap">
                  {getRankChangeDisplay(item.change)}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-slate-600">
                  {item.changeType || '—'}
                </td>
                {hasWeekRange && (
                  <td className="py-4 px-6 whitespace-nowrap text-sm text-slate-600">
                    {item.weekRange || '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    );
  }

  // Top Charts：完全按榜单 CSV 字段展示
  return (
    <div className="overflow-x-auto -mx-6">
      <table className="w-full min-w-[1200px]">
        <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">排名</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">应用名称</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">App ID</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">平台</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">国家</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">榜单类型</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">品类名称</th>
            </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {items.map((item, index) => (
            <tr
              key={item.id}
              className={`hover:bg-slate-50 transition-colors ${
                index % 2 === 0 ? 'bg-white' : 'bg-slate-50'
              }`}
            >
              <td className="py-4 px-6 whitespace-nowrap">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold bg-slate-100 text-slate-700">
                  {item.rank}
                </span>
              </td>

              <td className="py-4 px-6">
                <div className="font-semibold text-slate-900 text-base">{item.name}</div>
              </td>

              <td className="py-4 px-6">
                <span className="text-sm text-slate-600">{item.appId || '—'}</span>
              </td>

              <td className="py-4 px-6 whitespace-nowrap">
                <span className="text-sm text-slate-600">{item.platformLabel || '—'}</span>
              </td>

              <td className="py-4 px-6 whitespace-nowrap">
                <span className="text-sm text-slate-600">{item.country || '—'}</span>
              </td>
              <td className="py-4 px-6 whitespace-nowrap">
                <span className="text-sm text-slate-600">{item.listType || '—'}</span>
              </td>
              <td className="py-4 px-6 whitespace-nowrap">
                <span className="text-sm text-slate-600">{item.category || '—'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default GameRankingTable;
