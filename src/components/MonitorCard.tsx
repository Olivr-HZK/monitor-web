import { useMemo, useState } from 'react';
import type { MonitorItem } from '../types';
import MarkdownRenderer from './MarkdownRenderer';

interface MonitorCardProps {
  item: MonitorItem;
  onClick?: (item: MonitorItem) => void;
}

/** 从 reportContent JSON 中取出 content 和 meta.url */
function getContentFromReportContent(
  reportContent: string | undefined
): { content: string; linkUrl: string } {
  if (!reportContent?.trim()) return { content: '', linkUrl: '' };
  const raw = reportContent.trim();
  if (!raw.startsWith('{')) return { content: raw, linkUrl: '' };
  try {
    const data = JSON.parse(raw) as { content?: string; meta?: { url?: string } };
    const content = typeof data.content === 'string' ? data.content : '';
    const linkUrl = (data.meta?.url ?? '').trim();
    return { content, linkUrl };
  } catch {
    return { content: raw, linkUrl: '' };
  }
}

/** 从 content 中提取摘要、分析，过滤掉标题/评分/标签/链接行 */
function buildAiCardContent(content: string): string {
  if (!content.trim()) return '';
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const keep: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('# ')) continue; // 标题
    if (/^\*\*评分\*\*[：:]\s*/.test(t)) continue;
    if (/^\*\*标签\*\*[：:]\s*/.test(t)) continue;
    if (/^\*\*链接\*\*[：:]\s*/.test(t)) continue; // 链接单独做成可点击
    keep.push(line);
  }
  return keep.join('\n').trim();
}

const MonitorCard = ({ item, onClick }: MonitorCardProps) => {
  const [coverFailed, setCoverFailed] = useState(false);
  const isAiHotspot = item.type === 'ai热点监测';
  const showCover = item.coverImage && !coverFailed;
  const { cardContent, linkUrl } = useMemo(() => {
    if (!isAiHotspot) return { cardContent: '', linkUrl: '' };
    const { content, linkUrl: url } = getContentFromReportContent(item.reportContent);
    return { cardContent: buildAiCardContent(content), linkUrl: url || item.url || '' };
  }, [isAiHotspot, item.reportContent, item.url]);
  const getTypeMark = (type: string) => {
    switch (type) {
      case 'ai热点监测':
        return 'AI';
      case '热点趋势监测':
        return 'TR';
      case '竞品社媒监控':
        return 'SM';
      case '休闲游戏监测':
        return 'GM';
      default:
        return 'MN';
    }
  };

  const getTrendIcon = (trend?: string) => {
    switch (trend) {
      case 'up':
        return (
          <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        );
      case 'down':
        return (
          <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getSentimentColor = (sentiment?: string) => {
    switch (sentiment) {
      case 'positive':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'negative':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return 'bg-surface text-inkLight border-line';
    }
  };

  const handleClick = () => {
    if (onClick) {
      onClick(item);
    }
  };

  const scoreValue = typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : null;

  return (
    <div 
      className="group flex cursor-pointer gap-4 border-b border-line px-2 py-5 transition-colors hover:bg-surfaceHover/70 sm:gap-5 sm:px-4"
      onClick={handleClick}
    >
      {/* Cover/Type Indicator */}
      <div className="flex-shrink-0 relative">
        {showCover ? (
          <div className="relative h-24 w-24 overflow-hidden rounded-xl border border-line bg-surface sm:h-28 sm:w-28">
            <img
              src={item.coverImage}
              alt={item.title}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={() => setCoverFailed(true)}
            />
            <div className="absolute bottom-2 left-2 rounded-md bg-white/90 px-1.5 py-0.5 backdrop-blur">
              <div className="text-[10px] font-medium text-ink">{getTypeMark(item.type)}</div>
            </div>
            {item.trend && (
              <div className="absolute top-2 right-2 rounded-full bg-white/90 p-1">
                {getTrendIcon(item.trend)}
              </div>
            )}
          </div>
        ) : (
          <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface sm:h-28 sm:w-28">
            <div className="flex flex-col items-center justify-center p-2 text-center">
              <div className="text-lg font-semibold text-ink">{getTypeMark(item.type)}</div>
              <div className="mt-1 max-w-20 text-[10px] leading-tight text-muted">{item.type}</div>
            </div>
            {item.trend && (
              <div className="absolute top-2 right-2">
                {getTrendIcon(item.trend)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content：min-w-0 + overflow-hidden 防止长链接/长文案撑出卡片 */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {/* Title */}
        <h3 className="mb-2 line-clamp-2 break-words text-base font-semibold leading-6 text-ink transition-colors group-hover:text-accent sm:text-lg">
          {item.title}
        </h3>

        {/* Source and Metadata */}
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 break-all text-xs text-muted sm:text-sm">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span>{item.source}</span>
          </div>
          <span className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-inkLight">
            {item.platform}
          </span>
          <span>{item.date}</span>
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{item.time}</span>
          </div>
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span>{item.views.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span>{item.engagement}</span>
          </div>
          {/* 非 AI 日报：保持原有评分展示；AI 日报：不展示评分 */}
          {!isAiHotspot && scoreValue !== null && (
            <div className="flex items-center gap-1">
              <span className="text-yellow-500">⭐</span>
              <span className="font-medium text-inkLight">{scoreValue.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Description：AI 日报卡片仅展示摘要+分析，以及可点击的「原文链接」；其他类型展示 description */}
        <div className="mb-3 space-y-1 overflow-hidden min-w-0">
          {isAiHotspot ? (
            <div className="max-h-40 overflow-hidden break-all text-[13px] leading-6 text-inkLight [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:mb-1 [&_p]:last:mb-0 [&_strong]:text-ink">
              <MarkdownRenderer content={cardContent || item.description || '暂无内容'} />
              {linkUrl && linkUrl !== '#' && (
                <p className="mt-2 mb-0 truncate" title={linkUrl}>
                  <a
                    href={linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-accent hover:text-blue-700 underline"
                  >
                    原文链接
                  </a>
                </p>
              )}
            </div>
          ) : (
            <p className="line-clamp-2 min-w-0 overflow-hidden break-all text-sm leading-6 text-inkLight" title={item.description}>
              {item.description}
            </p>
          )}
        </div>

        {/* Tags and Sentiment */}
        <div className="flex flex-wrap items-center gap-2 overflow-hidden min-w-0">
          {!isAiHotspot && item.sentiment && (
            <span className={`rounded-md border px-2 py-0.5 text-xs ${getSentimentColor(item.sentiment)}`}>
              {item.sentiment === 'positive' && '正面'}
              {item.sentiment === 'negative' && '负面'}
              {item.sentiment === 'neutral' && '中性'}
            </span>
          )}
          {item.tags.map((tag, index) => (
            <span
              key={index}
              className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-inkLight"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MonitorCard;
