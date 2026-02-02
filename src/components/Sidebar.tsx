import type { MonitorSource, MonitorType } from '../types';
import type { GamePlatformKey, CasualGameMainCategory, CasualGameCompetitorSub } from '../types';

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
  /** 休闲游戏检测-竞品：选中的小类（社媒更新/UA素材） */
  selectedCasualGameCompetitorSub?: CasualGameCompetitorSub | null;
  onCasualGameCompetitorSubSelect?: (sub: CasualGameCompetitorSub | null) => void;
}

const Sidebar = ({
  sources,
  selectedType = '全部',
  onTypeSelect,
  companies = [],
  selectedCompany,
  onCompanySelect,
  selectedCasualGameCategory,
  onCasualGameCategorySelect,
  selectedGamePlatform,
  onGamePlatformSelect,
  selectedCasualGameCompetitorSub,
  onCasualGameCompetitorSubSelect,
}: SidebarProps) => {
  const typeGroups: Record<MonitorType | '全部', MonitorSource[]> = {
    '全部': [],
    'ai热点检测': [],
    '热点趋势检测': [],
    '竞品社媒监控': [],
    '休闲游戏检测': [],
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

        {/* 监测类型：AI热点、热点趋势、休闲游戏 并列 */}
        <div className="space-y-4">
          {(['ai热点检测', '热点趋势检测', '休闲游戏检测'] as MonitorType[]).map((type) => {
            const groupSources = typeGroups[type];
            if (groupSources.length === 0 && type !== '休闲游戏检测') return null;

            // 休闲游戏检测：带子分类
            if (type === '休闲游戏检测') {
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
                        { key: '新游戏' as const, label: '新游戏', icon: '🆕' },
                        { key: '新玩法' as const, label: '新玩法', icon: '🎯' },
                        { key: '竞品' as const, label: '竞品', icon: '🏆' },
                      ].map(({ key, label, icon }) => {
                        const isSelected = selectedCasualGameCategory === key;
                        return (
                          <div key={key} className="space-y-1">
                            <button
                              type="button"
                              className={`w-full flex items-center gap-2 p-2 rounded-lg text-xs transition-colors text-left ${
                                isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                              }`}
                              onClick={() => onCasualGameCategorySelect?.(key)}
                            >
                              <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs flex-shrink-0">
                                {icon}
                              </span>
                              <span className="flex-1 truncate font-medium">{label}</span>
                            </button>
                            {isSelected && key === '新游戏' && (
                              <div className="ml-4 space-y-1">
                                {groupSources.map((source) => {
                                  const platformKey = source.platform as GamePlatformKey | undefined;
                                  const isPlatformSelected = platformKey && selectedGamePlatform === platformKey;
                                  return (
                                    <button
                                      key={source.id}
                                      type="button"
                                      className={`w-full flex items-center gap-2 p-2 rounded-lg text-xs transition-colors text-left ${
                                        isPlatformSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                                      }`}
                                      onClick={() => onGamePlatformSelect?.(platformKey ?? null)}
                                    >
                                      <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs flex-shrink-0">
                                        {source.icon}
                                      </span>
                                      <span className="flex-1 truncate font-medium">{source.name}</span>
                                      <span className="text-gray-500">周榜</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {isSelected && key === '竞品' && (
                              <div className="ml-4 space-y-1">
                                {[
                                  { key: '社媒更新' as const, label: '社媒更新' },
                                  { key: 'UA素材' as const, label: 'UA素材' },
                                ].map(({ key: subKey, label: subLabel }) => {
                                  const isSubSelected = selectedCasualGameCompetitorSub === subKey;
                                  return (
                                    <div key={subKey} className="space-y-1">
                                      <button
                                        type="button"
                                        className={`w-full flex items-center gap-2 p-2 rounded-lg text-xs transition-colors text-left ${
                                          isSubSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                                        }`}
                                        onClick={() => onCasualGameCompetitorSubSelect?.(subKey)}
                                      >
                                        <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs flex-shrink-0">
                                          {subKey === '社媒更新' ? '📱' : '🎬'}
                                        </span>
                                        <span className="flex-1 truncate font-medium">{subLabel}</span>
                                      </button>
                                      {isSubSelected && subKey === '社媒更新' && companies.length > 0 && (
                                        <div className="ml-4 space-y-1">
                                          <button
                                            type="button"
                                            className={`w-full flex items-center gap-2 p-2 rounded-lg text-xs transition-colors ${
                                              !selectedCompany ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                                            }`}
                                            onClick={() => onCompanySelect?.(null)}
                                          >
                                            <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs">🏢</span>
                                            <span className="flex-1 text-left truncate">全部公司</span>
                                          </button>
                                          {companies.map((company) => (
                                            <button
                                              key={company}
                                              type="button"
                                              className={`w-full flex items-center gap-2 p-2 rounded-lg text-xs transition-colors ${
                                                selectedCompany === company ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                                              }`}
                                              onClick={() => onCompanySelect?.(company)}
                                            >
                                              <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs">🏢</span>
                                              <span className="flex-1 text-left truncate">{company}</span>
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
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
