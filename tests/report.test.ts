import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { UsageStore } from '../server/store.ts';
import { report } from '../server/report.ts';
import { chartPoints } from '../src/chart-data.ts';
import { fixture, header, ledger, line } from './fixtures.ts';

test('reports include unknown-model tokens without treating them as free', async () => {
  const context = await fixture();

  try {
    await writeFile(context.file, header() + ledger()
      + line('turn_context', { model: 'unpublished-model' }) + ledger('unknown', '2026-10-24T17:00:00Z'));
    await context.importer.refresh();
    const result = report(context.store, '7d', context.importer.status, Date.parse('2026-10-24T23:00:00Z'));
    assert.equal(result.totals.tokens, 2200); // Reasoning is already included in output.
    assert.equal(result.totals.cached, 1600);
    assert.equal(result.totals.input, 400);
    assert.equal(result.totals.unpriced, 1);
    assert.equal(result.sessions, 1);
    assert.equal(result.series.length, 1);
    assert.ok(Math.abs(result.totals.cost - 0.00148) < 1e-10);
    assert.equal(result.models.find(row => row.key === 'unpublished-model')?.unpriced, 1);
    const recent = report(context.store, '24h', context.importer.status, Date.parse('2026-10-26T23:00:00Z'));
    assert.equal(recent.totals.tokens, 0);
  } finally {
    await context.close();
  }
});

test('auto-review is free and previously unpriced history is corrected without its source logs', async () => {
  const context = await fixture();

  try {
    await writeFile(context.file, header() + line('turn_context', { model: 'codex-auto-review' }) + ledger('review'));
    await context.importer.refresh();
    assert.deepEqual(context.store.events()[0].price, { inputCost: 0, cachedCost: 0, outputCost: 0, savings: 0 });
    // Reproduce an older database whose source session has since been deleted.
    context.store.db.exec('UPDATE usage SET inputCost=NULL, cachedCost=NULL, outputCost=NULL, savings=NULL');
    context.store.setMetadata('pricingVersion', '2026-10-25-v1');
    await rm(context.file);
    const reopened = new UsageStore(context.database);

    try {
      const result = report(reopened, 'all', context.importer.status, Date.parse('2026-10-24T23:00:00Z'));
      assert.equal(result.totals.tokens, 1100);
      assert.equal(result.totals.requests, 1);
      assert.equal(result.totals.unpriced, 0);
      assert.equal(result.totals.cost, 0);
      assert.equal(result.totals.savings, 0);
      assert.equal(chartPoints(result.series, 'cost')[0].value, 0);
      assert.equal(chartPoints(result.series, 'cost')[0].unpricedValue, null);
    } finally {
      reopened.close();
    }
  } finally {
    await context.close();
  }
});

test('daily charts omit dates before retained usage and distinguish unpriced days from quiet days', async () => {
  const context = await fixture();

  try {
    await writeFile(context.file, header() + ledger('first', '2026-10-21T16:00:00Z')
      + line('turn_context', { model: 'unknown' }) + ledger('unpriced', '2026-10-23T16:00:00Z'));
    await context.importer.refresh();
    const result = report(context.store, '30d', context.importer.status, Date.parse('2026-10-24T18:00:00Z'));
    assert.equal(result.series.length, 4);
    const cost = chartPoints(result.series, 'cost');
    assert.ok(cost[0].value! > 0);
    assert.equal(cost[1].value, 0);
    assert.equal(cost[2].value, null);
    assert.equal(cost[2].unpricedValue, 0);
    assert.equal(cost[3].value, 0);
    assert.equal(chartPoints(result.series, 'tokens')[2].value, 1100);
    assert.equal(result.totals.tokens, 2200);
  } finally {
    await context.close();
  }
});

test('model and day groups count their own distinct sessions even when their keys match', async () => {
  const context = await fixture();

  try {
    const day = new Date(2026, 9, 24, 12);
    const model = '2026-10-24';
    const event = {
      id: 'response:one',
      session: 'one',
      timestamp: day.getTime(),
      model,
      tier: null,
      input: 1000,
      cached: 800,
      write: 0,
      output: 100,
    };
    context.store.saveEvent(event);
    context.store.saveEvent({ ...event, id: 'response:two', model: 'gpt-6.1-sol' });
    context.store.saveEvent({ ...event, id: 'response:three', session: 'two' });
    const result = report(context.store, 'all', context.importer.status, day.getTime());

    assert.equal(result.sessions, 2);
    assert.equal(result.days.length, 1);
    assert.equal(result.days[0].sessions, 2);
    assert.equal(result.days[0].requests, 3);
    assert.equal(result.models.find(row => row.key === model)?.sessions, 2);
    assert.equal(result.models.find(row => row.key === 'gpt-6.1-sol')?.sessions, 1);
  } finally {
    await context.close();
  }
});

test('daily buckets follow local calendar days across the end of daylight saving time', async () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Toronto';
  const context = await fixture();

  try {
    await writeFile(context.file, header()
      + ledger('first', '2026-10-31T12:00:00-04:00')
      + ledger('second', '2026-11-01T12:00:00-05:00'));
    await context.importer.refresh();
    const now = Date.parse('2026-11-02T12:00:00-05:00');
    const result = report(context.store, '7d', context.importer.status, now);
    const timestamps = result.series.map(point => point.timestamp);

    assert.equal(timestamps.length, 3);
    assert.equal(timestamps[1] - timestamps[0], 24 * 60 * 60 * 1000);
    assert.equal(timestamps[2] - timestamps[1], 25 * 60 * 60 * 1000);
    assert.deepEqual(result.series.map(point => point.requests), [1, 1, 0]);
    assert.deepEqual(result.days.map(day => day.key), ['2026-11-01', '2026-10-31']);
  } finally {
    await context.close();

    if (previousTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTimezone;
    }
  }
});
