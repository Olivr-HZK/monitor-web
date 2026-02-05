import { useMemo, useState } from 'react';
import type { SensorTowerTopItem, SensorTowerRankChangeItem } from '../types';

interface SensorTowerTopTableProps {
  items: SensorTowerTopItem[];
  rankChangeItems?: SensorTowerRankChangeItem[];
  onBack?: () => void;
}

type TabKind = 'top100' | 'changes';

const SensorTowerTopTable = ({ items, rankChangeItems = [], onBack }: SensorTowerTopTableProps) => {
  const [activeTab, setActiveTab] = useState<TabKind>('top100');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'iOS' | 'Android'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | string>('all');
  const [countryFilter, setCountryFilter] = useState<'all' | string>('all');
  const [chartTypeFilter, setChartTypeFilter] = useState<'all' | string>('all');
  const [changeTypeFilter, setChangeTypeFilter] = useState<'all' | string>('all');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Top100 筛选与选项
  const top100 = useMemo(() => {
    const dates = new Set<string>();
    const countries = new Set<string>();
    const chartTypes = new Set<string>();
    let filtered = items;
    if (platformFilter !== 'all') filtered = filtered.filter((it) => it.platform === platformFilter);
    filtered.forEach((it) => {
      if (it.rankDate) dates.add(it.rankDate);
      if (it.country) countries.add(it.country);
      if (it.chartType) chartTypes.add(it.chartType);
    });
    if (dateFilter !== 'all') filtered = filtered.filter((it) => it.rankDate === dateFilter);
    if (countryFilter !== 'all') filtered = filtered.filter((it) => it.country === countryFilter);
    if (chartTypeFilter !== 'all') filtered = filtered.filter((it) => it.chartType === chartTypeFilter);
    return {
      filteredItems: filtered,
      uniqueDates: Array.from(dates).sort().reverse(),
      uniqueCountries: Array.from(countries).sort(),
      uniqueChartTypes: Array.from(chartTypes).sort(),
    };
  }, [items, platformFilter, dateFilter, countryFilter, chartTypeFilter]);

  // 异动榜单筛选与选项（平台、日期=当前榜单日期、国家、异动类型）
  const changes = useMemo(() => {
    const dates = new Set<string>();
    const countries = new Set<string>();
    const changeTypes = new Set<string>();
    let filtered = rankChangeItems;
    if (platformFilter !== 'all') filtered = filtered.filter((it) => it.platform === platformFilter);
    filtered.forEach((it) => {
      if (it.rankDateCurrent) dates.add(it.rankDateCurrent);
      if (it.country) countries.add(it.country);
      if (it.changeType) changeTypes.add(it.changeType);
    });
    if (dateFilter !== 'all') filtered = filtered.filter((it) => it.rankDateCurrent === dateFilter);
    if (countryFilter !== 'all') filtered = filtered.filter((it) => it.country === countryFilter);
    if (changeTypeFilter !== 'all') filtered = filtered.filter((it) => it.changeType === changeTypeFilter);
    return {
      filteredItems: filtered,
      uniqueDates: Array.from(dates).sort().reverse(),
      uniqueCountries: Array.from(countries).sort(),
      uniqueChangeTypes: Array.from(changeTypes).sort(),
    };
  }, [rankChangeItems, platformFilter, dateFilter, countryFilter, changeTypeFilter]);

  const isTop100 = activeTab === 'top100';
  const filteredItems = isTop100 ? top100.filteredItems : changes.filteredItems;
  const uniqueDates = isTop100 ? top100.uniqueDates : changes.uniqueDates;
  const uniqueCountries = isTop100 ? top100.uniqueCountries : changes.uniqueCountries;

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageItems = filteredItems.slice(startIndex, startIndex + pageSize);

  const handleFilterChange = <T extends string>(
    setter: (value: T | 'all') => void,
    value: T | 'all'
  ) => {
    setter(value);
    setPage(1);
  };

  const handleTabChange = (tab: TabKind) => {
    setActiveTab(tab);
    setPage(1);
  };

  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1">SensorTower 排行榜</h1>
          <p className="text-sm text-gray-600">
            Top100 榜单与异动榜单，支持按日期、国家、平台及榜单类型/异动类型筛选，每页 10 条。
          </p>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center px-3 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7 7-7M3 12h18" />
            </svg>
            返回
          </button>
        )}
      </div>

      {/* Tab：Top100 | 异动榜单 */}
      <div className="mb-4 flex gap-2 border-b border-gray-200">
        <button
          type="button"
          onClick={() => handleTabChange('top100')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'top100'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          Top100 榜单
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('changes')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'changes'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          异动榜单
        </button>
      </div>

      {/* 筛选：平台、日期、国家、榜单类型( Top100 ) / 异动类型( 异动榜单 ) */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">平台</span>
          <select
            value={platformFilter}
            onChange={(e) => handleFilterChange(setPlatformFilter, e.target.value as 'all' | 'iOS' | 'Android')}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">全部</option>
            <option value="iOS">iOS</option>
            <option value="Android">Android</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">日期</span>
          <select
            value={dateFilter}
            onChange={(e) => handleFilterChange(setDateFilter, e.target.value === 'all' ? 'all' : e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">全部</option>
            {uniqueDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">国家</span>
          <select
            value={countryFilter}
            onChange={(e) => handleFilterChange(setCountryFilter, e.target.value === 'all' ? 'all' : e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">全部</option>
            {uniqueCountries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {isTop100 ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">榜单类型</span>
            <select
              value={chartTypeFilter}
              onChange={(e) =>
                handleFilterChange(setChartTypeFilter, e.target.value === 'all' ? 'all' : e.target.value)
              }
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部</option>
              {top100.uniqueChartTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">异动类型</span>
            <select
              value={changeTypeFilter}
              onChange={(e) =>
                handleFilterChange(setChangeTypeFilter, e.target.value === 'all' ? 'all' : e.target.value)
              }
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部</option>
              {changes.uniqueChangeTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between text-sm text-gray-600">
        <div>
          共 <span className="font-semibold text-gray-900">{filteredItems.length}</span> 条记录，当前第{' '}
          <span className="font-semibold text-gray-900">{currentPage}</span> / {totalPages} 页
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className={`px-3 py-1.5 rounded-md border text-sm ${
              currentPage <= 1
                ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            上一页
          </button>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className={`px-3 py-1.5 rounded-md border text-sm ${
              currentPage >= totalPages
                ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            下一页
          </button>
        </div>
      </div>

      {isTop100 ? (
        <div className="overflow-x-auto -mx-6">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b-2 border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">排名</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">游戏名</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">开发公司</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">发行日期</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">App ID</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">平台</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">国家</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">榜单类型</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">榜单日期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageItems.length > 0 ? (
                (pageItems as SensorTowerTopItem[]).map((item, index) => (
                  <tr
                    key={item.id}
                    className={`hover:bg-blue-50 transition-colors ${
                      index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                    }`}
                  >
                    <td className="py-3 px-6 whitespace-nowrap">
                      <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-sm font-bold bg-gray-200 text-gray-700">
                        {item.rank}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-sm text-gray-800 max-w-[180px] truncate" title={item.appName ?? item.appId}>
                      {item.appName || '—'}
                    </td>
                    <td className="py-3 px-6 text-sm text-gray-800 max-w-[140px] truncate" title={item.publisherName}>
                      {item.publisherName || '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-800">
                      {item.releaseDate || '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm font-mono text-gray-800">
                      {item.appId}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-800">{item.platform}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-800">{item.country}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-800">{item.chartType}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-800">{item.rankDate}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-sm text-gray-500">
                    暂无符合筛选条件的记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-6">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b-2 border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">当前排名</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">上周排名</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">变化</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">异动类型</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">游戏名</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">开发公司</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">发行日期</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">App ID</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">下载量</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">收入</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">国家</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">平台</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-gray-600 uppercase tracking-wider">当前榜单日期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageItems.length > 0 ? (
                (pageItems as SensorTowerRankChangeItem[]).map((item, index) => (
                  <tr
                    key={item.id}
                    className={`hover:bg-blue-50 transition-colors ${
                      index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                    }`}
                  >
                    <td className="py-3 px-6 whitespace-nowrap">
                      <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-sm font-bold bg-gray-200 text-gray-700">
                        {item.currentRank}
                      </span>
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-800">{item.lastWeekRank || '—'}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm font-medium text-gray-800">{item.change}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-800">{item.changeType}</td>
                    <td className="py-3 px-6 text-sm text-gray-800 max-w-[180px] truncate" title={item.metadataAppName ?? item.appName}>
                      {item.metadataAppName || item.appName || '—'}
                    </td>
                    <td className="py-3 px-6 text-sm text-gray-800 max-w-[140px] truncate" title={item.publisherName}>
                      {item.publisherName || '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-800">
                      {item.releaseDate || '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm font-mono text-gray-800">{item.appId}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-right text-gray-800">
                      {item.downloads != null ? item.downloads.toLocaleString() : '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-right text-gray-800">
                      {item.revenue != null ? item.revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-800">{item.country}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-800">{item.platform}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-gray-800">{item.rankDateCurrent}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-sm text-gray-500">
                    暂无符合筛选条件的记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SensorTowerTopTable;
