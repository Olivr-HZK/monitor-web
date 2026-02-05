import type { GameRankingItem, GameRankingType } from '../types';

interface GameRankingTableProps {
  items: GameRankingItem[];
  rankingType: GameRankingType;
}

const GameRankingTable = ({ items, rankingType }: GameRankingTableProps) => {
  const getRankChangeDisplay = (change: string) => {
    if (!change || change === '--' || change.trim() === '') {
      return (
        <span className="flex items-center text-gray-400">
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
        <span className="flex items-center text-blue-500 font-semibold">
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
      <span className="text-gray-700 font-medium">{change}</span>
    );
  };

  const isChangeRanking = rankingType === '榜单异动';
  const isCompetitorRanking = rankingType === '竞品动态';
  const isMiniGameRanking = rankingType === '微信小游戏' || rankingType === '抖音小游戏';

  // 微信/抖音小游戏榜单：排名、游戏名称、游戏类型、排名变化、监控日期、开发公司
  if (isMiniGameRanking) {
    return (
      <div className="overflow-x-auto -mx-6">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="border-b-2 border-gray-200 bg-gray-50">
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">排名</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">游戏名称</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">游戏类型</th>
              <th className="text-center py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">排名变化</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">监控日期</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">开发公司</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item, index) => (
              <tr
                key={item.id}
                className={`hover:bg-blue-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
              >
                <td className="py-4 px-6 whitespace-nowrap">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold bg-gray-200 text-gray-700">
                    {item.rank}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <div className="font-semibold text-gray-900 text-base">{item.name}</div>
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-700">
                  {item.category || '—'}
                </td>
                <td className="py-4 px-6 text-center whitespace-nowrap">
                  {getRankChangeDisplay(item.change)}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-700">
                  {item.updateDate || '—'}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-700">
                  {item.developer || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // 竞品动态（AI 品类销售）：排名、产品名称、品类、App ID、Android 下载量、Android 收入
  if (isCompetitorRanking) {
    return (
      <div className="overflow-x-auto -mx-6">
        <table className="w-full min-w-[1000px]">
          <thead>
            <tr className="border-b-2 border-gray-200 bg-gray-50">
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">排名</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">产品名称</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">品类</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">App ID</th>
              <th className="text-right py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">Android 下载量</th>
              <th className="text-right py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">Android 收入（估算）</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item, index) => (
              <tr
                key={item.id}
                className={`hover:bg-blue-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
              >
                <td className="py-4 px-6 whitespace-nowrap">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold bg-gray-200 text-gray-700">
                    {item.rank}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <div className="font-semibold text-gray-900 text-base">{item.name}</div>
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-700">
                  {item.category || '—'}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-700 font-mono">
                  {item.appId || '—'}
                </td>
                <td className="py-4 px-6 text-right whitespace-nowrap text-sm font-medium text-gray-700">
                  {item.downloads || '—'}
                </td>
                <td className="py-4 px-6 text-right whitespace-nowrap text-sm font-medium text-gray-900">
                  {item.score != null ? item.score.toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // 榜单异动：本周 / 上周 / 异动类型，完全按异动 CSV 字段展示
  if (isChangeRanking) {
    return (
      <div className="overflow-x-auto -mx-6">
        <table className="w-full min-w-[1200px]">
          <thead>
            <tr className="border-b-2 border-gray-200 bg-gray-50">
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">信号</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">应用名称</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">App ID</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">国家</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">平台</th>
              <th className="text-right py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">本周排名</th>
              <th className="text-right py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">上周排名</th>
              <th className="text-center py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">变化</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">异动类型</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item, index) => (
              <tr
                key={item.id}
                className={`hover:bg-blue-50 transition-colors ${
                  index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                }`}
              >
                <td className="py-4 px-6 whitespace-nowrap text-lg">
                  {item.signal || '—'}
                </td>
                <td className="py-4 px-6">
                  <div className="font-semibold text-gray-900 text-base">{item.name}</div>
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-700">
                  {item.appId || '—'}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-700">
                  {item.country || '—'}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-700">
                  {item.platformLabel || '—'}
                </td>
                <td className="py-4 px-6 text-right whitespace-nowrap font-semibold text-gray-900">
                  {item.rank}
                </td>
                <td className="py-4 px-6 text-right whitespace-nowrap text-sm text-gray-700">
                  {item.lastRankRaw || '-'}
                </td>
                <td className="py-4 px-6 text-center whitespace-nowrap">
                  {getRankChangeDisplay(item.change)}
                </td>
                <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-700">
                  {item.changeType || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Top Charts：完全按榜单 CSV 字段展示
  return (
    <div className="overflow-x-auto -mx-6">
      <table className="w-full min-w-[1200px]">
        <thead>
            <tr className="border-b-2 border-gray-200 bg-gray-50">
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">排名</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">应用名称</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">App ID</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">平台</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">国家</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">榜单类型</th>
              <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">品类名称</th>
            </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item, index) => (
            <tr
              key={item.id}
              className={`hover:bg-blue-50 transition-colors ${
                index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
              }`}
            >
              <td className="py-4 px-6 whitespace-nowrap">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold bg-gray-200 text-gray-700">
                  {item.rank}
                </span>
              </td>

              <td className="py-4 px-6">
                <div className="font-semibold text-gray-900 text-base">{item.name}</div>
              </td>

              <td className="py-4 px-6">
                <span className="text-sm text-gray-700">{item.appId || '—'}</span>
              </td>

              <td className="py-4 px-6 whitespace-nowrap">
                <span className="text-sm text-gray-700">{item.platformLabel || '—'}</span>
              </td>

              <td className="py-4 px-6 whitespace-nowrap">
                <span className="text-sm text-gray-700">{item.country || '—'}</span>
              </td>
              <td className="py-4 px-6 whitespace-nowrap">
                <span className="text-sm text-gray-700">{item.listType || '—'}</span>
              </td>
              <td className="py-4 px-6 whitespace-nowrap">
                <span className="text-sm text-gray-700">{item.category || '—'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default GameRankingTable;
