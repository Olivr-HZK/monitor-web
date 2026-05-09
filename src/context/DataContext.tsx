import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { loadUsGameRankingsFromCSVs } from '../data/gameRankingLoader';
import {
  loadSensorTowerTop100,
  loadSensorTowerRankChanges,
  loadSensorTowerNewTop3StoreCards,
  loadSensorTowerStoreChanges,
  loadSensorTowerRemovedGames,
  loadSensorTowerTop5Overview,
  resetSensorTowerDatabaseCache,
} from '../data/sensortowerTopLoader';
import { buildSensorTowerWeeklyItems } from '../data/sensortowerWeeklyReport';
import {
  loadAiCreativeLibraryFromDb,
  buildAiProductWeeklyReportItem,
  loadAiProductUADailyReport,
  loadAiUaWeeklyReportFromDb,
  loadAiUaCreativeCardsFromDb,
} from '../data/aiProductLoader';
import { loadReportsData, resetGameplayDatabaseCache } from '../data/reportsLoader';
import { loadWeeklyReportsFromDatabase } from '../data/weeklyReportLoader';
import { loadAllDailyReports } from '../data/dailyReportLoader';
import { loadReportDocuments } from '../data/reportDocumentsLoader';
import {
  loadOurProductDailyItems,
  resetOurProductDatabaseCache,
} from '../data/ourProductDailyLoader';
import {
  loadOurProductRankAnalytics,
  type OurProductRankAnalytics,
} from '../data/ourProductAnalyticsLoader';
import type {
  GameRanking,
  MonitorItem,
  SensorTowerRankChangeItem,
  SensorTowerStoreCard,
  SensorTowerStoreChangeItem,
  SensorTowerTopItem,
  WechatDouyinRankingsByWeek,
  MonitorType,
  CasualGameMainCategory,
  AiCreativeLibraryItem,
} from '../types';

interface DataContextValue {
  dataLoading: boolean;
  monitorItems: MonitorItem[];
  weeklyReports: MonitorItem[];
  aiProductRankings: GameRanking[];
  aiCreativeLibraryNewItems: AiCreativeLibraryItem[];
  aiCreativeLibraryHotItems: AiCreativeLibraryItem[];
  aiCreativeLibrarySurgeItems: AiCreativeLibraryItem[];
  wechatDouyinRankings: GameRanking[];
  /** 按周聚合的微信/抖音三榜单，用于周选择器（多周时 length > 1） */
  wechatDouyinRankingsByWeek: WechatDouyinRankingsByWeek[];
  sensorTowerTopItems: SensorTowerTopItem[];
  sensorTowerRankChangeItems: SensorTowerRankChangeItem[];
  sensorTowerStoreCards: SensorTowerStoreCard[];
  sensorTowerStoreChanges: SensorTowerStoreChangeItem[];
  sensortowerStoreCardItems: MonitorItem[];
  storeChangeMonitorItems: MonitorItem[];
  storeChangeItemMap: Map<string, MonitorItem>;
  ourProductRankAnalytics: OurProductRankAnalytics | null;
  findMonitorItem: (id: string) => MonitorItem | undefined;
  findStoreCard: (id: string) => SensorTowerStoreCard | undefined;
}

const DataContext = createContext<DataContextValue | undefined>(undefined);

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
    // 标题只显示「发生了哪些类型的变化」，不展开具体内容
    const moduleSet = new Set<string>();
    for (const s of change.summaries) {
      if (s.includes('截图')) moduleSet.add('截图');
      if (s.includes('图标')) moduleSet.add('图标');
      if (s.includes('视频封面')) moduleSet.add('视频封面');
      else if (s.includes('视频')) moduleSet.add('视频');
      if (s.includes('语言')) moduleSet.add('语言');
      if (s.includes('评分')) moduleSet.add('评分');
      if (s.includes('商店链接')) moduleSet.add('商店链接');
      if (s.includes('名称')) moduleSet.add('名称');
      if (s.includes('开发者')) moduleSet.add('开发者');
      if (s.includes('分类')) moduleSet.add('分类');
      if (s.includes('价格')) moduleSet.add('价格');
      if (s.includes('安装量')) moduleSet.add('安装量');
      if (s.includes('内容评级')) moduleSet.add('内容评级');
      if (s.includes('描述')) moduleSet.add('描述');
    }
    const modules = Array.from(moduleSet);
    const modulesText = modules.join('、');
    const fullTitle = modules.length > 0 ? `${change.appName}（${modulesText}变化）` : `${change.appName} 变化`;
    const contentLines = [
      `变动时间：${change.changedAt || change.rankDate}`,
      `平台：${change.platform}`,
      change.developer ? `开发者：${change.developer}` : '',
      change.storeUrl ? `商店链接：${change.storeUrl}` : '',
      '',
      '变更项：',
      ...(change.summaries.length ? change.summaries.map((s) => `- ${s}`) : ['- （未解析到具体字段）']),
    ].filter(Boolean);
    // 卡片描述不包含商店链接，避免长 URL 撑出卡片；详情页 content 中仍保留
    const cardDescription = `变动时间：${change.changedAt || change.rankDate}；${summariesText}`;
    return {
      id: change.id,
      type: '休闲游戏监测' as MonitorType,
      title: fullTitle,
      source: 'SensorTower',
      platform: change.platform,
      date,
      time,
      views: 0,
      engagement: 0,
      description: cardDescription,
      tags: ['商店页变化', 'SensorTower', change.platform, `优先级:${change.priorityLabel}`],
      language: 'zh',
      casualGameCategory: '商店页变化' as CasualGameMainCategory,
      casualGameSource: 'sensortower' as const,
      reportContent: JSON.stringify({
        title: fullTitle,
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

export const DataProvider = ({ children }: { children: React.ReactNode }) => {
  const { authMode, user, loading: authLoading, getDataUrl } = useAuth();
  const [wechatDouyinRankings, setWechatDouyinRankings] = useState<GameRanking[]>([]);
  const [wechatDouyinRankingsByWeek, setWechatDouyinRankingsByWeek] = useState<WechatDouyinRankingsByWeek[]>([]);
  const [_sensorTowerRankings, setSensorTowerRankings] = useState<GameRanking[]>([]);
  const [sensorTowerTopItems, setSensorTowerTopItems] = useState<SensorTowerTopItem[]>([]);
  const [sensorTowerRankChangeItems, setSensorTowerRankChangeItems] = useState<SensorTowerRankChangeItem[]>([]);
  const [sensorTowerStoreCards, setSensorTowerStoreCards] = useState<SensorTowerStoreCard[]>([]);
  const [sensorTowerStoreChanges, setSensorTowerStoreChanges] = useState<SensorTowerStoreChangeItem[]>([]);
  const [aiProductRankings, setAiProductRankings] = useState<GameRanking[]>([]);
  const [aiCreativeLibraryNewItems, setAiCreativeLibraryNewItems] = useState<AiCreativeLibraryItem[]>([]);
  const [aiCreativeLibraryHotItems, setAiCreativeLibraryHotItems] = useState<AiCreativeLibraryItem[]>([]);
  const [aiCreativeLibrarySurgeItems, setAiCreativeLibrarySurgeItems] = useState<AiCreativeLibraryItem[]>([]);
  const [ourProductRankAnalytics, setOurProductRankAnalytics] = useState<OurProductRankAnalytics | null>(null);
  const [monitorItems, setMonitorItems] = useState<MonitorItem[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<MonitorItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // 鉴权完成前勿拉数据：否则 authMode 仍为初始 static，会误用静态 .db 路径（deploy:api 下 404）
  const shouldLoadData = !authLoading && (authMode === 'static' || user);
  // 静态模式（托管页）也必须用 getDataUrl，否则相对路径在 base=/monitor-web/ 下会解析错误导致 404
  const useFullDataUrls = authMode === 'static' || (authMode === 'backend' && user);

  useEffect(() => {
    if (!shouldLoadData) return;
    const loadData = async () => {
      // 避免 sql.js 模块级缓存锁死：曾 401/静态 404 后永久 null，改走 API 也不重拉
      resetSensorTowerDatabaseCache();
      resetGameplayDatabaseCache();
      resetOurProductDatabaseCache();

      // 超时保护：避免大文件/慢网络导致永远停在「数据加载中」
      const timeoutMs = 28000;
      const timeoutId = setTimeout(() => {
        setDataLoading(false);
      }, timeoutMs);

      const csvConfig = useFullDataUrls
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
      const dbUrl = useFullDataUrls ? getDataUrl('competitor_data.db') : 'competitor_data.db';
      const getDataUrlFn = useFullDataUrls ? getDataUrl : undefined;
      try {
        const [
          rankings,
          reportsData,
          weeklyReportsFromDb,
          dailyReports,
          reportDocuments,
          aiProductUADailyReport,
          aiUaWeeklyReport,
          aiUaCreativeCards,
          aiCreativeLibrary,
          sensorTowerTop,
          sensorTowerRankChanges,
          sensorTowerStoreCards,
          sensorTowerStoreChanges,
          sensorTowerRemovedGames,
          sensorTowerTop5Overview,
          ourProductDailyItems,
          ourProductAnalytics,
        ] = await Promise.all([
          loadUsGameRankingsFromCSVs(csvConfig).catch((error) => {
            console.error('Failed to load game rankings from CSVs:', error);
            return [];
          }),
          loadReportsData(getDataUrlFn).catch((error) => {
            console.error('Failed to load reports data:', error);
            return { wechatDouyinRankings: [], wechatDouyinRankingsByWeek: [], newGameItems: [], newPlayItems: [], weeklyBriefItems: [] };
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
          loadAiProductUADailyReport(getDataUrlFn).catch(() => null),
          loadAiUaWeeklyReportFromDb(getDataUrlFn).catch(() => null),
          loadAiUaCreativeCardsFromDb(getDataUrlFn).catch((error) => {
            console.error('Failed to load AI UA creative cards from DB:', error);
            return [];
          }),
          loadAiCreativeLibraryFromDb(getDataUrlFn).catch((error) => {
            console.error('Failed to load AI creative library from DB:', error);
            return { newItems: [], hotItems: [], surgeItems: [] };
          }),
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
          loadSensorTowerRemovedGames(getDataUrlFn).catch((error) => {
            console.error('Failed to load SensorTower removed games:', error);
            return [];
          }),
          loadSensorTowerTop5Overview(getDataUrlFn).catch((error) => {
            console.error('Failed to load SensorTower top5 overview:', error);
            return [];
          }),
          loadOurProductDailyItems(getDataUrlFn).catch((error) => {
            console.error('Failed to load own product daily items:', error);
            return [];
          }),
          loadOurProductRankAnalytics(getDataUrlFn).catch((error) => {
            console.error('Failed to load own product rank analytics:', error);
            return null;
          }),
        ]);

        const wechatDouyin = reportsData.wechatDouyinRankings ?? [];
        const byWeek = reportsData.wechatDouyinRankingsByWeek ?? [];
        if (wechatDouyin.length > 0) {
          setWechatDouyinRankings(wechatDouyin);
        }
        setWechatDouyinRankingsByWeek(byWeek);
        if (byWeek.length > 1 && typeof console !== 'undefined' && console.info) {
          console.info('[DataContext] 微信/抖音排行榜已设置多周数据，周数:', byWeek.length);
        }
        if (rankings.length > 0) {
          setSensorTowerRankings(rankings);
        }
        setSensorTowerTopItems(sensorTowerTop ?? []);
        setSensorTowerRankChangeItems(sensorTowerRankChanges ?? []);
        setSensorTowerStoreCards(sensorTowerStoreCards ?? []);
        setSensorTowerStoreChanges(sensorTowerStoreChanges ?? []);
        setAiProductRankings([]);
        setAiCreativeLibraryNewItems(aiCreativeLibrary.newItems ?? []);
        setAiCreativeLibraryHotItems(aiCreativeLibrary.hotItems ?? []);
        setAiCreativeLibrarySurgeItems(aiCreativeLibrary.surgeItems ?? []);
        setOurProductRankAnalytics(ourProductAnalytics ?? null);

        setWeeklyReports(weeklyReportsFromDb);

        const sensorTowerWeeklyItems = buildSensorTowerWeeklyItems(
          sensorTowerRankChanges ?? [],
          sensorTowerStoreChanges ?? [],
          sensorTowerRemovedGames ?? [],
          sensorTowerTop5Overview ?? []
        );
        const sensorTowerStoreChangeItems = buildStoreChangeMonitorItems(sensorTowerStoreChanges ?? []);
        const casualGameItems = [
          ...(reportsData.weeklyBriefItems ?? []),
          ...(reportsData.newGameItems ?? []),
          ...(reportsData.newPlayItems ?? []),
          ...sensorTowerWeeklyItems,
          ...sensorTowerStoreChangeItems,
          ...(ourProductDailyItems ?? []),
        ];

        const competitorSocialItems: MonitorItem[] = [];

        const aiProductItems: MonitorItem[] = [];
        const aiWeeklyCard = buildAiProductWeeklyReportItem(aiCreativeLibrary);
        if (aiWeeklyCard) {
          aiProductItems.push(aiWeeklyCard);
        }
        if (aiProductUADailyReport) {
          aiProductItems.push(aiProductUADailyReport);
        }
        if (aiUaWeeklyReport) {
          aiProductItems.push(aiUaWeeklyReport);
        }
        if (aiUaCreativeCards && aiUaCreativeCards.length > 0) {
          aiProductItems.push(...aiUaCreativeCards);
        }

        setMonitorItems([
          ...dailyReports,
          ...reportDocuments,
          ...weeklyReportsFromDb,
          ...casualGameItems,
          ...competitorSocialItems,
          ...aiProductItems,
        ]);
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        clearTimeout(timeoutId);
        setDataLoading(false);
      }
    };

    loadData();
  }, [shouldLoadData, authLoading, authMode, user, getDataUrl]);

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

  const storeChangeMonitorItems = useMemo(
    () => buildStoreChangeMonitorItems(sensorTowerStoreChanges),
    [sensorTowerStoreChanges]
  );

  const storeChangeItemMap = useMemo(() => {
    const map = new Map<string, MonitorItem>();
    storeChangeMonitorItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [storeChangeMonitorItems]);

  const findMonitorItem = (id: string) => monitorItems.find((item) => item.id === id);
  const findStoreCard = (id: string) => sensorTowerStoreCards.find((card) => card.id === id);

  const value = useMemo<DataContextValue>(
    () => ({
      dataLoading,
      monitorItems,
      weeklyReports,
      aiProductRankings,
      aiCreativeLibraryNewItems,
      aiCreativeLibraryHotItems,
      aiCreativeLibrarySurgeItems,
      wechatDouyinRankings,
      wechatDouyinRankingsByWeek,
      sensorTowerTopItems,
      sensorTowerRankChangeItems,
      sensorTowerStoreCards,
      sensorTowerStoreChanges,
      sensortowerStoreCardItems,
      storeChangeMonitorItems,
      storeChangeItemMap,
      ourProductRankAnalytics,
      findMonitorItem,
      findStoreCard,
    }),
    [
      dataLoading,
      monitorItems,
      weeklyReports,
      aiProductRankings,
      aiCreativeLibraryNewItems,
      aiCreativeLibraryHotItems,
      aiCreativeLibrarySurgeItems,
      wechatDouyinRankings,
      wechatDouyinRankingsByWeek,
      sensorTowerTopItems,
      sensorTowerRankChangeItems,
      sensorTowerStoreCards,
      sensorTowerStoreChanges,
      sensortowerStoreCardItems,
      storeChangeMonitorItems,
      storeChangeItemMap,
      ourProductRankAnalytics,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
};
