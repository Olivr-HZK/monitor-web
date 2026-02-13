import { useMemo } from 'react';
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
  const isAiHotspot = item.type === 'ai热点监测';
  const { cardContent, linkUrl } = useMemo(() => {
    if (!isAiHotspot) return { cardContent: '', linkUrl: '' };
    const { content, linkUrl: url } = getContentFromReportContent(item.reportContent);
    return { cardContent: buildAiCardContent(content), linkUrl: url || item.url || '' };
  }, [isAiHotspot, item.reportContent, item.url]);
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'ai热点监测':
        return 'from-blue-400 to-blue-600';
      case '热点趋势监测':
        return 'from-purple-400 to-purple-600';
      case '竞品社媒监控':
        return 'from-orange-400 to-orange-600';
      case '休闲游戏监测':
        return 'from-green-400 to-green-600';
      default:
        return 'from-slate-400 to-slate-600';
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
        return 'bg-slate-100 text-slate-700 border-slate-200';
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
      className="flex gap-6 py-6 border-b border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
      onClick={handleClick}
    >
      {/* Cover/Type Indicator */}
      <div className="flex-shrink-0 relative">
        {item.coverImage ? (
          <div className="w-32 h-32 rounded-xl overflow-hidden relative border border-slate-200">
            <img 
              src={item.coverImage} 
              alt={item.title}
              className="w-full h-full object-cover"
            />
            <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2`}>
              <div className="text-xs font-bold text-white">{item.type}</div>
            </div>
            {item.trend && (
              <div className="absolute top-2 right-2 bg-white/90 rounded-full p-1">
                {getTrendIcon(item.trend)}
              </div>
            )}
          </div>
        ) : (
          <div className={`w-32 h-32 bg-gradient-to-br ${getTypeColor(item.type)} rounded-xl overflow-hidden relative flex items-center justify-center`}>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-2 text-center">
              <div className="text-2xl mb-1">
                {item.type === 'ai热点监测' && '🤖'}
                {item.type === '热点趋势监测' && '📈'}
                {item.type === '竞品社媒监控' && '📱'}
                {item.type === '休闲游戏监测' && '🎮'}
              </div>
              <div className="text-xs font-bold">{item.type}</div>
            </div>
            {item.trend && (
              <div className="absolute top-2 right-2">
                {getTrendIcon(item.trend)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Title */}
        <h3 className="text-lg font-bold text-slate-900 mb-2 line-clamp-2">
          {item.title}
        </h3>

        {/* Source and Metadata */}
        <div className="flex items-center gap-3 text-sm text-slate-600 mb-2 flex-wrap">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span>{item.source}</span>
          </div>
          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs border border-slate-200">
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
              <span className="font-semibold text-slate-700">{scoreValue.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Description：AI 日报卡片仅展示摘要+分析，以及可点击的「原文链接」；其他类型展示 description */}
        <div className="mb-3 space-y-1">
          {isAiHotspot ? (
            <div className="text-[13px] leading-snug text-slate-600 overflow-hidden max-h-40 [&_p]:mb-1 [&_p]:last:mb-0 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_strong]:text-slate-700">
              <MarkdownRenderer content={cardContent || item.description || '暂无内容'} />
              {linkUrl && linkUrl !== '#' && (
                <p className="mt-2 mb-0">
                  <a
                    href={linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-blue-600 hover:text-blue-700 underline"
                  >
                    原文链接
                  </a>
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-600 line-clamp-2">
              {item.description}
            </p>
          )}
        </div>

        {/* Tags and Sentiment */}
        <div className="flex flex-wrap items-center gap-2">
          {!isAiHotspot && item.sentiment && (
            <span className={`px-2.5 py-1 text-xs rounded-full border ${getSentimentColor(item.sentiment)}`}>
              {item.sentiment === 'positive' && '正面'}
              {item.sentiment === 'negative' && '负面'}
              {item.sentiment === 'neutral' && '中性'}
            </span>
          )}
          {item.tags.map((tag, index) => (
            <span
              key={index}
              className="px-2.5 py-1 text-xs rounded-full border bg-slate-100 text-slate-700 border-slate-200"
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
