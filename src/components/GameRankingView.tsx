import { useState } from 'react';
import type { GameRanking, GameRankingType } from '../types';
import GameRankingTable from './GameRankingTable';

interface GameRankingViewProps {
  rankings: GameRanking[];
  /** 只显示该平台的周榜；不传则显示全部平台标签页 */
  selectedPlatform?: GameRankingType | null;
  /** 从休闲游戏监测跳转时传入，显示返回按钮 */
  onBack?: () => void;
  /** 点击游戏名时跳转（仅微信/抖音小游戏时使用，如跳转玩法解析页） */
  onGameNameClick?: (gameName: string) => void;
}

const GameRankingView = ({ rankings, selectedPlatform, onBack, onGameNameClick }: GameRankingViewProps) => {
  const [activeTab, setActiveTab] = useState<GameRankingType>(
    rankings[0]?.type || '微信小游戏'
  );

  const activeRanking = selectedPlatform
    ? rankings.find(r => r.type === selectedPlatform)
    : rankings.find(r => r.type === activeTab);

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
      {/* 标题 + 返回按钮（从周报页跳转时显示） */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            {selectedPlatform ? activeRanking?.title ?? '休闲游戏周榜' : '休闲游戏排行榜'}
          </h1>
          <p className="text-sm text-slate-600">
            {selectedPlatform
              ? '该平台小游戏周榜'
              : 'US Top Charts & 榜单异动'}
          </p>
        </div>
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
      </div>

      {/* 仅当未指定平台时显示标签页切换 */}
      {!selectedPlatform && (
        <div className="border-b border-slate-200 mb-6">
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

      {/* 排行榜内容 */}
      {activeRanking && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden">
          {/* 排行榜头部信息 */}
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
                <div className="text-2xl font-bold text-slate-900">{activeRanking.items.length}</div>
                <div className="text-sm text-slate-600">款游戏</div>
              </div>
            </div>
          </div>

          {/* 排行榜表格 */}
          <div className="p-6">
            <GameRankingTable
              items={activeRanking.items}
              rankingType={activeRanking.type}
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
