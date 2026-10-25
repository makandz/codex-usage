import { report } from './report.ts';
import type { UsageStore } from './store.ts';
import type { ScanStatus, UsageSnapshot } from '../shared/types.ts';

export function renderSnapshot(template: string, store: UsageStore, scan: ScanStatus, now = Date.now()): string {
  const reports: UsageSnapshot = {
    '24h': report(store, '24h', scan, now),
    '7d': report(store, '7d', scan, now),
    '30d': report(store, '30d', scan, now),
    '90d': report(store, '90d', scan, now),
    all: report(store, 'all', scan, now),
  };
  // Log metadata must stay JSON, even if it contains an HTML closing tag.
  const json = JSON.stringify(reports).replaceAll('<', '\\u003c');
  if (!template.includes('__CODEX_USAGE_DATA__')) throw new Error('Snapshot template is missing usage data.');
  return template.replace('__CODEX_USAGE_DATA__', () => json);
}
