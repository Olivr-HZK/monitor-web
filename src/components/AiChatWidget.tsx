import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAiPageContext } from '../context/AiPageContext';
import { getApiUrl, parseApiErrorBody, withApiAuth } from '../utils/api';
import { ChatMarkdown } from './ChatMarkdown';

const STORAGE_KEY_V3 = 'ai-chat-sessions-v3';
const STORAGE_KEY_V2 = 'ai-chat-sessions-v2';
const STORAGE_SIDEBAR_COLLAPSED = 'ai-sidebar-collapsed';
const STORAGE_SIDEBAR_WIDTH = 'ai-sidebar-width';
const SIDEBAR_WIDTH_DEFAULT = 380;
const SIDEBAR_WIDTH_MIN = 280;
const SIDEBAR_WIDTH_MAX = 560;

function loadSidebarPrefs(): { collapsed: boolean; width: number } {
  try {
    const c = localStorage.getItem(STORAGE_SIDEBAR_COLLAPSED);
    const w = localStorage.getItem(STORAGE_SIDEBAR_WIDTH);
    const parsed = w ? Number.parseInt(w, 10) : NaN;
    const width = Number.isFinite(parsed)
      ? Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, parsed))
      : SIDEBAR_WIDTH_DEFAULT;
    return { collapsed: c === '1', width };
  } catch {
    return { collapsed: false, width: SIDEBAR_WIDTH_DEFAULT };
  }
}

export type AiIntentMeta = {
  mode?: string;
  needs_db?: boolean;
  needs_web?: boolean;
  steps?: string[];
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  intentMeta?: AiIntentMeta;
  /** 用户对助手本条回复的评价 */
  feedback?: 'up' | 'down';
}

interface ChatSession {
  id: string;
  title: string;
  /** 用户手动重命名后为 true，不再用首条问题自动覆盖标题 */
  titleManual?: boolean;
  messages: ChatMessage[];
  updatedAt: number;
}

const MODE_LABEL: Record<string, string> = {
  chat_only: '仅对话',
  db_only: '偏数据库',
  web_only: '偏联网',
  hybrid: '数据库 + 联网',
};

type StreamEvent = {
  event: string;
  data: Record<string, unknown> | null;
};

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function titleFromFirstQuestion(text: string) {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return '新对话';
  return t.length > 28 ? `${t.slice(0, 28)}…` : t;
}

function loadSessionsFromStorage(): { activeId: string; sessions: ChatSession[] } | null {
  try {
    let raw = localStorage.getItem(STORAGE_KEY_V3);
    if (!raw) {
      raw = localStorage.getItem(STORAGE_KEY_V2);
      if (raw) {
        try {
          localStorage.removeItem(STORAGE_KEY_V2);
        } catch {
          /* ignore */
        }
      }
    }
    if (!raw) return null;
    const data = JSON.parse(raw) as { activeId?: string; sessions?: ChatSession[] };
    if (!Array.isArray(data.sessions) || data.sessions.length === 0) return null;
    const sessions = data.sessions
      .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.messages))
      .map((s) => ({
        ...s,
        titleManual: Boolean(s.titleManual),
      }));
    if (sessions.length === 0) return null;
    const activeId =
      data.activeId && sessions.some((s) => s.id === data.activeId) ? data.activeId : sessions[0].id;
    return { activeId, sessions };
  } catch {
    return null;
  }
}

function saveSessionsToStorage(activeId: string, sessions: ChatSession[]) {
  try {
    localStorage.setItem(STORAGE_KEY_V3, JSON.stringify({ activeId, sessions }));
  } catch {
    /* quota / private mode */
  }
}

/** 快捷提问：点击即发送 */
const QUICK_PROMPTS: { label: string; text: string }[] = [
  { label: '解释本页数据', text: '结合我当前所在的页面，帮我说明这里展示的数据是什么意思、该怎么读。' },
  { label: '本周休闲游戏看点', text: '从监测数据角度，这周休闲游戏有哪些值得关注的动向或产品？' },
  { label: '周报/趋势摘要', text: '根据站内能看到的近期内容，帮我用几条要点总结主要趋势。' },
  { label: '怎么在站里查榜单', text: '我想自己查微信或抖音小游戏排行榜，应该从哪个入口进、大致怎么操作？' },
  { label: 'SensorTower 相关', text: '本站里 SensorTower 榜单和商店页变化主要能看什么？适合我做什么判断？' },
];

const AiChatWidget = () => {
  const location = useLocation();
  const { pageMeta } = useAiPageContext();
  const pageContext = useMemo(
    () => ({
      pathname: location.pathname,
      search: location.search || '',
      hash: location.hash || '',
      ...pageMeta,
    }),
    [location.pathname, location.search, location.hash, pageMeta]
  );

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadSidebarPrefs().collapsed);
  const [sidebarWidth, setSidebarWidth] = useState(() => loadSidebarPrefs().width);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const loaded = loadSessionsFromStorage();
    if (loaded) return loaded.sessions;
    const id = newId();
    return [{ id, title: '新对话', messages: [], updatedAt: Date.now() }];
  });
  const [activeSessionId, setActiveSessionId] = useState(() => {
    const loaded = loadSessionsFromStorage();
    return loaded ? loaded.activeId : '';
  });

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const messages = activeSession?.messages ?? [];

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!activeSessionId && sessions[0]) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  useEffect(() => {
    saveSessionsToStorage(activeSessionId || sessions[0]?.id || '', sessions);
  }, [sessions, activeSessionId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SIDEBAR_COLLAPSED, sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SIDEBAR_WIDTH, String(sidebarWidth));
    } catch {
      /* ignore */
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (sidebarCollapsed || messages.length === 0) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sidebarCollapsed]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: sidebarWidth };
    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = ev.clientX - r.startX;
      setSidebarWidth(
        Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, r.startW + dx))
      );
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const handleNewSession = () => {
    handleStop();
    setLoading(false);
    setError(null);
    setRenamingId(null);
    const id = newId();
    const next: ChatSession = { id, title: '新对话', messages: [], updatedAt: Date.now() };
    setSessions((prev) => [next, ...prev]);
    setActiveSessionId(id);
    setInput('');
  };

  const handleSelectSession = (id: string) => {
    if (id === activeSessionId) return;
    handleStop();
    setLoading(false);
    setError(null);
    setRenamingId(null);
    setActiveSessionId(id);
    setInput('');
  };

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((c) => !c);
    setError(null);
  };

  const startRename = (e: React.MouseEvent, s: ChatSession) => {
    e.stopPropagation();
    setRenamingId(s.id);
    setRenameDraft(s.title);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const t = renameDraft.trim() || '新对话';
    setSessions((prev) =>
      prev.map((s) =>
        s.id === renamingId ? { ...s, title: t, titleManual: true, updatedAt: Date.now() } : s
      )
    );
    setRenamingId(null);
    setRenameDraft('');
  };

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    handleStop();
    setLoading(false);
    setError(null);
    setRenamingId(null);
    if (sessions.length <= 1) {
      const fresh: ChatSession = { id: newId(), title: '新对话', messages: [], updatedAt: Date.now() };
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
      setInput('');
      return;
    }
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (id === activeSessionId && next[0]) {
        setActiveSessionId(next[0].id);
      }
      return next;
    });
  };

  const runSendWithText = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || loading) return;
      if (composingRef.current) return;

      const sid = activeSessionId || sessions[0]?.id;
      if (!sid) return;

      const current = sessions.find((s) => s.id === sid);
      if (!current) return;

      const userMsg: ChatMessage = {
        id: `${Date.now()}-user`,
        role: 'user',
        content: text,
      };
      const historyBefore = [...current.messages, userMsg];
      const assistantId = `${Date.now()}-assistant`;

      setError(null);

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sid) return s;
          const nextMessages = [...s.messages, userMsg, { id: assistantId, role: 'assistant' as const, content: '' }];
          const isFirstUserTurn = s.messages.length === 0;
          const title =
            !s.titleManual && isFirstUserTurn ? titleFromFirstQuestion(text) : s.title;
          return { ...s, messages: nextMessages, title, updatedAt: Date.now() };
        })
      );

      setLoading(true);
      const ac = new AbortController();
      abortRef.current = ac;
      const { signal } = ac;

      const updateAssistant = (appendText: string) => {
        if (!appendText) return;
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sid) return s;
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantId ? { ...m, content: `${m.content}${appendText}` } : m
              ),
              updatedAt: Date.now(),
            };
          })
        );
      };

      const streamChat = async (): Promise<{ answer: string; intentMeta?: AiIntentMeta }> => {
        const resp = await fetch(
          getApiUrl('/api/ai/chat/stream'),
          withApiAuth({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            signal,
            body: JSON.stringify({
              message: text,
              history: historyBefore.map((m) => ({ role: m.role, content: m.content })),
              pageContext,
            }),
          })
        );
        if (resp.status === 401) throw new Error('UNAUTHORIZED');
        if (!resp.ok) {
          const raw = await resp.text();
          let parsed: unknown = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            /* ignore */
          }
          const msg = parseApiErrorBody(parsed) || raw.slice(0, 400).trim() || `请求失败（HTTP ${resp.status}）`;
          throw new Error(msg);
        }
        if (!resp.body) throw new Error('STREAM_HTTP_ERROR');

        const decoder = new TextDecoder();
        const reader = resp.body.getReader();
        let buffer = '';
        let answer = '';
        let intentMeta: AiIntentMeta | undefined;

        const applyIntent = (intent: AiIntentMeta) => {
          intentMeta = intent;
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sid) return s;
              return {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantId ? { ...m, intentMeta: intent } : m
                ),
                updatedAt: Date.now(),
              };
            })
          );
        };

        const parseSse = (block: string): StreamEvent | null => {
          const lines = block.split('\n');
          let event = 'message';
          let dataRaw = '';
          for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            if (line.startsWith('data:')) dataRaw += line.slice(5).trim();
          }
          if (!dataRaw) return null;
          try {
            return { event, data: JSON.parse(dataRaw) as Record<string, unknown> };
          } catch {
            return null;
          }
        };

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() || '';
            for (const block of blocks) {
              const evt = parseSse(block);
              if (!evt) continue;
              if (evt.event === 'meta') {
                const raw = evt.data?.intent;
                if (raw && typeof raw === 'object') {
                  applyIntent(raw as AiIntentMeta);
                }
              } else if (evt.event === 'delta') {
                const delta = typeof evt.data?.delta === 'string' ? evt.data.delta : '';
                if (delta) {
                  answer += delta;
                  updateAssistant(delta);
                }
              } else if (evt.event === 'done') {
                const finalAnswer = typeof evt.data?.answer === 'string' ? evt.data.answer : '';
                if (finalAnswer && !answer) {
                  answer = finalAnswer;
                  updateAssistant(finalAnswer);
                }
                return { answer: answer || finalAnswer, intentMeta };
              } else if (evt.event === 'error') {
                const msg = typeof evt.data?.error === 'string' ? evt.data.error : 'AI 流式接口异常';
                throw new Error(msg || 'AI 流式接口异常');
              }
            }
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            /* ignore */
          }
        }
        if (!answer.trim()) throw new Error('EMPTY_STREAM_ANSWER');
        return { answer, intentMeta };
      };

      const fallbackChat = async (): Promise<{ answer: string; intentMeta?: AiIntentMeta }> => {
        const resp = await fetch(
          getApiUrl('/api/ai/chat'),
          withApiAuth({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            signal,
            body: JSON.stringify({
              message: text,
              history: historyBefore.map((m) => ({ role: m.role, content: m.content })),
              pageContext,
            }),
          })
        );
        if (resp.status === 401) throw new Error('UNAUTHORIZED');
        const rawText = await resp.text();
        let data: unknown = null;
        try {
          data = rawText ? JSON.parse(rawText) : null;
        } catch {
          data = null;
        }
        if (!resp.ok) {
          const msg =
            parseApiErrorBody(data) || rawText.slice(0, 400).trim() || `请求失败（HTTP ${resp.status}）`;
          throw new Error(msg);
        }
        const payload = data as { answer?: string; meta?: { intent?: unknown } } | null;
        const answer = typeof payload?.answer === 'string' ? payload.answer.trim() : '';
        if (!answer) throw new Error('AI 返回内容为空，请稍后重试。');
        const rawIntent = payload?.meta?.intent;
        const intentMeta =
          rawIntent && typeof rawIntent === 'object' ? (rawIntent as AiIntentMeta) : undefined;
        return { answer, intentMeta };
      };

      const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';

      try {
        let result: { answer: string; intentMeta?: AiIntentMeta };
        try {
          result = await streamChat();
        } catch (first) {
          if (isAbort(first)) throw first;
          result = await fallbackChat();
        }
        const { answer, intentMeta } = result;
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sid) return s;
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantId ? { ...m, content: answer, intentMeta: intentMeta ?? m.intentMeta } : m
              ),
              updatedAt: Date.now(),
            };
          })
        );
      } catch (e) {
        if (
          (e instanceof Error || e instanceof DOMException) &&
          (e as Error).name === 'AbortError'
        ) {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sid) return s;
              return {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: (m.content || '').trim() ? m.content : '（已停止生成）',
                      }
                    : m
                ),
                updatedAt: Date.now(),
              };
            })
          );
          setError(null);
          return;
        }
        const msg = e instanceof Error ? e.message : '';
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sid) return s;
            return {
              ...s,
              messages: s.messages.filter((m) => m.id !== assistantId || (m.content || '').trim() !== ''),
              updatedAt: Date.now(),
            };
          })
        );
        if (msg === 'UNAUTHORIZED') {
          setError('请先登录后再使用 AI 助手。');
        } else if (msg && !['STREAM_HTTP_ERROR', 'EMPTY_STREAM_ANSWER'].includes(msg)) {
          setError(msg);
        } else {
          setError('网络异常，暂时无法连接 AI。');
        }
      } finally {
        abortRef.current = null;
        setLoading(false);
      }
    },
    [activeSessionId, sessions, loading, pageContext]
  );

  const handleSend = async () => {
    if (loading) return;
    const text = input.trim();
    if (!text) return;
    setInput('');
    await runSendWithText(text);
  };

  const handleQuickSend = (text: string) => {
    void runSendWithText(text);
  };

  const handleFeedback = useCallback(
    (messageId: string, rating: 'up' | 'down') => {
      setSessions((prev) => {
        const sid = activeSessionId || prev[0]?.id;
        if (!sid) return prev;
        let submitRating: 'up' | 'down' | null = null;
        const nextSessions = prev.map((s) => {
          if (s.id !== sid) return s;
          return {
            ...s,
            messages: s.messages.map((msg) => {
              if (msg.id !== messageId || msg.role !== 'assistant') return msg;
              const cur = msg.feedback;
              const nu = cur === rating ? undefined : rating;
              submitRating = nu ?? null;
              return { ...msg, feedback: nu };
            }),
            updatedAt: Date.now(),
          };
        });
        if (submitRating) {
          const r = submitRating;
          const mid = messageId;
          const path = location.pathname;
          const sess = sid;
          queueMicrotask(() => {
            void fetch(
              getApiUrl('/api/ai/feedback'),
              withApiAuth({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  messageId: mid,
                  rating: r,
                  sessionId: sess,
                  pathname: path,
                }),
              })
            ).catch(() => {
              /* 离线或 CORS 时仍保留本地记录 */
            });
          });
        }
        return nextSessions;
      });
    },
    [activeSessionId, location.pathname]
  );

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (loading) return;
    if (e.nativeEvent.isComposing || composingRef.current) {
      return;
    }
    e.preventDefault();
    void handleSend();
  };

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]
  );

  return (
    <aside
      className="relative z-40 flex h-screen shrink-0 flex-col border-r border-slate-200 bg-white shadow-[2px_0_12px_rgba(15,23,42,0.06)]"
      style={
        sidebarCollapsed
          ? { width: 48 }
          : { width: sidebarWidth, minWidth: SIDEBAR_WIDTH_MIN, maxWidth: SIDEBAR_WIDTH_MAX }
      }
    >
      {sidebarCollapsed ? (
        <div className="flex h-full flex-col items-center border-r border-slate-200 bg-slate-50 py-3">
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            title="展开 AI 助手"
            aria-expanded={false}
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg shadow-sm hover:bg-slate-100"
          >
            🤖
          </button>
          <span
            className="mt-3 select-none text-[10px] font-medium text-slate-500 [writing-mode:vertical-rl]"
            style={{ writingMode: 'vertical-rl' }}
          >
            监测助手
          </span>
        </div>
      ) : (
        <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-row">
            {/* 左侧：会话列表（与 Cursor 一致，线程在左） */}
            <aside className="flex w-[7.5rem] sm:w-36 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50">
              <div className="border-b border-slate-200 px-2 py-1.5 text-[10px] font-medium text-slate-500">
                对话
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto px-1.5 py-1">
                {sortedSessions.map((s) => (
                  <div
                    key={s.id}
                    className={`rounded-lg border text-left text-[11px] ${
                      s.id === activeSessionId
                        ? 'border-blue-300 bg-blue-50 text-blue-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {renamingId === s.id ? (
                      <div className="space-y-1 p-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRename();
                            }
                            if (e.key === 'Escape') {
                              setRenamingId(null);
                              setRenameDraft('');
                            }
                          }}
                          className="w-full rounded border border-slate-300 px-1 py-0.5 text-[11px]"
                          autoFocus
                        />
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={commitRename}
                            className="flex-1 rounded bg-blue-600 py-0.5 text-[10px] text-white"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(null);
                              setRenameDraft('');
                            }}
                            className="flex-1 rounded border border-slate-200 py-0.5 text-[10px]"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSelectSession(s.id)}
                        className="block w-full truncate px-1.5 py-1.5 text-left"
                        title={s.title}
                      >
                        {s.title}
                      </button>
                    )}
                    {renamingId !== s.id && (
                      <div className="flex border-t border-slate-100/80">
                        <button
                          type="button"
                          onClick={(e) => startRename(e, s)}
                          className="flex-1 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100"
                          title="重命名"
                        >
                          改名
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSession(e, s.id)}
                          className="flex-1 py-0.5 text-[10px] text-rose-500 hover:bg-rose-50"
                          title="删除"
                        >
                          删
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </aside>

            {/* 右侧：对话区 */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-1 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm text-white">
                  🤖
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">监测助手</div>
                  <div className="truncate text-[10px] text-slate-500">对话记录保存在本机浏览器</div>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={handleNewSession}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                >
                  新对话
                </button>
                <button
                  type="button"
                  onClick={toggleSidebarCollapsed}
                  title="收起侧栏"
                  aria-label="收起侧边栏"
                  className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div
              ref={containerRef}
              className="flex-1 min-h-[10rem] overflow-y-auto px-3 py-3 space-y-3 text-sm bg-slate-50/50"
            >
              {messages.length === 0 && !error && (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-600 space-y-2">
                  <p className="font-medium text-slate-800">可以问我监测数据、榜单含义或怎么用本站。</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    支持多轮追问；中文输入法下，选词时按回车不会发送，整句输完后再按回车即可。Shift+Enter
                    换行。
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {QUICK_PROMPTS.map((q) => (
                      <button
                        key={q.label}
                        type="button"
                        disabled={loading}
                        onClick={() => handleQuickSend(q.text)}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700 hover:bg-blue-50 hover:border-blue-200 disabled:opacity-50"
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, idx) => {
                const streamPlain = Boolean(
                  loading && m.role === 'assistant' && idx === messages.length - 1
                );
                return (
                <div
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[88%] min-w-0 rounded-2xl px-3 py-2 break-words ${
                      streamPlain ? 'whitespace-pre-wrap' : ''
                    } ${
                      m.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-sm'
                        : 'bg-white text-slate-900 border border-slate-200 rounded-bl-sm'
                    }`}
                  >
                    {streamPlain ? (
                      <span className="text-[13px] leading-relaxed">{m.content}</span>
                    ) : m.role === 'user' ? (
                      <ChatMarkdown content={m.content} variant="user" />
                    ) : (
                      <ChatMarkdown content={m.content} variant="assistant" />
                    )}
                    {m.role === 'assistant' && m.intentMeta && (
                      <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-500 leading-snug space-y-0.5">
                        <div className="font-medium text-slate-600">本次规划（意图识别）</div>
                        <div>
                          模式：
                          {MODE_LABEL[m.intentMeta.mode || ''] || m.intentMeta.mode || '—'}
                          {m.intentMeta.needs_db ? ' · 可能查库' : ''}
                          {m.intentMeta.needs_web ? ' · 可能联网' : ''}
                        </div>
                        {m.intentMeta.steps && m.intentMeta.steps.length > 0 && (
                          <ul className="list-disc pl-3.5 text-slate-400">
                            {m.intentMeta.steps.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {m.role === 'assistant' && !streamPlain && (m.content || '').trim() !== '' && (
                      <div className="mt-2 flex items-center gap-0.5 border-t border-slate-100 pt-2">
                        <span className="text-[10px] text-slate-400 mr-1">这条回答</span>
                        <button
                          type="button"
                          onClick={() => handleFeedback(m.id, 'up')}
                          title="有用"
                          aria-label="点赞"
                          className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] transition-colors ${
                            m.feedback === 'up'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'text-slate-500 hover:bg-slate-100 border border-transparent'
                          }`}
                        >
                          <span aria-hidden>👍</span>
                          有用
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFeedback(m.id, 'down')}
                          title="需改进"
                          aria-label="点踩"
                          className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] transition-colors ${
                            m.feedback === 'down'
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'text-slate-500 hover:bg-slate-100 border border-transparent'
                          }`}
                        >
                          <span aria-hidden>👎</span>
                          需改进
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
              {loading && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-slate-300 animate-pulse" />
                  正在回复…（可点输入框右侧「停止」）
                </div>
              )}
              {error && (
                <div className="text-xs text-rose-500 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1.5">
                  {error}
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 bg-white px-3 py-2 space-y-2">
              {messages.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {QUICK_PROMPTS.slice(0, 3).map((q) => (
                    <button
                      key={`foot-${q.label}`}
                      type="button"
                      disabled={loading}
                      onClick={() => handleQuickSend(q.text)}
                      className="rounded-md border border-slate-100 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={() => {
                    composingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    composingRef.current = false;
                  }}
                  placeholder="输入问题，回车发送 · Shift+Enter 换行"
                  className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
                />
                {loading ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    title="停止生成"
                    aria-label="停止本次回复"
                    className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-rose-500 bg-rose-50 text-rose-600 hover:bg-rose-100"
                  >
                    <span className="h-2.5 w-2.5 rounded-sm bg-rose-600" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!input.trim()}
                    title="发送"
                    aria-label="发送"
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
                )}
              </div>
            </div>
          </div>
          </div>

          {/* 拖拽调整侧栏宽度（类似 Cursor 可拖分隔条） */}
          <button
            type="button"
            aria-label="拖拽调整侧栏宽度"
            onMouseDown={handleResizeStart}
            className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize border-0 bg-transparent p-0 hover:bg-blue-400/30"
          />
        </>
      )}
    </aside>
  );
};

export default AiChatWidget;
