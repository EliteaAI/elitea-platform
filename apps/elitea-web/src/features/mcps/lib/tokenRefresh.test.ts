import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAccessToken } from './storage';
import {
  clearRefreshPending,
  configureRefreshTrigger,
  getAllTokens,
  getServersNeedingRefresh,
  markRefreshPending,
  resetRefreshQueueState,
  startTokenRefreshScheduler,
} from './tokenRefresh';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  window.sessionStorage.clear();
  resetRefreshQueueState();
  vi.useRealTimers();
});

describe('markRefreshPending / clearRefreshPending', () => {
  it('a pending server is excluded from getServersNeedingRefresh even if otherwise eligible', () => {
    const now = Date.now();
    setAccessToken(
      'https://pending.example.com',
      'access',
      1, // expires in 1s (not yet expired at call time)
      undefined,
      undefined,
      'refresh-tok',
      { issued_at: now - 9000, toolkit_id: 't1', project_id: 'p1' },
    );
    markRefreshPending('https://pending.example.com');
    expect(getServersNeedingRefresh()).not.toContain('https://pending.example.com');

    clearRefreshPending('https://pending.example.com');
    // Still needs all 4 required fields + past-threshold + not-expired to show up; re-verify via a fresh token.
  });
});

describe('getServersNeedingRefresh', () => {
  it('requires refresh_token + access_token + toolkit_id + project_id, not-expired, past-threshold', () => {
    const now = Date.now();
    setAccessToken('https://eligible.example.com', 'access', 100, undefined, undefined, 'refresh', {
      issued_at: now - 9000, // 9s old of a ~100s token is still under 75%... use a tighter window below.
      toolkit_id: 't1',
      project_id: 'p1',
    });
    // Not eligible: 9s/100s is far under the 75% threshold.
    expect(getServersNeedingRefresh()).not.toContain('https://eligible.example.com');
  });

  it('flags a token past 75% lifetime with all required fields present', () => {
    const now = Date.now();
    // issued 9s ago, expires in 1s -> total lifetime 10s, threshold at 7.5s -> already past it, not yet expired.
    setAccessToken('https://due.example.com', 'access', 1, undefined, undefined, 'refresh', {
      issued_at: now - 9000,
      toolkit_id: 't1',
      project_id: 'p1',
    });
    expect(getServersNeedingRefresh()).toContain('https://due.example.com');
  });

  it('excludes a token missing toolkit_id/project_id even when past threshold', () => {
    const now = Date.now();
    setAccessToken('https://incomplete.example.com', 'access', 1, undefined, undefined, 'refresh', {
      issued_at: now - 9000,
    });
    expect(getServersNeedingRefresh()).not.toContain('https://incomplete.example.com');
  });
});

describe('getAllTokens', () => {
  it('maps a live token to {access_token, session_id}, dropping the internal fields', () => {
    setAccessToken('https://live.example.com', 'access-tok', 3600, 'sess-1', undefined, undefined);
    const all = getAllTokens();
    expect(all['https://live.example.com']).toEqual({ access_token: 'access-tok', session_id: 'sess-1' });
  });

  it('an expired token WITH a refresh_token is included with access_token:null so the backend can refresh', () => {
    setAccessToken('https://expired-refreshable.example.com', 'access-tok', -1, 'sess-1', undefined, 'refresh-tok');
    const all = getAllTokens();
    expect(all['https://expired-refreshable.example.com']).toEqual({
      access_token: null,
      session_id: null,
      refresh_token: 'refresh-tok',
    });
  });

  it('an expired token with NO refresh_token is dropped entirely', () => {
    setAccessToken('https://expired-dead.example.com', 'access-tok', -1, 'sess-1', undefined, undefined);
    const all = getAllTokens();
    expect(all['https://expired-dead.example.com']).toBeUndefined();
  });

  it('the connection-verified marker token is excluded (not a real access_token)', () => {
    setAccessToken('https://verified.example.com', '__connection_verified__', 3600, undefined, undefined, undefined);
    const all = getAllTokens();
    expect(all['https://verified.example.com']).toBeUndefined();
  });

  it('triggers the injected refresh callback for an eligible server, staggered by the queue', () => {
    const trigger = vi.fn();
    configureRefreshTrigger(trigger);

    const now = Date.now();
    setAccessToken('https://due-for-refresh.example.com', 'access', 1, undefined, undefined, 'refresh', {
      issued_at: now - 9000,
      toolkit_id: 't1',
      project_id: 'p1',
    });

    getAllTokens();
    expect(trigger).toHaveBeenCalledWith('https://due-for-refresh.example.com');
  });

  it('rate-limits repeated calls within REFRESH_CHECK_INTERVAL_MS to a single trigger', () => {
    const trigger = vi.fn();
    configureRefreshTrigger(trigger);

    const now = Date.now();
    setAccessToken('https://rate-limited.example.com', 'access', 1, undefined, undefined, 'refresh', {
      issued_at: now - 9000,
      toolkit_id: 't1',
      project_id: 'p1',
    });

    getAllTokens();
    getAllTokens();
    getAllTokens();
    expect(trigger).toHaveBeenCalledTimes(1);
  });
});

describe('startTokenRefreshScheduler', () => {
  it('fires the refresh trigger on each interval tick for an eligible server, and stops after cleanup', () => {
    const trigger = vi.fn();
    configureRefreshTrigger(trigger);

    // The scheduler only checks every REFRESH_CHECK_INTERVAL_MS (60s), so the
    // token must still be past the 75% threshold AND unexpired 60s from now:
    // issued 900s ago, expiring in 100s (1000s total lifetime, threshold at 750s).
    const now = Date.now();
    setAccessToken('https://scheduled.example.com', 'access', 100, undefined, undefined, 'refresh', {
      issued_at: now - 900_000,
      toolkit_id: 't1',
      project_id: 'p1',
    });

    const stop = startTokenRefreshScheduler();
    vi.advanceTimersByTime(60_000);
    expect(trigger).toHaveBeenCalledWith('https://scheduled.example.com');

    stop();
    trigger.mockClear();
    vi.advanceTimersByTime(120_000);
    expect(trigger).not.toHaveBeenCalled();
  });
});
