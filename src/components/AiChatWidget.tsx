import { useState, useRef, useEffect } from 'react';
import { getApiUrl } from '../utils/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const AiChatWidget = () => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || messages.length === 0) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const handleToggle = () => {
    setOpen(!open);
    setError(null);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError(null);

    const userMsg: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: text,
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);
    try {
      const resp = await fetch(getApiUrl('/api/ai/chat'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          message: text,
          history: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (resp.status === 401) {
        setError('请先登录后再使用 AI 助手。');
        setLoading(false);
        return;
      }
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        setError(data?.error || '调用 AI 接口失败，请稍后重试。');
        setLoading(false);
        return;
      }
      const data = await resp.json();
      const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
      if (!answer) {
        setError('AI 返回内容为空，请稍后重试。');
        setLoading(false);
        return;
      }
      const assistantMsg: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: 'assistant',
        content: answer,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e) {
      setError('网络异常，暂时无法连接 AI。');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {open && (
        <div className="mb-3 w-80 sm:w-96 rounded-2xl border border-slate-200 bg-white shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white text-sm">
                🤖
              </span>
              <div>
                <div className="text-sm font-semibold text-slate-900">AI 助手</div>
                <div className="text-xs text-slate-500">就当前监测内容提问、解释或延伸</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            >
              <span className="sr-only">关闭</span>
              <svg className="h-4 w-4" viewBox="0 0 24 24" stroke="currentColor" fill="none">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div
            ref={containerRef}
            className="flex-1 max-h-80 overflow-y-auto px-3 py-3 space-y-3 text-sm bg-slate-50/50"
          >
            {messages.length === 0 && !error && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                你可以直接提问，例如：
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  <li>「帮我解释本页这个榜单里的几个关键字段」</li>
                  <li>「这周哪些休闲游戏值得重点关注？」</li>
                  <li>「根据最近几期周报，总结一下主要趋势」</li>
                </ul>
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-sm'
                      : 'bg-white text-slate-900 border border-slate-200 rounded-bl-sm'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="h-2 w-2 rounded-full bg-slate-300 animate-pulse" />
                正在思考中...
              </div>
            )}
            {error && (
              <div className="text-xs text-rose-500 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1.5">
                {error}
              </div>
            )}
          </div>
          <div className="border-t border-slate-200 bg-white px-3 py-2">
            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="就当前页面的数据或趋势提问…（回车发送，Shift+回车换行）"
                className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={loading || !input.trim()}
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white text-xs disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    d="M5 12h14M12 5l7 7-7 7"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={handleToggle}
        className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/30 hover:bg-blue-700 transition-colors"
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-base">
          🤖
        </span>
        <span>{open ? '收起 AI 助手' : 'AI 对话'}</span>
      </button>
    </div>
  );
};

export default AiChatWidget;

