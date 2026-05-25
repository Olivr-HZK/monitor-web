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
        return 'AI';
      case '热点趋势监测':
        return 'TR';
      case '竞品社媒监控':
        return 'SM';
      case '休闲游戏监测':
        return 'GM';
      case 'AI产品监测':
        return 'PD';
      default:
        return 'MN';
    }
  };

  const typeButtonClass = (active: boolean) =>
    `w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      active ? 'bg-ink text-white shadow-brutal-sm' : 'text-inkLight hover:bg-surfaceHover hover:text-ink'
    }`;

  const subButtonClass = (active: boolean) =>
    `w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors ${
      active ? 'bg-surfaceHover text-ink ring-1 ring-line' : 'text-inkLight hover:bg-surfaceHover hover:text-ink'
    }`;

  const groupLabelClass = 'mt-2 flex items-center gap-2 text-[11px] font-medium text-muted';

  return (
    <aside className="w-64 flex-shrink-0">
      <div className="sticky top-20 max-h-[calc(100vh-5.5rem)] overflow-y-auto overscroll-y-contain rounded-2xl border border-line bg-panel p-3 shadow-brutal-sm [scrollbar-gutter:stable]">
        <h2 className="mb-3 border-b border-line px-1 pb-2 text-xs font-medium text-muted">监测源</h2>

        {/* All option */}
        {showAllTypeButton && (
          <div className="mb-4">
            <button
              onClick={() => onTypeSelect?.('全部')}
              className={typeButtonClass(selectedType === '全部')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="square" strokeLinejoin="miter" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span>全部</span>
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
                { id: 'sensortower', label: 'SensorTower 榜单', icon: 'ST' },
                { id: 'wechat_douyin', label: '微信 / 抖音小游戏', icon: 'WD' },
              ];
              const baseCasualSubItems: { key: CasualGameMainCategory; label: string; icon: string }[] = [
                { key: '周报简要', label: '周报简要', icon: 'WR' },
              ];
              const sensortowerOnlySubItems: { key: CasualGameMainCategory; label: string; icon: string }[] = [
                { key: '商店页变化', label: '商店页变化', icon: 'SC' },
              ];
              const overseasSubItem: { key: CasualGameMainCategory; label: string; icon: string } = {
                key: '出海周报',
                label: '每周出海周报',
                icon: 'OS',
              };
              const competitorSubItems: { key: CasualGameCompetitorSub; label: string; icon: string }[] = [
                { key: '社媒更新', label: '社媒监控', icon: 'SM' },
                { key: 'UA素材', label: 'UA素材', icon: 'UA' },
              ];
              return (
                <div key={type} className="space-y-2">
                  <button
                    onClick={() => onTypeSelect?.(type)}
                    className={typeButtonClass(
                      selectedType === type || (type === '休闲游戏监测' && selectedType === '竞品社媒监控')
                    )}
                  >
                    <span className="text-base">{getTypeIcon(type)}</span>
                    <span className="truncate">{getTypeLabel(type)}</span>
                  </button>

                  {(selectedType === type || (type === '休闲游戏监测' && selectedType === '竞品社媒监控')) && (
                    <div className="ml-4 space-y-3">
                      <div className="space-y-1">
                        <div className={groupLabelClass}>
                          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border border-line bg-surface text-[10px]">
                            GL
                          </span>
                          <span>出海情报</span>
                        </div>
                        <div className="ml-2 space-y-1 border-l border-line pl-2">
                          <button
                            type="button"
                            className={subButtonClass(selectedCasualGameCategory === overseasSubItem.key)}
                            onClick={() => onCasualGameCategorySelect?.(overseasSubItem.key)}
                          >
                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-xs">
                              {overseasSubItem.icon}
                            </span>
                            <span className="flex-1 truncate">{overseasSubItem.label}</span>
                          </button>
                        </div>
                      </div>

                      {/* 微信 / 抖音 & SensorTower 两个大块 */}
                      {casualSourceSections.map((section) => (
                        <div key={section.id} className="space-y-1">
                          <div className={groupLabelClass}>
                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border border-line bg-surface text-xs">
                              {section.icon}
                            </span>
                            <span>{section.label}</span>
                          </div>
                          <div className="ml-2 space-y-1 border-l border-line pl-2">
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
                                  className={subButtonClass(isSelected)}
                                  onClick={() => {
                                    setActiveCasualSourceSection(section.id);
                                    onCasualGameCategorySelect?.(key);
                                  }}
                                >
                                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-xs">
                                    {icon}
                                  </span>
                                  <span className="flex-1 truncate">{label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {/* 竞品监测块：社媒监控 / UA素材 */}
                      <div className="mt-2 space-y-1 border-t border-line pt-3">
                        <div className={groupLabelClass}>
                          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border border-line bg-surface text-[10px]">
                            CP
                          </span>
                          <span>竞品监测</span>
                        </div>
                        <div className="ml-2 space-y-1 border-l border-line pl-2">
                          {competitorSubItems.map(({ key: subKey, label: subLabel, icon: subIcon }) => {
                            const isSubSelected =
                              selectedCasualGameCategory === '竞品' && selectedCasualGameCompetitorSub === subKey;
                            return (
                              <button
                                key={subKey}
                                type="button"
                                className={subButtonClass(isSubSelected)}
                                onClick={() => {
                                  onCasualGameCategorySelect?.('竞品');
                                  onCasualGameCompetitorSubSelect?.(subKey);
                                }}
                              >
                                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-xs">
                                  {subIcon}
                                </span>
                                <span className="flex-1 truncate">{subLabel}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 我方产品检测：占位待开发 */}
                      <div
                        id="sidebar-casual-own-product"
                        className="mt-2 space-y-1 border-t border-line pt-3"
                      >
                        <div className={groupLabelClass}>
                          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border border-line bg-surface text-[10px]">
                            OP
                          </span>
                          <span>我方产品检测</span>
                        </div>
                        <div className="ml-2 mt-1 space-y-1 border-l border-line pl-2">
                          {(
                            [
                              { key: '日总结' as const, label: 'US 免费榜日总结', icon: 'US' },
                              { key: '按产品追溯' as const, label: '按产品追溯', icon: 'RT' },
                            ] as const
                          ).map(({ key, label, icon }) => {
                            const activeSub = selectedCasualOurProductSub ?? '日总结';
                            const isSubSelected =
                              selectedCasualGameCategory === '我方产品' && activeSub === key;
                            return (
                              <button
                                key={key}
                                type="button"
                                className={subButtonClass(isSubSelected)}
                                onClick={() => {
                                  onCasualGameCategorySelect?.('我方产品');
                                  onCasualOurProductSubSelect?.(key);
                                }}
                              >
                                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-xs">
                                  {icon}
                                </span>
                                <span className="flex-1 truncate">{label}</span>
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
                { key: '产品周报', label: '产品周报', icon: 'WR' },
                { key: 'UA素材', label: 'UA素材', icon: 'UA' },
                { key: '新产品速览', label: '新产品速览', icon: 'NP' },
              ];
              const aiSubItems = aiProductVisibleSubs
                ? allAiSubs.filter((item) => aiProductVisibleSubs.includes(item.key))
                : allAiSubs;
              return (
                <div key={type} className="space-y-2">
                  <button
                    onClick={() => onTypeSelect?.(type)}
                    className={typeButtonClass(selectedType === type)}
                  >
                    <span className="text-base">{getTypeIcon(type)}</span>
                    <span className="truncate">{getTypeLabel(type)}</span>
                  </button>

                  {selectedType === type && (
                    <div className="ml-4 space-y-1">
                      {aiSubItems.map(({ key, label, icon }) => {
                        const isSelected = selectedAiProductSub === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            className={subButtonClass(isSelected)}
                            onClick={() => onAiProductSubSelect?.(key)}
                          >
                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-xs">
                              {icon}
                            </span>
                            <span className="flex-1 truncate">{label}</span>
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
                  className={typeButtonClass(selectedType === type)}
                >
                  <span className="text-base">{getTypeIcon(type)}</span>
                  <span className="truncate">{getTypeLabel(type)}</span>
                </button>

                {selectedType === type && (
                  <div className="ml-4 space-y-1">
                    {groupSources.map((source) => (
                      <div
                        key={source.id}
                        className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-surfaceHover"
                      >
                        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-line bg-surface text-xs">
                          {source.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-xs font-medium text-ink">{source.name}</p>
                          {source.platform && (
                            <p className="mt-0.5 text-[10px] font-medium text-muted">{source.platform}</p>
                          )}
                          <p className="mt-0.5 text-[10px] font-medium text-muted">{source.count} 条</p>
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
