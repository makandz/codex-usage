import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { Metric, UsageReport } from '../shared/types.ts';
import { compact, costLabel, money } from './format.ts';
import { chartPoints } from './chart-data.ts';

type UsageChartProps = {
  report: UsageReport;
  metric: Metric;
};

type UsageTooltipProps = {
  point: UsageReport['series'][number];
  metric: Metric;
  hourly: boolean;
};

/**
 * Plot daily or hourly usage, marking entirely unpriced buckets separately from zero cost.
 * @param props Selected report and metric.
 * @returns Responsive area chart with accessible labels and a usage tooltip.
 */
export default function UsageChart({ report, metric }: UsageChartProps) {
  const points = chartPoints(report.series, metric);
  const hourly = report.range === '24h';
  const metricLabel = metric === 'cost' ? 'Estimated cost in US dollars' : 'Processed tokens';

  /** Match axis labels to the report's hourly or daily buckets. */
  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString('en-US', hourly
      ? { hour: 'numeric' }
      : { month: 'short', day: 'numeric' });
  }

  /** Format the numeric axis using the currently selected metric. */
  function formatValue(value: number): string {
    return metric === 'cost' ? money(Number(value)) : compact(Number(value));
  }

  /** Resolve the hovered timestamp against typed report data instead of casting library payloads. */
  function renderTooltip({ active, label, payload }: TooltipContentProps) {
    if (!active || !payload.length) {
      return null;
    }

    const point = report.series.find(point => point.timestamp === label);
    return point ? <UsageTooltip point={point} metric={metric} hourly={hourly} /> : null;
  }

  return (
    <div
      className="chart"
      role="img"
      aria-label={`${metricLabel} over the selected period. Exact daily values are in the Day breakdown.`}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart
          data={points}
          margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
          accessibilityLayer
        >
          <defs>
            <linearGradient id="usage-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-color)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--chart-color)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#24262f" vertical={false} strokeDasharray="3 5" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatDate}
            minTickGap={50}
            tickLine={false}
            axisLine={false}
            padding={{ left: 6, right: 6 }}
            tick={{ fill: '#737986', fontSize: 11 }}
            dy={8}
          />
          <YAxis
            tickFormatter={formatValue}
            tickLine={false}
            axisLine={false}
            width={60}
            tick={{ fill: '#737986', fontSize: 11 }}
            tickCount={5}
            domain={[0, 'auto']}
          />
          <Tooltip
            content={renderTooltip}
            cursor={{ stroke: '#656982', strokeDasharray: '3 4' }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--chart-color)"
            strokeWidth={2.3}
            fill="url(#usage-fill)"
            isAnimationActive={false}
            dot={points.length === 1 ? { r: 4 } : false}
            activeDot={{ r: 4, strokeWidth: 4, stroke: '#242735' }}
          />
          {metric === 'cost' && (
            <Area
              dataKey="unpricedValue"
              stroke="none"
              fill="none"
              isAnimationActive={false}
              dot={{ r: 4, fill: '#bcaa83', stroke: '#0e1014', strokeWidth: 2 }}
              activeDot={{ r: 5, fill: '#bcaa83' }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Display a chart bucket's exact value and any unpriced requests it contains. */
function UsageTooltip({ point, metric, hourly }: UsageTooltipProps) {
  const date = new Date(point.timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(hourly ? { hour: 'numeric' } : {}),
  });
  const value = metric === 'cost' ? costLabel(point) : compact(point.tokens);

  return (
    <div className="chart-tooltip">
      <span>{date}</span>
      <strong>{value}</strong>
      {point.unpriced > 0 && <small>{point.unpriced} unpriced requests</small>}
    </div>
  );
}
