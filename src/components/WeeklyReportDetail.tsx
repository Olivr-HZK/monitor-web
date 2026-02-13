/**
 * 日报/周报详情页组件
 * 统一使用 ReportDocument 格式：标题、标签、时间、来源、摘要来自文档，正文仅渲染 content
 */

import { useMemo } from 'react';
import type { MonitorItem, ReportDocument } from '../types';
import { toReportDocument } from '../utils/reportDocument';
import MarkdownRenderer from './MarkdownRenderer';

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
          {isHotTrend ? (
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
                  <div>
                    商店链接：
                    <a
                      href={storeChangeMeta.storeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline ml-1"
                    >
                      {storeChangeMeta.storeUrl}
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
                  <h2 className="text-xl font-semibold text-slate-900 mb-3">视频/视频图对比</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm font-medium text-slate-400 mb-2">更新前</div>
                      <div className="space-y-3">
                        {(storeChangeMeta.videoImages?.before ?? []).length > 0 ? (
                          storeChangeMeta.videoImages?.before?.map((url, idx) => (
                            <img
                              key={`video-before-${idx}`}
                              src={url}
                              alt="更新前视频图"
                              className="w-full h-48 object-contain rounded-lg border border-slate-800 bg-slate-950/40"
                              loading="lazy"
                            />
                          ))
                        ) : (
                          <div className="text-slate-500 text-sm">（无）</div>
                        )}
                      </div>
                      {(storeChangeMeta.videoImages?.before ?? []).length > 0 && (
                        <div className="mt-3 space-y-1 text-sm text-slate-300 break-all">
                          {(storeChangeMeta.videoImages?.before ?? []).map((url, idx) => (
                            <div key={`video-before-url-${idx}`}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {url}
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-400 mb-2">更新后</div>
                      <div className="space-y-3">
                        {(storeChangeMeta.videoImages?.after ?? []).length > 0 ? (
                          storeChangeMeta.videoImages?.after?.map((url, idx) => (
                            <img
                              key={`video-after-${idx}`}
                              src={url}
                              alt="更新后视频图"
                              className="w-full h-48 object-contain rounded-lg border border-slate-800 bg-slate-950/40"
                              loading="lazy"
                            />
                          ))
                        ) : (
                          <div className="text-slate-500 text-sm">（无）</div>
                        )}
                      </div>
                      {(storeChangeMeta.videoImages?.after ?? []).length > 0 && (
                        <div className="mt-3 space-y-1 text-sm text-slate-300 break-all">
                          {(storeChangeMeta.videoImages?.after ?? []).map((url, idx) => (
                            <div key={`video-after-url-${idx}`}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {url}
                              </a>
                            </div>
                          ))}
                        </div>
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
