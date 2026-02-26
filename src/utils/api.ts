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
  const base = getApiBase();
  return base ? `${base}${p}` : p;
}
