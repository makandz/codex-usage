import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, parseLine } from '../server/parser.ts';
import { header, ledger, legacy, line, parseEvents, timestamp, usage } from './fixtures.ts';

test('a response and its cumulative mirror count once in either order', () => {
  for (const records of [[ledger(), legacy()], [legacy(), ledger()]]) {
    const events = parseEvents(header() + records.join(''));
    assert.equal(events.length, 1);
    assert.equal(events[0].input, 1000);
  }
});

test('unchanged cumulative snapshots and inherited subagent records add no usage', () => {
  const inherited = line('token_usage_record', {
    thread_id: 'session-a',
    response_id: 'inherited',
    usage,
  }, timestamp, 4);
  const parent = line('token_usage_record', {
    thread_id: 'parent',
    response_id: 'parent',
    usage,
  });
  const transcript = header({ subagent_history_start_ordinal: 5 })
    + inherited + ledger() + legacy() + legacy() + parent;
  const events = parseEvents(transcript);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'response:one');
});

test('distinct equal-size requests do not donate each other’s mirrors', () => {
  const total = { ...usage, input_tokens: 2000, cached_input_tokens: 1600, output_tokens: 200 };
  const secondTime = '2026-10-24T16:00:01Z';
  const second = line('token_usage_record', {
    thread_id: 'session-a',
    response_id: 'two',
    turn_id: 'turn-a',
    usage,
    thread_token_usage: total,
  }, secondTime);
  const events = parseEvents(header() + legacy() + second + legacy(total, secondTime));
  assert.equal(events.length, 2);
});

test('delayed mirrors match cumulative identity, even outside the timing fallback', () => {
  const first = line('token_usage_record', {
    thread_id: 'session-a',
    response_id: 'one',
    usage,
    thread_token_usage: usage,
  });
  const events = parseEvents(header() + first + legacy(usage, '2026-10-24T16:01:00Z'));
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'response:one');
});

test('forks ignore inherited opening totals and retain only owned legacy usage', () => {
  const inherited = line('event_msg', {
    type: 'token_count',
    info: { total_token_usage: usage },
  });
  const total = { ...usage, input_tokens: 2000, cached_input_tokens: 1600, output_tokens: 200 };
  const events = parseEvents(header({ forked_from_id: 'parent' }) + inherited + legacy(total));
  assert.equal(events.length, 1);
  assert.equal(events[0].input, 1000);
  assert.equal(events[0].cached, 800);
});

test('legacy counter resets use last-usage instead of subtracting the previous total', () => {
  const larger = { ...usage, input_tokens: 2000, cached_input_tokens: 1600, output_tokens: 200 };
  const events = parseEvents(header() + legacy(larger) + legacy(usage, '2026-10-24T16:00:01Z'));
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.input), [1000, 1000]);
});

test('malformed records and impossible cache counters are rejected', () => {
  const state = initialState('test');
  assert.deepEqual(parseLine('{bad json}', state), { invalid: true });
  const invalid = line('token_usage_record', {
    usage: { ...usage, cached_input_tokens: 1001 },
  });
  assert.deepEqual(parseLine(invalid, state), { invalid: true });
});
