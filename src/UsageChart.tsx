import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Metric, UsageReport } from '../shared/types.ts';
import { compact, money } from './format.ts';
import { chartPoints } from './chart-data.ts';

export default function UsageChart({ report, metric }: { report: UsageReport; metric: Metric }) {
  const points = chartPoints(report.series, metric);
  const date = (timestamp: number) => new Date(timestamp).toLocaleString('en-US', report.range === '24h'
    ? { hour: 'numeric' } : { month: 'short', day: 'numeric' });
  return <div className="chart" role="img" aria-label={`${metric === 'cost' ? 'Estimated cost in US dollars' : 'Processed tokens'} over the selected period. Exact daily values are in the Day breakdown.`}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <AreaChart data={points} margin={{ top: 12, right: 12, left: 0, bottom: 4 }} accessibilityLayer>
        <defs><linearGradient id="usage-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-color)" stopOpacity={0.18} />
          <stop offset="100%" stopColor="var(--chart-color)" stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid stroke="#24262f" vertical={false} strokeDasharray="3 5" />
        <XAxis dataKey="timestamp" tickFormatter={date} minTickGap={50} tickLine={false} axisLine={false}
          padding={{ left: 6, right: 6 }} tick={{ fill: '#737986', fontSize: 11 }} dy={8} />
        <YAxis tickFormatter={value => metric === 'cost' ? money(Number(value)) : compact(Number(value))}
          tickLine={false} axisLine={false} width={60} tick={{ fill: '#737986', fontSize: 11 }} tickCount={5} domain={[0, 'auto']} />
        <Tooltip content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const point = payload[0]?.payload as UsageReport['series'][number] | undefined;
          if (!point) return null;
          return <div className="chart-tooltip"><span>{new Date(point.timestamp).toLocaleString('en-US', {
            month: 'short', day: 'numeric', ...(report.range === '24h' ? { hour: 'numeric' } : {}),
          })}</span><strong>{metric === 'cost' ? point.requests > 0 && point.requests === point.unpriced
              ? 'Unpriced' : money(point.cost) : compact(point.tokens)}</strong>
            {point.unpriced > 0 && <small>{point.unpriced} unpriced requests</small>}</div>;
        }} cursor={{ stroke: '#656982', strokeDasharray: '3 4' }} />
        <Area type="monotone" dataKey="value" stroke="var(--chart-color)" strokeWidth={2.3} fill="url(#usage-fill)"
          isAnimationActive={false} dot={points.length === 1 ? { r: 4 } : false} activeDot={{ r: 4, strokeWidth: 4, stroke: '#242735' }} />
        {metric === 'cost' && <Area dataKey="unpricedValue" stroke="none" fill="none" isAnimationActive={false}
          dot={{ r: 4, fill: '#bcaa83', stroke: '#0e1014', strokeWidth: 2 }} activeDot={{ r: 5, fill: '#bcaa83' }} />}
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
