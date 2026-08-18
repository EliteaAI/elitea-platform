/**
 * resume.test.ts — the resume/backoff policy (issue #329).
 *
 * The assertions are pinned to what `internal/api/v2/executions/events.go`
 * actually accepts (`requestedCursor`: `Last-Event-ID` or a `cursor` query
 * parameter, parsed with `strconv.ParseUint`), not to a shape invented here.
 */
import { describe, expect, it } from 'vitest';

import { MAX_STREAM_RECONNECT_ATTEMPTS, streamReconnectDelayMs, withResumeCursor } from './resume';

describe('streamReconnectDelayMs', () => {
  it('backs off exponentially and STOPS — the bound is four attempts spanning 15s', () => {
    const delays = [1, 2, 3, 4, 5, 6].map((attempt) => streamReconnectDelayMs(attempt));
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, undefined, undefined]);
    expect(MAX_STREAM_RECONNECT_ATTEMPTS).toBe(4);
    const total = delays.filter((delay): delay is number => delay !== undefined).reduce((sum, delay) => sum + delay, 0);
    expect(total).toBe(15_000);
  });

  it('never retries faster than 1s — an EventSource error exposes no Retry-After to read', () => {
    for (let attempt = 1; attempt <= MAX_STREAM_RECONNECT_ATTEMPTS; attempt += 1) {
      expect(streamReconnectDelayMs(attempt)).toBeGreaterThanOrEqual(1_000);
    }
  });

  it('gives up on a nonsensical attempt number rather than retrying immediately', () => {
    expect(streamReconnectDelayMs(0)).toBeUndefined();
    expect(streamReconnectDelayMs(-1)).toBeUndefined();
    expect(streamReconnectDelayMs(1.5)).toBeUndefined();
  });
});

describe('withResumeCursor', () => {
  it('asks the server to replay only what follows the cursor', () => {
    expect(withResumeCursor('/api/v2/executions/7/e1/events', '42')).toBe('/api/v2/executions/7/e1/events?cursor=42');
  });

  it('appends to a URL that already carries a query', () => {
    expect(withResumeCursor('/e/events?x=1', '42')).toBe('/e/events?x=1&cursor=42');
  });

  it('drops a non-numeric cursor instead of turning a recoverable drop into a 400', () => {
    // `strconv.ParseUint` fails on these and the route answers 400 "invalid
    // event cursor" — a permanent failure in place of a resumable one.
    expect(withResumeCursor('/e/events', 'abc')).toBe('/e/events');
    expect(withResumeCursor('/e/events', '1; DROP')).toBe('/e/events');
    expect(withResumeCursor('/e/events', '')).toBe('/e/events');
    expect(withResumeCursor('/e/events', null)).toBe('/e/events');
    expect(withResumeCursor('/e/events', undefined)).toBe('/e/events');
  });
});
