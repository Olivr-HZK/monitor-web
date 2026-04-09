/**
 * 登录鉴权：检测是否启用后端、当前用户，提供登录/登出
 * 静态模式访问密码：优先从 public/auth-config.json 的 staticPasswordHash 读取，否则用构建时 VITE_STATIC_PASSWORD_HASH
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getApiBase, getApiUrl } from '../utils/api';

const STATIC_AUTH_KEY = 'static-auth';
const AUTH_CONFIG_URL = 'auth-config.json';

/** 构建时注入的哈希（.env 中 VITE_STATIC_PASSWORD_HASH） */
const buildTimeHash = typeof import.meta !== 'undefined' && import.meta.env?.VITE_STATIC_PASSWORD_HASH
  ? String(import.meta.env.VITE_STATIC_PASSWORD_HASH).trim()
  : '';

/** 浏览器内用 Web Crypto 计算 SHA-256 十六进制 */
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type AuthMode = 'static' | 'backend';

type AuthState = {
  authMode: AuthMode;
  user: string | null;
  loading: boolean;
  /** 静态模式下是否需要输入访问密码 */
  staticPasswordRequired: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  loginStatic: (password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  getDataUrl: (filename: string) => string;
};

const AuthContext = createContext<AuthState | null>(null);

/** 从 public/auth-config.json 读取 staticPasswordHash，没有则用构建时哈希 */
async function resolveStaticHash(): Promise<string> {
  try {
    const res = await fetch(AUTH_CONFIG_URL, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      const fromConfig = data?.staticPasswordHash;
      if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();
    }
  } catch {
    // ignore
  }
  return buildTimeHash;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authMode, setAuthMode] = useState<AuthMode>('static');
  const [user, setUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** 静态模式下的访问密码哈希（来自 auth-config.json 或构建时 env） */
  const [staticHash, setStaticHash] = useState('');

  // 静态模式（无后端 / 托管页）：直接请求静态资源路径；后端模式用可配置的 API 基地址
  const getDataUrl = useCallback((filename: string) => {
    const base = typeof import.meta.env.BASE_URL === 'string' && import.meta.env.BASE_URL
      ? import.meta.env.BASE_URL.replace(/\/$/, '')
      : '';
    if (authMode === 'static') {
      const path = filename.split('/').map(encodeURIComponent).join('/');
      return base ? `${base}/${path}` : `/${path}`;
    }
    return getApiUrl(`/api/data/${encodeURIComponent(filename)}`);
  }, [authMode]);

  const checkAuth = useCallback(async () => {
    setLoading(true);
    /** 已配置 VITE_API_BASE_URL 时，始终走后端登录页，不因网络/CORS 失败而退回「访问密码」静态门 */
    const configuredBackend = Boolean(getApiBase().trim());
    try {
      const res = await fetch(getApiUrl('/api/me'), { credentials: 'include' });
      // 只有在 /api/me 正常响应（200 或 401）时，才认为「有后端」
      // 其它状态（404/5xx 等）：未配置远程后端时退回静态；已配置则仍保持后端模式以便显示用户名+密码
      if (!(res.ok || res.status === 401)) {
        if (configuredBackend) {
          setAuthMode('backend');
          setUser(null);
          setStaticHash('');
        } else {
          setAuthMode('static');
          const hash = await resolveStaticHash();
          setStaticHash(hash);
          if (hash) {
            const stored = sessionStorage.getItem(STATIC_AUTH_KEY);
            setUser(stored === hash ? '用户' : null);
          } else {
            setUser('用户');
          }
        }
        return;
      }
      setAuthMode('backend');
      if (res.status === 401) {
        setUser(null);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setUser(data.user ?? null);
      } else {
        setUser(null);
      }
    } catch {
      if (configuredBackend) {
        setAuthMode('backend');
        setUser(null);
        setStaticHash('');
      } else {
        setAuthMode('static');
        const hash = await resolveStaticHash();
        setStaticHash(hash);
        if (hash) {
          const stored = sessionStorage.getItem(STATIC_AUTH_KEY);
          setUser(stored === hash ? '用户' : null);
        } else {
          setUser('用户');
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch(getApiUrl('/api/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { ok: false, error: data.error || '登录失败' };
        }
        setUser(data.user ?? username);
        return { ok: true };
      } catch (e) {
        const base = getApiBase().trim();
        if (base) {
          const isLocal =
            typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
          const pageOrigin = typeof window !== 'undefined' ? window.location.origin : '';
          return {
            ok: false,
            error: isLocal
              ? '无法连接后端（多为跨域拦截）。本地请在 .env.development 不要设置 VITE_API_BASE_URL，用 VITE_DEV_API_PROXY=你的 API 地址走 Vite 代理；或在后端 CORS_ORIGIN 中加入 http://localhost:5173（不要用 *）。'
              : `无法连接后端（多为跨域拦截）。当前是静态页跨域访问 API：请在 API 服务器环境变量 CORS_ORIGIN 中加入「${pageOrigin}」（多个来源用英文逗号分隔；带 Cookie 时不要使用 *）。改完重启后端。若仍失败，以浏览器 Network 里请求头的 Origin 为准核对是否完全一致（含大小写）。`,
          };
        }
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg ? `网络错误：${msg}` : '网络错误' };
      }
    },
    []
  );

  const loginStatic = useCallback(
    async (password: string): Promise<{ ok: boolean; error?: string }> => {
      if (!staticHash) return { ok: false, error: '未配置静态密码' };
      const hash = await sha256Hex(password);
      if (hash !== staticHash) {
        return { ok: false, error: '密码错误' };
      }
      sessionStorage.setItem(STATIC_AUTH_KEY, staticHash);
      setUser('用户');
      return { ok: true };
    },
    [staticHash]
  );

  const logout = useCallback(async () => {
    if (authMode === 'static' && staticHash) {
      sessionStorage.removeItem(STATIC_AUTH_KEY);
      setUser(null);
      return;
    }
    try {
      await fetch(getApiUrl('/api/logout'), { method: 'POST', credentials: 'include' });
    } finally {
      setUser(null);
    }
  }, [authMode, staticHash]);

  const value: AuthState = {
    authMode,
    user,
    loading,
    staticPasswordRequired: authMode === 'static' && staticHash.length > 0,
    login,
    loginStatic,
    logout,
    getDataUrl,
  };

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
