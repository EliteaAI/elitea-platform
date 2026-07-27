import { describe, expect, it } from 'vitest';

import { QUERY_DEFAULT_OPTIONS, createAppQueryClient } from './queryClient';

describe('QUERY_DEFAULT_OPTIONS', () => {
  it('pins the reasoned query defaults documented in queryClient.ts', () => {
    expect(QUERY_DEFAULT_OPTIONS.queries).toEqual({
      staleTime: 30_000,
      gcTime: 300_000,
      retry: 1,
      refetchOnWindowFocus: true,
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
