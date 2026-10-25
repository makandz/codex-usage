import type { Breakdown, Range, ScanStatus, Totals, UsageReport } from '../shared/types.ts';
import type { SavedEvent, UsageStore } from './store.ts';

export const emptyTotals = (): Totals => ({ input: 0, cached: 0, output: 0, tokens: 0, cost: 0,
  inputCost: 0, cachedCost: 0, outputCost: 0, savings: 0, requests: 0, unpriced: 0, assumedStandard: 0 });

function add(total: Totals, event: SavedEvent) {
  total.input += event.input - event.cached;
  total.cached += event.cached;
  total.output += event.output;
  total.tokens += event.input + event.output;
  total.requests++;
  if (event.tier === null) total.assumedStandard++;
  if (!event.price) { total.unpriced++; return; }
  total.inputCost += event.price.inputCost;
  total.cachedCost += event.price.cachedCost;
  total.outputCost += event.price.outputCost;
  total.cost += event.price.inputCost + event.price.cachedCost + event.price.outputCost;
  total.savings += event.price.savings;
}

export function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function report(store: UsageStore, range: Range, scan: ScanStatus, now = Date.now()): UsageReport {
  const start = new Date(now);
  if (range === '24h') start.setTime(now - 24 * 60 * 60 * 1000);
  else if (range === 'all') start.setTime(0);
  else { start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (Number.parseInt(range) - 1)); }
  const events = store.events(start.getTime(), now);
  const totals = emptyTotals();
  const sessions = new Set<string>();
  const models = new Map<string, Breakdown>();
  const days = new Map<string, Breakdown>();
  const groups = new Map<string, Set<string>>();
  const series = new Map<number, UsageReport['series'][number]>();
  const bucket = (timestamp: number) => {
    if (range === '24h') return Math.floor(timestamp / 3_600_000) * 3_600_000;
    const date = new Date(timestamp); date.setHours(0, 0, 0, 0); return date.getTime();
  };
  // Don't imply zero usage before the retained history starts. Keep interior and trailing quiet days.
  const first = range === '24h' ? start.getTime() : events[0]?.timestamp ?? now;
  for (let t = bucket(first); t <= now;) {
    series.set(t, { timestamp: t, cost: 0, tokens: 0, unpriced: 0, requests: 0 });
    if (range === '24h') t += 3_600_000;
    else { const next = new Date(t); next.setDate(next.getDate() + 1); t = next.getTime(); }
  }
  for (const event of events) {
    add(totals, event); sessions.add(event.session);
    const day = dayKey(event.timestamp);
    for (const [map, key] of [[models, event.model], [days, day]] as const) {
      let group = map.get(key);
      if (!group) { group = { key, label: key, ...emptyTotals(), sessions: 0 }; map.set(key, group); }
      add(group, event);
      const groupID = `${map === models ? 'model' : 'day'}:${key}`;
      if (!groups.has(groupID)) groups.set(groupID, new Set());
      const members = groups.get(groupID)!;
      members.add(event.session); group.sessions = members.size;
    }
    const point = series.get(bucket(event.timestamp))!;
    point.tokens += event.input + event.output;
    point.requests++;
    point.unpriced += event.price ? 0 : 1;
    if (event.price) point.cost += event.price.inputCost + event.price.cachedCost + event.price.outputCost;
  }
  return { totals, sessions: sessions.size, models: [...models.values()], days: [...days.values()].reverse(),
    series: [...series.values()], scan, range,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, retainedSessions: store.sessionCount() };
}
