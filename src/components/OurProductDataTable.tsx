import type { OurProductRankAnalytics } from '../data/ourProductAnalyticsLoader';
import { formatOurProductCell } from '../data/ourProductAnalyticsLoader';

interface OurProductDataTableProps {
  data: OurProductRankAnalytics;
}

const OurProductDataTable = ({ data }: OurProductDataTableProps) => {
  const { dates, products } = data;
  if (dates.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        暂无 app_ranks 日期数据。
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
        <p className="text-sm text-slate-600">
          美国 US 免费榜 · 各日在榜名次（仅统计前 500；i = iOS，a = Android；「—」表示未进榜或无数据）
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-600">
              <th className="sticky left-0 z-10 bg-slate-50 border-b border-slate-200 py-2.5 px-3 font-semibold whitespace-nowrap min-w-[160px]">
                产品
              </th>
              {dates.map((d) => (
                <th
                  key={d}
                  className="border-b border-slate-200 py-2.5 px-2 font-medium whitespace-nowrap text-xs text-center min-w-[88px]"
                >
                  {d.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.internalName} className="hover:bg-slate-50/80 border-b border-slate-100">
                <td className="sticky left-0 z-10 bg-white border-r border-slate-100 py-2 px-3 font-medium text-slate-900 whitespace-nowrap max-w-[220px] truncate">
                  {p.displayName}
                </td>
                {dates.map((d) => {
                  const c = p.byDate[d] ?? { ios: null, android: null };
                  return (
                    <td
                      key={d}
                      className="py-2 px-2 text-center text-xs text-slate-700 tabular-nums whitespace-nowrap"
                      title={formatOurProductCell(c)}
                    >
                      {formatOurProductCell(c)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OurProductDataTable;
