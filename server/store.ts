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

  /**
   * Open the usage database, creating its schema and updating stored prices if needed.
   * @param filename SQLite database path; its parent directory is created when missing.
   */
  constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        identity TEXT NOT NULL,
        mtime REAL NOT NULL,
        size INTEGER NOT NULL,
        offset INTEGER NOT NULL,
        anchor TEXT NOT NULL,
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage (
        id TEXT PRIMARY KEY,
        session TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        model TEXT NOT NULL,
        tier TEXT,
        input INTEGER NOT NULL,
        cached INTEGER NOT NULL,
        write INTEGER NOT NULL,
        output INTEGER NOT NULL,
        inputCost REAL,
        cachedCost REAL,
        outputCost REAL,
        savings REAL
      );
      CREATE INDEX IF NOT EXISTS usage_timestamp ON usage(timestamp);
    `);
    if (this.metadata('pricingVersion') !== PRICING_VERSION) {
      this.repriceHistory();
    }
  }

  /**
   * Read a persisted application setting.
   * @param key Metadata name.
   * @returns Stored value, or null when no value has been saved.
   */
  metadata(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key);
    return typeof row?.value === 'string' ? row.value : null;
  }

  /**
   * Persist an application setting.
   * @param key Metadata name.
   * @param value Value to insert or replace.
   */
  setMetadata(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run(key, value);
  }

  /**
   * Read a log's checkpoint and parser context.
   * @param path Source log path used during import.
   * @returns Saved checkpoint, or null when the file has never been imported.
   */
  file(path: string): SavedFile | null {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(path);
    if (!row) {
      return null;
    }
    return {
      identity: String(row.identity),
      mtime: Number(row.mtime),
      size: Number(row.size),
      offset: Number(row.offset),
      anchor: String(row.anchor),
      state: JSON.parse(String(row.state)) as ParserState,
    };
  }

  /**
   * Persist a checkpoint within the same transaction as its imported events.
   * @param path Source log path.
   * @param file Identity, byte position, and parser context for the next import.
   */
  saveFile(path: string, file: SavedFile): void {
    this.db.prepare('INSERT OR REPLACE INTO files VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(path, file.identity, file.mtime, file.size, file.offset, file.anchor, JSON.stringify(file.state));
  }

  /**
   * Insert or refresh usage using an identity that survives log copies and archive moves.
   * @param event Parsed request to price and retain.
   * @returns True for a new request, false when an existing identity was updated.
   */
  saveEvent(event: UsageEvent): boolean {
    const price = priceUsage(event.model, event.tier, event);
    const existing = this.db.prepare('SELECT id FROM usage WHERE id = ?').get(event.id);
    this.db.prepare(`
      INSERT INTO usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        model = excluded.model,
        tier = excluded.tier,
        session = excluded.session,
        timestamp = excluded.timestamp,
        input = excluded.input,
        cached = excluded.cached,
        write = excluded.write,
        output = excluded.output,
        inputCost = excluded.inputCost,
        cachedCost = excluded.cachedCost,
        outputCost = excluded.outputCost,
        savings = excluded.savings
    `).run(
      event.id,
      event.session,
      event.timestamp,
      event.model,
      event.tier,
      event.input,
      event.cached,
      event.write,
      event.output,
      price?.inputCost ?? null,
      price?.cachedCost ?? null,
      price?.outputCost ?? null,
      price?.savings ?? null,
    );
    return !existing;
  }

  /**
   * Remove a legacy mirror when its authoritative response record arrives.
   * @param id Mirrored identity; response identities are never deleted here.
   */
  removeMirror(id: string): void {
    if (id.startsWith('legacy:')) {
      this.db.prepare('DELETE FROM usage WHERE id = ?').run(id);
    }
  }

  /**
   * Read retained requests in chronological order, regardless of source log availability.
   * @param since Inclusive lower timestamp bound in milliseconds.
   * @param until Inclusive upper timestamp bound in milliseconds.
   * @returns Requests with their stored prices, or null prices when unknown.
   */
  events(since = 0, until = Number.MAX_SAFE_INTEGER): SavedEvent[] {
    return this.db.prepare(`
      SELECT * FROM usage
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp
    `).all(since, until).map(readEvent);
  }

  /**
   * Count sessions represented in retained usage across all dates.
   * @returns Number of distinct session identities.
   */
  sessionCount(): number {
    const row = this.db.prepare('SELECT COUNT(DISTINCT session) AS count FROM usage').get();
    return Number(row?.count ?? 0);
  }

  /** Release the database connection. */
  close(): void {
    this.db.close();
  }

  /** Recalculate saved prices atomically without requiring the original logs. */
  private repriceHistory(): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const event of this.events()) {
        this.saveEvent(event);
      }
      this.setMetadata('pricingVersion', PRICING_VERSION);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** Convert SQLite values into the domain representation used by reports. */
function readEvent(row: Row): SavedEvent {
  let price: Price | null = null;
  if (row.inputCost !== null) {
    price = {
      inputCost: Number(row.inputCost),
      cachedCost: Number(row.cachedCost),
      outputCost: Number(row.outputCost),
      savings: Number(row.savings),
    };
  }
  return {
    id: String(row.id),
    session: String(row.session),
    timestamp: Number(row.timestamp),
    model: String(row.model),
    tier: typeof row.tier === 'string' ? row.tier : null,
    input: Number(row.input),
    cached: Number(row.cached),
    write: Number(row.write),
    output: Number(row.output),
    price,
  };
}
