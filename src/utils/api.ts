/** 跨域 API 时 Safari 等可能不发送第三方 Cookie；登录响应中的 JWT 存于此键，用 Authorization 补鉴权 */
const API_JWT_STORAGE_KEY = 'mw_api_jwt';

export function getStoredApiToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const t = sessionStorage.getItem(API_JWT_STORAGE_KEY);
    return t && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

export function setStoredApiToken(token: string | null): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (token && token.trim()) sessionStorage.setItem(API_JWT_STORAGE_KEY, token.trim());
    else sessionStorage.removeItem(API_JWT_STORAGE_KEY);
  } catch {
    /* private mode 等 */
  }
}

/** 已配置独立 API 根地址时，为请求附加 Bearer（与 Cookie 二选一或并存，后端均认可） */
export function apiAuthHeaders(): Record<string, string> {
  if (!getApiBase().trim()) return {};
  const t = getStoredApiToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** 合并鉴权头与 credentials，供 fetch 使用 */
export function withApiAuth(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers ?? {});
  const auth = apiAuthHeaders();
  for (const [k, v] of Object.entries(auth)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return {
    ...init,
    credentials: init.credentials ?? ('include' as RequestCredentials),
    headers,
  };
}

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
 * 含 VITE_API_BASE_URL 拼出的绝对地址时需 credentials；Safari 跨站 Cookie 不可靠时依赖 sessionStorage JWT（见 withApiAuth）。
 */
export function fetchInitForDataUrl(url: string): RequestInit {
  if (!String(url || '').includes('/api/data/')) return {};
  return withApiAuth({});
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
