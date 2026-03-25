import { useMemo, useState } from 'react';
import type { AiCreativeLibraryItem, AiCreativeLibraryKind } from '../types';
import { formatCountryToZh } from '../utils/rankingLabels';

interface AiCreativeLibraryTableProps {
  newItems: AiCreativeLibraryItem[];
  hotItems: AiCreativeLibraryItem[];
  surgeItems: AiCreativeLibraryItem[];
}

interface LibraryFilters {
  search: string;
  category: 'all' | string;
  platform: 'all' | string;
  country: 'all' | string;
  page: number;
}

const PAGE_SIZE = 100;

const TAB_LABELS: Record<AiCreativeLibraryKind, string> = {
  new: '新上榜',
  hot: '热门',
  surge: '飙升',
};

const DEFAULT_FILTERS: Record<AiCreativeLibraryKind, LibraryFilters> = {
  new: { search: '', category: 'all', platform: 'all', country: 'all', page: 1 },
  hot: { search: '', category: 'all', platform: 'all', country: 'all', page: 1 },
  surge: { search: '', category: 'all', platform: 'all', country: 'all', page: 1 },
};

function sanitizeForCsv(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function formatNumber(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

function formatGrowth(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function formatCountryLabel(code: string): string {
  const zh = formatCountryToZh(code);
  return zh && zh !== code ? `${zh} (${code})` : code;
}

function exportCsv(filename: string, header: string[], rows: (string | number)[][]) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const lines = [header, ...rows].map((row) =>
    row
      .map((value) => `"${sanitizeForCsv(String(value ?? '')).replace(/"/g, '""')}"`)
      .join(',')
  );
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const AiCreativeLibraryTable = ({
  newItems,
  hotItems,
  surgeItems,
}: AiCreativeLibraryTableProps) => {
  const [activeTab, setActiveTab] = useState<AiCreativeLibraryKind>('new');
  const [filtersByTab, setFiltersByTab] =
    useState<Record<AiCreativeLibraryKind, LibraryFilters>>(DEFAULT_FILTERS);

  const allItems = useMemo(
    () => ({ new: newItems, hot: hotItems, surge: surgeItems }),
    [newItems, hotItems, surgeItems]
  );
  const activeItems = allItems[activeTab];
  const activeFilters = filtersByTab[activeTab];
  const normalizedSearch = activeFilters.search.trim().toLowerCase();

  const filteredState = useMemo(() => {
    const categories = new Set<string>();
    const platforms = new Set<string>();
    const countries = new Set<string>();

    activeItems.forEach((item) => {
      if (item.category) categories.add(item.category);
      if (item.platform) platforms.add(item.platform);
      item.countries.forEach((country) => countries.add(country));
    });

    let filtered = activeItems;
    if (activeFilters.category !== 'all') {
      filtered = filtered.filter((item) => item.category === activeFilters.category);
    }
    if (activeFilters.platform !== 'all') {
      filtered = filtered.filter((item) => item.platform === activeFilters.platform);
    }
    if (activeFilters.country !== 'all') {
      filtered = filtered.filter((item) => item.countries.includes(activeFilters.country));
    }
    if (normalizedSearch) {
      filtered = filtered.filter((item) => {
        const haystack = [
          item.advertiserName,
          item.appDeveloper,
          item.platform,
          item.category,
          item.adKey,
          item.title,
          item.message,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      });
    }

    return {
      filteredItems: filtered,
      uniqueCategories: Array.from(categories).sort(),
      uniquePlatforms: Array.from(platforms).sort(),
      uniqueCountries: Array.from(countries).sort(),
    };
  }, [activeFilters.category, activeFilters.country, activeFilters.platform, activeItems, normalizedSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredState.filteredItems.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(activeFilters.page, totalPages);
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
  const pageItems = filteredState.filteredItems.slice(startIndex, startIndex + PAGE_SIZE);

  const updateFilters = (patch: Partial<LibraryFilters>) => {
    setFiltersByTab((prev) => ({
      ...prev,
      [activeTab]: {
        ...prev[activeTab],
        ...patch,
      },
    }));
  };

  const handleTabChange = (tab: AiCreativeLibraryKind) => {
    setActiveTab(tab);
  };

  const handleExportCsv = () => {
    const header = [
      'rank',
      'category',
      'advertiser_name',
      'app_developer',
      'platform',
      'heat',
      'all_exposure_value',
      'new_week_exposure_value',
      'exposure_diff',
      'exposure_growth',
      'days_count',
      'countries',
      'title',
      'message',
      'call_to_action',
      'ad_key',
      'video_url',
      'preview_img_url',
      'logo_url',
    ];
    const rows = filteredState.filteredItems.map((item) => [
      item.rank,
      item.category,
      item.advertiserName,
      item.appDeveloper ?? '',
      item.platform ?? '',
      item.heat ?? '',
      item.allExposureValue ?? '',
      item.newWeekExposureValue ?? '',
      item.exposureDiff ?? '',
      item.exposureGrowth ?? '',
      item.daysCount ?? '',
      item.countries.join('|'),
      item.title ?? '',
      item.message ?? '',
      item.callToAction ?? '',
      item.adKey,
      item.videoUrl ?? '',
      item.previewImgUrl ?? '',
      item.logoUrl ?? '',
    ]);
    const today = new Date().toISOString().slice(0, 10);
    exportCsv(`ai_creative_library_${activeTab}_${today}.csv`, header, rows);
  };

  const renderLink = (label: string, url?: string) => {
    if (!url) return null;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline"
      >
        {label}
      </a>
    );
  };

  const isSurge = activeTab === 'surge';

  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 mb-1">素材库</h2>
          <p className="text-sm text-slate-600">
            接入 `ai_products_ua.db` 的新上榜、热门、飙升三张素材榜，支持固定表头、筛选、搜索与导出。
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center px-3 py-2 rounded-md border border-slate-200 text-sm font-medium text-slate-700 bg-white hover:bg-slate-100 transition-colors"
        >
          导出 CSV
        </button>
      </div>

      <div className="mb-4 flex gap-2 border-b border-slate-200">
        {(Object.keys(TAB_LABELS) as AiCreativeLibraryKind[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => handleTabChange(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">关键词</span>
          <input
            type="text"
            value={activeFilters.search}
            onChange={(e) => updateFilters({ search: e.target.value, page: 1 })}
            placeholder="搜索广告主 / 标题 / ad_key"
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">品类</span>
          <select
            value={activeFilters.category}
            onChange={(e) => updateFilters({ category: e.target.value, page: 1 })}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">全部</option>
            {filteredState.uniqueCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">平台</span>
          <select
            value={activeFilters.platform}
            onChange={(e) => updateFilters({ platform: e.target.value, page: 1 })}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">全部</option>
            {filteredState.uniquePlatforms.map((platform) => (
              <option key={platform} value={platform}>
                {platform}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">国家</span>
          <select
            value={activeFilters.country}
            onChange={(e) => updateFilters({ country: e.target.value, page: 1 })}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">全部</option>
            {filteredState.uniqueCountries.map((country) => (
              <option key={country} value={country}>
                {formatCountryLabel(country)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto -mx-6 max-h-[70vh] overflow-y-auto">
        <table className={`w-full ${isSurge ? 'min-w-[1800px]' : 'min-w-[1600px]'}`}>
          <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left py-3 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">排名</th>
              <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">广告主</th>
              <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">素材信息</th>
              <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">开发者</th>
              <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">平台</th>
              <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">品类</th>
              <th className="text-right py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">热度</th>
              <th className="text-right py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">累计曝光</th>
              <th className="text-right py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">新增周曝光</th>
              {isSurge && (
                <>
                  <th className="text-right py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">曝光增量</th>
                  <th className="text-right py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">增长率</th>
                </>
              )}
              <th className="text-right py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">持续天数</th>
              <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">国家</th>
              <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">Ad Key</th>
              <th className="text-left py-3 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">重要链接</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {pageItems.length > 0 ? (
              pageItems.map((item, index) => (
                <tr
                  key={item.id}
                  className={`hover:bg-slate-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
                >
                  <td className="py-3 px-6 whitespace-nowrap">
                    <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-sm font-bold bg-slate-100 text-slate-700">
                      {item.rank}
                    </span>
                  </td>
                  <td className="py-3 px-6 text-sm text-slate-700 max-w-[220px]">
                    <div className="font-medium break-words">{item.advertiserName}</div>
                  </td>
                  <td className="py-3 px-6 text-sm text-slate-700 max-w-[360px]">
                    <div className="font-medium text-slate-900">{item.title || '—'}</div>
                    {item.message && (
                      <div className="mt-1 text-slate-500 line-clamp-2">{item.message}</div>
                    )}
                    {!item.message && item.callToAction && (
                      <div className="mt-1 text-slate-500">{item.callToAction}</div>
                    )}
                  </td>
                  <td className="py-3 px-6 text-sm text-slate-700 max-w-[180px] truncate" title={item.appDeveloper}>
                    {item.appDeveloper || '—'}
                  </td>
                  <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.platform || '—'}</td>
                  <td className="py-3 px-6 whitespace-nowrap text-sm text-slate-700">{item.category}</td>
                  <td className="py-3 px-6 whitespace-nowrap text-sm text-right text-slate-700">
                    {formatNumber(item.heat)}
                  </td>
                  <td className="py-3 px-6 whitespace-nowrap text-sm text-right text-slate-700">
                    {formatNumber(item.allExposureValue)}
                  </td>
                  <td className="py-3 px-6 whitespace-nowrap text-sm text-right text-slate-700">
                    {formatNumber(item.newWeekExposureValue)}
                  </td>
                  {isSurge && (
                    <>
                      <td className="py-3 px-6 whitespace-nowrap text-sm text-right text-slate-700">
                        {formatNumber(item.exposureDiff)}
                      </td>
                      <td className="py-3 px-6 whitespace-nowrap text-sm text-right text-slate-700">
                        {formatGrowth(item.exposureGrowth)}
                      </td>
                    </>
                  )}
                  <td className="py-3 px-6 whitespace-nowrap text-sm text-right text-slate-700">
                    {formatNumber(item.daysCount)}
                  </td>
                  <td className="py-3 px-6 text-sm text-slate-700 max-w-[220px]">
                    {item.countries.length > 0
                      ? item.countries.map(formatCountryLabel).join('、')
                      : '—'}
                  </td>
                  <td className="py-3 px-6 whitespace-nowrap text-sm font-mono text-slate-700">
                    {item.adKey}
                  </td>
                  <td className="py-3 px-6 text-sm text-slate-700">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {renderLink('视频', item.videoUrl)}
                      {renderLink('封面', item.previewImgUrl)}
                      {renderLink('Logo', item.logoUrl)}
                      {!item.videoUrl && !item.previewImgUrl && !item.logoUrl && '—'}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={isSurge ? 15 : 13} className="py-8 text-center text-sm text-slate-500">
                  暂无符合筛选条件的记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <div>
          共 <span className="font-semibold text-slate-900">{filteredState.filteredItems.length}</span> 条记录，当前第{' '}
          <span className="font-semibold text-slate-900">{safeCurrentPage}</span> / {totalPages} 页
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={safeCurrentPage <= 1}
            onClick={() => updateFilters({ page: Math.max(1, safeCurrentPage - 1) })}
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
            onClick={() => updateFilters({ page: Math.min(totalPages, safeCurrentPage + 1) })}
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

export default AiCreativeLibraryTable;
