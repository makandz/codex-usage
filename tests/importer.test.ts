import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UsageStore } from '../server/store.ts';
import { fixture, header, ledger, legacy } from './fixtures.ts';

test('incremental imports survive archive moves, copies, deletion, and database reopening', async () => {
  const context = await fixture();

  try {
    await writeFile(context.file, header() + ledger() + legacy());
    await context.importer.refresh();
    assert.equal(context.store.events().length, 1);
    await context.importer.refresh();
    assert.equal(context.importer.status.skippedFiles, 1);
    assert.equal(context.importer.status.imported, 0);
    await appendFile(context.file, ledger('two', '2026-10-24T16:00:10Z'));
    await context.importer.refresh();
    assert.equal(context.store.events().length, 2);
    const archived = join(context.archive, 'session.jsonl');
    await rename(context.file, archived);
    await writeFile(context.file, await readFile(archived));
    await context.importer.refresh();
    assert.equal(context.store.events().length, 2);
    await rm(context.file);
    await rm(archived);
    await context.importer.refresh();
    assert.equal(context.store.events().length, 2);
    const reopened = new UsageStore(context.database);
    assert.equal(reopened.events().length, 2);
    assert.equal(reopened.metadata('lastScan'), context.importer.status.lastScan);
    reopened.close();
  } finally {
    await context.close();
  }
});

test('partial UTF-8 lines and mirrors split across imports resume without duplication', async () => {
  const context = await fixture();

  try {
    const tail = Buffer.from(ledger('café'));
    const cut = tail.indexOf(Buffer.from('é')) + 1;
    await writeFile(context.file, Buffer.concat([Buffer.from(header() + legacy()), tail.subarray(0, cut)]));
    await context.importer.refresh();
    assert.equal(context.store.events().length, 1);
    await appendFile(context.file, tail.subarray(cut));
    await context.importer.refresh();
    assert.equal(context.store.events().length, 1);
    assert.equal(context.store.events()[0].id, 'response:café');
  } finally {
    await context.close();
  }
});

test('truncation, malformed lines, and replaced logs retain already imported history', async () => {
  const context = await fixture();

  try {
    await writeFile(context.file, header() + ledger());
    await context.importer.refresh();
    await writeFile(context.file, header() + '{bad json}\n' + ledger('two'));
    await context.importer.refresh();
    assert.equal(context.store.events().length, 2);
    assert.ok(context.importer.status.warnings.length > 0);
    await writeFile(context.file, header());
    await context.importer.refresh();
    assert.equal(context.store.events().length, 2);
  } finally {
    await context.close();
  }
});

test('oversized complete lines are skipped without losing the next record or checkpoint', async () => {
  const context = await fixture();

  try {
    const oversized = 'x'.repeat(16 * 1024 * 1024 + 1);
    await writeFile(context.file, header() + oversized + '\n' + ledger());
    await context.importer.refresh();
    assert.equal(context.store.events().length, 1);
    assert.match(context.importer.status.warnings[0], /skipped 1 invalid or oversized/);
    const content = await readFile(context.file);
    assert.equal(context.store.file(context.file)?.offset, content.length);

    await appendFile(context.file, ledger('two', '2026-10-24T16:00:10Z'));
    await context.importer.refresh();
    assert.equal(context.store.events().length, 2);
    assert.equal(context.importer.status.imported, 1);
  } finally {
    await context.close();
  }
});

test('an unfinished oversized line rolls back usage and checkpoints until it can be retried', async () => {
  const context = await fixture();

  try {
    await writeFile(context.file, header() + ledger() + 'x'.repeat(16 * 1024 * 1024 + 1));
    await context.importer.refresh();
    assert.equal(context.store.events().length, 0);
    assert.equal(context.store.file(context.file), null);
    assert.equal(context.importer.status.imported, 0);
    assert.match(context.importer.status.warnings[0], /oversized unfinished log line/);

    await appendFile(context.file, '\n' + ledger('two', '2026-10-24T16:00:10Z'));
    await context.importer.refresh();
    assert.equal(context.store.events().length, 2);
    assert.equal(context.importer.status.imported, 2);
    assert.match(context.importer.status.warnings[0], /skipped 1 invalid or oversized/);
  } finally {
    await context.close();
  }
});

test('concurrent refresh calls share one scan', async () => {
  const context = await fixture();

  try {
    await writeFile(context.file, header() + ledger());
    const first = context.importer.refresh();
    const second = context.importer.refresh();
    assert.equal(first, second);
    await first;
    assert.equal(context.store.events().length, 1);
    assert.equal(context.importer.status.imported, 1);
    assert.equal(context.importer.status.scanning, false);
  } finally {
    await context.close();
  }
});
