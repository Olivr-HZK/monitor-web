import { useMemo, useState } from 'react';
import type { SensorTowerTopItem, SensorTowerRankChangeItem, SensorTowerStoreChangeItem } from '../types';

interface SensorTowerTopTableProps {
  items: SensorTowerTopItem[];
  rankChangeItems?: SensorTowerRankChangeItem[];
  storeChanges?: SensorTowerStoreChangeItem[];
  onBack?: () => void;
}

type TabKind = 'top100' | 'changes' | 'store_changes';

const SensorTowerTopTable = ({ items, rankChangeItems = [], storeChanges = [], onBack }: SensorTowerTopTableProps) => {
  const [activeTab, setActiveTab] = useState<TabKind>('top100');
  const [top100Filters, setTop100Filters] = useState({
    platform: 'all' as 'all' | 'iOS' | 'Android',
    date: 'all' as 'all' | string,
    country: 'all' as 'all' | string,
    chartType: 'all' as 'all' | string,
    search: '',
    page: 1,
  });
  const [changesFilters, setChangesFilters] = useState({
    platform: 'all' as 'all' | 'iOS' | 'Android',
    date: 'all' as 'all' | string,
    country: 'all' as 'all' | string,
    changeType: 'all' as 'all' | string,
    search: '',
    page: 1,
  });
  const [storeFilters, setStoreFilters] = useState({
    platform: 'all' as 'all' | 'iOS' | 'Android',
    date: 'all' as 'all' | string,
    search: '',
    page: 1,
  });
  const pageSize = 100;

  const normalizedTop100Search = top100Filters.search.trim().toLowerCase();
  const normalizedChangesSearch = changesFilters.search.trim().toLowerCase();
  const normalizedStoreSearch = storeFilters.search.trim().toLowerCase();
  const matchesSearch = (value?: string) =>
    (value ?? '').toLowerCase();

  // Top100 筛选与选项
  const top100 = useMemo(() => {
    const dates = new Set<string>();
    const countries = new Set<string>();
    const chartTypes = new Set<string>();
    let filtered = items;
    if (top100Filters.platform !== 'all') filtered = filtered.filter((it) => it.platform === top100Filters.platform);
    if (normalizedTop100Search) {
      filtered = filtered.filter(
        (it) =>
          matchesSearch(it.appId).includes(normalizedTop100Search) ||
          matchesSearch(it.appName).includes(normalizedTop100Search)
      );
    }
    filtered.forEach((it) => {
      if (it.rankDate) dates.add(it.rankDate);
      if (it.country) countries.add(it.country);
      if (it.chartType) chartTypes.add(it.chartType);
    });
    if (top100Filters.date !== 'all') filtered = filtered.filter((it) => it.rankDate === top100Filters.date);
    if (top100Filters.country !== 'all') filtered = filtered.filter((it) => it.country === top100Filters.country);
    if (top100Filters.chartType !== 'all') filtered = filtered.filter((it) => it.chartType === top100Filters.chartType);
    return {
      filteredItems: filtered,
      uniqueDates: Array.from(dates).sort().reverse(),
      uniqueCountries: Array.from(countries).sort(),
      uniqueChartTypes: Array.from(chartTypes).sort(),
    };
  }, [items, top100Filters, normalizedTop100Search]);

  // 异动榜单筛选与选项（平台、日期=当前榜单日期、国家、异动类型）
  const changes = useMemo(() => {
    const dates = new Set<string>();
    const countries = new Set<string>();
    const changeTypes = new Set<string>();
    let filtered = rankChangeItems;
    if (changesFilters.platform !== 'all') filtered = filtered.filter((it) => it.platform === changesFilters.platform);
    if (normalizedChangesSearch) {
      filtered = filtered.filter(
        (it) =>
          matchesSearch(it.appId).includes(normalizedChangesSearch) ||
          matchesSearch(it.metadataAppName).includes(normalizedChangesSearch) ||
          matchesSearch(it.appName).includes(normalizedChangesSearch)
      );
    }
    filtered.forEach((it) => {
      if (it.rankDateCurrent) dates.add(it.rankDateCurrent);
      if (it.country) countries.add(it.country);
      if (it.changeType) changeTypes.add(it.changeType);
    });
    if (changesFilters.date !== 'all') filtered = filtered.filter((it) => it.rankDateCurrent === changesFilters.date);
    if (changesFilters.country !== 'all') filtered = filtered.filter((it) => it.country === changesFilters.country);
    if (changesFilters.changeType !== 'all') filtered = filtered.filter((it) => it.changeType === changesFilters.changeType);
    return {
      filteredItems: filtered,
      uniqueDates: Array.from(dates).sort().reverse(),
      uniqueCountries: Array.from(countries).sort(),
      uniqueChangeTypes: Array.from(changeTypes).sort(),
    };
  }, [rankChangeItems, changesFilters, normalizedChangesSearch]);

  const storeChangeList = useMemo(() => {
    const dates = new Set<string>();
    let filtered = storeChanges;
    if (storeFilters.platform !== 'all') filtered = filtered.filter((it) => it.platform === storeFilters.platform);
    if (normalizedStoreSearch) {
      filtered = filtered.filter(
        (it) =>
          matchesSearch(it.appId).includes(normalizedStoreSearch) ||
          matchesSearch(it.appName).includes(normalizedStoreSearch)
      );
    }
    filtered.forEach((it) => {
      if (it.rankDate) dates.add(it.rankDate);
    });
    if (storeFilters.date !== 'all') filtered = filtered.filter((it) => it.rankDate === storeFilters.date);
    filtered = [...filtered].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const bt = new Date(b.changedAt || b.rankDate).getTime();
      const at = new Date(a.changedAt || a.rankDate).getTime();
      return bt - at;
    });
    return {
      filteredItems: filtered,
      uniqueDates: Array.from(dates).sort().reverse(),
    };
  }, [storeChanges, storeFilters, normalizedStoreSearch]);

  const isTop100 = activeTab === 'top100';
  const isRankChanges = activeTab === 'changes';
  const isStoreChanges = activeTab === 'store_changes';
  const filteredItems = isTop100
    ? top100.filteredItems
    : isRankChanges
      ? changes.filteredItems
      : storeChangeList.filteredItems;
  const uniqueDates = isTop100
    ? top100.uniqueDates
    : isRankChanges
      ? changes.uniqueDates
      : storeChangeList.uniqueDates;
  const uniqueCountries = isTop100 ? top100.uniqueCountries : changes.uniqueCountries;

  const currentPage = isTop100 ? top100Filters.page : isRankChanges ? changesFilters.page : storeFilters.page;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const pageItems = filteredItems.slice(startIndex, startIndex + pageSize);

  const setTabPage = (nextPage: number) => {
    if (isTop100) setTop100Filters((prev) => ({ ...prev, page: nextPage }));
    else if (isRankChanges) setChangesFilters((prev) => ({ ...prev, page: nextPage }));
    else setStoreFilters((prev) => ({ ...prev, page: nextPage }));
  };

  const handleTabChange = (tab: TabKind) => {
    setActiveTab(tab);
    setTabPage(1);
  };

  const setSearch = (value: string) => {
    if (isTop100) setTop100Filters((prev) => ({ ...prev, search: value, page: 1 }));
    else if (isRankChanges) setChangesFilters((prev) => ({ ...prev, search: value, page: 1 }));
    else setStoreFilters((prev) => ({ ...prev, search: value, page: 1 }));
  };

  const setPlatform = (value: 'all' | 'iOS' | 'Android') => {
    if (isTop100) setTop100Filters((prev) => ({ ...prev, platform: value, page: 1 }));
    else if (isRankChanges) setChangesFilters((prev) => ({ ...prev, platform: value, page: 1 }));
    else setStoreFilters((prev) => ({ ...prev, platform: value, page: 1 }));
  };

  const setDate = (value: 'all' | string) => {
    if (isTop100) setTop100Filters((prev) => ({ ...prev, date: value, page: 1 }));
    else if (isRankChanges) setChangesFilters((prev) => ({ ...prev, date: value, page: 1 }));
    else setStoreFilters((prev) => ({ ...prev, date: value, page: 1 }));
  };

  const setCountry = (value: 'all' | string) => {
    if (isTop100) setTop100Filters((prev) => ({ ...prev, country: value, page: 1 }));
    else if (isRankChanges) setChangesFilters((prev) => ({ ...prev, country: value, page: 1 }));
  };

  const setChartType = (value: 'all' | string) => {
    if (isTop100) setTop100Filters((prev) => ({ ...prev, chartType: value, page: 1 }));
  };

  const setChangeType = (value: 'all' | string) => {
    if (isRankChanges) setChangesFilters((prev) => ({ ...prev, changeType: value, page: 1 }));
  };

  const renderAppName = (name: string | undefined, url: string | undefined, title: string) => {
    if (!name) return '—';
    if (!url) return name;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline"
        title={title}
      >
        {name}
        <svg
          aria-hidden="true"
          className="w-3.5 h-3.5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M13 3h4v4a1 1 0 11-2 0V6.414l-6.293 6.293a1 1 0 01-1.414-1.414L13.586 5H13a1 1 0 110-2z" />
          <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-4a1 1 0 112 0v4a4 4 0 01-4 4H5a4 4 0 01-4-4V7a4 4 0 014-4h4a1 1 0 110 2H5z" />
        </svg>
      </a>
    );
  };

  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">SensorTower 排行榜</h1>
          <p className="text-sm text-slate-600">
            Top100 榜单与异动榜单，支持按日期、国家、平台及榜单类型/异动类型筛选，每页 10 条。
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

      {/* Tab：Top100 | 异动榜单 */}
      <div className="mb-4 flex gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => handleTabChange('top100')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'top100'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          Top100 榜单
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('changes')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'changes'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          异动榜单
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('store_changes')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'store_changes'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          商店页变化
        </button>
      </div>

      {/* 筛选：平台、日期、国家、榜单类型( Top100 ) / 异动类型( 异动榜单 ) */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-300">关键词</span>
          <input
            type="text"
            value={isTop100 ? top100Filters.search : isRankChanges ? changesFilters.search : storeFilters.search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="搜索 App ID / 游戏名"
            className="px-3 py-2 border border-slate-700 rounded-lg text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 w-56"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">平台</span>
          <select
            value={isTop100 ? top100Filters.platform : isRankChanges ? changesFilters.platform : storeFilters.platform}
            onChange={(e) => setPlatform(e.target.value as 'all' | 'iOS' | 'Android')}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">全部</option>
            <option value="iOS">iOS</option>
            <option value="Android">Android</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">日期</span>
          <select
            value={isTop100 ? top100Filters.date : isRankChanges ? changesFilters.date : storeFilters.date}
            onChange={(e) => setDate(e.target.value === 'all' ? 'all' : e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">全部</option>
            {uniqueDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        {!isStoreChanges && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">国家</span>
            <select
              value={isTop100 ? top100Filters.country : changesFilters.country}
              onChange={(e) => setCountry(e.target.value === 'all' ? 'all' : e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部</option>
              {uniqueCountries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
        {isTop100 ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">榜单类型</span>
            <select
              value={top100Filters.chartType}
              onChange={(e) => setChartType(e.target.value === 'all' ? 'all' : e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部</option>
              {top100.uniqueChartTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        ) : isRankChanges ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">异动类型</span>
            <select
              value={changesFilters.changeType}
              onChange={(e) => setChangeType(e.target.value === 'all' ? 'all' : e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部</option>
              {changes.uniqueChangeTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {isTop100 ? (
        <div className="overflow-x-auto -mx-6 max-h-[560px] overflow-y-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">排名</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">游戏名</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">开发公司</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">发行日期</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">App ID</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">平台</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">国家</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">榜单类型</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">榜单日期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {pageItems.length > 0 ? (
                (pageItems as SensorTowerTopItem[]).map((item, index) => (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      index % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                    }`}
                  >
                    <td className="py-3 px-6 whitespace-nowrap">
                      <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-sm font-bold bg-slate-100 text-slate-700">
                        {item.rank}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-sm text-slate-700 max-w-[180px] truncate" title={item.appName ?? item.appId}>
                      {renderAppName(item.appName, item.appUrl, item.appName ?? item.appId)}
                    </td>
                    <td className="py-3 px-6 text-sm text-slate-700 max-w-[140px] truncate" title={item.publisherName}>
                      {item.publisherName || '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">
                      {item.releaseDate || '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm font-mono text-slate-700">
                      {item.appId}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.platform}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.country}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.chartType}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.rankDate}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-sm text-slate-500">
                    暂无符合筛选条件的记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : isRankChanges ? (
        <div className="overflow-x-auto -mx-6 max-h-[560px] overflow-y-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">当前排名</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">上周排名</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">变化</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">异动类型</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">游戏名</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">开发公司</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">发行日期</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">App ID</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">下载量</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">收入</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">国家</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">平台</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">当前榜单日期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {pageItems.length > 0 ? (
                (pageItems as SensorTowerRankChangeItem[]).map((item, index) => (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      index % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                    }`}
                  >
                    <td className="py-3 px-6 whitespace-nowrap">
                      <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-sm font-bold bg-slate-100 text-slate-700">
                        {item.currentRank}
                      </span>
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.lastWeekRank || '—'}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm font-medium text-slate-700">{item.change}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.changeType}</td>
                    <td className="py-3 px-6 text-sm text-slate-700 max-w-[180px] truncate" title={item.metadataAppName ?? item.appName}>
                      {renderAppName(item.metadataAppName || item.appName, item.appUrl, item.metadataAppName ?? item.appName ?? item.appId)}
                    </td>
                    <td className="py-3 px-6 text-sm text-slate-700 max-w-[140px] truncate" title={item.publisherName}>
                      {item.publisherName || '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">
                      {item.releaseDate || '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm font-mono text-slate-700">{item.appId}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-right text-slate-700">
                      {item.downloads != null ? item.downloads.toLocaleString() : '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-right text-slate-700">
                      {item.revenue != null ? item.revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.country}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.platform}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.rankDateCurrent}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-sm text-slate-500">
                    暂无符合筛选条件的记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4 max-h-[560px] overflow-y-auto pr-1">
          {pageItems.length > 0 ? (
            (pageItems as SensorTowerStoreChangeItem[]).map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{item.appName}</h3>
                    <p className="text-sm text-slate-600">
                      {item.developer ? `${item.developer} · ` : ''}{item.platform}
                    </p>
                  </div>
                  <div className="text-sm text-slate-600">
                    变动时间：{item.changedAt || item.rankDate}
                  </div>
                </div>
                {item.storeUrl && (
                  <div className="mt-2">
                    <a
                      href={item.storeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      商店页链接
                    </a>
                  </div>
                )}
                <div className="mt-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border ${
                      item.priority === 2
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : item.priority === 1
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    优先级：{item.priorityLabel}
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-sm text-slate-700">
                  {item.summaries.length > 0 ? (
                    item.summaries.map((s, idx) => (
                      <div key={`${item.id}-summary-${idx}`} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-500" />
                        <span>{s}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-500">未解析到具体变化内容。</div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-sm text-slate-500">
              暂无符合筛选条件的记录
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <div>
          共 <span className="font-semibold text-slate-900">{filteredItems.length}</span> 条记录，当前第{' '}
          <span className="font-semibold text-slate-900">{safeCurrentPage}</span> / {totalPages} 页
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={safeCurrentPage <= 1}
            onClick={() => setTabPage(Math.max(1, safeCurrentPage - 1))}
            className={`px-3 py-1.5 rounded-md border text-sm ${
              safeCurrentPage <= 1
                ? 'border-slate-200 text-slate-400 cursor-not-allowed'
                : 'border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            上一页
          </button>
          <button
            type="button"
            disabled={safeCurrentPage >= totalPages}
            onClick={() => setTabPage(Math.min(totalPages, safeCurrentPage + 1))}
            className={`px-3 py-1.5 rounded-md border text-sm ${
              safeCurrentPage >= totalPages
                ? 'border-slate-200 text-slate-400 cursor-not-allowed'
                : 'border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
};

export default SensorTowerTopTable;
