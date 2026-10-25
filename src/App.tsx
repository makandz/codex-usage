import { useState } from 'react';
import type { Metric, Range, UsageReport, UsageSnapshot } from '../shared/types.ts';
import { Icon } from './Icon.tsx';
import { UsageSummary } from './UsageSummary.tsx';
import { UsageBreakdown } from './UsageBreakdown.tsx';

const ranges: { value: Range; label: string }[] = [
  { value: '24h', label: 'Past 24h' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

/**
 * Render an offline usage dashboard with date and metric controls.
 * @param props Precomputed reports for every supported date range.
 * @returns The dashboard for the currently selected report and metric.
 */
export function App({ snapshot }: { snapshot: UsageSnapshot }) {
  const [range, setRange] = useState<Range>('30d');
  const [metric, setMetric] = useState<Metric>('cost');
  const report = snapshot[range];
  const scanTime = report.scan.lastScan
    ? new Date(report.scan.lastScan).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    : null;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a href="#" className="brand" aria-label="Codex Usage home">
          <span className="brand-mark"><Icon name="chart" /></span>
          <h1>Codex<span className="brand-light"> / Usage</span></h1>
        </a>
        <div className="heading-status" role="status" aria-live="polite">
          <span className="status-dot" />
          Snapshot{scanTime ? ` · ${scanTime}` : ''}
        </div>
      </header>

      <main>
        <div className="toolbar">
          <div className="segmented metric-control" role="group" aria-label="Display metric">
            {(['cost', 'tokens'] as const).map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={metric === value}
                className={metric === value ? 'selected' : ''}
                onClick={() => setMetric(value)}
              >
                {value === 'cost' ? 'Cost' : 'Tokens'}
              </button>
            ))}
          </div>
          <div className="range-controls">
            <div className="segmented" role="group" aria-label="Date range">
              {ranges.map(item => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={range === item.value}
                  className={range === item.value ? 'selected' : ''}
                  onClick={() => setRange(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {report.scan.error && (
          <div className="notice error" role="alert">
            Import failed: {report.scan.error}. Saved usage is still available.
          </div>
        )}
        {report.scan.warnings.length > 0 && (
          <details className="notice">
            <summary>Import notes ({report.scan.warnings.length})</summary>
            <ul>
              {report.scan.warnings.map(warning => <li key={warning}>{warning}</li>)}
            </ul>
          </details>
        )}

        <UsageSummary report={report} metric={metric} />
        <UsageBreakdown report={report} metric={metric} />

        {report.totals.unpriced > 0 && (
          <p className="pricing-note">
            <Icon name="info" />
            {report.totals.unpriced} requests have no verified price. Tokens are included;
            cost and savings show the priced subtotal.
          </p>
        )}
        <ReportFooter report={report} />
      </main>
    </div>
  );
}

/** Explain snapshot freshness and the accounting assumptions behind the displayed totals. */
function ReportFooter({ report }: { report: UsageReport }) {
  return (
    <footer className="page-footer">
      <span>{report.timeZone} · USD · Run <code>pnpm start</code> to update</span>
      <details className="methodology">
        <summary>About these numbers</summary>
        <p>
          Input and output count once. Cached input is part of input; reasoning is part of output.
          Cost estimates use base API rates and recorded speed tiers, without a long-context uplift.
          Missing tiers assume Standard speed ({report.totals.assumedStandard} requests in this period).
          Codex auto-review is counted at $0, with its tokens retained.
          Unknown models and cache-write requests without retention details stay unpriced.
          Cache savings compare priced cached input with the same requests at uncached rates.
          Daily charts start at the first recorded day in the selected period; amber dots mark days with entirely unpriced usage.
          Only imported logs are covered. Deleted logs cannot be recovered before their first import.
          {' '}{report.retainedSessions} sessions retained across all dates.
        </p>
        <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">
          Pricing reference ↗
        </a>
      </details>
    </footer>
  );
}
