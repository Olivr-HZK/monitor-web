import type { MonitorItem } from '../types';

interface MonitorCardProps {
  item: MonitorItem;
  onClick?: (item: MonitorItem) => void;
}

const MonitorCard = ({ item, onClick }: MonitorCardProps) => {
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'ai热点监测':
        return 'from-cyan-500 to-blue-600';
      case '热点趋势监测':
        return 'from-violet-500 to-fuchsia-600';
      case '竞品社媒监控':
        return 'from-amber-500 to-orange-600';
      case '休闲游戏监测':
        return 'from-emerald-500 to-green-600';
      default:
        return 'from-slate-500 to-slate-700';
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
        return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
      case 'negative':
        return 'bg-rose-500/10 text-rose-300 border-rose-500/30';
      default:
        return 'bg-slate-500/10 text-slate-300 border-slate-500/30';
    }
  };

  const handleClick = () => {
    if (onClick) {
      onClick(item);
    }
  };

  return (
    <div 
      className="flex gap-6 py-6 border-b border-slate-800/80 hover:bg-slate-900/60 transition-colors cursor-pointer"
      onClick={handleClick}
    >
      {/* Cover/Type Indicator */}
      <div className="flex-shrink-0 relative">
        {item.coverImage ? (
          <div className="w-32 h-32 rounded-xl overflow-hidden relative border border-slate-800">
            <img 
              src={item.coverImage} 
              alt={item.title}
              className="w-full h-full object-cover"
            />
            <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2`}>
              <div className="text-xs font-bold text-white/90">{item.type}</div>
            </div>
            {item.trend && (
              <div className="absolute top-2 right-2 bg-slate-900/80 rounded-full p-1">
                {getTrendIcon(item.trend)}
              </div>
            )}
          </div>
        ) : (
          <div className={`w-32 h-32 bg-gradient-to-br ${getTypeColor(item.type)} rounded-xl overflow-hidden relative flex items-center justify-center`}>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/90 p-2 text-center">
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
        <h3 className="text-lg font-bold text-white mb-2 line-clamp-2">
          {item.title}
        </h3>

        {/* Source and Metadata */}
        <div className="flex items-center gap-3 text-sm text-slate-400 mb-2 flex-wrap">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span>{item.source}</span>
          </div>
          <span className="px-2 py-0.5 bg-slate-800 text-slate-200 rounded text-xs border border-slate-700">
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
          {item.score !== undefined && (
            <div className="flex items-center gap-1">
              <span className="text-yellow-500">⭐</span>
              <span className="font-semibold text-slate-200">{item.score.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Description + 原文链接（有 URL 的任何监测项） */}
        <div className="mb-3 space-y-1">
          <p className="text-sm text-slate-400 line-clamp-2">
            {item.description}
          </p>
          {item.url && item.url !== '#' && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-xs text-cyan-300 hover:text-cyan-200"
              onClick={(e) => e.stopPropagation()}
            >
              原文链接
              <svg
                className="w-3 h-3 ml-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 5h6m0 0v6m0-6L10 14"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 19l4-4m0 0h4m-4 0v4"
                />
              </svg>
            </a>
          )}
        </div>

        {/* Tags and Sentiment */}
        <div className="flex flex-wrap items-center gap-2">
          {item.sentiment && (
            <span className={`px-2.5 py-1 text-xs rounded-full border ${getSentimentColor(item.sentiment)}`}>
              {item.sentiment === 'positive' && '正面'}
              {item.sentiment === 'negative' && '负面'}
              {item.sentiment === 'neutral' && '中性'}
            </span>
          )}
          {item.tags.map((tag, index) => (
            <span
              key={index}
              className="px-2.5 py-1 text-xs rounded-full border bg-slate-900 text-slate-300 border-slate-700"
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
