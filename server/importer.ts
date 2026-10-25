import { createHash } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { initialState, parseLine, PARSER_VERSION } from './parser.ts';
import { readLogLines } from './log-lines.ts';
import { UsageStore } from './store.ts';
import type { ScanStatus } from '../shared/types.ts';

const MAX_WARNINGS = 10;

export class Importer {
  readonly store: UsageStore;
  readonly home: string;
  status: ScanStatus;
  private current: Promise<void> | null = null;

  /**
   * Set up an incremental importer using the last persisted scan time.
   * @param store Database that retains usage and file checkpoints.
   * @param home Codex data directory containing active and archived sessions.
   */
  constructor(store: UsageStore, home: string) {
    this.store = store;
    this.home = home;
    this.status = {
      scanning: false,
      scannedFiles: 0,
      totalFiles: 0,
      imported: 0,
      skippedFiles: 0,
      lastScan: store.metadata('lastScan'),
      warnings: [],
      error: null,
    };
  }

  /**
   * Scan session logs, sharing an in-progress scan with concurrent callers.
   * @returns Completion of the scan; failures are recorded in status for display.
   */
  refresh(): Promise<void> {
    if (this.current) {
      return this.current;
    }
    this.status = {
      ...this.status,
      scanning: true,
      scannedFiles: 0,
      totalFiles: 0,
      imported: 0,
      skippedFiles: 0,
      warnings: [],
      error: null,
    };
    this.current = this.scan()
      .catch((error: unknown) => {
        this.status.error = error instanceof Error ? error.message : 'Could not scan sessions.';
      })
      .finally(() => {
        this.status.scanning = false;
        this.current = null;
      });
    return this.current;
  }

  /** Import discovered logs in a stable order, retaining readable per-file failures. */
  private async scan(): Promise<void> {
    const files: string[] = [];
    for (const root of ['sessions', 'archived_sessions']) {
      await discover(join(this.home, root), files);
    }
    this.status.totalFiles = files.length;

    for (const file of files.sort()) {
      try {
        await this.importFile(file);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        this.warn(`Could not read ${basename(file)}: ${reason}`);
      }
      this.status.scannedFiles++;
    }
    if (!files.length) {
      this.warn('No session logs found. Previously imported usage is still available.');
    }
    this.status.lastScan = new Date().toISOString();
    this.store.setMetadata('lastScan', this.status.lastScan);
  }

  /** Commit usage and its checkpoint together so a failed file can be safely retried. */
  private async importFile(path: string): Promise<void> {
    const metadata = await stat(path);
    const identity = `${metadata.dev}:${metadata.ino}`;
    const saved = this.store.file(path);
    const sameFile = saved?.state.version === PARSER_VERSION && saved.identity === identity;

    if (sameFile && saved.mtime === metadata.mtimeMs && saved.size === metadata.size) {
      this.status.skippedFiles++;
      return;
    }
    const canResume = sameFile
      && metadata.size > saved.size
      && saved.offset <= metadata.size
      && await anchor(path, saved.offset) === saved.anchor;
    let offset = canResume ? saved.offset : 0;
    const state = canResume ? saved.state : initialState(path);
    let imported = 0;
    let invalid = 0;

    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      for await (const line of readLogLines(path, offset, metadata.size)) {
        offset = line.offset;
        if (line.text === null) {
          invalid++;
          continue;
        }
        if (line.text.length === 0) {
          continue;
        }
        const result = parseLine(line.text, state);
        if (result.invalid) {
          invalid++;
        }
        if (result.replace) {
          this.store.removeMirror(result.replace);
        }
        if (result.event && this.store.saveEvent(result.event)) {
          imported++;
        }
      }
      this.store.saveFile(path, {
        identity,
        size: metadata.size,
        mtime: metadata.mtimeMs,
        offset,
        anchor: await anchor(path, offset),
        state,
      });
      this.store.db.exec('COMMIT');
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }

    this.status.imported += imported;
    if (invalid) {
      this.warn(`${basename(path)}: skipped ${invalid} invalid or oversized log lines.`);
    }
  }

  /** Bound import notes so malformed files cannot overwhelm the dashboard. */
  private warn(message: string): void {
    if (this.status.warnings.length < MAX_WARNINGS) {
      this.status.warnings.push(message);
    }
  }
}

/** Discover JSONL files recursively without following directory or file symlinks. */
async function discover(directory: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await discover(path, files);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path);
    }
  }
}

/** Fingerprint bytes before a checkpoint to detect rewritten logs before resuming. */
async function anchor(path: string, offset: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const length = Math.min(offset, 1024);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset - length);
    return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
  } finally {
    await handle.close();
  }
}
