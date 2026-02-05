import { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import Header from './components/Header';
import MonitorList from './components/MonitorList';
import GameRankingView from './components/GameRankingView';
import SensorTowerTopTable from './components/SensorTowerTopTable';
import Sidebar from './components/Sidebar';
import WeeklyReportDetail from './components/WeeklyReportDetail';
import Login from './components/Login';
import { loadUsGameRankingsFromCSVs } from './data/gameRankingLoader';
import { loadSensorTowerTop100, loadSensorTowerRankChanges } from './data/sensortowerTopLoader';
import { buildSensorTowerWeeklyItems } from './data/sensortowerWeeklyReport';
import { loadCompetitorReportMd, loadAiSalesRankingFromCsv, loadAiProductUADailyReport } from './data/aiProductLoader';
import { loadReportsData } from './data/reportsLoader';
import { loadWeeklyReportsFromDatabase } from './data/weeklyReportLoader';
import { loadAllDailyReports } from './data/dailyReportLoader';
import { loadReportDocuments } from './data/reportDocumentsLoader';
import type { MonitorType } from './types';
import type {
  GameRanking,
  GamePlatformKey,
  MonitorItem,
  CasualGameMainCategory,
  CasualGameCompetitorSub,
  AiProductSubCategory,
  SensorTowerTopItem,
  SensorTowerRankChangeItem,
} from './types';

function App() {
  const { authMode, user, loading: authLoading, staticPasswordRequired, getDataUrl, logout } = useAuth();

  // 后端模式：验证登录中
  if (authMode === 'backend' && authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">验证登录中…</p>
      </div>
    );
  }
  // 未登录时显示登录页：后端模式 或 静态模式但配置了访问密码
  if ((authMode === 'backend' && !user) || (staticPasswordRequired && !user)) {
    return <Login />;
  }
  const [selectedType, setSelectedType] = useState<MonitorType | '全部'>('全部');
  // 休闲游戏排行榜拆分：微信/抖音 vs SensorTower
  const [wechatDouyinRankings, setWechatDouyinRankings] = useState<GameRanking[]>([]);
  const [_sensorTowerRankings, setSensorTowerRankings] = useState<GameRanking[]>([]);
  const [sensorTowerTopItems, setSensorTowerTopItems] = useState<SensorTowerTopItem[]>([]);
  const [sensorTowerRankChangeItems, setSensorTowerRankChangeItems] = useState<SensorTowerRankChangeItem[]>([]);
  // AI产品检测 - 进入排行榜时展示的榜单（竞品动态，来自 ai_sales_batch_crawler.csv）
  const [aiProductRankings, setAiProductRankings] = useState<GameRanking[]>([]);
  const [monitorItems, setMonitorItems] = useState<MonitorItem[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<MonitorItem[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  // 页面数据加载状态，避免与 AuthContext 中的 loading 混淆
  const [dataLoading, setDataLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<MonitorItem | null>(null);

  // 休闲游戏检测：新游戏/新玩法/竞品；新游戏下按平台；竞品下社媒更新/UA素材
  const isCasualGame = selectedType === '休闲游戏检测';
  const [selectedCasualGameCategory, setSelectedCasualGameCategory] = useState<CasualGameMainCategory | null>(null);
  const [selectedGamePlatform, setSelectedGamePlatform] = useState<GamePlatformKey | null>(null);
  const [selectedCasualGameCompetitorSub, setSelectedCasualGameCompetitorSub] = useState<CasualGameCompetitorSub | null>(null);
  // 休闲游戏检测：排行榜入口分为微信/抖音 与 SensorTower 两块
  const [casualRankingSection, setCasualRankingSection] = useState<'wechat_douyin' | 'sensortower' | null>(null);
  // 休闲游戏检测：侧边栏选中的数据块（微信/抖音 与 SensorTower 隔离，列表只显示对应来源）
  const [selectedCasualSourceSection, setSelectedCasualSourceSection] = useState<'wechat_douyin' | 'sensortower'>('wechat_douyin');
  // AI产品检测：产品周报 / UA素材 / 竞品动态 / 新产品速览；排行榜通过右上角按钮进入
  const [selectedAiProductSub, setSelectedAiProductSub] = useState<AiProductSubCategory | null>(null);
  const [showAiProductRankingsView, setShowAiProductRankingsView] = useState(false);

  useEffect(() => {
    if (selectedType !== '休闲游戏检测') {
      setSelectedCasualGameCategory(null);
      setSelectedGamePlatform(null);
      setSelectedCasualGameCompetitorSub(null);
      setCasualRankingSection(null);
    } else if (selectedCasualGameCategory === null) {
      setSelectedCasualGameCategory('周报简要');
      setSelectedGamePlatform('微信');
    }
  }, [selectedType, selectedCasualGameCategory]);

  useEffect(() => {
    if (selectedType !== 'AI产品检测') {
      setSelectedAiProductSub(null);
      setShowAiProductRankingsView(false);
    } else if (selectedAiProductSub === null) {
      setSelectedAiProductSub('产品周报');
    }
  }, [selectedType, selectedAiProductSub]);

  // 处理点击：有完整内容的项（周报、日报）进入详情页
  const handleReportClick = (item: MonitorItem) => {
    if (item.reportContent) {
      setSelectedReport(item);
    }
  };

  // 返回主界面
  const handleBack = () => {
    setSelectedReport(null);
    // 保留当前筛选条件，不重置类型和公司
  };

  // 加载CSV数据、周报数据和日报数据（静态模式或已登录后）
  const shouldLoadData = authMode === 'static' || user;
  useEffect(() => {
    if (!shouldLoadData) return;
    const loadData = async () => {
      const useAuthData = authMode === 'backend' && user;
      // 新排行榜：使用 public 下的 4 个 CSV 文件
      const csvConfig = useAuthData
        ? {
            iosTop: getDataUrl('休闲游戏检测/test_rankings_us_ios.csv'),
            androidTop: getDataUrl('休闲游戏检测/test_rankings_us_android.csv'),
            iosChanges: getDataUrl('休闲游戏检测/test_rank_changes_ios.csv'),
            androidChanges: getDataUrl('休闲游戏检测/test_rank_changes_android.csv'),
          }
        : {
            iosTop: '休闲游戏检测/test_rankings_us_ios.csv',
            androidTop: '休闲游戏检测/test_rankings_us_android.csv',
            iosChanges: '休闲游戏检测/test_rank_changes_ios.csv',
            androidChanges: '休闲游戏检测/test_rank_changes_android.csv',
          };
      const dbUrl = useAuthData ? getDataUrl('competitor_data.db') : 'competitor_data.db';
      const getDataUrlFn = useAuthData ? getDataUrl : undefined;
      try {
        const [
          rankings,
          reportsData,
          weeklyReportsFromDb,
          dailyReports,
          reportDocuments,
          competitorReportItem,
          aiSalesRankings,
          aiProductUADailyReport,
          sensorTowerTop,
          sensorTowerRankChanges,
        ] = await Promise.all([
          loadUsGameRankingsFromCSVs(csvConfig).catch((error) => {
            console.error('Failed to load game rankings from CSVs:', error);
            return [];
          }),
          loadReportsData(getDataUrlFn).catch((error) => {
            console.error('Failed to load reports data:', error);
            return { wechatDouyinRankings: [], newGameItems: [], newPlayItems: [], weeklyBriefItems: [] };
          }),
          loadWeeklyReportsFromDatabase(dbUrl).catch((error) => {
            console.error('Failed to load weekly reports from database:', error);
            return [];
          }),
          loadAllDailyReports(getDataUrlFn).catch((error) => {
            console.error('Failed to load daily reports:', error);
            return [];
          }),
          loadReportDocuments(getDataUrlFn).catch((error) => {
            console.error('Failed to load report_documents.json:', error);
            return [];
          }),
          loadCompetitorReportMd(getDataUrlFn).catch(() => null),
          loadAiSalesRankingFromCsv(getDataUrlFn).catch((error) => {
            console.error('Failed to load AI sales ranking:', error);
            return [];
          }),
          loadAiProductUADailyReport(getDataUrlFn).catch(() => null),
          loadSensorTowerTop100(getDataUrlFn).catch((error) => {
            console.error('Failed to load SensorTower top100 from DB:', error);
            return [];
          }),
          loadSensorTowerRankChanges(getDataUrlFn).catch((error) => {
            console.error('Failed to load SensorTower rank changes from DB:', error);
            return [];
          }),
        ]);

        // 休闲游戏排行榜拆分：
        // 1）微信/抖音小游戏榜单（来自 reportsData.wechatDouyinRankings）
        // 2）SensorTower 榜单（iOS/Android Top100 + 榜单异动，来自 CSV）
        const wechatDouyin = reportsData.wechatDouyinRankings ?? [];
        if (wechatDouyin.length > 0) {
          setWechatDouyinRankings(wechatDouyin);
        }
        if (rankings.length > 0) {
          setSensorTowerRankings(rankings);
        }
        setSensorTowerTopItems(sensorTowerTop ?? []);
        setSensorTowerRankChangeItems(sensorTowerRankChanges ?? []);
        if (aiSalesRankings.length > 0) {
          setAiProductRankings(aiSalesRankings);
        }

        // 保存周报列表
        setWeeklyReports(weeklyReportsFromDb);

        // 休闲游戏检测：周报简要（按监控日期）+ 新游戏/新玩法（来自 reports）+ SensorTower 周报（来自 rank_changes）
        const sensorTowerWeeklyItems = buildSensorTowerWeeklyItems(sensorTowerRankChanges ?? []);
        const casualGameItems = [
          ...(reportsData.weeklyBriefItems ?? []),
          ...(reportsData.newGameItems ?? []),
          ...(reportsData.newPlayItems ?? []),
          ...sensorTowerWeeklyItems,
        ];

        const competitorSocialItems: MonitorItem[] = [];

        const aiProductItems: MonitorItem[] = [];
        // 添加 AI 产品 UA 素材日报
        if (aiProductUADailyReport) {
          aiProductItems.push(aiProductUADailyReport);
        }
        // 竞品动态报告（竞品动态报告_AI产品.md）插入到竞品动态列表最前
        const aiProductWithReport = competitorReportItem
          ? [competitorReportItem, ...aiProductItems.filter((i) => i.aiProductSub !== '竞品动态')]
          : aiProductItems;

        // 日报 + report_documents + 周报 + 休闲游戏检测（周报简要/新游戏/新玩法）+ AI产品检测（含竞品动态报告）
        setMonitorItems([
          ...dailyReports,
          ...reportDocuments,
          ...weeklyReportsFromDb,
          ...casualGameItems,
          ...competitorSocialItems,
          ...aiProductWithReport,
        ]);
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setDataLoading(false);
      }
    };

    loadData();
  }, [shouldLoadData, authMode, user, getDataUrl]);

  // AI产品检测页面标题
  const getAiProductPageTitle = () => {
    if (!selectedAiProductSub) return 'AI产品检测';
    return `AI产品检测 - ${selectedAiProductSub}`;
  };

  // 休闲游戏检测页面标题（竞品→竞品动态，社媒更新→社媒监控 展示）
  const getCasualGamePageTitle = () => {
    if (!selectedCasualGameCategory) return '休闲游戏检测';
    if (selectedCasualGameCategory === '周报简要') return '休闲游戏检测 - 周报简要';
    if (selectedCasualGameCategory === '新游戏') {
      return selectedGamePlatform ? `休闲游戏检测 - 新游戏 - ${selectedGamePlatform}` : '休闲游戏检测 - 新游戏';
    }
    if (selectedCasualGameCategory === '新玩法') return '休闲游戏检测 - 新玩法';
    if (selectedCasualGameCategory === '竞品') {
      const subLabel = selectedCasualGameCompetitorSub === '社媒更新' ? '社媒监控' : selectedCasualGameCompetitorSub;
      return selectedCasualGameCompetitorSub
        ? `休闲游戏检测 - 竞品动态 - ${subLabel}`
        : '休闲游戏检测 - 竞品动态';
    }
    return '休闲游戏检测';
  };

  // 如果选中了周报详情，显示详情页
  if (selectedReport) {
    return <WeeklyReportDetail item={selectedReport} onBack={handleBack} />;
  }

  // 从周报中提取公司列表供侧边栏使用
  const companyOptions = Array.from(
    new Map(
      weeklyReports.map((item) => [item.companyName, item.companyName])
    ).entries()
  )
    .filter(([name]) => !!name)
    .map(([name]) => name as string)
    .sort();

  return (
    <div className="min-h-screen bg-white">
      <Header selectedType={selectedType} onTypeSelect={setSelectedType} user={user} onLogout={logout} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          <div className="flex-1">
            {isCasualGame ? (
              casualRankingSection ? (
                dataLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-gray-600">加载中...</div>
                  </div>
                ) : casualRankingSection === 'wechat_douyin' ? (
                  <GameRankingView
                    rankings={wechatDouyinRankings}
                    onBack={() => setCasualRankingSection(null)}
                  />
                ) : (
                  <SensorTowerTopTable
                    items={sensorTowerTopItems}
                    rankChangeItems={sensorTowerRankChangeItems}
                    onBack={() => setCasualRankingSection(null)}
                  />
                )
              ) : (
                <div className="space-y-6">
                  {/* 三块入口：微信/抖音、SensorTower、竞品检测 */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* 微信/抖音小游戏板块 */}
                    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900 mb-2">微信 / 抖音小游戏</h2>
                        <p className="text-sm text-gray-600 mb-4">
                          查看微信与抖音小游戏的最新排行榜，关注平台热门与新进榜小游戏表现。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCasualRankingSection('wechat_douyin')}
                        className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                          />
                        </svg>
                        微信/抖音排行榜
                      </button>
                    </div>

                    {/* SensorTower 榜单板块 */}
                    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900 mb-2">SensorTower 榜单</h2>
                        <p className="text-sm text-gray-600 mb-4">
                          查看 iOS Top100、Android Top100 及榜单异动，追踪全球重点休闲游戏表现。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCasualRankingSection('sensortower')}
                        className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M3 3v18h18M7 15l4-8 4 6 3-5"
                          />
                        </svg>
                        SensorTower 排行榜
                      </button>
                    </div>

                    {/* 竞品检测板块 */}
                    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900 mb-2">竞品检测</h2>
                        <p className="text-sm text-gray-600 mb-4">
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
                        className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 17l-3-3m0 0l3-3m-3 3h8m4 0a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        打开竞品检测
                      </button>
                    </div>
                  </div>

                  {/* 原有列表视图：支持周报简要 / 新游戏 / 新玩法 / 竞品等筛选 */}
                  <MonitorList
                    items={monitorItems}
                    selectedType="休闲游戏检测"
                    selectedCompanyName={selectedCompany}
                    companies={companyOptions}
                    onCompanySelect={setSelectedCompany}
                    selectedCasualGameCategory={selectedCasualGameCategory ?? undefined}
                    selectedGamePlatform={selectedGamePlatform ?? undefined}
                    selectedCasualGameCompetitorSub={selectedCasualGameCompetitorSub ?? undefined}
                    selectedCasualSourceSection={selectedCasualSourceSection}
                    pageTitle={getCasualGamePageTitle()}
                    onItemClick={handleReportClick}
                  />
                </div>
              )
            ) : selectedType === 'AI产品检测' ? (
              showAiProductRankingsView ? (
                dataLoading ? (
                  <div className="flex justify-center py-12">
                    <div className="text-gray-600">加载中...</div>
                  </div>
                ) : (
                  <GameRankingView
                    rankings={aiProductRankings}
                    onBack={() => setShowAiProductRankingsView(false)}
                  />
                )
              ) : (
                <MonitorList
                  items={monitorItems}
                  selectedType="AI产品检测"
                  selectedAiProductSub={selectedAiProductSub ?? undefined}
                  pageTitle={getAiProductPageTitle()}
                  headerAction={
                    <button
                      type="button"
                      onClick={() => setShowAiProductRankingsView(true)}
                      className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      进入排行榜
                    </button>
                  }
                  onItemClick={handleReportClick}
                />
              )
            ) : (
              <MonitorList 
                items={monitorItems} 
                selectedType={selectedType}
                selectedCompanyName={selectedCompany}
                onItemClick={handleReportClick}
              />
            )}
          </div>
          <Sidebar
              sources={[]}
              selectedType={selectedType}
              onTypeSelect={(type) => {
                setSelectedType(type);
                if (type === '休闲游戏检测') {
                  setSelectedCasualGameCategory(null);
                  setSelectedGamePlatform(null);
                  setSelectedCasualGameCompetitorSub(null);
                  setSelectedCompany(null);
                }
                if (type === 'AI产品检测') {
                  setSelectedAiProductSub('产品周报');
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
                  setSelectedCasualGameCompetitorSub('社媒更新'); // 竞品动态下默认「社媒监控」
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
            />
        </div>
      </main>
    </div>
  );
}

export default App;
