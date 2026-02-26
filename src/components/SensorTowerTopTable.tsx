import { useMemo, useState } from 'react';
import type { SensorTowerTopItem, SensorTowerRankChangeItem } from '../types';
import { formatCountryToZh, formatChartTypeToZh, buildSensorTowerOverviewUrl } from '../utils/rankingLabels';

/** 导出 CSV 时去掉表情等符号，避免 Excel/旧工具打开乱码或解析错误 */
function sanitizeForCsv(s: string): string {
  return s
    .replace(
      /[\u{1F300}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}]/gu,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

interface SensorTowerTopTableProps {
  items: SensorTowerTopItem[];
  rankChangeItems?: SensorTowerRankChangeItem[];
  onBack?: () => void;
}

type TabKind = 'top100' | 'changes';

const SensorTowerTopTable = ({ items, rankChangeItems = [], onBack }: SensorTowerTopTableProps) => {
  const [activeTab, setActiveTab] = useState<TabKind>('top100');
  const [top100Filters, setTop100Filters] = useState({
    platform: 'all' as 'all' | 'iOS' | 'Android',
    date: 'all' as 'all' | string,
    // Top100 使用国家代码（如 US），这里默认美国
    country: 'US' as 'all' | string,
    chartType: 'all' as 'all' | string,
    search: '',
    page: 1,
  });
  const [changesFilters, setChangesFilters] = useState({
    platform: 'all' as 'all' | 'iOS' | 'Android',
    date: 'all' as 'all' | string,
    // 默认展示美国数据
    country: '🇺🇸 美国' as 'all' | string,
    changeType: 'all' as 'all' | string,
    search: '',
    page: 1,
  });
  const pageSize = 100;

  const normalizedTop100Search = top100Filters.search.trim().toLowerCase();
  const normalizedChangesSearch = changesFilters.search.trim().toLowerCase();
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
    if (top100Filters.chartType !== 'all') {
      filtered = filtered.filter(
        (it) =>
          formatChartTypeToZh(it.chartType) === top100Filters.chartType || it.chartType === top100Filters.chartType
      );
    }
    return {
      filteredItems: filtered,
      uniqueDates: Array.from(dates).sort().reverse(),
      uniqueCountries: Array.from(countries).sort(),
      uniqueChartTypes: Array.from(chartTypes).sort(),
    };
  }, [items, top100Filters, normalizedTop100Search]);

  // 异动榜单筛选与选项（平台、日期=当前榜单日期、国家、异动类型；异动类型含 Top5 登顶/掉出第一）
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
      if (it.top5Movement) changeTypes.add(it.top5Movement);
    });
    if (changesFilters.date !== 'all') filtered = filtered.filter((it) => it.rankDateCurrent === changesFilters.date);
    if (changesFilters.country !== 'all') filtered = filtered.filter((it) => it.country === changesFilters.country);
    if (changesFilters.changeType !== 'all') {
      if (changesFilters.changeType === '登顶') {
        filtered = filtered.filter((it) => it.top5Movement === '登顶');
      } else if (changesFilters.changeType === '掉出第一') {
        filtered = filtered.filter((it) => it.top5Movement === '掉出第一');
      } else {
        filtered = filtered.filter((it) => it.changeType === changesFilters.changeType);
      }
    }
    const changeTypesArr = Array.from(changeTypes).sort();
    const top5First = ['登顶', '掉出第一'].filter((x) => changeTypes.has(x));
    const restTypes = changeTypesArr.filter((x) => x !== '登顶' && x !== '掉出第一');
    const uniqueChangeTypes = [...top5First, ...restTypes];
    return {
      filteredItems: filtered,
      uniqueDates: Array.from(dates).sort().reverse(),
      uniqueCountries: Array.from(countries).sort(),
      uniqueChangeTypes,
    };
  }, [rankChangeItems, changesFilters, normalizedChangesSearch]);

  const isTop100 = activeTab === 'top100';
  const isRankChanges = activeTab === 'changes';
  const filteredItems = isTop100 ? top100.filteredItems : changes.filteredItems;
  const uniqueDates = isTop100 ? top100.uniqueDates : changes.uniqueDates;
  const uniqueCountries = isTop100 ? top100.uniqueCountries : changes.uniqueCountries;

  const currentPage = isTop100 ? top100Filters.page : changesFilters.page;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const pageItems = filteredItems.slice(startIndex, startIndex + pageSize);

  const setTabPage = (nextPage: number) => {
    if (isTop100) setTop100Filters((prev) => ({ ...prev, page: nextPage }));
    else setChangesFilters((prev) => ({ ...prev, page: nextPage }));
  };

  const handleTabChange = (tab: TabKind) => {
    setActiveTab(tab);
    setTabPage(1);
  };

  const setSearch = (value: string) => {
    if (isTop100) setTop100Filters((prev) => ({ ...prev, search: value, page: 1 }));
    else setChangesFilters((prev) => ({ ...prev, search: value, page: 1 }));
  };

  const setPlatform = (value: 'all' | 'iOS' | 'Android') => {
    if (isTop100) setTop100Filters((prev) => ({ ...prev, platform: value, page: 1 }));
    else setChangesFilters((prev) => ({ ...prev, platform: value, page: 1 }));
  };

  const setDate = (value: 'all' | string) => {
    if (isTop100) setTop100Filters((prev) => ({ ...prev, date: value, page: 1 }));
    else setChangesFilters((prev) => ({ ...prev, date: value, page: 1 }));
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

  const handleExportCsv = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const isTop = activeTab === 'top100';
    let header: string[];
    let rows: (string | number)[][];

    if (isTop) {
      header = [
        'rank_date',
        'country',
        'chart_type',
        'platform',
        'rank',
        'app_id',
        'app_name',
        'publisher',
        'release_date',
        'downloads',
        'revenue',
        'app_url',
      ];
      rows = (top100.filteredItems as SensorTowerTopItem[]).map((it) => [
        it.rankDate,
        it.country,
        it.chartType,
        it.platform,
        it.rank,
        it.appId,
        it.appName ?? '',
        it.publisherName ?? '',
        it.releaseDate ?? '',
        it.downloads ?? '',
        it.revenue ?? '',
        it.appUrl ?? '',
      ]);
    } else {
      header = [
        'rank_date_current',
        'rank_date_last',
        'country',
        'platform',
        'current_rank',
        'last_week_rank',
        'change',
        'change_type',
        'app_id',
        'app_name',
        'publisher',
        'downloads',
        'revenue',
      ];
      rows = (changes.filteredItems as SensorTowerRankChangeItem[]).map((it) => [
        it.rankDateCurrent,
        it.rankDateLast,
        it.country,
        it.platform,
        it.currentRank,
        it.lastWeekRank,
        it.change,
        it.changeType,
        it.appId,
        it.metadataAppName ?? it.appName ?? '',
        it.publisherName ?? '',
        it.downloads ?? '',
        it.revenue ?? '',
      ]);
    }

    const lines = [header, ...rows].map((row) =>
      row
        .map((v) => {
          const raw = String(v ?? '');
          const s = sanitizeForCsv(raw);
          return `"${s.replace(/"/g, '""')}"`;
        })
        .join(',')
    );
    const csv = lines.join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `sensortower_${isTop ? 'top100' : 'changes'}_${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center px-3 py-2 rounded-md border border-slate-200 text-sm font-medium text-slate-700 bg-white hover:bg-slate-100 transition-colors"
          >
            导出 CSV
          </button>
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
      </div>

      {/* 筛选：平台、日期、国家、榜单类型( Top100 ) / 异动类型( 异动榜单 ) */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-300">关键词</span>
          <input
            type="text"
            value={isTop100 ? top100Filters.search : changesFilters.search}
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
            value={isTop100 ? top100Filters.platform : changesFilters.platform}
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
            value={isTop100 ? top100Filters.date : changesFilters.date}
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
                  {formatCountryToZh(c) || c}
                </option>
              ))}
            </select>
          </div>
        {isTop100 ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">榜单类型</span>
            <select
              value={top100Filters.chartType}
              onChange={(e) => setChartType(e.target.value === 'all' ? 'all' : e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部</option>
              <option value="免费榜">免费榜</option>
              <option value="付费榜">付费榜</option>
            </select>
          </div>
        ) : (
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
        )}
      </div>

      {isTop100 ? (
        <div className="overflow-x-auto -mx-6 max-h-[70vh] overflow-y-auto">
          <table className="w-full min-w-[1000px]">
            <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
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
                <th className="text-right py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">下载量</th>
                <th className="text-right py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">收入</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">SensorTower</th>
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
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{formatCountryToZh(item.country) || item.country}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">
                      {formatChartTypeToZh(item.chartType) || item.chartType || '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.rankDate}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-right text-slate-700">
                      {item.downloads != null ? item.downloads.toLocaleString() : '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-right text-slate-700">
                      {item.revenue != null ? item.revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—'}
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">
                      {(() => {
                        const stUrl = buildSensorTowerOverviewUrl(item.appId, item.country);
                        return stUrl ? (
                          <a
                            href={stUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            查看
                          </a>
                        ) : (
                          '—'
                        );
                      })()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-sm text-slate-500">
                    暂无符合筛选条件的记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-6 max-h-[70vh] overflow-y-auto">
          <table className="w-full min-w-[1000px]">
            <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
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
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">SensorTower</th>
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
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.top5Movement ?? item.changeType}</td>
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
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{formatCountryToZh(item.country) || item.country}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.platform}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.rankDateCurrent}</td>
                    <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">
                      {(() => {
                        const stUrl = buildSensorTowerOverviewUrl(item.appId, item.country);
                        return stUrl ? (
                          <a
                            href={stUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            查看
                          </a>
                        ) : (
                          '—'
                        );
                      })()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={14} className="py-8 text-center text-sm text-slate-500">
                    暂无符合筛选条件的记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
