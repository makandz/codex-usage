import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Importer } from '../server/importer.ts';
import { initialState, parseLine } from '../server/parser.ts';
import type { UsageEvent } from '../server/parser.ts';
import { UsageStore } from '../server/store.ts';

export const timestamp = '2026-10-24T16:00:00.000Z';
export const usage = {
  input_tokens: 1000,
  cached_input_tokens: 800,
  output_tokens: 100,
  reasoning_output_tokens: 30,
};

/**
 * Encode one session record with a terminating newline.
 * @param type Log record type.
 * @param payload Fields specific to the record type.
 * @param time ISO timestamp for the record.
 * @param ordinal Optional position used to identify inherited subagent records.
 * @returns A JSONL record ready to append to a fixture log.
 */
export function line(type: string, payload: object, time = timestamp, ordinal?: number): string {
  return JSON.stringify({ type, timestamp: time, payload, ordinal }) + '\n';
}

/**
 * Create session metadata and model context for fixture usage records.
 * @param extra Metadata overrides, such as fork or subagent history markers.
 * @returns Opening records for session-a and its initial turn.
 */
export function header(extra: object = {}): string {
  return line('session_meta', { id: 'session-a', ...extra })
    + line('turn_context', { model: 'gpt-6.1-sol', turn_id: 'turn-a' });
}

/**
 * Create a per-response usage ledger record.
 * @param response Request identity retained across copies and archive moves.
 * @param time ISO timestamp of the request.
 * @returns A ledger record using the standard fixture counters.
 */
export function ledger(response = 'one', time = timestamp): string {
  return line('token_usage_record', {
    thread_id: 'session-a',
    response_id: response,
    turn_id: 'turn-a',
    usage,
  }, time);
}

/**
 * Create a cumulative legacy record that can mirror ledger usage.
 * @param total Cumulative counters recorded after the request.
 * @param time ISO timestamp of the legacy observation.
 * @returns A legacy record with the standard fixture last-usage counters.
 */
export function legacy(total = usage, time = timestamp): string {
  return line('event_msg', {
    type: 'token_count',
    turn_id: 'turn-a',
    info: { total_token_usage: total, last_token_usage: usage },
  }, time);
}

/**
 * Parse a complete fixture transcript and apply mirror replacements.
 * @param transcript JSONL records, including session context.
 * @returns Retained usage events in insertion order.
 */
export function parseEvents(transcript: string): UsageEvent[] {
  const state = initialState('test');
  const events = new Map<string, UsageEvent>();

  for (const row of transcript.trim().split('\n')) {
    const result = parseLine(row, state);

    if (result.replace) {
      events.delete(result.replace);
    }

    if (result.event) {
      events.set(result.event.id, result.event);
    }
  }

  return [...events.values()];
}

/**
 * Create an isolated session directory, database, and importer for an integration test.
 * @returns Fixture paths and resources, with cleanup that closes the database first.
 */
export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'codex-usage-test-'));
  const home = join(directory, 'codex');
  const sessions = join(home, 'sessions');
  const archive = join(home, 'archived_sessions');
  await mkdir(sessions, { recursive: true });
  await mkdir(archive);
  const database = join(directory, 'data', 'usage.sqlite');
  const store = new UsageStore(database);
  const importer = new Importer(store, home);
  const file = join(sessions, 'session.jsonl');

  /** Release the database before removing its temporary directory. */
  async function close(): Promise<void> {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }

  return { directory, home, archive, database, store, importer, file, close };
}
