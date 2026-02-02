import type { GameRankingItem } from '../types';

interface GameRankingTableProps {
  items: GameRankingItem[];
}

const GameRankingTable = ({ items }: GameRankingTableProps) => {
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

  const getRankBadgeColor = (rank: number) => {
    if (rank === 1) return 'bg-yellow-500 text-white';
    if (rank === 2) return 'bg-gray-400 text-white';
    if (rank === 3) return 'bg-orange-500 text-white';
    return 'bg-gray-200 text-gray-700';
  };

  return (
    <div className="overflow-x-auto -mx-6">
      <table className="w-full min-w-[1200px]">
        <thead>
          <tr className="border-b-2 border-gray-200 bg-gray-50">
            <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">排名</th>
            <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">游戏名称</th>
            <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">开发商</th>
            <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">分类</th>
            <th className="text-center py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">排名变化</th>
            <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">玩法机制</th>
            <th className="text-left py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">基线微调创新点</th>
            <th className="text-right py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">评分</th>
            <th className="text-right py-4 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">下载量</th>
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
              {/* 排名 */}
              <td className="py-4 px-6 whitespace-nowrap">
                <span
                  className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold ${getRankBadgeColor(item.rank)}`}
                >
                  {item.rank}
                </span>
              </td>

              {/* 游戏名称 */}
              <td className="py-4 px-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-purple-500 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-md">
                    {item.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 text-base">{item.name}</div>
                  </div>
                </div>
              </td>

              {/* 开发商 */}
              <td className="py-4 px-6">
                <span className="text-sm text-gray-700">{item.developer}</span>
              </td>

              {/* 分类 */}
              <td className="py-4 px-6 whitespace-nowrap">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  {item.category}
                </span>
              </td>

              {/* 变化 */}
              <td className="py-4 px-6 text-center whitespace-nowrap">
                {getRankChangeDisplay(item.change)}
              </td>

              {/* 玩法机制 */}
              <td className="py-4 px-6 max-w-xs">
                {item.mechanism ? (
                  <div className="text-sm text-gray-700 line-clamp-2" title={item.mechanism}>
                    {item.mechanism}
                  </div>
                ) : (
                  <span className="text-sm text-gray-400">—</span>
                )}
              </td>

              {/* 基线微调创新点 */}
              <td className="py-4 px-6 max-w-xs">
                {item.microInnovations ? (
                  <div className="text-sm text-gray-700 line-clamp-2" title={item.microInnovations}>
                    {item.microInnovations}
                  </div>
                ) : (
                  <span className="text-sm text-gray-400">—</span>
                )}
              </td>

              {/* 评分 */}
              <td className="py-4 px-6 text-right whitespace-nowrap">
                {item.score && (
                  <div className="flex items-center justify-end gap-1.5">
                    <svg className="w-5 h-5 text-yellow-400 fill-current" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <span className="text-sm font-bold text-gray-900">{item.score}</span>
                  </div>
                )}
              </td>

              {/* 下载量 */}
              <td className="py-4 px-6 text-right whitespace-nowrap">
                <span className="text-sm font-medium text-gray-700">{item.downloads}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default GameRankingTable;
