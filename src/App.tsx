import { useState } from 'react';
import type { Breakdown, Metric, Range, UsageReport, UsageSnapshot } from '../shared/types.ts';
import { compact, money } from './format.ts';
import UsageChart from './UsageChart.tsx';

const ranges: { value: Range; label: string }[] = [
  { value: '24h', label: 'Past 24h' }, { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: 'all', label: 'All time' },
];
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const shortDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
  month: 'short', day: 'numeric',
});
const hasPrice = (value: { requests: number; unpriced: number }) => value.requests === 0 || value.unpriced < value.requests;
function costLabel(value: { cost: number; requests: number; unpriced: number }) {
  return hasPrice(value) ? money(value.cost) : 'Unpriced';
}

function Icon({ name }: { name: 'chart' | 'info' }) {
  return <svg width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'chart' && <><path d="M5 18v-5m7 5V7m7 11V3" /><path d="M3 22h18" /></>}
    {name === 'info' && <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>}
  </svg>;
}

export function App({ snapshot }: { snapshot: UsageSnapshot }) {
  const [range, setRange] = useState<Range>('30d');
  const [metric, setMetric] = useState<Metric>('cost');
  const [group, setGroup] = useState<'model' | 'day'>('model');
  const data = snapshot[range];
  const totals = data.totals;
  const cacheRate = totals.input || totals.cached ? totals.cached / (totals.input + totals.cached) : 0;
  const rows = [...(group === 'model' ? data.models : data.days)];
  if (group === 'model') rows.sort((a, b) => metric === 'cost'
    ? Number(hasPrice(b)) - Number(hasPrice(a)) || b.cost - a.cost || b.tokens - a.tokens : b.tokens - a.tokens);

  return <div className="app-shell">
    <header className="site-header">
      <a href="#" className="brand" aria-label="Codex Usage home">
        <span className="brand-mark"><Icon name="chart" /></span>
        <h1>Codex<span className="brand-light"> / Usage</span></h1>
      </a>
        <div className="heading-status" role="status" aria-live="polite">
          <span className="status-dot" />
          Snapshot{data.scan.lastScan ? ` · ${new Date(data.scan.lastScan).toLocaleString([], {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          })}` : ''}
        </div>
    </header>

    <main>

      <div className="toolbar">
        <div className="segmented metric-control" role="group" aria-label="Display metric">
          {(['cost', 'tokens'] as const).map(value => <button key={value} type="button" aria-pressed={metric === value}
            className={metric === value ? 'selected' : ''} onClick={() => setMetric(value)}>
            {value === 'cost' ? 'Cost' : 'Tokens'}
          </button>)}
        </div>
        <div className="range-controls">
          <div className="segmented" role="group" aria-label="Date range">
            {ranges.map(item => <button key={item.value} type="button" aria-pressed={range === item.value}
              className={range === item.value ? 'selected' : ''} onClick={() => setRange(item.value)}>{item.label}</button>)}
          </div>
        </div>
      </div>

      {data.scan.error && <div className="notice error" role="alert">Import failed: {data.scan.error}. Saved usage is still available.</div>}
      {data.scan.warnings.length > 0 && <details className="notice"><summary>Import notes ({data.scan.warnings.length})</summary>
        <ul>{data.scan.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}

      <section className="overview" aria-label="Usage summary">
        <div className="hero-summary">
          <div className="summary-caption">{metric === 'cost' ? 'ESTIMATED COST' : 'PROCESSED TOKENS'}</div>
          <div className="hero-value">
            {metric === 'cost' ? costLabel(totals) : compact(totals.tokens)}
          </div>
          <p className="hero-meta">{data.sessions} {data.sessions === 1 ? 'session' : 'sessions'}
            {metric === 'cost' && <><span className="meta-separator">·</span>API estimate <span title="USD estimate from recorded tokens at published API rates. This is not your subscription bill."><Icon name="info" /></span></>}
          </p>
          <p className="cache-rate">{percent(cacheRate)} cache hit rate</p>
        </div>
        <div className="chart-section">
          <div className="chart-heading"><h2>{range === '24h' ? 'Hourly' : 'Daily'} {metric === 'cost' ? 'cost' : 'processed tokens'}</h2>
            <span>{metric === 'cost' && data.series.some(point => point.requests > 0 && point.requests === point.unpriced)
              ? <span className="chart-key" title="These days contain usage with no verified price. Their cost is unknown, not zero."><i /> Unpriced days</span>
              : metric === 'cost' ? 'USD' : 'TOKENS'}</span></div>
          <UsageChart report={data} metric={metric} />
          {totals.requests === 0 && <p className="empty-caption">No recorded usage in this period. Try a wider date range.</p>}
        </div>
      </section>

      <section className="totals-section" aria-label="Token totals">
        <div className="section-heading"><h2>Totals</h2></div>
        <div className="totals-grid">
          {[
            ['Processed tokens', compact(totals.tokens), 'processed'], ['Cached input', compact(totals.cached), 'cached'],
            ['Uncached input', compact(totals.input), 'input'], ['Output', compact(totals.output), 'output'],
            ['Cache savings', hasPrice(totals) ? money(totals.savings) : '—', 'savings'],
          ].map(([label, value, type]) => <div key={label} className={`stat stat-${type}`}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
      </section>

      <section className="composition-section" aria-label={`${metric === 'cost' ? 'Cost' : 'Tokens'} by type`}>
        <h2>{metric === 'cost' ? 'Cost' : 'Tokens'} by type</h2>
        <Composition metric={metric} totals={totals} />
      </section>

      <section className="breakdown-section">
        <div className="section-heading"><h2>Breakdown</h2>
          <div className="segmented small" role="group" aria-label="Breakdown grouping">
            {(['model', 'day'] as const).map(value => <button key={value} type="button" aria-pressed={group === value}
              className={group === value ? 'selected' : ''} onClick={() => setGroup(value)}>{value === 'model' ? 'Model' : 'Day'}</button>)}
          </div>
        </div>
        <div className="table-scroll"><table><thead><tr><th className="rank">#</th><th>{group === 'model' ? 'Model' : 'Day'}</th>
          <th>Cost <span className="column-unit">USD</span></th><th>Share</th><th>Tokens</th></tr></thead>
          <tbody>{rows.map((row, index) => <BreakdownRow key={row.key} row={row} index={index} metric={metric}
            group={group} total={metric === 'cost' ? totals.cost : totals.tokens} />)}</tbody>
        </table>{!rows.length && <div className="table-empty">Your usage will appear here.</div>}</div>
      </section>

      {totals.unpriced > 0 && <p className="pricing-note"><Icon name="info" />
        {totals.unpriced} requests have no verified price. Tokens are included; cost and savings show the priced subtotal.
      </p>}
      <footer className="page-footer"><span>{data.timeZone} · USD · Run <code>pnpm start</code> to update</span>
      <details className="methodology"><summary>About these numbers</summary><p>
        Input and output count once. Cached input is part of input; reasoning is part of output.
        Cost estimates use base API rates and recorded speed tiers, without a long-context uplift.
        Missing tiers assume Standard speed ({totals.assumedStandard} requests in this period).
        Codex auto-review is counted at $0, with its tokens retained.
        Unknown models and cache-write requests without retention details stay unpriced.
        Cache savings compare priced cached input with the same requests at uncached rates.
        Daily charts start at the first recorded day in the selected period; amber dots mark days with entirely unpriced usage.
        Only imported logs are covered. Deleted logs cannot be recovered before their first import.
        {' '}{data.retainedSessions} sessions retained across all dates.
      </p><a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">Pricing reference ↗</a></details></footer>
    </main>
  </div>;
}

function Composition({ metric, totals }: { metric: Metric; totals: UsageReport['totals'] }) {
  const parts = [
    { label: 'Input', value: metric === 'cost' ? totals.inputCost : totals.input, color: 'input' },
    { label: 'Cache read', value: metric === 'cost' ? totals.cachedCost : totals.cached, color: 'cached' },
    { label: 'Output', value: metric === 'cost' ? totals.outputCost : totals.output, color: 'output' },
  ];
  const sum = parts.reduce((total, part) => total + part.value, 0);
  return <div className="composition"><div className="composition-bar" role="img" aria-label={parts.map(p => `${p.label}: ${metric === 'cost' ? money(p.value) : compact(p.value)}`).join(', ')}>
    {parts.map(part => part.value > 0 && <span className={part.color} key={part.label} style={{ flex: part.value / sum }} />)}
  </div><div className="composition-legend">{parts.map(part => <span key={part.label}><i className={part.color} />{part.label}
    <strong>{metric === 'cost' ? money(part.value) : compact(part.value)}</strong></span>)}</div></div>;
}

function BreakdownRow({ row, index, metric, group, total }: {
  row: Breakdown; index: number; metric: Metric; group: 'model' | 'day'; total: number;
}) {
  const share = total > 0 ? (metric === 'cost' ? row.cost : row.tokens) / total : 0;
  return <tr><td className="rank">{String(index + 1).padStart(2, '0')}</td><td className="model-cell">
    <div><span className="model-symbol">{group === 'model' ? '◈' : '↳'}</span><span>{group === 'model' ? row.label : shortDate(row.key)}</span>
      {group === 'model' && row.unpriced === row.requests && <span className="unpriced-tag">Unpriced</span>}
      {group === 'model' && row.key === 'codex-auto-review' && row.unpriced === 0 && <span className="free-tag">Free</span>}</div>
    <div className="share-track"><span style={{ width: `${share * 100}%` }} /></div>
  </td><td className={hasPrice(row) ? '' : 'muted'} title={row.unpriced ? `${row.unpriced} unpriced requests; amounts are partial.` : undefined}>
    {costLabel(row)}{row.unpriced > 0 && hasPrice(row) ? '*' : ''}</td>
    <td>{metric === 'cost' && !hasPrice(row) ? '—' : percent(share)}</td><td>{compact(row.tokens)}</td></tr>;
}
