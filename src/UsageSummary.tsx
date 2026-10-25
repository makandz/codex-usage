import type { Metric, Totals, UsageReport } from '../shared/types.ts';
import { compact, costLabel, hasPrice, money, percent } from './format.ts';
import { Icon } from './Icon.tsx';
import UsageChart from './UsageChart.tsx';

type UsageSummaryProps = {
  report: UsageReport;
  metric: Metric;
};

/**
 * Render the selected period's headline, chart, and token composition.
 * @param props Report and metric selected in the dashboard controls.
 * @returns Summary sections sharing the same report totals.
 */
export function UsageSummary({ report, metric }: UsageSummaryProps) {
  const { totals } = report;
  const inputTokens = totals.input + totals.cached;
  const cacheRate = inputTokens > 0 ? totals.cached / inputTokens : 0;
  const costSelected = metric === 'cost';
  const chartInterval = report.range === '24h' ? 'Hourly' : 'Daily';
  const chartUnit = costSelected ? 'USD' : 'TOKENS';
  const hasUnpricedDays = costSelected && report.series.some(point => !hasPrice(point));

  return (
    <>
      <section className="overview" aria-label="Usage summary">
        <div className="hero-summary">
          <div className="summary-caption">
            {costSelected ? 'ESTIMATED COST' : 'PROCESSED TOKENS'}
          </div>
          <div className="hero-value">
            {costSelected ? costLabel(totals) : compact(totals.tokens)}
          </div>
          <p className="hero-meta">
            {report.sessions} {report.sessions === 1 ? 'session' : 'sessions'}
            {costSelected && (
              <>
                <span className="meta-separator">·</span>
                API estimate{' '}
                <span title="USD estimate from recorded tokens at published API rates. This is not your subscription bill.">
                  <Icon name="info" />
                </span>
              </>
            )}
          </p>
          <p className="cache-rate">{percent(cacheRate)} cache hit rate</p>
        </div>

        <div className="chart-section">
          <div className="chart-heading">
            <h2>{chartInterval} {costSelected ? 'cost' : 'processed tokens'}</h2>
            <span>
              {hasUnpricedDays ? (
                <span
                  className="chart-key"
                  title="These days contain usage with no verified price. Their cost is unknown, not zero."
                >
                  <i /> Unpriced days
                </span>
              ) : (
                chartUnit
              )}
            </span>
          </div>
          <UsageChart report={report} metric={metric} />
          {totals.requests === 0 && (
            <p className="empty-caption">
              No recorded usage in this period. Try a wider date range.
            </p>
          )}
        </div>
      </section>

      <TokenTotals totals={totals} />
      <section
        className="composition-section"
        aria-label={`${costSelected ? 'Cost' : 'Tokens'} by type`}
      >
        <h2>{costSelected ? 'Cost' : 'Tokens'} by type</h2>
        <Composition metric={metric} totals={totals} />
      </section>
    </>
  );
}

/** Display token categories and the priced portion of cache savings. */
function TokenTotals({ totals }: { totals: Totals }) {
  const stats = [
    { label: 'Processed tokens', value: compact(totals.tokens), type: 'processed' },
    { label: 'Cached input', value: compact(totals.cached), type: 'cached' },
    { label: 'Uncached input', value: compact(totals.input), type: 'input' },
    { label: 'Output', value: compact(totals.output), type: 'output' },
    { label: 'Cache savings', value: hasPrice(totals) ? money(totals.savings) : '—', type: 'savings' },
  ];

  return (
    <section className="totals-section" aria-label="Token totals">
      <div className="section-heading">
        <h2>Totals</h2>
      </div>
      <div className="totals-grid">
        {stats.map(stat => (
          <div key={stat.type} className={`stat stat-${stat.type}`}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Show the relative input, cached-input, and output contributions to the selected metric. */
function Composition({ metric, totals }: { metric: Metric; totals: Totals }) {
  const costSelected = metric === 'cost';
  const parts = [
    { label: 'Input', value: costSelected ? totals.inputCost : totals.input, color: 'input' },
    { label: 'Cache read', value: costSelected ? totals.cachedCost : totals.cached, color: 'cached' },
    { label: 'Output', value: costSelected ? totals.outputCost : totals.output, color: 'output' },
  ];
  const sum = parts.reduce((total, part) => total + part.value, 0);
  const labels = parts.map(part => ({
    ...part,
    formatted: costSelected ? money(part.value) : compact(part.value),
  }));
  const description = labels.map(part => `${part.label}: ${part.formatted}`).join(', ');

  return (
    <div className="composition">
      <div className="composition-bar" role="img" aria-label={description}>
        {parts.map(part => part.value > 0 && (
          <span
            key={part.label}
            className={part.color}
            style={{ flex: part.value / sum }}
          />
        ))}
      </div>
      <div className="composition-legend">
        {labels.map(part => (
          <span key={part.label}>
            <i className={part.color} />
            {part.label}
            <strong>{part.formatted}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
