import { useState, useEffect, useMemo } from 'react';
import { useAuth } from './context/AuthContext';
import Header from './components/Header';
import MonitorList from './components/MonitorList';
import GameRankingView from './components/GameRankingView';
import SensorTowerTopTable from './components/SensorTowerTopTable';
import Sidebar from './components/Sidebar';
import WeeklyReportDetail from './components/WeeklyReportDetail';
import StoreInfoDetail from './components/StoreInfoDetail';
import Login from './components/Login';
import { loadUsGameRankingsFromCSVs } from './data/gameRankingLoader';
import { loadSensorTowerTop100, loadSensorTowerRankChanges, loadSensorTowerNewTop3StoreCards, loadSensorTowerStoreChanges } from './data/sensortowerTopLoader';
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
  SensorTowerStoreCard,
  SensorTowerStoreChangeItem,
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
  const [sensorTowerStoreCards, setSensorTowerStoreCards] = useState<SensorTowerStoreCard[]>([]);
  const [sensorTowerStoreChanges, setSensorTowerStoreChanges] = useState<SensorTowerStoreChangeItem[]>([]);
  const [selectedStoreCard, setSelectedStoreCard] = useState<SensorTowerStoreCard | null>(null);
  // AI产品检测 - 进入排行榜时展示的榜单（竞品动态，来自 ai_sales_batch_crawler.csv）
  const [aiProductRankings, setAiProductRankings] = useState<GameRanking[]>([]);
  const [monitorItems, setMonitorItems] = useState<MonitorItem[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<MonitorItem[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  // 页面数据加载状态，避免与 AuthContext 中的 loading 混淆
  const [dataLoading, setDataLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<MonitorItem | null>(null);

  // 休闲游戏监测：新游戏/新玩法/竞品；新游戏下按平台；竞品下社媒更新/UA素材
  const isCasualGame = selectedType === '休闲游戏监测';
  const [selectedCasualGameCategory, setSelectedCasualGameCategory] = useState<CasualGameMainCategory | null>(null);
  const [selectedGamePlatform, setSelectedGamePlatform] = useState<GamePlatformKey | null>(null);
  const [selectedCasualGameCompetitorSub, setSelectedCasualGameCompetitorSub] = useState<CasualGameCompetitorSub | null>(null);
  // 休闲游戏监测：排行榜入口分为微信/抖音 与 SensorTower 两块
  const [casualRankingSection, setCasualRankingSection] = useState<'wechat_douyin' | 'sensortower' | null>(null);
  // 休闲游戏监测：侧边栏选中的数据块（微信/抖音 与 SensorTower 隔离，列表只显示对应来源）
  const [selectedCasualSourceSection, setSelectedCasualSourceSection] = useState<'wechat_douyin' | 'sensortower'>('wechat_douyin');
  // AI产品监测：产品周报 / UA素材 / 竞品动态 / 新产品速览；排行榜通过右上角按钮进入
  const [selectedAiProductSub, setSelectedAiProductSub] = useState<AiProductSubCategory | null>(null);
  const [showAiProductRankingsView, setShowAiProductRankingsView] = useState(false);

  useEffect(() => {
    if (selectedType !== '休闲游戏监测') {
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
    if (selectedType !== 'AI产品监测') {
      setSelectedAiProductSub(null);
      setShowAiProductRankingsView(false);
    } else if (selectedAiProductSub === null) {
      setSelectedAiProductSub('产品周报');
    }
  }, [selectedType, selectedAiProductSub]);

  // SensorTower 新进 Top3 转为玩法拆解列表项（仅当 SensorTower + 玩法拆解 时合并进列表）
  const sensortowerStoreCardItems = useMemo(() => {
    return sensorTowerStoreCards.map((card) => {
      const desc =
        card.shortDescription ||
        (card.storeInfo && 'short_description' in card.storeInfo && card.storeInfo.short_description
          ? card.storeInfo.short_description
          : card.storeInfo && 'description_short' in card.storeInfo && card.storeInfo.description_short
            ? card.storeInfo.description_short
            : '点击查看应用详情');
      return {
        id: card.id,
        type: '休闲游戏监测' as MonitorType,
        title: card.gameName,
        source: 'SensorTower',
        platform: card.platform,
        date: '',
        time: '',
        views: 0,
        engagement: 0,
        description: desc,
        coverImage: card.screenshotUrl,
        tags: ['新进榜', '美国', card.platform],
        language: 'zh',
        casualGameCategory: '新游戏' as CasualGameMainCategory,
        casualGameSource: 'sensortower' as const,
        reportContent: JSON.stringify({ kind: 'sensortower_store_card', cardId: card.id }),
      } as MonitorItem;
    });
  }, [sensorTowerStoreCards]);

  const buildStoreChangeMonitorItems = (changes: SensorTowerStoreChangeItem[]) => {
    const splitDateTime = (value?: string) => {
      if (!value) return { date: '', time: '' };
      const normalized = value.replace('T', ' ');
      const [date, time] = normalized.split(' ');
      return { date: date ?? '', time: time ?? '' };
    };
    const sorted = [...changes].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const bt = new Date(b.changedAt || b.rankDate).getTime();
      const at = new Date(a.changedAt || a.rankDate).getTime();
      return bt - at;
    });
    return sorted.map((change) => {
      const { date, time } = splitDateTime(change.changedAt || change.rankDate);
      const summariesText = change.summaries.length ? change.summaries.join('，') : '检测到商店页变化';
      const contentLines = [
        `变动时间：${change.changedAt || change.rankDate}`,
        `平台：${change.platform}`,
        change.developer ? `开发者：${change.developer}` : '',
        change.storeUrl ? `商店链接：${change.storeUrl}` : '',
        '',
        '变更项：',
        ...(change.summaries.length ? change.summaries.map((s) => `- ${s}`) : ['- （未解析到具体字段）']),
      ].filter(Boolean);
      return {
        id: change.id,
        type: '休闲游戏监测' as MonitorType,
        title: change.appName,
        source: 'SensorTower',
        platform: change.platform,
        date,
        time,
        views: 0,
        engagement: 0,
        description: `变动时间：${change.changedAt || change.rankDate}；${summariesText}`,
        tags: ['商店页变化', 'SensorTower', change.platform, `优先级:${change.priorityLabel}`],
        language: 'zh',
        casualGameCategory: '商店页变化' as CasualGameMainCategory,
        casualGameSource: 'sensortower' as const,
        reportContent: JSON.stringify({
          title: `商店页变化 - ${change.appName}`,
          date,
          time,
          source: 'SensorTower',
          tags: ['商店页变化', change.platform, `优先级:${change.priorityLabel}`],
          content: contentLines.join('\n'),
          meta: {
            kind: 'store_change',
            changedAt: change.changedAt || change.rankDate,
            platform: change.platform,
            developer: change.developer,
            storeUrl: change.storeUrl,
            priority: change.priorityLabel,
            summaries: change.summaries,
            screenshots: {
              before: change.screenshotBefore ?? [],
              after: change.screenshotAfter ?? [],
            },
            icon: {
              before: change.iconBefore,
              after: change.iconAfter,
            },
            videoImages: {
              before: change.videoImagesBefore ?? [],
              after: change.videoImagesAfter ?? [],
            },
          },
        }),
      } as MonitorItem;
    });
  };

  const storeChangeMonitorItems = useMemo(
    () => buildStoreChangeMonitorItems(sensorTowerStoreChanges),
    [sensorTowerStoreChanges]
  );
  const storeChangeItemMap = useMemo(() => {
    const map = new Map<string, MonitorItem>();
    storeChangeMonitorItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [storeChangeMonitorItems]);

  // 处理点击：商店卡片进 StoreInfoDetail，其余有 reportContent 的进周报/日报详情
  const handleReportClick = (item: MonitorItem) => {
    if (item.reportContent && item.reportContent.trim().startsWith('{')) {
      try {
        const data = JSON.parse(item.reportContent) as { kind?: string; cardId?: string };
        if (data.kind === 'sensortower_store_card' && data.cardId) {
          const card = sensorTowerStoreCards.find((c) => c.id === data.cardId);
          if (card) {
            setSelectedStoreCard(card);
            return;
          }
        }
      } catch {
        // not JSON or not store card
      }
    }
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
          sensorTowerStoreCards,
          sensorTowerStoreChanges,
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
          loadSensorTowerNewTop3StoreCards(getDataUrlFn).catch((error) => {
            console.error('Failed to load SensorTower new top3 store cards:', error);
            return [];
          }),
          loadSensorTowerStoreChanges(getDataUrlFn).catch((error) => {
            console.error('Failed to load SensorTower store changes:', error);
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
        setSensorTowerStoreCards(sensorTowerStoreCards ?? []);
        setSensorTowerStoreChanges(sensorTowerStoreChanges ?? []);
        if (aiSalesRankings.length > 0) {
          setAiProductRankings(aiSalesRankings);
        }

        // 保存周报列表
        setWeeklyReports(weeklyReportsFromDb);

        // 休闲游戏监测：周报简要（按监控日期）+ 新游戏/新玩法（来自 reports）+ SensorTower 周报（来自 rank_changes）
        const sensorTowerWeeklyItems = buildSensorTowerWeeklyItems(
          sensorTowerRankChanges ?? [],
          sensorTowerStoreChanges ?? []
        );
        const sensorTowerStoreChangeItems = buildStoreChangeMonitorItems(sensorTowerStoreChanges ?? []);
        const casualGameItems = [
          ...(reportsData.weeklyBriefItems ?? []),
          ...(reportsData.newGameItems ?? []),
          ...(reportsData.newPlayItems ?? []),
          ...sensorTowerWeeklyItems,
          ...sensorTowerStoreChangeItems,
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

        // 日报 + report_documents + 周报 + 休闲游戏监测（周报简要/新游戏/新玩法）+ AI产品监测（含竞品动态报告）
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

  // AI产品监测页面标题
  const getAiProductPageTitle = () => {
    if (!selectedAiProductSub) return 'AI产品监测';
    return `AI产品监测 - ${selectedAiProductSub}`;
  };

  // 休闲游戏监测页面标题（竞品→竞品动态，社媒更新→社媒监控 展示）
  const getCasualGamePageTitle = () => {
    if (!selectedCasualGameCategory) return '休闲游戏监测';
    if (selectedCasualGameCategory === '周报简要') return '休闲游戏监测 - 周报简要';
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

  const handleTypeSelect = (type: MonitorType | '全部') => {
    setSelectedType(type);
    if (type === '休闲游戏监测') {
      setSelectedCasualGameCategory(null);
      setSelectedGamePlatform(null);
      setSelectedCasualGameCompetitorSub(null);
      setSelectedCompany(null);
    }
    if (type === 'AI产品监测') {
      setSelectedAiProductSub('产品周报');
      setShowAiProductRankingsView(false);
    }
  };

  const homeStats = useMemo(() => {
    const byType = {
      ai热点监测: 0,
      热点趋势监测: 0,
      休闲游戏监测: 0,
      AI产品监测: 0,
    } as Record<MonitorType, number>;
    monitorItems.forEach((item) => {
      if (item.type in byType) {
        byType[item.type] += 1;
      }
    });
    return {
      totalItems: monitorItems.length,
      weeklyReports: weeklyReports.length,
      aiProductRankings: aiProductRankings.length,
      byType,
    };
  }, [monitorItems, weeklyReports, aiProductRankings]);

  // 如果选中了周报详情，显示详情页
  if (selectedReport) {
    return (
      <WeeklyReportDetail
        item={selectedReport}
        onBack={handleBack}
        storeChangeItemMap={storeChangeItemMap}
        onOpenStoreChange={(changeItem) => setSelectedReport(changeItem)}
      />
    );
  }
  // 如果选中了商店信息卡片详情，显示商店信息页
  if (selectedStoreCard) {
    return (
      <StoreInfoDetail
        card={selectedStoreCard}
        onBack={() => setSelectedStoreCard(null)}
      />
    );
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header selectedType={selectedType} onTypeSelect={handleTypeSelect} user={user} onLogout={logout} />
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        {selectedType === '全部' ? (
          <div className="space-y-10">
            <div className="rounded-3xl border border-slate-800/70 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900/80 p-8 md:p-10 shadow-[0_0_80px_rgba(34,211,238,0.08)]">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 text-xs font-semibold text-cyan-300">
                    实时监测中心
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white">
                    监测汇总 · 前沿趋势看板
                  </h1>
                  <p className="max-w-2xl text-sm md:text-base text-slate-300">
                    聚合 AI 热点、趋势监测、休闲游戏与 AI 产品情报。快速进入对应监测，掌握每日关键变化。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm text-slate-300">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="text-xs uppercase text-slate-500">监测类型</div>
                    <div className="mt-2 text-2xl font-semibold text-cyan-300">4</div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="text-xs uppercase text-slate-500">监测条目</div>
                    <div className="mt-2 text-2xl font-semibold text-emerald-300">
                      {homeStats.totalItems.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="text-xs uppercase text-slate-500">周报数量</div>
                    <div className="mt-2 text-2xl font-semibold text-violet-300">
                      {homeStats.weeklyReports.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="text-xs uppercase text-slate-500">AI 榜单</div>
                    <div className="mt-2 text-2xl font-semibold text-amber-300">
                      {homeStats.aiProductRankings.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  type: 'ai热点监测' as const,
                  title: 'AI 热点',
                  description: '跟踪 AI 领域热点事件、投融资与行业动态。',
                  accent: 'from-cyan-500/20 via-cyan-400/10 to-transparent',
                  glow: 'shadow-[0_0_40px_rgba(34,211,238,0.25)]',
                  value: homeStats.byType.ai热点监测,
                  icon: '🤖',
                },
                {
                  type: '热点趋势监测' as const,
                  title: '趋势监测',
                  description: '追踪行业趋势、关键话题及传播走势。',
                  accent: 'from-violet-500/20 via-fuchsia-400/10 to-transparent',
                  glow: 'shadow-[0_0_40px_rgba(139,92,246,0.2)]',
                  value: homeStats.byType.热点趋势监测,
                  icon: '📈',
                },
                {
                  type: '休闲游戏监测' as const,
                  title: '休闲游戏',
                  description: '聚焦排行榜、新游戏与玩法拆解，洞察竞品动向。',
                  accent: 'from-emerald-500/20 via-green-400/10 to-transparent',
                  glow: 'shadow-[0_0_40px_rgba(16,185,129,0.2)]',
                  value: homeStats.byType.休闲游戏监测,
                  icon: '🎮',
                },
                {
                  type: 'AI产品监测' as const,
                  title: 'AI 产品',
                  description: '汇总产品周报、UA 素材与竞品动态。',
                  accent: 'from-amber-500/20 via-orange-400/10 to-transparent',
                  glow: 'shadow-[0_0_40px_rgba(251,191,36,0.2)]',
                  value: homeStats.byType.AI产品监测,
                  icon: '✨',
                },
              ].map((card) => (
                <button
                  key={card.type}
                  type="button"
                  onClick={() => handleTypeSelect(card.type)}
                  className={`group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-left transition-all hover:-translate-y-1 hover:border-slate-600 ${card.glow}`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${card.accent} opacity-0 transition-opacity group-hover:opacity-100`} />
                  <div className="relative z-10 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">{card.icon}</span>
                      <span className="text-xs text-slate-500">进入监测 →</span>
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">{card.title}</h2>
                      <p className="mt-2 text-sm text-slate-400">{card.description}</p>
                    </div>
                    <div className="flex items-end justify-between">
                      <div className="text-xs text-slate-500">当前条目</div>
                      <div className="text-2xl font-semibold text-slate-100">
                        {card.value.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex gap-8">
            <div className="flex-1">
              {isCasualGame ? (
              casualRankingSection ? (
                dataLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-slate-400">加载中...</div>
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
                    storeChanges={sensorTowerStoreChanges}
                    onBack={() => setCasualRankingSection(null)}
                  />
                )
              ) : (
                <div className="space-y-6">
                  {/* 三块入口：微信/抖音、SensorTower、竞品监测 */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* 微信/抖音小游戏板块 */}
                    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-white mb-2">微信 / 抖音小游戏</h2>
                        <p className="text-sm text-slate-400 mb-4">
                          查看微信与抖音小游戏的最新排行榜，关注平台热门与新进榜小游戏表现。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCasualRankingSection('wechat_douyin')}
                        className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-200 text-sm font-medium hover:bg-cyan-500/30 transition-colors border border-cyan-500/30"
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
                    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-white mb-2">SensorTower 榜单</h2>
                        <p className="text-sm text-slate-400 mb-4">
                          查看 iOS Top100、Android Top100 及榜单异动，追踪全球重点休闲游戏表现。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCasualRankingSection('sensortower')}
                        className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-violet-500/20 text-violet-200 text-sm font-medium hover:bg-violet-500/30 transition-colors border border-violet-500/30"
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

                    {/* 竞品监测板块 */}
                    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-white mb-2">竞品监测</h2>
                        <p className="text-sm text-slate-400 mb-4">
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
                        className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-200 text-sm font-medium hover:bg-emerald-500/30 transition-colors border border-emerald-500/30"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 17l-3-3m0 0l3-3m-3 3h8m4 0a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        打开竞品监测
                      </button>
                    </div>
                  </div>

                  {/* 列表视图：玩法拆解下合并 SensorTower 新进 Top3 卡片，其余为周报/新游戏/新玩法等 */}
                  <MonitorList
                    items={
                      selectedCasualSourceSection === 'sensortower' &&
                      selectedCasualGameCategory === '玩法拆解' &&
                      sensortowerStoreCardItems.length > 0
                        ? [...sensortowerStoreCardItems, ...monitorItems]
                        : monitorItems
                    }
                    selectedType="休闲游戏监测"
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
            ) : selectedType === 'AI产品监测' ? (
              showAiProductRankingsView ? (
                dataLoading ? (
                  <div className="flex justify-center py-12">
                    <div className="text-slate-400">加载中...</div>
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
                  selectedType="AI产品监测"
                  selectedAiProductSub={selectedAiProductSub ?? undefined}
                  pageTitle={getAiProductPageTitle()}
                  headerAction={
                    <button
                      type="button"
                      onClick={() => setShowAiProductRankingsView(true)}
                      className="inline-flex items-center px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-200 text-sm font-medium hover:bg-cyan-500/30 transition-colors border border-cyan-500/30"
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
      )}
      </main>
    </div>
  );
}

export default App;
