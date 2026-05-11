import {
  LineChart, Line,
  BarChart, Bar,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

export type ChartSeries = {
  key: string;
  name: string;
  color?: string | null;
};

export type ChartPayload = {
  type: 'line' | 'bar' | 'area' | 'table';
  title?: string;
  xKey: string;
  series: ChartSeries[];
  data: Record<string, unknown>[];
};

const DEFAULT_COLORS = [
  '#0055FF', '#FF4500', '#10B981', '#8B5CF6', '#F59E0B',
  '#EC4899', '#06B6D4', '#84CC16', '#6366F1', '#F97316',
];

type ChartBlockProps = {
  chart: ChartPayload;
};

export function ChartBlock({ chart }: ChartBlockProps) {
  const { type, title, xKey, series, data } = chart;

  if (type === 'table' || !data || data.length === 0) {
    return <ChartTable chart={chart} />;
  }

  return (
    <div className="my-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      {title && (
        <div className="mb-2 text-xs font-semibold text-slate-800">{title}</div>
      )}
      <ResponsiveContainer width="100%" height={220}>
        {type === 'bar' ? (
          <BarChart data={data} margin={{ top: 4, right: 12, left: -10, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={48} />
            <YAxis tick={{ fontSize: 10 }} width={40} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E2E8F0' }}
              formatter={(value) => [String(value ?? ''), '']}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                fill={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        ) : type === 'area' ? (
          <AreaChart data={data} margin={{ top: 4, right: 12, left: -10, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={48} />
            <YAxis tick={{ fontSize: 10 }} width={40} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E2E8F0' }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                fill={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 4, right: 12, left: -10, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={48} />
            <YAxis tick={{ fontSize: 10 }} width={40} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E2E8F0' }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function ChartTable({ chart }: ChartBlockProps) {
  const { title, xKey, series, data } = chart;
  if (!data || data.length === 0) return null;

  return (
    <div className="my-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      {title && (
        <div className="mb-2 text-xs font-semibold text-slate-800">{title}</div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-[11px] border-collapse border border-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold border border-slate-200">{xKey}</th>
              {series.map((s) => (
                <th key={s.key} className="px-2 py-1.5 text-left font-semibold border border-slate-200">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="px-2 py-1 border border-slate-100 font-medium">{String(row[xKey] ?? '')}</td>
                {series.map((s) => (
                  <td key={s.key} className="px-2 py-1 border border-slate-100">
                    {row[s.key] != null ? String(row[s.key]) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
