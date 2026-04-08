import type { MonitorType } from '../types';

interface HeaderProps {
  selectedType?: MonitorType | '全部';
  onTypeSelect?: (type: MonitorType | '全部') => void;
  /** 后端登录时显示用户名与退出 */
  user?: string | null;
  onLogout?: () => void;
}

const Header = ({ selectedType, onTypeSelect, user, onLogout }: HeaderProps) => {
  const navItems = [
    { label: '监测汇总', type: '全部', active: selectedType === '全部' },
    { label: 'AI热点', type: 'ai热点监测', active: selectedType === 'ai热点监测' },
    { label: '趋势监测', type: '热点趋势监测', active: selectedType === '热点趋势监测' },
    { label: '休闲游戏监测', type: '休闲游戏监测', active: selectedType === '休闲游戏监测' },
    { label: 'AI产品监测', type: 'AI产品监测', active: selectedType === 'AI产品监测' },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-950 text-white shadow-sm ring-1 ring-slate-900/10"
              aria-hidden
            >
              <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight text-slate-900">监测汇总</span>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => onTypeSelect?.(item.type as MonitorType | '全部')}
                className={`px-4 py-2 text-sm font-medium transition-colors rounded-full ${
                  item.active
                    ? 'text-slate-900 bg-blue-100 border border-blue-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right side actions */}
          <div className="flex items-center space-x-3">
            {/* User / Logout */}
            {user && onLogout ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">{user}</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded hover:bg-slate-100"
                >
                  退出
                </button>
              </div>
            ) : (
              <span className="px-4 py-2 text-sm text-slate-400">登录</span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
