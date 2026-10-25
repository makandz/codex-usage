import { useState } from 'react';
import type { Breakdown, Metric, UsageReport } from '../shared/types.ts';
import { compact, costLabel, hasPrice, percent, shortDate } from './format.ts';

type Grouping = 'model' | 'day';

type UsageBreakdownProps = {
  report: UsageReport;
  metric: Metric;
};

type BreakdownRowProps = {
  row: Breakdown;
  index: number;
  metric: Metric;
  group: Grouping;
  total: number;
};

/** Keep priced models first, ordering equal costs by their token volume. */
function compareCost(left: Breakdown, right: Breakdown): number {
  return Number(hasPrice(right)) - Number(hasPrice(left))
    || right.cost - left.cost
    || right.tokens - left.tokens;
}

/**
 * Show model or day usage, sorting model rows by the selected metric.
 * @param props Current report and display metric.
 * @returns A switchable breakdown table with cost, share, and token counts.
 */
export function UsageBreakdown({ report, metric }: UsageBreakdownProps) {
  const [group, setGroup] = useState<Grouping>('model');
  const rows = [...(group === 'model' ? report.models : report.days)];
  const total = metric === 'cost' ? report.totals.cost : report.totals.tokens;
  if (group === 'model') {
    if (metric === 'cost') {
      rows.sort(compareCost);
    } else {
      rows.sort((left, right) => right.tokens - left.tokens);
    }
  }

  return (
    <section className="breakdown-section">
      <div className="section-heading">
        <h2>Breakdown</h2>
        <div className="segmented small" role="group" aria-label="Breakdown grouping">
          {(['model', 'day'] as const).map(value => (
            <button
              key={value}
              type="button"
              aria-pressed={group === value}
              className={group === value ? 'selected' : ''}
              onClick={() => setGroup(value)}
            >
              {value === 'model' ? 'Model' : 'Day'}
            </button>
          ))}
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="rank">#</th>
              <th>{group === 'model' ? 'Model' : 'Day'}</th>
              <th>Cost <span className="column-unit">USD</span></th>
              <th>Share</th>
              <th>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <BreakdownRow
                key={row.key}
                row={row}
                index={index}
                metric={metric}
                group={group}
                total={total}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="table-empty">Your usage will appear here.</div>
        )}
      </div>
    </section>
  );
}

/** Render a usage subtotal, keeping unknown prices distinct from free requests. */
function BreakdownRow({ row, index, metric, group, total }: BreakdownRowProps) {
  const priced = hasPrice(row);
  const value = metric === 'cost' ? row.cost : row.tokens;
  const share = total > 0 ? value / total : 0;
  const shareLabel = metric === 'cost' && !priced ? '—' : percent(share);
  const label = group === 'model' ? row.label : shortDate(row.key);
  const partialCost = row.unpriced > 0 && priced;
  const costNote = row.unpriced
    ? `${row.unpriced} unpriced requests; amounts are partial.`
    : undefined;

  return (
    <tr>
      <td className="rank">{String(index + 1).padStart(2, '0')}</td>
      <td className="model-cell">
        <div>
          <span className="model-symbol">{group === 'model' ? '◈' : '↳'}</span>
          <span>{label}</span>
          {group === 'model' && row.unpriced === row.requests && (
            <span className="unpriced-tag">Unpriced</span>
          )}
          {group === 'model' && row.key === 'codex-auto-review' && row.unpriced === 0 && (
            <span className="free-tag">Free</span>
          )}
        </div>
        <div className="share-track">
          <span style={{ width: `${share * 100}%` }} />
        </div>
      </td>
      <td className={priced ? '' : 'muted'} title={costNote}>
        {costLabel(row)}{partialCost ? '*' : ''}
      </td>
      <td>{shareLabel}</td>
      <td>{compact(row.tokens)}</td>
    </tr>
  );
}
