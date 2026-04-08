import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import type { Components } from 'react-markdown';

type ChatMarkdownProps = {
  content: string;
  /** 用户气泡为浅色字，助手气泡为深色 */
  variant: 'user' | 'assistant';
};

function isInternalRoute(href: string) {
  return href.startsWith('/') && !href.startsWith('//');
}

export function ChatMarkdown({ content, variant }: ChatMarkdownProps) {
  const user = variant === 'user';
  const linkClass = user
    ? 'text-blue-100 underline underline-offset-2 decoration-blue-200/80 hover:text-white'
    : 'text-blue-600 underline underline-offset-2 decoration-blue-200 hover:text-blue-800';
  const inlineCodeClass = user
    ? 'rounded bg-blue-500/35 px-1 py-0.5 text-[0.9em] font-mono align-baseline'
    : 'rounded bg-slate-100 px-1 py-0.5 text-[0.9em] font-mono text-rose-800 align-baseline';

  const components: Components = {
    a: ({ href, children, node: _node, ...rest }) => {
      if (href && isInternalRoute(href)) {
        return (
          <Link to={href} className={linkClass} {...rest}>
            {children}
          </Link>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass} {...rest}>
          {children}
        </a>
      );
    },
    p: ({ children }) => (
      <p className={`mb-2 last:mb-0 leading-relaxed ${user ? 'text-white' : 'text-slate-800'}`}>{children}</p>
    ),
    ul: ({ children }) => (
      <ul className={`my-2 pl-4 list-disc space-y-1 ${user ? 'text-white' : 'text-slate-800'}`}>{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className={`my-2 pl-4 list-decimal space-y-1 ${user ? 'text-white' : 'text-slate-800'}`}>{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
    h1: ({ children }) => (
      <h3 className={`text-sm font-semibold mt-2 mb-1.5 first:mt-0 ${user ? 'text-white' : 'text-slate-900'}`}>
        {children}
      </h3>
    ),
    h2: ({ children }) => (
      <h3 className={`text-sm font-semibold mt-2 mb-1.5 first:mt-0 ${user ? 'text-white' : 'text-slate-900'}`}>
        {children}
      </h3>
    ),
    h3: ({ children }) => (
      <h3 className={`text-sm font-semibold mt-2 mb-1.5 first:mt-0 ${user ? 'text-white' : 'text-slate-900'}`}>
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className={`text-xs font-semibold mt-1.5 mb-1 ${user ? 'text-white' : 'text-slate-800'}`}>{children}</h4>
    ),
    blockquote: ({ children }) => (
      <blockquote
        className={`my-2 border-l-2 pl-2.5 italic ${
          user ? 'border-blue-200/60 text-blue-50' : 'border-slate-300 text-slate-600'
        }`}
      >
        {children}
      </blockquote>
    ),
    hr: () => <hr className={`my-3 border-0 border-t ${user ? 'border-blue-300/40' : 'border-slate-200'}`} />,
    strong: ({ children }) => (
      <strong className={`font-semibold ${user ? 'text-white' : 'text-slate-900'}`}>{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    table: ({ children }) => (
      <div className={`overflow-x-auto my-2 -mx-0.5 rounded-lg ${user ? 'ring-1 ring-blue-400/30' : ''}`}>
        <table
          className={`min-w-full text-[11px] border-collapse border ${
            user ? 'border-blue-300/40 text-white' : 'border-slate-200 text-slate-800'
          }`}
        >
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className={user ? 'bg-blue-500/25' : 'bg-slate-100'}>{children}</thead>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => (
      <tr className={user ? 'border-b border-blue-300/25' : 'border-b border-slate-100'}>{children}</tr>
    ),
    th: ({ children }) => (
      <th className={`px-2 py-1.5 text-left font-semibold border ${user ? 'border-blue-300/30' : 'border-slate-200'}`}>
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className={`px-2 py-1.5 align-top border ${user ? 'border-blue-300/25' : 'border-slate-200'}`}>
        {children}
      </td>
    ),
    pre: ({ children }) => (
      <pre
        className={`overflow-x-auto rounded-lg p-2.5 my-2 text-[11px] leading-relaxed ${
          user ? 'bg-blue-950/50 text-blue-50' : 'bg-slate-900 text-slate-100'
        }`}
      >
        {children}
      </pre>
    ),
    code: ({ className, children, ...props }) => {
      const isBlock = Boolean(className);
      if (!isBlock) {
        return (
          <code className={inlineCodeClass} {...props}>
            {children}
          </code>
        );
      }
      return (
        <code className={`${className ?? ''} font-mono text-[11px]`} {...props}>
          {children}
        </code>
      );
    },
  };

  if (!content.trim()) {
    return null;
  }

  return (
    <div className="chat-md-root text-[13px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
