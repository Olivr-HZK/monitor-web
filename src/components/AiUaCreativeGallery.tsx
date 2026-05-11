import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { loadAiUaGalleryFromVideoEnhancerDb } from '../data/aiProductLoader';
import type { AiUaGalleryItem } from '../types';

function formatCompactNumber(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return value.toLocaleString();
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return remain > 0 ? `${mins}m ${remain}s` : `${mins}m`;
}

function formatDateRange(item: AiUaGalleryItem): string {
  if (item.firstTargetDate && item.lastTargetDate) {
    return `${item.firstTargetDate} - ${item.lastTargetDate}`;
  }
  return item.lastTargetDate || item.firstTargetDate || '—';
}

function toPlainText(value?: string): string {
  if (!value) return '';
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPreviewSrc(item: AiUaGalleryItem): string | undefined {
  return item.previewImgUrl || item.imageUrl;
}

const AiUaCreativeGallery = () => {
  const { getDataUrl } = useAuth();
  const [items, setItems] = useState<AiUaGalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [selectedCreativeType, setSelectedCreativeType] = useState<'all' | 'video' | 'image'>('all');
  const [activeItem, setActiveItem] = useState<AiUaGalleryItem | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const result = await loadAiUaGalleryFromVideoEnhancerDb(getDataUrl);
      if (!cancelled) {
        setItems(result);
        setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [getDataUrl]);

  useEffect(() => {
    if (!activeItem) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveItem(null);
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeItem]);

  const filterOptions = useMemo(() => {
    const categories = Array.from(new Set(items.map((item) => item.category).filter(Boolean))).sort();
    const platforms = Array.from(new Set(items.map((item) => item.platform).filter(Boolean))).sort();
    return { categories, platforms };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
      if (selectedPlatform !== 'all' && item.platform !== selectedPlatform) return false;
      if (selectedCreativeType !== 'all' && item.creativeType !== selectedCreativeType) return false;

      if (!q) return true;
      const haystack = [
        item.product,
        item.category,
        item.platform,
        item.title,
        item.body,
        item.adKey,
        item.insightCoverStyle,
        item.insightUaSuggestion,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, search, selectedCategory, selectedPlatform, selectedCreativeType]);

  const summary = useMemo(() => {
    const videos = filteredItems.filter((item) => item.videoUrl).length;
    const images = filteredItems.filter((item) => !item.videoUrl).length;
    const latestDate = filteredItems
      .map((item) => item.lastTargetDate)
      .filter(Boolean)
      .sort()
      .at(-1);
    return { videos, images, latestDate };
  }, [filteredItems]);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden border-2 border-ink bg-white shadow-brutal-sm">
        <div className="border-b-2 border-ink bg-ink px-6 py-5 text-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/70">
                AI Product Monitoring
              </div>
              <h2 className="text-2xl font-display font-bold tracking-tight">UA 素材卡片库</h2>
              <p className="max-w-3xl text-sm font-medium text-white/75">
                基于 `video_enhancer_pipeline.db` 的 `creative_library` 渲染，按卡片浏览素材，点击即可直接播放视频。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="border border-white/20 bg-white/10 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">素材总数</div>
                <div className="mt-1 text-2xl font-display font-bold">{filteredItems.length}</div>
              </div>
              <div className="border border-white/20 bg-white/10 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">视频素材</div>
                <div className="mt-1 text-2xl font-display font-bold">{summary.videos}</div>
              </div>
              <div className="border border-white/20 bg-white/10 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">图片素材</div>
                <div className="mt-1 text-2xl font-display font-bold">{summary.images}</div>
              </div>
              <div className="border border-white/20 bg-white/10 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">最新日期</div>
                <div className="mt-1 text-sm font-bold">{summary.latestDate ?? '—'}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-b-2 border-ink/10 bg-surface px-6 py-4">
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索产品 / 平台 / ad_key / 文案"
              className="min-w-[220px] flex-1 border-2 border-ink/15 bg-white px-4 py-2.5 text-sm text-ink outline-none transition focus:border-ink"
            />
            <select
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
              className="border-2 border-ink/15 bg-white px-4 py-2.5 text-sm text-ink outline-none transition focus:border-ink"
            >
              <option value="all">全部分类</option>
              {filterOptions.categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <select
              value={selectedPlatform}
              onChange={(event) => setSelectedPlatform(event.target.value)}
              className="border-2 border-ink/15 bg-white px-4 py-2.5 text-sm text-ink outline-none transition focus:border-ink"
            >
              <option value="all">全部平台</option>
              {filterOptions.platforms.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
            <select
              value={selectedCreativeType}
              onChange={(event) => setSelectedCreativeType(event.target.value as 'all' | 'video' | 'image')}
              className="border-2 border-ink/15 bg-white px-4 py-2.5 text-sm text-ink outline-none transition focus:border-ink"
            >
              <option value="all">全部类型</option>
              <option value="video">视频</option>
              <option value="image">图片</option>
            </select>
          </div>
        </div>

        <div className="px-6 py-6">
          {loading ? (
            <div className="flex min-h-[240px] items-center justify-center text-sm font-medium text-inkLight">
              素材加载中...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex min-h-[240px] items-center justify-center border-2 border-dashed border-ink/15 bg-surface text-sm font-medium text-inkLight">
              当前筛选下暂无素材
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredItems.map((item) => {
                const previewSrc = getPreviewSrc(item);
                const detailText =
                  toPlainText(item.title) ||
                  toPlainText(item.body) ||
                  toPlainText(item.insightCoverStyle) ||
                  '点击查看素材详情';

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveItem(item)}
                    className="group overflow-hidden border-2 border-ink bg-white text-left transition hover:-translate-x-1 hover:-translate-y-1 hover:shadow-brutal-sm"
                  >
                    <div className="relative aspect-[4/5] overflow-hidden bg-slate-100">
                      {previewSrc ? (
                        <img
                          src={previewSrc}
                          alt={item.product}
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-slate-200 text-sm font-bold text-slate-500">
                          暂无预览图
                        </div>
                      )}

                      <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
                        <span className="border border-white/20 bg-black/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
                          {item.category || '未分类'}
                        </span>
                        <span className="border border-white/20 bg-black/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
                          {item.creativeType === 'video' ? 'Video' : item.creativeType === 'image' ? 'Image' : 'Asset'}
                        </span>
                      </div>

                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-4 pb-4 pt-10 text-white">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/70">
                            {item.platform || '未知平台'}
                          </span>
                          <span className="text-xs font-semibold text-white/80">
                            {formatDuration(item.videoDuration)}
                          </span>
                        </div>
                        <div className="line-clamp-2 text-lg font-display font-bold leading-tight">
                          {item.product}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-lg backdrop-blur-sm">
                            {item.videoUrl ? '▶' : '🖼'}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-white/80">
                              {formatDateRange(item)}
                            </div>
                            <div className="truncate text-[11px] text-white/65">
                              {item.appearanceCount ? `出现 ${item.appearanceCount} 次` : '单次出现'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 p-4">
                      <div className="min-h-[44px]">
                        <div className="line-clamp-2 text-sm font-semibold text-ink">{detailText}</div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="border border-ink/10 bg-surface px-3 py-2">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-inkLight">人气值</div>
                          <div className="mt-1 text-sm font-bold text-ink">{formatCompactNumber(item.bestHeat)}</div>
                        </div>
                        <div className="border border-ink/10 bg-surface px-3 py-2">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-inkLight">曝光</div>
                          <div className="mt-1 text-sm font-bold text-ink">
                            {formatCompactNumber(item.bestAllExposureValue)}
                          </div>
                        </div>
                        <div className="border border-ink/10 bg-surface px-3 py-2">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-inkLight">展示</div>
                          <div className="mt-1 text-sm font-bold text-ink">{formatCompactNumber(item.bestImpression)}</div>
                        </div>
                      </div>

                      {item.insightCoverStyle && (
                        <div className="border-l-2 border-accent pl-3 text-xs text-inkLight">
                          封面风格：{toPlainText(item.insightCoverStyle)}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {activeItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setActiveItem(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-6xl overflow-hidden border-2 border-ink bg-white shadow-brutal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b-2 border-ink bg-ink px-5 py-4 text-white">
              <div className="min-w-0">
                <div className="truncate text-xl font-display font-bold">{activeItem.product}</div>
                <div className="mt-1 text-xs font-medium uppercase tracking-[0.2em] text-white/65">
                  {activeItem.category} / {activeItem.platform || '未知平台'} / {activeItem.adKey}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveItem(null)}
                className="border border-white/20 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] transition hover:bg-white hover:text-ink"
              >
                关闭
              </button>
            </div>

            <div className="grid max-h-[calc(92vh-70px)] grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.8fr)]">
              <div className="bg-black">
                {activeItem.videoUrl ? (
                  <video
                    key={activeItem.videoUrl}
                    controls
                    autoPlay
                    playsInline
                    poster={getPreviewSrc(activeItem)}
                    className="h-full max-h-[70vh] w-full bg-black object-contain"
                  >
                    <source src={activeItem.videoUrl} />
                  </video>
                ) : getPreviewSrc(activeItem) ? (
                  <img
                    src={getPreviewSrc(activeItem)}
                    alt={activeItem.product}
                    className="h-full max-h-[70vh] w-full object-contain"
                  />
                ) : (
                  <div className="flex h-[480px] items-center justify-center text-sm font-medium text-white/70">
                    暂无可展示素材
                  </div>
                )}
              </div>

              <div className="space-y-5 p-6">
                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-ink/10 bg-surface px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-inkLight">人气值</div>
                    <div className="mt-1 text-lg font-bold text-ink">{formatCompactNumber(activeItem.bestHeat)}</div>
                  </div>
                  <div className="border border-ink/10 bg-surface px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-inkLight">累计曝光</div>
                    <div className="mt-1 text-lg font-bold text-ink">
                      {formatCompactNumber(activeItem.bestAllExposureValue)}
                    </div>
                  </div>
                  <div className="border border-ink/10 bg-surface px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-inkLight">展示次数</div>
                    <div className="mt-1 text-lg font-bold text-ink">
                      {formatCompactNumber(activeItem.bestImpression)}
                    </div>
                  </div>
                  <div className="border border-ink/10 bg-surface px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-inkLight">时长 / 出现</div>
                    <div className="mt-1 text-lg font-bold text-ink">
                      {formatDuration(activeItem.videoDuration)} / {activeItem.appearanceCount ?? '—'} 次
                    </div>
                  </div>
                </div>

                <div className="space-y-3 border-2 border-ink/10 p-4">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-inkLight">素材摘要</div>
                  <div className="text-sm leading-6 text-ink">
                    {toPlainText(activeItem.title) || toPlainText(activeItem.body) || '暂无标题或文案摘要'}
                  </div>
                  <div className="text-xs text-inkLight">
                    时间区间：{formatDateRange(activeItem)}
                  </div>
                </div>

                {activeItem.insightUaSuggestion && (
                  <div className="space-y-2 border-l-2 border-accent pl-4">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-inkLight">UA 建议</div>
                    <div className="text-sm leading-6 text-ink">
                      {toPlainText(activeItem.insightUaSuggestion)}
                    </div>
                  </div>
                )}

                {activeItem.insightAnalysis && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-inkLight">分析摘要</div>
                    <div className="max-h-[220px] overflow-y-auto border border-ink/10 bg-surface p-4 text-sm leading-6 text-ink">
                      {toPlainText(activeItem.insightAnalysis)}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-3 pt-2">
                  {activeItem.videoUrl && (
                    <a
                      href={activeItem.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center border-2 border-ink bg-ink px-4 py-2 text-sm font-bold text-white transition hover:bg-white hover:text-ink"
                    >
                      打开原视频
                    </a>
                  )}
                  {getPreviewSrc(activeItem) && (
                    <a
                      href={getPreviewSrc(activeItem)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center border-2 border-ink px-4 py-2 text-sm font-bold text-ink transition hover:bg-surface"
                    >
                      查看原图
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AiUaCreativeGallery;
