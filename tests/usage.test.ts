import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rename, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Importer } from '../server/importer.ts';
import { initialState, parseLine } from '../server/parser.ts';
import type { UsageEvent } from '../server/parser.ts';
import { UsageStore } from '../server/store.ts';
import { priceUsage } from '../server/pricing.ts';
import { report } from '../server/report.ts';
import { chartPoints } from '../src/chart-data.ts';

const timestamp = '2026-10-24T16:00:00.000Z';
const usage = { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 100, reasoning_output_tokens: 30 };
const line = (type: string, payload: object, time = timestamp, ordinal?: number) =>
  JSON.stringify({ type, timestamp: time, payload, ordinal }) + '\n';
const header = (extra: object = {}) => line('session_meta', { id: 'session-a', ...extra })
  + line('turn_context', { model: 'gpt-6.1-sol', turn_id: 'turn-a' });
const ledger = (response = 'one', time = timestamp) => line('token_usage_record', {
  thread_id: 'session-a', response_id: response, turn_id: 'turn-a', usage,
}, time);
const legacy = (total = usage, time = timestamp) => line('event_msg', {
  type: 'token_count', turn_id: 'turn-a', info: { total_token_usage: total, last_token_usage: usage },
}, time);

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'codex-usage-test-'));
  const home = join(directory, 'codex');
  const sessions = join(home, 'sessions');
  const archive = join(home, 'archived_sessions');
  await mkdir(sessions, { recursive: true }); await mkdir(archive);
  const database = join(directory, 'data', 'usage.sqlite');
  const store = new UsageStore(database);
  const importer = new Importer(store, home);
  const file = join(sessions, 'session.jsonl');
  return { directory, home, archive, database, store, importer, file,
    async close() { store.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('a response and its cumulative mirror count once in either order', () => {
  for (const records of [[ledger(), legacy()], [legacy(), ledger()]]) {
    const state = initialState('test');
    const events = new Map<string, UsageEvent>();
    for (const row of (header() + records.join('')).trim().split('\n')) {
      const parsed = parseLine(row, state);
      if (parsed.replace) events.delete(parsed.replace);
      if (parsed.event) events.set(parsed.event.id, parsed.event);
    }
    assert.equal(events.size, 1);
    assert.equal([...events.values()][0].input, 1000);
  }
});

test('unchanged cumulative snapshots and inherited subagent records add no usage', () => {
  const state = initialState('test');
  for (const row of header({ subagent_history_start_ordinal: 5 }).trim().split('\n')) parseLine(row, state);
  assert.equal(parseLine(line('token_usage_record', { thread_id: 'session-a', response_id: 'inherited', usage }, timestamp, 4), state).event, undefined);
  assert.equal(parseLine(ledger(), state).event?.input, 1000);
  parseLine(legacy(), state);
  assert.equal(parseLine(legacy(), state).event, undefined);
  assert.equal(parseLine(line('token_usage_record', { thread_id: 'parent', response_id: 'parent', usage }), state).event, undefined);
});

test('distinct equal-size requests do not donate each other’s mirrors', () => {
  const state = initialState('test');
  const total = { ...usage, input_tokens: 2000, cached_input_tokens: 1600, output_tokens: 200 };
  const secondTime = '2026-10-24T16:00:01Z';
  const second = line('token_usage_record', {
    thread_id: 'session-a', response_id: 'two', turn_id: 'turn-a', usage, thread_token_usage: total,
  }, secondTime);
  const first = line('event_msg', { type: 'token_count', turn_id: 'turn-a',
    info: { total_token_usage: usage, last_token_usage: usage } });
  const events = new Map<string, UsageEvent>();
  for (const row of (header() + first + second + legacy(total, secondTime)).trim().split('\n')) {
    const result = parseLine(row, state);
    if (result.replace) events.delete(result.replace);
    if (result.event) events.set(result.event.id, result.event);
  }
  assert.equal(events.size, 2);
});

test('delayed mirrors match cumulative identity, even outside the timing fallback', () => {
  const state = initialState('test');
  for (const row of header().trim().split('\n')) parseLine(row, state);
  const first = line('token_usage_record', { thread_id: 'session-a', response_id: 'one', usage,
    thread_token_usage: usage });
  assert.ok(parseLine(first, state).event);
  assert.equal(parseLine(legacy(usage, '2026-10-24T16:01:00Z'), state).event, undefined);
});

test('prices separate cached input, apply speed multipliers without a long-context uplift, and retain unknown prices', () => {
  const u = { input: 1000, cached: 800, write: 0, output: 100 };
  const price = priceUsage('gpt-6.1-sol', 'default', u)!;
  assert.ok(Math.abs(price.inputCost - 0.0004) < 1e-10);
  assert.ok(Math.abs(price.cachedCost - 0.00008) < 1e-10);
  assert.ok(Math.abs(price.outputCost - 0.001) < 1e-10);
  assert.ok(Math.abs(price.savings - 0.00152) < 1e-10);
  assert.equal(priceUsage('gpt-6.1-sol', 'priority', u)!.outputCost, 0.002);
  const large = priceUsage('gpt-6.1-sol', null, { input: 500_000, cached: 400_000, write: 0, output: 10_000 })!;
  assert.ok(Math.abs(large.inputCost - 0.2) < 1e-10);
  assert.ok(Math.abs(large.cachedCost - 0.04) < 1e-10);
  assert.ok(Math.abs(large.outputCost - 0.1) < 1e-10);
  assert.ok(Math.abs(large.savings - 0.76) < 1e-10);
  assert.equal(priceUsage('unknown', null, u), null);
  assert.equal(priceUsage('gpt-6.1-sol', 'mystery-tier', u), null);
  assert.equal(priceUsage('gpt-6.1-sol', null, { ...u, write: 100 }), null);
});

test('incremental imports survive archive moves, copies, deletion, and database reopening', async () => {
  const f = await fixture();
  try {
    await writeFile(f.file, header() + ledger() + legacy());
    await f.importer.refresh();
    assert.equal(f.store.events().length, 1);
    await f.importer.refresh();
    assert.equal(f.importer.status.skippedFiles, 1);
    assert.equal(f.importer.status.imported, 0);
    await appendFile(f.file, ledger('two', '2026-10-24T16:00:10Z'));
    await f.importer.refresh();
    assert.equal(f.store.events().length, 2);
    const archived = join(f.archive, 'session.jsonl');
    await rename(f.file, archived);
    await writeFile(f.file, await readFile(archived));
    await f.importer.refresh();
    assert.equal(f.store.events().length, 2);
    await rm(f.file); await rm(archived);
    await f.importer.refresh();
    assert.equal(f.store.events().length, 2);
    const reopened = new UsageStore(f.database);
    assert.equal(reopened.events().length, 2);
    assert.equal(reopened.metadata('lastScan'), f.importer.status.lastScan);
    reopened.close();
  } finally { await f.close(); }
});

test('partial UTF-8 lines and mirrors split across imports resume without duplication', async () => {
  const f = await fixture();
  try {
    const tail = Buffer.from(ledger('café'));
    const cut = tail.indexOf(Buffer.from('é')) + 1;
    await writeFile(f.file, Buffer.concat([Buffer.from(header() + legacy()), tail.subarray(0, cut)]));
    await f.importer.refresh();
    assert.equal(f.store.events().length, 1);
    await appendFile(f.file, tail.subarray(cut));
    await f.importer.refresh();
    assert.equal(f.store.events().length, 1);
    assert.equal(f.store.events()[0].id, 'response:café');
  } finally { await f.close(); }
});

test('truncation, malformed lines, and replaced logs retain already imported history', async () => {
  const f = await fixture();
  try {
    await writeFile(f.file, header() + ledger());
    await f.importer.refresh();
    await writeFile(f.file, header() + '{bad json}\n' + ledger('two'));
    await f.importer.refresh();
    assert.equal(f.store.events().length, 2);
    assert.ok(f.importer.status.warnings.length > 0);
    await writeFile(f.file, header());
    await f.importer.refresh();
    assert.equal(f.store.events().length, 2);
  } finally { await f.close(); }
});

test('reports include unknown-model tokens without treating them as free', async () => {
  const f = await fixture();
  try {
    await writeFile(f.file, header() + ledger()
      + line('turn_context', { model: 'unpublished-model' }) + ledger('unknown', '2026-10-24T17:00:00Z'));
    await f.importer.refresh();
    const result = report(f.store, '7d', f.importer.status, Date.parse('2026-10-24T23:00:00Z'));
    assert.equal(result.totals.tokens, 2200); // Reasoning is already included in output.
    assert.equal(result.totals.cached, 1600);
    assert.equal(result.totals.input, 400);
    assert.equal(result.totals.unpriced, 1);
    assert.equal(result.sessions, 1);
    assert.equal(result.series.length, 1);
    assert.ok(Math.abs(result.totals.cost - 0.00148) < 1e-10);
    assert.equal(result.models.find(row => row.key === 'unpublished-model')?.unpriced, 1);
    const recent = report(f.store, '24h', f.importer.status, Date.parse('2026-10-26T23:00:00Z'));
    assert.equal(recent.totals.tokens, 0);
  } finally { await f.close(); }
});

test('auto-review is free and previously unpriced history is corrected without its source logs', async () => {
  const f = await fixture();
  try {
    await writeFile(f.file, header() + line('turn_context', { model: 'codex-auto-review' }) + ledger('review'));
    await f.importer.refresh();
    assert.deepEqual(f.store.events()[0].price, { inputCost: 0, cachedCost: 0, outputCost: 0, savings: 0 });
    // Reproduce an older database whose source session has since been deleted.
    f.store.db.exec('UPDATE usage SET inputCost=NULL, cachedCost=NULL, outputCost=NULL, savings=NULL');
    f.store.setMetadata('pricingVersion', '2026-10-25-v1');
    await rm(f.file);
    const reopened = new UsageStore(f.database);
    try {
      const result = report(reopened, 'all', f.importer.status, Date.parse('2026-10-24T23:00:00Z'));
      assert.equal(result.totals.tokens, 1100);
      assert.equal(result.totals.requests, 1);
      assert.equal(result.totals.unpriced, 0);
      assert.equal(result.totals.cost, 0);
      assert.equal(result.totals.savings, 0);
      assert.equal(chartPoints(result.series, 'cost')[0].value, 0);
      assert.equal(chartPoints(result.series, 'cost')[0].unpricedValue, null);
    } finally { reopened.close(); }
  } finally { await f.close(); }
});

test('daily charts omit dates before retained usage and distinguish unpriced days from quiet days', async () => {
  const f = await fixture();
  try {
    await writeFile(f.file, header() + ledger('first', '2026-10-21T16:00:00Z')
      + line('turn_context', { model: 'unknown' }) + ledger('unpriced', '2026-10-23T16:00:00Z'));
    await f.importer.refresh();
    const result = report(f.store, '30d', f.importer.status, Date.parse('2026-10-24T18:00:00Z'));
    assert.equal(result.series.length, 4);
    const cost = chartPoints(result.series, 'cost');
    assert.ok(cost[0].value! > 0);
    assert.equal(cost[1].value, 0);
    assert.equal(cost[2].value, null);
    assert.equal(cost[2].unpricedValue, 0);
    assert.equal(cost[3].value, 0);
    assert.equal(chartPoints(result.series, 'tokens')[2].value, 1100);
    assert.equal(result.totals.tokens, 2200);
  } finally { await f.close(); }
});
