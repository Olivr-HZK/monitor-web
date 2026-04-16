import { useState } from 'react';
import type { MonitorSource, MonitorType } from '../types';
import type {
  GamePlatformKey,
  CasualGameMainCategory,
  CasualGameCompetitorSub,
  CasualGameOurProductSub,
  AiProductSubCategory,
} from '../types';

interface SidebarProps {
  sources: MonitorSource[];
  selectedType?: MonitorType | '全部';
  onTypeSelect?: (type: MonitorType | '全部') => void;
  companies?: string[]; // 竞品公司列表
  selectedCompany?: string | null;
  onCompanySelect?: (company: string | null) => void;
  /** 休闲游戏监测：选中的大类（新游戏/新玩法/竞品） */
  selectedCasualGameCategory?: CasualGameMainCategory | null;
  onCasualGameCategorySelect?: (category: CasualGameMainCategory | null) => void;
  /** 休闲游戏监测-新游戏：选中的平台 */
  selectedGamePlatform?: GamePlatformKey | null;
  onGamePlatformSelect?: (platform: GamePlatformKey | null) => void;
  /** 休闲游戏监测-竞品动态：选中的小类（社媒监控/UA素材） */
  selectedCasualGameCompetitorSub?: CasualGameCompetitorSub | null;
  onCasualGameCompetitorSubSelect?: (sub: CasualGameCompetitorSub | null) => void;
  /** AI产品监测：选中的子类（排行榜/产品周报/UA素材） */
  selectedAiProductSub?: AiProductSubCategory | null;
  onAiProductSubSelect?: (sub: AiProductSubCategory | null) => void;
  /** 休闲游戏监测：当前选中的数据块（微信/抖音 与 SensorTower 隔离） */
  selectedCasualSourceSection?: 'wechat_douyin' | 'sensortower';
  onCasualSourceSectionSelect?: (section: 'wechat_douyin' | 'sensortower') => void;
  /** 我方产品：US 免费榜日总结 / 按产品追溯（占位） */
  selectedCasualOurProductSub?: CasualGameOurProductSub | null;
  onCasualOurProductSubSelect?: (sub: CasualGameOurProductSub) => void;
  /** 控制在侧边栏中展示哪些监测类型（默认展示全部） */
  visibleTypes?: (MonitorType | '全部')[];
  /** 是否显示最上方的「全部」按钮（默认显示） */
  showAllTypeButton?: boolean;
  /** 控制 AI 产品监测下可选的子类（默认全部） */
  aiProductVisibleSubs?: AiProductSubCategory[];
}

const Sidebar = ({
  sources,
  selectedType = '全部',
  onTypeSelect,
  companies: _companies = [],
  selectedCompany: _selectedCompany,
  onCompanySelect: _onCompanySelect,
  selectedCasualGameCategory,
  onCasualGameCategorySelect,
  selectedGamePlatform: _selectedGamePlatform,
  onGamePlatformSelect: _onGamePlatformSelect,
  selectedCasualGameCompetitorSub,
  onCasualGameCompetitorSubSelect,
  selectedAiProductSub,
  onAiProductSubSelect,
  selectedCasualSourceSection: propCasualSourceSection,
  onCasualSourceSectionSelect,
  selectedCasualOurProductSub,
  onCasualOurProductSubSelect,
  visibleTypes,
  showAllTypeButton = true,
  aiProductVisibleSubs,
}: SidebarProps) => {
  const [internalCasualSourceSection, setInternalCasualSourceSection] = useState<'wechat_douyin' | 'sensortower'>('sensortower');
  const activeCasualSourceSection = propCasualSourceSection ?? internalCasualSourceSection;
  const setActiveCasualSourceSection = (s: 'wechat_douyin' | 'sensortower') => {
    onCasualSourceSectionSelect?.(s);
    if (propCasualSourceSection === undefined) setInternalCasualSourceSection(s);
  };
  const typeGroups: Record<MonitorType | '全部', MonitorSource[]> = {
    '全部': [],
    'ai热点监测': [],
    '热点趋势监测': [],
    '竞品社媒监控': [],
    '休闲游戏监测': [],
    'AI产品监测': [],
  };

  // 按类型分组
  sources.forEach(source => {
    if (typeGroups[source.type]) {
      typeGroups[source.type].push(source);
    }
  });

  const getTypeLabel = (type: MonitorType | '全部') => {
    if (type === '全部') return '全部监测源';
    return type;
  };

  const getTypeIcon = (type: MonitorType | '全部') => {
    switch (type) {
      case 'ai热点监测':
        return '🤖';
      case '热点趋势监测':
        return '📈';
      case '竞品社媒监控':
        return '📱';
      case '休闲游戏监测':
        return '🎮';
      case 'AI产品监测':
        return '✨';
      default:
        return '📊';
    }
  };

  return (
    <aside className="w-64 flex-shrink-0">
      <div className="sticky top-20 max-h-[calc(100vh-5.5rem)] overflow-y-auto overscroll-y-contain border-2 border-ink bg-white p-4 shadow-brutal-sm [scrollbar-gutter:stable]">
        <h2 className="text-sm font-display font-bold uppercase tracking-widest text-inkLight mb-4 border-b-2 border-ink/10 pb-2">监测源</h2>

        {/* All option */}
        {showAllTypeButton && (
          <div className="mb-4">
            <button
              onClick={() => onTypeSelect?.('全部')}
              className={`w-full flex items-center gap-3 px-3 py-2 font-bold transition-all border-2 ${
                selectedType === '全部'
                  ? 'bg-ink text-surface border-ink shadow-brutal-sm translate-x-[-2px] translate-y-[-2px]'
                  : 'text-inkLight border-transparent hover:border-ink/20 hover:text-ink'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="square" strokeLinejoin="miter" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span className="uppercase tracking-widest text-xs">全部</span>
            </button>
          </div>
        )}

        {/* 监测类型：AI热点、热点趋势、休闲游戏、AI产品监测 并列 */}
        <div className="space-y-4">
          {(visibleTypes ?? (['ai热点监测', '热点趋势监测', '休闲游戏监测', 'AI产品监测'] as MonitorType[]))
            .filter((t): t is MonitorType => t !== '全部')
            .map((type) => {
            const groupSources = typeGroups[type];
            // AI热点监测和热点趋势监测始终显示，即使没有 sources
            if (
              groupSources.length === 0 &&
              type !== '休闲游戏监测' &&
              type !== 'AI产品监测' &&
              type !== 'ai热点监测' &&
              type !== '热点趋势监测'
            )
              return null;

            // 休闲游戏监测：右侧分为两个大块（SensorTower & 微信/抖音），每个下面为 周报简要（玩法拆解已移除）
            // 另外保留「竞品监测」块（社媒监控 / UA素材）
            if (type === '休闲游戏监测') {
              const casualSourceSections: { id: 'wechat_douyin' | 'sensortower'; label: string; icon: string }[] = [
                { id: 'sensortower', label: 'SensorTower 榜单', icon: '📊' },
                { id: 'wechat_douyin', label: '微信 / 抖音小游戏', icon: '💬' },
              ];
              const baseCasualSubItems: { key: CasualGameMainCategory; label: string; icon: string }[] = [
                { key: '周报简要', label: '周报简要', icon: '📋' },
              ];
              const sensortowerOnlySubItems: { key: CasualGameMainCategory; label: string; icon: string }[] = [
                { key: '商店页变化', label: '商店页变化', icon: '🧾' },
              ];
              const competitorSubItems: { key: CasualGameCompetitorSub; label: string; icon: string }[] = [
                { key: '社媒更新', label: '社媒监控', icon: '📱' },
                { key: 'UA素材', label: 'UA素材', icon: '🎬' },
              ];
              return (
                <div key={type} className="space-y-2">
                  <button
                    onClick={() => onTypeSelect?.(type)}
                    className={`w-full flex items-center gap-2 px-3 py-2 font-bold transition-all border-2 ${
                      selectedType === type || (type === '休闲游戏监测' && selectedType === '竞品社媒监控')
                        ? 'bg-ink text-surface border-ink shadow-brutal-sm translate-x-[-2px] translate-y-[-2px]'
                        : 'text-inkLight border-transparent hover:border-ink/20 hover:text-ink'
                    }`}
                  >
                    <span className="text-lg grayscale">{getTypeIcon(type)}</span>
                    <span className="uppercase tracking-widest text-xs">{getTypeLabel(type)}</span>
                  </button>

                  {(selectedType === type || (type === '休闲游戏监测' && selectedType === '竞品社媒监控')) && (
                    <div className="ml-4 space-y-3">
                      {/* 微信 / 抖音 & SensorTower 两个大块 */}
                      {casualSourceSections.map((section) => (
                        <div key={section.id} className="space-y-1">
                          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-inkLight mt-2">
                            <span className="w-5 h-5 border-2 border-ink/20 flex items-center justify-center flex-shrink-0 grayscale">
                              {section.icon}
                            </span>
                            <span>{section.label}</span>
                          </div>
                          <div className="ml-2 pl-2 border-l-2 border-ink/10 space-y-1">
                            {[
                              ...baseCasualSubItems,
                              ...(section.id === 'sensortower' ? sensortowerOnlySubItems : []),
                            ].map(({ key, label, icon }) => {
                              const isSelectedInCategory = selectedCasualGameCategory === key;
                              // UI 选中态需同时匹配当前大块，避免两个模块同时高亮
                              const isSelected = isSelectedInCategory && activeCasualSourceSection === section.id;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  className={`w-full flex items-center gap-2 p-1.5 font-bold transition-all border-2 text-left ${
                                    isSelected ? 'bg-ink text-surface border-ink translate-x-[-2px] translate-y-[-2px] shadow-brutal-sm' : 'text-inkLight border-transparent hover:border-ink/20 hover:text-ink'
                                  }`}
                                  onClick={() => {
                                    setActiveCasualSourceSection(section.id);
                                    onCasualGameCategorySelect?.(key);
                                  }}
                                >
                                  <span className="w-5 h-5 border-2 border-transparent flex items-center justify-center text-xs flex-shrink-0 grayscale">
                                    {icon}
                                  </span>
                                  <span className="flex-1 truncate text-xs uppercase tracking-wider">{label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {/* 竞品监测块：社媒监控 / UA素材 */}
                      <div className="space-y-1 pt-3 border-t-2 border-ink/10 mt-2">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-inkLight">
                          <span className="w-5 h-5 border-2 border-ink/20 flex items-center justify-center flex-shrink-0 grayscale">
                            📊
                          </span>
                          <span>竞品监测</span>
                        </div>
                        <div className="ml-2 pl-2 border-l-2 border-ink/10 space-y-1">
                          {competitorSubItems.map(({ key: subKey, label: subLabel, icon: subIcon }) => {
                            const isSubSelected =
                              selectedCasualGameCategory === '竞品' && selectedCasualGameCompetitorSub === subKey;
                            return (
                              <button
                                key={subKey}
                                type="button"
                                className={`w-full flex items-center gap-2 p-1.5 font-bold transition-all border-2 text-left ${
                                  isSubSelected ? 'bg-ink text-surface border-ink translate-x-[-2px] translate-y-[-2px] shadow-brutal-sm' : 'text-inkLight border-transparent hover:border-ink/20 hover:text-ink'
                                }`}
                                onClick={() => {
                                  onCasualGameCategorySelect?.('竞品');
                                  onCasualGameCompetitorSubSelect?.(subKey);
                                }}
                              >
                                <span className="w-5 h-5 border-2 border-transparent flex items-center justify-center text-xs flex-shrink-0 grayscale">
                                  {subIcon}
                                </span>
                                <span className="flex-1 truncate text-xs uppercase tracking-wider">{subLabel}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 我方产品检测：占位待开发 */}
                      <div
                        id="sidebar-casual-own-product"
                        className="space-y-1 pt-3 border-t-2 border-ink/10 mt-2"
                      >
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-inkLight">
                          <span className="w-5 h-5 border-2 border-ink/20 flex items-center justify-center flex-shrink-0 grayscale">
                            🏠
                          </span>
                          <span>我方产品检测</span>
                        </div>
                        <div className="ml-2 pl-2 border-l-2 border-ink/10 mt-1 space-y-1">
                          {(
                            [
                              { key: '日总结' as const, label: 'US 免费榜日总结', icon: '📌' },
                              { key: '按产品追溯' as const, label: '按产品追溯', icon: '📈' },
                            ] as const
                          ).map(({ key, label, icon }) => {
                            const activeSub = selectedCasualOurProductSub ?? '日总结';
                            const isSubSelected =
                              selectedCasualGameCategory === '我方产品' && activeSub === key;
                            return (
                              <button
                                key={key}
                                type="button"
                                className={`w-full flex items-center gap-2 p-1.5 font-bold transition-all border-2 text-left ${
                                  isSubSelected
                                    ? 'bg-ink text-surface border-ink translate-x-[-2px] translate-y-[-2px] shadow-brutal-sm'
                                    : 'text-inkLight border-transparent hover:border-ink/20 hover:text-ink'
                                }`}
                                onClick={() => {
                                  onCasualGameCategorySelect?.('我方产品');
                                  onCasualOurProductSubSelect?.(key);
                                }}
                              >
                                <span className="w-5 h-5 border-2 border-transparent flex items-center justify-center text-xs flex-shrink-0 grayscale">
                                  {icon}
                                </span>
                                <span className="flex-1 truncate text-xs uppercase tracking-wider">{label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // AI产品监测：产品周报 / UA素材 / 新产品速览
            if (type === 'AI产品监测') {
              const allAiSubs: { key: AiProductSubCategory; label: string; icon: string }[] = [
                { key: '产品周报', label: '产品周报', icon: '📋' },
                { key: 'UA素材', label: 'UA素材', icon: '🎬' },
                { key: '新产品速览', label: '新产品速览', icon: '🆕' },
              ];
              const aiSubItems = aiProductVisibleSubs
                ? allAiSubs.filter((item) => aiProductVisibleSubs.includes(item.key))
                : allAiSubs;
              return (
                <div key={type} className="space-y-2">
                  <button
                    onClick={() => onTypeSelect?.(type)}
                    className={`w-full flex items-center gap-2 px-3 py-2 font-bold transition-all border-2 ${
                      selectedType === type
                        ? 'bg-ink text-surface border-ink shadow-brutal-sm translate-x-[-2px] translate-y-[-2px]'
                        : 'text-inkLight border-transparent hover:border-ink/20 hover:text-ink'
                    }`}
                  >
                    <span className="text-lg grayscale">{getTypeIcon(type)}</span>
                    <span className="uppercase tracking-widest text-xs">{getTypeLabel(type)}</span>
                  </button>

                  {selectedType === type && (
                    <div className="ml-4 space-y-1">
                      {aiSubItems.map(({ key, label, icon }) => {
                        const isSelected = selectedAiProductSub === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`w-full flex items-center gap-2 p-1.5 font-bold transition-all border-2 text-left ${
                              isSelected ? 'bg-ink text-surface border-ink translate-x-[-2px] translate-y-[-2px] shadow-brutal-sm' : 'text-inkLight border-transparent hover:border-ink/20 hover:text-ink'
                            }`}
                            onClick={() => onAiProductSubSelect?.(key)}
                          >
                            <span className="w-5 h-5 border-2 border-transparent flex items-center justify-center text-xs flex-shrink-0 grayscale">
                              {icon}
                            </span>
                            <span className="flex-1 truncate text-xs uppercase tracking-wider">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            // AI热点监测、热点趋势监测：普通类型
            return (
              <div key={type} className="space-y-2">
                <button
                  onClick={() => onTypeSelect?.(type)}
                  className={`w-full flex items-center gap-2 px-3 py-2 font-bold transition-all border-2 ${
                    selectedType === type
                      ? 'bg-ink text-surface border-ink shadow-brutal-sm translate-x-[-2px] translate-y-[-2px]'
                      : 'text-inkLight border-transparent hover:border-ink/20 hover:text-ink'
                  }`}
                >
                  <span className="text-lg grayscale">{getTypeIcon(type)}</span>
                  <span className="uppercase tracking-widest text-xs">{getTypeLabel(type)}</span>
                </button>

                {selectedType === type && (
                  <div className="ml-4 space-y-1">
                    {groupSources.map((source) => (
                      <div
                        key={source.id}
                        className="flex items-start gap-3 p-2 border-2 border-transparent hover:border-ink/20 hover:bg-surface transition-all cursor-pointer"
                      >
                        <div className="flex-shrink-0 w-6 h-6 border-2 border-ink/10 flex items-center justify-center text-xs grayscale">
                          {source.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-ink uppercase tracking-wider truncate">{source.name}</p>
                          {source.platform && (
                            <p className="text-[10px] font-bold text-inkLight mt-0.5 uppercase tracking-widest">{source.platform}</p>
                          )}
                          <p className="text-[10px] font-bold text-inkLight mt-0.5">{source.count} 条</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
