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
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="space-y-12">
          {/* Hero Section */}
          <div className="relative overflow-hidden bg-white border-2 border-ink shadow-brutal p-8 md:p-12 opacity-0 animate-fade-in-up stagger-1">
            <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between relative z-10">
              <div className="space-y-6 max-w-2xl">
                <div className="inline-flex items-center gap-2 border-2 border-ink bg-accent text-white px-3 py-1 text-xs font-bold uppercase tracking-widest">
                  <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                  实时监测中心
                </div>
                <h1 className="text-4xl md:text-6xl font-display font-extrabold tracking-tight text-ink uppercase leading-none">
                  前沿 <br/> <span className="text-transparent" style={{ WebkitTextStroke: '2px #111110' }}>趋势看板</span>
                </h1>
                <p className="text-base md:text-lg text-inkLight font-medium">
                  聚合 AI 热点、趋势监测、休闲游戏与 AI 产品情报。快速进入对应监测，掌握每日关键变化。
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="border-2 border-ink bg-surface p-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-inkLight">监测类型</div>
                  <div className="mt-1 text-3xl font-display font-bold text-ink">4</div>
                </div>
                <div className="border-2 border-ink bg-surface p-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-inkLight">监测条目</div>
                  <div className="mt-1 text-3xl font-display font-bold text-ink">
                    {homeStats.totalItems.toLocaleString()}
                  </div>
                </div>
                <div className="border-2 border-ink bg-surface p-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-inkLight">周报数量</div>
                  <div className="mt-1 text-3xl font-display font-bold text-ink">
                    {homeStats.weeklyReports.toLocaleString()}
                  </div>
                </div>
                <div className="border-2 border-ink bg-surface p-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-inkLight">AI 素材榜</div>
                  <div className="mt-1 text-3xl font-display font-bold text-ink">
                    {homeStats.aiProductRankings.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
            {/* Decorative background element */}
            <div className="absolute -right-20 -bottom-20 opacity-5 pointer-events-none">
              <svg width="400" height="400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 22h20L12 2zm0 4l7.5 15h-15L12 6z"/>
              </svg>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                type: 'ai热点监测' as const,
                title: 'AI 热点',
                eng: 'AI 热点',
                description: '跟踪 AI 领域热点事件、投融资与行业动态。',
                value: homeStats.byType.ai热点监测,
                icon: '🤖',
                delay: 'stagger-2',
              },
              {
                type: '热点趋势监测' as const,
                title: '趋势监测',
                eng: '趋势监测',
                description: '追踪行业趋势、关键话题及传播走势。',
                value: homeStats.byType.热点趋势监测,
                icon: '📈',
                delay: 'stagger-3',
              },
              {
                type: '休闲游戏监测' as const,
                title: '休闲游戏',
                eng: '休闲游戏',
                description: '聚焦排行榜、新游戏与玩法拆解，洞察竞品动向。',
                value: homeStats.byType.休闲游戏监测,
                icon: '🎮',
                delay: 'stagger-4',
              },
              {
                type: 'AI产品监测' as const,
                title: 'AI 产品',
                eng: 'AI 产品',
                description: '汇总产品周报、UA 素材与素材库榜单。',
                value: homeStats.byType.AI产品监测,
                icon: '✨',
                delay: 'stagger-5',
              },
            ].map((card) => (
              <button
                key={card.type}
                type="button"
                onClick={() => handleTypeSelect(card.type)}
                className={`group relative flex flex-col justify-between bg-white border-2 border-ink p-6 text-left transition-all duration-300 hover:-translate-y-2 hover:-translate-x-2 hover:shadow-brutal-hover opacity-0 animate-fade-in-up ${card.delay}`}
              >
                <div className="w-full space-y-6">
                  <div className="flex items-start justify-between border-b-2 border-ink/10 pb-4">
                    <span className="text-3xl grayscale group-hover:grayscale-0 transition-all duration-300">{card.icon}</span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-inkLight group-hover:text-accent transition-colors">
                      进入 →
                    </span>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-inkLight tracking-widest mb-1">{card.eng}</div>
                    <h2 className="text-2xl font-display font-bold text-ink uppercase tracking-tight">{card.title}</h2>
                    <p className="mt-3 text-sm text-inkLight font-medium leading-relaxed">{card.description}</p>
                  </div>
                </div>
                <div className="w-full flex items-end justify-between pt-6 mt-6 border-t-2 border-ink/10">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-inkLight">当前条目</div>
                  <div className="text-3xl font-display font-bold text-ink group-hover:text-accentBlue transition-colors">
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
