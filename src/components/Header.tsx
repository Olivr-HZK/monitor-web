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
    {
      label: '休闲游戏监测',
      type: '休闲游戏监测',
      active: selectedType === '休闲游戏监测' || selectedType === '竞品社媒监控',
    },
    { label: 'AI产品监测', type: 'AI产品监测', active: selectedType === 'AI产品监测' },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/95 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => onTypeSelect?.('全部')}>
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-ink shadow-brutal-sm transition-colors group-hover:border-ink/30"
              aria-hidden
            >
              <svg className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14M8 19v-8m4 8v-5m4 5v-3" strokeLinecap="round" />
              </svg>
            </div>
            <span className="text-[15px] font-semibold tracking-tight text-ink">监测汇总</span>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center rounded-xl border border-line bg-panel/80 p-1 shadow-brutal-sm">
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => onTypeSelect?.(item.type as MonitorType | '全部')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  item.active
                    ? 'bg-ink text-white shadow-brutal-sm'
                    : 'text-inkLight hover:bg-surfaceHover hover:text-ink'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right side actions */}
          <div className="flex items-center space-x-4">
            {/* User / Logout */}
            {user && onLogout ? (
              <div className="flex items-center gap-3">
                <span className="max-w-28 truncate text-sm font-medium text-inkLight">{user}</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-inkLight transition-colors hover:border-ink/20 hover:bg-surfaceHover hover:text-ink"
                >
                  退出
                </button>
              </div>
            ) : (
              <span className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted">未登录</span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
