/**
 * 登录页：后端模式为用户名+密码；静态模式为单「访问密码」
 */
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login, loginStatic, staticPasswordRequired } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const result = staticPasswordRequired
      ? await loginStatic(password)
      : await login(username.trim(), password);
    setSubmitting(false);
    if (result.ok) return;
    setError(result.error || '登录失败');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-sm rounded-lg bg-white shadow p-6">
        <h1 className="text-xl font-semibold text-gray-800 mb-6 text-center">监测汇总平台</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!staticPasswordRequired && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="请输入用户名"
                autoComplete="username"
                required
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {staticPasswordRequired ? '访问密码' : '密码'}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder={staticPasswordRequired ? '请输入访问密码' : '请输入密码'}
              autoComplete={staticPasswordRequired ? 'current-password' : 'current-password'}
              required
            />
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white py-2 rounded font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '验证中…' : staticPasswordRequired ? '进入' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
