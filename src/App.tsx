import { lazy, Suspense, useEffect, useState } from 'react';
import type { Breakdown, Metric, Range, UsageReport } from '../shared/types.ts';
import { compact, money } from './format.ts';

const UsageChart = lazy(() => import('./UsageChart.tsx'));

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

function Icon({ name, spinning = false }: { name: 'refresh' | 'chart' | 'info'; spinning?: boolean }) {
  return <svg className={spinning ? 'spin' : undefined} width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'refresh' && <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17" /></>}
    {name === 'chart' && <><path d="M5 18v-5m7 5V7m7 11V3" /><path d="M3 22h18" /></>}
    {name === 'info' && <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>}
  </svg>;
}

export function App() {
  const [range, setRange] = useState<Range>('30d');
  const [metric, setMetric] = useState<Metric>('cost');
  const [group, setGroup] = useState<'model' | 'day'>('model');
  const [data, setData] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const response = await fetch(`/api/usage?range=${range}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load usage. Check that the terminal server is still running.');
        const report = await response.json() as UsageReport;
        if (controller.signal.aborted) return;
        setData(report); setError(null);
        if (report.scan.scanning) timer = setTimeout(() => void load(), 1000);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load usage.');
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [range, revision]);

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch('/api/refresh', { method: 'POST' });
      if (!response.ok) throw new Error('Could not refresh. Check the terminal server.');
      setRevision(v => v + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Refresh failed.'); }
    finally { setRefreshing(false); }
  }

  const current = data?.range === range ? data : null;
  const busy = refreshing || Boolean(data?.scan.scanning);
  const totals = current?.totals;
  const cacheRate = totals?.input || totals?.cached ? totals.cached / (totals.input + totals.cached) : 0;
  const rows = current ? [...(group === 'model' ? current.models : current.days)] : [];
  if (group === 'model') rows.sort((a, b) => metric === 'cost'
    ? Number(hasPrice(b)) - Number(hasPrice(a)) || b.cost - a.cost || b.tokens - a.tokens : b.tokens - a.tokens);

  return <div className="app-shell">
    <header className="site-header">
      <a href="/" className="brand" aria-label="Codex Usage home">
        <span className="brand-mark"><Icon name="chart" /></span>
        <h1>Codex<span className="brand-light"> / Usage</span></h1>
      </a>
        <div className="heading-status" role="status" aria-live="polite">
          <span className={`status-dot ${busy ? 'active' : ''}`} />
          {busy ? `Importing sessions${data?.scan.totalFiles ? ` · ${data.scan.scannedFiles}/${data.scan.totalFiles}` : '…'}`
            : data?.scan.lastScan ? `Updated ${new Date(data.scan.lastScan).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Loading your history…'}
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
          <button type="button" className="icon-button" title="Import new and changed session logs" aria-label="Refresh usage"
            disabled={busy} onClick={() => void refresh()}><Icon name="refresh" spinning={busy} /></button>
        </div>
      </div>

      {error && <div className="notice error" role="alert">{error} <button type="button" onClick={() => setRevision(v => v + 1)}>Retry</button></div>}
      {data?.scan.error && <div className="notice error" role="alert">Import failed: {data.scan.error}. Saved usage is still available.</div>}
      {data && data.scan.warnings.length > 0 && <details className="notice"><summary>Import notes ({data.scan.warnings.length})</summary>
        <ul>{data.scan.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}

      <section className="overview" aria-label="Usage summary" aria-busy={!current}>
        <div className="hero-summary">
          <div className="summary-caption">{metric === 'cost' ? 'ESTIMATED COST' : 'PROCESSED TOKENS'}</div>
          <div className={`hero-value ${!current ? 'placeholder' : ''}`}>
            {totals ? metric === 'cost' ? costLabel(totals) : compact(totals.tokens) : '···'}
          </div>
          <p className="hero-meta">{current ? `${current.sessions} ${current.sessions === 1 ? 'session' : 'sessions'}` : 'Reading saved usage'}
            {metric === 'cost' && <><span className="meta-separator">·</span>API estimate <span title="USD estimate from recorded tokens at published API rates. This is not your subscription bill."><Icon name="info" /></span></>}
          </p>
          <p className="cache-rate">{percent(cacheRate)} cache hit rate</p>
        </div>
        <div className="chart-section">
          <div className="chart-heading"><h2>{range === '24h' ? 'Hourly' : 'Daily'} {metric === 'cost' ? 'cost' : 'processed tokens'}</h2>
            <span>{metric === 'cost' && current?.series.some(point => point.requests > 0 && point.requests === point.unpriced)
              ? <span className="chart-key" title="These days contain usage with no verified price. Their cost is unknown, not zero."><i /> Unpriced days</span>
              : metric === 'cost' ? 'USD' : 'TOKENS'}</span></div>
          {current && current.series.length > 0 ? <Suspense fallback={<div className="chart-loading">Loading chart…</div>}><UsageChart report={current} metric={metric} /></Suspense>
            : <div className="chart-loading">Loading your usage…</div>}
          {current && current.totals.requests === 0 && <p className="empty-caption">No recorded usage in this period. Try a wider date range.</p>}
        </div>
      </section>

      <section className="totals-section" aria-label="Token totals">
        <div className="section-heading"><h2>Totals</h2></div>
        <div className="totals-grid">
          {[
            ['Processed tokens', compact(totals?.tokens ?? 0), 'processed'], ['Cached input', compact(totals?.cached ?? 0), 'cached'],
            ['Uncached input', compact(totals?.input ?? 0), 'input'], ['Output', compact(totals?.output ?? 0), 'output'],
            ['Cache savings', totals && hasPrice(totals) ? money(totals.savings) : '—', 'savings'],
          ].map(([label, value, type]) => <div key={label} className={`stat stat-${type}`}><span>{label}</span><strong>{current ? value : '—'}</strong></div>)}
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
            group={group} total={metric === 'cost' ? totals?.cost ?? 0 : totals?.tokens ?? 0} />)}</tbody>
        </table>{!rows.length && <div className="table-empty">{current ? 'Your usage will appear here.' : 'Loading breakdown…'}</div>}</div>
      </section>

      {totals && totals.unpriced > 0 && <p className="pricing-note"><Icon name="info" />
        {totals.unpriced} requests have no verified price. Tokens are included; cost and savings show the priced subtotal.
      </p>}
      <footer className="page-footer"><span>{data?.timeZone ?? 'Local time'} · USD</span>
      <details className="methodology"><summary>About these numbers</summary><p>
        Input and output count once. Cached input is part of input; reasoning is part of output.
        Cost estimates use base API rates and recorded speed tiers, without a long-context uplift.
        Missing tiers assume Standard speed{totals ? ` (${totals.assumedStandard} requests in this period)` : ''}.
        Codex auto-review is counted at $0, with its tokens retained.
        Unknown models and cache-write requests without retention details stay unpriced.
        Cache savings compare priced cached input with the same requests at uncached rates.
        Daily charts start at the first recorded day in the selected period; amber dots mark days with entirely unpriced usage.
        Only imported logs are covered. Deleted logs cannot be recovered before their first import.
        {data ? ` ${data.retainedSessions} sessions retained across all dates.` : ''}
      </p><a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">Pricing reference ↗</a></details></footer>
    </main>
  </div>;
}

function Composition({ metric, totals }: { metric: Metric; totals: UsageReport['totals'] | undefined }) {
  const parts = [
    { label: 'Input', value: metric === 'cost' ? totals?.inputCost ?? 0 : totals?.input ?? 0, color: 'input' },
    { label: 'Cache read', value: metric === 'cost' ? totals?.cachedCost ?? 0 : totals?.cached ?? 0, color: 'cached' },
    { label: 'Output', value: metric === 'cost' ? totals?.outputCost ?? 0 : totals?.output ?? 0, color: 'output' },
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
