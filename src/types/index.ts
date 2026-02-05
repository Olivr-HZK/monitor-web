export type MonitorType = 'ai热点检测' | '热点趋势检测' | '竞品社媒监控' | '休闲游戏检测' | 'AI产品检测';

/** AI产品检测下的子类（排行榜通过右上角按钮进入，不在此列） */
export type AiProductSubCategory = '产品周报' | 'UA素材' | '竞品动态' | '新产品速览';

export type GameRankingType = '微信小游戏' | '抖音小游戏' | '安卓游戏' | 'iOS游戏' | '榜单异动' | '竞品动态';

/** 侧栏休闲游戏检测平台 key，与 GameRankingType 对应 */
export type GamePlatformKey = '微信' | '抖音' | 'iOS' | '安卓';

/** 休闲游戏检测大类
 * - 周报简要：按监控日期命名的完整报告
 * - 新游戏 / 新玩法：从榜单中自动抽取，用于玩法拆解
 * - 玩法拆解：汇总视图，同时包含 新游戏 + 新玩法
 * - 竞品：竞品动态（社媒更新 / UA素材）
 */
export type CasualGameMainCategory = '新游戏' | '新玩法' | '玩法拆解' | '竞品' | '周报简要';

/** 竞品下的两个小类 */
export type CasualGameCompetitorSub = '社媒更新' | 'UA素材';

export const GAME_PLATFORM_TO_RANKING_TYPE: Record<GamePlatformKey, GameRankingType> = {
  '微信': '微信小游戏',
  '抖音': '抖音小游戏',
  'iOS': 'iOS游戏',
  '安卓': '安卓游戏',
};

export interface GameRankingItem {
  id: string;
  rank: number; // 排名
  name: string; // 游戏名称
  // 以下字段会根据 CSV 类型按需填充
  /** 开发商 / 发行商名称 */
  developer?: string;
  /** 下载量（展示用字符串，如 “5000万+”） */
  downloads?: string;
  /** 玩法机制描述（合并多个 CSV 字段） */
  mechanism?: string;
  /** 基线创新点描述（合并多个 CSV 字段） */
  microInnovations?: string;
  platformLabel?: string; // 平台（如 iOS / Android）
  country?: string; // 国家（如 US）
  categoryId?: string; // 品类ID
  category?: string; // 品类名称 / 游戏分类
  listType?: string; // 榜单类型（如 免费榜）
  appId?: string; // App ID
  signal?: string; // 榜单异动：信号
  lastRankRaw?: string; // 榜单异动：上周排名原始值
  changeType?: string; // 榜单异动：异动类型
  change: string; // 排名变化（原始字符串，如"↑11"、"新进榜"等）
  updateDate: string; // 更新时间
  /** 可选的数值评分 / 热度指数 */
  score?: number;
}

export interface GameRanking {
  type: GameRankingType;
  title: string;
  updateTime: string; // 更新时间
  period: string; // 周期（如"周榜"）
  items: GameRankingItem[];
}

/** SensorTower Top100 榜单单条记录（可含 app_metadata 补充信息） */
export interface SensorTowerTopItem {
  id: string;
  platform: 'iOS' | 'Android';
  rankDate: string;
  country: string;
  chartType: string;
  rank: number;
  appId: string;
  /** 来自 app_metadata：应用/游戏名 */
  appName?: string;
  /** 来自 app_metadata：开发/发行公司 */
  publisherName?: string;
  /** 来自 app_metadata：发行日期 */
  releaseDate?: string;
}

/** SensorTower 异动榜单单条记录（rank_changes + 可选 app_metadata） */
export interface SensorTowerRankChangeItem {
  id: string;
  rankDateCurrent: string;
  rankDateLast: string;
  signal: string;
  appName: string;
  appId: string;
  country: string;
  platform: 'iOS' | 'Android';
  currentRank: number;
  lastWeekRank: string;
  change: string;
  changeType: string;
  /** 来自 app_metadata：应用/游戏名（若与 rank_changes.app_name 不同可覆盖） */
  metadataAppName?: string;
  /** 来自 app_metadata：开发/发行公司 */
  publisherName?: string;
  /** 来自 app_metadata：发行日期 */
  releaseDate?: string;
  /** 下载量（rank_changes.downloads） */
  downloads?: number;
  /** 收入（rank_changes.revenue） */
  revenue?: number;
}

/**
 * 统一日报文档格式
 * 用同一套字段描述所有日报（热点日报、AI日报、竞品周报等），便于列表展示与详情渲染
 */
export interface ReportDocument {
  /** 标题 */
  title: string;
  /** 标签 */
  tags?: string[];
  /** 日期，如 2026-01-28 或 01-28 */
  date?: string;
  /** 时间，如 09:00 */
  time?: string;
  /** 来源 */
  source?: string;
  /** 摘要（列表/卡片用） */
  summary?: string;
  /** 正文内容（Markdown 或纯文本，详情页渲染） */
  content: string;
  /** 评分（可选） */
  score?: number;
  /** 封面图 URL（可选） */
  coverImage?: string;
  /** 扩展信息（类型相关字段可放此处，如 heat、viewpoint、uaInspiration 等） */
  meta?: Record<string, unknown>;
}

/**
 * 各板块检测内容的统一渲染输入格式（按 kind 区分的存储格式）
 * reportContent 存为 JSON 字符串时，建议符合此结构，便于详情页统一解析与渲染
 */
export type ReportContentJson =
  | ReportContentDailyHot
  | ReportContentDailyAi
  | ReportContentDailyAiOverview
  | ReportContentWeeklyReport
  | ReportContentGameRanking;

/** 热点日报（热点趋势检测） */
export interface ReportContentDailyHot {
  kind: 'daily_hot';
  title?: string;
  score?: number;
  heat?: number;
  summary?: string;
  type?: string;       // 性质：影视/游戏等
  uaInspiration?: string;
  coverImage?: string;
}

/** AI 日报单条（ai热点检测 - 小红书条目） */
export interface ReportContentDailyAi {
  kind: 'daily_ai';
  title?: string;
  score?: number;
  tags?: string[];
  viewpoint?: string;
  summary?: string;
}

/** AI 日报概览（纯文本） */
export interface ReportContentDailyAiOverview {
  kind: 'daily_ai_overview';
  content: string;
}

/** 竞品周报（竞品社媒监控 - 飞书/DB 结构） */
export interface ReportContentWeeklyReport {
  kind: 'weekly_report';
  company?: string;
  start_date?: string;
  end_date?: string;
  period?: { start_date: string; end_date: string; days: number };
  card?: {
    header?: { title?: { content?: string } };
    elements?: Array<{
      tag?: string;
      text?: { tag?: string; content?: string };
      fields?: Array<{ text?: { tag?: string; content?: string } }>;
    }>;
  };
}

/** 休闲游戏周榜（仅当详情需展示排行榜时使用，一般用 GameRankingView） */
export interface ReportContentGameRanking {
  kind: 'game_ranking';
  type: GameRankingType;
  title: string;
  updateTime: string;
  period: string;
  items: GameRankingItem[];
}

/** 检测内容 kind 枚举 */
export type ReportContentKind =
  | 'daily_hot'
  | 'daily_ai'
  | 'daily_ai_overview'
  | 'weekly_report'
  | 'game_ranking';

/** 检测内容 JSON 的版本与根字段（可选，用于扩展） */
export interface ReportContentSchema {
  version?: '1.0';
  kind: ReportContentKind;
  [key: string]: unknown;
}

export interface MonitorItem {
  id: string;
  type: MonitorType;
  title: string;
  source: string;
  platform: string;
  companyName?: string; // 公司名（用于竞品周报筛选）
  /** 休闲游戏检测：大类（新游戏/新玩法/竞品） */
  casualGameCategory?: CasualGameMainCategory;
  /** 休闲游戏检测-数据来源块：仅微信/抖音 或 仅 SensorTower，用于前后端隔离 */
  casualGameSource?: 'wechat_douyin' | 'sensortower';
  /** 休闲游戏检测-竞品：小类（社媒更新/UA素材） */
  casualGameCompetitorSub?: CasualGameCompetitorSub;
  /** AI产品检测：子类（排行榜/产品周报/UA素材） */
  aiProductSub?: AiProductSubCategory;
  date: string;
  time: string;
  views: number;
  engagement: number; // 互动数（点赞、评论、转发等）
  description: string;
  tags: string[];
  coverImage?: string;
  language: string;
  trend?: 'up' | 'down' | 'stable'; // 趋势方向
  sentiment?: 'positive' | 'negative' | 'neutral'; // 情感分析
  url?: string; // 原文链接
  score?: number; // 评分（用于周报）
  /** 详情页渲染内容：统一格式为 ReportDocument（JSON 字符串），差异性体现在 content 字段；兼容旧 kind 格式 */
  reportContent?: string;
}

export interface MonitorSource {
  id: string;
  name: string;
  icon: string;
  type: MonitorType;
  count: number;
  platform?: string; // 平台名称，如微博、Twitter、Reddit等
}
