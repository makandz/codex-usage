import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { renderSnapshot } from '../server/snapshot.ts';
import type { UsageSnapshot } from '../shared/types.ts';
import { fixture, header, ledger, line } from './fixtures.ts';

test('snapshots embed every date range and safely preserve HTML in log metadata', async () => {
  const context = await fixture();
  try {
    const model = '</script><script>alert("usage")</script> $&';
    await writeFile(context.file, header() + ledger('older', '2026-10-10T16:00:00Z')
      + line('turn_context', { model }) + ledger('recent'));
    await context.importer.refresh();
    const template = '<script id="usage-data" type="application/json">__CODEX_USAGE_DATA__</script>';
    const html = renderSnapshot(template, context.store, context.importer.status, Date.parse('2026-10-24T23:00:00Z'));
    assert.equal(html.match(/<\/script>/g)?.length, 1);
    assert.ok(!html.includes('__CODEX_USAGE_DATA__'));
    const json = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'));
    const snapshot = JSON.parse(json) as UsageSnapshot;
    assert.deepEqual(Object.keys(snapshot), ['24h', '7d', '30d', '90d', 'all']);
    assert.equal(snapshot['24h'].totals.requests, 1);
    assert.equal(snapshot['7d'].totals.requests, 1);
    assert.equal(snapshot['30d'].totals.requests, 2);
    assert.equal(snapshot['90d'].totals.requests, 2);
    assert.equal(snapshot.all.totals.requests, 2);
    assert.equal(snapshot['24h'].models[0].key, model);
    assert.equal(snapshot.all.scan.scanning, false);
    assert.equal(snapshot.all.scan.lastScan, context.importer.status.lastScan);
    assert.throws(() => renderSnapshot('<html></html>', context.store, context.importer.status), /missing usage data/);
  } finally {
    await context.close();
  }
});
