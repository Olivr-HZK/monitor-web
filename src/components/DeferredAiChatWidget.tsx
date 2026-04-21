import { lazy, Suspense, useEffect, useState } from 'react';

const AiChatWidget = lazy(() => import('./AiChatWidget'));

/**
 * 首屏不拉取/解析 ~600KB 的 AI 模块，减轻 Safari 等对大包解析更慢的浏览器压力；
 * 在空闲或超时后再加载，避免与鉴权、数据请求抢带宽与主线程。
 */
export function DeferredAiChatWidget() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(() => setReady(true), { timeout: 2000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setReady(true), 300);
    return () => clearTimeout(t);
  }, []);
  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <AiChatWidget />
    </Suspense>
  );
}
