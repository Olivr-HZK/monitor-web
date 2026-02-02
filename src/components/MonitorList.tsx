import { useState, useMemo } from 'react';
import type { MonitorItem, MonitorType } from '../types';
import type { GamePlatformKey, CasualGameMainCategory, CasualGameCompetitorSub } from '../types';
import MonitorCard from './MonitorCard';

interface MonitorListProps {
  items: MonitorItem[];
  selectedType?: MonitorType | '全部';
  selectedCompanyName?: string | null;
  /** 休闲游戏检测：选中的大类（新游戏/新玩法/竞品） */
  selectedCasualGameCategory?: CasualGameMainCategory | null;
  /** 休闲游戏检测-新游戏：按平台筛选周报 */
  selectedGamePlatform?: GamePlatformKey | null;
  /** 休闲游戏检测-竞品：选中的小类（社媒更新/UA素材） */
  selectedCasualGameCompetitorSub?: CasualGameCompetitorSub | null;
  /** 自定义页面标题（如 休闲游戏检测 - 新游戏 - 微信） */
  pageTitle?: string;
  /** 标题右侧操作区（如 进入排行榜 按钮） */
  headerAction?: React.ReactNode;
  onItemClick?: (item: MonitorItem) => void;
}

const MonitorList = ({
  items,
  selectedType: propSelectedType,
  selectedCompanyName,
  selectedCasualGameCategory,
  selectedGamePlatform,
  selectedCasualGameCompetitorSub,
  pageTitle,
  headerAction,
  onItemClick
}: MonitorListProps) => {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [internalSelectedType, setInternalSelectedType] = useState<MonitorType | '全部'>('全部');
  const [timeRange, setTimeRange] = useState('过去1周内');
  const [sortBy, setSortBy] = useState('默认排序');

  // 使用prop中的selectedType，如果没有则使用内部状态
  const selectedType = propSelectedType !== undefined ? propSelectedType : internalSelectedType;

  const monitorTypes: MonitorType[] = ['ai热点检测', '热点趋势检测', '休闲游戏检测'];

  // 筛选和排序逻辑
  const filteredAndSortedItems = useMemo(() => {
    let filtered = items;

    // 当为休闲游戏检测时，按大类、平台或竞品小类筛选（优先处理，因竞品-社媒更新需包含周报 type 竞品社媒监控）
    if (selectedType === '休闲游戏检测') {
      // 按大类筛选
      if (selectedCasualGameCategory) {
        // 竞品 - 社媒更新：包含周报（type 竞品社媒监控）+ 休闲游戏检测-竞品-社媒更新
        if (selectedCasualGameCategory === '竞品' && selectedCasualGameCompetitorSub === '社媒更新') {
          filtered = filtered.filter(
            (item) =>
              item.type === '竞品社媒监控' ||
              (item.type === '休闲游戏检测' &&
                item.casualGameCategory === '竞品' &&
                item.casualGameCompetitorSub === '社媒更新')
          );
          // 公司筛选（针对竞品社媒监控周报）
          if (selectedCompanyName) {
            filtered = filtered.filter(
              (item) =>
                item.type !== '竞品社媒监控' || item.companyName === selectedCompanyName
            );
          }
        } else {
          filtered = filtered.filter((item) => item.type === '休闲游戏检测');
          filtered = filtered.filter(
            (item) => item.casualGameCategory === selectedCasualGameCategory
          );
          // 新游戏：按平台进一步筛选周报
          if (selectedCasualGameCategory === '新游戏' && selectedGamePlatform) {
            filtered = filtered.filter((item) => item.platform === selectedGamePlatform);
          }
          // 竞品 - UA素材
          if (selectedCasualGameCategory === '竞品' && selectedCasualGameCompetitorSub === 'UA素材') {
            filtered = filtered.filter(
              (item) => item.casualGameCompetitorSub === 'UA素材'
            );
          }
        }
      } else {
        filtered = filtered.filter((item) => item.type === '休闲游戏检测');
      }
    } else if (selectedType !== '全部') {
      // 非休闲游戏检测：按类型筛选
      filtered = filtered.filter(item => item.type === selectedType);
    }

    // 按时间范围筛选（这里简化处理，实际应该根据date字段计算）
    // 可以后续实现真实的时间筛选逻辑

    // 排序
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case '最新发布':
          return new Date(`${b.date} ${b.time}`).getTime() - new Date(`${a.date} ${a.time}`).getTime();
        case '最受欢迎':
          return b.views - a.views;
        case '互动最多':
          return b.engagement - a.engagement;
        case '评分最高':
          const scoreA = a.score ?? 0;
          const scoreB = b.score ?? 0;
          return scoreB - scoreA;
        case '评分最低':
          const scoreA2 = a.score ?? 0;
          const scoreB2 = b.score ?? 0;
          return scoreA2 - scoreB2;
        default:
          return 0;
      }
    });

    return sorted;
  }, [
    items,
    selectedType,
    selectedCompanyName,
    selectedCasualGameCategory,
    selectedGamePlatform,
    selectedCasualGameCompetitorSub,
    sortBy
  ]);

  return (
    <div className="flex-1">
      {/* Title + optional action */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">
          {pageTitle ?? '监测汇总'}
        </h1>
        {headerAction}
      </div>

      {/* Filters */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option>过去1周内</option>
            <option>过去1个月内</option>
            <option>过去3个月内</option>
            <option>全部时间</option>
          </select>

          <select
            value={selectedType}
            onChange={(e) => {
              const newType = e.target.value as MonitorType | '全部';
              if (propSelectedType === undefined) {
                setInternalSelectedType(newType);
              }
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option>全部分类</option>
            {monitorTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option>默认排序</option>
            <option>最新发布</option>
            <option>最受欢迎</option>
            <option>互动最多</option>
            <option>评分最高</option>
            <option>评分最低</option>
          </select>
        </div>

        {/* Advanced Filters */}
        <button
          onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <svg
            className={`w-4 h-4 transition-transform ${
              showAdvancedFilters ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span>高级筛选</span>
        </button>

        {showAdvancedFilters && (
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">情感分析</label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option>全部</option>
                  <option>正面</option>
                  <option>中性</option>
                  <option>负面</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">趋势方向</label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option>全部</option>
                  <option>上升</option>
                  <option>稳定</option>
                  <option>下降</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="mb-4 text-sm text-gray-600">
        共找到 <span className="font-semibold text-gray-900">{filteredAndSortedItems.length}</span> 条监测数据
      </div>

      {/* Monitor List */}
      <div className="space-y-0">
        {filteredAndSortedItems.length > 0 ? (
          filteredAndSortedItems.map((item) => (
            <MonitorCard key={item.id} item={item} onClick={onItemClick} />
          ))
        ) : (
          <div className="py-12 text-center text-gray-500">
            <p>暂无监测数据</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MonitorList;
