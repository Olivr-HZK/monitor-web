export type MonitorType = 'ai热点检测' | '热点趋势检测' | '竞品社媒监控' | '休闲游戏检测';

export type GameRankingType = '微信小游戏' | '抖音小游戏' | '安卓游戏' | 'iOS游戏';

/** 侧栏休闲游戏检测平台 key，与 GameRankingType 对应 */
export type GamePlatformKey = '微信' | '抖音' | 'iOS' | '安卓';

/** 休闲游戏检测三大类 */
export type CasualGameMainCategory = '新游戏' | '新玩法' | '竞品';

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
  icon?: string; // 游戏图标URL
  developer: string; // 开发商
  category: string; // 游戏分类
  change: string; // 排名变化（原始字符串，如"↑11"、"新进榜"等）
  score?: number; // 评分/热度分数
  downloads?: string; // 下载量（格式化字符串，如"100万+"）
  updateDate: string; // 更新时间
  mechanism?: string; // 玩法机制（合并核心玩法_mechanism, operation, rules, features）
  microInnovations?: string; // 基线微调创新点（合并基线_base_genre, baseline_loop, micro_innovations）
}

export interface GameRanking {
  type: GameRankingType;
  title: string;
  updateTime: string; // 更新时间
  period: string; // 周期（如"周榜"）
  items: GameRankingItem[];
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
  /** 休闲游戏检测-竞品：小类（社媒更新/UA素材） */
  casualGameCompetitorSub?: CasualGameCompetitorSub;
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
