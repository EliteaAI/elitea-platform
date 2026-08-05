import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useDeleteFolder } from './useDeleteFolder.hooks';
import type { FolderListItem } from './conversationListState.types';

const BASE = '/api/v2';

function mkFolder(overrides: Partial<FolderListItem> & { readonly id: string }): FolderListItem {
  return { name: overrides.id, conversations: [], ...overrides };
}

/** `useDeleteFolder` now calls `useQueryClient()` to invalidate the folder-list cache on success — needs a real provider, unlike before this fix. */
function createWrapper(client: QueryClient): { readonly wrapper: ({ children }: { children: ReactNode }) => ReactNode } {
  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useDeleteFolder', () => {
  it('happy path: DELETEs the folder and removes it from local state', async () => {
    server.use(http.delete(`${BASE}/elitea_core/folder/prompt_lib/7/f1`, () => HttpResponse.json({})));
    const setFolders = vi.fn();
    const { wrapper } = createWrapper(new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }));
    const { result } = renderHook(() => useDeleteFolder({ projectId: '7', setFolders, toastError: vi.fn() }), { wrapper });

    await result.current.onDeleteFolder(mkFolder({ id: 'f1' }));

    expect(setFolders).toHaveBeenCalledTimes(1);
    const updater = setFolders.mock.calls[0]?.[0] as (prev: readonly FolderListItem[]) => readonly FolderListItem[];
    expect(updater([mkFolder({ id: 'f1' }), mkFolder({ id: 'f2' })]).map((f) => f.id)).toEqual(['f2']);
  });

  /**
   * Regression (found by adversarial verify): `folderApi.remove` is the
   * plain fetcher, not a mutation hook with its own `onSuccess` invalidation
   * — nothing invalidated the cached `foldersList` query on a successful
   * delete, so e.g. `useQueryFoldersList`'s `totalFolderCount` (read
   * straight off the TanStack cache) stayed stale for up to the default
   * 30s `staleTime`.
   */
  it('invalidates the cached folder list on a successful delete', async () => {
    server.use(http.delete(`${BASE}/elitea_core/folder/prompt_lib/7/f1`, () => HttpResponse.json({})));
    const setFolders = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { wrapper } = createWrapper(client);
    const { result } = renderHook(() => useDeleteFolder({ projectId: '7', setFolders, toastError: vi.fn() }), { wrapper });

    await result.current.onDeleteFolder(mkFolder({ id: 'f1' }));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['folder', 'list'] });
  });

  it('does NOT invalidate the cache when the delete fails', async () => {
    server.use(http.delete(`${BASE}/elitea_core/folder/prompt_lib/7/f1`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
    const setFolders = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { wrapper } = createWrapper(client);
    const { result } = renderHook(() => useDeleteFolder({ projectId: '7', setFolders, toastError: vi.fn() }), { wrapper });

    await result.current.onDeleteFolder(mkFolder({ id: 'f1' }));

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('error path: toasts the built error message and does NOT remove the folder locally', async () => {
    server.use(http.delete(`${BASE}/elitea_core/folder/prompt_lib/7/f1`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
    const setFolders = vi.fn();
    const toastError = vi.fn();
    const { wrapper } = createWrapper(new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }));
    const { result } = renderHook(() => useDeleteFolder({ projectId: '7', setFolders, toastError }), { wrapper });

    await result.current.onDeleteFolder(mkFolder({ id: 'f1' }));

    expect(setFolders).not.toHaveBeenCalled();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('boom'));
  });

  it('distinctive rule: a playback/virtual folder is removed from local state without any network call', async () => {
    let hit = false;
    server.use(
      http.delete(`${BASE}/elitea_core/folder/prompt_lib/7/f1`, () => {
        hit = true;
        return HttpResponse.json({});
      }),
    );
    const setFolders = vi.fn();
    const { wrapper } = createWrapper(new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }));
    const { result } = renderHook(() => useDeleteFolder({ projectId: '7', setFolders, toastError: vi.fn() }), { wrapper });

    await result.current.onDeleteFolder(mkFolder({ id: 'f1', isPlayback: true }));

    expect(hit).toBe(false);
    expect(setFolders).toHaveBeenCalledTimes(1);
  });
});
