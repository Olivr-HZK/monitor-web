import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { useAiPageContext } from '../context/AiPageContext';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import type { MonitorType } from '../types';

const HomePage = () => {
  const navigate = useNavigate();
  const { setPageMeta } = useAiPageContext();
  const { user, logout } = useAuth();
  const {
    monitorItems,
    weeklyReports,
    aiCreativeLibraryNewItems,
    aiCreativeLibraryHotItems,
    aiCreativeLibrarySurgeItems,
  } = useData();

  useEffect(() => {
    setPageMeta({ pageKind: 'home', pageTitle: '监测汇总首页' });
  }, [setPageMeta]);

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
    <div className="min-h-screen bg-surface text-ink font-sans">
      <Header selectedType="全部" onTypeSelect={handleTypeSelect} user={user} onLogout={logout} />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-8">
          {/* Hero Section */}
          <section className="relative overflow-hidden rounded-2xl border border-line bg-panel p-6 shadow-brutal opacity-0 animate-fade-in-up stagger-1 md:p-8">
            <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
              <div className="max-w-2xl space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-inkLight">
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                  实时监测工作台
                </div>
                <h1 className="max-w-xl text-3xl font-semibold tracking-tight text-ink md:text-4xl">
                  关键趋势，一屏进入。
                </h1>
                <p className="max-w-xl text-sm leading-6 text-inkLight md:text-base">
                  聚合 AI 热点、趋势监测、休闲游戏与 AI 产品情报。快速进入对应监测，掌握每日关键变化。
                </p>
              </div>
              <div className="grid w-full grid-cols-2 gap-3 text-sm md:w-[360px]">
                <div className="rounded-xl border border-line bg-surface p-4">
                  <div className="text-xs font-medium text-muted">监测类型</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">4</div>
                </div>
                <div className="rounded-xl border border-line bg-surface p-4">
                  <div className="text-xs font-medium text-muted">监测条目</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                    {homeStats.totalItems.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-line bg-surface p-4">
                  <div className="text-xs font-medium text-muted">周报数量</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                    {homeStats.weeklyReports.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-line bg-surface p-4">
                  <div className="text-xs font-medium text-muted">AI 素材榜</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                    {homeStats.aiProductRankings.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                type: 'ai热点监测' as const,
                title: 'AI 热点',
                eng: 'AI',
                description: '跟踪 AI 领域热点事件、投融资与行业动态。',
                value: homeStats.byType.ai热点监测,
                icon: 'AI',
                delay: 'stagger-2',
              },
              {
                type: '热点趋势监测' as const,
                title: '趋势监测',
                eng: 'TR',
                description: '追踪行业趋势、关键话题及传播走势。',
                value: homeStats.byType.热点趋势监测,
                icon: 'TR',
                delay: 'stagger-3',
              },
              {
                type: '休闲游戏监测' as const,
                title: '休闲游戏',
                eng: 'GM',
                description: '聚焦排行榜、新游戏与玩法拆解，洞察竞品动向。',
                value: homeStats.byType.休闲游戏监测,
                icon: 'GM',
                delay: 'stagger-4',
              },
              {
                type: 'AI产品监测' as const,
                title: 'AI 产品',
                eng: 'PD',
                description: '汇总产品周报、UA 素材与素材库榜单。',
                value: homeStats.byType.AI产品监测,
                icon: 'PD',
                delay: 'stagger-5',
              },
            ].map((card) => (
              <button
                key={card.type}
                type="button"
                onClick={() => handleTypeSelect(card.type)}
                className={`group relative flex min-h-56 flex-col justify-between rounded-2xl border border-line bg-panel p-5 text-left shadow-brutal-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-ink/25 hover:shadow-brutal opacity-0 animate-fade-in-up ${card.delay}`}
              >
                <div className="w-full space-y-5">
                  <div className="flex items-start justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-xs font-semibold text-ink">
                      {card.icon}
                    </span>
                    <span className="text-xs font-medium text-muted transition-colors group-hover:text-accent">
                      进入
                    </span>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted">{card.eng}</div>
                    <h2 className="text-xl font-semibold tracking-tight text-ink">{card.title}</h2>
                    <p className="mt-3 text-sm leading-6 text-inkLight">{card.description}</p>
                  </div>
                </div>
                <div className="mt-6 flex w-full items-end justify-between border-t border-line pt-4">
                  <div className="text-xs font-medium text-muted">当前条目</div>
                  <div className="text-2xl font-semibold tabular-nums text-ink transition-colors group-hover:text-accent">
                    {card.value.toLocaleString()}
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
