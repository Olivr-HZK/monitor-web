import type { CasualGameOurProductSub } from '../types';

interface OurProductDevelopingPlaceholderProps {
  sub: CasualGameOurProductSub;
}

/** 我方产品：占位（与此前「占位，后续接入内容」一致），不拉取 us_free DB。 */
const OurProductDevelopingPlaceholder = ({ sub }: OurProductDevelopingPlaceholderProps) => {
  const title = sub === '日总结' ? 'US 免费榜日总结' : '按产品追溯';
  const hint =
    sub === '日总结'
      ? '自有产品 US 免费榜日维度总结卡片'
      : '侧栏选产品 + 按日名次与环比';
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/90 px-6 py-14 text-center shadow-sm">
      <div className="mx-auto max-w-md space-y-3">
        <div className="text-3xl grayscale opacity-90" aria-hidden>
          🏗️
        </div>
        <p className="text-base font-semibold text-slate-800">待开发</p>
        <p className="text-sm leading-relaxed text-slate-500">
          「{title}」：{hint}将后续接入；当前不加载数据。
        </p>
      </div>
    </div>
  );
};

export default OurProductDevelopingPlaceholder;
