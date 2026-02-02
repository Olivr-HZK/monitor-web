/**
 * 日报/周报详情页组件
 * 统一使用 ReportDocument 格式：标题、标签、时间、来源、摘要来自文档，正文仅渲染 content
 */

import { useMemo } from 'react';
import type { MonitorItem, ReportDocument } from '../types';
import { toReportDocument } from '../utils/reportDocument';

interface WeeklyReportDetailProps {
  item: MonitorItem;
  onBack: () => void;
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

const WeeklyReportDetail = ({ item, onBack }: WeeklyReportDetailProps) => {
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              返回
            </button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900">{doc.title}</h1>
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-600 flex-wrap">
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
                      <span className="font-semibold">{doc.score.toFixed(1)}</span>
                    </span>
                  </>
                )}
              </div>
              {doc.tags && doc.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {doc.tags.map((tag, i) => (
                    <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">
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
          <div className="mb-6 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
            <img src={doc.coverImage} alt={doc.title} className="w-full max-h-80 object-cover" />
          </div>
        )}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
          <div className="prose prose-lg max-w-none">
            <MarkdownRenderer content={doc.content} />
          </div>
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
  const elements: JSX.Element[] = [];
  let currentParagraph: string[] = [];
  let listItems: string[] = [];
  let inList = false;

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const text = currentParagraph.join(' ');
      if (text.trim()) {
        elements.push(
          <p key={elements.length} className="mb-4 text-gray-700 leading-relaxed">
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
        <ul key={elements.length} className="mb-4 list-disc list-inside space-y-2 text-gray-700">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // 空行
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    // 标题
    if (trimmed.startsWith('# ')) {
      flushParagraph();
      flushList();
      elements.push(
        <h1 key={index} className="text-3xl font-bold mb-4 mt-6 text-gray-900">
          {trimmed.substring(2)}
        </h1>
      );
      return;
    }

    if (trimmed.startsWith('## ')) {
      flushParagraph();
      flushList();
      elements.push(
        <h2 key={index} className="text-2xl font-bold mb-3 mt-5 text-gray-900">
          {trimmed.substring(3)}
        </h2>
      );
      return;
    }

    if (trimmed.startsWith('### ')) {
      flushParagraph();
      flushList();
      elements.push(
        <h3 key={index} className="text-xl font-bold mb-2 mt-4 text-gray-900">
          {trimmed.substring(4)}
        </h3>
      );
      return;
    }

    // 分隔线
    if (trimmed === '---' || trimmed.startsWith('---')) {
      flushParagraph();
      flushList();
      elements.push(<hr key={index} className="my-6 border-gray-300" />);
      return;
    }

    // 列表项
    if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushParagraph();
      if (!inList) {
        inList = true;
      }
      listItems.push(trimmed.substring(2));
      return;
    }

    // 普通段落
    flushList();
    currentParagraph.push(line);
  });

  flushParagraph();
  flushList();

  return <div>{elements}</div>;
};

/**
 * 渲染行内 Markdown
 */
function renderInlineMarkdown(text: string): JSX.Element[] {
  const parts: (string | JSX.Element)[] = [];
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
      <strong key={currentIndex++} className="font-semibold text-gray-900">
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
  const finalParts: (string | JSX.Element)[] = [];
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
            className="text-blue-600 hover:text-blue-800 underline"
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

  return finalParts.length > 0 ? (finalParts as JSX.Element[]) : [<span key="empty">{text}</span>];
}

export default WeeklyReportDetail;
