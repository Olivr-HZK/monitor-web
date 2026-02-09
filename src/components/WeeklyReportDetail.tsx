/**
 * 日报/周报详情页组件
 * 统一使用 ReportDocument 格式：标题、标签、时间、来源、摘要来自文档，正文仅渲染 content
 */

import React, { useMemo } from 'react';
import type { MonitorItem, ReportDocument } from '../types';
import { toReportDocument } from '../utils/reportDocument';

interface WeeklyReportDetailProps {
  item: MonitorItem;
  onBack: () => void;
  storeChangeItemMap?: Map<string, MonitorItem>;
  onOpenStoreChange?: (item: MonitorItem) => void;
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

const WeeklyReportDetail = ({ item, onBack, storeChangeItemMap, onOpenStoreChange }: WeeklyReportDetailProps) => {
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

  const extractSection = (content: string, heading: string) => {
    const pattern = new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'm');
    const match = content.match(pattern);
    return match ? match[1].trim() : '';
  };

  const hotTrendSummary = doc.content ? extractSection(doc.content, '摘要') : '';
  const hotTrendUA = doc.content ? extractSection(doc.content, 'UA灵感') : '';
  const hotTrendGen = doc.content ? extractSection(doc.content, '生成适配') : '';
  const hotTrendLink =
    doc.content ? extractSection(doc.content, '原文链接').split(/\s+/).find((v) => v.startsWith('http')) : undefined;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-200 bg-slate-900 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              返回
            </button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-white">{doc.title}</h1>
              <div className="flex items-center gap-4 mt-1 text-sm text-slate-400 flex-wrap">
                {doc.source && <span>{doc.source}</span>}
                {doc.date && <span>•</span>}
                {doc.date && <span>{doc.date}</span>}
                {doc.time && <span>•</span>}
                {doc.time && <span>{doc.time}</span>}
                {doc.score !== undefined && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <span className="text-yellow-500">⭐</span>
                      <span className="font-semibold text-slate-100">{doc.score.toFixed(1)}</span>
                    </span>
                  </>
                )}
              </div>
              {doc.tags && doc.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {doc.tags.map((tag, i) => (
                    <span key={i} className="px-2 py-0.5 bg-slate-800 text-slate-200 rounded text-xs border border-slate-700">
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
          <div className="mb-6 rounded-xl overflow-hidden border border-slate-800 shadow-sm">
            <img src={doc.coverImage} alt={doc.title} className="w-full max-h-80 object-cover" />
          </div>
        )}
        <div className="bg-slate-900/70 rounded-xl border border-slate-800 shadow-sm p-8">
          {isHotTrend ? (
            isDailySummary ? (
              <div className="prose prose-invert prose-lg max-w-none">
                <MarkdownRenderer content={doc.content || doc.summary || item.description || '暂无汇总内容。'} />
              </div>
            ) : (
              <div className="prose prose-invert prose-lg max-w-none space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-white">摘要</h2>
                  <p className="text-slate-200 whitespace-pre-wrap">
                    {hotTrendSummary || doc.summary || item.description || '暂无摘要内容。'}
                  </p>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">UA 灵感</h2>
                  <p className="text-slate-200 whitespace-pre-wrap">
                    {hotTrendUA || '暂无 UA 灵感内容。'}
                  </p>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">生成适配</h2>
                  <p className="text-slate-200 whitespace-pre-wrap">
                    {hotTrendGen || '暂无生成适配内容。'}
                  </p>
                </div>
                {(hotTrendLink || originalUrl) && (
                  <div>
                    <h2 className="text-xl font-semibold text-white">原文链接</h2>
                    <a
                      href={hotTrendLink || originalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-300 hover:underline"
                    >
                      {hotTrendLink || originalUrl}
                    </a>
                  </div>
                )}
              </div>
            )
          ) : storeChangeMeta ? (
            <div className="space-y-8 text-slate-200">
              <div className="space-y-2">
                <div className="text-lg font-semibold text-white">{doc.title}</div>
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
                      className="text-cyan-300 hover:underline ml-1"
                    >
                      {storeChangeMeta.storeUrl}
                    </a>
                  </div>
                )}
              </div>

              <div>
                <h2 className="text-xl font-semibold text-white mb-3">变更项</h2>
                {storeChangeMeta.summaries && storeChangeMeta.summaries.length > 0 ? (
                  <ul className="list-disc list-inside space-y-2">
                    {storeChangeMeta.summaries.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-slate-400">暂无变更项。</div>
                )}
              </div>

              {(storeChangeMeta.screenshots?.before?.length || storeChangeMeta.screenshots?.after?.length) && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-3">截图对比</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm font-medium text-slate-400 mb-2">更新前</div>
                      <div className="space-y-3">
                        {(storeChangeMeta.screenshots?.before ?? []).length > 0 ? (
                          storeChangeMeta.screenshots?.before?.map((url, idx) => (
                            <img
                              key={`before-${idx}`}
                              src={url}
                              alt="更新前截图"
                              className="w-full h-48 object-contain rounded-lg border border-slate-800 bg-slate-950/40"
                              loading="lazy"
                            />
                          ))
                        ) : (
                          <div className="text-slate-500 text-sm">（无）</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-400 mb-2">更新后</div>
                      <div className="space-y-3">
                        {(storeChangeMeta.screenshots?.after ?? []).length > 0 ? (
                          storeChangeMeta.screenshots?.after?.map((url, idx) => (
                            <img
                              key={`after-${idx}`}
                              src={url}
                              alt="更新后截图"
                              className="w-full h-48 object-contain rounded-lg border border-slate-800 bg-slate-950/40"
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
                  <h2 className="text-xl font-semibold text-white mb-3">图标对比</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm font-medium text-slate-400 mb-2">更新前</div>
                      {storeChangeMeta.icon?.before ? (
                        <img
                          src={storeChangeMeta.icon.before}
                          alt="更新前图标"
                          className="w-24 h-24 object-contain rounded-xl border border-slate-800 bg-slate-950/40"
                          loading="lazy"
                        />
                      ) : (
                        <div className="text-slate-500 text-sm">（无）</div>
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-400 mb-2">更新后</div>
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
                  <h2 className="text-xl font-semibold text-white mb-3">视频/视频图对比</h2>
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
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : sensortowerWeeklyMeta ? (
            <div className="prose prose-invert prose-lg max-w-none">
              <MarkdownRenderer content={doc.content || doc.summary || item.description || '暂无内容'} />
              {sensortowerWeeklyMeta.storeChanges && sensortowerWeeklyMeta.storeChanges.length > 0 && (
                <div className="mt-8">
                  <h2 className="text-2xl font-bold text-white mb-4">商店页变化</h2>
                  <div className="overflow-x-auto">
                    <table className="min-w-full border border-slate-800 text-sm">
                      <thead>
                        <tr className="bg-slate-900/80">
                          <th className="px-3 py-2 text-left text-slate-400">游戏名</th>
                          <th className="px-3 py-2 text-left text-slate-400">变动时间</th>
                          <th className="px-3 py-2 text-left text-slate-400">平台</th>
                          <th className="px-3 py-2 text-left text-slate-400">主要变化</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {sensortowerWeeklyMeta.storeChanges.map((row) => {
                          const linkedItem = storeChangeItemMap?.get(row.id);
                          return (
                            <tr key={row.id} className="hover:bg-slate-900/60">
                              <td className="px-3 py-2 text-cyan-300">
                                {linkedItem && onOpenStoreChange ? (
                                  <button
                                    type="button"
                                    onClick={() => onOpenStoreChange(linkedItem)}
                                    className="text-cyan-300 hover:underline"
                                  >
                                    {row.appName}
                                  </button>
                                ) : row.storeUrl ? (
                                  <a
                                    href={row.storeUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-cyan-300 hover:underline"
                                  >
                                    {row.appName}
                                  </a>
                                ) : (
                                  <span>{row.appName}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-slate-300">{row.changedAt || '—'}</td>
                              <td className="px-3 py-2 text-slate-300">{row.platform || '—'}</td>
                              <td className="px-3 py-2 text-slate-300">
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
            <div className="prose prose-invert prose-lg max-w-none">
              <MarkdownRenderer content={doc.content || doc.summary || item.description || '暂无内容'} />
              {originalUrl && originalUrl !== '#' && (
                <p className="mt-4">
                  <a
                    href={originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-300 hover:underline"
                  >
                    原文链接
                  </a>
                </p>
              )}
            </div>
          ) : (!doc.content || !doc.content.trim() || doc.content.includes('暂无玩法说明') || doc.content === '暂无内容') ? (
            <div className="prose prose-invert prose-lg max-w-none">
              <p className="text-slate-300 mb-4">暂无该游戏的玩法说明内容。</p>
              <p className="text-slate-300">
                详情信息请前往：{' '}
                <a
                  href="https://olivr-hzk.github.io/monitor-web/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-300 hover:underline"
                >
                  https://olivr-hzk.github.io/monitor-web/
                </a>
                {' '}查看。
              </p>
            </div>
          ) : (
            <div className="prose prose-invert prose-lg max-w-none">
              <MarkdownRenderer content={doc.content} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Markdown 渲染器组件
 * 简单的 Markdown 渲染，支持基本的格式
 */
const MarkdownRenderer = ({ content }: { content: string }) => {
  const lines = content.split('\n');
  const elements: React.JSX.Element[] = [];
  let currentParagraph: string[] = [];
  let listItems: string[] = [];
  let inList = false;

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const text = currentParagraph.join(' ');
      if (text.trim()) {
        elements.push(
          <p key={elements.length} className="mb-4 text-slate-200 leading-relaxed">
            {renderInlineMarkdown(text)}
          </p>
        );
      }
      currentParagraph = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={elements.length} className="mb-4 list-disc list-inside space-y-2 text-slate-200">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  const isTableRow = (s: string) => /^\|.+\|$/.test(s);
  const parseTableRow = (s: string) => s.split('|').slice(1, -1).map((c) => c.trim());

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    // 空行
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    // 图片：单行 Markdown 图片 ![alt](url)
    const imageMatch = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    if (imageMatch) {
      flushParagraph();
      flushList();
      elements.push(
        <div key={`img-${index}`} className="mb-4">
          <img
            src={imageMatch[1]}
            alt="截图"
            className="w-full max-h-96 object-contain rounded-lg border border-slate-800 bg-slate-950/40"
            loading="lazy"
          />
        </div>
      );
      continue;
    }

    // 标题
    if (trimmed.startsWith('# ')) {
      flushParagraph();
      flushList();
      elements.push(
        <h1 key={index} className="text-3xl font-bold mb-4 mt-6 text-white">
          {trimmed.substring(2)}
        </h1>
      );
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushParagraph();
      flushList();
      elements.push(
        <h2 key={index} className="text-2xl font-bold mb-3 mt-5 text-white">
          {trimmed.substring(3)}
        </h2>
      );
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushParagraph();
      flushList();
      elements.push(
        <h3 key={index} className="text-xl font-bold mb-2 mt-4 text-white">
          {trimmed.substring(4)}
        </h3>
      );
      continue;
    }

    // 分隔线
    if (trimmed === '---' || trimmed.startsWith('---')) {
      flushParagraph();
      flushList();
      elements.push(<hr key={index} className="my-6 border-slate-700" />);
      continue;
    }

    // 表格：连续 |...| 行
    if (isTableRow(trimmed)) {
      flushParagraph();
      flushList();
      const tableRows: string[] = [trimmed];
      while (index + 1 < lines.length && isTableRow(lines[index + 1].trim())) {
        index++;
        tableRows.push(lines[index].trim());
      }
      const isSeparator = (cells: string[]) => cells.every((c) => /^[-:]+$/.test(c));
      const headerCells = parseTableRow(tableRows[0]);
      const bodyRows = tableRows.slice(1).filter((row) => !isSeparator(parseTableRow(row)));
      elements.push(
        <div key={index} className="mb-6 overflow-x-auto">
          <table className="min-w-full border border-slate-800 text-sm">
            <thead>
              <tr className="bg-slate-900">
                {headerCells.map((cell, i) => (
                  <th key={i} className="border border-slate-800 px-3 py-2 text-left font-semibold text-slate-200">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-slate-950/60' : 'bg-slate-900/60'}>
                  {parseTableRow(row).map((cell, ci) => (
                    <td key={ci} className="border border-slate-800 px-3 py-2 text-slate-200">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 列表项：无序列表（• - *）或有序列表（1. 2. 等）
    const unorderedListMatch = trimmed.match(/^[•\-\*]\s+(.+)$/);
    const orderedListMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (unorderedListMatch || orderedListMatch) {
      flushParagraph();
      if (!inList) {
        inList = true;
      }
      const content = unorderedListMatch ? unorderedListMatch[1] : orderedListMatch![1];
      listItems.push(content);
      continue;
    }

    // 普通段落
    flushList();
    currentParagraph.push(line);
  }

  flushParagraph();
  flushList();

  return <div>{elements}</div>;
};

/**
 * 渲染行内 Markdown
 */
function renderInlineMarkdown(text: string): React.JSX.Element[] {
  const parts: (string | React.JSX.Element)[] = [];
  let currentIndex = 0;

  // 处理粗体 **text**
  const boldRegex = /\*\*(.*?)\*\*/g;
  let match;
  let lastIndex = 0;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    parts.push(
      <strong key={currentIndex++} className="font-semibold text-white">
        {match[1]}
      </strong>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  // 处理链接 [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const finalParts: (string | React.JSX.Element)[] = [];
  let linkLastIndex = 0;

  parts.forEach((part, partIndex) => {
    if (typeof part === 'string') {
      while ((match = linkRegex.exec(part)) !== null) {
        if (match.index > linkLastIndex) {
          finalParts.push(part.substring(linkLastIndex, match.index));
        }
        finalParts.push(
          <a
            key={`link-${partIndex}-${currentIndex++}`}
            href={match[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-300 hover:text-cyan-200 underline"
          >
            {match[1]}
          </a>
        );
        linkLastIndex = match.index + match[0].length;
      }
      if (linkLastIndex < part.length) {
        finalParts.push(part.substring(linkLastIndex));
      }
      linkLastIndex = 0;
    } else {
      finalParts.push(part);
    }
  });

  // 处理裸链接（https://...）
  const urlRegex = /(https?:\/\/[^\s)]+)/g;
  const withUrls: (string | React.JSX.Element)[] = [];

  finalParts.forEach((part, partIndex) => {
    if (typeof part === 'string') {
      let lastUrlIndex = 0;
      let urlMatch: RegExpExecArray | null;
      while ((urlMatch = urlRegex.exec(part)) !== null) {
        if (urlMatch.index > lastUrlIndex) {
          withUrls.push(part.substring(lastUrlIndex, urlMatch.index));
        }
        const url = urlMatch[1];
        withUrls.push(
          <a
            key={`url-${partIndex}-${currentIndex++}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-300 hover:text-cyan-200 underline"
          >
            {url}
          </a>
        );
        lastUrlIndex = urlMatch.index + urlMatch[0].length;
      }
      if (lastUrlIndex < part.length) {
        withUrls.push(part.substring(lastUrlIndex));
      }
    } else {
      withUrls.push(part);
    }
  });

  return withUrls.length > 0 ? (withUrls as React.JSX.Element[]) : [<span key="empty">{text}</span>];
}

export default WeeklyReportDetail;
