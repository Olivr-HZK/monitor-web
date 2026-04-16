/**
 * 前后端分离部署时，前端请求后端的基地址（构建时通过 VITE_API_BASE_URL 注入）。
 * 不设置时为空字符串，表示与前端同源（或开发时代理到 localhost）。
 */
export function getApiBase(): string {
  const v = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL;
  const v2 = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE;
  const raw = (typeof v === 'string' ? v : '') || (typeof v2 === 'string' ? v2 : '');
  return raw ? String(raw).replace(/\/$/, '') : '';
}

/** 拼出完整 API 地址，path 如 '/api/me' 或 'api/ai/chat' */
export function getApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBase().trim();
  if (base) return `${base.replace(/\/$/, '')}${p}`;
  // 开发模式保持以站点根开头的 /api/...，以便 Vite server.proxy 命中 /api。
  // 生产构建且走同源相对 API 时拼上 Vite base（如 GitHub Pages 的 /monitor-web/），
  // 避免误请求 https://host/api/me 被其它网关当成「有后端」从而出现用户名+密码登录页。
  if (import.meta.env.PROD) {
    const viteBase = typeof import.meta.env.BASE_URL === 'string' ? import.meta.env.BASE_URL : '/';
    const basePrefix = viteBase.replace(/\/+$/, '');
    if (basePrefix) return `${basePrefix}${p}`;
  }
  return p;
}

/**
 * 拉取受 /api/data 保护的数据文件时的 fetch 选项。
 * 含 VITE_API_BASE_URL 拼出的绝对地址（https://api.../api/data/...），需带 Cookie 才能通过鉴权。
 */
export function fetchInitForDataUrl(url: string): RequestInit {
  return String(url || '').includes('/api/data/')
    ? { credentials: 'include' as RequestCredentials }
    : {};
}

/**
 * 解析后端 JSON 错误体（FastAPI 常用 `detail`，部分接口用 `error`）。
 */
export function parseApiErrorBody(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const o = data as Record<string, unknown>;
  if (typeof o.error === 'string' && o.error.trim()) return o.error.trim();
  if (typeof o.detail === 'string' && o.detail.trim()) return o.detail.trim();
  if (Array.isArray(o.detail)) {
    return o.detail
      .map((item) => {
        if (item && typeof item === 'object' && 'msg' in item) {
          return String((item as { msg?: unknown }).msg ?? '');
        }
        return String(item);
      })
      .filter(Boolean)
      .join('；');
  }
  return '';
}
