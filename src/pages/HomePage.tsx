import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import type { MonitorType } from '../types';

const HomePage = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const {
    monitorItems,
    weeklyReports,
    aiCreativeLibraryNewItems,
    aiCreativeLibraryHotItems,
    aiCreativeLibrarySurgeItems,
  } = useData();

  const homeStats = useMemo(() => {
    const byType = {
      ai热点监测: 0,
      热点趋势监测: 0,
      休闲游戏监测: 0,
      AI产品监测: 0,
    } as Record<MonitorType, number>;
    monitorItems.forEach((item) => {
      if (item.type in byType) {
        byType[item.type] += 1;
      }
    });
    return {
      totalItems: monitorItems.length,
      weeklyReports: weeklyReports.length,
      aiProductRankings:
        aiCreativeLibraryNewItems.length +
        aiCreativeLibraryHotItems.length +
        aiCreativeLibrarySurgeItems.length,
      byType,
    };
  }, [monitorItems, weeklyReports, aiCreativeLibraryNewItems, aiCreativeLibraryHotItems, aiCreativeLibrarySurgeItems]);

  const handleTypeSelect = (type: MonitorType | '全部') => {
    if (type === '全部') {
      navigate('/');
      return;
    }
    navigate(`/type/${encodeURIComponent(type)}`);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header selectedType="全部" onTypeSelect={handleTypeSelect} user={user} onLogout={logout} />
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        <div className="space-y-10">
          <div className="rounded-3xl border border-slate-200 bg-white p-8 md:p-10 shadow-sm">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 text-xs font-semibold text-blue-600">
                  实时监测中心
                </div>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
                  监测汇总 · 前沿趋势看板
                </h1>
                <p className="max-w-2xl text-sm md:text-base text-slate-600">
                  聚合 AI 热点、趋势监测、休闲游戏与 AI 产品情报。快速进入对应监测，掌握每日关键变化。
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm text-slate-600">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase text-slate-400">监测类型</div>
                  <div className="mt-2 text-2xl font-semibold text-blue-600">4</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase text-slate-400">监测条目</div>
                  <div className="mt-2 text-2xl font-semibold text-emerald-600">
                    {homeStats.totalItems.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase text-slate-400">周报数量</div>
                  <div className="mt-2 text-2xl font-semibold text-violet-600">
                    {homeStats.weeklyReports.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase text-slate-400">AI 素材榜</div>
                  <div className="mt-2 text-2xl font-semibold text-amber-600">
                    {homeStats.aiProductRankings.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                type: 'ai热点监测' as const,
                title: 'AI 热点',
                description: '跟踪 AI 领域热点事件、投融资与行业动态。',
                accent: 'from-blue-500/10 via-blue-400/5 to-transparent',
                glow: 'shadow-sm',
                value: homeStats.byType.ai热点监测,
                icon: '🤖',
              },
              {
                type: '热点趋势监测' as const,
                title: '趋势监测',
                description: '追踪行业趋势、关键话题及传播走势。',
                accent: 'from-violet-500/10 via-fuchsia-400/5 to-transparent',
                glow: 'shadow-sm',
                value: homeStats.byType.热点趋势监测,
                icon: '📈',
              },
              {
                type: '休闲游戏监测' as const,
                title: '休闲游戏',
                description: '聚焦排行榜、新游戏与玩法拆解，洞察竞品动向。',
                accent: 'from-emerald-500/10 via-green-400/5 to-transparent',
                glow: 'shadow-sm',
                value: homeStats.byType.休闲游戏监测,
                icon: '🎮',
              },
              {
                type: 'AI产品监测' as const,
                title: 'AI 产品',
                description: '汇总产品周报、UA 素材与素材库榜单。',
                accent: 'from-amber-500/10 via-orange-400/5 to-transparent',
                glow: 'shadow-sm',
                value: homeStats.byType.AI产品监测,
                icon: '✨',
              },
            ].map((card) => (
              <button
                key={card.type}
                type="button"
                onClick={() => handleTypeSelect(card.type)}
                className={`group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 text-left transition-all hover:-translate-y-1 hover:border-slate-300 ${card.glow}`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${card.accent} opacity-0 transition-opacity group-hover:opacity-100`} />
                <div className="relative z-10 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl">{card.icon}</span>
                    <span className="text-xs text-slate-400">进入监测 →</span>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>
                    <p className="mt-2 text-sm text-slate-600">{card.description}</p>
                  </div>
                  <div className="flex items-end justify-between">
                    <div className="text-xs text-slate-400">当前条目</div>
                    <div className="text-2xl font-semibold text-slate-900">
                      {card.value.toLocaleString()}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default HomePage;
