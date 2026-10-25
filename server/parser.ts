import { createHash } from 'node:crypto';
import type { TokenUsage } from './pricing.ts';

type JsonObject = Record<string, unknown>;

export type UsageEvent = TokenUsage & {
  id: string;
  session: string;
  timestamp: number;
  model: string;
  tier: string | null;
};

type Observation = {
  id: string;
  kind: 'ledger' | 'legacy';
  timestamp: number;
  turn: string | null;
  usage: TokenUsage;
  total: TokenUsage | null;
  mirrored: boolean;
};

export type ParserState = {
  version: number;
  session: string;
  model: string;
  tier: string | null;
  turn: string | null;
  boundary: number;
  forked: boolean;
  previous: TokenUsage | null;
  observations: Observation[];
};

export type ParseResult = {
  event?: UsageEvent;
  replace?: string;
  invalid?: boolean;
};

export const PARSER_VERSION = 1;
const MIRROR_WINDOW_MS = 5_000;
const MAX_OBSERVATIONS = 32;

/** Read object fields without trusting the shape of a JSON record. */
function object(value: unknown): JsonObject {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

/** Treat empty or non-string identifiers as missing. */
function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Accept only nonnegative integer token counts that can be represented exactly. */
function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Normalize log counters, rejecting impossible cache totals. */
function readTokens(value: unknown): TokenUsage | null {
  const counters = object(value);
  const input = counters.input_tokens;
  const output = counters.output_tokens;
  const cached = counters.cached_input_tokens ?? 0;
  const write = counters.cache_write_input_tokens ?? 0;

  if (!isTokenCount(input) || !isTokenCount(output) || !isTokenCount(cached) || !isTokenCount(write)) {
    return null;
  }
  if (cached + write > input) {
    return null;
  }
  return { input, output, cached, write };
}

/** Compare all counters used to recognize mirrored usage. */
function equalUsage(left: TokenUsage, right: TokenUsage): boolean {
  return left.input === right.input
    && left.cached === right.cached
    && left.write === right.write
    && left.output === right.output;
}

/** Prefer cumulative deltas, falling back to last-usage when counters reset. */
function legacyUsage(previous: TokenUsage | null, total: TokenUsage, last: TokenUsage | null): TokenUsage | null {
  if (!previous) {
    return last ?? total;
  }
  const countersIncreased = total.input >= previous.input
    && total.output >= previous.output
    && total.cached >= previous.cached
    && total.write >= previous.write;

  if (!countersIncreased) {
    return last;
  }
  return {
    input: total.input - previous.input,
    cached: total.cached - previous.cached,
    write: total.write - previous.write,
    output: total.output - previous.output,
  };
}

/** Match a ledger record and its legacy mirror without merging separate requests. */
function isMirror(previous: Observation, current: Observation): boolean {
  if (previous.mirrored || previous.kind === current.kind || !equalUsage(previous.usage, current.usage)) {
    return false;
  }
  if (previous.timestamp === current.timestamp) {
    return true;
  }
  if (previous.total && current.total) {
    return equalUsage(previous.total, current.total);
  }
  return current.turn !== null
    && current.turn === previous.turn
    && Math.abs(current.timestamp - previous.timestamp) <= MIRROR_WINDOW_MS;
}

/**
 * Create resumable parsing context for a session log.
 * @param path Fallback session identity until metadata supplies an ID.
 * @returns Fresh state suitable for persisting with a file checkpoint.
 */
export function initialState(path: string): ParserState {
  return {
    version: PARSER_VERSION,
    session: path,
    model: 'unknown',
    tier: null,
    turn: null,
    boundary: 0,
    forked: false,
    previous: null,
    observations: [],
  };
}

/**
 * Parse a log record, updating context and reconciling mirrored usage in place.
 * @param line One complete JSON record without its trailing newline.
 * @param state Session context retained across records and incremental imports.
 * @returns Owned usage, an optional legacy identity to replace, or an invalid-record flag.
 */
export function parseLine(line: string, state: ParserState): ParseResult {
  let row: JsonObject;
  try {
    row = object(JSON.parse(line));
  } catch {
    return { invalid: true };
  }
  const payload = object(row.payload);

  if (row.type === 'session_meta') {
    state.session = nonEmptyString(payload.id) ?? nonEmptyString(payload.session_id) ?? state.session;
    state.boundary = typeof payload.subagent_history_start_ordinal === 'number'
      ? payload.subagent_history_start_ordinal
      : 0;
    state.forked = Boolean(payload.forked_from_id || payload.history_base);
    return {};
  }
  // Inherited context is still needed to interpret records owned by a subagent.
  if (row.type === 'turn_context') {
    state.model = nonEmptyString(payload.model) ?? state.model;
    state.turn = nonEmptyString(payload.turn_id);
    return {};
  }
  if (row.type === 'event_msg' && payload.type === 'thread_settings_applied') {
    const settings = object(payload.thread_settings);
    state.tier = nonEmptyString(settings.service_tier);
    state.model = nonEmptyString(settings.model) ?? state.model;
    return {};
  }
  if (typeof row.ordinal === 'number' && row.ordinal < state.boundary) {
    return {};
  }

  const ledger = row.type === 'token_usage_record';
  const legacy = row.type === 'event_msg' && payload.type === 'token_count';
  if (!ledger && !legacy) {
    return {};
  }
  if (ledger && nonEmptyString(payload.thread_id) && payload.thread_id !== state.session) {
    return {};
  }

  const timestamp = Date.parse(String(row.timestamp));
  if (!Number.isFinite(timestamp)) {
    return { invalid: true };
  }
  const info = object(payload.info);
  const total = readTokens(ledger ? payload.thread_token_usage : info.total_token_usage);
  const last = readTokens(ledger ? payload.usage : info.last_token_usage);
  let usage = last;

  if (legacy && total) {
    const previous = state.previous;
    state.previous = total;
    if (previous && equalUsage(previous, total)) {
      return {};
    }
    // A fork's opening counters may include inherited history; only last-usage is owned.
    if (!previous && state.forked && (!last || last.input + last.output === 0)) {
      return {};
    }
    usage = legacyUsage(previous, total, last);
  }
  if (!usage || usage.cached + usage.write > usage.input) {
    return { invalid: true };
  }
  if (usage.input + usage.output === 0) {
    return {};
  }

  const response = nonEmptyString(payload.response_id);
  let id: string;
  if (ledger && response) {
    id = `response:${response}`;
  } else {
    const identity = JSON.stringify([state.session, timestamp, total ?? usage]);
    id = `legacy:${createHash('sha256').update(identity).digest('hex')}`;
  }
  const observation: Observation = {
    id,
    kind: ledger ? 'ledger' : 'legacy',
    timestamp,
    turn: nonEmptyString(payload.turn_id) ?? state.turn,
    usage,
    total,
    mirrored: false,
  };
  const match = state.observations.find(previous => isMirror(previous, observation));
  if (match) {
    match.mirrored = true;
    if (!ledger) {
      return {};
    }
    observation.mirrored = true;
  }
  state.observations.push(observation);
  state.observations = state.observations.slice(-MAX_OBSERVATIONS);

  return {
    event: { id, session: state.session, timestamp, model: state.model, tier: state.tier, ...usage },
    replace: match?.id,
  };
}
