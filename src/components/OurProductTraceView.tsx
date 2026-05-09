import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  OurProductRankAnalytics,
  OurProductRankRow,
  OurProductRankSeries,
} from '../data/ourProductAnalyticsLoader';
import { buildSensorTowerOverviewUrl } from '../utils/rankingLabels';

const COLORS = [
  '#2f7d77',
  '#4e79a7',
  '#e15759',
  '#f28e2b',
  '#8f5aa8',
  '#8d6b48',
  '#6b7280',
  '#59a14f',
  '#b07aa1',
  '#edc948',
];

const COMPETITOR_SEPARATOR = '·竞品·';

function isCompetitorRow(row: OurProductRankRow): boolean {
  return row.internalName.includes(COMPETITOR_SEPARATOR);
}

function baseInternalName(row: OurProductRankRow): string {
  return row.internalName.split(COMPETITOR_SEPARATOR)[0] || row.internalName;
}

function pickStAppId(row: OurProductRankRow, datesAsc: string[]): string {
  for (let i = datesAsc.length - 1; i >= 0; i--) {
    const m = row.appIdsByDate[datesAsc[i]];
    if (m?.ios) return m.ios;
    if (m?.android) return m.android;
  }
  const firstSeriesId = row.series.find((s) => s.appId.trim())?.appId;
  return firstSeriesId ?? '';
}

function seriesRankStats(series: OurProductRankSeries): { latest: number | null; best: number | null } {
  const values = Object.values(series.ranksByDate).filter((rank): rank is number => rank != null);
  if (values.length === 0) return { latest: null, best: null };
  const latestDate = Object.keys(series.ranksByDate)
    .filter((date) => series.ranksByDate[date] != null)
    .sort()
    .at(-1);
  return {
    latest: latestDate ? series.ranksByDate[latestDate] ?? null : null,
    best: Math.min(...values),
  };
}

function rankDomainMax(values: number[]): number {
  if (values.length === 0) return 100;
  const max = Math.max(...values);
  if (max <= 60) return Math.ceil(max / 10) * 10;
  if (max <= 120) return Math.ceil(max / 20) * 20;
  return Math.ceil(max / 50) * 50;
}

interface OurProductTraceViewProps {
  data: OurProductRankAnalytics;
}

const OurProductTraceView = ({ data }: OurProductTraceViewProps) => {
  const { dates, products } = data;
  const [ownInternalName, setOwnInternalName] = useState<string>(() => {
    const firstOwn = products.find((p) => !isCompetitorRow(p));
    return firstOwn?.internalName ?? products[0]?.internalName ?? '';
  });
  const [selectedVariantInternalName, setSelectedVariantInternalName] = useState<string>('');
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'ios' | 'android'>('all');
  const [dateWindow, setDateWindow] = useState<'30' | 'all'>('30');

  const ownProducts = useMemo(() => {
    const rows = products.filter((p) => !isCompetitorRow(p));
    return rows.length > 0 ? rows : products;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ownProducts;
    return ownProducts.filter(
      (p) =>
        p.internalName.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q)
    );
  }, [ownProducts, search]);

  const ownRow = useMemo(
    () => ownProducts.find((p) => p.internalName === ownInternalName) ?? ownProducts[0],
    [ownProducts, ownInternalName]
  );

  const competitorRows = useMemo(() => {
    if (!ownRow) return [];
    const base = baseInternalName(ownRow);
    return products
      .filter((p) => isCompetitorRow(p) && baseInternalName(p) === base)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh'));
  }, [products, ownRow]);

  const variantRows = useMemo(() => {
    if (!ownRow) return [];
    return [ownRow, ...competitorRows];
  }, [ownRow, competitorRows]);

  const row = useMemo(
    () =>
      variantRows.find((p) => p.internalName === selectedVariantInternalName) ??
      ownRow,
    [variantRows, selectedVariantInternalName, ownRow]
  );

  useEffect(() => {
    if (!ownRow && ownProducts[0]) setOwnInternalName(ownProducts[0].internalName);
  }, [ownRow, ownProducts]);

  useEffect(() => {
    if (!ownRow) return;
    if (!variantRows.some((p) => p.internalName === selectedVariantInternalName)) {
      setSelectedVariantInternalName(ownRow.internalName);
    }
  }, [ownRow, variantRows, selectedVariantInternalName]);

  const visibleDates = useMemo(() => {
    if (dateWindow === 'all') return dates;
    return dates.slice(-30);
  }, [dates, dateWindow]);

  const visibleSeries = useMemo(() => {
    if (!row) return [];
    return row.series
      .filter((s) => platformFilter === 'all' || s.platform === platformFilter)
      .filter((s) => visibleDates.some((date) => s.ranksByDate[date] != null));
  }, [row, platformFilter, visibleDates]);

  const chartData = useMemo(
    () =>
      visibleDates.map((date) => {
        const point: Record<string, string | number | null> = { date };
        for (const s of visibleSeries) point[s.key] = s.ranksByDate[date] ?? null;
        return point;
      }),
    [visibleDates, visibleSeries]
  );

  const allVisibleRanks = useMemo(
    () =>
      visibleSeries.flatMap((s) =>
        visibleDates
          .map((date) => s.ranksByDate[date])
          .filter((rank): rank is number => rank != null)
      ),
    [visibleSeries, visibleDates]
  );

  const yMax = rankDomainMax(allVisibleRanks);
  const titleStUrl = row ? buildSensorTowerOverviewUrl(pickStAppId(row, dates), 'US') : '';

  if (products.length === 0) {
    return (
      <div className="border-2 border-ink bg-white p-8 text-center text-inkLight shadow-brutal-sm">
        暂无产品数据。
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-5 min-h-[520px]">
      <aside className="border-2 border-ink bg-white shadow-brutal-sm p-3 flex flex-col max-h-[620px]">
        <input
          type="search"
          placeholder="搜索产品"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-3 w-full border-2 border-ink bg-surface px-3 py-2 text-sm font-medium outline-none focus:bg-white"
        />
        <div className="overflow-y-auto flex-1 space-y-1 pr-1">
          {filteredProducts.map((p) => {
            const active = p.internalName === ownRow?.internalName;
            return (
              <button
                key={p.internalName}
                type="button"
                onClick={() => {
                  setOwnInternalName(p.internalName);
                  setSelectedVariantInternalName(p.internalName);
                }}
                className={`w-full border px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? 'border-ink bg-ink text-surface font-bold'
                    : 'border-slate-200 text-ink hover:border-ink hover:bg-slate-50'
                }`}
              >
                <span className="line-clamp-2">{p.displayName}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="min-w-0 border-2 border-ink bg-white shadow-brutal-sm overflow-hidden">
        {row && (
          <>
            <div className="border-b-2 border-ink bg-surface px-4 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-widest text-inkLight">
                    Category Rankings · US Free · {visibleDates[0] ?? '—'} to {visibleDates.at(-1) ?? '—'}
                  </p>
                  <h2 className="mt-1 text-2xl font-display font-bold text-ink break-words">
                    {titleStUrl ? (
                      <a
                        href={titleStUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {row.displayName}
                      </a>
                    ) : (
                      row.displayName
                    )}
                  </h2>
                  {ownRow && (
                    <div className="mt-3 max-w-md">
                      <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-inkLight">
                        竞品
                      </label>
                      <select
                        value={row?.internalName ?? ownRow.internalName}
                        onChange={(e) => setSelectedVariantInternalName(e.target.value)}
                        className="w-full border-2 border-ink bg-white px-3 py-2 text-sm font-bold text-ink outline-none focus:bg-surface disabled:border-slate-300 disabled:text-slate-400"
                      >
                        <option value={ownRow.internalName}>我方产品 | {ownRow.displayName}</option>
                        {competitorRows.map((competitor) => (
                          <option key={competitor.internalName} value={competitor.internalName}>
                            竞品 | {competitor.displayName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'ios', 'android'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPlatformFilter(value)}
                      className={`border-2 border-ink px-3 py-1.5 text-xs font-bold uppercase ${
                        platformFilter === value ? 'bg-ink text-surface' : 'bg-white text-ink hover:bg-slate-100'
                      }`}
                    >
                      {value === 'all' ? 'All' : value}
                    </button>
                  ))}
                  {(['30', 'all'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDateWindow(value)}
                      className={`border-2 border-ink px-3 py-1.5 text-xs font-bold uppercase ${
                        dateWindow === value ? 'bg-accent text-ink' : 'bg-white text-ink hover:bg-slate-100'
                      }`}
                    >
                      {value === '30' ? '30D' : 'All'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-2 pt-4 pb-2 sm:px-4">
              {visibleSeries.length === 0 ? (
                <div className="h-[360px] flex items-center justify-center text-sm text-inkLight">
                  当前筛选下暂无可绘制的排名数据。
                </div>
              ) : (
                <div className="h-[420px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 12, right: 22, left: 0, bottom: 44 }}>
                      <CartesianGrid stroke="#d4d4d8" strokeDasharray="0" />
                      <XAxis
                        dataKey="date"
                        interval="preserveStartEnd"
                        minTickGap={26}
                        tickFormatter={(v) => String(v).slice(5)}
                        tick={{ fill: '#27272a', fontSize: 12, fontWeight: 600 }}
                        angle={-42}
                        textAnchor="end"
                        height={58}
                      />
                      <YAxis
                        reversed
                        domain={[1, yMax]}
                        allowDecimals={false}
                        tick={{ fill: '#27272a', fontSize: 12, fontWeight: 700 }}
                        width={42}
                      />
                      <ReferenceLine y={1} stroke="#111110" strokeWidth={2} />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const rows = payload
                            .filter((p) => p.value != null)
                            .sort((a, b) => Number(a.value) - Number(b.value));
                          return (
                            <div className="max-w-[320px] border-2 border-ink bg-white px-4 py-3 shadow-brutal-sm">
                              <p className="mb-2 text-sm font-bold text-ink">{String(label)}</p>
                              <div className="space-y-1.5">
                                {rows.map((p) => (
                                  <div key={String(p.dataKey)} className="flex items-center justify-between gap-4 text-xs">
                                    <span className="min-w-0 truncate font-semibold text-inkLight">
                                      <span
                                        className="mr-2 inline-block h-2.5 w-2.5 align-middle"
                                        style={{ backgroundColor: p.color }}
                                      />
                                      {p.name}
                                    </span>
                                    <span className="font-bold tabular-nums text-ink">#{Number(p.value)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        align="left"
                        wrapperStyle={{ paddingTop: 12, fontSize: 12, fontWeight: 700 }}
                      />
                      {visibleSeries.map((s, index) => (
                        <Line
                          key={s.key}
                          type="monotone"
                          dataKey={s.key}
                          name={s.label}
                          stroke={COLORS[index % COLORS.length]}
                          strokeWidth={3}
                          dot={false}
                          activeDot={{ r: 5, strokeWidth: 2 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="grid gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleSeries.slice(0, 9).map((s, index) => {
                const stats = seriesRankStats(s);
                return (
                  <div key={s.key} className="flex items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-ink">
                        <span
                          className="mr-2 inline-block h-2.5 w-2.5 align-middle"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        {s.label}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs font-bold tabular-nums text-inkLight">
                      最新 {stats.latest == null ? '—' : `#${stats.latest}`} · 最好 {stats.best == null ? '—' : `#${stats.best}`}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
};

export default OurProductTraceView;
