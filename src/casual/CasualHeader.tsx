import type { FC } from 'react';

interface CasualHeaderProps {
  user?: string | null;
  onLogout?: () => void;
}

const CasualHeader: FC<CasualHeaderProps> = ({ user, onLogout }) => {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-2">
              <span className="text-xl">🎮</span>
              <span className="font-bold text-lg text-slate-900">休闲游戏检测</span>
            </div>
          </div>
          <div className="flex items-center space-x-3">
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

export default CasualHeader;

