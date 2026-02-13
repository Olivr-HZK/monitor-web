/**
 * Markdown 渲染器组件
 * 支持基本格式（标题、粗体、链接、列表、表格等）和换行
 */

import type React from 'react';

export interface MarkdownRendererProps {
  content: string;
  onInternalLinkClick?: (id: string) => void;
  /** 根容器 className */
  className?: string;
}

function renderInlineMarkdown(
  text: string,
  onInternalLinkClick?: (id: string) => void
): React.ReactNode[] {
  const parts: (string | React.ReactElement)[] = [];
  let currentIndex = 0;

  const boldRegex = /\*\*(.*?)\*\*/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    parts.push(
      <strong key={currentIndex++} className="font-semibold text-slate-900">
        {match[1]}
      </strong>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const finalParts: (string | React.ReactElement)[] = [];
  let linkLastIndex = 0;

  parts.forEach((part, partIndex) => {
    if (typeof part === 'string') {
      linkRegex.lastIndex = 0;
      while ((match = linkRegex.exec(part)) !== null) {
        if (match.index > linkLastIndex) {
          finalParts.push(part.substring(linkLastIndex, match.index));
        }
        const href = match[2];
        const isEntryLink = href.startsWith('#entry:');
        const entryId = isEntryLink ? href.replace(/^#entry:/, '') : '';
        finalParts.push(
          <a
            key={`link-${partIndex}-${currentIndex++}`}
            href={href}
            {...(isEntryLink && onInternalLinkClick
              ? {
                  onClick: (e: React.MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onInternalLinkClick(entryId);
                  },
                }
              : {
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  onClick: (e: React.MouseEvent) => e.stopPropagation(),
                })}
            className="text-blue-600 hover:text-blue-700 underline"
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

  const urlRegex = /(https?:\/\/[^\s)]+)/g;
  const withUrls: (string | React.ReactElement)[] = [];

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
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="text-blue-600 hover:text-blue-700 underline"
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

  return withUrls.length > 0 ? withUrls : [<span key="empty">{text}</span>];
}

const MarkdownRenderer = ({
  content,
  onInternalLinkClick,
  className,
}: MarkdownRendererProps) => {
  const lines = content.split('\n');
  const elements: React.ReactElement[] = [];
  let currentParagraph: string[] = [];
  let listItems: string[] = [];
  let inList = false;

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      currentParagraph.forEach((line) => {
        const text = line.trim();
        if (text) {
          elements.push(
            <p key={elements.length} className="mb-1 text-slate-700 leading-relaxed last:mb-0">
              {renderInlineMarkdown(text, onInternalLinkClick)}
            </p>
          );
        }
      });
      currentParagraph = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={elements.length} className="mb-4 list-disc list-inside space-y-2 text-slate-700">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item, onInternalLinkClick)}</li>
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

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const imageMatch = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    if (imageMatch) {
      flushParagraph();
      flushList();
      elements.push(
        <div key={`img-${index}`} className="mb-4">
          <img
            src={imageMatch[1]}
            alt="截图"
            className="w-full max-h-96 object-contain rounded-lg border border-slate-200 bg-slate-50"
            loading="lazy"
          />
        </div>
      );
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushParagraph();
      flushList();
      elements.push(
        <h1 key={index} className="text-3xl font-bold mb-4 mt-6 text-slate-900">
          {trimmed.substring(2)}
        </h1>
      );
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushParagraph();
      flushList();
      elements.push(
        <h2 key={index} className="text-2xl font-bold mb-3 mt-5 text-slate-900">
          {trimmed.substring(3)}
        </h2>
      );
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushParagraph();
      flushList();
      elements.push(
        <h3 key={index} className="text-xl font-bold mb-2 mt-4 text-slate-900">
          {trimmed.substring(4)}
        </h3>
      );
      continue;
    }

    if (trimmed === '---' || trimmed.startsWith('---')) {
      flushParagraph();
      flushList();
      elements.push(<hr key={index} className="my-6 border-slate-200" />);
      continue;
    }

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
          <table className="min-w-full border border-slate-200 text-sm">
            <thead>
              <tr className="bg-slate-50">
                {headerCells.map((cell, i) => (
                  <th
                    key={i}
                    className="border border-slate-200 px-3 py-2 text-left font-semibold text-slate-700"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr
                  key={ri}
                  className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'}
                >
                  {parseTableRow(row).map((cell, ci) => {
                    const parts = cell.split('<br>');
                    return (
                      <td key={ci} className="border border-slate-200 px-3 py-2 text-slate-700">
                        {parts.map((part, idx) => (
                          <span key={`${ci}-${idx}`}>
                            {renderInlineMarkdown(part, onInternalLinkClick)}
                            {idx < parts.length - 1 ? <br /> : null}
                          </span>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

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

    flushList();
    currentParagraph.push(line);
  }

  flushParagraph();
  flushList();

  return <div className={className}>{elements}</div>;
};

export default MarkdownRenderer;
