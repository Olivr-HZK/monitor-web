import { useState, useMemo } from 'react';
import type { MonitorItem, MonitorType } from '../types';
import type { GamePlatformKey, CasualGameMainCategory, CasualGameCompetitorSub, AiProductSubCategory } from '../types';
import MonitorCard from './MonitorCard';

/** 与侧栏结构对齐：监测类型 → 数据块（SensorTower 或 微信/抖音，或竞品）→ 子项 */
function getCasualGameHeading(
  selectedCasualSourceSection: 'wechat_douyin' | 'sensortower' | undefined,
  selectedCasualGameCategory: CasualGameMainCategory | null | undefined,
  selectedGamePlatform: GamePlatformKey | null | undefined,
  selectedCasualGameCompetitorSub: CasualGameCompetitorSub | null | undefined
): { crumbs: string[]; headline: string } {
  const root = '休闲游戏监测';
  if (selectedCasualGameCategory === '竞品') {
    const sub =
      selectedCasualGameCompetitorSub === '社媒更新'
        ? '社媒监控'
        : selectedCasualGameCompetitorSub === 'UA素材'
          ? 'UA素材'
          : '竞品动态';
    return {
      crumbs: [root, '竞品监测', sub],
      /** 与周报简要等一致：主标题只保留叶子，避免与面包屑重复「竞品监测」 */
      headline: sub,
    };
  }
  const section =
    selectedCasualSourceSection === 'sensortower'
      ? 'SensorTower 榜单'
      : '微信 / 抖音小游戏';
  const cat = selectedCasualGameCategory ?? '周报简要';
  if (cat === '新游戏' && selectedGamePlatform) {
    return {
      crumbs: [root, section, '新游戏', selectedGamePlatform],
      headline: `新游戏 · ${selectedGamePlatform}`,
    };
  }
  return {
    crumbs: [root, section, cat],
    headline: cat,
  };
}

interface MonitorListProps {
  items: MonitorItem[];
  selectedType?: MonitorType | '全部';
  /** 按公司筛选（竞品社媒动态-社媒监控时显示并生效） */
  selectedCompanyName?: string | null;
  /** 公司选项列表（来自竞品社媒周报） */
  companies?: string[];
  onCompanySelect?: (company: string | null) => void;
  /** 休闲游戏监测：选中的大类（新游戏/新玩法/竞品） */
  selectedCasualGameCategory?: CasualGameMainCategory | null;
  /** 休闲游戏监测-新游戏：按平台筛选周报 */
  selectedGamePlatform?: GamePlatformKey | null;
  /** 休闲游戏监测-竞品动态：选中的小类（社媒监控/UA素材） */
  selectedCasualGameCompetitorSub?: CasualGameCompetitorSub | null;
  /** AI产品监测：选中的子类（排行榜/产品周报/UA素材） */
  selectedAiProductSub?: AiProductSubCategory | null;
  /** 自定义页面标题（如 休闲游戏监测 - 新游戏 - 微信） */
  pageTitle?: string;
  /** 标题右侧操作区（如 进入排行榜 按钮） */
  headerAction?: React.ReactNode;
  /** 休闲游戏监测：当前数据块（微信/抖音 与 SensorTower 隔离，只显示对应来源的项） */
  selectedCasualSourceSection?: 'wechat_douyin' | 'sensortower';
  onItemClick?: (item: MonitorItem) => void;
}

const MonitorList = ({
  items,
  selectedType: propSelectedType,
  selectedCompanyName,
  companies = [],
  onCompanySelect,
  selectedCasualGameCategory,
  selectedGamePlatform,
  selectedCasualGameCompetitorSub,
  selectedAiProductSub,
  pageTitle,
  headerAction,
  selectedCasualSourceSection,
  onItemClick
}: MonitorListProps) => {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [internalSelectedType, setInternalSelectedType] = useState<MonitorType | '全部'>('全部');
  const [timeRange, setTimeRange] = useState('过去1周内');
  const [sortBy, setSortBy] = useState('默认排序');
  /** 休闲游戏监测：按平台筛选（左侧筛选栏），仅当 selectedType === 休闲游戏监测 时生效 */
  const [platformFilter, setPlatformFilter] = useState<GamePlatformKey | '全部'>('全部');
  /** 热点趋势监测：按平台筛选 */
  const [hotTrendPlatformFilter, setHotTrendPlatformFilter] = useState<string>('全部');
  /** AI 热点监测：按平台筛选（微信/小红书） */
  const [aiPlatformFilter, setAiPlatformFilter] = useState<string>('全部');
  /** 周报简要（含 SensorTower 周报）：仅按日期筛选 */
  const [weeklySummaryDate, setWeeklySummaryDate] = useState<'all' | string>('all');
  /** 商店页变化：仅日期 + 游戏名搜索 */
  const [storeChangeDate, setStoreChangeDate] = useState<'all' | string>('all');
  const [storeChangeSearch, setStoreChangeSearch] = useState('');

  const hotTrendPlatformOptions = useMemo(() => {
    const platforms = items
      .filter((item) => item.type === '热点趋势监测')
      .map((item) => item.platform)
      .filter(Boolean);
    return Array.from(new Set(platforms)).sort();
  }, [items]);

  // 使用prop中的selectedType，如果没有则使用内部状态
  const selectedType = propSelectedType !== undefined ? propSelectedType : internalSelectedType;

  /** 社媒视图：只暴露公司和时间筛选 */
  const isCompetitorSocialView =
    (selectedType === '竞品社媒监控') ||
    (selectedType === '休闲游戏监测' &&
      selectedCasualGameCategory === '竞品' &&
      selectedCasualGameCompetitorSub === '社媒更新');

  /** 微信/抖音小游戏周报：只显示时间筛选，不显示分类/排序/高级筛选 */
  const isWechatDouyinWeeklyBrief =
    selectedType === '休闲游戏监测' &&
    selectedCasualGameCategory === '周报简要' &&
    selectedCasualSourceSection === 'wechat_douyin';

  /** 周报简要（微信/抖音 或 SensorTower）：只保留日期筛选，不显示其他下拉 */
  const isWeeklySummaryView =
    selectedType === '休闲游戏监测' && selectedCasualGameCategory === '周报简要';

  /** 商店页变化：只保留日期 + 游戏名搜索 */
  const isStoreChangeView =
    selectedType === '休闲游戏监测' && selectedCasualGameCategory === '商店页变化';

  const monitorTypes: MonitorType[] = ['ai热点监测', '热点趋势监测', '休闲游戏监测', 'AI产品监测'];

  /** 周报简要的日期选项（根据当前数据块取对应来源的 item.date） */
  const weeklySummaryDateOptions = useMemo(() => {
    if (!isWeeklySummaryView) return [];
    const dates = new Set<string>();
    for (const it of items) {
      if (it.type !== '休闲游戏监测' || it.casualGameCategory !== '周报简要') continue;
      if (selectedCasualSourceSection === 'sensortower' && it.casualGameSource !== 'sensortower') continue;
      if (selectedCasualSourceSection !== 'sensortower' && it.casualGameSource === 'sensortower') continue;
      if (it.date) dates.add(it.date);
    }
    return Array.from(dates).sort().reverse();
  }, [items, isWeeklySummaryView, selectedCasualSourceSection]);

  /** 商店页变化的日期选项 */
  const storeChangeDateOptions = useMemo(() => {
    if (!isStoreChangeView) return [];
    const dates = new Set<string>();
    for (const it of items) {
      if (it.type !== '休闲游戏监测' || it.casualGameCategory !== '商店页变化') continue;
      if (it.date) dates.add(it.date);
    }
    return Array.from(dates).sort().reverse();
  }, [items, isStoreChangeView]);

  /** 解析 item.date 为时间戳（支持 YYYY-MM-DD、MM-DD、周区间等） */
  const parseItemDate = (item: MonitorItem): number => {
    const d = (item.date ?? '').trim();
    if (!d) return 0;
    const full = d.length >= 8 && /^\d{4}/.test(d) ? d : `${new Date().getFullYear()}-${d}`;
    const t = new Date(full.replace(/\//g, '-')).getTime();
    return Number.isNaN(t) ? 0 : t;
  };

  // 筛选和排序逻辑
  const filteredAndSortedItems = useMemo(() => {
    let filtered = items;

    // 休闲游戏监测：按 周报简要 / 新游戏 / 新玩法 / 玩法拆解 / 竞品动态；并与 微信/抖音 vs SensorTower 数据块隔离
    if (selectedType === '休闲游戏监测') {
      filtered = filtered.filter((item) => item.type === '休闲游戏监测');
      if (selectedCasualSourceSection === 'sensortower') {
        filtered = filtered.filter((item) => item.casualGameSource === 'sensortower');
      } else {
        filtered = filtered.filter((item) => item.casualGameSource !== 'sensortower');
      }
      if (selectedCasualGameCategory) {
        filtered = filtered.filter((item) => item.casualGameCategory === selectedCasualGameCategory);
        if (selectedCasualGameCategory === '新游戏' && (platformFilter !== '全部' || selectedGamePlatform)) {
          const platform = platformFilter !== '全部' ? platformFilter : selectedGamePlatform;
          if (platform) filtered = filtered.filter((item) => item.platform === platform);
        }
        if (selectedCasualGameCategory === '竞品' && selectedCasualGameCompetitorSub) {
          filtered = filtered.filter((item) => item.casualGameCompetitorSub === selectedCasualGameCompetitorSub);
        }
      }
      // 竞品动态-社媒监控：同时包含「竞品社媒监控」类型的周报，并按公司筛选
      if (selectedCasualGameCategory === '竞品' && selectedCasualGameCompetitorSub === '社媒更新') {
        let competitorSocial = items.filter((item) => item.type === '竞品社媒监控');
        if (selectedCompanyName) {
          competitorSocial = competitorSocial.filter((item) => item.companyName === selectedCompanyName);
        }
        filtered = [...filtered, ...competitorSocial];
      }
      // 周报简要（含 SensorTower 周报）：按日期筛选
      if (selectedCasualGameCategory === '周报简要' && weeklySummaryDate !== 'all') {
        filtered = filtered.filter((item) => item.date === weeklySummaryDate);
      }
      // 商店页变化：按日期 + 游戏名搜索
      if (selectedCasualGameCategory === '商店页变化') {
        if (storeChangeDate !== 'all') {
          filtered = filtered.filter((item) => item.date === storeChangeDate);
        }
        const searchTrim = storeChangeSearch.trim();
        if (searchTrim) {
          const q = searchTrim.toLowerCase();
          filtered = filtered.filter((item) =>
            (item.title ?? '').toLowerCase().includes(q)
          );
        }
      }
    } else if (selectedType === 'AI产品监测') {
      filtered = filtered.filter((item) => item.type === 'AI产品监测');
      if (selectedAiProductSub) {
        filtered = filtered.filter((item) => item.aiProductSub === selectedAiProductSub);
      }
    } else if (selectedType !== '全部') {
      // 其他类型：按类型筛选
      filtered = filtered.filter(item => item.type === selectedType);
      if (selectedType === '热点趋势监测' && hotTrendPlatformFilter !== '全部') {
        filtered = filtered.filter((item) => item.platform === hotTrendPlatformFilter);
      }
      if (selectedType === 'ai热点监测' && aiPlatformFilter !== '全部') {
        filtered = filtered.filter((item) => {
          if (aiPlatformFilter === '微信') return item.platform === '微信公众号' || item.platform?.includes('微信');
          if (aiPlatformFilter === '小红书') return item.platform === '小红书' || item.platform?.includes('小红书');
          return true;
        });
      }
    }

    // 微信/抖音小游戏周报：只按时间筛选 + 按日期倒序（周报简要已用 weeklySummaryDate 时不再用时间范围）
    if (!isWeeklySummaryView && isWechatDouyinWeeklyBrief && timeRange !== '全部时间') {
      const now = Date.now();
      const ms =
        timeRange === '过去1周内'
          ? 7 * 24 * 60 * 60 * 1000
          : timeRange === '过去1个月内'
            ? 30 * 24 * 60 * 60 * 1000
            : timeRange === '过去3个月内'
              ? 90 * 24 * 60 * 60 * 1000
              : 0;
      if (ms > 0) {
        const cutoff = now - ms;
        filtered = filtered.filter((item) => parseItemDate(item) >= cutoff);
      }
    }

    // 排序
    const sorted = [...filtered].sort((a, b) => {
      if (isWeeklySummaryView || isWechatDouyinWeeklyBrief || isStoreChangeView) {
        return parseItemDate(b) - parseItemDate(a);
      }
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
    selectedAiProductSub,
    selectedCasualSourceSection,
    platformFilter,
    hotTrendPlatformFilter,
    aiPlatformFilter,
    sortBy,
    timeRange,
    isWechatDouyinWeeklyBrief,
    weeklySummaryDate,
    isStoreChangeView,
    storeChangeDate,
    storeChangeSearch,
  ]);

  const casualHeading =
    selectedType === '休闲游戏监测'
      ? getCasualGameHeading(
          selectedCasualSourceSection,
          selectedCasualGameCategory,
          selectedGamePlatform,
          selectedCasualGameCompetitorSub
        )
      : null;

  return (
    <div className="flex-1">
      {/* Title + optional action */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="min-w-0 flex-1">
          {casualHeading ? (
            <div className="space-y-2">
              <nav className="text-xs sm:text-sm text-slate-500" aria-label="当前位置">
                <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  {casualHeading.crumbs.map((part, i) => (
                    <li key={`${i}-${part}`} className="flex items-center gap-1.5">
                      {i > 0 && (
                        <span className="text-slate-300 select-none" aria-hidden>
                          /
                        </span>
                      )}
                      <span
                        className={
                          i === 0
                            ? 'text-slate-400'
                            : i === casualHeading.crumbs.length - 1
                              ? 'font-medium text-slate-600'
                              : 'text-slate-500'
                        }
                      >
                        {part}
                      </span>
                    </li>
                  ))}
                </ol>
              </nav>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {casualHeading.headline}
              </h1>
            </div>
          ) : (
            <h1 className="text-3xl font-bold text-slate-900">{pageTitle ?? '监测汇总'}</h1>
          )}
        </div>
        {headerAction}
      </div>

      {/* Filters：周报简要（含 SensorTower 周报）只保留日期筛选；微信/抖音周报仅时间；其他场景显示完整筛选 */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-start gap-4">
          {isWeeklySummaryView ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600 whitespace-nowrap">日期</span>
              <select
                value={weeklySummaryDate}
                onChange={(e) => setWeeklySummaryDate(e.target.value === 'all' ? 'all' : e.target.value)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">全部</option>
                {weeklySummaryDateOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          ) : isStoreChangeView ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600 whitespace-nowrap">日期</span>
                <select
                  value={storeChangeDate}
                  onChange={(e) => setStoreChangeDate(e.target.value === 'all' ? 'all' : e.target.value)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">全部</option>
                  {storeChangeDateOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600 whitespace-nowrap">游戏名</span>
                <input
                  type="text"
                  value={storeChangeSearch}
                  onChange={(e) => setStoreChangeSearch(e.target.value)}
                  placeholder="搜索游戏名..."
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
                />
              </div>
            </>
          ) : isWechatDouyinWeeklyBrief ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600 whitespace-nowrap">时间</span>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="过去1周内">过去1周内</option>
                <option value="过去1个月内">过去1个月内</option>
                <option value="过去3个月内">过去3个月内</option>
                <option value="全部时间">全部时间</option>
              </select>
            </div>
          ) : (
            <>
              {!isStoreChangeView &&
                selectedType === '休闲游戏监测' &&
                selectedCasualGameCategory === '竞品' &&
                selectedCasualGameCompetitorSub === '社媒更新' && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600 whitespace-nowrap">按公司筛选</span>
                  <select
                    value={selectedCompanyName ?? ''}
                    onChange={(e) => onCompanySelect?.(e.target.value || null)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">全部公司</option>
                    {companies.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              )}
              {!isStoreChangeView &&
                (selectedType === '休闲游戏监测' &&
                  (selectedCasualGameCategory === '新游戏' ||
                    selectedCasualGameCategory === '新玩法' ||
                    selectedCasualGameCategory === '玩法拆解')) && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600 whitespace-nowrap">按平台筛选</span>
                  <select
                    value={platformFilter}
                    onChange={(e) => setPlatformFilter(e.target.value as GamePlatformKey | '全部')}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="全部">全部</option>
                    <option value="微信">微信</option>
                    <option value="抖音">抖音</option>
                    <option value="iOS">iOS</option>
                    <option value="安卓">安卓</option>
                  </select>
                </div>
              )}
              {!isStoreChangeView && !isCompetitorSocialView && selectedType === 'ai热点监测' && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600 whitespace-nowrap">按平台筛选</span>
                  <select
                    value={aiPlatformFilter}
                    onChange={(e) => setAiPlatformFilter(e.target.value)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="全部">全部</option>
                    <option value="微信">微信</option>
                    <option value="小红书">小红书</option>
                  </select>
                </div>
              )}
              {!isStoreChangeView && !isCompetitorSocialView && selectedType === '热点趋势监测' && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600 whitespace-nowrap">按平台筛选</span>
                  <select
                    value={hotTrendPlatformFilter}
                    onChange={(e) => setHotTrendPlatformFilter(e.target.value)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="全部">全部</option>
                    {hotTrendPlatformOptions.map((platform) => (
                      <option key={platform} value={platform}>{platform}</option>
                    ))}
                  </select>
                </div>
              )}
              {!isStoreChangeView && (
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="过去1周内">过去1周内</option>
                  <option value="过去1个月内">过去1个月内</option>
                  <option value="过去3个月内">过去3个月内</option>
                  <option value="全部时间">全部时间</option>
                </select>
              )}

              {!isStoreChangeView && !isCompetitorSocialView && (
                <>
                  <select
                    value={selectedType}
                    onChange={(e) => {
                      const newType = e.target.value as MonitorType | '全部';
                      if (propSelectedType === undefined) {
                        setInternalSelectedType(newType);
                      }
                    }}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="全部">全部分类</option>
                    {monitorTypes.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>

                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="默认排序">默认排序</option>
                    <option value="最新发布">最新发布</option>
                    <option value="最受欢迎">最受欢迎</option>
                    <option value="互动最多">互动最多</option>
                    <option value="评分最高">评分最高</option>
                    <option value="评分最低">评分最低</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>高级筛选</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>

        {showAdvancedFilters && !isWechatDouyinWeeklyBrief && !isWeeklySummaryView && !isStoreChangeView && (
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">情感分析</label>
                <select className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700">
                  <option>全部</option>
                  <option>正面</option>
                  <option>中性</option>
                  <option>负面</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">趋势方向</label>
                <select className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700">
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
      <div className="mb-4 text-sm text-slate-600">
        共找到 <span className="font-semibold text-slate-900">{filteredAndSortedItems.length}</span> 条监测数据
      </div>

      {/* Monitor List */}
      <div className="space-y-0">
        {filteredAndSortedItems.length > 0 ? (
          filteredAndSortedItems.map((item) => (
            <MonitorCard key={item.id} item={item} onClick={onItemClick} />
          ))
        ) : (
          <div className="py-12 text-center text-slate-500">
            <p>暂无监测数据</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MonitorList;
