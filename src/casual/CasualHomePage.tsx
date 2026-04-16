import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import CasualHeader from './CasualHeader';
import MonitorList from '../components/MonitorList';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import type { MonitorItem, AiProductSubCategory } from '../types';
import { useCasualView } from './CasualViewContext';
import { stateWithReturnTo } from '../utils/navigation';

const CasualHomePage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { dataLoading, monitorItems, weeklyReports } = useData();

  const {
    selectedType,
    setSelectedType,
    selectedCompany,
    setSelectedCompany,
    selectedCasualGameCategory,
    setSelectedCasualGameCategory,
    selectedGamePlatform,
    setSelectedGamePlatform,
    selectedCasualGameCompetitorSub,
    setSelectedCasualGameCompetitorSub,
    selectedCasualSourceSection,
    setSelectedCasualSourceSection,
    selectedCasualOurProductSub,
    setSelectedCasualOurProductSub,
    selectedAiProductSub,
    setSelectedAiProductSub,
  } = useCasualView();

  useEffect(() => {
    if (selectedCasualGameCategory !== '我方产品') {
      setSelectedCasualOurProductSub('日总结');
    }
  }, [selectedCasualGameCategory, setSelectedCasualOurProductSub]);

  useEffect(() => {
    const s = (location.state as { restoreCasualSourceSection?: 'wechat_douyin' | 'sensortower' } | null)
      ?.restoreCasualSourceSection;
    if (s === 'sensortower' || s === 'wechat_douyin') {
      setSelectedCasualSourceSection(s);
    }
  }, [location.key, location.state, setSelectedCasualSourceSection]);

  const handleAiProductSubSelect = (sub: AiProductSubCategory | null) => {
    setSelectedAiProductSub(sub ?? '产品周报');
  };

  const companyOptions = useMemo(
    () =>
      Array.from(new Map(weeklyReports.map((item) => [item.companyName, item.companyName])).entries())
        .filter(([name]) => !!name)
        .map(([name]) => name as string)
        .sort(),
    [weeklyReports]
  );

  const getCasualGamePageTitle = () => {
    if (!selectedCasualGameCategory) return '休闲游戏监测';
    if (selectedCasualGameCategory === '周报简要') return '休闲游戏监测 - 周报简要';
    if (selectedCasualGameCategory === '我方产品') {
      const sub = selectedCasualOurProductSub ?? '日总结';
      if (sub === '日总结') return '休闲游戏监测 - 我方产品 · US 免费榜日总结';
      return '休闲游戏监测 - 我方产品 · 按产品追溯';
    }
    if (selectedCasualGameCategory === '商店页变化') return '休闲游戏监测 - 商店页变化';
    if (selectedCasualGameCategory === '新游戏') {
      return selectedGamePlatform
        ? `休闲游戏监测 - 新游戏 - ${selectedGamePlatform}`
        : '休闲游戏监测 - 新游戏';
    }
    if (selectedCasualGameCategory === '新玩法') return '休闲游戏监测 - 新玩法';
    if (selectedCasualGameCategory === '竞品') {
      const subLabel =
        selectedCasualGameCompetitorSub === '社媒更新' ? '社媒监控' : selectedCasualGameCompetitorSub;
      return selectedCasualGameCompetitorSub
        ? `休闲游戏监测 - 竞品动态 - ${subLabel}`
        : '休闲游戏监测 - 竞品动态';
    }
    return '休闲游戏监测';
  };

  const handleReportClick = (item: MonitorItem) => {
    const state = {
      from: 'list' as const,
      returnTo: '/' as const,
      casualSourceSection: selectedCasualSourceSection,
    };
    if (item.reportContent && item.reportContent.trim().startsWith('{')) {
      try {
        const data = JSON.parse(item.reportContent) as { kind?: string; cardId?: string };
        if (data.kind === 'sensortower_store_card' && data.cardId) {
          navigate(`/store/${encodeURIComponent(data.cardId)}`, { state });
          return;
        }
      } catch {
        // ignore json parse error
      }
    }
    if (item.reportContent) {
      navigate(`/report/${encodeURIComponent(item.id)}`, { state });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <CasualHeader user={user} onLogout={logout} />
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex gap-8">
          <div className="flex-1 min-w-0 space-y-8">
            {selectedType === '休闲游戏监测' ? (
              <>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 mb-2 break-words">微信 / 抖音小游戏</h2>
                      <p className="text-sm text-slate-600 mb-4 line-clamp-4 md:line-clamp-none">
                        查看微信与抖音小游戏的最新排行榜，关注平台热门与新进榜小游戏表现。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        navigate('/rankings/casual/wechat_douyin', { state: stateWithReturnTo(location) })
                      }
                      className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors border border-blue-200 mt-auto"
                    >
                      <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                        />
                      </svg>
                      <span className="truncate">微信/抖音排行榜</span>
                    </button>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 mb-2 break-words">SensorTower 榜单</h2>
                      <p className="text-sm text-slate-600 mb-4 line-clamp-4 md:line-clamp-none">
                        查看 iOS Top100、Android Top100 及榜单异动，追踪全球重点休闲游戏表现。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        navigate('/rankings/casual/sensortower', { state: stateWithReturnTo(location) })
                      }
                      className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-violet-50 text-violet-700 text-sm font-medium hover:bg-violet-100 transition-colors border border-violet-200 mt-auto"
                    >
                      <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M3 3v18h18M7 15l4-8 4 6 3-5"
                        />
                      </svg>
                      <span className="truncate">SensorTower 排行榜</span>
                    </button>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 mb-2 break-words">竞品监测</h2>
                      <p className="text-sm text-slate-600 mb-4 line-clamp-4 md:line-clamp-none">
                        快速进入休闲游戏竞品监控视图，查看社媒更新与 UA 素材等内容。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCasualGameCategory('竞品');
                        setSelectedCasualGameCompetitorSub('社媒更新');
                        setSelectedCompany(null);
                      }}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-medium hover:bg-emerald-100 transition-colors border border-emerald-200 mt-auto"
                    >
                      <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 17l-3-3m0 0l3-3m-3 3h8m4 0a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <span className="truncate">打开竞品监测</span>
                    </button>
                  </div>
                </div>

                <MonitorList
                  items={monitorItems}
                  selectedType="休闲游戏监测"
                  selectedCompanyName={selectedCompany}
                  companies={companyOptions}
                  onCompanySelect={setSelectedCompany}
                  selectedCasualGameCategory={selectedCasualGameCategory ?? undefined}
                  selectedGamePlatform={selectedGamePlatform ?? undefined}
                  selectedCasualGameCompetitorSub={selectedCasualGameCompetitorSub ?? undefined}
                  selectedCasualSourceSection={selectedCasualSourceSection}
                  selectedCasualOurProductSub={selectedCasualOurProductSub}
                  pageTitle={getCasualGamePageTitle()}
                  onItemClick={handleReportClick}
                />
              </>
            ) : (
              <MonitorList
                items={monitorItems}
                selectedType="AI产品监测"
                selectedAiProductSub={selectedAiProductSub}
                pageTitle={`AI 产品监测 - ${selectedAiProductSub}`}
                onItemClick={handleReportClick}
              />
            )}

            {dataLoading && (
              <div className="mt-8 text-center text-sm text-slate-500">
                数据加载中...
              </div>
            )}
          </div>
          <Sidebar
            sources={[]}
            selectedType={selectedType}
            onTypeSelect={(type) => {
              if (type === '休闲游戏监测' || type === 'AI产品监测') {
                setSelectedType(type);
              }
            }}
            companies={companyOptions}
            selectedCompany={selectedCompany}
            onCompanySelect={setSelectedCompany}
            selectedCasualGameCategory={selectedCasualGameCategory}
            onCasualGameCategorySelect={(cat) => {
              setSelectedCasualGameCategory(cat);
              if (cat === '新游戏') {
                setSelectedGamePlatform('微信');
                setSelectedCasualGameCompetitorSub(null);
              } else if (cat === '竞品') {
                setSelectedCasualGameCompetitorSub('社媒更新');
                setSelectedGamePlatform(null);
                setSelectedCompany(null);
              } else {
                setSelectedGamePlatform(null);
                setSelectedCasualGameCompetitorSub(null);
              }
            }}
            selectedGamePlatform={selectedGamePlatform}
            onGamePlatformSelect={setSelectedGamePlatform}
            selectedCasualGameCompetitorSub={selectedCasualGameCompetitorSub}
            onCasualGameCompetitorSubSelect={setSelectedCasualGameCompetitorSub}
            selectedCasualSourceSection={selectedCasualSourceSection}
            onCasualSourceSectionSelect={setSelectedCasualSourceSection}
            selectedCasualOurProductSub={selectedCasualOurProductSub}
            onCasualOurProductSubSelect={setSelectedCasualOurProductSub}
            selectedAiProductSub={selectedAiProductSub}
            onAiProductSubSelect={handleAiProductSubSelect}
            visibleTypes={['休闲游戏监测', 'AI产品监测']}
            aiProductVisibleSubs={['产品周报', 'UA素材']}
            showAllTypeButton={false}
          />
        </div>
      </main>
    </div>
  );
};

export default CasualHomePage;

