import { describe, expect, it } from 'vitest';

import { EliteaApiError } from '@/shared/api/generated/mutator';

import { QUERY_DEFAULT_OPTIONS, createAppQueryClient } from './queryClient';

function httpError(status: number): EliteaApiError {
  return new EliteaApiError({ kind: 'http', status, url: 'https://example.test/api/v2/x', body: undefined });
}

/**
 * The failure `shared/api/http.ts` builds AFTER it ran the single-flight
 * re-authentication and the replay still answered 401. A different kind from
 * {@link httpError}, and the retry predicate must treat it differently.
 */
function authError(status: number): EliteaApiError {
  return new EliteaApiError({ kind: 'auth', status, url: 'https://example.test/api/v2/x' });
}

/** Reads the retry predicate without repeating its type at every call site. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  const { retry } = QUERY_DEFAULT_OPTIONS.queries ?? {};
  if (typeof retry !== 'function') throw new Error('queries.retry is not a predicate');
  return retry(failureCount, error as Error);
}

describe('QUERY_DEFAULT_OPTIONS', () => {
  it('pins the reasoned query defaults documented in queryClient.ts', () => {
    expect(QUERY_DEFAULT_OPTIONS.queries).toMatchObject({
      staleTime: 30_000,
      gcTime: 300_000,
      refetchOnWindowFocus: true,
    });
    expect(typeof QUERY_DEFAULT_OPTIONS.queries?.retry).toBe('function');
  });

  describe('queries.retry never repeats a final client answer', () => {
    // A HAR of one page load against a live deployment held 32 requests to
    // /api/v2/configurations/configurations/1, every one a 403. Half of each
    // such set was the retry: a plain `retry: 1` repeats every rejection,
    // whatever its cause, so a 4xx was always requested twice.
    it.each([400, 401, 403, 404, 409, 422])('does not retry a %d', (status) => {
      expect(shouldRetry(0, httpError(status))).toBe(false);
    });

    // Both codes explicitly invite the caller to try again.
    it.each([408, 429])('still retries a %d once', (status) => {
      expect(shouldRetry(0, httpError(status))).toBe(true);
      expect(shouldRetry(1, httpError(status))).toBe(false);
    });

    it('still retries a 5xx once', () => {
      expect(shouldRetry(0, httpError(503))).toBe(true);
      expect(shouldRetry(1, httpError(503))).toBe(false);
    });

    // 501 is the one 5xx that is a statement about the DEPLOYMENT rather than
    // about this attempt: the functionality does not exist here, so the next
    // identical request gets the same answer. `/elitea_core/analytics*` returns
    // it with `{code: "no_data_source"}` where a figure has no producer, and a
    // HAR of one Analytics page load held eight requests — four of them
    // retries of an answer the server had already finished giving.
    it('does not retry a 501', () => {
      expect(shouldRetry(0, httpError(501))).toBe(false);
    });

    it('still retries a network failure once', () => {
      const offline = new EliteaApiError({
        kind: 'network',
        url: 'https://example.test/api/v2/x',
        message: 'offline',
        cause: undefined,
      });
      expect(shouldRetry(0, offline)).toBe(true);
      expect(shouldRetry(1, offline)).toBe(false);
    });

    it('still retries an error that is not an EliteaApiError', () => {
      expect(shouldRetry(0, new TypeError('boom'))).toBe(true);
    });

    /*
     * A `kind: 'auth'` 401 answers for the SESSION, not for the request, and
     * the session changes on its own while the user completes the login. In
     * journey J3 the re-auth replay lands about 10ms before the popup closes,
     * so it still reads 401; with no retry the sidebar Create button stayed
     * disabled after a completed login until the page was reloaded. The
     * `kind: 'http'` 401 above must keep its "never repeat" answer, so these
     * two cases have to disagree on the same status.
     */
    it('retries a re-authenticated 401 once, unlike a plain 401', () => {
      expect(shouldRetry(0, authError(401))).toBe(true);
      expect(shouldRetry(1, authError(401))).toBe(false);
      expect(shouldRetry(0, httpError(401))).toBe(false);
    });
  });

  it('pins mutations to no automatic retry', () => {
    expect(QUERY_DEFAULT_OPTIONS.mutations).toEqual({ retry: 0 });
  });
});

describe('createAppQueryClient', () => {
  it('returns a QueryClient constructed with QUERY_DEFAULT_OPTIONS', () => {
    const client = createAppQueryClient();
    expect(client.getDefaultOptions()).toEqual(QUERY_DEFAULT_OPTIONS);
  });

  it('is a factory, not a singleton: two calls return two independent clients', () => {
    const first = createAppQueryClient();
    const second = createAppQueryClient();
    expect(first).not.toBe(second);

    // Independence, not just distinct identity: writing to one client's
    // cache must not be observable through the other.
    first.setQueryData(['probe'], 'first-value');
    expect(second.getQueryData(['probe'])).toBeUndefined();
  });
});
