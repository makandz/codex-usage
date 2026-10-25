import type { Metric, UsageReport } from '../shared/types.ts';
import { hasPrice } from './format.ts';

type ChartPoint = UsageReport['series'][number] & {
  value: number | null;
  unpricedValue: number | null;
};

/**
 * Prepare chart values without plotting unknown costs as zero-dollar usage.
 * @param series Chronological report buckets.
 * @param metric Selected cost or token view.
 * @returns Chart points with separate markers for entirely unpriced cost buckets.
 */
export function chartPoints(series: UsageReport['series'], metric: Metric): ChartPoint[] {
  return series.map(point => {
    const unpriced = metric === 'cost' && !hasPrice(point);
    let value: number | null = point.tokens;

    if (metric === 'cost') {
      value = unpriced ? null : point.cost;
    }

    return {
      ...point,
      value,
      unpricedValue: unpriced ? 0 : null,
    };
  });
}
