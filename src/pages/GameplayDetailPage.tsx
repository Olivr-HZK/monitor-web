import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAiPageContext } from '../context/AiPageContext';
import { useAuth } from '../context/AuthContext';
import { loadGameplayByGameName } from '../data/reportsLoader';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { getApiUrl, withApiAuth } from '../utils/api';
import { useNavigateBack } from '../utils/navigation';

const GameplayDetailPage = () => {
  const { setPageMeta } = useAiPageContext();
  const { source, gameName: encodedName } = useParams<{ source: string; gameName: string }>();
  const goBack = useNavigateBack(
    source === 'sensortower' ? '/rankings/casual/sensortower' : '/rankings/casual/wechat_douyin'
  );
  const { authMode, user, loading: authLoading, getDataUrl } = useAuth();
  const gameName = encodedName ? decodeURIComponent(encodedName) : '';

  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestSent, setRequestSent] = useState(false);
  const [requesting, setRequesting] = useState(false);
  /** 无后端时（404 等）为 true，用于显示「复制申请内容」兜底 */
  const [apiUnavailable, setApiUnavailable] = useState(false);

  const useFullDataUrls = authMode === 'static' || (authMode === 'backend' && user);
  const getDataUrlFn = useFullDataUrls ? getDataUrl : undefined;

  useEffect(() => {
    setPageMeta({
      pageKind: 'gameplay',
      gameplaySource: source || '',
      gameplayGameName: gameName,
      pageTitle: gameName ? `玩法解析 · ${gameName}` : '玩法解析',
    });
  }, [source, gameName, setPageMeta]);

  useEffect(() => {
    if (!gameName) {
      setLoading(false);
      return;
    }
    if (authLoading) return;
    let cancelled = false;
    setLoading(true);
    loadGameplayByGameName(getDataUrlFn, gameName)
      .then((md) => {
        if (!cancelled) {
          setContent(md ?? null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameName, getDataUrlFn, authLoading]);

  const handleRequestGameplay = async () => {
    setRequesting(true);
    setApiUnavailable(false);
    try {
      const res = await fetch(
        getApiUrl('/api/feedback/gameplay-request'),
        withApiAuth({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gameName,
            source: source || 'wechat_douyin',
            remark: '',
          }),
        })
      );
      if (res.ok) {
        setRequestSent(true);
      } else {
        if (res.status === 404 || res.status === 502 || res.status === 503) {
          setApiUnavailable(true);
        } else {
          const err = await res.json().catch(() => ({}));
          alert('提交失败：' + (err?.error || res.statusText));
        }
      }
    } catch {
      setApiUnavailable(true);
    } finally {
      setRequesting(false);
    }
  };

  const fallbackText = `【玩法解析申请】游戏：${gameName}，来源：${source || 'wechat_douyin'}`;
  const copyFallback = () => {
    navigator.clipboard.writeText(fallbackText).then(
      () => alert('已复制，可粘贴到企微/飞书发给管理员'),
      () => alert('复制失败，请手动复制下方内容')
    );
  };

  if (!gameName) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center gap-4">
        <div className="text-slate-600">缺少游戏名称</div>
        <button
          type="button"
          onClick={goBack}
          className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
        >
          返回
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center">
        <div className="text-slate-500">加载中...</div>
      </div>
    );
  }

  const hasContent = content && content.trim() && !content.includes('暂无玩法说明');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">{gameName} · 玩法解析</h1>
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center px-3 py-2 rounded-md border border-slate-200 text-sm font-medium text-slate-700 bg-white hover:bg-slate-100"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7 7-7M3 12h18" />
            </svg>
            返回
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-8">
          {hasContent ? (
            <div className="prose prose-lg max-w-none">
              <MarkdownRenderer content={content!} />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-slate-600">暂无该游戏的玩法解析内容。</p>
              <p className="text-slate-500 text-sm">
                您可以申请玩法解析，我们会优先整理并更新到本站。
              </p>
              {requestSent ? (
                <p className="text-green-600 font-medium">已收到您的申请，我们会尽快处理。</p>
              ) : apiUnavailable ? (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
                  <p className="text-amber-800 font-medium">当前环境无法在线提交（未连接后端）</p>
                  <p className="text-amber-700">
                    本地开发请同时运行：<code className="rounded bg-amber-100 px-1">node server/server.js</code>
                    ；若为静态部署，请用下方「复制内容」发给管理员。
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={copyFallback}
                      className="inline-flex items-center px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"
                    >
                      复制申请内容
                    </button>
                    <button
                      type="button"
                      onClick={() => { setApiUnavailable(false); }}
                      className="inline-flex items-center px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-100"
                    >
                      重试提交
                    </button>
                  </div>
                  <p className="text-amber-600 font-mono text-xs break-all">{fallbackText}</p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleRequestGameplay}
                  disabled={requesting}
                  className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {requesting ? '提交中…' : '申请玩法解析'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GameplayDetailPage;
