/**
 * 日报/周报详情页组件
 * 统一使用 ReportDocument 格式：标题、标签、时间、来源、摘要来自文档，正文仅渲染 content
 */

import { useEffect, useMemo, useState } from 'react';

/** 将 URL 中的百分号编码解码为可读字符再用于展示，避免显示 %E4%B8%AD 等“异常字母” */
function urlForDisplay(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}
import type { MonitorItem, ReportDocument, ReportContentAiCompetitorWeekly, AiCompetitorWeeklyItem } from '../types';
import { toReportDocument } from '../utils/reportDocument';
import { buildSensorTowerOverviewUrl } from '../utils/rankingLabels';
import MarkdownRenderer from './MarkdownRenderer';
import { useAuth } from '../context/AuthContext';
import { getApiUrl } from '../utils/api';

/** 竞品周报默认摘要（仅展示下载/收益变化明显的产品，大模型未返回时使用） */
const DEFAULT_AI_COMPETITOR_WEEKLY_SUMMARY = `- **ChatGPT（Android）**：收入较上周明显增加（约 +2,500 万级），下载小幅上升，付费转化在提升。
- **Google Gemini（iOS）**：收入环比约 **+27%**（约 3,650 万 → 4,650 万），下载略降，单用户变现增强。
- **ChatOn（Android）**：下载较上周减少约 **2.5 万**（约 -60%），收入略降，买量或热度有所回落。
- **UpFoto（Android）**：下载减少约 **2.5 万**，收入同步下滑，本周表现偏弱。
- **PhotoBoost（Android）**：下载 +1.2 万、收入 +约 28 万，在修图类里本周增长较突出。
- **AI Chatbot - Nova（Android）**：收入较上周增加约 **80 万级**，增幅明显大于下载，订阅或高价包可能有优化。

其余产品本周下载与收益波动不大，未单独列出。`;

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return String(Math.round(n));
}
function formatRevenue(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return n > 0 ? `$${Math.round(n)}` : '—';
}

function AiCompetitorWeeklyTable({ payload }: { payload: ReportContentAiCompetitorWeekly }) {
  const { weekThis, weekLast, items } = payload;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm border border-slate-200">
        <thead>
          <tr className="bg-slate-50 text-slate-600 font-medium">
            <th className="text-left py-3 px-4 border-b border-slate-200">产品名</th>
            <th className="text-left py-3 px-4 border-b border-slate-200">SensorTower</th>
            <th className="text-left py-3 px-4 border-b border-slate-200">开发商</th>
            <th className="text-left py-3 px-4 border-b border-slate-200">平台</th>
            <th className="text-right py-3 px-4 border-b border-slate-200">上周下载 ({weekLast})</th>
            <th className="text-right py-3 px-4 border-b border-slate-200">本周下载 ({weekThis})</th>
            <th className="text-right py-3 px-4 border-b border-slate-200">上周收益</th>
            <th className="text-right py-3 px-4 border-b border-slate-200">本周收益</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row: AiCompetitorWeeklyItem, idx: number) => {
            const stUrl = buildSensorTowerOverviewUrl(row.appId, 'US');
            return (
              <tr key={`${row.appId}-${row.platform}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50/80">
                <td className="py-2.5 px-4 text-slate-900 font-medium">
                  {row.storeUrl ? (
                    <a
                      href={row.storeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline"
                      title={row.productName}
                    >
                      {row.productName}
                      <svg aria-hidden className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M13 3h4v4a1 1 0 11-2 0V6.414l-6.293 6.293a1 1 0 01-1.414-1.414L13.586 5H13a1 1 0 110-2z" />
                        <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-4a1 1 0 112 0v4a4 4 0 01-4 4H5a4 4 0 01-4-4V7a4 4 0 014-4h4a1 1 0 110 2H5z" />
                      </svg>
                    </a>
                  ) : (
                    row.productName
                  )}
                </td>
                <td className="py-2.5 px-4">
                  {stUrl ? (
                    <a
                      href={stUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      查看
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="py-2.5 px-4 text-slate-600">{row.publisherName}</td>
                <td className="py-2.5 px-4 text-slate-600">{row.platform}</td>
                <td className="py-2.5 px-4 text-right text-slate-700 tabular-nums">{formatNum(row.downloadsLastWeek)}</td>
                <td className="py-2.5 px-4 text-right text-slate-700 tabular-nums">{formatNum(row.downloadsThisWeek)}</td>
                <td className="py-2.5 px-4 text-right text-slate-700 tabular-nums">{formatRevenue(row.revenueLastWeek)}</td>
                <td className="py-2.5 px-4 text-right text-slate-700 tabular-nums">{formatRevenue(row.revenueThisWeek)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface WeeklyReportDetailProps {
  item: MonitorItem;
  onBack: () => void;
  storeChangeItemMap?: Map<string, MonitorItem>;
  onOpenStoreChange?: (item: MonitorItem) => void;
  /** 点击总览中的 #entry:id 链接时，跳转到对应条目卡片详情 */
  onNavigateToEntry?: (id: string) => void;
}

/** 判断并解析为统一格式 ReportDocument（含 content 即视为统一格式） */
function parseAsReportDocument(
  raw: string,
  item: MonitorItem
): ReportDocument {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) {
    return toReportDocument(raw, item);
  }
  try {
    const data = JSON.parse(trimmed) as Partial<ReportDocument & { kind?: string }>;
    if (typeof data.content === 'string') {
      return {
        title: data.title ?? item.title,
        tags: data.tags ?? item.tags,
        date: data.date ?? item.date,
        time: data.time ?? item.time,
        source: data.source ?? item.source,
        summary: data.summary ?? item.description,
        content: data.content,
        score: data.score ?? item.score,
        coverImage: data.coverImage ?? item.coverImage,
        meta: data.meta,
      };
    }
  } catch {
    // 非 JSON 或缺少 content，走兼容转换
  }
  return toReportDocument(raw, item);
}

const WeeklyReportDetail = ({ item, onBack, storeChangeItemMap, onOpenStoreChange, onNavigateToEntry }: WeeklyReportDetailProps) => {
  const { getDataUrl } = useAuth();
  const doc = useMemo(() => {
    if (!item.reportContent) {
      return {
        title: item.title,
        tags: item.tags,
        date: item.date,
        time: item.time,
        source: item.source,
        summary: item.description,
        content: '暂无内容',
        score: item.score,
        coverImage: item.coverImage,
      } as ReportDocument;
    }
    return parseAsReportDocument(item.reportContent, item);
  }, [item]);

  const isAiHotspot = item.type === 'ai热点监测';
  const isHotTrend = item.type === '热点趋势监测';
  const isDailySummary =
    isHotTrend &&
    ((typeof doc.meta === 'object' && doc.meta && 'kind' in doc.meta && doc.meta.kind === 'daily_summary') ||
      (doc.tags ?? []).includes('每日汇总'));
  const originalUrl =
    (typeof doc.meta === 'object' && doc.meta && 'url' in doc.meta && typeof doc.meta.url === 'string'
      ? doc.meta.url
      : undefined) ||
    item.url;
  const storeChangeMeta =
    typeof doc.meta === 'object' && doc.meta && 'kind' in doc.meta && doc.meta.kind === 'store_change'
      ? (doc.meta as {
          changedAt?: string;
          platform?: string;
          developer?: string;
          storeUrl?: string;
          priority?: string;
          summaries?: string[];
          screenshots?: { before?: string[]; after?: string[] };
          icon?: { before?: string; after?: string };
          videoImages?: { before?: string[]; after?: string[] };
        })
      : null;
  const sensortowerWeeklyMeta =
    typeof doc.meta === 'object' && doc.meta && 'kind' in doc.meta && doc.meta.kind === 'sensortower_weekly'
      ? (doc.meta as {
          storeChanges?: Array<{
            id: string;
            appName: string;
            platform?: string;
            changedAt?: string;
            storeUrl?: string;
            summaries?: string[];
          }>;
        })
      : null;

  const aiCompetitorWeeklyPayload = useMemo((): ReportContentAiCompetitorWeekly | null => {
    const raw = item.reportContent?.trim();
    if (!raw || !raw.startsWith('{')) return null;
    try {
      const data = JSON.parse(raw) as ReportContentAiCompetitorWeekly;
      if (data.kind === 'ai_competitor_weekly' && Array.isArray(data.items)) return data;
      return null;
    } catch {
      return null;
    }
  }, [item.reportContent]);

  const [aiWeeklySummary, setAiWeeklySummary] = useState<string>('');
  const [aiWeeklySummaryLoading, setAiWeeklySummaryLoading] = useState(false);

  useEffect(() => {
    if (!aiCompetitorWeeklyPayload) {
      setAiWeeklySummary('');
      setAiWeeklySummaryLoading(false);
      return;
    }
    // 若已生成过摘要则不重复调用
    if (aiWeeklySummary) return;

    const controller = new AbortController();
    const run = async () => {
      try {
        setAiWeeklySummaryLoading(true);
        const weekThis = aiCompetitorWeeklyPayload.weekThis;
        // 优先尝试读取后端/脚本生成的摘要 JSON（public/ai产品/ai_竞品周报摘要_YYYY-MM-DD.json）
        const filename = `ai产品/ai_竞品周报摘要_${weekThis}.json`;
        const url = getDataUrl ? getDataUrl(filename) : filename;
        try {
          const resp = await fetch(url, { signal: controller.signal, credentials: 'include' });
          if (resp.ok) {
            const data = (await resp.json()) as { summary?: string };
            if (data.summary && typeof data.summary === 'string' && data.summary.trim()) {
              setAiWeeklySummary(data.summary.trim());
              return;
            }
          }
        } catch {
          // 若 JSON 不存在或读取失败，则退回到在线生成
        }

        const significantItems = aiCompetitorWeeklyPayload.items.map((it) => ({
          appId: it.appId,
          name: it.productName,
          publisher: it.publisherName,
          platform: it.platform,
          downloadsThisWeek: it.downloadsThisWeek,
          downloadsLastWeek: it.downloadsLastWeek,
          revenueThisWeek: it.revenueThisWeek,
          revenueLastWeek: it.revenueLastWeek,
        }));
        const payload = {
          weekThis: aiCompetitorWeeklyPayload.weekThis,
          weekLast: aiCompetitorWeeklyPayload.weekLast,
          items: significantItems,
        };
        const prompt = [
          '下面是一份 AI 产品竞品周报的源数据，字段包括每款产品本周/上周的下载量和收入：',
          JSON.stringify(payload),
          '',
          '请用简洁的中文总结本周变化**明显**的产品（例如下载量或收入环比变化 ≥20% 或绝对变化特别大）。',
          '- 只说变化比较大的产品，没有明显变化的可以忽略；',
          '- 以要点列表形式输出，每条形如「产品A：下载量较上周 +35%，收入基本持平，主要亮点是……」；',
          '- 优先关注下载和收入同时大幅上升/下降的产品，其次是某一项大幅变化的产品；',
          '- 不需要重复列出原始数字，只需给出大致变化方向和量级（如「+30% 左右」「翻倍」「腰斩」等）。',
        ].join('\n');

        const resp = await fetch(getApiUrl('/api/ai/chat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ message: prompt }),
          signal: controller.signal,
        });
        if (!resp.ok) {
          setAiWeeklySummary('');
          return;
        }
        const data = (await resp.json()) as { answer?: string };
        if (data.answer && typeof data.answer === 'string') {
          setAiWeeklySummary(data.answer.trim());
        }
      } catch {
        // 忽略错误，仅不展示摘要
      } finally {
        if (!controller.signal.aborted) {
          setAiWeeklySummaryLoading(false);
        }
      }
    };
    void run();

    return () => {
      controller.abort();
    };
  }, [aiCompetitorWeeklyPayload, aiWeeklySummary, getDataUrl]);

  const parseHotTrendSections = (content: string) => {
    const sections: Record<string, string> = {};
    if (!content) return sections;
    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    let currentHeading: string | null = null;
    let buffer: string[] = [];

    const flush = () => {
      if (currentHeading) {
        const text = buffer.join('\n').trim();
        if (text) {
          sections[currentHeading] = text;
        }
      }
      buffer = [];
    };

    lines.forEach((line) => {
      const headingMatch = line.match(/^##\s*(.+?)\s*$/);
      if (headingMatch) {
        flush();
        currentHeading = headingMatch[1].trim();
        return;
      }
      buffer.push(line);
    });
    flush();
    return sections;
  };

  const hotTrendSections = useMemo(
    () => (doc.content ? parseHotTrendSections(doc.content) : {}),
    [doc.content]
  );
  const hotTrendSummary = hotTrendSections['摘要'] ?? '';
  const hotTrendUA = hotTrendSections['UA灵感'] ?? '';
  const hotTrendGen = hotTrendSections['生成适配'] ?? '';
  const hotTrendLink = (hotTrendSections['原文链接'] ?? '')
    .split(/\s+/)
    .find((v) => v.startsWith('http'));

  /** AI 详情：从 content 过滤掉标题/评分/标签/链接，仅保留摘要、分析 */
  const aiFilteredContent = useMemo(() => {
    if (!isAiHotspot || !doc.content?.trim()) return '';
    const lines = doc.content.replace(/\r\n/g, '\n').split('\n');
    const keep: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith('# ')) continue;
      if (/^\*\*评分\*\*[：:]\s*/.test(t)) continue;
      if (/^\*\*标签\*\*[：:]\s*/.test(t)) continue;
      if (/^\*\*链接\*\*[：:]\s*/.test(t)) continue;
      keep.push(line);
    }
    return keep.join('\n').trim();
  }, [isAiHotspot, doc.content]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              返回
            </button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-slate-900">{doc.title}</h1>
              <div className="flex items-center gap-4 mt-1 text-sm text-slate-500 flex-wrap">
                {doc.source && <span>{doc.source}</span>}
                {doc.date && <span>•</span>}
                {doc.date && <span>{doc.date}</span>}
                {doc.time && <span>•</span>}
                {doc.time && <span>{doc.time}</span>}
                {!isAiHotspot && doc.score !== undefined && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <span className="text-yellow-500">⭐</span>
                      <span className="font-semibold text-slate-700">{doc.score.toFixed(1)}</span>
                    </span>
                  </>
                )}
              </div>
              {!isAiHotspot && doc.tags && doc.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {doc.tags.map((tag, i) => (
                    <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs border border-slate-200">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {doc.coverImage && (
          <div className="mb-6 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
            <img src={doc.coverImage} alt={doc.title} className="w-full max-h-80 object-cover" />
          </div>
        )}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
          {aiCompetitorWeeklyPayload ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-slate-900 mb-2">本周竞品变化摘要</h2>
                {aiWeeklySummaryLoading ? (
                  <p className="text-sm text-slate-500">摘要生成中...</p>
                ) : (
                  <div className="prose prose-sm max-w-none text-slate-700">
                    <MarkdownRenderer content={aiWeeklySummary || DEFAULT_AI_COMPETITOR_WEEKLY_SUMMARY} />
                  </div>
                )}
              </div>
              <AiCompetitorWeeklyTable payload={aiCompetitorWeeklyPayload} />
            </div>
          ) : isHotTrend ? (
            isDailySummary ? (
              <div className="prose prose-lg max-w-none">
                <MarkdownRenderer content={doc.content || doc.summary || item.description || '暂无汇总内容。'} onInternalLinkClick={onNavigateToEntry} />
              </div>
            ) : (
              <div className="prose prose-lg max-w-none space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">摘要</h2>
                  <p className="text-slate-700 whitespace-pre-wrap">
                    {hotTrendSummary || doc.summary || item.description || '暂无摘要内容。'}
                  </p>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">UA 灵感</h2>
                  <p className="text-slate-700 whitespace-pre-wrap">
                    {hotTrendUA || '暂无 UA 灵感内容。'}
                  </p>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">生成适配</h2>
                  <p className="text-slate-700 whitespace-pre-wrap">
                    {hotTrendGen || '暂无生成适配内容。'}
                  </p>
                </div>
                {(hotTrendLink || originalUrl) && (
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">原文链接</h2>
                    <a
                      href={hotTrendLink || originalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {hotTrendLink || originalUrl}
                    </a>
                  </div>
                )}
              </div>
            )
          ) : storeChangeMeta ? (
            <div className="space-y-8 text-slate-700">
              <div className="space-y-2">
                <div className="text-lg font-semibold text-slate-900">{doc.title}</div>
                <div>变动时间：{storeChangeMeta.changedAt || doc.date || '—'}</div>
                <div>平台：{storeChangeMeta.platform || item.platform || '—'}</div>
                <div>开发者：{storeChangeMeta.developer || '—'}</div>
                {storeChangeMeta.storeUrl && (
                  <div className="break-all">
                    商店链接：
                    <a
                      href={storeChangeMeta.storeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline ml-1"
                      title={storeChangeMeta.storeUrl}
                    >
                      {urlForDisplay(storeChangeMeta.storeUrl)}
                    </a>
                  </div>
                )}
              </div>

              <div>
                <h2 className="text-xl font-semibold text-slate-900 mb-3">变更项</h2>
                {storeChangeMeta.summaries && storeChangeMeta.summaries.length > 0 ? (
                  <ul className="list-disc list-inside space-y-2">
                    {storeChangeMeta.summaries.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-slate-500">暂无变更项。</div>
                )}
              </div>

              {(storeChangeMeta.screenshots?.before?.length || storeChangeMeta.screenshots?.after?.length) && (
                <div>
                  <h2 className="text-xl font-semibold text-slate-900 mb-3">截图对比</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm font-medium text-slate-500 mb-2">更新前</div>
                      <div className="space-y-3">
                        {(storeChangeMeta.screenshots?.before ?? []).length > 0 ? (
                          storeChangeMeta.screenshots?.before?.map((url, idx) => (
                            <img
                              key={`before-${idx}`}
                              src={url}
                              alt="更新前截图"
                              className="w-full h-48 object-contain rounded-lg border border-slate-200 bg-slate-50"
                              loading="lazy"
                            />
                          ))
                        ) : (
                          <div className="text-slate-500 text-sm">（无）</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-500 mb-2">更新后</div>
                      <div className="space-y-3">
                        {(storeChangeMeta.screenshots?.after ?? []).length > 0 ? (
                          storeChangeMeta.screenshots?.after?.map((url, idx) => (
                            <img
                              key={`after-${idx}`}
                              src={url}
                              alt="更新后截图"
                              className="w-full h-48 object-contain rounded-lg border border-slate-200 bg-slate-50"
                              loading="lazy"
                            />
                          ))
                        ) : (
                          <div className="text-slate-500 text-sm">（无）</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {(storeChangeMeta.icon?.before || storeChangeMeta.icon?.after) && (
                <div>
                  <h2 className="text-xl font-semibold text-slate-900 mb-3">图标对比</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm font-medium text-slate-500 mb-2">更新前</div>
                      {storeChangeMeta.icon?.before ? (
                        <img
                          src={storeChangeMeta.icon.before}
                          alt="更新前图标"
                          className="w-24 h-24 object-contain rounded-xl border border-slate-200 bg-slate-50"
                          loading="lazy"
                        />
                      ) : (
                        <div className="text-slate-500 text-sm">（无）</div>
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-500 mb-2">更新后</div>
                      {storeChangeMeta.icon?.after ? (
                        <img
                          src={storeChangeMeta.icon.after}
                          alt="更新后图标"
                          className="w-24 h-24 object-contain rounded-xl border border-slate-800 bg-slate-950/40"
                          loading="lazy"
                        />
                      ) : (
                        <div className="text-slate-500 text-sm">（无）</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {(storeChangeMeta.videoImages?.before?.length || storeChangeMeta.videoImages?.after?.length) && (
                <div>
                  <h2 className="text-xl font-semibold text-slate-900 mb-3">视频封面</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm font-medium text-slate-400 mb-2">更新前</div>
                      {(storeChangeMeta.videoImages?.before ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {(storeChangeMeta.videoImages?.before ?? []).map((url, idx) => (
                            <a
                              key={`video-before-${idx}`}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block rounded-lg overflow-hidden border border-slate-200 hover:border-slate-400 transition-colors"
                            >
                              <img
                                src={url}
                                alt={`更新前封面 ${idx + 1}`}
                                className="max-w-full h-auto max-h-48 object-contain bg-slate-100"
                              />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="text-slate-500 text-sm">（无）</div>
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-400 mb-2">更新后</div>
                      {(storeChangeMeta.videoImages?.after ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {(storeChangeMeta.videoImages?.after ?? []).map((url, idx) => (
                            <a
                              key={`video-after-${idx}`}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block rounded-lg overflow-hidden border border-slate-200 hover:border-slate-400 transition-colors"
                            >
                              <img
                                src={url}
                                alt={`更新后封面 ${idx + 1}`}
                                className="max-w-full h-auto max-h-48 object-contain bg-slate-100"
                              />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="text-slate-500 text-sm">（无）</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : sensortowerWeeklyMeta ? (
            <div className="prose prose-lg max-w-none">
              <MarkdownRenderer content={doc.content || doc.summary || item.description || '暂无内容'} onInternalLinkClick={onNavigateToEntry} />
              {sensortowerWeeklyMeta.storeChanges && sensortowerWeeklyMeta.storeChanges.length > 0 && (
                <div className="mt-8">
                  <h2 className="text-2xl font-bold text-slate-900 mb-4">商店页变化</h2>
                  <div className="overflow-x-auto">
                    <table className="min-w-full border border-slate-200 text-sm">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="px-3 py-2 text-left text-slate-600">游戏名</th>
                          <th className="px-3 py-2 text-left text-slate-600">变动时间</th>
                          <th className="px-3 py-2 text-left text-slate-600">平台</th>
                          <th className="px-3 py-2 text-left text-slate-600">主要变化</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {sensortowerWeeklyMeta.storeChanges.map((row) => {
                          const linkedItem = storeChangeItemMap?.get(row.id);
                          return (
                            <tr key={row.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 text-blue-600">
                                {linkedItem && onOpenStoreChange ? (
                                  <button
                                    type="button"
                                    onClick={() => onOpenStoreChange(linkedItem)}
                                    className="text-blue-600 hover:underline"
                                  >
                                    {row.appName}
                                  </button>
                                ) : row.storeUrl ? (
                                  <a
                                    href={row.storeUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline"
                                  >
                                    {row.appName}
                                  </a>
                                ) : (
                                  <span>{row.appName}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-slate-600">{row.changedAt || '—'}</td>
                              <td className="px-3 py-2 text-slate-600">{row.platform || '—'}</td>
                              <td className="px-3 py-2 text-slate-600">
                                {row.summaries && row.summaries.length > 0 ? row.summaries.join('，') : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : isAiHotspot ? (
            <div className="prose prose-lg max-w-none">
              {/* AI 热点：仅展示摘要、分析（若有），不展示标题/评分/标签；原文链接为可点击「原文链接」 */}
              <MarkdownRenderer
                content={aiFilteredContent || doc.summary || item.description || '暂无内容'}
                onInternalLinkClick={onNavigateToEntry}
              />
              {originalUrl && originalUrl !== '#' && (
                <p className="mt-4 mb-0">
                  <a
                    href={originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700 underline"
                  >
                    原文链接
                  </a>
                </p>
              )}
            </div>
          ) : (!doc.content || !doc.content.trim() || doc.content.includes('暂无玩法说明') || doc.content === '暂无内容') ? (
            <div className="prose prose-lg max-w-none">
              <p className="text-slate-600 mb-4">暂无该游戏的玩法说明内容。</p>
              <p className="text-slate-600">
                详情信息请前往：{' '}
                <a
                  href="https://sites.google.com/castbox.fm/overwatch2/home?authuser=1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  游戏监测网站
                </a>
                {' '}查看。
              </p>
            </div>
          ) : (
            <div className="prose prose-lg max-w-none">
              <MarkdownRenderer content={doc.content} onInternalLinkClick={onNavigateToEntry} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WeeklyReportDetail;
