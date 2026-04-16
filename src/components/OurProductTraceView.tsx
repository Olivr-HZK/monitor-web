import { useMemo, useState } from 'react';
import type { OurProductRankAnalytics, OurProductRankRow } from '../data/ourProductAnalyticsLoader';
import { buildTraceSeriesForProduct } from '../data/ourProductAnalyticsLoader';
import { buildSensorTowerOverviewUrl } from '../utils/rankingLabels';

function pickStAppId(row: OurProductRankRow, datesAsc: string[]): string {
  for (let i = datesAsc.length - 1; i >= 0; i--) {
    const m = row.appIdsByDate[datesAsc[i]];
    if (m?.ios) return m.ios;
    if (m?.android) return m.android;
  }
  return '';
}

interface OurProductTraceViewProps {
  data: OurProductRankAnalytics;
}

function deltaStr(v: number | null): string {
  if (v == null) return '—';
  if (v === 0) return '0';
  return v > 0 ? `+${v}` : String(v);
}

const OurProductTraceView = ({ data }: OurProductTraceViewProps) => {
  const { dates, products } = data;
  const [internalName, setInternalName] = useState<string>(() => products[0]?.internalName ?? '');
  const [search, setSearch] = useState('');

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.internalName.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q)
    );
  }, [products, search]);

  const row = useMemo(
    () => products.find((p) => p.internalName === internalName) ?? products[0],
    [products, internalName]
  );

  const series = useMemo(() => {
    if (!row) return [];
    return buildTraceSeriesForProduct(row, dates);
  }, [row, dates]);

  const titleStUrl = row ? buildSensorTowerOverviewUrl(pickStAppId(row, dates), 'US') : '';

  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        暂无产品数据。
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[420px]">
      <aside className="w-full lg:w-64 flex-shrink-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex flex-col max-h-[480px]">
        <input
          type="search"
          placeholder="搜索产品…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <div className="overflow-y-auto flex-1 space-y-0.5 pr-1">
          {filteredProducts.map((p) => (
            <button
              key={p.internalName}
              type="button"
              onClick={() => setInternalName(p.internalName)}
              className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                p.internalName === internalName
                  ? 'bg-ink text-white font-semibold'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className="line-clamp-2">{p.displayName}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {row && (
          <>
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
              <h2 className="text-lg font-semibold text-slate-900">
                {titleStUrl ? (
                  <a
                    href={titleStUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {row.displayName}
                  </a>
                ) : (
                  row.displayName
                )}
              </h2>
              <p className="text-xs text-slate-500 mt-1">按日期从新到旧；Δ 为与前一日的名次差（正=上升）。</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-left">
                    <th className="py-2.5 px-4 font-semibold">日期</th>
                    <th className="py-2.5 px-3 font-semibold">iOS</th>
                    <th className="py-2.5 px-3 font-semibold">Android</th>
                    <th className="py-2.5 px-3 font-semibold">Δ iOS</th>
                    <th className="py-2.5 px-3 font-semibold">Δ Android</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((day) => (
                    <tr key={day.date} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="py-2 px-4 text-slate-800 whitespace-nowrap">{day.date}</td>
                      <td className="py-2 px-3 tabular-nums">{day.ios ?? '—'}</td>
                      <td className="py-2 px-3 tabular-nums">{day.android ?? '—'}</td>
                      <td className="py-2 px-3 tabular-nums text-slate-700">{deltaStr(day.deltaIos)}</td>
                      <td className="py-2 px-3 tabular-nums text-slate-700">{deltaStr(day.deltaAndroid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default OurProductTraceView;
