import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';
import type { ParserState, UsageEvent } from './parser.ts';
import { PRICING_VERSION, priceUsage } from './pricing.ts';
import type { Price } from './pricing.ts';

type Row = Record<string, SQLOutputValue>;
export type SavedFile = {
  identity: string;
  mtime: number;
  size: number;
  offset: number;
  anchor: string;
  state: ParserState;
};
export type SavedEvent = UsageEvent & {
  price: Price | null;
};

export class UsageStore {
  readonly db: DatabaseSync;

  constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY, identity TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL,
        offset INTEGER NOT NULL, anchor TEXT NOT NULL, state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage (
        id TEXT PRIMARY KEY, session TEXT NOT NULL, timestamp INTEGER NOT NULL,
        model TEXT NOT NULL, tier TEXT, input INTEGER NOT NULL, cached INTEGER NOT NULL,
        write INTEGER NOT NULL, output INTEGER NOT NULL,
        inputCost REAL, cachedCost REAL, outputCost REAL, savings REAL
      );
      CREATE INDEX IF NOT EXISTS usage_timestamp ON usage(timestamp);
    `);
    const version = this.metadata('pricingVersion');
    if (version !== PRICING_VERSION) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const event of this.events()) this.saveEvent(event);
        this.setMetadata('pricingVersion', PRICING_VERSION);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
  }

  metadata(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key);
    return typeof row?.value === 'string' ? row.value : null;
  }

  setMetadata(key: string, value: string) {
    this.db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run(key, value);
  }

  file(path: string): SavedFile | null {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(path);
    if (!row) return null;
    return {
      identity: String(row.identity), mtime: Number(row.mtime), size: Number(row.size),
      offset: Number(row.offset), anchor: String(row.anchor), state: JSON.parse(String(row.state)) as ParserState,
    };
  }

  saveFile(path: string, file: SavedFile) {
    this.db.prepare('INSERT OR REPLACE INTO files VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(path, file.identity, file.mtime, file.size, file.offset, file.anchor, JSON.stringify(file.state));
  }

  saveEvent(event: UsageEvent): boolean {
    const price = priceUsage(event.model, event.tier, event);
    const existing = this.db.prepare('SELECT id FROM usage WHERE id = ?').get(event.id);
    // Response identities survive archive moves, copied logs, reparses, and deleted files.
    this.db.prepare(`INSERT INTO usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET model=excluded.model, tier=excluded.tier,
        session=excluded.session, timestamp=excluded.timestamp,
        input=excluded.input, cached=excluded.cached, write=excluded.write, output=excluded.output,
        inputCost=excluded.inputCost, cachedCost=excluded.cachedCost,
        outputCost=excluded.outputCost, savings=excluded.savings`)
      .run(event.id, event.session, event.timestamp, event.model, event.tier,
        event.input, event.cached, event.write, event.output,
        price?.inputCost ?? null, price?.cachedCost ?? null, price?.outputCost ?? null, price?.savings ?? null);
    return !existing;
  }

  removeMirror(id: string) {
    // Only a mirrored observation is removed. Missing source files never erase imported usage.
    if (id.startsWith('legacy:')) this.db.prepare('DELETE FROM usage WHERE id = ?').run(id);
  }

  events(since = 0, until = Number.MAX_SAFE_INTEGER): SavedEvent[] {
    return this.db.prepare('SELECT * FROM usage WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp')
      .all(since, until).map(readEvent);
  }

  sessionCount(): number {
    return Number(this.db.prepare('SELECT COUNT(DISTINCT session) AS count FROM usage').get()?.count ?? 0);
  }

  close() { this.db.close(); }
}

function readEvent(row: Row): SavedEvent {
  return {
    id: String(row.id), session: String(row.session), timestamp: Number(row.timestamp),
    model: String(row.model), tier: typeof row.tier === 'string' ? row.tier : null,
    input: Number(row.input), cached: Number(row.cached), write: Number(row.write), output: Number(row.output),
    price: row.inputCost === null ? null : {
      inputCost: Number(row.inputCost), cachedCost: Number(row.cachedCost),
      outputCost: Number(row.outputCost), savings: Number(row.savings),
    },
  };
}
