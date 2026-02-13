import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { loadUsGameRankingsFromCSVs } from '../data/gameRankingLoader';
import {
  loadSensorTowerTop100,
  loadSensorTowerRankChanges,
  loadSensorTowerNewTop3StoreCards,
  loadSensorTowerStoreChanges,
} from '../data/sensortowerTopLoader';
import { buildSensorTowerWeeklyItems } from '../data/sensortowerWeeklyReport';
import { loadCompetitorReportMd, loadAiSalesRankingFromCsv, loadAiProductUADailyReport } from '../data/aiProductLoader';
import { loadReportsData } from '../data/reportsLoader';
import { loadWeeklyReportsFromDatabase } from '../data/weeklyReportLoader';
import { loadAllDailyReports } from '../data/dailyReportLoader';
import { loadReportDocuments } from '../data/reportDocumentsLoader';
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
} from '../types';

interface DataContextValue {
  dataLoading: boolean;
  monitorItems: MonitorItem[];
  weeklyReports: MonitorItem[];
  aiProductRankings: GameRanking[];
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

export const DataProvider = ({ children }: { children: React.ReactNode }) => {
  const { authMode, user, getDataUrl } = useAuth();
  const [wechatDouyinRankings, setWechatDouyinRankings] = useState<GameRanking[]>([]);
  const [wechatDouyinRankingsByWeek, setWechatDouyinRankingsByWeek] = useState<WechatDouyinRankingsByWeek[]>([]);
  const [_sensorTowerRankings, setSensorTowerRankings] = useState<GameRanking[]>([]);
  const [sensorTowerTopItems, setSensorTowerTopItems] = useState<SensorTowerTopItem[]>([]);
  const [sensorTowerRankChangeItems, setSensorTowerRankChangeItems] = useState<SensorTowerRankChangeItem[]>([]);
  const [sensorTowerStoreCards, setSensorTowerStoreCards] = useState<SensorTowerStoreCard[]>([]);
  const [sensorTowerStoreChanges, setSensorTowerStoreChanges] = useState<SensorTowerStoreChangeItem[]>([]);
  const [aiProductRankings, setAiProductRankings] = useState<GameRanking[]>([]);
  const [monitorItems, setMonitorItems] = useState<MonitorItem[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<MonitorItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const shouldLoadData = authMode === 'static' || user;
  // 静态模式（托管页）也必须用 getDataUrl，否则相对路径在 base=/monitor-web/ 下会解析错误导致 404
  const useFullDataUrls = authMode === 'static' || (authMode === 'backend' && user);

  useEffect(() => {
    if (!shouldLoadData) return;
    const loadData = async () => {
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
        if (aiSalesRankings.length > 0) {
          setAiProductRankings(aiSalesRankings);
        }

        setWeeklyReports(weeklyReportsFromDb);

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
        if (aiProductUADailyReport) {
          aiProductItems.push(aiProductUADailyReport);
        }
        const aiProductWithReport = competitorReportItem
          ? [competitorReportItem, ...aiProductItems.filter((i) => i.aiProductSub !== '竞品动态')]
          : aiProductItems;

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
        clearTimeout(timeoutId);
        setDataLoading(false);
      }
    };

    loadData();
  }, [shouldLoadData, authMode, user, getDataUrl]);

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
      wechatDouyinRankings,
      wechatDouyinRankingsByWeek,
      sensorTowerTopItems,
      sensorTowerRankChangeItems,
      sensorTowerStoreCards,
      sensorTowerStoreChanges,
      sensortowerStoreCardItems,
      storeChangeMonitorItems,
      storeChangeItemMap,
      findMonitorItem,
      findStoreCard,
    }),
    [
      dataLoading,
      monitorItems,
      weeklyReports,
      aiProductRankings,
      wechatDouyinRankings,
      wechatDouyinRankingsByWeek,
      sensorTowerTopItems,
      sensorTowerRankChangeItems,
      sensorTowerStoreCards,
      sensorTowerStoreChanges,
      sensortowerStoreCardItems,
      storeChangeMonitorItems,
      storeChangeItemMap,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
};
