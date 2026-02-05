/**
 * 登录鉴权：检测是否启用后端、当前用户，提供登录/登出
 * 静态模式访问密码：优先从 public/auth-config.json 的 staticPasswordHash 读取，否则用构建时 VITE_STATIC_PASSWORD_HASH
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

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

  const getDataUrl = useCallback((filename: string) => {
    const base = typeof import.meta.env.BASE_URL === 'string' && import.meta.env.BASE_URL
      ? import.meta.env.BASE_URL.replace(/\/$/, '')
      : '';
    const prefix = base ? `${base}/api/data` : '/api/data';
    return `${prefix}/${encodeURIComponent(filename)}`;
  }, []);

  const checkAuth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      // 404：明确没有后端；在本地开发时，通过 Vite 代理 /api 且后端未启动通常会返回 502，这里也视为“无后端”
      if (res.status === 404 || res.status === 502) {
        setAuthMode('static');
        const hash = await resolveStaticHash();
        setStaticHash(hash);
        if (hash) {
          const stored = sessionStorage.getItem(STATIC_AUTH_KEY);
          setUser(stored === hash ? '用户' : null);
        } else {
          setUser('用户');
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
      setAuthMode('static');
      const hash = await resolveStaticHash();
      setStaticHash(hash);
      if (hash) {
        const stored = sessionStorage.getItem(STATIC_AUTH_KEY);
        setUser(stored === hash ? '用户' : null);
      } else {
        setUser('用户');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(
    async (username: string, password: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch('/api/login', {
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
        return { ok: false, error: '网络错误' };
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
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
