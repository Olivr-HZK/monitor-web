import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { currentPathForReturn } from '../utils/navigation';
import Header from '../components/Header';
import MonitorList from '../components/MonitorList';
import Sidebar from '../components/Sidebar';
import { useAiPageContext } from '../context/AiPageContext';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import type {
  MonitorType,
  MonitorItem,
  CasualGameMainCategory,
  CasualGameCompetitorSub,
  CasualGameOurProductSub,
  GamePlatformKey,
  AiProductSubCategory,
} from '../types';

const parseMonitorType = (raw?: string): MonitorType | null => {
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  const allowed: MonitorType[] = ['ai热点监测', '热点趋势监测', '休闲游戏监测', 'AI产品监测', '竞品社媒监控'];
  return allowed.includes(decoded as MonitorType) ? (decoded as MonitorType) : null;
};

const MonitorTypePage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { monitorType } = useParams();
  const { user, logout } = useAuth();
  const {
    dataLoading,
    monitorItems,
    weeklyReports,
    ourProductRankAnalytics,
  } = useData();
  const { setPageMeta } = useAiPageContext();

  const selectedType = parseMonitorType(monitorType);
  const returnPath = currentPathForReturn(location);

  useEffect(() => {
    if (!selectedType) {
      navigate('/', { replace: true });
    }
  }, [selectedType, navigate]);

  /** 旧独立路由「竞品社媒监控」并入休闲游戏侧栏；避免侧栏不展开、顶栏无高亮导致难以切换模块 */
  useEffect(() => {
    if (selectedType === '竞品社媒监控') {
      navigate(`/type/${encodeURIComponent('休闲游戏监测')}`, {
        replace: true,
        state: { casualHubTarget: 'competitor' },
      });
    }
  }, [selectedType, navigate]);

  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const isCasualGame = selectedType === '休闲游戏监测';
  const [selectedCasualGameCategory, setSelectedCasualGameCategory] = useState<CasualGameMainCategory | null>(null);
  const [selectedGamePlatform, setSelectedGamePlatform] = useState<GamePlatformKey | null>(null);
  const [selectedCasualGameCompetitorSub, setSelectedCasualGameCompetitorSub] = useState<CasualGameCompetitorSub | null>(null);
  const [selectedCasualSourceSection, setSelectedCasualSourceSection] = useState<'wechat_douyin' | 'sensortower'>('sensortower');
  const [selectedCasualOurProductSub, setSelectedCasualOurProductSub] = useState<CasualGameOurProductSub>('日总结');
  const [selectedAiProductSub, setSelectedAiProductSub] = useState<AiProductSubCategory | null>(null);

  useEffect(() => {
    const s = (location.state as { restoreCasualSourceSection?: 'wechat_douyin' | 'sensortower' } | null)
      ?.restoreCasualSourceSection;
    if (s === 'sensortower' || s === 'wechat_douyin') {
      setSelectedCasualSourceSection(s);
    }
  }, [location.key, location.state]);

  useEffect(() => {
    if (selectedType !== '休闲游戏监测') {
      setSelectedCasualGameCategory(null);
      setSelectedGamePlatform(null);
      setSelectedCasualGameCompetitorSub(null);
      return;
    }
    const hubTarget = (location.state as { casualHubTarget?: 'competitor' | 'our_product' } | null)?.casualHubTarget;
    if (hubTarget === 'competitor') {
      setSelectedCasualGameCategory('竞品');
      setSelectedCasualGameCompetitorSub('社媒更新');
      setSelectedGamePlatform(null);
      setSelectedCompany(null);
      return;
    }
    if (hubTarget === 'our_product') {
      setSelectedCasualGameCategory('我方产品');
      setSelectedCasualOurProductSub('日总结');
      setSelectedCasualGameCompetitorSub(null);
      setSelectedGamePlatform(null);
      setSelectedCompany(null);
      return;
    }
    if (selectedCasualGameCategory === null) {
      setSelectedCasualGameCategory('周报简要');
      setSelectedGamePlatform('微信');
    }
  }, [selectedType, selectedCasualGameCategory, location.key]);

  useEffect(() => {
    if (selectedCasualGameCategory !== '我方产品') {
      setSelectedCasualOurProductSub('日总结');
    }
  }, [selectedCasualGameCategory]);

  useEffect(() => {
    if (selectedType !== '休闲游戏监测') return;
    if ((location.state as { casualHubTarget?: string } | null)?.casualHubTarget !== 'our_product') return;
    const timer = window.setTimeout(() => {
      document.getElementById('sidebar-casual-own-product')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 150);
    return () => clearTimeout(timer);
  }, [selectedType, location.key, location.state]);

  useEffect(() => {
    if (selectedType !== 'AI产品监测') {
      setSelectedAiProductSub(null);
      return;
    }
    if (selectedAiProductSub === null) {
      setSelectedAiProductSub('产品周报');
    }
  }, [selectedType, selectedAiProductSub]);

  const handleTypeSelect = (type: MonitorType | '全部') => {
    if (type === '全部') {
      navigate('/');
      return;
    }
    navigate(`/type/${encodeURIComponent(type)}`);
  };

  const companyOptions = useMemo(
    () =>
      Array.from(new Map(weeklyReports.map((item) => [item.companyName, item.companyName])).entries())
        .filter(([name]) => !!name)
        .map(([name]) => name as string)
        .sort(),
    [weeklyReports]
  );

  const getAiProductPageTitle = () => {
    if (!selectedAiProductSub) return 'AI产品监测';
    return `AI产品监测 - ${selectedAiProductSub}`;
  };

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
      return selectedGamePlatform ? `休闲游戏监测 - 新游戏 - ${selectedGamePlatform}` : '休闲游戏监测 - 新游戏';
    }
    if (selectedCasualGameCategory === '新玩法') return '休闲游戏监测 - 新玩法';
    if (selectedCasualGameCategory === '竞品') {
      const subLabel = selectedCasualGameCompetitorSub === '社媒更新' ? '社媒监控' : selectedCasualGameCompetitorSub;
      return selectedCasualGameCompetitorSub
        ? `休闲游戏监测 - 竞品动态 - ${subLabel}`
        : '休闲游戏监测 - 竞品动态';
    }
    return '休闲游戏监测';
  };

  useEffect(() => {
    if (!selectedType) return;
    if (isCasualGame) {
      setPageMeta({
        monitorType: '休闲游戏监测',
        pageTitle: getCasualGamePageTitle(),
        casualGameCategory: selectedCasualGameCategory ?? undefined,
        gamePlatform: selectedGamePlatform ?? undefined,
        casualCompetitorSub: selectedCasualGameCompetitorSub ?? undefined,
        casualSourceSection: selectedCasualSourceSection,
        companyFilter: selectedCompany ?? undefined,
      });
      return;
    }
    if (selectedType === 'AI产品监测') {
      setPageMeta({
        monitorType: 'AI产品监测',
        pageTitle: getAiProductPageTitle(),
        aiProductSub: selectedAiProductSub ?? undefined,
      });
      return;
    }
    setPageMeta({
      monitorType: selectedType,
      pageTitle: `${selectedType}列表`,
      companyFilter: selectedCompany ?? undefined,
    });
  }, [
    selectedType,
    isCasualGame,
    selectedCasualGameCategory,
    selectedGamePlatform,
    selectedCasualGameCompetitorSub,
    selectedCasualSourceSection,
    selectedCompany,
    selectedAiProductSub,
    selectedCasualOurProductSub,
    setPageMeta,
  ]);

  const handleReportClick = (item: MonitorItem) => {
    if (item.reportContent && item.reportContent.trim().startsWith('{')) {
      try {
        const data = JSON.parse(item.reportContent) as { kind?: string; cardId?: string };
        if (data.kind === 'sensortower_store_card' && data.cardId) {
          navigate(`/store/${encodeURIComponent(data.cardId)}`, {
            state: {
              returnTo: returnPath,
              ...(selectedType === '休闲游戏监测'
                ? { casualSourceSection: selectedCasualSourceSection }
                : {}),
              ...(selectedCasualGameCategory === '竞品' ? { casualHubTarget: 'competitor' as const } : {}),
              ...(selectedCasualGameCategory === '我方产品' ? { casualHubTarget: 'our_product' as const } : {}),
            },
          });
          return;
        }
      } catch {
        // ignore json parse error
      }
    }
    if (item.reportContent) {
      navigate(`/report/${encodeURIComponent(item.id)}`, {
        state: {
          returnTo: returnPath,
          ...(selectedType === '休闲游戏监测' ? { casualSourceSection: selectedCasualSourceSection } : {}),
          ...(selectedCasualGameCategory === '竞品' ? { casualHubTarget: 'competitor' as const } : {}),
          ...(selectedCasualGameCategory === '我方产品' ? { casualHubTarget: 'our_product' as const } : {}),
        },
      });
    }
  };

  if (!selectedType) return null;

  if (selectedType === '竞品社媒监控') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm">
        正在进入休闲游戏监测…
      </div>
    );
  }

  const goMonitorType = (type: MonitorType) => {
    navigate(`/type/${encodeURIComponent(type)}`);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header selectedType={selectedType} onTypeSelect={handleTypeSelect} user={user} onLogout={logout} />
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex gap-8">
          <div className="flex-1 min-w-0">
            {isCasualGame ? (
              <div className="space-y-6">
                <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-6">
                  <div className="bg-white border-2 border-ink p-5 shadow-brutal-sm flex flex-col justify-between">
                    <div>
                      <h2 className="text-lg font-display font-bold text-ink uppercase tracking-tight mb-2 break-words">微信 / 抖音小游戏</h2>
                      <p className="text-sm font-medium text-inkLight mb-4 line-clamp-4 md:line-clamp-none">
                        查看微信与抖音小游戏的最新排行榜，关注平台热门与新进榜小游戏表现。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        navigate('/rankings/casual/wechat_douyin', {
                          state: { returnTo: returnPath, casualSourceSection: 'wechat_douyin' },
                        })
                      }
                      className="inline-flex items-center justify-center px-4 py-2 bg-white border-2 border-ink text-ink text-sm font-bold uppercase tracking-widest hover:bg-ink hover:text-surface transition-colors shadow-brutal-sm hover:shadow-brutal mt-auto"
                    >
                      <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="square" strokeLinejoin="miter" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                      <span className="truncate">查看排行榜</span>
                    </button>
                  </div>

                  <div className="bg-white border-2 border-ink p-5 shadow-brutal-sm flex flex-col justify-between">
                    <div>
                      <h2 className="text-lg font-display font-bold text-ink uppercase tracking-tight mb-2 break-words">SensorTower 榜单</h2>
                      <p className="text-sm font-medium text-inkLight mb-4 line-clamp-4 md:line-clamp-none">
                        查看 iOS Top100、Android Top100 及榜单异动，追踪全球重点休闲游戏表现。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        navigate('/rankings/casual/sensortower', {
                          state: { returnTo: returnPath, casualSourceSection: 'sensortower' },
                        })
                      }
                      className="inline-flex items-center justify-center px-4 py-2 bg-white border-2 border-ink text-ink text-sm font-bold uppercase tracking-widest hover:bg-ink hover:text-surface transition-colors shadow-brutal-sm hover:shadow-brutal mt-auto"
                    >
                      <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="square" strokeLinejoin="miter" d="M3 3v18h18M7 15l4-8 4 6 3-5" />
                      </svg>
                      <span className="truncate">查看排行榜</span>
                    </button>
                  </div>

                  <div className="bg-white border-2 border-ink p-5 shadow-brutal-sm flex flex-col justify-between">
                    <div>
                      <h2 className="text-lg font-display font-bold text-ink uppercase tracking-tight mb-2 break-words">竞品监测</h2>
                      <p className="text-sm font-medium text-inkLight mb-4 line-clamp-4 md:line-clamp-none">
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
                      className="inline-flex items-center justify-center px-4 py-2 bg-white border-2 border-ink text-ink text-sm font-bold uppercase tracking-widest hover:bg-ink hover:text-surface transition-colors shadow-brutal-sm hover:shadow-brutal mt-auto"
                    >
                      <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="square" strokeLinejoin="miter" d="M11 17l-3-3m0 0l3-3m-3 3h8m4 0a9 9 0 11-18 0 9 9 0 0118 0z" />
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
                  ourProductRankAnalytics={ourProductRankAnalytics}
                  pageTitle={getCasualGamePageTitle()}
                  onNavigateMonitorType={goMonitorType}
                  onItemClick={handleReportClick}
                />
              </div>
            ) : selectedType === 'AI产品监测' ? (
              <MonitorList
                items={monitorItems}
                selectedType="AI产品监测"
                selectedAiProductSub={selectedAiProductSub ?? undefined}
                pageTitle={getAiProductPageTitle()}
                onNavigateMonitorType={goMonitorType}
                headerAction={
                  <button
                    type="button"
                    onClick={() => navigate('/rankings/ai', { state: { returnTo: returnPath } })}
                    className="inline-flex items-center px-4 py-2 bg-white border-2 border-ink text-ink text-sm font-bold uppercase tracking-widest hover:bg-ink hover:text-surface transition-colors shadow-brutal-sm hover:shadow-brutal"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="square" strokeLinejoin="miter" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Asset Library
                  </button>
                }
                onItemClick={handleReportClick}
              />
            ) : (
              <MonitorList
                items={monitorItems}
                selectedType={selectedType}
                selectedCompanyName={selectedCompany}
                onNavigateMonitorType={goMonitorType}
                onItemClick={handleReportClick}
              />
            )}
          </div>
          <Sidebar
            sources={[]}
            selectedType={selectedType}
            onTypeSelect={handleTypeSelect}
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
            selectedAiProductSub={selectedAiProductSub}
            onAiProductSubSelect={setSelectedAiProductSub}
            selectedCasualSourceSection={selectedCasualSourceSection}
            onCasualSourceSectionSelect={setSelectedCasualSourceSection}
            selectedCasualOurProductSub={selectedCasualOurProductSub}
            onCasualOurProductSubSelect={setSelectedCasualOurProductSub}
          />
        </div>
        {dataLoading && (
          <div className="mt-8 text-center text-sm text-slate-500">
            数据加载中...
          </div>
        )}
      </main>
    </div>
  );
};

export default MonitorTypePage;
