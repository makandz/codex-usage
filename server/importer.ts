import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { initialState, parseLine, PARSER_VERSION } from './parser.ts';
import { UsageStore } from './store.ts';
import type { ScanStatus } from '../shared/types.ts';

export class Importer {
  readonly store: UsageStore;
  readonly home: string;
  current: Promise<void> | null = null;
  status: ScanStatus;

  constructor(store: UsageStore, home: string) {
    this.store = store;
    this.home = home;
    this.status = { scanning: false, scannedFiles: 0, totalFiles: 0, imported: 0, skippedFiles: 0,
      lastScan: store.metadata('lastScan'), warnings: [], error: null };
  }

  refresh(): Promise<void> {
    if (this.current) return this.current;
    this.status = { ...this.status, scanning: true, scannedFiles: 0, totalFiles: 0,
      imported: 0, skippedFiles: 0, warnings: [], error: null };
    this.current = this.scan().catch((error: unknown) => {
      this.status.error = error instanceof Error ? error.message : 'Could not scan sessions.';
    }).finally(() => {
      this.status.scanning = false;
      this.current = null;
    });
    return this.current;
  }

  private async scan() {
    const files: string[] = [];
    for (const root of ['sessions', 'archived_sessions']) {
      await discover(join(this.home, root), files);
    }
    this.status.totalFiles = files.length;
    for (const file of files.sort()) {
      try { await this.importFile(file); }
      catch (error) {
        if (this.status.warnings.length < 10) {
          this.status.warnings.push(`Could not read ${file.split('/').pop()}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
      this.status.scannedFiles++;
    }
    if (!files.length) this.status.warnings.push('No session logs found. Previously imported usage is still available.');
    this.status.lastScan = new Date().toISOString();
    this.store.setMetadata('lastScan', this.status.lastScan);
  }

  private async importFile(path: string) {
    const metadata = await stat(path);
    const identity = `${metadata.dev}:${metadata.ino}`;
    const saved = this.store.file(path);
    if (saved?.state.version === PARSER_VERSION && saved.identity === identity
      && saved.mtime === metadata.mtimeMs && saved.size === metadata.size) {
      this.status.skippedFiles++;
      return;
    }
    const append = saved && saved.state.version === PARSER_VERSION && saved.identity === identity && metadata.size > saved.size
      && saved.offset <= metadata.size && await anchor(path, saved.offset) === saved.anchor;
    let offset = append ? saved.offset : 0;
    const state = append ? saved.state : initialState(path);
    let pending = Buffer.alloc(0);
    let oversized = false;
    let imported = 0;
    let invalid = 0;
    const maxLine = 16 * 1024 * 1024;
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      if (offset < metadata.size) {
        const stream = createReadStream(path, { start: offset, end: metadata.size - 1, highWaterMark: 64 * 1024 });
        for await (const data of stream) {
          const chunk = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
          let start = 0;
          for (let index = 0; index < chunk.length; index++) {
            if (chunk[index] !== 10) continue;
            const piece = chunk.subarray(start, index);
            const bytes = pending.length + piece.length + 1;
            if (!oversized && bytes <= maxLine) {
              const line = pending.length ? Buffer.concat([pending, piece]) : piece;
              if (line.length) {
                const result = parseLine(line.toString('utf8'), state);
                if (result.invalid) invalid++;
                if (result.replace) this.store.removeMirror(result.replace);
                if (result.event && this.store.saveEvent(result.event)) imported++;
              }
            } else invalid++;
            offset += bytes;
            pending = Buffer.alloc(0);
            oversized = false;
            start = index + 1;
          }
          const tail = chunk.subarray(start);
          pending = Buffer.concat([pending, tail]);
          if (pending.length > maxLine) {
            // Retain the byte count without retaining a potentially huge conversation/tool line.
            offset += pending.length;
            pending = Buffer.alloc(0);
            oversized = true;
          }
        }
      }
      if (oversized) throw new Error('An oversized unfinished log line will be retried next scan.');
      this.store.saveFile(path, { identity, size: metadata.size, mtime: metadata.mtimeMs,
        offset, anchor: await anchor(path, offset), state });
      this.store.db.exec('COMMIT');
      this.status.imported += imported;
      if (invalid && this.status.warnings.length < 10) {
        this.status.warnings.push(`${path.split('/').pop()}: skipped ${invalid} invalid or oversized log lines.`);
      }
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
  }
}

async function discover(directory: string, files: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await discover(path, files);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
}

async function anchor(path: string, offset: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const length = Math.min(offset, 1024);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset - length);
    return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
  } finally { await handle.close(); }
}
