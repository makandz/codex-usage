import { createHash } from 'node:crypto';
import type { TokenUsage } from './pricing.ts';

export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}
function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function tokens(value: unknown): TokenUsage | null {
  const u = object(value);
  const input = u.input_tokens;
  const output = u.output_tokens;
  const cached = u.cached_input_tokens ?? 0;
  const write = u.cache_write_input_tokens ?? 0;
  const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (!isCount(input) || !isCount(output) || !isCount(cached) || !isCount(write)) {
    return null;
  }
  const usage = { input, output, cached, write };
  return usage.cached + usage.write <= usage.input ? usage : null;
}

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
export const PARSER_VERSION = 1;
export function initialState(path: string): ParserState {
  return { version: PARSER_VERSION, session: path, model: 'unknown', tier: null, turn: null, boundary: 0, forked: false,
    previous: null, observations: [] };
}

const equal = (a: TokenUsage, b: TokenUsage) =>
  a.input === b.input && a.cached === b.cached && a.write === b.write && a.output === b.output;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function parseLine(line: string, state: ParserState): { event?: UsageEvent; replace?: string; invalid?: boolean } {
  let row: JsonObject;
  try { row = object(JSON.parse(line)); } catch { return { invalid: true }; }
  const p = object(row.payload);
  if (row.type === 'session_meta') {
    state.session = string(p.id) ?? string(p.session_id) ?? state.session;
    state.boundary = typeof p.subagent_history_start_ordinal === 'number' ? p.subagent_history_start_ordinal : 0;
    state.forked = Boolean(p.forked_from_id || p.history_base);
    return {};
  }
  // Context records can be inherited, but they are still needed to interpret the owned suffix.
  if (row.type === 'turn_context') {
    state.model = string(p.model) ?? state.model;
    state.turn = string(p.turn_id);
    return {};
  }
  if (row.type === 'event_msg' && p.type === 'thread_settings_applied') {
    const settings = object(p.thread_settings);
    state.tier = string(settings.service_tier);
    state.model = string(settings.model) ?? state.model;
    return {};
  }
  if (typeof row.ordinal === 'number' && row.ordinal < state.boundary) return {};
  const ledger = row.type === 'token_usage_record';
  const legacy = row.type === 'event_msg' && p.type === 'token_count';
  if (!ledger && !legacy) return {};
  if (ledger && string(p.thread_id) && p.thread_id !== state.session) return {};
  const timestamp = Date.parse(String(row.timestamp));
  if (!Number.isFinite(timestamp)) return { invalid: true };
  const info = object(p.info);
  const total = tokens(ledger ? p.thread_token_usage : info.total_token_usage);
  const last = tokens(ledger ? p.usage : info.last_token_usage);
  let usage = last;
  if (legacy && total) {
    const previous = state.previous;
    state.previous = total;
    if (previous && equal(previous, total)) return {};
    if (previous && total.input >= previous.input && total.output >= previous.output
      && total.cached >= previous.cached && total.write >= previous.write) {
      usage = { input: total.input - previous.input, cached: total.cached - previous.cached,
        write: total.write - previous.write, output: total.output - previous.output };
    } else if (!previous) {
      // Opening fork counters can describe inherited history. Only last-usage is owned.
      usage = last ?? (state.forked ? null : total);
      if (state.forked && (!last || last.input + last.output === 0)) return {};
    }
  }
  if (!usage || usage.cached + usage.write > usage.input) return { invalid: true };
  if (usage.input + usage.output === 0) return {};
  const turn = string(p.turn_id) ?? state.turn;
  const kind = ledger ? 'ledger' : 'legacy';
  const response = string(p.response_id);
  const id = ledger && response ? `response:${response}`
    : `legacy:${hash(JSON.stringify([state.session, timestamp, total ?? usage]))}`;
  const match = state.observations.find(o => !o.mirrored && o.kind !== kind && equal(o.usage, usage)
    && (o.timestamp === timestamp || (o.total && total && equal(o.total, total))
      || ((!o.total || !total) && turn !== null && turn === o.turn && Math.abs(timestamp - o.timestamp) <= 5000)));
  if (match) match.mirrored = true;
  if (match && !ledger) return {};
  state.observations.push({ id, kind, timestamp, turn, usage, total, mirrored: Boolean(match) });
  state.observations = state.observations.slice(-32);
  return {
    event: { id, session: state.session, timestamp, model: state.model, tier: state.tier, ...usage },
    replace: match?.id,
  };
}
