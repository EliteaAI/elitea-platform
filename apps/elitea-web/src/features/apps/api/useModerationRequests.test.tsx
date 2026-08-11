import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';

import {
  getCreateModerationRequestMockHandler,
  getModerationStatusMockHandler,
} from '@/shared/api/generated/admin/admin.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { REQUEST_STATUS } from '../lib/constants';

import { entityIdForType, useModerationRequests } from './useModerationRequests';
import { renderHookWithRouter } from '../__tests__/testUtils';

/**
 * `../__tests__/testUtils.tsx`'s own `createTestQueryClient()` zeroes out
 * `gcTime` and forces `retry: false` — deliberately, so unrelated tests
 * never depend on cache/retry timing. That also means it CANNOT reproduce
 * the exact regression finding #1 (adversarial-review cluster
 * `A6-api-model`) describes: `submitRequest` routing its POST through
 * `queryClient.fetchQuery()` against query-flavoured options picks up
 * whatever the *app's real* `defaultOptions.queries` are
 * (`staleTime: 30_000`, `retry: 1` — `src/app/providers/queryClient.ts`'s
 * `QUERY_DEFAULT_OPTIONS`), not the test harness's zeroed ones. Importing
 * that module directly here would pull a `features/` test across the FSD
 * boundary into `app/` (the wrong direction), so the three field values
 * relevant to this regression are duplicated locally instead — this is the
 * "local adapter" the repo's porting rules ask for when a sibling/higher
 * layer's shape is needed but importing it isn't allowed. Keep in sync with
 * `QUERY_DEFAULT_OPTIONS` if that file's `staleTime`/`retry` ever change.
 */
function buildProdParityQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
      mutations: { retry: 0 },
    },
  });
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('entityIdForType', () => {
  it('is deterministic for the same type', () => {
    expect(entityIdForType('inventory')).toBe(entityIdForType('inventory'));
  });

  it('differs across the two catalog types (no collision for this app)', () => {
    expect(entityIdForType('inventory')).not.toBe(entityIdForType('wikis_Wikis'));
  });

  it('is always a non-negative 32-bit integer', () => {
    const id = entityIdForType('inventory');
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('useModerationRequests', () => {
  it('reports REQUEST_STATUS.NONE for every type while there is no selected project', async () => {
    const { result } = renderHookWithRouter(() => useModerationRequests());
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current.getRequestStatus('inventory')).toBe(REQUEST_STATUS.NONE);
    expect(result.current.isFetching).toBe(false);
  });

  it('reports REQUEST_STATUS.NONE for a type outside the catalogue', async () => {
    server.use(getModerationStatusMockHandler({ status: REQUEST_STATUS.APPROVED }));
    const { result } = renderHookWithRouter(() => useModerationRequests(), { projectId: 'proj-1' });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.getRequestStatus('not-a-catalog-type')).toBe(REQUEST_STATUS.NONE);
  });

  it('reads the {total, rows} envelope the real endpoint returns, newest row first', async () => {
    // The shape unit A14's Go handler answers with, and pylon's before it. Until
    // A14 the Go side returned a bare `{"status":"approved"}` from a static
    // stub, and this hook read only that — so against a real server it found no
    // `status` field, fell through to NONE, and the "Pending approval" state on
    // a catalogue card was unreachable: the card kept offering "Request Access"
    // after the request had been filed.
    server.use(
      http.get('*/admin/moderation_status/default/:projectId/:entityId', () =>
        HttpResponse.json({
          total: 2,
          rows: [
            { id: 2, status: REQUEST_STATUS.PENDING },
            { id: 1, status: REQUEST_STATUS.REJECTED },
          ],
        }),
      ),
    );

    const { result } = renderHookWithRouter(() => useModerationRequests(), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    // `rows[0]`, not `rows[1]`: the server orders newest first and the state the
    // card wants is the most recent request, not the first one ever made.
    expect(result.current.getRequestStatus('inventory')).toBe(REQUEST_STATUS.PENDING);
  });

  it('reports NONE when the envelope carries no rows', async () => {
    // An entity nobody has asked about. The stub answered "approved" here.
    server.use(
      http.get('*/admin/moderation_status/default/:projectId/:entityId', () =>
        HttpResponse.json({ total: 0, rows: [] }),
      ),
    );

    const { result } = renderHookWithRouter(() => useModerationRequests(), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.getRequestStatus('inventory')).toBe(REQUEST_STATUS.NONE);
  });

  it('reports the status the (stub) backend returns for a real project', async () => {
    server.use(getModerationStatusMockHandler({ status: REQUEST_STATUS.APPROVED }));

    const { result } = renderHookWithRouter(() => useModerationRequests(), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.getRequestStatus('inventory')).toBe(REQUEST_STATUS.APPROVED);
    expect(result.current.getRequestStatus('wikis_Wikis')).toBe(REQUEST_STATUS.APPROVED);
  });

  it('falls back to REQUEST_STATUS.NONE for an unrecognised status value from the server', async () => {
    server.use(getModerationStatusMockHandler({ status: 'something-unexpected' }));

    const { result } = renderHookWithRouter(() => useModerationRequests(), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.getRequestStatus('inventory')).toBe(REQUEST_STATUS.NONE);
  });

  it('submitRequest sets isSubmitting for the duration of the call and clears it after', async () => {
    server.use(
      getModerationStatusMockHandler({ status: REQUEST_STATUS.NONE }),
      getCreateModerationRequestMockHandler({ status: REQUEST_STATUS.APPROVED }),
    );

    const { result } = renderHookWithRouter(() => useModerationRequests(), { projectId: 'proj-1' });
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.isSubmitting).toBe(false);
    await act(async () => {
      await result.current.submitRequest('inventory', 'I need this for onboarding');
    });
    expect(result.current.isSubmitting).toBe(false);
  });

  it('submitRequest is a no-op while there is no selected project', async () => {
    const { result } = renderHookWithRouter(() => useModerationRequests());
    await waitFor(() => expect(result.current).toBeDefined());

    await act(async () => {
      await result.current.submitRequest('inventory', 'reason');
    });
    expect(result.current.getRequestStatus('inventory')).toBe(REQUEST_STATUS.NONE);
  });

  it('submitRequest fires a fresh POST on every call, even with identical arguments inside the real 30s staleTime window (regression test — queryClient.fetchQuery() against query-flavoured options would dedup this non-idempotent POST against the QueryClient cache and skip the second network call entirely)', async () => {
    let postCount = 0;
    server.use(
      getModerationStatusMockHandler({ status: REQUEST_STATUS.NONE }),
      http.post('*/admin/moderation_status/default/:projectId/:entityId', () => {
        postCount += 1;
        return HttpResponse.json({ status: REQUEST_STATUS.APPROVED });
      }),
    );

    const { result } = renderHookWithRouter(() => useModerationRequests(), {
      projectId: 'proj-1',
      queryClient: buildProdParityQueryClient(),
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    await act(async () => {
      await result.current.submitRequest('inventory', 'same reason');
    });
    expect(postCount).toBe(1);

    // Same type/description/label as the first call — under the old
    // fetchQuery()-against-query-options implementation this hashes to the
    // same queryKey and, still inside the 30s staleTime window, resolves
    // from cache with NO second network request.
    await act(async () => {
      await result.current.submitRequest('inventory', 'same reason');
    });
    expect(postCount).toBe(2);
  });

  it('does not auto-retry a failed submitRequest (regression test — queryClient.fetchQuery() picks up the real query default retry: 1, silently replaying the non-idempotent POST once on failure)', async () => {
    let postCount = 0;
    server.use(
      getModerationStatusMockHandler({ status: REQUEST_STATUS.NONE }),
      http.post('*/admin/moderation_status/default/:projectId/:entityId', () => {
        postCount += 1;
        return HttpResponse.json({ error: 'boom' }, { status: 500 });
      }),
    );

    const { result } = renderHookWithRouter(() => useModerationRequests(), {
      projectId: 'proj-1',
      queryClient: buildProdParityQueryClient(),
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.submitRequest('inventory', 'reason');
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeDefined();
    expect(postCount).toBe(1);
    expect(result.current.isSubmitting).toBe(false);
  });
});
