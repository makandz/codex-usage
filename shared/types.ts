export type Range = '24h' | '7d' | '30d' | '90d' | 'all';
export type Metric = 'cost' | 'tokens';

export interface Totals {
  input: number;
  cached: number;
  output: number;
  tokens: number;
  cost: number;
  inputCost: number;
  cachedCost: number;
  outputCost: number;
  savings: number;
  requests: number;
  unpriced: number;
  assumedStandard: number;
}

export interface Breakdown extends Totals {
  key: string;
  label: string;
  sessions: number;
}

export interface ScanStatus {
  scanning: boolean;
  scannedFiles: number;
  totalFiles: number;
  imported: number;
  skippedFiles: number;
  lastScan: string | null;
  warnings: string[];
  error: string | null;
}

export interface UsageReport {
  totals: Totals;
  sessions: number;
  models: Breakdown[];
  days: Breakdown[];
  series: { timestamp: number; tokens: number; cost: number; unpriced: number; requests: number }[];
  scan: ScanStatus;
  timeZone: string;
  range: Range;
  retainedSessions: number;
}
