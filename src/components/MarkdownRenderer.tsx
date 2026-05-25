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

/** 全角方括号 → 半角，便于解析模型输出的 `[标题](url)` 变体 */
function normalizeMarkdownBrackets(text: string): string {
  return text.replace(/\uFF3B/g, '[').replace(/\uFF3D/g, ']');
}

/**
 * 查找下一个 Markdown 行内链接 `[label](href)`：
 * - `]` 与 `(` 之间允许空白；
 * - 目标地址支持半角括号配对（URL 内可含 `)`）；
 * - 支持全角包裹 `（https://…）`（常见于中文模型输出）。
 */
function findNextMarkdownLink(
  text: string,
  from = 0
): { start: number; end: number; label: string; href: string } | null {
  let pos = from;
  while (pos < text.length) {
    const open = text.indexOf('[', pos);
    if (open === -1) return null;
    const closeBracket = text.indexOf(']', open + 1);
    if (closeBracket === -1) return null;
    let i = closeBracket + 1;
    while (i < text.length && /\s/.test(text[i])) i++;
    const oc = text[i];
    if (oc === '\uFF08') {
      const urlStart = i + 1;
      const closeFw = text.indexOf('\uFF09', urlStart);
      if (closeFw === -1) {
        pos = open + 1;
        continue;
      }
      const hrefRaw = text.slice(urlStart, closeFw).trim();
      const label = text.slice(open + 1, closeBracket);
      return { start: open, end: closeFw + 1, label, href: hrefRaw };
    }
    if (oc !== '(') {
      pos = open + 1;
      continue;
    }
    i++;
    const urlStart = i;
    let depth = 1;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    if (depth !== 0) {
      pos = open + 1;
      continue;
    }
    const hrefRaw = text.slice(urlStart, i - 1).trim();
    const label = text.slice(open + 1, closeBracket);
    return { start: open, end: i, label, href: hrefRaw };
  }
  return null;
}

function pushLinkNode(
  finalParts: (string | React.ReactElement)[],
  keyCounter: { n: number },
  key: string,
  hrefRaw: string,
  label: string,
  onInternalLinkClick?: (id: string) => void
): void {
  let href = hrefRaw.replace(/^<|>$/g, '').trim();
  const isEntryLink = href.startsWith('#entry:');
  const entryId = isEntryLink ? href.replace(/^#entry:/, '') : '';
  finalParts.push(
    <a
      key={`${key}-link-${keyCounter.n++}`}
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
      {label}
    </a>
  );
}

/** 粗体、链接、裸 URL（不含行内 `![alt](url)`，避免与链接语法冲突） */
function renderInlineMarkdownCore(
  text: string,
  onInternalLinkClick?: (id: string) => void,
  keyFragment = ''
): React.ReactNode[] {
  const normalized = normalizeMarkdownBrackets(text);
  const parts: (string | React.ReactElement)[] = [];
  let currentIndex = 0;

  const boldRegex = /\*\*(.*?)\*\*/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = boldRegex.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      parts.push(normalized.substring(lastIndex, match.index));
    }
    parts.push(
      <strong key={`${keyFragment}s-${currentIndex++}`} className="font-semibold text-slate-900">
        {renderInlineMarkdown(match[1], onInternalLinkClick)}
      </strong>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < normalized.length) {
    parts.push(normalized.substring(lastIndex));
  }

  const finalParts: (string | React.ReactElement)[] = [];
  const linkKeyCounter = { n: 0 };

  parts.forEach((part, partIndex) => {
    if (typeof part === 'string') {
      let cursor = 0;
      let link = findNextMarkdownLink(part, cursor);
      while (link !== null) {
        if (link.start > cursor) {
          finalParts.push(part.slice(cursor, link.start));
        }
        pushLinkNode(
          finalParts,
          linkKeyCounter,
          `${keyFragment}link-${partIndex}`,
          link.href,
          link.label,
          onInternalLinkClick
        );
        cursor = link.end;
        link = findNextMarkdownLink(part, cursor);
      }
      if (cursor < part.length) {
        finalParts.push(part.slice(cursor));
      }
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
            key={`${keyFragment}url-${partIndex}-${currentIndex++}`}
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

  return withUrls.length > 0 ? withUrls : [<span key={`${keyFragment}empty`}>{text}</span>];
}

/** 行内 Markdown：含 `![ ](url)` 小图标（与 ST 推送一致），以及粗体、链接、裸 URL */
function renderInlineMarkdown(
  text: string,
  onInternalLinkClick?: (id: string) => void
): React.ReactNode[] {
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const nodes: React.ReactNode[] = [];
  let pos = 0;
  let imgMatch: RegExpExecArray | null;
  let seg = 0;
  while ((imgMatch = imgRegex.exec(text)) !== null) {
    if (imgMatch.index > pos) {
      nodes.push(
        ...renderInlineMarkdownCore(text.slice(pos, imgMatch.index), onInternalLinkClick, `c${seg++}-`)
      );
    }
    const alt = imgMatch[1];
    const src = imgMatch[2];
    const inlineIcon = !alt.trim();
    nodes.push(
      <img
        key={`c${seg++}-img`}
        src={src}
        alt={alt.trim() || '图标'}
        className={
          inlineIcon
            ? 'inline-block h-5 w-5 shrink-0 rounded object-cover align-middle mr-1'
            : 'inline-block max-h-40 rounded align-middle'
        }
        loading="lazy"
      />
    );
    pos = imgMatch.index + imgMatch[0].length;
  }
  if (pos < text.length) {
    nodes.push(...renderInlineMarkdownCore(text.slice(pos), onInternalLinkClick, `c${seg}-`));
  }
  return nodes.length > 0 ? nodes : [<span key="empty-root">{text}</span>];
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
