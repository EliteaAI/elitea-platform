import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPermissionListQueryKey } from '@/shared/api/generated/auth/auth';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useReorderFolders } from './useReorderFolders';
import type { FolderListItem } from './conversationListState.types';

const BASE = '/api/v2';
const PROJECT_ID = '7';

function mkFolder(overrides: Partial<FolderListItem> & { readonly id: string }): FolderListItem {
  return { name: overrides.id, conversations: [], ...overrides };
}

/**
 * Primes the permission-list query's cache synchronously before the first
 * render, so `useHasPermission` sees the resolved value on its VERY first
 * render — see `useCreateFolder.hooks.test.tsx`'s identical helper for why
 * this is needed instead of `waitFor(() => expect(result.current).
 * toBeDefined())` (which never actually waits for the permission fetch).
 */
function createWrapper(permissionNames: readonly string[]): { readonly wrapper: ({ children }: { children: ReactNode }) => ReactNode; readonly client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(getPermissionListQueryKey(PROJECT_ID), {
    data: permissionNames.map((name) => ({ name, enabled: true })),
    status: 200,
    headers: new Headers(),
  });
  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper, client };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useReorderFolders', () => {
  it('happy path: optimistically applies the new order, PUTs each changed folder, and toasts success', async () => {
    let putCount = 0;
    server.use(
      http.put(`${BASE}/elitea_core/folder/prompt_lib/7/:id`, () => {
        putCount++;
        return HttpResponse.json({});
      }),
    );

    const setFolders = vi.fn();
    const toastSuccess = vi.fn();
    const moved = mkFolder({ id: 'fA', neighbor_above_id: null, neighbor_below_id: 'fB' });
    const unchanged = mkFolder({ id: 'fB' });

    const { wrapper } = createWrapper(['models.chat.folders.update']);
    const { result } = renderHook(
      () => useReorderFolders({ projectId: '7', folders: [unchanged, moved], setFolders, toastError: vi.fn(), toastSuccess }),
      { wrapper },
    );

    await result.current.onReorderFolders([moved, unchanged]);

    expect(setFolders).toHaveBeenNthCalledWith(1, [moved, unchanged]);
    expect(putCount).toBe(1); // only `moved` has neighbor context and counts as changed
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Folders reordered successfully'));
  });

  it('error path: rolls back to the previous order and double-toasts (per-folder, then generic)', async () => {
    server.use(http.put(`${BASE}/elitea_core/folder/prompt_lib/7/fA`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    const setFolders = vi.fn();
    const toastError = vi.fn();
    const original = mkFolder({ id: 'fA', neighbor_above_id: 'fB' });
    const other = mkFolder({ id: 'fB' });

    const { wrapper } = createWrapper(['models.chat.folders.update']);
    const { result } = renderHook(() => useReorderFolders({ projectId: '7', folders: [other, original], setFolders, toastError }), { wrapper });

    await result.current.onReorderFolders([original, other]);

    expect(setFolders).toHaveBeenLastCalledWith([other, original]);
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
    expect(toastError.mock.calls[0]?.[0]).toContain('Failed to update folder fA');
  });

  it('distinctive rule: without folders.update permission, toasts and never touches local state or the network', async () => {
    let hit = false;
    server.use(
      http.put(`${BASE}/elitea_core/folder/prompt_lib/7/:id`, () => {
        hit = true;
        return HttpResponse.json({});
      }),
    );

    const setFolders = vi.fn();
    const toastError = vi.fn();
    const folder = mkFolder({ id: 'fA' });

    const { wrapper } = createWrapper([]);
    const { result } = renderHook(() => useReorderFolders({ projectId: '7', folders: [folder], setFolders, toastError }), { wrapper });

    await result.current.onReorderFolders([folder]);

    expect(hit).toBe(false);
    expect(setFolders).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('You do not have permission to reorder folders');
  });

  it('getChangedFolders diff (exercised via onReorderFolders): skips isNew folders and folders with neither neighbor field set', async () => {
    let putCount = 0;
    server.use(
      http.put(`${BASE}/elitea_core/folder/prompt_lib/7/:id`, () => {
        putCount++;
        return HttpResponse.json({});
      }),
    );

    const setFolders = vi.fn();
    const draft = mkFolder({ id: 'draft', isNew: true });
    const untouched = mkFolder({ id: 'fB' }); // known before, no neighbor context -> not "changed"
    const brandNew = mkFolder({ id: 'fC' }); // not present in previousOrder at all -> "changed" even with no neighbor context

    const { wrapper } = createWrapper(['models.chat.folders.update']);
    const { result } = renderHook(
      () => useReorderFolders({ projectId: '7', folders: [untouched], setFolders, toastError: vi.fn() }),
      { wrapper },
    );

    await result.current.onReorderFolders([draft, untouched, brandNew]);

    expect(putCount).toBe(1); // only brandNew (unseen id) is PUT; draft (isNew) and untouched (no neighbor context, already known) are skipped
  });

  /**
   * Regression (found by adversarial verify): `folderApi.update` is the
   * plain fetcher — nothing invalidated the cached `foldersList` query on a
   * successful reorder.
   */
  it('invalidates the cached folder list once every changed folder is successfully updated', async () => {
    server.use(http.put(`${BASE}/elitea_core/folder/prompt_lib/7/:id`, () => HttpResponse.json({})));
    const moved = mkFolder({ id: 'fA', neighbor_above_id: null, neighbor_below_id: 'fB' });
    const unchanged = mkFolder({ id: 'fB' });

    const { wrapper, client } = createWrapper(['models.chat.folders.update']);
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () => useReorderFolders({ projectId: '7', folders: [unchanged, moved], setFolders: vi.fn(), toastError: vi.fn() }),
      { wrapper },
    );

    await result.current.onReorderFolders([moved, unchanged]);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['folder', 'list'] });
  });

  it('does NOT invalidate the cache when a changed folder fails to update', async () => {
    server.use(http.put(`${BASE}/elitea_core/folder/prompt_lib/7/fA`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
    const original = mkFolder({ id: 'fA', neighbor_above_id: 'fB' });
    const other = mkFolder({ id: 'fB' });

    const { wrapper, client } = createWrapper(['models.chat.folders.update']);
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () => useReorderFolders({ projectId: '7', folders: [other, original], setFolders: vi.fn(), toastError: vi.fn() }),
      { wrapper },
    );

    await result.current.onReorderFolders([original, other]);

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
