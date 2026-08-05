import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getGetApplicationQueryKey } from '@/shared/api/generated/applications/applications';
import type { ApplicationDetail } from '@/shared/api/generated/model';

import { useApplicationsStore } from '../../model/applicationsStore';
import { useRefetchAgentDetails, useSetRefetchDetails } from './useRefetchAgentDetails.hooks';

function createWrapper(queryClient: QueryClient): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  useApplicationsStore.setState({ shouldRefetchDetails: false });
});

afterEach(() => {
  useApplicationsStore.setState({ shouldRefetchDetails: false });
});

describe('useSetRefetchDetails', () => {
  it('flags shouldRefetchDetails on the shared applications store', () => {
    const { result } = renderHook(() => useSetRefetchDetails());
    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(false);
    act(() => result.current.setRefetch());
    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(true);
  });
});

describe('useRefetchAgentDetails', () => {
  it('splices values into the getApplication cache on unmount when a refetch was requested', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = getGetApplicationQueryKey('proj-1', 42);
    queryClient.setQueryData(queryKey, { data: { id: '42', name: 'Old Name' } as ApplicationDetail, status: 200 });
    useApplicationsStore.setState({ shouldRefetchDetails: true });

    const { unmount } = renderHook(
      () =>
        useRefetchAgentDetails({
          projectId: 'proj-1',
          applicationId: 42,
          values: { name: 'New Name' },
        }),
      { wrapper: createWrapper(queryClient) },
    );

    // Cache is untouched while mounted — the splice only happens on unmount.
    expect(queryClient.getQueryData<{ data: ApplicationDetail }>(queryKey)?.data.name).toBe('Old Name');

    unmount();

    expect(queryClient.getQueryData<{ data: ApplicationDetail }>(queryKey)?.data.name).toBe('New Name');
    // Merged, not replaced — id survives from the pre-existing cache entry.
    expect(queryClient.getQueryData<{ data: ApplicationDetail }>(queryKey)?.data.id).toBe('42');
    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(false);
  });

  it('does nothing on unmount when no refetch was requested', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = getGetApplicationQueryKey('proj-1', 42);
    queryClient.setQueryData(queryKey, { data: { id: '42', name: 'Old Name' } as ApplicationDetail, status: 200 });

    const { unmount } = renderHook(
      () => useRefetchAgentDetails({ projectId: 'proj-1', applicationId: 42, values: { name: 'Ignored' } }),
      { wrapper: createWrapper(queryClient) },
    );
    unmount();

    expect(queryClient.getQueryData<{ data: ApplicationDetail }>(queryKey)?.data.name).toBe('Old Name');
  });

  it('leaves a non-existent cache entry untouched (no stale write) but still clears the flag, matching the baseline\'s unconditional RTK Query updateQueryData no-op-on-missing-entry behaviour', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = getGetApplicationQueryKey('proj-1', 99);
    useApplicationsStore.setState({ shouldRefetchDetails: true });

    const { unmount } = renderHook(
      () => useRefetchAgentDetails({ projectId: 'proj-1', applicationId: 99, values: { name: 'X' } }),
      { wrapper: createWrapper(queryClient) },
    );
    unmount();

    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(false);
  });

  it('is a no-op on unmount when projectId/applicationId/values are not yet resolved', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useApplicationsStore.setState({ shouldRefetchDetails: true });

    const { unmount } = renderHook(
      () => useRefetchAgentDetails({ projectId: undefined, applicationId: undefined, values: undefined }),
      { wrapper: createWrapper(queryClient) },
    );
    unmount();

    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(true);
  });
});
