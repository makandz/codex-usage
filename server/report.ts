import type { Breakdown, Range, ScanStatus, Totals, UsageReport } from '../shared/types.ts';
import type { SavedEvent, UsageStore } from './store.ts';

type BreakdownGroup = {
  totals: Breakdown;
  sessions: Set<string>;
};

/** Create independent counters for a report or breakdown group. */
function emptyTotals(): Totals {
  return {
    input: 0,
    cached: 0,
    output: 0,
    tokens: 0,
    cost: 0,
    inputCost: 0,
    cachedCost: 0,
    outputCost: 0,
    savings: 0,
    requests: 0,
    unpriced: 0,
    assumedStandard: 0,
  };
}

/** Count all tokens while restricting monetary totals to priced requests. */
function addUsage(total: Totals, event: SavedEvent): void {
  total.input += event.input - event.cached;
  total.cached += event.cached;
  total.output += event.output;
  total.tokens += event.input + event.output;
  total.requests++;

  if (event.tier === null) {
    total.assumedStandard++;
  }
  if (!event.price) {
    total.unpriced++;
    return;
  }
  total.inputCost += event.price.inputCost;
  total.cachedCost += event.price.cachedCost;
  total.outputCost += event.price.outputCost;
  total.cost += event.price.inputCost + event.price.cachedCost + event.price.outputCost;
  total.savings += event.price.savings;
}

/** Format a timestamp as a local calendar day, independent of UTC date boundaries. */
function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Resolve the rolling 24-hour window or inclusive calendar-day range. */
function rangeStart(range: Range, now: number): number {
  if (range === '24h') {
    return now - 24 * 60 * 60 * 1000;
  }
  if (range === 'all') {
    return 0;
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (Number.parseInt(range) - 1));
  return start.getTime();
}

/** Align chart points to whole hours or local midnight. */
function bucketStart(timestamp: number, range: Range): number {
  if (range === '24h') {
    return Math.floor(timestamp / 3_600_000) * 3_600_000;
  }
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Keep quiet buckets after retained history begins, including across DST changes. */
function createSeries(first: number, now: number, range: Range): Map<number, UsageReport['series'][number]> {
  const series = new Map<number, UsageReport['series'][number]>();
  let timestamp = bucketStart(first, range);

  while (timestamp <= now) {
    series.set(timestamp, { timestamp, cost: 0, tokens: 0, unpriced: 0, requests: 0 });
    if (range === '24h') {
      timestamp += 3_600_000;
    } else {
      const next = new Date(timestamp);
      next.setDate(next.getDate() + 1);
      timestamp = next.getTime();
    }
  }
  return series;
}

/** Aggregate one breakdown entry while counting its distinct sessions. */
function addToGroup(groups: Map<string, BreakdownGroup>, key: string, event: SavedEvent): void {
  let group = groups.get(key);
  if (!group) {
    group = {
      totals: { key, label: key, ...emptyTotals(), sessions: 0 },
      sessions: new Set(),
    };
    groups.set(key, group);
  }
  addUsage(group.totals, event);
  group.sessions.add(event.session);
  group.totals.sessions = group.sessions.size;
}

/**
 * Aggregate retained usage for a dashboard date range in the local timezone.
 * @param store Persistent usage history ordered by timestamp.
 * @param range Dashboard date preset to include.
 * @param scan Import status to display alongside the numbers.
 * @param now Inclusive end of the report in milliseconds since the epoch.
 * @returns Totals, model and day breakdowns, and a continuous chart series.
 */
export function report(store: UsageStore, range: Range, scan: ScanStatus, now = Date.now()): UsageReport {
  const start = rangeStart(range, now);
  const events = store.events(start, now);
  const totals = emptyTotals();
  const sessions = new Set<string>();
  const models = new Map<string, BreakdownGroup>();
  const days = new Map<string, BreakdownGroup>();
  // Daily charts do not imply zero usage before the retained history starts.
  const first = range === '24h' ? start : events[0]?.timestamp ?? now;
  const series = createSeries(first, now, range);

  for (const event of events) {
    addUsage(totals, event);
    sessions.add(event.session);
    addToGroup(models, event.model, event);
    addToGroup(days, dayKey(event.timestamp), event);

    const point = series.get(bucketStart(event.timestamp, range))!;
    point.tokens += event.input + event.output;
    point.requests++;
    if (event.price) {
      point.cost += event.price.inputCost + event.price.cachedCost + event.price.outputCost;
    } else {
      point.unpriced++;
    }
  }

  return {
    totals,
    sessions: sessions.size,
    models: Array.from(models.values(), group => group.totals),
    days: Array.from(days.values(), group => group.totals).reverse(),
    series: [...series.values()],
    scan,
    range,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    retainedSessions: store.sessionCount(),
  };
}
