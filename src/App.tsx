import { useState, useEffect } from 'react';
import Header from './components/Header';
import MonitorList from './components/MonitorList';
import GameRankingView from './components/GameRankingView';
import Sidebar from './components/Sidebar';
import WeeklyReportDetail from './components/WeeklyReportDetail';
import { mockMonitorItems, mockMonitorSources } from './data/mockData';
import { mockGameRankings } from './data/gameRankings';
import { loadGameRankingsFromCSV } from './data/gameRankingLoader';
import { loadWeeklyReportsFromDatabase } from './data/weeklyReportLoader';
import { loadAllDailyReports } from './data/dailyReportLoader';
import type { MonitorType } from './types';
import type { GameRanking, GamePlatformKey, MonitorItem, CasualGameMainCategory, CasualGameCompetitorSub } from './types';

function App() {
  const [selectedType, setSelectedType] = useState<MonitorType | '全部'>('全部');
  const [gameRankings, setGameRankings] = useState<GameRanking[]>(mockGameRankings);
  const [monitorItems, setMonitorItems] = useState<MonitorItem[]>(mockMonitorItems);
  const [weeklyReports, setWeeklyReports] = useState<MonitorItem[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<MonitorItem | null>(null);

  // 休闲游戏检测：新游戏/新玩法/竞品；新游戏下按平台；竞品下社媒更新/UA素材
  const isCasualGame = selectedType === '休闲游戏检测';
  const [selectedCasualGameCategory, setSelectedCasualGameCategory] = useState<CasualGameMainCategory | null>(null);
  const [selectedGamePlatform, setSelectedGamePlatform] = useState<GamePlatformKey | null>(null);
  const [selectedCasualGameCompetitorSub, setSelectedCasualGameCompetitorSub] = useState<CasualGameCompetitorSub | null>(null);
  const [showRankingsView, setShowRankingsView] = useState(false);

  useEffect(() => {
    if (selectedType !== '休闲游戏检测') {
      setSelectedCasualGameCategory(null);
      setSelectedGamePlatform(null);
      setSelectedCasualGameCompetitorSub(null);
      setShowRankingsView(false);
    } else if (selectedCasualGameCategory === null) {
      setSelectedCasualGameCategory('新游戏');
      setSelectedGamePlatform('微信');
    }
  }, [selectedType, selectedCasualGameCategory]);

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

  // 加载CSV数据、周报数据和日报数据
  useEffect(() => {
    const loadData = async () => {
      try {
        // 并行加载游戏排行榜、周报和日报数据
        const [rankings, weeklyReportsFromDb, dailyReports] = await Promise.all([
          loadGameRankingsFromCSV(`${import.meta.env.BASE_URL}周报谷歌表单.csv`).catch((error) => {
            console.error('Failed to load game rankings from CSV:', error);
            return mockGameRankings;
          }),
          loadWeeklyReportsFromDatabase().catch((error) => {
            console.error('Failed to load weekly reports from database:', error);
            return [];
          }),
          loadAllDailyReports().catch((error) => {
            console.error('Failed to load daily reports:', error);
            return [];
          })
        ]);

        if (rankings.length > 0) {
          setGameRankings(rankings);
        }

        // 保存周报列表
        setWeeklyReports(weeklyReportsFromDb);

        // 仅保留非“竞品社媒监控”的 mock 数据，竞品部分完全由周报接管
        const casualGameItems = mockMonitorItems.filter(
          (item) => item.type === '休闲游戏检测'
        );

        const competitorSocialItems = mockMonitorItems.filter(
          (item) => item.type === '竞品社媒监控'
        );

        // 日报 + 周报 + 休闲游戏 mock + 竞品社媒 mock
        setMonitorItems([
          ...dailyReports,
          ...weeklyReportsFromDb,
          ...casualGameItems,
          ...competitorSocialItems
        ]);
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // 休闲游戏检测页面标题
  const getCasualGamePageTitle = () => {
    if (!selectedCasualGameCategory) return '休闲游戏检测';
    if (selectedCasualGameCategory === '新游戏') {
      return selectedGamePlatform ? `休闲游戏检测 - 新游戏 - ${selectedGamePlatform}` : '休闲游戏检测 - 新游戏';
    }
    if (selectedCasualGameCategory === '新玩法') return '休闲游戏检测 - 新玩法';
    if (selectedCasualGameCategory === '竞品') {
      return selectedCasualGameCompetitorSub
        ? `休闲游戏检测 - 竞品 - ${selectedCasualGameCompetitorSub}`
        : '休闲游戏检测 - 竞品';
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
      <Header selectedType={selectedType} onTypeSelect={setSelectedType} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          <div className="flex-1">
            {isCasualGame ? (
              showRankingsView ? (
                loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-gray-600">加载中...</div>
                  </div>
                ) : (
                  <GameRankingView
                    rankings={gameRankings}
                    onBack={() => setShowRankingsView(false)}
                  />
                )
              ) : (
                <MonitorList
                  items={monitorItems}
                  selectedType="休闲游戏检测"
                  selectedCasualGameCategory={selectedCasualGameCategory ?? undefined}
                  selectedGamePlatform={selectedGamePlatform ?? undefined}
                  selectedCasualGameCompetitorSub={selectedCasualGameCompetitorSub ?? undefined}
                  selectedCompanyName={
                    selectedCasualGameCategory === '竞品' &&
                    selectedCasualGameCompetitorSub === '社媒更新'
                      ? selectedCompany
                      : undefined
                  }
                  pageTitle={getCasualGamePageTitle()}
                  headerAction={
                    selectedCasualGameCategory === '新游戏' ? (
                      <button
                        type="button"
                        onClick={() => setShowRankingsView(true)}
                        className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        进入排行榜
                      </button>
                    ) : undefined
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
              sources={mockMonitorSources}
              selectedType={selectedType}
              onTypeSelect={(type) => {
                setSelectedType(type);
                if (type === '休闲游戏检测') {
                  setSelectedCasualGameCategory('新游戏');
                  setSelectedGamePlatform('微信');
                  setSelectedCasualGameCompetitorSub(null);
                  setSelectedCompany(null);
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
                } else                 if (cat === '竞品') {
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
            />
        </div>
      </main>
    </div>
  );
}

export default App;
