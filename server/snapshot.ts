import { report } from './report.ts';
import type { UsageStore } from './store.ts';
import type { ScanStatus, UsageSnapshot } from '../shared/types.ts';

/**
 * Embed every report into the standalone dashboard without allowing HTML injection.
 * @param template Built HTML containing the usage-data placeholder.
 * @param store Retained usage history.
 * @param scan Import status shared by all date ranges.
 * @param now Common report cutoff in milliseconds since the epoch.
 * @returns Self-contained dashboard HTML with escaped JSON data.
 */
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

  if (!template.includes('__CODEX_USAGE_DATA__')) {
    throw new Error('Snapshot template is missing usage data.');
  }

  // A callback keeps dollar sequences in log metadata literal during replacement.
  return template.replace('__CODEX_USAGE_DATA__', () => json);
}
