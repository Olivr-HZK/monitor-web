import { useState } from 'react';
import type { MonitorSource, MonitorType } from '../types';
import type { GamePlatformKey, CasualGameMainCategory, CasualGameCompetitorSub, AiProductSubCategory } from '../types';

interface SidebarProps {
  sources: MonitorSource[];
  selectedType?: MonitorType | '全部';
  onTypeSelect?: (type: MonitorType | '全部') => void;
  companies?: string[]; // 竞品公司列表
  selectedCompany?: string | null;
  onCompanySelect?: (company: string | null) => void;
  /** 休闲游戏检测：选中的大类（新游戏/新玩法/竞品） */
  selectedCasualGameCategory?: CasualGameMainCategory | null;
  onCasualGameCategorySelect?: (category: CasualGameMainCategory | null) => void;
  /** 休闲游戏检测-新游戏：选中的平台 */
  selectedGamePlatform?: GamePlatformKey | null;
  onGamePlatformSelect?: (platform: GamePlatformKey | null) => void;
  /** 休闲游戏检测-竞品动态：选中的小类（社媒监控/UA素材） */
  selectedCasualGameCompetitorSub?: CasualGameCompetitorSub | null;
  onCasualGameCompetitorSubSelect?: (sub: CasualGameCompetitorSub | null) => void;
  /** AI产品检测：选中的子类（排行榜/产品周报/UA素材） */
  selectedAiProductSub?: AiProductSubCategory | null;
  onAiProductSubSelect?: (sub: AiProductSubCategory | null) => void;
  /** 休闲游戏检测：当前选中的数据块（微信/抖音 与 SensorTower 隔离） */
  selectedCasualSourceSection?: 'wechat_douyin' | 'sensortower';
  onCasualSourceSectionSelect?: (section: 'wechat_douyin' | 'sensortower') => void;
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
}: SidebarProps) => {
  const [internalCasualSourceSection, setInternalCasualSourceSection] = useState<'wechat_douyin' | 'sensortower'>('wechat_douyin');
  const activeCasualSourceSection = propCasualSourceSection ?? internalCasualSourceSection;
  const setActiveCasualSourceSection = (s: 'wechat_douyin' | 'sensortower') => {
    onCasualSourceSectionSelect?.(s);
    if (propCasualSourceSection === undefined) setInternalCasualSourceSection(s);
  };
  const typeGroups: Record<MonitorType | '全部', MonitorSource[]> = {
    '全部': [],
    'ai热点检测': [],
    '热点趋势检测': [],
    '竞品社媒监控': [],
    '休闲游戏检测': [],
    'AI产品检测': [],
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
      case 'ai热点检测':
        return '🤖';
      case '热点趋势检测':
        return '📈';
      case '竞品社媒监控':
        return '📱';
      case '休闲游戏检测':
        return '🎮';
      case 'AI产品检测':
        return '✨';
      default:
        return '📊';
    }
  };

  return (
    <aside className="w-64 flex-shrink-0">
      <div className="sticky top-20">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">监测源</h2>

        {/* All option */}
        <div className="mb-4">
          <button
            onClick={() => onTypeSelect?.('全部')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              selectedType === '全部'
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
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
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
            <span className="font-medium">全部</span>
          </button>
        </div>

        {/* 监测类型：AI热点、热点趋势、休闲游戏、AI产品检测 并列 */}
        <div className="space-y-4">
          {(['ai热点检测', '热点趋势检测', '休闲游戏检测', 'AI产品检测'] as MonitorType[]).map((type) => {
            const groupSources = typeGroups[type];
            // AI热点检测和热点趋势检测始终显示，即使没有 sources
            if (
              groupSources.length === 0 &&
              type !== '休闲游戏检测' &&
              type !== 'AI产品检测' &&
              type !== 'ai热点检测' &&
              type !== '热点趋势检测'
            )
              return null;

            // 休闲游戏检测：右侧分为两个大块（微信/抖音 & SensorTower），每个下面都有 周报简要 / 玩法拆解，
            // 另外保留「竞品检测」块（社媒监控 / UA素材）
            if (type === '休闲游戏检测') {
              const casualSourceSections: { id: 'wechat_douyin' | 'sensortower'; label: string; icon: string }[] = [
                { id: 'wechat_douyin', label: '微信 / 抖音小游戏', icon: '💬' },
                { id: 'sensortower', label: 'SensorTower 榜单', icon: '📊' },
              ];
              const casualSubItems: { key: CasualGameMainCategory; label: string; icon: string }[] = [
                { key: '周报简要', label: '周报简要', icon: '📋' },
                { key: '玩法拆解', label: '玩法拆解', icon: '🎲' },
              ];
              const competitorSubItems: { key: CasualGameCompetitorSub; label: string; icon: string }[] = [
                { key: '社媒更新', label: '社媒监控', icon: '📱' },
                { key: 'UA素材', label: 'UA素材', icon: '🎬' },
              ];
              return (
                <div key={type} className="space-y-2">
                  <button
                    onClick={() => onTypeSelect?.(type)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium ${
                      selectedType === type
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-lg">{getTypeIcon(type)}</span>
                    <span>{getTypeLabel(type)}</span>
                    <span className="ml-auto text-xs text-gray-500">
                      {groupSources.reduce((sum, s) => sum + s.count, 0)}
                    </span>
                  </button>

                  {selectedType === type && (
                    <div className="ml-4 space-y-3">
                      {/* 微信 / 抖音 & SensorTower 两个大块 */}
                      {casualSourceSections.map((section) => (
                        <div key={section.id} className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                              {section.icon}
                            </span>
                            <span className="font-semibold">{section.label}</span>
                          </div>
                          <div className="ml-3 space-y-1">
                            {casualSubItems.map(({ key, label, icon }) => {
                              const isSelectedInCategory =
                                key === '玩法拆解'
                                  ? selectedCasualGameCategory === '玩法拆解' ||
                                    selectedCasualGameCategory === '新游戏' ||
                                    selectedCasualGameCategory === '新玩法'
                                  : selectedCasualGameCategory === key;
                              // UI 选中态需同时匹配当前大块，避免两个模块同时高亮
                              const isSelected = isSelectedInCategory && activeCasualSourceSection === section.id;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  className={`w-full flex items-center gap-2 p-2 rounded-lg text-xs transition-colors text-left ${
                                    isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                                  }`}
                                  onClick={() => {
                                    setActiveCasualSourceSection(section.id);
                                    onCasualGameCategorySelect?.(key);
                                  }}
                                >
                                  <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs flex-shrink-0">
                                    {icon}
                                  </span>
                                  <span className="flex-1 truncate font-medium">{label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {/* 竞品检测块：社媒监控 / UA素材 */}
                      <div className="space-y-1 pt-2 border-t border-gray-100 mt-1">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                            📊
                          </span>
                          <span className="font-semibold">竞品检测</span>
                        </div>
                        <div className="ml-3 space-y-0.5">
                          {competitorSubItems.map(({ key: subKey, label: subLabel, icon: subIcon }) => {
                            const isSubSelected =
                              selectedCasualGameCategory === '竞品' && selectedCasualGameCompetitorSub === subKey;
                            return (
                              <button
                                key={subKey}
                                type="button"
                                className={`w-full flex items-center gap-2 py-1.5 pl-2 rounded text-xs transition-colors text-left ${
                                  isSubSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                                }`}
                                onClick={() => {
                                  onCasualGameCategorySelect?.('竞品');
                                  onCasualGameCompetitorSubSelect?.(subKey);
                                }}
                              >
                                <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-xs flex-shrink-0">
                                  {subIcon}
                                </span>
                                <span className="flex-1 truncate font-medium">{subLabel}</span>
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

            // AI产品检测：排行榜 / 产品周报 / UA素材
            if (type === 'AI产品检测') {
              return (
                <div key={type} className="space-y-2">
                  <button
                    onClick={() => onTypeSelect?.(type)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium ${
                      selectedType === type
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-lg">{getTypeIcon(type)}</span>
                    <span>{getTypeLabel(type)}</span>
                    <span className="ml-auto text-xs text-gray-500">
                      {groupSources.reduce((sum, s) => sum + s.count, 0)}
                    </span>
                  </button>

                  {selectedType === type && (
                    <div className="ml-4 space-y-1">
                      {[
                        { key: '产品周报' as const, label: '产品周报', icon: '📋' },
                        { key: 'UA素材' as const, label: 'UA素材', icon: '🎬' },
                        { key: '竞品动态' as const, label: '竞品动态', icon: '🏆' },
                        { key: '新产品速览' as const, label: '新产品速览', icon: '🆕' },
                      ].map(({ key, label, icon }) => {
                        const isSelected = selectedAiProductSub === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`w-full flex items-center gap-2 p-2 rounded-lg text-xs transition-colors text-left ${
                              isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                            }`}
                            onClick={() => onAiProductSubSelect?.(key)}
                          >
                            <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs flex-shrink-0">
                              {icon}
                            </span>
                            <span className="flex-1 truncate font-medium">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            // AI热点检测、热点趋势检测：普通类型
            return (
              <div key={type} className="space-y-2">
                <button
                  onClick={() => onTypeSelect?.(type)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium ${
                    selectedType === type
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-lg">{getTypeIcon(type)}</span>
                  <span>{getTypeLabel(type)}</span>
                  <span className="ml-auto text-xs text-gray-500">
                    {groupSources.reduce((sum, s) => sum + s.count, 0)}
                  </span>
                </button>

                {selectedType === type && (
                  <div className="ml-4 space-y-1">
                    {groupSources.map((source) => (
                      <div
                        key={source.id}
                        className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                      >
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs">
                          {source.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 truncate">{source.name}</p>
                          {source.platform && (
                            <p className="text-xs text-gray-500 mt-0.5">{source.platform}</p>
                          )}
                          <p className="text-xs text-gray-500 mt-0.5">{source.count}条</p>
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
