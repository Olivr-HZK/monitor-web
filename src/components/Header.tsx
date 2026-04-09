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
    <header className="sticky top-0 z-50 border-b-2 border-ink bg-surface/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => onTypeSelect?.('全部')}>
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center bg-ink text-surface transition-transform group-hover:-rotate-3"
              aria-hidden
            >
              <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14M8 19v-8m4 8v-5m4 5v-3" strokeLinecap="square" />
              </svg>
            </div>
            <span className="text-xl font-display font-bold tracking-tight text-ink uppercase">监测汇总<span className="text-accent">.</span></span>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center space-x-2">
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => onTypeSelect?.(item.type as MonitorType | '全部')}
                className={`px-4 py-1.5 text-sm font-bold transition-all border-2 rounded-none ${
                  item.active
                    ? 'text-surface bg-ink border-ink shadow-brutal-sm translate-x-[-2px] translate-y-[-2px]'
                    : 'text-inkLight border-transparent hover:text-ink hover:border-ink/20'
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
                <span className="text-sm font-semibold text-inkLight font-display">{user}</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="px-3 py-1 text-xs font-bold uppercase tracking-wider text-ink border-2 border-ink hover:bg-ink hover:text-surface transition-colors"
                >
                  退出
                </button>
              </div>
            ) : (
              <span className="px-4 py-2 text-sm font-bold text-inkLight">未登录</span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
