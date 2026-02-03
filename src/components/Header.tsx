import { useState } from 'react';

import type { MonitorType } from '../types';

interface HeaderProps {
  selectedType?: MonitorType | '全部';
  onTypeSelect?: (type: MonitorType | '全部') => void;
  /** 后端登录时显示用户名与退出 */
  user?: string | null;
  onLogout?: () => void;
}

const Header = ({ selectedType, onTypeSelect, user, onLogout }: HeaderProps) => {
  const [isDarkMode, setIsDarkMode] = useState(false);

  const navItems = [
    { label: '监测汇总', type: '全部', active: selectedType === '全部' },
    { label: 'AI热点', type: 'ai热点检测', active: selectedType === 'ai热点检测' },
    { label: '趋势检测', type: '热点趋势检测', active: selectedType === '热点趋势检测' },
    { label: '休闲游戏检测', type: '休闲游戏检测', active: selectedType === '休闲游戏检测' },
  ];

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-2 bg-blue-50 px-4 py-2 rounded-full">
              <span className="text-xl">📊</span>
              <span className="font-bold text-lg text-gray-900">监测汇总平台</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => onTypeSelect?.(item.type as MonitorType | '全部')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  item.active
                    ? 'text-gray-900 font-semibold border-b-2 border-blue-500'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right side actions */}
          <div className="flex items-center space-x-4">
            {/* Search */}
            <div className="hidden sm:flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-2">
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                placeholder="搜索监测内容..."
                className="bg-transparent border-none outline-none text-sm text-gray-600 placeholder-gray-400 w-32"
              />
              <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">K</span>
            </div>

            {/* Notifications */}
            <button className="p-2 text-gray-600 hover:text-gray-900 transition-colors relative">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
              </svg>
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>

            {/* Dark mode toggle */}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              {isDarkMode ? (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              ) : (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              )}
            </button>

            {/* User / Logout */}
            {user && onLogout ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">{user}</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded hover:bg-gray-50"
                >
                  退出
                </button>
              </div>
            ) : (
              <span className="px-4 py-2 text-sm text-gray-500">登录</span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
