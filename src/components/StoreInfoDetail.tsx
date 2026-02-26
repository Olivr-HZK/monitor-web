/**
 * SensorTower 新进 Top3 游戏商店信息详情页
 * 展示 appstoreinfo / gamestoreinfo 内容，格式化易读
 */

import type { SensorTowerStoreCard, AppStoreInfo, GameStoreInfo } from '../types';
import { formatCountryToZh } from '../utils/rankingLabels';

interface StoreInfoDetailProps {
  card: SensorTowerStoreCard;
  onBack: () => void;
}

function decodeHtml(text: string): string {
  if (!text) return '';
  const div = document.createElement('div');
  div.innerHTML = text
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return div.textContent ?? text;
}

function formatDescription(html: string): string {
  const decoded = decodeHtml(html);
  return decoded
    .replace(/\n{2,}/g, '\n\n')
    .replace(/([。！？])\s*/g, '$1\n')
    .trim();
}

function parseScreenshotUrls(raw?: string): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item)).filter((item) => item);
    }
  } catch {
    // fall through to split logic
  }
  return trimmed
    .split(/[\n,|;]/g)
    .map((item) => item.trim())
    .filter((item) => item);
}

function isAppStoreInfo(s: AppStoreInfo | GameStoreInfo | null): s is AppStoreInfo {
  return s != null && 'app_name' in s;
}

const StoreInfoDetail = ({ card, onBack }: StoreInfoDetailProps) => {
  const info = card.storeInfo;
  const isIos = card.platform === 'iOS';
  const screenshots = parseScreenshotUrls(info?.screenshot_urls);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              返回
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-slate-900 truncate">{card.gameName}</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {formatCountryToZh(card.country) || card.country} · {card.platform} · 新进榜排名 #{card.currentRank}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!info ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
            暂无该应用的商店信息
          </div>
        ) : (
          <div className="space-y-6">
            {/* 头部卡片：图标 + 名称 + 开发者 + 评分 + 分类 */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 flex flex-col sm:flex-row gap-6">
                {info.icon_url && (
                  <img
                    src={info.icon_url}
                    alt={card.gameName}
                    className="w-24 h-24 rounded-2xl object-cover flex-shrink-0 shadow-md"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl font-bold text-slate-900 mb-1">
                    {isAppStoreInfo(info) ? info.app_name : info.title}
                  </h2>
                  {isAppStoreInfo(info) && info.subtitle && (
                    <p className="text-slate-600 mb-2">{decodeHtml(info.subtitle)}</p>
                  )}
                  {info.developer && (
                    <p className="text-sm text-slate-500 mb-2">
                      <span className="font-medium text-slate-700">开发者：</span>
                      {decodeHtml(info.developer)}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    {info.rating != null && (
                      <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                        ★ {info.rating.toFixed(1)}
                      </span>
                    )}
                    {isAppStoreInfo(info) && info.rating_count != null && (
                      <span className="text-slate-500">（{info.rating_count.toLocaleString()} 评分）</span>
                    )}
                    {info.category && (
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200">{info.category}</span>
                    )}
                    {isAppStoreInfo(info) && info.age_rating && (
                      <span className="text-slate-500">{info.age_rating}</span>
                    )}
                    {!isAppStoreInfo(info) && (info as GameStoreInfo).content_rating && (
                      <span className="text-slate-500">{(info as GameStoreInfo).content_rating}</span>
                    )}
                    {!isAppStoreInfo(info) && (info as GameStoreInfo).installs && (
                      <span className="text-slate-500">{(info as GameStoreInfo).installs} 安装</span>
                    )}
                  </div>
                  {isAppStoreInfo(info) && info.price_type && (
                  <p className="text-sm text-slate-600 mt-2">{info.price_type}</p>
                  )}
                </div>
              </div>
            </div>

            {/* 简短描述（Android short_description / iOS description_short） */}
            {(isAppStoreInfo(info) ? info.description_short : (info as GameStoreInfo).short_description) && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-3">简介</h3>
                <p className="text-slate-700 leading-relaxed whitespace-pre-line">
                  {formatDescription(
                    isAppStoreInfo(info)
                      ? (info.description_short ?? '')
                      : ((info as GameStoreInfo).short_description ?? '')
                  )}
                </p>
              </div>
            )}

            {/* 截图 */}
            {screenshots.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-3">截图</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {screenshots.map((url, idx) => (
                    <img
                      key={`${url}-${idx}`}
                      src={url}
                      alt={`${card.gameName} 截图 ${idx + 1}`}
                      className="w-full h-40 object-cover rounded-lg border border-slate-200"
                      loading="lazy"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 完整描述 */}
            {(isAppStoreInfo(info) ? info.description : (info as GameStoreInfo).full_description) && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-3">应用描述</h3>
                <div
                  className="text-slate-700 leading-relaxed whitespace-pre-line prose prose-sm max-w-none"
                  style={{ wordBreak: 'break-word' }}
                >
                  {formatDescription(
                    isAppStoreInfo(info)
                      ? (info.description ?? '')
                      : ((info as GameStoreInfo).full_description ?? '')
                  ).split('\n').map((para, i) =>
                    para.trim() ? (
                      <p key={i} className="mb-3 last:mb-0">
                        {para}
                      </p>
                    ) : (
                      <br key={i} />
                    )
                  )}
                </div>
              </div>
            )}

            {/* 商店链接 */}
            {info.store_url && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <a
                  href={info.store_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors border border-blue-200"
                >
                  {isIos ? '在 App Store 中查看' : '在 Google Play 中查看'}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default StoreInfoDetail;
