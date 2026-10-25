import type { Metric, UsageReport } from '../shared/types.ts';

export function chartPoints(series: UsageReport['series'], metric: Metric) {
  return series.map(point => {
    const unpriced = metric === 'cost' && point.requests > 0 && point.requests === point.unpriced;
    return { ...point, value: metric === 'tokens' ? point.tokens : unpriced ? null : point.cost,
      unpricedValue: unpriced ? 0 : null };
  });
}
